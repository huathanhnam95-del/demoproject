import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

function loadSupport(fetchImpl = globalThis.fetch) {
  const values = new Map();
  const window = {
    localStorage: {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, String(value)),
    },
    crypto: globalThis.crypto,
  };
  const context = vm.createContext({ window, globalThis: window, TextEncoder, Uint8Array, fetch: fetchImpl });
  vm.runInContext(fs.readFileSync('public/js/write-essay-support.js', 'utf8'), context);
  return window.WriteEssaySupport;
}

test('adaptive Guided mapping follows profile then onboarding then B2 fallback', () => {
  const support = loadSupport();
  assert.equal(support.resolveSupportLevel({ profile: { cefrLevels: { writing: 'A2' } }, onboardingLevel: 'C1' }), 'a2_b1');
  assert.equal(support.resolveSupportLevel({ profile: {}, onboardingLevel: 'C1' }), 'c1');
  assert.equal(support.resolveSupportLevel({ profile: {} }), 'b2');
  assert.equal(support.resolveSupportLevel({ profile: { cefrLevels: { writing: 'C1' } }, manualOverride: 'a2_b1' }), 'a2_b1');
});

test('Guided history stores aggregate target usage and recycles at most two IDs', () => {
  const support = loadSupport();
  support.recordGuidedUsage({ questionId: '1', targetIds: ['one', 'two', 'three'], level: 'b2' });
  support.recordGuidedUsage({ questionId: '2', targetIds: ['two', 'four'], level: 'c1' });
  assert.deepEqual(Array.from(support.getRecycledTargetIds({ exclude: ['two'], limit: 8 })), ['one', 'three']);
  assert.deepEqual(Array.from(support.recordGuidedUsage({ questionId: '3', targetIds: ['four'], level: 'b2' }).targetIds), ['four']);
});

test('support loader rejects an unpublished question before requesting a pack', async () => {
  const support = loadSupport(async () => ({ ok: true, json: async () => ({ schemaVersion: 'EssaySupportManifestV1', contentVersion: 'v1', questions: {} }) }));
  await assert.rejects(() => support.loadPack('370'), error => error.code === 'not_published');
});
