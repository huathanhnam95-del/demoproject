const express = require('express');
/* eslint-disable no-console */

const authUserMiddleware = require('../middleware/auth-user');
const { sendError, sendSuccess } = require('../utils/response-helper');

const router = express.Router();

function isLocalhostHostname(hostname) {
  const h = String(hostname || '').trim().toLowerCase();
  if (!h) return false;
  return h === 'localhost' || h === '127.0.0.1' || h === '::1';
}

function isLocalhostUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return isLocalhostHostname(url.hostname);
  } catch (_err) {
    return false;
  }
}

function getOllamaConfig() {
  const baseUrl = String(process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/+$/, '');
  const model = String(process.env.OLLAMA_MODEL || 'gemma4:latest').trim();
  const allowRemote = String(process.env.ALLOW_REMOTE_OLLAMA || '').trim() === '1';

  if (!baseUrl) {
    throw new Error('Missing OLLAMA_BASE_URL.');
  }
  if (!model) {
    throw new Error('Missing OLLAMA_MODEL.');
  }

  if (!allowRemote && !isLocalhostUrl(baseUrl)) {
    throw new Error('OLLAMA_BASE_URL must be localhost unless ALLOW_REMOTE_OLLAMA=1.');
  }

  return { baseUrl, model };
}

function coerceInt(value, { min, max, fallback }) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  if (Number.isFinite(min) && n < min) return min;
  if (Number.isFinite(max) && n > max) return max;
  return n;
}

function normalizeCorrections(value) {
  const raw = Array.isArray(value) ? value : [];
  const out = [];

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const original = String(item.original || '').trim();
    const replacement = String(item.replacement || '').trim();
    const reason = String(item.reason || '').trim();
    if (!original || !replacement) continue;

    out.push({
      original: original.slice(0, 200),
      replacement: replacement.slice(0, 200),
      reason: reason.slice(0, 240)
    });

    if (out.length >= 8) break;
  }

  return out;
}

function tryParseJson(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_err) {
    // Best-effort: attempt to extract the first JSON object from the output.
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) {
      const slice = raw.slice(start, end + 1);
      try {
        return JSON.parse(slice);
      } catch (_err2) {
        return null;
      }
    }
    return null;
  }
}

async function callOllama({ baseUrl, model, prompt, timeoutMs = 45000 }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({
        model,
        stream: false,
        format: 'json',
        // Avoid setting `think:false` here: Gemma4 + Ollama has known issues where it can break JSON mode.
        messages: [
          { role: 'system', content: 'Return only valid JSON.' },
          { role: 'user', content: prompt }
        ],
        options: {
          temperature: 0.2,
          num_predict: 650
        }
      })
    });

    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const detail = data && typeof data === 'object'
        ? (data.error || data.message || JSON.stringify(data))
        : null;
      throw new Error(`Ollama HTTP ${res.status}${detail ? `: ${detail}` : ''}`);
    }

    if (!data || typeof data !== 'object') {
      throw new Error('Ollama returned an invalid response.');
    }

    const content = String(data.message?.content || '').trim();
    if (!content) {
      throw new Error('Ollama returned an empty response.');
    }

    return {
      model: String(data.model || model),
      content
    };
  } finally {
    clearTimeout(timeout);
  }
}

function buildEssayAssessmentPrompt({ promptText, essayText }) {
  const prompt = String(promptText || '').trim();
  const essay = String(essayText || '').trim();

  // Keep instructions short to avoid Gemma4 empty-response issues with long system prompts.
  return [
    'Evaluate this English essay for PTE Write Essay practice.',
    'Return JSON with keys: grammarScore (0|1|2), grammarDetail, corrections (array), review.',
    'Rubric: 2=rare errors; 1=minor errors no misunderstanding; 0=frequent basic errors.',
    'corrections: up to 8 items; each has original, replacement, reason (short snippets).',
    'review: 4-7 concise actionable sentences; do NOT include the full essay.',
    '',
    'Prompt:',
    prompt,
    '',
    'Essay:',
    essay
  ].join('\n');
}

router.post('/essay/assess', authUserMiddleware, async (req, res) => {
  try {
    const promptText = String(req.body?.promptText || '').trim();
    const essayText = String(req.body?.essayText || '').trim();

    if (!promptText) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Missing promptText.');
    }
    if (!essayText) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Missing essayText.');
    }

    // Hard safety limits: keep payloads small and predictable.
    if (essayText.length > 8000) {
      return sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'Essay exceeds the 8000 character limit.');
    }
    if (promptText.length > 1500) {
      return sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'Prompt exceeds the 1500 character limit.');
    }

    const { baseUrl, model } = getOllamaConfig();
    const prompt = buildEssayAssessmentPrompt({ promptText, essayText });
    const startedAt = Date.now();
    const ollamaResponse = await callOllama({ baseUrl, model, prompt });
    const elapsedMs = Date.now() - startedAt;

    const parsed = tryParseJson(ollamaResponse.content);
    if (!parsed || typeof parsed !== 'object') {
      return sendError(res, 502, 'AI_BAD_RESPONSE', 'Gemma4 returned an invalid JSON payload.');
    }

    const grammarScore = coerceInt(parsed.grammarScore, { min: 0, max: 2, fallback: -1 });
    const grammarDetail = String(parsed.grammarDetail || '').trim();
    const review = String(parsed.review || '').trim();
    const corrections = normalizeCorrections(parsed.corrections);

    if (grammarScore < 0 || !grammarDetail) {
      return sendError(res, 502, 'AI_BAD_RESPONSE', 'Gemma4 response missing grammarScore/grammarDetail.');
    }

    return sendSuccess(res, {
      result: {
        score: grammarScore,
        detail: grammarDetail,
        corrections,
        aiFeedback: review
      },
      meta: {
        model: ollamaResponse.model,
        latencyMs: elapsedMs
      }
    });
  } catch (error) {
    const message = error?.message || 'Unknown error';
    if (message.includes('OLLAMA_BASE_URL') || message.includes('OLLAMA_MODEL')) {
      return sendError(res, 500, 'AI_CONFIG_ERROR', message);
    }

    console.error('[Essay] assess error:', message);
    return sendError(res, 503, 'AI_UNAVAILABLE', 'AI tutor is unavailable. Please try again shortly.', message);
  }
});

module.exports = router;

