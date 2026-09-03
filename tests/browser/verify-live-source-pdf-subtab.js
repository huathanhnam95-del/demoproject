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

        // Verify sub-tabs exist
        console.log('6. Checking sub-tabs bar...');
        const subtabs = page.locator('.crm-books-pages-subtabs');
        assert(await subtabs.isVisible(), 'Subtabs container must be visible in Pages tab');
        const textSubtab = page.locator('.crm-books-subtab-btn[data-page-subtab="text"]');
        const pdfSubtab = page.locator('.crm-books-subtab-btn[data-page-subtab="pdf"]');
        assert(await textSubtab.isVisible(), 'Extracted Text subtab button must be visible');
        assert(await pdfSubtab.isVisible(), 'Source PDF subtab button must be visible');
        assert(await textSubtab.evaluate(el => el.classList.contains('active')), 'Extracted Text must be active by default');

        // Navigate to Page 86
        console.log('7. Navigating to page 86...');
        const input = page.locator('.crm-books-page-input');
        await input.fill('86');
        await input.evaluate(el => el.dispatchEvent(new Event('change', { bubbles: true })));
        await page.waitForTimeout(2000);

        const jumpToSourceBtn = page.locator('.crm-books-jump-to-source-btn');
        assert(await jumpToSourceBtn.isVisible(), 'Jump to Source PDF button must be visible in text mode');
        await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'subtab_text_p86.png') });
        console.log('Saved subtab_text_p86.png');

        // Click Jump to Source PDF button
        console.log('8. Clicking "View in Source PDF" button...');
        await jumpToSourceBtn.click();
        await page.waitForTimeout(4000);

        // Verify Source PDF subtab is now active
        assert(await pdfSubtab.evaluate(el => el.classList.contains('active')), 'Source PDF subtab must now be active');
        const pdfContainer = page.locator('.crm-books-pdf-container');
        assert(await pdfContainer.isVisible(), 'PDF container must be visible');

        const iframe = page.locator('.crm-books-pdf-iframe');
        await iframe.waitFor({ state: 'visible', timeout: 15000 });
        const iframeSrc = await iframe.getAttribute('src');
        console.log('PDF Iframe src:', iframeSrc);
        assert(iframeSrc.includes('#page=86'), 'PDF iframe src must target #page=86');
        assert(iframeSrc.includes('storage.googleapis.com') || iframeSrc.includes('/api/admin/books'), 'Iframe src must be valid source URL');

        const jumpToTextBtn = page.locator('.crm-books-jump-to-text-btn');
        assert(await jumpToTextBtn.isVisible(), 'Jump to Extracted Text button must be visible in PDF mode');

        await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'subtab_pdf_p86.png') });
        console.log('Saved subtab_pdf_p86.png');

        // Click Jump to Extracted Text button to test return flow
        console.log('9. Clicking "View Extracted Text" button to return...');
        await jumpToTextBtn.click();
        await page.waitForTimeout(2000);

        assert(await textSubtab.evaluate(el => el.classList.contains('active')), 'Extracted Text subtab must be active again');
        const stage = page.locator('.crm-books-page-stage');
        assert(await stage.isVisible(), 'Page stage must be visible');
        const currentInputVal = await page.locator('.crm-books-page-input').inputValue();
        assert.strictEqual(currentInputVal, '86', 'Page input must remain on page 86');

        await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'subtab_returned_text_p86.png') });
        console.log('Saved subtab_returned_text_p86.png');

        console.log('\n===============================================================');
        console.log('SUCCESS: SOURCE PDF SUBTAB & JUMP NAVIGATION FULLY VERIFIED ON PRODUCTION!');
        console.log('===============================================================\n');
    } catch (err) {
        console.error('Verification error:', err);
        process.exit(1);
    } finally {
        await browser.close();
    }
})();
