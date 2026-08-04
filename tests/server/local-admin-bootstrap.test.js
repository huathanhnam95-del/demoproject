/* eslint-disable no-console */
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');

const { createApp } = require('../../src/server/app');
const {
  isLocalHostname,
  shouldAllowLocalAdminBootstrap,
  resolveLocalAdminEmail
} = require('../../src/server/local-admin');

function createOkRouter(routePath, payload = { success: true }) {
  const router = express.Router();
  router.get(routePath, (_req, res) => res.json(payload));
  router.post(routePath, (_req, res) => res.json(payload));
  return router;
}

function buildRoutes() {
  return {
    transcriptRoutes: createOkRouter('/transcript'),
    dictionaryRoutes: createOkRouter('/dictionary'),
    aiProxyRoutes: createOkRouter('/ai-proxy'),
    adminRoutes: createOkRouter('/status'),
    teacherSchedulerRoutes: createOkRouter('/teacher'),
    classroomsRoutes: createOkRouter('/classrooms'),
    entranceTestRoutes: createOkRouter('/status'),
    readingJourneyRoutes: createOkRouter('/reading-journey/health'),
    pronunciationTestRoutes: createOkRouter('/pronunciation-test/ping'),
    readAloudRoutes: createOkRouter('/read-aloud/health')
  };
}

async function startApp(app) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function stopApp(server) {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function postWithHost(baseUrl, host, headers = {}) {
  const target = new URL(`${baseUrl}/api/local/admin-token`);
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: target.hostname,
      port: target.port,
      path: target.pathname,
      method: 'POST',
      headers: { Host: host, ...headers }
    }, (response) => {
      response.resume();
      response.on('end', () => resolve(response));
    });
    request.on('error', reject);
    request.end();
  });
}

const envKeys = [
  'NODE_ENV',
  'ALLOW_PROD_FIREBASE',
  'FIREBASE_AUTH_EMULATOR_HOST',
  'ADMIN_EMAIL',
  'EMULATOR_ADMIN_EMAIL'
];
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

async function main() {
  assert.equal(isLocalHostname('localhost'), true);
  assert.equal(isLocalHostname('127.0.0.1'), true);
  assert.equal(isLocalHostname('192.168.1.22'), true);
  assert.equal(isLocalHostname('betterenglishlearning.com'), false);

  process.env.NODE_ENV = 'development';
  delete process.env.ALLOW_PROD_FIREBASE;
  process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
  process.env.ADMIN_EMAIL = 'local-admin@example.test';
  delete process.env.EMULATOR_ADMIN_EMAIL;

  assert.equal(resolveLocalAdminEmail({ repoRoot: process.cwd() }), 'local-admin@example.test');
  assert.equal(
    shouldAllowLocalAdminBootstrap({ hostname: 'localhost' }),
    true,
    'emulator-backed localhost should allow the local admin bootstrap'
  );
  assert.equal(
    shouldAllowLocalAdminBootstrap({ hostname: 'betterenglishlearning.com' }),
    false,
    'production hostname must never allow the local admin bootstrap'
  );

  const issued = [];
  const fakeAdmin = {
    auth: () => ({
      getUserByEmail: async (email) => ({ uid: 'local-admin-uid', email, emailVerified: true }),
      createCustomToken: async (uid) => {
        issued.push(uid);
        return 'local-admin-token';
      }
    })
  };

  const app = createApp({
    projectRoot: process.cwd(),
    logger: { requestMiddleware: () => (_req, _res, next) => next() },
    routes: buildRoutes(),
    firebase: { admin: fakeAdmin, db: null },
    circuitBreaker: { getBreakerStatus: () => ({}) }
  });
  const { server, baseUrl } = await startApp(app);

  try {
    const response = await fetch(`${baseUrl}/api/local/admin-token`, { method: 'POST' });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(body, { success: true, token: 'local-admin-token' });
    assert.deepEqual(issued, ['local-admin-uid']);
    assert.match(String(response.headers.get('cache-control')), /no-store/i);

    const remoteResponse = await postWithHost(baseUrl, 'betterenglishlearning.com');
    assert.equal(remoteResponse.statusCode, 404, 'remote Host headers must be rejected');

    const remoteOriginResponse = await postWithHost(baseUrl, 'localhost', {
      Origin: 'https://evil.example'
    });
    assert.equal(remoteOriginResponse.statusCode, 404, 'remote Origin headers must be rejected');

    process.env.FIREBASE_AUTH_EMULATOR_HOST = '';
    const disabledResponse = await fetch(`${baseUrl}/api/local/admin-token`, { method: 'POST' });
    assert.equal(disabledResponse.status, 404, 'without the emulator guard the endpoint must be disabled');

    process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
    process.env.NODE_ENV = 'production';
    const productionResponse = await fetch(`${baseUrl}/api/local/admin-token`, { method: 'POST' });
    assert.equal(productionResponse.status, 404, 'production mode must disable the local admin endpoint');
  } finally {
    await stopApp(server);
    for (const key of envKeys) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  }

  console.log('local admin bootstrap tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
