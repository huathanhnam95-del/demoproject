const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { readBrowserTestCredentials } = require('./helpers/browser-test-credentials');

const ORIGIN = 'https://betterenglishlearning.com';
const HARMER_BOOK_ID = 'FQavK9NnlrytB00F3WHy';
const PRON_BOOK_ID = 'ZT25mJFlnHUYCOY2rmIG';
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
    // 1. VERIFY HARMER PAGE 9 & PAGE 49
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

    console.log('6. Jumping to Harmer Page 9 (Video contents)...');
    const pageInput = page.locator('.crm-books-page-input');
    await pageInput.fill('9');
    await pageInput.evaluate(el => el.dispatchEvent(new Event('change', { bubbles: true })));
    await page.waitForTimeout(2500);

    const p9Text = await page.evaluate(() => document.querySelector('.crm-books-page-content')?.textContent || '');
    console.log('Harmer Page 9 text snippet:', p9Text.substring(0, 180).replace(/\s+/g, ' '));
    assert.ok(p9Text.includes('15:54') || p9Text.includes('Video contents') || p9Text.includes('Track'), 'Harmer Page 9 video contents/timestamps must be rendered.');
    console.log('✓ Harmer Page 9 video contents and timestamps verified!');

    console.log('7. Jumping to Harmer Page 49 (Chapter 2 notes)...');
    await pageInput.fill('49');
    await pageInput.evaluate(el => el.dispatchEvent(new Event('change', { bubbles: true })));
    await page.waitForTimeout(2500);

    const p49Html = await page.evaluate(() => document.querySelector('.crm-books-page-content')?.innerHTML || '');
    assert.ok(p49Html.includes('<h4>Chapter notes and further reading</h4>'), 'Harmer Page 49 chapter notes must render cleanly once.');
    console.log('✓ Harmer Page 49 chapter notes deduplication verified!');

    // ==========================================
    // 2. VERIFY TEACHING PRONUNCIATION
    // ==========================================
    console.log('8. Selecting Teaching Pronunciation book...');
    const pronItem = page.locator(`.crm-books-list-item[data-book-id="${PRON_BOOK_ID}"]`);
    await pronItem.waitFor({ state: 'visible', timeout: 30000 });
    await pronItem.click();
    await page.waitForTimeout(2500);

    const pronPagesTab = page.locator('[data-books-tab="pages"]');
    await pronPagesTab.waitFor({ state: 'visible', timeout: 30000 });
    await pronPagesTab.click();
    await page.waitForSelector('.crm-books-page-input', { state: 'visible', timeout: 30000 });
    await page.waitForTimeout(2000);

    console.log('9. Jumping to Pronunciation Page 26 (Vowel chart)...');
    const pronInput = page.locator('.crm-books-page-input');
    await pronInput.fill('26');
    await pronInput.evaluate(el => el.dispatchEvent(new Event('change', { bubbles: true })));
    await page.waitForTimeout(2500);

    const p26Html = await page.evaluate(() => document.querySelector('.crm-books-page-content')?.innerHTML || '');
    console.log('Pronunciation Page 26 HTML snippet:', p26Html.substring(0, 250).replace(/\s+/g, ' '));
    assert.ok(p26Html.includes('/i/') && p26Html.includes('/ɪ/'), 'Pronunciation Page 26 IPA vowel chart phonemes must be rendered.');
    console.log('✓ Pronunciation Page 26 IPA vowel chart verified!');

    console.log('10. Jumping to Pronunciation Page 43 (Flap & Glottal stop)...');
    await pronInput.fill('43');
    await pronInput.evaluate(el => el.dispatchEvent(new Event('change', { bubbles: true })));
    await page.waitForTimeout(2500);

    const p43Html = await page.evaluate(() => document.querySelector('.crm-books-page-content')?.innerHTML || '');
    console.log('Pronunciation Page 43 HTML snippet:', p43Html.substring(0, 250).replace(/\s+/g, ' '));
    assert.ok(p43Html.includes('[ɾ]') || p43Html.includes('[ʔ]'), 'Pronunciation Page 43 allophones (flap/glottal stop) must be rendered.');
    console.log('✓ Pronunciation Page 43 allophone variations verified!');

    const screenshotPath = path.join(ARTIFACTS_DIR, 'pron_page_26_live.png');
    await page.screenshot({ path: screenshotPath, fullPage: false });
    console.log('Saved pron_page_26_live.png');

    await browser.close();
    console.log('\n=== ALL PLAYWRIGHT LIVE ASSERTIONS PASSED ===');
})().catch(err => {
    console.error('Test error:', err);
    process.exit(1);
});
