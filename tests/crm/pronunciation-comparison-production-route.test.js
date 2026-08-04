const assert = require('assert');
const express = require('express');
const http = require('http');
const createCrmRouter = require('../../functions/src/routes/admin/create-crm-router');
const {
  COLLECTION,
  validateComparisonMetadata,
  validateWavBuffer
} = require('../../functions/src/routes/admin/pronunciation-comparisons');

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

function collectRoutes(router, prefix = '') {
  return (router.stack || []).flatMap((layer) => {
    if (layer.route) {
      const methods = Object.keys(layer.route.methods || {}).filter((method) => layer.route.methods[method]);
      return methods.map((method) => `${method.toUpperCase()} ${prefix}${layer.route.path}`);
    }
    return layer.handle?.stack ? collectRoutes(layer.handle, prefix) : [];
  });
}

function getRouteHandlers(router, path, method) {
  const layer = (router.stack || []).find((entry) => entry.route?.path === path);
  assert(layer, `Route ${path} not found.`);
  return layer.route.stack.filter((entry) => entry.method === method).map((entry) => entry.handle);
}

function buildRes() {
  return {
    _status: 200,
    _json: null,
    status(code) { this._status = code; return this; },
    json(payload) { this._json = payload; return this; }
  };
}

const baseMetadata = {
  schemaVersion: 'pronunciation-comparison-save-v1',
  comparisonId: '0123456789abcdef0123456789abcdef',
  status: 'complete',
  context: {
    targetWord: 'actual',
    referenceIpa: '/\u02c8\u00e6k.t\u0283u.\u0259l/',
    expectedSyllables: 3,
    variantId: 'cmudict:actual',
    requestReferenceId: 'cmudict:actual'
  },
  revisions: {
    comparisonSchema: 'pronunciation-comparison-v1',
    v2: 'pronunciation-analysis-v2',
    v3: 'pronunciation-analysis-v3',
    v3Model: 'model-rev-1'
  },
  judgment: 'v3',
  manualSegments: [{ startTime: 0.1, endTime: 0.3 }],
  analyses: {
    v2: { status: 'available', reason: null, analysis: { analysisVersion: 'pronunciation-analysis-v2', observed: { syllableCount: 2 } } },
    v3: { status: 'available', reason: null, analysis: { analysisVersion: 'pronunciation-analysis-v3', syllable_count: 3 } }
  }
};

assert.strictEqual(COLLECTION, 'pronunciation_analysis_comparisons');
assert.doesNotThrow(() => validateWavBuffer(makeWavBuffer()));
assert.deepStrictEqual(
  validateComparisonMetadata(baseMetadata, { duration: 2 }),
  { ...baseMetadata, manualSegments: [{ index: 0, startTime: 0.1, endTime: 0.3, duration: 0.2 }] }
);
assert.throws(
  () => validateComparisonMetadata({ ...baseMetadata, comparisonId: '../escape' }, { duration: 2 }),
  /comparisonId/
);
assert.throws(
  () => validateComparisonMetadata({ ...baseMetadata, judgment: 'winner' }, { duration: 2 }),
  /judgment/
);
assert.throws(
  () => validateComparisonMetadata({ ...baseMetadata, status: 'partial_failure', judgment: 'v3' }, { duration: 2 }),
  /judgment/
);
assert.throws(
  () => validateComparisonMetadata({ ...baseMetadata, manualSegments: [{ startTime: 1.8, endTime: 2.2 }] }, { duration: 2 }),
  /audio duration/
);
assert.throws(
  () => validateComparisonMetadata({ ...baseMetadata, analyses: { ...baseMetadata.analyses, v2: { status: 'available', analysis: 'x'.repeat(256 * 1024 + 1) } } }, { duration: 2 }),
  /analysis JSON/
);

const router = createCrmRouter({
  db: {},
  admin: {},
  authMiddleware: (req, _res, next) => { req.user = { uid: 'u1', email: 'admin@example.com' }; next(); },
  adminMiddleware: (_req, _res, next) => next(),
  sendSuccess: () => null,
  sendError: () => null,
  getStorageBucket: async () => null,
  identity: {
    generateClassCode: async () => 'ABC123',
    lookupUserByEmail: async () => ({ uid: 'u1' }),
    forceLinkProfile: async () => ({ success: true })
  }
});
assert(collectRoutes(router).includes('POST /dev/save-analysis-comparison'));
const saveHandlers = getRouteHandlers(router, '/dev/save-analysis-comparison', 'post');
assert(saveHandlers.length >= 2, 'comparison route must include auth/admin middleware');

(async () => {
  const records = new Map();
  const files = new Map();
  const db = {
    collection(name) {
      assert.strictEqual(name, COLLECTION);
      return { doc(id) { return { async set(data) { records.set(id, data); } }; } };
    }
  };
  const bucket = {
    file(storagePath) {
      return {
        async save(buffer) { files.set(storagePath, buffer); },
        async delete() { files.delete(storagePath); },
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
    serverTimestamp: () => new Date('2026-08-01T00:00:00Z'),
    identity: {
      generateClassCode: async () => 'ABC123',
      lookupUserByEmail: async () => ({ uid: 'u1' }),
      forceLinkProfile: async () => ({ success: true })
    }
  });
  const handlers = getRouteHandlers(productionRouter, '/dev/save-analysis-comparison', 'post');
  const response = buildRes();
  await handlers[handlers.length - 1]({
    user: { uid: 'admin-1', email: 'admin@example.com' },
    body: { metadata: JSON.stringify(baseMetadata) },
    file: { buffer: makeWavBuffer() }
  }, response);
  assert.strictEqual(response._status, 200);
  assert.strictEqual(records.get(baseMetadata.comparisonId).storagePath, `pronunciation-analysis-comparisons/${baseMetadata.comparisonId}.wav`);
  assert.strictEqual(records.get(baseMetadata.comparisonId).createdByUid, 'admin-1');
  assert.strictEqual(records.get(baseMetadata.comparisonId).uid, undefined);
  assert.strictEqual(records.get(baseMetadata.comparisonId).email, undefined);
  assert.match(records.get(baseMetadata.comparisonId).sourceHash, /^[0-9a-f]{64}$/);
  assert.strictEqual(files.size, 1);
  console.log('production pronunciation comparison route behavior passed');

  const app = express();
  app.use('/api/admin', (req, _res, next) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => { req.rawBody = Buffer.concat(chunks); next(); });
  }, productionRouter);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    const formData = new FormData();
    formData.append('metadata', JSON.stringify({ ...baseMetadata, comparisonId: 'fedcba9876543210fedcba9876543210' }));
    formData.append('audio', new Blob([makeWavBuffer()], { type: 'audio/wav' }), 'recording.wav');
    const upload = await fetch(`http://127.0.0.1:${port}/api/admin/dev/save-analysis-comparison`, { method: 'POST', body: formData });
    assert.strictEqual(upload.status, 200);
    console.log('production pronunciation comparison Firebase rawBody upload passed');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
