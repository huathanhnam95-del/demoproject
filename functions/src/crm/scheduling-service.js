function cleanOptionalString(value, fallback = null) {
    const normalized = String(value || '').trim();
    return normalized || fallback;
}

function toPositiveInteger(value, label) {
    const numeric = Number(value);
    if (!Number.isInteger(numeric) || numeric <= 0) {
        throw new Error(`${label} must be a positive integer.`);
    }
    return numeric;
}

function pad(value) {
    return String(value).padStart(2, '0');
}

function formatLocalDateTime(dateParts) {
    const year = String(dateParts.year).padStart(4, '0');
    const month = pad(dateParts.month);
    const day = pad(dateParts.day);
    const hour = pad(dateParts.hour);
    const minute = pad(dateParts.minute);
    const second = pad(dateParts.second ?? 0);
    return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
}

function formatLocalDate(dateParts) {
    return `${String(dateParts.year).padStart(4, '0')}-${pad(dateParts.month)}-${pad(dateParts.day)}`;
}

function formatLocalTime(dateParts) {
    return `${pad(dateParts.hour)}:${pad(dateParts.minute)}`;
}

function parseLocalDateTime(dateStr, timeStr) {
    const [year, month, day] = String(dateStr || '').split('-').map((part) => Number(part));
    const [hour, minute, second = 0] = String(timeStr || '00:00').split(':').map((part) => Number(part));
    if (![year, month, day, hour, minute].every((value) => Number.isFinite(value))) {
        throw new Error('Invalid date or time.');
    }
    return { year, month, day, hour, minute, second };
}

function splitLocalDateTime(value) {
    const [datePart, timePart = '00:00:00'] = String(value || '').split('T');
    return { datePart, timePart };
}

function addMinutesToLocalDateTime(dateStr, timeStr, minutesToAdd) {
    const base = parseLocalDateTime(dateStr, timeStr);
    const utc = Date.UTC(base.year, base.month - 1, base.day, base.hour, base.minute, base.second);
    const next = new Date(utc + Number(minutesToAdd || 0) * 60000);
    return formatLocalDateTime({
        year: next.getUTCFullYear(),
        month: next.getUTCMonth() + 1,
        day: next.getUTCDate(),
        hour: next.getUTCHours(),
        minute: next.getUTCMinutes(),
        second: next.getUTCSeconds()
    });
}

