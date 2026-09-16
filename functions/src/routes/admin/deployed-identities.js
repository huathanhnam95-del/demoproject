'use strict';

const crypto = require('node:crypto');

function header(req, name) {
    if (typeof req?.get === 'function') return req.get(name) || '';
    const headers = req?.headers || {};
    return headers[name.toLowerCase()] || headers[name] || '';
}

function tokensEqual(actual, expected) {
    const left = Buffer.from(String(actual || ''));
    const right = Buffer.from(String(expected || ''));
    return left.length > 0 && left.length === right.length && crypto.timingSafeEqual(left, right);
}

function setHeader(res, name, value) {
    if (typeof res?.setHeader === 'function') res.setHeader(name, value);
    else if (typeof res?.set === 'function') res.set(name, value);
}

function sendJson(res, statusCode, value) {
    if (typeof res?.status === 'function') return res.status(statusCode).json(value);
    res.statusCode = statusCode;
    return res.json(value);
}

function createDeployedIdentitiesRoute({ provider, token = process.env.BEL_DEPLOYED_IDENTITIES_TOKEN } = {}) {
    if (!provider || typeof provider.read !== 'function') throw new TypeError('provider.read is required');
    const expectedToken = String(token || '').trim();
    return async function deployedIdentitiesRoute(req, res) {
        setHeader(res, 'Cache-Control', 'no-store');
        setHeader(res, 'Pragma', 'no-cache');
        setHeader(res, 'Vary', 'Authorization, X-BEL-Request-Nonce');
        setHeader(res, 'X-Content-Type-Options', 'nosniff');

        if (!expectedToken) return sendJson(res, 503, { error: 'deployed identities unavailable' });
        if (header(req, 'origin')) return sendJson(res, 404, { error: 'not found' });
        const authorization = header(req, 'authorization');
        const suppliedToken = /^Bearer\s+([^\s]+)$/.exec(authorization)?.[1] || '';
        if (!tokensEqual(suppliedToken, expectedToken)) return sendJson(res, 404, { error: 'not found' });

        const requestNonce = header(req, 'x-bel-request-nonce');
        if (!/^[A-Za-z0-9_-]{12,128}$/.test(String(requestNonce || ''))) {
            return sendJson(res, 400, { error: 'invalid request' });
        }
        try {
            return sendJson(res, 200, await provider.read({ requestNonce }));
        } catch (_) {
            return sendJson(res, 503, { error: 'deployed identities unavailable' });
        }
    };
}

module.exports = { createDeployedIdentitiesRoute };
