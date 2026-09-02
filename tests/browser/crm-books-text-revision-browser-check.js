const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = process.cwd();
const SCREENSHOT_LEGACY_PATH = path.join(ROOT, 'tmp', 'crm-books-revision-legacy-check.png');
const SCREENSHOT_OCRV2_PATH = path.join(ROOT, 'tmp', 'crm-books-revision-ocrv2-check.png');

const BOOK = {
    bookId: 'book-rev-test',
    title: 'Teaching Pronunciation Guide',
    author: 'John Levis',
    pageCount: 10,
    status: 'ready',
    activeTextRevisionId: null,
    source: { sha256: 'test-source-sha', generation: '1' }
};

const LEGACY_PAGES_DATA = {
    totalPages: 10,
    pages: [
        'ANeglectedSpecias\nChapter 1\nBasics of Teaching Pronunciation',
        'jof ASTD itt Training IIMIWIN\nTeachingPronunciationintheCommunicativeClassroom',
        'Page 3 text',
        'Page 4 text',
        'Page 5 text',
        'Page 6 text',
        'Page 7 text',
        'Page 8 text',
        'Page 9 text',
        'Page 10 text'
    ],
    textRevisionId: 'legacy',
    schemaVersion: '1.0',
    rendererContract: 'legacy'
};

const OCRV2_PAGES_DATA = {
    totalPages: 10,
    pages: [
        'A Neglected Species\nChapter 1\nBasics of Teaching Pronunciation',
        'Teaching Pronunciation in the Communicative Classroom',
        'Page 3 text',
        'Page 4 text',
        'Page 5 text',
        'Page 6 text',
        'Page 7 text',
        'Page 8 text',
        'Page 9 text',
        'Page 10 text'
    ],
    textRevisionId: 'rev_ocrv2_candidate_1',
    schemaVersion: '2.0',
    rendererContract: 'ocr-v2',
    pagesHash: 'hash-candidate-1'
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
    fs.mkdirSync(path.dirname(SCREENSHOT_LEGACY_PATH), { recursive: true });
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
                <div class="crm-books-sources-header"><button class="crm-books-sources-header-toggle" type="button">☰</button><h3>Sources</h3><span class="crm-books-sources-count">0</span></div>
                <button class="crm-books-add-btn" type="button">Add source</button>
                <div class="crm-books-search-wrap"><input class="crm-books-search" placeholder="Search books..." /></div>
                <ul class="crm-books-list"><li class="crm-books-empty-item">No books yet.</li></ul>
              </div>
              <div class="crm-books-explorer-panel">
                <div class="crm-books-detail">
                  <div class="crm-books-empty-detail"><h3>Select a book</h3></div>
                </div>
              </div>
            </div>
          </section>
        `);

        await page.evaluate(installMemoryLocalStorage);
        await page.addStyleTag({ path: path.join(ROOT, 'public', 'crm-admin.css') });
        await page.addScriptTag({ path: path.join(ROOT, 'public', 'js', 'crm', 'books-word-segmenter.js') });
        await page.addScriptTag({ path: path.join(ROOT, 'public', 'js', 'crm', 'books-workspace.js') });

        // Initialize workspace with mock API handling revision swap
        await page.evaluate(async ({ book, legacyPages, ocrV2Pages }) => {
            let activePagesResponse = legacyPages;
            let currentBook = { ...book };

            const request = async (requestPath, options = {}) => {
                const method = options.method || 'GET';
                if (requestPath === '/api/admin/books') return { books: [currentBook] };
                if (requestPath === `/api/admin/books/${book.bookId}`) return { book: currentBook, summary: null };
                if (requestPath === `/api/admin/books/${book.bookId}/pages`) return activePagesResponse;
                if (requestPath === `/api/admin/books/${book.bookId}/sections`) return { sections: [] };
                if (requestPath === `/api/admin/books/${book.bookId}/threads`) return { threads: [] };
                if (requestPath === `/api/admin/books/${book.bookId}/notes`) return { notes: [] };
                if (requestPath === `/api/admin/books/${book.bookId}/audio`) return { tracks: [] };
                if (requestPath === '/api/admin/books/usage') return { estimatedCostUsd: 0, budgetLimitUsd: 10, approved: false };

                if (requestPath === `/api/admin/books/${book.bookId}/text-revisions/${ocrV2Pages.textRevisionId}/activate` && method === 'POST') {
                    currentBook.activeTextRevisionId = ocrV2Pages.textRevisionId;
                    activePagesResponse = ocrV2Pages;
                    return { success: true, activeTextRevisionId: ocrV2Pages.textRevisionId };
                }

                return {};
            };

            const panel = document.querySelector('[data-panel="books"]');
            window.__crmBooksController = window.CrmBooksWorkspace.createController({
                elements: { booksPanel: panel },
                apiFetchJson: request,
                showToast: () => {},
                firebase: null
            });
            await window.__crmBooksController.init();
            await window.__crmBooksController.selectBook(book.bookId);

            window.__simulateRevisionActivation = async () => {
                await request(`/api/admin/books/${book.bookId}/text-revisions/${ocrV2Pages.textRevisionId}/activate`, { method: 'POST' });
                await window.__crmBooksController.selectBook(book.bookId);
            };
        }, { book: BOOK, legacyPages: LEGACY_PAGES_DATA, ocrV2Pages: OCRV2_PAGES_DATA });

        // Navigate to pages tab
        await page.waitForSelector('.crm-books-tab[data-books-tab="pages"]');
        await page.click('.crm-books-tab[data-books-tab="pages"]');
        await page.waitForSelector('.crm-books-page-content');

        // Check Page 1 text under legacy contract: segmenter splits ANeglectedSpecias -> A Neglected Spec ias
        const page1ContentLegacy = await page.textContent('.crm-books-page-content');
        assert.match(page1ContentLegacy, /Spec ias/, 'Legacy contract with corrupt text runs segmenter (Specias -> Spec ias)');
        await page.screenshot({ path: SCREENSHOT_LEGACY_PATH });

        // Trigger revision activation to OCR-v2
        await page.evaluate(async () => {
            await window.__simulateRevisionActivation();
        });

        // Switch to pages tab
        await page.waitForSelector('.crm-books-tab[data-books-tab="pages"]');
        await page.click('.crm-books-tab[data-books-tab="pages"]');
        await page.waitForSelector('.crm-books-page-content');
        const page1ContentOcrV2 = await page.textContent('.crm-books-page-content');
        assert.match(page1ContentOcrV2, /A Neglected Species/, 'OCR-v2 active revision displays exact ground truth Species');
        assert.doesNotMatch(page1ContentOcrV2, /Spec ias/, 'No segmenter artifact Spec ias in OCR-v2');
        await page.screenshot({ path: SCREENSHOT_OCRV2_PATH });

        assert.strictEqual(pageErrors.length, 0, `Page errors encountered: ${pageErrors.join('; ')}`);
        assert.strictEqual(consoleErrors.length, 0, `Console errors encountered: ${consoleErrors.join('; ')}`);

        console.log('CRM Books text revision browser check passed in Chrome Playwright');
    } finally {
        await browser.close();
    }
}

main().catch((err) => {
    console.error(err.stack || err);
    process.exitCode = 1;
});
