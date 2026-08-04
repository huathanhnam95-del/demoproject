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

function alignAndTrimSeries(pitchPoints, intensityPoints) {
    let firstVoicedTime = null;
    let lastVoicedTime = null;

    // Find first and last voiced timestamps in pitch
    for (const pt of pitchPoints) {
        if (pt.y !== null) {
            if (firstVoicedTime === null) firstVoicedTime = pt.x;
            lastVoicedTime = pt.x;
        }
    }

    // Fallback to intensity if no voiced pitch detected
    if (firstVoicedTime === null) {
        for (const pt of intensityPoints) {
            if (pt.y !== null) {
                if (firstVoicedTime === null) firstVoicedTime = pt.x;
                lastVoicedTime = pt.x;
            }
        }
    }

    // If still no voiced frames at all, fall back to first and last points
    if (firstVoicedTime === null && pitchPoints.length > 0) {
        firstVoicedTime = pitchPoints[0].x;
        lastVoicedTime = pitchPoints[pitchPoints.length - 1].x;
    } else if (firstVoicedTime === null && intensityPoints.length > 0) {
        firstVoicedTime = intensityPoints[0].x;
        lastVoicedTime = intensityPoints[intensityPoints.length - 1].x;
    }

    if (firstVoicedTime === null) return { pitch: [], intensity: [] };

    // Define window with 0.1s padding
    const startWindow = firstVoicedTime - 0.1;
    const endWindow = lastVoicedTime + 0.1;

    // Shift and filter pitch points
    const trimmedPitch = pitchPoints
        .filter(pt => pt.x >= startWindow && pt.x <= endWindow)
        .map(pt => ({
            ...pt,
            x: Number((pt.x - firstVoicedTime).toFixed(4))
        }));

    // Shift and filter intensity points
    const trimmedIntensity = intensityPoints
        .filter(pt => pt.x >= startWindow && pt.x <= endWindow)
        .map(pt => ({
            ...pt,
            x: Number((pt.x - firstVoicedTime).toFixed(4))
        }));

    return { pitch: trimmedPitch, intensity: trimmedIntensity };
}

export function buildComparisonChartData(nativeAnalysis, learnerAnalysis) {
    const nativePitch = relativePitchSeries(nativeAnalysis);
    const learnerPitch = relativePitchSeries(learnerAnalysis);
    const nativeIntensity = relativeIntensitySeries(nativeAnalysis);
    const learnerIntensity = relativeIntensitySeries(learnerAnalysis);

    const nativeAligned = alignAndTrimSeries(nativePitch.points, nativeIntensity.points);
    const learnerAligned = alignAndTrimSeries(learnerPitch.points, learnerIntensity.points);

    return {
        pitchAxisLabel: 'Relative pitch (semitones from speaker median)',
        intensityAxisLabel: 'Relative intensity (dB from voiced median)',
        native: {
            pitch: nativeAligned.pitch,
            intensity: nativeAligned.intensity,
            medianHz: nativePitch.medianHz,
            medianDb: nativeIntensity.medianDb
        },
        learner: {
            pitch: learnerAligned.pitch,
            intensity: learnerAligned.intensity,
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

/**
 * Keep only spans that describe a real, forward-running interval, and fill in
 * `duration` when the source omits it. Engines disagree on which fields they
 * publish — the comparison view model keeps only the boundary times — while
 * `buildDurationLanes` reads `duration`, so normalize once here.
 */
export function normalizeChartSpans(syllables) {
    return (Array.isArray(syllables) ? syllables : [])
        .filter((syllable) => (
            Number.isFinite(syllable?.startTime) &&
            Number.isFinite(syllable?.endTime) &&
            syllable.endTime > syllable.startTime
        ))
        .map((syllable) => (
            Number.isFinite(syllable.duration)
                ? syllable
                : { ...syllable, duration: syllable.endTime - syllable.startTime }
        ));
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
    nativeStressEvidence = null,
    learnerStressEvidence = null,
    threshold = ANALYSIS_CONFIDENCE_THRESHOLD
}) {
    const stressIsRateable = (evidence) => (
        evidence === null ||
        (
            evidence?.rateable === true &&
            Number(evidence.confidence) >= threshold
        )
    );
    return (
        targetCount === observedCount &&
        targetCount > 0 &&
        nativeQuality?.rateable === true &&
        learnerQuality?.rateable === true &&
        Number(nativeQuality.confidence) >= threshold &&
        Number(learnerQuality.confidence) >= threshold &&
        stressIsRateable(nativeStressEvidence) &&
        stressIsRateable(learnerStressEvidence)
    );
}

export function buildLexicalFallbackFeedback({
    provider,
    targetCount,
    observedCount,
    targetPrimaryStress,
    observedPrimaryStress,
    learnerQuality,
    learnerStressEvidence,
    threshold = ANALYSIS_CONFIDENCE_THRESHOLD
}) {
    if (
        provider !== 'cmu-pronouncing-dictionary' ||
        targetCount !== observedCount ||
        targetCount < 1 ||
        learnerQuality?.rateable !== true ||
        Number(learnerQuality.confidence) < threshold ||
        learnerStressEvidence?.rateable !== true ||
        Number(learnerStressEvidence.confidence) < threshold ||
        !Number.isInteger(targetPrimaryStress) ||
        !Number.isInteger(observedPrimaryStress)
    ) {
        return null;
    }
    const matches = targetPrimaryStress === observedPrimaryStress;
    return {
        matches,
        message: matches
            ? 'Syllable count and primary stress match the CMU lexical fallback.'
            : `Syllable count matches. Target primary stress: syllable ${targetPrimaryStress + 1}; ` +
                `observed: syllable ${observedPrimaryStress + 1}.`
    };
}

export function formatRelativePitchTooltip(point) {
    if (!point || point.y === null) return 'No voiced pitch';
    return `${Number(point.y).toFixed(1)} semitones · ${Math.round(point.rawHz)} Hz`;
}
