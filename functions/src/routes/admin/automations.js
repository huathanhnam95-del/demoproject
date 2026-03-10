const {
    CRM_TEMPLATES,
    CRM_AUTOMATION_RULES,
    CRM_AUTOMATION_QUEUE,
    CRM_LEADS,
    CRM_STUDENTS,
    CRM_INVOICES
} = require('../../crm/collections');
const {
    buildTemplateCreateData,
    buildAutomationRuleCreateData,
    generateQueueEntries,
    evaluateRuleTargets
} = require('../../crm/automation-service');

module.exports = function registerAutomationRoutes(router, deps) {
    const { db, sendSuccess, sendError, requireAdminHandlers, serverTimestamp, writeAuditLog } = deps;

    router.get('/templates', ...requireAdminHandlers, async (req, res) => {
        try {
            const snap = await db.collection(CRM_TEMPLATES).orderBy('createdAt', 'desc').get();
            const templates = snap.docs.map((doc) => ({ templateId: doc.id, ...doc.data() }));
            return sendSuccess(res, { templates });
        } catch (error) {
            return sendError(res, 500, 'LIST_TEMPLATES_ERROR', 'Failed to list templates.', error?.message || error);
        }
    });

    router.post('/templates', ...requireAdminHandlers, async (req, res) => {
        try {
            const template = buildTemplateCreateData(req.body || {}, {
                user: req.user,
                serverTimestamp
            });
            const ref = db.collection(CRM_TEMPLATES).doc();
            await ref.set(template);
            await writeAuditLog?.({
                action: 'template.create',
                entityType: 'template',
                entityId: ref.id
            }, { user: req.user });
            return sendSuccess(res, { templateId: ref.id }, 'Template created.');
        } catch (error) {
            if ((error?.message || '').includes('Template requires')) {
                return sendError(res, 400, 'VALIDATION_ERROR', error.message);
            }
            return sendError(res, 500, 'CREATE_TEMPLATE_ERROR', 'Failed to create template.', error?.message || error);
        }
    });

    router.get('/automations', ...requireAdminHandlers, async (req, res) => {
        try {
            const [ruleSnap, queueSnap] = await Promise.all([
                db.collection(CRM_AUTOMATION_RULES).orderBy('createdAt', 'desc').get(),
                db.collection(CRM_AUTOMATION_QUEUE).orderBy('createdAt', 'desc').limit(100).get()
            ]);
            const rules = ruleSnap.docs.map((doc) => ({ ruleId: doc.id, ...doc.data() }));
            const queue = queueSnap.docs.map((doc) => ({ queueId: doc.id, ...doc.data() }));
            return sendSuccess(res, { rules, queue });
        } catch (error) {
            return sendError(res, 500, 'LIST_AUTOMATIONS_ERROR', 'Failed to list automations.', error?.message || error);
        }
    });

    router.post('/automations', ...requireAdminHandlers, async (req, res) => {
        try {
            const rule = buildAutomationRuleCreateData(req.body || {}, {
                user: req.user,
                serverTimestamp
            });
            const ref = db.collection(CRM_AUTOMATION_RULES).doc();
            await ref.set(rule);
            await writeAuditLog?.({
                action: 'automation.create',
                entityType: 'automation_rule',
                entityId: ref.id,
                metadata: { templateId: rule.templateId, triggerType: rule.triggerType }
            }, { user: req.user });
            return sendSuccess(res, { ruleId: ref.id }, 'Automation rule created.');
        } catch (error) {
            if ((error?.message || '').includes('Automation rule requires') || (error?.message || '').includes('Invalid automation trigger type')) {
                return sendError(res, 400, 'VALIDATION_ERROR', error.message);
            }
            return sendError(res, 500, 'CREATE_AUTOMATION_ERROR', 'Failed to create automation rule.', error?.message || error);
        }
    });

    router.post('/automations/:ruleId/run-now', ...requireAdminHandlers, async (req, res) => {
        try {
            const ruleId = String(req.params.ruleId || '').trim();
            if (!ruleId) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Missing ruleId.');
            }

            const ruleSnap = await db.collection(CRM_AUTOMATION_RULES).doc(ruleId).get();
            if (!ruleSnap.exists) {
                return sendError(res, 404, 'AUTOMATION_NOT_FOUND', 'Automation rule not found.');
            }
            const rule = { ruleId, ...ruleSnap.data() };

            const templateSnap = await db.collection(CRM_TEMPLATES).doc(String(rule.templateId || '')).get();
            if (!templateSnap.exists) {
                return sendError(res, 404, 'TEMPLATE_NOT_FOUND', 'Template not found.');
            }
            const template = { templateId: templateSnap.id, ...templateSnap.data() };

            const [leadSnap, studentSnap, invoiceSnap, queueSnap] = await Promise.all([
                db.collection(CRM_LEADS).get(),
                db.collection(CRM_STUDENTS).get(),
                db.collection(CRM_INVOICES).get(),
                db.collection(CRM_AUTOMATION_QUEUE).get()
            ]);

            const targets = evaluateRuleTargets({
                rule,
                datasets: {
                    leads: leadSnap.docs.map((doc) => ({ leadId: doc.id, ...doc.data() })),
                    students: studentSnap.docs.map((doc) => ({ studentId: doc.id, ...doc.data() })),
                    invoices: invoiceSnap.docs.map((doc) => ({ invoiceId: doc.id, ...doc.data() })),
                    attendance: []
                },
                now: new Date()
            });

            const queueEntries = generateQueueEntries({
                rule,
                template,
                targets,
                existingKeys: new Set(queueSnap.docs.map((doc) => String(doc.data()?.dedupeKey || '').trim()).filter(Boolean))
            }, {
                user: req.user,
                serverTimestamp
            });

            await Promise.all(queueEntries.map((entry) => db.collection(CRM_AUTOMATION_QUEUE).doc().set(entry)));
            await writeAuditLog?.({
                action: 'automation.run_now',
                entityType: 'automation_rule',
                entityId: ruleId,
                metadata: { queueEntriesCreated: queueEntries.length }
            }, { user: req.user });

            return sendSuccess(res, { created: queueEntries.length }, 'Automation executed.');
        } catch (error) {
            return sendError(res, 500, 'RUN_AUTOMATION_ERROR', 'Failed to run automation.', error?.message || error);
        }
    });
};
