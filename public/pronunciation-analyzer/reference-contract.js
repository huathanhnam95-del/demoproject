export const SCHEMA_VERSION = 10;
export const ALGORITHM_VERSION = 'pronunciation-reference-v4';
export const ANALYSIS_VERSION = 'pronunciation-analysis-v2';
export const PITCH_PROCESSING_VERSION = 'canonical-pitch-v1';
export const ACOUSTIC_COMPATIBILITY_VERSION = 'reference-audio-compatibility-v1';
export const DIALECT = 'en-US';
export const NATIVE_ANALYSIS_RETRY_DELAY_MS = 500;

function invariant(condition, message) {
    if (!condition) throw new Error('Invalid pronunciation reference: ' + message);
}

function isStressIndex(value, count) {
    return Number.isInteger(value) && value >= 0 && value < count;
}

const NON_US_SOURCE_REGIONS = [
    'australian',
    'british',
    'canadian',
    'irish',
    'new zealand',
    'scottish',
    'south african'
];

function sourceLabelsAreEnUsCompatible(labels) {
    const labelText = labels.join(' ').toLowerCase();
    const explicitlyUs = (
        /\bu\.?s\.?(?:a\.?)?\b/.test(labelText) ||
        labelText.includes('united states') ||
        labelText.includes('american')
    );
    return explicitlyUs || !NON_US_SOURCE_REGIONS.some((region) => labelText.includes(region));
}

function validateVariant(variant) {
    invariant(variant && typeof variant === 'object', 'variant must be an object');
    invariant(/^[0-9a-f]{16}$/.test(variant.id || ''), 'invalid variant id');
    invariant(['citation', 'strong', 'weak'].includes(variant.formRole), 'invalid form role');
    invariant(
        ['preferred', 'accepted'].includes(variant.usage?.isolated),
        'invalid isolated form usage'
    );
    invariant(
        ['preferred', 'accepted'].includes(variant.usage?.connectedSpeech),
        'invalid connected-speech form usage'
    );
    invariant(variant.conditions && typeof variant.conditions === 'object', 'form conditions are required');
    invariant(
        ['merriam-webster', 'cmu-pronouncing-dictionary'].includes(variant.source?.provider),
        'unknown source provider'
    );
    invariant(variant.source.dialect === DIALECT, 'source dialect mismatch');
    invariant(Array.isArray(variant.source.labels), 'source labels must be an array');
    invariant(
        variant.source.labels.every((label) => typeof label === 'string' && label.length > 0),
        'source labels must be non-empty strings'
    );
    invariant(
        sourceLabelsAreEnUsCompatible(variant.source.labels),
        'non-US source label is incompatible with en-US'
    );
    if (variant.source.provider === 'merriam-webster') {
        invariant(
            variant.source.transcription === 'merriam-webster-ipa',
            'Merriam-Webster transcription provenance must be explicit'
        );
    }
    if (variant.source.provider === 'cmu-pronouncing-dictionary') {
        invariant(
            variant.source.transcription === 'cmu-arpabet-converted',
            'CMU fallback transcription must be explicit'
        );
        invariant(!variant.audioUrl, 'CMU fallback must not expose native audio');
        invariant(
            variant.capabilities?.playAudio === false &&
                variant.capabilities?.showNativeGraphs === false,
            'CMU fallback must disable native audio and graphs'
        );
    }
    invariant(Array.isArray(variant.syllables), 'syllables must be an array');
    invariant(
        Number.isInteger(variant.syllableCount) &&
            variant.syllableCount === variant.syllables.length,
        'syllable count does not match structured syllables'
    );
    invariant(
        variant.primaryStress === null || isStressIndex(variant.primaryStress, variant.syllableCount),
        'primary stress is out of range'
    );
    invariant(Array.isArray(variant.secondaryStress), 'secondary stress must be an array');
    invariant(
        variant.secondaryStress.every((index) => isStressIndex(index, variant.syllableCount)),
        'secondary stress is out of range'
    );
    variant.syllables.forEach((syllable, index) => {
        invariant(syllable?.index === index, 'syllable indices must be contiguous');
        invariant(typeof syllable?.ipa === 'string' && syllable.ipa.length > 0, 'syllable IPA is required');
    });

    const status = variant.validation?.status;
    invariant(status === 'valid' || status === 'conflict', 'unknown validation status');
    invariant(Array.isArray(variant.validation?.conflicts), 'validation conflicts must be an array');
    invariant(variant.capabilities && typeof variant.capabilities === 'object', 'capabilities are required');
    if (status === 'conflict') {
        invariant(
            variant.capabilities.scoreCountStress === false &&
                variant.capabilities.showNativeGraphs === false,
            'conflicted variants must fail closed'
        );
    }
    if (variant.syllableCount === 1 && variant.displayIpa) {
        invariant(!variant.displayIpa.includes('ˈ'), 'monosyllable display IPA must omit stress mark');
    }
    return variant;
}

