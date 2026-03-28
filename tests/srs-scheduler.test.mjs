import test from 'node:test';
import assert from 'node:assert/strict';
import { SRSScheduler, ALGORITHM, CARD_STATE, RATING } from '../public/srs-scheduler.js';
import {
    isCardDue,
    isMasteredCard,
    migrateCardForTargetAlgorithm,
    normalizeSrsCard
} from '../public/js/srs-card-model.js';

test('initializeCard uses review-by-tomorrow defaults', () => {
    const sm2 = SRSScheduler.initializeCard(ALGORITHM.SM2);
    assert.strictEqual(sm2.algorithm, ALGORITHM.SM2);
    assert.strictEqual(sm2.state, CARD_STATE.REVIEWING);
    assert.strictEqual(sm2.interval, 1);
    assert.strictEqual(sm2.repetitions, 0);
    assert.ok(new Date(sm2.nextReviewDate) > new Date(sm2.lastReviewDate));

    const fsrs = SRSScheduler.initializeCard(ALGORITHM.FSRS);
    assert.strictEqual(fsrs.algorithm, ALGORITHM.FSRS);
    assert.strictEqual(fsrs.state, CARD_STATE.REVIEWING);
    assert.strictEqual(fsrs.interval, 1);
    assert.strictEqual(fsrs.repetitions, 0);
    assert.strictEqual(fsrs.fsrs.reps, 0);
});

test('SM-2 review cards progress logically and keep sub-day lapses at interval 0', () => {
    const card = SRSScheduler.initializeCard(ALGORITHM.SM2);
    const reviewResult = SRSScheduler.calculate(card, RATING.GOOD, ALGORITHM.SM2);

    assert.strictEqual(reviewResult.state, CARD_STATE.REVIEWING);
    assert.strictEqual(reviewResult.interval, 3);
    assert.strictEqual(reviewResult.status, 'review');

    const lapseResult = SRSScheduler.calculate(reviewResult, RATING.AGAIN, ALGORITHM.SM2);
    assert.strictEqual(lapseResult.state, CARD_STATE.RELEARNING);
    assert.strictEqual(lapseResult.interval, 0);
    assert.strictEqual(lapseResult.stepIndex, 0);
    assert.ok(new Date(lapseResult.nextReviewDate) > new Date(lapseResult.lastReviewDate));
    assert.ok(new Date(lapseResult.nextReviewDate) <= new Date(Date.now() + 2 * 60 * 1000));
});

test('FSRS maintains repetition ownership on every write', () => {
    const card = SRSScheduler.initializeCard(ALGORITHM.FSRS);
    const result = SRSScheduler.calculate(card, RATING.GOOD, ALGORITHM.FSRS);

    assert.strictEqual(result.algorithm, ALGORITHM.FSRS);
    assert.strictEqual(result.repetitions, result.fsrs.reps);
    assert.strictEqual(typeof result.interval, 'number');
    assert.ok(result.fsrs.stability >= 0);
    assert.ok(result.fsrs.difficulty > 0);
});

test('normalizeSrsCard repairs legacy records and invalid dates', () => {
    const normalized = normalizeSrsCard({
        status: 'learning',
        interval: 0,
        nextReviewDate: 'not-a-date',
        lastReviewDate: 'also-not-a-date'
    }, new Date('2026-03-27T00:00:00.000Z'));

    assert.strictEqual(normalized.state, CARD_STATE.LEARNING);
    assert.strictEqual(normalized.status, 'learning');
    assert.strictEqual(normalized.lastReviewDate, null);
    assert.ok(new Date(normalized.nextReviewDate).toString() !== 'Invalid Date');
});

test('isCardDue and isMasteredCard use normalized state', () => {
    const mastered = normalizeSrsCard({
        status: 'mastered',
        interval: 21,
        nextReviewDate: '2026-03-01T00:00:00.000Z'
    }, new Date('2026-03-27T00:00:00.000Z'));

    const dueCard = normalizeSrsCard({
        status: 'reviewing',
        interval: 1,
        nextReviewDate: '2026-03-26T00:00:00.000Z'
    }, new Date('2026-03-27T00:00:00.000Z'));

    assert.ok(isMasteredCard(mastered));
    assert.strictEqual(isCardDue(mastered, new Date('2026-03-27T00:00:00.000Z')), false);
    assert.strictEqual(isCardDue(dueCard, new Date('2026-03-27T00:00:00.000Z')), true);
});

test('migrateCardForTargetAlgorithm preserves due date while switching algorithms', () => {
    const source = normalizeSrsCard({
        algorithm: ALGORITHM.SM2,
        state: CARD_STATE.REVIEWING,
        interval: 7,
        repetitions: 4,
        easeFactor: 2.1,
        nextReviewDate: '2026-04-03T00:00:00.000Z'
    }, new Date('2026-03-27T00:00:00.000Z'));

    const migrated = migrateCardForTargetAlgorithm(source, ALGORITHM.FSRS, new Date('2026-03-27T00:00:00.000Z'));
    assert.strictEqual(migrated.algorithm, ALGORITHM.FSRS);
    assert.strictEqual(migrated.nextReviewDate, source.nextReviewDate);
    assert.ok(migrated.fsrs.stability > 0);
    assert.ok(migrated.fsrs.reps >= source.repetitions);
});

test('preview labels never render 0m', () => {
    const card = normalizeSrsCard({
        algorithm: ALGORITHM.FSRS,
        state: CARD_STATE.LEARNING,
        interval: 0,
        nextReviewDate: new Date(Date.now() + 30 * 1000).toISOString(),
        fsrs: {
            difficulty: 5,
            stability: 0.1,
            retrievability: 1,
            lastReview: new Date().toISOString(),
            lapses: 0,
            reps: 0
        }
    }, new Date());

    const previews = SRSScheduler.getIntervalPreviews(card, ALGORITHM.FSRS);
    assert.ok(Object.values(previews).every(label => label !== '0m'));
});
