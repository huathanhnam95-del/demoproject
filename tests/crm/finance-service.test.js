const assert = require('assert');
const {
    COMMISSION_STATUSES,
    buildInvoiceCreateData,
    buildInvoicePatchData,
    buildPaymentCreateData,
    buildPaidEnrollmentSyncPatch,
    applyPaymentToInvoice,
    buildCommissionRecords,
    buildAgentSourceCommissionRecord,
    summarizeFinance,
    deriveFinanceWorkflowState
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
    agentSourceId: 'agent-src-1',
    agentCommissionBps: 1000,
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
assert.strictEqual(invoice.agentSourceId, 'agent-src-1');
assert.strictEqual(invoice.agentCommissionBps, 1000);
assert.strictEqual(invoice.paidAt, null);

const invoicePatch = buildInvoicePatchData(invoice, {
    refundStatus: 'requested',
    notes: 'Family asked about payment plan'
}, context);

assert.strictEqual(invoicePatch.refundStatus, 'requested');
assert.strictEqual(invoicePatch.notes, 'Family asked about payment plan');

const preEnrollmentInvoice = buildInvoiceCreateData({
    studentId: 'student-1',
    courseId: 'course-1',
    amount: 400,
    dueDate: '2026-03-22'
}, context);

assert.strictEqual(preEnrollmentInvoice.studentId, 'student-1');
assert.strictEqual(preEnrollmentInvoice.enrollmentId, null);
assert.strictEqual(preEnrollmentInvoice.status, 'open');

const payment = buildPaymentCreateData({
    invoiceId: 'invoice-1',
    studentId: 'student-1',
    enrollmentId: 'enrollment-1',
    amount: 300,
    method: 'bank-transfer'
}, context);

assert.strictEqual(payment.amount, 300);
assert.strictEqual(payment.invoiceId, 'invoice-1');

const preEnrollmentPayment = buildPaymentCreateData({
    invoiceId: 'invoice-pre-enrollment-1',
    studentId: 'student-1',
    amount: 400,
    method: 'cash'
}, context);

assert.strictEqual(preEnrollmentPayment.enrollmentId, null);
assert.strictEqual(preEnrollmentPayment.amount, 400);

const afterPayment = applyPaymentToInvoice(invoice, [payment]);
assert.strictEqual(afterPayment.paidAmount, 300);
assert.strictEqual(afterPayment.outstandingAmount, 600);
assert.strictEqual(afterPayment.status, 'partial');

const settlementSync = buildPaidEnrollmentSyncPatch({
    invoice: {
        ...afterPayment,
        status: 'paid'
    },
    enrollment: {
        studentUid: null,
        studentName: 'Old Name',
        studentEmail: null,
        status: 'paused'
    },
    student: {
        name: 'Nguyen Student',
        email: 'student@example.com',
        linked_user_ids: ['uid-123']
    }
}, context);

assert.ok(settlementSync);
assert.strictEqual(settlementSync.studentUid, 'uid-123');
assert.strictEqual(settlementSync.enrollmentPatch.status, 'active');
assert.strictEqual(settlementSync.enrollmentPatch.studentName, 'Old Name');
assert.strictEqual(settlementSync.enrollmentPatch.studentEmail, 'student@example.com');
assert.strictEqual(settlementSync.studentPatch.lifecycleStage, 'enrolled');

assert.strictEqual(
    buildPaidEnrollmentSyncPatch({
        invoice: afterPayment,
        enrollment: { status: 'paused' },
        student: {}
    }, context),
    null
);

const commissions = buildCommissionRecords({
    invoiceId: 'invoice-1',
    paymentId: 'payment-1',
    studentId: 'student-1',
    enrollmentId: 'enrollment-1',
    commissionSplits: invoice.commissionSplits
}, context);

assert.strictEqual(commissions.length, 3);
assert.strictEqual(commissions[0].status, 'pending');

const agentCommission = buildAgentSourceCommissionRecord({
    invoice: {
        invoiceId: 'invoice-1',
        studentId: 'student-1',
        enrollmentId: 'enrollment-1',
        courseId: 'course-1',
        currency: 'VND',
        netAmount: 900,
        agentSourceId: 'agent-src-1',
        agentCommissionBps: 1000
    },
    paymentId: 'payment-1'
}, context);

assert.ok(agentCommission);
assert.strictEqual(agentCommission.role, 'agent_source');
assert.strictEqual(agentCommission.invoiceId, 'invoice-1');
assert.strictEqual(agentCommission.paymentId, 'payment-1');
assert.strictEqual(agentCommission.agentSourceId, 'agent-src-1');
assert.strictEqual(agentCommission.rateBps, 1000);
assert.strictEqual(agentCommission.baseAmount, 900);
assert.strictEqual(agentCommission.amount, 90);

assert.strictEqual(buildAgentSourceCommissionRecord({
    invoice: {
        invoiceId: 'invoice-1',
        netAmount: 900,
        agentSourceId: null,
        agentCommissionBps: 1000
    },
    paymentId: 'payment-1'
}, context), null);

assert.strictEqual(buildAgentSourceCommissionRecord({
    invoice: {
        invoiceId: 'invoice-1',
        netAmount: 900,
        agentSourceId: 'agent-src-1',
        agentCommissionBps: 0
    },
    paymentId: 'payment-1'
}, context), null);

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

const assignClassroomWorkflow = deriveFinanceWorkflowState({
    invoices: [{ ...preEnrollmentInvoice, invoiceId: 'invoice-pre-enrollment-1', status: 'paid', outstandingAmount: 0, paidAmount: 400 }],
    enrollments: [],
    matches: [{ classroomId: 'class-1', fitScore: 88, recommended: true }]
});

assert.strictEqual(assignClassroomWorkflow.nextAction, 'assign_classroom');
assert.strictEqual(assignClassroomWorkflow.requiresPayment, false);

const selectClassroomWorkflow = deriveFinanceWorkflowState({
    invoices: [{ ...preEnrollmentInvoice, invoiceId: 'invoice-pre-enrollment-1', status: 'paid', outstandingAmount: 0, paidAmount: 400 }],
    enrollments: [],
    matches: [
        { classroomId: 'class-1', fitScore: 88, recommended: true },
        { classroomId: 'class-2', fitScore: 84, recommended: false }
    ]
});

assert.strictEqual(selectClassroomWorkflow.nextAction, 'select_classroom');

const startAttendanceWorkflow = deriveFinanceWorkflowState({
    invoices: [{ ...preEnrollmentInvoice, invoiceId: 'invoice-pre-enrollment-1', status: 'paid', outstandingAmount: 0, paidAmount: 400 }],
    enrollments: [{ enrollmentId: 'enrollment-1', status: 'active', classId: 'class-1' }],
    matches: [{ classroomId: 'class-1', fitScore: 88, recommended: true }]
});

assert.strictEqual(startAttendanceWorkflow.nextAction, 'start_attendance');

const collectPaymentWorkflow = deriveFinanceWorkflowState({
    invoices: [{ ...preEnrollmentInvoice, invoiceId: 'invoice-pre-enrollment-1', status: 'open', outstandingAmount: 400, paidAmount: 0 }],
    enrollments: [],
    matches: []
});

assert.strictEqual(collectPaymentWorkflow.nextAction, 'collect_payment');
assert.strictEqual(collectPaymentWorkflow.requiresPayment, true);

assert.throws(
    () => buildInvoiceCreateData({ studentId: 'student-1', amount: 0 }, context),
    /Invoice requires/
);

assert.throws(
    () => buildPaymentCreateData({ invoiceId: 'invoice-1', amount: 0 }, context),
    /Payment requires/
);

console.log('finance service passed');
