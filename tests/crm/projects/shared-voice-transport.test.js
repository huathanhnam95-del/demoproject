'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { once } = require('node:events');
const path = require('node:path');
const { WebSocket } = require('../../../services/crm-voice-relay/node_modules/ws');
const { createRelayServer } = require('../../../services/crm-voice-relay/server');
const { parseProviderMessage, parseGeminiMessage } = require('../../../services/crm-voice-relay/provider-parser');
const ORIGIN = 'http://127.0.0.1:45555';
async function fixture(extra = {}) {
    const calls = [], audioFrames = [], diagnostics = [], sessions = new Map(); let counter = 0, callback, lastAudio;
    const sessionService = {
        async prepare({ actorUid, feature }) { const sessionId = `session-${++counter}`; const row = { sessionId, actorUid, feature, ticket: `ticket-${counter}`, epoch: 0, contextRevision: 0, state: 'prepared', engineeringOnly: true }; sessions.set(sessionId, row); return { ...row }; },
        async claim({ actorUid, feature, sessionId, ticket }) { const row = sessions.get(sessionId); if (!row || row.actorUid !== actorUid || row.feature !== feature || row.ticket !== ticket || row.state !== 'prepared') throw new Error('claim denied'); row.state = 'connected'; row.epoch++; row.ticket = null; calls.push('claim'); return { ...row }; },
        async readStatus({ actorUid, feature, sessionId }) { const row = sessions.get(sessionId); if (!row || row.actorUid !== actorUid || row.feature !== feature) throw new Error('scope denied'); return { ...row }; },
        async updateContext(scope) { const row = sessions.get(scope.sessionId); row.contextRevision = (row.contextRevision || 0) + 1; calls.push('context'); return { ...row, summary: 'server summary' }; },
        async close(scope) { const row = sessions.get(scope.sessionId); if (row.epoch === scope.epoch) row.state = 'closed'; calls.push('session-close'); },
        providerChannel() { return { async getContext() { return { summary: 'server summary', context: { serverOnly: true } }; }, async beginUtterance(event) { calls.push({ begin: event }); }, async finalizeUtterance(event) { calls.push({ final: event }); return extra.finalizeUtterance?.(event); } }; }
    };
    const ledger = { forFeature() { return { async reserve() { calls.push('reserve'); return { reservationId: 'reservation' }; }, async authorizeDispatch() { calls.push('permit'); return extra.noPermit ? { sendPermit: null } : { sendPermit: extra.nativeProvider ? { provider: 'gemini', model: 'gemini-3.1-flash-live-preview', engineeringOnly: false } : { provider: 'engineering-provider', model: 'engineering-model', engineeringOnly: true } }; } }; }, async markUnknown() { calls.push('unknown'); if (extra.hangUnknown) await new Promise(() => {}); }, async settle(_id, evidence) { if (!evidence.complete || !evidence.quantities) throw new Error('incomplete'); calls.push('settle'); } };
    const providerFactory = Object.assign(async options => { calls.push('provider-io'); callback = options.onMessage; if (extra.providerGate) await extra.providerGate; if (extra.connectProvider) return extra.connectProvider(options); return { processMessage: extra.processMessage || (async value => value), async sendAudio(value) { calls.push('audio'); lastAudio = value; audioFrames.push(value); }, endInput: extra.noEndInput ? undefined : async () => { calls.push('end'); await extra.endGate; }, async interrupt() { calls.push('interrupt'); extra.onInterrupt?.(); }, async close() { calls.push('provider-close'); }, async updateContext() { calls.push('provider-context'); } }; }, extra.nativeProvider ? { native: true } : { engineeringOnly: true });
    const relay = createRelayServer({ sessionService: extra.sessionService || sessionService, authenticate: async token => { if (token !== 'valid-token') throw new Error('denied'); return { uid: 'staff' }; }, allowedOrigins: [ORIGIN], ledger,
        onDiagnostic: value => diagnostics.push(value), nativeMode: extra.nativeProvider === true, engineeringMode: extra.native !== true && !extra.nativeProvider, providerFactory, features: extra.nativeProvider ? { projects: { model: 'gemini-3.1-flash-live-preview', provider: 'gemini', engineeringOnly: false, admission: async () => ({ purpose: 'planning', context: {}, model: 'gemini-3.1-flash-live-preview', request: {}, boundsVersion: 'native' }) } } : { projects: { model: 'engineering-model', provider: 'engineering-provider', engineeringOnly: true, admission: async () => ({ purpose: 'planning', context: {}, model: 'engineering-model', request: {}, boundsVersion: 'bounded' }) } }, limits: extra.limits || {} });
    await new Promise(resolve => relay.server.listen(0, '127.0.0.1', resolve)); const base = `http://127.0.0.1:${relay.server.address().port}`;
    const prepare = async (origin = ORIGIN, token = 'valid-token') => fetch(`${base}/prepare`, { method: 'POST', headers: { Origin: origin, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ feature: 'projects', requestId: `request-${++counter}`, contextHints: {} }) });
    return { ...relay, base, calls, audioFrames, diagnostics, sessionService, sessions, prepare, emit: value => callback(value), audio: () => lastAudio,
        async connect(prepared = null, overrides = {}) { const ticket = prepared || await (await prepare()).json(); const ws = new WebSocket(base.replace('http:', 'ws:') + '/voice', { origin: ORIGIN }); await once(ws, 'open'); const response = once(ws, 'message'); ws.send(JSON.stringify({ type: 'authenticate', feature: 'projects', idToken: 'valid-token', sessionId: ticket.sessionId, ticket: ticket.ticket, ...overrides })); const [data] = await response; return { ws, event: JSON.parse(data), ticket }; } };
}
async function until(condition) { for (let n = 0; n < 100; n++) { if (condition()) return; await new Promise(resolve => setTimeout(resolve, 10)); } assert.fail('condition did not become true'); }
test('HTTP origins and native preparation fail closed before any provider call', async () => {
    const f = await fixture({ native: true }); try { assert.equal((await f.prepare()).status, 409); assert.equal((await f.prepare('https://untrusted.example')).status, 403); assert.equal((await f.prepare(ORIGIN, 'bad-token')).status, 400); assert.deepEqual(f.calls, []);
        const options = await fetch(`${f.base}/prepare`, { method: 'OPTIONS', headers: { Origin: ORIGIN } }); assert.equal(options.status, 204); assert.equal(options.headers.get('access-control-allow-origin'), ORIGIN);
    } finally { await f.close(); }
});
test('actual socket consumes one ticket and orders reservation and permit before provider I/O', async () => {
    const f = await fixture(); try { const prepared = await (await f.prepare()).json(); const first = await f.connect(prepared); assert.equal(first.event.type, 'ready'); assert.deepEqual(f.calls.slice(0, 4), ['claim', 'reserve', 'permit', 'provider-io']);
        const second = await f.connect(prepared); assert.equal(second.event.type, 'error'); assert.equal(f.calls.filter(value => value === 'provider-io').length, 1); second.ws.terminate(); first.ws.close(); await until(() => f.calls.includes('unknown')); assert.equal(f.calls.filter(value => value === 'provider-close').length, 1);
    } finally { await f.close(); }
});
test('no dispatch permission means zero provider I/O', async () => {
    const f = await fixture({ noPermit: true }); try { const connection = await f.connect(); assert.equal(connection.event.type, 'error'); assert.equal(f.calls.includes('provider-io'), false); connection.ws.terminate(); } finally { await f.close(); }
});
test('hung accounting cleanup cannot delay stopping the provider or closing the session', async () => {
    const f = await fixture({ hangUnknown: true }); try { const connection = await f.connect(); connection.ws.close(); await until(() => f.calls.includes('unknown'));
        await until(() => f.calls.includes('provider-close') && f.calls.includes('session-close')); assert.equal(f.calls.filter(value => value === 'provider-close').length, 1);
    } finally { await f.close(); }
});
test('actual socket denies wrong actor credential, binary frames, unknown client authority and oversize messages', async () => {
    for (const send of [ws => ws.send(Buffer.from([1, 2])), ws => ws.send(JSON.stringify({ type: 'confirm', confirmationToken: 'untrusted' })), ws => ws.send('x'.repeat(65537))]) {
        const f = await fixture(); try { const connection = await f.connect(); const closed = once(connection.ws, 'close'); connection.ws.on('error', () => {}); send(connection.ws); await closed; await until(() => f.calls.includes('unknown')); } finally { await f.close(); }
    }
    const f = await fixture(); try { const connection = await f.connect(null, { idToken: 'bad-token' }); assert.equal(connection.event.type, 'error'); assert.equal(f.calls.includes('provider-io'), false); connection.ws.terminate(); } finally { await f.close(); }
});
test('unauthenticated timeout and exact websocket origin are enforced on real sockets', async () => {
    const f = await fixture({ limits: { authTimeoutMs: 40 } }); try {
        const ws = new WebSocket(f.base.replace('http:', 'ws:') + '/voice', { origin: ORIGIN }); await once(ws, 'open'); await once(ws, 'close'); assert.equal(f.calls.length, 0);
        const denied = new WebSocket(f.base.replace('http:', 'ws:') + '/voice', { origin: 'https://untrusted.example' }); const [response] = await new Promise(resolve => { denied.on('unexpected-response', (_req, res) => { res.resume(); denied.terminate(); resolve([res]); }); denied.on('error', () => {}); }); assert.equal(response.statusCode, 403);
    } finally { await f.close(); }
});
test('server capture provenance and user transcript remain distinct from assistant output; stale epoch stops input', async () => {
    const f = await fixture(); try { const connection = await f.connect(); const events = []; connection.ws.on('message', bytes => events.push(JSON.parse(bytes)));
        connection.ws.send(JSON.stringify({ type: 'audio', data: Buffer.alloc(640).toString('base64') })); await until(() => !!f.audio());
        f.emit({ assistant: { parts: [{ text: 'assistant one' }, { text: 'assistant two', audio: { data: Buffer.alloc(4).toString('base64'), sampleRate: 24000 } }] }, userTranscription: { utteranceId: f.audio().utteranceId, eventId: 'final', text: 'user words', final: true } });
        await until(() => events.some(value => value.type === 'transcript')); assert.equal(events.filter(value => value.type === 'assistant_text').length, 2); assert.equal(events.find(value => value.type === 'transcript').text, 'user words');
        const finalized = f.calls.find(value => value.final)?.final; assert.equal(finalized.audioEvidence.durationMs, 20); assert.match(finalized.audioEvidence.audioDigest, /^[a-f0-9]{64}$/);
        f.sessions.get(connection.ticket.sessionId).epoch++; const closed = once(connection.ws, 'close'); connection.ws.send(JSON.stringify({ type: 'audio', data: Buffer.alloc(640).toString('base64') })); await closed; assert.equal(f.calls.filter(value => value === 'audio').length, 1);
    } finally { await f.close(); }
});
test('unknown usage never releases the accounting obligation', async () => {
    const f = await fixture(); try { const connection = await f.connect(); const closed = once(connection.ws, 'close'); f.emit({ usage: { evidenceId: 'bad', providerRequestId: 'p', complete: false } }); await closed; await until(() => f.calls.includes('unknown')); assert.equal(f.calls.includes('settle'), false); } finally { await f.close(); }
});
test('audio totals are bounded and interrupt/context stay on the reauthorized server path', async () => {
    const f = await fixture({ limits: { audioBytes: 640 } }); try { const connection = await f.connect();
        connection.ws.send(JSON.stringify({ type: 'interrupt' })); connection.ws.send(JSON.stringify({ type: 'context', contextHints: { draft: 'hint-only' } }));
        await until(() => f.calls.includes('provider-context')); assert.ok(f.calls.includes('interrupt')); assert.ok(f.calls.includes('context'));
        connection.ws.send(JSON.stringify({ type: 'audio', data: Buffer.alloc(640).toString('base64') })); await until(() => !!f.audio());
        const closed = once(connection.ws, 'close'); connection.ws.send(JSON.stringify({ type: 'audio', data: Buffer.alloc(2).toString('base64') })); await closed;
        assert.equal(f.calls.filter(value => value === 'audio').length, 1); await until(() => f.calls.includes('unknown'));
    } finally { await f.close(); }
});
test('relay composes strict real session core and captures provider utterance through its server channel', async () => {
    const { createVoiceSessionService } = require('../../../functions/src/ai-assistance/voice/session-service');
    const records = new Map(); const db = { collection: name => ({ doc: id => ({ path: `${name}/${id}` }) }) }; let chain = Promise.resolve();
    const runTransaction = work => { const task = chain.then(async () => { const next = new Map(records); let writing = false; const tx = { async get(ref) { assert.equal(writing, false); return { exists: next.has(ref.path), data: () => structuredClone(next.get(ref.path)) }; }, create(ref, value) { assert.equal(next.has(ref.path), false); writing = true; next.set(ref.path, structuredClone(value)); }, set(ref, value) { writing = true; next.set(ref.path, structuredClone(value)); } }; const result = await work(tx); records.clear(); for (const entry of next) records.set(...entry); return result; }); chain = task.catch(() => {}); return task; };
    let changed = false;
    const sessionService = createVoiceSessionService({ db, runTransaction, engineeringMode: true, featureAdapters: { projects: { authorize: async ({ actorUid }) => actorUid === 'staff', resolveContext: async () => ({ summary: changed ? 'New unseen context' : 'Current server context', previewBinding: null }), confirm: async () => false } } });
    const f = await fixture({ sessionService }); try { const connection = await f.connect(); assert.equal(connection.event.type, 'ready'); const events = []; connection.ws.on('message', bytes => events.push(JSON.parse(bytes)));
        connection.ws.send(JSON.stringify({ type: 'audio', data: Buffer.alloc(640).toString('base64') })); await until(() => !!f.audio()); f.emit({ userTranscription: { utteranceId: f.audio().utteranceId, eventId: 'real-final', text: 'User input', final: true } }); await until(() => events.some(value => value.type === 'transcript'));
        assert.ok([...records.values()].some(row => row.state === 'final' && row.text === 'User input')); assert.equal([...records.values()].some(row => row.attestationId), false);
        const closed = once(connection.ws, 'close'); f.emit({ usage: { evidenceId: 'final', providerRequestId: 'provider', complete: true, quantities: { inputAudio: '1' } } }); await closed; await until(() => f.calls.includes('provider-close')); assert.equal(f.calls.includes('settle'), true); assert.equal(f.calls.includes('unknown'), false);
        const next = await f.connect(); assert.equal(next.event.type, 'ready'); const nextEvents = []; next.ws.on('message', data => nextEvents.push(JSON.parse(data))); changed = true;
        const externalStatus = await sessionService.readStatus({ actorUid: 'staff', feature: 'projects', sessionId: next.ticket.sessionId }); assert.equal(externalStatus.contextChanged, true);
        assert.equal((await sessionService.readStatus({ actorUid: 'staff', feature: 'projects', sessionId: next.ticket.sessionId })).contextChanged, false);
        const nextClosed = once(next.ws, 'close'); next.ws.send(JSON.stringify({ type: 'audio', data: Buffer.alloc(640).toString('base64') })); await nextClosed;
        assert.equal(f.calls.filter(value => value === 'audio').length, 1); assert.ok(nextEvents.some(value => value.type === 'context' && value.summary === 'New unseen context'));
        assert.equal([...records.values()].filter(row => row.state === 'started').length, 0);
    } finally { await f.close(); }
});
test('native Gemini transcription stays nonfinal and all assistant parts are preserved', () => {
    const events = parseGeminiMessage({ serverContent: { inputTranscription: { text: 'not proven final' }, outputTranscription: { text: 'assistant transcript' }, modelTurn: { role: 'model', parts: [{ text: 'one' }, { text: 'two', inlineData: { mimeType: 'audio/pcm;rate=24000', data: Buffer.alloc(4).toString('base64') } }] }, turnComplete: true, generationComplete: true, interrupted: true }, usageMetadata: { unknownCategory: 1 } });
    assert.equal(events.find(event => event.type === 'transcript').final, false); assert.equal(events.find(event => event.type === 'transcript').attestable, false); assert.equal(events.filter(event => event.type === 'assistant_text').length, 3); assert.ok(events.some(event => event.type === 'usage_unknown'));
    assert.throws(() => parseGeminiMessage({ serverContent: { inputTranscription: { text: 'fake', final: true } } })); assert.throws(() => parseProviderMessage({ userTranscription: { utteranceId: 'u', eventId: 'e', text: 'assistant', final: true, source: 'user_audio' } }));
});
test('browser prepare fences identity before microphone/connect and native rejection produces no socket', async () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../public/js/crm/ai-assistance/voice-transport.js'), 'utf8'); let uid = 'staff', sockets = 0, resolveToken;
    const context = { URL, crypto: { randomUUID: () => 'request' }, location: { href: ORIGIN }, setInterval, clearInterval, setTimeout, clearTimeout, fetch: async () => ({ ok: false, text: async () => JSON.stringify({ error: 'PAID_DISPATCH_DISABLED' }) }), WebSocket: class { constructor() { sockets++; } } }; vm.runInNewContext(source, context);
    const t = context.CrmAiVoiceTransport.createTransport({ getUid: () => uid, getIdToken: async () => 'token', baseUrl: ORIGIN }); await assert.rejects(() => t.prepare({ actorUid: 'staff', feature: 'projects' }), /not available yet/); assert.equal(sockets, 0);
    const changed = context.CrmAiVoiceTransport.createTransport({ getUid: () => uid, getIdToken: () => new Promise(resolve => { resolveToken = resolve; }), baseUrl: ORIGIN }); const pending = changed.prepare({ actorUid: 'staff', feature: 'projects' }); await until(() => !!resolveToken); uid = 'other'; resolveToken('token'); await assert.rejects(() => pending, /identity/); assert.equal(sockets, 0);
});
test('concurrent browser preparations admit only the latest attempt without orphan timers or sockets', async () => {
    let fetches = 0, sockets = 0; const timers = new Set();
    const context = { URL, crypto: { randomUUID: () => 'request' }, location: { href: ORIGIN }, setTimeout, clearTimeout,
        setInterval(fn, duration) { const timer = setInterval(fn, duration); timers.add(timer); return timer; }, clearInterval(timer) { timers.delete(timer); clearInterval(timer); },
        fetch: async () => { fetches++; return { ok: true, text: async () => JSON.stringify({ sessionId: 's', ticket: 'one-use', engineeringOnly: true }) }; }, WebSocket: class { constructor() { sockets++; } }
    };
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../../public/js/crm/ai-assistance/voice-transport.js'), 'utf8'), context);
    const transport = context.CrmAiVoiceTransport.createTransport({ getUid: () => 'staff', getIdToken: async () => 'token', baseUrl: ORIGIN });
    try {
        const results = await Promise.allSettled([transport.prepare({ actorUid: 'staff', feature: 'projects' }), transport.prepare({ actorUid: 'staff', feature: 'projects' })]);
        assert.equal(results[0].status, 'rejected'); assert.equal(results[1].status, 'fulfilled'); assert.equal(fetches, 1); assert.equal(timers.size, 1); assert.equal(sockets, 0);
        await transport.close(); assert.equal(timers.size, 0);
    } finally { await transport.close(); for (const timer of timers) clearInterval(timer); }
});
test('browser active close stops microphone, capture, queued playback and audio context without reconnect', async () => {
    let stopped = 0, disconnected = 0, audioClosed = 0, sockets = 0, playbackStopped = 0, playbackStarted = 0, worklet, socket, releaseModule;
    class Socket {
        constructor() { sockets++; socket = this; this.readyState = 1; this.bufferedAmount = 0; setTimeout(() => this.onopen(), 0); }
        send(raw) { const value = JSON.parse(raw); if (value.type === 'authenticate') setTimeout(() => this.onmessage({ data: JSON.stringify({ type: 'ready', sessionId: 's', epoch: 1 }) }), 0); }
        close() { this.readyState = 3; this.onclose?.(); }
    }
    class Audio {
        constructor() { this.currentTime = 0; this.destination = {}; this.audioWorklet = { addModule: () => new Promise(resolve => { releaseModule = resolve; }) }; }
        async resume() {} async close() { audioClosed++; }
        createMediaStreamSource() { return { connect() {}, disconnect() { disconnected++; } }; }
        createGain() { return { gain: {}, connect() {}, disconnect() { disconnected++; } }; }
        createBuffer(_channels, count, rate) { return { duration: count / rate, getChannelData: () => new Float32Array(count) }; }
        createBufferSource() { return { connect() {}, start() { playbackStarted++; }, stop() { playbackStopped++; }, disconnect() { disconnected++; } }; }
    }
    class Worklet { constructor() { this.port = {}; worklet = this; } connect() {} disconnect() { disconnected++; } }
    const context = { URL, atob: value => Buffer.from(value, 'base64').toString('binary'), crypto: { randomUUID: () => 'request' }, location: { href: ORIGIN }, setInterval, clearInterval, setTimeout, clearTimeout, fetch: async () => ({ ok: true, text: async () => JSON.stringify({ sessionId: 's', ticket: 'one-use', engineeringOnly: true }) }), WebSocket: Socket, AudioContext: Audio, AudioWorkletNode: Worklet };
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../../public/js/crm/ai-assistance/voice-transport.js'), 'utf8'), context);
    const transport = context.CrmAiVoiceTransport.createTransport({ getUid: () => 'staff', getIdToken: async () => 'token', baseUrl: ORIGIN }); const handle = await transport.prepare({ actorUid: 'staff', feature: 'projects' });
    const events = []; const connecting = handle.connect({ stream: { getTracks: () => [{ stop() { stopped++; } }] }, onEvent: event => events.push(event) });
    const audioEvent = { data: JSON.stringify({ type: 'assistant_audio', data: Buffer.alloc(480).toString('base64'), sampleRate: 24000 }) };
    await until(() => !!releaseModule); socket.onmessage(audioEvent); assert.equal(playbackStarted, 0); releaseModule(); await connecting;
    assert.equal(playbackStarted, 1); assert.equal(sockets, 1); assert.equal(typeof worklet.port.onmessage, 'function');
    handle.interrupt(); assert.equal(playbackStopped, 1); socket.onmessage(audioEvent); assert.equal(playbackStarted, 1); socket.onerror();
    await handle.close(); await handle.close(); assert.equal(stopped, 1); assert.equal(audioClosed, 1); assert.equal(playbackStopped, 1); assert.equal(disconnected, 4); assert.equal(worklet.port.onmessage, null); await assert.rejects(() => handle.connect({}), /cannot be replayed/); assert.equal(sockets, 1);
    assert.equal(events.filter(event => event.type === 'disconnected').length, 1);
});
test('worklet streams exact 16k PCM chunks across source quanta', () => {
    let Capture; const chunks = [];
    const context = { sampleRate: 48000, AudioWorkletProcessor: class { constructor() { this.port = { postMessage: value => chunks.push(new Int16Array(value)) }; } }, registerProcessor: (_name, type) => { Capture = type; } };
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../../public/js/crm/ai-assistance/voice-audio-worklet.js'), 'utf8'), context); const capture = new Capture();
    for (let n = 0; n < 15; n++) capture.process([[new Float32Array(128).fill(1)]]);
    assert.equal(chunks.length, 2); assert.equal(chunks[0].length, 320); assert.ok(chunks.every(chunk => [...chunk].every(value => value === 32767)));
});
async function capturePackingFixture(options = {}) {
    const frames = [], events = [], workletRequests = []; let socket, worklet, actorUid = 'staff', stopped = 0, audioClosed = 0, playbackStarted = 0, playbackStopped = 0;
    class Socket {
        constructor() { socket = this; this.readyState = 1; this.bufferedAmount = 0; setTimeout(() => this.onopen(), 0); }
        send(raw) { const frame = JSON.parse(raw); if (frame.type === 'authenticate') setTimeout(() => this.onmessage({ data: JSON.stringify({ type: 'ready', sessionId: 's', epoch: 1 }) }), 0); else frames.push(frame); }
        close() { this.readyState = 3; this.onclose?.(); }
    }
    class Audio {
        constructor() { this.currentTime = 0; this.destination = {}; this.audioWorklet = { addModule: async () => options.beforeAudioReady?.({ handle, emit: value => socket.onmessage({ data: JSON.stringify(value) }) }) }; }
        async resume() {} async close() { audioClosed++; }
        createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
        createGain() { return { gain: {}, connect() {}, disconnect() {} }; }
        createBuffer(_channels, length, rate) { return { duration: length / rate, getChannelData: () => new Float32Array(length) }; }
        createBufferSource() { return { connect() {}, disconnect() {}, stop() { playbackStopped++; }, start() { playbackStarted++; } }; }
    }
    class Worklet { constructor() { this.port = { postMessage: value => workletRequests.push(value) }; worklet = this; } connect() {} disconnect() {} }
    const context = { URL, btoa: value => Buffer.from(value, 'binary').toString('base64'), atob: value => Buffer.from(value, 'base64').toString('binary'), crypto: { randomUUID: () => 'request' }, location: { href: ORIGIN }, setInterval, clearInterval, setTimeout, clearTimeout,
        fetch: async () => ({ ok: true, text: async () => JSON.stringify({ sessionId: 's', ticket: 'ticket', engineeringOnly: true }) }), WebSocket: Socket, AudioContext: Audio, AudioWorkletNode: Worklet };
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../../public/js/crm/ai-assistance/voice-transport.js'), 'utf8'), context);
    const transport = context.CrmAiVoiceTransport.createTransport({ getUid: () => actorUid, getIdToken: async () => 'token', getContext: async () => ({ projectId: 'p' }), baseUrl: ORIGIN });
    const abort = new AbortController(); const handle = await transport.prepare({ actorUid, feature: 'projects', signal: abort.signal });
    await handle.connect({ stream: { getTracks: () => [{ stop() { stopped++; } }] }, onEvent: event => { events.push(event); options.onEvent?.(event); } });
    return { frames, events, socket, workletRequests, audioClosed: () => audioClosed, playbackStarted: () => playbackStarted, playbackStopped: () => playbackStopped, emit: value => socket.onmessage({ data: JSON.stringify(value) }), handle, abort, transport, worklet, stopped: () => stopped, changeIdentity: () => { actorUid = 'other'; }, chunk(values) { worklet.port.onmessage({ data: values.buffer }); } };
}
test('capture packs exactly five ordered worklet chunks per 100ms frame and flushes before explicit controls', async () => {
    const f = await capturePackingFixture(); const sent = [];
    function chunk(index) { const values = Int16Array.from({ length: 320 }, (_, offset) => index * 320 + offset - 1600); sent.push(...values); f.chunk(values); }
    try {
        for (let index = 0; index < 4; index++) chunk(index); assert.equal(f.frames.length, 0);
        chunk(4); assert.equal(f.frames.length, 1); assert.equal(Buffer.from(f.frames[0].data, 'base64').length, 3200);
        for (let index = 5; index < 10; index++) chunk(index); assert.equal(f.frames.length, 2); assert.equal(Buffer.from(f.frames[1].data, 'base64').length, 3200);
        chunk(10); chunk(11); f.handle.interrupt(); assert.deepEqual(f.frames.slice(-2).map(frame => frame.type), ['audio', 'interrupt']); assert.equal(Buffer.from(f.frames.at(-2).data, 'base64').length, 1280);
        chunk(12); await f.handle.updateContext(); assert.deepEqual(f.frames.slice(-2).map(frame => frame.type), ['audio', 'context']); assert.equal(Buffer.from(f.frames.at(-2).data, 'base64').length, 640);
        const bytes = Buffer.concat(f.frames.filter(frame => frame.type === 'audio').map(frame => Buffer.from(frame.data, 'base64')));
        assert.deepEqual(Array.from({ length: bytes.length / 2 }, (_, index) => bytes.readInt16LE(index * 2)), sent, 'PCM samples must have no loss, duplication or reordering');
    } finally { await f.transport.close(); }
});
test('close, abort and identity retirement discard unsent capture partials', async () => {
    for (const mode of ['close', 'abort', 'identity']) {
        const f = await capturePackingFixture();
        try {
            const queuedHandler = f.worklet.port.onmessage;
            for (let index = 0; index < 4; index++) f.chunk(new Int16Array(320).fill(index)); assert.equal(f.frames.length, 0);
            if (mode === 'close') await f.handle.close(); else if (mode === 'abort') f.abort.abort(); else { f.changeIdentity(); await f.handle.syncIdentity(); }
            queuedHandler({ data: new Int16Array(320).fill(99).buffer });
            assert.equal(f.frames.length, 0, `${mode} must not flush stale microphone audio`); assert.equal(f.worklet.port.onmessage, null); assert.equal(f.stopped(), 1);
        } finally { await f.transport.close(); }
    }
});

