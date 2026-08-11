import assert from 'node:assert/strict';
import {
    buildComparisonChartData,
    buildDurationLanes,
    buildLexicalFallbackFeedback,
    buildNativeOnlyChartData,
    canShowDetailedFeedback,
    cleanPitchContour,
    hzToRelativeSemitones,
    normalizeChartSpans,
    normalizePlaybackSpans
} from '../../public/pronunciation-analyzer/chart-data.js';

assert.equal(hzToRelativeSemitones(200, 100), 12);
assert.equal(hzToRelativeSemitones(100, 100), 0);
assert.equal(hzToRelativeSemitones(null, 100), null);

const smoothedContour = cleanPitchContour([
    { x: 0, y: 0, rawHz: 100 },
    { x: 0.01, y: 0.4, rawHz: 102 },
    { x: 0.02, y: 12, rawHz: 200 },
    { x: 0.03, y: 0.2, rawHz: 101 },
    { x: 0.04, y: -0.2, rawHz: 99 }
]);
assert.ok(smoothedContour[2].y < 1, 'single-frame octave jumps must be removed from the displayed contour');
assert.equal(smoothedContour[2].rawHz, 200, 'smoothing must retain raw Hz for truthful tooltips');

const separatedContour = cleanPitchContour([
    { x: 0, y: 0, rawHz: 100 },
    { x: 0.01, y: 0.5, rawHz: 103 },
    { x: 0.02, y: null, rawHz: null },
    { x: 0.03, y: 11.8, rawHz: 198 },
    { x: 0.04, y: 12, rawHz: 200 }
]);
assert.deepEqual(
    separatedContour.map((point) => point.y),
    [0, 0.5, null, -0.2, 0],
    'each voiced run must correct its octave independently without blending across an unvoiced gap'
);

const native = {
    pitch: { times: [0, 0.1, 0.2], values: [100, 110, null] },
    intensity: { times: [0, 0.1, 0.2], values: [60, 70, 0] }
};
const learner = {
    pitch: { times: [0, 0.1, 0.2], values: [200, 220, null] },
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
assert.deepEqual(nativeOnly.pitch.map((point) => point.y), [100, 110, null]);
assert.deepEqual(nativeOnly.intensity.map((point) => point.y), [60, 70, null]);

const nativeWithSustainedOctaveJump = buildNativeOnlyChartData({
    pitch: {
        times: [0, 0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07],
        values: [185, 190, 188, null, 450, 475, 470, null]
    },
    intensity: {
        times: [0, 0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07],
        values: [60, 61, 62, 0, 63, 64, 65, 0]
    }
});
assert.ok(
    Math.max(...nativeWithSustainedOctaveJump.pitch.map((point) => point.y).filter(Number.isFinite)) < 300,
    'native-only charts must correct sustained octave tracking jumps before rendering'
);
assert.equal(
    nativeWithSustainedOctaveJump.pitch[5].rawHz,
    475,
    'native-only octave correction must retain the measured Hz for diagnostics'
);
assert.equal(nativeWithSustainedOctaveJump.pitch[3].y, null, 'internal unvoiced native frames must remain gaps');
assert.equal(nativeWithSustainedOctaveJump.pitch[7].y, null, 'trailing unvoiced native frames must remain gaps');

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
// Playback/waveform regions use contiguous partitions, while chart spans keep
// using the measurement window from the same serialized syllable.
const multiIntervalSyllable = [{
    startTime: 0.2,
    endTime: 0.4,
    measurementStartTime: 0.18,
    measurementEndTime: 0.46,
    partitionStartTime: 0.1,
    partitionEndTime: 0.5
}];
assert.deepEqual(
    normalizeChartSpans(multiIntervalSyllable).map(({ startTime, endTime }) => ({ startTime, endTime })),
    [{ startTime: 0.18, endTime: 0.46 }]
);
assert.deepEqual(
    normalizePlaybackSpans(multiIntervalSyllable).map(({ startTime, endTime, duration }) => ({ startTime, endTime, duration })),
    [{ startTime: 0.1, endTime: 0.5, duration: 0.4 }]
);
// Duration bars must describe the same contiguous syllable partitions shown
// by the waveform. Tiny acoustic/vowel measurement windows remain available
// for pitch, intensity, and stress, but must not replace total syllable time.
const photographDurationSpans = normalizePlaybackSpans([
    {
        partitionStartTime: 1.00,
        partitionEndTime: 1.24,
        partitionDuration: 0.24,
        measurementStartTime: 1.10,
        measurementEndTime: 1.12,
        vowelDuration: 0.02
    },
    {
        partitionStartTime: 1.24,
        partitionEndTime: 1.68,
        partitionDuration: 0.44,
        measurementStartTime: 1.40,
        measurementEndTime: 1.42,
        vowelDuration: 0.02
    },
    {
        partitionStartTime: 1.68,
        partitionEndTime: 2.00,
        partitionDuration: 0.32,
        measurementStartTime: 1.80,
        measurementEndTime: 1.82,
        vowelDuration: 0.02
    }
]);
assert.deepEqual(
    buildDurationLanes([], photographDurationSpans).observed.durations,
    [0.24, 0.44, 0.32],
    'V3 duration bars must use contiguous partition durations rather than vowel measurement windows'
);
// Zero-duration lanes were the visible symptom; guard the end-to-end shape.
assert.deepEqual(
    buildDurationLanes([], normalizeChartSpans([
        { startTime: 0.646957, endTime: 0.748043 },
        { startTime: 0.950217, endTime: 1.152391 }
    ])).observed.durations.map((value) => Number(value.toFixed(6))),
    [0.101086, 0.202174]
);

// A genuine pitch descent across syllables (e.g. "photograph": stressed syl 1
// at ~140 Hz, unstressed syl 3 at ~77 Hz) produces a segment near -10.7 ST.
// The octave correction must NOT shift it by +12 — the descent is real, not a
// tracker error.  Neighbor context (segment 2 at -8.7 ST) confirms continuity.
const descentContour = cleanPitchContour([
    { x: 0.84, y: -0.3, rawHz: 139 },
    { x: 0.88, y: 0.2, rawHz: 142 },
    { x: 0.92, y: 0.3, rawHz: 143 },
    { x: 0.96, y: 0.1, rawHz: 141 },
    { x: 1.00, y: -0.1, rawHz: 140 },
    { x: 1.02, y: null, rawHz: null },
    { x: 1.04, y: null, rawHz: null },
    { x: 1.06, y: null, rawHz: null },
    { x: 1.08, y: -5.6, rawHz: 102 },
    { x: 1.10, y: -7.4, rawHz: 92 },
    { x: 1.12, y: -8.7, rawHz: 84 },
    { x: 1.14, y: -10.0, rawHz: 79 },
    { x: 1.16, y: -9.9, rawHz: 80 },
    { x: 1.18, y: null, rawHz: null },
    { x: 1.20, y: null, rawHz: null },
    { x: 1.22, y: null, rawHz: null },
    { x: 1.24, y: null, rawHz: null },
    { x: 1.26, y: -10.3, rawHz: 78 },
    { x: 1.28, y: -10.7, rawHz: 76 },
    { x: 1.30, y: -10.5, rawHz: 77 },
    { x: 1.32, y: -10.6, rawHz: 76 }
]);
const seg3Vals = descentContour.slice(17, 21).map((p) => p.y);
assert.ok(
    seg3Vals.every((v) => v < -5),
    `genuine pitch descent to -10 ST must not be shifted up by 12; got [${seg3Vals}]`
);
