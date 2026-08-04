import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../../public/index.html', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../../public/pronunciation-analyzer/app.js', import.meta.url), 'utf8');
const config = fs.readFileSync(new URL('../../public/pronunciation-analyzer/config.js', import.meta.url), 'utf8');
const style = fs.readFileSync(new URL('../../public/pronunciation-analyzer/style.css', import.meta.url), 'utf8');

for (const id of [
    'pa-review-layout',
    'pa-version-review-rail',
    'pa-version-comparison',
    'pa-version-v2',
    'pa-version-v3',
    'pa-version-boundary-source',
    'pa-version-judgment',
    'pa-version-save',
    'pa-version-save-status'
]) {
    assert.match(html, new RegExp(`id="${id}"`), `missing ${id}`);
}
assert.match(
    html,
    /<div id="pa-review-layout"[\s\S]*<aside id="pa-version-review-rail"[\s\S]*<div class="pa-review-main">/,
    'comparison rail and main content must live inside the review layout'
);
assert.match(html, /name="pa-version-judgment"[^>]*value="v2"/);
assert.match(html, /name="pa-version-judgment"[^>]*value="v3"/);
assert.match(html, /name="pa-version-judgment"[^>]*value="tie"/);
assert.match(html, /name="pa-version-judgment"[^>]*value="neither"/);
assert.match(config, /showPronunciationVersionComparison:\s*true/);
assert.match(app, /analyzeComparison/);
assert.match(app, /buildComparisonViewModel/);
assert.match(app, /saveVersionComparison/);
assert.match(app, /setAutomaticSyllables/);
assert.match(style, /\.pa-version-comparison/);
assert.match(style, /\.pa-version-columns/);
assert.match(style, /\.pa-version-judgment/);
