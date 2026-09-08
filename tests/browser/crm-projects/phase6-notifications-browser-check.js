'use strict';
// Chrome-only acceptance: shipped shell, actual Auth/Firestore emulators and
// production notification routes. Held responses retain their original bytes.
// Seeded deliveries exercise the notification service; engine firing is covered
// separately by the Phase6 persisted engine suite. Never run against production.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { chromium } = require('playwright');
const h = require('../../crm/projects/phase6-test-helpers');
const createCrmRouter = require('../../../functions/src/routes/admin/create-crm-router');
const { buildLocalCrmAdminDocument } = require('../../../src/server/app');
const ROOT = path.resolve(__dirname, '../../..');
const ARTIFACTS = path.join(ROOT, 'test-results/crm-projects/phase6-browser');
const TASK = 'notification-target', ANCHOR = 'navigation-anchor', DISCUSSION = 'discussion-target', REMOVED = 'unavailable-target', MESSAGE = 'message-000';
const PRIVATE = 'Phase6 private notification sentinel';
const report = { cases: [], screenshots: [], network: [], pageErrors: [], console: [], persisted: {}, startedAt: new Date().toISOString() };
const releases = new Set();
let activePage = null, recoverCase = null;
const n = name => `[data-notifications-${name}]`;
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
  suite.api.get('/__phase6-login', (_req, res) => res.type('html').send(loginHtml()));
  suite.api.get('/crm-admin.html', (_req, res) => { const doc = buildLocalCrmAdminDocument(fs.readFileSync(path.join(ROOT, 'public/crm-admin.html'), 'utf8'), process.env, 'demo-crm-projects'); res.setHeader('Content-Security-Policy', doc.policy); res.setHeader('Cache-Control', 'no-store'); res.type('html').send(doc.html); });
  suite.api.use(express.static(path.join(ROOT, 'public')));
}
async function seed(suite) {
  // A fixed synthetic clock keeps this fixture distinct from earlier Phase6 cases.
  suite.setTime('2026-10-01T00:00:00.000Z');
  const runId = Date.now().toString(36);
  const main = await h.project(suite, `browser-notifications-main-${runId}`);
  const second = await h.project(suite, `browser-notifications-second-${runId}`);
  await suite.db.collection('users').doc(main.uids.owner).update({ isAdmin: true });
  await suite.db.collection('users').doc(main.uids.viewer).update({ isAdmin: true });
  const existing = h.expectStatus(await suite.global('/notification-preferences', 'owner'), 200);
  h.expectStatus(await suite.global('/notification-preferences', 'owner', 'PATCH', { expectedRevision: existing.revision, muted: [] }), 200);
  await main.task(TASK, { title: PRIVATE, ownerUid: main.uids.owner });
  await main.task(ANCHOR, { title: 'Keep this intentional selection' });
  await main.task(DISCUSSION, { title: 'Phase6 paged conversation' });
  await main.task(REMOVED, { title: 'Phase6 removed sensitive title' });
  await second.task(ANCHOR, { title: 'Second project intentional selection' });
  for (let index = 0; index < 55; index++) {
    suite.advance(1000);
    h.expectStatus(await main.send(`/tasks/${DISCUSSION}/discussion/messages`, { operationId: main.op('message'), messageId: `message-${String(index).padStart(3, '0')}`, body: `Phase6 conversation ${index}`, mentions: [] }), 200);
  }
  let serial = 0;
  async function deliver(category, taskId = TASK, extra = {}) {
    suite.advance(1000);
    return suite.notificationService.deliver({ identity: `${main.projectId}-browser-${++serial}`, projectId: main.projectId, taskId, category, recipientUids: [main.uids.owner], actorUid: main.uids.editor, excludeActor: true, message: `${PRIVATE} ${category} ${serial}`, ...extra });
  }
  const assignmentIds = [];
  for (let index = 0; index < 30; index++) assignmentIds.push(...(await deliver('assignment')).notificationIds);
  const discussionId = (await deliver('discussion', DISCUSSION, { messageId: MESSAGE })).notificationIds[0];
  const removedId = (await deliver('automation', REMOVED)).notificationIds[0];
  const deadlineId = (await deliver('deadline')).notificationIds[0];
  // Newer nonmatches exceed the authorization scan bound. Exact filters must
  // find the older deadline on the first page, without Load more.
  const noise = suite.db.batch();
  for (let index = 0; index < 110; index++) {
    const notificationId = `${main.projectId}-filter-noise-${index}`;
    noise.set(suite.db.collection(h.COLLECTIONS.notifications).doc(notificationId), { notificationId, projectId: second.projectId, taskId: ANCHOR, recipientUid: main.uids.owner, category: 'automation', read: true, createdAt: '2040-01-01T00:00:00.000Z', message: 'Newer nonmatching update' });
  }
  await noise.commit();
  assert.equal(assignmentIds.length, 30); assert.ok(discussionId && removedId && deadlineId);
  return { main, second, assignmentIds, discussionId, removedId, deadlineId, deliver };
}
async function responseAction(page, method, pathname, action, status = 200) {
  const pending = page.waitForResponse(r => r.request().method() === method && new URL(r.url()).pathname === pathname, { timeout: 30000 });
  // Attach rejection handlers to both promises before either can reject. Wait
  // for both to settle so a failed click cannot run into the next test case.
  const [responseResult, actionResult] = await Promise.allSettled([pending, Promise.resolve().then(action)]);
  if (actionResult.status === 'rejected') throw actionResult.reason;
  if (responseResult.status === 'rejected') throw responseResult.reason;
  const response = responseResult.value; const body = await response.json();
  assert.equal(response.status(), status, `${method} ${pathname}: ${JSON.stringify(body)}`); return body;
}
async function idleFeed(page) { await page.waitForFunction(() => window.projectsNotificationsController && !window.projectsNotificationsController.getState().loading && !document.querySelector('[data-notifications-status]')?.textContent?.includes('Loading'), null, { timeout: 30000 }); }
async function idleBoard(page, projectId) { await page.waitForFunction(id => window.projectsViewsController?.getState()?.response?.project?.id === id && document.getElementById('projects-view-status')?.textContent === '', projectId, { timeout: 30000 }); }
async function shellReady(page) {
  await page.waitForFunction(() => {
    const boardPicker = document.getElementById('projects-board-project-select');
    const accessPicker = document.getElementById('projects-project-select');
    const accessRefresh = document.getElementById('btn-projects-access-refresh');
    return document.getElementById('crm-loading')?.style.display === 'none'
      && !!window.projectsNotificationsController && !!accessPicker && !accessPicker.disabled
      && !!accessRefresh && !accessRefresh.disabled
      && !!boardPicker && !boardPicker.disabled && !!window.projectsViewsController;
  }, null, { timeout: 30000 });
}
async function chooseProject(page, projectId) {
  // Access rejects selectProject while its initial refresh or member read is
  // pending; the Board picker alone does not reflect that independent lock.
  await shellReady(page);
  await page.locator(`#projects-board-project-select option[value="${projectId}"]`).waitFor({ state: 'attached' });
  await page.locator('#projects-board-project-select').selectOption(projectId);
  await idleBoard(page, projectId);
  await page.waitForSelector('#projects-board-workspace:not([hidden])');
}

