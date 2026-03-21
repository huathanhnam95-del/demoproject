const crypto = require('crypto');

const HOMEWORK_STATUSES = Object.freeze(['turned-in', 'needs-revision', 'graded']);

function resolveTimestamp(context = {}) {
    if (typeof context.serverTimestamp === 'function') {
        return context.serverTimestamp();
    }
    return new Date();
}

function normalizeAudio(audio) {
    if (!audio || typeof audio !== 'object') {
        return null;
    }
    return {
        storagePath: audio.storagePath || null,
        bucketName: audio.bucketName || null,
        filename: audio.filename || null
    };
}

function buildHomeworkSubmissionDocId({ classId, workId, studentUid }) {
    return crypto
        .createHash('sha256')
        .update([classId, workId, studentUid].map((value) => String(value || '').trim()).join('::'))
        .digest('hex');
}

function buildHomeworkSubmissionCreateData(input = {}, context = {}) {
    const classId = String(input.classId || '').trim();
    const workId = String(input.workId || '').trim();
    const studentUid = String(input.studentUid || '').trim();
    if (!classId || !workId || !studentUid) {
        throw new Error('Homework submission requires classId, workId, and studentUid.');
    }

    const now = resolveTimestamp(context);
    const audio = normalizeAudio(input.audio);
    return {
        classId,
        workId,
        studentUid,
        studentEmail: input.studentEmail || null,
        audio,
        status: 'turned-in',
        submittedAt: now,
        latestSubmittedAt: now,
        revisionCount: 1,
        returnedForRevisionAt: null,
        returnedForRevisionBy: null,
        feedback: null,
        grade: null,
        gradedAt: null,
        gradedBy: null,
        createdAt: now,
        updatedAt: now,
        revisionHistory: [
            {
                type: 'submitted',
                at: now,
                by: String(context.user?.uid || '').trim() || null,
                audio
            }
        ]
    };
}

function buildHomeworkSubmissionReturnPatch(existingSubmission = {}, input = {}, context = {}) {
    const now = resolveTimestamp(context);
    const feedback = input.feedback ?? existingSubmission.feedback ?? null;
    const normalizedHistory = Array.isArray(existingSubmission.revisionHistory)
        ? existingSubmission.revisionHistory.slice()
        : [];

    normalizedHistory.push({
        type: 'returned-for-revision',
        at: now,
        by: String(context.user?.uid || '').trim() || null,
        feedback: feedback || null
    });

    return {
        status: 'needs-revision',
        feedback,
        grade: null,
        gradedAt: null,
        gradedBy: null,
        returnedForRevisionAt: now,
        returnedForRevisionBy: String(context.user?.uid || '').trim() || null,
        updatedAt: now,
        revisionHistory: normalizedHistory
    };
}

function buildHomeworkSubmissionResubmissionPatch(existingSubmission = {}, input = {}, context = {}) {
    const now = resolveTimestamp(context);
    const audio = normalizeAudio(input.audio ?? existingSubmission.audio ?? null);
    const normalizedHistory = Array.isArray(existingSubmission.revisionHistory)
        ? existingSubmission.revisionHistory.slice()
        : [];

    normalizedHistory.push({
        type: 'resubmitted',
        at: now,
        by: String(context.user?.uid || '').trim() || null,
        audio
    });

    return {
        audio,
        status: 'turned-in',
        submittedAt: existingSubmission.submittedAt || now,
        latestSubmittedAt: now,
        revisionCount: Math.max(1, Number(existingSubmission.revisionCount || 1) + 1),
        returnedForRevisionAt: null,
        returnedForRevisionBy: null,
        grade: null,
        gradedAt: null,
        gradedBy: null,
        updatedAt: now,
        revisionHistory: normalizedHistory
    };
}

function buildHomeworkSubmissionGradePatch(existingSubmission = {}, input = {}, context = {}) {
    const now = resolveTimestamp(context);
    const grade = input.grade ?? existingSubmission.grade ?? null;
    const feedback = input.feedback ?? existingSubmission.feedback ?? null;
    const normalizedHistory = Array.isArray(existingSubmission.revisionHistory)
        ? existingSubmission.revisionHistory.slice()
        : [];

    normalizedHistory.push({
        type: 'graded',
        at: now,
        by: String(context.user?.uid || '').trim() || null,
        grade,
        feedback
    });

    return {
        grade,
        feedback,
        status: 'graded',
        gradedAt: now,
        gradedBy: String(context.user?.uid || '').trim() || null,
        updatedAt: now,
        revisionHistory: normalizedHistory
    };
}

module.exports = {
    HOMEWORK_STATUSES,
    buildHomeworkSubmissionCreateData,
    buildHomeworkSubmissionDocId,
    buildHomeworkSubmissionReturnPatch,
    buildHomeworkSubmissionResubmissionPatch,
    buildHomeworkSubmissionGradePatch
};
