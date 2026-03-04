const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
require('dotenv').config(); // Load environment variables

// --- CONFIGURATION ---
// IMPORTANT: You must provide the path to your service account keys here.
// DO NOT commit the service account keys to version control.
const PROD_KEY_PATH = path.join(__dirname, '..', 'serviceAccountKey.json');
const STAGING_KEY_PATH = path.join(__dirname, '..', 'serviceAccountKey_staging.json');

// Define which collections to sync
const COLLECTIONS_TO_SYNC = [
    'users',
    'scores',
    'progress'
    // Add other collections here
];
// ---------------------

console.log('🔄 Init: Firebase Production to Staging Data Sync Script');

// 1. Verify Keys Exist
if (!fs.existsSync(PROD_KEY_PATH)) {
    console.error(`❌ Missing Production Key at ${PROD_KEY_PATH}`);
    process.exit(1);
}
if (!fs.existsSync(STAGING_KEY_PATH)) {
    console.error(`❌ Missing Staging Key at ${STAGING_KEY_PATH}\n(Generate this from the staging project in Firebase Console)`);
    process.exit(1);
}

// 2. Initialize Apps
const prodApp = admin.initializeApp({
    credential: admin.credential.cert(require(PROD_KEY_PATH)),
}, 'prod');

const stagingApp = admin.initializeApp({
    credential: admin.credential.cert(require(STAGING_KEY_PATH)),
}, 'staging');

const prodDb = prodApp.firestore();
const stagingDb = stagingApp.firestore();

// 3. Sync Logic
async function clearCollection(db, collectionPath) {
    const collectionRef = db.collection(collectionPath);
    const snapshot = await collectionRef.get();

    if (snapshot.size === 0) return 0;

    console.log(`🧹 Clearing ${snapshot.size} documents from [${collectionPath}] in Staging...`);

    // Firestore batching (max 500 per batch)
    const batches = [];
    let currentBatch = db.batch();
    let currentBatchSize = 0;

    snapshot.docs.forEach((doc) => {
        currentBatch.delete(doc.ref);
        currentBatchSize++;
        if (currentBatchSize === 500) {
            batches.push(currentBatch.commit());
            currentBatch = db.batch();
            currentBatchSize = 0;
        }
    });

    if (currentBatchSize > 0) {
        batches.push(currentBatch.commit());
    }

    await Promise.all(batches);
    return snapshot.size;
}

async function copyCollection(prodDb, stagingDb, collectionPath) {
    const prodSnapshot = await prodDb.collection(collectionPath).get();

    if (prodSnapshot.size === 0) {
        console.log(`ℹ️ Collection [${collectionPath}] is empty in Production.`);
        return 0;
    }

    console.log(`📥 Copying ${prodSnapshot.size} documents from [${collectionPath}] to Staging...`);

    const batches = [];
    let currentBatch = stagingDb.batch();
    let currentBatchSize = 0;

    prodSnapshot.docs.forEach((doc) => {
        const stagingRef = stagingDb.collection(collectionPath).doc(doc.id);
        currentBatch.set(stagingRef, doc.data());
        currentBatchSize++;

        if (currentBatchSize === 500) {
            batches.push(currentBatch.commit());
            currentBatch = stagingDb.batch();
            currentBatchSize = 0;
        }
    });

    if (currentBatchSize > 0) {
        batches.push(currentBatch.commit());
    }

    await Promise.all(batches);
    return prodSnapshot.size;
}

async function runSync() {
    console.log('\n🚀 --- STARTING SYNC PROCESS ---');
    try {
        for (const collection of COLLECTIONS_TO_SYNC) {
            console.log(`\n▶️ Processing Collection: [${collection}]`);
            await clearCollection(stagingDb, collection);
            await copyCollection(prodDb, stagingDb, collection);
            console.log(`✅ Finished processing [${collection}]`);
        }
        console.log('\n🎉 --- SYNC COMPLETE SUCCESSFULLY ---');
    } catch (err) {
        console.error('\n❌ --- SYNC FAILED ---');
        console.error(err);
    } finally {
        // Exit apps properly to avoid hanging processes
        await prodApp.delete();
        await stagingApp.delete();
        process.exit(0);
    }
}

// Ensure the user actually meant to run this (dry run warning might be nice, but this runs immediately)
runSync();
