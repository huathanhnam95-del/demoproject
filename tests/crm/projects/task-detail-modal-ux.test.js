'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const boardSource = fs.readFileSync(path.resolve(__dirname, '../../../public/js/crm/projects/board.js'), 'utf8');
const viewsSource = fs.readFileSync(path.resolve(__dirname, '../../../public/js/crm/projects/views.js'), 'utf8');

const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(setImmediate); };

function createHarnessEnvironment() {
    const controls = new Map();
    function el(id) {
        if (!controls.has(id)) {
            const elem = {
                id,
                value: '',
                textContent: '',
                _html: '',
                get innerHTML() { return this._html; },
                set innerHTML(val) {
                    this._html = val;
                    if (this.id === 'projects-task-planning') {
                        const depMatch = val.match(/<textarea id="projects-task-predecessors"[^>]*>([\s\S]*?)<\/textarea>/);
                        if (depMatch) el('projects-task-predecessors').value = depMatch[1];
                        const derivedMatch = val.match(/<div id="projects-task-derived">([\s\S]*?)<\/div><form id="projects-task-schedule"/);
                        if (derivedMatch) el('projects-task-derived').innerHTML = derivedMatch[1];
                    }
                },
                hidden: false,
                disabled: false,
                listeners: {},
                dataset: {},
                children: [],
                classList: {
                    _classes: new Set(),
                    add(c) { this._classes.add(c); },
                    remove(c) { this._classes.delete(c); },
                    contains(c) { return this._classes.has(c); }
                },
                addEventListener(name, fn) { this.listeners[name] = fn; },
                dispatchEvent(event) { if (this.listeners[event.type]) this.listeners[event.type](event); },
                querySelectorAll() { return []; },
                querySelector() { return null; },
                replaceChildren(...children) { this.children = children; },
                reset() {},
                elements: { namedItem: (name) => el(`filter-${name}`) },
                style: { setProperty() {} }
            };
            controls.set(id, elem);
        }
        return controls.get(id);
    }
    return { el, controls };
}

test('board.js renderDetail() renders modern property bar with owner, priority, status, copy button and collapsible tech drawer', async () => {
    let capturedHtml = '';
    const { el } = createHarnessEnvironment();
    const elements = {
        projectsBoardDetail: el('projects-board-detail'),
        projectsBoardDetailTitle: el('projects-board-detail-title'),
        projectsBoardDetailBody: el('projects-board-detail-body'),
        projectsBoardRows: el('projects-board-rows'),
        projectsBoardHeader: el('projects-board-header'),
        projectsBoardCount: el('projects-board-count'),
        projectsBoardWorkspace: el('projects-board-workspace'),
        projectsBoardEmpty: el('projects-board-empty')
    };

    Object.defineProperty(elements.projectsBoardDetailBody, 'innerHTML', {
        get() { return capturedHtml; },
        set(val) { capturedHtml = val; }
    });

    const task = {
        id: 'task-cfe74291-a1b2-c3d4',
        title: 'Q3 Enterprise Deployment',
        revision: 4,
        status: 'in_progress',
        lifecycle: 'active',
        ownerUid: 'uid-alice',
        values: { priority: 'urgent' },
        pathIds: ['root-proj', 'sprint-1']
    };

    const members = [
        { uid: 'uid-alice', displayName: 'Alice Walker' },
        { uid: 'uid-bob', displayName: 'Bob Martin' }
    ];

    const context = {
        console,
        document: {
            getElementById: (id) => elements[id] || null,
            activeElement: null,
            createElement: () => el('temp-element')
        },
        URLSearchParams,
        setTimeout,
        clearTimeout
    };

    vm.runInNewContext(boardSource, context);
    const controller = context.CrmProjectsBoard.createController({
        elements,
        getCurrentUser: () => ({ uid: 'uid-alice' }),
        apiFetchJson: async (url) => {
            if (url.endsWith('/member-directory')) return { people: members };
            if (url.includes('/tasks?')) return { tasks: [task], sections: [{ id: 's1', title: 'Sec 1' }], columns: [] };
            return {
                project: { id: 'proj-1', name: 'Main Project', revision: 1, structureRevision: 1, lifecycle: 'active' },
                membership: { role: 'Owner' }
            };
        }
    });

    controller.init();
    controller.setProjects({ projects: [{ id: 'proj-1', role: 'Owner' }], selectedProjectId: 'proj-1' });
    await flush();

    // Select task via controller
    controller.selectTask(task);

    // Verify properties rendered in detail body
    assert.match(capturedHtml, /crm-detail-property-bar/, 'Should render modern property bar');
    assert.match(capturedHtml, /crm-detail-path-chip/, 'Should render breadcrumb path chip');
    assert.match(capturedHtml, /crm-pill-status/, 'Should render status pill');
    assert.match(capturedHtml, /data-status="in_progress"/, 'Status pill should have in_progress data-status');
    assert.match(capturedHtml, /crm-pill-owner/, 'Should render owner pill');
    assert.match(capturedHtml, /Alice Walker/, 'Owner pill should display member name');
    assert.match(capturedHtml, /crm-pill-priority/, 'Should render priority pill');
    assert.match(capturedHtml, /URGENT/, 'Priority pill should display URGENT');
    assert.match(capturedHtml, /crm-detail-copy-id/, 'Should render copy ID button');
    assert.match(capturedHtml, /data-copy-id="task-cfe74291-a1b2-c3d4"/, 'Copy ID button must have target UUID');

    // Verify collapsible technical info drawer preserves backward compatibility
    assert.match(capturedHtml, /<details class="crm-detail-tech-drawer"/, 'Should wrap technical info in collapsible details');
    assert.match(capturedHtml, /<dt>Task ID<\/dt><dd>task-cfe74291-a1b2-c3d4<\/dd>/, 'Technical info must retain dt/dd Task ID for test compatibility');
    assert.match(capturedHtml, /<dt>Revision<\/dt><dd>4<\/dd>/, 'Technical info must retain dt/dd Revision');
});

