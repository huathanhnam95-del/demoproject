const {
    CRM_TEACHING_SESSIONS,
    CRM_STUDENTS
} = require('../../crm/collections');
const {
    buildTeachingSessionCreateData,
    buildTeachingSessionPatchData,
    mapTeachingSessionRecord,
    sortTeachingSessions
} = require('../../crm/teaching-session-service');
const {
    runSessionAnalysisTask
} = require('../../crm/teaching-session-analyzer');

module.exports = function registerTeachingSessionRoutes(router, deps) {
    const { db, sendSuccess, sendError, requireAdminHandlers, serverTimestamp, writeAuditLog } = deps;

    // Helper to resolve all related IDs for a student (Firestore doc ID + crmId)
    async function resolveStudentIds(id) {
        if (!id) return [];
        const ids = new Set([id]);
        try {
            // Check if doc exists by ID
            const doc = await db.collection(CRM_STUDENTS).doc(id).get();
            if (doc.exists) {
                const data = doc.data() || {};
                if (data.crmId) ids.add(String(data.crmId).trim());
            } else {
                // Check if crmId matches
                const snap = await db.collection(CRM_STUDENTS).where('crmId', '==', id).limit(5).get();
                snap.forEach((d) => {
                    ids.add(d.id);
                    const data = d.data() || {};
                    if (data.crmId) ids.add(String(data.crmId).trim());
                });
            }
        } catch (err) {
            console.warn('[Teaching Sessions] Student ID resolution error:', err.message);
        }
        return Array.from(ids).filter(Boolean);
    }

    // GET /teaching-sessions - Query teaching sessions
    router.get('/teaching-sessions', ...requireAdminHandlers, async (req, res) => {
        try {
            const studentId = String(req.query.studentId || '').trim();
            const classId = String(req.query.classId || '').trim();
            const teacherUid = String(req.query.teacherUid || '').trim();
            const status = String(req.query.status || '').trim().toLowerCase();
            const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);

            let query = db.collection(CRM_TEACHING_SESSIONS);

            if (studentId) {
                const candidateIds = await resolveStudentIds(studentId);
                if (candidateIds.length === 1) {
                    query = query.where('studentId', '==', candidateIds[0]);
                } else if (candidateIds.length > 1) {
                    query = query.where('studentId', 'in', candidateIds);
                }
            } else if (classId) {
                query = query.where('classId', '==', classId);
            } else if (teacherUid) {
                query = query.where('teacherUid', '==', teacherUid);
            }

            const snap = await query.limit(limit).get();
            let sessions = snap.docs.map((doc) => mapTeachingSessionRecord(doc, doc.id));

            if (status) {
                sessions = sessions.filter((s) => s.status === status);
            }

            sessions = sortTeachingSessions(sessions);

            return sendSuccess(res, {
                sessions,
                count: sessions.length
            });
        } catch (error) {
            return sendError(res, 500, 'FETCH_TEACHING_SESSIONS_ERROR', 'Failed to fetch teaching sessions.', error?.message || error);
        }
    });

    // GET /teaching-sessions/:sessionId - Get single teaching session
    router.get('/teaching-sessions/:sessionId', ...requireAdminHandlers, async (req, res) => {
        try {
            const sessionId = String(req.params.sessionId || '').trim();
            if (!sessionId) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Missing sessionId.');
            }

            const ref = db.collection(CRM_TEACHING_SESSIONS).doc(sessionId);
            const snap = await ref.get();
            if (!snap.exists) {
                return sendError(res, 404, 'SESSION_NOT_FOUND', 'Teaching session not found.');
            }

            return sendSuccess(res, {
                session: mapTeachingSessionRecord(snap, sessionId)
            });
        } catch (error) {
            return sendError(res, 500, 'FETCH_TEACHING_SESSION_ERROR', 'Failed to fetch teaching session.', error?.message || error);
        }
    });

    // POST /teaching-sessions - Create a new teaching session
    router.post('/teaching-sessions', ...requireAdminHandlers, async (req, res) => {
        try {
            const sessionData = buildTeachingSessionCreateData(req.body || {}, {
                user: req.user,
                serverTimestamp
            });

            const ref = db.collection(CRM_TEACHING_SESSIONS).doc();
            await ref.set(sessionData);

            await writeAuditLog?.({
                action: 'teaching_session.create',
                entityType: 'teaching_session',
                entityId: ref.id,
                metadata: {
                    studentId: sessionData.studentId,
                    classId: sessionData.classId,
                    status: sessionData.status
                }
            }, { user: req.user });

            // If audioUrl is present and status is not yet analyzed, trigger AI analysis asynchronously
            if (sessionData.audioUrl && sessionData.status !== 'analyzed') {
                runSessionAnalysisTask(ref.id, db, serverTimestamp).catch((err) => {
                    console.error('[Teaching Sessions] Background analysis error:', err);
                });
            }

            const snap = await ref.get();
            return sendSuccess(res, {
                sessionId: ref.id,
                session: mapTeachingSessionRecord(snap, ref.id)
            }, 'Teaching session created.');
        } catch (error) {
            return sendError(res, 400, 'CREATE_TEACHING_SESSION_ERROR', error?.message || 'Failed to create teaching session.');
        }
    });

    // POST /teaching-sessions/:sessionId/analyze - Trigger AI analysis
    router.post('/teaching-sessions/:sessionId/analyze', ...requireAdminHandlers, async (req, res) => {
        try {
            const sessionId = String(req.params.sessionId || '').trim();
            if (!sessionId) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Missing sessionId.');
            }

            const ref = db.collection(CRM_TEACHING_SESSIONS).doc(sessionId);
            const snap = await ref.get();
            if (!snap.exists) {
                return sendError(res, 404, 'SESSION_NOT_FOUND', 'Teaching session not found.');
            }

            // Run analysis task asynchronously in background
            runSessionAnalysisTask(sessionId, db, serverTimestamp).catch((err) => {
                console.error('[Teaching Sessions] Triggered analysis error:', err);
            });

            return sendSuccess(res, {
                sessionId,
                status: 'processing'
            }, 'Teaching session analysis started.');
        } catch (error) {
            return sendError(res, 500, 'ANALYZE_TEACHING_SESSION_ERROR', 'Failed to trigger session analysis.', error?.message || error);
        }
    });

    // PATCH /teaching-sessions/:sessionId - Update teaching session
    router.patch('/teaching-sessions/:sessionId', ...requireAdminHandlers, async (req, res) => {
        try {
            const sessionId = String(req.params.sessionId || '').trim();
            if (!sessionId) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Missing sessionId.');
            }

            const ref = db.collection(CRM_TEACHING_SESSIONS).doc(sessionId);
            const snap = await ref.get();
            if (!snap.exists) {
                return sendError(res, 404, 'SESSION_NOT_FOUND', 'Teaching session not found.');
            }

            const patch = buildTeachingSessionPatchData(snap.data() || {}, req.body || {}, {
                user: req.user,
                serverTimestamp
            });

            await ref.set(patch, { merge: true });

            await writeAuditLog?.({
                action: 'teaching_session.update',
                entityType: 'teaching_session',
                entityId: sessionId,
                metadata: {
                    status: patch.status || snap.data()?.status || null
                }
            }, { user: req.user });

            const updatedSnap = await ref.get();
            return sendSuccess(res, {
                sessionId,
                session: mapTeachingSessionRecord(updatedSnap, sessionId)
            }, 'Teaching session updated.');
        } catch (error) {
            return sendError(res, 400, 'UPDATE_TEACHING_SESSION_ERROR', error?.message || 'Failed to update teaching session.');
        }
    });

    // DELETE /teaching-sessions/:sessionId - Delete a teaching session
    router.delete('/teaching-sessions/:sessionId', ...requireAdminHandlers, async (req, res) => {
        try {
            const sessionId = String(req.params.sessionId || '').trim();
            if (!sessionId) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Missing sessionId.');
            }

            const ref = db.collection(CRM_TEACHING_SESSIONS).doc(sessionId);
            const snap = await ref.get();
            if (!snap.exists) {
                return sendError(res, 404, 'SESSION_NOT_FOUND', 'Teaching session not found.');
            }

            await ref.delete();

            await writeAuditLog?.({
                action: 'teaching_session.delete',
                entityType: 'teaching_session',
                entityId: sessionId,
                metadata: {
                    studentId: snap.data()?.studentId || null
                }
            }, { user: req.user });

            return sendSuccess(res, {
                sessionId,
                deleted: true
            }, 'Teaching session deleted.');
        } catch (error) {
            return sendError(res, 500, 'DELETE_TEACHING_SESSION_ERROR', 'Failed to delete teaching session.', error?.message || error);
        }
    });
};
