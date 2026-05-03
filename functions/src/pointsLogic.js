/**
 * Points Logic - Server-Side Scoring Engine
 * 
 * This is the trusted server version of the scoring algorithms.
 * All calculations happen here to prevent client manipulation.
 */

// ============================================
// CONFIGURATION
// ============================================

const CONFIG = {
    // Difficulty Multipliers & Rating Caps
    DIFFICULTY: {
        EASY: { val: 1.0, cap: 60 },
        MEDIUM: { val: 1.5, cap: 75 },
        HARD: { val: 2.0, cap: 90 },
        EXPERT: { val: 2.5, cap: 100 }
    },

    // Partial Credit Curve Parameters
    PARTIAL_CREDIT: {
        FLOOR: 0.1,
        EXPONENT: 1.5,
        PERFECT_BONUS: 1.1
    },

    // Difficulty Guardrail Thresholds
    GUARDRAIL_THRESHOLDS: {
        type: 0.6,
        speak: 0.45,
        default: 0.5
    },

    // Proficiency Rating (EMA)
    RATING: {
        ALPHA: 0.1,
        MAX_CHANGE: 3.0
    },

    // CEFR Thresholds
    CEFR_LEVELS: [
        { label: 'A1', min: 0, max: 15 },
        { label: 'A2', min: 16, max: 35 },
        { label: 'B1', min: 36, max: 60 },
        { label: 'B2', min: 61, max: 80 },
        { label: 'C1', min: 81, max: 95 },
        { label: 'C2', min: 96, max: 100 }
    ],

    // Mode Contribution Matrix
    MODE_WEIGHTS: {
        type: { listening: 0.40, writing: 0.60, reading: 0.00, speaking: 0.00 },
        speak: { listening: 0.60, writing: 0.00, reading: 0.00, speaking: 0.40 },
        asq: { listening: 0.50, writing: 0.00, reading: 0.00, speaking: 0.50 },
        extended: { listening: 0.60, writing: 0.40, reading: 0.00, speaking: 0.00 },
        rfib: { listening: 0.00, writing: 0.00, reading: 1.00, speaking: 0.00 },
        watch: { listening: 0.50, writing: 0.00, reading: 0.50, speaking: 0.00 },
        notes: { listening: 0.40, writing: 0.60, reading: 0.00, speaking: 0.00 },
        writingChallenge: { listening: 0.00, writing: 1.00, reading: 0.00, speaking: 0.00 }
    },

    // Base points per attempt
    BASE_POINTS: 10,

    // Allowed modes
    ALLOWED_MODES: ['type', 'speak', 'asq', 'extended', 'rfib', 'watch', 'notes', 'writingChallenge', 'srs']
};

// ============================================
// ACCURACY CALCULATION
// ============================================

/**
 * Tokenize and normalize string for comparison
 */
