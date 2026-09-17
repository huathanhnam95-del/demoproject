'use strict';
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

async function startServerIfNeeded() {
  const testReq = () => new Promise((resolve) => {
    const req = http.get('http://127.0.0.1:4173/index.html', (res) => {
      res.resume();
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(500, () => { req.destroy(); resolve(false); });
  });

  if (await testReq()) {
    return { origin: 'http://127.0.0.1:4173', close: () => {} };
  }

  const app = express();
  const publicDir = path.join(__dirname, '..', '..', 'public');
  app.use(express.static(publicDir));

  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(4173, '127.0.0.1', () => {
      resolve({ origin: 'http://127.0.0.1:4173', close: () => server.close() });
    });
  });
}

(async () => {
  const reducedMotion = process.argv.includes('--reduced-motion');
  const mobileLow = process.argv.includes('--mobile-low');

  const viewport = mobileLow
    ? { width: 390, height: 844 }
    : { width: 1440, height: 1024 };

  const { origin, close: closeServer } = await startServerIfNeeded();
  const baseUrl = `${origin}/index.html`;

  const browser = await chromium.launch({ headless: true });

  try {
    // ── Scenario 1: Readiness after DOM Ready + Reduced Motion / Mobile Viewport ──
    console.log(`[Scenario 1] Testing readiness after DOM ready (Reduced Motion: ${reducedMotion}, Mobile Low: ${mobileLow})`);
    {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (err) => errors.push(err.message));

      if (reducedMotion) {
        await page.emulateMedia({ reducedMotion: 'reduce' });
      }

      await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });

      const preloader = page.locator('#app-preloader');
      const hasReducedMotion = await preloader.evaluate((el) => el.classList.contains('reduced-motion'));
      if (reducedMotion && !hasReducedMotion) {
        throw new Error('Expected reduced-motion class on preloader element.');
      }

      // Signal shell ready and verify immediate dismissal without forced minimum duration
      await page.evaluate(() => window.BELBoot?.shellReady());
      await page.waitForFunction(() =>
        document.documentElement.dataset.bootStatus === 'ready' &&
        getComputedStyle(document.getElementById('app-preloader')).display === 'none' &&
        !document.body.classList.contains('loading-active')
      );

      fs.mkdirSync('tmp', { recursive: true });
      let screenshotPath = 'tmp/preloader-browser-standard.png';
      if (reducedMotion) screenshotPath = 'tmp/preloader-browser-reduced-motion.png';
      if (mobileLow) screenshotPath = 'tmp/preloader-browser-mobile-low.png';
      await page.screenshot({ path: screenshotPath });
      console.log(`Screenshot saved to ${screenshotPath}`);

      if (errors.length) {
        throw new Error(`Browser errors detected in Scenario 1: ${errors.join(', ')}`);
      }
      await context.close();
    }

    // ── Scenario 2: Readiness arriving BEFORE DOM Ready ──
    console.log('[Scenario 2] Testing readiness signal arriving before DOM ready');
    {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (err) => errors.push(err.message));

      // Signal readiness early in init script
      await page.addInitScript(() => {
        if (typeof window.finishBelPreloader === 'function') {
          window.finishBelPreloader();
        } else {
          // Pre-latch in case finishBelPreloader runs before preloader script
          window.__earlyReady = true;
          Object.defineProperty(window, 'finishBelPreloader', {
            configurable: true,
            set(fn) { fn(); },
            get() { return () => {}; }
          });
        }
      });

      await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });

      await page.waitForFunction(() =>
        document.documentElement.dataset.bootStatus === 'ready' &&
        getComputedStyle(document.getElementById('app-preloader')).display === 'none'
      );

      if (errors.length) {
        throw new Error(`Browser errors detected in Scenario 2: ${errors.join(', ')}`);
      }
      await context.close();
    }

    // ── Scenario 3: Warm session skips branding ──
    console.log('[Scenario 3] Testing warm session skips branding');
    {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (err) => errors.push(err.message));

      await page.addInitScript(() => {
        sessionStorage.setItem('bel_app_loaded', '1');
      });

      await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });

      // In a warm session, overlay must be hidden immediately
      const display = await page.locator('#app-preloader').evaluate((el) => getComputedStyle(el).display);
      if (display !== 'none') {
        throw new Error(`Expected warm session preloader display=none, got ${display}`);
      }

      await page.evaluate(() => window.BELBoot?.shellReady());
      await page.waitForFunction(() => document.documentElement.dataset.bootStatus === 'ready');

      if (errors.length) {
        throw new Error(`Browser errors detected in Scenario 3: ${errors.join(', ')}`);
      }
      await context.close();
    }

    // ── Scenario 4: Blocked storage does not crash preloader ──
    console.log('[Scenario 4] Testing blocked storage resilience');
    {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (err) => errors.push(err.message));

      await page.addInitScript(() => {
        const origGet = Storage.prototype.getItem;
        const origSet = Storage.prototype.setItem;
        Storage.prototype.getItem = function(key) {
          if (key === 'bel_app_loaded') throw new DOMException('Storage access denied', 'SecurityError');
          return origGet.apply(this, arguments);
        };
        Storage.prototype.setItem = function(key, val) {
          if (key === 'bel_app_loaded') throw new DOMException('Storage access denied', 'SecurityError');
          return origSet.apply(this, arguments);
        };
      });

      await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });

      await page.evaluate(() => window.BELBoot?.shellReady());
      await page.waitForFunction(() =>
        document.documentElement.dataset.bootStatus === 'ready' &&
        getComputedStyle(document.getElementById('app-preloader')).display === 'none'
      );

      if (errors.length) {
        throw new Error(`Fatal browser errors in Scenario 4: ${errors.join(', ')}`);
      }
      await context.close();
    }

    console.log('All preloader contract browser verification scenarios passed successfully.');
  } finally {
    await browser.close();
    closeServer();
  }
})();
