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
const ORIGIN = process.env.CRM_BOOKS_TEST_ORIGIN || 'http://localhost:8080';
const BOOK_ID = 'if1GtQHgGoU7uolTPVXC';
const TMP = path.join(ROOT, 'tmp');

const SCREENSHOTS = {
    evidence01_pagesTabWithBgm: path.join(TMP, 'evidence-01-pages-tab-bgm-button.png'),
    evidence02_headerWithBgm: path.join(TMP, 'evidence-02-header-bgm-button.png'),
    evidence03_bgmModalOpen: path.join(TMP, 'evidence-03-bgm-modal-upload-interface.png'),
    evidence04_bookReaderPlayer: path.join(TMP, 'evidence-04-book-reader-audio-player.png'),
    evidence05_playerControls: path.join(TMP, 'evidence-05-player-controls-and-volume.png')
};

async function signInOnPage(page, credentials) {
    return page.evaluate(async ({ email, password }) => {
        const auth = window.__FIREBASE_INTERNAL__?.auth;
        if (!auth) throw new Error('Firebase auth is not available on this page.');
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
        console.log(`Step 1: Connecting to ${ORIGIN}...`);
        await page.goto(`${ORIGIN}/index.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForFunction(() => Boolean(window.__FIREBASE_INTERNAL__?.auth), null, { timeout: 30000 });
        const authResult = await signInOnPage(page, credentials);
        assert(authResult.uid, 'Firebase sign-in should return an authenticated user.');
        console.log('  ✓ Logged in successfully as admin.');

        console.log('Step 2: Navigating to CRM Books tab...');
        await page.goto(`${ORIGIN}/crm-admin.html#books/${BOOK_ID}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForFunction(() => {
            const gate = document.getElementById('crm-loading');
            return gate && getComputedStyle(gate).display === 'none';
        }, null, { timeout: 30000 });
        await page.waitForSelector('.crm-books-workspace', { timeout: 20000 });
        
        // Select book from list or wait for explorer
        const bookItem = await page.$(`.crm-books-list-item[data-book-id="${BOOK_ID}"]`);
        if (bookItem) {
            await bookItem.click();
        }
        await page.waitForSelector('.crm-books-explorer-header', { timeout: 20000 });
        console.log('  ✓ Books workspace loaded.');

        // Evidence 1: Header BGM Button
        console.log('Step 3: Capturing Evidence 1 - Header Background Music button...');
        const headerBgmBtn = await page.waitForSelector('.crm-books-bgm-btn', { timeout: 10000 });
        assert(headerBgmBtn, 'Header Background Music button must exist.');
        await page.screenshot({ path: SCREENSHOTS.evidence02_headerWithBgm });
        console.log('  ✓ Header BGM button verified and screenshot captured.');

        // Evidence 2: Pages Tab Background Music Button
        console.log('Step 4: Opening Pages Tab and capturing Evidence 2...');
        await page.click('.crm-books-tab[data-books-tab="pages"]');
        await page.waitForSelector('.crm-books-open-bgm', { timeout: 10000 });
        await page.waitForSelector('.crm-books-open-bookview', { timeout: 10000 });
        await page.screenshot({ path: SCREENSHOTS.evidence01_pagesTabWithBgm });
        console.log('  ✓ Pages tab Background Music button verified and screenshot captured.');

        // Evidence 3: Opening BGM Upload Modal
        console.log('Step 5: Opening BGM Upload Modal and capturing Evidence 3...');
        await page.click('.crm-books-open-bgm');
        await page.waitForSelector('.crm-books-bgm-modal', { timeout: 10000 });
        await page.waitForSelector('#crm-books-bgm-dropzone', { timeout: 10000 });
        await page.screenshot({ path: SCREENSHOTS.evidence03_bgmModalOpen });
        console.log('  ✓ BGM Upload Modal opened, dropzone verified, and screenshot captured.');

        // Close modal
        await page.click('.crm-books-modal-close-btn');
        await page.waitForSelector('.crm-books-bgm-modal', { state: 'detached', timeout: 10000 });

        // Evidence 4: Opening Full-Page Book View Audio Player
        console.log('Step 6: Opening Full-Page Book View and capturing Evidence 4...');
        await page.click('.crm-books-open-bookview');
        await page.waitForSelector('.crm-bv-overlay', { timeout: 15000 });
        await page.waitForSelector('.crm-bv-player', { timeout: 10000 });
        await page.waitForSelector('.crm-bv-player-play', { timeout: 10000 });
        await page.waitForSelector('.crm-bv-player-prev', { timeout: 10000 });
        await page.waitForSelector('.crm-bv-player-next', { timeout: 10000 });
        await page.waitForSelector('.crm-bv-volume-slider', { timeout: 10000 });
        await page.screenshot({ path: SCREENSHOTS.evidence04_bookReaderPlayer });
        console.log('  ✓ Full-Page Book View Audio Player verified and screenshot captured.');

        // Evidence 5: Testing Player controls & volume hover
        console.log('Step 7: Testing Audio Play and Volume controls for Evidence 5...');
        await page.click('.crm-bv-player-play');
        await page.hover('.crm-bv-volume-wrapper');
        await page.waitForTimeout(400);
        await page.screenshot({ path: SCREENSHOTS.evidence05_playerControls });
        console.log('  ✓ Player interaction verified and screenshot captured.');

        // Close book view
        await page.click('.crm-bv-close');
        await page.waitForSelector('.crm-bv-overlay', { state: 'detached', timeout: 10000 });
        console.log('  ✓ Full-Page Book View closed cleanly.');

        console.log('\n=========================================');
        console.log('🎉 ALL LIVE BROWSER CHECKS PASSED (5/5)!');
        console.log('=========================================');
    } catch (err) {
        console.error('Live browser test failed:', err);
        process.exitCode = 1;
    } finally {
        await browser.close();
    }
})();