function tokenize(str) {
    return (str || '')
        .toLowerCase()
        .replace(/[^\w\s']/g, '') // Keep alphanumeric, spaces, and apostrophes
        .split(/\s+/)
        .filter(Boolean);
}

/**
 * Compute Longest Common Subsequence length using 1D DP (memory efficient)
 */
function lcsLength1D(a, b) {
    // Ensure b is shorter to minimize memory
    if (b.length > a.length) [a, b] = [b, a];

    const n = b.length;
    const dp = new Array(n + 1).fill(0);

    for (let i = 1; i <= a.length; i++) {
        let prevDiag = 0; // dp[j-1] from previous row
        for (let j = 1; j <= n; j++) {
            const temp = dp[j]; // value before overwrite
            if (a[i - 1] === b[j - 1]) {
                dp[j] = prevDiag + 1;
            } else {
                dp[j] = Math.max(dp[j], dp[j - 1]);
            }
            prevDiag = temp;
        }
    }
    return dp[n];
}

/**
 * Compare two strings and return match/missing/extra counts (LCS-based)
 * This avoids cascade penalties from single insertions/deletions.
 */
function diffWords(expected, actual) {
    const exp = tokenize(expected);
    const act = tokenize(actual);

    const matches = lcsLength1D(exp, act);
    return {
        matches,
        missing: exp.length - matches,
        extra: act.length - matches,
        expectedLen: exp.length,
        actualLen: act.length
    };
}

/**
 * Calculate F1 accuracy from match counts
 * @param {object} diff - { matches, missing, extra }
 */
function calculateF1Accuracy(diff) {
    const { matches, missing, extra } = diff;

    const recall = (matches + missing) > 0 ? matches / (matches + missing) : 0;
    const precision = (matches + extra) > 0 ? matches / (matches + extra) : 0;

    if (precision === 0 && recall === 0) return 0;
    return (2 * precision * recall) / (precision + recall);
}

// ============================================
// POINTS CALCULATION (TRACK A)
// ============================================

/**
 * Helper to round to a specific precision (e.g., 0.1)
 */
function roundTo(x, precision = 0.1) {
    const factor = 1 / precision;
    return Math.round((x || 0) * factor) / factor;
}

/**
 * Distribute total points across skills based on weights, preserving the sum.
 * Uses a stepwise rounding error fix to allocate remainders fairly to skills with weights > 0.
 */
function distributeWithRoundingErrorFix(totalPoints, weights, precision = 0.1) {
    const skills = ['listening', 'writing', 'reading', 'speaking'];

    // 1) Normalize weights to sum to 1
    let wSum = 0;
    const w = {};
    for (const s of skills) {
        const val = Math.max(0, Number(weights?.[s] || 0));
        w[s] = val;
        wSum += val;
    }
    if (wSum <= 0) {
        for (const s of skills) w[s] = 1 / skills.length;
        wSum = 1;
    } else {
        for (const s of skills) w[s] = w[s] / wSum;
    }

    // 2) Raw allocations + initial rounding
    const raw = {};
    const rounded = {};
    for (const s of skills) {
        raw[s] = (totalPoints || 0) * w[s];
        rounded[s] = roundTo(raw[s], precision);
    }

    const target = roundTo(totalPoints, precision);
    let sumRounded = roundTo(skills.reduce((acc, s) => acc + rounded[s], 0), precision);

    const step = precision;
    let remainder = roundTo(target - sumRounded, precision);

    if (remainder === 0) {
        return { breakdown: rounded, sum: sumRounded, target };
    }

    // Number of steps to distribute (positive or negative)
    const steps = Math.round(remainder / step);

    // 3) Build error ranking
    const errors = {};
    for (const s of skills) errors[s] = raw[s] - rounded[s];

    // Helper to pick best skill for a given direction
    function pickSkill(direction) {
        let best = null;
        let bestScore = null;

        for (const s of skills) {
            // Only allocate remainder to skills that actually have weight
            if ((w[s] || 0) <= 0) continue;

            // Prevent going negative when subtracting
            if (direction < 0 && (rounded[s] - step) < 0) continue;

            const score = direction > 0 ? -errors[s] : errors[s];

            if (best === null || score > bestScore) {
                best = s;
                bestScore = score;
            }
        }

        // Fallback: if all weights are 0, allow any skill
        if (best === null) {
            for (const s of skills) {
                if (direction < 0 && (rounded[s] - step) < 0) continue;
                const score = direction > 0 ? -errors[s] : errors[s];
                if (best === null || score > bestScore) {
                    best = s;
                    bestScore = score;
                }
            }
        }
        return best;
    }

    // 4) Apply remainder stepwise
    const direction = steps > 0 ? 1 : -1;
    const count = Math.abs(steps);

    for (let k = 0; k < count; k++) {
        const s = pickSkill(direction);
        if (!s) break;
        rounded[s] = roundTo(rounded[s] + direction * step, precision);
        errors[s] = raw[s] - rounded[s];
    }

    sumRounded = roundTo(skills.reduce((acc, s) => acc + rounded[s], 0), precision);
    return { breakdown: rounded, sum: sumRounded, target };
}

/**
 * Calculate XP points for an attempt
 * @param {number} accuracy - 0.0 to 1.0
 * @param {number} selectedDiff - 1.0, 1.5, 2.0, 2.5
 * @param {string} mode - 'type', 'speak', etc
 * @param {number} xpMult - Scaling factor for repeats (diminishing returns)
 * @returns {object} { total, breakdown, meta }
 */
function calculateActivityPoints(accuracy, selectedDiff, mode, xpMult = 1.0) {
    const basePoints = CONFIG.BASE_POINTS;

    // Partial Credit Curve
    let creditMult = CONFIG.PARTIAL_CREDIT.FLOOR +
        (1 - CONFIG.PARTIAL_CREDIT.FLOOR) * Math.pow(accuracy, CONFIG.PARTIAL_CREDIT.EXPONENT);

    if (accuracy >= 1.0) creditMult *= CONFIG.PARTIAL_CREDIT.PERFECT_BONUS;

    // Difficulty Guardrail
    const threshold = CONFIG.GUARDRAIL_THRESHOLDS[mode] || CONFIG.GUARDRAIL_THRESHOLDS.default;
    const qualifyFactor = Math.min(Math.max(accuracy / threshold, 0), 1);
    const effectiveDiff = 1.0 + (selectedDiff - 1.0) * qualifyFactor;

    // Total (Raw first)
    const rawTotal = basePoints * effectiveDiff * creditMult;

    // Apply anti-farm XP multiplier
    const totalPoints = Math.round(rawTotal * xpMult * 10) / 10;

    // Distribute to skills with remainder fix to ensure sum === totalPoints
    const weights = CONFIG.MODE_WEIGHTS[mode] || { listening: 0.25, writing: 0.25, reading: 0.25, speaking: 0.25 };
    const { breakdown, sum, target } = distributeWithRoundingErrorFix(totalPoints, weights, 0.1);

    return {
        total: totalPoints,
        breakdown,
        meta: {
            creditMult,
            effectiveDiff,
            xpMult,
            accuracy,
            breakdownSum: sum,
            breakdownTarget: target
        }
    };
}

// ============================================
// PROFICIENCY RATING (TRACK B)
// ============================================

/**
 * Calculate performance score for rating update
 */
function calculatePerformanceScore(selectedDiff, accuracy) {
    let cap = 60;
    if (selectedDiff >= 2.5) cap = CONFIG.DIFFICULTY.EXPERT.cap;
    else if (selectedDiff >= 2.0) cap = CONFIG.DIFFICULTY.HARD.cap;
    else if (selectedDiff >= 1.5) cap = CONFIG.DIFFICULTY.MEDIUM.cap;
    else cap = CONFIG.DIFFICULTY.EASY.cap;

    return cap * Math.pow(accuracy, 1.5);
}

/**
 * Update rating with EMA and clamping
 */
function updateRating(currentRating, performanceScore, weight = 1.0, ratingMult = 1.0, options = {}) {
    const applyMultUpwardOnly = options && options.applyMultUpwardOnly === true;

    const baseAlpha = Math.min(1.0, CONFIG.RATING.ALPHA * weight);
    const deltaWithoutMult = baseAlpha * (performanceScore - currentRating);
    const shouldScaleByMult = !(applyMultUpwardOnly && deltaWithoutMult < 0);
    const effectiveMult = shouldScaleByMult ? ratingMult : 1.0;

    // Scale learning rate by rating multiplier (with optional upward-only rule).
    const alpha = Math.min(1.0, baseAlpha * effectiveMult);
    const rawDelta = alpha * (performanceScore - currentRating);
    const clampedDelta = Math.min(Math.max(rawDelta, -CONFIG.RATING.MAX_CHANGE), CONFIG.RATING.MAX_CHANGE);
    return Math.round((currentRating + clampedDelta) * 100) / 100;
}

/**
 * Get CEFR level from rating
 */
function getCefrLevel(rating) {
    const level = CONFIG.CEFR_LEVELS.find(l => rating >= l.min && rating <= l.max);
    return level ? level.label : 'A1';
}

/**
 * Calculate overall rating from skill ratings
 */
function calculateOverallRating(skillRatings, srsBonus = 0) {
    const avg = (
        (skillRatings.listening || 0) +
        (skillRatings.writing || 0) +
        (skillRatings.reading || 0) +
        (skillRatings.speaking || 0)
    ) / 4;
    return Math.min(100, Math.round((avg + srsBonus) * 100) / 100);
}

/**
 * Update all skill ratings based on mode and performance
 */
function updateAllRatings(currentRatings, performanceScore, mode, ratingMult = 1.0, options = {}) {
    const weights = CONFIG.MODE_WEIGHTS[mode];
    if (!weights) return currentRatings;

    const newRatings = { ...currentRatings };
    Object.entries(weights).forEach(([skill, weight]) => {
        if (weight > 0) {
            newRatings[skill] = updateRating(
                currentRatings[skill] || 0,
                performanceScore,
                weight,
                ratingMult,
                options
            );
        }
    });

    return newRatings;
}

/**
 * Derive all CEFR levels from ratings
 */
function deriveCefrLevels(ratings, srsBonus = 0) {
    const overall = calculateOverallRating(ratings, srsBonus);
    return {
        listening: getCefrLevel(ratings.listening || 0),
        writing: getCefrLevel(ratings.writing || 0),
        reading: getCefrLevel(ratings.reading || 0),
        speaking: getCefrLevel(ratings.speaking || 0),
        overall: getCefrLevel(overall)
    };
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
    CONFIG,
    calculateF1Accuracy,
    tokenize,
    diffWords,
    calculateActivityPoints,
    calculatePerformanceScore,
    updateRating,
    getCefrLevel,
    calculateOverallRating,
    updateAllRatings,
    deriveCefrLevels
};
