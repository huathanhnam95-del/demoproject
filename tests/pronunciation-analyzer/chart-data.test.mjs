import assert from 'node:assert/strict';
import {
    buildComparisonChartData,
    buildDurationLanes,
    buildLexicalFallbackFeedback,
    buildNativeOnlyChartData,
    canShowDetailedFeedback,
    hzToRelativeSemitones,
    normalizeChartSpans
} from '../../public/pronunciation-analyzer/chart-data.js';

assert.equal(hzToRelativeSemitones(200, 100), 12);
assert.equal(hzToRelativeSemitones(100, 100), 0);
assert.equal(hzToRelativeSemitones(null, 100), null);

const native = {
    pitch: { times: [0, 0.1, 0.2], values: [100, 200, null] },
    intensity: { times: [0, 0.1, 0.2], values: [60, 70, 0] }
};
const learner = {
    pitch: { times: [0, 0.1, 0.2], values: [200, 400, null] },
    intensity: { times: [0, 0.1, 0.2], values: [50, 60, 0] }
};

const comparison = buildComparisonChartData(native, learner);
assert.equal(comparison.pitchAxisLabel, 'Relative pitch (semitones from speaker median)');
assert.equal(comparison.intensityAxisLabel, 'Relative intensity (dB from voiced median)');
assert.equal(comparison.native.pitch[0].rawHz, 100);
assert.equal(comparison.learner.pitch[0].rawHz, 200);
assert.equal(comparison.native.pitch[0].y, comparison.learner.pitch[0].y);
assert.equal(comparison.native.intensity[0].y, -5);
assert.equal(comparison.learner.intensity[0].y, -5);

const nativeOnly = buildNativeOnlyChartData(native);
assert.equal(nativeOnly.pitchAxisLabel, 'Pitch (Hz)');
assert.equal(nativeOnly.intensityAxisLabel, 'Intensity (dB)');
assert.deepEqual(nativeOnly.pitch.map((point) => point.y), [100, 200, null]);
assert.deepEqual(nativeOnly.intensity.map((point) => point.y), [60, 70, null]);

const equalLanes = buildDurationLanes(
    [
        { ipa: 'ɪm', duration: 0.2 },
        { ipa: 'pɔrt', duration: 0.3 }
    ],
    [
        { duration: 0.19 },
        { duration: 0.32 }
    ]
);
assert.equal(equalLanes.countsMatch, true);
assert.deepEqual(equalLanes.target.labels, ['ɪm', 'pɔrt']);
assert.deepEqual(equalLanes.observed.labels, ['Observed 1', 'Observed 2']);

const mismatchLanes = buildDurationLanes(
    [{ ipa: 'kɑr', duration: 0.3 }],
    [{ duration: 0.12 }, { duration: 0.19 }]
);
assert.equal(mismatchLanes.countsMatch, false);
assert.deepEqual(mismatchLanes.target.labels, ['kɑr']);
assert.deepEqual(mismatchLanes.observed.labels, ['Observed 1', 'Observed 2']);

assert.equal(canShowDetailedFeedback({
    targetCount: 2,
    observedCount: 2,
    nativeQuality: { rateable: true, confidence: 0.8 },
    learnerQuality: { rateable: true, confidence: 0.75 }
}), true);
assert.equal(canShowDetailedFeedback({
    targetCount: 2,
    observedCount: 3,
    nativeQuality: { rateable: true, confidence: 0.8 },
    learnerQuality: { rateable: true, confidence: 0.75 }
}), false);

const fallbackMatch = buildLexicalFallbackFeedback({
    provider: 'cmu-pronouncing-dictionary',
    targetCount: 3,
    observedCount: 3,
    targetPrimaryStress: 1,
    observedPrimaryStress: 1,
    learnerQuality: { rateable: true, confidence: 0.9 },
    learnerStressEvidence: { rateable: true, confidence: 0.85 }
});
assert.equal(fallbackMatch.matches, true);
assert.match(fallbackMatch.message, /count and primary stress match/i);

const fallbackMismatch = buildLexicalFallbackFeedback({
    provider: 'cmu-pronouncing-dictionary',
    targetCount: 3,
    observedCount: 3,
    targetPrimaryStress: 1,
    observedPrimaryStress: 2,
    learnerQuality: { rateable: true, confidence: 0.9 },
    learnerStressEvidence: { rateable: true, confidence: 0.85 }
});
assert.equal(fallbackMismatch.matches, false);
assert.match(fallbackMismatch.message, /target.*2.*observed.*3/i);

assert.equal(buildLexicalFallbackFeedback({
    provider: 'merriam-webster',
    targetCount: 3,
    observedCount: 3,
    targetPrimaryStress: 1,
    observedPrimaryStress: 1,
    learnerQuality: { rateable: true, confidence: 0.9 },
    learnerStressEvidence: { rateable: true, confidence: 0.85 }
}), null);
assert.equal(canShowDetailedFeedback({
    targetCount: 2,
    observedCount: 2,
    nativeQuality: { rateable: true, confidence: 0.8 },
    learnerQuality: { rateable: true, confidence: 0.8 },
    nativeStressEvidence: { rateable: true, confidence: 0.8 },
    learnerStressEvidence: { rateable: false, confidence: 0.2 }
}), false);
assert.equal(canShowDetailedFeedback({
    targetCount: 2,
    observedCount: 2,
    nativeQuality: { rateable: true, confidence: 0.8 },
    learnerQuality: { rateable: true, confidence: 0.4 }
}), false);

// normalizeChartSpans(): comparison boundary spans carry only the boundary
// times, so the duration lanes would render every bar at zero without this.
assert.deepEqual(
    normalizeChartSpans([{ startTime: 0.6, endTime: 0.9 }]),
    [{ startTime: 0.6, endTime: 0.9, duration: 0.30000000000000004 }]
);
// An existing duration is authoritative and must not be recomputed: v2 spans
// report a vowel-trimmed duration that is deliberately shorter than the span.
assert.deepEqual(
    normalizeChartSpans([{ startTime: 0, endTime: 1, duration: 0.4 }]),
    [{ startTime: 0, endTime: 1, duration: 0.4 }]
);
// Degenerate and malformed spans are dropped rather than drawn.
assert.deepEqual(normalizeChartSpans([{ startTime: 0.5, endTime: 0.5 }]), []);
assert.deepEqual(normalizeChartSpans([{ startTime: 0.9, endTime: 0.2 }]), []);
assert.deepEqual(normalizeChartSpans([{ startTime: null, endTime: 0.2 }]), []);
assert.deepEqual(normalizeChartSpans(null), []);
assert.deepEqual(normalizeChartSpans(undefined), []);
// Zero-duration lanes were the visible symptom; guard the end-to-end shape.
assert.deepEqual(
    buildDurationLanes([], normalizeChartSpans([
        { startTime: 0.646957, endTime: 0.748043 },
        { startTime: 0.950217, endTime: 1.152391 }
    ])).observed.durations.map((value) => Number(value.toFixed(6))),
    [0.101086, 0.202174]
);