function addDays(dateStr, days) {
    const date = new Date(`${dateStr}T00:00:00`);
    date.setDate(date.getDate() + Number(days || 0));
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function getWeekdayNumber(dateStr) {
    return new Date(`${dateStr}T00:00:00`).getDay();
}

const formatterCache = new Map();

function getTimeZoneFormatter(timezone) {
    const zone = cleanOptionalString(timezone, 'UTC');
    if (!formatterCache.has(zone)) {
        formatterCache.set(zone, new Intl.DateTimeFormat('en-CA', {
            timeZone: zone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hourCycle: 'h23'
        }));
    }
    return formatterCache.get(zone);
}

function getTimeZoneParts(date, timezone) {
    const formatter = getTimeZoneFormatter(timezone);
    const parts = formatter.formatToParts(date);
    const bag = {};
    for (const part of parts) {
        if (part.type !== 'literal') {
            bag[part.type] = part.value;
        }
    }
    return {
        year: Number(bag.year),
        month: Number(bag.month),
        day: Number(bag.day),
        hour: Number(bag.hour),
        minute: Number(bag.minute),
        second: Number(bag.second)
    };
}

function getUtcTimestampFromParts(dateParts) {
    return Date.UTC(
        Number(dateParts.year),
        Number(dateParts.month) - 1,
        Number(dateParts.day),
        Number(dateParts.hour),
        Number(dateParts.minute),
        Number(dateParts.second ?? 0)
    );
}

function sameDateParts(left, right) {
    return Number(left.year) === Number(right.year)
        && Number(left.month) === Number(right.month)
        && Number(left.day) === Number(right.day)
        && Number(left.hour) === Number(right.hour)
        && Number(left.minute) === Number(right.minute)
        && Number(left.second ?? 0) === Number(right.second ?? 0);
}

function localDateTimeToUtcIso(localDate, localTime, timezone) {
    const desired = parseLocalDateTime(localDate, localTime);
    const zone = cleanOptionalString(timezone, 'UTC');
    const initialGuess = getUtcTimestampFromParts(desired);

    function resolveCandidate(guessMs) {
        const zonedParts = getTimeZoneParts(new Date(guessMs), zone);
        const zonedUtcMs = getUtcTimestampFromParts(zonedParts);
        return guessMs - (zonedUtcMs - guessMs);
    }

    let candidateMs = resolveCandidate(initialGuess);
    let candidateParts = getTimeZoneParts(new Date(candidateMs), zone);
    if (!sameDateParts(candidateParts, desired)) {
        candidateMs = resolveCandidate(candidateMs);
        candidateParts = getTimeZoneParts(new Date(candidateMs), zone);
    }

    if (!sameDateParts(candidateParts, desired)) {
        throw new Error('Invalid local date/time for timezone.');
    }

    return new Date(candidateMs).toISOString();
}

function utcIsoToLocalFields(utcIso, timezone) {
    const zone = cleanOptionalString(timezone, 'UTC');
    const date = new Date(String(utcIso || ''));
    if (!Number.isFinite(date.getTime())) {
        throw new Error('Invalid UTC timestamp.');
    }
    const parts = getTimeZoneParts(date, zone);
    return {
        scheduledLocalDate: formatLocalDate(parts),
        scheduledLocalTime: formatLocalTime(parts)
    };
}

function buildLocalDateTimeString(localDate, localTime) {
    return formatLocalDateTime(parseLocalDateTime(localDate, localTime));
}

function buildCanonicalScheduledWindow({
    targetLocalDate,
    targetLocalTime,
    timezone,
    durationMinutes
}) {
    const zone = cleanOptionalString(timezone, 'UTC');
    const minutes = toPositiveInteger(durationMinutes, 'Duration minutes');
    const scheduledStartAtUtc = localDateTimeToUtcIso(targetLocalDate, targetLocalTime, zone);
    const scheduledEndAtUtc = new Date(new Date(scheduledStartAtUtc).getTime() + minutes * 60000).toISOString();
    const startLocal = utcIsoToLocalFields(scheduledStartAtUtc, zone);
    const endLocal = utcIsoToLocalFields(scheduledEndAtUtc, zone);

    return {
        scheduledStartAtUtc,
        scheduledEndAtUtc,
        scheduledLocalDate: startLocal.scheduledLocalDate,
        scheduledLocalTime: startLocal.scheduledLocalTime,
        scheduledStartAt: buildLocalDateTimeString(startLocal.scheduledLocalDate, startLocal.scheduledLocalTime),
        scheduledEndAt: buildLocalDateTimeString(endLocal.scheduledLocalDate, endLocal.scheduledLocalTime),
        timezone: zone,
        durationMinutes: minutes
    };
}

function buildScheduledSessionCompatibilityProjection({
    scheduledStartAtUtc,
    scheduledEndAtUtc,
    timezone
}) {
    const zone = cleanOptionalString(timezone, 'UTC');
    const localStart = utcIsoToLocalFields(scheduledStartAtUtc, zone);
    const localEnd = utcIsoToLocalFields(scheduledEndAtUtc, zone);
    return {
        scheduledStartAtUtc,
        scheduledEndAtUtc,
        scheduledLocalDate: localStart.scheduledLocalDate,
        scheduledLocalTime: localStart.scheduledLocalTime,
        scheduledStartAt: buildLocalDateTimeString(localStart.scheduledLocalDate, localStart.scheduledLocalTime),
        scheduledEndAt: buildLocalDateTimeString(localEnd.scheduledLocalDate, localEnd.scheduledLocalTime),
        timezone: zone
    };
}

function buildScheduledSessionWriteData(baseData = {}, scheduleWindow = {}) {
    const base = baseData && typeof baseData === 'object' ? baseData : {};
    const windowInput = scheduleWindow && typeof scheduleWindow === 'object' ? scheduleWindow : {};

    if (windowInput.targetLocalDate && windowInput.targetLocalTime) {
        return {
            ...base,
            ...buildCanonicalScheduledWindow(windowInput)
        };
    }

    const scheduledStartAtUtc = cleanOptionalString(windowInput.scheduledStartAtUtc, cleanOptionalString(base.scheduledStartAtUtc));
    const scheduledEndAtUtc = cleanOptionalString(windowInput.scheduledEndAtUtc, cleanOptionalString(base.scheduledEndAtUtc));
    const timezone = cleanOptionalString(windowInput.timezone, cleanOptionalString(base.timezone, 'UTC'));
    if (!scheduledStartAtUtc || !scheduledEndAtUtc) {
        return normalizeScheduledSession({
            ...base,
            ...windowInput,
            timezone
        });
    }

    return {
        ...base,
        ...windowInput,
        ...buildScheduledSessionCompatibilityProjection({
            scheduledStartAtUtc,
            scheduledEndAtUtc,
            timezone
        })
    };
}

function looksLikeUtcInstant(value) {
    return /(?:z|[+-]\d{2}:\d{2})$/i.test(String(value || ''));
}

function normalizeScheduledSession(session) {
    const base = session && typeof session === 'object' ? session : {};
    const timezone = cleanOptionalString(base.timezone, 'UTC');
    const normalized = {
        ...base,
        timezone
    };

    let scheduledStartAtUtc = cleanOptionalString(base.scheduledStartAtUtc);
    let scheduledEndAtUtc = cleanOptionalString(base.scheduledEndAtUtc);
    let scheduledLocalDate = cleanOptionalString(base.scheduledLocalDate);
    let scheduledLocalTime = cleanOptionalString(base.scheduledLocalTime);
    let scheduledStartAt = cleanOptionalString(base.scheduledStartAt);
    let scheduledEndAt = cleanOptionalString(base.scheduledEndAt);
    const durationMinutes = Number(base.durationMinutes || 0) || null;

    if (scheduledStartAtUtc && !scheduledEndAtUtc && durationMinutes) {
        scheduledEndAtUtc = new Date(new Date(scheduledStartAtUtc).getTime() + durationMinutes * 60000).toISOString();
    }

    if (!scheduledStartAtUtc && scheduledStartAt) {
        if (looksLikeUtcInstant(scheduledStartAt)) {
            scheduledStartAtUtc = new Date(scheduledStartAt).toISOString();
            if (scheduledEndAt) {
                scheduledEndAtUtc = looksLikeUtcInstant(scheduledEndAt)
                    ? new Date(scheduledEndAt).toISOString()
                    : null;
            }
            if (!scheduledEndAtUtc && durationMinutes) {
                scheduledEndAtUtc = new Date(new Date(scheduledStartAtUtc).getTime() + durationMinutes * 60000).toISOString();
            }
        } else {
            const parsedStart = splitLocalDateTime(scheduledStartAt);
            const parsedEnd = scheduledEndAt ? splitLocalDateTime(scheduledEndAt) : null;
            scheduledStartAtUtc = localDateTimeToUtcIso(parsedStart.datePart, parsedStart.timePart, timezone);
            if (parsedEnd) {
                scheduledEndAtUtc = localDateTimeToUtcIso(parsedEnd.datePart, parsedEnd.timePart, timezone);
            } else if (durationMinutes) {
                scheduledEndAtUtc = new Date(new Date(scheduledStartAtUtc).getTime() + durationMinutes * 60000).toISOString();
            }
        }
    }

    if (!scheduledStartAtUtc && scheduledLocalDate && scheduledLocalTime) {
        const window = buildCanonicalScheduledWindow({
            targetLocalDate: scheduledLocalDate,
            targetLocalTime: scheduledLocalTime,
            timezone,
            durationMinutes: durationMinutes || 60
        });
        scheduledStartAtUtc = window.scheduledStartAtUtc;
        scheduledEndAtUtc = window.scheduledEndAtUtc;
        scheduledStartAt = window.scheduledStartAt;
        scheduledEndAt = window.scheduledEndAt;
    }

    if (scheduledStartAtUtc) {
        const localStart = utcIsoToLocalFields(scheduledStartAtUtc, timezone);
        scheduledLocalDate = localStart.scheduledLocalDate;
        scheduledLocalTime = localStart.scheduledLocalTime;
        if (!scheduledStartAt) {
            scheduledStartAt = buildLocalDateTimeString(scheduledLocalDate, scheduledLocalTime);
        }
    }

    if (scheduledEndAtUtc) {
        const localEnd = utcIsoToLocalFields(scheduledEndAtUtc, timezone);
        if (!scheduledEndAt) {
            scheduledEndAt = buildLocalDateTimeString(localEnd.scheduledLocalDate, localEnd.scheduledLocalTime);
        }
    }

    return {
        ...normalized,
        scheduledStartAtUtc,
        scheduledEndAtUtc,
        scheduledLocalDate,
        scheduledLocalTime,
        scheduledStartAt,
        scheduledEndAt
    };
}

function computeContractedTargetCount({ totalInstructionMinutes, sessionMinutes }) {
    const totalMinutes = toPositiveInteger(totalInstructionMinutes, 'Total instruction minutes');
    const perSessionMinutes = toPositiveInteger(sessionMinutes, 'Session minutes');
    if (totalMinutes % perSessionMinutes !== 0) {
        throw new Error('Session minutes must divide total instruction minutes exactly.');
    }
    return totalMinutes / perSessionMinutes;
}

function validateRemainingDurationChange({ totalInstructionMinutes, completedContractedMinutes = 0, nextSessionMinutes }) {
    const totalMinutes = toPositiveInteger(totalInstructionMinutes, 'Total instruction minutes');
    const completedMinutes = Number(completedContractedMinutes);
    if (!Number.isFinite(completedMinutes) || completedMinutes < 0) {
        throw new Error('Completed contracted minutes must be zero or greater.');
    }
    if (completedMinutes > totalMinutes) {
        throw new Error('Completed contracted minutes cannot exceed total instruction minutes.');
    }

    const remainingInstructionMinutes = totalMinutes - completedMinutes;
    const sessionMinutes = toPositiveInteger(nextSessionMinutes, 'Session minutes');
    if (remainingInstructionMinutes === 0) {
        return {
            remainingInstructionMinutes: 0,
            contractedTargetCount: 0
        };
    }
    if (remainingInstructionMinutes % sessionMinutes !== 0) {
        throw new Error('Session minutes must divide remaining instruction minutes exactly.');
    }

    return {
        remainingInstructionMinutes,
        contractedTargetCount: remainingInstructionMinutes / sessionMinutes
    };
}

function buildSeedSessions({
    classId,
    courseId,
    teacherUid,
    sessionMinutes,
    timezone,
    startDate,
    weekdayNumbers,
    startTime,
    targetSessionCount,
    seedBatchId
}) {
    const count = toPositiveInteger(targetSessionCount, 'Target session count');
    const perSessionMinutes = toPositiveInteger(sessionMinutes, 'Session minutes');
    const days = Array.isArray(weekdayNumbers)
        ? weekdayNumbers.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value >= 0 && value <= 6)
        : [];
    if (days.length === 0) {
        throw new Error('At least one weekday number is required to seed sessions.');
    }

    const sessions = [];
    let cursor = cleanOptionalString(startDate);
    while (sessions.length < count) {
        if (days.includes(getWeekdayNumber(cursor))) {
            sessions.push({
                classId: cleanOptionalString(classId),
                courseId: cleanOptionalString(courseId),
                teacherUid: cleanOptionalString(teacherUid),
                ...buildScheduledSessionWriteData({}, {
                    targetLocalDate: cursor,
                    targetLocalTime: cleanOptionalString(startTime, '00:00'),
                    timezone,
                    durationMinutes: perSessionMinutes
                }),
                unitType: 'contracted',
                contractUnitIndex: sessions.length + 1,
                overflowSequence: null,
                seedBatchId: cleanOptionalString(seedBatchId),
                replacementOfSessionId: null,
                status: 'scheduled',
                attendanceState: 'none',
                lockState: 'unlocked',
                lockReason: null,
                version: 1
            });
        }
        cursor = addDays(cursor, 1);
    }

    return sessions;
}

