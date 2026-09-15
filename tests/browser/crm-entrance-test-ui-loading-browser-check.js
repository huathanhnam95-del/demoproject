/* eslint-disable no-console */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

async function run() {
  const baseUrl = (process.argv[2] || 'https://localhost:8443').replace(/\/$/, '');
  const crmPath = process.env.BEL_CRM_PATH || '/crm-admin';
  const target = `${baseUrl}${crmPath}#entrance-test-ui`;
  const evidenceDir = process.env.BEL_EVIDENCE_DIR || '';
  const routeTimeoutMs = Number(process.env.BEL_ROUTE_TIMEOUT_MS || 15000);
  const routeBudgetMs = Number(process.env.BEL_ROUTE_BUDGET_MS || 10000);
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 1000 }
  });
  const page = await context.newPage();
  const heldRoutes = [];
  const errors = [];

  const firebaseStub = `(() => {
    if (window.firebase) return;
    const user = {
      uid: 'fixture-admin',
      getIdToken: async () => 'fixture-token',
      getIdTokenResult: async () => ({ claims: { isAdmin: true } })
    };
    const auth = {
      currentUser: user,
      setPersistence: async () => true,
      onAuthStateChanged(callback) { queueMicrotask(() => callback(user)); return () => {}; }
    };
    const authFactory = () => auth;
    authFactory.Auth = { Persistence: { LOCAL: 'local' } };
    const firestoreFactory = () => ({
      collection: () => ({ doc: () => ({ get: async () => ({ exists: false }) }) })
    });
    firestoreFactory.FieldValue = { serverTimestamp: () => ({}) };
    window.firebase = {
      apps: [],
      initializeApp() { this.apps.push({}); },
      auth: authFactory,
      firestore: firestoreFactory,
      storage: () => ({})
    };
  })();`;
  await page.route('https://www.gstatic.com/firebasejs/**', route => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: firebaseStub
  }));
  await page.route('**/api/config', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ success: true, config: { apiKey: 'fixture-key', projectId: 'fixture-project' } })
  }));
  await page.route('**/api/admin/status', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ success: true, isAdmin: true, capabilities: {} })
  }));
  await page.route('**/api/projects/access', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ success: true, identity: { accountStatus: 'active', moduleGrants: { projects: true } }, projects: [{ id: 'fixture-project' }], canManagePeople: true })
  }));
  await page.route(/https:\/\/(?:unpkg\.com|cdn\.jsdelivr\.net)\//, route => {
    heldRoutes.push(route);
  });
  page.on('pageerror', error => errors.push(error.message));

  const started = Date.now();
  await page.goto(target, { waitUntil: 'commit', timeout: 30000 });
  try {
    await page.waitForFunction(() => {
      const gate = document.getElementById('crm-loading');
      const panel = document.querySelector('.crm-panel[data-panel="entrance-test-ui"]');
      return (!gate || getComputedStyle(gate).display === 'none')
        && panel && getComputedStyle(panel).display !== 'none'
        && document.querySelector('#et-ui-name');
    }, null, { timeout: routeTimeoutMs });
  } catch (error) {
    const state = await page.evaluate(() => {
      const gate = document.getElementById('crm-loading');
      const visiblePanel = Array.from(document.querySelectorAll('.crm-panel')).find(node => getComputedStyle(node).display !== 'none');
      return {
        url: location.href,
        readyState: document.readyState,
        gateDisplay: gate ? getComputedStyle(gate).display : 'missing',
        gateText: document.getElementById('crm-loading-text')?.textContent || '',
        visiblePanel: visiblePanel?.dataset?.panel || '',
        skinCount: document.querySelectorAll('[data-skin]').length
      };
    });
    console.error(JSON.stringify({ state, heldRoutes: heldRoutes.length, errors }, null, 2));
    await Promise.all(heldRoutes.map(route => route.fulfill({ status: 204, body: '' }).catch(() => {})));
    await browser.close();
    throw error;
  }
  const elapsedMs = Date.now() - started;
  await page.locator('#et-ui-name').fill('Loading regression fixture');
  await page.locator('#et-ui-enter').click();
  await page.locator('[data-skin="d"]').waitFor({ state: 'visible', timeout: 5000 });
  const skins = await page.locator('[data-skin]').allTextContents();

  assert.ok(heldRoutes.length >= 1, 'Expected at least one unrelated deferred CDN request to remain pending');
  assert.ok(skins.some(label => /D\s*·\s*Signal Noto/.test(label)), `Expected Demo D among four skins: ${skins.join(' | ')}`);
  assert.ok(elapsedMs <= routeBudgetMs, `Entrance Test route must render within ${routeBudgetMs}ms while unrelated deferred assets are pending; got ${elapsedMs}ms`);
  assert.deepStrictEqual(errors, [], `Unexpected page errors: ${JSON.stringify(errors)}`);

  if (evidenceDir) {
    fs.mkdirSync(evidenceDir, { recursive: true });
    await page.screenshot({ path: path.join(evidenceDir, 'crm-entrance-test-ui-loading.png'), fullPage: true });
  }
  await Promise.all(heldRoutes.map(route => route.fulfill({ status: 204, body: '' }).catch(() => {})));
  await browser.close();
  console.log(JSON.stringify({ success: true, elapsedMs, skinCount: skins.length, demoD: true, deferredRequestsHeld: heldRoutes.length }));
}

run().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
