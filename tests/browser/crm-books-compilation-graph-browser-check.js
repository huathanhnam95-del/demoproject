/*
 * UI22 focused Books browser acceptance.
 *
 * This test uses the authoritative crm-admin Books panel and the installed
 * Chrome channel with fixture-only API responses. All reports and downloads
 * are written outside the repository through BOOKS_OUTPUT_DIR.
 */
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');

const REPO_ROOT = path.resolve(process.env.BOOKS_REPO_ROOT || path.join(__dirname, '..', '..'));
const OUTPUT_DIR = path.resolve(process.env.BOOKS_OUTPUT_DIR || path.join(os.tmpdir(), `codex-books-ui22-${process.pid}`));
const REPO_PREFIX = `${REPO_ROOT}${path.sep}`;
if (OUTPUT_DIR === REPO_ROOT || OUTPUT_DIR.startsWith(REPO_PREFIX)) {
    throw new Error(`Refusing to write Books evidence in the repository: ${OUTPUT_DIR}`);
}
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const SOURCE_PATHS = {
    js: path.join(REPO_ROOT, 'public', 'js', 'crm', 'books-workspace.js'),
    html: path.join(REPO_ROOT, 'public', 'crm-admin.html'),
    css: path.join(REPO_ROOT, 'public', 'crm-admin.css')
};

