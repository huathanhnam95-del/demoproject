const assert = require('assert');
const {
    deriveFinanceWorkflowState
} = require('../../functions/src/crm/finance-service');

const unpaid = deriveFinanceWorkflowState({
    invoices: [
        { invoiceId: 'invoice-1', status: 'open', outstandingAmount: 500, paidAmount: 0 }
    ],
    enrollments: [],
    matches: []
});

assert.strictEqual(unpaid.nextAction, 'collect_payment');
assert.strictEqual(unpaid.requiresPayment, true);

const assignClassroom = deriveFinanceWorkflowState({
    invoices: [
        { invoiceId: 'invoice-1', status: 'paid', outstandingAmount: 0, paidAmount: 500 }
    ],
    enrollments: [],
    matches: [
        { classroomId: 'class-1', fitScore: 92, recommended: true }
    ]
});

assert.strictEqual(assignClassroom.nextAction, 'assign_classroom');
assert.strictEqual(assignClassroom.primaryClassroomId, 'class-1');

const selectClassroom = deriveFinanceWorkflowState({
    invoices: [
        { invoiceId: 'invoice-1', status: 'paid', outstandingAmount: 0, paidAmount: 500 }
    ],
    enrollments: [],
    matches: [
        { classroomId: 'class-1', fitScore: 92, recommended: true },
        { classroomId: 'class-2', fitScore: 88, recommended: false }
    ]
});

assert.strictEqual(selectClassroom.nextAction, 'select_classroom');

const startAttendance = deriveFinanceWorkflowState({
    invoices: [
        { invoiceId: 'invoice-1', status: 'paid', outstandingAmount: 0, paidAmount: 500 }
    ],
    enrollments: [
        { enrollmentId: 'enrollment-1', status: 'active', classId: 'class-1' }
    ],
    matches: [
        { classroomId: 'class-1', fitScore: 92, recommended: true }
    ]
});

assert.strictEqual(startAttendance.nextAction, 'start_attendance');
assert.strictEqual(startAttendance.activeEnrollmentId, 'enrollment-1');

const existingEnrollmentWithoutInvoice = deriveFinanceWorkflowState({
    invoices: [],
    enrollments: [
        { enrollmentId: 'enrollment-2', status: 'active', classId: 'class-2' }
    ],
    matches: []
});

assert.strictEqual(existingEnrollmentWithoutInvoice.nextAction, 'start_attendance');
assert.strictEqual(existingEnrollmentWithoutInvoice.requiresPayment, false);

console.log('finance enrollment handoff passed');
