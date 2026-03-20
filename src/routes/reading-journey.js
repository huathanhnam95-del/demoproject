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
const { buildAssessmentQuiz } = require('../services/reading-journey/quiz-builder');
const { countWords } = require('../services/reading-journey/json');

const COLLECTION_KEYWORD_TAGS = 'reading_journey_keyword_tags_v1';
const COLLECTION_OUTLINES = 'reading_journey_outlines_v1';
const COLLECTION_BEATS = 'reading_journey_beats_v1';

const MAX_INTERACTIVE_BEATS = 5;
const ENDING_BEAT_NUMBER = MAX_INTERACTIVE_BEATS + 1;
const OPEN_BEAT_COUNT = 2;
const CANONICAL_CHOICE_IDS = Object.freeze(['investigate', 'ask', 'wait']);
const CANONICAL_CHOICE_ID_SET = new Set(CANONICAL_CHOICE_IDS);
const topicUtilsPromise = import('../../public/js/reading-journey-topic-utils.js');

function isLocalRequest(req) {
  const remoteAddress = String(req.socket?.remoteAddress || '').trim().toLowerCase();
  if (!remoteAddress) return false;

  if (remoteAddress === '127.0.0.1' || remoteAddress === '::1') return true;
  if (remoteAddress.startsWith('::ffff:') && remoteAddress.slice(7) === '127.0.0.1') return true;
  return false;
}

function isReadingJourneyEnabled(req) {
  const enabledEnv = String(process.env.READING_JOURNEY_ENABLED || '').toLowerCase();
  const allowRemote = String(process.env.READING_JOURNEY_ALLOW_REMOTE || '').toLowerCase() === 'true';
  const isLocal = isLocalRequest(req);

  // Explicit enable always wins (with remote guard defaulting to local-only).
  if (enabledEnv === 'true') {
    return allowRemote ? true : isLocal;
  }

  // Explicit disable always wins.
  if (enabledEnv === 'false') return false;

  // Developer-friendly default: enable on localhost, while staying effectively hidden on non-local hosts.
  // (Some local setups set NODE_ENV=production; host-based gating avoids surprises.)
  if (isLocal) return true;

  return false;
}

function shouldBypassAiLimiter(req) {
  if (String(process.env.READING_JOURNEY_DISABLE_RATE_LIMIT || '').toLowerCase() !== 'true') return false;
  return isLocalRequest(req);
}

function maybeAiLimiter(req, res, next) {
  if (shouldBypassAiLimiter(req)) return next();
  return aiLimiter(req, res, next);
}

function hasValidChoiceQuestion(choiceQuestion) {
  if (!choiceQuestion || typeof choiceQuestion !== 'object') return false;
  const options = Array.isArray(choiceQuestion.options) ? choiceQuestion.options : [];
  if (options.length !== 3) return false;
  for (const opt of options) {
    const id = String(opt?.id || '').trim();
    const label = String(opt?.label || '').trim();
    if (!id || !label) return false;
  }
  return true;
}

function computeOpenBeatNumbers(outlineId) {
  const base = String(outlineId || '').trim();
  if (!base) return [2, 4];
  const hash = crypto.createHash('sha256').update(`reading_journey_plan_v1|${base}`).digest();

  const picked = new Set();
  for (let i = 0; i < hash.length && picked.size < OPEN_BEAT_COUNT; i += 1) {
    const beat = (hash[i] % MAX_INTERACTIVE_BEATS) + 1;
    picked.add(beat);
  }

  const beats = Array.from(picked);
  while (beats.length < OPEN_BEAT_COUNT) {
    const beat = ((beats.length + 1) % MAX_INTERACTIVE_BEATS) + 1;
    if (!beats.includes(beat)) beats.push(beat);
  }

  beats.sort((a, b) => a - b);
  return beats;
}

