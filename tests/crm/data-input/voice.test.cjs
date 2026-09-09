'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
const scope = { window: {}, AbortController };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../../public/js/crm/data-input/voice.js'), 'utf8'), scope);

test('retiring a shared handle detaches context sync without detaching a newer handle', async () => {
    let contexts = 0, reads = 0;
    const global = { crypto: globalThis.crypto, fetch: async () => {}, location: { href: 'http://127.0.0.1/' } };
    const runtime = { window: global, URL, Int16Array, setInterval, clearInterval, setTimeout, clearTimeout };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../../public/js/crm/ai-assistance/voice-transport.js'), 'utf8'), runtime);
    const transport = global.CrmAiVoiceTransport.createTransport({ baseUrl: 'http://127.0.0.1:9000', getUid: () => 'staff1', getIdToken: async () => 'fixture',
        getContext: () => { contexts++; return {}; }, fetchImpl: async url => ({ ok: true, text: async () => JSON.stringify(new URL(url).pathname === '/status' ? { current: ++reads } : { sessionId: 's1', ticket: 'fixture', engineeringOnly: false }) }) });
    const first = await transport.prepare({ actorUid: 'staff1', feature: 'crm-data-input' });
    try {
        await first.close(); const before = contexts;
        await transport.updateContext(); assert.equal(contexts, before, 'retired handle cannot trigger a context error during accepted drafting');
        await assert.rejects(first.updateContext(), /closed/);
        vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../../public/js/crm/data-input/workspace.js'), 'utf8'), runtime);
        const abort = new AbortController(); let reviews = 0, errors = 0;
        const state = { uid: 'staff1', capabilities: { interpretation: true }, draft: { draftId: 'd1', revision: 0, actions: [] } };
        let bridge;
        const client = { getState: () => state, getVoiceHints: () => ({ draftId: 'd1' }),
            async interpret() { state.draft.revision++; state.draft.actions = [{ actionId: 'a1' }]; state.interpretation = { status: 'applied' }; await bridge.sync(); },
            async review() { assert.equal(abort.signal.aborted, false); reviews++; } };
        bridge = global.CrmDataInputWorkspace.createVoiceBridge({ client, getUid: () => 'staff1', transport, onContextError: () => { errors++; abort.abort(); } });
        const accept = global.CrmDataInputWorkspace.createSpokenInstructionHandler({ client, getUid: () => 'staff1', saveDraft: async () => {} });
        assert.equal((await accept('Create enquiry', { actorUid: 'staff1', signal: abort.signal })).status, 'review');
        assert.equal(reviews, 1); assert.equal(errors, 0); assert.equal(abort.signal.aborted, false);
        const second = await transport.prepare({ actorUid: 'staff1', feature: 'crm-data-input' });
        await first.close();
        assert.ok(await transport.readStatus(), 'old retirement must not detach the new active handle');
        assert.equal(reads, 1);
        await second.close(); assert.equal(await transport.readStatus(), undefined);
    } finally { await transport.close(); }
});

