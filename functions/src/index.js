/**
 * Cloud Functions Entry Point
 * 
 * Exports all callable functions for server-authoritative scoring.
 */

const { initializeApp } = require('firebase-admin/app');

// Initialize Firebase Admin SDK
initializeApp();

// Export callable functions
const { submitAttempt } = require('./submitAttempt');
const { purchaseItem } = require('./purchaseItem');
const { purchaseSkill } = require('./purchaseSkill');
const { useActiveSkill } = require('./useActiveSkill');
const { migrateUserCoins } = require('./migrateCoins');
const { assessWriting } = require('./assessWriting');

const { onRequest } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { getFirestore } = require('firebase-admin/firestore');
const apiApp = require('./apiApp');
const {
    CRM_AUTOMATION_RULES,
    CRM_AUTOMATION_QUEUE,
    CRM_TEMPLATES,
    CRM_LEADS,
    CRM_STUDENTS,
    CRM_INVOICES
} = require('./crm/collections');
const {
    evaluateRuleTargets,
    generateQueueEntries
} = require('./crm/automation-service');

async function runCrmAutomationQueue() {
    const db = getFirestore();
    const [ruleSnap, templateSnap, leadSnap, studentSnap, invoiceSnap, queueSnap] = await Promise.all([
        db.collection(CRM_AUTOMATION_RULES).where('active', '==', true).get(),
        db.collection(CRM_TEMPLATES).get(),
        db.collection(CRM_LEADS).get(),
        db.collection(CRM_STUDENTS).get(),
        db.collection(CRM_INVOICES).get(),
        db.collection(CRM_AUTOMATION_QUEUE).get()
    ]);

    const templates = new Map(templateSnap.docs.map((doc) => [doc.id, { templateId: doc.id, ...doc.data() }]));
    const existingKeys = new Set(queueSnap.docs.map((doc) => String(doc.data()?.dedupeKey || '').trim()).filter(Boolean));
    const leads = leadSnap.docs.map((doc) => ({ leadId: doc.id, ...doc.data() }));
    const students = studentSnap.docs.map((doc) => ({ studentId: doc.id, ...doc.data() }));
    const invoices = invoiceSnap.docs.map((doc) => ({ invoiceId: doc.id, ...doc.data() }));

    const writes = [];
    ruleSnap.docs.forEach((doc) => {
        const rule = { ruleId: doc.id, ...doc.data() };
        const template = templates.get(String(rule.templateId || ''));
        if (!template) return;
        const targets = evaluateRuleTargets({
            rule,
            datasets: { leads, students, invoices, attendance: [] },
            now: new Date()
        });
        const queueEntries = generateQueueEntries({
            rule,
            template,
            targets,
            existingKeys
        }, {
            user: { uid: 'system', email: null },
            serverTimestamp: () => new Date()
        });
        queueEntries.forEach((entry) => {
            writes.push(db.collection(CRM_AUTOMATION_QUEUE).doc().set(entry));
            existingKeys.add(entry.dedupeKey);
        });
    });

    await Promise.all(writes);
}

module.exports = {
    submitAttempt,
    purchaseItem,
    purchaseSkill,
    useActiveSkill,
    migrateUserCoins,
    assessWriting,
    api: onRequest({ region: 'us-central1' }, apiApp),
    crmAutomationRunner: onSchedule({ region: 'us-central1', schedule: 'every 24 hours' }, async () => {
        await runCrmAutomationQueue();
    })
};
