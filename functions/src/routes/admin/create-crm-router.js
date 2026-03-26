const express = require('express');
const {
    USERS,
    CRM_CLASSROOMS,
    CRM_SCHEDULED_SESSIONS,
    CRM_SUBMISSIONS,
    CRM_AUDIT_LOGS,
    CLASSROOM_MODULES,
    CLASSROOM_CLASSWORK,
    CLASSROOM_MEMBERS
} = require('../../crm/collections');
const {
    sendSuccess: defaultSendSuccess,
    sendError: defaultSendError
} = require('../../crm/http-contracts');
const registerStudentRoutes = require('./students');
const registerCourseRoutes = require('./courses');
const registerIdentityRoutes = require('./identity');
const registerLeadRoutes = require('./leads');
const registerActivityRoutes = require('./activities');
const registerEnrollmentRoutes = require('./enrollments');
const registerAttendanceRoutes = require('./attendance');
const registerSchedulingRoutes = require('./scheduling');
const registerFinanceRoutes = require('./finance');
const registerAutomationRoutes = require('./automations');
const registerReportingRoutes = require('./reporting');
const registerReadAloudReportingRoutes = require('./read-aloud-reporting');
const registerGovernanceRoutes = require('./governance');
const registerLiveSessionRoutes = require('./live-sessions');
const { buildAuditLogEntry } = require('../../crm/governance-service');
const {
    buildClassroomCreateData,
    buildClassroomPatchData,
    computeMissingReviewItems,
    mapClassroomMembers,
    mapClassroomRecord,
    normalizeScheduleConfig
} = require('../../crm/course-service');
const {
    buildScheduleSummary,
    normalizeScheduledSession
} = require('../../crm/scheduling-service');
const {
    buildHomeworkSubmissionCreateData,
    buildHomeworkSubmissionDocId,
    buildHomeworkSubmissionReturnPatch,
    buildHomeworkSubmissionGradePatch
} = require('../../crm/homework-service');

function resolveServerTimestampFactory(deps) {
    if (typeof deps.serverTimestamp === 'function') {
        return deps.serverTimestamp;
    }

    if (deps.admin?.firestore?.FieldValue?.serverTimestamp) {
        return () => deps.admin.firestore.FieldValue.serverTimestamp();
    }

    return () => new Date();
}

function buildStatusResolver(deps) {
    if (typeof deps.resolveAdminStatus === 'function') {
        return deps.resolveAdminStatus;
    }

    return async ({ db, req }) => {
        let bootstrapped = false;
        try {
            await db.collection(USERS).doc(String(req.user.uid)).set({
                isAdmin: true,
                email: req.user.email || null,
                adminBootstrappedAt: new Date()
            }, { merge: true });
            bootstrapped = true;
        } catch (error) {
            console.warn('[CRM Admin] Failed to bootstrap isAdmin flag:', error?.message || error);
        }

        return {
            isAdmin: true,
            uid: req.user.uid,
            email: req.user.email || null,
            bootstrapped
        };
    };
}

function ensureDependencies(deps) {
    for (const key of ['db', 'authMiddleware']) {
        if (!Object.prototype.hasOwnProperty.call(deps, key)) {
            throw new Error(`Missing required dependency for CRM router: ${key}`);
        }
    }

    if (!deps.identity?.generateClassCode || !deps.identity?.lookupUserByEmail || !deps.identity?.forceLinkProfile) {
        throw new Error('Missing required identity helpers for CRM router.');
    }
}

function buildAuditLogger(deps) {
    return async function writeAuditLog(entry, context = {}) {
        try {
            const payload = buildAuditLogEntry(entry, {
                user: context.user || null,
                serverTimestamp: deps.admin?.firestore?.FieldValue?.serverTimestamp
                    ? () => deps.admin.firestore.FieldValue.serverTimestamp()
                    : () => new Date()
            });
            await deps.db.collection(CRM_AUDIT_LOGS).doc().set(payload);
        } catch (error) {
            console.warn('[CRM Admin] Failed to write audit log:', error?.message || error);
        }
    };
}

function nextScheduleVersion(scheduleConfig) {
    return Math.max(Number(scheduleConfig?.scheduleVersion || 0) + 1, 1);
}

