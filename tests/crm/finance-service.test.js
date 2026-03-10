const assert = require('assert');
const {
    COMMISSION_STATUSES,
    buildInvoiceCreateData,
    buildInvoicePatchData,
    buildPaymentCreateData,
    applyPaymentToInvoice,
    buildCommissionRecords,
    summarizeFinance
} = require('../../functions/src/crm/finance-service');

const context = {
    user: {
        uid: 'finance-1',
        email: 'finance@example.com'
    },
    serverTimestamp: () => 'SERVER_TS'
};

assert.deepStrictEqual(COMMISSION_STATUSES, ['pending', 'approved', 'paid']);

const invoice = buildInvoiceCreateData({
    studentId: 'student-1',
    enrollmentId: 'enrollment-1',
    courseId: 'course-1',
    amount: 1000,
    discountAmount: 100,
    dueDate: '2026-03-20',
    commissionSplits: {
        counselor: { actorUid: 'c-1', amount: 50 },
        teacher: { actorUid: 't-1', amount: 75 },
        agent: { actorUid: 'a-1', amount: 25 }
    }
}, context);

assert.strictEqual(invoice.amount, 1000);
assert.strictEqual(invoice.discountAmount, 100);
assert.strictEqual(invoice.netAmount, 900);
assert.strictEqual(invoice.outstandingAmount, 900);

const invoicePatch = buildInvoicePatchData(invoice, {
    refundStatus: 'requested',
    notes: 'Family asked about payment plan'
}, context);

assert.strictEqual(invoicePatch.refundStatus, 'requested');
assert.strictEqual(invoicePatch.notes, 'Family asked about payment plan');

const payment = buildPaymentCreateData({
    invoiceId: 'invoice-1',
    studentId: 'student-1',
    enrollmentId: 'enrollment-1',
    amount: 300,
    method: 'bank-transfer'
}, context);

assert.strictEqual(payment.amount, 300);
assert.strictEqual(payment.invoiceId, 'invoice-1');

const afterPayment = applyPaymentToInvoice(invoice, [payment]);
assert.strictEqual(afterPayment.paidAmount, 300);
assert.strictEqual(afterPayment.outstandingAmount, 600);
assert.strictEqual(afterPayment.status, 'partial');

const commissions = buildCommissionRecords({
    invoiceId: 'invoice-1',
    paymentId: 'payment-1',
    studentId: 'student-1',
    enrollmentId: 'enrollment-1',
    commissionSplits: invoice.commissionSplits
}, context);

assert.strictEqual(commissions.length, 3);
assert.strictEqual(commissions[0].status, 'pending');

const summary = summarizeFinance({
    invoices: [
        { ...afterPayment, invoiceId: 'invoice-1' },
        {
            ...buildInvoiceCreateData({
                studentId: 'student-1',
                enrollmentId: 'enrollment-1',
                courseId: 'course-1',
                amount: 500,
                dueDate: '2026-03-25'
            }, context),
            invoiceId: 'invoice-2'
        }
    ],
    payments: [payment]
});

assert.strictEqual(summary.totalInvoiced, 1400);
assert.strictEqual(summary.totalPaid, 300);
assert.strictEqual(summary.totalOutstanding, 1100);
assert.strictEqual(summary.nextDueDate, '2026-03-20');

assert.throws(
    () => buildInvoiceCreateData({ studentId: 'student-1', amount: 0 }, context),
    /Invoice requires/
);

assert.throws(
    () => buildPaymentCreateData({ invoiceId: 'invoice-1', amount: 0 }, context),
    /Payment requires/
);

console.log('finance service passed');
