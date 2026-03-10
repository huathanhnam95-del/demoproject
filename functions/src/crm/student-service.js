function cleanOptionalString(value) {
    const normalized = String(value || '').trim();
    return normalized || null;
}

function cleanOptionalNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const normalized = Number(value);
    return Number.isFinite(normalized) ? normalized : null;
}

function normalizeLifecycleStage(value, fallback = 'potential') {
    return cleanOptionalString(value) || fallback;
}

function normalizeLearningProfile(input, fallback = {}) {
    const source = input && typeof input === 'object' ? input : {};
    const base = fallback && typeof fallback === 'object' ? fallback : {};

    return {
        overall: Object.prototype.hasOwnProperty.call(source, 'overall') ? cleanOptionalNumber(source.overall) : (base.overall ?? null),
        listening: Object.prototype.hasOwnProperty.call(source, 'listening') ? cleanOptionalNumber(source.listening) : (base.listening ?? null),
        reading: Object.prototype.hasOwnProperty.call(source, 'reading') ? cleanOptionalNumber(source.reading) : (base.reading ?? null),
        speaking: Object.prototype.hasOwnProperty.call(source, 'speaking') ? cleanOptionalNumber(source.speaking) : (base.speaking ?? null),
        writing: Object.prototype.hasOwnProperty.call(source, 'writing') ? cleanOptionalNumber(source.writing) : (base.writing ?? null),
        entryLevel: Object.prototype.hasOwnProperty.call(source, 'entryLevel') ? cleanOptionalString(source.entryLevel) : (base.entryLevel ?? null),
        testResultDueDate: Object.prototype.hasOwnProperty.call(source, 'testResultDueDate') ? cleanOptionalString(source.testResultDueDate) : (base.testResultDueDate ?? null)
    };
}

function normalizeTargets(input, fallback = {}) {
    const source = input && typeof input === 'object' ? input : {};
    const base = fallback && typeof fallback === 'object' ? fallback : {};
    return {
        exam: Object.prototype.hasOwnProperty.call(source, 'exam') ? cleanOptionalString(source.exam) : (base.exam ?? null),
        score: Object.prototype.hasOwnProperty.call(source, 'score') ? cleanOptionalNumber(source.score) : (base.score ?? null)
    };
}

function normalizeScoreHistory(input) {
    if (!Array.isArray(input)) return [];
    return input
        .map((entry) => ({
            date: cleanOptionalString(entry?.date),
            score: cleanOptionalNumber(entry?.score)
        }))
        .filter((entry) => entry.date || entry.score !== null);
}

function normalizeContactList(input, keys) {
    if (!Array.isArray(input)) return [];
    return input
        .map((entry) => {
            const normalized = {};
            keys.forEach((key) => {
                normalized[key] = cleanOptionalString(entry?.[key]);
            });
            return normalized;
        })
        .filter((entry) => Object.values(entry).some(Boolean));
}

function normalizeContacts(input, fallback = {}) {
    const source = input && typeof input === 'object' ? input : {};
    const base = fallback && typeof fallback === 'object' ? fallback : {};
    return {
        guardians: Object.prototype.hasOwnProperty.call(source, 'guardians')
            ? normalizeContactList(source.guardians, ['name', 'phone', 'email'])
            : normalizeContactList(base.guardians, ['name', 'phone', 'email']),
        companies: Object.prototype.hasOwnProperty.call(source, 'companies')
            ? normalizeContactList(source.companies, ['name', 'email', 'phone'])
            : normalizeContactList(base.companies, ['name', 'email', 'phone'])
    };
}

function normalizeDocumentRefs(input) {
    if (!Array.isArray(input)) return [];
    return input
        .map((entry) => ({
            name: cleanOptionalString(entry?.name),
            storagePath: cleanOptionalString(entry?.storagePath)
        }))
        .filter((entry) => entry.name || entry.storagePath);
}

