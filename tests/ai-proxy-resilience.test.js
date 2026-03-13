const assert = require('assert');
const express = require('express');
const http = require('http');
const path = require('path');
/* eslint-disable no-console */

console.log('Starting AI proxy resilience tests...');

function mockModule(modulePath, exportsValue) {
  require.cache[modulePath] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports: exportsValue
  };
}

async function startServer(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${address.port}`
      });
    });
  });
}

async function stopServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

(async () => {
  process.env.HUGGINGFACE_API_KEY = 'test-key';

  const root = process.cwd();
  const routePath = require.resolve(path.join(root, 'src/routes/ai-proxy.js'));
  const firebasePath = require.resolve(path.join(root, 'src/utils/firebase.js'));
  const clientPath = require.resolve(path.join(root, 'src/utils/ai-client.js'));
  const limiterPath = require.resolve(path.join(root, 'src/middleware/rate-limiter.js'));
  const responseHelperPath = require.resolve(path.join(root, 'src/utils/response-helper.js'));
  const breakerPath = require.resolve(path.join(root, 'src/middleware/circuit-breaker.js'));
  const retryPath = require.resolve(path.join(root, 'src/utils/retry.js'));

  const originals = new Map(
    [routePath, firebasePath, clientPath, limiterPath, responseHelperPath, breakerPath, retryPath]
      .map((modulePath) => [modulePath, require.cache[modulePath]])
  );

  const breakerMap = new Map();
  function getBreaker(name) {
    if (!breakerMap.has(name)) {
      breakerMap.set(name, {
        _fallbackFactory: null,
        fallback(factory) {
          this._fallbackFactory = factory;
        },
        async fire(fn) {
          if (name === 'huggingface-ai-stream') {
            return this._fallbackFactory ? this._fallbackFactory() : { _circuitOpen: true };
          }
          return fn();
        }
      });
    }
    return breakerMap.get(name);
  }

  mockModule(firebasePath, { db: null });
  mockModule(clientPath, {
    post: async () => ({
      data: { choices: [{ message: { content: 'ok' } }] }
    }),
    defaults: {}
  });
  mockModule(limiterPath, (_req, _res, next) => next());
  mockModule(responseHelperPath, {
    sendError: (res, status, error, message, details = null) => res.status(status).json({
      success: false,
      error,
      message,
      ...(details && { details })
    }),
    sendSuccess: (res, data) => res.json({ success: true, ...data })
  });
  mockModule(breakerPath, {
    createBreaker: (name) => getBreaker(name)
  });
  mockModule(retryPath, {
    withRetry: async (fn) => fn()
  });
  delete require.cache[routePath];

  const router = require(routePath);
  const app = express();
  app.use(express.json());
  app.use('/api', router);

  const { server, baseUrl } = await startServer(app);

  try {
    const response = await fetch(`${baseUrl}/api/ai-feedback-stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'hello stream' })
    });
    const body = await response.text();

    assert.strictEqual(response.status, 200, 'stream route should keep SSE response semantics');
    assert.match(body, /temporarily unavailable/i, 'stream route should return a user-friendly unavailable message when the circuit is open');
    assert.doesNotMatch(body, /Stream failed/i, 'stream route should avoid the generic stream failure message when the circuit is open');

    const aiClient = require(clientPath);
    assert.ok(
      !aiClient.defaults.raxConfig,
      'AI client should not apply retry-axios automatically when route-level retry/backoff is in place'
    );
  } finally {
    await stopServer(server);
    for (const [modulePath, original] of originals.entries()) {
      if (original) require.cache[modulePath] = original;
      else delete require.cache[modulePath];
    }
  }

  console.log('AI proxy resilience tests passed.');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
