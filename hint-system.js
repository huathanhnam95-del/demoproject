/**
 * Hint System Module
 * Provides progressive hints for Type Mode dictation practice.
 * 
 * Pricing Model:
 * - 3 free hints per day (resets at midnight)
 * - After free hints: 4th = 2 coins, 5th = 4 coins, 6th = 6 coins...
 * - Formula: cost = max(0, (hintNumber - FREE_HINTS_PER_DAY) * COIN_INCREMENT)
 * 
 * Hint Levels (per question):
 * 1. Word Count - "The sentence has X words"
 * 2. First Letters - Show first letter of each word
 * 3. Word Lengths - Show word structure with dashes
 * 4. Key Words - Reveal 2-3 important content words
 * 5. Half Reveal - Show every other word
 */

const HintSystem = (() => {
    // Configuration
    const FREE_HINTS_PER_DAY = 3;
    const COIN_INCREMENT = 2;
    const MAX_HINT_LEVEL = 5;

    // State
    let hintsUsedToday = 0;
    let lastHintDate = null;
    let currentQuestionId = null;
    let currentMode = 'type'; // Default to type
    let currentHintLevel = 0; // 0 = no hints used, 1-5 = hint levels

    // Common function words to exclude from "key words" hint
    const FUNCTION_WORDS = new Set([
        'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
        'from', 'up', 'about', 'into', 'through', 'during', 'including', 'until', 'against', 'among',
        'throughout', 'despite', 'towards', 'upon', 'concerning', 'is', 'are', 'was', 'were', 'be',
        'been', 'being', 'have', 'has', 'had', 'having', 'do', 'does', 'did', 'doing', 'will',
        'would', 'could', 'should', 'may', 'might', 'can', 'must', 'shall', 'this', 'that', 'these',
        'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them',
        'my', 'your', 'his', 'its', 'our', 'their', 'mine', 'yours', 'hers', 'ours', 'theirs',
        'what', 'which', 'who', 'whom', 'whose', 'where', 'when', 'why', 'how', 'all', 'each',
        'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not',
        'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'also', 'now', 'here', 'there',
        'next', 'time', 'then', 'if', 'as', 'because', 'while', 'although', 'though', 'after', 'before'
    ]);

    /**
     * Initialize hint system from Firestore data
     * @param {Object} data - { hintsUsedToday, lastHintDate }
     */
    function init(data = {}) {
        const today = getTodayDateString();

        if (data.lastHintDate === today) {
            hintsUsedToday = data.hintsUsedToday || 0;
        } else {
            // New day - reset hints
            hintsUsedToday = 0;
        }
        lastHintDate = today;
    }

    /**
     * Get today's date as YYYY-MM-DD string
     */
    function getTodayDateString() {
        const now = new Date();
        return now.toISOString().split('T')[0];
    }

    /**
     * Calculate the cost for the next hint
     * @returns {number} Coin cost (0 if free)
     */
    function getNextHintCost() {
        // Check difficulty settings
        if (window.DifficultyManager && currentMode) {
            const settings = window.DifficultyManager.getCurrentSettings(currentMode);
            if (settings && settings.hints === 'unlimited') return 0;
            if (settings && settings.hints === 'none') return 9999; // Prohibitive cost
        }

        const nextHintNumber = hintsUsedToday + 1;
        if (nextHintNumber <= FREE_HINTS_PER_DAY) return 0;
        return (nextHintNumber - FREE_HINTS_PER_DAY) * COIN_INCREMENT;
    }

    /**
     * Get the number of free hints remaining today
     * @returns {number}
     */
    function getFreeHintsRemaining() {
        return Math.max(0, FREE_HINTS_PER_DAY - hintsUsedToday);
    }

    /**
     * Check if user can afford the next hint
     * @param {number} userCoins - User's current coin balance
     * @returns {boolean}
     */
    function canAffordNextHint(userCoins) {
        const cost = getNextHintCost();
        return userCoins >= cost;
    }

    /**
     * Reset hint level for a new question
     * @param {number|string} questionId - The new question ID
     */
    function resetForNewQuestion(questionId, mode = 'type') {
        if (currentQuestionId !== questionId) {
            currentQuestionId = questionId;
            currentMode = mode;
            currentHintLevel = 0;
        }
    }

    /**
     * Get current hint level for the question
     * @returns {number} 0-5
     */
    function getCurrentHintLevel() {
        return currentHintLevel;
    }

    /**
     * Check if more hints are available for current question
     * @returns {boolean}
     */
    function hasMoreHints() {
        // Check difficulty settings
        if (window.DifficultyManager && currentMode) {
            const settings = window.DifficultyManager.getCurrentSettings(currentMode);
            if (settings && settings.hints === 'none') return false;
        }
        return currentHintLevel < MAX_HINT_LEVEL;
    }

    /**
     * Generate a hint based on the level
     * @param {string} correctSentence - The correct sentence
     * @param {number} level - Hint level (1-5)
     * @returns {Object} { type, content, description }
     */
    function generateHint(correctSentence, level) {
        const words = correctSentence.split(/\s+/).filter(Boolean);

        switch (level) {
            case 1:
                return generateWordCountHint(words);
            case 2:
                return generateFirstLettersHint(words);
            case 3:
                return generateWordLengthsHint(words);
            case 4:
                return generateKeyWordsHint(words, correctSentence);
            case 5:
                return generateHalfRevealHint(words);
            default:
                return null;
        }
    }

    /**
     * Level 1: Word Count Hint
     */
    function generateWordCountHint(words) {
        return {
            type: 'word-count',
            level: 1,
            description: 'Word Count',
            content: `The sentence has <strong>${words.length} words</strong>.`
        };
    }

    /**
     * Level 2: First Letters Hint
     * Shows: "T__ t___, w_'__ d______ t__ i________ o_ t__ m____."
     */
    function generateFirstLettersHint(words) {
        const hint = words.map(word => {
            // Preserve punctuation
            const match = word.match(/^([^a-zA-Z]*)([a-zA-Z])([a-zA-Z]*)([^a-zA-Z]*)$/);
            if (match) {
                const [, leadingPunct, firstLetter, rest, trailingPunct] = match;
                const underscores = rest.replace(/[a-zA-Z]/g, '_');
                return `${leadingPunct}${firstLetter}${underscores}${trailingPunct}`;
            }
            return word; // Return as-is if no letters
        }).join(' ');

        return {
            type: 'first-letters',
            level: 2,
            description: 'First Letters',
            content: `<span class="hint-text-mono">${hint}</span>`
        };
    }

    /**
     * Level 3: Word Lengths Hint
     * Shows: "---- ----, --'-- ------- --- --------- -- --- ----- -- ------ ------."
     */
    function generateWordLengthsHint(words) {
        const hint = words.map(word => {
            return word.replace(/[a-zA-Z]/g, '–');
        }).join(' ');

        return {
            type: 'word-lengths',
            level: 3,
            description: 'Word Lengths',
            content: `<span class="hint-text-mono">${hint}</span>`
        };
    }

    /**
     * Level 4: Key Words Hint
     * Reveals 2-3 important content words
     */
    function generateKeyWordsHint(words, originalSentence) {
        // Find content words (not function words, length > 3)
        const contentWordIndices = [];
        words.forEach((word, idx) => {
            const cleanWord = word.replace(/[^a-zA-Z]/g, '').toLowerCase();
            if (cleanWord.length > 3 && !FUNCTION_WORDS.has(cleanWord)) {
                contentWordIndices.push(idx);
            }
        });

        // Select 2-3 key words spread across the sentence
        let selectedIndices = [];
        if (contentWordIndices.length <= 3) {
            selectedIndices = contentWordIndices;
        } else {
            // Pick first, middle, and last content word
            selectedIndices = [
                contentWordIndices[0],
                contentWordIndices[Math.floor(contentWordIndices.length / 2)],
                contentWordIndices[contentWordIndices.length - 1]
            ];
        }

        const hint = words.map((word, idx) => {
            if (selectedIndices.includes(idx)) {
                return `<strong class="hint-keyword">${word}</strong>`;
            }
            // Replace letters with underscores, keep punctuation
            return word.replace(/[a-zA-Z]/g, '_');
        }).join(' ');

        return {
            type: 'key-words',
            level: 4,
            description: 'Key Words',
            content: `<span class="hint-text-mono">${hint}</span>`
        };
    }

    /**
     * Level 5: Half Reveal Hint
     * Shows every other word
     */
    function generateHalfRevealHint(words) {
        const hint = words.map((word, idx) => {
            if (idx % 2 === 0) {
                return `<strong>${word}</strong>`;
            }
            // Replace letters with underscores, keep punctuation
            return word.replace(/[a-zA-Z]/g, '_');
        }).join(' ');

        return {
            type: 'half-reveal',
            level: 5,
            description: 'Half Reveal',
            content: `<span class="hint-text-mono">${hint}</span>`
        };
    }

    // In-flight lock to prevent double-triggering
    let useHintInFlight = false;

    /**
     * Use a hint - increments level and deducts coins if needed
     * @param {string} correctSentence - The correct sentence
     * @param {number} userCoins - Current user coin balance
     * @param {Function} deductCoins - Async function to deduct coins
     * @returns {Promise<Object>} { success, hint, cost, freeRemaining, error }
     */
    async function useHint(correctSentence, userCoins, deductCoins) {
        // Check in-flight lock to prevent double-triggering
        if (useHintInFlight) {
            console.log('⏭ useHint skipped: already in-flight');
            return {
                success: false,
                error: 'Request already in progress',
                skipped: true
            };
        }
        useHintInFlight = true;

        try {
            // Check if more hints available
            if (!hasMoreHints()) {
                return {
                    success: false,
                    error: 'All hints revealed for this question.',
                    maxReached: true
                };
            }

            const cost = getNextHintCost();

            // Check if user can afford
            if (userCoins < cost) {
                return {
                    success: false,
                    error: 'Not enough coins',
                    needed: cost,
                    have: userCoins
                };
            }

            // Deduct coins if not free
            if (cost > 0 && deductCoins) {
                try {
                    await deductCoins(cost);
                } catch (err) {
                    return {
                        success: false,
                        error: 'Failed to deduct coins',
                        details: err.message
                    };
                }
            }

            // Increment counters
            hintsUsedToday++;
            currentHintLevel++;
            lastHintDate = getTodayDateString();

            // Generate hint
            const hint = generateHint(correctSentence, currentHintLevel);

            // Save to localStorage
            saveHintUsage();

            return {
                success: true,
                hint,
                cost,
                freeRemaining: getFreeHintsRemaining(),
                nextCost: getNextHintCost(),
                hasMore: hasMoreHints(),
                level: currentHintLevel
            };
        } finally {
            // Release lock after a short delay to prevent rapid re-clicks
            setTimeout(() => {
                useHintInFlight = false;
            }, 300);
        }
    }


    /**
     * Save hint usage to localStorage
     */
    function saveHintUsage() {
        try {
            const data = {
                hintsUsedToday,
                lastHintDate
            };
            localStorage.setItem('hintSystemUsage', JSON.stringify(data));
        } catch (err) {
            console.error('Failed to save hint usage:', err);
        }
    }

    /**
     * Load hint usage from localStorage
     */
    function loadHintUsage() {
        try {
            const stored = localStorage.getItem('hintSystemUsage');
            if (stored) {
                const data = JSON.parse(stored);
                const today = getTodayDateString();

                if (data.lastHintDate === today) {
                    hintsUsedToday = data.hintsUsedToday || 0;
                } else {
                    // New day - reset hints
                    hintsUsedToday = 0;
                }
                lastHintDate = today;
            }
        } catch (err) {
            console.error('Failed to load hint usage:', err);
        }
    }

    // Auto-load on initialization
    loadHintUsage();


    /**
     * Get hint state for UI display
     * @returns {Object}
     */
    function getState() {
        return {
            hintsUsedToday,
            freeRemaining: getFreeHintsRemaining(),
            nextCost: getNextHintCost(),
            currentLevel: currentHintLevel,
            maxLevel: MAX_HINT_LEVEL,
            hasMore: hasMoreHints()
        };
    }

    // Public API
    return {
        init,
        resetForNewQuestion,
        getCurrentHintLevel,
        hasMoreHints,
        getNextHintCost,
        getFreeHintsRemaining,
        canAffordNextHint,
        useHint,
        getState,
        generateHint, // Exposed for testing
        MAX_HINT_LEVEL
    };
})();

// Expose to window
window.HintSystem = HintSystem;
