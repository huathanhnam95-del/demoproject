
// srs_tests.js
// Standalone logic verification script for Antigravity SRS Scheduler

import { SRSScheduler, ALGORITHM, RATING, CARD_STATE, SM2_CONFIG } from './srs-scheduler.js';

console.log("=== SRS Logic Verification Suite ===");

// --- HELPER: Mock User Function for "expect" ---
function expect(value) {
    return {
        toBe: (expected) => {
            if (value === expected) console.log(`   ✅ Pass: got ${value}`);
            else console.error(`   ❌ FAIL: expected ${expected}, got ${value}`);
        },
        toBeGreaterThanOrEqual: (expected) => {
            if (value >= expected) console.log(`   ✅ Pass: ${value} >= ${expected}`);
            else console.error(`   ❌ FAIL: expected >= ${expected}, got ${value}`);
        },
        toBeLessThanOrEqual: (expected) => {
            if (value <= expected) console.log(`   ✅ Pass: ${value} <= ${expected}`);
            else console.error(`   ❌ FAIL: expected <= ${expected}, got ${value}`);
        },
        toBeCloseTo: (expected, delta = 0.5) => {
            if (Math.abs(value - expected) <= delta) console.log(`   ✅ Pass: ${value} close to ${expected}`);
            else console.error(`   ❌ FAIL: expected ${expected} +/- ${delta}, got ${value}`);
        }
    };
}

// --- TEST 1: SM-2 Good Rating (Interval Doubling) ---
console.log("\n[TEST 1] SM-2 'Good' Interval Calculation");
(function testSM2Good() {
    // Setup: Interval 1, Ease 2.5. Expect Next: 1 * 2.5 = 2.5 -> ceil/round -> ~3 (plus fuzz)
    const card = {
        interval: 1,
        easeFactor: 2.5,
        state: CARD_STATE.REVIEWING,
        algorithm: ALGORITHM.SM2
    };

    // We run multiple times to check fuzz range
    console.log("   Input: Interval=1, Ease=2.5");
    const result = SRSScheduler.calculate(card, RATING.GOOD, ALGORITHM.SM2);

    console.log(`   Result Interval: ${result.interval}`);
    // Base is 3 (2.5 rounded). Fuzz on interval > 1 is 95-105%.
    // 3 * 0.95 = 2.85 (rounds to 3). 3 * 1.05 = 3.15 (rounds to 3).
    // So usually stays 3. 
    // Wait, let's trace logic: 
    // newInterval = 1 * 2.5 = 2.5 -> round(2.5) = 3.
    // Fuzz check: if (newInterval > 1). 3 > 1 checks out.
    expect(result.interval).toBeCloseTo(3, 1);
    expect(result.easeFactor).toBe(2.5); // Ease shouldn't change on Good
})();

// --- TEST 2: SM-2 Hard Rating (Static 1.2x) ---
console.log("\n[TEST 2] SM-2 'Hard' Interval Calculation");
(function testSM2Hard() {
    // Setup: Interval 10. Expect: 10 * 1.2 = 12.
    const card = {
        interval: 10,
        easeFactor: 2.5,
        state: CARD_STATE.REVIEWING,
        algorithm: ALGORITHM.SM2
    };

    const result = SRSScheduler.calculate(card, RATING.HARD, ALGORITHM.SM2);
    console.log(`   Result Interval: ${result.interval}`);

    // 12 * 0.95 = 11.4 (11). 12 * 1.05 = 12.6 (13).
    // Should be between 11 and 13.
    expect(result.interval).toBeGreaterThanOrEqual(11);
    expect(result.interval).toBeLessThanOrEqual(13);

    // Ease penalty: 2.5 - 0.15 = 2.35
    expect(result.easeFactor).toBeCloseTo(2.35, 0.01);
})();

// --- TEST 3: SM-2 Fuzzing Distribution ---
console.log("\n[TEST 3] SM-2 Fuzzing Scope");
(function testSM2Fuzz() {
    // Setup: Interval 100. Base = 100 * 2.5 = 250.
    const card = { interval: 100, easeFactor: 2.5, state: CARD_STATE.REVIEWING };

    const intervals = [];
    for (let i = 0; i < 50; i++) {
        intervals.push(SRSScheduler.calculate(card, RATING.GOOD).interval);
    }

    const min = Math.min(...intervals);
    const max = Math.max(...intervals);
    console.log(`   100 Day base -> Range observed: ${min} to ${max}`);

    // 250 * 0.95 = 237.5. 250 * 1.05 = 262.5.
    expect(min).toBeGreaterThanOrEqual(237);
    expect(max).toBeLessThanOrEqual(263);

    // Verify it's not static
    if (min === max) console.error("   ❌ FAIL: No fuzzing observed (values identical)");
    else console.log("   ✅ Pass: Fuzzing observed");
})();


// --- TEST 4: FSRS Prediction ---
console.log("\n[TEST 4] FSRS Basic Flow");
(function testFSRS() {
    // Note: FSRS calculations are complex and lib-dependent.
    // We mostly verify it returns a valid structure and stability > 0.
    const card = SRSScheduler.initializeCard(ALGORITHM.FSRS);
    console.log("   Initialized FSRS Card:", JSON.stringify(card.fsrs));

    const result = SRSScheduler.calculate(card, RATING.GOOD, ALGORITHM.FSRS);
    console.log(`   Result Step: ${result.interval} days`);
    console.log(`   Result Stability: ${result.fsrs.stability}`);

    expect(result.interval).toBeGreaterThanOrEqual(0);
    if (result.fsrs.stability > 0) console.log("   ✅ Pass: Stability increased");
    else console.error("   ❌ FAIL: Stability did not increase");
})();

console.log("\n=== Test Suite Complete ===");
