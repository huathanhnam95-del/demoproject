const express = require('express');
const crypto = require('crypto');
const https = require('https');
/* eslint-disable no-console */

const { db } = require('../utils/firebase');
const aiClient = require('../utils/ai-client');
const { sendError, sendSuccess } = require('../utils/response-helper');
const { createBreaker } = require('../middleware/circuit-breaker');
const { withRetry } = require('../utils/retry');
const authUserMiddleware = require('../middleware/auth-user');

const router = express.Router();

const BREAKER_OPTIONS = {
  timeout: 30000,
  errorThresholdPercentage: 50,
  resetTimeout: 30000,
  volumeThreshold: 5
};

const hfBreaker = createBreaker('huggingface-ai', BREAKER_OPTIONS);
hfBreaker.fallback(() => ({
  data: { choices: [{ message: { content: null } }] },
  _circuitOpen: true
}));

const hfStreamBreaker = createBreaker('huggingface-ai-stream', {
  ...BREAKER_OPTIONS,
  timeout: 65000
});
hfStreamBreaker.fallback(() => ({
  _circuitOpen: true
}));

function writeSse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

router.post('/ai-proxy', async (req, res) => {
  const { prompt, model = 'meta-llama/Llama-3.1-8B-Instruct', max_tokens = 150 } = req.body;
  const apiKey = process.env.HUGGINGFACE_API_KEY;

  if (!apiKey || apiKey.startsWith('PLACEHOLDER')) {
    return sendError(res, 500, 'CONFIG_ERROR', 'Server configuration error: Missing API Key');
  }

  if (max_tokens > 500) {
    return sendError(res, 400, 'LIMIT_EXCEEDED', 'max_tokens must be <= 500');
  }

  const shaKey = crypto.createHash('sha256').update(`prompt:${prompt}-model:${model}-len:${max_tokens}`).digest('hex');
  const md5Key = crypto.createHash('md5').update(`prompt:${prompt}-model:${model}-len:${max_tokens}`).digest('hex');

  if (db) {
    try {
      let cacheDoc = await db.collection('ai_cache').doc(shaKey).get();
      if (!cacheDoc.exists) {
        cacheDoc = await db.collection('ai_cache').doc(md5Key).get();
      }

      if (cacheDoc.exists) {
        const data = cacheDoc.data();
        if (data.expires > Date.now()) {
          console.log('[AI-Cache] HIT', cacheDoc.id);
          return sendSuccess(res, { generated_text: data.text, fallback: false, fromCache: true });
        }
      }
    } catch (e) {
      console.warn('[AI-Cache] Read failed:', e.message);
    }
  }

  try {
    const response = await hfBreaker.fire(async () => withRetry(() => aiClient.post('', {
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens,
      temperature: 0.7
    }, {
      headers: { Authorization: `Bearer ${apiKey}` }
    }), { maxRetries: 2, baseDelay: 1000 }));

    if (response._circuitOpen) {
      return sendError(
        res,
        503,
        'AI_UNAVAILABLE',
        'AI assistance is temporarily unavailable due to high demand. Please try again shortly.',
        { fallback: true }
      );
    }

    const generatedText = response.data.choices[0].message.content;

    if (db) {
      db.collection('ai_cache').doc(shaKey).set({
        text: generatedText,
        expires: Date.now() + (7 * 24 * 60 * 60 * 1000),
        created: Date.now()
      }).catch((e) => console.warn('[AI-Cache] Write failed:', e.message));
    }

    return sendSuccess(res, { generated_text: generatedText, fallback: false });
  } catch (error) {
    console.error('[AI-Proxy] Service Error:', error.message);
    const status = error.response ? error.response.status : 503;
    return sendError(
      res,
      status,
      'AI_ERROR',
      'AI service is currently experiencing issues. Please try again in a moment.',
      { details: error.message, fallback: true }
    );
  }
});

