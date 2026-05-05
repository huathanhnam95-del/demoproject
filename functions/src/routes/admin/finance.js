const {
    CRM_INVOICES,
    CRM_PAYMENTS,
    CRM_COMMISSIONS,
    CRM_ENROLLMENTS,
    CRM_STUDENTS,
    CRM_COURSES,
    CRM_CLASSROOMS,
    CLASSROOM_MEMBERS
} = require('../../crm/collections');
const {
    buildInvoiceCreateData,
    buildInvoicePatchData,
    buildPaymentCreateData,
    buildPaidEnrollmentSyncPatch,
    applyPaymentToInvoice,
    buildCommissionRecords,
    buildAgentSourceCommissionRecord,
    summarizeFinance,
    mapInvoiceRecord,
    mapPaymentRecord
} = require('../../crm/finance-service');
const {
    buildEnrollmentPatchData,
    buildClassroomMemberData
} = require('../../crm/enrollment-service');
const {
    buildStudentPatchData
} = require('../../crm/student-service');

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

            const invoice = buildInvoiceCreateData({
                ...(req.body || {}),
                agentSourceId: student.agentSourceId || null,
                agentCommissionBps: course?.agentCommissionBps ?? null
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
            const payment = buildPaymentCreateData(req.body || {}, {
                user: req.user,
                serverTimestamp
            });
            const invoiceRef = db.collection(CRM_INVOICES).doc(payment.invoiceId);
            const invoiceSnap = await invoiceRef.get();
            if (!invoiceSnap.exists) {
                return sendError(res, 404, 'INVOICE_NOT_FOUND', 'Invoice not found.');
            }

            const invoice = mapInvoiceRecord(invoiceSnap, payment.invoiceId);
            if (String(invoice.status || '').trim().toLowerCase() === 'paid') {
                return sendError(res, 400, 'INVOICE_ALREADY_PAID', 'This invoice is already paid and cannot accept additional payments.');
            }
            payment.currency = invoice.currency || payment.currency || 'VND';
            if (String(invoice.studentId || '') !== String(payment.studentId || '')) {
                return sendError(res, 400, 'PAYMENT_MISMATCH', 'Payment student must match the invoice student.');
            }
            const effectiveEnrollmentId = String(payment.enrollmentId || invoice.enrollmentId || '').trim();
            if (invoice.enrollmentId && effectiveEnrollmentId && String(invoice.enrollmentId || '') !== effectiveEnrollmentId) {
                return sendError(res, 400, 'PAYMENT_MISMATCH', 'Payment enrollment must match the invoice enrollment.');
            }
            payment.enrollmentId = effectiveEnrollmentId || null;

            let enrollmentRef = null;
            let enrollment = null;
            if (payment.enrollmentId) {
                enrollmentRef = db.collection(CRM_ENROLLMENTS).doc(payment.enrollmentId);
                const enrollmentSnap = await enrollmentRef.get();
                if (!enrollmentSnap.exists) {
                    return sendError(res, 404, 'ENROLLMENT_NOT_FOUND', 'Enrollment not found.');
                }
                enrollment = enrollmentSnap.data() || {};
                if (String(enrollment.studentId || '') !== String(payment.studentId || '')) {
                    return sendError(res, 400, 'PAYMENT_MISMATCH', 'Payment student must match the enrollment student.');
                }
            }

            const studentRef = db.collection(CRM_STUDENTS).doc(payment.studentId);
            const studentSnap = await studentRef.get();
            if (!studentSnap.exists) {
                return sendError(res, 404, 'STUDENT_NOT_FOUND', 'Student not found.');
            }

            const paymentRef = db.collection(CRM_PAYMENTS).doc();
            await paymentRef.set(payment);

            const paymentSnap = await db.collection(CRM_PAYMENTS).where('invoiceId', '==', payment.invoiceId).get();
            const payments = paymentSnap.docs.map((doc) => mapPaymentRecord(doc, doc.id));
            const updatedInvoice = applyPaymentToInvoice(invoice, payments);
            const invoiceWasPaid = String(invoice.status || '').trim().toLowerCase() === 'paid';
            const invoiceNowPaid = String(updatedInvoice.status || '').trim().toLowerCase() === 'paid';
            const invoicePatch = {
                ...updatedInvoice
            };
            if (!invoiceWasPaid && invoiceNowPaid && !invoice.paidAt) {
                invoicePatch.paidAt = serverTimestamp();
            }
            await invoiceRef.set(invoicePatch, { merge: true });
            const latestInvoiceSnap = await invoiceRef.get();
            const latestInvoice = mapInvoiceRecord(latestInvoiceSnap, payment.invoiceId);

            let updatedEnrollment = enrollment;
            let updatedStudent = studentSnap.data() || {};
            let enrollmentActivated = false;
            if (latestInvoice.status === 'paid' && enrollmentRef && enrollment) {
                const syncPatch = buildPaidEnrollmentSyncPatch({
                    invoice: latestInvoice,
                    enrollment,
                    student: studentSnap.data() || {}
                }, {
                    user: req.user,
                    serverTimestamp
                });

                if (syncPatch) {
                    updatedEnrollment = buildEnrollmentPatchData(enrollment, syncPatch.enrollmentPatch, {
                        user: req.user,
                        serverTimestamp
                    });
                    await enrollmentRef.set(updatedEnrollment, { merge: true });

                    if (updatedEnrollment.studentUid && updatedEnrollment.classId) {
                        await db.collection(CRM_CLASSROOMS)
                            .doc(updatedEnrollment.classId)
                            .collection(CLASSROOM_MEMBERS)
                            .doc(updatedEnrollment.studentUid)
                            .set(buildClassroomMemberData(updatedEnrollment), { merge: true });
                    }

                    updatedStudent = buildStudentPatchData(studentSnap.data() || {}, syncPatch.studentPatch, {
                        user: req.user,
                        serverTimestamp
                    });
                    await studentRef.set(updatedStudent, { merge: true });
                    enrollmentActivated = true;
                }
            }

            const commissions = buildCommissionRecords({
                invoiceId: payment.invoiceId,
                paymentId: paymentRef.id,
                studentId: payment.studentId,
                enrollmentId: payment.enrollmentId,
                commissionSplits: invoice.commissionSplits
            }, {
                user: req.user,
                serverTimestamp,
                currency: invoice.currency || payment.currency || 'VND'
            });

            await Promise.all(commissions.map((commission) => db.collection(CRM_COMMISSIONS).doc().set(commission)));
            let agentSourceCommissionsCreated = 0;
            if (!invoiceWasPaid && invoiceNowPaid) {
                const existingAgentCommissionSnap = await db.collection(CRM_COMMISSIONS)
                    .where('invoiceId', '==', payment.invoiceId)
                    .where('role', '==', 'agent_source')
                    .limit(1)
                    .get();
                if (existingAgentCommissionSnap.empty) {
                    const agentSourceCommission = buildAgentSourceCommissionRecord({
                        invoice: latestInvoice,
                        paymentId: paymentRef.id
                    }, {
                        user: req.user,
                        serverTimestamp,
                        currency: latestInvoice.currency || 'VND'
                    });
                    if (agentSourceCommission) {
                        await db.collection(CRM_COMMISSIONS).doc().set(agentSourceCommission);
                        agentSourceCommissionsCreated = 1;
                    }
                }
            }
            await writeAuditLog?.({
                action: 'payment.create',
                entityType: 'payment',
                entityId: paymentRef.id,
                metadata: {
                    invoiceId: payment.invoiceId,
                    studentId: payment.studentId,
                    commissionsCreated: commissions.length,
                    agentSourceCommissionsCreated,
                    enrollmentActivated,
                    invoiceStatus: latestInvoice.status
                }
            }, { user: req.user });

            return sendSuccess(res, {
                paymentId: paymentRef.id,
                payment,
                invoice: latestInvoice,
                commissionsCreated: commissions.length,
                agentSourceCommissionsCreated,
                enrollmentActivated,
                enrollment: enrollmentActivated ? updatedEnrollment : null,
                student: enrollmentActivated ? updatedStudent : null
            }, 'Payment recorded.');
        } catch (error) {
            if ((error?.message || '').includes('Payment requires')) {
                return sendError(res, 400, 'VALIDATION_ERROR', error.message);
            }
            return sendError(res, 500, 'CREATE_PAYMENT_ERROR', 'Failed to record payment.', error?.message || error);
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
