/**
 * submitAttempt - True Server-Authoritative Scoring Function (Phase 2.1)
 * 
 * All scoring is computed server-side from canonical content.
 * Client sends raw answers, not accuracy.
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const pointsLogic = require('./pointsLogic');

/**
 * Submit a practice attempt for scoring
 * 
 * @param {object} data - {
 *   attemptId: string,        // UUID for idempotency (client generates)
 *   mode: string,             // 'type', 'speak', 'extended', 'watch', 'notes'
 *   contentId: string,        // Content identifier
 *   payload: {                // Mode-specific raw answer
 *     text?: string,          // For type/speak/notes
 *     answers?: string[],     // For extended (one per gap)
 *     selectedIndex?: number  // For watch (MC option index)
 *   }
 * }
 */
const submitAttempt = onCall({ maxInstances: 10 }, async (request) => {
    // 1. Authentication check
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const uid = request.auth.uid;
    const { attemptId, mode, contentId, payload } = request.data;

    // 2. Input validation
    if (!attemptId || typeof attemptId !== 'string' || attemptId.length < 10) {
        throw new HttpsError('invalid-argument', 'Valid attemptId (UUID) is required');
    }

    if (!mode || !contentId) {
        throw new HttpsError('invalid-argument', 'Mode and contentId are required');
    }

    if (!pointsLogic.CONFIG.ALLOWED_MODES.includes(mode)) {
        throw new HttpsError('invalid-argument', `Invalid mode: ${mode}`);
    }

    if (!payload || typeof payload !== 'object') {
        throw new HttpsError('invalid-argument', 'Payload is required');
    }

    const db = getFirestore();
    const userRef = db.collection('users').doc(uid);
    const historyRef = userRef.collection('pointsHistory').doc(attemptId);

    try {
        const result = await db.runTransaction(async (transaction) => {
            // 3. Idempotency check using attemptId (UUID)
            const historyDoc = await transaction.get(historyRef);
            if (historyDoc.exists) {
                return {
                    success: true,
                    alreadyRecorded: true,
                    message: 'Attempt already recorded'
                };
            }

            // 4. Get current user data
            const userDoc = await transaction.get(userRef);
            if (!userDoc.exists) {
                throw new HttpsError('not-found', 'User profile not found');
            }

            const userData = userDoc.data();
            const currentRatings = userData.skillRatings || {
                listening: 0, writing: 0, reading: 0, speaking: 0
            };
            const srsBonus = userData.srsBonus || 0;

            // 5. Load canonical content and compute accuracy SERVER-SIDE
            let accuracy = 0;
            let difficulty = 1.5; // Default medium
            let scoringDetails = {};

            if (mode === 'watch') {
                const result = await scoreWatchMode(db, contentId, payload, transaction);
                accuracy = result.accuracy;
                difficulty = result.difficulty;
                scoringDetails = result.details;
            } else if (mode === 'notes') {
                const result = await scoreNotesMode(db, contentId, payload, transaction);
                accuracy = result.accuracy;
                difficulty = result.difficulty;
                scoringDetails = result.details;
            } else {
                const result = await scoreContentMode(db, mode, contentId, payload, transaction);
                accuracy = result.accuracy;
                difficulty = result.difficulty;
                scoringDetails = result.details;
            }

            // 5.5 Anti-farm ledger (server-side diminishing returns)
            const ledgerId = `${mode}__${contentId}`;
            const ledgerRef = userRef.collection('awardLedger').doc(ledgerId);
            const ledgerDoc = await transaction.get(ledgerRef);
            const ledger = ledgerDoc.exists ? ledgerDoc.data() : {};

            const today = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
            const dailyCount = (ledger.dailyDate === today) ? (ledger.dailyCount || 0) : 0;

            const { xpMult, ratingMult } = computeRepeatMults(dailyCount, mode);

            // 6. Calculate points (Track A)
            const { total: xpEarned, breakdown, meta } = pointsLogic.calculateActivityPoints(
                accuracy,
                difficulty,
                mode,
                xpMult
            );

            // 7. Calculate performance and update ratings (Track B)
            const performanceScore = pointsLogic.calculatePerformanceScore(difficulty, accuracy);
            const newRatings = pointsLogic.updateAllRatings(currentRatings, performanceScore, mode, ratingMult);

            // 8. Derive CEFR levels
            const cefrLevels = pointsLogic.deriveCefrLevels(newRatings, srsBonus);
            const overallRating = pointsLogic.calculateOverallRating(newRatings, srsBonus);

            // 9. Prepare user update (use FieldValue.increment where possible)
            const userUpdate = {
                // Track A: Lifetime XP (additive)
                'skillPoints.listening': FieldValue.increment(breakdown.listening || 0),
                'skillPoints.writing': FieldValue.increment(breakdown.writing || 0),
                'skillPoints.reading': FieldValue.increment(breakdown.reading || 0),
                'skillPoints.speaking': FieldValue.increment(breakdown.speaking || 0),
                totalPoints: FieldValue.increment(xpEarned),
                coins: FieldValue.increment(xpEarned),

                // Track B: Proficiency (overwrite with new EMA)
                'skillRatings.listening': newRatings.listening || 0,
                'skillRatings.writing': newRatings.writing || 0,
                'skillRatings.reading': newRatings.reading || 0,
                'skillRatings.speaking': newRatings.speaking || 0,
                'skillRatings.overall': overallRating,

                // CEFR Labels
                'cefrLevels.listening': cefrLevels.listening,
                'cefrLevels.writing': cefrLevels.writing,
                'cefrLevels.reading': cefrLevels.reading,
                'cefrLevels.speaking': cefrLevels.speaking,
                'cefrLevels.overall': cefrLevels.overall,

                skillsUpdatedAt: FieldValue.serverTimestamp()
            };

            // 10. Prepare history entry
            const historyEntry = {
                title: `${mode.charAt(0).toUpperCase() + mode.slice(1)} Practice`,
                description: `Completed ${contentId} on ${difficulty}x difficulty`,
                points: xpEarned,
                mode: mode,
                contentId: contentId,
                accuracy: accuracy,
                performanceScore: performanceScore,
                difficulty: difficulty,
                details: {
                    breakdown: breakdown,
                    newRatings: newRatings,
                    cefrLevels: cefrLevels,
                    scoring: scoringDetails,
                    antiFarm: { xpMult, ratingMult, dailyCountBefore: dailyCount }
                },
                createdAt: FieldValue.serverTimestamp()
            };

            // 11. Update ledger (only for meaningful attempts)
            const isMeaningful = accuracy > 0.1 || (payload?.text && payload.text.trim().length > 5);
            if (isMeaningful) {
                transaction.set(ledgerRef, {
                    dailyDate: today,
                    dailyCount: (ledger.dailyDate === today ? dailyCount : 0) + 1,
                    lifetimeCount: (ledger.lifetimeCount || 0) + 1,
                    lastAttemptAt: FieldValue.serverTimestamp()
                }, { merge: true });
            }

            // 12. Execute writes
            transaction.update(userRef, userUpdate);
            transaction.set(historyRef, historyEntry);

            return {
                success: true,
                xpEarned: xpEarned,
                accuracy: accuracy,
                difficulty: difficulty,
                newRatings: newRatings,
                cefrLevels: cefrLevels,
                antiFarm: { xpMult, ratingMult, dailyCount: dailyCount + 1 }
            };
        });

        return result;

    } catch (error) {
        console.error('submitAttempt error:', error);
        throw new HttpsError('internal', error.message);
    }
});

