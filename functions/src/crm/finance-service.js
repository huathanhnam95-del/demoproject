require('../../../public/js/crm/finance-workflow');

const {
    deriveFinanceWorkflowState
} = globalThis.CrmFinanceWorkflow || {};

const COMMISSION_STATUSES = ['pending', 'approved', 'paid'];

function cleanOptionalString(value) {
    const normalized = String(value || '').trim();
    return normalized || null;
}

function cleanOptionalNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const normalized = Number(value);
    return Number.isFinite(normalized) ? normalized : null;
}

function normalizeMoney(value) {
    const amount = cleanOptionalNumber(value);
    return amount === null ? 0 : Math.max(0, amount);
}

function normalizeCommissionSplits(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const next = {};
    ['counselor', 'teacher', 'agent'].forEach((role) => {
        if (!source[role]) return;
        next[role] = {
            actorUid: cleanOptionalString(source[role].actorUid),
            amount: normalizeMoney(source[role].amount)
        };
    });
    return next;
}

function buildInvoiceCreateData(input, context = {}) {
    const studentId = cleanOptionalString(input?.studentId);
    const enrollmentId = cleanOptionalString(input?.enrollmentId);
    const amount = normalizeMoney(input?.amount);
    if (!studentId || amount <= 0) {
        throw new Error('Invoice requires studentId and a positive amount.');
    }

    const discountAmount = normalizeMoney(input?.discountAmount);
    const netAmount = Math.max(0, amount - discountAmount);

    return {
        studentId,
        enrollmentId,
        courseId: cleanOptionalString(input?.courseId),
        amount,
        discountAmount,
        netAmount,
        paidAmount: 0,
        outstandingAmount: netAmount,
        dueDate: cleanOptionalString(input?.dueDate),
        status: netAmount > 0 ? 'open' : 'paid',
        refundStatus: cleanOptionalString(input?.refundStatus) || 'none',
        notes: cleanOptionalString(input?.notes),
        commissionSplits: normalizeCommissionSplits(input?.commissionSplits),
        createdAt: context.serverTimestamp ? context.serverTimestamp() : new Date(),
        createdBy: context.user?.uid || null,
        createdByEmail: context.user?.email || null
    };
}

function buildInvoicePatchData(existing, input, context = {}) {
    const payload = input && typeof input === 'object' ? input : {};
    const recognizedKeys = ['dueDate', 'status', 'refundStatus', 'notes', 'discountAmount', 'commissionSplits'];
    if (!recognizedKeys.some((key) => Object.prototype.hasOwnProperty.call(payload, key))) {
        throw new Error('No invoice fields provided for update.');
    }

    const discountAmount = Object.prototype.hasOwnProperty.call(payload, 'discountAmount')
        ? normalizeMoney(payload.discountAmount)
        : normalizeMoney(existing?.discountAmount);
    const amount = normalizeMoney(existing?.amount);
    const netAmount = Math.max(0, amount - discountAmount);
    const paidAmount = normalizeMoney(existing?.paidAmount);

    return {
        ...existing,
        dueDate: Object.prototype.hasOwnProperty.call(payload, 'dueDate') ? cleanOptionalString(payload.dueDate) : (existing?.dueDate ?? null),
        status: Object.prototype.hasOwnProperty.call(payload, 'status') ? cleanOptionalString(payload.status) : (existing?.status || 'open'),
        refundStatus: Object.prototype.hasOwnProperty.call(payload, 'refundStatus') ? cleanOptionalString(payload.refundStatus) : (existing?.refundStatus || 'none'),
        notes: Object.prototype.hasOwnProperty.call(payload, 'notes') ? cleanOptionalString(payload.notes) : (existing?.notes ?? null),
        discountAmount,
        netAmount,
        outstandingAmount: Math.max(0, netAmount - paidAmount),
        commissionSplits: Object.prototype.hasOwnProperty.call(payload, 'commissionSplits')
            ? normalizeCommissionSplits(payload.commissionSplits)
            : normalizeCommissionSplits(existing?.commissionSplits),
        updatedAt: context.serverTimestamp ? context.serverTimestamp() : new Date(),
        updatedBy: context.user?.uid || null
    };
}

function buildPaymentCreateData(input, context = {}) {
    const invoiceId = cleanOptionalString(input?.invoiceId);
    const studentId = cleanOptionalString(input?.studentId);
    const enrollmentId = cleanOptionalString(input?.enrollmentId);
    const amount = normalizeMoney(input?.amount);
    if (!invoiceId || !studentId || amount <= 0) {
        throw new Error('Payment requires invoiceId, studentId, and a positive amount.');
    }

    return {
        invoiceId,
        studentId,
        enrollmentId,
        amount,
        method: cleanOptionalString(input?.method) || 'bank-transfer',
        paymentDate: cleanOptionalString(input?.paymentDate) || new Date().toISOString(),
        refundStatus: cleanOptionalString(input?.refundStatus) || 'none',
        notes: cleanOptionalString(input?.notes),
        createdAt: context.serverTimestamp ? context.serverTimestamp() : new Date(),
        createdBy: context.user?.uid || null,
        createdByEmail: context.user?.email || null
    };
}

