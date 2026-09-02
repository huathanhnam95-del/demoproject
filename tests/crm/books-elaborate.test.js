/* eslint-disable no-console */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '../..');

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

// ─── 1. Backend Service & Prompt Contract ───
const { buildElaboratePrompt, elaborateBookSnippets } = require(path.join(ROOT, 'functions/src/crm/book-summary-service.js'));
assert(typeof buildElaboratePrompt === 'function', 'buildElaboratePrompt must be exported');
assert(typeof elaborateBookSnippets === 'function', 'elaborateBookSnippets must be exported');

const testPrompt = buildElaboratePrompt('Thinking, Fast and Slow', 'Daniel Kahneman', [
    { text: 'System 1 operates automatically and quickly', sourceTab: 'summary', section: 'Overview' },
    { text: 'System 2 allocates attention to effortful mental operations', sourceTab: 'mindmap', section: 'Cognition' }
], [
    { text: 'System 1 and System 2 are two modes of thought...', pageStart: 20, pageEnd: 22 }
]);

assert(testPrompt.includes('Thinking, Fast and Slow'), 'Prompt must include book title');
assert(testPrompt.includes('Daniel Kahneman'), 'Prompt must include book author');
assert(testPrompt.includes('System 1 operates automatically and quickly'), 'Prompt must include highlighted snippets');
assert(testPrompt.includes('System 2 allocates attention to effortful mental operations'), 'Prompt must include all snippets');
assert(testPrompt.includes('[Pages 20-22]'), 'Prompt must include retrieved page ranges');
assert(testPrompt.includes('"synthesis"'), 'Prompt must require synthesis schema');
assert(testPrompt.includes('"elaborations"'), 'Prompt must require elaborations array');

// ─── 2. Frontend HTML & CSS Markup Checks ───
const html = read('public/crm-admin.html');
assert(html.includes('id="crm-books-elaborate-drawer"'), 'HTML must include #crm-books-elaborate-drawer');
assert(html.includes('id="crm-books-elaborate-tray"'), 'HTML must include #crm-books-elaborate-tray');
assert(html.includes('id="crm-mindmap-elaborate-btn"'), 'HTML must include #crm-mindmap-elaborate-btn in mindmap modal');
assert(html.includes('id="crm-books-elaborate-save-notes-btn"'), 'HTML must include Save to Notes button');
assert(html.includes('id="crm-books-elaborate-chat-btn"'), 'HTML must include Discuss in Chat button');
assert(html.includes('id="crm-books-elaborate-copy-btn"'), 'HTML must include Copy button');

const css = read('public/crm-admin.css');
assert(css.includes('.crm-books-elaborate-btn'), 'CSS must style .crm-books-elaborate-btn');
assert(css.includes('.crm-books-elaborate-mark'), 'CSS must style .crm-books-elaborate-mark');
assert(css.includes('.crm-books-elaborate-badge'), 'CSS must style .crm-books-elaborate-badge');
assert(css.includes('.crm-books-elaborate-tray'), 'CSS must style .crm-books-elaborate-tray');
assert(css.includes('.crm-books-elaborate-drawer'), 'CSS must style .crm-books-elaborate-drawer');
assert(css.includes('.crm-books-elaborate-drawer.open'), 'CSS must style .crm-books-elaborate-drawer.open transition');
assert(css.includes('.books-dark .crm-books-elaborate-drawer'), 'CSS must include dark mode styling for elaborate drawer');
assert(css.includes('pointer-events: none'), 'CSS must ensure badge has pointer-events: none to avoid text selection leakage');

// ─── 3. Behavioral Unit Tests in Sandbox VM ───
const jsSource = read('public/js/crm/books-workspace.js');

const nodeRegistry = new Map();
const mockElements = [];
const mockDocument = {
    createElement(tag) {
        const el = {
            tagName: tag.toUpperCase(),
            classList: {
                _classes: new Set(),
                add(c) { this._classes.add(c); },
                remove(c) { this._classes.delete(c); },
                contains(c) { return this._classes.has(c); }
            },
            dataset: {},
            children: [],
            childNodes: [],
            appendChild(child) {
                this.children.push(child);
                this.childNodes.push(child);
                child.parentNode = this;
                return child;
            },
            removeChild(child) {
                this.children = this.children.filter(c => c !== child);
                this.childNodes = this.childNodes.filter(c => c !== child);
                child.parentNode = null;
                return child;
            },
            insertBefore(newNode, refNode) {
                const idx = this.childNodes.indexOf(refNode);
                if (idx >= 0) this.childNodes.splice(idx, 0, newNode);
                else this.childNodes.push(newNode);
                newNode.parentNode = this;
                return newNode;
            },
            normalize() {},
            set textContent(value) { this._textContent = String(value); },
            get textContent() { return this._textContent || ''; },
            get firstChild() { return this.childNodes[0] || null; }
        };
        mockElements.push(el);
        return el;
    },
    querySelectorAll(selector) {
        const matchNodeId = selector.match(/\.crm-mindmap-node\[data-node-id="([^"]+)"\]/);
        if (matchNodeId) {
            const nodeId = matchNodeId[1];
            const found = nodeRegistry.get(nodeId);
            return found ? [found] : [];
        }
        return [];
    },
    querySelector() { return null; },
    addEventListener() {}
};

