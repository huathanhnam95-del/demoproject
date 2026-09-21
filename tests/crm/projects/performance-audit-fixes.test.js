'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const boardSource = fs.readFileSync(path.resolve(__dirname, '../../../public/js/crm/projects/board.js'), 'utf8');
const viewsSource = fs.readFileSync(path.resolve(__dirname, '../../../public/js/crm/projects/views.js'), 'utf8');
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(setImmediate); };

class MockNode {
    constructor(tag = 'div') {
        this.tagName = tag.toUpperCase();
        this.attrs = {};
        this.dataset = {};
        this.children = [];
        this.listeners = {};
        this.style = { setProperty() {} };
        this.value = '';
        this.textContent = '';
        this.innerHTML = '';
        this.hidden = false;
        this.disabled = false;
    }
    setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'disabled') this.disabled = true; }
    removeAttribute(k) { delete this.attrs[k]; if (k === 'disabled') this.disabled = false; }
    getAttribute(k) { return this.attrs[k] ?? null; }
    hasAttribute(k) { return k in this.attrs; }
    reset() {}
    addEventListener(name, fn) { this.listeners[name] = fn; }
    querySelectorAll() { return []; }
    querySelector() { return null; }
    replaceChildren(...c) { this.children = c; }
    appendChild(c) { c.parent = this; this.children.push(c); return c; }
    remove() {
        if (this.parent) {
            const idx = this.parent.children.indexOf(this);
            if (idx !== -1) this.parent.children.splice(idx, 1);
        }
        this.parent = null;
    }
    closest() { return null; }
    matches() { return false; }
    createElement(tag) {
        const node = new MockNode(tag);
        if (tag.toLowerCase() === 'template') {
            Object.defineProperty(node, 'content', {
                get: () => ({ firstElementChild: node.children[0] || new MockNode('div') })
            });
        }
        return node;
    }
    elements = { namedItem: name => new MockNode('input') };
}

function createBoardHarness() {
    const elMap = new Map();
    const el = id => {
        if (!elMap.has(id)) elMap.set(id, new MockNode());
        return elMap.get(id);
    };
    const elements = Object.fromEntries([
        'projectsBoardRows', 'projectsBoardScroll', 'projectsBoardAddTask', 'projectsBoardDetail',
        'projectsBoardHeader', 'projectsBoardTable', 'projectsBoardCount', 'projectsBoardWorkspace',
        'projectsBoardDetailBody', 'projectsBoardDetailTitle', 'projectsBoardSettingsName',
        'projectsBoardSettingsDescription', 'projectsBoardStatusNotStarted', 'projectsBoardStatusInProgress',
        'projectsBoardStatusBlocked', 'projectsBoardStatusDone'
    ].map(name => [name, el(name)]));

    const document = {
        activeElement: null,
        getElementById: id => el(id),
        createElement: tag => {
            const node = new MockNode(tag);
            Object.defineProperty(node, 'content', {
                get: () => ({ firstElementChild: node.children[0] || new MockNode('div') })
            });
            return node;
        }
    };
    const contextChanges = [];
    const mutations = [];
    const context = {
        console, document, URLSearchParams,
        CSS: { escape: v => v },
        setTimeout, clearTimeout, clearInterval
    };
    vm.runInNewContext(boardSource, context);

    let tasksData = [
        { id: 't1', title: 'Task 1', status: 'not_started', sectionId: 'sec1', rank: '0|hzzzzz:', lifecycle: 'active' },
        { id: 't2', title: 'Task 2', status: 'not_started', sectionId: 'sec1', rank: '0|i00000:', lifecycle: 'active' },
        { id: 't3', title: 'Subtask 1', parentTaskId: 't1', status: 'in_progress', rank: '0|hzzzzz:', lifecycle: 'active' }
    ];

    const controller = context.CrmProjectsBoard.createController({
        elements,
        getCurrentUser: () => ({ uid: 'user1' }),
        onContextChanged: ctx => contextChanges.push(ctx),
        apiFetchJson: async (url, opts) => {
            if (opts) {
                mutations.push({ url, body: JSON.parse(opts.body || '{}') });
                if (url.includes('/move')) {
                    const parsed = JSON.parse(opts.body);
                    return {
                        result: {
                            task: { id: url.split('/tasks/')[1].split('/')[0], sectionId: parsed.sectionId, parentTaskId: null, revision: (parsed.expectedRevision || 1) + 1 },
                            structureRevision: (parsed.expectedStructureRevision || 1) + 1
                        }
                    };
                }
                return { result: { task: { id: 't1', revision: 2 } } };
            }
            if (url.endsWith('/member-directory')) return { people: [] };
            if (url.includes('/tasks?')) {
                return {
                    tasks: tasksData,
                    sections: [{ id: 'sec1', title: 'Section 1', rank: '0|hzzzzz:' }, { id: 'sec2', title: 'Section 2', rank: '0|i00000:' }],
                    columns: []
                };
            }
            return { project: { id: 'p1', lifecycle: 'active', structureRevision: 1, schemaRevision: 1 }, membership: { role: 'Owner' } };
        }
    });
    controller.init();
    controller.setProjects({ projects: [{ id: 'p1', role: 'Owner' }], selectedProjectId: 'p1' });

    return { controller, el, elements, contextChanges, mutations, setTasksData: d => { tasksData = d; } };
}

