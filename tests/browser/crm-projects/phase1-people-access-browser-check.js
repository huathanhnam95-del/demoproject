'use strict';

const assert = require('assert');
const express = require('express');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');
const {
    DEMO_PROJECT_ID,
    getEmulatorConfig
} = require('../../../scripts/crm/projects/emulator-config');
const {
    initializeFixtureApp,
    seedFixtures
} = require('../../../scripts/crm/projects/seed-fixtures');
const createProjectsRouter = require('../../../functions/src/routes/crm/projects');
const { buildLocalCrmAdminDocument } = require('../../../src/server/app');

const ROOT = path.resolve(__dirname, '../../..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const PASSWORD = 'Phase0-only-password!123';
const PROJECT_ID = 'phase1-access-demo';
const USERS = Object.freeze({
    admin: 'admin@demo.crm-projects.test',
    teacher: 'teacher@demo.crm-projects.test',
    editor: 'staff-editor@demo.crm-projects.test',
    viewer: 'viewer@demo.crm-projects.test',
    unauthorized: 'unauthorized@demo.crm-projects.test',
    profileOnly: 'profile-only@demo.crm-projects.test',
    suspended: 'suspended@demo.crm-projects.test'
});

function parseEndpoint(value) {
    const [host, port] = String(value || '').split(':');
    return { host, port: Number(port) };
}

function buildConfig() {
    const auth = parseEndpoint(process.env.FIREBASE_AUTH_EMULATOR_HOST);
    const firestore = parseEndpoint(process.env.FIRESTORE_EMULATOR_HOST);
    return {
        success: true,
        config: {
            apiKey: 'demo-key',
            authDomain: `${DEMO_PROJECT_ID}.firebaseapp.com`,
            projectId: DEMO_PROJECT_ID,
            storageBucket: `${DEMO_PROJECT_ID}.appspot.com`,
            messagingSenderId: '000000000000',
            appId: '1:000000000000:web:crmprojectsphase1'
        },
        emulators: { auth, firestore },
        features: { projects: String(process.env.CRM_PROJECTS_ENABLED) === 'true' }
    };
}

function loginPage() {
    return `<!doctype html><meta charset="utf-8"><title>Phase1 login</title>
<script src="https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/9.22.0/firebase-auth-compat.js"></script>
<script>
(async function () {
  const configResponse = await fetch('/api/config', { cache: 'no-store' });
  const payload = await configResponse.json();
  if (!firebase.apps.length) firebase.initializeApp(payload.config);
  const emulator = payload.emulators.auth;
  firebase.auth().useEmulator('http://' + emulator.host + ':' + emulator.port, { disableWarnings: true });
  const email = new URLSearchParams(location.search).get('email');
  await firebase.auth().signInWithEmailAndPassword(email, ${JSON.stringify(PASSWORD)});
  location.replace('/crm-admin.html#projects');
}()).catch((error) => { document.body.textContent = 'LOGIN_FAILED:' + error.message; });
</script>`;
}

async function signIn(email, password = PASSWORD) {
    const endpoint = process.env.FIREBASE_AUTH_EMULATOR_HOST;
    const response = await fetch(`http://${endpoint}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password, returnSecureToken: true })
    });
    const body = await response.json();
    if (!response.ok) throw new Error(`Auth emulator sign-in failed for ${email}: ${JSON.stringify(body)}`);
    return body.idToken;
}

async function request(server, requestPath, token, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`http://127.0.0.1:${server.address().port}${requestPath}`, { ...options, headers });
    const text = await response.text();
    let body;
    try { body = JSON.parse(text); } catch (_error) { body = { raw: text }; }
    return { status: response.status, body };
}

async function waitForApp(page, route = /\/crm-admin\.html#/) {
    await page.waitForURL(route, { timeout: 30000 });
    await page.waitForFunction(() => document.getElementById('crm-loading')?.style.display === 'none', null, { timeout: 30000 });
}

async function openAs(page, baseUrl, email) {
    const projectResponses = [];
    const recordResponse = (response) => {
        if (response.request().method() === 'GET' && response.url().includes('/api/projects/')) {
            projectResponses.push({ url: response.url(), status: response.status() });
        }
    };
    page.on('response', recordResponse);
    try {
        await page.goto(`${baseUrl}/__phase1-login?email=${encodeURIComponent(email)}`, { waitUntil: 'domcontentloaded' });
        await waitForApp(page);
        // The shell removes its gate before the asynchronous Projects access
        // and member requests finish. Wait for the real fixture membership
        // render and refresh-idle state before inspecting role controls.
        await page.waitForFunction(({ projectId, expectedEmail }) => {
            const refresh = document.getElementById('btn-projects-access-refresh');
            return window.firebase?.auth?.().currentUser?.email === expectedEmail
                && document.getElementById('projects-project-select')?.value === projectId
                && document.querySelectorAll('#projects-members-list .crm-stack-item').length > 0
                && refresh && !refresh.disabled;
        }, { projectId: PROJECT_ID, expectedEmail: email }, { timeout: 30000 });
    } catch (error) {
        const artifact = path.join(ROOT, 'test-results/crm-projects', `phase1-readiness-${Date.now()}`);
        fs.mkdirSync(path.dirname(artifact), { recursive: true });
        fs.writeFileSync(`${artifact}.json`, JSON.stringify({ email, url: page.url(), projectResponses, error: error.message }, null, 2));
        fs.writeFileSync(`${artifact}.html`, await page.content());
        await page.screenshot({ path: `${artifact}.png`, fullPage: true });
        throw error;
    } finally {
        page.off('response', recordResponse);
    }
}

async function signOut(page) {
    const shellWillReload = await page.evaluate(() => location.pathname.endsWith('/crm-admin.html')
        && !!window.projectsRecoveryController);
    if (shellWillReload) {
        // The authenticated shell reloads on an account change. Arm the
        // navigation wait before signing out so the next login cannot race it.
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }),
            page.evaluate(() => window.firebase.auth().signOut())
        ]);
        await page.waitForFunction(() => window.firebase?.apps?.length > 0
            && window.firebase.auth().currentUser === null, null, { timeout: 30000 });
        // The reloaded shell then redirects its signed-out account to index.
        // Wait for that scheduled redirect too, rather than interrupting it
        // with openAs and concealing a navigation failure.
        await page.waitForURL(/\/index\.html(?:$|\?)/, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } else {
        // Login-failure documents have Firebase Auth but no shell listener.
        await page.evaluate(() => window.firebase.auth().signOut());
        assert.strictEqual(await page.evaluate(() => window.firebase.auth().currentUser), null);
    }
}

