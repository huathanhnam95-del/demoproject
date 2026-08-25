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
    window.__echoExports = [];
    window.__echoDenyMicrophone = false;
    window.__echoLastPrompt = null;
    window.__echoCaptureCancels = 0;
    window.__echoHoldAnalysis = false;
    window.__echoAnalyzeStarted = false;
    window.__echoLastSignalAborted = false;
    window.__ECHO_FORGE_TEST_HOOKS__ = {
      analysisClient: { prewarmV3: async () => ({ durationMs: 5, available: true, httpCode: 200, errorCode: null }) },
      createAudioCapture: () => ({
        start: async () => {
          if (window.__echoDenyMicrophone) {
            window.__echoDenyMicrophone = false;
            throw new DOMException('Permission denied', 'NotAllowedError');
          }
        },
        stop: async () => ({
          blob: new Blob([new Uint8Array([82, 73, 70, 70])], { type: 'audio/wav' }),
          durationMs: 900,
          byteCount: 4,
          mimeType: 'audio/wav',
        }),
        cancel: () => { window.__echoCaptureCancels += 1; },
      }),
      analyze: async ({ challenge, signal }) => {
        window.__echoAnalyzeStarted = true;
        signal?.addEventListener('abort', () => { window.__echoLastSignalAborted = true; }, { once: true });
        if (window.__echoHoldAnalysis) {
          await new Promise((resolve) => { window.__echoReleaseAnalysis = resolve; });
          if (signal?.aborted) throw new DOMException('cancelled', 'AbortError');
        }
        const analysis = window.__echoAnalysisQueue.shift();
        if (!analysis) throw new Error('browser test analysis queue is empty');
        analysis.challengeId = challenge.challengeId;
        analysis.evaluationMode = challenge.evaluationMode;
        analysis.variantId = challenge.pronunciation.variantId;
        return {
          analysis,
          timing: {
            requestDurationMs: 20,
            responseDurationMs: 5,
            normalizationDurationMs: 1,
            httpCode: analysis.status === 'unavailable' ? null : 200,
            errorCode: analysis.reasonCode,
          },
        };
      },
      playPrompt: (challenge) => { window.__echoLastPrompt = challenge.text; },
      captureExport: (file) => { window.__echoExports.push(file); },
    };
  });
}

