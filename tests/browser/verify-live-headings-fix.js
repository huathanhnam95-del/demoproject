const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { readBrowserTestCredentials } = require('./helpers/browser-test-credentials');

const ROOT = path.resolve(__dirname, '../..');
const ORIGIN = 'https://betterenglishlearning.com';
const BOOK_ID = 'FQavK9NnlrytB00F3WHy'; // Harmer 5th Edition
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
        await page.waitForSelector('.crm-books-page-input', { state: 'visible', timeout: 30000 });
        await page.waitForTimeout(2000);

        async function jumpToPage(num) {
            console.log(`\nNavigating to physical page ${num}...`);
            const input = page.locator('.crm-books-page-input');
            await input.waitFor({ state: 'visible', timeout: 15000 });
            await input.fill(String(num));
            await input.evaluate(el => el.dispatchEvent(new Event('change', { bubbles: true })));
            await page.waitForTimeout(2000);
            await page.waitForFunction((targetNum) => {
                const el = document.querySelector('.crm-books-page-paper[data-page-number]');
                return el && el.getAttribute('data-page-number') === String(targetNum);
            }, num, { timeout: 15000 });
        }

        // ==========================================
        // PAGE 86 (User Screenshot 1 & 2: 74chapter 4 + 4.9.3 4.9.4)
        // ==========================================
        console.log('\n--- Verifying Physical Page 86 ---');
        await jumpToPage(86);
        const header86 = await page.locator('.crm-books-page-header').first();
        assert(await header86.isVisible(), 'Page 86 must have .crm-books-page-header');
        const header86Text = await header86.innerText();
        console.log('Page 86 Header:\n' + header86Text);
        assert(header86Text.includes('74'), 'Header must contain folio 74');
        assert(/chapter\s+4/i.test(header86Text), 'Header must contain Chapter 4');

        const p86Content = await page.locator('.crm-books-page-content').first().innerText();
        assert(!p86Content.includes('74chapter 4'), 'Page 86 must not contain glued "74chapter 4"');
        assert(p86Content.includes('Using coursebooks more effectively'), 'Page 86 must have section heading');
        assert(p86Content.includes('Choosing coursebooks'), 'Page 86 must have Choosing coursebooks heading');
        assert(!p86Content.includes('how should we go about this? 4.9.3 4.9.4'), 'Section numbers must not be concatenated onto questions');

        const badges86 = await page.locator('.crm-books-section-badge').allInnerTexts();
        console.log('Page 86 Section badges:', badges86);
        assert(badges86.includes('4.9.3') && badges86.includes('4.9.4'), 'Section badges 4.9.3 and 4.9.4 must render as discrete badges');

        await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'harmer_fixed_p86.png') });
        console.log('Saved harmer_fixed_p86.png');

        // ==========================================
        // PAGE 87 (User Screenshot 3: 75Popular methodology)
        // ==========================================
        console.log('\n--- Verifying Physical Page 87 ---');
        await jumpToPage(87);
        const header87 = await page.locator('.crm-books-page-header').first();
        assert(await header87.isVisible(), 'Page 87 must have .crm-books-page-header');
        const header87Text = await header87.innerText();
        console.log('Page 87 Header:\n' + header87Text);
        assert(header87Text.includes('75'), 'Header must contain folio 75');
        assert(/popular\s+methodology/i.test(header87Text), 'Header must contain Popular methodology');

        const p87Content = await page.locator('.crm-books-page-content').first().innerText();
        assert(!p87Content.includes('75Popular methodology'), 'Page 87 must not contain glued "75Popular methodology"');
        assert(p87Content.includes('Perhaps the best way of choosing a coursebook is to make statements'), 'Body paragraph starts cleanly');

        await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'harmer_fixed_p87.png') });
        console.log('Saved harmer_fixed_p87.png');

        // ==========================================
        // PAGE 20 (Physical page 20, Book page 8: 8chapter 1)
        // ==========================================
        console.log('\n--- Verifying Physical Page 20 ---');
        await jumpToPage(20);
        const header20 = await page.locator('.crm-books-page-header').first();
        const header20Text = await header20.innerText();
        console.log('Page 20 Header:\n' + header20Text);
        assert(header20Text.includes('8') && /chapter\s+1/i.test(header20Text), 'Page 20 header verified');

        const p20Content = await page.locator('.crm-books-page-content').first().innerText();
        assert(!p20Content.includes('8chapter 1'), 'Page 20 must not contain glued "8chapter 1"');
        assert(p20Content.includes('of grammatical accuracy and their pragmatic competence in French'), 'Page 20 text starts cleanly');

        await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'harmer_fixed_p20.png') });
        console.log('Saved harmer_fixed_p20.png');

        // ==========================================
        // PAGE 100 (Physical page 100, Book page 88: 88chapter 5)
        // ==========================================
        console.log('\n--- Verifying Physical Page 100 ---');
        await jumpToPage(100);
        const header100 = await page.locator('.crm-books-page-header').first();
        const header100Text = await header100.innerText();
        console.log('Page 100 Header:\n' + header100Text);
        assert(header100Text.includes('88') && /chapter\s+5/i.test(header100Text), 'Page 100 header verified');

        const p100Content = await page.locator('.crm-books-page-content').first().innerText();
        assert(!p100Content.includes('88chapter 5'), 'Page 100 must not contain glued "88chapter 5"');
        assert(p100Content.includes('convergers versus divergers verbalisers versus imagers'), 'Page 100 text starts cleanly');

        await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'harmer_fixed_p100.png') });
        console.log('Saved harmer_fixed_p100.png');

        console.log('\n===============================================================');
        console.log('SUCCESS: ALL REPORTED HEADING & PAGE NUMBER DEFECTS FULLY FIXED AND VERIFIED LIVE!');
        console.log('===============================================================\n');
    } catch (err) {
        console.error('Verification error:', err);
        process.exit(1);
    } finally {
        await browser.close();
    }
})();
