/* eslint-disable no-console */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(ROOT, 'public/js/crm/books-workspace.js'), 'utf8');
const context = {
    window: {},
    document: {
        createElement() {
            return {
                set textContent(value) { this._textContent = String(value); },
                get innerHTML() { return this._textContent || ''; }
            };
        }
    },
    localStorage: { getItem: () => null, setItem: () => undefined },
    console,
    Date,
    Math,
    setTimeout,
    clearTimeout,
    requestAnimationFrame: (callback) => callback()
};
vm.runInNewContext(source, context, { filename: 'books-workspace.js' });
const workspace = context.window.CrmBooksWorkspace;

assert.strictEqual(
    workspace.deriveThreadTitle('  Explain the communicative framework in this book.  '),
    'Explain the communicative framework in this book.',
    'Thread titles should be trimmed and normalized.'
);

const longQuestion = 'A'.repeat(100);
assert.strictEqual(workspace.deriveThreadTitle(longQuestion).length, 72, 'Automatic titles must be capped at 72 characters.');
assert.ok(workspace.deriveThreadTitle(longQuestion).endsWith('…'), 'Truncated automatic titles must use an ellipsis.');

assert.strictEqual(
    workspace.reflowPageText('Heading\n\nThis is a wrapped\nparagraph with a split hy-\nphenated word.'),
    'Heading\n\nThis is a wrapped paragraph with a split hyphenated word.',
    'Page text should reflow wrapped lines while preserving paragraph boundaries.'
);

const match = workspace.findCitationMatch('First sentence on the page.\n\nSecond cited sentence here.', 'Second   cited sentence here.');
assert.strictEqual(match.start, 29, 'Citation matching should return the source start offset.');
assert.strictEqual(match.end, 56, 'Citation matching should return the source end offset.');
assert.strictEqual(
    workspace.findCitationMatch('First sentence on the page.', 'A passage that is not present.'),
    null,
    'Citation matching should return null for a stale or malformed quote.'
);

const citationHtml = workspace.renderCitations([
    { marker: 'C3', pageStart: 52, pageEnd: 53, snippet: 'A cited passage.' }
], (value) => String(value));
assert.match(citationHtml, /<button[^>]+data-citation-marker="C3"/i, 'Citations must render as accessible buttons keyed by marker.');
assert.match(citationHtml, /crm-books-citation-source/, 'Source citations must use a distinct button treatment.');
assert.match(citationHtml, /crm-books-citation-button-page/, 'Source citation buttons must show their page range directly.');
assert.match(citationHtml, /pp\. 52–53/, 'Citation buttons must show their page range directly.');

console.log('books workspace helper contracts passed');