async function openPanel(page) {
  const details = page.locator(n('panel')); await details.waitFor();
  if (!(await details.evaluate(el => el.open))) { await details.locator(':scope > summary').click(); }
  await idleFeed(page);
  await page.waitForFunction(() => window.projectsNotificationsController?.getState().revision !== null && !window.projectsNotificationsController.getState().prefsLoading);
}
async function open(page, url, projectId, role = 'owner') {
  await page.goto(`${url}/__phase6-login?email=${encodeURIComponent(h.USERS[role])}`, { waitUntil: 'domcontentloaded' });
  await page.waitForURL(/crm-admin.html#projects$/);
  await shellReady(page);
  await chooseProject(page, projectId); await openPanel(page);
}
async function feedFilter(page, projectId, category = '', unread = '') {
  for (const [name, value] of [['project', projectId], ['category', category], ['unread', unread]]) {
    if ((await page.locator(n(name)).inputValue()) !== value) {
      await responseAction(page, 'GET', '/api/projects/notifications', () => page.locator(n(name)).selectOption(value)); await idleFeed(page);
    }
  }
}
async function refreshFeed(page) { await responseAction(page, 'GET', '/api/projects/notifications', () => page.locator(n('refresh')).click()); await idleFeed(page); }
async function selectTask(page, taskId, projectId) {
  await page.locator('#projects-view-tabs [data-view="kanban"]').click(); await idleBoard(page, projectId);
  await page.locator(`[data-task-open="${taskId}"]`).first().click();
  await page.waitForFunction(id => window.projectsViewsController?.getState()?.selectedTaskId === id, taskId);
}
async function preferencesPanel(page) {
  await openPanel(page);
  const details = page.locator('#projects-notifications details').filter({ has: page.locator(n('prefs-status')) }).last();
  if (!(await details.evaluate(el => el.open))) await details.locator(':scope > summary').click();
}
async function addMute(page, projectId, category) {
  await preferencesPanel(page); await page.locator(n('mute-project')).selectOption(projectId); await page.locator(n('mute-category')).selectOption(category); await page.locator(n('mute-add')).click();
}
async function screenshot(page, name) { const file = path.join(ARTIFACTS, `${name}.png`); await page.screenshot({ path: file, fullPage: true }); report.screenshots.push(file); }
async function failureArtifacts(name) {
  if (!activePage || activePage.isClosed()) return { unavailable: 'Page is closed' };
  const stem = `failure-${String(report.cases.length).padStart(2, '0')}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 80)}`;
  const paths = { screenshot: path.join(ARTIFACTS, `${stem}.png`), dom: path.join(ARTIFACTS, `${stem}.html`), state: path.join(ARTIFACTS, `${stem}.json`) };
  const outcomes = await Promise.allSettled([
    activePage.screenshot({ path: paths.screenshot, fullPage: true, timeout: 10000 }),
    activePage.content().then(html => fs.writeFileSync(paths.dom, html)),
    activePage.evaluate(() => ({
      url: location.href, actorUid: window.firebase?.auth?.().currentUser?.uid || null,
      notifications: window.projectsNotificationsController?.getState() || null,
      views: window.projectsViewsController?.getState() || null,
      discussion: window.projectsDiscussionController?.getState() || null,
      controls: Object.fromEntries(['crm-loading', 'projects-board-project-select', 'projects-project-select', 'btn-projects-access-refresh', 'btn-projects-board-refresh', 'projects-board-status', 'projects-view-status', 'projects-notifications'].map(id => {
        const el = document.getElementById(id);
        return [id, el ? { value: el.value, disabled: el.disabled, hidden: el.hidden, display: getComputedStyle(el).display, text: el.textContent?.slice(0, 3000) } : null];
      })),
      notificationPanelOpen: !!document.querySelector('[data-notifications-panel]')?.open,
      selectedTaskId: window.projectsViewsController?.getState()?.selectedTaskId || null
    })).then(state => fs.writeFileSync(paths.state, JSON.stringify(state, null, 2)))
  ]);
  return { ...paths, errors: outcomes.flatMap((outcome, index) => outcome.status === 'rejected' ? [{ artifact: Object.keys(paths)[index], message: outcome.reason.message }] : []) };
}
async function caseRun(name, action) {
  try { await action(); report.cases.push({ name, passed: true }); process.stdout.write(`PASS ${name}\n`); }
  catch (error) {
    const failure = { name, passed: false, error: error.stack }; report.cases.push(failure);
    process.stderr.write(`FAIL ${name}: ${error.stack}\n`);
    try { failure.artifacts = await failureArtifacts(name); } catch (captureError) { failure.artifactError = captureError.stack; }
    // Keep the original failure and evidence. A fresh authorized shell only
    // restores the next case's visible controls; it cannot turn failure green.
    if (recoverCase) { try { await recoverCase(); failure.recovery = 'Fresh shell opened for next case'; } catch (recoveryError) { failure.recoveryError = recoveryError.stack; } }
  }
  finally { fs.writeFileSync(path.join(ARTIFACTS, 'report.json'), JSON.stringify(report, null, 2)); }
}
async function heldResponse(page, pattern, trigger, switchScope, verify) {
  let release, announce, finished, handled = false, failure;
  const blocked = new Promise(resolve => { release = resolve; });
  const captured = new Promise(resolve => { announce = resolve; });
  const delivered = new Promise(resolve => { finished = resolve; });
  releases.add(release);
  const handler = async route => {
    if (handled) return route.continue(); handled = true;
    try { const response = await route.fetch(); announce(); await blocked; await route.fulfill({ response }); }
    catch (error) { if (!/already handled|closed|disposed/i.test(error.message)) failure = error; announce(); }
    finally { finished(); }
  };
  await page.route(pattern, handler); let timer;
  try {
    await trigger();
    await Promise.race([captured, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Held request was not captured')), 15000); })]); clearTimeout(timer);
    if (failure) throw failure;
    await switchScope(); release(); await delivered; if (failure) throw failure;
    // Flush UI callbacks after release; this is not a latency assertion.
    await page.waitForTimeout(150); await verify();
  } finally { clearTimeout(timer); release(); releases.delete(release); await page.unroute(pattern, handler); }
}
async function main() {
  h.assertDedicatedEmulators(); fs.readFileSync('C:/Cursor AI/.local/browser-test-credentials.md', 'utf8');
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const suite = await h.bootSuite(); let browser;
  try {
    const fixture = await seed(suite); const { main: c, second } = fixture;
    await mountShell(suite); const url = `http://127.0.0.1:${suite.server.address().port}`;
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } }); const page = await context.newPage();
    activePage = page; recoverCase = () => open(page, url, c.projectId);
    page.on('console', message => { if (message.type() === 'error') report.console.push({ text: message.text(), url: message.location().url }); });
    page.on('pageerror', error => report.pageErrors.push({ message: error.message, stack: error.stack }));
    page.on('response', response => { if (response.url().includes('/api/projects/')) report.network.push({ url: response.url(), method: response.request().method(), status: response.status() }); });
    await open(page, url, c.projectId);
    await caseRun('older exact filter match is reachable on the first page beyond 100 newer nonmatches', async () => {
      await feedFilter(page, c.projectId, 'deadline', 'true');
      const state = await page.evaluate(() => window.projectsNotificationsController.getState());
      assert.deepEqual(state.items.map(item => item.notificationId), [fixture.deadlineId]);
      assert.equal(state.cursor, null);assert.equal(await page.locator(n('more')).isVisible(), false);
      await page.locator(`[data-notification-open="${fixture.deadlineId}"]`).waitFor();
      assert.ok(report.network.some(row => row.status === 200 && row.url.includes(`projectId=${c.projectId}`) && row.url.includes('category=deadline') && row.url.includes('unread=true')));
    });
    await caseRun('real authorized category feed paginates without duplicate rows or global unread claims', async () => {
      await feedFilter(page, c.projectId, 'assignment');
      const first = await page.evaluate(() => window.projectsNotificationsController.getState()); assert.ok(first.items.length <= 25); assert.ok(first.cursor);
      let pages = 0;
      while (await page.locator(n('more')).isVisible()) { assert.ok(++pages <= 100, 'authorized feed pagination must converge'); await responseAction(page, 'GET', '/api/projects/notifications', () => page.locator(n('more')).click()); await idleFeed(page); }
      const state = await page.evaluate(() => window.projectsNotificationsController.getState());
      assert.deepEqual(state.items.map(item => item.notificationId).sort(), fixture.assignmentIds.slice().sort()); assert.equal(state.cursor, null);
      assert.equal(await page.locator('.crm-projects-notification-row').count(), 30); assert.equal(await page.locator(n('more')).isVisible(), false);
      assert.match(await page.locator(n('status')).innerText(), /30 updates loaded/); await screenshot(page, 'category-paged-feed');
    });
    await caseRun('read and unread changes persist through actual page reload', async () => {
      await feedFilter(page, c.projectId, 'assignment'); await refreshFeed(page);
      const id = await page.locator('[data-notification-read]').first().getAttribute('data-notification-read');
      await responseAction(page, 'PATCH', `/api/projects/notifications/${id}`, () => page.locator(`[data-notification-read="${id}"]`).click());
      assert.equal((await suite.db.collection(h.COLLECTIONS.notifications).doc(id).get()).data().read, true);
      await page.reload({ waitUntil: 'domcontentloaded' }); await shellReady(page); await chooseProject(page, c.projectId); await openPanel(page); await feedFilter(page, c.projectId, 'assignment', 'false');
      await page.locator(`[data-notification-read="${id}"]`).waitFor(); assert.equal(await page.locator(`[data-notification-read="${id}"]`).innerText(), 'Mark unread');
      await responseAction(page, 'PATCH', `/api/projects/notifications/${id}`, () => page.locator(`[data-notification-read="${id}"]`).click());
      await page.waitForFunction(id => !window.projectsNotificationsController.getState().items.some(item => item.notificationId === id), id);
      assert.equal((await suite.db.collection(h.COLLECTIONS.notifications).doc(id).get()).data().read, false); report.persisted.readRoundtrip = { notificationId: id, finalRead: false };
    });
    await caseRun('loading, transient retry and empty category states are usable', async () => {
      await feedFilter(page, second.projectId, 'deadline'); assert.match(await page.locator(n('list')).innerText(), /No updates/);
      const pattern = '**/api/projects/notifications?**'; await page.route(pattern, route => route.abort('failed'), { times: 1 });
      await page.locator(n('refresh')).click(); await page.waitForFunction(() => window.projectsNotificationsController.getState().status.includes('Retry'));
      await page.unroute(pattern); await refreshFeed(page); assert.match(await page.locator(n('list')).innerText(), /No updates/);
      await heldResponse(page, pattern, () => page.locator(n('refresh')).click(), async () => { assert.match(await page.locator(n('list')).innerText(), /Loading updates/); assert.equal(await page.locator(n('refresh')).isDisabled(), true); }, () => idleFeed(page));
    });
    await caseRun('project category mute suppresses new delivery; unmute preserves history without replay', async () => {
      await feedFilter(page, c.projectId, 'deadline'); await addMute(page, c.projectId, 'deadline');
      await responseAction(page, 'PATCH', '/api/projects/notification-preferences', () => page.locator(n('save')).click());
      const before = (await c.rows('notifications')).length; assert.deepEqual((await fixture.deliver('deadline')).notificationIds, []);
      assert.equal((await c.rows('notifications')).length, before); await refreshFeed(page); assert.equal(await page.locator(`[data-notification-read="${fixture.deadlineId}"]`).count(), 1);
      await page.locator(n('mute-list')).getByRole('button', { name: 'Unmute', exact: true }).click();
      await responseAction(page, 'PATCH', '/api/projects/notification-preferences', () => page.locator(n('save')).click());
      assert.equal((await c.rows('notifications')).length, before, 'unmute must not replay suppressed delivery');
      const added = await fixture.deliver('deadline'); assert.equal(added.notificationIds.length, 1); await refreshFeed(page); await page.locator(`[data-notification-read="${added.notificationIds[0]}"]`).waitFor();
      report.persisted.mute = { before, afterUnmuteDelivery: (await c.rows('notifications')).length }; await screenshot(page, 'mute-preferences');
    });
    await caseRun('real preference409 retains draft and explicit refresh allows reviewed save', async () => {
      await addMute(page, c.projectId, 'discussion');
      const revision = await page.evaluate(() => window.projectsNotificationsController.getState().revision);
      h.expectStatus(await suite.global('/notification-preferences', 'owner', 'PATCH', { expectedRevision: revision, muted: [] }), 200);
      await responseAction(page, 'PATCH', '/api/projects/notification-preferences', () => page.locator(n('save')).click(), 409);
      await page.waitForFunction(() => window.projectsNotificationsController.getState().conflict);
      assert.equal(await page.locator(n('save')).isDisabled(), true); assert.match(await page.locator(n('mute-list')).innerText(), /discussion/);
      await responseAction(page, 'GET', '/api/projects/notification-preferences', () => page.locator(n('prefs-refresh')).click());
      await page.waitForFunction(() => !window.projectsNotificationsController.getState().prefsLoading && !window.projectsNotificationsController.getState().conflict);
      assert.match(await page.locator(n('mute-list')).innerText(), /discussion/);
      await responseAction(page, 'PATCH', '/api/projects/notification-preferences', () => page.locator(n('save')).click());
      const persisted = h.expectStatus(await suite.global('/notification-preferences', 'owner'), 200); assert.ok(persisted.muted.some(item => item.projectId === c.projectId && item.category === 'discussion')); report.persisted.conflictRevision = persisted.revision;
    });
    await caseRun('resolved discussion notification focuses exact message beyond first50records', async () => {
      const first = h.expectStatus(await c.get(`/tasks/${DISCUSSION}/discussion?pageSize=50&order=desc`), 200); assert.equal(first.messages.length, 50); assert.ok(!first.messages.some(message => message.id === MESSAGE));
      await feedFilter(page, c.projectId, 'discussion');
      await responseAction(page, 'GET', `/api/projects/notifications/${fixture.discussionId}/target`, () => page.locator(`[data-notification-open="${fixture.discussionId}"]`).click());
      await page.waitForFunction(id => document.activeElement?.dataset?.messageId === id, MESSAGE, { timeout: 30000 });
      assert.equal(await page.evaluate(() => window.projectsViewsController.getState().selectedTaskId), DISCUSSION);
      assert.ok(report.network.some(row => row.url.includes(`/tasks/${DISCUSSION}/discussion?`) && row.url.includes('cursor=')));
      await screenshot(page, 'resolved-paged-message-focus');
    });
    await caseRun('held target GET cannot replace intentional A-B-A navigation and selected task', async () => {
      await chooseProject(page, c.projectId); await feedFilter(page, c.projectId, 'assignment'); await refreshFeed(page);
      const id = await page.locator('[data-notification-open]').first().getAttribute('data-notification-open');
      await heldResponse(page, `**/api/projects/notifications/${id}/target`, () => page.locator(`[data-notification-open="${id}"]`).click(), async () => {
        await chooseProject(page, second.projectId); await chooseProject(page, c.projectId); await selectTask(page, ANCHOR, c.projectId);
      }, async () => { assert.equal(await page.evaluate(() => window.projectsViewsController.getState().selectedTaskId), ANCHOR); assert.match(await page.locator('#projects-board-detail-body').innerText(), new RegExp(ANCHOR)); await screenshot(page, 'held-target-navigation-fence'); });
    });
    await caseRun('archived target becomes generic tombstone without cached title or destination', async () => {
      await feedFilter(page, c.projectId, 'automation'); await page.locator(`[data-notification-open="${fixture.removedId}"]`).waitFor();
      await c.lifecycle(REMOVED, 'archive');
      const target = await responseAction(page, 'GET', `/api/projects/notifications/${fixture.removedId}/target`, () => page.locator(`[data-notification-open="${fixture.removedId}"]`).click()); assert.equal(target.available, false);
      await page.waitForFunction(id => window.projectsNotificationsController.getState().items.find(item => item.notificationId === id)?.available === false, fixture.removedId);
      assert.equal(await page.locator(`[data-notification-open="${fixture.removedId}"]`).count(), 0); h.noSecrets(await page.locator(n('list')).innerText(), ['Phase6 removed sensitive title']);
      await refreshFeed(page); const row = await page.evaluate(id => window.projectsNotificationsController.getState().items.find(item => item.notificationId === id), fixture.removedId); assert.equal(row.taskLabel, undefined); assert.equal(row.message, undefined); await screenshot(page, 'generic-tombstone');
    });
    await caseRun('notification denial clears existing Board and feed while admin metadata remains separate', async () => {
      await chooseProject(page, c.projectId); await selectTask(page, TASK, c.projectId); await feedFilter(page, c.projectId, 'assignment'); await refreshFeed(page);
      const id = await page.locator('[data-notification-open]').first().getAttribute('data-notification-open'); const memberRef = c.memberRef('owner'); const saved = (await memberRef.get()).data();
      try {
        await memberRef.update({ active: false });
        await responseAction(page, 'GET', `/api/projects/notifications/${id}/target`, () => page.locator(`[data-notification-open="${id}"]`).click(), 404);
        await page.waitForFunction(() => window.projectsNotificationsController.getState().items.length === 0 && !window.projectsViewsController.getState().response?.project?.id);
        assert.equal(await page.locator('#projects-board-detail-body').innerText(), '');
        h.noSecrets(await page.locator('#projects-notifications').innerText(), [PRIVATE]);
        assert.equal(await page.locator(`#projects-project-select option[value="${c.projectId}"]`).count(), 1, 'administrator metadata picker is independent of content membership');
        assert.equal(await page.locator(`#projects-board-project-select option[value="${c.projectId}"]`).count(), 0);
        assert.equal((await page.evaluate(() => window.projectsNotificationsController.getState())).draft.length, 0); await screenshot(page, 'notification-access-revoked');
      } finally { await memberRef.set(saved); await page.reload({ waitUntil: 'domcontentloaded' }); await shellReady(page); await chooseProject(page, c.projectId); await openPanel(page); }
    });
    await caseRun('held feed cannot restore previous account content after actual Auth switch', async () => {
      await feedFilter(page, c.projectId, 'assignment');
      await heldResponse(page, '**/api/projects/notifications?**', () => page.locator(n('refresh')).click(), async () => {
        await page.evaluate(async ({ email, password }) => { await firebase.auth().signInWithEmailAndPassword(email, password); }, { email: h.USERS.viewer, password: h.PASSWORD }).catch(error => { if (!/context.*destroyed|navigation/i.test(error.message)) throw error; });
        await page.waitForFunction(uid => window.projectsNotificationsController?.getState()?.actor === uid, c.uids.viewer, { timeout: 30000 });
      }, async () => {
        const state = await page.evaluate(() => window.projectsNotificationsController.getState()); assert.equal(state.actor, c.uids.viewer); h.noSecrets(state, [PRIVATE]); h.noSecrets(await page.locator('#projects-notifications').innerText(), [PRIVATE]);
        await chooseProject(page, c.projectId); await openPanel(page); await feedFilter(page, c.projectId, 'assignment'); assert.equal((await page.evaluate(() => window.projectsNotificationsController.getState())).items.length, 0); await screenshot(page, 'account-switch-held-feed');
      });
    });
    await caseRun('no unhandled JavaScript exceptions or Projects server errors', async () => { assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.network.filter(row => row.status >= 500), []); });
  } finally {
    for (const release of releases) release();
    report.finishedAt = new Date().toISOString(); report.passed = report.cases.filter(row => row.passed).length; fs.writeFileSync(path.join(ARTIFACTS, 'report.json'), JSON.stringify(report, null, 2));
    const cleanup = async (label, action) => { let timer; try { await Promise.race([action(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} cleanup timed out`)), 5000); })]); } catch (error) { process.stderr.write(error.stack + '\n'); process.exitCode = 1; } finally { clearTimeout(timer); } };
    if (browser) await cleanup('Chrome', () => browser.close()); suite.server.closeAllConnections?.(); await cleanup('fixture', () => suite.close());
  }
  process.stdout.write(JSON.stringify({ passed: report.passed, cases: report.cases.length, report: path.join(ARTIFACTS, 'report.json') }) + '\n');
  if (report.cases.some(row => !row.passed)) process.exitCode = 1;
}
main().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
