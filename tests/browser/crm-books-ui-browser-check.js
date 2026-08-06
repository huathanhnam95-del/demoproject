const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = process.cwd();
const SCREENSHOT_PATH = path.join(ROOT, 'tmp', 'crm-books-ui-browser-check.png');

const BOOK = {
    bookId: 'book-1',
    title: 'The Practice of Clear Thinking',
    author: 'Maya Chen',
    pageCount: 315,
    status: 'ready',
    ingest: null
};

const SUMMARY = {
    oneLiner: 'A practical guide to making better decisions under pressure.',
    overview: 'The book explains how to slow down, identify assumptions, and choose useful next steps.',
    audience: 'Readers who want a repeatable decision-making process.',
    keyTopics: [{ topic: 'assumptions', pages: [12, 18] }],
    outline: [{ title: 'Start with the question', pageStart: 1, pageEnd: 22, children: [] }]
};

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

        await page.setContent(`
          <section class="crm-panel" data-panel="books" style="display:block; width:100%; height:100vh;">
            <div class="crm-books-workspace">
              <div class="crm-books-sources-panel">
                <div class="crm-books-sources-header"><h3>Sources</h3><span class="crm-books-sources-count">0</span></div>
                <div class="crm-books-search-wrap"><input class="crm-books-search" placeholder="Search books..." /></div>
                <ul class="crm-books-list"><li class="crm-books-empty-item">No books yet.</li></ul>
                <button class="crm-books-add-btn" type="button">Add source</button>
              </div>
              <div class="crm-books-explorer-panel">
                <div class="crm-books-detail">
                  <div class="crm-books-empty-detail"><h3>Select a book</h3></div>
                </div>
              </div>
            </div>
          </section>
        `);
        await page.addStyleTag({ path: path.join(ROOT, 'public', 'crm-admin.css') });
        await page.addScriptTag({ path: path.join(ROOT, 'public', 'js', 'crm', 'books-workspace.js') });

        await page.evaluate(async ({ book, summary }) => {
            const panel = document.querySelector('[data-panel="books"]');
            const request = async (requestPath) => {
                if (requestPath === '/api/admin/books') return { books: [book] };
                if (requestPath === `/api/admin/books/${book.bookId}`) return { book, summary };
                if (requestPath === `/api/admin/books/${book.bookId}/threads`) {
                    return { threads: [{ threadId: 'thread-1', title: 'Decision-making questions', messageCount: 2 }] };
                }
                if (requestPath === `/api/admin/books/${book.bookId}/threads/thread-1/messages`) {
                    return {
                        messages: [
                            { role: 'user', text: 'What does the book say about assumptions?', citations: [] },
                            {
                                role: 'assistant',
                                text: 'It recommends naming the assumptions behind a decision before choosing an action.',
                                answered: true,
                                citations: [{ pageStart: 12, pageEnd: 18, snippet: 'Name the assumptions before selecting the next action.' }]
                            }
                        ]
                    };
                }
                throw new Error(`Unexpected Books request: ${requestPath}`);
            };

            window.__crmBooksController = window.CrmBooksWorkspace.createController({
                elements: { booksPanel: panel },
                apiFetchJson: request,
                showToast: () => {},
                firebase: null
            });
            await window.__crmBooksController.init();
            await window.__crmBooksController.selectBook(book.bookId);
        }, { book: BOOK, summary: SUMMARY });

        await page.waitForSelector('.crm-books-list-item[data-book-id="book-1"]');
        await page.click('.crm-books-tab[data-books-tab="chat"]');
        await page.waitForSelector('.crm-books-tab-body.chat-active');
        await page.waitForSelector('.crm-books-thread-select');
        await page.waitForSelector('.crm-books-msg-assistant');

        const layout = await page.evaluate(() => {
            const workspace = document.querySelector('.crm-books-workspace');
            const explorer = document.querySelector('.crm-books-explorer-panel');
            const chatBody = document.querySelector('.crm-books-tab-body.chat-active');
            const composer = document.querySelector('.crm-books-composer');
            const message = document.querySelector('.crm-books-msg-assistant');
            const grid = getComputedStyle(workspace).gridTemplateColumns;
            return {
                studioCount: document.querySelectorAll('.crm-books-studio-panel').length,
                chatActive: !!chatBody,
                grid,
                explorerWidth: explorer.getBoundingClientRect().width,
                chatBodyWidth: chatBody.getBoundingClientRect().width,
                composerWidth: composer.getBoundingClientRect().width,
                messageWidth: message.getBoundingClientRect().width
            };
        });

        assert.strictEqual(layout.studioCount, 0, 'Studio panel must not be present in the rendered Books UI.');
        assert.strictEqual(layout.chatActive, true, 'Chat tab must use the full-height layout.');
        assert.match(layout.grid, /^260px\s+/i, `Sources column should remain 260px: ${layout.grid}`);
        assert.ok(layout.explorerWidth > 1000, `Explorer/chat panel should reclaim the Studio width: ${layout.explorerWidth}`);
        assert.ok(layout.composerWidth > 1000, `Chat composer should use the widened panel: ${layout.composerWidth}`);
        assert.ok(layout.messageWidth > 720, `Chat messages should be wider than the former 720px cap: ${layout.messageWidth}`);
        assert.ok(layout.messageWidth <= layout.chatBodyWidth, 'Chat messages must remain inside the chat surface.');

        await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });
        assert.deepStrictEqual(pageErrors, [], `Unexpected page errors:\n${pageErrors.join('\n')}`);
        assert.deepStrictEqual(consoleErrors, [], `Unexpected console errors:\n${consoleErrors.join('\n')}`);
        console.log(`Screenshot saved to ${path.relative(ROOT, SCREENSHOT_PATH)}`);
        console.log('crm books UI browser check passed');
    } finally {
        await browser.close();
    }
}

main().catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exit(1);
});