const sandboxContext = {
    window: {},
    document: mockDocument,
    localStorage: { getItem: () => null, setItem: () => undefined },
    console,
    Date,
    Math,
    setTimeout,
    clearTimeout,
    requestAnimationFrame: (cb) => cb()
};

vm.runInNewContext(jsSource, sandboxContext, { filename: 'books-workspace.js' });
const workspace = sandboxContext.window.CrmBooksWorkspace;
assert(workspace, 'CrmBooksWorkspace must be loaded on window');

// Test 3.1: formatElaborateParagraphs
const formattedRealNewlines = workspace.formatElaborateParagraphs('Paragraph 1\n\nParagraph 2\nLine 2b', (s) => s);
assert.strictEqual(formattedRealNewlines, 'Paragraph 1</p><p>Paragraph 2<br>Line 2b', 'Must correctly convert real newlines to <p> and <br>');

const formattedEscapedNewlines = workspace.formatElaborateParagraphs('Paragraph 1\\n\\nParagraph 2\\nLine 2b', (s) => s);
assert.strictEqual(formattedEscapedNewlines, 'Paragraph 1</p><p>Paragraph 2<br>Line 2b', 'Must correctly convert literal \\n\\n and \\n to <p> and <br>');

const formattedXss = workspace.formatElaborateParagraphs('<script>bad()</script>\n\nSafe text', (s) => s.replace(/</g, '&lt;').replace(/>/g, '&gt;'));
assert.strictEqual(formattedXss, '&lt;script&gt;bad()&lt;/script&gt;</p><p>Safe text', 'Must escape HTML tags while applying safe paragraph breaks');

// Test 3.2: generateElaborationMarkdown
const mockResult = {
    bookTitle: 'Atomic Habits',
    bookAuthor: 'James Clear',
    synthesis: 'Habits are the compound interest of self-improvement.',
    elaborations: [
        {
            concept: '1% Rule',
            pageRef: 'pp. 15-17',
            snippetText: '1% better every day',
            detailedExplanation: 'Small improvements accumulate exponentially.',
            sourceEvidence: '1.01^365 = 37.78',
            keyTakeaways: ['Focus on systems rather than goals', 'Small habits compound']
        }
    ]
};

const generatedMd = workspace.generateElaborationMarkdown(mockResult);
assert(generatedMd.includes('# Deep-Dive Elaboration: Atomic Habits'), 'Markdown must have main title');
assert(generatedMd.includes('*Author: James Clear*'), 'Markdown must have author');
assert(generatedMd.includes('## 🎯 Conceptual Synthesis'), 'Markdown must have synthesis section');
assert(generatedMd.includes('### #1 1% Rule (pp. 15-17)'), 'Markdown must format concept heading with page reference');
assert(generatedMd.includes('> "1% better every day"'), 'Markdown must include quoted snippet');
assert(generatedMd.includes('**📖 Source Grounding:**'), 'Markdown must include source grounding');
assert(generatedMd.includes('- Focus on systems rather than goals'), 'Markdown must format key takeaways');

// Test 3.3: Controller Elaborate State Machine & Capping
const mockPanel = mockDocument.createElement('div');
mockPanel.dataset = { panel: 'books' };

let toastMessage = '';
let toastType = '';
const controller = workspace.createController({
    elements: { booksPanel: mockPanel },
    showToast: (msg, type) => { toastMessage = msg; toastType = type; }
});

assert.strictEqual(controller.isElaborateModeActive(), false, 'Elaborate mode should initially be inactive');
assert.strictEqual(controller.getElaborateSnippets().length, 0, 'Elaborate snippets should initially be empty');

// Toggle active
controller.toggleElaborateMode(true);
assert.strictEqual(controller.isElaborateModeActive(), true, 'Elaborate mode should be active after toggle');

// Add snippet #1
const s1Id = controller.addElaborateSnippet('First highlighted insight about feedback loops', 'summary', 'Overview');
assert(s1Id, 'Should return snippet ID on success');
let currentSnippets = controller.getElaborateSnippets();
assert.strictEqual(currentSnippets.length, 1);
assert.strictEqual(currentSnippets[0].index, 1);
assert.strictEqual(currentSnippets[0].text, 'First highlighted insight about feedback loops');

