/**
 * Points Logic Module - Core Scoring Engine (Dual-Track System v5)
 * 
 * Track A: Lifetime XP (Points) - Rewards effort, always goes up.
 * Track B: Proficiency Rating (0-100) - Estimates current ability, fluctuates.
 * 
 * Revision 5 (Locked):
 * - Simplified Mode Matrix (No cross-skill pollution)
 * - Concrete Performance Caps (Easy=60, Med=75, Hard=90, Expert=100)
 * - Stability Clamping (+/- 3 per update)
 */

// ============================================
// CONFIGURATION
// ============================================

const CONFIG = {
    // 1. Difficulty Multipliers & Rating Caps
    // Multiplier: For Track A (Points)
    // RatingCap: For Track B (Proficiency Ceiling)
    DIFFICULTY: {
        EASY: { val: 1.0, cap: 60 },   // Max B1 for Easy tasks
        MEDIUM: { val: 1.5, cap: 75 }, // Max B2 for Medium tasks
        HARD: { val: 2.0, cap: 90 },   // Max C1 for Hard tasks
        EXPERT: { val: 2.5, cap: 100 } // Max C2 for Expert tasks
    },

    // 2. Partial Credit Curve Parameters
    // Multiplier = FLOOR + (1 - FLOOR) * accuracy^EXPONENT
    PARTIAL_CREDIT: {
        FLOOR: 0.1,    // Minimum 10% points for any attempt
        EXPONENT: 1.5, // Curve shape (higher = stricter)
        PERFECT_BONUS: 1.1 // 10% bonus for 100% accuracy
    },

    // 3. Difficulty Guardrail Thresholds
    // If accuracy < T, difficulty degrades to 1.0
    GUARDRAIL_THRESHOLDS: {
        type: 0.6,    // Stricter for typing
        speak: 0.45,  // Loosest for ASR noise
        default: 0.5
    },

    // 4. Proficiency Rating (EMA)
    RATING: {
        ALPHA: 0.1,      // Stability factor
        MAX_CHANGE: 3.0  // Clamp: max change per attempt
    },

    // 5. CEFR Thresholds (Rating 0-100 -> Level)
    CEFR_LEVELS: [
        { label: 'A1', min: 0, max: 15 },
        { label: 'A2', min: 16, max: 35 },
        { label: 'B1', min: 36, max: 60 },
        { label: 'B2', min: 61, max: 80 },
        { label: 'C1', min: 81, max: 95 },
        { label: 'C2', min: 96, max: 100 }
    ],

    // 6. Mode Contribution Matrix (Clean)
    MODE_WEIGHTS: {
        type: { listening: 0.40, writing: 0.60, reading: 0.00, speaking: 0.00 },
        speak: { listening: 0.60, writing: 0.00, reading: 0.00, speaking: 0.40 },
        extended: { listening: 0.60, writing: 0.40, reading: 0.00, speaking: 0.00 },
        watch: { listening: 0.50, writing: 0.00, reading: 0.50, speaking: 0.00 },
        notes: { listening: 0.40, writing: 0.60, reading: 0.00, speaking: 0.00 },
        writingChallenge: { listening: 0.00, writing: 1.00, reading: 0.00, speaking: 0.00 }
    }
};


// ============================================
// TRACK A: LIFETIME XP CALCULATION
// ============================================

/**
 * Calculate points for a single attempt (Track A)
 * @param {number} basePoints - Standard points (10)
 * @param {number} selectedDiff - 1.0, 1.5, 2.0, 2.5
 * @param {number} accuracy - 0.0 to 1.0
 * @param {string} mode - 'type', 'speak', etc (for guardrail)
 * @returns {object} { points, breakdown, meta }
 */
function calculateActivityPoints(basePoints, selectedDiff, accuracy, mode = 'default') {
    // 1. Partial Credit Curve
    // Formula: 0.1 + 0.9 * Acc^1.5
    let creditMult = CONFIG.PARTIAL_CREDIT.FLOOR +
        (1 - CONFIG.PARTIAL_CREDIT.FLOOR) * Math.pow(accuracy, CONFIG.PARTIAL_CREDIT.EXPONENT);

    if (accuracy >= 1.0) creditMult *= CONFIG.PARTIAL_CREDIT.PERFECT_BONUS; // Bonus for perfection

    // 2. Difficulty Guardrail (Soft Degradation)
    // If accuracy < Threshold, effective difficulty slides back to 1.0
    const threshold = CONFIG.GUARDRAIL_THRESHOLDS[mode] || CONFIG.GUARDRAIL_THRESHOLDS.default;
    // Qual = Clamp(accuracy / threshold, 0, 1)
    const qualifyFactor = Math.min(Math.max(accuracy / threshold, 0), 1);
    // Eff = 1.0 + (Selected - 1.0) * Qual
    const effectiveDiff = 1.0 + (selectedDiff - 1.0) * qualifyFactor;

    // 3. Final Calculation
    const totalPoints = basePoints * effectiveDiff * creditMult;

    return {
        points: Math.round(totalPoints * 10) / 10,
        meta: {
            base: basePoints,
            selectedDiff,
            effectiveDiff: Math.round(effectiveDiff * 100) / 100,
            creditMult: Math.round(creditMult * 100) / 100,
            accuracy
        }
    };
}

