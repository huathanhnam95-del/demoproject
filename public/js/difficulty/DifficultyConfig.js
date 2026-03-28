/**
 * DifficultyConfig.js
 * Centralized configuration for difficulty levels and thresholds.
 */

export const DifficultyConfig = {
    LEVELS: {
        MIN: 1,
        MAX: 6,
        NAMES: {
            1: 'A1 (Beginner I)',
            2: 'A2 (Beginner II)',
            3: 'B1 (Intermediate I)',
            4: 'B2 (Intermediate II)',
            5: 'C1 (Expert I)',
            6: 'C2 (Expert II)'
        }
    },
    CONTENT_TIERS: {
        MIN: 1,
        MAX: 3
    },
    HISTORY_SIZE: 20,
    GRACE_PERIOD_ATTEMPTS: 10,
    THRESHOLDS: {
        UP: 0.85,
        DOWN: 0.60,
        SMURF: 0.98
    },
    ADJUSTMENT: {
        WINDOW_SIZES: {
            low: 15,
            medium: 10,
            high: 5
        },
        DEFAULT_SENSITIVITY: 'medium'
    },
    MODE_SETTINGS: {
        type: {
            1: { maxReplays: 5, sentenceLengthRange: [5, 8], autoShowWordCount: true, autoShowFirstLetters: true, autoShowWordLengths: true, topicHint: true, keywordPreview: true, delayBeforeTyping: 0, initialRevealPercentage: 50 },
            2: { maxReplays: 5, sentenceLengthRange: [8, 12], autoShowWordCount: true, autoShowFirstLetters: false, autoShowWordLengths: true, topicHint: true, keywordPreview: true, delayBeforeTyping: 1, initialRevealPercentage: 40 },
            3: { maxReplays: 5, sentenceLengthRange: [12, 18], autoShowWordCount: true, autoShowFirstLetters: false, autoShowWordLengths: false, topicHint: true, keywordPreview: false, delayBeforeTyping: 3, initialRevealPercentage: 30 },
            4: { maxReplays: 5, sentenceLengthRange: [18, 25], autoShowWordCount: false, autoShowFirstLetters: false, autoShowWordLengths: false, topicHint: true, keywordPreview: false, delayBeforeTyping: 4, initialRevealPercentage: 15 },
            5: { maxReplays: 5, sentenceLengthRange: [25, 35], autoShowWordCount: false, autoShowFirstLetters: false, autoShowWordLengths: false, topicHint: false, keywordPreview: false, delayBeforeTyping: 5, initialRevealPercentage: 0 },
            6: { maxReplays: 5, sentenceLengthRange: [30, 999], autoShowWordCount: false, autoShowFirstLetters: false, autoShowWordLengths: false, topicHint: false, keywordPreview: false, delayBeforeTyping: 6, initialRevealPercentage: 0 }
        },
        speak: {
            1: { strictness: 'low', showIPA: true, maxReplays: 5 },
            2: { strictness: 'low', showIPA: true, maxReplays: 5 },
            3: { strictness: 'medium', showIPA: true, maxReplays: 5 },
            4: { strictness: 'medium', showIPA: false, maxReplays: 5 },
            5: { strictness: 'high', showIPA: false, maxReplays: 5 },
            6: { strictness: 'high', showIPA: false, maxReplays: 5 }
        },
        srs: {
            1: { typoTolerance: 2, showDef: true },
            2: { typoTolerance: 2, showDef: true },
            3: { typoTolerance: 1, showDef: true },
            4: { typoTolerance: 1, showDef: true },
            5: { typoTolerance: 0, showDef: false },
            6: { typoTolerance: 0, showDef: false }
        },
        extended: {
            1: { maxReplays: 5, showHints: true },
            2: { maxReplays: 5, showHints: true },
            3: { maxReplays: 5, showHints: false },
            4: { maxReplays: 5, showHints: false },
            5: { maxReplays: 5, showHints: false },
            6: { maxReplays: 5, showHints: false }
        },
        rfib: {
            1: { maxReplays: 5, showHints: true },
            2: { maxReplays: 5, showHints: true },
            3: { maxReplays: 5, showHints: false },
            4: { maxReplays: 5, showHints: false },
            5: { maxReplays: 5, showHints: false },
            6: { maxReplays: 5, showHints: false }
        },
        notes: {
            1: { maxReplays: 5, showTranscript: true },
            2: { maxReplays: 4, showTranscript: true },
            3: { maxReplays: 3, showTranscript: false },
            4: { maxReplays: 3, showTranscript: false },
            5: { maxReplays: 2, showTranscript: false },
            6: { maxReplays: 2, showTranscript: false }
        }
    },
    getContentTierForLevel(level) {
        const safeLevel = Math.max(this.LEVELS.MIN, Math.min(this.LEVELS.MAX, Number(level) || 1));
        if (safeLevel <= 2) return 1;
        if (safeLevel <= 4) return 2;
        return 3;
    },
    STORAGE_KEY: 'difficulty_profile'
};
