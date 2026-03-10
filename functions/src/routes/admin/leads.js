const {
    CRM_LEADS,
    CRM_STUDENTS
} = require('../../crm/collections');
const {
    buildLeadCreateData,
    buildLeadPatchData,
    buildLeadConversion,
    mapLeadRecord
} = require('../../crm/lead-service');
const { mapStudentRecord } = require('../../crm/student-service');

module.exports = function registerLeadRoutes(router, deps) {
    const { db, sendSuccess, sendError, requireAdminHandlers, serverTimestamp } = deps;

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
            return sendSuccess(res, { leads, count: leads.length });
        } catch (error) {
            return sendError(res, 500, 'LIST_LEADS_ERROR', 'Failed to list leads.', error?.message || error);
        }
    });

    router.post('/leads', ...requireAdminHandlers, async (req, res) => {
        try {
            const lead = buildLeadCreateData(req.body || {}, {
                user: req.user,
                serverTimestamp
            });
            const ref = db.collection(CRM_LEADS).doc();
            await ref.set(lead);
            return sendSuccess(res, { leadId: ref.id }, 'Lead created.');
        } catch (error) {
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
            const snap = await ref.get();
            if (!snap.exists) {
                return sendError(res, 404, 'LEAD_NOT_FOUND', 'Lead not found.');
            }
            const next = buildLeadPatchData(snap.data() || {}, req.body || {}, {
                user: req.user,
                serverTimestamp
            });
            await ref.set(next, { merge: true });
            const updatedSnap = await ref.get();
            return sendSuccess(res, { lead: mapLeadRecord(updatedSnap, leadId) }, 'Lead updated.');
        } catch (error) {
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

            const leadRef = db.collection(CRM_LEADS).doc(leadId);
            const leadSnap = await leadRef.get();
            if (!leadSnap.exists) {
                return sendError(res, 404, 'LEAD_NOT_FOUND', 'Lead not found.');
            }

            const lead = leadSnap.data() || {};
            if (lead.stage === 'converted' && lead.studentId) {
                return sendError(res, 409, 'LEAD_ALREADY_CONVERTED', 'Lead has already been converted.');
            }

            const conversion = buildLeadConversion({
                leadId,
                lead,
                context: {
                    user: req.user,
                    serverTimestamp
                }
            });

            const studentRef = db.collection(CRM_STUDENTS).doc();
            await studentRef.set(conversion.student);
            await leadRef.set({
                ...conversion.leadPatch,
                studentId: studentRef.id
            }, { merge: true });

            const studentSnap = await studentRef.get();
            const updatedLeadSnap = await leadRef.get();
            return sendSuccess(res, {
                lead: mapLeadRecord(updatedLeadSnap, leadId),
                student: mapStudentRecord(studentSnap, studentRef.id)
            }, 'Lead converted.');
        } catch (error) {
            if ((error?.message || '').includes('Please fill at least 1 field')) {
                return sendError(res, 400, 'VALIDATION_ERROR', error.message);
            }
            return sendError(res, 500, 'CONVERT_LEAD_ERROR', 'Failed to convert lead.', error?.message || error);
        }
    });
};
