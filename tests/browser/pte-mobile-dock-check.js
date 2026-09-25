'use strict';

// Action dock, chat button and microphone errors across the seven speaking modes and five
// viewports, including the 601-767px band where the phone toolbar shows but the old per-mode
// dock offsets did not apply.
//
// For every reachable phase it checks, at the scroll position a learner would see:
// - each visible dock button is hit-testable at its centre (not under the toolbar or chat)
// - exactly one primary action in the dock
// - no sideways page scroll
// - the chat launcher is the compact round button, clear of the dock
// and, per mode, that a blocked microphone produces a visible explanation and returns to prep.
//
// Run: node tests/browser/pte-mobile-dock-check.js [mode] [--shots=<dir>]

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHarness, initScript, dismissOverlays } = require('./helpers/pte-shell-harness');

const MODES = ['read-aloud', 'speak', 'describe-image', 'notes', 'asq', 'sgd', 'rts'];
const VIEWPORTS = [
  { width: 390, height: 844, name: 'phone' },
  { width: 700, height: 900, name: 'toolbar-band' },
  { width: 768, height: 1024, name: 'tablet' },
  { width: 1024, height: 768, name: 'laptop-short' },
  { width: 1440, height: 900, name: 'desktop' }
];
const shotsArg = process.argv.find(arg => arg.startsWith('--shots='));
const SHOTS = shotsArg ? shotsArg.slice('--shots='.length) : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const onlyMode = process.argv.slice(2).find(arg => MODES.includes(arg));

