const {
    CRM_LEADS,
    CRM_STUDENTS
} = require('../../crm/collections');
const {
    allocateNextCrmId
} = require('../../crm/business-id-service');
const {
    buildLeadCreateData,
    buildLeadPatchData,
    mapLeadRecord
} = require('../../crm/lead-service');
const { convertLead, auditSaved } = require('../../crm/workflow-write-service');
const { mapStudentRecord } = require('../../crm/student-service');

module.exports = function registerLeadRoutes(router, deps) {
    const { db, sendSuccess, sendError, requireAdminHandlers, serverTimestamp, writeAuditLog } = deps;

    router.get('/leads', ...requireAdminHandlers, async (req, res) => {
        try {
            const requestedLimit = Number(req.query?.limit);
            const limit = Number.isFinite(requestedLimit)
                ? Math.min(500, Math.max(1, Math.floor(requestedLimit)))
                : 200;
            const stageFilter = String(req.query?.stage || '').trim();

            let query = db.collection(CRM_LEADS).orderBy('createdAt', 'desc').limit(limit);
            if (stageFilter) {
                query = db.collection(CRM_LEADS).where('stage', '==', stageFilter).limit(limit);
            }

            const snaps = await query.get();
            const leads = snaps.docs.map((doc) => mapLeadRecord(doc, doc.id));
            leads.sort((left, right) => {
                const leftTs = left.createdAt?.toMillis ? left.createdAt.toMillis() : 0;
                const rightTs = right.createdAt?.toMillis ? right.createdAt.toMillis() : 0;
                return rightTs - leftTs;
            });
            return sendSuccess(res, { leads, count: leads.length });
        } catch (error) {
            return sendError(res, 500, 'LIST_LEADS_ERROR', 'Failed to list leads.', error?.message || error);
        }
    });

    router.post('/leads', ...requireAdminHandlers, async (req, res) => {
        try {
            if (!String(req.body?.source || '').trim()) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Lead source is required.');
            }
            const lead = buildLeadCreateData(req.body || {}, {
                user: req.user,
                serverTimestamp
            });
            const allocation = await allocateNextCrmId(db, { serverTimestamp });
            lead.crmId = allocation.crmId;
            const ref = db.collection(CRM_LEADS).doc();
            await ref.set(lead);
            const warnings = await auditSaved(writeAuditLog, {
                action: 'lead.create',
                entityType: 'lead',
                entityId: ref.id
            }, { user: req.user });
            return sendSuccess(res, { leadId: ref.id, ...(warnings.length ? { warnings } : {}) }, 'Lead created.');
        } catch (error) {
            if (error.status) return sendError(res, error.status, error.code, error.message);
            if ((error?.message || '').includes('lead contact field')) {
                return sendError(res, 400, 'VALIDATION_ERROR', error.message);
            }
            if ((error?.message || '').includes('Invalid lead stage')) {
                return sendError(res, 400, 'VALIDATION_ERROR', error.message);
            }
            return sendError(res, 500, 'CREATE_LEAD_ERROR', 'Failed to create lead.', error?.message || error);
        }
    });

    router.patch('/leads/:leadId', ...requireAdminHandlers, async (req, res) => {
        try {
            const leadId = String(req.params.leadId || '').trim();
            if (!leadId) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Missing or invalid leadId.');
            }
            const ref = db.collection(CRM_LEADS).doc(leadId);
            await db.runTransaction(async (tx) => {
                const snap = await tx.get(ref);
                if (!snap.exists) throw Object.assign(new Error('Lead not found.'), { status: 404, code: 'LEAD_NOT_FOUND' });
                const next = buildLeadPatchData(snap.data() || {}, req.body || {}, { user: req.user, serverTimestamp });
                tx.set(ref, next, { merge: true });
            });
            const warnings = await auditSaved(writeAuditLog, {
                action: 'lead.update',
                entityType: 'lead',
                entityId: leadId
            }, { user: req.user });
            const updatedSnap = await ref.get();
            return sendSuccess(res, { lead: mapLeadRecord(updatedSnap, leadId), ...(warnings.length ? { warnings } : {}) }, 'Lead updated.');
        } catch (error) {
            if (error.status) return sendError(res, error.status, error.code, error.message);
            if ((error?.message || '').includes('No lead fields provided') || (error?.message || '').includes('Invalid lead stage')) {
                return sendError(res, 400, 'VALIDATION_ERROR', error.message);
            }
            return sendError(res, 500, 'UPDATE_LEAD_ERROR', 'Failed to update lead.', error?.message || error);
        }
    });

    router.post('/leads/:leadId/convert', ...requireAdminHandlers, async (req, res) => {
        try {
            const leadId = String(req.params.leadId || '').trim();
            if (!leadId) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Missing or invalid leadId.');
            }

            const result = await convertLead(db, leadId, { user: req.user, serverTimestamp });
            const studentRef = db.collection(CRM_STUDENTS).doc(result.studentId);
            const leadRef = db.collection(CRM_LEADS).doc(leadId);
            const warnings = result.deduped ? [] : (await Promise.all([
                auditSaved(writeAuditLog, { action: 'lead.convert', entityType: 'lead', entityId: leadId, metadata: { studentId: result.studentId } }, { user: req.user }),
                auditSaved(writeAuditLog, { action: 'student.create_from_lead', entityType: 'student', entityId: result.studentId, metadata: { leadId } }, { user: req.user })
            ])).flat();
            const [studentSnap, updatedLeadSnap] = await Promise.all([studentRef.get(), leadRef.get()]);
            return sendSuccess(res, {
                lead: mapLeadRecord(updatedLeadSnap, leadId),
                student: mapStudentRecord(studentSnap, result.studentId),
                deduped: result.deduped,
                ...(warnings.length ? { warnings } : {})
            }, result.deduped ? 'Lead already converted.' : 'Lead converted.');
        } catch (error) {
            if (error.status) return sendError(res, error.status, error.code, error.message);
            if ((error?.message || '').includes('Please fill at least 1 field')) {
                return sendError(res, 400, 'VALIDATION_ERROR', error.message);
            }
            return sendError(res, 500, 'CONVERT_LEAD_ERROR', 'Failed to convert lead.', error?.message || error);
        }
    });
};
