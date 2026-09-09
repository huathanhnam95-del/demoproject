/* eslint-disable no-console */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = process.cwd();

const BOOK = {
    bookId: 'book-1',
    title: 'Functional Load in Pronunciation',
    author: 'John M. Levis',
    pageCount: 150,
    status: 'ready',
    ingest: null
};

const SAMPLE_NOTES = [
    {
        id: 'note_1',
        text: 'Functional load measures the contrastive work done by two phonemes. High FL sound pairs (e.g. /p/ vs /b/) significantly impact listener comprehensibility.',
        savedAt: Date.now() - 3600000
    },
    {
        id: 'note_2',
        text: 'Teachers should prioritize high functional load vowel and consonant errors over low functional load contrasts in classroom instruction.',
        savedAt: Date.now() - 7200000
    },
    {
        id: 'fs_shared',
        text: 'A Firestore-backed note can be resolved through its fs_ compatibility ID.',
        savedAt: Date.now() - 10800000
    }
];

const MOCK_MIND_MAP = {
    bookId: 'book-1',
    citationSchemaVersion: 1,
    centralTopic: 'Mind Map: Functional Load in Pronunciation',
    summary: 'Synthesis of high functional load sound contrasts and classroom teaching priorities.',
    noteCount: 2,
    categories: [
        {
            id: 'cat_1',
            title: 'Theoretical Framework',
            color: '#4f46e5',
            summary: 'Core definitions and contrast measures.',
            subtopics: [
                {
                    id: 'sub_1_1',
                    title: 'Functional Load Definition',
                    summary: 'Measure of contrastive work between phoneme pairs.',
                    noteIds: ['note_1'],
                    evidenceStatus: 'verified',
                    citations: [{
                        noteId: 'note_1',
                        quote: 'Functional load measures the contrastive work done by two phonemes.'
                    }],
                    fullText: SAMPLE_NOTES[0].text
                }
            ]
        },
        {
            id: 'cat_2',
            title: 'Pedagogical Applications',
            color: '#059669',
            summary: 'Classroom instruction priorities.',
            subtopics: [
                {
                    id: 'sub_2_1',
                    title: 'Teaching Priorities',
                    summary: 'Prioritize high FL sound errors over low FL contrasts.',
                    noteIds: ['note_2'],
                    evidenceStatus: 'verified',
                    citations: [{
                        noteId: 'note_2',
                        quote: 'Teachers should prioritize high functional load vowel and consonant errors over low functional load contrasts in classroom instruction.'
                    }],
                    fullText: SAMPLE_NOTES[1].text
                },
                {
                    id: 'sub_2_2',
                    title: 'Shared Teaching Evidence',
                    summary: 'The same source passage may support a related thought.',
                    noteIds: ['note_2'],
                    evidenceStatus: 'verified',
                    citations: [{
                        noteId: 'note_2',
                        quote: 'Teachers should prioritize high functional load vowel and consonant errors over low functional load contrasts in classroom instruction.'
                    }],
                    fullText: SAMPLE_NOTES[1].text
                },
                {
                    id: 'sub_2_3',
                    title: 'Unverified Thought',
                    summary: 'No source passage was found for this thought.',
                    noteIds: ['note_2'],
                    evidenceStatus: 'insufficient',
                    citations: [],
                    fullText: 'Generated explanation without a verified passage.'
                },
                {
                    id: 'sub_2_4',
                    title: 'Firestore Compatibility',
                    summary: 'A source may be stored with an fs_ local ID.',
                    noteIds: ['shared'],
                    evidenceStatus: 'verified',
                    citations: [{
                        noteId: 'shared',
                        quote: 'A Firestore-backed note can be resolved through its fs_ compatibility ID.'
                    }],
                    fullText: SAMPLE_NOTES[2].text
                }
            ]
        }
    ]
};

const LEGACY_MIND_MAP = JSON.parse(JSON.stringify(MOCK_MIND_MAP));
delete LEGACY_MIND_MAP.citationSchemaVersion;
LEGACY_MIND_MAP.categories.forEach(category => {
    category.subtopics.forEach(subtopic => {
        delete subtopic.evidenceStatus;
        delete subtopic.citations;
    });
});

