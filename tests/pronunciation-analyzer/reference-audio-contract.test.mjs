import assert from 'node:assert/strict';

import {
    ACOUSTIC_COMPATIBILITY_VERSION,
    PITCH_PROCESSING_VERSION,
    attachValidatedNativeAnalyses,
    buildReferenceAudioReportRequest,
    buildNativeAnalysisRequest,
    compressAnalysisV2,
    needsNativeAnalysisRefresh,
    quarantineIncompatibleSharedAudio,
    validateNativeAnalysisForVariant
} from '../../public/pronunciation-analyzer/reference-contract.js';
import {
    buildModeledReferenceAnalysis,
    applyGeneratedAudioResolution,
    resolveReferenceAnalysis,
    resolveReferenceVariants
} from '../../public/pronunciation-analyzer/reference-graph-model.js';
import { buildNativeOnlyChartData } from '../../public/pronunciation-analyzer/chart-data.js';

const variant = {
    id: '23212949e88a26e3',
    partOfSpeech: 'adjective',
    displayIpa: '/ˈpərfɪkt/',
    syllableCount: 2,
    primaryStress: 0,
    secondaryStress: [],
    syllables: [
        { index: 0, ipa: 'pər', stress: 'primary' },
        { index: 1, ipa: 'fɪkt', stress: 'none' }
    ],
    audioUrl: 'https://media.merriam-webster.com/audio/prons/en/us/mp3/p/perfec01.mp3',
    validation: { status: 'valid', conflicts: [] },
    capabilities: { playAudio: true, scoreCountStress: true, showNativeGraphs: true }
};

assert.equal(PITCH_PROCESSING_VERSION, 'canonical-pitch-v1');
assert.deepEqual(buildNativeAnalysisRequest(variant), {
    audioUrl: variant.audioUrl,
    variantId: variant.id,
    expectedSyllableCount: 2,
    referenceIpa: variant.displayIpa,
    referencePrimaryStress: 0,
    referenceSyllables: variant.syllables,
    partOfSpeech: 'adjective',
    audioSourceKind: 'dictionary'
});

const currentAnalysis = {
    analysisVersion: 'pronunciation-analysis-v2',
    variantId: variant.id,
    canonicalSyllableCount: 2,
    canonicalPrimaryStress: 0,
    pitchProcessing: { version: PITCH_PROCESSING_VERSION, status: 'corrected' },
    audioCompatibility: { version: ACOUSTIC_COMPATIBILITY_VERSION, status: 'compatible', confidence: 0.78, reasons: [] },
    graphSource: { kind: 'measured-dictionary', label: 'Measured dictionary reference', measured: true, version: PITCH_PROCESSING_VERSION },
    quality: { rateable: true, confidence: 0.9, reasons: [] },
    segmentation: { selectedCount: 2 },
    observed: { syllableCount: 2, primaryStress: null, syllables: [{}, {}] },
    pitch: { times: [0, 0.01, 0.02], values: [188, 190, 237.4], rawValues: [188, 190, 474.8] },
    intensity: { times: [0, 0.01, 0.02], values: [72, 73, 70] },
    capabilities: { showNativeGraphs: true }
};

assert.equal(validateNativeAnalysisForVariant(currentAnalysis, variant), currentAnalysis);
assert.equal(needsNativeAnalysisRefresh({ ...variant, nativeAnalysis: currentAnalysis }), false);
assert.equal(needsNativeAnalysisRefresh({
    ...variant,
    nativeAnalysis: { ...currentAnalysis, pitchProcessing: undefined }
}), true, 'pre-revision cached pitch must refresh');

assert.throws(() => validateNativeAnalysisForVariant({
    ...currentAnalysis,
    audioCompatibility: { version: ACOUSTIC_COMPATIBILITY_VERSION, status: 'conflict', confidence: 0.9, reasons: ['REFERENCE_STRESS_CONFLICT'] },
    capabilities: { showNativeGraphs: false }
}, variant), /native graphs are unavailable/i);

const compressed = compressAnalysisV2(currentAnalysis);
assert.deepEqual(compressed.pitch.rawValues, currentAnalysis.pitch.rawValues);
assert.equal(compressed.graphSource.kind, 'measured-dictionary');

const modeled = buildModeledReferenceAnalysis(variant, {
    reason: 'REFERENCE_STRESS_CONFLICT'
});
assert.equal(modeled.graphSource.kind, 'modeled');
assert.equal(modeled.graphSource.label, 'Expected stress pattern');
assert.equal(modeled.graphSource.measured, false);
assert.equal(modeled.canonicalPrimaryStress, 0);
assert.equal(modeled.capabilities.showNativeGraphs, false);
assert.equal(modeled.capabilities.showReferenceGraph, true);
assert.equal(modeled.sourceDiagnostics.reason, 'REFERENCE_STRESS_CONFLICT');

