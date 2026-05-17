/**
 * scoreSWT - Rubric-based Summarize Written Text scoring using Gemini (Vertex AI)
 *
 * Notes:
 * - Auth required (hybrid access): guests can use basic feedback, scoring requires login.
 * - Per-user daily quota is enforced via users/{uid}.aiSWTScoreStats.
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

// ── Embedded SWT Rubric (server-side, not sent from client) ──
const SWT_RUBRIC = `Content:
4
• The summary captures ALL main points of the passage accurately.
• Main ideas are expressed clearly and precisely, demonstrating full understanding of the source text.
• Appropriate paraphrasing is used throughout; the response does not copy directly from the source text.
3
• The summary captures MOST main points of the passage.
• Main ideas are generally expressed clearly, with minor omissions or inaccuracies.
• Some effective paraphrasing is present, though occasional direct copying may occur.
2
• The summary captures SOME main points of the passage.
• Some main ideas are present, but significant points are omitted or inaccurately represented.
• Limited paraphrasing; relies noticeably on language from the source text.
1
• The summary captures FEW main points of the passage.
• Only one or two relevant ideas are included. Most key points are missed entirely.
• Minimal or no paraphrasing; largely copies phrases directly from the source text.
0
• The summary does not capture any main points of the passage, OR the response is irrelevant to the passage, OR no response is provided.
Form:
1
• The response is written as ONE single, complete sentence.
• The sentence begins with an uppercase letter and ends with a period (full stop).
• The word count is between 5 and 75 words inclusive.
0
• The response contains more than one sentence, OR is not a complete sentence (e.g., a fragment or list).
• The word count is fewer than 5 words or more than 75 words.
• The response is written entirely in capital letters, contains no punctuation, or consists only of bullet points.
Grammar:
2 Shows consistent grammatical control of complex language. Errors are rare and difficult to spot.
1 Shows a relatively high degree of grammatical control. No mistakes which would lead to misunderstandings.
0 Contains mainly simple structures and/or several basic mistakes.
Vocabulary:
2 Good command of a broad lexical repertoire, idiomatic expressions and colloquialisms.
1 Shows a good range of vocabulary for matters connected to general academic topics. Lexical shortcomings lead to circumlocution or some imprecision.
0 Contains mainly basic vocabulary insufficient to deal with the topic at the required level.`;

function safeInt(n, { min = 0, max = 0 } = {}) {
  const num = Number(n);
  if (!Number.isFinite(num)) return min;
  const rounded = Math.round(num);
  return Math.max(min, Math.min(max, rounded));
}

function getWordCount(text) {
  return normalizeScalar(text).split(/\s+/).filter(Boolean).length;
}

function isAllCaps(text) {
  const letters = normalizeScalar(text).match(/[A-Za-z]/g) || [];
  if (letters.length < 4) return false;
  return letters.some(ch => ch >= 'A' && ch <= 'Z') && !letters.some(ch => ch >= 'a' && ch <= 'z');
}

function hasAlphabeticLetter(text) {
  return /[A-Za-z]/.test(normalizeScalar(text));
}

function startsWithUppercaseLetter(text) {
  const firstLetter = normalizeScalar(text).match(/[A-Za-z]/);
  return Boolean(firstLetter && firstLetter[0] === firstLetter[0].toUpperCase());
}

function maskNonSentencePeriods(text) {
  const abbreviationPattern = /\b(?:Mr|Mrs|Ms|Dr|Prof|Jr|Sr|St|No|vs|etc|approx|dept|govt|Inc|Corp|Ltd|U\.S\.A|U\.S|U\.K|e\.g|i\.e)\./gi;
  return normalizeScalar(text)
    .replace(/\b\d+\.\d+\b/g, match => match.replace(/\./g, ''))
    .replace(/\b(?:[A-Z]\.){2,}/g, match => match.replace(/\./g, ''))
    .replace(/\b[A-Z][a-z]?\.(?:[A-Z][a-z]?\.)+/g, match => match.replace(/\./g, ''))
    .replace(/\b(?:U\.S\.A|U\.S|U\.K|e\.g|i\.e)\b\.?/gi, match => match.replace(/\./g, ''))
    .replace(abbreviationPattern, match => match.replace(/\./g, ''));
}

function scoreSWTForm(text) {
  const trimmed = normalizeScalar(text);
  if (!trimmed) return { score: 0, rationale: 'No text submitted.' };

  const wordCount = getWordCount(trimmed);
  if (wordCount < 5) return { score: 0, rationale: `Too few words (${wordCount}). Minimum is 5.` };
  if (wordCount > 75) return { score: 0, rationale: `Too many words (${wordCount}). Maximum is 75.` };
  if (isAllCaps(trimmed)) return { score: 0, rationale: 'Written entirely in capital letters.' };
  if (!hasAlphabeticLetter(trimmed)) return { score: 0, rationale: 'Response must contain alphabetic words.' };
  if (!startsWithUppercaseLetter(trimmed)) return { score: 0, rationale: 'Sentence should begin with an uppercase letter.' };
  if (/\n/.test(trimmed) || /(^|\n)\s*(?:[-•*]|\d+[.)])\s/.test(trimmed)) {
    return { score: 0, rationale: 'Response contains line breaks, bullet points, or a numbered list.' };
  }
  if (!/\.$/.test(trimmed)) return { score: 0, rationale: 'Sentence must end with a full stop.' };

  const sentenceBody = trimmed.slice(0, -1);
  if (/[.!?]/.test(maskNonSentencePeriods(sentenceBody))) {
    return { score: 0, rationale: 'Multiple sentences or extra sentence-ending punctuation detected.' };
  }

  return { score: 1, rationale: 'Written as one complete sentence within the required word range.' };
}

function getSWTFormBlockingReason(text) {
  const form = scoreSWTForm(text);
  return form.score === 0 ? form.rationale : '';
}

function buildPrompt({ summaryText, sourceText, mainPoints, rubricText }) {
  const schema = `
Return raw JSON only. Do NOT wrap in markdown.
JSON schema:
{
  "scores": {
    "content": { "score": 0, "max": 4, "rationale": "string", "evidence": ["string"], "fixTips": ["string"] },
    "form": { "score": 0, "max": 1, "rationale": "string", "evidence": ["string"], "fixTips": ["string"] },
    "grammar": { "score": 0, "max": 2, "rationale": "string", "evidence": ["string"], "fixTips": ["string"] },
    "vocabulary": { "score": 0, "max": 2, "rationale": "string", "evidence": ["string"], "fixTips": ["string"] }
  },
  "mainPointsAnalysis": {
    "identified": ["string"],
    "missed": ["string"],
    "paraphrasingQuality": "string"
  },
  "teacherAdviceChat": "string"
}`;

  const rubric = normalizeScalar(rubricText);
  const source = normalizeScalar(sourceText);
  const summary = normalizeScalar(summaryText);
  const mpList = Array.isArray(mainPoints) && mainPoints.length > 0
    ? mainPoints.map((p, i) => `${i + 1}. ${normalizeScalar(p)}`).join('\n')
    : '(Main points not provided — infer them from the source text.)';

  return [
    schema,
    '',
    'Task: You are a strict, fair PTE Summarize Written Text (SWT) examiner and a helpful teacher.',
    'Score the summary using ONLY the rubric text provided below.',
    'Rules:',
    '- The summary MUST be ONE single sentence between 5 and 75 words. If it is not, Form = 0.',
    '- Count all sentences. If there is more than one sentence, Form = 0.',
    '- Use the score ranges exactly (integers only).',
    '- Evidence must quote exact short phrases from the summary (max 2 quotes per criterion, each <= 18 words).',
    '- fixTips must be actionable and specific (max 4 per criterion, each <= 18 words).',
    '- mainPointsAnalysis.identified: list the main points the summary successfully captures.',
    '- mainPointsAnalysis.missed: list important main points the summary fails to mention.',
    '- mainPointsAnalysis.paraphrasingQuality: assess how well the student paraphrased vs copied.',
    '- teacherAdviceChat: 5-9 short bullet points plus a 1-week practice plan in 3 lines.',
    '',
    'Rubric text:',
    rubric.slice(0, 10000),
    '',
    'Source passage:',
    source.slice(0, 8000),
    '',
    'Expected main points of the passage:',
    mpList.slice(0, 3000),
    '',
    'Learner summary:',
    summary.slice(0, 1500)
  ].join('\n');
}

function normalizeResult(json) {
  const maxByKey = {
    content: 4,
    form: 1,
    grammar: 2,
    vocabulary: 2
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

  // Main points analysis
  const mpRaw = json?.mainPointsAnalysis && typeof json.mainPointsAnalysis === 'object'
    ? json.mainPointsAnalysis : {};
  const mainPointsAnalysis = {
    identified: Array.isArray(mpRaw.identified) ? mpRaw.identified.map(x => normalizeScalar(x)).filter(Boolean).slice(0, 10) : [],
    missed: Array.isArray(mpRaw.missed) ? mpRaw.missed.map(x => normalizeScalar(x)).filter(Boolean).slice(0, 10) : [],
    paraphrasingQuality: normalizeScalar(mpRaw.paraphrasingQuality).slice(0, 500)
  };

  return {
    scores,
    overall: { total, maxTotal, percent },
    mainPointsAnalysis,
    teacherAdviceChat
  };
}

function recomputeOverall(scores) {
  const keys = ['content', 'form', 'grammar', 'vocabulary'];
  const total = keys.reduce((sum, key) => sum + safeInt(scores?.[key]?.score, { min: 0, max: scores?.[key]?.max || 0 }), 0);
  const maxTotal = keys.reduce((sum, key) => sum + safeInt(scores?.[key]?.max, { min: 0, max: 10 }), 0);
  const percent = maxTotal > 0 ? Math.round((total / maxTotal) * 100) : 0;
  return { total, maxTotal, percent };
}

function applyDeterministicFormScore(normalized, summaryText) {
  const form = scoreSWTForm(summaryText);
  normalized.scores.form = {
    score: form.score,
    max: 1,
    rationale: form.rationale,
    evidence: [],
    fixTips: form.score === 1 ? [] : ['Write exactly one sentence of 5-75 words ending with a full stop.']
  };
  normalized.overall = recomputeOverall(normalized.scores);
  return normalized;
}

async function reserveDailySWTScore(userRef, { today, maxScores }) {
  return db.runTransaction(async (tx) => {
    const userDoc = await tx.get(userRef);
    const userData = userDoc.data() || {};
    let stats = userData.aiSWTScoreStats || { lastDate: '', count: 0 };
    if (stats.lastDate !== today) stats = { lastDate: today, count: 0 };

    if ((stats.count || 0) >= maxScores) {
      return {
        limited: true,
        message: `You have used your ${maxScores} AI SWT scorings for today.`
      };
    }

    tx.set(userRef, {
      aiSWTScoreStats: {
        lastDate: today,
        count: (stats.count || 0) + 1
      }
    }, { merge: true });

    return { limited: false };
  });
}

async function releaseDailySWTScore(userRef, { today }) {
  try {
    await db.runTransaction(async (tx) => {
      const userDoc = await tx.get(userRef);
      const userData = userDoc.data() || {};
      const stats = userData.aiSWTScoreStats || { lastDate: '', count: 0 };
      if (stats.lastDate !== today || !stats.count) return;

      tx.set(userRef, {
        aiSWTScoreStats: {
          lastDate: today,
          count: Math.max(0, (stats.count || 0) - 1)
        }
      }, { merge: true });
    });
  } catch (error) {
    console.warn('scoreSWT quota release failed:', error?.message || String(error));
  }
}

const scoreSWT = onCall({ maxInstances: 10 }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }

  const uid = request.auth.uid;
  const { text, sourceText, mainPoints } = request.data || {};

  const summaryText = normalizeScalar(text);
  const safeSourceText = normalizeScalar(sourceText);
  const safeMainPoints = Array.isArray(mainPoints) ? mainPoints : [];

  if (!summaryText || summaryText.length < 5) {
    throw new HttpsError('invalid-argument', 'Summary text is required (min 5 chars).');
  }
  if (summaryText.length > 1500) {
    throw new HttpsError('invalid-argument', 'Summary text is too long (max 1500 chars).');
  }
  if (!safeSourceText || safeSourceText.length < 50) {
    throw new HttpsError('invalid-argument', 'Source text is required (min 50 chars).');
  }

  const formBlockingReason = getSWTFormBlockingReason(summaryText);
  if (formBlockingReason) {
    throw new HttpsError('invalid-argument', `Summary does not meet SWT form requirements: ${formBlockingReason}`);
  }

  const MAX_FREE_SCORES = Math.max(1, Number(process.env.AI_SWT_MAX_DAILY || '10') || 10);
  const userRef = db.collection('users').doc(uid);
  const today = new Date().toISOString().split('T')[0];
  const quotaReservation = await reserveDailySWTScore(userRef, {
    today,
    maxScores: MAX_FREE_SCORES
  });
  if (quotaReservation.limited) return quotaReservation;

  const primaryModelName = normalizeScalar(process.env.AI_SWT_GEMINI_MODEL) || DEFAULT_MODEL;
  const fallbackModelName = normalizeScalar(process.env.AI_SWT_GEMINI_FALLBACK_MODEL) || FALLBACK_MODEL;
  const primaryLocation = normalizeScalar(process.env.AI_SWT_VERTEX_LOCATION) || DEFAULT_VERTEX_LOCATION;
  const fallbackLocation = normalizeScalar(process.env.AI_SWT_FALLBACK_VERTEX_LOCATION) || primaryLocation;
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
  const prompt = buildPrompt({
    summaryText,
    sourceText: safeSourceText,
    mainPoints: safeMainPoints,
    rubricText: SWT_RUBRIC
  });

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
      console.error('scoreSWT Gemini primary failed:', {
        uid,
        errorMessage: error?.message || String(error),
        rawResponse: typeof error?.rawResponse === 'string' ? truncateForLog(error.rawResponse) : undefined
      });
      await releaseDailySWTScore(userRef, { today });
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
      console.error('scoreSWT Gemini fallback failed:', {
        uid,
        errorMessage: fallbackError?.message || String(fallbackError),
        rawResponse: typeof fallbackError?.rawResponse === 'string' ? truncateForLog(fallbackError.rawResponse) : undefined
      });
      await releaseDailySWTScore(userRef, { today });
      throw new HttpsError('internal', 'AI scoring failed');
    }
  }

  const normalized = applyDeterministicFormScore(normalizeResult(json), summaryText);

  return {
    success: true,
    ...normalized
  };
});

module.exports = {
  scoreSWT,
  _private: {
    applyDeterministicFormScore,
    getSWTFormBlockingReason,
    normalizeResult,
    scoreSWTForm
  }
};
