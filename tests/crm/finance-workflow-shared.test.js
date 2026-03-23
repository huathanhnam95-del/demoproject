const assert = require('assert');
require('../../public/js/crm/finance-workflow');

const {
    deriveFinanceWorkflowState
} = globalThis.CrmFinanceWorkflow || {};

const result = deriveFinanceWorkflowState({
    invoices: [{ invoiceId: 'invoice-1', status: 'paid', outstandingAmount: 0, paidAmount: 500 }],
    enrollments: [],
    matches: [{ classroomId: 'class-1', fitScore: 90, recommended: true }]
});

assert.strictEqual(result.nextAction, 'assign_classroom');
assert.strictEqual(result.requiresPayment, false);

console.log('finance workflow shared passed');
