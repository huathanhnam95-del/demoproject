import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { SyllableVerifier } = require('../../public/pronunciation-analyzer/syllable-verifier.js');

describe('SyllableVerifier v3 features', () => {
    let verifier;

    beforeEach(() => {
        verifier = Object.create(SyllableVerifier.prototype);
        verifier.syllableLabels = ['car', 'pet'];
    });

    describe('formatSyllableDuration()', () => {
        it('shows total duration when finite', () => {
            const result = verifier.formatSyllableDuration({
                duration: 0.35,
                startTime: 0,
                endTime: 0.35,
                vowelDuration: 0.2
            });
            assert.equal(result, '0.35s');
        });

        it('calculates duration from startTime/endTime when duration is missing', () => {
            const result = verifier.formatSyllableDuration({
                startTime: 0.1,
                endTime: 0.45
            });
            assert.equal(result, '0.35s');
        });

        it('falls back to vowelDuration when total is not finite', () => {
            const result = verifier.formatSyllableDuration({
                duration: NaN,
                startTime: NaN,
                endTime: NaN,
                vowelDuration: 0.18
            });
            assert.equal(result, '0.18s');
        });

        it('returns dash when neither total nor vowel duration exists', () => {
            const result = verifier.formatSyllableDuration({});
            assert.equal(result, '\u2014');
        });

        it('returns dash for null input', () => {
            const result = verifier.formatSyllableDuration(null);
            assert.equal(result, '\u2014');
        });
    });

    describe('resolveSyllableLabel()', () => {
        it('uses target label for aligned/matched syllable', () => {
            const result = verifier.resolveSyllableLabel(
                { alignmentType: 'match' },
                0
            );
            assert.equal(result, 'car');
        });

        it('labels insertion as Observed N', () => {
            const result = verifier.resolveSyllableLabel(
                { alignmentType: 'insertion', observedIndex: 2 },
                1
            );
            assert.equal(result, 'Observed 3');
        });

        it('labels unresolved as Observed N', () => {
            const result = verifier.resolveSyllableLabel(
                { alignment_type: 'unresolved', observedIndex: 0 },
                0
            );
            assert.equal(result, 'Observed 1');
        });

        it('falls back to Observed N when label array has no match', () => {
            verifier.syllableLabels = [];
            const result = verifier.resolveSyllableLabel({}, 3);
            assert.equal(result, 'Observed 4');
        });
    });

    describe('buildV3FeedbackMessage()', () => {
        it('deletion feedback message', () => {
            const msg = SyllableVerifier.buildV3FeedbackMessage({
                type: 'deletion',
                syllableIndex: 1
            });
            assert.equal(msg, 'The 2nd target syllable was not detected.');
        });

        it('insertion feedback message', () => {
            const msg = SyllableVerifier.buildV3FeedbackMessage({
                type: 'insertion',
                syllableIndex: 1
            });
            assert.equal(msg, 'An extra vowel beat was detected after syllable 2.');
        });

        it('low confidence message', () => {
            const msg = SyllableVerifier.buildV3FeedbackMessage({
                type: 'low_confidence'
            });
            assert.equal(msg, 'The syllable count is uncertain; try again more clearly.');
        });

        it('service error message', () => {
            const msg = SyllableVerifier.buildV3FeedbackMessage({
                type: 'service_error'
            });
            assert.equal(msg, 'Speech analysis is temporarily unavailable; try again.');
        });

        it('null/undefined input returns service error message', () => {
            const msg = SyllableVerifier.buildV3FeedbackMessage(null);
            assert.equal(msg, 'Speech analysis is temporarily unavailable; try again.');
        });

        it('observed label numbering (3rd syllable)', () => {
            const msg = SyllableVerifier.buildV3FeedbackMessage({
                type: 'deletion',
                syllableIndex: 2
            });
            assert.equal(msg, 'The 3rd target syllable was not detected.');
        });
    });
});
