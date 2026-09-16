'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.resolve(__dirname, '../../../public/js/crm/projects/board.js'), 'utf8');
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(setImmediate); };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

// Small DOM adapter: exercise controller events and mounted rows without a browser dependency.
class Node {
    constructor(tag = 'div', attrs = {}) {
        this.tagName = tag.toUpperCase(); this.attrs = {}; this.dataset = {}; this.children = []; this.listeners = {};
        this.style = { setProperty(name, value) { this[name] = value; } }; this.value = ''; this.textContent = '';
        this.classList = { contains: name => this.className.split(' ').includes(name), add: name => { this.className += ` ${name}`; }, toggle: () => {} };
        Object.entries(attrs).forEach(([key, value]) => this.setAttribute(key, value));
    }
    get className() { return this.attrs.class || ''; }
    set className(value) { this.attrs.class = value; }
    get childNodes() { return this.children; }
    get attributes() { return Object.entries(this.attrs).map(([name, value]) => ({ name, value })); }
    setAttribute(key, value) { this.attrs[key] = String(value); if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = String(value); if (key === 'value') this.value = value; }
    getAttribute(key) { return this.attrs[key] ?? null; }
    hasAttribute(key) { return key in this.attrs; }
    removeAttribute(key) { delete this.attrs[key]; }
    get disabled() { return this.hasAttribute('disabled'); }
    set disabled(value) { if (value) this.setAttribute('disabled', ''); else this.removeAttribute('disabled'); }
    get type() { return this.attrs.type || ''; }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    appendChild(child) { child.remove(); child.parent = this; this.children.push(child); return child; }
    insertBefore(child, sibling) { child.remove(); child.parent = this; this.children.splice(this.children.indexOf(sibling), 0, child); }
    prepend(child) { child.parent = this; this.children.unshift(child); }
    remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; }
    replaceWith(next) { const parent = this.parent, index = parent.children.indexOf(this); next.remove(); parent.children[index] = next; next.parent = parent; this.parent = null; }
    contains(node) { return this === node || this.children.some(child => child.contains(node)); }
    matches(selector) { return selector.split(',').some(part => { part = part.trim(); if (part.startsWith('.')) return this.classList.contains(part.slice(1)); const match = part.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/); return match ? this.hasAttribute(match[1]) && (match[2] === undefined || this.getAttribute(match[1]) === match[2]) : this.tagName.toLowerCase() === part; }); }
    closest(selector) { return this.matches(selector) ? this : this.parent?.closest(selector) || null; }
    querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    set innerHTML(html) {
        this.children = []; const stack = [this];
        for (const match of html.matchAll(/<\/?[a-z][^>]*>|[^<]+/gi)) {
            const token = match[0]; if (token.startsWith('</')) { stack.pop(); continue; }
            if (!token.startsWith('<')) { stack.at(-1).textContent += token.trim(); continue; }
            const tag = token.match(/^<([a-z]+)/i)[1], attrs = {};
            for (const attribute of token.slice(tag.length + 1, -1).matchAll(/([^\s=]+)(?:="([^"]*)")?/g)) attrs[attribute[1]] = attribute[2] || '';
            const child = stack.at(-1).appendChild(new Node(tag, attrs));
            if (!['input', 'br', 'hr'].includes(tag)) stack.push(child);
        }
    }
}
function fixture() {
    const elements = Object.fromEntries(['projectsBoardRows', 'projectsBoardScroll', 'projectsBoardAddTask', 'projectsBoardDetail', 'projectsBoardSectionForm', 'projectsBoardSectionName', 'projectsBoardAddSection', 'projectsBoardCancelSection', 'projectsBoardSaveSection'].map(name => [name, new Node()]));
    let uid = 'actor', held = null;
    const selections = [], writes = [], writePayloads = [], reads = [];
    const document = { activeElement: null, getElementById: () => null, createElement: () => { const template = new Node(); Object.defineProperty(template, 'content', { get: () => ({ firstElementChild: template.children[0] }) }); return template; } };
    const context = { console, document, URLSearchParams, CSS: { escape: value => value }, setTimeout, clearTimeout, clearInterval };
    vm.runInNewContext(source, context);
    const branch = {
        __root__: [{ id: 'root', sectionId: 'group', title: 'Root', ownerUid: 'actor', status: 'done', activeChildCount: 1, revision: 1 }],
        root: [{ id: 'child', parentTaskId: 'root', effectiveSectionId: 'group', title: 'Child', activeChildCount: 1 }],
        child: [{ id: 'leaf', parentTaskId: 'child', effectiveSectionId: 'group', title: 'Leaf', activeChildCount: 0 }]
    };
    const board = context.CrmProjectsBoard.createController({ elements, getCurrentUser: () => ({ uid }), onTaskSelection: task => selections.push(task?.id || null), apiFetchJson: async (url, options) => {
        if (options) {
            writes.push(url);
            const parsed = options.body ? JSON.parse(options.body) : {};
            writePayloads.push({ url, options, parsed });
            if (held) await held.promise;
            if (url.includes('/sections')) {
                const isPatch = options.method === 'PATCH';
                const isMove = url.includes('/move');
                const sectionIdMatch = url.match(/\/sections\/([^/?]+)/);
                return {
                    section: {
                        id: sectionIdMatch ? sectionIdMatch[1] : 'server-sec-1',
                        title: parsed.title || 'New section',
                        rank: isMove && parsed.index === 0 ? '-1/1' : '999999/1',
                        revision: isPatch || isMove ? 2 : 1
                    },
                    structureRevision: 2
                };
            }
            return {
                task: {
                    id: 'server-task-1',
                    title: parsed.title || 'New task',
                    parentTaskId: parsed.parentTaskId || null,
                    sectionId: parsed.sectionId || 'group',
                    effectiveSectionId: parsed.sectionId || 'group',
                    revision: 1
                },
                structureRevision: 2
            };
        }
        reads.push(url);
        if (url.endsWith('/member-directory')) return { people: [{ uid: 'actor', displayName: 'Alex Nguyen' }] };
        if (url.includes('/tasks?')) { const filters = JSON.parse(new URLSearchParams(url.split('?')[1]).get('filters')); return { tasks: branch[filters.parentTaskId || '__root__'] || [], sections: [{ id: 'group', title: 'Delivery', color: 'url(unsafe)' }], columns: [] }; }
        if (held) await held.promise;
        return { project: { id: url.split('/').pop(), lifecycle: 'active', revision: 1 }, membership: { role: 'Owner' } };
    } });
    board.init();
    const select = id => board.setProjects({ projects: [{ id, role: 'Owner' }], selectedProjectId: id });
    select('a');
    const row = id => elements.projectsBoardRows.querySelector(`[data-row-id="${id}"]`);
    const click = node => { document.activeElement = node; elements.projectsBoardRows.listeners.click({ target: node, stopPropagation() {} }); };
    return { board, elements, selections, writes, writePayloads, reads, document, row, click, select, actor: value => { uid = value; }, hold: () => (held = deferred()), ids: () => elements.projectsBoardRows.children.map(node => node.dataset.rowId) };
}

