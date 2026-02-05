const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

let db = null;

try {
    const serviceAccountPath = path.join(process.cwd(), 'serviceAccountKey.json');
    if (fs.existsSync(serviceAccountPath)) {
        const serviceAccount = require(serviceAccountPath);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        db = admin.firestore();
        console.log('[SECURE] Firebase Admin initialized.');
    } else {
        console.warn('[WARN] serviceAccountKey.json not found.');
    }
} catch (e) {
    console.warn('[WARN] Firebase Admin initialization failed:', e.message);
}

module.exports = { admin, db };
