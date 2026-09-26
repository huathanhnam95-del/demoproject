'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
require('../../../public/js/crm/projects/automation-definition-editor');
const E = globalThis.CrmAutomationDefinitionEditor;
const copy = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function switchProject(h, id) { h.c.setSelection(id); h.c.setContext(h.snapshot({ project: { id, lifecycle: 'active' } })); }
const def = () => ({ schemaVersion: 1, trigger: { type: 'task_created' }, steps: [{ nodeId: 'step', type: 'set_field', payload: { target: 'trigger_task', patch: { status: 'done' } } }] });
const httpError = (status, code) => Object.assign(new Error(code), { status, payload: { success: false, error: code, message: code } });
function harness({ root } = {}) {
  let actor = 'u1', handler, refreshFailure = false;
  const calls = [], denied = [], refreshed = [], sandbox = { console, URLSearchParams, TextEncoder, Date, Map, Set, FormData: class {}, CrmAutomationDefinitionEditor: E };
  for (const file of ['automations-renderer.js', 'automations.js']) vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../../public/js/crm/projects', file), 'utf8'), sandbox);
  const rule = { ruleId: 'r1', projectId: 'p1', title: 'Rule', folder: '', enabled: false, revision: 1, currentVersion: 'v1' };
  const version = { versionId: 'v1', actorUid: 'u2', definition: def() };
  handler = async (url, options) => {
    const body = options?.body ? JSON.parse(options.body) : {};
    if (url.includes('/tasks?')) return { tasks: [{ id: 't1', title: 'Sample' }], hasMore: false };
    if (url.endsWith('/tasks/t1')) return { task: { id: 't1', title: 'Sample' } };
    if (url.endsWith('/preview')) return { versionId: 'v1', digest: 'safe', previewToken: 'private-token', expiresAt: '2999-01-01T00:00:00Z', effects: [] };
    if (url.includes('/automations?')) return { items: [rule], hasMore: false };
    if (options) return { rule: { ...rule, revision: 2, enabled: url.endsWith('/activate') }, version: { ...version, versionId: 'v2', actorUid: body.actorUid || 'u1', definition: body.definition || version.definition } };
    return { rule, version, diagnostics: [] };
  };
  const c = sandbox.CrmAutomations.createController({ root, apiFetchJson: async (url, options) => { calls.push({ url, options }); return handler(url, options); }, getCurrentUser: () => ({ uid: actor }), onContentDenied: id => denied.push(id), refreshBoard: async () => { refreshed.push(true); if (refreshFailure) throw new Error('offline'); }, onAccountDenied: () => denied.push('account') });
  const snapshot = (extra = {}) => ({ actorUid: actor, project: { id: 'p1', name: 'Project', lifecycle: 'active', schemaRevision: 1 }, membership: { role: 'Owner' }, filterOptionsReady: true, authorityRevision: 1, sections: [{ id: 's1', title: 'Work' }], columns: [], members: [{ uid: 'u1', role: 'Owner', displayName: 'One' }, { uid: 'u2', role: 'Owner', displayName: 'Two' }], tasks: new Map(), ...extra });
  c.setAccount(actor); c.setSelection('p1'); c.setContext(snapshot());
  return { c, calls, denied, refreshed, snapshot, rule, version, handle: fn => { handler = fn; }, actor: value => { actor = value; c.setAccount(value); }, failRefresh: () => { refreshFailure = true; } };
}
async function sample(h) { h.c.beginSearch(); await h.c.selectSearchTask('t1'); }
function editStatus(h, status) { h.c.editDefinition(value => E.editNode(value, 'step', node => E.setAt(node, ['payload', 'patch', 'status'], status))); }
test('Owner controls require authorized ready Board context, independent of admin metadata', () => {
  const h = harness(); assert.equal(h.c.getState().ready, true);
  h.c.setContext(h.snapshot({ membership: { role: 'Editor' } })); assert.equal(h.c.getState().owner, false); assert.equal(h.c.getState().draft, null);
  h.c.setContext(h.snapshot({ membership: null })); assert.equal(h.c.getState().owner, false);
});
test('same-scope transient refresh keeps draft while disabling actions; schema changes invalidate preview', async () => {
  const h = harness(); await h.c.openRule('r1'); await sample(h); await h.c.generatePreview(); assert.ok(h.c.getState().preview);
  h.c.setContext(h.snapshot({ filterOptionsReady: false })); assert.equal(h.c.getState().ready, false); assert.ok(h.c.getState().draft);
  h.c.setContext(h.snapshot({ project: { id: 'p1', schemaRevision: 2 } })); assert.equal(h.c.getState().preview, null);
});
test('filtered list allows empty page continuation and binds subsequent request to same filters', async () => {
  const h = harness(); let page = 0; h.handle(async () => ++page === 1 ? { items: [], hasMore: true, nextCursor: 'next' } : { items: [h.rule], hasMore: false });
  await h.c.setFilters({ query: ' R ', folderMode: 'unfiled', enabled: 'false' }); assert.equal(h.c.getState().cursor, 'next'); assert.match(h.c.getState().status, /Continue/);
  await h.c.loadList(true); const url = new URL(h.calls[1].url, 'http://local'); assert.equal(url.searchParams.get('query'), 'R'); assert.equal(url.searchParams.get('folder'), ''); assert.equal(url.searchParams.get('enabled'), 'false'); assert.equal(url.searchParams.get('cursor'), 'next'); assert.equal(h.c.getState().items.length, 1);
});
test('held list cannot paint after account or A-B-A project scope changes', async () => {
  for (const change of ['account', 'project']) { const h = harness(), held = deferred(); h.handle(() => held.promise); const work = h.c.loadList();
    if (change === 'account') h.actor('u3'); else { h.c.setSelection('p2'); h.c.setSelection('p1'); h.c.setContext(h.snapshot()); }
    held.resolve({ items: [{ ...h.rule, title: 'PRIVATE' }] }); await work; assert.equal(h.c.getState().items.length, 0);
  }
});
test('save sends loaded designated actor and explicit transfer changes only new version payload', async () => {
  const h = harness(); await h.c.openRule('r1'); editStatus(h, 'blocked'); await h.c.mutate('save');
  assert.equal(JSON.parse(h.calls.find(call => call.url.endsWith('/versions')).options.body).actorUid, 'u2');
  h.c.updateDraft({ actorUid: 'u1' }); await h.c.mutate('save'); assert.equal(JSON.parse(h.calls.at(-1).options.body).actorUid, 'u1');
});
test('held preview after draft edit or sample change cannot restore activation token', async () => {
  for (const change of ['definition', 'sample']) {
    const h = harness(); await h.c.openRule('r1'); await sample(h); const held = deferred(); h.handle(url => url.endsWith('/tasks/t1') ? Promise.resolve({ task: { id: 't1', title: 'New sample' } }) : held.promise);
    const work = h.c.generatePreview(); if (change === 'definition') editStatus(h, 'blocked'); else await sample(h);
    held.resolve({ versionId: 'v1', previewToken: 'OLD', expiresAt: '2999-01-01T00:00:00Z', effects: [] }); await work; assert.equal(h.c.getState().preview, null);
  }
});
test('held save acknowledgement preserves newer definition instead of overwriting it', async () => {
  const h = harness(); await h.c.openRule('r1'); editStatus(h, 'blocked'); const held = deferred(); h.handle(() => held.promise);
  const work = h.c.mutate('save'); editStatus(h, 'in_progress'); held.resolve({ rule: { ...h.rule, revision: 2 }, version: { ...h.version, versionId: 'v2', definition: { ...def(), steps: [{ ...def().steps[0], payload: { target: 'trigger_task', patch: { status: 'blocked' } } }] } } }); await work;
  assert.equal(h.c.getState().draft.definition.steps[0].payload.patch.status, 'in_progress'); assert.equal(h.c.getState().dirty, true); assert.equal(h.c.getState().rule.revision, 2);
});
test('lost acknowledgement blocks changed mutation until exact original payload and ID are reconciled', async () => {
  const h = harness(); h.c.newDraft(); h.handle(async () => { throw new Error('connection lost'); }); await h.c.mutate('create');
  const request = copy(h.c.getState().pending); h.c.updateDraft({ title: 'Newer title' }); const count = h.calls.length; await h.c.mutate('create'); assert.equal(h.calls.length, count);
  h.handle(async (_url, options) => { assert.deepEqual(JSON.parse(options.body), request.body); return { rule: { ...h.rule, title: request.body.title }, version: { ...h.version, actorUid: 'u1', definition: request.body.definition } }; });
  await h.c.retryMutation(); assert.equal(h.c.getState().pending, null); assert.equal(h.c.getState().draft.title, 'Newer title'); assert.equal(h.c.getState().dirty, true); assert.equal(h.c.getState().rule.ruleId, 'r1');
});

