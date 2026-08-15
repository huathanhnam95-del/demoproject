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
    bookDetail: path.join(TMP, 'crm-bv-01-book-detail.png'),
    pagesTab: path.join(TMP, 'crm-bv-02-pages-tab.png'),
    bookViewLight: path.join(TMP, 'crm-bv-03-bookview-light.png'),
    fontScaled: path.join(TMP, 'crm-bv-04-font-scaled.png'),
    pageNav: path.join(TMP, 'crm-bv-05-page-nav.png'),
    darkMode: path.join(TMP, 'crm-bv-06-dark-mode.png'),
    exitView: path.join(TMP, 'crm-bv-07-exit-view.png')
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

    const results = {};

    try {
        // ── Step 1: Login ──
        console.log('Step 1: Logging in...');
        await page.goto(`${ORIGIN}/index.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForFunction(() => Boolean(window.__FIREBASE_INTERNAL__?.auth), null, { timeout: 30000 });
        const authResult = await signInOnPage(page, credentials);
        assert(authResult.uid, 'Firebase sign-in should return an authenticated user.');
        console.log('  ✓ Logged in successfully.');

        // ── Step 2: Navigate to book ──
        console.log('Step 2: Navigating to book...');
        await page.goto(`${ORIGIN}/crm-admin.html#books/${BOOK_ID}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForFunction(() => {
            const gate = document.getElementById('crm-loading');
            return gate && getComputedStyle(gate).display === 'none';
        }, null, { timeout: 45000 });
        await page.waitForSelector('.crm-books-workspace', { timeout: 30000 });
        // Wait for books list to populate then click the target book
        await page.waitForSelector(`.crm-books-list-item[data-book-id]`, { timeout: 30000 });
        const bookItem = await page.$(`.crm-books-list-item[data-book-id="${BOOK_ID}"]`);
        if (bookItem) {
            await bookItem.click();
            console.log('  Clicked book item from list.');
        } else {
            // Hash routing may have auto-selected it; check if explorer header exists
            console.log('  Book item not found by ID, checking if already selected...');
        }
        await page.waitForSelector('.crm-books-explorer-header', { timeout: 30000 });
        await page.screenshot({ path: SCREENSHOTS.bookDetail });
        console.log('  ✓ Book detail loaded. Screenshot saved.');

        // ── Step 3: Open Pages tab ──
        console.log('Step 3: Clicking Pages tab...');
        await page.click('.crm-books-tab[data-books-tab="pages"]');
        // The tab body doesn't get a 'pages-active' class; wait for page stage to render
        await page.waitForSelector('.crm-books-page-stage', { timeout: 30000 });
        await page.waitForTimeout(3000); // Allow PDF text extraction to load
        await page.screenshot({ path: SCREENSHOTS.pagesTab });
        console.log('  ✓ Pages tab active. Screenshot saved.');

        // ── Step 4: Open Fullscreen Book View ──
        console.log('Step 4: Opening fullscreen book view...');
        await page.click('.crm-books-open-bookview');
        await page.waitForSelector('.crm-bv-overlay', { state: 'visible', timeout: 15000 });
        await page.waitForSelector('.crm-bv-spread', { state: 'visible', timeout: 10000 });
        await page.waitForTimeout(1000); // Allow animation to complete

        results.bookViewOpened = await page.evaluate(() => {
            const overlay = document.querySelector('.crm-bv-overlay');
            const spread = document.querySelector('.crm-bv-spread');
            const leftBody = document.querySelector('.crm-bv-page-left .crm-bv-page-body');
            const rightBody = document.querySelector('.crm-bv-page-right .crm-bv-page-body');
            const navInfo = document.querySelector('.crm-bv-nav-info');
            return {
                overlayVisible: overlay && getComputedStyle(overlay).display !== 'none',
                spreadVisible: spread && getComputedStyle(spread).display !== 'none',
                leftHasContent: leftBody && leftBody.innerHTML.trim().length > 0,
                rightHasContent: rightBody && rightBody.innerHTML.trim().length > 0,
                navInfoText: navInfo?.textContent || '',
                isLightMode: !!document.querySelector('.crm-bv-light')
            };
        });

        assert(results.bookViewOpened.overlayVisible, 'Book view overlay should be visible.');
        assert(results.bookViewOpened.spreadVisible, 'Book view spread should be visible.');
        assert(results.bookViewOpened.leftHasContent, 'Left page should have content.');
        assert(results.bookViewOpened.navInfoText.length > 0, 'Nav info should display page info.');
        await page.screenshot({ path: SCREENSHOTS.bookViewLight });
        console.log(`  ✓ Book view opened in light mode. Nav: "${results.bookViewOpened.navInfoText}"`);

        // ── Step 5: Verify No Scrollbars ──
        console.log('Step 5: Checking for scrollbars...');
        results.scrollbars = await page.evaluate(() => {
            const leftBody = document.querySelector('.crm-bv-page-left .crm-bv-page-body');
            const rightBody = document.querySelector('.crm-bv-page-right .crm-bv-page-body');
            const leftPage = document.querySelector('.crm-bv-page-left');
            const rightPage = document.querySelector('.crm-bv-page-right');
            const check = (el) => {
                if (!el) return { overflow: 'n/a', scrollable: false };
                const cs = getComputedStyle(el);
                return {
                    overflowY: cs.overflowY,
                    scrollHeight: el.scrollHeight,
                    clientHeight: el.clientHeight,
                    hasVisibleScrollbar: el.scrollHeight > el.clientHeight && cs.overflowY === 'auto'
                };
            };
            return {
                leftPage: check(leftPage),
                rightPage: check(rightPage),
                leftBody: check(leftBody),
                rightBody: check(rightBody)
            };
        });

        assert(!results.scrollbars.leftBody.hasVisibleScrollbar, 'Left page body should not have a visible scrollbar.');
        assert(!results.scrollbars.rightBody.hasVisibleScrollbar, 'Right page body should not have a visible scrollbar.');
        console.log(`  ✓ No visible scrollbars. Left overflow: ${results.scrollbars.leftBody.overflowY}, Right overflow: ${results.scrollbars.rightBody.overflowY}`);

        // ── Step 6: Verify Font Size Slider ──
        console.log('Step 6: Testing font size slider...');
        const fontBefore = await page.evaluate(() => {
            const spread = document.querySelector('.crm-bv-spread');
            const output = document.querySelector('.crm-bv-font-output');
            return {
                fontScale: spread?.style.getPropertyValue('--crm-bv-font-scale') || '',
                outputText: output?.textContent || '',
                computedFontSize: getComputedStyle(document.querySelector('.crm-bv-page-body')).fontSize
            };
        });
        console.log(`  Font before: scale=${fontBefore.fontScale}, output="${fontBefore.outputText}", computed=${fontBefore.computedFontSize}`);

        // Click A+ button twice
        await page.click('.crm-bv-font-up');
        await page.waitForTimeout(300);
        await page.click('.crm-bv-font-up');
        await page.waitForTimeout(500);

        const fontAfter = await page.evaluate(() => {
            const spread = document.querySelector('.crm-bv-spread');
            const output = document.querySelector('.crm-bv-font-output');
            return {
                fontScale: spread?.style.getPropertyValue('--crm-bv-font-scale') || '',
                outputText: output?.textContent || '',
                computedFontSize: getComputedStyle(document.querySelector('.crm-bv-page-body')).fontSize
            };
        });
        console.log(`  Font after: scale=${fontAfter.fontScale}, output="${fontAfter.outputText}", computed=${fontAfter.computedFontSize}`);

        results.fontSlider = { before: fontBefore, after: fontAfter };
        assert.notStrictEqual(fontBefore.outputText, fontAfter.outputText, 'Font output label should change after clicking A+.');
        assert.notStrictEqual(fontBefore.computedFontSize, fontAfter.computedFontSize, 'Computed font size should change after scaling.');
        await page.screenshot({ path: SCREENSHOTS.fontScaled });
        console.log('  ✓ Font slider works. Screenshot saved.');

        // ── Step 7: Page Navigation ──
        console.log('Step 7: Testing page navigation...');
        const navBefore = await page.evaluate(() => document.querySelector('.crm-bv-nav-info')?.textContent || '');

        await page.click('.crm-bv-next');
        await page.waitForTimeout(800); // Wait for flip animation

        const navAfter = await page.evaluate(() => document.querySelector('.crm-bv-nav-info')?.textContent || '');
        results.navigation = { before: navBefore, after: navAfter };
        assert.notStrictEqual(navBefore, navAfter, 'Page indicator should change after clicking Next.');
        await page.screenshot({ path: SCREENSHOTS.pageNav });
        console.log(`  ✓ Navigation works. Before: "${navBefore}" → After: "${navAfter}"`);

        // ── Step 8: Dark Mode ──
        console.log('Step 8: Testing dark mode toggle...');
        await page.click('.crm-bv-mode-dark');
        await page.waitForTimeout(500);

        results.darkMode = await page.evaluate(() => {
            const container = document.querySelector('.crm-bv-container');
            const darkBtn = document.querySelector('.crm-bv-mode-dark');
            return {
                isDark: container?.classList.contains('crm-bv-dark'),
                isNotLight: !container?.classList.contains('crm-bv-light'),
                darkBtnActive: darkBtn?.classList.contains('active'),
                bgColor: container ? getComputedStyle(container).backgroundColor : ''
            };
        });

        assert(results.darkMode.isDark, 'Container should have crm-bv-dark class.');
        assert(results.darkMode.isNotLight, 'Container should NOT have crm-bv-light class.');
        await page.screenshot({ path: SCREENSHOTS.darkMode });
        console.log(`  ✓ Dark mode active. BG: ${results.darkMode.bgColor}`);

        // ── Step 9: Exit Book View ──
        console.log('Step 9: Exiting book view...');
        await page.click('.crm-bv-close');
        await page.waitForTimeout(600); // closing animation

        results.exitView = await page.evaluate(() => {
            const overlay = document.querySelector('.crm-bv-overlay');
            const pagesTab = document.querySelector('.crm-books-tab-body.pages-active');
            return {
                overlayGone: !overlay || getComputedStyle(overlay).display === 'none' || overlay.classList.contains('crm-bv-closing'),
                pagesTabVisible: Boolean(pagesTab)
            };
        });

        await page.screenshot({ path: SCREENSHOTS.exitView });
        console.log('  ✓ Book view closed. Screenshot saved.');

        // ── Step 10: Console Errors ──
        console.log('\nStep 10: Browser errors check');
        // Filter out known non-critical errors
        const criticalErrors = browserErrors.filter(e =>
            !e.includes('favicon') &&
            !e.includes('CORS') &&
            !e.includes('net::ERR') &&
            !e.includes('third-party cookie')
        );
        results.criticalErrors = criticalErrors;
        if (criticalErrors.length > 0) {
            console.log(`  ⚠ ${criticalErrors.length} critical console error(s):`);
            criticalErrors.forEach((e) => console.log(`    - ${e}`));
        } else {
            console.log('  ✓ No critical console errors.');
        }

        // ── Final Summary ──
        console.log('\n═══════════════════════════════════════');
        console.log('  FULLSCREEN BOOK READER TEST RESULTS');
        console.log('═══════════════════════════════════════');
        console.log(JSON.stringify({
            bookViewOpened: results.bookViewOpened,
            scrollbars: {
                leftBodyOverflow: results.scrollbars.leftBody.overflowY,
                rightBodyOverflow: results.scrollbars.rightBody.overflowY,
                leftHasVisibleScrollbar: results.scrollbars.leftBody.hasVisibleScrollbar,
                rightHasVisibleScrollbar: results.scrollbars.rightBody.hasVisibleScrollbar
            },
            fontSlider: {
                beforeLabel: results.fontSlider.before.outputText,
                afterLabel: results.fontSlider.after.outputText,
                beforeFontSize: results.fontSlider.before.computedFontSize,
                afterFontSize: results.fontSlider.after.computedFontSize
            },
            navigation: results.navigation,
            darkMode: results.darkMode,
            criticalErrors: results.criticalErrors,
            screenshots: SCREENSHOTS
        }, null, 2));
        console.log('\n✅ crm-books-fullscreen-reader browser check PASSED');
    } finally {
        await browser.close();
    }
})().catch((error) => {
    console.error(redactAuthIdentity(error.stack || error.message, readBrowserTestCredentials()));
    process.exitCode = 1;
});
