'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require(process.env.CRM_TEST_JSDOM || 'jsdom');
const source = fs.readFileSync(process.env.BOARD_SOURCE || path.resolve(__dirname, '../../../public/js/crm/projects/board.js'), 'utf8');
const observerSource = fs.readFileSync(process.env.OBSERVER_SOURCE || path.resolve(__dirname, '../../../public/js/crm/projects/remote-observer.js'), 'utf8');
const tick = async () => { for (let i = 0; i < 12; i++) await new Promise(setImmediate); };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
async function fixture(t, observed = true) {
    const dom = new JSDOM('<textarea id="outside"></textarea><section id="board"><button id="refresh"></button><p id="status"></p><div id="scroll"><div id="table"><div id="header"></div><div id="rows"></div></div></div><div id="form" hidden><input id="label"><select id="type"><option>dropdown</option></select><textarea id="options"></textarea><button id="btn-projects-board-save-column"></button><button id="btn-projects-board-cancel-column"></button></div></section>', { pretendToBeVisual: true });
    const document = dom.window.document, requests = [], gates = [], published = [];
    const elements = Object.fromEntries(Object.entries({ projectsBoardSection: 'board', projectsBoardRefresh: 'refresh', projectsBoardStatus: 'status', projectsBoardScroll: 'scroll', projectsBoardTable: 'table', projectsBoardHeader: 'header', projectsBoardRows: 'rows', projectsBoardColumnForm: 'form', projectsBoardColumnLabel: 'label', projectsBoardColumnType: 'type', projectsBoardColumnOptions: 'options' }).map(([key, id]) => [key, document.getElementById(id)]));
    let column = { id: 'choice', label: 'Original choice', type: 'dropdown', options: [{ key: 'red', label: 'Red' }], revision: 1, rank: '0/1' }, task = { id: 'one', title: 'Original', sectionId: 's', rank: '0/1', revision: 1 }, saveGate, pageGate, uid = 'actor';
    const context = { document, console, URLSearchParams, crypto: { randomUUID: () => String(requests.length) }, CSS: { escape: x => x }, setTimeout, clearTimeout, clearInterval, requestAnimationFrame: fn => fn() };
    vm.runInNewContext(source, context); vm.runInNewContext(observerSource, context);
    const apiFetchJson = async (url, options) => {
        const body = options?.body && JSON.parse(options.body); requests.push({ url, method: options?.method || 'GET', body });
        if (url.endsWith('/changes')) { const gate = gates.shift(); if (gate) await gate.promise; return { cursor: 'current', authority: { signature: 'same' } }; }
        if (options && url.endsWith('/columns/choice')) { if (body.expectedRevision !== column.revision) throw Object.assign(new Error('Column revision conflict'), { status: 409 }); return { column, schemaRevision: column.revision }; }
        if (options && url.endsWith('/tasks/one')) { if (saveGate) await saveGate.promise; if (body.expectedRevision !== task.revision) throw Object.assign(new Error('Task revision conflict'), { status: 409 }); task = { ...task, title: body.title, revision: task.revision + 1 }; return { task: { ...task } }; }
        if (url.endsWith('/tasks/one')) return { task: { ...task } };
        if (url.endsWith('/member-directory')) return { people: [] };
        if (url.includes('/tasks?')) { if (pageGate) await pageGate.promise; return { tasks: [{ ...task }], sections: [{ id: 's', name: 'Section', rank: '0/1' }, { id: 'other', name: 'Other section', rank: '1/1' }], columns: [{ ...column }], revision: { schemaRevision: column.revision } }; }
        return { project: { id: url.split('/').pop(), lifecycle: 'active', schemaRevision: column.revision }, membership: { role: 'Owner' } };
    };
    const board = context.CrmProjectsBoard.createController({ elements, apiFetchJson, getCurrentUser: () => ({ uid }), onContextChanged: snapshot => published.push({ ready: snapshot.authorizationReady, columns: snapshot.columns.map(c => c.label) }) });
    board.init(); board.setProjects({ projects: [{ id: 'p', role: 'Owner' }], selectedProjectId: 'p' }); await tick();
    const observer = context.CrmProjectsRemoteObserver.createController({ apiFetchJson, getCurrentUser: () => ({ uid }), onDenied: id => board.invalidateAccess(id) }); if (observed) board.attachRemoteObserver(observer);
    t.after(() => { observer.dispose(); dom.window.close(); });
    const edit = value => { const input = elements.projectsBoardRows.querySelector('[data-field-kind="title"]'); input.value = value; input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); input.dispatchEvent(new dom.window.Event('change', { bubbles: true })); };
    return { board, elements, document, requests, published, edit, busy: () => elements.projectsBoardSection.getAttribute('aria-busy'), saved: () => task, externalTask() { task = { ...task, title: 'Remote task', revision: task.revision + 1 }; }, externalColumn() { column = { ...column, label: 'External choice label', revision: 2 }; }, holdHandshake() { const gate = deferred(); gates.push(gate); return gate; }, holdSave() { saveGate = deferred(); return saveGate; }, holdPage() { pageGate = deferred(); return pageGate; }, clearPage() { pageGate = null; }, actor(value) { uid = value; }, open() { elements.projectsBoardHeader.querySelector('[data-action="edit-column"]').click(); }, saveColumn() { document.getElementById('btn-projects-board-save-column').click(); }, cancel() { document.getElementById('btn-projects-board-cancel-column').click(); } };
}
test('real column conflict retains draft; Cancel and manual refresh synchronously hide stale readiness through observer handshake', async t => {
    const h = await fixture(t); h.open(); h.elements.projectsBoardColumnLabel.value = 'Conflict draft retained'; h.externalColumn(); h.saveColumn(); await tick();
    assert.equal(h.elements.projectsBoardColumnLabel.value, 'Conflict draft retained'); h.cancel(); assert.equal(h.elements.projectsBoardColumnForm.hidden, true);
    const gate = h.holdHandshake(); h.elements.projectsBoardRefresh.click();
    t.diagnostic(JSON.stringify({ stage: 'immediate click', busy: h.busy(), ready: h.board.getSnapshot().authorizationReady, columns: h.board.getSnapshot().columns.map(c => c.label) }));
    assert.equal(h.busy(), 'true'); assert.equal(h.board.getSnapshot().authorizationReady, false); await tick();
    h.open(); assert.equal(h.elements.projectsBoardColumnForm.hidden, true);
    gate.resolve(); await tick(); assert.equal(h.busy(), 'false'); assert.equal(h.board.getSnapshot().authorizationReady, true);
    h.open(); assert.equal(h.elements.projectsBoardColumnLabel.value, 'External choice label');
});
test('refresh readiness begins before draining two admitted local saves without canceling them', async t => {
    const h = await fixture(t, false), gate = h.holdSave(); h.edit('First'); await tick(); h.edit('Latest'); const beforeRefresh = h.requests.length, refresh = h.board.refresh();
    assert.equal(h.requests.slice(beforeRefresh).some(r => r.url.includes('/tasks?')), false);
    assert.equal(h.busy(), 'true'); assert.equal(h.board.getSnapshot().authorizationReady, false);
    gate.resolve(); await refresh; assert.equal(h.saved().title, 'Latest');
    assert.deepEqual(h.requests.filter(r => r.method === 'PATCH').map(r => r.body.expectedRevision), [1, 2]);
    assert.equal(h.busy(), 'false'); assert.equal(h.board.getSnapshot().authorizationReady, true);
});
test('older publication cannot clear newer queued refresh readiness', async t => {
    const h = await fixture(t), firstGate = h.holdHandshake(), secondGate = h.holdHandshake();
    const first = h.board.refresh(), second = h.board.refresh(); await tick(); firstGate.resolve(); await first;
    assert.equal(h.busy(), 'true'); assert.equal(h.board.getSnapshot().authorizationReady, false);
    secondGate.resolve(); await second; assert.equal(h.busy(), 'false'); assert.equal(h.board.getSnapshot().authorizationReady, true);
});
test('failed observer handshake ends busy but blocks writes until a successful retry, retaining selection', async t => {
    const h = await fixture(t), gate = h.holdHandshake(); h.board.setSelectedTaskIds(['one']); const refresh = h.board.refresh(); await tick();
    gate.reject(Object.assign(new Error('Temporary handshake failure'), { status: 503 })); assert.equal(await refresh, false);
    assert.equal(h.busy(), 'false'); assert.equal(h.board.getSnapshot().authorizationReady, false); assert.deepEqual([...h.board.getSnapshot().selectedTaskIds], ['one']);
    assert.equal(h.elements.projectsBoardHeader.querySelector('[data-action="edit-column"]'), null); assert.equal(h.elements.projectsBoardColumnForm.hidden, true); h.edit('No write'); await tick(); assert.equal(h.requests.filter(r => r.method === 'PATCH').length, 0);
    await h.board.refresh(); assert.equal(h.board.getSnapshot().authorizationReady, true);
});
test('a held manual refresh preserves newer outside focus and caret', async t => {
    const h = await fixture(t), gate = h.holdHandshake(); const refresh = h.board.refresh(); await tick();
    const editor = h.document.getElementById('outside'); editor.value = 'New instruction'; editor.focus(); editor.setSelectionRange(2, 8, 'backward'); gate.resolve(); await refresh;
    assert.equal(h.document.activeElement, editor); assert.equal(editor.selectionStart, 2); assert.equal(editor.selectionEnd, 8); assert.equal(editor.selectionDirection, 'backward');
});
test('stale project refresh completion cannot clear another scope readiness or restore old content', async t => {
    const h = await fixture(t), oldGate = h.holdHandshake(); const old = h.board.refresh(); await tick();
    h.board.setProjects({ projects: [{ id: 'q', role: 'Owner' }], selectedProjectId: 'q' }); await tick();
    const current = h.board.getSnapshot().project.id, before = h.busy(); oldGate.resolve(); await old;
    assert.equal(current, 'q'); assert.equal(h.board.getSnapshot().project.id, 'q'); assert.equal(h.busy(), before);
});

