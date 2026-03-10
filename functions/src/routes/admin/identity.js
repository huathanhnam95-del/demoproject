const {
    CRM_STUDENTS
} = require('../../crm/collections');

module.exports = function registerIdentityRoutes(router, deps) {
    const { db, sendSuccess, sendError, requireAdminHandlers, identity } = deps;

    router.post('/students/:studentId/class-code', ...requireAdminHandlers, async (req, res) => {
        try {
            const studentId = String(req.params.studentId || '').trim();
            if (!studentId) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Missing studentId.');
            }

            const classCode = await identity.generateClassCode();
            await db.collection(CRM_STUDENTS).doc(studentId).update({
                class_code: classCode,
                updatedAt: new Date().toISOString()
            });

            return sendSuccess(res, { classCode }, 'Class code generated.');
        } catch (error) {
            return sendError(res, 500, 'CODE_GEN_FAILED', 'Failed to generate class code.', error?.message || error);
        }
    });

    router.get('/users/lookup', ...requireAdminHandlers, async (req, res) => {
        try {
            const email = String(req.query?.email || '').trim();
            if (!email) {
                return sendError(res, 400, 'MISSING_EMAIL', 'Email query parameter is required.');
            }

            const user = await identity.lookupUserByEmail(email);
            return sendSuccess(res, { user });
        } catch (error) {
            return sendError(res, 404, 'USER_NOT_FOUND', error?.message || 'User not found.');
        }
    });

    router.post('/students/:studentId/force-link', ...requireAdminHandlers, async (req, res) => {
        try {
            const studentId = String(req.params.studentId || '').trim();
            const targetUid = String(req.body?.targetUid || '').trim();

            if (!studentId) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Missing studentId.');
            }
            if (!targetUid) {
                return sendError(res, 400, 'MISSING_UID', 'targetUid is required.');
            }

            const result = await identity.forceLinkProfile(studentId, targetUid);
            return sendSuccess(res, result, 'User linked successfully.');
        } catch (error) {
            return sendError(res, 500, 'LINK_FAILED', 'Failed to link user.', error?.message || error);
        }
    });
};
