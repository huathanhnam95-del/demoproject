'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../../../public/js/crm/projects/assistant.js'), 'utf8');
const tick = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
const deferred = () => { let resolve; return { promise: new Promise(done => { resolve = done; }), resolve: value => resolve(value) }; };
function fixture(options = {}) {
    let user = { uid: 'u', getIdToken: async () => 'token' }, context = { projectId: 'p', view: 'board', selectedTaskIds: ['t1', 't2'] }, handler, sink, count = 0;
    const calls = [], lifecycle = [], storage = new Map(), listeners = {};
    const root = { innerHTML: '', querySelector: () => null, addEventListener: (key, value) => { listeners[key] = value; }, removeEventListener: key => { delete listeners[key]; } };
    const draft = { draftId: 'd', status: 'active', revision: 1, actions: [{ actionId: 'a1', kind: 'field_update', taskId: 't1', patch: { title: 'One' } }, { actionId: 'a2', kind: 'field_update', taskId: 't2', patch: { title: 'Two' } }] };
    handler = async url => url.endsWith('/config') ? { voiceAvailable: true, relayUrl: 'http://localhost', engineeringOnly: true, nativePaidAvailable: false } : url.endsWith('/preview') ? { previewId: 'v', actions: draft.actions } : url.endsWith('/apply') ? { success: true } : url.includes('/proposals') ? { kind: 'task_draft', draft } : { draft };
    const sandbox = { AbortController, crypto: { randomUUID: () => `r${++count}` }, sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) }, navigator: { mediaDevices: { getUserMedia: async () => { lifecycle.push('microphone'); return { getTracks: () => [{ stop: () => lifecycle.push('track-stop') }] }; } } } };
    vm.runInNewContext(source, sandbox);
    let prepare = async () => { lifecycle.push('prepare'); return { connect: async ({ onEvent }) => { sink = onEvent; lifecycle.push('connect'); } }; };
    const transportFactory = transportOptions => ({ prepare: args => prepare(args, transportOptions), endInput: async () => { lifecycle.push('end-input'); await options.endInput?.(); }, close: async () => { lifecycle.push('close'); }, updateContext: async () => lifecycle.push('context'), interrupt: () => { lifecycle.push('interrupt'); return options.interrupt?.(); } });
    const controller = sandbox.CrmProjectsAssistant.createController({ root, apiFetchJson: async (url, options) => { const body = options?.body && JSON.parse(options.body); calls.push({ url, body }); return handler(url, body); }, getCurrentUser: () => user, getContext: () => context, transportFactory, onApplied: async result => { lifecycle.push('applied'); await options.onApplied?.(controller, result); }, onAutomationDraft: options.onAutomationDraft, onUsageChanged: options.onUsageChanged });
    const click = async key => { listeners.click({ target: { closest: () => ({ dataset: { assistantAction: key } }) } }); await tick(); };
    const input = (value, correction = false) => listeners.input({ target: { value, matches: selector => selector === (correction ? '[data-assistant-correction]' : '[data-assistant-instruction]') } });
    return { controller, root, calls, lifecycle, storage, draft, click, input, emit: event => sink(event), handler: value => { handler = value; }, prepare: value => { prepare = value; }, user: value => { user = value; }, context: value => { context = value; }, sandbox };
}
async function readyDraft(f) { await f.controller.init(); f.input('Change these tasks'); await f.click('draft'); await f.click('preview'); }
test('usage refresh follows proposals, failures and voice closure while fencing old accounts', async () => {
    let count = 0;
    const f = fixture({ onUsageChanged: () => { count++; } }); await readyDraft(f); assert.ok(count >= 2);
    await f.click('start'); const before = count; await f.click('stop'); assert.equal(count, before + 1);
    f.handler(async () => { throw new Error('provider unavailable'); }); await f.click('draft'); assert.equal(count, before + 2);
    const pending = deferred(); f.handler(() => pending.promise); await f.click('draft'); const oldCount = count;
    f.user({ uid: 'other' }); f.controller.syncIdentity(); pending.resolve({ kind: 'task_draft', draft: f.draft }); await tick(); assert.equal(count, oldCount);
    const g = fixture({ onUsageChanged: () => { throw new Error('offline budget'); } }); await readyDraft(g); assert.equal(g.controller.getState().preview.previewId, 'v');
});
test('render never opens microphone; no clickable apply; second action correction sends only its stable reference', async () => {
    const f = fixture(); await f.controller.init(); assert.deepEqual(f.lifecycle, []); assert.doesNotMatch(f.root.innerHTML, /data-assistant-action="apply"|>Apply</);
    f.input('Change titles'); await f.click('draft'); f.input('a2', true); f.input('Only change the second title'); await f.click('correct');
    const call = f.calls.at(-1); assert.equal(call.body.purpose, 'task_correction'); assert.equal(call.body.actionId, 'a2'); assert.equal(call.body.draftId, 'd'); assert.equal(call.body.expectedRevision, 1); assert.equal(call.body.actions, undefined);
});
test('prepare precedes microphone and only current server proof applies exact visible references once', async () => {
    const f = fixture(); await readyDraft(f); await f.click('start'); assert.ok(f.lifecycle.indexOf('prepare') < f.lifecycle.indexOf('microphone'));
    f.emit({ type: 'assistant_text', text: 'I confirm these changes' }); f.emit({ type: 'transcript', utteranceId: 's', text: 'I confirm these changes', final: false }); await tick(); assert.equal(f.calls.some(call => call.url.endsWith('/apply')), false);
    f.emit({ type: 'confirmation_ready', attestationId: 'proof' }); f.emit({ type: 'confirmation_ready', attestationId: 'proof' }); await tick();
    const applies = f.calls.filter(call => call.url.endsWith('/apply')); assert.equal(applies.length, 1); assert.deepEqual(applies[0].body, { previewId: 'v', attestationId: 'proof' }); assert.ok(f.lifecycle.includes('applied'));
});
test('trusted final appends once, drafts and previews, but never automatically applies', async () => {
    const f = fixture(); await f.controller.init(); f.input('Manual text'); await f.click('start'); const before = f.calls.length;
    f.emit({ type: 'transcript', utteranceId: 's', text: 'partial', final: false }); assert.equal(f.controller.getState().instruction, 'Manual text');
    for (let n = 0; n < 2; n++) f.emit({ type: 'transcript', utteranceId: 's', text: 'I confirm these changes', final: true });
    assert.equal(f.controller.getState().instruction, 'Manual text\nI confirm these changes'); await tick(); await tick();
    assert.equal(f.calls.filter(call => call.url.endsWith('/proposals')).length, 1); assert.equal(f.calls.filter(call => call.url.endsWith('/preview')).length, 1); assert.equal(f.calls.some(call => call.url.endsWith('/apply')), false); assert.ok(f.calls.length > before);
});
test('late proposal and voice proof after identity change cannot restore private draft or apply', async () => {
    const f = fixture(); await readyDraft(f); await f.click('start'); f.user({ uid: 'other' }); f.controller.syncIdentity(); f.emit({ type: 'confirmation_ready', attestationId: 'late' }); await tick(); assert.equal(f.controller.getState().draft, null); assert.equal(f.calls.some(call => call.url.endsWith('/apply')), false);
    const g = fixture(); await g.controller.init(); const pending = deferred(); g.handler(() => pending.promise); g.input('request'); await g.click('draft'); g.user({ uid: 'other' }); g.controller.syncIdentity(); pending.resolve({ kind: 'task_draft', draft: g.draft }); await tick(); assert.equal(g.controller.getState().draft, null);
});
test('same context preserves preview; changed context invalidates proof while retaining draft', async () => {
    const f = fixture(); await readyDraft(f); f.controller.setContext(); assert.equal(f.controller.getState().preview.previewId, 'v'); await f.click('start');
    f.context({ projectId: 'p', view: 'timeline', selectedTaskIds: ['t2'] }); f.controller.setContext(); f.emit({ type: 'confirmation_ready', attestationId: 'old' }); await tick();
    assert.equal(f.controller.getState().preview, null); assert.equal(f.controller.getState().draft.draftId, 'd'); assert.equal(f.calls.some(call => call.url.endsWith('/apply')), false);
});
test('stale preparation never opens microphone; stop/dispose and disconnect preserve saved draft', async () => {
    const f = fixture(); await readyDraft(f); const wait = deferred(); f.prepare(() => wait.promise); await f.click('start'); await f.click('stop'); wait.resolve({ connect: async () => assert.fail('stale connect') }); await tick(); assert.equal(f.lifecycle.includes('microphone'), false); assert.equal(f.controller.getState().draft.draftId, 'd');
    const g = fixture(); await readyDraft(g); await g.click('start'); g.emit({ type: 'disconnected' }); await tick(); assert.equal(g.controller.getState().draft.draftId, 'd'); assert.ok(g.lifecycle.includes('track-stop')); const preparations = g.lifecycle.filter(item => item === 'prepare').length; await tick(); assert.equal(g.lifecycle.filter(item => item === 'prepare').length, preparations); g.controller.dispose(); assert.equal(g.root.innerHTML, '');
});

