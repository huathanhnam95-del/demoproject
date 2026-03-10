const CRM_ROLES = ['admin', 'counselor', 'teacher', 'finance'];

function cleanOptionalString(value) {
    const normalized = String(value || '').trim();
    return normalized || null;
}

function buildAuditLogEntry(input, context = {}) {
    return {
        actorUid: cleanOptionalString(input?.actorUid) || context.user?.uid || 'system',
        actorEmail: cleanOptionalString(input?.actorEmail) || context.user?.email || null,
        action: cleanOptionalString(input?.action) || 'unknown',
        entityType: cleanOptionalString(input?.entityType) || 'unknown',
        entityId: cleanOptionalString(input?.entityId) || 'unknown',
        metadata: input?.metadata && typeof input.metadata === 'object' ? input.metadata : {},
        createdAt: context.serverTimestamp ? context.serverTimestamp() : new Date()
    };
}

function detectStudentDuplicates(students) {
    const records = Array.isArray(students) ? students : [];
    const duplicateGroups = [];
    const indexes = {
        email: new Map(),
        phone: new Map()
    };

    records.forEach((student) => {
        const studentId = String(student?.studentId || '').trim();
        const email = String(student?.email || '').trim().toLowerCase();
        const phone = String(student?.phone || '').trim();

        if (email) {
            const list = indexes.email.get(email) || [];
            list.push(studentId);
            indexes.email.set(email, list);
        }
        if (phone) {
            const list = indexes.phone.get(phone) || [];
            list.push(studentId);
            indexes.phone.set(phone, list);
        }
    });

    indexes.email.forEach((ids, key) => {
        if (ids.length > 1) duplicateGroups.push({ kind: 'email', key, studentIds: ids });
    });
    indexes.phone.forEach((ids, key) => {
        if (ids.length > 1) duplicateGroups.push({ kind: 'phone', key, studentIds: ids });
    });

    return duplicateGroups;
}

function buildMergeJob(input, context = {}) {
    const primaryStudentId = cleanOptionalString(input?.primaryStudentId);
    const duplicateStudentIds = Array.isArray(input?.duplicateStudentIds)
        ? input.duplicateStudentIds.map((id) => cleanOptionalString(id)).filter(Boolean)
        : [];
    if (!primaryStudentId || !duplicateStudentIds.length) {
        throw new Error('Merge job requires a primary student and at least one duplicate.');
    }

    return {
        primaryStudentId,
        duplicateStudentIds,
        status: 'pending',
        createdAt: context.serverTimestamp ? context.serverTimestamp() : new Date(),
        createdBy: context.user?.uid || null,
        createdByEmail: context.user?.email || null
    };
}

function canAccessCrmRole(actorRole, requiredRole) {
    const actor = cleanOptionalString(actorRole);
    const required = cleanOptionalString(requiredRole);

    if (!actor || !required) {
        return false;
    }
    if (actor === 'admin') {
        return true;
    }
    if (required === 'admin') {
        return false;
    }
    if (actor === required) {
        return true;
    }

    const privileges = new Map([
        ['teacher', 1],
        ['counselor', 2],
        ['finance', 2],
        ['admin', 3]
    ]);

    return (privileges.get(actor) || 0) >= (privileges.get(required) || Number.MAX_SAFE_INTEGER);
}

module.exports = {
    CRM_ROLES,
    buildAuditLogEntry,
    detectStudentDuplicates,
    buildMergeJob,
    canAccessCrmRole
};