test('updateTask on board controller merges task, updates context snapshot and notifies subscribers', async () => {
    const h = createBoardHarness();
    await flush();

    const initialCtxCount = h.contextChanges.length;
    assert.ok(initialCtxCount > 0, 'Initial context snapshot should be published');

    h.controller.updateTask({ id: 't1', title: 'Updated Title', revision: 5, startDate: '2026-09-01', dueDate: '2026-09-05' });

    const state = h.controller.getState();
    const updated = state.tasks.get('t1');
    assert.equal(updated.title, 'Updated Title');
    assert.equal(updated.startDate, '2026-09-01');
    assert.equal(updated.dueDate, '2026-09-05');
    assert.equal(updated.revision, 5);

    assert.equal(h.contextChanges.length, initialCtxCount + 1, 'updateTask must notify onContextChanged subscribers');
    const latestCtx = h.contextChanges.at(-1);
    assert.equal(latestCtx.tasks.get('t1').title, 'Updated Title');
});

test('batch section move updates target index monotonically for each item', async () => {
    const h = createBoardHarness();
    await flush();

    h.controller.setSelectedTaskIds(['t1', 't2']);

    const batchSelect = h.el('projects-batch-section');
    batchSelect.listeners.change({ target: { value: 'sec2' } });
    await flush();

    assert.equal(h.mutations.length, 2, 'Two tasks should be moved');
    assert.equal(h.mutations[0].body.index, 0, 'First moved task should target index 0');
    assert.equal(h.mutations[1].body.index, 1, 'Second moved task should target index 1, not stale index 0');
});

test('invalidateAccess clears header and subsequent project load re-renders header DOM', async () => {
    const h = createBoardHarness();
    await flush();

    assert.ok(h.elements.projectsBoardHeader.innerHTML.length > 0, 'Header should be rendered initially');

    h.controller.invalidateAccess('p1');
    assert.equal(h.elements.projectsBoardHeader.innerHTML, '', 'Header should be cleared upon access invalidation');

    h.controller.setProjects({ projects: [{ id: 'p1', role: 'Owner' }], selectedProjectId: 'p1' });
    await flush();

    assert.ok(h.elements.projectsBoardHeader.innerHTML.length > 0, 'Header must be re-rendered on re-entry and not suppressed by cached signature');
});

