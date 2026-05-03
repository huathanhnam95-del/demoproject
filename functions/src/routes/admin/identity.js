const {
    CRM_STUDENTS
} = require('../../crm/collections');
const { getAuth } = require('../../utils/firebase_admin_init');

function cleanOptionalString(value) {
    const normalized = String(value || '').trim();
    return normalized || null;
}

module.exports = function registerIdentityRoutes(router, deps) {
    const { db, sendSuccess, sendError, requireAdminHandlers, identity, writeAuditLog } = deps;

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
            await writeAuditLog?.({
                action: 'student.class_code.generate',
                entityType: 'student',
                entityId: studentId,
                metadata: { classCode }
            }, { user: req.user });

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
            await writeAuditLog?.({
                action: 'student.force_link',
                entityType: 'student',
                entityId: studentId,
                metadata: { targetUid }
            }, { user: req.user });
            return sendSuccess(res, result, 'User linked successfully.');
        } catch (error) {
            return sendError(res, 500, 'LINK_FAILED', 'Failed to link user.', error?.message || error);
        }
    });

    async function handleSetUserRole(req, res) {
        try {
            const targetUid = cleanOptionalString(req.params?.uid);
            const role = cleanOptionalString(req.body?.role);
            if (!targetUid) return sendError(res, 400, 'VALIDATION_ERROR', 'Missing uid.');
            if (!role || !['teacher', 'none'].includes(role)) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'role must be "teacher" or "none".');
            }

            const isTeacher = role === 'teacher';
            const auth = getAuth();
            const user = await auth.getUser(targetUid);
            const existing = user.customClaims || {};
            await auth.setCustomUserClaims(targetUid, { ...existing, isTeacher });

            await db.collection('users').doc(targetUid).set({
                crmRole: isTeacher ? 'teacher' : null,
                isTeacher,
                crmRoleUpdatedAt: new Date().toISOString(),
                crmRoleUpdatedBy: req.user?.uid || null
            }, { merge: true });

            await writeAuditLog?.({
                action: 'user.role.set',
                entityType: 'user',
                entityId: targetUid,
                metadata: { role }
            }, { user: req.user });

            return sendSuccess(res, {
                uid: targetUid,
                role,
                claims: { ...existing, isTeacher }
            }, 'Role updated.');
        } catch (error) {
            const msg = String(error?.message || error);
            if (msg.includes('There is no user record corresponding')) {
                return sendError(res, 404, 'USER_NOT_FOUND', 'User not found.');
            }
            return sendError(res, 500, 'ROLE_UPDATE_FAILED', 'Failed to update role.', error?.message || error);
        }
    }

    // Grant or revoke teacher role for a Firebase Auth user (admin only).
    // Body: { role: 'teacher' | 'none' }
    router.post('/identity/users/:uid/role', ...requireAdminHandlers, handleSetUserRole);
    router.post('/users/:uid/role', ...requireAdminHandlers, handleSetUserRole);
};
