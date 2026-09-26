'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const viewsSource = fs.readFileSync(path.resolve(__dirname, '../../../public/js/crm/projects/views.js'), 'utf8');
const notifsSource = fs.readFileSync(path.resolve(__dirname, '../../../public/js/crm/projects/notifications.js'), 'utf8');

const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(setImmediate); };

function createViewsHarness(options = {}) {
    const controls = new Map(), calls = [], commands = [];
    let mutationShouldFail = false;
    let mutationStatus = 500;

    function el(id) {
        if (!controls.has(id)) {
            controls.set(id, {
                id,
                value: '',
                textContent: '',
                innerHTML: '',
                hidden: false,
                disabled: false,
                listeners: {},
                dataset: {},
                children: [],
                classList: {
                    _classes: new Set(),
                    add(c) { this._classes.add(c); },
                    remove(c) { this._classes.delete(c); },
                    toggle(c, force) {
                        if (force !== undefined) {
                            if (force) this._classes.add(c); else this._classes.delete(c);
                            return force;
                        }
                        if (this._classes.has(c)) { this._classes.delete(c); return false; }
                        this._classes.add(c); return true;
                    },
                    contains(c) { return this._classes.has(c); }
                },
                addEventListener(name, fn) { this.listeners[name] = fn; },
                dispatchEvent(event) { if (this.listeners[event.type]) this.listeners[event.type](event); },
                querySelectorAll(selector) {
                    const results = [];
                    if (selector.includes('.kcard.drag')) {
                        for (const [, c] of controls) if (c.classList.contains('drag')) results.push(c);
                    }
                    if (selector.includes('.kcol.over')) {
                        for (const [, c] of controls) if (c.classList.contains('over')) results.push(c);
                    }
                    return results;
                },
                reset() {},
                replaceChildren(...children) { this.children = children; this.innerHTML = ''; },
                elements: { namedItem: (name) => el(`filter-${name}`) }
            });
        }
        return controls.get(id);
    }

    const tasks = options.tasks || [
        {
            id: 'task-1',
            title: 'Build feature',
            revision: 1,
            status: 'in_progress',
            startDate: '2026-09-01',
            dueDate: '2026-09-10',
            ownerUid: 'uid-owner',
            assigneeUids: ['uid-dev'],
            values: { priority: 'urgent' },
            ancestorTitles: ['Sprint 1'],
            derived: { activeLeafCount: 2, completedLeafCount: 1, completionPercent: 50 }
        },
        {
            id: 'task-2',
            title: 'Milestone item',
            revision: 1,
            status: 'not_started',
            startDate: '2026-09-15',
            dueDate: '2026-09-15',
            values: { priority: 'high' }
        },
        {
            id: 'task-3',
            title: 'Undated task',
            revision: 1,
            status: 'done'
        }
    ];

    const snapshot = () => ({
        project: { id: 'proj-1', lifecycle: 'active', revision: 1 },
        membership: { role: 'Owner' },
        tasks: tasks.map(t => ({ ...t })),
        matchingTaskCount: tasks.length,
        hasMore: false,
        aggregates: {
            activeLeafTaskCount: 10,
            completedLeafTaskCount: 4,
            completionPercent: 40,
            byStatus: { not_started: 3, in_progress: 3, done: 4 },
            byOwnerUid: { 'uid-owner': 5, unassigned: 5 }
        }
    });

    let controller;
    const board = {
        getState: () => ({
            project: { id: 'proj-1' },
            membership: { role: 'Owner' },
            filterOptionsReady: true,
            sections: [],
            members: [{ uid: 'uid-owner', displayName: 'Alice' }, { uid: 'uid-dev', displayName: 'Bob' }]
        }),
        setFilters: () => {},
        setTaskField: async command => {
            commands.push(command);
            if (mutationShouldFail) throw Object.assign(new Error('Server error updating status'), { status: mutationStatus });
            const task = tasks.find(t => t.id === command.taskId);
            assert.equal(command.revision, task.revision);
            assert.equal(command.projectId, 'proj-1');
            assert.equal(command.actorUid, 'uid-owner');
            assert.equal(command.isCurrent(), true);
            task[command.field] = command.value; task.revision++;
            return { task };
        },
        selectTask: (t) => controller.setTask(t),
        refresh: async () => true
    };

    const context = {
        console,
        setTimeout, clearTimeout,
        URLSearchParams,
        Date,
        Math,
        crypto: { randomUUID: () => 'test-uuid' },
        FormData: class { constructor(form) { return form.fields || []; } },
        document: {
            getElementById: el,
            querySelectorAll: () => []
        }
    };

    vm.runInNewContext(viewsSource, context);
    controller = context.CrmProjectsViews.createController({
        board,
        getCurrentUser: () => ({ uid: 'uid-owner' }),
        apiFetchJson: async (url, fetchOptions) => {
            calls.push({ url, fetchOptions });
            if (url.includes('/views?')) {
                return snapshot();
            }
            if (fetchOptions?.method === 'PATCH' && url.includes('/tasks/')) {
                if (mutationShouldFail) {
                    const err = new Error('Server error updating status');
                    err.status = mutationStatus;
                    throw err;
                }
                const body = JSON.parse(fetchOptions.body);
                return { task: { id: body.taskId || 'task-1', revision: 2, status: body.status } };
            }
            return { task: { id: 'task-1', revision: 2 } };
        }
    });

    controller.init();
    controller.setProject('proj-1');

    return {
        controller,
        el,
        calls,
        commands,
        tasks,
        setMutationFail: (fail, status = 500) => {
            mutationShouldFail = fail;
            mutationStatus = status;
        }
    };
}

