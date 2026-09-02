/* eslint-disable no-console */
/**
 * Practice Modes Full UI Audit — 2026-09-01  (Task 756)
 *
 * Read-only audit (no assertions) over every learner practice surface.
 * Built to catch the two defect classes reported by hand as tasks 754/755:
 *
 *   755 — geometry: an element whose border box is wider than its container
 *         (`width: min(470px,100%)` + padding, no box-sizing -> 518px).
 *   754 — inert control: a Play button wired to a handler that early-returns,
 *         so the click produces no playback and no error.
 *
 * Probes per surface, per viewport:
 *   1. overflow / clipping        (offsetWidth vs parent clientWidth, scrollWidth vs clientWidth)
 *   2. page-level horizontal scroll
 *   3. inert controls             (visible control with zero click listeners)
 *   4. media probe                (click primary Play, assert the <audio> actually starts)
 *   5. hit-testing                (elementFromPoint at centre resolves to the control)
 *   6. geometry sanity            (zero-size visible elements; mobile touch targets < 44px)
 *   7. text legibility            (WCAG AA contrast; clipped text)
 *   8. style inventory            (cross-mode drift: font/height/radius/colour of like controls)
 *
 * Usage:
 *   node tests/browser/practice-modes-ui-full-audit.js
 *   node tests/browser/practice-modes-ui-full-audit.js --modes sst,hcs --viewport desktop
 *   node tests/browser/practice-modes-ui-full-audit.js --out test-results/practice-ui-audit-after
 *
 * Writes report.json + per-surface screenshots to
 *   test-results/practice-ui-audit-2026-09-01/   (override with --out)
 */
const fs = require('fs');
const path = require('path');
const express = require('express');
const { chromium } = require('playwright');

// -- surfaces ---------------------------------------------------------------
const PANEL_MODES = [
  // Speaking
  'read-aloud', 'rts', 'asq', 'describe-image', 'notes', 'sgd', 'speak',
  // Listening
  'sst', 'lmcma', 'lmcsa', 'smw', 'hiw', 'hcs',
  // Reading
  'rfib', 'dd', 'rmcma', 'rmcsa', 'rop',
  // Writing
  'essay', 'swt',
  // Other learner practice surfaces
  'pronounce', 'type', 'collo-dictate', 'watch', 'extended'
];

// Surfaces that are overlays rather than .mode-panel children.
const OVERLAY_SURFACES = [
  {
    id: 'vocab-book',
    root: '#vocab-panel-side',
    open: async (page) => {
      // The floating .vocab-panel-toggle is `display:none !important` at every
      // width; the surface is opened from the header / mobile toolbar, which call
      // the module's own togglePanel(). Drive that directly so the probe measures
      // the panel rather than the launcher.
      await page.evaluate(() => {
        const vb = window.VocabularyBook;
        if (vb && vb.togglePanel) return vb.togglePanel();
        const side = document.getElementById('vocab-panel-side');
        if (side) side.classList.add('expanded');
        return null;
      });
      await page.waitForTimeout(900);
    }
  },
  {
    id: 'srs-review',
    root: '#srs-review-panel',
    open: async (page) => {
      await page.evaluate(() => {
        const p = document.getElementById('srs-review-panel');
        const o = document.getElementById('srs-overlay');
        if (p) p.style.display = '';
        if (o) o.classList.add('active');
      });
      await page.waitForTimeout(700);
    }
  },
  {
    id: 'survival',
    root: '#survival-game-overlay',
    open: async (page) => {
      await page.evaluate(() => window._openSurvivalOverlayAndStart && window._openSurvivalOverlayAndStart());
      await page.waitForTimeout(1500);
    }
  }
];

const VIEWPORTS = {
  desktop: { width: 1440, height: 1000 },
  mobile: { width: 390, height: 844 }
};

// -- args -------------------------------------------------------------------
function parseArgs(argv) {
  const out = {
    modes: null,
    viewports: Object.keys(VIEWPORTS),
    outDir: path.resolve(__dirname, '../../test-results/practice-ui-audit-2026-09-01'),
    headed: false,
    shots: true
  };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--modes') { out.modes = argv[i + 1].split(',').map((s) => s.trim()); i += 1; }
    else if (argv[i] === '--viewport') { out.viewports = argv[i + 1].split(',').map((s) => s.trim()); i += 1; }
    else if (argv[i] === '--out') { out.outDir = path.resolve(process.cwd(), argv[i + 1]); i += 1; }
    else if (argv[i] === '--headed') { out.headed = true; }
    else if (argv[i] === '--no-shots') { out.shots = false; }
  }
  return out;
}
const ARGS = parseArgs(process.argv);
fs.mkdirSync(ARGS.outDir, { recursive: true });

const app = express();
app.use(express.static(path.join(__dirname, '../../public')));

