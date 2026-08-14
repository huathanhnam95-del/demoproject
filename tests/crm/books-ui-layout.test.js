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
const noteBodyRule = css.match(/\.crm-books-note-body\s*\{([^}]*)\}/s);
assert(noteBodyRule, 'Books notes must define note text styling.');
assert(booksPanel.indexOf('crm-books-sources-header') < booksPanel.indexOf('crm-books-add-btn'), 'Add source must be placed directly below the Sources header.');
assert(js.includes('crm-books-sources-header-toggle'), 'The Sources panel must own the persistent collapse control.');
assert(js.includes('crm-books-download-btn'), 'Books must expose a source download control.');
assert(css.includes('grid-template-columns: 44px minmax(0, 1fr)'), 'Collapsed Sources must retain a visible rail for its controls.');
assert(js.lastIndexOf('`<div class="crm-books-composer">') < js.lastIndexOf('messagesHtml;'), 'The chat composer must render before the scrollable chat content.');
assert(js.includes('formatPageText('), 'Pages must render structured formatting instead of plain merged text.');
assert(js.includes('crm-books-page-stage'), 'Pages must render through a stable page stage for transitions.');
assert(js.includes('pageTurnInFlight'), 'Pages navigation must guard against overlapping page turns.');
assert(js.includes('crm-books-page-turn-status'), 'Pages must announce completed turns through an ARIA live region.');
assert(css.includes('@keyframes crmBooksPageTurnNext'), 'Books CSS must define the forward page-turn keyframes.');
assert(css.includes('@keyframes crmBooksPageTurnPrev'), 'Books CSS must define the backward page-turn keyframes.');
assert(css.includes('perspective:'), 'Books page stage must establish a 3D perspective.');
assert(css.includes('backface-visibility: hidden'), 'Books page sheets must hide their reverse face during a turn.');
assert(css.includes('@media (prefers-reduced-motion: reduce)'), 'Books CSS must defend against motion when reduced motion is requested.');

const pageTurnAnimations = [...css.matchAll(/animation:\s+crmBooksPage(?:TurnNext|TurnPrev|CurlNext|CurlPrev)\s+(\d+)ms\s+([^;]+);/g)];
assert.strictEqual(pageTurnAnimations.length, 4, 'Books page turns must define timing for both sheets and curl effects.');
assert(pageTurnAnimations.every(([, duration]) => Number(duration) >= 800), 'Books page turns must use a slower animation duration.');
assert(pageTurnAnimations.every(([, , easing]) => easing.trim() === 'cubic-bezier(0.4, 0, 0.2, 1) both'), 'Books page turns must use a smooth easing curve.');
assert(js.includes('const PAGE_TURN_DURATION_MS = 820;'), 'Page-turn fallback timing must match the slower visual animation.');
assert(js.includes('const PAGE_TURN_FALLBACK_MS = PAGE_TURN_DURATION_MS + 240;'), 'Page-turn fallback timing must allow the slower animation to finish.');

console.log('crm books UI layout contract passed');