test('older handshake failure cannot clear a newer refresh intent, and latest failure remains fail-closed', async t => {
    const h = await fixture(t), firstGate = h.holdHandshake(), secondGate = h.holdHandshake(); const first = h.board.refresh(), second = h.board.refresh(); await tick();
    firstGate.reject(Object.assign(new Error('Older failure'), { status: 503 })); assert.equal(await first, false);
    assert.equal(h.busy(), 'true'); assert.equal(h.board.getSnapshot().authorizationReady, false);
    secondGate.reject(Object.assign(new Error('Latest failure'), { status: 503 })); assert.equal(await second, false);
    assert.equal(h.busy(), 'false'); assert.equal(h.board.getSnapshot().authorizationReady, false);
    await h.board.refresh(); assert.equal(h.board.getSnapshot().authorizationReady, true);
});
test('an older successful load cannot make the latest failed handshake writable', async t => {
    const h = await fixture(t), firstGate = h.holdHandshake(), secondGate = h.holdHandshake(); const first = h.board.refresh(), second = h.board.refresh(); await tick();
    firstGate.resolve(); await first; secondGate.reject(Object.assign(new Error('Latest failed'), { status: 503 })); await second;
    assert.equal(h.busy(), 'false'); assert.equal(h.board.getSnapshot().authorizationReady, false);
    await h.board.refresh(); assert.equal(h.board.getSnapshot().authorizationReady, true);
});
test('existing column editor draft is retained while fresh canonical column is published', async t => {
    const h = await fixture(t); h.open(); h.elements.projectsBoardColumnLabel.value = 'Intent kept'; h.externalColumn(); const gate = h.holdHandshake(), refresh = h.board.refresh();
    gate.resolve(); await refresh; assert.equal(h.board.getSnapshot().columns[0].label, 'External choice label');
    assert.equal(h.elements.projectsBoardColumnLabel.value, 'Intent kept'); assert.equal(h.elements.projectsBoardColumnForm.hidden, false);
    h.cancel(); h.open(); assert.equal(h.elements.projectsBoardColumnLabel.value, 'External choice label');
});
for (const mode of ['actor', 'denied']) test(`${mode} invalidation during handshake cannot restore retained access`, async t => {
    const h = await fixture(t), gate = h.holdHandshake(), refresh = h.board.refresh(); await tick();
    if (mode === 'actor') { h.actor('other'); assert.equal(h.board.getSnapshot().project, null); gate.resolve(); }
    else gate.reject(Object.assign(new Error('Denied'), { status: 403 }));
    await refresh; assert.equal(h.board.getSnapshot().project, null); assert.equal(h.board.getSnapshot().authorizationReady, false); assert.equal(h.busy(), 'false');
    assert.equal(h.elements.projectsBoardRows.innerHTML, '');
});

