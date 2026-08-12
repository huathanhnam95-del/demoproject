export const REFERENCE_GRAPH_ANALYSIS_VERSION = 'pronunciation-reference-graph-v1';
export const REFERENCE_GRAPH_MODEL_VERSION = 'lexical-stress-model-v1';

const PROMINENCE = Object.freeze({
    primary: Object.freeze({ pitch: 3, intensity: 3, duration: 1.25 }),
    secondary: Object.freeze({ pitch: 1.5, intensity: 1.5, duration: 1.1 }),
    none: Object.freeze({ pitch: 0, intensity: 0, duration: 1 })
});
const SAMPLE_OFFSETS = [0, 0.25, 0.5, 0.75, 1];
const SAMPLE_ENVELOPE = [0.35, 0.75, 1, 0.75, 0.35];

function invariant(condition, message) {
    if (!condition) throw new Error(`Invalid modeled pronunciation graph: ${message}`);
}

function round6(value) {
    return Math.round((Number(value) + Number.EPSILON) * 1e6) / 1e6;
}

function prominenceAt(index, primaryStress, secondaryStress) {
    if (index === primaryStress) return 'primary';
    if (secondaryStress.has(index)) return 'secondary';
    return 'none';
}

export function buildModeledReferenceAnalysis(variant, diagnostics = null) {
    invariant(variant && typeof variant === 'object', 'variant is required');
    invariant(/^[0-9a-f]{16}$/.test(variant.id || ''), 'valid variant id is required');
    invariant(Array.isArray(variant.syllables) && variant.syllables.length > 0, 'structured syllables are required');
    invariant(variant.syllableCount === variant.syllables.length, 'syllable count mismatch');
    invariant(Number.isInteger(variant.primaryStress) && variant.primaryStress >= 0 && variant.primaryStress < variant.syllableCount, 'primary stress is out of range');

    const secondaryStress = new Set(variant.secondaryStress || []);
    secondaryStress.delete(variant.primaryStress);
    const count = variant.syllableCount;
    const prominenceNames = variant.syllables.map((_, index) => prominenceAt(index, variant.primaryStress, secondaryStress));
    const pitchTargets = prominenceNames.map((name) => PROMINENCE[name].pitch);
    const intensityTargets = prominenceNames.map((name) => PROMINENCE[name].intensity);
    const pitchCenter = pitchTargets.reduce((sum, value) => sum + value, 0) / count;
    const intensityCenter = intensityTargets.reduce((sum, value) => sum + value, 0) / count;
    const pitchTimes = [];
    const pitchValues = [];
    const intensityTimes = [];
    const intensityValues = [];

    const observedSyllables = variant.syllables.map((source, index) => {
        const prominence = prominenceNames[index];
        SAMPLE_OFFSETS.forEach((offset, sampleIndex) => {
            const time = (index + offset) / count;
            const envelope = SAMPLE_ENVELOPE[sampleIndex];
            pitchTimes.push(round6(time));
            intensityTimes.push(round6(time));
            pitchValues.push(round6((PROMINENCE[prominence].pitch - pitchCenter) * envelope));
            intensityValues.push(round6((PROMINENCE[prominence].intensity - intensityCenter) * envelope));
        });
        return {
            ...source,
            index,
            startTime: round6(index / count),
            endTime: round6((index + 1) / count),
            duration: round6(1 / count),
            prominence
        };
    });
    const rawDurations = prominenceNames.map((name) => PROMINENCE[name].duration);
    const meanDuration = rawDurations.reduce((sum, value) => sum + value, 0) / count;
    const result = {
        analysisVersion: REFERENCE_GRAPH_ANALYSIS_VERSION,
        variantId: variant.id,
        canonicalSyllableCount: count,
        canonicalPrimaryStress: variant.primaryStress,
        graphSource: {
            kind: 'modeled',
            label: 'Expected stress pattern',
            measured: false,
            audioUrl: null,
            version: REFERENCE_GRAPH_MODEL_VERSION
        },
        quality: { rateable: true, confidence: 1, reasons: [] },
        segmentation: { selectedCount: count, method: 'lexical-stress-model', confidence: 1, conflicts: [] },
        observed: {
            syllableCount: count,
            primaryStress: variant.primaryStress,
            syllables: observedSyllables,
            stressEvidence: { primaryStress: variant.primaryStress, confidence: 1, rateable: true, reasons: [], source: REFERENCE_GRAPH_MODEL_VERSION }
        },
        pitch: { unit: 'semitones', times: pitchTimes, values: pitchValues },
        intensity: { unit: 'relative-dB', times: intensityTimes, values: intensityValues },
        duration: { unit: 'normalized', values: rawDurations.map((value) => round6(value / meanDuration)) },
        capabilities: { showReferenceGraph: true, showNativeGraphs: false, compareFrameLevel: false }
    };
    if (diagnostics) result.sourceDiagnostics = diagnostics;
    return result;
}

export function resolveReferenceAnalysis(variant) {
    const measured = variant?.nativeAnalysis;
    if (
        measured?.capabilities?.showNativeGraphs === true &&
        measured?.audioCompatibility?.status === 'compatible'
    ) {
        return measured;
    }
    // A valid dictionary recording with no analysis is an analyzer outage or
    // retryable cache miss, not evidence for a synthetic contour. Keep the
    // graph hidden until the recording is actually measured.
    if (!measured && variant?.audioUrl) return null;
    const reason = measured?.audioCompatibility?.reasons?.[0]
        || measured?.pitchProcessing?.reasons?.[0]
        || (!variant?.audioUrl ? 'MISSING_SOURCE_AUDIO' : 'REFERENCE_ANALYSIS_UNAVAILABLE');
    return buildModeledReferenceAnalysis(variant, {
        reason,
        measuredAnalysisAvailable: Boolean(measured)
    });
}

export function resolveReferenceVariants(reference) {
    return {
        ...reference,
        variants: (reference?.variants || []).map((sourceVariant) => {
            const variant = structuredClone(sourceVariant);
            if (
                variant?.validation?.status !== 'valid'
                || !Array.isArray(variant.syllables)
                || variant.syllables.length === 0
            ) {
                return {
                    ...variant,
                    referenceAnalysis: null,
                    capabilities: { ...variant.capabilities, showReferenceGraph: false }
                };
            }
            const referenceAnalysis = resolveReferenceAnalysis(variant);
            return {
                ...variant,
                referenceAnalysis,
                capabilities: {
                    ...variant.capabilities,
                    showReferenceGraph: referenceAnalysis?.capabilities?.showReferenceGraph === true
                        || referenceAnalysis?.capabilities?.showNativeGraphs === true
                }
            };
        })
    };
}

export function applyGeneratedAudioResolution(variant, resolution) {
    if (
        resolution?.available !== true
        || !resolution?.generatedAudio?.url
        || resolution?.referenceAnalysis?.graphSource?.kind !== 'measured-generated'
    ) return variant;
    return {
        ...variant,
        audioUrl: resolution.generatedAudio.url,
        audioSourceKind: 'generated',
        generatedAudio: resolution.generatedAudio,
        nativeAnalysis: resolution.referenceAnalysis,
        referenceAnalysis: resolution.referenceAnalysis,
        capabilities: {
            ...variant.capabilities,
            playAudio: true,
            showNativeGraphs: true,
            showReferenceGraph: true
        }
    };
}
