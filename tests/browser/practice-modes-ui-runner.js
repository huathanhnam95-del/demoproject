/* eslint-disable no-console */
/**
 * Runner half of the Practice Modes Full UI Audit (Task 756).
 * Entry point is ../practice-modes-ui-full-audit.js, which requires this file.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { probe } = require('./practice-modes-ui-probe');

// -- media probe -------------------------------------------------------------
// Reproduces bug 754: a Play control whose handler early-returns produces no
// playback and no error. Clicks each play-ish control and asks the page whether
// any media element actually started.
async function mediaProbe(page, rootSel) {
  const candidates = await page.evaluate((sel) => {
    const root = document.querySelector(sel);
    if (!root) return [];
    // Matched against id + class + aria-label always, and against the visible
    // label only when it is short. Free prose matched "hear" inside "heart" on
    // an HCS answer card, which is not a media control.
    const re = /\bplay\b|\blisten\b|\baudio\b|\bspeaker\b|\bhear\b|\breplay\b|▶|🔊/i;
    const rendered = (el) => {
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const out = [];
    root.querySelectorAll('button, [role="button"]').forEach((el, i) => {
      if (!rendered(el)) return;
      const text = (el.textContent || '').trim();
      const label = (el.id || '') + ' ' + (typeof el.className === 'string' ? el.className : '')
        + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('title') || '')
        + (text.length <= 30 ? ' ' + text : '');
      if (!re.test(label)) return;
      if (!el.id) el.setAttribute('data-ui-audit-probe', 'p' + i);
      out.push({
        selector: el.id ? '#' + CSS.escape(el.id) : '[data-ui-audit-probe="p' + i + '"]',
        text: (el.textContent || '').trim().slice(0, 40),
        ariaLabel: el.getAttribute('aria-label') || '',
        disabled: !!el.disabled
      });
    });
    return out.slice(0, 4);
  }, rootSel);

  const results = [];
  for (const c of candidates) {
    await page.evaluate(() => {
      if (window.__audioReset) window.__audioReset();
      if (window.__mutReset) window.__mutReset();
    });
    const before = await page.evaluate(() => Array.from(document.querySelectorAll('audio,video')).map((m) => ({ paused: m.paused, t: m.currentTime })));
    let clickError = null;
    try {
      await page.locator(c.selector).first().click({ timeout: 4000 });
    } catch (err) {
      clickError = String(err).split('\n')[0].slice(0, 160);
    }
    await page.waitForTimeout(1400);
    const after = await page.evaluate(() => ({
      log: window.__audioLog ? window.__audioLog() : [],
      mutations: window.__mutCount ? window.__mutCount() : -1,
      media: Array.from(document.querySelectorAll('audio,video')).map((m) => ({ paused: m.paused, t: m.currentTime, readyState: m.readyState, currentSrc: m.currentSrc || '' }))
    }));
    const spoke = after.log.some((e) => e.phase === 'speech');
    const playCalled = after.log.some((e) => e.phase === 'play-called');
    const playFired = after.log.some((e) => e.phase === 'play-event');
    const mediaError = after.log.filter((e) => e.phase === 'media-error').map((e) => e.src).slice(0, 2);
    const advanced = after.media.some((m, i) => {
      const b = before[i];
      return m.t > 0.02 && (!b || m.t > b.t + 0.005);
    });
    results.push({
      control: c.selector,
      text: c.text || c.ariaLabel,
      disabledAtProbe: c.disabled,
      clickError,
      playCalled,
      playFired,
      timeAdvanced: advanced,
      mediaError,
      spoke,
      mutations: after.mutations,
      started: playFired || advanced || spoke,
      // The 754 signature: the click landed and the page did not react in any
      // observable way - no playback, no speech, no DOM mutation, no error.
      // Mutations alone clear a control: many Play buttons start a countdown
      // first and only reach the audio several seconds later.
      inertPlay: !clickError && !c.disabled && !playCalled && !playFired
        && !advanced && !spoke && after.mutations === 0
    });
    await page.evaluate(() => {
      document.querySelectorAll('audio,video').forEach((m) => {
        try { m.pause(); m.currentTime = 0; } catch (e) { /* ignore */ }
      });
    });
  }
  return results;
}