function normalizeStudentCore(input, fallback = {}) {
    const source = input && typeof input === 'object' ? input : {};
    const base = fallback && typeof fallback === 'object' ? fallback : {};

    return {
        name: Object.prototype.hasOwnProperty.call(source, 'name') ? cleanOptionalString(source.name) : (base.name ?? null),
        label: Object.prototype.hasOwnProperty.call(source, 'label') ? cleanOptionalString(source.label) : (base.label ?? null),
        phone: Object.prototype.hasOwnProperty.call(source, 'phone') ? cleanOptionalString(source.phone) : (base.phone ?? null),
        email: Object.prototype.hasOwnProperty.call(source, 'email') ? cleanOptionalString(source.email) : (base.email ?? null),
        zalo: Object.prototype.hasOwnProperty.call(source, 'zalo') ? cleanOptionalString(source.zalo) : (base.zalo ?? null),
        facebook: Object.prototype.hasOwnProperty.call(source, 'facebook') ? cleanOptionalString(source.facebook) : (base.facebook ?? null),
        lifecycleStage: Object.prototype.hasOwnProperty.call(source, 'lifecycleStage')
            ? normalizeLifecycleStage(source.lifecycleStage)
            : normalizeLifecycleStage(base.lifecycleStage),
        acquisitionSource: Object.prototype.hasOwnProperty.call(source, 'acquisitionSource')
            ? cleanOptionalString(source.acquisitionSource)
            : (base.acquisitionSource ?? null),
        leadId: Object.prototype.hasOwnProperty.call(source, 'leadId')
            ? cleanOptionalString(source.leadId)
            : (base.leadId ?? null),
        ownerUid: Object.prototype.hasOwnProperty.call(source, 'ownerUid')
            ? cleanOptionalString(source.ownerUid)
            : (base.ownerUid ?? null),
        notes: Object.prototype.hasOwnProperty.call(source, 'notes')
            ? cleanOptionalString(source.notes)
            : (base.notes ?? null),
        learningProfile: normalizeLearningProfile(source.learningProfile, base.learningProfile),
        targets: normalizeTargets(source.targets, base.targets),
        preferredSchedule: Object.prototype.hasOwnProperty.call(source, 'preferredSchedule')
            ? cleanOptionalString(source.preferredSchedule)
            : (base.preferredSchedule ?? null),
        scoreHistory: Object.prototype.hasOwnProperty.call(source, 'scoreHistory')
            ? normalizeScoreHistory(source.scoreHistory)
            : normalizeScoreHistory(base.scoreHistory),
        contacts: normalizeContacts(source.contacts, base.contacts),
        documentRefs: Object.prototype.hasOwnProperty.call(source, 'documentRefs')
            ? normalizeDocumentRefs(source.documentRefs)
            : normalizeDocumentRefs(base.documentRefs),
        counselingNotes: Object.prototype.hasOwnProperty.call(source, 'counselingNotes')
            ? cleanOptionalString(source.counselingNotes)
            : (base.counselingNotes ?? null)
    };
}

function hasAnyInfoField(student) {
    return [student.name, student.label, student.phone, student.email, student.zalo, student.facebook].some(Boolean);
}

function hasRecognizedPatch(input) {
    if (!input || typeof input !== 'object') return false;
    const knownKeys = [
        'name',
        'label',
        'phone',
        'email',
        'zalo',
        'facebook',
        'lifecycleStage',
        'acquisitionSource',
        'leadId',
        'ownerUid',
        'notes',
        'learningProfile',
        'targets',
        'preferredSchedule',
        'scoreHistory',
        'contacts',
        'documentRefs',
        'counselingNotes'
    ];
    return knownKeys.some((key) => Object.prototype.hasOwnProperty.call(input, key));
}

function buildStudentCreateData(input, context = {}) {
    const student = normalizeStudentCore(input, {
        lifecycleStage: 'potential',
        ownerUid: context.user?.uid || null
    });

    if (!hasAnyInfoField(student)) {
        throw new Error('Please fill at least 1 field in Info tab before saving.');
    }

    return {
        ...student,
        createdAt: context.serverTimestamp ? context.serverTimestamp() : new Date(),
        createdBy: context.user?.uid || null,
        createdByEmail: context.user?.email || null
    };
}

function buildStudentPatchData(existing, input, context = {}) {
    if (!hasRecognizedPatch(input)) {
        throw new Error('No student fields provided for update.');
    }

    const merged = normalizeStudentCore(input, existing);
    return {
        ...existing,
        ...merged,
        learningProfile: merged.learningProfile,
        targets: merged.targets,
        scoreHistory: merged.scoreHistory,
        contacts: merged.contacts,
        documentRefs: merged.documentRefs,
        updatedAt: context.serverTimestamp ? context.serverTimestamp() : new Date(),
        updatedBy: context.user?.uid || null
    };
}

function mapStudentRecord(data, studentId) {
    const source = data && typeof data.data === 'function' ? data.data() : (data || {});
    const id = studentId || data?.id || null;

    return {
        studentId: id,
        name: source.name || null,
        label: source.label || null,
        phone: source.phone || null,
        email: source.email || null,
        zalo: source.zalo || null,
        facebook: source.facebook || null,
        lifecycleStage: normalizeLifecycleStage(source.lifecycleStage),
        acquisitionSource: source.acquisitionSource || null,
        leadId: source.leadId || null,
        ownerUid: source.ownerUid || null,
        notes: source.notes || null,
        learningProfile: normalizeLearningProfile(source.learningProfile),
        targets: normalizeTargets(source.targets),
        preferredSchedule: source.preferredSchedule || null,
        scoreHistory: normalizeScoreHistory(source.scoreHistory),
        contacts: normalizeContacts(source.contacts),
        documentRefs: normalizeDocumentRefs(source.documentRefs),
        counselingNotes: source.counselingNotes || null,
        class_code: source.class_code || null,
        linked_user_ids: Array.isArray(source.linked_user_ids) ? source.linked_user_ids : [],
        createdAt: source.createdAt || null,
        createdBy: source.createdBy || null,
        createdByEmail: source.createdByEmail || null,
        updatedAt: source.updatedAt || null,
        updatedBy: source.updatedBy || null
    };
}

module.exports = {
    buildStudentCreateData,
    buildStudentPatchData,
    mapStudentRecord,
    normalizeStudentCore,
    normalizeLearningProfile,
    normalizeTargets,
    normalizeScoreHistory,
    normalizeContacts,
    normalizeDocumentRefs
};
