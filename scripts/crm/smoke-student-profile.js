const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {
    buildStudentCreateData,
    buildStudentPatchData,
    mapStudentRecord
} = require('../../functions/src/crm/student-service');

const studentHelperSource = fs.readFileSync(
    path.join(process.cwd(), 'public/js/crm/students.js'),
    'utf8'
);

const sandbox = {
    window: {}
};
vm.createContext(sandbox);
vm.runInContext(studentHelperSource, sandbox);

const helper = sandbox.window.CrmStudents;
const context = {
    user: {
        uid: 'admin-1',
        email: 'admin@example.com'
    },
    serverTimestamp: () => 'SERVER_TS'
};

const payload = helper.buildPayload({
    inputStudentName: { value: 'Alice Nguyen' },
    inputStudentLabel: { value: 'Warm lead' },
    inputStudentPhone: { value: '0123456789' },
    inputStudentEmail: { value: 'alice@example.com' },
    inputStudentZalo: { value: 'alice-zalo' },
    inputStudentFacebook: { value: 'alice.fb' },
    inputScoreOverall: { value: '88' },
    inputScoreListening: { value: '86' },
    inputScoreReading: { value: '84' },
    inputScoreSpeaking: { value: '82' },
    inputScoreWriting: { value: '80' },
    inputStudentDueDate: { value: '2026-03-20' },
    inputStudentLevel: { value: 'B1' }
});

const created = buildStudentCreateData(payload, context);
const patched = buildStudentPatchData(created, {
    lifecycleStage: 'enrolled',
    learningProfile: {
        speaking: 91
    }
}, context);
const mapped = mapStudentRecord({ id: 'student-1', ...patched });
const buckets = helper.splitStudents([mapped]);

assert.strictEqual(mapped.learningProfile.speaking, 91);
assert.strictEqual(mapped.learningProfile.entryLevel, 'B1');
assert.strictEqual(buckets.potential.length, 0);
assert.strictEqual(buckets.studentData.length, 1);

console.log('student profile smoke passed');