function bearerToken(req) {
    const value = String(req.headers.authorization || '');
    return value.startsWith('Bearer ') ? value.slice(7).trim() : '';
}

function createAdminDirectoryRouter({ db, auth }) {
    const router = express.Router();
    router.use(async (req, res, next) => {
        try {
            const token = bearerToken(req);
            if (!token) return res.status(401).json({ success: false, error: 'UNAUTHORIZED' });
            req.user = await auth.verifyIdToken(token);
            const profile = await db.collection('users').doc(req.user.uid).get();
            if (!profile.exists || profile.data()?.isAdmin !== true) {
                return res.status(403).json({ success: false, error: 'FORBIDDEN' });
            }
            return next();
        } catch (error) {
            return res.status(401).json({ success: false, error: error?.code || 'UNAUTHORIZED' });
        }
    });

    router.get('/accounts', async (_req, res) => {
        const snapshot = await db.collection('users').get();
        const accounts = [];
        for (const doc of snapshot.docs || []) {
            const profile = doc.data() || {};
            let authUser = null;
            try { authUser = await auth.getUser(doc.id); } catch (_error) { /* profile remains visible */ }
            accounts.push({
                uid: doc.id,
                email: profile.email || authUser?.email || '',
                displayName: profile.displayName || profile.name || authUser?.displayName || '',
                isAdmin: profile.isAdmin === true,
                isTeacher: profile.isTeacher === true,
                archived: profile.archived === true || profile.accountStatus === 'archived'
            });
        }
        return res.json({ success: true, accounts, count: accounts.length });
    });

    router.get('/teachers', async (_req, res) => {
        const snapshot = await db.collection('users').get();
        const teachers = (snapshot.docs || [])
            .map((doc) => ({ uid: doc.id, ...doc.data() }))
            .filter((profile) => profile.isTeacher === true || profile.crmRole === 'teacher')
            .map((profile) => ({ uid: profile.uid, email: profile.email || '', displayName: profile.displayName || profile.name || '' }));
        return res.json({ success: true, teachers, count: teachers.length });
    });
    return router;
}

