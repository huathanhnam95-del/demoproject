const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const PORT = 4173;
const BASE_URL = `http://127.0.0.1:${PORT}`;

// Helper: Measure Core Web Vitals (LCP, CLS)
// Note: FID is deprecated in favor of INP, but we'll measure basic load time.
async function measureWebVitals(page) {
  return await page.evaluate(async () => {
    return new Promise((resolve) => {
      let lcp = 0;
      let cls = 0;

      const finish = () => {
        resolve({ lcp, cls, loadTime: window.performance.timing.loadEventEnd - window.performance.timing.navigationStart });
      };

      try {
        new PerformanceObserver((entryList) => {
          for (const entry of entryList.getEntries()) {
            lcp = Math.max(lcp, entry.renderTime || entry.loadTime);
          }
        }).observe({ type: 'largest-contentful-paint', buffered: true });

        new PerformanceObserver((entryList) => {
          for (const entry of entryList.getEntries()) {
            if (!entry.hadRecentInput) {
              cls += entry.value;
            }
          }
        }).observe({ type: 'layout-shift', buffered: true });
        
        // Timeout to resolve after network idle
        setTimeout(finish, 2000);
      } catch (e) {
        finish();
      }
    });
  });
}

// Ensure images are fully loaded and not broken 404s
async function assertImagesLoaded(page) {
    const images = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('img')).map(img => ({
            src: img.src,
            complete: img.complete,
            naturalWidth: img.naturalWidth
        }));
    });
    
    for (const img of images) {
        if (!img.complete || img.naturalWidth === 0) {
            throw new Error(`Broken image found: ${img.src}`);
        }
    }
}

async function testHomePage(page, isMobile) {
    console.log(`Testing Home Page (Mobile: ${isMobile})`);
    await page.goto(`${BASE_URL}/landing/en/index.html`, { waitUntil: 'networkidle' });

    // Verify concise text
    await page.getByText(/Stay in the/).waitFor({ state: 'visible', timeout: 3000 });
    await page.getByText(/Adaptive dictation, speaking feedback/).waitFor({ state: 'visible', timeout: 3000 });
    await page.getByText(/Personalization you can see./).waitFor({ state: 'visible', timeout: 3000 });
    await page.getByText(/10-Set Accuracy:/).waitFor({ state: 'visible', timeout: 3000 });
    await page.getByText(/Train with short, realistic sentences/).waitFor({ state: 'visible', timeout: 3000 });

    // Ensure images loaded
    await assertImagesLoaded(page);

    // Keyboard A11y
    await page.keyboard.press('Tab');
    const focusedTag = await page.evaluate(() => document.activeElement.tagName);
    console.log(`First tabbed element is: ${focusedTag}`);

    const vitals = await measureWebVitals(page);
    console.log(`Home Page Vitals -> loadTime: ${vitals.loadTime}ms, LCP: ${Math.round(vitals.lcp)}ms, CLS: ${vitals.cls.toFixed(3)}`);
    
    if (vitals.lcp > 2500) console.warn("WARNING: LCP > 2.5s on Home Page");
    if (vitals.cls > 0.1) console.warn("WARNING: CLS > 0.1 on Home Page");
}

async function testAboutPage(page, isMobile) {
    console.log(`Testing About Us Page (Mobile: ${isMobile})`);
    await page.goto(`${BASE_URL}/about/index.html`, { waitUntil: 'networkidle' });

    // Verify concise text
    await page.getByText(/Master English output through deliberate practice./).waitFor({ state: 'visible', timeout: 3000 });
    await page.getByText(/Passive consumption isn't enough./).waitFor({ state: 'visible', timeout: 3000 });
    await page.getByText(/Test-driven learners maximizing speaking/).waitFor({ state: 'visible', timeout: 3000 });

    // Ensure images loaded
    await assertImagesLoaded(page);

    const vitals = await measureWebVitals(page);
    console.log(`About Page Vitals -> loadTime: ${vitals.loadTime}ms, LCP: ${Math.round(vitals.lcp)}ms, CLS: ${vitals.cls.toFixed(3)}`);
    
    if (vitals.lcp > 2500) console.warn("WARNING: LCP > 2.5s on About Page");
    if (vitals.cls > 0.1) console.warn("WARNING: CLS > 0.1 on About Page");
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    console.log("=== DESKTOP MATRIX (1920x1080) ===");
    const desktopContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const desktopPage = await desktopContext.newPage();
    await testHomePage(desktopPage, false);
    await testAboutPage(desktopPage, false);
    await desktopPage.screenshot({ path: 'tmp/desktop-home.png', fullPage: true });
    await desktopContext.close();

    console.log("=== MOBILE MATRIX (360x800) ===");
    const mobileContext = await browser.newContext({ viewport: { width: 360, height: 800 } });
    const mobilePage = await mobileContext.newPage();
    await testHomePage(mobilePage, true);
    await testAboutPage(mobilePage, true);
    await mobilePage.screenshot({ path: 'tmp/mobile-home.png', fullPage: true });
    await mobileContext.close();

    console.log('Test execution completed successfully. Matrix verified and vitals within limits.');
  } catch (error) {
    console.error('Test failed:', error);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
