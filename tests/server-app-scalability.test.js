const assert = require('assert');
const express = require('express');
const http = require('http');
const path = require('path');
/* eslint-disable no-console */

console.log('Starting server scalability app tests...');

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

function createOkRouter(routePath, payload) {
  const router = express.Router();
  router.get(routePath, (_req, res) => res.json(payload));
  router.post(routePath, (_req, res) => res.json(payload));
  return router;
}

(async () => {
  const { createApp } = require(path.join(process.cwd(), 'src/server/app.js'));

  const app = createApp({
    projectRoot: process.cwd(),
    logger: {
      requestMiddleware: () => (_req, _res, next) => next()
    },
    routes: {
      transcriptRoutes: createOkRouter('/transcript', { success: true }),
      dictionaryRoutes: createOkRouter('/dictionary', { success: true }),
      aiProxyRoutes: (() => {
        const router = express.Router();
        router.post('/ai-proxy', (_req, res) => res.json({ success: true, route: 'ai-proxy' }));
        router.post('/ai-feedback-stream', (_req, res) => res.json({ success: true, route: 'ai-feedback-stream' }));
        return router;
      })(),
      adminRoutes: createOkRouter('/status', { success: true }),
      teacherSchedulerRoutes: createOkRouter('/teacher', { success: true }),
      classroomsRoutes: createOkRouter('/classrooms', { success: true }),
      entranceTestRoutes: createOkRouter('/status', { success: true }),
      readingJourneyRoutes: (() => {
        const router = express.Router();
        router.get('/reading-journey/health', (_req, res) => res.json({ success: true, enabled: true }));
        return router;
      })(),
      pronunciationTestRoutes: createOkRouter('/pronunciation-test/ping', { success: true }),
      readAloudRoutes: createOkRouter('/read-aloud/health', { success: true })
    },
    firebase: {
      db: null
    },
    circuitBreaker: {
      getBreakerStatus: () => ({})
    }
  });

  const { server, baseUrl } = await startServer(app);

  try {
    const htmlResponse = await fetch(`${baseUrl}/index.html`);
    assert.strictEqual(htmlResponse.status, 200, 'index.html should be served');
    assert.match(
      String(htmlResponse.headers.get('cache-control') || ''),
      /no-cache/i,
      'HTML should not receive long-lived cache headers'
    );

    const versionedCss = await fetch(`${baseUrl}/style.css?v=20260312`);
    assert.strictEqual(versionedCss.status, 200, 'versioned CSS should be served');
    const versionedCssCache = String(versionedCss.headers.get('cache-control') || '');
    assert.match(versionedCssCache, /max-age=31536000/i, 'versioned assets should keep long cache lifetime');
    assert.match(versionedCssCache, /immutable/i, 'versioned assets should be marked immutable');

    const unversionedCss = await fetch(`${baseUrl}/srs-review.css`);
    assert.strictEqual(unversionedCss.status, 200, 'unversioned CSS should be served');
    const unversionedCssCache = String(unversionedCss.headers.get('cache-control') || '');
    assert.doesNotMatch(
      unversionedCssCache,
      /31536000/,
      'unversioned assets must not be cached for one year'
    );

    for (let i = 0; i < 35; i += 1) {
      const res = await fetch(`${baseUrl}/api/reading-journey/health`);
      assert.strictEqual(res.status, 200, 'reading journey health should not be throttled by AI limiter');
    }

    for (let i = 0; i < 30; i += 1) {
      const res = await fetch(`${baseUrl}/api/ai-proxy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: `request-${i}` })
      });
      assert.strictEqual(res.status, 200, 'first 30 AI proxy requests should pass');
    }

    const limited = await fetch(`${baseUrl}/api/ai-proxy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'request-31' })
    });
    assert.strictEqual(limited.status, 429, '31st AI proxy request should be rate limited');
  } finally {
    await stopServer(server);
  }

  console.log('Server scalability app tests passed.');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
