'use strict';

const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { launchPracticeChrome } = require('./helpers/launch-practice-chrome');

const ROOT = path.resolve(__dirname, '../..');
const EVIDENCE_DIR = process.env.PRACTICE_UI_EVIDENCE_DIR || path.join(require('node:os').tmpdir(), 'practice-ui-evidence');

function startServer() {
  const app = express();
  app.use(express.static(path.join(ROOT, 'public')));
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const server = await startServer();
  const browser = await launchPracticeChrome({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1024, height: 900 } });
  const evidence = [];

  try {
    await page.addInitScript(() => {
      localStorage.setItem('userStatus', 'guest');
      localStorage.setItem('hasSeenScopeTutorial', 'true');
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.SpeakingPracticeController, { timeout: 30000 });
    await page.evaluate(() => {
      const panel = document.getElementById('mode-notes');
      panel.classList.add('active');
      panel.style.display = 'block';
    });
    await page.evaluate(() => {
      const originalFetch = window.fetch.bind(window);
      window.__notesAudioAvailable = true;
      window.fetch = (input, init = {}) => {
        const url = String(typeof input === 'string' ? input : input.url || '');
        const method = String(init.method || 'GET').toUpperCase();
        if (url.includes('/database/Take%20Notes/RL/RL.xlsx')) {
          return new Promise((resolve) => setTimeout(() => resolve(new Response(new Uint8Array([1]), { status: 200 })), 80));
        }
        if (url.includes('/database/Take%20Notes/RL/audio/') && method === 'HEAD') {
          const ok = window.__notesAudioAvailable && url.endsWith('.mp3');
          return Promise.resolve(new Response('', {
            status: ok ? 200 : 404,
            headers: ok ? { 'content-type': 'audio/mpeg' } : { 'content-type': 'text/plain' }
          }));
        }
        return originalFetch(input, init);
      };
      window.XLSX = {
        read() { return { SheetNames: ['Sheet1'], Sheets: { Sheet1: {} } }; },
        utils: { sheet_to_json() {
          return [['id', 'title', 'transcript', 'level', 'videoUrl'], ['901', 'Fallback lecture', 'cloud local recovery notes', 2, '']];
        } }
      };
      window.firebase = {
        firestore() {
          return { collection() { return { get() { return new Promise(() => {}); } }; } };
        }
      };
      const originalLoad = HTMLMediaElement.prototype.load;
      HTMLMediaElement.prototype.load = function () {
        void originalLoad;
        setTimeout(() => this.dispatchEvent(new Event('canplay')), 0);
      };
    });
    await page.addScriptTag({ url: `http://127.0.0.1:${server.address().port}/take-notes-mode.js` });
    await page.waitForFunction(() => !!window.TakeNotesMode, { timeout: 10000 });

    const started = Date.now();
    const entryPromise = page.evaluate(() => window.TakeNotesMode.onEnter());
    await page.waitForFunction(() => {
      const status = document.getElementById('notes-entry-status');
      return status?.dataset.notesStatus === 'local-ready';
    }, { timeout: 4000 });
    evidence.push({ check: 'local fallback is offered before cloud deadline', pass: true, elapsedMs: Date.now() - started });
    const loaded = await entryPromise;
    assert.equal(loaded, true, 'bounded local fallback should load usable entries');
    assert.equal(await page.locator('#question-select-notes option').count(), 1);
    evidence.push({ check: 'Firestore hang falls back within bounded entry deadline', pass: true, elapsedMs: Date.now() - started });

    await page.evaluate(() => {
      document.querySelectorAll('#entry-modal, .entry-modal, .auth-overlay, .guest-toast, #app-preloader').forEach((el) => {
        el.style.display = 'none';
        el.style.pointerEvents = 'none';
      });
    });
    await page.locator('#notes-start-btn').click();
    await page.waitForFunction(() => document.getElementById('notes-audio-status')?.dataset.notesStatus === 'ready', { timeout: 5000 });
    assert.equal(await page.locator('#notes-play-btn').isDisabled(), false);
    evidence.push({ check: 'audio enables only after canplay readiness', pass: true });

    await page.evaluate(() => {
      window.__notesAudioAvailable = false;
      window.TakeNotesMode.retryAudio();
    });
    await page.waitForFunction(() => document.getElementById('notes-audio-status')?.dataset.notesStatus === 'unavailable', { timeout: 5000 });
    assert.equal(await page.locator('#notes-play-btn').isDisabled(), true);
    assert.equal(await page.locator('#notes-retry-audio-btn').isVisible(), true);
    evidence.push({ check: 'audio probe failure leaves truthful disabled retry state', pass: true });

    await page.evaluate(() => { window.__notesAudioAvailable = true; });
    await page.locator('#notes-retry-audio-btn').click();
    await page.waitForFunction(() => document.getElementById('notes-audio-status')?.dataset.notesStatus === 'ready', { timeout: 5000 });
    assert.equal(await page.locator('#notes-play-btn').isDisabled(), false);
    evidence.push({ check: 'inline audio retry recovers the same question', pass: true });

    await page.evaluate(async () => {
      window.TakeNotesMode.onExit();
      await window.TakeNotesMode.onEnter();
    });
    assert.equal(await page.locator('#notes-entry-status').getAttribute('data-notes-status'), 'ready');
    evidence.push({ check: 'exit and re-entry invalidate safely without stale overwrite', pass: true });

    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'notes-loading-recovery.png'), fullPage: true });
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'notes-loading-recovery.json'), JSON.stringify({
      chrome: 'channel:chrome', evidence
    }, null, 2));
    console.log(`Notes loading/recovery Chrome checks passed (${evidence.length} probes). Evidence: ${EVIDENCE_DIR}`);
  } finally {
    await page.close();
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(`Notes loading/recovery Chrome check failed: ${error.stack || error}`);
  process.exitCode = 1;
});
