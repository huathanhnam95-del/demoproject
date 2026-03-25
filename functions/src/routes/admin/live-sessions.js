const {
    CLASSROOM_LIVE_SESSIONS
} = require('../../crm/collections');
const {
    buildLiveSessionCreateData,
    buildLiveSessionPatchData,
    buildLiveSessionStartPatch,
    buildLiveSessionEndPatch,
    mapLiveSessionRecord,
    sortLiveSessions
} = require('../../crm/live-session-service');

module.exports = function registerLiveSessionRoutes(router, deps) {
    const { db, sendSuccess, sendError, requireAdminHandlers, serverTimestamp, writeAuditLog } = deps;

    router.get('/classrooms/:classId/live-sessions', ...requireAdminHandlers, async (req, res) => {
        try {
            const classId = String(req.params.classId || '').trim();
            if (!classId) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Missing classId.');
            }

            const snap = await db.collection(CLASSROOM_LIVE_SESSIONS).where('classId', '==', classId).get();
            const sessions = sortLiveSessions(snap.docs.map((doc) => mapLiveSessionRecord(doc, doc.id)));
            return sendSuccess(res, { sessions });
        } catch (error) {
            return sendError(res, 500, 'FETCH_LIVE_SESSIONS_ERROR', 'Failed to fetch live sessions.', error?.message || error);
        }
    });

    router.post('/classrooms/:classId/live-sessions', ...requireAdminHandlers, async (req, res) => {
        try {
            const classId = String(req.params.classId || '').trim();
            if (!classId) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Missing classId.');
            }

            const session = buildLiveSessionCreateData({
                ...(req.body && typeof req.body === 'object' ? req.body : {}),
                classId
            }, {
                user: req.user,
                serverTimestamp
            });

            const ref = db.collection(CLASSROOM_LIVE_SESSIONS).doc();
            await ref.set(session);
            await writeAuditLog?.({
                action: 'live_session.create',
                entityType: 'live_session',
                entityId: ref.id,
                metadata: { classId, status: session.status || null }
            }, { user: req.user });

            const snap = await ref.get();
            return sendSuccess(res, {
                sessionId: ref.id,
                session: mapLiveSessionRecord(snap, ref.id)
            }, 'Live session created.');
        } catch (error) {
            if ((error?.message || '').includes('Live session')) {
                return sendError(res, 400, 'VALIDATION_ERROR', error.message);
            }
            return sendError(res, 500, 'CREATE_LIVE_SESSION_ERROR', 'Failed to create live session.', error?.message || error);
        }
    });

    router.patch('/classrooms/:classId/live-sessions/:sessionId', ...requireAdminHandlers, async (req, res) => {
        try {
            const classId = String(req.params.classId || '').trim();
            const sessionId = String(req.params.sessionId || '').trim();
            if (!classId || !sessionId) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'classId and sessionId are required.');
            }

            const ref = db.collection(CLASSROOM_LIVE_SESSIONS).doc(sessionId);
            const snap = await ref.get();
            if (!snap.exists) {
                return sendError(res, 404, 'LIVE_SESSION_NOT_FOUND', 'Live session not found.');
            }
            const existing = snap.data() || {};
            if (String(existing.classId || '').trim() !== classId) {
                return sendError(res, 404, 'LIVE_SESSION_NOT_FOUND', 'Live session not found.');
            }

            const next = buildLiveSessionPatchData(existing, req.body || {}, {
                user: req.user,
                serverTimestamp
            });
            await ref.set(next, { merge: true });
            await writeAuditLog?.({
                action: 'live_session.update',
                entityType: 'live_session',
                entityId: sessionId,
                metadata: { classId, status: next.status || existing.status || null }
            }, { user: req.user });

            const updatedSnap = await ref.get();
            return sendSuccess(res, {
                sessionId,
                session: mapLiveSessionRecord(updatedSnap, sessionId)
            }, 'Live session updated.');
        } catch (error) {
            if ((error?.message || '').includes('Live session') || (error?.message || '').includes('No live session fields')) {
                return sendError(res, 400, 'VALIDATION_ERROR', error.message);
            }
            return sendError(res, 500, 'UPDATE_LIVE_SESSION_ERROR', 'Failed to update live session.', error?.message || error);
        }
    });

    router.post('/classrooms/:classId/live-sessions/:sessionId/start', ...requireAdminHandlers, async (req, res) => {
        try {
            const classId = String(req.params.classId || '').trim();
            const sessionId = String(req.params.sessionId || '').trim();
            if (!classId || !sessionId) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'classId and sessionId are required.');
            }

            const ref = db.collection(CLASSROOM_LIVE_SESSIONS).doc(sessionId);
            const snap = await ref.get();
            if (!snap.exists) {
                return sendError(res, 404, 'LIVE_SESSION_NOT_FOUND', 'Live session not found.');
            }
            const existing = snap.data() || {};
            if (String(existing.classId || '').trim() !== classId) {
                return sendError(res, 404, 'LIVE_SESSION_NOT_FOUND', 'Live session not found.');
            }

            const patch = buildLiveSessionStartPatch(existing, {
                user: req.user,
                serverTimestamp
            });
            await ref.set(patch, { merge: true });
            await writeAuditLog?.({
                action: 'live_session.start',
                entityType: 'live_session',
                entityId: sessionId,
                metadata: { classId }
            }, { user: req.user });

            const updatedSnap = await ref.get();
            return sendSuccess(res, {
                sessionId,
                session: mapLiveSessionRecord(updatedSnap, sessionId)
            }, 'Live session started.');
        } catch (error) {
            if ((error?.message || '').includes('scheduled') || (error?.message || '').includes('Live session')) {
                return sendError(res, 400, 'VALIDATION_ERROR', error.message);
            }
            return sendError(res, 500, 'START_LIVE_SESSION_ERROR', 'Failed to start live session.', error?.message || error);
        }
    });

    router.post('/classrooms/:classId/live-sessions/:sessionId/end', ...requireAdminHandlers, async (req, res) => {
        try {
            const classId = String(req.params.classId || '').trim();
            const sessionId = String(req.params.sessionId || '').trim();
            if (!classId || !sessionId) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'classId and sessionId are required.');
            }

            const ref = db.collection(CLASSROOM_LIVE_SESSIONS).doc(sessionId);
            const snap = await ref.get();
            if (!snap.exists) {
                return sendError(res, 404, 'LIVE_SESSION_NOT_FOUND', 'Live session not found.');
            }
            const existing = snap.data() || {};
            if (String(existing.classId || '').trim() !== classId) {
                return sendError(res, 404, 'LIVE_SESSION_NOT_FOUND', 'Live session not found.');
            }

            const patch = buildLiveSessionEndPatch(existing, {
                user: req.user,
                serverTimestamp
            });
            await ref.set(patch, { merge: true });
            await writeAuditLog?.({
                action: 'live_session.end',
                entityType: 'live_session',
                entityId: sessionId,
                metadata: { classId }
            }, { user: req.user });

            const updatedSnap = await ref.get();
            return sendSuccess(res, {
                sessionId,
                session: mapLiveSessionRecord(updatedSnap, sessionId)
            }, 'Live session ended.');
        } catch (error) {
            if ((error?.message || '').includes('live session')) {
                return sendError(res, 400, 'VALIDATION_ERROR', error.message);
            }
            return sendError(res, 500, 'END_LIVE_SESSION_ERROR', 'Failed to end live session.', error?.message || error);
        }
    });
};