function buildAdminCapabilities(status) {
    const overrides = status?.capabilities && typeof status.capabilities === 'object'
        ? status.capabilities
        : {};

    return {
        classroomMatches: overrides.classroomMatches !== false,
        readAloudReporting: overrides.readAloudReporting !== false
    };
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

    const sessions = options.sessions || (await db.collection(CRM_SCHEDULED_SESSIONS).where('classId', '==', classId).get())
        .docs
        .map((doc) => normalizeScheduledSession({ sessionId: doc.id, ...doc.data() }));
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

module.exports = function createCrmRouter(rawDeps) {
    const deps = rawDeps || {};
    ensureDependencies(deps);

    const router = express.Router();
    const sendSuccess = deps.sendSuccess || defaultSendSuccess;
    const sendError = deps.sendError || defaultSendError;
    const requireAuthHandlers = [deps.authMiddleware].filter(Boolean);
    const requireAdminHandlers = [deps.authMiddleware, deps.adminMiddleware].filter(Boolean);
    const serverTimestamp = resolveServerTimestampFactory(deps);
    const resolveAdminStatus = buildStatusResolver(deps);
    const writeAuditLog = buildAuditLogger(deps);

    const routeDeps = {
        ...deps,
        sendSuccess,
        sendError,
        requireAuthHandlers,
        requireAdminHandlers,
        serverTimestamp,
        writeAuditLog
    };

    router.get('/status', ...requireAuthHandlers, async (req, res) => {
        try {
            const status = await resolveAdminStatus({
                ...routeDeps,
                req,
                res
            });

            if (!status?.isAdmin) {
                return sendError(res, 403, 'FORBIDDEN', 'Admin access required.');
            }

            return sendSuccess(
                res,
                {
                    isAdmin: true,
                    uid: status.uid || req.user.uid,
                    email: status.email || req.user.email || null,
                    bootstrapped: !!status.bootstrapped,
                    capabilities: buildAdminCapabilities(status)
                },
                status.bootstrapped ? 'Admin verified.' : 'Admin verified.'
            );
        } catch (error) {
            return sendError(res, error?.status || 500, error?.error || 'ADMIN_CHECK_ERROR', error?.message || 'Failed to verify admin status.', error?.details || null);
        }
    });

    registerStudentRoutes(router, routeDeps);
    registerCourseRoutes(router, routeDeps);
    registerIdentityRoutes(router, routeDeps);
    registerLeadRoutes(router, routeDeps);
    registerActivityRoutes(router, routeDeps);
    registerEnrollmentRoutes(router, routeDeps);
    registerAttendanceRoutes(router, routeDeps);
    registerSchedulingRoutes(router, routeDeps);
    registerFinanceRoutes(router, routeDeps);
    registerAutomationRoutes(router, routeDeps);
    registerReportingRoutes(router, routeDeps);
    registerReadAloudReportingRoutes(router, routeDeps);
    registerGovernanceRoutes(router, routeDeps);
    registerLiveSessionRoutes(router, routeDeps);

    router.post('/classrooms', ...requireAdminHandlers, async (req, res) => {
        try {
            const classroom = buildClassroomCreateData(req.body || {}, {
                user: req.user,
                serverTimestamp
            });

            const ref = deps.db.collection(CRM_CLASSROOMS).doc();
            await ref.set(classroom);
            await writeAuditLog({
                action: 'classroom.create',
                entityType: 'classroom',
                entityId: ref.id,
                metadata: { courseId: classroom.courseId || null, status: classroom.status || null }
            }, { user: req.user });

            return sendSuccess(res, { classroomId: ref.id }, 'Classroom created.');
        } catch (error) {
            if ((error?.message || '').includes('Classroom name')) {
                return sendError(res, 400, 'VALIDATION_ERROR', error.message);
            }
            return sendError(res, 500, 'CREATE_CLASSROOM_ERROR', 'Failed to create classroom.', error?.message || error);
        }
    });

    router.get('/classrooms', ...requireAdminHandlers, async (req, res) => {
        try {
            const requestedLimit = Number(req.query?.limit);
            const limit = Number.isFinite(requestedLimit)
                ? Math.min(500, Math.max(1, Math.floor(requestedLimit)))
                : 200;

            const snaps = await deps.db
                .collection(CRM_CLASSROOMS)
                .orderBy('createdAt', 'desc')
                .limit(limit)
                .get();

            const classrooms = snaps.docs.map((doc) => mapClassroomRecord(doc, doc.id));
            return sendSuccess(res, { classrooms, count: classrooms.length });
        } catch (error) {
            return sendError(res, 500, 'LIST_CLASSROOMS_ERROR', 'Failed to list classrooms.', error?.message || error);
        }
    });

    router.patch('/classrooms/:classId', ...requireAdminHandlers, async (req, res) => {
        try {
            const classId = String(req.params.classId || '').trim();
            if (!classId) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Missing classId.');
            }

            const ref = deps.db.collection(CRM_CLASSROOMS).doc(classId);
            const snap = await ref.get();
            if (!snap.exists) {
                return sendError(res, 404, 'CLASSROOM_NOT_FOUND', 'Classroom not found.');
            }

            const next = buildClassroomPatchData(snap.data() || {}, req.body || {}, {
                user: req.user,
                serverTimestamp
            });
            if (next.scheduleConfig) {
                await syncClassroomScheduleState(deps.db, classId, {
                    classroomSnap: snap,
                    scheduleConfigPatch: next.scheduleConfig,
                    bumpVersion: true,
                    rootPatch: {
                        ...Object.fromEntries(
                            Object.entries(next).filter(([key]) => key !== 'scheduleConfig' && key !== 'scheduleSummary')
                        ),
                        updatedAt: serverTimestamp(),
                        updatedBy: req.user?.uid || null
                    }
                });
            } else {
                await ref.set(next, { merge: true });
            }
            await writeAuditLog({
                action: 'classroom.update',
                entityType: 'classroom',
                entityId: classId,
                metadata: { courseId: next.courseId || null, status: next.status || null }
            }, { user: req.user });

            const updatedSnap = await ref.get();
            return sendSuccess(res, { classroom: mapClassroomRecord(updatedSnap, classId) }, 'Classroom updated.');
        } catch (error) {
            if ((error?.message || '').includes('Classroom name') || (error?.message || '').includes('No classroom fields')) {
                return sendError(res, 400, 'VALIDATION_ERROR', error.message);
            }
            return sendError(res, 500, 'UPDATE_CLASSROOM_ERROR', 'Failed to update classroom.', error?.message || error);
        }
    });

    router.post('/classrooms/:classId/modules', ...requireAdminHandlers, async (req, res) => {
        try {
            const classId = String(req.params.classId || '').trim();
            const title = String(req.body?.title || '').trim();
            const orderIndex = Number(req.body?.orderIndex) || Date.now();

            if (!classId) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Missing classId.');
            }
            if (!title) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Module title is required.');
            }

            const ref = deps.db.collection(CRM_CLASSROOMS).doc(classId).collection(CLASSROOM_MODULES).doc();
            await ref.set({
                title,
                orderIndex,
                createdAt: serverTimestamp()
            });
            await writeAuditLog({
                action: 'classroom.module.create',
                entityType: 'module',
                entityId: ref.id,
                metadata: { classId, title }
            }, { user: req.user });

            return sendSuccess(res, { moduleId: ref.id }, 'Module created.');
        } catch (error) {
            return sendError(res, 500, 'CREATE_MODULE_ERROR', 'Failed to create module.', error?.message || error);
        }
    });

    router.post('/classrooms/:classId/classwork', ...requireAdminHandlers, async (req, res) => {
        try {
            const classId = String(req.params.classId || '').trim();
            const work = req.body && typeof req.body === 'object' ? req.body : {};
            if (!classId) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Missing classId.');
            }
            if (!String(work.title || '').trim()) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Classwork title is required.');
            }

            const ref = deps.db.collection(CRM_CLASSROOMS).doc(classId).collection(CLASSROOM_CLASSWORK).doc();
            await ref.set({
                ...work,
                createdAt: serverTimestamp()
            });
            await writeAuditLog({
                action: 'classroom.classwork.create',
                entityType: 'classwork',
                entityId: ref.id,
                metadata: { classId, title: work.title || null }
            }, { user: req.user });

            return sendSuccess(res, { classworkId: ref.id }, 'Classwork created.');
        } catch (error) {
            return sendError(res, 500, 'CREATE_CLASSWORK_ERROR', 'Failed to create classwork.', error?.message || error);
        }
    });

    router.post('/classrooms/:classId/submissions', ...requireAdminHandlers, async (req, res) => {
        try {
            const classId = String(req.params.classId || '').trim();
            const submissionInput = req.body && typeof req.body === 'object' ? req.body : {};
            const workId = String(submissionInput.workId || '').trim();
            const studentUid = String(submissionInput.studentUid || '').trim();

            if (!classId) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Missing classId.');
            }
            if (!workId) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'workId is required.');
            }
            if (!studentUid) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'studentUid is required.');
            }

            const submissionId = buildHomeworkSubmissionDocId({ classId, workId, studentUid });
            const submission = {
                ...buildHomeworkSubmissionCreateData({
                    ...submissionInput,
                    classId,
                    workId,
                    studentUid
                }, {
                    user: req.user,
                    serverTimestamp
                }),
                studentName: String(submissionInput.studentName || '').trim() || null,
                studentId: String(submissionInput.studentId || '').trim() || null
            };

            const ref = deps.db.collection(CRM_SUBMISSIONS).doc(submissionId);
            await ref.set(submission);
            await writeAuditLog({
                action: 'submission.create',
                entityType: 'submission',
                entityId: submissionId,
                metadata: { classId, workId, studentUid }
            }, { user: req.user });

            const snap = await ref.get();
            return sendSuccess(res, {
                submissionId,
                submission: { id: submissionId, ...snap.data() }
            }, 'Submission created.');
        } catch (error) {
            return sendError(res, 500, 'CREATE_SUBMISSION_ERROR', 'Failed to create submission.', error?.message || error);
        }
    });

    router.get('/classrooms/:classId/submissions', ...requireAdminHandlers, async (req, res) => {
        try {
            const classId = String(req.params.classId || '').trim();
            if (!classId) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Missing classId.');
            }

            const snap = await deps.db.collection(CRM_SUBMISSIONS).where('classId', '==', classId).get();
            const submissions = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
            return sendSuccess(res, { submissions });
        } catch (error) {
            return sendError(res, 500, 'FETCH_SUBMISSIONS_ERROR', 'Failed to fetch submissions.', error?.message || error);
        }
    });

    router.post('/submissions/:submissionId/return-for-revision', ...requireAdminHandlers, async (req, res) => {
        try {
            const submissionId = String(req.params.submissionId || '').trim();
            if (!submissionId) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Missing submissionId.');
            }

            const ref = deps.db.collection(CRM_SUBMISSIONS).doc(submissionId);
            const snap = await ref.get();
            if (!snap.exists) {
                return sendError(res, 404, 'SUBMISSION_NOT_FOUND', 'Submission not found.');
            }

            const patch = buildHomeworkSubmissionReturnPatch(snap.data() || {}, req.body || {}, {
                user: req.user,
                serverTimestamp
            });
            await ref.set(patch, { merge: true });
            await writeAuditLog({
                action: 'submission.return_for_revision',
                entityType: 'submission',
                entityId: submissionId
            }, { user: req.user });

            const updatedSnap = await ref.get();
            return sendSuccess(res, {
                submissionId,
                submission: { id: submissionId, ...updatedSnap.data() }
            }, 'Submission returned for revision.');
        } catch (error) {
            return sendError(res, 500, 'RETURN_SUBMISSION_ERROR', 'Failed to return submission for revision.', error?.message || error);
        }
    });

    router.get('/classrooms/:classId/review-board', ...requireAdminHandlers, async (req, res) => {
        try {
            const classId = String(req.params.classId || '').trim();
            if (!classId) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Missing classId.');
            }

            const [submissionsSnap, classworkSnap, membersSnap] = await Promise.all([
                deps.db.collection(CRM_SUBMISSIONS).where('classId', '==', classId).get(),
                deps.db.collection(CRM_CLASSROOMS).doc(classId).collection(CLASSROOM_CLASSWORK).get(),
                deps.db.collection(CRM_CLASSROOMS).doc(classId).collection(CLASSROOM_MEMBERS).get()
            ]);

            const submissions = submissionsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
            const classworks = classworkSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
            const members = mapClassroomMembers(membersSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
            const missing = computeMissingReviewItems({
                classworks,
                submissions,
                members
            });

            return sendSuccess(res, {
                submissions,
                missing,
                members
            });
        } catch (error) {
            return sendError(res, 500, 'FETCH_REVIEW_BOARD_ERROR', 'Failed to fetch review board.', error?.message || error);
        }
    });

    router.post('/submissions/:submissionId/grade', ...requireAdminHandlers, async (req, res) => {
        try {
            const submissionId = String(req.params.submissionId || '').trim();
            if (!submissionId) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Missing submissionId.');
            }

            const ref = deps.db.collection(CRM_SUBMISSIONS).doc(submissionId);
            const snap = await ref.get();
            if (!snap.exists) {
                return sendError(res, 404, 'SUBMISSION_NOT_FOUND', 'Submission not found.');
            }

            const patch = buildHomeworkSubmissionGradePatch(snap.data() || {}, req.body || {}, {
                user: req.user,
                serverTimestamp
            });
            await ref.set(patch, { merge: true });
            await writeAuditLog({
                action: 'submission.grade',
                entityType: 'submission',
                entityId: submissionId,
                metadata: { grade: req.body?.grade ?? null }
            }, { user: req.user });

            const updatedSnap = await ref.get();
            return sendSuccess(res, {
                submissionId,
                submission: { id: submissionId, ...updatedSnap.data() }
            }, 'Submission graded.');
        } catch (error) {
            return sendError(res, 500, 'GRADE_ERROR', 'Failed to grade submission.', error?.message || error);
        }
    });

    if (typeof deps.registerExtraRoutes === 'function') {
        deps.registerExtraRoutes(router, routeDeps);
    }

    return router;
};
