const {
    CRM_INVOICES,
    CRM_PAYMENTS,
    CRM_COMMISSIONS,
    CRM_STUDENTS,
    CRM_COURSES,
    CRM_AGENT_SOURCES
} = require('../../crm/collections');
const {
    buildInvoiceCreateData,
    buildInvoicePatchData,
    summarizeFinance,
    mapInvoiceRecord,
    mapPaymentRecord
} = require('../../crm/finance-service');
const { recordPayment } = require('../../crm/finance-write-service');
const { createAdmission } = require('../../crm/data-input/authorization');
const { auditSaved } = require('../../crm/workflow-write-service');

function normalizeRateBps(value) {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    const rounded = Math.round(numeric);
    if (rounded < 0 || rounded > 10000) return null;
    return rounded;
}

module.exports = function registerFinanceRoutes(router, deps) {
    const { db, sendSuccess, sendError, requireAdminHandlers, serverTimestamp, writeAuditLog } = deps;

    router.get('/invoices', ...requireAdminHandlers, async (req, res) => {
        try {
            const studentId = String(req.query?.studentId || '').trim();
            const requestedLimit = Number(req.query?.limit);
            const limit = Number.isFinite(requestedLimit)
                ? Math.min(500, Math.max(1, Math.floor(requestedLimit)))
                : 100;

            let query = db.collection(CRM_INVOICES).orderBy('createdAt', 'desc').limit(limit);
            if (studentId) {
                query = db.collection(CRM_INVOICES).where('studentId', '==', studentId).limit(limit);
            }

            const snap = await query.get();
            const invoices = snap.docs.map((doc) => mapInvoiceRecord(doc, doc.id));
            return sendSuccess(res, { invoices, count: invoices.length });
        } catch (error) {
            return sendError(res, 500, 'LIST_INVOICES_ERROR', 'Failed to list invoices.', error?.message || error);
        }
    });

    router.post('/invoices', ...requireAdminHandlers, async (req, res) => {
        try {
            const studentId = String(req.body?.studentId || '').trim();
            if (!studentId) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Invoice requires studentId and a positive amount.');
            }

            const studentSnap = await db.collection(CRM_STUDENTS).doc(studentId).get();
            if (!studentSnap.exists) {
                return sendError(res, 404, 'STUDENT_NOT_FOUND', 'Student not found.');
            }
            const student = studentSnap.data() || {};

            const requestedCourseId = String(req.body?.courseId || '').trim();
            let course = null;
            if (requestedCourseId) {
                const courseSnap = await db.collection(CRM_COURSES).doc(requestedCourseId).get();
                if (!courseSnap.exists) {
                    return sendError(res, 404, 'COURSE_NOT_FOUND', 'Course not found.');
                }
                course = courseSnap.data() || {};
            }

            let agentCommissionBps = normalizeRateBps(course?.agentCommissionBps);
            if (student.agentSourceId && requestedCourseId) {
                const agentSourceSnap = await db.collection(CRM_AGENT_SOURCES).doc(student.agentSourceId).get();
                if (agentSourceSnap.exists) {
                    const agentSourceData = agentSourceSnap.data() || {};
                    const customCourseRate = agentSourceData.courseRates?.[requestedCourseId];
                    const customCourseRateBps = normalizeRateBps(customCourseRate);
                    if (customCourseRateBps !== null) {
                        agentCommissionBps = customCourseRateBps;
                    }
                }
            }

            const invoice = buildInvoiceCreateData({
                ...(req.body || {}),
                agentSourceId: student.agentSourceId || null,
                agentCommissionBps
            }, {
                user: req.user,
                serverTimestamp
            });
            const ref = db.collection(CRM_INVOICES).doc();
            await ref.set(invoice);
            await writeAuditLog?.({
                action: 'invoice.create',
                entityType: 'invoice',
                entityId: ref.id,
                metadata: {
                    studentId: invoice.studentId,
                    enrollmentId: invoice.enrollmentId,
                    courseId: invoice.courseId,
                    agentSourceId: invoice.agentSourceId || null,
                    agentCommissionBps: invoice.agentCommissionBps ?? null
                }
            }, { user: req.user });
            return sendSuccess(res, { invoiceId: ref.id }, 'Invoice created.');
        } catch (error) {
            if ((error?.message || '').includes('Invoice requires')) {
                return sendError(res, 400, 'VALIDATION_ERROR', error.message);
            }
            return sendError(res, 500, 'CREATE_INVOICE_ERROR', 'Failed to create invoice.', error?.message || error);
        }
    });

    router.patch('/invoices/:invoiceId', ...requireAdminHandlers, async (req, res) => {
        try {
            const invoiceId = String(req.params.invoiceId || '').trim();
            if (!invoiceId) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Missing invoiceId.');
            }
            const ref = db.collection(CRM_INVOICES).doc(invoiceId);
            const snap = await ref.get();
            if (!snap.exists) {
                return sendError(res, 404, 'INVOICE_NOT_FOUND', 'Invoice not found.');
            }
            const requestedCurrency = Object.prototype.hasOwnProperty.call(req.body || {}, 'currency')
                ? String(req.body.currency || '').trim().toUpperCase()
                : '';
            const existingCurrency = String(snap.data()?.currency || 'VND').trim().toUpperCase() || 'VND';
            if (requestedCurrency && requestedCurrency !== existingCurrency) {
                const paymentSnap = await db.collection(CRM_PAYMENTS).where('invoiceId', '==', invoiceId).limit(1).get();
                if (!paymentSnap.empty) {
                    return sendError(res, 400, 'VALIDATION_ERROR', 'Cannot change invoice currency after payments have been recorded.');
                }
            }
            const next = buildInvoicePatchData(snap.data() || {}, req.body || {}, {
                user: req.user,
                serverTimestamp
            });
            await ref.set(next, { merge: true });
            await writeAuditLog?.({
                action: 'invoice.update',
                entityType: 'invoice',
                entityId: invoiceId,
                metadata: { status: next.status || null }
            }, { user: req.user });
            const updatedSnap = await ref.get();
            return sendSuccess(res, { invoice: mapInvoiceRecord(updatedSnap, invoiceId) }, 'Invoice updated.');
        } catch (error) {
            if ((error?.message || '').includes('No invoice fields provided')) {
                return sendError(res, 400, 'VALIDATION_ERROR', error.message);
            }
            return sendError(res, 500, 'UPDATE_INVOICE_ERROR', 'Failed to update invoice.', error?.message || error);
        }
    });

    router.post('/payments', ...requireAdminHandlers, async (req, res) => {
        try {
            const authClient = deps.paymentAuth || (deps.admin && typeof deps.admin.auth === 'function' ? deps.admin.auth() : null);
            const authorize = createAdmission({ db, authClient, identity: req.user });
            const result = await recordPayment(db, req.body || {}, {
                user: req.user,
                serverTimestamp,
                nowMs: Date.now(),
                authorize
            });
            const auditWarnings = result.__operationReplay ? [] : await auditSaved(writeAuditLog, {
                action: 'payment.create',
                entityType: 'payment',
                entityId: result.paymentId,
                metadata: {
                    invoiceId: result.payment.invoiceId,
                    studentId: result.payment.studentId,
                    commissionsCreated: result.commissionsCreated,
                    agentSourceCommissionsCreated: result.agentSourceCommissionsCreated,
                    enrollmentActivated: result.enrollmentActivated,
                    invoiceStatus: result.invoice.status
                }
            }, { user: req.user });
            return sendSuccess(res, auditWarnings.length ? { ...result, warnings: auditWarnings } : result, 'Payment recorded.');
        } catch (error) {
            const message = error?.message || error;
            if ((message || '').includes('Payment requires')) {
                return sendError(res, 400, 'VALIDATION_ERROR', message);
            }
            const status = Number.isInteger(error?.status) ? error.status : 500;
            const code = error?.code || 'CREATE_PAYMENT_ERROR';
            return sendError(res, status, code, status >= 500 ? 'Failed to record payment.' : message, status >= 500 ? message : undefined);
        }
    });

    router.get('/finance/summary', ...requireAdminHandlers, async (req, res) => {
        try {
            const studentId = String(req.query?.studentId || '').trim();
            const invoiceQuery = studentId
                ? db.collection(CRM_INVOICES).where('studentId', '==', studentId)
                : db.collection(CRM_INVOICES);
            const paymentQuery = studentId
                ? db.collection(CRM_PAYMENTS).where('studentId', '==', studentId)
                : db.collection(CRM_PAYMENTS);
            const commissionQuery = studentId
                ? db.collection(CRM_COMMISSIONS).where('studentId', '==', studentId)
                : db.collection(CRM_COMMISSIONS);

            const [invoiceSnap, paymentSnap, commissionSnap] = await Promise.all([
                invoiceQuery.get(),
                paymentQuery.get(),
                commissionQuery.get()
            ]);

            const invoices = invoiceSnap.docs.map((doc) => mapInvoiceRecord(doc, doc.id));
            const payments = paymentSnap.docs.map((doc) => mapPaymentRecord(doc, doc.id));
            const commissions = commissionSnap.docs.map((doc) => ({ commissionId: doc.id, ...doc.data() }));
            const summary = summarizeFinance({ invoices, payments });

            return sendSuccess(res, {
                ...summary,
                invoices,
                payments,
                commissions
            });
        } catch (error) {
            return sendError(res, 500, 'GET_FINANCE_SUMMARY_ERROR', 'Failed to load finance summary.', error?.message || error);
        }
    });
};
