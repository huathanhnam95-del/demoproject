import assert from 'node:assert/strict';
import {
    ALGORITHM_VERSION,
    SCHEMA_VERSION,
    attachValidatedNativeAnalyses,
    buildReferenceCacheKey,
    compressAnalysisV2,
    getSelectableReferenceVariants,
    selectReferenceVariant,
    validateNativeAnalysisForVariant,
    validateReferenceV2
} from '../../public/pronunciation-analyzer/reference-contract.js';

function validVariant(overrides = {}) {
    return {
        id: '0123456789abcdef',
        partOfSpeech: 'noun',
        definition: 'fixture',
        source: {
            provider: 'merriam-webster',
            entryId: 'car:1',
            exactMatch: true,
            transcription: 'merriam-webster-ipa',
            dialect: 'en-US',
            labels: []
        },
        rawIpa: 'ˈkɑɚ',
        displayIpa: '/kɑr/',
        syllableCount: 1,
        primaryStress: 0,
        secondaryStress: [],
        syllables: [
            { index: 0, ipa: 'kɑr', label: 'car', stress: 'primary', syllabicConsonant: false }
        ],
        audioUrl: 'https://media.merriam-webster.com/car.mp3',
        validation: {
            status: 'valid',
            conflicts: [],
            evidence: { phonologicalCount: 1, headwordCount: null, headwordCountExplicit: false }
        },
        capabilities: { playAudio: true, scoreCountStress: true, showNativeGraphs: true },
        ...overrides
    };
}

function validReference(overrides = {}) {
    const variant = validVariant();
    return {
        schemaVersion: 9,
        algorithmVersion: 'pronunciation-reference-v3',
        deploymentVersion: 'deadbeef',
        word: 'car',
        dialect: 'en-US',
        defaultVariantId: variant.id,
        variants: [variant],
        ...overrides
    };
}

assert.equal(SCHEMA_VERSION, 9);
assert.equal(ALGORITHM_VERSION, 'pronunciation-reference-v3');
assert.equal(
    buildReferenceCacheKey(' Car '),
    'pronunciation-reference-v3|9|en-US|car'
);

const reference = validateReferenceV2(validReference(), { expectedWord: 'car' });
assert.equal(reference.word, 'car');
assert.equal(selectReferenceVariant(reference).id, reference.defaultVariantId);

const cmuFallback = validVariant({
    source: {
        provider: 'cmu-pronouncing-dictionary',
        entryId: 'cmudict:car',
        exactMatch: true,
        transcription: 'cmu-arpabet-converted',
        dialect: 'en-US',
        labels: []
    },
    definition: null,
    audioUrl: null,
    capabilities: { playAudio: false, scoreCountStress: true, showNativeGraphs: false }
});
assert.equal(validateReferenceV2(validReference({
    defaultVariantId: cmuFallback.id,
    variants: [cmuFallback]
})).variants[0].source.provider, 'cmu-pronouncing-dictionary');
assert.throws(
    () => validateReferenceV2(validReference({
        variants: [validVariant({
            source: { provider: 'untrusted', entryId: 'x', exactMatch: true }
        })]
    })),
    /source provider/i
);
assert.throws(
    () => validateReferenceV2(validReference({
        variants: [validVariant({
            source: {
                provider: 'merriam-webster',
                entryId: 'car:1',
                exactMatch: true,
                dialect: 'en-US',
                labels: []
            }
        })]
    })),
    /transcription/i
);

assert.throws(
    () => validateReferenceV2(validReference({
        variants: [validVariant({
            source: {
                provider: 'merriam-webster',
                entryId: 'car:1',
                exactMatch: true,
                transcription: 'merriam-webster-ipa',
                dialect: 'en-GB',
                labels: ['British']
            }
        })]
    })),
    /source dialect/i
);
assert.throws(
    () => validateReferenceV2(validReference({
        variants: [validVariant({
            source: {
                provider: 'merriam-webster',
                entryId: 'car:1',
                exactMatch: true,
                transcription: 'merriam-webster-ipa',
                dialect: 'en-US',
                labels: ['Australian']
            }
        })]
    })),
    /non-US source label/i
);

assert.throws(
    () => validateReferenceV2(validReference({ schemaVersion: 8 })),
    /schema version/i
);
assert.throws(
    () => validateReferenceV2(validReference({ algorithmVersion: 'legacy' })),
    /algorithm version/i
);
assert.throws(
    () => validateReferenceV2(validReference(), { expectedWord: 'cart' }),
    /word mismatch/i
);

const mixedVariant = validVariant({
    syllableCount: 2,
    primaryStress: 1
});
assert.throws(
    () => validateReferenceV2(validReference({
        defaultVariantId: mixedVariant.id,
        variants: [mixedVariant]
    })),
    /syllable count/i
);

const conflicted = validVariant({
    validation: {
        status: 'conflict',
        conflicts: ['COUNT_CONFLICT'],
        evidence: { phonologicalCount: 1, headwordCount: 2, headwordCountExplicit: true }
    },
    capabilities: { playAudio: true, scoreCountStress: true, showNativeGraphs: false }
});
assert.throws(
    () => validateReferenceV2(validReference({
        defaultVariantId: null,
        variants: [conflicted]
    })),
    /fail closed/i
);

