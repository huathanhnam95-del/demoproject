/* eslint-disable no-console */
/**
 * Read Aloud lifecycle browser check — Wave 4C.
 *
 * Exercises the real Chrome UI flow with microphone and assessment boundaries
 * mocked at the browser edge:
 *   Record -> Stop -> RECORDED -> playback -> Check -> RESULTS -> Retry/Next
 */
const assert = require('assert');
const { chromium } = require('playwright');

const baseUrl = process.env.BROWSER_TEST_BASE_URL || 'https://localhost:8443';

async function dismissBlockingOverlays(page) {
  const preloader = page.locator('#app-preloader');
  if (await preloader.count()) {
    await page.waitForFunction(() => {
      const element = document.getElementById('app-preloader');
      return !element || getComputedStyle(element).display === 'none' || !!document.getElementById('preloader-dismiss-btn');
    }, { timeout: 15000 });
    const dismiss = page.locator('#preloader-dismiss-btn');
    if (await dismiss.count() && await dismiss.isVisible().catch(() => false)) {
      await dismiss.click();
    }
    await page.waitForFunction(() => {
      const element = document.getElementById('app-preloader');
      return !element || getComputedStyle(element).display === 'none';
    }, { timeout: 15000 });
  }

  const guest = page.locator('#guest-mode-btn');
  if (await guest.isVisible().catch(() => false)) {
    await guest.click();
  }
  await page.waitForFunction(() => {
    const entry = document.getElementById('entry-modal');
    const wrapper = document.getElementById('page-layout-wrapper');
    return (!entry || getComputedStyle(entry).display === 'none')
      && !!wrapper
    && getComputedStyle(wrapper).display !== 'none';
  }, { timeout: 15000 });

  await dismissTutorial(page);
  const levelModal = page.locator('#level-selection-modal');
  if (await levelModal.count() && await levelModal.isVisible().catch(() => false)) {
    await page.evaluate(() => {
      const modal = document.getElementById('level-selection-modal');
      if (modal) modal.style.display = 'none';
    });
  }
}

async function dismissTutorial(page) {
  const tutorial = page.locator('#tutorial-overlay');
  if (await tutorial.count() && await tutorial.evaluate((element) => element.classList.contains('active')).catch(() => false)) {
    const skip = page.locator('#tutorial-skip');
    if (await skip.count() && await skip.isVisible().catch(() => false)) {
      await skip.click();
    }
    await page.waitForFunction(() => {
      const element = document.getElementById('tutorial-overlay');
      return !element || !element.classList.contains('active') || getComputedStyle(element).display === 'none';
    }, { timeout: 10000 });
  }
  await page.evaluate(() => {
    const t = document.getElementById('tutorial-overlay');
    if (t) { t.classList.remove('active'); t.style.display = 'none'; }
    const b = document.getElementById('tutorial-backdrop');
    if (b) b.style.display = 'none';
  });
}