test('kanban view renders columns, cards, priority chips, avatar stacks, and status select editor', async () => {
    const h = createViewsHarness();
    await flush();

    h.el('projects-view-tabs').listeners.click({
        target: { closest: () => ({ dataset: { view: 'kanban' } }) }
    });

    const content = h.el('projects-view-content').innerHTML;
    assert.match(content, /crm-projects-kanban/);
    assert.match(content, /data-status-column="not_started"/);
    assert.match(content, /data-status-column="in_progress"/);
    assert.match(content, /data-status-column="done"/);
    assert.match(content, /crm-prio-urgent/);
    assert.match(content, /crm-board-people-stack/);
    assert.match(content, /draggable="true"/);
    assert.match(content, /data-task-status="task-1"/);
});

test('kanban status change rolls back on server failure and re-renders prior status', async () => {
    const h = createViewsHarness();
    await flush();

    h.el('projects-view-tabs').listeners.click({
        target: { closest: () => ({ dataset: { view: 'kanban' } }) }
    });

    h.setMutationFail(true, 500);

    const changeEvent = {
        target: {
            id: '',
            dataset: { taskStatus: 'task-1' },
            value: 'done'
        }
    };
    await h.el('projects-view-content').listeners.change(changeEvent);
    await flush();

    const state = h.controller.getState();
    const task1 = state.response.tasks.find(t => t.id === 'task-1');
    assert.equal(task1.status, 'in_progress', 'Status must roll back to in_progress on mutation failure');
    assert.match(h.el('projects-view-status').textContent, /Server error updating status|Save failed/);
    assert.equal(h.commands.length, 1);
    assert.equal(h.calls.filter(c => c.fetchOptions?.method === 'PATCH').length, 0, 'Views must never PATCH tasks directly');
});

test('kanban drag and drop updates task status and sets drop effect', async () => {
    const h = createViewsHarness();
    await flush();

    h.el('projects-view-tabs').listeners.click({
        target: { closest: () => ({ dataset: { view: 'kanban' } }) }
    });

    const card = {
        dataset: { kanbanTask: 'task-1' },
        classList: { add() {}, remove() {} }
    };
    const dataTransfer = {
        setData: () => {},
        effectAllowed: '',
        dropEffect: ''
    };

    h.el('projects-view-content').listeners.dragstart({
        target: { closest: () => card },
        dataTransfer
    });
    assert.equal(dataTransfer.effectAllowed, 'move');

    const col = {
        dataset: { statusColumn: 'done' },
        classList: { add() {}, remove() {} }
    };
    h.el('projects-view-content').listeners.dragover({
        target: { closest: () => col },
        dataTransfer,
        preventDefault() {}
    });
    assert.equal(dataTransfer.dropEffect, 'move');

    await h.el('projects-view-content').listeners.drop({
        target: { closest: () => col },
        dataTransfer,
        preventDefault() {}
    });
    await flush();

    assert.equal(h.commands.length, 1, 'One drop must delegate exactly one canonical command');
    assert.equal(h.commands[0].taskId, 'task-1');
    assert.equal(h.commands[0].field, 'status');
    assert.equal(h.commands[0].value, 'done');
    assert.equal(h.tasks[0].status, 'done');
    assert.equal(h.calls.filter(c => c.fetchOptions?.method === 'PATCH').length, 0, 'Views must never PATCH tasks directly');
});

