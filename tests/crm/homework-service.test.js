const assert = require('assert');

const {
    HOMEWORK_STATUSES,
    buildHomeworkSubmissionCreateData,
    buildHomeworkSubmissionDocId,
    buildHomeworkSubmissionReturnPatch,
    buildHomeworkSubmissionResubmissionPatch,
    buildHomeworkSubmissionGradePatch
} = require('../../functions/src/crm/homework-service');

const context = {
    user: {
        uid: 'teacher-1',
        email: 'teacher@example.com'
    },
    serverTimestamp: () => 'SERVER_TS'
};

assert.deepStrictEqual(HOMEWORK_STATUSES, ['turned-in', 'needs-revision', 'graded']);

const firstSubmission = buildHomeworkSubmissionCreateData({
    classId: 'class-1',
    workId: 'work-1',
    studentUid: 'student-1',
    studentEmail: 'student@example.com',
    audio: { storagePath: 'uploads/class-1/work-1/student-1/file.webm' }
}, context);

assert.strictEqual(firstSubmission.status, 'turned-in');
assert.strictEqual(firstSubmission.revisionCount, 1);
assert.strictEqual(firstSubmission.submittedAt, 'SERVER_TS');
assert.strictEqual(firstSubmission.latestSubmittedAt, 'SERVER_TS');
assert.strictEqual(firstSubmission.returnedForRevisionAt, null);
assert.strictEqual(buildHomeworkSubmissionDocId({
    classId: 'class-1',
    workId: 'work-1',
    studentUid: 'student-1'
}), buildHomeworkSubmissionDocId({
    classId: 'class-1',
    workId: 'work-1',
    studentUid: 'student-1'
}));

const returned = buildHomeworkSubmissionReturnPatch({
    ...firstSubmission,
    grade: 'B',
    feedback: 'Needs clearer topic sentences.'
}, {
    feedback: 'Needs clearer topic sentences.'
}, context);

assert.strictEqual(returned.status, 'needs-revision');
assert.strictEqual(returned.grade, null);
assert.strictEqual(returned.feedback, 'Needs clearer topic sentences.');
assert.strictEqual(returned.returnedForRevisionBy, 'teacher-1');
assert.strictEqual(returned.returnedForRevisionAt, 'SERVER_TS');

const resubmitted = buildHomeworkSubmissionResubmissionPatch({
    ...firstSubmission,
    revisionCount: 1,
    status: 'needs-revision',
    returnedForRevisionAt: 'SERVER_TS'
}, {
    audio: { storagePath: 'uploads/class-1/work-1/student-1/file-2.webm' }
}, context);

assert.strictEqual(resubmitted.status, 'turned-in');
assert.strictEqual(resubmitted.revisionCount, 2);
assert.strictEqual(resubmitted.submittedAt, 'SERVER_TS');
assert.strictEqual(resubmitted.latestSubmittedAt, 'SERVER_TS');
assert.strictEqual(resubmitted.audio.storagePath, 'uploads/class-1/work-1/student-1/file-2.webm');

const graded = buildHomeworkSubmissionGradePatch({
    ...resubmitted,
    feedback: 'Needs a little more detail.'
}, {
    grade: 'A',
    feedback: 'Nice improvement.'
}, context);

assert.strictEqual(graded.status, 'graded');
assert.strictEqual(graded.grade, 'A');
assert.strictEqual(graded.feedback, 'Nice improvement.');
assert.strictEqual(graded.gradedAt, 'SERVER_TS');
assert.strictEqual(graded.gradedBy, 'teacher-1');
assert.ok(Array.isArray(graded.revisionHistory));
assert.strictEqual(graded.revisionHistory.at(-1).type, 'graded');

console.log('homework service passed');
