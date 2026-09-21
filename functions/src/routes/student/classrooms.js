const express = require('express');
const crypto = require('crypto');
const {
    CRM_ENROLLMENTS,
    CRM_CLASSROOMS,
    CRM_STUDENTS,
    CRM_SUBMISSIONS,
    CRM_SUBMISSION_UPLOAD_SLOTS
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

const SUBMISSION_UPLOAD_SLOT_TTL_MS = 10 * 60 * 1000;

function routeError(status, code, message) {
    const error = new Error(message);
    error.status = status;
    error.code = code;
    return error;
}

function timestampMillis(value) {
    if (value && typeof value.toMillis === 'function') return value.toMillis();
    if (value instanceof Date) return value.getTime();
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : NaN;
}

async function resolveSubmissionScope(db, req) {
    const uid = String(req.user?.uid || '').trim();
    if (!uid) throw routeError(401, 'UNAUTHORIZED', 'Missing user context.');

    const classId = String(req.params.classId || '').trim();
    const workId = String(req.params.workId || '').trim();
    if (!classId || !workId) throw routeError(400, 'VALIDATION_ERROR', 'classId and workId are required.');

    const isAdmin = req.user?.isAdmin === true
        || String(req.user?.role || '').toLowerCase() === 'admin'
        || String(req.user?.crmRole || '').toLowerCase() === 'admin';
    const classSnap = await db.collection(CRM_CLASSROOMS).doc(classId).get();
    if (!classSnap.exists) throw routeError(404, 'CLASSROOM_NOT_FOUND', 'Classroom does not exist.');

    const workSnap = await db.collection(CRM_CLASSROOMS).doc(classId).collection('classwork').doc(workId).get();
    if (!workSnap.exists) throw routeError(404, 'WORK_NOT_FOUND', 'Classwork assignment does not exist.');

    if (!isAdmin) {
        const memberSnap = await db.collection(CRM_CLASSROOMS).doc(classId).collection('members').doc(uid).get();
        let isMember = memberSnap.exists;
        if (!isMember) {
            const [enrollmentSnap, linkedStudentsSnap] = await Promise.all([
                db.collection(CRM_ENROLLMENTS).where('classId', '==', classId).where('studentUid', '==', uid).get().catch(() => ({ docs: [] })),
                db.collection(CRM_STUDENTS).where('linked_user_ids', 'array-contains', uid).get().catch(() => ({ docs: [] }))
            ]);
            if (enrollmentSnap.docs.some((doc) => String(doc.data()?.status || 'active').toLowerCase() === 'active')) {
                isMember = true;
            } else if (linkedStudentsSnap.docs.length > 0) {
                const studentIds = linkedStudentsSnap.docs.map((doc) => doc.id);
                const extraSnap = await db.collection(CRM_ENROLLMENTS).where('classId', '==', classId).where('studentId', 'in', studentIds.slice(0, 10)).get().catch(() => ({ docs: [] }));
                isMember = extraSnap.docs.some((doc) => String(doc.data()?.status || 'active').toLowerCase() === 'active');
            }
        }
        if (!isMember) throw routeError(403, 'FORBIDDEN', 'User is not enrolled in this classroom.');
    }

    return { uid, classId, workId };
}

async function resolveSubmissionRef(db, { classId, workId, uid }) {
    const submissionId = buildHomeworkSubmissionDocId({ classId, workId, studentUid: uid });
    const docRef = db.collection(CRM_SUBMISSIONS).doc(submissionId);
    const docSnap = await docRef.get();
    if (docSnap.exists) return { ref: docRef, snap: docSnap };

    const legacySnap = await db.collection(CRM_SUBMISSIONS)
        .where('classId', '==', classId)
        .where('workId', '==', workId)
        .where('studentUid', '==', uid)
        .limit(1)
        .get();
    if (!legacySnap.empty) return { ref: legacySnap.docs[0].ref, snap: legacySnap.docs[0] };
    return { ref: docRef, snap: docSnap };
}

module.exports = function createStudentClassroomsRouter(deps = {}) {
    const router = express.Router();
    const db = deps.db;
    const authMiddleware = deps.authMiddleware;
    const sendSuccess = deps.sendSuccess || ((res, data = {}, msg = 'OK') => res.json({ success: true, message: msg, ...data }));
    const sendError = deps.sendError || ((res, status = 500, error = 'INTERNAL_ERROR', msg = 'Request failed.', details = null) => res.status(status).json({ success: false, error, message: msg, ...(details ? { details } : {}) }));

    const requireAuthHandlers = Array.isArray(authMiddleware) ? authMiddleware : (authMiddleware ? [authMiddleware] : []);

    router.post(['/classrooms/:classId/classwork/:workId/submissions/upload-intent', '/student/classrooms/:classId/classwork/:workId/submissions/upload-intent'], ...requireAuthHandlers, async (req, res) => {
        try {
            if (!db || typeof db.collection !== 'function') {
                return sendError(res, 500, 'SERVER_CONFIG_ERROR', 'Firebase Admin not initialized.');
            }
            const scope = await resolveSubmissionScope(db, req);
            const { snap } = await resolveSubmissionRef(db, scope);
            if (snap.exists && String(snap.data()?.status || '').toLowerCase() !== 'needs-revision') {
                return sendError(res, 409, 'SUBMISSION_LOCKED', 'A new recording is only allowed after the assignment is returned for revision.');
            }

            const uploadIntentId = `${crypto.randomUUID()}.webm`;
            const storagePath = `uploads/${scope.classId}/${scope.workId}/${scope.uid}/${uploadIntentId}`;
            const expiresAt = new Date(Date.now() + SUBMISSION_UPLOAD_SLOT_TTL_MS);
            const createdAt = typeof deps.serverTimestamp === 'function' ? deps.serverTimestamp() : new Date();
            await db.collection(CRM_SUBMISSION_UPLOAD_SLOTS).doc(uploadIntentId).set({
                classId: scope.classId,
                workId: scope.workId,
                studentUid: scope.uid,
                storagePath,
                status: 'prepared',
                createdAt,
                expiresAt
            });
            return sendSuccess(res, {
                uploadIntentId,
                storagePath,
                filename: uploadIntentId,
                expiresAt: expiresAt.toISOString()
            }, 'Upload slot prepared.');
        } catch (error) {
            return sendError(res, error.status || 500, error.code || 'UPLOAD_INTENT_ERROR', error.status ? error.message : 'Failed to prepare upload slot.', error.status ? null : (error?.message || error));
        }
    });

    router.post(['/classrooms/:classId/classwork/:workId/submissions', '/student/classrooms/:classId/classwork/:workId/submissions'], ...requireAuthHandlers, async (req, res) => {
        try {
            if (!db || typeof db.collection !== 'function') {
                return sendError(res, 500, 'SERVER_CONFIG_ERROR', 'Firebase Admin not initialized.');
            }

            const { uid, classId, workId } = await resolveSubmissionScope(db, req);

            const body = req.body || {};
            const audioData = body.audio && typeof body.audio === 'object' ? body.audio : null;
            const uploadIntentId = String(body.uploadIntentId || '').trim();
            if (audioData && !uploadIntentId) throw routeError(400, 'INVALID_UPLOAD_INTENT', 'Audio submissions require a prepared upload slot.');

            const { ref: targetRef } = await resolveSubmissionRef(db, { classId, workId, uid });
            const slotRef = uploadIntentId ? db.collection(CRM_SUBMISSION_UPLOAD_SLOTS).doc(uploadIntentId) : null;
            const expectedStoragePath = uploadIntentId ? `uploads/${classId}/${workId}/${uid}/${uploadIntentId}` : null;
            if (audioData && (
                String(audioData.storagePath || '') !== expectedStoragePath
                || String(audioData.filename || '') !== uploadIntentId
            )) {
                throw routeError(400, 'INVALID_UPLOAD_INTENT', 'Audio metadata does not match the prepared upload slot.');
            }

            const outcome = await db.runTransaction(async (tx) => {
                const slotSnap = slotRef ? await tx.get(slotRef) : null;
                const targetSnap = await tx.get(targetRef);
                if (slotSnap) {
                    if (!slotSnap.exists) throw routeError(400, 'INVALID_UPLOAD_INTENT', 'Upload slot does not exist.');
                    const slot = slotSnap.data() || {};
                    const identityMatches = slot.classId === classId
                        && slot.workId === workId
                        && slot.studentUid === uid
                        && slot.storagePath === expectedStoragePath;
                    if (!identityMatches) throw routeError(400, 'INVALID_UPLOAD_INTENT', 'Upload slot ownership does not match this submission.');
                    if (slot.status === 'consumed') {
                        if (slot.submissionId === targetRef.id && targetSnap.exists) {
                            return { submissionId: targetRef.id, idempotent: true };
                        }
                        throw routeError(409, 'UPLOAD_INTENT_CONSUMED', 'Upload slot was already consumed.');
                    }
                    if (slot.status !== 'prepared' || timestampMillis(slot.expiresAt) <= Date.now()) {
                        throw routeError(400, 'INVALID_UPLOAD_INTENT', 'Upload slot is expired or inactive.');
                    }
                }

                if (targetSnap.exists) {
                    const existingData = targetSnap.data() || {};
                    const currentStatus = String(existingData.status || '').toLowerCase();
                    if (currentStatus !== 'needs-revision') {
                        if (!audioData && currentStatus === 'turned-in') {
                            return { submissionId: targetRef.id, idempotent: true };
                        }
                        throw routeError(409, 'SUBMISSION_LOCKED', 'Assignment can only be changed after it is returned for revision.');
                    }
                    tx.update(targetRef, buildHomeworkSubmissionResubmissionPatch(existingData, { audio: audioData }, {
                        user: req.user,
                        serverTimestamp: deps.serverTimestamp
                    }));
                } else {
                    tx.set(targetRef, buildHomeworkSubmissionCreateData({
                        classId,
                        workId,
                        studentUid: uid,
                        studentEmail: req.user?.email || null,
                        audio: audioData
                    }, {
                        user: req.user,
                        serverTimestamp: deps.serverTimestamp
                    }));
                }

                if (slotRef) {
                    const consumedAt = typeof deps.serverTimestamp === 'function' ? deps.serverTimestamp() : new Date();
                    tx.update(slotRef, { status: 'consumed', submissionId: targetRef.id, consumedAt });
                }
                return { submissionId: targetRef.id, idempotent: false };
            });
            return sendSuccess(res, { submissionId: outcome.submissionId, status: 'turned-in', idempotent: outcome.idempotent }, outcome.idempotent ? 'Assignment submission already processed.' : 'Assignment submitted successfully.');
        } catch (error) {
            return sendError(res, error.status || 500, error.code || 'SUBMISSION_ERROR', error.status ? error.message : 'Failed to process assignment submission.', error.status ? null : (error?.message || error));
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
