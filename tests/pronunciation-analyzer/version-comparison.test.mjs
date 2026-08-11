import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    COMPARISON_JUDGMENTS,
    buildComparisonSaveMetadata,
    buildComparisonViewModel,
    isCompleteComparison,
    normalizeComparisonReason
} from '../../public/pronunciation-analyzer/version-comparison.js';

const completeComparison = {
    schemaVersion: 'pronunciation-comparison-v1',
    status: 'complete',
    comparisonId: 'abc123',
    context: {
        targetWord: 'actual',
        referenceIpa: '/\u02c8\u00e6k.t\u0283u.\u0259l/',
        referenceSyllableIpa: ['æk', 'tʃu', 'əl'],
        expectedSyllables: 3,
        variantId: 'cmudict:actual'
    },
    revisions: {
        comparisonSchema: 'pronunciation-comparison-v1',
        v2: 'pronunciation-analysis-v2',
        v3: 'pronunciation-analysis-v3',
        v3Model: 'model-rev-1'
    },
    v2: {
        status: 'available',
        analysis: {
            analysisVersion: 'pronunciation-analysis-v2',
            quality: { confidence: 0.81 },
            observed: {
                syllableCount: 2,
                syllables: [
                    { startTime: 0.1, endTime: 0.4, ipa: 'ak' },
                    { startTime: 0.4, endTime: 0.8, ipa: 'tual' }
                ]
            },
            duration: 0.9
        }
    },
    v3: {
        status: 'available',
        analysis: {
            analysisVersion: 'pronunciation-analysis-v3',
            confidence: 0.91,
            syllable_count: 3,
            observed_syllables: [
                { startTime: 0.1, endTime: 0.3, label: 'ac' },
                { startTime: 0.3, endTime: 0.55, label: 'tu' },
                { startTime: 0.55, endTime: 0.8, label: 'al' }
            ],
            total_duration: 0.85
        }
    }
};

