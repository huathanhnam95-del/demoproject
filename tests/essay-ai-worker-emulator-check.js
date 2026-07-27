const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const admin = require('firebase-admin');

const PROJECT_ID = 'listening-tasks-3ae34';
const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const QUEUE_ID = 'essay-ai-test-queue-001';
const NOTIFICATION_ID = `deep-ai:${QUEUE_ID}:g0:completed`;
const PREVIEW_JOB_ID = 'essay-ai-preview-job-001';
const BACKFILL_ATTEMPT_ID = 'essay-ai-backfill-attempt-001';

function runWorker() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.PYTHON || 'python', [
      'scripts/essay_local_batch_worker.py',
      '--single-run',
      '--mock-ollama',
      'tests/fixtures/essay-ai/mock-ollama-success.json'
    ], {
      cwd: path.resolve(__dirname, '..'),
      env: { ...process.env, FIRESTORE_EMULATOR_HOST: EMULATOR_HOST, GCLOUD_PROJECT: PROJECT_ID },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk) => { output += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(output) : reject(new Error(`worker exited ${code}\n${output}`)));
  });
}

async function main() {
  process.env.FIRESTORE_EMULATOR_HOST = EMULATOR_HOST;
  process.env.GCLOUD_PROJECT = PROJECT_ID;
  if (!admin.apps.length) {
    admin.initializeApp({ projectId: PROJECT_ID });
  }
  const db = admin.firestore();
  const queueRef = db.collection('essay_ai_queue').doc(QUEUE_ID);
  const notificationRef = db.collection('user_notifications').doc(NOTIFICATION_ID);
  const previewJobRef = db.collection('essay_ai_backfill_jobs').doc(PREVIEW_JOB_ID);
  const backfillAttemptRef = db.collection('speakingAttempts').doc(BACKFILL_ATTEMPT_ID);
  const controlRef = db.collection('essay_ai_backfill_control').doc('current');
  try {
    await queueRef.set({
      uid: 'essay-ai-test-user',
      attemptId: 'essay-ai-test-attempt-001',
      questionId: 'essay-ai-test-question-001',
      essayText: 'A'.repeat(100),
      promptText: 'Discuss whether technology improves education.',
      status: 'pending',
      submittedAt: new Date('2026-07-26T00:00:00.000Z'),
      claimedAt: null,
      leaseExpiresAt: null,
      workerId: null,
      completedAt: null,
      runGeneration: 0,
      retryCount: 0,
      error: null,
      resetCount: 0,
      isRead: false,
      resultSnapshot: null
    });
    await backfillAttemptRef.set({
      ownerUid: 'essay-ai-backfill-user',
      practiceScope: 'pte',
      canonicalMode: 'write_essay',
      status: 'submitted',
      submittedAt: new Date('2026-07-25T23:00:00.000Z'),
      promptSnapshot: { promptId: 'backfill-question-001', text: 'Discuss whether technology improves education.' },
      responseSnapshot: { text: 'B'.repeat(120) }
    });
    await controlRef.set({ activePreviewJobId: PREVIEW_JOB_ID, activeEnqueueJobId: null });
    await previewJobRef.set({
      requestId: 'essay-ai-preview-request-001', mode: 'preview', status: 'pending', includeFailed: false,
      pageSize: 2, scanCutoffAt: new Date('2026-07-26T00:00:00.000Z'), cursorSubmittedAt: null,
      cursorAttemptId: null, scannedCount: 0, candidateCount: 0, enqueuedCount: 0,
      skippedCount: 0, invalidCount: 0, createdAt: new Date('2026-07-26T00:00:00.000Z'),
      workerId: null, claimedAt: null, leaseExpiresAt: null
    });
    const output = await runWorker();
    const queue = (await queueRef.get()).data();
    assert.equal(queue.status, 'completed', output);
    assert.equal(queue.resultSnapshot.overall.maxTotal, 26);
    assert.equal((await notificationRef.get()).exists, true);
    const preview = (await previewJobRef.get()).data();
    assert.equal(preview.status, 'completed', output);
    assert.equal(preview.scannedCount, 1);
    assert.equal(preview.candidateCount, 1);
    assert.equal(preview.enqueuedCount, 0);
    console.log('essay-ai worker emulator check passed');
  } finally {
    await Promise.all([
      queueRef.delete(),
      notificationRef.delete(),
      previewJobRef.delete(),
      backfillAttemptRef.delete(),
      controlRef.delete(),
      db.collection('crm_system_alerts').doc('deep-ai-failure:' + QUEUE_ID + ':g0').delete(),
      db.collection('essay_ai_worker_status').doc('current').delete()
    ]);
    await admin.app().delete();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