function buildScheduleSummary({ totalInstructionMinutes, sessionMinutes, targetSessionCount = null, sessions, nowIso = null }) {
    const contractedTargetCount = Number(targetSessionCount || 0) > 0
        ? toPositiveInteger(targetSessionCount, 'Target session count')
        : computeContractedTargetCount({
            totalInstructionMinutes,
            sessionMinutes
        });
    const list = Array.isArray(sessions) ? sessions.map(normalizeScheduledSession) : [];
    const active = list.filter((session) => String(session?.status || 'scheduled') !== 'cancelled');
    const contracted = active.filter((session) => session.unitType === 'contracted');
    const overflow = active.filter((session) => session.unitType === 'overflow');
    const contractedCompletedCount = contracted.filter((session) =>
        session.status === 'completed' || session.attendanceState === 'finalized'
    ).length;

    const nowMs = nowIso ? new Date(nowIso).getTime() : Date.now();
    const nextScheduledAt = active
        .map((session) => cleanOptionalString(session.scheduledStartAtUtc))
        .filter(Boolean)
        .filter((iso) => new Date(iso).getTime() >= nowMs)
        .sort((left, right) => new Date(left).getTime() - new Date(right).getTime())[0] || null;

    return {
        contractedTargetCount,
        contractedAssignedCount: contracted.length,
        contractedCompletedCount,
        remainingToScheduleCount: Math.max(contractedTargetCount - contracted.length, 0),
        overflowCount: overflow.length,
        nextScheduledAt
    };
}

