/**
 * CollocationRater
 * Scores English phrases based on suitability for A2-B1 learners.
 */
export const CollocationRater = {
    /**
     * Score a phrase from 0 to 100
     * @param {string} phrase - The collocation phrase (e.g. "heavy rain")
     * @param {string} targetWord - The word being practiced
     * @returns {number} Score
     */
    score(phrase, targetWord) {
        if (!phrase) return 0;

        let score = 0;
        const words = phrase.split(' ');
        const phraseClean = phrase.toLowerCase().trim();

        // 1. Complexity & Length (40 points)
        // Ideal length: 2-4 words
        if (words.length >= 2 && words.length <= 4) {
            score += 40;
        } else if (words.length === 1) {
            score += 10; // Better than nothing but not a "phrase"
        } else {
            score += 20; // Too long, might be complex
        }

        // Penalty for very long words (rare/difficult)
        const hasRareWord = words.some(w => w.length > 9);
        if (hasRareWord) score -= 15;

        // 2. Daily Relevance (30 points)
        const DAILY_KEYWORDS = [
            'time', 'family', 'money', 'food', 'work', 'home', 'friend', 'school',
            'day', 'water', 'life', 'city', 'job', 'car', 'house', 'pet', 'dog', 'cat',
            'eat', 'drink', 'sleep', 'go', 'see', 'want', 'need', 'like', 'love'
        ];

        const hasDailyKeyword = DAILY_KEYWORDS.some(kw => phraseClean.includes(kw));
        if (hasDailyKeyword) score += 30;

        // 3. Contextual Fit (30 points)
        // Does it actually contain the target word? (Essential)
        if (phraseClean.includes(targetWord.toLowerCase())) {
            score += 30;
        }

        // Normalize
        return Math.max(0, Math.min(100, score));
    }
};
