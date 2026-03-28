/**
 * submitAttempt - True Server-Authoritative Scoring Function (Phase 2.1)
 * 
 * All scoring is computed server-side from canonical content.
 * Client sends raw answers, not accuracy.
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const pointsLogic = require('./pointsLogic');
const {
    computeAttemptCalibMult,
    deriveCoreProgressionUnlocks,
    applyProgressionUnlockWrites
} = require('./skillEconomy');

/**
 * Submit a practice attempt for scoring
 * 
 * @param {object} data - {
 *   attemptId: string,        // UUID for idempotency (client generates)
 *   mode: string,             // 'type', 'speak', 'extended', 'watch', 'notes', 'writingChallenge', 'srs'
 *   contentId: string,        // Content identifier
 *   payload: {                // Mode-specific raw answer
 *     text?: string,          // For type/speak/notes
 *     answers?: string[],     // For extended (one per gap) when canonical gaps exist
 *     correctCount?: number,  // For extended (client-verified gap counts)
 *     totalCount?: number,    // For extended (client-verified gap counts)
 *     selectedIndex?: number, // For watch (MC option index)
 *     accuracy?: number,      // For writingChallenge (AI/heuristic score 0..1)
 *     quality?: number        // For srs (0..5 self/auto rating)
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
    const assistRef = userRef.collection('assistLedger').doc(attemptId);

    try {
        const result = await db.runTransaction(async (transaction) => {
            // 3. Idempotency check using attemptId (UUID)
            const historyDoc = await transaction.get(historyRef);
            if (historyDoc.exists) {
                return {
                    success: true,
                    alreadyRecorded: true,
                    message: 'Attempt already recorded',
                    progressionVersion: 1,
                    newUnlocks: []
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
            const currentSkillPoints = userData.skillPoints || {
                listening: 0,
                writing: 0,
                reading: 0,
                speaking: 0
            };
            const srsBonus = userData.srsBonus || 0;
            const assistDoc = await transaction.get(assistRef);
            const assistData = assistDoc.exists ? assistDoc.data() : null;
            const assistCalibMult = assistData
                ? computeAttemptCalibMult(assistData.skillsUsed || [])
                : 1.0;

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
            const effectiveRatingMult = ratingMult * assistCalibMult;

            // 6. Calculate points (Track A)
            const { total: xpEarned, breakdown, meta } = pointsLogic.calculateActivityPoints(
                accuracy,
                difficulty,
                mode,
                xpMult
            );

            // 7. Calculate performance and update ratings (Track B)
            const performanceScore = pointsLogic.calculatePerformanceScore(difficulty, accuracy);
            const newRatings = pointsLogic.updateAllRatings(
                currentRatings,
                performanceScore,
                mode,
                effectiveRatingMult,
                { applyMultUpwardOnly: true }
            );

            // 8. Derive CEFR levels
            const cefrLevels = pointsLogic.deriveCefrLevels(newRatings, srsBonus);
            const overallRating = pointsLogic.calculateOverallRating(newRatings, srsBonus);

            const nextSkillPoints = {
                listening: (Number(currentSkillPoints.listening) || 0) + (breakdown.listening || 0),
                writing: (Number(currentSkillPoints.writing) || 0) + (breakdown.writing || 0),
                reading: (Number(currentSkillPoints.reading) || 0) + (breakdown.reading || 0),
                speaking: (Number(currentSkillPoints.speaking) || 0) + (breakdown.speaking || 0)
            };
            const newUnlocks = deriveCoreProgressionUnlocks({
                ...userData,
                skillPoints: nextSkillPoints
            });

            // 9. Prepare user update (use FieldValue.increment where possible)
            const userUpdate = {
                // Track A: Lifetime XP (additive)
                'skillPoints.listening': FieldValue.increment(breakdown.listening || 0),
                'skillPoints.writing': FieldValue.increment(breakdown.writing || 0),
                'skillPoints.reading': FieldValue.increment(breakdown.reading || 0),
                'skillPoints.speaking': FieldValue.increment(breakdown.speaking || 0),
                totalPoints: FieldValue.increment(xpEarned),

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

            if (newUnlocks.length > 0) {
                applyProgressionUnlockWrites(transaction, userRef, newUnlocks);
            } else {
                transaction.update(userRef, {
                    progressionVersion: 1,
                    progressionSyncedAt: FieldValue.serverTimestamp(),
                    skillsUpdatedAt: FieldValue.serverTimestamp()
                });
            }

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
                    antiFarm: {
                        xpMult,
                        ratingMult,
                        assistCalibMult,
                        effectiveRatingMult,
                        dailyCountBefore: dailyCount
                    },
                    progression: {
                        progressionVersion: 1,
                        newUnlocks: newUnlocks.map((unlock) => ({
                            id: unlock.id,
                            branch: unlock.branch,
                            title: unlock.title,
                            level: unlock.level,
                            xpThreshold: unlock.xpThreshold
                        }))
                    },
                    assist: {
                        used: !!assistData,
                        attemptCalibMult: assistCalibMult,
                        totalAssistCost: Number(assistData?.totalCost) || 0,
                        skillsUsed: Array.isArray(assistData?.skillsUsed)
                            ? assistData.skillsUsed.map((entry) => ({
                                skillId: entry.skillId,
                                tier: entry.tier,
                                cost: entry.cost,
                                charged: entry.charged
                            }))
                            : [],
                        rebateCoins: 0
                    }
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

            if (assistData) {
                transaction.set(assistRef, {
                    attemptCalibMult: assistCalibMult,
                    submittedAt: FieldValue.serverTimestamp()
                }, { merge: true });
            }

            // 11.5 Error Heatmap Infrastructure
            const wordErrors = scoringDetails.wordErrors;
            if (Array.isArray(wordErrors) && wordErrors.length > 0) {
                const heatmapRef = userRef.collection('errorHeatmap').doc(contentId);
                const heatmapUpdates = {
                    lastMissedAt: FieldValue.serverTimestamp()
                };

                // Aggregate counts per word to avoid duplicate field paths
                const errorFreq = {};
                wordErrors.forEach(w => {
                    const cleanWord = (w || '').slice(0, 50).replace(/[.#$[\]]/g, ''); // Firestore valid key limits
                    if (cleanWord) {
                        errorFreq[cleanWord] = (errorFreq[cleanWord] || 0) + 1;
                    }
                });

                Object.entries(errorFreq).forEach(([word, count]) => {
                    heatmapUpdates[`words.${word}`] = FieldValue.increment(count);
                });

                transaction.set(heatmapRef, heatmapUpdates, { merge: true });
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
                rebateCoins: 0,
                newUnlocks: newUnlocks.map((unlock) => ({
                    id: unlock.id,
                    branch: unlock.branch,
                    title: unlock.title,
                    level: unlock.level,
                    xpThreshold: unlock.xpThreshold,
                    roadmapOrder: unlock.roadmapOrder
                })),
                antiFarm: {
                    xpMult,
                    ratingMult,
                    assistCalibMult,
                    effectiveRatingMult,
                    dailyCount: dailyCount + 1
                },
                progressionVersion: 1
            };
        });

        return result;

    } catch (error) {
        console.error('submitAttempt error:', error);
        throw new HttpsError('internal', error.message);
    }
});

/**
 * Score Type/Speak/Extended/RFIB modes using contentItems collection
 */
