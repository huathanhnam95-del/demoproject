const {
    CRM_ENROLLMENTS,
    CRM_STUDENTS,
    CRM_COURSES,
    CRM_CLASSROOMS,
    CRM_SCHEDULED_SESSIONS,
    CLASSROOM_MEMBERS
} = require('../../crm/collections');
const {
    buildEnrollmentCreateData,
    buildEnrollmentPatchData,
    buildClassroomMemberData,
    mapEnrollmentRecord
} = require('../../crm/enrollment-service');
const {
    buildClassroomCreateData,
    mapClassroomRecord,
    mapCourseRecord
} = require('../../crm/course-service');
const {
    buildSeedSessions,
    buildScheduleSummary,
    buildPushForwardPlan,
    normalizeScheduledSession
} = require('../../crm/scheduling-service');
const { enqueuePracticeAccessJob } = require('../../crm/practice-access-service');

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
                .orderBy('createdAt', 'desc')
                .get();

            const enrollments = [];
            for (const doc of snaps.docs) {
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
                        .orderBy('scheduledLocalDate', 'asc')
                        .get()
                        .catch(() => ({ docs: [] }));

                    sessions = sessionSnaps.docs.map((sDoc) => normalizeScheduledSession({
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
            const payload = req.body && typeof req.body === 'object' ? { ...req.body } : {};
            if (payload.studentId) {
                const studentSnap = await db.collection(CRM_STUDENTS).doc(String(payload.studentId).trim()).get();
                if (studentSnap.exists) {
                    const student = studentSnap.data() || {};
                    payload.studentName = payload.studentName || student.name || student.email || null;
                    payload.studentEmail = payload.studentEmail || student.email || null;
                    const linked = Array.isArray(student.linked_user_ids) ? student.linked_user_ids : [];
                    payload.studentUid = payload.studentUid || linked[0] || null;
                }
            }

            // Auto-provision 1-on-1 synthetic classroom if classId is omitted but courseId is provided
            if (!payload.classId && payload.courseId) {
                const courseSnap = await db.collection(CRM_COURSES).doc(String(payload.courseId).trim()).get();
                if (!courseSnap.exists) {
                    return sendError(res, 404, 'COURSE_NOT_FOUND', 'Course not found.');
                }
                const course = mapCourseRecord(courseSnap, courseSnap.id);
                const isOneOnOne = course.courseType === '1on1' || course.courseType === 'pronun' || (Array.isArray(payload.slots) && payload.slots.length > 0);

                if (isOneOnOne) {
                    const totalInstructionMinutes = course.deliveryTemplate?.totalInstructionMinutes || 1440;
                    const sessionMinutes = course.deliveryTemplate?.defaultSessionMinutes || 120;
                    const durationStepMinutes = course.deliveryTemplate?.durationStepMinutes || 30;
                    const timezone = cleanOptionalString(payload.timezone) || course.deliveryTemplate?.timezone || 'Asia/Ho_Chi_Minh';
                    const startDate = cleanOptionalString(payload.startDate);

                    if (!startDate) {
                        return sendError(res, 400, 'VALIDATION_ERROR', 'Course start date is required.');
                    }
                    if (!Array.isArray(payload.slots) || payload.slots.length === 0) {
                        return sendError(res, 400, 'VALIDATION_ERROR', 'At least one weekly schedule slot is required.');
                    }

                    const syntheticClassData = buildClassroomCreateData({
                        name: `${payload.studentName || 'Student'} - ${course.name || '1-on-1'}`,
                        courseId: course.courseId,
                        classKind: 'oneOnOne',
                        primaryTeacherUid: cleanOptionalString(payload.teacherUid),
                        studentId: payload.studentId,
                        studentUid: payload.studentUid,
                        status: 'active',
                        scheduleConfig: {
                            totalInstructionMinutes,
                            sessionMinutes,
                            durationStepMinutes,
                            timezone,
                            seedStartDate: startDate,
                            planningStatus: 'configured'
                        }
                    }, { user: req.user, serverTimestamp });

                    const classRef = db.collection(CRM_CLASSROOMS).doc();
                    await classRef.set(syntheticClassData);
                    payload.classId = classRef.id;

                    // Seed sessions
                    const seedBatchId = `seed-${Date.now()}`;
                    const seedSessions = buildSeedSessions({
                        classId: classRef.id,
                        courseId: course.courseId,
                        teacherUid: cleanOptionalString(payload.teacherUid),
                        timezone,
                        startDate,
                        slots: payload.slots,
                        totalInstructionMinutes,
                        seedBatchId
                    });

                    // Save seed sessions in batch
                    const batch = db.batch();
                    seedSessions.forEach((sessionData) => {
                        const sessionRef = db.collection(CRM_SCHEDULED_SESSIONS).doc();
                        batch.set(sessionRef, {
                            sessionId: sessionRef.id,
                            ...sessionData
                        });
                    });

                    // Update classroom schedule summary
                    const initialSummary = buildScheduleSummary({
                        totalInstructionMinutes,
                        sessionMinutes,
                        sessions: seedSessions
                    });
                    batch.update(classRef, { scheduleSummary: initialSummary });

                    await batch.commit();
                }
            }

            if (payload.classId && !payload.courseId) {
                const classSnap = await db.collection(CRM_CLASSROOMS).doc(String(payload.classId).trim()).get();
                if (classSnap.exists) {
                    payload.courseId = payload.courseId || classSnap.data()?.courseId || null;
                }
            }

            const existingSnap = await db.collection(CRM_ENROLLMENTS)
                .where('classId', '==', String(payload.classId || '').trim())
                .where('studentId', '==', String(payload.studentId || '').trim())
                .limit(1)
                .get();

            if (existingSnap && !existingSnap.empty && Array.isArray(existingSnap.docs) && existingSnap.docs[0]) {
                const existingDoc = existingSnap.docs[0];
                return sendSuccess(res, {
                    deduped: true,
                    enrollment: mapEnrollmentRecord(existingDoc, existingDoc.id)
                }, 'Enrollment already exists.');
            }

            const enrollment = buildEnrollmentCreateData(payload, {
                user: req.user,
                serverTimestamp
            });
            const ref = db.collection(CRM_ENROLLMENTS).doc();
            await ref.set(enrollment);

            if (enrollment.studentUid) {
                await db.collection(CRM_CLASSROOMS)
                    .doc(enrollment.classId)
                    .collection(CLASSROOM_MEMBERS)
                    .doc(enrollment.studentUid)
                    .set(buildClassroomMemberData(enrollment), { merge: true });
            }

            const snap = await ref.get();
            await writeAuditLog?.({
                action: 'enrollment.create',
                entityType: 'enrollment',
                entityId: ref.id,
                metadata: {
                    classId: enrollment.classId,
                    studentId: enrollment.studentId
                }
            }, { user: req.user });

            // Enrollment changes may affect practice access windows.
            if (enrollment.studentId) {
                const studentSnap = await db.collection(CRM_STUDENTS).doc(enrollment.studentId).get().catch(() => null);
                const linked = studentSnap && studentSnap.exists ? (studentSnap.data()?.linked_user_ids || []) : [];
                const uids = Array.isArray(linked) ? linked.map((x) => String(x || '').trim()).filter(Boolean) : [];
                await Promise.all(uids.map((targetUid) => enqueuePracticeAccessJob(db, 'reconcileUid', targetUid, { runAfterAt: new Date() })));
            }
            return sendSuccess(res, {
                enrollmentId: ref.id,
                enrollment: mapEnrollmentRecord(snap, ref.id)
            }, 'Enrollment created.');
        } catch (error) {
            const message = String(error?.message || '');
            if (message.includes('Enrollment requires') || message.includes('Invalid enrollment status')) {
                return sendError(res, 400, 'VALIDATION_ERROR', error.message);
            }
            return sendError(res, 500, 'CREATE_ENROLLMENT_ERROR', 'Failed to create enrollment.', error?.message || error);
        }
    });

    router.patch('/enrollments/:enrollmentId', ...requireAdminHandlers, async (req, res) => {
        try {
            const enrollmentId = String(req.params.enrollmentId || '').trim();
            if (!enrollmentId) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Missing enrollmentId.');
            }

            const ref = db.collection(CRM_ENROLLMENTS).doc(enrollmentId);
            const snap = await ref.get();
            if (!snap.exists) {
                return sendError(res, 404, 'ENROLLMENT_NOT_FOUND', 'Enrollment not found.');
            }

            const next = buildEnrollmentPatchData(snap.data() || {}, req.body || {}, {
                user: req.user,
                serverTimestamp
            });
            await ref.set(next, { merge: true });

            if (next.studentUid) {
                const memberRef = db.collection(CRM_CLASSROOMS)
                    .doc(next.classId)
                    .collection(CLASSROOM_MEMBERS)
                    .doc(next.studentUid);

                if (['inactive', 'withdrawn'].includes(String(next.status || ''))) {
                    await memberRef.delete().catch(() => null);
                } else {
                    await memberRef.set(buildClassroomMemberData(next), { merge: true });
                }
            }

            const updatedSnap = await ref.get();
            await writeAuditLog?.({
                action: 'enrollment.update',
                entityType: 'enrollment',
                entityId: enrollmentId,
                metadata: {
                    classId: next.classId,
                    studentId: next.studentId,
                    status: next.status
                }
            }, { user: req.user });

            // Enrollment changes may affect practice access windows.
            if (next.studentId) {
                const studentSnap = await db.collection(CRM_STUDENTS).doc(next.studentId).get().catch(() => null);
                const linked = studentSnap && studentSnap.exists ? (studentSnap.data()?.linked_user_ids || []) : [];
                const uids = Array.isArray(linked) ? linked.map((x) => String(x || '').trim()).filter(Boolean) : [];
                await Promise.all(uids.map((targetUid) => enqueuePracticeAccessJob(db, 'reconcileUid', targetUid, { runAfterAt: new Date() })));
            }
            return sendSuccess(res, {
                enrollment: mapEnrollmentRecord(updatedSnap, enrollmentId)
            }, 'Enrollment updated.');
        } catch (error) {
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
