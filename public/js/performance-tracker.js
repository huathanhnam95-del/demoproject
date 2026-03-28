/**
 * Performance Tracker Module
 * Tracks user usage metrics (accuracy, speed, hints) to calculate performance scores.
 */

class PerformanceTracker {
    constructor(mode) {
        this.mode = mode;
        this.sessionData = {
            startTime: Date.now(),
            attempts: [],
            totalScore: 0
        };
        console.log(`[Performance] Tracker started for ${mode}`);
    }

    /**
     * Record a practice attempt
     * @param {object} result
     * @param {boolean} result.correct - Was the answer correct?
     * @param {number} result.attempts - Number of tries needed
     * @param {boolean} result.hintUsed - Was a hint used?
     * @param {number} result.timeTaken - Time in seconds
     */
    recordAttempt(result) {
        const attempt = {
            timestamp: Date.now(),
            ...result
        };

        this.sessionData.attempts.push(attempt);

        // Calculate score for this single attempt (0.0 - 1.0)
        const attemptScore = this.calculateAttemptScore(attempt);
        const assistCalibMultRaw = Number(attempt.assistCalibMult);
        const assistCalibMult = Number.isFinite(assistCalibMultRaw)
            ? Math.max(0.25, Math.min(1.0, assistCalibMultRaw))
            : 1.0;
        const adjustedAttemptScore = Math.max(0, Math.min(1.0, attemptScore * assistCalibMult));
        const assisted = !!attempt.assisted || !!attempt.hintUsed || (Number(attempt.assistCount) || 0) > 0 || assistCalibMult < 0.9;

        // Send to DifficultyManager
        if (window.DifficultyManager) {
            window.DifficultyManager.adjustDifficulty(this.mode, adjustedAttemptScore, {
                assisted,
                calibMult: assistCalibMult
            });
        }
    }

    /**
     * Calculate score for a single attempt (CEFR-aligned)
     * Returns 0.0 to 1.0
     */
    calculateAttemptScore(attempt) {
        // 1) Accuracy (0.0 - 1.0)
        // Prefer word-level accuracy if provided, otherwise fall back to binary correct/incorrect.
        const tries = Number(attempt.attempts ?? 1);
        const triesMult =
            tries <= 1 ? 1.0 :
                tries === 2 ? 0.8 :
                    tries === 3 ? 0.5 :
                        0.2;

        const rawAccuracy = Number(attempt.accuracy);
        const baseAccuracy = Number.isFinite(rawAccuracy)
            ? Math.max(0, Math.min(1, rawAccuracy))
            : (attempt.correct ? 1.0 : 0.0);

        const accuracyScore = Math.max(0, Math.min(1, baseAccuracy * triesMult));

        // 2. Speed (WPM-based)
        const wordCount = attempt.wordCount || 10;

        // Anti-gaming: Minimum 2 seconds per attempt
        // If timeTaken is invalid/missing, assume 2s
        const effectiveTimeSeconds = Math.max(2, attempt.timeTaken || 2);
        const minutes = effectiveTimeSeconds / 60;
        const userWPM = wordCount / minutes;

        // CEFR-specific WPM targets
        let targetWPM = 40; // Default
        if (window.DifficultyManager) {
            const settings = window.DifficultyManager.getCurrentSettings(this.mode);
            const level = settings.level || 1;
            // Target scaling: A1 (15 WPM) -> C2 (65 WPM)
            const targets = { 1: 15, 2: 25, 3: 35, 4: 45, 5: 55, 6: 65 };
            targetWPM = targets[level] || 40;
        }

        let speedScore = Math.min(1.0, userWPM / targetWPM);

        // Anti-gaming: Dampen speed score for very short phrases (< 3 words)
        // because WPM is noisy/inflated for short inputs.
        if (wordCount < 3) {
            speedScore = Math.min(0.8, speedScore);
        }

        const weights =
            this.mode === 'srs'
                ? { accuracy: 1.0, speed: 0.0 }
                : this.mode === 'notes'
                    ? { accuracy: 0.9, speed: 0.1 }
                    : { accuracy: 0.8, speed: 0.2 };

        // Weighted Total: Mode-aware accuracy/speed balance
        const total = (
            (accuracyScore * weights.accuracy) +
            (speedScore * weights.speed)
        );

        console.log(`[Performance] Score: ${total.toFixed(2)} | WPM: ${userWPM.toFixed(1)} vs Target: ${targetWPM} `);
        return Math.min(1.0, Math.max(0.0, total));
    }

    /**
     * Get session summary
     */
    getSessionSummary() {
        const totalAttempts = this.sessionData.attempts.length;
        if (totalAttempts === 0) return null;

        const correct = this.sessionData.attempts.filter(a => a.correct).length;
        return {
            mode: this.mode,
            total: totalAttempts,
            accuracy: Math.round((correct / totalAttempts) * 100),
            duration: Math.round((Date.now() - this.sessionData.startTime) / 1000)
        };
    }
}

// Expose class
window.PerformanceTracker = PerformanceTracker;
