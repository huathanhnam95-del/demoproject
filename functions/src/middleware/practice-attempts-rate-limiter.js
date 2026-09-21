const rateLimit = require('express-rate-limit');

class FirestoreRateLimitStore {
    constructor({ getDb, prefix = 'rl', failClosed = false } = {}) {
        this.getDb = getDb;
        this.prefix = prefix;
        this.failClosed = Boolean(failClosed);
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
            console.error(`[RateLimiter:Error] Firestore error in limiter ${this.prefix} for key ${key}:`, err?.message || err);
            if (this.failClosed) {
                const quotaError = new Error('Assessment quota service temporarily unavailable. Please retry shortly.');
                quotaError.status = 503;
                quotaError.code = 'RATE_LIMITER_UNAVAILABLE';
                throw quotaError;
            }
            console.warn(`[RateLimiter:Degraded] Falling back to in-memory store for ${this.prefix}:${key}`);
        }

        if (this.failClosed) {
            const quotaError = new Error('Assessment quota service temporarily unavailable. Please retry shortly.');
            quotaError.status = 503;
            quotaError.code = 'RATE_LIMITER_UNAVAILABLE';
            throw quotaError;
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

        try {
            const db = typeof this.getDb === 'function' ? this.getDb() : null;
            if (db && typeof db.collection === 'function') {
                const now = Date.now();
                const windowStart = Math.floor(now / this.windowMs) * this.windowMs;
                const cleanKey = String(key || 'unknown').replace(/[^a-zA-Z0-9_:-]/g, '_').slice(0, 64);
                const docId = `${this.prefix}_${cleanKey}_${windowStart}`;
                const docRef = db.collection('_rateLimits').doc(docId);
                await db.runTransaction(async (tx) => {
                    const snap = await tx.get(docRef);
                    if (snap.exists && (snap.data()?.hits || 0) > 0) {
                        tx.update(docRef, { hits: Math.max(0, (snap.data().hits || 1) - 1) });
                    }
                });
            }
        } catch (err) {
            console.error(`[RateLimiter:Error] Firestore decrement failed for ${this.prefix}:${key}:`, err?.message || err);
        }
    }

    async resetKey(key) {
        this.localFallback.delete(key);

        try {
            const db = typeof this.getDb === 'function' ? this.getDb() : null;
            if (db && typeof db.collection === 'function') {
                const now = Date.now();
                const windowStart = Math.floor(now / this.windowMs) * this.windowMs;
                const cleanKey = String(key || 'unknown').replace(/[^a-zA-Z0-9_:-]/g, '_').slice(0, 64);
                const docId = `${this.prefix}_${cleanKey}_${windowStart}`;
                await db.collection('_rateLimits').doc(docId).delete();
            }
        } catch (err) {
            console.error(`[RateLimiter:Error] Firestore reset failed for ${this.prefix}:${key}:`, err?.message || err);
        }
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

function buildLimiter({ windowMs, max, keyGenerator, prefix = 'rl', failClosed = false }) {
    const isTest = process.env.NODE_ENV === 'test';
    const store = isTest ? undefined : new FirestoreRateLimitStore({ getDb: getDatabaseSafe, prefix, failClosed });

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
    prefix: 'pa_uid',
    failClosed: false
});

// Public share links: keep IP-based and tighter.
const sharedPracticeAttemptsLimiter = buildLimiter({
    windowMs: 60 * 1000,
    max: 30,
    keyGenerator: keyByUid,
    prefix: 'pa_share',
    failClosed: false
});

// Azure Speech API assessment rate limiter. Capped at 15 attempts per minute per authenticated user (or fallback IP), with counters shared across instances.
// failClosed: true ensures database errors do not permit unbounded billable assessment runs.
const azureAssessmentRateLimiter = buildLimiter({
    windowMs: 60 * 1000,
    max: 15,
    keyGenerator: keyByUid,
    prefix: 'azure_speech',
    failClosed: true
});

module.exports = {
    FirestoreRateLimitStore,
    practiceAttemptsLimiterByUid,
    practiceAttemptsLimiter: practiceAttemptsLimiterByUid,
    sharedPracticeAttemptsLimiter,
    azureAssessmentRateLimiter
};
