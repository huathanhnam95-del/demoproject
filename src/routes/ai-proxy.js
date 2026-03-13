const express = require('express');
const crypto = require('crypto');
const https = require('https');
/* eslint-disable no-console */

const { db } = require('../utils/firebase');
const aiClient = require('../utils/ai-client');
const { sendError, sendSuccess } = require('../utils/response-helper');
const { createBreaker } = require('../middleware/circuit-breaker');
const { withRetry } = require('../utils/retry');

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

module.exports = router;
