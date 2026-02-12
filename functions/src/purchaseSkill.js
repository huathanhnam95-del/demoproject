/**
 * purchaseSkill - Buy active/passive RPG skills with core-skill level requirements.
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const {
    ALL_SKILLS,
    getSkillById,
    getTreeSkillLevelRequirement,
    getSkillCost,
    isPassiveSkill
} = require('./skillCatalog');
const { calculateCoreLevel, hasUnlockedSkill } = require('./skillEconomy');

const purchaseSkill = onCall({ maxInstances: 10 }, async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const uid = request.auth.uid;
    const { skillId } = request.data || {};

    if (!skillId || typeof skillId !== 'string') {
        throw new HttpsError('invalid-argument', 'Valid skillId is required');
    }

    if (!ALL_SKILLS[skillId]) {
        throw new HttpsError('invalid-argument', `Unknown skillId: ${skillId}`);
    }

    const db = getFirestore();
    const userRef = db.collection('users').doc(uid);
    const purchaseRef = userRef.collection('purchases').doc();

    try {
        const result = await db.runTransaction(async (transaction) => {
            const userDoc = await transaction.get(userRef);
            if (!userDoc.exists) {
                throw new HttpsError('not-found', 'User profile not found');
            }

            const userData = userDoc.data();
            const skill = getSkillById(skillId);
            const cost = getSkillCost(skillId);
            const requirement = getTreeSkillLevelRequirement(skillId);
            const currentCoins = Number(userData.coins) || 0;

            if (!skill || !Number.isFinite(cost) || cost <= 0) {
                throw new HttpsError('failed-precondition', 'Skill metadata is incomplete');
            }

            const alreadyUnlocked = hasUnlockedSkill(userData, skillId, { useStarterFallbackForActive: false });
            if (alreadyUnlocked) {
                return {
                    success: false,
                    error: 'already_unlocked',
                    message: 'Skill already unlocked',
                    skillId
                };
            }

            if (requirement?.tree && requirement?.level) {
                const skillPoints = userData.skillPoints || {};
                const treeXp = Number(skillPoints[requirement.tree]) || 0;
                const currentLevel = calculateCoreLevel(treeXp);
                if (currentLevel < requirement.level) {
                    return {
                        success: false,
                        error: 'level_requirement_not_met',
                        message: `Requires ${requirement.tree} level ${requirement.level}. Current: ${currentLevel}`,
                        requiredTree: requirement.tree,
                        requiredLevel: requirement.level,
                        currentLevel
                    };
                }
            }

            if (currentCoins < cost) {
                return {
                    success: false,
                    error: 'insufficient_funds',
                    message: `Not enough coins. Need ${cost}, have ${currentCoins}`,
                    required: cost,
                    current: currentCoins
                };
            }

            const userUpdate = {
                coins: currentCoins - cost,
                [`unlockedSkills.${skillId}`]: true,
                skillsUpdatedAt: FieldValue.serverTimestamp()
            };

            if (isPassiveSkill(skillId)) {
                userUpdate[`skillPassives.${skillId}`] = {
                    acquiredAt: FieldValue.serverTimestamp()
                };
            }

            transaction.update(userRef, userUpdate);
            transaction.set(purchaseRef, {
                type: 'skill',
                skillId,
                skillType: skill.type,
                skillName: skill.title || skill.id,
                tree: requirement?.tree || null,
                levelRequirement: requirement?.level || null,
                cost,
                createdAt: FieldValue.serverTimestamp()
            });

            return {
                success: true,
                skillId,
                skillType: skill.type,
                cost,
                newBalance: currentCoins - cost
            };
        });

        return result;
    } catch (error) {
        if (error instanceof HttpsError) throw error;
        console.error('purchaseSkill error:', error);
        throw new HttpsError('internal', error.message || 'Purchase failed');
    }
});

module.exports = { purchaseSkill };
