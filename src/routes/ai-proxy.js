const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const https = require('https');
const { db } = require('../utils/firebase');
const aiClient = require('../utils/ai-client');
const aiLimiter = require('../middleware/rate-limiter');
const { sendError, sendSuccess } = require('../utils/response-helper');

// --- AI Proxy Endpoint (Non-streaming) ---
router.post('/ai-proxy', aiLimiter, async (req, res) => {
    const { prompt, model = 'meta-llama/Llama-3.1-8B-Instruct', max_tokens = 150 } = req.body;
    const apiKey = process.env.HUGGINGFACE_API_KEY;

    if (!apiKey || apiKey.startsWith('PLACEHOLDER')) {
        return sendError(res, 500, 'CONFIG_ERROR', 'Server configuration error: Missing API Key');
    }

    // 1. Check Cache
    const shaKey = crypto.createHash('sha256').update(`prompt:${prompt}-model:${model}-len:${max_tokens}`).digest('hex');
    const md5Key = crypto.createHash('md5').update(`prompt:${prompt}-model:${model}-len:${max_tokens}`).digest('hex');

    if (db) {
        try {
            // Priority 1: SHA-256 (New standard)
            let cacheDoc = await db.collection('ai_cache').doc(shaKey).get();

            // Priority 2: MD5 (Legacy fallback)
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

    // Input Validation
    if (max_tokens > 500) {
        return sendError(res, 400, 'LIMIT_EXCEEDED', 'max_tokens must be <= 500');
    }

    try {
        const response = await aiClient.post('', {
            model,
            messages: [{ role: 'user', content: prompt }],
            max_tokens,
            temperature: 0.7
        }, {
            headers: { 'Authorization': `Bearer ${apiKey}` }
        });

        const generatedText = response.data.choices[0].message.content;

        // 2. Write to Cache
        if (db) {
            db.collection('ai_cache').doc(shaKey).set({
                text: generatedText,
                expires: Date.now() + (7 * 24 * 60 * 60 * 1000), // 7 days
                created: Date.now()
            }).catch(e => console.warn('[AI-Cache] Write failed:', e.message));
        }

        return sendSuccess(res, { generated_text: generatedText, fallback: false });

    } catch (error) {
        console.error('AI Service Error:', error.message);
        const status = error.response ? error.response.status : 500;
        return sendError(res, status, 'AI_ERROR', 'AI service unavailable', { details: error.message, fallback: true });
    }
});

// --- AI Feedback Stream Endpoint (SSE) ---
router.post('/ai-feedback-stream', aiLimiter, async (req, res) => {
    const { prompt, model = 'meta-llama/Llama-3.1-8B-Instruct' } = req.body;
    const apiKey = process.env.HUGGINGFACE_API_KEY;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    if (!apiKey || apiKey.startsWith('PLACEHOLDER')) {
        res.write(`data: ${JSON.stringify({ error: 'AI config missing', fallback: true })}\n\n`);
        return res.end();
    }

    try {
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
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData),
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/event-stream'
            },
            timeout: 60000,
            family: 4
        };

        const hfReq = https.request(options, (hfRes) => {
            if (hfRes.statusCode !== 200) {
                res.write(`data: ${JSON.stringify({ error: 'Stream failed', status: hfRes.statusCode })}\n\n`);
                return res.end();
            }
            hfRes.on('data', (chunk) => res.write(chunk));
            hfRes.on('end', () => res.end());
        });

        hfReq.on('error', (error) => {
            res.write(`data: ${JSON.stringify({ error: 'Stream failed', details: error.message })}\n\n`);
            res.end();
        });

        hfReq.write(postData);
        hfReq.end();

    } catch (error) {
        res.write(`data: ${JSON.stringify({ error: 'Internal error', details: error.message })}\n\n`);
        res.end();
    }
});

module.exports = router;
