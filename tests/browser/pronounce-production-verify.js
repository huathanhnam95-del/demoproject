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
const assert = require('assert');
const { chromium } = require('playwright');

const BASE = 'https://listening-tasks-3ae34.web.app';

async function fetchText(url) {
  const response = await fetch(url, { cache: 'no-store' });
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
  const adminResponse = await fetch(`${BASE}/api/admin/status`, { cache: 'no-store' });
  assert.ok(
    adminResponse.status === 401 || adminResponse.status === 403,
    `unauthenticated /api/admin/status should be 401/403, got ${adminResponse.status}`
  );
  console.log(`    /api/admin/status -> ${adminResponse.status} (fails closed)`);

  const corpusResponse = await fetch(`${BASE}/api/admin/dev/save-corpus-sample`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
    cache: 'no-store'
  });
  assert.ok(
    corpusResponse.status === 401 || corpusResponse.status === 403,
    `unauthenticated corpus save should be 401/403, got ${corpusResponse.status}`
  );
  console.log(`    /api/admin/dev/save-corpus-sample -> ${corpusResponse.status} (fails closed)`);

  console.log('[3] Booting Pronounce mode on production...');
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
