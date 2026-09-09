'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createGeminiLiveConnector, ENDPOINT, MODEL, LIMITS } = require('../../../services/crm-voice-relay/gemini-live-connector');
function fixture(overrides = {}) {
    const sockets = [], events = [], errors = [];
    class FakeSocket extends EventEmitter {
        constructor(url, options) { super(); Object.assign(this, { url, options, sent: [], bufferedAmount: 0, callbacks: [], held: false, terminated: 0 }); sockets.push(this); }
        send(wire, callback) { this.sent.push(JSON.parse(wire)); if (this.held) this.callbacks.push(callback); else callback(); }
        terminate() { this.terminated++; }
        pause() { this.pauses = (this.pauses || 0) + 1; }
        resume() { this.resumes = (this.resumes || 0) + 1; }
        message(value) { this.emit('message', JSON.stringify(value), false); }
        flush() { this.callbacks.shift()?.(); }
    }
    const options = { apiKey: 'fake-key-never-used', contextText: 'Safe context', maxOutputTokens: 100,
        maxInputAudioBytes: LIMITS.inputAudioBytes, authorizeDispatch: async () => ({ sendPermit: true, reservationId: 'reservation-1' }),
        onMessage: message => events.push(message), onError: failure => errors.push(failure), WebSocketImpl: FakeSocket, ...overrides };
    return { sockets, events, errors, options, start: () => createGeminiLiveConnector(options) };
}
async function ready(f) { const pending = f.start(); await new Promise(resolve => setImmediate(resolve)); const socket = f.sockets[0]; socket.emit('open'); socket.message({ setupComplete: {} }); return { api: await pending, socket }; }
const audio = (bytes = Buffer.from([1, 2, 3, 4]), utteranceId = 'utterance-1') => ({ bytes, sampleRate: 16000, utteranceId });
test('unsolicited valid resumption metadata is discarded without reconnect or handle exposure', async () => {
    const f = fixture(), { api, socket } = await ready(f); const before = f.events.length;
    socket.message({ sessionResumptionUpdate: { newHandle: 'private-handle', resumable: true, lastConsumedClientMessageIndex: '12' } });
    assert.equal(f.errors.length, 0); assert.equal(f.events.length, before); assert.equal(f.sockets.length, 1); assert.equal(socket.sent.length, 1);
    socket.message({ sessionResumptionUpdate: { newHandle: 'private-handle', resumable: true }, usageMetadata: { totalTokenCount: 10 } });
    assert.equal(f.events.at(-1).usageMetadata.totalTokenCount, 10); assert.equal(Object.hasOwn(f.events.at(-1), 'sessionResumptionUpdate'), false);
    socket.message({ serverContent: { turnComplete: true } }); assert.equal(f.events.at(-1).serverContent.turnComplete, true); api.close();
    for (const update of [{ newHandle: 1 }, { resumable: 'true' }, { lastConsumedClientMessageIndex: '-1' }, { newHandle: 'x'.repeat(4097) }, { unexpected: true }]) {
        const g = fixture(), readyValue = await ready(g); readyValue.socket.message({ sessionResumptionUpdate: update }); assert.equal(g.errors[0].code, 'INVALID_PROVIDER_MESSAGE'); readyValue.api.close();
    }
});

