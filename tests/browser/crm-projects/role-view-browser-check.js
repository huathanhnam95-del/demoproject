'use strict';
// Real shipped shell and Projects routes against dedicated local emulators only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const express = require('express');
const { chromium } = require('playwright');
const h = require('../../crm/projects/phase5-test-helpers');
const { memberDocumentId, PROJECT_COLLECTIONS } = require('../../../functions/src/crm/projects/access-service');
const createCrmRouter = require('../../../functions/src/routes/admin/create-crm-router');
const { buildLocalCrmAdminDocument } = require('../../../src/server/app');
const ROOT = path.resolve(__dirname, '../../..');
const OUT = path.join(ROOT, 'test-results/crm-projects/role-view-browser');
const PROJECT = 'role-view-' + Date.now();
const TASK = 'role-view-task';
const TIMEOUT = 30000;
const actors = [
    { role: 'Owner', key: 'owner', email: h.USERS.owner, uid: h.UID_BY_ROLE.owner },
    { role: 'Editor', key: 'editor', email: h.USERS.editor, uid: h.UID_BY_ROLE.editor },
    { role: 'Viewer', key: 'viewer', email: h.USERS.viewer, uid: h.UID_BY_ROLE.viewer },
    { role: 'Admin nonmember', key: 'admin@demo.crm-projects.test', email: 'admin@demo.crm-projects.test', uid: 'crm-projects-admin', denied: 404 },
    { role: 'Unauthorized', key: 'unauthorized', email: h.USERS.unauthorized, uid: h.UID_BY_ROLE.unauthorized, denied: 403 }
];
const report = { projectId: PROJECT, startedAt: new Date().toISOString(), passed: false, cases: [], network: [], pageErrors: [], console: [], cleanupErrors: [] };
const endpoint = value => { const [host, port] = value.split(':'); return { host, port: Number(port) }; };
function configuration() { return { success: true, config: { apiKey: 'demo-key', authDomain: 'demo-crm-projects.firebaseapp.com', projectId: 'demo-crm-projects', storageBucket: 'demo-crm-projects.appspot.com', appId: '1:000:web:phase5' }, emulators: { auth: endpoint(process.env.FIREBASE_AUTH_EMULATOR_HOST), firestore: endpoint(process.env.FIRESTORE_EMULATOR_HOST), storage: endpoint(process.env.FIREBASE_STORAGE_EMULATOR_HOST) }, features: { projects: true } }; }
function loginHtml() { return `<!doctype html><meta charset="utf-8"><script src="https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js"></script><script src="https://www.gstatic.com/firebasejs/9.22.0/firebase-auth-compat.js"></script><script>(async()=>{const p=await(await fetch('/api/config')).json();firebase.initializeApp(p.config);firebase.auth().useEmulator('http://'+p.emulators.auth.host+':'+p.emulators.auth.port,{disableWarnings:true});await firebase.auth().signInWithEmailAndPassword(new URLSearchParams(location.search).get('email'),${JSON.stringify(h.PASSWORD)});location.replace('/crm-admin.html#projects')})().catch(e=>document.body.textContent=e.message)</script>`; }
async function mountShell(c) {
    const authMiddleware = async (req, res, next) => { try { req.user = await c.auth.verifyIdToken(String(req.headers.authorization || '').replace(/^Bearer /, '')); next(); } catch (_) { res.status(401).json({ success: false }); } };
    const currentAdmin = async uid => (await c.db.collection('users').doc(uid).get()).data()?.isAdmin === true;
    const adminMiddleware = async (req, res, next) => { if (await currentAdmin(req.user.uid)) next(); else res.status(403).json({ success: false, error: 'ADMIN_REQUIRED' }); };
    c.api.use('/api/admin', createCrmRouter({ identity: require('../../../functions/src/studentIdentity'), db: c.db, authMiddleware, adminMiddleware, resolveAdminStatus: async ({ req }) => ({ isAdmin: await currentAdmin(req.user.uid), uid: req.user.uid }), serverTimestamp: () => new Date() }));
    c.api.get('/api/config', (_req, res) => res.json(configuration()));
    c.api.get('/favicon.ico', (_req, res) => res.status(204).end());
    c.api.get('/__role-view-login', (_req, res) => res.type('html').send(loginHtml()));
    c.api.get('/crm-admin.html', (_req, res) => { const doc = buildLocalCrmAdminDocument(fs.readFileSync(path.join(ROOT, 'public/crm-admin.html'), 'utf8'), process.env, 'demo-crm-projects'); res.setHeader('Content-Security-Policy', doc.policy); res.setHeader('Cache-Control', 'no-store'); res.type('html').send(doc.html); });
    c.api.use(express.static(path.join(ROOT, 'public')));
}
async function pair(page, predicate, action) {
    const pending = page.waitForResponse(predicate, { timeout: TIMEOUT });
    const settled = await Promise.allSettled([pending, Promise.resolve().then(action)]);
    const failures = settled.map((entry, index) => ({ entry, label: ['response', 'action'][index] })).filter(({ entry }) => entry.status === 'rejected');
    if (failures.length) throw new AggregateError(failures.map(({ entry }) => entry.reason), failures.map(({ entry, label }) => `${label}: ${entry.reason?.stack || entry.reason}`).join('\n'));
    const response = settled[0].value;
    assert.equal(response.status(), 200, `${response.request().method()} ${new URL(response.url()).pathname}`);
    return { status: response.status(), body: await response.json() };
}
const matches = (suffix, method = 'GET') => response => response.request().method() === method && new URL(response.url()).pathname === `/api/projects/${PROJECT}${suffix}`;
async function idle(page) {
    await page.waitForFunction(id => window.projectsViewsController?.getState()?.response?.project?.id === id && document.getElementById('projects-view-status')?.textContent === '' && document.getElementById('projects-board-section')?.getAttribute('aria-busy') === 'false', PROJECT, { timeout: TIMEOUT });
}
async function login(page, url, actor) {
    await page.goto(`${url}/__role-view-login?email=${encodeURIComponent(actor.email)}`, { waitUntil: 'domcontentloaded' });
    await page.waitForURL(/crm-admin.html#projects$/);
    await page.waitForFunction(uid => window.firebase?.auth?.().currentUser?.uid === uid, actor.uid, { timeout: TIMEOUT });
    if (actor.role === 'Unauthorized') {
        await page.getByText('Access denied.', { exact: true }).waitFor();
    } else {
        await page.waitForFunction(() => document.getElementById('crm-loading')?.style.display === 'none' && document.getElementById('btn-projects-access-refresh')?.disabled === false, null, { timeout: TIMEOUT });
    }
}
async function record(name, action) {
    const entry = { name, passed: false }; report.cases.push(entry);
    try { Object.assign(entry, await action()); entry.passed = true; }
    catch (error) { entry.error = error.stack; throw error; }
    finally { fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2)); }
}
async function direct(c, actor, suffix, method = 'GET', body) {
    const token = await c.token(actor.key);
    const requestPath = `/api/projects/${PROJECT}${suffix}`;
    const response = await h.request(c.server, requestPath, token, { method, signal: AbortSignal.timeout(TIMEOUT), ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    report.network.push({ actor: actor.role, transport: 'direct HTTP', method, path: requestPath, status: response.status });
    return response;
}
async function assertDeniedWrite(c, actor, status) {
    const before = await c.data(TASK);
    const response = await direct(c, actor, `/tasks/${TASK}`, 'PATCH', { operationId: `denied-${PROJECT}-${actor.uid}`, expectedRevision: before.revision, title: `Forbidden ${actor.role}` });
    assert.equal(response.status, status, JSON.stringify(response.body));
    assert.equal(response.body.success, false);
    assert.deepEqual(await c.data(TASK), before, 'Denied PATCH must preserve the entire persisted task');
    return response.status;
}
async function main() {
    h.assertDedicatedEmulators();
    assert.equal(fs.existsSync(OUT), false, 'Archive prior role-view evidence before running; never overwrite it');
    fs.mkdirSync(OUT, { recursive: true });
    report.sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
    let c, browser, failure;
    try {
        c = await h.bootPhase5(PROJECT);
        await c.configure();
        await h.task(c, TASK, { title: 'Role view canonical task', status: 'in_progress', startDate: '2026-09-08', dueDate: '2026-09-10', ownerUid: c.uids.owner, assigneeUids: [c.uids.editor] });
        await mountShell(c);
        const url = `http://127.0.0.1:${c.server.address().port}`;
        browser = await chromium.launch({ channel: 'chrome', headless: true });
        for (const actor of actors) {
            const context = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
            context.setDefaultTimeout(TIMEOUT); context.setDefaultNavigationTimeout(TIMEOUT);
            const page = await context.newPage();
            let actorFailure;
            page.on('pageerror', error => report.pageErrors.push({ actor: actor.role, message: error.message }));
            page.on('console', message => { if (message.type() === 'error') report.console.push({ actor: actor.role, text: message.text() }); });
            page.on('response', response => { const parsed = new URL(response.url()); if (parsed.origin === url && parsed.pathname.startsWith('/api/projects')) report.network.push({ actor: actor.role, transport: 'Chrome', path: parsed.pathname, method: response.request().method(), status: response.status() }); });
            try {
                const member = await c.db.collection(PROJECT_COLLECTIONS.members).doc(memberDocumentId(PROJECT, actor.uid)).get();
                if (actor.denied) {
                    await record(`${actor.role}: no fixture membership, picker content or direct project access`, async () => {
                        assert.equal(member.exists, false);
                        if (actor.role === 'Admin nonmember') assert.equal((await c.db.collection('users').doc(actor.uid).get()).data().isAdmin, true);
                        await login(page, url, actor);
                        assert.equal(await page.locator(`#projects-board-project-select option[value="${PROJECT}"]`).count(), 0);
                        assert.equal(await page.locator(`[data-task-id="${TASK}"]`).count(), 0);
                        const statuses = {};
                        for (const suffix of ['', '/tasks', '/views', '/calendar?fromDate=2026-09-01&toDate=2026-09-30']) {
                            const response = await direct(c, actor, suffix);
                            assert.equal(response.status, actor.denied, JSON.stringify(response.body));
                            assert.equal(response.body.success, false); statuses[suffix || 'project'] = response.status;
                        }
                        statuses.patch = await assertDeniedWrite(c, actor, actor.denied);
                        return { role: actor.role, membership: null, pickerContainsFixture: false, statuses, persistedTaskUnchanged: true };
                    });
                    continue;
                }
                assert.equal(member.exists, true); assert.equal(member.data().role, actor.role);
                await login(page, url, actor);
                await page.locator(`#projects-board-project-select option[value="${PROJECT}"]`).waitFor({ state: 'attached' });
                await page.locator('#projects-board-project-select').selectOption(PROJECT); await idle(page);
                await page.locator('#projects-view-tabs [data-view="board"]').click();
                const row = page.locator(`[data-row-kind="task"][data-task-id="${TASK}"]`);
                await row.focus(); await row.press('Enter');
                await page.locator('#projects-task-schedule').waitFor();
                assert.equal(await page.locator('#projects-board-detail-body dl').filter({ has: page.locator('dt', { hasText: /^Task ID$/ }) }).locator('dd').textContent(), TASK);
                for (const view of ['board', 'kanban', 'timeline', 'calendar', 'charts']) {
                    await record(`${actor.role}: ${view} authorized read and task control permissions`, async () => {
                        await page.locator(`#projects-view-tabs [data-view="${view}"]`).click();
                        if (view === 'calendar') { await page.locator('#projects-view-month').fill('2026-09'); await page.locator('#projects-view-month').press('Tab'); }
                        await idle(page);
                        const snapshot = await pair(page, matches('/views'), () => page.locator('#projects-view-filters button[type="submit"]').click());
                        await idle(page);
                        assert.equal(snapshot.body.membership.role, actor.role);
                        assert.equal(snapshot.body.project.id, PROJECT);
                        assert.ok(snapshot.body.tasks.some(task => task.id === TASK));
                        assert.equal(await page.locator(`#projects-view-tabs [data-view="${view}"]`).getAttribute('aria-pressed'), 'true');
                        const writable = actor.role !== 'Viewer';
                        const controls = {};
                        if (view === 'board') {
                            await row.waitFor();
                            assert.equal(await page.locator('#btn-projects-board-add-task').isEnabled(), writable);
                            controls.addTask = writable ? 'enabled' : 'disabled';
                            const title = row.locator('input[data-field-kind="title"]');
                            if (writable) { assert.equal(await title.isEnabled(), true); controls.inlineTitle = 'enabled'; }
                            else { assert.equal(await title.count(), 0); controls.inlineTitle = 'absent'; }
                        } else if (view === 'charts') {
                            assert.match(await page.locator('#projects-view-content').innerText(), /0 of 1 active leaf tasks/);
                            assert.ok(await page.locator('#projects-view-content meter').count() > 0);
                        } else {
                            await page.locator(`#projects-view-content [data-task-open="${TASK}"]`).first().waitFor();
                            if (view === 'kanban') { assert.equal(await page.locator(`[data-task-status="${TASK}"]`).isEnabled(), writable); controls.status = writable ? 'enabled' : 'disabled'; }
                            if (view === 'timeline') assert.ok(await page.locator('.crm-projects-gantt-bar').count() > 0);
                            if (view === 'calendar') {
                                await page.waitForFunction(() => /calendar/i.test(document.getElementById('projects-calendar-view-provenance')?.textContent || ''), null, { timeout: TIMEOUT });
                                assert.ok(report.network.some(event => event.actor === actor.role && event.transport === 'Chrome' && event.path === `/api/projects/${PROJECT}/calendar` && event.status === 200));
                            }
                        }
                        await page.locator('#projects-task-schedule').waitFor();
                        for (const selector of ['#projects-task-start', '#projects-task-due', '#projects-task-schedule button[type="submit"]', '#projects-task-predecessors', '#projects-task-dependencies button[type="submit"]']) {
                            assert.equal(await page.locator(selector).isEnabled(), writable, `${actor.role} ${view} ${selector}`);
                            controls[selector] = writable ? 'enabled' : 'disabled';
                        }
                        return { role: actor.role, view, readStatus: snapshot.status, canonicalTaskId: TASK, controls };
                    });
                }
                if (actor.role === 'Viewer') {
                    await record('Viewer direct mutation denied with persisted task unchanged', async () => ({ role: actor.role, status: await assertDeniedWrite(c, actor, 403), persistedTaskUnchanged: true }));
                } else {
                    await record(`${actor.role}: permitted task edit persists through the Board UI`, async () => {
                        await page.locator('#projects-view-tabs [data-view="board"]').click(); await idle(page);
                        const title = `Saved by ${actor.role}`;
                        const saved = await pair(page, matches(`/tasks/${TASK}`, 'PATCH'), async () => { await row.locator('input[data-field-kind="title"]').fill(title); await row.locator('input[data-field-kind="title"]').blur(); });
                        assert.equal((await c.data(TASK)).title, title);
                        return { role: actor.role, status: saved.status, persistedTitle: title };
                    });
                }
            } catch (error) { actorFailure = error; throw error; }
            finally {
                try { await context.close(); }
                catch (error) { report.cleanupErrors.push({ resource: `${actor.role} context`, error: error.stack }); if (!actorFailure) throw error; }
            }
        }
        assert.deepEqual(report.pageErrors, []);
        assert.equal(report.cases.length, 20);
        report.passed = true;
    } catch (error) { failure = error; report.error = error.stack; }
    finally {
        for (const [resource, close] of [['browser', () => browser?.close()], ['fixture', () => c?.close()]]) {
            try { await close(); } catch (error) { report.cleanupErrors.push({ resource, error: error.stack }); if (!failure) failure = error; }
        }
        if (failure) report.passed = false;
        report.finishedAt = new Date().toISOString();
        fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
    }
    if (failure) throw failure;
    console.log(JSON.stringify({ passed: report.passed, cases: report.cases.length, report: path.join(OUT, 'report.json') }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
