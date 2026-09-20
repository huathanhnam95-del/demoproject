'use strict';

const assert = require('assert');
const express = require('express');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');
const { DEMO_PROJECT_ID, getEmulatorConfig } = require('../../../scripts/crm/projects/emulator-config');
const { initializeFixtureApp, seedFixtures } = require('../../../scripts/crm/projects/seed-fixtures');
const createProjectsRouter = require('../../../functions/src/routes/crm/projects');
const { buildLocalCrmAdminDocument } = require('../../../src/server/app');
const { runPhase3BoardExpandedChecks } = require('./phase3-board-expanded-check');

const ROOT = path.resolve(__dirname, '../../..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const PASSWORD = 'Phase0-only-password!123';
const PROJECT_ID = `phase3-board-${Date.now()}`;
const USERS = Object.freeze({ teacher: 'teacher@demo.crm-projects.test', viewer: 'viewer@demo.crm-projects.test', editor: 'staff-editor@demo.crm-projects.test' });
const ROLE_UIDS = Object.freeze({ viewer: 'crm-projects-viewer', editor: 'crm-projects-staff-editor' });

async function selectFixtureProject(page) {
    await page.waitForFunction(id => {
        const picker = document.getElementById('projects-board-project-select');
        return picker && !picker.disabled && !document.getElementById('btn-projects-access-refresh')?.disabled
            && Array.from(picker.options).some(option => option.value === id);
    }, PROJECT_ID);
    await page.evaluate(id => {
        const picker = document.getElementById('projects-board-project-select');
        picker.value = id;
        picker.dispatchEvent(new Event('change', { bubbles: true }));
    }, PROJECT_ID);
    await page.waitForFunction(id => window.projectsViewsController?.getState()?.response?.project?.id === id, PROJECT_ID);
    await page.locator('[data-view="board"]').click();
    await page.waitForFunction(() => document.getElementById('projects-board-section')?.getAttribute('aria-busy') === 'false');
}

function parseEndpoint(value) {
    const [host, port] = String(value || '').split(':');
    return { host, port: Number(port) };
}

function isProjectsRequest(url) {
    const pathname = new URL(url).pathname;
    return pathname === '/api/projects' || pathname.startsWith('/api/projects/');
}

function buildConfig() {
    const auth = parseEndpoint(process.env.FIREBASE_AUTH_EMULATOR_HOST);
    const firestore = parseEndpoint(process.env.FIRESTORE_EMULATOR_HOST);
    return {
        success: true,
        config: { apiKey: 'demo-key', authDomain: `${DEMO_PROJECT_ID}.firebaseapp.com`, projectId: DEMO_PROJECT_ID, storageBucket: `${DEMO_PROJECT_ID}.appspot.com`, messagingSenderId: '000000000000', appId: '1:000000000000:web:crmprojectsphase3' },
        emulators: { auth, firestore },
        features: { projects: true }
    };
}

function loginPage() {
    return `<!doctype html><meta charset="utf-8"><title>Phase3 login</title>
<script src="https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js"></script><script src="https://www.gstatic.com/firebasejs/9.22.0/firebase-auth-compat.js"></script>
<script>(async function(){const response=await fetch('/api/config');const payload=await response.json();if(!firebase.apps.length)firebase.initializeApp(payload.config);firebase.auth().useEmulator('http://'+payload.emulators.auth.host+':'+payload.emulators.auth.port,{disableWarnings:true});const email=new URLSearchParams(location.search).get('email');await firebase.auth().signInWithEmailAndPassword(email,${JSON.stringify(PASSWORD)});location.replace('/crm-admin.html#projects');}()).catch(error=>{document.body.textContent='LOGIN_FAILED:'+error.message;});</script>`;
}

async function signIn(email) {
    const endpoint = process.env.FIREBASE_AUTH_EMULATOR_HOST;
    const response = await fetch(`http://${endpoint}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD, returnSecureToken: true }) });
    const body = await response.json();
    if (!response.ok) throw new Error(`Auth emulator sign-in failed: ${JSON.stringify(body)}`);
    return body.idToken;
}

function bearerToken(req) {
    const value = String(req.headers.authorization || '');
    return value.startsWith('Bearer ') ? value.slice(7).trim() : '';
}

async function apiRequest(server, requestPath, token, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`http://127.0.0.1:${server.address().port}${requestPath}`, { ...options, headers });
    const text = await response.text();
    let body;
    try { body = JSON.parse(text); } catch (_) { body = { raw: text }; }
    return { status: response.status, body };
}

function jsonHeaders() { return { 'content-type': 'application/json' }; }

async function main() {
    assert.strictEqual(process.env.CRM_PROJECTS_EMULATOR_READY, '1', 'Phase3 browser checks require isolated emulators.');
    const config = getEmulatorConfig(process.env);
    const presentationV2 = process.env.CRM_PROJECTS_V2_PRESENTATION === 'true';
    const app = initializeFixtureApp(config);
    const previousFlag = process.env.CRM_PROJECTS_ENABLED;
    process.env.CRM_PROJECTS_ENABLED = 'true';
    const auth = app.auth();
    const db = app.firestore();
    let server;
    let browser;
    const consoleErrors = [];
    const consoleErrorRecords = [];
    const pageErrorRecords = [];
    const requestLog = [];
    const responseLog = [];
    const requestFailed = [];
    const allResponseLog = [];
    const allRequestFailed = [];
    const dialogLog = [];
    const expectedStaleCursorUrls = [];
    const redactUrl = (url) => String(url || '').replace(/[?&](token|access_token|idToken)=[^&]*/gi, '$1=[redacted]');
    const expectedTypedTaskPath = `/api/projects/${PROJECT_ID}-1-typed-project/tasks/${PROJECT_ID}-5-typed-task`;
    const expectedConsoleRecord = (entry) => {
        let pathname = '';
        try { pathname = new URL(entry.url).pathname; } catch (_) { return false; }
        const text = String(entry.text || '');
        if ((pathname === '/api/admin/status' || pathname === '/api/teacher/status') && /status of 404/i.test(text)) return true;
        if (/status of 409/i.test(text) && expectedStaleCursorUrls.includes(entry.url)) return true;
        return pathname === expectedTypedTaskPath && (/status of (403|409)/i.test(text) || /net::ERR_FAILED/i.test(text));
    };
    const writeConsoleNetworkArtifact = () => {
        const expected = consoleErrorRecords.filter(expectedConsoleRecord);
        const artifact = {
            consoleErrors: consoleErrors.slice(),
            consoleErrorRecords: consoleErrorRecords.map((entry) => ({ ...entry, url: redactUrl(entry.url) })),
            expectedConsoleErrors: expected.map((entry) => ({ ...entry, url: redactUrl(entry.url) })),
            unexpectedConsoleErrors: consoleErrorRecords.filter((entry) => !expectedConsoleRecord(entry)).map((entry) => ({ ...entry, url: redactUrl(entry.url) })),
            pageErrorRecords: pageErrorRecords.slice(),
            allResponseLog: allResponseLog.map((entry) => ({ ...entry, url: redactUrl(entry.url) })),
            allRequestFailed: allRequestFailed.map((entry) => ({ ...entry, url: redactUrl(entry.url) }))
        };
        fs.writeFileSync(path.join(ROOT, 'test-results/crm-projects/phase3-board-console-network.json'), `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
    };
    try {
        await seedFixtures({ config, app });
        await db.collection('crmProjects').doc(PROJECT_ID).set({name: 'Phase3 board isolated run', status: 'active', ownerUid: 'crm-projects-teacher', membershipRevision: 1});
        for (const [uid, role] of [['crm-projects-teacher', 'Owner'], ['crm-projects-staff-editor', 'Editor'], ['crm-projects-viewer', 'Viewer']]) {
            const id = Buffer.from(JSON.stringify([PROJECT_ID, uid]), 'utf8').toString('base64url');
            await db.collection('crmProjectMembers').doc(id).set({projectId: PROJECT_ID, uid, role, active: true});
        }
        const ownerToken = await signIn(USERS.teacher);
        const api = express();
        api.use(express.json());
        api.get('/api/config', (_req, res) => res.json(buildConfig()));
        api.get('/api/admin/status', (_req, res) => res.status(404).json({ success: false, error: 'NOT_FOUND' }));
        api.get('/api/teacher/status', (_req, res) => res.status(404).json({ success: false, error: 'NOT_FOUND' }));
        api.get('/favicon.ico', (_req, res) => res.status(204).end());
        api.use('/api/admin', async (req, res, next) => {
            try {
                const token = bearerToken(req);
                const identity = await auth.verifyIdToken(token);
                const profile = await db.collection('users').doc(identity.uid).get();
                if (!profile.exists || profile.data()?.isAdmin !== true) return res.status(403).json({ success: false, error: 'FORBIDDEN' });
                next();
            } catch (_) { res.status(401).json({ success: false, error: 'UNAUTHORIZED' }); }
        });
        api.get('/api/admin/accounts', (_req, res) => res.json({ success: true, accounts: [] }));
        api.get('/api/admin/teachers', (_req, res) => res.json({ success: true, teachers: [] }));
        api.use('/api/projects', createProjectsRouter({ db, auth }));
        const rawHtml = fs.readFileSync(path.join(PUBLIC_DIR, 'crm-admin.html'), 'utf8');
        api.get('/crm-admin.html', (_req, res) => {
            const document = buildLocalCrmAdminDocument(rawHtml, process.env, DEMO_PROJECT_ID);
            if (process.env.CRM_PROJECTS_V2_PRESENTATION === 'true') {
                document.html = document.html.replace(
                    'window.__CRM_PRESENTATION_CONFIG__ = Object.freeze({ projectsV2: false });',
                    'window.__CRM_PRESENTATION_CONFIG__ = Object.freeze({ projectsV2: true });'
                );
            }
            res.setHeader('Content-Security-Policy', document.policy);
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.type('html').send(document.html);
        });
        api.use(express.static(PUBLIC_DIR));
        api.get('/__phase3-login', (_req, res) => res.type('html').send(loginPage()));
        server = http.createServer(api);
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

        let structureRevision = 0;
        let schemaRevision = 0;
        let response = await apiRequest(server, `/api/projects/${PROJECT_ID}/sections`, ownerToken, { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ operationId: PROJECT_ID + '-phase3-section-one', sectionId: 'phase3-section-one', title: 'Launch', index: 0, expectedStructureRevision: structureRevision }) });
        assert.strictEqual(response.status, 200, JSON.stringify(response.body));
        structureRevision = response.body.structureRevision;
        response = await apiRequest(server, `/api/projects/${PROJECT_ID}/sections`, ownerToken, { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ operationId: PROJECT_ID + '-phase3-section-two', sectionId: 'phase3-section-two', title: 'Later', index: 1, expectedStructureRevision: structureRevision }) });
        assert.strictEqual(response.status, 200, JSON.stringify(response.body));
        structureRevision = response.body.structureRevision;
        response = await apiRequest(server, `/api/projects/${PROJECT_ID}/columns`, ownerToken, { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ operationId: PROJECT_ID + '-phase3-column-one', columnId: 'phase3-priority', type: 'priority', label: 'Priority', index: 0, expectedSchemaRevision: schemaRevision }) });
        assert.strictEqual(response.status, 200, JSON.stringify(response.body));
        schemaRevision = response.body.schemaRevision;
        response = await apiRequest(server, `/api/projects/${PROJECT_ID}/tasks`, ownerToken, { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ operationId: PROJECT_ID + '-phase3-task-one', taskId: 'phase3-task-one', title: 'Draft brief', sectionId: 'phase3-section-one', status: 'in_progress', expectedStructureRevision: structureRevision }) });
        assert.strictEqual(response.status, 200, JSON.stringify(response.body));
        structureRevision = response.body.structureRevision;
        response = await apiRequest(server, `/api/projects/${PROJECT_ID}/tasks`, ownerToken, { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ operationId: PROJECT_ID + '-phase3-task-two', taskId: 'phase3-task-two', title: 'Review brief', sectionId: 'phase3-section-one', expectedStructureRevision: structureRevision }) });
        assert.strictEqual(response.status, 200, JSON.stringify(response.body));
        structureRevision = response.body.structureRevision;
        response = await apiRequest(server, `/api/projects/${PROJECT_ID}/tasks`, ownerToken, { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ operationId: PROJECT_ID + '-phase3-child-one', taskId: 'phase3-child-one', title: 'Collect examples', parentTaskId: 'phase3-task-one', expectedStructureRevision: structureRevision }) });
        assert.strictEqual(response.status, 200, JSON.stringify(response.body));

        browser = await chromium.launch({ channel: 'chrome', headless: true });
        const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
        const page = await context.newPage();
        page.on('pageerror', (error) => { pageErrorRecords.push({ message: error.message }); consoleErrors.push(error.message); });
        page.on('console', (message) => {
            if (message.type() !== 'error') return;
            const location = message.location?.() || {};
            consoleErrorRecords.push({ text: message.text(), url: location.url || '', line: location.lineNumber ?? null, column: location.columnNumber ?? null });
            consoleErrors.push(message.text());
        });
        page.on('request', (request) => { if (isProjectsRequest(request.url())) requestLog.push({ method: request.method(), url: request.url(), body: request.postDataJSON?.() }); });
        page.on('response', (response) => {
            allResponseLog.push({ method: response.request().method(), url: response.url(), status: response.status() });
            if (isProjectsRequest(response.url())) responseLog.push({ method: response.request().method(), url: response.url(), status: response.status() });
        });
        page.on('requestfailed', (request) => {
            const failure = { method: request.method(), url: request.url(), failure: request.failure()?.errorText || '' };
            allRequestFailed.push(failure);
            if (isProjectsRequest(request.url())) requestFailed.push(failure);
        });
        page.on('dialog', (dialog) => { dialogLog.push({ type: dialog.type(), message: dialog.message(), defaultValue: dialog.defaultValue() }); });
        const baseUrl = `http://127.0.0.1:${server.address().port}`;
        await page.goto(`${baseUrl}/__phase3-login?email=${encodeURIComponent(USERS.teacher)}`, { waitUntil: 'domcontentloaded' });
        await page.waitForURL(/crm-admin\.html#projects$/, { timeout: 30000 });
        await page.waitForFunction(() => document.getElementById('crm-loading')?.style.display === 'none', null, { timeout: 30000 });
        await selectFixtureProject(page);
        await page.waitForSelector('#projects-board-workspace:not([hidden])', { timeout: 30000 });
        await page.waitForSelector('[data-task-id="phase3-task-one"]', { timeout: 30000 });
        assert.ok(await page.locator('[data-task-id="phase3-task-one"] .crm-board-field[data-field-kind="status"]').count());
        const baseExpansionGeometry = await page.evaluate(() => {
            const table = document.getElementById('projects-board-table');
            const header = document.getElementById('projects-board-header');
            const rows = document.getElementById('projects-board-rows');
            const scroll = document.getElementById('projects-board-scroll');
            const describe = (element) => {
                if (!element) return null;
                const rect = element.getBoundingClientRect();
                const style = getComputedStyle(element);
                return {
                    id: element.id || '',
                    taskId: element.dataset?.taskId || '',
                    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, top: rect.top, bottom: rect.bottom },
                    display: style.display,
                    position: style.position,
                    gridTemplateColumns: style.gridTemplateColumns,
                    gridTemplateRows: style.gridTemplateRows,
                    minHeight: style.minHeight,
                    height: style.height,
                    padding: style.padding,
                    overflow: style.overflow,
                    zIndex: style.zIndex
                };
            };
            const one = document.querySelector('[data-task-id="phase3-task-one"]');
            const two = document.querySelector('[data-task-id="phase3-task-two"]');
            const expander = one?.querySelector('.crm-board-expander');
            const expanderRect = expander?.getBoundingClientRect();
            const point = expanderRect ? document.elementFromPoint(expanderRect.x + expanderRect.width / 2, expanderRect.y + expanderRect.height / 2) : null;
            return {
                stylesheets: Array.from(document.styleSheets).map((sheet) => sheet.href || 'inline'),
                table: describe(table),
                header: describe(header),
                rows: describe(rows),
                scroll: describe(scroll),
                one: describe(one),
                oneCells: Array.from(one?.querySelectorAll('[role="cell"]') || []).map(describe),
                expander: describe(expander),
                two: describe(two),
                twoCells: Array.from(two?.querySelectorAll('[role="cell"]') || []).map(describe),
                hit: point ? { tag: point.tagName, id: point.id || '', taskId: point.closest?.('[data-task-id]')?.dataset?.taskId || '', className: point.className || '' } : null
            };
        });
        fs.writeFileSync(path.join(ROOT, 'test-results/crm-projects/phase3-board-base-geometry.json'), `${JSON.stringify(baseExpansionGeometry, null, 2)}\n`, 'utf8');
        await page.screenshot({ path: path.join(ROOT, 'test-results/crm-projects/phase3-board-base-geometry.png'), fullPage: true });
        await page.locator('[data-task-id="phase3-task-one"] .crm-board-expander').click();
        await page.waitForSelector('[data-task-id="phase3-child-one"]', { timeout: 30000 });
        assert.strictEqual(await page.locator('#projects-board-detail').isHidden(), true);
        const taskOneRow = page.locator('[role="row"][data-task-id="phase3-task-one"]');
        const explicitRename = await taskOneRow.locator('.crm-board-title-button').count() > 0;
        if (explicitRename) await taskOneRow.locator('.crm-board-title-button').click();
        else await taskOneRow.press('Enter');
        assert.strictEqual(await page.locator('#projects-board-detail').isVisible(), true);
        if (!presentationV2) {
            await page.locator('#btn-projects-board-close-detail').click();
            await page.waitForFunction(() => !document.getElementById('projects-board-detail')?.open);
        }
        if (explicitRename) await taskOneRow.press('F2');
        const title = explicitRename
            ? page.locator('[role="row"][data-task-id="phase3-task-one"] input[data-field-kind="title"]')
            : page.locator('[data-task-id="phase3-task-one"] input[data-field-kind="title"]');
        const titleSaveResponse = page.waitForResponse((candidate) => {
            if (!candidate.url().includes('/tasks/phase3-task-one') || candidate.request().method() !== 'PATCH') return false;
            try { return candidate.request().postDataJSON()?.title === 'Draft brief revised'; } catch (_) { return false; }
        });
        await title.fill('Draft brief revised');
        if (explicitRename) await title.press('Enter');
        else await title.blur();
        const titleSave = await titleSaveResponse;
        assert.strictEqual(titleSave.status(), 200, 'title save must be acknowledged');
        assert.strictEqual(titleSave.request().postDataJSON()?.title, 'Draft brief revised', 'title save must carry the current draft');
        response = await apiRequest(server, `/api/projects/${PROJECT_ID}/tasks?pageSize=200&filters=${encodeURIComponent(JSON.stringify({ parentScope: 'root' }))}`, ownerToken);
        assert.strictEqual(response.status, 200);
        assert.strictEqual(response.body.tasks.find((task) => task.id === 'phase3-task-one').title, 'Draft brief revised');
        const beforeCreate = requestLog.filter((entry) => entry.method === 'POST' && entry.url.endsWith('/tasks')).length;
        const createTaskResponse = page.waitForResponse((candidate) => candidate.url().endsWith('/tasks') && candidate.request().method() === 'POST');
        await page.locator('#btn-projects-board-add-task').click();
        if (explicitRename) {
            await page.locator('[data-quick-create] input').fill('Authenticated V2 task');
            const section = page.locator('[data-quick-create] select');
            if (!await section.inputValue()) {
                const firstSection = await section.locator('option:not([value=""])').first().getAttribute('value');
                await section.selectOption(firstSection);
            }
            await page.evaluate(() => document.querySelector('[data-quick-create]').requestSubmit());
        }
        const createdTaskResponse = await createTaskResponse;
        let createdTask = null;
        if (presentationV2) {
            assert.strictEqual(createdTaskResponse.status(), 200, 'quick create must be acknowledged');
            const createdBody = await createdTaskResponse.json();
            createdTask = createdBody?.task || createdBody?.result?.task || null;
            assert.ok(createdTask?.id, 'quick create must return a persisted task identity');
            assert.strictEqual(createdTask.title, 'Authenticated V2 task');
        }
        const afterCreate = requestLog.filter((entry) => entry.method === 'POST' && entry.url.endsWith('/tasks')).length;
        assert.strictEqual(afterCreate, beforeCreate + 1, 'one Add task click must create one command');
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.getElementById('crm-loading')?.style.display === 'none', null, { timeout: 30000 });
        await selectFixtureProject(page);
        await page.waitForSelector('[data-task-id="phase3-task-one"]', { timeout: 30000 });
        if (presentationV2) {
            assert.strictEqual(await page.locator('[role="row"][data-task-id="phase3-task-one"] .crm-board-title-button').textContent(), 'Draft brief revised');
            await page.waitForSelector(`[role="row"][data-task-id="${createdTask.id}"]`, { timeout: 30000 });
            assert.strictEqual(await page.locator(`[role="row"][data-task-id="${createdTask.id}"] .crm-board-title-button`).textContent(), 'Authenticated V2 task');
        } else {
            assert.strictEqual(await page.locator('[data-task-id="phase3-task-one"] input[data-field-kind="title"]').inputValue(), 'Draft brief revised');
        }
        await page.screenshot({ path: path.join(ROOT, 'test-results/crm-projects/phase3-board-owner.png'), fullPage: true });

        let expandedCounter = 0;
        const expanded = presentationV2 ? null : await runPhase3BoardExpandedChecks({
            page,
            server,
            browser,
            baseUrl,
            projectId: PROJECT_ID,
            ownerToken,
            requestLog,
            responseLog,
            requestFailed,
            consoleErrors,
            consoleErrorRecords,
            pageErrorRecords,
            expectedStaleCursorUrls,
            dialogLog,
            apiRequest,
            signIn,
            roleTokens: {
                viewer: await signIn(USERS.viewer),
                editor: await signIn(USERS.editor)
            },
            roleUids: ROLE_UIDS,
            artifactDir: path.join(ROOT, 'test-results/crm-projects'),
            idPrefix: 'phase3-expanded',
            nextId: (suffix) => `${PROJECT_ID}-${++expandedCounter}-${String(suffix).replace(/[^a-z0-9-]/gi, '-')}`.slice(0, 90),
            openRolePage: async (role) => {
                const roleContext = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
                const rolePage = await roleContext.newPage();
                rolePage.on('pageerror', (error) => { pageErrorRecords.push({ message: error.message }); consoleErrors.push(error.message); });
                rolePage.on('console', (message) => {
                    if (message.type() !== 'error') return;
                    const location = message.location?.() || {};
                    consoleErrorRecords.push({ text: message.text(), url: location.url || '', line: location.lineNumber ?? null, column: location.columnNumber ?? null });
                    consoleErrors.push(message.text());
                });
                rolePage.on('response', (response) => {
                    allResponseLog.push({ method: response.request().method(), url: response.url(), status: response.status() });
                });
                rolePage.on('requestfailed', (request) => {
                    allRequestFailed.push({ method: request.method(), url: request.url(), failure: request.failure()?.errorText || '' });
                });
                await rolePage.goto(`${baseUrl}/__phase3-login?email=${encodeURIComponent(USERS[role])}`, { waitUntil: 'domcontentloaded' });
                await rolePage.waitForURL(/crm-admin\.html#projects$/, { timeout: 30000 });
                await rolePage.waitForFunction(() => document.getElementById('crm-loading')?.style.display === 'none', null, { timeout: 30000 });
                await selectFixtureProject(rolePage);
                await rolePage.waitForSelector('#projects-board-workspace:not([hidden])', { timeout: 30000 });
                return rolePage;
            },
            closeRolePage: async (rolePage) => rolePage.context().close()
        });
        if (presentationV2) {
            process.stdout.write('crm projects authenticated V2 owner workflow settled; this noncanonical smoke run excludes the legacy expanded matrix.\n');
        } else {
            assert.strictEqual(expanded?.typed?.columns?.length, 7, 'expanded Phase3 matrix must exercise all seven typed columns.');
            process.stdout.write(`crm projects Phase3 expanded Chrome cases settled: ${JSON.stringify({
                pagination: expanded.pagination?.boundedRows,
                totalRows: expanded.pagination?.total,
                rolesSkipped: expanded.roleResult?.skippedRolePages === true
            })}\n`);
        }

        const viewerContext = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
        const viewerPage = await viewerContext.newPage();
        viewerPage.on('pageerror', (error) => { pageErrorRecords.push({ message: error.message }); consoleErrors.push(error.message); });
        viewerPage.on('console', (message) => {
            if (message.type() !== 'error') return;
            const location = message.location?.() || {};
            consoleErrorRecords.push({ text: message.text(), url: location.url || '', line: location.lineNumber ?? null, column: location.columnNumber ?? null });
            consoleErrors.push(message.text());
        });
        viewerPage.on('response', (response) => {
            allResponseLog.push({ method: response.request().method(), url: response.url(), status: response.status() });
        });
        viewerPage.on('requestfailed', (request) => {
            allRequestFailed.push({ method: request.method(), url: request.url(), failure: request.failure()?.errorText || '' });
        });
        await viewerPage.goto(`${baseUrl}/__phase3-login?email=${encodeURIComponent(USERS.viewer)}`, { waitUntil: 'domcontentloaded' });
        await viewerPage.waitForURL(/crm-admin\.html#projects$/, { timeout: 30000 });
        await viewerPage.waitForFunction(() => document.getElementById('crm-loading')?.style.display === 'none', null, { timeout: 30000 });
        await selectFixtureProject(viewerPage);
        await viewerPage.waitForSelector('[data-task-id="phase3-task-one"]', { timeout: 30000 });
        assert.strictEqual(await viewerPage.locator('#btn-projects-board-add-task').isDisabled(), true);
        assert.strictEqual(await viewerPage.locator('[data-task-id="phase3-task-one"] input[data-field-kind="title"]').count(), 0);
        await viewerPage.screenshot({ path: path.join(ROOT, 'test-results/crm-projects/phase3-board-viewer.png'), fullPage: true });
        await viewerContext.close();
        writeConsoleNetworkArtifact();
        if (!presentationV2) {
            const typedTaskResponses = allResponseLog.filter((entry) => entry.method === 'PATCH' && entry.url.includes(expectedTypedTaskPath));
            assert.ok(typedTaskResponses.some((entry) => entry.status === 403), 'expected typed task Viewer downgrade denial must be observed as an exact 403 response.');
            assert.ok(typedTaskResponses.some((entry) => entry.status === 409), 'expected typed task conflict injection must be observed as an exact 409 response.');
            assert.ok(allRequestFailed.some((entry) => entry.method === 'PATCH' && entry.url.includes(expectedTypedTaskPath) && entry.failure === 'net::ERR_FAILED'), 'expected typed task uncertain-save abort must be observed as an exact failed request.');
        }
        const unexpectedConsoleErrors = consoleErrorRecords.filter((entry) => !expectedConsoleRecord(entry));
        assert.deepStrictEqual(unexpectedConsoleErrors, [], `Unexpected Chrome errors: ${unexpectedConsoleErrors.map((entry) => `${entry.url}: ${entry.text}`).join('; ')}`);
        assert.deepStrictEqual(pageErrorRecords, [], `Chrome page errors: ${pageErrorRecords.map((entry) => entry.message).join('; ')}`);
        assert.ok(requestLog.some((entry) => entry.method === 'PATCH' && entry.body?.operationId), 'Task mutation must carry an operation ID.');
        assert.ok(requestLog.some((entry) => entry.method === 'GET' && entry.url.includes('parentScope')), 'Board must query canonical branch filters.');
        process.stdout.write('crm projects Phase3 board Chrome persisted matrix passed\n');
    } catch (error) {
        const page = browser?.contexts()[0]?.pages()[0];
        if (page && !page.isClosed()) {
            try {
                const state = await page.evaluate(() => ({
                    selectedProject: document.getElementById('projects-board-project-select')?.value,
                    status: document.getElementById('projects-board-status')?.textContent,
                    count: document.getElementById('projects-board-count')?.textContent,
                    busy: document.getElementById('projects-board-section')?.getAttribute('aria-busy'),
                    openDialogs: Array.from(document.querySelectorAll('dialog[open]')).map((dialog) => dialog.id),
                    loadedProject: window.projectsViewsController?.getState()?.response?.project?.id,
                    membership: window.projectsViewsController?.getState()?.response?.membership?.role,
                    viewport: { width: innerWidth, height: innerHeight, scrollX, scrollY },
                    dragAudit: window.__phase3DragAudit || [],
                    dragParent: (() => {
                        const row = document.querySelector(`[data-task-id="${window.__phase3DragAuditParentId}"]`);
                        return row ? { rect: row.getBoundingClientRect().toJSON(), classes: row.className, expanded: row.querySelector('.crm-board-expander')?.getAttribute('aria-expanded') } : null;
                    })()
                }));
                // Diagnostic only: keep the original assertion failure, even if
                // a later refresh restores the screen while evidence is captured.
                await page.waitForTimeout(1000);
                const settled = await page.evaluate(() => ({
                    activeTag: document.activeElement?.tagName,
                    activeTaskId: document.activeElement?.closest?.('[data-task-id]')?.dataset.taskId || '',
                    activeValue: document.activeElement?.value,
                    caret: document.activeElement?.selectionStart ?? null,
                    tableHidden: document.getElementById('projects-board-table-wrap')?.hidden,
                    busy: document.getElementById('projects-board-section')?.getAttribute('aria-busy'),
                    viewStatus: document.getElementById('projects-view-status')?.textContent,
                    titles: Array.from(document.querySelectorAll('#projects-board-rows input[data-field-kind="title"]')).slice(0, 8).map((input) => ({ taskId: input.closest('[data-task-id]')?.dataset.taskId, value: input.value, caret: input.selectionStart }))
                }));
                fs.writeFileSync(path.join(ROOT, 'test-results/crm-projects/phase3-board-failure.json'), `${JSON.stringify({ error: error.message, state, settled }, null, 2)}\n`, 'utf8');
                await page.screenshot({ path: path.join(ROOT, 'test-results/crm-projects/phase3-board-failure.png'), fullPage: true });
            } catch (_) { /* preserve the original browser failure */ }
        }
        throw error;
    } finally {
        try { writeConsoleNetworkArtifact(); } catch (_) { /* preserve the original browser failure */ }
        if (browser) await browser.close();
        if (server) await new Promise((resolve) => server.close(resolve));
        if (previousFlag === undefined) delete process.env.CRM_PROJECTS_ENABLED;
        else process.env.CRM_PROJECTS_ENABLED = previousFlag;
        await app.delete();
    }
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
