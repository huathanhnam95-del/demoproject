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
const BOOK_ID = 'if1GtQHgGoU7uolTPVXC';
const TMP = path.join(ROOT, 'tmp');

const SCREENSHOTS = {
    bookHeaderWithBgm: path.join(TMP, 'crm-bgm-01-header-btn.png'),
    bgmModal: path.join(TMP, 'crm-bgm-02-modal-open.png'),
    bookViewPlayer: path.join(TMP, 'crm-bgm-03-player-rendered.png'),
    bookViewPlaying: path.join(TMP, 'crm-bgm-04-player-playing.png'),
    bookViewVolume: path.join(TMP, 'crm-bgm-05-volume-hover.png')
};

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
    fs.mkdirSync(TMP, { recursive: true });
    const credentials = readBrowserTestCredentials();
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        ignoreHTTPSErrors: true,
        viewport: { width: 1440, height: 900 }
    });
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
        console.log('Step 1: Logging in...');
        await page.goto(`${ORIGIN}/index.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForFunction(() => Boolean(window.__FIREBASE_INTERNAL__?.auth), null, { timeout: 30000 });
        const authResult = await signInOnPage(page, credentials);
        assert(authResult.uid, 'Firebase sign-in should return an authenticated user.');
        console.log('  ✓ Logged in successfully.');

        console.log('Step 2: Navigating to CRM Books...');
        await page.goto(`${ORIGIN}/crm-admin.html#books/${BOOK_ID}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForFunction(() => {
            const gate = document.getElementById('crm-loading');
            return gate && getComputedStyle(gate).display === 'none';
        }, null, { timeout: 45000 });
        await page.waitForSelector('.crm-books-workspace', { timeout: 30000 });
        await page.waitForSelector('.crm-books-explorer-header', { timeout: 30000 });
        console.log('  ✓ Books workspace loaded.');

        console.log('Step 3: Checking BGM button in header...');
        const bgmBtn = await page.waitForSelector('.crm-books-bgm-btn', { timeout: 10000 });
        assert(bgmBtn, 'BGM button should exist in the explorer header.');
        await page.screenshot({ path: SCREENSHOTS.bookHeaderWithBgm });
        console.log('  ✓ BGM button found in header.');

        console.log('Step 4: Opening BGM Upload Modal...');
        await bgmBtn.click();
        await page.waitForSelector('.crm-books-bgm-modal', { timeout: 10000 });
        await page.waitForSelector('#crm-books-bgm-dropzone', { timeout: 10000 });
        await page.screenshot({ path: SCREENSHOTS.bgmModal });
        console.log('  ✓ BGM modal opened with dropzone.');

        // Close modal
        await page.click('.crm-books-modal-close-btn');
        await page.waitForSelector('.crm-books-bgm-modal', { state: 'detached', timeout: 10000 });
        console.log('  ✓ BGM modal closed successfully.');

        console.log('Step 5: Opening Pages tab and Fullscreen Book View...');
        await page.click('.crm-books-tab[data-books-tab="pages"]');
        await page.waitForSelector('.crm-books-open-bookview', { timeout: 15000 });
        await page.click('.crm-books-open-bookview');
        await page.waitForSelector('.crm-bv-overlay', { timeout: 15000 });
        console.log('  ✓ Fullscreen Book View opened.');

        console.log('Step 6: Verifying Audio Player components in Book View top-right...');
        await page.waitForSelector('.crm-bv-player', { timeout: 10000 });
        await page.waitForSelector('.crm-bv-player-play', { timeout: 10000 });
        await page.waitForSelector('.crm-bv-player-prev', { timeout: 10000 });
        await page.waitForSelector('.crm-bv-player-next', { timeout: 10000 });
        await page.waitForSelector('.crm-bv-player-track', { timeout: 10000 });
        await page.waitForSelector('.crm-bv-volume-slider', { timeout: 10000 });
        await page.screenshot({ path: SCREENSHOTS.bookViewPlayer });
        console.log('  ✓ Top-right audio player components verified.');

        console.log('Step 7: Testing Audio Player play/pause toggle...');
        await page.click('.crm-bv-player-play');
        await page.waitForTimeout(500);
        await page.screenshot({ path: SCREENSHOTS.bookViewPlaying });
        
        console.log('Step 8: Testing Volume interaction...');
        await page.hover('.crm-bv-volume-wrapper');
        await page.waitForTimeout(300);
        await page.screenshot({ path: SCREENSHOTS.bookViewVolume });

        console.log('Step 9: Testing exit book view...');
        await page.click('.crm-bv-close');
        await page.waitForSelector('.crm-bv-overlay', { state: 'detached', timeout: 10000 });
        console.log('  ✓ Fullscreen Book View closed cleanly.');

        console.log('All tests passed successfully!');
    } catch (err) {
        console.error('Test failed:', err);
        process.exitCode = 1;
    } finally {
        await browser.close();
    }
})();