function holdStatus(f) {
    const original = f.sessionService.readStatus.bind(f.sessionService); let release, entered = false, checks = 0;
    const gate = new Promise(resolve => { release = resolve; });
    f.sessionService.readStatus = async scope => { checks++; if (checks === 1) { entered = true; await gate; } return original(scope); };
    return { release, entered: () => entered, checks: () => checks };
}
const audioFrame = bytes => JSON.stringify({ type: 'audio', data: bytes.toString('base64') });
test('adjacent queued audio coalesces under a fresh batch check with every original byte/order and digest preserved', async () => {
    const f = await fixture(); try {
        const { ws } = await f.connect(); const held = holdStatus(f); const frames = Array.from({ length: 41 }, (_, n) => Buffer.alloc(640, n));
        ws.send(audioFrame(frames[0])); await until(held.entered); for (const frame of frames.slice(1)) ws.send(audioFrame(frame));
        await new Promise(resolve => setTimeout(resolve, 40)); held.release(); await until(() => f.audioFrames.length === frames.length);
        assert.equal(held.checks(), 2); assert.deepEqual(f.audioFrames.map(frame => frame.bytes), frames); assert.equal(new Set(f.audioFrames.map(frame => frame.utteranceId)).size, 1);
        const events = []; ws.on('message', bytes => events.push(JSON.parse(bytes)));
        f.emit({ userTranscription: { utteranceId: f.audio().utteranceId, eventId: 'batched-final', text: 'User', final: true } }); await until(() => events.some(event => event.type === 'transcript'));
        const final = f.calls.find(call => call.final).final; assert.equal(final.audioEvidence.audioDigest, require('node:crypto').createHash('sha256').update(Buffer.concat(frames)).digest('hex')); assert.equal(final.audioEvidence.durationMs, 820);
        ws.close(); await until(() => f.calls.includes('provider-close')); assert.equal(f.diagnostics.some(item => item.code === 'QUEUE_LIMIT'), false);
    } finally { await f.close(); }
});
test('queued audio checks current authority before batch and rejects revoked context without sending PCM', async () => {
    const f = await fixture(); try { const { ws, ticket } = await f.connect(); const held = holdStatus(f);
        ws.send(JSON.stringify({ type: 'interrupt' })); await until(held.entered); for (let i = 0; i < 40; i++) ws.send(audioFrame(Buffer.alloc(640)));
        await new Promise(resolve => setTimeout(resolve, 30)); f.sessions.get(ticket.sessionId).contextRevision++; const closed = once(ws, 'close'); held.release(); await closed;
        assert.equal(f.audioFrames.length, 0); assert.ok(f.diagnostics.some(item => item.code === 'CONTEXT_CHANGED'));
    } finally { await f.close(); }
});
test('provider final transcription seals queued audio and following frames start a separate utterance', async () => {
    const f = await fixture(); try { const { ws } = await f.connect(); ws.send(audioFrame(Buffer.alloc(640, 1))); await until(() => f.audioFrames.length === 1); const firstId = f.audio().utteranceId;
        const held = holdStatus(f); ws.send(JSON.stringify({ type: 'interrupt' })); await until(held.entered);
        ws.send(audioFrame(Buffer.alloc(640, 2))); ws.send(audioFrame(Buffer.alloc(640, 3))); await new Promise(resolve => setTimeout(resolve, 30));
        f.emit({ userTranscription: { utteranceId: firstId, eventId: 'boundary-final', text: 'first', final: true } });
        ws.send(audioFrame(Buffer.alloc(640, 4))); ws.send(audioFrame(Buffer.alloc(640, 5))); await new Promise(resolve => setTimeout(resolve, 30)); held.release();
        await until(() => f.audioFrames.length === 5); assert.deepEqual(f.audioFrames.map(frame => frame.bytes[0]), [1, 2, 3, 4, 5]);
        assert.ok(f.audioFrames.slice(0, 3).every(frame => frame.utteranceId === firstId)); assert.ok(f.audioFrames.slice(3).every(frame => frame.utteranceId !== firstId)); assert.equal(f.calls.find(call => call.final).final.audioEvidence.durationMs, 60);
        assert.equal(f.calls.filter(call => call.begin).length, 2);
    } finally { await f.close(); }
});
test('audio coalescing retains queue byte bounds and bounded batch frame size', async () => {
    const f = await fixture({ limits: { frameBytes: 2000, queueBytes: 5000 } }); let held;
    try { const { ws } = await f.connect(); held = holdStatus(f); ws.send(audioFrame(Buffer.alloc(640))); await until(held.entered);
        const closed = once(ws, 'close'); for (let i = 0; i < 8; i++) ws.send(audioFrame(Buffer.alloc(640))); await closed;
        assert.equal(f.audioFrames.length, 0); assert.ok(f.diagnostics.some(item => item.code === 'QUEUE_LIMIT')); held.release();
    } finally { held?.release(); await f.close(); }
    const g = await fixture({ limits: { frameBytes: 2000, queueBytes: 8000 } }); let gate;
    try { const { ws } = await g.connect(); gate = holdStatus(g); ws.send(audioFrame(Buffer.alloc(640))); await until(gate.entered);
        for (let i = 0; i < 6; i++) ws.send(audioFrame(Buffer.alloc(640))); await new Promise(resolve => setTimeout(resolve, 30)); gate.release(); await until(() => g.audioFrames.length === 7);
        assert.equal(gate.checks(), 4, 'six waiting frames split into three batches below 2000 serialized bytes');
        gate = holdStatus(g); ws.send(audioFrame(Buffer.alloc(640))); await until(gate.entered);
        for (let i = 0; i < 6; i++) ws.send(audioFrame(Buffer.alloc(640))); await new Promise(resolve => setTimeout(resolve, 30)); gate.release(); await until(() => g.audioFrames.length === 14);
        assert.equal(g.diagnostics.some(item => item.code === 'QUEUE_LIMIT'), false, 'completed merged jobs release every serialized byte before the next burst');
    } finally { gate?.release(); await g.close(); }
});

