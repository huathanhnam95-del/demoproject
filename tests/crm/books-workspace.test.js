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

const formattedPage = workspace.formatPageText(
    'Chapter 1\nBasics of Teaching Pronunciation\n\nLearning Objectives\nTo describe what pronunciation features should be\ntaught\nTo explain why pronunciation should be taught.',
    (value) => String(value)
);
assert.match(formattedPage, /<h2>Chapter 1<\/h2>/, 'Page headings should render as semantic headings.');
assert.match(formattedPage, /<h3>Learning Objectives<\/h3>/, 'Section headings should remain visually distinct.');
assert.match(formattedPage, /<ul>[\s\S]*<li>To describe what pronunciation features should be taught<\/li>[\s\S]*<li>To explain why pronunciation should be taught\.<\/li>[\s\S]*<\/ul>/, 'Objective runs should retain bullet formatting.');

const formattedOutlinePage = workspace.formatPageText(
    'Outline\n1.1 Introduction 1.2 Elements of Pronunciation: The What of Pronunciation Teaching 1.3 Pronunciation Teaching Goals: The Why of Pronunciation Teaching 1.4 Successful Pronunciation Teaching: The How of Pronunciation Teaching 1.5 Representing sounds in English\n\n1.1 Introduction\nPronunciation has long been part of teaching in ESL/EFL contexts.',
    (value) => String(value)
);
assert.match(formattedOutlinePage, /<ul>[\s\S]*<li>[\s\S]*1\.1[\s\S]*<\/li>[\s\S]*<li>[\s\S]*1\.5[\s\S]*<\/li>[\s\S]*<\/ul>/, 'Inline hierarchical outline entries should render as separate list items with their numbering preserved.');

const formattedCitationProse = workspace.formatPageText(
    'Functional load is a measure used to distinguish words in a language 3. It helps teachers prioritize communication trouble 2, 3. Research indicates that high functional-load pairs have greater impact 4. For example, some contrasts distinguish many common words.',
    (value) => String(value)
);
assert.doesNotMatch(formattedCitationProse, /<ul>/, 'Citation-style numbers inside prose must not be mistaken for an inline numbered list.');
assert.match(formattedCitationProse, /<p>Functional load is a measure/, 'Inline citation detection must not discard prose before the first number.');

const formattedSectionProse = workspace.formatPageText(
    '1.1 Introduction Pronunciation teaching has long been part of language education 3. Research identifies several priorities 4. For example, teachers may focus on high-impact contrasts.',
    (value) => String(value)
);
assert.strictEqual((formattedSectionProse.match(/<li>/g) || []).length, 1, 'Citation numbers after a section marker must not become extra outline items.');
assert.match(formattedSectionProse, /education 3\. Research identifies several priorities 4\. For example/, 'Section prose must retain its inline citation numbers.');

assert.deepStrictEqual(
    workspace.getReadablePageNumbers(['', '  ', 'Title', 'Body']),
    [3, 4],
    'Readable page navigation should keep physical page numbers while excluding empty pages.'
);
assert.strictEqual(
    workspace.findAdjacentReadablePage(['', '', 'Title', 'Body'], 2, 1),
    3,
    'Next should skip empty physical pages.'
);
assert.strictEqual(
    workspace.findAdjacentReadablePage(['', '', 'Title', 'Body'], 3, -1),
    3,
    'Previous should not land on an empty page.'
);

const match = workspace.findCitationMatch('First sentence on the page.\n\nSecond cited sentence here.', 'Second   cited sentence here.');
assert.strictEqual(match.start, 29, 'Citation matching should return the source start offset.');
assert.strictEqual(match.end, 56, 'Citation matching should return the source end offset.');
assert.strictEqual(
    workspace.findCitationMatch('First sentence on the page.', 'A passage that is not present.'),
    null,
    'Citation matching should return null for a stale or malformed quote.'
);const formattedRunningHeader = workspace.formatPageText(
    '74chapter 4\n• are given words from exercises on separate pieces of paper. Can they reassemble them correctly?\n\nUsing coursebooks more effectively\nWhen we have taught a coursebook unit, we will want to reflect.\n\nChoosing coursebooks\nhow should we go about this?\n4.9.3\n4.9.4',
    (value) => String(value)
);
assert.match(formattedRunningHeader, /<header class="crm-books-page-header">[\s\S]*74[\s\S]*Chapter 4[\s\S]*<\/header>/, 'Glued running page number and chapter heading must render as a distinct page header.');
assert.match(formattedRunningHeader, /<h4>Using coursebooks more effectively<\/h4>/, 'Section headings should render as distinct headings.');
assert.match(formattedRunningHeader, /<h4>Choosing coursebooks<\/h4>/, 'Sub-headings should render as distinct headings.');
assert.match(formattedRunningHeader, /<div class="crm-books-section-marker"><span class="crm-books-section-badge">4\.9\.3<\/span><\/div>/, 'Trailing section numbers must render as badges rather than smushing into prose.');
assert.doesNotMatch(formattedRunningHeader, /how should we go about this\? 4\.9\.3 4\.9\.4/, 'Section numbers must not be concatenated onto preceding questions.');


