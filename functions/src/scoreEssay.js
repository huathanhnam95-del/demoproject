/**
 * scoreEssay - Rubric-based Write Essay scoring using Gemini (Vertex AI)
 *
 * Notes:
 * - Auth required (hybrid access): guests can use basic feedback, scoring requires login.
 * - Per-user daily quota is enforced via users/{uid}.aiEssayScoreStats.
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

const {
  extractGeneratedText,
  extractJsonObject,
  truncateForLog
} = require('./assessWriting.helpers');
const {
  DEFAULT_VERTEX_LOCATION,
  getGeminiModel,
  normalizeScalar,
  shouldUseGeminiFallback
} = require('./geminiVertexModels');

const db = admin.firestore();

const DEFAULT_MODEL = 'gemini-3-flash-preview';
const FALLBACK_MODEL = 'gemini-3.1-flash-lite';
const JSON_GENERATION_CONFIG = {
  responseMimeType: 'application/json',
  temperature: 0.2
};

function safeInt(n, { min = 0, max = 0 } = {}) {
  const num = Number(n);
  if (!Number.isFinite(num)) return min;
  const rounded = Math.round(num);
  return Math.max(min, Math.min(max, rounded));
}

function buildPrompt({ essayText, promptText, rubricText }) {
  const schema = `
Return raw JSON only. Do NOT wrap in markdown.
JSON schema:
{
  "scores": {
    "content": { "score": 0, "max": 6, "rationale": "string", "evidence": ["string"], "fixTips": ["string"] },
    "form": { "score": 0, "max": 2, "rationale": "string", "evidence": ["string"], "fixTips": ["string"] },
    "development_structure_coherence": { "score": 0, "max": 6, "rationale": "string", "evidence": ["string"], "fixTips": ["string"] },
    "grammar": { "score": 0, "max": 2, "rationale": "string", "evidence": ["string"], "fixTips": ["string"] },
    "general_linguistic_range": { "score": 0, "max": 6, "rationale": "string", "evidence": ["string"], "fixTips": ["string"] },
    "vocabulary_range": { "score": 0, "max": 2, "rationale": "string", "evidence": ["string"], "fixTips": ["string"] },
    "spelling": { "score": 0, "max": 2, "rationale": "string", "evidence": ["string"], "fixTips": ["string"] }
  },
  "teacherAdviceChat": "string"
}`;

  const rubric = normalizeScalar(rubricText);
  const prompt = normalizeScalar(promptText);
  const essay = normalizeScalar(essayText);

  return [
    schema,
    '',
    'Task: You are a strict, fair PTE Write Essay examiner and a helpful teacher.',
    'Score the essay using ONLY the rubric text provided below.',
    'Rules:',
    '- Use the score ranges exactly (integers only).',
    '- Evidence must quote exact short phrases from the essay (max 2 quotes per criterion, each <= 18 words).',
    '- fixTips must be actionable and specific (max 4 per criterion, each <= 18 words).',
    '- teacherAdviceChat: 5-9 short bullet points plus a 1-week practice plan in 3 lines.',
    '',
    'Rubric text:',
    rubric.slice(0, 15000),
    '',
    'Prompt shown to learner:',
    prompt.slice(0, 2000),
    '',
    'Learner essay:',
    essay.slice(0, 6000)
  ].join('\n');
}

function normalizeResult(json) {
  const maxByKey = {
    content: 6,
    form: 2,
    development_structure_coherence: 6,
    grammar: 2,
    general_linguistic_range: 6,
    vocabulary_range: 2,
    spelling: 2
  };

  const keys = Object.keys(maxByKey);
  const scoresIn = json?.scores && typeof json.scores === 'object' ? json.scores : {};
  const scores = {};

  let total = 0;
  let maxTotal = 0;

  keys.forEach((key) => {
    const max = maxByKey[key];
    const raw = scoresIn[key] && typeof scoresIn[key] === 'object' ? scoresIn[key] : {};
    const score = safeInt(raw.score, { min: 0, max });
    const evidence = Array.isArray(raw.evidence) ? raw.evidence.map((x) => normalizeScalar(x)).filter(Boolean).slice(0, 2) : [];
    const fixTips = Array.isArray(raw.fixTips) ? raw.fixTips.map((x) => normalizeScalar(x)).filter(Boolean).slice(0, 4) : [];
    const rationale = normalizeScalar(raw.rationale) || '';

    scores[key] = { score, max, rationale, evidence, fixTips };
    total += score;
    maxTotal += max;
  });

  const percent = maxTotal > 0 ? Math.round((total / maxTotal) * 100) : 0;
  const teacherAdviceChat = normalizeScalar(json?.teacherAdviceChat).slice(0, 1800);

  return {
    scores,
    overall: { total, maxTotal, percent },
    teacherAdviceChat
  };
}

const scoreEssay = onCall({ maxInstances: 10 }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }

  const uid = request.auth.uid;
  const { text, promptText, rubricText } = request.data || {};

  const essayText = normalizeScalar(text);
  const safePromptText = normalizeScalar(promptText);
  const safeRubricText = normalizeScalar(rubricText);

  if (!essayText || essayText.length < 50) {
    throw new HttpsError('invalid-argument', 'Essay text is required (min 50 chars).');
  }
  if (essayText.length > 6000) {
    throw new HttpsError('invalid-argument', 'Essay text is too long (max 6000 chars).');
  }
  if (!safeRubricText || safeRubricText.length < 200) {
    throw new HttpsError('invalid-argument', 'Rubric text is required.');
  }
  if (safeRubricText.length > 15000) {
    throw new HttpsError('invalid-argument', 'Rubric text is too long (max 15000 chars).');
  }

  const MAX_FREE_SCORES = Math.max(1, Number(process.env.AI_ESSAY_MAX_DAILY || '10') || 10);
  const userRef = db.collection('users').doc(uid);
  const userDoc = await userRef.get();
  const userData = userDoc.data() || {};

  const today = new Date().toISOString().split('T')[0];
  let stats = userData.aiEssayScoreStats || { lastDate: '', count: 0 };
  if (stats.lastDate !== today) stats = { lastDate: today, count: 0 };

  if ((stats.count || 0) >= MAX_FREE_SCORES) {
    return {
      limited: true,
      message: `You have used your ${MAX_FREE_SCORES} AI essay scorings for today.`
    };
  }

  const primaryModelName = normalizeScalar(process.env.AI_ESSAY_GEMINI_MODEL) || DEFAULT_MODEL;
  const fallbackModelName = normalizeScalar(process.env.AI_ESSAY_GEMINI_FALLBACK_MODEL) || FALLBACK_MODEL;
  const primaryLocation = normalizeScalar(process.env.AI_ESSAY_VERTEX_LOCATION) || DEFAULT_VERTEX_LOCATION;
  const fallbackLocation = normalizeScalar(process.env.AI_ESSAY_FALLBACK_VERTEX_LOCATION) || primaryLocation;
  const modelPrimary = getGeminiModel({
    modelName: primaryModelName,
    location: primaryLocation,
    generationConfig: JSON_GENERATION_CONFIG
  });
  const modelFallback = getGeminiModel({
    modelName: fallbackModelName,
    location: fallbackLocation,
    generationConfig: JSON_GENERATION_CONFIG
  });
  const prompt = buildPrompt({ essayText, promptText: safePromptText, rubricText: safeRubricText });

  let json;
  let rawText = '';

  try {
    const result = await modelPrimary.generateContent(prompt);
    rawText = await extractGeneratedText(result);
    json = extractJsonObject(rawText);
  } catch (error) {
    if (!shouldUseGeminiFallback(error)) {
      if (typeof rawText === 'string' && rawText) {
        error.rawResponse = rawText;
      }
      console.error('scoreEssay Gemini primary failed:', {
        uid,
        errorMessage: error?.message || String(error),
        rawResponse: typeof error?.rawResponse === 'string' ? truncateForLog(error.rawResponse) : undefined
      });
      throw new HttpsError('internal', 'AI scoring failed');
    }

    try {
      const result = await modelFallback.generateContent(prompt);
      rawText = await extractGeneratedText(result);
      json = extractJsonObject(rawText);
    } catch (fallbackError) {
      if (typeof rawText === 'string' && rawText) {
        fallbackError.rawResponse = rawText;
      }
      console.error('scoreEssay Gemini fallback failed:', {
        uid,
        errorMessage: fallbackError?.message || String(fallbackError),
        rawResponse: typeof fallbackError?.rawResponse === 'string' ? truncateForLog(fallbackError.rawResponse) : undefined
      });
      throw new HttpsError('internal', 'AI scoring failed');
    }
  }

  const normalized = normalizeResult(json);

  await userRef.set({
    aiEssayScoreStats: {
      lastDate: today,
      count: (stats.count || 0) + 1
    }
  }, { merge: true });

  return {
    success: true,
    ...normalized
  };
});

module.exports = {
  scoreEssay
};
