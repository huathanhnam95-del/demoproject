const express = require('express');
const crypto = require('crypto');

const SPEAKING_ATTEMPTS = 'speakingAttempts';
const SPEAKING_ATTEMPT_SHARES = 'speakingAttemptShares';

function sha256Hex(value) {
    return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function cleanString(value, maxLen) {
    const text = String(value || '').trim();
    if (!text) return null;
    if (Number.isFinite(maxLen) && maxLen > 0) return text.slice(0, maxLen);
    return text;
}

async function signReadUrl(bucket, storagePath, options = {}) {
    const expiresMinutes = Number.isFinite(options.expiresMinutes) ? options.expiresMinutes : 15;
    const expires = Date.now() + expiresMinutes * 60 * 1000;
    const [url] = await bucket.file(storagePath).getSignedUrl({
        action: 'read',
        expires
    });
    return url;
}

async function mapWithConcurrency(items, limit, fn) {
    const list = Array.isArray(items) ? items : [];
    const safeLimit = Math.max(1, Math.min(Number(limit) || 1, 20));
    const out = new Array(list.length);
    let next = 0;

    const workers = Array.from({ length: Math.min(safeLimit, list.length) }, async () => {
        while (next < list.length) {
            const idx = next;
            next += 1;
            if (idx >= list.length) break;
            out[idx] = await fn(list[idx], idx);
        }
    });

    await Promise.all(workers);
    return out;
}

module.exports = function createSharedPracticeAttemptsRouter(deps) {
    const { db, sendSuccess, sendError, getStorageBucket } = deps;
    const router = express.Router();

    router.get('/:shareId', async (req, res) => {
        try {
            res.set('Cache-Control', 'no-store');
            res.set('X-Robots-Tag', 'noindex');

            const shareId = cleanString(req.params?.shareId, 256);
            const token = cleanString(req.query?.token, 4096);
            if (!shareId || !token) return sendError(res, 404, 'NOT_FOUND', 'Shared attempt not found.');

            const shareSnap = await db.collection(SPEAKING_ATTEMPT_SHARES).doc(shareId).get();
            if (!shareSnap.exists) return sendError(res, 404, 'NOT_FOUND', 'Shared attempt not found.');
            const share = shareSnap.data() || {};
            if (String(share.status || '') !== 'active') return sendError(res, 404, 'NOT_FOUND', 'Shared attempt not found.');

            const expected = String(share.tokenHash || '').trim();
            if (!expected || sha256Hex(token) !== expected) {
                return sendError(res, 404, 'NOT_FOUND', 'Shared attempt not found.');
            }

            const attemptId = cleanString(share.attemptId, 256);
            if (!attemptId) return sendError(res, 404, 'NOT_FOUND', 'Shared attempt not found.');

            const attemptSnap = await db.collection(SPEAKING_ATTEMPTS).doc(attemptId).get();
            if (!attemptSnap.exists) return sendError(res, 404, 'NOT_FOUND', 'Shared attempt not found.');
            const attempt = attemptSnap.data() || {};
            if (String(attempt.status || '') !== 'submitted') return sendError(res, 404, 'NOT_FOUND', 'Shared attempt not found.');

            const bucket = await getStorageBucket();
            const studentUrl = attempt.audio?.studentPath
                ? await signReadUrl(bucket, attempt.audio.studentPath, { expiresMinutes: 15 }).catch(() => null)
                : null;

            const feedbackSnap = await db
                .collection(SPEAKING_ATTEMPTS)
                .doc(attemptId)
                .collection('feedback')
                .where('visibility', '==', 'shared')
                .where('status', '==', 'completed')
                .orderBy('createdAt', 'desc')
                .limit(20)
                .get()
                .catch(() => null);

            const feedback = [];
            if (feedbackSnap && Array.isArray(feedbackSnap.docs)) {
                const rows = feedbackSnap.docs.map((doc) => {
                    const data = doc.data() || {};
                    return {
                        feedbackId: doc.id,
                        text: data.text || null,
                        audioUrl: null,
                        _audioPath: data.audioPath ? String(data.audioPath) : null,
                        createdAt: data.createdAt || null
                    };
                });

                const urls = await mapWithConcurrency(rows, 6, async (row) => {
                    if (!row._audioPath) return null;
                    return signReadUrl(bucket, row._audioPath, { expiresMinutes: 15 }).catch(() => null);
                });
                rows.forEach((row, idx) => {
                    row.audioUrl = urls[idx] || null;
                    delete row._audioPath;
                    feedback.push(row);
                });
            }

            return sendSuccess(res, {
                attempt: {
                    attemptId,
                    practiceMode: attempt.practiceMode || null,
                    promptSnapshot: attempt.promptSnapshot || null,
                    submittedAt: attempt.submittedAt || null,
                    audio: { studentUrl }
                },
                feedback
            });
        } catch (error) {
            return sendError(res, 500, 'SHARED_ATTEMPT_ERROR', 'Failed to load shared attempt.', error?.message || error);
        }
    });

    return router;
};
