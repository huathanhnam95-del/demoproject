/* eslint-disable no-console */
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const createCrmRouter = require('../../functions/src/routes/admin/create-crm-router');
const {
  buildRes,
  createFakeDb,
  getRouteHandlers,
  invokeHandlers,
  createReq
} = require('./route-test-helpers');
const { automaticOrderFor, automaticVersionOrderFor } = require('../../functions/src/routes/admin/segmentation-study');

const MANIFEST_SHA256 = 'a'.repeat(64);
const MANIFEST_VERSION = '2.0.0';
const BUNDLED_MANIFEST_SHA256 = '4db7d2c260fd5be5ac8e050f0cb31dfde2368cdba43453172bfeca4a352adfce';
const ACTIVE_STUDY_VERSION = 'study-v2';

function makeWavBuffer(fillByte = 0) {
  const dataSize = 64000;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(16000, 24);
  buffer.writeUInt32LE(64000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  if (fillByte) buffer.fill(fillByte, 44);
  return buffer;
}

function makeBucket() {
  const files = new Map();
  return {
    files,
    file(storagePath) {
      return {
        async save(bytes) { files.set(storagePath, Buffer.from(bytes)); },
        async delete() { files.delete(storagePath); },
        async download() { return [files.get(storagePath) || makeWavBuffer()]; },
        async getSignedUrl() { return [`https://storage.test/${encodeURIComponent(storagePath)}`]; }
      };
    }
  };
}

function makeRouter({ db, bucket, manifest, useInjectedManifest = true }) {
  return createCrmRouter({
    db,
    admin: {},
    authMiddleware: (req, _res, next) => {
      req.user = { uid: 'admin-1', email: 'admin@example.com' };
      next();
    },
    adminMiddleware: (_req, _res, next) => next(),
    sendSuccess: (res, data, message) => res.status(200).json({ success: true, data, message }),
    sendError: (res, status, error, message) => res.status(status).json({ success: false, error, message }),
    getStorageBucket: async () => bucket,
    serverTimestamp: () => new Date('2026-08-13T00:00:00.000Z'),
    ...(useInjectedManifest ? { studyManifests: { v1: legacyManifest, v2: manifest } } : {}),
    identity: {
      generateClassCode: async () => 'ABC123',
      lookupUserByEmail: async () => ({ uid: 'u1' }),
      forceLinkProfile: async () => ({ success: true })
    }
  });
}

function serializeTransactions(db) {
  let transactionTail = Promise.resolve();
  return {
    ...db,
    runTransaction(callback) {
      const result = transactionTail.then(() => db.runTransaction(callback));
      transactionTail = result.catch(() => {});
      return result;
    }
  };
}

function reservationDocIdForTest(studyVersion, operatorName, sessionId) {
  return crypto.createHash('sha256').update(`${studyVersion}\n${operatorName}\n${sessionId}`).digest('hex');
}

const manifest = [
  {
    taskId: 'segmentation-study-v2-0001',
    order: 0,
    split: 'development',
    targetWord: 'ability',
    referenceIpa: '/əˈbɪləti/',
    referenceSyllableIpa: ['ə', 'bɪ', 'lə', 'ti'],
    targetSyllableCount: 4,
    transitionClasses: ['vowel-stop']
  },
  {
    taskId: 'segmentation-study-v2-0002',
    order: 1,
    split: 'holdout',
    targetWord: 'camera',
    referenceIpa: '/ˈkæmərə/',
    referenceSyllableIpa: ['kæ', 'mə', 'rə'],
    targetSyllableCount: 3,
    transitionClasses: ['stop-nasal']
  }
];

manifest.manifestVersion = MANIFEST_VERSION;
manifest.manifestSha256 = MANIFEST_SHA256;
manifest.dialect = 'en-US';

const legacyManifest = [
  { taskId: 'study-v1-001', order: 0, targetWord: 'legacy', referenceIpa: '/legacy/', referenceSyllableIpa: ['le', 'ga', 'cy'], targetSyllableCount: 3 }
];

const db = createFakeDb({
  'pronunciationSegmentationStudyTasks/segmentation-study-v2-0001': {
    ...manifest[0], studyVersion: ACTIVE_STUDY_VERSION, status: 'available', claim: null, claimExpiresAt: null
  },
  'pronunciationSegmentationStudyTasks/segmentation-study-v2-0002': {
    ...manifest[1], studyVersion: ACTIVE_STUDY_VERSION, status: 'available', claim: null, claimExpiresAt: null
  },
  'pronunciationSegmentationStudyTasks/study-v1-001': {
    ...legacyManifest[0], studyVersion: 'study-v1', status: 'available', claim: null, claimExpiresAt: null
  },
  'pronunciationCorpusSamples/previous-sample': {
    sampleId: 'previous-sample',
    targetWord: 'recording',
    referenceIpa: '/rɪˈkɔrdɪŋ/',
    expectedObservedCount: 3,
    targetSyllableCount: 3,
    category: 'clean',
    speakerCohort: 'previous',
    durationSeconds: 2,
    storagePath: 'pronunciation-segmentation-corpus/previous-sample.wav',
    studyPreviousSample: true,
    sourceHash: 'same-hash',
    reviewStatus: 'pending'
  },
  'pronunciationCorpusSamples/previous-sample-duplicate': {
    sampleId: 'previous-sample-duplicate',
    targetWord: 'recording',
    referenceIpa: '/recording/',
    expectedObservedCount: 3,
    targetSyllableCount: 3,
    category: 'clean',
    speakerCohort: 'previous',
    durationSeconds: 2,
    storagePath: 'pronunciation-segmentation-corpus/previous-sample-duplicate.wav',
    studyPreviousSample: true,
    sourceHash: 'same-hash',
    reviewStatus: 'pending'
  }
});
const bucket = makeBucket();
const router = makeRouter({ db, bucket, manifest });

function makeComparison(status = 'complete') {
  const spans = (offset = 0) => [
    { startTime: 0.1 + offset, endTime: 0.3 + offset },
    { startTime: 0.3 + offset, endTime: 0.6 + offset },
    { startTime: 0.6 + offset, endTime: 0.9 + offset },
    { startTime: 0.9 + offset, endTime: 1.2 + offset }
  ];
  return {
    schemaVersion: 'pronunciation-comparison-v2',
    status,
    comparisonId: 'comparison-study-v2-1',
    dialect: 'en-US',
    v2: { status, analysis: { analysisVersion: 'pronunciation-analysis-v2', observed_syllables: spans(0.01) } },
    v3: {
      status,
      analysis: {
        analysisVersion: 'pronunciation-analysis-v3',
        observed_syllables: spans(0.02),
        partitionVariants: {
          schemaVersion: 'pronunciation-partition-variants-v2',
          v3: spans(0.02),
          v4: spans(0.03),
          v4AnalysisVersion: 'pronunciation-analysis-v4'
        }
      }
    },
    v4: { status, analysis: {
      analysisVersion: 'pronunciation-analysis-v4', source: 'partitionVariants.v4', partitionSchemaVersion: 'pronunciation-partition-variants-v2',
      provenance: { source: 'partitionVariants.v4', variant: 'v4', schemaVersion: 'pronunciation-partition-variants-v2' }, observed_syllables: spans(0.03)
    } }
  };
}

function strictMetadata(overrides = {}) {
  return {
    studyVersion: ACTIVE_STUDY_VERSION,
  taskId: 'segmentation-study-v2-0001',
    operatorName: 'Reviewer One',
    sessionId: 'crm-test-session-001',
    targetWord: 'ability',
    referenceIpa: '/əˈbɪləti/',
    referenceSyllableIpa: ['ə', 'bɪ', 'lə', 'ti'],
    targetSyllableCount: 4,
    expectedObservedCount: 4,
    manualSegmentationConvention: 'ipa-phonological-contiguous-v1',
    manualSegments: [
      { startTime: 0.1, endTime: 0.3 },
      { startTime: 0.3, endTime: 0.6 },
      { startTime: 0.6, endTime: 0.9 },
      { startTime: 0.9, endTime: 1.2 }
    ],
    wordBounds: { startTime: 0.1, endTime: 1.2 },
    certainty: 'certain',
    automaticBoundariesVisible: true,
    annotationProtocol: 'automatic-visible-assisted-v1',
    analysisStatus: 'complete',
    comparison: makeComparison(),
    captureSettings: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      deviceId: 'must-not-persist',
      groupId: 'must-not-persist'
    },
    manifestVersion: MANIFEST_VERSION,
    manifestSha256: MANIFEST_SHA256,
    dialect: 'en-US',
    referenceLabelProvenance: 'explicit-reviewed-en-US-v1',
    variantProvenance: {
      v2: { analysisVersion: 'pronunciation-analysis-v2', source: 'comparison.v2' },
      v3: { analysisVersion: 'pronunciation-analysis-v3', source: 'partitionVariants.v3' },
      v4: { analysisVersion: 'pronunciation-analysis-v4', source: 'partitionVariants.v4' }
    },
    playbackConfirmed: true,
    exposureLog: [{ event: 'client-replacement-must-not-persist' }],
    versionExposureLog: automaticVersionOrderFor(MANIFEST_SHA256, 'segmentation-study-v2-0001').map((version, index) => ({ version, automaticOrder: automaticOrderFor(MANIFEST_SHA256, 'segmentation-study-v2-0001'), viewedAt: `2026-08-19T00:00:0${index}.000Z` })),
    captureConstraintsRequested: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    captureEligibility: true,
    ...overrides
  };
}

