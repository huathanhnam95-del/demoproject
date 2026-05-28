/**
 * scoreSST - Rubric-based Summarize Spoken Text practice feedback using Gemini.
 *
 * SST Content contributes to official PTE scoring only with additional expert
 * review. This callable returns AI practice feedback, not an official score.
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

const SST_RUBRIC = `Content (0-4):
4: Comprehensive, clear and accurate summary; all main ideas identified and synthesized concisely; fluent connections.
3: Adequate summary with good comprehension; main ideas correctly identified with minor omissions; logical connections.
2: Partial summary with basic comprehension; little separation of main and peripheral ideas; relies on source wording.
1: Relevant but not meaningfully summarized; limited comprehension; disconnected ideas or excerpts; difficult to follow.
0: Too limited to demonstrate comprehension.
Form (0-2):
2: Contains 50-70 words.
1: Contains 40-49 words or 71-100 words.
0: Contains fewer than 40 or more than 100 words; all capitals; no punctuation; only bullet points; or only very short sentences.
Grammar (0-2):
2: Correct grammatical structures.
1: Grammatical errors with no hindrance to communication.
0: Defective grammatical structure which could hinder communication.
Vocabulary (0-2):
2: Appropriate choice of words.
1: Some lexical errors but with no hindrance to communication.
0: Defective word choice which could hinder communication.
Spelling (0-2):
2: Correct spelling.
1: One spelling error.
0: More than one spelling error.`;

function safeInt(number, { min = 0, max = 0 } = {}) {
  const numeric = Number(number);
  if (!Number.isFinite(numeric)) return min;
  return Math.max(min, Math.min(max, Math.round(numeric)));
}

function getWordCount(text) {
  return normalizeScalar(text).split(/\s+/).filter(Boolean).length;
}

function hasAlphabeticLetter(text) {
  return /[A-Za-z]/.test(normalizeScalar(text));
}

function isAllCaps(text) {
  const letters = normalizeScalar(text).match(/[A-Za-z]/g) || [];
  return letters.length >= 4 && letters.some((letter) => /[A-Z]/.test(letter)) &&
    !letters.some((letter) => /[a-z]/.test(letter));
}

function isBulletOnly(text) {
  const lines = String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.length > 0 && lines.every((line) => /^(?:[-*]|\d+[.)])\s+/.test(line));
}

function isVeryShortSentenceOnly(text) {
  const sentences = normalizeScalar(text).split(/[.!?]+/).map((sentence) => sentence.trim()).filter(Boolean);
  if (sentences.length < 3) return false;
  return sentences.every((sentence) => getWordCount(sentence) <= 4);
}

function scoreSSTForm(text) {
  const summary = normalizeScalar(text);
  if (!summary) return { score: 0, rationale: 'No response submitted.' };

  const count = getWordCount(summary);
  if (!hasAlphabeticLetter(summary)) return { score: 0, rationale: 'Response does not contain English words.' };
  if (isAllCaps(summary)) return { score: 0, rationale: 'Response is written entirely in capital letters.' };
  if (!/[.!?]/.test(summary)) return { score: 0, rationale: 'Response contains no sentence punctuation.' };
  if (isBulletOnly(text)) return { score: 0, rationale: 'Response consists only of bullet points.' };
  if (isVeryShortSentenceOnly(summary)) return { score: 0, rationale: 'Response consists only of very short sentences.' };
  if (count >= 50 && count <= 70) {
    return { score: 2, rationale: `Response contains ${count} words, within the required 50-70 word range.` };
  }
  if ((count >= 40 && count <= 49) || (count >= 71 && count <= 100)) {
    return { score: 1, rationale: `Response contains ${count} words, within the partial-credit range.` };
  }
  return { score: 0, rationale: `Response contains ${count} words, outside the accepted length ranges.` };
}

function isSummaryEligibleForAi(text) {
  return normalizeScalar(text).length >= 5;
}

function buildPrompt({ summaryText, sourceText, mainPoints }) {
  const expectedPoints = Array.isArray(mainPoints) && mainPoints.length
    ? mainPoints.map((point, index) => `${index + 1}. ${normalizeScalar(point)}`).join('\n')
    : '(Infer important main points from the lecture transcript.)';
  return [
    'Return raw JSON only. Do not use markdown.',
    'You provide PTE Summarize Spoken Text AI practice feedback. The result is not an official PTE score.',
    'Use integer scores and this exact schema:',
    '{"scores":{"content":{"score":0,"rationale":"","evidence":[],"fixTips":[]},"form":{"score":0,"rationale":"","evidence":[],"fixTips":[]},"grammar":{"score":0,"rationale":"","evidence":[],"fixTips":[]},"vocabulary":{"score":0,"rationale":"","evidence":[],"fixTips":[]},"spelling":{"score":0,"rationale":"","evidence":[],"fixTips":[]}},"mainPointsAnalysis":{"identified":[],"missed":[],"paraphrasingQuality":""},"teacherAdviceChat":""}',
    'Form is checked deterministically by the application; still return a Form estimate for completeness.',
    'Give useful content and language coaching even when Form is zero.',
    'Keep evidence short and based on the learner response. Make advice practical and concise.',
    '',
    'Rubric:',
    SST_RUBRIC,
    '',
    'Lecture transcript:',
    normalizeScalar(sourceText).slice(0, 10000),
    '',
    'Offline-generated expected main points:',
    expectedPoints.slice(0, 3000),
    '',
    'Learner response:',
    normalizeScalar(summaryText).slice(0, 1500)
  ].join('\n');
}

function normalizeResult(json) {
  const maxByKey = {
    content: 4,
    form: 2,
    grammar: 2,
    vocabulary: 2,
    spelling: 2
  };
  const rawScores = json?.scores && typeof json.scores === 'object' ? json.scores : {};
  const scores = {};

  Object.keys(maxByKey).forEach((key) => {
    const max = maxByKey[key];
    const raw = rawScores[key] && typeof rawScores[key] === 'object' ? rawScores[key] : {};
    scores[key] = {
      score: safeInt(raw.score, { min: 0, max }),
      max,
      rationale: normalizeScalar(raw.rationale).slice(0, 500),
      evidence: Array.isArray(raw.evidence) ? raw.evidence.map((value) => normalizeScalar(value)).filter(Boolean).slice(0, 2) : [],
      fixTips: Array.isArray(raw.fixTips) ? raw.fixTips.map((value) => normalizeScalar(value)).filter(Boolean).slice(0, 4) : []
    };
  });

  const points = json?.mainPointsAnalysis && typeof json.mainPointsAnalysis === 'object'
    ? json.mainPointsAnalysis : {};
  const mainPointsAnalysis = {
    identified: Array.isArray(points.identified) ? points.identified.map((value) => normalizeScalar(value)).filter(Boolean).slice(0, 8) : [],
    missed: Array.isArray(points.missed) ? points.missed.map((value) => normalizeScalar(value)).filter(Boolean).slice(0, 8) : [],
    paraphrasingQuality: normalizeScalar(points.paraphrasingQuality).slice(0, 500)
  };

  return {
    scores,
    overall: recomputeOverall(scores),
    mainPointsAnalysis,
    teacherAdviceChat: normalizeScalar(json?.teacherAdviceChat).slice(0, 1800)
  };
}

function recomputeOverall(scores) {
  const keys = ['content', 'form', 'grammar', 'vocabulary', 'spelling'];
  const maxTotal = 12;
  const total = keys.reduce((sum, key) => sum + safeInt(scores?.[key]?.score, {
    min: 0,
    max: scores?.[key]?.max || 0
  }), 0);
  return {
    total,
    maxTotal,
    percent: Math.round((total / maxTotal) * 100)
  };
}

function applyDeterministicFormScore(result, summaryText) {
  const form = scoreSSTForm(summaryText);
  result.scores.form = {
    score: form.score,
    max: 2,
    rationale: form.rationale,
    evidence: [],
    fixTips: form.score === 2 ? [] : ['Write a punctuated 50-70 word summary using connected sentences.']
  };
  result.overall = recomputeOverall(result.scores);
  return result;
}

async function reserveDailySSTScore(userRef, { today, maxScores }, database = db) {
  return database.runTransaction(async (transaction) => {
    const userDoc = await transaction.get(userRef);
    const userData = userDoc.data() || {};
    let stats = userData.aiSSTScoreStats || { lastDate: '', count: 0 };
    if (stats.lastDate !== today) stats = { lastDate: today, count: 0 };
    if ((stats.count || 0) >= maxScores) {
      return { limited: true, message: `You have used your ${maxScores} AI SST feedback checks for today.` };
    }
    transaction.set(userRef, {
      aiSSTScoreStats: { lastDate: today, count: (stats.count || 0) + 1 }
    }, { merge: true });
    return { limited: false };
  });
}

async function releaseDailySSTScore(userRef, { today }, database = db) {
  try {
    await database.runTransaction(async (transaction) => {
      const userDoc = await transaction.get(userRef);
      const stats = userDoc.data()?.aiSSTScoreStats || { lastDate: '', count: 0 };
      if (stats.lastDate !== today || !stats.count) return;
      transaction.set(userRef, {
        aiSSTScoreStats: { lastDate: today, count: Math.max(0, stats.count - 1) }
      }, { merge: true });
    });
  } catch (error) {
    console.warn('scoreSST quota release failed:', error?.message || String(error));
  }
}

const scoreSST = onCall({ maxInstances: 10 }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }

  const { text, sourceText, mainPoints, questionId } = request.data || {};
  const summaryText = normalizeScalar(text);
  const transcript = normalizeScalar(sourceText);
  const safePoints = Array.isArray(mainPoints) ? mainPoints.map((point) => normalizeScalar(point)).filter(Boolean).slice(0, 5) : [];

  if (!isSummaryEligibleForAi(summaryText)) {
    throw new HttpsError('invalid-argument', 'Summary text is required (min 5 chars).');
  }
  if (summaryText.length > 1500) {
    throw new HttpsError('invalid-argument', 'Summary text is too long (max 1500 chars).');
  }
  if (transcript.length < 50) {
    throw new HttpsError('invalid-argument', 'Lecture transcript is required (min 50 chars).');
  }

  const uid = request.auth.uid;
  const maximumDailyScores = Math.max(1, Number(process.env.AI_SST_MAX_DAILY || '10') || 10);
  const userRef = db.collection('users').doc(uid);
  const today = new Date().toISOString().split('T')[0];
  const quotaReservation = await reserveDailySSTScore(userRef, { today, maxScores: maximumDailyScores });
  if (quotaReservation.limited) return quotaReservation;

  const primaryName = normalizeScalar(process.env.AI_SST_GEMINI_MODEL) || DEFAULT_MODEL;
  const fallbackName = normalizeScalar(process.env.AI_SST_GEMINI_FALLBACK_MODEL) || FALLBACK_MODEL;
  const primaryLocation = normalizeScalar(process.env.AI_SST_VERTEX_LOCATION) || DEFAULT_VERTEX_LOCATION;
  const fallbackLocation = normalizeScalar(process.env.AI_SST_FALLBACK_VERTEX_LOCATION) || primaryLocation;
  const primary = getGeminiModel({
    modelName: primaryName,
    location: primaryLocation,
    generationConfig: JSON_GENERATION_CONFIG
  });
  const fallback = getGeminiModel({
    modelName: fallbackName,
    location: fallbackLocation,
    generationConfig: JSON_GENERATION_CONFIG
  });
  const prompt = buildPrompt({ summaryText, sourceText: transcript, mainPoints: safePoints });
  let parsed;
  let rawText = '';

  try {
    const response = await primary.generateContent(prompt);
    rawText = await extractGeneratedText(response);
    parsed = extractJsonObject(rawText);
  } catch (error) {
    if (!shouldUseGeminiFallback(error)) {
      console.error('scoreSST Gemini primary failed:', {
        uid,
        questionId: normalizeScalar(questionId),
        errorMessage: error?.message || String(error),
        rawResponse: rawText ? truncateForLog(rawText) : undefined
      });
      await releaseDailySSTScore(userRef, { today });
      throw new HttpsError('internal', 'AI practice feedback failed');
    }
    try {
      const response = await fallback.generateContent(prompt);
      rawText = await extractGeneratedText(response);
      parsed = extractJsonObject(rawText);
    } catch (fallbackError) {
      console.error('scoreSST Gemini fallback failed:', {
        uid,
        questionId: normalizeScalar(questionId),
        errorMessage: fallbackError?.message || String(fallbackError),
        rawResponse: rawText ? truncateForLog(rawText) : undefined
      });
      await releaseDailySSTScore(userRef, { today });
      throw new HttpsError('internal', 'AI practice feedback failed');
    }
  }

  return {
    success: true,
    questionId: normalizeScalar(questionId),
    ...applyDeterministicFormScore(normalizeResult(parsed), summaryText)
  };
});

module.exports = {
  scoreSST,
  _private: {
    applyDeterministicFormScore,
    buildPrompt,
    isSummaryEligibleForAi,
    normalizeResult,
    releaseDailySSTScore,
    reserveDailySSTScore,
    scoreSSTForm
  }
};
