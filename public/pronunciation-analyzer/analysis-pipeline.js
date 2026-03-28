const PRAAT_BOUNDARY_REPAIR_CONFIG = {
    voicedPitchThreshold: 70,
    minUnvoicedFrames: 2,
    minSyllableDuration: 0.06,
    minBoundaryShift: 0.015,
    intensityDropRatio: 0.72
};

const PRAAT_TRAILING_TAIL_CONFIG = {
    voicedPitchThreshold: 70,
    maxTrailingDuration: 0.19,
    maxTrailingRelativeDuration: 0.72,
    maxVoicedFrameRatio: 0.2,
    maxTrailingPeakPitch: 120
};

function hasFiniteMetric(value) {
    return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
}

function roundTime(value) {
    return Number(Number(value || 0).toFixed(3));
}

function clamp(value, minValue, maxValue) {
    return Math.min(Math.max(value, minValue), maxValue);
}

function toNumberOrZero(value) {
    return hasFiniteMetric(value) ? Number(value) : 0;
}

function findFirstIndexAtOrAfter(times, targetTime) {
    if (!Array.isArray(times) || times.length === 0) return -1;
    const index = times.findIndex((time) => Number(time) >= targetTime);
    return index === -1 ? times.length - 1 : index;
}

function findPeakFrameIndex(times, intensities, pitches, startTime, endTime, config = PRAAT_BOUNDARY_REPAIR_CONFIG) {
    if (!Array.isArray(times) || times.length === 0) return -1;
    let bestIndex = -1;
    let bestScore = -Infinity;

    for (let index = 0; index < times.length; index += 1) {
        const time = Number(times[index]);
        if (!Number.isFinite(time) || time < startTime || time > endTime) continue;
        const intensity = hasFiniteMetric(intensities?.[index]) ? Number(intensities[index]) : 0;
        const pitch = hasFiniteMetric(pitches?.[index]) ? Number(pitches[index]) : 0;
        const score = intensity + (pitch > config.voicedPitchThreshold ? 20 : 0);
        if (score > bestScore) {
            bestScore = score;
            bestIndex = index;
        }
    }

    return bestIndex;
}

function findBoundaryRepairTime(analysis, currentSyllable, nextSyllable, config = PRAAT_BOUNDARY_REPAIR_CONFIG) {
    const times = Array.isArray(analysis?.pitch?.times) && analysis.pitch.times.length > 0
        ? analysis.pitch.times
        : analysis?.intensity?.times;
    const pitches = Array.isArray(analysis?.pitch?.values) ? analysis.pitch.values : [];
    const intensities = Array.isArray(analysis?.intensity?.values) ? analysis.intensity.values : [];
    const currentStart = Number(currentSyllable?.startTime);
    const currentEnd = Number(currentSyllable?.endTime);
    const nextEnd = Number(nextSyllable?.endTime);

    if (!Array.isArray(times) || times.length === 0) return null;
    if (!Number.isFinite(currentStart) || !Number.isFinite(currentEnd) || !Number.isFinite(nextEnd) || currentEnd <= currentStart) {
        return null;
    }

    const peakIndex = findPeakFrameIndex(times, intensities, pitches, currentStart, currentEnd, config);
    const boundaryIndex = findFirstIndexAtOrAfter(times, currentEnd);
    if (peakIndex < 0 || boundaryIndex <= peakIndex) return null;

    const peakIntensity = hasFiniteMetric(intensities?.[peakIndex]) ? Number(intensities[peakIndex]) : 0;
    if (!(peakIntensity > 0)) return null;

    let runStartIndex = -1;
    let runLength = 0;

    for (let index = peakIndex + 1; index <= boundaryIndex; index += 1) {
        const pitch = hasFiniteMetric(pitches?.[index]) ? Number(pitches[index]) : null;
        const intensity = hasFiniteMetric(intensities?.[index]) ? Number(intensities[index]) : null;
        const isUnvoiced = !(pitch !== null && pitch > config.voicedPitchThreshold);
        const hasIntensityDrop = intensity !== null && intensity <= peakIntensity * config.intensityDropRatio;

        if (isUnvoiced && hasIntensityDrop) {
            if (runStartIndex === -1) {
                runStartIndex = index;
            }
            runLength += 1;
            if (runLength >= config.minUnvoicedFrames) {
                return Number(times[runStartIndex]);
            }
        } else {
            runStartIndex = -1;
            runLength = 0;
        }
    }

    return null;
}

