import test from 'node:test';
import assert from 'node:assert/strict';

test('srs-onboarding attaches SRSOnboarding to window for review module compatibility', async () => {
    globalThis.window = {};

    const module = await import('../public/srs-onboarding.js');

    assert.ok(module.SRSOnboarding);
    assert.strictEqual(globalThis.window.SRSOnboarding, module.SRSOnboarding);

    delete globalThis.window;
});