test('issued confirmation discards queued and later audio without authority or utterance work while session remains consumable', async () => {
    const f = await fixture(); let release;
    try {
        const originalChannel = f.sessionService.providerChannel.bind(f.sessionService); let finalizing = false;
        const finalGate = new Promise(resolve => { release = resolve; });
        f.sessionService.providerChannel = scope => ({ ...originalChannel(scope), async finalizeUtterance(event) { f.calls.push({ final: event }); finalizing = true; await finalGate; return { attestationId: 'issued-proof' }; } });
        const { ws, ticket } = await f.connect(); let statusChecks = 0; const readStatus = f.sessionService.readStatus.bind(f.sessionService);
        f.sessionService.readStatus = async scope => { statusChecks++; return readStatus(scope); };
        ws.send(audioFrame(Buffer.alloc(640, 1))); await until(() => f.audioFrames.length === 1);
        const events = []; ws.on('message', bytes => events.push(JSON.parse(bytes)));
        f.emit({ userTranscription: { utteranceId: f.audio().utteranceId, eventId: 'confirmed-final', text: 'I confirm these changes', final: true } }); await until(() => finalizing);
        for (let i = 0; i < 20; i++) ws.send(audioFrame(Buffer.alloc(640, 2))); await new Promise(resolve => setTimeout(resolve, 30));
        const before = statusChecks; release(); await until(() => events.some(event => event.type === 'confirmation_ready'));
        for (let i = 0; i < 20; i++) ws.send(audioFrame(Buffer.alloc(640, 3))); await new Promise(resolve => setTimeout(resolve, 40));
        assert.equal(statusChecks, before); assert.equal(f.audioFrames.length, 1); assert.equal(f.calls.filter(call => call.begin).length, 1);
        assert.equal(f.sessions.get(ticket.sessionId).state, 'connected'); assert.equal(ws.readyState, WebSocket.OPEN); assert.equal(f.calls.includes('session-close'), false);
        ws.send(JSON.stringify({ type: 'interrupt' })); await until(() => f.calls.includes('interrupt')); assert.equal(statusChecks, before + 1, 'non-audio controls retain current authority checks');
        ws.send(JSON.stringify({ type: 'end' })); await until(() => statusChecks === before + 2); assert.equal(f.calls.includes('end'), false, 'confirmation already terminated input');
    } finally { release?.(); await f.close(); }
});
test('ordinary final transcription permits the next audio utterance', async () => {
    const f = await fixture(); try { const { ws } = await f.connect(); ws.send(audioFrame(Buffer.alloc(640))); await until(() => f.audioFrames.length === 1); const first = f.audio().utteranceId;
        const events = []; ws.on('message', bytes => events.push(JSON.parse(bytes))); f.emit({ userTranscription: { utteranceId: first, eventId: 'ordinary-final', text: 'Planning words', final: true } }); await until(() => events.some(event => event.type === 'transcript'));
        ws.send(audioFrame(Buffer.alloc(640))); await until(() => f.audioFrames.length === 2); assert.notEqual(f.audio().utteranceId, first); assert.equal(events.some(event => event.type === 'confirmation_ready'), false);
    } finally { await f.close(); }
});

