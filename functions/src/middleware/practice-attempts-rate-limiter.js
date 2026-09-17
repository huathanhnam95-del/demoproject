const rateLimit = require('express-rate-limit');

class FirestoreRateLimitStore {
    constructor({ getDb, prefix = 'rl' } = {}) {
        this.getDb = getDb;
        this.prefix = prefix;
        this.localFallback = new Map();
    }

    init(options) {
        this.windowMs = options.windowMs || 60000;
    }

    async increment(key) {
        const now = Date.now();
        const windowStart = Math.floor(now / this.windowMs) * this.windowMs;
        const resetTime = new Date(windowStart + this.windowMs);

        try {
            const db = typeof this.getDb === 'function' ? this.getDb() : null;
            if (db && typeof db.collection === 'function') {
                const cleanKey = String(key || 'unknown').replace(/[^a-zA-Z0-9_:-]/g, '_').slice(0, 64);
                const docId = `${this.prefix}_${cleanKey}_${windowStart}`;
                const docRef = db.collection('_rateLimits').doc(docId);

                let totalHits = 1;
                await db.runTransaction(async (tx) => {
                    const snap = await tx.get(docRef);
                    if (!snap.exists) {
                        tx.set(docRef, {
                            hits: 1,
                            key,
                            windowStart,
                            resetTime,
                            expiresAt: new Date(windowStart + this.windowMs * 2)
                        });
                        totalHits = 1;
                    } else {
                        const current = snap.data()?.hits || 0;
                        totalHits = current + 1;
                        tx.update(docRef, { hits: totalHits });
                    }
                });

                return { totalHits, resetTime };
            }
        } catch (err) {
            // Fail-open to memory fallback on database contention or connection issues
        }

        const record = this.localFallback.get(key);
        if (!record || record.resetTime <= now) {
            this.localFallback.set(key, { totalHits: 1, resetTime: now + this.windowMs });
            return { totalHits: 1, resetTime: new Date(now + this.windowMs) };
        }
        record.totalHits += 1;
        return { totalHits: record.totalHits, resetTime: new Date(record.resetTime) };
    }

    async decrement(key) {
        const record = this.localFallback.get(key);
        if (record && record.totalHits > 0) {
            record.totalHits -= 1;
        }
    }

    async resetKey(key) {
        this.localFallback.delete(key);
    }
}

function getDatabaseSafe() {
    try {
        const { db } = require('../utils/firebase_admin_init');
        return db;
    } catch (_) {
        return null;
    }
}

function buildLimiter({ windowMs, max, keyGenerator, prefix = 'rl' }) {
    const isTest = process.env.NODE_ENV === 'test';
    const store = isTest ? undefined : new FirestoreRateLimitStore({ getDb: getDatabaseSafe, prefix });

    return rateLimit({
        windowMs,
        max: isTest ? 10000 : max,
        ...(store ? { store } : {}),
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
    const ip = String(req?.ip || req?.socket?.remoteAddress || 'unknown').trim();
    return `ip:${ip}`;
}

// Authenticated endpoints: key by uid so abuse controls survive IP rotation.
const practiceAttemptsLimiterByUid = buildLimiter({
    windowMs: 60 * 1000,
    max: 60,
    keyGenerator: keyByUid,
    prefix: 'pa_uid'
});

// Public share links: keep IP-based and tighter.
const sharedPracticeAttemptsLimiter = buildLimiter({
    windowMs: 60 * 1000,
    max: 30,
    keyGenerator: keyByUid,
    prefix: 'pa_share'
});

// Azure Speech API assessment rate limiter. Capped at 15 attempts per minute deployment-wide.
const azureAssessmentRateLimiter = buildLimiter({
    windowMs: 60 * 1000,
    max: 15,
    keyGenerator: keyByUid,
    prefix: 'azure_speech'
});

module.exports = {
    FirestoreRateLimitStore,
    practiceAttemptsLimiterByUid,
    practiceAttemptsLimiter: practiceAttemptsLimiterByUid,
    sharedPracticeAttemptsLimiter,
    azureAssessmentRateLimiter
};