/**
 * Score Type/Speak/Extended modes using contentItems collection
 */
async function scoreContentMode(db, mode, contentId, payload, transaction) {
    // Build document ID based on mode prefix
    const docId = contentId.startsWith(`${mode}_`) ? contentId : `${mode}_${contentId}`;
    const contentRef = db.collection('contentItems').doc(docId);
    const contentDoc = await transaction.get(contentRef);

    if (!contentDoc.exists) {
        throw new HttpsError('not-found', `Content not found in Firestore: ${docId}`);
    }

    const content = contentDoc.data();
    const canonical = content.text || '';
    const difficulty = content.difficultyMultiplier || 1.5;

    if (mode === 'extended') {
        const userAnswers = payload.answers || [];
        const gaps = content.gaps || [];

        let correctCount = 0;
        const gapResults = [];

        const norm = s => (s || '').toLowerCase().trim();

        gaps.forEach((gap, idx) => {
            const userAnswer = norm(userAnswers[idx]);
            const correctAnswers = (gap.answers || []).map(norm);
            const isCorrect = correctAnswers.includes(userAnswer);

            if (isCorrect) correctCount++;
            gapResults.push({ index: idx, userAnswer, isCorrect });
        });

        const accuracy = gaps.length > 0 ? correctCount / gaps.length : 0;

        return {
            accuracy: accuracy,
            difficulty: difficulty,
            details: {
                gapResults: gapResults,
                correctCount: correctCount,
                totalGaps: gaps.length
            }
        };
    } else {
        // Type/Speak mode: compute F1 accuracy using LCS counts
        const userText = payload.text || '';
        const diff = pointsLogic.diffWords(canonical, userText);
        const accuracy = pointsLogic.calculateF1Accuracy(diff);

        return {
            accuracy: accuracy,
            difficulty: difficulty,
            details: {
                canonicalWordCount: diff.expectedLen,
                userWordCount: diff.actualLen,
                matchCount: diff.matches,
                missingCount: diff.missing,
                extraCount: diff.extra
            }
        };
    }
}

/**
 * Score Watch mode using watchVideos collection
 */
