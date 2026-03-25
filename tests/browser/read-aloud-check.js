/* eslint-disable no-console */
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
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
  await page.goto('https://localhost:8443/', { waitUntil: 'domcontentloaded' });

  // Dismiss entry modal
  console.log('Dismissing entry modal...');
  await page.click('#guest-mode-btn');

  // Wait for mode cards
  console.log('Waiting for mode cards...');
  await page.waitForSelector('.mode-switch-btn', { state: 'visible' });

  // Locate Read Aloud card
  const cards = await page.$$('.card-body h3');
  let readAloudFound = false;
  for (const card of cards) {
    const text = await card.textContent();
    if (text.includes('Read Aloud')) {
      readAloudFound = true;
      console.log('Read Aloud card found! Clicking it...');
      await card.evaluate(node => node.closest('.mode-switch-btn').click());
      break;
    }
  }

  if (!readAloudFound) {
    console.error('FAIL: Read Aloud card not found!');
    await browser.close();
    process.exit(1);
  }

  // Wait for Tutorial and read aloud mode panel
  console.log('Checking for tutorial...');
  await dismissTutorialIfVisible();

  await page.waitForSelector('#mode-read-aloud.active', { state: 'visible', timeout: 5000 });
  console.log('Read Aloud mode panel is active.');

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
  } else if (recordBtnText.includes('Skip Prep')) {
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
    }
  }

  console.log('Test complete. Closing browser.');
  await browser.close();
})();
