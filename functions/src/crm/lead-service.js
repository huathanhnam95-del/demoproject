const { buildStudentCreateData } = require('./student-service');

const LEAD_STAGES = [
    'new',
    'contacted',
    'test_scheduled',
    'test_completed',
    'counseling',
    'trial',
    'won',
    'lost'
];

function cleanOptionalString(value) {
    const normalized = String(value || '').trim();
    return normalized || null;
}

function cleanOptionalNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const normalized = Number(value);
    return Number.isFinite(normalized) ? normalized : null;
}

function normalizeLeadStage(value, fallback = 'new') {
    const normalized = cleanOptionalString(value) || fallback;
    if (normalized === 'converted') return normalized;
    if (!LEAD_STAGES.includes(normalized)) {
        throw new Error(`Invalid lead stage: ${normalized}`);
    }
    return normalized;
}

function normalizeLeadCore(input, fallback = {}) {
    const source = input && typeof input === 'object' ? input : {};
    const base = fallback && typeof fallback === 'object' ? fallback : {};

    return {
        name: Object.prototype.hasOwnProperty.call(source, 'name') ? cleanOptionalString(source.name) : (base.name ?? null),
        label: Object.prototype.hasOwnProperty.call(source, 'label') ? cleanOptionalString(source.label) : (base.label ?? null),
        phone: Object.prototype.hasOwnProperty.call(source, 'phone') ? cleanOptionalString(source.phone) : (base.phone ?? null),
        email: Object.prototype.hasOwnProperty.call(source, 'email') ? cleanOptionalString(source.email) : (base.email ?? null),
        zalo: Object.prototype.hasOwnProperty.call(source, 'zalo') ? cleanOptionalString(source.zalo) : (base.zalo ?? null),
        facebook: Object.prototype.hasOwnProperty.call(source, 'facebook') ? cleanOptionalString(source.facebook) : (base.facebook ?? null),
        source: Object.prototype.hasOwnProperty.call(source, 'source') ? cleanOptionalString(source.source) : (base.source ?? null),
        ownerUid: Object.prototype.hasOwnProperty.call(source, 'ownerUid') ? cleanOptionalString(source.ownerUid) : (base.ownerUid ?? null),
        stage: Object.prototype.hasOwnProperty.call(source, 'stage')
            ? normalizeLeadStage(source.stage)
            : normalizeLeadStage(base.stage || 'new'),
        probability: Object.prototype.hasOwnProperty.call(source, 'probability') ? cleanOptionalNumber(source.probability) : (base.probability ?? null),
        nextActionAt: Object.prototype.hasOwnProperty.call(source, 'nextActionAt') ? cleanOptionalString(source.nextActionAt) : (base.nextActionAt ?? null),
        lastContactAt: Object.prototype.hasOwnProperty.call(source, 'lastContactAt') ? cleanOptionalString(source.lastContactAt) : (base.lastContactAt ?? null),
        lossReason: Object.prototype.hasOwnProperty.call(source, 'lossReason') ? cleanOptionalString(source.lossReason) : (base.lossReason ?? null),
        notes: Object.prototype.hasOwnProperty.call(source, 'notes') ? cleanOptionalString(source.notes) : (base.notes ?? null),
        studentId: Object.prototype.hasOwnProperty.call(source, 'studentId') ? cleanOptionalString(source.studentId) : (base.studentId ?? null)
    };
}

function hasAnyLeadContact(lead) {
    return [lead.name, lead.phone, lead.email, lead.zalo, lead.facebook].some(Boolean);
}

function buildLeadCreateData(input, context = {}) {
    const lead = normalizeLeadCore(input, {
        stage: 'new',
        ownerUid: context.user?.uid || null
    });
    if (!hasAnyLeadContact(lead)) {
        throw new Error('Please fill at least 1 lead contact field before saving.');
    }
    return {
        ...lead,
        createdAt: context.serverTimestamp ? context.serverTimestamp() : new Date(),
        createdBy: context.user?.uid || null,
        createdByEmail: context.user?.email || null
    };
}

function buildLeadPatchData(existing, input, context = {}) {
    const patch = normalizeLeadCore(input, existing);
    const recognized = [
        'name', 'label', 'phone', 'email', 'zalo', 'facebook', 'source',
        'ownerUid', 'stage', 'probability', 'nextActionAt', 'lastContactAt',
        'lossReason', 'notes', 'studentId'
    ].some((key) => Object.prototype.hasOwnProperty.call(input || {}, key));
    if (!recognized) {
        throw new Error('No lead fields provided for update.');
    }
    return {
        ...existing,
        ...patch,
        updatedAt: context.serverTimestamp ? context.serverTimestamp() : new Date(),
        updatedBy: context.user?.uid || null
    };
}

function buildLeadConversion({ leadId, lead, context = {} }) {
    const student = buildStudentCreateData({
        name: lead.name,
        label: lead.label,
        phone: lead.phone,
        email: lead.email,
        zalo: lead.zalo,
        facebook: lead.facebook,
        ownerUid: lead.ownerUid || context.user?.uid || null,
        acquisitionSource: lead.source || null,
        leadId,
        lifecycleStage: 'enrolled',
        notes: lead.notes || null
    }, context);

    return {
        student,
        leadPatch: {
            stage: 'converted',
            studentId: 'PENDING_STUDENT_ID',
            convertedAt: context.serverTimestamp ? context.serverTimestamp() : new Date(),
            updatedAt: context.serverTimestamp ? context.serverTimestamp() : new Date(),
            updatedBy: context.user?.uid || null
        }
    };
}

function mapLeadRecord(doc, leadId) {
    const data = doc && typeof doc.data === 'function' ? doc.data() : (doc || {});
    return {
        leadId: leadId || doc?.id || null,
        name: data.name || null,
        label: data.label || null,
        phone: data.phone || null,
        email: data.email || null,
        zalo: data.zalo || null,
        facebook: data.facebook || null,
        source: data.source || null,
        ownerUid: data.ownerUid || null,
        stage: data.stage || 'new',
        probability: data.probability ?? null,
        nextActionAt: data.nextActionAt || null,
        lastContactAt: data.lastContactAt || null,
        lossReason: data.lossReason || null,
        notes: data.notes || null,
        studentId: data.studentId || null,
        createdAt: data.createdAt || null,
        createdBy: data.createdBy || null,
        createdByEmail: data.createdByEmail || null,
        updatedAt: data.updatedAt || null,
        updatedBy: data.updatedBy || null
    };
}

module.exports = {
    buildLeadCreateData,
    buildLeadPatchData,
    buildLeadConversion,
    mapLeadRecord,
    LEAD_STAGES,
    normalizeLeadStage
};
