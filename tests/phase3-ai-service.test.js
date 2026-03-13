const assert = require('assert');
const path = require('path');
/* eslint-disable no-console */

console.log('Starting Phase 3 AI service test...');

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
  const axiosPath = require.resolve('axios');
  const loggerPath = require.resolve(path.join(root, 'src/utils/logger.js'));
  const retryPath = require.resolve(path.join(root, 'src/utils/retry.js'));
  const aiServicePath = require.resolve(path.join(root, 'src/services/ai-service.js'));

  const originals = new Map(
    [axiosPath, loggerPath, retryPath, aiServicePath].map((modulePath) => [modulePath, require.cache[modulePath]])
  );

  mockModule(axiosPath, {
    post: async () => ({
      data: {
        generated_text: 'Preface {"status":"ok","payload":{"score":95}} trailing {"ignore":true}'
      }
    })
  });
  mockModule(loggerPath, {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {}
  });
  mockModule(retryPath, {
    withRetry: async (fn) => fn()
  });
  delete require.cache[aiServicePath];

  try {
    const aiService = require(aiServicePath);
    const result = await aiService.generateStructuredResponse('test-model', 'hello', { type: 'object' });
    assert.deepStrictEqual(
      result,
      { status: 'ok', payload: { score: 95 } },
      'AI service should extract the first valid JSON object without greedily consuming later braces'
    );
  } finally {
    for (const [modulePath, original] of originals.entries()) {
      if (original) require.cache[modulePath] = original;
      else delete require.cache[modulePath];
    }
  }

  console.log('Phase 3 AI service test passed.');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
