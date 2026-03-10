const {
    CRM_COURSES
} = require('../../crm/collections');
const {
    buildCourseCreateData,
    buildCoursePatchData,
    mapCourseRecord
} = require('../../crm/course-service');

module.exports = function registerCourseRoutes(router, deps) {
    const { db, sendSuccess, sendError, requireAdminHandlers, serverTimestamp } = deps;

    router.get('/courses', ...requireAdminHandlers, async (req, res) => {
        try {
            const requestedLimit = Number(req.query?.limit);
            const limit = Number.isFinite(requestedLimit)
                ? Math.min(500, Math.max(1, Math.floor(requestedLimit)))
                : 200;

            const snaps = await db
                .collection(CRM_COURSES)
                .orderBy('createdAt', 'desc')
                .limit(limit)
                .get();

            const courses = snaps.docs.map((doc) => mapCourseRecord(doc, doc.id));
            return sendSuccess(res, { courses, count: courses.length });
        } catch (error) {
            return sendError(res, 500, 'LIST_COURSES_ERROR', 'Failed to list courses.', error?.message || error);
        }
    });

    router.post('/courses', ...requireAdminHandlers, async (req, res) => {
        try {
            const course = buildCourseCreateData(req.body || {}, {
                user: req.user,
                serverTimestamp
            });

            const ref = db.collection(CRM_COURSES).doc();
            await ref.set(course);

            return sendSuccess(res, { courseId: ref.id }, 'Course created.');
        } catch (error) {
            if ((error?.message || '').includes('course name')) {
                return sendError(res, 400, 'VALIDATION_ERROR', error.message);
            }
            return sendError(res, 500, 'CREATE_COURSE_ERROR', 'Failed to create course.', error?.message || error);
        }
    });

    router.patch('/courses/:courseId', ...requireAdminHandlers, async (req, res) => {
        try {
            const courseId = String(req.params.courseId || '').trim();
            if (!courseId) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Missing or invalid courseId.');
            }

            const ref = db.collection(CRM_COURSES).doc(courseId);
            const snap = await ref.get();
            if (!snap.exists) {
                return sendError(res, 404, 'COURSE_NOT_FOUND', 'Course not found.');
            }

            const next = buildCoursePatchData(snap.data() || {}, req.body || {}, {
                user: req.user,
                serverTimestamp
            });
            await ref.set(next, { merge: true });

            const updatedSnap = await ref.get();
            return sendSuccess(res, { course: mapCourseRecord(updatedSnap, courseId) }, 'Course updated.');
        } catch (error) {
            if ((error?.message || '').includes('course name') || (error?.message || '').includes('No course fields')) {
                return sendError(res, 400, 'VALIDATION_ERROR', error.message);
            }
            return sendError(res, 500, 'UPDATE_COURSE_ERROR', 'Failed to update course.', error?.message || error);
        }
    });
};