test('response mute is sticky for a voice turn while final transcript handling stays active', async () => {
    const f = fixture(); await f.voice.start(); await f.voice.interrupt();
    assert.equal(f.voice.getState().responseMuted, true);
    await f.voice.interrupt(); assert.equal(f.state.interrupts, 1);
    f.state.onEvent({ type: 'transcript', final: true, text: 'Keep this instruction', utteranceId: 'u1' });
    assert.deepEqual(f.state.transcripts, ['Keep this instruction']);
    await f.voice.stop(); await f.voice.start(); assert.equal(f.voice.getState().responseMuted, false); await f.voice.stop();
});
function fixture(onConfirmation, extra = {}) {
    const state = { uid: 'staff1', events: [], transcripts: [], closes: 0, stops: 0, captures: 0, interrupts: 0 };
    const track = { enabled: true, stop() { state.stops++; } }, stream = { getTracks: () => [track], getAudioTracks: () => [track] };
    const handle = { async connect(input) { state.onEvent = input.onEvent; assert.equal(input.stream, stream); if (state.connectError) throw Error('connect failed'); }, async close() { state.closes++; }, async interrupt() { state.interrupts++; } };
    const options = { getUid: () => state.uid, transport: { prepare: async input => { assert.equal(input.feature, 'crm-data-input'); if (state.prepare) return state.prepare(); return handle; } }, getUserMedia: async () => { state.captures++; if (state.capture) return state.capture(); return stream; }, onTranscript: (text, identity) => { state.transcripts.push(text); state.transcriptContext = identity; }, onChange: value => state.events.push(value), onConfirmation };
    return { state, stream, track, handle, voice: scope.window.CrmDataInputVoice.createSession({ ...options, ...extra }) };
}
test('voice lifecycle admits before capture, supports mute and interruption, and delivers bounded final transcripts only', async () => {
    const f = fixture(); await f.voice.start(); assert.equal(f.voice.getState().status, 'listening');
    f.voice.setMuted(true); assert.equal(f.track.enabled, false); assert.equal(f.voice.getState().muted, true);
    await f.voice.interrupt(); assert.equal(f.state.interrupts, 1);
    f.state.onEvent({ type: 'transcript', text: 'partial', final: false }); assert.equal(f.state.transcripts.length, 0);
    f.state.onEvent({ type: 'tool', name: 'commit' });
    f.state.onEvent({ type: 'transcript', text: 'Create Lan', final: true });
    f.state.onEvent({ type: 'transcript', text: 'x'.repeat(16001), final: true });
    assert.deepEqual(f.state.transcripts, ['Create Lan']);
    await f.voice.stop(); assert.equal(f.state.stops, 1); assert.equal(f.state.closes, 1);
    f.state.onEvent({ type: 'transcript', text: 'late', final: true }); assert.equal(f.state.transcripts.length, 1);
});

const confirmation = { type: 'confirmation_ready', attestationId: 'a1', sessionId: 's1', epoch: 1, utteranceId: 'u1' };
const tick = () => new Promise(resolve => setImmediate(resolve));
test('trusted confirmation stops capture and retains connection until a committed receipt resolves', async () => {
    let finish, calls = 0, received;
    const f = fixture((reference, context) => { calls++; received = { reference, context }; return new Promise(resolve => { finish = resolve; }); });
    await f.voice.start(); f.state.onEvent(confirmation); await tick();
    assert.equal(f.voice.getState().status, 'confirming'); assert.equal(f.state.stops, 1); assert.equal(f.state.closes, 0);
    assert.equal(received.context.actorUid, 'staff1'); assert.equal(received.context.signal.aborted, false); assert.equal(Object.isFrozen(received.reference), true);
    f.state.onEvent(confirmation); f.state.onEvent({ type: 'transcript', utteranceId: 'u1', text: 'Tôi xác nhận lưu bản xem trước số 1', final: true });
    await tick(); assert.equal(calls, 1); assert.deepEqual(f.state.transcripts, []);
    await assert.rejects(f.voice.start(), /already active/);
    finish({ status: 'committed', operationId: 'p1' }); await tick();
    assert.equal(f.state.closes, 1); assert.equal(f.state.stops, 1); assert.equal(f.voice.getState().status, 'saved');
});

test('missing callback malformed reference and uncommitted result fail closed without automatic retry', async () => {
    for (const mode of ['missing', 'malformed', 'uncommitted', 'failure']) {
        let calls = 0;
        const f = fixture(mode === 'missing' ? undefined : async () => { calls++; if (mode === 'failure') throw Error('Network failed'); return { status: 'unknown' }; });
        await f.voice.start(); f.state.onEvent(mode === 'malformed' ? { ...confirmation, epoch: 0 } : confirmation); await tick();
        assert.equal(f.voice.getState().status, 'error'); assert.equal(f.state.closes, 1); assert.equal(f.state.stops, 1);
        assert.equal(calls, ['missing', 'malformed'].includes(mode) ? 0 : 1);
        f.state.onEvent(confirmation); await tick(); assert.equal(f.state.closes, 1);
    }
});

test('cancel or account switch fences late save callbacks from changing a newer session', async () => {
    for (const mode of ['cancel', 'identity']) {
        let finish, signal;
        const f = fixture((reference, context) => { signal = context.signal; return new Promise(resolve => { finish = resolve; }); });
        await f.voice.start(); f.state.onEvent(confirmation); await tick();
        if (mode === 'identity') { f.state.uid = 'staff2'; await f.voice.syncIdentity(); } else await f.voice.stop();
        assert.equal(signal.aborted, true); await f.voice.start();
        finish({ status: 'committed' }); await tick();
        assert.equal(f.voice.getState().status, 'listening'); assert.equal(f.state.closes, 1);
        await f.voice.stop();
    }
});