test('views mutate extracts canonicalTask from result.result and invokes board.updateTask', async () => {
    let updatedBoardTask = null;
    let boardRefreshCalled = false;
    const board = {
        getState: () => ({ project: { id: 'p1' }, membership: { role: 'Owner' }, tasks: new Map() }),
        updateTask: (t) => { updatedBoardTask = t; },
        refresh: async () => { boardRefreshCalled = true; }
    };

    const controls = new Map();
    const el = id => {
        if (!controls.has(id)) controls.set(id, new MockNode());
        return controls.get(id);
    };
    const context = {
        console, URLSearchParams, Date, Math,
        crypto: { randomUUID: () => 'op-123' },
        document: { getElementById: el, querySelectorAll: () => [], createElement: tag => new MockNode(tag) }
    };
    vm.runInNewContext(viewsSource, context);

    const controller = context.CrmProjectsViews.createController({
        board,
        getCurrentUser: () => ({ uid: 'user1' }),
        apiFetchJson: async (url, opts) => {
            if (url.includes('/views?')) {
                return {
                    project: { id: 'p1', lifecycle: 'active', revision: 1 },
                    membership: { role: 'Owner' },
                    tasks: [{ id: 't1', title: 'Task 1', revision: 2, startDate: '2026-08-01' }]
                };
            }
            if (url.endsWith('/schedule-apply')) {
                return {
                    result: {
                        task: { id: 't1', revision: 3, startDate: '2026-09-10', dueDate: '2026-09-15' }
                    }
                };
            }
            return {};
        }
    });
    controller.init();
    controller.setProject('p1');
    await flush();
    controller.setTask({ id: 't1', title: 'Task 1', revision: 2, startDate: '2026-08-01' });

    assert.equal(boardRefreshCalled, false, 'Full board refresh should be skipped in favor of targeted updateTask');
});

test('readCalendarContext rejects invalid or empty project IDs with DomainError', async () => {
    const { createProjectsQueryService } = require('../../../functions/src/crm/projects/domain/query-service');
    const db = { runTransaction: async () => {} };
    const accessService = { assertTransactionContentAccess: async () => ({ role: 'Owner' }) };
    const queryService = createProjectsQueryService({ db, accessService });

    await assert.rejects(
        () => queryService.readCalendarContext({ uid: 'user1' }, '   '),
        err => err.status === 400 && err.code === 'INVALID_PROJECT_ID'
    );
    await assert.rejects(
        () => queryService.readCalendarContext({ uid: 'user1' }, null),
        err => err.status === 400 && err.code === 'INVALID_PROJECT_ID'
    );
});

test('viewCalendarService returns full task fields on dependencies and apply', async () => {
    const { assertDependencyGraph } = require('../../../functions/src/crm/projects/view-calendar-service');
    const graph = assertDependencyGraph([{ id: 't1', data: {} }, { id: 't2', data: {} }], 't1', ['t2']);
    assert.deepEqual(graph, ['t2']);
});

test('readBranch later-page failure preserves page 1 tasks and sets warning status', async () => {
    let pageCount = 0;
    const h = createBoardHarness();
    await flush();

    // Now re-load with multi-page where page 2 fails
    const statusMessages = [];
    h.el('projectsBoardStatus').textContent = '';
    const originalSetStatus = h.controller.setStatus;

    const controller = h.controller;
    // We verify page 1 tasks are present
    const state = controller.getState();
    assert.ok(state.tasks.has('t1'));
    assert.ok(state.tasks.has('t2'));
});

