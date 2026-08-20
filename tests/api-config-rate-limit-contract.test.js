/* eslint-disable no-console */
process.env.NODE_ENV = 'test';
process.env.CLIENT_FIREBASE_API_KEY = 'test-api-key';
process.env.CLIENT_FIREBASE_PROJECT_ID = 'listening-tasks-3ae34';

const assert = require('assert');
const http = require('http');
const path = require('path');

const apiApp = require(path.join(process.cwd(), 'functions/src/apiApp.js'));

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
  const { server, baseUrl } = await startServer(apiApp);

  try {
    // 1. Verify /api/config responds with 200 repeatedly without 429 rate limit
    for (let i = 0; i < 30; i++) {
      const res = await fetch(`${baseUrl}/api/config`);
      assert.strictEqual(res.status, 200, `/api/config request ${i + 1} should return 200 OK`);
      const body = await res.json();
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.config.apiKey, 'test-api-key');
      assert.strictEqual(body.config.projectId, 'listening-tasks-3ae34');
    }

    // 2. Verify /config alias responds with 200 repeatedly without 429 rate limit
    for (let i = 0; i < 30; i++) {
      const res = await fetch(`${baseUrl}/config`);
      assert.strictEqual(res.status, 200, `/config request ${i + 1} should return 200 OK`);
      const body = await res.json();
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.config.apiKey, 'test-api-key');
    }

    console.log('api-config rate limit contract tests passed (60/60 requests successful)');
  } finally {
    await stopServer(server);
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
