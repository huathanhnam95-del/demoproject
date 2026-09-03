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

function normalized(status, score, mode = 'azure_word', challengeId = 'ef-b1-azure-word-001') {
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
    window.__echoExports = [];
    window.__echoDenyMicrophone = false;
    window.__echoLastPrompt = null;
    window.__echoPromptEvents = [];
    window.__ECHO_FORGE_TEST_HOOKS__ = {
      seed: 0x4543484f,
      singleFight: false,
      sfx: {
        attack: () => {},
        burst: () => {},
        hit: () => {},
        enemyAttack: () => {},
        blockSuccess: () => {},
        blockFail: () => {},
        parry: () => {},
        resonanceReady: () => {},
        victory: () => {},
        defeat: () => {},
      },
      analysisClient: {
        prewarmV3: async () => ({ durationMs: 5, available: true, httpCode: 200, errorCode: null }),
      },
      createAudioCapture: () => ({
        start: async () => {},
        stop: async () => ({
          blob: new Blob([new Uint8Array([82, 73, 70, 70])], { type: 'audio/wav' }),
          durationMs: 900,
          byteCount: 4,
          mimeType: 'audio/wav',
        }),
        cancel: () => {},
      }),
      analyze: async ({ challenge, signal }) => {
        const analysis = window.__echoAnalysisQueue.shift() || {
          schemaVersion: 'echo-forge-analysis-v1',
          status: 'scored',
          score: 100,
          evaluationMode: challenge.evaluationMode,
          dimensions: { accuracy: 100 },
          verdict: 'scored',
          engineRevision: 'browser-test-v1',
          challengeId: challenge.challengeId,
          variantId: challenge.pronunciation?.variantId || 'v1',
          reasonCode: null,
        };
        analysis.challengeId = challenge.challengeId;
        analysis.evaluationMode = challenge.evaluationMode;
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
      playPrompt: async (challenge) => {
        window.__echoPromptEvents.push(`start:${challenge.text}`);
        window.__echoLastPrompt = challenge.text;
        window.__echoPromptEvents.push(`ended:${challenge.text}`);
      },
      captureExport: (file) => { window.__echoExports.push(file); },
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
  const artifacts = path.join(process.cwd(), 'test-results', 'echo-forge-run');
  fs.mkdirSync(artifacts, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const errors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 360, height: 800 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await installHooks(page);
    page.on('pageerror', (error) => errors.push(error.stack || error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.waitForSelector('#echo-forge-root[data-state="ready"]');

    // 1. Setup screen
    await page.selectOption('#level-select', 'B1');
    await page.selectOption('#support-select', 'standard');
    await page.click('#start-btn');
    await page.waitForSelector('#battle:not([hidden])');

    // Helper to perform a full combat turn
    async function performCombatLoopUntilDefeat() {
      while (true) {
        const combat = await page.evaluate(() => window.echoForgeSandbox.getState());
        if (!combat || combat.status !== 'active') break;

        if (combat.turn === 'player') {
          await page.evaluate((a) => window.__echoAnalysisQueue.push(a), normalized('scored', 100));
          await page.click('[data-card="precision_strike"]');
          await page.click('#record-btn');
          await page.click('#stop-btn');
          await page.waitForTimeout(100);
        } else if (combat.turn === 'enemy') {
          await page.click('#parry-btn');
          await page.evaluate((a) => window.__echoAnalysisQueue.push(a), normalized('scored', 100));
          await page.click('#record-btn');
          await page.click('#stop-btn');
          await page.waitForTimeout(100);
        }
      }
    }

    // --- FIGHT 1: Echo Sentinel ---
    assert.equal(await page.locator('#enemy-name').textContent(), 'Echo Sentinel');
    assert.equal(await page.locator('#echo-forge-root').getAttribute('data-warden'), 'sentinel');

    await performCombatLoopUntilDefeat();

    // Reward screen 1 appears
    await page.waitForSelector('#reward-select:not([hidden])');
    assert.equal(await page.locator('#battle').isHidden(), true);
    assert.equal(await page.locator('.reward-card').count(), 2);
    assert.match(await page.locator('#reward-heading').textContent(), /Warden Defeated/);

    // Verify touch target requirements on reward cards
    for (const box of await page.locator('.reward-card button').evaluateAll((nodes) =>
      nodes.map((n) => ({ text: n.textContent, width: n.getBoundingClientRect().width, height: n.getBoundingClientRect().height }))
    )) {
      assert.ok(box.width >= 44 && box.height >= 44, `Reward button touch target: ${box.text}`);
    }

    // Test inter-fight campaign resume across page reload
    await page.reload();
    await page.waitForSelector('#setup:not([hidden])');
    assert.equal(await page.locator('#resume-btn').isVisible(), true);
    assert.match(await page.locator('#resume-btn').textContent(), /Resume Campaign/);
    await page.locator('#resume-btn').click();

    // Reward screen 1 resumes
    await page.waitForSelector('#reward-select:not([hidden])');
    assert.equal(await page.locator('#battle').isHidden(), true);

    // Claim reward 1
    await page.locator('.reward-card button').first().click();

    // --- FIGHT 2: Cinder Weaver ---
    await page.waitForSelector('#battle:not([hidden])');
    assert.equal(await page.locator('#reward-select').isHidden(), true);
    assert.equal(await page.locator('#enemy-name').textContent(), 'Cinder Weaver');
    assert.equal(await page.locator('#echo-forge-root').getAttribute('data-warden'), 'cinder');

    const runStateAfterReward1 = await page.evaluate(() => window.echoForgeSandbox.getRunState());
    assert.equal(runStateAfterReward1.wardenIndex, 1);
    assert.equal(runStateAfterReward1.claimedRewards.length, 1);

    await performCombatLoopUntilDefeat();

    // Reward screen 2 appears
    await page.waitForSelector('#reward-select:not([hidden])');
    assert.equal(await page.locator('#battle').isHidden(), true);
    assert.equal(await page.locator('.reward-card').count(), 2);

    // Claim reward 2
    await page.locator('.reward-card button').last().click();

    // --- FIGHT 3: Void Singer ---
    await page.waitForSelector('#battle:not([hidden])');
    assert.equal(await page.locator('#reward-select').isHidden(), true);
    assert.equal(await page.locator('#enemy-name').textContent(), 'Void Singer');
    assert.equal(await page.locator('#echo-forge-root').getAttribute('data-warden'), 'void');

    const runStateAfterReward2 = await page.evaluate(() => window.echoForgeSandbox.getRunState());
    assert.equal(runStateAfterReward2.wardenIndex, 2);
    assert.equal(runStateAfterReward2.claimedRewards.length, 2);

    await performCombatLoopUntilDefeat();

    // --- RUN SUMMARY (Victory across all 3 fights) ---
    await page.waitForSelector('#summary:not([hidden])');
    assert.equal(await page.locator('#reward-select').isHidden(), true);
    assert.match(await page.locator('#summary-outcome').textContent(), /Victory/);

    const finalRunState = await page.evaluate(() => window.echoForgeSandbox.getRunState());
    assert.equal(finalRunState.status, 'victory');
    assert.equal(finalRunState.ledger.length, 3);
    assert.equal(finalRunState.claimedRewards.length, 2);

    // Verify Replay
    await page.click('#replay-btn');
    const replayedState = await page.evaluate(() => window.echoForgeSandbox.getRunState());
    assert.equal(replayedState.status, 'victory');
    assert.equal(replayedState.ledger.length, 3);

    // Screenshot artifact
    await page.screenshot({ path: path.join(artifacts, 'run-victory-summary.png'), fullPage: true });

    assert.equal(errors.length, 0, `Unexpected errors during multi-fight run: ${errors.join(', ')}`);
    console.log('Echo Forge multi-fight run browser check passed.');
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
