'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.resolve(__dirname, '../../../public/js/crm/projects/views.js'), 'utf8');
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(setImmediate); };
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
function harness() {
    const controls = new Map(), calls = [], boardFilters = [];
    let viewTasks = null;
    let boardOptions = { filterOptionsReady: true, sections: [], members: [] };
    let actor = 'actor-a', project = 'project-a', heldView = null, heldPreview = null, denyLinks = false, readOnly = false, viewFailure = null;
    function el(id) {
        if (!controls.has(id)) controls.set(id, { id, value: '', textContent: '', innerHTML: '', hidden: false, disabled: false, listeners: {}, fields: [], addEventListener(name, fn) { this.listeners[name] = fn; }, reset() {}, querySelectorAll(selector) { return selector.includes('projects-task-schedule') ? [el('projects-task-start'), el('projects-task-due'), el('projects-task-predecessors')] : []; }, replaceChildren(...children) { this.children = children; }, elements: { namedItem: (name) => el(`filter-${name}`) } });
        return controls.get(id);
    }
    const task = { id: 'task-a', title: 'Release task', revision: 2, status: 'not_started', pathIds: [], startDate: '2026-09-01', dueDate: '2026-09-02', derived: { activeLeafCount: 1, completedLeafCount: 0, completionPercent: 0, startDate: '2026-09-01', dueDate: '2026-09-02' } };
    const snapshot = () => ({ project: { id: project, lifecycle: 'active', revision: 1, structureRevision: 2 }, membership: { role: readOnly ? 'Viewer' : 'Owner' }, tasks: [task], matchingTaskCount: 640, hasMore: true, nextCursor: 'opaque-page-2', aggregates: { activeLeafTaskCount: 600, completedLeafTaskCount: 300, completionPercent: 50, byStatus: { done: 300, not_started: 300 }, byOwnerUid: { unassigned: 600 } } });
    let controller;
    const board = { getState: () => ({ project: { id: project }, membership: { role: 'Owner' }, ...boardOptions }), setFilters: (f) => boardFilters.push(f), selectTask: (t) => controller.setTask(t), refresh: async () => true };
    const context = { console, URLSearchParams, Date, Math, crypto: { randomUUID: () => 'operation' }, FormData: class { constructor(form) { return form.fields; } }, document: { getElementById: el, querySelectorAll: () => [], createElement: (id) => ({ ...el(`new-${id}-${controls.size}`) }) } };
    vm.runInNewContext(source, context);
    controller = context.CrmProjectsViews.createController({ board, getCurrentUser: () => ({ uid: actor }), apiFetchJson: async (url, options) => {
        calls.push({ url, options });
        if (url.includes('/views?')) { if (viewFailure) throw viewFailure; if (heldView) return heldView.promise;
            if (viewTasks) {
                const params = new URLSearchParams(url.split('?')[1]), filters = JSON.parse(params.get('filters'));
                assert.equal(params.get('pageSize'), '200');
                assert.ok(!filters.fromDate || !filters.toDate || filters.fromDate <= filters.toDate, 'API never receives inverted bounds');
                const matches = viewTasks.filter((t) => {
                    const start = t.startDate || t.dueDate, end = t.dueDate || t.startDate;
                    return (!filters.fromDate || (end && end >= filters.fromDate)) && (!filters.toDate || (start && start <= filters.toDate));
                });
                const offset = Number(params.get('cursor') || 0);
                return { ...snapshot(), tasks: matches.slice(offset, offset + 200), matchingTaskCount: matches.length, hasMore: matches.length > offset + 200, nextCursor: String(offset + 200) };
            }
            return snapshot(); }
        if (url.endsWith('/schedule-preview')) return heldPreview ? heldPreview.promise : { preview: { token: 'preview-token', canApply: true, before: {}, after: {}, warnings: [], nonWorkingDays: [] } };
        if (url.endsWith('/links')) return { canManage: !denyLinks && !readOnly, links: denyLinks ? [] : (readOnly ? [{ type: 'lead', recordId: 'allowed-id', label: 'Visible authorized lead', href: '/crm-admin.html#enquiry' }] : []) };
        return { result: { task: { id: task.id, revision: 3 } } };
    } });
    controller.init();
    return { setViewTasks: (rows) => { viewTasks = rows; }, controller, el, calls, boardFilters, task, snapshot, setBoardOptions: (value) => { boardOptions = value; }, setActor: (a) => { actor = a; }, setProject: (p) => { project = p; controller.setProject(p); }, holdView: () => { heldView = deferred(); return heldView; }, clearView: () => { heldView = null; }, holdPreview: () => { heldPreview = deferred(); return heldPreview; }, denyLinks: () => { denyLinks = true; }, readOnly: () => { readOnly = true; }, failView: (status) => { viewFailure = Object.assign(new Error('Project unavailable'), { status }); } };
}
test('shared filters survive view changes and full aggregate counts do not derive from visible rows', async () => {
    const h = harness(); h.setProject('project-a'); await flush();
    const form = h.el('projects-view-filters'); form.fields = [['status', 'done']];
    form.listeners.submit({ preventDefault() {}, target: form }); await flush();
    h.el('projects-view-tabs').listeners.click({ target: { closest: () => ({ dataset: { view: 'charts' } }) } });
    assert.equal(h.controller.getState().filters.status, 'done');
    assert.match(h.el('projects-view-summary').textContent, /640 matching tasks/);
    assert.match(h.el('projects-view-content').innerHTML, /300 of 600 active leaf tasks/);
    h.el('projects-view-tabs').listeners.click({ target: { closest: () => ({ dataset: { view: 'timeline' } }) } });
    assert.match(h.el('projects-view-content').innerHTML, /crm-projects-gantt-axis/);
    assert.doesNotMatch(h.el('projects-view-content').innerHTML, /crm-projects-gantt-bar is-derived/, 'leaf intervals must not be duplicated as descendant spans');
    assert.match(h.el('projects-view-content').innerHTML, /role="img" aria-label="Stored interval:/);
    assert.doesNotMatch(h.el('projects-view-content').innerHTML, /class="sr-only"/, 'bar accessibility must not depend on a missing global screen-reader utility');
    h.task.activeChildCount = 1;
    await h.controller.refresh(); await flush();
    assert.match(h.el('projects-view-content').innerHTML, /crm-projects-gantt-bar is-derived/);
    assert.match(h.el('projects-view-content').innerHTML, /has-derived-span/);
    assert.equal(h.controller.getState().filters.status, 'done');
});

test('board view suppresses the redundant summary while other views retain matching counts', async () => {
    const h = harness(); h.setProject('project-a'); await flush();
    assert.equal(h.el('projects-view-summary').textContent, '');

    h.el('projects-view-tabs').listeners.click({ target: { closest: () => ({ dataset: { view: 'charts' } }) } });
    assert.match(h.el('projects-view-summary').textContent, /640 matching tasks/);

    h.el('projects-view-tabs').listeners.click({ target: { closest: () => ({ dataset: { view: 'board' } }) } });
    assert.equal(h.el('projects-view-summary').textContent, '');

    const form = h.el('projects-view-filters'); form.fields = [['status', 'done']];
    form.listeners.submit({ preventDefault() {}, target: form }); await flush();
    assert.equal(h.el('projects-view-summary').textContent, '');
});
test('actor and project changes discard delayed view payloads', async () => {
    const h = harness(); h.setProject('project-a'); await flush(); const held = h.holdView();
    h.controller.refresh(); h.setActor('actor-b'); h.clearView(); h.setProject('project-b'); await flush();
    held.resolve({ ...h.snapshot(), matchingTaskCount: 9999, tasks: [{ id: 'secret-old-task' }] }); await flush();
    assert.equal(h.controller.getState().actorUid, 'actor-b');
    assert.equal(h.controller.getState().response.matchingTaskCount, 640);
    assert.equal(h.controller.getState().response.tasks[0].id, 'task-a');
});
test('new date input invalidates a pending preview and denied links disclose no metadata', async () => {
    const h = harness(); h.denyLinks(); h.setProject('project-a'); await flush(); h.controller.setTask(h.task); await flush();
    assert.doesNotMatch(h.el('projects-task-links').innerHTML, /forbidden-id|Forbidden name/);
    assert.doesNotMatch(h.el('projects-project-links').innerHTML, /forbidden-id|Forbidden name/);
    const held = h.holdPreview();
    h.el('projects-task-start').value = '2026-09-01'; h.el('projects-task-due').value = '2026-09-02';
    h.el('projects-task-planning').listeners.submit({ preventDefault() {}, target: { id: 'projects-task-schedule' } });
    h.el('projects-task-start').value = '2026-09-03';
    h.el('projects-task-planning').listeners.input({ target: { id: 'projects-task-start' } });
    held.resolve({ preview: { token: 'stale-token', canApply: true, before: {}, after: {} } }); await flush();
    assert.equal(h.el('projects-task-start').value, '2026-09-03');
    assert.match(h.el('projects-task-preview').textContent, /Generate a new preview/);
    assert.doesNotMatch(h.el('projects-task-preview').innerHTML, /Apply this exact preview/);
});

test('authorized read-only links remain visible while editing is unavailable', async () => {
    const h = harness(); h.readOnly(); h.setProject('project-a'); await flush(); h.controller.setTask(h.task); await flush();
    assert.match(h.el('projects-task-links').innerHTML, /Visible authorized lead/);
    assert.match(h.el('projects-project-links').innerHTML, /Visible authorized lead/);
    assert.doesNotMatch(h.el('projects-task-links').innerHTML, /id="projects-link-lookup"/);
    assert.doesNotMatch(h.el('projects-project-links').innerHTML, /id="projects-project-link-lookup"/);
});

test('same-task role downgrade disables editors without replacing newer input', async () => {
    const h = harness(); h.setProject('project-a'); await flush(); h.controller.setTask(h.task); await flush();
    h.el('projects-task-start').value = '2026-10-01'; h.el('projects-task-predecessors').value = 'new-draft';
    h.readOnly(); await h.controller.refresh(); await flush();
    assert.equal(h.el('projects-task-start').value, '2026-10-01');
    assert.equal(h.el('projects-task-predecessors').value, 'new-draft');
    assert.equal(h.el('projects-task-start').disabled, true);
    assert.equal(h.el('projects-task-predecessors').disabled, true);
});

for (const code of [401, 403, 404]) test(`view ${code} clears access and rejects old read/preview completions`, async () => {
    const h = harness(); h.setProject('project-a'); await flush(); h.controller.setTask(h.task); await flush();
    const preview = h.holdPreview();
    h.el('projects-task-planning').listeners.submit({ preventDefault() {}, target: { id: 'projects-task-schedule' } });
    const old = h.holdView(); const oldRead = h.controller.refresh();
    h.failView(code); await h.controller.refresh();
    assert.equal(h.controller.getState().response, null);
    assert.equal(h.controller.getState().selectedTaskId, undefined);
    assert.equal(h.controller.getState().projectId, '');
    assert.equal(h.el('projects-project-links').innerHTML, '');
    assert.equal(h.el('projects-task-planning').innerHTML, '');
    assert.equal(h.el('projects-view-summary').textContent, '');
    old.resolve(h.snapshot()); preview.resolve({ preview: { token: 'stale', canApply: true } }); await oldRead; await flush();
    assert.equal(h.controller.getState().response, null);
    assert.equal(h.el('projects-task-planning').innerHTML, '');
});
test('transient view failure retains authorized snapshot and typed dates', async () => {
    const h = harness(); h.setProject('project-a'); await flush(); h.controller.setTask(h.task);
    h.el('projects-task-start').value = '2026-10-02'; h.failView(503); await h.controller.refresh();
    assert.equal(h.controller.getState().response.matchingTaskCount, 640);
    assert.equal(h.el('projects-task-start').value, '2026-10-02');
});
test('undated parent renders only its legitimate derived timeline span', async () => {
    const h = harness(); h.task.startDate = null; h.task.dueDate = null; h.task.activeChildCount = 1;
    h.setProject('project-a'); await flush();
    h.el('projects-view-tabs').listeners.click({ target: { closest: () => ({ dataset: { view: 'timeline' } }) } });
    assert.match(h.el('projects-view-content').innerHTML, /Stored: undated/);
    assert.match(h.el('projects-view-content').innerHTML, /aria-label="Derived descendant span:/);
    assert.doesNotMatch(h.el('projects-view-content').innerHTML, /aria-label="Stored interval:/);
});

test('seven filter drafts survive intermediate empty board options and all view changes', async () => {
    const h = harness();
    h.setBoardOptions({ filterOptionsReady: true, sections: [{ id: 's1', title: 'Private section' }], members: [{ uid: 'u1', displayName: 'Private person' }] });
    h.setProject('project-a'); await flush();
    const form = h.el('projects-view-filters');
    const values = { title: 'Release', sectionId: 's1', status: 'done', ownerUid: 'u1', assigneeUid: 'u1', fromDate: '2026-09-01', toDate: '2026-09-30' };
    for (const [name, value] of Object.entries(values)) {
        const control = form.elements.namedItem(name); control.name = name; control.value = value;
        form.listeners.change({ target: control });
    }
    form.fields = Object.entries(values); form.listeners.submit({ preventDefault() {}, target: form }); await flush();
    h.setBoardOptions({ filterOptionsReady: false, sections: [], members: [] });
    for (const view of ['kanban', 'timeline', 'calendar', 'charts', 'board']) {
        h.el('projects-view-tabs').listeners.click({ target: { closest: () => ({ dataset: { view } }) } });
        for (const [name, value] of Object.entries(values)) assert.equal(form.elements.namedItem(name).value, value);
    }
    assert.match(form.elements.namedItem('sectionId').innerHTML, /Private section/);
    h.setBoardOptions({ filterOptionsReady: true, sections: [], members: [] }); h.controller.syncBoard();
    assert.equal(form.elements.namedItem('sectionId').value, 's1');
    assert.match(form.elements.namedItem('sectionId').innerHTML, /Selected filter unavailable/);
    assert.doesNotMatch(form.elements.namedItem('sectionId').innerHTML, /Private section/);
    h.controller.invalidateAccess('project-a');
    for (const name of Object.keys(values)) assert.equal(form.elements.namedItem(name).value, '');
});

test('project and account switches immediately remove old filter option IDs and labels', async () => {
    for (const accountSwitch of [false, true]) {
        const h = harness();
        h.setBoardOptions({ actorUid: 'actor-a', filterOptionsReady: true, sections: [{ id: 's1-private', title: 'Old section label' }], members: [{ uid: 'u1-private', displayName: 'Old member label' }] });
        h.setProject('project-a'); await flush();
        assert.match(h.el('filter-sectionId').innerHTML, /s1-private/);
        const held = h.holdView();
        if (accountSwitch) h.setActor('actor-b');
        else h.setBoardOptions({ actorUid: 'actor-a', filterOptionsReady: false, sections: [], members: [] });
        h.setProject(accountSwitch ? 'project-a' : 'project-b');
        for (const name of ['sectionId', 'ownerUid', 'assigneeUid']) assert.doesNotMatch(h.el(`filter-${name}`).innerHTML, /s1-private|u1-private|Old section label|Old member label/);
        held.resolve(h.snapshot()); await flush();
    }
});

const switchView = (h, view) => h.el('projects-view-tabs').listeners.click({ target: { closest: () => ({ dataset: { view } }) } });
const changeMonth = (h, value) => h.el('projects-view-content').listeners.change({ target: { id: 'projects-view-month', value } });
const viewCalls = (h) => h.calls.filter((c) => c.url.includes('/views?'));
const queryFilters = (call) => JSON.parse(new URLSearchParams(call.url.split('?')[1]).get('filters'));
test('calendar queries the selected month before paging past out-of-month tasks', async () => {
    const h = harness(); h.setProject('project-a'); await flush();
    const before = viewCalls(h).length;
    switchView(h, 'calendar'); await flush(); changeMonth(h, '2026-02'); await flush();
    assert.ok(viewCalls(h).length > before, 'entering Calendar must refetch with month bounds');
    assert.deepEqual(queryFilters(viewCalls(h).at(-1)), { fromDate: '2026-02-01', toDate: '2026-02-28' });
    assert.match(h.el('projects-view-summary').textContent, /matching tasks overlapping 2026-02/);
    assert.match(h.el('projects-view-content').innerHTML, /Tasks overlapping 2026-02 on this page/);
});

test('calendar month interval makes records beyond 200 unrelated tasks visible and bounds every page', async () => {
    const h = harness();
    h.setViewTasks([
        ...Array.from({ length: 205 }, (_, i) => ({ ...h.task, id: `old-${i}`, startDate: '2025-01-01', dueDate: '2025-01-02' })),
        ...Array.from({ length: 201 }, (_, i) => ({ ...h.task, id: `month-${i}`, startDate: '2026-02-01', dueDate: '2026-02-28' })),
        { ...h.task, id: 'boundary', startDate: '2026-01-31', dueDate: '2026-02-01' },
        { ...h.task, id: 'undated', startDate: null, dueDate: null }
    ]);
    h.setProject('project-a'); await flush();
    assert.equal(h.controller.getState().response.tasks[0].id, 'old-0');
    switchView(h, 'calendar'); await flush(); changeMonth(h, '2026-02'); await flush();
    assert.equal(h.controller.getState().response.matchingTaskCount, 202);
    assert.equal(h.controller.getState().response.tasks.length, 200);
    assert.equal(h.controller.getState().response.tasks[0].id, 'month-0');
    h.el('projects-view-more').listeners.click(); await flush();
    assert.equal(h.controller.getState().response.tasks.length, 2);
    assert.equal(h.controller.getState().response.tasks[1].id, 'boundary');
    assert.deepEqual(queryFilters(viewCalls(h).at(-1)), { fromDate: '2026-02-01', toDate: '2026-02-28' });
    assert.match(h.el('projects-view-summary').textContent, /Showing 201\u2013202 in this month page/);
    changeMonth(h, '2026-03'); await flush();
    assert.equal(new URLSearchParams(viewCalls(h).at(-1).url.split('?')[1]).has('cursor'), false);
    assert.equal(h.el('projects-view-previous').disabled, true);
    assert.equal(h.controller.getState().response.matchingTaskCount, 0);
});

test('month and Calendar boundary changes reset pagination and discard pending reads', async () => {
    const h = harness(); h.setProject('project-a'); await flush(); h.controller.setTask(h.task);
    h.el('projects-view-more').listeners.click(); await flush();
    assert.equal(h.el('projects-view-summary').textContent, '', 'Board view should not show the redundant matching-task summary');
    const old = h.holdView(); h.controller.refresh();
    h.clearView(); switchView(h, 'calendar'); await flush();
    assert.equal(h.el('projects-view-previous').disabled, true);
    assert.equal(new URLSearchParams(viewCalls(h).at(-1).url.split('?')[1]).has('cursor'), false);
    old.resolve({ ...h.snapshot(), matchingTaskCount: 9999 }); await flush();
    assert.equal(h.controller.getState().response.matchingTaskCount, 640);
    const monthRead = h.holdView(); changeMonth(h, '2026-04');
    assert.equal(h.controller.getState().response, null);
    h.clearView(); changeMonth(h, '2026-05'); await flush();
    monthRead.resolve({ ...h.snapshot(), matchingTaskCount: 8888 }); await flush();
    assert.equal(h.controller.getState().response.matchingTaskCount, 640);
    const leaving = h.holdView(); h.controller.refresh();
    h.clearView(); switchView(h, 'charts'); await flush();
    leaving.resolve({ ...h.snapshot(), matchingTaskCount: 7777 }); await flush();
    assert.equal(h.controller.getState().response.matchingTaskCount, 640);
    assert.deepEqual(queryFilters(viewCalls(h).at(-1)), {});
    assert.equal(h.controller.getState().selectedTaskId, 'task-a');
});

test('calendar intersects shared date filters, restores them on exit and projects disjoint ranges empty', async () => {
    const h = harness(); h.setProject('project-a'); await flush();
    const filters = { status: 'done', fromDate: '2026-02-15', toDate: '2026-03-10' };
    const form = h.el('projects-view-filters'); form.fields = Object.entries(filters);
    form.listeners.submit({ preventDefault() {}, target: form }); await flush();
    switchView(h, 'calendar'); await flush(); changeMonth(h, '2026-02'); await flush();
    assert.deepEqual(queryFilters(viewCalls(h).at(-1)), { ...filters, toDate: '2026-02-28' });
    changeMonth(h, '2026-03'); await flush();
    assert.deepEqual(queryFilters(viewCalls(h).at(-1)), { ...filters, fromDate: '2026-03-01' });
    changeMonth(h, '2026-04'); await flush();
    const query = queryFilters(viewCalls(h).at(-1)); assert.ok(query.fromDate <= query.toDate);
    assert.equal(h.controller.getState().response.tasks.length, 0);
    assert.equal(h.controller.getState().response.matchingTaskCount, 0);
    assert.equal(h.controller.getState().response.aggregates.activeLeafTaskCount, 0);
    assert.equal(h.el('projects-view-more').disabled, true);
    assert.match(h.el('projects-view-content').innerHTML, /shared date filters do not overlap this month/);
    assert.equal(JSON.stringify(h.controller.getState().filters), JSON.stringify(filters));
    switchView(h, 'timeline'); await flush();
    assert.deepEqual(queryFilters(viewCalls(h).at(-1)), filters);
    assert.equal(JSON.stringify(h.boardFilters.at(-1)), JSON.stringify(filters));
    assert.equal(h.controller.getState().response.matchingTaskCount, 640);
});

test('disjoint calendar month still rechecks access and role', async () => {
    const h = harness(); h.setProject('project-a'); await flush(); h.controller.setTask(h.task);
    const form = h.el('projects-view-filters'); form.fields = [['fromDate', '2025-01-01'], ['toDate', '2025-02-01']];
    form.listeners.submit({ preventDefault() {}, target: form }); await flush();
    h.readOnly(); switchView(h, 'calendar'); await flush();
    assert.equal(h.controller.getState().response.membership.role, 'Viewer');
    assert.equal(h.el('projects-task-start').disabled, true);
    h.failView(403); changeMonth(h, '2026-08'); await flush();
    assert.equal(h.controller.getState().projectId, '');
});
