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

module.exports = {
    submitAttempt,
    purchaseItem,
    purchaseSkill,
    useActiveSkill,
    migrateUserCoins,
    assessWriting
};