(async () => {
  const targetedManifest = [
    {
      taskId: 'segmentation-study-v2-abroad',
      order: 0,
      split: 'development',
      targetWord: 'abroad',
      referenceIpa: '/əˈbrɔːd/',
      referenceSyllableIpa: ['ə', 'brɔːd'],
      targetSyllableCount: 2
    },
    {
      taskId: 'segmentation-study-v2-expired',
      order: 1,
      split: 'development',
      targetWord: 'expired',
      referenceIpa: '/ɪkˈspaɪəd/',
      referenceSyllableIpa: ['ɪk', 'spaɪəd'],
      targetSyllableCount: 2
    },
    {
      taskId: 'segmentation-study-v2-other-owner',
      order: 2,
      split: 'development',
      targetWord: 'other',
      referenceIpa: '/ˈʌðə/',
      referenceSyllableIpa: ['ʌ', 'ðə'],
      targetSyllableCount: 2
    },
    {
      taskId: 'segmentation-study-v2-completed',
      order: 3,
      split: 'holdout',
      targetWord: 'completed',
      referenceIpa: '/kəmˈpliːtɪd/',
      referenceSyllableIpa: ['kəm', 'pliː', 'tɪd'],
      targetSyllableCount: 3
    },
    {
      taskId: 'segmentation-study-v2-holdout-available',
      order: 4,
      split: 'holdout',
      targetWord: 'holdout',
      referenceIpa: '/ˈhoʊldaʊt/',
      referenceSyllableIpa: ['hoʊl', 'daʊt'],
      targetSyllableCount: 2
    },
    {
      taskId: 'segmentation-study-v2-completed-development',
      order: 5,
      split: 'development',
      targetWord: 'finished',
      referenceIpa: '/ˈfɪnɪʃt/',
      referenceSyllableIpa: ['fɪn', 'ɪʃt'],
      targetSyllableCount: 2
    }
  ];
  targetedManifest.manifestVersion = MANIFEST_VERSION;
  targetedManifest.manifestSha256 = 'c'.repeat(64);
  targetedManifest.dialect = 'en-US';
  const targetedDb = createFakeDb({
    'pronunciationSegmentationStudyTasks/segmentation-study-v2-abroad': {
      ...targetedManifest[0], studyVersion: ACTIVE_STUDY_VERSION, status: 'available', claim: null, claimExpiresAt: null
    },
    'pronunciationSegmentationStudyTasks/segmentation-study-v2-expired': {
      ...targetedManifest[1], studyVersion: ACTIVE_STUDY_VERSION, status: 'reserved',
      claim: { operatorName: 'Previous reviewer', sessionId: 'previous-session-001' }, claimExpiresAt: new Date('2020-01-01T00:00:00.000Z')
    },
    'pronunciationSegmentationStudyTasks/segmentation-study-v2-other-owner': {
      ...targetedManifest[2], studyVersion: ACTIVE_STUDY_VERSION, status: 'reserved',
      claim: { operatorName: 'Other reviewer', sessionId: 'other-session-001' }, claimExpiresAt: new Date('2099-01-01T00:00:00.000Z')
    },
    'pronunciationSegmentationStudyTasks/segmentation-study-v2-completed': {
      ...targetedManifest[3], studyVersion: ACTIVE_STUDY_VERSION, status: 'completed', claim: null, claimExpiresAt: null
    },
    'pronunciationSegmentationStudyTasks/segmentation-study-v2-holdout-available': {
      ...targetedManifest[4], studyVersion: ACTIVE_STUDY_VERSION, status: 'available', claim: null, claimExpiresAt: null
    },
    'pronunciationSegmentationStudyTasks/segmentation-study-v2-orphan': {
      taskId: 'segmentation-study-v2-orphan', order: 5, split: 'development', targetWord: 'orphan',
      referenceIpa: '/ˈɔːrfən/', referenceSyllableIpa: ['ɔːr', 'fən'], targetSyllableCount: 2,
      studyVersion: ACTIVE_STUDY_VERSION, status: 'available', claim: null, claimExpiresAt: null
    },
    'pronunciationSegmentationStudyTasks/segmentation-study-v2-completed-development': {
      ...targetedManifest[5], studyVersion: ACTIVE_STUDY_VERSION, status: 'completed', claim: null, claimExpiresAt: null
    }
  });
  const targetedRouter = makeRouter({ db: targetedDb, bucket: makeBucket(), manifest: targetedManifest });
  const targetedClaimHandlers = getRouteHandlers(targetedRouter, '/dev/segmentation-study/:studyVersion/claim-next', 'post');
  const targetedIdentity = { operatorName: 'Pilot reviewer', sessionId: 'pilot-session-001' };

  const invalidTargetRes = buildRes();
  await invokeHandlers(targetedClaimHandlers, createReq({
    params: { studyVersion: 'v2' },
    body: { ...targetedIdentity, taskId: 'INVALID TASK ID' }
  }), invalidTargetRes);
  assert.strictEqual(invalidTargetRes._status, 400, 'An explicit claim taskId must be validated.');
  assert.strictEqual(invalidTargetRes._json.error, 'VALIDATION_ERROR');

  const unknownTargetRes = buildRes();
  await invokeHandlers(targetedClaimHandlers, createReq({
    params: { studyVersion: 'v2' },
    body: { ...targetedIdentity, taskId: 'segmentation-study-v2-missing' }
  }), unknownTargetRes);
  assert.strictEqual(unknownTargetRes._status, 404, 'An unknown explicit taskId must fail closed.');
  assert.strictEqual(unknownTargetRes._json.error, 'TASK_NOT_FOUND');

  const completedTargetRes = buildRes();
  await invokeHandlers(targetedClaimHandlers, createReq({
    params: { studyVersion: 'v2' },
    body: { ...targetedIdentity, taskId: 'segmentation-study-v2-completed' }
  }), completedTargetRes);
  assert.strictEqual(completedTargetRes._status, 409, 'A completed explicit taskId must fail closed.');
  assert.strictEqual(completedTargetRes._json.error, 'HOLDOUT_LOCKED');

  const completedDevelopmentRes = buildRes();
  await invokeHandlers(targetedClaimHandlers, createReq({
    params: { studyVersion: 'v2' },
    body: { ...targetedIdentity, taskId: 'segmentation-study-v2-completed-development' }
  }), completedDevelopmentRes);
  assert.strictEqual(completedDevelopmentRes._status, 409, 'A completed development task must remain non-claimable.');
  assert.strictEqual(completedDevelopmentRes._json.error, 'TASK_COMPLETED');

  const otherOwnerTargetRes = buildRes();
  await invokeHandlers(targetedClaimHandlers, createReq({
    params: { studyVersion: 'v2' },
    body: { ...targetedIdentity, taskId: 'segmentation-study-v2-other-owner' }
  }), otherOwnerTargetRes);
  assert.strictEqual(otherOwnerTargetRes._status, 409, 'An actively owned explicit taskId must fail closed.');
  assert.strictEqual(otherOwnerTargetRes._json.error, 'CLAIM_CONFLICT');

  const holdoutTargetRes = buildRes();
  await invokeHandlers(targetedClaimHandlers, createReq({
    params: { studyVersion: 'v2' },
    body: { ...targetedIdentity, taskId: 'segmentation-study-v2-holdout-available' }
  }), holdoutTargetRes);
  assert.strictEqual(holdoutTargetRes._status, 409, 'Explicit holdout claims must fail closed.');
  assert.strictEqual(holdoutTargetRes._json.error, 'HOLDOUT_LOCKED');
  const holdoutAfterReject = targetedDb.docs.get('pronunciationSegmentationStudyTasks/segmentation-study-v2-holdout-available');
  assert.strictEqual(holdoutAfterReject.status, 'available', 'Rejecting an explicit holdout claim must not mutate the task.');
  assert.strictEqual(holdoutAfterReject.claim, null);
  assert.strictEqual(Array.from(targetedDb.docs.keys()).filter((key) => key.startsWith('pronunciationSegmentationStudyReservations/')).length, 0, 'Rejecting an explicit holdout claim must not create a reservation lock.');

  const orphanTargetRes = buildRes();
  await invokeHandlers(targetedClaimHandlers, createReq({
    params: { studyVersion: 'v2' },
    body: { ...targetedIdentity, taskId: 'segmentation-study-v2-orphan' }
  }), orphanTargetRes);
  assert.strictEqual(orphanTargetRes._status, 409, 'Explicit claims must reference the current immutable manifest.');
  assert.strictEqual(orphanTargetRes._json.error, 'MANIFEST_MISMATCH');
  assert.strictEqual(targetedDb.docs.get('pronunciationSegmentationStudyTasks/segmentation-study-v2-orphan').status, 'available');

  const exactTargetRes = buildRes();
  await invokeHandlers(targetedClaimHandlers, createReq({
    params: { studyVersion: 'v2' },
    body: { ...targetedIdentity, taskId: 'segmentation-study-v2-abroad' }
  }), exactTargetRes);
  assert.strictEqual(exactTargetRes._status, 200);
  assert.strictEqual(exactTargetRes._json.data.task.taskId, 'segmentation-study-v2-abroad', 'An explicit claim must reserve the requested task, not the first task.');
  assert.strictEqual(exactTargetRes._json.data.task.status, 'reserved');
  assert.strictEqual(targetedDb.docs.get('pronunciationSegmentationStudyTasks/segmentation-study-v2-abroad').claim.operatorName, targetedIdentity.operatorName);

  const unknownWhileActiveRes = buildRes();
  await invokeHandlers(targetedClaimHandlers, createReq({
    params: { studyVersion: 'v2' },
    body: { ...targetedIdentity, taskId: 'segmentation-study-v2-missing-active' }
  }), unknownWhileActiveRes);
  assert.strictEqual(unknownWhileActiveRes._status, 404, 'An unknown explicit taskId must remain 404 even when the operator has another active claim.');

  const idempotentTargetRes = buildRes();
  await invokeHandlers(targetedClaimHandlers, createReq({
    params: { studyVersion: 'v2' },
    body: { ...targetedIdentity, taskId: 'segmentation-study-v2-abroad' }
  }), idempotentTargetRes);
  assert.strictEqual(idempotentTargetRes._status, 200, 'The same owner must be able to resume an explicit active claim.');
  assert.strictEqual(idempotentTargetRes._json.data.task.taskId, 'segmentation-study-v2-abroad');
  assert.strictEqual(targetedDb.docs.get('pronunciationSegmentationStudyTasks/segmentation-study-v2-abroad').exposureLog.length, 1, 'Resuming a claim must not append a second exposure event.');

  const releaseTargetHandlers = getRouteHandlers(targetedRouter, '/dev/segmentation-study/:studyVersion/tasks/:taskId/release', 'post');
  const releasedTargetRes = buildRes();
  await invokeHandlers(releaseTargetHandlers, createReq({
    params: { studyVersion: 'v2', taskId: 'segmentation-study-v2-abroad' },
    body: targetedIdentity
  }), releasedTargetRes);
  assert.strictEqual(releasedTargetRes._status, 200);
  const releasedTargetListRes = buildRes();
  await invokeHandlers(getRouteHandlers(targetedRouter, '/dev/segmentation-study/:studyVersion', 'get'), createReq({ params: { studyVersion: 'v2' } }), releasedTargetListRes);
  const releasedTarget = releasedTargetListRes._json.data.tasks.find((task) => task.taskId === 'segmentation-study-v2-abroad');
  assert.strictEqual(releasedTarget.status, 'available', 'Releasing an exact claim must return that task to the clean available queue.');
  assert.strictEqual(releasedTarget.claim, null);

  const expiredTargetRes = buildRes();
  await invokeHandlers(targetedClaimHandlers, createReq({
    params: { studyVersion: 'v2' },
    body: { ...targetedIdentity, taskId: 'segmentation-study-v2-expired' }
  }), expiredTargetRes);
  assert.strictEqual(expiredTargetRes._status, 200, 'An expired explicit claim may be reclaimed.');
  assert.strictEqual(expiredTargetRes._json.data.task.taskId, 'segmentation-study-v2-expired');

  const raceManifest = [
    { taskId: 'segmentation-study-v2-race-a', order: 0, split: 'development', targetWord: 'racea', referenceIpa: '/ˈreɪsə/', referenceSyllableIpa: ['reɪ', 'sə'], targetSyllableCount: 2 },
    { taskId: 'segmentation-study-v2-race-b', order: 1, split: 'development', targetWord: 'raceb', referenceIpa: '/ˈreɪsb/', referenceSyllableIpa: ['reɪ', 'sb'], targetSyllableCount: 2 }
  ];
  raceManifest.manifestVersion = MANIFEST_VERSION;
  raceManifest.manifestSha256 = 'd'.repeat(64);
  raceManifest.dialect = 'en-US';
  const raceDb = serializeTransactions(createFakeDb({
    'pronunciationSegmentationStudyTasks/segmentation-study-v2-race-a': { ...raceManifest[0], studyVersion: ACTIVE_STUDY_VERSION, status: 'available', claim: null, claimExpiresAt: null },
    'pronunciationSegmentationStudyTasks/segmentation-study-v2-race-b': { ...raceManifest[1], studyVersion: ACTIVE_STUDY_VERSION, status: 'available', claim: null, claimExpiresAt: null }
  }));
  const raceRouter = makeRouter({ db: raceDb, bucket: makeBucket(), manifest: raceManifest });
  const raceClaimHandlers = getRouteHandlers(raceRouter, '/dev/segmentation-study/:studyVersion/claim-next', 'post');
  const raceIdentity = { operatorName: 'Concurrent reviewer', sessionId: 'concurrent-session-001' };
  const raceResponses = await Promise.all(['segmentation-study-v2-race-a', 'segmentation-study-v2-race-b'].map(async (taskId) => {
    const response = buildRes();
    await invokeHandlers(raceClaimHandlers, createReq({ params: { studyVersion: 'v2' }, body: { ...raceIdentity, taskId } }), response);
    return response;
  }));
  assert.strictEqual(raceResponses.filter((response) => response._status === 200).length, 1, 'Concurrent exact claims for one operator must have one winner.');
  assert.strictEqual(raceResponses.filter((response) => response._status === 409 && response._json.error === 'CLAIM_CONFLICT').length, 1, 'The losing concurrent exact claim must fail with CLAIM_CONFLICT.');
  const raceReservations = Array.from(raceDb.docs.entries()).filter(([key]) => key.startsWith('pronunciationSegmentationStudyReservations/'));
  assert.strictEqual(raceReservations.length, 1, 'Concurrent exact claims must use one deterministic reservation record.');
  assert.strictEqual(raceReservations[0][1].status, 'reserved');
  const raceWinner = raceResponses.find((response) => response._status === 200)._json.data.task.taskId;
  const raceHeartbeatRes = buildRes();
  await invokeHandlers(getRouteHandlers(raceRouter, '/dev/segmentation-study/:studyVersion/tasks/:taskId/heartbeat', 'post'), createReq({
    params: { studyVersion: 'v2', taskId: raceWinner }, body: raceIdentity
  }), raceHeartbeatRes);
  assert.strictEqual(raceHeartbeatRes._status, 200);
  const heartbeatReservation = raceReservations[0][1];
  assert.strictEqual(heartbeatReservation.taskId, raceWinner, 'Heartbeat must keep the deterministic reservation tied to the task.');
  const raceReleaseRes = buildRes();
  await invokeHandlers(getRouteHandlers(raceRouter, '/dev/segmentation-study/:studyVersion/tasks/:taskId/release', 'post'), createReq({
    params: { studyVersion: 'v2', taskId: raceWinner }, body: raceIdentity
  }), raceReleaseRes);
  assert.strictEqual(raceReleaseRes._status, 200);
  assert.strictEqual(raceDb.docs.get(raceReservations[0][0]).status, 'released', 'Release must clear the deterministic reservation record.');
  assert.strictEqual(raceDb.docs.get(raceReservations[0][0]).taskId, null);

  const mixedRaceManifest = [
    { taskId: 'segmentation-study-v2-mixed-a', order: 0, split: 'development', targetWord: 'mixeda', referenceIpa: '/ˈmɪkst eɪ/', referenceSyllableIpa: ['mɪkst', 'eɪ'], targetSyllableCount: 2 },
    { taskId: 'segmentation-study-v2-mixed-b', order: 1, split: 'development', targetWord: 'mixedb', referenceIpa: '/ˈmɪkst biː/', referenceSyllableIpa: ['mɪkst', 'biː'], targetSyllableCount: 2 }
  ];
  mixedRaceManifest.manifestVersion = MANIFEST_VERSION;
  mixedRaceManifest.manifestSha256 = 'e'.repeat(64);
  mixedRaceManifest.dialect = 'en-US';
  const mixedRaceDb = serializeTransactions(createFakeDb({
    'pronunciationSegmentationStudyTasks/segmentation-study-v2-mixed-a': { ...mixedRaceManifest[0], studyVersion: ACTIVE_STUDY_VERSION, status: 'available', claim: null, claimExpiresAt: null },
    'pronunciationSegmentationStudyTasks/segmentation-study-v2-mixed-b': { ...mixedRaceManifest[1], studyVersion: ACTIVE_STUDY_VERSION, status: 'available', claim: null, claimExpiresAt: null }
  }));
  const mixedRaceRouter = makeRouter({ db: mixedRaceDb, bucket: makeBucket(), manifest: mixedRaceManifest });
  const mixedRaceClaimHandlers = getRouteHandlers(mixedRaceRouter, '/dev/segmentation-study/:studyVersion/claim-next', 'post');
  const mixedRaceIdentity = { operatorName: 'Mixed concurrent reviewer', sessionId: 'mixed-concurrent-session-001' };
  const mixedRaceResponses = await Promise.all([
    (async () => {
      const response = buildRes();
      await invokeHandlers(mixedRaceClaimHandlers, createReq({ params: { studyVersion: 'v2' }, body: { ...mixedRaceIdentity, taskId: 'segmentation-study-v2-mixed-b' } }), response);
      return response;
    })(),
    (async () => {
      const response = buildRes();
      await invokeHandlers(mixedRaceClaimHandlers, createReq({ params: { studyVersion: 'v2' }, body: mixedRaceIdentity }), response);
      return response;
    })()
  ]);
  const mixedRaceSuccessIds = mixedRaceResponses.filter((response) => response._status === 200).map((response) => response._json.data.task.taskId);
  assert.ok(mixedRaceSuccessIds.length >= 1, 'Exact-vs-ordinary concurrency must leave one successful reservation response.');
  assert.strictEqual(new Set(mixedRaceSuccessIds).size, 1, 'Exact-vs-ordinary concurrency must not produce two different claimed tasks.');
  const mixedRaceActiveTasks = Array.from(mixedRaceDb.docs.values()).filter((task) => task.studyVersion === ACTIVE_STUDY_VERSION && task.status === 'reserved' && task.claim?.operatorName === mixedRaceIdentity.operatorName);
  assert.strictEqual(mixedRaceActiveTasks.length, 1, 'Exact-vs-ordinary concurrency must leave at most one active task for an operator.');

  const ordinaryManifest = [
    { taskId: 'segmentation-study-v2-ordinary-mismatched', order: 1, split: 'development', targetWord: 'mismatch', referenceIpa: '/mɪsˈmætʃ/', referenceSyllableIpa: ['mɪs', 'mætʃ'], targetSyllableCount: 2 },
    { taskId: 'segmentation-study-v2-ordinary-valid', order: 2, split: 'development', targetWord: 'valid', referenceIpa: '/ˈvælɪd/', referenceSyllableIpa: ['væ', 'lɪd'], targetSyllableCount: 2 }
  ];
  ordinaryManifest.manifestVersion = MANIFEST_VERSION;
  ordinaryManifest.manifestSha256 = 'e'.repeat(64);
  ordinaryManifest.dialect = 'en-US';
  const ordinaryDb = createFakeDb({
    'pronunciationSegmentationStudyTasks/segmentation-study-v2-ordinary-orphan': {
      taskId: 'segmentation-study-v2-ordinary-orphan', order: 0, split: 'development', targetWord: 'orphan',
      referenceIpa: '/ˈɔːrfən/', referenceSyllableIpa: ['ɔːr', 'fən'], targetSyllableCount: 2,
      studyVersion: ACTIVE_STUDY_VERSION, status: 'available', claim: null, claimExpiresAt: null
    },
    'pronunciationSegmentationStudyTasks/segmentation-study-v2-ordinary-mismatched': {
      ...ordinaryManifest[0], studyVersion: ACTIVE_STUDY_VERSION, manifestVersion: MANIFEST_VERSION, manifestSha256: 'f'.repeat(64),
      status: 'available', claim: null, claimExpiresAt: null
    },
    'pronunciationSegmentationStudyTasks/segmentation-study-v2-ordinary-valid': {
      ...ordinaryManifest[1], studyVersion: ACTIVE_STUDY_VERSION, manifestVersion: MANIFEST_VERSION, manifestSha256: ordinaryManifest.manifestSha256,
      status: 'available', claim: null, claimExpiresAt: null
    }
  });
  const ordinaryRouter = makeRouter({ db: ordinaryDb, bucket: makeBucket(), manifest: ordinaryManifest });
  const ordinaryClaimHandlers = getRouteHandlers(ordinaryRouter, '/dev/segmentation-study/:studyVersion/claim-next', 'post');
  const ordinaryIdentity = { operatorName: 'Sequential reviewer', sessionId: 'sequential-session-001' };
  const ordinaryClaimRes = buildRes();
  await invokeHandlers(ordinaryClaimHandlers, createReq({
    params: { studyVersion: 'v2' }, body: ordinaryIdentity
  }), ordinaryClaimRes);
  assert.strictEqual(ordinaryClaimRes._status, 200, 'Ordinary claim must continue after stale or orphaned candidates.');
  assert.strictEqual(ordinaryClaimRes._json.data.task.taskId, 'segmentation-study-v2-ordinary-valid', 'Ordinary claim must select the next current-manifest task.');
  assert.strictEqual(ordinaryDb.docs.get('pronunciationSegmentationStudyTasks/segmentation-study-v2-ordinary-orphan').status, 'available', 'An orphan ordinary candidate must not be claimed.');
  assert.strictEqual(ordinaryDb.docs.get('pronunciationSegmentationStudyTasks/segmentation-study-v2-ordinary-mismatched').status, 'available', 'A hash-mismatched ordinary candidate must not be claimed.');
  const staleOrdinaryReservationEntries = Array.from(ordinaryDb.docs.entries()).filter(([key]) => key.startsWith('pronunciationSegmentationStudyReservations/'));
  assert.strictEqual(staleOrdinaryReservationEntries.length, 1, 'Skipped ordinary candidates must not create reservation records.');
  assert.strictEqual(staleOrdinaryReservationEntries[0][1].taskId, 'segmentation-study-v2-ordinary-valid');

  const lockManifest = [
    { taskId: 'segmentation-study-v2-lock-valid', order: 0, split: 'development', targetWord: 'lock', referenceIpa: '/ˈlɒkɪŋ/', referenceSyllableIpa: ['lɒ', 'kɪŋ'], targetSyllableCount: 2 }
  ];
  lockManifest.manifestVersion = MANIFEST_VERSION;
  lockManifest.manifestSha256 = 'b'.repeat(64);
  lockManifest.dialect = 'en-US';
  const lockIdentity = { operatorName: 'Lock reviewer', sessionId: 'lock-session-001' };
  const lockDocKey = `pronunciationSegmentationStudyReservations/${reservationDocIdForTest(ACTIVE_STUDY_VERSION, lockIdentity.operatorName, lockIdentity.sessionId)}`;
  const lockDb = createFakeDb({
    'pronunciationSegmentationStudyTasks/segmentation-study-v2-lock-valid': {
      ...lockManifest[0], studyVersion: ACTIVE_STUDY_VERSION, manifestVersion: MANIFEST_VERSION, manifestSha256: lockManifest.manifestSha256,
      status: 'available', claim: null, claimExpiresAt: null
    },
    [lockDocKey]: {
      studyVersion: ACTIVE_STUDY_VERSION, studyId: 'segmentation-study-v2', taskId: 'segmentation-study-v2-expired-lock',
      operatorName: lockIdentity.operatorName, sessionId: lockIdentity.sessionId, status: 'reserved',
      claimExpiresAt: new Date('2020-01-01T00:00:00.000Z'), updatedAt: new Date('2020-01-01T00:00:00.000Z')
    }
  });
  const lockRouter = makeRouter({ db: lockDb, bucket: makeBucket(), manifest: lockManifest });
  const lockClaimHandlers = getRouteHandlers(lockRouter, '/dev/segmentation-study/:studyVersion/claim-next', 'post');
  const expiredLockRes = buildRes();
  await invokeHandlers(lockClaimHandlers, createReq({ params: { studyVersion: 'v2' }, body: lockIdentity }), expiredLockRes);
  assert.strictEqual(expiredLockRes._status, 200, 'An expired reservation lock must be replaceable by an ordinary claim.');
  assert.strictEqual(expiredLockRes._json.data.task.taskId, 'segmentation-study-v2-lock-valid');
  assert.strictEqual(lockDb.docs.get(lockDocKey).taskId, 'segmentation-study-v2-lock-valid');
  assert.strictEqual(lockDb.docs.get(lockDocKey).status, 'reserved');

  lockDb.docs.set('pronunciationSegmentationStudyTasks/segmentation-study-v2-lock-valid', {
    ...lockManifest[0], studyVersion: ACTIVE_STUDY_VERSION, manifestVersion: MANIFEST_VERSION, manifestSha256: lockManifest.manifestSha256,
    status: 'available', claim: null, claimExpiresAt: null
  });
  lockDb.docs.set(lockDocKey, {
    studyVersion: ACTIVE_STUDY_VERSION, studyId: 'segmentation-study-v2', taskId: 'segmentation-study-v2-other-lock',
    operatorName: lockIdentity.operatorName, sessionId: lockIdentity.sessionId, status: 'reserved',
    claimExpiresAt: new Date('2099-01-01T00:00:00.000Z'), updatedAt: new Date('2099-01-01T00:00:00.000Z')
  });
  const activeLockRes = buildRes();
  await invokeHandlers(lockClaimHandlers, createReq({ params: { studyVersion: 'v2' }, body: lockIdentity }), activeLockRes);
  assert.strictEqual(activeLockRes._status, 409, 'An active reservation lock for another task must block an ordinary claim.');
  assert.strictEqual(activeLockRes._json.error, 'NO_TASK_AVAILABLE');
  assert.strictEqual(lockDb.docs.get('pronunciationSegmentationStudyTasks/segmentation-study-v2-lock-valid').status, 'available', 'An active reservation conflict must not mutate the candidate task.');

  const unseededDb = createFakeDb();
  const unseededRouter = makeRouter({ db: unseededDb, bucket: makeBucket(), manifest });
  const unseededListHandlers = getRouteHandlers(unseededRouter, '/dev/segmentation-study/:studyVersion', 'get');
  const unseededListRes = buildRes();
  await invokeHandlers(unseededListHandlers, createReq({ params: { studyVersion: 'v2' } }), unseededListRes);
  assert.strictEqual(unseededListRes._status, 200);
  assert.strictEqual(Array.from(unseededDb.docs.keys()).filter((key) => key.startsWith('pronunciationSegmentationStudyTasks/')).length, 0, 'Read APIs must not seed or overwrite shared task state; deployment seeding is explicit.');

  const bundledRouter = makeRouter({ db: createFakeDb(), bucket: makeBucket(), useInjectedManifest: false });
  const bundledListHandlers = getRouteHandlers(bundledRouter, '/dev/segmentation-study/:studyVersion', 'get');
  const bundledListRes = buildRes();
  await invokeHandlers(bundledListHandlers, createReq({ params: { studyVersion: 'v2' } }), bundledListRes);
  assert.strictEqual(bundledListRes._status, 200);
  assert.strictEqual(bundledListRes._json.data.manifestVersion, MANIFEST_VERSION, 'Bundled fallback must preserve manifest version metadata.');
  assert.strictEqual(bundledListRes._json.data.manifestSha256, BUNDLED_MANIFEST_SHA256, 'Bundled fallback must preserve the frozen manifest hash.');

  const listHandlers = getRouteHandlers(router, '/dev/segmentation-study/:studyVersion', 'get');
  const listRes = buildRes();
  await invokeHandlers(listHandlers, createReq({ params: { studyVersion: 'v2' } }), listRes);
  assert.strictEqual(listRes._status, 200);
  assert.deepStrictEqual(listRes._json.data.manifest.map((entry) => entry.targetWord), ['ability', 'camera']);
  assert.strictEqual(listRes._json.data.tasks.length, 2);
  assert.strictEqual(listRes._json.data.previousSamples.length, 1, 'Previous samples must de-duplicate by WAV SHA-256.');
  assert.strictEqual(listRes._json.data.progress.available, 2);
  assert.strictEqual(listRes._json.data.studyVersion, ACTIVE_STUDY_VERSION);
  assert.strictEqual(listRes._json.data.manifestVersion, MANIFEST_VERSION);
  assert.strictEqual(listRes._json.data.manifestSha256, MANIFEST_SHA256);

  const legacyReadRes = buildRes();
  await invokeHandlers(listHandlers, createReq({ params: { studyVersion: 'v1' } }), legacyReadRes);
  assert.strictEqual(legacyReadRes._status, 200, 'The retired v1 study remains readable.');
  assert.strictEqual(legacyReadRes._json.data.studyVersion, 'study-v1');
  assert.deepStrictEqual(legacyReadRes._json.data.manifest.map((entry) => entry.targetWord), ['legacy']);

  const claimHandlers = getRouteHandlers(router, '/dev/segmentation-study/:studyVersion/claim-next', 'post');
  const retiredClaimRes = buildRes();
  await invokeHandlers(claimHandlers, createReq({
    params: { studyVersion: 'v1' },
    body: { operatorName: 'Reviewer One', sessionId: 'crm-test-session-001' }
  }), retiredClaimRes);
  assert.strictEqual(retiredClaimRes._status, 410);
  assert.strictEqual(retiredClaimRes._json.error, 'STUDY_RETIRED');

  const claimRes = buildRes();
  await invokeHandlers(claimHandlers, createReq({
    params: { studyVersion: 'v2' },
    body: { operatorName: 'Reviewer One', sessionId: 'crm-test-session-001' }
  }), claimRes);
  assert.strictEqual(claimRes._status, 200);
  assert.strictEqual(claimRes._json.data.task.taskId, 'segmentation-study-v2-0001');
  assert.strictEqual(claimRes._json.data.task.status, 'reserved');
  assert.strictEqual(claimRes._json.data.task.manifestSha256, MANIFEST_SHA256);
  assert.strictEqual(claimRes._json.data.task.automaticOrder.length, 64);
  assert.deepStrictEqual(claimRes._json.data.task.automaticVersionOrder.slice().sort(), ['v2', 'v3', 'v4']);
  assert.deepStrictEqual(claimRes._json.data.task.automaticVersionOrder, automaticVersionOrderFor(MANIFEST_SHA256, 'segmentation-study-v2-0001'));
  const ordinaryReservationEntries = Array.from(db.docs.entries()).filter(([key]) => key.startsWith('pronunciationSegmentationStudyReservations/'));
  assert.strictEqual(ordinaryReservationEntries.length, 1, 'Claim next must create the deterministic reservation lock.');
  assert.strictEqual(ordinaryReservationEntries[0][1].taskId, 'segmentation-study-v2-0001');
  assert.strictEqual(ordinaryReservationEntries[0][1].status, 'reserved');
  const heartbeatHandlers = getRouteHandlers(router, '/dev/segmentation-study/:studyVersion/tasks/:taskId/heartbeat', 'post');

  const mismatchedTaskId = 'segmentation-study-v1-mismatch';
  db.docs.set(`pronunciationSegmentationStudyTasks/${mismatchedTaskId}`, {
    taskId: mismatchedTaskId,
    studyVersion: 'study-v1',
    status: 'reserved',
    claim: { operatorName: 'Reviewer One', sessionId: 'crm-test-session-001' },
    claimExpiresAt: new Date('2099-01-01T00:00:00.000Z')
  });
  const mismatchedHeartbeatRes = buildRes();
  await invokeHandlers(heartbeatHandlers, createReq({
    params: { studyVersion: 'v2', taskId: mismatchedTaskId },
    body: { operatorName: 'Reviewer One', sessionId: 'crm-test-session-001' }
  }), mismatchedHeartbeatRes);
  assert.strictEqual(mismatchedHeartbeatRes._status, 400, 'Heartbeat must reject a task stored under another study version.');
  const mismatchedReleaseRes = buildRes();
  await invokeHandlers(getRouteHandlers(router, '/dev/segmentation-study/:studyVersion/tasks/:taskId/release', 'post'), createReq({
    params: { studyVersion: 'v2', taskId: mismatchedTaskId },
    body: { operatorName: 'Reviewer One', sessionId: 'crm-test-session-001' }
  }), mismatchedReleaseRes);
  assert.strictEqual(mismatchedReleaseRes._status, 400, 'Release must reject a task stored under another study version.');

  const heartbeatRes = buildRes();
  await invokeHandlers(heartbeatHandlers, createReq({
    params: { studyVersion: 'v2', taskId: 'segmentation-study-v2-0001' },
    body: { operatorName: 'Reviewer One', sessionId: 'crm-test-session-001' }
  }), heartbeatRes);
  assert.strictEqual(heartbeatRes._status, 200, JSON.stringify(heartbeatRes._json));

  const completeHandlers = getRouteHandlers(router, '/dev/segmentation-study/:studyVersion/tasks/:taskId/complete', 'post');
  const retiredHeartbeatRes = buildRes();
  await invokeHandlers(heartbeatHandlers, createReq({
    params: { studyVersion: 'v1', taskId: 'study-v1-001' },
    body: { operatorName: 'Reviewer One', sessionId: 'crm-test-session-001' }
  }), retiredHeartbeatRes);
  assert.strictEqual(retiredHeartbeatRes._status, 410);
  const retiredCompleteRes = buildRes();
  const retiredCompleteReq = createReq({ params: { studyVersion: 'v1', taskId: 'study-v1-001' }, body: { metadata: '{}' } });
  retiredCompleteReq.file = { buffer: makeWavBuffer() };
  await completeHandlers[completeHandlers.length - 1](retiredCompleteReq, retiredCompleteRes);
  assert.strictEqual(retiredCompleteRes._status, 410);

  const completeReq = createReq({
    params: { studyVersion: 'v2', taskId: 'segmentation-study-v2-0001' },
    body: {
      metadata: JSON.stringify(strictMetadata())
    }
  });
  completeReq.file = { buffer: makeWavBuffer() };
  const completeRes = buildRes();
  await completeHandlers[completeHandlers.length - 1](completeReq, completeRes);
  assert.strictEqual(completeRes._status, 200, completeRes._json?.message);
  assert.strictEqual(completeRes._json.data.task.status, 'completed');
  assert.strictEqual(completeRes._json.data.sample.certainty, 'certain');
  assert.strictEqual(completeRes._json.data.sample.analysisStatus, 'complete');
  assert.strictEqual(completeRes._json.data.sample.annotationProtocol, 'automatic-visible-assisted-v1');
  assert.deepStrictEqual(completeRes._json.data.sample.captureSettings, {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false
  });
  assert.strictEqual(completeRes._json.data.sample.captureSettings.deviceId, undefined);
  assert.deepStrictEqual(completeRes._json.data.sample.captureConstraintsRequested, { echoCancellation: false, noiseSuppression: false, autoGainControl: false });
  assert.strictEqual(completeRes._json.data.sample.captureEligibility, true);
  assert.strictEqual(completeRes._json.data.sample.playbackConfirmed, true);
  assert.strictEqual(completeRes._json.data.sample.wordStartTime, 0.1);
  assert.strictEqual(completeRes._json.data.sample.wordEndTime, 1.2);
  assert.deepStrictEqual(completeRes._json.data.sample.wordBounds, { startTime: 0.1, endTime: 1.2 });
  assert.strictEqual(completeRes._json.data.sample.manifestSha256, MANIFEST_SHA256);
  assert.strictEqual(completeRes._json.data.sample.referenceLabelProvenance, 'explicit-reviewed-en-US-v1');
  assert.strictEqual(completeRes._json.data.sample.speakerCohort, 'segmentation-study-v2');
  assert.strictEqual(completeRes._json.data.sample.automaticVersionOrder.length, 3);
  assert.deepStrictEqual(Object.keys(completeRes._json.data.sample.variantProvenance).sort(), ['v2', 'v3', 'v4']);
  assert.strictEqual(completeRes._json.data.sample.versions.v2.schemaVersion, 'pronunciation-comparison-v2');
  assert.strictEqual(completeRes._json.data.sample.versions.v3.schemaVersion, 'pronunciation-partition-variants-v2');
  assert.strictEqual(completeRes._json.data.sample.versions.v4.variant, 'v4');
  assert.strictEqual(completeRes._json.data.sample.variantProvenance.v3.schemaVersion, 'pronunciation-partition-variants-v2');
  assert.strictEqual(completeRes._json.data.sample.variantProvenance.v4.variant, 'v4');
  assert.strictEqual(completeRes._json.data.sample.versions.v4.source, 'partitionVariants.v4');
  assert.strictEqual(completeRes._json.data.sample.variantProvenance.v4.source, 'partitionVariants.v4');
  assert.strictEqual(completeRes._json.data.sample.versions.v2.analysisVersion, 'pronunciation-analysis-v2');
  assert.strictEqual(completeRes._json.data.sample.versions.v4.analysisVersion, 'pronunciation-analysis-v4');
  assert.ok(Array.isArray(completeRes._json.data.sample.exposureLog));
  assert.strictEqual(completeRes._json.data.sample.exposureLog[0].event, 'automatic-boundaries-exposed');
  assert.strictEqual(completeRes._json.data.sample.versionExposureLog.length, 3);
  const completedSampleId = completeRes._json.data.sampleId;
  assert.ok(db.docs.has(`pronunciationCorpusSamples/${completedSampleId}`));
  assert.ok(Array.from(db.docs.keys()).some((key) => key.startsWith(`pronunciationCorpusSamples/${completedSampleId}/manualReviews/`)), 'Initial study completion must persist an immutable manual review.');
  assert.strictEqual(db.docs.get(ordinaryReservationEntries[0][0]).status, 'released', 'Completion must clear the deterministic reservation lock.');
  assert.strictEqual(db.docs.get(ordinaryReservationEntries[0][0]).taskId, null);

  const idempotentRes = buildRes();
  await completeHandlers[completeHandlers.length - 1](completeReq, idempotentRes);
  assert.strictEqual(idempotentRes._status, 200);
  assert.strictEqual(idempotentRes._json.data.idempotent, true);

  const conflictingCompleteReq = createReq({
    params: { studyVersion: 'v2', taskId: 'segmentation-study-v2-0001' },
    body: {
      metadata: JSON.stringify({
        ...strictMetadata(),
        manualSegments: [
          { startTime: 0.1, endTime: 0.35 },
          { startTime: 0.35, endTime: 0.6 },
          { startTime: 0.6, endTime: 0.9 },
          { startTime: 0.9, endTime: 1.2 }
        ]
      })
    }
  });
  conflictingCompleteReq.file = { buffer: makeWavBuffer() };
  const conflictingCompleteRes = buildRes();
  await completeHandlers[completeHandlers.length - 1](conflictingCompleteReq, conflictingCompleteRes);
  assert.strictEqual(conflictingCompleteRes._status, 409, 'The same WAV with different labels must be rejected as a conflicting completion.');

  const uncertainClaimRes = buildRes();
  await invokeHandlers(claimHandlers, createReq({
    params: { studyVersion: 'v2' },
    body: { operatorName: 'Reviewer Two', sessionId: 'crm-test-session-002' }
  }), uncertainClaimRes);
  assert.strictEqual(uncertainClaimRes._json.data.task.taskId, 'segmentation-study-v2-0002');
  const uncertainTaskKey = 'pronunciationSegmentationStudyTasks/segmentation-study-v2-0002';
  const uncertainTask = db.docs.get(uncertainTaskKey);
  uncertainTask.versionExposureLog = [{ version: 'v4', automaticOrder: automaticOrderFor(MANIFEST_SHA256, 'segmentation-study-v2-0002'), viewedAt: '2026-08-18T23:59:59.000Z' }];
  db.docs.set(uncertainTaskKey, uncertainTask);
  const uncertainCompleteReq = createReq({
    params: { studyVersion: 'v2', taskId: 'segmentation-study-v2-0002' },
    body: {
      metadata: JSON.stringify({
        ...strictMetadata(),
        studyVersion: ACTIVE_STUDY_VERSION, taskId: 'segmentation-study-v2-0002', operatorName: 'Reviewer Two', sessionId: 'crm-test-session-002',
        targetWord: 'camera', referenceIpa: '/ˈkæmərə/', referenceSyllableIpa: ['kæ', 'mə', 'rə'],
        targetSyllableCount: 3, expectedObservedCount: 3,
        manualSegmentationConvention: 'ipa-phonological-contiguous-v1',
        manualSegments: [
          { startTime: 0.1, endTime: 0.5 },
          { startTime: 0.5, endTime: 1.0 },
          { startTime: 1.0, endTime: 1.5 }
        ],
        certainty: 'uncertain', automaticBoundariesVisible: true, analysisStatus: 'complete',
        versionExposureLog: automaticVersionOrderFor(MANIFEST_SHA256, 'segmentation-study-v2-0002').map((version, index) => ({ version, automaticOrder: automaticOrderFor(MANIFEST_SHA256, 'segmentation-study-v2-0002'), viewedAt: `2026-08-19T00:00:1${index}.000Z` })),
        comparison: {
          ...makeComparison(),
          v2: { status: 'complete', analysis: { analysisVersion: 'pronunciation-analysis-v2', observed_syllables: [{ startTime: 0.1, endTime: 0.5 }, { startTime: 0.5, endTime: 1.0 }, { startTime: 1.0, endTime: 1.5 }] } },
          v3: { status: 'complete', analysis: { analysisVersion: 'pronunciation-analysis-v3', observed_syllables: [{ startTime: 0.1, endTime: 0.5 }, { startTime: 0.5, endTime: 1.0 }, { startTime: 1.0, endTime: 1.5 }], partitionVariants: { schemaVersion: 'pronunciation-partition-variants-v2', v3: [{ startTime: 0.1, endTime: 0.5 }, { startTime: 0.5, endTime: 1.0 }, { startTime: 1.0, endTime: 1.5 }], v4: [{ startTime: 0.1, endTime: 0.5 }, { startTime: 0.5, endTime: 1.0 }, { startTime: 1.0, endTime: 1.5 }], v4AnalysisVersion: 'pronunciation-analysis-v4' } } },
          v4: { status: 'complete', analysis: {
            analysisVersion: 'pronunciation-analysis-v4', source: 'partitionVariants.v4', partitionSchemaVersion: 'pronunciation-partition-variants-v2',
            provenance: { source: 'partitionVariants.v4', variant: 'v4', schemaVersion: 'pronunciation-partition-variants-v2' }, observed_syllables: [{ startTime: 0.1, endTime: 0.5 }, { startTime: 0.5, endTime: 1.0 }, { startTime: 1.0, endTime: 1.5 }]
          } }
        }
      })
    }
  });
  const missingCaptureReq = createReq({
    params: { studyVersion: 'v2', taskId: 'segmentation-study-v2-0002' },
    body: { metadata: JSON.stringify({ ...JSON.parse(uncertainCompleteReq.body.metadata), captureSettings: undefined }) }
  });
  missingCaptureReq.file = { buffer: makeWavBuffer(2) };
  const missingCaptureRes = buildRes();
  await completeHandlers[completeHandlers.length - 1](missingCaptureReq, missingCaptureRes);
  assert.strictEqual(missingCaptureRes._status, 400, 'Missing capture settings must block completion.');

  const failedAnalysisReq = createReq({
    params: { studyVersion: 'v2', taskId: 'segmentation-study-v2-0002' },
    body: { metadata: JSON.stringify({ ...JSON.parse(uncertainCompleteReq.body.metadata), captureSettings: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, analysisStatus: 'analysis_failed', comparison: null }) }
  });
  failedAnalysisReq.file = { buffer: makeWavBuffer(3) };
  const failedAnalysisRes = buildRes();
  await completeHandlers[completeHandlers.length - 1](failedAnalysisReq, failedAnalysisRes);
  assert.strictEqual(failedAnalysisRes._status, 400, 'Analysis failure cannot complete a v2 study task.');

  const missingAnalysisStatusReq = createReq({
    params: { studyVersion: 'v2', taskId: 'segmentation-study-v2-0002' },
    body: { metadata: JSON.stringify({ ...JSON.parse(uncertainCompleteReq.body.metadata), captureSettings: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, analysisStatus: undefined }) }
  });
  missingAnalysisStatusReq.file = { buffer: makeWavBuffer(4) };
  const missingAnalysisStatusRes = buildRes();
  await completeHandlers[completeHandlers.length - 1](missingAnalysisStatusReq, missingAnalysisStatusRes);
  assert.strictEqual(missingAnalysisStatusRes._status, 400, 'Missing analysisStatus must block completion.');

  const missingWrapperStatusMetadata = JSON.parse(uncertainCompleteReq.body.metadata);
  missingWrapperStatusMetadata.captureSettings = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
  delete missingWrapperStatusMetadata.comparison.v4.status;
  const missingWrapperStatusReq = createReq({
    params: { studyVersion: 'v2', taskId: 'segmentation-study-v2-0002' },
    body: { metadata: JSON.stringify(missingWrapperStatusMetadata) }
  });
  missingWrapperStatusReq.file = { buffer: makeWavBuffer(41) };
  const missingWrapperStatusRes = buildRes();
  await completeHandlers[completeHandlers.length - 1](missingWrapperStatusReq, missingWrapperStatusRes);
  assert.strictEqual(missingWrapperStatusRes._status, 400, 'Missing V4 comparison status must block completion.');

  const substitutionMetadata = JSON.parse(uncertainCompleteReq.body.metadata);
  substitutionMetadata.captureSettings = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
  substitutionMetadata.comparison = {
    ...substitutionMetadata.comparison,
    v3: {
      ...substitutionMetadata.comparison.v3,
      analysis: {
        ...substitutionMetadata.comparison.v3.analysis,
        comparison: { edit_operations: [{ op: 'substitution' }] }
      }
    }
  };
  const substitutionReq = createReq({
    params: { studyVersion: 'v2', taskId: 'segmentation-study-v2-0002' },
    body: { metadata: JSON.stringify(substitutionMetadata) }
  });
  substitutionReq.file = { buffer: makeWavBuffer(5) };
  const substitutionRes = buildRes();
  await completeHandlers[completeHandlers.length - 1](substitutionReq, substitutionRes);
  assert.strictEqual(substitutionRes._status, 400, 'Substitution edit operations must block completion.');

  const trueCaptureReq = createReq({
    params: { studyVersion: 'v2', taskId: 'segmentation-study-v2-0002' },
    body: { metadata: JSON.stringify({ ...JSON.parse(uncertainCompleteReq.body.metadata), captureSettings: { echoCancellation: true, noiseSuppression: false, autoGainControl: false } }) }
  });
  trueCaptureReq.file = { buffer: makeWavBuffer(6) };
  const trueCaptureRes = buildRes();
  await completeHandlers[completeHandlers.length - 1](trueCaptureReq, trueCaptureRes);
  assert.strictEqual(trueCaptureRes._status, 400, 'Enabled processing settings must block completion.');

  const nonContiguousReq = createReq({
    params: { studyVersion: 'v2', taskId: 'segmentation-study-v2-0002' },
    body: { metadata: JSON.stringify({ ...JSON.parse(uncertainCompleteReq.body.metadata), captureSettings: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, comparison: { ...JSON.parse(uncertainCompleteReq.body.metadata).comparison, v2: { status: 'complete', analysis: { analysisVersion: 'pronunciation-analysis-v2', observed_syllables: [{ startTime: 0.1, endTime: 0.5 }, { startTime: 0.51, endTime: 1.0 }, { startTime: 1.0, endTime: 1.5 }] } } } }) }
  });
  nonContiguousReq.file = { buffer: makeWavBuffer(7) };
  const nonContiguousRes = buildRes();
  await completeHandlers[completeHandlers.length - 1](nonContiguousReq, nonContiguousRes);
  assert.strictEqual(nonContiguousRes._status, 400, 'Non-contiguous automatic spans must block completion.');

  const missingV4Req = createReq({
    params: { studyVersion: 'v2', taskId: 'segmentation-study-v2-0002' },
    body: { metadata: JSON.stringify({ ...JSON.parse(uncertainCompleteReq.body.metadata), captureSettings: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, comparison: { ...JSON.parse(uncertainCompleteReq.body.metadata).comparison, v4: undefined, v3: { ...JSON.parse(uncertainCompleteReq.body.metadata).comparison.v3, analysis: { ...JSON.parse(uncertainCompleteReq.body.metadata).comparison.v3.analysis, partitionVariants: { ...JSON.parse(uncertainCompleteReq.body.metadata).comparison.v3.analysis.partitionVariants, v4: undefined, v4AnalysisVersion: undefined } } } } }) }
  });
  missingV4Req.file = { buffer: makeWavBuffer(8) };
  const missingV4Res = buildRes();
  await completeHandlers[completeHandlers.length - 1](missingV4Req, missingV4Res);
  assert.strictEqual(missingV4Res._status, 400, 'Missing V4 provenance must block completion.');

  const noPlaybackReq = createReq({
    params: { studyVersion: 'v2', taskId: 'segmentation-study-v2-0002' },
    body: { metadata: JSON.stringify({ ...JSON.parse(uncertainCompleteReq.body.metadata), captureSettings: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, playbackConfirmed: false }) }
  });
  noPlaybackReq.file = { buffer: makeWavBuffer(9) };
  const noPlaybackRes = buildRes();
  await completeHandlers[completeHandlers.length - 1](noPlaybackReq, noPlaybackRes);
  assert.strictEqual(noPlaybackRes._status, 400, 'Reviewer playback confirmation must be explicit.');

  const uncertainAutomaticVersionOrder = automaticVersionOrderFor(MANIFEST_SHA256, 'segmentation-study-v2-0002');
  const exposureLogNegativeCases = [
    { label: 'one-entry', log: [{ version: uncertainAutomaticVersionOrder[0], automaticOrder: automaticOrderFor(MANIFEST_SHA256, 'segmentation-study-v2-0002'), viewedAt: '2026-08-19T00:00:10.000Z' }] },
    { label: 'duplicate-version', log: uncertainAutomaticVersionOrder.map((version, index) => ({ version: index === 1 ? uncertainAutomaticVersionOrder[0] : version, automaticOrder: automaticOrderFor(MANIFEST_SHA256, 'segmentation-study-v2-0002'), viewedAt: `2026-08-19T00:00:1${index}.000Z` })) },
    { label: 'wrong-order', log: [uncertainAutomaticVersionOrder[1], uncertainAutomaticVersionOrder[0], uncertainAutomaticVersionOrder[2]].map((version, index) => ({ version, automaticOrder: automaticOrderFor(MANIFEST_SHA256, 'segmentation-study-v2-0002'), viewedAt: `2026-08-19T00:00:2${index}.000Z` })) }
  ];
  for (const [index, testCase] of exposureLogNegativeCases.entries()) {
    const exposureMetadata = JSON.parse(uncertainCompleteReq.body.metadata);
    exposureMetadata.versionExposureLog = testCase.log;
    const exposureReq = createReq({
      params: { studyVersion: 'v2', taskId: 'segmentation-study-v2-0002' },
      body: { metadata: JSON.stringify(exposureMetadata) }
    });
    exposureReq.file = { buffer: makeWavBuffer(20 + index) };
    const exposureRes = buildRes();
    await completeHandlers[completeHandlers.length - 1](exposureReq, exposureRes);
    assert.strictEqual(exposureRes._status, 400, `${testCase.label} versionExposureLog must block completion.`);
  }
  uncertainCompleteReq.file = { buffer: makeWavBuffer() };
  const duplicateAudioRes = buildRes();
  await completeHandlers[completeHandlers.length - 1](uncertainCompleteReq, duplicateAudioRes);
  assert.strictEqual(duplicateAudioRes._status, 409, 'A WAV already assigned to another study task must be rejected by SHA-256.');
  uncertainCompleteReq.file = { buffer: makeWavBuffer(1) };
  const uncertainCompleteRes = buildRes();
  await completeHandlers[completeHandlers.length - 1](uncertainCompleteReq, uncertainCompleteRes);
  assert.strictEqual(uncertainCompleteRes._status, 200, uncertainCompleteRes._json?.message);
  assert.strictEqual(uncertainCompleteRes._json.data.sample.needsManualReview, true, 'Uncertain study labels must remain excluded from the primary benchmark.');
  assert.strictEqual(uncertainCompleteRes._json.data.sample.reviewReason, 'operator_uncertain');
  assert.strictEqual(uncertainCompleteRes._json.data.sample.versionExposureLog.length, 3, 'Completed samples must persist the exact canonical request exposure proof.');
  assert.deepStrictEqual(uncertainCompleteRes._json.data.sample.versionExposureLog.map((entry) => entry.version), uncertainAutomaticVersionOrder);
  assert.strictEqual(db.docs.get(uncertainTaskKey).versionExposureLog.length, 4, 'The completed task must retain its historical server exposure entries.');
  assert.strictEqual(db.docs.get(uncertainTaskKey).versionExposureComplete, undefined, 'A merged historical task log must not be marked as complete proof.');

  const exportHandlers = getRouteHandlers(router, '/dev/segmentation-study/:studyVersion/export', 'get');
  const exportRes = buildRes();
  await invokeHandlers(exportHandlers, createReq({ params: { studyVersion: 'v2' } }), exportRes);
  assert.strictEqual(exportRes._status, 200, exportRes._json?.message);
  assert.strictEqual(exportRes._json.data.schemaVersion, 'segmentation-study-export-v2');
  assert.strictEqual(exportRes._json.data.studyVersion, ACTIVE_STUDY_VERSION);
  assert.strictEqual(exportRes._json.data.manifestVersion, MANIFEST_VERSION);
  assert.strictEqual(exportRes._json.data.manifestSha256, MANIFEST_SHA256);
  assert.strictEqual(exportRes._json.data.samples.length, 2);
  assert.ok(exportRes._json.data.samples.every((item) => item.audioUrl.startsWith('https://storage.test/')));
  assert.ok(exportRes._json.data.samples.every((item) => item.task && item.sample && item.activeReview));
  assert.ok(exportRes._json.data.samples.every((item) => item.versions.v2 && item.versions.v3 && item.versions.v4));
  assert.ok(exportRes._json.data.samples.every((item) => item.taskId && item.sampleId && item.targetWord && item.variantProvenance.v4.schemaVersion));
  assert.ok(exportRes._json.data.samples.every((item) => typeof item.promotionEligible === 'boolean'));
  assert.ok(exportRes._json.data.samples.every((item) => item.captureEligibility === true));
  assert.ok(exportRes._json.data.samples.every((item) => item.assistedEvidence?.assisted === true));
  const certainExport = exportRes._json.data.samples.find((item) => item.sampleId === completedSampleId);
  assert.ok(certainExport, 'Certain completed sample must remain visible in export.');
  assert.strictEqual(certainExport.promotionEligible, true, 'A certain sample is promotion eligible only with complete exposure and capture proof.');
  const uncertainExport = exportRes._json.data.samples.find((item) => item.sample.certainty === 'uncertain');
  assert.ok(uncertainExport, 'Uncertain completed samples must remain visible in export.');
  assert.strictEqual(uncertainExport.promotionEligible, false, 'Uncertain completed samples must not be promotion eligible.');
  assert.strictEqual(uncertainExport.versionExposureComplete, true);
  assert.strictEqual(uncertainExport.assistedEvidence.assisted, true);
  assert.deepStrictEqual(uncertainExport.assistedEvidence.exposureLog.map((entry) => entry.version), uncertainAutomaticVersionOrder);

  const legacySample = { ...db.docs.get(`pronunciationCorpusSamples/${completedSampleId}`) };
  delete legacySample.versionExposureComplete;
  legacySample.captureEligibility = false;
  db.docs.set(`pronunciationCorpusSamples/${completedSampleId}`, legacySample);
  const legacyExportRes = buildRes();
  await invokeHandlers(exportHandlers, createReq({ params: { studyVersion: 'v2' } }), legacyExportRes);
  const legacyExport = legacyExportRes._json.data.samples.find((item) => item.sampleId === completedSampleId);
  assert.strictEqual(legacyExport.assistedEvidence.assisted, false, 'Legacy samples without exposure proof must not be marked assisted.');
  assert.strictEqual(legacyExport.promotionEligible, false, 'Legacy samples without exposure or capture proof must not be promotion eligible.');

  const directV4MismatchTaskId = 'segmentation-study-v2-0003';
  const directV4MismatchAutomaticOrder = automaticOrderFor(MANIFEST_SHA256, directV4MismatchTaskId);
  db.docs.set(`pronunciationSegmentationStudyTasks/${directV4MismatchTaskId}`, {
    taskId: directV4MismatchTaskId,
    studyVersion: ACTIVE_STUDY_VERSION,
    studyId: 'segmentation-study-v2',
    targetWord: 'camera',
    referenceIpa: '/ˈkæmərə/',
    referenceSyllableIpa: ['kæ', 'mə', 'rə'],
    targetSyllableCount: 3,
    expectedObservedCount: 3,
    speakerCohort: 'segmentation-study-v2',
    status: 'reserved',
    automaticOrder: directV4MismatchAutomaticOrder,
    automaticVersionOrder: automaticVersionOrderFor(MANIFEST_SHA256, directV4MismatchTaskId),
    exposureLog: [{ event: 'automatic-boundaries-exposed', automaticOrder: directV4MismatchAutomaticOrder }],
    claim: { operatorName: 'Reviewer Two', sessionId: 'crm-test-session-002' },
    claimExpiresAt: new Date('2099-01-01T00:00:00.000Z')
  });
  const directV4AuthorityMutations = [
    {
      label: 'span',
      mutate: (analysis) => {
        analysis.observed_syllables = [
          { startTime: 0.1, endTime: 0.49 },
          { startTime: 0.49, endTime: 1.0 },
          { startTime: 1.0, endTime: 1.5 }
        ];
      }
    },
    { label: 'analysisVersion', mutate: (analysis) => { analysis.analysisVersion = 'pronunciation-analysis-v3'; } },
    { label: 'source', mutate: (analysis) => { analysis.source = 'comparison.v4'; } },
    { label: 'schema', mutate: (analysis) => { analysis.partitionSchemaVersion = 'pronunciation-partition-variants-v1'; } },
    { label: 'variant', mutate: (analysis) => { analysis.provenance.variant = 'v3'; } }
  ];
  for (const [index, testCase] of directV4AuthorityMutations.entries()) {
    const directV4MismatchMetadata = JSON.parse(uncertainCompleteReq.body.metadata);
    directV4MismatchMetadata.taskId = directV4MismatchTaskId;
    directV4MismatchMetadata.versionExposureLog = automaticVersionOrderFor(MANIFEST_SHA256, directV4MismatchTaskId).map((version, exposureIndex) => ({ version, automaticOrder: directV4MismatchAutomaticOrder, viewedAt: `2026-08-19T00:01:0${exposureIndex}.000Z` }));
    testCase.mutate(directV4MismatchMetadata.comparison.v4.analysis);
    const directV4MismatchReq = createReq({
      params: { studyVersion: 'v2', taskId: directV4MismatchTaskId },
      body: { metadata: JSON.stringify(directV4MismatchMetadata) }
    });
    directV4MismatchReq.file = { buffer: makeWavBuffer(42 + index) };
    const directV4MismatchRes = buildRes();
    await completeHandlers[completeHandlers.length - 1](directV4MismatchReq, directV4MismatchRes);
    assert.strictEqual(directV4MismatchRes._status, 400, `A direct V4 ${testCase.label} mismatch must not override authoritative partitionVariants.v4.`);
    assert.strictEqual(directV4MismatchRes._json.error, 'ANALYSIS_V4_MISMATCH', `A direct V4 ${testCase.label} mismatch must report ANALYSIS_V4_MISMATCH.`);
  }

  const reviewHandlers = getRouteHandlers(router, '/dev/corpus-samples/:sampleId/manual-reviews', 'post');
  const reviewRes = buildRes();
  await invokeHandlers(reviewHandlers, createReq({
    params: { sampleId: 'previous-sample' },
    body: {
      manualSegmentationConvention: 'ipa-phonological-contiguous-v1',
      manualSegments: [
        { startTime: 0.1, endTime: 0.5 },
        { startTime: 0.5, endTime: 1.0 },
        { startTime: 1.0, endTime: 1.6 }
      ],
      certainty: 'uncertain',
      automaticBoundariesVisible: true,
      reviewerName: 'Reviewer One',
      reviewerSessionId: 'crm-test-session-001'
    }
  }), reviewRes);
  assert.strictEqual(reviewRes._status, 200, reviewRes._json?.message);
  assert.strictEqual(reviewRes._json.data.review.reviewStatus, 'uncertain');
  assert.strictEqual(db.docs.get('pronunciationCorpusSamples/previous-sample').needsManualReview, true);

  const reviewAgainRes = buildRes();
  await invokeHandlers(reviewHandlers, createReq({
    params: { sampleId: 'previous-sample' },
    body: {
      manualSegmentationConvention: 'ipa-phonological-contiguous-v1',
      manualSegments: [
        { startTime: 0.1, endTime: 0.5 },
        { startTime: 0.5, endTime: 1.0 },
        { startTime: 1.0, endTime: 1.6 }
      ],
      certainty: 'uncertain',
      automaticBoundariesVisible: true,
      reviewerName: 'Reviewer One',
      reviewerSessionId: 'crm-test-session-001'
    }
  }), reviewAgainRes);
  assert.strictEqual(reviewAgainRes._json.data.idempotent, true, 'Repeating the same review must be idempotent.');
  assert.strictEqual(db.docs.get('pronunciationCorpusSamples/previous-sample').manualReviewCount, 1);

  const gappedReviewRes = buildRes();
  await invokeHandlers(reviewHandlers, createReq({
    params: { sampleId: 'previous-sample' },
    body: {
      manualSegmentationConvention: 'ipa-phonological-contiguous-v1',
      manualSegments: [
        { startTime: 0.1, endTime: 0.5 },
        { startTime: 0.55, endTime: 1.0 },
        { startTime: 1.0, endTime: 1.6 }
      ],
      certainty: 'certain',
      automaticBoundariesVisible: true,
      reviewerName: 'Reviewer One',
      reviewerSessionId: 'crm-test-session-001'
    }
  }), gappedReviewRes);
  assert.strictEqual(gappedReviewRes._status, 400, 'Contiguous manual reviews must reject gaps between syllables.');

  const invalidReviewRes = buildRes();
  await invokeHandlers(reviewHandlers, createReq({
    params: { sampleId: 'previous-sample' },
    body: {
      manualSegmentationConvention: 'ipa-phonological-contiguous-v1',
      manualSegments: [{ startTime: 0.1, endTime: 0.5 }],
      certainty: 'certain',
      automaticBoundariesVisible: true,
      reviewerName: 'Reviewer One',
      reviewerSessionId: 'crm-test-session-001'
    }
  }), invalidReviewRes);
  assert.strictEqual(invalidReviewRes._status, 400);

  console.log('segmentation study and immutable corpus review routes passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
