'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { buildHttpNativeConfig } = require('../../../functions/src/crm/data-input/http-native-config');
const valid = { CRM_VOICE_NATIVE_ENABLED: 'true', CRM_VOICE_RELAY_URL: 'https://relay.example.invalid', CRM_VOICE_GEMINI_API_KEY: 'offline-fixture-key' };

test('HTTP native defaults are disabled before credentials or factory access', () => {
    const forbidden = () => { throw Error('Unexpected credential or factory access'); };
    for (const [enabled, env] of [[false, valid], [undefined, valid], [true, {}], [true, { ...valid, CRM_VOICE_NATIVE_ENABLED: 'false' }]]) {
        assert.equal(buildHttpNativeConfig({ enabled, env, resolveApiKey: forbidden, createNative: forbidden }), null);
    }
});

test('native HTTP uses scoped credential resolution and the own registered JSON provider without dispatch', () => {
    const config = buildHttpNativeConfig({ enabled: true, env: valid });
    assert.equal(config.nativeMode, true); assert.equal(config.voiceRelayUrl, valid.CRM_VOICE_RELAY_URL);
    assert.equal(config.native.accountingAdapter.native, true);
    assert.equal(config.native.policy.kind, 'estimated');
    assert.equal(typeof config.native.generationTransport, 'function');
    let calls = 0;
    const native = {};
    const custom = buildHttpNativeConfig({ enabled: true, env: valid,
        resolveApiKey(env) { assert.equal(env, valid); calls++; return 'scoped-fixture'; },
        createNative(options) { assert.deepEqual(options, { apiKey: 'scoped-fixture' }); calls++; return native; } });
    assert.equal(custom.native, native); assert.equal(calls, 2);
});

test('HTTP relay config rejects unsafe URLs before credentials and limits HTTP to demo loopback', () => {
    for (const url of ['', 'invalid', 'http://relay.example.invalid', 'https://user:secret@relay.example.invalid', 'https://relay.example.invalid?q=secret', 'https://relay.example.invalid/#secret', 'http://127.0.0.1:9000']) {
        assert.throws(() => buildHttpNativeConfig({ enabled: true, env: { ...valid, CRM_VOICE_RELAY_URL: url }, resolveApiKey() { assert.fail('URL must reject first'); } }), /relay/i);
    }
    for (const host of ['localhost', '127.0.0.1', '[::1]']) {
        const url = `http://${host}:9000`;
        assert.equal(buildHttpNativeConfig({ enabled: true, env: { ...valid, GCLOUD_PROJECT: 'demo-local-fixture', CRM_VOICE_RELAY_URL: url } }).voiceRelayUrl, url);
    }
    assert.throws(() => buildHttpNativeConfig({ enabled: true, env: { ...valid, GCLOUD_PROJECT: 'real-project', CRM_VOICE_RELAY_URL: 'http://localhost:9000' } }), /relay/i);
});