function buildPaidEnrollmentSyncPatch({ invoice, enrollment, student }, context = {}) {
    if (cleanOptionalString(invoice?.status) !== 'paid') {
        return null;
    }
    if (!enrollment || typeof enrollment !== 'object') {
        return null;
    }

    const studentLinkedUserId = Array.isArray(student?.linked_user_ids) && student.linked_user_ids.length > 0
        ? cleanOptionalString(student.linked_user_ids[0])
        : null;
    const studentUid = cleanOptionalString(enrollment.studentUid) || studentLinkedUserId;
    const studentName = cleanOptionalString(enrollment.studentName) || cleanOptionalString(student?.name);
    const studentEmail = cleanOptionalString(enrollment.studentEmail) || cleanOptionalString(student?.email);

    const enrollmentPatch = {
        status: 'active'
    };
    if (studentUid) {
        enrollmentPatch.studentUid = studentUid;
    }
    if (studentName) {
        enrollmentPatch.studentName = studentName;
    }
    if (studentEmail) {
        enrollmentPatch.studentEmail = studentEmail;
    }

    return {
        enrollmentPatch,
        studentPatch: {
            lifecycleStage: 'enrolled'
        },
        studentUid
    };
}

function applyPaymentToInvoice(invoice, payments) {
    const paymentList = Array.isArray(payments) ? payments : [];
    const paidAmount = paymentList.reduce((sum, payment) => sum + normalizeMoney(payment?.amount), 0);
    const outstandingAmount = Math.max(0, normalizeMoney(invoice?.netAmount) - paidAmount);
    const status = outstandingAmount === 0
        ? 'paid'
        : (paidAmount > 0 ? 'partial' : (invoice?.status || 'open'));

    return {
        ...invoice,
        paidAmount,
        outstandingAmount,
        status
    };
}

function buildCommissionRecords({ invoiceId, paymentId, studentId, enrollmentId, commissionSplits }, context = {}) {
    const splits = normalizeCommissionSplits(commissionSplits);
    return Object.entries(splits)
        .filter(([, split]) => split.actorUid && split.amount > 0)
        .map(([role, split]) => ({
            invoiceId,
            paymentId,
            studentId,
            enrollmentId,
            role,
            actorUid: split.actorUid,
            amount: split.amount,
            status: 'pending',
            createdAt: context.serverTimestamp ? context.serverTimestamp() : new Date(),
            createdBy: context.user?.uid || null
        }));
}

function summarizeFinance({ invoices, payments }) {
    const invoiceList = Array.isArray(invoices) ? invoices : [];
    const paymentList = Array.isArray(payments) ? payments : [];

    const totalInvoiced = invoiceList.reduce((sum, invoice) => sum + normalizeMoney(invoice?.netAmount), 0);
    const totalPaid = paymentList.reduce((sum, payment) => sum + normalizeMoney(payment?.amount), 0);
    const totalOutstanding = invoiceList.reduce((sum, invoice) => sum + normalizeMoney(invoice?.outstandingAmount), 0);

    const dueDates = invoiceList
        .filter((invoice) => normalizeMoney(invoice?.outstandingAmount) > 0 && cleanOptionalString(invoice?.dueDate))
        .map((invoice) => cleanOptionalString(invoice.dueDate))
        .sort();

    return {
        totalInvoiced,
        totalPaid,
        totalOutstanding,
        nextDueDate: dueDates[0] || null
    };
}

function mapInvoiceRecord(doc, invoiceId) {
    const data = doc && typeof doc.data === 'function' ? doc.data() : (doc || {});
    return {
        invoiceId: invoiceId || doc?.id || null,
        studentId: data.studentId || null,
        enrollmentId: data.enrollmentId || null,
        courseId: data.courseId || null,
        amount: data.amount || 0,
        discountAmount: data.discountAmount || 0,
        netAmount: data.netAmount || 0,
        paidAmount: data.paidAmount || 0,
        outstandingAmount: data.outstandingAmount || 0,
        dueDate: data.dueDate || null,
        status: data.status || 'open',
        refundStatus: data.refundStatus || 'none',
        notes: data.notes || null,
        commissionSplits: normalizeCommissionSplits(data.commissionSplits),
        createdAt: data.createdAt || null,
        createdBy: data.createdBy || null,
        createdByEmail: data.createdByEmail || null,
        updatedAt: data.updatedAt || null,
        updatedBy: data.updatedBy || null
    };
}

function mapPaymentRecord(doc, paymentId) {
    const data = doc && typeof doc.data === 'function' ? doc.data() : (doc || {});
    return {
        paymentId: paymentId || doc?.id || null,
        invoiceId: data.invoiceId || null,
        studentId: data.studentId || null,
        enrollmentId: data.enrollmentId || null,
        amount: data.amount || 0,
        method: data.method || 'bank-transfer',
        paymentDate: data.paymentDate || null,
        refundStatus: data.refundStatus || 'none',
        notes: data.notes || null,
        createdAt: data.createdAt || null,
        createdBy: data.createdBy || null,
        createdByEmail: data.createdByEmail || null
    };
}

module.exports = {
    COMMISSION_STATUSES,
    buildInvoiceCreateData,
    buildInvoicePatchData,
    buildPaymentCreateData,
    buildPaidEnrollmentSyncPatch,
    applyPaymentToInvoice,
    buildCommissionRecords,
    summarizeFinance,
    deriveFinanceWorkflowState,
    mapInvoiceRecord,
    mapPaymentRecord
};
