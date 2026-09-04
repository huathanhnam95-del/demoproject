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
      // Two floors per act keeps a full three-act walk to six encounters:
      // an ordinary fight then the act Warden, three times over.
      floorsPerAct: 2,
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

    // Claims whatever reward is on offer, then walks the map by always taking
    // the first node. Node index 0 is pinned on every floor and the spine edge
    // always exists, so this path is deterministic.
    async function advanceToNextFight() {
      for (let guard = 0; guard < 10; guard += 1) {
        if (await page.locator('#battle').isVisible()) return;

        if (await page.locator('#reward-select').isVisible()) {
          await page.locator('.reward-card button').first().click();
          continue;
        }
        if (await page.locator('#map-select').isVisible()) {
          await page.locator('.ef-map-node:not([disabled])').first().click();
          continue;
        }
        if (await page.locator('#summary').isVisible()) return;
        await page.waitForTimeout(50);
      }
      throw new Error('the map never led back into a battle');
    }

    // --- ACT I: an ordinary fight before the Warden ---
    assert.equal(await page.locator('#enemy-name').textContent(), 'Chime Wisp');
    assert.equal(await page.locator('#echo-forge-root').getAttribute('data-warden'), 'sentinel');
    assert.equal(await page.locator('#echo-forge-root').getAttribute('data-act'), '0');

    await performCombatLoopUntilDefeat();

    // Reward screen for an ordinary victory
    await page.waitForSelector('#reward-select:not([hidden])');
    assert.equal(await page.locator('#battle').isHidden(), true);
    assert.equal(await page.locator('.reward-card').count(), 2);
    assert.match(await page.locator('#reward-heading').textContent(), /Victory/);

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
    await page.waitForSelector('#reward-select:not([hidden])');
    assert.equal(await page.locator('#battle').isHidden(), true);

    // --- The map appears once the reward is claimed ---
    await page.locator('.reward-card button').first().click();
    await page.waitForSelector('#map-select:not([hidden])');
    assert.equal(await page.locator('#battle').isHidden(), true);
    assert.equal(await page.locator('#reward-select').isHidden(), true);

    const mapState = await page.evaluate(() => window.echoForgeSandbox.getRunState());
    assert.equal(mapState.status, 'map_pending');
    assert.equal(mapState.combat, null, 'no fight is queued behind the map');
    assert.ok(mapState.availableNodeIds.length >= 1, 'somewhere to go');

    // Only the reachable nodes are offered, and they are exactly the ones the
    // run state says are reachable.
    const enabledIds = await page.locator('.ef-map-node:not([disabled])')
      .evaluateAll((nodes) => nodes.map((n) => n.dataset.nodeId));
    assert.deepEqual(enabledIds.sort(), [...mapState.availableNodeIds].sort());

    // Unreachable nodes are rendered but inert.
    const disabledCount = await page.locator('.ef-map-node[disabled]').count();
    assert.ok(disabledCount >= 1, 'the rest of the act is visible but locked');

    // Map controls clear the touch-target floor at 360px.
    for (const box of await page.locator('.ef-map-node').evaluateAll((nodes) =>
      nodes.map((n) => ({ id: n.dataset.nodeId, width: n.getBoundingClientRect().width, height: n.getBoundingClientRect().height }))
    )) {
      assert.ok(box.width >= 44 && box.height >= 44, `Map node touch target: ${box.id}`);
    }
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      true,
      'the map does not overflow 360px',
    );

    // The act header names where the player is.
    assert.match(await page.locator('.ef-map-numeral').textContent(), /Act I\b/);
    assert.match(await page.locator('.ef-map-title').textContent(), /Resonant Hall/);

    // --- Reloading while standing on the map resumes onto the map ---
    await page.reload();
    await page.waitForSelector('#setup:not([hidden])');
    assert.equal(await page.locator('#resume-btn').isVisible(), true);
    await page.locator('#resume-btn').click();
    await page.waitForSelector('#map-select:not([hidden])');
    const resumedMap = await page.evaluate(() => window.echoForgeSandbox.getRunState());
    assert.equal(resumedMap.status, 'map_pending');
    assert.equal(resumedMap.floor, mapState.floor, 'resumed on the same floor');
    assert.deepEqual(resumedMap.availableNodeIds, mapState.availableNodeIds);

    // --- ACT I boss: Echo Sentinel ---
    await advanceToNextFight();
    assert.equal(await page.locator('#enemy-name').textContent(), 'Echo Sentinel');
    assert.equal(await page.locator('#echo-forge-root').getAttribute('data-warden'), 'sentinel');
    await performCombatLoopUntilDefeat();
    assert.match(await page.locator('#reward-heading').textContent(), /Warden Defeated/);

    // --- ACT II ---
    await advanceToNextFight();
    assert.equal(await page.locator('#echo-forge-root').getAttribute('data-warden'), 'cinder');
    assert.equal(await page.locator('#enemy-name').textContent(), 'Ember Mote');
    const act2 = await page.evaluate(() => window.echoForgeSandbox.getRunState());
    assert.equal(act2.act, 1);
    assert.equal(act2.wardenIndex, 1);
    await performCombatLoopUntilDefeat();

    await advanceToNextFight();
    assert.equal(await page.locator('#enemy-name').textContent(), 'Cinder Weaver');
    await performCombatLoopUntilDefeat();

    // --- ACT III ---
    await advanceToNextFight();
    assert.equal(await page.locator('#echo-forge-root').getAttribute('data-warden'), 'void');
    assert.equal(await page.locator('#enemy-name').textContent(), 'Null Shade');
    const act3 = await page.evaluate(() => window.echoForgeSandbox.getRunState());
    assert.equal(act3.act, 2);
    assert.equal(act3.wardenIndex, 2);
    await performCombatLoopUntilDefeat();

    await advanceToNextFight();
    assert.equal(await page.locator('#enemy-name').textContent(), 'Void Singer');
    await performCombatLoopUntilDefeat();

    // --- RUN SUMMARY (victory across all three acts) ---
    await page.waitForSelector('#summary:not([hidden])');
    assert.equal(await page.locator('#reward-select').isHidden(), true);
    assert.equal(await page.locator('#map-select').isHidden(), true);
    assert.match(await page.locator('#summary-outcome').textContent(), /Victory/);

    const finalRunState = await page.evaluate(() => window.echoForgeSandbox.getRunState());
    assert.equal(finalRunState.status, 'victory');
    assert.equal(finalRunState.act, 2, 'finished in the final act');
    assert.equal(finalRunState.ledger.length, 6, 'six encounters at two floors per act');

    // All three Wardens fell, in order, as act bosses.
    assert.deepEqual(
      finalRunState.ledger.filter((e) => e.nodeType === 'boss').map((e) => e.wardenId),
      ['echo_sentinel', 'cinder_weaver', 'void_singer'],
    );

    // The recorded path is the pinned spine, since we always took the first node.
    assert.deepEqual(
      finalRunState.visitedNodeIds,
      ['f0n0', 'f1n0', 'f2n0', 'f3n0', 'f4n0', 'f5n0'],
    );

    // Verify Replay
    await page.click('#replay-btn');
    const replayedState = await page.evaluate(() => window.echoForgeSandbox.getRunState());
    assert.equal(replayedState.status, 'victory');
    assert.equal(replayedState.ledger.length, 6);
    assert.deepEqual(replayedState.visitedNodeIds, finalRunState.visitedNodeIds);

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
