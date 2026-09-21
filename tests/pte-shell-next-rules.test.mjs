import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const context = { module: { exports: {} } };
vm.runInNewContext(fs.readFileSync(new URL('../public/js/speaking-practice-controller.js', import.meta.url), 'utf8'), context);
test('all six speaking phases follow approved Next policy; loading is disabled by shell', () => {
  for (const [phase, expected] of Object.entries({ loading: 'direct', listen: 'confirm', prep: 'noskip', recording: 'confirm', complete: 'confirm', feedback: 'direct' })) {
    assert.equal(context.module.exports.resolveNextAction(phase), expected, phase);
  }
});
test('shell flag honors query overrides, storage fallback and excluded scopes', () => {
  const script = fs.readFileSync(new URL('../public/js/pte-shell-config.js', import.meta.url), 'utf8');
  const resolve = (query, stored, denied = false) => {
    const sandbox = { URL, window: { location: { href: `https://example.test/${query}` } }, localStorage: { getItem() { if (denied) throw new Error('storage denied'); return stored; } } };
    vm.runInNewContext(script, sandbox); return sandbox.window.PteShellConfig;
  };
  assert.equal(resolve('', null).enabled, false);
  assert.equal(resolve('', 'v3').enabled, true);
  assert.equal(resolve('?pteShell=legacy', 'v3').enabled, false);
  assert.equal(resolve('?pteShell=v3', 'legacy').enabled, true);
  assert.equal(resolve('', null, true).enabled, false);
  const enabled = resolve('?pteShell=v3', null);
  assert.equal(enabled.isModeEnabled('speak', 'pte'), true);
  assert.equal(enabled.isModeEnabled('speak', 'english'), false);
  assert.equal(enabled.isModeEnabled('type', 'pte'), false);
  assert.equal(enabled.isModeEnabled('unknown', 'pte'), false);
});
