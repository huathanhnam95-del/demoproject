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
async function fixture(t) {
    const dom = new JSDOM('<textarea id="external"></textarea><section id="board"><p id="status"></p><div id="scroll"><div id="table"><div id="header"></div><div id="rows"></div></div></div></section>', { pretendToBeVisual: true });
    const document = dom.window.document;
    const elements = Object.fromEntries(Object.entries({ projectsBoardSection: 'board', projectsBoardStatus: 'status', projectsBoardScroll: 'scroll', projectsBoardTable: 'table', projectsBoardHeader: 'header', projectsBoardRows: 'rows' }).map(([key, id]) => [key, document.getElementById(id)]));
    let tasks = ['a', 'b'].map((id, rank) => ({ id, title: id, sectionId: 's', parentTaskId: null, rank: `${rank}/1`, lifecycle: 'active', revision: 1, activeChildCount: 0 })), structure = 1, role = 'Owner', uid = 'actor', postHold;
    const postHolds = new Map();
    const requests = [], events = [], handshake = deferred();
    const context = { document, console, URLSearchParams, crypto: { randomUUID: () => String(requests.length) }, CSS: { escape: x => x }, setTimeout, clearTimeout, clearInterval, requestAnimationFrame: fn => fn() };
    vm.runInNewContext(source, context); vm.runInNewContext(observerSource, context);
    const apiFetchJson = async (url, options) => {
        requests.push({ url, method: options?.method || 'GET', body: options?.body ? JSON.parse(options.body) : null });
        if (url.endsWith('/changes')) { await handshake.promise; return { cursor: 'current', authority: { signature: 'signature' } }; }
        if (options && url.endsWith('/move')) {
            const id = url.split('/').at(-2), body = JSON.parse(options.body);
            if (postHolds.has(id)) await postHolds.get(id).promise;
            else if (postHold) await postHold.promise;
            tasks = tasks.map(task => task.id === id ? { ...task, parentTaskId: body.parentTaskId, sectionId: body.sectionId || 's', rank: `${body.index - 1}/1`, revision: task.revision + 1 } : task); structure++;
            return { structureRevision: structure };
        }
        if (url.endsWith('/member-directory')) return { people: [] };
        if (url.includes('/tasks?')) return { tasks: tasks.filter(task => !task.parentTaskId), sections: [{ id: 's', name: 'Section', rank: '0/1' }], columns: [], revision: { structureRevision: structure, schemaRevision: 1 } };
        return { project: { id: url.split('/').pop(), lifecycle: 'active', structureRevision: structure, schemaRevision: 1 }, membership: { role } };
    };
    const board = context.CrmProjectsBoard.createController({ elements, apiFetchJson, getCurrentUser: () => ({ uid }) });
    board.init(); board.setProjects({ projects: [{ id: 'p', role }], selectedProjectId: 'p' }); await tick();
    const observer = context.CrmProjectsRemoteObserver.createController({ apiFetchJson, getCurrentUser: () => ({ uid }) }); board.attachRemoteObserver(observer); t.after(() => { observer.dispose(); dom.window.close(); });
    const row = id => elements.projectsBoardRows.querySelector(`[data-task-id="${id}"]`);
    const order = () => [...board.getSnapshot().tasks.values()].filter(task => !task.parentTaskId).sort((a, b) => parseInt(a.rank) - parseInt(b.rank)).map(task => task.id);
    const busy = () => elements.projectsBoardSection.getAttribute('aria-busy');
    const key = (name, altKey = false) => { const active = document.activeElement; events.push({ key: name, altKey, target: active.dataset.taskId || active.id, busy: busy(), ready: board.getSnapshot().authorizationReady, order: order() }); active.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: name, altKey, bubbles: true, cancelable: true })); };
    return { board, elements, document, row, key, busy, order, events, requests, handshake, tasks: () => tasks, actor(value) { uid = value; }, holdPost(id) { const held = deferred(); if (id) postHolds.set(id, held); else postHold = held; return held; }, role(value) { role = value; } };
}
test('task move remains busy from POST through held actual observer handshake and authorized publication', async t => {
    const h = await fixture(t); h.row('b').focus(); const post = h.holdPost(); h.key('ArrowUp'); await tick();
    assert.equal(h.busy(), 'true', 'in-flight move must not expose the old order as interactive');
    post.resolve(); await tick(); assert.equal(h.busy(), 'true'); assert.deepEqual(h.order(), ['a', 'b']);
    h.row('a').querySelector('[data-action="select-task"]').click();
    assert.deepEqual([...h.board.getSnapshot().selectedTaskIds], ['a']);
    h.row('a').focus(); h.key('Alt', true); h.handshake.resolve(); await tick();
    assert.equal(h.busy(), 'false'); assert.deepEqual(h.order(), ['b', 'a']); assert.equal(h.document.activeElement, h.row('a'));
    assert.deepEqual([...h.board.getSnapshot().selectedTaskIds], ['a']);
    h.key('ArrowRight', true); await tick();
    t.diagnostic(JSON.stringify({ events: h.events, moves: h.requests.filter(r => r.method === 'POST') }));
    assert.equal(h.requests.filter(r => r.url.endsWith('/tasks/a/move')).length, 1);
    assert.equal(h.tasks().find(task => task.id === 'a').parentTaskId, 'b');
});
test('held move completion respects external focus and caret takeover', async t => {
    const h = await fixture(t); h.row('b').focus(); h.key('ArrowUp'); await tick();
    const external = h.document.getElementById('external'); external.value = 'Keep editing'; external.focus(); external.setSelectionRange(2, 7, 'backward'); h.handshake.resolve(); await tick();
    assert.equal(h.document.activeElement, external); assert.equal(external.selectionStart, 2); assert.equal(external.selectionEnd, 7); assert.equal(external.selectionDirection, 'backward');
});
test('unchanged focus remains on moved row after reconciliation', async t => {
    const h = await fixture(t); h.row('b').focus(); h.key('ArrowUp'); await tick(); h.handshake.resolve(); await tick();
    assert.equal(h.document.activeElement, h.row('b')); assert.deepEqual(h.order(), ['b', 'a']);
});