test('group collapse hides its expanded hierarchy, preserves focus and restores it through refresh/filtering', async () => {
    const h = fixture(); await flush();
    h.click(h.row('task:root').querySelector('[data-action="toggle-task"]')); await flush();
    h.click(h.row('task:child').querySelector('[data-action="toggle-task"]')); await flush();
    assert.deepEqual(h.ids(), ['section:group', 'task:root', 'task:child', 'task:leaf']);
    const toggle = h.row('section:group').querySelector('[data-action="toggle-section"]');
    h.click(toggle); assert.deepEqual(h.ids(), ['section:group']); assert.equal(h.elements.projectsBoardRows.style.height, '44px');
    assert.equal(h.document.activeElement, toggle); assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    await h.board.setFilters({ status: 'done' }); assert.deepEqual(h.ids(), ['section:group']);
    h.click(toggle); assert.deepEqual(h.ids(), ['section:group', 'task:root', 'task:child', 'task:leaf']);
    assert.equal(h.elements.projectsBoardRows.style.height, '176px');
    h.click(toggle); h.select('b'); await flush(); assert.deepEqual(h.ids(), ['section:group', 'task:root']);
});

test('native edits keep details closed, explicit details select task, and presentation follows retained rows', async () => {
    const h = fixture(); await flush(); h.selections.length = 0;
    const row = h.row('task:root');
    for (const kind of ['title', 'status', 'ownerUid', 'startDate']) h.click(row.querySelector(`[data-field-kind="${kind}"]`));
    assert.deepEqual(h.selections, []);
    assert.equal(row.querySelector('[data-field-kind="status"]').getAttribute('data-status'), 'done');
    assert.equal(row.querySelector('.crm-board-owner-avatar').textContent, 'AN');
    const detailButton = row.querySelector('[data-action="open-detail"]');
    h.click(detailButton); assert.deepEqual(h.selections, ['root']);
    assert.equal(h.document.activeElement, detailButton); assert.equal(h.elements.projectsBoardRows.contains(detailButton), true);
    const status = h.row('task:root').querySelector('[data-field-kind="status"]'); status.value = 'blocked';
    h.elements.projectsBoardRows.listeners.input({ target: status });
    h.click(h.row('section:group').querySelector('[data-action="toggle-section"]'));
    h.click(h.row('section:group').querySelector('[data-action="toggle-section"]'));
    assert.equal(h.row('task:root').querySelector('.crm-board-status-cell').getAttribute('data-status'), 'blocked');
});

