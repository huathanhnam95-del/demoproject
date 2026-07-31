import assert from 'node:assert/strict';
import test from 'node:test';
import {
    attemptStatusFor,
    createAttemptKey,
    nextAttemptState,
    resetAttemptState
} from '../../public/pronunciation-analyzer/verification-attempt-policy.js';

test('three recordings allow only two re-record prompts', () => {
    const key = createAttemptKey({ word: 'Actual', variantId: 'v1', ipa: '/ˈæk.tʃu.əl/', expectedCount: 3 });
    let state = { key, count: 0 };
    state = nextAttemptState(state, { key, status: 'unrateable' });
    assert.deepEqual(state, { key, count: 1, action: 'retry', retryNumber: 1 });
    state = nextAttemptState(state, { key, status: 'unrateable' });
    assert.deepEqual(state, { key, count: 2, action: 'retry', retryNumber: 2 });
    state = nextAttemptState(state, { key, status: 'unrateable' });
    assert.deepEqual(state, { key, count: 3, action: 'advisory' });
});

test('formal result resets attempts and non-analysis errors do not consume them', () => {
    const key = createAttemptKey({ word: 'actual', variantId: 'v1', ipa: '/a/', expectedCount: 1 });
    const first = nextAttemptState({ key, count: 0 }, { key, status: 'network_error' });
    assert.deepEqual(first, { key, count: 0, action: 'ignore' });
    const verified = nextAttemptState({ key, count: 2 }, { key, status: 'verified' });
    assert.deepEqual(verified, resetAttemptState(key));
});

test('service outages are classified as unavailable and never consume an attempt', () => {
    const key = createAttemptKey({ word: 'banana', variantId: 'v1', ipa: '/bəˈnænə/', expectedCount: 3 });
    const outage = (reason) => ({
        status: 'unrateable',
        count: { status: 'unrateable', reasons: [reason] },
        primary_stress: { status: 'unrateable', reasons: [reason] }
    });

    for (const reason of [
        'V3_NOT_ACTIVE', 'V3_VERIFICATION_UNAVAILABLE', 'V3_PRAAT_FAILED',
        'MODEL_INFERENCE_FAILED', 'TIMEOUT', 'VERIFIER_ARTIFACT_UNAVAILABLE',
        // RecognizerError reasons raised by phoneme_client.py
        'RECOGNIZER_BUSY', 'RECOGNIZER_AUTH_FAILED', 'CONTRACT_MISMATCH', 'INFERENCE_ERROR'
    ]) {
        assert.equal(attemptStatusFor(outage(reason)), 'unavailable', reason);
    }
    // A missing verification block means the backend never answered at all.
    assert.equal(attemptStatusFor(null), 'unavailable');

    let state = { key, count: 0 };
    for (let i = 0; i < 5; i++) {
        state = nextAttemptState(state, { key, status: attemptStatusFor(outage('V3_NOT_ACTIVE')) });
    }
    assert.deepEqual(state, { key, count: 0, action: 'ignore' });
});

test('a not-applicable component cannot mask a service outage', () => {
    // Count-only releases permanently report STRESS_SCORING_DISABLED on a
    // primary_stress block marked applicable:false. That must not turn a
    // recognizer outage into a consumed re-record attempt.
    assert.equal(attemptStatusFor({
        status: 'unrateable',
        count: { status: 'unrateable', reasons: ['RECOGNIZER_BUSY'] },
        primary_stress: { applicable: false, status: 'unrateable', reasons: ['STRESS_SCORING_DISABLED'] }
    }), 'unavailable');

    // But real count evidence still consumes, disabled stress notwithstanding.
    assert.equal(attemptStatusFor({
        status: 'unrateable',
        count: { status: 'unrateable', reasons: ['COUNT_UNCERTAIN'] },
        primary_stress: { applicable: false, status: 'unrateable', reasons: ['STRESS_SCORING_DISABLED'] }
    }), 'unrateable');
});

test('evidence-based unrateable results still consume an attempt', () => {
    assert.equal(attemptStatusFor({
        status: 'unrateable',
        count: { status: 'verified', reasons: [] },
        primary_stress: { status: 'unrateable', reasons: ['MISSING_STRESS_EVIDENCE'] }
    }), 'unrateable');
    assert.equal(attemptStatusFor({
        status: 'unrateable',
        count: { status: 'unrateable', reasons: ['INDEPENDENT_COUNT_DISAGREEMENT'] },
        primary_stress: { status: 'unrateable', reasons: [] }
    }), 'unrateable');
    assert.equal(attemptStatusFor({ status: 'verified', count: {}, primary_stress: {} }), 'verified');
    assert.equal(attemptStatusFor({ status: 'incorrect', count: {}, primary_stress: {} }), 'incorrect');
});

test('changing word or variant starts a fresh sequence', () => {
    const oldKey = createAttemptKey({ word: 'actual', variantId: 'v1', ipa: '/a/', expectedCount: 1 });
    const newKey = createAttemptKey({ word: 'actual', variantId: 'v2', ipa: '/a/', expectedCount: 1 });
    assert.deepEqual(
        nextAttemptState({ key: oldKey, count: 2 }, { key: newKey, status: 'unrateable' }),
        { key: newKey, count: 1, action: 'retry', retryNumber: 1 }
    );
});
