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

const EXISTING_THREAD = {
    threadId: 'thread-1',
    title: 'Decision-making questions',
    messageCount: 2,
    updatedAt: '2026-08-07T00:00:00.000Z'
};

const CITED_TEXT = 'Name the assumptions before selecting the next action.';

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

        // setContent uses an opaque origin in Playwright. The real CRM page has
        // localStorage, so provide the smallest safe equivalent for this fixture.
        await page.addInitScript(() => {
            Object.defineProperty(window, 'localStorage', {
                configurable: true,
                value: { getItem: () => null, setItem: () => {}, removeItem: () => {} }
            });
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
        await page.evaluate(() => {
            Object.defineProperty(window, 'localStorage', {
                configurable: true,
                value: { getItem: () => null, setItem: () => {}, removeItem: () => {} }
            });
        });
        await page.addStyleTag({ path: path.join(ROOT, 'public', 'crm-admin.css') });
        await page.addScriptTag({ path: path.join(ROOT, 'public', 'js', 'crm', 'books-workspace.js') });

        await page.evaluate(async ({ book, summary, existingThread, citedText }) => {
            const panel = document.querySelector('[data-panel="books"]');
            const pages = Array.from({ length: book.pageCount }, (_, index) => index === 11
                ? `Reading page 12.\n\n${citedText}`
                : `Reading page ${index + 1}.`);
            const requests = [];
            let createdThread = null;

            const request = async (requestPath, options = {}) => {
                const method = options.method || 'GET';
                const body = options.body ? JSON.parse(options.body) : null;
                requests.push({ path: requestPath, method, body });

                if (requestPath === '/api/admin/books') return { books: [book] };
                if (requestPath === `/api/admin/books/${book.bookId}`) return { book, summary };
                if (requestPath === '/api/admin/books/usage') {
                    return { estimatedCostUsd: 0, budgetLimitUsd: 10, approved: false };
                }
                if (requestPath === `/api/admin/books/${book.bookId}/threads` && method === 'GET') {
                    return { threads: createdThread ? [createdThread, existingThread] : [existingThread] };
                }
                if (requestPath === `/api/admin/books/${book.bookId}/threads` && method === 'POST') {
                    createdThread = { threadId: 'thread-new', title: body.title, messageCount: 0, updatedAt: new Date().toISOString() };
                    return { threadId: createdThread.threadId, title: createdThread.title };
                }
                if (requestPath === `/api/admin/books/${book.bookId}/threads/thread-1/messages` && method === 'GET') {
                    return {
                        messages: [
                            { role: 'user', text: 'What does the book say about assumptions?', citations: [] },
                            {
                                role: 'assistant',
                                text: `It recommends naming the assumptions behind a decision before choosing an action. [C1]`,
                                answered: true,
                                citations: [{ marker: 'C1', pageStart: 12, pageEnd: 12, snippet: citedText, highlightText: citedText }]
                            }
                        ]
                    };
                }
                if (requestPath === `/api/admin/books/${book.bookId}/threads/thread-new/messages` && method === 'POST') {
                    return {
                        userMessage: { role: 'user', text: body.text, citations: [] },
                        assistantMessage: {
                            role: 'assistant',
                            text: `The book recommends naming assumptions before acting. [C1]`,
                            answered: true,
                            citations: [{ marker: 'C1', pageStart: 12, pageEnd: 12, snippet: citedText, highlightText: citedText }]
                        }
                    };
                }
                if (requestPath === `/api/admin/books/${book.bookId}/threads/thread-new/messages` && method === 'GET') {
                    return { messages: [] };
                }
                if (requestPath.startsWith(`/api/admin/books/${book.bookId}/threads/`) && method === 'PATCH') {
                    const threadId = requestPath.split('/').at(-1);
                    return { thread: { threadId, title: body.title } };
                }
                if (requestPath === `/api/admin/books/${book.bookId}/pages`) {
                    return { totalPages: pages.length, pages };
                }
                throw new Error(`Unexpected Books request: ${method} ${requestPath}`);
            };

            window.__crmBookRequests = requests;
            window.__crmBooksController = window.CrmBooksWorkspace.createController({
                elements: { booksPanel: panel },
                apiFetchJson: request,
                showToast: () => {},
                firebase: null
            });
            await window.__crmBooksController.init();
            await window.__crmBooksController.selectBook(book.bookId);
        }, { book: BOOK, summary: SUMMARY, existingThread: EXISTING_THREAD, citedText: CITED_TEXT });

        await page.waitForSelector('.crm-books-list-item[data-book-id="book-1"]');
        await page.click('.crm-books-tab[data-books-tab="chat"]');
        await page.waitForSelector('.crm-books-tab-body.chat-active');
        await page.waitForSelector('.crm-books-composer');
        assert.strictEqual(await page.locator('.crm-books-msg-assistant').count(), 0, 'Opening Chat should show a blank draft, not the newest saved thread.');

        const blankComposer = await page.locator('.crm-books-composer-input').inputValue();
        assert.strictEqual(blankComposer, '', 'New-chat composer should start empty.');
        assert.strictEqual(await page.locator('.crm-books-chat-draft-title').count(), 1, 'Blank Chat should show a draft title.');

        await page.locator('.crm-books-composer-input').fill('What should I check before making a decision?');
        await page.click('.crm-books-send-btn');
        await page.waitForSelector('.crm-books-msg-assistant');
        assert.strictEqual(await page.locator('.crm-books-msg-user').count(), 1, 'First send should create one user message.');
        assert.strictEqual(await page.locator('.crm-books-msg-assistant').count(), 1, 'First send should create one assistant answer.');
        assert.strictEqual(await page.locator('.crm-books-thread-title-text').textContent(), 'What should I check before making a decision?', 'Thread title should derive from the first question.');

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

        // Rename from Chat, including keyboard submit.
        await page.click('.crm-books-thread-rename-btn');
        await page.locator('.crm-books-thread-title-input').fill('Decision checklist');
        await page.locator('.crm-books-thread-title-input').press('Enter');
        await page.waitForSelector('.crm-books-thread-title-text');

        // History is a first-class tab and selecting a row resumes its saved messages.
        await page.click('.crm-books-tab[data-books-tab="history"]');
        await page.waitForSelector('.crm-books-history-row');
        assert.ok(await page.locator('.crm-books-history-row').count() >= 2, 'History should show both saved and newly-created chats.');
        await page.click('.crm-books-history-open[data-history-thread-id="thread-1"]');
        await page.waitForSelector('.crm-books-msg-assistant');
        assert.match(await page.locator('.crm-books-msg-text').allTextContents().then((texts) => texts.join(' ')), /assumptions/, 'History selection should restore the selected thread messages.');

        // Rename from History, then verify both PATCH calls retained their edits.
        await page.click('.crm-books-tab[data-books-tab="history"]');
        const existingRow = page.locator('.crm-books-history-row[data-thread-id="thread-1"]');
        await existingRow.locator('.crm-books-thread-rename-btn').click();
        await existingRow.locator('.crm-books-thread-title-input').fill('Saved decision chat');
        await existingRow.locator('.crm-books-thread-title-save').click();
        await page.waitForSelector('.crm-books-history-row-title');

        const requestLog = await page.evaluate(() => window.__crmBookRequests);
        const patchBodies = requestLog.filter((request) => request.method === 'PATCH').map((request) => request.body.title);
        assert.deepStrictEqual(patchBodies, ['Decision checklist', 'Saved decision chat'], 'Chat and History rename should persist through PATCH.');

        // Citation activation loads Pages, navigates to the source page, and marks the quote.
        await page.click('.crm-books-history-open[data-history-thread-id="thread-1"]');
        await page.waitForSelector('.crm-books-msg-assistant');
        await page.locator('.crm-books-citation-ref[data-citation-marker="C1"]').first().click();
        await page.waitForSelector('.crm-books-page-paper');
        await page.waitForSelector('.crm-books-citation-highlight');
        assert.strictEqual(await page.locator('.crm-books-page-input').inputValue(), '12', 'Citation should navigate to the cited page.');
        assert.strictEqual(await page.locator('.crm-books-citation-highlight').textContent(), CITED_TEXT, 'Citation should visibly highlight the validated quote.');

        // Summary numbering has a real list indentation rather than an inline zero-padding override.
        await page.click('.crm-books-tab[data-books-tab="summary"]');
        await page.waitForSelector('.crm-books-outline');
        const outlineLayout = await page.evaluate(() => {
            const outline = document.querySelector('.crm-books-outline');
            const card = outline?.closest('.crm-books-section-card');
            return {
                padding: getComputedStyle(outline).paddingInlineStart,
                outlineLeft: outline?.getBoundingClientRect().left || 0,
                cardLeft: card?.getBoundingClientRect().left || 0
            };
        });
        assert.notStrictEqual(outlineLayout.padding, '0px', 'Outline list must reserve marker space inside its surface.');
        assert.ok(outlineLayout.outlineLeft >= outlineLayout.cardLeft, 'Outline markers must remain inside the summary card.');

        // Repeat the key interaction at a narrow Chrome viewport and assert that
        // the composer, history rows, and citation preview stay within bounds.
        await page.setViewportSize({ width: 390, height: 844 });
        await page.click('.crm-books-tab[data-books-tab="chat"]');
        await page.waitForSelector('.crm-books-composer');
        const narrowLayout = await page.evaluate(() => ({
            viewport: window.innerWidth,
            composerWidth: document.querySelector('.crm-books-composer')?.getBoundingClientRect().width || 0,
            documentWidth: document.documentElement.scrollWidth
        }));
        assert.ok(narrowLayout.composerWidth <= narrowLayout.viewport, 'Narrow composer must stay within the viewport.');
        assert.ok(narrowLayout.documentWidth <= narrowLayout.viewport + 1, 'Narrow Books view must not introduce horizontal overflow.');

        const citationButton = page.locator('.crm-books-citation-wrap .crm-books-citation-ref[data-citation-marker="C1"]').first();
        await citationButton.focus();
        await page.waitForTimeout(400);
        const previewLayout = await page.locator('.crm-books-citation-preview').first().evaluate((preview) => {
            const rect = preview.getBoundingClientRect();
            return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height, visible: preview.classList.contains('visible') };
        });
        assert.strictEqual(previewLayout.visible, true, 'Citation preview should appear on hover.');
        assert.ok(previewLayout.left >= 0 && previewLayout.right <= narrowLayout.viewport, 'Citation preview must be clamped horizontally.');
        assert.ok(previewLayout.top >= 0 && previewLayout.bottom <= 844, 'Citation preview must be clamped vertically.');

        await page.setViewportSize({ width: 1600, height: 1000 });
        await page.click('.crm-books-tab[data-books-tab="summary"]');
        await page.waitForSelector('.crm-books-outline');

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