function overlapsUtc(left, right) {
    const leftStart = new Date(left.scheduledStartAtUtc).getTime();
    const leftEnd = new Date(left.scheduledEndAtUtc).getTime();
    const rightStart = new Date(right.scheduledStartAtUtc).getTime();
    const rightEnd = new Date(right.scheduledEndAtUtc).getTime();
    return leftStart < rightEnd && leftEnd > rightStart;
}

function parseWeekdayValue(value) {
    const stringValue = String(value || '').trim().toLowerCase();
    const map = {
        sun: 0,
        sunday: 0,
        mon: 1,
        monday: 1,
        tue: 2,
        tues: 2,
        tuesday: 2,
        wed: 3,
        wednesday: 3,
        thu: 4,
        thur: 4,
        thurs: 4,
        thursday: 4,
        fri: 5,
        friday: 5,
        sat: 6,
        saturday: 6
    };
    if (map[stringValue] !== undefined) return map[stringValue];
    const numeric = Number(value);
    return Number.isInteger(numeric) && numeric >= 0 && numeric <= 6 ? numeric : null;
}

function normalizeWeekdayNumbers(values) {
    return Array.from(new Set(
        (Array.isArray(values) ? values : [])
            .map(parseWeekdayValue)
            .filter((value) => Number.isInteger(value))
    )).sort((left, right) => left - right);
}

function toComparableDate(value) {
    const date = new Date(`${String(value || '')}T00:00:00`);
    return Number.isFinite(date.getTime()) ? date : null;
}

function isActiveSession(session) {
    return String(session?.status || 'scheduled') !== 'cancelled';
}

function isLockedOrStartedSession(session) {
    return String(session?.lockState || 'unlocked') === 'hard_locked'
        || String(session?.attendanceState || 'none') === 'in_progress'
        || String(session?.attendanceState || 'none') === 'finalized';
}

