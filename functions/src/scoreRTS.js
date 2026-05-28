/**
 * scoreRTS - Rubric-based Respond To a Situation scoring using Gemini (Vertex AI)
 *
 * Scores the "Content" criterion (0–6) for RTS speaking responses.
 * Also generates Full and Simplified sample responses inline.
 *
 * Notes:
 * - Auth required: scoring requires login.
 * - Per-user daily quota is enforced via users/{uid}.aiRTSScoreStats.
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
  temperature: 0.3
};

// ── Embedded RTS Content Rubric (server-side) ──
const RTS_CONTENT_RUBRIC = `Content (Respond To a Situation) — Score 0 to 6:

6
• Response deals with the situation effectively. Successfully accomplishes the primary communication goal with full consideration of the context given in the prompt.
• Communicates with ease, flexibility, and precision throughout the response. Response is situationally appropriate and fully developed, expanding beyond the prompt language to provide a persuasive response.

5
• Response deals with the situation adequately. Successfully accomplishes the primary communication goal with some consideration of the context given in the prompt, with only minor omissions or misinterpretations.
• Communicates clearly and accurately with little restriction. Limitations only evident for difficult elements. A variety of situationally appropriate expressions are used to meet the demands of the situation adequately, with minimal inaccuracies.

4
• Response partially accomplishes the primary communication goal with some consideration of the context given in the prompt, with some omissions or misinterpretations.
• Communicates adequately, with some limitations of expression and minor inaccuracies. The range of expression is situationally appropriate and sufficient to meet most of the demands of the situation, with minimal inaccuracies.

3
• Response partially accomplishes the most basic aspect of the communication goal with some limited consideration of the context given in the prompt.
• Communication is functional, but range of expression is limited and contains some inaccuracies or situationally inappropriate elements. Response may include repetition of language from prompt without reformulation or context.

2
• Response contains some content relevant to the situation but does not achieve the primary communication goal or address the specifics of the context given in the prompt.
• Communication contains restrictions and inaccuracies that compromise meaning or is heavily reliant on using language from the prompt without reformulation or context.

1
• Response contains content relevant to the situation but does not achieve the primary communication goal or address the specifics of the context given in the prompt, showing a lack of understanding of the situation given in the prompt.
• Communication is significantly restricted, containing limitations and inaccuracies that impede meaning. The response repeats isolated words and phrases from the prompt but does not provide adequate context or meaning.
OR
• Minimally addresses the prompt by providing a situationally appropriate response that accomplishes primary goal of communication, but with no elaboration or support.

0
• Response is relevant to the prompt but too limited to assign a higher score.`;

// ── RTS Response Guidelines (from docx) ──
const RTS_RESPONSE_GUIDELINES = `Guidelines for Respond To a Situation responses:
1. Always speak in first person (I/me/my). You ARE the person in the situation.
2. Address the listener as "you" (the person you are talking to).
3. Identify the register:
   - FORMAL: lecturer, professor, tutor, manager, senior, team leader, boss, colleague
   - INFORMAL: classmates, students, roommate, friends, partner, club members, teammates
   - SERVICE: salesman, IT support, staff members, librarian, security officer
4. Structure your response:
   - Greet appropriately (formal: "Good morning, Professor" / informal: "Hey everyone")
   - Acknowledge the situation briefly
   - State your main point or request clearly
   - Provide supporting details or explanation
   - Close with a polite request or positive note
5. Speak naturally for 25-35 seconds. Expand beyond the prompt language.
6. Use situationally appropriate expressions and tone.`;

function safeInt(n, { min = 0, max = 0 } = {}) {
  const num = Number(n);
  if (!Number.isFinite(num)) return min;
  const rounded = Math.round(num);
  return Math.max(min, Math.min(max, rounded));
}

function buildPrompt({ transcript, situationText }) {
  const schema = `
Return raw JSON only. Do NOT wrap in markdown.
JSON schema:
{
  "scores": {
    "content": { "score": 0, "max": 6, "rationale": "string", "evidence": ["string"], "fixTips": ["string"] }
  },
  "sampleResponse": {
    "full": "string",
    "simplified": "string"
  },
  "responseAnalysis": {
    "register": "formal|informal|service",
    "communicationGoal": "string",
    "strengthPoints": ["string"],
    "improvementAreas": ["string"]
  },
  "teacherAdvice": "string"
}`;

  const safeSituation = normalizeScalar(situationText);
  const safeTranscript = normalizeScalar(transcript);

  return [
    schema,
    '',
    'Task: You are a strict, fair PTE Respond To a Situation examiner and a helpful speaking teacher.',
    'Score the spoken response transcript using ONLY the Content rubric provided below.',
    '',
    'Rules:',
    '- Use the score range 0-6 exactly (integers only).',
    '- Evidence must quote exact short phrases from the transcript (max 2 quotes, each <= 18 words).',
    '- fixTips must be actionable and specific (max 4, each <= 18 words).',
    '- sampleResponse.full: Write a model response (60-80 words) that would score 6/6. Use first person. Match the register.',
    '- sampleResponse.simplified: Write a simpler version (40-55 words) for lower-level learners. Still first person.',
    '- responseAnalysis.register: Identify whether the situation calls for formal, informal, or service register.',
    '- responseAnalysis.communicationGoal: Identify the primary communication goal (e.g., "apologize for delay", "request extension").',
    '- responseAnalysis.strengthPoints: 2-3 things the learner did well (or empty if score <= 1).',
    '- responseAnalysis.improvementAreas: 2-3 specific areas to improve.',
    '- teacherAdvice: 5-7 short bullet points with speaking tips, plus a 1-week practice plan in 3 lines.',
    '',
    'Content Rubric:',
    RTS_CONTENT_RUBRIC,
    '',
    'Response Guidelines:',
    RTS_RESPONSE_GUIDELINES,
    '',
    'Situation prompt shown to learner:',
    safeSituation.slice(0, 2000),
    '',
    'Learner spoken response transcript:',
    safeTranscript.slice(0, 3000)
  ].join('\n');
}

function normalizeResult(json) {
  const scoresIn = json?.scores && typeof json.scores === 'object' ? json.scores : {};
  const contentRaw = scoresIn.content && typeof scoresIn.content === 'object' ? scoresIn.content : {};

  const contentScore = safeInt(contentRaw.score, { min: 0, max: 6 });
  const evidence = Array.isArray(contentRaw.evidence)
    ? contentRaw.evidence.map((x) => normalizeScalar(x)).filter(Boolean).slice(0, 2) : [];
  const fixTips = Array.isArray(contentRaw.fixTips)
    ? contentRaw.fixTips.map((x) => normalizeScalar(x)).filter(Boolean).slice(0, 4) : [];
  const rationale = normalizeScalar(contentRaw.rationale) || '';

  const scores = {
    content: { score: contentScore, max: 6, rationale, evidence, fixTips }
  };

  const total = contentScore;
  const maxTotal = 6;
  const percent = maxTotal > 0 ? Math.round((total / maxTotal) * 100) : 0;

  // Sample responses
  const sampleRaw = json?.sampleResponse && typeof json.sampleResponse === 'object'
    ? json.sampleResponse : {};
  const sampleResponse = {
    full: normalizeScalar(sampleRaw.full).slice(0, 1500),
    simplified: normalizeScalar(sampleRaw.simplified).slice(0, 1000)
  };

  // Response analysis
  const analysisRaw = json?.responseAnalysis && typeof json.responseAnalysis === 'object'
    ? json.responseAnalysis : {};
  const responseAnalysis = {
    register: normalizeScalar(analysisRaw.register).slice(0, 50),
    communicationGoal: normalizeScalar(analysisRaw.communicationGoal).slice(0, 200),
    strengthPoints: Array.isArray(analysisRaw.strengthPoints)
      ? analysisRaw.strengthPoints.map(x => normalizeScalar(x)).filter(Boolean).slice(0, 3) : [],
    improvementAreas: Array.isArray(analysisRaw.improvementAreas)
      ? analysisRaw.improvementAreas.map(x => normalizeScalar(x)).filter(Boolean).slice(0, 3) : []
  };

  const teacherAdvice = normalizeScalar(json?.teacherAdvice || json?.teacherAdviceChat).slice(0, 1800);

  return {
    scores,
    overall: { total, maxTotal, percent },
    sampleResponse,
    responseAnalysis,
    teacherAdvice
  };
}

async function reserveDailyRTSScore(userRef, { today, maxScores }) {
  return db.runTransaction(async (tx) => {
    const userDoc = await tx.get(userRef);
    const userData = userDoc.data() || {};
    let stats = userData.aiRTSScoreStats || { lastDate: '', count: 0 };
    if (stats.lastDate !== today) stats = { lastDate: today, count: 0 };

    if ((stats.count || 0) >= maxScores) {
      return {
        limited: true,
        message: `You have used your ${maxScores} AI RTS scorings for today.`
      };
    }

    tx.set(userRef, {
      aiRTSScoreStats: {
        lastDate: today,
        count: (stats.count || 0) + 1
      }
    }, { merge: true });

    return { limited: false };
  });
}

async function releaseDailyRTSScore(userRef, { today }) {
  try {
    await db.runTransaction(async (tx) => {
      const userDoc = await tx.get(userRef);
      const userData = userDoc.data() || {};
      const stats = userData.aiRTSScoreStats || { lastDate: '', count: 0 };
      if (stats.lastDate !== today || !stats.count) return;

      tx.set(userRef, {
        aiRTSScoreStats: {
          lastDate: today,
          count: Math.max(0, (stats.count || 0) - 1)
        }
      }, { merge: true });
    });
  } catch (error) {
    console.warn('scoreRTS quota release failed:', error?.message || String(error));
  }
}

const scoreRTS = onCall({ maxInstances: 10, timeoutSeconds: 180 }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }

  const uid = request.auth.uid;
  const { transcript, situationText, questionId } = request.data || {};

  const safeTranscript = normalizeScalar(transcript);
  const safeSituationText = normalizeScalar(situationText);

  if (!safeTranscript || safeTranscript.length < 5) {
    throw new HttpsError('invalid-argument', 'Transcript is required (min 5 chars). Please speak clearly during recording.');
  }
  if (safeTranscript.length > 3000) {
    throw new HttpsError('invalid-argument', 'Transcript is too long (max 3000 chars).');
  }
  if (!safeSituationText || safeSituationText.length < 20) {
    throw new HttpsError('invalid-argument', 'Situation text is required.');
  }

  // Daily quota check
  const MAX_FREE_SCORES = Math.max(1, Number(process.env.AI_RTS_MAX_DAILY || '10') || 10);
  const userRef = db.collection('users').doc(uid);
  const today = new Date().toISOString().split('T')[0];

  const quotaResult = await reserveDailyRTSScore(userRef, {
    today,
    maxScores: MAX_FREE_SCORES
  });
  if (quotaResult.limited) return quotaResult;

  // Build models
  const primaryModelName = normalizeScalar(process.env.AI_RTS_GEMINI_MODEL) || DEFAULT_MODEL;
  const fallbackModelName = normalizeScalar(process.env.AI_RTS_GEMINI_FALLBACK_MODEL) || FALLBACK_MODEL;
  const primaryLocation = normalizeScalar(process.env.AI_RTS_VERTEX_LOCATION) || DEFAULT_VERTEX_LOCATION;
  const fallbackLocation = normalizeScalar(process.env.AI_RTS_FALLBACK_VERTEX_LOCATION) || primaryLocation;

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

  const prompt = buildPrompt({ transcript: safeTranscript, situationText: safeSituationText });

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
      console.error('scoreRTS Gemini primary failed:', {
        uid,
        questionId: questionId || '',
        errorMessage: error?.message || String(error),
        rawResponse: typeof error?.rawResponse === 'string' ? truncateForLog(error.rawResponse) : undefined
      });
      await releaseDailyRTSScore(userRef, { today });
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
      console.error('scoreRTS Gemini fallback failed:', {
        uid,
        questionId: questionId || '',
        errorMessage: fallbackError?.message || String(fallbackError),
        rawResponse: typeof fallbackError?.rawResponse === 'string' ? truncateForLog(fallbackError.rawResponse) : undefined
      });
      await releaseDailyRTSScore(userRef, { today });
      throw new HttpsError('internal', 'AI scoring failed');
    }
  }

  const normalized = normalizeResult(json);

  return {
    success: true,
    ...normalized
  };
});

module.exports = {
  scoreRTS
};
