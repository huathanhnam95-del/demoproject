// @ts-check
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const express = require('express');
const { chromium } = require('playwright');

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function normalized(status, score, mode = 'azure_word', challengeId = 'ef-a1-azure-word-001') {
  return {
    schemaVersion: 'echo-forge-analysis-v1',
    status,
    score,
    evaluationMode: mode,
    dimensions: score == null ? {} : { accuracy: score },
    verdict: status,
    engineRevision: 'browser-test-v1',
    challengeId,
    variantId: 'browser-test-variant',
    reasonCode: status === 'unavailable' ? 'REQUEST_FAILED' : null,
  };
}

async function installHooks(page) {
  await page.addInitScript(() => {
    window.__echoAnalysisQueue = [];
    window.__echoHoldAnalysis = false;
    window.__echoReleaseAnalysis = null;
    window.__ECHO_FORGE_TEST_HOOKS__ = {
      seed: 42,
      singleFight: false,
      analysisClient: { prewarmV3: async () => ({ durationMs: 5, available: true, httpCode: 200, errorCode: null }) },
      createAudioCapture: () => ({
        start: async () => {},
        stop: async () => ({
          blob: new Blob([new Uint8Array([82, 73, 70, 70])], { type: 'audio/wav' }),
          durationMs: 700,
          byteCount: 4,
          mimeType: 'audio/wav',
        }),
        cancel: () => {},
      }),
      analyze: async ({ challenge, signal }) => {
        if (window.__echoHoldAnalysis) {
          await new Promise((resolve) => { window.__echoReleaseAnalysis = resolve; });
        }
        const analysis = window.__echoAnalysisQueue.shift() || {
          schemaVersion: 'echo-forge-analysis-v1',
          status: 'scored',
          score: 100,
          evaluationMode: challenge.evaluationMode,
          dimensions: { accuracy: 100 },
          verdict: 'scored',
          engineRevision: 'browser-test-v1',
          challengeId: challenge.challengeId,
          variantId: challenge.pronunciation.variantId,
          reasonCode: null,
        };
        analysis.challengeId = challenge.challengeId;
        analysis.evaluationMode = challenge.evaluationMode;
        analysis.variantId = challenge.pronunciation.variantId;
        return {
          analysis,
          timing: {
            requestDurationMs: 15,
            responseDurationMs: 5,
            normalizationDurationMs: 1,
            httpCode: 200,
            errorCode: null,
          },
        };
      },
      playPrompt: async (challenge) => true,
    };
  });
}

