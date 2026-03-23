const express = require('express');
const { sendError, sendSuccess } = require('../utils/response-helper');
/* eslint-disable no-console */

const router = express.Router();

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * POST /api/pronunciation-ai/summary
 * Proxies the Gemini API call for pronunciation AI summaries.
 * Keeps the API key server-side only.
 */
router.post('/pronunciation-ai/summary', async (req, res) => {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    return sendError(res, 500, 'CONFIG_ERROR', 'Gemini API key not configured.');
  }

  const { word, comparison, userSyllables, ipa } = req.body || {};

  if (!word || !comparison) {
    return sendError(res, 400, 'INVALID_INPUT', 'Missing word or comparison data.');
  }

  const prompt = buildPrompt(word, comparison, userSyllables || [], ipa || 'unknown');

  try {
    const url = `${GEMINI_API_BASE}/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 300,
          temperature: 0.7,
          topP: 0.9
        }
      })
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.warn(`[Pronunciation-AI] Gemini API error: ${response.status}`);
      return sendSuccess(res, { summary: null, source: 'api_error' });
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      return sendSuccess(res, { summary: null, source: 'empty_response' });
    }

    // Clean up markdown artifacts
    const cleaned = text
      .replace(/\*\*/g, '')
      .replace(/\*/g, '')
      .replace(/^#+\s*/gm, '')
      .trim();

    return sendSuccess(res, { summary: cleaned, source: 'gemini' });
  } catch (err) {
    if (err.name === 'AbortError') {
      console.warn('[Pronunciation-AI] Gemini API timeout');
    } else {
      console.warn('[Pronunciation-AI] Error:', err.message);
    }
    return sendSuccess(res, { summary: null, source: 'error' });
  }
});

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

module.exports = router;
