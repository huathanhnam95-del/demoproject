'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require(process.env.CRM_TEST_JSDOM || 'jsdom');
const root = path.resolve(__dirname, '../../..');
const tick = async () => { for (let i = 0; i < 12; i++) await new Promise(setImmediate); };
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
async function fixture() {
    const dom = new JSDOM('<section id="board"><p id="status"></p><div id="scroll"><div id="table"><div id="header"></div><div id="rows"></div></div></div></section>');
    const document = dom.window.document;
    const elements = Object.fromEntries(Object.entries({ projectsBoardSection: 'board', projectsBoardStatus: 'status', projectsBoardScroll: 'scroll', projectsBoardTable: 'table', projectsBoardHeader: 'header', projectsBoardRows: 'rows' }).map(([k, id]) => [k, document.getElementById(id)]));
    let uid = 'actor', role = 'Owner', fail = 0, malformed = null, hold = null, listenerThrows = false, attempt = 0;
    let saved = { id: 'one', title: 'Original', sectionId: 's', rank: '0/1', lifecycle: 'active', revision: 1, values: {} };
    const events = [], scopes = [], requests = [];
    const context = { document, console, URLSearchParams, crypto: { randomUUID: () => String(++attempt) }, CSS: { escape: x => x }, setTimeout, clearTimeout, clearInterval, requestAnimationFrame: fn => fn(), confirm: () => false };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'public/js/crm/projects/state.js'), 'utf8'), context);
    vm.runInNewContext(fs.readFileSync(path.join(root, 'public/js/crm/projects/board.js'), 'utf8'), context);
    const board = context.CrmProjectsBoard.createController({ elements, getCurrentUser: () => ({ uid }),
        onFieldSaveEvent: e => { events.push(e); if (listenerThrows) throw new Error('Presentation failed'); },
        onFieldSaveScopeChanged: s => scopes.push(s),
        apiFetchJson: async (url, options) => {
            if (options) {
                const body = JSON.parse(options.body); requests.push(body);
                if (hold) { const wait = hold; hold = null; await wait.promise; }
                if (fail) throw Object.assign(new Error('Rejected'), fail === -1 ? {} : { status: fail });
                if (malformed) return malformed;
                saved = { ...saved, ...Object.fromEntries(Object.entries(body).filter(([key]) => !['operationId', 'expectedRevision'].includes(key))), revision: saved.revision + 1 };
                return { result: { task: { ...saved } } };
            }
            if (url.endsWith('/member-directory')) return { people: [] };
            if (url.includes('/tasks?')) return { tasks: [{ ...saved }], sections: [{ id: 's', name: 'Section', rank: '0/1' }], columns: [{ id: 'c', label: 'Custom', type: 'number', rank: '0/1' }], revision: { schemaRevision: 1 } };
            return { project: { id: url.split('/').pop(), lifecycle: 'active', revision: 1 }, membership: { role } };
        } });
    const select = id => board.setProjects({ projects: [{ id, role }], selectedProjectId: id });
    board.init(); select('a'); await tick();
    return { board, events, scopes, requests, elements, select, dom,
        edit: value => board.saveTaskField('one', 'title', { value, dataset: {} }),
        hold() { hold = deferred(); return hold; }, fail: value => { fail = value; }, malformed: value => { malformed = value; },
        actor: value => { uid = value; }, role: value => { role = value; }, listenerThrows: () => { listenerThrows = true; } };
}
test('queued field events preserve payloads and local lineage; versions survive saved draft cleanup', async () => {
    const h = await fixture(), held = h.hold();
    const first = h.edit('First'); await tick(); const second = h.edit('Second'); held.resolve();
    const lineage = await second; await first;
    assert.deepEqual(h.requests.map(r => r.expectedRevision), [1, 2]);
    assert.deepEqual(Object.keys(h.requests[0]).sort(), ['expectedRevision', 'operationId', 'title']);
    assert.equal(lineage.revision, 3);
    await h.edit('Third');
    assert.deepEqual(h.events.filter(e => e.phase === 'dirty').map(e => e.editVersion), [1, 2, 3]);
    for (const version of [1, 2, 3]) {
        const events = h.events.filter(e => e.editVersion === version);
        assert.deepEqual(events.map(e => e.phase), ['dirty', 'saving', 'saved']);
        assert.equal(events[1].operationId, events[2].operationId);
        assert.equal(events[2].scope.projectId, 'a'); assert.equal(events[2].scope.actorUid, 'actor');
    }
});
for (const [status, phase] of [[400, 'error'], [403, 'error'], [409, 'conflict'], [503, 'uncertain'], [-1, 'uncertain']]) {
    test(`failure ${status} retains draft and reports ${phase}`, async () => {
        const h = await fixture(); h.fail(status); await h.edit('Retained');
        assert.equal(h.events.at(-1)?.phase, phase);
        assert.equal(h.elements.projectsBoardRows.querySelector('[data-field-kind="title"]').value, 'Retained');
        assert.equal(h.board.getSnapshot().tasks.get('one').title, 'Original');
        if (status === -1) { assert.equal(h.requests.length, 2); assert.deepEqual(h.requests[0], h.requests[1]); }
    });
}
for (const response of [{}, { task: { id: 'wrong', revision: 2 } }, { task: { id: 'one', revision: 1 } }, { task: { id: 'one', revision: '2' } }]) {
    test(`malformed acknowledgement retains draft: ${JSON.stringify(response)}`, async () => {
        const h = await fixture(); h.malformed(response); assert.equal(await h.edit('Retained'), undefined);
        assert.equal(h.events.at(-1)?.phase, 'uncertain');
        assert.ok(!h.events.some(e => e.phase === 'saved'));
        assert.equal(h.elements.projectsBoardRows.querySelector('[data-field-kind="title"]').value, 'Retained');
        assert.equal(h.board.getSnapshot().tasks.get('one').revision, 1);
    });
}
test('scope switch clears feedback immediately and late responses only cancel the old scope', async () => {
    const h = await fixture(), held = h.hold(); const save = h.edit('Old project'); await tick();
    const queued = h.edit('Queued'); h.select('b'); await tick();
    assert.equal(h.scopes.at(-1)?.projectId, 'b'); held.resolve(); await save; await queued;
    assert.equal(h.requests.length, 1); assert.ok(!h.events.some(e => e.phase === 'saved'));
    assert.equal(h.events.filter(e => e.phase === 'cancelled').length, 2);
    assert.ok(h.events.filter(e => e.phase === 'cancelled').every(e => e.scope.projectId === 'a'));
});
test('read-only and missing tasks settle blocked edits without dispatch', async () => {
    const h = await fixture(); h.role('Viewer'); await h.board.refresh(); await h.edit('Denied');
    assert.equal(h.events.at(-1)?.phase, 'error'); assert.equal(h.requests.length, 0);
    h.role('Owner'); await h.board.refresh(); await h.board.saveTaskField('missing', 'title', { value: 'Gone' });
    assert.equal(h.events.at(-1)?.phase, 'cancelled'); assert.equal(h.requests.length, 0);
});
test('feedback exceptions cannot alter a canonical mutation or its lineage', async () => {
    const h = await fixture(); h.listenerThrows(); const result = await h.edit('Saved');
    assert.equal(result.revision, 2); assert.equal(h.requests.length, 1);
    assert.equal(h.board.getSnapshot().tasks.get('one').title, 'Saved');
});
test('custom field preserves typed canonical payload and feedback key', async () => {
    const h = await fixture(); await h.board.saveTaskField('one', 'value', { value: '3', type: 'number', dataset: { columnId: 'c' } });
    assert.deepEqual(h.requests[0].values, { c: 3 }); assert.equal(h.events.at(-1)?.field, 'value:c');
});
test('a newer unsent input remains dirty when the previous save acknowledges', async () => {
    const h = await fixture(), held = h.hold(); const save = h.edit('First'); await tick();
    const input = h.elements.projectsBoardRows.querySelector('[data-field-kind="title"]');
    input.value = 'Unsent'; input.dispatchEvent(new h.dom.window.Event('input', { bubbles: true }));
    const dirty = h.events.at(-1); assert.equal(dirty.phase, 'dirty');
    held.resolve(); await save;
    assert.ok(h.events.at(-1).editVersion < dirty.editVersion);
    assert.equal(h.elements.projectsBoardRows.querySelector('[data-field-kind="title"]').value, 'Unsent');
});
test('actor change cancels in-flight feedback without acknowledging another account', async () => {
    const h = await fixture(), held = h.hold(); const save = h.edit('Old actor'); await tick();
    h.actor('other'); held.resolve(); await save;
    assert.equal(h.events.at(-1)?.phase, 'cancelled'); assert.equal(h.events.at(-1)?.scope.actorUid, 'actor');
    assert.ok(!h.events.some(e => e.phase === 'saved'));
});