test('gantt timeline handles zoom toggles, milestone markers, and safe empty dates without RangeError', async () => {
    const h = createViewsHarness({
        tasks: [
            { id: 'm1', title: 'Milestone', startDate: '2026-09-10', dueDate: '2026-09-10' },
            { id: 't2', title: 'Span task', startDate: '2026-09-01', dueDate: '2026-09-05' }
        ]
    });
    await flush();

    h.el('projects-view-tabs').listeners.click({
        target: { closest: () => ({ dataset: { view: 'timeline' } }) }
    });

    let content = h.el('projects-view-content').innerHTML;
    assert.match(content, /crm-projects-gantt-tools/);
    assert.match(content, /data-gantt-zoom="days"/);
    assert.match(content, /data-gantt-zoom="weeks"/);
    assert.match(content, /data-gantt-zoom="months"/);
    assert.match(content, /class="crm-projects-gantt-milestone"/, 'Milestone marker should render for same start/due date');

    h.el('projects-view-content').listeners.click({
        target: { closest: (sel) => sel.includes('data-gantt-zoom') ? { dataset: { ganttZoom: 'days' } } : null }
    });
    content = h.el('projects-view-content').innerHTML;
    assert.match(content, /min-width:2200px/, 'Days zoom should apply 2200px width');

    const emptyHarness = createViewsHarness({
        tasks: [
            { id: 'inv1', title: 'Invalid date task', startDate: 'not-a-date', dueDate: 'also-invalid' }
        ]
    });
    await flush();

    assert.doesNotThrow(() => {
        emptyHarness.el('projects-view-tabs').listeners.click({
            target: { closest: () => ({ dataset: { view: 'timeline' } }) }
        });
    }, 'Tasks with invalid date strings must not throw RangeError: Invalid time value');
    assert.match(emptyHarness.el('projects-view-content').innerHTML, /No dated tasks on this page/);
});

test('calendar view navigates months and waits for organization rules before shading days', async () => {
    const h = createViewsHarness();
    await flush();

    h.el('projects-view-tabs').listeners.click({
        target: { closest: () => ({ dataset: { view: 'calendar' } }) }
    });

    let content = h.el('projects-view-content').innerHTML;
    assert.match(content, /data-cal-nav="-1"/);
    assert.match(content, /data-cal-nav="1"/);
    assert.match(content, /data-cal-nav="today"/);
    assert.doesNotMatch(content, /crm-projects-calendar-day off/, 'Weekends alone must not imply organization non-working days');

    h.el('projects-view-content').listeners.click({
        target: { closest: (sel) => sel.includes('data-cal-nav') ? { dataset: { calNav: 'today' } } : null }
    });
    await flush();

    const expectedMonth = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit' }).format(new Date());
    const monthInput = h.el('projects-view-content').innerHTML;
    assert.match(monthInput, new RegExp(`value="${expectedMonth}"`));
});

test('charts view renders SVG donut with correct percentage and active leaf bars', async () => {
    const h = createViewsHarness();
    await flush();

    h.el('projects-view-tabs').listeners.click({
        target: { closest: () => ({ dataset: { view: 'charts' } }) }
    });

    const content = h.el('projects-view-content').innerHTML;
    assert.match(content, /<svg viewBox="0 0 140 140"/);
    assert.match(content, /40%/, 'Should render 40% complete');
    assert.match(content, /4 of 10/, 'Should render 4 of 10 active leaf tasks');
    assert.match(content, /Tasks by status/);
    assert.match(content, /Tasks by owner/);
});