test('collapse during pending authority remains local and actor changes clear mounted content', async () => {
    const h = fixture(); await flush(); const held = h.hold(); const pending = h.board.refresh(); await flush();
    assert.equal(h.board.getState().authorityPending, true);
    h.click(h.row('section:group').querySelector('[data-action="toggle-section"]'));
    assert.deepEqual(h.ids(), ['section:group']); assert.equal(h.elements.projectsBoardAddTask.disabled, true);
    const task = new Node('div', { 'data-row-id': 'task:root', 'data-task-id': 'root', 'data-row-kind': 'task' });
    h.elements.projectsBoardRows.listeners.keydown({ target: task, key: 'n', ctrlKey: true, preventDefault() {} }); await flush(); assert.deepEqual(h.writes, []);
    h.actor('different'); h.click(h.row('section:group').querySelector('[data-action="toggle-section"]'));
    assert.equal(h.board.getState().project, null); assert.deepEqual(h.ids(), []);
    held.resolve(); await pending; assert.equal(h.board.getState().tasks.size, 0); assert.deepEqual(h.writes, []);
});

test('leaf task renders clickable expander to add subtask, mounts immediately at 0ms and reconciles with server', async () => {
    const h = fixture(); await flush();
    h.click(h.row('task:root').querySelector('[data-action="toggle-task"]')); await flush();
    h.click(h.row('task:child').querySelector('[data-action="toggle-task"]')); await flush();
    assert.deepEqual(h.ids(), ['section:group', 'task:root', 'task:child', 'task:leaf']);

    const leafRow = h.row('task:leaf');
    const leafExpander = leafRow.querySelector('.crm-board-expander');
    assert.equal(leafExpander.classList.contains('is-leaf'), true);
    assert.equal(leafExpander.getAttribute('data-action'), 'add-subtask');
    assert.equal(leafExpander.textContent, '▸');

    // Hold the server response so mutation is in-flight
    const held = h.hold();
    // Click the leaf expander to add a subtask
    h.click(leafExpander);

    // Synchronously / 0ms: the optimistic subtask row MUST be mounted already!
    const idsWithOptimistic = h.ids();
    assert.equal(idsWithOptimistic.length, 5);
    assert.equal(idsWithOptimistic[3], 'task:leaf');
    assert.match(idsWithOptimistic[4], /^task:opt-task-/);

    // Resolve the held server mutation
    held.resolve(); await flush();

    // After mutation resolves, the optimistic ID is reconciled to server ID
    assert.deepEqual(h.ids(), ['section:group', 'task:root', 'task:child', 'task:leaf', 'task:server-task-1']);
    assert.equal(h.writes.length, 1);
    assert.match(h.writes[0], /\/tasks$/);
});

