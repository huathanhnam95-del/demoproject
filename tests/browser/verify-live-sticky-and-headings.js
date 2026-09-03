const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { readBrowserTestCredentials } = require('./helpers/browser-test-credentials');

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

        // 6. Navigate to Page 9 to verify lettered headings B, C, D
        console.log('6. Navigating to page 9...');
        const input = page.locator('.crm-books-page-input');
        await input.fill('9');
        await input.evaluate(el => el.dispatchEvent(new Event('change', { bubbles: true })));
        await page.waitForTimeout(2000);

        // Check headings
        const h4Elements = await page.locator('.crm-books-page-paper h4').allTextContents();
        console.log('Found h4 headings on Page 9:', h4Elements);
        assert(h4Elements.some(t => t.includes('A Friend or foe?')), 'Heading A must be present');
        assert(h4Elements.some(t => t.includes('B Same or different?')), 'Heading B must be present');
        assert(h4Elements.some(t => t.includes('C How would I do it?')), 'Heading C must be present');
        assert(h4Elements.some(t => t.includes('D What can I steal?')), 'Heading D must be present');

        // Verify "C How would I do it?" is not inside any paragraph
        const paragraphs = await page.locator('.crm-books-page-paper p').allTextContents();
        const smushed = paragraphs.find(p => p.includes('C How would I do it?'));
        assert(!smushed, 'Heading C must not be smushed into any paragraph');

        await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'harmer_page9_headings_fixed.png') });
        console.log('Saved harmer_page9_headings_fixed.png');

        // 7. Verify Sticky Navigation Bar during scrolling
        console.log('7. Testing sticky scroll behavior...');
        const tabBody = page.locator('.crm-books-tab-body');
        const stickyBar = page.locator('.crm-books-pages-sticky-bar');
        assert(await stickyBar.isVisible(), 'Sticky bar container must be visible');

        // Measure initial top position
        const initialRect = await stickyBar.boundingBox();
        console.log('Sticky bar initial rect:', initialRect);

        // Scroll down 400px
        await tabBody.evaluate(el => { el.scrollTop = 400; });
        await page.waitForTimeout(1000);

        const scrolledRect = await stickyBar.boundingBox();
        console.log('Sticky bar scrolled rect:', scrolledRect);
        assert(Math.abs(scrolledRect.y - initialRect.y) < 5, 'Sticky bar must remain frozen at top during scroll');

        await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'harmer_page9_sticky_scrolled.png') });
        console.log('Saved harmer_page9_sticky_scrolled.png');

        // 8. Click Next while scrolled to verify page navigation from sticky bar
        console.log('8. Clicking Next button while scrolled down...');
        const nextBtn = page.locator('.crm-books-page-next');
        await nextBtn.click();
        await page.waitForTimeout(2000);

        const currentVal = await page.locator('.crm-books-page-input').inputValue();
        assert.strictEqual(currentVal, '10', 'Page must advance to 10');

        const newScrollTop = await tabBody.evaluate(el => el.scrollTop);
        console.log('New page scrollTop:', newScrollTop);
        assert.strictEqual(newScrollTop, 0, 'Page turn must reset scrollTop to 0');

        await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'harmer_page10_navigated_top.png') });
        console.log('Saved harmer_page10_navigated_top.png');

        console.log('\n===============================================================');
        console.log('SUCCESS: HEADINGS B, C, D AND FROZEN STICKY BAR VERIFIED LIVE!');
        console.log('===============================================================\n');
    } catch (err) {
        console.error('Verification error:', err);
        process.exit(1);
    } finally {
        await browser.close();
    }
})();
