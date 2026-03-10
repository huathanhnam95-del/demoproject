/**
 * Cloud Functions Entry Point
 * 
 * Exports all callable functions for server-authoritative scoring.
 */

const { initializeApp } = require('firebase-admin/app');

// Initialize Firebase Admin SDK
initializeApp();

// Export callable functions
const { submitAttempt } = require('./submitAttempt');
const { purchaseItem } = require('./purchaseItem');
const { purchaseSkill } = require('./purchaseSkill');
const { useActiveSkill } = require('./useActiveSkill');
const { migrateUserCoins } = require('./migrateCoins');
const { assessWriting } = require('./assessWriting');

const { onRequest } = require('firebase-functions/v2/https');
const apiApp = require('./apiApp');
const { onUserSignUp } = require('./studentIdentity');

module.exports = {
    submitAttempt,
    purchaseItem,
    purchaseSkill,
    useActiveSkill,
    migrateUserCoins,
    assessWriting,
    api: onRequest({ region: 'us-central1' }, apiApp),
    onUserSignUp
};
