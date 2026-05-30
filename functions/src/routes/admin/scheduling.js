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

async function listTeacherScheduledSessions(db, teacherUid) {
    const cleanedTeacherUid = cleanOptionalString(teacherUid);
    if (!cleanedTeacherUid) return [];
    return listCollectionSessions(db, (query) =>
        query.where('teacherUid', '==', cleanedTeacherUid).where('status', '==', 'scheduled')
    );
}

function mergeSessionsById(...sessionLists) {
    const merged = new Map();
    sessionLists.forEach((sessions) => {
        (Array.isArray(sessions) ? sessions : []).forEach((session) => {
            const sessionId = cleanOptionalString(session?.sessionId);
            if (!sessionId) return;
            if (!merged.has(sessionId)) {
                merged.set(sessionId, session);
            }
        });
    });
    return Array.from(merged.values());
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

async function syncClassroomScheduleSummary(db, classId) {
    return syncClassroomScheduleState(db, classId);
}

function nextScheduleVersion(scheduleConfig) {
    return Math.max(Number(scheduleConfig?.scheduleVersion || 0) + 1, 1);
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

async function ensureNoTeacherConflict(db, proposedSession, ignoredSessionIds = []) {
    const normalizedProposal = normalizeScheduledSession(proposedSession);
    const teacherUid = cleanOptionalString(normalizedProposal.teacherUid);
    if (!teacherUid) return;

    const proposedStartMs = new Date(normalizedProposal.scheduledStartAtUtc).getTime();
    const proposedEndMs = new Date(normalizedProposal.scheduledEndAtUtc).getTime();
    const snap = await db.collection(CRM_SCHEDULED_SESSIONS)
        .where('teacherUid', '==', teacherUid)
        .where('status', '==', 'scheduled')
        .get();

    for (const doc of snap.docs) {
        if (ignoredSessionIds.includes(doc.id)) continue;
        const current = normalizeScheduledSession({ sessionId: doc.id, ...doc.data() });
        const currentStartMs = new Date(current.scheduledStartAtUtc).getTime();
        const currentEndMs = new Date(current.scheduledEndAtUtc).getTime();
        const overlaps = proposedStartMs < currentEndMs && proposedEndMs > currentStartMs;
        if (overlaps) {
            throw new Error(`Teacher conflict with session ${doc.id}.`);
        }
    }
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

    router.get('/scheduler/workspace', ...requireAdminHandlers, async (req, res) => {
        try {
            const from = cleanOptionalString(req.query?.from);
            const to = cleanOptionalString(req.query?.to);
            const teacherUid = cleanOptionalString(req.query?.teacherUid);

            const [classroomSnap, sessions] = await Promise.all([
                db.collection(CRM_CLASSROOMS).orderBy('createdAt', 'desc').limit(200).get(),
                listCollectionSessions(db)
            ]);

            const filteredSessions = sessions
                .filter((session) => !teacherUid || cleanOptionalString(session.teacherUid) === teacherUid)
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
            const classroomSnap = await db.collection(CRM_CLASSROOMS).doc(classId).get();
            if (!classroomSnap.exists) {
                return sendError(res, 404, 'CLASSROOM_NOT_FOUND', 'Classroom not found.');
            }

            const classroom = classroomSnap.data() || {};
            const scheduleConfig = classroom.scheduleConfig || {};
            const existingSessions = await listClassSessions(db, classId);
            const existingContractedSessions = existingSessions.filter(isActiveContractedSession);
            if (existingContractedSessions.length) {
                return sendError(res, 409, 'SCHEDULE_ALREADY_SEEDED', 'This class already has scheduled contracted sessions. Use schedule regeneration for future changes.', {
                    existingSessionCount: existingContractedSessions.length
                });
            }
            const sessions = buildSeedSessions({
                classId,
                courseId: classroom.courseId || null,
                teacherUid: cleanOptionalString(req.body?.teacherUid) || classroom.primaryTeacherUid || null,
                sessionMinutes: scheduleConfig.sessionMinutes,
                timezone: scheduleConfig.timezone,
                startDate: cleanOptionalString(req.body?.startDate),
                weekdayNumbers: req.body?.weekdayNumbers,
                startTime: cleanOptionalString(req.body?.startTime),
                targetSessionCount: scheduleConfig.targetSessionCount,
                seedBatchId: cleanOptionalString(req.body?.seedBatchId) || `${classId}-${Date.now()}`
            });

            for (const session of sessions) {
                await ensureNoTeacherConflict(db, session);
                await db.collection(CRM_SCHEDULED_SESSIONS).doc().set({
                    ...session,
                    createdAt: serverTimestamp(),
                    createdBy: req.user?.uid || null,
                    updatedAt: serverTimestamp(),
                    updatedBy: req.user?.uid || null
                });
            }
            const scheduleState = await syncClassroomScheduleState(db, classId, { bumpVersion: true });
            return sendSuccess(res, {
                count: sessions.length,
                scheduleSummary: scheduleState?.scheduleSummary || null,
                scheduleVersion: scheduleState?.scheduleConfig?.scheduleVersion || null
            }, 'Sessions seeded.');
        } catch (error) {
            return sendError(res, 500, 'SEED_SCHEDULE_ERROR', 'Failed to seed schedule.', error?.message || error);
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
                teacherUid: cleanOptionalString(req.body?.teacherUid) || classroom.primaryTeacherUid || null,
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
                teacherUid: cleanOptionalString(req.body?.teacherUid) || classroom.primaryTeacherUid || null,
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
                return sendError(res, 409, 'NO_VALID_OCCURRENCES', 'No valid occurrences can be created.');
            }

            const createdSessions = [];
            const skippedOccurrences = [...preview.blockedOccurrences];
            for (const occurrence of preview.validOccurrences) {
                try {
                    await ensureNoTeacherConflict(db, occurrence);
                    const ref = db.collection(CRM_SCHEDULED_SESSIONS).doc();
                    const payload = {
                        ...occurrence,
                        createdAt: serverTimestamp(),
                        createdBy: req.user?.uid || null,
                        updatedAt: serverTimestamp(),
                        updatedBy: req.user?.uid || null
                    };
                    await ref.set(payload);
                    createdSessions.push({ sessionId: ref.id, ...normalizeScheduledSession(payload) });
                } catch (error) {
                    skippedOccurrences.push({
                        targetLocalDate: occurrence.scheduledLocalDate,
                        targetLocalTime: occurrence.scheduledLocalTime,
                        reasonCode: 'teacher_conflict',
                        reasonMessage: error?.message || 'Teacher conflict.'
                    });
                }
            }

            const scheduleState = await syncClassroomScheduleState(db, classId, { bumpVersion: true });
            await writeAuditLog?.({
                action: 'session.add_batch',
                entityType: 'classroom',
                entityId: classId,
                metadata: { createdCount: createdSessions.length, skippedCount: skippedOccurrences.length }
            }, { user: req.user });

            return sendSuccess(res, {
                createdSessions,
                skippedOccurrences,
                scheduleSummary: scheduleState?.scheduleSummary || null,
                scheduleVersion: scheduleState?.scheduleConfig?.scheduleVersion || null
            }, 'Sessions created.');
        } catch (error) {
            return sendError(res, 500, 'ADD_BATCH_ERROR', 'Failed to create sessions.', error?.message || error);
        }
    });

    router.post('/classrooms/:classId/sessions/add', ...requireAdminHandlers, async (req, res) => {
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
                teacherUid: cleanOptionalString(req.body?.teacherUid) || classroom.primaryTeacherUid || null,
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
                return sendError(res, 409, 'NO_VALID_OCCURRENCES', 'No valid occurrences can be created.');
            }
            const occurrence = preview.validOccurrences[0];
            try {
                await ensureNoTeacherConflict(db, occurrence);
            } catch (error) {
                return sendError(res, 409, 'teacher_conflict', error?.message || 'Teacher conflict.');
            }
            const ref = db.collection(CRM_SCHEDULED_SESSIONS).doc();
            await ref.set({
                ...occurrence,
                createdAt: serverTimestamp(),
                createdBy: req.user?.uid || null,
                updatedAt: serverTimestamp(),
                updatedBy: req.user?.uid || null
            });
            const scheduleState = await syncClassroomScheduleState(db, classId, { bumpVersion: true });
            return sendSuccess(res, {
                sessionId: ref.id,
                scheduleSummary: scheduleState?.scheduleSummary || null,
                scheduleVersion: scheduleState?.scheduleConfig?.scheduleVersion || null
            }, 'Session added.');
        } catch (error) {
            return sendError(res, 500, 'ADD_SESSION_ERROR', 'Failed to add session.', error?.message || error);
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

            const [classroomSnap, replacedSessionSnap, sessions] = await Promise.all([
                db.collection(CRM_CLASSROOMS).doc(classId).get(),
                db.collection(CRM_SCHEDULED_SESSIONS).doc(replacedSessionId).get(),
                listClassSessions(db, classId)
            ]);
            if (!classroomSnap.exists) {
                return sendError(res, 404, 'CLASSROOM_NOT_FOUND', 'Classroom not found.');
            }
            if (!replacedSessionSnap.exists) {
                return sendError(res, 404, 'SESSION_NOT_FOUND', 'Replaced session not found.');
            }

            const classroom = classroomSnap.data() || {};
            const scheduleConfig = classroom.scheduleConfig || {};
            const replacedSession = normalizeScheduledSession({ sessionId: replacedSessionId, ...(replacedSessionSnap.data() || {}) });
            if (isLockedSession(replacedSession)) {
                return sendError(res, 409, 'SESSION_LOCKED', 'Locked sessions cannot be replaced.');
            }

            const intent = extractLocalIntent(req.body || {}, scheduleConfig.timezone || replacedSession.timezone || null, scheduleConfig.sessionMinutes || replacedSession.durationMinutes || null);
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
            const eligible = preview.eligibleSessions.find((session) => String(session.sessionId || '') === replacedSessionId);
            if (!eligible) {
                return sendError(res, 409, 'SESSION_NOT_ELIGIBLE', 'Selected session is not eligible for replacement.', preview.ineligibleReasons);
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
                    courseId: classroom.courseId || null,
                    teacherUid: cleanOptionalString(req.body?.teacherUid) || classroom.primaryTeacherUid || replacedSession.teacherUid || null,
                    ...replacementWindow
                },
                replacedSession
            });

            await ensureNoTeacherConflict(db, replacement.nextSession, [replacedSessionId]);
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
            if (typeof db.batch === 'function') {
                const batch = db.batch();
                batch.set(replacementRef, replacementData);
                batch.set(db.collection(CRM_SCHEDULED_SESSIONS).doc(replacedSessionId), cancelData, { merge: true });
                await batch.commit();
            } else {
                await replacementRef.set(replacementData);
                await db.collection(CRM_SCHEDULED_SESSIONS).doc(replacedSessionId).set(cancelData, { merge: true });
            }

            const scheduleState = await syncClassroomScheduleState(db, classId, { bumpVersion: true });
            await writeAuditLog?.({
                action: 'session.replace',
                entityType: 'classroom',
                entityId: classId,
                metadata: { replacedSessionId, replacementSessionId: replacementRef.id }
            }, { user: req.user });

            return sendSuccess(res, {
                sessionId: replacementRef.id,
                scheduleSummary: scheduleState?.scheduleSummary || null,
                scheduleVersion: scheduleState?.scheduleConfig?.scheduleVersion || null
            }, 'Session replaced.');
        } catch (error) {
            return sendError(res, 500, 'REPLACE_SESSION_ERROR', 'Failed to replace session.', error?.message || error);
        }
    });

    router.patch('/sessions/:sessionId/reschedule', ...requireAdminHandlers, async (req, res) => {
        try {
            const sessionId = cleanOptionalString(req.params.sessionId);
            const ref = db.collection(CRM_SCHEDULED_SESSIONS).doc(sessionId);
            const snap = await ref.get();
            if (!snap.exists) {
                return sendError(res, 404, 'SESSION_NOT_FOUND', 'Session not found.');
            }
            const existing = normalizeScheduledSession({ sessionId, ...(snap.data() || {}) });
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
            const next = {
                ...existing,
                ...nextWindow,
                durationMinutes: intent.durationMinutes || existing.durationMinutes || null,
                timezone: intent.timezone || existing.timezone || null,
                version: Number(existing.version || 1) + 1,
                updatedAt: serverTimestamp(),
                updatedBy: req.user?.uid || null
            };
            await ensureNoTeacherConflict(db, next, [sessionId]);
            await ref.set(next, { merge: true });
            const scheduleState = await syncClassroomScheduleState(db, cleanOptionalString(existing.classId), { bumpVersion: true });
            await writeAuditLog?.({
                action: 'session.reschedule',
                entityType: 'scheduled_session',
                entityId: sessionId,
                metadata: { classId: existing.classId || null }
            }, { user: req.user });
            return sendSuccess(res, {
                sessionId,
                scheduleSummary: scheduleState?.scheduleSummary || null,
                scheduleVersion: scheduleState?.scheduleConfig?.scheduleVersion || null
            }, 'Session rescheduled.');
        } catch (error) {
            return sendError(res, 500, 'RESCHEDULE_SESSION_ERROR', 'Failed to reschedule session.', error?.message || error);
        }
    });

    router.post('/sessions/:sessionId/cancel', ...requireAdminHandlers, async (req, res) => {
        try {
            const sessionId = cleanOptionalString(req.params.sessionId);
            const ref = db.collection(CRM_SCHEDULED_SESSIONS).doc(sessionId);
            const snap = await ref.get();
            if (!snap.exists) {
                return sendError(res, 404, 'SESSION_NOT_FOUND', 'Session not found.');
            }
            const existing = normalizeScheduledSession({ sessionId, ...(snap.data() || {}) });
            if (isLockedSession(existing)) {
                return sendError(res, 409, 'SESSION_LOCKED', 'Locked sessions cannot be cancelled.');
            }

            await ref.set({
                status: 'cancelled',
                contractCountState: deriveContractCountState({
                    ...existing,
                    status: 'cancelled'
                }),
                version: Number(existing.version || 1) + 1,
                updatedAt: serverTimestamp(),
                updatedBy: req.user?.uid || null
            }, { merge: true });
            const scheduleState = await syncClassroomScheduleState(db, cleanOptionalString(existing.classId), { bumpVersion: true });
            await writeAuditLog?.({
                action: 'session.cancel',
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
            return sendError(res, 500, 'CANCEL_SESSION_ERROR', 'Failed to cancel session.', error?.message || error);
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
            const teacherUid = cleanOptionalString(req.body?.teacherUid) || classroom.primaryTeacherUid || null;
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
            const classroomRef = db.collection(CRM_CLASSROOMS).doc(classId);
            const classroomSnap = await classroomRef.get();
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
            const teacherUid = cleanOptionalString(req.body?.teacherUid) || classroom.primaryTeacherUid || null;
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
            if (!preview.canCommit) {
                return sendError(res, 409, 'REGENERATE_BLOCKED', 'Schedule regeneration is blocked.', preview);
            }

            const commitPlan = buildRegenerationCommitPlan({
                preview,
                existingSessions: classSessions
            });
            const createdSessions = [];
            if (typeof db.batch === 'function') {
                const batch = db.batch();
                commitPlan.cancelledSessions.forEach((session) => {
                    batch.set(db.collection(CRM_SCHEDULED_SESSIONS).doc(String(session.sessionId)), {
                        status: 'cancelled',
                        updatedAt: serverTimestamp(),
                        updatedBy: req.user?.uid || null,
                        version: Number(session.version || 1) + 1
                    }, { merge: true });
                });
                commitPlan.createdSessions.forEach((session) => {
                    const ref = db.collection(CRM_SCHEDULED_SESSIONS).doc();
                    createdSessions.push({ sessionId: ref.id, ...session });
                    batch.set(ref, {
                        ...session,
                        createdAt: serverTimestamp(),
                        createdBy: req.user?.uid || null,
                        updatedAt: serverTimestamp(),
                        updatedBy: req.user?.uid || null
                    });
                });
                await batch.commit();
            } else {
                for (const session of commitPlan.cancelledSessions) {
                    await db.collection(CRM_SCHEDULED_SESSIONS).doc(String(session.sessionId)).set({
                        status: 'cancelled',
                        updatedAt: serverTimestamp(),
                        updatedBy: req.user?.uid || null,
                        version: Number(session.version || 1) + 1
                    }, { merge: true });
                }
                for (const session of commitPlan.createdSessions) {
                    const ref = db.collection(CRM_SCHEDULED_SESSIONS).doc();
                    await ref.set({
                        ...session,
                        createdAt: serverTimestamp(),
                        createdBy: req.user?.uid || null,
                        updatedAt: serverTimestamp(),
                        updatedBy: req.user?.uid || null
                    });
                    createdSessions.push({ sessionId: ref.id, ...session });
                }
            }

            const scheduleState = await syncClassroomScheduleState(db, classId, {
                bumpVersion: true,
                scheduleConfigPatch: {
                    ...scheduleConfig,
                    sessionMinutes: Number(req.body?.sessionMinutes || 0) || scheduleConfig.sessionMinutes,
                    targetSessionCount: preview.nextTargetSessionCount,
                    seedWeekdays: Array.isArray(req.body?.seedWeekdays) ? req.body.seedWeekdays : scheduleConfig.seedWeekdays || [],
                    seedStartTime: cleanOptionalString(req.body?.seedStartTime) || scheduleConfig.seedStartTime || null,
                    lastRegeneratedAt: serverTimestamp(),
                    lastRegeneratedBy: req.user?.uid || null,
                    lastRegenerateFromDate: cleanOptionalString(req.body?.regenerateFromDate)
                },
                rootPatch: {
                    updatedAt: serverTimestamp(),
                    updatedBy: req.user?.uid || null
                }
            });

            await writeAuditLog?.({
                action: 'schedule.regenerate',
                entityType: 'classroom',
                entityId: classId,
                metadata: {
                    cancelledSessionIds: commitPlan.cancelledSessions.map((session) => session.sessionId),
                    createdCount: createdSessions.length
                }
            }, { user: req.user });

            return sendSuccess(res, {
                cancelledSessionIds: commitPlan.cancelledSessions.map((session) => session.sessionId),
                createdSessions,
                scheduleConfig: scheduleState?.scheduleConfig || null,
                scheduleSummary: scheduleState?.scheduleSummary || null
            }, 'Future schedule regenerated.');
        } catch (error) {
            return sendError(res, 500, 'REGENERATE_SCHEDULE_ERROR', 'Failed to regenerate future schedule.', error?.message || error);
        }
    });
};
