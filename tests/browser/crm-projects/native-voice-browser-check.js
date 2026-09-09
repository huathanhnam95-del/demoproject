'use strict';
// Explicitly metered acceptance. Never include in an unattended default suite.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), http = require('node:http');
const express = require('express'), { chromium } = require('playwright');
const h = require('../../crm/projects/phase6-test-helpers');
const { createNativeGemini, wav } = require('../../../functions/src/ai-assistance/providers/native-gemini');
const { createProjectsBudgetService } = require('../../../functions/src/crm/projects/budget-service');
const { createProjectsRecoveryService } = require('../../../functions/src/crm/projects/recovery-service');
const { createProjectsDraftService } = require('../../../functions/src/crm/projects/voice/draft-service');
const { createVoiceSessionService } = require('../../../functions/src/ai-assistance/voice/session-service');
const { createRelayServer } = require('../../../services/crm-voice-relay/server');
const { createNativeVoiceProvider } = require('../../../services/crm-voice-relay/native-provider');
const { buildLocalCrmAdminDocument } = require('../../../src/server/app');
const { runTransactionWithClosedRetry } = require('../../../functions/src/crm/projects/domain/transaction-retry');
const ROOT = path.resolve(__dirname, '../../..');
function installAcceptanceInstrumentation({ muteEnabled }) {
    const timeline = { finishClicks: [], previewVisible: null };
    const records = []; let starts = 0, stops = 0, overflow = false, muteClick = null;
    const Audio = window.AudioContext || window.webkitAudioContext;
    const snapshot = () => {
        const sources = records.map(({ context, ...row }) => {
            const now = context.currentTime;
            const pending = row.endedAtMs === null && now < row.endAudioTime && (row.stopAudioTime === null || now < row.stopAudioTime);
            return { ...row, audioCurrentTime: now, pending, rendering: pending && context.state === 'running' && now >= row.startAudioTime };
        });
        return { atMs: performance.now(), available: typeof Audio?.prototype?.createBufferSource === 'function', starts, stops, overflow, muteClick,
            activeIds: sources.filter(row => row.rendering).map(row => row.id), scheduledIds: sources.filter(row => row.pending).map(row => row.id), sources };
    };
    window.__crmNativeAcceptance = { timeline, audio: { snapshot } };
    if (muteEnabled && Audio?.prototype?.createBufferSource) {
        const create = Audio.prototype.createBufferSource;
        Audio.prototype.createBufferSource = function (...args) {
            const node = create.apply(this, args), context = this, start = node.start, stop = node.stop;
            let row;
            node.start = function (...values) {
                const now = context.currentTime, result = start.apply(this, values);
                // The real transport renders mono 24k PCM. Retain timing and
                // counters only; never copy microphone or provider audio bytes.
                if (node.buffer?.sampleRate === 24000 && node.buffer.numberOfChannels === 1) {
                    starts++;
                    if (records.length >= 512) { overflow = true; return result; }
                    const when = Math.max(now, Number(values[0] || 0)), duration = values[2] ?? Math.max(0, node.buffer.duration - Number(values[1] || 0));
                    row = { id: starts, context, startCalledAtMs: performance.now(), startAudioTime: when, endAudioTime: when + duration / node.playbackRate.value,
                        stopCalledAtMs: null, stopAudioTime: null, stoppedWhileRendering: false, endedAtMs: null };
                    records.push(row);
                }
                return result;
            };
            node.stop = function (...values) {
                const rendering = row && snapshot().activeIds.includes(row.id), result = stop.apply(this, values);
                if (row) { stops++; row.stopCalledAtMs = performance.now(); row.stopAudioTime = Math.max(context.currentTime, Number(values[0] || 0)); row.stoppedWhileRendering = !!rendering; }
                return result;
            };
            node.addEventListener('ended', () => { if (row) row.endedAtMs = performance.now(); });
            return node;
        };
    }
    document.addEventListener('click', event => {
        const action = event.target.closest?.('[data-assistant-action]')?.dataset.assistantAction;
        if (action === 'finish') timeline.finishClicks.push(performance.now());
        if (muteEnabled && action === 'interrupt' && !muteClick) {
            const value = snapshot(); muteClick = { atMs: performance.now(), starts: value.starts, activeIds: value.activeIds, scheduledIds: value.scheduledIds };
        }
    }, true);
    const observePreview = () => {
        const preview = window.projectsAssistantController?.getState()?.preview;
        if (!timeline.previewVisible && preview && Array.from(document.querySelectorAll('h4')).some(node => node.textContent === 'Visible preview' && node.getClientRects().length > 0)) {
            timeline.previewVisible = { atMs: performance.now(), previewId: preview.previewId, actionsJson: JSON.stringify(preview.actions) };
        }
    };
    const observe = () => { new MutationObserver(observePreview).observe(document.documentElement, { subtree: true, childList: true, attributes: true }); observePreview(); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', observe, { once: true }); else observe();
}
async function main() {
    assert.equal(process.env.CRM_NATIVE_PAID_TEST, 'true', 'Explicit metered-test authorization required');
    const runId = process.env.CRM_NATIVE_TEST_RUN_ID; assert.match(runId || '', /^[a-z0-9-]{1,40}$/);
    const out = path.join(ROOT, 'test-results/crm-projects/native-voice', runId); assert.equal(fs.existsSync(out), false, 'Do not silently repeat a paid run'); fs.mkdirSync(out, { recursive: true });
    const report = { startedAt: new Date().toISOString(), state: 'running', scope: 'synthetic emulator records; real native Google Live and Flash', cases: [], diagnostics: [], usage: [] };
    const muteEnabled = process.env.CRM_NATIVE_MUTE_TEST === 'true';
    report.timings = { clock: 'browser performance.now()', scope: 'Real provider, synthetic microphone, loopback relay and emulator persistence; not a production latency SLO.' };
    if (muteEnabled) report.mute = { state: 'pending', scope: 'Real mono 24k AudioContext buffer sources; API playback evidence, not physical speaker capture.' };
    const scenario = process.env.CRM_NATIVE_SCENARIO || 'edit_task'; assert.ok(['edit_task', 'create_task', 'create_project', 'edit_project'].includes(scenario)); report.scenario = scenario;
    report.sourceHashes = Object.fromEntries(['functions/src/crm/projects/voice/proposal-service.js', 'functions/src/crm/projects/voice/response-schema.js', 'functions/src/crm/projects/voice/draft-service.js', 'functions/src/ai-assistance/providers/native-gemini.js', 'services/crm-voice-relay/gemini-live-connector.js', 'services/crm-voice-relay/native-provider.js', 'services/crm-voice-relay/server.js', 'public/js/crm/projects/assistant.js'].map(file => [file, require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(ROOT, file))).digest('hex')]));
    const save = () => fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); save();
    const protocolPath = path.join(out, 'provider-protocol.jsonl');
    const Socket = require('node:module').createRequire(path.join(ROOT, 'services/crm-voice-relay/package.json'))('ws');
    class ObservedSocket extends Socket {
        emit(event, ...args) {
            if (event === 'message') {
                try {
                    const value = JSON.parse(args[0].toString('utf8'));
                    const shape = JSON.stringify(value, (key, item) => ['data', 'thoughtSignature', 'newHandle'].includes(key) && typeof item === 'string' ? { length: item.length } : item);
                    fs.appendFileSync(protocolPath, shape + '\n');
                } catch (_) { fs.appendFileSync(protocolPath, '{"invalidJson":true}\n'); }
            }
            return super.emit(event, ...args);
        }
    }
    let suite, server, relay, browser, page, budget;
    try {
        suite = await h.bootSuite(); const c = await h.project(suite, `native-${runId}`); await c.task('voice-subject');
        const nativeBase = createNativeGemini({ apiKey: process.env.GEMINI_API_KEY, generationFormat: 'json', fetchImpl: async (...args) => {
            (report.requestBodies ||= []).push({ generationFormat: 'json', sha256: require('node:crypto').createHash('sha256').update(args[1].body).digest('hex'), bytes: Buffer.byteLength(args[1].body), providerSchema: Object.hasOwn(JSON.parse(args[1].body).generationConfig, 'responseJsonSchema') }); save(); const response = await fetch(...args), copy = response.clone(); const chunks = []; let size = 0;
            for await (const chunk of copy.body) { size += chunk.length; if (size > 131072) break; chunks.push(Buffer.from(chunk)); }
            let observed; try { observed = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (_) { observed = {}; }
            (report.httpProvider ||= []).push({ status: response.status, responseId: observed.responseId || null, errorCode: observed.error?.code || null, errorStatus: observed.error?.status || null, errorDetails: observed.error?.details ? JSON.parse(JSON.stringify(observed.error.details).replaceAll(process.env.GEMINI_API_KEY || '\0', '[redacted]')) : null, errorMessage: typeof observed.error?.message === 'string' ? observed.error.message.replaceAll(process.env.GEMINI_API_KEY || '\0', '[redacted]').slice(0, 1000) : null, candidates: observed.candidates ? JSON.parse(JSON.stringify(observed.candidates, (key, value) => ['thoughtSignature', 'newHandle'].includes(key) ? '[redacted]' : value)) : null, usageMetadata: observed.usageMetadata || null }); save(); return response;
        } });
        const native = { ...nativeBase, async generationTransport(args) { (report.generationRequests ||= []).push({ descriptor: args.request.descriptor, maxOutputTokens: args.request.maxOutputTokens }); save(); const result = await nativeBase.generationTransport(args); (report.generationResults ||= []).push({ descriptor: args.request.descriptor, output: result.output, evidence: result.evidence }); save(); return result; } };
        budget = createProjectsBudgetService({ db: suite.db, accessService: suite.accessService, nativeMode: true, nativePolicy: native.policy, pricingRegistry: native.pricingRegistry, providerAdapters: { gemini: native.accountingAdapter } });
        const recoveryService = createProjectsRecoveryService({ db: suite.db, accessService: suite.accessService, commandService: suite.commandService, queryService: require('../../../functions/src/crm/projects/domain/query-service').createProjectsQueryService({ db: suite.db, accessService: suite.accessService }) });
        const draftService = createProjectsDraftService({ db: suite.db, accessService: suite.accessService, commandService: suite.commandService, recoveryService });
        const sessionService = createVoiceSessionService({ db: suite.db, runTransaction: work => runTransactionWithClosedRetry(suite.db, work), featureAdapters: { projects: draftService.voiceAdapter }, nativeMode: true });
        const app = express(); app.use(express.json()); let origin;
        app.use('/api/projects', require('../../../functions/src/routes/crm/projects')({ db: suite.db, auth: suite.auth, accessService: suite.accessService, commandService: suite.commandService, recoveryService, draftService, budgetService: budget, projectsNativeGemini: native, get projectsVoiceRelayUrl() { return origin; } }));
        const endpoint = value => { const [host, port] = value.split(':'); return { host, port: Number(port) }; };
        app.get('/api/config', (_req, res) => res.json({ success: true, config: { apiKey: 'demo-key', authDomain: 'demo-crm-projects.firebaseapp.com', projectId: 'demo-crm-projects', storageBucket: 'demo-crm-projects.appspot.com', appId: '1:000000000000:web:nativevoice' }, emulators: { auth: endpoint(process.env.FIREBASE_AUTH_EMULATOR_HOST), firestore: endpoint(process.env.FIRESTORE_EMULATOR_HOST), storage: endpoint(process.env.FIREBASE_STORAGE_EMULATOR_HOST) }, features: { projects: true } }));
        app.get('/crm-admin.html', (_req, res) => { const doc = buildLocalCrmAdminDocument(fs.readFileSync(path.join(ROOT, 'public/crm-admin.html'), 'utf8'), process.env, 'demo-crm-projects'); res.set('Content-Security-Policy', doc.policy.replace(/connect-src([^;]*)/, (_all, values) => `connect-src${values} ${origin.replace(/^http/, 'ws')}`)).type('html').send(doc.html); });
        app.get('/__login', (_req, res) => res.type('html').send(`<!doctype html><script src="https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js"></script><script src="https://www.gstatic.com/firebasejs/9.22.0/firebase-auth-compat.js"></script><script>(async()=>{const c=await(await fetch('/api/config')).json();firebase.initializeApp(c.config);firebase.auth().useEmulator('http://'+c.emulators.auth.host+':'+c.emulators.auth.port,{disableWarnings:true});await firebase.auth().signInWithEmailAndPassword(${JSON.stringify(h.USERS.owner)},${JSON.stringify(h.PASSWORD)});location.replace('/crm-admin.html#projects')})()</script>`));
        app.use(express.static(path.join(ROOT, 'public')));
        server = http.createServer(app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${server.address().port}`;
        relay = createRelayServer({ sessionService, authenticate: token => suite.auth.verifyIdToken(token, true), ledger: budget.ledger, nativeMode: true, allowedOrigins: [origin], providerFactory: createNativeVoiceProvider({ apiKey: process.env.GEMINI_API_KEY, native, ledger: budget.ledger, connector: options => require('../../../services/crm-voice-relay/gemini-live-connector').createGeminiLiveConnector({ ...options, WebSocketImpl: ObservedSocket }) }), onDiagnostic: value => { report.diagnostics.push(value); save(); }, features: { projects: { engineeringOnly: false, provider: 'gemini', model: 'gemini-3.1-flash-live-preview', admission: async scope => { const value = await sessionService.providerChannel({ actorUid: scope.actorUid, feature: scope.feature, sessionId: scope.sessionId, epoch: scope.epoch }).getContext(); return { model: 'gemini-3.1-flash-live-preview', purpose: 'planning', context: value.context.mode === 'create_project' ? { mode: 'create_project' } : { projectId: value.context.project.id }, boundsVersion: native.policy.versionId, request: { kind: 'live', inputBytes: Buffer.byteLength(JSON.stringify(value)), audioBytes: 3840000, maxOutputTokens: 512 } }; } } } });
        server.removeAllListeners('request'); server.on('request', (req, res) => ['/prepare', '/status'].includes(req.url) ? relay.server.emit('request', req, res) : app(req, res)); server.on('upgrade', (req, socket, head) => relay.server.emit('upgrade', req, socket, head));
        if (process.env.CRM_NATIVE_PROPOSAL_DIAGNOSTIC === 'true') {
            report.proposalOutcome = await h.jsonRequest(server, '/api/projects/ai/proposals', await suite.token('owner'), 'POST', { requestId: `diagnostic-${runId}`, contextHints: { projectId: c.projectId, view: 'board', selectedTaskIds: ['voice-subject'], filters: {} }, instruction: 'Change the title of the selected task to native voice review.', purpose: 'task_draft' });
            save(); assert.equal(report.proposalOutcome.status, 200, JSON.stringify(report.proposalOutcome.body));
            const proposal = report.proposalOutcome.body; assert.equal(proposal.kind, 'task_draft'); assert.equal(proposal.draft.actions.length, 1); assert.equal(proposal.draft.actions[0].patch.title.toLowerCase(), 'native voice review');
            const persisted = await draftService.read({ uid: h.UID_BY_ROLE.owner }, proposal.draft.draftId); assert.deepEqual(persisted.actions, proposal.draft.actions); report.persistedDraft = persisted;
            report.state = 'proposal_diagnostic_passed'; return;
        }
        const microphone = path.join(out, 'microphone.wav');
        const loadSpeech = name => { const audio = fs.readFileSync(path.join(ROOT, 'work/crm-projects-recovery', name)); assert.equal(audio.toString('ascii', 0, 4), 'RIFF'); const dataAt = audio.indexOf(Buffer.from('data')); const size = audio.readUInt32LE(dataAt + 4); fs.writeFileSync(microphone, wav(Buffer.concat([Buffer.alloc(96000), audio.subarray(dataAt + 8, dataAt + 8 + size), Buffer.alloc(640000)]))); };
        loadSpeech({ edit_task: 'native-edit-speech.wav', create_task: 'native-create-task-speech.wav', create_project: 'native-create-project-speech.wav', edit_project: 'native-edit-project-speech.wav' }[scenario]);
        browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${microphone}`, '--autoplay-policy=no-user-gesture-required'] });
        page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, permissions: ['microphone'] });
        await page.addInitScript(installAcceptanceInstrumentation, { muteEnabled });
        report.errors = []; page.on('pageerror', error => report.errors.push(error.message));
        await page.goto(origin + '/__login');
        await page.waitForFunction(id => !!window.projectsAssistantController && !document.getElementById('btn-projects-access-refresh')?.disabled && Array.from(document.getElementById('projects-board-project-select')?.options || []).some(option => option.value === id), c.projectId);
        await page.locator('#projects-board-project-select').selectOption(c.projectId);
        await page.waitForFunction(id => window.projectsAssistantController?.getState()?.context.projectId === id && !document.getElementById('btn-projects-board-refresh')?.disabled, c.projectId);
        await page.locator('[data-task-id="voice-subject"] [data-action="select-task"]').check();
        await page.getByText('Project assistance', { exact: true }).click();
        const button = action => page.locator(`[data-assistant-action="${action}"]`);
        if (scenario === 'create_project') await button('creation').click();
        const speak = async phase => {
            await button('start').click(); await page.waitForFunction(() => window.projectsAssistantController.getState().status === 'Voice connected.', null, { timeout: 15000 }); await page.waitForTimeout(8000); await button('finish').click();
            const finishClickMs = await page.evaluate(() => window.__crmNativeAcceptance.timeline.finishClicks.at(-1));
            assert.ok(Number.isFinite(finishClickMs), 'Actual Finish speaking click must be observed'); report.timings[phase] = { finishClickMs }; save();
        };
        const projectNameBefore = scenario === 'edit_project' ? (await c.projectData()).name : undefined;
        const reportName = value => value.replaceAll(process.env.GEMINI_API_KEY || '\0', '[redacted]');
        if (scenario === 'edit_project') { assert.equal(typeof projectNameBefore, 'string'); report.projectRename = { before: reportName(projectNameBefore) }; save(); }
        await speak('instruction');
        if (muteEnabled) {
            try {
                await page.waitForFunction(() => {
                    const value = window.__crmNativeAcceptance.audio.snapshot();
                    return value.activeIds.length > 0 || !value.available || value.overflow || !!window.projectsAssistantController.getState().preview;
                }, null, { timeout: 90000 });
                report.mute.before = await page.evaluate(() => window.__crmNativeAcceptance.audio.snapshot()); save();
                assert.ok(report.mute.before.available && !report.mute.before.overflow && report.mute.before.activeIds.length > 0, 'No active response audio was available for the mute click');
                await button('interrupt').click({ timeout: 1000 });
                report.mute.after = await page.evaluate(() => window.__crmNativeAcceptance.audio.snapshot()); save();
                assert.ok(report.mute.after.muteClick?.activeIds.length > 0, 'Response ended before the actual mute click; no active-playback evidence');
            } catch (error) { report.mute.state = 'inconclusive'; report.mute.reason = 'Could not capture real response audio actively rendering at the actual Mute response click.'; save(); throw error; }
            const after = report.mute.after, click = after.muteClick;
            report.mute.state = 'failed';
            assert.equal(after.overflow, false); assert.equal(after.starts, click.starts, 'Mute must not start another response source'); assert.equal(after.scheduledIds.length, 0, 'Mute must stop all currently playing and scheduled sources');
            for (const id of click.scheduledIds) assert.ok(after.sources.some(row => row.id === id && row.stopCalledAtMs >= click.atMs), 'Every source pending at the click must receive a real stop call');
            if (!after.sources.some(row => click.activeIds.includes(row.id) && row.stoppedWhileRendering && row.stopCalledAtMs >= click.atMs)) {
                report.mute.state = 'inconclusive'; report.mute.reason = 'The active audio interval ended between the click and its stop call.'; save(); assert.fail('No source was still rendering at its real stop call');
            }
            assert.equal(await page.evaluate(() => window.projectsAssistantController.getState().responseAudioMuted), true);
            report.mute.state = 'muted_waiting_for_exact_preview'; save();
        }
        await page.waitForFunction(() => { const state = window.projectsAssistantController.getState(); return !!state.preview || /disconnected|unavailable/.test(state.status); }, null, { timeout: 90000 });
        assert.ok(await page.evaluate(() => window.projectsAssistantController.getState().preview), 'Native instruction must produce a preview');
        const before = await c.taskData('voice-subject'); report.before = before;
        const preview = await page.evaluate(() => window.projectsAssistantController.getState().preview);
        report.preview = preview; save(); await page.screenshot({ path: path.join(out, 'preview.png'), fullPage: true });
        assert.equal(preview.actions.length, 1, 'Review must contain only the requested action before confirmation');
        const action = preview.actions[0];
        if (scenario === 'create_project') { assert.equal(action.kind, 'create_project'); assert.deepEqual({ ...action.project, name: action.project.name.toLowerCase() }, { name: 'native voice project' }); }
        else if (scenario === 'create_task') { assert.equal(action.kind, 'create_task'); assert.deepEqual({ ...action.task, title: action.task.title.toLowerCase() }, { title: 'native voice task' }); assert.equal(action.sectionId, 's1'); }
        else if (scenario === 'edit_project') { assert.equal(action.kind, 'update_project'); assert.deepEqual({ ...action.patch, name: action.patch.name.toLowerCase() }, { name: 'native voice renamed' }); }
        else { assert.equal(action.kind, 'field_update'); assert.equal(action.taskId, 'voice-subject'); assert.deepEqual({ ...action.patch, title: action.patch.title.toLowerCase() }, { title: 'native voice review' }); }
        if (scenario === 'create_project') assert.equal((await suite.db.collection('crmProjects').doc(preview.projectId).get()).exists, false);
        else if (scenario === 'create_task') assert.equal((await suite.db.collection('crmProjects').doc(c.projectId).collection('tasks').doc(preview.impact.task.id).get()).exists, false);
        else if (scenario === 'edit_task') assert.notEqual(before.title.toLowerCase(), 'native voice review');
        else if (scenario === 'edit_project') { assert.equal((await c.projectData()).name, projectNameBefore, 'Project preview must not change the persisted name'); assert.notEqual(projectNameBefore.toLowerCase(), 'native voice renamed'); }
        const previewObserved = await page.evaluate(() => window.__crmNativeAcceptance.timeline.previewVisible);
        assert.ok(previewObserved && previewObserved.atMs >= report.timings.instruction.finishClickMs, 'Visible preview must follow Finish speaking');
        assert.equal(previewObserved.previewId, preview.previewId); assert.equal(previewObserved.actionsJson, JSON.stringify(preview.actions), 'Timed visible preview must match the exact validated actions');
        Object.assign(report.timings.instruction, { previewVisibleMs: previewObserved.atMs, finishToVisibleExactPreviewMs: previewObserved.atMs - report.timings.instruction.finishClickMs,
            definition: 'Actual Finish click capture to first MutationObserver observation of the visible preview, subsequently checked for exact actions and no mutation.' });
        if (muteEnabled) {
            report.mute.atExactPreview = await page.evaluate(() => window.__crmNativeAcceptance.audio.snapshot());
            assert.equal(report.mute.atExactPreview.overflow, false); assert.equal(report.mute.atExactPreview.starts, report.mute.after.muteClick.starts, 'No later response source may start before the exact preview'); assert.equal(report.mute.atExactPreview.scheduledIds.length, 0);
            report.mute.state = 'passed'; report.cases.push({ name: 'Mute response stops active and scheduled audio with no later starts while exact preview completes', passed: true });
        }
        report.cases.push({ name: 'spoken instruction creates exact requested preview without mutation', passed: true }); save();
        const appliedResponse = page.waitForResponse(response => response.url().endsWith('/apply') && response.request().method() === 'POST', { timeout: 90000 }); appliedResponse.catch(() => {});
        loadSpeech('native-confirm-speech.wav'); await speak('confirmation');
        const applied = await appliedResponse; report.applyResponse = await applied.json(); assert.equal(applied.status(), 200, JSON.stringify(report.applyResponse));
        const applyReceiptObservedMs = await page.evaluate(() => performance.now());
        assert.ok(applyReceiptObservedMs >= report.timings.confirmation.finishClickMs);
        Object.assign(report.timings.confirmation, { applyReceiptObservedMs, finishToApplyReceiptMs: applyReceiptObservedMs - report.timings.confirmation.finishClickMs,
            definition: 'Actual confirmation Finish click capture to browser monotonic time sampled after the complete successful apply HTTP response was parsed; includes observation overhead.' }); save();
        const resultingProjectId = preview.projectId;
        if (scenario === 'edit_task') assert.equal((await c.taskData('voice-subject')).title.toLowerCase(), 'native voice review');
        else if (scenario === 'create_task') { const created = await c.taskData(preview.impact.task.id); assert.equal(created.title.toLowerCase(), 'native voice task'); }
        else { const project = (await suite.db.collection('crmProjects').doc(resultingProjectId).get()).data(); assert.equal(project.name.toLowerCase(), scenario === 'create_project' ? 'native voice project' : 'native voice renamed'); if (scenario === 'edit_project') report.projectRename.afterApply = reportName(project.name); }
        report.cases.push({ name: 'separate spoken confirmation commits exact preview', passed: true });
        await page.screenshot({ path: path.join(out, 'committed.png'), fullPage: true });
        const receipt = await suite.db.collection('crmProjectOperations').doc(preview.operationId).get(); report.receipt = receipt.exists ? receipt.data() : null; assert.ok(report.receipt);
        await page.reload(); await page.waitForFunction(() => !!window.projectsAssistantController);
        assert.deepEqual((await suite.db.collection('crmProjectOperations').doc(preview.operationId).get()).data(), report.receipt);
        report.cases.push({ name: 'page reconnect retains the committed receipt without another apply', passed: true });
        const undone = await h.jsonRequest(server, `/api/projects/${resultingProjectId}/operations/${preview.operationId}/undo`, await suite.token('owner'), 'POST', { operationId: `undo-${runId}` }); assert.equal(undone.status, 200, JSON.stringify(undone.body)); report.undo = undone.body;
        if (scenario === 'create_project') assert.equal((await suite.db.collection('crmProjects').doc(resultingProjectId).get()).data().lifecycle, 'archived');
        else if (scenario === 'create_task') assert.equal((await c.taskData(preview.impact.task.id)).lifecycle, 'archived');
        else if (scenario === 'edit_task') assert.equal((await c.taskData('voice-subject')).title, before.title);
        else if (scenario === 'edit_project') { const restoredName = (await suite.db.collection('crmProjects').doc(resultingProjectId).get()).data().name; report.projectRename.afterUndo = reportName(restoredName); assert.equal(restoredName, projectNameBefore, 'Project Undo must restore the exact persisted prior name'); }
        report.cases.push({ name: 'authenticated Undo restores prior state or archives the created record', passed: true });
        report.state = 'passed';
    } catch (error) { report.state = 'failed'; report.error = String(error.stack).replaceAll(process.env.GEMINI_API_KEY || '__no_key__', '[redacted]'); if (page) { report.ui = await page.evaluate(() => window.projectsAssistantController?.getState()).catch(() => null); await page.screenshot({ path: path.join(out, 'failure.png'), fullPage: true }).catch(() => {}); } process.exitCode = 1; }
    finally {
        await browser?.close(); await relay?.close();
        if (budget && suite) { report.budget = await budget.feature.getBudget(h.UID_BY_ROLE.owner).catch(error => ({ error: error.code })); const reservations = await suite.db.collection('crmAiBudgetReservations').get(); report.usage = reservations.docs.map(doc => { const value = doc.data(); delete value.dispatchToken; return value; }); }
        if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } await suite?.close(); report.finishedAt = new Date().toISOString(); save(); process.stdout.write(JSON.stringify({ state: report.state, report: path.join(out, 'report.json'), cases: report.cases }) + '\n');
    }
}
void main();
