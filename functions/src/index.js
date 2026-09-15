/**
 * Cloud Functions Entry Point
 * 
 * Exports all callable functions for server-authoritative scoring.
 */

const { initializeApp, getApps } = require('firebase-admin/app');

// Initialize Firebase Admin SDK
if (!getApps().length) {
    const databaseURL = String(process.env.FIREBASE_DATABASE_URL || '').trim();
    const projectId = String(process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || '').trim();
    initializeApp(databaseURL || projectId ? { ...(databaseURL ? { databaseURL } : {}), ...(projectId ? { projectId } : {}) } : undefined);
}

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
const { getDatabase } = require('firebase-admin/database');
const apiApp = require('./apiApp');
const {
    runSpeakingAttemptCleanup,
    runPracticeAccessReconcileJobs,
    runPracticeAccessPromotionJobs
} = require('./practice-attempts/job-runners');
const { createMaintenanceService } = require('./crm/presentation-demo/maintenance.cjs');
const { createFirebasePresentationDemoServices } = require('./crm/presentation-demo/firebase-stores.cjs');
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
const {
    runBookIngestQueue,
    runBookTextRevisionQueue
} = require('./crm/book-ingest-service');
const { getStorageBucket } = require('./utils/firebase_admin_init');
const { createAttachmentStorage } = require('./crm/data-input/attachment-storage');
const { createAttachmentCleanup } = require('./crm/data-input/attachment-cleanup');

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
    presentationDemoMaintenanceRunner: onSchedule({ region: 'us-central1', schedule: 'every 5 minutes', timeoutSeconds: 300, memory: '256MiB', maxInstances: 1, serviceAccount: 'bel-presentation-maintenance@listening-tasks-3ae34.iam.gserviceaccount.com' }, async () => {
        if (String(process.env.PRESENTATION_DEMO_ONLINE_ENABLED || '').trim() !== '1') return;
        if (String(process.env.PRESENTATION_DEMO_DURABLE_READY || '').trim() !== '1') throw new Error('Presentation Demo maintenance requires durable Firebase state.');
        const { db } = require('./utils/firebase_admin_init');
        const bundle = createFirebasePresentationDemoServices({ db, rtdb: getDatabase() });
        const result = await createMaintenanceService({ roomService: bundle.roomService, archiveService: bundle.archives }).run({ limit: 50 });
        console.info('presentationDemoMaintenanceRunner', result);
        return result;
    }),
    api: onRequest({
        region: 'us-central1',
        memory: '1GiB',
        timeoutSeconds: 300,
        secrets: ['AZURE_SPEECH_KEY'],
        serviceAccount: 'crm-api-runtime@listening-tasks-3ae34.iam.gserviceaccount.com'
    }, apiApp),
    crmProjectsAutomationProcessor: onSchedule({ region: 'us-central1', schedule: 'every 1 minutes', timeoutSeconds: 300 }, async () => {
        const { getAuth } = require('firebase-admin/auth');
        const { createProjectsAccessService } = require('./crm/projects/access-service');
        const { createProjectsCommandService } = require('./crm/projects/domain/command-service');
        const { createAutomationProcessor } = require('./crm/projects/automation/processor');
        const db = getFirestore();
        const accessService = createProjectsAccessService({ db, auth: getAuth() });
        const commandService = createProjectsCommandService({ db, accessService });
        const result = await createAutomationProcessor({ db, accessService, commandService }).processBatch({
            limit: 50,
            maxPages: 10,
            budgetMs: 30000
        });
        console.info('crmProjectsAutomationProcessor', { metrics: result.metrics, paused: result.paused || false });
    }),
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
    }),
    crmBookIngestRunner: onSchedule({
        region: 'us-central1',
        schedule: 'every 1 minutes',
        timeoutSeconds: 540,
        memory: '2GiB'
    }, async () => {
        const db = getFirestore();
        await runBookIngestQueue(db, { now: new Date(), getStorageBucket });
    }),
    crmBookTextRevisionRunner: onSchedule({
        region: 'us-central1',
        schedule: 'every 1 minutes',
        timeoutSeconds: 540,
        memory: '2GiB'
    }, async () => {
        const db = getFirestore();
        await runBookTextRevisionQueue(db, { now: new Date(), getStorageBucket });
    }),
    crmDataInputAttachmentCleanupRunner: onSchedule({
        region: 'us-central1',
        schedule: 'every 5 minutes',
        timeoutSeconds: 300,
        memory: '256MiB',
        maxInstances: 1,
        concurrency: 1
    }, async () => {
        const storage = createAttachmentStorage({ bucket: await getStorageBucket() });
        await createAttachmentCleanup({ db: getFirestore(), storage }).run();
    })
};
