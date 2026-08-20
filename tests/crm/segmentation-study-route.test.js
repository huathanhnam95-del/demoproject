/* eslint-disable no-console */
const assert = require('assert');
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

function makeRouter({ db, bucket, manifest }) {
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
    studyManifests: {
      v1: legacyManifest,
      v2: manifest
    },
    identity: {
      generateClassCode: async () => 'ABC123',
      lookupUserByEmail: async () => ({ uid: 'u1' }),
      forceLinkProfile: async () => ({ success: true })
    }
  });
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
  const unseededDb = createFakeDb();
  const unseededRouter = makeRouter({ db: unseededDb, bucket: makeBucket(), manifest });
  const unseededListHandlers = getRouteHandlers(unseededRouter, '/dev/segmentation-study/:studyVersion', 'get');
  const unseededListRes = buildRes();
  await invokeHandlers(unseededListHandlers, createReq({ params: { studyVersion: 'v2' } }), unseededListRes);
  assert.strictEqual(unseededListRes._status, 200);
  assert.strictEqual(Array.from(unseededDb.docs.keys()).filter((key) => key.startsWith('pronunciationSegmentationStudyTasks/')).length, 0, 'Read APIs must not seed or overwrite shared task state; deployment seeding is explicit.');

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
