import assert from 'node:assert/strict';
import { buildPronunciationSummary } from '../../public/pronunciation-analyzer/pronunciation-summary.js';

const photograph = {
    displayIpa: '/ˈfoʊtəˌɡræf/',
    syllableCount: 3,
    primaryStress: 0,
    secondaryStress: [2],
    syllables: [
        { index: 0, ipa: 'foʊ', label: 'pho', stress: 'primary' },
        { index: 1, ipa: 'tə', label: 'to', stress: 'unstressed' },
        { index: 2, ipa: 'ɡræf', label: 'graph', stress: 'secondary' }
    ]
};

const photographSummary = buildPronunciationSummary(photograph);
assert.equal(photographSummary.ipa, '/ˈfoʊtəˌɡræf/');
assert.equal(photographSummary.countLabel, '3 syllables');
assert.equal(photographSummary.primaryLabel, 'PHO');
assert.deepEqual(photographSummary.secondaryLabels, ['GRAPH']);
assert.deepEqual(
    photographSummary.syllables.map(({ label, stress }) => ({ label, stress })),
    [
        { label: 'PHO', stress: 'primary' },
        { label: 'to', stress: 'unstressed' },
        { label: 'GRAPH', stress: 'secondary' }
    ]
);
assert.equal(
    photographSummary.accessibleText,
    '3 syllables. Primary stress on PHO, syllable 1. Secondary stress on GRAPH, syllable 3.'
);

const sharedLayerSummary = buildPronunciationSummary({
    ...photograph,
    displayIpa: '/ˈmerriam-webster-form/',
    learnerDisplayIpa: '/ˈoʊksfərd-form/'
});
assert.equal(sharedLayerSummary.ipa, '/ˈoʊksfərd-form/');

const carSummary = buildPronunciationSummary({
    displayIpa: '/kɑr/',
    syllableCount: 1,
    primaryStress: 0,
    secondaryStress: [],
    syllables: [
        { index: 0, ipa: 'kɑr', label: 'car', stress: 'primary' }
    ]
});
assert.equal(carSummary.countLabel, '1 syllable');
assert.equal(carSummary.primaryLabel, null);
assert.equal(carSummary.syllables[0].label, 'CAR');
assert.equal(carSummary.syllables[0].stress, 'single');
assert.equal(carSummary.accessibleText, '1 syllable. Single-syllable word.');

const ipaFallbackSummary = buildPronunciationSummary({
    displayIpa: '/ˈɪntə/',
    syllableCount: 3,
    primaryStress: 0,
    secondaryStress: [],
    syllables: [
        { index: 0, ipa: 'ɪn', label: null, stress: 'primary' },
        { index: 1, ipa: 'tə', label: null, stress: 'unstressed' },
        { index: 2, ipa: 'ə', label: null, stress: 'unstressed' }
    ]
});
assert.deepEqual(
    ipaFallbackSummary.syllables.map((syllable) => syllable.label),
    ['ɪn', 'tə', 'ə']
);

assert.throws(
    () => buildPronunciationSummary({
        ...photograph,
        primaryStress: 4
    }),
    /primary stress index/i
);
assert.throws(
    () => buildPronunciationSummary({
        ...photograph,
        secondaryStress: [3]
    }),
    /secondary stress index/i
);

console.log('pronunciation-summary tests passed');