function sha256(filePath) {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

function sourceFixture() {
    const html = fs.readFileSync(SOURCE_PATHS.html, 'utf8');
    const start = html.indexOf('<section class="crm-panel" data-panel="books"');
    const end = html.indexOf('</section>', start);
    assert.ok(start >= 0 && end > start, 'Authoritative Books panel must be present.');
    return {
        panelMarkup: html.slice(start, end + '</section>'.length).replace('style="display: none;"', 'style="display: block;"'),
        css: fs.readFileSync(SOURCE_PATHS.css, 'utf8'),
        js: fs.readFileSync(SOURCE_PATHS.js, 'utf8')
    };
}

function installMemoryLocalStorage() {
    const values = new Map();
    Object.defineProperty(window, 'localStorage', {
        configurable: true,
        value: {
            getItem: (key) => values.has(key) ? values.get(key) : null,
            setItem: (key, value) => values.set(key, String(value)),
            removeItem: (key) => values.delete(key),
            clear: () => values.clear(),
            key: (index) => Array.from(values.keys())[index] || null,
            get length() { return values.size; }
        }
    });
}

const BOOKS = [
    { bookId: 'book-1', title: 'The Practice of Clear Thinking', author: 'Maya Chen', pageCount: 4, status: 'ready', ingest: null },
    { bookId: 'book-2', title: 'Teaching Pronunciation Clearly', author: 'John Levis', pageCount: 2, status: 'ready', ingest: null }
];
const PAGES = [
    'Chapter 1\nName the assumptions before selecting the next action.\nA fixture passage for the Books UI.',
    'Chapter 2\nUse evidence before deciding which path to take.',
    'Chapter 3\nA second page keeps page navigation real.',
    'Chapter 4\nEnd of the synthetic source.'
];
const NOTES = [{ id: 'note-1', text: '# Assumptions to revisit\n\nName the assumptions before selecting the next action.', savedAt: 1725700000000 }];
const SUMMARY = {
    oneLiner: 'A fixture summary for testing actual Books controls.',
    overview: 'The text explains assumptions and evidence.',
    audience: 'Readers who want a repeatable decision process.',
    keyTopics: [{ topic: 'assumptions', pages: [1] }],
    outline: [{ title: 'Start with the question', pageStart: 1, pageEnd: 4, children: [] }]
};

function fixtureControllerScript() {
    return async function installFixture(input) {
        const panel = document.querySelector('[data-panel="books"]');
        const state = {
            compileCalls: 0,
            compileSecondDelay: 250,
            compileCloseReopenDelay: 250,
            graphCalls: 0,
            graphRetryDelay: 100,
            graphMode: 'success-links',
            links: [],
            mockedStatuses: [],
            requests: []
        };
        window.__ui22Fixture = state;
        const bookById = (id) => input.books.find((book) => book.bookId === id);
        const rejectWithStatus = (requestPath, method, message, status) => {
            state.mockedStatuses.push({ path: requestPath, method, status });
            const error = new Error(message);
            error.status = status;
            throw error;
        };
        const request = async (requestPath, options = {}) => {
            const method = options.method || 'GET';
            const body = options.body ? JSON.parse(options.body) : null;
            state.requests.push({ path: requestPath, method, body });
            if (requestPath === '/api/admin/books/ensure-seed' && method === 'POST') return { ok: true };
            if (requestPath === '/api/admin/books/usage') return { estimatedCostUsd: 0, budgetLimitUsd: 10, approved: true };
            if (requestPath === '/api/admin/book-collections') return { collections: [] };
            if (requestPath === '/api/admin/book-tags') return { tags: [] };
            if (requestPath === '/api/admin/books') return { books: input.books };
            if (/^\/api\/admin\/books\/[^/]+$/.test(requestPath)) {
                const id = requestPath.split('/').pop();
                const book = bookById(id);
                if (!book) throw new Error(`Unknown fixture book: ${id}`);
                return { book, summary: input.summary };
            }
            if (/^\/api\/admin\/books\/[^/]+\/threads$/.test(requestPath)) return { threads: [] };
            if (/^\/api\/admin\/books\/[^/]+\/pages$/.test(requestPath)) return { totalPages: input.pages.length, pages: input.pages };
            if (/^\/api\/admin\/books\/[^/]+\/notes$/.test(requestPath) && method === 'GET') return { notes: [] };
            if (/^\/api\/admin\/books\/[^/]+\/notes$/.test(requestPath) && method === 'POST') return { note: { id: 'note-created', text: body?.text || '', savedAt: Date.now() } };
            if (requestPath === '/api/admin/book-links' && method === 'GET') {
                state.graphCalls += 1;
                if (state.graphMode === 'delayed-stale' && state.graphCalls === 1) {
                    await new Promise((resolve) => setTimeout(resolve, 250));
                    return { links: [{ id: 'stale-link', fromBookId: 'book-1', toBookId: 'book-2', label: 'stale response' }] };
                }
                if (state.graphMode === 'error-once' && state.graphCalls === 1) return rejectWithStatus(requestPath, method, 'Synthetic Knowledge Graph service failure', 403);
                if (state.graphMode === 'error-once' && state.graphCalls === 2) await new Promise((resolve) => setTimeout(resolve, state.graphRetryDelay));
                return { links: state.links.slice() };
            }
            if (requestPath === '/api/admin/book-links' && method === 'POST') {
                const id = `link-${state.links.length + 1}`;
                state.links.push({ id, fromBookId: body?.fromBookId, toBookId: body?.toBookId, label: body?.label || '' });
                return { id };
            }
            if (/^\/api\/admin\/book-links\/[^/]+$/.test(requestPath) && method === 'DELETE') {
                const id = requestPath.split('/').pop();
                state.links = state.links.filter((link) => link.id !== id);
                return { ok: true };
            }
            if (/^\/api\/admin\/books\/[^/]+\/compile$/.test(requestPath) && method === 'POST') {
                state.compileCalls += 1;
                if (state.compileCalls === 1) return { markdown: '# First Compilation\n\nInitial artifact.' };
                if (state.compileCalls === 2) {
                    await new Promise((resolve) => setTimeout(resolve, state.compileSecondDelay));
                    return rejectWithStatus(requestPath, method, 'Synthetic compilation service failure', 403);
                }
                if (state.compileCalls === 3) return { markdown: '# Recovery Compilation\n\nFresh artifact after retry.' };
                if (state.compileCalls === 4) {
                    await new Promise((resolve) => setTimeout(resolve, state.compileCloseReopenDelay));
                    return { markdown: '# Stale Closed Modal Response\n\nThis response must not replace the reopened modal.' };
                }
                if (state.compileCalls === 5) return { markdown: '# Reopened Fresh Compilation\n\nFresh artifact in the reopened modal.' };
                return { markdown: '# Recovery Compilation\n\nFresh artifact after retry.' };
            }
            throw new Error(`Unexpected Books request: ${method} ${requestPath}`);
        };
        window.__ui22Requests = state.requests;
        window.__ui22Controller = window.CrmBooksWorkspace.createController({
            elements: { booksPanel: panel },
            apiFetchJson: request,
            showToast: (message, level) => {
                window.__ui22Toasts = window.__ui22Toasts || [];
                window.__ui22Toasts.push({ message, level });
            },
            firebase: null
        });
        window.localStorage.setItem('crm_books_notes_book-1', JSON.stringify(input.notes));
        window.localStorage.setItem('crm_books_highlights_book-1', JSON.stringify({ '1': [{ text: 'Name the assumptions', color: '#fef08a' }] }));
        await window.__ui22Controller.init();
        await window.__ui22Controller.selectBook('book-1');
        await new Promise((resolve) => setTimeout(resolve, 50));
    };
}

async function setupPage(browser, source, viewport) {
    const page = await browser.newPage({ viewport, acceptDownloads: true });
    const externalRequests = [];
    const pageErrors = [];
    const consoleErrors = [];
    page.on('request', (request) => {
        if (/^https?:/i.test(request.url())) externalRequests.push(request.url());
    });
    // Attach diagnostics before any fixture HTML, CSS, or production script is
    // evaluated so setup-time failures cannot be missed.
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    await page.route('**/*', async (route) => {
        const url = route.request().url();
        if (/^https?:/i.test(url)) return route.abort();
        return route.continue();
    });
    await page.addInitScript({ content: `(${installMemoryLocalStorage.toString()})();` });
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;min-height:100%;}body{background:#f8fafc;}</style></head><body><main>${source.panelMarkup}</main></body></html>`);
    await page.evaluate(installMemoryLocalStorage);
    await page.addStyleTag({ content: source.css });
    await page.addScriptTag({ content: source.js });
    await page.evaluate(`(${fixtureControllerScript().toString()})(${JSON.stringify({ books: BOOKS, pages: PAGES, notes: NOTES, summary: SUMMARY })})`);
    return { page, externalRequests, pageErrors, consoleErrors };
}

async function compilationCase(browser, source, viewportName, viewport) {
    const { page, externalRequests, pageErrors, consoleErrors } = await setupPage(browser, source, viewport);
    const checks = [];
    const downloads = [];
    const check = (condition, name, details) => checks.push({ name, pass: Boolean(condition), ...(details ? { details } : {}) });
    try {
        await page.locator('.crm-books-tab[data-books-tab="notes"]').click();
        await page.locator('.crm-books-compile-open-btn').click();
        check(await page.locator('input[data-compile-type="note"]').count() >= 1, 'compile-note-source-visible');
        await page.locator('.crm-books-compile-run').click();
        await page.waitForSelector('.crm-books-compile-result', { timeout: 2000 });
        const first = await page.locator('.crm-books-compile-preview').getAttribute('data-compiled-markdown');
        check(first === '# First Compilation\n\nInitial artifact.', 'first-compilation-artifact', { value: first, compileCalls: await page.evaluate(() => window.__ui22Fixture.compileCalls) });

        // The second call is a failed retry. The old artifact must be gone and
        // the disabled Download button must not expose it.
        await page.locator('.crm-books-compile-run').click();
        await page.waitForTimeout(20);
        const whilePending = await page.locator('.crm-books-compile-preview').evaluate((element) => ({
            markdown: element.dataset.compiledMarkdown || '',
            loading: element.querySelector('[role="status"]')?.textContent || '',
            downloadDisabled: !!element.closest('.crm-books-compile-overlay')?.querySelector('.crm-books-compile-download')?.disabled
        }));
        check(whilePending.downloadDisabled && !whilePending.markdown && /synthesizing/i.test(whilePending.loading), 'pending-retry-clears-download-artifact', whilePending);
        await page.waitForFunction(() => /Compilation failed/i.test(document.querySelector('.crm-books-compile-preview')?.textContent || ''), null, { timeout: 2000 });
        const afterFailure = await page.locator('.crm-books-compile-preview').evaluate((element) => ({
            markdown: element.dataset.compiledMarkdown || '',
            error: element.textContent || '',
            downloadDisabled: !!element.closest('.crm-books-compile-overlay')?.querySelector('.crm-books-compile-download')?.disabled
        }));
        const compilation403 = await page.evaluate(() => window.__ui22Fixture.mockedStatuses.find((item) => item.path.endsWith('/compile')) || null);
        check(compilation403?.status === 403, 'compilation-denial-status-403-recorded', compilation403);
        check(afterFailure.downloadDisabled && !afterFailure.markdown, 'failed-retry-clears-download-artifact', afterFailure);

        // A later successful retry must produce and download a fresh artifact.
        await page.locator('.crm-books-compile-run').click();
        await page.waitForFunction(() => /Recovery Compilation/i.test(document.querySelector('.crm-books-compile-result')?.textContent || ''), null, { timeout: 2000 });
        const downloadPromise = page.waitForEvent('download');
        await page.locator('.crm-books-compile-download').click();
        const download = await downloadPromise;
        const outputPath = path.join(OUTPUT_DIR, `compilation-recovery-${viewportName}.md`);
        await download.saveAs(outputPath);
        downloads.push(outputPath);
        check(fs.readFileSync(outputPath, 'utf8') === '# Recovery Compilation\n\nFresh artifact after retry.', 'recovery-download-is-fresh', { outputPath });

        // An old response must not repopulate a newly opened modal after the
        // original modal was closed while its request was still pending.
        await page.locator('.crm-books-compile-close').click();
        await page.locator('.crm-books-compile-open-btn').click();
        await page.locator('.crm-books-compile-run').click();
        await page.waitForTimeout(20);
        await page.locator('.crm-books-compile-close').click();
        await page.locator('.crm-books-compile-open-btn').click();
        await page.locator('.crm-books-compile-run').click();
        await page.waitForFunction(() => /Reopened Fresh Compilation/i.test(document.querySelector('.crm-books-compile-result')?.textContent || ''), null, { timeout: 2000 });
        await page.waitForTimeout(320);
        const reopenedText = await page.locator('.crm-books-compile-result').textContent();
        check(/Reopened Fresh Compilation/i.test(reopenedText || '') && !/Stale Closed Modal Response/i.test(reopenedText || ''), 'closed-request-cannot-replace-reopened-artifact', { reopenedText });
    } catch (error) {
        checks.push({ name: 'compilation-case-exception', pass: false, details: error.stack || String(error) });
    } finally {
        await page.close().catch(() => {});
    }
    checks.push({ name: 'no-page-errors', pass: pageErrors.length === 0, details: pageErrors });
    checks.push({ name: 'no-console-errors', pass: consoleErrors.length === 0, details: consoleErrors });
    return { viewport: viewportName, area: 'compilation', checks, downloads, externalRequests, pageErrors, consoleErrors };
}

async function graphCase(browser, source, viewportName, viewport) {
    const { page, externalRequests, pageErrors, consoleErrors } = await setupPage(browser, source, viewport);
    const checks = [];
    const check = (condition, name, details) => checks.push({ name, pass: Boolean(condition), ...(details ? { details } : {}) });
    const visible = async (selector) => page.locator(selector).first().isVisible().catch(() => false);
    try {
        // Delayed first response is followed by close/reopen. The stale first
        // response must not replace the second, successful empty graph.
        await page.evaluate(() => { window.__ui22Fixture.graphMode = 'delayed-stale'; window.__ui22Fixture.graphCalls = 0; window.__ui22Fixture.links = []; });
        await page.locator('.crm-books-kg-open-btn').click();
        check(await visible('.crm-books-kg-overlay'), 'graph-overlay-opens-before-request');
        check(await visible('.crm-books-kg-loading'), 'graph-loading-state-visible');
        check(await page.evaluate(() => document.activeElement?.classList.contains('crm-books-kg-close')), 'graph-loading-focuses-close-control');
        await page.locator('.crm-books-kg-close').click();
        await page.locator('.crm-books-kg-open-btn').click();
        await page.waitForSelector('.crm-books-kg-empty', { timeout: 2000 });
        await page.waitForTimeout(320);
        check(await page.locator('.crm-books-kg-link-item').count() === 0, 'stale-graph-response-does-not-render-after-reopen');
        check(await visible('.crm-books-kg-empty'), 'successful-empty-graph-state-visible');

        // Failed links must remain a visible error state with a real Retry;
        // retrying recovers to a distinct successful empty state.
        await page.locator('.crm-books-kg-close').click();
        await page.evaluate(() => { window.__ui22Fixture.graphMode = 'error-once'; window.__ui22Fixture.graphCalls = 0; });
        await page.locator('.crm-books-kg-open-btn').click();
        await page.waitForSelector('.crm-books-kg-error', { timeout: 2000 });
        check(await visible('.crm-books-kg-error'), 'graph-error-state-visible');
        check(await page.locator('.crm-books-kg-retry').count() === 1, 'graph-error-retry-control-visible');
        const graph403 = await page.evaluate(() => window.__ui22Fixture.mockedStatuses.find((item) => item.path === '/api/admin/book-links') || null);
        check(graph403?.status === 403, 'graph-denial-status-403-recorded', graph403);
        await page.locator('.crm-books-kg-retry').focus();
        check(await page.evaluate(() => document.activeElement?.classList.contains('crm-books-kg-retry')), 'graph-error-focuses-retry-control');
        await page.keyboard.press('Enter');
        check(await visible('.crm-books-kg-loading'), 'graph-retry-keyboard-opens-loading');
        check(await page.evaluate(() => document.activeElement?.classList.contains('crm-books-kg-close')), 'graph-retry-loading-focuses-close-control');
        await page.waitForSelector('.crm-books-kg-empty', { timeout: 2000 });
        check(await page.locator('.crm-books-kg-error').count() === 0, 'graph-retry-recovers-from-error');
        check(await page.evaluate(() => document.activeElement?.classList.contains('crm-books-kg-close')), 'graph-ready-focuses-close-control');

        // Existing create/delete semantics remain live on the successful graph.
        await page.locator('.crm-books-kg-add-link').click();
        await page.locator('.crm-books-kg-from').selectOption('book-1');
        await page.locator('.crm-books-kg-to').selectOption('book-2');
        await page.locator('.crm-books-kg-label').fill('builds on');
        await page.locator('.crm-books-kg-confirm').click();
        await page.waitForSelector('.crm-books-kg-link-item', { timeout: 2000 });
        check(await page.locator('.crm-books-kg-link-item').count() === 1, 'graph-create-renders-link');
        await page.locator('.crm-books-kg-link-delete').click();
        await page.waitForFunction(() => document.querySelectorAll('.crm-books-kg-link-item').length === 0, null, { timeout: 2000 });
        check((await page.locator('.crm-books-kg-link-item').count()) === 0, 'graph-delete-removes-link');
        const requests = await page.evaluate(() => window.__ui22Requests || []);
        check(requests.some((item) => item.path === '/api/admin/book-links' && item.method === 'POST'), 'graph-create-uses-post');
        check(requests.some((item) => /^\/api\/admin\/book-links\//.test(item.path) && item.method === 'DELETE'), 'graph-delete-uses-delete');
    } catch (error) {
        checks.push({ name: 'graph-case-exception', pass: false, details: error.stack || String(error) });
    } finally {
        await page.close().catch(() => {});
    }
    checks.push({ name: 'no-page-errors', pass: pageErrors.length === 0, details: pageErrors });
    checks.push({ name: 'no-console-errors', pass: consoleErrors.length === 0, details: consoleErrors });
    return { viewport: viewportName, area: 'knowledge-graph', checks, externalRequests, pageErrors, consoleErrors };
}

async function main() {
    const source = sourceFixture();
    const sourceBeforeSha256 = sha256(SOURCE_PATHS.js);
    const testSourceSha256 = sha256(__filename);
    const result = {
        task: 'UI22-books-compilation-graph-errors',
        startedAt: new Date().toISOString(),
        source: Object.fromEntries(Object.entries(SOURCE_PATHS).map(([key, filePath]) => [key, { path: filePath, sha256: sha256(filePath), bytes: fs.statSync(filePath).size }])),
        testSource: { path: __filename, sha256: testSourceSha256 },
        browser: { channel: 'chrome', version: null },
        cases: [],
        externalRequests: []
    };
    const browser = await chromium.launch({ headless: true, channel: 'chrome' });
    result.browser.version = browser.version();
    try {
        for (const [name, viewport] of [['1440x900', { width: 1440, height: 900 }], ['390x844', { width: 390, height: 844 }]]) {
            result.cases.push(await compilationCase(browser, source, name, viewport));
            result.cases.push(await graphCase(browser, source, name, viewport));
        }
    } finally {
        await browser.close().catch(() => {});
    }
    result.finishedAt = new Date().toISOString();
    const sourceAfterSha256 = sha256(SOURCE_PATHS.js);
    result.integrity = { sourceBeforeSha256, sourceAfterSha256, unchanged: sourceBeforeSha256 === sourceAfterSha256 };
    result.checks = result.cases.flatMap((item) => item.checks);
    result.checks.push({ name: 'source-stable-during-browser-run', pass: result.integrity.unchanged, details: result.integrity });
    result.externalRequests = result.cases.flatMap((item) => item.externalRequests || []);
    result.failures = result.checks.filter((item) => !item.pass);
    fs.writeFileSync(path.join(OUTPUT_DIR, 'focused-result.json'), JSON.stringify(result, null, 2));
    fs.writeFileSync(path.join(OUTPUT_DIR, 'focused-result.txt'), result.failures.length ? result.failures.map((item) => `${item.name}: ${JSON.stringify(item.details || null)}`).join('\n') : 'All focused UI22 checks passed.\n');
    if (result.externalRequests.some((url) => !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i.test(url))) {
        throw new Error(`Unexpected non-loopback/provider request: ${result.externalRequests.join(', ')}`);
    }
    assert.strictEqual(result.failures.length, 0, `${result.failures.length} focused UI22 checks failed; see ${path.join(OUTPUT_DIR, 'focused-result.json')}`);
}

main().catch((error) => {
    const failurePath = path.join(OUTPUT_DIR, 'focused-run-error.txt');
    fs.writeFileSync(failurePath, error.stack || String(error));
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
});
