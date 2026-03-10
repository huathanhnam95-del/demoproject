const {
    summarizeAttendanceByStudent,
    computeAtRiskStatus
} = require('./enrollment-service');

function toNumber(value) {
    const normalized = Number(value);
    return Number.isFinite(normalized) ? normalized : 0;
}

function buildFunnelMetrics(leads) {
    const metrics = {};
    (leads || []).forEach((lead) => {
        const stage = String(lead?.stage || 'unknown').trim() || 'unknown';
        metrics[stage] = (metrics[stage] || 0) + 1;
    });
    return metrics;
}

function buildRevenueByCourse({ invoices, payments }) {
    const invoiceList = Array.isArray(invoices) ? invoices : [];
    const paymentList = Array.isArray(payments) ? payments : [];
    const index = new Map();

    invoiceList.forEach((invoice) => {
        const courseId = String(invoice?.courseId || 'unassigned');
        if (!index.has(courseId)) {
            index.set(courseId, {
                courseId,
                invoicedAmount: 0,
                collectedAmount: 0,
                outstandingAmount: 0
            });
        }
        const row = index.get(courseId);
        row.invoicedAmount += toNumber(invoice?.netAmount);
        row.outstandingAmount += toNumber(invoice?.outstandingAmount);
    });

    paymentList.forEach((payment) => {
        const courseId = String(payment?.courseId || 'unassigned');
        if (!index.has(courseId)) {
            index.set(courseId, {
                courseId,
                invoicedAmount: 0,
                collectedAmount: 0,
                outstandingAmount: 0
            });
        }
        index.get(courseId).collectedAmount += toNumber(payment?.amount);
    });

    return Array.from(index.values());
}

function buildDashboardSummary({ leads, students, enrollments, attendance, invoices, payments }) {
    const leadList = Array.isArray(leads) ? leads : [];
    const studentList = Array.isArray(students) ? students : [];
    const enrollmentList = Array.isArray(enrollments) ? enrollments : [];
    const attendanceList = Array.isArray(attendance) ? attendance : [];
    const invoiceList = Array.isArray(invoices) ? invoices : [];
    const paymentList = Array.isArray(payments) ? payments : [];

    const wonLeads = leadList.filter((lead) => String(lead?.stage || '') === 'won').length;
    const conversionBase = leadList.length || 1;
    const attendanceRiskCount = new Set(
        attendanceList
            .filter((row) => row.atRisk?.isAtRisk)
            .map((row) => String(row.studentId || row.studentUid || row.recordId || '').trim())
            .filter(Boolean)
    ).size;

    return {
        funnelConversionRate: wonLeads / conversionBase,
        sourceRoiCount: new Set(leadList.map((lead) => String(lead?.source || 'unknown'))).size,
        counselorProductivityCount: new Set(studentList.map((student) => String(student?.ownerUid || '')).filter(Boolean)).size,
        classFillRate: enrollmentList.length ? enrollmentList.filter((row) => row.status === 'active').length / enrollmentList.length : 0,
        attendanceRiskCount,
        totalRevenueCollected: paymentList.reduce((sum, payment) => sum + toNumber(payment?.amount), 0),
        totalOutstandingBalance: invoiceList.reduce((sum, invoice) => sum + toNumber(invoice?.outstandingAmount), 0)
    };
}

function buildAttendanceRiskRows({ enrollments, records, students }) {
    const enrollmentList = Array.isArray(enrollments) ? enrollments : [];
    const recordList = Array.isArray(records) ? records : [];
    const studentList = Array.isArray(students) ? students : [];
    const studentIndex = new Map(studentList.map((student) => [String(student?.studentId || '').trim(), student]));

    return summarizeAttendanceByStudent({
        enrollments: enrollmentList,
        records: recordList
    }).map((summary) => {
        const student = studentIndex.get(String(summary.studentId || '').trim()) || {};
        return {
            ...summary,
            learningProfile: student.learningProfile || null,
            atRisk: computeAtRiskStatus({
                attendanceSummary: summary,
                learningProfile: student.learningProfile || {}
            })
        };
    });
}

module.exports = {
    buildDashboardSummary,
    buildFunnelMetrics,
    buildRevenueByCourse,
    buildAttendanceRiskRows
};
