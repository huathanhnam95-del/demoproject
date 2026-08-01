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

    it('normalizes unavailable reasons into stable readable copy', () => {
        assert.equal(
            normalizeComparisonReason('MODEL_INFERENCE_FAILED'),
            'Analysis unavailable because model inference failed.'
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
                judgment,
                manualSegments: [{ startTime: 0.1, endTime: 0.2, label: 'manual' }]
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
            { startTime: 0.1, endTime: 0.4, label: 'first' }
        ];
        const metadata = buildComparisonSaveMetadata(completeComparison, { manualSegments });
        assert.deepEqual(metadata.manualSegments, [
            { startTime: 0.1, endTime: 0.4, label: 'first', index: 0 },
            { startTime: 0.4, endTime: 0.8, label: 'second', index: 1 }
        ]);
        assert.equal(manualSegments[0].startTime, '0.4');
        assert.equal(Object.hasOwn(metadata, 'manualSegments'), true);
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
