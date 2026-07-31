/**
 * Post-deploy production verification for the pronunciation segmentation
 * convention change and the admin bootstrap hardening.
 *
 * Checks only what can be verified without credentials:
 *   1. Hosting is serving the new pronunciation-analyzer sources.
 *   2. The admin API is live and fails closed for unauthenticated callers.
 *   3. Pronounce mode boots on production without console errors.
 *
 * Admin-authenticated behaviour (isAdmin true for the owner, manual-review
 * controls visible) still needs a signed-in smoke check; see
 * .local/browser-test-credentials.md.
 *
 * Usage: node tests/browser/pronounce-production-verify.js
 */
/* eslint-disable no-console */
const assert = require('assert');
const { chromium } = require('playwright');

// The custom domain is the real production origin. The listening-tasks-3ae34
// .web.app alias serves the same hosting content but is deliberately absent
// from the Praat backend's CORS allowlist (see cors_origins in
// backend/local_server/server.py), so reference lookups fail there by design.
// Verifying against the alias reports a broken Pronounce mode that is not real.
const BASE = process.env.PRONOUNCE_VERIFY_BASE || 'https://betterenglishlearning.com';
const PRAAT_API = 'https://praat-api-1071929245506.us-central1.run.app';

// The TLS handshake to the custom domain measures ~12s from Node, over the 10s
// default connect timeout, so plain fetch() reports a production outage that is
// not real (curl and the browser both succeed). Raise the connect budget.
try {
  const { Agent, setGlobalDispatcher } = require('undici');
  setGlobalDispatcher(new Agent({ connect: { timeout: 45000 } }));
} catch {
  console.warn('undici not available; using default connect timeout');
}

// Retry with a browser UA rather than reporting a production failure that is
// not one.
async function request(url, init = {}) {
  const options = {
    cache: 'no-store',
    ...init,
    headers: { 'User-Agent': 'Mozilla/5.0 (pronounce-production-verify)', ...(init.headers || {}) }
  };
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await fetch(url, options);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
    }
  }
  throw new Error(`${url} unreachable after 3 attempts: ${lastError?.cause?.message || lastError?.message}`);
}

async function fetchText(url) {
  const response = await request(url);
  assert.equal(response.status, 200, `${url} returned ${response.status}`);
  return response.text();
}

(async () => {
  console.log('--- Pronounce production verification ---');

  console.log('[1] Checking deployed pronunciation-analyzer sources...');
  const appSrc = await fetchText(`${BASE}/pronunciation-analyzer/app.js`);
  assert.ok(
    appSrc.includes('getSyllableIpaSegments'),
    'app.js on production is missing getSyllableIpaSegments()'
  );
  assert.ok(
    appSrc.includes("segmentationConvention: 'ipa-phonological'"),
    'app.js on production is not tagging saved samples with the IPA convention'
  );
  console.log('    app.js: IPA segmentation convention present');

  const verifierSrc = await fetchText(`${BASE}/pronunciation-analyzer/syllable-verifier.js`);
  assert.ok(
    verifierSrc.includes('Use IPA boundaries, not spelling.'),
    'syllable-verifier.js on production is missing the IPA annotation instruction'
  );
  console.log('    syllable-verifier.js: IPA annotation instruction present');

  console.log('[2] Checking admin API fails closed without a token...');
  const adminResponse = await request(`${BASE}/api/admin/status`);
  assert.ok(
    adminResponse.status === 401 || adminResponse.status === 403,
    `unauthenticated /api/admin/status should be 401/403, got ${adminResponse.status}`
  );
  console.log(`    /api/admin/status -> ${adminResponse.status} (fails closed)`);

  const corpusResponse = await request(`${BASE}/api/admin/dev/save-corpus-sample`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  });
  assert.ok(
    corpusResponse.status === 401 || corpusResponse.status === 403,
    `unauthenticated corpus save should be 401/403, got ${corpusResponse.status}`
  );
  console.log(`    /api/admin/dev/save-corpus-sample -> ${corpusResponse.status} (fails closed)`);

  console.log('[3] Checking the Praat backend allows the production origin...');
  const corsResponse = await request(`${PRAAT_API}/dictionary/v2/industrial`, {
    headers: { Origin: BASE }
  });
  assert.equal(corsResponse.status, 200, `praat dictionary lookup returned ${corsResponse.status}`);
  const allowOrigin = corsResponse.headers.get('access-control-allow-origin');
  assert.equal(
    allowOrigin,
    BASE,
    `praat backend must allow ${BASE}; got ${allowOrigin || '(no header)'}. `
    + 'Without this the browser blocks every word-reference lookup.'
  );
  console.log(`    ${PRAAT_API} allows ${allowOrigin}`);

  console.log('[4] Booting Pronounce mode on production...');
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addInitScript(() => {
      window.localStorage.setItem('userStatus', 'guest');
      window.sessionStorage.setItem('bel:onboarding:welcome:dismissed', 'true');
    });
    const page = await context.newPage();
    const consoleErrors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => consoleErrors.push(String(error)));

    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);

    const version = await page.evaluate(() => {
      const el = document.getElementById('version-indicator');
      return el ? el.textContent.trim() : 'NOT FOUND';
    });
    console.log(`    version indicator: ${version}`);

    // Module errors are what would break the changed files; ignore unrelated
    // network noise from third-party assets.
    const relevant = consoleErrors.filter((text) => (
      /pronunciation-analyzer|syllable-verifier|SyntaxError|is not defined|Unexpected/i.test(text)
    ));
    assert.deepEqual(relevant, [], `Console errors on production: ${relevant.join(' | ')}`);
    console.log('    no module/syntax console errors');
  } finally {
    await browser.close();
  }

  console.log('--- Pronounce production verification PASSED ---');
})().catch((error) => {
  console.error('--- Pronounce production verification FAILED ---');
  console.error(error.message || error);
  process.exit(1);
});