test('views.js derived() renders compact inline for rows and rich multi-segment battery card for detail', async () => {
    const { el } = createHarnessEnvironment();

    const taskWithBattery = {
        id: 'task-parent',
        title: 'Parent with Subtasks',
        revision: 2,
        status: 'in_progress',
        activeChildCount: 2,
        derived: {
            activeLeafCount: 4,
            completedLeafCount: 2,
            completionPercent: 50,
            startDate: '2026-09-01',
            dueDate: '2026-09-15',
            statusBattery: {
                done: 2,
                in_progress: 1,
                blocked: 1,
                not_started: 0,
                total: 4
            }
        }
    };

    const board = {
        getState: () => ({
            project: { id: 'p1' },
            membership: { role: 'Owner' },
            tasks: new Map([
                ['task-parent', taskWithBattery],
                ['task-dep-ext', { id: 'task-dep-ext', title: 'External Dependency from Board' }]
            ])
        }),
        selectTask: () => {}
    };

    const context = {
        console,
        URLSearchParams,
        Date,
        Math,
        crypto: { randomUUID: () => 'uuid' },
        document: { getElementById: el, querySelectorAll: () => [] }
    };

    vm.runInNewContext(viewsSource, context);
    const controller = context.CrmProjectsViews.createController({
        board,
        getCurrentUser: () => ({ uid: 'user-1' }),
        apiFetchJson: async () => ({
            project: { id: 'p1', revision: 1, structureRevision: 1 },
            tasks: [taskWithBattery],
            matchingTaskCount: 1
        })
    });

    controller.init();
    controller.setProject('p1');
    await flush();

    // 1. Verify detail view derived rendering
    controller.setTask(taskWithBattery);
    const planningHtml = el('projects-task-planning').innerHTML;

    assert.match(planningHtml, /crm-detail-progress-card/, 'Task details must render progress card');
    assert.match(planningHtml, /crm-battery-track/, 'Should render multi-segment battery track when statusBattery is present');
    assert.match(planningHtml, /is-done/, 'Battery track must include is-done segment');
    assert.match(planningHtml, /is-in-progress/, 'Battery track must include is-in-progress segment');
    assert.match(planningHtml, /is-blocked/, 'Battery track must include is-blocked segment');
    assert.match(planningHtml, /2\/4.*complete \(50%\)/, 'Must display ratio and percentage');
    assert.match(planningHtml, /Descendant span: 2026-09-01 → 2026-09-15/, 'Must display clean descendant span');

    // 2. Verify row view (timeline) derived rendering does NOT render the full card
    el('projects-view-tabs').listeners.click?.({
        target: { closest: () => ({ dataset: { view: 'timeline' } }) }
    });
    const listContent = el('projects-view-content').innerHTML;
    assert.doesNotMatch(listContent, /crm-detail-progress-card/, 'List rows must not contain massive detail card');
    assert.match(listContent, /<small class="crm-projects-derived">/, 'List rows must contain compact inline small derived tag');
});