test('remote revision invalidation stops voice and rejects late proof while retaining draft and instructions', async () => {
    const f = fixture(); await readyDraft(f); await f.click('start'); f.controller.invalidatePreview(); f.emit({ type: 'confirmation_ready', attestationId: 'stale-remote' }); await tick();
    assert.equal(f.controller.getState().preview, null); assert.equal(f.controller.getState().draft.draftId, 'd'); assert.equal(f.controller.getState().instruction, 'Change these tasks'); assert.equal(f.calls.some(call => call.url.endsWith('/apply')), false);
});

test('relay context then disconnect clears visible preview without losing draft or instructions', async () => {
    const f = fixture(); await readyDraft(f); await f.click('start');
    f.emit({ type: 'context', contextRevision: 2, summary: 'Changed permissions' }); f.emit({ type: 'disconnected' }); await tick();
    assert.equal(f.controller.getState().preview, null); assert.equal(f.controller.getState().draft.draftId, 'd');
    assert.equal(f.controller.getState().instruction, 'Change these tasks');
});

test('proposal request retires voice before pending work; old proof is not consumed and fresh voice may confirm later', async () => {
    const f = fixture(); await readyDraft(f); await f.click('start'); const pending = deferred();
    f.handler(() => pending.promise); await f.click('plan');
    f.emit({ type: 'confirmation_ready', attestationId: 'busy-proof' }); await tick();
    assert.equal(f.controller.getState().voiceActive, false); assert.equal(f.calls.some(call => call.url.endsWith('/apply')), false);
    pending.resolve({ kind: 'planning', text: 'Plan' }); await tick();
    f.handler(async () => ({ success: true })); await f.click('start'); f.emit({ type: 'confirmation_ready', attestationId: 'busy-proof' }); await tick();
    assert.equal(f.calls.filter(call => call.url.endsWith('/apply')).length, 1);
});