const legacyCitationLocation = workspace.resolveCitationLocation([
    '',
    'Teachers need to understand\nthe content they are teaching.',
    'A second paragraph that is stored on the following page.'
], {
    marker: 'C8',
    pageStart: 2,
    pageEnd: 3,
    snippet: 'ers need to understand\nthe content they are teaching.\n\nA second paragraph that is stored on the following page.'
});
assert.strictEqual(legacyCitationLocation.page, 2, 'Legacy multi-page citations should resolve to the page containing an exact snippet fragment.');
assert.strictEqual(legacyCitationLocation.quote, 'ers need to understand the content they are teaching.', 'Legacy citations should return the exact fragment that can be highlighted.');
assert.strictEqual(legacyCitationLocation.matched, true, 'Legacy citation fragment resolution should report a visible match.');

assert.strictEqual(workspace.clampReaderFontScale(50), 80, 'Reader text scale should enforce the accessible minimum.');
assert.strictEqual(workspace.clampReaderFontScale(143), 140, 'Reader text scale should snap to ten-percent steps.');
assert.strictEqual(workspace.clampReaderFontScale(250), 180, 'Reader text scale should enforce the readable maximum.');

const citationHtml = workspace.renderCitations([
    { marker: 'C3', pageStart: 52, pageEnd: 53, snippet: 'A cited passage.' }
], (value) => String(value));
assert.match(citationHtml, /<button[^>]+data-citation-marker="C3"/i, 'Citations must render as accessible buttons keyed by marker.');
assert.match(citationHtml, /crm-books-citation-source/, 'Source citations must use a distinct button treatment.');
assert.match(citationHtml, /crm-books-citation-button-page/, 'Source citation buttons must show their page range directly.');
assert.match(citationHtml, /pp\. 52–53/, 'Citation buttons must show their page range directly.');

const ocrV2Text = workspace.formatPageText(
    'Specias and specialized terminology remain intact under OCR-v2 contract.',
    (value) => String(value),
    '',
    { rendererContract: 'ocr-v2' }
);
assert.match(ocrV2Text, /Specias and specialized terminology/, 'OCR-v2 contract must preserve genuine page text without segmenter word splitting.');

const normalized = workspace.normalizeBooks([
    { bookId: 'b1', title: 'Book One', collectionId: 'col-phonetics', tags: ['vowels', 'ipa'] },
    { bookId: 'b2', title: 'Book Two' }
]);
assert.strictEqual(normalized.length, 2);
assert.strictEqual(normalized[0].collectionId, 'col-phonetics');
assert.deepStrictEqual([...normalized[0].tags], ['vowels', 'ipa']);
assert.strictEqual(normalized[1].collectionId, '');
assert.strictEqual(normalized[1].tags.length, 0);

assert.strictEqual(workspace.normalizeTagName('  Phonetics  '), 'phonetics');

const testBooks = [
    { bookId: 'b1', title: 'Book 1', tags: ['phonetics', 'vowels'] },
    { bookId: 'b2', title: 'Book 2', tags: ['phonetics'] },
    { bookId: 'b3', title: 'Book 3', tags: ['grammar'] }
];
const andMatch = workspace.filterBooksByTags(testBooks, ['phonetics', 'vowels'], 'and');
assert.strictEqual(andMatch.length, 1);
assert.strictEqual(andMatch[0].bookId, 'b1');

const orMatch = workspace.filterBooksByTags(testBooks, ['vowels', 'grammar'], 'or');
assert.strictEqual(orMatch.length, 2);
assert.deepStrictEqual(orMatch.map(b => b.bookId), ['b1', 'b3']);

const collections = [
    { id: 'col-pron', name: 'Pronunciation', bookIds: [] },
    { id: 'col-other', name: 'Advanced Linguistics', bookIds: [] }
];
const booksToGroup = [
    { bookId: 'b1', collectionId: 'col-other' },
    { bookId: 'b2', collectionId: 'col-pron' },
    { bookId: 'b3', collectionId: '' } // Unfiled
];
const grouped = workspace.groupBooksByCollection(booksToGroup, collections);
assert.strictEqual(grouped['col-other'].length, 1);
assert.strictEqual(grouped['col-other'][0].bookId, 'b1');
assert.strictEqual(grouped['col-pron'].length, 2, 'Unfiled book must fall back to Pronunciation collection');
assert.strictEqual(grouped['col-pron'][0].bookId, 'b2');
assert.strictEqual(grouped['col-pron'][1].bookId, 'b3');

console.log('books workspace helper contracts passed');

