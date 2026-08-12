export const ANALYSIS_CONFIDENCE_THRESHOLD = 0.65;
const OCTAVE_EQUIVALENCE_TOLERANCE_ST = 4;

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

export function cleanPitchContour(points) {
    const cleaned = points.map((point) => ({ ...point }));

    // First pass: identify all voiced segments and compute their medians.
    const segments = [];
    let cursor = 0;
    while (cursor < points.length) {
        while (cursor < points.length && points[cursor].y === null) cursor += 1;
        if (cursor >= points.length) break;
        let end = cursor;
        while (end + 1 < points.length && points[end + 1].y !== null) end += 1;
        const segMedian = median(
            cleaned.slice(cursor, end + 1).map((point) => point.y)
        );
        segments.push({ start: cursor, end, median: segMedian, octaveOffset: 0 });
        cursor = end + 1;
    }

    // Second pass: decide octave correction using neighbor context.
    // A genuine pitch descent (e.g. stressed → unstressed) can reach -10 ST,
    // which sits close to -12 and would be falsely "corrected" without context.
    for (let s = 0; s < segments.length; s += 1) {
        const seg = segments[s];
        const segmentCenter = seg.median;
        if (!Number.isFinite(segmentCenter)) continue;
        const nearestOctave = Math.round(segmentCenter / 12) * 12;
        if (nearestOctave === 0) continue;
        if (Math.abs(segmentCenter - nearestOctave) >= OCTAVE_EQUIVALENCE_TOLERANCE_ST) continue;

        const correctedMedian = segmentCenter - nearestOctave;
        let distUncorrected = 0;
        let distCorrected = 0;
        let neighborCount = 0;
        if (s > 0) {
            const prev = segments[s - 1].median - segments[s - 1].octaveOffset;
            distUncorrected += Math.abs(segmentCenter - prev);
            distCorrected += Math.abs(correctedMedian - prev);
            neighborCount += 1;
        }
        if (s < segments.length - 1) {
            const next = segments[s + 1].median;
            distUncorrected += Math.abs(segmentCenter - next);
            distCorrected += Math.abs(correctedMedian - next);
            neighborCount += 1;
        }
        seg.octaveOffset = (neighborCount > 0 && distCorrected < distUncorrected)
            ? nearestOctave
            : 0;
    }

    // Third pass: apply corrections, within-run unwrapping, and smoothing.
    for (const seg of segments) {
        if (seg.octaveOffset !== 0) {
            for (let index = seg.start; index <= seg.end; index += 1) {
                cleaned[index].y = Number((cleaned[index].y - seg.octaveOffset).toFixed(4));
            }
        }

        for (let index = seg.start + 1; index <= seg.end; index += 1) {
            const previous = cleaned[index - 1].y;
            let current = cleaned[index].y;
            while (current - previous > 6) current -= 12;
            while (previous - current > 6) current += 12;
            cleaned[index].y = Number(current.toFixed(4));
        }

        if (seg.end - seg.start + 1 >= 5) {
            const medianFiltered = cleaned.map((point) => ({ ...point }));
            for (let index = seg.start; index <= seg.end; index += 1) {
                const windowStart = Math.max(seg.start, index - 2);
                const windowEnd = Math.min(seg.end, index + 2);
                const window = [];
                for (let c = windowStart; c <= windowEnd; c += 1) {
                    window.push(cleaned[c].y);
                }
                medianFiltered[index].y = Number(median(window).toFixed(4));
            }
            for (let index = seg.start; index <= seg.end; index += 1) {
                if (index === seg.start || index === seg.end) {
                    cleaned[index].y = medianFiltered[index].y;
                    continue;
                }
                cleaned[index].y = Number((
                    medianFiltered[index - 1].y * 0.25
                    + medianFiltered[index].y * 0.5
                    + medianFiltered[index + 1].y * 0.25
                ).toFixed(4));
            }
        }
    }

    return cleaned;
}

function octaveNormalizedPitchMedian(values) {
    const voiced = values.filter(finitePositive).map(Number);
    if (!voiced.length) return null;
    const anchor = voiced[0];
    const octaveBoundary = Math.sqrt(2);
    const folded = voiced.map((rawValue) => {
        let value = rawValue;
        while (value / anchor > octaveBoundary) value /= 2;
        while (anchor / value > octaveBoundary) value *= 2;
        return value;
    });
    return median(folded);
}

