/**
 * syncProgressionUnlocks - Backfill progression unlocks from stored branch XP.
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const {
    deriveCoreProgressionUnlocks,
    applyProgressionUnlockWrites
} = require('./skillEconomy');

const syncProgressionUnlocks = onCall({ maxInstances: 10 }, async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const uid = request.auth.uid;
    const db = getFirestore();
    const userRef = db.collection('users').doc(uid);

    try {
        const result = await db.runTransaction(async (transaction) => {
            const userDoc = await transaction.get(userRef);
            if (!userDoc.exists) {
                throw new HttpsError('not-found', 'User profile not found');
            }

            const userData = userDoc.data() || {};
            const newUnlocks = deriveCoreProgressionUnlocks(userData);

            if (newUnlocks.length > 0) {
                applyProgressionUnlockWrites(transaction, userRef, newUnlocks);
            } else {
                transaction.update(userRef, {
                    progressionVersion: 1,
                    progressionSyncedAt: FieldValue.serverTimestamp(),
                    skillsUpdatedAt: FieldValue.serverTimestamp()
                });
            }

            return {
                success: true,
                progressionVersion: 1,
                grantedSkillIds: newUnlocks.map((unlock) => unlock.id),
                newUnlocks
            };
        });

        return result;
    } catch (error) {
        if (error instanceof HttpsError) throw error;
        console.error('syncProgressionUnlocks error:', error);
        throw new HttpsError('internal', error.message || 'Failed to sync progression unlocks');
    }
});

module.exports = { syncProgressionUnlocks };
