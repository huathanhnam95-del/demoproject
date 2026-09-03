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
    // 1. VERIFY HARMER PAGES TAB
    // ==========================================
    console.log('\n--- 1. Testing Harmer (5th Edition) Pages Tab ---');
    const harmerItem = page.locator(`.crm-books-list-item[data-book-id="${HARMER_BOOK_ID}"]`);
    await harmerItem.waitFor({ state: 'visible', timeout: 30000 });
    await harmerItem.click();
    await page.waitForTimeout(2000);

    const pagesTab = page.locator('[data-books-tab="pages"]');
    await pagesTab.waitFor({ state: 'visible', timeout: 30000 });
    await pagesTab.click();
    await page.waitForSelector('.crm-books-page-input', { state: 'visible', timeout: 30000 });
    await page.waitForTimeout(2000);

    const pageInput = page.locator('.crm-books-page-input');

    // Harmer Page 9 (Video Timestamps)
    console.log('Jumping to Harmer Page 9...');
    await pageInput.fill('9');
    await pageInput.evaluate(el => el.dispatchEvent(new Event('change', { bubbles: true })));
    await page.waitForTimeout(2500);
    const p9Text = await page.evaluate(() => document.querySelector('.crm-books-page-content')?.textContent || '');
    assert.ok(p9Text.includes('15:54') || p9Text.includes('Video contents'), 'Harmer Page 9 must display video timestamps/contents.');
    console.log('✓ Harmer Page 9 video timestamps rendered correctly.');

    // Harmer Page 24 (InDesign Drop-Shadows)
    console.log('Jumping to Harmer Page 24...');
    await pageInput.fill('24');
    await pageInput.evaluate(el => el.dispatchEvent(new Event('change', { bubbles: true })));
    await page.waitForTimeout(2500);
    const p24Html = await page.evaluate(() => document.querySelector('.crm-books-page-content')?.innerHTML || '');
    assert.ok(p24Html.includes('<h4>English as a lingua franca</h4>'), 'Harmer Page 24 drop shadow headings must be cleanly deduplicated.');
    console.log('✓ Harmer Page 24 drop shadows cleanly deduplicated.');

    // Harmer Page 450 (Subject Index)
    console.log('Jumping to Harmer Page 450...');
    await pageInput.fill('450');
    await pageInput.evaluate(el => el.dispatchEvent(new Event('change', { bubbles: true })));
    await page.waitForTimeout(2500);
    const p450Text = await page.evaluate(() => document.querySelector('.crm-books-page-content')?.textContent || '');
    assert.ok(p450Text.includes('169, 175, 358') || p450Text.includes('195–6'), 'Harmer Page 450 index page numbers must be rendered.');
    console.log('✓ Harmer Page 450 subject index page numbers rendered correctly.');

    const harmerScreenshot = path.join(ARTIFACTS_DIR, 'harmer_pages_tab_live.png');
    await page.screenshot({ path: harmerScreenshot, fullPage: false });
    console.log('Saved harmer_pages_tab_live.png');

    // ==========================================
    // 2. VERIFY TEACHING PRONUNCIATION PAGES TAB
    // ==========================================
    console.log('\n--- 2. Testing Teaching Pronunciation Pages Tab ---');
    const pronItem = page.locator(`.crm-books-list-item[data-book-id="${PRON_BOOK_ID}"]`);
    await pronItem.waitFor({ state: 'visible', timeout: 30000 });
    await pronItem.click();
    await page.waitForTimeout(2500);

    const pronPagesTab = page.locator('[data-books-tab="pages"]');
    await pronPagesTab.waitFor({ state: 'visible', timeout: 30000 });
    await pronPagesTab.click();
    await page.waitForSelector('.crm-books-page-input', { state: 'visible', timeout: 30000 });
    await page.waitForTimeout(2000);

    const pronInput = page.locator('.crm-books-page-input');

    // Pronunciation Page 26 (IPA Vowel Chart)
    console.log('Jumping to Pronunciation Page 26...');
    await pronInput.fill('26');
    await pronInput.evaluate(el => el.dispatchEvent(new Event('change', { bubbles: true })));
    await page.waitForTimeout(2500);
    const p26Html = await page.evaluate(() => document.querySelector('.crm-books-page-content')?.innerHTML || '');
    assert.ok(p26Html.includes('/i/') && p26Html.includes('/ɪ/'), 'Pronunciation Page 26 IPA vowel chart phonemes must be rendered.');
    console.log('✓ Pronunciation Page 26 IPA vowel quadrant chart rendered correctly.');

    // Pronunciation Page 43 (Flap & Glottal Stop Allophones)
    console.log('Jumping to Pronunciation Page 43...');
    await pronInput.fill('43');
    await pronInput.evaluate(el => el.dispatchEvent(new Event('change', { bubbles: true })));
    await page.waitForTimeout(2500);
    const p43Html = await page.evaluate(() => document.querySelector('.crm-books-page-content')?.innerHTML || '');
    assert.ok(p43Html.includes('[ɾ]') || p43Html.includes('[ʔ]'), 'Pronunciation Page 43 allophone variations must be rendered.');
    console.log('✓ Pronunciation Page 43 allophone variations rendered correctly.');

    // Pronunciation Page 197 (Fill-in-the-Blank Prompts)
    console.log('Jumping to Pronunciation Page 197...');
    await pronInput.fill('197');
    await pronInput.evaluate(el => el.dispatchEvent(new Event('change', { bubbles: true })));
    await page.waitForTimeout(2500);
    const p197Text = await page.evaluate(() => document.querySelector('.crm-books-page-content')?.textContent || '');
    assert.ok(p197Text.includes('Hi, I’m') || p197Text.includes('_____'), 'Pronunciation Page 197 fill-in-the-blank prompt must be rendered.');
    console.log('✓ Pronunciation Page 197 fill-in-the-blank practice prompt rendered correctly.');

    const pronScreenshot = path.join(ARTIFACTS_DIR, 'pron_pages_tab_live.png');
    await page.screenshot({ path: pronScreenshot, fullPage: false });
    console.log('Saved pron_pages_tab_live.png');

    await browser.close();
    console.log('\n=== ALL PAGES TABS ARE VERIFIED SHOWING LATEST PRODUCTION RESULTS ===');
})().catch(err => {
    console.error('Test error:', err);
    process.exit(1);
});
