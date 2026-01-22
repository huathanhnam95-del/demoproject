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

        // Weights for scoring
        this.weights = {
            accuracy: 0.50,
            speed: 0.20,
            hints: 0.20,
            consistency: 0.10
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

        // Send to DifficultyManager
        if (window.DifficultyManager) {
            window.DifficultyManager.adjustDifficulty(this.mode, attemptScore);
        }
    }

    /**
     * Calculate score for a single attempt
     */
    calculateAttemptScore(attempt) {
        // 1. Accuracy (Pass/Fail adjusted by tries)
        // Correct on 1st try = 1.0
        // Correct on 2nd try = 0.7
        // Correct on 3rd+ try = 0.4
        // Failed = 0.0
        let accuracyScore = 0;
        if (attempt.correct) {
            if (attempt.attempts === 1) accuracyScore = 1.0;
            else if (attempt.attempts === 2) accuracyScore = 0.7;
            else accuracyScore = 0.4;
        }

        // 2. Speed (Context dependent, but normalized here)
        // Assume ideal time is < 5s for short, < 10s for med
        // We'll use a simple decay: Score = 1 / (1 + time/20) 
        // 5s -> 0.8, 10s -> 0.66, 20s -> 0.5
        const timeScore = 1 / (1 + (attempt.timeTaken / 30));

        // 3. Hint Usage
        // No hint = 1.0, Hint = 0.0
        const hintScore = attempt.hintUsed ? 0.0 : 1.0;

        // Weighted Total
        const total = (
            (accuracyScore * this.weights.accuracy) +
            (timeScore * this.weights.speed) +
            (hintScore * this.weights.hints)
        ) / (this.weights.accuracy + this.weights.speed + this.weights.hints); // Normalize denominator

        return total;
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
