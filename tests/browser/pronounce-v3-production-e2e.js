/**
 * End-to-end production verification for the V3 cold-start fix.
 *
 * Drives a real Chrome against production with a fake microphone fed from the
 * recorded `photograph` sample, signs in as admin, records, and asserts the
 * admin comparison reports V3 as AVAILABLE rather than the
 * "model inference failed" state this whole change set exists to fix.
 *
 * Chrome is the mandatory browser for this project's test plans, and the
 * credentials come from .local/browser-test-credentials.md.
 *
 * Usage:
 *   node tests/browser/pronounce-v3-production-e2e.js
 *   PRONOUNCE_VERIFY_BASE=https://localhost:8443 node tests/browser/pronounce-v3-production-e2e.js
 */
/* eslint-disable no-console */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { readBrowserTestCredentials } = require('./helpers/browser-test-credentials');

const BASE = process.env.PRONOUNCE_VERIFY_BASE || 'https://betterenglishlearning.com';
const WAV = path.resolve(__dirname, '../../test-results/pronounce-local-samples/photograph-20260803011926909-65561e59.wav');
const CRED_PATH = path.resolve(__dirname, '../../.local/browser-test-credentials.md');
const TARGET_WORD = 'photograph';

/**
 * The login form lives behind an entry modal / account panel, so #login-email
 * exists in the DOM but is not interactable until one of those is opened. This
 * mirrors the sequence already proven in practice-attempts-history-browser-check.
 */
async function signIn(page, email, password) {
  const entryModal = page.locator('#entry-modal');
  if (await entryModal.isVisible().catch(() => false)) {
    const loginChoice = page.locator('#login-choice-btn');
    if (await loginChoice.isVisible().catch(() => false)) await loginChoice.click();
  }
  await page.waitForTimeout(1000);

  const authOverlay = page.locator('#auth-overlay');
  const authVisible = await authOverlay
    .evaluate((el) => getComputedStyle(el).display !== 'none')
    .catch(() => false);
  if (!authVisible) {
    const toggle = page.locator('#account-panel-toggle');
    if (await toggle.isVisible().catch(() => false)) {
      await toggle.click();
      await page.waitForTimeout(500);
    }
    for (const id of ['#panel-login-btn', '#panel-guest-login-btn']) {
      const btn = page.locator(id);
      if (await btn.isVisible().catch(() => false)) { await btn.click(); break; }
    }
  }

  await page.waitForSelector('#login-email', { state: 'visible', timeout: 60000 });
  await page.fill('#login-email', email);
  await page.fill('#login-password', password);
  await page.click('#login-form-element button[type="submit"]');

  await page.waitForFunction(() => {
    const wrapper = document.getElementById('page-layout-wrapper');
    const authOvl = document.getElementById('auth-overlay');
    return wrapper && getComputedStyle(wrapper).display !== 'none'
      && (!authOvl || getComputedStyle(authOvl).display === 'none');
  }, { timeout: 60000 });
}