function buildSessionConflictDetail(session) {
    return {
        sessionId: cleanOptionalString(session?.sessionId),
        classId: cleanOptionalString(session?.classId),
        unitType: cleanOptionalString(session?.unitType),
        contractUnitIndex: session?.contractUnitIndex ?? null,
        overflowSequence: session?.overflowSequence ?? null,
        scheduledLocalDate: cleanOptionalString(session?.scheduledLocalDate),
        scheduledLocalTime: cleanOptionalString(session?.scheduledLocalTime),
        lockState: cleanOptionalString(session?.lockState, 'unlocked'),
        attendanceState: cleanOptionalString(session?.attendanceState, 'none')
    };
}

function buildRequestedOccurrences({
    targetLocalDate,
    targetLocalTime,
    timezone,
    durationMinutes,
    addMode,
    recurringCount
}) {
    const count = addMode === 'recurring'
        ? Math.max(2, Math.min(12, toPositiveInteger(recurringCount, 'Recurring count')))
        : 1;
    const occurrences = [];
    for (let index = 0; index < count; index += 1) {
        const localDate = addMode === 'recurring' ? addDays(targetLocalDate, index * 7) : targetLocalDate;
        occurrences.push({
            sequenceIndex: index,
            ...buildCanonicalScheduledWindow({
                targetLocalDate: localDate,
                targetLocalTime,
                timezone,
                durationMinutes
            })
        });
    }
    return occurrences;
}

