/**
 * Production Firestore Client (Read-Only)
 * ─────────────────────────────────────────
 * Creates a second firebase-admin app ('prod-readonly') that ALWAYS connects
 * to production Firestore, bypassing the FIRESTORE_EMULATOR_HOST env var.
 *
 * Usage:
 *   const { getProdDb } = require('../utils/prod-firestore');
 *   const prodDb = getProdDb();
 *   const snap = await prodDb.collection('crmStudents').get();
 */
const admin = require('firebase-admin');
const fs = require('fs');
const { resolveServiceAccountPath } = require('./service-account-path');

let prodDb = null;

/**
 * Returns a Firestore instance that talks to production, even when
 * FIRESTORE_EMULATOR_HOST is set.
 */
function getProdDb() {
    if (prodDb) return prodDb;

    const saPath = resolveServiceAccountPath(process.cwd());
    if (!saPath || !fs.existsSync(saPath)) {
        throw new Error(
            'Cannot create production Firestore client: service account key not found. '
            + 'Ensure serviceAccountKey.json is present in the project root.'
        );
    }

    const serviceAccount = require(saPath);

    const existingApp = admin.apps.find((app) => app && app.name === 'prod-readonly');
    const prodApp = existingApp || admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
    }, 'prod-readonly');

    prodDb = prodApp.firestore();

    if (!existingApp) {
        // Force production endpoint - this overrides FIRESTORE_EMULATOR_HOST
        // for this Firestore instance only.
        prodDb.settings({
            host: 'firestore.googleapis.com',
            ssl: true
        });
    }

    console.warn('[Prod-Firestore] Production-only Firestore client initialized (read-only by convention).');
    return prodDb;
}

module.exports = { getProdDb };
