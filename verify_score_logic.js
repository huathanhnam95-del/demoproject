
// Mock SRS Cache
const srsCache = {
    srsData: {
        'test_word': {
            lemma: 'test_word',
            interval: 10,
            lastReviewDate: new Date().toISOString(),
            nextReviewDate: new Date().toISOString()
        },
        'new_word': {
            lemma: 'new_word',
            interval: 0.5,
            lastReviewDate: new Date().toISOString()
        }
    }
};

// Mock Save
function saveSRSData() {
    console.log('[Mock] Saved SRS Data');
}

// Mock Toast
function showToast(msg, type) {
    console.log(`[Mock Toast] ${type.toUpperCase()}: ${msg}`);
}

// Function under test (copied from srs-review.js)
function applyAIScoreToSRS(lemma, score) {
    const item = srsCache.srsData[lemma];
    if (!item) return;

    // Skip adjustment for brand new items (learning step < 1 day) to avoid messing up learning phase
    if (item.interval < 1 && item.state !== 'mastered') {
        console.log(`[Logic] Skipped new item: ${lemma}`);
        return;
    }

    let modifier = 1.0;
    let msg = "";
    let type = "info";

    if (score === 5) {
        modifier = 1.25; // +25% Boost
        msg = "Perfect! Interval boosted +25%";
        type = "success";
    } else if (score === 4) {
        modifier = 1.1; // +10% Boost
        msg = "Good job! Interval boosted +10%";
        type = "success";
    } else if (score === 3) {
        // Neutral / Slight refinement needed
        console.log(`[Logic] Score 3 - No change`);
        return;
    } else if (score <= 2) {
        modifier = 0.75; // -25% Penalty
        msg = "Review context. Interval tightened.";
        type = "warning";
    }

    const oldInterval = item.interval;
    // Apply modifier, ensuring at least 1 day if it was >= 1
    let newInterval = Math.round(oldInterval * modifier);
    if (oldInterval >= 1) newInterval = Math.max(1, newInterval);

    if (newInterval !== oldInterval) {
        console.log(`[SRS AI] Adjusting ${lemma} interval: ${oldInterval}d -> ${newInterval}d (Score: ${score})`);

        item.interval = newInterval;

        // Recalculate next date based on LAST review date
        const lastReview = item.lastReviewDate ? new Date(item.lastReviewDate) : new Date();
        const nextDate = new Date(lastReview);
        nextDate.setDate(nextDate.getDate() + newInterval);

        item.nextReviewDate = nextDate.toISOString();

        // Persist
        srsCache.srsData[lemma] = item;
        saveSRSData();

        // Show Toast
        showToast(msg, type);
    } else {
        console.log(`[Logic] No effective change for ${lemma} (Interval ${oldInterval})`);
    }
}

// Test Cases
console.log("--- Test Case 1: Score 5 (Perfect) ---");
applyAIScoreToSRS('test_word', 5); // Should boost 10 -> 12 or 13 (10 * 1.25 = 12.5 -> 13)

console.log("\n--- Test Case 2: Score 1 (Poor) ---");
// Reset
srsCache.srsData['test_word'].interval = 10;
applyAIScoreToSRS('test_word', 1); // Should reduce 10 -> 7.5 -> 8 (0.75) 

console.log("\n--- Test Case 3: New Word (Skip) ---");
applyAIScoreToSRS('new_word', 5);

console.log("\n--- Test Case 4: Score 4 (Good) ---");
srsCache.srsData['test_word'].interval = 20;
applyAIScoreToSRS('test_word', 4); // 20 * 1.1 = 22
