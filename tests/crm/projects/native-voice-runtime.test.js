'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { readConfiguration, loadComposition, createRuntime, installShutdown } = require('../../../services/crm-voice-relay/runtime');
const production = { GOOGLE_CLOUD_PROJECT: 'voice-runtime-project', CRM_VOICE_ALLOWED_ORIGINS: 'https://crm.example.test', PORT: '8080' };

test('live chat credential precedence is scoped, persistent and fails closed for broken dedicated config', () => {
    const { resolveLiveChatApiKey } = require('../../../functions/src/ai-assistance/providers/live-chat-credentials');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-credential-')), file = path.join(dir, 'live-chat.env');
    try {
        fs.writeFileSync(file, 'CRM_VOICE_GEMINI_API_KEY=private-fixture\n');
        const env = { GEMINI_API_KEY: 'general-fixture', CRM_VOICE_CREDENTIAL_FILE: file };
        assert.equal(resolveLiveChatApiKey(env), 'private-fixture'); assert.equal(env.GEMINI_API_KEY, 'general-fixture');
        assert.equal(resolveLiveChatApiKey({ ...env, CRM_VOICE_GEMINI_API_KEY: 'explicit-fixture' }), 'explicit-fixture');
        assert.equal(resolveLiveChatApiKey({ GEMINI_API_KEY: 'legacy-fixture' }), 'legacy-fixture');
        for (const text of ['', 'GEMINI_API_KEY=wrong-scope', 'CRM_VOICE_GEMINI_API_KEY=\n', 'CRM_VOICE_GEMINI_API_KEY=fixture\nOTHER=extra']) {
            fs.writeFileSync(file, text); assert.throws(() => resolveLiveChatApiKey(env), { code: 'LIVE_CHAT_CREDENTIAL_CONFIG' });
        }
        assert.throws(() => resolveLiveChatApiKey({ ...env, CRM_VOICE_GEMINI_API_KEY: '' }), { code: 'LIVE_CHAT_CREDENTIAL_CONFIG' });
        assert.throws(() => resolveLiveChatApiKey({ ...env, CRM_VOICE_CREDENTIAL_FILE: 'relative.env' }), { code: 'LIVE_CHAT_CREDENTIAL_CONFIG' });
    } finally { fs.unlinkSync(file); fs.rmdirSync(dir); }
});
test('runtime requires exact origins and isolates production from emulator configuration', () => {
    assert.deepEqual(readConfiguration(production).allowedOrigins, ['https://crm.example.test']);
    for (const patch of [{ CRM_VOICE_ALLOWED_ORIGINS: '*' }, { CRM_VOICE_ALLOWED_ORIGINS: 'https://crm.example.test/path' }, { CRM_VOICE_ALLOWED_ORIGINS: 'http://crm.example.test' }, { FIRESTORE_EMULATOR_HOST: 'localhost:8188' }, { PORT: '0' }, { GOOGLE_CLOUD_PROJECT: '../other' }]) assert.throws(() => readConfiguration({ ...production, ...patch }), { code: 'VOICE_RUNTIME_CONFIG' });
    assert.throws(() => readConfiguration({ ...production, GOOGLE_CLOUD_PROJECT: 'demo-voice-runtime' }));
    assert.equal(readConfiguration({ ...production, GOOGLE_CLOUD_PROJECT: 'demo-voice-runtime', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8188', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9180', CRM_VOICE_ALLOWED_ORIGINS: 'http://127.0.0.1:9270' }).demo, true);
});
test('custom domain composition is pinned to exact source bytes', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-composition-')), file = path.join(dir, 'composition.js');
    try {
        const bytes = 'exports.composeVoice = () => ({ marker: true });'; fs.writeFileSync(file, bytes);
        const config = readConfiguration({ ...production, CRM_VOICE_COMPOSITION_MODULE: file, CRM_VOICE_COMPOSITION_SHA256: crypto.createHash('sha256').update(bytes).digest('hex') });
        assert.equal(loadComposition(config)().marker, true);
        fs.appendFileSync(file, '\n// changed'); assert.throws(() => loadComposition(config), { code: 'VOICE_RUNTIME_CONFIG' });
    } finally { fs.unlinkSync(file); fs.rmdirSync(dir); }
});
test('real HTTP runtime distinguishes liveness from native readiness, keeps Auth and Origin checks, and closes once', async () => {
    let authCalls = 0, domainCloses = 0;
    const runtime = await createRuntime({ env: production, compose: async () => ({
        nativeReady: true, authenticate: async token => { authCalls++; if (token !== 'allowed') throw Error('private details'); return { uid: 'staff' }; },
        ledger: {}, sessionService: { readStatus: async input => ({ state: 'closed', feature: input.feature, sessionId: input.sessionId }) }, close: async () => { domainCloses++; }
    }) });
    await new Promise(resolve => runtime.server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${runtime.server.address().port}`;
    const request = (route, token = 'allowed', origin = production.CRM_VOICE_ALLOWED_ORIGINS) => fetch(url + route, { method: 'POST', headers: { Origin: origin, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ feature: 'projects', sessionId: 'session' }) });
    try {
        const health = await fetch(url + '/healthz'); assert.equal(health.status, 200); assert.equal((await health.json()).nativeReady, false);
        const ready = await fetch(url + '/readyz'); assert.equal(ready.status, 503); assert.equal((await ready.json()).reason, 'NATIVE_NOT_CONFIGURED');
        assert.equal(authCalls, 0); assert.equal((await request('/status', 'allowed', 'https://attacker.test')).status, 403); assert.equal(authCalls, 0);
        const rejected = await request('/status', 'bad'); assert.equal(rejected.status, 400); assert.equal((await rejected.text()).includes('private details'), false);
        const status = await request('/status'); assert.equal(status.status, 200); assert.equal((await status.json()).sessionId, 'session'); assert.equal(authCalls, 2);
    } finally { await Promise.all([runtime.close(), runtime.close()]); }
    assert.equal(domainCloses, 1); assert.equal(runtime.server.listening, false);
});
test('runtime refuses an engineering composition and releases its resources', async () => {
    let closed = 0;
    await assert.rejects(createRuntime({ env: production, compose: async () => ({ engineeringMode: true, authenticate() {}, close: async () => { closed++; } }) }), { code: 'VOICE_RUNTIME_CONFIG' });
    assert.equal(closed, 1);
});
test('readiness requires explicit native configuration and a registered native factory', async () => {
    const factory = () => {}; factory.native = true;
    const runtime = await createRuntime({ env: { ...production, CRM_VOICE_NATIVE_ENABLED: 'true', CRM_VOICE_GEMINI_API_KEY: 'dedicated-fixture', GEMINI_API_KEY: 'general-fixture' }, compose: async ({ nativeCredentials }) => { assert.equal(nativeCredentials.apiKey, 'dedicated-fixture'); return { nativeMode: true, nativeReady: true, providerFactory: factory, authenticate() {}, ledger: {}, sessionService: {} }; } });
    await new Promise(resolve => runtime.server.listen(0, '127.0.0.1', resolve));
    try { const response = await fetch(`http://127.0.0.1:${runtime.server.address().port}/readyz`); assert.equal(response.status, 200); assert.equal((await response.json()).nativeReady, true); }
    finally { await runtime.close(); }
});
test('signal cleanup failures produce one sanitized diagnostic without an unhandled rejection', async () => {
    const fakeProcess = new (require('node:events').EventEmitter)();
    let output = '', closes = 0;
    fakeProcess.stderr = { write: text => { output += text; } };
    installShutdown({ close: async () => { closes++; throw Error('private credential details'); } }, fakeProcess);
    fakeProcess.emit('SIGTERM'); fakeProcess.emit('SIGINT');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(closes, 1); assert.equal(fakeProcess.exitCode, 1);
    assert.equal(JSON.parse(output).event, 'voice_runtime_shutdown_failed');
    assert.equal(output.includes('private'), false);
});
test('default Firebase SDK composition initializes and releases without provider dispatch', async () => {
    const { composeProjects } = require('../../../services/crm-voice-relay/projects-composition');
    const composition = await composeProjects({ config: { projectId: 'demo-voice-runtime' } });
    try {
        assert.equal(composition.nativeReady, false);
        assert.deepEqual(composition.features, {});
        assert.equal(typeof composition.authenticate, 'function');
        assert.ok(composition.sessionService); assert.ok(composition.ledger);
    } finally { await composition.close(); }
});
