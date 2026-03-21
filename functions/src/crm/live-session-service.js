const LIVE_SESSION_STATUSES = Object.freeze(['draft', 'scheduled', 'live', 'ended', 'cancelled']);

function resolveTimestamp(context = {}) {
    if (typeof context.serverTimestamp === 'function') {
        return context.serverTimestamp();
    }
    return new Date();
}

function cleanOptionalString(value, fallback = null) {
    const normalized = String(value || '').trim();
    return normalized || fallback;
}

function normalizeDateLike(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }
    if (typeof value === 'string') {
        const normalized = value.trim();
        return normalized || null;
    }
    return value;
}

function assertStatus(status) {
    if (!LIVE_SESSION_STATUSES.includes(status)) {
        throw new Error(`Live session status must be one of: ${LIVE_SESSION_STATUSES.join(', ')}.`);
    }
}

function validateStatusTransition(fromStatus, toStatus) {
    const current = cleanOptionalString(fromStatus, 'draft') || 'draft';
    const next = cleanOptionalString(toStatus, current) || current;

    const allowed = new Map([
        ['draft', new Set(['draft', 'scheduled', 'cancelled'])],
        ['scheduled', new Set(['draft', 'scheduled', 'cancelled'])],
        ['live', new Set(['live', 'ended'])],
        ['ended', new Set(['ended'])],
        ['cancelled', new Set(['draft', 'scheduled', 'cancelled'])]
    ]);

    const allowedNext = allowed.get(current);
    if (!allowedNext || !allowedNext.has(next)) {
        throw new Error(`Invalid live session status transition: ${current} -> ${next}.`);
    }
}

function validateScheduledFields(data) {
    if ((data.status === 'scheduled' || data.status === 'live') && !cleanOptionalString(data.meetingUrl)) {
        throw new Error('Live sessions with scheduled or live status require meetingUrl.');
    }
    if (data.status === 'scheduled' && !normalizeDateLike(data.scheduledStartAt)) {
        throw new Error('Scheduled live sessions require scheduledStartAt.');
    }
}

function buildBasePayload(input = {}, context = {}) {
    const now = resolveTimestamp(context);
    const status = cleanOptionalString(input.status, 'draft') || 'draft';
    assertStatus(status);

    return {
        classId: cleanOptionalString(input.classId),
        courseId: cleanOptionalString(input.courseId),
        title: cleanOptionalString(input.title, '') || '',
        provider: 'zoom',
        meetingUrl: cleanOptionalString(input.meetingUrl),
        hostUrl: cleanOptionalString(input.hostUrl),
        meetingId: cleanOptionalString(input.meetingId),
        passcode: cleanOptionalString(input.passcode),
        scheduledStartAt: normalizeDateLike(input.scheduledStartAt),
        scheduledEndAt: normalizeDateLike(input.scheduledEndAt),
        status,
        notes: cleanOptionalString(input.notes),
        createdAt: now,
        updatedAt: now,
        startedAt: normalizeDateLike(input.startedAt),
        endedAt: normalizeDateLike(input.endedAt),
        createdBy: cleanOptionalString(context.user?.uid),
        updatedBy: cleanOptionalString(context.user?.uid)
    };
}

function buildLiveSessionCreateData(input = {}, context = {}) {
    const payload = buildBasePayload(input, context);
    if (!payload.classId) {
        throw new Error('Live session requires classId.');
    }
    if (!payload.title) {
        throw new Error('Live session title is required.');
    }
    validateScheduledFields(payload);
    return payload;
}

