const { deriveFinanceWorkflowState } = require('./finance-workflow');

const COMMISSION_STATUSES = ['pending', 'approved', 'paid'];
const SUPPORTED_CURRENCIES = ['VND', 'AUD', 'USD'];
const DEFAULT_CURRENCY = 'VND';

function cleanOptionalString(value) {
    const normalized = String(value || '').trim();
    return normalized || null;
}

function cleanOptionalNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const normalized = Number(String(value).replace(/,/g, ''));
    return Number.isFinite(normalized) ? normalized : null;
}

function normalizeRateBps(value) {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    const rounded = Math.round(numeric);
    if (rounded < 0 || rounded > 10000) return null;
    return rounded;
}

function normalizeCurrency(value) {
    const normalized = String(value || '').trim().toUpperCase();
    return SUPPORTED_CURRENCIES.includes(normalized) ? normalized : DEFAULT_CURRENCY;
}

function currencyDecimals(currency) {
    return normalizeCurrency(currency) === 'VND' ? 0 : 2;
}

function normalizeMoney(value, currency = DEFAULT_CURRENCY) {
    const amount = cleanOptionalNumber(value);
    if (amount === null) return 0;
    const decimals = currencyDecimals(currency);
    const factor = 10 ** decimals;
    return Math.max(0, Math.round(amount * factor) / factor);
}

function formatMoneyValue(value, currency = DEFAULT_CURRENCY) {
    const amount = normalizeMoney(value, currency);
    const decimals = currencyDecimals(currency);
    return new Intl.NumberFormat('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    }).format(amount);
}

function normalizeCommissionSplits(raw, currency = DEFAULT_CURRENCY) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const next = {};
    ['counselor', 'teacher', 'agent'].forEach((role) => {
        if (!source[role]) return;
        next[role] = {
            actorUid: cleanOptionalString(source[role].actorUid),
            amount: normalizeMoney(source[role].amount, currency)
        };
    });
    return next;
}

function buildInvoiceCreateData(input, context = {}) {
    const studentId = cleanOptionalString(input?.studentId);
    const enrollmentId = cleanOptionalString(input?.enrollmentId);
    const currency = normalizeCurrency(input?.currency);
    const amount = normalizeMoney(input?.amount, currency);
    if (!studentId || amount <= 0) {
        throw new Error('Invoice requires studentId and a positive amount.');
    }

    const discountAmount = normalizeMoney(input?.discountAmount, currency);
    const netAmount = Math.max(0, amount - discountAmount);

    return {
        studentId,
        enrollmentId,
        courseId: cleanOptionalString(input?.courseId),
        currency,
        amount,
        discountAmount,
        netAmount,
        paidAmount: 0,
        outstandingAmount: netAmount,
        dueDate: cleanOptionalString(input?.dueDate),
        status: netAmount > 0 ? 'open' : 'paid',
        refundStatus: cleanOptionalString(input?.refundStatus) || 'none',
        notes: cleanOptionalString(input?.notes),
        agentSourceId: cleanOptionalString(input?.agentSourceId),
        agentCommissionBps: normalizeRateBps(input?.agentCommissionBps),
        paidAt: null,
        commissionSplits: normalizeCommissionSplits(input?.commissionSplits, currency),
        createdAt: context.serverTimestamp ? context.serverTimestamp() : new Date(),
        createdBy: context.user?.uid || null,
        createdByEmail: context.user?.email || null
    };
}