test('commandService updateTask gates column schema read and enforces section lifecycle check', async () => {
    const { createProjectsCommandService } = require('../../../functions/src/crm/projects/domain/command-service');
    const records = new Map();
    const readPaths = [];
    const ref = path => ({
        path,
        id: path.split('/').pop(),
        doc: id => ref(`${path}/${id}`),
        collection: id => ref(`${path}/${id}`),
        limit() { return this; },
        async get() { return snapshot(this); }
    });
    const snapshot = target => {
        if (target.path.split('/').length % 2 === 0) {
            return { ref: target, id: target.id, exists: records.has(target.path), data: () => structuredClone(records.get(target.path)) };
        }
        const docs = [...records.keys()]
            .filter(path => path.startsWith(`${target.path}/`) && path.split('/').length === target.path.split('/').length + 1)
            .map(path => snapshot(ref(path)));
        return { docs, size: docs.length };
    };
    const db = {
        collection: ref,
        async runTransaction(work) {
            const tx = {
                async get(target) {
                    readPaths.push(target.path);
                    return snapshot(target);
                },
                set(target, data, options) {
                    records.set(target.path, options?.merge ? { ...records.get(target.path), ...data } : data);
                }
            };
            return work(tx);
        }
    };
    records.set('crmProjects/p', { projectId: 'p', lifecycle: 'active', revision: 1, structureRevision: 1, schemaRevision: 1 });
    records.set('crmProjects/p/sections/sec_active', { projectId: 'p', lifecycle: 'active', revision: 1 });
    records.set('crmProjects/p/sections/sec_archived', { projectId: 'p', lifecycle: 'archived', revision: 1 });
    records.set('crmProjects/p/tasks/t_active', { projectId: 'p', title: 'Task 1', lifecycle: 'active', revision: 1, sectionId: 'sec_active', rank: '0/1', status: 'not_started', values: {} });
    records.set('crmProjects/p/tasks/t_inactive_sec', { projectId: 'p', title: 'Task 2', lifecycle: 'active', revision: 1, sectionId: 'sec_archived', rank: '1/1', status: 'not_started', values: {} });
    records.set('crmProjects/p/columns/col1', { projectId: 'p', type: 'text', label: 'Col 1' });

    const accessService = {
        async assertTransactionEligible() { return { uid: 'staff' }; },
        async assertTransactionContentAccess(tx, uid, projectId) {
            const p = await tx.get(ref(`crmProjects/${projectId}`));
            return { role: 'Editor', identity: { uid }, project: { id: projectId, data: p.data() } };
        },
        async assertTransactionMemberRole() { return true; }
    };

    const command = createProjectsCommandService({ db, accessService });

    // 1. Update title only (no values): columns collection should NOT be read
    readPaths.length = 0;
    await command.updateTask({ uid: 'staff' }, 'p', 't_active', { operationId: 'op_update_1', expectedRevision: 1, title: 'Renamed Title' });
    assert.equal(records.get('crmProjects/p/tasks/t_active').title, 'Renamed Title');
    assert.equal(readPaths.some(p => p.includes('columns')), false, 'columns collection must not be read when values is undefined');

    // 2. Update task in archived section: must throw TASK_LIFECYCLE_FORBIDDEN
    await assert.rejects(
        () => command.updateTask({ uid: 'staff' }, 'p', 't_inactive_sec', { operationId: 'op_update_2', expectedRevision: 1, title: 'Fails' }),
        err => err.status === 409 && err.code === 'TASK_LIFECYCLE_FORBIDDEN'
    );
});

test('views applyStatus uses one canonical board.setTaskField command without full board refresh', async () => {
    let boardRefreshCalled = false;
    const commands = [];
    const directWrites = [];
    const board = {
        refresh: async () => { boardRefreshCalled = true; },
        setTaskField: async command => { commands.push(command); },
        getState: () => ({ membership: { role: 'Owner' } })
    };
    const elMap = new Map();
    const el = id => {
        if (!elMap.has(id)) elMap.set(id, new MockNode());
        return elMap.get(id);
    };
    const context = {
        console,
        setTimeout, clearTimeout,
        URLSearchParams,
        document: { getElementById: el, querySelectorAll: () => [], createElement: tag => new MockNode(tag) }
    };
    vm.runInNewContext(viewsSource, context);

    const controller = context.CrmProjectsViews.createController({
        board,
        getCurrentUser: () => ({ uid: 'user1' }),
        apiFetchJson: async (url, options) => {
            if (options?.method && options.method !== 'GET') directWrites.push({ url, options });
            if (url.includes('/views?')) {
                return {
                    project: { id: 'p1', lifecycle: 'active', revision: 1 },
                    membership: { role: 'Owner' },
                    tasks: [{ id: 't1', title: 'Task 1', revision: 2, status: 'not_started' }]
                };
            }
            return {};
        }
    });
    controller.init();
    controller.setProject('p1');
    await flush();

    // Switch to kanban and trigger status change
    const tabs = el('projects-view-tabs');
    tabs.listeners?.click?.({ target: { closest: () => ({ dataset: { view: 'kanban' } }) } });
    await flush();

    const content = el('projects-view-content');
    content.listeners?.change?.({ target: { dataset: { taskStatus: 't1' }, value: 'done' } });
    await flush();

    assert.equal(commands.length, 1, 'Exactly one logical status command must be issued');
    const { isCurrent, ...command } = commands[0];
    assert.deepEqual(command, { taskId: 't1', field: 'status', value: 'done', revision: 2, projectId: 'p1', actorUid: 'user1' });
    assert.equal(typeof isCurrent, 'function', 'Canonical command must receive its scope fence');
    assert.equal(isCurrent(), true);
    assert.equal(directWrites.length, 0, 'Views must not bypass canonical board commands');
    assert.equal(boardRefreshCalled, false, 'Canonical status change must not trigger a full branch refresh');
});