// -- per-surface run ---------------------------------------------------------
async function auditSurface(cfg, browser, server, surface, viewportName) {
  const viewport = cfg.VIEWPORTS[viewportName];
  const ctx = await browser.newContext({ viewport });
  await ctx.addInitScript(cfg.initScript);
  const page = await ctx.newPage();

  const consoleErrors = [];
  const failedRequests = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 220)); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + String(e).slice(0, 220)));
  page.on('requestfailed', (r) => failedRequests.push(r.url().slice(0, 150) + ' :: ' + (r.failure() ? r.failure().errorText : '')));
  page.on('response', (r) => { if (r.status() >= 400) failedRequests.push(r.status() + ' ' + r.url().slice(0, 150)); });

  const out = { surface: surface.id, viewport: viewportName };
  try {
    await page.goto(server.url, { waitUntil: 'domcontentloaded' });
    await cfg.dismissOverlays(page);

    if (surface.kind === 'panel') {
      await page.evaluate(async (id) => { await window.switchToMode(id); }, surface.id);
      await page.waitForFunction((id) => {
        const p = document.getElementById('mode-' + id);
        return p && getComputedStyle(p).display !== 'none';
      }, surface.id, { timeout: 20000 }).catch(() => { out.neverBecameVisible = true; });
    } else {
      await surface.open(page);
    }
    await page.waitForTimeout(1800);

    out.probe = await page.evaluate(probe, { rootSel: surface.root, isMobile: viewportName === 'mobile' });

    if (cfg.ARGS.shots) {
      const file = path.join(cfg.ARGS.outDir, surface.id + '-' + viewportName + '.png');
      await page.screenshot({ path: file, fullPage: false }).catch(() => { });
      out.screenshot = path.basename(file);
    }

    // Media probe only on desktop; geometry differs by viewport, handlers do not.
    if (viewportName === 'desktop') {
      out.media = await mediaProbe(page, surface.root);
    }

    out.consoleErrors = Array.from(new Set(consoleErrors)).slice(0, 10);
    out.failedRequests = Array.from(new Set(failedRequests)).slice(0, 10);
  } catch (err) {
    out.error = String(err).split('\n')[0].slice(0, 300);
  } finally {
    await ctx.close();
  }
  return out;
}

async function run(cfg) {
  const server = await new Promise((resolve) => {
    const s = cfg.app.listen(0, '127.0.0.1', () => resolve({ s, url: 'http://127.0.0.1:' + s.address().port + '/index.html' }));
  });

  let surfaces = cfg.PANEL_MODES.map((id) => ({ id, kind: 'panel', root: '#mode-' + id }))
    .concat(cfg.OVERLAY_SURFACES.map((o) => Object.assign({ kind: 'overlay' }, o)));
  if (cfg.ARGS.modes) surfaces = surfaces.filter((s) => cfg.ARGS.modes.includes(s.id));

  const browser = await chromium.launch({
    headless: !cfg.ARGS.headed,
    args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio']
  });

  const report = {
    generatedAt: new Date().toISOString(),
    task: 756,
    surfaces: surfaces.map((s) => s.id),
    viewports: cfg.ARGS.viewports,
    results: []
  };

  try {
    for (const viewportName of cfg.ARGS.viewports) {
      for (const surface of surfaces) {
        process.stdout.write('--- ' + viewportName + ' ' + surface.id + ' ... ');
        const r = await auditSurface(cfg, browser, server, surface, viewportName);
        const p = r.probe || {};
        const bits = [];
        if (r.error) bits.push('ERROR');
        if (p.missing) bits.push('ROOT MISSING');
        if ((p.overflow || []).length) bits.push(p.overflow.length + ' overflow');
        if (p.pageScroll && p.pageScroll.overflowsBy > 0) bits.push('page +' + p.pageScroll.overflowsBy + 'px');
        if ((p.contrast || []).length) bits.push(p.contrast.length + ' contrast');
        if ((p.inertControls || []).length) bits.push(p.inertControls.length + ' inert');
        if ((p.coveredControls || []).length) bits.push(p.coveredControls.length + ' covered');
        if ((p.smallTargets || []).length) bits.push(p.smallTargets.length + ' small');
        if ((r.media || []).some((m) => m.inertPlay)) bits.push('INERT PLAY');
        if ((r.consoleErrors || []).length) bits.push(r.consoleErrors.length + ' console');
        console.log(bits.length ? bits.join(', ') : 'clean');
        report.results.push(r);
      }
    }
  } finally {
    await browser.close();
    server.s.close();
  }

  const file = path.join(cfg.ARGS.outDir, 'report.json');
  fs.writeFileSync(file, JSON.stringify(report, null, 2));
  console.log('\nWrote ' + file);
  return file;
}

module.exports = { run, mediaProbe, auditSurface };