(async () => {
  const port = await freePort();
  const publicDir = path.join(process.cwd(), 'public');
  const app = express();
  app.get('/api/config', (_req, res) => res.json({ success: true, config: {}, features: { echoForgeSandbox: true } }));
  app.use(express.static(publicDir));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));

  const baseUrl = `http://127.0.0.1:${port}/echo-forge-sandbox.html`;
  const artifactsDir = path.join(process.cwd(), 'test-results', 'echo-forge');
  fs.mkdirSync(artifactsDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const errors = [];

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await installHooks(page);
    page.on('pageerror', (err) => errors.push(err.stack || err.message));
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });

    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.waitForSelector('#echo-forge-root[data-state="ready"]');

    // 1. Begin battle
    await page.selectOption('#level-select', 'B1');
    await page.selectOption('#support-select', 'standard');
    await page.click('#start-btn');
    await page.waitForSelector('#battle:not([hidden])');

    // 2. Verify Hero & Enemy Pixel Art Sprites
    await page.waitForFunction(() => {
      const hero = document.querySelector('[data-visual="hero"]');
      const enemy = document.querySelector('[data-visual="enemy"]');
      return hero && hero.dataset.assetId === 'ef-hero-idle' && !hero.hidden &&
             enemy && enemy.dataset.assetId === 'ef-enemy-idle' && !enemy.hidden;
    });

    const heroSrc = await page.locator('[data-visual="hero"]').getAttribute('src');
    const enemySrc = await page.locator('[data-visual="enemy"]').getAttribute('src');
    assert.match(heroSrc, /^blob:/, 'Hero sprite loaded as blob URL');
    assert.match(enemySrc, /^blob:/, 'Enemy sprite loaded as blob URL');

    // Verify image-rendering: pixelated is computed on both sprites
    const heroImageRendering = await page.locator('[data-visual="hero"]').evaluate((el) => getComputedStyle(el).imageRendering);
    const enemyImageRendering = await page.locator('[data-visual="enemy"]').evaluate((el) => getComputedStyle(el).imageRendering);
    assert.ok(
      ['pixelated', 'crisp-edges', '-webkit-optimize-contrast'].includes(heroImageRendering),
      `Hero sprite image-rendering should be pixelated, got: ${heroImageRendering}`
    );
    assert.ok(
      ['pixelated', 'crisp-edges', '-webkit-optimize-contrast'].includes(enemyImageRendering),
      `Enemy sprite image-rendering should be pixelated, got: ${enemyImageRendering}`
    );

    // Verify Sentinel shader
    assert.equal(await page.locator('#echo-forge-root').getAttribute('data-warden'), 'sentinel');
    const sentinelFilter = await page.locator('.fighter.enemy .fighter-mark img').evaluate((el) => getComputedStyle(el).filter);
    assert.match(sentinelFilter, /drop-shadow/, 'Sentinel has luminous drop-shadow filter');

    await page.screenshot({ path: path.join(artifactsDir, 'pixel-art-sentinel.png'), fullPage: true });

    // 3. Verify Analysis Hold Sprite Animation
    await page.evaluate(() => { window.__echoHoldAnalysis = true; });
    await page.click('[data-card="precision_strike"]');
    await page.waitForSelector('#record-btn:not([disabled])');
    await page.click('#record-btn');
    await page.waitForSelector('#stop-btn:not([disabled])');
    await page.click('#stop-btn');

    // Wait for analysis hold effect sprite to become visible
    await page.waitForSelector('[data-visual="effect"]:not([hidden])');
    const effectAssetId = await page.locator('[data-visual="effect"]').getAttribute('data-asset-id');
    assert.equal(effectAssetId, 'ef-analysis-hold', 'Analysis hold effect loaded');

    const effectRendering = await page.locator('[data-visual="effect"]').evaluate((el) => getComputedStyle(el).imageRendering);
    assert.ok(
      ['pixelated', 'crisp-edges', '-webkit-optimize-contrast'].includes(effectRendering),
      `Effect sprite image-rendering should be pixelated, got: ${effectRendering}`
    );

    // Verify frame animation advances
    const initialFrame = await page.locator('[data-visual="effect"]').getAttribute('data-frame');
    await page.waitForFunction((prev) => {
      const effect = document.querySelector('[data-visual="effect"]');
      return effect && effect.dataset.frame !== prev;
    }, initialFrame, { timeout: 3000 });

    await page.screenshot({ path: path.join(artifactsDir, 'pixel-art-analysis-hold.png'), fullPage: true });

    // 4. Release analysis hold and verify combat result effect
    await page.evaluate(() => {
      window.__echoHoldAnalysis = false;
      if (typeof window.__echoReleaseAnalysis === 'function') {
        window.__echoReleaseAnalysis();
      }
    });

    // Wait for attack to resolve
    await page.waitForFunction(() => {
      const combat = window.echoForgeSandbox?.getState?.();
      return combat && combat.enemy.hp < combat.enemy.maxHp;
    });

    // 5. Defeat Sentinel and transition to Cinder Drake (Fight 2)
    while (true) {
      const combat = await page.evaluate(() => window.echoForgeSandbox.getState());
      if (combat.status !== 'active') break;
      if (combat.turn === 'player') {
        await page.click('[data-card="precision_strike"]');
        await page.click('#record-btn');
        await page.click('#stop-btn');
        await page.waitForTimeout(100);
      } else if (combat.turn === 'enemy') {
        await page.click('#parry-btn');
        await page.click('#record-btn');
        await page.click('#stop-btn');
        await page.waitForTimeout(100);
      }
    }

    // Claim reward to enter Fight 2
    await page.waitForSelector('#reward-select:not([hidden])');
    await page.locator('.reward-card button').first().click();

    // Verify Cinder Weaver (Fight 2)
    await page.waitForSelector('#battle:not([hidden])');
    assert.equal(await page.locator('#enemy-name').textContent(), 'Cinder Weaver');
    assert.equal(await page.locator('#echo-forge-root').getAttribute('data-warden'), 'cinder');

    // Verify Cinder Weaver molten elemental shader
    const cinderFilter = await page.locator('.fighter.enemy .fighter-mark img').evaluate((el) => getComputedStyle(el).filter);
    assert.match(cinderFilter, /hue-rotate\(85deg\)/, 'Cinder Weaver has molten hue-rotate(85deg) shader');
    assert.match(cinderFilter, /saturate\(1\.45\)/, 'Cinder Weaver has intensified saturation');

    await page.screenshot({ path: path.join(artifactsDir, 'pixel-art-cinder.png'), fullPage: true });

    // 6. Defeat Cinder Weaver and transition to Void Singer (Fight 3)
    while (true) {
      const combat = await page.evaluate(() => window.echoForgeSandbox.getState());
      if (combat.status !== 'active') break;
      if (combat.turn === 'player') {
        await page.click('[data-card="precision_strike"]');
        await page.click('#record-btn');
        await page.click('#stop-btn');
        await page.waitForTimeout(100);
      } else if (combat.turn === 'enemy') {
        await page.click('#parry-btn');
        await page.click('#record-btn');
        await page.click('#stop-btn');
        await page.waitForTimeout(100);
      }
    }

    // Claim reward to enter Fight 3
    await page.waitForSelector('#reward-select:not([hidden])');
    await page.locator('.reward-card button').last().click();

    // Verify Void Singer (Fight 3)
    await page.waitForSelector('#battle:not([hidden])');
    assert.equal(await page.locator('#enemy-name').textContent(), 'Void Singer');
    assert.equal(await page.locator('#echo-forge-root').getAttribute('data-warden'), 'void');

    // Verify Void Singer emerald void elemental shader
    const voidFilter = await page.locator('.fighter.enemy .fighter-mark img').evaluate((el) => getComputedStyle(el).filter);
    assert.match(voidFilter, /hue-rotate\(240deg\)/, 'Void Singer has emerald void hue-rotate(240deg) shader');
    assert.match(voidFilter, /saturate\(1\.35\)/, 'Void Singer has void saturation');

    await page.screenshot({ path: path.join(artifactsDir, 'pixel-art-void.png'), fullPage: true });

    // 7. Complete Fight 3 and verify Victory
    while (true) {
      const combat = await page.evaluate(() => window.echoForgeSandbox.getState());
      if (combat.status !== 'active') break;
      if (combat.turn === 'player') {
        await page.click('[data-card="precision_strike"]');
        await page.click('#record-btn');
        await page.click('#stop-btn');
        await page.waitForTimeout(100);
      } else if (combat.turn === 'enemy') {
        await page.click('#parry-btn');
        await page.click('#record-btn');
        await page.click('#stop-btn');
        await page.waitForTimeout(100);
      }
    }

    await page.waitForSelector('#summary:not([hidden])');
    const outcomeText = await page.locator('#summary-outcome').textContent();
    assert.match(outcomeText, /Victory/, 'Victory achieved across all 3 Wardens');

    assert.equal(errors.length, 0, `Page errors encountered: ${errors.join(', ')}`);
    console.log('Echo Forge pixel art sprites browser check passed.');
  } finally {
    await browser.close();
    server.close();
  }
})();