test('browser confirmation stops capture before event sink, drops partial PCM and keeps socket open without auto-resume', async () => {
    let f, stoppedAtEvent = 0;
    f = await capturePackingFixture({ onEvent(event) { if (event.type === 'confirmation_ready') stoppedAtEvent = f.stopped(); } });
    try {
        const delayedCapture = f.worklet.port.onmessage;
        for (let i = 0; i < 4; i++) f.chunk(new Int16Array(320).fill(i));
        f.emit({ type: 'confirmation_ready', attestationId: 'server-proof', sessionId: 's', epoch: 1 });
        assert.equal(stoppedAtEvent, 1); assert.equal(f.stopped(), 1); assert.equal(f.worklet.port.onmessage, null); assert.equal(f.socket.readyState, 1);
        delayedCapture({ data: new Int16Array(320).buffer }); f.handle.interrupt(); await f.handle.updateContext();
        assert.equal(f.frames.some(frame => frame.type === 'audio'), false); assert.equal(f.socket.readyState, 1); assert.equal(f.worklet.port.onmessage, null);
        assert.equal(f.events.filter(event => event.type === 'confirmation_ready').length, 1);
    } finally { await f.transport.close(); }
    const invalid = await capturePackingFixture();
    try { invalid.emit({ type: 'confirmation_ready', attestationId: 'forged', sessionId: 'wrong-session', epoch: 1 }); await until(() => invalid.socket.readyState === 3); assert.equal(invalid.stopped(), 1); assert.equal(invalid.events.some(event => event.type === 'confirmation_ready'), false); }
    finally { await invalid.transport.close(); }
});

