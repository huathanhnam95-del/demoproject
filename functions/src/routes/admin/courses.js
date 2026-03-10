const {
    CRM_COURSES
} = require('../../crm/collections');

function cleanOptionalString(value, fallback = null) {
    const normalized = String(value || '').trim();
    return normalized || fallback;
}

function sanitizeTeachers(rawTeachers) {
    if (!Array.isArray(rawTeachers)) return [];
    return rawTeachers
        .map((teacher) => String(teacher || '').trim().toLowerCase())
        .filter(Boolean);
}

function sanitizeCourseCreatePayload(input) {
    return {
        name: cleanOptionalString(input.name, ''),
        code: cleanOptionalString(input.code),
        label: cleanOptionalString(input.label),
        level: cleanOptionalString(input.level),
        category: cleanOptionalString(input.category),
        status: cleanOptionalString(input.status, 'active') || 'active',
        description: cleanOptionalString(input.description),
        teachers: sanitizeTeachers(input.teachers)
    };
}

function sanitizeCoursePatchPayload(input) {
    const patch = {};

    for (const key of ['name', 'code', 'label', 'level', 'category', 'status', 'description']) {
        if (Object.prototype.hasOwnProperty.call(input, key)) {
            patch[key] = key === 'name'
                ? cleanOptionalString(input[key], '')
                : cleanOptionalString(input[key]);
        }
    }

    if (Object.prototype.hasOwnProperty.call(input, 'teachers')) {
        patch.teachers = sanitizeTeachers(input.teachers);
    }

    return patch;
}

function mapCourse(doc) {
    const data = doc.data() || {};
    return {
        courseId: doc.id,
        name: data.name || '',
        code: data.code || null,
        label: data.label || null,
        level: data.level || null,
        category: data.category || null,
        status: data.status || 'active',
        description: data.description || null,
        teachers: Array.isArray(data.teachers) ? data.teachers : [],
        createdAt: data.createdAt || null,
        createdBy: data.createdBy || null,
        createdByEmail: data.createdByEmail || null,
        updatedAt: data.updatedAt || null,
        updatedBy: data.updatedBy || null
    };
}

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

            const courses = snaps.docs.map(mapCourse);
            return sendSuccess(res, { courses, count: courses.length });
        } catch (error) {
            return sendError(res, 500, 'LIST_COURSES_ERROR', 'Failed to list courses.', error?.message || error);
        }
    });

    router.post('/courses', ...requireAdminHandlers, async (req, res) => {
        try {
            const fields = sanitizeCourseCreatePayload(req.body || {});
            if (!fields.name) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Please provide a course name before saving.');
            }

            const ref = db.collection(CRM_COURSES).doc();
            await ref.set({
                ...fields,
                createdAt: serverTimestamp(),
                createdBy: req.user.uid,
                createdByEmail: req.user.email || null
            });

            return sendSuccess(res, { courseId: ref.id }, 'Course created.');
        } catch (error) {
            return sendError(res, 500, 'CREATE_COURSE_ERROR', 'Failed to create course.', error?.message || error);
        }
    });

    router.patch('/courses/:courseId', ...requireAdminHandlers, async (req, res) => {
        try {
            const courseId = String(req.params.courseId || '').trim();
            if (!courseId) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Missing or invalid courseId.');
            }

            const patch = sanitizeCoursePatchPayload(req.body || {});
            if (Object.keys(patch).length === 0) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'No course fields provided for update.');
            }

            if (Object.prototype.hasOwnProperty.call(patch, 'name') && !patch.name) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Please provide a course name before saving.');
            }

            const ref = db.collection(CRM_COURSES).doc(courseId);
            const snap = await ref.get();
            if (!snap.exists) {
                return sendError(res, 404, 'COURSE_NOT_FOUND', 'Course not found.');
            }

            await ref.set({
                ...patch,
                updatedAt: serverTimestamp(),
                updatedBy: req.user.uid
            }, { merge: true });

            const updatedSnap = await ref.get();
            return sendSuccess(res, { course: mapCourse(updatedSnap) }, 'Course updated.');
        } catch (error) {
            return sendError(res, 500, 'UPDATE_COURSE_ERROR', 'Failed to update course.', error?.message || error);
        }
    });
};
