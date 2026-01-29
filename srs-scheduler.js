import { fsrs, generatorParameters, createEmptyCard, Rating as FSRS_Rating, State as FSRS_State } from 'ts-fsrs';

/**
 * SRS Scheduler Module (Dual-Engine)
 * Provides both SM-2 (Standard) and FSRS (Advanced) scheduling algorithms.
 * 
 * Usage:
 *   import { SRSScheduler, ALGORITHM } from './srs-scheduler.js';
 *   const result = SRSScheduler.calculate(card, rating, ALGORITHM.SM2);
 */

// --- Constants ---
const ALGORITHM = Object.freeze({
    SM2: 'SM2',       // SuperMemo 2 - Classic Anki
    FSRS: 'FSRS'      // ts-fsrs Library (Approx. Anki FSRS v4.5+)
});

const CARD_STATE = Object.freeze({
    NEW: 'new',
    LEARNING: 'learning',
    REVIEWING: 'reviewing',
    RELEARNING: 'relearning',
    MASTERED: 'mastered'
});

const RATING = Object.freeze({
    AGAIN: 1,
    HARD: 2,
    GOOD: 3,
    EASY: 4
});

// --- SM-2 Configuration ---
const SM2_CONFIG = {
    DEFAULT_EASE_FACTOR: 2.5,     // Starting ease factor
    MIN_EASE_FACTOR: 1.3,         // Minimum ease factor (130%)
    HARD_MULTIPLIER: 1.2,         // Fixed multiplier for "Hard"
    EASY_BONUS: 1.3,              // Extra bonus for "Easy"
    LEARNING_STEPS: [1, 10],      // In minutes: 1 min, 10 min
    GRADUATING_INTERVAL: 1,       // Days after graduating from learning
    EASY_INTERVAL: 4,             // Days after pressing "Easy" on a new card
    MASTERY_THRESHOLD: 10,        // Repetitions to consider mastered
    MASTERY_INTERVAL: 21,         // Days interval to consider mastered
    INTERVAL_MODIFIER: 1.0,       // Global multiplier for all intervals (1.0 = 100%)
    LAPSE_NEW_INTERVAL: 0.0       // % of old interval to keep on lapse (0.0 = reset)
};

// --- FSRS Configuration (Powered by ts-fsrs) ---
const FSRS_PARAMS = generatorParameters({
    request_retention: 0.9,       // Target 90% recall
    maximum_interval: 36500,      // 100 years cap
    enable_fuzz: true,            // Enable fuzzing
    enable_short_term: true,      // Enable short-term scheduling
    w: [0.4, 0.9, 2.3, 10.9, 4.93, 0.94, 0.86, 0.01, 1.49, 0.14, 0.94, 2.18, 0.05, 0.34, 1.26, 0.29, 2.61]
});
const fsrsInstance = fsrs(FSRS_PARAMS);

// Export FSRS_CONFIG for external reference (read-only view of params)
const FSRS_CONFIG = {
    DESIRED_RETENTION: FSRS_PARAMS.request_retention,
    W: FSRS_PARAMS.w,
    FACTOR: 0.9, // Kept for backward compatibility if needed, though lib handles this
    DECAY: -0.5
};

// Helper: Validate and Sanitize Card Data
function validateCard(card) {
    if (!card || typeof card !== 'object') {
        throw new Error('Invalid card data: must be an object');
    }
    // Ensure essential numeric properties are valid numbers
    if (typeof card.interval !== 'number' || isNaN(card.interval)) card.interval = 0;
    if (typeof card.repetitions !== 'number' || isNaN(card.repetitions)) card.repetitions = 0;

    // Ensure state is valid
    const validStates = Object.values(CARD_STATE);
    if (!validStates.includes(card.state)) card.state = CARD_STATE.NEW;

    // Ensure dates are valid strings or null
    if (card.nextReviewDate && isNaN(new Date(card.nextReviewDate).getTime())) card.nextReviewDate = new Date().toISOString();

    return card;
}

// Helper: Add days to a date (Robust)
function addDays(date, days) {
    const start = new Date(date); // Clone or create
    if (isNaN(start.getTime())) return new Date(); // Fallback to now
    start.setDate(start.getDate() + days);
    return start;
}

