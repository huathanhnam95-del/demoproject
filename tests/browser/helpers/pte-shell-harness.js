'use strict';
const path = require('path');
const express = require('express');
const { launchPracticeChrome } = require('./launch-practice-chrome');

// Same guest and media bootstrap as practice-modes-ui-full-audit, without its telemetry patches.
function initScript() {
  const blockedProviderHost = 'praat-api-1071929245506.us-central1.run.app';
  const blockedRequests = [];
  Object.defineProperty(window, '__pteBlockedProviderRequests', { configurable: false, value: blockedRequests });
  const getProviderRequestUrl = input => {
    try {
      const candidate = typeof input === 'string' ? input : input && input.url;
      const url = new URL(candidate, location.href);
      return url.hostname === blockedProviderHost ? url.href : null;
    } catch (_) {
      return null;
    }
  };
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = getProviderRequestUrl(input);
    if (url) {
      blockedRequests.push(url);
      return Promise.reject(new TypeError('PRAAT provider traffic is disabled in the synthetic browser harness.'));
    }
    return nativeFetch(input, init);
  };
  const nativeXhrOpen = XMLHttpRequest.prototype.open;
  const nativeXhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...args) {
    this.__pteBlockedProviderUrl = getProviderRequestUrl(url);
    return nativeXhrOpen.call(this, method, url, ...args);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    if (this.__pteBlockedProviderUrl) {
      blockedRequests.push(this.__pteBlockedProviderUrl);
      setTimeout(() => {
        this.dispatchEvent(new ProgressEvent('error'));
        this.dispatchEvent(new ProgressEvent('loadend'));
      }, 0);
      return undefined;
    }
    return nativeXhrSend.apply(this, args);
  };
  localStorage.setItem('userStatus', 'guest'); localStorage.setItem('hasSeenScopeTutorial', 'true');
  sessionStorage.setItem('guestMode', 'true'); sessionStorage.setItem('welcomeModalSeen', 'true');
  ['read-aloud', 'speak', 'describe-image', 'notes', 'asq', 'sgd', 'rts'].forEach(mode => localStorage.setItem(`${mode}ModeFirstUse`, 'true'));
  function createStubWavBlob() {
    const samples = 8000;
    const buffer = new ArrayBuffer(44 + samples * 2);
    const view = new DataView(buffer);
    const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + samples * 2, true);
    writeStr(8, 'WAVEfmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 16000, true);
    view.setUint32(28, 32000, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, 'data');
    view.setUint32(40, samples * 2, true);
    return new Blob([buffer], { type: 'audio/wav' });
  }
  class StubRecorder extends EventTarget {
    constructor(stream) { super(); this.stream = stream; this.state = 'inactive'; this.mimeType = 'audio/wav'; }
    start() { this.state = 'recording'; this.dispatchEvent(new Event('start')); }
    stop() {
      this.state = 'inactive';
      const event = new Event('dataavailable'); Object.defineProperty(event, 'data', { value: createStubWavBlob() });
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
      const url = flag ? `${baseURL}/?pteShell=${flag}` : `${baseURL}/`;
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await dismissOverlays(page);
      return page;
    },
    async close() { await browser.close(); await new Promise(resolve => server.close(resolve)); }
  };
}
module.exports = { initScript, dismissOverlays, createHarness };