test('new and edited drafts survive project changes, discard without writes, and clear on account switch', async () => {
  for (const existing of [false, true]) {
    const h = harness(); if (existing) await h.c.openRule('r1'); else h.c.newDraft();
    h.c.updateDraft({ title: 'Keep my work' }); const before = copy(h.c.getState().draft);
    switchProject(h, 'p2'); h.c.newDraft(); h.c.updateDraft({ title: 'Second project' });
    switchProject(h, 'p1'); assert.deepEqual(copy(h.c.getState().draft), before);
    const count = h.calls.length; h.c.discardDraft(); assert.equal(h.calls.length, count); assert.equal(h.c.getState().draft, null); assert.equal(h.c.getState().mode, 'manage');
    h.c.newDraft(); assert.ok(h.c.getState().draft);
    h.actor('u3'); switchProject(h, 'p2'); assert.equal(h.c.getState().draft, null);
    h.actor('u1'); switchProject(h, 'p2'); assert.equal(h.c.getState().draft, null);
  }
});

test('uncertain request survives project changes with exact retry identity and blocks discard', async () => {
  const h = harness(); h.c.newDraft(); h.handle(async () => { throw new Error('lost acknowledgement'); });
  await h.c.mutate('create'); const original = h.calls.at(-1); h.c.discardDraft(); assert.ok(h.c.getState().draft);
  switchProject(h, 'p2'); switchProject(h, 'p1');
  h.handle(async () => ({ rule: h.rule, version: h.version })); await h.c.retryMutation();
  assert.equal(h.calls.at(-1).url, original.url); assert.equal(h.calls.at(-1).options.body, original.options.body);
  assert.equal(h.c.getState().pending, null); assert.equal(h.c.getState().inFlight, false);
});

