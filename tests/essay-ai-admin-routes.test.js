const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const http = require('node:http');

const createEssayAiAdminRouter = require('../functions/src/essay-ai/admin-routes');
const { sendError, sendSuccess } = require('../functions/src/crm/http-contracts');

function snapshot(id, data) {
  return {
    id,
    exists: data !== undefined,
    data: () => data
  };
}

function createFakeDb(seed = {}) {
  const rows = new Map(Object.entries(seed));
  const transactionSets = [];
  const collection = (name) => ({
    doc(id) {
      const key = `${name}/${id}`;
      return {
        id,
        key,
        async get() { return snapshot(id, rows.get(key)); },
        async set(data, options = {}) {
          rows.set(key, options.merge ? { ...(rows.get(key) || {}), ...data } : data);
        }
      };
    }
  });
  return {
    rows,
    transactionSets,
    collection,
    async runTransaction(callback) {
      return callback({
        get: (ref) => ref.get(),
        set: (ref, data, options) => {
          transactionSets.push(ref.key);
          return ref.set(data, options);
        }
      });
    }
  };
}

async function requestRouter(router, path, body) {
  const app = express();
  app.use(express.json());
  app.use(router);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    return await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function createRouter(db) {
  const authMiddleware = (req, _res, next) => {
    req.user = { uid: 'admin-1', email: 'admin@example.com' };
    next();
  };
  return createEssayAiAdminRouter({
    db,
    authMiddleware,
    adminMiddleware: (_req, _res, next) => next(),
    sendSuccess,
    sendError
  });
}

test('router factory returns an isolated router for each app instance', () => {
  const first = createRouter(createFakeDb());
  const second = createRouter(createFakeDb());
  assert.notEqual(first, second);
});

test('enqueue job copies candidate count and cutoff from completed preview', async () => {
  const cutoff = new Date();
  const db = createFakeDb({
    'essay_ai_backfill_jobs/preview-1': {
      mode: 'preview',
      status: 'completed',
      includeFailed: true,
      candidateCount: 7,
      scanCutoffAt: cutoff
    }
  });
  const response = await requestRouter(createRouter(db), '/trigger', {
    requestId: '123e4567-e89b-42d3-a456-426614174000',
    previewJobId: 'preview-1'
  });
  assert.equal(response.status, 202);
  const payload = await response.json();
  const job = db.rows.get(`essay_ai_backfill_jobs/${payload.jobId}`);
  assert.equal(job.candidateCount, 7);
  assert.equal(job.scanCutoffAt, cutoff);
  assert.equal(job.pageSize, 200);
});

test('enqueue rejects a preview with an invalid cutoff', async () => {
  const db = createFakeDb({
    'essay_ai_backfill_jobs/preview-1': {
      mode: 'preview',
      status: 'completed',
      includeFailed: false,
      candidateCount: 1,
      scanCutoffAt: 'not-a-date'
    }
  });
  const response = await requestRouter(createRouter(db), '/trigger', {
    requestId: '123e4567-e89b-42d3-a456-426614174000',
    previewJobId: 'preview-1'
  });
  assert.equal(response.status, 409);
});

test('enqueue audit record is committed in the same transaction as the job', async () => {
  const db = createFakeDb({
    'essay_ai_backfill_jobs/preview-1': {
      mode: 'preview',
      status: 'completed',
      includeFailed: false,
      candidateCount: 2,
      scanCutoffAt: new Date()
    }
  });
  const response = await requestRouter(createRouter(db), '/trigger', {
    requestId: '123e4567-e89b-42d3-a456-426614174000',
    previewJobId: 'preview-1'
  });
  assert.equal(response.status, 202);
  const payload = await response.json();
  assert.ok(db.transactionSets.includes(`crmAuditLogs/essay-ai:${payload.jobId}`));
});

test('preview rejects a non-UUID request identifier', async () => {
  const response = await requestRouter(createRouter(createFakeDb()), '/preview', {
    requestId: '----------------',
    includeFailed: false
  });
  assert.equal(response.status, 400);
});

test('admin routes reject invalid option types before reading Firestore', async () => {
  const preview = await requestRouter(createRouter(createFakeDb()), '/preview', {
    requestId: '123e4567-e89b-42d3-a456-426614174000',
    includeFailed: 'yes'
  });
  assert.equal(preview.status, 400);
  const trigger = await requestRouter(createRouter(createFakeDb()), '/trigger', {
    requestId: '123e4567-e89b-42d3-a456-426614174000',
    previewJobId: { forged: true }
  });
  assert.equal(trigger.status, 400);
});

test('worker readiness requires a healthy heartbeat no older than 45 seconds', () => {
  const now = new Date('2026-07-26T00:01:00.000Z');
  assert.equal(createEssayAiAdminRouter.isWorkerReady({
    lastHeartbeatAt: new Date('2026-07-26T00:00:30.000Z'),
    ollamaReachable: true,
    modelsReady: true
  }, now), true);
  assert.equal(createEssayAiAdminRouter.isWorkerReady({
    lastHeartbeatAt: new Date('2026-07-26T00:00:14.000Z'),
    ollamaReachable: true,
    modelsReady: true
  }, now), false);
  assert.equal(createEssayAiAdminRouter.isWorkerReady({
    state: 'stopping',
    lastHeartbeatAt: now,
    ollamaReachable: true,
    modelsReady: true
  }, now), false);
});
