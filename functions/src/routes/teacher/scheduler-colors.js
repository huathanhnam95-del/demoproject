const { CRM_CLASSROOMS, CRM_SCHEDULED_SESSIONS } = require('../../crm/collections');
const { normalizeScheduledSession } = require('../../crm/scheduling-service');
const colors = require('../../crm/scheduler-color-service');

module.exports = function registerSchedulerColors(router, deps) {
    const { db, requireTeacherHandlers, sendSuccess, sendError, serverTimestamp } = deps;
    const errorResponse = (res, error) => sendError(res, error.status || 500, error.code || 'COLOR_SAVE_FAILED',
        error.status ? error.message : 'Could not save colours. Please try again.');

    router.post('/sessions/:sessionId/color', ...requireTeacherHandlers, async (req, res) => {
        try {
            const colorPlan = await db.runTransaction(async (tx) => {
                const sessionSnap = await tx.get(db.collection(CRM_SCHEDULED_SESSIONS).doc(req.params.sessionId));
                if (!sessionSnap.exists) throw Object.assign(new Error('Session not found.'), { status: 404, code: 'SESSION_NOT_FOUND' });
                const session = normalizeScheduledSession({ ...sessionSnap.data(), sessionId: sessionSnap.id });
                if (!session.classId) throw Object.assign(new Error('Session has no class.'), { status: 400, code: 'INVALID_SESSION' });
                const classSnap = await tx.get(db.collection(CRM_CLASSROOMS).doc(session.classId));
                const classroom = classSnap.exists ? classSnap.data() : null;
                const uid = req.user?.uid;
                const isAdmin = req.teacherAccess?.isAdmin === true;
                const ownsClass = classroom?.primaryTeacherUid === uid;
                const ownsSession = session.teacherUid === uid || (session.teacherUid === 'all' && ownsClass);
                if (!classroom || (!isAdmin && (!ownsClass || !ownsSession))) {
                    throw Object.assign(new Error('You can only recolour sessions in your own classes.'), { status: 403, code: 'FORBIDDEN' });
                }
                const ref = colors.planRef(db, session.classId);
                const snap = await tx.get(ref);
                const plan = colors.applyColor(snap.exists ? snap.data() : null, session, req.body || {});
                tx.set(ref, { ...plan, classId: session.classId, updatedBy: uid, updatedAt: serverTimestamp() });
                return { classId: session.classId, ...plan };
            });
            return sendSuccess(res, { colorPlan }, 'Session colours saved.');
        } catch (error) { return errorResponse(res, error); }
    });

    router.post('/scheduler/color-tags', ...requireTeacherHandlers, async (req, res) => {
        try {
            const colorTags = await db.runTransaction(async (tx) => {
                const ref = colors.tagsRef(db);
                const snap = await tx.get(ref);
                const book = colors.updateTag(snap.exists ? snap.data() : null, req.body || {});
                tx.set(ref, { ...book, updatedBy: req.user.uid, updatedAt: serverTimestamp() });
                return book;
            });
            return sendSuccess(res, { colorTags }, 'Shared colour tag saved.');
        } catch (error) { return errorResponse(res, error); }
    });
};
