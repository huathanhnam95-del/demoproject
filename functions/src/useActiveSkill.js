/**
 * useActiveSkill - Server-authoritative coin spending + assist ledger recording.
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const {
    ACTIVE_SKILLS,
    isActiveSkill,
    isModeAllowedForSkill,
    isRetiredSkill
} = require('./skillCatalog');
const {
    hasUnlockedSkill,
    computeAttemptCalibMult
} = require('./skillEconomy');

async function resolveDifficultyMultiplier(transaction, db, mode, contentId) {
    // Mode-specific canonical difficulty resolution mirrors submitAttempt scoring.
    if (mode === 'watch') {
        const parts = String(contentId || '').split('::');
        if (parts.length >= 2) {
            const videoId = parts[0];
            const questionId = parts.slice(1).join('::');
            const questionRef = db.collection('watchVideos').doc(videoId)
                .collection('questions').doc(questionId);
            const questionDoc = await transaction.get(questionRef);
            if (questionDoc.exists) {
                const question = questionDoc.data();
                return question?.questionType === 'open_ended' ? 1.0 : 1.5;
            }
        }
        return 1.5;
    }

    if (mode === 'notes') {
        const docId = String(contentId || '').startsWith('notes_')
            ? String(contentId)
            : `notes_${contentId}`;
        const contentRef = db.collection('contentItems').doc(docId);
        const contentDoc = await transaction.get(contentRef);
        if (contentDoc.exists) {
            return Number(contentDoc.data()?.difficultyMultiplier) || 1.5;
        }
        return 1.0;
    }

    if (mode === 'type' || mode === 'speak' || mode === 'extended' || mode === 'rfib' || mode === 'writingChallenge') {
        const docId = String(contentId || '').startsWith(`${mode}_`)
            ? String(contentId)
            : `${mode}_${contentId}`;
        const contentRef = db.collection('contentItems').doc(docId);
        const contentDoc = await transaction.get(contentRef);
        if (contentDoc.exists) {
            return Number(contentDoc.data()?.difficultyMultiplier) || 1.5;
        }
        return 1.5;
    }

    // srs and other fallback modes
    return 1.5;
}

const useActiveSkill = onCall({ maxInstances: 20 }, async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const uid = request.auth.uid;
    const {
        attemptId,
        mode,
        contentId,
        skillId
    } = request.data || {};

    if (!attemptId || typeof attemptId !== 'string' || attemptId.length < 10) {
        throw new HttpsError('invalid-argument', 'Valid attemptId is required');
    }
    if (!mode || typeof mode !== 'string') {
        throw new HttpsError('invalid-argument', 'Valid mode is required');
    }
    if (!contentId || typeof contentId !== 'string') {
        throw new HttpsError('invalid-argument', 'Valid contentId is required');
    }
    if (!skillId || typeof skillId !== 'string') {
        throw new HttpsError('invalid-argument', 'Valid skillId is required');
    }
    if (!isActiveSkill(skillId)) {
        throw new HttpsError('invalid-argument', `Skill is not an active skill: ${skillId}`);
    }
    if (isRetiredSkill(skillId)) {
        return {
            success: false,
            error: 'skill_retired',
            message: 'Skill has been retired and is no longer available',
            skillId
        };
    }
    if (!isModeAllowedForSkill(skillId, mode)) {
        throw new HttpsError('failed-precondition', `Skill ${skillId} is not allowed in mode ${mode}`);
    }

    const db = getFirestore();
    const userRef = db.collection('users').doc(uid);
    const ledgerRef = userRef.collection('assistLedger').doc(attemptId);

    try {
        const result = await db.runTransaction(async (transaction) => {
            const [userDoc, ledgerDoc] = await Promise.all([
                transaction.get(userRef),
                transaction.get(ledgerRef)
            ]);

            if (!userDoc.exists) {
                throw new HttpsError('not-found', 'User profile not found');
            }

            const userData = userDoc.data();
            const skill = ACTIVE_SKILLS[skillId];
            const unlocked = hasUnlockedSkill(userData, skillId, { useStarterFallbackForActive: false });
            if (!unlocked) {
                return {
                    success: false,
                    error: 'skill_locked',
                    message: 'Skill is locked. Keep practicing to unlock it.',
                    skillId
                };
            }

            const existingLedger = ledgerDoc.exists ? ledgerDoc.data() : {};
            if (ledgerDoc.exists) {
                const existingMode = existingLedger.mode;
                const existingContentId = existingLedger.contentId;
                if (existingMode !== mode || String(existingContentId) !== String(contentId)) {
                    throw new HttpsError(
                        'failed-precondition',
                        'Attempt context mismatch for assist ledger'
                    );
                }
            }

            const skillsUsed = Array.isArray(existingLedger.skillsUsed)
                ? [...existingLedger.skillsUsed]
                : [];
            const priorChargedUses = skillsUsed.filter(
                (entry) => entry.skillId === skillId && entry.charged === true
            ).length;
            const effectiveDiff = skill.flatCost
                ? 1.0
                : Number(await resolveDifficultyMultiplier(transaction, db, mode, contentId)) || 1.0;
            const rawCost = 0;
            const finalCost = 0;
            const discountPct = 0;
            const discountBreakdown = [];

            const event = {
                skillId,
                tier: skill.tier,
                calibMult: Number(skill.calibMult) || 1.0,
                charged: false,
                cost: finalCost,
                rawCost,
                discountPct: Number(discountPct.toFixed(4)),
                difficultyMult: Number(effectiveDiff.toFixed(3)),
                costPolicy: skill.costPolicy,
                usedAtMs: Date.now()
            };
            skillsUsed.push(event);

            const totalCost = Number(existingLedger.totalCost) || 0;
            const attemptCalibMult = computeAttemptCalibMult(skillsUsed);

            transaction.update(userRef, {
                skillsUpdatedAt: FieldValue.serverTimestamp()
            });

            transaction.set(ledgerRef, {
                attemptId,
                mode,
                contentId,
                uid,
                skillsUsed,
                totalCost,
                attemptCalibMult,
                createdAt: existingLedger.createdAt || FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp()
            }, { merge: true });

            return {
                success: true,
                skillId,
                charged: false,
                cost: finalCost,
                rawCost,
                difficultyMult: effectiveDiff,
                discountPct,
                discountBreakdown,
                newBalance: 0,
                attemptCalibMult,
                totalCost
            };
        });

        return result;
    } catch (error) {
        if (error instanceof HttpsError) throw error;
        console.error('useActiveSkill error:', error);
        throw new HttpsError('internal', error.message || 'Failed to use active skill');
    }
});

module.exports = { useActiveSkill };