function getQuestionTypeForBeat(outlineId, beatNumber) {
  const safeBeat = Number(beatNumber);
  if (!Number.isFinite(safeBeat) || safeBeat < 1 || safeBeat > MAX_INTERACTIVE_BEATS) return 'mcq';
  const openBeats = computeOpenBeatNumbers(outlineId);
  return openBeats.includes(safeBeat) ? 'open' : 'mcq';
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

async function buildStorySoFar({ outlineId, beatNumber, path }) {
  const safeBeat = Number(beatNumber);
  if (!Number.isFinite(safeBeat) || safeBeat <= 1) return '';

  const safePath = Array.isArray(path) ? path.map((v) => String(v || '').trim()).filter(Boolean) : [];

  const maxPrev = Math.min(safeBeat - 1, MAX_INTERACTIVE_BEATS);
  const recaps = [];
  const segments = [];

  for (let b = 1; b <= maxPrev; b += 1) {
    const slice = safePath.slice(0, Math.max(0, b - 1));
    const key = computeBeatCacheKey({ outlineId, beatNumber: b, path: slice });
    // eslint-disable-next-line no-await-in-loop
    const beat = await getCachedValue({ collection: COLLECTION_BEATS, id: key.id });
    if (!beat || typeof beat !== 'object') continue;

    const recap = String(beat.recap || '').trim();
    const segment = String(beat.segment || '').trim();
    if (recap) recaps.push(recap);
    if (segment) segments.push(segment);
  }

  const parts = [];
  if (recaps.length) {
    parts.push(`Recaps so far: ${recaps.map((r, i) => `${i + 1}) ${r}`).join(' ')}`);
  }
  if (segments.length) {
    parts.push(`Most recent scene: ${segments.slice(-2).join(' ')}`);
  }

  return parts.join('\n');
}

async function loadCompletedStoryArtifacts({ outlineId, path, level }) {
  const safePath = Array.isArray(path) ? path.map((v) => String(v || '').trim()).filter(Boolean) : [];
  if (!outlineId) {
    return { error: { status: 400, code: 'INVALID_ARGUMENT', message: 'outlineId is required' } };
  }
  if (safePath.length !== MAX_INTERACTIVE_BEATS) {
    return { error: { status: 400, code: 'INVALID_ARGUMENT', message: `path must be a completed path with exactly ${MAX_INTERACTIVE_BEATS} choices` } };
  }

  const outline = await getCachedValue({ collection: COLLECTION_OUTLINES, id: outlineId });
  if (!outline || typeof outline !== 'object') {
    return { error: { status: 400, code: 'NOT_FOUND', message: 'Outline not found (try /setup again)' } };
  }

  const segments = [];
  const highlights = [];

  for (let beatNumber = 1; beatNumber <= MAX_INTERACTIVE_BEATS; beatNumber += 1) {
    const slice = safePath.slice(0, Math.max(0, beatNumber - 1));
    const key = computeBeatCacheKey({ outlineId, beatNumber, path: slice });
    // eslint-disable-next-line no-await-in-loop
    const beat = await getCachedValue({ collection: COLLECTION_BEATS, id: key.id });
    const segment = String(beat?.segment || '').trim();
    if (!beat || typeof beat !== 'object' || !segment) {
      return { error: { status: 400, code: 'NOT_FOUND', message: `Completed story beat ${beatNumber} is not available` } };
    }

    segments.push(segment);
    highlights.push(Array.isArray(beat.highlights) ? beat.highlights : []);
  }

  const endingKey = computeBeatCacheKey({ outlineId, beatNumber: ENDING_BEAT_NUMBER, path: safePath });
  const endingBeat = await getCachedValue({ collection: COLLECTION_BEATS, id: endingKey.id });
  const endWrap = String(endingBeat?.endWrap || '').trim();
  if (!endingBeat || typeof endingBeat !== 'object' || !endWrap) {
    return { error: { status: 400, code: 'NOT_FOUND', message: 'Completed story ending is not available' } };
  }

  return {
    outline,
    outlineId,
    level,
    path: safePath,
    segments,
    highlights,
    endWrap,
    beatOutline: Array.isArray(outline?.beatOutline) ? outline.beatOutline : []
  };
}

