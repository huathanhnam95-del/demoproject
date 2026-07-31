import assert from 'node:assert/strict';
import fs from 'node:fs';

const appSource = fs.readFileSync(
    new URL('../../public/pronunciation-analyzer/app.js', import.meta.url),
    'utf8'
);
const htmlSource = fs.readFileSync(
    new URL('../../public/index.html', import.meta.url),
    'utf8'
);
const styleSource = fs.readFileSync(
    new URL('../../public/pronunciation-analyzer/style.css', import.meta.url),
    'utf8'
);
const referenceServiceSource = fs.readFileSync(
    new URL('../../public/pronunciation-analyzer/word-reference-service.js', import.meta.url),
    'utf8'
);

assert.match(htmlSource, /id="pa-reference-status"[^>]*aria-live="polite"/);
assert.match(htmlSource, /id="pa-charts-container"/);
assert.match(htmlSource, /id="pa-feedback-section"/);
assert.match(htmlSource, /id="pa-syllable-count"/);
assert.match(htmlSource, /id="pa-primary-stress"/);
assert.match(htmlSource, /id="pa-secondary-stress"/);
assert.match(htmlSource, /id="pa-syllable-strip"/);
assert.match(htmlSource, /id="pa-pattern-display"[^>]*class="pa-sr-only"/);

assert.ok(!appSource.includes('window.Phonetics'), 'legacy IPA fallback must not enter scoring paths');
assert.match(appSource, /selectReferenceVariant/);
assert.match(appSource, /getSelectableReferenceVariants/);
assert.match(appSource, /buildPronunciationSummary/);
assert.match(referenceServiceSource, /decorateLearnerIPA/);
assert.match(referenceServiceSource, /learnerDisplayIpa/);
assert.match(appSource, /Pronunciation reference under review\./);
assert.match(appSource, /CMU pronunciation fallback/);
assert.match(appSource, /capabilities\.scoreCountStress/);
assert.match(appSource, /capabilities\.showNativeGraphs/);
assert.match(appSource, /primaryStress/);
assert.match(appSource, /secondaryStress/);
assert.match(appSource, /nativeAnalysis\?\.observed\?\.syllables/);
assert.match(appSource, /setAttribute\('aria-pressed'/);
assert.ok(!appSource.includes('findUserStressedSyllable'), 'learner UI must not guess a stressed syllable');
assert.ok(!appSource.includes('Detected stress:'), 'learner UI must not display guessed stress locations');
assert.match(appSource, /Could not analyze this recording reliably\./);
assert.match(appSource, /Please make re-recording/);
assert.match(appSource, /This result may be inaccurate/);

const updateWordDataCatch = appSource.match(/} catch \(err\) \{[\s\S]*?\n        } finally \{/);
assert.ok(updateWordDataCatch, 'updateWordData must have an explicit error path');
assert.match(
    updateWordDataCatch[0],
    /loadingPlaceholder\)\s+this\.loadingPlaceholder\.style\.display = 'none'/,
    'failed reference lookups must clear the loading placeholder'
);
assert.match(
    updateWordDataCatch[0],
    /wordInfo\)\s+this\.wordInfo\.classList\.remove\('hidden'\)/,
    'failed reference lookups must reveal the word info error panel'
);
assert.match(
    updateWordDataCatch[0],
    /clearPronunciationSummary/,
    'failed reference lookups must clear every visual stress field from the previous word'
);

assert.match(styleSource, /\.pa-reference-status/);
assert.match(styleSource, /\.pa-reference-status--conflict/);
assert.match(styleSource, /\.pa-charts-grid\.hidden/);
assert.match(styleSource, /\.pa-pattern-facts/);
assert.match(styleSource, /\.pa-syllable--primary/);
assert.match(styleSource, /\.pa-syllable--secondary/);
assert.match(styleSource, /\.pa-sr-only/);

console.log('reference-ui-contract tests passed');