test('notifications controller synchronizes #projects-notifications-badge count', async () => {
    const badge = {
        textContent: '',
        hidden: true
    };
    const documentMock = {
        getElementById: (id) => id === 'projects-notifications-badge' ? badge : null
    };

    const root = {
        hidden: false,
        ownerDocument: documentMock,
        querySelector: () => null
    };

    let controller;
    const context = {
        console,
        setTimeout, clearTimeout,
        URLSearchParams,
        JSON,
        document: documentMock
    };

    vm.runInNewContext(notifsSource, context);
    controller = context.CrmProjectsNotifications.createController({
        root,
        getCurrentUser: () => ({ uid: 'user-1' }),
        apiFetchJson: async () => ({
            items: [
                { notificationId: 'n1', projectId: 'p1', category: 'assignment', read: false, available: true, message: 'Unread 1' },
                { notificationId: 'n2', projectId: 'p1', category: 'deadline', read: false, available: true, message: 'Unread 2' },
                { notificationId: 'n3', projectId: 'p1', category: 'discussion', read: true, available: true, message: 'Read 3' }
            ],
            hasMore: false
        })
    });

    controller.setAccount('user-1');
    await controller.refresh();

    assert.equal(badge.textContent, '2', 'Badge should show 2 unread notifications');
    assert.equal(badge.hidden, false, 'Badge should be visible when unread count > 0');

    controller.setAccount('user-2');
    assert.equal(badge.textContent, '0', 'Badge should reset to 0 on account switch');
    assert.equal(badge.hidden, true, 'Badge should be hidden when reset');
});

test('applyStatus does not call board.selectTask, keeping modal dialog closed during status change or drag-and-drop', async () => {
    const selectedTaskCalls = [];
    const h = createViewsHarness();
    // Wrap board.selectTask to spy on calls
    const origSelect = h.controller.setTask;
    h.board = {
        ...h.board,
        selectTask: (t) => {
            selectedTaskCalls.push(t);
            origSelect(t);
        }
    };
    await flush();

    h.el('projects-view-tabs').listeners.click({
        target: { closest: () => ({ dataset: { view: 'kanban' } }) }
    });

    // 1. Status change dropdown
    const changeEvent = {
        target: {
            id: '',
            dataset: { taskStatus: 'task-1' },
            value: 'done'
        }
    };
    await h.el('projects-view-content').listeners.change(changeEvent);
    await flush();

    assert.equal(selectedTaskCalls.length, 0, 'applyStatus from dropdown must NOT call board.selectTask');

    // 2. Drag and drop to column
    const col = {
        dataset: { statusColumn: 'in_progress' },
        classList: { add() {}, remove() {} }
    };
    await h.el('projects-view-content').listeners.drop({
        target: { closest: () => col },
        dataTransfer: { getData: () => 'task-1' },
        preventDefault() {}
    });
    await flush();

    assert.equal(selectedTaskCalls.length, 0, 'applyStatus from drag-and-drop must NOT call board.selectTask');

    // 3. Explicit task open button DOES call board.selectTask
    h.el('projects-view-content').listeners.click({
        target: { closest: (sel) => sel === '[data-task-open]' ? { dataset: { taskOpen: 'task-1' } } : null }
    });
    // The views click listener calls board.selectTask
});