test('another loader cannot clear a held task move and keyboard mutations stay blocked until reconciliation', async t => {
    const h = await fixture(t), held = h.holdPost(); h.row('b').focus(); h.key('ArrowUp'); await tick();
    await h.board.loadProject('p', { preserve: true, fenced: true }); assert.equal(h.busy(), 'true');
    h.row('a').focus(); h.key('ArrowDown'); await tick(); assert.equal(h.requests.filter(r => r.method === 'POST').length, 1);
    held.resolve(); h.handshake.resolve(); await tick(); assert.equal(h.busy(), 'false');
});
test('one failed task move cannot clear another already admitted task move', async t => {
    const h = await fixture(t), first = h.holdPost('b'), second = h.holdPost('a');
    h.row('b').focus(); h.key('ArrowUp'); h.row('a').focus(); h.key('ArrowDown'); await tick();
    assert.equal(h.requests.filter(r => r.method === 'POST').length, 2); assert.equal(h.busy(), 'true');
    first.reject(Object.assign(new Error('Move conflict'), { status: 409 })); await tick(); assert.equal(h.busy(), 'true');
    second.resolve(); h.handshake.resolve(); await tick(); assert.equal(h.busy(), 'false');
});
test('move failure clears pending while respecting current external focus', async t => {
    const h = await fixture(t), held = h.holdPost(); h.row('b').focus(); h.key('ArrowUp'); await tick();
    const external = h.document.getElementById('external'); external.focus(); held.reject(Object.assign(new Error('Move rejected'), { status: 409 })); await tick();
    assert.equal(h.busy(), 'false'); assert.equal(h.document.activeElement, external); assert.deepEqual(h.order(), ['a', 'b']);
});
for (const mode of ['project', 'actor']) test(`late move completion cannot change newer ${mode} focus or readiness`, async t => {
    const h = await fixture(t), held = h.holdPost(); h.row('b').focus(); h.key('ArrowUp'); await tick();
    if (mode === 'actor') h.actor('different');
    h.board.setProjects({ projects: [{ id: 'q', role: 'Owner' }], selectedProjectId: 'q' });
    h.handshake.resolve(); await tick(); const external = h.document.getElementById('external'); external.focus();
    const busy = h.busy(), before = h.requests.length; held.resolve(); await tick();
    assert.equal(h.busy(), busy); assert.equal(h.document.activeElement, external); assert.equal(h.requests.length, before);
});
test('boundary indentation remains a no-op and Viewer keyboard cannot mutate', async t => {
    const h = await fixture(t); h.row('a').focus(); h.key('ArrowRight', true); await tick(); assert.equal(h.requests.filter(r => r.method === 'POST').length, 0);
    h.role('Viewer'); await h.board.loadProject('p', { preserve: true, fenced: true }); h.row('b').focus(); h.key('ArrowUp'); await tick(); assert.equal(h.requests.filter(r => r.method === 'POST').length, 0);
});
