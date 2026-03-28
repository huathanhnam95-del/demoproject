const { chromium } = require('playwright');

(async () => {
    const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:4173/index.html';
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1024 } });
    const page = await context.newPage();
    const errors = [];

    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (msg) => {
        if (msg.type() === 'error') {
            const text = msg.text();
            if (!text.includes('Failed to load resource')) {
                errors.push(text);
            }
        }
    });

    console.log(`Navigating to ${baseUrl}`);
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    const modalExists = await page.locator('#adaptive-engine-modal').count();
    if (modalExists !== 1) {
        throw new Error('Adaptive engine modal was not rendered');
    }

    const modeButtons = await page.locator('#adaptive-engine-modal .ae-mode-btn').count();
    if (modeButtons !== 5) {
        throw new Error(`Expected 5 adaptive engine mode tabs, got ${modeButtons}`);
    }

    const typeLabel = await page.locator('#difficulty-filter-label-type').textContent();
    if (!String(typeLabel || '').includes('Recommended')) {
        throw new Error(`Expected Type difficulty label to start as Recommended, got ${typeLabel}`);
    }

    const notesContainerDisplay = await page.locator('#difficulty-filter-container-notes').evaluate((el) => getComputedStyle(el).display);
    if (notesContainerDisplay === 'none') {
        throw new Error('Expected notes difficulty filter to remain visible');
    }

    const extendedContainerDisplay = await page.locator('#difficulty-filter-container-extended').evaluate((el) => getComputedStyle(el).display);
    if (extendedContainerDisplay === 'none') {
        throw new Error('Expected extended difficulty filter to remain visible');
    }

    if (errors.length) {
        console.error('Browser errors detected:');
        errors.forEach((err) => console.error(`- ${err}`));
        throw new Error('Verification failed due to browser errors.');
    }

    await browser.close();
    console.log('Adaptive difficulty browser check passed.');
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
