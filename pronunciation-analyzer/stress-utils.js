/**
 * Unified stress analysis utilities
 * Based on Fry (1955, 1958) hierarchy: Duration > Pitch > Intensity
 */

export const STRESS_WEIGHTS = {
    pitch: 0.45,      // Increased weight for perceptual salience
    duration: 0.35,   // Still strong, but less dominant
    intensity: 0.20   // Slightly more weight for loudness
};

/**
 * Calculate composite stress score for a syllable
 * @param {number} pitchRel - Relative pitch (0-100)
 * @param {number} durationRel - Relative duration (0-100)
 * @param {number} intensityRel - Relative intensity (0-100)
 * @returns {number} Weighted score (0-100)
 */
export function calculateStressScore(pitchRel, durationRel, intensityRel) {
    return Math.round(
        STRESS_WEIGHTS.pitch * (pitchRel || 0) +
        STRESS_WEIGHTS.duration * (durationRel || 0) +
        STRESS_WEIGHTS.intensity * (intensityRel || 0)
    );
}

/**
 * Find the stressed syllable in a list of syllables
 * @param {Array} syllables - Array of syllable objects
 * @returns {number} Index of stressed syllable (0-based)
 */
export function findStressedSyllable(syllables) {
    if (!syllables || syllables.length === 0) return 0;

    // Get max values for normalization
    // Use values > 0 to avoid division by zero issues, fallback to 1
    const pitches = syllables.map(s => s.maxPitch || s.avgPitch || 0).filter(v => v > 0);
    const durations = syllables.map(s => s.duration || 0).filter(v => v > 0);
    const intensities = syllables.map(s => s.intensity || s.maxEnergy || 0).filter(v => v > 0);

    const maxPitch = pitches.length ? Math.max(...pitches) : 1;
    const maxDuration = durations.length ? Math.max(...durations) : 1;
    const maxIntensity = intensities.length ? Math.max(...intensities) : 1;

    let bestIdx = 0;
    let bestScore = -1;

    syllables.forEach((s, i) => {
        const pRel = ((s.maxPitch || s.avgPitch || 0) / maxPitch) * 100;
        const dRel = ((s.duration || 0) / maxDuration) * 100;
        const iRel = ((s.intensity || s.maxEnergy || 0) / maxIntensity) * 100;

        const score = calculateStressScore(pRel, dRel, iRel);

        if (score > bestScore) {
            bestScore = score;
            bestIdx = i;
        }
    });

    return bestIdx;
}
