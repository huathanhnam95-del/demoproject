const { chromium } = require('playwright');
const assert = require('assert');
const path = require('path');
const fs = require('fs');

async function run() {
    console.log('--- Verifying Books Elaborate Tool on Production ---');
    const browser = await chromium.launch({
        headless: true,
        channel: 'chrome'
    });
    const context = await browser.newContext({
        viewport: { width: 1400, height: 900 }
    });

    await context.addInitScript(() => {
        try {
            sessionStorage.setItem('welcome_onboarding_completed', 'true');
        } catch (_) {}
    });

    const page = await context.newPage();

    page.on('console', msg => {
        if (msg.type() === 'error') console.log('[BROWSER ERROR]', msg.text());
    });

    try {
        console.log('1. Navigating to https://betterenglishlearning.com/index.html...');
        await page.goto('https://betterenglishlearning.com/index.html', {
            waitUntil: 'domcontentloaded',
            timeout: 45000
        });

        console.log('2. Authenticating via firebaseAuthFunctions.signIn...');
        await page.waitForFunction(() => !!(window.firebaseAuthFunctions && window.firebaseAuthFunctions.signIn), { timeout: 30000 });
        const loginRes = await page.evaluate(async () => {
            return await window.firebaseAuthFunctions.signIn('huathanhnam95@gmail.com', 'Alphaein@1new');
        });
        console.log('Login success:', loginRes && loginRes.success);
        assert(loginRes && loginRes.success, 'Login must succeed');

        await page.waitForTimeout(3000);

        console.log('3. Navigating to https://betterenglishlearning.com/crm-admin.html#books...');
        await page.goto('https://betterenglishlearning.com/crm-admin.html#books', {
            waitUntil: 'domcontentloaded',
            timeout: 45000
        });

        console.log('4. Waiting for CRM Books panel...');
        await page.waitForSelector('[data-panel="books"]', { timeout: 30000 });
        console.log('✓ CRM Books panel is visible in production!');

        // Wait for folder to render in sidebar
        console.log('5. Waiting for collection folder to render...');
        await page.waitForSelector('.crm-books-folder-title-wrap', { timeout: 20000 });

        // Check if folder is collapsed; if so, click to expand it
        const isCollapsed = await page.evaluate(() => {
            const content = document.querySelector('.crm-books-folder-content');
            return content ? content.classList.contains('collapsed') : false;
        });
        if (isCollapsed) {
            console.log('Expanding collection folder...');
            await page.click('.crm-books-folder-title-wrap');
            await page.waitForTimeout(1000);
        }

        // Wait for book item to be visible and click it
        console.log('6. Selecting book from collection...');
        const bookItem = page.locator('.crm-books-list-item').first();
        await bookItem.waitFor({ state: 'visible', timeout: 10000 });
        await bookItem.click();
        await page.waitForTimeout(3000);

        // Verify the Elaborate button in the Explorer header
        console.log('7. Checking for .crm-books-elaborate-btn in Explorer header...');
        const elaborateBtn = page.locator('.crm-books-elaborate-btn').first();
        await elaborateBtn.waitFor({ state: 'visible', timeout: 15000 });
        console.log('✓ Found .crm-books-elaborate-btn in production Explorer header!');
        const btnText = await elaborateBtn.textContent();
        console.log('Button text:', btnText.trim());
        assert(btnText.includes('Elaborate'), 'Button should contain "Elaborate" text');

        // Verify the Elaborate Drawer exists in DOM
        const drawer = page.locator('#crm-books-elaborate-drawer');
        assert.strictEqual(await drawer.count(), 1, '#crm-books-elaborate-drawer must exist in DOM');

        // Click the Elaborate button to toggle Elaborate Mode
        console.log('8. Clicking Elaborate button to activate Elaborate Mode...');
        await elaborateBtn.click();
        await page.waitForTimeout(1500);

        // Verify button has .active class
        const isActive = await elaborateBtn.evaluate(el => el.classList.contains('active'));
        assert.strictEqual(isActive, true, 'Elaborate button should have active class');
        console.log('✓ Elaborate button is active in production!');

        // Verify tray is visible
        const tray = page.locator('#crm-books-elaborate-tray');
        await tray.waitFor({ state: 'visible', timeout: 5000 });
        console.log('✓ Floating selection tray is visible in production!');
        const trayText = await tray.textContent();
        console.log('Tray text:', trayText.trim());

        // Capture screenshot of verified production state
        const screenshotDir = path.join(__dirname, '../../artifacts');
        if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });
        const screenshotPath = path.join(screenshotDir, 'production-books-elaborate-verified.png');
        await page.screenshot({ path: screenshotPath, fullPage: false });
        console.log(`✓ Screenshot saved to ${screenshotPath}`);

        console.log('--- Production Verification Successful! ---');
    } finally {
        await browser.close();
    }
}

run().catch(err => {
    console.error('Production verification failed:', err);
    process.exit(1);
});