test('late create acknowledgement settles its project, including a return while still in flight', async () => {
  for (const returnBeforeAck of [false, true]) {
    const h = harness(), held = deferred(); h.c.newDraft(); h.handle(() => held.promise);
    const work = h.c.mutate('create'); h.c.discardDraft(); assert.ok(h.c.getState().draft);
    switchProject(h, 'p2'); h.c.newDraft(); h.c.updateDraft({ title: 'Other project' });
    if (returnBeforeAck) { switchProject(h, 'p1'); await h.c.mutate('create'); assert.equal(h.calls.length, 1); }
    held.resolve({ rule: h.rule, version: h.version }); await work;
    if (!returnBeforeAck) { assert.equal(h.c.getState().draft.title, 'Other project'); assert.equal(h.c.getState().rule, null); switchProject(h, 'p1'); }
    assert.equal(h.c.getState().rule.ruleId, 'r1'); assert.equal(h.c.getState().pending, null); assert.equal(h.c.getState().inFlight, false); assert.equal(h.c.getState().dirty, false);
    await h.c.retryMutation(); assert.equal(h.calls.length, 1);
  }
});
test('Owner403 invalidates immediately; failed Board refresh cannot resurrect Owner or deny Editor content', async () => {
  const h = harness(); await h.c.openRule('r1'); h.failRefresh(); h.handle(async () => { throw httpError(403, 'PROJECT_OWNER_REQUIRED'); }); await h.c.loadList();
  assert.equal(h.c.getState().draft, null); assert.equal(h.c.getState().owner, false); await new Promise(setImmediate); assert.equal(h.refreshed.length, 1); assert.deepEqual(h.denied, []);
  h.c.setContext(h.snapshot()); assert.equal(h.c.getState().owner, false);
  h.c.setContext(h.snapshot({ authorityRevision: 2, membership: { role: 'Editor' } })); assert.equal(h.c.getState().owner, false); assert.deepEqual(h.denied, []);
});
test('actual apiFetchJson resource404 envelopes do not deny project content', async () => {
  for (const code of ['AUTOMATION_NOT_FOUND', 'AUTOMATION_VERSION_NOT_FOUND', 'RUN_NOT_FOUND', 'TASK_NOT_FOUND', 'BROKEN_REFERENCE']) {
    const h = harness(); h.handle(async () => { throw httpError(404, code); }); await h.c.openRule('missing'); assert.equal(h.c.getState().owner, true, code); assert.deepEqual(h.denied, []);
  }
});
test('401 and actual project404 clear state and route to canonical denial handling', async () => {
  for (const status of [401, 404]) { const h = harness(); await h.c.openRule('r1'); h.handle(async () => { throw httpError(status, status === 401 ? 'UNAUTHORIZED' : 'PROJECT_NOT_FOUND'); }); await h.c.loadList(); assert.equal(h.c.getState().draft, null); assert.equal(h.denied.length, 1); }
});
test('409 preserves draft and reviewed current revision refresh does not overwrite it', async () => {
  const h = harness(); await h.c.openRule('r1'); editStatus(h, 'blocked'); h.handle(async () => { throw httpError(409, 'STALE_REVISION'); }); await h.c.mutate('save'); assert.equal(h.c.getState().conflict, true);
  h.handle(async () => ({ rule: { ...h.rule, revision: 9 }, version: h.version, diagnostics: [] })); await h.c.openRule('r1', { preserveDraft: true }); assert.equal(h.c.getState().rule.revision, 9); assert.equal(h.c.getState().draft.definition.steps[0].payload.patch.status, 'blocked'); assert.equal(h.c.getState().conflict, false);
});
test('held search/history cannot paint into a new draft or another opened rule', async () => {
  for (const kind of ['search', 'history']) { const h = harness(); await h.c.openRule('r1'); const held = deferred(); h.handle(() => held.promise);
    let work; if (kind === 'search') { h.c.beginSearch(); work = h.c.searchTasks('private'); } else work = h.c.loadHistory('versions');
    h.c.newDraft(); held.resolve({ tasks: [{ id: 'old', title: 'PRIVATE' }], items: [{ versionId: 'old', definition: def() }] }); await work;
    assert.equal(h.c.getState().search, null); assert.equal(h.c.getState().history.items.length, 0);
  }
});
test('scoped acceptDraft copies only definition, preserves actor, and never calls an API', async () => {
  const h = harness(); await h.c.openRule('r1'); const count = h.calls.length, value = def(); value.steps[0].payload.patch.status = 'blocked';
  assert.equal(h.c.acceptDraft({ actorUid: 'u1', projectId: 'p1', definition: value }), true); value.steps[0].payload.patch.status = 'done'; assert.equal(h.c.getState().draft.definition.steps[0].payload.patch.status, 'blocked'); assert.equal(h.c.getState().draft.actorUid, 'u2'); assert.equal(h.calls.length, count);
  assert.equal(h.c.acceptDraft({ actorUid: 'wrong', projectId: 'p1', definition: value }), false);
  const invalid = def(); invalid.steps[0].payload.script = 'no'; assert.equal(h.c.acceptDraft({ actorUid: 'u1', projectId: 'p1', definition: invalid }), false); assert.match(h.c.getState().status, /unsupported/); assert.equal(h.calls.length, count);
});
test('new automation proposal clears existing rule identity and saves through create', async () => {
  const h = harness(); await h.c.openRule('r1');
  const count = h.calls.length;
  assert.equal(h.c.acceptDraft({ actorUid: 'u1', projectId: 'p1', definition: def() }, { newAutomation: true }), true);
  assert.equal(h.c.getState().rule, null); assert.equal(h.c.getState().draft.actorUid, 'u1'); assert.equal(h.calls.length, count);
  await h.c.mutate('save'); assert.equal(h.calls.at(-1).url, '/api/projects/p1/automations');
});

