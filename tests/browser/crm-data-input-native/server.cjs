'use strict';
// Intentionally absent from every default test manifest. Run only via run.py.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { createExpectedHttpErrorGate } = require('./expected-http-error.cjs');
const imageScenarios = new Set(['image', 'image-payment', 'image-ambiguous-date', 'image-adversarial']);
function required(name) { const value = process.env[name]; if (!value) throw Error(`Missing ${name}`); return value; }
function check(value, message) { if (!value) throw Error(message); }
function validateEmulatorHosts(env = process.env) {
    for (const name of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST']) {
        check(typeof env[name] === 'string' && /^127\.0\.0\.1:\d{4,5}$/.test(env[name]), 'Explicit loopback emulators required.');
    }
}
function createStorageDependencies(projectId, getStorage = () => require('firebase-admin/storage').getStorage()) {
    check(typeof projectId === 'string' && /^demo-[a-z][a-z0-9-]{7,31}$/.test(projectId), 'Synthetic demo project required.');
    return { getStorageBucket: async () => getStorage().bucket(`${projectId}.appspot.com`) };
}
function configuration() {
    check(process.env.CRM_NATIVE_PAID_TEST === 'true', 'Paid native harness is disabled.');
    const runId = required('CRM_NATIVE_RUN_ID'); check(/^[a-z][a-z0-9-]{7,31}$/.test(runId), 'Unique run ID must be 8-32 lowercase characters.');
    const projectId = `demo-${runId}`;
    check(process.env.GCLOUD_PROJECT === projectId, 'GCLOUD_PROJECT must equal demo- plus run ID.');
    validateEmulatorHosts();
    const scenario = required('CRM_NATIVE_SCENARIO'); check(['create', 'edit', 'discard-reconnect', ...imageScenarios].includes(scenario), 'Unknown scenario.');
    const port = Number(required('CRM_NATIVE_HTTP_PORT')); check(Number.isInteger(port) && port >= 1024 && port <= 65535, 'Invalid local port.');
    const maxFlash = Number(required('CRM_NATIVE_MAX_FLASH_CALLS')); check(Number.isInteger(maxFlash) && maxFlash >= 1 && maxFlash <= 6, 'Flash limit must be 1-6.');
    if (imageScenarios.has(scenario)) check(maxFlash === 1, 'Image acceptance permits one Flash call.');
    const apiKey = require('../../../functions/src/ai-assistance/providers/live-chat-credentials').resolveLiveChatApiKey();
    const email = required('CRM_NATIVE_EMAIL'), password = required('CRM_NATIVE_PASSWORD'), control = required('CRM_NATIVE_CONTROL');
    check(control.length >= 32 && !/[\r\n]/.test(control), 'Control credential must have at least 32 characters.');
    const parent = required('CRM_NATIVE_OUTPUT_ROOT'); check(path.isAbsolute(parent) && fs.statSync(parent).isDirectory(), 'Existing absolute external evidence root required.');
    const repo = path.resolve(__dirname, '../../..'), out = path.join(parent, runId);
    const relative = path.relative(repo, out); check(relative.startsWith('..') || path.isAbsolute(relative), 'Evidence must stay outside the checkout.');
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
    check(sha === required('CRM_NATIVE_EXPECTED_SHA'), 'Source SHA changed.');
    check(!execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }).trim(), 'A clean checkpoint is required.');
    check(!fs.existsSync(out), 'Run output already exists; never overwrite a run.');
    return { runId, projectId, scenario, port, maxFlash, apiKey, email, password, control, repo, out, sha };
}

function createEvidenceRedactor(secrets) {
    const cleanText = value => secrets.reduce((text, secret) => text.split(secret).join('[redacted]'), String(value))
        .replace(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, '[redacted-contact]').slice(0, 8192);
    function safe(value) {
        if (typeof value === 'string') return cleanText(value);
        if (Array.isArray(value)) return value.map(safe);
        if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
            .filter(([key]) => !/^(token|dispatchToken|sendPermit|tokenHash|confirmationToken|ticket|ticketHash|secret|password|authorization)$|handle|signature|email|link/i.test(key)).map(([key, item]) => [key, safe(item)]));
        return value;
    }
    return safe;
}

