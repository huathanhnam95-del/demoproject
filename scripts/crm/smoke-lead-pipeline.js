const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {
    buildLeadCreateData,
    buildLeadPatchData,
    buildLeadConversion,
    mapLeadRecord
} = require('../../functions/src/crm/lead-service');
const { mapStudentRecord } = require('../../functions/src/crm/student-service');

function loadBrowserHelper(relativePath, globalName) {
    const source = fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
    const sandbox = { window: {} };
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox);
    return sandbox.window[globalName];
}

const helper = loadBrowserHelper('public/js/crm/leads.js', 'CrmLeads');
const context = {
    user: {
        uid: 'admin-1',
        email: 'admin@example.com'
    },
    serverTimestamp: () => 'SERVER_TS'
};

const payload = helper.buildPayload({
    inputLeadName: { value: 'Lead Nguyen' },
    inputLeadEmail: { value: 'lead@example.com' },
    inputLeadPhone: { value: '0123' },
    inputLeadFacebookDisplayName: { value: 'Lead Nguyen FB' },
    inputLeadFacebookProfileUrl: { value: 'https://facebook.com/lead.nguyen' },
    inputLeadRealName: { value: 'Nguyen Van Lead' },
    inputLeadDateOfBirth: { value: '2001-05-20' },
    inputLeadSource: { value: 'facebook' },
    inputLeadStage: { value: 'new' },
    inputLeadProbability: { value: '35' },
    inputLeadLearningNeeds: { value: 'Needs evening IELTS speaking support' },
    inputLeadPreferredLearningDays: { value: 'Tuesday, Thursday' },
    inputLeadPreferredLearningHours: { value: '19:00-21:00, 20:00-22:00' },
    inputLeadMessengerThreadUrl: { value: 'https://m.me/t/lead-nguyen' },
    inputLeadMessengerLastContactAt: { value: '2026-03-11T09:15' },
    inputLeadMessengerStatus: { value: 'awaiting_reply' }
});

const created = buildLeadCreateData(payload, context);
const progressed = buildLeadPatchData(created, { stage: 'counseling', probability: 70 }, context);
const conversion = buildLeadConversion({
    leadId: 'lead-1',
    lead: progressed,
    context
});
const mappedLead = mapLeadRecord({ id: 'lead-1', ...progressed });
const mappedStudent = mapStudentRecord({ id: 'student-1', ...conversion.student });

assert.strictEqual(mappedLead.stage, 'counseling');
assert.strictEqual(mappedLead.facebookDisplayName, 'Lead Nguyen FB');
assert.strictEqual(mappedLead.facebookProfileUrl, 'https://facebook.com/lead.nguyen');
assert.deepStrictEqual(Array.from(mappedLead.preferredLearningDays || []), ['Tuesday', 'Thursday']);
assert.deepStrictEqual(Array.from(mappedLead.preferredLearningHours || []), ['19:00-21:00', '20:00-22:00']);
assert.strictEqual(mappedLead.messengerStatus, 'awaiting_reply');
assert.strictEqual(mappedStudent.lifecycleStage, 'counseling');
assert.strictEqual(mappedStudent.acquisitionSource, 'facebook');
assert.strictEqual(mappedStudent.facebook, 'Lead Nguyen FB');
assert.strictEqual(helper.summarize([mappedLead]).counseling, 1);
assert.strictEqual(helper.hasAnyContact(payload), true);

console.log('lead pipeline smoke passed');