test('new automation proposal preserves an existing unsaved draft', async () => {
  const h = harness(); await h.c.openRule('r1'); editStatus(h, 'blocked'); const before = h.c.getState().draft;
  assert.equal(h.c.acceptDraft({ actorUid: 'u1', projectId: 'p1', definition: def() }, { newAutomation: true }), false);
  assert.equal(h.c.getState().rule.ruleId, 'r1'); assert.deepEqual(h.c.getState().draft, before);
});

test('exact task lookup binds search scope and validates selected result after hold', async () => {
  const h = harness(); await h.c.openRule('r1'); h.c.beginSearch(); await h.c.searchTasks('Sample'); assert.match(h.calls.at(-1).url, /parentScope/);
  const held = deferred(); h.handle(() => held.promise); const work = h.c.selectSearchTask('t1'); h.c.setSelection('p2'); held.resolve({ task: { id: 't1', title: 'PRIVATE' } }); await work; assert.equal(h.c.getState().sample, null);
});
test('run journals sort by immutable branch traversal and identify failure without a failed journal', async () => {
  const h = harness(); await h.c.openRule('r1'); const definition = { schemaVersion: 1, trigger: { type: 'task_created' }, steps: [{ nodeId: 'branch', type: 'if', condition: E.leaf(), then: [{ nodeId: 'a', type: 'delay', payload: { durationMs: 1 } }, { nodeId: 'b', type: 'notify', payload: { message: 'x', recipients: 'task_owner' } }], else: [] }] };
  h.handle(async url => url.includes('/automation-runs/') ? { run: { versionId: 'v1', state: 'failed', failedNode: '/branch/then/b', errorCode: 'BROKEN_REFERENCE' }, actions: [{ path: '/branch/then/a', type: 'delay', state: 'committed' }, { path: '/branch', type: 'if', state: 'committed' }] } : { rule: h.rule, version: { ...h.version, definition } });
  await h.c.showRun('run1'); assert.equal(h.c.getState().history.run.actions[0].path, '/branch'); assert.equal(h.c.getState().history.run.failedStep.sequence, 3); assert.equal(h.c.getState().history.run.failedStep.label, 'Notify people');
});
test('focus restoration distinguishes action buttons and same-named search inputs', async () => {
  for (const kind of ['button', 'query']) {
    let focused = null; const root = { innerHTML: '', hidden: false, contains: () => true, ownerDocument: {}, querySelectorAll: () => controls };
    const controls = [{ id: '', name: '', dataset: { autoAction: 'create' }, focus: () => { focused = 'wrong'; } }, { id: '', name: 'query', form: { dataset: { autoForm: 'filters' } }, dataset: {}, focus: () => { focused = 'wrong'; } }, { id: '', name: kind === 'query' ? 'query' : '', form: { dataset: { autoForm: 'task-search' } }, dataset: kind === 'button' ? { autoAction: 'preview' } : {}, focus: () => { focused = 'correct'; } }];
    root.ownerDocument.activeElement = controls[2]; const h = harness({ root }); h.c.newDraft(); assert.equal(focused, 'correct');
  }
});
test('reselecting the same sample fences previews until exact task acknowledgement', async () => {
  const h = harness(); await h.c.openRule('r1'); await sample(h); await h.c.generatePreview();
  const heldTask = deferred(); h.handle(url => url.endsWith('/tasks/t1') ? heldTask.promise : Promise.resolve({ versionId: 'v1', previewToken: 'NEW', effects: [] }));
  h.c.beginSearch(); const selection = h.c.selectSearchTask('t1');
  assert.equal(h.c.getState().sample.id, 't1'); assert.equal(h.c.getState().search.selecting, true); assert.equal(h.c.getState().preview, null);
  const count = h.calls.length; await h.c.generatePreview(); assert.equal(h.calls.length, count); assert.match(h.c.getState().status, /Confirming/);
  heldTask.resolve({ task: { id: 't1', title: 'Current sample' } }); await selection;
  assert.equal(h.c.getState().search, null); assert.match(h.c.getState().status, /Preview again/);
  await h.c.generatePreview(); assert.equal(h.c.getState().preview.previewToken, 'NEW');
});

