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
    studyManifest: manifest,
    identity: {
      generateClassCode: async () => 'ABC123',
      lookupUserByEmail: async () => ({ uid: 'u1' }),
      forceLinkProfile: async () => ({ success: true })
    }
  });
}

const manifest = [
  {
    taskId: 'study-v1-001',
    order: 0,
    split: 'development',
    targetWord: 'ability',
    referenceIpa: '/əˈbɪləti/',
    referenceSyllableIpa: ['ə', 'bɪ', 'lə', 'ti'],
    targetSyllableCount: 4,
    transitionClasses: ['vowel-stop']
  },
  {
    taskId: 'study-v1-002',
    order: 1,
    split: 'holdout',
    targetWord: 'camera',
    referenceIpa: '/ˈkæmərə/',
    referenceSyllableIpa: ['kæ', 'mə', 'rə'],
    targetSyllableCount: 3,
    transitionClasses: ['stop-nasal']
  }
];

const db = createFakeDb({
  'pronunciationSegmentationStudyTasks/study-v1-001': {
    ...manifest[0], studyVersion: 'study-v1', status: 'available', claim: null, claimExpiresAt: null
  },
  'pronunciationSegmentationStudyTasks/study-v1-002': {
    ...manifest[1], studyVersion: 'study-v1', status: 'available', claim: null, claimExpiresAt: null
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

(async () => {
  const rootManifestPath = path.resolve(__dirname, '../../scripts/data/segmentation-study-v1.json');
  const deployedManifestPath = path.resolve(__dirname, '../../functions/src/data/segmentation-study-v1.json');
  assert.ok(fs.existsSync(deployedManifestPath), 'The fixed study manifest must be bundled inside the Cloud Functions deployment source.');
  const rootManifest = JSON.parse(fs.readFileSync(rootManifestPath, 'utf8'));
  const deployedManifest = JSON.parse(fs.readFileSync(deployedManifestPath, 'utf8'));
  assert.deepStrictEqual(deployedManifest, rootManifest, 'The deployed and audit manifests must be identical.');

  const unseededDb = createFakeDb();
  const unseededRouter = makeRouter({ db: unseededDb, bucket: makeBucket(), manifest });
  const unseededListHandlers = getRouteHandlers(unseededRouter, '/dev/segmentation-study/:studyVersion', 'get');
  const unseededListRes = buildRes();
  await invokeHandlers(unseededListHandlers, createReq({ params: { studyVersion: 'v1' } }), unseededListRes);
  assert.strictEqual(unseededListRes._status, 200);
  assert.strictEqual(Array.from(unseededDb.docs.keys()).filter((key) => key.startsWith('pronunciationSegmentationStudyTasks/')).length, 0, 'Read APIs must not seed or overwrite shared task state; deployment seeding is explicit.');

  const listHandlers = getRouteHandlers(router, '/dev/segmentation-study/:studyVersion', 'get');
  const listRes = buildRes();
  await invokeHandlers(listHandlers, createReq({ params: { studyVersion: 'study-v1' } }), listRes);
  assert.strictEqual(listRes._status, 200);
  assert.deepStrictEqual(listRes._json.data.manifest.map((entry) => entry.targetWord), ['ability', 'camera']);
  assert.strictEqual(listRes._json.data.tasks.length, 2);
  assert.strictEqual(listRes._json.data.previousSamples.length, 1, 'Previous samples must de-duplicate by WAV SHA-256.');
  assert.strictEqual(listRes._json.data.progress.available, 2);

  const publicVersionRes = buildRes();
  await invokeHandlers(listHandlers, createReq({ params: { studyVersion: 'v1' } }), publicVersionRes);
  assert.strictEqual(publicVersionRes._status, 200, 'The approved /segmentation-study/v1 API alias must resolve study-v1.');
  assert.strictEqual(publicVersionRes._json.data.studyVersion, 'study-v1');

  const claimHandlers = getRouteHandlers(router, '/dev/segmentation-study/:studyVersion/claim-next', 'post');
  const claimRes = buildRes();
  await invokeHandlers(claimHandlers, createReq({
    params: { studyVersion: 'study-v1' },
    body: { operatorName: 'Reviewer One', sessionId: 'crm-test-session-001' }
  }), claimRes);
  assert.strictEqual(claimRes._status, 200);
  assert.strictEqual(claimRes._json.data.task.taskId, 'study-v1-001');
  assert.strictEqual(claimRes._json.data.task.status, 'reserved');

  const heartbeatHandlers = getRouteHandlers(router, '/dev/segmentation-study/:studyVersion/tasks/:taskId/heartbeat', 'post');
  const heartbeatRes = buildRes();
  await invokeHandlers(heartbeatHandlers, createReq({
    params: { studyVersion: 'study-v1', taskId: 'study-v1-001' },
    body: { operatorName: 'Reviewer One', sessionId: 'crm-test-session-001' }
  }), heartbeatRes);
  assert.strictEqual(heartbeatRes._status, 200, JSON.stringify(heartbeatRes._json));

  const completeHandlers = getRouteHandlers(router, '/dev/segmentation-study/:studyVersion/tasks/:taskId/complete', 'post');
  const completeReq = createReq({
    params: { studyVersion: 'study-v1', taskId: 'study-v1-001' },
    body: {
      metadata: JSON.stringify({
        studyVersion: 'study-v1',
        taskId: 'study-v1-001',
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
        certainty: 'certain',
        automaticBoundariesVisible: true,
        analysisStatus: 'analysis_failed'
      })
    }
  });
  completeReq.file = { buffer: makeWavBuffer() };
  const completeRes = buildRes();
  await completeHandlers[completeHandlers.length - 1](completeReq, completeRes);
  assert.strictEqual(completeRes._status, 200, completeRes._json?.message);
  assert.strictEqual(completeRes._json.data.task.status, 'completed');
  assert.strictEqual(completeRes._json.data.sample.certainty, 'certain');
  assert.strictEqual(completeRes._json.data.sample.analysisStatus, 'analysis_failed');
  const completedSampleId = completeRes._json.data.sampleId;
  assert.ok(db.docs.has(`pronunciationCorpusSamples/${completedSampleId}`));
  assert.ok(Array.from(db.docs.keys()).some((key) => key.startsWith(`pronunciationCorpusSamples/${completedSampleId}/manualReviews/`)), 'Initial study completion must persist an immutable manual review.');

  const idempotentRes = buildRes();
  await completeHandlers[completeHandlers.length - 1](completeReq, idempotentRes);
  assert.strictEqual(idempotentRes._status, 200);
  assert.strictEqual(idempotentRes._json.data.idempotent, true);

  const conflictingCompleteReq = createReq({
    params: { studyVersion: 'v1', taskId: 'study-v1-001' },
    body: {
      metadata: JSON.stringify({
        ...JSON.parse(completeReq.body.metadata),
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
    params: { studyVersion: 'v1' },
    body: { operatorName: 'Reviewer Two', sessionId: 'crm-test-session-002' }
  }), uncertainClaimRes);
  assert.strictEqual(uncertainClaimRes._json.data.task.taskId, 'study-v1-002');
  const uncertainCompleteReq = createReq({
    params: { studyVersion: 'v1', taskId: 'study-v1-002' },
    body: {
      metadata: JSON.stringify({
        studyVersion: 'study-v1', taskId: 'study-v1-002', operatorName: 'Reviewer Two', sessionId: 'crm-test-session-002',
        targetWord: 'camera', referenceIpa: '/camera/', referenceSyllableIpa: ['kæ', 'mə', 'rə'],
        targetSyllableCount: 3, expectedObservedCount: 3,
        manualSegmentationConvention: 'ipa-phonological-contiguous-v1',
        manualSegments: [
          { startTime: 0.1, endTime: 0.5 },
          { startTime: 0.5, endTime: 1.0 },
          { startTime: 1.0, endTime: 1.5 }
        ],
        certainty: 'uncertain', automaticBoundariesVisible: true, analysisStatus: 'complete'
      })
    }
  });
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
