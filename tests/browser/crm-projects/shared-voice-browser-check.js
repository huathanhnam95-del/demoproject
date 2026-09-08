'use strict';
// Authoring-only until the root isolated runner executes it. Native Chrome
// audio/worklet/socket APIs; deterministic fake microphone; synthetic transcripts.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require('playwright');
const h = require('../../crm/projects/phase8-test-helpers');
const { createVoiceSessionService } = require('../../../functions/src/ai-assistance/voice/session-service');
const { createRelayServer } = require('../../../services/crm-voice-relay/server');
const { AI_VOICE_COLLECTIONS: V } = require('../../../functions/src/ai-assistance/collections');
const ROOT = path.resolve(__dirname, '../../..');
const EXTERNAL = path.resolve(process.env.CRM_DATA_INPUT_CHECKOUT || 'C:/Cursor AI-data-input-20260907');
const ARTIFACTS = path.join(ROOT, 'test-results/crm-projects/shared-voice-browser');
const report = { provenance: 'Synthetic engineering provider transcription; native Chrome audio plumbing only', cases: [], relayDiagnostics: [], pageErrors: [], sources: [], screenshots: [], network: [], startedAt: new Date().toISOString() };
function pcm(samples, rate, frequency) { const bytes = Buffer.alloc(samples * 2); for (let n = 0; n < samples; n++) bytes.writeInt16LE(Math.round(9000 * Math.sin(2 * Math.PI * frequency * n / rate)), n * 2); return bytes; }
function wav(bytes, rate) { const header = Buffer.alloc(44); header.write('RIFF'); header.writeUInt32LE(36 + bytes.length, 4); header.write('WAVEfmt ', 8); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(bytes.length, 40); return Buffer.concat([header, bytes]); }
async function until(check, label, timeout = 15000) { const end = Date.now() + timeout; while (Date.now() < end) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 30)); } throw Error(`Timeout: ${label}`); }
function instrument() {
    const evidence = window.nativeVoiceEvidence = { events: [], contexts: [], tracks: [], starts: [], stops: [] };
    const log = (kind, data = {}) => evidence.events.push({ kind, at: performance.now(), ...data });
    const nativeFetch = window.fetch; window.fetch = async function (...args) { const response = await Reflect.apply(nativeFetch, this, args); if (new URL(String(args[0]), location.href).pathname === '/prepare' && response.ok) log('prepare-completed'); return response; };
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => { log('microphone-requested'); const stream = await getUserMedia(constraints); evidence.tracks.push(...stream.getTracks()); log('microphone-opened'); return stream; };
    const NativeContext = window.AudioContext;
    window.AudioContext = new Proxy(NativeContext, { construct(Target, args) { const context = Reflect.construct(Target, args); evidence.contexts.push(context); log('context-created', { sampleRate: context.sampleRate, native: context instanceof NativeContext }); context.addEventListener('statechange', () => log('context-state', { state: context.state })); return context; } });
    const start = AudioBufferSourceNode.prototype.start, stop = AudioBufferSourceNode.prototype.stop;
    AudioBufferSourceNode.prototype.start = function (...args) { evidence.starts.push({ at: performance.now(), sampleRate: this.buffer?.sampleRate, duration: this.buffer?.duration, scheduledAt: args[0] }); return Reflect.apply(start, this, args); };
    AudioBufferSourceNode.prototype.stop = function (...args) { evidence.stops.push({ at: performance.now() }); return Reflect.apply(stop, this, args); };
    const trackStop = MediaStreamTrack.prototype.stop;
    MediaStreamTrack.prototype.stop = function (...args) { log('track-stop', { kind: this.kind }); return Reflect.apply(trackStop, this, args); };
}
async function main() {
    fs.mkdirSync(ARTIFACTS, { recursive: true }); const microphone = path.join(ARTIFACTS, 'synthetic-microphone-16k.wav'); fs.writeFileSync(microphone, wav(pcm(32000, 16000, 440), 16000));
    const suite = await h.bootSuite(); let relay, browser, page; const drivers = [];
    const save = () => fs.writeFileSync(path.join(ARTIFACTS, 'report.json'), JSON.stringify(report, null, 2));
    const shot = async name => { const file = path.join(ARTIFACTS, `${name}.png`); await page.screenshot({ path: file, fullPage: true }); report.screenshots.push(file); };
    const run = async (name, fn) => { try { await fn(); report.cases.push({ name, passed: true }); } catch (error) { report.cases.push({ name, passed: false, error: error.stack }); if (page && !page.isClosed()) await shot(`failure-${report.cases.length}`).catch(() => {}); throw error; } finally { save(); } };
    try {
        suite.setTime(new Date()); const c = await h.project(suite, 'shared-voice-browser'), uid = c.uids.owner;
        await suite.db.collection('users').doc(uid).update({ isAdmin: true }); await h.resetBudget(suite, uid);
        const accounting = await h.accounting(suite, c), initialProject = (await suite.db.collection('crmProjects').doc(c.projectId).get()).data();
        const draftRef = suite.db.collection('crmProjectOrganizationConfig').doc(`voice-browser-${crypto.randomUUID()}`); await draftRef.set({ revision: 1, instructions: [], effects: [], engineeringOnly: true }); const initialDraft = (await draftRef.get()).data();
        const sessionService = createVoiceSessionService({ db: suite.db, runTransaction: fn => suite.db.runTransaction(fn), now: Date.now, engineeringMode: true, featureAdapters: { 'crm-data-input': {
            async authorize({ tx, actorUid }) { const account = await suite.auth.getUser(actorUid); const profile = await tx.get(suite.db.collection('users').doc(actorUid)); return actorUid === uid && !account.disabled && profile.exists && profile.data().isAdmin === true; },
            async resolveContext({ tx }) { const draft = (await tx.get(draftRef)).data(); return { summary: 'Engineering voice drafting, no save authorization', previewBinding: null, context: { draftRevision: draft.revision } }; }, confirm: () => false
        } } });
        const origin = `http://127.0.0.1:${suite.server.address().port}`;
        const providerFactory = async ({ scope, context, sendPermit, onMessage, onError }) => {
            assert.equal(sendPermit.engineeringOnly, true); assert.equal(context.context.draftRevision, 1);
            const driver = { scope, permit: { reservationId: sendPermit.reservationId }, chunks: [], utterances: new Map(), closed: false, interrupts: 0, emit: onMessage, disconnect: onError };
            drivers.push(driver);
            return { async sendAudio({ bytes, sampleRate, utteranceId }) { assert.equal(sampleRate, 16000); assert.ok(bytes.length >= 640 && bytes.length <= 3200 && bytes.length % 640 === 0); driver.lastUtterance = utteranceId; driver.chunks.push(Buffer.from(bytes)); driver.utterances.set(utteranceId, (driver.utterances.get(utteranceId) || 0) + bytes.length); }, interrupt() { driver.interrupts++; }, close() { driver.closed = true; }, updateContext() {} };
        };
        providerFactory.engineeringOnly = true;
        relay = createRelayServer({ sessionService, authenticate: token => suite.auth.verifyIdToken(token, true), allowedOrigins: [origin], ledger: accounting.ledger, engineeringMode: true, onDiagnostic: value => report.relayDiagnostics.push(value), providerFactory, features: { 'crm-data-input': { engineeringOnly: true, model: 'engineering-model', provider: 'engineering-provider', admission: () => accounting.request('relay', '1', 'crm-data-input') } } });
        await new Promise(resolve => relay.server.listen(0, '127.0.0.1', resolve)); const relayUrl = `http://127.0.0.1:${relay.server.address().port}`;
        const sources = [
            ['/voice-transport.js', path.join(ROOT, 'public/js/crm/ai-assistance/voice-transport.js')],
            ['/js/crm/ai-assistance/voice-audio-worklet.js', path.join(ROOT, 'public/js/crm/ai-assistance/voice-audio-worklet.js')],
            ['/data-input-voice.js', path.join(EXTERNAL, 'public/js/crm/data-input/voice.js')],
            ['/data-input-voice-panel.js', path.join(EXTERNAL, 'public/js/crm/data-input/voice-panel.js')]
        ];
        for (const [route, file] of sources) { const bytes = fs.readFileSync(file); report.sources.push({ file, sha256: crypto.createHash('sha256').update(bytes).digest('hex') }); suite.api.get(route, (_req, res) => { res.on('finish', () => report.network.push({ path: route, status: res.statusCode, observedBy: 'fixture-server' })); res.type('application/javascript').send(bytes); }); }
        suite.api.get('/__voice-fixture', async (_req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json({ uid, token: await suite.token('owner'), relayUrl }); });
        suite.api.get('/__voice-check', (_req, res) => res.type('html').send(`<!doctype html><meta charset="utf-8"><title>Shared voice engineering acceptance</title><style>body{font:18px system-ui;max-width:900px;margin:48px auto;color:#172033}textarea{width:100%;min-height:130px}button{padding:12px;margin:5px}p{line-height:1.5}</style><h1>Shared voice drafting</h1><p>Engineering microphone and transcription fixture. No provider or business write.</p><label>Instruction<textarea id="instruction">Manual draft retained</textarea></label><section id="voice"></section><script src="/voice-transport.js"></script><script src="/data-input-voice.js"></script><script src="/data-input-voice-panel.js"></script><script>(async()=>{const f=await(await fetch('/__voice-fixture')).json();window.testUid=f.uid;window.voiceErrors=[];window.transport=CrmAiVoiceTransport.createTransport({getUid:()=>window.testUid,getIdToken:()=>Promise.resolve(f.token),getContext:()=>({}),baseUrl:f.relayUrl});window.panel=CrmDataInputVoicePanel.createPanel({host:document.querySelector('#voice'),instruction:document.querySelector('#instruction'),transport:window.transport,getUid:()=>window.testUid,perform:action=>Promise.resolve().then(action).catch(e=>window.voiceErrors.push(e.message)),canStart:()=>true});window.voiceReady=true})().catch(e=>window.voiceErrors=[e.message])</script>`));
        browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${microphone}`, '--autoplay-policy=no-user-gesture-required'] });
        page = await browser.newPage({ viewport: { width: 1200, height: 900 }, permissions: ['microphone'] }); await page.addInitScript(instrument);
        page.on('pageerror', error => report.pageErrors.push(error.message)); page.on('response', response => { const url = new URL(response.url()); if (['/prepare', '/status', '/voice-transport.js', '/js/crm/ai-assistance/voice-audio-worklet.js'].includes(url.pathname)) report.network.push({ path: url.pathname, status: response.status() }); });
        await page.goto(`${origin}/__voice-check`); await page.waitForFunction(() => window.voiceReady);
        await run('actual panel prepares before microphone and native worklet delivers bounded 100ms16k PCM batches', async () => {
            await page.getByRole('button', { name: 'Start voice', exact: true }).click(); await page.getByRole('status').filter({ hasText: 'Microphone on.' }).waitFor();
            await until(() => drivers[0]?.chunks.length >= 5, 'native PCM');
            assert.ok(drivers[0].chunks.every(chunk => chunk.length === 3200)); assert.ok(Buffer.concat(drivers[0].chunks).some(byte => byte !== 0));
            const events = await page.evaluate(() => nativeVoiceEvidence.events); const preparedAt = events.findIndex(e => e.kind === 'prepare-completed'), microphoneAt = events.findIndex(e => e.kind === 'microphone-requested'); assert.ok(preparedAt >= 0 && microphoneAt >= 0 && preparedAt < microphoneAt); assert.ok(events.some(e => e.kind === 'context-created' && e.native));
            assert.ok(report.network.some(e => e.path.includes('voice-audio-worklet') && e.status === 200)); await shot('microphone-listening');
        });
        await run('partial speech does not append; synthetic final appends once with durable provider utterance', async () => {
            const driver = drivers[0], utteranceId = driver.lastUtterance;
            driver.emit({ userTranscription: { utteranceId, eventId: 'partial1', text: 'Create a student', final: false } });
            await page.getByLabel('Live transcript').filter({ hasText: 'Create a student' }).waitFor(); assert.equal(await page.locator('#instruction').inputValue(), 'Manual draft retained');
            driver.emit({ userTranscription: { utteranceId, eventId: 'final1', text: 'Create a student named Synthetic Lan.', final: true } });
            await page.waitForFunction(() => document.querySelector('#instruction').value.includes('Synthetic Lan.'));
            assert.equal(await page.locator('#instruction').inputValue(), 'Manual draft retained\nCreate a student named Synthetic Lan.');
            const rows = await suite.db.collection(V.utterances).where('sessionId', '==', driver.scope.sessionId).get(); const final = rows.docs.map(doc => doc.data()).filter(row => row.state === 'final'); assert.equal(final.length, 1); assert.equal(final[0].text, 'Create a student named Synthetic Lan.'); assert.equal(final[0].attestationId, null);
            report.durableUtterance = { sessionId: driver.scope.sessionId, utteranceId, bytesReceived: driver.utterances.get(utteranceId), state: final[0].state, attestationId: final[0].attestationId }; await shot('final-draft-text');
        });
        await run('24k assistant audio uses native playback; interrupt stops playback while capture continues', async () => {
            const driver = drivers[0], data = pcm(12000, 24000, 660).toString('base64');
            for (let n = 0; n < 4; n++) driver.emit({ assistant: { parts: [{ audio: { data, sampleRate: 24000 } }] } });
            await page.waitForFunction(() => nativeVoiceEvidence.starts.length >= 4); const before = driver.chunks.length;
            await page.getByRole('button', { name: 'Interrupt reply', exact: true }).click(); await until(() => driver.interrupts === 1, 'provider interrupt'); await until(() => driver.chunks.length > before + 2, 'capture continues');
            const audio = await page.evaluate(() => ({ starts: nativeVoiceEvidence.starts, stops: nativeVoiceEvidence.stops, tracks: nativeVoiceEvidence.tracks.map(t => t.readyState) })); assert.ok(audio.starts.every(e => e.sampleRate === 24000)); assert.ok(audio.stops.length > 0); assert.ok(audio.tracks.includes('live')); report.playback = audio;
        });
        const clean = async () => page.waitForFunction(() => nativeVoiceEvidence.tracks.every(t => t.readyState === 'ended') && nativeVoiceEvidence.contexts.every(c => c.state === 'closed'));
        const newSession = async () => { await until(() => drivers.every(d => d.closed), 'previous provider cleanup'); await until(async () => (await suite.db.collection(h.AI_ASSISTANCE_COLLECTIONS.reservations).doc(drivers.at(-1).permit.reservationId).get()).data()?.state === 'usage_unknown', 'durable unknown accounting'); assert.equal((await accounting.dataInput.getBudget(uid)).blockReason, 'USAGE_UNKNOWN'); await h.resetBudget(suite, uid); await page.evaluate(uid => { window.testUid = uid; window.panel.refresh(); }, uid); const count = drivers.length; await page.getByRole('button', { name: 'Start voice', exact: true }).click(); await until(() => drivers.length > count && drivers.at(-1).chunks.length >= 3, 'next live session'); return drivers.at(-1); };
        await run('disconnect closes native tracks and context without automatic reconnect', async () => {
            const driver = drivers[0]; driver.disconnect(); await clean(); await until(() => driver.closed, 'driver closed'); const count = drivers.length;
            await page.waitForTimeout(400); assert.equal(drivers.length, count); await shot('disconnected-cleanup');
        });
        await run('UID change retires native resources and rejects late provider text', async () => {
            const driver = await newSession(), before = await page.locator('#instruction').inputValue(), utteranceId = driver.lastUtterance;
            await page.evaluate(() => { window.testUid = 'different-user'; window.panel.refresh(); });
            driver.emit({ userTranscription: { utteranceId, eventId: 'late-final', text: 'MUST NOT APPEND', final: true } });
            await clean(); await until(() => driver.closed, 'UID provider close'); assert.equal(await page.locator('#instruction').inputValue(), before); await shot('uid-change-cleanup');
        });
        await run('explicit stop and panel disposal clean resources and preserve manual/domain drafts', async () => {
            await newSession(); await page.getByRole('button', { name: 'Stop voice', exact: true }).click(); await clean();
            await newSession(); await page.evaluate(() => window.panel.dispose()); await clean(); await until(() => drivers.every(d => d.closed), 'disposed provider cleanup'); assert.equal(await page.locator('#voice').innerHTML(), '');
            assert.deepEqual((await draftRef.get()).data(), initialDraft); assert.deepEqual((await suite.db.collection('crmProjects').doc(c.projectId).get()).data(), initialProject);
            assert.equal(await page.locator('#instruction').inputValue(), 'Manual draft retained\nCreate a student named Synthetic Lan.'); assert.deepEqual(report.pageErrors, []);
        });
        report.nativeLifecycle = await page.evaluate(() => ({ events: nativeVoiceEvidence.events, starts: nativeVoiceEvidence.starts, stops: nativeVoiceEvidence.stops, contexts: nativeVoiceEvidence.contexts.map(c => ({ state: c.state, sampleRate: c.sampleRate })), tracks: nativeVoiceEvidence.tracks.map(t => ({ kind: t.kind, state: t.readyState })) }));
        report.domainUnchanged = true;
    } catch (error) {
        report.failure = { phase: report.cases.length ? 'acceptance' : 'setup', error: error.stack || error.message };
        if (!report.cases.length) report.cases.push({ name: 'browser acceptance setup', passed: false, error: error.stack || error.message });
        throw error;
    } finally {
        if (page && !page.isClosed()) { try { report.nativeLifecycle = await page.evaluate(() => ({ events: nativeVoiceEvidence.events, starts: nativeVoiceEvidence.starts, stops: nativeVoiceEvidence.stops, contexts: nativeVoiceEvidence.contexts.map(c => ({ state: c.state, sampleRate: c.sampleRate })), tracks: nativeVoiceEvidence.tracks.map(t => ({ kind: t.kind, state: t.readyState })) })); report.finalState = await page.evaluate(() => ({ instruction: document.querySelector('#instruction')?.value, panel: document.querySelector('#voice')?.innerText, errors: window.voiceErrors || [] })); } catch (_) { /* Preserve earlier evidence. */ } }
        for (const [index, driver] of drivers.entries()) { fs.writeFileSync(path.join(ARTIFACTS, `captured-${index + 1}-16k.pcm`), Buffer.concat(driver.chunks)); }
        report.pcm = drivers.map((d, index) => ({ file: `captured-${index + 1}-16k.pcm`, chunks: d.chunks.length, bytes: d.chunks.reduce((n, b) => n + b.length, 0), sampleRate: 16000, closed: d.closed }));
        if (browser) await browser.close(); if (relay) await relay.close(); suite.server.closeAllConnections?.(); await suite.close();
        report.finishedAt = new Date().toISOString(); report.passed = report.cases.filter(c => c.passed).length; save();
    }
    process.stdout.write(`${JSON.stringify({ passed: report.passed, cases: report.cases.length, report: path.join(ARTIFACTS, 'report.json') })}\n`);
    if (report.cases.some(c => !c.passed)) process.exitCode = 1;
}
main().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
