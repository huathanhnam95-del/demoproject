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
        this.classList = {
            toggle() {},
            add() {},
            remove() {},
            contains() { return false; }
        };
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

function createBoardHarness(options = {}) {
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
        'projectsBoardStatusBlocked', 'projectsBoardStatusDone', 'projectsBoardStatus'
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
        { id: 't1', title: 'Task 1', status: 'not_started', sectionId: 'sec1', effectiveSectionId: 'sec1', rank: '0|hzzzzz:', lifecycle: 'active' },
        { id: 't2', title: 'Task 2', status: 'not_started', sectionId: 'sec1', effectiveSectionId: 'sec1', rank: '0|i00000:', lifecycle: 'active' },
        { id: 't3', title: 'Subtask 1', parentTaskId: 't1', status: 'in_progress', effectiveSectionId: 'sec1', rank: '0|hzzzzz:', lifecycle: 'active' }
    ];

    const controller = context.CrmProjectsBoard.createController({
        elements,
        getCurrentUser: () => ({ uid: 'user1' }),
        onContextChanged: ctx => contextChanges.push(ctx),
        apiFetchJson: async (url, opts) => {
            if (options.apiFetchJson) return options.apiFetchJson(url, opts);
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
    assert.equal(h.controller.getState().tasks.get('t1').sectionId, 'sec2');
    assert.equal(h.controller.getState().tasks.get('t1').effectiveSectionId, 'sec2', 'effectiveSectionId must be reconciled to target section');
    assert.equal(h.controller.getState().tasks.get('t3').effectiveSectionId, 'sec2', 'loaded subtask effectiveSectionId must be propagated');
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

test('views mutate extracts canonicalTask from result.result and invokes board.updateTask, ignoring late responses across task switches', async () => {
    let updatedBoardTask = null;
    let boardRefreshCalled = false;
    const board = {
        getState: () => ({ project: { id: 'p1', structureRevision: 1 }, membership: { role: 'Owner' }, tasks: new Map() }),
        updateTask: (t) => { updatedBoardTask = t; },
        refresh: async () => { boardRefreshCalled = true; }
    };

    const controls = new Map();
    const el = id => {
        if (!controls.has(id)) controls.set(id, new MockNode());
        return controls.get(id);
    };
    const context = {
        console, URLSearchParams, Date, Math, Array, Object,
        crypto: { randomUUID: () => 'op-123' },
        document: { getElementById: el, querySelectorAll: () => [], createElement: tag => new MockNode(tag) }
    };
    vm.runInNewContext(viewsSource, context);

    let resolveHeldMutation = null;
    let heldMutationPromise = null;

    const controller = context.CrmProjectsViews.createController({
        board,
        getCurrentUser: () => ({ uid: 'user1' }),
        apiFetchJson: async (url, opts) => {
            if (url.includes('/views?')) {
                return {
                    project: { id: 'p1', lifecycle: 'active', revision: 1, structureRevision: 1 },
                    membership: { role: 'Owner' },
                    tasks: [{ id: 't1', title: 'Task 1', revision: 2, startDate: '2026-08-01' }]
                };
            }
            if (url.includes('/tasks/t1/dependencies')) {
                if (heldMutationPromise) {
                    return heldMutationPromise;
                }
                return {
                    result: {
                        task: { id: 't1', revision: 3, predecessorTaskIds: ['t2'] }
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

    // 1. Submit dependency update and verify canonicalTask extracted and board.updateTask called
    el('projects-task-predecessors').value = 't2';
    el('projects-task-planning').listeners.submit({
        preventDefault() {},
        target: { id: 'projects-task-dependencies' }
    });
    await flush();

    assert.equal(boardRefreshCalled, false, 'Full board refresh should be skipped in favor of targeted updateTask');
    assert.ok(updatedBoardTask, 'board.updateTask should have been called');
    assert.equal(updatedBoardTask.id, 't1');
    assert.equal(updatedBoardTask.revision, 3);
    assert.deepEqual(Array.from(updatedBoardTask.predecessorTaskIds), ['t2']);
    assert.equal(updatedBoardTask.projectId, 'p1');

    // 2. Late response holding regression test:
    // Hold an in-flight mutation on t1, switch task to t2, resolve t1 mutation, and assert t2 state is untouched
    updatedBoardTask = null;
    heldMutationPromise = new Promise(resolve => {
        resolveHeldMutation = resolve;
    });

    el('projects-task-predecessors').value = 't3';
    el('projects-task-planning').listeners.submit({
        preventDefault() {},
        target: { id: 'projects-task-dependencies' }
    });
    await flush();

    // Now user switches to task t2 before the response returns
    controller.setTask({ id: 't2', title: 'Task 2', revision: 1, projectId: 'p1' });
    await flush();

    assert.equal(controller.getState().selectedTaskId, 't2');

    // Now late response for t1 arrives
    resolveHeldMutation({
        result: {
            task: { id: 't1', revision: 4, predecessorTaskIds: ['t3'] }
        }
    });
    await flush();

    assert.equal(controller.getState().selectedTaskId, 't2', 'Active task must remain t2');
    assert.equal(updatedBoardTask, null, 'Late response for t1 must not invoke board.updateTask while t2 is active');
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
    const { createViewCalendarService } = require('../../../functions/src/crm/projects/view-calendar-service');
    const { PROJECT_COLLECTIONS } = require('../../../functions/src/crm/projects/access-service');

    const records = new Map();
    const col = p => ({
        doc: id => ref(`${p}/${id}`),
        limit: n => ({
            get: async () => {
                const prefix = `${p}/`;
                const docs = [];
                for (const [k, v] of records.entries()) {
                    if (k.startsWith(prefix) && k.slice(prefix.length).indexOf('/') === -1) {
                        docs.push({ id: k.slice(prefix.length), data: () => v, ref: ref(k), updateTime: '2026-09-01T00:00:00Z' });
                    }
                }
                return { docs: docs.slice(0, n) };
            }
        })
    });
    function ref(p) {
        return {
            path: p,
            id: p.split('/').pop(),
            get: async () => ({ exists: records.has(p), data: () => records.get(p) }),
            collection: name => col(`${p}/${name}`)
        };
    }

    records.set('crmProjects/p1', { lifecycle: 'active', structureRevision: 1, dependencyRevision: 1 });
    records.set('crmProjects/p1/sections/sec1', { lifecycle: 'active', rank: '0|hzzzzz:' });
    records.set(`${PROJECT_COLLECTIONS.organizationConfig}/calendar`, {
        workingWeekdays: [1, 2, 3, 4, 5],
        holidayChoices: {
            2026: { tetScheme: 'before1_after3', nationalDayAdjacent: 'before', adoptPublicSectorSwaps: false }
        }
    });
    records.set('crmProjects/p1/tasks/t1', { revision: 2, sectionId: 'sec1', lifecycle: 'active', predecessorTaskIds: [], startDate: '2026-09-01', dueDate: '2026-09-05' });
    records.set('crmProjects/p1/tasks/t2', { revision: 1, sectionId: 'sec1', lifecycle: 'active', predecessorTaskIds: [], startDate: '2026-08-20', dueDate: '2026-08-25' });

    const transaction = {
        get: async target => {
            if (target.docs) return target;
            if (target.get) return target.get();
            const p = target.path;
            return { exists: records.has(p), data: () => records.get(p), id: p.split('/').pop(), ref: target, updateTime: '2026-09-01T00:00:00Z' };
        },
        update: (r, data) => {
            records.set(r.path, { ...records.get(r.path), ...data });
        },
        set: (r, data) => {
            records.set(r.path, data);
        }
    };

    const db = {
        collection: name => col(name),
        doc: path => ref(path),
        runTransaction: async fn => fn(transaction)
    };

    const accessService = {
        assertTransactionContentAccess: async () => ({ role: 'Owner' })
    };

    const commandService = {
        runCommand: async ({ execute }) => execute({ transaction })
    };

    const service = createViewCalendarService({
        db,
        accessService,
        commandService,
        now: () => new Date('2026-09-01T00:00:00Z')
    });

    const identity = { uid: 'user1' };

    // 1. Test dependencies()
    const depRes = await service.dependencies(identity, 'p1', 't1', {
        expectedRevision: 2,
        expectedStructureRevision: 1,
        predecessorTaskIds: ['t2'],
        operationId: 'op-dep-1'
    });
    assert.equal(depRes.result.task.id, 't1');
    assert.equal(depRes.result.task.revision, 3);
    assert.deepEqual(depRes.result.task.predecessorTaskIds, ['t2']);

    // 2. Test preview() and apply()
    const prevRes = await service.preview(identity, 'p1', {
        taskId: 't1',
        expectedRevision: 3,
        startDate: '2026-09-02',
        dueDate: '2026-09-06'
    });
    assert.ok(prevRes.preview.token);
    assert.equal(prevRes.preview.canApply, true);

    const applyRes = await service.apply(identity, 'p1', {
        previewToken: prevRes.preview.token,
        operationId: 'op-apply-1'
    });
    assert.equal(applyRes.result.task.id, 't1');
    assert.equal(applyRes.result.task.revision, 4);
    assert.equal(applyRes.result.task.startDate, '2026-09-02');
    assert.equal(applyRes.result.task.dueDate, '2026-09-06');
});

test('readBranch later-page failure preserves page 1 tasks and sets warning status', async () => {
    let pageCount = 0;
    const h = createBoardHarness({
        apiFetchJson: async (url, opts) => {
            if (url.endsWith('/member-directory')) return { people: [] };
            if (url.includes('/tasks?')) {
                pageCount++;
                if (pageCount === 1) {
                    return {
                        tasks: [
                            { id: 't1', title: 'Task 1', status: 'not_started', sectionId: 'sec1', effectiveSectionId: 'sec1', rank: '0|hzzzzz:', lifecycle: 'active' },
                            { id: 't2', title: 'Task 2', status: 'not_started', sectionId: 'sec1', effectiveSectionId: 'sec1', rank: '0|i00000:', lifecycle: 'active' }
                        ],
                        sections: [{ id: 'sec1', title: 'Section 1', rank: '0|hzzzzz:' }],
                        columns: [],
                        nextCursor: 'cur_page_2'
                    };
                }
                throw new Error('Connection lost fetching page 2');
            }
            return { project: { id: 'p1', lifecycle: 'active', structureRevision: 1, schemaRevision: 1 }, membership: { role: 'Owner' } };
        }
    });
    await flush();

    const state = h.controller.getState();
    assert.ok(state.tasks.has('t1'), 'Page 1 task t1 should be preserved in state');
    assert.ok(state.tasks.has('t2'), 'Page 1 task t2 should be preserved in state');
    assert.equal(state.authorizationReady, true, 'Authorization ready should be released upon page 1 render');
    assert.ok(
        h.elements.projectsBoardStatus.textContent.includes('Some tasks could not be loaded: Connection lost fetching page 2'),
        'Warning status should be preserved on status element and not overwritten by finally block'
    );
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


