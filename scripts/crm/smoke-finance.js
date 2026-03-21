const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {
    buildInvoiceCreateData,
    buildPaymentCreateData,
    applyPaymentToInvoice,
    summarizeFinance,
    deriveFinanceWorkflowState
} = require('../../functions/src/crm/finance-service');

function loadBrowserHelper(relativePath, globalName) {
    const source = fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
    const sandbox = { window: {} };
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox);
    return sandbox.window[globalName] || sandbox[globalName];
}

loadBrowserHelper('public/js/crm/finance-workflow.js', 'CrmFinanceWorkflow');
const helper = loadBrowserHelper('public/js/crm/finance.js', 'CrmFinance');
const context = {
    user: {
        uid: 'finance-1',
        email: 'finance@example.com'
    },
    serverTimestamp: () => 'SERVER_TS'
};

const invoice = buildInvoiceCreateData({
    studentId: 'student-1',
    courseId: 'course-1',
    ...helper.buildInvoicePayload({
        inputInvoiceAmount: { value: '1200' },
        inputInvoiceDiscount: { value: '200' },
        inputInvoiceDueDate: { value: '2026-03-21' }
    })
}, context);

const payment = buildPaymentCreateData({
    invoiceId: 'invoice-1',
    studentId: 'student-1',
    ...helper.buildPaymentPayload({
        inputPaymentAmount: { value: '500' },
        inputPaymentMethod: { value: 'cash' }
    })
}, context);

const updated = applyPaymentToInvoice(invoice, [payment]);
const summary = summarizeFinance({
    invoices: [{ ...updated, invoiceId: 'invoice-1' }],
    payments: [payment]
});

assert.strictEqual(updated.outstandingAmount, 500);
assert.strictEqual(summary.totalPaid, 500);
assert.strictEqual(helper.formatMoney(summary.totalOutstanding), '500');

const workflow = deriveFinanceWorkflowState({
    invoices: [{ ...updated, invoiceId: 'invoice-1', status: 'paid', outstandingAmount: 0, paidAmount: 1000 }],
    enrollments: [],
    matches: [{ classroomId: 'class-1', fitScore: 80, recommended: true }]
});

assert.strictEqual(workflow.nextAction, 'assign_classroom');

console.log('finance smoke passed');