function isValidBeatPayload(beat, { beatNumber, questionType }) {
  if (!beat || typeof beat !== 'object') return false;
  if (Number(beat.formatVersion) !== 2) return false;

  const segment = String(beat.segment || '').trim();
  const segmentWords = countWords(segment);
  if (segmentWords < 50 || segmentWords > 60) return false;

  const shouldEnd = Boolean(beat.shouldEnd);
  const safeBeat = Number(beatNumber);
  if (!Number.isFinite(safeBeat) || safeBeat < 1 || safeBeat > ENDING_BEAT_NUMBER) return false;

  const recap = String(beat.recap || '').trim();
  if (recap && countWords(recap) > 20) return false;

  const expectedType = String(questionType || '').trim().toLowerCase();
  if (!expectedType) return false;
  if (String(beat.questionType || '').trim().toLowerCase() !== expectedType) return false;

  if (safeBeat <= MAX_INTERACTIVE_BEATS) {
    if (shouldEnd) return false;

    if (expectedType === 'mcq') {
      if (!hasValidChoiceQuestion(beat.choiceQuestion)) return false;
      const ids = (beat.choiceQuestion?.options || [])
        .map((o) => String(o?.id || '').trim().toLowerCase())
        .filter(Boolean);
      if (ids.length !== 3) return false;
      const unique = new Set(ids);
      if (unique.size !== 3) return false;
      for (const id of unique) {
        if (!CANONICAL_CHOICE_ID_SET.has(id)) return false;
      }
      return true;
    }

    if (expectedType === 'open') {
      const question = String(beat.productionPrompt?.question || '').trim();
      if (!question) return false;
      if (beat.choiceQuestion) return false;
      return true;
    }

    return false;
  }

  // Ending beat
  if (!shouldEnd) return false;
  const wrap = String(beat.endWrap || '').trim();
  const wrapWords = countWords(wrap);
  if (wrapWords < 20 || wrapWords > 30) return false;
  if (beat.choiceQuestion) return false;
  if (beat.productionPrompt) return false;
  return true;
}

function requireEnabled(req, res, next) {
  if (!isReadingJourneyEnabled(req)) {
    return sendError(res, 404, 'NOT_FOUND', 'Not found');
  }
  next();
}

function requireAdminOrSecret(req, res, next) {
  const secret = process.env.READING_JOURNEY_ADMIN_SECRET;
  const authHeader = req.headers.authorization || '';
  if (secret && authHeader === `Bearer ${secret}`) {
    return next();
  }
  if (req.user && req.user.role === 'admin') {
    return next();
  }
  return sendError(res, 403, 'PERMISSION_DENIED', 'Admin access required');
}

// ── Routes ──────────────────────────────────────────────────────────────────────

router.get('/reading-journey/health', (req, res) => {
  if (!isReadingJourneyEnabled(req)) {
    return sendError(res, 404, 'NOT_FOUND', 'Not found');
  }
  return sendSuccess(res, {
    enabled: true,
    mode: isLocalRequest(req) ? 'dev' : 'remote',
    model: gemini.getModelName(),
    effectiveModel: gemini.getEffectiveModelName(),
    fallbackModel: gemini.getFallbackModelName(),
    fallbackReason: gemini.getForceFallbackReason() || ''
  });
});

router.get('/reading-journey/outlines', requireEnabled, async (req, res) => {
  try {
    const topicUtils = await topicUtilsPromise;
    const rawOutlines = await listCachedOutlines();
    const outlines = rawOutlines.map((entry) => topicUtils.parseOutlineMeta(entry));

    return sendSuccess(res, { outlines });
  } catch (e) {
    return sendError(res, 500, 'LIST_FAILED', 'Failed to list outlines', e?.message || String(e));
  }
});

