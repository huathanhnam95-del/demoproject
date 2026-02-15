/**
 * DifficultyLogic.js
 * Pure logic for calculating difficulty adjustments.
 */
import { DifficultyConfig } from './DifficultyConfig.js';

export class DifficultyLogic {
    constructor() {
        this.config = DifficultyConfig;
    }

    makeDefaultProfile() {
        return {
            level: 1,
            exp: 0,
            history: [],
            attemptsAtLevel: 0
        };
    }

    /**
     * Process a new score and determine if difficulty should change.
     * @param {Object} profile - User's difficulty profile for a mode.
     * @param {number} score - Performance score (0.0 - 1.0).
     * @param {Object} settings - Global settings (sensitivity, autoAdjust).
     * @returns {Object|null} - { newLevel, direction } if changed, else null.
     */
    calculateAdjustment(profile, score, settings) {
        if (!settings.autoAdjustEnabled) return null;

        // Validation
        const safeScore = Math.max(0, Math.min(1, Number(score) || 0));
        const currentLevel = Math.max(this.config.LEVELS.MIN, Math.min(this.config.LEVELS.MAX, profile.level || 1));

        // Smurf Detection (Fast Track)
        // Check last 5 attempts at current level
        const recent = (profile.history || []).filter(h => h.level === currentLevel).slice(-5);
        const isSmurfing = recent.length === 5 && recent.every(h =>
            h.score >= this.config.THRESHOLDS.SMURF && !h.assisted
        );

        if (isSmurfing && currentLevel < this.config.LEVELS.MAX) {
            return { newLevel: currentLevel + 1, direction: 'increase', reason: 'smurf' };
        }

        // Rolling Average Logic
        const windowSize = this.config.ADJUSTMENT.WINDOW_SIZES[settings.adjustmentSensitivity] || 10;
        const attemptsAtLevel = profile.history.filter(h => h.level === currentLevel);

        if (attemptsAtLevel.length >= windowSize && profile.attemptsAtLevel >= this.config.GRACE_PERIOD_ATTEMPTS) {
            const window = attemptsAtLevel.slice(-windowSize);
            const avg = window.reduce((sum, h) => sum + h.score, 0) / windowSize;

            if (avg > this.config.THRESHOLDS.UP && currentLevel < this.config.LEVELS.MAX) {
                // Consistency check (last 3 must be decent)
                const lastThree = window.slice(-3);
                if (lastThree.every(h => h.score >= 0.70)) {
                    return { newLevel: currentLevel + 1, direction: 'increase', reason: 'performance' };
                }
            } else if (avg < this.config.THRESHOLDS.DOWN && currentLevel > this.config.LEVELS.MIN) {
                return { newLevel: currentLevel - 1, direction: 'decrease', reason: 'struggle' };
            }
        }

        return null;
    }

    getLevelSettings(mode, level) {
        const modeSettings = this.config.MODE_SETTINGS[mode] || this.config.MODE_SETTINGS['type'];
        const safeLevel = Math.max(this.config.LEVELS.MIN, Math.min(this.config.LEVELS.MAX, level));

        // Fallback to level 1 if specific level config missing
        const settings = modeSettings[safeLevel] || modeSettings[1];

        return {
            level: safeLevel,
            name: this.config.LEVELS.NAMES[safeLevel],
            ...settings
        };
    }
}
