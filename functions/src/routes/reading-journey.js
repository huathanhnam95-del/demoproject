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
const { countWords } = require('../services/reading-journey/json');

const COLLECTION_KEYWORD_TAGS = 'reading_journey_keyword_tags_v1';
const COLLECTION_OUTLINES = 'reading_journey_outlines_v1';
const COLLECTION_BEATS = 'reading_journey_beats_v1';

const MAX_INTERACTIVE_BEATS = 5;
const ENDING_BEAT_NUMBER = MAX_INTERACTIVE_BEATS + 1;
const OPEN_BEAT_COUNT = 2;

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
        let beat = await gemini.generateBeat({ outline, beatNumber: 1, path: [], questionType: 'mcq', storySoFar: '', level, language });
        await setCachedValue({ collection: COLLECTION_BEATS, id: beatKey.id, key: beatKey.key, value: beat, ttlMs });
        return sendSuccess(res, { setup: { outlineId: outlineKey.id, title: outline.title, level, topicTags: outlineKey.normalizedTopicTags, characters: outline.characters, beatOutline: outline.beatOutline }, beat: { beatNumber: 1, path: [], ...beat } });
    } catch (e) {
        return sendError(res, 500, 'SETUP_FAILED', 'Reading Journey setup failed', e?.message || String(e));
    }
});

router.post('/advance', maybeAiLimiter, async (req, res) => {
    try {
        const outlineId = String(req.body?.outlineId || '').trim();
        const currentBeatNumber = Number(req.body?.currentBeatNumber);
        const path = Array.isArray(req.body?.path) ? req.body.path.map((v) => String(v || '').trim()).filter(Boolean) : [];
        const choiceId = String(req.body?.choiceId || '').trim();
        const level = gemini.normalizeLevel(req.body?.level);
        const language = String(req.body?.language || 'en').trim() || 'en';
        const outline = await getCachedValue({ collection: COLLECTION_OUTLINES, id: outlineId });
        if (!outline) return sendError(res, 400, 'NOT_FOUND', 'Story not found');
        const nextBeatNumber = currentBeatNumber + 1;
        const nextPath = [...path, choiceId.toLowerCase()];
        const beatKey = computeBeatCacheKey({ outlineId, beatNumber: nextBeatNumber, path: nextPath });
        let beat = await gemini.generateBeat({ outline, beatNumber: nextBeatNumber, path: nextPath, questionType: nextBeatNumber <= MAX_INTERACTIVE_BEATS ? 'mcq' : 'end', storySoFar: '', level, language });
        await setCachedValue({ collection: COLLECTION_BEATS, id: beatKey.id, key: beatKey.key, value: beat, ttlMs: resolveTtlMs() });
        return sendSuccess(res, { beat: { beatNumber: nextBeatNumber, path: nextPath, ...beat } });
    } catch (e) {
        return sendError(res, 500, 'ADVANCE_FAILED', 'Advance failed', e?.message || String(e));
    }
});

module.exports = router;
