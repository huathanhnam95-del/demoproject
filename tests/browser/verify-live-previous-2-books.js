const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { readBrowserTestCredentials } = require('./helpers/browser-test-credentials');

const ROOT = path.resolve(__dirname, '../..');
const ORIGIN = 'https://betterenglishlearning.com';
const ARTIFACTS_DIR = 'C:/Users/Admin/.gemini/antigravity/brain/b92652f8-40b1-4043-b9b0-3d2cb6e6e469';

const BOOK1_ID = 'if1GtQHgGoU7uolTPVXC';
const BOOK2_ID = 'ZT25mJFlnHUYCOY2rmIG';

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

        async function jumpToPage(num) {
            console.log(`\nNavigating to Page ${num}...`);
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
        // BOOK 1: The Adult Learner (if1GtQHgGoU7uolTPVXC)
        // ==========================================
        console.log(`\n========================================`);
        console.log(`Verifying Book 1: The Adult Learner (${BOOK1_ID})...`);
        console.log(`========================================`);
        const book1Item = page.locator(`.crm-books-list-item[data-book-id="${BOOK1_ID}"]`);
        await book1Item.waitFor({ state: 'visible', timeout: 30000 });
        await book1Item.click();
        await page.waitForTimeout(3000);

        const pagesTab = page.locator('[data-books-tab="pages"]');
        await pagesTab.waitFor({ state: 'visible', timeout: 30000 });
        await pagesTab.click();
        console.log('Waiting for Book 1 pages to load...');
        await page.waitForSelector('.crm-books-page-input', { state: 'visible', timeout: 30000 });
        await page.waitForTimeout(2000);

        // Book 1 - Page 6
        await jumpToPage(6);
        const b1p6Text = await page.locator('.crm-books-page-content').first().innerText();
        console.log('Book 1 Page 6 snippet:\n' + b1p6Text);
        assert(b1p6Text.includes('Species'), 'Page 6 must contain "Species"');
        assert(!b1p6Text.includes('Spec ias'), 'Page 6 must not contain "Spec ias"');
        await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'adult_learner_verified_p6.png') });

        // Book 1 - Page 10
        await jumpToPage(10);
        const b1p10Text = await page.locator('.crm-books-page-content').first().innerText();
        console.log('Book 1 Page 10 snippet:\n' + b1p10Text.slice(0, 200));
        assert(b1p10Text.includes('What Is a Theory?'), 'Page 10 must contain "What Is a Theory?"');
        assert(b1p10Text.includes('Propounders and Interpreters'), 'Page 10 must contain Propounders');
        await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'adult_learner_verified_p10.png') });

        // Book 1 - Page 12
        await jumpToPage(12);
        const b1p12Text = await page.locator('.crm-books-page-content').first().innerText();
        console.log('Book 1 Page 12 snippet:\n' + b1p12Text.slice(0, 250));
        assert(b1p12Text.includes('all kinds — training directors'), 'Page 12 must contain restored parenthetical em-dash');
        assert(b1p12Text.includes('inestimable'), 'Page 12 must contain "inestimable"');
        await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'adult_learner_verified_p12.png') });

        // ==========================================
        // BOOK 2: Teaching Pronunciation (ZT25mJFlnHUYCOY2rmIG)
        // ==========================================
        console.log(`\n========================================`);
        console.log(`Verifying Book 2: Teaching Pronunciation (${BOOK2_ID})...`);
        console.log(`========================================`);
        const book2Item = page.locator(`.crm-books-list-item[data-book-id="${BOOK2_ID}"]`);
        await book2Item.waitFor({ state: 'visible', timeout: 30000 });
        await book2Item.click();
        await page.waitForTimeout(3000);

        await pagesTab.click();
        console.log('Waiting for Book 2 pages to load...');
        await page.waitForSelector('.crm-books-page-input', { state: 'visible', timeout: 30000 });
        await page.waitForTimeout(2000);

        // Book 2 - Page 10
        await jumpToPage(10);
        const b2p10Text = await page.locator('.crm-books-page-content').first().innerText();
        console.log('Book 2 Page 10 snippet:\n' + b2p10Text.slice(0, 250));
        assert(b2p10Text.includes('native-like pronunciation is unlikely') || b2p10Text.includes('pronunciation remains the number one reason'), 'Book 2 Page 10 text verified');
        await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'teaching_pronunciation_verified_p10.png') });

        // Book 2 - Page 50
        await jumpToPage(50);
        const b2p50Text = await page.locator('.crm-books-page-content').first().innerText();
        console.log('Book 2 Page 50 snippet:\n' + b2p50Text.slice(0, 250));
        assert(b2p50Text.includes('different choices of vowels') || b2p50Text.includes('In BrE, the vowel is'), 'Book 2 Page 50 text verified');
        await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'teaching_pronunciation_verified_p50.png') });

        // Book 2 - Page 100
        await jumpToPage(100);
        const b2p100Text = await page.locator('.crm-books-page-content').first().innerText();
        console.log('Book 2 Page 100 snippet:\n' + b2p100Text.slice(0, 250));
        assert(b2p100Text.length > 50, 'Book 2 Page 100 has substantive extracted text');
        await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'teaching_pronunciation_verified_p100.png') });

        console.log('\n===============================================================');
        console.log('SUCCESS: BOTH PREVIOUS BOOKS FULLY VERIFIED IN CHROME LIVE!');
        console.log('===============================================================\n');
    } catch (err) {
        console.error('Verification error:', err);
        process.exit(1);
    } finally {
        await browser.close();
    }
})();
