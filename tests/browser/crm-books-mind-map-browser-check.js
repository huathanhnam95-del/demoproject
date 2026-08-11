const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = process.cwd();
const SCREENSHOT_PATH = path.join(ROOT, 'tmp', 'crm-books-mindmap-browser-check.png');
const INSPECTOR_SCREENSHOT_PATH = path.join(ROOT, 'tmp', 'crm-books-mindmap-inspector-browser-check.png');

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
    }
];

const MOCK_MIND_MAP = {
    bookId: 'book-1',
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
                    fullText: SAMPLE_NOTES[1].text
                }
            ]
        }
    ]
};

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
    fs.mkdirSync(path.dirname(SCREENSHOT_PATH), { recursive: true });
    const browser = await chromium.launch({ headless: true });
    const pageErrors = [];
    const consoleErrors = [];

    try {
        const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
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
              </aside>
            </div>
          </div>
        `);

        await page.evaluate(installMemoryLocalStorage);
        await page.addStyleTag({ path: path.join(ROOT, 'public', 'crm-admin.css') });
        await page.addScriptTag({ path: path.join(ROOT, 'public', 'js', 'crm', 'books-workspace.js') });

        // Seed notes and API mock
        await page.evaluate(async ({ book, notes, mockMap }) => {
            window.localStorage.setItem(`crm_books_notes_${book.bookId}`, JSON.stringify(notes));

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
                    return { mindMap: mockMap };
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
        }, { book: BOOK, notes: SAMPLE_NOTES, mockMap: MOCK_MIND_MAP });

        // Click book item in sources list to ensure active state
        await page.waitForSelector('.crm-books-item');
        await page.click('.crm-books-item');

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

        // Verify Mind Map Nodes rendered
        await page.waitForSelector('.crm-mindmap-node.central');
        await page.waitForSelector('.crm-mindmap-node.category');
        await page.waitForSelector('.crm-mindmap-node.subtopic');

        await page.waitForSelector('.crm-mindmap-node.subtopic');

        const catNodes = await page.$$('.crm-mindmap-node.category');
        assert.strictEqual(catNodes.length, 2, 'Should render 2 category nodes');

        await page.screenshot({ path: SCREENSHOT_PATH });

        // Click a subtopic node to open full note inspector drawer
        await page.click('.crm-mindmap-node.subtopic[data-sub-id="sub_1_1"]');
        await page.waitForSelector('#crm-mindmap-inspector[style*="display: flex"]');

        const inspectorTitle = await page.textContent('#crm-mindmap-inspector-title');
        const inspectorFullText = await page.textContent('#crm-mindmap-inspector-fulltext');

        assert.strictEqual(inspectorTitle, 'Functional Load Definition', 'Inspector drawer should show correct node title');
        assert.ok(inspectorFullText.includes('contrastive work done by two phonemes'), 'Inspector drawer should show full note text');

        await page.screenshot({ path: INSPECTOR_SCREENSHOT_PATH });

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