function wav(seconds = 1, sampleRate = 8000) {
  const samples = Math.round(seconds * sampleRate);
  const b = Buffer.alloc(44 + samples * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + samples * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sampleRate, 24); b.writeUInt32LE(sampleRate * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(samples * 2, 40);
  return b;
}
const CLIP = wav(1);
// A 4:3 picture for Describe Image, so the stage is measured with a real image.
const PICTURE = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900"><rect width="1200" height="900" fill="#dbeafe"/><circle cx="600" cy="450" r="260" fill="#60a5fa"/></svg>';

async function openApp(harness, viewport) {
  const page = await harness.browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  await page.addInitScript(initScript);
  await page.addInitScript(() => { window.__PTE_TEST_TIME_SCALE = 0.1; });
  await page.route('**/*', route => {
    const url = route.request().url();
    if (url.includes('/media-release.json')) return route.fulfill({ json: { defaultRolloutState: 'legacy', modes: {} } });
    if (/\.(mp3|wav|m4a)(\?|$)/i.test(url)) return route.fulfill({ contentType: 'audio/wav', body: CLIP });
    if (/\/database\/.*\.(png|jpe?g|webp)(\?|$)/i.test(url)) return route.fulfill({ contentType: 'image/svg+xml', body: PICTURE });
    // Quotes answer "feature disabled" so scoring falls back without the credit dialog.
    if (url.includes('/api/ai-scoring/quotes')) return route.fulfill({ status: 503, json: { error: 'disabled' } });
    if (url.includes('/api/')) return route.fulfill({ json: {} });
    return route.fallback();
  });
  await page.goto(`${harness.baseURL}/?pteShell=v3`, { waitUntil: 'domcontentloaded' });
  await dismissOverlays(page);
  return { page, errors };
}

async function enterMode(page, mode) {
  await page.evaluate(m => window.switchToMode(m), mode);
  await page.waitForFunction(m => {
    const panel = document.getElementById(`mode-${m}`);
    const card = panel?.querySelector('.pte-card');
    return card && card.dataset.ptePhase && card.dataset.ptePhase !== 'loading';
  }, mode, { timeout: 30000 });
}

const phaseOf = (page, mode) => page.evaluate(m => document.querySelector(`#mode-${m} .pte-card`)?.dataset.ptePhase, mode);

async function waitPhase(page, mode, phases, timeout = 15000) {
  await page.waitForFunction(({ m, list }) => list.includes(document.querySelector(`#mode-${m} .pte-card`)?.dataset.ptePhase), { m: mode, list: phases }, { timeout });
  return phaseOf(page, mode);
}

// Hit-test every visible dock button, first where the page is scrolled to the top and then
// with the end of the card in view (where a pinned dock and the page furniture meet).
async function auditDock(page, mode) {
  return page.evaluate(async m => {
    const card = document.querySelector(`#mode-${m} .pte-card`);
    const dock = card.querySelector('.pte-dock');
    const shown = el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
    const describe = el => el ? `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''}` : 'nothing';
    const covered = [];
    const check = where => {
      for (const button of [...dock.querySelectorAll('button')].filter(shown)) {
        const r = button.getBoundingClientRect();
        const x = r.left + r.width / 2, y = r.top + r.height / 2;
        if (y < 0 || y > innerHeight || x < 0 || x > innerWidth) continue;
        const hit = document.elementFromPoint(x, y);
        if (hit !== button && !button.contains(hit)) covered.push(`${where}: "${button.textContent.trim()}" is under ${describe(hit)}`);
      }
    };
    window.scrollTo(0, 0); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    check('top');
    const cardRect = card.getBoundingClientRect();
    window.scrollTo(0, Math.max(0, scrollY + cardRect.bottom - innerHeight + 24));
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    check('card end');
    const trigger = document.getElementById('bel-chat-trigger');
    const tr = trigger && shown(trigger) ? trigger.getBoundingClientRect() : null;
    return {
      covered,
      primaries: [...dock.querySelectorAll('.pte-btn--primary')].filter(shown).map(b => b.textContent.trim()),
      hScroll: document.documentElement.scrollWidth - innerWidth,
      chat: tr ? { w: Math.round(tr.width), h: Math.round(tr.height) } : null,
      statLabelMin: Math.min(...[...card.querySelectorAll('.pte-stats small')].filter(shown).map(s => parseFloat(getComputedStyle(s).fontSize)), 99)
    };
  }, mode);
}

async function clickDock(page, mode, label) {
  const button = page.locator(`#mode-${mode} .pte-dock button:visible`, { hasText: label }).first();
  if (!(await button.count())) return false;
  await button.click({ timeout: 5000 });
  return true;
}

async function checkPhase(page, mode, vp, failures, label) {
  const phase = await phaseOf(page, mode);
  const audit = await auditDock(page, mode);
  const where = `${mode}@${vp.name} ${phase}${label ? ` (${label})` : ''}`;
  if (audit.covered.length) failures.push(`${where}: ${audit.covered.join('; ')}`);
  if (audit.primaries.length !== 1 && phase !== 'recording' && phase !== 'listen') failures.push(`${where}: expected one primary action, found ${audit.primaries.length} (${audit.primaries.join(', ')})`);
  if (audit.hScroll > 1) failures.push(`${where}: page scrolls sideways by ${audit.hScroll}px`);
  if (audit.chat && (audit.chat.w > 56 || audit.chat.h > 56)) failures.push(`${where}: chat launcher is ${audit.chat.w}x${audit.chat.h}, expected the compact button`);
  if (audit.statLabelMin < 11) failures.push(`${where}: score labels are ${audit.statLabelMin}px`);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${mode}-${vp.name}-${phase}${label ? '-' + label : ''}.png`) });
  // The listen-back pill (with SGD's "Your recording | Discussion" switch) must fit its column.
  const pill = page.locator('#pte-listen-back');
  if (phase === 'feedback' && !label && await pill.count()) {
    const fit = await pill.evaluate(node => ({ over: node.scrollWidth - node.clientWidth, right: node.getBoundingClientRect().right, card: node.closest('.pte-card').getBoundingClientRect().right }));
    if (fit.over > 1 || fit.right > fit.card + 1) failures.push(`${where}: listen-back pill overflows (${fit.over}px inside, ${Math.round(fit.right - fit.card)}px past the card)`);
    if (SHOTS) { await pill.scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(SHOTS, `${mode}-${vp.name}-feedback-listen.png`) }); }
  }
  return phase;
}

// Walk a mode through listen/prep -> recording -> complete -> feedback, auditing each phase.
async function walkMode(page, mode, vp, failures) {
  await enterMode(page, mode);
  let phase = await waitPhase(page, mode, ['listen', 'prep'], 20000);
  await checkPhase(page, mode, vp, failures);
  if (phase === 'listen') {
    phase = await waitPhase(page, mode, ['prep', 'recording'], 20000).catch(() => 'listen');
    if (phase === 'prep') await checkPhase(page, mode, vp, failures);
  }
  if (phase === 'prep') {
    await clickDock(page, mode, 'Start recording').catch(() => {});
    phase = await waitPhase(page, mode, ['recording', 'complete'], 15000).catch(() => phase);
  }
  if (phase === 'recording') {
    await checkPhase(page, mode, vp, failures);
    await clickDock(page, mode, 'Finish recording').catch(() => {});
    phase = await waitPhase(page, mode, ['complete', 'feedback'], 20000).catch(() => phase);
  }
  if (phase === 'complete') {
    await checkPhase(page, mode, vp, failures);
    await clickDock(page, mode, 'Get feedback').catch(() => {});
    phase = await waitPhase(page, mode, ['feedback'], 20000).catch(() => phase);
  }
  if (phase === 'feedback') await checkPhase(page, mode, vp, failures);
  return phase;
}

// A blocked microphone must be explained on screen and leave Start recording as the retry.
async function micBlocked(page, mode, vp, failures) {
  await enterMode(page, mode);
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Permission denied', 'NotAllowedError'); };
  });
  let phase = await waitPhase(page, mode, ['prep'], 30000).catch(() => null);
  if (!phase) { failures.push(`${mode}@${vp.name}: never reached prep for the microphone check`); return; }
  await clickDock(page, mode, 'Start recording').catch(() => {});
  const where = `${mode}@${vp.name} microphone blocked`;
  try {
    await page.waitForFunction(m => {
      const panel = document.getElementById(`mode-${m}`);
      const rec = panel?.querySelector('.pte-rec[data-state="error"]');
      return rec && rec.getClientRects().length > 0 && /Microphone blocked/.test(rec.textContent);
    }, mode, { timeout: 15000 });
  } catch (_) {
    failures.push(`${where}: no visible "Microphone blocked" explanation in the recorder`);
    return;
  }
  const state = await page.evaluate(m => {
    const card = document.querySelector(`#mode-${m} .pte-card`);
    const visible = [...card.querySelectorAll('.pte-dock button')].filter(b => b.getClientRects().length > 0).map(b => b.textContent.trim());
    return { phase: card.dataset.ptePhase, status: card.querySelector('.pte-dock__status')?.textContent || '', visible };
  }, mode);
  const retryReady = mode === 'notes' ? state.visible.some(t => /Record again|Start recording/.test(t)) : state.visible.includes('Start recording');
  if (!retryReady) failures.push(`${where}: no way to try again (dock shows ${state.visible.join(', ')})`);
  if (!/Microphone blocked/.test(state.status)) failures.push(`${where}: dock status does not explain it ("${state.status}")`);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${mode}-${vp.name}-mic-blocked.png`) });
}

async function run() {
  const harness = await createHarness();
  const failures = [];
  const reached = {};
  try {
    for (const vp of VIEWPORTS) {
      for (const mode of MODES) {
        if (onlyMode && mode !== onlyMode) continue;
        const { page, errors } = await openApp(harness, vp);
        try {
          reached[`${mode}@${vp.name}`] = await walkMode(page, mode, vp, failures);
        } catch (error) {
          failures.push(`${mode}@${vp.name}: ${error.message.split('\n')[0]}`);
        }
        const relevant = errors.filter(message => !/ResizeObserver loop|Failed to load resource/.test(message));
        if (relevant.length) failures.push(`${mode}@${vp.name}: page errors: ${relevant.slice(0, 3).join(' | ')}`);
        await page.close();
      }
    }
    for (const vp of [VIEWPORTS[0], VIEWPORTS[4]]) {
      for (const mode of MODES) {
        if (onlyMode && mode !== onlyMode) continue;
        const { page } = await openApp(harness, vp);
        try { await micBlocked(page, mode, vp, failures); } catch (error) { failures.push(`${mode}@${vp.name} microphone: ${error.message.split('\n')[0]}`); }
        await page.close();
      }
    }
  } finally {
    await harness.close();
  }
  console.log('Furthest phase reached:');
  for (const [key, phase] of Object.entries(reached)) console.log(`  ${key.padEnd(34)} ${phase}`);
  if (failures.length) {
    console.log(`\n${failures.length} problem(s):`);
    failures.forEach(f => console.log(`  - ${f}`));
    process.exit(1);
  }
  console.log('\nAll dock, chat-button and microphone checks passed.');
}

run().catch(error => { console.error(error); process.exit(1); });
