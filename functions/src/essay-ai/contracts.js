const crypto = require('node:crypto');

const QUEUE_ID_PATTERN = /^[a-f0-9]{64}$/;
const MAX_ESSAY_LENGTH = 6000;
const MIN_ESSAY_LENGTH = 50;
const MAX_PROMPT_LENGTH = 2000;

function contractError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function computeQueueId(uid, attemptId) {
    if (typeof uid !== 'string' || !uid || typeof attemptId !== 'string' || !attemptId) {
        throw contractError('invalid-argument', 'uid and attemptId are required');
    }
    return crypto.createHash('sha256').update(`${uid}:${attemptId}`, 'utf8').digest('hex');
}

function validateDeepAiRequest(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw contractError('invalid-argument', 'Request data must contain only attemptId');
    }
    const keys = Object.keys(data);
    if (keys.length !== 1 || keys[0] !== 'attemptId') {
        throw contractError('invalid-argument', 'Only attemptId is accepted');
    }
    const attemptId = typeof data.attemptId === 'string' ? data.attemptId.trim() : '';
    if (attemptId.length < 10 || attemptId.length > 128) {
        throw contractError('invalid-argument', 'A valid attemptId is required');
    }
    return { attemptId };
}

function extractAuthoritativeEssay(attempt) {
    if (!attempt || typeof attempt !== 'object') {
        throw contractError('failed-precondition', 'Archived essay attempt is invalid');
    }
    if (attempt.practiceScope !== 'pte' || attempt.canonicalMode !== 'write_essay' || attempt.status !== 'submitted') {
        throw contractError('failed-precondition', 'Attempt is not a submitted PTE Write Essay');
    }
    const essayText = typeof attempt.responseSnapshot?.text === 'string'
        ? attempt.responseSnapshot.text.trim()
        : '';
    const promptText = typeof attempt.promptSnapshot?.text === 'string'
        ? attempt.promptSnapshot.text.trim()
        : '';
    if (essayText.length < MIN_ESSAY_LENGTH || essayText.length > MAX_ESSAY_LENGTH) {
        throw contractError('failed-precondition', 'Archived essay text is outside Deep AI limits');
    }
    if (!promptText || promptText.length > MAX_PROMPT_LENGTH) {
        throw contractError('failed-precondition', 'Archived prompt text is outside Deep AI limits');
    }
    const uid = typeof attempt.ownerUid === 'string' ? attempt.ownerUid.trim() : '';
    if (!uid) throw contractError('failed-precondition', 'Archived attempt has no owner');
    const rawQuestionId = attempt.promptSnapshot?.promptId;
    const questionId = typeof rawQuestionId === 'string' && rawQuestionId.trim()
        ? rawQuestionId.trim().slice(0, 128)
        : null;
    return { uid, essayText, promptText, questionId };
}

function buildPendingQueueDocument({ uid, attemptId, archive, serverTimestamp }) {
    const timestamp = typeof serverTimestamp === 'function' ? serverTimestamp() : serverTimestamp;
    return {
        uid,
        attemptId,
        questionId: archive.questionId,
        essayText: archive.essayText,
        promptText: archive.promptText,
        status: 'pending',
        submittedAt: timestamp,
        claimedAt: null,
        leaseExpiresAt: null,
        workerId: null,
        completedAt: null,
        runGeneration: 0,
        retryCount: 0,
        error: null,
        resetCount: 0,
        lastResetAt: null,
        lastResetByBackfillJobId: null,
        isRead: false,
        resultSnapshot: null
    };
}

module.exports = {
    MAX_ESSAY_LENGTH,
    MIN_ESSAY_LENGTH,
    MAX_PROMPT_LENGTH,
    QUEUE_ID_PATTERN,
    buildPendingQueueDocument,
    computeQueueId,
    contractError,
    extractAuthoritativeEssay,
    validateDeepAiRequest
};