describe('V2/V3 comparison model', () => {
    it('builds aligned rows, counts, and boundary spans', () => {
        const view = buildComparisonViewModel(completeComparison);
        assert.equal(view.status, 'complete');
        assert.deepEqual(view.columns.map((column) => column.version), ['v2', 'v3']);
        assert.equal(view.rows.find((row) => row.key === 'syllableCount').v2, 2);
        assert.equal(view.rows.find((row) => row.key === 'syllableCount').v3, 3);
        assert.equal(view.columns[0].boundarySpans.length, 2);
        assert.equal(view.columns[1].boundarySpans.length, 3);
        assert.equal(view.rows[0].label, 'Syllable count');
    });

    it('uses V3 contiguous partitions for waveform boundaries while preserving provenance', () => {
        const view = buildComparisonViewModel({
            ...completeComparison,
            v3: {
                ...completeComparison.v3,
                analysis: {
                    ...completeComparison.v3.analysis,
                    segmentation_convention: 'ctc-token-coverage',
                    measurement_convention: 'ctc-blank-midpoint-v1',
                    partition_convention: 'ctc-interspan-acoustic-hybrid-contiguous-v3',
                    observed_syllables: [
                        {
                            startTime: 1.07191,
                            endTime: 1.132584,
                            measurementStartTime: 1.11236,
                            measurementEndTime: 1.173034,
                            partitionStartTime: 0.980899,
                            partitionEndTime: 1.173034,
                            partitionDuration: 0.192135,
                            label: 'to'
                        },
                        {
                            startTime: 1.213483,
                            endTime: 1.557303,
                            measurementStartTime: 1.334831,
                            measurementEndTime: 1.355056,
                            partitionStartTime: 1.173034,
                            partitionEndTime: 1.557303,
                            partitionDuration: 0.384269,
                            label: 'graph'
                        }
                    ]
                }
            }
        });
        const v3 = view.columns.find((column) => column.version === 'v3');
        assert.equal(v3.boundarySource, 'ctc-contiguous-partition');
        assert.match(v3.boundaryLabel, /contiguous phonological partition/i);
        assert.equal(v3.measurementConvention, 'ctc-blank-midpoint-v1');
        assert.equal(v3.partitionConvention, 'ctc-interspan-acoustic-hybrid-contiguous-v3');
        assert.deepEqual(
            v3.boundarySpans.map(({ startTime, endTime }) => ({ startTime, endTime })),
            [
                { startTime: 0.980899, endTime: 1.173034 },
                { startTime: 1.173034, endTime: 1.557303 }
            ],
            'waveform boundaries must use the contiguous partition, not raw CTC or measurement windows'
        );
        assert.deepEqual(v3.rawCtcSpans.map(({ startTime, endTime }) => ({ startTime, endTime })), [
            { startTime: 1.07191, endTime: 1.132584 },
            { startTime: 1.213483, endTime: 1.557303 }
        ]);
        assert.deepEqual(v3.measurementSpans.map(({ startTime, endTime }) => ({ startTime, endTime })), [
            { startTime: 1.11236, endTime: 1.173034 },
            { startTime: 1.334831, endTime: 1.355056 }
        ]);
    });

    it('marks available legacy recognizer spans when convention metadata is absent', () => {
        const view = buildComparisonViewModel(completeComparison);
        const v3 = view.columns.find((column) => column.version === 'v3');
        assert.equal(v3.boundarySource, 'recognizer-legacy');
        assert.match(v3.boundaryLabel, /legacy.*convention unknown/i);
    });

    it('preserves analyzer duration metadata for comparison charts', () => {
        const view = buildComparisonViewModel({
            ...completeComparison,
            v2: {
                status: 'available',
                analysis: {
                    ...completeComparison.v2.analysis,
                    observed: {
                        syllableCount: 2,
                        syllables: [
                            {
                                startTime: 0.1,
                                endTime: 0.4,
                                duration: 0.3,
                                vowelDuration: 0.18,
                                ipa: 'ak'
                            },
                            {
                                startTime: 0.4,
                                endTime: 0.8,
                                duration: 0.4,
                                vowelDuration: 0.22,
                                ipa: 'tual'
                            }
                        ]
                    }
                }
            }
        });
        assert.deepEqual(
            view.columns[0].boundarySpans.map(({ startTime, endTime, duration, vowelDuration }) => ({
                startTime,
                endTime,
                duration,
                vowelDuration
            })),
            [
                { startTime: 0.1, endTime: 0.4, duration: 0.3, vowelDuration: 0.18 },
                { startTime: 0.4, endTime: 0.8, duration: 0.4, vowelDuration: 0.22 }
            ]
        );
    });

    it('labels each engine confidence with its provenance', () => {
        // V2 reports Praat acoustic segmentation confidence; V3 reports mean
        // forced-alignment confidence across syllables. Presenting both as a
        // bare "Confidence" implies a comparability that does not exist, so the
        // row must carry per-engine provenance for the renderer to show.
        const view = buildComparisonViewModel(completeComparison);
        const row = view.rows.find((entry) => entry.key === 'confidence');
        assert.ok(row, 'comparison must expose a confidence row');
        assert.equal(row.v2Subtitle, 'Acoustic segmentation');
        assert.equal(row.v3Subtitle, 'Mean forced-alignment');
        // The renderer reads row[`${column.version}Subtitle`], so the keys must
        // match the column version ids exactly.
        for (const column of view.columns) {
            assert.ok(row[`${column.version}Subtitle`], `no provenance for ${column.version}`);
        }
    });

    it('normalizes unavailable reasons into stable readable copy', () => {
        assert.equal(
            normalizeComparisonReason('MODEL_INFERENCE_FAILED'),
            'Analysis unavailable because model inference failed.'
        );
        assert.equal(
            normalizeComparisonReason('RECOGNIZER_UNREACHABLE'),
            'Analysis unavailable because the recognizer could not be reached.'
        );
        assert.equal(
            normalizeComparisonReason('UNKNOWN_REASON'),
            'Analysis unavailable for an unspecified reason.'
        );
        const view = buildComparisonViewModel({
            ...completeComparison,
            status: 'partial_failure',
            v3: { status: 'unavailable', reason: 'MODEL_INFERENCE_FAILED' }
        });
        assert.equal(view.columns[1].reason, 'Analysis unavailable because model inference failed.');
    });

    it('does not treat unavailable V3 fallback spans as count or confidence evidence', () => {
        const view = buildComparisonViewModel({
            ...completeComparison,
            status: 'partial_failure',
            v3: {
                status: 'unavailable',
                reason: 'RECOGNIZER_CONFIG_MISSING',
                analysis: {
                    analysisVersion: 'pronunciation-analysis-v3',
                    confidence: 0,
                    syllable_count: null,
                    segmentation_source: 'praat-fallback',
                    observed_syllables: [
                        { startTime: 0.1, endTime: 0.3 },
                        { startTime: 0.3, endTime: 0.7 }
                    ]
                }
            }
        });
        const v3 = view.columns.find((column) => column.version === 'v3');
        assert.equal(v3.syllableCount, null);
        assert.equal(v3.confidence, null);
        assert.equal(v3.boundaryStatus, 'display-only');
        assert.equal(v3.boundarySource, 'praat-acoustic');
        assert.match(v3.boundaryLabel, /display-only.*acoustic/i);
        assert.equal(v3.boundarySpans.length, 2);
    });

    it('distinguishes complete and partial comparisons', () => {
        assert.equal(isCompleteComparison(completeComparison), true);
        assert.equal(isCompleteComparison({
            ...completeComparison,
            status: 'partial_failure',
            v3: { status: 'unavailable', reason: 'TIMEOUT' }
        }), false);
    });

    it('allows exactly four judgments only for complete comparisons', () => {
        assert.deepEqual(COMPARISON_JUDGMENTS, ['v2', 'v3', 'tie', 'neither']);
        for (const judgment of COMPARISON_JUDGMENTS) {
            const metadata = buildComparisonSaveMetadata(completeComparison, {
                judgment
            });
            assert.equal(metadata.judgment, judgment);
        }
        assert.throws(
            () => buildComparisonSaveMetadata(completeComparison, { judgment: 'invalid' }),
            /judgment/
        );
        const partialMetadata = buildComparisonSaveMetadata({
            ...completeComparison,
            status: 'partial_failure',
            v3: { status: 'unavailable', reason: 'TIMEOUT' }
        }, { judgment: 'v2' });
        assert.equal(partialMetadata.judgment, null);
        assert.equal(partialMetadata.status, 'partial_failure');
    });

    it('copies and normalizes manual segments without mutating the comparison', () => {
        const manualSegments = [
            { startTime: '0.4', endTime: '0.8', label: 'second' },
            { startTime: 0.1, endTime: 0.4, label: 'first' },
            { startTime: 0.8, endTime: 0.9, label: 'third' }
        ];
        const metadata = buildComparisonSaveMetadata(completeComparison, { manualSegments });
        assert.deepEqual(metadata.manualSegments, [
            { startTime: 0.1, endTime: 0.4, label: 'first', index: 0 },
            { startTime: 0.4, endTime: 0.8, label: 'second', index: 1 },
            { startTime: 0.8, endTime: 0.9, label: 'third', index: 2 }
        ]);
        assert.equal(manualSegments[0].startTime, '0.4');
        assert.equal(Object.hasOwn(metadata, 'manualSegments'), true);
        assert.equal(metadata.manualSegmentationConvention, 'ipa-phonological-contiguous-v1');
        assert.deepEqual(metadata.context.referenceSyllableIpa, ['æk', 'tʃu', 'əl']);
    });

    it('keeps serializable analyses while omitting binary and identity fields', () => {
        const typed = new Uint8Array([1, 2]);
        const comparison = {
            ...completeComparison,
            v2: { ...completeComparison.v2, analysis: { ...completeComparison.v2.analysis, typed, audioBlob: new Blob(['x']) } },
            uid: 'client-uid',
            email: 'client@example.com',
            createdAt: 'client-time'
        };
        const metadata = buildComparisonSaveMetadata(comparison, { judgment: 'v3' });
        assert.equal(metadata.uid, undefined);
        assert.equal(metadata.email, undefined);
        assert.equal(metadata.createdAt, undefined);
        assert.equal(metadata.analyses.v2.analysis.typed, undefined);
        assert.equal(metadata.analyses.v2.analysis.audioBlob, undefined);
        assert.equal(metadata.analyses.v2.analysis.duration, 0.9);
        assert.doesNotThrow(() => JSON.stringify(metadata));
    });
});
