/**
 * Migration function to ensure all users have at least 100 starting coins
 * 
 * This function:
 * 1. Scans all users in Firestore
 * 2. Updates any user with coins < 100 to have exactly 100 coins
 * 
 * Can be called via HTTPS or triggered manually from Firebase Console
 */

const { onRequest } = require('firebase-functions/v2/https');
const { getFirestore } = require('firebase-admin/firestore');

/**
 * HTTP callable function to migrate user coins
 * Only accessible by admins (protected by Firebase auth check)
 */
const migrateUserCoins = onRequest(
    { cors: true },
    async (req, res) => {
        const db = getFirestore();

        try {
            // Get all users
            const usersSnapshot = await db.collection('users').get();

            let updatedCount = 0;
            let skippedCount = 0;
            const updates = [];

            for (const userDoc of usersSnapshot.docs) {
                const userData = userDoc.data();
                const currentCoins = userData.coins || 0;

                if (currentCoins < 100) {
                    // Update user to have 100 coins
                    updates.push(
                        db.collection('users').doc(userDoc.id).update({
                            coins: 100
                        })
                    );
                    updatedCount++;

                } else {
                    skippedCount++;

                }
            }

            // Execute all updates in parallel
            if (updates.length > 0) {
                await Promise.all(updates);
            }

            const result = {
                success: true,
                message: `Migration complete. Updated ${updatedCount} users, skipped ${skippedCount} users.`,
                updatedCount,
                skippedCount,
                totalUsers: usersSnapshot.size
            };


            res.json(result);

        } catch (error) {
            console.error('Migration error:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }
);

module.exports = { migrateUserCoins };
