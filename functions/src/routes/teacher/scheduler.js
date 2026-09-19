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
    buildBulkRescheduleProjection,
    buildScheduleSummary,
    buildScheduledSessionWriteData,
    buildSeriesShiftPlan,
    deriveContractCountState,
    findTeacherConflict,
    normalizeScheduledSession,
} = require('../../crm/scheduling-service');
const {
    SchedulingOperationError,
    executeSchedulingOperation,
    normalizeSchedulingOperationId
} = require('../../crm/scheduling-operation-service');

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
    return Number.isInteger(numeric) && numeric >= 0 ? numeric : null;
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

function filterSessionsByRange(sessions, from, to) {
    const fromDate = cleanOptionalString(from);
    const toDate = cleanOptionalString(to);
    return (Array.isArray(sessions) ? sessions : [])
        .filter((session) => String(session.status || 'scheduled') !== 'cancelled')
        .filter((session) => !fromDate || String(session.scheduledLocalDate || '') >= fromDate)
        .filter((session) => !toDate || String(session.scheduledLocalDate || '') <= toDate)
        .sort((left, right) => String(left.scheduledStartAtUtc || '').localeCompare(String(right.scheduledStartAtUtc || '')));
}

function nextScheduleVersion(scheduleConfig) {
    return Math.max(Number(scheduleConfig?.scheduleVersion || 0) + 1, 1);
}

function requestOperationId(req, prefix) {
    const bodyOperationId = cleanOptionalString(req.body?.operationId);
    const headerOperationId = cleanOptionalString(req.get?.('Idempotency-Key') || req.headers?.['idempotency-key']);
    if (bodyOperationId && headerOperationId && bodyOperationId !== headerOperationId) {
        throw new SchedulingOperationError(400, 'OPERATION_ID_MISMATCH', 'Body operationId and Idempotency-Key must match.');
    }
    return normalizeSchedulingOperationId(bodyOperationId || headerOperationId, prefix);
}

function requestOperationPayload(req, identifiers = {}) {
    const body = req.body && typeof req.body === 'object' ? { ...req.body } : {};
    delete body.operationId;
    return { ...body, ...identifiers };
}

function failSchedulingOperation(status, code, message, details = null) {
    throw new SchedulingOperationError(status, code, message, details);
}

function sendSchedulingOperationFailure(sendError, res, error, fallbackCode, fallbackMessage) {
    if (error instanceof SchedulingOperationError) {
        return sendError(res, error.status, error.code, error.message, error.details);
    }
    return sendError(res, 500, fallbackCode, fallbackMessage, error?.message || error);
}

async function readClassSessionsInTransaction(tx, db, classId) {
    const snap = await tx.get(db.collection(CRM_SCHEDULED_SESSIONS).where('classId', '==', classId));
    return snap.docs.map((doc) => normalizeScheduledSession({ sessionId: doc.id, ...doc.data() }));
}

function stageClassroomScheduleState(tx, classroomRef, classroom, sessions, options = {}) {
    const baseScheduleConfig = classroom?.scheduleConfig || null;
    const scheduleConfig = options.scheduleConfigPatch
        ? normalizeScheduleConfig(options.scheduleConfigPatch, {
            existing: baseScheduleConfig,
            preserveExistingTargetSessionCount: options.preserveExistingTargetSessionCount !== false
        })
        : baseScheduleConfig;
    if (!scheduleConfig?.totalInstructionMinutes || !scheduleConfig?.sessionMinutes) return null;

    const effectiveScheduleConfig = options.bumpVersion === false
        ? scheduleConfig
        : { ...scheduleConfig, scheduleVersion: nextScheduleVersion(scheduleConfig) };
    const scheduleSummary = buildScheduleSummary({
        totalInstructionMinutes: effectiveScheduleConfig.totalInstructionMinutes,
        sessionMinutes: effectiveScheduleConfig.sessionMinutes,
        targetSessionCount: effectiveScheduleConfig.targetSessionCount,
        sessions
    });
    tx.set(classroomRef, {
        ...(options.rootPatch || {}),
        scheduleConfig: effectiveScheduleConfig,
        scheduleSummary
    }, { merge: true });
    return { scheduleConfig: effectiveScheduleConfig, scheduleSummary };
}

function assertTeacherClassroomAccess(classroom, callerUid, isAdmin, message) {
    if (!isAdmin && cleanOptionalString(classroom?.primaryTeacherUid) !== cleanOptionalString(callerUid)) {
        failSchedulingOperation(403, 'FORBIDDEN', message);
    }
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

    const snap = await db.collection(CRM_SCHEDULED_SESSIONS)
        .where('teacherUid', '==', cleanedTeacherUid)
        .get();
    const sessions = snap.docs.map((doc) => normalizeScheduledSession({ sessionId: doc.id, ...doc.data() }));
    return filterSessionsByRange(sessions, from, to);
}

