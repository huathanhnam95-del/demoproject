'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.resolve(__dirname, '../../../public/js/crm/projects/board.js'), 'utf8');
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(setImmediate); };
function setup() {
    let failure = null, held = null;
    const notices = [];
    const node = () => ({ hidden: false, innerHTML: '', textContent: '', value: '', disabled: false, setAttribute() {}, querySelectorAll: () => [], querySelector: () => null });
    const elements = Object.fromEntries(['projectsBoardWorkspace', 'projectsBoardEmpty', 'projectsBoardDetail', 'projectsBoardDetailTitle', 'projectsBoardDetailBody', 'projectsBoardProjectSelect', 'projectsBoardCount', 'projectsBoardAddTask'].map((key) => [key, node()]));
    const task = { id: 'task-a', title: 'Secret task', revision: 1, status: 'not_started', pathIds: [] };
    const context = { console, URLSearchParams, clearTimeout, clearInterval, document: { activeElement: null, getElementById: () => null }, projectsViewsController: { invalidateAccess: (...args) => notices.push(args) } };
    vm.runInNewContext(source, context);
    const board = context.CrmProjectsBoard.createController({ elements, getCurrentUser: () => ({ uid: 'actor' }), apiFetchJson: async (url) => {
        if (url.endsWith('/member-directory')) return { people: [{ uid: 'actor', displayName: 'Private member' }] };
        if (url.includes('/tasks?')) return { tasks: [task], sections: [], columns: [], revision: {} };
        if (failure) throw Object.assign(new Error('Project unavailable'), { status: failure });
        if (held) return held.promise;
        return { project: { id: 'project-a', name: 'Private project', lifecycle: 'active', revision: 1 }, membership: { role: 'Owner' } };
    } });
    board.setProjects({ projects: [{ id: 'project-a', name: 'Private project', role: 'Owner' }], selectedProjectId: 'project-a' });
    return { board, task, elements, notices, fail: (code) => { failure = code; }, hold: () => { let resolve; const promise = new Promise((r) => { resolve = r; }); held = { promise, resolve }; return held; } };
}
for (const code of [401, 403, 404]) test(`board refresh ${code} never restores cached project/tasks`, async () => {
    const h = setup(); await flush(); h.board.selectTask(h.task);
    assert.equal(h.board.getState().tasks.size, 1); assert.match(h.elements.projectsBoardDetailBody.innerHTML, /task-a/);
    h.fail(code); await h.board.refresh();
    const state = h.board.getState();
    assert.equal(state.project, null); assert.equal(state.membership, null); assert.equal(state.tasks.size, 0); assert.equal(state.members.length, 0); assert.equal(state.selectedTaskId, '');
    assert.equal(h.elements.projectsBoardDetailBody.innerHTML, ''); assert.equal(h.elements.projectsBoardWorkspace.hidden, true); assert.equal(h.elements.projectsBoardAddTask.disabled, true);
    assert.doesNotMatch(h.elements.projectsBoardProjectSelect.innerHTML, /Private project/);
    assert.equal(h.notices.length, 1);
});
test('external view denial invalidates a board refresh already in flight', async () => {
    const h = setup(); await flush(); const held = h.hold(); const pending = h.board.refresh(); await flush();
    h.board.invalidateAccess('project-a', false);
    held.resolve({ project: { id: 'project-a', name: 'Late secret', lifecycle: 'active' }, membership: { role: 'Owner' } }); await pending;
    assert.equal(h.board.getState().project, null); assert.equal(h.board.getState().tasks.size, 0); assert.equal(h.notices.length, 0);
});
test('transient board refresh failure retains authorized cached state', async () => {
    const h = setup(); await flush(); h.fail(503); await h.board.refresh();
    assert.equal(h.board.getState().project.id, 'project-a'); assert.equal(h.board.getState().tasks.size, 1);
    assert.equal(h.notices.length, 0);
});

test('explicit empty selectedProjectId never falls back to another project', async () => {
    const h = setup(); await flush();
    h.board.setProjects({ projects: [{ id: 'other', name: 'Other project', role: 'Owner' }], selectedProjectId: '' });
    await flush(); assert.equal(h.board.getState().project, null); assert.equal(h.board.getState().tasks.size, 0);
});