async function scoreContentMode(db, mode, contentId, payload, transaction) {
    if (mode === 'srs') {
        return scoreSrsMode(payload);
    }

    if (mode === 'writingChallenge') {
        return scoreWritingChallengeMode(payload);
    }

    // Build document ID based on mode prefix
    const docId = contentId.startsWith(`${mode}_`) ? contentId : `${mode}_${contentId}`;
    const contentRef = db.collection('contentItems').doc(docId);
    const contentDoc = await transaction.get(contentRef);

    if (!contentDoc.exists) {
        if (mode === 'extended') {
            const fallback = scoreExtendedFromCounts(payload);
            if (fallback) {
                return {
                    ...fallback,
                    difficulty: 1.5,
                    details: {
                        ...fallback.details,
                        warning: 'Canonical content not found'
                    }
                };
            }
        }
        throw new HttpsError('not-found', `Content not found in Firestore: ${docId}`);
    }

    const content = contentDoc.data();
    const canonical = content.text || '';
    const difficulty = content.difficultyMultiplier || 1.5;

    if (mode === 'extended' || mode === 'rfib') {
        const gaps = content.gaps || [];
        const hasCanonicalGaps = Array.isArray(gaps) && gaps.length > 0;
        const hasAnswerArray = Array.isArray(payload.answers);
        const fallbackCounts = mode === 'extended' ? scoreExtendedFromCounts(payload) : null;

        // Prefer server-verifiable canonical scoring when we have canonical gaps + answer array.
        // Otherwise, fall back to client-verified counts (for dynamic/randomized gaps).
        if (hasCanonicalGaps && hasAnswerArray) {
            const userAnswers = payload.answers;
            let correctCount = 0;
            const gapResults = [];
            const wordErrors = [];

            const norm = s => (s || '').toLowerCase().trim();

            gaps.forEach((gap, idx) => {
                const userAnswer = norm(userAnswers[idx]);
                const correctAnswers = (gap.answers || []).map(norm);
                const isCorrect = correctAnswers.includes(userAnswer);

                if (isCorrect) {
                    correctCount++;
                } else if (correctAnswers.length > 0) {
                    wordErrors.push(correctAnswers[0]);
                }
                gapResults.push({ index: idx, userAnswer, isCorrect });
            });

            const accuracy = gaps.length > 0 ? correctCount / gaps.length : 0;

            return {
                accuracy: accuracy,
                difficulty: difficulty,
                details: {
                    type: 'canonical_gaps',
                    gapResults: gapResults,
                    correctCount: correctCount,
                    totalGaps: gaps.length,
                    wordErrors: wordErrors
                }
            };
        }

        if (fallbackCounts) {
            const details = { ...(fallbackCounts.details || {}) };
            if (hasCanonicalGaps) {
                details.note = 'Used client counts despite canonical gaps (no answers sent)';
            }
            return {
                ...fallbackCounts,
                difficulty: difficulty,
                details
            };
        }

        if (!hasCanonicalGaps) {
            return {
                accuracy: 0,
                difficulty: difficulty,
                details: {
                    type: 'missing_gaps',
                    warning: 'Canonical gaps not found and no client counts provided'
                }
            };
        }

        // Canonical gaps exist but the client did not send answers or counts.
        return {
            accuracy: 0,
            difficulty: difficulty,
            details: {
                type: 'missing_payload',
                warning: 'Canonical gaps exist but no answers/correctCount were provided'
            }
        };
    } else {
        // Type/Speak mode: compute F1 accuracy using LCS counts
        const userText = payload.text || '';
        const diff = pointsLogic.diffWords(canonical, userText);
        const accuracy = pointsLogic.calculateF1Accuracy(diff);

        // Heatmap Error Extraction
        const expWords = pointsLogic.tokenize(canonical);
        const actWords = pointsLogic.tokenize(userText);
        const actCounts = {};
        actWords.forEach(w => actCounts[w] = (actCounts[w] || 0) + 1);
        const wordErrors = [];
        expWords.forEach(w => {
            if (actCounts[w] && actCounts[w] > 0) {
                actCounts[w]--;
            } else {
                wordErrors.push(w);
            }
        });

        return {
            accuracy: accuracy,
            difficulty: difficulty,
            details: {
                canonicalWordCount: diff.expectedLen,
                userWordCount: diff.actualLen,
                matchCount: diff.matches,
                missingCount: diff.missing,
                extraCount: diff.extra,
                wordErrors: wordErrors
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

    // Compare with canonical using LCS match counts (word-level)
    const diff = pointsLogic.diffWords(canonical, userText);
    const matchCount = diff.matches;
    const canonicalWordCount = diff.expectedLen;

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

function scoreExtendedFromCounts(payload) {
    const rawCorrect = payload?.correctCount;
    const rawTotal = payload?.totalCount;

    const correctCount = Number(rawCorrect);
    const totalCount = Number(rawTotal);

    if (!Number.isFinite(correctCount) || !Number.isFinite(totalCount)) return null;
    if (totalCount <= 0) return null;

    const safeTotal = Math.max(1, Math.min(50, Math.floor(totalCount)));
    const safeCorrect = Math.max(0, Math.min(safeTotal, Math.floor(correctCount)));

    return {
        accuracy: safeCorrect / safeTotal,
        difficulty: 1.5,
        details: {
            type: 'client_counts',
            correctCount: safeCorrect,
            totalCount: safeTotal
        }
    };
}

function scoreWritingChallengeMode(payload) {
    const rawAccuracy = payload?.accuracy;
    const asNumber = Number(rawAccuracy);

    if (Number.isFinite(asNumber)) {
        const accuracy = Math.max(0, Math.min(1, asNumber));
        return {
            accuracy,
            difficulty: 2.0,
            details: {
                type: 'client_accuracy',
                accuracy
            }
        };
    }

    // Fallback: effort-based credit from text length
    const text = String(payload?.text || '').trim();
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    const attempted = wordCount >= 8;

    return {
        accuracy: attempted ? 0.6 : 0.0,
        difficulty: 2.0,
        details: {
            type: 'effort_based',
            wordCount,
            attempted
        }
    };
}

function scoreSrsMode(payload) {
    const raw = payload?.quality;
    const q = Number(raw);
    const quality = Number.isFinite(q) ? Math.max(0, Math.min(5, Math.round(q))) : null;

    if (quality === null) {
        return {
            accuracy: 0,
            difficulty: 1.0,
            details: {
                type: 'invalid_quality',
                rawQuality: raw
            }
        };
    }

    const QUALITY_TO_ACCURACY = {
        0: 0.0,
        1: 0.2,
        2: 0.5,
        3: 0.7,
        4: 0.85,
        5: 1.0
    };

    const accuracy = QUALITY_TO_ACCURACY[quality] ?? 0.0;
    return {
        accuracy,
        difficulty: 1.0,
        details: {
            type: 'quality_map_v1',
            quality,
            accuracy
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