function buildRegenerationPreview({
    classId,
    courseId,
    teacherUid,
    totalInstructionMinutes,
    currentTargetSessionCount,
    timezone,
    regenerateFromDate,
    sessionMinutes,
    seedWeekdays,
    seedStartTime,
    existingSessions = [],
    teacherConflictSessions = [],
    unresolvedSessionIds = []
}) {
    const normalizedExisting = Array.isArray(existingSessions)
        ? existingSessions.map(normalizeScheduledSession)
        : [];
    const normalizedTeacherConflicts = Array.isArray(teacherConflictSessions)
        ? teacherConflictSessions.map(normalizeScheduledSession)
        : [];
    const blockedReasonCodes = [];
    const warnings = [];
    const remediationGuidance = [];
    const blockedSessions = [];
    const fromDate = cleanOptionalString(regenerateFromDate);
    const targetDate = toComparableDate(fromDate);
    const nextSessionMinutes = toPositiveInteger(sessionMinutes, 'Session minutes');
    const weekdayNumbers = normalizeWeekdayNumbers(seedWeekdays);
    const classTimezone = cleanOptionalString(timezone, 'UTC');

    if (!targetDate) {
        throw new Error('regenerateFromDate is required.');
    }
    if (!weekdayNumbers.length) {
        throw new Error('At least one seed weekday is required.');
    }
    if (!cleanOptionalString(seedStartTime)) {
        throw new Error('seedStartTime is required.');
    }

    if (Array.isArray(unresolvedSessionIds) && unresolvedSessionIds.length) {
        blockedReasonCodes.push('unresolved_legacy_session');
        remediationGuidance.push('Complete scheduler backfill for unresolved legacy sessions before regenerating this class.');
        unresolvedSessionIds.forEach((sessionId) => {
            blockedSessions.push({
                sessionId,
                reasonCode: 'unresolved_legacy_session'
            });
        });
    }

    const activeSessions = normalizedExisting.filter(isActiveSession);
    const preservedOverflowSessions = activeSessions.filter((session) => session.unitType === 'overflow');
    const preservedContractedBeforeDate = activeSessions.filter((session) =>
        session.unitType === 'contracted'
        && toComparableDate(session.scheduledLocalDate)
        && toComparableDate(session.scheduledLocalDate) < targetDate
    );
    const lockedSessions = activeSessions.filter(isLockedOrStartedSession);
    const lockedFutureContractedSessions = activeSessions.filter((session) =>
        session.unitType === 'contracted'
        && isLockedOrStartedSession(session)
        && toComparableDate(session.scheduledLocalDate)
        && toComparableDate(session.scheduledLocalDate) >= targetDate
    );

    if (lockedFutureContractedSessions.length) {
        blockedReasonCodes.push('locked_future_contracted_session');
        remediationGuidance.push('Unlock or complete future contracted sessions before the regeneration date, then preview again.');
        lockedFutureContractedSessions.forEach((session) => {
            blockedSessions.push({
                ...buildSessionConflictDetail(session),
                reasonCode: 'locked_future_contracted_session'
            });
        });
    }

    const preservedContractedMinutes = preservedContractedBeforeDate.reduce((sum, session) =>
        sum + Number(session.durationMinutes || 0), 0
    );
    const preservedContractedCount = preservedContractedBeforeDate.length;
    const remainingInstructionMinutes = Number(totalInstructionMinutes || 0) - preservedContractedMinutes;
    if (remainingInstructionMinutes < 0 || (remainingInstructionMinutes > 0 && remainingInstructionMinutes % nextSessionMinutes !== 0)) {
        blockedReasonCodes.push('invalid_remaining_duration');
        remediationGuidance.push('Choose a session duration that divides the remaining undelivered minutes exactly.');
    }

    const generatedFutureContractedCount = remainingInstructionMinutes > 0 && remainingInstructionMinutes % nextSessionMinutes === 0
        ? remainingInstructionMinutes / nextSessionMinutes
        : 0;
    const nextTargetSessionCount = preservedContractedCount + generatedFutureContractedCount;
    const cancelCandidates = activeSessions.filter((session) =>
        session.unitType === 'contracted'
        && !isLockedOrStartedSession(session)
        && toComparableDate(session.scheduledLocalDate)
        && toComparableDate(session.scheduledLocalDate) >= targetDate
    );

    const preservedConflictSessions = Array.from(new Map(
        preservedContractedBeforeDate
            .concat(preservedOverflowSessions)
            .concat(lockedSessions)
            .map((session) => [String(session.sessionId || `${session.scheduledStartAtUtc}-${session.classId || ''}`), session])
    ).values());

    if (preservedOverflowSessions.length) {
        warnings.push('Existing overflow sessions remain scheduled and can block regenerated contracted slots.');
    }

    const previewSessions = [];
    const previewConflictSessions = preservedConflictSessions.slice();
    let cursor = fromDate;
    const searchLimitDate = addDays(fromDate, 730);
    while (previewSessions.length < generatedFutureContractedCount && cursor <= searchLimitDate) {
        if (weekdayNumbers.includes(getWeekdayNumber(cursor))) {
            const nextCandidate = buildScheduledSessionWriteData({
                classId: cleanOptionalString(classId),
                courseId: cleanOptionalString(courseId),
                teacherUid: cleanOptionalString(teacherUid),
                unitType: 'contracted',
                contractUnitIndex: preservedContractedCount + previewSessions.length + 1,
                overflowSequence: null,
                seedBatchId: null,
                replacementOfSessionId: null,
                status: 'scheduled',
                attendanceState: 'none',
                lockState: 'unlocked',
                lockReason: null,
                version: 1
            }, {
                targetLocalDate: cursor,
                targetLocalTime: cleanOptionalString(seedStartTime, '00:00'),
                timezone: classTimezone,
                durationMinutes: nextSessionMinutes
            });
            const conflict = previewConflictSessions.find((session) => overlapsUtc(session, nextCandidate))
                || normalizedTeacherConflicts.find((session) => overlapsUtc(session, nextCandidate));
            if (!conflict) {
                previewSessions.push(nextCandidate);
                previewConflictSessions.push(nextCandidate);
            }
        }
        cursor = addDays(cursor, 1);
    }

    if (previewSessions.length < generatedFutureContractedCount) {
        blockedReasonCodes.push('insufficient_future_slots');
        remediationGuidance.push('Adjust weekdays, start time, or preserved overflow sessions to open enough future slots for the remaining contracted minutes.');
        preservedConflictSessions.forEach((session) => {
            blockedSessions.push({
                ...buildSessionConflictDetail(session),
                reasonCode: 'insufficient_future_slots'
            });
        });
    }

    const summaryAfterCommit = buildScheduleSummary({
        totalInstructionMinutes,
        sessionMinutes: nextSessionMinutes,
        targetSessionCount: nextTargetSessionCount,
        sessions: preservedConflictSessions.concat(previewSessions)
    });

    return {
        canCommit: blockedReasonCodes.length === 0,
        regenerateFromDate: fromDate,
        blockedReasonCodes,
        blockedSessions,
        preservedContractedCount,
        preservedContractedMinutes,
        preservedOverflowCount: preservedOverflowSessions.length,
        cancelledFutureContractedCount: cancelCandidates.length,
        generatedFutureContractedCount,
        remainingInstructionMinutes,
        nextTargetSessionCount,
        previewSessions,
        warnings,
        summaryAfterCommit,
        remediationGuidance
    };
}

function buildRegenerationCommitPlan({
    preview,
    existingSessions = []
}) {
    const currentPreview = preview && typeof preview === 'object' ? preview : null;
    if (!currentPreview || !Array.isArray(currentPreview.previewSessions)) {
        throw new Error('A regeneration preview is required before commit.');
    }
    if (!currentPreview.canCommit) {
        throw new Error('Regeneration preview is blocked.');
    }

    const normalizedExisting = Array.isArray(existingSessions)
        ? existingSessions.map(normalizeScheduledSession)
        : [];
    const regenerateFromDate = currentPreview.regenerateFromDate || null;
    const targetDate = toComparableDate(regenerateFromDate);
    const cancelledSessions = normalizedExisting.filter((session) =>
        session.unitType === 'contracted'
        && isActiveSession(session)
        && !isLockedOrStartedSession(session)
        && targetDate
        && toComparableDate(session.scheduledLocalDate)
        && toComparableDate(session.scheduledLocalDate) >= targetDate
    );

    return {
        cancelledSessions,
        createdSessions: currentPreview.previewSessions
    };
}