test('held preview invalidated by authorized context change shows repreview state and rejects old token', async () => {
  const h = harness(); await h.c.openRule('r1'); await sample(h); const held = deferred(); h.handle(() => held.promise);
  const work = h.c.generatePreview(); h.c.setContext(h.snapshot({ project: { id: 'p1', schemaRevision: 2 } }));
  assert.match(h.c.getState().status, /Project context changed/);
  held.resolve({ versionId: 'v1', previewToken: 'OLD', effects: [] }); await work;
  assert.equal(h.c.getState().preview, null); assert.match(h.c.getState().status, /Preview again/);
});

test('sample lookup failure clears selecting flag without restoring invalidated preview', async () => {
  const h = harness(); await h.c.openRule('r1'); await sample(h); await h.c.generatePreview();
  h.handle(async () => { throw new Error('Offline'); }); h.c.beginSearch(); await h.c.selectSearchTask('t1');
  assert.equal(h.c.getState().search.selecting, false); assert.equal(h.c.getState().preview, null); assert.match(h.c.getState().status, /Offline/);
});
test('a new search supersedes held exact selection without leaving preview locked', async () => {
  const h = harness(); await h.c.openRule('r1'); await sample(h); const held = deferred();
  h.handle(url => url.endsWith('/tasks/t1') ? held.promise : Promise.resolve({ tasks: [{ id: 't2', title: 'Fresh' }] }));
  h.c.beginSearch(); const selection = h.c.selectSearchTask('t1'); await h.c.searchTasks('Fresh');
  assert.equal(h.c.getState().search.selecting, false); assert.match(h.c.getState().status, /Choose a task/);
  held.resolve({ task: { id: 't1', title: 'STALE' } }); await selection;
  assert.equal(h.c.getState().search.items[0].id, 't2'); assert.equal(h.c.getState().search.selecting, false); assert.notEqual(h.c.getState().sample.title, 'STALE');
});

test('draft edit superseding held selection keeps unsaved status and releases selection flag', async () => {
  const h = harness(); await h.c.openRule('r1'); await sample(h); const held = deferred(); h.handle(() => held.promise);
  h.c.beginSearch(); const selection = h.c.selectSearchTask('t1'); editStatus(h, 'blocked');
  held.resolve({ task: { id: 't1', title: 'STALE' } }); await selection;
  assert.equal(h.c.getState().search.selecting, false); assert.match(h.c.getState().status, /Unsaved changes/); assert.notEqual(h.c.getState().sample.title, 'STALE');
});
