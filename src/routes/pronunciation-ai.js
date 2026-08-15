const express = require('express');
const { VertexAI } = require('@google-cloud/vertexai');
const { sendError, sendSuccess } = require('../utils/response-helper');
/* eslint-disable no-console */

const router = express.Router();

const DEFAULT_PRIMARY_MODEL = 'gemini-3-flash-preview';
const DEFAULT_FALLBACK_MODEL = 'gemini-3.1-flash-lite';
const DEFAULT_LOCATION = 'global';

let cachedVertexClient = null;
const modelCache = new Map();

function normalizeScalar(value) {
  return String(value ?? '').trim();
}

function getProjectId() {
  return normalizeScalar(process.env.FIREBASE_PROJECT_ID)
    || normalizeScalar(process.env.GOOGLE_CLOUD_PROJECT)
    || normalizeScalar(process.env.GCLOUD_PROJECT)
    || normalizeScalar(process.env.GCP_PROJECT);
}

function getVertexClient(customLocation) {
  if (cachedVertexClient) return cachedVertexClient;
  const project = getProjectId();
  const location = normalizeScalar(customLocation)
    || normalizeScalar(process.env.AI_PRONOUNCE_VERTEX_LOCATION)
    || normalizeScalar(process.env.GOOGLE_CLOUD_LOCATION)
    || DEFAULT_LOCATION;

  if (!project) {
    throw new Error('Missing Google Cloud Project ID for Vertex AI.');
  }

  cachedVertexClient = new VertexAI({ project, location });
  return cachedVertexClient;
}

function getGenerativeModel(modelName, options = {}) {
  const safeName = normalizeScalar(modelName) || DEFAULT_PRIMARY_MODEL;
  const cacheKey = `${safeName}:${options.location || ''}`;
  if (modelCache.has(cacheKey)) {
    return modelCache.get(cacheKey);
  }

  const client = getVertexClient(options.location);
  const model = client.getGenerativeModel({
    model: safeName,
    generationConfig: {
      maxOutputTokens: 300,
      temperature: 0.7,
      topP: 0.9
    }
  });

  modelCache.set(cacheKey, model);
  return model;
}

function cleanGeneratedSummary(text) {
  if (!text) return '';
  return String(text)
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/^#+\s*/gm, '')
    .trim();
}

function buildPrompt(word, comparison, userSyllables, ipa) {
  const syllableInfo = (Array.isArray(userSyllables) ? userSyllables : [])
    .map((s, i) =>
      `Syllable ${i + 1}: duration=${(s.duration || 0).toFixed(3)}s, pitch=${s.maxPitch ? Math.round(s.maxPitch) + 'Hz' : 'undetected'}`
    ).join(', ');

  return `You are a friendly English pronunciation coach giving brief feedback to a student who just practiced saying "${word}" (IPA: ${ipa}).

Here are their scores compared to a native speaker:
- Overall: ${comparison.overallScore || 0}%
- Pitch accuracy: ${comparison.pitchScore || 0}%
- Duration/rhythm: ${comparison.durationScore || 0}%
- Volume/stress: ${comparison.intensityScore || 0}%
- Stress pattern match: ${comparison.stressMatches ? 'correct' : 'incorrect — ' + (comparison.stressFeedback || 'wrong syllable stressed')}
${comparison.syllableCountMatches === false ? `- They pronounced ${userSyllables.length} syllables instead of the expected count` : ''}
- Their syllables: ${syllableInfo}

Write a 2-3 sentence summary that:
1. Starts with encouragement (not generic — reference their specific strengths)
2. Points out the ONE most important thing to improve, explained simply
3. Uses casual, warm teacher language (like talking to a friend)

Keep it under 60 words. Do NOT use bullet points, emojis, or formatting. Just plain conversational text.`;
}

async function generateAiSummary(prompt, clientOptions = {}) {
  const primaryModelName = normalizeScalar(process.env.AI_PRONOUNCE_GEMINI_MODEL) || DEFAULT_PRIMARY_MODEL;
  const fallbackModelName = normalizeScalar(process.env.AI_PRONOUNCE_GEMINI_FALLBACK_MODEL) || DEFAULT_FALLBACK_MODEL;

  try {
    const model = clientOptions.modelOverride || getGenerativeModel(primaryModelName);
    const response = await model.generateContent(prompt);
    const text = response?.response?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (text) {
      return { summary: cleanGeneratedSummary(text), model: primaryModelName, source: 'vertex-ai' };
    }
  } catch (err) {
    console.warn(`[Pronunciation-AI] Primary Vertex AI model (${primaryModelName}) failed:`, err.message || err);

    if (fallbackModelName && fallbackModelName !== primaryModelName && !clientOptions.modelOverride) {
      try {
        const fallbackModel = getGenerativeModel(fallbackModelName);
        const response = await fallbackModel.generateContent(prompt);
        const text = response?.response?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          return { summary: cleanGeneratedSummary(text), model: fallbackModelName, source: 'vertex-ai-fallback' };
        }
      } catch (fallbackErr) {
        console.warn(`[Pronunciation-AI] Fallback Vertex AI model (${fallbackModelName}) failed:`, fallbackErr.message || fallbackErr);
      }
    }
    throw err;
  }

  return { summary: null, source: 'empty_response' };
}

/**
 * POST /api/pronunciation-ai/summary
 * Generates an AI pronunciation coaching summary using Google Cloud Vertex AI.
 */
router.post('/pronunciation-ai/summary', async (req, res) => {
  const { word, comparison, userSyllables, ipa } = req.body || {};

  if (!word || !comparison) {
    return sendError(res, 400, 'INVALID_INPUT', 'Missing word or comparison data.');
  }

  const prompt = buildPrompt(word, comparison, userSyllables || [], ipa || 'unknown');

  try {
    const result = await generateAiSummary(prompt);
    return sendSuccess(res, result);
  } catch (err) {
    console.warn('[Pronunciation-AI] Summary generation error:', err.message || err);
    return sendSuccess(res, { summary: null, source: 'error', error: err.message || 'Generation failed' });
  }
});

module.exports = router;
module.exports.buildPrompt = buildPrompt;
module.exports.cleanGeneratedSummary = cleanGeneratedSummary;
module.exports.generateAiSummary = generateAiSummary;
