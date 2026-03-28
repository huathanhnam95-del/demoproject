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

    sanitizeProfile(profile) {
        if (!profile || typeof profile !== 'object') {
            return this.makeDefaultProfile();
        }

        const clampLevel = (value) => {
            const parsed = Number.parseInt(value, 10);
            if (!Number.isFinite(parsed)) return 1;
            return Math.max(this.config.LEVELS.MIN, Math.min(this.config.LEVELS.MAX, parsed));
        };

        const clampScore = (value) => {
            const parsed = Number(value);
            if (!Number.isFinite(parsed)) return 0;
            return Math.max(0, Math.min(1, parsed));
        };

        const normalizedHistory = Array.isArray(profile.history)
            ? profile.history.map((entry) => {
                if (!entry || typeof entry !== 'object') return null;
                return {
                    date: Number.isFinite(Number(entry.date)) ? Number(entry.date) : Date.now(),
                    score: clampScore(entry.score),
                    level: clampLevel(entry.level),
                    assisted: !!entry.assisted,
                    calibMult: Number.isFinite(Number(entry.calibMult))
                        ? Math.max(0.25, Math.min(1.0, Number(entry.calibMult)))
                        : 1.0
                };
            }).filter(Boolean).slice(-this.config.HISTORY_SIZE)
            : [];

        return {
            level: clampLevel(profile.level),
            exp: Number.isFinite(Number(profile.exp)) ? Number(profile.exp) : 0,
            history: normalizedHistory,
            attemptsAtLevel: Number.isFinite(Number(profile.attemptsAtLevel))
                ? Math.max(0, Number(profile.attemptsAtLevel))
                : normalizedHistory.length
        };
    }

    /**
     * Check if the user has accumulated enough history to be considered calibrated.
     */
    isCalibrated(profile) {
        const safeProfile = this.sanitizeProfile(profile);
        const attempts = safeProfile.attemptsAtLevel || 0;
        const historyLen = safeProfile.history ? safeProfile.history.length : 0;
        return (attempts >= this.config.GRACE_PERIOD_ATTEMPTS) || (historyLen >= this.config.GRACE_PERIOD_ATTEMPTS);
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
        const safeProfile = this.sanitizeProfile(profile);
        const currentLevel = Math.max(this.config.LEVELS.MIN, Math.min(this.config.LEVELS.MAX, safeProfile.level || 1));

        // Smurf Detection (Fast Track)
        // Check last 5 attempts at current level
        const recent = (safeProfile.history || []).filter(h => h.level === currentLevel).slice(-5);
        const isSmurfing = recent.length === 5 && recent.every(h =>
            h.score >= this.config.THRESHOLDS.SMURF && !h.assisted
        );

        if (isSmurfing && currentLevel < this.config.LEVELS.MAX) {
            return { newLevel: currentLevel + 1, direction: 'increase', reason: 'smurf' };
        }

        // Rolling Average Logic
        const windowSize = this.config.ADJUSTMENT.WINDOW_SIZES[settings.adjustmentSensitivity] || 10;
        const attemptsAtLevel = (safeProfile.history || []).filter(h => h.level === currentLevel);
        const EPSILON = 1e-9;

        if (attemptsAtLevel.length >= windowSize && safeProfile.attemptsAtLevel >= this.config.GRACE_PERIOD_ATTEMPTS) {
            const window = attemptsAtLevel.slice(-windowSize);
            const avg = window.reduce((sum, h) => sum + h.score, 0) / windowSize;
            const meetsPromotionThreshold = avg >= this.config.THRESHOLDS.UP || Math.abs(avg - this.config.THRESHOLDS.UP) <= EPSILON;
            const meetsDemotionThreshold = avg <= this.config.THRESHOLDS.DOWN || Math.abs(avg - this.config.THRESHOLDS.DOWN) <= EPSILON;

            if (meetsPromotionThreshold && currentLevel < this.config.LEVELS.MAX) {
                // Consistency check (last 3 must be decent)
                const lastThree = window.slice(-3);
                if (lastThree.every(h => h.score >= 0.70)) {
                    return { newLevel: currentLevel + 1, direction: 'increase', reason: 'performance' };
                }
            } else if (meetsDemotionThreshold && currentLevel > this.config.LEVELS.MIN) {
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
            contentTier: this.config.getContentTierForLevel(safeLevel),
            ...settings
        };
    }
}