function relativePitchSeries(analysis) {
    const times = Array.isArray(analysis?.pitch?.times) ? analysis.pitch.times : [];
    const values = Array.isArray(analysis?.pitch?.values) ? analysis.pitch.values : [];
    const speakerMedianF0 = octaveNormalizedPitchMedian(values);
    const rawPoints = times.map((time, index) => {
        const rawHz = finitePositive(values[index]) ? Number(values[index]) : null;
        return {
            x: Number(time),
            y: hzToRelativeSemitones(rawHz, speakerMedianF0),
            rawHz
        };
    });
    return {
        medianHz: speakerMedianF0,
        points: cleanPitchContour(rawPoints)
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
    if (nativeAnalysis?.pitch?.unit === 'semitones') {
        return {
            pitchAxisLabel: 'Relative pitch (semitones)',
            intensityAxisLabel: nativeAnalysis?.intensity?.unit === 'relative-dB' ? 'Relative intensity (dB)' : 'Intensity (dB)',
            pitch: pitchTimes.map((time, index) => ({
                x: Number(time),
                y: Number.isFinite(Number(pitchValues[index])) ? Number(pitchValues[index]) : null,
                rawHz: null
            })),
            intensity: intensityTimes.map((time, index) => ({
                x: Number(time),
                y: Number.isFinite(Number(intensityValues[index])) ? Number(intensityValues[index]) : null
            }))
        };
    }
    const speakerMedianF0 = octaveNormalizedPitchMedian(pitchValues);
    const rawPitch = pitchTimes.map((time, index) => {
        const rawHz = finitePositive(pitchValues[index]) ? Number(pitchValues[index]) : null;
        return {
            x: Number(time),
            y: hzToRelativeSemitones(rawHz, speakerMedianF0),
            rawHz
        };
    });
    const cleanedPitch = cleanPitchContour(rawPitch);
    return {
        pitchAxisLabel: 'Pitch (Hz)',
        intensityAxisLabel: 'Intensity (dB)',
        pitch: cleanedPitch.map((point, index) => ({
            x: point.x,
            y: point.y === null
                ? null
                : Math.abs(point.y - rawPitch[index].y) < 0.0001
                    ? point.rawHz
                    : Number((speakerMedianF0 * (2 ** (point.y / 12))).toFixed(4)),
            rawHz: point.rawHz
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
        .map((syllable) => {
            const start = syllable?.measurementStartTime ?? syllable?.startTime;
            const end = syllable?.measurementEndTime ?? syllable?.endTime;
            if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
            const out = { ...syllable, startTime: start, endTime: end };
            const widened = start !== syllable?.startTime || end !== syllable?.endTime;
            if (widened || !Number.isFinite(out.duration)) out.duration = end - start;
            return out;
        })
        .filter(Boolean);
}

/**
 * Normalize the full contiguous spans used by waveform regions and playback.
 * Raw CTC coverage and acoustic measurement windows remain untouched on the
 * returned objects for technical inspection and chart calculations.
 */
export function normalizePlaybackSpans(syllables) {
    return (Array.isArray(syllables) ? syllables : [])
        .map((syllable) => {
            const start = syllable?.partitionStartTime
                ?? syllable?.partition_start_time
                ?? syllable?.startTime
                ?? syllable?.start_time;
            const end = syllable?.partitionEndTime
                ?? syllable?.partition_end_time
                ?? syllable?.endTime
                ?? syllable?.end_time;
            if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
            return {
                ...syllable,
                startTime: start,
                endTime: end,
                duration: end - start
            };
        })
        .filter(Boolean);
}

export function buildDurationLanes(targetSyllables = [], observedSyllables = []) {
    const duration = (syllable) => {
        const explicitPartitionDuration = Number(
            syllable?.partitionDuration ?? syllable?.partition_duration
        );
        if (Number.isFinite(explicitPartitionDuration) && explicitPartitionDuration >= 0) {
            return explicitPartitionDuration;
        }
        const partitionStart = Number(
            syllable?.partitionStartTime ?? syllable?.partition_start_time
        );
        const partitionEnd = Number(
            syllable?.partitionEndTime ?? syllable?.partition_end_time
        );
        if (
            Number.isFinite(partitionStart)
            && Number.isFinite(partitionEnd)
            && partitionEnd >= partitionStart
        ) {
            return partitionEnd - partitionStart;
        }
        return Number(syllable?.duration ?? syllable?.vowelDuration ?? 0);
    };
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
