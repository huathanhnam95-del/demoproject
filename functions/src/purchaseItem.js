const { onCall, HttpsError } = require('firebase-functions/v2/https');
const LEGACY_PURCHASE_MESSAGES = {
    speak: 'Speak Mode now unlocks automatically through progression.',
    extended: 'Fill in the Blank now unlocks automatically through progression.',
    watch: 'Watch Mode now unlocks automatically through progression.',
    notes: 'Notes Mode now unlocks automatically through progression.',
    pronounce: 'Pronunciation Analyzer now unlocks automatically through progression.',
    lengthFilter: 'Length Filter now unlocks automatically through progression.',
    difficultyFilter: 'Difficulty Filter now unlocks automatically through progression.',
    vocabBook: 'Vocabulary Book now unlocks automatically through practice.',
    autoAdjust: 'Smart Difficulty is handled automatically by the progression system.',
    survival: 'Survival Mode is available by default.',
    hintLadder: 'Hint Ladder is retired in favor of automatic progression unlocks.',
    slowAudio: 'Slow Audio is now unlocked automatically through progression.',
    replayTrainer: 'Replay Trainer is now unlocked automatically through progression.',
    chunkingMode: 'Chunking Mode is now unlocked automatically through progression.',
    focusWords: 'Focus Words is now unlocked automatically through progression.',
    shadowingMode: 'Shadowing Mode is now unlocked automatically through progression.',
    phonemeCoach: 'Phoneme Coach is now unlocked automatically through progression.',
    collocationBooster: 'Collocation Booster is now unlocked automatically through progression.',
    fsrsScheduler: 'FSRS Scheduler is now unlocked automatically through progression.',
    writingChallenges: 'Writing Challenges is now unlocked automatically through progression.',
    prosodyCoach: 'Prosody Coach is now unlocked automatically through progression.',
    customImport: 'Custom Import is now unlocked automatically through progression.'
};

const purchaseItem = onCall({ maxInstances: 10 }, async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { itemId } = request.data || {};

    if (!itemId) {
        throw new HttpsError('invalid-argument', `Invalid item: ${itemId}`);
    }

    return {
        success: false,
        error: 'retired_purchase_flow',
        message: LEGACY_PURCHASE_MESSAGES[itemId] || 'Manual shop purchases have been retired.'
    };
});

module.exports = { purchaseItem };
