'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const stateContext = {};
vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../../public/js/crm/projects/state.js'), 'utf8'), stateContext);
const { createBoardState } = stateContext.CrmProjectsBoardState;
const source = fs.readFileSync(path.resolve(__dirname, '../../../public/js/crm/projects/board.js'), 'utf8');
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(setImmediate); };
function fixture() {
    let actor = 'staff', failure = 0;
    let tasks = Array.from({ length: 22 }, (_, i) => ({ id: `t${i}`, title: `Task ${i}`, lifecycle: 'active', revision: 1, pathIds: [] }));
    tasks.push({ id: 'context', contextOnly: true }, { id: 'archived', lifecycle: 'archived' });
    const callbacks = [], handlers = {};
    const rows = { addEventListener: (event, handler) => { handlers[event] = handler; }, querySelector: () => null, querySelectorAll: () => [], innerHTML: '', textContent: '' };
    const context = { console, URLSearchParams, clearTimeout, clearInterval, document: { activeElement: null, getElementById: () => null } };
    vm.runInNewContext(source, context);
    const board = context.CrmProjectsBoard.createController({ elements: { projectsBoardRows: rows }, getCurrentUser: () => ({ uid: actor }), onContextChanged: value => callbacks.push(value), apiFetchJson: async url => {
        if (failure) throw Object.assign(Error('Denied'), { status: failure });
        if (url.endsWith('/member-directory')) return { people: [] };
        if (url.includes('/tasks?')) return { tasks, sections: [], columns: [], revision: {} };
        return { project: { id: url.split('/').pop(), lifecycle: 'active' }, membership: { role: 'Owner' } };
    } });
    board.init(); board.setProjects({ projects: [{ id: 'p', role: 'Owner' }], selectedProjectId: 'p' });
    return { board, callbacks, handlers, setTasks: next => { tasks = next; }, setActor: next => { actor = next; }, fail: () => { failure = 403; } };
}
const ids = board => Array.from(board.getSnapshot().selectedTaskIds);
test('board state selection is bounded, copied, stable and independent of details/drafts', () => {
    const state = createBoardState(); state.switchProject('p'); state.setView({ selectedTaskId: 'detail' }); state.setDraft('detail', 'title', 'manual');
    state.setSelectedTaskIds(['b', 'a', 'b']); assert.deepEqual(Array.from(state.getView().selectedTaskIds), ['b', 'a']);
    state.getView().selectedTaskIds.push('forged'); assert.deepEqual(Array.from(state.getView().selectedTaskIds), ['b', 'a']);
    assert.equal(state.getView().selectedTaskId, 'detail'); assert.equal(state.getDraft('detail', 'title'), 'manual');
    assert.throws(() => state.setSelectedTaskIds(Array.from({ length: 21 }, (_, i) => String(i))));
    assert.throws(() => state.setSelectedTaskIds([null]));
    state.switchProject('p'); assert.deepEqual(Array.from(state.getView().selectedTaskIds), ['b', 'a']); state.switchProject('other'); assert.deepEqual(Array.from(state.getView().selectedTaskIds), []);
});
test('controller filters unavailable/context/inactive IDs, bounds selection, notifies immediately and keeps details independent', async () => {
    const f = fixture(); await flush(); f.board.selectTask({ id: 't4', title: 'Detail' });
    f.board.setSelectedTaskIds(['t2', 't1', 't2', 'context', 'archived', 'missing']); assert.deepEqual(ids(f.board), ['t2', 't1']); assert.equal(f.board.getState().selectedTaskId, 't4');
    assert.deepEqual(Array.from(f.callbacks.at(-1).selectedTaskIds), ['t2', 't1']);
    const count = f.callbacks.length; f.board.setSelectedTaskIds(['t2', 't1']); assert.equal(f.callbacks.length, count);
    assert.throws(() => f.board.setSelectedTaskIds(Array.from({ length: 21 }, (_, i) => `t${i}`))); assert.deepEqual(ids(f.board), ['t2', 't1']);
    f.board.setSelectedTaskIds(Array.from({ length: 20 }, (_, i) => `t${i}`)); assert.equal(ids(f.board).length, 20);
});
test('refresh keeps only surviving selectable tasks; project/account/authority invalidation clears selection', async () => {
    const f = fixture(); await flush(); f.board.setSelectedTaskIds(['t2', 't1']);
    f.setTasks([{ id: 't1', lifecycle: 'active' }, { id: 't2', contextOnly: true }]); await f.board.refresh(); assert.deepEqual(ids(f.board), ['t1']);
    f.board.setProjects({ projects: [{ id: 'other', role: 'Owner' }], selectedProjectId: 'other' }); assert.deepEqual(ids(f.board), []); await flush();
    f.board.setSelectedTaskIds(['t1']); f.setActor('other_actor'); assert.deepEqual(ids(f.board), []); f.setActor('staff'); assert.deepEqual(ids(f.board), []);
    f.board.setSelectedTaskIds(['t1']); f.fail(); await f.board.refresh(); assert.deepEqual(ids(f.board), []);
});
test('native checkbox click (including Space activation) toggles without detail or edit; normal row click still opens detail', async () => {
    const f = fixture(); await flush(); let stopped = 0;
    const row = { dataset: { rowId: 'task:t1', rowKind: 'task', taskId: 't1' } };
    const checkbox = { dataset: { action: 'select-task' }, checked: true, closest: selector => selector === '[data-row-id]' ? row : selector === '[data-action]' ? checkbox : null };
    f.handlers.click({ target: checkbox, stopPropagation: () => { stopped += 1; } }); assert.deepEqual(ids(f.board), ['t1']); assert.equal(f.board.getState().selectedTaskId, '');
    // Native checkbox Space dispatches click; the row key handler leaves it native.
    f.handlers.keydown({ target: checkbox, key: ' ', preventDefault: () => assert.fail('Native Space must remain available') });
    f.handlers.click({ target: checkbox, stopPropagation: () => { stopped += 1; } }); assert.deepEqual(ids(f.board), []); assert.equal(stopped, 2);
    f.handlers.click({ target: { closest: selector => selector === '[data-row-id]' ? row : null } }); assert.equal(f.board.getState().selectedTaskId, 't1'); assert.deepEqual(ids(f.board), []);
});

