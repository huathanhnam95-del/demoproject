/* eslint-disable no-console */
const assert = require('assert');
const express = require('express');
const http = require('http');

const createCrmRouter = require('../../functions/src/routes/admin/create-crm-router');

function collectRoutes(router, prefix = '') {
  const routes = [];
  for (const layer of router?.stack || []) {
    if (layer.route) {
      const methods = Object.keys(layer.route.methods || {})
        .filter((method) => layer.route.methods[method])
        .map((method) => method.toUpperCase());
      for (const routePath of (Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path])) {
        for (const method of methods) routes.push(`${method} ${prefix}${routePath}`);
      }
    } else if (layer.handle?.stack) {
      routes.push(...collectRoutes(layer.handle, prefix));
    }
  }
  return routes;
}

function buildRes() {
  return {
    _status: 200,
    _json: null,
    status(code) { this._status = code; return this; },
    json(payload) { this._json = payload; return this; }
  };
}

function getRouteHandlers(router, path, method) {
  const layer = (router.stack || []).find((entry) => entry.route?.path === path);
  assert(layer, `Route ${path} not found.`);
  return layer.route.stack.filter((entry) => entry.method === method).map((entry) => entry.handle);
}

function makeWavBuffer() {
  const dataSize = 32000;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(16000, 24);
  buffer.writeUInt32LE(32000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

function captureRawBodyForMultipart(req, _res, next) {
  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  if (!contentType.startsWith('multipart/form-data')) {
    next();
    return;
  }

  const chunks = [];
  req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
  req.on('end', () => {
    req.rawBody = Buffer.concat(chunks);
    next();
  });
  req.on('error', next);
}

async function startServer(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
    });
  });
}

async function stopServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

const router = createCrmRouter({
  db: {},
  admin: {},
  authMiddleware: (req, _res, next) => next(),
  adminMiddleware: (req, _res, next) => next(),
  sendSuccess: () => null,
  sendError: () => null,
  getStorageBucket: async () => null,
  identity: {
    generateClassCode: async () => 'ABC123',
    lookupUserByEmail: async () => ({ uid: 'u1' }),
    forceLinkProfile: async () => ({ success: true })
  }
});

const routes = collectRoutes(router);
for (const signature of [
  'POST /dev/save-corpus-sample',
  'GET /dev/corpus-samples',
  'GET /dev/corpus-samples/:sampleId',
  'GET /dev/corpus-samples/:sampleId/audio',
  'DELETE /dev/corpus-samples/:sampleId'
]) {
  assert(routes.includes(signature), `Expected production corpus route ${signature}.`);
}

const { validateCorpusMetadata, validateWavBuffer } = require('../../functions/src/routes/admin/pronunciation-corpus');