function installMemoryLocalStorage() {
    const data = new Map();
    Object.defineProperty(window, 'localStorage', {
        configurable: true,
        value: {
            getItem: (key) => data.has(key) ? data.get(key) : null,
            setItem: (key, value) => data.set(key, String(value)),
            removeItem: (key) => data.delete(key)
        }
    });
}

async function main() {
    const browser = await chromium.launch({ headless: true, channel: 'chrome' });
    const pageErrors = [];
    const consoleErrors = [];

    try {
        const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
        page.on('pageerror', (error) => pageErrors.push(error.message));
        page.on('console', (message) => {
            if (message.type() === 'error') consoleErrors.push(message.text());
        });

        await page.addInitScript(installMemoryLocalStorage);
        await page.setContent(`
          <section class="crm-panel" data-panel="books" style="display:block; width:100%; height:100vh;">
            <div class="crm-books-workspace">
              <div class="crm-books-sources-panel">
                <div class="crm-books-sources-header"><h3>Sources</h3></div>
                <ul class="crm-books-list"></ul>
              </div>
              <div class="crm-books-explorer-panel">
                <div class="crm-books-detail"></div>
              </div>
            </div>
          </section>

          <!-- Fullscreen CRM Books Mind Map Modal -->
          <div id="crm-books-mindmap-modal" class="crm-books-mindmap-modal" style="display: none;" role="dialog" aria-modal="true" aria-labelledby="crm-mindmap-title">
            <div class="crm-mindmap-header">
              <div class="crm-mindmap-header-left">
                <h2 id="crm-mindmap-title" class="crm-mindmap-title">🧠 Mind Map</h2>
                <span id="crm-mindmap-subtitle" class="crm-mindmap-subtitle">Synthesis of saved notes</span>
              </div>
              <div class="crm-mindmap-header-actions">
                <button id="crm-mindmap-regenerate-btn" class="crm-btn crm-btn-secondary crm-btn-sm" title="Regenerate Mind Map with AI">⚡ Regenerate</button>
                <button id="crm-mindmap-zoom-in" class="crm-btn crm-btn-secondary crm-btn-sm" title="Zoom In">+</button>
                <button id="crm-mindmap-zoom-out" class="crm-btn crm-btn-secondary crm-btn-sm" title="Zoom Out">-</button>
                <button id="crm-mindmap-zoom-reset" class="crm-btn crm-btn-secondary crm-btn-sm" title="Fit to View">Fit View</button>
                <div id="crm-mindmap-map-selector">
                  <button id="crm-mindmap-map-btn" type="button"><span id="crm-mindmap-map-name">Default Map</span></button>
                  <div id="crm-mindmap-map-dropdown" style="display:none;"></div>
                </div>
                <button id="crm-mindmap-close-btn" class="crm-btn crm-btn-close" aria-label="Close Mind Map">&times;</button>
              </div>
            </div>
            <div class="crm-mindmap-body">
              <div id="crm-mindmap-viewport" class="crm-mindmap-viewport">
                <svg id="crm-mindmap-svg" class="crm-mindmap-svg"></svg>
                <div id="crm-mindmap-canvas" class="crm-mindmap-canvas"></div>
              </div>
              <!-- Slide-over Inspector Drawer for Node Full Note -->
              <aside id="crm-mindmap-inspector" class="crm-mindmap-inspector" style="display: none;">
                <div class="crm-mindmap-inspector-header">
                  <span id="crm-mindmap-inspector-tag" class="crm-mindmap-inspector-tag">Category</span>
                  <button id="crm-mindmap-inspector-close" class="crm-btn-close" aria-label="Close Inspector">&times;</button>
                </div>
                <h3 id="crm-mindmap-inspector-title" class="crm-mindmap-inspector-title">Node Title</h3>
                <p id="crm-mindmap-inspector-summary" class="crm-mindmap-inspector-summary">Summary</p>
                <hr class="crm-mindmap-divider" />
                <div class="crm-mindmap-inspector-section">
                  <h4>Full Saved Note</h4>
                  <div id="crm-mindmap-inspector-fulltext" class="crm-mindmap-inspector-fulltext"></div>
                </div>
                <div class="crm-mindmap-inspector-section">
                  <h4>Source Reference</h4>
                  <div id="crm-mindmap-inspector-sources" class="crm-mindmap-inspector-sources"></div>
                </div>
              </aside>
            </div>
          </div>
        `);

        // Keep the browser fixture's Books panel, API mocks, and assertions
        // while loading the authoritative production mind-map markup.
        const crmAdminHtml = fs.readFileSync(path.join(ROOT, 'public', 'crm-admin.html'), 'utf8');
        const modalStart = crmAdminHtml.indexOf('<div id="crm-books-mindmap-modal"');
        const modalEnd = crmAdminHtml.indexOf('<!-- CRM Books Elaborate', modalStart);
        assert.ok(modalStart >= 0 && modalEnd > modalStart, 'Authoritative mind-map modal markup should be present.');
        await page.evaluate((markup) => {
            document.querySelector('#crm-books-mindmap-modal')?.remove();
            document.body.insertAdjacentHTML('beforeend', markup);
        }, crmAdminHtml.slice(modalStart, modalEnd));

        await page.evaluate(installMemoryLocalStorage);
        await page.addStyleTag({ path: path.join(ROOT, 'public', 'crm-admin.css') });
        await page.addScriptTag({ path: path.join(ROOT, 'public', 'js', 'crm', 'books-workspace.js') });

        // Seed notes and API mock
        await page.evaluate(async ({ book, notes, mockMap, legacyMap }) => {
            window.localStorage.setItem(`crm_books_notes_${book.bookId}`, JSON.stringify(notes));
            window.localStorage.setItem(`crm_books_maps_${book.bookId}`, JSON.stringify({
                default: { name: 'Default Map' },
                map_custom: { name: 'Legacy Custom', noteIds: ['note_2'] }
                ,map_fail: { name: 'Failed Legacy', noteIds: ['note_1'] }
            }));
            window.localStorage.setItem(`crm_books_mapstate_${book.bookId}_map_custom`, JSON.stringify({
                data: legacyMap,
                positions: { sub_2_1: { x: 44, y: 55 } },
                userNodes: [{ id: 'user_custom', title: 'Keep this node', text: 'Keep this note', x: 90, y: 110 }],
                userEdits: { sub_2_1: { title: 'Keep edited title', notes: 'Keep this annotation' } },
                customConnections: [{ id: 'conn_custom', from: 'sub_2_1', to: 'user_custom' }]
            }));
            window.localStorage.setItem(`crm_books_mapstate_${book.bookId}_map_fail`, JSON.stringify({
                data: legacyMap,
                positions: { sub_1_1: { x: 12, y: 13 } },
                userNodes: [],
                userEdits: {},
                customConnections: []
            }));
            const mindMapPostCalls = [];
            const mindMapPatchCalls = [];
            window.__mindMapPostCalls = mindMapPostCalls;
            window.__mindMapPatchCalls = mindMapPatchCalls;

            const request = async (requestPath, options = {}) => {
                const method = options.method || 'GET';
                if (requestPath === '/api/admin/books') return { books: [book] };
                if (requestPath === `/api/admin/books/${book.bookId}`) return { book, summary: null };
                if (requestPath === '/api/admin/books/usage') {
                    return { estimatedCostUsd: 0.5, budgetLimitUsd: 10.0, approved: false };
                }
                if (requestPath === `/api/admin/books/${book.bookId}/notes`) {
                    return { notes };
                }
                if (requestPath === `/api/admin/books/${book.bookId}/mind-map` && method === 'POST') {
                    const body = options.body ? JSON.parse(options.body) : {};
                    mindMapPostCalls.push(body);
                    if (body.force && Array.isArray(body.noteIds) && body.noteIds.includes('note_1')) {
                        throw new Error('simulated citation upgrade outage');
                    }
                    return { mindMap: mindMapPostCalls.length === 1 ? legacyMap : mockMap };
                }
                if (requestPath === `/api/admin/books/${book.bookId}/mind-map` && method === 'PATCH') {
                    mindMapPatchCalls.push(options.body ? JSON.parse(options.body) : {});
                    return { ok: true };
                }
                return { ok: true };
            };

            const panel = document.querySelector('[data-panel="books"]');
            window.__crmBooksController = window.CrmBooksWorkspace.createController({
                elements: { booksPanel: panel },
                apiFetchJson: request,
                showToast: () => {}
            });
            await window.__crmBooksController.init();
            await window.__crmBooksController.selectBook(book.bookId);
        }, { book: BOOK, notes: SAMPLE_NOTES, mockMap: MOCK_MIND_MAP, legacyMap: LEGACY_MIND_MAP });

        // Click book item in sources list to ensure active state
        await page.waitForSelector('.crm-books-list-item');
        await page.click('.crm-books-list-item');

        // Switch tab to notes
        await page.waitForSelector('[data-books-tab="notes"]');
        await page.click('[data-books-tab="notes"]');

        const btnText = await page.textContent('.crm-books-create-mindmap-btn');
        assert.ok(btnText.includes('Create Mind Map'), 'Mind map button should be present in Notes header');

        // Click "Create Mind Map"
        await page.click('.crm-books-create-mindmap-btn');

        // Verify Fullscreen Modal opens
        await page.waitForSelector('#crm-books-mindmap-modal[style*="display: flex"]', { timeout: 10000 });
        const modalTitle = await page.textContent('#crm-mindmap-title');
        assert.ok(modalTitle.includes('Functional Load'), 'Mind Map modal title should show central topic');
        const mindMapPostCalls = await page.evaluate(() => window.__mindMapPostCalls);
        assert.strictEqual(mindMapPostCalls.length, 2, 'A legacy map should trigger one automatic citation upgrade request.');
        assert.strictEqual(mindMapPostCalls[1].force, true, 'The legacy citation upgrade must use the existing force regeneration request.');
        await page.waitForTimeout(100);
        const defaultPatchCount = await page.evaluate(() => window.__mindMapPatchCalls.length);

        // Switch to a legacy custom map and verify selected notes plus local edits survive its one-time upgrade.
        await page.click('#crm-mindmap-map-btn');
        await page.locator('.crm-mindmap-map-option', { hasText: 'Legacy Custom' }).click();
        await page.waitForTimeout(150);
        const customPostCalls = await page.evaluate(() => window.__mindMapPostCalls);
        assert.strictEqual(customPostCalls.length, 3, 'A legacy custom map should trigger one upgrade request.');
        assert.deepStrictEqual(customPostCalls[2].noteIds, ['note_2'], 'Custom upgrades must retain the map-selected note IDs.');
        const customState = await page.evaluate(({ bookId }) => JSON.parse(window.localStorage.getItem(`crm_books_mapstate_${bookId}_map_custom`)), { bookId: BOOK.bookId });
        assert.strictEqual(customState.data.citationSchemaVersion, 1, 'Custom map upgrade should persist citation schema version locally.');
        assert.deepStrictEqual(customState.positions.sub_2_1, { x: 44, y: 55 }, 'Custom map node positions should survive upgrade.');
        assert.strictEqual(customState.userNodes[0].title, 'Keep this node', 'Custom user nodes should survive upgrade.');
        assert.strictEqual(customState.userEdits.sub_2_1.title, 'Keep edited title', 'Custom annotations should survive upgrade.');
        assert.strictEqual(customState.customConnections[0].id, 'conn_custom', 'Custom connections should survive upgrade.');
        const customPatchCount = await page.evaluate(() => window.__mindMapPatchCalls.length);
        assert.strictEqual(customPatchCount, defaultPatchCount, 'Custom-map upgrades must not patch the default Firestore artifact.');

        await page.click('#crm-mindmap-map-btn');
        await page.locator('.crm-mindmap-map-option', { hasText: 'Default Map' }).click();
        await page.click('#crm-mindmap-map-btn');
        await page.locator('.crm-mindmap-map-option', { hasText: 'Legacy Custom' }).click();
        await page.waitForTimeout(100);
        const reopenPostCalls = await page.evaluate(() => window.__mindMapPostCalls.length);
        assert.strictEqual(reopenPostCalls, 3, 'Reopening an upgraded custom map must not trigger another AI request.');

        // A failed custom upgrade retains the legacy map and does not loop on reopen in this session.
        await page.click('#crm-mindmap-map-btn');
        await page.locator('.crm-mindmap-map-option', { hasText: 'Failed Legacy' }).click();
        await page.waitForTimeout(150);
        const failedUpgradeCalls = await page.evaluate(() => window.__mindMapPostCalls.length);
        assert.strictEqual(failedUpgradeCalls, 4, 'A failed legacy upgrade should make one bounded request.');
        const failedState = await page.evaluate(({ bookId }) => JSON.parse(window.localStorage.getItem(`crm_books_mapstate_${bookId}_map_fail`)), { bookId: BOOK.bookId });
        assert.ok(!failedState.data.citationSchemaVersion, 'Failed upgrade must retain the legacy visual structure.');
        await page.click('#crm-mindmap-map-btn');
        await page.locator('.crm-mindmap-map-option', { hasText: 'Default Map' }).click();
        await page.click('#crm-mindmap-map-btn');
        await page.locator('.crm-mindmap-map-option', { hasText: 'Failed Legacy' }).click();
        await page.waitForTimeout(100);
        assert.strictEqual(await page.evaluate(() => window.__mindMapPostCalls.length), 4, 'Failed upgrades must not loop when reopened in the same session.');
        await page.click('#crm-mindmap-map-btn');
        await page.locator('.crm-mindmap-map-option', { hasText: 'Default Map' }).click();
        await page.waitForTimeout(100);

        // Verify Mind Map Nodes rendered
        await page.waitForSelector('.crm-mindmap-node.central');
        await page.waitForSelector('.crm-mindmap-node.category');
        await page.waitForSelector('.crm-mindmap-node.subtopic');

        await page.waitForSelector('.crm-mindmap-node.subtopic');

        const catNodes = await page.$$('.crm-mindmap-node.category');
        assert.strictEqual(catNodes.length, 2, 'Should render 2 category nodes');

        // Click a subtopic node to open full note inspector drawer
        await page.click('.crm-mindmap-node.subtopic[data-sub-id="sub_1_1"]');
        await page.waitForSelector('#crm-mindmap-inspector[style*="display: flex"]');

        const inspectorTitle = await page.textContent('#crm-mindmap-inspector-title');
        const inspectorFullText = await page.textContent('#crm-mindmap-inspector-fulltext');

        assert.strictEqual(inspectorTitle, 'Functional Load Definition', 'Inspector drawer should show correct node title');
        assert.ok(inspectorFullText.includes('contrastive work done by two phonemes'), 'Inspector drawer should show full note text');

        const firstCitation = await page.textContent('.crm-source-ref-citation');
        assert.strictEqual(
            firstCitation.trim(),
            '“Functional load measures the contrastive work done by two phonemes.”',
            'The source reference must show the exact passage supporting the selected thought block.'
        );

        await page.click('.crm-mindmap-node.subtopic[data-sub-id="sub_2_1"]');
        const secondCitation = await page.textContent('.crm-source-ref-citation');
        assert.strictEqual(
            secondCitation.trim(),
            '“Teachers should prioritize high functional load vowel and consonant errors over low functional load contrasts in classroom instruction.”',
            'Different thought blocks must show their own supporting citation instead of repeated source content.'
        );

        const notesBeforeDeletion = await page.evaluate(({ bookId }) => window.localStorage.getItem(`crm_books_notes_${bookId}`), { bookId: BOOK.bookId });
        await page.evaluate(({ bookId }) => {
            const notes = JSON.parse(window.localStorage.getItem(`crm_books_notes_${bookId}`));
            window.localStorage.setItem(`crm_books_notes_${bookId}`, JSON.stringify(notes.filter(note => note.id !== 'note_2' && note.id !== 'fs_note_2')));
        }, { bookId: BOOK.bookId });
        await page.click('.crm-mindmap-node.subtopic[data-sub-id="sub_2_1"]');
        assert.match(await page.textContent('#crm-mindmap-inspector-sources'), /Insufficient evidence/i, 'Deleted referenced notes must become insufficient evidence.');
        assert.strictEqual(await page.locator('.crm-mindmap-source-ref').count(), 0, 'Deleted referenced notes must not expose a reader button.');
        await page.evaluate(({ bookId, notes }) => window.localStorage.setItem(`crm_books_notes_${bookId}`, notes), { bookId: BOOK.bookId, notes: notesBeforeDeletion });
        await page.click('.crm-mindmap-node.subtopic[data-sub-id="sub_2_1"]');

        await page.click('.crm-mindmap-source-ref');
        await page.waitForSelector('#crm-mindmap-reader-overlay[style*="display: flex"]');
        const citedPassage = await page.textContent('.crm-mindmap-reader-citation');
        const sourceNoteBody = await page.textContent('.crm-mindmap-reader-body');
        assert.ok(citedPassage.includes('Teachers should prioritize high functional load'), 'The source reader must identify the cited passage.');
        assert.ok(sourceNoteBody.includes('classroom instruction'), 'The source reader must retain access to the complete saved note.');

        await page.click('.crm-mindmap-reader-close');
        await page.click('.crm-mindmap-node.subtopic[data-sub-id="sub_2_2"]');
        assert.strictEqual(
            (await page.locator('.crm-source-ref-citation').count()),
            1,
            'A valid quotation may be reused by another thought block.'
        );

        await page.click('.crm-mindmap-node.subtopic[data-sub-id="sub_2_4"]');
        assert.strictEqual(
            (await page.locator('.crm-source-ref-citation').count()),
            1,
            'Citations using a Firestore ID must resolve local fs_ notes.'
        );

        await page.click('.crm-mindmap-node.subtopic[data-sub-id="sub_2_3"]');
        assert.match(
            await page.textContent('#crm-mindmap-inspector-sources'),
            /Insufficient evidence/i,
            'Unverified blocks must show an explicit insufficient-evidence state.'
        );
        assert.strictEqual(
            await page.locator('.crm-mindmap-source-ref').count(),
            0,
            'Insufficient blocks must not expose a whole-note source fallback.'
        );

        // UI-19 regression coverage: use the real modal controls at desktop
        // and narrow viewports, including actual Close, Escape, export, and
        // touch-scrolling behavior.
        const initialInspectorClose = page.locator('#crm-mindmap-inspector-close');
        if (await initialInspectorClose.isVisible().catch(() => false)) {
            await initialInspectorClose.click();
        }
        await page.locator('#crm-mindmap-close-btn').click();
        await page.waitForFunction(() => document.querySelector('#crm-books-mindmap-modal')?.style.display === 'none');

        const viewportMatrix = [
            { width: 1440, height: 900, id: '1440x900' },
            { width: 768, height: 844, id: '768x844' },
            { width: 390, height: 844, id: '390x844' },
            { width: 360, height: 844, id: '360x844' },
            { width: 844, height: 844, id: '844x844' },
            { width: 844, height: 390, id: '844x390' }
        ];

        for (const viewport of viewportMatrix) {
            await page.setViewportSize({ width: viewport.width, height: viewport.height });
            await page.evaluate(() => {
                const dropdown = document.querySelector('#crm-mindmap-export-dropdown');
                if (dropdown) dropdown.style.display = 'none';
            });
            await page.locator('.crm-books-create-mindmap-btn').click();
            await page.waitForSelector('#crm-books-mindmap-modal[style*="display: flex"]', { timeout: 10000 });
            await page.waitForTimeout(80);
            await page.waitForSelector('.crm-mindmap-node.central', { timeout: 10000 });

            const geometry = await page.evaluate(() => {
                const rectFor = (selector) => {
                    const element = document.querySelector(selector);
                    if (!element) return null;
                    const rect = element.getBoundingClientRect();
                    return {
                        left: rect.left,
                        right: rect.right,
                        top: rect.top,
                        bottom: rect.bottom,
                        width: rect.width,
                        height: rect.height
                    };
                };
                return {
                    headerActions: rectFor('.crm-mindmap-header-actions'),
                    close: rectFor('#crm-mindmap-close-btn'),
                    export: rectFor('#crm-mindmap-export-btn'),
                    toolbar: rectFor('#crm-mindmap-toolbar'),
                    viewport: { width: window.innerWidth, height: window.innerHeight }
                };
            });
            assert.ok(geometry.headerActions, `${viewport.id}: mind-map header actions should render.`);
            assert.ok(geometry.close, `${viewport.id}: Close should render.`);
            assert.ok(geometry.export, `${viewport.id}: Export should render.`);
            assert.ok(
                geometry.headerActions.right <= geometry.viewport.width + 1,
                `${viewport.id}: header actions must fit within the viewport (${geometry.headerActions.right} > ${geometry.viewport.width}).`
            );
            for (const [name, rect] of [['Close', geometry.close], ['Export', geometry.export]]) {
                assert.ok(rect.left >= -1 && rect.right <= geometry.viewport.width + 1, `${viewport.id}: ${name} must be inside the viewport.`);
                const centerHit = await page.evaluate(({ selector, rect }) => {
                    const hit = document.elementFromPoint((rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2);
                    return !!hit?.closest(selector);
                }, { selector: name === 'Close' ? '#crm-mindmap-close-btn' : '#crm-mindmap-export-btn', rect });
                assert.ok(centerHit, `${viewport.id}: ${name} center should hit the control.`);
            }

            const focusableCount = await page.evaluate(() => {
                const modal = document.querySelector('#crm-books-mindmap-modal');
                if (!modal) return 0;
                return Array.from(modal.querySelectorAll(
                    'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
                )).filter((element) => {
                    const style = getComputedStyle(element);
                    return element.getClientRects().length > 0
                        && style.visibility !== 'hidden'
                        && style.display !== 'none'
                        && !element.closest('[inert]');
                }).length;
            });
            assert.ok(focusableCount > 0, `${viewport.id}: modal should expose focusable controls.`);
            const focusTraversalSteps = Math.min(focusableCount + 2, 80);
            for (let step = 0; step < focusTraversalSteps; step += 1) {
                await page.keyboard.press('Tab');
                const focusInside = await page.evaluate(() => {
                    const modal = document.querySelector('#crm-books-mindmap-modal');
                    return !!modal?.contains(document.activeElement);
                });
                assert.strictEqual(focusInside, true, `${viewport.id}: Tab focus must remain inside the mind-map dialog.`);
            }
            for (let step = 0; step < focusTraversalSteps; step += 1) {
                await page.keyboard.press('Shift+Tab');
                const focusInside = await page.evaluate(() => {
                    const modal = document.querySelector('#crm-books-mindmap-modal');
                    return !!modal?.contains(document.activeElement);
                });
                assert.strictEqual(focusInside, true, `${viewport.id}: Shift+Tab focus must remain inside the mind-map dialog.`);
            }

            if (viewport.id === '1440x900') {
                await page.locator('#crm-mindmap-export-btn').click();
                await page.waitForSelector('#crm-mindmap-export-dropdown[style*="display: block"]');
                const downloadPromise = page.waitForEvent('download');
                await page.locator('.crm-mindmap-export-option[data-export="markdown"]').click();
                const download = await downloadPromise;
                assert.strictEqual(download.suggestedFilename(), 'mindmap_book-1.md', 'Markdown export should use the book filename.');
                const stream = await download.createReadStream();
                assert.ok(stream, 'Markdown export should provide a readable download stream.');
                const chunks = [];
                for await (const chunk of stream) chunks.push(chunk);
                const markdown = Buffer.concat(chunks).toString('utf8');
                assert.match(markdown, /Functional Load in Pronunciation/, 'Markdown export should contain the mind-map title.');
                await page.evaluate(() => {
                    const dropdown = document.querySelector('#crm-mindmap-export-dropdown');
                    if (dropdown) dropdown.style.display = 'none';
                });

                // Escape first closes an open inspector, then closes the map.
                await page.locator('.crm-mindmap-node.subtopic').first().click();
                await page.waitForSelector('#crm-mindmap-inspector[style*="display: flex"]');
                await page.keyboard.press('Escape');
                await page.waitForFunction(() => {
                    const modal = document.querySelector('#crm-books-mindmap-modal');
                    const inspector = document.querySelector('#crm-mindmap-inspector');
                    return modal?.style.display !== 'none' && inspector?.style.display === 'none';
                });
            }

            if (viewport.id === '390x844') {
                const toolbarMetrics = await page.locator('#crm-mindmap-toolbar').evaluate((toolbar) => ({
                    clientWidth: toolbar.clientWidth,
                    scrollWidth: toolbar.scrollWidth,
                    overflowX: getComputedStyle(toolbar).overflowX,
                    touchAction: getComputedStyle(toolbar).touchAction
                }));
                assert.ok(toolbarMetrics.scrollWidth > toolbarMetrics.clientWidth, '390x844: toolbar should expose horizontal content to scroll.');
                assert.match(toolbarMetrics.overflowX, /auto|scroll/, '390x844: toolbar should use horizontal overflow scrolling.');
                assert.match(toolbarMetrics.touchAction, /pan-x/, '390x844: toolbar should permit horizontal touch panning.');
                const toolbarControlHit = await page.locator('#crm-mindmap-toolbar button').first().evaluate((button) => {
                    const rect = button.getBoundingClientRect();
                    const hit = document.elementFromPoint((rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2);
                    return hit?.closest('#crm-mindmap-toolbar')?.id || null;
                });
                assert.strictEqual(toolbarControlHit, 'crm-mindmap-toolbar', '390x844: the minimap must not cover the toolbar controls.');

                const toolbarBox = await page.locator('#crm-mindmap-toolbar').boundingBox();
                assert.ok(toolbarBox, '390x844: toolbar should have a hit area.');
                const cdp = await page.context().newCDPSession(page);
                await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
                await page.locator('#crm-mindmap-toolbar').evaluate((toolbar) => { toolbar.scrollLeft = 0; });
                const touchY = toolbarBox.y + toolbarBox.height / 2;
                const startX = toolbarBox.x + toolbarBox.width - 8;
                const endX = toolbarBox.x + 8;
                const touchPoint = (x) => ({ x, y: touchY, radiusX: 1, radiusY: 1, force: 1, id: 1 });
                await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touchPoint(startX)] });
                await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [touchPoint(startX - (startX - endX) / 3)] });
                await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [touchPoint(endX)] });
                await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
                await page.waitForTimeout(80);
                const scrolledLeft = await page.locator('#crm-mindmap-toolbar').evaluate((toolbar) => toolbar.scrollLeft);
                await cdp.detach();
                assert.ok(scrolledLeft > 0, `390x844: touch drag should scroll the toolbar (scrollLeft=${scrolledLeft}).`);
            }

            if (viewport.id === '390x844' || viewport.id === '360x844') {
                await page.locator('#crm-mindmap-close-btn').click();
                await page.waitForFunction(() => document.querySelector('#crm-books-mindmap-modal')?.style.display === 'none');
                const pointerCloseFocus = await page.evaluate(() => document.activeElement?.matches('.crm-books-create-mindmap-btn'));
                assert.strictEqual(pointerCloseFocus, true, `${viewport.id}: pointer Close should restore opener focus.`);
                await page.locator('.crm-books-create-mindmap-btn').click();
                await page.waitForSelector('#crm-books-mindmap-modal[style*="display: flex"]', { timeout: 10000 });
                await page.waitForSelector('.crm-mindmap-node.central', { timeout: 10000 });
            }

            await page.keyboard.press('Escape');
            await page.waitForFunction(() => document.querySelector('#crm-books-mindmap-modal')?.style.display === 'none');
            const focusRestored = await page.evaluate(() => document.activeElement?.matches('.crm-books-create-mindmap-btn'));
            assert.strictEqual(focusRestored, true, `${viewport.id}: Escape should restore focus to Create Mind Map.`);
        }

        // The fixture intentionally exercises the bounded citation-upgrade outage;
        // its logged error is expected, while every other browser console error fails.
        const expectedConsoleErrorPrefixes = [
            'Failed to open mind map: Error: simulated citation upgrade outage'
        ];
        const unexpectedConsoleErrors = consoleErrors.filter((message) => !expectedConsoleErrorPrefixes.some((prefix) => message.startsWith(prefix)));
        assert.deepStrictEqual(unexpectedConsoleErrors, [], `Unexpected browser console errors: ${unexpectedConsoleErrors.join('; ')}`);
        assert.deepStrictEqual(pageErrors, [], `Unexpected page errors: ${pageErrors.join('; ')}`);
        console.log('CRM Books Mind Map browser check passed successfully!');
    } finally {
        await browser.close();
    }
}

main().catch((err) => {
    console.error('Test failed:', err);
    process.exit(1);
});
