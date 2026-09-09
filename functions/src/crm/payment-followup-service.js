'use strict';
const { CRM_STUDENTS, CRM_PAYMENTS } = require('./collections');
const fail = (code, message, status = 409) => { throw Object.assign(new Error(message), { code, status }); };
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
function evidencePresent(payment) {
    const evidence = payment.receiptEvidence;
    return evidence?.version === 1 && /^[a-f0-9]{64}$/.test(evidence.sha256 || '')
        && evidence.objectPath === `crmPaymentEvidence/${payment.paymentId}/${evidence.sha256}.png`
        && typeof evidence.uploadedBy === 'string' && !!evidence.uploadedBy;
}
function projectPaymentFollowup(student, payments) {
    const required = student?.paymentFollowupRequired?.version === 1 && student.paymentFollowupRequired.source === 'lead_conversion';
    const summaries = payments.map(payment => {
        if (!validId(payment.paymentId) || typeof payment.amount !== 'number' || !Number.isFinite(payment.amount) || payment.amount <= 0) fail('PAYMENT_INTEGRITY', 'Recorded payment details require administrator review.');
        return { paymentId: payment.paymentId, amount: payment.amount, currency: payment.currency || null,
            paymentDate: payment.paymentDate || null, evidencePresent: evidencePresent(payment) };
    });
    const recorded = summaries.length > 0, complete = recorded && summaries.every(payment => payment.evidencePresent);
    return { required, paymentStatus: recorded ? 'recorded' : 'not_recorded',
        evidenceStatus: !recorded ? 'awaiting_payment' : complete ? 'complete' : 'missing',
        requiredActions: !required ? [] : !recorded ? ['payment_details', 'receipt_image'] : complete ? [] : ['receipt_image'], payments: summaries };
}
function createPaymentFollowupService({ db, authorize, storage, normalizeImage, now = Date.now }) {
    if (!db || typeof authorize !== 'function') throw TypeError('Current staff authorization is required.');
    async function payment(tx, actorUid, paymentId) {
        if (!validId(paymentId)) fail('INVALID_REQUEST', 'A valid payment is required.', 400);
        if (await authorize({ tx, actorUid }) !== true) fail('FORBIDDEN', 'Current CRM staff access is required.', 403);
        const ref = db.collection(CRM_PAYMENTS).doc(paymentId), snapshot = await tx.get(ref);
        if (!snapshot.exists) fail('PAYMENT_NOT_FOUND', 'Record the actual payment before attaching its receipt.', 404);
        const value = { ...snapshot.data(), paymentId };
        projectPaymentFollowup({}, [value]);
        if (!validId(value.studentId)) fail('PAYMENT_INTEGRITY', 'Payment has no valid student.');
        const student = await tx.get(db.collection(CRM_STUDENTS).doc(value.studentId));
        if (!student.exists) fail('STUDENT_NOT_FOUND', 'Payment student not found.', 404);
        return { ref, value };
    }
    const fingerprint = value => JSON.stringify([value.studentId, value.invoiceId, value.amount, value.currency, value.paymentDate]);
    return Object.freeze({
        async putEvidence(actorUid, paymentId, input) {
            const original = await db.runTransaction(tx => payment(tx, actorUid, paymentId));
            if (!storage || typeof normalizeImage !== 'function') fail('EVIDENCE_UNAVAILABLE', 'Receipt image storage is unavailable.', 503);
            const image = await normalizeImage(input);
            const objectPath = `crmPaymentEvidence/${paymentId}/${image.sha256}.png`;
            if (original.value.receiptEvidence && original.value.receiptEvidence.objectPath !== objectPath) fail('EVIDENCE_EXISTS', 'This payment already has receipt evidence. Preserve it for review.');
            // Retain an authenticated payment-bound reference before any bytes
            // are stored. Failed completion is recoverable with the same image;
            // never delete a hash another concurrent retry may have attached.
            await db.runTransaction(async tx => {
                const current = await payment(tx, actorUid, paymentId);
                if (fingerprint(current.value) !== fingerprint(original.value)) fail('PAYMENT_CHANGED', 'Payment changed; review it before attaching the image.');
                if (current.value.receiptEvidence && current.value.receiptEvidence.objectPath !== objectPath) fail('EVIDENCE_EXISTS', 'This payment already has different evidence.');
                const attempts = current.value.receiptEvidenceAttempts || {};
                if (typeof attempts !== 'object' || Array.isArray(attempts)) fail('EVIDENCE_INTEGRITY', 'Receipt upload history requires review.');
                if (Object.hasOwn(attempts, image.sha256)) {
                    if (attempts[image.sha256].objectPath !== objectPath) fail('EVIDENCE_INTEGRITY', 'Receipt upload history does not match.');
                    return;
                }
                if (Object.keys(attempts).length >= 8) fail('EVIDENCE_ATTEMPT_LIMIT', 'Receipt upload attempts require administrator review. Retry a previously selected image.');
                const { paymentId: ignored, ...record } = current.value; void ignored;
                tx.set(current.ref, { ...record, receiptEvidenceAttempts: { ...attempts,
                    [image.sha256]: { objectPath, status: 'pending', requestedBy: actorUid, requestedAtMs: now() } } });
            });
            await storage.put(objectPath, image.bytes);
            return db.runTransaction(async tx => {
                const current = await payment(tx, actorUid, paymentId);
                if (fingerprint(current.value) !== fingerprint(original.value)) fail('PAYMENT_CHANGED', 'Payment changed; review it before attaching the image.');
                if (current.value.receiptEvidence) {
                    if (!evidencePresent(current.value) || current.value.receiptEvidence.objectPath !== objectPath) fail('EVIDENCE_EXISTS', 'This payment already has different evidence.');
                    return { paymentId, evidencePresent: true, deduped: true };
                }
                const receiptEvidence = { version: 1, sha256: image.sha256, objectPath, uploadedBy: actorUid, uploadedAtMs: now() };
                const { paymentId: ignored, ...record } = current.value;
                void ignored;
                tx.set(current.ref, { ...record, receiptEvidence, receiptEvidenceAttempts: { ...record.receiptEvidenceAttempts,
                    [image.sha256]: { ...record.receiptEvidenceAttempts[image.sha256], status: 'attached', attachedAtMs: now() } } });
                return { paymentId, evidencePresent: true, deduped: false };
            });
        },
        async readEvidence(actorUid, paymentId) {
            const original = await db.runTransaction(tx => payment(tx, actorUid, paymentId));
            if (!evidencePresent(original.value)) fail('EVIDENCE_NOT_FOUND', 'No receipt image is attached.', 404);
            if (!storage) fail('EVIDENCE_UNAVAILABLE', 'Receipt storage is unavailable.', 503);
            const bytes = await storage.read(original.value.receiptEvidence.objectPath);
            await db.runTransaction(async tx => {
                const current = await payment(tx, actorUid, paymentId);
                if (!evidencePresent(current.value) || current.value.receiptEvidence.objectPath !== original.value.receiptEvidence.objectPath) fail('PAYMENT_CHANGED', 'Receipt changed during retrieval.');
            });
            return bytes;
        },
        async get(actorUid, studentId) {
            if (!validId(studentId)) fail('INVALID_REQUEST', 'A valid student is required.', 400);
            return db.runTransaction(async tx => {
                if (await authorize({ tx, actorUid }) !== true) fail('FORBIDDEN', 'Current CRM staff access is required.', 403);
                const student = await tx.get(db.collection(CRM_STUDENTS).doc(studentId));
                if (!student.exists) fail('STUDENT_NOT_FOUND', 'Student not found.', 404);
                const payments = await tx.get(db.collection(CRM_PAYMENTS).where('studentId', '==', studentId).limit(501));
                if (payments.docs.length > 500) fail('FOLLOWUP_TOO_LARGE', 'Payment follow-up requires a larger account review.');
                return projectPaymentFollowup(student.data(), payments.docs.map(doc => ({ ...doc.data(), paymentId: doc.id })));
            });
        }
    });
}
module.exports = { projectPaymentFollowup, createPaymentFollowupService, evidencePresent };