test('committed response after relay context invalidation still refreshes the same authorized project', async () => {
    const f = fixture(); await readyDraft(f); await f.click('start'); const pending = deferred();
    f.handler(() => pending.promise); f.emit({ type: 'confirmation_ready', attestationId: 'committed-proof' }); await tick();
    f.emit({ type: 'context', contextRevision: 2 }); pending.resolve({ success: true }); await tick();
    assert.ok(f.lifecycle.includes('applied')); assert.equal(f.controller.getState().preview, null);
    assert.equal(f.controller.getState().draft.status, 'committed');
});
test('notices and actual schedule impact render safely; instruction length matches server bound', async () => {
    const f = fixture(); await f.controller.init(); assert.match(f.root.innerHTML, /<details >/); f.input('x'.repeat(9000)); assert.equal(f.controller.getState().instruction.length, 8000);
    f.handler(async url => url.endsWith('/proposals') ? { kind: 'task_draft', draft: f.draft, notices: ['Accountable owner: Mai', 'Next Thursday resolves to 2026-09-10.'] } : { previewId: 'v', actions: f.draft.actions, impact: { kind: 'fieldBatch', schedule: [{ taskId: 't2', startDate: '2026-09-09', dueDate: '2026-09-10', workingDayCount: 2, nonWorkingDays: [], warnings: [{ code: 'CALENDAR_INCOMPLETE' }] }] } });
    await f.click('draft'); await f.click('preview'); assert.match(f.root.innerHTML, /Accountable owner: Mai/); assert.match(f.root.innerHTML, /2026-09-10/); assert.match(f.root.innerHTML, /2 working days/); assert.match(f.root.innerHTML, /calendar incomplete/);
});
test('configuration response survives project loading but cannot cross account changes', async () => {
    const f = fixture(), config = deferred(); f.handler(() => config.promise); const loading = f.controller.init(); f.context({ projectId: 'loaded', selectedTaskIds: [] }); f.controller.setContext(); config.resolve({ voiceAvailable: true, relayUrl: 'http://localhost', engineeringOnly: true }); await loading; assert.doesNotMatch(f.root.innerHTML, /data-assistant-action="start" disabled/);
    const g = fixture(), old = deferred(), fresh = deferred(); let n = 0; g.handler(() => ++n === 1 ? old.promise : fresh.promise); const initial = g.controller.init(); g.user({ uid: 'new' }); g.controller.syncIdentity(); old.resolve({ voiceAvailable: true }); await initial; assert.match(g.root.innerHTML, /data-assistant-action="start" disabled/); fresh.resolve({ voiceAvailable: false }); await tick(); assert.match(g.controller.getState().status, /unavailable/);
});