test('confirmation during connection setup is not overwritten by listening state', async () => {
    let finish;
    const f = fixture(() => new Promise(resolve => { finish = resolve; }));
    f.handle.connect = async ({ onEvent }) => { f.state.onEvent = onEvent; onEvent(confirmation); };
    await f.voice.start(); await tick(); assert.equal(f.voice.getState().status, 'confirming');
    finish({ status: 'committed' }); await tick(); assert.equal(f.voice.getState().status, 'saved');
});

test('disconnect during save preserves recovery guidance and ignores a late receipt', async () => {
    let finish;
    const f = fixture(() => new Promise(resolve => { finish = resolve; }));
    await f.voice.start(); f.state.onEvent(confirmation); await tick();
    f.state.onEvent({ type: 'disconnected' }); await tick();
    assert.equal(f.voice.getState().status, 'error'); assert.match(f.voice.getState().error, /Check saved status/);
    finish({ status: 'committed' }); await tick();
    assert.equal(f.voice.getState().status, 'error'); assert.equal(f.state.closes, 1);
});

test('final utterance IDs deduplicate delivery and conflicting repeats stop the session', async () => {
    const f = fixture(); await f.voice.start();
    const final = { type: 'transcript', utteranceId: 'u2', text: 'Tên học viên là Mai', final: true };
    f.state.onEvent(final); f.state.onEvent(final);
    assert.deepEqual(f.state.transcripts, [final.text]);
    f.state.onEvent({ ...final, text: 'Conflicting transcript' }); await tick();
    assert.deepEqual(f.state.transcripts, [final.text]); assert.equal(f.voice.getState().status, 'error'); assert.equal(f.state.closes, 1);
});
test('denied admission never opens microphone; microphone denial closes the prepared handle', async () => {
    const first = fixture(); first.state.prepare = async () => { throw Error('not admitted'); };
    await assert.rejects(first.voice.start(), /not admitted/); assert.equal(first.state.captures, 0);
    const second = fixture(); second.state.capture = async () => { throw Error('microphone denied'); };
    await assert.rejects(second.voice.start(), /microphone denied/); assert.equal(second.state.closes, 1); assert.equal(second.voice.getState().status, 'error');
});
test('stop during microphone prompt closes late media without connecting or publishing transcripts', async () => {
    const f = fixture(); let release;
    f.state.capture = () => new Promise(resolve => { release = resolve; });
    const start = f.voice.start(); while (!release) await new Promise(resolve => setImmediate(resolve));
    await f.voice.stop(); release(f.stream); await start;
    assert.equal(f.state.stops, 1); assert.equal(f.state.closes, 1); assert.equal(f.state.onEvent, undefined);
    assert.equal(f.voice.getState().status, 'idle');
});
test('account switch and transport disconnect release tracks and require explicit restart', async () => {
    const f = fixture(); await f.voice.start(); f.state.uid = 'staff2'; await f.voice.syncIdentity();
    assert.equal(f.state.stops, 1); assert.equal(f.voice.getState().transcript, '');
    f.state.onEvent({ type: 'transcript', text: 'old account', final: true }); assert.equal(f.state.transcripts.length, 0);
    await f.voice.start(); f.state.onEvent({ type: 'disconnected' });
    assert.equal(f.voice.getState().status, 'disconnected'); assert.equal(f.state.stops, 2);
    assert.equal(f.state.captures, 2, 'no automatic reconnect');
});
test('account changes during pending permission close both late media and prepared transport', async () => {
    const f = fixture(); let release;
    f.state.capture = () => new Promise(resolve => { release = resolve; });
    const starting = f.voice.start(); while (!release) await new Promise(resolve => setImmediate(resolve));
    f.state.uid = 'staff2'; release(f.stream); await starting;
    assert.equal(f.state.stops, 1); assert.equal(f.state.closes, 1); assert.equal(f.voice.getState().status, 'idle');
});

