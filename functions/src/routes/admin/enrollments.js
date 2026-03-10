const {
    CRM_ENROLLMENTS,
    CRM_STUDENTS,
    CRM_CLASSROOMS,
    CLASSROOM_MEMBERS
} = require('../../crm/collections');
const {
    buildEnrollmentCreateData,
    buildEnrollmentPatchData,
    buildClassroomMemberData,
    mapEnrollmentRecord
} = require('../../crm/enrollment-service');

module.exports = function registerEnrollmentRoutes(router, deps) {
    const { db, sendSuccess, sendError, requireAdminHandlers, serverTimestamp } = deps;

    router.post('/enrollments', ...requireAdminHandlers, async (req, res) => {
        try {
            const payload = req.body && typeof req.body === 'object' ? { ...req.body } : {};
            if (payload.studentId) {
                const studentSnap = await db.collection(CRM_STUDENTS).doc(String(payload.studentId).trim()).get();
                if (studentSnap.exists) {
                    const student = studentSnap.data() || {};
                    payload.studentName = payload.studentName || student.name || student.email || null;
                    payload.studentEmail = payload.studentEmail || student.email || null;
                    const linked = Array.isArray(student.linked_user_ids) ? student.linked_user_ids : [];
                    payload.studentUid = payload.studentUid || linked[0] || null;
                }
            }

            if (payload.classId && !payload.courseId) {
                const classSnap = await db.collection(CRM_CLASSROOMS).doc(String(payload.classId).trim()).get();
                if (classSnap.exists) {
                    payload.courseId = payload.courseId || classSnap.data()?.courseId || null;
                }
            }

            const existingSnap = await db.collection(CRM_ENROLLMENTS)
                .where('classId', '==', String(payload.classId || '').trim())
                .where('studentId', '==', String(payload.studentId || '').trim())
                .limit(1)
                .get();

            if (!existingSnap.empty) {
                const existingDoc = existingSnap.docs[0];
                return sendSuccess(res, {
                    deduped: true,
                    enrollment: mapEnrollmentRecord(existingDoc, existingDoc.id)
                }, 'Enrollment already exists.');
            }

            const enrollment = buildEnrollmentCreateData(payload, {
                user: req.user,
                serverTimestamp
            });
            const ref = db.collection(CRM_ENROLLMENTS).doc();
            await ref.set(enrollment);

            if (enrollment.studentUid) {
                await db.collection(CRM_CLASSROOMS)
                    .doc(enrollment.classId)
                    .collection(CLASSROOM_MEMBERS)
                    .doc(enrollment.studentUid)
                    .set(buildClassroomMemberData(enrollment), { merge: true });
            }

            const snap = await ref.get();
            return sendSuccess(res, {
                enrollmentId: ref.id,
                enrollment: mapEnrollmentRecord(snap, ref.id)
            }, 'Enrollment created.');
        } catch (error) {
            const message = String(error?.message || '');
            if (message.includes('Enrollment requires') || message.includes('Invalid enrollment status')) {
                return sendError(res, 400, 'VALIDATION_ERROR', error.message);
            }
            return sendError(res, 500, 'CREATE_ENROLLMENT_ERROR', 'Failed to create enrollment.', error?.message || error);
        }
    });

    router.patch('/enrollments/:enrollmentId', ...requireAdminHandlers, async (req, res) => {
        try {
            const enrollmentId = String(req.params.enrollmentId || '').trim();
            if (!enrollmentId) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Missing enrollmentId.');
            }

            const ref = db.collection(CRM_ENROLLMENTS).doc(enrollmentId);
            const snap = await ref.get();
            if (!snap.exists) {
                return sendError(res, 404, 'ENROLLMENT_NOT_FOUND', 'Enrollment not found.');
            }

            const next = buildEnrollmentPatchData(snap.data() || {}, req.body || {}, {
                user: req.user,
                serverTimestamp
            });
            await ref.set(next, { merge: true });

            if (next.studentUid) {
                const memberRef = db.collection(CRM_CLASSROOMS)
                    .doc(next.classId)
                    .collection(CLASSROOM_MEMBERS)
                    .doc(next.studentUid);

                if (['inactive', 'withdrawn'].includes(String(next.status || ''))) {
                    await memberRef.delete().catch(() => null);
                } else {
                    await memberRef.set(buildClassroomMemberData(next), { merge: true });
                }
            }

            const updatedSnap = await ref.get();
            return sendSuccess(res, {
                enrollment: mapEnrollmentRecord(updatedSnap, enrollmentId)
            }, 'Enrollment updated.');
        } catch (error) {
            const message = String(error?.message || '');
            if (message.includes('No enrollment fields provided') || message.includes('Invalid enrollment status')) {
                return sendError(res, 400, 'VALIDATION_ERROR', error.message);
            }
            return sendError(res, 500, 'UPDATE_ENROLLMENT_ERROR', 'Failed to update enrollment.', error?.message || error);
        }
    });
};