assert.throws(
  () => validateCorpusMetadata({ sampleId: '../escape' }),
  /sampleId/
);
assert.throws(
  () => validateCorpusMetadata({
    sampleId: 'busy-clean-1',
    targetWord: 'busy',
    referenceIpa: '',
    expectedObservedCount: 2,
    targetSyllableCount: 2,
    category: 'clean',
    speakerCohort: 'l1-vn-01'
  }),
  /referenceIpa/
);
const manualMetadata = validateCorpusMetadata({
  sampleId: 'photograph-manual-review-1',
  targetWord: 'photograph',
  referenceIpa: '/ˈfoʊ.tə.ɡræf/',
  expectedObservedCount: 2,
  targetSyllableCount: 2,
  category: 'clean',
  speakerCohort: 'pronounce-manual-review',
  needsManualReview: true,
  reviewReason: 'manual_syllable_segmentation',
  segmentationConvention: 'ipa-phonological-contiguous-v1',
  referenceSyllableIpa: ['foʊ', 'tə'],
  automaticSegmentationConvention: 'ctc-interspan-midpoint-contiguous-v1',
  analysisRevision: 'pronunciation-analysis-v3',
  sourceComparisonId: '0123456789abcdef0123456789abcdef',
  manualSegments: [
    { startTime: 0.1, endTime: 0.2 },
    { startTime: 0.2, endTime: 0.35 }
  ],
  automaticSegments: [{ startTime: 0.08, endTime: 0.21 }]
});
assert.deepStrictEqual(manualMetadata.manualSegments[0], {
  index: 0,
  startTime: 0.1,
  endTime: 0.2,
  duration: 0.1
});
assert.deepStrictEqual(manualMetadata.verifiedSpans, [
  { start: 0.1, end: 0.2 },
  { start: 0.2, end: 0.35 }
]);
assert.strictEqual(manualMetadata.needsManualReview, false);
assert.strictEqual(manualMetadata.reviewReason, null);
assert.strictEqual(manualMetadata.reviewStatus, 'complete');
assert.strictEqual(manualMetadata.segmentationConvention, 'ipa-phonological-contiguous-v1');
assert.deepStrictEqual(manualMetadata.referenceSyllableIpa, ['foʊ', 'tə']);
assert.strictEqual(manualMetadata.automaticSegmentationConvention, 'ctc-interspan-midpoint-contiguous-v1');
assert.strictEqual(manualMetadata.analysisRevision, 'pronunciation-analysis-v3');
assert.strictEqual(manualMetadata.sourceComparisonId, '0123456789abcdef0123456789abcdef');
assert.throws(
  () => validateCorpusMetadata({
    sampleId: 'photograph-manual-review-incomplete',
    targetWord: 'photograph',
    referenceIpa: '/ˈfoʊ.tə.ɡræf/',
    expectedObservedCount: 3,
    targetSyllableCount: 3,
    category: 'clean',
    speakerCohort: 'pronounce-manual-review',
    segmentationConvention: 'ipa-phonological-contiguous-v1',
    referenceSyllableIpa: ['foʊ', 'tə', 'ɡræf'],
    manualSegments: [{ startTime: 0.1, endTime: 0.3 }, { startTime: 0.3, endTime: 0.5 }]
  }),
  /expectedObservedCount/
);
assert.throws(
  () => validateCorpusMetadata({
    sampleId: 'photograph-manual-review-gap',
    targetWord: 'photograph',
    referenceIpa: '/ˈfoʊ.tə.ɡræf/',
    expectedObservedCount: 2,
    targetSyllableCount: 2,
    category: 'clean',
    speakerCohort: 'pronounce-manual-review',
    segmentationConvention: 'ipa-phonological-contiguous-v1',
    referenceSyllableIpa: ['foʊ', 'tə'],
    manualSegments: [{ startTime: 0.1, endTime: 0.3 }, { startTime: 0.31, endTime: 0.5 }]
  }),
  /contiguous/
);
assert.throws(
  () => validateCorpusMetadata({
    sampleId: 'photograph-manual-review-overlap',
    targetWord: 'photograph',
    referenceIpa: '/ˈfoʊ.tə.ɡræf/',
    expectedObservedCount: 2,
    targetSyllableCount: 4,
    category: 'omission',
    speakerCohort: 'pronounce-manual-review',
    manualSegments: [{ startTime: 0.3, endTime: 0.5 }, { startTime: 0.45, endTime: 0.6 }]
  }),
  /ordered and non-overlapping/
);

console.log('production pronunciation corpus route contract passed');