router.post('/ai-feedback-stream', async (req, res) => {
  const { prompt, model = 'meta-llama/Llama-3.1-8B-Instruct' } = req.body;
  const apiKey = process.env.HUGGINGFACE_API_KEY;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  if (!apiKey || apiKey.startsWith('PLACEHOLDER')) {
    writeSse(res, { error: 'AI config missing', fallback: true });
    return res.end();
  }

  try {
    const response = await hfStreamBreaker.fire(() => new Promise((resolve, reject) => {
      const postData = JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 200,
        temperature: 0.7,
        stream: true
      });

      const options = {
        hostname: 'router.huggingface.co',
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'text/event-stream'
        },
        timeout: 60000,
        family: 4
      };

      const hfReq = https.request(options, (hfRes) => {
        if (hfRes.statusCode !== 200) {
          const error = new Error(`Stream failed with status ${hfRes.statusCode}`);
          error.statusCode = hfRes.statusCode;
          hfRes.resume();
          reject(error);
          return;
        }

        hfRes.on('data', (chunk) => res.write(chunk));
        hfRes.on('end', () => {
          res.end();
          resolve({ streamed: true });
        });
        hfRes.on('error', reject);
      });

      hfReq.on('error', reject);
      hfReq.on('timeout', () => {
        hfReq.destroy(new Error('Stream timed out'));
      });

      hfReq.write(postData);
      hfReq.end();
    }));

    if (response && response._circuitOpen) {
      writeSse(res, {
        error: 'AI assistance is temporarily unavailable due to high demand. Please try again shortly.',
        fallback: true
      });
      return res.end();
    }

    return undefined;
  } catch (error) {
    writeSse(res, {
      error: 'AI service is currently experiencing issues. Please try again in a moment.',
      details: error.message,
      fallback: true
    });
    return res.end();
  }
});

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

async function callOllama({ baseUrl, model, prompt, timeoutMs = 15000 }) {
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
        messages: [
          { role: 'system', content: 'Return only valid JSON.' },
          { role: 'user', content: prompt }
        ],
        options: {
          temperature: 0.2,
          num_predict: 500
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

function tryParseJson(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_err) {
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

function buildRopCritiquePrompt({ correctSequence, userSequence, paragraphs }) {
  const formattedParas = Object.entries(paragraphs)
    .map(([key, text]) => `Paragraph ${key}: "${text}"`)
    .join('\n');

  return [
    'You are an expert English language tutor specializing in the PTE Academic reading section, specifically "Re-order Paragraphs".',
    'Compare the user\'s submitted sequence with the correct sequence and provide a helpful, constructive, and concise critique pointing out the transition mistakes in the user\'s order.',
    'Return a JSON object with a single key "critique" containing your explanation.',
    'Keep your critique clear, polite, and under 120 words.',
    '',
    'Paragraphs:',
    formattedParas,
    '',
    `Correct Order: ${correctSequence.join(' -> ')}`,
    `User's Order: ${userSequence.join(' -> ')}`
  ].join('\n');
}

router.post('/rop/explain-order', authUserMiddleware, async (req, res) => {
  try {
    const { correctSequence, userSequence, paragraphs } = req.body;

    if (!Array.isArray(correctSequence) || !Array.isArray(userSequence) || !paragraphs || typeof paragraphs !== 'object') {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Missing or invalid parameters: correctSequence, userSequence, paragraphs.');
    }

    if (correctSequence.length > 20 || userSequence.length > 20 || Object.keys(paragraphs).length > 20) {
      return sendError(res, 400, 'LIMIT_EXCEEDED', 'Too many paragraphs. Max is 20.');
    }

    const { baseUrl, model } = getOllamaConfig();
    const prompt = buildRopCritiquePrompt({ correctSequence, userSequence, paragraphs });

    const startedAt = Date.now();
    const ollamaResponse = await callOllama({ baseUrl, model, prompt, timeoutMs: 15000 });
    const elapsedMs = Date.now() - startedAt;

    const parsed = tryParseJson(ollamaResponse.content);
    if (!parsed || typeof parsed !== 'object' || typeof parsed.critique !== 'string') {
      return sendError(res, 502, 'AI_BAD_RESPONSE', 'Ollama returned an invalid critique response format.');
    }

    return sendSuccess(res, {
      critique: parsed.critique,
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

    console.error('[ROP] Explain-order error:', message);
    return sendError(res, 503, 'AI_UNAVAILABLE', 'AI tutor is currently offline or unavailable. Please try again later.', message);
  }
});

module.exports = router;
