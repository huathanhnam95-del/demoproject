'use strict';
// Chrome acceptance uses real emulator Auth, Firestore, production Projects/CRM
// route handlers and the shipped shell. No controller or response mocks.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { chromium } = require('playwright');
const h = require('../../crm/projects/phase5-test-helpers');
const createCrmRouter = require('../../../functions/src/routes/admin/create-crm-router');
const { buildLocalCrmAdminDocument } = require('../../../src/server/app');
const ROOT = path.resolve(__dirname, '../../..');
const PROJECT = 'phase5-browser';
const SECOND = 'phase5-browser-second';
const TASK = 'p5-canonical';
const PARENT = 'p5-parent';
const PREDECESSOR = 'p5-predecessor';
const CRM = { lead: 'p5-browser-lead', student: 'p5-browser-student', classroom: 'p5-browser-classroom' };
const LABEL = { lead: 'Phase5 canonical lead', student: 'Phase5 canonical student', classroom: 'Phase5 canonical classroom' };
const ARTIFACTS = path.join(ROOT, 'test-results/crm-projects/phase5-browser');
const result = { cases: [], screenshots: [], network: [], console: [], pageErrors: [], persisted: {}, startedAt: new Date().toISOString() };
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
    c.api.get('/__phase5-login', (_req, res) => res.type('html').send(loginHtml()));
    c.api.get('/crm-admin.html', (_req, res) => { const doc = buildLocalCrmAdminDocument(fs.readFileSync(path.join(ROOT, 'public/crm-admin.html'), 'utf8'), process.env, 'demo-crm-projects'); res.setHeader('Content-Security-Policy', doc.policy); res.setHeader('Cache-Control', 'no-store'); res.type('html').send(doc.html); });
    c.api.use(express.static(path.join(ROOT, 'public')));
}
async function seed(c) {
    await c.db.collection('users').doc(c.uids.owner).update({ isAdmin: true });
    await c.db.collection('users').doc(c.uids.viewer).update({ isAdmin: true });
    await c.configure();
    await h.task(c, PARENT, { title: 'Stored parent', status: 'blocked', startDate: '2026-01-01', dueDate: '2026-12-31' });
    await h.createTask(c, TASK, { title: 'Phase5 target', parentTaskId: PARENT, ownerUid: c.uids.owner, assigneeUids: [c.uids.editor], status: 'in_progress', startDate: '2026-09-07', dueDate: '2026-09-09' });
    await h.task(c, PREDECESSOR, { title: 'Phase5 predecessor', status: 'done', startDate: '2026-09-03', dueDate: '2026-09-04' });
    const prototype = await c.data(PREDECESSOR);
    let batch = c.db.batch();
    for (let i = 0; i < 620; i++) { const id = `p5-bulk-${String(i).padStart(4, '0')}`; batch.set(c.taskRef(id), { ...prototype, id, title: `Bulk task ${String(i).padStart(4, '0')}`, sectionId: i % 2 ? 's1' : 's2', status: ['not_started','in_progress','blocked','done'][i % 4], ownerUid: i % 3 ? (i % 3 === 1 ? c.uids.owner : c.uids.editor) : null, startDate: null, dueDate: null, order: i * 1000 }); if (i === 399) { await batch.commit(); batch = c.db.batch(); } }
    await batch.commit();
    for (const [type, id] of Object.entries(CRM)) await c.db.collection({ lead: 'crmLeads', student: 'crmStudents', classroom: 'crmClassrooms' }[type]).doc(id).set({ name: LABEL[type], status: 'active', ...(type === 'student' ? { crmId: 'pbb0001', email: 'p5-student@demo.crm-projects.test' } : {}) });
    await h.clearProject(c.db, SECOND);
    const other = { ...c, projectId: SECOND };
    await h.createProject(other); await h.addMember(other, 'viewer', 'Viewer'); await h.createSection(other, 's1', 'Second section', 0); await h.createTask(other, 'p5-second-task', { sectionId: 's1', title: 'Second project isolated task' });
    return { parent: await c.data(PARENT), total: 623, leaves: 622, done: 156 };
}

function throwSettlementFailures(label, entries) {
    const failures = entries.filter((entry) => entry.result.status === 'rejected');
    if (!failures.length) return;
    if (failures.length === 1) throw failures[0].result.reason;
    const causes = failures.map((entry) => entry.result.reason);
    const detail = failures.map((entry) => entry.name + ': ' + (entry.result.reason?.stack || entry.result.reason)).join('\n');
    const aggregate = new AggregateError(causes, label + ' failed\n' + detail);
    aggregate.causes = failures.map((entry) => ({ name: entry.name, error: entry.result.reason }));
    throw aggregate;
}

