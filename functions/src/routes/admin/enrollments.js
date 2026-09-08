const { createEnrollment, updateEnrollment, auditSaved, readSavedData } = require('../../crm/workflow-write-service');
const {
    CRM_ENROLLMENTS,
    CRM_STUDENTS,
    CRM_COURSES,
    CRM_CLASSROOMS,
    CRM_SCHEDULED_SESSIONS,
    CLASSROOM_MEMBERS
} = require('../../crm/collections');
const {
    mapEnrollmentRecord
} = require('../../crm/enrollment-service');
const {
    mapClassroomRecord,
    mapCourseRecord
} = require('../../crm/course-service');
const {
    buildScheduleSummary,
    buildPushForwardPlan,
    normalizeScheduledSession
} = require('../../crm/scheduling-service');

function cleanOptionalString(val, fallback = null) {
    const s = String(val || '').trim();
    return s || fallback;
}

module.exports = function registerEnrollmentRoutes(router, deps) {
    const { db, sendSuccess, sendError, requireAdminHandlers, serverTimestamp, writeAuditLog } = deps;

    router.get('/students/:studentId/enrollments', ...requireAdminHandlers, async (req, res) => {
        try {
            const studentId = String(req.params.studentId || '').trim();
            if (!studentId) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Missing studentId.');
            }

            const snaps = await db.collection(CRM_ENROLLMENTS)
                .where('studentId', '==', studentId)
                .get();

            const sortedEnrollmentDocs = (snaps.docs || []).slice().sort((a, b) => {
                const aData = a.data() || {};
                const bData = b.data() || {};
                const aTime = aData.createdAt?.toMillis ? aData.createdAt.toMillis() : (aData.createdAt ? new Date(aData.createdAt).getTime() : 0);
                const bTime = bData.createdAt?.toMillis ? bData.createdAt.toMillis() : (bData.createdAt ? new Date(bData.createdAt).getTime() : 0);
                return bTime - aTime;
            });

            const enrollments = [];
            for (const doc of sortedEnrollmentDocs) {
                const enrollment = mapEnrollmentRecord(doc, doc.id);
                let course = null;
                let classroom = null;
                let scheduleSummary = null;
                let sessions = [];

                if (enrollment.courseId) {
                    const cSnap = await db.collection(CRM_COURSES).doc(enrollment.courseId).get().catch(() => null);
                    if (cSnap && cSnap.exists) {
                        course = mapCourseRecord(cSnap, cSnap.id);
                    }
                }

                if (enrollment.classId) {
                    const clSnap = await db.collection(CRM_CLASSROOMS).doc(enrollment.classId).get().catch(() => null);
                    if (clSnap && clSnap.exists) {
                        classroom = mapClassroomRecord(clSnap, clSnap.id);
                        if (!course && classroom.courseId) {
                            const cSnap = await db.collection(CRM_COURSES).doc(classroom.courseId).get().catch(() => null);
                            if (cSnap && cSnap.exists) course = mapCourseRecord(cSnap, cSnap.id);
                        }
                    }

                    // Load active scheduled sessions for this classroom
                    const sessionSnaps = await db.collection(CRM_SCHEDULED_SESSIONS)
                        .where('classId', '==', enrollment.classId)
                        .get()
                        .catch(() => ({ docs: [] }));

                    const sortedSessionDocs = (sessionSnaps.docs || []).slice().sort((a, b) => {
                        const aData = a.data() || {};
                        const bData = b.data() || {};
                        const aDate = String(aData.scheduledLocalDate || '');
                        const bDate = String(bData.scheduledLocalDate || '');
                        if (aDate !== bDate) return aDate.localeCompare(bDate);
                        const aTime = String(aData.scheduledLocalTime || '');
                        const bTime = String(bData.scheduledLocalTime || '');
                        return aTime.localeCompare(bTime);
                    });

                    sessions = sortedSessionDocs.map((sDoc) => normalizeScheduledSession({
                        sessionId: sDoc.id,
                        ...(sDoc.data() || {})
                    }));

                    const totalMins = classroom?.scheduleConfig?.totalInstructionMinutes
                        || course?.deliveryTemplate?.totalInstructionMinutes
                        || null;
                    const defaultMins = classroom?.scheduleConfig?.sessionMinutes
                        || course?.deliveryTemplate?.defaultSessionMinutes
                        || 120;
                    const targetCount = classroom?.scheduleConfig?.targetSessionCount
                        || null;

                    scheduleSummary = buildScheduleSummary({
                        totalInstructionMinutes: totalMins,
                        sessionMinutes: defaultMins,
                        targetSessionCount: targetCount,
                        sessions
                    });
                }


                enrollments.push({
                    ...enrollment,
                    course,
                    classroom,
                    scheduleSummary,
                    sessions
                });
            }

            return sendSuccess(res, { enrollments, count: enrollments.length });
        } catch (error) {
            return sendError(res, 500, 'LIST_STUDENT_ENROLLMENTS_ERROR', 'Failed to list student enrollments.', error?.message || error);
        }
    });

    router.post('/enrollments', ...requireAdminHandlers, async (req, res) => {
        try {
            const result = await createEnrollment(db, req.body || {}, { user: req.user, serverTimestamp });
            const saved = await readSavedData(db.collection(CRM_ENROLLMENTS).doc(result.enrollmentId), result.enrollment);
            const warnings = result.deduped ? [] : await auditSaved(writeAuditLog, {
                action: 'enrollment.create', entityType: 'enrollment', entityId: result.enrollmentId,
                metadata: { classId: result.enrollment.classId, studentId: result.enrollment.studentId }
            }, { user: req.user });
            warnings.push(...saved.warnings);
            return sendSuccess(res, {
                enrollmentId: result.enrollmentId,
                enrollment: mapEnrollmentRecord(saved.data, result.enrollmentId),
                deduped: result.deduped,
                ...(warnings.length ? { warnings } : {})
            }, result.deduped ? 'Enrollment already exists.' : 'Enrollment created.');
        } catch (error) {
            if (error.status) return sendError(res, error.status, error.code, error.message);
            if (/Enrollment requires|Invalid enrollment status/.test(error.message || '')) return sendError(res, 400, 'VALIDATION_ERROR', error.message);
            return sendError(res, 500, 'CREATE_ENROLLMENT_ERROR', 'Failed to create enrollment.', error?.message || error);
        }
    });

    router.patch('/enrollments/:enrollmentId', ...requireAdminHandlers, async (req, res) => {
        try {
            const enrollmentId = String(req.params.enrollmentId || '').trim();
            if (!enrollmentId) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Missing enrollmentId.');
            }

            const next = await updateEnrollment(db, enrollmentId, req.body || {}, { user: req.user, serverTimestamp });
            const saved = await readSavedData(db.collection(CRM_ENROLLMENTS).doc(enrollmentId), next);
            const warnings = await auditSaved(writeAuditLog, {
                action: 'enrollment.update', entityType: 'enrollment', entityId: enrollmentId,
                metadata: { classId: next.classId, studentId: next.studentId, status: next.status }
            }, { user: req.user });
            warnings.push(...saved.warnings);
            return sendSuccess(res, {
                enrollment: mapEnrollmentRecord(saved.data, enrollmentId),
                ...(warnings.length ? { warnings } : {})
            }, 'Enrollment updated.');
        } catch (error) {
            if (error.status) return sendError(res, error.status, error.code, error.message);
            const message = String(error?.message || '');
            if (message.includes('No enrollment fields provided') || message.includes('Invalid enrollment status')) {
                return sendError(res, 400, 'VALIDATION_ERROR', error.message);
            }
            return sendError(res, 500, 'UPDATE_ENROLLMENT_ERROR', 'Failed to update enrollment.', error?.message || error);
        }
    });

    router.post('/sessions/:sessionId/attendance', ...requireAdminHandlers, async (req, res) => {
        try {
            const sessionId = String(req.params.sessionId || '').trim();
            if (!sessionId) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'sessionId is required.');
            }

            const sessionRef = db.collection(CRM_SCHEDULED_SESSIONS).doc(sessionId);
            const sessionSnap = await sessionRef.get();
            if (!sessionSnap.exists) {
                return sendError(res, 404, 'SESSION_NOT_FOUND', 'Session not found.');
            }

            const current = normalizeScheduledSession({
                sessionId,
                ...(sessionSnap.data() || {})
            });

            const status = String(req.body?.status || '').toLowerCase().trim();
            const notes = cleanOptionalString(req.body?.notes);

            let sessionOutcome = 'none';
            let contractCountState = 'counts';
            let attendanceState = 'finalized';
            let sessionStatus = 'scheduled';

            switch (status) {
                case 'attended':
                    sessionOutcome = 'completed';
                    contractCountState = 'counts';
                    sessionStatus = 'completed';
                    break;
                case 'penalized':
                    sessionOutcome = 'absent_counted';
                    contractCountState = 'counts';
                    sessionStatus = 'completed';
                    break;
                case 'absent':
                    sessionOutcome = 'absent_makeup';
                    contractCountState = 'does_not_count';
                    sessionStatus = 'scheduled';
                    break;
                case 'reset':
                case 'scheduled':
                    sessionOutcome = 'none';
                    contractCountState = 'counts';
                    attendanceState = 'none';
                    sessionStatus = 'scheduled';
                    break;
                default:
                    return sendError(res, 400, 'VALIDATION_ERROR', `Invalid attendance status: "${status}". Valid statuses are: attended, penalized, absent, reset, scheduled.`);
            }

            const patch = {
                status: sessionStatus,
                sessionOutcome,
                contractCountState,
                attendanceState,
                attendanceStatus: (status === 'reset' || status === 'scheduled') ? null : status,
                isPushedForward: false,
                attendanceNotes: notes,
                updatedAt: serverTimestamp ? serverTimestamp() : new Date(),
                updatedBy: req.user?.uid || null
            };

            await sessionRef.update(patch);

            // Recompute schedule summary for classroom
            if (current.classId) {
                const classRef = db.collection(CRM_CLASSROOMS).doc(current.classId);
                const classSnap = await classRef.get();
                const classroom = classSnap.data() || {};
                const scheduleConfig = classroom.scheduleConfig || {};

                const allSessionSnaps = await db.collection(CRM_SCHEDULED_SESSIONS)
                    .where('classId', '==', current.classId)
                    .get();

                const allSessions = allSessionSnaps.docs.map((doc) => {
                    const data = doc.data() || {};
                    return normalizeScheduledSession({
                        sessionId: doc.id,
                        ...(doc.id === sessionId ? { ...data, ...patch } : data)
                    });
                });

                const updatedSummary = buildScheduleSummary({
                    totalInstructionMinutes: scheduleConfig.totalInstructionMinutes,
                    sessionMinutes: scheduleConfig.sessionMinutes,
                    targetSessionCount: scheduleConfig.targetSessionCount,
                    sessions: allSessions
                });
                await classRef.update({ scheduleSummary: updatedSummary });
            }

            await writeAuditLog?.({
                action: 'session.attendance',
                entityType: 'scheduled_session',
                entityId: sessionId,
                metadata: {
                    classId: current.classId,
                    status,
                    sessionOutcome,
                    contractCountState
                }
            }, { user: req.user });

            return sendSuccess(res, {
                sessionId,
                patch,
                status
            }, `Attendance marked as ${status}.`);
        } catch (error) {
            return sendError(res, 500, 'ATTENDANCE_UPDATE_ERROR', 'Failed to update attendance.', error?.message || error);
        }
    });

    router.post('/sessions/:sessionId/push-forward', ...requireAdminHandlers, async (req, res) => {
        try {
            const sessionId = String(req.params.sessionId || '').trim();
            if (!sessionId) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'sessionId is required.');
            }

            const sessionRef = db.collection(CRM_SCHEDULED_SESSIONS).doc(sessionId);
            const sessionSnap = await sessionRef.get();
            if (!sessionSnap.exists) {
                return sendError(res, 404, 'SESSION_NOT_FOUND', 'Session not found.');
            }

            const triggeringSession = normalizeScheduledSession({
                sessionId,
                ...(sessionSnap.data() || {})
            });

            if (!triggeringSession.classId) {
                return sendError(res, 400, 'INVALID_SESSION', 'Session has no linked classId.');
            }

            // Load all sessions for this classroom
            const allSessionSnaps = await db.collection(CRM_SCHEDULED_SESSIONS)
                .where('classId', '==', triggeringSession.classId)
                .get();

            const allSessions = allSessionSnaps.docs.map((doc) => normalizeScheduledSession({
                sessionId: doc.id,
                ...(doc.data() || {})
            }));

            const slots = Array.isArray(req.body?.slots) ? req.body.slots : [];
            const timezone = cleanOptionalString(req.body?.timezone, triggeringSession.timezone || 'Asia/Ho_Chi_Minh');

            const plan = buildPushForwardPlan({
                sessions: allSessions,
                fromSessionId: sessionId,
                slots,
                timezone
            });

            if (req.body?.previewOnly) {
                return sendSuccess(res, {
                    preview: true,
                    plan,
                    fromSessionId: sessionId,
                    prevEndDate: plan.prevEndDate,
                    newEndDate: plan.newEndDate,
                    prevEndDateFormatted: plan.prevEndDateFormatted,
                    newEndDateFormatted: plan.newEndDateFormatted,
                    previewSummary: plan.previewSummary,
                    previewRows: plan.previewRows
                }, 'Push-forward preview generated.');
            }

            // Batch commit
            const batch = db.batch();
            plan.patches.forEach((p) => {
                const sRef = db.collection(CRM_SCHEDULED_SESSIONS).doc(p.sessionId);
                batch.update(sRef, p.patch);
            });

            const newSessionRef = db.collection(CRM_SCHEDULED_SESSIONS).doc();
            batch.set(newSessionRef, plan.newSession);

            // Recompute schedule summary for classroom
            const classRef = db.collection(CRM_CLASSROOMS).doc(triggeringSession.classId);
            const classSnap = await classRef.get();
            const classroom = classSnap.data() || {};
            const scheduleConfig = classroom.scheduleConfig || {};

            const patchedSessions = allSessions.map((s) => {
                const patchObj = plan.patches.find((p) => p.sessionId === s.sessionId);
                return patchObj ? { ...s, ...patchObj.patch } : s;
            });
            const allAfter = [...patchedSessions, plan.newSession];
            const updatedSummary = buildScheduleSummary({
                totalInstructionMinutes: scheduleConfig.totalInstructionMinutes,
                sessionMinutes: scheduleConfig.sessionMinutes,
                targetSessionCount: scheduleConfig.targetSessionCount,
                sessions: allAfter
            });

            batch.update(classRef, { scheduleSummary: updatedSummary });

            await batch.commit();

            await writeAuditLog?.({
                action: 'session.push_forward',
                entityType: 'scheduled_session',
                entityId: sessionId,
                metadata: {
                    classId: triggeringSession.classId,
                    newSessionId: newSessionRef.id,
                    prevEndDate: plan.prevEndDate,
                    newEndDate: plan.newEndDate
                }
            }, { user: req.user });

            return sendSuccess(res, {
                plan,
                fromSessionId: sessionId,
                prevEndDate: plan.prevEndDate,
                newEndDate: plan.newEndDate,
                prevEndDateFormatted: plan.prevEndDateFormatted,
                newEndDateFormatted: plan.newEndDateFormatted,
                previewSummary: plan.previewSummary
            }, 'Session pushed forward successfully.');
        } catch (error) {
            const message = String(error?.message || '');
            if (message.includes('cannot be pushed forward') || message.includes('not found')) {
                return sendError(res, 400, 'PUSH_FORWARD_ERROR', error.message);
            }
            return sendError(res, 500, 'PUSH_FORWARD_ERROR', 'Failed to push forward session.', error?.message || error);
        }
    });
};