(async () => {
  const records = new Map();
  const savedFiles = new Map();
  const db = {
    collection(name) {
      assert.strictEqual(name, 'pronunciationCorpusSamples');
      return {
        doc(id) {
          return {
            async set(data) { records.set(id, data); },
            async get() {
              const data = records.get(id);
              return { exists: !!data, id, data: () => data };
            }
          };
        },
        orderBy() {
          return {
            limit() {
              return {
                async get() {
                  return { docs: Array.from(records, ([id, data]) => ({ id, data: () => data })) };
                }
              };
            }
          };
        }
      };
    }
  };
  const bucket = {
    name: 'test-bucket',
    file(storagePath) {
      return {
        async save(buffer) { savedFiles.set(storagePath, buffer); },
        async download() { return [savedFiles.get(storagePath) || makeWavBuffer()]; },
        async getSignedUrl() { return [`https://storage.test/${encodeURIComponent(storagePath)}`]; }
      };
    }
  };
  const productionRouter = createCrmRouter({
    db,
    admin: {},
    authMiddleware: (req, _res, next) => { req.user = { uid: 'admin-1', email: 'admin@example.com' }; next(); },
    adminMiddleware: (_req, _res, next) => next(),
    sendSuccess: (res, data) => res.status(200).json({ success: true, data }),
    sendError: (res, status, error, message) => res.status(status).json({ success: false, error, message }),
    getStorageBucket: async () => bucket,
    serverTimestamp: () => new Date('2026-07-15T00:00:00Z'),
    identity: {
      generateClassCode: async () => 'ABC123',
      lookupUserByEmail: async () => ({ uid: 'u1' }),
      forceLinkProfile: async () => ({ success: true })
    }
  });
  const saveHandlers = getRouteHandlers(productionRouter, '/dev/save-corpus-sample', 'post');
  const saveRes = buildRes();
  await saveHandlers[saveHandlers.length - 1]({
    user: { uid: 'admin-1', email: 'admin@example.com' },
    body: { metadata: JSON.stringify({
      sampleId: 'busy-clean-l1-vn-01',
      targetWord: 'busy',
      referenceIpa: 'ˈbɪz.i',
      expectedObservedCount: 2,
      targetSyllableCount: 2,
      category: 'clean',
      speakerCohort: 'l1-vn-01',
      needsManualReview: true,
      reviewReason: 'manual_syllable_segmentation',
      segmentationConvention: 'ipa-phonological-contiguous-v1',
      referenceSyllableIpa: ['bɪ', 'zi'],
      automaticSegmentationConvention: 'ctc-interspan-midpoint-contiguous-v1',
      analysisRevision: 'pronunciation-analysis-v3',
      sourceComparisonId: 'fedcba9876543210fedcba9876543210',
      manualSegments: [
        { startTime: 0.1, endTime: 0.4 },
        { startTime: 0.4, endTime: 0.8 }
      ],
      automaticSegments: [{ startTime: 0.08, endTime: 0.42 }]
    }) },
    file: { buffer: makeWavBuffer() }
  }, saveRes);
  assert.strictEqual(saveRes._status, 200);
  assert.strictEqual(records.get('busy-clean-l1-vn-01').storagePath, 'pronunciation-segmentation-corpus/busy-clean-l1-vn-01.wav');
  assert.equal(records.get('busy-clean-l1-vn-01').manualSegments.length, 2);
  assert.equal(records.get('busy-clean-l1-vn-01').automaticSegments.length, 1);
  assert.equal(records.get('busy-clean-l1-vn-01').needsManualReview, false);
  assert.equal(records.get('busy-clean-l1-vn-01').segmentationConvention, 'ipa-phonological-contiguous-v1');
  assert.deepStrictEqual(records.get('busy-clean-l1-vn-01').referenceSyllableIpa, ['bɪ', 'zi']);
  assert.equal(records.get('busy-clean-l1-vn-01').automaticSegmentationConvention, 'ctc-interspan-midpoint-contiguous-v1');
  assert.equal(records.get('busy-clean-l1-vn-01').analysisRevision, 'pronunciation-analysis-v3');
  assert.equal(records.get('busy-clean-l1-vn-01').sourceComparisonId, 'fedcba9876543210fedcba9876543210');
  assert.strictEqual(savedFiles.size, 1);
  console.log('production pronunciation corpus upload behavior passed');

  const app = express();
  app.use('/api/admin', captureRawBodyForMultipart, productionRouter);
  const { server, baseUrl } = await startServer(app);
  try {
    const metadata = {
      sampleId: 'busy-clean-firebase-raw-body',
      targetWord: 'busy',
      referenceIpa: 'ˈbɪz.i',
      expectedObservedCount: 2,
      targetSyllableCount: 2,
      category: 'clean',
      speakerCohort: 'l1-vn-01'
    };
    const formData = new FormData();
    formData.append('metadata', JSON.stringify(metadata));
    formData.append('audio', new Blob([makeWavBuffer()], { type: 'audio/wav' }), 'recording.wav');

    const response = await fetch(`${baseUrl}/api/admin/dev/save-corpus-sample`, {
      method: 'POST',
      body: formData
    });
    const payload = await response.json();
    assert.strictEqual(
      response.status,
      200,
      `Firebase rawBody multipart upload should succeed, received ${response.status}: ${payload.message || ''}`
    );
    assert.strictEqual(records.get(metadata.sampleId).storagePath, `pronunciation-segmentation-corpus/${metadata.sampleId}.wav`);
    console.log('production pronunciation corpus Firebase rawBody upload passed');

    const invalidAudioResponse = await fetch(`${baseUrl}/api/admin/dev/corpus-samples/invalid_id/audio`);
    assert.strictEqual(invalidAudioResponse.status, 400);

    const missingAudioResponse = await fetch(`${baseUrl}/api/admin/dev/corpus-samples/missing-sample/audio`);
    assert.strictEqual(missingAudioResponse.status, 404);

    const audioResponse = await fetch(`${baseUrl}/api/admin/dev/corpus-samples/${metadata.sampleId}/audio`);
    assert.strictEqual(audioResponse.status, 200);
    assert.match(audioResponse.headers.get('content-type') || '', /audio\/wav/i);
    assert.strictEqual(audioResponse.headers.get('cache-control'), 'no-store');
    const audioBytes = Buffer.from(await audioResponse.arrayBuffer());
    assert.strictEqual(audioBytes.toString('ascii', 0, 4), 'RIFF');
    assert.strictEqual(audioBytes.toString('ascii', 8, 12), 'WAVE');
    console.log('production pronunciation corpus audio proxy passed');
  } finally {
    await stopServer(server);
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