router.post('/reading-journey/suggest-keywords', maybeAiLimiter, requireEnabled, async (req, res) => {
  try {
    const countRaw = Number(req.body?.count);
    const count = Number.isFinite(countRaw) ? Math.max(1, Math.min(10, Math.floor(countRaw))) : 5;

    let topics = [];
    try {
      // Lazy-load local dataset if present.
      // eslint-disable-next-line global-require
      const dataset = require('../../scripts/data/2025-topics.json');
      topics = Array.isArray(dataset) ? dataset : [];
    } catch (_) {
      topics = [];
    }

    const pool = topics
      .map((item) => String(item?.topic || '').trim())
      .filter(Boolean);

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

router.post('/reading-journey/setup', maybeAiLimiter, requireEnabled, async (req, res) => {
  try {
    const level = gemini.normalizeLevel(req.body?.level);
    const language = String(req.body?.language || 'en').trim() || 'en';

    const keywords = normalizeKeywords(req.body?.keywords || []);
    if (keywords.length === 0) {
      return sendError(res, 400, 'INVALID_ARGUMENT', 'keywords is required');
    }
    if (keywords.length > 8) {
      return sendError(res, 400, 'INVALID_ARGUMENT', 'keywords must be <= 8 items');
    }

    const ttlMs = resolveTtlMs();

    // 1) Topic tags (cache by hashed keywords; do not store raw keywords in cache records)
    const keywordTagsKey = computeKeywordTagsCacheKey({ keywords, language });
    const keywordTagsRecord = await getCachedValue({ collection: COLLECTION_KEYWORD_TAGS, id: keywordTagsKey.id });
    const cachedTags = Array.isArray(keywordTagsRecord)
      ? keywordTagsRecord
      : (Array.isArray(keywordTagsRecord?.topicTags) ? keywordTagsRecord.topicTags : null);
    const cachedTagsVersion = Array.isArray(keywordTagsRecord)
      ? 1
      : Number(keywordTagsRecord?.formatVersion) || 0;

    let topicTags = cachedTags;
    const needFreshTags = !Array.isArray(topicTags) || topicTags.length < 3 || cachedTagsVersion !== 2;
    if (needFreshTags) {
      topicTags = await gemini.generateTopicTags({ keywords, level, language });
      await setCachedValue({
        collection: COLLECTION_KEYWORD_TAGS,
        id: keywordTagsKey.id,
        value: { formatVersion: 2, topicTags },
        ttlMs
      });
    }

    // 2) Outline (cache by level + topicTags)
    const outlineKey = computeOutlineCacheKey({ language, level, topicTags });
    let outline = await getCachedValue({ collection: COLLECTION_OUTLINES, id: outlineKey.id });

    if (!outline || typeof outline !== 'object' || Number(outline.formatVersion) !== 2) {
      outline = await gemini.generateOutline({ keywords, topicTags: outlineKey.normalizedTopicTags, level, language });
      await setCachedValue({
        collection: COLLECTION_OUTLINES,
        id: outlineKey.id,
        key: outlineKey.key,
        value: outline,
        ttlMs
      });
    }

    // 3) Beat 1 (cache by outlineId + beat + path)
    const questionType = getQuestionTypeForBeat(outlineKey.id, 1);
    const beatKey = computeBeatCacheKey({ outlineId: outlineKey.id, beatNumber: 1, path: [] });
    let beat = await getCachedValue({ collection: COLLECTION_BEATS, id: beatKey.id });
    if (!isValidBeatPayload(beat, { beatNumber: 1, questionType })) {
      beat = await gemini.generateBeat({ outline, beatNumber: 1, path: [], questionType, storySoFar: '', level, language });
      await setCachedValue({
        collection: COLLECTION_BEATS,
        id: beatKey.id,
        key: beatKey.key,
        value: beat,
        ttlMs
      });
    }

    return sendSuccess(res, {
      setup: {
        outlineId: outlineKey.id,
        title: String(outline?.title || 'Reading Journey'),
        level,
        topicTags: outlineKey.normalizedTopicTags,
        characters: Array.isArray(outline?.characters) ? outline.characters : [],
        beatOutline: Array.isArray(outline?.beatOutline) ? outline.beatOutline : []
      },
      beat: {
        beatNumber: 1,
        path: [],
        ...beat
      }
    });
  } catch (e) {
    return sendError(res, 500, 'SETUP_FAILED', 'Reading Journey setup failed', e?.message || String(e));
  }
});

router.post('/reading-journey/advance', maybeAiLimiter, requireEnabled, async (req, res) => {
  try {
    const outlineId = String(req.body?.outlineId || '').trim();
    const currentBeatNumber = Number(req.body?.currentBeatNumber);
    const path = Array.isArray(req.body?.path) ? req.body.path.map((v) => String(v || '').trim()).filter(Boolean) : [];
    const choiceId = String(req.body?.choiceId || '').trim();
    const productionText = String(req.body?.productionText || '').trim();

    const level = gemini.normalizeLevel(req.body?.level);
    const language = String(req.body?.language || 'en').trim() || 'en';

    if (!outlineId) return sendError(res, 400, 'INVALID_ARGUMENT', 'outlineId is required');
    if (!Number.isFinite(currentBeatNumber) || currentBeatNumber < 1 || currentBeatNumber > MAX_INTERACTIVE_BEATS) {
      return sendError(res, 400, 'INVALID_ARGUMENT', `currentBeatNumber must be 1..${MAX_INTERACTIVE_BEATS}`);
    }
    if (path.length !== currentBeatNumber - 1) {
      return sendError(res, 400, 'INVALID_ARGUMENT', 'path length must equal currentBeatNumber - 1');
    }

    const currentQuestionType = getQuestionTypeForBeat(outlineId, currentBeatNumber);
    let resolvedChoiceId = '';

    if (currentQuestionType === 'mcq') {
      if (!choiceId || choiceId.length > 60) {
        return sendError(res, 400, 'INVALID_ARGUMENT', 'choiceId is required');
      }
      resolvedChoiceId = choiceId.toLowerCase();
      if (!CANONICAL_CHOICE_ID_SET.has(resolvedChoiceId)) {
        return sendError(res, 400, 'INVALID_ARGUMENT', 'choiceId must be one of: investigate, ask, wait');
      }
    } else {
      if (!productionText) {
        return sendError(res, 400, 'INVALID_ARGUMENT', 'productionText is required');
      }
      if (productionText.length > 800) {
        return sendError(res, 400, 'INVALID_ARGUMENT', 'productionText too long');
      }
      resolvedChoiceId = classifyChoiceFromOpenText(productionText);
    }

    const ttlMs = resolveTtlMs();

    const outline = await getCachedValue({ collection: COLLECTION_OUTLINES, id: outlineId });
    if (!outline || typeof outline !== 'object') {
      return sendError(res, 400, 'NOT_FOUND', 'Outline not found (try /setup again)');
    }

    // Validate choiceId against current beat cache if available (best-effort).
    if (currentQuestionType === 'mcq') {
      try {
        const currentBeatKey = computeBeatCacheKey({ outlineId, beatNumber: currentBeatNumber, path });
        const currentBeat = await getCachedValue({ collection: COLLECTION_BEATS, id: currentBeatKey.id });
        const options = Array.isArray(currentBeat?.choiceQuestion?.options) ? currentBeat.choiceQuestion.options : [];
        if (options.length) {
          const allowed = new Set(options.map((o) => String(o?.id || '').trim().toLowerCase()).filter(Boolean));
          if (!allowed.has(resolvedChoiceId)) {
            return sendError(res, 400, 'INVALID_ARGUMENT', 'choiceId is not a valid option for this beat');
          }
        }
      } catch (_) {
        // Ignore validation failures when cache is missing.
      }
    }

    const nextBeatNumber = currentBeatNumber + 1;
    const nextPath = [...path, resolvedChoiceId];
    const nextQuestionType = nextBeatNumber <= MAX_INTERACTIVE_BEATS
      ? getQuestionTypeForBeat(outlineId, nextBeatNumber)
      : 'end';

    const beatKey = computeBeatCacheKey({ outlineId, beatNumber: nextBeatNumber, path: nextPath });
    let beat = await getCachedValue({ collection: COLLECTION_BEATS, id: beatKey.id });
    if (!isValidBeatPayload(beat, { beatNumber: nextBeatNumber, questionType: nextQuestionType })) {
      const storySoFar = await buildStorySoFar({ outlineId, beatNumber: nextBeatNumber, path: nextPath });
      beat = await gemini.generateBeat({
        outline,
        beatNumber: nextBeatNumber,
        path: nextPath,
        questionType: nextQuestionType,
        storySoFar,
        level,
        language
      });
      await setCachedValue({
        collection: COLLECTION_BEATS,
        id: beatKey.id,
        key: beatKey.key,
        value: beat,
        ttlMs
      });
    }

    // Fire-and-forget: assess the completed story after the ending beat is cached.
    if (nextBeatNumber === ENDING_BEAT_NUMBER) {
      deferredStoryAssessment({ outlineId, path: nextPath, level }).catch((err) => {
        // eslint-disable-next-line no-console
        console.warn('[reading-journey] deferred assessment failed:', err?.message || err);
      });
    }

    return sendSuccess(res, {
      beat: {
        beatNumber: nextBeatNumber,
        path: nextPath,
        ...beat
      }
    });
  } catch (e) {
    return sendError(res, 500, 'ADVANCE_FAILED', 'Reading Journey advance failed', e?.message || String(e));
  }
});

// ── Deferred Story Assessment ───────────────────────────────────────────────────

/**
 * Fire-and-forget assessment of a completed story.
 * Collects all beat segments, scores with the 8-criterion rubric,
 * and stores qualityScore on the outline Firestore doc.
 */
router.post('/reading-journey/quiz', maybeAiLimiter, requireEnabled, async (req, res) => {
  try {
    const outlineId = String(req.body?.outlineId || '').trim();
    const path = Array.isArray(req.body?.path) ? req.body.path.map((v) => String(v || '').trim()).filter(Boolean) : [];
    const level = gemini.normalizeLevel(req.body?.level);

    if (!outlineId) return sendError(res, 400, 'INVALID_ARGUMENT', 'outlineId is required');

    const loaded = await loadCompletedStoryArtifacts({ outlineId, path, level });
    if (loaded.error) {
      return sendError(res, loaded.error.status, loaded.error.code, loaded.error.message);
    }

    const quiz = await buildAssessmentQuiz({
      outline: loaded.outline,
      outlineId: loaded.outlineId,
      level: loaded.level,
      segments: loaded.segments,
      endWrap: loaded.endWrap,
      beatOutline: loaded.beatOutline,
      highlights: loaded.highlights
    });

    const recommendedReviewCount = quiz.questions.filter((question) =>
      question.skill === 'vocabulary'
      || question.type === 'tap_evidence'
      || question.type === 'click_word_meaning'
    ).length;

    return sendSuccess(res, {
      quizId: quiz.quizId,
      outlineId: quiz.outlineId,
      level: quiz.level,
      storySnapshot: quiz.storySnapshot,
      questions: quiz.questions,
      recommendedReviewCount
    });
  } catch (e) {
    return sendError(res, 500, 'QUIZ_FAILED', 'Reading Journey quiz generation failed', e?.message || String(e));
  }
});

async function deferredStoryAssessment({ outlineId, path, level }) {
  const segments = [];
  let endWrap = '';

  for (let b = 1; b <= ENDING_BEAT_NUMBER; b += 1) {
    const slice = Array.isArray(path) ? path.slice(0, Math.max(0, b - 1)) : [];
    const key = computeBeatCacheKey({ outlineId, beatNumber: b, path: slice });
    // eslint-disable-next-line no-await-in-loop
    const beat = await getCachedValue({ collection: COLLECTION_BEATS, id: key.id });
    if (beat && typeof beat === 'object') {
      const seg = String(beat.segment || '').trim();
      if (seg) segments.push(seg);
      if (b === ENDING_BEAT_NUMBER && beat.endWrap) {
        endWrap = String(beat.endWrap).trim();
      }
    }
  }

  const storyText = segments.join(' ') + (endWrap ? ` ${endWrap}` : '');
  if (!storyText.trim()) return;

  const scoreResult = await gemini.assessAndScore({ storyText, level });

  // Store the quality score on the outline doc (merge, don't overwrite).
  const qualityScore = {
    assessedAt: Date.now(),
    weightedAverage: scoreResult.weightedAverage,
    passed: scoreResult.passed,
    criticalFailures: scoreResult.criticalFailures,
    flagFailures: scoreResult.flagFailures,
    scores: scoreResult.assessment,
    needsRegeneration: !scoreResult.passed
  };

  await setCachedValue({
    collection: COLLECTION_OUTLINES,
    id: outlineId,
    value: { qualityScore },
    ttlMs: resolveTtlMs()
  });

  // eslint-disable-next-line no-console
  console.log(`[reading-journey] assessed story ${outlineId}: avg=${scoreResult.weightedAverage} passed=${scoreResult.passed}`);
}

// ── Assess Story Endpoint ───────────────────────────────────────────────────────

router.post('/reading-journey/assess-story', maybeAiLimiter, requireEnabled, async (req, res) => {
  try {
    const level = gemini.normalizeLevel(req.body?.level);
    const storyText = String(req.body?.storyText || '').trim();
    if (!storyText) return sendError(res, 400, 'INVALID_ARGUMENT', 'storyText is required');
    if (storyText.length > 30_000) return sendError(res, 400, 'INVALID_ARGUMENT', 'storyText too long');

    const result = await gemini.assessAndScore({ storyText, level });
    return sendSuccess(res, {
      assessment: result.assessment,
      weightedAverage: result.weightedAverage,
      passed: result.passed,
      criticalFailures: result.criticalFailures
    });
  } catch (e) {
    return sendError(res, 500, 'ASSESS_FAILED', 'Story assessment failed', e?.message || String(e));
  }
});

const { generateStoryThumbnail } = require('../services/reading-journey/thumbnail-service');
router.post('/reading-journey/generate-thumbnail', requireAdminOrSecret, requireEnabled, async (req, res) => {
  try {
    const storyId = String(req.body?.storyId || '').trim();
    if (!storyId) return sendError(res, 400, 'INVALID_ARGUMENT', 'storyId is required');

    const isDryRun = Boolean(req.body?.dryRun);
    const result = await generateStoryThumbnail(storyId, { dryRun: isDryRun });

    return sendSuccess(res, {
      record: result.record,
      hasImage: !!result.buffer
    });
  } catch (e) {
    return sendError(res, 500, 'GENERATE_THUMBNAIL_FAILED', 'Failed to generate thumbnail', e?.message || String(e));
  }
});

module.exports = router;
