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

assert.match(htmlSource, /id="pa-reference-status"[^>]*aria-live="polite"/);
assert.match(htmlSource, /id="pa-charts-container"/);
assert.match(htmlSource, /id="pa-feedback-section"/);

assert.ok(!appSource.includes('window.Phonetics'), 'legacy IPA fallback must not enter scoring paths');
assert.match(appSource, /selectReferenceVariant/);
assert.match(appSource, /Pronunciation reference under review\./);
assert.match(appSource, /CMU pronunciation fallback/);
assert.match(appSource, /single-syllable word/);
assert.match(appSource, /capabilities\.scoreCountStress/);
assert.match(appSource, /capabilities\.showNativeGraphs/);
assert.match(appSource, /primaryStress/);
assert.match(appSource, /secondaryStress/);
assert.match(appSource, /nativeAnalysis\?\.observed\?\.syllables/);

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

assert.match(styleSource, /\.pa-reference-status/);
assert.match(styleSource, /\.pa-reference-status--conflict/);
assert.match(styleSource, /\.pa-charts-grid\.hidden/);

console.log('reference-ui-contract tests passed');
