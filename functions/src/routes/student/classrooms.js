const express = require('express');
const {
    CRM_ENROLLMENTS,
    CRM_CLASSROOMS,
    CRM_STUDENTS
} = require('../../crm/collections');

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
