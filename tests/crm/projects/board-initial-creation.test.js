'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.resolve(__dirname, '../../../public/js/crm/projects/board.js'), 'utf8');
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(setImmediate); };

function fixture() {
    const node = () => ({ style: {}, listeners: {}, value: '', hidden: false, classList: { toggle() {} }, setAttribute() {}, focus() {}, addEventListener(k, f) { this.listeners[k] = f; }, querySelectorAll: () => [], querySelector: () => null });
    const elements = Object.fromEntries(['projectsBoardRows', 'projectsBoardStatus', 'projectsBoardProjectName', 'projectsBoardProjectDescription', 'projectsBoardCreateProject', 'projectsBoardAddTask'].map(key => [key, node()]));
    const save = node();
    const document = { activeElement: null, getElementById: id => id === 'btn-projects-board-save-project' ? save : null };
    const context = { console, document, URLSearchParams, setTimeout, clearTimeout, clearInterval, CSS: { escape: value => value } };
    vm.runInNewContext(source, context);
    let uid = 'eligible-admin', held = null;
    const writes = [], events = [], toasts = [];
    const persisted = { id: 'created-project', name: 'First board', lifecycle: 'active' };
    const board = context.CrmProjectsBoard.createController({
        elements, adminMode: true, getCurrentUser: () => ({ uid }),
        showToast: message => toasts.push(message),
        refreshProjects: async () => { events.push('refresh'); return true; },
        selectProject: async id => { events.push(`select:${id}`); },
        apiFetchJson: async (url, options) => {
            if (options) { writes.push({ url, options }); events.push('post'); return { project: persisted }; }
            if (url.endsWith('/member-directory')) return { people: [] };
            if (url.includes('/tasks?')) return { tasks: [{ id: 'task', title: 'Existing', lifecycle: 'active' }], sections: [], columns: [] };
            if (held) await held;
            return { project: { id: 'existing', lifecycle: 'active' }, membership: { role: 'Owner' } };
        }
    });
    board.init();
    board.setProjects({ projects: [], selectedProjectId: '' });
    elements.projectsBoardProjectName.value = persisted.name;
    return { board, elements, writes, events, toasts, save: () => save.listeners.click(), actor: value => { uid = value; }, hold() { let release; held = new Promise(resolve => { release = resolve; }); return release; } };
}

test('authenticated admin creates the first project while board authority is pending', async () => {
    const h = fixture();
    assert.equal(h.board.getState().authorityPending, true);
    await h.save();
    assert.equal(h.writes.length, 1);
    assert.equal(h.writes[0].url, '/api/projects');
    assert.equal(h.writes[0].options.method, 'POST');
    assert.equal(JSON.parse(h.writes[0].options.body).name, 'First board');
    assert.deepEqual(h.events, ['post', 'refresh', 'select:created-project']);
    assert.equal(h.elements.projectsBoardCreateProject.hidden, true);
});

test('pending existing-board authority blocks task mutation but permits project creation', async () => {
    const h = fixture();
    h.board.setProjects({ projects: [{ id: 'existing', role: 'Owner' }], selectedProjectId: 'existing' });
    await flush();
    const release = h.hold();
    const refresh = h.board.refresh();
    await flush();
    assert.equal(h.board.getState().authorityPending, true);
    const row = { dataset: { rowId: 'task:task', taskId: 'task', rowKind: 'task' }, closest() { return this; } };
    h.elements.projectsBoardRows.listeners.keydown({ target: row, key: 'n', ctrlKey: true, preventDefault() {} });
    await flush();
    assert.equal(h.writes.length, 0);
    await h.save();
    release();
    await refresh;
    assert.deepEqual(h.writes.map(write => write.url), ['/api/projects']);
});

test('changed actor cannot create a project through the old controller', async () => {
    const h = fixture();
    h.actor('different-admin');
    await h.save();
    assert.equal(h.writes.length, 0);
    assert.deepEqual(h.events, []);
    assert.match(h.toasts[0], /Refresh project access/);
});