test('worklet flush ends 48k/44.1k partial PCM exactly once without padding or later capture', () => {
    for (const sampleRate of [48000, 44100]) {
        let Capture; const messages = [];
        const context = { sampleRate, AudioWorkletProcessor: class { constructor() { this.port = { postMessage: value => messages.push(value) }; } }, registerProcessor: (_name, type) => { Capture = type; } };
        vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../../public/js/crm/ai-assistance/voice-audio-worklet.js'), 'utf8'), context);
        const capture = new Capture(); const count = 128 * 11;
        for (let n = 0; n < 11; n++) capture.process([[new Float32Array(128).fill(0.25)]]);
        capture.port.onmessage({ data: { type: 'flush-and-stop', requestId: 'flush-1' } });
        const ack = messages.at(-1); assert.equal(ack.type, 'flushed'); assert.equal(ack.requestId, 'flush-1');
        const samples = messages.flatMap(message => Array.from(new Int16Array(message.type === 'flushed' ? message.pcm : message)));
        assert.equal(samples.length, Math.ceil(count * 16000 / sampleRate)); assert.ok(samples.every(sample => sample === 8192));
        const before = messages.length; capture.port.onmessage({ data: { type: 'flush-and-stop', requestId: 'flush-1' } });
        assert.equal(capture.process([[new Float32Array(128).fill(1)]]), false); assert.equal(messages.length, before);
    }
});

test('browser end waits for worklet ACK, sends every partial sample before one end, and orders controls behind it', async () => {
    const f = await capturePackingFixture();
    try {
        const samples = [];
        for (let n = 0; n < 4; n++) { const values = Int16Array.from({ length: 320 }, (_, i) => n * 320 + i); samples.push(...values); f.chunk(values); }
        const ending = f.handle.endInput(); assert.equal(f.transport.endInput(), ending);
        const context = f.handle.updateContext(); const interrupt = f.handle.interrupt();
        await until(() => f.workletRequests.length === 1); assert.equal(f.frames.length, 0); assert.equal(f.stopped(), 0);
        // A full chunk posted before the worklet handles stop must precede ACK.
        const preceding = new Int16Array(320).fill(120); samples.push(...preceding); f.chunk(preceding);
        const partial = new Int16Array([21, -5, 37]); samples.push(...partial);
        f.worklet.port.onmessage({ data: { type: 'flushed', requestId: f.workletRequests[0].requestId, pcm: partial.buffer } });
        await Promise.all([ending, context, interrupt]);
        assert.equal(f.frames.filter(frame => frame.type === 'end').length, 1);
        const endAt = f.frames.findIndex(frame => frame.type === 'end');
        assert.ok(f.frames.slice(0, endAt).every(frame => frame.type === 'audio'));
        assert.ok(f.frames.slice(endAt + 1).every(frame => ['context', 'interrupt'].includes(frame.type)));
        const bytes = Buffer.concat(f.frames.filter(frame => frame.type === 'audio').map(frame => Buffer.from(frame.data, 'base64')));
        assert.deepEqual(Array.from({ length: bytes.length / 2 }, (_, i) => bytes.readInt16LE(i * 2)), samples);
        assert.equal(f.stopped(), 1); assert.equal(f.audioClosed(), 0); assert.equal(f.socket.readyState, 1);
        f.emit({ type: 'assistant_audio', sampleRate: 24000, data: Buffer.alloc(4).toString('base64') }); assert.equal(f.playbackStarted(), 0, 'the earlier mute remains in force after input flush');
        assert.equal(f.worklet.port.onmessage, null); await f.handle.endInput(); assert.equal(f.frames.filter(frame => frame.type === 'end').length, 1);
    } finally { await f.transport.close(); }
});

test('flush cancellation on close, abort, identity change or confirmation suppresses late PCM and end', async () => {
    for (const mode of ['close', 'abort', 'identity', 'confirmation']) {
        const f = await capturePackingFixture();
        try {
            f.chunk(new Int16Array(320).fill(1)); const ending = f.handle.endInput(); const rejection = assert.rejects(ending);
            await until(() => f.workletRequests.length === 1); const late = f.worklet.port.onmessage;
            if (mode === 'close') await f.handle.close();
            else if (mode === 'abort') f.abort.abort();
            else if (mode === 'identity') { f.changeIdentity(); await f.handle.syncIdentity(); }
            else f.emit({ type: 'confirmation_ready', attestationId: 'proof', sessionId: 's', epoch: 1 });
            late({ data: { type: 'flushed', requestId: f.workletRequests[0].requestId, pcm: new Int16Array([9]).buffer } });
            await rejection; assert.equal(f.frames.length, 0); assert.equal(f.stopped(), 1);
            if (mode === 'confirmation') { assert.equal(f.socket.readyState, 1); assert.equal(f.audioClosed(), 0); }
        } finally { await f.transport.close(); }
    }
});

test('missing or malformed worklet ACK fails closed without an end marker', async () => {
    for (const mode of ['timeout', 'wrong-id', 'oversize']) {
        const f = await capturePackingFixture();
        try {
            const ending = f.handle.endInput(); const rejection = assert.rejects(ending); await until(() => f.workletRequests.length === 1);
            if (mode !== 'timeout') f.worklet.port.onmessage({ data: { type: 'flushed', requestId: mode === 'wrong-id' ? 'wrong' : f.workletRequests[0].requestId, pcm: new Int16Array(mode === 'oversize' ? 321 : 0).buffer } });
            await rejection; assert.equal(f.socket.readyState, 3); assert.equal(f.frames.some(frame => frame.type === 'end'), false); assert.equal(f.stopped(), 1);
        } finally { await f.transport.close(); }
    }
});

