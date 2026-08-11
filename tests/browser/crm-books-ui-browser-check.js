const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = process.cwd();
const SCREENSHOT_PATH = path.join(ROOT, 'tmp', 'crm-books-ui-browser-check.png');
const PAGE_SCREENSHOT_PATH = path.join(ROOT, 'tmp', 'crm-books-page-formatting-browser-check.png');
const OUTLINE_SCREENSHOT_PATH = path.join(ROOT, 'tmp', 'crm-books-outline-browser-check.png');
const TURN_NEXT_SCREENSHOT_PATH = path.join(ROOT, 'tmp', 'crm-books-page-turn-next-browser-check.png');
const TURN_PREV_SCREENSHOT_PATH = path.join(ROOT, 'tmp', 'crm-books-page-turn-prev-browser-check.png');
const CITATION_SCREENSHOT_PATH = path.join(ROOT, 'tmp', 'crm-books-citation-highlight-browser-check.png');
const NOTE_SCREENSHOT_PATH = path.join(ROOT, 'tmp', 'crm-books-note-full-text-browser-check.png');

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
const LEGACY_CITATION_TEXT = 'Teachers need to understand\nthe content they are teaching.';
const LEGACY_CITATION_SNIPPET = 'ers need to understand\nthe content they are teaching.\n\nA second paragraph that is stored on the following page.';
const LONG_NOTE_TEXT = 'Functional load (FL) is defined as a measure of the amount of work done by two phonemes to distinguish words in a language. [C1] It serves as a promising method for teachers to determine which vowel and consonant mispronunciations are most likely to cause communication trouble. Research indicates that high FL sound pairs impact comprehensibility and accentedness significantly more than low FL pairs. For example, the pair has a high FL because it distinguishes many common words, whereas another pair has a low FL with few minimal pairs. By prioritizing high FL errors in the classroom, teachers can achieve greater improvements in how L2 speakers are understood, while ignoring low FL errors is unlikely to cause significant communication problems. Specific vowel contrasts also vary in functional load, such as bit/bat and beet/bit.';

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

        // setContent uses an opaque origin in Playwright. The real CRM page has
        // localStorage, so provide the smallest safe equivalent for this fixture.
        await page.addInitScript(installMemoryLocalStorage);
        await page.setContent(`
          <section class="crm-panel" data-panel="books" style="display:block; width:100%; height:100vh;">
            <div class="crm-books-workspace">
              <div class="crm-books-sources-panel">
                <div class="crm-books-sources-header"><button class="crm-books-sources-header-toggle" type="button" title="Collapse sources panel" aria-label="Collapse sources panel" aria-expanded="true">☰</button><h3>Sources</h3><span class="crm-books-sources-count">0</span></div>
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
        await page.addScriptTag({ path: path.join(ROOT, 'public', 'js', 'crm', 'books-workspace.js') });

        await page.evaluate(async ({ book, summary, existingThread, citedText, legacyCitationText, legacyCitationSnippet, longNoteText }) => {
            const panel = document.querySelector('[data-panel="books"]');
            const pages = Array.from({ length: book.pageCount }, (_, index) => {
                if (index < 2) return '';
                if (index === 7) {
                    return 'Chapter 1\nBasics of Teaching Pronunciation\nJohn M. Levis\nLearning Objectives\nTo describe what pronunciation features should be\ntaught\nTo explain why pronunciation should be taught.';
                }
                if (index === 8) {
                    return 'Outline\n1.1 Introduction 1.2 Elements of Pronunciation: The What of Pronunciation Teaching 1.3 Pronunciation Teaching Goals: The Why of Pronunciation Teaching 1.4 Successful Pronunciation Teaching: The How of Pronunciation Teaching 1.5 Representing sounds in English';
                }
                if (index === 51) return legacyCitationText;
                if (index === 52) return 'A second paragraph that is stored on the following page.';
                return index === 11 ? `Reading page 12.\n\n${citedText}` : `Reading page ${index + 1}.`;
            });
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
                                text: `It recommends naming the assumptions behind a decision before choosing an action. [C1] Teachers should also understand their teaching content. [C2]`,
                                answered: true,
                                citations: [
                                    { marker: 'C1', pageStart: 12, pageEnd: 12, snippet: citedText, highlightText: citedText },
                                    { marker: 'C2', pageStart: 52, pageEnd: 53, snippet: legacyCitationSnippet }
                                ]
                            }
                        ]
                    };
                }
                if (requestPath === `/api/admin/books/${book.bookId}/threads/thread-new/messages` && method === 'POST') {
                    return {
                        userMessage: { role: 'user', text: body.text, citations: [] },
                        assistantMessage: {
                            role: 'assistant',
                            text: longNoteText,
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
                if (requestPath === `/api/admin/books/${book.bookId}/source`) {
                    return { downloadUrl: 'data:application/pdf;base64,JVBERi0xLjQK', filename: 'source.pdf' };
                }
                if (requestPath === `/api/admin/books/${book.bookId}/pages`) {
                    return { totalPages: pages.length, pages };
                }
                if (requestPath === `/api/admin/books/${book.bookId}/notes` && method === 'POST') {
                    return { note: { id: 'note-1', text: body.text, savedAt: Date.now() } };
                }
                if (requestPath === `/api/admin/books/${book.bookId}/notes` && method === 'GET') {
                    return { notes: [] };
                }
                if (requestPath.startsWith(`/api/admin/books/${book.bookId}/notes/`) && method === 'DELETE') {
                    return {};
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
        }, {
            book: BOOK,
            summary: SUMMARY,
            existingThread: EXISTING_THREAD,
            citedText: CITED_TEXT,
            legacyCitationText: LEGACY_CITATION_TEXT,
            legacyCitationSnippet: LEGACY_CITATION_SNIPPET,
            longNoteText: LONG_NOTE_TEXT
        });

        await page.waitForSelector('.crm-books-list-item[data-book-id="book-1"]');
        await page.waitForSelector('.crm-books-sources-header-toggle');
        await page.click('.crm-books-sources-header-toggle');
        const collapsedSources = await page.evaluate(() => {
            const workspace = document.querySelector('.crm-books-workspace');
            const toggle = document.querySelector('.crm-books-sources-header-toggle');
            const sourcePanel = document.querySelector('.crm-books-sources-panel');
            return {
                grid: getComputedStyle(workspace).gridTemplateColumns,
                toggleWidth: toggle.getBoundingClientRect().width,
                sourcePanelWidth: sourcePanel.getBoundingClientRect().width
            };
        });
        assert.match(collapsedSources.grid, /^44px\s+/i, `Collapsed Sources should retain a visible rail: ${collapsedSources.grid}`);
        assert.ok(collapsedSources.toggleWidth > 0, 'Sources collapse control must remain visible when collapsed.');
        assert.ok(collapsedSources.sourcePanelWidth > 0, 'Collapsed Sources should retain the control rail width.');
        await page.click('.crm-books-sources-header-toggle');

        await page.click('.crm-books-download-btn');
        await page.waitForFunction(() => window.__crmBookRequests.some((request) => request.path === '/api/admin/books/book-1/source'));

        await page.click('.crm-books-tab[data-books-tab="pages"]');
        await page.waitForSelector('.crm-books-page-paper');
        assert.strictEqual(await page.locator('.crm-books-page-input').inputValue(), '3', 'Pages should open on the first physical page containing text.');

        const defaultReaderFontSize = await page.locator('.crm-books-page-content').evaluate((content) => Number.parseFloat(getComputedStyle(content).fontSize));
        assert.strictEqual(await page.locator('.crm-books-font-scale').count(), 1, 'Pages should expose one reader font-size slider.');
        assert.strictEqual(await page.locator('.crm-books-font-scale-output').textContent(), '100%', 'Reader font-size output should show the default scale.');

        // The reader scale is a Book-level preference, so changing it in Pages
        // must also resize the text rendered by every other Book tab.
        await page.click('.crm-books-tab[data-books-tab="summary"]');
        await page.waitForSelector('.crm-books-mode-card[data-summary-mode="whole"]');
        await page.click('.crm-books-mode-card[data-summary-mode="whole"]');
        await page.waitForSelector('.crm-books-overview');
        const defaultSummaryFontSize = await page.locator('.crm-books-overview').evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
        await page.click('.crm-books-tab[data-books-tab="chat"]');
        await page.waitForSelector('.crm-books-chat-starters');
        const defaultChatFontSize = await page.locator('.crm-books-starters-label').evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
        await page.click('.crm-books-tab[data-books-tab="history"]');
        await page.waitForSelector('.crm-books-history-row');
        const defaultHistoryFontSize = await page.locator('.crm-books-history-row-title').first().evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
        await page.click('.crm-books-tab[data-books-tab="notes"]');
        await page.waitForSelector('.crm-books-notes-empty');
        const defaultNotesFontSize = await page.locator('.crm-books-notes-empty').evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));

        await page.click('.crm-books-tab[data-books-tab="pages"]');
        await page.locator('.crm-books-font-scale').fill('140');
        const enlargedReader = await page.evaluate(() => ({
            output: document.querySelector('.crm-books-font-scale-output')?.textContent || '',
            fontSize: Number.parseFloat(getComputedStyle(document.querySelector('.crm-books-page-content')).fontSize)
        }));
        assert.strictEqual(enlargedReader.output, '140%', 'Reader font-size output should update with the slider.');
        assert.ok(enlargedReader.fontSize > defaultReaderFontSize, 'Reader font-size slider should enlarge the extracted page text.');

        await page.click('.crm-books-tab[data-books-tab="summary"]');
        const scaledSummaryFontSize = await page.locator('.crm-books-overview').evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
        await page.click('.crm-books-tab[data-books-tab="chat"]');
        const scaledChatFontSize = await page.locator('.crm-books-starters-label').evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
        await page.click('.crm-books-tab[data-books-tab="history"]');
        const scaledHistoryFontSize = await page.locator('.crm-books-history-row-title').first().evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
        await page.click('.crm-books-tab[data-books-tab="notes"]');
        const scaledNotesFontSize = await page.locator('.crm-books-notes-empty').evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
        assert.ok(scaledSummaryFontSize > defaultSummaryFontSize * 1.25, 'Reader font-size slider should enlarge Summary text.');
        assert.ok(scaledChatFontSize > defaultChatFontSize * 1.25, 'Reader font-size slider should enlarge Chat text.');
        assert.ok(scaledHistoryFontSize > defaultHistoryFontSize * 1.25, 'Reader font-size slider should enlarge Chat History text.');
        assert.ok(scaledNotesFontSize > defaultNotesFontSize * 1.25, 'Reader font-size slider should enlarge Notes text.');

        await page.click('.crm-books-tab[data-books-tab="pages"]');
        await page.waitForSelector('.crm-books-page-paper');

        const nextTurnStarted = page.waitForFunction(() => document.querySelector('.crm-books-page-stage')?.classList.contains('turning-next'));
        await page.locator('.crm-books-page-next').click();
        await nextTurnStarted;
        const nextMidTurn = await page.evaluate(() => {
            const stage = document.querySelector('.crm-books-page-stage');
            const outgoing = stage?.querySelector('.crm-books-page-sheet.is-outgoing');
            const incoming = stage?.querySelector('.crm-books-page-sheet.is-incoming');
            const nextButton = document.querySelector('.crm-books-page-next');
            return {
                sheetCount: stage?.querySelectorAll('.crm-books-page-sheet').length || 0,
                turning: stage?.classList.contains('turning-next') || false,
                outgoingOrigin: outgoing ? getComputedStyle(outgoing).transformOrigin : '',
                incomingPage: incoming?.dataset.pageNumber || '',
                nextDisabled: !!nextButton?.disabled
            };
        });
        assert.strictEqual(nextMidTurn.sheetCount, 2, 'Next should layer outgoing and incoming page sheets.');
        assert.strictEqual(nextMidTurn.turning, true, 'Next should apply the forward turn direction class.');
        assert.match(nextMidTurn.outgoingOrigin, /^0px\s+/i, `Next should pivot from the left spine: ${nextMidTurn.outgoingOrigin}`);
        assert.strictEqual(nextMidTurn.incomingPage, '4', 'Next should stage the adjacent readable page.');
        assert.strictEqual(nextMidTurn.nextDisabled, true, 'Prev/Next controls should be disabled during a turn.');
        await page.evaluate(() => {
            const outgoing = document.querySelector('.crm-books-page-sheet.is-outgoing');
            outgoing?.dispatchEvent(new AnimationEvent('animationend', {
                bubbles: true,
                animationName: 'crmBooksPageCurlNext'
            }));
        });
        assert.ok(await page.locator('.crm-books-page-stage').evaluate((stage) => stage.classList.contains('turning-next')), 'A decorative animation event must not finish the page turn.');
        assert.strictEqual(await page.locator('.crm-books-page-input').inputValue(), '3', 'A decorative animation event must not commit the incoming page.');
        await page.waitForTimeout(180);
        await page.screenshot({ path: TURN_NEXT_SCREENSHOT_PATH, fullPage: true });
        await page.waitForFunction(() => !document.querySelector('.crm-books-page-stage')?.classList.contains('turning-next'));
        assert.strictEqual(await page.locator('.crm-books-page-input').inputValue(), '4', 'Next should commit the target page after the turn.');
        await page.waitForTimeout(20);
        assert.ok(await page.evaluate(() => document.activeElement?.classList.contains('crm-books-page-next')), 'Next should restore focus to its navigation control.');
        assert.strictEqual(await page.locator('.crm-books-page-turn-status').textContent(), 'Page 4 of 315', 'Next should announce the committed page.');

        const rapidTurnStarted = page.waitForFunction(() => document.querySelector('.crm-books-page-stage')?.classList.contains('turning-next'));
        await page.evaluate(() => {
            const button = document.querySelector('.crm-books-page-next');
            button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        await rapidTurnStarted;
        await page.waitForFunction(() => !document.querySelector('.crm-books-page-stage')?.classList.contains('turning-next'));
        assert.strictEqual(await page.locator('.crm-books-page-input').inputValue(), '5', 'Rapid repeated clicks should produce only one forward navigation.');

        const prevTurnStarted = page.waitForFunction(() => document.querySelector('.crm-books-page-stage')?.classList.contains('turning-prev'));
        await page.locator('.crm-books-page-prev').click();
        await prevTurnStarted;
        const prevMidTurn = await page.evaluate(() => {
            const stage = document.querySelector('.crm-books-page-stage');
            const incoming = stage?.querySelector('.crm-books-page-sheet.is-incoming');
            return {
                sheetCount: stage?.querySelectorAll('.crm-books-page-sheet').length || 0,
                turning: stage?.classList.contains('turning-prev') || false,
                incomingOrigin: incoming ? getComputedStyle(incoming).transformOrigin : '',
                incomingWidth: incoming?.getBoundingClientRect().width || 0,
                incomingPage: incoming?.dataset.pageNumber || ''
            };
        });
        assert.strictEqual(prevMidTurn.sheetCount, 2, 'Prev should layer outgoing and incoming page sheets.');
        assert.strictEqual(prevMidTurn.turning, true, 'Prev should apply the backward turn direction class.');
        const prevOriginX = Number.parseFloat(prevMidTurn.incomingOrigin);
        assert.ok(prevOriginX >= prevMidTurn.incomingWidth - 1, `Prev should pivot from the right spine: ${prevMidTurn.incomingOrigin}`);
        assert.strictEqual(prevMidTurn.incomingPage, '4', 'Prev should stage the adjacent readable page.');
        await page.waitForTimeout(180);
        await page.screenshot({ path: TURN_PREV_SCREENSHOT_PATH, fullPage: true });
        await page.waitForFunction(() => !document.querySelector('.crm-books-page-stage')?.classList.contains('turning-prev'));
        assert.strictEqual(await page.locator('.crm-books-page-input').inputValue(), '4', 'Prev should commit the target page after the turn.');

        const interruptedTurnStarted = page.waitForFunction(() => document.querySelector('.crm-books-page-stage')?.classList.contains('turning-next'));
        await page.locator('.crm-books-page-next').click();
        await interruptedTurnStarted;
        await page.locator('.crm-books-dark-toggle').click();
        await page.waitForTimeout(750);
        assert.strictEqual(await page.locator('.crm-books-page-input').inputValue(), '4', 'An unrelated Books rerender should cancel the turn without a delayed page commit.');
        assert.strictEqual(await page.locator('.crm-books-page-next').isDisabled(), false, 'Cancelled turns should restore navigation controls.');
        assert.strictEqual(await page.locator('.crm-books-page-stage .crm-books-page-sheet').count(), 1, 'Cancelled turns should restore one canonical page sheet.');
        await page.locator('.crm-books-dark-toggle').click();

        const invalidJumpTurnStarted = page.waitForFunction(() => document.querySelector('.crm-books-page-stage')?.classList.contains('turning-next'));
        await page.locator('.crm-books-page-next').click();
        await invalidJumpTurnStarted;
        await page.locator('.crm-books-page-input').fill('999');
        await page.locator('.crm-books-page-input').dispatchEvent('change');
        assert.strictEqual(await page.locator('.crm-books-page-input').inputValue(), '4', 'Invalid page input should retain the current page.');
        assert.strictEqual(await page.locator('.crm-books-page-next').isDisabled(), false, 'Invalid page input should not leave navigation controls disabled.');
        assert.strictEqual(await page.locator('.crm-books-page-stage .crm-books-page-sheet').count(), 1, 'Invalid page input should cancel temporary page layers.');

        await page.locator('.crm-books-page-input').fill('7');
        await page.locator('.crm-books-page-input').dispatchEvent('change');
        assert.strictEqual(await page.locator('.crm-books-page-input').inputValue(), '7', 'Direct page input should jump immediately.');
        const directNavigationState = await page.evaluate(() => ({
            turning: !!document.querySelector('.crm-books-page-stage.turning-next, .crm-books-page-stage.turning-prev'),
            sheetCount: document.querySelectorAll('.crm-books-page-stage .crm-books-page-sheet').length
        }));
        assert.strictEqual(directNavigationState.turning, false, 'Direct page input should remain immediate.');
        assert.strictEqual(directNavigationState.sheetCount, 1, 'Direct page input should not create animated layers.');

        const variedTurnStarted = page.waitForFunction(() => document.querySelector('.crm-books-page-stage')?.classList.contains('turning-next'));
        await page.locator('.crm-books-page-next').click();
        await variedTurnStarted;
        const variedTurnLayout = await page.evaluate(() => {
            const stage = document.querySelector('.crm-books-page-stage');
            const sheets = Array.from(stage?.querySelectorAll('.crm-books-page-sheet') || []);
            return {
                stageHeight: stage?.getBoundingClientRect().height || 0,
                sheetHeights: sheets.map((sheet) => sheet.getBoundingClientRect().height),
                documentWidth: document.documentElement.scrollWidth,
                viewport: window.innerWidth
            };
        });
        assert.ok(variedTurnLayout.stageHeight >= Math.max(...variedTurnLayout.sheetHeights) - 1, 'The page stage should lock to the taller sheet during a turn.');
        assert.ok(variedTurnLayout.documentWidth <= variedTurnLayout.viewport + 1, 'A page turn must not introduce horizontal overflow.');
        await page.waitForFunction(() => !document.querySelector('.crm-books-page-stage')?.classList.contains('turning-next'));
        assert.strictEqual(await page.locator('.crm-books-page-input').inputValue(), '8', 'The taller page should commit after the turn.');
        await page.waitForSelector('.crm-books-page-content ul');
        assert.strictEqual(await page.locator('.crm-books-page-content li').count(), 2, 'Extracted objective lines should render as list items.');
        assert.match(await page.locator('.crm-books-page-content').textContent(), /To describe what pronunciation features should be taught/, 'Wrapped objective text should remain readable.');
        await page.screenshot({ path: PAGE_SCREENSHOT_PATH, fullPage: true });

        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.locator('.crm-books-page-next').click();
        assert.strictEqual(await page.locator('.crm-books-page-input').inputValue(), '9', 'Reduced-motion navigation should complete immediately.');
        const reducedMotionState = await page.evaluate(() => ({
            turning: !!document.querySelector('.crm-books-page-stage.turning-next, .crm-books-page-stage.turning-prev'),
            sheetCount: document.querySelectorAll('.crm-books-page-stage .crm-books-page-sheet').length
        }));
        assert.strictEqual(reducedMotionState.turning, false, 'Reduced-motion navigation should not leave a turn in progress.');
        assert.strictEqual(reducedMotionState.sheetCount, 1, 'Reduced-motion navigation should render one canonical sheet.');
        assert.strictEqual(await page.locator('.crm-books-page-list-marker').count(), 5, 'Inline outline numbering should render as five visible list markers.');
        assert.strictEqual(await page.locator('.crm-books-page-content li').count(), 5, 'Inline outline entries should render as separate list items.');
        assert.strictEqual(await page.locator('.crm-books-page-list-marker').first().textContent(), '1.1', 'The first outline number should remain visible.');
        await page.screenshot({ path: OUTLINE_SCREENSHOT_PATH, fullPage: true });
        await page.emulateMedia({ reducedMotion: 'no-preference' });

        await page.click('.crm-books-tab[data-books-tab="chat"]');
        await page.waitForSelector('.crm-books-tab-body.chat-active');
        await page.waitForSelector('.crm-books-composer');
        assert.strictEqual(await page.locator('.crm-books-msg-assistant').count(), 0, 'Opening Chat should show a blank draft, not the newest saved thread.');

        const blankChatLayout = await page.evaluate(() => {
            const header = document.querySelector('.crm-books-chat-header');
            const composer = document.querySelector('.crm-books-composer');
            const starters = document.querySelector('.crm-books-chat-starters');
            return {
                composerTop: composer.getBoundingClientRect().top,
                headerBottom: header.getBoundingClientRect().bottom,
                startersTop: starters.getBoundingClientRect().top
            };
        });
        assert.ok(blankChatLayout.composerTop >= blankChatLayout.headerBottom, 'Chat composer should be below the New chat header.');
        assert.ok(blankChatLayout.composerTop < blankChatLayout.startersTop, 'Chat composer should be above the starter questions.');

        const blankComposer = await page.locator('.crm-books-composer-input').inputValue();
        assert.strictEqual(blankComposer, '', 'New-chat composer should start empty.');
        assert.strictEqual(await page.locator('.crm-books-chat-draft-title').count(), 1, 'Blank Chat should show a draft title.');

        await page.locator('.crm-books-composer-input').fill('What should I check before making a decision?');
        await page.click('.crm-books-send-btn');
        await page.waitForSelector('.crm-books-msg-assistant');
        assert.strictEqual(await page.locator('.crm-books-msg-user').count(), 1, 'First send should create one user message.');
        assert.strictEqual(await page.locator('.crm-books-msg-assistant').count(), 1, 'First send should create one assistant answer.');
        assert.strictEqual(await page.locator('.crm-books-thread-title-text').textContent(), 'What should I check before making a decision?', 'Thread title should derive from the first question.');

        await page.locator('.crm-books-msg-save-btn').click();
        await page.click('.crm-books-tab[data-books-tab="notes"]');
        await page.waitForSelector('.crm-books-note-card-text');
        const savedNote = await page.locator('.crm-books-note-card-text').first().evaluate((element) => {
            const styles = getComputedStyle(element);
            return {
                text: element.textContent || '',
                lineClamp: styles.webkitLineClamp,
                overflow: styles.overflow,
                scrollHeight: element.scrollHeight,
                clientHeight: element.clientHeight
            };
        });
        assert.match(savedNote.text, /Specific vowel contrasts also vary in functional load/, 'Saved Notes should retain the end of a long chat response.');
        assert.notStrictEqual(savedNote.lineClamp, '6', 'Saved Notes should not use a six-line CSS clamp.');
        assert.notStrictEqual(savedNote.overflow, 'hidden', 'Saved Notes should not hide overflow from the full response.');
        assert.ok(savedNote.scrollHeight <= savedNote.clientHeight + 1, 'Saved Notes should display all of the note text.');
        await page.screenshot({ path: NOTE_SCREENSHOT_PATH, fullPage: true });
        await page.click('.crm-books-tab[data-books-tab="chat"]');
        await page.waitForSelector('.crm-books-tab-body.chat-active');

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

        // Legacy saved citations may have only a multi-page snippet. Resolve and
        // highlight an exact fragment instead of showing an unavailable error.
        await page.click('.crm-books-tab[data-books-tab="chat"]');
        await page.locator('.crm-books-citation-ref[data-citation-marker="C2"]').first().click();
        await page.waitForSelector('.crm-books-citation-highlight');
        assert.strictEqual(await page.locator('.crm-books-page-input').inputValue(), '52', 'Legacy citation should navigate to the physical page containing its snippet fragment.');
        assert.match(await page.locator('.crm-books-citation-highlight').textContent(), /ers need to understand the content they are teaching\./, 'Legacy citation should visibly highlight the matched fragment.');
        assert.doesNotMatch(await page.locator('.crm-books-page-notice').textContent(), /unavailable/i, 'A valid legacy citation should not show an unavailable-passage error.');
        await page.screenshot({ path: CITATION_SCREENSHOT_PATH, fullPage: true });

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