test('views.js renders interactive predecessor chips and resolves titles from board state', async () => {
    const { el } = createHarnessEnvironment();

    const task = {
        id: 'task-target',
        title: 'Target Task',
        revision: 1,
        status: 'not_started',
        predecessorTaskIds: ['task-page-1', 'task-board-only', 'task-unknown-uuid-1234567890']
    };

    const board = {
        getState: () => ({
            project: { id: 'p1', structureRevision: 1 },
            membership: { role: 'Owner' },
            tasks: new Map([
                ['task-target', task],
                ['task-board-only', { id: 'task-board-only', title: 'Board Only Task' }]
            ])
        }),
        selectTask: () => {}
    };

    const context = {
        console,
        URLSearchParams,
        Date,
        Math,
        crypto: { randomUUID: () => 'uuid' },
        document: { getElementById: el, querySelectorAll: () => [] }
    };

    vm.runInNewContext(viewsSource, context);
    const controller = context.CrmProjectsViews.createController({
        board,
        getCurrentUser: () => ({ uid: 'user-1' }),
        apiFetchJson: async () => ({
            project: { id: 'p1', revision: 1, structureRevision: 1 },
            tasks: [task, { id: 'task-page-1', title: 'Page 1 Task' }],
            matchingTaskCount: 2
        })
    });

    controller.init();
    controller.setProject('p1');
    await flush();

    controller.setTask(task);

    const chipsContainer = el('projects-task-predecessor-chips');
    const chipsHtml = chipsContainer.innerHTML;

    // Verify predecessor title resolution
    assert.match(chipsHtml, /Page 1 Task/, 'Should resolve title for predecessor from current view page');
    assert.match(chipsHtml, /Board Only Task/, 'Should resolve title for predecessor from board state');
    assert.match(chipsHtml, /Task \(task-unk…\)/, 'Should format unknown UUID with clean truncated label');
    assert.match(chipsHtml, /data-remove-predecessor="task-board-only"/, 'Should render remove button with data-remove-predecessor');

    // Test removing a predecessor chip
    const removeBtn = {
        dataset: { removePredecessor: 'task-board-only' },
        closest: (sel) => sel.includes('data-remove-predecessor') ? removeBtn : null
    };

    el('projects-task-planning').listeners.click?.({
        target: removeBtn
    });

    const updatedTextareaValue = el('projects-task-predecessors').value;
    assert.doesNotMatch(updatedTextareaValue, /task-board-only/, 'Removing chip must remove ID from predecessors textarea');
    assert.match(updatedTextareaValue, /task-page-1/, 'Other predecessor IDs must remain');

    // Test adding a predecessor resets the select picker
    el('projects-task-predecessor-picker').value = 'task-new-dep';
    el('projects-task-planning').listeners.click?.({
        target: { id: 'projects-task-predecessor-add', dataset: {} }
    });

    assert.equal(el('projects-task-predecessor-picker').value, '', 'Adding predecessor must clear picker value');
    assert.match(el('projects-task-predecessors').value, /task-new-dep/, 'Added ID must be appended to textarea');
});

test('views.js schedulePreview() renders modern comparison card with before/after pills', async () => {
    const { el } = createHarnessEnvironment();

    const task = {
        id: 'task-preview-test',
        title: 'Preview Task',
        revision: 1,
        startDate: '2026-09-01',
        dueDate: '2026-09-05'
    };

    const board = {
        getState: () => ({ project: { id: 'p1' }, membership: { role: 'Owner' }, tasks: new Map() }),
        selectTask: () => {}
    };

    const context = {
        console,
        URLSearchParams,
        Date,
        Math,
        crypto: { randomUUID: () => 'uuid' },
        document: { getElementById: el, querySelectorAll: () => [] }
    };

    vm.runInNewContext(viewsSource, context);
    const controller = context.CrmProjectsViews.createController({
        board,
        getCurrentUser: () => ({ uid: 'user-1' }),
        apiFetchJson: async (url) => {
            if (url.includes('/schedule-preview')) {
                return {
                    preview: {
                        token: 'tok-123',
                        canApply: true,
                        workingDayCount: 5,
                        calendarRevision: 2,
                        feedVersion: 1,
                        before: { startDate: '2026-09-01', dueDate: '2026-09-05' },
                        after: { startDate: '2026-09-10', dueDate: '2026-09-15' },
                        warnings: [],
                        nonWorkingDays: []
                    }
                };
            }
            return { project: { id: 'p1' }, tasks: [task], matchingTaskCount: 1 };
        }
    });

    controller.init();
    controller.setProject('p1');
    await flush();

    controller.setTask(task);
    el('projects-task-start').value = '2026-09-10';
    el('projects-task-due').value = '2026-09-15';

    // Submit schedule form to trigger preview
    el('projects-task-planning').listeners.submit?.({
        preventDefault() {},
        target: { id: 'projects-task-schedule' }
    });
    await flush();

    const previewHtml = el('projects-task-preview').innerHTML;
    assert.match(previewHtml, /crm-detail-preview-card/, 'Must render structured preview card');
    assert.match(previewHtml, /2026-09-01 → 2026-09-05/, 'Must display before dates');
    assert.match(previewHtml, /2026-09-10 → 2026-09-15/, 'Must display after dates');
    assert.match(previewHtml, /Working days: 5/, 'Must display working days count');
    assert.match(previewHtml, /id="projects-task-apply"/, 'Must retain apply preview button');
    assert.match(previewHtml, /crm-preview-tech/, 'Must tuck calendar revision into details disclosure');
});
