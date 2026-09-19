const {
    CRM_CLASSROOMS,
    CRM_SCHEDULED_SESSIONS
} = require('../../crm/collections');
const {
    buildClassroomPatchData,
    mapClassroomRecord,
    normalizeScheduleConfig
} = require('../../crm/course-service');
const {
    buildAddSessionPreview,
    buildRegenerationCommitPlan,
    buildRegenerationPreview,
    buildReplacementPlan,
    buildReplaceSessionPreview,
    buildScheduleSummary,
    buildScheduledSessionWriteData,
    buildSeedSessions,
    deriveContractCountState,
    normalizeScheduledSession
} = require('../../crm/scheduling-service');
const {
    SchedulingOperationError,
    executeSchedulingOperation,
    normalizeSchedulingOperationId
} = require('../../crm/scheduling-operation-service');
const {
    buildScheduledSessionCanonicalBackfill
} = require('../../crm/scheduler-migration-service');

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

function isLockedSession(session) {
    return String(session?.lockState || 'unlocked') === 'hard_locked'
        || String(session?.status || 'scheduled') === 'cancelled';
}

function isActiveContractedSession(session) {
    return String(session?.unitType || 'contracted') === 'contracted'
        && String(session?.status || 'scheduled') !== 'cancelled';
}

function readExpectedScheduleVersion(payload) {
    const numeric = Number(payload?.expectedScheduleVersion);
    return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

function resolveAdminTargetTeacherUid(requestedTeacherUid, classroomFallback, existingFallback = null) {
    const requested = cleanOptionalString(requestedTeacherUid);
    if (requested && requested !== 'all') return requested;
    const existing = cleanOptionalString(existingFallback);
    if (existing && existing !== 'all') return existing;
    const classroom = cleanOptionalString(classroomFallback);
    if (classroom && classroom !== 'all') return classroom;
    return null;
}

function splitDateTime(value) {
    const [datePart, timePart = '00:00:00'] = String(value || '').split('T');
    return {
        targetLocalDate: cleanOptionalString(datePart),
        targetLocalTime: cleanOptionalString(timePart.slice(0, 5))
    };
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

async function listCollectionSessions(db, queryBuilder) {
    let query = db.collection(CRM_SCHEDULED_SESSIONS);
    if (typeof queryBuilder === 'function') {
        query = queryBuilder(query) || query;
    }
    const snap = await query.get();
    return snap.docs.map((doc) => normalizeScheduledSession({ sessionId: doc.id, ...doc.data() }));
}

async function listClassSessions(db, classId) {
    return listCollectionSessions(db, (query) => query.where('classId', '==', classId));
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
    return (Array.isArray(teacherSessions) ? teacherSessions : []).find((session) => {
        if (ignoredSessionIds.includes(cleanOptionalString(session?.sessionId))) return false;
        return sessionsOverlapUtc(session, normalizedProposal);
    }) || null;
}

async function listRawClassSessions(db, classId) {
    const snap = await db.collection(CRM_SCHEDULED_SESSIONS).where('classId', '==', classId).get();
    return snap.docs.map((doc) => ({ sessionId: doc.id, ...doc.data() }));
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

    const effectiveScheduleConfig = options.bumpVersion
        ? { ...scheduleConfig, scheduleVersion: nextScheduleVersion(scheduleConfig) }
        : scheduleConfig;
    const sessions = options.sessions || await listClassSessions(db, classId);
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

function buildPreviewContext(classroom, reqBody, sessions) {
    const scheduleConfig = classroom.scheduleConfig || {};
    const intent = extractLocalIntent(
        reqBody,
        scheduleConfig.timezone || null,
        scheduleConfig.sessionMinutes || null
    );

    return {
        targetLocalDate: intent.targetLocalDate,
        targetLocalTime: intent.targetLocalTime,
        timezone: intent.timezone,
        durationMinutes: intent.durationMinutes || scheduleConfig.sessionMinutes || null,
        totalInstructionMinutes: Number(scheduleConfig.totalInstructionMinutes || 0) || null,
        targetSessionCount: Number(scheduleConfig.targetSessionCount || 0) || null,
        sessionMinutes: Number(scheduleConfig.sessionMinutes || 0) || null,
        scheduleVersion: Number(scheduleConfig.scheduleVersion || 1) || 1,
        sessions
    };
}

function buildRegenerationConflictSessions(existingSessions, teacherConflictSessions) {
    return {
        existingSessions: Array.isArray(existingSessions) ? existingSessions : [],
        teacherConflictSessions: Array.isArray(teacherConflictSessions) ? teacherConflictSessions : []
    };
}

module.exports = function registerSchedulingRoutes(router, deps) {
    const { db, sendSuccess, sendError, requireAdminHandlers, serverTimestamp, writeAuditLog } = deps;
    const runSchedulingOperation = deps.executeSchedulingOperation || executeSchedulingOperation;

    async function auditCommitted(outcome, entry, user) {
        if (outcome.idempotentReplay || typeof writeAuditLog !== 'function') return outcome;
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

    router.get('/scheduler/workspace', ...requireAdminHandlers, async (req, res) => {
        try {
            const from = cleanOptionalString(req.query?.from);
            const to = cleanOptionalString(req.query?.to);
            const teacherUid = cleanOptionalString(req.query?.teacherUid);
            const isAllTeachers = !teacherUid || teacherUid === 'all';

            const [classroomSnap, sessions] = await Promise.all([
                db.collection(CRM_CLASSROOMS).orderBy('createdAt', 'desc').limit(200).get(),
                listCollectionSessions(db)
            ]);

            const filteredSessions = sessions
                .filter((session) => isAllTeachers || cleanOptionalString(session.teacherUid) === teacherUid)
                .filter((session) => !from || String(session.scheduledLocalDate || '') >= from)
                .filter((session) => !to || String(session.scheduledLocalDate || '') <= to)
                .sort((left, right) => String(left.scheduledStartAtUtc || '').localeCompare(String(right.scheduledStartAtUtc || '')));

            return sendSuccess(res, {
                classrooms: classroomSnap.docs.map((doc) => mapClassroomRecord(doc, doc.id)),
                sessions: filteredSessions
            });
        } catch (error) {
            return sendError(res, 500, 'SCHEDULER_WORKSPACE_ERROR', 'Failed to load scheduler workspace.', error?.message || error);
        }
    });

    router.patch('/classrooms/:classId/schedule-config', ...requireAdminHandlers, async (req, res) => {
        try {
            const classId = cleanOptionalString(req.params.classId);
            if (!classId) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Missing classId.');
            }

            const ref = db.collection(CRM_CLASSROOMS).doc(classId);
            const snap = await ref.get();
            if (!snap.exists) {
                return sendError(res, 404, 'CLASSROOM_NOT_FOUND', 'Classroom not found.');
            }

            const next = buildClassroomPatchData(snap.data() || {}, req.body || {}, {
                user: req.user,
                serverTimestamp
            });
            const scheduleState = await syncClassroomScheduleState(db, classId, {
                classroomSnap: snap,
                scheduleConfigPatch: next.scheduleConfig,
                bumpVersion: true,
                rootPatch: {
                    updatedAt: serverTimestamp(),
                    updatedBy: req.user?.uid || null
                }
            });
            await writeAuditLog?.({
                action: 'schedule_config.update',
                entityType: 'classroom',
                entityId: classId
            }, { user: req.user });

            const updatedSnap = await ref.get();
            return sendSuccess(res, {
                classroom: mapClassroomRecord(updatedSnap, classId),
                scheduleSummary: scheduleState?.scheduleSummary || null,
                scheduleVersion: scheduleState?.scheduleConfig?.scheduleVersion || null
            }, 'Schedule config updated.');
        } catch (error) {
            return sendError(res, 500, 'UPDATE_SCHEDULE_CONFIG_ERROR', 'Failed to update schedule config.', error?.message || error);
        }
    });

    router.post('/classrooms/:classId/sessions/seed', ...requireAdminHandlers, async (req, res) => {
        try {
            const classId = cleanOptionalString(req.params.classId);
            if (!classId) return sendError(res, 400, 'VALIDATION_ERROR', 'Missing classId.');
            const outcome = await runSchedulingOperation({
                db,
                operationId: requestOperationId(req, 'admin-seed'),
                actorUid: cleanOptionalString(req.user?.uid),
                operationType: 'admin.session.seed',
                payload: requestOperationPayload(req, { classId }),
                serverTimestamp,
                prepare: async ({ tx }) => {
                    const classroomRef = db.collection(CRM_CLASSROOMS).doc(classId);
                    const classroomSnap = await tx.get(classroomRef);
                    if (!classroomSnap.exists) failSchedulingOperation(404, 'CLASSROOM_NOT_FOUND', 'Classroom not found.');
                    const classroom = classroomSnap.data() || {};
                    const existingSessions = await readClassSessionsInTransaction(tx, db, classId);
                    if (existingSessions.some(isActiveContractedSession)) {
                        failSchedulingOperation(
                            409,
                            'SCHEDULE_ALREADY_SEEDED',
                            'This class already has scheduled contracted sessions. Use schedule regeneration for future changes.'
                        );
                    }
                    const teacherUid = resolveAdminTargetTeacherUid(req.body?.teacherUid, classroom.primaryTeacherUid);
                    return {
                        teacherUids: [teacherUid],
                        state: { classroomRef, classroom, existingSessions, teacherUid }
                    };
                },
                commit: async ({ tx, state, teacherSessionsByUid, operationId }) => {
                    const scheduleConfig = state.classroom.scheduleConfig || {};
                    let sessions;
                    try {
                        sessions = buildSeedSessions({
                            classId,
                            courseId: state.classroom.courseId || null,
                            teacherUid: state.teacherUid || null,
                            sessionMinutes: scheduleConfig.sessionMinutes,
                            timezone: scheduleConfig.timezone,
                            startDate: req.body?.startDate,
                            endDate: req.body?.endDate,
                            weekdayNumbers: req.body?.weekdayNumbers,
                            startTime: req.body?.startTime,
                            targetSessionCount: scheduleConfig.targetSessionCount,
                            seedBatchId: cleanOptionalString(req.body?.seedBatchId, operationId)
                        });
                    } catch (error) {
                        failSchedulingOperation(400, 'VALIDATION_ERROR', error.message);
                    }
                    if (!sessions.length || sessions.length + 3 > 500) {
                        failSchedulingOperation(400, 'VALIDATION_ERROR', 'Schedule must contain between 1 and 497 lessons.');
                    }

                    const workingTeacherSessions = [...(teacherSessionsByUid.get(state.teacherUid) || [])];
                    for (const session of sessions) {
                        const conflict = findTeacherConflict(workingTeacherSessions, session);
                        if (conflict) {
                            failSchedulingOperation(
                                409,
                                'TEACHER_SCHEDULE_CONFLICT',
                                'The proposed lessons overlap an existing or another proposed lesson.'
                            );
                        }
                        workingTeacherSessions.push(session);
                    }

                    const createdSessions = sessions.map((session) => {
                        const ref = db.collection(CRM_SCHEDULED_SESSIONS).doc();
                        const data = {
                            ...session,
                            createdAt: serverTimestamp(),
                            createdBy: req.user?.uid || null,
                            updatedAt: serverTimestamp(),
                            updatedBy: req.user?.uid || null
                        };
                        tx.set(ref, data);
                        return { sessionId: ref.id, ...normalizeScheduledSession(data) };
                    });
                    const scheduleState = stageClassroomScheduleState(
                        tx,
                        state.classroomRef,
                        state.classroom,
                        state.existingSessions.concat(createdSessions)
                    );
                    return {
                        committedIds: createdSessions.map((session) => session.sessionId),
                        result: {
                            count: createdSessions.length,
                            scheduleSummary: scheduleState?.scheduleSummary || null,
                            scheduleVersion: scheduleState?.scheduleConfig?.scheduleVersion || null
                        }
                    };
                }
            });
            return sendSuccess(res, outcome, 'Sessions seeded.');
        } catch (error) {
            return sendSchedulingOperationFailure(sendError, res, error, 'SEED_SCHEDULE_ERROR', 'Failed to seed schedule.');
        }
    });

    router.post('/classrooms/:classId/sessions/add-preview', ...requireAdminHandlers, async (req, res) => {
        try {
            const classId = cleanOptionalString(req.params.classId);
            const classroomSnap = await db.collection(CRM_CLASSROOMS).doc(classId).get();
            if (!classroomSnap.exists) {
                return sendError(res, 404, 'CLASSROOM_NOT_FOUND', 'Classroom not found.');
            }
            const classroom = classroomSnap.data() || {};
            const sessions = await listClassSessions(db, classId);
            const previewContext = buildPreviewContext(classroom, req.body || {}, sessions);
            const preview = buildAddSessionPreview({
                classId,
                courseId: classroom.courseId || null,
                teacherUid: resolveAdminTargetTeacherUid(req.body?.teacherUid, classroom.primaryTeacherUid),
                totalInstructionMinutes: previewContext.totalInstructionMinutes,
                targetSessionCount: previewContext.targetSessionCount,
                sessionMinutes: previewContext.sessionMinutes,
                timezone: previewContext.timezone,
                targetLocalDate: previewContext.targetLocalDate,
                targetLocalTime: previewContext.targetLocalTime,
                durationMinutes: previewContext.durationMinutes,
                addMode: cleanOptionalString(req.body?.addMode, 'once'),
                recurringCount: toPositiveInteger(req.body?.recurringCount, 1),
                existingSessions: previewContext.sessions
            });
            return sendSuccess(res, preview, 'Add preview ready.');
        } catch (error) {
            return sendError(res, 500, 'ADD_PREVIEW_ERROR', 'Failed to preview add sessions.', error?.message || error);
        }
    });

    router.post('/classrooms/:classId/sessions/add-batch', ...requireAdminHandlers, async (req, res) => {
        try {
            const classId = cleanOptionalString(req.params.classId);
            if (!classId) return sendError(res, 400, 'VALIDATION_ERROR', 'Missing classId.');
            let outcome = await runSchedulingOperation({
                db,
                operationId: requestOperationId(req, 'admin-add-batch'),
                actorUid: cleanOptionalString(req.user?.uid),
                operationType: 'admin.session.add_batch',
                payload: requestOperationPayload(req, { classId }),
                serverTimestamp,
                prepare: async ({ tx }) => {
                    const classroomRef = db.collection(CRM_CLASSROOMS).doc(classId);
                    const classroomSnap = await tx.get(classroomRef);
                    if (!classroomSnap.exists) failSchedulingOperation(404, 'CLASSROOM_NOT_FOUND', 'Classroom not found.');
                    const classroom = classroomSnap.data() || {};
                    const sessions = await readClassSessionsInTransaction(tx, db, classId);
                    const teacherUid = resolveAdminTargetTeacherUid(req.body?.teacherUid, classroom.primaryTeacherUid);
                    return {
                        teacherUids: [teacherUid],
                        state: { classroomRef, classroom, sessions, teacherUid }
                    };
                },
                commit: async ({ tx, state, teacherSessionsByUid }) => {
                    const previewContext = buildPreviewContext(state.classroom, req.body || {}, state.sessions);
                    const preview = buildAddSessionPreview({
                        classId,
                        courseId: state.classroom.courseId || null,
                        teacherUid: state.teacherUid,
                        totalInstructionMinutes: previewContext.totalInstructionMinutes,
                        targetSessionCount: previewContext.targetSessionCount,
                        sessionMinutes: previewContext.sessionMinutes,
                        timezone: previewContext.timezone,
                        targetLocalDate: previewContext.targetLocalDate,
                        targetLocalTime: previewContext.targetLocalTime,
                        durationMinutes: previewContext.durationMinutes,
                        addMode: cleanOptionalString(req.body?.addMode, 'once'),
                        recurringCount: toPositiveInteger(req.body?.recurringCount, 1),
                        existingSessions: previewContext.sessions
                    });
                    if (!preview.canCommit) {
                        failSchedulingOperation(409, 'NO_VALID_OCCURRENCES', 'No valid occurrences can be created.');
                    }

                    const createdSessions = [];
                    const skippedOccurrences = [...preview.blockedOccurrences];
                    const workingTeacherSessions = [...(teacherSessionsByUid.get(state.teacherUid) || [])];
                    for (const occurrence of preview.validOccurrences) {
                        const conflict = findTeacherConflict(workingTeacherSessions, occurrence);
                        if (conflict) {
                            skippedOccurrences.push({
                                targetLocalDate: occurrence.scheduledLocalDate,
                                targetLocalTime: occurrence.scheduledLocalTime,
                                reasonCode: 'teacher_conflict',
                                reasonMessage: `Teacher conflict with session ${conflict.sessionId}.`
                            });
                            continue;
                        }
                        const ref = db.collection(CRM_SCHEDULED_SESSIONS).doc();
                        const payload = {
                            ...occurrence,
                            createdAt: serverTimestamp(),
                            createdBy: req.user?.uid || null,
                            updatedAt: serverTimestamp(),
                            updatedBy: req.user?.uid || null
                        };
                        tx.set(ref, payload);
                        const created = { sessionId: ref.id, ...normalizeScheduledSession(payload) };
                        createdSessions.push(created);
                        workingTeacherSessions.push(created);
                    }
                    const scheduleState = stageClassroomScheduleState(
                        tx,
                        state.classroomRef,
                        state.classroom,
                        state.sessions.concat(createdSessions)
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
                action: 'session.add_batch',
                entityType: 'classroom',
                entityId: classId,
                metadata: {
                    createdCount: outcome.createdSessions?.length || 0,
                    skippedCount: outcome.skippedOccurrences?.length || 0
                }
            }, req.user);
            return sendSuccess(res, outcome, 'Sessions created.');
        } catch (error) {
            return sendSchedulingOperationFailure(sendError, res, error, 'ADD_BATCH_ERROR', 'Failed to create sessions.');
        }
    });

    router.post('/classrooms/:classId/sessions/add', ...requireAdminHandlers, async (req, res) => {
        try {
            const classId = cleanOptionalString(req.params.classId);
            if (!classId) return sendError(res, 400, 'VALIDATION_ERROR', 'Missing classId.');
            let outcome = await runSchedulingOperation({
                db,
                operationId: requestOperationId(req, 'admin-add'),
                actorUid: cleanOptionalString(req.user?.uid),
                operationType: 'admin.session.add',
                payload: requestOperationPayload(req, { classId }),
                serverTimestamp,
                prepare: async ({ tx }) => {
                    const classroomRef = db.collection(CRM_CLASSROOMS).doc(classId);
                    const classroomSnap = await tx.get(classroomRef);
                    if (!classroomSnap.exists) failSchedulingOperation(404, 'CLASSROOM_NOT_FOUND', 'Classroom not found.');
                    const classroom = classroomSnap.data() || {};
                    const sessions = await readClassSessionsInTransaction(tx, db, classId);
                    const teacherUid = resolveAdminTargetTeacherUid(req.body?.teacherUid, classroom.primaryTeacherUid);
                    return {
                        teacherUids: [teacherUid],
                        state: { classroomRef, classroom, sessions, teacherUid }
                    };
                },
                commit: async ({ tx, state, teacherSessionsByUid }) => {
                    const previewContext = buildPreviewContext(state.classroom, req.body || {}, state.sessions);
                    const preview = buildAddSessionPreview({
                        classId,
                        courseId: state.classroom.courseId || null,
                        teacherUid: state.teacherUid,
                        totalInstructionMinutes: previewContext.totalInstructionMinutes,
                        targetSessionCount: previewContext.targetSessionCount,
                        sessionMinutes: previewContext.sessionMinutes,
                        timezone: previewContext.timezone,
                        targetLocalDate: previewContext.targetLocalDate,
                        targetLocalTime: previewContext.targetLocalTime,
                        durationMinutes: previewContext.durationMinutes,
                        addMode: 'once',
                        recurringCount: 1,
                        existingSessions: previewContext.sessions
                    });
                    if (!preview.canCommit || !preview.validOccurrences.length) {
                        failSchedulingOperation(409, 'NO_VALID_OCCURRENCES', 'No valid occurrences can be created.');
                    }
                    const occurrence = preview.validOccurrences[0];
                    const conflict = findTeacherConflict(teacherSessionsByUid.get(state.teacherUid) || [], occurrence);
                    if (conflict) {
                        failSchedulingOperation(409, 'teacher_conflict', `Teacher conflict with session ${conflict.sessionId}.`);
                    }

                    const ref = db.collection(CRM_SCHEDULED_SESSIONS).doc();
                    const payload = {
                        ...occurrence,
                        createdAt: serverTimestamp(),
                        createdBy: req.user?.uid || null,
                        updatedAt: serverTimestamp(),
                        updatedBy: req.user?.uid || null
                    };
                    tx.set(ref, payload);
                    const scheduleState = stageClassroomScheduleState(
                        tx,
                        state.classroomRef,
                        state.classroom,
                        state.sessions.concat(normalizeScheduledSession({ sessionId: ref.id, ...payload }))
                    );
                    return {
                        committedIds: [ref.id],
                        result: {
                            sessionId: ref.id,
                            scheduleSummary: scheduleState?.scheduleSummary || null,
                            scheduleVersion: scheduleState?.scheduleConfig?.scheduleVersion || null
                        }
                    };
                }
            });
            outcome = await auditCommitted(outcome, {
                action: 'session.add',
                entityType: 'classroom',
                entityId: classId,
                metadata: { sessionId: outcome.sessionId }
            }, req.user);
            return sendSuccess(res, outcome, 'Session added.');
        } catch (error) {
            return sendSchedulingOperationFailure(sendError, res, error, 'ADD_SESSION_ERROR', 'Failed to add session.');
        }
    });

    router.post('/classrooms/:classId/sessions/replace-preview', ...requireAdminHandlers, async (req, res) => {
        try {
            const classId = cleanOptionalString(req.params.classId);
            const classroomSnap = await db.collection(CRM_CLASSROOMS).doc(classId).get();
            if (!classroomSnap.exists) {
                return sendError(res, 404, 'CLASSROOM_NOT_FOUND', 'Classroom not found.');
            }
            const classroom = classroomSnap.data() || {};
            const scheduleConfig = classroom.scheduleConfig || {};
            const sessions = await listClassSessions(db, classId);
            const intent = extractLocalIntent(req.body || {}, scheduleConfig.timezone || null, scheduleConfig.sessionMinutes || null);
            const preview = buildReplaceSessionPreview({
                classId,
                targetLocalDate: intent.targetLocalDate,
                targetLocalTime: intent.targetLocalTime,
                timezone: intent.timezone,
                durationMinutes: intent.durationMinutes,
                existingSessions: sessions,
                totalInstructionMinutes: Number(scheduleConfig.totalInstructionMinutes || 0) || null,
                targetSessionCount: Number(scheduleConfig.targetSessionCount || 0) || null,
                sessionMinutes: Number(scheduleConfig.sessionMinutes || 0) || null
            });
            return sendSuccess(res, preview, 'Replace preview ready.');
        } catch (error) {
            return sendError(res, 500, 'REPLACE_PREVIEW_ERROR', 'Failed to preview replacement.', error?.message || error);
        }
    });

    router.post('/classrooms/:classId/sessions/replace', ...requireAdminHandlers, async (req, res) => {
        try {
            const classId = cleanOptionalString(req.params.classId);
            const replacedSessionId = cleanOptionalString(req.body?.replacedSessionId);
            if (!classId || !replacedSessionId) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'classId and replacedSessionId are required.');
            }
            let outcome = await runSchedulingOperation({
                db,
                operationId: requestOperationId(req, 'admin-replace'),
                actorUid: cleanOptionalString(req.user?.uid),
                operationType: 'admin.session.replace',
                payload: requestOperationPayload(req, { classId }),
                serverTimestamp,
                prepare: async ({ tx }) => {
                    const classroomRef = db.collection(CRM_CLASSROOMS).doc(classId);
                    const replacedSessionRef = db.collection(CRM_SCHEDULED_SESSIONS).doc(replacedSessionId);
                    const classroomSnap = await tx.get(classroomRef);
                    const replacedSessionSnap = await tx.get(replacedSessionRef);
                    if (!classroomSnap.exists) failSchedulingOperation(404, 'CLASSROOM_NOT_FOUND', 'Classroom not found.');
                    if (!replacedSessionSnap.exists) failSchedulingOperation(404, 'SESSION_NOT_FOUND', 'Replaced session not found.');
                    const classroom = classroomSnap.data() || {};
                    const replacedSession = normalizeScheduledSession({ sessionId: replacedSessionId, ...(replacedSessionSnap.data() || {}) });
                    if (cleanOptionalString(replacedSession.classId) !== classId) {
                        failSchedulingOperation(409, 'SESSION_NOT_ELIGIBLE', 'Selected session does not belong to this classroom.');
                    }
                    if (isLockedSession(replacedSession)) {
                        failSchedulingOperation(409, 'SESSION_LOCKED', 'Locked sessions cannot be replaced.');
                    }
                    const sessions = await readClassSessionsInTransaction(tx, db, classId);
                    const teacherUid = resolveAdminTargetTeacherUid(
                        req.body?.teacherUid,
                        classroom.primaryTeacherUid,
                        replacedSession.teacherUid
                    );
                    return {
                        teacherUids: [replacedSession.teacherUid, teacherUid],
                        state: { classroomRef, replacedSessionRef, classroom, replacedSession, sessions, teacherUid }
                    };
                },
                commit: async ({ tx, state, teacherSessionsByUid }) => {
                    const scheduleConfig = state.classroom.scheduleConfig || {};
                    const intent = extractLocalIntent(
                        req.body || {},
                        scheduleConfig.timezone || state.replacedSession.timezone || null,
                        scheduleConfig.sessionMinutes || state.replacedSession.durationMinutes || null
                    );
                    const preview = buildReplaceSessionPreview({
                        classId,
                        targetLocalDate: intent.targetLocalDate,
                        targetLocalTime: intent.targetLocalTime,
                        timezone: intent.timezone,
                        durationMinutes: intent.durationMinutes,
                        existingSessions: state.sessions,
                        totalInstructionMinutes: Number(scheduleConfig.totalInstructionMinutes || 0) || null,
                        targetSessionCount: Number(scheduleConfig.targetSessionCount || 0) || null,
                        sessionMinutes: Number(scheduleConfig.sessionMinutes || 0) || null
                    });
                    const eligible = preview.eligibleSessions.find((session) => String(session.sessionId || '') === replacedSessionId);
                    if (!eligible) {
                        failSchedulingOperation(
                            409,
                            'SESSION_NOT_ELIGIBLE',
                            'Selected session is not eligible for replacement.',
                            preview.ineligibleReasons
                        );
                    }
                    const replacementWindow = buildScheduledSessionWriteData({}, {
                        targetLocalDate: intent.targetLocalDate,
                        targetLocalTime: intent.targetLocalTime,
                        timezone: intent.timezone,
                        durationMinutes: intent.durationMinutes
                    });
                    const replacement = buildReplacementPlan({
                        replacementSession: {
                            classId,
                            courseId: state.classroom.courseId || null,
                            teacherUid: state.teacherUid,
                            ...replacementWindow
                        },
                        replacedSession: state.replacedSession
                    });
                    const conflict = findTeacherConflict(
                        teacherSessionsByUid.get(state.teacherUid) || [],
                        replacement.nextSession,
                        [replacedSessionId]
                    );
                    if (conflict) {
                        failSchedulingOperation(409, 'teacher_conflict', `Teacher conflict with session ${conflict.sessionId}.`);
                    }

                    const replacementRef = db.collection(CRM_SCHEDULED_SESSIONS).doc();
                    const replacementData = {
                        ...replacement.nextSession,
                        createdAt: serverTimestamp(),
                        createdBy: req.user?.uid || null,
                        updatedAt: serverTimestamp(),
                        updatedBy: req.user?.uid || null
                    };
                    const cancelData = {
                        ...replacement.cancelPatch,
                        replacementSessionId: replacementRef.id,
                        updatedAt: serverTimestamp(),
                        updatedBy: req.user?.uid || null
                    };
                    tx.set(replacementRef, replacementData);
                    tx.set(state.replacedSessionRef, cancelData, { merge: true });
                    const postSessions = state.sessions.map((session) => session.sessionId === replacedSessionId
                        ? normalizeScheduledSession({ ...session, ...cancelData })
                        : session)
                        .concat(normalizeScheduledSession({ sessionId: replacementRef.id, ...replacementData }));
                    const scheduleState = stageClassroomScheduleState(
                        tx,
                        state.classroomRef,
                        state.classroom,
                        postSessions
                    );
                    return {
                        committedIds: [replacedSessionId, replacementRef.id],
                        result: {
                            sessionId: replacementRef.id,
                            scheduleSummary: scheduleState?.scheduleSummary || null,
                            scheduleVersion: scheduleState?.scheduleConfig?.scheduleVersion || null
                        }
                    };
                }
            });
            outcome = await auditCommitted(outcome, {
                action: 'session.replace',
                entityType: 'classroom',
                entityId: classId,
                metadata: { replacedSessionId, replacementSessionId: outcome.sessionId }
            }, req.user);
            return sendSuccess(res, outcome, 'Session replaced.');
        } catch (error) {
            return sendSchedulingOperationFailure(sendError, res, error, 'REPLACE_SESSION_ERROR', 'Failed to replace session.');
        }
    });

    router.patch('/sessions/:sessionId/reschedule', ...requireAdminHandlers, async (req, res) => {
        try {
            const sessionId = cleanOptionalString(req.params.sessionId);
            if (!sessionId) return sendError(res, 400, 'VALIDATION_ERROR', 'Missing sessionId.');
            let outcome = await runSchedulingOperation({
                db,
                operationId: requestOperationId(req, 'admin-reschedule'),
                actorUid: cleanOptionalString(req.user?.uid),
                operationType: 'admin.session.reschedule',
                payload: requestOperationPayload(req, { sessionId }),
                serverTimestamp,
                prepare: async ({ tx }) => {
                    const sessionRef = db.collection(CRM_SCHEDULED_SESSIONS).doc(sessionId);
                    const sessionSnap = await tx.get(sessionRef);
                    if (!sessionSnap.exists) failSchedulingOperation(404, 'SESSION_NOT_FOUND', 'Session not found.');
                    const existing = normalizeScheduledSession({ sessionId, ...(sessionSnap.data() || {}) });
                    if (isLockedSession(existing)) {
                        failSchedulingOperation(409, 'SESSION_LOCKED', 'Locked sessions cannot be rescheduled.');
                    }
                    const classId = cleanOptionalString(existing.classId);
                    const classroomRef = classId ? db.collection(CRM_CLASSROOMS).doc(classId) : null;
                    const classroomSnap = classroomRef ? await tx.get(classroomRef) : null;
                    const classroom = classroomSnap?.exists ? (classroomSnap.data() || {}) : {};
                    const sessions = classId ? await readClassSessionsInTransaction(tx, db, classId) : [existing];
                    const teacherUid = resolveAdminTargetTeacherUid(
                        req.body?.teacherUid,
                        classroom.primaryTeacherUid,
                        existing.teacherUid
                    );
                    return {
                        teacherUids: [existing.teacherUid, teacherUid],
                        state: { sessionRef, existing, classId, classroomRef, classroom, sessions, teacherUid }
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
                        teacherUid: state.teacherUid || null,
                        durationMinutes: intent.durationMinutes || state.existing.durationMinutes || null,
                        timezone: intent.timezone || state.existing.timezone || null,
                        version: Number(state.existing.version || 1) + 1,
                        updatedAt: serverTimestamp(),
                        updatedBy: req.user?.uid || null
                    };
                    const conflict = findTeacherConflict(
                        teacherSessionsByUid.get(state.teacherUid) || [],
                        next,
                        [sessionId]
                    );
                    if (conflict) {
                        failSchedulingOperation(409, 'teacher_conflict', `Teacher conflict with session ${conflict.sessionId}.`);
                    }
                    tx.set(state.sessionRef, next, { merge: true });
                    const postSessions = state.sessions.map((session) => session.sessionId === sessionId ? normalizeScheduledSession(next) : session);
                    const scheduleState = state.classroomRef && state.classroom
                        ? stageClassroomScheduleState(tx, state.classroomRef, state.classroom, postSessions)
                        : null;
                    return {
                        committedIds: [sessionId],
                        result: {
                            sessionId,
                            classId: state.classId || null,
                            scheduleSummary: scheduleState?.scheduleSummary || null,
                            scheduleVersion: scheduleState?.scheduleConfig?.scheduleVersion || null
                        }
                    };
                }
            });
            outcome = await auditCommitted(outcome, {
                action: 'session.reschedule',
                entityType: 'scheduled_session',
                entityId: sessionId,
                metadata: { classId: outcome.classId || null }
            }, req.user);
            return sendSuccess(res, outcome, 'Session rescheduled.');
        } catch (error) {
            return sendSchedulingOperationFailure(sendError, res, error, 'RESCHEDULE_SESSION_ERROR', 'Failed to reschedule session.');
        }
    });

    router.post('/sessions/:sessionId/cancel', ...requireAdminHandlers, async (req, res) => {
        try {
            const sessionId = cleanOptionalString(req.params.sessionId);
            if (!sessionId) return sendError(res, 400, 'VALIDATION_ERROR', 'Missing sessionId.');
            let outcome = await runSchedulingOperation({
                db,
                operationId: requestOperationId(req, 'admin-cancel'),
                actorUid: cleanOptionalString(req.user?.uid),
                operationType: 'admin.session.cancel',
                payload: requestOperationPayload(req, { sessionId }),
                serverTimestamp,
                prepare: async ({ tx }) => {
                    const sessionRef = db.collection(CRM_SCHEDULED_SESSIONS).doc(sessionId);
                    const sessionSnap = await tx.get(sessionRef);
                    if (!sessionSnap.exists) failSchedulingOperation(404, 'SESSION_NOT_FOUND', 'Session not found.');
                    const existing = normalizeScheduledSession({ sessionId, ...(sessionSnap.data() || {}) });
                    if (isLockedSession(existing)) {
                        failSchedulingOperation(409, 'SESSION_LOCKED', 'Locked sessions cannot be cancelled.');
                    }
                    const classId = cleanOptionalString(existing.classId);
                    const classroomRef = classId ? db.collection(CRM_CLASSROOMS).doc(classId) : null;
                    const classroomSnap = classroomRef ? await tx.get(classroomRef) : null;
                    const classroom = classroomSnap?.exists ? (classroomSnap.data() || {}) : {};
                    const sessions = classId ? await readClassSessionsInTransaction(tx, db, classId) : [existing];
                    return {
                        teacherUids: [existing.teacherUid],
                        state: { sessionRef, existing, classId, classroomRef, classroom, sessions }
                    };
                },
                commit: async ({ tx, state }) => {
                    const patch = {
                        status: 'cancelled',
                        contractCountState: deriveContractCountState({ ...state.existing, status: 'cancelled' }),
                        version: Number(state.existing.version || 1) + 1,
                        updatedAt: serverTimestamp(),
                        updatedBy: req.user?.uid || null
                    };
                    tx.set(state.sessionRef, patch, { merge: true });
                    const postSessions = state.sessions.map((session) => session.sessionId === sessionId
                        ? normalizeScheduledSession({ ...session, ...patch })
                        : session);
                    const scheduleState = state.classroomRef
                        ? stageClassroomScheduleState(tx, state.classroomRef, state.classroom, postSessions)
                        : null;
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
                action: 'session.cancel',
                entityType: 'scheduled_session',
                entityId: sessionId,
                metadata: { classId: outcome.classId || null }
            }, req.user);
            return sendSuccess(res, outcome, 'Session cancelled.');
        } catch (error) {
            return sendSchedulingOperationFailure(sendError, res, error, 'CANCEL_SESSION_ERROR', 'Failed to cancel session.');
        }
    });

    router.post('/classrooms/:classId/schedule/regenerate-preview', ...requireAdminHandlers, async (req, res) => {
        try {
            const classId = cleanOptionalString(req.params.classId);
            const classroomSnap = await db.collection(CRM_CLASSROOMS).doc(classId).get();
            if (!classroomSnap.exists) {
                return sendError(res, 404, 'CLASSROOM_NOT_FOUND', 'Classroom not found.');
            }

            const classroom = classroomSnap.data() || {};
            const scheduleConfig = classroom.scheduleConfig || {};
            const currentScheduleVersion = Number(scheduleConfig.scheduleVersion || 1) || 1;
            const expectedScheduleVersion = readExpectedScheduleVersion(req.body || {});
            if (!expectedScheduleVersion || expectedScheduleVersion !== currentScheduleVersion) {
                return sendError(res, 409, 'stale_schedule_version', 'The classroom schedule changed. Refresh and preview again.');
            }

            const [rawClassSessions, classSessions] = await Promise.all([
                listRawClassSessions(db, classId),
                listClassSessions(db, classId)
            ]);
            const teacherUid = resolveAdminTargetTeacherUid(req.body?.teacherUid, classroom.primaryTeacherUid);
            const teacherConflictSessions = teacherUid
                ? (await listCollectionSessions(db, (query) =>
                    query.where('teacherUid', '==', teacherUid).where('status', '==', 'scheduled')
                )).filter((session) => String(session.classId || '') !== classId)
                : [];
            const unresolvedSessionIds = rawClassSessions
                .map((session) => ({
                    sessionId: session.sessionId,
                    result: buildScheduledSessionCanonicalBackfill(session, scheduleConfig.timezone || null)
                }))
                .filter((entry) => entry.result.status === 'unresolved')
                .map((entry) => entry.sessionId);

            const preview = buildRegenerationPreview({
                classId,
                courseId: classroom.courseId || null,
                teacherUid,
                totalInstructionMinutes: Number(scheduleConfig.totalInstructionMinutes || 0) || null,
                currentTargetSessionCount: Number(scheduleConfig.targetSessionCount || 0) || null,
                timezone: scheduleConfig.timezone || 'UTC',
                regenerateFromDate: cleanOptionalString(req.body?.regenerateFromDate),
                sessionMinutes: Number(req.body?.sessionMinutes || 0) || null,
                seedWeekdays: req.body?.seedWeekdays,
                seedStartTime: cleanOptionalString(req.body?.seedStartTime),
                ...buildRegenerationConflictSessions(classSessions, teacherConflictSessions),
                unresolvedSessionIds
            });

            return sendSuccess(res, {
                ...preview,
                classroomScheduleVersion: currentScheduleVersion
            }, 'Regeneration preview ready.');
        } catch (error) {
            return sendError(res, 500, 'REGENERATE_PREVIEW_ERROR', 'Failed to preview schedule regeneration.', error?.message || error);
        }
    });

    router.post('/classrooms/:classId/schedule/regenerate', ...requireAdminHandlers, async (req, res) => {
        try {
            const classId = cleanOptionalString(req.params.classId);
            if (!classId) return sendError(res, 400, 'VALIDATION_ERROR', 'Missing classId.');
            let outcome = await runSchedulingOperation({
                db,
                operationId: requestOperationId(req, 'admin-regenerate'),
                actorUid: cleanOptionalString(req.user?.uid),
                operationType: 'admin.schedule.regenerate',
                payload: requestOperationPayload(req, { classId }),
                serverTimestamp,
                prepare: async ({ tx }) => {
                    const classroomRef = db.collection(CRM_CLASSROOMS).doc(classId);
                    const classroomSnap = await tx.get(classroomRef);
                    if (!classroomSnap.exists) failSchedulingOperation(404, 'CLASSROOM_NOT_FOUND', 'Classroom not found.');
                    const classroom = classroomSnap.data() || {};
                    const scheduleConfig = classroom.scheduleConfig || {};
                    const currentScheduleVersion = Number(scheduleConfig.scheduleVersion || 1) || 1;
                    const expectedScheduleVersion = readExpectedScheduleVersion(req.body || {});
                    if (!expectedScheduleVersion || expectedScheduleVersion !== currentScheduleVersion) {
                        failSchedulingOperation(409, 'stale_schedule_version', 'The classroom schedule changed. Refresh and preview again.');
                    }
                    const rawSnap = await tx.get(db.collection(CRM_SCHEDULED_SESSIONS).where('classId', '==', classId));
                    const rawClassSessions = rawSnap.docs.map((doc) => ({ sessionId: doc.id, ...doc.data() }));
                    const classSessions = rawClassSessions.map(normalizeScheduledSession);
                    const teacherUid = resolveAdminTargetTeacherUid(req.body?.teacherUid, classroom.primaryTeacherUid);
                    return {
                        teacherUids: [teacherUid, ...classSessions.map((session) => session.teacherUid)],
                        state: { classroomRef, classroom, scheduleConfig, rawClassSessions, classSessions, teacherUid }
                    };
                },
                commit: async ({ tx, state, teacherUids, teacherSessionsByUid }) => {
                    const teacherConflictSessions = (teacherSessionsByUid.get(state.teacherUid) || [])
                        .filter((session) => String(session.classId || '') !== classId);
                    const unresolvedSessionIds = state.rawClassSessions
                        .map((session) => ({
                            sessionId: session.sessionId,
                            result: buildScheduledSessionCanonicalBackfill(session, state.scheduleConfig.timezone || null)
                        }))
                        .filter((entry) => entry.result.status === 'unresolved')
                        .map((entry) => entry.sessionId);
                    const preview = buildRegenerationPreview({
                        classId,
                        courseId: state.classroom.courseId || null,
                        teacherUid: state.teacherUid,
                        totalInstructionMinutes: Number(state.scheduleConfig.totalInstructionMinutes || 0) || null,
                        currentTargetSessionCount: Number(state.scheduleConfig.targetSessionCount || 0) || null,
                        timezone: state.scheduleConfig.timezone || 'UTC',
                        regenerateFromDate: cleanOptionalString(req.body?.regenerateFromDate),
                        sessionMinutes: Number(req.body?.sessionMinutes || 0) || null,
                        seedWeekdays: req.body?.seedWeekdays,
                        seedStartTime: cleanOptionalString(req.body?.seedStartTime),
                        ...buildRegenerationConflictSessions(state.classSessions, teacherConflictSessions),
                        unresolvedSessionIds
                    });
                    if (!preview.canCommit) {
                        failSchedulingOperation(409, 'REGENERATE_BLOCKED', 'Schedule regeneration is blocked.', preview);
                    }
                    const commitPlan = buildRegenerationCommitPlan({
                        preview,
                        existingSessions: state.classSessions
                    });
                    if (commitPlan.cancelledSessions.length + commitPlan.createdSessions.length + teacherUids.length + 2 > 495) {
                        failSchedulingOperation(400, 'TOO_MANY_SCHEDULE_WRITES', 'Schedule regeneration is too large for one atomic operation. Narrow the regeneration range.');
                    }
                    const cancelledIds = commitPlan.cancelledSessions.map((session) => String(session.sessionId));
                    const cancelPatches = new Map();
                    for (const session of commitPlan.cancelledSessions) {
                        const patch = {
                            status: 'cancelled',
                            updatedAt: serverTimestamp(),
                            updatedBy: req.user?.uid || null,
                            version: Number(session.version || 1) + 1
                        };
                        cancelPatches.set(String(session.sessionId), patch);
                        tx.set(db.collection(CRM_SCHEDULED_SESSIONS).doc(String(session.sessionId)), patch, { merge: true });
                    }
                    const createdSessions = commitPlan.createdSessions.map((session) => {
                        const ref = db.collection(CRM_SCHEDULED_SESSIONS).doc();
                        tx.set(ref, {
                            ...session,
                            createdAt: serverTimestamp(),
                            createdBy: req.user?.uid || null,
                            updatedAt: serverTimestamp(),
                            updatedBy: req.user?.uid || null
                        });
                        return { sessionId: ref.id, ...session };
                    });
                    const postSessions = state.classSessions.map((session) => cancelPatches.has(session.sessionId)
                        ? normalizeScheduledSession({ ...session, ...cancelPatches.get(session.sessionId) })
                        : session)
                        .concat(createdSessions.map(normalizeScheduledSession));
                    const scheduleState = stageClassroomScheduleState(
                        tx,
                        state.classroomRef,
                        state.classroom,
                        postSessions,
                        {
                            scheduleConfigPatch: {
                                ...state.scheduleConfig,
                                sessionMinutes: Number(req.body?.sessionMinutes || 0) || state.scheduleConfig.sessionMinutes,
                                targetSessionCount: preview.nextTargetSessionCount,
                                seedWeekdays: Array.isArray(req.body?.seedWeekdays) ? req.body.seedWeekdays : state.scheduleConfig.seedWeekdays || [],
                                seedStartTime: cleanOptionalString(req.body?.seedStartTime) || state.scheduleConfig.seedStartTime || null,
                                lastRegeneratedAt: serverTimestamp(),
                                lastRegeneratedBy: req.user?.uid || null,
                                lastRegenerateFromDate: cleanOptionalString(req.body?.regenerateFromDate)
                            },
                            rootPatch: {
                                updatedAt: serverTimestamp(),
                                updatedBy: req.user?.uid || null
                            }
                        }
                    );
                    return {
                        committedIds: cancelledIds.concat(createdSessions.map((session) => session.sessionId)),
                        result: {
                            cancelledSessionIds: cancelledIds,
                            createdSessions,
                            scheduleConfig: scheduleState?.scheduleConfig || null,
                            scheduleSummary: scheduleState?.scheduleSummary || null
                        }
                    };
                }
            });
            outcome = await auditCommitted(outcome, {
                action: 'schedule.regenerate',
                entityType: 'classroom',
                entityId: classId,
                metadata: {
                    cancelledSessionIds: outcome.cancelledSessionIds || [],
                    createdCount: outcome.createdSessions?.length || 0
                }
            }, req.user);
            return sendSuccess(res, outcome, 'Future schedule regenerated.');
        } catch (error) {
            return sendSchedulingOperationFailure(sendError, res, error, 'REGENERATE_SCHEDULE_ERROR', 'Failed to regenerate future schedule.');
        }
    });
};
