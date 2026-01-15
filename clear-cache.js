const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// Path to service account key
const keyPath = path.join(__dirname, 'serviceAccountKey.json');

if (!fs.existsSync(keyPath)) {
    console.error(`Error: Service account key not found at ${keyPath}`);
    process.exit(1);
}

const serviceAccount = require(keyPath);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function clearWordCache(word) {
    const normalizedWord = word.toLowerCase().trim();
    // From config.js: wordReferencesCollection: 'word_references'
    const collectionName = 'word_references';

    console.log(`Checking for '${normalizedWord}' in '${collectionName}'...`);
    const docRef = db.collection(collectionName).doc(normalizedWord);
    const doc = await docRef.get();

    if (doc.exists) {
        console.log(`Deleting document...`);
        await docRef.delete();
        console.log(`Successfully deleted '${normalizedWord}' from Firestore.`);
    } else {
        console.log(`Word '${normalizedWord}' not found in collection '${collectionName}'.`);
    }
}

clearWordCache('anonymous')
    .then(() => process.exit(0))
    .catch(err => {
        console.error('Error clearing cache:', err);
        process.exit(1);
    });
