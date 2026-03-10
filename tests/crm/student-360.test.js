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
    name: 'Alice',
    email: 'alice@example.com',
    targets: {
        exam: 'PTE',
        score: 79
    },
    preferredSchedule: 'Weeknights',
    scoreHistory: [
        { date: '2026-03-01', score: 58 }
    ],
    contacts: {
        guardians: [{ name: 'Parent A', phone: '0901' }],
        companies: [{ name: 'Company X', email: 'hr@company.com' }]
    },
    documentRefs: [
        { storagePath: 'crmStudents/student-1/docs/id.pdf', name: 'ID' }
    ],
    counselingNotes: 'Interested in intensive course.'
}, context);

assert.strictEqual(created.targets.exam, 'PTE');
assert.strictEqual(created.targets.score, 79);
assert.strictEqual(created.preferredSchedule, 'Weeknights');
assert.strictEqual(created.scoreHistory.length, 1);
assert.strictEqual(created.contacts.guardians[0].name, 'Parent A');
assert.strictEqual(created.documentRefs[0].storagePath, 'crmStudents/student-1/docs/id.pdf');

const patched = buildStudentPatchData(created, {
    targets: {
        exam: 'IELTS',
        score: 7.5
    },
    counselingNotes: 'Changed target after placement.',
    scoreHistory: [
        { date: '2026-03-01', score: 58 },
        { date: '2026-03-10', score: 64 }
    ]
}, context);

assert.strictEqual(patched.targets.exam, 'IELTS');
assert.strictEqual(patched.targets.score, 7.5);
assert.strictEqual(patched.scoreHistory.length, 2);
assert.strictEqual(patched.counselingNotes, 'Changed target after placement.');

const mapped = mapStudentRecord({ id: 'student-1', ...patched });
assert.strictEqual(mapped.targets.exam, 'IELTS');
assert.strictEqual(mapped.contacts.guardians[0].name, 'Parent A');
assert.strictEqual(mapped.scoreHistory[1].score, 64);

console.log('student 360 service passed');
