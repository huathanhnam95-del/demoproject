'use strict';

const assert = require('assert');
const crypto = require('crypto');
const express = require('express');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const {
    bootPhase4,
    createDeepFixture,
    createProject,
    createSection,
    createTask,
    jsonRequest,
    expectStatus,
    request,
    PASSWORD
} = require('../../../tests/crm/projects/phase4-test-helpers');
const { buildLocalCrmAdminDocument } = require('../../../src/server/app');

const ROOT = path.resolve(__dirname, '../../..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const PROJECT_ID = 'phase4-browser-recovery';
const SECOND_PROJECT_ID = 'phase4-browser-switch';
const USERS = Object.freeze({
    owner: 'teacher@demo.crm-projects.test',
    viewer: 'viewer@demo.crm-projects.test'
});

function parseEndpoint(value) {
    const match = String(value || '').match(/^(?:https?:\/\/)?([^:]+):(\d+)$/);
    return { host: match?.[1] || '127.0.0.1', port: Number(match?.[2] || 0) };
}

function browserConfig() {
    const auth = parseEndpoint(process.env.FIREBASE_AUTH_EMULATOR_HOST);
    const firestore = parseEndpoint(process.env.FIRESTORE_EMULATOR_HOST);
    const storage = parseEndpoint(process.env.FIREBASE_STORAGE_EMULATOR_HOST);
    return {
        success: true,
        config: {
            apiKey: 'demo-key',
            authDomain: 'demo-crm-projects.firebaseapp.com',
            projectId: 'demo-crm-projects',
            storageBucket: 'demo-crm-projects.appspot.com',
            messagingSenderId: '000000000000',
            appId: '1:000000000000:web:crmprojectsphase4'
        },
        emulators: { auth, firestore, storage },
        features: { projects: true }
    };
}

function loginPage() {
    return `<!doctype html><meta charset="utf-8"><title>Phase4 login</title>
<script src="https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/9.22.0/firebase-auth-compat.js"></script>
<script>(async function(){const response=await fetch('/api/config');const payload=await response.json();if(!firebase.apps.length)firebase.initializeApp(payload.config);firebase.auth().useEmulator('http://'+payload.emulators.auth.host+':'+payload.emulators.auth.port,{disableWarnings:true});const email=new URLSearchParams(location.search).get('email');await firebase.auth().signInWithEmailAndPassword(email,${JSON.stringify(PASSWORD)});location.replace('/crm-admin.html#projects');}()).catch(error=>{document.body.textContent='LOGIN_FAILED:'+error.message;});</script>`;
}

async function firstVisible(page, selectors, label) {
    for (const selector of selectors) {
        const locator = page.locator(selector).first();
        if (await locator.count() && await locator.isVisible().catch(() => false)) return locator;
    }
    throw new Error(`${label} was not rendered. Selectors tried: ${selectors.join(', ')}`);
}

async function expectAttribute(locator, name, expected) {
    await locator.waitFor({ state: 'visible', timeout: 30000 });
    // Mutations replace the article after the response; an already-visible
    // button alone is not evidence that its new state has rendered.
    for (let attempt = 0; attempt < 100; attempt += 1) {
        if (await locator.getAttribute(name) === expected) return;
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.strictEqual(await locator.getAttribute(name), expected, `${name} must be ${expected}`);
}

async function closeTaskDetail(page) {
    const detail = page.locator('#projects-board-detail');
    const close = page.locator('#btn-projects-board-close-detail');
    for (let attempt = 0; attempt < 5; attempt += 1) {
        if (await detail.evaluate((element) => !element.hidden && element.open)) await close.click({ force: true });
        try {
            await page.waitForFunction(() => {
                const detail = document.getElementById('projects-board-detail');
                const state = window.projectsViewsController?.getState?.();
                return !!detail?.hidden && !detail.open && !state?.selectedTaskId;
            }, null, { timeout: 3000 });
            return;
        } catch (_) {
            // A pending board render can reopen the previous detail once;
            // re-check and close it before allowing a click behind the modal.
        }
    }
    throw new Error('Task detail did not close and clear its selected-task state.');
}

async function openRecovery(page) {
    await closeTaskDetail(page);
    const recoveryTab = page.locator('#projects-utab-recovery');
    const utilityOpen = await page.locator('#projects-utility-workspace').evaluate((element) => !element.hidden && element.open);
    if (await recoveryTab.getAttribute('aria-selected') !== 'true' || !utilityOpen) await recoveryTab.click();
    const toggle = page.locator('summary[data-recovery-toggle]');
    await toggle.waitFor({ state: 'visible', timeout: 30000 });
    if (!await page.locator('details[data-recovery-disclosure]').evaluate((element) => element.open)) await toggle.click();
    await page.locator('[data-recovery-lifecycle]').waitFor({ state: 'visible', timeout: 30000 });
}

async function setRecoveryFilter(page, lifecycle, targetType) {
    await openRecovery(page);
    const setFilter = async (selector, value) => {
        const control = page.locator(selector);
        if (await control.inputValue() === value) return;
        const responsePromise = page.waitForResponse((response) => response.request().method() === 'GET'
            && response.url().includes('/recovery?') && response.status() === 200);
        await control.selectOption(value);
        await responsePromise;
    };
    await setFilter('[data-recovery-lifecycle]', lifecycle);
    await setFilter('[data-recovery-type]', targetType);
    await page.waitForTimeout(100);
}

async function recoveryRow(page, label) {
    await openRecovery(page);
    const row = page.locator('[data-recovery-entries] > li').filter({ hasText: label }).first();
    await row.waitFor({ state: 'visible', timeout: 30000 });
    return row;
}

async function applyRecoveryAction(page, label, action, { restoreChain = false, destinationLabel = '' } = {}) {
    const row = await recoveryRow(page, label);
    const previewResponse = page.waitForResponse((response) => response.request().method() === 'GET'
        && response.url().includes('/recovery/preview?'));
    await row.locator(`[data-action="${action}"]`).click();
    assert.strictEqual((await previewResponse).status(), 200, `Chrome ${action} preview must succeed.`);
    let preview = page.locator('[data-recovery-preview]');
    await preview.waitFor({ state: 'visible', timeout: 30000 });
    if (restoreChain) {
        const chain = preview.locator('[data-recovery-chain]');
        const chainPreviewResponse = page.waitForResponse((response) => response.request().method() === 'GET'
            && response.url().includes('/recovery/preview?'));
        await chain.check();
        assert.strictEqual((await chainPreviewResponse).status(), 200, 'Chrome restore-chain preview refresh must succeed.');
        preview = page.locator('[data-recovery-preview]');
        await preview.waitFor({ state: 'visible', timeout: 30000 });
    }
    if (destinationLabel) {
        const destination = preview.locator('[data-recovery-destination]');
        const destinationPreviewResponse = page.waitForResponse((response) => response.request().method() === 'GET'
            && response.url().includes('/recovery/preview?'));
        await destination.selectOption({ label: destinationLabel });
        assert.strictEqual((await destinationPreviewResponse).status(), 200, 'Chrome destination preview refresh must succeed.');
        preview = page.locator('[data-recovery-preview]');
        await preview.waitFor({ state: 'visible', timeout: 30000 });
    }
    const responsePromise = page.waitForResponse((response) => response.request().method() === 'POST'
        && new URL(response.url()).pathname.endsWith(`/${action}`));
    const catalogPromise = page.waitForResponse((response) => response.request().method() === 'GET'
        && response.url().includes('/recovery?') && response.status() === 200);
    await preview.locator('[data-recovery-apply]').click();
    assert.strictEqual((await responsePromise).status(), 200, `Chrome ${action} lifecycle request must succeed.`);
    await catalogPromise;
}

async function openRole(page, baseUrl, email) {
    await page.goto(`${baseUrl}/__phase4-login?email=${encodeURIComponent(email)}`, { waitUntil: 'domcontentloaded' });
    await page.waitForURL(/crm-admin\.html#projects$/, { timeout: 30000 });
    await page.waitForFunction(() => document.getElementById('crm-loading')?.style.display === 'none', null, { timeout: 30000 });
    await page.waitForSelector('#projects-board-workspace:not([hidden])', { timeout: 30000 });
}

async function switchAccountInPlace(page, email) {
    const navigation = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch((error) => error);
    let signInError = null;
    try {
        await page.evaluate(async ({ nextEmail, password }) => {
            await firebase.auth().signInWithEmailAndPassword(nextEmail, password);
        }, { nextEmail: email, password: PASSWORD });
    } catch (error) {
        signInError = error;
    }
    const navigationResult = await navigation;
    if (navigationResult instanceof Error) throw navigationResult;
    if (signInError && !/execution context was destroyed|frame was detached|navigation/i.test(String(signInError.message || signInError))) throw signInError;
    await page.waitForFunction((expectedEmail) => firebase.auth().currentUser?.email === expectedEmail, email, { timeout: 30000 });
    await page.waitForFunction(() => document.getElementById('crm-loading')?.style.display === 'none', null, { timeout: 30000 });
    await page.waitForSelector('#projects-board-workspace:not([hidden])', { timeout: 30000 });
}

async function selectProjectTask(page, projectId, taskIds) {
    const pathIds = taskIds.map(String);
    await closeTaskDetail(page);
    const utilityWorkspace = page.locator('#projects-utility-workspace');
    if (await utilityWorkspace.evaluate((element) => !element.hidden && element.open)) {
        await page.locator('[aria-label="Close workspace tools"]').click();
        await utilityWorkspace.waitFor({ state: 'hidden', timeout: 30000 });
    }
    const picker = page.locator('#projects-board-project-select');
    // The native select remains attached for keyboard/form semantics but its
    // label is intentionally hidden behind the custom board picker styling.
    await picker.waitFor({ state: 'attached', timeout: 30000 });
    // The native select is intentionally hidden behind the custom board picker;
    // force only this form interaction while still waiting for the option and
    // authoritative board state below.
    if (await picker.inputValue() !== projectId) await picker.selectOption(projectId, { force: true });
    // P and Q intentionally share a task ID. The picker changes before the
    // board and Phase5 filter-reset refreshes finish, so an old matching row
    // is not sufficient evidence that the target project's board is ready.
    const waitForScopedRow = async (taskId) => page.waitForFunction(({ expectedProject, expectedTask }) => {
        const views = window.projectsViewsController?.getState?.();
        const actorUid = window.firebase?.auth?.()?.currentUser?.uid || '';
        const section = document.getElementById('projects-board-section');
        const workspace = document.getElementById('projects-board-workspace');
        const status = document.getElementById('projects-board-status')?.textContent || '';
        const rows = document.getElementById('projects-board-rows');
        const row = Array.from(rows?.querySelectorAll('[data-task-id]') || [])
            .find((candidate) => candidate.dataset.taskId === expectedTask);
        return document.getElementById('projects-board-project-select')?.value === expectedProject
            && views?.actorUid === actorUid
            && views?.projectId === expectedProject
            && views?.response?.project?.id === expectedProject
            && document.getElementById('projects-view-status')?.textContent === ''
            && workspace && !workspace.hidden
            && section?.getAttribute('aria-busy') === 'false'
            && /access\s+·\s+\d+\s+loaded task/.test(status)
            && row?.isConnected;
    }, { expectedProject: projectId, expectedTask: taskId }, { timeout: 30000 });
    await waitForScopedRow(pathIds[0]);
    for (let index = 0; index < pathIds.length - 1; index += 1) {
        const parentRow = page.locator(`#projects-board-rows [data-task-id="${pathIds[index]}"]`).first();
        await parentRow.waitFor({ state: 'visible', timeout: 30000 });
        const expander = parentRow.locator('.crm-board-expander').first();
        if (await expander.getAttribute('aria-expanded') !== 'true') await expander.click();
        await page.locator(`#projects-board-rows [data-task-id="${pathIds[index + 1]}"]`).first().waitFor({ state: 'visible', timeout: 30000 });
    }
    const leafId = pathIds[pathIds.length - 1];
    await waitForScopedRow(leafId);
    const leaf = page.locator(`#projects-board-rows [data-task-id="${leafId}"]`).first();
    await leaf.waitFor({ state: 'visible', timeout: 30000 });
    // A remote refresh may repaint the previous detail while branch rows are
    // settling. Close it again at the final interaction boundary so the real
    // leaf button is not behind a native dialog backdrop.
    await closeTaskDetail(page);
    const detailButton = leaf.locator('[data-action="open-detail"]').first();
    const selectionTimeline = [];
    const readSelection = () => page.evaluate(() => {
        const views = window.projectsViewsController?.getState?.() || {};
        return {
            viewsProject: views.projectId || '',
            viewsActor: views.actorUid || '',
            viewsTask: views.selectedTaskId || '',
            detailOpen: !!document.getElementById('projects-board-detail')?.open,
            detailHidden: !!document.getElementById('projects-board-detail')?.hidden,
            detailTitle: document.getElementById('projects-board-detail-title')?.textContent || '',
            selectedRows: Array.from(document.querySelectorAll('#projects-board-rows [aria-selected="true"]')).map((row) => row.dataset.taskId || row.dataset.rowId || '')
        };
    });
    selectionTimeline.push({ point: 'before-detail-click', state: await readSelection() });
    await detailButton.click({ force: true });
    selectionTimeline.push({ point: 'after-detail-click', state: await readSelection() });
    await page.waitForSelector('#projects-board-detail:not([hidden])', { timeout: 30000 });
    const selectionDeadline = Date.now() + 30000;
    let diagnostic = null;
    while (Date.now() < selectionDeadline) {
        diagnostic = await page.evaluate(() => ({
            authUid: window.firebase?.auth?.()?.currentUser?.uid || '',
            views: window.projectsViewsController?.getState?.() || null,
            detailOpen: !!document.getElementById('projects-board-detail')?.open,
            detailHidden: !!document.getElementById('projects-board-detail')?.hidden,
            detailTitle: document.getElementById('projects-board-detail-title')?.textContent || '',
            selectedRows: Array.from(document.querySelectorAll('#projects-board-rows [aria-selected="true"]')).map((row) => row.dataset.taskId || row.dataset.rowId || ''),
            projectPicker: document.getElementById('projects-board-project-select')?.value || ''
        }));
        if (diagnostic.views?.projectId === projectId
            && diagnostic.views.selectedTaskId === leafId
            && diagnostic.detailTitle === leafId
            && diagnostic.selectedRows.includes(leafId)) return;
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    selectionTimeline.push({ point: 'timeout', state: diagnostic });
    throw new Error(`Selected task did not settle after opening ${leafId}: ${JSON.stringify(selectionTimeline)}`);
}

async function main() {
    assert.strictEqual(process.env.CRM_PROJECTS_EMULATOR_READY, '1', 'Phase4 Chrome check requires isolated emulators.');
    const context = await bootPhase4({ projectId: PROJECT_ID });
    let browser;
    let server;
    const releaseBarriers = [];
    const barrier = () => {
        let release;
        const promise = new Promise((resolve) => { release = resolve; });
        releaseBarriers.push(release);
        return { promise, release };
    };
    const boundedCleanup = async (label, cleanup) => {
        let timer;
        try {
            await Promise.race([cleanup(), new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error(`${label} cleanup exceeded 5 seconds`)), 5000);
            })]);
        } catch (error) {
            console.error(error.stack || error.message);
            process.exitCode = 1;
        } finally { clearTimeout(timer); }
    };
    const artifactDir = path.join(ROOT, 'test-results/crm-projects');
    fs.mkdirSync(artifactDir, { recursive: true });
    const consoleErrors = [];
    const consoleErrorRecords = [];
    const pageErrors = [];
    const network = [];
    const annotationResponses = [];
    const annotationResponseRecords = [];
    const injectedConflictUrls = new Set();
    const expectedConsoleRecord = (entry) => {
        if (injectedConflictUrls.has(entry.url) && /status of 409/i.test(entry.text)) return true;
        let pathname = '';
        try { pathname = new URL(entry.url).pathname; } catch (_) { return false; }
        return (pathname === '/api/admin/status' || pathname === '/api/teacher/status') && /status of 404/i.test(entry.text);
    };
    const capturePage = (page) => {
        page.on('response', (response) => {
            if (!response.url().includes('/css/entrance-test-ui-annotations.css')) return;
            const record = { url: response.url(), status: response.status(), contentType: response.headers()['content-type'] || '' };
            annotationResponses.push({ response, ...record });
            annotationResponseRecords.push(record);
        });
        page.on('console', (message) => {
            if (message.type() !== 'error') return;
            const location = message.location?.() || {};
            const record = { text: message.text(), url: location.url || '', line: location.lineNumber ?? null, column: location.columnNumber ?? null };
            consoleErrorRecords.push(record);
            consoleErrors.push(record.text);
        });
        page.on('pageerror', (error) => pageErrors.push(error.message));
    };
    try {
        const fixture = await createDeepFixture(context, { depth: 4, taskPrefix: 'phase4:shared' });
        const ownerToken = await context.token('owner');
        const secondProject = await jsonRequest(context.server, '/api/projects/', ownerToken, 'POST', {
            operationId: 'phase4-browser-second-project', projectId: SECOND_PROJECT_ID, name: 'Phase4 browser switch'
        });
        expectStatus(secondProject, 200, 'second project create');
        const secondContext = { ...context, projectId: SECOND_PROJECT_ID };
        const secondSection = await createSection(secondContext, 'phase4:section', 'Switch section', 0);
        await createTask(secondContext, fixture.leaf.id, { sectionId: secondSection.id });
        const editorBUid = `crm-projects-browser-editor-${Date.now()}`;
        const editorBEmail = `${editorBUid}@demo.crm-projects.test`;
        await context.auth.createUser({ uid: editorBUid, email: editorBEmail, password: PASSWORD });
        const editorAUid = 'crm-projects-staff-editor';
        const [editorAProfile, editorAWorkforce, editorAAuth] = await Promise.all([
            context.db.collection('users').doc(editorAUid).get(),
            context.db.collection('crmWorkforceAccounts').doc(editorAUid).get(),
            context.auth.getUser(editorAUid)
        ]);
        assert.ok(editorAProfile.exists && editorAWorkforce.exists, 'Editor B requires the canonical eligible Editor fixture.');
        await context.db.collection('users').doc(editorBUid).set({ ...editorAProfile.data(), uid: editorBUid, email: editorBEmail });
        await context.db.collection('crmWorkforceAccounts').doc(editorBUid).set({ ...editorAWorkforce.data(), uid: editorBUid });
        await context.auth.setCustomUserClaims(editorBUid, editorAAuth.customClaims || {});
        expectStatus(await jsonRequest(context.server, `/api/projects/${PROJECT_ID}/members`, ownerToken, 'POST', {
            operationId: 'phase4-browser-editor-b-member', uid: editorBUid, role: 'Editor'
        }), 200, 'second Editor membership for same-scope account isolation');

        // The existing local app shell is served by the same authenticated API server;
        // the page's Firebase Auth state is the persistence boundary under test.
        context.api.get('/api/config', (_req, res) => res.json(browserConfig()));
        context.api.get('/favicon.ico', (_req, res) => res.status(204).end());
        context.api.get('/crm-admin.html', (_req, res) => {
            const rawHtml = fs.readFileSync(path.join(PUBLIC_DIR, 'crm-admin.html'), 'utf8');
            const document = buildLocalCrmAdminDocument(rawHtml, process.env, 'demo-crm-projects');
            res.setHeader('Content-Security-Policy', document.policy);
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.type('html').send(document.html);
        });
        context.api.use(express.static(PUBLIC_DIR));
        context.api.get('/__phase4-login', (_req, res) => res.type('html').send(loginPage()));
        server = context.server;

        browser = await chromium.launch({ channel: 'chrome', headless: true });
        const ownerContext = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
        const ownerPage = await ownerContext.newPage();
        capturePage(ownerPage);
        ownerPage.on('response', (response) => { if (response.url().includes('/api/projects/')) network.push({ method: response.request().method(), url: response.url(), status: response.status() }); });
        await openRole(ownerPage, `http://127.0.0.1:${server.address().port}`, USERS.owner);
        await ownerPage.waitForSelector(`#projects-board-project-select option[value="${PROJECT_ID}"]`, { state: 'attached', timeout: 30000 });
        await selectProjectTask(ownerPage, PROJECT_ID, fixture.tasks.map((task) => task.id));
        assert.match(await ownerPage.locator('#projects-board-detail-body').innerText(), new RegExp(fixture.leaf.id));

        // Phase4 UI contract: a dedicated stable discussion surface keeps the
        // composer/draft attached to the selected task through detail rerenders.
        const discussion = await firstVisible(ownerPage, [
            '#projects-board-discussion',
            '#projects-board-detail-discussion',
            '[data-projects-discussion]',
            '[data-discussion-thread]'
        ], 'discussion panel');
        const composer = await firstVisible(ownerPage, [
            '#projects-board-discussion-input',
            '#projects-discussion-composer textarea',
            '[data-discussion-composer] textarea',
            'textarea[aria-label*="discussion" i]',
            'textarea[placeholder*="discussion" i]'
        ], 'discussion composer');
        assert.strictEqual(await ownerPage.locator('#projects-board-discussion-file').count(), 1, 'Owner detail must expose the private attachment input.');
        // The task detail is a modal. Close it before entering the separate
        // utility workspace so the modal backdrop does not block the rail.
        await ownerPage.locator('#btn-projects-board-close-detail').click();
        await ownerPage.locator('#projects-board-detail').waitFor({ state: 'hidden', timeout: 30000 });
        await ownerPage.locator('#projects-utab-recovery').click();
        await firstVisible(ownerPage, ['#projects-board-recovery', '[aria-label="Project recovery controls"]'], 'project recovery shell');
        assert.strictEqual(await ownerPage.locator('details[data-recovery-disclosure]').evaluate((element) => element.open), false, 'recovery catalog must start collapsed so the primary board remains visible.');
        const primaryRowBounds = await ownerPage.locator(`[data-task-id="${fixture.tasks[0].id}"]`).first().boundingBox();
        assert.ok(primaryRowBounds && primaryRowBounds.y >= 0 && primaryRowBounds.y + primaryRowBounds.height <= ownerPage.viewportSize().height, 'the primary task board must be visible in the initial Chrome viewport.');
        await ownerPage.screenshot({ path: path.join(artifactDir, 'phase4-recovery-collapsed-board.png') });
        // The native disclosure is keyboard accessible, not only pointer driven.
        await ownerPage.locator('summary[data-recovery-toggle]').focus();
        await ownerPage.locator('summary[data-recovery-toggle]').press('Enter');
        assert.strictEqual(await ownerPage.locator('details[data-recovery-disclosure]').evaluate((element) => element.open), true, 'Enter must expand the native recovery disclosure.');
        await openRecovery(ownerPage);
        await ownerPage.locator('[data-recovery-entries] > .crm-projects-recovery-row').first().waitFor({ state: 'visible', timeout: 30000 });
        assert.ok(await ownerPage.locator('[data-recovery-refresh]').count() === 1, 'Owner must expose recovery catalog refresh.');
        assert.ok(await ownerPage.locator('[data-recovery-history]').count() === 1, 'Owner must expose project recovery history.');
        await ownerPage.locator('[aria-label="Close workspace tools"]').click();
        await ownerPage.locator('#projects-utility-workspace').waitFor({ state: 'hidden', timeout: 30000 });
        await selectProjectTask(ownerPage, PROJECT_ID, fixture.tasks.map((task) => task.id));
        const draftText = 'Chrome draft survives a selected-task detail rerender.';
        await composer.fill(draftText);
        await composer.focus();
        await composer.press('End');
        // The refresh control belongs to the underlying board while task detail
        // is a modal; force the non-destructive refresh event through the modal
        // boundary and assert the draft survives the resulting rerender.
        await ownerPage.locator('#btn-projects-board-refresh').click({ force: true });
        await ownerPage.waitForFunction((expected) => {
            const input = document.getElementById('projects-board-discussion-input');
            return input?.value === expected && input.selectionStart === expected.length && input.selectionEnd === expected.length;
        }, draftText, { timeout: 30000 });
        assert.strictEqual(await composer.inputValue(), draftText);
        const sendButton = await firstVisible(ownerPage, [
            '#btn-projects-board-discussion-send',
            '#btn-projects-discussion-send',
            '[data-discussion-send]',
            'button:has-text("Send")',
            'button:has-text("Post")'
        ], 'discussion send button');
        let heldPostSeen = false;
        let heldPostCount = 0;
        let heldGetSeen = false;
        let holdDiscussionGet = false;
        const { promise: heldPost, release: releaseHeldPost } = barrier();
        const { promise: heldGet, release: releaseHeldGet } = barrier();
        await ownerPage.route(`**/api/projects/${PROJECT_ID}/tasks/${encodeURIComponent(fixture.leaf.id)}/**`, async (route) => {
            if (route.request().method() === 'POST' && route.request().url().includes('/discussion/')) {
                heldPostSeen = true;
                heldPostCount += 1;
                await heldPost;
            }
            if (holdDiscussionGet && route.request().method() === 'GET' && route.request().url().includes('/discussion?')) {
                const response = await route.fetch();
                heldGetSeen = true;
                await heldGet;
                await route.fulfill({ response });
                return;
            }
            await route.continue();
        });
        await sendButton.click();
        await ownerPage.waitForFunction(() => document.getElementById('btn-projects-board-discussion-send')?.disabled === true, null, { timeout: 30000 });
        await ownerPage.locator('#projects-board-discussion-form').evaluate((form) => form.requestSubmit());
        // The route callback runs outside page JS; wait for the Node-side flag without
        // allowing a held response to update a different project after switching.
        for (let attempt = 0; attempt < 20 && !heldPostSeen; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 50));
        assert.strictEqual(heldPostSeen, true, 'discussion POST must be observed before project switching.');
        assert.strictEqual(heldPostCount, 1, 'pending discussion submission must suppress duplicate POSTs.');
        await selectProjectTask(ownerPage, SECOND_PROJECT_ID, [fixture.leaf.id]);
        const secondComposer = ownerPage.locator('#projects-board-discussion-input');
        assert.strictEqual(await secondComposer.inputValue(), '', 'a second project with the same task ID must not inherit the first project draft.');
        assert.strictEqual(await ownerPage.locator('article[data-message-id] p').filter({ hasText: draftText }).count(), 0, 'a held first-project response must not appear in the second project.');
        releaseHeldPost();
        await ownerPage.waitForTimeout(150);
        assert.strictEqual(await secondComposer.inputValue(), '', 'releasing a stale first-project response must not repopulate the second-project draft.');
        assert.strictEqual(await ownerPage.locator('article[data-message-id] p').filter({ hasText: draftText }).count(), 0, 'the released first-project response must remain absent from the second project.');
        await selectProjectTask(ownerPage, PROJECT_ID, fixture.tasks.map((task) => task.id));
        await firstVisible(ownerPage, ['#projects-board-discussion', '#projects-board-detail-discussion', '[data-projects-discussion]', '[data-discussion-thread]'], 'discussion after project switch');
        const postedMessage = ownerPage.locator('article[data-message-id]').filter({ hasText: draftText });
        await postedMessage.first().waitFor({ state: 'visible', timeout: 30000 });
        assert.strictEqual(await postedMessage.count(), 1, 'the held response must persist exactly once in its original project.');
        assert.strictEqual(await ownerPage.locator('#projects-board-discussion-input').inputValue(), '', 'a successfully posted original-project draft must be cleared after the persisted message is loaded.');
        assert.strictEqual(await ownerPage.locator('#btn-projects-board-discussion-retry').isHidden(), true, 'an exactly completed message must not leave a stale Retry control.');
        const newerDraft = 'Newer unsent draft after the earlier message completed.';
        const newerCaret = newerDraft.length - 1;
        const newerDraftStates = [];
        const captureNewerDraft = async (stage) => {
            const state = await composer.evaluate((input) => ({ body: input.value, start: input.selectionStart, end: input.selectionEnd, disabled: input.disabled }));
            newerDraftStates.push({ stage, ...state });
            fs.writeFileSync(path.join(artifactDir, 'phase4-newer-draft-caret.json'), `${JSON.stringify(newerDraftStates, null, 2)}\n`, 'utf8');
            return state;
        };
        await composer.fill(newerDraft);
        await composer.focus();
        await composer.press('End');
        await composer.press('ArrowLeft');
        assert.deepStrictEqual(await captureNewerDraft('typed'), { body: newerDraft, start: newerCaret, end: newerCaret, disabled: false }, 'the new draft must begin with the intended caret position.');

        // Hold a discussion reload itself, switch projects, then release it. A
        // stale GET must not replace the second project's selected task, draft,
        // or message list after the response arrives.
        holdDiscussionGet = true;
        // Select another task and return through the UI: board refresh alone
        // preserves the discussion tuple and intentionally does not reload it.
        await selectProjectTask(ownerPage, PROJECT_ID, [fixture.tasks[0].id]);
        await captureNewerDraft('other-task');
        await selectProjectTask(ownerPage, PROJECT_ID, [fixture.leaf.id]);
        await captureNewerDraft('return-task-held-get');
        for (let attempt = 0; attempt < 20 && !heldGetSeen; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 50));
        assert.strictEqual(heldGetSeen, true, 'discussion GET must be observed before switching projects.');
        await selectProjectTask(ownerPage, SECOND_PROJECT_ID, [fixture.leaf.id]);
        await captureNewerDraft('other-project');
        assert.strictEqual(await ownerPage.locator('#projects-board-discussion-input').inputValue(), '', 'a held discussion GET must not carry the original project draft into the second project.');
        assert.strictEqual(await ownerPage.locator('article[data-message-id] p').filter({ hasText: draftText }).count(), 0, 'a held discussion GET must not render the original project message in the second project.');
        releaseHeldGet();
        await ownerPage.waitForTimeout(150);
        assert.strictEqual(await ownerPage.locator('#projects-board-discussion-input').inputValue(), '', 'releasing a stale discussion GET must preserve the second-project draft.');
        assert.strictEqual(await ownerPage.locator('article[data-message-id] p').filter({ hasText: draftText }).count(), 0, 'releasing a stale discussion GET must preserve the second-project message list.');
        await ownerPage.unroute(`**/api/projects/${PROJECT_ID}/tasks/${encodeURIComponent(fixture.leaf.id)}/**`);
        await selectProjectTask(ownerPage, PROJECT_ID, fixture.tasks.map((task) => task.id));
        await postedMessage.first().waitFor({ state: 'visible', timeout: 30000 });
        assert.deepStrictEqual(await captureNewerDraft('returned-original-project'), { body: newerDraft, start: newerCaret, end: newerCaret, disabled: false }, 'loading the old completed message must preserve the newer draft and caret.');
        assert.strictEqual(await ownerPage.locator('#btn-projects-board-discussion-retry').isHidden(), true, 'loading the old completed message must preserve the newer draft without resurrecting its Retry.');

        // Returning to the same project before a held recovery POST finishes
        // must settle the visible retry and refresh the active catalog itself.
        await setRecoveryFilter(ownerPage, 'active', 'task');
        const lateRecoveryRow = await recoveryRow(ownerPage, fixture.leaf.id);
        const latePreviewResponse = ownerPage.waitForResponse((response) => response.request().method() === 'GET' && response.url().includes('/recovery/preview?'));
        await lateRecoveryRow.locator('[data-action="archive"]').click();
        assert.strictEqual((await latePreviewResponse).status(), 200, 'late recovery setup preview must succeed.');
        await ownerPage.locator('[data-recovery-preview]').waitFor({ state: 'visible', timeout: 30000 });
        let lateRecoverySeen = false;
        const { promise: lateRecoveryBarrier, release: releaseLateRecovery } = barrier();
        const lateRecoveryRoute = `**/api/projects/${PROJECT_ID}/tasks/${encodeURIComponent(fixture.leaf.id)}/archive`;
        await ownerPage.route(lateRecoveryRoute, async (route) => {
            lateRecoverySeen = true;
            await lateRecoveryBarrier;
            await route.continue();
        });
        try {
            await ownerPage.locator('[data-recovery-apply]').click();
            for (let attempt = 0; attempt < 40 && !lateRecoverySeen; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 50));
            assert.strictEqual(lateRecoverySeen, true, 'the recovery request must be held before the same-account roundtrip.');
            await selectProjectTask(ownerPage, SECOND_PROJECT_ID, [fixture.leaf.id]);
            await selectProjectTask(ownerPage, PROJECT_ID, fixture.tasks.map((task) => task.id));
            await openRecovery(ownerPage);
            await ownerPage.locator('[data-recovery-retry]').waitFor({ state: 'visible', timeout: 30000 });
            const lateRecoveryResponse = ownerPage.waitForResponse((response) => response.request().method() === 'POST'
                && new URL(response.url()).pathname.endsWith(`/tasks/${encodeURIComponent(fixture.leaf.id)}/archive`));
            releaseLateRecovery();
            assert.strictEqual((await lateRecoveryResponse).status(), 200, 'the original late recovery request must succeed.');
            await ownerPage.locator('[data-recovery-retry]').waitFor({ state: 'hidden', timeout: 15000 });
            await ownerPage.locator('[data-recovery-entries] > li').filter({ hasText: fixture.leaf.id }).waitFor({ state: 'hidden', timeout: 15000 });
        } finally {
            releaseLateRecovery();
            await ownerPage.unroute(lateRecoveryRoute);
        }
        await setRecoveryFilter(ownerPage, 'archived', 'task');
        await applyRecoveryAction(ownerPage, fixture.leaf.id, 'restore');
        await selectProjectTask(ownerPage, PROJECT_ID, fixture.tasks.map((task) => task.id));

        // Exercise the real member picker, then reload the selected task and
        // prove the mention is persisted in the rendered discussion record.
        const mentionBody = 'Owner mention picker discussion update.';
        const mentionControl = ownerPage.locator('#projects-board-discussion-mention');
        await ownerPage.waitForFunction(() => Array.from(document.querySelectorAll('#projects-board-discussion-mention option')).some((option) => option.value === 'crm-projects-staff-editor'));
        await mentionControl.selectOption('crm-projects-staff-editor');
        await ownerPage.locator('#projects-board-discussion-input').fill(mentionBody);
        const mentionResponse = ownerPage.waitForResponse((response) => response.request().method() === 'POST'
            && response.url().includes(`/api/projects/${PROJECT_ID}/tasks/${encodeURIComponent(fixture.leaf.id)}/discussion/messages`)
            && !response.url().includes('/attachments'));
        await ownerPage.locator('#btn-projects-board-discussion-send').click();
        assert.strictEqual((await mentionResponse).status(), 200, 'Chrome mention message creation must succeed.');
        const mentionArticle = ownerPage.locator('article[data-message-id]').filter({ hasText: mentionBody }).first();
        await mentionArticle.waitFor({ state: 'visible', timeout: 30000 });
        assert.match(await mentionArticle.innerText(), /@crm-projects-staff-editor/, 'Chrome mention picker must render the selected member.');
        await ownerPage.reload({ waitUntil: 'domcontentloaded' });
        await ownerPage.waitForSelector('#projects-board-workspace:not([hidden])', { timeout: 30000 });
        await selectProjectTask(ownerPage, PROJECT_ID, fixture.tasks.map((task) => task.id));
        const reloadedMentionArticle = ownerPage.locator('article[data-message-id]').filter({ hasText: mentionBody }).first();
        await reloadedMentionArticle.waitFor({ state: 'visible', timeout: 30000 });
        assert.match(await reloadedMentionArticle.innerText(), /@crm-projects-staff-editor/, 'Chrome mention must survive a real reload.');

        const replyParentId = await reloadedMentionArticle.getAttribute('data-message-id');
        const replyBody = 'Chrome reply retains its exact parent after reload.';
        await reloadedMentionArticle.locator('[data-discussion-reply]').click();
        await composer.fill(replyBody);
        const replyResponse = ownerPage.waitForResponse((response) => response.request().method() === 'POST'
            && new URL(response.url()).pathname.endsWith(`/tasks/${encodeURIComponent(fixture.leaf.id)}/discussion/messages`));
        await ownerPage.locator('#btn-projects-board-discussion-send').click();
        const savedReplyResponse = await replyResponse;
        assert.strictEqual(savedReplyResponse.status(), 200, 'the actual Chrome Reply control must post successfully.');
        const savedReply = (await savedReplyResponse.json()).message;
        assert.strictEqual(savedReply.parentMessageId, replyParentId, 'the Reply control must persist the exact selected parent message.');
        const nestedReply = ownerPage.locator(`article[data-message-id="${replyParentId}"] article[data-message-id="${savedReply.id}"]`);
        await nestedReply.getByText(replyBody, { exact: true }).waitFor({ state: 'visible', timeout: 30000 });

        // The leaf already has persisted messages; exercise every ancestor
        // depth through the same real composer, then reload each scoped thread.
        const depthMessages = [];
        for (let depth = 0; depth < fixture.tasks.length - 1; depth += 1) {
            const task = fixture.tasks[depth];
            await selectProjectTask(ownerPage, PROJECT_ID, fixture.tasks.slice(0, depth + 1).map((item) => item.id));
            const body = `Chrome discussion at task depth ${depth}: ${task.id}.`;
            await composer.fill(body);
            const depthResponse = ownerPage.waitForResponse((response) => response.request().method() === 'POST'
                && new URL(response.url()).pathname.endsWith(`/tasks/${encodeURIComponent(task.id)}/discussion/messages`));
            await ownerPage.locator('#btn-projects-board-discussion-send').click();
            const savedResponse = await depthResponse;
            assert.strictEqual(savedResponse.status(), 200, `task depth ${depth} discussion must save through Chrome.`);
            const message = (await savedResponse.json()).message;
            assert.strictEqual(message.body, body);
            await ownerPage.locator(`article[data-message-id="${message.id}"]`).getByText(body, { exact: true }).waitFor({ state: 'visible', timeout: 30000 });
            depthMessages.push({ depth, body, id: message.id });
        }
        await ownerPage.reload({ waitUntil: 'domcontentloaded' });
        await ownerPage.waitForSelector('#projects-board-workspace:not([hidden])', { timeout: 30000 });
        for (const item of depthMessages) {
            await selectProjectTask(ownerPage, PROJECT_ID, fixture.tasks.slice(0, item.depth + 1).map((task) => task.id));
            await ownerPage.locator(`article[data-message-id="${item.id}"]`).getByText(item.body, { exact: true }).waitFor({ state: 'visible', timeout: 30000 });
            assert.strictEqual(await ownerPage.locator(`article[data-message-id="${savedReply.id}"]`).count(), 0, 'the leaf reply must not appear in an ancestor thread.');
        }
        await selectProjectTask(ownerPage, PROJECT_ID, fixture.tasks.map((task) => task.id));
        await nestedReply.getByText(replyBody, { exact: true }).waitFor({ state: 'visible', timeout: 30000 });
        for (const item of depthMessages) assert.strictEqual(await ownerPage.locator(`article[data-message-id="${item.id}"]`).count(), 0, 'ancestor messages must remain absent from the leaf thread.');
        await ownerPage.screenshot({ path: path.join(artifactDir, 'phase4-discussion-reply-depth.png'), fullPage: true });

        // A same-project account switch must isolate the live discussion scope
        // by UID. Keep an Editor A post in flight, switch to Editor B without
        // changing project/task, then prove B sees no A draft/mention/retry.
        const editorContext = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
        const editorPage = await editorContext.newPage();
        capturePage(editorPage);
        await openRole(editorPage, `http://127.0.0.1:${server.address().port}`, 'staff-editor@demo.crm-projects.test');
        await selectProjectTask(editorPage, PROJECT_ID, fixture.tasks.map((task) => task.id));
        const editorComposer = editorPage.locator('#projects-board-discussion-input');
        const editorMention = editorPage.locator('#projects-board-discussion-mention');
        await editorPage.waitForFunction(() => Array.from(document.querySelectorAll('#projects-board-discussion-mention option')).some((option) => option.value === 'crm-projects-viewer'));
        await editorMention.selectOption('crm-projects-viewer');
        const editorBody = 'Editor A same-project account isolation update.';
        await editorComposer.fill(editorBody);
        let heldEditorPostSeen = false;
        let heldEditorPostCount = 0;
        const { promise: heldEditorPost, release: releaseEditorPost } = barrier();
        await editorPage.route(`**/api/projects/${PROJECT_ID}/tasks/${encodeURIComponent(fixture.leaf.id)}/discussion/messages`, async (route) => {
            if (route.request().method() === 'POST' && !heldEditorPostSeen) {
                heldEditorPostSeen = true;
                heldEditorPostCount += 1;
                await heldEditorPost;
            }
            await route.continue();
        });
        await editorPage.locator('#btn-projects-board-discussion-send').click();
        await editorPage.waitForFunction(() => document.getElementById('btn-projects-board-discussion-send')?.disabled === true, null, { timeout: 30000 });
        await editorPage.locator('#projects-board-discussion-form').evaluate((form) => form.requestSubmit());
        for (let attempt = 0; attempt < 30 && !heldEditorPostSeen; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 50));
        assert.strictEqual(heldEditorPostSeen, true, 'same-project Editor A POST must be held before account switching.');
        assert.strictEqual(heldEditorPostCount, 1, 'same-project pending Editor A POST must suppress duplicates.');
        await switchAccountInPlace(editorPage, editorBEmail);
        await selectProjectTask(editorPage, PROJECT_ID, fixture.tasks.map((task) => task.id));
        assert.strictEqual(await editorPage.locator('#projects-board-discussion-input').inputValue(), '', 'Editor B must not inherit Editor A same-task draft.');
        assert.strictEqual(await editorPage.locator('#projects-board-discussion-mention').locator('option:checked').count(), 0, 'Editor B must not inherit Editor A mention selection.');
        assert.strictEqual(await editorPage.locator('article[data-message-id] p').filter({ hasText: editorBody }).count(), 0, 'Editor B must not render Editor A held message.');
        releaseEditorPost();
        await editorPage.waitForTimeout(250);
        assert.strictEqual(await editorPage.locator('#projects-board-discussion-input').inputValue(), '', 'late Editor A completion must not repopulate Editor B draft.');
        assert.ok(await editorPage.locator('article[data-message-id] p').filter({ hasText: editorBody }).count() <= 1, 'a committed shared message must not duplicate in Editor B.');
        await editorPage.unroute(`**/api/projects/${PROJECT_ID}/tasks/${encodeURIComponent(fixture.leaf.id)}/discussion/messages`);
        await switchAccountInPlace(editorPage, 'staff-editor@demo.crm-projects.test');
        await selectProjectTask(editorPage, PROJECT_ID, fixture.tasks.map((task) => task.id));
        assert.strictEqual(await editorPage.locator('#projects-board-discussion-input').inputValue(), '', 'auth reload must clear the in-memory Editor A draft.');
        assert.strictEqual(await editorPage.locator('#projects-board-discussion-mention').locator('option:checked').count(), 0, 'auth reload must clear the in-memory Editor A mention selection.');

        // Recovery retry state is durable per actor. Hold Editor A's archive
        // request, switch to Editor B, and prove B has no retry or stale action;
        // returning to A must restore the exact retry request for A only.
        await setRecoveryFilter(editorPage, 'active', 'task');
        const editorRecoveryRow = await recoveryRow(editorPage, fixture.leaf.id);
        const editorPreviewResponse = editorPage.waitForResponse((response) => response.request().method() === 'GET' && response.url().includes('/recovery/preview?'));
        await editorRecoveryRow.locator('[data-action="archive"]').click();
        assert.strictEqual((await editorPreviewResponse).status(), 200, 'Editor A recovery preview must succeed.');
        const editorRecoveryPreview = editorPage.locator('[data-recovery-preview]');
        await editorRecoveryPreview.waitFor({ state: 'visible', timeout: 30000 });
        let heldEditorRecoverySeen = false;
        const { promise: heldEditorRecovery, release: releaseEditorRecovery } = barrier();
        await editorPage.route(`**/api/projects/${PROJECT_ID}/tasks/${encodeURIComponent(fixture.leaf.id)}/archive`, async (route) => {
            heldEditorRecoverySeen = true;
            await heldEditorRecovery;
            await route.continue();
        });
        await editorPage.locator('[data-recovery-apply]').click();
        for (let attempt = 0; attempt < 30 && !heldEditorRecoverySeen; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 50));
        assert.strictEqual(heldEditorRecoverySeen, true, 'Editor A recovery POST must be held before account switching.');
        await switchAccountInPlace(editorPage, editorBEmail);
        await selectProjectTask(editorPage, PROJECT_ID, [fixture.tasks[0].id]);
        await openRecovery(editorPage);
        assert.strictEqual(await editorPage.locator('[data-recovery-retry]').isHidden(), true, 'Editor B must not inherit Editor A recovery retry state.');
        releaseEditorRecovery();
        await editorPage.waitForTimeout(250);
        await editorPage.unroute(`**/api/projects/${PROJECT_ID}/tasks/${encodeURIComponent(fixture.leaf.id)}/archive`);
        await switchAccountInPlace(editorPage, 'staff-editor@demo.crm-projects.test');
        await selectProjectTask(editorPage, PROJECT_ID, [fixture.tasks[0].id]);
        await openRecovery(editorPage);
        await editorPage.waitForFunction(() => document.querySelector('[data-recovery-retry]')?.hidden === false, null, { timeout: 30000 });
        const editorRetryResponse = editorPage.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith(`/tasks/${encodeURIComponent(fixture.leaf.id)}/archive`));
        await editorPage.locator('[data-recovery-retry]').click();
        assert.strictEqual((await editorRetryResponse).status(), 200, 'Editor A retry must resend the exact actor-bound archive request.');
        await setRecoveryFilter(editorPage, 'archived', 'task');
        await applyRecoveryAction(editorPage, fixture.leaf.id, 'restore');
        await editorContext.close();
        await selectProjectTask(ownerPage, PROJECT_ID, fixture.tasks.map((task) => task.id));
        await postedMessage.first().waitFor({ state: 'visible', timeout: 30000 });

        // Exercise the real Chrome edit and Owner moderation flows, including
        // prompt-driven controls rendered by the discussion client.
        const messageId = await postedMessage.first().getAttribute('data-message-id');
        await ownerPage.once('dialog', (dialog) => dialog.accept('Chrome edited discussion body.'));
        await postedMessage.locator('[data-discussion-edit]').click();
        const editedArticle = ownerPage.locator(`article[data-message-id="${messageId}"]`);
        await editedArticle.getByText('Chrome edited discussion body.', { exact: true }).waitFor({ state: 'visible', timeout: 30000 });
        await ownerPage.once('dialog', (dialog) => dialog.accept('Chrome Owner moderation reason.'));
        const moderationResponse = ownerPage.waitForResponse((response) => response.request().method() === 'POST'
            && new URL(response.url()).pathname.endsWith(`/discussion/messages/${encodeURIComponent(messageId)}/moderate`));
        await editedArticle.locator('[data-discussion-moderate]').click();
        assert.strictEqual((await moderationResponse).status(), 200, 'Chrome Owner moderation must succeed before checking its rendered action.');
        await expectAttribute(editedArticle.locator('[data-discussion-moderate]'), 'data-moderation-action', 'restore');
        const messageHistoryResponse = ownerPage.waitForResponse((response) => response.request().method() === 'GET'
            && response.url().includes(`/discussion/messages/${encodeURIComponent(messageId)}/history?`));
        await editedArticle.locator('[data-discussion-history]').click();
        assert.strictEqual((await messageHistoryResponse).status(), 200, 'Chrome message history read must succeed.');
        await ownerPage.locator('#projects-board-discussion-history').waitFor({ state: 'visible', timeout: 30000 });
        await openRecovery(ownerPage);
        const discussionHistoryResponse = ownerPage.waitForResponse((response) => response.request().method() === 'GET' && response.url().includes(`/api/projects/${PROJECT_ID}/history?`));
        await ownerPage.locator('[data-recovery-history]').click();
        assert.strictEqual((await discussionHistoryResponse).status(), 200, 'Chrome project history read must succeed.');
        await ownerPage.waitForFunction(() => {
            const value = document.getElementById('projects-board-recovery-status')?.innerText || '';
            return value && !/No project history yet/i.test(value);
        }, null, { timeout: 30000 });
        await ownerPage.locator('[aria-label="Close workspace tools"]').click();
        await ownerPage.locator('#projects-utility-workspace').waitFor({ state: 'hidden', timeout: 30000 });
        await selectProjectTask(ownerPage, PROJECT_ID, fixture.tasks.map((task) => task.id));

        // The form's actual multipart path must publish bytes only after the
        // message exists, and the rendered attachment control must download
        // through the authenticated task/message route.
        const conflictBody = 'Chrome attachment conflict keeps one message.';
        await ownerPage.locator('#projects-board-discussion-input').fill(conflictBody);
        await ownerPage.locator('#projects-board-discussion-file').setInputFiles({
            name: 'phase4-browser-conflict.txt',
            mimeType: 'text/plain',
            buffer: Buffer.from('phase4 browser conflict bytes\n', 'utf8')
        });
        await ownerPage.route(`**/api/projects/${PROJECT_ID}/tasks/${encodeURIComponent(fixture.leaf.id)}/discussion/messages/*/attachments`, async (route) => {
            injectedConflictUrls.add(route.request().url());
            await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ success: false, message: 'Attachment reservation conflict.' }) });
        });
        const conflictMessageResponse = ownerPage.waitForResponse((response) => response.request().method() === 'POST'
            && response.url().includes(`/api/projects/${PROJECT_ID}/tasks/${encodeURIComponent(fixture.leaf.id)}/discussion/messages`)
            && !response.url().includes('/attachments'));
        await ownerPage.locator('#btn-projects-board-discussion-send').click();
        assert.strictEqual((await conflictMessageResponse).status(), 200, 'Chrome conflict setup message must commit exactly once.');
        await ownerPage.locator('#btn-projects-board-discussion-abandon-upload').waitFor({ state: 'visible', timeout: 30000 });
        await ownerPage.locator('#btn-projects-board-discussion-abandon-upload').click();
        await ownerPage.unroute(`**/api/projects/${PROJECT_ID}/tasks/${encodeURIComponent(fixture.leaf.id)}/discussion/messages/*/attachments`);
        const conflictArticle = ownerPage.locator('article[data-message-id]').filter({ hasText: conflictBody }).first();
        await conflictArticle.waitFor({ state: 'visible', timeout: 30000 });
        assert.strictEqual(await ownerPage.locator('article[data-message-id]').filter({ hasText: conflictBody }).count(), 1, 'attachment conflict must not duplicate the committed message.');
        assert.strictEqual(await conflictArticle.locator('[data-discussion-attachment]').count(), 0, 'abandoning an attachment conflict must keep the message without a file.');
        assert.strictEqual(await ownerPage.locator('#projects-board-discussion-input').inputValue(), '', 'abandoning an attachment conflict must clear the draft.');

        const attachmentBody = 'Chrome attachment discussion body.';
        await ownerPage.locator('#projects-board-discussion-input').fill(attachmentBody);
        await ownerPage.locator('#projects-board-discussion-file').setInputFiles({
            name: 'phase4-browser.txt',
            mimeType: 'text/plain',
            buffer: Buffer.from('phase4 browser private bytes\n', 'utf8')
        });
        const attachmentMessageResponse = ownerPage.waitForResponse((response) => response.request().method() === 'POST'
            && response.url().includes(`/api/projects/${PROJECT_ID}/tasks/${encodeURIComponent(fixture.leaf.id)}/discussion/messages`)
            && !response.url().includes('/attachments'));
        let attachmentMessagePosts = 0;
        let attachmentUploads = 0;
        const { promise: heldAttachmentMessage, release: releaseAttachmentMessage } = barrier();
        const attachmentMessageRoute = `**/api/projects/${PROJECT_ID}/tasks/${encodeURIComponent(fixture.leaf.id)}/discussion/messages`;
        const attachmentUploadRoute = `${attachmentMessageRoute}/*/attachments`;
        await ownerPage.route(attachmentMessageRoute, async (route) => {
            if (route.request().method() === 'POST') {
                attachmentMessagePosts += 1;
                await heldAttachmentMessage;
            }
            await route.continue();
        });
        await ownerPage.route(attachmentUploadRoute, async (route) => {
            if (route.request().method() === 'POST') attachmentUploads += 1;
            await route.continue();
        });
        await ownerPage.locator('#btn-projects-board-discussion-send').click();
        for (let attempt = 0; attempt < 40 && attachmentMessagePosts === 0; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 50));
        assert.strictEqual(attachmentMessagePosts, 1, 'hold the file-bearing message before navigating away.');
        await selectProjectTask(ownerPage, SECOND_PROJECT_ID, [fixture.leaf.id]);
        releaseAttachmentMessage();
        assert.strictEqual((await attachmentMessageResponse).status(), 200, 'Chrome attachment message creation must succeed.');
        assert.strictEqual(attachmentUploads, 0, 'navigation before message completion must defer the original attachment upload.');
        await selectProjectTask(ownerPage, PROJECT_ID, fixture.tasks.map((task) => task.id));
        const attachmentArticle = ownerPage.locator('article[data-message-id]').filter({ hasText: attachmentBody }).first();
        await attachmentArticle.waitFor({ state: 'visible', timeout: 30000 });
        assert.strictEqual(await attachmentArticle.locator('[data-discussion-attachment]').count(), 0, 'the committed message must initially have no uploaded attachment.');
        assert.strictEqual(await composer.inputValue(), attachmentBody, 'the unfinished file request must retain its draft on return.');
        await ownerPage.locator('#btn-projects-board-discussion-retry').waitFor({ state: 'visible', timeout: 30000 });
        await ownerPage.locator('#btn-projects-board-discussion-retry').click();
        const attachmentButton = attachmentArticle.locator('[data-discussion-attachment]').first();
        await attachmentButton.waitFor({ state: 'visible', timeout: 30000 });
        assert.strictEqual(attachmentMessagePosts, 1, 'attachment retry must reuse the committed message rather than post it again.');
        assert.strictEqual(attachmentUploads, 1, 'attachment retry must upload the retained file exactly once.');
        assert.strictEqual(await ownerPage.locator('article[data-message-id]').filter({ hasText: attachmentBody }).count(), 1, 'attachment retry must render exactly one committed message.');
        assert.strictEqual(await composer.inputValue(), '', 'completed attachment retry must clear its own draft.');
        await ownerPage.unroute(attachmentMessageRoute);
        await ownerPage.unroute(attachmentUploadRoute);
        const attachmentDownload = ownerPage.waitForResponse((response) => response.request().method() === 'GET' && response.url().includes('/attachments/') && response.url().endsWith('/download'));
        await attachmentButton.click();
        assert.strictEqual((await attachmentDownload).status(), 200, 'Chrome attachment download must succeed for the Owner.');

        // The recovery catalog owns lifecycle actions and previews. Exercise
        // task, section, inherited-ancestor, and project archive/restore from
        // the real UI, including the explicit active destination path.
        await setRecoveryFilter(ownerPage, 'active', 'task');
        await applyRecoveryAction(ownerPage, fixture.leaf.id, 'archive');
        assert.strictEqual(await ownerPage.locator(`[data-task-id="${fixture.leaf.id}"]`).count(), 0, 'an archived task must disappear from the active board.');
        await setRecoveryFilter(ownerPage, 'archived', 'task');
        assert.ok(await recoveryRow(ownerPage, fixture.leaf.id));
        await applyRecoveryAction(ownerPage, fixture.leaf.id, 'restore');

        await setRecoveryFilter(ownerPage, 'active', 'task');
        await applyRecoveryAction(ownerPage, fixture.leaf.id, 'trash');
        assert.strictEqual(await ownerPage.locator(`[data-task-id="${fixture.leaf.id}"]`).count(), 0, 'a trashed task must disappear from the active board.');
        await setRecoveryFilter(ownerPage, 'trashed', 'task');
        assert.ok(await recoveryRow(ownerPage, fixture.leaf.id), 'a trashed task must remain reachable from the Trash catalog.');
        await applyRecoveryAction(ownerPage, fixture.leaf.id, 'restore');

        await setRecoveryFilter(ownerPage, 'active', 'section');
        await applyRecoveryAction(ownerPage, 'Phase4 section', 'archive');
        await setRecoveryFilter(ownerPage, 'archived', 'section');
        await applyRecoveryAction(ownerPage, 'Phase4 section', 'restore');

        const middleTaskId = fixture.tasks[1].id;
        await setRecoveryFilter(ownerPage, 'active', 'task');
        await applyRecoveryAction(ownerPage, fixture.leaf.id, 'archive');
        await setRecoveryFilter(ownerPage, 'active', 'task');
        await applyRecoveryAction(ownerPage, middleTaskId, 'archive');
        await setRecoveryFilter(ownerPage, 'archived', 'task');
        await applyRecoveryAction(ownerPage, fixture.leaf.id, 'restore', { restoreChain: true });

        // Keep a separately archived ancestor so the explicit active
        // destination path is exercised after the real chain restore.
        await setRecoveryFilter(ownerPage, 'active', 'task');
        await applyRecoveryAction(ownerPage, middleTaskId, 'archive');
        await setRecoveryFilter(ownerPage, 'archived', 'task');
        await applyRecoveryAction(ownerPage, fixture.leaf.id, 'restore', { destinationLabel: 'Phase4 section' });
        await setRecoveryFilter(ownerPage, 'archived', 'task');
        assert.ok(await recoveryRow(ownerPage, middleTaskId), 'the archived ancestor must remain in the recovery catalog after leaf relocation.');

        await setRecoveryFilter(ownerPage, 'active', 'project');
        await applyRecoveryAction(ownerPage, PROJECT_ID, 'archive');
        await setRecoveryFilter(ownerPage, 'archived', 'project');
        await applyRecoveryAction(ownerPage, PROJECT_ID, 'restore', { restoreChain: true });

        // Select the two currently active tasks, apply a bounded bulk status
        // update, reload Chrome, and use project history Undo to restore both.
        await setRecoveryFilter(ownerPage, 'active', 'task');
        const bulkTargetIds = [fixture.tasks[0].id, fixture.leaf.id];
        const beforeBulkTasks = expectStatus(await request(context.server, `/api/projects/${PROJECT_ID}/tasks?pageSize=100`, ownerToken), 200, 'read exact pre-bulk task statuses').tasks || [];
        const originalBulkStatuses = new Map(beforeBulkTasks.filter((task) => bulkTargetIds.includes(task.id)).map((task) => [task.id, task.status]));
        assert.strictEqual(originalBulkStatuses.size, bulkTargetIds.length, 'pre-bulk persisted snapshot must contain both exact target task IDs.');
        for (const targetId of bulkTargetIds) {
            const targetRow = await recoveryRow(ownerPage, targetId);
            await targetRow.locator('[data-select]').check();
        }
        const bulkSelections = ownerPage.locator('[data-recovery-entries] [data-select]:checked');
        assert.strictEqual(await bulkSelections.count(), bulkTargetIds.length, 'Owner bulk UI must select the exact intended task IDs.');
        await ownerPage.locator('[data-recovery-bulk-status]').selectOption('done');
        const bulkResponse = ownerPage.waitForResponse((response) => response.request().method() === 'POST'
            && new URL(response.url()).pathname.endsWith(`/api/projects/${PROJECT_ID}/tasks/bulk`));
        await ownerPage.locator('[data-recovery-bulk]').click();
        assert.strictEqual((await bulkResponse).status(), 200, 'Chrome bulk recovery update must succeed.');
        await ownerPage.reload({ waitUntil: 'domcontentloaded' });
        await ownerPage.waitForSelector('#projects-board-workspace:not([hidden])', { timeout: 30000 });
        await selectProjectTask(ownerPage, PROJECT_ID, [fixture.tasks[0].id]);
        assert.strictEqual(await ownerPage.locator(`[data-task-id="${fixture.tasks[0].id}"] [data-field-kind="status"]`).inputValue(), 'done');
        await selectProjectTask(ownerPage, PROJECT_ID, [fixture.leaf.id]);
        assert.strictEqual(await ownerPage.locator(`[data-task-id="${fixture.leaf.id}"] [data-field-kind="status"]`).inputValue(), 'done');
        await openRecovery(ownerPage);
        const historyResponse = ownerPage.waitForResponse((response) => response.request().method() === 'GET' && response.url().includes(`/api/projects/${PROJECT_ID}/history?`));
        await ownerPage.locator('[data-recovery-history]').click();
        assert.strictEqual((await historyResponse).status(), 200, 'Chrome project history must load bulk operations.');
        const bulkHistoryRow = ownerPage.locator('[data-recovery-history-list] > li').filter({ hasText: 'bulkUpdateTasks' }).first();
        await bulkHistoryRow.waitFor({ state: 'visible', timeout: 30000 });
        const undoResponse = ownerPage.waitForResponse((response) => response.request().method() === 'POST' && /\/operations\/[^/]+\/undo$/.test(new URL(response.url()).pathname));
        await bulkHistoryRow.locator('[data-undo]').click();
        assert.strictEqual((await undoResponse).status(), 200, 'Chrome history Undo must invoke the revision-checked recovery route.');
        await ownerPage.reload({ waitUntil: 'domcontentloaded' });
        await ownerPage.waitForSelector('#projects-board-workspace:not([hidden])', { timeout: 30000 });
        await selectProjectTask(ownerPage, PROJECT_ID, [fixture.tasks[0].id]);
        assert.strictEqual(await ownerPage.locator(`[data-task-id="${fixture.tasks[0].id}"] [data-field-kind="status"]`).inputValue(), originalBulkStatuses.get(fixture.tasks[0].id), 'Chrome history Undo must restore the exact original root status after reload.');
        await selectProjectTask(ownerPage, PROJECT_ID, [fixture.leaf.id]);
        assert.strictEqual(await ownerPage.locator(`[data-task-id="${fixture.leaf.id}"] [data-field-kind="status"]`).inputValue(), originalBulkStatuses.get(fixture.leaf.id), 'Chrome history Undo must restore the exact original leaf status after reload.');

        // Project switching must isolate selection/content, and a reload must keep
        // the second project available through the real Auth/API path.
        await selectProjectTask(ownerPage, SECOND_PROJECT_ID, [fixture.leaf.id]);
        assert.strictEqual(await ownerPage.locator('#projects-board-project-select').inputValue(), SECOND_PROJECT_ID);
        assert.strictEqual(await ownerPage.locator(`[data-task-id="${fixture.leaf.id}"] [data-field-kind="title"]`).inputValue(), fixture.leaf.id);
        await ownerPage.screenshot({ path: path.join(artifactDir, 'phase4-discussions-recovery-owner.png'), fullPage: true });
        await ownerPage.reload({ waitUntil: 'domcontentloaded' });
        await ownerPage.waitForSelector('#projects-board-workspace:not([hidden])', { timeout: 30000 });
        await ownerPage.locator(`#projects-board-project-select option[value="${SECOND_PROJECT_ID}"]`).waitFor({ state: 'attached', timeout: 30000 });
        await selectProjectTask(ownerPage, SECOND_PROJECT_ID, [fixture.leaf.id]);
        assert.strictEqual(await ownerPage.locator('#projects-board-project-select').inputValue(), SECOND_PROJECT_ID);
        assert.strictEqual(await ownerPage.locator(`[data-task-id="${fixture.leaf.id}"] [data-field-kind="title"]`).inputValue(), fixture.leaf.id, 'the second project must retain its canonical task after reload.');

        // Downgrade the same editor identity without touching task revision; a
        // fresh page must recompute mutation controls from current membership.
        const editorUid = 'crm-projects-staff-editor';
        expectStatus(await jsonRequest(context.server, `/api/projects/${PROJECT_ID}/members/${editorUid}`, ownerToken, 'PATCH', {
            operationId: 'phase4-browser-editor-downgrade', role: 'Viewer'
        }), 200, 'editor role downgrade');
        const downgradedEditorContext = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
        const downgradedEditorPage = await downgradedEditorContext.newPage();
        capturePage(downgradedEditorPage);
        await openRole(downgradedEditorPage, `http://127.0.0.1:${server.address().port}`, 'staff-editor@demo.crm-projects.test');
        await selectProjectTask(downgradedEditorPage, PROJECT_ID, [fixture.leaf.id]);
        const downgradedComposer = downgradedEditorPage.locator('#projects-board-discussion-input, #projects-discussion-composer textarea, [data-discussion-composer] textarea, textarea[aria-label*="discussion" i]').first();
        assert.strictEqual(await downgradedComposer.count(), 1, 'the downgraded account must retain its discussion composer.');
        assert.strictEqual(await downgradedComposer.isDisabled(), true, 'same-task role downgrade must disable mutations without a task revision change.');
        await openRecovery(downgradedEditorPage);
        await downgradedEditorPage.locator('[data-recovery-entries] > .crm-projects-recovery-row').first().waitFor({ state: 'visible', timeout: 30000 });
        const downgradedRecoveryActions = downgradedEditorPage.locator('[data-recovery-entries] [data-action]');
        for (let index = 0; index < await downgradedRecoveryActions.count(); index += 1) assert.strictEqual(await downgradedRecoveryActions.nth(index).isDisabled(), true, 'same-task Viewer downgrade must disable recovery actions.');
        await downgradedEditorContext.close();

        // Viewer reload proves persisted role/action boundaries in actual Chrome.
        const viewerContext = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
        const viewerPage = await viewerContext.newPage();
        capturePage(viewerPage);
        viewerPage.on('response', (response) => { if (response.url().includes('/api/projects/')) network.push({ method: response.request().method(), url: response.url(), status: response.status() }); });
        await openRole(viewerPage, `http://127.0.0.1:${server.address().port}`, USERS.viewer);
        await selectProjectTask(viewerPage, PROJECT_ID, [fixture.leaf.id]);
        await viewerPage.waitForSelector('#projects-board-detail:not([hidden])', { timeout: 30000 });
        await openRecovery(viewerPage);
        await viewerPage.locator('[data-recovery-entries] > .crm-projects-recovery-row').first().waitFor({ state: 'visible', timeout: 30000 });
        const viewerRecoveryActions = viewerPage.locator('[data-recovery-entries] [data-action]');
        assert.ok(await viewerRecoveryActions.count() > 0, 'Viewer recovery catalog must expose records for reading.');
        for (let index = 0; index < await viewerRecoveryActions.count(); index += 1) assert.strictEqual(await viewerRecoveryActions.nth(index).isDisabled(), true, 'Viewer recovery lifecycle actions must be disabled.');
        assert.strictEqual(await viewerPage.locator('[data-recovery-entries] [data-select]').count(), 0, 'Viewer must not select tasks for bulk mutation.');
        assert.strictEqual(await viewerPage.locator('[data-recovery-bulk]').isDisabled(), true, 'Viewer bulk recovery control must be disabled.');
        const viewerComposer = viewerPage.locator('#projects-board-discussion-input, #projects-discussion-composer textarea, [data-discussion-composer] textarea, textarea[aria-label*="discussion" i]').first();
        assert.strictEqual(await viewerComposer.count(), 1, 'Viewer must retain the discussion composer.');
        assert.strictEqual(await viewerComposer.isDisabled(), true, 'Viewer discussion composer must be disabled.');
        const viewerFile = viewerPage.locator('#projects-board-discussion-file').first();
        assert.strictEqual(await viewerFile.count(), 1, 'Viewer must retain the disabled file control.');
        assert.strictEqual(await viewerFile.isDisabled(), true, 'Viewer must not upload discussion files.');
        const viewerSend = viewerPage.locator('#btn-projects-board-discussion-send').first();
        assert.strictEqual(await viewerSend.count(), 1, 'Viewer must retain the disabled post control.');
        assert.strictEqual(await viewerSend.isDisabled(), true, 'Viewer must not post discussion messages.');
        const viewerMutationButtons = viewerPage.locator('[data-discussion-reply], [data-discussion-edit], [data-discussion-moderate]');
        for (let index = 0; index < await viewerMutationButtons.count(); index += 1) {
            assert.strictEqual(await viewerMutationButtons.nth(index).isDisabled(), true, 'Viewer reply/edit/moderation controls must be disabled.');
        }
        await viewerPage.screenshot({ path: path.join(artifactDir, 'phase4-discussions-recovery-viewer.png'), fullPage: true });
        await viewerContext.close();

        const unexpectedConsoleErrors = consoleErrorRecords.filter((entry) => !expectedConsoleRecord(entry));
        fs.writeFileSync(path.join(artifactDir, 'phase4-discussions-recovery-browser-console-network.json'), `${JSON.stringify({ consoleErrors, consoleErrorRecords, injectedConflictUrls: [...injectedConflictUrls], unexpectedConsoleErrors, pageErrors, network }, null, 2)}\n`, 'utf8');
        assert.strictEqual(injectedConflictUrls.size, 1, 'the intentional attachment conflict must be exercised on exactly one message URL.');
        assert.deepStrictEqual(pageErrors, [], `Chrome page errors: ${pageErrors.join('; ')}`);
        assert.deepStrictEqual(unexpectedConsoleErrors, [], `Chrome console errors: ${unexpectedConsoleErrors.map((entry) => entry.text).join('; ')}`);
        assert.ok(network.some((entry) => entry.method === 'GET' && entry.url.includes('/api/projects/')));
        const annotationResponse = annotationResponses.find((entry) => entry.status === 200 && /text\/css/i.test(entry.contentType));
        assert.ok(annotationResponse, `Chrome must load the entrance annotation stylesheet as text/css: ${JSON.stringify(annotationResponseRecords)}`);
        const servedAnnotationBytes = await annotationResponse.response.body();
        const candidateAnnotationBytes = fs.readFileSync(path.join(PUBLIC_DIR, 'css/entrance-test-ui-annotations.css'));
        const servedAnnotationEvidence = {
            url: annotationResponse.url,
            status: annotationResponse.status,
            contentType: annotationResponse.contentType,
            bytes: servedAnnotationBytes.length,
            sha256: crypto.createHash('sha256').update(servedAnnotationBytes).digest('hex'),
            candidateBytes: candidateAnnotationBytes.length,
            candidateSha256: crypto.createHash('sha256').update(candidateAnnotationBytes).digest('hex'),
            exactCandidateBytesServed: Buffer.compare(servedAnnotationBytes, candidateAnnotationBytes) === 0,
            browserBinding: 'response.body() compared with the final local candidate bytes actually served to Chrome'
        };
        fs.writeFileSync(path.join(artifactDir, 'phase4-annotation-css-served-evidence.json'), `${JSON.stringify(servedAnnotationEvidence, null, 2)}\n`, 'utf8');
        assert.deepStrictEqual(servedAnnotationBytes, candidateAnnotationBytes, 'Chrome must serve the exact final candidate annotation stylesheet bytes');
        const loadedAnnotationCss = await ownerPage.evaluate(() => [...document.styleSheets].flatMap((sheet) => {
            try { return [...sheet.cssRules].map((rule) => rule.cssText); } catch (_) { return []; }
        }).join('\n'));
        assert.match(loadedAnnotationCss, /\.et-annotation-overlay/);
        assert.match(loadedAnnotationCss, /\.et-annotation-capture-layer/);
        process.stdout.write('crm projects Phase4 discussions/recovery real Chrome persisted UI matrix passed\n');
    } catch (error) {
        console.error('Phase4 Chrome original failure:', error.stack || error.message);
        fs.writeFileSync(path.join(artifactDir, 'phase4-discussions-recovery-browser-failure.json'), `${JSON.stringify({ error: error.stack || error.message, consoleErrorRecords, pageErrors, network }, null, 2)}\n`, 'utf8');
        if (browser) await boundedCleanup('Failure evidence', async () => {
            for (const [index, page] of browser.contexts().flatMap((item) => item.pages()).entries()) {
                if (page.isClosed()) continue;
                const stem = path.join(artifactDir, `phase4-browser-failure-page-${index}`);
                fs.writeFileSync(`${stem}.html`, await page.content(), 'utf8');
                await page.screenshot({ path: `${stem}.png`, fullPage: true, timeout: 4000 });
            }
        });
        throw error;
    } finally {
        releaseBarriers.forEach((release) => release());
        if (browser) await boundedCleanup('Chrome', () => browser.close());
        for (const listener of [server, context.server]) {
            if (listener?.listening) await boundedCleanup('HTTP server', () => new Promise((resolve) => {
                listener.close(resolve);
                listener.closeAllConnections?.();
            }));
        }
        await boundedCleanup('Firebase app', () => context.app.delete());
    }
}

main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
});
