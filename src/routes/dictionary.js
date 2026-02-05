const express = require('express');
const router = express.Router();
const { sendError, sendSuccess } = require('../utils/response-helper');
const {
    isCacheableKey,
    isValidTracauPayload,
    isFresh,
    saveToLocalDict,
    getFromLocalDict
} = require('../utils/cache-manager');

const inflight = new Map();

async function fetchTracauLive(wordLower) {
    if (inflight.has(wordLower)) return inflight.get(wordLower);

    const TRACAU_API_KEY = process.env.TRACAU_KEY;
    if (!TRACAU_API_KEY) {
        throw new Error('TRACAU_KEY missing in environment variables');
    }

    const url = `https://api.tracau.vn/${TRACAU_API_KEY}/s/${encodeURIComponent(wordLower)}/en`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    const p = fetch(url, {
        signal: controller.signal,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json'
        }
    })
        .then(r => {
            clearTimeout(timeout);
            if (!r.ok) throw new Error(`Tracau responded with ${r.status}`);
            return r.json();
        })
        .catch(err => {
            clearTimeout(timeout);
            throw err;
        })
        .finally(() => inflight.delete(wordLower));

    inflight.set(wordLower, p);
    return p;
}

router.get('/tracau', async (req, res) => {
    const { word } = req.query;
    if (!word) return sendError(res, 400, 'MISSING_WORD', 'Missing word parameter');

    const wordLower = String(word).toLowerCase().trim().replace(/^[^a-z'-]+|[^a-z'-]+$/g, '');

    if (!isCacheableKey(wordLower)) {
        return sendError(res, 400, 'INVALID_FORMAT', 'Use letters, hyphens, and apostrophes (1-30 chars).');
    }

    const cached = getFromLocalDict(wordLower);
    if (cached && isFresh(cached)) {
        return sendSuccess(res, { ...cached.data, fromCache: true });
    }

    try {
        const data = await fetchTracauLive(wordLower);
        if (isValidTracauPayload(data)) {
            saveToLocalDict(wordLower, data);
        }
        return sendSuccess(res, { ...data, fromCache: false, staleCache: !!cached });
    } catch (error) {
        if (cached && cached.data) {
            return sendSuccess(res, { ...cached.data, fromCache: true, stale: true });
        }
        return sendError(res, 500, 'API_ERROR', 'Dictionary service failed.', error.message);
    }
});

router.get('/tatoeba', async (req, res) => {
    try {
        const { word } = req.query;
        if (!word) return sendError(res, 400, 'MISSING_WORD', 'Missing word parameter');

        const backendUrl = 'https://pronunciation-api-891173754178.asia-southeast1.run.app';
        const url = `${backendUrl}/sentences/${encodeURIComponent(word)}`;

        const response = await fetch(url);
        if (!response.ok) {
            if (response.status === 404) return sendSuccess(res, { sentences: [] });
            throw new Error(`Tatoeba API responded with ${response.status}`);
        }

        const data = await response.json();
        return sendSuccess(res, data);
    } catch (error) {
        return sendSuccess(res, { sentences: [] }, 'Falling back to empty sentences');
    }
});

module.exports = router;
