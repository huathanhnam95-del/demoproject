const {
    CRM_STUDENTS,
    CRM_CLASSROOMS
} = require('../../crm/collections');
const {
    buildStudentCreateData,
    buildStudentPatchData,
    mapStudentRecord
} = require('../../crm/student-service');
const {
    buildClassroomMatches
} = require('../../crm/classroom-match-service');
const {
    mapClassroomRecord
} = require('../../crm/course-service');

module.exports = function registerStudentRoutes(router, deps) {
    const { db, sendSuccess, sendError, requireAdminHandlers, serverTimestamp, writeAuditLog } = deps;

    router.post('/students', ...requireAdminHandlers, async (req, res) => {
        try {
            const student = buildStudentCreateData(req.body || {}, {
                user: req.user,
                serverTimestamp
            });

            const ref = db.collection(CRM_STUDENTS).doc();
            await ref.set(student);
            await writeAuditLog?.({
                action: 'student.create',
                entityType: 'student',
                entityId: ref.id
            }, { user: req.user });

            return sendSuccess(res, { studentId: ref.id }, 'Student profile created.');
        } catch (error) {
            if ((error?.message || '').includes('Please fill at least 1 field')) {
                return sendError(res, 400, 'VALIDATION_ERROR', error.message);
            }
            return sendError(res, 500, 'CREATE_STUDENT_ERROR', 'Failed to create student profile.', error?.message || error);
        }
    });

    router.get('/students', ...requireAdminHandlers, async (req, res) => {
        try {
            const requestedLimit = Number(req.query?.limit);
            const limit = Number.isFinite(requestedLimit)
                ? Math.min(500, Math.max(1, Math.floor(requestedLimit)))
                : 200;

            const snaps = await db
                .collection(CRM_STUDENTS)
                .orderBy('createdAt', 'desc')
                .limit(limit)
                .get();

            const students = snaps.docs.map((doc) => mapStudentRecord(doc, doc.id));
            return sendSuccess(res, { students, count: students.length });
        } catch (error) {
            return sendError(res, 500, 'LIST_STUDENTS_ERROR', 'Failed to list student profiles.', error?.message || error);
        }
    });

    router.get('/students/:studentId', ...requireAdminHandlers, async (req, res) => {
        try {
            const studentId = String(req.params.studentId || '').trim();
            if (!studentId) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Missing or invalid studentId.');
            }

            const snap = await db.collection(CRM_STUDENTS).doc(studentId).get();
            if (!snap.exists) {
                return sendError(res, 404, 'STUDENT_NOT_FOUND', 'Student profile not found.');
            }

            return sendSuccess(res, { student: mapStudentRecord(snap, studentId) });
        } catch (error) {
            return sendError(res, 500, 'GET_STUDENT_ERROR', 'Failed to fetch student profile.', error?.message || error);
        }
    });

    router.get('/students/:studentId/classroom-matches', ...requireAdminHandlers, async (req, res) => {
        try {
            const studentId = String(req.params.studentId || '').trim();
            if (!studentId) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Missing or invalid studentId.');
            }

            const studentSnap = await db.collection(CRM_STUDENTS).doc(studentId).get();
            if (!studentSnap.exists) {
                return sendError(res, 404, 'STUDENT_NOT_FOUND', 'Student profile not found.');
            }

            const requestedCourseId = String(req.query?.courseId || '').trim();
            const classroomsSnap = await db
                .collection(CRM_CLASSROOMS)
                .where('status', '==', 'active')
                .limit(500)
                .get();

            const classrooms = classroomsSnap.docs.map((doc) => mapClassroomRecord(doc, doc.id));
            const student = mapStudentRecord(studentSnap, studentId);
            const matchPayload = buildClassroomMatches({
                student,
                classrooms,
                courseId: requestedCourseId || null
            });

            return sendSuccess(res, {
                student,
                classroomCount: matchPayload.classroomCount,
                courseId: matchPayload.courseId,
                recommendedClassroom: matchPayload.recommendedClassroom,
                matches: matchPayload.matches
            });
        } catch (error) {
            return sendError(res, 500, 'CLASSROOM_MATCH_ERROR', 'Failed to load classroom matches.', error?.message || error);
        }
    });

    router.patch('/students/:studentId', ...requireAdminHandlers, async (req, res) => {
        try {
            const studentId = String(req.params.studentId || '').trim();
            if (!studentId) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Missing or invalid studentId.');
            }

            const ref = db.collection(CRM_STUDENTS).doc(studentId);
            const snap = await ref.get();
            if (!snap.exists) {
                return sendError(res, 404, 'STUDENT_NOT_FOUND', 'Student profile not found.');
            }

            const next = buildStudentPatchData(snap.data() || {}, req.body || {}, {
                user: req.user,
                serverTimestamp
            });
            await ref.set(next, { merge: true });
            await writeAuditLog?.({
                action: 'student.update',
                entityType: 'student',
                entityId: studentId
            }, { user: req.user });

            const updatedSnap = await ref.get();
            return sendSuccess(res, { student: mapStudentRecord(updatedSnap, studentId) }, 'Student profile updated.');
        } catch (error) {
            if ((error?.message || '').includes('No student fields provided')) {
                return sendError(res, 400, 'VALIDATION_ERROR', error.message);
            }
            return sendError(res, 500, 'UPDATE_STUDENT_ERROR', 'Failed to update student profile.', error?.message || error);
        }
    });
};
