const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const {
    buildPendingQueueDocument,
    computeQueueId,
    contractError,
    extractAuthoritativeEssay,
    validateDeepAiRequest
} = require('./essay-ai/contracts');

function toHttpsError(error) {
    if (error instanceof HttpsError) return error;
    const allowed = new Set(['invalid-argument', 'not-found', 'permission-denied', 'failed-precondition', 'unauthenticated']);
    const code = allowed.has(error?.code) ? error.code : 'internal';
    return new HttpsError(code, error?.message || 'Deep AI queue submission failed');
}

function createSubmitEssayDeepAiHandler(options = {}) {
    const db = options.db || getFirestore();
    const now = options.now || (() => new Date());
    const serverTimestamp = options.serverTimestamp || (() => FieldValue.serverTimestamp());
    return async function submitEssayDeepAiHandler(request) {
        if (!request?.auth?.uid) throw contractError('unauthenticated', 'User must be authenticated');
        const { attemptId } = validateDeepAiRequest(request.data);
        const uid = request.auth.uid;
        const attemptRef = db.collection('speakingAttempts').doc(attemptId);
        const attemptSnapshot = await attemptRef.get();
        if (!attemptSnapshot.exists) throw contractError('not-found', 'Archived essay attempt not found');
        const attempt = attemptSnapshot.data();
        if (attempt.ownerUid !== uid) throw contractError('permission-denied', 'Attempt does not belong to the caller');
        const archive = extractAuthoritativeEssay(attempt);
        const queueId = computeQueueId(uid, attemptId);
        const queueRef = db.collection('essay_ai_queue').doc(queueId);
        const usageRef = db.collection('essay_ai_usage').doc(uid);
        const configuredQuota = Number(options.quotaPerDay);
        const quotaPerDay = Number.isFinite(configuredQuota) && configuredQuota > 0
            ? Math.floor(configuredQuota)
            : 5;
        return db.runTransaction(async (transaction) => {
            const existing = await transaction.get(queueRef);
            if (existing.exists) {
                const existingData = existing.data() || {};
                if (existingData.uid !== uid || existingData.attemptId !== attemptId) {
                    throw contractError('internal', 'Queue identity integrity check failed');
                }
                return { queueId, status: existingData.status || 'pending', created: false };
            }
            const usageSnapshot = await transaction.get(usageRef);
            const windowKey = now().toISOString().slice(0, 10);
            const usage = usageSnapshot.exists ? usageSnapshot.data() || {} : {};
            const storedCount = usage.windowKey === windowKey ? Number(usage.count) : 0;
            const used = Number.isFinite(storedCount) && storedCount >= 0 ? Math.floor(storedCount) : 0;
            if (used >= quotaPerDay) {
                throw contractError('failed-precondition', 'Daily Deep AI scoring quota reached');
            }
            const pending = buildPendingQueueDocument({
                uid,
                attemptId,
                archive,
                serverTimestamp: () => serverTimestamp(now())
            });
            transaction.create(queueRef, pending);
            transaction.set(usageRef, {
                windowKey,
                count: used + 1,
                updatedAt: serverTimestamp(now())
            }, { merge: true });
            return { queueId, status: 'pending', created: true };
        });
    };
}

const submitEssayDeepAi = onCall({ maxInstances: 10 }, async (request) => {
    try {
        return await createSubmitEssayDeepAiHandler()(request);
    } catch (error) {
        throw toHttpsError(error);
    }
});

module.exports = {
    createSubmitEssayDeepAiHandler,
    submitEssayDeepAi,
    toHttpsError
};
