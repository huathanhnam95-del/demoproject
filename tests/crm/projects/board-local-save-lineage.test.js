'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require(process.env.CRM_TEST_JSDOM || 'jsdom');
const source = fs.readFileSync(process.env.BOARD_SOURCE || path.resolve(__dirname, '../../../public/js/crm/projects/board.js'), 'utf8');
const tick = async () => { for (let i = 0; i < 12; i++) await new Promise(setImmediate); };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function fixture() {
    const dom = new JSDOM('<section id="board"><p id="status"></p><div id="scroll"><div id="table"><div id="header"></div><div id="rows"></div></div></div></section>');
    const document = dom.window.document;
    const elements = Object.fromEntries(Object.entries({ projectsBoardSection: 'board', projectsBoardStatus: 'status', projectsBoardScroll: 'scroll', projectsBoardTable: 'table', projectsBoardHeader: 'header', projectsBoardRows: 'rows' }).map(([key, id]) => [key, document.getElementById(id)]));
    let saved = { id: 'one', title: 'Original', sectionId: 's', rank: '0/1', lifecycle: 'active', revision: 1, values: {} }, firstHold, ackHold, failFirst = false, uncertain = false, role = 'Owner', uid = 'actor';
    const requests = [], acknowledged = new Map(); let counter = 0;
    const context = { document, console, URLSearchParams, crypto: { randomUUID: () => String(++counter) }, CSS: { escape: x => x }, setTimeout, clearTimeout, clearInterval, requestAnimationFrame: fn => fn(), confirm: () => false };
    vm.runInNewContext(source, context);
    const board = context.CrmProjectsBoard.createController({ elements, getCurrentUser: () => ({ uid }), apiFetchJson: async (url, options) => {
        if (options) {
            const body = JSON.parse(options.body), record = { ...body, status: null }; requests.push(record);
            if (requests.length === 1 && firstHold) await firstHold.promise;
            if (requests.length === 1 && failFirst) { record.status = 409; throw Object.assign(new Error('Known conflict'), { status: 409 }); }
            if (acknowledged.has(body.operationId)) { record.status = 200; return acknowledged.get(body.operationId); }
            if (body.expectedRevision !== saved.revision) { record.status = 409; throw Object.assign(new Error('Revision conflict'), { status: 409 }); }
            saved = { ...saved, ...(body.title !== undefined ? { title: body.title } : {}), values: { ...saved.values, ...body.values }, revision: saved.revision + 1 };
            const response = { task: { ...saved, values: { ...saved.values } } }; acknowledged.set(body.operationId, response);
            if (uncertain && requests.length === 1) { record.status = 'network'; throw new Error('Lost acknowledgment'); }
            if (requests.length === 1 && ackHold) await ackHold.promise;
            record.status = 200; return response;
        }
        if (url.endsWith('/member-directory')) return { people: [] };
        if (url.includes('/tasks?')) return { tasks: [{ ...saved }], sections: [{ id: 's', name: 'Section', rank: '0/1' }], columns: [{ id: 'c', label: 'Custom', type: 'text', rank: '0/1' }], revision: { schemaRevision: 1 } };
        if (url.endsWith('/tasks/one')) return { task: { ...saved } };
        return { project: { id: 'a', lifecycle: 'active', revision: 1 }, membership: { role } };
    } });
    board.init(); board.setProjects({ projects: [{ id: 'a', role: 'Owner' }], selectedProjectId: 'a' }); await tick();
    function edit(value, field = 'title', save = true) {
        const control = elements.projectsBoardRows.querySelector(field === 'title' ? '[data-field-kind="title"]' : 'input[data-column-id="c"]');
        assert.ok(control); control.value = value; control.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        if (save) control.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    }
    return { board, elements, requests, edit, saved: () => saved, hold() { firstHold = deferred(); return firstHold; }, holdAck() { ackHold = deferred(); return ackHold; }, fail() { failFirst = true; }, uncertain() { uncertain = true; }, role(value) { role = value; }, actor(value) { uid = value; }, async remote() {
        saved = { ...saved, title: 'Remote value', revision: saved.revision + 1 };
        const state = board.getSnapshot(); await board.applyRemote({ isCurrent: () => true, authority: { project: { ...state.project, schemaRevision: 1 }, membership: { role } }, changes: [{ taskId: 'one' }], hydration: { unavailableTaskIds: [], tasks: [{ ...saved }] } });
    } };
}
function uniqueOperations(h, count) { assert.equal(h.requests.length, count); assert.equal(new Set(h.requests.map(r => r.operationId)).size, count); }
for (const count of [2, 3]) test(`${count} queued edits follow only acknowledged local predecessor revisions`, async (t) => {
    const h = await fixture(), held = h.hold(); h.edit('Edit 1'); await tick();
    for (let i = 2; i <= count; i++) h.edit(`Edit ${i}`);
    held.resolve(); await tick();
    t.diagnostic(`Actual request trace: ${JSON.stringify(h.requests)}`);
    assert.deepEqual(h.requests.map(r => r.expectedRevision), Array.from({ length: count }, (_, i) => i + 1));
    assert.deepEqual(h.requests.map(r => r.status), Array(count).fill(200)); uniqueOperations(h, count);
    assert.equal(h.saved().title, `Edit ${count}`); assert.equal(h.board.getSnapshot().tasks.get('one').title, `Edit ${count}`);
});
test('different-field same-task successor follows its locally acknowledged predecessor', async () => {
    const h = await fixture(), held = h.hold(); h.edit('New title'); await tick(); h.edit('Custom draft', 'custom'); held.resolve(); await tick();
    assert.deepEqual(h.requests.map(r => r.expectedRevision), [1, 2]); uniqueOperations(h, 2);
    assert.equal(h.saved().title, 'New title'); assert.equal(h.saved().values.c, 'Custom draft');
});
test('later unsent draft survives acknowledgment and can be explicitly saved after queue drains', async () => {
    const h = await fixture(), held = h.hold(); h.edit('First'); await tick(); h.edit('Unsent', 'title', false); held.resolve(); await tick();
    assert.equal(h.requests.length, 1); assert.equal(h.saved().title, 'First');
    assert.equal(h.elements.projectsBoardRows.querySelector('[data-field-kind="title"]').value, 'Unsent');
    h.edit('Unsent'); await tick(); assert.deepEqual(h.requests.map(r => r.expectedRevision), [1, 2]); assert.equal(h.saved().title, 'Unsent');
});
test('observed remote revision after local acknowledgment still requires conflict review', async () => {
    const h = await fixture(), held = h.hold(); h.edit('First'); await tick(); h.edit('Retained', 'title', false); held.resolve(); await tick();
    await h.remote(); h.edit('Retained'); await tick();
    assert.deepEqual(h.requests.map(r => r.expectedRevision), [1, 2]); assert.equal(h.requests[1].status, 409); uniqueOperations(h, 2);
    assert.equal(h.saved().title, 'Remote value'); assert.equal(h.board.getSnapshot().tasks.get('one').title, 'Remote value');
    assert.equal(h.elements.projectsBoardRows.querySelector('[data-field-kind="title"]').value, 'Retained');
    assert.ok(h.elements.projectsBoardStatus.querySelector('[data-remote-conflict-review]'));
});
test('failed predecessor never rebases queued draft to an observed remote revision', async () => {
    const h = await fixture(), held = h.hold(); h.fail(); h.edit('First'); await tick(); h.edit('Retained'); await h.remote(); held.resolve(); await tick();
    assert.deepEqual(h.requests.map(r => r.expectedRevision), [1, 1]); assert.deepEqual(h.requests.map(r => r.status), [409, 409]); uniqueOperations(h, 2);
    assert.equal(h.saved().title, 'Remote value'); assert.equal(h.board.getSnapshot().tasks.get('one').title, 'Remote value');
    assert.equal(h.elements.projectsBoardRows.querySelector('[data-field-kind="title"]').value, 'Retained');
    assert.ok(h.elements.projectsBoardStatus.querySelector('[data-remote-conflict-review]'));
});
test('uncertain transport retry reuses its operation ID before successor follows acknowledgment', async () => {
    const h = await fixture(), held = h.hold(); h.uncertain(); h.edit('First'); await tick(); h.edit('Latest'); held.resolve();
    await new Promise(resolve => setTimeout(resolve, 230)); await tick();
    assert.deepEqual(h.requests.map(r => r.expectedRevision), [1, 1, 2]); assert.equal(h.requests[0].operationId, h.requests[1].operationId); assert.notEqual(h.requests[1].operationId, h.requests[2].operationId); assert.equal(h.saved().title, 'Latest');
});
for (const mode of ['actor', 'revoked']) test(`queued successor cannot write after ${mode} scope invalidation`, async () => {
    const h = await fixture(), held = h.hold(); h.edit('First'); await tick(); h.edit('Latest');
    if (mode === 'actor') h.actor('other');
    else h.board.invalidateAccess('a');
    held.resolve(); await tick(); assert.equal(h.requests.length, 1);
});

