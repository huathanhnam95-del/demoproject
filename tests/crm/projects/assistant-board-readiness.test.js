'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
let JSDOM;
for (const specifier of (process.env.CRM_TEST_JSDOM ? [process.env.CRM_TEST_JSDOM] : ['jsdom', '../../../test-dom/node_modules/jsdom'])) { try { JSDOM = require(specifier).JSDOM; break; } catch (_) {} }
const source = fs.readFileSync(process.env.ASSISTANT_SOURCE || require('node:path').join(__dirname, '../../../public/js/crm/projects/assistant.js'), 'utf8');
const tick = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
const deferred = () => { let resolve; return { promise: new Promise(done => { resolve = done; }), resolve: value => resolve(value) }; };
function fixture(options = {}) {
    let ready = true;
    let user = { uid: 'u', getIdToken: async () => 'token' }, context = { projectId: 'p', view: 'board', selectedTaskIds: ['t1', 't2'] }, handler, sink, count = 0;
    const calls = [], lifecycle = [], storage = new Map(), listeners = {};
    const dom = JSDOM ? new JSDOM('<main id="assistant"></main>') : null;
    const root = dom ? dom.window.document.getElementById('assistant') : { innerHTML: '', querySelector: () => null,
        querySelectorAll() { return [...this.innerHTML.matchAll(/data-assistant-action="([^"]+)"/g)].map(match => ({dataset:{assistantAction:match[1]},set disabled(value) {const pattern=new RegExp('(data-assistant-action="'+match[1]+'")\\s*(?:disabled)?');root.innerHTML=root.innerHTML.replace(pattern, '$1'+(value?' disabled':' '));}})); } };
    root.addEventListener = (key, value) => { listeners[key] = value; };
    root.removeEventListener = key => { delete listeners[key]; };
    const draft = { draftId: 'd', status: 'active', revision: 1, actions: [{ actionId: 'a1', kind: 'field_update', taskId: 't1', patch: { title: 'One' } }, { actionId: 'a2', kind: 'field_update', taskId: 't2', patch: { title: 'Two' } }] };
    handler = async url => url.endsWith('/config') ? { voiceAvailable: true, relayUrl: 'http://localhost', engineeringOnly: true, nativePaidAvailable: false } : url.endsWith('/preview') ? { previewId: 'v', actions: draft.actions } : url.endsWith('/apply') ? { success: true } : url.includes('/proposals') ? { kind: 'task_draft', draft } : { draft };
    const sandbox = { AbortController, crypto: { randomUUID: () => `r${++count}` }, sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) }, navigator: { mediaDevices: { getUserMedia: async () => { lifecycle.push('microphone'); return { getTracks: () => [{ stop: () => lifecycle.push('track-stop') }] }; } } } };
    vm.runInNewContext(source, sandbox);
    let prepare = async () => { lifecycle.push('prepare'); return { connect: async ({ onEvent }) => { sink = onEvent; lifecycle.push('connect'); } }; };
    const transportFactory = transportOptions => ({ prepare: args => prepare(args, transportOptions), endInput: async () => { lifecycle.push('end-input'); await options.endInput?.(); }, close: async () => { lifecycle.push('close'); }, updateContext: async () => lifecycle.push('context'), interrupt: () => { lifecycle.push('interrupt'); return options.interrupt?.(); } });
    const controller = sandbox.CrmProjectsAssistant.createController({ root, apiFetchJson: async (url, options) => { const body = options?.body && JSON.parse(options.body); calls.push({ url, body }); return handler(url, body); }, getCurrentUser: () => user, getContext: () => context, isProjectReady: () => ready, transportFactory, onApplied: async result => { lifecycle.push('applied'); await options.onApplied?.(controller, result); }, onAutomationDraft: options.onAutomationDraft, onUsageChanged: options.onUsageChanged });
    const click = async key => { listeners.click({ target: { closest: () => ({ dataset: { assistantAction: key } }) } }); await tick(); };
    const input = (value, correction = false) => listeners.input({ target: { value, matches: selector => selector === (correction ? '[data-assistant-correction]' : '[data-assistant-instruction]') } });
    return { readiness(value) { ready = value; controller.setContext(); }, controller, root, calls, lifecycle, storage, draft, click, input, emit: event => sink(event), handler: value => { handler = value; }, prepare: value => { prepare = value; }, user: value => { user = value; }, context: value => { context = value; }, sandbox };
}
async function readyDraft(f) { await f.controller.init(); f.input('Change these tasks'); await f.click('draft'); await f.click('preview'); }
test('pending existing-board readiness blocks action dispatch and preview without clearing stable context, draft or preview', async () => {
    const f = fixture(); await readyDraft(f); const before = f.controller.getState(), count = f.calls.length;
    f.readiness(false);
    for (const action of ['plan','draft','automation','correct','preview','restore','decline','start']) await f.click(action);
    assert.equal(f.calls.length, count); assert.equal(f.controller.getState().preview.previewId, before.preview.previewId);
    assert.deepEqual(f.controller.getState().context, before.context); assert.deepEqual(f.controller.getState().draft, before.draft);
    for (const action of ['plan','draft','automation','correct','preview','start']) assert.match(f.root.innerHTML, new RegExp(`data-assistant-action="${action}" disabled`));
    f.readiness(true); assert.doesNotMatch(f.root.innerHTML, /data-assistant-action="preview" disabled/);
    assert.equal(f.calls.length,count); await f.click('preview'); assert.equal(f.calls.length,count+1);
    const held=deferred();f.handler(()=>held.promise);await f.click('plan');
    f.readiness(false);f.readiness(true);assert.equal(f.controller.getState().busy,true);
    for(const action of ['plan','preview','start']) assert.match(f.root.innerHTML,new RegExp(`data-assistant-action="${action}" disabled`));
    held.resolve({kind:'planning',text:'Ready'});await tick();assert.equal(f.controller.getState().busy,false);
});
test('active voice and usage accounting survive pending-ready transition; pending proof is consumed and never replayed', async () => {
    let usage=0; const f=fixture({onUsageChanged:()=>usage++}); await readyDraft(f); await f.click('start');
    const before=f.controller.getState(), lifecycle=f.lifecycle.slice(), previousUsage=usage, count=f.calls.length;
    f.readiness(false); f.emit({type:'confirmation_ready',attestationId:'blocked-proof'}); await tick();
    assert.equal(f.calls.length,count); assert.equal(f.controller.getState().voiceActive,true); assert.equal(f.controller.getState().preview.previewId,'v');
    assert.deepEqual(f.controller.getState().context,before.context); assert.deepEqual(f.lifecycle,lifecycle); assert.equal(usage,previousUsage);
    f.readiness(true); await tick(); f.emit({type:'confirmation_ready',attestationId:'blocked-proof'}); await tick();
    assert.equal(f.calls.length,count); assert.equal(f.controller.getState().voiceActive,true); assert.equal(usage,previousUsage);
    f.emit({type:'confirmation_ready',attestationId:'fresh-proof'}); await tick();
    assert.equal(f.calls.filter(call=>call.url.endsWith('/apply')).length,1); assert.equal(f.calls.at(-1).body.attestationId,'fresh-proof');
});
test('final transcript during pending readiness retains instruction but never schedules proposals on recovery', async () => {
    const f=fixture(); await f.controller.init(); await f.click('start'); const count=f.calls.length;
    f.readiness(false); f.emit({type:'transcript',utteranceId:'pending-text',text:'Change the title',final:true});
    f.readiness(true); await tick(); await tick();
    assert.equal(f.calls.length,count); assert.equal(f.controller.getState().instruction,'Change the title'); assert.equal(f.controller.getState().voiceActive,true);
    f.emit({type:'transcript',utteranceId:'pending-text',text:'Change the title',final:true}); await tick(); assert.equal(f.calls.length,count);
});
test('new-project mode remains available while existing board is pending and actor changes still deny late proof', async () => {
    const f=fixture(); await f.controller.init(); f.readiness(false); await f.click('creation'); f.input('Create a project'); await f.click('draft'); await f.click('preview'); await f.click('start');
    assert.equal(f.controller.getState().context.mode,'create_project'); assert.equal(f.controller.getState().voiceActive,true);
    const proposal=f.calls.find(call=>call.url.endsWith('/proposals')); assert.deepEqual(proposal.body.contextHints,{mode:'create_project'});
    f.emit({type:'confirmation_ready',attestationId:'new-project-proof'}); await tick(); assert.equal(f.calls.filter(call=>call.url.endsWith('/apply')).length,1);
    f.user(null); f.controller.syncIdentity(); await f.click('creation'); await f.click('draft'); assert.equal(f.calls.filter(call=>call.url.endsWith('/proposals')).length,1);
});
test('real context denial still clears private context and retires active voice', async () => {
    const f=fixture();await readyDraft(f);await f.click('start');f.readiness(false);f.context({projectId:'',selectedTaskIds:[]});f.controller.setContext();
    f.emit({type:'confirmation_ready',attestationId:'denied-proof'});await tick();
    assert.equal(f.controller.getState().draft,null);assert.equal(f.controller.getState().preview,null);assert.equal(f.controller.getState().voiceActive,false);assert.equal(f.calls.some(call=>call.url.endsWith('/apply')),false);
});
test('readiness lost during voice preparation cannot open the microphone', async () => {
    const f=fixture();await readyDraft(f);const held=deferred();f.prepare(()=>held.promise);await f.click('start');f.readiness(false);held.resolve({connect:async()=>assert.fail('pending connect')});await tick();
    assert.equal(f.lifecycle.includes('microphone'),false);assert.equal(f.controller.getState().preview.previewId,'v');assert.ok(f.lifecycle.includes('close'));
});
test('admin readiness accessor validates board authorization and current actor without changing context hints', () => {
    const admin=fs.readFileSync(process.env.ADMIN_SOURCE || require('node:path').join(__dirname,'../../../public/crm-admin.js'),'utf8');
    const start=admin.indexOf('    function projectsAssistantReady() {'), end=admin.indexOf('    let projectsAssistantFingerprint',start);
    assert.ok(start>=0 && end>start,'admin supplies a separate readiness accessor');
    let board={actorUid:'u',authorizationReady:true,project:{id:'p'}}, user={uid:'u'};
    const sandbox={projectsBoardController:{getSnapshot:()=>board},window:{firebase:{auth:()=>({currentUser:user})}}};
    vm.runInNewContext(admin.slice(start,end)+';this.ready = projectsAssistantReady;',sandbox);
    const wiringStart=admin.indexOf('    window.projectsAssistantController = window.CrmProjectsAssistant?.createController({');
    const wiringEnd=admin.indexOf('    window.projectsAssistantController?.init();',wiringStart);
    let configured; sandbox.window.CrmProjectsAssistant={createController:options=>{configured=options;return {};}};
    sandbox.document={getElementById:()=>({})};sandbox.apiFetchJson=()=>{};sandbox.projectsAssistantHints=()=>({projectId:'p',selectedTaskIds:['t1']});
    vm.runInNewContext(admin.slice(wiringStart,wiringEnd),sandbox);
    assert.equal(configured.isProjectReady(),true);assert.deepEqual(configured.getContext(),{projectId:'p',selectedTaskIds:['t1']});
    assert.equal(sandbox.ready(),true);board.authorizationReady=false;assert.equal(sandbox.ready(),false);board.authorizationReady=true;user={uid:'other'};assert.equal(sandbox.ready(),false);user={uid:'u'};board.project=null;assert.equal(sandbox.ready(),false);
});
test('actual DOM instruction node, active focus and caret survive readiness-only pending and ready notifications', async () => {
    assert.ok(JSDOM, 'Required DOM verification dependency missing: install external jsdom and set CRM_TEST_JSDOM to its absolute module path, or use run-focused.ps1.');
    const f=fixture(); await readyDraft(f); await f.click('start');
    const editor=f.root.querySelector('[data-assistant-instruction]');
    editor.value='Keep this instruction and caret'; f.input(editor.value); editor.focus(); editor.setSelectionRange(5,14,'backward');
    const doc=editor.ownerDocument, preview=f.controller.getState().preview.previewId, lifecycle=f.lifecycle.slice();
    for (const ready of [false,true,false,true]) {
        f.readiness(ready);
        assert.equal(f.root.querySelector('[data-assistant-instruction]'),editor);
        assert.equal(doc.activeElement,editor); assert.equal(editor.selectionStart,5); assert.equal(editor.selectionEnd,14); assert.equal(editor.selectionDirection,'backward');
        assert.equal(editor.value,'Keep this instruction and caret'); assert.equal(f.controller.getState().preview.previewId,preview);
        assert.equal(f.root.querySelector('[data-assistant-action="preview"]').disabled,!ready);
        assert.equal(f.root.querySelector('[data-assistant-action="start"]').disabled,true);
    }
    assert.deepEqual(f.lifecycle,lifecycle); assert.equal(f.controller.getState().voiceActive,true);
});