function buildReasonSummary(reasonBuckets) {
    return Array.from(reasonBuckets.entries()).map(([code, details]) => ({
        code,
        count: details.sessionIds.length,
        sessionIds: details.sessionIds
    }));
}

function buildAddSessionPreview({
    classId,
    courseId,
    teacherUid,
    totalInstructionMinutes,
    targetSessionCount,
    sessionMinutes,
    timezone,
    targetLocalDate,
    targetLocalTime,
    durationMinutes,
    addMode = 'once',
    recurringCount = 1,
    existingSessions = []
}) {
    const effectiveTimezone = cleanOptionalString(timezone, 'UTC');
    const effectiveDuration = toPositiveInteger(durationMinutes || sessionMinutes, 'Duration minutes');
    const normalizedExisting = Array.isArray(existingSessions)
        ? existingSessions.map(normalizeScheduledSession)
        : [];
    const activeScheduled = normalizedExisting.filter((session) => String(session.status || 'scheduled') === 'scheduled');
    const requestedOccurrences = buildRequestedOccurrences({
        targetLocalDate,
        targetLocalTime,
        timezone: effectiveTimezone,
        durationMinutes: effectiveDuration,
        addMode,
        recurringCount
    });

    const validOccurrences = [];
    const blockedOccurrences = [];
    let contractedAssignedCount = activeScheduled.filter((session) => session.unitType === 'contracted').length;
    let overflowSequence = activeScheduled
        .filter((session) => session.unitType === 'overflow' && session.status !== 'cancelled')
        .reduce((maxValue, session) => Math.max(maxValue, Number(session.overflowSequence || 0)), 0);

    for (const occurrence of requestedOccurrences) {
        const teacherConflict = activeScheduled.find((session) =>
            cleanOptionalString(session.teacherUid) === cleanOptionalString(teacherUid) && overlapsUtc(session, occurrence)
        ) || validOccurrences.find((session) =>
            cleanOptionalString(session.teacherUid) === cleanOptionalString(teacherUid) && overlapsUtc(session, occurrence)
        );

        if (teacherConflict) {
            blockedOccurrences.push({
                targetLocalDate: occurrence.scheduledLocalDate,
                targetLocalTime: occurrence.scheduledLocalTime,
                reasonCode: 'teacher_conflict',
                reasonMessage: `Teacher conflict with ${teacherConflict.sessionId || 'scheduled session'}.`
            });
            continue;
        }

        const nextOccurrence = {
            classId: cleanOptionalString(classId),
            courseId: cleanOptionalString(courseId),
            teacherUid: cleanOptionalString(teacherUid),
            ...occurrence,
            unitType: contractedAssignedCount < Number(targetSessionCount || 0) ? 'contracted' : 'overflow',
            contractUnitIndex: contractedAssignedCount < Number(targetSessionCount || 0) ? contractedAssignedCount + 1 : null,
            overflowSequence: contractedAssignedCount < Number(targetSessionCount || 0) ? null : overflowSequence + 1,
            seedBatchId: null,
            replacementOfSessionId: null,
            status: 'scheduled',
            attendanceState: 'none',
            lockState: 'unlocked',
            lockReason: null,
            version: 1
        };

        if (nextOccurrence.unitType === 'contracted') {
            contractedAssignedCount += 1;
        } else {
            overflowSequence += 1;
        }
        validOccurrences.push(nextOccurrence);
    }

    const futureSessions = normalizedExisting.concat(validOccurrences);
    const summaryAfterCommit = totalInstructionMinutes && sessionMinutes
        ? buildScheduleSummary({
            totalInstructionMinutes,
            sessionMinutes,
            targetSessionCount,
            sessions: futureSessions
        })
        : null;
    const warnings = [];
    if (blockedOccurrences.length) {
        warnings.push(`${blockedOccurrences.length} occurrence(s) will be skipped because they conflict with existing sessions.`);
    }
    const overflowCount = validOccurrences.filter((session) => session.unitType === 'overflow').length;
    if (overflowCount > 0) {
        warnings.push('This action creates overflow sessions beyond the contracted target.');
    }

    return {
        requestedCount: requestedOccurrences.length,
        validOccurrences,
        blockedOccurrences,
        wouldCreateOverflowCount: overflowCount,
        wouldCreateContractedCount: validOccurrences.filter((session) => session.unitType === 'contracted').length,
        summaryAfterCommit,
        warnings,
        canCommit: validOccurrences.length > 0
    };
}

