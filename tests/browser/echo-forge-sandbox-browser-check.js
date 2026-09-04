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

async function installHooks(page, { includePromptHook = true } = {}) {
  await page.addInitScript((usePromptHook) => {
    window.__echoAnalysisQueue = [];
    window.__echoExports = [];
    window.__echoDenyMicrophone = false;
    window.__echoLastPrompt = null;
    window.__echoPromptEvents = [];
    window.__echoPromptFail = false;
    window.__echoPromptDelay = false;
    window.__echoCaptureCancels = 0;
    window.__echoHoldAnalysis = false;
    window.__echoAnalyzeStarted = false;
    window.__echoLastSignalAborted = false;
    window.__ECHO_FORGE_TEST_HOOKS__ = {
      singleFight: true,
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
      playPrompt: async (challenge) => {
        window.__echoPromptEvents.push(`start:${challenge.text}`);
        window.__echoLastPrompt = challenge.text;
        if (window.__echoPromptFail) throw new Error('browser playback failure');
        if (window.__echoPromptDelay) {
          await new Promise((resolve) => { window.__echoReleasePrompt = resolve; });
        }
        window.__echoPromptEvents.push(`ended:${challenge.text}`);
      },
      captureExport: (file) => { window.__echoExports.push(file); },
    };
    if (!usePromptHook) delete window.__ECHO_FORGE_TEST_HOOKS__.playPrompt;
  }, includePromptHook);
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
    assert.equal(await page.locator('#level-help').textContent(), 'Everyday words and short exchanges.');
    assert.match(await page.locator('#support-help').textContent(), /meaning/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, '360px shell has no horizontal overflow');
    for (const box of await page.locator('button,select').evaluateAll((nodes) => nodes.filter((node) => node.getClientRects().length).map((node) => ({ id: node.id, width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height })))) {
      assert.ok(box.width >= 44 && box.height >= 44, `${box.id || 'control'} touch target`);
    }

    await page.keyboard.press('Tab');
    const focusOutline = await page.locator(':focus').evaluate((element) => getComputedStyle(element).outlineStyle);
    assert.notEqual(focusOutline, 'none');
    await page.screenshot({ path: path.join(artifacts, 'mobile-setup.png'), fullPage: true });

    await page.selectOption('#level-select', 'A1');
    await page.selectOption('#support-select', 'guided');
    await page.click('#start-btn');
    await page.waitForSelector('#battle:not([hidden])');
    await page.waitForFunction(() => document.querySelector('[data-visual="hero"]').dataset.assetId === 'ef-hero-idle');
    assert.match(await page.locator('[data-visual="hero"]').getAttribute('src'), /^blob:/);

    const initial = await page.evaluate(() => window.echoForgeSandbox.getState());
    await page.click('[data-card="precision_strike"]');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'record-btn');
    await page.evaluate(() => { window.__echoDenyMicrophone = true; });
    await page.click('#record-btn');
    assert.match(await page.locator('#system-status').textContent(), /Microphone unavailable.*No combat state changed/);
    assert.deepEqual(await page.evaluate(() => window.echoForgeSandbox.getState()), initial);
    await page.click('#record-btn');
    await page.keyboard.press('Escape');
    assert.deepEqual(await page.evaluate(() => window.echoForgeSandbox.getState()), initial);
    assert.match(await page.evaluate(() => document.activeElement.dataset.card || ''), /precision_strike|stress_breaker|echo_chain/);

    await page.evaluate((analysis) => window.__echoAnalysisQueue.push(analysis), normalized('unavailable', null));
    await page.click('[data-card="precision_strike"]');
    await page.click('#record-btn');
    await page.click('#stop-btn');
    await page.waitForFunction(() => /Try again|could not rate/i.test(document.querySelector('#system-status').textContent));
    assert.equal(await page.evaluate(() => document.activeElement.id), 'record-btn');
    await page.keyboard.press('Escape');

    await page.evaluate((analysis) => window.__echoAnalysisQueue.push(analysis), normalized('scored', 100));
    await page.click('[data-card="precision_strike"]');
    await page.click('#record-btn');
    await page.click('#stop-btn');
    await page.waitForFunction(() => window.echoForgeSandbox.getState().turn === 'enemy');
    assert.equal((await page.evaluate(() => window.echoForgeSandbox.getState())).enemy.hp, 60);
    assert.match(await page.locator('#feedback-text').textContent(), /Score: 100/);
    assert.match(await page.locator('#feedback-text').textContent(), /30 damage/);
    assert.equal(await page.locator('#event-log li').first().getAttribute('data-event-type'), 'enemy.intent.presented');
    assert.doesNotMatch(await page.locator('#event-log li').first().textContent(), /enemy\.intent\.presented/);
    assert.equal(await page.locator('.echo-visual-layer').evaluate((node) => node.classList.contains('enemy-telegraph')), true);
    assert.notEqual(await page.locator('.echo-visual-layer').evaluate((node) => getComputedStyle(node, '::after').content), 'none');
    await page.locator('#echo-forge-root').evaluate((node) => node.dispatchEvent(new CustomEvent('echo-forge:event', { detail: { type: 'combat.resonance.ready' } })));
    assert.equal(await page.locator('.echo-visual-layer').evaluate((node) => node.classList.contains('resonance-ready')), true);
    assert.notEqual(await page.locator('.echo-visual-layer').evaluate((node) => getComputedStyle(node, '::after').content), 'none');
    await page.locator('#echo-forge-root').evaluate((node) => node.dispatchEvent(new CustomEvent('echo-forge:event', { detail: { type: 'combat.resonance.consumed' } })));

    await page.evaluate(() => { window.__echoPromptDelay = true; });
    await page.click('#block-btn');
    await page.waitForSelector('#block-options:not([hidden])');
    const beforeEscapeBlock = await page.evaluate(() => window.echoForgeSandbox.getState());
    assert.equal(await page.evaluate(() => document.activeElement.id), 'block-options');
    assert.equal(await page.locator('#block-options').getAttribute('aria-busy'), 'true');
    assert.equal(await page.locator('#option-row button').first().isDisabled(), true);
    await page.keyboard.press('Escape');
    assert.deepEqual(await page.evaluate(() => window.echoForgeSandbox.getState()), beforeEscapeBlock);
    assert.equal(await page.locator('#block-options').isHidden(), true);
    await page.evaluate(() => { window.__echoReleasePrompt?.(); });
    await page.waitForFunction(() => window.__echoPromptEvents.length === 2);
    const promptEventsBeforeRetry = await page.evaluate(() => window.__echoPromptEvents.length);
    await page.click('#block-btn');
    await page.waitForSelector('#block-options:not([hidden])');
    assert.equal(await page.locator('#block-options').getAttribute('aria-busy'), 'true');
    await page.evaluate(() => { window.__echoPromptDelay = false; window.__echoReleasePrompt(); });
    await page.waitForFunction((count) => window.__echoPromptEvents.length === count + 2, promptEventsBeforeRetry);
    const spoken = await page.evaluate(() => window.__echoLastPrompt);
    await page.getByRole('button', { name: 'Hear word', exact: true }).click();
    await page.waitForFunction((count) => window.__echoPromptEvents.length === count + 4, promptEventsBeforeRetry);
    assert.equal(await page.evaluate(() => window.__echoPromptEvents.filter((entry) => entry.startsWith('start:')).length), 3);
    await page.getByRole('button', { name: spoken, exact: true }).click();
    await page.waitForFunction(() => window.echoForgeSandbox.getState().turn === 'player');
    assert.match(await page.evaluate(() => document.activeElement.dataset.card || ''), /precision_strike|stress_breaker|echo_chain/);
    let state = await page.evaluate(() => window.echoForgeSandbox.getState());
    assert.equal(state.hero.hp, 90);
    assert.equal(state.hero.focus, 3);

    await page.evaluate((analysis) => window.__echoAnalysisQueue.push(analysis), normalized('scored', 80));
    await page.click('[data-card="precision_strike"]');
    await page.click('#record-btn');
    await page.click('#stop-btn');
    await page.waitForFunction(() => window.echoForgeSandbox.getState().turn === 'enemy');
    assert.equal(await page.locator('#block-btn').isEnabled(), true);
    assert.equal(await page.locator('#parry-btn').isEnabled(), true);
    const beforeFallback = await page.evaluate(() => window.echoForgeSandbox.getState());
    await page.evaluate(() => { window.__echoPromptFail = true; });
    await page.click('#block-btn');
    await page.waitForFunction(() => /playback failed.*no combat state changed/i.test(document.querySelector('#system-status').textContent));
    assert.deepEqual(await page.evaluate(() => window.echoForgeSandbox.getState()), beforeFallback);
    await page.evaluate(() => { window.__echoPromptFail = false; });
    await page.click('#parry-btn');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'record-btn');
    await page.evaluate((analysis) => window.__echoAnalysisQueue.push(analysis), normalized('unavailable', null));
    await page.click('#record-btn');
    assert.match(await page.locator('#parry-countdown').textContent(), /Parry window: \d seconds remaining/);
    const parryStartEvents = await page.locator('#event-log li').allTextContents();
    assert.deepEqual(parryStartEvents.slice(0, 2), ['Parry window started', 'Recording started']);
    assert.equal(await page.locator('#event-log li[data-event-type="player.parry.started"]').count(), 1);
    await page.click('#stop-btn');
    assert.equal(await page.locator('#parry-countdown').textContent(), '');
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
    assert.equal(await page.evaluate(() => document.activeElement.id), 'record-btn');
    await page.evaluate((analysis) => window.__echoAnalysisQueue.push(analysis), normalized('scored', 95));
    await page.click('#record-btn');
    await page.click('#stop-btn');
    await page.waitForFunction(() => window.echoForgeSandbox.getState().turn === 'player');
    assert.match(await page.locator('#system-status').textContent(), /Parry resolved\. Your turn/);
    assert.equal(await page.locator('#attack-controls').isVisible(), true);
    assert.equal(await page.locator('[data-card="precision_strike"]').isEnabled(), true);

    // Verify keyboard shortcut controls (card 1 hotkey and Escape cancel)
    await page.keyboard.press('1');
    assert.equal(await page.locator('#record-controls').isVisible(), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#attack-controls').isVisible(), true);
    assert.equal(await page.locator('#record-controls').isHidden(), true);

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

    let terminalGuard = 0;
    while ((await page.evaluate(() => window.echoForgeSandbox.getState().status)) === 'active' && terminalGuard < 10) {
      terminalGuard += 1;
      await page.evaluate((analysis) => window.__echoAnalysisQueue.push(analysis), normalized('scored', 100));
      await page.click('[data-card="precision_strike"]');
      await page.click('#record-btn');
      await page.click('#stop-btn');
      await page.waitForFunction(() => ['enemy', 'player'].includes(window.echoForgeSandbox.getState().turn) || window.echoForgeSandbox.getState().status !== 'active');
      if ((await page.evaluate(() => window.echoForgeSandbox.getState().status)) !== 'active') break;
      await page.click('#block-btn');
      await page.waitForSelector('#block-options:not([hidden])');
      const blockWord = await page.evaluate(() => window.__echoLastPrompt);
      await page.getByRole('button', { name: blockWord, exact: true }).click();
      await page.waitForFunction(() => window.echoForgeSandbox.getState().turn === 'player' || window.echoForgeSandbox.getState().status !== 'active');
    }
    assert.notEqual(await page.evaluate(() => window.echoForgeSandbox.getState().status), 'active', 'run reaches terminal summary');
    await page.waitForSelector('#summary:not([hidden])');
    assert.match(await page.locator('#summary-outcome').textContent(), /Victory|Defeat|abandoned/i);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'summary-heading');
    await page.click('#play-again-btn');
    await page.waitForFunction(() => window.echoForgeSandbox.getState().status === 'active');
    assert.equal(await page.locator('#summary').isHidden(), true);
    await page.click('#abandon-btn');
    await page.waitForSelector('#summary:not([hidden])');
    await page.click('#change-settings-btn');
    await page.waitForSelector('#setup:not([hidden])');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'setup-heading');
    await page.screenshot({ path: path.join(artifacts, 'mobile-battle.png'), fullPage: true });
    await context.close();

    const fallbackContext = await browser.newContext({ viewport: { width: 360, height: 800 }, reducedMotion: 'reduce' });
    await fallbackContext.route('**/assets/echo-forge/v1/visual-manifest.v1.json', (route) => route.abort());
    const fallbackPage = await fallbackContext.newPage();
    await installHooks(fallbackPage);
    await fallbackPage.goto(baseUrl, { waitUntil: 'networkidle' });
    await fallbackPage.waitForSelector('#echo-forge-root[data-state="ready"]');

    await fallbackPage.waitForTimeout(1000);
    assert.equal(await fallbackPage.locator('.echo-visual-layer').getAttribute('data-visual-status'), 'fallback');
    await fallbackPage.click('#start-btn');
    await fallbackPage.click('[data-card="precision_strike"]');
    assert.equal(await fallbackPage.locator('#record-btn').isEnabled(), true, 'fallback keeps gameplay usable');
    await fallbackContext.close();

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
    await cancelPage.keyboard.press('Escape');
    assert.equal(await cancelPage.evaluate(() => window.__echoLastSignalAborted), true);
    assert.equal(JSON.stringify(await cancelPage.evaluate(() => window.echoForgeSandbox.getState())), beforeCancelledAnalysis);
    assert.equal((await cancelPage.locator('#event-log li').first().getAttribute('data-event-type')), 'analysis.noop');
    assert.equal((await cancelPage.locator('#event-log li').first().textContent()), 'Analysis unavailable; no judgment recorded');
    assert.match(await cancelPage.locator('#system-status').textContent(), /Recording cancelled\. Combat state is unchanged/);
    assert.match(await cancelPage.evaluate(() => document.activeElement.dataset.card || ''), /precision_strike|stress_breaker|echo_chain/);
    const cancelledEvents = await cancelPage.locator('#event-log li').allTextContents();
    await cancelPage.evaluate(() => window.__echoReleaseAnalysis());
    await cancelPage.waitForTimeout(50);
    assert.deepEqual(await cancelPage.locator('#event-log li').allTextContents(), cancelledEvents);
    await cancelContext.close();

    const realAudioContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const realAudioPage = await realAudioContext.newPage();
    await installHooks(realAudioPage, { includePromptHook: false });
    await realAudioPage.goto(baseUrl, { waitUntil: 'networkidle' });
    await realAudioPage.waitForSelector('#echo-forge-root[data-state="ready"]');
    const artifactStatus = await realAudioPage.evaluate(async () => {
      const manifest = await fetch('/database/echo-forge/audio-manifest.v1.json');
      const audio = await fetch('/database/echo-forge/audio/v1/a1/listening/001.wav');
      return { manifest: manifest.status, audio: audio.status };
    });
    assert.deepEqual(artifactStatus, { manifest: 200, audio: 200 });
    await realAudioPage.click('#start-btn');
    await realAudioPage.evaluate((analysis) => window.__echoAnalysisQueue.push(analysis), normalized('scored', 100));
    await realAudioPage.click('[data-card="precision_strike"]');
    await realAudioPage.click('#record-btn');
    await realAudioPage.click('#stop-btn');
    await realAudioPage.waitForFunction(() => window.echoForgeSandbox.getState().turn === 'enemy');
    await realAudioPage.click('#block-btn');
    await realAudioPage.waitForFunction(() => document.querySelector('#block-options').getAttribute('aria-busy') === 'false');
    assert.equal(await realAudioPage.locator('#option-row button[data-option-id]:not([disabled])').count() > 0, true);
    const realBlockOption = realAudioPage.locator('#option-row button[data-option-id]:not([disabled])').first();
    await realBlockOption.click();
    await realAudioPage.waitForFunction(() => window.echoForgeSandbox.getState().turn === 'player');
    const realReplayState = JSON.stringify(await realAudioPage.evaluate(() => window.echoForgeSandbox.getState()));
    await realAudioPage.click('#replay-btn');
    assert.equal(JSON.stringify(await realAudioPage.evaluate(() => window.echoForgeSandbox.getState())), realReplayState);
    await realAudioContext.close();

    const realFailureContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await realFailureContext.route('**/database/echo-forge/audio/v1/**', (route) => route.abort());
    const realFailurePage = await realFailureContext.newPage();
    await installHooks(realFailurePage, { includePromptHook: false });
    await realFailurePage.goto(baseUrl, { waitUntil: 'networkidle' });
    await realFailurePage.click('#start-btn');
    await realFailurePage.evaluate((analysis) => window.__echoAnalysisQueue.push(analysis), normalized('scored', 100));
    await realFailurePage.click('[data-card="precision_strike"]');
    await realFailurePage.click('#record-btn');
    await realFailurePage.click('#stop-btn');
    await realFailurePage.waitForFunction(() => window.echoForgeSandbox.getState().turn === 'enemy');
    const realFailureState = JSON.stringify(await realFailurePage.evaluate(() => window.echoForgeSandbox.getState()));
    await realFailurePage.click('#block-btn');
    await realFailurePage.waitForFunction(() => /playback failed.*no combat state changed/i.test(document.querySelector('#system-status').textContent));
    assert.equal(JSON.stringify(await realFailurePage.evaluate(() => window.echoForgeSandbox.getState())), realFailureState);
    await realFailureContext.close();

    const parryCountContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const parryCountPage = await parryCountContext.newPage();
    await installHooks(parryCountPage);
    await parryCountPage.goto(baseUrl, { waitUntil: 'networkidle' });
    await parryCountPage.click('#start-btn');
    await parryCountPage.evaluate((analysis) => window.__echoAnalysisQueue.push(analysis), normalized('scored', 100));
    await parryCountPage.click('[data-card="precision_strike"]');
    await parryCountPage.click('#record-btn');
    await parryCountPage.click('#stop-btn');
    await parryCountPage.waitForFunction(() => window.echoForgeSandbox.getState().turn === 'enemy');
    await parryCountPage.evaluate(() => {
      window.__parryCountdownMutations = 0;
      const observer = new MutationObserver(() => { window.__parryCountdownMutations += 1; });
      observer.observe(document.querySelector('#parry-countdown'), { childList: true, characterData: true, subtree: true });
      window.__parryCountdownObserver = observer;
    });
    await parryCountPage.click('#parry-btn');
    await parryCountPage.waitForTimeout(4200);
    assert.ok(await parryCountPage.evaluate(() => window.__parryCountdownMutations <= 8), 'countdown text updates are bounded to start, seconds, and expiry');
    await parryCountPage.keyboard.press('Escape');
    await parryCountContext.close();

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
