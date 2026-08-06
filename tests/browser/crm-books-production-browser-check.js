/* eslint-disable no-console */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const {
    readBrowserTestCredentials,
    redactAuthIdentity
} = require('./helpers/browser-test-credentials');

const ROOT = path.resolve(__dirname, '../..');
const ORIGIN = process.env.CRM_BOOKS_PRODUCTION_ORIGIN || 'https://betterenglishlearning.com';
const SCREENSHOT_PATH = path.join(ROOT, 'tmp', 'crm-books-production-browser-check.png');

async function signInOnPage(page, credentials) {
    return page.evaluate(async ({ email, password }) => {
        const auth = window.__FIREBASE_INTERNAL__?.auth;
        if (!auth) throw new Error('Production Firebase auth is not available.');
        const { signInWithEmailAndPassword } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const result = await signInWithEmailAndPassword(auth, email, password);
        return { uid: result?.user?.uid || '' };
    }, credentials);
}

async function fetchBooksFromPage(page) {
    return page.evaluate(async () => {
        const user = window.firebase?.auth?.().currentUser || window.__FIREBASE_INTERNAL__?.auth?.currentUser;
        if (!user) throw new Error('Authenticated Firebase user is not available.');
        const token = await user.getIdToken();
        const response = await fetch('/api/admin/books', {
            headers: { Authorization: `Bearer ${token}` },
            cache: 'no-store'
        });
        return { status: response.status, body: await response.json().catch(() => null) };
    });
}

(async () => {
    const credentials = readBrowserTestCredentials();
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    const browserErrors = [];

    page.on('console', (message) => {
        if (message.type() === 'error') {
            browserErrors.push(redactAuthIdentity(message.text(), credentials));
        }
    });
    page.on('pageerror', (error) => {
        browserErrors.push(redactAuthIdentity(error.message, credentials));
    });

    try {
        await page.goto(`${ORIGIN}/index.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForFunction(() => Boolean(window.__FIREBASE_INTERNAL__?.auth), null, { timeout: 30000 });
        const authResult = await signInOnPage(page, credentials);
        assert(authResult.uid, 'Production Firebase sign-in should return an authenticated user.');

        await page.goto(`${ORIGIN}/crm-admin.html#books`, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForFunction(() => {
            const gate = document.getElementById('crm-loading');
            return gate && getComputedStyle(gate).display === 'none';
        }, null, { timeout: 45000 });
        await page.waitForSelector('[data-panel="books"]', { state: 'visible', timeout: 30000 });
        await page.waitForSelector('.crm-books-workspace', { timeout: 30000 });

        const apiResult = await fetchBooksFromPage(page);
        assert.strictEqual(apiResult.status, 200, 'Authenticated Books API should return 200.');
        assert.strictEqual(apiResult.body?.success, true, 'Authenticated Books API should return success.');

        const layout = await page.evaluate(() => {
            const panel = document.querySelector('[data-panel="books"]');
            const workspace = panel?.querySelector('.crm-books-workspace');
            const listItem = panel?.querySelector('.crm-books-list-item[data-book-id]');
            return {
                studioCount: panel?.querySelectorAll('.crm-books-studio-panel').length || 0,
                workspaceColumns: workspace ? getComputedStyle(workspace).gridTemplateColumns : '',
                sourcePanelVisible: Boolean(panel?.querySelector('.crm-books-sources-panel')),
                explorerPanelVisible: Boolean(panel?.querySelector('.crm-books-explorer-panel')),
                bookCount: panel?.querySelectorAll('.crm-books-list-item[data-book-id]').length || 0,
                hasFirstBook: Boolean(listItem)
            };
        });

        assert.strictEqual(layout.studioCount, 0, 'Production Books UI must not render a Studio panel.');
        assert(layout.sourcePanelVisible, 'Production Books UI must render the Sources panel.');
        assert(layout.explorerPanelVisible, 'Production Books UI must render the Explorer panel.');
        assert(layout.workspaceColumns.startsWith('260px '), `Production Books workspace should use a widened chat column: ${layout.workspaceColumns}`);

        let chatLayout = null;
        const hasReadyBook = Array.isArray(apiResult.body?.books)
            && apiResult.body.books.some((book) => book?.status === 'ready');
        if (hasReadyBook) {
            await page.locator('.crm-books-list-item[data-book-id]').first().click();
            await page.waitForSelector('.crm-books-explorer-header', { timeout: 30000 });
            await page.waitForSelector('.crm-books-tab[data-books-tab="chat"]', { timeout: 30000 });
            await page.click('.crm-books-tab[data-books-tab="chat"]');
            await page.waitForSelector('.crm-books-tab-body.chat-active', { timeout: 30000 });
            chatLayout = await page.evaluate(() => {
                const body = document.querySelector('.crm-books-tab-body.chat-active');
                const composer = document.querySelector('.crm-books-composer');
                return {
                    chatActive: Boolean(body),
                    composerVisible: Boolean(composer),
                    bodyHeight: body ? Math.round(body.getBoundingClientRect().height) : 0,
                    composerWidth: composer ? Math.round(composer.getBoundingClientRect().width) : 0
                };
            });
            assert(chatLayout.chatActive, 'Ready production book should open the Chat tab.');
            assert(chatLayout.composerVisible, 'Production Chat tab should render its composer.');
            assert(chatLayout.bodyHeight > 300, 'Production Chat tab should use the full-height Explorer body.');
        }

        await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });
        console.log(JSON.stringify({
            origin: ORIGIN,
            apiStatus: apiResult.status,
            bookCount: layout.bookCount,
            workspaceColumns: layout.workspaceColumns,
            studioCount: layout.studioCount,
            chatLayout,
            browserErrors,
            screenshot: SCREENSHOT_PATH
        }, null, 2));
        console.log('crm books production browser check passed');
    } finally {
        await browser.close();
    }
})().catch((error) => {
    console.error(redactAuthIdentity(error.stack || error.message, readBrowserTestCredentials()));
    process.exitCode = 1;
});
