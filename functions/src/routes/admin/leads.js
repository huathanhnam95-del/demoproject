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
    buildLeadConversion,
    mapLeadRecord
} = require('../../crm/lead-service');
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
            const allocation = await allocateNextCrmId(db, { serverTimestamp });
            const lead = buildLeadCreateData(req.body || {}, {
                user: req.user,
                serverTimestamp,
                crmId: allocation.crmId
            });
            const ref = db.collection(CRM_LEADS).doc();
            await ref.set(lead);
            await writeAuditLog?.({
                action: 'lead.create',
                entityType: 'lead',
                entityId: ref.id
            }, { user: req.user });
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
            await writeAuditLog?.({
                action: 'lead.update',
                entityType: 'lead',
                entityId: leadId
            }, { user: req.user });
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

            const crmIdAllocation = String(lead.crmId || '').trim()
                ? null
                : await allocateNextCrmId(db, { serverTimestamp });
            const crmId = String(lead.crmId || crmIdAllocation?.crmId || '').trim() || null;

            const conversion = buildLeadConversion({
                leadId,
                lead,
                context: {
                    user: req.user,
                    serverTimestamp,
                    crmId
                }
            });

            const studentRef = db.collection(CRM_STUDENTS).doc();
            const linkedTestSnap = await db.collection('entranceTests').where('leadId', '==', leadId).get();
            const batch = db.batch();
            batch.set(studentRef, conversion.student);
            batch.set(leadRef, {
                ...conversion.leadPatch,
                ...(crmId ? { crmId } : {}),
                studentId: studentRef.id
            }, { merge: true });
            linkedTestSnap.docs.forEach((doc) => {
                batch.set(doc.ref, {
                studentId: studentRef.id,
                crmId: crmId || conversion.student?.crmId || null,
                updatedAt: serverTimestamp()
                }, { merge: true });
            });
            await batch.commit();
            await Promise.all([
                writeAuditLog?.({
                    action: 'lead.convert',
                    entityType: 'lead',
                    entityId: leadId,
                    metadata: { studentId: studentRef.id }
                }, { user: req.user }),
                writeAuditLog?.({
                    action: 'student.create_from_lead',
                    entityType: 'student',
                    entityId: studentRef.id,
                    metadata: { leadId }
                }, { user: req.user })
            ]);

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
