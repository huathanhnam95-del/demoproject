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
        ownerUid: Object.prototype.hasOwnProperty.call(source, 'ownerUid')
            ? cleanOptionalString(source.ownerUid)
            : (base.ownerUid ?? null),
        notes: Object.prototype.hasOwnProperty.call(source, 'notes')
            ? cleanOptionalString(source.notes)
            : (base.notes ?? null),
        learningProfile: normalizeLearningProfile(source.learningProfile, base.learningProfile)
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
        'ownerUid',
        'notes',
        'learningProfile'
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
        ownerUid: source.ownerUid || null,
        notes: source.notes || null,
        learningProfile: normalizeLearningProfile(source.learningProfile),
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
    normalizeLearningProfile
};
