'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
function setup(transport = {}, onConfirmation, onSpokenInstruction) {
    const state = { starts: 0, stops: 0, finishes: 0, muted: false }, all = [];
    const doc = { createElement(tag) { const el = { tag, children: [], listeners: {}, style: {}, setAttribute(k,v) { this[k] = v; }, append(...items) { this.children.push(...items); }, replaceChildren(...items) { this.children = items; }, addEventListener(k,v) { this.listeners[k] = v; } }; all.push(el); return el; } };
    const host = doc.createElement('div'); host.ownerDocument = doc;
    const instruction = { value: 'Already typed' }, options = {};
    const voice = { getState: () => ({ status: 'idle' }), start: async () => { state.starts++; }, finishSpeaking: async () => { state.finishes++; }, stop: async () => { state.stops++; }, setMuted: value => { state.muted = value; }, interrupt: async () => {}, syncIdentity: async () => {} };
    const scope = { window: { CrmDataInputVoice: { createSession(value) { Object.assign(options, value); return voice; } } }, navigator: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../../public/js/crm/data-input/voice-panel.js'), 'utf8'), scope);
    const panel = scope.window.CrmDataInputVoicePanel.createPanel({ host, instruction, transport, getUid: () => 'staff1', perform: fn => fn(), canStart: () => true, onConfirmation, onSpokenInstruction });
    return { state, host, instruction, options, panel, all };
}
test('voice panel is unavailable without an injected transport and does not request microphone', () => {
    const f = setup(null); assert.equal(f.host.hidden, true); assert.equal(f.options.getUserMedia, undefined);
});

test('response mute is labelled honestly and disabled for the remainder of the turn', () => {
    const f = setup(); f.options.onChange({ status: 'waiting_reply', responseMuted: true });
    const control = f.all.find(el => el.tag === 'button' && el.textContent === 'Response muted');
    assert.equal(control.disabled, true); assert.match(control.title, /Processing and usage accounting continue/);
    f.options.onChange({ status: 'listening', responseMuted: false });
    assert.equal(control.textContent, 'Mute response'); assert.equal(control.disabled, false);
});

test('confirmation-enabled panel forwards the trusted callback and shows capture-off pending save controls', () => {
    const callback = async () => ({ status: 'committed' }), f = setup({}, callback);
    assert.equal(f.options.onConfirmation, callback);
    f.options.onChange({ status: 'confirming', muted: false, transcript: '' });
    const button = title => f.all.find(el => el.tag === 'button' && el.textContent === title);
    assert.equal(button('Start voice').disabled, true); assert.equal(button('Stop voice').disabled, false);
    assert.equal(button('Mute microphone').disabled, true); assert.equal(button('Mute response').disabled, true);
    assert.match(f.all.find(el => el.role === 'status').textContent, /Microphone off.*save/);
    assert.equal(f.all.some(el => el.textContent?.includes('Voice does not confirm a save here')), false);
    f.options.onChange({ status: 'saved', muted: false, transcript: '' });
    assert.match(f.all.find(el => el.role === 'status').textContent, /saved/);
});
test('final transcripts preserve typed corrections and controls explicitly start and stop', async () => {
    const f = setup(); assert.equal(f.state.starts, 0);
    f.options.onTranscript('New spoken detail'); assert.equal(f.instruction.value, 'Already typed\nNew spoken detail');
    f.options.onChange({ status: 'listening', muted: false, transcript: 'partial', error: null });
    assert.equal(f.instruction.value, 'Already typed\nNew spoken detail');
    const button = title => f.all.find(el => el.tag === 'button' && el.textContent === title);
    await button('Start voice').listeners.click(); assert.equal(f.state.starts, 1);
    await button('Mute microphone').listeners.click(); assert.equal(f.state.muted, true);
    await f.panel.stop(); assert.equal(f.state.stops, 1);
    f.panel.dispose(); f.options.onTranscript('late'); assert.equal(f.instruction.value, 'Already typed\nNew spoken detail');
});

test('finish speaking controls show capture and reply states without closing or automatically restarting', async () => {
    const f = setup(), button = title => f.all.find(el => el.tag === 'button' && el.textContent === title);
    assert.equal(button('Finish speaking').hidden, true);
    f.options.onChange({ status: 'listening', canFinish: true, muted: false });
    assert.equal(button('Finish speaking').hidden, false); assert.equal(button('Finish speaking').disabled, false);
    await button('Finish speaking').listeners.click(); assert.equal(f.state.finishes, 1); assert.equal(f.state.stops, 0);
    for (const status of ['finishing', 'waiting_reply']) {
        f.options.onChange({ status, canFinish: true, muted: false });
        assert.equal(button('Start voice').disabled, true); assert.equal(button('Finish speaking').disabled, true);
        assert.equal(button('Stop voice').disabled, false); assert.equal(button('Mute microphone').disabled, true);
    }
    assert.match(f.all.find(el => el.role === 'status').textContent, /Microphone off.*reply/i);
    assert.equal(button('Mute response').disabled, false);
    f.options.onChange({ status: 'reply_ready', canFinish: true, muted: false });
    assert.equal(button('Start voice').disabled, false); assert.equal(button('Stop voice').disabled, false);
    assert.equal(f.state.starts, 0); f.panel.dispose();
});

test('automatic spoken instruction preserves typed corrections and forwards the original operation context', async () => {
    let received;
    const f = setup({}, undefined, async (text, identity) => { received = { text, identity }; });
    assert.equal(f.options.retireOnFinal, true);
    const identity = { actorUid: 'staff1', signal: new AbortController().signal };
    await f.options.onTranscript('Tạo yêu cầu cho Lan', identity);
    assert.equal(received.text, 'Already typed\nTạo yêu cầu cho Lan'); assert.equal(received.identity, identity);
    assert.equal(f.instruction.value, received.text); assert.equal(f.state.starts, 0);
    f.options.onChange({ status: 'processing_instruction', canFinish: false });
    const button = title => f.all.find(el => el.tag === 'button' && el.textContent === title);
    assert.equal(button('Start voice').disabled, true); assert.equal(button('Stop voice').disabled, false);
    f.options.onChange({ status: 'instruction_ready', canFinish: false }); assert.equal(button('Start voice').disabled, false);
    f.panel.dispose(); await f.options.onTranscript('Late text', identity); assert.equal(received.text, 'Already typed\nTạo yêu cầu cho Lan');
});
