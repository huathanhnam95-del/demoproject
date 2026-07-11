export const ANALYSIS_CONFIDENCE_THRESHOLD = 0.65;

function finitePositive(value) {
    return Number.isFinite(Number(value)) && Number(value) > 0;
}

function median(values) {
    const sorted = values
        .filter((value) => Number.isFinite(Number(value)))
        .map(Number)
        .sort((left, right) => left - right);
    if (!sorted.length) return null;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function hzToRelativeSemitones(value, speakerMedianF0) {
    if (!finitePositive(value) || !finitePositive(speakerMedianF0)) return null;
    return Number((12 * Math.log2(Number(value) / Number(speakerMedianF0))).toFixed(4));
}

function relativePitchSeries(analysis) {
    const times = Array.isArray(analysis?.pitch?.times) ? analysis.pitch.times : [];
    const values = Array.isArray(analysis?.pitch?.values) ? analysis.pitch.values : [];
    const speakerMedianF0 = median(values.filter(finitePositive));
    return {
        medianHz: speakerMedianF0,
        points: times.map((time, index) => {
            const rawHz = finitePositive(values[index]) ? Number(values[index]) : null;
            return {
                x: Number(time),
                y: hzToRelativeSemitones(rawHz, speakerMedianF0),
                rawHz
            };
        })
    };
}

function relativeIntensitySeries(analysis) {
    const times = Array.isArray(analysis?.intensity?.times) ? analysis.intensity.times : [];
    const values = Array.isArray(analysis?.intensity?.values) ? analysis.intensity.values : [];
    const pitches = Array.isArray(analysis?.pitch?.values) ? analysis.pitch.values : [];
    const voicedValues = values.filter((value, index) => (
        finitePositive(value) && finitePositive(pitches[index])
    ));
    const voicedMedianDb = median(voicedValues);
    return {
        medianDb: voicedMedianDb,
        points: times.map((time, index) => {
            const rawDb = (
                finitePositive(values[index]) && finitePositive(pitches[index])
            ) ? Number(values[index]) : null;
            return {
                x: Number(time),
                y: rawDb === null || voicedMedianDb === null
                    ? null
                    : Number((rawDb - voicedMedianDb).toFixed(4)),
                rawDb
            };
        })
    };
}

export function buildComparisonChartData(nativeAnalysis, learnerAnalysis) {
    const nativePitch = relativePitchSeries(nativeAnalysis);
    const learnerPitch = relativePitchSeries(learnerAnalysis);
    const nativeIntensity = relativeIntensitySeries(nativeAnalysis);
    const learnerIntensity = relativeIntensitySeries(learnerAnalysis);
    return {
        pitchAxisLabel: 'Relative pitch (semitones from speaker median)',
        intensityAxisLabel: 'Relative intensity (dB from voiced median)',
        native: {
            pitch: nativePitch.points,
            intensity: nativeIntensity.points,
            medianHz: nativePitch.medianHz,
            medianDb: nativeIntensity.medianDb
        },
        learner: {
            pitch: learnerPitch.points,
            intensity: learnerIntensity.points,
            medianHz: learnerPitch.medianHz,
            medianDb: learnerIntensity.medianDb
        }
    };
}

export function buildNativeOnlyChartData(nativeAnalysis) {
    const pitchTimes = Array.isArray(nativeAnalysis?.pitch?.times) ? nativeAnalysis.pitch.times : [];
    const pitchValues = Array.isArray(nativeAnalysis?.pitch?.values) ? nativeAnalysis.pitch.values : [];
    const intensityTimes = Array.isArray(nativeAnalysis?.intensity?.times) ? nativeAnalysis.intensity.times : [];
    const intensityValues = Array.isArray(nativeAnalysis?.intensity?.values) ? nativeAnalysis.intensity.values : [];
    return {
        pitchAxisLabel: 'Pitch (Hz)',
        intensityAxisLabel: 'Intensity (dB)',
        pitch: pitchTimes.map((time, index) => ({
            x: Number(time),
            y: finitePositive(pitchValues[index]) ? Number(pitchValues[index]) : null
        })),
        intensity: intensityTimes.map((time, index) => ({
            x: Number(time),
            y: finitePositive(intensityValues[index]) ? Number(intensityValues[index]) : null
        }))
    };
}

export function buildDurationLanes(targetSyllables = [], observedSyllables = []) {
    const duration = (syllable) => Number(
        syllable?.vowelDuration ?? syllable?.duration ?? 0
    );
    return {
        countsMatch: targetSyllables.length === observedSyllables.length,
        target: {
            labels: targetSyllables.map((syllable, index) => (
                syllable?.ipa || `Target ${index + 1}`
            )),
            durations: targetSyllables.map(duration)
        },
        observed: {
            labels: observedSyllables.map((_, index) => `Observed ${index + 1}`),
            durations: observedSyllables.map(duration)
        }
    };
}

export function canShowDetailedFeedback({
    targetCount,
    observedCount,
    nativeQuality,
    learnerQuality,
    threshold = ANALYSIS_CONFIDENCE_THRESHOLD
}) {
    return (
        targetCount === observedCount &&
        targetCount > 0 &&
        nativeQuality?.rateable === true &&
        learnerQuality?.rateable === true &&
        Number(nativeQuality.confidence) >= threshold &&
        Number(learnerQuality.confidence) >= threshold
    );
}

export function formatRelativePitchTooltip(point) {
    if (!point || point.y === null) return 'No voiced pitch';
    return `${Number(point.y).toFixed(1)} semitones · ${Math.round(point.rawHz)} Hz`;
}
