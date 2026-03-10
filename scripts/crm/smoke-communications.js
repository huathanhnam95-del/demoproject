const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {
    buildTemplateCreateData,
    buildAutomationRuleCreateData,
    generateQueueEntries
} = require('../../functions/src/crm/automation-service');

function loadBrowserHelper(relativePath, globalName) {
    const source = fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
    const sandbox = { window: {} };
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox);
    return sandbox.window[globalName];
}

const helper = loadBrowserHelper('public/js/crm/communications.js', 'CrmCommunications');

const template = buildTemplateCreateData(helper.buildTemplatePayload({
    inputTemplateName: { value: 'Attendance Alert' },
    inputTemplateChannel: { value: 'email' },
    inputTemplateSubject: { value: 'Attendance alert' },
    inputTemplateBody: { value: 'Please contact the student.' }
}), {
    user: { uid: 'admin-1', email: 'admin@example.com' },
    serverTimestamp: () => 'SERVER_TS'
});

const rule = buildAutomationRuleCreateData(helper.buildRulePayload({
    inputRuleName: { value: 'Attendance intervention' },
    inputRuleTriggerType: { value: 'attendance_intervention' },
    inputRuleTemplateId: { value: 'template-1' }
}), {
    user: { uid: 'admin-1', email: 'admin@example.com' },
    serverTimestamp: () => 'SERVER_TS'
});

const queue = generateQueueEntries({
    rule: { ...rule, ruleId: 'rule-1' },
    template: { ...template, templateId: 'template-1' },
    targets: [
        {
            studentId: 'student-1',
            dedupeKey: 'rule-1:student-1:today',
            payload: { email: 'alice@example.com' }
        }
    ],
    existingKeys: new Set()
}, {
    user: { uid: 'admin-1', email: 'admin@example.com' },
    serverTimestamp: () => 'SERVER_TS'
});

assert.strictEqual(queue.length, 1);
assert.strictEqual(helper.formatQueueStatus(queue[0].status), 'Pending');

console.log('communications smoke passed');