async function listAllScheduledSessions(db, options = {}) {
    const from = cleanOptionalString(options.from);
    const to = cleanOptionalString(options.to);

    const snap = await db.collection(CRM_SCHEDULED_SESSIONS).get();
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
    const runSchedulingOperation = deps.executeSchedulingOperation || executeSchedulingOperation;

    const router = express.Router();

    async function auditCommitted(outcome, entry, user) {
        if (outcome.idempotentReplay || !writeAuditLog) return outcome;
        try {
            await writeAuditLog(entry, { user });
            return outcome;
        } catch (error) {
            return {
                ...outcome,
                warnings: [...(Array.isArray(outcome.warnings) ? outcome.warnings : []), 'AUDIT_LOG_FAILED']
            };
        }
    }

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
            const missingClassIds = sessions
                .map((s) => String(s.classId || '').trim())
                .filter((id) => id && !classIdSet.has(id));
            if (missingClassIds.length > 0) {
                const uniqueMissing = [...new Set(missingClassIds)];
                const extraSnaps = await Promise.all(
                    uniqueMissing.map((id) => db.collection(CRM_CLASSROOMS).doc(id).get())
                );
                extraSnaps.forEach((snap) => {
                    if (snap.exists) {
                        classrooms.push({ id: snap.id, data: snap.data() || {} });
                        classIdSet.add(snap.id);
                    }
                });
            }
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
            let outcome = await runSchedulingOperation({
                db,
                operationId: requestOperationId(req, 'teacher-add'),
                actorUid: callerUid,
                operationType: 'teacher.session.add',
                payload: requestOperationPayload(req, { classId }),
                serverTimestamp,
                prepare: async ({ tx }) => {
                    const classroomRef = db.collection(CRM_CLASSROOMS).doc(classId);
                    const classroomSnap = await tx.get(classroomRef);
                    if (!classroomSnap.exists) failSchedulingOperation(404, 'CLASSROOM_NOT_FOUND', 'Classroom not found.');
                    const classroom = classroomSnap.data() || {};
                    assertTeacherClassroomAccess(classroom, callerUid, isAdmin, 'You can only schedule your own classrooms.');
                    const classSessions = await readClassSessionsInTransaction(tx, db, classId);
                    const teacherUid = (isAdmin && cleanOptionalString(req.body?.teacherUid) && cleanOptionalString(req.body?.teacherUid) !== 'all')
                        ? cleanOptionalString(req.body.teacherUid)
                        : (cleanOptionalString(classroom.primaryTeacherUid) || callerUid);
                    return {
                        teacherUids: [teacherUid],
                        state: { classroomRef, classroom, classSessions, teacherUid }
                    };
                },
                commit: async ({ tx, state, teacherSessionsByUid }) => {
                    const scheduleConfig = state.classroom.scheduleConfig || {};
                    const intent = extractLocalIntent(req.body || {}, scheduleConfig.timezone || null, scheduleConfig.sessionMinutes || null);
                    const preview = buildAddSessionPreview({
                        classId,
                        courseId: state.classroom.courseId || null,
                        teacherUid: state.teacherUid,
                        totalInstructionMinutes: Number(scheduleConfig.totalInstructionMinutes || 0) || null,
                        targetSessionCount: Number(scheduleConfig.targetSessionCount || 0) || null,
                        sessionMinutes: Number(scheduleConfig.sessionMinutes || 0) || intent.durationMinutes || null,
                        timezone: intent.timezone,
                        targetLocalDate: intent.targetLocalDate,
                        targetLocalTime: intent.targetLocalTime,
                        durationMinutes: intent.durationMinutes,
                        addMode: 'once',
                        recurringCount: 1,
                        existingSessions: state.classSessions
                    });
                    if (!preview.canCommit || !preview.validOccurrences.length) {
                        failSchedulingOperation(409, 'NO_VALID_OCCURRENCES', 'No valid session could be created for this slot.', {
                            blockedOccurrences: preview.blockedOccurrences || [],
                            warnings: preview.warnings || []
                        });
                    }
                    const occurrence = preview.validOccurrences[0];
                    const conflict = findTeacherConflict(teacherSessionsByUid.get(state.teacherUid) || [], occurrence);
                    if (conflict) {
                        failSchedulingOperation(409, 'TEACHER_CONFLICT', 'Teacher conflict with an existing session.', {
                            conflictSession: conflict
                        });
                    }
                    const ref = db.collection(CRM_SCHEDULED_SESSIONS).doc();
                    const payload = {
                        ...occurrence,
                        teacherUid: state.teacherUid,
                        createdAt: serverTimestamp(),
                        createdBy: callerUid,
                        updatedAt: serverTimestamp(),
                        updatedBy: callerUid
                    };
                    tx.set(ref, payload);
                    const session = normalizeScheduledSession({ sessionId: ref.id, ...payload });
                    const scheduleState = stageClassroomScheduleState(
                        tx,
                        state.classroomRef,
                        state.classroom,
                        state.classSessions.concat(session)
                    );
                    return {
                        committedIds: [ref.id],
                        result: {
                            sessionId: ref.id,
                            session,
                            scheduleSummary: scheduleState?.scheduleSummary || null,
                            scheduleVersion: scheduleState?.scheduleConfig?.scheduleVersion || null
                        }
                    };
                }
            });
            outcome = await auditCommitted(outcome, {
                action: 'teacher.session.add',
                entityType: 'classroom',
                entityId: classId,
                metadata: { sessionId: outcome.sessionId, teacherUid: outcome.session?.teacherUid || null }
            }, req.user);
            return sendSuccess(res, outcome, 'Session added.');
        } catch (error) {
            return sendSchedulingOperationFailure(sendError, res, error, 'TEACHER_ADD_SESSION_ERROR', 'Failed to add session.');
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
            const weekdays = normalizeWeekdays(req.body?.weekdays);
            if (!weekdays.length) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Select at least one weekday.');
            }

            const from = cleanOptionalString(req.body?.from, startOfCurrentWeek());
            const to = cleanOptionalString(req.body?.to, endOfCurrentWeek(from));
            if (!from || !to || from > to) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid scheduling range.');
            }
            let outcome = await runSchedulingOperation({
                db,
                operationId: requestOperationId(req, 'teacher-add-multi'),
                actorUid: callerUid,
                operationType: 'teacher.session.add_multi',
                payload: requestOperationPayload(req, { classId }),
                serverTimestamp,
                prepare: async ({ tx }) => {
                    const classroomRef = db.collection(CRM_CLASSROOMS).doc(classId);
                    const classroomSnap = await tx.get(classroomRef);
                    if (!classroomSnap.exists) failSchedulingOperation(404, 'CLASSROOM_NOT_FOUND', 'Classroom not found.');
                    const classroom = classroomSnap.data() || {};
                    assertTeacherClassroomAccess(classroom, callerUid, isAdmin, 'You can only schedule your own classrooms.');
                    const classSessions = await readClassSessionsInTransaction(tx, db, classId);
                    const teacherUid = (isAdmin && cleanOptionalString(req.body?.teacherUid) && cleanOptionalString(req.body?.teacherUid) !== 'all')
                        ? cleanOptionalString(req.body.teacherUid)
                        : (cleanOptionalString(classroom.primaryTeacherUid) || callerUid);
                    return {
                        teacherUids: [teacherUid],
                        state: { classroomRef, classroom, classSessions, teacherUid }
                    };
                },
                commit: async ({ tx, state, teacherSessionsByUid }) => {
                    const scheduleConfig = state.classroom.scheduleConfig || {};
                    const startTime = cleanOptionalString(req.body?.startTime) || cleanOptionalString(scheduleConfig.seedStartTime);
                    if (!startTime) failSchedulingOperation(400, 'VALIDATION_ERROR', 'startTime is required.');
                    const durationMinutes = toPositiveInteger(req.body?.durationMinutes, Number(scheduleConfig.sessionMinutes || 0) || null);
                    const sessionMinutes = toPositiveInteger(scheduleConfig.sessionMinutes, durationMinutes || null) || durationMinutes;
                    const timezone = cleanOptionalString(req.body?.timezone, scheduleConfig.timezone || 'UTC');
                    const targetSessionCount = Number(scheduleConfig.targetSessionCount || 0) || null;
                    const totalInstructionMinutes = Number(scheduleConfig.totalInstructionMinutes || 0) || null;
                    const workingClassSessions = [...state.classSessions];
                    const workingTeacherSessions = [...(teacherSessionsByUid.get(state.teacherUid) || [])];
                    const preparedSessions = [];
                    const skippedOccurrences = [];
                    let cursor = from;
                    while (cursor <= to) {
                        if (weekdays.includes(weekdayNumber(cursor))) {
                            const preview = buildAddSessionPreview({
                                classId,
                                courseId: state.classroom.courseId || null,
                                teacherUid: state.teacherUid,
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
                                const blocked = preview.blockedOccurrences?.[0] || { reasonCode: 'blocked', reasonMessage: 'Slot is not available.' };
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
                        failSchedulingOperation(409, 'NO_VALID_OCCURRENCES', 'No valid sessions could be created for the selected week.', {
                            skippedOccurrences
                        });
                    }
                    if (preparedSessions.length + 3 > 495) {
                        failSchedulingOperation(400, 'TOO_MANY_SCHEDULE_WRITES', 'Multi-session creation is too large for one atomic operation. Narrow the date range.');
                    }
                    const createdSessions = preparedSessions.map((session) => {
                        const ref = db.collection(CRM_SCHEDULED_SESSIONS).doc();
                        const payload = {
                            ...session,
                            teacherUid: state.teacherUid,
                            createdAt: serverTimestamp(),
                            createdBy: callerUid,
                            updatedAt: serverTimestamp(),
                            updatedBy: callerUid
                        };
                        tx.set(ref, payload);
                        return { sessionId: ref.id, ...normalizeScheduledSession(payload) };
                    });
                    const scheduleState = stageClassroomScheduleState(
                        tx,
                        state.classroomRef,
                        state.classroom,
                        state.classSessions.concat(createdSessions),
                        {
                            scheduleConfigPatch: {
                                ...scheduleConfig,
                                seedWeekdays: weekdays,
                                seedStartTime: startTime
                            }
                        }
                    );
                    return {
                        committedIds: createdSessions.map((session) => session.sessionId),
                        result: {
                            createdSessions,
                            skippedOccurrences,
                            scheduleSummary: scheduleState?.scheduleSummary || null,
                            scheduleVersion: scheduleState?.scheduleConfig?.scheduleVersion || null
                        }
                    };
                }
            });
            outcome = await auditCommitted(outcome, {
                action: 'teacher.session.add_multi',
                entityType: 'classroom',
                entityId: classId,
                metadata: {
                    createdCount: outcome.createdSessions?.length || 0,
                    skippedCount: outcome.skippedOccurrences?.length || 0,
                    teacherUid: outcome.createdSessions?.[0]?.teacherUid || null
                }
            }, req.user);
            return sendSuccess(res, outcome, 'Sessions placed for this week.');
        } catch (error) {
            return sendSchedulingOperationFailure(sendError, res, error, 'TEACHER_ADD_MULTI_ERROR', 'Failed to place weekly sessions.');
        }
    });

    router.patch('/sessions/:sessionId/reschedule', ...requireTeacherHandlers, async (req, res) => {
        try {
            const callerUid = cleanOptionalString(req.user?.uid);
            const sessionId = cleanOptionalString(req.params?.sessionId);
            if (!callerUid || !sessionId) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Missing teacher or session identifier.');
            }

            const isAdmin = req.teacherAccess?.isAdmin === true;
            let outcome = await runSchedulingOperation({
                db,
                operationId: requestOperationId(req, 'teacher-reschedule'),
                actorUid: callerUid,
                operationType: 'teacher.session.reschedule',
                payload: requestOperationPayload(req, { sessionId }),
                serverTimestamp,
                prepare: async ({ tx }) => {
                    const sessionRef = db.collection(CRM_SCHEDULED_SESSIONS).doc(sessionId);
                    const sessionSnap = await tx.get(sessionRef);
                    if (!sessionSnap.exists) failSchedulingOperation(404, 'SESSION_NOT_FOUND', 'Session not found.');
                    const existing = normalizeScheduledSession({ sessionId, ...(sessionSnap.data() || {}) });
                    const classId = cleanOptionalString(existing.classId);
                    if (!classId) failSchedulingOperation(400, 'INVALID_SESSION', 'Session is missing class ownership metadata.');
                    const classroomRef = db.collection(CRM_CLASSROOMS).doc(classId);
                    const classroomSnap = await tx.get(classroomRef);
                    if (!classroomSnap.exists) failSchedulingOperation(403, 'FORBIDDEN', 'You can only edit sessions for your own classrooms.');
                    const classroom = classroomSnap.data() || {};
                    assertTeacherClassroomAccess(classroom, callerUid, isAdmin, 'You can only edit sessions for your own classrooms.');
                    const classroomPrimaryTeacher = cleanOptionalString(classroom.primaryTeacherUid);
                    const sessionTeacher = cleanOptionalString(existing.teacherUid);
                    const isAuthorizedTeacher = sessionTeacher === callerUid || (sessionTeacher === 'all' && classroomPrimaryTeacher === callerUid);
                    if (!isAdmin && !isAuthorizedTeacher) failSchedulingOperation(403, 'FORBIDDEN', 'You can only edit your own sessions.');
                    if (isLockedSession(existing)) failSchedulingOperation(409, 'SESSION_LOCKED', 'Locked sessions cannot be rescheduled.');
                    const expectedVersion = readExpectedScheduleVersion(req.body?.expectedScheduleVersion);
                    const currentVersion = Number(classroom.scheduleConfig?.scheduleVersion || 0);
                    if (expectedVersion !== null && expectedVersion !== currentVersion) {
                        failSchedulingOperation(409, 'SCHEDULE_VERSION_MISMATCH', 'Schedule version mismatch. Refresh and try again.');
                    }
                    const requestedTeacher = (isAdmin && cleanOptionalString(req.body?.teacherUid) && cleanOptionalString(req.body?.teacherUid) !== 'all')
                        ? cleanOptionalString(req.body.teacherUid)
                        : null;
                    const teacherUid = requestedTeacher
                        || ((sessionTeacher && sessionTeacher !== 'all') ? sessionTeacher : null)
                        || (classroomPrimaryTeacher || callerUid);
                    const classSessions = await readClassSessionsInTransaction(tx, db, classId);
                    return {
                        teacherUids: [sessionTeacher, teacherUid],
                        state: { sessionRef, existing, classId, classroomRef, classroom, classSessions, teacherUid }
                    };
                },
                commit: async ({ tx, state, teacherSessionsByUid }) => {
                    const intent = extractLocalIntent(req.body || {}, state.existing.timezone || null, state.existing.durationMinutes || null);
                    const nextWindow = buildScheduledSessionWriteData({}, {
                        targetLocalDate: intent.targetLocalDate,
                        targetLocalTime: intent.targetLocalTime,
                        timezone: intent.timezone,
                        durationMinutes: intent.durationMinutes || state.existing.durationMinutes || null
                    });
                    const next = {
                        ...state.existing,
                        ...nextWindow,
                        teacherUid: state.teacherUid,
                        durationMinutes: intent.durationMinutes || state.existing.durationMinutes || null,
                        timezone: intent.timezone || state.existing.timezone || null,
                        version: Number(state.existing.version || 1) + 1,
                        updatedAt: serverTimestamp(),
                        updatedBy: callerUid
                    };
                    const conflict = findTeacherConflict(
                        teacherSessionsByUid.get(state.teacherUid) || [],
                        next,
                        [sessionId]
                    );
                    if (conflict) {
                        failSchedulingOperation(409, 'TEACHER_CONFLICT', 'Teacher conflict with an existing session.', {
                            conflictSession: conflict
                        });
                    }
                    tx.set(state.sessionRef, next, { merge: true });
                    const postSessions = state.classSessions.map((session) => session.sessionId === sessionId ? normalizeScheduledSession(next) : session);
                    const scheduleState = stageClassroomScheduleState(tx, state.classroomRef, state.classroom, postSessions);
                    return {
                        committedIds: [sessionId],
                        result: {
                            sessionId,
                            classId: state.classId,
                            teacherUid: state.teacherUid,
                            scheduleSummary: scheduleState?.scheduleSummary || null,
                            scheduleVersion: scheduleState?.scheduleConfig?.scheduleVersion || null
                        }
                    };
                }
            });
            outcome = await auditCommitted(outcome, {
                action: 'teacher.session.reschedule',
                entityType: 'scheduled_session',
                entityId: sessionId,
                metadata: { classId: outcome.classId || null, teacherUid: outcome.teacherUid || null }
            }, req.user);
            return sendSuccess(res, outcome, 'Session rescheduled.');
        } catch (error) {
            return sendSchedulingOperationFailure(sendError, res, error, 'TEACHER_RESCHEDULE_ERROR', 'Failed to reschedule session.');
        }
    });

    router.post('/sessions/:sessionId/reschedule-series', ...requireTeacherHandlers, async (req, res) => {
        try {
            const callerUid = cleanOptionalString(req.user?.uid);
            const sessionId = cleanOptionalString(req.params?.sessionId);
            if (!callerUid || !sessionId) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Missing teacher or session identifier.');
            }
            const isAdmin = req.teacherAccess?.isAdmin === true;
            const dryRun = req.body?.dryRun === true;
            const allowPartial = req.body?.allowPartial === true;
            if (dryRun) {
                const sessionRef = db.collection(CRM_SCHEDULED_SESSIONS).doc(sessionId);
                const sessionSnap = await sessionRef.get();
                if (!sessionSnap.exists) return sendError(res, 404, 'SESSION_NOT_FOUND', 'Session not found.');
                const existing = normalizeScheduledSession({ sessionId, ...(sessionSnap.data() || {}) });
                const classId = cleanOptionalString(existing.classId);
                if (!classId) return sendError(res, 400, 'INVALID_SESSION', 'Session is missing class ownership metadata.');
                const access = await loadTeacherClassroom(db, classId, callerUid, { isAdmin });
                if (access.status !== 'ok') return sendError(res, 403, 'FORBIDDEN', 'You can only edit sessions for your own classrooms.');
                const classroomPrimaryTeacher = cleanOptionalString(access.classroom?.primaryTeacherUid);
                const sessionTeacher = cleanOptionalString(existing.teacherUid);
                const isAuthorizedTeacher = sessionTeacher === callerUid || (sessionTeacher === 'all' && classroomPrimaryTeacher === callerUid);
                if (!isAdmin && !isAuthorizedTeacher) return sendError(res, 403, 'FORBIDDEN', 'You can only edit your own sessions.');
                if (isLockedSession(existing)) return sendError(res, 409, 'SESSION_LOCKED', 'Locked sessions cannot be rescheduled.');
                const expectedVersion = readExpectedScheduleVersion(req.body?.expectedScheduleVersion);
                const currentVersion = Number(access.classroom?.scheduleConfig?.scheduleVersion || 0);
                if (expectedVersion !== null && expectedVersion !== currentVersion) {
                    return sendError(res, 409, 'SCHEDULE_VERSION_MISMATCH', 'Schedule version mismatch. Refresh and try again.');
                }
                const intent = extractLocalIntent(req.body || {}, existing.timezone || null, existing.durationMinutes || null);
                const requestedTeacher = (isAdmin && cleanOptionalString(req.body?.teacherUid) && cleanOptionalString(req.body?.teacherUid) !== 'all')
                    ? cleanOptionalString(req.body.teacherUid)
                    : null;
                const effectiveTeacherUid = requestedTeacher
                    || ((sessionTeacher && sessionTeacher !== 'all') ? sessionTeacher : null)
                    || (classroomPrimaryTeacher || callerUid);
                const classSessions = await listClassSessions(db, classId);
                const teacherSessions = await listTeacherScheduledSessions(db, effectiveTeacherUid);
                const plan = buildSeriesShiftPlan({
                    sessions: classSessions,
                    anchorSession: existing,
                    targetIntent: {
                        targetLocalDate: intent.targetLocalDate,
                        targetLocalTime: intent.targetLocalTime,
                        durationMinutes: intent.durationMinutes,
                        timezone: intent.timezone,
                        teacherUid: effectiveTeacherUid
                    },
                    outsideSessions: teacherSessions,
                    allowPartial,
                    operationId: cleanOptionalString(req.body?.operationId),
                    dryRun: true
                });
                return sendSuccess(res, {
                    ...plan,
                    scheduleSummary: access.classroom?.scheduleSummary || null,
                    scheduleVersion: access.classroom?.scheduleConfig?.scheduleVersion || null
                }, 'Dry run completed.');
            }

            let outcome = await runSchedulingOperation({
                db,
                operationId: requestOperationId(req, 'teacher-reschedule-series'),
                actorUid: callerUid,
                operationType: 'teacher.session.reschedule_series',
                payload: requestOperationPayload(req, { sessionId }),
                serverTimestamp,
                prepare: async ({ tx }) => {
                    const sessionRef = db.collection(CRM_SCHEDULED_SESSIONS).doc(sessionId);
                    const sessionSnap = await tx.get(sessionRef);
                    if (!sessionSnap.exists) failSchedulingOperation(404, 'SESSION_NOT_FOUND', 'Session not found.');
                    const existing = normalizeScheduledSession({ sessionId, ...(sessionSnap.data() || {}) });
                    const classId = cleanOptionalString(existing.classId);
                    if (!classId) failSchedulingOperation(400, 'INVALID_SESSION', 'Session is missing class ownership metadata.');
                    const classroomRef = db.collection(CRM_CLASSROOMS).doc(classId);
                    const classroomSnap = await tx.get(classroomRef);
                    if (!classroomSnap.exists) failSchedulingOperation(403, 'FORBIDDEN', 'You can only edit sessions for your own classrooms.');
                    const classroom = classroomSnap.data() || {};
                    assertTeacherClassroomAccess(classroom, callerUid, isAdmin, 'You can only edit sessions for your own classrooms.');
                    const classroomPrimaryTeacher = cleanOptionalString(classroom.primaryTeacherUid);
                    const sessionTeacher = cleanOptionalString(existing.teacherUid);
                    const isAuthorizedTeacher = sessionTeacher === callerUid || (sessionTeacher === 'all' && classroomPrimaryTeacher === callerUid);
                    if (!isAdmin && !isAuthorizedTeacher) failSchedulingOperation(403, 'FORBIDDEN', 'You can only edit your own sessions.');
                    if (isLockedSession(existing)) failSchedulingOperation(409, 'SESSION_LOCKED', 'Locked sessions cannot be rescheduled.');
                    const expectedVersion = readExpectedScheduleVersion(req.body?.expectedScheduleVersion);
                    const currentVersion = Number(classroom.scheduleConfig?.scheduleVersion || 0);
                    if (expectedVersion !== null && expectedVersion !== currentVersion) {
                        failSchedulingOperation(409, 'SCHEDULE_VERSION_MISMATCH', 'Schedule version mismatch. Refresh and try again.');
                    }
                    const requestedTeacher = (isAdmin && cleanOptionalString(req.body?.teacherUid) && cleanOptionalString(req.body?.teacherUid) !== 'all')
                        ? cleanOptionalString(req.body.teacherUid)
                        : null;
                    const teacherUid = requestedTeacher
                        || ((sessionTeacher && sessionTeacher !== 'all') ? sessionTeacher : null)
                        || (classroomPrimaryTeacher || callerUid);
                    const classSessions = await readClassSessionsInTransaction(tx, db, classId);
                    return {
                        teacherUids: [teacherUid, ...classSessions.map((session) => session.teacherUid)],
                        state: { classroomRef, classroom, classId, existing, classSessions, teacherUid }
                    };
                },
                commit: async ({ tx, state, teacherUids, teacherSessionsByUid, operationId }) => {
                    const intent = extractLocalIntent(req.body || {}, state.existing.timezone || null, state.existing.durationMinutes || null);
                    const plan = buildSeriesShiftPlan({
                        sessions: state.classSessions,
                        anchorSession: state.existing,
                        targetIntent: {
                            targetLocalDate: intent.targetLocalDate,
                            targetLocalTime: intent.targetLocalTime,
                            durationMinutes: intent.durationMinutes,
                            timezone: intent.timezone,
                            teacherUid: state.teacherUid
                        },
                        outsideSessions: teacherSessionsByUid.get(state.teacherUid) || [],
                        allowPartial,
                        operationId,
                        dryRun: false
                    });
                    if (!plan.canCommit) {
                        failSchedulingOperation(409, 'SERIES_CONFLICT', 'Teacher conflict with one or more scheduled sessions.', {
                            conflicts: plan.conflicts,
                            plan
                        });
                    }
                    if (plan.moved.length + teacherUids.length + 2 > 495) {
                        failSchedulingOperation(400, 'TOO_MANY_SCHEDULE_WRITES', 'Series reschedule is too large for one atomic operation. Narrow the series selection.');
                    }
                    const patches = new Map();
                    for (const moved of plan.moved) {
                        const previous = state.classSessions.find((session) => session.sessionId === moved.sessionId) || state.existing;
                        const patch = {
                            ...moved.patch,
                            teacherUid: state.teacherUid,
                            durationMinutes: moved.to.durationMinutes,
                            timezone: moved.to.timezone,
                            version: Number(previous.version || 1) + 1,
                            updatedAt: serverTimestamp(),
                            updatedBy: callerUid
                        };
                        patches.set(moved.sessionId, patch);
                        tx.set(db.collection(CRM_SCHEDULED_SESSIONS).doc(moved.sessionId), patch, { merge: true });
                    }
                    const postMoveSessions = state.classSessions.map((session) => patches.has(session.sessionId)
                        ? normalizeScheduledSession({ ...session, ...patches.get(session.sessionId) })
                        : session);
                    const scheduleState = stageClassroomScheduleState(tx, state.classroomRef, state.classroom, postMoveSessions);
                    return {
                        committedIds: plan.moved.map((moved) => moved.sessionId),
                        result: {
                            ...plan,
                            teacherUid: state.teacherUid,
                            scheduleSummary: scheduleState?.scheduleSummary || null,
                            scheduleVersion: scheduleState?.scheduleConfig?.scheduleVersion || null
                        }
                    };
                }
            });
            outcome = await auditCommitted(outcome, {
                action: 'teacher.session.reschedule_series',
                entityType: 'scheduled_session',
                entityId: sessionId,
                metadata: {
                    classId: outcome.classId || null,
                    teacherUid: outcome.teacherUid || null,
                    movedCount: outcome.moved?.length || 0,
                    operationId: outcome.operationId
                }
            }, req.user);
            return sendSuccess(res, outcome, `Moved ${outcome.moved?.length || 0} session(s).`);
        } catch (error) {
            if (error?.code === 'TOO_MANY_MOVES' || error?.message?.includes('more than 400')) {
                return sendError(res, 400, 'TOO_MANY_MOVES', 'Cannot move more than 400 sessions in a single operation.');
            }
            return sendSchedulingOperationFailure(sendError, res, error, 'TEACHER_RESCHEDULE_SERIES_ERROR', 'Failed to reschedule series.');
        }
    });

    router.post('/sessions/:sessionId/cancel', ...requireTeacherHandlers, async (req, res) => {
        try {
            const callerUid = cleanOptionalString(req.user?.uid);
            const sessionId = cleanOptionalString(req.params?.sessionId);
            if (!callerUid || !sessionId) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Missing teacher or session identifier.');
            }

            const isAdmin = req.teacherAccess?.isAdmin === true;
            let outcome = await runSchedulingOperation({
                db,
                operationId: requestOperationId(req, 'teacher-cancel'),
                actorUid: callerUid,
                operationType: 'teacher.session.cancel',
                payload: requestOperationPayload(req, { sessionId }),
                serverTimestamp,
                prepare: async ({ tx }) => {
                    const sessionRef = db.collection(CRM_SCHEDULED_SESSIONS).doc(sessionId);
                    const sessionSnap = await tx.get(sessionRef);
                    if (!sessionSnap.exists) failSchedulingOperation(404, 'SESSION_NOT_FOUND', 'Session not found.');
                    const existing = normalizeScheduledSession({ sessionId, ...(sessionSnap.data() || {}) });
                    const classId = cleanOptionalString(existing.classId);
                    if (!classId) failSchedulingOperation(400, 'INVALID_SESSION', 'Session is missing class ownership metadata.');
                    const classroomRef = db.collection(CRM_CLASSROOMS).doc(classId);
                    const classroomSnap = await tx.get(classroomRef);
                    if (!classroomSnap.exists) failSchedulingOperation(403, 'FORBIDDEN', 'You can only cancel sessions for your own classrooms.');
                    const classroom = classroomSnap.data() || {};
                    assertTeacherClassroomAccess(classroom, callerUid, isAdmin, 'You can only cancel sessions for your own classrooms.');
                    const sessionTeacher = cleanOptionalString(existing.teacherUid);
                    const classroomPrimaryTeacher = cleanOptionalString(classroom.primaryTeacherUid);
                    const isAuthorizedTeacher = sessionTeacher === callerUid || (sessionTeacher === 'all' && classroomPrimaryTeacher === callerUid);
                    if (!isAdmin && !isAuthorizedTeacher) failSchedulingOperation(403, 'FORBIDDEN', 'You can only cancel your own sessions.');
                    if (isLockedSession(existing)) failSchedulingOperation(409, 'SESSION_LOCKED', 'Locked sessions cannot be cancelled.');
                    const classSessions = await readClassSessionsInTransaction(tx, db, classId);
                    return {
                        teacherUids: [sessionTeacher === 'all' ? classroomPrimaryTeacher : sessionTeacher],
                        state: { sessionRef, existing, classId, classroomRef, classroom, classSessions }
                    };
                },
                commit: async ({ tx, state }) => {
                    const patch = {
                        status: 'cancelled',
                        contractCountState: 'does_not_count',
                        version: Number(state.existing.version || 1) + 1,
                        updatedAt: serverTimestamp(),
                        updatedBy: callerUid
                    };
                    tx.set(state.sessionRef, patch, { merge: true });
                    const postSessions = state.classSessions.map((session) => session.sessionId === sessionId
                        ? normalizeScheduledSession({ ...session, ...patch })
                        : session);
                    const scheduleState = stageClassroomScheduleState(tx, state.classroomRef, state.classroom, postSessions);
                    return {
                        committedIds: [sessionId],
                        result: {
                            sessionId,
                            classId: state.classId,
                            scheduleSummary: scheduleState?.scheduleSummary || null,
                            scheduleVersion: scheduleState?.scheduleConfig?.scheduleVersion || null
                        }
                    };
                }
            });
            outcome = await auditCommitted(outcome, {
                action: 'teacher.session.cancel',
                entityType: 'scheduled_session',
                entityId: sessionId,
                metadata: { classId: outcome.classId || null }
            }, req.user);
            return sendSuccess(res, outcome, 'Session cancelled.');
        } catch (error) {
            return sendSchedulingOperationFailure(sendError, res, error, 'TEACHER_CANCEL_ERROR', 'Failed to cancel session.');
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
            let outcome = await runSchedulingOperation({
                db,
                operationId: requestOperationId(req, 'teacher-activate-recurrences'),
                actorUid: cleanOptionalString(req.user?.uid),
                operationType: 'teacher.scheduler.activate_recurrences',
                payload: requestOperationPayload(req, { teacherUid }),
                serverTimestamp,
                prepare: async ({ tx }) => {
                    let query = db.collection(CRM_CLASSROOMS).where('primaryTeacherUid', '==', teacherUid);
                    if (typeof query.limit === 'function') query = query.limit(200);
                    const classroomSnap = await tx.get(query);
                    const classrooms = [];
                    for (const doc of classroomSnap.docs) {
                        classrooms.push({
                            id: doc.id,
                            ref: doc.ref || db.collection(CRM_CLASSROOMS).doc(doc.id),
                            data: doc.data() || {},
                            sessions: await readClassSessionsInTransaction(tx, db, doc.id)
                        });
                    }
                    return { teacherUids: [teacherUid], state: { classrooms } };
                },
                commit: async ({ tx, state, teacherSessionsByUid }) => {
                    const workingTeacherSessions = [...(teacherSessionsByUid.get(teacherUid) || [])];
                    const details = [];
                    const committedIds = [];
                    let writeCount = 2;
                    for (const entry of state.classrooms) {
                        const classId = entry.id;
                        const classroom = entry.data || {};
                        const scheduleConfig = classroom.scheduleConfig || {};
                        const className = cleanOptionalString(classroom.name, classId);
                        const currentScheduleVersion = Number(scheduleConfig.scheduleVersion || 1) || 1;
                        const expectedScheduleVersion = readExpectedScheduleVersion(expectedVersions[classId]);
                        if (expectedScheduleVersion && expectedScheduleVersion !== currentScheduleVersion) {
                            details.push({ classId, className, status: 'blocked', createdCount: 0, blockedCount: 1, reason: 'stale_schedule_version', message: 'Schedule version changed. Refresh before activating recurrences.' });
                            continue;
                        }
                        const sessionMinutes = toPositiveInteger(scheduleConfig.sessionMinutes, null);
                        const totalInstructionMinutes = toPositiveInteger(scheduleConfig.totalInstructionMinutes, null);
                        const targetSessionCount = toPositiveInteger(scheduleConfig.targetSessionCount, null);
                        const timezone = cleanOptionalString(scheduleConfig.timezone, 'UTC');
                        const startTime = cleanOptionalString(scheduleConfig.seedStartTime);
                        const weekdays = normalizeWeekdays(scheduleConfig.seedWeekdays);
                        if (!sessionMinutes || !targetSessionCount || !startTime || !weekdays.length) {
                            details.push({ classId, className, status: 'blocked', createdCount: 0, blockedCount: 1, reason: 'missing_pattern', message: 'Missing weekly pattern. Set weekdays and start time first.' });
                            continue;
                        }
                        const contractedAssignedCount = entry.sessions.filter((session) =>
                            session.unitType === 'contracted'
                            && String(session.status || 'scheduled') !== 'cancelled'
                            && String(session.contractCountState || 'counts') !== 'does_not_count'
                        ).length;
                        const remaining = Math.max(targetSessionCount - contractedAssignedCount, 0);
                        if (remaining <= 0) {
                            details.push({ classId, className, status: 'blocked', createdCount: 0, blockedCount: 0, reason: 'already_fulfilled', message: 'No remaining contracted sessions to activate.' });
                            continue;
                        }
                        const workingClassSessions = [...entry.sessions];
                        const preparedSessions = [];
                        const blockedOccurrences = [];
                        let cursorDate = activationStartDate;
                        let searchSteps = 0;
                        while (preparedSessions.length < remaining && searchSteps < 540) {
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
                                    const blocked = preview.blockedOccurrences?.[0] || { reasonCode: 'blocked', reasonMessage: 'Slot unavailable.' };
                                    blockedOccurrences.push({ targetLocalDate: cursorDate, targetLocalTime: startTime, reasonCode: blocked.reasonCode || 'blocked', reasonMessage: blocked.reasonMessage || 'Slot unavailable.' });
                                } else {
                                    const occurrence = preview.validOccurrences[0];
                                    const conflict = findTeacherConflict(workingTeacherSessions, occurrence);
                                    if (conflict) {
                                        blockedOccurrences.push({ targetLocalDate: occurrence.scheduledLocalDate, targetLocalTime: occurrence.scheduledLocalTime, reasonCode: 'teacher_conflict', reasonMessage: `Teacher conflict with ${conflict.sessionId || 'another session'}.` });
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
                            details.push({ classId, className, status: 'blocked', createdCount: 0, blockedCount: blockedOccurrences.length, reason: 'no_open_slots', message: 'No conflict-free future slots found for this pattern.' });
                            continue;
                        }
                        writeCount += preparedSessions.length + 1;
                        if (writeCount > 495) {
                            failSchedulingOperation(400, 'TOO_MANY_SCHEDULE_WRITES', 'Recurrence activation is too large for one atomic operation. Narrow the classroom selection.');
                        }
                        const createdSessions = preparedSessions.map((session) => {
                            const ref = db.collection(CRM_SCHEDULED_SESSIONS).doc();
                            const payload = {
                                ...session,
                                teacherUid,
                                createdAt: serverTimestamp(),
                                createdBy: cleanOptionalString(req.user?.uid) || teacherUid,
                                updatedAt: serverTimestamp(),
                                updatedBy: cleanOptionalString(req.user?.uid) || teacherUid
                            };
                            tx.set(ref, payload);
                            committedIds.push(ref.id);
                            return { sessionId: ref.id, ...normalizeScheduledSession(payload) };
                        });
                        stageClassroomScheduleState(tx, entry.ref, classroom, entry.sessions.concat(createdSessions));
                        details.push({
                            classId,
                            className,
                            status: preparedSessions.length >= remaining ? 'success' : 'blocked',
                            createdCount: createdSessions.length,
                            blockedCount: blockedOccurrences.length,
                            message: preparedSessions.length >= remaining ? 'Recurrences activated.' : 'Activated partially due to conflicts.'
                        });
                    }
                    const summary = {
                        successCount: details.filter((entry) => entry.status === 'success').length,
                        blockedCount: details.filter((entry) => entry.status === 'blocked').length,
                        errorCount: details.filter((entry) => entry.status === 'error').length
                    };
                    return { committedIds, result: { summary, details, from, to } };
                }
            });
            outcome = await auditCommitted(outcome, {
                action: 'teacher.scheduler.activate_recurrences',
                entityType: 'teacher',
                entityId: teacherUid,
                metadata: {
                    from,
                    to,
                    summary: outcome.summary
                }
            }, req.user);
            return sendSuccess(res, outcome, 'Recurrence activation completed.');
        } catch (error) {
            return sendSchedulingOperationFailure(sendError, res, error, 'TEACHER_ACTIVATE_RECURRENCES_ERROR', 'Failed to activate recurrences.');
        }
    });

    router.post('/scheduler/sessions/bulk-reschedule', ...requireTeacherHandlers, async (req, res) => {
        try {
            const callerUid = cleanOptionalString(req.user?.uid);
            if (!callerUid) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Missing teacher identifier.');
            }

            const moves = Array.isArray(req.body?.moves) ? req.body.moves : [];
            if (!moves.length) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Moves array is required.');
            }
            if (moves.length > 400) {
                return sendError(res, 400, 'TOO_MANY_MOVES', 'Cannot move more than 400 sessions.');
            }

            const isAdmin = req.teacherAccess?.isAdmin === true;
            const dryRun = req.body?.dryRun === true;
            const undoOf = cleanOptionalString(req.body?.undoOf);
            if (dryRun) {
                const uniqueSessionIds = Array.from(new Set(moves.map((move) => cleanOptionalString(move?.sessionId)).filter(Boolean)));
                const sessionSnaps = await Promise.all(uniqueSessionIds.map((sid) => db.collection(CRM_SCHEDULED_SESSIONS).doc(sid).get()));
                const existingSessionsMap = new Map();
                const classIdSet = new Set();
                sessionSnaps.forEach((snap, index) => {
                    if (!snap.exists) return;
                    const normalized = normalizeScheduledSession({ sessionId: uniqueSessionIds[index], ...(snap.data() || {}) });
                    existingSessionsMap.set(uniqueSessionIds[index], normalized);
                    if (normalized.classId) classIdSet.add(normalized.classId);
                });
                const uniqueClassIds = Array.from(classIdSet);
                const accessResults = await Promise.all(uniqueClassIds.map((classId) => loadTeacherClassroom(db, classId, callerUid, { isAdmin })));
                const classroomAccessMap = new Map(uniqueClassIds.map((classId, index) => [classId, accessResults[index].status === 'ok']));
                const teacherUids = Array.from(new Set(Array.from(existingSessionsMap.values())
                    .map((session) => session.teacherUid)
                    .filter((teacherUid) => teacherUid && teacherUid !== 'all')));
                const teacherSessionResults = await Promise.all(teacherUids.map((teacherUid) => listTeacherScheduledSessions(db, teacherUid)));
                const projection = buildBulkRescheduleProjection({
                    moves,
                    existingSessionsMap,
                    classroomAccessMap,
                    outsideSessions: teacherSessionResults.flat(),
                    callerUid,
                    operationId: cleanOptionalString(req.body?.operationId),
                    dryRun: true,
                    undoOf
                });
                return sendSuccess(res, {
                    ...projection,
                    scheduleSummary: null,
                    scheduleVersion: null
                }, `Processed ${projection.moved.length} move(s).`);
            }

            let outcome = await runSchedulingOperation({
                db,
                operationId: requestOperationId(req, undoOf ? 'teacher-undo' : 'teacher-bulk-reschedule'),
                actorUid: callerUid,
                operationType: 'teacher.scheduler.bulk_reschedule',
                payload: requestOperationPayload(req),
                serverTimestamp,
                prepare: async ({ tx }) => {
                    const uniqueSessionIds = Array.from(new Set(moves.map((move) => cleanOptionalString(move?.sessionId)).filter(Boolean)));
                    const existingSessionsMap = new Map();
                    const classIdSet = new Set();
                    for (const sid of uniqueSessionIds) {
                        const snap = await tx.get(db.collection(CRM_SCHEDULED_SESSIONS).doc(sid));
                        if (!snap.exists) continue;
                        const normalized = normalizeScheduledSession({ sessionId: sid, ...(snap.data() || {}) });
                        existingSessionsMap.set(sid, normalized);
                        if (normalized.classId) classIdSet.add(normalized.classId);
                    }
                    const classrooms = new Map();
                    const classSessions = new Map();
                    const classroomAccessMap = new Map();
                    for (const classId of Array.from(classIdSet).sort()) {
                        const classroomRef = db.collection(CRM_CLASSROOMS).doc(classId);
                        const classroomSnap = await tx.get(classroomRef);
                        const classroom = classroomSnap.exists ? (classroomSnap.data() || {}) : null;
                        const allowed = !!classroom && (isAdmin || cleanOptionalString(classroom.primaryTeacherUid) === callerUid);
                        classroomAccessMap.set(classId, allowed);
                        if (classroom) classrooms.set(classId, { ref: classroomRef, data: classroom });
                        classSessions.set(classId, await readClassSessionsInTransaction(tx, db, classId));
                    }
                    for (const [sid, session] of existingSessionsMap) {
                        if (cleanOptionalString(session.teacherUid) === 'all') {
                            const primaryTeacher = cleanOptionalString(classrooms.get(session.classId)?.data?.primaryTeacherUid, callerUid);
                            existingSessionsMap.set(sid, normalizeScheduledSession({ ...session, teacherUid: primaryTeacher }));
                        }
                    }
                    return {
                        teacherUids: Array.from(existingSessionsMap.values()).map((session) => session.teacherUid),
                        state: { existingSessionsMap, classrooms, classSessions, classroomAccessMap }
                    };
                },
                commit: async ({ tx, state, teacherUids, teacherSessionsByUid, operationId }) => {
                    const projection = buildBulkRescheduleProjection({
                        moves,
                        existingSessionsMap: state.existingSessionsMap,
                        classroomAccessMap: state.classroomAccessMap,
                        outsideSessions: Array.from(teacherSessionsByUid.values()).flat(),
                        callerUid,
                        operationId,
                        dryRun: false,
                        undoOf
                    });
                    const touchedClassIds = Array.from(new Set(projection.moved.map((moved) => moved.classId).filter(Boolean))).sort();
                    if (projection.moved.length + touchedClassIds.length + teacherUids.length + 1 > 495) {
                        failSchedulingOperation(400, 'TOO_MANY_SCHEDULE_WRITES', 'Bulk reschedule is too large for one atomic operation. Narrow the move selection.');
                    }
                    const patches = new Map();
                    for (const moved of projection.moved) {
                        const previous = state.existingSessionsMap.get(moved.sessionId);
                        const patch = {
                            ...moved.patch,
                            teacherUid: previous?.teacherUid || callerUid,
                            version: Number(previous?.version || 1) + 1,
                            updatedAt: serverTimestamp(),
                            updatedBy: callerUid
                        };
                        patches.set(moved.sessionId, patch);
                        tx.set(db.collection(CRM_SCHEDULED_SESSIONS).doc(moved.sessionId), patch, { merge: true });
                    }
                    let lastScheduleState = null;
                    for (const classId of touchedClassIds) {
                        const classroom = state.classrooms.get(classId);
                        if (!classroom) continue;
                        const postSessions = (state.classSessions.get(classId) || []).map((session) => patches.has(session.sessionId)
                            ? normalizeScheduledSession({ ...session, ...patches.get(session.sessionId) })
                            : session);
                        lastScheduleState = stageClassroomScheduleState(tx, classroom.ref, classroom.data, postSessions);
                    }
                    return {
                        committedIds: projection.moved.map((moved) => moved.sessionId),
                        result: {
                            ...projection,
                            scheduleSummary: lastScheduleState?.scheduleSummary || null,
                            scheduleVersion: lastScheduleState?.scheduleConfig?.scheduleVersion || null
                        }
                    };
                }
            });
            outcome = await auditCommitted(outcome, {
                action: 'teacher.scheduler.bulk_reschedule',
                entityType: 'scheduled_session',
                entityId: outcome.operationId,
                metadata: {
                    movedCount: outcome.moved?.length || 0,
                    skippedCount: outcome.skipped?.length || 0,
                    undoOf
                }
            }, req.user);
            return sendSuccess(res, outcome, `Bulk rescheduled ${outcome.moved?.length || 0} session(s).`);
        } catch (error) {
            return sendSchedulingOperationFailure(sendError, res, error, 'TEACHER_BULK_RESCHEDULE_ERROR', 'Failed to bulk reschedule sessions.');
        }
    });

    return router;
};