test('finish speaking flushes once then keeps connection for reply and explicit next turn', async () => {
    const f = fixture(); let release, ends = 0;
    f.handle.endInput = () => { ends++; return new Promise(resolve => { release = resolve; }); };
    await f.voice.start(); assert.equal(f.voice.getState().canFinish, true);
    const finishing = f.voice.finishSpeaking(); const duplicate = f.voice.finishSpeaking();
    await tick(); assert.equal(ends, 1); assert.equal(f.voice.getState().status, 'finishing');
    assert.equal(f.state.stops, 0, 'capture remains owned by transport until its flush completes');
    await assert.rejects(f.voice.start(), /already active/);
    release(); await Promise.all([finishing, duplicate]);
    assert.equal(f.state.stops, 1); assert.equal(f.state.closes, 0); assert.equal(f.voice.getState().status, 'waiting_reply');
    f.voice.setMuted(false); await f.voice.interrupt(); assert.equal(f.state.interrupts, 1);
    f.state.onEvent({ type: 'transcript', utteranceId: 'finished1', text: 'Tạo yêu cầu tư vấn cho Lan', final: true });
    assert.deepEqual(f.state.transcripts, ['Tạo yêu cầu tư vấn cho Lan']);
    f.state.onEvent({ type: 'turn_complete' }); assert.equal(f.voice.getState().status, 'reply_ready');
    assert.equal(f.state.closes, 0); assert.equal(f.state.captures, 1);
    const oldEvent = f.state.onEvent; await f.voice.start();
    assert.equal(f.state.closes, 1); assert.equal(f.state.captures, 2); assert.equal(f.voice.getState().status, 'listening');
    oldEvent({ type: 'transcript', utteranceId: 'late', text: 'Old request', final: true }); assert.equal(f.state.transcripts.length, 1);
    await f.voice.stop();
});

test('turn completion during input flush survives the eventual flush acknowledgement', async () => {
    const f = fixture(); let release;
    f.handle.endInput = () => new Promise(resolve => { release = resolve; });
    await f.voice.start(); const finishing = f.voice.finishSpeaking(); await tick();
    f.state.onEvent({ type: 'turn_complete' });
    f.state.onEvent({ type: 'transcript', utteranceId: 'early-final', text: 'Tạo yêu cầu mới', final: true });
    release(); await finishing;
    assert.equal(f.voice.getState().status, 'reply_ready'); assert.equal(f.state.closes, 0); await f.voice.stop();
});

test('model reply completion alone waits for trusted final user transcription before another turn', async () => {
    const f = fixture(); f.handle.endInput = async () => {};
    await f.voice.start(); await f.voice.finishSpeaking();
    f.state.onEvent({ type: 'turn_complete' }); assert.equal(f.voice.getState().status, 'waiting_reply');
    f.state.onEvent({ type: 'transcript', utteranceId: 'asr1', text: 'Partial', final: false });
    assert.equal(f.voice.getState().status, 'waiting_reply'); await assert.rejects(f.voice.start(), /already active/);
    f.state.onEvent({ type: 'transcript', utteranceId: 'asr1', text: 'Tạo khách hàng Lan', final: true });
    assert.equal(f.voice.getState().status, 'reply_ready'); assert.deepEqual(f.state.transcripts, ['Tạo khách hàng Lan']);
    await f.voice.stop();
});

test('cancel and changed identity during finish fence late acknowledgement and require explicit restart', async () => {
    for (const mode of ['cancel', 'identity']) {
        const f = fixture(); let release;
        f.handle.endInput = () => new Promise(resolve => { release = resolve; });
        await f.voice.start(); const finishing = f.voice.finishSpeaking(); await tick();
        if (mode === 'cancel') await f.voice.stop(); else { f.state.uid = 'staff2'; await f.voice.syncIdentity(); }
        release(); await finishing;
        assert.equal(f.voice.getState().status, 'idle'); assert.equal(f.state.closes, 1); assert.equal(f.state.captures, 1);
    }
});

test('flush failure closes capture without automatic retry, while legacy transport has no finish capability', async () => {
    const f = fixture(); f.handle.endInput = async () => { throw Error('flush failed'); };
    await f.voice.start(); await assert.rejects(f.voice.finishSpeaking(), /flush failed/);
    assert.equal(f.voice.getState().status, 'error'); assert.equal(f.state.closes, 1); assert.equal(f.state.captures, 1);
    const legacy = fixture(); await legacy.voice.start(); assert.equal(legacy.voice.getState().canFinish, false);
    await assert.rejects(legacy.voice.finishSpeaking(), /unavailable/i); assert.equal(legacy.voice.getState().status, 'listening'); await legacy.voice.stop();
});

