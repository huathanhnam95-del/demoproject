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
const PROJECT = 'nonvoice-calendar-browser';
const ARTIFACTS = path.join(ROOT, 'test-results/crm-projects/nonvoice-calendar-browser');
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

async function main() {
    h.assertDedicatedEmulators(); fs.readFileSync('C:/Cursor AI/.local/browser-test-credentials.md', 'utf8');
    fs.mkdirSync(ARTIFACTS, { recursive: true });
    const c = await h.bootPhase5(PROJECT); let browser;
    try {
        await c.db.collection('users').doc(c.uids.owner).update({ isAdmin: true });
        await c.configure(); await h.task(c, 'fixture-base', { title: 'fixture-base' });
        const prototype = await c.data('fixture-base'); await c.taskRef('fixture-base').delete();
        const batch = c.db.batch();
        for (let i=0; i<205; i++) batch.set(c.taskRef(`a-${String(i).padStart(3,'0')}`), { ...prototype, title:`January ${i}`, startDate:'2026-01-01', dueDate:'2026-01-02' });
        batch.set(c.taskRef('z-september'), { ...prototype, title:'September boundary target', startDate:'2026-08-31', dueDate:'2026-09-01' });
        batch.set(c.taskRef('z-october'), { ...prototype, title:'October target', startDate:'2026-10-02', dueDate:'2026-10-03' });
        await batch.commit(); assert.strictEqual((await c.projectRef.collection('tasks').get()).size,207);
        await mountShell(c); const url=`http://127.0.0.1:${c.server.address().port}`;
        browser=await chromium.launch({channel:'chrome',headless:true});
        const page=await browser.newPage({viewport:{width:1440,height:1000}});
        page.on('pageerror',e=>result.pageErrors.push(e.message));
        await open(page,url);
        await page.locator('[data-view="kanban"]').click(); await idle(page);
        assert.strictEqual(await page.locator('[data-task-open="z-september"]').count(),0,'target is beyond first canonical page');
        await page.locator('[data-view="calendar"]').click();
        await page.locator('#projects-view-month').fill('2026-09'); await idle(page);
        await page.locator('[data-task-open="z-september"]').first().waitFor();
        assert.strictEqual(await page.evaluate(()=>window.projectsViewsController.getState().response.matchingTaskCount),1);
        assert.strictEqual(await page.locator('[data-view-task]').count(),1);
        await page.screenshot({path:path.join(ARTIFACTS,'september-complete.png'),fullPage:true});
        result.cases.push('September interval crossing boundary found beyond original page');
        await page.locator('#projects-view-month').fill('2026-01'); await idle(page);
        assert.strictEqual(await page.evaluate(()=>window.projectsViewsController.getState().response.matchingTaskCount),205);
        await page.locator('#projects-view-more').click(); await idle(page);
        assert.strictEqual(await page.locator('[data-view-task]').count(),5);
        await page.locator('#projects-view-month').fill('2026-10'); await idle(page);
        await page.locator('[data-task-open="z-october"]').first().waitFor();
        assert.strictEqual(await page.locator('#projects-view-previous').isDisabled(),true);
        result.cases.push('Month pagination reaches all205 records and resets when month changes');
        await page.locator('[data-view="kanban"]').click(); await idle(page);
        assert.strictEqual(await page.evaluate(()=>window.projectsViewsController.getState().response.matchingTaskCount),207);
        await page.reload({waitUntil:'networkidle'}); await chooseProject(page);
        await page.locator('[data-view="calendar"]').click(); await page.locator('#projects-view-month').fill('2026-09'); await idle(page);
        await page.locator('[data-task-open="z-september"]').first().waitFor();
        assert.strictEqual((await c.data('z-september')).dueDate,'2026-09-01');
        assert.deepStrictEqual(result.pageErrors,[]); result.cases.push('Canonical scope restored, persisted reload retained target, no runtime errors');
        result.passed=true;
    } finally { if(browser) await browser.close(); await c.close(); fs.writeFileSync(path.join(ARTIFACTS,'report.json'),JSON.stringify(result,null,2)); }
    console.log(JSON.stringify(result,null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