test('delayed local acknowledgment retains newer canonical state and queued successor still conflicts', async () => {
    const h = await fixture(), held = h.holdAck(); h.edit('Local first'); await tick(); h.edit('Local latest'); await h.remote();
    assert.equal(h.board.getSnapshot().tasks.get('one').title, 'Remote value'); held.resolve(); await tick();
    assert.deepEqual(h.requests.map(r => r.expectedRevision), [1, 2]); assert.deepEqual(h.requests.map(r => r.status), [200, 409]); uniqueOperations(h, 2);
    assert.equal(h.board.getSnapshot().tasks.get('one').title, 'Remote value'); assert.equal(h.saved().title, 'Remote value');
    assert.equal(h.elements.projectsBoardRows.querySelector('[data-field-kind="title"]').value, 'Local latest');
    assert.ok(h.elements.projectsBoardStatus.querySelector('[data-remote-conflict-review]'));
});

test('fresh Viewer authority blocks queued successor even when predecessor later succeeds', async () => {
    const h = await fixture(), held = h.hold(); h.edit('First'); await tick(); h.edit('Latest'); h.role('Viewer');
    const state = h.board.getSnapshot();
    const downgrade = h.board.applyRemote({ isCurrent: () => true, authority: { project: { ...state.project, schemaRevision: 1 }, membership: { role: 'Viewer' } }, changes: [], hydration: { unavailableTaskIds: [], tasks: [] } });
    held.resolve(); await downgrade; await tick(); assert.equal(h.requests.length, 1);
    assert.equal(h.board.getSnapshot().membership.role, 'Viewer');
    assert.equal(h.elements.projectsBoardRows.querySelector('[data-field-kind="title"]'), null);
});
