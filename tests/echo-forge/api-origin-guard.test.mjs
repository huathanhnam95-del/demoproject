import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createEchoForgeOriginGuard, DEFAULT_ALLOWED_ORIGINS } = require('../../functions/src/middleware/echo-forge-origin-guard');

function runGuard(environment, origin) {
  let nextCalled = false;
  const response = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  const request = { headers: origin === undefined ? {} : { origin } };
  createEchoForgeOriginGuard({ environment })(request, response, () => { nextCalled = true; });
  return { response, nextCalled };
}

test('Echo Forge origin guard allows production origins and rejects missing or disallowed origins neutrally', () => {
  assert.ok(DEFAULT_ALLOWED_ORIGINS.has('https://betterenglishlearning.com'));
  assert.equal(runGuard({}, 'https://betterenglishlearning.com').nextCalled, true);
  for (const origin of [undefined, 'https://evil.example']) {
    const result = runGuard({}, origin);
    assert.equal(result.nextCalled, false);
    assert.equal(result.response.statusCode, 403);
    assert.deepEqual(result.response.body, { success: false, error: 'ORIGIN_NOT_ALLOWED' });
  }
});

test('Echo Forge origin guard permits emulator localhost origins and honors explicit overrides', () => {
  assert.equal(runGuard({ FUNCTIONS_EMULATOR: 'true' }, 'http://localhost:5001').nextCalled, true);
  assert.equal(runGuard({ FUNCTIONS_EMULATOR: 'true' }, 'http://127.0.0.1:8080').nextCalled, true);
  assert.equal(runGuard({ FUNCTIONS_EMULATOR: 'true' }, 'http://192.168.0.2:5001').nextCalled, false);
  assert.equal(runGuard({ ECHO_FORGE_ALLOWED_ORIGINS: 'https://sandbox.example' }, 'https://sandbox.example').nextCalled, true);
  assert.equal(runGuard({ ECHO_FORGE_ALLOWED_ORIGINS: 'https://sandbox.example' }, 'https://betterenglishlearning.com').nextCalled, false);
});

test('Echo Forge origin guard is mounted before optional auth and the rate limiter', async () => {
  const source = await readFile(new URL('../../functions/src/apiApp.js', import.meta.url), 'utf8');
  assert.match(source, /createEchoForgeOriginGuard/);
  const guardIndex = source.indexOf("app.use('/api/echo-forge/assess', createEchoForgeOriginGuard");
  const authIndex = source.indexOf("app.use('/api/echo-forge/assess', optionalAuthMiddleware");
  assert.ok(guardIndex >= 0, 'origin guard route mount exists');
  assert.ok(authIndex >= 0, 'auth/rate limiter route mount exists');
  assert.ok(guardIndex < authIndex, 'origin guard runs before optional auth and the rate limiter');
});
