/**
 * purchaseSkill - Compatibility stub for retired manual shop purchases.
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { isRetiredSkill, getProgressionUnlockById } = require('./skillCatalog');

const purchaseSkill = onCall({ maxInstances: 10 }, async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { skillId } = request.data || {};
    if (!skillId || typeof skillId !== 'string') {
        throw new HttpsError('invalid-argument', 'Valid skillId is required');
    }

    const progressionUnlock = getProgressionUnlockById(skillId);
    if (progressionUnlock) {
        return {
            success: false,
            error: 'deprecated_auto_unlock',
            message: 'Core features now unlock automatically through practice progression.',
            skillId,
            progressionUnlock
        };
    }

    if (isRetiredSkill(skillId)) {
        return {
            success: false,
            error: 'retired_skill_tree',
            message: 'This legacy skill is no longer part of the active progression system.',
            skillId
        };
    }

    return {
        success: false,
        error: 'retired_skill_tree',
        message: 'Manual skill purchases have been retired.',
        skillId
    };
});

module.exports = { purchaseSkill };