function repairPraatSyllableBoundaries(analysis, config = PRAAT_BOUNDARY_REPAIR_CONFIG) {
    if (!analysis || typeof analysis !== 'object' || !Array.isArray(analysis.syllables) || analysis.syllables.length < 2) {
        return analysis;
    }

    const repairedSyllables = analysis.syllables.map((syllable) => ({ ...syllable }));

    for (let index = 0; index < repairedSyllables.length - 1; index += 1) {
        const current = repairedSyllables[index];
        const next = repairedSyllables[index + 1];
        const repairTime = findBoundaryRepairTime(analysis, current, next, config);

        if (!hasFiniteMetric(repairTime)) continue;

        const minBoundary = Number(current.startTime) + config.minSyllableDuration;
        const maxBoundary = Number(next.endTime) - config.minSyllableDuration;
        if (!Number.isFinite(minBoundary) || !Number.isFinite(maxBoundary) || maxBoundary <= minBoundary) continue;

        const adjustedBoundary = clamp(Number(repairTime), minBoundary, maxBoundary);
        const shiftAmount = Number(current.endTime) - adjustedBoundary;
        if (!Number.isFinite(shiftAmount) || shiftAmount < config.minBoundaryShift) continue;

        current.endTime = roundTime(adjustedBoundary);
        current.duration = roundTime(Number(current.endTime) - Number(current.startTime));
        next.startTime = current.endTime;
        next.duration = roundTime(Number(next.endTime) - Number(next.startTime));
    }

    return {
        ...analysis,
        syllables: repairedSyllables
    };
}

function summarizeSyllableVoicing(analysis, syllable, config = PRAAT_TRAILING_TAIL_CONFIG) {
    const times = Array.isArray(analysis?.pitch?.times) && analysis.pitch.times.length > 0
        ? analysis.pitch.times
        : analysis?.intensity?.times;
    const pitches = Array.isArray(analysis?.pitch?.values) ? analysis.pitch.values : [];

    if (!Array.isArray(times) || times.length === 0 || !syllable) {
        return {
            frameCount: 0,
            voicedFrameCount: 0,
            voicedFrameRatio: 0,
            peakPitch: 0
        };
    }

    let frameCount = 0;
    let voicedFrameCount = 0;
    let peakPitch = 0;

    for (let index = 0; index < times.length; index += 1) {
        const time = Number(times[index]);
        if (!Number.isFinite(time) || time < Number(syllable.startTime) || time > Number(syllable.endTime)) continue;

        frameCount += 1;
        const pitch = hasFiniteMetric(pitches?.[index]) ? Number(pitches[index]) : 0;
        if (pitch > config.voicedPitchThreshold) {
            voicedFrameCount += 1;
            peakPitch = Math.max(peakPitch, pitch);
        }
    }

    return {
        frameCount,
        voicedFrameCount,
        voicedFrameRatio: frameCount > 0 ? voicedFrameCount / frameCount : 0,
        peakPitch
    };
}

