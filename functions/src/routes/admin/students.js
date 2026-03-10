const {
    CRM_STUDENTS
} = require('../../crm/collections');
const {
    buildStudentCreateData,
    buildStudentPatchData,
    mapStudentRecord
} = require('../../crm/student-service');

module.exports = function registerStudentRoutes(router, deps) {
    const { db, sendSuccess, sendError, requireAdminHandlers, serverTimestamp } = deps;

    router.post('/students', ...requireAdminHandlers, async (req, res) => {
        try {
            const student = buildStudentCreateData(req.body || {}, {
                user: req.user,
                serverTimestamp
            });

            const ref = db.collection(CRM_STUDENTS).doc();
            await ref.set(student);

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
