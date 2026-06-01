const AGENT_SOURCE_STATUSES = ['active', 'inactive'];

function cleanOptionalString(value) {
    const normalized = String(value || '').trim();
    return normalized || null;
}

function normalizeStatus(value, fallback = 'active') {
    const normalized = String(value || fallback).trim().toLowerCase();
    if (!AGENT_SOURCE_STATUSES.includes(normalized)) {
        throw new Error(`Invalid agent source status: ${normalized}`);
    }
    return normalized;
}

function normalizeRateBps(value, label = 'Agent source course rate') {
    if (value === null || value === undefined || value === '') {
        throw new Error(`${label} must be a number.`);
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        throw new Error(`${label} must be a number.`);
    }
    const rounded = Math.round(numeric);
    if (rounded < 0 || rounded > 10000) {
        throw new Error(`${label} must be between 0 and 10000 bps.`);
    }
    return rounded;
}

function normalizeCourseRates(raw, options = {}) {
    const strict = options.strict !== false;
    if (raw === null || raw === undefined || raw === '') return {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        if (strict) {
            throw new Error('Agent source course rates must be an object map.');
        }
        return {};
    }
    const entries = [];
    const rates = raw;
    Object.entries(rates).forEach(([courseId, bps]) => {
        const normalizedCourseId = String(courseId || '').trim();
        if (!normalizedCourseId) {
            if (strict) {
                throw new Error('Agent source course rate requires a course id.');
            }
            return;
        }
        try {
            entries.push([
                normalizedCourseId,
                normalizeRateBps(bps, `Agent source course rate for ${normalizedCourseId}`)
            ]);
        } catch (error) {
            if (strict) {
                throw error;
            }
        }
    });
    return Object.fromEntries(entries);
}

function buildAgentSourceCreateData(input, context = {}) {
    const name = cleanOptionalString(input?.name);
    if (!name) {
        throw new Error('Agent source name is required.');
    }

    return {
        name,
        status: normalizeStatus(input?.status, 'active'),
        notes: cleanOptionalString(input?.notes),
        courseRates: normalizeCourseRates(input?.courseRates),
        createdAt: context.serverTimestamp ? context.serverTimestamp() : new Date(),
        createdBy: context.user?.uid || null,
        createdByEmail: context.user?.email || null
    };
}

function buildAgentSourcePatchData(existing, input, context = {}) {
    const payload = input && typeof input === 'object' ? input : {};
    const hasName = Object.prototype.hasOwnProperty.call(payload, 'name');
    const hasStatus = Object.prototype.hasOwnProperty.call(payload, 'status');
    const hasNotes = Object.prototype.hasOwnProperty.call(payload, 'notes');
    const hasCourseRates = Object.prototype.hasOwnProperty.call(payload, 'courseRates');
    if (!hasName && !hasStatus && !hasNotes && !hasCourseRates) {
        throw new Error('No agent source fields provided for update.');
    }

    const next = {
        ...existing
    };
    if (hasName) {
        const name = cleanOptionalString(payload.name);
        if (!name) {
            throw new Error('Agent source name is required.');
        }
        next.name = name;
    }
    if (hasStatus) {
        next.status = normalizeStatus(payload.status, cleanOptionalString(existing?.status) || 'active');
    }
    if (hasNotes) {
        next.notes = cleanOptionalString(payload.notes);
    }
    if (hasCourseRates) {
        next.courseRates = normalizeCourseRates(payload.courseRates);
    }

    return {
        ...next,
        updatedAt: context.serverTimestamp ? context.serverTimestamp() : new Date(),
        updatedBy: context.user?.uid || null
    };
}

function mapAgentSourceRecord(doc, agentSourceId) {
    const data = doc && typeof doc.data === 'function' ? doc.data() : (doc || {});
    return {
        agentSourceId: agentSourceId || doc?.id || null,
        name: cleanOptionalString(data.name),
        status: cleanOptionalString(data.status) || 'active',
        notes: cleanOptionalString(data.notes),
        courseRates: normalizeCourseRates(data.courseRates, { strict: false }),
        createdAt: data.createdAt || null,
        createdBy: data.createdBy || null,
        createdByEmail: data.createdByEmail || null,
        updatedAt: data.updatedAt || null,
        updatedBy: data.updatedBy || null
    };
}

module.exports = {
    AGENT_SOURCE_STATUSES,
    cleanOptionalString,
    normalizeStatus,
    buildAgentSourceCreateData,
    buildAgentSourcePatchData,
    mapAgentSourceRecord
};
