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

module.exports = function createSharedPracticeAttemptsRouter(deps) {
    const { db, sendSuccess, sendError, getStorageBucket } = deps;
    const router = express.Router();

    router.get('/:shareId', async (req, res) => {
        try {
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
                for (const doc of feedbackSnap.docs) {
                    const data = doc.data() || {};
                    const audioUrl = data.audioPath
                        ? await signReadUrl(bucket, data.audioPath, { expiresMinutes: 15 }).catch(() => null)
                        : null;
                    feedback.push({
                        feedbackId: doc.id,
                        text: data.text || null,
                        audioUrl,
                        createdAt: data.createdAt || null
                    });
                }
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

