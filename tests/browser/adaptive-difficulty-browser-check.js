const { chromium } = require('playwright');
const express = require('express');
const path = require('path');

(async () => {
    let server;
    let baseUrl = process.env.BASE_URL;

    if (!baseUrl) {
        const app = express();
        app.use(express.static(path.join(__dirname, '../../public')));
        server = await new Promise((resolve) => {
            const s = app.listen(0, '127.0.0.1', () => resolve(s));
        });
        baseUrl = `http://127.0.0.1:${server.address().port}/index.html`;
    }

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1024 } });
    await context.addInitScript(() => {
        window.localStorage.setItem('userStatus', 'guest');
        window.localStorage.setItem('hasSeenScopeTutorial', 'true');
    });
    const page = await context.newPage();
    const errors = [];

    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (msg) => {
        if (msg.type() === 'error') {
            const text = msg.text();
            if (!/Failed to load resource|CORS policy|praat-api|Error fetching word data/i.test(text)) {
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

    const notesContainerExists = await page.locator('#difficulty-filter-container-notes').count();
    if (notesContainerExists !== 1) {
        throw new Error('Expected notes difficulty filter element to exist');
    }

    const extendedContainerExists = await page.locator('#difficulty-filter-container-extended').count();
    if (extendedContainerExists !== 1) {
        throw new Error('Expected extended difficulty filter element to exist');
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