function buildLiveSessionPatchData(existing = {}, input = {}, context = {}) {
    const patch = {};
    const allowedStringFields = ['title', 'meetingUrl', 'hostUrl', 'meetingId', 'passcode', 'notes', 'courseId'];
    for (const key of allowedStringFields) {
        if (Object.prototype.hasOwnProperty.call(input || {}, key)) {
            patch[key] = cleanOptionalString(input[key]);
        }
    }
    for (const key of ['scheduledStartAt', 'scheduledEndAt']) {
        if (Object.prototype.hasOwnProperty.call(input || {}, key)) {
            patch[key] = normalizeDateLike(input[key]);
        }
    }
    if (Object.prototype.hasOwnProperty.call(input || {}, 'status')) {
        const nextStatus = cleanOptionalString(input.status, existing.status || 'draft') || existing.status || 'draft';
        assertStatus(nextStatus);
        validateStatusTransition(existing.status || 'draft', nextStatus);
        patch.status = nextStatus;
    }

    if (Object.keys(patch).length === 0) {
        throw new Error('No live session fields provided for update.');
    }

    const next = {
        ...existing,
        ...patch,
        provider: 'zoom',
        updatedAt: resolveTimestamp(context),
        updatedBy: cleanOptionalString(context.user?.uid)
    };

    if (Object.prototype.hasOwnProperty.call(patch, 'title') && !cleanOptionalString(next.title, '')) {
        throw new Error('Live session title is required.');
    }

    validateScheduledFields(next);
    return next;
}

function buildLiveSessionStartPatch(existing = {}, context = {}) {
    const currentStatus = cleanOptionalString(existing.status, 'draft') || 'draft';
    if (currentStatus !== 'scheduled') {
        throw new Error('Only scheduled live sessions can be started.');
    }
    validateScheduledFields({
        ...existing,
        status: 'scheduled'
    });
    const now = resolveTimestamp(context);
    return {
        status: 'live',
        startedAt: now,
        endedAt: null,
        updatedAt: now,
        updatedBy: cleanOptionalString(context.user?.uid)
    };
}

function buildLiveSessionEndPatch(existing = {}, context = {}) {
    const currentStatus = cleanOptionalString(existing.status, 'draft') || 'draft';
    if (currentStatus !== 'live') {
        throw new Error('Only live sessions can be ended.');
    }
    const now = resolveTimestamp(context);
    return {
        status: 'ended',
        endedAt: now,
        updatedAt: now,
        updatedBy: cleanOptionalString(context.user?.uid)
    };
}

function deriveFlags(data = {}) {
    const status = cleanOptionalString(data.status, 'draft') || 'draft';
    return {
        isUpcoming: status === 'scheduled',
        isLive: status === 'live',
        isEnded: status === 'ended'
    };
}

function mapLiveSessionRecord(doc, sessionId) {
    const data = doc && typeof doc.data === 'function' ? doc.data() : (doc || {});
    return {
        sessionId: sessionId || doc?.id || null,
        classId: cleanOptionalString(data.classId),
        courseId: cleanOptionalString(data.courseId),
        title: cleanOptionalString(data.title, '') || '',
        provider: cleanOptionalString(data.provider, 'zoom') || 'zoom',
        meetingUrl: cleanOptionalString(data.meetingUrl),
        hostUrl: cleanOptionalString(data.hostUrl),
        meetingId: cleanOptionalString(data.meetingId),
        passcode: cleanOptionalString(data.passcode),
        scheduledStartAt: normalizeDateLike(data.scheduledStartAt),
        scheduledEndAt: normalizeDateLike(data.scheduledEndAt),
        status: cleanOptionalString(data.status, 'draft') || 'draft',
        notes: cleanOptionalString(data.notes),
        createdAt: data.createdAt || null,
        updatedAt: data.updatedAt || null,
        startedAt: data.startedAt || null,
        endedAt: data.endedAt || null,
        createdBy: cleanOptionalString(data.createdBy),
        updatedBy: cleanOptionalString(data.updatedBy),
        ...deriveFlags(data)
    };
}

function toSortValue(value, fallback = 0) {
    if (!value) return fallback;
    if (typeof value?.toMillis === 'function') return value.toMillis();
    if (value instanceof Date) return value.getTime();
    const parsed = Date.parse(String(value));
    return Number.isFinite(parsed) ? parsed : fallback;
}

function sortLiveSessions(records) {
    return (Array.isArray(records) ? records.slice() : []).sort((left, right) => {
        const rightStart = toSortValue(right?.scheduledStartAt, toSortValue(right?.createdAt));
        const leftStart = toSortValue(left?.scheduledStartAt, toSortValue(left?.createdAt));
        return rightStart - leftStart;
    });
}

module.exports = {
    LIVE_SESSION_STATUSES,
    buildLiveSessionCreateData,
    buildLiveSessionPatchData,
    buildLiveSessionStartPatch,
    buildLiveSessionEndPatch,
    mapLiveSessionRecord,
    sortLiveSessions
};