// Helper: Add minutes to a date (Robust)
function addMinutes(date, minutes) {
    const start = new Date(date);
    if (isNaN(start.getTime())) return new Date();
    return new Date(start.getTime() + minutes * 60 * 1000);
}

// Helper: Map Local State to FSRS State
function mapToFSRSState(localState) {
    switch (localState) {
        case CARD_STATE.NEW: return FSRS_State.New;
        case CARD_STATE.LEARNING: return FSRS_State.Learning;
        case CARD_STATE.REVIEWING: return FSRS_State.Review;
        case CARD_STATE.RELEARNING: return FSRS_State.Relearning;
        case CARD_STATE.MASTERED: return FSRS_State.Review; // Treat mastered as reviewing for calc
        default: return FSRS_State.New;
    }
}

// Helper: Map FSRS State to Local State
function mapFromFSRSState(fsrsState) {
    switch (fsrsState) {
        case FSRS_State.New: return CARD_STATE.NEW;
        case FSRS_State.Learning: return CARD_STATE.LEARNING;
        case FSRS_State.Review: return CARD_STATE.REVIEWING;
        case FSRS_State.Relearning: return CARD_STATE.RELEARNING;
        default: return CARD_STATE.NEW;
    }
}

// --- SM-2 Algorithm ---
function calculateSM2(card, rating) {
    // Sanitize input internally
    const safeCard = validateCard({ ...card });

    let {
        interval = 0,
        easeFactor = SM2_CONFIG.DEFAULT_EASE_FACTOR,
        repetitions = 0,
        state = CARD_STATE.NEW,
        stepIndex = 0,
        lastReviewDate = null
    } = safeCard;

    const now = new Date();
    let nextReviewDate;
    let newState = state;
    let newRepetitions = repetitions;
    let newInterval = interval;
    let newEaseFactor = easeFactor;
    let newStepIndex = stepIndex;

    // Configuration for accuracy improvements
    const CONFIG = {
        INTERVAL_MODIFIER: 1.0, // Multiplier for all intervals
        NEW_INTERVAL: 0.0,      // Multiplier for lapsed intervals (0.0 = reset to 0)
        FUZZ_FACTOR_MIN: 0.95,  // Min fuzz
        FUZZ_FACTOR_MAX: 1.05,  // Max fuzz
        BONUS_FACTOR: 0.5       // Bonus for late correct reviews
    };

    // Calculate days overdue (if late)
    let daysLate = 0;
    if (lastReviewDate && state === CARD_STATE.REVIEWING) {
        const scheduledDate = addDays(new Date(lastReviewDate), interval);
        // Use max(0) because we don't punish early reviews here, just late ones
        daysLate = Math.max(0, (now - scheduledDate) / (1000 * 60 * 60 * 24));
    }

    // --- Handle Learning / Relearning State ---
    if (state === CARD_STATE.NEW || state === CARD_STATE.LEARNING || state === CARD_STATE.RELEARNING) {
        switch (rating) {
            case RATING.AGAIN:
                // Reset to first step
                newStepIndex = 0;
                newState = state === CARD_STATE.NEW ? CARD_STATE.LEARNING : CARD_STATE.RELEARNING;
                nextReviewDate = addMinutes(now, SM2_CONFIG.LEARNING_STEPS[0]);
                // Ease penalty only on entering relearning from reviewing
                if (state === CARD_STATE.REVIEWING) {
                    newEaseFactor = Math.max(SM2_CONFIG.MIN_EASE_FACTOR, easeFactor - 0.2);
                }
                break;

            case RATING.HARD:
                // Stay at current step, or advance half a step (repeat current interval)
                newStepIndex = stepIndex; // No advancement
                const hardStep = SM2_CONFIG.LEARNING_STEPS[newStepIndex] * 1.2;
                nextReviewDate = addMinutes(now, hardStep);
                newState = state === CARD_STATE.NEW ? CARD_STATE.LEARNING : state;
                break;

            case RATING.GOOD:
                // Advance to next step
                newStepIndex = stepIndex + 1;
                if (newStepIndex >= SM2_CONFIG.LEARNING_STEPS.length) {
                    // Graduate to Reviewing
                    newState = CARD_STATE.REVIEWING;
                    newInterval = SM2_CONFIG.GRADUATING_INTERVAL;
                    newRepetitions = 1;
                    nextReviewDate = addDays(now, newInterval);
                } else {
                    // Still learning
                    newState = state === CARD_STATE.NEW ? CARD_STATE.LEARNING : state;
                    nextReviewDate = addMinutes(now, SM2_CONFIG.LEARNING_STEPS[newStepIndex]);
                }
                break;

            case RATING.EASY:
                // Graduate immediately with easy interval
                newState = CARD_STATE.REVIEWING;
                newInterval = SM2_CONFIG.EASY_INTERVAL;
                newRepetitions = 1;
                newEaseFactor = easeFactor + 0.15; // Boost ease on Easy
                nextReviewDate = addDays(now, newInterval);
                break;
        }
    }
    // --- Handle Reviewing State ---
    else if (state === CARD_STATE.REVIEWING) {
        // Adjust for lateness (only for passing grades)
        // effective_interval = interval + days_late * bonus
        // But Anki applies this logic: next_i = current_i * factor + days_late * bonus... 
        // We will simplify: Effective "current interval" is boosted if late and correct.
        let effectiveInterval = interval;
        if (rating >= RATING.GOOD) {
            effectiveInterval += Math.round(daysLate * CONFIG.BONUS_FACTOR);
        }

        switch (rating) {
            case RATING.AGAIN:
                // Enter Relearning, apply ease penalty
                newEaseFactor = Math.max(SM2_CONFIG.MIN_EASE_FACTOR, easeFactor - 0.2);
                newState = CARD_STATE.RELEARNING;
                newStepIndex = 0;
                newRepetitions = 0; // Reset streak

                // Lapse handling: New Interval = Old * LAPSE_NEW_INTERVAL -> max(1, ...)
                newInterval = Math.max(1, Math.round(interval * SM2_CONFIG.LAPSE_NEW_INTERVAL));

                nextReviewDate = addMinutes(now, SM2_CONFIG.LEARNING_STEPS[0]);
                break;

            case RATING.HARD:
                // Anki: Hard Interval = Current Interval * 1.2
                // We do NOT use Ease Factor here. Hard is static 1.2x growth.
                newInterval = Math.max(effectiveInterval + 1, Math.round(effectiveInterval * SM2_CONFIG.HARD_MULTIPLIER));
                newEaseFactor = Math.max(SM2_CONFIG.MIN_EASE_FACTOR, easeFactor - 0.15);
                newRepetitions = repetitions + 1;
                newState = CARD_STATE.REVIEWING;
                break;

            case RATING.GOOD:
                // Anki: Good Interval = Current Interval * Ease
                newInterval = Math.max(effectiveInterval + 1, Math.round(effectiveInterval * newEaseFactor));
                newRepetitions = repetitions + 1;
                newState = CARD_STATE.REVIEWING;
                break;

            case RATING.EASY:
                // Anki: Easy Interval = Current Interval * Ease * EasyBonus
                newInterval = Math.max(effectiveInterval + 1, Math.round(effectiveInterval * newEaseFactor * SM2_CONFIG.EASY_BONUS));
                newEaseFactor = easeFactor + 0.15;
                newRepetitions = repetitions + 1;
                newState = CARD_STATE.REVIEWING;
                break;
        }

        // Apply Global Modifier to all reviewing intervals (if not relearning)
        if (newState === CARD_STATE.REVIEWING) {
            newInterval = Math.round(newInterval * SM2_CONFIG.INTERVAL_MODIFIER);

            // Fuzzing (Anki Logic: Apply to all intervals > 1 day)
            // Range: 0.95 to 1.05
            if (newInterval > 1) {
                const fuzz = 0.95 + Math.random() * (1.05 - 0.95);
                newInterval = Math.round(newInterval * fuzz);
                // Ensure it doesn't dip below 1 day after modifiers
                newInterval = Math.max(1, newInterval);
            }

            // Max Interval Cap
            const MAX_INTERVAL = 36500; // 100 years
            newInterval = Math.min(newInterval, MAX_INTERVAL);

            nextReviewDate = addDays(now, newInterval);
        }
    }

    // --- Check Mastery ---
    if (newRepetitions >= SM2_CONFIG.MASTERY_THRESHOLD || newInterval >= SM2_CONFIG.MASTERY_INTERVAL) {
        newState = CARD_STATE.MASTERED;
    }

    return {
        interval: newInterval,
        easeFactor: Math.round(newEaseFactor * 100) / 100,
        repetitions: newRepetitions,
        state: newState,
        stepIndex: newStepIndex,
        nextReviewDate: nextReviewDate.toISOString(),
        lastReviewDate: now.toISOString(),
        algorithm: ALGORITHM.SM2
    };
}

