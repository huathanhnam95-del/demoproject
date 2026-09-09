'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require(process.env.CRM_TEST_JSDOM || 'jsdom');
const source = fs.readFileSync(path.resolve(__dirname, '../../../public/js/crm/projects/views.js'), 'utf8');
const flush = async () => { for (let n = 0; n < 4; n++) await new Promise(setImmediate); };
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function harness() {
    const dom = new JSDOM('<div id="projects-task-planning"></div><div id="projects-view-status"></div>', { runScripts: 'outside-only', url: 'https://example.test/' });
    const { window } = dom;
    window.eval(source);
    let actor = 'actor-a', project = 'project-a', hold = null;
    const selected = { id: 'task-a', title: 'Selected task', revision: 1, status: 'not_started', startDate: '2026-09-01', dueDate: '2026-09-02' };
    let rows = [selected];
    const snapshot = (tasks = rows, id = project) => ({ project: { id, lifecycle: 'active', revision: 1 }, membership: { role: 'Owner' }, tasks, matchingTaskCount: tasks.length });
    let controller;
    const board = { getState: () => ({ project: { id: project }, membership: { role: 'Owner' } }), selectTask: task => controller.setTask(task) };
    controller = window.CrmProjectsViews.createController({ board, getCurrentUser: () => ({ uid: actor }), apiFetchJson: async url => {
        if (url.includes('/views?')) return hold ? hold.promise : snapshot();
        if (url.endsWith('/schedule-preview')) return { preview: { token: 'exact-preview', canApply: true, before: {}, after: { startDate: '2026-10-01' } } };
        return { links: [], canManage: false };
    } });
    controller.init();
    return { dom, window, controller, selected, snapshot, el: id => window.document.getElementById(id), options() { return Array.from(this.el('projects-task-predecessor-picker').options, option => option.value); }, rows(value) { rows = value; }, hold() { hold = deferred(); return hold; }, clearHold() { hold = null; }, setProject(id = project, uid = actor) { project = id; actor = uid; controller.setProject(id); } };
}
const predecessor = { id: 'predecessor', title: 'Available predecessor' };
test('held accepted view updates actual picker built before response, preserving detail drafts', async () => {
    const h = harness();
    try {
        const held = h.hold(); h.setProject(); h.controller.setTask(h.selected);
        const picker = h.el('projects-task-predecessor-picker'), schedule = h.el('projects-task-schedule'), dependencies = h.el('projects-task-predecessors');
        h.el('projects-task-start').value = '2026-10-01'; dependencies.value = 'unsaved-dependency';
        assert.deepEqual(h.options(), ['']);
        held.resolve(h.snapshot([h.selected, predecessor])); await flush();
        assert.deepEqual(h.options(), ['', predecessor.id], 'accepted page must replace stale empty options');
        assert.equal(h.el('projects-task-predecessor-picker'), picker);
        assert.equal(h.el('projects-task-schedule'), schedule);
        assert.equal(h.el('projects-task-start').value, '2026-10-01');
        assert.equal(dependencies.value, 'unsaved-dependency');
        picker.value = predecessor.id;
        h.el('projects-task-predecessor-add').click();
        assert.equal(dependencies.value, 'unsaved-dependency\npredecessor', 'actual Add predecessor handler uses refreshed option');
    } finally { h.dom.window.close(); }
});
test('accepted pages update options without losing valid selection, preview or draft inputs', async () => {
    const h = harness();
    try {
        h.rows([h.selected, predecessor]); h.setProject(); await flush(); h.controller.setTask(h.selected); await flush();
        const picker = h.el('projects-task-predecessor-picker'); picker.value = predecessor.id;
        const input = h.el('projects-task-start'); input.value = '2026-10-01';
        const dependencies = h.el('projects-task-predecessors'); dependencies.value = 'unsaved-dependency';
        h.el('projects-task-schedule').dispatchEvent(new h.window.Event('submit', { bubbles: true, cancelable: true })); await flush();
        const apply = h.el('projects-task-apply'), preview = h.el('projects-task-preview').innerHTML;
        assert.equal(apply.disabled, false);
        h.rows([h.selected, { ...predecessor, title: 'Renamed predecessor' }, { id: 'other', title: 'Other' }]);
        await h.controller.refresh(); await flush();
        assert.deepEqual(h.options(), ['', 'predecessor', 'other']);
        assert.equal(picker.value, predecessor.id);
        assert.equal(picker.selectedOptions[0].textContent, 'Renamed predecessor');
        assert.equal(h.el('projects-task-start'), input); assert.equal(input.value, '2026-10-01');
        assert.equal(dependencies.value, 'unsaved-dependency'); assert.equal(h.el('projects-task-apply'), apply);
        assert.equal(h.el('projects-task-preview').innerHTML, preview); assert.equal(apply.disabled, false);
        h.rows([{ id: 'other', title: 'Other' }]); await h.controller.refresh(); await flush();
        assert.deepEqual(h.options(), ['', 'other'], 'page change updates options even when selected task is absent');
        assert.equal(picker.value, '', 'selection unavailable on new page is cleared');
        assert.equal(dependencies.value, 'unsaved-dependency');
        assert.equal(h.el('projects-task-start'), input); assert.equal(input.value, '2026-10-01');
        assert.equal(h.el('projects-task-apply'), apply); assert.equal(apply.disabled, false);
        assert.equal(h.el('projects-task-preview').innerHTML, preview);
    } finally { h.dom.window.close(); }
});
for (const account of [false, true]) test(`stale ${account ? 'actor' : 'project'} response cannot publish picker options`, async () => {
    const h = harness();
    try {
        h.rows([h.selected, predecessor]); h.setProject(); await flush(); h.controller.setTask(h.selected);
        const old = h.hold(); const pending = h.controller.refresh();
        h.clearHold(); h.rows([h.selected, { id: 'current', title: 'Current scope' }]);
        h.setProject(account ? 'project-a' : 'project-b', account ? 'actor-b' : 'actor-a'); await flush(); h.controller.setTask(h.selected);
        assert.deepEqual(h.options(), ['', 'current']);
        old.resolve(h.snapshot([h.selected, { id: 'secret', title: 'Old scope' }], 'project-a')); await pending; await flush();
        assert.deepEqual(h.options(), ['', 'current']);
    } finally { h.dom.window.close(); }
});