test('server end is ordered after prior audio, idempotent, and fences queued/later audio without closing the session', async () => {
    let releaseEnd; const endGate = new Promise(resolve => { releaseEnd = resolve; }); const f = await fixture({ endGate }); let held;
    try {
        const { ws, ticket } = await f.connect(); held = holdStatus(f);
        ws.send(audioFrame(Buffer.alloc(640, 1))); await until(held.entered);
        ws.send(audioFrame(Buffer.alloc(20, 2))); ws.send(JSON.stringify({ type: 'end' }));
        ws.send(audioFrame(Buffer.alloc(640, 3))); await new Promise(resolve => setTimeout(resolve, 30)); held.release();
        await until(() => f.calls.includes('end')); assert.deepEqual(f.audioFrames.map(frame => frame.bytes[0]), [1, 2]);
        ws.send(audioFrame(Buffer.alloc(640, 4))); ws.send(JSON.stringify({ type: 'end' }));
        releaseEnd(); await until(() => held.checks() >= 4); const checks = held.checks();
        ws.send(audioFrame(Buffer.alloc(640, 5))); await new Promise(resolve => setTimeout(resolve, 30));
        assert.equal(held.checks(), checks); assert.equal(f.calls.filter(call => call === 'end').length, 1);
        assert.equal(f.calls.filter(call => call.begin).length, 1); assert.equal(f.audioFrames.length, 2);
        assert.equal(f.sessions.get(ticket.sessionId).state, 'connected'); assert.equal(ws.readyState, WebSocket.OPEN);
        const events = []; ws.on('message', bytes => events.push(JSON.parse(bytes)));
        f.emit({ userTranscription: { utteranceId: f.audio().utteranceId, eventId: 'after-end', text: 'ordinary user', final: true } });
        await until(() => events.some(event => event.type === 'transcript'));
        ws.send(audioFrame(Buffer.alloc(640, 6))); await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(f.audioFrames.length, 2);
    } finally { held?.release(); releaseEnd(); await f.close(); }
});

test('end retains fresh authority and unsupported provider end fails closed', async () => {
    const f = await fixture(); let held;
    try { const { ws, ticket } = await f.connect(); held = holdStatus(f); const closed = once(ws, 'close');
        ws.send(JSON.stringify({ type: 'end' })); await until(held.entered); f.sessions.get(ticket.sessionId).epoch++; held.release(); await closed;
        assert.equal(f.calls.includes('end'), false);
    } finally { held?.release(); await f.close(); }
    const g = await fixture({ noEndInput: true });
    try { const { ws } = await g.connect(); const closed = once(ws, 'close'); ws.send(JSON.stringify({ type: 'end' })); await closed;
        assert.ok(g.diagnostics.some(row => row.code === 'END_INPUT_UNSUPPORTED')); assert.equal(g.calls.includes('end'), false);
    } finally { await g.close(); }
});

test('pre-ready queued end fences the fallback audio path', async () => {
    let release; const providerGate = new Promise(resolve => { release = resolve; }); const f = await fixture({ providerGate });
    try {
        const prepared = await (await f.prepare()).json();
        const ws = new WebSocket(f.base.replace('http:', 'ws:') + '/voice', { origin: ORIGIN }); await once(ws, 'open');
        ws.send(JSON.stringify({ type: 'authenticate', feature: 'projects', idToken: 'valid-token', sessionId: prepared.sessionId, ticket: prepared.ticket }));
        await until(() => f.calls.includes('provider-io')); ws.send(audioFrame(Buffer.alloc(2, 1))); ws.send(JSON.stringify({ type: 'end' })); ws.send(audioFrame(Buffer.alloc(2, 2)));
        await new Promise(resolve => setTimeout(resolve, 30)); release(); await until(() => f.calls.includes('end')); await new Promise(resolve => setTimeout(resolve, 30));
        assert.equal(f.audioFrames.length, 1); assert.equal(f.audioFrames[0].bytes[0], 1); assert.equal(f.calls.filter(call => call === 'end').length, 1); assert.equal(ws.readyState, WebSocket.OPEN);
    } finally { release(); await f.close(); }
});

test('end does not bypass input byte limits and failed browser end send retires the connection', async () => {
    const f = await fixture({ limits: { audioBytes: 2 } });
    try { const { ws } = await f.connect(); const closed = once(ws, 'close');
        ws.send(audioFrame(Buffer.alloc(4))); ws.send(JSON.stringify({ type: 'end' })); await closed;
        assert.equal(f.calls.includes('end'), false); assert.equal(f.audioFrames.length, 0);
    } finally { await f.close(); }
    const g = await capturePackingFixture();
    try {
        const originalSend = g.socket.send.bind(g.socket); g.socket.send = raw => { if (JSON.parse(raw).type === 'end') throw new Error('send failed'); originalSend(raw); };
        const ending = g.handle.endInput(); const rejection = assert.rejects(ending, /send failed/); await until(() => g.workletRequests.length === 1);
        g.worklet.port.onmessage({ data: { type: 'flushed', requestId: g.workletRequests[0].requestId, pcm: new Int16Array(0).buffer } });
        await rejection; assert.equal(g.socket.readyState, 3); assert.equal(g.stopped(), 1); assert.equal(g.events.filter(event => event.type === 'disconnected').length, 1);
    } finally { await g.transport.close(); }
});

test('native provider bursts batch fresh checks and preserve ordered output before terminal processing', async () => {
    let releaseStatus, enteredStatus, releaseTerminal, terminalStarted = false;
    const gate = new Promise(resolve => { releaseStatus = resolve; }), entered = new Promise(resolve => { enteredStatus = resolve; }), terminalGate = new Promise(resolve => { releaseTerminal = resolve; });
    const f = await fixture({ nativeProvider: true, processMessage: async message => { if (message.serverContent?.turnComplete) { terminalStarted = true; await terminalGate; return { turnComplete: true }; } return message; } });
    try { const { ws } = await f.connect(); const events = []; ws.on('message', bytes => events.push(JSON.parse(bytes))); const original = f.sessionService.readStatus; let checks = 0;
        f.sessionService.readStatus = async args => { checks++; if (checks === 1) { enteredStatus(); await gate; } return original(args); };
        f.emit({ assistant: { parts: [{ text: '0' }] } }); await entered;
        for (let n = 1; n <= 20; n++) f.emit({ assistant: { parts: [{ text: String(n) }] } });
        f.emit({ serverContent: { turnComplete: true } }); releaseStatus(); await until(() => terminalStarted);
        await until(() => events.filter(event => event.type === 'assistant_text').length === 21); assert.deepEqual(events.filter(event => event.type === 'assistant_text').map(event => event.text), Array.from({ length: 21 }, (_, n) => String(n))); assert.equal(checks, 7, 'three ordinary batches use six reads; terminal has its own fresh entry');
        releaseTerminal(); await until(() => checks === 8); assert.equal(f.diagnostics.some(item => item.code === 'QUEUE_LIMIT'), false);
    } finally { releaseStatus(); releaseTerminal(); await f.close(); }
});
test('native batched output cannot escape a revoked post-normalization authority check', async () => {
    let revoke = false; const f = await fixture({ nativeProvider: true, processMessage: async value => { revoke = true; return value; } });
    try { const { ws } = await f.connect(); const events = []; ws.on('message', bytes => events.push(JSON.parse(bytes))); const original = f.sessionService.readStatus; f.sessionService.readStatus = async args => { if (revoke) throw Error('revoked'); return original(args); }; f.emit({ assistant: { parts: [{ text: 'must not escape' }] } }); await until(() => f.calls.includes('provider-close')); assert.equal(events.some(event => event.type === 'assistant_text'), false);
    } finally { await f.close(); }
});

test('client control seals native provider tail before later output authorization', async () => {
    let release, entered, revoked = false; const gate = new Promise(resolve => { release = resolve; }), ready = new Promise(resolve => { entered = resolve; });
    const f = await fixture({ nativeProvider: true });
    try { const { ws } = await f.connect(); const events = []; ws.on('message', bytes => events.push(JSON.parse(bytes))); const original = f.sessionService.readStatus; let checks = 0; f.sessionService.readStatus = async args => { checks++; if (checks === 1) { entered(); await gate; } if (revoked) throw Error('revoked'); const value = await original(args); if (checks === 5) revoked = true; return value; };
        // Two earlier batches have entry/exit checks; the fifth read belongs
        // to the control. Native muting no longer invokes provider.interrupt.
        f.emit({ assistant: { parts: [{ text: 'A0' }] } }); await ready; f.emit({ assistant: { parts: [{ text: 'A1' }] } }); ws.send(JSON.stringify({ type: 'interrupt' })); const pong = once(ws, 'pong'); ws.ping(); await pong; f.emit({ assistant: { parts: [{ text: 'B' }] } }); release(); await until(() => f.calls.includes('provider-close')); assert.deepEqual(events.filter(event => event.type === 'assistant_text').map(event => event.text), ['A0', 'A1']);
    } finally { release(); await f.close(); }
});
test('native provider batches retain the original total queued byte cap', async () => {
    let release, entered; const gate = new Promise(resolve => { release = resolve; }), ready = new Promise(resolve => { entered = resolve; }); const f = await fixture({ nativeProvider: true });
    try { await f.connect(); const original = f.sessionService.readStatus; let first = true; f.sessionService.readStatus = async args => { if (first) { first = false; entered(); await gate; } return original(args); };
        const packet = { assistant: { parts: [{ audio: { data: Buffer.alloc(30000).toString('base64'), sampleRate: 24000 } }] } }; f.emit(packet); await ready; for (let n = 0; n < 7; n++) f.emit(packet); await until(() => f.calls.includes('provider-close')); assert.ok(f.diagnostics.some(event => event.code === 'QUEUE_LIMIT')); assert.ok(f.calls.includes('unknown'));
    } finally { release(); await f.close(); }
});

