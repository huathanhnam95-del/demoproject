const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('emulator integration is explicitly local-only and has fail-closed database rules', () => {
    const config = JSON.parse(fs.readFileSync('firebase.json', 'utf8'));
    const rules = JSON.parse(fs.readFileSync('database.rules.json', 'utf8'));
    assert.equal(config.emulators.database.port, 9000);
    assert.equal(config.database.rules, 'database.rules.json');
    assert.equal(rules.rules['.write'], false);
    assert.match(process.env.FIREBASE_AUTH_EMULATOR_HOST || 'emulator-not-selected', /emulator|localhost|127\.0\.0\.1/);
});
