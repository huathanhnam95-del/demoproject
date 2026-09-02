const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { readBrowserTestCredentials } = require('./helpers/browser-test-credentials');

const ROOT = path.resolve(__dirname, '../..');
const ORIGIN = 'https://betterenglishlearning.com';
const BOOK_ID = 'if1GtQHgGoU7uolTPVXC';

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
        await page.waitForTimeout(2000);

        console.log(`4. Selecting Book ${BOOK_ID}...`);
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
            console.log(`\nNavigating to physical page ${num}...`);
            const input = page.locator('.crm-books-page-input');
            await input.waitFor({ state: 'visible', timeout: 10000 });
            await input.fill(String(num));
            await input.evaluate((el) => {
                el.dispatchEvent(new Event('change', { bubbles: true }));
            });
            await page.waitForTimeout(2000);
            await page.waitForFunction((targetNum) => {
                const el = document.querySelector('.crm-books-page-paper[data-page-number]');
                return el && el.getAttribute('data-page-number') === String(targetNum);
            }, num, { timeout: 10000 });
        }

        // --- PAGE 6 ---
        await jumpToPage(6);
        const p6Text = await page.locator('.crm-books-page-content').first().innerText();
        console.log('DOM Text Page 6:\n' + p6Text);
        assert(!p6Text.includes('Spec ias'), 'Page 6 must not contain "Spec ias"');
        assert(p6Text.includes('Species'), 'Page 6 must contain "Species"');
        fs.mkdirSync(path.join(ROOT, 'artifacts'), { recursive: true });
        await page.screenshot({ path: path.join(ROOT, 'artifacts/adult_learner_page_6.png') });
        console.log('Saved artifacts/adult_learner_page_6.png');

        // --- PAGE 8 ---
        await jumpToPage(8);
        const p8Text = await page.locator('.crm-books-page-content').first().innerText();
        console.log('DOM Text Page 8:\n' + p8Text.slice(0, 300));
        assert(!p8Text.includes('*HIS DO CLAP ENT'), 'Page 8 must not contain garbled OCR artifacts');
        assert(p8Text.includes('NATIONAL INSTITUTE OF EDUCATION') || p8Text.includes('U.S. DEPARTMENT OF HEALTH'), 'Page 8 must contain clean official notice');
        await page.screenshot({ path: path.join(ROOT, 'artifacts/adult_learner_page_8.png') });
        console.log('Saved artifacts/adult_learner_page_8.png');

        // --- PAGE 10 ---
        await jumpToPage(10);
        const p10Text = await page.locator('.crm-books-page-content').first().innerText();
        console.log('DOM Text Page 10:\n' + p10Text.slice(0, 300));
        assert(!p10Text.includes('What Isa Theory'), 'Page 10 must not contain "What Isa Theory"');
        assert(!p10Text.includes('Pro pounders'), 'Page 10 must not contain "Pro pounders"');
        assert(!p10Text.includes('Me chan is tic'), 'Page 10 must not contain "Me chan is tic"');
        assert(!p10Text.includes('Organ is mic'), 'Page 10 must not contain "Organ is mic"');
        assert(p10Text.includes('What Is a Theory') || p10Text.includes('Exploring the Strange World of Learning'), 'Page 10 must contain valid theory headings');
        assert(p10Text.includes('Propounders'), 'Page 10 must contain "Propounders"');
        assert(p10Text.includes('Mechanistic and Organismic'), 'Page 10 must contain "Mechanistic and Organismic"');
        await page.screenshot({ path: path.join(ROOT, 'artifacts/adult_learner_page_10.png') });
        console.log('Saved artifacts/adult_learner_page_10.png');

        // --- PAGE 12 ---
        await jumpToPage(12);
        const p12Text = await page.locator('.crm-books-page-content').first().innerText();
        console.log('DOM Text Page 12:\n' + p12Text.slice(0, 350));
        assert(!p12Text.includes('in es timable'), 'Page 12 must not contain "in es timable"');
        assert(!p12Text.includes('HR Dis based'), 'Page 12 must not contain "HR Dis based"');
        assert(!p12Text.includes('in toa search'), 'Page 12 must not contain "in toa search"');
        assert(p12Text.includes('inestimable'), 'Page 12 must contain "inestimable"');
        assert(p12Text.includes('HRD is based'), 'Page 12 must contain "HRD is based"');
        assert(p12Text.includes('into a search'), 'Page 12 must contain "into a search"');
        assert(p12Text.includes('training directors'), 'Page 12 must contain training directors');
        await page.screenshot({ path: path.join(ROOT, 'artifacts/adult_learner_page_12.png') });
        console.log('Saved artifacts/adult_learner_page_12.png');

        console.log('\n======================================================');
        console.log('SUCCESS: ALL 4 PAGES VERIFIED IN CHROME BROWSER ON PRODUCTION!');
        console.log('======================================================\n');
    } catch (err) {
        console.error('Test error:', err);
        process.exit(1);
    } finally {
        await browser.close();
    }
})();