test('real ws native burst beyond relay byte cap pauses at capacity and delivers every frame in order', async () => {
    const { WebSocketServer } = require('../../../services/crm-voice-relay/node_modules/ws');
    const { createGeminiLiveConnector } = require('../../../services/crm-voice-relay/gemini-live-connector');
    const upstream = new WebSocketServer({ host: '127.0.0.1', port: 0 }); await once(upstream, 'listening');
    let peer, socket, releaseStatus, enteredStatus, first = true;
    const gate = new Promise(resolve => { releaseStatus = resolve; }), entered = new Promise(resolve => { enteredStatus = resolve; });
    upstream.on('connection', value => { peer = value; value.once('message', () => value.send(JSON.stringify({ setupComplete: {} }))); });
    class LocalSocket extends WebSocket {
        constructor(_url, options) { super(`ws://127.0.0.1:${upstream.address().port}`, options); socket = this; this.pauses = 0; this.resumes = 0; }
        pause() { this.pauses++; super.pause(); }
        resume() { this.resumes++; super.resume(); }
    }
    const f = await fixture({ nativeProvider: true, connectProvider: async options => {
        const connector = await createGeminiLiveConnector({ ...options, apiKey: 'local-test', contextText: 'local test', maxOutputTokens: 512, maxInputAudioBytes: 3200, authorizeDispatch: async () => ({ sendPermit: true, reservationId: 'local' }), WebSocketImpl: LocalSocket });
        return { ...connector, async processMessage(message) {
            if (message.serverContent?.turnComplete) return { turnComplete: true };
            const parts = message.serverContent?.modelTurn?.parts;
            return parts ? { assistant: { parts: parts.map(part => part.inlineData ? { audio: { data: part.inlineData.data, sampleRate: 24000 } } : part) } } : {};
        } };
    } });
    try {
        const { ws } = await f.connect(), events = []; ws.on('message', bytes => events.push(JSON.parse(bytes)));
        const original = f.sessionService.readStatus;
        // Subsequent checks model database I/O, allowing the downstream socket
        // to drain; a microtask-only database fake instead tests client overflow.
        f.sessionService.readStatus = async args => { if (first) { first = false; enteredStatus(); await gate; } await new Promise(resolve => setImmediate(resolve)); return original(args); };
        const packets = Array.from({ length: 64 }, (_, n) => ({ serverContent: { modelTurn: { parts: [{ text: String(n) }, { inlineData: { mimeType: 'audio/pcm;rate=24000', data: Buffer.alloc(6000, n).toString('base64') } }] } } }));
        assert.ok(packets.reduce((sum, value) => sum + Buffer.byteLength(JSON.stringify(value)), 0) > f.limits.queueBytes);
        peer.send(JSON.stringify(packets[0])); await entered;
        for (const packet of packets.slice(1)) peer.send(JSON.stringify(packet));
        peer.send(JSON.stringify({ serverContent: { turnComplete: true } }));
        await until(() => socket.pauses > 0);
        assert.equal(events.length, 0); assert.equal(socket.resumes, 0);
        const paused = f.diagnostics.find(event => event.code === 'QUEUE_PAUSED');
        assert.ok(paused); assert.ok(paused.queuedBytes <= f.limits.queueBytes - f.limits.frameBytes); assert.ok(paused.queued <= 16);
        releaseStatus(); await until(() => events.some(event => event.type === 'turn_complete')).catch(error => { assert.fail(`${error.message}; diagnostics=${JSON.stringify(f.diagnostics)}; events=${events.length}; pauses=${socket.pauses}; resumes=${socket.resumes}`); });
        assert.deepEqual(events.filter(event => event.type === 'assistant_text').map(event => event.text), packets.map((_, n) => String(n)));
        assert.deepEqual(events.filter(event => event.type === 'assistant_audio').map(event => Buffer.from(event.data, 'base64')), packets.map((_, n) => Buffer.alloc(6000, n)));
        assert.equal(events.at(-1).type, 'turn_complete'); assert.ok(socket.resumes > 0);
        assert.ok(f.diagnostics.every(event => ['QUEUE_PAUSED', 'QUEUE_RESUMED'].includes(event.code)));
        for (const resumed of f.diagnostics.filter(event => event.code === 'QUEUE_RESUMED')) { assert.ok(resumed.queuedBytes <= 65536); assert.ok(resumed.queued <= 8); }
    } finally { releaseStatus(); await f.close(); for (const client of upstream.clients) client.terminate(); await new Promise(resolve => upstream.close(resolve)); }
});

test('capacity gate settles on cancellation and revoked authority without releasing output', async () => {
    for (const mode of ['close', 'revoked']) {
        let release, entered, first = true, revoked = false;
        const held = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
        const f = await fixture({ nativeProvider: true });
        try {
            const { ws } = await f.connect(), events = []; ws.on('message', bytes => events.push(JSON.parse(bytes)));
            const original = f.sessionService.readStatus;
            f.sessionService.readStatus = async args => { if (first) { first = false; entered(); await held; } if (revoked) throw Error('revoked'); return original(args); };
            const packet = { assistant: { parts: [{ audio: { data: Buffer.alloc(30000).toString('base64'), sampleRate: 24000 } }] } };
            f.emit(packet); await started; let capacity;
            for (let n = 0; n < 3; n++) capacity = f.emit(packet);
            assert.ok(capacity && typeof capacity.then === 'function'); let settled = false; capacity.then(() => { settled = true; });
            if (mode === 'close') ws.terminate(); else { revoked = true; release(); }
            await until(() => settled); assert.ok(f.calls.includes('provider-close')); assert.equal(events.some(event => event.type === 'assistant_audio'), false);
        } finally { release(); await f.close(); }
    }
});

test('lowered job cap applies capacity hysteresis independently of byte pressure', async () => {
    let release, entered, first = true;
    const held = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
    const f = await fixture({ nativeProvider: true, limits: { queueMessages: 4, queueBytes: 1024, frameBytes: 256 }, processMessage: async () => ({}) });
    try {
        await f.connect(); await new Promise(resolve => setImmediate(resolve)); const original = f.sessionService.readStatus;
        f.sessionService.readStatus = async args => { if (first) { first = false; entered(); await held; } return original(args); };
        const terminal = { serverContent: { turnComplete: true } };
        assert.equal(f.emit(terminal), undefined); await started;
        const capacity = f.emit(terminal); assert.ok(capacity && typeof capacity.then === 'function');
        assert.equal(f.emit(terminal), capacity, 'one gate is shared until low water');
        const paused = f.diagnostics.find(event => event.code === 'QUEUE_PAUSED'); assert.equal(paused.queued, 2); assert.ok(paused.queuedBytes < 512);
        release(); await capacity; await until(() => f.diagnostics.some(event => event.code === 'QUEUE_RESUMED'));
        const resumed = f.diagnostics.find(event => event.code === 'QUEUE_RESUMED'); assert.ok(resumed.queued <= 1); assert.ok(resumed.queuedBytes <= 256);
    } finally { release(); await f.close(); }
});

test('capacity gate settles when relay closes during provider creation', async () => {
    let releaseProvider; const providerGate = new Promise(resolve => { releaseProvider = resolve; });
    const f = await fixture({ nativeProvider: true, providerGate }); let ws;
    try {
        const ticket = await (await f.prepare()).json(); ws = new WebSocket(f.base.replace('http:', 'ws:') + '/voice', { origin: ORIGIN }); await once(ws, 'open');
        ws.send(JSON.stringify({ type: 'authenticate', feature: 'projects', idToken: 'valid-token', sessionId: ticket.sessionId, ticket: ticket.ticket })); await until(() => f.calls.includes('provider-io'));
        const packet = { assistant: { parts: [{ audio: { data: Buffer.alloc(30000).toString('base64'), sampleRate: 24000 } }] } };
        let capacity; for (let n = 0; n < 4; n++) capacity = f.emit(packet);
        assert.ok(capacity && typeof capacity.then === 'function'); let settled = false; capacity.then(() => { settled = true; });
        ws.terminate(); await until(() => settled); assert.ok(f.calls.includes('session-close'));
        releaseProvider(); await until(() => f.calls.includes('provider-close')); assert.equal(f.calls.includes('audio'), false);
    } finally { releaseProvider(); ws?.terminate(); await f.close(); }
});