test('trusted confirmation during flush takes precedence over both late acknowledgement and failure', async () => {
    for (const failure of [false, true]) {
        let finishSave, finishInput, failInput;
        const f = fixture(() => new Promise(resolve => { finishSave = resolve; }));
        f.handle.endInput = () => new Promise((resolve, reject) => { finishInput = resolve; failInput = reject; });
        await f.voice.start(); const finishing = f.voice.finishSpeaking(); await tick();
        f.state.onEvent(confirmation); await tick();
        if (failure) failInput(Error('flush canceled by confirmation')); else finishInput();
        await finishing; assert.equal(f.voice.getState().status, 'confirming'); assert.equal(f.state.closes, 0);
        finishSave({ status: 'committed' }); await tick(); assert.equal(f.voice.getState().status, 'saved'); assert.equal(f.state.closes, 1);
    }
});

test('only final user transcripts carry an immutable current actor and cancellation signal into drafting', async () => {
    const f = fixture(); await f.voice.start();
    f.state.onEvent({ type: 'assistant_text', text: 'Create a record', final: true });
    f.state.onEvent({ type: 'transcript', text: 'Partial', final: false }); assert.equal(f.state.transcriptContext, undefined);
    f.state.onEvent({ type: 'transcript', utteranceId: 'captured1', text: 'Tạo Lan', final: true });
    const identity = f.state.transcriptContext;
    assert.equal(identity.actorUid, 'staff1'); assert.equal(identity.utteranceId, 'captured1');
    assert.equal(Object.isFrozen(identity), true); assert.equal(identity.signal.aborted, false);
    await f.voice.stop(); assert.equal(identity.signal.aborted, true);
});

test('accepted spoken drafting retires the completed socket without canceling its operation; stale socket events cannot save', async () => {
    let finish, signal, calls = 0;
    const f = fixture(async () => { throw Error('Must not confirm from a retired socket'); }, { retireOnFinal: true, onTranscript: async (_text, context) => {
        calls++; signal = context.signal; assert.equal(f.state.closes, 1); assert.equal(signal.aborted, false);
        await new Promise(resolve => { finish = resolve; });
    } });
    await f.voice.start(); f.state.onEvent({ type: 'transcript', utteranceId: 'order1', text: 'Tạo Lan', final: true }); await tick();
    assert.equal(f.voice.getState().status, 'processing_instruction'); assert.equal(f.state.stops, 1);
    f.state.onEvent({ type: 'disconnected' }); f.state.onEvent(confirmation); f.state.onEvent({ type: 'transcript', utteranceId: 'order2', text: 'Unexpected second order', final: true });
    assert.equal(signal.aborted, false); assert.equal(calls, 1); await assert.rejects(f.voice.start(), /already active/);
    finish(); await tick(); assert.equal(f.voice.getState().status, 'instruction_ready');
    await f.voice.start(); assert.equal(signal.aborted, true); assert.equal(f.state.closes, 1); await f.voice.stop();
});

test('explicit stop during accepted drafting still cancels its independent operation and fences completion', async () => {
    let finish, signal;
    const f = fixture(undefined, { retireOnFinal: true, onTranscript: (_text, context) => { signal = context.signal; return new Promise(resolve => { finish = resolve; }); } });
    await f.voice.start(); f.state.onEvent({ type: 'transcript', utteranceId: 'order1', text: 'Tạo Lan', final: true }); await tick();
    await f.voice.stop(); assert.equal(signal.aborted, true); finish(); await tick(); assert.equal(f.voice.getState().status, 'idle');
});

test('intentional socket retirement during final connection setup does not cancel an accepted instruction', async () => {
    let accepted = 0;
    const f = fixture(undefined, { retireOnFinal: true, onTranscript: async (_text, context) => { assert.equal(context.signal.aborted, false); accepted++; } });
    f.handle.connect = async ({ onEvent }) => { onEvent({ type: 'transcript', utteranceId: 'early', text: 'Tạo Lan', final: true }); throw Error('Connection retired by accepted instruction'); };
    await f.voice.start(); await tick(); assert.equal(accepted, 1); assert.equal(f.voice.getState().status, 'instruction_ready'); await f.voice.stop();
});
