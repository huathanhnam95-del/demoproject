const express = require('express');
const {
    CRM_ENROLLMENTS,
    CRM_CLASSROOMS,
    CRM_STUDENTS,
    CRM_SUBMISSIONS
} = require('../../crm/collections');
const {
    buildHomeworkSubmissionDocId,
    buildHomeworkSubmissionCreateData,
    buildHomeworkSubmissionResubmissionPatch
} = require('../../crm/homework-service');

function uniqueStrings(values) {
    const out = [];
    const seen = new Set();
    for (const value of values || []) {
        const normalized = String(value || '').trim();
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        out.push(normalized);
    }
    return out;
}

module.exports = function createStudentClassroomsRouter(deps = {}) {
    const router = express.Router();
    const db = deps.db;
    const authMiddleware = deps.authMiddleware;
    const sendSuccess = deps.sendSuccess || ((res, data = {}, msg = 'OK') => res.json({ success: true, message: msg, ...data }));
    const sendError = deps.sendError || ((res, status = 500, error = 'INTERNAL_ERROR', msg = 'Request failed.', details = null) => res.status(status).json({ success: false, error, message: msg, ...(details ? { details } : {}) }));

    const requireAuthHandlers = Array.isArray(authMiddleware) ? authMiddleware : (authMiddleware ? [authMiddleware] : []);

    router.post(['/classrooms/:classId/classwork/:workId/submissions', '/student/classrooms/:classId/classwork/:workId/submissions'], ...requireAuthHandlers, async (req, res) => {
        try {
            if (!db || typeof db.collection !== 'function') {
                return sendError(res, 500, 'SERVER_CONFIG_ERROR', 'Firebase Admin not initialized.');
            }

            const uid = String(req.user?.uid || '').trim();
            if (!uid) {
                return sendError(res, 401, 'UNAUTHORIZED', 'Missing user context.');
            }

            const classId = String(req.params.classId || '').trim();
            const workId = String(req.params.workId || '').trim();
            if (!classId || !workId) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'classId and workId are required.');
            }

            const isAdmin = req.user?.isAdmin === true || String(req.user?.role || '').toLowerCase() === 'admin' || String(req.user?.crmRole || '').toLowerCase() === 'admin';

            // Verify classroom exists
            const classSnap = await db.collection(CRM_CLASSROOMS).doc(classId).get();
            if (!classSnap.exists) {
                return sendError(res, 404, 'CLASSROOM_NOT_FOUND', 'Classroom does not exist.');
            }

            // Verify classwork exists
            const workSnap = await db.collection(CRM_CLASSROOMS).doc(classId).collection('classwork').doc(workId).get();
            if (!workSnap.exists) {
                return sendError(res, 404, 'WORK_NOT_FOUND', 'Classwork assignment does not exist.');
            }

            // Verify membership if not admin
            if (!isAdmin) {
                const memberSnap = await db.collection(CRM_CLASSROOMS).doc(classId).collection('members').doc(uid).get();
                let isMember = memberSnap.exists;
                if (!isMember) {
                    const [enrollmentSnap, linkedStudentsSnap] = await Promise.all([
                        db.collection(CRM_ENROLLMENTS).where('classId', '==', classId).where('studentUid', '==', uid).get().catch(() => ({ docs: [] })),
                        db.collection(CRM_STUDENTS).where('linked_user_ids', 'array-contains', uid).get().catch(() => ({ docs: [] }))
                    ]);
                    if (enrollmentSnap.docs.some((d) => String(d.data()?.status || 'active').toLowerCase() === 'active')) {
                        isMember = true;
                    } else if (linkedStudentsSnap.docs.length > 0) {
                        const studentIds = linkedStudentsSnap.docs.map((d) => d.id);
                        const extraSnap = await db.collection(CRM_ENROLLMENTS).where('classId', '==', classId).where('studentId', 'in', studentIds.slice(0, 10)).get().catch(() => ({ docs: [] }));
                        if (extraSnap.docs.some((d) => String(d.data()?.status || 'active').toLowerCase() === 'active')) {
                            isMember = true;
                        }
                    }
                }
                if (!isMember) {
                    return sendError(res, 403, 'FORBIDDEN', 'User is not enrolled in this classroom.');
                }
            }

            const body = req.body || {};
            const audioData = body.audio && typeof body.audio === 'object' ? body.audio : null;

            const submissionId = buildHomeworkSubmissionDocId({ classId, workId, studentUid: uid });
            const docRef = db.collection(CRM_SUBMISSIONS).doc(submissionId);
            let targetRef = docRef;
            let targetSnap = await docRef.get();

            if (!targetSnap.exists) {
                const legacySnap = await db.collection(CRM_SUBMISSIONS)
                    .where('classId', '==', classId)
                    .where('workId', '==', workId)
                    .where('studentUid', '==', uid)
                    .limit(1)
                    .get();
                if (!legacySnap.empty) {
                    targetRef = legacySnap.docs[0].ref;
                    targetSnap = legacySnap.docs[0];
                }
            }

            if (targetSnap.exists) {
                const existingData = targetSnap.data() || {};
                const currentStatus = String(existingData.status || '').toLowerCase();

                if (currentStatus === 'graded') {
                    return sendError(res, 400, 'SUBMISSION_LOCKED', 'Assignment has already been evaluated and cannot be modified.');
                }

                if (currentStatus === 'needs-revision') {
                    const patch = buildHomeworkSubmissionResubmissionPatch(existingData, { audio: audioData }, {
                        user: req.user,
                        serverTimestamp: deps.serverTimestamp
                    });
                    await targetRef.update(patch);
                    return sendSuccess(res, { submissionId: targetRef.id, status: 'turned-in' }, 'Assignment resubmitted successfully.');
                }

                const timestamp = typeof deps.serverTimestamp === 'function' ? deps.serverTimestamp() : new Date();
                await targetRef.update({
                    audio: audioData,
                    status: 'turned-in',
                    latestSubmittedAt: timestamp,
                    updatedAt: timestamp
                });
                return sendSuccess(res, { submissionId: targetRef.id, status: 'turned-in' }, 'Assignment submission updated successfully.');
            }

            const submissionData = buildHomeworkSubmissionCreateData({
                classId,
                workId,
                studentUid: uid,
                studentEmail: req.user?.email || null,
                audio: audioData
            }, {
                user: req.user,
                serverTimestamp: deps.serverTimestamp
            });

            await docRef.set(submissionData);
            return sendSuccess(res, { submissionId: docRef.id, status: 'turned-in' }, 'Assignment submitted successfully.');
        } catch (error) {
            return sendError(res, 500, 'SUBMISSION_ERROR', 'Failed to process assignment submission.', error?.message || error);
        }
    });

    router.get(['/classrooms', '/student/classrooms'], ...requireAuthHandlers, async (req, res) => {
        try {
            if (!db || typeof db.collection !== 'function') {
                return sendError(res, 500, 'SERVER_CONFIG_ERROR', 'Firebase Admin not initialized.');
            }

            const uid = String(req.user?.uid || '').trim();
            if (!uid) {
                return sendError(res, 401, 'UNAUTHORIZED', 'Missing user context.');
            }

            const isAdmin = req.user?.isAdmin === true || String(req.user?.role || '').toLowerCase() === 'admin' || String(req.user?.crmRole || '').toLowerCase() === 'admin';

            let classIds = [];
            if (isAdmin) {
                const adminClassSnap = await db.collection(CRM_CLASSROOMS).get();
                classIds = adminClassSnap.docs.map((doc) => doc.id);
            } else {
                const [uidEnrollmentsSnap, studentIdSnap, linkedStudentsSnap, teacherClassSnap] = await Promise.all([
                    db.collection(CRM_ENROLLMENTS).where('studentUid', '==', uid).get().catch(() => ({ docs: [] })),
                    db.collection(CRM_ENROLLMENTS).where('studentId', '==', uid).get().catch(() => ({ docs: [] })),
                    db.collection(CRM_STUDENTS).where('linked_user_ids', 'array-contains', uid).get().catch(() => ({ docs: [] })),
                    db.collection(CRM_CLASSROOMS).where('primaryTeacherUid', '==', uid).get().catch(() => ({ docs: [] }))
                ]);

                const linkedStudentIds = linkedStudentsSnap.docs.map((doc) => String(doc.id || '').trim()).filter(Boolean);
                const extraStudentIdSnap = linkedStudentIds.length > 0
                    ? await db.collection(CRM_ENROLLMENTS).where('studentId', 'in', linkedStudentIds.slice(0, 10)).get().catch(() => ({ docs: [] }))
                    : { docs: [] };

                const enrollmentById = new Map();
                for (const snap of [uidEnrollmentsSnap, studentIdSnap, extraStudentIdSnap]) {
                    for (const doc of snap.docs || []) {
                        if (!enrollmentById.has(doc.id)) {
                            enrollmentById.set(doc.id, doc.data() || {});
                        }
                    }
                }

                const activeEnrollments = Array.from(enrollmentById.values())
                    .filter((row) => String(row.status || 'active').toLowerCase() === 'active');

                const enrolledClassIds = activeEnrollments.map((row) => row.classId);
                const teacherClassIds = teacherClassSnap.docs.map((doc) => doc.id);
                classIds = uniqueStrings([...enrolledClassIds, ...teacherClassIds]);
            }

            if (classIds.length === 0) {
                return sendSuccess(res, { classrooms: [], count: 0 });
            }

            const classroomSnaps = await Promise.all(
                classIds.map((classId) => db.collection(CRM_CLASSROOMS).doc(classId).get().catch(() => null))
            );

            const classrooms = classroomSnaps
                .filter((snap) => snap && snap.exists)
                .map((snap) => {
                    const data = snap.data() || {};
                    return {
                        id: snap.id,
                        classroomId: snap.id,
                        name: data.name || '',
                        courseId: data.courseId || null,
                        status: data.status || 'draft',
                        schedule: data.schedule || null,
                        scheduleConfig: data.scheduleConfig || null,
                        primaryTeacherUid: data.primaryTeacherUid || null,
                        primaryTeacherName: data.primaryTeacherName || null
                    };
                })
                .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

            return sendSuccess(res, { classrooms, count: classrooms.length });
        } catch (error) {
            return sendError(res, 500, 'LIST_CLASSROOMS_ERROR', 'Failed to list classrooms.', error?.message || error);
        }
    });

    return router;
};