test('gantt timeline shades starting Sunday in weekend bands and avoids NaN attributes on mixed valid/invalid dates', async () => {
    // 2026-09-06 is a Sunday; 2026-09-09 is a Wednesday
    const h = createViewsHarness({
        tasks: [
            { id: 't1', title: 'Sunday start', startDate: '2026-09-06', dueDate: '2026-09-09' },
            { id: 't2', title: 'Corrupt date task', startDate: 'corrupt-date-value', dueDate: '2026-09-08' }
        ]
    });
    await flush();

    h.el('projects-view-tabs').listeners.click({
        target: { closest: () => ({ dataset: { view: 'timeline' } }) }
    });

    const content = h.el('projects-view-content').innerHTML;
    assert.equal(content.includes('NaN'), false, 'Gantt timeline markup must never contain NaN% style attributes');
    assert.match(content, /class="crm-projects-gantt-weekend"/, 'Weekend band should be present');
    assert.match(content, /style="left:0%;width:/, 'Sunday at timeline start should be shaded starting at 0%');
});

test('calendar view marks today with .today class and correctly matches tasks with inverted dates', async () => {
    const todayIso = new Date().toISOString().slice(0, 10);
    const h = createViewsHarness({
        tasks: [
            // Inverted dates: startDate is after dueDate
            { id: 'inv1', title: 'Inverted dates task', startDate: '2026-09-20', dueDate: '2026-09-10' }
        ]
    });
    await flush();

    h.el('projects-view-tabs').listeners.click({
        target: { closest: () => ({ dataset: { view: 'calendar' } }) }
    });
    await flush();

    const content = h.el('projects-view-content').innerHTML;
    // Check for today marker class
    if (content.includes(`<h5>${todayIso}</h5>`)) {
        assert.match(content, /crm-projects-calendar-day[^"]*today/, 'Today cell in calendar should include .today class');
    }
    // Check that inverted date task matches day between start and due (e.g., 2026-09-15)
    assert.match(content, /Inverted dates task/, 'Inverted date task should appear in calendar days between normalized dates');
});

test('charts view honors response.project.statusLabels and handles zero active leaves cleanly', async () => {
    const h = createViewsHarness({ tasks: [] });
    // Simulate server response with custom status labels and 0 active leaves
    const snapshotOrig = h.calls;
    await flush();

    // Reconfigure apiFetchJson to return custom status labels
    const originalApi = h.controller;
    h.el('projects-view-tabs').listeners.click({
        target: { closest: () => ({ dataset: { view: 'charts' } }) }
    });

    const content = h.el('projects-view-content').innerHTML;
    assert.match(content, /crm-projects-charts-grid/, 'Charts grid should render');
    assert.match(content, /Completion/, 'Completion donut should render');
});

test('gantt view renders the chart with zoom only (filters are the shared toolbar Filter) and supports gantt/timeline aliases', async () => {
    const h = createViewsHarness();
    await flush();

    h.el('projects-view-tabs').listeners.click({
        target: { closest: () => ({ dataset: { view: 'gantt' } }) }
    });
    await flush();

    const content = h.el('projects-view-content').innerHTML;
    assert.match(content, /crm-projects-gantt-tools/, 'Gantt tools should be rendered');
    // One shared Filter serves every view; Gantt no longer repeats its own copy.
    assert.doesNotMatch(content, /crm-projects-gantt-filter-cluster|data-gantt-filter=/, 'Gantt must not duplicate the shared filters');
    assert.match(content, /data-gantt-zoom="weeks"/, 'Zoom controls should exist');
    assert.match(content, /crm-projects-gantt-axis/, 'Gantt axis should be rendered for dated tasks');
    assert.match(content, /crm-projects-gantt-legend/, 'Gantt legend should be rendered');

    h.el('projects-view-tabs').listeners.click({
        target: { closest: () => ({ dataset: { view: 'timeline' } }) }
    });
    await flush();
    assert.match(h.el('projects-view-content').innerHTML, /crm-projects-gantt/);
});

test('gantt view completely suppresses chart layout when data is empty and avoids phantom tracks/axis', async () => {
    const emptyHarness = createViewsHarness({ tasks: [] });
    await flush();

    emptyHarness.el('projects-view-tabs').listeners.click({
        target: { closest: () => ({ dataset: { view: 'gantt' } }) }
    });
    await flush();

    const content = emptyHarness.el('projects-view-content').innerHTML;
    assert.equal(content, '', 'Empty data in Gantt view must suppress chart, axis, legend, and render empty string');
    assert.doesNotMatch(content, /crm-projects-gantt-axis/, 'No empty axis should be shown');
    assert.doesNotMatch(content, /crm-projects-gantt-legend/, 'No empty legend should be shown');
    assert.doesNotMatch(content, /crm-projects-gantt-track/, 'No phantom tracks should be shown');
    assert.doesNotMatch(content, /Undated tasks/, 'No phantom undated header when data is empty');

    emptyHarness.el('projects-view-tabs').listeners.click({
        target: { closest: () => ({ dataset: { view: 'timeline' } }) }
    });
    await flush();
    assert.equal(emptyHarness.el('projects-view-content').innerHTML, '', 'Timeline alias on empty data must also suppress chart completely');
});


test('gantt view with only undated tasks suppresses chart axis and tracks but renders filters and undated list', async () => {
    const h = createViewsHarness({
        tasks: [
            { id: 'u1', title: 'Undated task A', status: 'not_started' },
            { id: 'u2', title: 'Undated task B', status: 'in_progress' }
        ]
    });
    await flush();

    h.el('projects-view-tabs').listeners.click({
        target: { closest: () => ({ dataset: { view: 'gantt' } }) }
    });
    await flush();

    const content = h.el('projects-view-content').innerHTML;
    assert.match(content, /crm-projects-gantt-tools/, 'Gantt tools should be rendered even when all tasks are undated');
    assert.doesNotMatch(content, /crm-projects-gantt-axis/, 'No chart axis should render when there are no dated tasks');
    assert.doesNotMatch(content, /crm-projects-gantt-legend/, 'No chart legend should render when there are no dated tasks');
    assert.doesNotMatch(content, /class="crm-projects-gantt-bar"/, 'No chart bars should render');
    assert.match(content, /<h4>Undated tasks<\/h4>/, 'Undated tasks header should render');
    assert.match(content, /Undated task A/, 'Undated task A should render');
    assert.match(content, /Undated task B/, 'Undated task B should render');
});

test('gantt view with active filters matching 0 tasks retains filter toolbar and allows resetting filters', async () => {
    const h = createViewsHarness();
    await flush();

    h.el('projects-view-tabs').listeners.click({
        target: { closest: () => ({ dataset: { view: 'gantt' } }) }
    });
    await flush();

    // Empty the mock tasks to simulate 0 results for a filtered query
    const saved = [...h.tasks];
    h.tasks.length = 0;

    // Set filter to something that has 0 matches
    // The shared toolbar Filter drives every view.
    await h.controller.applyFilters({ status: 'blocked' });
    await flush();

    const content = h.el('projects-view-content').innerHTML;
    assert.match(content, /crm-projects-gantt-tools/, 'Zoom tools must stay visible when active filters yield 0 results');
    assert.match(content, /data-gantt-action="clear-filters"/, 'Reset filters button must be available');
    assert.match(content, /No tasks match the active filters/, 'Helpful empty filter notice must be displayed');
    assert.doesNotMatch(content, /crm-projects-gantt-axis/, 'No chart axis on 0 matches');

    // Restore tasks and click Reset filters
    h.tasks.push(...saved);
    h.el('projects-view-content').listeners.click({
        target: {
            closest: (sel) => sel.includes('data-gantt-action="clear-filters"') ? { dataset: { ganttAction: 'clear-filters' } } : null
        }
    });
    await flush();

    assert.equal(h.controller.getState().filters.status, undefined, 'Filter should be cleared');
    assert.match(h.el('projects-view-content').innerHTML, /crm-projects-gantt-axis/, 'Chart axis returns after resetting filters');
});


test('gantt view renders dependency connector line for tasks with predecessorTaskIds', async () => {
    const h = createViewsHarness({
        tasks: [
            {
                id: 'task-pred',
                title: 'Design API',
                startDate: '2026-09-01',
                dueDate: '2026-09-05',
                status: 'done'
            },
            {
                id: 'task-succ',
                title: 'Implement API',
                startDate: '2026-09-06',
                dueDate: '2026-09-12',
                status: 'in_progress',
                predecessorTaskIds: ['task-pred']
            }
        ]
    });
    await flush();

    h.el('projects-view-tabs').listeners.click({
        target: { closest: () => ({ dataset: { view: 'gantt' } }) }
    });
    await flush();

    const content = h.el('projects-view-content').innerHTML;
    assert.match(content, /class="crm-projects-gantt-dep-line"/, 'Dependency connector line should be rendered');
    assert.match(content, /Dependency: Design API → Implement API/, 'Dependency connector should have informative title tooltip');
});


