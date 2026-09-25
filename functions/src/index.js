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
const { onTaskDispatched } = require('firebase-functions/v2/tasks');
const { getFirestore } = require('firebase-admin/firestore');
const { ScoringWorker } = require('./ai-scoring/worker');
const { reconcileOutbox } = require('./ai-scoring/outbox-reconciler');
const { processEntranceV3, reconcileEntranceV3 } = require('./entrance-test/v3-assessment');
const { getFunctions } = require('firebase-admin/functions');
const { WalletService } = require('./ai-credits/wallet-service');
const { SettlementService } = require('./ai-credits/settlement-service');
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
const {
    runBookIngestQueue,
    runBookTextRevisionQueue
} = require('./crm/book-ingest-service');
const { getStorageBucket } = require('./utils/firebase_admin_init');
const { createAttachmentStorage } = require('./crm/data-input/attachment-storage');
const { createAttachmentCleanup } = require('./crm/data-input/attachment-cleanup');

const crypto = require('crypto');

function deriveQueueDocId(dedupeKey) {
    return crypto.createHash('sha256').update(String(dedupeKey || '')).digest('hex').slice(0, 32);
}

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

    const entriesToWrite = [];
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
            const docId = deriveQueueDocId(entry.dedupeKey);
            entriesToWrite.push({ docId, entry });
            existingKeys.add(entry.dedupeKey);
        });
    });

    // Write in bounded batches of 250 to ensure atomicity, bounded concurrency, and prevent duplicate jobs across overlapping runners
    const BATCH_SIZE = 250;
    for (let i = 0; i < entriesToWrite.length; i += BATCH_SIZE) {
        const batch = db.batch();
        const slice = entriesToWrite.slice(i, i + BATCH_SIZE);
        slice.forEach(({ docId, entry }) => {
            const docRef = db.collection(CRM_AUTOMATION_QUEUE).doc(docId);
            batch.set(docRef, entry, { merge: true });
        });
        await batch.commit();
    }
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
    api: onRequest({
        region: ['asia-southeast1', 'us-central1'],
        memory: '1GiB',
        timeoutSeconds: 300,
        secrets: ['AZURE_SPEECH_KEY', 'GROQ_API_KEY']
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
        // eslint-disable-next-line no-console
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
    }),
    scoreWorkerTask: onTaskDispatched({
        timeoutSeconds: 540,
        memory: '512MiB',
        retryConfig: {
            maxAttempts: 3,
            minBackoffSeconds: 10
        },
        rateLimits: {
            maxConcurrentDispatches: 6
        },
        region: 'asia-southeast1',
        secrets: ['AZURE_SPEECH_KEY', 'GROQ_API_KEY']
    }, async (req) => {
        const assessmentId = req.data?.assessmentId;
        if (!assessmentId) return;
        const db = getFirestore();
        const walletService = new WalletService({ db });
        const settlementService = new SettlementService({ db, walletService });
        const worker = new ScoringWorker({ db, settlementService });
        await worker.processJob(assessmentId, `cloud-task-${req.id || 'worker'}`);
    }),
    aiScoringOutboxReconciler: onSchedule({
        region: 'asia-southeast1', schedule: 'every 1 minutes', timeoutSeconds: 300,
        maxInstances: 1, concurrency: 1
    }, async () => {
        const queue = getFunctions().taskQueue('locations/asia-southeast1/functions/scoreWorkerTask');
        const summary = await reconcileOutbox({
            db: getFirestore(), dispatch: (assessmentId) => queue.enqueue({ assessmentId })
        });
        console.info('[AiScoringOutbox]', summary);
    }),
    entranceSpeechWorkerTask: onTaskDispatched({
        timeoutSeconds: 540,
        memory: '512MiB',
        retryConfig: { maxAttempts: 3, minBackoffSeconds: 10 },
        rateLimits: { maxConcurrentDispatches: 3 },
        region: 'asia-southeast1', secrets: ['AZURE_SPEECH_KEY']
    }, async req => {
        const revisionId = req.data?.revisionId;
        if (!revisionId) return;
        await processEntranceV3({ db: getFirestore(), bucket: await getStorageBucket(), revisionId });
    }),
    entranceSpeechOutboxReconciler: onSchedule({
        region: 'asia-southeast1', schedule: 'every 1 minutes', timeoutSeconds: 300,
        maxInstances: 1, concurrency: 1
    }, async () => {
        const queue = getFunctions().taskQueue('locations/asia-southeast1/functions/entranceSpeechWorkerTask');
        const summary = await reconcileEntranceV3({ db: getFirestore(),
            dispatch: revisionId => queue.enqueue({ revisionId }) });
        console.info('[EntranceSpeechOutbox]', summary);
    })
};
