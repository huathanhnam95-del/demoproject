const assert = require('assert');
const {
    AUTOMATION_TRIGGER_TYPES,
    buildTemplateCreateData,
    buildAutomationRuleCreateData,
    generateQueueEntries,
    markQueueEntryStatus
} = require('../../functions/src/crm/automation-service');

const context = {
    user: {
        uid: 'admin-1',
        email: 'admin@example.com'
    },
    serverTimestamp: () => 'SERVER_TS'
};

assert.deepStrictEqual(AUTOMATION_TRIGGER_TYPES, [
    'overdue_next_action',
    'upcoming_test_result_due',
    'unpaid_invoice',
    'attendance_intervention'
]);

const template = buildTemplateCreateData({
    name: 'Payment Reminder',
    channel: 'email',
    subject: 'Payment reminder',
    body: 'Please settle your outstanding balance.'
}, context);

assert.strictEqual(template.channel, 'email');
assert.strictEqual(template.name, 'Payment Reminder');

const rule = buildAutomationRuleCreateData({
    name: 'Unpaid invoice follow-up',
    triggerType: 'unpaid_invoice',
    templateId: 'template-1'
}, context);

assert.strictEqual(rule.triggerType, 'unpaid_invoice');
assert.strictEqual(rule.templateId, 'template-1');

const queueEntries = generateQueueEntries({
    rule: {
        ...rule,
        ruleId: 'rule-1'
    },
    template: {
        ...template,
        templateId: 'template-1'
    },
    targets: [
        {
            studentId: 'student-1',
            dedupeKey: 'rule-1:student-1:2026-03-10',
            payload: {
                email: 'alice@example.com'
            }
        }
    ],
    existingKeys: new Set()
}, context);

assert.strictEqual(queueEntries.length, 1);
assert.strictEqual(queueEntries[0].status, 'pending');

const idempotentEntries = generateQueueEntries({
    rule: {
        ...rule,
        ruleId: 'rule-1'
    },
    template: {
        ...template,
        templateId: 'template-1'
    },
    targets: [
        {
            studentId: 'student-1',
            dedupeKey: 'rule-1:student-1:2026-03-10',
            payload: {
                email: 'alice@example.com'
            }
        }
    ],
    existingKeys: new Set(['rule-1:student-1:2026-03-10'])
}, context);

assert.strictEqual(idempotentEntries.length, 0);

const sentEntry = markQueueEntryStatus(queueEntries[0], { status: 'sent' }, context);
assert.strictEqual(sentEntry.status, 'sent');

const failedEntry = markQueueEntryStatus(queueEntries[0], { status: 'failed', errorMessage: 'SMTP offline' }, context);
assert.strictEqual(failedEntry.status, 'failed');
assert.strictEqual(failedEntry.errorMessage, 'SMTP offline');

assert.throws(
    () => buildTemplateCreateData({ channel: 'email' }, context),
    /Template requires/
);

assert.throws(
    () => buildAutomationRuleCreateData({ name: 'Rule' }, context),
    /Automation rule requires/
);

console.log('automation service passed');
