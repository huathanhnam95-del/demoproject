'use strict';
const path = require('path');
const express = require('express');
const { launchPracticeChrome } = require('./launch-practice-chrome');

// Same guest and media bootstrap as practice-modes-ui-full-audit, without its telemetry patches.
function initScript() {
  localStorage.setItem('userStatus', 'guest'); localStorage.setItem('hasSeenScopeTutorial', 'true');
  ['read-aloud', 'speak', 'describe-image', 'notes', 'asq', 'sgd', 'rts'].forEach(mode => localStorage.setItem(`${mode}ModeFirstUse`, 'true'));
  class StubRecorder extends EventTarget {
    constructor(stream) { super(); this.stream = stream; this.state = 'inactive'; this.mimeType = 'audio/wav'; }
    start() { this.state = 'recording'; this.dispatchEvent(new Event('start')); }
    stop() {
      this.state = 'inactive';
      const event = new Event('dataavailable'); Object.defineProperty(event, 'data', { value: new Blob(['x'], { type: this.mimeType }) });
      this.ondataavailable?.(event); this.dispatchEvent(event);
      const stop = new Event('stop'); this.onstop?.(stop); this.dispatchEvent(stop);
    }
  }
  Object.defineProperty(window, 'MediaRecorder', { configurable: true, value: StubRecorder });
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } });
}
async function dismissOverlays(page) {
  await page.waitForFunction(() => {
    const preloader = document.getElementById('app-preloader');
    return !preloader || getComputedStyle(preloader).display === 'none' || !!document.getElementById('preloader-dismiss-btn');
  }, null, { timeout: 30000 });
  await page.waitForFunction(() => typeof window.switchToMode === 'function');
  for (const selector of ['#preloader-dismiss-btn', '#guest-mode-btn']) {
    if (await page.locator(selector).isVisible().catch(() => false)) await page.locator(selector).click({ timeout: 10000 });
  }
  await page.waitForFunction(() => {
    const modal = document.getElementById('entry-modal');
    return !modal || getComputedStyle(modal).display === 'none';
  });
}
async function createHarness() {
  const app = express(); app.use(express.static(path.resolve(__dirname, '../../../public')));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const browser = await launchPracticeChrome({ args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
  const baseURL = `http://127.0.0.1:${server.address().port}`;
  return { browser, baseURL,
    async open({ width = 1440, height = 900, flag = 'v3' } = {}) {
      const page = await browser.newPage({ viewport: { width, height } });
      await page.addInitScript(initScript);
      await page.goto(`${baseURL}/?pteShell=${flag}`, { waitUntil: 'domcontentloaded' });
      await dismissOverlays(page);
      return page;
    },
    async close() { await browser.close(); await new Promise(resolve => server.close(resolve)); }
  };
}
module.exports = { initScript, dismissOverlays, createHarness };
