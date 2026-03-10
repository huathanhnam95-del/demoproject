const express = require('express');
const {
    USERS,
    CRM_CLASSROOMS,
    CRM_SUBMISSIONS,
    CLASSROOM_MODULES,
    CLASSROOM_CLASSWORK
} = require('../../crm/collections');
const {
    sendSuccess: defaultSendSuccess,
    sendError: defaultSendError
} = require('../../crm/http-contracts');
const registerStudentRoutes = require('./students');
const registerCourseRoutes = require('./courses');
const registerIdentityRoutes = require('./identity');

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

    const routeDeps = {
        ...deps,
        sendSuccess,
        sendError,
        requireAuthHandlers,
        requireAdminHandlers,
        serverTimestamp
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

    router.post('/classrooms', ...requireAdminHandlers, async (req, res) => {
        try {
            const name = String(req.body?.name || '').trim();
            const courseId = String(req.body?.courseId || '').trim() || null;
            const status = String(req.body?.status || '').trim() || 'draft';

            if (!name) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Classroom name is required.');
            }

            const ref = deps.db.collection(CRM_CLASSROOMS).doc();
            await ref.set({
                name,
                courseId,
                status,
                createdAt: serverTimestamp(),
                createdBy: req.user.uid
            });

            return sendSuccess(res, { classroomId: ref.id }, 'Classroom created.');
        } catch (error) {
            return sendError(res, 500, 'CREATE_CLASSROOM_ERROR', 'Failed to create classroom.', error?.message || error);
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

            return sendSuccess(res, { classworkId: ref.id }, 'Classwork created.');
        } catch (error) {
            return sendError(res, 500, 'CREATE_CLASSWORK_ERROR', 'Failed to create classwork.', error?.message || error);
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