test('admission denial, exception, and missing reservation create zero sockets', async () => {
    for (const authorizeDispatch of [async () => false, async () => { throw new Error('secret'); }, async () => ({ sendPermit: true })]) {
        const f = fixture({ authorizeDispatch }); await assert.rejects(f.start(), { code: 'DISPATCH_DENIED' }); assert.equal(f.sockets.length, 0);
    }
});
test('pending admission precedes constructor; setup ack precedes usable API; credentials only in header', async () => {
    let admit; const f = fixture({ authorizeDispatch: () => new Promise(resolve => { admit = resolve; }) });
    const pending = f.start(); assert.equal(f.sockets.length, 0); admit({ sendPermit: true, reservationId: 'r' }); await new Promise(resolve => setImmediate(resolve));
    const socket = f.sockets[0]; let resolved = false; pending.then(() => { resolved = true; });
    socket.emit('open'); await new Promise(resolve => setImmediate(resolve)); assert.equal(resolved, false); assert.equal(socket.sent.length, 1);
    assert.equal(socket.url, ENDPOINT); assert.equal(socket.url.includes('fake-key'), false);
    assert.deepEqual(socket.options.headers, { 'x-goog-api-key': 'fake-key-never-used' });
    assert.equal(socket.options.perMessageDeflate, false); assert.equal(socket.options.followRedirects, false);
    assert.deepEqual(socket.sent[0], { setup: { model: MODEL, generationConfig: { maxOutputTokens: 100, responseModalities: ['AUDIO'], thinkingConfig: { thinkingLevel: 'MINIMAL' } },
        systemInstruction: { parts: [{ text: 'Safe context' }] }, realtimeInputConfig: { automaticActivityDetection: { disabled: true },
            activityHandling: 'NO_INTERRUPTION', turnCoverage: 'TURN_INCLUDES_ONLY_ACTIVITY' }, inputAudioTranscription: {}, outputAudioTranscription: {} } });
    socket.message({ setupComplete: {} }); const api = await pending; assert.equal(api.reservationId, 'r');
    assert.equal(api.provenance.inputTranscriptionEnabled, true); assert.equal(api.provenance.outputTranscriptionEnabled, true);
    assert.equal(api.provenance.transcriptionCostProven, false); assert.equal(api.provenance.billingBoundProven, false);
    assert.equal(api.provenance.thoughtsMayBeBillable, true); api.close();
});
test('segments preserve bytes and order with one start/end and no audio after sealed input', async () => {
    const f = fixture(); const { api, socket } = await ready(f); socket.held = true;
    const first = api.sendAudio(audio()); const second = api.sendAudio(audio(Buffer.from([5, 6]))); const end = api.endInput();
    assert.equal(api.endInput(), end); await assert.rejects(api.sendAudio(audio()), { code: 'INPUT_ENDED' });
    while (socket.callbacks.length) socket.flush(); await Promise.all([first, second, end]);
    assert.deepEqual(socket.sent.slice(1), [{ realtimeInput: { activityStart: {} } },
        { realtimeInput: { audio: { mimeType: 'audio/pcm;rate=16000', data: 'AQIDBA==' } } },
        { realtimeInput: { audio: { mimeType: 'audio/pcm;rate=16000', data: 'BQY=' } } }, { realtimeInput: { activityEnd: {} } }]); api.close();
});
test('input total, frame size, PCM shape, and different utterance are rejected', async () => {
    for (const bad of [audio(Buffer.alloc(3)), { ...audio(), sampleRate: 24000 }, audio(Buffer.alloc(LIMITS.audioFrameBytes + 2)), audio(Buffer.alloc(2), 'other')]) {
        const f = fixture(); const { api, socket } = await ready(f); await api.sendAudio(audio());
        await assert.rejects(api.sendAudio(bad), { code: 'INVALID_INPUT_AUDIO' }); assert.equal(socket.terminated, 1);
    }
    const f = fixture({ maxInputAudioBytes: 4 }); const { api, socket } = await ready(f); await api.sendAudio(audio());
    await assert.rejects(api.sendAudio(audio()), { code: 'INPUT_AUDIO_LIMIT' }); assert.equal(socket.terminated, 1);
});
test('bounded queue retains backpressure accounting and cancels all pending sends on overflow', async () => {
    const f = fixture(); const { api, socket } = await ready(f); socket.held = true;
    const pending = []; for (let i = 0; i < 10; i++) pending.push(api.sendAudio(audio(Buffer.alloc(32000))).catch(e => e.code));
    const result = await Promise.all(pending); assert.ok(result.includes('INPUT_QUEUE_LIMIT')); assert.equal(socket.terminated, 1);
    socket.flush(); assert.equal(socket.sent.length, 2);
});
test('all native parts and observational transcript/usage fields forwarded unchanged', async () => {
    const f = fixture(); const { api, socket } = await ready(f);
    const message = { serverContent: { modelTurn: { role: 'model', parts: [{ text: 'hello' }, { inlineData: { mimeType: 'audio/pcm;rate=24000', data: 'AQI=' } }] },
        inputTranscription: { text: 'user' }, interimInputTranscription: { text: 'us', languageCode: 'en' }, outputTranscription: { text: 'assistant' },
        turnComplete: true, generationComplete: true, interactionStatus: 'INTERACTION_STATUS_UNSPECIFIED' }, usageMetadata: { totalTokenCount: 4 } };
    socket.message(message); assert.deepEqual(f.events[1], message); assert.equal(f.events[1].serverContent.inputTranscription.final, undefined); assert.deepEqual(f.errors, []); api.close();
});
test('malformed, unexpected tools, fake transcript finality, bad PCM and oversized provider frames fail closed', async () => {
    const cases = [socket => socket.emit('message', '{', false), socket => socket.message({ toolCall: { functionCalls: [] } }),
        socket => socket.message({ serverContent: { inputTranscription: { text: 'yes', final: true } } }),
        socket => socket.message({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=16000', data: 'AQI=' } }] } } }),
        socket => socket.emit('message', Buffer.alloc(LIMITS.frameBytes + 1), false), socket => socket.emit('message', Buffer.from('{}'), true)];
    for (const emit of cases) { const f = fixture(); const { socket } = await ready(f); emit(socket); assert.equal(socket.terminated, 1); assert.equal(f.errors.length, 1); assert.equal(f.events.length, 1); }
});
test('cumulative provider bytes are bounded even when each frame is valid', async () => {
    const f = fixture(); const { socket } = await ready(f);
    const message = { serverContent: { modelTurn: { parts: [{ text: 'x'.repeat(16000) }] } } };
    for (let i = 0; i < 600; i++) socket.message(message);
    assert.equal(f.errors.at(-1).code, 'PROVIDER_OUTPUT_LIMIT'); assert.equal(socket.terminated, 1);
});
test('provider/constructor/send failures are sanitized and late events cannot revive a closed connector', async () => {
    const f = fixture(); const { api, socket } = await ready(f);
    socket.emit('error', new Error('fake-key-never-used SECRET_PROVIDER_BODY')); socket.emit('close', 1008, 'SECRET_PROVIDER_BODY');
    socket.message({ serverContent: { inputTranscription: { text: 'late' } } }); socket.emit('open'); api.close();
    assert.equal(f.errors.length, 1); assert.equal(f.errors[0].message, 'PROVIDER_CONNECTION_ERROR'); assert.equal(f.events.length, 1); assert.equal(socket.terminated, 1);
    await assert.rejects(api.sendAudio(audio()), { code: 'CONNECTOR_CLOSED' });
    await assert.rejects(fixture({ WebSocketImpl: class { constructor() { throw new Error('SECRET'); } } }).start(), { message: 'PROVIDER_CONNECT_FAILED' });
    const g = fixture(); const r = await ready(g); r.socket.send = () => { throw new Error('SECRET'); };
    await assert.rejects(r.api.sendAudio(audio()), { code: 'PROVIDER_SEND_FAILED' }); assert.equal(g.errors[0].message, 'PROVIDER_SEND_FAILED');
});
test('setup timeout and session timeout clean pending work and ignore late acknowledgements', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const f = fixture(); const pending = f.start(); await new Promise(resolve => setImmediate(resolve));
    t.mock.timers.tick(LIMITS.setupMs); await assert.rejects(pending, { code: 'PROVIDER_SETUP_TIMEOUT' });
    f.sockets[0].message({ setupComplete: {} }); assert.equal(f.events.length, 0);
    const g = fixture(); const { api, socket } = await ready(g); socket.held = true; const send = api.sendAudio(audio());
    t.mock.timers.tick(LIMITS.sessionMs); await assert.rejects(send, { code: 'PROVIDER_SESSION_TIMEOUT' }); assert.equal(socket.terminated, 1); api.close();
});
test('explicit close cancels pending work exactly once without an error callback', async () => {
    const f = fixture(); const { api, socket } = await ready(f); socket.held = true; const send = api.sendAudio(audio());
    api.close(); api.close(); await assert.rejects(send, { code: 'CONNECTOR_CLOSED' }); socket.flush();
    assert.equal(socket.terminated, 1); assert.deepEqual(f.errors, []);
});
test('small-frame message count and socket buffered bytes remain bounded', async () => {
    const f = fixture(); const { api, socket } = await ready(f); socket.held = true;
    const sends = Array.from({ length: LIMITS.queueMessages + 1 }, () => api.sendAudio(audio()).catch(e => e.code));
    assert.ok((await Promise.all(sends)).includes('INPUT_QUEUE_LIMIT')); assert.equal(socket.terminated, 1);
    const g = fixture(); const r = await ready(g); r.socket.bufferedAmount = LIMITS.queueBytes + 1;
    await assert.rejects(r.api.sendAudio(audio()), { code: 'INPUT_QUEUE_LIMIT' }); assert.equal(r.socket.sent.length, 1);
});
test('unexpected setup ordering and goAway stop without resumption; usage types are strict', async () => {
    const f = fixture(); const pending = f.start(); await new Promise(resolve => setImmediate(resolve)); f.sockets[0].emit('open');
    f.sockets[0].message({ serverContent: { turnComplete: true } }); await assert.rejects(pending, { code: 'INVALID_PROVIDER_STATE' });
    for (const message of [{ setupComplete: {} }, { goAway: { timeLeft: '30s' } }, { serverContent: {}, usageMetadata: { totalTokenCount: '4' } }]) {
        const g = fixture(); const { socket } = await ready(g); socket.message(message); assert.equal(socket.terminated, 1); assert.equal(g.sockets.length, 1);
    }
});
test('asynchronous callback rejection is sanitized and stops I/O', async () => {
    const f = fixture({ onMessage: async message => { if (message.serverContent) throw new Error('SECRET'); } });
    const { socket } = await ready(f); socket.message({ serverContent: { waitingForInput: true } }); await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.errors[0].code, 'PROVIDER_CALLBACK_FAILED'); assert.equal(socket.terminated, 1);
});
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
test('native binary frames carry strict UTF-8 JSON, as observed on the real Gemini endpoint', async () => {
    const f = fixture(); const pending = f.start(); await new Promise(resolve => setImmediate(resolve));
    const socket = f.sockets[0]; socket.emit('open');
    socket.emit('message', Buffer.from(JSON.stringify({ setupComplete: {} })), true);
    const api = await pending;
    socket.emit('message', Buffer.from(JSON.stringify({ serverContent: { inputTranscription: { text: 'hello' } } })), true);
    assert.equal(f.events[1].serverContent.inputTranscription.text, 'hello');
    socket.emit('message', Buffer.from([0xc0, 0xaf]), true);
    assert.equal(f.errors[0].code, 'INVALID_PROVIDER_MESSAGE'); assert.equal(socket.terminated, 1); api.close();
});
const flushMicrotasks = () => new Promise(resolve => setImmediate(resolve));
test('SDK voice activity and finished transcription metadata are validated and forwarded without attestation', async () => {
    const f = fixture(); const { api, socket } = await ready(f);
    const message = { voiceActivity: { type: 'ACTIVITY_END', audioOffset: '2.5s' }, serverContent: { inputTranscription: { text: 'hello', finished: true, speakerLabel: 'speaker', words: [{ word: 'hello', startOffset: '0s', endOffset: '1s' }] }, turnCompleteReason: 'NEED_MORE_INPUT' } };
    socket.message(message); assert.deepEqual(f.events.at(-1), message); assert.equal(api.provenance.transcriptsAttestable, false);
    socket.message({ serverContent: { inputTranscription: { finished: 'true' } } });
    assert.equal(f.errors.at(-1).code, 'INVALID_PROVIDER_MESSAGE'); api.close();
});
test('provider callbacks are serial and preserve arrival order while first callback is held', async () => {
    const first = deferred(), second = deferred(), order = [];
    const f = fixture({ onMessage: async message => {
        if (!message.serverContent) return;
        const text = message.serverContent.inputTranscription.text; order.push(`start:${text}`);
        await (text === 'first' ? first.promise : second.promise); order.push(`end:${text}`);
    } });
    const { api, socket } = await ready(f);
    socket.message({ serverContent: { inputTranscription: { text: 'first' } } });
    socket.message({ serverContent: { inputTranscription: { text: 'second' } } });
    second.resolve(); await flushMicrotasks(); assert.deepEqual(order, ['start:first']);
    first.resolve(); await flushMicrotasks(); assert.deepEqual(order, ['start:first', 'end:first', 'start:second', 'end:second']); api.close();
});
test('pending callback pauses reads, gates buffered frames, and drains before resuming', async t => {
    const first = deferred(), second = deferred(), seen = [];
    const f = fixture({ onMessage: message => {
        if (!message.serverContent) return;
        const text = message.serverContent.inputTranscription.text; seen.push(text);
        if (text === 'first') return first.promise;
        if (text === 'second') return second.promise;
    } });
    const { api, socket } = await ready(f);
    t.after(() => api.close());
    assert.equal(socket.pauses || 0, 0, 'synchronous setup does not pause');
    socket.message({ serverContent: { inputTranscription: { text: 'first' } } });
    assert.equal(socket.pauses, 1);
    // ws can still emit receiver-buffered frames after its socket is paused.
    for (const text of ['second', 'third']) socket.message({ serverContent: { inputTranscription: { text } } });
    assert.deepEqual(seen, ['first']); first.resolve(); await flushMicrotasks();
    assert.deepEqual(seen, ['first', 'second']); assert.equal(socket.resumes || 0, 0);
    second.resolve(); await flushMicrotasks();
    assert.deepEqual(seen, ['first', 'second', 'third']); assert.equal(socket.resumes, 1); api.close();
});
test('paused callback completion after abort or close cannot resume or deliver buffered frames', async t => {
    for (const abort of [false, true]) {
        const held = deferred(), controller = new AbortController(); let seen = 0;
        const f = fixture({ signal: controller.signal, onMessage: message => { if (message.serverContent) { seen++; return held.promise; } } });
        const { api, socket } = await ready(f);
        t.after(() => api.close());
        for (let i = 0; i < 3; i++) socket.message({ serverContent: { waitingForInput: true } });
        assert.equal(socket.pauses, 1); if (abort) controller.abort(); else api.close();
        held.resolve(); await flushMicrotasks();
        assert.equal(seen, 1); assert.equal(socket.resumes || 0, 0); assert.equal(socket.terminated, 1);
    }
});
test('inbound message bound includes held callback; overflow suppresses every queued callback', async () => {
    const held = deferred(); let calls = 0;
    const f = fixture({ onMessage: message => { if (message.serverContent) { calls++; return held.promise; } } });
    const { socket } = await ready(f);
    for (let i = 0; i < LIMITS.queueMessages; i++) socket.message({ serverContent: { waitingForInput: true } });
    assert.equal(calls, 1); assert.equal(socket.terminated, 0);
    socket.message({ serverContent: { waitingForInput: true } });
    assert.equal(f.errors[0].code, 'PROVIDER_QUEUE_LIMIT'); assert.equal(socket.terminated, 1);
    held.resolve(); await flushMicrotasks(); assert.equal(calls, 1);
});
test('inbound serialized byte bound includes held callback independently of message cap', async () => {
    const held = deferred(); let calls = 0;
    const f = fixture({ onMessage: message => { if (message.serverContent) { calls++; return held.promise; } } });
    const { socket } = await ready(f);
    const message = { serverContent: { inputTranscription: { text: 'a'.repeat(16000) } } };
    const allowed = Math.floor(LIMITS.queueBytes / Buffer.byteLength(JSON.stringify(message)));
    assert.ok(allowed < LIMITS.queueMessages);
    for (let i = 0; i < allowed; i++) socket.message(message);
    assert.equal(socket.terminated, 0); socket.message(message); assert.equal(f.errors[0].code, 'PROVIDER_QUEUE_LIMIT');
    held.resolve(); await flushMicrotasks(); assert.equal(calls, 1);
});
test('close discards queued provider callbacks and their late completions cannot restart delivery', async () => {
    const held = deferred(); const calls = [];
    const f = fixture({ onMessage: message => { if (message.serverContent) { calls.push(message.serverContent.inputTranscription.text); return held.promise; } } });
    const { api, socket } = await ready(f);
    for (const text of ['active', 'queued']) socket.message({ serverContent: { inputTranscription: { text } } });
    api.close(); held.resolve(); await flushMicrotasks(); socket.message({ serverContent: { inputTranscription: { text: 'late' } } });
    assert.deepEqual(calls, ['active']); assert.deepEqual(f.errors, []); assert.equal(socket.terminated, 1);
});
test('admission deadline rejects a hanging authorizer; a late committed permit never constructs a socket', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] }); const held = deferred(); let admissionSignal;
    const f = fixture({ authorizeDispatch: ({ signal }) => { admissionSignal = signal; return held.promise; } });
    const pending = f.start(); t.mock.timers.tick(LIMITS.admissionMs);
    await assert.rejects(pending, { code: 'ADMISSION_TIMEOUT' }); assert.equal(admissionSignal.aborted, true);
    held.resolve({ sendPermit: true, reservationId: 'late-commit-owned-by-authorizer' }); await flushMicrotasks();
    assert.equal(f.sockets.length, 0); assert.deepEqual(f.errors, []);
});
test('abort before/during admission creates no socket, including late rejection or late permit', async () => {
    const already = new AbortController(); already.abort(); let calls = 0;
    const f = fixture({ signal: already.signal, authorizeDispatch: () => { calls++; } });
    await assert.rejects(f.start(), { code: 'CONNECTOR_ABORTED' }); assert.equal(calls, 0);
    for (const reject of [true, false]) {
        const controller = new AbortController(), held = deferred(); let innerSignal;
        const g = fixture({ signal: controller.signal, authorizeDispatch: ({ signal }) => { innerSignal = signal; return held.promise; } });
        const pending = g.start(); controller.abort('secret caller reason'); await assert.rejects(pending, { message: 'CONNECTOR_ABORTED' });
        assert.equal(innerSignal.aborted, true);
        if (reject) held.reject(new Error('secret late failure')); else held.resolve({ sendPermit: true, reservationId: 'r' });
        await flushMicrotasks(); assert.equal(g.sockets.length, 0);
    }
});
test('abort after admission resolution but before factory resumes is fenced before socket creation', async () => {
    const controller = new AbortController(), held = deferred(); let innerSignal;
    const f = fixture({ signal: controller.signal, authorizeDispatch: ({ signal }) => { innerSignal = signal; return held.promise; } }); const pending = f.start();
    held.resolve({ sendPermit: true, reservationId: 'r' }); queueMicrotask(() => controller.abort());
    await assert.rejects(pending, { code: 'CONNECTOR_ABORTED' }); assert.equal(f.sockets.length, 0); assert.equal(innerSignal.aborted, true);
});
test('abort during setup or after ready terminates connection and cancels queued work', async () => {
    const controller = new AbortController(); const f = fixture({ signal: controller.signal }); const pending = f.start(); await flushMicrotasks();
    controller.abort(); await assert.rejects(pending, { code: 'CONNECTOR_ABORTED' }); assert.equal(f.sockets[0].terminated, 1);
    const second = new AbortController(); const g = fixture({ signal: second.signal }); const { api, socket } = await ready(g);
    socket.held = true; const send = api.sendAudio(audio()); second.abort(); await assert.rejects(send, { code: 'CONNECTOR_ABORTED' });
    assert.equal(socket.terminated, 1); assert.equal(g.errors[0].code, 'CONNECTOR_ABORTED'); api.close();
});
test('standalone usage after setup is forwarded unchanged without completeness inference', async () => {
    const f = fixture(); const { api, socket } = await ready(f);
    const message = { usageMetadata: { totalTokenCount: 7, promptTokensDetails: [{ modality: 'AUDIO', tokenCount: 3 }] } };
    socket.message(message); assert.deepEqual(f.events.at(-1), message); assert.equal(f.events.length, 2);
    assert.deepEqual(f.errors, []); api.close();
});
test('empty messages, multiple structural events and malformed standalone usage remain rejected', async () => {
    for (const message of [{}, { serverContent: {}, goAway: { timeLeft: '30s' } }, { usageMetadata: { totalTokenCount: '7' } }]) {
        const f = fixture(); const { socket } = await ready(f); socket.message(message);
        assert.equal(f.errors[0].code, 'INVALID_PROVIDER_MESSAGE'); assert.equal(socket.terminated, 1); assert.equal(f.events.length, 1);
    }
});
test('standalone usage cannot replace the required setup acknowledgement', async () => {
    const f = fixture(); const pending = f.start(); await flushMicrotasks(); const socket = f.sockets[0];
    socket.emit('open'); socket.message({ usageMetadata: { totalTokenCount: 0 } });
    await assert.rejects(pending, { code: 'INVALID_PROVIDER_STATE' }); assert.equal(socket.terminated, 1); assert.deepEqual(f.events, []);
});