const variant = validVariant();
const nativeAnalysis = {
    analysisVersion: 'pronunciation-analysis-v2',
    variantId: variant.id,
    canonicalSyllableCount: 1,
    quality: { rateable: true, confidence: 0.91, reasons: [] },
    segmentation: {
        rawCandidateCount: 1,
        evidenceCandidateCount: 1,
        selectedCount: 1,
        method: 'acoustic-candidate-selection',
        confidence: 0.91,
        conflicts: []
    },
    observed: { syllableCount: 1, primaryStress: 0, syllables: [{}] },
    pitch: { times: [0], values: [150] },
    intensity: { times: [0], values: [70] },
    capabilities: { showNativeGraphs: true }
};
assert.equal(validateNativeAnalysisForVariant(nativeAnalysis, variant), nativeAnalysis);
const compressed = compressAnalysisV2({
    ...nativeAnalysis,
    pitch: {
        times: Array.from({ length: 240 }, (_, index) => index / 100),
        values: Array.from({ length: 240 }, (_, index) => 140 + index)
    },
    intensity: {
        times: Array.from({ length: 240 }, (_, index) => index / 100),
        values: Array.from({ length: 240 }, (_, index) => 60 + (index / 10))
    }
});
assert.equal(compressed.analysisVersion, nativeAnalysis.analysisVersion);
assert.equal(compressed.variantId, variant.id);
assert.equal(compressed.observed.syllableCount, 1);
assert.ok(compressed.pitch.values.length < 240);
assert.equal(compressed.pitch.values.length, compressed.pitch.times.length);
assert.throws(
    () => validateNativeAnalysisForVariant({ ...nativeAnalysis, variantId: 'ffffffffffffffff' }, variant),
    /variant mismatch/i
);
assert.throws(
    () => validateNativeAnalysisForVariant({
        ...nativeAnalysis,
        observed: { ...nativeAnalysis.observed, syllableCount: 2 }
    }, variant),
    /count mismatch/i
);

const contourOnlyAnalysis = {
    ...nativeAnalysis,
    canonicalSyllableCount: 2,
    quality: { rateable: false, confidence: 0, reasons: ['ACOUSTIC_COUNT_MISMATCH'] },
    segmentation: {
        rawCandidateCount: 1,
        evidenceCandidateCount: 1,
        selectedCount: 0,
        method: 'insufficient-acoustic-candidates',
        confidence: 0,
        conflicts: ['ACOUSTIC_COUNT_MISMATCH']
    },
    observed: { syllableCount: 0, primaryStress: null, syllables: [] },
    capabilities: { showNativeGraphs: true }
};
const contourVariant = validVariant({
    syllableCount: 2,
    primaryStress: 0,
    syllables: [
        { index: 0, ipa: 'foʊ', label: 'pho', stress: 'primary', syllabicConsonant: false },
        { index: 1, ipa: 'toʊ', label: 'to', stress: 'unstressed', syllabicConsonant: false }
    ]
});
assert.equal(
    validateNativeAnalysisForVariant(contourOnlyAnalysis, contourVariant),
    contourOnlyAnalysis
);
const contourReference = validReference({
    word: 'photo',
    defaultVariantId: contourVariant.id,
    variants: [contourVariant]
});
const referenceWithContours = await attachValidatedNativeAnalyses(
    contourReference,
    async () => ({
        ...contourOnlyAnalysis,
        capabilities: { showNativeGraphs: false }
    })
);
assert.deepEqual(
    referenceWithContours.variants[0].nativeAnalysis.pitch,
    contourOnlyAnalysis.pitch
);
assert.equal(referenceWithContours.variants[0].nativeAnalysis.capabilities.showNativeGraphs, true);
assert.equal(referenceWithContours.variants[0].capabilities.showNativeGraphs, true);

const secondVariant = validVariant({
    id: 'fedcba9876543210',
    partOfSpeech: 'verb',
    rawIpa: 'ɪmˈpɔɚt',
    displayIpa: '/ɪmˈpɔrt/',
    syllableCount: 2,
    primaryStress: 1,
    syllables: [
        { index: 0, ipa: 'ɪm', label: 'im', stress: 'unstressed', syllabicConsonant: false },
        { index: 1, ipa: 'pɔrt', label: 'port', stress: 'primary', syllabicConsonant: false }
    ]
});
const multi = validateReferenceV2(validReference({
    word: 'import',
    defaultVariantId: variant.id,
    variants: [variant, secondVariant]
}), { expectedWord: 'import' });
assert.equal(selectReferenceVariant(multi, secondVariant.id), secondVariant);
assert.throws(() => selectReferenceVariant(multi, 'missing'), /unknown variant/i);

const missingIpaVariant = validVariant({
    id: 'aaaaaaaaaaaaaaaa',
    partOfSpeech: 'verb',
    rawIpa: null,
    displayIpa: null,
    syllableCount: 0,
    primaryStress: null,
    secondaryStress: [],
    syllables: [],
    audioUrl: null,
    validation: {
        status: 'conflict',
        conflicts: ['MISSING_IPA'],
        evidence: { phonologicalCount: 0, headwordCount: null, headwordCountExplicit: false }
    },
    capabilities: { playAudio: false, scoreCountStress: false, showNativeGraphs: false }
});
const referenceWithEvidenceOnlyVariant = validateReferenceV2(validReference({
    variants: [variant, missingIpaVariant]
}));
assert.deepEqual(
    getSelectableReferenceVariants(referenceWithEvidenceOnlyVariant).map((item) => item.id),
    [variant.id]
);
assert.throws(
    () => selectReferenceVariant(referenceWithEvidenceOnlyVariant, missingIpaVariant.id),
    /not selectable/i
);

console.log('reference-contract tests passed');