test('successful apply restores committed status after board invalidation and hides unusable draft actions', async () => {
    const f = fixture({ onApplied: controller => controller.invalidatePreview() }); await readyDraft(f); await f.click('start');
    f.emit({ type: 'confirmation_ready', attestationId: 'refresh-proof' }); await tick(); await tick();
    assert.equal(f.controller.getState().status, 'Confirmed changes applied.'); assert.equal(f.controller.getState().draft.status, 'committed'); assert.equal(f.controller.getState().busy, false);
    assert.doesNotMatch(f.root.innerHTML, /data-assistant-action="(?:preview|correct|decline)"/); assert.match(f.root.innerHTML, /This draft has been committed/);
    const count = f.calls.length; for (const key of ['preview', 'correct', 'decline']) await f.click(key); assert.equal(f.calls.length, count);
});
test('post-apply refresh completion cannot overwrite account, project or replacement draft state', async () => {
    for (const change of ['account', 'project', 'draft']) {
        const refresh = deferred(); const f = fixture({ onApplied: controller => { controller.invalidatePreview(); return refresh.promise; } });
        await readyDraft(f); await f.click('start'); f.emit({ type: 'confirmation_ready', attestationId: `proof-${change}` }); await tick();
        if (change === 'account') { f.user({ uid: 'new-account' }); f.controller.syncIdentity(); }
        else if (change === 'project') { f.context({ projectId: 'new-project', view: 'board', selectedTaskIds: [] }); f.controller.setContext(); }
        else { f.handler(async () => ({ kind: 'task_draft', draft: { ...f.draft, draftId: 'new-draft' } })); await f.click('draft'); }
        await tick(); const before = f.controller.getState(); refresh.resolve(); await tick(); await tick();
        assert.equal(f.controller.getState().status, before.status); assert.equal(f.controller.getState().draft?.draftId, before.draft?.draftId); assert.notEqual(f.controller.getState().status, 'Confirmed changes applied.');
    }
});
test('automation editor refusal reports its retained draft instead of claiming the proposal opened', async () => {
    const f = fixture({ onAutomationDraft: async () => false }); await f.controller.init(); f.input('Propose a rule'); f.handler(async () => ({ kind: 'automation_draft', definition: { schemaVersion: 1 } })); await f.click('automation');
    assert.equal(f.controller.getState().status, 'Save the current automation draft before opening this proposal.');
});

test('failed apply closes the input-stopped voice connection while retaining the draft', async () => {
    const f = fixture(); await readyDraft(f); await f.click('start'); f.handler(async () => { throw new Error('Apply failed'); });
    f.emit({ type: 'confirmation_ready', attestationId: 'failed-apply' }); await tick(); await tick();
    assert.equal(f.controller.getState().voiceActive, false); assert.equal(f.controller.getState().draft.draftId, 'd'); assert.ok(f.lifecycle.includes('track-stop'));
});


