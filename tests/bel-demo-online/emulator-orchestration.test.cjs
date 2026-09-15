const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { safeEnvironment, temporaryFirebaseConfig, windowsFirebaseCleanupScript } = require('../../scripts/bel-demo/start-online-emulators.cjs');
const { settleOutcome } = require('../../scripts/bel-demo/rehearse-online.cjs');

test('database wire observation handles split masked frames and never alters forwarded bytes', async () => {
    const { wireObserver } = require('../../scripts/bel-demo/measure-online.cjs');
    const { Sender } = require('../../functions/node_modules/ws');
    const counts = {}, observe = wireObserver(counts);
    observe(Buffer.from('GET /.ws HTTP/1.1\r\nUpgrade: websocket\r\n\r\n'));
    const payload = Buffer.from(JSON.stringify({ t: 'd', d: { a: 'p', b: { text: 'x'.repeat(66000) } } }));
    const frame = Buffer.concat(Sender.frame(payload, { fin: true, opcode: 1, mask: true, readOnly: true }));
    const original = Buffer.from(frame);
    for (let index = 0; index < frame.length; index += 37) observe(frame.subarray(index, index + 37));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(counts.p, 1); assert.equal(counts.observerErrors || 0, 0); assert.deepEqual(frame, original);
    const http = {}; const rest = wireObserver(http); rest(Buffer.from('GET /room.json HTTP/1.1\r\nConnection: keep-alive\r\n\r\n')); rest(Buffer.alloc(100,255));
    assert.equal(http.httpConnections, 1); assert.equal(http.observerErrors || 0, 0);
});

const ports = {
    auth: { host: '127.0.0.1', port: 19101 },
    firestore: { host: '127.0.0.1', port: 19080 },
    database: { host: '127.0.0.1', port: 19000 },
    functions: { host: '127.0.0.1', port: 15003 },
    storage: { host: '127.0.0.1', port: 19201 }
};

test('emulator orchestration is demo-scoped, credential-free, and disables the emulator UI', () => {
    assert.throws(() => safeEnvironment({ FIREBASE_PROJECT_ID: 'production-project' }, ports), /non-demo project/);
    assert.throws(() => safeEnvironment({ GOOGLE_APPLICATION_CREDENTIALS: 'secret.json' }, ports), /production credentials/);
    const environment = safeEnvironment({}, ports);
    assert.equal(environment.FIREBASE_PROJECT_ID, 'demo-bel-online');
    assert.equal(environment.PRESENTATION_DEMO_DURABLE_READY, '1');
    assert.equal(environment.PRESENTATION_DEMO_DEV_AUTH, '0');
    assert.equal(environment.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:19101');
    const filename = temporaryFirebaseConfig(ports);
    try {
        const generated = JSON.parse(fs.readFileSync(filename, 'utf8'));
        assert.equal(generated.emulators.ui.enabled, false);
        assert.equal(generated.emulators.auth.port, ports.auth.port);
        assert.equal(generated.emulators.storage.port, ports.storage.port);
        assert.match(generated.database.rules, /database\.rules\.json$/);
    } finally {
        fs.rmSync(filename, { force: true });
    }
});

test('Windows cleanup targets only the Firebase launcher bound to the exact scratch config', () => {
    const configPath = String.raw`C:\Users\Admin\.codex\worktrees\a08e\Cursor AI\.firebase-online-test.json`;
    const script = windowsFirebaseCleanupScript(configPath);
    assert.match(script, /GetFullPath/);
    assert.match(script, /firebase\.js/);
    assert.match(script, /emulators:start/);
    assert.match(script, /\.Contains\(\$config/);
    assert.match(script, /taskkill/);
    assert.match(script, /\/T/);
    assert.match(script, /\/F/);
    assert.ok(script.includes(configPath));
});

test('browser failures are captured as handled outcomes while the runner waits for failover', async () => {
    const failure = new Error('browser failed before failover');
    const outcome = await settleOutcome(Promise.reject(failure));
    assert.equal(outcome.ok, false);
    assert.equal(outcome.error, failure);
});
