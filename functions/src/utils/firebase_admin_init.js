const admin = require('firebase-admin');
const { getApps, initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { getStorage } = require('firebase-admin/storage');

if (!getApps().length) {
    initializeApp();
}

async function getStorageBucket() {
    return getStorage().bucket();
}

module.exports = {
    admin,
    db: getFirestore(),
    getAuth,
    getStorageBucket
};
