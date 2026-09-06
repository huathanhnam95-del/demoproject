const express = require('express');
const {
    CRM_CLASSROOMS,
    CRM_SCHEDULED_SESSIONS
} = require('../../crm/collections');
const {
    mapClassroomRecord,
    normalizeScheduleConfig
} = require('../../crm/course-service');
const {
    buildAddSessionPreview,
    buildScheduleSummary,
    buildScheduledSessionWriteData,
    deriveContractCountState,
    normalizeScheduledSession
} = require('../../crm/scheduling-service');

function defaultSendSuccess(res, data = {}, message = 'OK') {
    return res.json({
        success: true,
        message,
        ...data
    });
}

function defaultSendError(res, status = 500, error = 'INTERNAL_ERROR', message = 'Request failed.', details = null) {
    return res.status(status).json({
        success: false,
        error,
        message,
        ...(details ? { details } : {})
    });
}

function cleanOptionalString(value, fallback = null) {
    const normalized = String(value || '').trim();
    return normalized || fallback;
}

function toPositiveInteger(value, fallback = null) {
    const numeric = Number(value);
    if (Number.isInteger(numeric) && numeric > 0) {
        return numeric;
    }
    return fallback;
}

function normalizeSessionOutcome(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized || normalized === 'none' || normalized === 'reset') return 'none';
    if (normalized === 'completed') return 'completed';
    if (normalized === 'absent_counted' || normalized === 'absent-counted') return 'absent_counted';
    if (normalized === 'absent_makeup' || normalized === 'absent-makeup') return 'absent_makeup';
    throw new Error('Invalid session outcome.');
}

function pad(value) {
    return String(value).padStart(2, '0');
}

function splitDateTime(value) {
    const [datePart, timePart = '00:00:00'] = String(value || '').split('T');
    return {
        targetLocalDate: cleanOptionalString(datePart),
        targetLocalTime: cleanOptionalString(timePart.slice(0, 5))
    };
}

