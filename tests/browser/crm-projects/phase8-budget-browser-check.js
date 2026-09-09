'use strict';
// Chrome-only acceptance: shipped shell, actual Auth/Firestore emulators and
// actual budget routes. Held responses retain their original bytes.
// Local accounting fixtures never perform provider I/O. Never run against production.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { chromium } = require('playwright');
const h = require('../../crm/projects/phase8-test-helpers');
const createCrmRouter = require('../../../functions/src/routes/admin/create-crm-router');
const { buildLocalCrmAdminDocument } = require('../../../src/server/app');
const ROOT = path.resolve(__dirname, '../../..');
const ARTIFACTS = path.join(ROOT, 'test-results/crm-projects/phase8-browser');
const report = { cases: [], screenshots: [], network: [], pageErrors: [], console: [], startedAt: new Date().toISOString() };
const releases = new Set();
const endpoint = value => { const [host, port] = value.split(':'); return { host, port: Number(port) }; };
function configuration() { return { success: true, config: { apiKey: 'demo-key', authDomain: 'demo-crm-projects.firebaseapp.com', projectId: 'demo-crm-projects', storageBucket: 'demo-crm-projects.appspot.com', appId: '1:000:web:phase6' }, emulators: { auth: endpoint(process.env.FIREBASE_AUTH_EMULATOR_HOST), firestore: endpoint(process.env.FIRESTORE_EMULATOR_HOST), storage: endpoint(process.env.FIREBASE_STORAGE_EMULATOR_HOST) }, features: { projects: true } }; }
function loginHtml() { return `<!doctype html><meta charset="utf-8"><script src="https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js"></script><script src="https://www.gstatic.com/firebasejs/9.22.0/firebase-auth-compat.js"></script><script>(async()=>{const p=await(await fetch('/api/config')).json();firebase.initializeApp(p.config);firebase.auth().useEmulator('http://'+p.emulators.auth.host+':'+p.emulators.auth.port,{disableWarnings:true});await firebase.auth().signInWithEmailAndPassword(new URLSearchParams(location.search).get('email'),${JSON.stringify(h.PASSWORD)});location.replace('/crm-admin.html#projects')})().catch(e=>document.body.textContent=e.message)</script>`; }
async function mountShell(suite) {
  const authMiddleware = async (req, res, next) => { try { req.user = await suite.auth.verifyIdToken(String(req.headers.authorization || '').replace(/^Bearer /, '')); next(); } catch (_) { res.status(401).json({ success: false }); } };
  const currentAdmin = async uid => (await suite.db.collection('users').doc(uid).get()).data()?.isAdmin === true;
  const adminMiddleware = async (req, res, next) => { if (await currentAdmin(req.user.uid)) next(); else res.status(403).json({ success: false, error: 'ADMIN_REQUIRED' }); };
  suite.api.use('/api/admin', createCrmRouter({ identity: require('../../../functions/src/studentIdentity'), db: suite.db, authMiddleware, adminMiddleware, resolveAdminStatus: async ({ req }) => ({ isAdmin: await currentAdmin(req.user.uid), uid: req.user.uid }), serverTimestamp: () => new Date() }));
  suite.api.get('/api/config', (_req, res) => res.json(configuration()));
  suite.api.get('/favicon.ico', (_req, res) => res.status(204).end());
  suite.api.get('/__phase8-login', (_req, res) => res.type('html').send(loginHtml()));
  suite.api.get('/crm-admin.html', (_req, res) => { const doc = buildLocalCrmAdminDocument(fs.readFileSync(path.join(ROOT, 'public/crm-admin.html'), 'utf8'), process.env, 'demo-crm-projects'); res.setHeader('Content-Security-Policy', doc.policy); res.setHeader('Cache-Control', 'no-store'); res.type('html').send(doc.html); });
  suite.api.use(express.static(path.join(ROOT, 'public')));
}
async function responseAction(page, method, pathname, action, status = 200) {
  const pending = page.waitForResponse(r => r.request().method() === method && new URL(r.url()).pathname === pathname, { timeout: 30000 });
  const [response, acted] = await Promise.allSettled([pending, Promise.resolve().then(action)]);
  if (acted.status === 'rejected') throw acted.reason; if (response.status === 'rejected') throw response.reason;
  const body = await response.value.json(); assert.equal(response.value.status(), status, JSON.stringify(body)); return body;
}
const state = page => page.evaluate(() => window.projectsBudgetController.getState());
async function budgetReady(page, uid) {
  await page.waitForFunction(uid => { const s = window.projectsBudgetController?.getState(); return s?.uid === uid && s.budget?.uid === uid && !s.loading; }, uid, { timeout: 30000 });
}
async function shellReady(page) {
  await page.waitForFunction(() => document.getElementById('crm-loading')?.style.display === 'none'
    && !!window.projectsBudgetController && !document.getElementById('btn-projects-access-refresh')?.disabled
    && !!document.getElementById('projects-board-project-select')?.value
    && document.getElementById('projects-view-status')?.textContent === '', null, { timeout: 30000 });
}
async function open(page, url, c) {
  await page.goto(`${url}/__phase8-login?email=${encodeURIComponent(h.USERS.owner)}`, { waitUntil: 'domcontentloaded' });
  await page.waitForURL(/crm-admin.html#projects$/); await shellReady(page); await budgetReady(page, c.uids.owner);
  await page.locator(`#projects-board-project-select option[value="${c.projectId}"]`).waitFor({ state: 'attached' });
  await page.locator('#projects-board-project-select').selectOption(c.projectId);
  await page.waitForFunction(id => window.projectsViewsController?.getState()?.response?.project?.id === id && document.getElementById('projects-view-status')?.textContent === '', c.projectId);
}
async function shot(page, name) { const file = path.join(ARTIFACTS, `${name}.png`); await page.screenshot({ path: file, fullPage: true }); report.screenshots.push(file); }
async function refresh(page, uid) {
  const body = await responseAction(page, 'GET', '/api/projects/budget', () => page.locator('[data-ai-budget-refresh]').click());
  await budgetReady(page, uid); return body.budget;
}
async function main() {
  fs.mkdirSync(ARTIFACTS, { recursive: true }); const suite = await h.bootSuite(); let browser, page;
  const run = async (name, fn) => {
    try { await fn(); report.cases.push({ name, passed: true }); }
    catch (error) { report.cases.push({ name, passed: false, error: error.stack }); if (page && !page.isClosed()) await Promise.allSettled([shot(page, `failure-${report.cases.length}`), page.content().then(html => fs.writeFileSync(path.join(ARTIFACTS, `failure-${report.cases.length}.html`), html))]); }
    finally { fs.writeFileSync(path.join(ARTIFACTS, 'report.json'), JSON.stringify(report, null, 2)); }
  };
  try {
    suite.setTime(new Date()); await mountShell(suite); const c = await h.project(suite, 'phase8-browser');
    for (const role of ['owner', 'viewer']) await suite.db.collection('users').doc(c.uids[role]).update({ isAdmin: true });
    await h.resetBudget(suite, c.uids.owner); await h.resetBudget(suite, c.uids.viewer);
    const a = await h.accounting(suite, c); const uid = c.uids.owner;
    browser = await chromium.launch({ channel: 'chrome', headless: true }); page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    page.on('pageerror', error => report.pageErrors.push(error.message)); page.on('console', message => { if (message.type() === 'error') report.console.push(message.text()); });
    page.on('response', response => { if (response.url().includes('/api/projects/')) report.network.push({ url: response.url(), method: response.request().method(), status: response.status() }); });
    const url = `http://127.0.0.1:${suite.server.address().port}`;
    await run('shipped Chrome shell reads shared account balance and refresh reflects data-input reservation', async () => {
      await open(page, url, c); assert.equal((await state(page)).budget.allowanceNano, '5000000000');
      await a.dataInput.reserve(uid, a.request('browser-data-input', '2', 'crm-data-input'));
      const budget = await refresh(page, uid); assert.equal(budget.pendingNano, '2000000000'); assert.equal(budget.availableNano, '3000000000');
      assert.equal(await page.locator('[data-ai-budget-amount="availableNano"]').innerText(), '$3.00'); await shot(page, 'shared-budget-refresh');
    });
    await run('exhaustion preserves native manual draft and manual save still persists', async () => {
      const input = page.locator('#projects-board-settings-description'); await input.fill('Manual draft survives an exhausted shared AI budget.');
      await a.projects.reserve(uid, a.request('browser-projects', '3')); await refresh(page, uid);
      assert.equal(await input.inputValue(), 'Manual draft survives an exhausted shared AI budget.'); assert.equal(await input.isEnabled(), true);
      assert.match(await page.locator('#projects-ai-budget').innerText(), /No AI budget is available this month/);
      assert.equal((await c.projectData()).description === 'Manual draft survives an exhausted shared AI budget.', false);
      await shot(page, 'exhaustion-manual-draft');
      await responseAction(page, 'PATCH', `/api/projects/${c.projectId}`, () => page.locator('#btn-projects-board-save-settings').click());
      assert.equal((await c.projectData()).description, 'Manual draft survives an exhausted shared AI budget.');
    });
    await run('admin controls reject amounts above five and persist zero through reload without refunding pending work', async () => {
      const input = page.locator('#projects-allowance-usd'); assert.equal(await input.getAttribute('max'), '5');
      const before = report.network.filter(row => row.method === 'PATCH' && new URL(row.url).pathname === '/api/projects/allowance').length;
      await input.fill('5.01'); await page.locator('#btn-projects-allowance-save').click();
      await page.getByText('Enter a USD amount from 0 to 5 with up to two decimal places.', { exact: true }).waitFor();
      assert.equal(report.network.filter(row => row.method === 'PATCH' && new URL(row.url).pathname === '/api/projects/allowance').length, before);
      await input.fill('0'); await responseAction(page, 'PATCH', '/api/projects/allowance', () => page.locator('#btn-projects-allowance-save').click());
      await page.waitForFunction(() => !document.getElementById('btn-projects-allowance-save').disabled);
      const budget = await refresh(page, uid); assert.equal(budget.allowanceNano, '0'); assert.equal(budget.pendingNano, '5000000000'); assert.equal(budget.availableNano, '-5000000000');
      assert.equal((await suite.db.collection('crmProjectAllowanceDefaults').doc('default').get()).data().monthlyAllowanceCents, 0);
      await page.reload({ waitUntil: 'domcontentloaded' }); await shellReady(page); await budgetReady(page, uid);
      assert.equal(await input.inputValue(), '0.00'); assert.equal((await state(page)).budget.allowanceNano, '0');
      assert.equal((await c.projectData()).description, 'Manual draft survives an exhausted shared AI budget.'); await shot(page, 'zero-allowance-reloaded');
    });
    await run('held previous-user response cannot restore private balance after actual Firebase account switch', async () => {
      let release, capture; const gate = new Promise(resolve => { release = resolve; }); const captured = new Promise(resolve => { capture = resolve; });
      releases.add(release); let delivery, deliveryError; const delivered = new Promise(resolve => { delivery = resolve; }); let first = true;
      const handler = async route => {
        if (!first) { await route.continue(); return; } first = false;
        try { const response = await route.fetch(); capture(); await gate; await route.fulfill({ response }); }
        catch (error) { deliveryError = error; capture(); }
        finally { delivery(); }
      };
      await page.route('**/api/projects/budget', handler); let timer;
      try {
        await page.locator('[data-ai-budget-refresh]').click();
        await Promise.race([captured, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Budget response was not captured')), 15000); })]);
        await page.evaluate(async ({ email, password }) => { await firebase.auth().signInWithEmailAndPassword(email, password); }, { email: h.USERS.viewer, password: h.PASSWORD }).catch(error => { if (!/context.*destroyed|navigation/i.test(error.message)) throw error; });
        await budgetReady(page, c.uids.viewer); release(); await delivered;
        if (deliveryError) assert.match(deliveryError.message, /context.*destroyed|Target.*closed|ERR_ABORTED|Invalid InterceptionId|Invalid interceptionId/i, 'Only discarded old-document delivery is expected on the shipped account-switch reload');
        report.staleResponse = { oldUid: uid, currentUid: c.uids.viewer, delivery: deliveryError ? 'discarded with old document' : 'fulfilled original response' };
        await page.waitForFunction(uid => window.projectsBudgetController?.getState().budget?.uid === uid && window.projectsBudgetController.getState().budget.pendingNano === '0', c.uids.viewer);
        const after = await state(page); assert.equal(after.uid, c.uids.viewer); assert.equal(after.budget.pendingNano, '0'); assert.equal(after.budget.availableNano, '0');
        assert.equal(await page.locator('[data-ai-budget-amount="pendingNano"]').innerText(), '$0.00'); await shot(page, 'stale-account-response-cleared');
      } finally { clearTimeout(timer); release(); releases.delete(release); await page.unroute('**/api/projects/budget', handler); }
    });
    await run('no unhandled page errors or Projects server failures', async () => { assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.network.filter(row => row.status >= 500), []); });
  } finally {
    for (const release of releases) release(); if (browser) await browser.close(); suite.server.closeAllConnections?.(); await suite.close();
    report.finishedAt = new Date().toISOString(); report.passed = report.cases.filter(row => row.passed).length; fs.writeFileSync(path.join(ARTIFACTS, 'report.json'), JSON.stringify(report, null, 2));
  }
  process.stdout.write(`${JSON.stringify({ passed: report.passed, cases: report.cases.length, report: path.join(ARTIFACTS, 'report.json') })}\n`);
  if (report.cases.some(row => !row.passed)) process.exitCode = 1;
}
main().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