export function validateReferenceV2(reference, { expectedWord } = {}) {
    invariant(reference && typeof reference === 'object', 'response must be an object');
    invariant(reference.schemaVersion === SCHEMA_VERSION, 'schema version mismatch');
    invariant(reference.algorithmVersion === ALGORITHM_VERSION, 'algorithm version mismatch');
    invariant(reference.dialect === DIALECT, 'dialect mismatch');
    invariant(typeof reference.word === 'string' && reference.word.length > 0, 'word is required');
    if (expectedWord) {
        invariant(
            reference.word === String(expectedWord).trim().toLowerCase(),
            'word mismatch'
        );
    }
    invariant(Array.isArray(reference.variants), 'variants must be an array');
    invariant(reference.formDefaults && typeof reference.formDefaults === 'object', 'form defaults are required');
    const ids = new Set();
    reference.variants.forEach((variant) => {
        validateVariant(variant);
        invariant(!ids.has(variant.id), 'duplicate variant id');
        ids.add(variant.id);
    });
    ['isolated', 'connectedSpeech'].forEach((context) => {
        const formId = reference.formDefaults[context];
        if (formId !== null) {
            const selected = reference.variants.find((variant) => variant.id === formId);
            invariant(selected, `${context} form default is missing`);
            invariant(
                selected.validation.status === 'valid' && selected.source?.exactMatch === true,
                `${context} form default must be valid and exact`
            );
        }
    });
    if (reference.defaultVariantId !== null) {
        const selected = reference.variants.find((variant) => variant.id === reference.defaultVariantId);
        invariant(selected, 'default variant is missing');
        invariant(selected.validation.status === 'valid', 'default variant must be valid');
        invariant(selected.source?.exactMatch === true, 'default variant must be exact');
    }
    return reference;
}

export function buildReferenceCacheKey(word) {
    const normalizedWord = String(word || '').trim().toLowerCase();
    return [ALGORITHM_VERSION, SCHEMA_VERSION, DIALECT, normalizedWord].join('|');
}

function isSelectableVariant(variant) {
    return (
        variant?.validation?.status === 'valid' &&
        variant?.source?.exactMatch === true &&
        variant?.capabilities?.scoreCountStress === true &&
        typeof variant?.displayIpa === 'string' &&
        variant.displayIpa.length > 0 &&
        Number.isInteger(variant?.syllableCount) &&
        variant.syllableCount > 0
    );
}

export function getSelectableReferenceVariants(reference) {
    const validated = validateReferenceV2(reference);
    return validated.variants.filter(isSelectableVariant);
}

export function selectReferenceVariant(reference, variantId = null) {
    const validated = validateReferenceV2(reference);
    const selectedId = variantId || validated.defaultVariantId;
    invariant(selectedId, 'no valid default variant');
    const variant = validated.variants.find((item) => item.id === selectedId);
    invariant(variant, 'unknown variant');
    invariant(isSelectableVariant(variant), 'variant is not selectable');
    return variant;
}

export function hasUsableNativeContours(analysis) {
    const hasUsableSeries = (series, isPitch = false) => {
        const times = Array.isArray(series?.times) ? series.times : [];
        const values = Array.isArray(series?.values) ? series.values : [];
        return (
            times.length > 0 &&
            times.length === values.length &&
            values.some((value) => (
                Number.isFinite(value) && (!isPitch || value > 0)
            ))
        );
    };
    return (
        hasUsableSeries(analysis?.pitch, true) &&
        hasUsableSeries(analysis?.intensity)
    );
}

export function needsNativeAnalysisRefresh(variant) {
    // CMU/no-audio variants never need refresh
    if (!variant?.audioUrl) return false;
    // Invalid or conflicted variants (without audio capability) don't refresh
    if (variant?.validation?.status !== 'valid') return false;
    // No native analysis attached at all
    if (!variant.nativeAnalysis) return true;
    if (variant.nativeAnalysis?.pitchProcessing?.version !== PITCH_PROCESSING_VERSION) return true;
    if (variant.nativeAnalysis?.audioCompatibility?.version !== ACOUSTIC_COMPATIBILITY_VERSION) return true;
    // Has analysis but contours are unusable
    if (!hasUsableNativeContours(variant.nativeAnalysis)) return true;
    return false;
}

