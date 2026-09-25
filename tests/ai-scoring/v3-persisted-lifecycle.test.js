'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
const { AudioAssetService } = require('../../functions/src/ai-scoring/audio-assets');
const { JobService } = require('../../functions/src/ai-scoring/job-service');
const { ScoringWorker } = require('../../functions/src/ai-scoring/worker');
const { reconcileOutbox } = require('../../functions/src/ai-scoring/outbox-reconciler');
const { WalletService } = require('../../functions/src/ai-credits/wallet-service');
const { SettlementService } = require('../../functions/src/ai-credits/settlement-service');
const { parseEntranceV3Upload, uploadEntranceV3, processEntranceV3, getEntranceV3Status } = require('../../functions/src/entrance-test/v3-assessment');
const { runSpeakingAttemptCleanup } = require('../../functions/src/practice-attempts/job-runners');

const isolated = process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_STORAGE_EMULATOR_HOST &&
  process.env.GCLOUD_PROJECT?.startsWith('demo-');
if (!isolated) {
  test('V3 persisted lifecycle requires isolated Firestore and Storage emulators', { skip: true }, () => {});
} else {
  const app = initializeApp({ projectId: process.env.GCLOUD_PROJECT,
    storageBucket: `${process.env.GCLOUD_PROJECT}.firebasestorage.app` }, `speech-${crypto.randomUUID()}`);
  const db = getFirestore(app);
  const bucket = getStorage(app).bucket();
  const walletService = new WalletService({ db });
  const settlementService = new SettlementService({ db, walletService });
  const assets = new AudioAssetService({ db, getBucket: async () => bucket });
  const id = () => crypto.randomUUID().replaceAll('-', '');

  function wav(sampleCount = 16000, amplitude = 1000) {
    const bytes = Buffer.alloc(44 + sampleCount * 2);
    bytes.write('RIFF', 0);
    bytes.writeUInt32LE(bytes.length - 8, 4);
    bytes.write('WAVEfmt ', 8);
    bytes.writeUInt32LE(16, 16);
    bytes.writeUInt16LE(1, 20);
    bytes.writeUInt16LE(1, 22);
    bytes.writeUInt32LE(16000, 24);
    bytes.writeUInt32LE(32000, 28);
    bytes.writeUInt16LE(2, 32);
    bytes.writeUInt16LE(16, 34);
    bytes.write('data', 36);
    bytes.writeUInt32LE(sampleCount * 2, 40);
    for (let sample = 0; sample < sampleCount; sample++) bytes.writeInt16LE(amplitude, 44 + sample * 2);
    return bytes;
  }

  const services = dispatcher => new JobService({ db, walletService, settlementService,
    audioAssetService: assets, taskDispatcher: dispatcher });
  const mockResult = () => ({ schemaVersion: 'bel.speech.v3', status: 'completed',
    recognizedText: 'Next time', overallScores: { accuracyScore: 91, completenessScore: 100 },
    wordResults: [{ occurrenceId: 'w-0', word: 'Next', accuracyScore: 91,
      clip: { startSample: 0, endSample: 4000 } }],
    coverage: { scoredWordCount: 1 }, utterances: [{ index: 0, text: 'Next time' }],
    rawProviderEvidence: [{ RecognitionStatus: 'Success' }] });

  test('persists upload, quote, outbox failure, retry, result, history and one capture', async () => {
    const uid = `learner-${id()}`;
    const attemptId = `attempt_${id()}`;
    const audio = wav();
    const uploaded = await assets.upload({ uid, mode: 'repeat_sentence', attemptId,
      uploadKey: 'first', buffer: audio });
    const duplicate = await assets.upload({ uid, mode: 'repeat_sentence', attemptId,
      uploadKey: 'first', buffer: audio });
    assert.equal(duplicate.audioId, uploaded.audioId);
    await assert.rejects(assets.upload({ uid, mode: 'repeat_sentence', attemptId,
      uploadKey: 'first', buffer: wav(16000, 2000) }), /UPLOAD_KEY_CONFLICT/);
    await assert.rejects(assets.getOwned(uploaded.audioId, 'other-user'), /AUDIO_FORBIDDEN/);
    const jobService = services({ dispatch: async () => { throw new Error('QUEUE_OFFLINE'); } });
    const quote = await jobService.createQuote({ uid, mode: 'repeat_sentence',
      questionId: '1', inputMeta: { audioId: uploaded.audioId }, speechV3: true });
    assert.equal(quote.credits, 1);
    await assert.rejects(jobService.createQuote({ uid, mode: 'repeat_sentence', questionId: '1',
      inputMeta: { audioId: uploaded.audioId, referenceText: 'Wrong answer' }, speechV3: true }),
      /REFERENCE_MISMATCH/);
    const confirmed = await jobService.confirmQuote({ uid, quoteId: quote.quoteId });
    assert.equal(confirmed.dispatchPending, true);
    const queued = await db.collection('aiScoringOutbox').doc(confirmed.assessmentId).get();
    assert.equal(queued.data().dispatchStatus, 'failed');
    let dispatched = 0;
    await reconcileOutbox({ db, now: new Date(Date.now() + 61000),
      dispatch: async assessmentId => { assert.equal(assessmentId, confirmed.assessmentId); dispatched++; } });
    assert.equal(dispatched, 1);
    let executions = 0;
    const worker = new ScoringWorker({ db, settlementService, storageBucket: bucket,
      stageExecutors: { repeat_sentence: async () => {
        executions++;
        if (executions === 1) throw new Error('PROVIDER_INTERRUPTED');
        return mockResult();
      } } });
    const first = await worker.processJob(confirmed.assessmentId, 'emulator-worker-1', { enableHeartbeat: false });
    assert.equal(first.status, 'retry_pending');
    assert.equal((await db.collection('aiCreditAccounts').doc(uid).get()).data().reservedCredits, 1);
    const second = await worker.processJob(confirmed.assessmentId, 'emulator-worker-2', { enableHeartbeat: false });
    assert.equal(second.status, 'ready');
    const job = await jobService.getJobStatus(confirmed.assessmentId, uid);
    assert.equal(job.result.schemaVersion, 'bel.speech.v3');
    assert.equal(job.result.rawProviderEvidence[0].RecognitionStatus, 'Success');
    assert.ok(job.resultRef.path.startsWith('ai-scoring-results/'));
    assert.equal((await db.collection('speakingAttempts').doc(attemptId).get()).data().v3ResultRef.sha256,
      job.resultRef.sha256);
    assert.equal((await db.collection('aiCreditAccounts').doc(uid).get()).data().spentCredits, 1);
    assert.ok((await db.collection('aiCreditLedger').doc(`${confirmed.assessmentId}:capture`).get()).exists);
    assert.equal((await jobService.cancelAssessment(confirmed.assessmentId, uid)).captured, true);
    assert.equal((await db.collection('aiCreditAccounts').doc(uid).get()).data().spentCredits, 1);
    const secondAttempt = `attempt_${id()}`;
    const sameBytes = await assets.upload({ uid, mode: 'repeat_sentence', attemptId: secondAttempt,
      uploadKey: 'same-recording', buffer: audio });
    const secondQuote = await jobService.createQuote({ uid, mode: 'repeat_sentence',
      questionId: '1', inputMeta: { audioId: sameBytes.audioId }, speechV3: true });
    const secondJob = await jobService.confirmQuote({ uid, quoteId: secondQuote.quoteId });
    assert.notEqual(secondJob.assessmentId, confirmed.assessmentId);
    assert.equal((await jobService.cancelAssessment(secondJob.assessmentId, uid)).released, true);
    assert.equal((await db.collection('aiCreditAccounts').doc(uid).get()).data().spentCredits, 1);
  });

  test('replacement audio invalidates stale quote; explicit cancel releases reservation', async () => {
    const uid = `learner-${id()}`;
    const attemptId = `attempt_${id()}`;
    const original = await assets.upload({ uid, mode: 'repeat_sentence', attemptId,
      uploadKey: 'original', buffer: wav() });
    const service = services(null);
    const staleQuote = await service.createQuote({ uid, mode: 'repeat_sentence',
      questionId: '1', inputMeta: { audioId: original.audioId }, speechV3: true });
    const replacement = await assets.upload({ uid, mode: 'repeat_sentence', attemptId,
      uploadKey: 'replacement', buffer: wav(16000, 3000) });
    await assert.rejects(service.createQuote({ uid, mode: 'repeat_sentence', questionId: '1',
      inputMeta: { audioId: original.audioId }, speechV3: true }), /AUDIO_REVISION_REPLACED/);
    await assert.rejects(service.confirmQuote({ uid, quoteId: staleQuote.quoteId }), /AUDIO_REVISION_REPLACED/);
    const freshQuote = await service.createQuote({ uid, mode: 'repeat_sentence',
      questionId: '1', inputMeta: { audioId: replacement.audioId }, speechV3: true });
    const confirmed = await service.confirmQuote({ uid, quoteId: freshQuote.quoteId });
    await assert.rejects(service.createQuote({ uid, mode: 'repeat_sentence', questionId: '1',
      inputMeta: { audioId: replacement.audioId }, speechV3: true }), /AUDIO_ALREADY_CONFIRMED/);
    assert.equal((await service.cancelAssessment(confirmed.assessmentId, uid)).released, true);
    assert.equal((await db.collection('aiCreditAccounts').doc(uid).get()).data().reservedCredits, 0);
    assert.equal((await db.collection('aiCreditAccounts').doc(uid).get()).data().spentCredits, 0);
    assert.ok((await db.collection('aiCreditLedger').doc(`${confirmed.assessmentId}:release`).get()).exists);
    assert.equal((await db.collection('aiScoringOutbox').doc(confirmed.assessmentId).get()).exists, false);
  });

  test('Entrance V3 archives original bytes and scores only its canonical derivative', async () => {
    const testId = id();
    const questionId = 's1';
    const original = Buffer.from('original captured webm audio bytes');
    const canonical = wav();
    const contentType = 'application/vnd.bel.speech-v3+json';
    const envelope = { version: 1, originalMimeType: 'audio/webm;codecs=opus',
      originalBase64: original.toString('base64'), assessmentBase64: canonical.toString('base64') };
    const input = parseEntranceV3Upload(Buffer.from(JSON.stringify(envelope)), contentType);
    assert.deepEqual(input.originalAudioBuffer, original);
    assert.deepEqual(input.audioBuffer, canonical);
    assert.throws(() => parseEntranceV3Upload(Buffer.from(JSON.stringify({ ...envelope,
      originalBase64: 'not base64' })), contentType), /INVALID_AUDIO_BASE64/);
    assert.throws(() => parseEntranceV3Upload(Buffer.from(JSON.stringify({ ...envelope,
      originalMimeType: 'text/html' })), contentType), /INVALID_ORIGINAL_AUDIO_TYPE/);
    assert.throws(() => parseEntranceV3Upload(Buffer.from(JSON.stringify({ ...envelope,
      assessmentBase64: original.toString('base64') })), contentType), /CANONICAL_WAV_REQUIRED/);
    const ref = db.collection('entranceTests').doc(testId);
    await ref.set({ status: 'created', studentId: 'synthetic-original-test' });
    const uploaded = await uploadEntranceV3({ db, bucket, testId, questionId,
      question: { expectedText: 'Next time' }, data: { studentId: 'synthetic-original-test' }, ...input });
    const entry = (await ref.get()).data().speaking[questionId];
    assert.notEqual(entry.audio.storagePath, entry.v3.audio.storagePath);
    assert.deepEqual((await bucket.file(entry.audio.storagePath).download())[0], original);
    assert.equal(entry.v3.manifest.originalUploadHash, crypto.createHash('sha256').update(original).digest('hex'));
    const result = await processEntranceV3({ db, bucket, revisionId: uploaded.revisionId,
      assess: async ({ audioBuffer }) => { assert.deepEqual(audioBuffer, canonical); return mockResult(); } });
    assert.equal(result.status, 'ready');
    assert.deepEqual((await bucket.file(entry.audio.storagePath).download())[0], original);
  });

  test('Entrance V3 workers retain support for older canonical-only records', async () => {
    const testId = id();
    const questionId = 's1';
    const canonical = wav();
    const ref = db.collection('entranceTests').doc(testId);
    await ref.set({ status: 'created', studentId: 'synthetic-legacy-test' });
    const uploaded = await uploadEntranceV3({ db, bucket, testId, questionId,
      question: { expectedText: 'Next time' }, data: { studentId: 'synthetic-legacy-test' }, audioBuffer: canonical });
    const entry = (await ref.get()).data().speaking[questionId];
    entry.audio = entry.v3.audio;
    delete entry.v3.audio;
    await ref.update({ [`speaking.${questionId}`]: entry });
    const result = await processEntranceV3({ db, bucket, revisionId: uploaded.revisionId,
      assess: async ({ audioBuffer }) => { assert.deepEqual(audioBuffer, canonical); return mockResult(); } });
    assert.equal(result.status, 'ready');
  });

  test('Entrance Test keeps the latest immutable revision and exposes its saved unmetered result', async () => {
    const testId = id();
    const studentId = `crm-${id()}`;
    const questionId = 'speaking_q1';
    const question = { expectedText: 'The students read aloud today.' };
    const ref = db.collection('entranceTests').doc(testId);
    await ref.set({ status: 'created', studentId, speaking: {} });
    const original = await uploadEntranceV3({ db, bucket, testId, questionId, question,
      data: { studentId }, audioBuffer: wav() });
    const latest = await uploadEntranceV3({ db, bucket, testId, questionId, question,
      data: { studentId }, audioBuffer: wav(16000, 4000) });
    const stale = await processEntranceV3({ db, bucket, revisionId: original.revisionId,
      assess: async () => { throw new Error('STALE_REVISION_WAS_SCORED'); } });
    assert.equal(stale.skipped, true);
    const completed = await processEntranceV3({ db, bucket, revisionId: latest.revisionId,
      assess: async () => mockResult() });
    assert.equal(completed.status, 'ready');
    const state = await getEntranceV3Status({ db, bucket, testId, questionId });
    assert.equal(state.revisionId, latest.revisionId);
    assert.equal(state.result.schemaVersion, 'bel.speech.v3');
    assert.equal(state.result.audio.canonicalFileHash, latest.manifest.canonicalFileHash);
    const saved = (await ref.get()).data().speaking[questionId];
    assert.equal(saved.v3.status, 'ready');
    assert.ok(saved.v3.resultRef.path.includes(latest.revisionId));
    assert.equal((await db.collection('aiCreditAccounts').doc(studentId).get()).exists, false);
  });

  test('a job finishing after its deadline releases credits instead of publishing a result', async () => {
    const uid = `learner-${id()}`;
    const attemptId = `attempt_${id()}`;
    const uploaded = await assets.upload({ uid, mode: 'repeat_sentence', attemptId,
      uploadKey: 'deadline', buffer: wav() });
    const service = services(null);
    const quote = await service.createQuote({ uid, mode: 'repeat_sentence', questionId: '1',
      inputMeta: { audioId: uploaded.audioId }, speechV3: true });
    const confirmed = await service.confirmQuote({ uid, quoteId: quote.quoteId });
    const worker = new ScoringWorker({ db, settlementService, storageBucket: bucket,
      stageExecutors: { repeat_sentence: async () => {
        await db.collection('aiScoringJobs').doc(confirmed.assessmentId)
          .update({ deadlineAt: new Date(Date.now() - 1000).toISOString() });
        return mockResult();
      } } });
    const outcome = await worker.processJob(confirmed.assessmentId, 'late-worker', { enableHeartbeat: false });
    assert.equal(outcome.status, 'failed');
    const job = (await db.collection('aiScoringJobs').doc(confirmed.assessmentId).get()).data();
    assert.equal(job.status, 'failed');
    assert.equal(job.resultRef || null, null);
    const wallet = (await db.collection('aiCreditAccounts').doc(uid).get()).data();
    assert.equal(wallet.reservedCredits, 0);
    assert.equal(wallet.spentCredits, 0);
    assert.ok((await db.collection('aiCreditLedger').doc(`${confirmed.assessmentId}:release`).get()).exists);
  });

  test('Entrance Test does not attach a result completed after its deadline', async () => {
    const testId = id();
    const studentId = `crm-${id()}`;
    const questionId = 'speaking_q1';
    const ref = db.collection('entranceTests').doc(testId);
    await ref.set({ status: 'started', studentId, speaking: {} });
    const uploaded = await uploadEntranceV3({ db, bucket, testId, questionId,
      question: { expectedText: 'The students read aloud today.' },
      data: { studentId }, audioBuffer: wav() });
    const outcome = await processEntranceV3({ db, bucket, revisionId: uploaded.revisionId,
      assess: async () => {
        await db.collection('entranceSpeechOutbox').doc(uploaded.revisionId)
          .update({ deadlineAt: new Date(Date.now() - 1000).toISOString() });
        return mockResult();
      } });
    assert.equal(outcome.status, 'failed');
    const entry = (await ref.get()).data().speaking[questionId];
    assert.equal(entry.v3.status, 'failed');
    assert.equal(entry.v3.resultRef || null, null);
    assert.equal((await db.collection('entranceSpeechOutbox').doc(uploaded.revisionId).get()).exists, false);
  });

  test('expired unconfirmed canonical audio is removed without deleting the archived attempt', async () => {
    const uid = `learner-${id()}`;
    const attemptId = `attempt_${id()}`;
    const uploaded = await assets.upload({ uid, mode: 'repeat_sentence', attemptId,
      uploadKey: 'abandoned', buffer: wav() });
    const attemptRef = db.collection('speakingAttempts').doc(attemptId);
    await attemptRef.update({ status: 'uploaded' });
    const assetRef = db.collection('aiScoringAudio').doc(uploaded.audioId);
    const path = (await assetRef.get()).data().storagePath;
    const service = services(null);
    const quote = await service.createQuote({ uid, mode: 'repeat_sentence', questionId: '1',
      inputMeta: { audioId: uploaded.audioId }, speechV3: true });
    let checkedConcurrentConfirmation = false;
    await runSpeakingAttemptCleanup(db, { now: new Date(Date.now() + 49 * 60 * 60 * 1000),
      getBucket: async () => ({ file: name => ({ delete: async () => {
        assert.equal(name, path);
        assert.equal((await assetRef.get()).data().status, 'deleting');
        await assert.rejects(service.confirmQuote({ uid, quoteId: quote.quoteId }),
          /AUDIO_ASSET_EXPIRED_OR_CHANGED/);
        checkedConcurrentConfirmation = true;
        await bucket.file(name).delete();
      } }) }) });
    assert.equal(checkedConcurrentConfirmation, true);
    assert.equal((await assetRef.get()).exists, false);
    assert.equal((await bucket.file(path).exists())[0], false);
    const attempt = (await attemptRef.get()).data();
    assert.equal(attempt.status, 'uploaded');
    assert.equal(attempt.v3AudioId, null);
    assert.deepEqual(attempt.v3AudioRevisionIds, []);
    assert.equal((await db.collection('aiCreditAccounts').doc(uid).get()).data()?.reservedCredits || 0, 0);
  });
}
