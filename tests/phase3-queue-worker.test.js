const assert = require('assert');
const path = require('path');
/* eslint-disable no-console */

console.log('Starting Phase 3 queue/worker test...');

function mockModule(modulePath, exportsValue) {
  require.cache[modulePath] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports: exportsValue
  };
}

(async () => {
  const root = process.cwd();
  const firebasePath = require.resolve(path.join(root, 'src/utils/firebase.js'));
  const queuePath = require.resolve(path.join(root, 'src/services/queue-service.js'));
  const workerPath = require.resolve(path.join(root, 'src/workers/ai-worker.js'));
  const loggerPath = require.resolve(path.join(root, 'src/utils/logger.js'));

  const originals = new Map(
    [firebasePath, queuePath, workerPath, loggerPath].map((modulePath) => [modulePath, require.cache[modulePath]])
  );

  mockModule(firebasePath, { db: null });
  mockModule(loggerPath, {
    info: () => {},
    warn: () => {},
    error: () => {}
  });
  delete require.cache[queuePath];
  delete require.cache[workerPath];

  try {
    const queueService = require(queuePath);
    assert.strictEqual(queueService.isAvailable(), false, 'queue service should stay constructible when Firestore is unavailable');
    assert.strictEqual(
      await queueService.claimNextJob(['generate_thumbnail']),
      null,
      'queue service should return null instead of crashing when Firestore is unavailable'
    );

    const aiWorker = require(workerPath);
    aiWorker.start();
    assert.strictEqual(
      aiWorker.isRunning,
      false,
      'worker should not enter polling mode when the durable queue is unavailable or no handlers are configured'
    );
  } finally {
    for (const [modulePath, original] of originals.entries()) {
      if (original) require.cache[modulePath] = original;
      else delete require.cache[modulePath];
    }
  }

  console.log('Phase 3 queue/worker test passed.');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
