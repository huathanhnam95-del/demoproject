const express = require('express');
const crypto = require('crypto');
const router = express.Router();

const aiLimiter = require('../middleware/rate-limiter');
const { sendError, sendSuccess } = require('../utils/response-helper');
const {
    normalizeKeywords,
    resolveTtlMs,
    computeKeywordTagsCacheKey,
    computeOutlineCacheKey,
    computeBeatCacheKey,
    getCachedValue,
    setCachedValue,
    listCachedOutlines
} = require('../services/reading-journey/cache');

const gemini = require('../services/reading-journey/gemini');
const { normalizeBeatForClient } = require('../services/reading-journey/beat-client-shape');
const { countWords } = require('../services/reading-journey/json');

const COLLECTION_KEYWORD_TAGS = 'reading_journey_keyword_tags_v1';
const COLLECTION_OUTLINES = 'reading_journey_outlines_v1';
const COLLECTION_BEATS = 'reading_journey_beats_v1';

const MAX_INTERACTIVE_BEATS = 3;
const ENDING_BEAT_NUMBER = MAX_INTERACTIVE_BEATS + 1;
const OPEN_BEAT_COUNT = 1;

const CANONICAL_CHOICE_IDS = Object.freeze(['investigate', 'ask', 'wait']);
const BEAT_2_CHOICE_IDS = Object.freeze(['investigate', 'ask']);

function getChoiceIdsForBeat(beatNumber) {
    return Number(beatNumber) === 2 ? BEAT_2_CHOICE_IDS : CANONICAL_CHOICE_IDS;
}

function getQuestionTypeForBeat(beatNumber) {
    const safeBeat = Number(beatNumber);
    if (!Number.isFinite(safeBeat) || safeBeat < 1 || safeBeat > MAX_INTERACTIVE_BEATS) return 'mcq';
    return safeBeat === 3 ? 'open' : 'mcq';
}

function classifyChoiceFromOpenText(text) {
    const raw = String(text || '').toLowerCase();
    if (!raw) return 'investigate';

    if (/\b(ask|asked|asking|tell|told|talk|talked|call|called|text|message|help|question)\b/.test(raw)) {
        return 'ask';
    }
    if (/\b(wait|waiting|stay|stayed|watch|watched|observe|observed|listen|listened|pause|paused|leave|left|back)\b/.test(raw)) {
        return 'wait';
    }
    if (/\b(investigate|look|looked|check|checked|explore|explored|search|searched|follow|followed|go|went|enter|entered)\b/.test(raw)) {
        return 'investigate';
    }

    return 'investigate';
}

function maybeAiLimiter(req, res, next) {
    return aiLimiter(req, res, next);
}

router.get('/health', (req, res) => {
    return sendSuccess(res, {
        enabled: true,
        model: gemini.getModelName(),
        effectiveModel: gemini.getEffectiveModelName(),
        fallbackModel: gemini.getFallbackModelName()
    });
});

router.get('/outlines', async (req, res) => {
    try {
        const rawOutlines = await listCachedOutlines();
        const outlines = rawOutlines.map((entry) => {
            const value = entry.value || {};
            let level = 'B1';
            let topicTags = [];
            const keyStr = String(entry.key || '');
            for (const part of keyStr.split('|')) {
                const idx = part.indexOf(':');
                if (idx === -1) continue;
                const k = part.slice(0, idx);
                const v = part.slice(idx + 1);
                if (k === 'level') level = v.toUpperCase() || 'B1';
                if (k === 'tags') topicTags = v.split(',').map(t => t.trim()).filter(Boolean);
            }
            if (Array.isArray(value.topicTags) && value.topicTags.length) topicTags = value.topicTags;
            return { outlineId: entry.id, title: String(value.title || 'Untitled Story').trim(), level, topicTags };
        });
        return sendSuccess(res, { outlines });
    } catch (e) {
        return sendError(res, 500, 'LIST_FAILED', 'Failed to list outlines', e?.message || String(e));
    }
});

router.post('/suggest-keywords', maybeAiLimiter, async (req, res) => {
    try {
        const countRaw = Number(req.body?.count);
        const count = Number.isFinite(countRaw) ? Math.max(1, Math.min(10, Math.floor(countRaw))) : 5;
        let topics = [];
        try {
            topics = require('../data/2025-topics.json');
        } catch (_) { topics = []; }
        const pool = topics.map((item) => String(item?.topic || '').trim()).filter(Boolean);
        const fallback = ['travel', 'food', 'sports', 'technology', 'mystery', 'nature', 'school', 'space'];
        const source = pool.length ? pool : fallback;
        const picked = [];
        const used = new Set();
        while (picked.length < count && used.size < source.length) {
            const value = source[Math.floor(Math.random() * source.length)];
            if (used.has(value)) continue;
            used.add(value);
            picked.push(value);
        }
        return sendSuccess(res, { keywords: picked });
    } catch (e) {
        return sendError(res, 500, 'SUGGEST_FAILED', 'Failed to suggest keywords', e?.message || String(e));
    }
});

/**
 * Normalize the raw Gemini beat response to match what the frontend expects.
 * Frontend reads: beat.content, beat.choices, beat.choiceQuestion, beat.highlights,
 *                 beat.shouldEnd, beat.questionType, beat.productionPrompt
 * Gemini returns: segment (not content), choiceQuestion.options (not choices at top level)
 */