// --- FSRS Algorithm (Integrated with ts-fsrs) ---
function calculateFSRS(card, rating) {
    const safeCard = validateCard({ ...card });

    let {
        state = CARD_STATE.NEW,
        fsrs = null,
        interval = 0,
        repetitions = 0,
        lastReviewDate = null
    } = safeCard;

    const now = new Date();

    // Map local State to ts-fsrs State
    const fsrsState = mapToFSRSState(state);

    // Create Lib Card
    const libCard = {
        due: card.nextReviewDate ? new Date(card.nextReviewDate) : now,
        stability: fsrs ? fsrs.stability : 0,
        difficulty: fsrs ? fsrs.difficulty : 0,
        elapsed_days: fsrs && fsrs.lastReview
            ? Math.max(0, (now - new Date(fsrs.lastReview)) / (1000 * 60 * 60 * 24))
            : 0,
        scheduled_days: interval,
        reps: repetitions,
        lapses: fsrs ? (fsrs.lapses || 0) : 0,
        state: fsrsState,
        last_review: lastReviewDate ? new Date(lastReviewDate) : undefined
    };

    // Calculate Next Schedule using ts-fsrs
    // Rating mapping: Again=1, Hard=2, Good=3, Easy=4 (matches our enum)
    const recordLog = fsrsInstance.next(libCard, now, rating);

    // Map back to our format
    const newCard = recordLog.card;
    let newLocalState = mapFromFSRSState(newCard.state);
    let newInterval = newCard.scheduled_days;

    // --- Check Mastery (Stability based) ---
    // If stability >= 30 days, we consider it mastered for our app's purposes
    if (newCard.stability >= 30) {
        newLocalState = CARD_STATE.MASTERED;
    }

    // Retrievability from log (Safe Access)
    // ts-fsrs structure: { log: { review: ... }, ... } or directly on log depending on version
    // We use the one provided in the log object usually found in recordLog[rating].log
    // But next() returns a single RecordLog for the specific rating.
    // Retrievability from log (Safe Access)
    // Fix: Access retrievability from newCard directly or log.review per updated ts-fsrs docs
    const retrievability = recordLog.log?.review?.retrievability ?? newCard.retrievability ?? 1;

    return {
        interval: newInterval,
        state: newLocalState,
        nextReviewDate: newCard.due.toISOString(),
        lastReviewDate: now.toISOString(),
        fsrs: {
            difficulty: parseFloat(newCard.difficulty.toFixed(4)),
            stability: parseFloat(newCard.stability.toFixed(4)),
            retrievability: parseFloat(retrievability.toFixed(4)),
            lastReview: now.toISOString(),
            lapses: newCard.lapses,
            reps: newCard.reps || repetitions + 1
        },
        algorithm: ALGORITHM.FSRS
    };
}