function mergeTrailingSyllable(previousSyllable, trailingSyllable) {
    const previousDuration = Number(previousSyllable?.duration) || (Number(previousSyllable?.endTime) - Number(previousSyllable?.startTime));
    const trailingDuration = Number(trailingSyllable?.duration) || (Number(trailingSyllable?.endTime) - Number(trailingSyllable?.startTime));
    const totalDuration = Math.max(0, Number(trailingSyllable?.endTime) - Number(previousSyllable?.startTime));
    const weightedPitchSum = (toNumberOrZero(previousSyllable?.avgPitch) * Math.max(previousDuration, 0)) +
        (toNumberOrZero(trailingSyllable?.avgPitch) * Math.max(trailingDuration, 0));
    const weightedDuration = Math.max(previousDuration, 0) + Math.max(trailingDuration, 0);

    return {
        ...previousSyllable,
        endTime: roundTime(trailingSyllable.endTime),
        duration: roundTime(totalDuration),
        avgPitch: weightedDuration > 0 ? Math.round(weightedPitchSum / weightedDuration) : toNumberOrZero(previousSyllable?.avgPitch),
        maxPitch: Math.max(toNumberOrZero(previousSyllable?.maxPitch), toNumberOrZero(trailingSyllable?.maxPitch)),
        intensity: Math.max(toNumberOrZero(previousSyllable?.intensity), toNumberOrZero(trailingSyllable?.intensity)),
        avgEnergy: Math.max(toNumberOrZero(previousSyllable?.avgEnergy), toNumberOrZero(trailingSyllable?.avgEnergy)),
        maxEnergy: Math.max(toNumberOrZero(previousSyllable?.maxEnergy), toNumberOrZero(trailingSyllable?.maxEnergy)),
        vowelDuration: roundTime(toNumberOrZero(previousSyllable?.vowelDuration) + toNumberOrZero(trailingSyllable?.vowelDuration)),
        isUnvoiced: Boolean(previousSyllable?.isUnvoiced && trailingSyllable?.isUnvoiced),
        pitchConfidence: Math.max(toNumberOrZero(previousSyllable?.pitchConfidence), toNumberOrZero(trailingSyllable?.pitchConfidence))
    };
}

function shouldMergeTrailingTail(analysis, previousSyllable, trailingSyllable, config = PRAAT_TRAILING_TAIL_CONFIG) {
    if (!previousSyllable || !trailingSyllable) return false;

    const trailingDuration = Number(trailingSyllable.duration) || (Number(trailingSyllable.endTime) - Number(trailingSyllable.startTime));
    const previousDuration = Number(previousSyllable.duration) || (Number(previousSyllable.endTime) - Number(previousSyllable.startTime));

    if (!Number.isFinite(trailingDuration) || trailingDuration <= 0) return false;
    if (!Number.isFinite(previousDuration) || previousDuration <= 0) return false;

    const trailingVoicing = summarizeSyllableVoicing(analysis, trailingSyllable, config);
    const trailingPeakPitch = Math.max(trailingVoicing.peakPitch, toNumberOrZero(trailingSyllable.maxPitch), toNumberOrZero(trailingSyllable.avgPitch));
    const trailingMostlyUnvoiced = trailingVoicing.voicedFrameRatio <= config.maxVoicedFrameRatio;
    const trailingPitchWeak = trailingPeakPitch <= config.maxTrailingPeakPitch;
    const trailingShort = trailingDuration <= config.maxTrailingDuration;
    const trailingShortRelative = trailingDuration <= previousDuration * config.maxTrailingRelativeDuration;

    return trailingMostlyUnvoiced && trailingPitchWeak && (trailingShort || trailingShortRelative);
}

function collapseTrailingConsonantTail(analysis, expectedSyllables, config = PRAAT_TRAILING_TAIL_CONFIG) {
    if (!analysis || typeof analysis !== 'object' || !Array.isArray(analysis.syllables) || !Number.isFinite(expectedSyllables)) {
        return analysis;
    }

    if (analysis.syllables.length <= expectedSyllables || expectedSyllables < 1) {
        return analysis;
    }

    const repairedSyllables = analysis.syllables.map((syllable) => ({ ...syllable }));

    while (repairedSyllables.length > expectedSyllables) {
        const trailingSyllable = repairedSyllables[repairedSyllables.length - 1];
        const previousSyllable = repairedSyllables[repairedSyllables.length - 2];

        if (!shouldMergeTrailingTail(analysis, previousSyllable, trailingSyllable, config)) {
            break;
        }

        repairedSyllables.splice(
            repairedSyllables.length - 2,
            2,
            mergeTrailingSyllable(previousSyllable, trailingSyllable)
        );
    }

    return {
        ...analysis,
        syllables: repairedSyllables
    };
}

