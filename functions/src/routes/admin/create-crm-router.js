const express = require('express');
const {
    USERS,
    CRM_CLASSROOMS,
    CRM_SUBMISSIONS,
    CRM_AUDIT_LOGS,
    CLASSROOM_MODULES,
    CLASSROOM_CLASSWORK,
    CLASSROOM_MEMBERS,
    CLASSROOM_LIVE_SESSIONS
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
const registerFinanceRoutes = require('./finance');
const registerAutomationRoutes = require('./automations');
const registerReportingRoutes = require('./reporting');
const registerGovernanceRoutes = require('./governance');
const { buildAuditLogEntry } = require('../../crm/governance-service');
const {
    buildClassroomCreateData,
    buildClassroomPatchData,
    computeMissingReviewItems,
    mapClassroomMembers,
    mapClassroomRecord
} = require('../../crm/course-service');
const {
    buildHomeworkSubmissionCreateData,
    buildHomeworkSubmissionDocId,
    buildHomeworkSubmissionReturnPatch,
    buildHomeworkSubmissionResubmissionPatch
} = require('../../crm/homework-service');
const {
    buildLiveSessionCreateData,
    buildLiveSessionPatchData,
    buildLiveSessionStartPatch,
    buildLiveSessionEndPatch,
    mapLiveSessionRecord,
    sortLiveSessions
} = require('../../crm/live-session-service');

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
                    bootstrapped: !!status.bootstrapped
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
    registerFinanceRoutes(router, routeDeps);
    registerAutomationRoutes(router, routeDeps);
    registerReportingRoutes(router, routeDeps);
    registerGovernanceRoutes(router, routeDeps);

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
            await ref.set(next, { merge: true });
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

    router.get('/classrooms/:classId/live-sessions', ...requireAdminHandlers, async (req, res) => {
        try {
            const classId = String(req.params.classId || '').trim();
            if (!classId) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Missing classId.');
            }

            const classroomSnap = await deps.db.collection(CRM_CLASSROOMS).doc(classId).get();
            if (!classroomSnap.exists) {
                return sendError(res, 404, 'CLASSROOM_NOT_FOUND', 'Classroom not found.');
            }

            const snap = await deps.db.collection(CRM_CLASSROOMS)
                .doc(classId)
                .collection(CLASSROOM_LIVE_SESSIONS)
                .get();

            const sessions = sortLiveSessions(snap.docs.map((doc) => mapLiveSessionRecord(doc, doc.id)));
            return sendSuccess(res, { sessions, count: sessions.length });
        } catch (error) {
            return sendError(res, 500, 'LIST_LIVE_SESSIONS_ERROR', 'Failed to fetch live sessions.', error?.message || error);
        }
    });

    router.post('/classrooms/:classId/live-sessions', ...requireAdminHandlers, async (req, res) => {
        try {
            const classId = String(req.params.classId || '').trim();
            if (!classId) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Missing classId.');
            }

            const classroomRef = deps.db.collection(CRM_CLASSROOMS).doc(classId);
            const classroomSnap = await classroomRef.get();
            if (!classroomSnap.exists) {
                return sendError(res, 404, 'CLASSROOM_NOT_FOUND', 'Classroom not found.');
            }

            const classroom = classroomSnap.data() || {};
            const payload = buildLiveSessionCreateData({
                ...(req.body || {}),
                classId,
                courseId: req.body?.courseId || classroom.courseId || null
            }, {
                user: req.user,
                serverTimestamp
            });

            const ref = classroomRef.collection(CLASSROOM_LIVE_SESSIONS).doc();
            await ref.set(payload);
            await writeAuditLog({
                action: 'classroom.live-session.create',
                entityType: 'live-session',
                entityId: ref.id,
                metadata: {
                    classId,
                    courseId: payload.courseId || null,
                    status: payload.status || null
                }
            }, { user: req.user });

            const createdSnap = await ref.get();
            return sendSuccess(res, {
                sessionId: ref.id,
                session: mapLiveSessionRecord(createdSnap, ref.id)
            }, 'Live session created.');
        } catch (error) {
            if ((error?.message || '').includes('Live session') || (error?.message || '').includes('meetingUrl') || (error?.message || '').includes('scheduledStartAt') || (error?.message || '').includes('status')) {
                return sendError(res, 400, 'VALIDATION_ERROR', error.message);
            }
            return sendError(res, 500, 'CREATE_LIVE_SESSION_ERROR', 'Failed to create live session.', error?.message || error);
        }
    });

    router.patch('/classrooms/:classId/live-sessions/:sessionId', ...requireAdminHandlers, async (req, res) => {
        try {
            const classId = String(req.params.classId || '').trim();
            const sessionId = String(req.params.sessionId || '').trim();
            if (!classId || !sessionId) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Missing classId or sessionId.');
            }

            const ref = deps.db.collection(CRM_CLASSROOMS)
                .doc(classId)
                .collection(CLASSROOM_LIVE_SESSIONS)
                .doc(sessionId);
            const snap = await ref.get();
            if (!snap.exists) {
                return sendError(res, 404, 'LIVE_SESSION_NOT_FOUND', 'Live session not found.');
            }

            const next = buildLiveSessionPatchData(snap.data() || {}, req.body || {}, {
                user: req.user,
                serverTimestamp
            });
            await ref.set(next, { merge: true });
            await writeAuditLog({
                action: 'classroom.live-session.update',
                entityType: 'live-session',
                entityId: sessionId,
                metadata: {
                    classId,
                    courseId: next.courseId || null,
                    status: next.status || null
                }
            }, { user: req.user });

            const updatedSnap = await ref.get();
            return sendSuccess(res, {
                session: mapLiveSessionRecord(updatedSnap, sessionId)
            }, 'Live session updated.');
        } catch (error) {
            if ((error?.message || '').includes('Live session') || (error?.message || '').includes('transition') || (error?.message || '').includes('meetingUrl') || (error?.message || '').includes('scheduledStartAt') || (error?.message || '').includes('status')) {
                return sendError(res, 400, 'VALIDATION_ERROR', error.message);
            }
            return sendError(res, 500, 'UPDATE_LIVE_SESSION_ERROR', 'Failed to update live session.', error?.message || error);
        }
    });

    router.post('/classrooms/:classId/live-sessions/:sessionId/start', ...requireAdminHandlers, async (req, res) => {
        try {
            const classId = String(req.params.classId || '').trim();
            const sessionId = String(req.params.sessionId || '').trim();
            if (!classId || !sessionId) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Missing classId or sessionId.');
            }

            const ref = deps.db.collection(CRM_CLASSROOMS)
                .doc(classId)
                .collection(CLASSROOM_LIVE_SESSIONS)
                .doc(sessionId);
            const snap = await ref.get();
            if (!snap.exists) {
                return sendError(res, 404, 'LIVE_SESSION_NOT_FOUND', 'Live session not found.');
            }

            const patch = buildLiveSessionStartPatch(snap.data() || {}, {
                user: req.user,
                serverTimestamp
            });
            await ref.set(patch, { merge: true });
            await writeAuditLog({
                action: 'classroom.live-session.start',
                entityType: 'live-session',
                entityId: sessionId,
                metadata: { classId }
            }, { user: req.user });

            const updatedSnap = await ref.get();
            return sendSuccess(res, {
                session: mapLiveSessionRecord(updatedSnap, sessionId)
            }, 'Live session started.');
        } catch (error) {
            if ((error?.message || '').includes('scheduled')) {
                return sendError(res, 400, 'VALIDATION_ERROR', error.message);
            }
            return sendError(res, 500, 'START_LIVE_SESSION_ERROR', 'Failed to start live session.', error?.message || error);
        }
    });

    router.post('/classrooms/:classId/live-sessions/:sessionId/end', ...requireAdminHandlers, async (req, res) => {
        try {
            const classId = String(req.params.classId || '').trim();
            const sessionId = String(req.params.sessionId || '').trim();
            if (!classId || !sessionId) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Missing classId or sessionId.');
            }

            const ref = deps.db.collection(CRM_CLASSROOMS)
                .doc(classId)
                .collection(CLASSROOM_LIVE_SESSIONS)
                .doc(sessionId);
            const snap = await ref.get();
            if (!snap.exists) {
                return sendError(res, 404, 'LIVE_SESSION_NOT_FOUND', 'Live session not found.');
            }

            const patch = buildLiveSessionEndPatch(snap.data() || {}, {
                user: req.user,
                serverTimestamp
            });
            await ref.set(patch, { merge: true });
            await writeAuditLog({
                action: 'classroom.live-session.end',
                entityType: 'live-session',
                entityId: sessionId,
                metadata: { classId }
            }, { user: req.user });

            const updatedSnap = await ref.get();
            return sendSuccess(res, {
                session: mapLiveSessionRecord(updatedSnap, sessionId)
            }, 'Live session ended.');
        } catch (error) {
            if ((error?.message || '').includes('live')) {
                return sendError(res, 400, 'VALIDATION_ERROR', error.message);
            }
            return sendError(res, 500, 'END_LIVE_SESSION_ERROR', 'Failed to end live session.', error?.message || error);
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

    router.post('/classrooms/:classId/submissions', ...requireAuthHandlers, async (req, res) => {
        try {
            const classId = String(req.params.classId || '').trim();
            const workId = String(req.body?.workId || '').trim();
            if (!classId) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Missing classId.');
            }
            if (!workId) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Missing workId.');
            }

            const studentUid = String(req.user?.uid || '').trim();
            if (!studentUid) {
                return sendError(res, 401, 'UNAUTHORIZED', 'Authentication required.');
            }

            const querySnap = await deps.db.collection(CRM_SUBMISSIONS)
                .where('classId', '==', classId)
                .where('workId', '==', workId)
                .where('studentUid', '==', studentUid)
                .limit(1)
                .get();

            const existingDoc = querySnap.empty ? null : querySnap.docs[0];
            const existingData = existingDoc ? (existingDoc.data() || {}) : null;

            if (existingData?.status === 'graded') {
                return sendError(res, 409, 'ALREADY_GRADED', 'This homework has already been graded.');
            }

            if (existingData?.status === 'turned-in') {
                return sendError(res, 409, 'ALREADY_SUBMITTED', 'Homework is already turned in.');
            }

            const context = {
                user: req.user,
                serverTimestamp
            };
            const payload = existingData
                ? buildHomeworkSubmissionResubmissionPatch(existingData, {
                    audio: req.body?.audio || null
                }, context)
                : buildHomeworkSubmissionCreateData({
                    classId,
                    workId,
                    studentUid,
                    studentEmail: req.user.email || null,
                    audio: req.body?.audio || null
                }, context);
            const submissionId = existingDoc?.id || buildHomeworkSubmissionDocId({ classId, workId, studentUid });
            const ref = deps.db.collection(CRM_SUBMISSIONS).doc(submissionId);

            await ref.set(payload, { merge: !!existingDoc });
            await writeAuditLog({
                action: existingData ? 'submission.resubmit' : 'submission.submit',
                entityType: 'submission',
                entityId: submissionId,
                metadata: {
                    classId,
                    workId,
                    status: payload.status || null,
                    revisionCount: payload.revisionCount || 1
                }
            }, { user: req.user });

            return sendSuccess(res, {
                submissionId,
                status: payload.status || null,
                revisionCount: payload.revisionCount || 1
            }, existingData ? 'Homework resubmitted.' : 'Homework submitted.');
        } catch (error) {
            return sendError(res, 500, 'SUBMIT_HOMEWORK_ERROR', 'Failed to submit homework.', error?.message || error);
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

            const patch = buildHomeworkSubmissionReturnPatch(snap.data() || {}, {
                feedback: req.body?.feedback ?? null
            }, {
                user: req.user,
                serverTimestamp
            });

            await ref.set(patch, { merge: true });
            await writeAuditLog({
                action: 'submission.return_for_revision',
                entityType: 'submission',
                entityId: submissionId,
                metadata: {
                    feedback: patch.feedback || null
                }
            }, { user: req.user });

            return sendSuccess(res, {
                submissionId,
                status: patch.status,
                revisionCount: Number(snap.data()?.revisionCount || 1)
            }, 'Submission returned for revision.');
        } catch (error) {
            return sendError(res, 500, 'RETURN_FOR_REVISION_ERROR', 'Failed to return submission for revision.', error?.message || error);
        }
    });

    router.post('/submissions/:submissionId/grade', ...requireAdminHandlers, async (req, res) => {
        try {
            const submissionId = String(req.params.submissionId || '').trim();
            if (!submissionId) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Missing submissionId.');
            }

            await deps.db.collection(CRM_SUBMISSIONS).doc(submissionId).update({
                grade: req.body?.grade ?? null,
                feedback: req.body?.feedback ?? null,
                gradedAt: serverTimestamp(),
                gradedBy: req.user.uid,
                status: 'graded'
            });
            await writeAuditLog({
                action: 'submission.grade',
                entityType: 'submission',
                entityId: submissionId,
                metadata: { grade: req.body?.grade ?? null }
            }, { user: req.user });

            return sendSuccess(res, {}, 'Submission graded.');
        } catch (error) {
            return sendError(res, 500, 'GRADE_ERROR', 'Failed to grade submission.', error?.message || error);
        }
    });

    if (typeof deps.registerExtraRoutes === 'function') {
        deps.registerExtraRoutes(router, routeDeps);
    }

    return router;
};
