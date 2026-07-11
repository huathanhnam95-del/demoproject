const rateLimit = require('express-rate-limit');

function buildLimiter({ windowMs, max, keyGenerator }) {
    const isTest = process.env.NODE_ENV === 'test';
    return rateLimit({
        windowMs,
        max: isTest ? 10000 : max,
        ...(typeof keyGenerator === 'function' ? { keyGenerator } : {}),
        message: {
            success: false,
            error: 'TOO_MANY_REQUESTS',
            message: 'Too many requests, please try again later.'
        },
        standardHeaders: true,
        legacyHeaders: false,
        validate: false // Cloud Functions runs behind Google's proxy; skip X-Forwarded-For validation
    });
}

function keyByUid(req) {
    const uid = String(req?.user?.uid || '').trim();
    if (uid) return `uid:${uid}`;
    return `ip:${String(req?.ip || 'unknown').trim()}`;
}

// Authenticated endpoints: key by uid so abuse controls survive IP rotation.
const practiceAttemptsLimiterByUid = buildLimiter({
    windowMs: 60 * 1000,
    max: 60,
    keyGenerator: keyByUid
});

// Public share links: keep IP-based and tighter.
const sharedPracticeAttemptsLimiter = buildLimiter({
    windowMs: 60 * 1000,
    max: 30
});

// Azure Speech API assessment rate limiter. Capped at 15 attempts per minute.
const azureAssessmentRateLimiter = buildLimiter({
    windowMs: 60 * 1000,
    max: 15,
    keyGenerator: keyByUid
});

module.exports = {
    practiceAttemptsLimiterByUid,
    practiceAttemptsLimiter: practiceAttemptsLimiterByUid,
    sharedPracticeAttemptsLimiter,
    azureAssessmentRateLimiter
};