async function responseAction(page, method, suffix, action, status = 200) {
    page.setDefaultTimeout(30000);
    const pending = page.waitForResponse(r => r.request().method() === method && new URL(r.url()).pathname.endsWith(suffix), { timeout: 30000 });
    const settled = await Promise.allSettled([
        pending,
        Promise.resolve().then(action)
    ]);
    throwSettlementFailures(method + ' ' + suffix, [
        { name: 'response', result: settled[0] },
        { name: 'action', result: settled[1] }
    ]);
    const response = settled[0].value;
    const body = await response.json();
    assert.strictEqual(response.status(), status, method + ' ' + suffix + ': ' + JSON.stringify(body));
    return body;
}
async function idle(page) { await page.waitForFunction(() => window.projectsViewsController?.getState()?.response && document.getElementById('projects-view-status')?.textContent === '', null, { timeout: 30000 }); }
async function chooseProject(page, id = PROJECT) {
    // An earlier suite may leave an inactive default project. The picker is
    // outside its workspace; select our fixture after Access finishes loading.
    await page.waitForFunction(id => {
        const picker = document.getElementById('projects-board-project-select');
        const access = document.getElementById('btn-projects-access-refresh');
        return document.getElementById('crm-loading')?.style.display === 'none'
            && window.projectsViewsController && picker && !picker.disabled && access && !access.disabled
            && Array.from(picker.options).some(option => option.value === id);
    }, id);
    await page.locator('#projects-board-project-select').selectOption(id);
    await page.waitForFunction(id => window.projectsViewsController?.getState()?.response?.project?.id === id, id);
    await page.waitForSelector('#projects-board-workspace:not([hidden])'); await idle(page);
}
async function open(page, url, role = 'owner') { await page.goto(`${url}/__phase5-login?email=${encodeURIComponent(h.USERS[role])}`, { waitUntil: 'domcontentloaded' }); await page.waitForURL(/crm-admin.html#projects$/); await chooseProject(page); }
async function view(page, name) { await page.locator(`#projects-view-tabs [data-view="${name}"]`).click(); await idle(page); assert.strictEqual(await page.locator(`#projects-view-tabs [data-view="${name}"]`).getAttribute('aria-pressed'), 'true'); }
async function filter(page, title = '') { for (const name of ['sectionId', 'status', 'ownerUid', 'assigneeUid']) await page.locator(`#projects-view-filters select[name="${name}"]`).selectOption(''); for (const name of ['fromDate', 'toDate']) await page.locator(`#projects-view-filters input[name="${name}"]`).fill(''); await page.locator('#projects-view-filters input[name="title"]').fill(title); await responseAction(page, 'GET', `/${PROJECT}/views`, () => page.locator('#projects-view-filters button[type="submit"]').click()); await idle(page); }

async function filterWithBoardContext(page, title) {
    page.setDefaultTimeout(30000);
    const expectedPath = '/api/projects/' + encodeURIComponent(PROJECT) + '/tasks';
    const boardTasksResponse = page.waitForResponse(response => {
        const url = new URL(response.url());
        if (response.request().method() !== 'GET' || url.pathname !== expectedPath || url.searchParams.get('includeAncestorContext') !== 'true') return false;
        try { return JSON.parse(url.searchParams.get('filters') || '{}').title === title; } catch (_) { return false; }
    }, { timeout: 30000 });
    const settled = await Promise.allSettled([
        boardTasksResponse,
        Promise.resolve().then(() => filter(page, title))
    ]);
    throwSettlementFailures('filterWithBoardContext', [
        { name: 'board tasks response', result: settled[0] },
        { name: 'filter action', result: settled[1] }
    ]);
    const response = settled[0].value;
    assert.strictEqual(response.status(), 200, 'Filtered Board tasks read must succeed');
    const payload = await response.json();
    const parent = (payload.tasks || []).find(task => task.id === PARENT);
    assert.ok(parent, 'Filtered Board tasks response must include the retained parent context row');
    assert.strictEqual(parent.contextOnly, true, 'Filtered Board tasks response must mark the retained parent as contextOnly');
}
async function selectTask(page, taskId = TASK) { await view(page, 'kanban'); await page.locator(`[data-task-open="${taskId}"]`).first().click(); await page.locator('[data-detail-tab="details"]').click(); await page.locator('#projects-task-schedule').waitFor(); await page.waitForFunction(id => window.projectsViewsController?.getState()?.selectedTaskId === id, taskId); assert.match(await page.locator('#projects-board-detail-body').innerText(), new RegExp(taskId)); }
async function screenshot(page, name) { const file = path.join(ARTIFACTS, `${name}.png`); await page.screenshot({ path: file, fullPage: true }); result.screenshots.push(file); }
async function caseRun(name, action) { try { await action(); result.cases.push({ name, passed: true }); process.stdout.write(`PASS ${name}\n`); } catch (e) { result.cases.push({ name, passed: false, error: e.stack }); process.stderr.write(`FAIL ${name}: ${e.stack}\n`); } finally { fs.writeFileSync(path.join(ARTIFACTS, 'report.json'), JSON.stringify(result, null, 2)); } }
async function lookupLink(page, level, type = 'lead') { const project = level === 'project'; const prefix = project ? 'projects-project-link' : 'projects-link'; await page.locator(`#${prefix}-type`).selectOption(type); await page.locator(`#${prefix}-query`).fill('Phase5 canonical'); await responseAction(page, 'GET', `/${PROJECT}/crm-link-options`, () => page.locator(`#${prefix}-lookup button`).click()); await page.locator(`#${prefix}-options button`).filter({ hasText: LABEL[type] }).waitFor(); }
async function saveLink(page, level, type = 'lead') { await lookupLink(page, level, type); const prefix = level === 'project' ? 'projects-project-link' : 'projects-link'; await responseAction(page, 'PATCH', level === 'project' ? `/${PROJECT}/links` : `/${TASK}/links`, () => page.locator(`#${prefix}-options button`).filter({ hasText: LABEL[type] }).click()); await idle(page); await page.locator(level === 'project' ? '#projects-project-links' : '#projects-task-links').getByText(`${LABEL[type]} (${type})`, { exact: false }).first().waitFor(); }
async function main() {
    h.assertDedicatedEmulators(); fs.readFileSync('C:/Cursor AI/.local/browser-test-credentials.md', 'utf8');
    fs.mkdirSync(ARTIFACTS, { recursive: true });
    const c = await h.bootPhase5(PROJECT); let browser; const releases = [];
    try {
        const oracle = await seed(c); await mountShell(c); const url = `http://127.0.0.1:${c.server.address().port}`;
        browser = await chromium.launch({ channel: 'chrome', headless: true });
        const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } }); const page = await ctx.newPage();
        page.on('console', m => { if (m.type() === 'error') result.console.push({ text: m.text(), url: m.location().url }); });
        page.on('pageerror', e => result.pageErrors.push({ message: e.message, stack: e.stack }));
        page.on('response', r => { if (r.url().includes('/api/projects/')) result.network.push({ url: r.url(), method: r.request().method(), status: r.status() }); });
        await open(page, url);
        await caseRun('full server counts, bounded Chrome pages and canonical aggregate oracle', async () => {
            await view(page, 'kanban'); const seen = new Set();
            do { await idle(page); const data = await page.evaluate(() => window.projectsViewsController.getState().response); assert.strictEqual(data.matchingTaskCount, oracle.total); assert.strictEqual(data.aggregates.activeLeafTaskCount, oracle.leaves); assert.strictEqual(data.aggregates.completedLeafTaskCount, oracle.done); assert.ok(data.tasks.length <= 200); assert.strictEqual(await page.locator('[data-view-task]').count(), data.tasks.length); for (const task of data.tasks) { assert.ok(!seen.has(task.id), 'duplicate page task'); seen.add(task.id); } if (!data.hasMore) break; await responseAction(page, 'GET', `/${PROJECT}/views`, () => page.locator('#projects-view-more').click()); } while (seen.size <= oracle.total);
            assert.strictEqual(seen.size, oracle.total); assert.strictEqual(await page.locator('#projects-view-more').isDisabled(), true);
            await view(page, 'charts'); assert.match(await page.locator('#projects-view-content').innerText(), /156 of 622 active leaf tasks/); assert.match(await page.locator('#projects-view-content').innerText(), /Unassigned/); await screenshot(page, 'full-population-charts');
        });
        await caseRun('shared filters and canonical selection across all five views with Gantt and calendar', async () => {
            await filterWithBoardContext(page, 'Phase5');
            for (const name of ['board','kanban','timeline','calendar','charts']) { await view(page, name); assert.strictEqual(await page.locator('#projects-view-filters input[name="title"]').inputValue(), 'Phase5'); assert.match(await page.locator('#projects-view-summary').innerText(), /^2 matching tasks/); if (name === 'board') { const parent = page.locator(`#projects-board-rows [data-task-id="${PARENT}"]`); await parent.waitFor({ state: 'visible' }); await parent.locator('.crm-projects-context').waitFor({ state: 'visible' }); assert.match(await parent.innerText(), /context/i); const expander = parent.locator('.crm-board-expander'); if (await expander.getAttribute('aria-expanded') !== 'true') await expander.click(); await page.locator(`[data-task-id="${TASK}"]`).first().click(); } else if (name !== 'charts') { if (name === 'calendar') await page.locator('#projects-view-month').fill('2026-09'); await page.locator(`[data-task-open="${TASK}"]`).first().click(); } if (name !== 'charts') assert.match(await page.locator('#projects-board-detail-body').innerText(), new RegExp(TASK)); if (name === 'timeline') { assert.ok(await page.locator('.crm-projects-gantt-axis time').count() >= 2); assert.ok(await page.locator('.crm-projects-gantt-bar').count() >= 2); assert.strictEqual(await page.locator(`[data-view-task="${TASK}"] .is-derived`).count(), 0, 'leaf must not repeat its stored interval as derived'); await screenshot(page, 'gantt'); } if (name === 'calendar') { await page.locator('#projects-calendar-view-provenance').getByText(/Vietnam calendar/).waitFor(); await screenshot(page, 'calendar'); } }
            assert.deepStrictEqual(await c.data(PARENT), oracle.parent, 'view projections must not persist derived parent values');
            await filter(page, 'Stored parent'); await view(page, 'timeline'); const row = page.locator(`[data-view-task="${PARENT}"]`); assert.match(await row.innerText(), /2026-01-01.*2026-12-31/); assert.match(await row.innerText(), /2026-09-07.*2026-09-09/); assert.strictEqual(await row.locator('.is-derived').count(), 1); const storedBar = await row.locator('.crm-projects-gantt-bar:not(.is-derived)').boundingBox(); const derivedBar = await row.locator('.is-derived').boundingBox(); assert.ok(storedBar && derivedBar && storedBar.y + storedBar.height <= derivedBar.y, 'stored and derived bar tracks do not overlap'); assert.strictEqual(await row.locator('.crm-projects-gantt-bar:not(.is-derived)').innerText(), ''); await row.scrollIntoViewIfNeeded(); await page.locator('.crm-projects-gantt').screenshot({ path: path.join(ARTIFACTS, 'gantt-readable-crop.png') }); result.screenshots.push(path.join(ARTIFACTS, 'gantt-readable-crop.png')); await screenshot(page, 'stored-versus-derived');
        });
        await caseRun('all shared filter controls survive every view switch', async () => {
            const expected = { title: 'Phase5 target', sectionId: 's1', status: 'in_progress', ownerUid: c.uids.owner, assigneeUid: c.uids.editor, fromDate: '2026-09-08', toDate: '2026-09-09' };
            for (const [name, value] of Object.entries(expected)) {
                const field = page.locator(`#projects-view-filters [name="${name}"]`);
                if (['sectionId', 'status', 'ownerUid', 'assigneeUid'].includes(name)) await field.selectOption(value);
                else await field.fill(value);
            }
            await responseAction(page, 'GET', `/${PROJECT}/views`, () => page.locator('#projects-view-filters button[type="submit"]').click()); await idle(page);
            try { for (const name of ['board', 'kanban', 'timeline', 'calendar', 'charts']) {
                await view(page, name);
                for (const [field, value] of Object.entries(expected)) assert.strictEqual(await page.locator(`#projects-view-filters [name="${field}"]`).inputValue(), value, `${name} retains ${field}`);
                assert.match(await page.locator('#projects-view-summary').innerText(), /^1 matching tasks/);
            }
            } finally { await responseAction(page, 'GET', `/${PROJECT}/views`, () => page.locator('#projects-view-filters button[type="reset"]').click()); await idle(page); }
        });
        await caseRun('canonical status, exact schedule preview, apply, reload and discussion continuity', async () => {
            await filter(page, 'Phase5'); await selectTask(page); await page.locator('#projects-board-discussion-input').fill('Phase5 draft survives view mutations');
            await responseAction(page, 'PATCH', `/tasks/${TASK}`, () => page.locator(`[data-task-status="${TASK}"]`).selectOption('done')); await idle(page); assert.strictEqual((await c.data(TASK)).status, 'done');
            await selectTask(page); const before = await c.data(TASK); await page.locator('#projects-task-start').fill('2026-09-10'); await page.locator('#projects-task-due').fill('2026-09-14'); const p = await responseAction(page, 'POST', '/schedule-preview', () => page.locator('#projects-task-schedule button').click()); assert.strictEqual(p.preview.canApply, true); assert.deepStrictEqual(await c.data(TASK), before, 'preview cannot mutate'); assert.match(await page.locator('#projects-task-preview').innerText(), /2026-09-10.*2026-09-14/);
            await responseAction(page, 'POST', '/schedule-apply', () => page.locator('#projects-task-apply').click()); await idle(page); const saved = await c.data(TASK); assert.strictEqual(saved.startDate, '2026-09-10'); assert.strictEqual(saved.dueDate, '2026-09-14'); result.persisted.canonical = saved;
            assert.strictEqual(await page.locator('#projects-board-discussion-input').inputValue(), 'Phase5 draft survives view mutations'); await page.reload({ waitUntil: 'networkidle' }); await chooseProject(page); await filter(page, 'Phase5'); await selectTask(page); assert.strictEqual(await page.locator('#projects-task-start').inputValue(), '2026-09-10'); assert.strictEqual(await page.locator(`[data-task-status="${TASK}"]`).inputValue(), 'done'); assert.strictEqual(await page.locator('#projects-board-discussion-input').inputValue(), '', 'full document reload clears in-memory draft');
        });
        await caseRun('real predecessor picker, cycle rejection and canonical Undo', async () => {
            await filter(page, 'Phase5'); await selectTask(page); await page.locator('#projects-task-predecessor-picker').selectOption(PREDECESSOR); await page.locator('#projects-task-predecessor-add').click(); assert.strictEqual(await page.locator('#projects-task-predecessors').inputValue(), PREDECESSOR); await responseAction(page, 'PATCH', `/${TASK}/dependencies`, () => page.locator('#projects-task-dependencies button[type="submit"]').click()); await idle(page); assert.deepStrictEqual((await c.data(TASK)).predecessorTaskIds, [PREDECESSOR]);
            await selectTask(page, PREDECESSOR); await page.locator('#projects-task-predecessor-picker').selectOption(TASK); await page.locator('#projects-task-predecessor-add').click(); const response = page.waitForResponse(r => r.request().method() === 'PATCH' && r.url().includes(`/${PREDECESSOR}/dependencies`)); await page.locator('#projects-task-dependencies button[type="submit"]').click(); assert.ok([400,409].includes((await response).status())); assert.match(await page.locator('#projects-task-status').innerText(), /cycle/i); assert.deepStrictEqual((await c.data(PREDECESSOR)).predecessorTaskIds || [], []);
            await page.locator('summary[data-recovery-toggle]').click(); await responseAction(page, 'GET', `/${PROJECT}/history`, () => page.locator('[data-recovery-history]').click()); const undo = page.locator('[data-recovery-history-list] li').filter({ hasText: 'updateTaskDependencies' }).first().locator('[data-undo]'); await responseAction(page, 'POST', '/undo', () => undo.click()); assert.deepStrictEqual((await c.data(TASK)).predecessorTaskIds || [], []);
        });
        await caseRun('project picker without task plus task picker save/read/remove persistence', async () => {
            await page.reload({ waitUntil: 'networkidle' }); await chooseProject(page); assert.strictEqual(await page.evaluate(() => window.projectsViewsController.getState().selectedTaskId), undefined); await saveLink(page, 'project');
            await filter(page, 'Phase5'); await selectTask(page); await saveLink(page, 'task'); await saveLink(page, 'task', 'student');
            await page.reload({ waitUntil: 'networkidle' }); await chooseProject(page); await page.locator('#projects-project-links').getByText(LABEL.lead, { exact: false }).first().waitFor(); assert.match(await page.locator('#projects-project-links').innerText(), new RegExp(LABEL.lead)); await filter(page, 'Phase5'); await selectTask(page); await page.locator('#projects-task-links').getByText(LABEL.lead, { exact: false }).first().waitFor(); assert.match(await page.locator('#projects-task-links').innerText(), new RegExp(LABEL.lead));
            await responseAction(page, 'PATCH', `/${TASK}/links`, () => page.locator('#projects-task-links li').filter({ hasText: LABEL.lead }).locator('[data-link-remove]').click()); await idle(page); assert.ok(!(await c.get(`/tasks/${TASK}/links`)).body.links.some(l => l.type === 'lead'));
            await responseAction(page, 'PATCH', `/${PROJECT}/links`, () => page.locator('[data-project-link-remove]').first().click()); await idle(page); assert.deepStrictEqual((await c.get('/links')).body.links, []); await saveLink(page, 'project', 'student');
        });
        await caseRun('student link uses actual gated CRM student handler and exact profile', async () => {
            await filter(page, 'Phase5'); await selectTask(page); await responseAction(page, 'GET', `/students/${CRM.student}`, () => page.locator('[data-student-link]').first().click()); await page.locator('#crm-student-modal').waitFor({ state: 'visible' }); assert.strictEqual(await page.locator('#lead-name').inputValue(), LABEL.student); result.studentNavigation = { hash: await page.evaluate(() => location.hash), studentId: await page.evaluate(() => window._currentStudentModalId) }; assert.strictEqual(result.studentNavigation.hash, '#students/pbb0001'); assert.strictEqual(result.studentNavigation.studentId, CRM.student); await page.locator('#btn-close-student-modal').click();
        });
        await caseRun('Viewer authorized read-only links then independent CRM revocation clears metadata', async () => {
            // Independent fixture prerequisites; do not cascade a prior UI case failure.
            h.expectStatus(await c.send('/links', { operationId: 'p5-viewer-project-link-fixture', expectedRevision: (await c.revision()).revision, links: [{ type: 'student', recordId: CRM.student }] }), 200);
            h.expectStatus(await c.send(`/tasks/${TASK}/links`, { operationId: 'p5-viewer-task-link-fixture', expectedRevision: (await c.data(TASK)).revision, links: [{ type: 'student', recordId: CRM.student }] }), 200);
            const viewerContext = await browser.newContext(); const vp = await viewerContext.newPage(); await open(vp, url, 'viewer'); await filter(vp, 'Phase5'); await selectTask(vp); await vp.locator('#projects-task-links').getByText(LABEL.student, { exact: false }).first().waitFor(); await vp.locator('#projects-project-links').getByText(LABEL.student, { exact: false }).first().waitFor(); assert.match(await vp.locator('#projects-project-links').innerText(), new RegExp(LABEL.student)); assert.strictEqual(await vp.locator('#projects-project-link-lookup').count(), 0); assert.strictEqual(await vp.locator('#projects-link-lookup').count(), 0); assert.strictEqual(await vp.locator('[data-link-remove]').first().isDisabled(), true);
            await c.db.collection('users').doc(c.uids.viewer).update({ isAdmin: false }); await vp.locator('#btn-projects-board-refresh').click(); await idle(vp); await vp.waitForFunction(() => !document.getElementById('projects-task-links').textContent.includes('Phase5 canonical student') && !document.getElementById('projects-project-links').textContent.includes('Phase5 canonical student')); h.noSecrets(await vp.locator('#projects-views').innerText() + await vp.locator('#projects-project-links').innerText() + await vp.locator('#projects-task-links').innerText(), [...Object.values(CRM), ...Object.values(LABEL)]); await viewerContext.close();
        });
        // Restore the primary project after independent Viewer verification.
        await open(page, url);
        await caseRun('admin inclusive leave and explicit cleared employer choice survives reload', async () => {
            await page.locator('#projects-calendar-leave-date').fill('2026-09-15'); await page.locator('#projects-calendar-leave-end').fill('2026-09-17'); await page.locator('#btn-projects-calendar-leave-add').click(); await responseAction(page, 'PATCH', '/projects/calendar', () => page.locator('#btn-projects-calendar-save').click()); const saved = (await c.calendarRef.get()).data(); assert.ok(saved.leaves.some(l => l.startDate === '2026-09-15' && l.endDate === '2026-09-17'));
            await page.locator('#projects-calendar-tet').selectOption(''); await page.locator('#projects-calendar-national').selectOption(''); await responseAction(page, 'PATCH', '/projects/calendar', () => page.locator('#btn-projects-calendar-save').click()); await page.reload({ waitUntil: 'networkidle' }); await chooseProject(page); assert.strictEqual(await page.locator('#projects-calendar-tet').inputValue(), ''); assert.strictEqual(await page.locator('#projects-calendar-national').inputValue(), ''); const data = (await c.calendarRef.get()).data(); assert.ok(!data.holidayChoices?.['2026']?.tetScheme); assert.ok(!data.holidayChoices?.['2026']?.nationalDayAdjacent); result.persisted.calendar = data;
            await filter(page, 'Phase5'); await selectTask(page); const preview = await responseAction(page, 'POST', '/schedule-preview', () => page.locator('#projects-task-schedule button').click()); assert.strictEqual(preview.preview.canApply, false); assert.strictEqual(await page.locator('#projects-task-apply').isDisabled(), true); await c.configure();
        });
        // Hold a genuine server result, then exercise the real switch control.
        // Completion is bounded and route cancellation is observed rather than
        // letting a canceled Playwright route become an unhandled rejection.
        const heldResponse = async (pattern, trigger, switchScope, verify) => {
            let release, announce, finishResponse, handled = false;
            const delivered = new Promise(resolve => { finishResponse = resolve; });
            const blocked = new Promise(resolve => { release = resolve; });
            const captured = new Promise(resolve => { announce = resolve; });
            releases.push(release);
            const handler = async route => {
                if (handled) return route.continue();
                handled = true;
                const response = await route.fetch();
                announce(); await blocked;
                try { await route.fulfill({ response }); }
                catch (e) { if (!/already handled|closed|disposed/i.test(e.message)) throw e; }
                finally { finishResponse(); }
            };
            await page.route(pattern, handler);
            try {
                await trigger();
                await Promise.race([captured, new Promise((_, reject) => setTimeout(() => reject(new Error('Expected request was not captured')), 15000))]);
                await switchScope(); release(); await delivered;
                await page.waitForTimeout(100); await verify();
            } finally { release(); await page.unroute(pattern, handler); }
        };
        await caseRun('held views cannot paint after project switch', async () => {
            await chooseProject(page); await filter(page, 'Phase5'); await selectTask(page);
            await heldResponse(`**/api/projects/${PROJECT}/views?**`,
                () => page.locator('#btn-projects-board-refresh').click(),
                () => chooseProject(page, SECOND), async () => {
                    assert.strictEqual(await page.evaluate(() => window.projectsViewsController.getState().response.project.id), SECOND);
                    assert.ok(!(await page.locator('#projects-view-content').innerText()).includes('Phase5 target'));
                    assert.strictEqual(await page.locator('#projects-task-apply').count(), 0);
                    await screenshot(page, 'scope-isolation');
                });
        });
        for (const level of ['project', 'task']) await caseRun(`held ${level} picker options cannot paint after project switch`, async () => {
            await chooseProject(page); await filter(page, 'Phase5'); await selectTask(page);
            const prefix = level === 'project' ? 'projects-project-link' : 'projects-link';
            await page.locator(`#${prefix}-query`).fill('Phase5 canonical');
            await heldResponse(`**/api/projects/${PROJECT}/crm-link-options?**`,
                () => page.locator(`#${prefix}-lookup button`).click(),
                () => chooseProject(page, SECOND), async () => {
                    assert.ok(!(await page.locator('#projects-project-links').innerText()).includes(LABEL.lead));
                    assert.strictEqual(await page.locator('#projects-link-options button').count(), 0);
                    assert.strictEqual(await page.locator('#projects-project-link-options button').count(), 0);
                });
        });
        await caseRun('held schedule preview cannot apply after project switch', async () => {
            await chooseProject(page); await filter(page, 'Phase5'); await selectTask(page);
            await heldResponse(`**/api/projects/${PROJECT}/schedule-preview`,
                () => page.locator('#projects-task-schedule button').click(),
                () => chooseProject(page, SECOND), async () => { assert.strictEqual(await page.locator('#projects-task-apply').count(), 0); });
        });
        await caseRun('held project links cannot survive an actual Auth account switch', async () => {
            await chooseProject(page); await filter(page, 'Phase5'); await selectTask(page);
            await heldResponse(`**/api/projects/${PROJECT}/links`,
                () => page.locator('#btn-projects-board-refresh').click(),
                async () => {
                    await page.evaluate(async ({ email, password }) => { await firebase.auth().signInWithEmailAndPassword(email, password); }, { email: h.USERS.viewer, password: h.PASSWORD }).catch(e => { if (!/context.*destroyed|navigation/i.test(e.message)) throw e; });
                    await page.waitForFunction(uid => window.firebase?.apps?.length > 0 && window.firebase.auth().currentUser?.uid === uid, c.uids.viewer);
                    await page.waitForFunction(uid => window.projectsViewsController?.getState()?.actorUid === uid, c.uids.viewer);
                }, async () => {
                    h.noSecrets(await page.locator('#projects-project-links').innerText(), [...Object.values(CRM), ...Object.values(LABEL)]);
                    assert.strictEqual(await page.locator('#projects-project-link-lookup').count(), 0);
                });
        });
        await caseRun('membership revocation clears Board and Access even after delayed full/member responses', async () => {
            for (const readType of ['full', 'member']) {
                const membershipContext = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
                const mp = await membershipContext.newPage();
                mp.on('pageerror', e => result.pageErrors.push({ message: e.message, stack: e.stack }));
                mp.on('response', r => { if (r.url().includes('/api/projects/')) result.network.push({ context: `revocation-${readType}`, url: r.url(), method: r.request().method(), status: r.status() }); });
                const member = await c.db.collection('crmProjectMembers').doc(require('../../../functions/src/crm/projects/access-service').memberDocumentId(PROJECT, c.uids.viewer)).get();
                assert.ok(member.exists, 'canonical Viewer membership fixture must exist');
                const savedMember = member.data();
                let release, announce, deliveredResolve, handled = false;
                const barrier = new Promise(resolve => { release = resolve; }); releases.push(release);
                const captured = new Promise(resolve => { announce = resolve; });
                const delivered = new Promise(resolve => { deliveredResolve = resolve; });
                const pattern = readType === 'full' ? '**/api/projects/access' : `**/api/projects/${PROJECT}/member-directory`;
                try {
                    await open(mp, url, 'viewer'); await filter(mp, 'Phase5'); await selectTask(mp);
                    await mp.locator('#projects-project-select').selectOption(PROJECT);
                    await mp.locator(`#projects-members-list .crm-stack-item[data-uid="${c.uids.owner}"]`).waitFor();
                    await mp.route(pattern, async route => {
                        if (handled) return route.continue(); handled = true;
                        const response = await route.fetch(); announce(); await barrier;
                        try { await route.fulfill({ response }); }
                        catch (error) { if (!/handled|closed|disposed/i.test(error.message)) throw error; }
                        finally { deliveredResolve(); }
                    });
                    if (readType === 'full') await mp.locator('#btn-projects-access-refresh').click();
                    else await mp.locator('#projects-project-select').selectOption(PROJECT);
                    await Promise.race([captured, new Promise((_, reject) => setTimeout(() => reject(new Error(`Missing ${readType} response barrier`)), 15000))]);
                    await member.ref.delete();
                    const denied = mp.waitForResponse(r => r.url().includes(`/${PROJECT}/views?`) && r.status() === 404);
                    await mp.locator('#btn-projects-board-refresh').click(); await denied;
                    await mp.waitForFunction(() => !window.projectsViewsController?.getState()?.response, null, { timeout: 10000 });
                    release(); await delivered; await mp.waitForTimeout(100);
                    const evidence = await mp.evaluate(() => ({
                        viewProject: window.projectsViewsController?.getState()?.response?.project?.id || null,
                        taskIds: [...document.querySelectorAll('[data-task-open]')].map(e => e.dataset.taskOpen),
                        taskDetailVisible: !!document.querySelector('#projects-task-schedule'),
                        boardOptions: [...document.querySelectorAll('#projects-board-project-select option')].map(e => e.value),
                        accessOptions: [...document.querySelectorAll('#projects-project-select option')].map(e => e.value),
                        memberUids: [...document.querySelectorAll('#projects-members-list [data-uid]')].map(e => e.dataset.uid),
                        links: document.getElementById('projects-project-links')?.textContent || ''
                    }));
                    result[`revocation-${readType}`] = evidence;
                    await screenshot(mp, `membership-revoked-${readType}`);
                    assert.strictEqual(evidence.viewProject, null);
                    assert.deepStrictEqual(evidence.taskIds, []);
                    assert.strictEqual(evidence.taskDetailVisible, false);
                    assert.ok(!evidence.boardOptions.includes(PROJECT));
                    assert.ok(!evidence.accessOptions.includes(PROJECT));
                    assert.deepStrictEqual(evidence.memberUids, []);
                    h.noSecrets(evidence.links, [...Object.values(CRM), ...Object.values(LABEL)]);
                } finally { release(); await member.ref.set(savedMember); await membershipContext.close(); }
            }
        });
        await caseRun('no unexpected JavaScript exceptions', async () => { assert.deepStrictEqual(result.pageErrors, []); assert.deepStrictEqual(result.network.filter(r => r.status >= 500), [], 'no Projects server errors'); });
    } finally {
        for (const release of releases) release();
        result.finishedAt = new Date().toISOString(); result.passed = result.cases.filter(c => c.passed).length; fs.writeFileSync(path.join(ARTIFACTS, 'report.json'), JSON.stringify(result, null, 2));
        const cleanup = async (label, fn) => { let timer; try { await Promise.race([fn(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} cleanup timed out`)), 5000); })]); } catch (e) { process.stderr.write(e.stack + '\n'); process.exitCode = 1; } finally { clearTimeout(timer); } };
        if (browser) await cleanup('Chrome', () => browser.close()); c.server.closeAllConnections?.(); await cleanup('fixture', () => c.close());
    }
    process.stdout.write(JSON.stringify({ passed: result.passed, cases: result.cases.length, report: path.join(ARTIFACTS, 'report.json') }) + '\n'); if (result.cases.some(c => !c.passed)) process.exitCode = 1;
}
main().catch(e => { process.stderr.write(e.stack + '\n'); process.exitCode = 1; });
