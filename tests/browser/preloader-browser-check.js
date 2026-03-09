const { chromium } = require('playwright');

(async () => {
    const reducedMotion = process.argv.includes('--reduced-motion');
    const mobileLow = process.argv.includes('--mobile-low');

    const viewport = mobileLow
        ? { width: 390, height: 844 }
        : { width: 1440, height: 1024 };

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const errors = [];

    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(msg.text());
    });

    if (reducedMotion) {
        await page.emulateMedia({ reducedMotion: 'reduce' });
    }

    console.log(`Navigating to http://127.0.0.1:4173/index.html (Reduced Motion: ${reducedMotion}, Mobile Low: ${mobileLow})`);

    try {
        await page.goto('http://127.0.0.1:4173/index.html', { waitUntil: 'domcontentloaded' });
    } catch (err) {
        console.error(`Navigation failed: ${err.message}`);
        process.exit(1);
    }

    // Wait long enough for the preloader to be in a stable state
    await page.waitForTimeout(1500);

    const preloader = page.locator('#app-preloader');
    const isVisible = await preloader.isVisible();
    const display = await preloader.evaluate((el) => getComputedStyle(el).display);

    console.log(`Preloader visibility: ${isVisible}, display: ${display}`);

    if (display !== 'block' && display !== 'flex') {
        throw new Error(`Expected preloader display=block or flex, got ${display}`);
    }

    const hasReducedMotionClass = await preloader.evaluate((el) => el.classList.contains('reduced-motion'));
    if (reducedMotion && !hasReducedMotionClass) {
        throw new Error('Expected reduced-motion class on preloader');
    }

    if (errors.length) {
        console.error('Browser errors detected:');
        errors.forEach(err => console.error(`- ${err}`));
        throw new Error('Verification failed due to browser errors.');
    }

    let screenshotPath = 'tmp/preloader-browser-standard.png';
    if (reducedMotion) screenshotPath = 'tmp/preloader-browser-reduced-motion.png';
    if (mobileLow) screenshotPath = 'tmp/preloader-browser-mobile-low.png';

    await page.screenshot({ path: screenshotPath });
    console.log(`Screenshot saved to ${screenshotPath}`);

    await browser.close();
    console.log('Verification complete.');
})();
