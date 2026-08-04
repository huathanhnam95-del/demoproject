const assert = require('assert');
const path = require('path');
const net = require('net');
const http = require('http');
const express = require('express');
const { chromium } = require('playwright');

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close(() => {
        if (typeof port === 'number') {
          resolve(port);
          return;
        }
        reject(new Error('Failed to allocate free port'));
      });
    });
    server.on('error', reject);
  });
}

function waitForServer(url, timeoutMs = 15000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      http.get(url, (res) => {
        if (res.statusCode >= 200 && res.statusCode < 400) {
          resolve();
        } else if (Date.now() - startedAt > timeoutMs) {
          reject(new Error(`Server not ready at ${url}`));
        } else {
          setTimeout(check, 100);
        }
      }).on('error', () => {
        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error(`Server not ready at ${url}`));
        } else {
          setTimeout(check, 100);
        }
      });
    };
    check();
  });
}

(async () => {
  console.log('Starting Survival Mode browser verification...');
  const port = await getFreePort();
  const publicDir = path.join(process.cwd(), 'public');
  
  const app = express();
  app.use(express.static(publicDir));
  
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${port}/index.html`;

  await waitForServer(baseUrl);
  console.log(`Static server running at ${baseUrl}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  
  await context.route('**/api/**', (route) => route.fulfill({ status: 200, body: '{}' }));
  await context.route('**/database/**', (route) => route.continue());

  const page = await context.newPage();

  const fatalErrors = [];

  page.on('pageerror', (err) => {
    console.error(`[Unhandled Exception] ${err.stack || err.message}`);
    fatalErrors.push(err.message);
  });

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      console.error(`[Console Error] ${text}`);
      if (text.includes('Illegal invocation') || text.includes('SurvivalGame')) {
        fatalErrors.push(text);
      }
    }
  });

  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    console.log('Page loaded successfully.');

    await page.waitForFunction(() => typeof window.ensureSurvivalGameLoaded === 'function' || typeof window.openSurvivalGame === 'function', { timeout: 10000 });

    console.log('Ensuring Survival Game code is loaded...');
    await page.evaluate(async () => {
      if (typeof window.ensureSurvivalGameLoaded === 'function') {
        await window.ensureSurvivalGameLoaded();
      }
    });

    console.log('Launching Survival Overlay and starting game loop...');
    await page.evaluate(() => {
      if (typeof window._openSurvivalOverlayAndStart === 'function') {
        window._openSurvivalOverlayAndStart();
      } else {
        window.openSurvivalGame();
      }
    });

    await page.waitForTimeout(2000);

    const gameStatus = await page.evaluate(() => {
      const overlay = document.getElementById('survival-game-overlay');
      const canvas = document.getElementById('survival-canvas');
      const instance = window.survivalGame || window._survivalGameInstance;
      return {
        overlayVisible: overlay ? getComputedStyle(overlay).display !== 'none' : false,
        canvasPresent: !!canvas,
        hasInstance: !!instance,
        rafActive: instance ? instance.rafId !== null : false,
        gameState: instance ? instance.state : null
      };
    });

    console.log('Survival Game runtime status:', gameStatus);

    assert(fatalErrors.length === 0, `Fatal JS errors detected during survival mode startup:\n${fatalErrors.join('\n')}`);
    assert(gameStatus.hasInstance, 'SurvivalGame instance missing on window.survivalGame!');
    assert(gameStatus.overlayVisible, 'Survival overlay (#survival-game-overlay) is not visible!');
    assert(gameStatus.rafActive, 'Survival Game requestAnimationFrame loop (rafId) is not active!');
    assert.strictEqual(gameStatus.gameState, 'PLAYING', 'Game state expected to be PLAYING');
    
    console.log('\n✅ BROWSER TEST PASSED: Survival Mode launched, overlay visible, game state is PLAYING, and animation loop running cleanly!');
  } catch (err) {
    console.error('\n❌ BROWSER TEST FAILED:', err.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
    server.close();
  }
})();