test('status pill renders with color dot and text, and status change synchronously updates data-status and text at 0ms', async () => {
    const h = fixture(); await flush();
    const row = h.row('task:root');
    const pill = row.querySelector('.crm-board-status-pill');
    assert.ok(pill, 'Status pill button must exist');
    assert.equal(pill.getAttribute('data-status'), 'done');
    assert.equal(pill.querySelector('.crm-board-status-text').textContent, 'Done');
    assert.ok(pill.querySelector('.crm-board-status-dot'), 'Dot indicator must exist');

    const select = row.querySelector('[data-field-kind="status"]');
    assert.ok(select, 'Native select must exist for automation');
    assert.equal(select.getAttribute('data-status'), 'done');

    // Change status to in_progress via input event
    select.value = 'in_progress';
    h.elements.projectsBoardRows.listeners.input({ target: select });

    // Instantly in 0ms: pill, cell, and select MUST have updated data-status
    assert.equal(pill.getAttribute('data-status'), 'in_progress');
    assert.equal(pill.querySelector('.crm-board-status-text').textContent, 'In progress');
    assert.equal(row.querySelector('.crm-board-status-cell').getAttribute('data-status'), 'in_progress');
    assert.equal(select.getAttribute('data-status'), 'in_progress');
});

test('section creation mounts immediately at 0ms and reconciles optimistic ID with server response', async () => {
    const h = fixture(); await flush();
    assert.deepEqual(h.ids(), ['section:group', 'task:root']);

    // Set section name in form and hold the server response
    h.elements.projectsBoardSectionName.value = 'Q3 Sprint';
    const held = h.hold();

    // Submit section form
    h.elements.projectsBoardSectionForm.listeners.submit({ preventDefault() {} });

    // Synchronously at 0ms: optimistic section row MUST be mounted and form hidden
    const idsWithOptimistic = h.ids();
    assert.equal(idsWithOptimistic.length, 3);
    assert.match(idsWithOptimistic[2], /^section:opt-sec-/);
    assert.equal(h.elements.projectsBoardSectionForm.hidden, true);

    // Release server response
    held.resolve(); await flush();

    // After server response: optimistic ID is reconciled to server ID
    assert.deepEqual(h.ids(), ['section:group', 'task:root', 'section:server-sec-1']);
    assert.equal(h.writes.length, 1);
    assert.match(h.writes[0], /\/sections$/);
    assert.equal(h.writePayloads[0].parsed.title, 'Q3 Sprint');
});

test('section title input tracks draft across renders and persists on change', async () => {
    const h = fixture(); await flush();
    const sectionRow = h.row('section:group');
    const sectionInput = sectionRow.querySelector('.crm-board-section-input');
    assert.ok(sectionInput, 'Section title input must exist for Owner');
    assert.equal(sectionInput.value, 'Delivery');

    // Type into section input
    sectionInput.value = 'Updated Delivery Title';
    h.elements.projectsBoardRows.listeners.input({ target: sectionInput });

    // Toggle a task to cause a board re-render
    h.click(h.row('task:root').querySelector('[data-action="toggle-task"]')); await flush();

    // Section input MUST retain draft title across re-render
    const reRenderedInput = h.row('section:group').querySelector('.crm-board-section-input');
    assert.equal(reRenderedInput.value, 'Updated Delivery Title');

    // Fire change event to persist section
    h.elements.projectsBoardRows.listeners.change({ target: reRenderedInput }); await flush();

    // Verify PATCH write was sent with new title
    assert.equal(h.writes.length, 1);
    assert.match(h.writes[0], /\/sections\/group$/);
    assert.equal(h.writePayloads[0].options.method, 'PATCH');
    assert.equal(h.writePayloads[0].parsed.title, 'Updated Delivery Title');
});