test('new keyboard creation and dirty-editor change cannot enter the write queue during a refresh handshake', async t => {
    const h = await fixture(t), gate = h.holdHandshake(), refresh = h.board.refresh(); await tick();
    const row = h.elements.projectsBoardRows.querySelector('[data-task-id="one"]'); row.focus();
    row.dispatchEvent(new h.document.defaultView.KeyboardEvent('keydown', { key: 'n', ctrlKey: true, bubbles: true, cancelable: true }));
    h.edit('Late change'); await tick();
    t.diagnostic(JSON.stringify(h.requests.filter(r => r.method !== 'GET')));
    assert.equal(h.requests.filter(r => r.method !== 'GET').length, 0);
    gate.resolve(); await refresh;
    assert.equal(h.requests.filter(r => r.method !== 'GET').length, 0, 'readiness recovery must not replay rejected actions');
});

test('drag started before refresh cannot drop a new move during the handshake', async t => {
    const h = await fixture(t), row = h.elements.projectsBoardRows.querySelector('[data-task-id="one"]');
    const drag = new h.document.defaultView.Event('dragstart', { bubbles: true, cancelable: true }); drag.dataTransfer = { setData() {} }; row.dispatchEvent(drag);
    const gate = h.holdHandshake(), refresh = h.board.refresh(); await tick();
    h.elements.projectsBoardRows.querySelector('[data-section-id="other"]').dispatchEvent(new h.document.defaultView.Event('drop', { bubbles: true, cancelable: true })); await tick();
    assert.equal(h.requests.filter(r => r.method !== 'GET').length, 0); gate.resolve(); await refresh; assert.equal(h.requests.filter(r => r.method !== 'GET').length, 0);
});
test('conflict Review received during refresh neither fetches nor queues a retry', async t => {
    const h = await fixture(t); h.externalTask(); h.edit('Retained draft'); await tick();
    const review = h.elements.projectsBoardStatus.querySelector('[data-remote-conflict-review]'); assert.ok(review);
    const gate = h.holdHandshake(), refresh = h.board.refresh(); await tick(); const count = h.requests.length; review.click(); await tick();
    assert.equal(h.requests.length, count); gate.resolve(); await refresh; assert.equal(h.requests.filter(r => r.method === 'PATCH').length, 1);
});