(async () => {
  const port = await freePort();
  const publicDir = path.join(process.cwd(), 'public');
  const app = express();
  let featureEnabled = false;
  let catalogRequests = 0;
  app.get('/api/config', (_req, res) => res.json({ success: true, config: {}, features: { echoForgeSandbox: featureEnabled } }));
  app.use('/database/echo-forge', (req, _res, next) => { catalogRequests += 1; next(); });
  app.use(express.static(publicDir));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${port}/echo-forge-sandbox.html`;
  const artifacts = path.join(process.cwd(), 'test-results', 'echo-forge');
  fs.mkdirSync(artifacts, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const errors = [];
  try {
    const offPage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    offPage.on('pageerror', (error) => errors.push(error.message));
    await offPage.goto(baseUrl, { waitUntil: 'networkidle' });
    assert.equal(await offPage.locator('#echo-forge-root').getAttribute('data-state'), 'disabled');
    assert.equal(await offPage.locator('#start-btn').isDisabled(), true);
    assert.equal(catalogRequests, 0, 'disabled feature fetched catalog');
    await offPage.close();

    featureEnabled = true;
    const context = await browser.newContext({ viewport: { width: 360, height: 800 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await installHooks(page);
    page.on('pageerror', (error) => errors.push(error.stack || error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.waitForSelector('#echo-forge-root[data-state="ready"]');
    assert.deepEqual(await page.locator('#level-select option').allTextContents(), ['A1', 'A2', 'B1', 'B2', 'C1']);
    assert.equal(await page.locator('text=C2').count(), 0);
    assert.equal(await page.locator('#system-status').getAttribute('role'), 'status');
    assert.ok((await page.locator('#start-btn').boundingBox()).height >= 44);

    await page.keyboard.press('Tab');
    const focusOutline = await page.locator(':focus').evaluate((element) => getComputedStyle(element).outlineStyle);
    assert.notEqual(focusOutline, 'none');
    await page.screenshot({ path: path.join(artifacts, 'mobile-setup.png'), fullPage: true });

    await page.selectOption('#level-select', 'A1');
    await page.selectOption('#support-select', 'guided');
    await page.click('#start-btn');
    await page.waitForSelector('#battle:not([hidden])');

    const initial = await page.evaluate(() => window.echoForgeSandbox.getState());
    await page.click('[data-card="precision_strike"]');
    await page.evaluate(() => { window.__echoDenyMicrophone = true; });
    await page.click('#record-btn');
    assert.match(await page.locator('#system-status').textContent(), /Microphone unavailable.*No combat state changed/);
    assert.deepEqual(await page.evaluate(() => window.echoForgeSandbox.getState()), initial);
    await page.click('#cancel-btn');
    assert.deepEqual(await page.evaluate(() => window.echoForgeSandbox.getState()), initial);

    await page.evaluate((analysis) => window.__echoAnalysisQueue.push(analysis), normalized('scored', 100));
    await page.click('[data-card="precision_strike"]');
    await page.click('#record-btn');
    await page.click('#stop-btn');
    await page.waitForFunction(() => window.echoForgeSandbox.getState().turn === 'enemy');
    assert.equal((await page.evaluate(() => window.echoForgeSandbox.getState())).enemy.hp, 90);

    await page.click('#block-btn');
    const spoken = await page.evaluate(() => window.__echoLastPrompt);
    await page.getByRole('button', { name: spoken, exact: true }).click();
    await page.waitForFunction(() => window.echoForgeSandbox.getState().turn === 'player');
    let state = await page.evaluate(() => window.echoForgeSandbox.getState());
    assert.equal(state.hero.hp, 90);
    assert.equal(state.hero.focus, 2);

    await page.evaluate((analysis) => window.__echoAnalysisQueue.push(analysis), normalized('scored', 80));
    await page.click('[data-card="precision_strike"]');
    await page.click('#record-btn');
    await page.click('#stop-btn');
    await page.waitForFunction(() => window.echoForgeSandbox.getState().turn === 'enemy');
    const beforeFallback = await page.evaluate(() => window.echoForgeSandbox.getState());
    await page.click('#parry-btn');
    await page.evaluate((analysis) => window.__echoAnalysisQueue.push(analysis), normalized('unavailable', null));
    await page.click('#record-btn');
    const parryStartEvents = await page.locator('#event-log li').allTextContents();
    assert.deepEqual(parryStartEvents.slice(0, 2), ['player.parry.started', 'recording.started']);
    assert.equal(parryStartEvents.filter((type) => type === 'player.parry.started').length, 1);
    await page.click('#stop-btn');
    await page.waitForSelector('#block-options:not([hidden])');
    assert.deepEqual(await page.evaluate(() => window.echoForgeSandbox.getState()), beforeFallback);
    assert.match(await page.locator('#system-status').textContent(), /Block is available; no damage or resource was applied/);
    const fallbackSpoken = await page.evaluate(() => window.__echoLastPrompt);
    await page.getByRole('button', { name: fallbackSpoken, exact: true }).click();
    await page.waitForFunction(() => window.echoForgeSandbox.getState().turn === 'player');

    await page.evaluate((analysis) => window.__echoAnalysisQueue.push(analysis), normalized('scored', 80));
    await page.click('[data-card="precision_strike"]');
    await page.click('#record-btn');
    await page.click('#stop-btn');
    await page.waitForFunction(() => window.echoForgeSandbox.getState().turn === 'enemy');
    await page.click('#parry-btn');
    await page.evaluate((analysis) => window.__echoAnalysisQueue.push(analysis), normalized('scored', 95));
    await page.click('#record-btn');
    await page.click('#stop-btn');
    await page.waitForFunction(() => window.echoForgeSandbox.getState().turn === 'player');
    assert.match(await page.locator('#system-status').textContent(), /Parry resolved\. Your turn/);
    assert.equal(await page.locator('#attack-controls').isVisible(), true);
    assert.equal(await page.locator('[data-card="precision_strike"]').isEnabled(), true);

    const beforeReplay = JSON.stringify(await page.evaluate(() => window.echoForgeSandbox.getState()));
    await page.click('#replay-btn');
    assert.equal(JSON.stringify(await page.evaluate(() => window.echoForgeSandbox.getState())), beforeReplay);

    await page.click('#export-json-btn');
    assert.match(await page.locator('#system-status').textContent(), /Timing JSON exported/);
    await page.click('#export-csv-btn');
    assert.match(await page.locator('#system-status').textContent(), /Timing CSV exported/);
    const exports = await page.evaluate(() => window.__echoExports);
    assert.equal(exports.length, 2);
    assert.doesNotMatch(exports.map((entry) => entry.contents).join('\n'), /recognizedText|referenceText|transcript|audioUrl|email|token|uid/);
    await page.screenshot({ path: path.join(artifacts, 'mobile-battle.png'), fullPage: true });
    await context.close();

    const recordingContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const recordingPage = await recordingContext.newPage();
    await installHooks(recordingPage);
    await recordingPage.goto(baseUrl, { waitUntil: 'networkidle' });
    await recordingPage.click('#start-btn');
    await recordingPage.click('[data-card="precision_strike"]');
    await recordingPage.click('#record-btn');
    await recordingPage.click('#abandon-btn');
    assert.equal((await recordingPage.evaluate(() => window.echoForgeSandbox.getState())).status, 'abandoned');
    assert.equal(await recordingPage.evaluate(() => window.__echoCaptureCancels), 1);
    assert.equal(await recordingPage.locator('#record-controls').isHidden(), true);
    await recordingContext.close();

    const pendingContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const pendingPage = await pendingContext.newPage();
    await installHooks(pendingPage);
    await pendingPage.goto(baseUrl, { waitUntil: 'networkidle' });
    await pendingPage.click('#start-btn');
    await pendingPage.evaluate((analysis) => {
      window.__echoAnalysisQueue.push(analysis);
      window.__echoHoldAnalysis = true;
    }, normalized('scored', 100));
    await pendingPage.click('[data-card="precision_strike"]');
    await pendingPage.click('#record-btn');
    await pendingPage.click('#stop-btn');
    await pendingPage.waitForFunction(() => window.__echoAnalyzeStarted === true);
    await pendingPage.click('#abandon-btn');
    assert.equal(await pendingPage.evaluate(() => window.__echoLastSignalAborted), true);
    const abandonedState = JSON.stringify(await pendingPage.evaluate(() => window.echoForgeSandbox.getState()));
    const abandonedEvents = await pendingPage.locator('#event-log li').allTextContents();
    await pendingPage.evaluate(() => window.__echoReleaseAnalysis());
    await pendingPage.waitForTimeout(50);
    assert.equal(JSON.stringify(await pendingPage.evaluate(() => window.echoForgeSandbox.getState())), abandonedState);
    assert.deepEqual(await pendingPage.locator('#event-log li').allTextContents(), abandonedEvents);
    await pendingContext.close();

    const cancelContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const cancelPage = await cancelContext.newPage();
    await installHooks(cancelPage);
    await cancelPage.goto(baseUrl, { waitUntil: 'networkidle' });
    await cancelPage.click('#start-btn');
    const beforeCancelledAnalysis = JSON.stringify(await cancelPage.evaluate(() => window.echoForgeSandbox.getState()));
    await cancelPage.evaluate((analysis) => {
      window.__echoAnalysisQueue.push(analysis);
      window.__echoHoldAnalysis = true;
    }, normalized('scored', 100));
    await cancelPage.click('[data-card="precision_strike"]');
    await cancelPage.click('#record-btn');
    await cancelPage.click('#stop-btn');
    await cancelPage.waitForFunction(() => window.__echoAnalyzeStarted === true);
    await cancelPage.click('#cancel-btn');
    assert.equal(await cancelPage.evaluate(() => window.__echoLastSignalAborted), true);
    assert.equal(JSON.stringify(await cancelPage.evaluate(() => window.echoForgeSandbox.getState())), beforeCancelledAnalysis);
    assert.equal((await cancelPage.locator('#event-log li').first().textContent()), 'analysis.noop');
    assert.match(await cancelPage.locator('#system-status').textContent(), /Recording cancelled\. Combat state is unchanged/);
    const cancelledEvents = await cancelPage.locator('#event-log li').allTextContents();
    await cancelPage.evaluate(() => window.__echoReleaseAnalysis());
    await cancelPage.waitForTimeout(50);
    assert.deepEqual(await cancelPage.locator('#event-log li').allTextContents(), cancelledEvents);
    await cancelContext.close();

    assert.deepEqual(errors, []);
    console.log('Echo Forge Chrome browser check passed.');
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