test('applyRemote suppresses loadProject for self-echo changes but reloads for external changes', async () => {
    const h = fixture(); await flush();

    // Trigger an operation (create a section) to register an operationId in recentlyExecutedOperations
    h.elements.projectsBoardSectionName.value = 'Self-Echo Section';
    h.elements.projectsBoardSectionForm.listeners.submit({ preventDefault() {} });
    await flush();

    assert.equal(h.writePayloads.length, 1);
    const selfOpId = h.writePayloads[0].parsed.operationId;
    assert.ok(selfOpId, 'Operation must have generated an operationId');

    const readsBeforeSelfEcho = h.reads.length;

    // Apply remote change feed event with selfOpId and refresh: true
    const selfEchoResult = await h.board.applyRemote({
        isCurrent: () => true,
        authority: {
            project: { id: 'a', structureRevision: 3, schemaRevision: 0, lifecycle: 'active', revision: 2 },
            membership: { role: 'Owner', revision: 1 },
            signature: 'sig-1'
        },
        changes: [{ operationId: selfOpId, refresh: true }],
        hydration: { unavailableTaskIds: [], tasks: [] }
    });

    await flush();
    assert.equal(selfEchoResult, true);
    // Self-echo MUST be suppressed: no network reads / loadProject calls occurred!
    assert.equal(h.reads.length, readsBeforeSelfEcho);

    // Now send a remote change from an external source (unknown operationId) with refresh: true
    const externalResult = await h.board.applyRemote({
        isCurrent: () => true,
        authority: {
            project: { id: 'a', structureRevision: 4, schemaRevision: 0, lifecycle: 'active', revision: 3 },
            membership: { role: 'Owner', revision: 1 },
            signature: 'sig-2'
        },
        changes: [{ operationId: 'external-op-999', refresh: true }],
        hydration: { unavailableTaskIds: [], tasks: [] }
    });

    await flush();
    assert.equal(externalResult, true);
    // External change MUST trigger loadProject to reload project state from server
    assert.ok(h.reads.length > readsBeforeSelfEcho, 'External change must trigger project reload reads');
});

test('task creation in an in-flight optimistic section awaits section creation and reconciles server section ID', async () => {
    const h = fixture(); await flush();
    assert.deepEqual(h.ids(), ['section:group', 'task:root']);

    // Hold server responses
    const held = h.hold();

    // Create optimistic section
    h.elements.projectsBoardSectionName.value = 'In-Flight Section';
    h.elements.projectsBoardSectionForm.listeners.submit({ preventDefault() {} });

    // Instantly at 0ms: optimistic section is mounted
    const idsAfterSec = h.ids();
    assert.equal(idsAfterSec.length, 3);
    const optSecId = idsAfterSec[2].replace('section:', '');
    assert.match(optSecId, /^opt-sec-/);

    // Select this optimistic section by creating a task in it
    h.board.createTask(null, optSecId);

    // Instantly at 0ms: optimistic task row is mounted
    const idsAfterTask = h.ids();
    assert.equal(idsAfterTask.length, 4);
    assert.match(idsAfterTask[3], /^task:opt-task-/);

    // Now resolve server response
    held.resolve(); await flush();

    // Both section and task are reconciled with server IDs
    assert.deepEqual(h.ids(), ['section:group', 'task:root', 'section:server-sec-1', 'task:server-task-1']);
    assert.equal(h.writes.length, 2);
    assert.match(h.writes[0], /\/sections$/);
    assert.match(h.writes[1], /\/tasks$/);
    // The task creation request MUST have been sent with the reconciled server section ID, NOT the opt-sec- ID!
    assert.equal(h.writePayloads[1].parsed.sectionId, 'server-sec-1');
});