function formatDateInput(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function addDays(dateInput, days) {
    const date = new Date(`${String(dateInput || '')}T00:00:00`);
    date.setDate(date.getDate() + Number(days || 0));
    return formatDateInput(date);
}

function weekdayNumber(dateInput) {
    return new Date(`${String(dateInput || '')}T00:00:00`).getDay();
}

function parseWeekdayValue(value) {
    const normalized = String(value || '').trim().toLowerCase();
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
    if (Object.prototype.hasOwnProperty.call(map, normalized)) {
        return map[normalized];
    }
    const numeric = Number(value);
    return Number.isInteger(numeric) && numeric >= 0 && numeric <= 6 ? numeric : null;
}

function normalizeWeekdays(values) {
    return Array.from(new Set((Array.isArray(values) ? values : [])
        .map(parseWeekdayValue)
        .filter((value) => Number.isInteger(value)))).sort((left, right) => left - right);
}

function isLockedSession(session) {
    return String(session?.lockState || 'unlocked') === 'hard_locked'
        || String(session?.attendanceState || 'none') === 'in_progress'
        || String(session?.attendanceState || 'none') === 'finalized'
        || String(session?.status || 'scheduled') === 'cancelled';
}

function readExpectedScheduleVersion(payload) {
    const numeric = Number(payload);
    return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

function extractLocalIntent(payload, fallbackTimezone, fallbackDurationMinutes) {
    const body = payload && typeof payload === 'object' ? payload : {};
    let targetLocalDate = cleanOptionalString(body.targetLocalDate);
    let targetLocalTime = cleanOptionalString(body.targetLocalTime);
    if ((!targetLocalDate || !targetLocalTime) && cleanOptionalString(body.scheduledStartAt)) {
        const legacy = splitDateTime(body.scheduledStartAt);
        targetLocalDate = targetLocalDate || legacy.targetLocalDate;
        targetLocalTime = targetLocalTime || legacy.targetLocalTime;
    }
    if (!targetLocalDate || !targetLocalTime) {
        throw new Error('targetLocalDate and targetLocalTime are required.');
    }

    return {
        targetLocalDate,
        targetLocalTime,
        timezone: cleanOptionalString(body.timezone, fallbackTimezone || 'UTC'),
        durationMinutes: toPositiveInteger(body.durationMinutes, fallbackDurationMinutes || null)
    };
}

function sessionsOverlapUtc(left, right) {
    const leftStartMs = new Date(left?.scheduledStartAtUtc).getTime();
    const leftEndMs = new Date(left?.scheduledEndAtUtc).getTime();
    const rightStartMs = new Date(right?.scheduledStartAtUtc).getTime();
    const rightEndMs = new Date(right?.scheduledEndAtUtc).getTime();
    if (!Number.isFinite(leftStartMs) || !Number.isFinite(leftEndMs) || !Number.isFinite(rightStartMs) || !Number.isFinite(rightEndMs)) {
        return false;
    }
    return rightStartMs < leftEndMs && rightEndMs > leftStartMs;
}

function findTeacherConflict(teacherSessions, proposedSession, ignoredSessionIds = []) {
    const normalizedProposal = normalizeScheduledSession(proposedSession);
    const ignored = new Set((Array.isArray(ignoredSessionIds) ? ignoredSessionIds : []).map((value) => String(value || '').trim()));
    return (Array.isArray(teacherSessions) ? teacherSessions : []).find((session) => {
        if (ignored.has(String(session?.sessionId || '').trim())) return false;
        return sessionsOverlapUtc(session, normalizedProposal);
    }) || null;
}

function filterSessionsByRange(sessions, from, to) {
    const fromDate = cleanOptionalString(from);
    const toDate = cleanOptionalString(to);
    return (Array.isArray(sessions) ? sessions : [])
        .filter((session) => String(session.status || 'scheduled') === 'scheduled')
        .filter((session) => !fromDate || String(session.scheduledLocalDate || '') >= fromDate)
        .filter((session) => !toDate || String(session.scheduledLocalDate || '') <= toDate)
        .sort((left, right) => String(left.scheduledStartAtUtc || '').localeCompare(String(right.scheduledStartAtUtc || '')));
}

function nextScheduleVersion(scheduleConfig) {
    return Math.max(Number(scheduleConfig?.scheduleVersion || 0) + 1, 1);
}

async function listClassSessions(db, classId) {
    const snap = await db.collection(CRM_SCHEDULED_SESSIONS).where('classId', '==', classId).get();
    return snap.docs.map((doc) => normalizeScheduledSession({ sessionId: doc.id, ...doc.data() }));
}

async function listTeacherScheduledSessions(db, teacherUid, options = {}) {
    const cleanedTeacherUid = cleanOptionalString(teacherUid);
    if (!cleanedTeacherUid || cleanedTeacherUid === 'all') return [];

    const from = cleanOptionalString(options.from);
    const to = cleanOptionalString(options.to);

    if (from && to) {
        try {
            const boundedSnap = await db.collection(CRM_SCHEDULED_SESSIONS)
                .where('teacherUid', '==', cleanedTeacherUid)
                .where('status', '==', 'scheduled')
                .where('scheduledLocalDate', '>=', from)
                .where('scheduledLocalDate', '<=', to)
                .get();
            return boundedSnap.docs.map((doc) => normalizeScheduledSession({ sessionId: doc.id, ...doc.data() }));
        } catch (error) {
            void error;
        }
    }

    const snap = await db.collection(CRM_SCHEDULED_SESSIONS)
        .where('teacherUid', '==', cleanedTeacherUid)
        .where('status', '==', 'scheduled')
        .get();
    const sessions = snap.docs.map((doc) => normalizeScheduledSession({ sessionId: doc.id, ...doc.data() }));
    return filterSessionsByRange(sessions, from, to);
}

async function listAllScheduledSessions(db, options = {}) {
    const from = cleanOptionalString(options.from);
    const to = cleanOptionalString(options.to);

    if (from && to) {
        try {
            const boundedSnap = await db.collection(CRM_SCHEDULED_SESSIONS)
                .where('status', '==', 'scheduled')
                .where('scheduledLocalDate', '>=', from)
                .where('scheduledLocalDate', '<=', to)
                .get();
            return boundedSnap.docs.map((doc) => normalizeScheduledSession({ sessionId: doc.id, ...doc.data() }));
        } catch (error) {
            void error;
        }
    }

    const snap = await db.collection(CRM_SCHEDULED_SESSIONS)
        .where('status', '==', 'scheduled')
        .get();
    const sessions = snap.docs.map((doc) => normalizeScheduledSession({ sessionId: doc.id, ...doc.data() }));
    return filterSessionsByRange(sessions, from, to);
}

async function syncClassroomScheduleState(db, classId, options = {}) {
    const classroomRef = db.collection(CRM_CLASSROOMS).doc(classId);
    const classroomSnap = options.classroomSnap || await classroomRef.get();
    if (!classroomSnap.exists) return null;

    const classroom = classroomSnap.data() || {};
    const baseScheduleConfig = classroom.scheduleConfig || null;
    const scheduleConfig = options.scheduleConfigPatch
        ? normalizeScheduleConfig(options.scheduleConfigPatch, {
            existing: baseScheduleConfig,
            preserveExistingTargetSessionCount: options.preserveExistingTargetSessionCount !== false
        })
        : baseScheduleConfig;
    if (!scheduleConfig?.totalInstructionMinutes || !scheduleConfig?.sessionMinutes) {
        return null;
    }

    const sessions = options.sessions || await listClassSessions(db, classId);
    const effectiveScheduleConfig = options.bumpVersion
        ? { ...scheduleConfig, scheduleVersion: nextScheduleVersion(scheduleConfig) }
        : scheduleConfig;
    const scheduleSummary = buildScheduleSummary({
        totalInstructionMinutes: effectiveScheduleConfig.totalInstructionMinutes,
        sessionMinutes: effectiveScheduleConfig.sessionMinutes,
        targetSessionCount: effectiveScheduleConfig.targetSessionCount,
        sessions
    });

    await classroomRef.set({
        ...(options.rootPatch || {}),
        scheduleConfig: effectiveScheduleConfig,
        scheduleSummary
    }, { merge: true });

    return {
        scheduleConfig: effectiveScheduleConfig,
        scheduleSummary
    };
}

async function listTeacherClassrooms(db, teacherUid) {
    const cleanedTeacherUid = cleanOptionalString(teacherUid);
    if (!cleanedTeacherUid) return [];

    let query = db.collection(CRM_CLASSROOMS).where('primaryTeacherUid', '==', cleanedTeacherUid);
    if (typeof query.limit === 'function') {
        query = query.limit(200);
    }
    const snap = await query.get();
    const results = snap.docs.map((doc) => ({
        id: doc.id,
        data: doc.data() || {}
    }));
    return results.sort((a, b) => {
        const timeA = a.data.createdAt?.toMillis ? a.data.createdAt.toMillis() : 0;
        const timeB = b.data.createdAt?.toMillis ? b.data.createdAt.toMillis() : 0;
        return timeB - timeA;
    });
}

async function listAllClassrooms(db) {
    let query = db.collection(CRM_CLASSROOMS);
    if (typeof query.limit === 'function') {
        query = query.limit(200);
    }
    const snap = await query.get();
    const results = snap.docs.map((doc) => ({
        id: doc.id,
        data: doc.data() || {}
    }));
    return results.sort((a, b) => {
        const timeA = a.data.createdAt?.toMillis ? a.data.createdAt.toMillis() : 0;
        const timeB = b.data.createdAt?.toMillis ? b.data.createdAt.toMillis() : 0;
        return timeB - timeA;
    });
}

async function loadTeacherClassroom(db, classId, teacherUid, options = {}) {
    const classroomSnap = await db.collection(CRM_CLASSROOMS).doc(classId).get();
    if (!classroomSnap.exists) {
        return { status: 'missing', classId };
    }
    const classroom = classroomSnap.data() || {};
    if (!options.isAdmin && cleanOptionalString(classroom.primaryTeacherUid) !== cleanOptionalString(teacherUid)) {
        return { status: 'forbidden', classId };
    }
    return {
        status: 'ok',
        classId,
        snap: classroomSnap,
        classroom
    };
}

function startOfCurrentWeek() {
    const now = new Date();
    const next = new Date(now);
    const weekday = next.getDay() || 7;
    next.setDate(next.getDate() - weekday + 1);
    next.setHours(0, 0, 0, 0);
    return formatDateInput(next);
}

function endOfCurrentWeek(fromDate) {
    return addDays(fromDate, 6);
}

module.exports = function createTeacherSchedulerRouter(rawDeps = {}) {
    const deps = rawDeps || {};
    if (!deps.db) {
        throw new Error('Missing dependency: db');
    }
    if (!deps.authMiddleware) {
        throw new Error('Missing dependency: authMiddleware');
    }

    const db = deps.db;
    const sendSuccess = deps.sendSuccess || defaultSendSuccess;
    const sendError = deps.sendError || defaultSendError;
    const serverTimestamp = typeof deps.serverTimestamp === 'function'
        ? deps.serverTimestamp
        : () => new Date();
    const writeAuditLog = typeof deps.writeAuditLog === 'function' ? deps.writeAuditLog : null;

    const router = express.Router();

    const teacherAccessCache = new Map();
    const TEACHER_ACCESS_CACHE_TTL_MS = 5 * 60 * 1000;

    function getCachedTeacherAccess(uid) {
        const key = cleanOptionalString(uid);
        if (!key) return null;
        const entry = teacherAccessCache.get(key);
        if (!entry) return null;
        if ((Date.now() - entry.atMs) > TEACHER_ACCESS_CACHE_TTL_MS) {
            teacherAccessCache.delete(key);
            return null;
        }
        return entry.value || null;
    }

    function setCachedTeacherAccess(uid, value) {
        const key = cleanOptionalString(uid);
        if (!key) return;
        teacherAccessCache.set(key, { atMs: Date.now(), value });
    }

    async function resolveTeacherAccess(user) {
        const uid = cleanOptionalString(user?.uid);
        if (!uid) return { uid: null, isTeacher: false, isAdmin: false, ok: false };

        const claimTeacher = user?.isTeacher === true || user?.teacher === true || String(user?.role || '').trim().toLowerCase() === 'teacher' || String(user?.crmRole || '').trim().toLowerCase() === 'teacher';
        const adminEmail = cleanOptionalString(deps.adminEmail || process.env.ADMIN_EMAIL);
        const tokenEmail = cleanOptionalString(user?.email);
        const emailAdmin = !!(adminEmail && tokenEmail && tokenEmail.toLowerCase() === adminEmail.toLowerCase());
        const claimAdmin = user?.isAdmin === true || user?.admin === true || String(user?.role || '').trim().toLowerCase() === 'admin' || String(user?.crmRole || '').trim().toLowerCase() === 'admin' || emailAdmin;
        if (claimTeacher || claimAdmin) {
            return { uid, isTeacher: claimTeacher || claimAdmin, isAdmin: claimAdmin, ok: true };
        }

        const cached = getCachedTeacherAccess(uid);
        if (cached) return cached;

        let profileTeacher = false;
        let profileAdmin = false;
        try {
            const snap = await db.collection('users').doc(uid).get();
            const data = snap.exists ? (snap.data() || {}) : {};
            const crmRole = String(data.crmRole || '').trim().toLowerCase();
            const role = String(data.role || '').trim().toLowerCase();
            profileAdmin = data.isAdmin === true || crmRole === 'admin' || role === 'admin';
            profileTeacher = data.isTeacher === true || crmRole === 'teacher' || role === 'teacher';
        } catch (error) {
            void error;
        }

        if (!profileTeacher && !profileAdmin) {
            try {
                const classSnap = await db.collection(CRM_CLASSROOMS).where('primaryTeacherUid', '==', uid).limit(1).get();
                if (!classSnap.empty) {
                    profileTeacher = true;
                }
            } catch (error) {
                void error;
            }
        }

        const resolved = {
            uid,
            isTeacher: profileTeacher || profileAdmin,
            isAdmin: profileAdmin,
            ok: profileTeacher || profileAdmin
        };
        setCachedTeacherAccess(uid, resolved);
        return resolved;
    }

    async function requireTeacherAccess(req, res, next) {
        try {
            const access = await resolveTeacherAccess(req.user);
            if (!access.ok) {
                return sendError(res, 403, 'FORBIDDEN', 'Teacher privileges required.');
            }
            req.teacherAccess = access;
            return next();
        } catch (error) {
            return sendError(res, 500, 'AUTHZ_ERROR', 'Failed to verify teacher access.', error?.message || error);
        }
    }

    const requireTeacherHandlers = [deps.authMiddleware, requireTeacherAccess].filter(Boolean);

    router.get('/status', ...requireTeacherHandlers, (req, res) => {
        return sendSuccess(res, {
            isTeacher: req.teacherAccess?.isTeacher === true,
            isAdmin: req.teacherAccess?.isAdmin === true,
            uid: req.user?.uid || null
        }, 'Teacher access verified.');
    });

    router.get('/scheduler/workspace', ...requireTeacherHandlers, async (req, res) => {
        try {
            const callerUid = cleanOptionalString(req.user?.uid);
            if (!callerUid) {
                return sendError(res, 401, 'UNAUTHORIZED', 'Missing authenticated user.');
            }

            const defaultFrom = startOfCurrentWeek();
            const from = cleanOptionalString(req.query?.from, defaultFrom);
            const to = cleanOptionalString(req.query?.to, endOfCurrentWeek(from));

            const isAdmin = req.teacherAccess?.isAdmin === true;
            const requestedTeacher = cleanOptionalString(req.query?.teacherUid || req.query?.teacherId);
            const targetTeacherUid = isAdmin && requestedTeacher ? requestedTeacher : callerUid;

            let classrooms;
            let sessions;
            if (isAdmin && targetTeacherUid === 'all') {
                [classrooms, sessions] = await Promise.all([
                    listAllClassrooms(db),
                    listAllScheduledSessions(db, { from, to })
                ]);
            } else {
                [classrooms, sessions] = await Promise.all([
                    listTeacherClassrooms(db, targetTeacherUid),
                    listTeacherScheduledSessions(db, targetTeacherUid, { from, to })
                ]);
            }

            const classIdSet = new Set(classrooms.map((entry) => entry.id));
            const filteredSessions = sessions
                .filter((session) => classIdSet.has(String(session.classId || '').trim()))
                .filter((session) => !from || String(session.scheduledLocalDate || '') >= from)
                .filter((session) => !to || String(session.scheduledLocalDate || '') <= to)
                .sort((left, right) => String(left.scheduledStartAtUtc || '').localeCompare(String(right.scheduledStartAtUtc || '')));

            return sendSuccess(res, {
                classrooms: classrooms.map((entry) => mapClassroomRecord({
                    id: entry.id,
                    data: () => entry.data
                }, entry.id)),
                sessions: filteredSessions,
                teacherUid: targetTeacherUid,
                from,
                to
            }, 'Teacher scheduler workspace loaded.');
        } catch (error) {
            return sendError(res, 500, 'TEACHER_WORKSPACE_ERROR', 'Failed to load teacher scheduler workspace.', error?.message || error);
        }
    });

    router.post('/classrooms/:classId/sessions/add', ...requireTeacherHandlers, async (req, res) => {
        try {
            const callerUid = cleanOptionalString(req.user?.uid);
            const classId = cleanOptionalString(req.params?.classId);
            if (!callerUid || !classId) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Missing teacher or class identifier.');
            }

            const isAdmin = req.teacherAccess?.isAdmin === true;
            const access = await loadTeacherClassroom(db, classId, callerUid, { isAdmin });
            if (access.status === 'missing') {
                return sendError(res, 404, 'CLASSROOM_NOT_FOUND', 'Classroom not found.');
            }
            if (access.status === 'forbidden') {
                return sendError(res, 403, 'FORBIDDEN', 'You can only schedule your own classrooms.');
            }

            const classroom = access.classroom;
            const effectiveTeacherUid = (isAdmin && cleanOptionalString(req.body?.teacherUid) && cleanOptionalString(req.body?.teacherUid) !== 'all')
                ? cleanOptionalString(req.body.teacherUid)
                : (cleanOptionalString(classroom.primaryTeacherUid) || callerUid);
            const scheduleConfig = classroom.scheduleConfig || {};
            const classSessions = await listClassSessions(db, classId);
            const intent = extractLocalIntent(req.body || {}, scheduleConfig.timezone || null, scheduleConfig.sessionMinutes || null);
            const preview = buildAddSessionPreview({
                classId,
                courseId: classroom.courseId || null,
                teacherUid: effectiveTeacherUid,
                totalInstructionMinutes: Number(scheduleConfig.totalInstructionMinutes || 0) || null,
                targetSessionCount: Number(scheduleConfig.targetSessionCount || 0) || null,
                sessionMinutes: Number(scheduleConfig.sessionMinutes || 0) || intent.durationMinutes || null,
                timezone: intent.timezone,
                targetLocalDate: intent.targetLocalDate,
                targetLocalTime: intent.targetLocalTime,
                durationMinutes: intent.durationMinutes,
                addMode: 'once',
                recurringCount: 1,
                existingSessions: classSessions
            });

            if (!preview.canCommit || !preview.validOccurrences.length) {
                return sendError(res, 409, 'NO_VALID_OCCURRENCES', 'No valid session could be created for this slot.', {
                    blockedOccurrences: preview.blockedOccurrences || [],
                    warnings: preview.warnings || []
                });
            }

            const occurrence = preview.validOccurrences[0];
            const teacherSessions = await listTeacherScheduledSessions(db, effectiveTeacherUid);
            const teacherConflict = findTeacherConflict(teacherSessions, occurrence);
            if (teacherConflict) {
                return sendError(res, 409, 'TEACHER_CONFLICT', 'Teacher conflict with an existing session.', {
                    conflictSession: teacherConflict
                });
            }

            const ref = db.collection(CRM_SCHEDULED_SESSIONS).doc();
            const payload = {
                ...occurrence,
                teacherUid: effectiveTeacherUid,
                createdAt: serverTimestamp(),
                createdBy: callerUid,
                updatedAt: serverTimestamp(),
                updatedBy: callerUid
            };
            await ref.set(payload);
            const scheduleState = await syncClassroomScheduleState(db, classId, { bumpVersion: true });

            await writeAuditLog?.({
                action: 'teacher.session.add',
                entityType: 'classroom',
                entityId: classId,
                metadata: { sessionId: ref.id, teacherUid: effectiveTeacherUid }
            }, { user: req.user });

            return sendSuccess(res, {
                sessionId: ref.id,
                session: normalizeScheduledSession({ sessionId: ref.id, ...payload }),
                scheduleSummary: scheduleState?.scheduleSummary || null,
                scheduleVersion: scheduleState?.scheduleConfig?.scheduleVersion || null
            }, 'Session added.');
        } catch (error) {
            return sendError(res, 500, 'TEACHER_ADD_SESSION_ERROR', 'Failed to add session.', error?.message || error);
        }
    });

    router.post('/classrooms/:classId/sessions/add-multi', ...requireTeacherHandlers, async (req, res) => {
        try {
            const callerUid = cleanOptionalString(req.user?.uid);
            const classId = cleanOptionalString(req.params?.classId);
            if (!callerUid || !classId) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Missing teacher or class identifier.');
            }

            const isAdmin = req.teacherAccess?.isAdmin === true;
            const access = await loadTeacherClassroom(db, classId, callerUid, { isAdmin });
            if (access.status === 'missing') {
                return sendError(res, 404, 'CLASSROOM_NOT_FOUND', 'Classroom not found.');
            }
            if (access.status === 'forbidden') {
                return sendError(res, 403, 'FORBIDDEN', 'You can only schedule your own classrooms.');
            }

            const classroom = access.classroom;
            const effectiveTeacherUid = (isAdmin && cleanOptionalString(req.body?.teacherUid) && cleanOptionalString(req.body?.teacherUid) !== 'all')
                ? cleanOptionalString(req.body.teacherUid)
                : (cleanOptionalString(classroom.primaryTeacherUid) || callerUid);
            const scheduleConfig = classroom.scheduleConfig || {};
            const weekdays = normalizeWeekdays(req.body?.weekdays);
            if (!weekdays.length) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Select at least one weekday.');
            }

            const from = cleanOptionalString(req.body?.from, startOfCurrentWeek());
            const to = cleanOptionalString(req.body?.to, endOfCurrentWeek(from));
            const startTime = cleanOptionalString(req.body?.startTime) || cleanOptionalString(scheduleConfig.seedStartTime);
            if (!startTime) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'startTime is required.');
            }
            if (!from || !to || from > to) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid scheduling range.');
            }

            const classSessions = await listClassSessions(db, classId);
            const teacherSessions = await listTeacherScheduledSessions(db, effectiveTeacherUid);
            const workingClassSessions = [...classSessions];
            const workingTeacherSessions = [...teacherSessions];
            const preparedSessions = [];
            const skippedOccurrences = [];
            const durationMinutes = toPositiveInteger(req.body?.durationMinutes, Number(scheduleConfig.sessionMinutes || 0) || null);
            const sessionMinutes = toPositiveInteger(scheduleConfig.sessionMinutes, durationMinutes || null) || durationMinutes;
            const timezone = cleanOptionalString(req.body?.timezone, scheduleConfig.timezone || 'UTC');
            const targetSessionCount = Number(scheduleConfig.targetSessionCount || 0) || null;
            const totalInstructionMinutes = Number(scheduleConfig.totalInstructionMinutes || 0) || null;

            let cursor = from;
            while (cursor <= to) {
                if (weekdays.includes(weekdayNumber(cursor))) {
                    const preview = buildAddSessionPreview({
                        classId,
                        courseId: classroom.courseId || null,
                        teacherUid: effectiveTeacherUid,
                        totalInstructionMinutes,
                        targetSessionCount,
                        sessionMinutes,
                        timezone,
                        targetLocalDate: cursor,
                        targetLocalTime: startTime,
                        durationMinutes: sessionMinutes,
                        addMode: 'once',
                        recurringCount: 1,
                        existingSessions: workingClassSessions
                    });

                    if (!preview.canCommit || !preview.validOccurrences.length) {
                        const blocked = Array.isArray(preview.blockedOccurrences) && preview.blockedOccurrences.length
                            ? preview.blockedOccurrences[0]
                            : { reasonCode: 'blocked', reasonMessage: 'Slot is not available.' };
                        skippedOccurrences.push({
                            targetLocalDate: cursor,
                            targetLocalTime: startTime,
                            reasonCode: blocked.reasonCode || 'blocked',
                            reasonMessage: blocked.reasonMessage || 'Slot is not available.'
                        });
                    } else {
                        const occurrence = preview.validOccurrences[0];
                        const conflict = findTeacherConflict(workingTeacherSessions, occurrence);
                        if (conflict) {
                            skippedOccurrences.push({
                                targetLocalDate: occurrence.scheduledLocalDate,
                                targetLocalTime: occurrence.scheduledLocalTime,
                                reasonCode: 'teacher_conflict',
                                reasonMessage: `Teacher conflict with session ${conflict.sessionId || ''}.`.trim()
                            });
                        } else {
                            preparedSessions.push(occurrence);
                            workingClassSessions.push(occurrence);
                            workingTeacherSessions.push(occurrence);
                        }
                    }
                }
                cursor = addDays(cursor, 1);
            }

            if (!preparedSessions.length) {
                return sendError(res, 409, 'NO_VALID_OCCURRENCES', 'No valid sessions could be created for the selected week.', {
                    skippedOccurrences
                });
            }

            const createdSessions = [];
            if (typeof db.batch === 'function') {
                const batch = db.batch();
                preparedSessions.forEach((session) => {
                    const ref = db.collection(CRM_SCHEDULED_SESSIONS).doc();
                    const payload = {
                        ...session,
                        teacherUid: effectiveTeacherUid,
                        createdAt: serverTimestamp(),
                        createdBy: callerUid,
                        updatedAt: serverTimestamp(),
                        updatedBy: callerUid
                    };
                    createdSessions.push({ sessionId: ref.id, ...normalizeScheduledSession(payload) });
                    batch.set(ref, payload);
                });
                await batch.commit();
            } else {
                for (const session of preparedSessions) {
                    const ref = db.collection(CRM_SCHEDULED_SESSIONS).doc();
                    const payload = {
                        ...session,
                        teacherUid: effectiveTeacherUid,
                        createdAt: serverTimestamp(),
                        createdBy: callerUid,
                        updatedAt: serverTimestamp(),
                        updatedBy: callerUid
                    };
                    await ref.set(payload);
                    createdSessions.push({ sessionId: ref.id, ...normalizeScheduledSession(payload) });
                }
            }

            const scheduleState = await syncClassroomScheduleState(db, classId, {
                bumpVersion: true,
                scheduleConfigPatch: {
                    ...scheduleConfig,
                    seedWeekdays: weekdays,
                    seedStartTime: startTime
                }
            });
            await writeAuditLog?.({
                action: 'teacher.session.add_multi',
                entityType: 'classroom',
                entityId: classId,
                metadata: { createdCount: createdSessions.length, skippedCount: skippedOccurrences.length, teacherUid: effectiveTeacherUid }
            }, { user: req.user });

            return sendSuccess(res, {
                createdSessions,
                skippedOccurrences,
                scheduleSummary: scheduleState?.scheduleSummary || null,
                scheduleVersion: scheduleState?.scheduleConfig?.scheduleVersion || null
            }, 'Sessions placed for this week.');
        } catch (error) {
            return sendError(res, 500, 'TEACHER_ADD_MULTI_ERROR', 'Failed to place weekly sessions.', error?.message || error);
        }
    });

    router.patch('/sessions/:sessionId/reschedule', ...requireTeacherHandlers, async (req, res) => {
        try {
            const callerUid = cleanOptionalString(req.user?.uid);
            const sessionId = cleanOptionalString(req.params?.sessionId);
            if (!callerUid || !sessionId) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Missing teacher or session identifier.');
            }

            const sessionRef = db.collection(CRM_SCHEDULED_SESSIONS).doc(sessionId);
            const sessionSnap = await sessionRef.get();
            if (!sessionSnap.exists) {
                return sendError(res, 404, 'SESSION_NOT_FOUND', 'Session not found.');
            }
            const existing = normalizeScheduledSession({ sessionId, ...(sessionSnap.data() || {}) });
            const isAdmin = req.teacherAccess?.isAdmin === true;
            if (!cleanOptionalString(existing.classId)) {
                return sendError(res, 400, 'INVALID_SESSION', 'Session is missing class ownership metadata.');
            }

            const access = await loadTeacherClassroom(db, cleanOptionalString(existing.classId), callerUid, { isAdmin });
            if (access.status !== 'ok') {
                return sendError(res, 403, 'FORBIDDEN', 'You can only edit sessions for your own classrooms.');
            }

            const sessionTeacher = cleanOptionalString(existing.teacherUid);
            const classroomPrimaryTeacher = cleanOptionalString(access.classroom?.primaryTeacherUid);
            const isAuthorizedTeacher = sessionTeacher === callerUid || (sessionTeacher === 'all' && classroomPrimaryTeacher === callerUid);
            if (!isAdmin && !isAuthorizedTeacher) {
                return sendError(res, 403, 'FORBIDDEN', 'You can only edit your own sessions.');
            }
            if (isLockedSession(existing)) {
                return sendError(res, 409, 'SESSION_LOCKED', 'Locked sessions cannot be rescheduled.');
            }

            const intent = extractLocalIntent(req.body || {}, existing.timezone || null, existing.durationMinutes || null);
            const nextWindow = buildScheduledSessionWriteData({}, {
                targetLocalDate: intent.targetLocalDate,
                targetLocalTime: intent.targetLocalTime,
                timezone: intent.timezone,
                durationMinutes: intent.durationMinutes || existing.durationMinutes || null
            });

            const requestedTeacher = (isAdmin && cleanOptionalString(req.body?.teacherUid) && cleanOptionalString(req.body?.teacherUid) !== 'all')
                ? cleanOptionalString(req.body.teacherUid)
                : null;
            const rawExistingTeacher = cleanOptionalString(existing.teacherUid);
            const effectiveTeacherUid = requestedTeacher
                || ((rawExistingTeacher && rawExistingTeacher !== 'all') ? rawExistingTeacher : null)
                || (classroomPrimaryTeacher || callerUid);

            const next = {
                ...existing,
                ...nextWindow,
                teacherUid: effectiveTeacherUid,
                durationMinutes: intent.durationMinutes || existing.durationMinutes || null,
                timezone: intent.timezone || existing.timezone || null,
                version: Number(existing.version || 1) + 1,
                updatedAt: serverTimestamp(),
                updatedBy: callerUid
            };

            const teacherSessions = await listTeacherScheduledSessions(db, effectiveTeacherUid);
            const teacherConflict = findTeacherConflict(teacherSessions, next, [sessionId]);
            if (teacherConflict) {
                return sendError(res, 409, 'TEACHER_CONFLICT', 'Teacher conflict with an existing session.', {
                    conflictSession: teacherConflict
                });
            }

            await sessionRef.set(next, { merge: true });
            const scheduleState = await syncClassroomScheduleState(db, cleanOptionalString(existing.classId), { bumpVersion: true });
            await writeAuditLog?.({
                action: 'teacher.session.reschedule',
                entityType: 'scheduled_session',
                entityId: sessionId,
                metadata: { classId: existing.classId || null, teacherUid: effectiveTeacherUid }
            }, { user: req.user });

            return sendSuccess(res, {
                sessionId,
                scheduleSummary: scheduleState?.scheduleSummary || null,
                scheduleVersion: scheduleState?.scheduleConfig?.scheduleVersion || null
            }, 'Session rescheduled.');
        } catch (error) {
            return sendError(res, 500, 'TEACHER_RESCHEDULE_ERROR', 'Failed to reschedule session.', error?.message || error);
        }
    });

    router.post('/sessions/:sessionId/cancel', ...requireTeacherHandlers, async (req, res) => {
        try {
            const callerUid = cleanOptionalString(req.user?.uid);
            const sessionId = cleanOptionalString(req.params?.sessionId);
            if (!callerUid || !sessionId) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Missing teacher or session identifier.');
            }

            const sessionRef = db.collection(CRM_SCHEDULED_SESSIONS).doc(sessionId);
            const sessionSnap = await sessionRef.get();
            if (!sessionSnap.exists) {
                return sendError(res, 404, 'SESSION_NOT_FOUND', 'Session not found.');
            }
            const existing = normalizeScheduledSession({ sessionId, ...(sessionSnap.data() || {}) });
            const isAdmin = req.teacherAccess?.isAdmin === true;
            if (!cleanOptionalString(existing.classId)) {
                return sendError(res, 400, 'INVALID_SESSION', 'Session is missing class ownership metadata.');
            }

            const access = await loadTeacherClassroom(db, cleanOptionalString(existing.classId), callerUid, { isAdmin });
            if (access.status !== 'ok') {
                return sendError(res, 403, 'FORBIDDEN', 'You can only cancel sessions for your own classrooms.');
            }

            const sessionTeacher = cleanOptionalString(existing.teacherUid);
            const classroomPrimaryTeacher = cleanOptionalString(access.classroom?.primaryTeacherUid);
            const isAuthorizedTeacher = sessionTeacher === callerUid || (sessionTeacher === 'all' && classroomPrimaryTeacher === callerUid);
            if (!isAdmin && !isAuthorizedTeacher) {
                return sendError(res, 403, 'FORBIDDEN', 'You can only cancel your own sessions.');
            }
            if (isLockedSession(existing)) {
                return sendError(res, 409, 'SESSION_LOCKED', 'Locked sessions cannot be cancelled.');
            }

            await sessionRef.set({
                status: 'cancelled',
                contractCountState: 'does_not_count',
                version: Number(existing.version || 1) + 1,
                updatedAt: serverTimestamp(),
                updatedBy: callerUid
            }, { merge: true });
            const scheduleState = await syncClassroomScheduleState(db, cleanOptionalString(existing.classId), { bumpVersion: true });

            await writeAuditLog?.({
                action: 'teacher.session.cancel',
                entityType: 'scheduled_session',
                entityId: sessionId,
                metadata: { classId: existing.classId || null }
            }, { user: req.user });

            return sendSuccess(res, {
                sessionId,
                scheduleSummary: scheduleState?.scheduleSummary || null,
                scheduleVersion: scheduleState?.scheduleConfig?.scheduleVersion || null
            }, 'Session cancelled.');
        } catch (error) {
            return sendError(res, 500, 'TEACHER_CANCEL_ERROR', 'Failed to cancel session.', error?.message || error);
        }
    });

    router.post('/sessions/:sessionId/outcome', ...requireTeacherHandlers, async (req, res) => {
        try {
            const callerUid = cleanOptionalString(req.user?.uid);
            const sessionId = cleanOptionalString(req.params?.sessionId);
            if (!callerUid || !sessionId) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Missing teacher or session identifier.');
            }

            const sessionOutcome = normalizeSessionOutcome(req.body?.outcome);
            const sessionRef = db.collection(CRM_SCHEDULED_SESSIONS).doc(sessionId);
            const sessionSnap = await sessionRef.get();
            if (!sessionSnap.exists) {
                return sendError(res, 404, 'SESSION_NOT_FOUND', 'Session not found.');
            }

            const existing = normalizeScheduledSession({ sessionId, ...(sessionSnap.data() || {}) });
            const rawNote = req.body?.note !== undefined ? req.body.note : req.body?.sessionNote;
            const sessionNote = rawNote !== undefined
                ? cleanOptionalString(rawNote, '')
                : cleanOptionalString(existing?.sessionNote, '');
            const isAdmin = req.teacherAccess?.isAdmin === true;
            if (!cleanOptionalString(existing.classId)) {
                return sendError(res, 400, 'INVALID_SESSION', 'Session is missing class ownership metadata.');
            }

            const access = await loadTeacherClassroom(db, cleanOptionalString(existing.classId), callerUid, { isAdmin });
            if (access.status !== 'ok') {
                return sendError(res, 403, 'FORBIDDEN', 'You can only update sessions for your own classrooms.');
            }

            const sessionTeacher = cleanOptionalString(existing.teacherUid);
            const classroomPrimaryTeacher = cleanOptionalString(access.classroom?.primaryTeacherUid);
            const isAuthorizedTeacher = sessionTeacher === callerUid || (sessionTeacher === 'all' && classroomPrimaryTeacher === callerUid);
            if (!isAdmin && !isAuthorizedTeacher) {
                return sendError(res, 403, 'FORBIDDEN', 'You can only update outcomes for your own sessions.');
            }
            if (String(existing.status || 'scheduled') === 'cancelled' || isLockedSession(existing)) {
                return sendError(res, 409, 'SESSION_LOCKED', 'Locked or cancelled sessions cannot be updated.');
            }

            const rawExistingTeacher = cleanOptionalString(existing.teacherUid);
            const effectiveTeacherUid = (rawExistingTeacher && rawExistingTeacher !== 'all')
                ? rawExistingTeacher
                : (classroomPrimaryTeacher || callerUid);

            const patch = {
                teacherUid: effectiveTeacherUid,
                sessionOutcome,
                sessionNote: sessionNote || '',
                contractCountState: deriveContractCountState({
                    ...existing,
                    sessionOutcome
                }),
                version: Number(existing.version || 1) + 1,
                updatedAt: serverTimestamp(),
                updatedBy: callerUid
            };

            await sessionRef.set(patch, { merge: true });
            const scheduleState = await syncClassroomScheduleState(db, cleanOptionalString(existing.classId), { bumpVersion: true });

            await writeAuditLog?.({
                action: 'teacher.session.outcome',
                entityType: 'scheduled_session',
                entityId: sessionId,
                metadata: {
                    classId: existing.classId || null,
                    sessionOutcome,
                    hasSessionNote: !!sessionNote
                }
            }, { user: req.user });

            return sendSuccess(res, {
                sessionId,
                sessionOutcome,
                sessionNote: sessionNote || '',
                scheduleSummary: scheduleState?.scheduleSummary || null,
                scheduleVersion: scheduleState?.scheduleConfig?.scheduleVersion || null
            }, 'Session outcome updated.');
        } catch (error) {
            const message = String(error?.message || '');
            if (message.includes('Invalid session outcome')) {
                return sendError(res, 400, 'VALIDATION_ERROR', error.message);
            }
            return sendError(res, 500, 'TEACHER_OUTCOME_ERROR', 'Failed to update session outcome.', error?.message || error);
        }
    });

    router.post('/scheduler/activate-recurrences', ...requireTeacherHandlers, async (req, res) => {
        try {
            let teacherUid = cleanOptionalString(req.user?.uid);
            if (!teacherUid) {
                return sendError(res, 401, 'UNAUTHORIZED', 'Missing authenticated user.');
            }

            const isAdmin = req.teacherAccess?.isAdmin === true;
            if (isAdmin && req.body?.teacherUid) {
                const targetTeacherUid = cleanOptionalString(req.body.teacherUid);
                if (targetTeacherUid && targetTeacherUid !== 'all') {
                    teacherUid = targetTeacherUid;
                }
            }

            const from = cleanOptionalString(req.body?.from, startOfCurrentWeek());
            const to = cleanOptionalString(req.body?.to, endOfCurrentWeek(from));
            const activationStartDate = addDays(to, 1);
            const expectedVersions = req.body?.expectedScheduleVersions && typeof req.body.expectedScheduleVersions === 'object'
                ? req.body.expectedScheduleVersions
                : {};

            const classrooms = await listTeacherClassrooms(db, teacherUid);
            const teacherSessions = await listTeacherScheduledSessions(db, teacherUid);
            const workingTeacherSessions = [...teacherSessions];
            const details = [];

            for (const entry of classrooms) {
                const classId = entry.id;
                const classroom = entry.data || {};
                const scheduleConfig = classroom.scheduleConfig || {};
                const className = cleanOptionalString(classroom.name, classId);
                const currentScheduleVersion = Number(scheduleConfig.scheduleVersion || 1) || 1;
                const expectedScheduleVersion = readExpectedScheduleVersion(expectedVersions[classId]);
                if (expectedScheduleVersion && expectedScheduleVersion !== currentScheduleVersion) {
                    details.push({
                        classId,
                        className,
                        status: 'blocked',
                        createdCount: 0,
                        blockedCount: 1,
                        reason: 'stale_schedule_version',
                        message: 'Schedule version changed. Refresh before activating recurrences.'
                    });
                    continue;
                }

                const sessionMinutes = toPositiveInteger(scheduleConfig.sessionMinutes, null);
                const totalInstructionMinutes = toPositiveInteger(scheduleConfig.totalInstructionMinutes, null);
                const targetSessionCount = toPositiveInteger(scheduleConfig.targetSessionCount, null);
                const timezone = cleanOptionalString(scheduleConfig.timezone, 'UTC');
                const startTime = cleanOptionalString(scheduleConfig.seedStartTime);
                const weekdays = normalizeWeekdays(scheduleConfig.seedWeekdays);
                if (!sessionMinutes || !targetSessionCount || !startTime || !weekdays.length) {
                    details.push({
                        classId,
                        className,
                        status: 'blocked',
                        createdCount: 0,
                        blockedCount: 1,
                        reason: 'missing_pattern',
                        message: 'Missing weekly pattern. Set weekdays and start time first.'
                    });
                    continue;
                }

                const classSessions = await listClassSessions(db, classId);
                const contractedAssignedCount = classSessions
                    .filter((session) =>
                        session.unitType === 'contracted'
                        && String(session.status || 'scheduled') !== 'cancelled'
                        && String(session.contractCountState || 'counts') !== 'does_not_count'
                    )
                    .length;
                const remaining = Math.max(targetSessionCount - contractedAssignedCount, 0);
                if (remaining <= 0) {
                    details.push({
                        classId,
                        className,
                        status: 'blocked',
                        createdCount: 0,
                        blockedCount: 0,
                        reason: 'already_fulfilled',
                        message: 'No remaining contracted sessions to activate.'
                    });
                    continue;
                }

                const workingClassSessions = [...classSessions];
                const preparedSessions = [];
                const blockedOccurrences = [];
                let cursorDate = activationStartDate;
                let searchSteps = 0;
                const maxSearchSteps = 540;

                while (preparedSessions.length < remaining && searchSteps < maxSearchSteps) {
                    if (weekdays.includes(weekdayNumber(cursorDate))) {
                        const preview = buildAddSessionPreview({
                            classId,
                            courseId: classroom.courseId || null,
                            teacherUid,
                            totalInstructionMinutes,
                            targetSessionCount,
                            sessionMinutes,
                            timezone,
                            targetLocalDate: cursorDate,
                            targetLocalTime: startTime,
                            durationMinutes: sessionMinutes,
                            addMode: 'once',
                            recurringCount: 1,
                            existingSessions: workingClassSessions
                        });

                        if (!preview.canCommit || !preview.validOccurrences.length) {
                            const blocked = Array.isArray(preview.blockedOccurrences) && preview.blockedOccurrences.length
                                ? preview.blockedOccurrences[0]
                                : { reasonCode: 'blocked', reasonMessage: 'Slot unavailable.' };
                            blockedOccurrences.push({
                                targetLocalDate: cursorDate,
                                targetLocalTime: startTime,
                                reasonCode: blocked.reasonCode || 'blocked',
                                reasonMessage: blocked.reasonMessage || 'Slot unavailable.'
                            });
                        } else {
                            const occurrence = preview.validOccurrences[0];
                            const teacherConflict = findTeacherConflict(workingTeacherSessions, occurrence);
                            if (teacherConflict) {
                                blockedOccurrences.push({
                                    targetLocalDate: occurrence.scheduledLocalDate,
                                    targetLocalTime: occurrence.scheduledLocalTime,
                                    reasonCode: 'teacher_conflict',
                                    reasonMessage: `Teacher conflict with ${teacherConflict.sessionId || 'another session'}.`
                                });
                            } else {
                                preparedSessions.push(occurrence);
                                workingClassSessions.push(occurrence);
                                workingTeacherSessions.push(occurrence);
                            }
                        }
                    }

                    cursorDate = addDays(cursorDate, 1);
                    searchSteps += 1;
                }

                if (!preparedSessions.length) {
                    details.push({
                        classId,
                        className,
                        status: 'blocked',
                        createdCount: 0,
                        blockedCount: blockedOccurrences.length,
                        reason: 'no_open_slots',
                        message: 'No conflict-free future slots found for this pattern.'
                    });
                    continue;
                }

                const createdSessions = [];
                const BATCH_LIMIT = 400;
                if (typeof db.batch === 'function') {
                    for (let i = 0; i < preparedSessions.length; i += BATCH_LIMIT) {
                        const chunk = preparedSessions.slice(i, i + BATCH_LIMIT);
                        const batch = db.batch();
                        chunk.forEach((session) => {
                            const ref = db.collection(CRM_SCHEDULED_SESSIONS).doc();
                            const payload = {
                                ...session,
                                teacherUid,
                                createdAt: serverTimestamp(),
                                createdBy: cleanOptionalString(req.user?.uid) || teacherUid,
                                updatedAt: serverTimestamp(),
                                updatedBy: cleanOptionalString(req.user?.uid) || teacherUid
                            };
                            createdSessions.push({ sessionId: ref.id, ...normalizeScheduledSession(payload) });
                            batch.set(ref, payload);
                        });
                        await batch.commit();
                    }
                } else {
                    for (const session of preparedSessions) {
                        const ref = db.collection(CRM_SCHEDULED_SESSIONS).doc();
                        const payload = {
                            ...session,
                            teacherUid,
                            createdAt: serverTimestamp(),
                            createdBy: cleanOptionalString(req.user?.uid) || teacherUid,
                            updatedAt: serverTimestamp(),
                            updatedBy: cleanOptionalString(req.user?.uid) || teacherUid
                        };
                        if (typeof ref.set === 'function') {
                            await ref.set(payload);
                        }
                        createdSessions.push({ sessionId: ref.id, ...normalizeScheduledSession(payload) });
                    }
                }

                await syncClassroomScheduleState(db, classId, { bumpVersion: true });
                details.push({
                    classId,
                    className,
                    status: preparedSessions.length >= remaining ? 'success' : 'blocked',
                    createdCount: createdSessions.length,
                    blockedCount: blockedOccurrences.length,
                    message: preparedSessions.length >= remaining
                        ? 'Recurrences activated.'
                        : 'Activated partially due to conflicts.'
                });
            }

            const summary = {
                successCount: details.filter((entry) => entry.status === 'success').length,
                blockedCount: details.filter((entry) => entry.status === 'blocked').length,
                errorCount: details.filter((entry) => entry.status === 'error').length
            };

            await writeAuditLog?.({
                action: 'teacher.scheduler.activate_recurrences',
                entityType: 'teacher',
                entityId: teacherUid,
                metadata: {
                    from,
                    to,
                    summary
                }
            }, { user: req.user });

            return sendSuccess(res, {
                summary,
                details,
                from,
                to
            }, 'Recurrence activation completed.');
        } catch (error) {
            return sendError(res, 500, 'TEACHER_ACTIVATE_RECURRENCES_ERROR', 'Failed to activate recurrences.', error?.message || error);
        }
    });

    return router;
};