async function scoreWatchMode(db, contentId, payload, transaction) {
    // contentId format: "videoId::questionId"
    const parts = contentId.split('::');
    let videoId, questionId;

    if (parts.length >= 2) {
        videoId = parts[0];
        questionId = parts.slice(1).join('::');
    } else {
        console.warn('Watch contentId should be videoId_questionId format');
        return {
            accuracy: 0,
            difficulty: 1.5,
            details: { error: 'Invalid contentId format' }
        };
    }

    const questionRef = db.collection('watchVideos').doc(videoId)
        .collection('questions').doc(questionId);
    const keyRef = db.collection('watchVideos').doc(videoId)
        .collection('questionKeys').doc(questionId);

    const [qSnap, kSnap] = await Promise.all([
        transaction.get(questionRef),
        transaction.get(keyRef)
    ]);

    if (!qSnap.exists) {
        console.warn(`Question metadata not found: ${videoId}/${questionId}`);
        return {
            accuracy: 0,
            difficulty: 1.5,
            details: { warning: 'Question metadata not found' }
        };
    }

    const question = qSnap.data();

    if (question.questionType === 'multiple_choice') {
        if (!kSnap.exists) {
            console.error(`CRITICAL: Question key missing for MC question: ${videoId}/${questionId}`);
            throw new HttpsError('internal', 'Answer key missing for this question.');
        }

        const key = kSnap.data();
        const selectedIndex = parseInt(payload.selectedIndex, 10);

        // Validation: must be integer within range
        if (isNaN(selectedIndex) || selectedIndex < 0 || selectedIndex >= (question.options?.length || 4)) {
            return { accuracy: 0, difficulty: 1.5, details: { error: 'Invalid selectedIndex' } };
        }

        const isCorrect = selectedIndex === key.correctAnswer;
        return {
            accuracy: isCorrect ? 1.0 : 0.0,
            difficulty: 1.5,
            details: {
                questionType: 'multiple_choice',
                isCorrect: isCorrect
            }
        };
    } else {
        // Open-ended: "Attempt credit" with moderate accuracy
        const text = (payload.text || '').trim();
        const wordCount = text.split(/\s+/).filter(Boolean).length;

        // Requirement: at least 5 words for credit
        const attempted = wordCount >= 5;
        const accuracy = attempted ? 0.7 : 0.0;

        return {
            accuracy: accuracy,
            difficulty: 1.0, // Lower difficulty for open-ended
            details: {
                questionType: 'open_ended',
                wordCount: wordCount,
                attempted: attempted
            }
        };
    }
}

/**
 * Score Notes mode (effort-based with capped performance)
 */
async function scoreNotesMode(db, contentId, payload, transaction) {
    const docId = contentId.startsWith('notes_') ? contentId : `notes_${contentId}`;

    // Try contentItems first, then takeNotesEntries
    let canonical = '';
    let difficulty = 1.5;

    const contentRef = db.collection('contentItems').doc(docId);
    const contentDoc = await transaction.get(contentRef);

    if (contentDoc.exists) {
        const content = contentDoc.data();
        canonical = content.text || '';
        difficulty = content.difficultyMultiplier || 1.5;
    } else {
        // Fallback to takeNotesEntries
        const entryRef = db.collection('takeNotesEntries').doc(contentId);
        const entryDoc = await transaction.get(entryRef);

        if (entryDoc.exists) {
            canonical = entryDoc.data().transcript || '';
        }
    }

    const userText = payload.text || '';

    if (!canonical) {
        // No reference: award effort-based credit (moderate)
        const wordCount = userText.split(/\s+/).filter(w => w).length;
        const attempted = wordCount >= 10;
        const accuracy = attempted ? 0.6 : 0.0; // Moderate credit for effort

        return {
            accuracy: accuracy,
            difficulty: 1.0,
            details: {
                type: 'effort_based',
                userWordCount: wordCount,
                warning: 'Canonical content not found'
            }
        };
    }

    // Compare with canonical using word overlap
    const diffPieces = pointsLogic.diffWords(canonical, userText);
    const matchCount = diffPieces.filter(p => p.type === 'match').length;
    const canonicalWordCount = canonical.split(/\s+/).filter(w => w.length > 3).length;

    // Notes mode: capped performance score
    const rawAccuracy = canonicalWordCount > 0 ? matchCount / canonicalWordCount : 0;
    const cappedAccuracy = Math.min(0.7, rawAccuracy); // Cap at 70% for notes mode

    return {
        accuracy: cappedAccuracy,
        difficulty: difficulty,
        details: {
            type: 'word_overlap',
            matchCount: matchCount,
            canonicalWordCount: canonicalWordCount,
            userWordCount: userText.split(/\s+/).filter(w => w).length
        }
    };
}

/**
 * Compute repeat multipliers for anti-farm diminishing returns
 * 
 * @param {number} dailyCount - Number of successful attempts today
 * @param {string} mode - Mode for tuning (optional)
 * @returns {object} { xpMult, ratingMult }
 */
function computeRepeatMults(dailyCount, mode) {
    // Default Policy:
    // 1-3: 100% XP, 100% Rating
    // 4-6: 30% XP, 50% Rating
    // 7+: 0% XP, 20% Rating (proficiency still grows slowly)

    if (dailyCount < 3) return { xpMult: 1.0, ratingMult: 1.0 };
    if (dailyCount < 6) return { xpMult: 0.3, ratingMult: 0.5 };

    // Scale ratingMult further for easy-to-farm modes
    const ratingMult = (mode === 'watch' || mode === 'notes') ? 0.1 : 0.2;

    return { xpMult: 0.0, ratingMult: ratingMult };
}

module.exports = { submitAttempt };
