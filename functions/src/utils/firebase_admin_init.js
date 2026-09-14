const admin = require('firebase-admin');
const { getApps, initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { getStorage } = require('firebase-admin/storage');
const { getDatabase } = require('firebase-admin/database');

if (!getApps().length) {
    const databaseURL = String(process.env.FIREBASE_DATABASE_URL || '').trim();
    const projectId = String(process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || '').trim();
    initializeApp(databaseURL || projectId ? { ...(databaseURL ? { databaseURL } : {}), ...(projectId ? { projectId } : {}) } : undefined);
}

async function getStorageBucket() {
    return getStorage().bucket();
}

module.exports = {
    admin,
    db: getFirestore(),
    getAuth,
    getDatabase,
    getStorageBucket
};