const conflicted = await attachValidatedNativeAnalyses({
    schemaVersion: 10,
    algorithmVersion: 'pronunciation-reference-v4',
    deploymentVersion: 'fixture',
    word: 'perfect',
    dialect: 'en-US',
    defaultVariantId: variant.id,
    formDefaults: { isolated: variant.id, connectedSpeech: variant.id },
    variants: [{
        ...variant,
        formRole: 'citation',
        usage: { isolated: 'preferred', connectedSpeech: 'accepted' },
        conditions: {},
        source: { provider: 'merriam-webster', entryId: 'perfect:1', exactMatch: true, transcription: 'merriam-webster-ipa', dialect: 'en-US', labels: [] },
        rawIpa: 'ˈpərfɪkt',
        definition: 'fixture'
    }]
}, async () => ({
    ...currentAnalysis,
    audioCompatibility: { status: 'conflict', confidence: 0.9, reasons: ['REFERENCE_STRESS_CONFLICT'] },
    capabilities: { showNativeGraphs: false }
}));
assert.equal(conflicted.variants[0].capabilities.showNativeGraphs, false);
assert.equal(conflicted.variants[0].analysisValidation.status, 'unavailable');
assert.equal(conflicted.variants[0].nativeAnalysis.audioCompatibility.status, 'conflict');

assert.equal(resolveReferenceAnalysis({ ...variant, nativeAnalysis: currentAnalysis }), currentAnalysis);
const conflictFallback = resolveReferenceAnalysis(conflicted.variants[0]);
assert.equal(conflictFallback.graphSource.kind, 'modeled');
assert.equal(conflictFallback.sourceDiagnostics.reason, 'REFERENCE_STRESS_CONFLICT');
const missingFallback = resolveReferenceAnalysis({ ...variant, audioUrl: null, nativeAnalysis: null });
assert.equal(missingFallback.graphSource.kind, 'modeled');
assert.equal(missingFallback.sourceDiagnostics.reason, 'MISSING_SOURCE_AUDIO');
const unavailableMeasuredReference = resolveReferenceAnalysis({ ...variant, nativeAnalysis: null });
assert.equal(unavailableMeasuredReference, null, 'a valid recording without an analysis must not render a synthetic measured graph');
const resolvedReference = resolveReferenceVariants({ word: 'perfect', variants: [conflicted.variants[0]] });
assert.equal(resolvedReference.variants[0].referenceAnalysis.graphSource.kind, 'modeled');
assert.equal(resolvedReference.variants[0].capabilities.showReferenceGraph, true);

const unresolvedInvalid = resolveReferenceVariants({
    variants: [{ ...variant, validation: { status: 'conflict' }, syllables: [], syllableCount: 0 }]
});
assert.equal(unresolvedInvalid.variants[0].referenceAnalysis, null);
assert.equal(unresolvedInvalid.variants[0].capabilities.showReferenceGraph, false);

const sharedHashVariants = quarantineIncompatibleSharedAudio([
    { ...variant, nativeAnalysis: { ...currentAnalysis, audioContentHash: 'a'.repeat(64), audioCompatibility: { ...currentAnalysis.audioCompatibility, confidence: 0.9 } } },
    { ...variant, id: '1111111111111111', partOfSpeech: 'verb', primaryStress: 1, nativeAnalysis: { ...currentAnalysis, variantId: '1111111111111111', audioContentHash: 'a'.repeat(64), audioCompatibility: { ...currentAnalysis.audioCompatibility, confidence: 0.8 } } }
]);
assert.equal(sharedHashVariants[0].nativeAnalysis.audioCompatibility.status, 'conflict');
assert.equal(sharedHashVariants[1].nativeAnalysis.audioCompatibility.status, 'conflict');
assert.equal(sharedHashVariants[0].capabilities.showNativeGraphs, false);
assert.deepEqual(buildReferenceAudioReportRequest(' Perfect ', resolvedReference.variants[0]), {
    word: 'perfect',
    variantId: variant.id
});
assert.equal(buildReferenceAudioReportRequest('perfect', { ...variant, referenceAnalysis: currentAnalysis }), null);
const generatedResolution = applyGeneratedAudioResolution(conflicted.variants[0], {
    available: true,
    generatedAudio: { url: '/api/pronunciation-reference-audio/key/audio', sourceKind: 'generated', sha256: 'b'.repeat(64) },
    referenceAnalysis: {
        ...currentAnalysis,
        graphSource: { kind: 'measured-generated', label: 'Measured generated reference', measured: true, version: PITCH_PROCESSING_VERSION }
    }
});
assert.equal(generatedResolution.audioUrl, '/api/pronunciation-reference-audio/key/audio');
assert.equal(generatedResolution.audioSourceKind, 'generated');
assert.equal(generatedResolution.capabilities.playAudio, true);
assert.equal(generatedResolution.referenceAnalysis.graphSource.kind, 'measured-generated');
const modeledChart = buildNativeOnlyChartData(modeled);
assert.equal(modeledChart.pitchAxisLabel, 'Relative pitch (semitones)');
assert.ok(modeledChart.pitch.some((point) => point.y < 0), 'modeled unstressed pitch must remain visible');

process.stdout.write('reference-audio-contract tests passed\n');
