/* eslint-disable no-console */
'use strict';

const assert = require('assert');
const { chromium } = require('playwright');

async function runColdAuthCheck() {
  const baseUrl = process.argv[2] || process.env.BEL_TEST_URL || 'https://localhost:8443';
  const crmUrl = `${baseUrl.replace(/\/$/, '')}/crm-admin`;

  console.log(`[ColdAuthCheck] Launching Chrome to test cold start at ${crmUrl}...`);

  let browser;
  try {
    browser = await chromium.launch({
      channel: 'chrome',
      headless: true
    });
  } catch (launchErr) {
    console.warn('[ColdAuthCheck] Chrome channel unavailable, falling back to bundled chromium:', launchErr.message);
    browser = await chromium.launch({ headless: true });
  }

  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 900 }
  });

  const page = await context.newPage();

  const requests = [];
  const responses = new Map();
  const consoleErrors = [];
  const gateMessagesSeen = [];

  page.on('request', (req) => {
    requests.push(req.url());
  });

  page.on('response', (res) => {
    const url = res.url();
    responses.set(url, res.status());
  });

  page.on('pageerror', (err) => {
    consoleErrors.push(err.message || String(err));
  });

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      const locUrl = msg.location()?.url || '';
      // Ignore known non-fatal 404s for secondary projects feature routes mentioned in spec
      const isIgnored = text.includes('/api/projects/access')
        || text.includes('/api/projects/ai/config')
        || locUrl.includes('/api/projects/access')
        || locUrl.includes('/api/projects/ai/config')
        || locUrl.includes('favicon.ico')
        || (text.includes('404') && (text.includes('projects') || locUrl.includes('projects') || locUrl.includes('favicon')));
      if (!isIgnored) {
        consoleErrors.push({ text, url: locUrl });
      }
    }
  });

  // Track gate message text mutations
  await page.addInitScript(() => {
    window.__gateStates = [];
    const observer = new MutationObserver(() => {
      const text = document.getElementById('crm-loading-text')?.textContent?.trim();
      const subtext = document.getElementById('crm-loading-subtext')?.textContent?.trim();
      if (text) {
        window.__gateStates.push({ text, subtext, time: performance.now() });
      }
    });
    document.addEventListener('DOMContentLoaded', () => {
      const gate = document.getElementById('crm-loading');
      if (gate) observer.observe(gate, { childList: true, subtree: true, characterData: true });
    });
  });

  const startTime = Date.now();
  console.log('[ColdAuthCheck] Navigating to CRM admin page in cold context...');

  await page.goto(crmUrl, { waitUntil: 'domcontentloaded' });

  // Wait for the gate overlay to disappear and dashboard to be ready
  await page.waitForFunction(() => {
    const gate = document.getElementById('crm-loading');
    const dashboard = document.querySelector('.crm-panel[data-panel="dashboard"]');
    const gateHidden = !gate || getComputedStyle(gate).display === 'none';
    const dashboardReady = dashboard && getComputedStyle(dashboard).display !== 'none';
    return gateHidden && dashboardReady;
  }, { timeout: 15000 });

  const elapsedMs = Date.now() - startTime;
  console.log(`[ColdAuthCheck] Dashboard reached and gate cleared in ${elapsedMs}ms.`);

  const pageUrl = page.url();
  const gateStates = await page.evaluate(() => window.__gateStates || []);

  // Verify assertions
  const visitedIndexHtml = requests.some((u) => u.includes('index.html'));
  assert.strictEqual(visitedIndexHtml, false, 'Cold auth must NOT navigate to or request index.html!');

  const tokenRequestUrl = Array.from(responses.keys()).find((u) => u.includes('/api/local/admin-token'));
  assert.ok(tokenRequestUrl, 'Must have called /api/local/admin-token');
  assert.strictEqual(responses.get(tokenRequestUrl), 200, '/api/local/admin-token must return 200');

  const configRequestUrl = Array.from(responses.keys()).find((u) => u.includes('/api/config'));
  assert.ok(configRequestUrl, 'Must have called /api/config');
  assert.strictEqual(responses.get(configRequestUrl), 200, '/api/config must return 200');

  const adminStatusUrl = Array.from(responses.keys()).find((u) => u.includes('/api/admin/status'));
  assert.ok(adminStatusUrl, 'Must have called /api/admin/status');
  assert.strictEqual(responses.get(adminStatusUrl), 200, '/api/admin/status must return 200');

  assert.ok(
    elapsedMs <= 5500,
    `Access gate must clear within bounded target (expected <= 5000ms + 500ms jitter, got ${elapsedMs}ms)`
  );

  assert.strictEqual(
    consoleErrors.length,
    0,
    `Must have zero fatal/unexpected console errors: ${JSON.stringify(consoleErrors)}`
  );

  console.log('\n=== Cold Auth Verification Result ===');
  console.log(JSON.stringify({
    success: true,
    elapsedMs,
    targetElapsedMs: '<= 5000ms',
    visitedIndexHtml,
    tokenStatus: responses.get(tokenRequestUrl),
    configStatus: responses.get(configRequestUrl),
    adminStatus: responses.get(adminStatusUrl),
    finalUrl: pageUrl,
    gateStatesRecorded: gateStates.length,
    consoleErrorsCount: consoleErrors.length
  }, null, 2));

  // Phase 2: Warm reload / existing authenticated session verification
  console.log('\n[ColdAuthCheck] Testing warm / existing session reload in same context...');
  const warmRequests = [];
  page.on('request', (req) => warmRequests.push(req.url()));

  const warmStart = Date.now();
  await page.reload({ waitUntil: 'domcontentloaded' });

  await page.waitForFunction(() => {
    const gate = document.getElementById('crm-loading');
    const dashboard = document.querySelector('.crm-panel[data-panel="dashboard"]');
    return (!gate || getComputedStyle(gate).display === 'none')
      && dashboard && getComputedStyle(dashboard).display !== 'none';
  }, { timeout: 10000 });

  const warmElapsedMs = Date.now() - warmStart;
  console.log(`[ColdAuthCheck] Warm reload cleared in ${warmElapsedMs}ms.`);

  const warmTokenCalled = warmRequests.some((u) => u.includes('/api/local/admin-token'));
  assert.strictEqual(warmTokenCalled, false, 'Warm session should restore directly without re-fetching admin token');
  await context.close();

  // Phase 3: Missing/failed local bootstrap fallback verification
  console.log('\n[ColdAuthCheck] Testing failed bootstrap fallback in fresh context (mock 503)...');
  const failedContext = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 900 }
  });
  const failedPage = await failedContext.newPage();
  await failedPage.route('**/api/local/admin-token', (route) => {
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, error: 'LOCAL_ADMIN_UNAVAILABLE' })
    });
  });

  await failedPage.goto(crmUrl, { waitUntil: 'domcontentloaded' });
  // It should wait, show "Please log in first", and redirect to clean root /?next= (no index.html)
  await failedPage.waitForURL((url) => url.searchParams.has('next'), { timeout: 10000 });
  const redirectedUrl = failedPage.url();
  console.log(`[ColdAuthCheck] Successfully redirected to login on failed bootstrap: ${redirectedUrl}`);
  const redirectObj = new URL(redirectedUrl);
  assert.strictEqual(redirectObj.pathname.includes('index.html'), false, 'Clean URL requirement: Failed bootstrap must redirect to root / without index.html');
  assert.ok(redirectObj.searchParams.has('next'), 'Redirect must preserve destination in ?next= param');
  assert.strictEqual(decodeURIComponent(redirectObj.searchParams.get('next')).includes('.html'), false, 'Clean URL requirement: next param must not contain .html');
  await failedContext.close();

  await browser.close();
  console.log('\n[ColdAuthCheck] ALL VERIFICATIONS PASSED (Cold + Warm + Failed Fallback).');
}

runColdAuthCheck().catch((error) => {
  console.error('[ColdAuthCheck] FAILED:', error);
  process.exit(1);
});