function buildReplaceSessionPreview({
    classId,
    targetLocalDate,
    targetLocalTime,
    timezone,
    durationMinutes,
    existingSessions = [],
    totalInstructionMinutes = null,
    targetSessionCount = null,
    sessionMinutes = null,
    nowIso = null
}) {
    const normalizedExisting = Array.isArray(existingSessions)
        ? existingSessions.map(normalizeScheduledSession)
        : [];
    const targetWindow = buildCanonicalScheduledWindow({
        targetLocalDate,
        targetLocalTime,
        timezone,
        durationMinutes
    });
    const reasonBuckets = new Map();
    const activeSessions = normalizedExisting.filter((session) => String(session.classId || '') === String(classId || ''));
    const eligibleSessions = [];
    const nowMs = nowIso ? new Date(nowIso).getTime() : Date.now();

    function addReason(code, sessionId) {
        if (!reasonBuckets.has(code)) {
            reasonBuckets.set(code, { sessionIds: [] });
        }
        reasonBuckets.get(code).sessionIds.push(sessionId);
    }

    for (const session of activeSessions) {
        const sessionId = cleanOptionalString(session.sessionId);
        if (String(session.status || '') === 'cancelled') {
            addReason('cancelled', sessionId);
            continue;
        }
        if (String(session.attendanceState || '') === 'finalized') {
            addReason('attendance_finalized', sessionId);
            continue;
        }
        if (String(session.attendanceState || '') === 'in_progress') {
            addReason('attendance_started', sessionId);
            continue;
        }
        if (String(session.lockState || 'unlocked') === 'hard_locked') {
            addReason('locked', sessionId);
            continue;
        }
        if (new Date(session.scheduledStartAtUtc).getTime() < nowMs) {
            addReason('past_session', sessionId);
            continue;
        }
        if (session.scheduledLocalDate === targetWindow.scheduledLocalDate && session.scheduledLocalTime === targetWindow.scheduledLocalTime) {
            addReason('same_slot', sessionId);
            continue;
        }

        const effectiveTeacherUid = cleanOptionalString(session.teacherUid);
        const conflict = effectiveTeacherUid ? normalizedExisting.find((candidate) =>
            candidate.sessionId !== sessionId &&
            String(candidate.status || '') === 'scheduled' &&
            cleanOptionalString(candidate.teacherUid) === effectiveTeacherUid &&
            overlapsUtc(candidate, targetWindow)
        ) : null;
        if (conflict) {
            addReason('conflict_if_replaced', sessionId);
            continue;
        }

        eligibleSessions.push(session);
    }

    const summaryAfterReplacement = totalInstructionMinutes && sessionMinutes
        ? buildScheduleSummary({
            totalInstructionMinutes,
            sessionMinutes,
            targetSessionCount,
            sessions: normalizedExisting
        })
        : null;

    return {
        eligibleSessions,
        ineligibleReasons: buildReasonSummary(reasonBuckets),
        summaryAfterReplacement,
        canCommit: eligibleSessions.length > 0
    };
}

function buildReplacementPlan({ replacementSession, replacedSession }) {
    const base = replacementSession && typeof replacementSession === 'object' ? replacementSession : {};
    const replaced = replacedSession && typeof replacedSession === 'object' ? replacedSession : {};
    return {
        nextSession: {
            ...base,
            unitType: replaced.unitType || 'contracted',
            contractUnitIndex: replaced.contractUnitIndex ?? null,
            overflowSequence: replaced.overflowSequence ?? null,
            replacementOfSessionId: cleanOptionalString(replaced.sessionId),
            status: 'scheduled',
            attendanceState: 'none',
            lockState: 'unlocked',
            lockReason: null,
            version: 1
        },
        cancelPatch: {
            status: 'cancelled',
            replacementSessionId: cleanOptionalString(replaced.sessionId) || null
        }
    };
}

function syncSessionLockStateFromAttendance(currentSession, nextAttendanceState) {
    const session = currentSession && typeof currentSession === 'object' ? currentSession : {};
    const attendanceState = cleanOptionalString(nextAttendanceState, 'none') || 'none';
    if (attendanceState === 'in_progress') {
        return {
            attendanceState,
            lockState: 'hard_locked',
            lockReason: 'attendance_in_progress'
        };
    }
    if (attendanceState === 'finalized') {
        return {
            attendanceState,
            lockState: 'hard_locked',
            lockReason: 'attendance_finalized'
        };
    }
    return {
        attendanceState,
        lockState: session.lockState || 'unlocked',
        lockReason: session.lockReason || null
    };
}

module.exports = {
    addMinutesToLocalDateTime,
    buildAddSessionPreview,
    buildCanonicalScheduledWindow,
    buildRegenerationCommitPlan,
    buildRegenerationPreview,
    buildScheduledSessionCompatibilityProjection,
    buildScheduledSessionWriteData,
    buildReplacementPlan,
    buildReplaceSessionPreview,
    buildScheduleSummary,
    buildSeedSessions,
    computeContractedTargetCount,
    formatLocalDateTime,
    localDateTimeToUtcIso,
    normalizeScheduledSession,
    parseLocalDateTime,
    syncSessionLockStateFromAttendance,
    utcIsoToLocalFields,
    validateRemainingDurationChange
};
