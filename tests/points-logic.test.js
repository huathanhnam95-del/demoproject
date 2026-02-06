/**
 * Test Suite for Points Logic Module (v5)
 * Run with: node tests/points-logic.test.js
 */

const assert = require('assert');
const Logic = require('../public/js/points-logic.js');

console.log('🧪 Starting Points Logic (v5) Tests...');

// ============================================
// 1. Partial Credit Curve Tests
// ============================================
console.log('\n[1] Partial Credit Curve');

function testPartialCredit(accuracy, expectedMultRange) {
    const result = Logic.calculateActivityPoints(10, 1.0, accuracy);
    const mult = result.meta.creditMult;

    if (mult >= expectedMultRange[0] && mult <= expectedMultRange[1]) {
        console.log(`✅ Accuracy ${accuracy}: Mult ${mult} within [${expectedMultRange}]`);
    } else {
        console.error(`❌ Accuracy ${accuracy}: Mult ${mult} OUTSIDE [${expectedMultRange}]`);
        process.exit(1);
    }
}

// 0.1 + 0.9 * Acc^1.5
testPartialCredit(0.05, [0.10, 0.12]);
testPartialCredit(0.50, [0.40, 0.43]);
testPartialCredit(0.90, [0.85, 0.88]);
testPartialCredit(1.00, [1.1, 1.1]);   // Perfect bonus

// ============================================
// 2. Difficulty Guardrail Tests (Soft Fade)
// ============================================
console.log('\n[2] Difficulty Guardrails (Soft Fade)');

// Hard task (2.0), Acc 0.3 (Below threshold 0.6 for type used in verify logic)
// Let's assume default threshold 0.5 for test unless specified
// Code uses `calculateActivityPoints(base, diff, acc, mode)`

// Case A: Below Threshold -> Degrades
// Threshold 0.5. Acc 0.25 (50% of threshold).
// Qual = 0.5. EffDiff = 1.0 + (2.0-1.0)*0.5 = 1.5
const hardFade = Logic.calculateActivityPoints(10, 2.0, 0.25, 'default');
console.log(`Hard Task (Acc 0.25, Thresh 0.5): Effective Diff ${hardFade.meta.effectiveDiff} (Expected 1.5)`);
assert.strictEqual(hardFade.meta.effectiveDiff, 1.5, 'Guardrail should fade difficulty halfway');

// Case B: Above Threshold -> Full Power
const hardPass = Logic.calculateActivityPoints(10, 2.0, 0.6, 'default');
console.log(`Hard Task (Acc 0.6, Thresh 0.5): Effective Diff ${hardPass.meta.effectiveDiff} (Expected 2.0)`);
assert.strictEqual(hardPass.meta.effectiveDiff, 2.0, 'Difficulty should be full on pass');


// ============================================
// 3. Skill Distribution Tests (Clean Matrix)
// ============================================
console.log('\n[3] Clean Skill Distribution');

// Type: Writ 60, List 40, Read 0, Speak 0
const typePoints = Logic.distributePointsToSkills('type', 100);
console.log('Type (100 pts) ->', typePoints);
assert.strictEqual(typePoints.writing, 60, 'Type writing weight correct');
assert.strictEqual(typePoints.listening, 40, 'Type listening weight correct');
assert.strictEqual(typePoints.speaking, 0, 'Type speaking should be 0');

// Speak: Speak 80, List 20
const speakPoints = Logic.distributePointsToSkills('speak', 100);
console.log('Speak (100 pts) ->', speakPoints);
assert.strictEqual(speakPoints.speaking, 80, 'Speak speaking weight correct');


// ============================================
// 4. Rating Performance Caps (Track B)
// ============================================
console.log('\n[4] Rating Performance Caps');

// Easy (1.0) perfect -> Cap 60 (B1)
const easyPerf = Logic.calculatePerformanceScore(1.0, 1.0);
console.log(`Easy Perfect (1.0x, 100%): ${easyPerf} (Expected 60)`);
assert.strictEqual(easyPerf, 60, 'Easy tasks capped at 60');

// Hard (2.0) perfect -> Cap 90 (C1)
const hardPerf = Logic.calculatePerformanceScore(2.0, 1.0);
console.log(`Hard Perfect (2.0x, 100%): ${hardPerf} (Expected 90)`);
assert.strictEqual(hardPerf, 90, 'Hard tasks capped at 90');

// Expert (2.5) perfect -> Cap 100 (C2)
const expertPerf = Logic.calculatePerformanceScore(2.5, 1.0);
console.log(`Expert Perfect (2.5x, 100%): ${expertPerf} (Expected 100)`);
assert.strictEqual(expertPerf, 100, 'Expert tasks capped at 100');


// ============================================
// 5. Rating Stability Clamp
// ============================================
console.log('\n[5] Rating Stability Clamp (+/- 3)');

// Huge Jump Attempt: Current 50, Perf 100.
// Raw Delta = 0.1 * (100 - 50) = +5.
// Clamp should limit to +3. New = 53.
const clampedUp = Logic.updateRating(50, 100);
console.log(`Rating 50 -> Perf 100 (Delta +5) -> New ${clampedUp} (Expected 53)`);
assert.strictEqual(clampedUp, 53, 'Rating increase should be clamped to +3');

// Huge Drop Attempt: Current 50, Perf 0.
// Raw Delta = 0.1 * (0 - 50) = -5.
// Clamp should limit to -3. New = 47.
const clampedDown = Logic.updateRating(50, 0);
console.log(`Rating 50 -> Perf 0 (Delta -5) -> New ${clampedDown} (Expected 47)`);
assert.strictEqual(clampedDown, 47, 'Rating drop should be clamped to -3');


console.log('\n✅ ALL V5 TESTS PASSED');