export async function analyzeRecordedAttempt({
    audioBlob,
    expectedSyllables = null,
    preferPraat = false,
    praatAnalyze,
    decodeBlob,
    pitchAnalyze,
    detectSyllables
}) {
    if (!audioBlob) {
        return {
            engine: preferPraat ? 'praat' : 'local',
            usedPraatFallback: false,
            audioBuffer: null,
            analysis: null,
            analysisData: null,
            syllables: [],
            noiseCount: 0,
            quality: {
                rateable: false,
                reason: 'no_speech',
                metrics: {
                    peakEnergy: 0,
                    activeSpeechDurationMs: 0,
                    voicedFrameRatio: 0,
                    activeFrameCount: 0
                }
            }
        };
    }

    if (preferPraat && typeof praatAnalyze === 'function') {
        try {
            const praatAnalysis = await praatAnalyze(audioBlob, expectedSyllables);
            const repairedAnalysis = repairPraatSyllableBoundaries(praatAnalysis);
            const analysis = collapseTrailingConsonantTail(repairedAnalysis, expectedSyllables);
            const syllables = Array.isArray(analysis?.syllables) ? analysis.syllables : [];
            const quality = analysis?.quality || {
                rateable: syllables.length > 0,
                reason: syllables.length > 0 ? null : 'no_speech',
                metrics: {
                    peakEnergy: 0,
                    activeSpeechDurationMs: 0,
                    voicedFrameRatio: 0,
                    activeFrameCount: 0
                }
            };

            return {
                engine: 'praat',
                usedPraatFallback: false,
                audioBuffer: null,
                analysis,
                analysisData: null,
                syllables,
                noiseCount: analysis?.noiseCount || 0,
                quality
            };
        } catch (error) {
            const localResult = await analyzeLocalAttempt({
                audioBlob,
                expectedSyllables,
                decodeBlob,
                pitchAnalyze,
                detectSyllables
            });

            return {
                ...localResult,
                engine: 'local',
                usedPraatFallback: true,
                praatError: error?.message || String(error)
            };
        }
    }

    return analyzeLocalAttempt({
        audioBlob,
        expectedSyllables,
        decodeBlob,
        pitchAnalyze,
        detectSyllables
    });
}

async function analyzeLocalAttempt({
    audioBlob,
    expectedSyllables,
    decodeBlob,
    pitchAnalyze,
    detectSyllables
}) {
    const audioBuffer = typeof decodeBlob === 'function' ? await decodeBlob(audioBlob) : null;

    if (!audioBuffer || typeof pitchAnalyze !== 'function' || typeof detectSyllables !== 'function') {
        return {
            engine: 'local',
            usedPraatFallback: false,
            audioBuffer: audioBuffer || null,
            analysis: null,
            analysisData: null,
            syllables: [],
            noiseCount: 0,
            quality: {
                rateable: false,
                reason: 'no_speech',
                metrics: {
                    peakEnergy: 0,
                    activeSpeechDurationMs: 0,
                    voicedFrameRatio: 0,
                    activeFrameCount: 0
                }
            }
        };
    }

    const analysisData = pitchAnalyze(audioBuffer);
    const detected = detectSyllables(analysisData, expectedSyllables);
    const syllables = Array.isArray(detected?.syllables) ? detected.syllables : [];
    const noiseCount = detected?.noiseCount || 0;
    const quality = detected?.quality || {
        rateable: syllables.length > 0,
        reason: syllables.length > 0 ? null : 'no_speech',
        metrics: {
            peakEnergy: 0,
            activeSpeechDurationMs: 0,
            voicedFrameRatio: 0,
            activeFrameCount: 0
        }
    };

    return {
        engine: 'local',
        usedPraatFallback: false,
        audioBuffer,
        analysis: null,
        analysisData,
        syllables,
        noiseCount,
        quality
    };
}