async function main() {
    const c = configuration(); fs.mkdirSync(c.out);
    const expectedErrors = createExpectedHttpErrorGate(c.scenario);
    const secrets = [c.apiKey, c.password, c.control, c.email];
    const safe = createEvidenceRedactor(secrets), cleanText = value => safe(String(value));
    function write(name, value) { fs.writeFileSync(path.join(c.out, name), JSON.stringify(safe(value), null, 2)); }
    const sources = {};
    const tracked = execFileSync('git', ['ls-files', 'functions/src/crm/data-input', 'functions/src/ai-assistance', 'public/js/crm/data-input', 'public/js/crm/ai-assistance', 'services/crm-voice-relay', 'tests/browser/crm-data-input-native', 'public/crm-admin.html'], { cwd: c.repo, encoding: 'utf8' }).trim().split(/\r?\n/);
    for (const file of tracked) sources[file] = crypto.createHash('sha256').update(fs.readFileSync(path.join(c.repo, file))).digest('hex');
    write('source.json', { sha: c.sha, sources, projectId: c.projectId, runId: c.runId, scenario: c.scenario, maxFlash: c.maxFlash, native: true });
    let failure = null, flashCalls = 0, liveCalls = 0, relay, listener, composition, closing;
    const diagnostics = [], providerHttp = [], descriptors = [];
    function failOnce(code) { failure ||= { code: cleanText(code), at: new Date().toISOString() }; write('status.json', { failure, flashCalls, liveCalls }); }
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
        if (new URL(String(url)).hostname !== 'generativelanguage.googleapis.com') return originalFetch(url, options);
        if (failure || flashCalls >= c.maxFlash) { failOnce('PAID_CALL_FENCE'); throw Error('Native run stopped; no retries.'); }
        const record = { call: ++flashCalls, startedAt: new Date().toISOString() }; providerHttp.push(record);
        try {
            const response = await originalFetch(url, options); record.httpStatus = response.status;
            const chunks = []; let bytes = 0;
            for await (const part of response.clone().body) { bytes += part.length; check(bytes <= 131072, 'Provider evidence exceeds limit.'); chunks.push(Buffer.from(part)); }
            let body; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (_) { body = {}; }
            // Whitelist body fields; never retain headers, resumption handles or thought parts.
            record.body = { error: body.error && { code: body.error.code, status: body.error.status, message: cleanText(body.error.message) },
                responseId: body.responseId, modelVersion: body.modelVersion, usageMetadata: body.usageMetadata,
                candidates: body.candidates?.map(candidate => ({ finishReason: candidate.finishReason,
                    text: candidate.content?.parts?.filter(part => !part.thought && typeof part.text === 'string').map(part => cleanText(part.text)) })) };
            if (!response.ok) failOnce(`PROVIDER_HTTP_${response.status}`);
            return response;
        } catch (error) { record.transportFailure = cleanText(error.code || error.name); failOnce('PROVIDER_TRANSPORT_FAILED'); throw error; }
        finally { record.endedAt = new Date().toISOString(); write('provider-http.json', providerHttp); }
    };
    const express = require('express');
    const { db, getAuth } = require(path.join(c.repo, 'functions/src/utils/firebase_admin_init'));
    const auth = getAuth();
    const { composeVoice } = require(path.join(c.repo, 'services/crm-voice-relay/data-input-composition'));
    const { createDataInputNativeServices } = require(path.join(c.repo, 'functions/src/crm/data-input/native-provider'));
    const { createRelayServer } = require(path.join(c.repo, 'services/crm-voice-relay/server'));
    const uid = `${c.runId}-staff`, seedId = `${c.runId}-lead`, fixtureName = 'Cedar Meadow Test';
    const studentId = `${c.runId}-student`, invoiceId = `${c.runId}-invoice`;
    const contactDigest = value => crypto.createHash('sha256').update(typeof value === 'string' ? value : '').digest('hex');
    async function rows(name) { return (await db.collection(name).limit(100).get()).docs.map(doc => ({ id: doc.id, ...doc.data() })); }
    async function evidence() {
        const drafts = await rows('crmDataInputDrafts'), receipts = [], previews = [], attachments = [], interpretations = [];
        for (const draft of drafts) {
            for (const doc of (await db.collection('crmDataInputDrafts').doc(draft.id).collection('attachments').limit(10).get()).docs) {
                const image = doc.data(); attachments.push({ id: doc.id, draftId: draft.id, status: image.status, sha256: image.sha256, width: image.width, height: image.height, bytesLength: image.bytesLength });
            }
            for (const doc of (await db.collection('crmDataInputDrafts').doc(draft.id).collection('interpretations').limit(10).get()).docs) {
                const item = doc.data(); interpretations.push({ id: doc.id, draftId: draft.id, status: item.status, requestDigest: item.requestDigest, source: item.source });
            }
            for (const doc of (await db.collection('crmDataInputDrafts').doc(draft.id).collection('operations').limit(10).get()).docs) {
                const receipt = doc.data(); receipts.push({ id: doc.id, draftId: draft.id, status: receipt.status, results: receipt.results,
                    committedAtMs: receipt.committedAtMs, voiceConfirmation: receipt.voiceConfirmation, paymentAssertion: receipt.paymentAssertion });
            }
            for (const doc of (await db.collection('crmDataInputDrafts').doc(draft.id).collection('previews').limit(10).get()).docs) previews.push({ id: doc.id, draftId: draft.id, review: doc.data().review });
        }
        const leads = await rows('crmLeads');
        const result = { sourceSha: c.sha, runId: c.runId, uid, seedId, failure, flashCalls, liveCalls, expectedHttpErrors: expectedErrors.evidence(),
            leads: leads.map(lead => c.scenario === 'image-adversarial' ? { ...lead, fixtureContactDigest: contactDigest(lead.email) } : lead),
            students: await rows('crmStudents'), invoices: await rows('crmInvoices'), payments: await rows('crmPayments'), receipts, previews, attachments, interpretations, descriptors,
            drafts: drafts.map(draft => ({ id: draft.id, status: draft.status, revision: draft.revision,
                interpretationQuestions: draft.interpretationQuestions || [],
                actions: (draft.actions || []).map(action => c.scenario === 'image-adversarial' ? { ...action,
                    fixtureContactDigest: contactDigest(action.values?.email), fixtureContactSource: {
                        kind: action.provenance?.email?.kind, attachmentId: action.provenance?.email?.attachmentId } } : action), receiptId: draft.receiptId,
                hasPreview: !!draft.preview, hasConfirmation: !!draft.confirmation })),
            ledgers: await rows('crmAiBudgetLedgers'), reservations: await rows('crmAiBudgetReservations'),
            sessions: await rows('crmAiVoiceSessions'), utterances: await rows('crmAiVoiceUtterances'), attestations: await rows('crmAiVoiceAttestations'), diagnostics };
        write('persisted.json', result); return safe(result);
    }
    function close() {
        closing ||= (async () => {
            await relay?.close();
            try { await evidence(); } catch (error) { write('evidence-error.json', { code: error.code || error.name }); }
            if (listener) { listener.closeAllConnections?.(); await new Promise(resolve => listener.close(resolve)); }
            await composition?.close(); await db.terminate(); globalThis.fetch = originalFetch;
            write('closed.json', { closed: true, retainedDemoProject: c.projectId, failure });
        })(); return closing;
    }
    process.once('SIGTERM', () => { void close(); }); process.once('SIGINT', () => { void close(); });
    try {
        check((await db.listCollections()).length === 0, 'Run demo project already contains records.');
        check((await auth.listUsers(1)).users.length === 0, 'Run demo Auth project already exists.');
        await auth.createUser({ uid, email: c.email, password: c.password, emailVerified: true });
        await db.collection('users').doc(uid).create({ isAdmin: true, role: 'admin', email: c.email, displayName: 'Native acceptance staff' });
        await db.collection('crmProjectAllowanceConfigs').doc(uid).create({ currency: 'USD', monthlyAllowanceCents: 500 });
        if (c.scenario === 'edit') await db.collection('crmLeads').doc(seedId).create({ name: fixtureName, source: 'website', stage: 'new', notes: 'Before native edit', createdBy: uid });
        if (['image-payment', 'image-ambiguous-date'].includes(c.scenario)) {
            await db.collection('crmStudents').doc(studentId).create({ name: fixtureName, status: 'active' });
            await db.collection('crmInvoices').doc(invoiceId).create({ studentId, amount: 10.25, netAmount: 10.25, currency: 'USD', paidAmount: 0, outstandingAmount: 10.25, status: 'open' });
        }
        const rulesResponse = await originalFetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${c.projectId}:securityRules`, {
            method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content: fs.readFileSync(path.join(c.repo, 'firestore.rules'), 'utf8') }] } }) });
        check(rulesResponse.ok, 'Demo rules configuration failed.');
        composition = await composeVoice({ config: { projectId: c.projectId, nativeEnabled: true }, nativeCredentials: { apiKey: c.apiKey } });
        const nativeFactory = composition.providerFactory;
        const providerFactory = async options => {
            if (failure || liveCalls >= (imageScenarios.has(c.scenario) ? 0 : c.scenario === 'discard-reconnect' ? 1 : 2)) { failOnce('LIVE_CALL_FENCE'); throw Error('No further Live connections allowed.'); }
            liveCalls++;
            return nativeFactory({ ...options, onError: error => { failOnce(error.code || 'LIVE_FAILED'); return options.onError(error); } });
        }; providerFactory.native = true;
        const base = `http://127.0.0.1:${c.port}`;
        relay = createRelayServer({ ...composition, providerFactory, engineeringMode: false, allowedOrigins: [base],
            onDiagnostic: item => { diagnostics.push(safe(item)); write('relay-diagnostics.json', diagnostics); } });
        await new Promise((resolve, reject) => { relay.server.once('error', reject); relay.server.listen(0, '127.0.0.1', resolve); });
        const relayUrl = `http://127.0.0.1:${relay.server.address().port}`;
        // Exercise the normal lazy HTTP builder. Only server-owned environment
        // and transport instrumentation are injected; no complete config override.
        const dataInputNativeConfigOptions = {
            env: { ...process.env, CRM_VOICE_NATIVE_ENABLED: 'true', CRM_VOICE_RELAY_URL: relayUrl },
            createNative(options) {
                check(options.apiKey === c.apiKey, 'HTTP and relay scoped credentials differ.');
                const native = createDataInputNativeServices(options);
                return { ...native, async generationTransport(input) {
                    const image = input.request.descriptor?.image;
                    descriptors.push({ descriptorDigest: input.request.descriptorDigest, image: image ? { attachmentId: image.attachmentId,
                        sha256: image.sha256, width: image.width, height: image.height, bytesLength: image.bytesLength,
                        actualBytesDigest: crypto.createHash('sha256').update(Buffer.from(image.inlineData.data, 'base64')).digest('hex') } : null });
                    write('descriptors.json', descriptors);
                    return native.generationTransport(input);
                } };
            }
        };
        const routerPath = require.resolve(path.join(c.repo, 'functions/src/routes/admin/create-crm-router'));
        const createRouter = require(routerPath);
        require.cache[routerPath].exports = deps => createRouter({ ...deps, dataInputProvider: null, dataInputEnabled: true, dataInputNativeConfigOptions,
            ...createStorageDependencies(c.projectId) });
        const api = require(path.join(c.repo, 'functions/src/apiApp'));
        const app = express(), firebaseConfig = { apiKey: 'local-only', projectId: c.projectId, authDomain: 'localhost', storageBucket: `${c.projectId}.appspot.com`, appId: 'native-local-browser' };
        const authUrl = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, [firestoreHost, firestorePort] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
        const bootstrap = `firebase.initializeApp(${JSON.stringify(firebaseConfig)});firebase.auth().useEmulator(${JSON.stringify(authUrl)},{disableWarnings:true});firebase.firestore().useEmulator(${JSON.stringify(firestoreHost)},${Number(firestorePort)});`;
        app.get('/api/config', (_req, res) => res.json({ success: true, config: firebaseConfig }));
        app.get('/__native/login', (_req, res) => res.type('html').send(`<!doctype html><form><label>Email<input id="email"></label><label>Password<input id="password" type="password"></label><button>Sign in locally</button></form><p role="status"></p><script src="https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js"></script><script src="https://www.gstatic.com/firebasejs/9.22.0/firebase-auth-compat.js"></script><script>firebase.initializeApp(${JSON.stringify(firebaseConfig)});firebase.auth().useEmulator(${JSON.stringify(authUrl)},{disableWarnings:true});document.querySelector('form').onsubmit=async e=>{e.preventDefault();try{await firebase.auth().signInWithEmailAndPassword(document.querySelector('#email').value,document.querySelector('#password').value);location.href='/crm-admin.html';}catch(e){document.querySelector('[role=status]').textContent=e.code;}};</script>`));
        app.get('/crm-admin.html', (_req, res) => {
            let html = fs.readFileSync(path.join(c.repo, 'public/crm-admin.html'), 'utf8');
            html = html.replace("connect-src 'self'", `connect-src 'self' ${authUrl} http://${process.env.FIRESTORE_EMULATOR_HOST} ws://${process.env.FIRESTORE_EMULATOR_HOST} ${relayUrl} ${relayUrl.replace('http:', 'ws:')}`);
            html = html.replace('  <script src="js/auth-session-guard.js', `  <script>${bootstrap}</script>\n  <script src="js/auth-session-guard.js`); res.type('html').send(html);
        });
        app.use('/__native', (req, res, next) => req.headers['x-native-control'] === c.control ? next() : res.sendStatus(403));
        app.get('/__native/status', (_req, res) => res.json({ failure, flashCalls, liveCalls }));
        app.get('/__native/evidence', async (_req, res) => { try { res.json(await evidence()); } catch (_) { res.sendStatus(500); } });
        app.post('/__native/expect-error', express.json({ limit: '2kb' }), async (req, res) => {
            try {
                check(typeof req.body?.draftId === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(req.body.draftId), 'Invalid draft.');
                const snapshot = await db.collection('crmDataInputDrafts').doc(req.body.draftId).get(), draft = snapshot.data();
                check(draft?.actorUid === uid && draft.revision === req.body.revision, 'Expected-error draft changed.');
                if (c.scenario === 'image-payment') check(draft.status === 'review' && draft.preview?.previewId === req.body.previewId, 'Expected current review.');
                else check(c.scenario === 'image-ambiguous-date' && draft.status === 'draft' && draft.interpretationQuestions?.length, 'Expected unresolved date.');
                res.json(expectedErrors.arm(req.body));
            } catch (_) { failOnce('EXPECTED_ERROR_ARM_FAILED'); res.sendStatus(409); }
        });
        app.post('/__native/close', (_req, res) => { res.json({ closing: true }); setImmediate(() => { void close(); }); });
        app.use('/api/admin/data-input', (req, res, next) => {
            let responseBody; const json = res.json;
            res.json = function (body) { responseBody = body; return json.call(this, body); };
            res.on('finish', () => {
                if (res.statusCode >= 400 && !expectedErrors.observe({ method: req.method, path: req.originalUrl,
                    status: res.statusCode, body: req.body, response: responseBody })) failOnce(`DATA_INPUT_HTTP_${res.statusCode}`);
            }); next();
        });
        app.use(api); app.use(express.static(path.join(c.repo, 'public')));
        listener = await new Promise((resolve, reject) => { const server = app.listen(c.port, '127.0.0.1', () => resolve(server)); server.once('error', reject); });
        write('ready.json', { base, relayUrl, uid, seedId, studentId, invoiceId, fixtureName, projectId: c.projectId, runId: c.runId, sourceSha: c.sha, httpConfiguration: 'default-native-builder' });
    } catch (error) { failOnce(error.code || error.name); write('startup-error.json', { message: cleanText(error.message) }); await close(); process.exitCode = 1; }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { configuration, createEvidenceRedactor, validateEmulatorHosts, createStorageDependencies };