function normalizeBeat(raw) {
    if (!raw || typeof raw !== 'object') return raw;
    const beat = { ...raw };
    // Map segment -> content (frontend reads beat.content)
    if (beat.segment && !beat.content) {
        beat.content = beat.segment;
    }
    // Map text/paragraph/body -> content as fallback
    if (!beat.content) {
        beat.content = beat.text || beat.paragraph || beat.body || beat.story || '';
    }
    // Ensure choices array exists at top level for MCQ beats
    if (!Array.isArray(beat.choices) && beat.choiceQuestion?.options) {
        beat.choices = beat.choiceQuestion.options.map(opt => ({
            id: opt.id || opt.choice_id || '',
            text: opt.label || opt.text || ''
        }));
    }
    // Normalize highlights to array of strings
    if (!Array.isArray(beat.highlights)) {
        beat.highlights = [];
    }
    return beat;
}

router.post('/setup', maybeAiLimiter, async (req, res) => {
    try {
        const level = gemini.normalizeLevel(req.body?.level);
        const language = String(req.body?.language || 'en').trim() || 'en';
        const keywords = normalizeKeywords(req.body?.keywords || []);
        if (keywords.length === 0) return sendError(res, 400, 'INVALID_ARGUMENT', 'keywords is required');
        const ttlMs = resolveTtlMs();
        const keywordTagsKey = computeKeywordTagsCacheKey({ keywords, language });
        let topicTags = await gemini.generateTopicTags({ keywords, level, language });
        const outlineKey = computeOutlineCacheKey({ language, level, topicTags });
        let outline = await gemini.generateOutline({ keywords, topicTags: outlineKey.normalizedTopicTags, level, language });
        await setCachedValue({ collection: COLLECTION_OUTLINES, id: outlineKey.id, key: outlineKey.key, value: outline, ttlMs });
        const beatKey = computeBeatCacheKey({ outlineId: outlineKey.id, beatNumber: 1, path: [] });
        const questionType = getQuestionTypeForBeat(1);
        let beat = await gemini.generateBeat({ outline, beatNumber: 1, path: [], questionType, storySoFar: '', level, language, choiceIds: getChoiceIdsForBeat(1) });
        beat = normalizeBeat(beat);
        await setCachedValue({ collection: COLLECTION_BEATS, id: beatKey.id, key: beatKey.key, value: beat, ttlMs });
        return sendSuccess(res, { setup: { outlineId: outlineKey.id, title: outline.title, level, topicTags: outlineKey.normalizedTopicTags, characters: outline.characters, beatOutline: outline.beatOutline }, beat: { beatNumber: 1, path: [], ...normalizeBeatForClient(beat) } });
    } catch (e) {
        return sendError(res, 500, 'SETUP_FAILED', 'Reading Journey setup failed', e?.message || String(e));
    }
});

router.post(['/advance', '/reading_journey/advance'], maybeAiLimiter, async (req, res) => {
    try {
        const outlineId = String(req.body?.outlineId || '').trim();
        const currentBeatNumber = Number(req.body?.currentBeatNumber);
        const rawPath = Array.isArray(req.body?.path) ? req.body.path.map((v) => String(v || '').trim()).filter(Boolean) : [];
        const choiceId = String(req.body?.choiceId || '').trim();
        const productionText = String(req.body?.productionText || req.body?.userResponse || '').trim();
        const level = gemini.normalizeLevel(req.body?.level);
        const language = String(req.body?.language || 'en').trim() || 'en';
        let resolvedChoiceId = choiceId.toLowerCase();
        if (!resolvedChoiceId && productionText) {
            resolvedChoiceId = classifyChoiceFromOpenText(productionText);
        }
        let path = rawPath;
        if (rawPath.length === currentBeatNumber && resolvedChoiceId) {
            const trailingChoiceId = String(rawPath[rawPath.length - 1] || '').trim().toLowerCase();
            if (trailingChoiceId === resolvedChoiceId) {
                path = rawPath.slice(0, -1);
            }
        }
        const outline = await getCachedValue({ collection: COLLECTION_OUTLINES, id: outlineId });
        if (!outline) return sendError(res, 400, 'NOT_FOUND', 'Story not found');
        const nextBeatNumber = currentBeatNumber + 1;
        const nextPath = [...path, resolvedChoiceId];
        const beatKey = computeBeatCacheKey({ outlineId, beatNumber: nextBeatNumber, path: nextPath });
        const nextQuestionType = nextBeatNumber <= MAX_INTERACTIVE_BEATS ? getQuestionTypeForBeat(nextBeatNumber) : 'end';
        let beat = await gemini.generateBeat({ outline, beatNumber: nextBeatNumber, path: nextPath, questionType: nextQuestionType, storySoFar: '', level, language, choiceIds: getChoiceIdsForBeat(nextBeatNumber) });
        beat = normalizeBeat(beat);
        await setCachedValue({ collection: COLLECTION_BEATS, id: beatKey.id, key: beatKey.key, value: beat, ttlMs: resolveTtlMs() });
        return sendSuccess(res, { beat: { beatNumber: nextBeatNumber, path: nextPath, ...normalizeBeatForClient(beat) } });
    } catch (e) {
        return sendError(res, 500, 'ADVANCE_FAILED', 'Advance failed', e?.message || String(e));
    }
});

module.exports = router;
