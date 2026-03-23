const assert = require('assert');
const {
    HOMEWORK_STATUSES,
    buildHomeworkSubmissionCreateData,
    buildHomeworkSubmissionDocId,
    buildHomeworkSubmissionReturnPatch,
    buildHomeworkSubmissionResubmissionPatch,
    buildHomeworkSubmissionGradePatch
} = require('../../functions/src/crm/homework-service');

function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function createInMemoryStore() {
    const docs = new Map();

    return {
        get(id) {
            return docs.has(id) ? clone(docs.get(id)) : null;
        },
        set(id, data, merge = false) {
            const current = docs.get(id) || {};
            const next = merge ? { ...current, ...clone(data) } : clone(data);
            docs.set(id, next);
            return clone(next);
        },
        list() {
            return Array.from(docs.entries()).map(([id, data]) => ({
                id,
                data: clone(data)
            }));
        },
        clear() {
            docs.clear();
        }
    };
}

function categorizeByStatus(submissions) {
    const rows = Array.isArray(submissions) ? submissions : [];
    return {
        turnedIn: rows.filter((row) => row.data?.status === 'turned-in'),
        needsRevision: rows.filter((row) => row.data?.status === 'needs-revision'),
        graded: rows.filter((row) => row.data?.status === 'graded')
    };
}

async function main() {
    const context = {
        user: {
            uid: 'teacher-1',
            email: 'teacher@example.com'
        },
        serverTimestamp: () => 'SERVER_TS'
    };

    const store = createInMemoryStore();
    const classId = 'class-1';
    const workId = 'work-1';
    const studentUid = 'student-1';
    const submissionId = buildHomeworkSubmissionDocId({ classId, workId, studentUid });

    try {
        const createPayload = buildHomeworkSubmissionCreateData({
            classId,
            workId,
            studentUid,
            studentEmail: 'student@example.com',
            audio: {
                storagePath: 'uploads/class-1/work-1/student-1/submission-1.webm',
                bucketName: 'local-bucket',
                filename: 'submission-1.webm'
            }
        }, context);

        store.set(submissionId, createPayload);
        assert.strictEqual(store.list().length, 1, 'expected a single submission record after first submit');
        assert.strictEqual(store.get(submissionId).status, 'turned-in');
        assert.strictEqual(store.get(submissionId).revisionCount, 1);

        const returnPatch = buildHomeworkSubmissionReturnPatch(store.get(submissionId), {
            feedback: 'Add a clearer topic sentence.'
        }, context);
        store.set(submissionId, returnPatch, true);
        assert.strictEqual(store.list().length, 1, 'revision should reuse the same record');
        assert.strictEqual(store.get(submissionId).status, 'needs-revision');
        assert.strictEqual(store.get(submissionId).revisionCount, 1);

        const resubmissionPatch = buildHomeworkSubmissionResubmissionPatch(store.get(submissionId), {
            audio: {
                storagePath: 'uploads/class-1/work-1/student-1/submission-2.webm',
                bucketName: 'local-bucket',
                filename: 'submission-2.webm'
            }
        }, context);
        store.set(submissionId, resubmissionPatch, true);
        assert.strictEqual(store.list().length, 1, 'resubmission should update the same record');
        assert.strictEqual(store.get(submissionId).status, 'turned-in');
        assert.strictEqual(store.get(submissionId).revisionCount, 2);
        assert.strictEqual(store.get(submissionId).audio.storagePath, 'uploads/class-1/work-1/student-1/submission-2.webm');

        const gradePatch = buildHomeworkSubmissionGradePatch(store.get(submissionId), {
            grade: 'A',
            feedback: 'Much stronger after revision.'
        }, context);
        store.set(submissionId, gradePatch, true);

        const finalSubmission = store.get(submissionId);
        assert.strictEqual(finalSubmission.status, 'graded');
        assert.strictEqual(finalSubmission.grade, 'A');
        assert.strictEqual(finalSubmission.feedback, 'Much stronger after revision.');
        assert.strictEqual(finalSubmission.gradedBy, 'teacher-1');
        assert.strictEqual(finalSubmission.revisionCount, 2);

        const board = categorizeByStatus(store.list());
        assert.deepStrictEqual(
            HOMEWORK_STATUSES,
            ['turned-in', 'needs-revision', 'graded'],
            'homework statuses must remain stable'
        );
        assert.strictEqual(board.turnedIn.length, 0);
        assert.strictEqual(board.needsRevision.length, 0);
        assert.strictEqual(board.graded.length, 1);
        assert.strictEqual(board.graded[0].id, submissionId);

        console.log('homework flow smoke passed');
    } finally {
        store.clear();
    }
}

main().catch((error) => {
    console.error('homework flow smoke failed:', error);
    process.exitCode = 1;
});
