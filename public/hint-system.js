/**
 * Hint System Module
 * Progressive hints for dictation practice (primarily Type mode).
 *
 * Economy / Skill Tree:
 * - Coin spending + unlock checks are server-authoritative via `useActiveSkill`.
 * - This module is intentionally economy-agnostic: it only tracks per-question hint state
 *   and generates hint content for the UI.
 *
 * Hint Levels (per question)
 * 1) Word Count
 * 2) First Letters
 * 3) Transcript Glimpse (temporary, full sentence)
 */

const HintSystem = (() => {
    const MAX_HINT_LEVEL = 3;
    const TRANSCRIPT_GLIMPSE_MS = 2000;

    let currentQuestionId = null;
    let currentMode = 'type';
    let currentHintLevel = 0; // 0 = none, 1..MAX_HINT_LEVEL = ladder

    /**
     * Reset hint ladder when switching to a new question.
     * @param {number|string} questionId
     * @param {string} mode
     */
    function resetForNewQuestion(questionId, mode = 'type') {
        if (currentQuestionId !== questionId || currentMode !== mode) {
            currentQuestionId = questionId;
            currentMode = mode;
            currentHintLevel = 0;
        }
    }

    function reset() {
        currentHintLevel = 0;
        currentQuestionId = null;
        currentMode = 'type';
    }

    function getCurrentHintLevel() {
        return currentHintLevel;
    }

    /**
     * Advance the ladder level without charging or marking assistance.
     * Used for baseline (free) scaffolding at low CEFR.
     * @param {number} level
     */
    function primeHintLevel(level) {
        const safe = Math.max(0, Math.min(MAX_HINT_LEVEL, Number(level) || 0));
        currentHintLevel = Math.max(currentHintLevel, safe);
    }

    function hasMoreHints() {
        return currentHintLevel < MAX_HINT_LEVEL;
    }

    /**
     * Generate hint content for a specific ladder level.
     * @param {string} correctSentence
     * @param {number} level
     * @returns {{type:string, level:number, description:string, content?:string, contentText?:string, transientMs?:number}|null}
     */
    function generateHint(correctSentence, level) {
        const text = String(correctSentence || '').trim();
        const words = text.split(/\s+/).filter(Boolean);

        switch (level) {
            case 1:
                return generateWordCountHint(words);
            case 2:
                return generateFirstLettersHint(words);
            case 3:
                return generateTranscriptGlimpseHint(text);
            default:
                return null;
        }
    }

    function generateWordCountHint(words) {
        return {
            type: 'word-count',
            level: 1,
            description: 'Word Count',
            content: `The sentence has <strong>${words.length} words</strong>.`
        };
    }

    function generateFirstLettersHint(words) {
        const hint = words.map(word => {
            const match = word.match(/^([^a-zA-Z]*)([a-zA-Z])([a-zA-Z]*)([^a-zA-Z]*)$/);
            if (match) {
                const [, leadingPunct, firstLetter, rest, trailingPunct] = match;
                const underscores = rest.replace(/[a-zA-Z]/g, '_');
                return `${leadingPunct}${firstLetter}${underscores}${trailingPunct}`;
            }
            return word;
        }).join(' ');

        return {
            type: 'first-letters',
            level: 2,
            description: 'First Letters',
            content: `<span class="hint-text-mono">${hint}</span>`
        };
    }

    function generateTranscriptGlimpseHint(correctSentence) {
        return {
            type: 'transcript-glimpse',
            level: 3,
            description: 'Transcript Glimpse',
            contentText: String(correctSentence || ''),
            transientMs: TRANSCRIPT_GLIMPSE_MS
        };
    }

    /**
     * Use the next hint in the ladder for the current question.
     * @param {string} correctSentence
     * @returns {{success:boolean, hint?:object, level?:number, hasMore?:boolean, error?:string, maxReached?:boolean}}
     */
    function useHint(correctSentence) {
        if (!hasMoreHints()) {
            return {
                success: false,
                error: 'All hints revealed for this question.',
                maxReached: true
            };
        }

        currentHintLevel++;
        const hint = generateHint(correctSentence, currentHintLevel);

        return {
            success: true,
            hint,
            level: currentHintLevel,
            hasMore: hasMoreHints()
        };
    }

    function getState() {
        return {
            currentLevel: currentHintLevel,
            maxLevel: MAX_HINT_LEVEL,
            hasMore: hasMoreHints()
        };
    }

    return {
        reset,
        resetForNewQuestion,
        getCurrentHintLevel,
        primeHintLevel,
        hasMoreHints,
        generateHint,
        useHint,
        getState,
        MAX_HINT_LEVEL
    };
})();

// Expose to window
window.HintSystem = HintSystem;

