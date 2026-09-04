/**
 * Read Aloud E2E Record -> Check -> Results Cycle Check
 *
 * Verifies the real audio capture pipeline and results lifecycle using
 * Chromium fake media streams (--use-fake-device-for-media-stream).
 * Fulfills Handoff §2 for Task 934-937 UX Redesign.
 */

const { chromium } = require('playwright');
const path = require('path');
const express = require('express');

const app = express();
app.use(express.static(path.join(__dirname, '../../public')));

async function runTest() {
  console.log('--- Starting Read Aloud E2E Record Cycle Check ---');
  let passed = 0;
  let failed = 0;

  function assert(name, condition) {
    if (condition) {
      console.log(`  √ ${name}`);
      passed++;
    } else {
      console.error(`  ✗ ${name}`);
      failed++;
    }
  }

  const server = app.listen(0);
  const port = server.address().port;

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream'
    ]
  });

  try {
    for (const tier of ['basic', 'advanced']) {
      console.log(`\n[Tier: ${tier.toUpperCase()}] Complete Prep -> Record -> Check -> Results flow`);
      const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
      const pageErrors = [];
      page.on('pageerror', err => pageErrors.push(err.message));

      await page.addInitScript((t) => {
        window.localStorage.setItem('userStatus', 'guest');
        window.localStorage.setItem('hasSeenScopeTutorial', 'true');
        window.localStorage.setItem('read-aloudModeFirstUse', 'true');
        window.localStorage.setItem('bel:speaking-controller:view-preference', t);
      }, tier);

      await page.goto(`http://localhost:${port}/?speakingController=v2`, { waitUntil: 'domcontentloaded' });
      const guestBtn = page.locator('#guest-mode-btn');
      if (await guestBtn.isVisible().catch(() => false)) await guestBtn.click();

      await page.evaluate(async () => { await window.switchToMode('read-aloud'); });
      await page.waitForFunction(() => window.ReadAloudMode?.currentPromptReady, { timeout: 15000 }).catch(() => {});

      // 1. Verify PREP phase
      const prepState = await page.evaluate(() => ({
        state: window.ReadAloudMode?.state,
        tier: window.ReadAloudMode?.getEffectiveViewMode(),
        recordBtnVisible: getComputedStyle(document.getElementById('ra-record-btn')).display !== 'none',
        prepTimerEmphasis: document.getElementById('ra-prep-timer-box')?.dataset.timerState
      }));
      assert(`[${tier}] Lands in PREP state`, prepState.state === 'PREP');
      assert(`[${tier}] Start recording button is visible`, prepState.recordBtnVisible);

      // 2. Start Recording
      await page.evaluate(() => document.getElementById('ra-record-btn')?.click());
      await page.waitForFunction(() => window.ReadAloudMode?.state === 'RECORDING', { timeout: 10000 });
      const recordingState = await page.evaluate(() => ({
        state: window.ReadAloudMode?.state,
        stopBtnVisible: getComputedStyle(document.getElementById('ra-stop-btn')).display !== 'none',
        recordTimerEmphasis: document.getElementById('ra-record-timer-box')?.dataset.timerState
      }));
      assert(`[${tier}] Transitions to RECORDING state`, recordingState.state === 'RECORDING');
      assert(`[${tier}] Stop button is visible in controller footer`, recordingState.stopBtnVisible);

      // Capture audio for 1.5 seconds
      await page.waitForTimeout(1500);

      // 3. Stop Recording
      await page.evaluate(() => document.getElementById('ra-stop-btn')?.click());
      await page.waitForFunction(() => window.ReadAloudMode?.state === 'RECORDED', { timeout: 10000 });
      const recordedState = await page.evaluate(() => ({
        state: window.ReadAloudMode?.state,
        hasBlob: !!window.ReadAloudMode?.pendingBlob,
        blobSize: window.ReadAloudMode?.pendingBlob?.size || 0,
        checkBtnVisible: getComputedStyle(document.getElementById('ra-check-btn')).display !== 'none',
        retryBtnVisible: getComputedStyle(document.getElementById('ra-retry-btn')).display !== 'none'
      }));
      assert(`[${tier}] Transitions to RECORDED state`, recordedState.state === 'RECORDED');
      assert(`[${tier}] Captures real audio blob (size > 1000 bytes)`, recordedState.blobSize > 1000);
      assert(`[${tier}] Check button is visible in controller footer`, recordedState.checkBtnVisible);
      assert(`[${tier}] Retry button is visible in controller footer`, recordedState.retryBtnVisible);

      // 4. Submit & Verify Results
      await page.evaluate(() => {
        window.fetchOriginal = window.fetch;
        window.fetch = async (url, opts) => {
          if (typeof url === 'string' && url.includes('/api/read-aloud/assess')) {
            return new Response(JSON.stringify({
              success: true,
              overallScore: 82,
              pronunciationScore: 79,
              fluencyScore: 84,
              recognizedText: "The quick brown fox jumps over the lazy dog.",
              wordDetails: [],
              connectedSpeech: {
                summary: { totalTested: 4, followedCount: 3, followedPercent: 75 },
                findings: [
                  { id: 'f1', type: 'linking', phrase: 'quick brown', score: 88, status: 'good' },
                  { id: 'f2', type: 'reduced_words', phrase: 'the', score: 72, status: 'good' }
                ]
              }
            }), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
          return window.fetchOriginal(url, opts);
        };
        document.getElementById('ra-check-btn')?.click();
      });

      await page.waitForFunction(() => window.ReadAloudMode?.state === 'RESULTS', { timeout: 10000 });
      const resultsState = await page.evaluate(() => ({
        state: window.ReadAloudMode?.state,
        resultBoxVisible: getComputedStyle(document.getElementById('ra-result-box')).display !== 'none',
        coachVisible: getComputedStyle(document.getElementById('ra-connected-speech-list')).display !== 'none',
        findingsCount: document.querySelectorAll('#ra-connected-speech-list .sc-card, #ra-connected-speech-list [data-guide-item], #ra-connected-speech-list > *').length
      }));

      assert(`[${tier}] Transitions to RESULTS state`, resultsState.state === 'RESULTS');
      assert(`[${tier}] Results score box is visible`, resultsState.resultBoxVisible);
      assert(`[${tier}] Speech coach findings list is visible`, resultsState.coachVisible);
      assert(`[${tier}] Scored coach findings rendered`, resultsState.findingsCount >= 1);
      assert(`[${tier}] No console page errors during cycle`, pageErrors.length === 0);

      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }

  console.log(`\n--- Results: ${passed} passed, ${failed} failed, ${passed + failed} total ---`);
  if (failed > 0) {
    console.error('--- Read Aloud E2E Record Cycle Check FAILED ---');
    process.exit(1);
  } else {
    console.log('--- Read Aloud E2E Record Cycle Check PASSED ---');
  }
}

runTest().catch((err) => {
  console.error('Unhandled test exception:', err);
  process.exit(1);
});
