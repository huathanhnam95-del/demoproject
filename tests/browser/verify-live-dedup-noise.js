const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { readBrowserTestCredentials } = require('./helpers/browser-test-credentials');

const ORIGIN = 'https://betterenglishlearning.com';
const HARMER_BOOK_ID = 'FQavK9NnlrytB00F3WHy';
const KNOWLES_BOOK_ID = 'if1GtQHgGoU7uolTPVXC';
const ARTIFACTS_DIR = 'C:/Users/Admin/.gemini/antigravity/brain/b92652f8-40b1-4043-b9b0-3d2cb6e6e469';

async function signInOnPage(page, credentials) {
    return page.evaluate(async ({ email, password }) => {
        const auth = window.__FIREBASE_INTERNAL__?.auth;
        if (!auth) throw new Error('Firebase Auth unavailable on window.__FIREBASE_INTERNAL__');
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

        // ==========================================
        // 1. VERIFY HARMER PAGE 24 (DEDUPLICATION)
        // ==========================================
        console.log('4. Selecting Harmer Book...');
        const harmerItem = page.locator(`.crm-books-list-item[data-book-id="${HARMER_BOOK_ID}"]`);
        await harmerItem.waitFor({ state: 'visible', timeout: 30000 });
        await harmerItem.click();
        await page.waitForTimeout(2000);

        console.log('5. Clicking Pages tab...');
        const pagesTab = page.locator('[data-books-tab="pages"]');
        await pagesTab.waitFor({ state: 'visible', timeout: 30000 });
        await pagesTab.click();
        await page.waitForSelector('.crm-books-page-input', { state: 'visible', timeout: 30000 });
        await page.waitForTimeout(2000);

        console.log('6. Jumping to Harmer Page 24...');
        const pageInput = page.locator('.crm-books-page-input');
        await pageInput.fill('24');
        await pageInput.evaluate(el => el.dispatchEvent(new Event('change', { bubbles: true })));
        await page.waitForTimeout(2500);

        const pagePaper = page.locator('.crm-books-page-paper');
        const page24Html = await pagePaper.innerHTML();
        console.log('Harmer Page 24 HTML snippet:', page24Html.substring(0, 350));

        assert(!page24Html.includes('lingua francaEnglish'), 'Repeated concatenated text found on Harmer Page 24!');
        assert(page24Html.includes('English as a lingua franca'), 'Clean heading 1 not found on Harmer Page 24!');
        assert(page24Html.includes('ESP (English for specific purposes)'), 'Clean heading 2 not found on Harmer Page 24!');
        console.log('✓ Harmer Page 24 deduplication verified!');

        await pagePaper.screenshot({
            path: path.join(ARTIFACTS_DIR, 'harmer_p24_deduplicated.png')
        });
        console.log('Saved harmer_p24_deduplicated.png');

        // ==========================================
        // 2. VERIFY KNOWLES (NOISE FILTER & SHEET HEIGHT)
        // ==========================================
        console.log('7. Selecting Knowles book...');
        const knowlesItem = page.locator(`.crm-books-list-item[data-book-id="${KNOWLES_BOOK_ID}"]`);
        await knowlesItem.waitFor({ state: 'visible', timeout: 30000 });
        await knowlesItem.click();
        await page.waitForTimeout(2000);

        await pagesTab.click();
        await page.waitForSelector('.crm-books-page-input', { state: 'visible', timeout: 30000 });
        await page.waitForTimeout(2000);

        // Check Page 5
        console.log('8. Jumping to Knowles Page 5...');
        await pageInput.fill('5');
        await pageInput.evaluate(el => el.dispatchEvent(new Event('change', { bubbles: true })));
        await page.waitForTimeout(2500);

        const page5Text = await pagePaper.innerText();
        console.log('Knowles Page 5 text:', JSON.stringify(page5Text));
        assert(!page5Text.includes('rogfiwoal'), 'Scanner noise was not filtered on Knowles Page 5!');
        console.log('✓ Knowles Page 5 scanner noise successfully filtered!');

        // Check Page 10 (Table of Contents & 840px Min-Height)
        console.log('9. Jumping to Knowles Page 10...');
        await pageInput.fill('10');
        await pageInput.evaluate(el => el.dispatchEvent(new Event('change', { bubbles: true })));
        await page.waitForTimeout(2500);

        const page10Box = await pagePaper.boundingBox();
        console.log('Knowles Page 10 paper height:', page10Box.height);
        assert(page10Box.height >= 840, `Sheet min-height failed! Expected >= 840px, got ${page10Box.height}px`);
        console.log(`✓ Knowles Page 10 sheet min-height is ${page10Box.height}px (>= 840px)!`);

        await page.screenshot({
            path: path.join(ARTIFACTS_DIR, 'knowles_p10_full_height.png'),
            clip: { x: 300, y: 180, width: 1100, height: 720 }
        });
        console.log('Saved knowles_p10_full_height.png');

        // Check Page 13 (Preface formatting)
        console.log('10. Jumping to Knowles Page 13...');
        await pageInput.fill('13');
        await pageInput.evaluate(el => el.dispatchEvent(new Event('change', { bubbles: true })));
        await page.waitForTimeout(2500);

        const page13Html = await pagePaper.innerHTML();
        console.log('Knowles Page 13 HTML snippet:', page13Html.substring(0, 350));
        assert(!page13Html.includes('= preface'), 'Found "= preface" noise on Knowles Page 13!');
        console.log('✓ Knowles Page 13 clean Preface formatting verified!');

        await page.screenshot({
            path: path.join(ARTIFACTS_DIR, 'knowles_p13_clean.png'),
            clip: { x: 300, y: 180, width: 1100, height: 720 }
        });
        console.log('Saved knowles_p13_clean.png');

        console.log('\n=== ALL PLAYWRIGHT VERIFICATION CHECKS PASSED ===');
    } finally {
        await browser.close();
    }
})().catch((err) => {
    console.error('Playwright verification failed:', err);
    process.exitCode = 1;
});