async function waitForReadAloudState(page, state) {
  await page.waitForFunction((expected) => window.ReadAloudMode?.state === expected, state, { timeout: 10000 });
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1200 } });
  await context.addInitScript(() => {
    localStorage.setItem('userStatus', 'guest');
    localStorage.setItem('hasSeenScopeTutorial', 'true');
    localStorage.setItem('read-aloudModeFirstUse', 'true');
    localStorage.setItem('bel_tutorial_completed_read-aloud', 'true');
    sessionStorage.setItem('bel_app_loaded', '1');

    class FakeMediaRecorder {
      constructor(stream) {
        this.stream = stream;
        this.state = 'inactive';
        this.mimeType = 'audio/webm';
        this.listeners = {};
      }

      addEventListener(type, handler) {
        (this.listeners[type] ||= []).push(handler);
      }

      start() {
        this.state = 'recording';
      }

      stop() {
        if (this.state !== 'recording') return;
        this.state = 'inactive';
        const data = new Blob(['wave-4c-fixture'], { type: this.mimeType });
        for (const handler of this.listeners.dataavailable || []) handler({ data });
        for (const handler of this.listeners.stop || []) handler();
      }
    }

    Object.defineProperty(window, 'MediaRecorder', {
      configurable: true,
      writable: true,
      value: FakeMediaRecorder
    });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => ({
          getTracks: () => [{ stop() {} }]
        })
      }
    });
  });

  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await page.route('**/api/read-aloud/assess', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        accuracyScore: 92,
        fluencyScore: 88,
        completenessScore: 94,
        pronScore: 90,
        recognizedText: 'wave four c fixture',
        words: [
          { word: 'wave', accuracyScore: 92 },
          { word: 'four', accuracyScore: 90 },
          { word: 'c', accuracyScore: 88 }
        ]
      })
    });
  });

  try {
    await page.goto(`${baseUrl}/?speakingController=v2`, { waitUntil: 'domcontentloaded' });
    await dismissBlockingOverlays(page);
    await page.evaluate(async () => {
      if (typeof window.switchToMode !== 'function') throw new Error('switchToMode is unavailable');
      await window.switchToMode('read-aloud');
    });
    await page.waitForTimeout(700);
    await dismissTutorial(page);
    await page.waitForFunction(() => window.ReadAloudMode?.currentPromptReady === true, { timeout: 15000 });

    const setup = await page.evaluate(() => {
      const ra = window.ReadAloudMode;
      ra.prepSeconds = 0;
      ra.startPrepTimer = () => {};
      ra.prepareWavBlob = async () => new Blob(['RIFF-wave-4c'], { type: 'audio/wav' });
      const originalRetry = ra.retryCurrentPrompt.bind(ra);
      window.__wave4cRetryCalls = 0;
      ra.retryCurrentPrompt = () => {
        window.__wave4cRetryCalls += 1;
        return originalRetry();
      };
      ra.userRecordingUrl = null;
      ra.clearRecordedAudio();
      ra.hasAssessmentResult = false;
      ra.pendingBlob = null;
      ra.pendingSession = null;
      window.__wave4cSavedAttempts = 0;
      if (window.PTEAttemptArchive) {
        window.PTEAttemptArchive.saveAttempt = async () => {
          window.__wave4cSavedAttempts += 1;
        };
      }
      ra.state = 'PREP';
      ra.updateUIForState();
      return {
        controllerMounted: !!document.querySelector('#mode-read-aloud .spc-controller'),
        promptId: ra.currentQuestionId,
        promptToken: ra.promptLifecycleToken
      };
    });

    assert.strictEqual(setup.controllerMounted, true, 'Read Aloud shared controller is mounted');
    assert.ok(setup.promptId, 'Read Aloud has an active prompt');

    await dismissBlockingOverlays(page);
    await page.locator('#ra-record-btn').click();
    await waitForReadAloudState(page, 'RECORDING');
    assert.notStrictEqual(await page.locator('#ra-stop-btn').evaluate((el) => getComputedStyle(el).display), 'none', 'Stop is visible while recording');

    await page.locator('#ra-stop-btn').click({ force: true });
    await waitForReadAloudState(page, 'RECORDED');
    const recorded = await page.evaluate(() => ({
      checkVisible: getComputedStyle(document.getElementById('ra-check-btn')).display !== 'none',
      retryVisible: getComputedStyle(document.getElementById('ra-retry-btn')).display !== 'none',
      audioSrc: document.getElementById('ra-user-recording-audio')?.src || '',
      pendingBlob: !!window.ReadAloudMode.pendingBlob
    }));
    assert.strictEqual(recorded.checkVisible, true, 'Check is visible after Stop');
    assert.strictEqual(recorded.retryVisible, true, 'Retry is visible after Stop');
    assert.ok(recorded.audioSrc, 'Recorded playback has a blob URL');
    assert.strictEqual(recorded.pendingBlob, true, 'Captured audio is staged before Check');

    const playbackControl = await page.evaluate(() => {
      const audio = document.getElementById('ra-user-recording-audio');
      return {
        visible: !!audio && getComputedStyle(audio).display !== 'none',
        controls: !!audio?.controls,
        src: audio?.src || '',
        recordingUrl: window.ReadAloudMode?.userRecordingUrl || ''
      };
    });
    assert.strictEqual(playbackControl.visible, true, 'Native recording playback control is visible');
    assert.strictEqual(playbackControl.controls, true, 'Native recording playback controls are enabled');
    assert.ok(playbackControl.src, 'Native recording playback has a blob URL');
    assert.strictEqual(playbackControl.recordingUrl, playbackControl.src, 'Playback control is wired to captured audio');

    await page.locator('#ra-check-btn').click();
    try {
      await waitForReadAloudState(page, 'RESULTS');
    } catch (error) {
      const diagnostics = await page.evaluate(() => ({
        state: window.ReadAloudMode?.state,
        isSubmitInFlight: window.ReadAloudMode?.isSubmitInFlight,
        pendingBlob: !!window.ReadAloudMode?.pendingBlob,
        pendingSession: !!window.ReadAloudMode?.pendingSession,
        status: document.getElementById('ra-status-message')?.textContent || '',
        checkText: document.getElementById('ra-check-btn')?.textContent || '',
        request: window.ReadAloudMode?.lastAssessmentRequest || null
      }));
      console.error('Check transition diagnostics:', JSON.stringify(diagnostics));
      console.error('Console errors:', JSON.stringify(consoleErrors));
      throw error;
    }
    const results = await page.evaluate(() => ({
      resultVisible: getComputedStyle(document.getElementById('ra-result-box')).display !== 'none',
      score: document.getElementById('ra-accuracy-value')?.textContent?.trim(),
      checkHidden: getComputedStyle(document.getElementById('ra-check-btn')).display === 'none',
      savedAttempts: window.__wave4cSavedAttempts
    }));
    assert.strictEqual(results.resultVisible, true, 'Assessment results are visible after Check');
    assert.strictEqual(results.score, '92', 'Assessment score is rendered');
    assert.strictEqual(results.checkHidden, true, 'Check is hidden after successful assessment');
    assert.strictEqual(results.savedAttempts, 1, 'Successful assessment archives one attempt');

    await page.locator('#ra-retry-btn').click({ force: true });
    try {
      await waitForReadAloudState(page, 'PREP');
    } catch (error) {
      const retryDiagnostics = await page.evaluate(() => {
        const element = document.getElementById('ra-retry-btn');
        const rect = element?.getBoundingClientRect();
        const center = rect ? document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) : null;
        return {
          state: window.ReadAloudMode?.state,
          resultVisible: getComputedStyle(document.getElementById('ra-result-box')).display,
          retryDisplay: getComputedStyle(element).display,
          retryRect: rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null,
          elementAtRetryCenter: center?.id || center?.tagName || null,
          retryCalls: window.__wave4cRetryCalls,
          retryDisabled: !!element?.disabled,
          controllerHtml: document.querySelector('#mode-read-aloud .spc-controller')?.innerHTML?.slice(0, 1200) || ''
        };
      });
      console.error('Retry transition diagnostics:', JSON.stringify(retryDiagnostics));
      throw error;
    }
    assert.strictEqual(await page.evaluate(() => window.ReadAloudMode.hasAssessmentResult), false, 'Retry clears assessment results');
    assert.strictEqual(await page.evaluate(() => window.ReadAloudMode.pendingBlob), null, 'Retry clears staged audio');

    const beforeNext = await page.evaluate(() => ({ id: window.ReadAloudMode.currentQuestionId, token: window.ReadAloudMode.promptLifecycleToken }));
    await page.evaluate(() => {
      const ra = window.ReadAloudMode;
      ra.state = 'RESULTS';
      ra.updateUIForState();
    });
    await page.locator('#ra-record-btn').click({ force: true });
    await page.waitForFunction((previous) => window.ReadAloudMode.promptLifecycleToken > previous, beforeNext.token, { timeout: 15000 });
    await waitForReadAloudState(page, 'PREP');
    assert.ok(await page.evaluate((previous) => window.ReadAloudMode.promptLifecycleToken > previous, beforeNext.token), 'Next advances the prompt lifecycle');

    assert.deepStrictEqual(pageErrors, [], `Expected no page errors, got: ${pageErrors.join(' | ')}`);
    console.log('Read Aloud lifecycle browser check: 20 passed, 0 failed');
  } finally {
    await context.close();
    await browser.close();
  }
})().catch((error) => {
  console.error('Read Aloud lifecycle browser check FAILED');
  console.error('Diagnostics:', error);
  console.error(error);
  process.exit(1);
});
