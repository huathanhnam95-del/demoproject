'use strict';
const crypto = require('crypto');
const C = require('./collections');
const F = require('./finance-service');
const { buildEnrollmentPatchData, buildClassroomMemberData } = require('./enrollment-service');
const { buildStudentPatchData } = require('./student-service');
const { queuePracticeJobs } = require('./workflow-write-service');
const clean = value => String(value || '').trim();
function fail(code, message, status = 400) { throw Object.assign(new Error(message), { status, code }); }
function rate(value) { if (value === null || value === undefined || value === '') return null; const n = Math.round(Number(value)); return Number.isFinite(n) && n >= 0 && n <= 10000 ? n : null; }
function normalizeIntentString(value) { return clean(value) || null; }
function normalizeIntentCurrency(value) {
    const normalized = clean(value).toUpperCase();
    return ['VND', 'AUD', 'USD'].includes(normalized) ? normalized : 'VND';
}
function normalizeIntentMoney(value) {
    const numeric = Number(String(value ?? '').replace(/,/g, ''));
    if (!Number.isFinite(numeric)) return 0;
    // Keep caller precision in the digest. The invoice currency is resolved
    // only after the receipt lookup, and collapsing USD cents as VND would let
    // two changed requests share one operation key.
    return Math.max(0, numeric);
}
function normalizePaymentIntent(input = {}) {
    const currency = normalizeIntentCurrency(input.currency);
    return {
        invoiceId: normalizeIntentString(input.invoiceId),
        studentId: normalizeIntentString(input.studentId),
        enrollmentId: normalizeIntentString(input.enrollmentId),
        currency,
        amount: normalizeIntentMoney(input.amount),
        method: normalizeIntentString(input.method) || 'bank-transfer',
        paymentDate: Object.prototype.hasOwnProperty.call(input, 'paymentDate')
            ? normalizeIntentString(input.paymentDate)
            : null,
        refundStatus: normalizeIntentString(input.refundStatus) || 'none',
        notes: normalizeIntentString(input.notes),
        reference: normalizeIntentString(input.reference)
    };
}
function paymentIntentDigest(input) {
    return crypto.createHash('sha256')
        .update(JSON.stringify(normalizePaymentIntent(input)), 'utf8')
        .digest('hex');
}
function operationIdFor(input) {
    const operationId = clean(input?.operationId);
    if (operationId && !/^[A-Za-z0-9_-]{1,128}$/.test(operationId)) {
        fail('INVALID_OPERATION_ID', 'Payment operationId is invalid.');
    }
    return operationId || null;
}
async function required(tx, db, collection, id, code) {
    const ref = db.collection(collection).doc(id), snap = await tx.get(ref);
    if (!snap.exists) fail(code, 'Referenced CRM record not found.', 404);
    return { ref, data: snap.data() || {} };
}

async function createInvoice(db, input, context) {
    return db.runTransaction(async tx => {
        const studentId = clean(input.studentId);
        if (!studentId) fail('VALIDATION_ERROR', 'Invoice requires a student.');
        const { data: student } = await required(tx, db, C.CRM_STUDENTS, studentId, 'STUDENT_NOT_FOUND');
        let courseId = clean(input.courseId), enrollment;
        if (clean(input.enrollmentId)) {
            enrollment = (await required(tx, db, C.CRM_ENROLLMENTS, clean(input.enrollmentId), 'ENROLLMENT_NOT_FOUND')).data;
            if (clean(enrollment.studentId) !== studentId || (courseId && clean(enrollment.courseId) && courseId !== clean(enrollment.courseId))) fail('INVOICE_MISMATCH', 'Invoice must match its enrollment student and course.');
            courseId = courseId || clean(enrollment.courseId);
        }
        const course = courseId ? (await required(tx, db, C.CRM_COURSES, courseId, 'COURSE_NOT_FOUND')).data : null;
        let agentCommissionBps = rate(course?.agentCommissionBps);
        if (student.agentSourceId && courseId) {
            const source = await tx.get(db.collection(C.CRM_AGENT_SOURCES).doc(student.agentSourceId));
            if (source.exists) agentCommissionBps = rate(source.data()?.courseRates?.[courseId]) ?? agentCommissionBps;
        }
        const invoice = F.buildInvoiceCreateData({ ...input, studentId, courseId, agentSourceId: student.agentSourceId || null, agentCommissionBps }, context);
        const ref = db.collection(C.CRM_INVOICES).doc();
        tx.set(ref, invoice);
        return { invoiceId: ref.id, invoice };
    });
}