test('focused checkbox stays attached while remote title and readonly permission controls replace stale siblings', () => {
    const start = source.indexOf('        function syncFocusedSelectionCell(');
    const end = source.indexOf('        function syncPinnedExpander(', start);
    const helper = vm.runInNewContext(`(${source.slice(start, end).trim()})`);
    function cell(children, attributes = {}) {
        const element = { childNodes: children, attributes: Object.entries(attributes).map(([name, value]) => ({ name, value })), contains: node => element.childNodes.includes(node), querySelector: () => element.childNodes.find(node => node.checkbox) || null,
            hasAttribute: name => element.attributes.some(attribute => attribute.name === name), removeAttribute: name => { element.attributes = element.attributes.filter(attribute => attribute.name !== name); }, setAttribute: (name, value) => { element.removeAttribute(name); element.attributes.push({ name, value }); },
            insertBefore(node, before) { node.remove(); element.childNodes.splice(element.childNodes.indexOf(before), 0, node); node.parent = element; }, appendChild(node) { node.remove(); element.childNodes.push(node); node.parent = element; } };
        for (const child of children) { child.parent = element; child.remove = function () { if (this.checkbox && this.focused) assert.fail('Focused checkbox was detached'); if (this.parent) this.parent.childNodes.splice(this.parent.childNodes.indexOf(this), 1); this.parent = null; }; }
        return element;
    }
    const checkbox = { checkbox: true, focused: true }, staleEditor = { type: 'input', value: 'Old title' };
    const current = cell([checkbox, { type: 'expander', expanded: false }, staleEditor], { role: 'cell', class: 'old' });
    const readonlyTitle = { type: 'span', text: 'Remote renamed title' }, newExpander = { type: 'expander', expanded: true };
    const fresh = cell([{ checkbox: true }, newExpander, readonlyTitle], { role: 'cell', class: 'fresh' });
    assert.equal(helper(current, fresh, checkbox), true);
    assert.equal(current.childNodes[0], checkbox); assert.equal(checkbox.parent, current); assert.equal(checkbox.focused, true);
    assert.equal(current.childNodes[1], newExpander); assert.equal(current.childNodes[2], readonlyTitle); assert.equal(current.childNodes.includes(staleEditor), false);
    assert.equal(current.attributes.find(attribute => attribute.name === 'class').value, 'fresh');
});

test('preserved refresh restores checkbox focus rather than moving keyboard input to the row', () => {
    const start = source.indexOf('        function snapshotView()');
    const end = source.indexOf('        function invalidateAccess(', start);
    const row = { dataset: { rowId: 'task:t1', taskId: 't1' }, focus: () => assert.fail('Checkbox focus must not fall back to row') };
    let focused = false;
    const checkbox = { dataset: { action: 'select-task' }, closest: selector => selector === '[data-section-id]' ? null : row, focus: () => { focused = true; } };
    const document = { activeElement: checkbox, getElementById: () => null };
    const elements = { projectsBoardScroll: { scrollTop: 92, scrollLeft: 0 }, projectsBoardRows: { querySelector: selector => selector.includes('[data-action="select-task"]') ? checkbox : row } };
    const helpers = vm.runInNewContext(`(() => { ${source.slice(start, end)}; return { snapshotView, restoreView }; })()`, { document, elements, focusedRowId: '', CSS: { escape: value => value } });
    const view = helpers.snapshotView(); document.activeElement = null; helpers.restoreView(view);
    assert.equal(focused, true); assert.equal(elements.projectsBoardScroll.scrollTop, 92);
});
