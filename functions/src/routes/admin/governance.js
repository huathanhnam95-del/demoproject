const {
    CRM_STUDENTS,
    CRM_AUDIT_LOGS,
    CRM_MERGE_JOBS
} = require('../../crm/collections');
const {
    detectStudentDuplicates,
    buildMergeJob
} = require('../../crm/governance-service');

module.exports = function registerGovernanceRoutes(router, deps) {
    const { db, sendSuccess, sendError, requireAdminHandlers, serverTimestamp, writeAuditLog } = deps;

    router.get('/duplicates', ...requireAdminHandlers, async (req, res) => {
        try {
            const snap = await db.collection(CRM_STUDENTS).get();
            const duplicates = detectStudentDuplicates(snap.docs.map((doc) => ({ studentId: doc.id, ...doc.data() })));
            return sendSuccess(res, { duplicates });
        } catch (error) {
            return sendError(res, 500, 'GET_DUPLICATES_ERROR', 'Failed to detect duplicates.', error?.message || error);
        }
    });

    router.post('/merge-jobs', ...requireAdminHandlers, async (req, res) => {
        try {
            const mergeJob = buildMergeJob(req.body || {}, {
                user: req.user,
                serverTimestamp
            });
            const ref = db.collection(CRM_MERGE_JOBS).doc();
            await ref.set(mergeJob);
            await writeAuditLog?.({
                action: 'merge_job.create',
                entityType: 'merge_job',
                entityId: ref.id,
                metadata: {
                    primaryStudentId: mergeJob.primaryStudentId,
                    duplicateStudentIds: mergeJob.duplicateStudentIds
                }
            }, { user: req.user });
            return sendSuccess(res, { mergeJobId: ref.id }, 'Merge job created.');
        } catch (error) {
            if ((error?.message || '').includes('Merge job requires')) {
                return sendError(res, 400, 'VALIDATION_ERROR', error.message);
            }
            return sendError(res, 500, 'CREATE_MERGE_JOB_ERROR', 'Failed to create merge job.', error?.message || error);
        }
    });

    router.get('/audit-logs', ...requireAdminHandlers, async (req, res) => {
        try {
            const snap = await db.collection(CRM_AUDIT_LOGS).orderBy('createdAt', 'desc').limit(200).get();
            const auditLogs = snap.docs.map((doc) => ({ auditLogId: doc.id, ...doc.data() }));
            return sendSuccess(res, { auditLogs });
        } catch (error) {
            return sendError(res, 500, 'GET_AUDIT_LOGS_ERROR', 'Failed to load audit logs.', error?.message || error);
        }
    });
};
