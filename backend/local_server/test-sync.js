const admin = require('firebase-admin');

// We need to simulate the FIRESTORE_EMULATOR_HOST being set
process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = 'localhost:9099';
process.env.FIREBASE_STORAGE_EMULATOR_HOST = 'localhost:9199';

// 1. Initialize default app (emulator)
const { resolveServiceAccountPath } = require('../../src/utils/service-account-path');
const saPath = resolveServiceAccountPath(process.cwd());
const sa = require(saPath);

admin.initializeApp({
  credential: admin.credential.cert(sa)
});
const localDb = admin.firestore();

// 2. Initialize prod app
const { getProdDb } = require('../../src/utils/prod-firestore');
const prodDb = getProdDb();

async function testSync() {
  console.log('Testing connection to Prod DB (fetching crmCourses limit 2)...');
  const prodSnapshot = await prodDb.collection('crmCourses').limit(2).get();
  console.log(`Successfully fetched ${prodSnapshot.size} courses from production.`);

  console.log('Writing to Local DB (emulator)...');
  const batch = localDb.batch();
  prodSnapshot.docs.forEach((doc) => {
    const localRef = localDb.collection('crmCourses').doc(doc.id);
    batch.set(localRef, doc.data(), { merge: true });
  });
  await batch.commit();
  console.log('Successfully wrote to emulator.');

  console.log('Verifying in Local DB...');
  const verifySnapshot = await localDb.collection('crmCourses').limit(2).get();
  console.log(`Successfully fetched ${verifySnapshot.size} courses from emulator.`);
  verifySnapshot.docs.forEach((doc) => {
      console.log(` - Emulator Course: ${doc.id}`);
  });

  console.log('Test successful! No syntax or connection errors.');
  process.exit(0);
}

testSync().catch((e) => {
    console.error('Test Failed:', e);
    process.exit(1);
});
