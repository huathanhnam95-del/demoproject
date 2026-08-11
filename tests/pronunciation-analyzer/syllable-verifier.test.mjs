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

    it('setAutomaticSyllables() replaces automatic regions without clearing manual state', () => {
        const originalManualSegments = [{ index: 0, startTime: 0.1, endTime: 0.35, source: 'manual-review' }];
        const automaticSyllables = [
            { startTime: 0.05, endTime: 0.2, duration: 0.15 },
            { startTime: 0.2, endTime: 0.5, duration: 0.3 },
            { startTime: 0.5, endTime: 0.75, duration: 0.25 }
        ];
        const calls = [];
        verifier.manualSegments = originalManualSegments.map((segment) => ({ ...segment }));
        verifier.manualReviewActive = true;
        verifier.pendingManualStart = 0.82;
        verifier.manualReviewSaved = false;
        verifier.manualConvention = 'ipa-phonological';
        verifier.createSyllableRegions = () => calls.push('regions');
        verifier.createSyllableBar = () => calls.push('bar');
        verifier.updateInfo = () => calls.push('info');
        verifier.updateManualReviewUi = () => calls.push('manual-ui');

        verifier.setAutomaticSyllables(automaticSyllables, ['ac', 'tu', 'al'], ['æk', 'tʃu', 'əl']);

        assert.deepEqual(verifier.syllables, automaticSyllables);
        assert.deepEqual(verifier.manualSegments, originalManualSegments);
        assert.equal(verifier.manualReviewActive, true);
        assert.equal(verifier.pendingManualStart, 0.82);
        assert.equal(verifier.manualConvention, 'ipa-phonological');
        assert.deepEqual(verifier.syllableLabels, ['ac', 'tu', 'al']);
        assert.deepEqual(verifier.ipaSegments, ['æk', 'tʃu', 'əl']);
        assert.deepEqual(calls, ['regions', 'bar', 'info', 'manual-ui']);
    });

    it('setAutomaticSyllables() redraws automatic playback spans and preserves manual regions', () => {
        const addedRegions = [];
        verifier.syllableLabels = ['old'];
        verifier.syllables = [{ startTime: 0, endTime: 0.4, duration: 0.4 }];
        verifier.manualSegments = [{ startTime: 0.4, endTime: 0.6, source: 'manual-review' }];
        verifier.regions = {
            clearRegions: () => { addedRegions.length = 0; },
            addRegion: (region) => addedRegions.push(region)
        };
        verifier.createSyllableBar = () => {};
        verifier.updateInfo = () => {};
        verifier.updateManualReviewUi = () => {};
        verifier.setAutomaticSyllables([
            { startTime: 0.05, endTime: 0.25, duration: 0.2 },
            { startTime: 0.25, endTime: 0.7, duration: 0.45 }
        ], ['new-1', 'new-2']);

        assert.deepEqual(addedRegions.filter((region) => region.id.startsWith('syllable-')).map((region) => [region.id, region.start, region.end]), [
            ['syllable-0', 0.05, 0.25],
            ['syllable-1', 0.25, 0.7]
        ]);
        assert.deepEqual(addedRegions.find((region) => region.id === 'manual-syllable-0'), {
            id: 'manual-syllable-0',
            start: 0.4,
            end: 0.6,
            color: 'rgba(239, 68, 68, 0.42)',
            drag: false,
            resize: false
        });
        assert.deepEqual(verifier.manualSegments, [{ startTime: 0.4, endTime: 0.6, source: 'manual-review' }]);
    });

    it('builds three contiguous syllables from four ordered boundary clicks', () => {
        verifier.manualReviewActive = true;
        verifier.wavesurfer = { getDuration: () => 1 };
        verifier.ipaSegments = ['foʊ', 'tə', 'ɡræf'];
        verifier.manualBoundaryTimes = [];
        verifier.manualSegments = [];
        verifier.pendingManualStart = null;
        verifier.lastManualInteraction = null;
        verifier.manualReviewSaved = false;
        verifier.renderManualPendingMarker = () => {};
        verifier.removeManualPendingMarker = () => {};
        verifier.createManualRegions = () => {};
        verifier.updateManualReviewUi = () => {};
        verifier.notifyManualSegmentsChanged = () => {};
        verifier.setManualStatus = () => {};

        for (const time of [0.1, 0.3, 0.5, 0.8]) {
            assert.equal(verifier.handleManualInteraction(time), true);
            verifier.lastManualInteraction = null;
        }

        assert.deepEqual(
            verifier.manualSegments.map(({ index, startTime, endTime, duration }) => ({
                index, startTime, endTime, duration
            })),
            [
                { index: 0, startTime: 0.1, endTime: 0.3, duration: 0.2 },
                { index: 1, startTime: 0.3, endTime: 0.5, duration: 0.2 },
                { index: 2, startTime: 0.5, endTime: 0.8, duration: 0.3 }
            ]
        );
        assert.equal(verifier.manualConvention, 'ipa-phonological-contiguous-v1');
    });

    it('does not save until the exact expected contiguous segment count is complete', async () => {
        let saves = 0;
        const statuses = [];
        verifier.ipaSegments = ['foʊ', 'tə', 'ɡræf'];
        verifier.manualSegments = [
            { startTime: 0.1, endTime: 0.3 },
            { startTime: 0.3, endTime: 0.5 }
        ];
        verifier.manualSaveInProgress = false;
        verifier.manualReviewSaved = false;
        verifier.options = { onManualSave: async () => { saves += 1; } };
        verifier.updateManualReviewUi = () => {};
        verifier.setManualStatus = (message, state) => statuses.push({ message, state });

        await verifier.saveManualReview();

        assert.equal(saves, 0);
        assert.match(statuses.at(-1)?.message || '', /exactly 3 syllables/i);
        assert.equal(statuses.at(-1)?.state, 'error');
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
