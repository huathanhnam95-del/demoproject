const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { buildStudentCreateData, mapStudentRecord } = require('../../functions/src/crm/student-service');

function loadBrowserHelper(relativePath, globalName) {
    const source = fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
    const sandbox = { window: {} };
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox);
    return sandbox.window[globalName];
}

const helper = loadBrowserHelper('public/js/crm/student-360.js', 'CrmStudent360');

const payload = helper.buildPayload({
    inputTargetExam: { value: 'PTE' },
    inputTargetScore: { value: '79' },
    inputPreferredSchedule: { value: 'Weeknights' },
    inputScoreHistory: { value: '2026-03-01|58\n2026-03-10|64' },
    inputGuardianContacts: { value: 'Parent A|0901|parent@example.com' },
    inputCompanyContacts: { value: 'Company X|hr@company.com|0902' },
    inputDocumentRefs: { value: 'Passport|crmStudents/student-1/docs/passport.pdf' },
    inputCounselingNotes: { value: 'Needs evening schedule.' }
});

const created = buildStudentCreateData({
    name: 'Alice',
    email: 'alice@example.com',
    ...payload
}, {
    user: { uid: 'admin-1', email: 'admin@example.com' },
    serverTimestamp: () => 'SERVER_TS'
});

const mapped = mapStudentRecord({ id: 'student-1', ...created });

assert.strictEqual(mapped.targets.exam, 'PTE');
assert.strictEqual(mapped.targets.score, 79);
assert.strictEqual(mapped.contacts.guardians[0].name, 'Parent A');
assert.strictEqual(mapped.documentRefs[0].name, 'Passport');

console.log('student 360 smoke passed');
