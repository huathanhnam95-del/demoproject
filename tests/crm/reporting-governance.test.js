const assert = require('assert');
const {
    buildDashboardSummary,
    buildFunnelMetrics,
    buildRevenueByCourse
} = require('../../functions/src/crm/reporting-service');
const {
    CRM_ROLES,
    buildAuditLogEntry,
    detectStudentDuplicates,
    buildMergeJob,
    canAccessCrmRole
} = require('../../functions/src/crm/governance-service');

assert.deepStrictEqual(CRM_ROLES, ['admin', 'counselor', 'teacher', 'finance']);

const summary = buildDashboardSummary({
    leads: [
        { stage: 'new', source: 'facebook' },
        { stage: 'won', source: 'referral' }
    ],
    students: [
        { ownerUid: 'counselor-1' }
    ],
    enrollments: [
        { classId: 'class-1', status: 'active' },
        { classId: 'class-1', status: 'active' }
    ],
    attendance: [
        { studentId: 'student-1', atRisk: { isAtRisk: true } }
    ],
    invoices: [
        { courseId: 'course-1', netAmount: 1000, outstandingAmount: 400 }
    ],
    payments: [
        { amount: 600 }
    ]
});

assert.strictEqual(summary.funnelConversionRate, 0.5);
assert.strictEqual(summary.attendanceRiskCount, 1);
assert.strictEqual(summary.totalRevenueCollected, 600);
assert.strictEqual(summary.totalOutstandingBalance, 400);

const funnel = buildFunnelMetrics([
    { stage: 'new' },
    { stage: 'contacted' },
    { stage: 'won' }
]);

assert.strictEqual(funnel.new, 1);
assert.strictEqual(funnel.won, 1);

const revenue = buildRevenueByCourse({
    invoices: [
        { courseId: 'course-1', netAmount: 1000, outstandingAmount: 400 },
        { courseId: 'course-2', netAmount: 500, outstandingAmount: 0 }
    ],
    payments: [
        { invoiceId: 'invoice-1', amount: 600, courseId: 'course-1' },
        { invoiceId: 'invoice-2', amount: 500, courseId: 'course-2' }
    ]
});

assert.strictEqual(revenue[0].courseId, 'course-1');
assert.strictEqual(revenue[0].collectedAmount, 600);

const audit = buildAuditLogEntry({
    actorUid: 'admin-1',
    actorEmail: 'admin@example.com',
    action: 'student.update',
    entityType: 'student',
    entityId: 'student-1'
});

assert.strictEqual(audit.action, 'student.update');
assert.strictEqual(audit.entityId, 'student-1');

const duplicates = detectStudentDuplicates([
    { studentId: 'student-1', name: 'Alice', email: 'alice@example.com', phone: '0901' },
    { studentId: 'student-2', name: 'Alice', email: 'alice@example.com', phone: '0902' },
    { studentId: 'student-3', name: 'Bob', email: 'bob@example.com', phone: '0901' }
]);

assert.strictEqual(duplicates.length, 2);

const mergeJob = buildMergeJob({
    primaryStudentId: 'student-1',
    duplicateStudentIds: ['student-2']
}, {
    user: { uid: 'admin-1', email: 'admin@example.com' },
    serverTimestamp: () => 'SERVER_TS'
});

assert.strictEqual(mergeJob.status, 'pending');
assert.strictEqual(mergeJob.primaryStudentId, 'student-1');

assert.strictEqual(canAccessCrmRole('admin', 'finance'), true);
assert.strictEqual(canAccessCrmRole('teacher', 'finance'), false);

console.log('reporting governance service passed');