export function referenceNeedsNativeAnalysisRefresh(reference) {
    return Array.isArray(reference?.variants) &&
        reference.variants.some((variant) => needsNativeAnalysisRefresh(variant));
}

function isRetryableNativeAnalysisError(error) {
    const status = Number(error?.status);
    if (!Number.isFinite(status)) return true;
    return status === 408 || status === 429 || status >= 500;
}

export function validateNativeAnalysisForVariant(analysis, variant) {
    invariant(analysis && typeof analysis === 'object', 'native analysis is required');
    invariant(analysis.analysisVersion === ANALYSIS_VERSION, 'analysis version mismatch');
    invariant(analysis.variantId === variant.id, 'variant mismatch');
    invariant(analysis.pitchProcessing?.version === PITCH_PROCESSING_VERSION, 'pitch processing version mismatch');
    invariant(analysis.audioCompatibility?.version === ACOUSTIC_COMPATIBILITY_VERSION, 'audio compatibility version mismatch');
    invariant(
        analysis.canonicalSyllableCount === variant.syllableCount,
        'canonical count mismatch'
    );
    if (analysis.quality?.rateable === true) {
        invariant(
            analysis.segmentation?.selectedCount === variant.syllableCount &&
                analysis.observed?.syllableCount === variant.syllableCount &&
                analysis.observed?.syllables?.length === variant.syllableCount,
            'observed count mismatch'
        );
    } else {
        invariant(hasUsableNativeContours(analysis), 'native contours are unavailable');
    }
    invariant(analysis.capabilities?.showNativeGraphs === true, 'native graphs are unavailable');
    return analysis;
}

export function compressAnalysisV2(analysis) {
    if (!analysis || typeof analysis !== 'object') return null;
    const compressSeries = (series) => {
        const times = Array.isArray(series?.times) ? series.times : [];
        const values = Array.isArray(series?.values) ? series.values : [];
        const length = Math.min(times.length, values.length);
        const sampleRate = Math.max(1, Math.min(3, Math.floor(length / 100)));
        const compressedTimes = [];
        const compressedValues = [];
        const rawValues = Array.isArray(series?.rawValues) ? series.rawValues : null;
        const compressedRawValues = [];
        for (let index = 0; index < length; index += sampleRate) {
            compressedTimes.push(times[index]);
            compressedValues.push(values[index]);
            if (rawValues) compressedRawValues.push(rawValues[index]);
        }
        return {
            ...series,
            times: compressedTimes,
            values: compressedValues,
            ...(rawValues ? { rawValues: compressedRawValues } : {})
        };
    };
    return {
        ...analysis,
        observed: analysis.observed ? {
            ...analysis.observed,
            syllables: Array.isArray(analysis.observed.syllables)
                ? analysis.observed.syllables.map((syllable) => ({ ...syllable }))
                : []
        } : analysis.observed,
        pitch: compressSeries(analysis.pitch),
        intensity: compressSeries(analysis.intensity)
    };
}

export function buildNativeAnalysisRequest(variant, { audioSourceKind = 'dictionary' } = {}) {
    invariant(variant && typeof variant === 'object', 'variant is required');
    return {
        audioUrl: variant.generatedAudio?.url || variant.audioUrl,
        variantId: variant.id,
        expectedSyllableCount: variant.syllableCount,
        referenceIpa: variant.displayIpa,
        referencePrimaryStress: variant.primaryStress,
        referenceSyllables: variant.syllables,
        partOfSpeech: variant.partOfSpeech || null,
        audioSourceKind
    };
}

export function buildReferenceAudioReportRequest(word, variant) {
    if (variant?.referenceAnalysis?.graphSource?.kind !== 'modeled') return null;
    const reason = variant.referenceAnalysis?.sourceDiagnostics?.reason;
    if (!['MISSING_SOURCE_AUDIO', 'REFERENCE_STRESS_CONFLICT', 'UNRESOLVED_HARMONIC_RUN', 'REFERENCE_ANALYSIS_UNAVAILABLE'].includes(reason)) {
        return null;
    }
    return {
        word: String(word || '').trim().toLowerCase(),
        variantId: variant.id
    };
}

function variantStressSignature(variant) {
    return JSON.stringify([variant?.displayIpa, variant?.primaryStress, variant?.syllableCount]);
}