(async () => {
  assert.ok(fs.existsSync(WAV), `Missing verification sample: ${WAV}`);
  const { email, password } = readBrowserTestCredentials(CRED_PATH);

  console.log('--- Pronounce V3 production E2E ---');
  console.log(`    base: ${BASE}`);

  // A fake device fed from the recorded WAV is the only way to exercise the
  // real record -> analyse path headlessly. Without it MediaRecorder produces
  // silence and the analysis is unrateable for reasons unrelated to this fix.
  const browser = await chromium.launch({
    headless: true,
    channel: 'chrome',
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${WAV}`,
      '--autoplay-policy=no-user-gesture-required'
    ]
  });

  const context = await browser.newContext({
    permissions: ['microphone'],
    ignoreHTTPSErrors: true
  });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  // Capture the comparison response directly: the DOM tells us what the learner
  // sees, the payload tells us why.
  const comparisons = [];
  const warmCalls = [];
  page.on('response', async (res) => {
    const url = res.url();
    if (url.includes('/analyze/compare')) {
      try { comparisons.push({ status: res.status(), body: await res.json() }); }
      catch { comparisons.push({ status: res.status(), body: null }); }
    }
    if (url.includes('/warm/v3')) warmCalls.push(res.status());
  });

  try {
    console.log('[1] Signing in...');
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForTimeout(5000);
    await signIn(page, email, password);
    console.log('    signed in');

    console.log('[2] Opening Pronounce mode...');
    await page.goto(`${BASE}/practice/speaking/pronounce`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForTimeout(6000);

    console.log('[3] Looking up the target word...');
    const input = page.locator('#pa-word-input');
    await input.waitFor({ state: 'visible', timeout: 60000 });
    await input.fill(TARGET_WORD);
    await input.press('Enter');
    await page.waitForTimeout(8000);

    const referenceVisible = await page.locator('text=/fo\\u028at\\u0259|photograph/i').first().isVisible().catch(() => false);
    console.log(`    reference rendered: ${referenceVisible}`);

    // The first-run tutorial overlay intercepts pointer events on the record
    // button. Skip it the way the app intends, then hard-hide any remnant.
    const skip = page.locator('#tutorial-skip');
    if (await skip.isVisible().catch(() => false)) {
      await skip.click().catch(() => {});
      await page.waitForTimeout(1000);
    }
    await page.addStyleTag({
      content: '#tutorial-overlay,#tutorial-backdrop,.tutorial-overlay,.tutorial-backdrop{display:none !important;pointer-events:none !important;}'
    }).catch(() => {});

    console.log('[4] Recording with the fake microphone...');
    const recordBtn = page.locator('#pa-record-btn');
    const stopBtn = page.locator('#pa-stop-btn');
    await recordBtn.waitFor({ state: 'visible', timeout: 60000 });
    await recordBtn.click();
    await page.waitForTimeout(3500);          // sample is ~2.4s
    // Pronounce has a dedicated stop control; clicking record again does not stop it.
    if (await stopBtn.isVisible().catch(() => false)) { await stopBtn.click(); }
    else { await recordBtn.click(); }

    console.log('[5] Waiting for analysis (cold path may take ~45s)...');
    await page.waitForTimeout(90000);

    // ---- assertions ---------------------------------------------------------
    console.log('\n--- Results ---');
    console.log(`    /warm/v3 calls observed : ${warmCalls.length}` +
      (warmCalls.length ? ` (status ${warmCalls.join(',')})` : ' — expected 0 until hosting is redeployed'));
    console.log(`    /analyze/compare calls  : ${comparisons.length}`);

    assert.ok(comparisons.length > 0, 'No /analyze/compare request was made — the record flow did not reach analysis');

    const last = comparisons[comparisons.length - 1];
    assert.strictEqual(last.status, 200, `Comparison HTTP ${last.status}`);
    assert.ok(last.body, 'Comparison returned no JSON body');

    const v2 = last.body.v2 || {};
    const v3 = last.body.v3 || {};
    console.log(`    comparison status       : ${last.body.status}`);
    console.log(`    V2                      : ${v2.status}${v2.reason ? ' (' + v2.reason + ')' : ''}`);
    console.log(`    V3                      : ${v3.status}${v3.reason ? ' (' + v3.reason + ')' : ''}`);

    const analysis = v3.analysis || {};
    console.log(`    V3 syllables            : ${analysis.syllable_count}`);
    console.log(`    V3 segmentation source  : ${analysis.segmentation_source}`);

    assert.strictEqual(v2.status, 'available', 'V2 must be available');
    assert.strictEqual(v3.status, 'available',
      `V3 unavailable (${v3.reason}) — this is the regression this release fixes`);
    assert.notStrictEqual(v3.reason, 'MODEL_INFERENCE_FAILED', 'V3 reported the original failure');
    assert.strictEqual(analysis.segmentation_source, 'ctc',
      `V3 fell back to ${analysis.segmentation_source} instead of the recognizer`);

    const fatal = consoleErrors.filter((e) => /SyntaxError|is not defined|Failed to load module/i.test(e));
    assert.strictEqual(fatal.length, 0, `Fatal console errors: ${fatal.join(' | ')}`);

    console.log('\n--- Pronounce V3 production E2E PASSED ---');
  } finally {
    await browser.close();
  }
})().catch((err) => {
  console.error('\n--- Pronounce V3 production E2E FAILED ---');
  console.error(err.message);
  process.exit(1);
});
