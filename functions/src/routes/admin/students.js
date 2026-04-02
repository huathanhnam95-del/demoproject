const {
    CRM_STUDENTS,
    CRM_CLASSROOMS
} = require('../../crm/collections');
const {
    allocateNextCrmId,
    ensureCrmIdOnDoc,
    isValidCrmId,
    normalizeCrmId
} = require('../../crm/business-id-service');
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

    function buildStudentRecord(studentId, data, crmId) {
        return mapStudentRecord({
            id: studentId,
            ...(data || {}),
            crmId: crmId || data?.crmId || null
        }, studentId);
    }

    async function hydrateStudentDoc(doc, context = {}) {
        const studentId = String(doc?.id || '').trim();
        if (!studentId) {
            throw new Error('Missing studentId.');
        }

        const data = doc && typeof doc.data === 'function' ? (doc.data() || {}) : (doc || {});
        const studentRef = doc?.ref || db.collection(CRM_STUDENTS).doc(studentId);
        const ensure = await ensureCrmIdOnDoc(db, studentRef, data, context);
        return buildStudentRecord(studentId, data, ensure.crmId);
    }

    async function hydrateDocsWithConcurrency(docs, context = {}, options = {}) {
        const list = Array.isArray(docs) ? docs : [];
        const concurrency = Math.max(1, Math.min(20, Math.floor(Number(options.concurrency) || 0) || 8));
        const out = new Array(list.length);
        let index = 0;

        async function worker() {
            while (index < list.length) {
                const current = index;
                index += 1;
                out[current] = await hydrateStudentDoc(list[current], context);
            }
        }

        const workerCount = Math.min(concurrency, list.length || 1);
        await Promise.all(Array.from({ length: workerCount }, () => worker()));
        return out;
    }

    async function findStudentDocsByNormalizedCrmId(crmId) {
        const exactMatches = await db
            .collection(CRM_STUDENTS)
            .where('crmId', '==', crmId)
            .limit(2)
            .get();

        if (exactMatches.docs.length > 1) {
            return exactMatches.docs;
        }

        const upperCandidate = String(crmId || '').toUpperCase();

        // If we already have one exact match, only do a cheap uppercase lookup to detect a legacy duplicate.
        if (exactMatches.docs.length === 1) {
            if (upperCandidate && upperCandidate !== crmId) {
                const upperMatches = await db
                    .collection(CRM_STUDENTS)
                    .where('crmId', '==', upperCandidate)
                    .limit(2)
                    .get();

                if (upperMatches.docs.length) {
                    const combined = [...exactMatches.docs];
                    upperMatches.docs.forEach((doc) => {
                        if (!combined.some((existing) => existing.id === doc.id)) {
                            combined.push(doc);
                        }
                    });
                    return combined;
                }
            }
            return exactMatches.docs;
        }

        // If there was no exact match, try an uppercase lookup before scanning the full collection.
        if (upperCandidate && upperCandidate !== crmId) {
            const upperMatches = await db
                .collection(CRM_STUDENTS)
                .where('crmId', '==', upperCandidate)
                .limit(2)
                .get();

            if (upperMatches.docs.length) {
                return upperMatches.docs;
            }
        }

        // Legacy rows may still have uppercase or otherwise non-canonical crmId values.
        // Scan only when cheaper lookups do not return any candidate documents.
        const allStudents = await db.collection(CRM_STUDENTS).get();
        return allStudents.docs.filter((doc) => normalizeCrmId(doc.data()?.crmId) === crmId);
    }

    router.post('/students', ...requireAdminHandlers, async (req, res) => {
        try {
            const allocation = await allocateNextCrmId(db, { serverTimestamp });
            const student = buildStudentCreateData({
                ...(req.body || {}),
                crmId: allocation.crmId
            }, {
                user: req.user,
                serverTimestamp,
            });

            const ref = db.collection(CRM_STUDENTS).doc();
            await ref.set(student);
            const studentRecord = buildStudentRecord(ref.id, student, student.crmId);
            await writeAuditLog?.({
                action: 'student.create',
                entityType: 'student',
                entityId: ref.id
            }, { user: req.user });

            return sendSuccess(res, {
                studentId: ref.id,
                crmId: studentRecord.crmId,
                student: studentRecord
            }, 'Student profile created.');
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

            const students = await hydrateDocsWithConcurrency(snaps.docs, {
                user: req.user,
                serverTimestamp
            }, { concurrency: 8 });
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

            const student = await hydrateStudentDoc({
                id: studentId,
                data: () => (snap.data() || {}),
                ref: db.collection(CRM_STUDENTS).doc(studentId)
            }, {
                user: req.user,
                serverTimestamp
            });

            return sendSuccess(res, { student });
        } catch (error) {
            return sendError(res, 500, 'GET_STUDENT_ERROR', 'Failed to fetch student profile.', error?.message || error);
        }
    });

    router.get('/students/by-crm-id/:crmId', ...requireAdminHandlers, async (req, res) => {
        try {
            const crmId = normalizeCrmId(req.params.crmId);
            if (!crmId || !isValidCrmId(crmId)) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Missing or invalid crmId.');
            }

            const matches = await findStudentDocsByNormalizedCrmId(crmId);
            if (!matches.length) {
                return sendError(res, 404, 'STUDENT_NOT_FOUND', 'Student profile not found.');
            }
            if (matches.length > 1) {
                return sendError(res, 409, 'STUDENT_ID_CONFLICT', 'Multiple student profiles share the same crmId.');
            }

            const student = await hydrateStudentDoc(matches[0], {
                user: req.user,
                serverTimestamp
            });
            return sendSuccess(res, { student });
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
            const student = await hydrateStudentDoc(studentSnap, {
                user: req.user,
                serverTimestamp
            });
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
            const student = await hydrateStudentDoc({
                id: studentId,
                data: () => (updatedSnap.data() || {}),
                ref
            }, {
                user: req.user,
                serverTimestamp
            });
            return sendSuccess(res, { student }, 'Student profile updated.');
        } catch (error) {
            if ((error?.message || '').includes('No student fields provided')) {
                return sendError(res, 400, 'VALIDATION_ERROR', error.message);
            }
            return sendError(res, 500, 'UPDATE_STUDENT_ERROR', 'Failed to update student profile.', error?.message || error);
        }
    });
};
