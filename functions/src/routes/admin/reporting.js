const {
    CRM_LEADS,
    CRM_STUDENTS,
    CRM_ENROLLMENTS,
    CRM_ATTENDANCE_RECORDS,
    CRM_INVOICES,
    CRM_PAYMENTS
} = require('../../crm/collections');
const {
    buildDashboardSummary,
    buildFunnelMetrics,
    buildRevenueByCourse,
    buildAttendanceRiskRows
} = require('../../crm/reporting-service');

module.exports = function registerReportingRoutes(router, deps) {
    const { db, sendSuccess, sendError, requireAdminHandlers } = deps;

    router.get('/dashboard/summary', ...requireAdminHandlers, async (req, res) => {
        try {
            const [leadSnap, studentSnap, enrollmentSnap, invoiceSnap, paymentSnap, attendanceSnap] = await Promise.all([
                db.collection(CRM_LEADS).get(),
                db.collection(CRM_STUDENTS).get(),
                db.collection(CRM_ENROLLMENTS).get(),
                db.collection(CRM_INVOICES).get(),
                db.collection(CRM_PAYMENTS).get(),
                db.collection(CRM_ATTENDANCE_RECORDS).get()
            ]);

            const summary = buildDashboardSummary({
                leads: leadSnap.docs.map((doc) => ({ leadId: doc.id, ...doc.data() })),
                students: studentSnap.docs.map((doc) => ({ studentId: doc.id, ...doc.data() })),
                enrollments: enrollmentSnap.docs.map((doc) => ({ enrollmentId: doc.id, ...doc.data() })),
                attendance: buildAttendanceRiskRows({
                    enrollments: enrollmentSnap.docs.map((doc) => ({ enrollmentId: doc.id, ...doc.data() })),
                    records: attendanceSnap.docs.map((doc) => ({ recordId: doc.id, ...doc.data() })),
                    students: studentSnap.docs.map((doc) => ({ studentId: doc.id, ...doc.data() }))
                }),
                invoices: invoiceSnap.docs.map((doc) => ({ invoiceId: doc.id, ...doc.data() })),
                payments: paymentSnap.docs.map((doc) => ({ paymentId: doc.id, ...doc.data() }))
            });

            return sendSuccess(res, { summary });
        } catch (error) {
            return sendError(res, 500, 'GET_DASHBOARD_SUMMARY_ERROR', 'Failed to load dashboard summary.', error?.message || error);
        }
    });

    router.get('/dashboard/funnel', ...requireAdminHandlers, async (req, res) => {
        try {
            const snap = await db.collection(CRM_LEADS).get();
            const funnel = buildFunnelMetrics(snap.docs.map((doc) => ({ leadId: doc.id, ...doc.data() })));
            return sendSuccess(res, { funnel });
        } catch (error) {
            return sendError(res, 500, 'GET_DASHBOARD_FUNNEL_ERROR', 'Failed to load funnel metrics.', error?.message || error);
        }
    });

    router.get('/dashboard/revenue', ...requireAdminHandlers, async (req, res) => {
        try {
            const [invoiceSnap, paymentSnap] = await Promise.all([
                db.collection(CRM_INVOICES).get(),
                db.collection(CRM_PAYMENTS).get()
            ]);
            const revenue = buildRevenueByCourse({
                invoices: invoiceSnap.docs.map((doc) => ({ invoiceId: doc.id, ...doc.data() })),
                payments: paymentSnap.docs.map((doc) => ({ paymentId: doc.id, ...doc.data() }))
            });
            return sendSuccess(res, { revenue });
        } catch (error) {
            return sendError(res, 500, 'GET_DASHBOARD_REVENUE_ERROR', 'Failed to load revenue metrics.', error?.message || error);
        }
    });
};
