'use strict';

const assert = require('assert');
const crypto = require('crypto');
const {
    getEmulatorConfig
} = require('../../../scripts/crm/projects/emulator-config');
const {
    FIXTURE_COLLECTION,
    FIXTURE_VERSION,
    initializeFixtureApp,
    seedFixtures,
    verifyFixtureRoundTrip
} = require('../../../scripts/crm/projects/seed-fixtures');

async function main() {
    assert.strictEqual(process.env.CRM_PROJECTS_EMULATOR_READY, '1', 'Phase0 requires the isolated emulator runner.');
    const config = getEmulatorConfig(process.env);
    const app = initializeFixtureApp(config);
    try {
        await seedFixtures({ config, app });
        const verified = await verifyFixtureRoundTrip({ config, app });
        assert.strictEqual(verified.fixtureVersion, FIXTURE_VERSION);
        assert.strictEqual(verified.users.length, 7);

        const db = app.firestore();
        const roundTripId = `roundtrip-${crypto.randomBytes(8).toString('hex')}`;
        const payload = { fixtureVersion: FIXTURE_VERSION, roundTripId, persisted: true };
        await db.collection(FIXTURE_COLLECTION).doc(roundTripId).set(payload);
        const snapshot = await db.collection(FIXTURE_COLLECTION).doc(roundTripId).get();
        assert.deepStrictEqual(snapshot.data(), payload, 'Firestore data must survive a real write/read round trip.');
        await db.collection(FIXTURE_COLLECTION).doc(roundTripId).delete();
        const bucket = app.storage().bucket(`${process.env.GCLOUD_PROJECT}.appspot.com`);
        const storagePath = `phase0/${roundTripId}.txt`;
        const bytes = Buffer.from(`storage-roundtrip:${roundTripId}`, 'utf8');
        await bucket.file(storagePath).save(bytes, { resumable: false, metadata: { contentType: 'text/plain' } });
        const [storedBytes] = await bucket.file(storagePath).download();
        assert.deepStrictEqual(storedBytes, bytes, 'Storage bytes must survive a real write/read round trip.');
        await bucket.file(storagePath).delete();
        process.stdout.write('crm projects isolated Auth + Firestore + Storage seed and roundtrip passed\n');
    } finally {
        await app.delete();
    }
}

main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
});
