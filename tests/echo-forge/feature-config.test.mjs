import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const require = createRequire(import.meta.url);
const local = require('../../src/server/public-feature-config.js');
const functions = require('../../functions/src/public-feature-config.js');

test('local and Functions config expose the same strict Echo Forge feature flag', () => {
  for (const module of [local, functions]) {
    assert.strictEqual(module.buildPublicFeatures({}).echoForgeSandbox, false);
    assert.strictEqual(module.buildPublicFeatures({ ECHO_FORGE_SANDBOX_ENABLED: 'false' }).echoForgeSandbox, false);
    assert.strictEqual(module.buildPublicFeatures({ ECHO_FORGE_SANDBOX_ENABLED: 'TRUE' }).echoForgeSandbox, false);
    assert.strictEqual(module.buildPublicFeatures({ ECHO_FORGE_SANDBOX_ENABLED: 'true' }).echoForgeSandbox, true);
    assert.deepEqual(module.buildPublicFeatures({}), module.buildPublicFeatures({}));
  }
});

test('both /api/config responses include feature parity without exposing the sandbox elsewhere', async () => {
  const localSource = await readFile(new URL('../../src/server/app.js', import.meta.url), 'utf8');
  const functionsSource = await readFile(new URL('../../functions/src/apiApp.js', import.meta.url), 'utf8');
  for (const source of [localSource, functionsSource]) {
    assert.match(source, /features:\s*buildPublicFeatures\(process\.env\)/);
  }
  const index = await readFile(new URL('../../public/index.html', import.meta.url), 'utf8');
  const launcher = await readFile(new URL('../../public/script.js', import.meta.url), 'utf8');
  assert.doesNotMatch(launcher, /from\s+['"][^'"]*js\/echo-forge\//);
  assert.match(index, /href="\/echo-forge-sandbox\.html"/);
});
