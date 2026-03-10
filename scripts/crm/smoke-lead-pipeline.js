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
    inputLeadSource: { value: 'facebook' },
    inputLeadStage: { value: 'new' },
    inputLeadProbability: { value: '35' }
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
assert.strictEqual(mappedStudent.lifecycleStage, 'enrolled');
assert.strictEqual(mappedStudent.acquisitionSource, 'facebook');
assert.strictEqual(helper.summarize([mappedLead]).counseling, 1);

console.log('lead pipeline smoke passed');