// -- page bootstrap (runs before any app script) ----------------------------
function initScript() {
  window.localStorage.setItem('userStatus', 'guest');
  window.localStorage.setItem('hasSeenScopeTutorial', 'true');
  [
    'read-aloud', 'rts', 'asq', 'describe-image', 'notes', 'sgd', 'speak', 'type',
    'sst', 'lmcma', 'lmcsa', 'smw', 'hiw', 'hcs', 'rfib', 'dd', 'rmcma', 'rmcsa',
    'rop', 'essay', 'swt', 'pronounce', 'collo-dictate', 'watch', 'extended'
  ].forEach((mode) => window.localStorage.setItem(mode + 'ModeFirstUse', 'true'));

  // Stub the mic so recording surfaces mount their full UI.
  class StubRecorder extends EventTarget {
    constructor(stream) { super(); this.stream = stream; this.state = 'inactive'; this.mimeType = 'audio/wav'; }
    start() { this.state = 'recording'; this.dispatchEvent(new Event('start')); }
    stop() {
      this.state = 'inactive';
      const ev = new Event('dataavailable');
      Object.defineProperty(ev, 'data', { value: new Blob(['x'], { type: this.mimeType }) });
      if (this.ondataavailable) this.ondataavailable(ev);
      this.dispatchEvent(ev);
      const s = new Event('stop');
      if (this.onstop) this.onstop(s);
      this.dispatchEvent(s);
    }
  }
  Object.defineProperty(window, 'MediaRecorder', { configurable: true, writable: true, value: StubRecorder });
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: async () => ({ getTracks: () => [{ stop() { } }] }) }
  });

  // Listener census. Bug 754 had a listener that early-returned, so "no listener"
  // is only one of the two inert-control signals; the media probe covers the other.
  (function () {
    const CLICKY = new Set(['click', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'change', 'input', 'submit', 'keydown']);
    const orig = EventTarget.prototype.addEventListener;
    const marked = new WeakSet();
    window.__hasListener = (el) => { try { return marked.has(el); } catch (e) { return false; } };
    EventTarget.prototype.addEventListener = function (type, fn, opts) {
      if (CLICKY.has(type)) { try { marked.add(this); } catch (e) { /* non-object target */ } }
      return orig.call(this, type, fn, opts);
    };
  })();

  // Audio telemetry - did anything actually start playing?
  (function () {
    const log = [];
    window.__audioLog = () => log.slice();
    window.__audioReset = () => { log.length = 0; };
    try {
      const play = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function (...args) {
        log.push({ t: Math.round(performance.now()), phase: 'play-called', src: this.currentSrc || this.getAttribute('src') || '' });
        return play.apply(this, args);
      };
    } catch (e) { /* ignore */ }
    document.addEventListener('play', (e) => {
      log.push({ t: Math.round(performance.now()), phase: 'play-event', src: e.target.currentSrc || '' });
    }, true);
    // SRS review and the vocabulary surfaces speak through the Web Speech API
    // rather than an <audio> element; without this they read as inert.
    try {
      if (window.speechSynthesis && window.speechSynthesis.speak) {
        const speak = window.speechSynthesis.speak.bind(window.speechSynthesis);
        window.speechSynthesis.speak = function (utt) {
          log.push({ t: Math.round(performance.now()), phase: 'speech', src: (utt && utt.text ? String(utt.text).slice(0, 40) : '') });
          return speak(utt);
        };
      }
    } catch (e) { /* ignore */ }
    document.addEventListener('error', (e) => {
      if (e.target && (e.target.tagName === 'AUDIO' || e.target.tagName === 'SOURCE')) {
        log.push({ t: Math.round(performance.now()), phase: 'media-error', src: e.target.currentSrc || e.target.src || '' });
      }
    }, true);
  })();

  // Mutation counter. The 754 signature is a control that looks live and changes
  // nothing at all, so "no DOM mutation anywhere" is the decisive signal - a
  // control that only repaints via a class still counts as responsive.
  (function () {
    let count = 0;
    window.__mutReset = () => { count = 0; };
    window.__mutCount = () => count;
    const start = () => {
      new MutationObserver((records) => { count += records.length; }).observe(document.documentElement, {
        subtree: true, childList: true, attributes: true, characterData: true
      });
    };
    if (document.documentElement) start(); else document.addEventListener('DOMContentLoaded', start);
  })();
}

async function dismissOverlays(page) {
  await page.waitForFunction(() => {
    const p = document.getElementById('app-preloader');
    if (!p) return true;
    return getComputedStyle(p).display === 'none' || !!document.getElementById('preloader-dismiss-btn');
  }, { timeout: 30000 }).catch(() => { });
  for (const sel of ['#preloader-dismiss-btn', '#guest-mode-btn']) {
    const loc = page.locator(sel);
    if (await loc.count()) await loc.click({ timeout: 3000 }).catch(() => { });
  }
  await page.waitForFunction(() => typeof window.switchToMode === 'function', { timeout: 30000 });
  await page.waitForTimeout(300);
}


// -- entry point -------------------------------------------------------------
const { run } = require("./practice-modes-ui-runner");

run({ PANEL_MODES, OVERLAY_SURFACES, VIEWPORTS, initScript, dismissOverlays, app, ARGS })
  .catch((err) => { console.error(err); process.exit(1); });
