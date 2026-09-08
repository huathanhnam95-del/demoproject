'use strict';
// Authoring fixture: execute only through the root's isolated emulator/Chrome runner.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const { chromium } = require('playwright');
const h = require('../../crm/projects/phase9-test-helpers');
const { createRelayServer } = require('../../../services/crm-voice-relay/server');
const { buildLocalCrmAdminDocument } = require('../../../src/server/app');
const { AI_VOICE_COLLECTIONS: V } = require('../../../functions/src/ai-assistance/collections');
const ROOT = path.resolve(__dirname, '../../..'), OUT = path.join(ROOT, 'test-results/crm-projects/phase9-gemini-relay-browser');
const report = { provenance: 'Engineering-only synthetic text and billing evidence; actual Chrome microphone/worklet/relay/CRM shell and Firestore effects', cases: [], errors: [], console: [], network: [], sources: [], screenshots: [], startedAt: new Date().toISOString() };
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function wave() { const pcm = Buffer.alloc(64000); for (let i = 0; i < 32000; i++) pcm.writeInt16LE(Math.round(8000 * Math.sin(2 * Math.PI * 440 * i / 16000)), i * 2); const b = Buffer.alloc(44); b.write('RIFF'); b.writeUInt32LE(36 + pcm.length, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(pcm.length, 40); return Buffer.concat([b, pcm]); }
async function until(check, message) { const end = Date.now() + 30000; while (Date.now() < end) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 50)); } throw Error(`Timeout: ${message}`); }
function config() { const endpoint = value => { const [host, port] = String(value).replace(/^https?:\/\//, '').split(':'); return { host, port: Number(port) }; }; return { success: true, config: { apiKey: 'demo-key', authDomain: 'demo-crm-projects.firebaseapp.com', projectId: 'demo-crm-projects', storageBucket: 'demo-crm-projects.appspot.com', messagingSenderId: '000000000000', appId: '1:000000000000:web:crmprojectsphase9' }, emulators: { auth: endpoint(process.env.FIREBASE_AUTH_EMULATOR_HOST), firestore: endpoint(process.env.FIRESTORE_EMULATOR_HOST), storage: endpoint(process.env.FIREBASE_STORAGE_EMULATOR_HOST) }, features: { projects: true } }; }
function instrument() { window.voiceLifecycle = []; const get = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices), fetchNative = window.fetch; window.fetch = async (...args) => { const response = await fetchNative(...args); if (new URL(String(args[0]), location.href).pathname === '/prepare' && response.ok) window.voiceLifecycle.push('prepared'); return response; }; navigator.mediaDevices.getUserMedia = async (...args) => { window.voiceLifecycle.push('microphone'); const stream = await get(...args); window.fixtureTracks = stream.getTracks(); return stream; }; }
function serveShell(f) {
        // AudioWorklet module requests are not surfaced by Playwright's page
        // response event. Record the actual server response for that asset.
        f.expressApp.get('/js/crm/ai-assistance/voice-audio-worklet.js', (_req, res, next) => {
            res.on('finish', () => { (report.workletResponses ||= []).push({ status: res.statusCode }); }); next();
        });
        f.expressApp.get('/api/config', (_req, res) => res.json(config()));
        f.expressApp.get('/crm-admin.html', (_req, res) => { const document = buildLocalCrmAdminDocument(fs.readFileSync(path.join(ROOT, 'public/crm-admin.html'), 'utf8'), process.env, 'demo-crm-projects'); const wsOrigin = f.baseUrl.replace(/^http/, 'ws'); report.fixtureCspAddition = wsOrigin; const policy = document.policy.replace(/connect-src([^;]*)/, (_all, values) => `connect-src${values} ${wsOrigin}`); res.set('Content-Security-Policy', policy).type('html').send(document.html); });
        f.expressApp.get('/__login', (_req, res) => res.type('html').send(`<!doctype html><script src="https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js"></script><script src="https://www.gstatic.com/firebasejs/9.22.0/firebase-auth-compat.js"></script><script>(async()=>{const c=await(await fetch('/api/config')).json();firebase.initializeApp(c.config);firebase.auth().useEmulator('http://'+c.emulators.auth.host+':'+c.emulators.auth.port,{disableWarnings:true});await firebase.auth().signInWithEmailAndPassword(new URLSearchParams(location.search).get('email'),${JSON.stringify(h.PASSWORD)});location.replace('/crm-admin.html#projects')})().catch(e=>document.body.textContent=e.message)</script>`));
        f.expressApp.use(express.static(path.join(ROOT, 'public'), { dotfiles: 'allow' }));
}
async function selectProject(page, projectId) {
    const picker = page.locator('#projects-board-project-select');
    await picker.waitFor({ state: 'visible', timeout: 30000 });
    // The board picker is enabled while the independent access controller is
    // still refreshing. Its selectProject deliberately ignores changes then.
    // Wait on that controller's real pending-state control before selecting.
    await page.waitForFunction(id => {
        const accessRefresh = document.getElementById('btn-projects-access-refresh');
        const options = document.getElementById('projects-board-project-select')?.options;
        const workspace = document.getElementById('projects-board-workspace');
        return !!window.projectsAssistantController && accessRefresh && !accessRefresh.disabled
            && workspace && !workspace.hidden && Array.from(options || []).some(option => option.value === id);
    }, projectId);
    const current = await page.evaluate(() => window.projectsAssistantController.getState().context.projectId);
    if (current !== projectId) {
        const requested = page.waitForResponse(response => new URL(response.url()).pathname === `/api/projects/${encodeURIComponent(projectId)}` && response.request().method() === 'GET');
        await picker.selectOption(projectId);
        assert.equal((await requested).status(), 200, 'Selecting the ready picker must issue the target project read');
    }
    await page.waitForFunction(id => window.projectsAssistantController?.getState()?.context.projectId === id
        && document.getElementById('projects-board-project-select')?.value === id
        && window.projectsViewsController?.getState()?.projectId === id, projectId);
    await page.locator('[data-task-id] [data-action="select-task"]').first().waitFor();
    await page.waitForFunction(() => !document.getElementById('btn-projects-board-refresh')?.disabled);
}

async function login(page, baseUrl, role, projectId) { await page.goto(`${baseUrl}/__login?email=${encodeURIComponent(h.USERS[role])}`); await selectProject(page, projectId); }
async function main() {
    fs.mkdirSync(OUT, { recursive: true }); const wav = path.join(OUT, 'synthetic-microphone.wav'); fs.writeFileSync(wav, wave());
    let f, relay, browser, page; const drivers = [];
    const save = () => fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
    const shot = async name => { const file = path.join(OUT, `${name}.png`); await page.screenshot({ path: file, fullPage: true }); report.screenshots.push(file); };
    const run = async (name, work) => { try { await work(); report.cases.push({ name, passed: true }); await shot(`case-${report.cases.length}`); } catch (error) { report.cases.push({ name, passed: false, error: error.stack }); throw error; } finally { save(); } };
    try {
        f = await h.boot('voice-browser'); const { c, suite } = f;
        await c.task('descendant', { parentTaskId: 'one', sectionId: null });
        const providerFactory = async ({ scope, sendPermit, onMessage, onError }) => { assert.equal(sendPermit.engineeringOnly, true); const driver = { scope, reservationId: sendPermit.reservationId, chunks: [], emit: onMessage, disconnect: onError, closed: false }; drivers.push(driver); return { async sendAudio({ bytes, sampleRate, utteranceId }) { assert.equal(sampleRate, 16000); assert.ok(bytes.length >= 640 && bytes.length <= 3200 && bytes.length % 640 === 0); driver.chunks.push(Buffer.from(bytes)); driver.utteranceId = utteranceId; }, close() { driver.closed = true; }, interrupt() {}, updateContext() {} }; };
        providerFactory.engineeringOnly = true;
        relay = createRelayServer({ sessionService: f.sessionService, ledger: f.ledger, authenticate: token => suite.auth.verifyIdToken(token, true), allowedOrigins: [f.baseUrl], engineeringMode: true, providerFactory, onDiagnostic: diagnostic => { (report.relayDiagnostics ||= []).push(diagnostic); }, features: { projects: { engineeringOnly: true, model: 'engineering-projects', provider: 'engineering-projects-provider', admission: () => ({ model: 'engineering-projects', purpose: 'planning', context: { projectId: c.projectId }, boundsVersion: 'phase9-engineering-bounds', request: { inputTokens: '0', outputTokens: '1', maxRequests: 1 } }) } } });
        f.server.removeAllListeners('request'); f.server.on('request', (req, res) => ['/prepare', '/status'].includes(new URL(req.url, f.baseUrl).pathname) ? relay.server.emit('request', req, res) : f.expressApp(req, res)); f.server.on('upgrade', (req, socket, head) => relay.server.emit('upgrade', req, socket, head)); f.setRelayUrl(f.baseUrl);
        serveShell(f);
        for (const file of ['public/crm-admin.html', 'public/crm-admin.js', 'public/js/crm/projects/board.js', 'public/js/crm/projects/assistant.js', 'public/js/crm/ai-assistance/voice-transport.js', 'public/js/crm/ai-assistance/voice-audio-worklet.js', 'services/crm-voice-relay/server.js']) report.sources.push({ file, sha256: hash(fs.readFileSync(path.join(ROOT, file))) });
        browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`, '--autoplay-policy=no-user-gesture-required'] });
        page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, permissions: ['microphone'] }); await page.addInitScript(instrument);
        page.on('pageerror', error => report.errors.push(error.message)); page.on('console', message => { if (message.type() === 'error') report.console.push(message.text().replace(/Bearer\s+\S+/g, '[redacted]')); }); page.on('response', response => { const url = new URL(response.url()); if (url.origin === f.baseUrl) report.network.push({ path: url.pathname, status: response.status(), method: response.request().method() }); });
        await login(page, f.baseUrl, 'owner', c.projectId); await page.waitForFunction(() => window.projectsAssistantController); const button = action => page.locator(`[data-assistant-action="${action}"]`); const state = () => page.evaluate(() => window.projectsAssistantController.getState());
        const openAssistant = async () => { const summary = page.getByText('Project assistance', { exact: true }); if (!await summary.locator('..').evaluate(node => node.open)) await summary.click(); };
        const select = async ids => { for (const id of ids) { const checkbox = page.locator(`[data-task-id="${id}"] [data-action="select-task"]`); if (!await checkbox.isChecked()) await checkbox.click(); } };
        const propose = async (output, text, action = 'draft') => { f.setOutput(output); await page.locator('[data-assistant-instruction]').fill(text); const response = page.waitForResponse(r => r.url().endsWith('/ai/proposals') && r.request().method() === 'POST'); await button(action).click(); assert.equal((await response).status(), 200); await until(async () => !(await state()).busy, 'proposal rendered'); };
        const start = async () => { const previous = drivers.length; await button('start').click(); await until(() => drivers.length > previous && drivers.at(-1).chunks.length >= 3, 'actual native PCM'); return drivers.at(-1); };
        const settle = async driver => { await f.ledger.settle(driver.reservationId, f.evidence(driver.reservationId, { outputText: '1' })); };
        await run('mouse and Space select three tasks independently of detail selection; render never opens mic', async () => {
            await page.evaluate(() => { window.selectionEvents = []; for (const type of ['click', 'keydown', 'keyup', 'focusin', 'scroll']) document.getElementById('projects-board-scroll').addEventListener(type, event => window.selectionEvents.push({type, target:event.target.dataset?.action, task:event.target.closest?.('[data-task-id]')?.dataset.taskId, busy:document.getElementById('btn-projects-board-refresh').disabled}), true); });
            const selectionSnapshot = () => page.evaluate(() => ({ ids: window.projectsAssistantController.getState().context.selectedTaskIds, checked: Array.from(document.querySelectorAll('[data-action="select-task"]:checked')).map(node => node.closest('[data-task-id]').dataset.taskId), events:window.selectionEvents, status:document.getElementById('projects-board-status').textContent }));
            report.selectionSteps = [];
            await page.locator('[data-task-id="one"] [data-action="select-task"]').click(); report.selectionSteps.push(await selectionSnapshot());
            const second = page.locator('[data-task-id="two"] [data-action="select-task"]'); await second.focus(); await second.press('Space'); report.selectionSteps.push(await selectionSnapshot());
            await select(['three']); report.selectionSteps.push(await selectionSnapshot());
            assert.equal(await page.locator('[data-action="select-task"]:checked').count(), 3); const before = await page.evaluate(() => window.projectsAssistantController.getState().context.selectedTaskIds); await page.locator('[data-task-id="parent"]').focus(); await page.locator('[data-task-id="parent"]').press('Enter'); await page.locator('#projects-board-detail').waitFor({ state: 'visible' }); assert.deepEqual(await page.evaluate(() => window.projectsAssistantController.getState().context.selectedTaskIds), before); assert.deepEqual(await page.evaluate(() => window.voiceLifecycle), []); await openAssistant(); assert.match(await page.locator('[data-assistant-action="start"]').locator('..').innerText(), /Native paid assistance is unavailable/);
        });
        await run('board refresh preserves the focused assistant textarea node, caret, and context', async () => {
            const projectPath = `/api/projects/${encodeURIComponent(c.projectId)}`;
            const routePattern = `**${projectPath}`;
            let projectResponseHeld = false;
            let releaseProjectResponse = () => {};
            let projectResponseReachedResolve;
            const projectResponseReached = new Promise(resolve => { projectResponseReachedResolve = resolve; });
            const projectResponseRelease = new Promise(resolve => { releaseProjectResponse = resolve; });
            const waitForProjectResponse = async () => {
                let timeout;
                try {
                    await Promise.race([projectResponseReached, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Timed out waiting for the held project response.')), 10000); })]);
                } finally { clearTimeout(timeout); }
            };
            let routeInstalled = false;
            const driversBefore = drivers.length;
            const voiceLifecycleBefore = await page.evaluate(() => [...window.voiceLifecycle]);
            let priorInstruction = '';
            try {
                await page.route(routePattern, async route => {
                    const request = route.request();
                    const pathname = new URL(request.url()).pathname;
                    if (projectResponseHeld || request.method() !== 'GET' || pathname !== projectPath) { await route.continue(); return; }
                    projectResponseHeld = true;
                    const response = await route.fetch();
                    projectResponseReachedResolve();
                    await projectResponseRelease;
                    await route.fulfill({ response });
                });
                routeInstalled = true;
                await page.locator('#btn-projects-board-refresh').click();
                await waitForProjectResponse();
                await openAssistant();
                const instruction = page.locator('[data-assistant-instruction]');
                priorInstruction = await instruction.inputValue();
                const knownInstruction = 'Keep this exact instruction while the board refresh is pending.';
                await instruction.fill(knownInstruction);
                await instruction.focus();
                await instruction.evaluate(node => node.setSelectionRange(7, 31, 'backward'));
                const instructionHandle = await instruction.elementHandle();
                assert.ok(instructionHandle, 'The assistant instruction textarea must have a live element handle');
                const beforeAssistant = await state();
                const selectedTaskIds = beforeAssistant.context.selectedTaskIds.slice();
                const draft = beforeAssistant.draft;
                const preview = beforeAssistant.preview;
                assert.deepEqual(await page.evaluate(() => ({
                    refresh: document.getElementById('btn-projects-board-refresh')?.disabled,
                    addSection: document.getElementById('btn-projects-board-add-section')?.disabled,
                    addTask: document.getElementById('btn-projects-board-add-task')?.disabled,
                    addColumn: document.getElementById('btn-projects-board-add-column')?.disabled,
                    saveSettings: document.getElementById('btn-projects-board-save-settings')?.disabled
                })), { refresh: true, addSection: true, addTask: true, addColumn: true, saveSettings: true }, 'Board mutation and refresh controls must be disabled while the project read is held');
                releaseProjectResponse();
                await page.waitForFunction(id => {
                    const refresh = document.getElementById('btn-projects-board-refresh');
                    const workspace = document.getElementById('projects-board-workspace');
                    return refresh && !refresh.disabled && workspace && !workspace.hidden
                        && document.getElementById('projects-board-project-select')?.value === id
                        && window.projectsAssistantController?.getState()?.context.projectId === id
                        && window.projectsViewsController?.getState()?.projectId === id;
                }, c.projectId);
                assert.equal(await instructionHandle.evaluate(node => node === document.querySelector('[data-assistant-instruction]')), true, 'Refresh must preserve the exact assistant textarea node');
                assert.equal(await instructionHandle.evaluate(node => document.activeElement === node), true, 'Refresh must preserve assistant textarea focus');
                assert.deepEqual(await instructionHandle.evaluate(node => ({ value: node.value, selectionStart: node.selectionStart, selectionEnd: node.selectionEnd, selectionDirection: node.selectionDirection })), { value: knownInstruction, selectionStart: 7, selectionEnd: 31, selectionDirection: 'backward' });
                const afterAssistant = await state();
                assert.deepEqual(afterAssistant.context.selectedTaskIds, selectedTaskIds, 'Refresh must preserve selected task IDs');
                assert.deepEqual(afterAssistant.draft, draft, 'Refresh must preserve the current draft');
                assert.deepEqual(afterAssistant.preview, preview, 'Refresh must preserve the current preview');
                assert.equal(drivers.length, driversBefore, 'Refresh must not create a voice provider session');
                assert.deepEqual(await page.evaluate(() => [...window.voiceLifecycle]), voiceLifecycleBefore, 'Refresh must not start microphone/provider lifecycle');
            } finally {
                releaseProjectResponse();
                if (routeInstalled) await page.unroute(routePattern).catch(() => {});
                const currentInstruction = page.locator('[data-assistant-instruction]');
                if (await currentInstruction.count()) await currentInstruction.fill(priorInstruction).catch(() => {});
            }
        });
        await run('actual final user transcript appends once and records durable provenance without domain effects', async () => {
            const before = await c.taskData('one'); const driver = await start(); const events = await page.evaluate(() => window.voiceLifecycle); assert.ok(events.indexOf('prepared') < events.indexOf('microphone')); assert.ok(Buffer.concat(driver.chunks).some(byte => byte)); await settle(driver);
            driver.emit({ userTranscription: { utteranceId: driver.utteranceId, eventId: 'ordinary-final', text: 'Plan the selected tasks.', final: true } }); await page.waitForFunction(() => document.querySelector('[data-assistant-instruction]').value.includes('Plan the selected tasks.'));
            assert.equal((await page.locator('[data-assistant-instruction]').inputValue()).split('Plan the selected tasks.').length, 2); const rows = await suite.db.collection(V.utterances).where('sessionId', '==', driver.scope.sessionId).get(); assert.ok(rows.docs.some(doc => doc.data().state === 'final' && doc.data().attestationId === null)); assert.deepEqual(await c.taskData('one'), before); await button('stop').click();
        });
        let movePreview;
        await run('three task move preview and synthetic explicit voice confirmation apply actual persisted grouped effects', async () => {
            await propose({ kind: 'task_draft', actions: ['one', 'two', 'three'].map(taskId => ({ kind: 'move_task', taskId, parentTaskId: 'parent' })) }, 'Move these three tasks under parent.'); await button('preview').click(); await until(async () => !!(await state()).preview, 'preview'); movePreview = (await state()).preview; assert.match(await page.locator('details').filter({ has: button('preview') }).innerText(), /Descendant tasks stay/);
            const driver = await start(); await settle(driver); const response = page.waitForResponse(r => r.url().endsWith('/apply') && r.request().method() === 'POST'); driver.emit({ userTranscription: { utteranceId: driver.utteranceId, eventId: 'confirm-final', text: 'I confirm these changes', final: true } }); const applied = await response; assert.equal(applied.status(), 200); const payload = applied.request().postDataJSON(); assert.deepEqual(Object.keys(payload).sort(), ['attestationId', 'previewId']); assert.equal(payload.previewId, movePreview.previewId);
            await until(async () => (await state()).status === 'Confirmed changes applied.' && !(await state()).busy, 'committed status after real board refresh'); assert.equal(await button('preview').count(), 0); for (const id of ['one', 'two', 'three']) assert.equal((await c.taskData(id)).parentTaskId, 'parent'); assert.equal((await c.taskData('descendant')).parentTaskId, 'one'); report.applied = { previewId: movePreview.previewId, operationId: movePreview.operationId, taskIds: ['one', 'two', 'three'], descendantParent: 'one' };
        });
        await run('grouped Undo uses authenticated endpoint followed by actual board refresh', async () => {
            h.expectStatus(await f.api(`/${c.projectId}/operations/${movePreview.operationId}/undo`, 'owner', 'POST', { operationId: c.op('browser-undo') }), 200); for (const id of ['one', 'two', 'three']) assert.equal((await c.taskData(id)).parentTaskId, null); assert.equal((await c.taskData('descendant')).parentTaskId, 'one'); await page.locator('#btn-projects-board-refresh').click(); await page.locator('[data-task-id="one"]').waitFor(); report.undoInteraction = 'Authenticated endpoint plus Chrome board refresh; history UI not exercised';
        });
        await run('Mai and Vietnam Thursday notices are visible; second action correction preserves first action', async () => {
            await suite.db.collection('users').doc(c.uids.editor).update({ displayName: 'Mai' }); await select(['one', 'two']); await propose({ kind: 'task_draft', actions: [{ kind: 'field_update', taskId: 'one', patch: {}, assigneeName: 'Mai', dueDateExpression: 'next Thursday' }, { kind: 'field_update', taskId: 'two', patch: { title: 'Draft second' } }] }, 'Assign one to Mai next Thursday and rename two.'); assert.match(await page.locator('details').filter({ has: button('draft') }).innerText(), /Accountable owner: Mai/); assert.match(await page.locator('details').filter({ has: button('draft') }).innerText(), /Next Thursday resolves to \d{4}-\d{2}-\d{2}/);
            const original = (await state()).draft; await page.locator('[data-assistant-correction]').selectOption(original.actions[1].actionId); await propose({ kind: 'correction', patch: { patch: { title: 'Corrected second' } } }, 'Change only the second title.', 'correct'); const corrected = (await state()).draft; assert.deepEqual(corrected.actions[0], original.actions[0]); assert.equal(corrected.actions[1].actionId, original.actions[1].actionId); assert.equal(corrected.actions[1].patch.title, 'Corrected second');
        });
        await run('blocked-task owner notification proposal enters Phase7 editor without activation', async () => {
            const before = await c.rows('rules'); await propose({ kind: 'automation_draft', definition: { schemaVersion: 1, trigger: { type: 'status_changed', from: 'not_started', to: 'blocked' }, steps: [{ nodeId: 'notify_owner', type: 'notify', payload: { message: 'Review blocked task', recipients: 'task_owner' } }] } }, 'When a task becomes blocked notify its owner.', 'automation'); await page.locator('#auto-title').waitFor(); assert.equal(await page.locator('[data-auto-action="activate"]').isEnabled(), false); assert.deepEqual(await c.rows('rules'), before);
        });
        await run('context invalidation and disconnect retain draft and never reconnect automatically', async () => {
            await openAssistant(); const retained = (await state()).draft.draftId; await button('preview').click(); await until(async () => !!(await state()).preview, 'fresh preview'); const driver = await start(); await settle(driver); await c.edit('two', { title: 'Remote context change' }); await page.locator('#btn-projects-board-refresh').click(); await until(async () => !(await state()).preview, 'remote preview invalidation'); assert.equal((await state()).draft.draftId, retained); await until(() => driver.closed, 'voice closes on context invalidation'); const count = drivers.length; await page.waitForTimeout(350); assert.equal(drivers.length, count); const disconnected = await start(); await settle(disconnected); disconnected.disconnect(); await until(() => disconnected.closed, 'provider disconnect'); await page.waitForFunction(() => window.fixtureTracks.every(track => track.readyState === 'ended')); assert.equal((await state()).draft.draftId, retained); const afterDisconnect = drivers.length; await page.waitForTimeout(350); assert.equal(drivers.length, afterDisconnect);
        });
        await run('focused checked checkbox receives remote title and Editor to Viewer restrictions without focus loss', async () => {
            const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } }), editor = await context.newPage(); try { await login(editor, f.baseUrl, 'editor', c.projectId); const checkbox = editor.locator('[data-task-id="two"] [data-action="select-task"]'); await checkbox.click(); await checkbox.focus(); await c.edit('two', { title: 'Remote title while focused' }); await c.memberRef('editor').update({ role: 'Viewer', revision: 99 }); await editor.evaluate(() => document.getElementById('btn-projects-board-refresh').click()); await until(async () => (await editor.locator('[data-task-id="two"]').innerText()).includes('Remote title while focused'), 'focused row title'); assert.equal(await checkbox.isChecked(), true); assert.equal(await checkbox.evaluate(node => document.activeElement === node), true); assert.equal(await editor.locator('[data-task-id="two"] [data-field-kind="status"]').isDisabled(), true); await editor.screenshot({ path: path.join(OUT, 'focused-viewer.png') }); report.screenshots.push(path.join(OUT, 'focused-viewer.png')); } finally { await c.memberRef('editor').update({ role: 'Editor', revision: 100 }); await context.close(); }
        });
        report.finalState = await state(); assert.deepEqual(report.errors, [], 'No unexpected browser runtime errors'); assert.equal(report.cases.length, 9); assert.ok(report.workletResponses?.some(row => row.status === 200), 'Actual server delivered the native AudioWorklet module');
    } catch (error) { report.setupOrRunError = error.stack; if (page) { report.failureReadiness = await page.evaluate(() => ({ pickerValue: document.getElementById('projects-board-project-select')?.value, accessPending: document.getElementById('btn-projects-access-refresh')?.disabled, boardStatus: document.getElementById('projects-board-status')?.textContent, assistantProjectId: window.projectsAssistantController?.getState()?.context.projectId, viewsProjectId: window.projectsViewsController?.getState()?.projectId })).catch(() => null); await shot('failure').catch(() => {}); } process.exitCode = 1; }
    finally { report.pcm = drivers.map((driver, index) => { const bytes = Buffer.concat(driver.chunks); fs.writeFileSync(path.join(OUT, `received-${index}.pcm`), bytes); return { sessionId: driver.scope.sessionId, bytes: bytes.length, sha256: hash(bytes), chunks: driver.chunks.map(chunk => chunk.length), syntheticProvider: true }; }); if (page && !page.isClosed()) report.lifecycle = await page.evaluate(() => window.voiceLifecycle).catch(() => []); await browser?.close(); await relay?.close(); await f?.close(); report.finishedAt = new Date().toISOString(); save(); }
}
module.exports = { serveShell, login, selectProject };
if (require.main === module) main().catch(error => { report.setupOrRunError = error.stack; fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2)); process.exitCode = 1; });