async function main() {
    assert.strictEqual(process.env.CRM_PROJECTS_EMULATOR_READY, '1', 'Browser checks require the isolated emulator runner.');
    const config = getEmulatorConfig(process.env);
    const app = initializeFixtureApp(config);
    const previousFlag = process.env.CRM_PROJECTS_ENABLED;
    process.env.CRM_PROJECTS_ENABLED = 'true';
    const auth = app.auth();
    const db = app.firestore();
    let server;
    let browser;
    let delayProjectAccess = false;
    let delayedAccessWaiters = [];
    let resolveDelayedAccessHit = null;
    let delayTeacherMemberPatch = false;
    let delayedTeacherPatchWaiters = [];
    let resolveTeacherPatchHit = null;
    const browserErrors = [];
    const forbiddenNonAdminRequests = [];
    try {
        await seedFixtures({ config, app });
        const api = express();
        api.use(express.json());
        api.get('/api/config', (_req, res) => res.json(buildConfig()));
        // Legacy probes intentionally fall through to the existing profile
        // checks in crm-admin.js.
        api.get('/api/admin/status', (_req, res) => res.status(404).json({ success: false, error: 'NOT_FOUND' }));
        api.get('/api/teacher/status', (_req, res) => res.status(404).json({ success: false, error: 'NOT_FOUND' }));
        api.use('/api/admin', createAdminDirectoryRouter({ db, auth }));
        api.use('/api/projects', (req, _res, next) => {
            if (delayTeacherMemberPatch && req.method === 'PATCH'
                && req.path === `/${PROJECT_ID}/members/crm-projects-staff-editor`) {
                resolveTeacherPatchHit?.();
                resolveTeacherPatchHit = null;
                delayedTeacherPatchWaiters.push(next);
                return;
            }
            if (delayProjectAccess && req.method === 'GET' && req.path === '/access') {
                resolveDelayedAccessHit?.();
                resolveDelayedAccessHit = null;
                delayedAccessWaiters.push(next);
                return;
            }
            next();
        });
        api.use('/api/projects', createProjectsRouter({ db, auth }));
        const rawCrmAdminHtml = fs.readFileSync(path.join(PUBLIC_DIR, 'crm-admin.html'), 'utf8');
        api.get('/crm-admin.html', (_req, res, next) => {
            const document = buildLocalCrmAdminDocument(rawCrmAdminHtml, process.env, DEMO_PROJECT_ID);
            if (!document.endpoints) return next();
            res.setHeader('Content-Security-Policy', document.policy);
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            return res.type('html').send(document.html);
        });
        api.use(express.static(PUBLIC_DIR));
        api.get('/__phase1-login', (_req, res) => res.type('html').send(loginPage()));
        server = http.createServer(api);
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        const baseUrl = `http://127.0.0.1:${server.address().port}`;

        browser = await chromium.launch({ channel: 'chrome', headless: true });
        const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
        const page = await context.newPage();
        page.on('pageerror', (error) => browserErrors.push(error.message));
        let currentNonAdmin = false;
        let projectAccessGetCount = 0;
        page.on('request', (requestEvent) => {
            if (requestEvent.method() === 'GET' && requestEvent.url().includes('/api/projects/access')) {
                projectAccessGetCount += 1;
            }
            if (!currentNonAdmin) return;
            const requestUrl = requestEvent.url();
            if (/\/api\/admin(?:\/|$)/.test(requestUrl) && !/\/api\/admin\/status(?:\?|$)/.test(requestUrl)
                || /\/api\/projects\/(?:people|calendar|allowance)(?:\/|$)/.test(requestUrl)) {
                forbiddenNonAdminRequests.push(requestUrl);
            }
        });

        // Administrator sees metadata-only project management and can use the
        // existing Staff account actions alongside Projects grants.
        await openAs(page, baseUrl, USERS.admin);
        assert.strictEqual(await page.locator('#nav-projects-container').isVisible(), true);
        assert.strictEqual(await page.locator('#projects-calendar-section').isVisible(), true);
        assert.strictEqual(await page.locator('#projects-allowance-section').isVisible(), true);
        assert.strictEqual(await page.locator('#projects-member-editor').isVisible(), true);

        // Teacher keeps Schedule and can enter Projects when granted and a
        // member; both routes remain available through the normal shell.
        await signOut(page);
        await openAs(page, baseUrl, USERS.teacher);
        assert.strictEqual(await page.locator('#nav-projects-container').isVisible(), true);
        await page.waitForSelector('#projects-members-list .crm-projects-member-role[data-uid="crm-projects-staff-editor"]', { timeout: 30000 });
        await page.waitForFunction(() => document.querySelector('#projects-members-list .crm-projects-member-role[data-uid="crm-projects-staff-editor"]')?.disabled === false, null, { timeout: 30000 });
        await page.locator('.crm-nav-item[data-main="courses"]').click();
        await page.waitForURL(/\/crm-admin\.html#courses\/teacher-schedule$/);
        assert.strictEqual(await page.locator('[data-panel="courses/teacher-schedule"]').isVisible(), true);
        assert.strictEqual(await page.locator('[data-panel="courses/teacher-schedule"]').evaluate((panel) => getComputedStyle(panel).display), 'flex');
        delayProjectAccess = true;
        const delayedAccessHit = new Promise((resolve) => { resolveDelayedAccessHit = resolve; });
        const delayedAccessResponse = page.waitForResponse((response) => response.url().includes('/api/projects/access') && response.request().method() === 'GET');
        await page.locator('.crm-nav-item[data-main="projects"]').click();
        await page.waitForURL(/\/crm-admin\.html#projects$/);
        await delayedAccessHit;
        await page.waitForFunction(() => document.querySelector('#projects-members-list .crm-projects-member-role[data-uid="crm-projects-staff-editor"]')?.disabled === true, null, { timeout: 10000 });
        assert.strictEqual(await page.locator('#projects-members-list .crm-projects-member-role[data-uid="crm-projects-staff-editor"]').isDisabled(), true);
        delayProjectAccess = false;
        const releasedWaiters = delayedAccessWaiters;
        delayedAccessWaiters = [];
        releasedWaiters.forEach((release) => release());
        assert.strictEqual((await delayedAccessResponse).ok(), true);
        await page.waitForFunction(() => document.querySelector('#projects-members-list .crm-projects-member-role[data-uid="crm-projects-staff-editor"]')?.disabled === false, null, { timeout: 30000 });
        assert.strictEqual(await page.locator('#projects-member-editor').isVisible(), true, 'Project Owner must receive scoped eligible-person controls.');
        assert.ok(await page.locator('#projects-member-person option[value="crm-projects-staff-editor"]').count() > 0);
        const teacherEditorRole = page.locator('#projects-members-list .crm-projects-member-role[data-uid="crm-projects-staff-editor"]');
        assert.strictEqual(await teacherEditorRole.inputValue(), 'Editor');
        const accessGetsBeforeHeldPatch = projectAccessGetCount;
        delayTeacherMemberPatch = true;
        const teacherPatchHit = new Promise((resolve) => { resolveTeacherPatchHit = resolve; });
        let responsePromise = page.waitForResponse((response) => response.url().includes(`/api/projects/${PROJECT_ID}/members/crm-projects-staff-editor`) && response.request().method() === 'PATCH');
        await teacherEditorRole.selectOption('Viewer');
        await page.locator('#projects-members-list .crm-projects-member-update[data-uid="crm-projects-staff-editor"]').click();
        await teacherPatchHit;
        await page.locator('.crm-nav-item[data-main="courses"]').click();
        await page.waitForURL(/\/crm-admin\.html#courses\/teacher-schedule$/);
        await page.locator('.crm-nav-item[data-main="projects"]').click();
        await page.waitForURL(/\/crm-admin\.html#projects$/);
        await page.waitForFunction(() => {
            const role = document.querySelector('#projects-members-list .crm-projects-member-role[data-uid="crm-projects-staff-editor"]');
            const save = document.querySelector('#projects-members-list .crm-projects-member-update[data-uid="crm-projects-staff-editor"]');
            return role?.disabled === true && save?.disabled === true;
        }, null, { timeout: 10000 });
        assert.strictEqual(projectAccessGetCount, accessGetsBeforeHeldPatch,
            'navigation during a held membership PATCH must not start a pre-commit /access refresh');
        assert.strictEqual(await page.locator('#projects-members-list .crm-projects-member-role[data-uid="crm-projects-staff-editor"]').isDisabled(), true);
        assert.strictEqual(await page.locator('#projects-members-list .crm-projects-member-update[data-uid="crm-projects-staff-editor"]').isDisabled(), true);
        const memberRefreshPromise = page.waitForResponse((response) => response.url().includes(`/api/projects/${PROJECT_ID}/members`) && response.request().method() === 'GET');
        delayTeacherMemberPatch = false;
        const releasedTeacherPatchWaiters = delayedTeacherPatchWaiters;
        delayedTeacherPatchWaiters = [];
        releasedTeacherPatchWaiters.forEach((release) => release());
        const teacherUpdateResponse = await responsePromise;
        assert.strictEqual(teacherUpdateResponse.ok(), true);
        assert.strictEqual(teacherUpdateResponse.request().postDataJSON().role, 'Viewer');
        assert.strictEqual((await teacherUpdateResponse.json()).member.role, 'Viewer');
        const teacherViewerRefresh = await memberRefreshPromise;
        assert.strictEqual(teacherViewerRefresh.ok(), true);
        assert.strictEqual((await teacherViewerRefresh.json()).members.find((member) => member.uid === 'crm-projects-staff-editor').role, 'Viewer');
        await page.waitForFunction(() => {
            const role = document.querySelector('#projects-members-list .crm-projects-member-role[data-uid="crm-projects-staff-editor"]');
            const save = document.querySelector('#projects-members-list .crm-projects-member-update[data-uid="crm-projects-staff-editor"]');
            return role?.value === 'Viewer' && role?.disabled === false && save?.disabled === false;
        }, null, { timeout: 30000 });

        responsePromise = page.waitForResponse((response) => response.url().includes(`/api/projects/${PROJECT_ID}/members/crm-projects-staff-editor`) && response.request().method() === 'PATCH');
        const editorRefreshPromise = page.waitForResponse((response) => response.url().includes(`/api/projects/${PROJECT_ID}/members`) && response.request().method() === 'GET');
        await page.locator('#projects-members-list .crm-projects-member-role[data-uid="crm-projects-staff-editor"]').selectOption('Editor');
        await page.locator('#projects-members-list .crm-projects-member-update[data-uid="crm-projects-staff-editor"]').click();
        const teacherRestoreResponse = await responsePromise;
        assert.strictEqual(teacherRestoreResponse.ok(), true);
        assert.strictEqual(teacherRestoreResponse.request().postDataJSON().role, 'Editor');
        assert.strictEqual((await teacherRestoreResponse.json()).member.role, 'Editor');
        const teacherEditorRefresh = await editorRefreshPromise;
        assert.strictEqual(teacherEditorRefresh.ok(), true);
        assert.strictEqual((await teacherEditorRefresh.json()).members.find((member) => member.uid === 'crm-projects-staff-editor').role, 'Editor');
        await page.waitForFunction(() => document.querySelector('#projects-members-list .crm-projects-member-role[data-uid="crm-projects-staff-editor"]')?.value === 'Editor', null, { timeout: 30000 });
        await page.screenshot({ path: path.join(ROOT, 'test-results/crm-projects/phase1-browser-teacher-owner.png'), fullPage: true });

        await signOut(page);
        await openAs(page, baseUrl, USERS.admin);
        await page.locator('.crm-nav-item[data-main="staff"]').click();
        await page.waitForURL(/\/crm-admin\.html#staff$/);
        await page.waitForSelector('.crm-account-table .crm-projects-access-column', { timeout: 30000 });
        // Search/filter causes the Staff workspace to recreate its table; the
        // post-render hook must attach the Projects column again.
        await page.locator('#staff-account-search').fill('unauthorized');
        await page.waitForSelector('.crm-account-table tr[data-account-uid="crm-projects-unauthorized"] .crm-projects-access-column');
        await page.locator('#staff-account-search').fill('');
        await page.waitForSelector('.crm-account-table tr[data-account-uid="crm-projects-unauthorized"] .crm-projects-access-column');
        const adminGrant = page.locator('.crm-account-table tr[data-account-uid="crm-projects-admin"] .crm-projects-account-grant');
        assert.strictEqual(await page.locator('.crm-account-table tr[data-account-uid="crm-projects-admin"] .crm-projects-account-status').isDisabled(), true);
        responsePromise = page.waitForResponse((response) => response.url().includes('/api/projects/people/crm-projects-admin') && response.request().method() === 'PATCH');
        await adminGrant.uncheck();
        assert.strictEqual((await responsePromise).ok(), true);
        await page.waitForFunction(() => document.querySelector('.crm-account-table .crm-projects-account-grant[data-uid="crm-projects-admin"]')?.checked === false, null, { timeout: 30000 });
        responsePromise = page.waitForResponse((response) => response.url().includes('/api/projects/people/crm-projects-admin') && response.request().method() === 'PATCH');
        await page.locator('.crm-account-table tr[data-account-uid="crm-projects-admin"] .crm-projects-account-grant').check();
        assert.strictEqual((await responsePromise).ok(), true);
        await page.waitForFunction(() => document.querySelector('.crm-account-table .crm-projects-account-grant[data-uid="crm-projects-admin"]')?.checked === true, null, { timeout: 30000 });
        assert.strictEqual(await page.locator('.crm-account-table tr[data-account-uid="crm-projects-admin"] .crm-projects-account-status').isDisabled(), true);
        const staffLayout = await page.evaluate(() => {
            const panel = document.querySelector('[data-panel="staff"]');
            const main = panel?.querySelector('.crm-main-col');
            const rail = panel?.querySelector('.crm-side-col');
            const wrapper = panel?.querySelector('.crm-account-table-wrap');
            const table = wrapper?.querySelector('.crm-account-table');
            const action = table?.querySelector('.crm-account-actions-cell');
            return {
                documentWidth: document.documentElement.scrollWidth,
                viewportWidth: window.innerWidth,
                mainWidth: main?.getBoundingClientRect().width || 0,
                railRight: rail?.getBoundingClientRect().right || 0,
                wrapperOverflowX: wrapper ? getComputedStyle(wrapper).overflowX : '',
                wrapperClientWidth: wrapper?.clientWidth || 0,
                wrapperScrollWidth: wrapper?.scrollWidth || 0,
                tableScrollWidth: table?.scrollWidth || 0,
                actionCount: action ? 1 : 0
            };
        });
        assert.ok(staffLayout.documentWidth <= staffLayout.viewportWidth + 1,
            `Staff layout must stay within the viewport: ${JSON.stringify(staffLayout)}`);
        assert.ok(staffLayout.railRight <= staffLayout.viewportWidth + 1,
            `Staff Notes rail must stay within the viewport: ${JSON.stringify(staffLayout)}`);
        assert.strictEqual(staffLayout.wrapperOverflowX, 'auto');
        assert.ok(staffLayout.actionCount > 0, 'Staff account actions must remain present.');
        const scrolledActions = await page.evaluate(() => {
            const wrapper = document.querySelector('[data-panel="staff"] .crm-account-table-wrap');
            const action = wrapper?.querySelector('.crm-account-actions-cell');
            if (!wrapper || !action) return null;
            wrapper.scrollLeft = wrapper.scrollWidth;
            const wrapperRect = wrapper.getBoundingClientRect();
            const actionRect = action.getBoundingClientRect();
            return { scrollLeft: wrapper.scrollLeft, actionRight: actionRect.right, wrapperRight: wrapperRect.right };
        });
        assert.ok(scrolledActions && scrolledActions.actionRight <= scrolledActions.wrapperRight + 1,
            `Staff actions must be reachable inside the account table scroller: ${JSON.stringify(scrolledActions)}`);
        await page.screenshot({ path: path.join(ROOT, 'test-results/crm-projects/phase1-browser-staff-unified.png'), fullPage: true });
        const profileStatus = page.locator('.crm-account-table tr[data-account-uid="crm-projects-profile-only"] .crm-projects-account-status');
        responsePromise = page.waitForResponse((response) => response.url().includes('/api/projects/people/crm-projects-profile-only') && response.request().method() === 'PATCH');
        await profileStatus.selectOption('suspended');
        assert.strictEqual((await responsePromise).ok(), true);
        await page.waitForFunction(() => document.querySelector('.crm-account-table .crm-projects-account-status[data-uid="crm-projects-profile-only"]')?.value === 'suspended', null, { timeout: 30000 });
        responsePromise = page.waitForResponse((response) => response.url().includes('/api/projects/people/crm-projects-profile-only') && response.request().method() === 'PATCH');
        await page.locator('.crm-account-table tr[data-account-uid="crm-projects-profile-only"] .crm-projects-account-status').selectOption('active');
        const restoreProfileResponse = await responsePromise;
        assert.strictEqual(restoreProfileResponse.ok(), true,
            `Profile-only restore failed with ${restoreProfileResponse.status()} ${await restoreProfileResponse.text()}`);
        await page.waitForFunction(() => document.querySelector('.crm-account-table .crm-projects-account-status[data-uid="crm-projects-profile-only"]')?.value === 'active', null, { timeout: 30000 });
        const unauthorizedGrant = page.locator('.crm-account-table tr[data-account-uid="crm-projects-unauthorized"] .crm-projects-account-grant');
        responsePromise = page.waitForResponse((response) => response.url().includes('/api/projects/people/crm-projects-unauthorized') && response.request().method() === 'PATCH');
        await unauthorizedGrant.check();
        assert.strictEqual((await responsePromise).ok(), true);
        await page.waitForFunction(() => document.querySelector('.crm-account-table .crm-projects-account-grant[data-uid="crm-projects-unauthorized"]')?.checked === true, null, { timeout: 30000 });

        await page.locator('.crm-nav-item[data-main="projects"]').click();
        await page.waitForURL(/\/crm-admin\.html#projects$/);
        await page.waitForSelector('#projects-member-editor:not([hidden])');
        await page.locator('#projects-member-person').selectOption('crm-projects-unauthorized');
        await page.locator('#projects-member-role').selectOption('Viewer');
        responsePromise = page.waitForResponse((response) => response.url().includes(`/api/projects/${PROJECT_ID}/members`) && response.request().method() === 'POST');
        await page.locator('#btn-projects-member-save').click();
        assert.strictEqual((await responsePromise).ok(), true);
        await page.waitForFunction(() => document.querySelector('#projects-members-list [data-uid="crm-projects-unauthorized"]'), null, { timeout: 30000 });
        responsePromise = page.waitForResponse((response) => response.url().includes(`/api/projects/${PROJECT_ID}/owner-transfer`) && response.request().method() === 'POST');
        await page.locator('#projects-members-list .crm-projects-owner-transfer[data-uid="crm-projects-unauthorized"]').click();
        assert.strictEqual((await responsePromise).ok(), true);
        await page.waitForFunction(() => document.querySelector('#projects-members-list [data-uid="crm-projects-unauthorized"] .crm-projects-member-role')?.value === 'Owner', null, { timeout: 30000 });

        await page.locator('#projects-allowance-usd').fill('4.25');
        responsePromise = page.waitForResponse((response) => response.url().endsWith('/api/projects/allowance') && response.request().method() === 'PATCH');
        await page.locator('#btn-projects-allowance-save').click();
        assert.strictEqual((await responsePromise).ok(), true);
        await page.waitForFunction(() => document.getElementById('projects-allowance-usd')?.value === '4.25', null, { timeout: 30000 });
        await page.locator('.crm-nav-item[data-main="staff"]').click();
        await page.waitForURL(/\/crm-admin\.html#staff$/);
        await page.waitForSelector('.crm-account-table .crm-projects-access-column', { timeout: 30000 });
        assert.strictEqual(await page.locator('.crm-account-table tr[data-account-uid="crm-projects-admin"] .crm-projects-account-status').isDisabled(), true);
        await page.locator('.crm-nav-item[data-main="projects"]').click();
        await page.waitForURL(/\/crm-admin\.html#projects$/);
        assert.strictEqual(await page.locator('[data-panel="courses/teacher-schedule"]').isVisible(), false);

        // A separate browser context proves the grant, membership, and owner
        // transfer survived an Auth persistence boundary and page reload.
        const reloadContext = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
        const reloadPage = await reloadContext.newPage();
        reloadPage.on('pageerror', (error) => browserErrors.push(error.message));
        await openAs(reloadPage, baseUrl, USERS.admin);
        await reloadPage.locator('.crm-nav-item[data-main="staff"]').click();
        await reloadPage.waitForURL(/\/crm-admin\.html#staff$/);
        await reloadPage.waitForSelector('.crm-account-table .crm-projects-access-column', { timeout: 30000 });
        assert.strictEqual(await reloadPage.locator('.crm-account-table tr[data-account-uid="crm-projects-unauthorized"] .crm-projects-account-grant').isChecked(), true);
        await reloadPage.locator('.crm-nav-item[data-main="projects"]').click();
        await reloadPage.waitForURL(/\/crm-admin\.html#projects$/);
        await reloadPage.waitForSelector('#projects-members-list [data-uid="crm-projects-unauthorized"]', { timeout: 30000 });
        assert.strictEqual(await reloadPage.locator('#projects-members-list [data-uid="crm-projects-unauthorized"] .crm-projects-member-role').inputValue(), 'Owner');
        assert.strictEqual(await reloadPage.locator('#projects-allowance-usd').inputValue(), '4.25');
        responsePromise = reloadPage.waitForResponse((response) => response.url().endsWith('/api/projects/allowance') && response.request().method() === 'PATCH');
        await reloadPage.locator('#projects-allowance-usd').fill('5.00');
        await reloadPage.locator('#btn-projects-allowance-save').click();
        assert.strictEqual((await responsePromise).ok(), true);
        await reloadContext.close();

        await page.screenshot({ path: path.join(ROOT, 'test-results/crm-projects/phase1-browser-admin.png'), fullPage: true });
        for (const email of [USERS.editor, USERS.viewer]) {
            currentNonAdmin = true;
            await signOut(page);
            await openAs(page, baseUrl, email);
            assert.strictEqual(await page.locator('#nav-projects-container').isVisible(), true);
            await page.waitForFunction(() => document.getElementById('projects-calendar-section')?.hidden === true, null, { timeout: 30000 });
            await page.waitForSelector('#projects-members-list .crm-stack-item', { timeout: 30000 });
            assert.strictEqual(await page.locator('#projects-calendar-section').isVisible(), false);
            assert.strictEqual(await page.locator('#projects-allowance-section').isVisible(), false);
            assert.strictEqual(await page.locator('#projects-member-editor').isVisible(), false);
            assert.ok(await page.locator('#projects-members-list .crm-stack-item').count() > 0, `${email} must see a minimal member directory.`);
            assert.strictEqual(await page.locator('.crm-projects-account-grant').count(), 0);
            if (email === USERS.viewer) {
                await page.waitForFunction(() => document.getElementById('btn-projects-access-refresh')?.disabled === false, null, { timeout: 30000 });
                await page.screenshot({ path: path.join(ROOT, 'test-results/crm-projects/phase1-browser-viewer.png'), fullPage: true });
            }
            if (email === USERS.editor) {
                await page.evaluate(() => { window.location.hash = '#staff'; });
                await page.waitForFunction(() => window.location.hash === '#projects', null, { timeout: 10000 });
                assert.strictEqual(await page.locator('[data-panel="projects"]').isVisible(), true);
            }
        }
        currentNonAdmin = false;
        assert.deepStrictEqual(forbiddenNonAdminRequests, [], `Editor/Viewer must not call admin or workforce configuration APIs: ${forbiddenNonAdminRequests.join('; ')}`);

        // Unauthorized and suspended identities remain blocked at the real
        // server boundary, while the browser sees the login gate/failure.
        const profileOnlyToken = await signIn(USERS.profileOnly);
        const denied = await request(server, `/api/projects/${PROJECT_ID}`, profileOnlyToken);
        assert.strictEqual(denied.status, 403);
        await signOut(page);
        await page.goto(`${baseUrl}/__phase1-login?email=${encodeURIComponent(USERS.profileOnly)}`, { waitUntil: 'domcontentloaded' });
        await page.waitForURL(/\/index\.html(?:$|\?)/, { timeout: 10000, waitUntil: 'domcontentloaded' });
        await page.goto(`${baseUrl}/__phase1-login?email=${encodeURIComponent(USERS.suspended)}`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.body?.innerText.includes('LOGIN_FAILED:'), null, { timeout: 10000 });
        assert.match(await page.locator('body').innerText(), /LOGIN_FAILED:/);

        // Feature-off is enforced before panel selection, while Staff remains
        // reachable for legacy administration.
        process.env.CRM_PROJECTS_ENABLED = 'false';
        await signOut(page);
        await page.goto(`${baseUrl}/__phase1-login?email=${encodeURIComponent(USERS.admin)}`, { waitUntil: 'domcontentloaded' });
        await page.waitForURL(/\/crm-admin\.html#staff$/);
        assert.strictEqual(await page.locator('#nav-projects-container').isVisible(), false);
        assert.strictEqual(await page.locator('.crm-nav-item[data-main="staff"]').isVisible(), true);
        assert.strictEqual(await page.locator('[data-panel="staff"]').isVisible(), true);

        assert.deepStrictEqual(browserErrors, [], `Chrome page errors: ${browserErrors.join('; ')}`);
        process.stdout.write('crm projects Phase1 real Chrome emulator access matrix passed\n');
    } finally {
        if (browser) await browser.close();
        if (server) await new Promise((resolve) => server.close(resolve));
        await app.delete();
        if (previousFlag === undefined) delete process.env.CRM_PROJECTS_ENABLED;
        else process.env.CRM_PROJECTS_ENABLED = previousFlag;
    }
}

main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
});
