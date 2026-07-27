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
const { syncProgressionUnlocks } = require('./syncProgressionUnlocks');
const { migrateUserCoins } = require('./migrateCoins');
const { assessWriting } = require('./assessWriting');
const { scoreEssay } = require('./scoreEssay');
const { submitEssayDeepAi } = require('./submitEssayDeepAi');
const { scoreSWT } = require('./scoreSWT');
const { scoreSST } = require('./scoreSST');
const { scoreRTS } = require('./scoreRTS');

const { onRequest } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { getFirestore } = require('firebase-admin/firestore');
const apiApp = require('./apiApp');
const {
    runSpeakingAttemptCleanup,
    runPracticeAccessReconcileJobs,
    runPracticeAccessPromotionJobs
} = require('./practice-attempts/job-runners');
const {
    CRM_AUTOMATION_RULES,
    CRM_AUTOMATION_QUEUE,
    CRM_TEMPLATES,
    CRM_LEADS,
    CRM_STUDENTS,
    CRM_INVOICES,
    CRM_ENROLLMENTS,
    CRM_ATTENDANCE_RECORDS
} = require('./crm/collections');
const {
    evaluateRuleTargets,
    generateQueueEntries
} = require('./crm/automation-service');
const {
    purgeExpiredRecycleEntries
} = require('./crm/recycle-bin-service');
const { buildAttendanceRiskRows } = require('./crm/reporting-service');

async function runCrmAutomationQueue() {
    const db = getFirestore();
    const [ruleSnap, templateSnap, leadSnap, studentSnap, invoiceSnap, enrollmentSnap, attendanceSnap, queueSnap] = await Promise.all([
        db.collection(CRM_AUTOMATION_RULES).where('active', '==', true).get(),
        db.collection(CRM_TEMPLATES).get(),
        db.collection(CRM_LEADS).get(),
        db.collection(CRM_STUDENTS).get(),
        db.collection(CRM_INVOICES).get(),
        db.collection(CRM_ENROLLMENTS).get(),
        db.collection(CRM_ATTENDANCE_RECORDS).get(),
        db.collection(CRM_AUTOMATION_QUEUE).get()
    ]);

    const templates = new Map(templateSnap.docs.map((doc) => [doc.id, { templateId: doc.id, ...doc.data() }]));
    const existingKeys = new Set(queueSnap.docs.map((doc) => String(doc.data()?.dedupeKey || '').trim()).filter(Boolean));
    const leads = leadSnap.docs.map((doc) => ({ leadId: doc.id, ...doc.data() }));
    const students = studentSnap.docs.map((doc) => ({ studentId: doc.id, ...doc.data() }));
    const invoices = invoiceSnap.docs.map((doc) => ({ invoiceId: doc.id, ...doc.data() }));
    const attendance = buildAttendanceRiskRows({
        enrollments: enrollmentSnap.docs.map((doc) => ({ enrollmentId: doc.id, ...doc.data() })),
        records: attendanceSnap.docs.map((doc) => ({ recordId: doc.id, ...doc.data() })),
        students
    });

    const writes = [];
    ruleSnap.docs.forEach((doc) => {
        const rule = { ruleId: doc.id, ...doc.data() };
        const template = templates.get(String(rule.templateId || ''));
        if (!template) return;
        const targets = evaluateRuleTargets({
            rule,
            datasets: { leads, students, invoices, attendance },
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

async function runRecycleBinPurgeQueue() {
    const db = getFirestore();
    await purgeExpiredRecycleEntries(db, {
        now: new Date(),
        user: { uid: 'system', email: null }
    });
}

module.exports = {
    submitAttempt,
    purchaseItem,
    purchaseSkill,
    useActiveSkill,
    syncProgressionUnlocks,
    migrateUserCoins,
    assessWriting,
    scoreEssay,
    submitEssayDeepAi,
    scoreSWT,
    scoreSST,
    scoreRTS,
    api: onRequest({ region: 'us-central1' }, apiApp),
    crmAutomationRunner: onSchedule({ region: 'us-central1', schedule: 'every 24 hours' }, async () => {
        await runCrmAutomationQueue();
    }),
    crmRecycleBinPurgeRunner: onSchedule({ region: 'us-central1', schedule: 'every 24 hours' }, async () => {
        await runRecycleBinPurgeQueue();
    }),
    speakingAttemptCleanupRunner: onSchedule({ region: 'us-central1', schedule: 'every 60 minutes' }, async () => {
        const db = getFirestore();
        await runSpeakingAttemptCleanup(db, { now: new Date() });
    }),
    practiceAccessReconcileRunner: onSchedule({ region: 'us-central1', schedule: 'every 6 hours' }, async () => {
        const db = getFirestore();
        await runPracticeAccessReconcileJobs(db, { now: new Date() });
    }),
    practiceAccessPromotionRunner: onSchedule({ region: 'us-central1', schedule: 'every 60 minutes' }, async () => {
        const db = getFirestore();
        await runPracticeAccessPromotionJobs(db, { now: new Date() });
    })
};