test('Finish speaking sends one barrier and Stop retains cancellation ownership', async () => {
    const finishing = deferred(), f = fixture({ endInput: () => finishing.promise });
    await f.controller.init(); await f.click('start'); await f.click('finish'); await f.click('finish');
    assert.equal(f.lifecycle.filter(value => value === 'end-input').length, 1);
    assert.match(f.root.innerHTML, /data-assistant-action="finish" disabled/);
    await f.click('stop'); finishing.resolve(); await tick(); assert.equal(f.controller.getState().voiceActive, false);
});

test('explicit new-project mode uses no existing project and navigation retires it', async () => {
    const f = fixture(); await f.controller.init(); await f.click('creation'); assert.equal(f.controller.getState().context.mode, 'create_project'); f.input('Create a project named September'); await f.click('draft'); const proposal = f.calls.find(call => call.url.endsWith('/proposals')); assert.deepEqual(proposal.body.contextHints, { mode: 'create_project' }); f.context({ projectId: 'other', selectedTaskIds: [] }); f.controller.setContext(); assert.equal(f.controller.getState().context.projectId, 'other'); assert.equal(f.controller.getState().draft, null);
});

test('Mute response reports continuing processing, leaves confirmation intact and resets on new voice', async () => {
    const muted = deferred(), f = fixture({ interrupt: () => muted.promise }); await readyDraft(f); await f.click('start');
    assert.match(f.root.innerHTML, />Mute response</); const stops = f.lifecycle.filter(value => value === 'close').length;
    await f.click('interrupt'); assert.equal(f.controller.getState().responseAudioMuted, true); assert.match(f.controller.getState().status, /Response audio muted\. Processing continues\./);
    assert.equal(f.controller.getState().voiceActive, true); assert.equal(f.lifecycle.filter(value => value === 'close').length, stops); assert.equal(f.calls.some(call => call.url.endsWith('/apply')), false);
    await f.click('interrupt'); assert.equal(f.lifecycle.filter(value => value === 'interrupt').length, 1);
    f.emit({ type: 'interrupted', scope: 'response_audio' }); muted.resolve(); await tick();
    f.emit({ type: 'confirmation_ready', attestationId: 'spoken-proof' }); await tick(); await tick(); assert.equal(f.calls.filter(call => call.url.endsWith('/apply')).length, 1);
    await f.click('start'); assert.equal(f.controller.getState().responseAudioMuted, false); assert.equal(f.controller.getState().status, 'Voice connected.');
});

test('late mute failure cannot close a new voice turn or replace its status', async () => {
    let reject; const pending = new Promise((_resolve, no) => { reject = no; });
    const f = fixture({ interrupt: () => pending }); await f.controller.init(); await f.click('start'); await f.click('interrupt'); await f.click('stop'); await f.click('start');
    reject(Error('old connection')); await tick(); assert.equal(f.controller.getState().voiceActive, true); assert.equal(f.controller.getState().status, 'Voice connected.'); assert.equal(f.controller.getState().responseAudioMuted, false);
});

test('visible task creation preview includes owner, dates and canonical defaults', async () => {
    const f = fixture(); await f.controller.init(); const task = { title: 'Created', ownerUid: 'mai', assigneeUids: ['linh'], dueDate: '2026-09-15', values: { hours: 3 } }; const draft = { draftId: 'create', revision: 0, status: 'active', actions: [{ actionId: 'one', kind: 'create_task', task, sectionId: 's' }] };
    f.handler(url => url.endsWith('/proposals') ? { kind: 'task_draft', draft } : { previewId: 'pv', actions: draft.actions, impact: { command: 'createTask', task: { ...task, status: 'not_started', sectionId: 's' } } }); f.input('Create'); await f.click('draft'); await f.click('preview'); for (const value of ['mai', 'linh', '2026-09-15', 'hours', 'not_started']) assert.ok(f.root.innerHTML.includes(value), value);
});
