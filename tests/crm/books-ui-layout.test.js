const assert = require('assert');
const fs = require('fs');
const path = require('path');

function read(relativePath) {
    return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

const html = read('public/crm-admin.html');
const css = read('public/crm-admin.css');
const js = read('public/js/crm/books-workspace.js');

const booksPanelMatch = html.match(/<section\s+class="crm-panel"\s+data-panel="books"[^>]*>([\s\S]*?)<\/section>/);
assert(booksPanelMatch, 'CRM admin must render a Books panel.');

const booksPanel = booksPanelMatch[1];
assert(booksPanel.includes('crm-books-sources-panel'), 'Books must keep the sources panel.');
assert(booksPanel.includes('crm-books-explorer-panel'), 'Books must keep the explorer/chat panel.');
assert(!booksPanel.includes('crm-books-studio-panel'), 'Books must not render a Studio panel.');

assert(!/studio/i.test(css), 'Books CSS must not retain Studio-panel styles.');
assert(!/studio/i.test(js), 'Books controller must not retain Studio-panel state or event handlers.');

const workspaceRule = css.match(/\.crm-books-workspace\s*\{([^}]*)\}/s);
assert(workspaceRule, 'Books workspace must define a layout rule.');
assert(
    /grid-template-columns\s*:\s*260px\s+minmax\(0,\s*1fr\)\s*;/.test(workspaceRule[1]),
    'Books workspace must allocate all reclaimed width to the explorer/chat panel.'
);

assert(
    js.includes('class="crm-books-tab-body${activeTab === \'chat\' ? \' chat-active\' : \'\'}"'),
    'Chat tab content must use the full-height chat layout.'
);

const messageRule = css.match(/\.crm-books-msg\s*\{([^}]*)\}/s);
assert(messageRule, 'Books chat messages must define a responsive width.');
assert(
    /width\s*:\s*min\(100%\s*,\s*960px\)\s*;/.test(messageRule[1]) &&
    /max-width\s*:\s*100%\s*;/.test(messageRule[1]),
    'Books chat messages must widen with the reclaimed panel space while staying responsive.'
);

assert(
    js.includes('pagesData = res?.data || res;'),
    'loadPagesMetadata must unwrap res.data so pages and totalPages fields are accessible.'
);

assert(js.includes('data-books-tab="history"'), 'Books must expose a dedicated Chat History tab.');
assert(!js.includes('style="padding-left:${depth > 0 ? 20 : 0}px;"'), 'Outline rendering must not force the top-level list outside its surface.');
assert(js.includes('data-citation-marker'), 'Citation controls must preserve their source marker.');
assert(!js.includes('citationMap.get(marker) || (citations && citations[idx - 1])'), 'Inline citations must not fall back to array position when explicit markers are out of order.');
assert(!js.includes('crm-books-citation-detail'), 'The old compressed citation detail tooltip must be removed.');
assert(css.includes('.crm-books-citation-preview'), 'Citation previews must use the viewport-safe preview surface.');
assert(css.includes('.crm-books-page-paper'), 'Pages must render a readable page surface.');
assert(/\.crm-books-page-content\s*\{[\s\S]*white-space:\s*pre-wrap\s*;/.test(css), 'Reading view must preserve paragraph breaks from reflowed extracted text.');

console.log('crm books UI layout contract passed');
