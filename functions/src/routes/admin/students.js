const {
    CRM_STUDENTS
} = require('../../crm/collections');

function cleanOptionalString(value) {
    const normalized = String(value || '').trim();
    return normalized || null;
}

function sanitizeStudentCreatePayload(input) {
    return {
        name: cleanOptionalString(input.name),
        label: cleanOptionalString(input.label),
        phone: cleanOptionalString(input.phone),
        email: cleanOptionalString(input.email),
        zalo: cleanOptionalString(input.zalo),
        facebook: cleanOptionalString(input.facebook)
    };
}

function sanitizeStudentPatchPayload(input) {
    const patch = {};
    for (const key of ['name', 'label', 'phone', 'email', 'zalo', 'facebook']) {
        if (Object.prototype.hasOwnProperty.call(input, key)) {
            patch[key] = cleanOptionalString(input[key]);
        }
    }
    return patch;
}

function mapStudent(doc) {
    const data = doc.data() || {};
    return {
        studentId: doc.id,
        name: data.name || null,
        label: data.label || null,
        phone: data.phone || null,
        email: data.email || null,
        zalo: data.zalo || null,
        facebook: data.facebook || null,
        class_code: data.class_code || null,
        linked_user_ids: Array.isArray(data.linked_user_ids) ? data.linked_user_ids : [],
        createdAt: data.createdAt || null,
        createdBy: data.createdBy || null,
        createdByEmail: data.createdByEmail || null,
        updatedAt: data.updatedAt || null,
        updatedBy: data.updatedBy || null
    };
}

module.exports = function registerStudentRoutes(router, deps) {
    const { db, sendSuccess, sendError, requireAdminHandlers, serverTimestamp } = deps;

    router.post('/students', ...requireAdminHandlers, async (req, res) => {
        try {
            const fields = sanitizeStudentCreatePayload(req.body || {});
            const hasAny = Object.values(fields).some(Boolean);
            if (!hasAny) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Please fill at least 1 field in Info tab before saving.');
            }

            const ref = db.collection(CRM_STUDENTS).doc();
            await ref.set({
                ...fields,
                createdAt: serverTimestamp(),
                createdBy: req.user.uid,
                createdByEmail: req.user.email || null
            });

            return sendSuccess(res, { studentId: ref.id }, 'Student profile created.');
        } catch (error) {
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

            const students = snaps.docs.map(mapStudent);
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

            return sendSuccess(res, { student: mapStudent(snap) });
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

            const patch = sanitizeStudentPatchPayload(req.body || {});
            if (Object.keys(patch).length === 0) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'No student fields provided for update.');
            }

            const ref = db.collection(CRM_STUDENTS).doc(studentId);
            const snap = await ref.get();
            if (!snap.exists) {
                return sendError(res, 404, 'STUDENT_NOT_FOUND', 'Student profile not found.');
            }

            await ref.set({
                ...patch,
                updatedAt: serverTimestamp(),
                updatedBy: req.user.uid
            }, { merge: true });

            const updatedSnap = await ref.get();
            return sendSuccess(res, { student: mapStudent(updatedSnap) }, 'Student profile updated.');
        } catch (error) {
            return sendError(res, 500, 'UPDATE_STUDENT_ERROR', 'Failed to update student profile.', error?.message || error);
        }
    });
};
