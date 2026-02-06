/**
 * purchaseItem - Server-Authoritative Purchase Function
 * 
 * Handles all coin deductions and feature unlocks atomically.
 * Prevents client-side manipulation of balance or unlock flags.
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

// Shop item definitions (canonical source)
const SHOP_ITEMS = {
    'vocabularyBook': {
        cost: 100,
        unlockField: 'vocabularyBookUnlocked',
        timestampField: 'vocabularyBookUnlockedAt',
        name: 'Vocabulary Book'
    },
    'sentenceLengthFilter': {
        cost: 50,
        unlockField: 'sentenceLengthFilterUnlocked',
        name: 'Sentence Length Filter'
    },
    // Add more items as needed
};

/**
 * Purchase an item from the shop
 * 
 * @param {object} data - {
 *   itemId: string   // Key from SHOP_ITEMS
 * }
 */
const purchaseItem = onCall({ maxInstances: 10 }, async (request) => {
    // 1. Authentication check
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const uid = request.auth.uid;
    const { itemId } = request.data;

    // 2. Validate item
    if (!itemId || !SHOP_ITEMS[itemId]) {
        throw new HttpsError('invalid-argument', `Invalid item: ${itemId}`);
    }

    const item = SHOP_ITEMS[itemId];
    const purchaseId = `purchase_${itemId}_${Date.now()}`;

    const db = getFirestore();
    const userRef = db.collection('users').doc(uid);
    const purchaseRef = userRef.collection('purchases').doc(purchaseId);

    try {
        const result = await db.runTransaction(async (transaction) => {
            // 3. Get current user data
            const userDoc = await transaction.get(userRef);
            if (!userDoc.exists) {
                throw new HttpsError('not-found', 'User profile not found');
            }

            const userData = userDoc.data();
            const currentCoins = userData.coins || 0;

            // 4. Check if already unlocked
            if (userData[item.unlockField] === true) {
                return {
                    success: false,
                    error: 'already_unlocked',
                    message: `${item.name} is already unlocked`
                };
            }

            // 5. Check balance
            if (currentCoins < item.cost) {
                return {
                    success: false,
                    error: 'insufficient_funds',
                    message: `Not enough coins. Need ${item.cost}, have ${currentCoins}`,
                    required: item.cost,
                    current: currentCoins
                };
            }

            // 6. Prepare update
            const userUpdate = {
                coins: currentCoins - item.cost,
                [item.unlockField]: true
            };

            // Add timestamp if defined
            if (item.timestampField) {
                userUpdate[item.timestampField] = FieldValue.serverTimestamp();
            }

            // 7. Prepare purchase record
            const purchaseRecord = {
                itemId: itemId,
                itemName: item.name,
                cost: item.cost,
                previousBalance: currentCoins,
                newBalance: currentCoins - item.cost,
                createdAt: FieldValue.serverTimestamp()
            };

            // 8. Execute writes
            transaction.update(userRef, userUpdate);
            transaction.set(purchaseRef, purchaseRecord);

            return {
                success: true,
                itemId: itemId,
                itemName: item.name,
                cost: item.cost,
                newBalance: currentCoins - item.cost
            };
        });

        return result;

    } catch (error) {
        console.error('purchaseItem error:', error);
        throw new HttpsError('internal', error.message);
    }
});

module.exports = { purchaseItem, SHOP_ITEMS };