// Add snippet #2
const s2Id = controller.addElaborateSnippet('Second highlighted insight about deliberate practice', 'notes', 'Key Notes');
currentSnippets = controller.getElaborateSnippets();
assert.strictEqual(currentSnippets.length, 2);
assert.strictEqual(currentSnippets[1].index, 2);

// Add snippet #3
const s3Id = controller.addElaborateSnippet('Third highlighted insight about environmental cues', 'chat', 'Chat');
currentSnippets = controller.getElaborateSnippets();
assert.strictEqual(currentSnippets.length, 3);
assert.strictEqual(currentSnippets[2].index, 3);

// Test removal and re-indexing (#1, #2, #3 -> remove #2 -> remaining are #1, #2)
controller.removeElaborateSnippet(s2Id);
currentSnippets = controller.getElaborateSnippets();
assert.strictEqual(currentSnippets.length, 2, 'Should have 2 snippets left after removal');
assert.strictEqual(currentSnippets[0].id, s1Id);
assert.strictEqual(currentSnippets[0].index, 1, 'First snippet retains index 1');
assert.strictEqual(currentSnippets[1].id, s3Id);
assert.strictEqual(currentSnippets[1].index, 2, 'Third snippet re-indexed to index 2');

// Test snippet length capping (600 chars)
const giantSnippetText = 'X'.repeat(800);
const sGiantId = controller.addElaborateSnippet(giantSnippetText, 'summary', 'Long Sec');
const giantSnippet = controller.getElaborateSnippets().find(s => s.id === sGiantId);
assert(giantSnippet, 'Giant snippet must be added');
assert.strictEqual(giantSnippet.text.length, 601, 'Giant snippet must be capped at 600 characters plus ellipsis');
assert(giantSnippet.text.endsWith('…'), 'Capped snippet must end with ellipsis');

// Test max snippet limit (12 items)
for (let i = 0; i < 15; i++) {
    controller.addElaborateSnippet(`Additional snippet #${i + 1}`, 'summary', 'Sec');
}
assert.strictEqual(controller.getElaborateSnippets().length, 12, 'Must not exceed 12 snippets');
assert(toastMessage.includes('Maximum of 12 highlights reached'), 'Must trigger warning toast when cap reached');

// Clear snippets
controller.toggleElaborateMode(false);
assert.strictEqual(controller.isElaborateModeActive(), false);
assert.strictEqual(controller.getElaborateSnippets().length, 0, 'Snippets should be cleared when elaborate mode is deactivated');

// Test 3.4: Mind Map Node Selection & Deselection Sync
controller.toggleElaborateMode(true);

const mockMmNode = mockDocument.createElement('div');
mockMmNode.dataset = { nodeId: 'node_42', title: 'Habit Loop', summary: 'Cue, Craving, Response, Reward' };
mockMmNode.classList.add('crm-mindmap-node');
nodeRegistry.set('node_42', mockMmNode);

// 1. Add mind map node snippet
const mmSnippetId = controller.addElaborateSnippet('Habit Loop: Cue, Craving, Response, Reward', 'mindmap', 'Habit Loop', null, 'node_42');
mockMmNode.classList.add('crm-mindmap-node-elaborate-selected');

assert(mmSnippetId, 'Mind map snippet should be created');
let mmSnippets = controller.getElaborateSnippets();
assert.strictEqual(mmSnippets.length, 1);
assert.strictEqual(mmSnippets[0].nodeId, 'node_42');
assert.strictEqual(mockMmNode.classList.contains('crm-mindmap-node-elaborate-selected'), true);

// 2. Remove snippet by snippet ID (e.g. user clicks tray chip remove button)
controller.removeElaborateSnippet(mmSnippetId);
assert.strictEqual(controller.getElaborateSnippets().length, 0, 'Snippet should be removed');
assert.strictEqual(mockMmNode.classList.contains('crm-mindmap-node-elaborate-selected'), false, 'Node highlight class must be cleared when chip is removed');

// 3. Re-add and remove by node ID (e.g. user clicks already selected node to deselect)
const mmSnippetId2 = controller.addElaborateSnippet('Habit Loop: Cue, Craving, Response, Reward', 'mindmap', 'Habit Loop', null, 'node_42');
mockMmNode.classList.add('crm-mindmap-node-elaborate-selected');
assert.strictEqual(controller.getElaborateSnippets().length, 1);

controller.removeElaborateSnippet('node_42');
assert.strictEqual(controller.getElaborateSnippets().length, 0, 'Snippet should be removed when removing by nodeId');
assert.strictEqual(mockMmNode.classList.contains('crm-mindmap-node-elaborate-selected'), false, 'Node highlight class must be cleared when removing by nodeId');

console.log('✓ All Books & Summary Elaborate Tool behavioral & Mind Map sync unit tests passed!');