function buildInvoicePatchData(existing, input, context = {}) {
    const payload = input && typeof input === 'object' ? input : {};
    const recognizedKeys = ['dueDate', 'status', 'refundStatus', 'notes', 'discountAmount', 'commissionSplits', 'currency'];
    if (!recognizedKeys.some((key) => Object.prototype.hasOwnProperty.call(payload, key))) {
        throw new Error('No invoice fields provided for update.');
    }

    const currency = Object.prototype.hasOwnProperty.call(payload, 'currency')
        ? normalizeCurrency(payload.currency)
        : normalizeCurrency(existing?.currency);
    const discountAmount = Object.prototype.hasOwnProperty.call(payload, 'discountAmount')
        ? normalizeMoney(payload.discountAmount, currency)
        : normalizeMoney(existing?.discountAmount, currency);
    const amount = normalizeMoney(existing?.amount, currency);
    const netAmount = Math.max(0, amount - discountAmount);
    const paidAmount = normalizeMoney(existing?.paidAmount, currency);

    return {
        ...existing,
        currency,
        dueDate: Object.prototype.hasOwnProperty.call(payload, 'dueDate') ? cleanOptionalString(payload.dueDate) : (existing?.dueDate ?? null),
        status: Object.prototype.hasOwnProperty.call(payload, 'status') ? cleanOptionalString(payload.status) : (existing?.status || 'open'),
        refundStatus: Object.prototype.hasOwnProperty.call(payload, 'refundStatus') ? cleanOptionalString(payload.refundStatus) : (existing?.refundStatus || 'none'),
        notes: Object.prototype.hasOwnProperty.call(payload, 'notes') ? cleanOptionalString(payload.notes) : (existing?.notes ?? null),
        discountAmount,
        netAmount,
        outstandingAmount: Math.max(0, netAmount - paidAmount),
        commissionSplits: Object.prototype.hasOwnProperty.call(payload, 'commissionSplits')
            ? normalizeCommissionSplits(payload.commissionSplits, currency)
            : normalizeCommissionSplits(existing?.commissionSplits, currency),
        updatedAt: context.serverTimestamp ? context.serverTimestamp() : new Date(),
        updatedBy: context.user?.uid || null
    };
}

function buildPaymentCreateData(input, context = {}) {
    const invoiceId = cleanOptionalString(input?.invoiceId);
    const studentId = cleanOptionalString(input?.studentId);
    const enrollmentId = cleanOptionalString(input?.enrollmentId);
    const currency = normalizeCurrency(input?.currency);
    const amount = normalizeMoney(input?.amount, currency);
    if (!invoiceId || !studentId || amount <= 0) {
        throw new Error('Payment requires invoiceId, studentId, and a positive amount.');
    }

    return {
        invoiceId,
        studentId,
        enrollmentId,
        currency,
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
    const currency = normalizeCurrency(invoice?.currency);
    const paidAmount = paymentList.reduce((sum, payment) => sum + normalizeMoney(payment?.amount, currency), 0);
    const outstandingAmount = Math.max(0, normalizeMoney(invoice?.netAmount, currency) - paidAmount);
    const status = outstandingAmount === 0
        ? 'paid'
        : (paidAmount > 0 ? 'partial' : (invoice?.status || 'open'));

    return {
        ...invoice,
        currency,
        paidAmount,
        outstandingAmount,
        status
    };
}

function buildCommissionRecords({ invoiceId, paymentId, studentId, enrollmentId, commissionSplits }, context = {}) {
    const currency = normalizeCurrency(context.currency);
    const splits = normalizeCommissionSplits(commissionSplits, currency);
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
            currency,
            status: 'pending',
            createdAt: context.serverTimestamp ? context.serverTimestamp() : new Date(),
            createdBy: context.user?.uid || null
        }));
}

function buildAgentSourceCommissionRecord({ invoice, paymentId }, context = {}) {
    const sourceInvoice = invoice && typeof invoice === 'object' ? invoice : {};
    const agentSourceId = cleanOptionalString(sourceInvoice.agentSourceId);
    const rateBps = normalizeRateBps(sourceInvoice.agentCommissionBps);
    if (!agentSourceId || !rateBps || rateBps <= 0) return null;

    const currency = normalizeCurrency(sourceInvoice.currency || context.currency);
    const baseAmount = normalizeMoney(sourceInvoice.netAmount, currency);
    if (baseAmount <= 0) return null;
    const amount = normalizeMoney((baseAmount * rateBps) / 10000, currency);
    if (amount <= 0) return null;

    return {
        invoiceId: cleanOptionalString(sourceInvoice.invoiceId) || null,
        paymentId: cleanOptionalString(paymentId) || null,
        studentId: cleanOptionalString(sourceInvoice.studentId) || null,
        enrollmentId: cleanOptionalString(sourceInvoice.enrollmentId) || null,
        courseId: cleanOptionalString(sourceInvoice.courseId) || null,
        role: 'agent_source',
        agentSourceId,
        rateBps,
        baseAmount,
        amount,
        currency,
        status: 'pending',
        createdAt: context.serverTimestamp ? context.serverTimestamp() : new Date(),
        createdBy: context.user?.uid || null
    };
}

