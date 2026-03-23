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

function cleanOptionalArray(value) {
    if (value === null || value === undefined || value === '') return [];
    const list = Array.isArray(value) ? value : String(value).split(',');
    return list
        .map((entry) => cleanOptionalString(entry))
        .filter(Boolean);
}

function joinNonEmpty(parts, separator = ' | ') {
    return (Array.isArray(parts) ? parts : [])
        .map((part) => cleanOptionalString(part))
        .filter(Boolean)
        .join(separator) || null;
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
    const baseFacebook = cleanOptionalString(base.facebook);
    const sourceFacebook = Object.prototype.hasOwnProperty.call(source, 'facebook')
        ? cleanOptionalString(source.facebook)
        : null;
    const baseFacebookDisplayName = cleanOptionalString(base.facebookDisplayName) || baseFacebook;
    const facebookDisplayName = Object.prototype.hasOwnProperty.call(source, 'facebookDisplayName')
        ? cleanOptionalString(source.facebookDisplayName) || sourceFacebook || null
        : baseFacebookDisplayName;
    const facebook = Object.prototype.hasOwnProperty.call(source, 'facebook')
        ? sourceFacebook || facebookDisplayName || null
        : (baseFacebook || facebookDisplayName || null);

    return {
        name: Object.prototype.hasOwnProperty.call(source, 'name') ? cleanOptionalString(source.name) : (base.name ?? null),
        label: Object.prototype.hasOwnProperty.call(source, 'label') ? cleanOptionalString(source.label) : (base.label ?? null),
        phone: Object.prototype.hasOwnProperty.call(source, 'phone') ? cleanOptionalString(source.phone) : (base.phone ?? null),
        email: Object.prototype.hasOwnProperty.call(source, 'email') ? cleanOptionalString(source.email) : (base.email ?? null),
        zalo: Object.prototype.hasOwnProperty.call(source, 'zalo') ? cleanOptionalString(source.zalo) : (base.zalo ?? null),
        facebook,
        facebookDisplayName,
        facebookProfileUrl: Object.prototype.hasOwnProperty.call(source, 'facebookProfileUrl')
            ? cleanOptionalString(source.facebookProfileUrl)
            : (base.facebookProfileUrl ?? null),
        realName: Object.prototype.hasOwnProperty.call(source, 'realName')
            ? cleanOptionalString(source.realName)
            : (base.realName ?? null),
        dateOfBirth: Object.prototype.hasOwnProperty.call(source, 'dateOfBirth')
            ? cleanOptionalString(source.dateOfBirth)
            : (base.dateOfBirth ?? null),
        learningNeeds: Object.prototype.hasOwnProperty.call(source, 'learningNeeds')
            ? cleanOptionalString(source.learningNeeds)
            : (base.learningNeeds ?? null),
        preferredLearningDays: Object.prototype.hasOwnProperty.call(source, 'preferredLearningDays')
            ? cleanOptionalArray(source.preferredLearningDays)
            : cleanOptionalArray(base.preferredLearningDays),
        preferredLearningHours: Object.prototype.hasOwnProperty.call(source, 'preferredLearningHours')
            ? cleanOptionalArray(source.preferredLearningHours)
            : cleanOptionalArray(base.preferredLearningHours),
        messengerThreadUrl: Object.prototype.hasOwnProperty.call(source, 'messengerThreadUrl')
            ? cleanOptionalString(source.messengerThreadUrl)
            : (base.messengerThreadUrl ?? null),
        messengerLastContactAt: Object.prototype.hasOwnProperty.call(source, 'messengerLastContactAt')
            ? cleanOptionalString(source.messengerLastContactAt)
            : (base.messengerLastContactAt ?? null),
        messengerStatus: Object.prototype.hasOwnProperty.call(source, 'messengerStatus')
            ? cleanOptionalString(source.messengerStatus)
            : (base.messengerStatus ?? null),
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
    return [
        lead.name,
        lead.phone,
        lead.email,
        lead.zalo,
        lead.facebook,
        lead.facebookDisplayName,
        lead.facebookProfileUrl
    ].some(Boolean);
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
        'name', 'label', 'phone', 'email', 'zalo', 'facebook',
        'facebookDisplayName', 'facebookProfileUrl', 'realName', 'dateOfBirth',
        'learningNeeds', 'preferredLearningDays', 'preferredLearningHours',
        'messengerThreadUrl', 'messengerLastContactAt', 'messengerStatus', 'source',
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
    const preferredSchedule = joinNonEmpty([
        cleanOptionalArray(lead.preferredLearningDays).length
            ? `Days: ${cleanOptionalArray(lead.preferredLearningDays).join(', ')}`
            : null,
        cleanOptionalArray(lead.preferredLearningHours).length
            ? `Hours: ${cleanOptionalArray(lead.preferredLearningHours).join(', ')}`
            : null
    ]);

    const notes = joinNonEmpty([
        lead.learningNeeds,
        lead.dateOfBirth ? `DOB: ${lead.dateOfBirth}` : null,
        lead.facebookProfileUrl ? `Facebook URL: ${lead.facebookProfileUrl}` : null
    ]);

    const counselingNotes = joinNonEmpty([
        lead.messengerStatus ? `Messenger: ${lead.messengerStatus}` : null,
        lead.messengerLastContactAt ? `Last contact: ${lead.messengerLastContactAt}` : null,
        lead.messengerThreadUrl ? `Thread: ${lead.messengerThreadUrl}` : null
    ]);

    const studentName = cleanOptionalString(lead.realName)
        || cleanOptionalString(lead.name)
        || cleanOptionalString(lead.facebookDisplayName)
        || cleanOptionalString(lead.facebook)
        || cleanOptionalString(lead.facebookProfileUrl);

    const student = buildStudentCreateData({
        name: studentName,
        label: cleanOptionalString(lead.label) || cleanOptionalString(lead.facebookDisplayName) || null,
        phone: lead.phone,
        email: lead.email,
        zalo: lead.zalo,
        facebook: cleanOptionalString(lead.facebookDisplayName)
            || cleanOptionalString(lead.facebook)
            || cleanOptionalString(lead.facebookProfileUrl),
        ownerUid: lead.ownerUid || context.user?.uid || null,
        acquisitionSource: lead.source || null,
        leadId,
        lifecycleStage: 'enrolled',
        notes: joinNonEmpty([lead.notes, notes]),
        preferredSchedule,
        preferredLearningDays: cleanOptionalArray(lead.preferredLearningDays),
        preferredLearningHours: cleanOptionalArray(lead.preferredLearningHours),
        counselingNotes
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

function buildLeadStageSyncPatch(existingLead, nextStage, context = {}) {
    if (!existingLead || typeof existingLead !== 'object') return null;
    const normalizedStage = normalizeLeadStage(nextStage, null);
    if (!normalizedStage || normalizedStage === 'converted' || !LEAD_STAGES.includes(normalizedStage)) {
        throw new Error(`Invalid lead stage: ${String(nextStage || '').trim() || normalizedStage || 'unknown'}`);
    }

    const currentStage = cleanOptionalString(existingLead.stage);
    if (currentStage === normalizedStage) return null;
    if (currentStage === 'converted') return null;

    const currentIndex = LEAD_STAGES.indexOf(currentStage);
    const nextIndex = LEAD_STAGES.indexOf(normalizedStage);
    if (currentIndex !== -1 && nextIndex !== -1 && nextIndex < currentIndex) return null;

    return {
        ...existingLead,
        stage: normalizedStage,
        updatedAt: context.serverTimestamp ? context.serverTimestamp() : new Date(),
        updatedBy: context.user?.uid || null
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
        facebook: data.facebook || data.facebookDisplayName || null,
        facebookDisplayName: data.facebookDisplayName || data.facebook || null,
        facebookProfileUrl: data.facebookProfileUrl || null,
        realName: data.realName || null,
        dateOfBirth: data.dateOfBirth || null,
        learningNeeds: data.learningNeeds || null,
        preferredLearningDays: cleanOptionalArray(data.preferredLearningDays),
        preferredLearningHours: cleanOptionalArray(data.preferredLearningHours),
        messengerThreadUrl: data.messengerThreadUrl || null,
        messengerLastContactAt: data.messengerLastContactAt || null,
        messengerStatus: data.messengerStatus || null,
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
    buildLeadStageSyncPatch,
    mapLeadRecord,
    LEAD_STAGES,
    normalizeLeadStage
};