test('moving an in-flight optimistic section reorders in memory at 0ms and reconciles server ID before dispatching move mutation', async () => {
    const h = fixture(); await flush();
    assert.deepEqual(h.ids(), ['section:group', 'task:root']);

    // Hold server responses
    const held = h.hold();

    // Create optimistic section
    h.elements.projectsBoardSectionName.value = 'Moving Section';
    h.elements.projectsBoardSectionForm.listeners.submit({ preventDefault() {} });

    const idsAfterSec = h.ids();
    assert.equal(idsAfterSec.length, 3);
    const optSecId = idsAfterSec[2].replace('section:', '');
    assert.match(optSecId, /^opt-sec-/);

    // Move the optimistic section to index 0
    h.board.moveSection(optSecId, 0);

    // Instantly at 0ms: sections are reordered in DOM!
    const idsAfterMove = h.ids();
    assert.equal(idsAfterMove[0], `section:${optSecId}`);

    // Resolve server responses
    held.resolve(); await flush();

    // Reconciles to server section ID at index 0
    assert.deepEqual(h.ids(), ['section:server-sec-1', 'section:group', 'task:root']);
    assert.equal(h.writes.length, 2);
    assert.match(h.writes[0], /\/sections$/);
    assert.match(h.writes[1], /\/sections\/server-sec-1\/move$/);
    assert.equal(h.writePayloads[1].parsed.index, 0);
});

test('section title draft preserves newer typing if older save was in-flight', async () => {
    const h = fixture(); await flush();
    const sectionRow = h.row('section:group');
    const sectionInput = sectionRow.querySelector('.crm-board-section-input');

    // Type first title
    sectionInput.value = 'In Flight Title';
    h.elements.projectsBoardRows.listeners.input({ target: sectionInput });

    // Hold the PATCH save response
    const held = h.hold();

    // Blur / change to trigger saveSection
    h.elements.projectsBoardRows.listeners.change({ target: sectionInput });

    // While save is in-flight, user continues typing
    sectionInput.value = 'In Flight Title Newer Edit';
    h.elements.projectsBoardRows.listeners.input({ target: sectionInput });

    // Release the first save response
    held.resolve(); await flush();

    // The newer draft must NOT have been wiped out by the first save completing!
    const reRenderedInput = h.row('section:group').querySelector('.crm-board-section-input');
    assert.equal(reRenderedInput.value, 'In Flight Title Newer Edit');
});

test('non-title field edits on optimistic tasks are dispatched upon server creation resolution', async () => {
    const h = fixture(); await flush();
    const held = h.hold();

    // Create optimistic task
    h.board.createTask(null, 'group');
    const optRowId = h.ids().find(id => id.startsWith('task:opt-task-'));
    assert.ok(optRowId);

    // Edit status on the optimistic task before server creates it
    const statusSelect = h.row(optRowId).querySelector('.crm-board-status-select');
    statusSelect.value = 'in_progress';
    h.elements.projectsBoardRows.listeners.change({ target: statusSelect });

    // Resolve server task creation
    held.resolve(); await flush();

    // Verify task is reconciled with server ID
    assert.ok(h.ids().includes('task:server-task-1'));
    // The second write should be the PATCH status mutation for the newly created server task
    assert.ok(h.writes.some(w => w.includes('/tasks/server-task-1')));
    const patchWriteIdx = h.writes.findIndex(w => w.includes('/tasks/server-task-1'));
    assert.equal(h.writePayloads[patchWriteIdx].parsed.status, 'in_progress');
});

test('moving an in-flight optimistic task awaits task creation and reconciles server task ID', async () => {
    const h = fixture(); await flush();
    const held = h.hold();

    // Create optimistic task
    h.board.createTask(null, 'group');
    const optRowId = h.ids().find(id => id.startsWith('task:opt-task-'));
    const optTaskId = optRowId.replace('task:', '');

    // Attempt to move optimistic task before server returns
    const movePromise = h.board.moveTask(optTaskId, { sectionId: 'group', index: 0 });

    // Release server creation
    held.resolve(); await flush();
    await movePromise; await flush();

    // The move mutation should be dispatched against the reconciled server task ID
    assert.ok(h.writes.some(w => w.includes('/tasks/server-task-1/move')));
});