async function recordPayment(db, input, context) {
    const stableNowMs = context.nowMs ?? Date.now();
    const operationId = operationIdFor(input);
    const requestDigest = operationId ? paymentIntentDigest(input) : null;
    let replayedOperation = false;
    const transactionResult = await db.runTransaction(async tx => {
        const actorUid = clean(context.user?.uid);
        if (typeof context.authorize === 'function') {
            const authorized = await context.authorize({ tx, actorUid, operationId, requestDigest });
            if (authorized !== true) fail('FORBIDDEN', 'Admin access required.', 403);
        }

        const operationRef = operationId ? db.collection(C.CRM_PAYMENT_OPERATIONS).doc(operationId) : null;
        if (operationRef) {
            const operationSnap = await tx.get(operationRef);
            if (operationSnap.exists) {
                replayedOperation = true;
                const operation = operationSnap.data() || {};
                if (clean(operation.actorUid) !== actorUid) {
                    fail('PAYMENT_OPERATION_OWNER_CONFLICT', 'Payment operationId belongs to another staff member.', 403);
                }
                if (clean(operation.requestDigest) !== requestDigest) {
                    fail('PAYMENT_OPERATION_CONFLICT', 'Payment operationId was already used with different payment details.', 409);
                }
                if (operation.status === 'committed' && operation.result) return operation.result;
                fail('PAYMENT_OPERATION_CONFLICT', 'Payment operationId is not replayable.', 409);
            }
        }

        const invoiceId = clean(input.invoiceId);
        if (!invoiceId) fail('VALIDATION_ERROR', 'Payment requires an invoice.');
        const invoiceRecord = await required(tx, db, C.CRM_INVOICES, invoiceId, 'INVOICE_NOT_FOUND');
        const invoice = F.mapInvoiceRecord(invoiceRecord.data, invoiceId);
        let payment;
        try {
            payment = F.buildPaymentCreateData({
                ...input,
                currency: invoice.currency,
                paymentDate: input.paymentDate || new Date(stableNowMs).toISOString()
            }, context);
        } catch (error) {
            if ((error?.message || '').includes('Payment requires')) {
                fail('VALIDATION_ERROR', error.message);
            }
            throw error;
        }
        payment.reference = clean(input.reference) || null;
        if (invoice.status === 'paid') fail('INVOICE_ALREADY_PAID', 'This invoice is already paid.');
        if (invoice.studentId !== payment.studentId) fail('PAYMENT_MISMATCH', 'Payment student must match the invoice student.');
        payment.currency = invoice.currency;
        const enrollmentId = clean(payment.enrollmentId || invoice.enrollmentId);
        if (invoice.enrollmentId && enrollmentId !== invoice.enrollmentId) fail('PAYMENT_MISMATCH', 'Payment enrollment must match the invoice enrollment.');
        payment.enrollmentId = enrollmentId || null;
        const enrollmentRecord = enrollmentId ? await required(tx, db, C.CRM_ENROLLMENTS, enrollmentId, 'ENROLLMENT_NOT_FOUND') : null;
        if (enrollmentRecord && enrollmentRecord.data.studentId !== payment.studentId) fail('PAYMENT_MISMATCH', 'Payment student must match the enrollment student.');
        const studentRecord = await required(tx, db, C.CRM_STUDENTS, payment.studentId, 'STUDENT_NOT_FOUND');
        const payments = await tx.get(db.collection(C.CRM_PAYMENTS).where('invoiceId', '==', payment.invoiceId));
        const updatedInvoice = F.applyPaymentToInvoice(invoice, [...payments.docs.map(doc => F.mapPaymentRecord(doc, doc.id)), payment]);
        if (updatedInvoice.status === 'paid' && !invoice.paidAt) updatedInvoice.paidAt = context.serverTimestamp();
        const paymentRef = db.collection(C.CRM_PAYMENTS).doc();
        let updatedEnrollment = null, updatedStudent = null, memberRef = null;
        if (updatedInvoice.status === 'paid' && enrollmentRecord) {
            const enrollment = enrollmentRecord.data;
            if (enrollment.classId) await required(tx, db, C.CRM_CLASSROOMS, enrollment.classId, 'CLASSROOM_NOT_FOUND');
            const sync = F.buildPaidEnrollmentSyncPatch({ invoice: updatedInvoice, enrollment, student: studentRecord.data }, context);
            if (sync) {
                updatedEnrollment = buildEnrollmentPatchData(enrollment, sync.enrollmentPatch, context);
                updatedStudent = buildStudentPatchData(studentRecord.data, sync.studentPatch, context);
                if (updatedEnrollment.studentUid && updatedEnrollment.classId) memberRef = db.collection(C.CRM_CLASSROOMS).doc(updatedEnrollment.classId).collection(C.CLASSROOM_MEMBERS).doc(updatedEnrollment.studentUid);
            }
        }
        const commissions = F.buildCommissionRecords({ invoiceId: payment.invoiceId, paymentId: paymentRef.id, studentId: payment.studentId, enrollmentId: payment.enrollmentId, commissionSplits: invoice.commissionSplits }, { ...context, currency: invoice.currency });
        let agentCommission = null;
        if (updatedInvoice.status === 'paid') {
            const prior = await tx.get(db.collection(C.CRM_COMMISSIONS).where('invoiceId', '==', payment.invoiceId).where('role', '==', 'agent_source'));
            if (prior.empty) agentCommission = F.buildAgentSourceCommissionRecord({ invoice: updatedInvoice, paymentId: paymentRef.id }, { ...context, currency: invoice.currency });
        }
        const result = { paymentId: paymentRef.id, payment, invoice: updatedInvoice, commissionsCreated: commissions.length, agentSourceCommissionsCreated: agentCommission ? 1 : 0, enrollmentActivated: !!updatedEnrollment, enrollment: updatedEnrollment, student: updatedStudent };
        // Every linked read precedes the first write, including commission dedupe.
        tx.set(paymentRef, payment);
        tx.set(invoiceRecord.ref, updatedInvoice, { merge: true });
        if (updatedEnrollment) {
            tx.set(enrollmentRecord.ref, updatedEnrollment, { merge: true });
            tx.set(studentRecord.ref, updatedStudent, { merge: true });
            if (memberRef) tx.set(memberRef, buildClassroomMemberData(updatedEnrollment), { merge: true });
            queuePracticeJobs(tx, db, studentRecord.data, context);
        }
        for (const commission of commissions) tx.set(db.collection(C.CRM_COMMISSIONS).doc(), commission);
        if (agentCommission) tx.set(db.collection(C.CRM_COMMISSIONS).doc(), agentCommission);
        if (operationRef) {
            tx.set(operationRef, {
                operationId,
                actorUid,
                requestDigest,
                status: 'committed',
                result,
                createdAt: context.serverTimestamp ? context.serverTimestamp() : new Date(),
                committedAt: context.serverTimestamp ? context.serverTimestamp() : new Date()
            });
        }
        return result;
    });
    if (!operationId) return transactionResult;
    // Firestore resolves server timestamp transforms when the transaction is
    // committed. Return the stored receipt so the first response and every
    // replay expose the same persisted timestamps and values.
    const receiptSnap = await db.collection(C.CRM_PAYMENT_OPERATIONS).doc(operationId).get();
    const response = receiptSnap.exists && receiptSnap.data()?.result
        ? receiptSnap.data().result
        : transactionResult;
    if (replayedOperation && response && typeof response === 'object') {
        Object.defineProperty(response, '__operationReplay', { value: true, enumerable: false });
    }
    return response;
}

module.exports = { createInvoice, recordPayment };