export function quarantineIncompatibleSharedAudio(sourceVariants) {
    const variants = (sourceVariants || []).map((variant) => structuredClone(variant));
    const groups = new Map();
    variants.forEach((variant, index) => {
        const identity = variant?.nativeAnalysis?.audioContentHash || variant?.audioUrl;
        if (!identity) return;
        if (!groups.has(identity)) groups.set(identity, []);
        groups.get(identity).push(index);
    });
    groups.forEach((indexes) => {
        if (new Set(indexes.map((index) => variantStressSignature(variants[index]))).size < 2) return;
        const compatible = indexes
            .filter((index) => variants[index]?.nativeAnalysis?.audioCompatibility?.status === 'compatible')
            .sort((left, right) => Number(variants[right].nativeAnalysis.audioCompatibility.confidence || 0) - Number(variants[left].nativeAnalysis.audioCompatibility.confidence || 0));
        const retainedIndex = compatible.length === 1 ? compatible[0] : null;
        indexes.forEach((index) => {
            if (index === retainedIndex) return;
            const variant = variants[index];
            if (!variant.nativeAnalysis) return;
            variant.nativeAnalysis.audioCompatibility = {
                ...variant.nativeAnalysis.audioCompatibility,
                status: 'conflict',
                reasons: ['SHARED_AUDIO_VARIANT_CONFLICT']
            };
            variant.nativeAnalysis.capabilities = { ...variant.nativeAnalysis.capabilities, showNativeGraphs: false };
            variant.capabilities = { ...variant.capabilities, showNativeGraphs: false };
            variant.analysisValidation = { status: 'unavailable', conflicts: ['SHARED_AUDIO_VARIANT_CONFLICT'] };
        });
    });
    return variants;
}

export async function attachValidatedNativeAnalyses(
    reference,
    analyzeVariant,
    { refreshOnly = false } = {}
) {
    const validated = validateReferenceV2(reference);
    const variants = await Promise.all(validated.variants.map(async (sourceVariant) => {
        const variant = structuredClone(sourceVariant);
        const canAnalyze = (
            variant.validation.status === 'valid' &&
            variant.audioUrl &&
            (variant.capabilities.showNativeGraphs || needsNativeAnalysisRefresh(variant)) &&
            (!refreshOnly || needsNativeAnalysisRefresh(variant))
        );
        if (!canAnalyze) {
            if (
                refreshOnly &&
                variant.validation.status === 'valid' &&
                variant.audioUrl &&
                !needsNativeAnalysisRefresh(variant)
            ) {
                return variant;
            }
            variant.nativeAnalysis = null;
            return variant;
        }
        const attemptAnalysis = async () => {
            const sourceAnalysis = await analyzeVariant(variant);
            const analysis = sourceAnalysis;
            if (
                analysis?.pitchProcessing?.version === PITCH_PROCESSING_VERSION &&
                analysis?.capabilities?.showNativeGraphs !== true
            ) {
                variant.nativeAnalysis = analysis;
                variant.capabilities.showNativeGraphs = false;
                variant.analysisValidation = {
                    status: 'unavailable',
                    conflicts: analysis.audioCompatibility?.reasons || analysis.pitchProcessing?.reasons || ['ACOUSTIC_VALIDATION_FAILED']
                };
                return;
            }
            variant.nativeAnalysis = validateNativeAnalysisForVariant(analysis, variant);
            variant.capabilities.showNativeGraphs = analysis.capabilities.showNativeGraphs;
        };
        try {
            await attemptAnalysis();
        } catch (firstError) {
            // Retry once after a delay for transient failures.
            // Do not retry non-transient 4xx validation errors.
            if (!isRetryableNativeAnalysisError(firstError)) {
                variant.nativeAnalysis = null;
                variant.capabilities.showNativeGraphs = false;
                variant.analysisValidation = {
                    status: 'unavailable',
                    conflicts: ['ACOUSTIC_VALIDATION_FAILED'],
                    message: firstError?.message || String(firstError)
                };
                return variant;
            }
            try {
                await new Promise((resolve) => setTimeout(resolve, NATIVE_ANALYSIS_RETRY_DELAY_MS));
                await attemptAnalysis();
            } catch (retryError) {
                // Both attempts failed — preserve dictionary data, mark retryable
                variant.nativeAnalysis = null;
                variant.capabilities.showNativeGraphs = false;
                variant.analysisValidation = {
                    status: 'retryable',
                    conflicts: ['ACOUSTIC_TEMPORARILY_UNAVAILABLE'],
                    message: retryError?.message || String(retryError)
                };
            }
        }
        return variant;
    }));
    return validateReferenceV2({
        ...validated,
        variants: quarantineIncompatibleSharedAudio(variants)
    });
}