/**
 * Distribute total points to skills based on mode
 */
function distributePointsToSkills(mode, totalPoints) {
    const weights = CONFIG.MODE_WEIGHTS[mode] || { listening: 0.25, writing: 0.25, reading: 0.25, speaking: 0.25 };

    return {
        listening: strip(totalPoints * weights.listening),
        writing: strip(totalPoints * weights.writing),
        reading: strip(totalPoints * weights.reading),
        speaking: strip(totalPoints * weights.speaking)
    };
}


// ============================================
// TRACK B: PROFICIENCY RATING MAINTENANCE
// ============================================

/**
 * Calculate Performance Score (Input for Rating)
 * Formula: Cap(Diff) * Accuracy^1.5
 * @param {number} selectedDiff 
 * @param {number} accuracy 
 * @returns {number} 0-100 score
 */
function calculatePerformanceScore(selectedDiff, accuracy) {
    // Find Cap
    let cap = 60; // Default Easy
    if (selectedDiff >= 2.5) cap = CONFIG.DIFFICULTY.EXPERT.cap;      // 100
    else if (selectedDiff >= 2.0) cap = CONFIG.DIFFICULTY.HARD.cap;   // 90
    else if (selectedDiff >= 1.5) cap = CONFIG.DIFFICULTY.MEDIUM.cap; // 75
    else cap = CONFIG.DIFFICULTY.EASY.cap;                            // 60

    // Calculation
    // We use Acc^1.5 to punish low accuracy severely even on hard tasks
    return cap * Math.pow(accuracy, 1.5);
}

/**
 * Update Rating with Stability Clamp
 * New = Old + Clamp(Alpha * AlphaScale * (Perf - Old), -Limit, +Limit)
 * @param {number} currentRating
 * @param {number} performanceScore
 * @param {number} alphaScale - 0.0 to 1.0 (Skill weight)
 */
function updateRating(currentRating, performanceScore, alphaScale = 1.0) {
    const alpha = CONFIG.RATING.ALPHA * alphaScale;
    const rawDelta = alpha * (performanceScore - currentRating);

    // Clamp delta using config
    const maxChange = CONFIG.RATING.MAX_CHANGE;
    const clampedDelta = Math.min(Math.max(rawDelta, -maxChange), maxChange);

    return strip(currentRating + clampedDelta);
}

/**
 * Accuracy Helper: F1 Score (Precision + Recall)
 * Prevents "extra word" inflation by penalizing insertions.
 * @param {Array} diffPieces - Output from diffWords method
 */
function calculateF1Accuracy(diffPieces) {
    const matches = diffPieces.filter(p => p.type === 'match').length;
    const missing = diffPieces.filter(p => p.type === 'missing').length;
    const extra = diffPieces.filter(p => p.type === 'extra').length;

    const recall = (matches + missing) > 0 ? matches / (matches + missing) : 0;
    const precision = (matches + extra) > 0 ? matches / (matches + extra) : 0;

    if (precision === 0 && recall === 0) return 0;
    // Standard F1 Formula: 2 * (P * R) / (P + R)
    return (2 * precision * recall) / (precision + recall);
}

function getCefrLevel(rating) {
    const level = CONFIG.CEFR_LEVELS.find(l => rating >= l.min && rating <= l.max);
    return level ? level.label : 'A1';
}

function calculateOverallRating(skillRatings, srsBonus = 0) {
    // Simple avg of skills + SRS bonus
    const avg = (
        (skillRatings.listening || 0) +
        (skillRatings.writing || 0) +
        (skillRatings.reading || 0) +
        (skillRatings.speaking || 0)
    ) / 4;

    return Math.min(100, strip(avg + srsBonus));
}

// ============================================
// UTILITIES
// ============================================
function strip(number) {
    return parseFloat(number.toPrecision(12));
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        CONFIG,
        calculateActivityPoints,
        distributePointsToSkills,
        calculatePerformanceScore,
        updateRating,
        getCefrLevel,
        calculateOverallRating,
        calculateF1Accuracy
    };
} else {
    window.PointsLogic = {
        CONFIG,
        calculateActivityPoints,
        distributePointsToSkills,
        calculatePerformanceScore,
        updateRating,
        getCefrLevel,
        calculateOverallRating,
        calculateF1Accuracy
    };
}
