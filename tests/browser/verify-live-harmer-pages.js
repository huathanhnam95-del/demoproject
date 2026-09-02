const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { readBrowserTestCredentials } = require('./helpers/browser-test-credentials');

const ROOT = path.resolve(__dirname, '../..');
const ORIGIN = 'https://betterenglishlearning.com';
const BOOK_ID = 'FQavK9NnlrytB00F3WHy';
const ARTIFACTS_DIR = 'C:/Users/Admin/.gemini/antigravity/brain/b92652f8-40b1-4043-b9b0-3d2cb6e6e469';

async function signInOnPage(page, credentials) {
    return page.evaluate(async ({ email, password }) => {
        const auth = window.__FIREBASE_INTERNAL__?.auth;
        if (!auth) throw new Error('Production Firebase auth is not available.');
        const { signInWithEmailAndPassword } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const result = await signInWithEmailAndPassword(auth, email, password);
        return { uid: result?.user?.uid || '' };
    }, credentials);
}

(async () => {
    const credentials = readBrowserTestCredentials();
    console.log('1. Launching Chrome...');
    const browser = await chromium.launch({
        headless: true,
        channel: 'chrome'
    });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();

    try {
        console.log('2. Authenticating via Firebase Auth on /index.html...');
        await page.goto(`${ORIGIN}/index.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForFunction(() => Boolean(window.__FIREBASE_INTERNAL__?.auth), null, { timeout: 30000 });
        const authResult = await signInOnPage(page, credentials);
        console.log('Authenticated UID:', authResult.uid);

        console.log(`3. Navigating to ${ORIGIN}/crm-admin.html#books...`);
        await page.goto(`${ORIGIN}/crm-admin.html#books`, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForFunction(() => {
            const gate = document.getElementById('crm-loading');
            return gate && getComputedStyle(gate).display === 'none';
        }, null, { timeout: 45000 });
        await page.waitForSelector('[data-panel="books"]', { state: 'visible', timeout: 30000 });
        await page.waitForSelector('.crm-books-workspace', { timeout: 30000 });
        await page.waitForTimeout(3000);

        console.log(`4. Selecting Harmer Book (${BOOK_ID})...`);
        const bookItem = page.locator(`.crm-books-list-item[data-book-id="${BOOK_ID}"]`);
        await bookItem.waitFor({ state: 'visible', timeout: 30000 });
        await bookItem.click();
        await page.waitForTimeout(3000);

        console.log('5. Clicking Pages tab [data-books-tab="pages"]...');
        const pagesTab = page.locator('[data-books-tab="pages"]');
        await pagesTab.waitFor({ state: 'visible', timeout: 30000 });
        await pagesTab.click();
        await page.waitForTimeout(3000);

        async function jumpToPage(num) {
            console.log(`\n--- Navigating to Page ${num} ---`);
            const input = page.locator('.crm-books-page-input');
            await input.waitFor({ state: 'visible', timeout: 10000 });
            await input.fill(String(num));
            await input.evaluate(el => el.dispatchEvent(new Event('change', { bubbles: true })));
            await page.waitForTimeout(2500);
            await page.waitForFunction((targetNum) => {
                const el = document.querySelector('.crm-books-page-paper[data-page-number]');
                return el && el.getAttribute('data-page-number') === String(targetNum);
            }, num, { timeout: 10000 });
        }

        // --- PAGE 1 ---
        await jumpToPage(1);
        const p1Text = await page.locator('.crm-books-page-content').first().innerText();
        console.log('DOM Text Page 1:\n' + p1Text);
        assert(p1Text.includes('Jeremy Harmer'), 'Page 1 must contain "Jeremy Harmer"');
        assert(p1Text.includes('The Practice of'), 'Page 1 must contain title');
        await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'harmer_live_page_1.png') });
        console.log('Saved harmer_live_page_1.png');

        // --- PAGE 10 ---
        await jumpToPage(10);
        const p10Text = await page.locator('.crm-books-page-content').first().innerText();
        console.log('DOM Text Page 10:\n' + p10Text.slice(0, 300));
        assert(p10Text.includes('Video contents') || p10Text.includes('Pre-university'), 'Page 10 must contain video contents');
        await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'harmer_live_page_10.png') });
        console.log('Saved harmer_live_page_10.png');

        // --- PAGE 20 ---
        await jumpToPage(20);
        const p20Text = await page.locator('.crm-books-page-content').first().innerText();
        console.log('DOM Text Page 20:\n' + p20Text.slice(0, 300));
        assert(p20Text.includes('grammatical accuracy') || p20Text.includes('CBLT'), 'Page 20 must contain chapter 1 discussion');
        await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'harmer_live_page_20.png') });
        console.log('Saved harmer_live_page_20.png');

        // --- PAGE 50 ---
        await jumpToPage(50);
        const p50Text = await page.locator('.crm-books-page-content').first().innerText();
        console.log('DOM Text Page 50:\n' + p50Text.slice(0, 300));
        assert(p50Text.includes('Grammar') || p50Text.includes('Vocabulary'), 'Page 50 must contain chart elements');
        await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'harmer_live_page_50.png') });
        console.log('Saved harmer_live_page_50.png');

        // --- PAGE 100 ---
        await jumpToPage(100);
        const p100Text = await page.locator('.crm-books-page-content').first().innerText();
        console.log('DOM Text Page 100:\n' + p100Text.slice(0, 350));
        assert(p100Text.includes('convergers versus divergers'), 'Page 100 must contain learning styles');
        assert(p100Text.includes('verbalisers versus imagers'), 'Page 100 must contain verbalisers');
        await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'harmer_live_page_100.png') });
        console.log('Saved harmer_live_page_100.png');

        console.log('\n===============================================================');
        console.log('SUCCESS: ALL 5 HARMER PAGES FULLY VERIFIED IN CHROME BROWSER!');
        console.log('===============================================================\n');
    } catch (err) {
        console.error('Verification error:', err);
        process.exit(1);
    } finally {
        await browser.close();
    }
})();
