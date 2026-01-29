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
    FSRS: 'FSRS'      // Free Spaced Repetition Scheduler v4.5
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
    MASTERY_INTERVAL: 21          // Days interval to consider mastered
};

// --- FSRS Configuration (Defaults from FSRS v4.5) ---
const FSRS_CONFIG = {
    DESIRED_RETENTION: 0.9,       // Target 90% recall probability
    // Default weights for FSRS v4.5 (Stability)
    W: [0.4, 0.9, 2.3, 10.9, 4.93, 0.94, 0.86, 0.01, 1.49, 0.14, 0.94, 2.18, 0.05, 0.34, 1.26, 0.29, 2.61],
    DECAY: -0.5,                  // Memory decay constant
    FACTOR: 0.9                   // Forgetting curve factor
};

// Helper: Add days to a date
function addDays(date, days) {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
}

// Helper: Add minutes to a date
function addMinutes(date, minutes) {
    return new Date(date.getTime() + minutes * 60 * 1000);
}

// --- SM-2 Algorithm ---
function calculateSM2(card, rating) {
    let {
        interval = 0,
        easeFactor = SM2_CONFIG.DEFAULT_EASE_FACTOR,
        repetitions = 0,
        state = CARD_STATE.NEW,
        stepIndex = 0
    } = card;

    const now = new Date();
    let nextReviewDate;
    let newState = state;
    let newRepetitions = repetitions;
    let newInterval = interval;
    let newEaseFactor = easeFactor;
    let newStepIndex = stepIndex;

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
        switch (rating) {
            case RATING.AGAIN:
                // Enter Relearning, apply ease penalty
                newEaseFactor = Math.max(SM2_CONFIG.MIN_EASE_FACTOR, easeFactor - 0.2);
                newState = CARD_STATE.RELEARNING;
                newStepIndex = 0;
                newRepetitions = 0; // Reset streak
                nextReviewDate = addMinutes(now, SM2_CONFIG.LEARNING_STEPS[0]);
                break;

            case RATING.HARD:
                // Interval * 1.2 (Fixed), Ease -15%
                newInterval = Math.max(interval + 1, Math.round(interval * SM2_CONFIG.HARD_MULTIPLIER));
                newEaseFactor = Math.max(SM2_CONFIG.MIN_EASE_FACTOR, easeFactor - 0.15);
                newRepetitions = repetitions + 1;
                newState = CARD_STATE.REVIEWING;
                nextReviewDate = addDays(now, newInterval);
                break;

            case RATING.GOOD:
                // Interval * EaseFactor, Ease unchanged
                newInterval = Math.max(interval + 1, Math.round(interval * easeFactor));
                newRepetitions = repetitions + 1;
                newState = CARD_STATE.REVIEWING;
                nextReviewDate = addDays(now, newInterval);
                break;

            case RATING.EASY:
                // Interval * EaseFactor * 1.3, Ease +15%
                newInterval = Math.max(interval + 1, Math.round(interval * easeFactor * SM2_CONFIG.EASY_BONUS));
                newEaseFactor = easeFactor + 0.15;
                newRepetitions = repetitions + 1;
                newState = CARD_STATE.REVIEWING;
                nextReviewDate = addDays(now, newInterval);
                break;
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

// --- FSRS Algorithm ---
function calculateFSRS(card, rating) {
    let {
        interval = 0,
        state = CARD_STATE.NEW,
        fsrs = null
    } = card;

    const now = new Date();

    // Initialize FSRS state if needed
    if (!fsrs) {
        fsrs = {
            difficulty: 5,
            stability: 0,
            retrievability: 1,
            lastReview: null
        };
    }

    let { difficulty, stability } = fsrs;
    let newState = state;
    let newInterval;

    // Calculate Retrievability (R) based on elapsed time since last review
    let elapsedDays = 0;
    if (fsrs.lastReview) {
        elapsedDays = (now - new Date(fsrs.lastReview)) / (1000 * 60 * 60 * 24);
    }

    const retrievability = stability > 0
        ? Math.pow(1 + FSRS_CONFIG.FACTOR * elapsedDays / stability, FSRS_CONFIG.DECAY)
        : 1;

    // --- Update Difficulty based on rating ---
    const ratingDelta = {
        [RATING.AGAIN]: 0.5,
        [RATING.HARD]: 0.1,
        [RATING.GOOD]: -0.1,
        [RATING.EASY]: -0.3
    };
    difficulty = Math.max(1, Math.min(10, difficulty + ratingDelta[rating]));

    // --- Update Stability based on rating ---
    if (rating === RATING.AGAIN) {
        // Failed: Slash stability
        stability = stability > 0 ? Math.max(0.1, stability * 0.2) : 0.5;
        newState = CARD_STATE.RELEARNING;
        newInterval = 0; // Re-learn today (intra-day)
    } else {
        // Passed: Increase stability (more for Easy)
        const stabilityGain = {
            [RATING.HARD]: 1.1,
            [RATING.GOOD]: 1 + (10 - difficulty) * 0.1 * retrievability,
            [RATING.EASY]: 1 + (10 - difficulty) * 0.2 * retrievability
        };

        if (stability === 0) {
            // First review
            const initialStability = {
                [RATING.HARD]: 1,
                [RATING.GOOD]: 3,
                [RATING.EASY]: 7
            };
            stability = initialStability[rating];
        } else {
            stability = stability * stabilityGain[rating];
        }
        newState = CARD_STATE.REVIEWING;
    }

    // --- Calculate Interval for target retention ---
    // Formula: Interval = S * 9 * (1/R - 1)  where S is stability, R is desired retention
    if (rating !== RATING.AGAIN) {
        const R = FSRS_CONFIG.DESIRED_RETENTION;
        newInterval = Math.max(1, Math.round(stability * 9 * (1 / R - 1)));
    } else {
        newInterval = 0; // Intra-day relearn
    }

    // --- Check Mastery ---
    if (stability >= 30) {
        newState = CARD_STATE.MASTERED;
    }

    const nextReviewDate = newInterval > 0
        ? addDays(now, newInterval)
        : addMinutes(now, 10); // Short relearn step

    return {
        interval: newInterval,
        state: newState,
        nextReviewDate: nextReviewDate.toISOString(),
        lastReviewDate: now.toISOString(),
        fsrs: {
            difficulty: Math.round(difficulty * 100) / 100,
            stability: Math.round(stability * 100) / 100,
            retrievability: Math.round(retrievability * 100) / 100,
            lastReview: now.toISOString()
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
        if (algorithm === ALGORITHM.FSRS) {
            return calculateFSRS(card, rating);
        }
        return calculateSM2(card, rating);
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
            return {
                ...baseCard,
                fsrs: {
                    difficulty: 5,
                    stability: 0,
                    retrievability: 1,
                    lastReview: null
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
    }
};

// --- Exports ---
export { SRSScheduler, ALGORITHM, CARD_STATE, RATING, SM2_CONFIG, FSRS_CONFIG };
