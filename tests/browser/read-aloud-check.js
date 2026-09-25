/* eslint-disable no-console */
const { chromium } = require('playwright');
const { dismissOverlays } = require('./helpers/pte-shell-harness');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  // Since the V2.0.15 AI-credit gate a missing quote endpoint (404) blocks scoring; 503 means
  // "credits off", which scores unmetered like the test expects.
  await context.route('**/api/ai-scoring/quotes', route => route.fulfill({ status: 503, json: { error: 'AI scoring disabled' } }));
  await context.addInitScript(() => {
    class FakeMediaRecorder {
      constructor(stream) {
        this.stream = stream;
        this.state = 'inactive';
        this.mimeType = 'audio/webm';
        this.listeners = {};
      }

      addEventListener(type, handler) {
        if (!this.listeners[type]) this.listeners[type] = [];
        this.listeners[type].push(handler);
      }

      start() {
        this.state = 'recording';
      }

      stop() {
        if (this.state !== 'recording') return;
        this.state = 'inactive';
        const blob = new Blob(['fake-audio'], { type: this.mimeType });
        (this.listeners.dataavailable || []).forEach((handler) => handler({ data: blob }));
        (this.listeners.stop || []).forEach((handler) => handler());
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
          getTracks() {
            return [{
              stop() {}
            }];
          }
        })
      }
    });
  });
  const page = await context.newPage();

  async function dismissTutorialIfVisible() {
    await page.waitForTimeout(700);
    const isTutorialVisible = await page.evaluate(() => {
      const overlay = document.getElementById('tutorial-overlay');
      return !!overlay
        && overlay.classList.contains('active')
        && getComputedStyle(overlay).display !== 'none';
    });
    if (!isTutorialVisible) {
      console.log('Tutorial not visible, maybe already skipped.');
      return;
    }

    console.log('Tutorial is visible. Skipping tutorial...');
    await page.click('#tutorial-skip');
    await page.waitForFunction(() => {
      const overlay = document.getElementById('tutorial-overlay');
      return !overlay
        || !overlay.classList.contains('active')
        || getComputedStyle(overlay).display === 'none';
    }, { timeout: 5000 });
  }

  console.log('Navigating to https://localhost:8443/');
  await page.goto('https://localhost:8443/?pteShell=legacy&raWorkspace=legacy', { waitUntil: 'domcontentloaded' });

  // Preloader, then the guest entry (the dashboard mode cards this used to click are gone).
  console.log('Dismissing preloader and entry modal...');
  await dismissOverlays(page);
  console.log('Opening Read Aloud...');
  await page.evaluate(() => window.switchToMode('read-aloud'));

  // Wait for Tutorial and read aloud mode panel
  console.log('Checking for tutorial...');
  await dismissTutorialIfVisible();

  await page.waitForSelector('#mode-read-aloud.active', { state: 'visible', timeout: 5000 });
  console.log('Read Aloud mode panel is active.');

  // The prompt guides are an advanced-level in-place control, so the Speaking
  // Practice Controller keeps them hidden in the default Basic view
  // (speaking-practice-controller.css gates [data-spc-level="advanced"]).
  // Switch to Advanced before asserting on them.
  await page.evaluate(() => {
    // The old view-toggle button is gone; the controller exposes the preference directly.
    try { window.SpeakingPracticeController?.setPreferredView('advanced'); } catch (_) {}
    document.querySelector('.spc-view-toggle-btn[data-view="advanced"]')?.click();
  });
  await page.waitForSelector('#ra-prompt-guides-group', { state: 'visible', timeout: 5000 });
  const guideState = await page.evaluate(() => ({
    chunkingPressed: document.getElementById('ra-toggle-chunking-btn')?.getAttribute('aria-pressed'),
    linkingPressed: document.getElementById('ra-toggle-linking-btn')?.getAttribute('aria-pressed')
  }));
  console.log('Prompt guide state:', guideState);

  // Check initial state (PREP)
  const statusMsg = await page.textContent('#ra-status-message');
  console.log('Status message:', statusMsg);
  
  const recordBtnText = await page.textContent('#ra-record-btn');
  console.log('Record button text:', recordBtnText);
  
  if (recordBtnText.includes('Unsupported Browser')) {
    console.log('Browser does not support STT, gracefully handling unsupported state.');
  } else if (/Skip Prep|Start recording/i.test(recordBtnText)) {
    console.log('In Prep state. Skipping prep...');
    await dismissTutorialIfVisible();
    await page.click('#ra-record-btn');
    
    await page.waitForFunction(() => {
      const stopBtn = document.getElementById('ra-stop-btn');
      const status = document.getElementById('ra-status-message');
      return !!stopBtn && getComputedStyle(stopBtn).display !== 'none' && /recording/i.test(String(status?.textContent || ''));
    }, { timeout: 5000 });

    const state = await page.evaluate(() => ({
      stopBtnVisible: getComputedStyle(document.getElementById('ra-stop-btn')).display !== 'none',
      statusText: document.getElementById('ra-status-message')?.textContent || ''
    }));
    console.log('Recording state:', state);

    if (state.stopBtnVisible) {
      console.log('SUCCESS: Recording started.');
    } else {
      console.log('FAIL: Did not enter recording state.');
      process.exitCode = 1;
    }
  }

  console.log('Test complete. Closing browser.');
  await browser.close();
})();