test('response mute clears startup audio and suppresses future audio through turn completion', async () => {
    const audio = { type: 'assistant_audio', sampleRate: 24000, data: Buffer.alloc(480).toString('base64') };
    const f = await capturePackingFixture({ beforeAudioReady({ handle, emit }) { emit(audio); handle.interrupt(); emit(audio); } });
    try {
        assert.equal(f.playbackStarted(), 0); const delivered = f.events.filter(event => event.type === 'assistant_audio').length; assert.equal(delivered, 1);
        for (const type of ['interrupted', 'turn_complete']) { f.emit({ type }); f.emit(audio); }
        assert.equal(f.playbackStarted(), 0); assert.equal(f.events.filter(event => event.type === 'assistant_audio').length, delivered);
        assert.equal(f.stopped(), 0, 'muting output does not stop capture');
    } finally { await f.transport.close(); }
});

test('response mute immediately stops playing and scheduled audio during held flush; trusted events continue and new preparation resets it', async () => {
    const f = await capturePackingFixture(), audio = { type: 'assistant_audio', sampleRate: 24000, data: Buffer.alloc(480).toString('base64') };
    try {
        f.emit(audio); f.emit(audio); assert.equal(f.playbackStarted(), 2);
        const ending = f.handle.endInput(); ending.catch(() => {}); await until(() => f.workletRequests.length === 1);
        const muting = f.handle.interrupt(); Promise.resolve(muting).catch(() => {}); assert.equal(f.playbackStopped(), 2, 'mute must not wait for capture ACK');
        f.emit(audio); assert.equal(f.playbackStarted(), 2); assert.equal(f.frames.length, 0);
        f.worklet.port.onmessage({ data: { type: 'flushed', requestId: f.workletRequests[0].requestId, pcm: new Int16Array(0).buffer } });
        await Promise.all([ending, muting]); assert.deepEqual(f.frames.map(frame => frame.type), ['end', 'interrupt']);
        f.emit({ type: 'interrupted', scope: 'response_audio' }); f.emit(audio);
        f.emit({ type: 'transcript', utteranceId: 'spoken', text: 'Reviewed confirmation', final: true });
        f.emit({ type: 'confirmation_ready', attestationId: 'proof', sessionId: 's', epoch: 1 });
        assert.equal(f.events.filter(event => event.type === 'assistant_audio').length, 2);
        assert.equal(f.events.filter(event => event.type === 'transcript').length, 1); assert.equal(f.events.filter(event => event.type === 'confirmation_ready').length, 1); assert.equal(f.socket.readyState, 1);
        const next = await f.transport.prepare({ actorUid: 'staff', feature: 'projects' });
        await next.connect({ stream: { getTracks: () => [{ stop() {} }] }, onEvent: event => f.events.push(event) }); f.emit(audio);
        assert.equal(f.playbackStarted(), 3); assert.equal(f.events.filter(event => event.type === 'assistant_audio').length, 3);
    } finally { await f.transport.close(); }
});

test('muted audio is still validated and bounded; close and identity changes fence late events', async () => {
    const audio = { type: 'assistant_audio', sampleRate: 24000, data: Buffer.alloc(4).toString('base64') };
    for (const invalid of [{ ...audio, sampleRate: 16000 }, { ...audio, data: '!' }, { ...audio, data: 'AA==' }, { ...audio, data: 'A'.repeat(48004) }]) {
        const f = await capturePackingFixture(); try { f.handle.interrupt(); f.emit(invalid); assert.equal(f.socket.readyState, 3); assert.equal(f.events.some(event => event.type === 'assistant_audio'), false); } finally { await f.transport.close(); }
    }
    for (const mode of ['close', 'identity']) {
        const f = await capturePackingFixture(); try {
            f.handle.interrupt(); if (mode === 'close') await f.handle.close(); else { f.changeIdentity(); await f.handle.syncIdentity(); }
            f.emit(audio); f.emit({ type: 'confirmation_ready', attestationId: 'late', sessionId: 's', epoch: 1 });
            assert.equal(f.playbackStarted(), 0); assert.equal(f.events.some(event => event.type === 'confirmation_ready'), false);
        } finally { await f.transport.close(); }
    }
});

test('native response mute suppresses queued and future audio after fresh authorization without stopping captured ASR or confirmation', async () => {
    const { createNativeVoiceProvider } = require('../../../services/crm-voice-relay/native-provider');
    const pcm = Buffer.alloc(640, 3), providerCalls = []; let first = true, release, entered;
    const held = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
    const f = await fixture({ nativeProvider: true, finalizeUtterance: event => { assert.equal(event.audioEvidence.transcription.source, 'captured_user_audio'); return { attestationId: 'bound-proof' }; }, connectProvider: options => createNativeVoiceProvider({
        apiKey: 'local-test', native: {
            liveEvidence: value => { providerCalls.push('evidence'); return { complete: false, ...value }; },
            transcribe: async args => { assert.deepEqual(args.pcm, pcm); assert.equal(args.signal.aborted, false); providerCalls.push('asr'); return { text: 'Confirm this preview', transcription: { source: 'captured_user_audio' } }; }
        }, ledger: { settle: async () => { providerCalls.push('accounted'); } }, connector: async () => ({ sendAudio: async frame => { assert.deepEqual(frame.bytes, pcm); providerCalls.push('audio'); }, endInput: async () => { providerCalls.push('end'); }, close() { providerCalls.push('close'); } })
    })({ ...options, context: { context: { project: { id: 'p' } } }, sendPermit: { ...options.sendPermit, reservationId: 'reservation' } }) });
    try {
        const { ws } = await f.connect(), events = []; ws.on('message', bytes => events.push(JSON.parse(bytes)));
        ws.send(audioFrame(pcm)); await until(() => providerCalls.includes('audio'));
        const original = f.sessionService.readStatus;
        f.sessionService.readStatus = async args => { if (first) { first = false; entered(); await held; } return original(args); };
        const packet = { serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: Buffer.alloc(480).toString('base64') } }] } } };
        f.emit(packet); await started; ws.send(JSON.stringify({ type: 'interrupt' })); const pong = once(ws, 'pong'); ws.ping(); await pong;
        f.emit(packet); release(); await until(() => events.some(event => event.type === 'interrupted'));
        const ack = events.find(event => event.type === 'interrupted'); assert.equal(ack.scope, 'response_audio');
        assert.equal(events.filter(event => event.type === 'assistant_audio').length, 1); assert.equal(providerCalls.includes('close'), false); assert.equal(providerCalls.includes('asr'), false); assert.equal(f.calls.includes('unknown'), false);
        f.emit(packet); ws.send(JSON.stringify({ type: 'end' })); await until(() => providerCalls.includes('end'));
        f.emit({ serverContent: { turnComplete: true }, usageMetadata: { responseTokenCount: 2 } });
        await until(() => events.some(event => event.type === 'confirmation_ready'));
        assert.equal(events.filter(event => event.type === 'assistant_audio').length, 1); assert.equal(events.filter(event => event.type === 'confirmation_ready').length, 1);
        assert.equal(events.filter(event => event.type === 'transcript' && event.final).length, 1); assert.deepEqual(providerCalls.slice(-4), ['close', 'evidence', 'accounted', 'asr']);
    } finally { release(); await f.close(); }
});

test('native muted output retains byte limits and revoked interruption cannot acknowledge or release output', async () => {
    const packet = { assistant: { parts: [{ audio: { data: Buffer.alloc(4).toString('base64'), sampleRate: 24000 } }] } };
    const f = await fixture({ nativeProvider: true, limits: { outputBytes: 4 } });
    try {
        const { ws } = await f.connect(), events = []; ws.on('message', bytes => events.push(JSON.parse(bytes)));
        ws.send(JSON.stringify({ type: 'interrupt' })); await until(() => events.some(event => event.type === 'interrupted')); f.emit(packet); f.emit(packet);
        await until(() => f.calls.includes('provider-close')); assert.equal(events.some(event => event.type === 'assistant_audio'), false); assert.ok(f.calls.includes('unknown'));
    } finally { await f.close(); }
    const g = await fixture({ nativeProvider: true }); let release;
    try {
        const { ws, ticket } = await g.connect(), events = []; ws.on('message', bytes => events.push(JSON.parse(bytes)));
        const held = holdStatus(g); release = held.release; ws.send(JSON.stringify({ type: 'interrupt' })); await until(held.entered);
        g.sessions.get(ticket.sessionId).epoch++; g.emit(packet); release(); await until(() => g.calls.includes('provider-close'));
        assert.equal(events.some(event => ['interrupted', 'assistant_audio'].includes(event.type)), false); assert.ok(g.calls.includes('unknown'));
    } finally { release?.(); await g.close(); }
});
