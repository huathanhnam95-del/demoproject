/**
 * purchaseItem - Server-Authoritative Purchase Function
 * 
 * Handles all coin deductions and feature unlocks atomically.
 * Prevents client-side manipulation of balance or unlock flags.
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const CORE_ALWAYS_UNLOCKED_MODES = new Set(['type', 'speak', 'extended', 'watch', 'notes', 'pronounce']);

// Shop item definitions (canonical source)
const SHOP_ITEMS = {
    // Legacy / Existing Modes
    'speak': { cost: 50, unlocksMode: 'speak', name: 'Speak Mode' },
    'extended': { cost: 50, unlocksMode: 'extended', name: 'Fill in the Blank' },
    'watch': { cost: 50, unlocksMode: 'watch', name: 'Watch Mode' },
    'notes': { cost: 50, unlocksMode: 'notes', name: 'Notes Mode' },
    'pronounce': { cost: 50, unlocksMode: 'pronounce', name: 'Pronunciation Analyzer' },
    'lengthFilter': { cost: 20, unlocksMode: 'lengthFilter', name: 'Length Filter', unlockField: 'lengthFilterUnlocked' },
    'difficultyFilter': { cost: 30, unlocksMode: 'difficultyFilter', name: 'Difficulty Filter' },
    'vocabBook': {
        cost: 30,
        unlocksMode: 'vocabBook',
        name: 'Vocab Book',
        unlockField: 'vocabularyBookUnlocked'
    },
    'autoAdjust': { cost: 100, unlocksMode: 'autoAdjust', name: 'Smart Difficulty', unlockField: 'smartDifficultyUnlocked' },
    'survival': { cost: 100, unlocksMode: 'survival', name: 'Survival Mode' },

    // New Level System Items
    'hintLadder': { cost: 25, unlockField: 'hintLadderUnlocked', name: 'Hint Ladder' },
    'slowAudio': { cost: 30, unlockField: 'slowAudioUnlocked', name: 'Slow Audio' },
    'replayTrainer': { cost: 25, unlockField: 'replayTrainerUnlocked', name: 'Replay Trainer' },
    'chunkingMode': { cost: 40, unlockField: 'chunkingModeUnlocked', name: 'Chunking Mode' },
    'focusWords': { cost: 20, unlockField: 'focusWordsUnlocked', name: 'Focus Words' },
    'shadowingMode': { cost: 60, unlockField: 'shadowingModeUnlocked', name: 'Shadowing Mode' },
    'phonemeCoach': { cost: 70, unlockField: 'phonemeCoachUnlocked', name: 'Phoneme Coach' },
    'collocationBooster': { cost: 40, unlockField: 'collocationBoosterUnlocked', name: 'Collocation Booster' },
    'fsrsScheduler': { cost: 80, unlockField: 'fsrsSchedulerUnlocked', name: 'FSRS Scheduler' },
    'writingChallenges': { cost: 60, unlockField: 'writingChallengesUnlocked', name: 'Writing Challenges' },
    'prosodyCoach': { cost: 80, unlockField: 'prosodyCoachUnlocked', name: 'Prosody Coach' },
    'customImport': { cost: 100, unlockField: 'customImportUnlocked', name: 'Custom Import' }
};

const DEPRECATED_ITEM_MESSAGES = {
    lengthFilter: 'Length Filter is now unlocked via the Skill Tree (passive skill: Length Filter).',
    difficultyFilter: 'Difficulty Filter is now unlocked via the Skill Tree (passive skill: Difficulty Filter).',
    vocabBook: 'Vocabulary Book now unlocks automatically after missed keywords in Type or Speak mode.',
    survival: 'Survival Mode is now available by default.'
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

    if (DEPRECATED_ITEM_MESSAGES[itemId]) {
        return {
            success: false,
            error: 'deprecated',
            message: DEPRECATED_ITEM_MESSAGES[itemId]
        };
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
            const currentUnlockedModes = userData.unlockedModes || [];

            if (item.unlocksMode && CORE_ALWAYS_UNLOCKED_MODES.has(item.unlocksMode)) {
                return {
                    success: false,
                    error: 'already_unlocked',
                    message: `${item.name} is available by default`
                };
            }

            // 4. Check if already unlocked
            const isAlreadyUnlocked = (item.unlocksMode && currentUnlockedModes.includes(item.unlocksMode)) ||
                (item.unlockField && userData[item.unlockField] === true);

            if (isAlreadyUnlocked) {
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
                    message: `Not enough coins. Need ${item.cost}, have ${currentCoins}`
                };
            }

            // 6. Prepare update
            const userUpdate = {
                coins: currentCoins - item.cost
            };

            if (item.unlocksMode) {
                userUpdate.unlockedModes = FieldValue.arrayUnion(item.unlocksMode);
            }
            if (item.unlockField) {
                userUpdate[item.unlockField] = true;
            }
            if (item.timestampField) {
                userUpdate[item.timestampField] = FieldValue.serverTimestamp();
            }

            // 7. Prepare purchase record
            const purchaseRecord = {
                itemId: itemId,
                itemName: item.name,
                cost: item.cost,
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
