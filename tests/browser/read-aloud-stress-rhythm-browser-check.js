/**
 * Read Aloud — Rhythm & Stress (Metric Prominence Typography) Browser Verification
 *
 * Verifies:
 * 1. #ra-toggle-stress-btn chip exists in Advanced view.
 * 2. Toggling ON adds .ra-stress-peak elements inside .ra-prompt-word elements.
 * 3. Primary stressed syllables have bold font-weight (700).
 * 4. Legend swatch and explanation for stress peak are shown when ON and hidden when OFF.
 * 5. Instruction text reflects stress peaks.
 * 6. Session storage persistence (bel_ra_stress_enabled) works.
 * 7. Simultaneous chunking and stress formatting render cleanly without DOM collisions.
 */
const { chromium } = require('playwright');
const express = require('express');
const path = require('path');
const fs = require('fs');

const OUT_DIR = path.join(__dirname, 'artifacts', 'read-aloud-workbench');

function ok(label, pass, detail) {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  return pass;
}

async function enterReadAloudAdvanced(page, baseUrl) {
  await page.addInitScript(() => {
    window.localStorage.setItem('userStatus', 'guest');
    window.localStorage.setItem('hasSeenScopeTutorial', 'true');
    window.localStorage.setItem('bel:speaking-controller:view:v1', 'advanced');
  });
  await page.goto(`${baseUrl}/index.html?raWorkspace=legacy`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.switchToMode === 'function', { timeout: 30000 });
  const guest = page.locator('#guest-mode-btn');
  if (await guest.isVisible().catch(() => false)) await guest.click();
  await page.waitForTimeout(800);
  await page.evaluate(() => window.switchToMode('read-aloud'));
  await page.waitForFunction(() => {
    const panel = document.getElementById('mode-read-aloud');
    return !!panel && getComputedStyle(panel).display !== 'none'
      && !!panel.querySelector('.spc-controller');
  }, null, { timeout: 20000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    document.querySelectorAll('#entry-modal, .entry-modal, .auth-overlay, .guest-toast')
      .forEach((el) => { el.style.display = 'none'; });
  });
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const app = express();
  app.use(express.static(path.join(__dirname, '../../public')));
  app.use((req, res) => res.sendFile(path.join(__dirname, '../../public/index.html')));
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const browser = await chromium.launch({ headless: true });
  let failures = 0;
  const record = (label, pass, detail) => { if (!ok(label, pass, detail)) failures += 1; };

  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 940 } });
    await enterReadAloudAdvanced(page, baseUrl);

    // Verify stress toggle button is present
    const stressBtnExists = await page.evaluate(() => {
      const btn = document.getElementById('ra-toggle-stress-btn');
      return !!btn && btn.textContent.includes('Rhythm & Stress');
    });
    record('stress toggle button exists in DOM', stressBtnExists);

    // Initial state: stress is OFF
    const initialState = await page.evaluate(() => {
      const btn = document.getElementById('ra-toggle-stress-btn');
      const peaks = document.querySelectorAll('#ra-text-prompt .ra-stress-peak');
      const legendItem = document.querySelector('#ra-guide-legend [data-legend="stress"]');
      return {
        pressed: btn?.getAttribute('aria-pressed'),
        peakCount: peaks.length,
        legendHidden: legendItem?.hidden
      };
    });
    record('initial state: stress guide is OFF', initialState.pressed === 'false' && initialState.peakCount === 0 && initialState.legendHidden === true);

    // Click to toggle stress ON
    await page.click('#ra-toggle-stress-btn');
    await page.waitForTimeout(400);

    const onState = await page.evaluate(() => {
      const btn = document.getElementById('ra-toggle-stress-btn');
      const peaks = [...document.querySelectorAll('#ra-text-prompt .ra-stress-peak')];
      const legendItem = document.querySelector('#ra-guide-legend [data-legend="stress"]');
      const sessionVal = sessionStorage.getItem('bel_ra_stress_enabled');
      const instruction = document.getElementById('ra-guide-instruction')?.textContent;
      const firstPeakStyle = peaks.length > 0 ? getComputedStyle(peaks[0]).fontWeight : null;
      return {
        pressed: btn?.getAttribute('aria-pressed'),
        peakCount: peaks.length,
        peakTexts: peaks.slice(0, 5).map(p => p.textContent),
        legendHidden: legendItem?.hidden,
        sessionVal,
        instruction,
        firstPeakStyle
      };
    });

    record('toggled ON: aria-pressed is true', onState.pressed === 'true');
    record('toggled ON: renders .ra-stress-peak elements', onState.peakCount > 0, `found ${onState.peakCount} peaks (e.g. ${onState.peakTexts.join(', ')})`);
    record('toggled ON: .ra-stress-peak has bold font-weight (700)', onState.firstPeakStyle === '700' || onState.firstPeakStyle === 'bold', `weight=${onState.firstPeakStyle}`);
    record('toggled ON: legend item for stress is visible', onState.legendHidden === false);
    record('toggled ON: session storage persisted', onState.sessionVal === 'true');
    record('toggled ON: instruction mentions stress/rhythm', /stress|rhythm|emphasizing/i.test(onState.instruction || ''), `"${onState.instruction}"`);

    await page.screenshot({ path: path.join(OUT_DIR, 'read-aloud-stress-1440.png') });

    // Enable Chunking as well to verify simultaneous rendering
    await page.evaluate(() => {
      const mode = window.ReadAloudMode;
      const text = mode.currentPromptPlainText || 'This is a super easy task.';
      const words = text.split(/\s+/);
      const half = Math.floor(words.length / 2);
      const chunked = words.slice(0, half).join(' ') + ' / ' + words.slice(half).join(' ');
      mode.currentPromptChunkedText = chunked;
      mode.setPromptText(text, chunked);
      mode.updatePromptGuideButtons();
    });
    await page.click('#ra-toggle-chunking-btn');
    await page.waitForTimeout(400);

    const dualState = await page.evaluate(() => {
      const peaks = document.querySelectorAll('#ra-text-prompt .ra-stress-peak');
      const slashes = document.querySelectorAll('#ra-text-prompt .ra-chunk-marker');
      const words = document.querySelectorAll('#ra-text-prompt .ra-prompt-word');
      const promptText = document.getElementById('ra-text-prompt')?.textContent;
      return {
        peakCount: peaks.length,
        slashCount: slashes.length,
        wordCount: words.length,
        promptClean: !promptText.includes('<span')
      };
    });

    record('dual mode: stress and chunking work simultaneously', dualState.peakCount > 0 && dualState.slashCount > 0, `peaks=${dualState.peakCount}, slashes=${dualState.slashCount}`);
    record('dual mode: prompt textContent is clean without escaped tags', dualState.promptClean);

    // Toggle stress back OFF
    await page.click('#ra-toggle-stress-btn');
    await page.waitForTimeout(400);

    const offState = await page.evaluate(() => {
      const btn = document.getElementById('ra-toggle-stress-btn');
      const peaks = document.querySelectorAll('#ra-text-prompt .ra-stress-peak');
      const legendItem = document.querySelector('#ra-guide-legend [data-legend="stress"]');
      const sessionVal = sessionStorage.getItem('bel_ra_stress_enabled');
      return {
        pressed: btn?.getAttribute('aria-pressed'),
        peakCount: peaks.length,
        legendHidden: legendItem?.hidden,
        sessionVal
      };
    });

    record('toggled OFF: aria-pressed is false', offState.pressed === 'false');
    record('toggled OFF: .ra-stress-peak removed', offState.peakCount === 0);
    record('toggled OFF: legend item for stress is hidden', offState.legendHidden === true);
    record('toggled OFF: session storage updated', offState.sessionVal === 'false');

    await page.close();
  } catch (error) {
    console.error('FAIL  harness error —', error?.message || error);
    failures += 1;
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? '\nAll Rhythm & Stress browser checks passed.' : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
})();
