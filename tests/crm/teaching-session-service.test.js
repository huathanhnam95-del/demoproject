const assert = require('assert');

const {
    TEACHING_SESSION_STATUSES,
    buildTeachingSessionCreateData,
    buildTeachingSessionPatchData,
    mapTeachingSessionRecord,
    sortTeachingSessions
} = require('../../functions/src/crm/teaching-session-service');

const context = {
    user: {
        uid: 'teacher-1',
        email: 'teacher@example.com',
        displayName: 'Thầy Nam'
    },
    serverTimestamp: () => '2026-09-02T10:00:00.000Z'
};

// 1. Status constants
assert.deepStrictEqual(
    TEACHING_SESSION_STATUSES,
    ['uploaded', 'processing', 'analyzed', 'error', 'archived']
);

// 2. Create data validation & normalization
const created = buildTeachingSessionCreateData({
    studentId: 'student-123',
    classId: 'class-456',
    courseId: 'course-789',
    title: 'Academic Writing: Lexical Cohesion',
    focusSkill: 'Writing',
    sessionDate: '2026-09-02T08:00:00.000Z',
    audioUrl: 'gs://bucket/audio.m4a',
    audioDurationSec: 6776,
    status: 'uploaded',
    notes: 'Covered PEEL paragraph structure.',
    report: { title: 'Pre-Class Briefing' },
    mermaidMindmap: 'mindmap\n  root((Lesson))',
    mermaidFlowchart: 'graph TD\n  START --> END',
    markdownReport: '# Briefing Card'
}, context);

assert.strictEqual(created.studentId, 'student-123');
assert.strictEqual(created.classId, 'class-456');
assert.strictEqual(created.courseId, 'course-789');
assert.strictEqual(created.teacherUid, 'teacher-1');
assert.strictEqual(created.teacherName, 'Thầy Nam');
assert.strictEqual(created.title, 'Academic Writing: Lexical Cohesion');
assert.strictEqual(created.focusSkill, 'Writing');
assert.strictEqual(created.sessionDate, '2026-09-02T08:00:00.000Z');
assert.strictEqual(created.audioUrl, 'gs://bucket/audio.m4a');
assert.strictEqual(created.audioDurationSec, 6776);
assert.strictEqual(created.status, 'uploaded');
assert.strictEqual(created.notes, 'Covered PEEL paragraph structure.');
assert.deepStrictEqual(created.report, { title: 'Pre-Class Briefing' });
assert.strictEqual(created.mermaidMindmap, 'mindmap\n  root((Lesson))');
assert.strictEqual(created.mermaidFlowchart, 'graph TD\n  START --> END');
assert.strictEqual(created.markdownReport, '# Briefing Card');
assert.strictEqual(created.createdAt, '2026-09-02T10:00:00.000Z');
assert.strictEqual(created.createdBy, 'teacher-1');

// 3. Validation errors on create
assert.throws(() => buildTeachingSessionCreateData({}, context), /studentId is required/i);
assert.throws(() => buildTeachingSessionCreateData({ studentId: ' ' }, context), /studentId is required/i);
assert.throws(() => buildTeachingSessionCreateData({ studentId: 'std-1', status: 'invalid_status' }, context), /invalid status/i);

// 4. Patch data validation & normalization
const patch = buildTeachingSessionPatchData(created, {
    status: 'analyzed',
    title: 'Updated Title',
    mermaidMindmap: 'mindmap\n  root((Updated))',
    notes: 'Updated notes'
}, context);

assert.strictEqual(patch.status, 'analyzed');
assert.strictEqual(patch.title, 'Updated Title');
assert.strictEqual(patch.mermaidMindmap, 'mindmap\n  root((Updated))');
assert.strictEqual(patch.notes, 'Updated notes');
assert.strictEqual(patch.updatedAt, '2026-09-02T10:00:00.000Z');
assert.strictEqual(patch.updatedBy, 'teacher-1');

assert.throws(() => buildTeachingSessionPatchData(created, { status: 'bad_status' }, context), /invalid status/i);

// 5. Mapping doc to API response
const mapped = mapTeachingSessionRecord({
    id: 'ts_abc123',
    ...created
});

assert.strictEqual(mapped.id, 'ts_abc123');
assert.strictEqual(mapped.sessionId, 'ts_abc123');
assert.strictEqual(mapped.studentId, 'student-123');
assert.strictEqual(mapped.status, 'uploaded');

// 6. Sorting
const sessionList = [
    { id: '1', sessionDate: '2026-09-01T08:00:00.000Z' },
    { id: '2', sessionDate: '2026-09-03T08:00:00.000Z' },
    { id: '3', sessionDate: '2026-09-02T08:00:00.000Z' }
];
const sorted = sortTeachingSessions(sessionList);
assert.strictEqual(sorted[0].id, '2');
assert.strictEqual(sorted[1].id, '3');
assert.strictEqual(sorted[2].id, '1');

console.log('teaching session service test passed');
