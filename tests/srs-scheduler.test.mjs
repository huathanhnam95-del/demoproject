import test from 'node:test';
import assert from 'node:assert/strict';
import { SRSScheduler, ALGORITHM, CARD_STATE, RATING } from '../public/srs-scheduler.js';

test('SM-2 Algorithm - New Card Graduation', () => {
    const card = SRSScheduler.initializeCard(ALGORITHM.SM2);

    // Good rating on first step (1m)
    let result = SRSScheduler.calculate(card, RATING.GOOD, ALGORITHM.SM2);
    assert.strictEqual(result.state, CARD_STATE.LEARNING);
    assert.strictEqual(result.stepIndex, 1);

    // Good rating on second step (10m) -> Graduates to Reviewing (1d)
    result = SRSScheduler.calculate(result, RATING.GOOD, ALGORITHM.SM2);
    assert.strictEqual(result.state, CARD_STATE.REVIEWING);
    assert.strictEqual(result.interval, 1);
    assert.strictEqual(result.repetitions, 1);
});

test('SM-2 Algorithm - Easy Graduation', () => {
    const card = SRSScheduler.initializeCard(ALGORITHM.SM2);

    // Easy rating on new card -> Graduates to Reviewing (4d)
    const result = SRSScheduler.calculate(card, RATING.EASY, ALGORITHM.SM2);
    assert.strictEqual(result.state, CARD_STATE.REVIEWING);
    assert.strictEqual(result.interval, 4);
    assert.strictEqual(result.repetitions, 1);
    assert.ok(result.easeFactor > 2.5);
});

test('SM-2 Algorithm - Review Interval Growth', () => {
    let card = {
        interval: 1,
        easeFactor: 2.5,
        repetitions: 1,
        state: CARD_STATE.REVIEWING,
        lastReviewDate: new Date().toISOString()
    };

    // Good rating on a card with interval 1 and ease 2.5
    // Typical SM-2 logic: next interval = current * ease
    const result = SRSScheduler.calculate(card, RATING.GOOD, ALGORITHM.SM2);
    assert.strictEqual(result.state, CARD_STATE.REVIEWING);
    // 1 * 2.5 = 2.5, rounded to 3 (or 2 depending on implementation math, 
    // but in srs-scheduler.js: Math.max(effectiveInterval + 1, Math.round(effectiveInterval * newEaseFactor)))
    // effectiveInterval is 1. newEaseFactor is 2.5. Math.round(1 * 2.5) is 3.
    assert.strictEqual(result.interval, 3);
});

test('SM-2 Algorithm - Lapse (Again)', () => {
    let card = {
        interval: 10,
        easeFactor: 2.5,
        repetitions: 5,
        state: CARD_STATE.REVIEWING,
        lastReviewDate: new Date().toISOString()
    };

    const result = SRSScheduler.calculate(card, RATING.AGAIN, ALGORITHM.SM2);
    assert.strictEqual(result.state, CARD_STATE.RELEARNING);
    assert.strictEqual(result.stepIndex, 0);
    assert.strictEqual(result.repetitions, 0);
    assert.strictEqual(result.easeFactor, 2.3); // 2.5 - 0.2
});

test('FSRS Algorithm - Integration', () => {
    const card = SRSScheduler.initializeCard(ALGORITHM.FSRS);
    assert.strictEqual(card.algorithm, ALGORITHM.FSRS);
    assert.ok(card.fsrs);

    // Test a basic review
    const result = SRSScheduler.calculate(card, RATING.GOOD, ALGORITHM.FSRS);
    assert.strictEqual(result.algorithm, ALGORITHM.FSRS);
    assert.ok(result.fsrs.stability > 0);
    assert.ok(result.fsrs.difficulty > 0);
    assert.strictEqual(typeof result.interval, 'number');
});

test('SRSScheduler - Mastery Threshold', () => {
    // SM-2 Mastery
    let card = {
        interval: 20,
        easeFactor: 2.5,
        repetitions: 9,
        state: CARD_STATE.REVIEWING,
        lastReviewDate: new Date().toISOString()
    };

    let result = SRSScheduler.calculate(card, RATING.GOOD, ALGORITHM.SM2);
    assert.strictEqual(result.state, CARD_STATE.MASTERED);

    // FSRS Mastery (based on stability >= 30)
    let fsrsCard = {
        interval: 10,
        state: CARD_STATE.REVIEWING,
        fsrs: {
            stability: 29,
            difficulty: 5,
            retrievability: 0.9,
            lastReview: new Date().toISOString()
        }
    };

    let fsrsResult = SRSScheduler.calculate(fsrsCard, RATING.GOOD, ALGORITHM.FSRS);
    if (fsrsResult.fsrs.stability >= 30) {
        assert.strictEqual(fsrsResult.state, CARD_STATE.MASTERED);
    }
});
