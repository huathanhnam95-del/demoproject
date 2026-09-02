const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

const ingestServicePath = path.resolve(__dirname, '../../functions/src/crm/book-ingest-service.js');
const indexPath = path.resolve(__dirname, '../../functions/src/index.js');

test('book ingest service re-exports the text revision queue runner', () => {
  const ingestService = require(ingestServicePath);

  assert.equal(typeof ingestService.runBookIngestQueue, 'function');
  assert.equal(typeof ingestService.runBookTextRevisionQueue, 'function');
});

test('text revision runner is scheduled separately with default Firebase dependencies', async () => {
  const schedules = [];
  const revisionCalls = [];
  const db = { name: 'stub-firestore' };
  const getStorageBucket = async () => ({ name: 'stub-storage-bucket' });
  const legacyRunner = async () => {};
  const revisionRunner = async (...args) => {
    revisionCalls.push(args);
  };

  const originalLoad = Module._load;
  delete require.cache[indexPath];

  Module._load = function loadWithStubs(request, parent, isMain) {
    if (request === 'firebase-admin/app') return { initializeApp: () => {} };
    if (request === 'firebase-admin/firestore') return { getFirestore: () => db };
    if (request === 'firebase-functions/v2/https') return { onRequest: () => ({}) };
    if (request === 'firebase-functions/v2/scheduler') {
      return {
        onSchedule: (options, handler) => {
          const scheduled = { options, handler };
          schedules.push(scheduled);
          return scheduled;
        }
      };
    }
    if (request === './crm/book-ingest-service') {
      return {
        runBookIngestQueue: legacyRunner,
        runBookTextRevisionQueue: revisionRunner
      };
    }
    if (request === './utils/firebase_admin_init') {
      return { getStorageBucket };
    }
    if (request.startsWith('./')) return {};
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    const entryPoint = require(indexPath);
    const runner = entryPoint.crmBookTextRevisionRunner;
    const legacyScheduledRunner = entryPoint.crmBookIngestRunner;

    assert.ok(runner, 'the text revision runner should be exported');
    assert.ok(legacyScheduledRunner, 'the legacy ingest runner should remain exported');
    assert.ok(schedules.includes(runner), 'the text revision runner should be registered with the scheduler');
    assert.deepEqual(runner.options, {
      region: 'us-central1',
      schedule: 'every 1 minutes',
      timeoutSeconds: 540,
      memory: '2GiB'
    });
    assert.deepEqual(legacyScheduledRunner.options, runner.options);

    await runner.handler();

    assert.equal(revisionCalls.length, 1);
    assert.strictEqual(revisionCalls[0][0], db);
    assert.equal(typeof revisionCalls[0][1].now, 'object');
    assert.ok(revisionCalls[0][1].now instanceof Date);
    assert.strictEqual(revisionCalls[0][1].getStorageBucket, getStorageBucket);
    assert.notStrictEqual(legacyScheduledRunner.handler, runner.handler);
  } finally {
    Module._load = originalLoad;
    delete require.cache[indexPath];
  }
});

test('runner source keeps the legacy ingest runner separate from the revision runner', () => {
  const source = fs.readFileSync(indexPath, 'utf8');

  assert.match(source, /crmBookIngestRunner\s*:\s*onSchedule/);
  assert.match(source, /crmBookTextRevisionRunner\s*:\s*onSchedule/);
  assert.match(source, /runBookTextRevisionQueue\(db,\s*\{\s*now:\s*new Date\(\),\s*getStorageBucket\s*\}\)/s);
});