function summarizeFinance({ invoices, payments }) {
    const invoiceList = Array.isArray(invoices) ? invoices : [];
    const paymentList = Array.isArray(payments) ? payments : [];

    const bucketMap = new Map();
    function getBucket(currency) {
        const normalized = normalizeCurrency(currency);
        if (!bucketMap.has(normalized)) {
            bucketMap.set(normalized, {
                currency: normalized,
                totalInvoiced: 0,
                totalPaid: 0,
                totalOutstanding: 0
            });
        }
        return bucketMap.get(normalized);
    }

    invoiceList.forEach((invoice) => {
        const bucket = getBucket(invoice?.currency);
        bucket.totalInvoiced += normalizeMoney(invoice?.netAmount, bucket.currency);
        bucket.totalOutstanding += normalizeMoney(invoice?.outstandingAmount, bucket.currency);
    });
    paymentList.forEach((payment) => {
        const bucket = getBucket(payment?.currency);
        bucket.totalPaid += normalizeMoney(payment?.amount, bucket.currency);
    });

    const currencyTotals = Array.from(bucketMap.values());
    const totalInvoiced = currencyTotals.reduce((sum, bucket) => sum + bucket.totalInvoiced, 0);
    const totalPaid = currencyTotals.reduce((sum, bucket) => sum + bucket.totalPaid, 0);
    const totalOutstanding = currencyTotals.reduce((sum, bucket) => sum + bucket.totalOutstanding, 0);

    const dueDates = invoiceList
        .filter((invoice) => normalizeMoney(invoice?.outstandingAmount, invoice?.currency) > 0 && cleanOptionalString(invoice?.dueDate))
        .map((invoice) => cleanOptionalString(invoice.dueDate))
        .sort();

    return {
        totalInvoiced,
        totalPaid,
        totalOutstanding,
        nextDueDate: dueDates[0] || null,
        currencyTotals
    };
}

function mapInvoiceRecord(doc, invoiceId) {
    const data = doc && typeof doc.data === 'function' ? doc.data() : (doc || {});
    return {
        invoiceId: invoiceId || doc?.id || null,
        studentId: data.studentId || null,
        enrollmentId: data.enrollmentId || null,
        courseId: data.courseId || null,
        currency: normalizeCurrency(data.currency),
        amount: data.amount || 0,
        discountAmount: data.discountAmount || 0,
        netAmount: data.netAmount || 0,
        paidAmount: data.paidAmount || 0,
        outstandingAmount: data.outstandingAmount || 0,
        dueDate: data.dueDate || null,
        status: data.status || 'open',
        refundStatus: data.refundStatus || 'none',
        notes: data.notes || null,
        agentSourceId: data.agentSourceId || null,
        agentCommissionBps: normalizeRateBps(data.agentCommissionBps),
        paidAt: data.paidAt || null,
        commissionSplits: normalizeCommissionSplits(data.commissionSplits, data.currency),
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
        currency: normalizeCurrency(data.currency),
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
    buildAgentSourceCommissionRecord,
    summarizeFinance,
    deriveFinanceWorkflowState,
    mapInvoiceRecord,
    mapPaymentRecord,
    normalizeCurrency,
    formatMoneyValue,
    SUPPORTED_CURRENCIES,
    DEFAULT_CURRENCY
};
