const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { safeEnvironment, temporaryFirebaseConfig } = require('../../scripts/bel-demo/start-online-emulators.cjs');

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
