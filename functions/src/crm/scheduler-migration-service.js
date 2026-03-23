const {
    normalizeScheduleConfig
} = require('./course-service');
const {
    buildScheduledSessionWriteData,
    normalizeScheduledSession
} = require('./scheduling-service');

function cleanOptionalString(value, fallback = null) {
    const normalized = String(value || '').trim();
    return normalized || fallback;
}

function hasCanonicalScheduledWindow(session) {
    return !!cleanOptionalString(session?.scheduledStartAtUtc)
        && !!cleanOptionalString(session?.scheduledEndAtUtc)
        && !!cleanOptionalString(session?.scheduledLocalDate)
        && !!cleanOptionalString(session?.scheduledLocalTime)
        && !!cleanOptionalString(session?.timezone);
}

function needsScheduledSessionCanonicalBackfill(session) {
    return !hasCanonicalScheduledWindow(session || {});
}

function buildScheduledSessionCanonicalBackfill(session, classroomTimezone) {
    const current = session && typeof session === 'object' ? session : {};
    const timezone = cleanOptionalString(current.timezone) || cleanOptionalString(classroomTimezone);
    if (!timezone) {
        return {
            status: 'unresolved',
            reason: 'missing_timezone',
            patch: null
        };
    }

    try {
        const normalized = normalizeScheduledSession({
            ...current,
            timezone
        });
        if (!normalized.scheduledStartAtUtc || !normalized.scheduledEndAtUtc || !normalized.scheduledLocalDate || !normalized.scheduledLocalTime) {
            return {
                status: 'unresolved',
                reason: 'missing_canonical_window',
                patch: null
            };
        }

        const patch = buildScheduledSessionWriteData({}, {
            scheduledStartAtUtc: normalized.scheduledStartAtUtc,
            scheduledEndAtUtc: normalized.scheduledEndAtUtc,
            timezone
        });
        const status = hasCanonicalScheduledWindow(current) ? 'already_consistent' : 'patched';
        return {
            status,
            reason: null,
            patch: status === 'patched' ? patch : null
        };
    } catch (error) {
        return {
            status: 'unresolved',
            reason: error?.message || 'invalid_legacy_datetime',
            patch: null
        };
    }
}

function needsClassroomScheduleBackfill(classroom) {
    const scheduleConfig = classroom?.scheduleConfig || null;
    if (!scheduleConfig) return false;
    return !Number(scheduleConfig.targetSessionCount || 0) || !Number(scheduleConfig.scheduleVersion || 0);
}

function buildClassroomScheduleBackfill(classroom) {
    const current = classroom && typeof classroom === 'object' ? classroom : {};
    const scheduleConfig = current.scheduleConfig || null;
    if (!scheduleConfig) {
        return {
            status: 'already_consistent',
            reason: null,
            patch: null
        };
    }

    try {
        const normalized = normalizeScheduleConfig(scheduleConfig, {
            existing: scheduleConfig,
            preserveExistingTargetSessionCount: true
        });
        const status = needsClassroomScheduleBackfill(current) ? 'patched' : 'already_consistent';
        return {
            status,
            reason: null,
            patch: status === 'patched' ? { scheduleConfig: normalized } : null
        };
    } catch (error) {
        return {
            status: 'unresolved',
            reason: error?.message || 'invalid_schedule_config',
            patch: null
        };
    }
}

module.exports = {
    buildClassroomScheduleBackfill,
    buildScheduledSessionCanonicalBackfill,
    needsClassroomScheduleBackfill,
    needsScheduledSessionCanonicalBackfill
};
