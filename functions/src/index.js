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
const { migrateUserCoins } = require('./migrateCoins');

module.exports = {
    submitAttempt,
    purchaseItem,
    migrateUserCoins
};