// --- Main Scheduler Interface ---
const SRSScheduler = {
    /**
     * Calculate the next review schedule for a card
     * @param {object} card - The card data object ({ interval, easeFactor, ... })
     * @param {number} rating - User rating (RATING.AGAIN, RATING.HARD, RATING.GOOD, RATING.EASY)
     * @param {string} algorithm - ALGORITHM.SM2 or ALGORITHM.FSRS
     * @returns {object} Updated card data with new schedule
     */
    calculate(card, rating, algorithm = ALGORITHM.SM2) {
        try {
            if (!card) throw new Error("Card data is required");
            if (!rating) throw new Error("Rating is required");

            if (algorithm === ALGORITHM.FSRS) {
                return calculateFSRS(card, rating);
            }
            return calculateSM2(card, rating);
        } catch (error) {
            console.error("SRS Calculation Error:", error);
            // Fallback: If calculation fails, return card as is + 1 day interval to avoid data loss
            return {
                ...card,
                interval: Math.max(1, (card.interval || 0)),
                nextReviewDate: new Date(Date.now() + 86400000).toISOString(),
                state: card.state || CARD_STATE.REVIEWING,
                error: error.message
            };
        }
    },

    /**
     * Initialize a new card with default values
     * @param {string} algorithm - ALGORITHM.SM2 or ALGORITHM.FSRS
     * @returns {object} Initial card state
     */
    initializeCard(algorithm = ALGORITHM.SM2) {
        const baseCard = {
            interval: 0,
            state: CARD_STATE.NEW,
            stepIndex: 0,
            nextReviewDate: new Date().toISOString(),
            lastReviewDate: null,
            algorithm: algorithm
        };

        if (algorithm === ALGORITHM.SM2) {
            return {
                ...baseCard,
                easeFactor: SM2_CONFIG.DEFAULT_EASE_FACTOR,
                repetitions: 0
            };
        } else {
            // Use ts-fsrs factory if available, otherwise manual fallback
            const emptyFsrsCard = createEmptyCard ? createEmptyCard() : {
                difficulty: 5,
                stability: 0,
                retrievability: 1,
                last_review: undefined,
                reps: 0,
                lapses: 0,
                state: FSRS_State.New
            };

            return {
                ...baseCard,
                fsrs: {
                    difficulty: emptyFsrsCard.difficulty,
                    stability: emptyFsrsCard.stability,
                    retrievability: 1, // Start fresh
                    lastReview: null,
                    lapses: emptyFsrsCard.lapses
                }
            };
        }
    },

    /**
     * Get the interval preview for all ratings (used for button labels)
     * @param {object} card - Current card data
     * @param {string} algorithm - Current algorithm
     * @returns {object} Intervals for each rating { again: "1m", hard: "2d", ... }
     */
    getIntervalPreviews(card, algorithm = ALGORITHM.SM2) {
        const previews = {};

        // OPTIMIZATION: Use FSRS batch calculation if active
        if (algorithm === ALGORITHM.FSRS) {
            try {
                const now = new Date();
                const safeCard = validateCard({ ...card });

                // Construct Lib Card (Duplicated logic from calculateFSRS - could extract builder)
                const fsrsState = mapToFSRSState(safeCard.state);
                const libCard = {
                    due: safeCard.nextReviewDate ? new Date(safeCard.nextReviewDate) : now,
                    stability: safeCard.fsrs ? safeCard.fsrs.stability : 0,
                    difficulty: safeCard.fsrs ? safeCard.fsrs.difficulty : 0,
                    elapsed_days: safeCard.fsrs && safeCard.fsrs.lastReview
                        ? Math.max(0, (now - new Date(safeCard.fsrs.lastReview)) / (1000 * 60 * 60 * 24))
                        : 0,
                    scheduled_days: safeCard.interval,
                    reps: safeCard.repetitions,
                    lapses: safeCard.fsrs ? (safeCard.fsrs.lapses || 0) : 0,
                    state: fsrsState,
                    last_review: safeCard.lastReviewDate ? new Date(safeCard.lastReviewDate) : undefined
                };

                // Batch calculate all next states
                const repeatResult = fsrsInstance.repeat(libCard, now);

                // key: 1 (Again), 2 (Hard), 3 (Good), 4 (Easy)
                const ratingMap = { 1: 'again', 2: 'hard', 3: 'good', 4: 'easy' };

                for (const item of Object.values(repeatResult)) {
                    // repeatResult is object { '1': ..., '2': ... } in some versions or array in others
                    // standardized check:
                    if (!item || !item.card) continue;

                    const ratingKey = ratingMap[item.log.rating];
                    if (!ratingKey) continue;

                    const intervalDays = item.card.scheduled_days;

                    // Format
                    if (intervalDays < 1) {
                        const minutes = Math.round(intervalDays * 24 * 60);
                        previews[ratingKey] = minutes < 60 ? `${minutes}m` : `${Math.round(minutes / 60)}h`;
                    } else {
                        previews[ratingKey] = `${intervalDays}d`;
                    }
                }
                return previews;
            } catch (e) {
                console.warn("[SRS] FSRS Preview Error, falling back to iterative:", e);
                // Fallback to loop calculation below
            }
        }

        for (const [ratingName, ratingValue] of Object.entries(RATING)) {
            const result = this.calculate({ ...card }, ratingValue, algorithm);

            // Format the interval for display
            if (result.state === CARD_STATE.LEARNING || result.state === CARD_STATE.RELEARNING) {
                // Intra-day: show minutes
                const now = new Date();
                const next = new Date(result.nextReviewDate);
                const diffMinutes = Math.round((next - now) / (1000 * 60));
                previews[ratingName.toLowerCase()] = diffMinutes < 60 ? `${diffMinutes}m` : `${Math.round(diffMinutes / 60)}h`;
            } else {
                // Days
                previews[ratingName.toLowerCase()] = `${result.interval}d`;
            }
        }
        return previews;
    },

    /**
     * Optimize FSRS Parameters using historical logs
     * @param {Array} reviewLogs - Array of { rating, scheduled_days, elapsed_days, review_time, state }
     * @returns {Array|null} New W parameters or null
     */
    optimize(reviewLogs) {
        if (!fsrsInstance.optimizeParameters) return null;
        try {
            // This is computationally expensive, should be run in worker or server-side usually
            // but ts-fsrs offers client-side approx if implemented.
            // Note: Current standard ts-fsrs might not expose optimizeParameters directly in all builds.
            return fsrsInstance.optimizeParameters(reviewLogs);
        } catch (e) {
            console.warn("[SRS] Optimization failed:", e);
            return null;
        }
    },

    /**
     * Calculate collection-wide statistics for visualization
     * @param {object} srsData - dictionary of { lemma: cardData }
     * @returns {object} { avgStability: days, avgRetention: %, distribution: [bins] }
     */
    getCollectionStats(srsData) {
        if (!srsData || Object.keys(srsData).length === 0) {
            return { avgStability: 0, avgRetention: 0, distribution: [0, 0, 0, 0, 0], total: 0 };
        }

        let totalStability = 0;
        let totalRetention = 0;
        let count = 0;
        const bins = [0, 0, 0, 0, 0]; // 0-70%, 70-80%, 80-90%, 90-95%, 95-100%
        const now = new Date();

        for (const lemma in srsData) {
            const card = srsData[lemma];
            if (!card.lastReviewDate) continue;

            const lastReview = new Date(card.lastReviewDate);
            const elapsedDays = Math.max(0, (now - lastReview) / (1000 * 60 * 60 * 24));

            let stability = 0;
            let retention = 0;

            if (card.fsrs && card.fsrs.stability) {
                // FSRS Native retrievability formula: R = 0.9 ^ (t / S)
                stability = card.fsrs.stability;
                retention = Math.pow(0.9, elapsedDays / stability);
            } else {
                // SM-2 estimation: assume 90% retention at the end of the interval
                // R = e^(ln(0.9) * t / I)
                stability = card.interval || 0.1; // fallback
                retention = Math.pow(0.9, elapsedDays / stability);
            }

            // Clamp retention
            retention = Math.max(0, Math.min(1, retention));

            totalStability += stability;
            totalRetention += retention;
            count++;

            // Bucket into bins
            if (retention < 0.7) bins[0]++;
            else if (retention < 0.8) bins[1]++;
            else if (retention < 0.9) bins[2]++;
            else if (retention < 0.95) bins[3]++;
            else bins[4]++;
        }

        return {
            avgStability: count > 0 ? (totalStability / count).toFixed(1) : 0,
            avgRetention: count > 0 ? (totalRetention / count * 100).toFixed(1) : 0,
            distribution: bins,
            total: count
        };
    }
};

// --- Exports ---
export { SRSScheduler, ALGORITHM, CARD_STATE, RATING, SM2_CONFIG, FSRS_CONFIG };

// --- Browser Compatibility Code ---
// Expose modules to window if running in a browser environment without a module bundler.
// This allows legacy scripts (like srs-review.js) to access the Scheduler globally.
if (typeof window !== 'undefined') {
    window.SRSScheduler = SRSScheduler;
    window.ALGORITHM = ALGORITHM;
    window.CARD_STATE = CARD_STATE;
    window.RATING = RATING;
    window.SM2_CONFIG = SM2_CONFIG;
    window.FSRS_CONFIG = FSRS_CONFIG;
}
