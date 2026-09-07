const assert = require('assert');
const {
    buildStudentCreateData,
    buildStudentPatchData,
    mapStudentRecord
} = require('../../functions/src/crm/student-service');

const context = {
    user: {
        uid: 'admin-1',
        email: 'admin@example.com'
    },
    serverTimestamp: () => 'SERVER_TS'
};

const created = buildStudentCreateData({
    name: 'Alice Nguyen',
    email: 'alice@example.com',
    agentSourceId: 'agent-src-1',
    preferredLearningDays: ['Tuesday', 'Thursday'],
    preferredLearningHours: ['19:00-21:00'],
    preferredSchedule: 'Weeknights',
    learningProfile: {
        overall: '88',
        listening: '86',
        reading: '84',
        speaking: '82',
        writing: '80',
        entryLevel: 'B1',
        testResultDueDate: '2026-03-20',
        visaType: '482',
        targetLevel: 'Vocational'
    }
}, context);

assert.strictEqual(created.name, 'Alice Nguyen');
assert.strictEqual(created.email, 'alice@example.com');
assert.strictEqual(created.agentSourceId, 'agent-src-1');
assert.strictEqual(created.lifecycleStage, 'potential');
assert.strictEqual(created.ownerUid, 'admin-1');
assert.deepStrictEqual(created.preferredLearningDays, ['Tuesday', 'Thursday']);
assert.deepStrictEqual(created.preferredLearningHours, ['19:00-21:00']);
assert.strictEqual(created.preferredSchedule, 'Weeknights');
assert.deepStrictEqual(created.learningProfile, {
    overall: 88,
    listening: 86,
    reading: 84,
    speaking: 82,
    writing: 80,
    entryLevel: 'B1',
    testResultDueDate: '2026-03-20',
    visaType: '482',
    targetLevel: 'Vocational'
});

const patched = buildStudentPatchData(created, {
    label: 'High Priority',
    agentSourceId: 'agent-src-2',
    preferredLearningDays: ['Saturday'],
    preferredLearningHours: ['09:00-11:00'],
    learningProfile: {
        speaking: '90',
        testResultDueDate: '2026-03-25',
        visaType: '186',
        targetLevel: 'Competent'
    }
}, context);

assert.strictEqual(patched.label, 'High Priority');
assert.strictEqual(patched.agentSourceId, 'agent-src-2');
assert.strictEqual(patched.name, 'Alice Nguyen');
assert.deepStrictEqual(patched.preferredLearningDays, ['Saturday']);
assert.deepStrictEqual(patched.preferredLearningHours, ['09:00-11:00']);
assert.strictEqual(patched.learningProfile.listening, 86);
assert.strictEqual(patched.learningProfile.speaking, 90);
assert.strictEqual(patched.learningProfile.testResultDueDate, '2026-03-25');
assert.strictEqual(patched.learningProfile.visaType, '186');
assert.strictEqual(patched.learningProfile.targetLevel, 'Competent');
assert.strictEqual(patched.updatedAt, 'SERVER_TS');
assert.strictEqual(patched.updatedBy, 'admin-1');

const mapped = mapStudentRecord({
    id: 'student-1',
    ...patched
});

assert.strictEqual(mapped.studentId, 'student-1');
assert.strictEqual(mapped.agentSourceId, 'agent-src-2');
assert.strictEqual(mapped.lifecycleStage, 'potential');
assert.strictEqual(mapped.learningProfile.entryLevel, 'B1');
assert.strictEqual(mapped.learningProfile.visaType, '186');
assert.strictEqual(mapped.learningProfile.targetLevel, 'Competent');
assert.deepStrictEqual(mapped.preferredLearningDays, ['Saturday']);
assert.deepStrictEqual(mapped.preferredLearningHours, ['09:00-11:00']);

// facebookPersonalOwner coverage
const createdWithSourceAccount = buildStudentCreateData({
    name: 'Bob Tran',
    acquisitionSource: 'Facebook - Personal',
    facebookPersonalOwner: 'Thành'
}, context);
assert.strictEqual(createdWithSourceAccount.facebookPersonalOwner, 'Thành');

const patchedWithOnlyOwner = buildStudentPatchData(createdWithSourceAccount, {
    facebookPersonalOwner: 'Quỳnh'
}, context);
assert.strictEqual(patchedWithOnlyOwner.facebookPersonalOwner, 'Quỳnh');

const mappedOwner = mapStudentRecord({
    id: 'student-2',
    ...patchedWithOnlyOwner
});
assert.strictEqual(mappedOwner.facebookPersonalOwner, 'Quỳnh');

// Verify facebookPersonalOwner satisfies hasAnyInfoField
const createdOnlyOwner = buildStudentCreateData({
    facebookPersonalOwner: 'Nam'
}, context);
assert.strictEqual(createdOnlyOwner.facebookPersonalOwner, 'Nam');

assert.throws(
    () => buildStudentCreateData({}, context),
    /Please fill at least 1 field in Info tab before saving/
);

assert.throws(
    () => buildStudentPatchData(created, {}, context),
    /No student fields provided for update/
);

console.log('student service passed');
