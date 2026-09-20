'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require(process.env.CRM_TEST_JSDOM || 'jsdom');
const root = path.resolve(__dirname, '../../..');
async function fixture(url = 'https://fixture.invalid/crm-admin.html?keep=yes#projects', presentationV2 = true) {
    const dom = new JSDOM(fs.readFileSync(path.join(root, 'public/crm-admin.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ''), { runScripts: 'outside-only', pretendToBeVisual: true, url });
    const win = dom.window;
    win.HTMLDialogElement.prototype.show = win.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    win.HTMLDialogElement.prototype.close = function () { this.open = false; };
    win.document.querySelector('[data-panel="projects"]').getBoundingClientRect = () => ({ width: 1280 });
    win.document.querySelector('[data-panel="projects"]').dataset.projectsUi = presentationV2 ? 'v2' : 'legacy';
    for (const name of ['presentation/column-model', 'presentation/table-layout', 'presentation/field-feedback', 'state', 'presentation/detail-surface', 'board', 'views']) win.eval(fs.readFileSync(path.join(root, `public/js/crm/projects/${name}.js`), 'utf8'));
    const createBoard = win.CrmProjectsBoard.createController;
    win.CrmProjectsBoard.createController = deps => createBoard({ ...deps, presentationV2 });
    const admin = fs.readFileSync(path.join(root, 'public/crm-admin.js'), 'utf8');
    const bindings = Object.fromEntries([...admin.matchAll(/elements\.(projects\w+) = document.getElementById\('([^']+)'\)/g)].map(m => [m[1], m[2]]));
    win.eval(fs.readFileSync(path.join(root, 'tests/fixtures/crm/projects-v2-views.js'), 'utf8'));
    const h = await win.createProjectsViewsFixture(bindings);
    return Object.assign(h, { win, doc: win.document, dispose() { h.close(); win.close(); } });
}
test('all views retain one applied filter query, Vietnamese labels and unrelated route parameters', async () => {
    const h = await fixture(); try {
        h.calls.length = 0;
        await h.views.applyFilters({ status: 'not_started', title: 'Công việc', bogus: 'ignored' });
        for (const view of ['kanban', 'gantt', 'calendar', 'charts', 'board']) {
            h.views.setView(view); await h.wait();
            assert.equal(h.views.getState().filters.title, 'Công việc');
            assert.equal(h.board.getState().filters.status, 'not_started');
            assert.equal(h.views.getState().filters.bogus, undefined);
        }
        assert.equal(new URL(h.win.location.href).searchParams.get('keep'), 'yes');
        assert.equal(h.win.location.hash, '#projects');
        assert.ok(h.calls.filter(c => c.url.includes('/views?')).every(c => JSON.parse(new URL(c.url, h.win.location).searchParams.get('filters')).status === 'not_started'));
    } finally { h.dispose(); }
});
test('unloaded child uses canonical queue without selecting or claiming its branch complete', async () => {
    const h = await fixture(); try {
        assert.equal(h.board.getState().tasks.has('p4'), false);
        const saved = await h.command('p4', 'status', 'done'); await h.wait();
        assert.equal(saved.task.revision, 2); assert.equal(h.board.getState().selectedTaskId, '');
        assert.equal(h.elements.projectsBoardDetail.open, false);
        assert.equal(h.calls.filter(c => c.method === 'PATCH').length, 1);
        assert.equal(h.calls.find(c => c.method === 'PATCH').body.expectedRevision, 1);
        h.doc.querySelector('[data-task-id="p0"] [data-action="toggle-task"]').click(); await h.wait();
        assert.ok(h.calls.some(c => c.url.includes('/tasks?') && JSON.parse(new URL(c.url, h.win.location).searchParams.get('filters')).parentTaskId === 'p0'));
    } finally { h.dispose(); }
});
test('stale revision, foreign scope, Viewer, unknown status and retained draft cannot issue a parallel mutation', async () => {
    const h = await fixture(); try {
        h.tasks[0].revision = 2;
        await assert.rejects(h.command('p0', 'status', 'done', 1), /changed/);
        await assert.rejects(h.board.setTaskField({ taskId: 'p0', field: 'status', value: 'done', revision: 2, projectId: 'q', actorUid: 'a' }), /context/);
        await assert.rejects(h.command('p0', 'status', 'invented'), /Unknown/);
        assert.equal(h.calls.filter(c => c.method === 'PATCH').length, 0);
        h.role = 'Viewer'; await h.board.refresh(); await assert.rejects(h.command('p0', 'status', 'done'), /unavailable/);
        h.role = 'Owner'; await h.board.refresh();
        h.failures.push({ match: '/tasks/p0', status: 409 });
        await h.board.saveTaskField('p0', 'title', { value: 'Bản nháp', dataset: {} });
        await assert.rejects(h.command('p0', 'title', 'Overwrite'), /draft/);
    } finally { h.dispose(); }
});
test('settled mutations invalidate active projections only and hidden views refresh on activation', async () => {
    const h = await fixture(); try {
        const reads = () => h.calls.filter(c => c.url.includes('/views?')).length;
        const before = reads(); await h.command('p0', 'status', 'done'); await h.wait(); assert.equal(reads(), before);
        h.views.setView('kanban'); await h.wait(); assert.equal(reads(), before + 1);
        assert.equal(h.doc.querySelector('[data-task-open="p0"]').dataset.taskRevision, '2');
        const select = h.doc.querySelector('[data-task-status="p0"]'); select.value = 'blocked'; select.dispatchEvent(new h.win.Event('change', { bubbles: true })); await h.wait();
        assert.equal(h.tasks[0].status, 'blocked'); assert.equal(h.board.getState().tasks.get('p0').revision, 3);
        assert.equal(reads(), before + 2); assert.equal(h.board.getState().selectedTaskId, '');
        assert.ok(h.doc.querySelector('[data-status-column="blocked"] [data-task-open="p0"]'));
    } finally { h.dispose(); }
});
test('deep links restore project view task filters and tab; Back/forward never mutate', async () => {
    const h = await fixture('https://fixture.invalid/crm-admin.html?keep=yes&pjProject=q&pjView=kanban&pjTask=q1&pjTab=updates&pjFilters=%7B%22status%22%3A%22done%22%7D#projects'); try {
        await h.wait(); assert.equal(h.board.getState().project.id, 'q'); assert.equal(h.board.getState().selectedTaskId, 'q1');
        assert.equal(h.views.getState().filters.status, 'done'); assert.equal(h.doc.querySelector('[data-detail-tab="updates"]').getAttribute('aria-selected'), 'true');
        await h.views.openTask('q0'); h.win.history.back(); await h.wait(); await h.wait();
        assert.equal(h.board.getState().selectedTaskId, 'q1');
        h.win.history.forward(); await h.wait(); await h.wait(); assert.equal(h.board.getState().selectedTaskId, 'q0');
        assert.equal(h.calls.filter(c => c.method !== 'GET').length, 0);
    } finally { h.dispose(); }
});
test('delayed open cannot replace a newer task, actor or project selection', async () => {
    const h = await fixture(); try {
        let release = h.hold('/tasks/p0'); const first = h.views.openTask('p0'); await h.wait();
        await h.views.openTask('p1'); release(); await first; assert.equal(h.board.getState().selectedTaskId, 'p1');
        release = h.hold('/tasks/p0'); const second = h.views.openTask('p0'); await h.wait(); await h.select('q'); release(); await second; assert.notEqual(h.board.getState().selectedTaskId, 'p0');
        release = h.hold('/tasks/q0'); const third = h.views.openTask('q0'); await h.wait(); h.actor = 'b'; release(); await third; assert.equal(h.board.getState().selectedTaskId, '');
    } finally { h.dispose(); }
});
test('task/project disappearance and denied delayed projections clear private detail', async () => {
    const h = await fixture(); try {
        await h.views.openTask('p0'); h.tasks = h.tasks.filter(t => t.id !== 'p0'); await h.views.openTask('p0');
        assert.equal(h.board.getState().selectedTaskId, ''); assert.equal(new URL(h.win.location.href).searchParams.has('pjTask'), false);
        await h.views.openTask('p1'); const release = h.hold('/views?'); const read = h.views.refresh(); await h.wait();
        h.views.invalidateAccess('p'); release(); await read;
        assert.equal(h.elements.projectsBoardDetail.open, false); assert.equal(h.views.getState().response, null);
        assert.equal(h.doc.querySelector('#projects-task-planning').textContent, '');
    } finally { h.dispose(); }
});
test('active view refresh detects a disappeared selected task and revision updates retain detail drafts', async () => {
    const h = await fixture(); try {
        h.views.setView('kanban'); await h.wait(); await h.views.openTask('p0');
        const input = h.doc.querySelector('#projects-board-detail-body input[data-column-id="notes"]');
        input.value = 'Bản nháp chưa gửi'; input.dispatchEvent(new h.win.Event('input', { bubbles: true }));
        h.tasks[0].revision++; h.tasks[0].status = 'done'; await h.views.refresh(); await h.wait();
        assert.equal(h.board.getState().tasks.get('p0').revision, 2);
        assert.equal(h.doc.querySelector('#projects-board-detail-body input[data-column-id="notes"]').value, 'Bản nháp chưa gửi');
        h.tasks = h.tasks.filter(t => t.id !== 'p0'); await h.views.refresh(); await h.wait();
        assert.equal(h.board.getState().selectedTaskId, ''); assert.equal(h.elements.projectsBoardDetail.open, false);
    } finally { h.dispose(); }
});
test('delayed command read and delayed view projection cannot cross filters, actor or newer revision', async () => {
    const h = await fixture(); try {
        h.views.setView('kanban'); await h.wait();
        const release = h.hold('/tasks/p0');
        const select = h.doc.querySelector('[data-task-status="p0"]'); select.value = 'done'; select.dispatchEvent(new h.win.Event('change', { bubbles: true }));
        await h.wait(); await h.views.applyFilters({ title: 'Công việc 1' }); release(); await h.wait();
        assert.equal(h.calls.filter(c => c.method === 'PATCH').length, 0);
        await h.views.applyFilters({});
        const releaseView = h.hold('/views?'); const stale = h.views.refresh(); await h.wait();
        await h.command('p0', 'status', 'done'); releaseView(); await stale; await h.wait();
        assert.equal(h.views.getState().response.tasks.find(t => t.id === 'p0').revision, 2);
        assert.equal(h.doc.querySelector('[data-task-open="p0"]').dataset.taskRevision, '2');
    } finally { h.dispose(); }
});
test('query role downgrade reconciles board authority; disposed handlers cannot issue commands', async () => {
    const h = await fixture(); try {
        h.views.setView('kanban'); await h.wait(); await h.views.openTask('p0');
        h.role = 'Viewer'; await h.views.refresh(); await h.wait();
        assert.equal(h.board.getState().membership.role, 'Viewer');
        assert.ok(h.doc.querySelector('[data-task-status="p0"]').disabled);
        h.views.dispose(); const calls = h.calls.length;
        h.doc.querySelector('#projects-view-tabs [data-view="calendar"]').click(); await h.wait();
        assert.equal(h.calls.length, calls);
    } finally { h.dispose(); }
});
test('missing project deep link closes detail and preserves unrelated CRM routing', async () => {
    const h = await fixture(); try {
        await h.views.openTask('p0');
        h.win.history.pushState(null, '', '?keep=yes&pjProject=gone&pjTask=secret&pjView=kanban#projects');
        await h.views.restoreNavigation();
        assert.equal(h.board.getState().selectedTaskId, '');
        assert.equal(new URL(h.win.location.href).searchParams.get('pjTask'), null);
        assert.equal(new URL(h.win.location.href).searchParams.get('keep'), 'yes');
        assert.equal(h.calls.some(c => c.url.includes('/projects/gone')), false);
    } finally { h.dispose(); }
});
test('filtered List reconciles membership after a save while retaining an authorized detail draft', async () => {
    const h = await fixture(); try {
        await h.views.applyFilters({ status: 'not_started' }); await h.views.openTask('p0');
        const notes = h.doc.querySelector('#projects-board-detail-body input[data-column-id="notes"]');
        notes.value = 'Giữ bản nháp'; notes.dispatchEvent(new h.win.Event('input', { bubbles: true }));
        await h.command('p0', 'status', 'done'); await h.wait(); await h.wait();
        assert.equal(h.board.getState().selectedTaskId, 'p0');
        assert.equal(h.doc.querySelector('#projects-board-rows [data-task-id="p0"]'), null);
        assert.equal(h.doc.querySelector('#projects-board-detail-body input[data-column-id="notes"]').value, 'Giữ bản nháp');
        h.views.setView('kanban'); await h.wait();
        assert.equal(h.doc.querySelector('[data-task-open="p0"]'), null);
    } finally { h.dispose(); }
});
test('history restoration across Calendar boundaries refetches the proper query without leaking month filters', async () => {
    const h = await fixture(); try {
        h.views.setView('calendar'); await h.wait();
        h.win.history.pushState(null, '', '?keep=yes&pjProject=p&pjView=kanban#projects'); await h.views.restoreNavigation(); await h.wait();
        const query = h.calls.filter(c => c.url.includes('/views?')).at(-1);
        assert.equal(JSON.parse(new URL(query.url, h.win.location).searchParams.get('filters')).fromDate, undefined);
        assert.equal(h.views.getState().view, 'kanban');
        h.win.history.pushState(null, '', '?keep=yes&pjProject=p&pjView=calendar&pjMonth=2026-10#projects'); await h.views.restoreNavigation(); await h.wait();
        const monthQuery = h.calls.filter(c => c.url.includes('/views?')).at(-1);
        assert.equal(JSON.parse(new URL(monthQuery.url, h.win.location).searchParams.get('filters')).fromDate, '2026-10-01');
        assert.equal(h.views.getState().filters.fromDate, undefined);
    } finally { h.dispose(); }
});
test('title, people, custom values and date changes invalidate only the active read projection', async () => {
    const h = await fixture(); try {
        for (const [view, field, control] of [
            ['kanban', 'title', { value: 'Tên mới — tiếng Việt' }],
            ['gantt', 'ownerUid', { value: '' }],
            ['charts', 'value', { value: 'Ghi chú mới', dataset: { columnId: 'notes' } }],
            ['calendar', 'dates', { value: { startDate: null, dueDate: null }, dataset: {} }]
        ]) {
            h.views.setView(view); await h.wait();
            const before = h.calls.filter(c => c.url.includes('/views?')).length;
            const oldRevision = h.tasks[0].revision;
            await h.board.saveTaskField('p0', field, control); await h.wait();
            assert.equal(h.calls.filter(c => c.url.includes('/views?')).length, before + 1, `${view} bounded refetch`);
            assert.equal(h.views.getState().response.tasks.find(t => t.id === 'p0').revision, oldRevision + 1);
        }
        assert.equal(h.views.getState().response.tasks.find(t => t.id === 'p0').dueDate, null);
    } finally { h.dispose(); }
});
test('archived task resolution clears an open detail without treating it as an empty authorized result', async () => {
    const h = await fixture(); try {
        await h.views.openTask('p0'); h.tasks[0].lifecycle = 'archived';
        await assert.rejects(h.board.resolveTask('p0'), /unavailable|no longer available/);
        assert.equal(h.board.getState().selectedTaskId, '');
        assert.equal(h.elements.projectsBoardDetail.open, false);
    } finally { h.dispose(); }
});
test('project navigation Back restores the prior task; direct List selection wins over a delayed route', async () => {
    const h = await fixture(); try {
        await h.views.openTask('p0'); await h.select('q'); await h.wait();
        h.win.history.back(); await h.wait(); await h.wait();
        assert.equal(h.board.getState().project.id, 'p'); assert.equal(h.board.getState().selectedTaskId, 'p0');
        const release = h.hold('/tasks/p1');
        h.win.history.pushState(null, '', '?pjProject=p&pjView=board&pjTask=p1#projects');
        const stale = h.views.restoreNavigation(); await h.wait();
        h.board.selectTask(h.board.getState().tasks.get('p2')); release(); await stale;
        assert.equal(h.board.getState().selectedTaskId, 'p2');
        assert.equal(new URL(h.win.location.href).searchParams.get('pjTask'), 'p2');
    } finally { h.dispose(); }
});
test('closing the detail cancels an in-flight same-task history restoration', async () => {
    const h = await fixture(); try {
        await h.views.openTask('p0'); const release = h.hold('/tasks/p0');
        const pending = h.views.restoreNavigation(); await h.wait();
        h.board.closeTask(); release(); await pending; await h.wait();
        assert.equal(h.board.getState().selectedTaskId, '');
        assert.equal(h.elements.projectsBoardDetail.open, false);
        assert.equal(new URL(h.win.location.href).searchParams.get('pjTask'), null);
    } finally { h.dispose(); }
});
test('a delayed save from the previous project cannot block or overwrite the active project projection', async () => {
    const h = await fixture(); try {
        const release = h.hold('/tasks/p0', 'PATCH'); const stale = h.command('p0', 'status', 'done').catch(() => null); await h.wait();
        await h.select('q'); await h.wait();
        assert.equal(h.board.getState().mutationPending, false);
        h.views.setView('kanban'); await h.wait(); await h.command('q0', 'status', 'blocked'); await h.wait();
        assert.equal(h.views.getState().response.tasks.find(t => t.id === 'q0').revision, 2);
        release(); await stale; await h.wait();
        assert.equal(h.views.getState().projectId, 'q');
        assert.equal(h.board.getState().tasks.has('p0'), false);
    } finally { h.dispose(); }
});

for (const lifecycle of ['missing', 'archived']) {
    test(`canonical ${lifecycle} reconciliation removes rows, descendants, selection and restores stable focus`, async () => {
        const h = await fixture(); try {
            h.doc.querySelector('[data-task-id="p0"] [data-action="toggle-task"]').click(); await h.wait();
            h.board.setSelectedTaskIds(['p0', 'p4', 'p2']);
            const row = h.doc.querySelector('#projects-board-rows [data-task-id="p0"]'); row.focus();
            if (lifecycle === 'missing') h.tasks = h.tasks.filter(t => t.id !== 'p0');
            else h.tasks[0].lifecycle = 'archived';
            await assert.rejects(h.board.resolveTask('p0'));
            for (const id of ['p0', 'p4']) {
                assert.equal(h.board.getState().tasks.has(id), false);
                assert.equal(h.doc.querySelector(`#projects-board-rows [data-task-id="${id}"]`), null);
            }
            assert.deepEqual([...h.board.getState().selectedTaskIds], ['p2']);
            assert.equal(h.doc.activeElement.dataset.taskId, 'p1');
            assert.match(h.elements.projectsBoardStatus.textContent, /unavailable/i);
        } finally { h.dispose(); }
    });
}
test('missing deep-link target disappears immediately from active Table without another render', async () => {
    const h = await fixture(); try {
        h.tasks = h.tasks.filter(t => t.id !== 'p0');
        h.win.history.pushState(null, '', '?pjProject=p&pjView=board&pjTask=p0#projects');
        await h.views.restoreNavigation();
        assert.equal(h.doc.querySelector('#projects-board-rows [data-task-id="p0"]'), null);
        assert.equal(h.doc.querySelector('#projects-view-summary').textContent, '', 'discard stale totals with the vanished task projection');
        assert.equal(h.board.getState().selectedTaskId, '');
    } finally { h.dispose(); }
});
test('disappearance removes inactive projections but preserves an unrelated authorized detail draft', async () => {
    const h = await fixture(); try {
        h.views.setView('kanban'); await h.wait(); await h.views.openTask('p1');
        const input = h.doc.querySelector('#projects-board-detail-body input[data-column-id="notes"]');
        input.value = 'Unrelated draft'; input.dispatchEvent(new h.win.Event('input', { bubbles: true }));
        input.focus(); input.setSelectionRange(3, 7);
        h.tasks = h.tasks.filter(t => t.id !== 'p0');
        await h.views.openTask('p0');
        assert.equal(h.board.getState().selectedTaskId, 'p1');
        assert.equal(h.doc.querySelector('#projects-board-detail-body input[data-column-id="notes"]'), input);
        assert.equal(input.value, 'Unrelated draft'); assert.equal(input.selectionStart, 3);
        assert.equal(h.doc.activeElement, input);
        assert.equal(h.doc.querySelector('[data-task-open="p0"]'), null);
        h.views.setView('board'); await h.wait();
        assert.equal(h.doc.querySelector('#projects-board-rows [data-task-id="p0"]'), null);
    } finally { h.dispose(); }
});
test('newer active projection refreshes Table once on activation without admitting an unloaded child', async () => {
    const h = await fixture(); try {
        h.views.setView('kanban'); await h.wait();
        const reads = () => h.calls.filter(c => c.url.includes('/tasks?')).length;
        const before = reads();
        Object.assign(h.tasks[0], { revision: 2, status: 'done', title: 'Remote revision two' });
        h.tasks[4].revision = 2;
        await h.views.refresh();
        assert.equal(reads(), before, 'hidden Table is not fetched');
        const release = h.hold('/tasks?');
        h.views.setView('board'); await h.wait();
        assert.equal(h.doc.querySelector('#projects-board-table-wrap').hidden, true, 'old revision cannot be presented during read');
        h.views.setView('board'); assert.equal(reads(), before + 1, 'one activation read');
        release(); await h.wait();
        assert.equal(h.board.getState().tasks.get('p0').revision, 2);
        assert.match(h.doc.querySelector('#projects-board-rows [data-task-id="p0"]').textContent, /Remote revision two/);
        assert.equal(h.board.getState().tasks.has('p4'), false);
        assert.equal(h.doc.querySelector('#projects-board-table-wrap').hidden, false);
        assert.equal(reads(), before + 1);
    } finally { h.dispose(); }
});

async function hideDirtyTitleForRefresh(h) {
    const row = h.doc.querySelector('#projects-board-rows [data-task-id="p0"]');
    row.focus();
    row.dispatchEvent(new h.win.KeyboardEvent('keydown', { key: 'F2', bubbles: true }));
    const input = row.querySelector('input[data-field-kind="title"]');
    input.value = 'Local dirty draft'; input.dispatchEvent(new h.win.Event('input', { bubbles: true }));
    input.focus(); input.setSelectionRange(5, 5);
    h.elements.projectsBoardScroll.scrollTop = 44;
    h.elements.projectsBoardScroll.scrollLeft = 71;
    // jsdom does not implement display:none focus loss. Model that browser
    // boundary only; no test code restores focus. Chrome verifies it natively.
    const table = h.doc.getElementById('projects-board-table-wrap');
    const hidden = Object.getOwnPropertyDescriptor(h.win.HTMLElement.prototype, 'hidden');
    Object.defineProperty(table, 'hidden', {
        get() { return hidden.get.call(this); },
        set(value) { hidden.set.call(this, value); if (value && this.contains(h.doc.activeElement)) h.doc.activeElement.blur(); }
    });
    Object.assign(h.tasks[0], { revision: 2, title: 'Remote title' });
    const release = h.hold('/tasks?'); // Hold the automatic reconciliation before the view response.
    await h.views.refresh();
    assert.equal(table.hidden, true, 'newer projection must hide the old canonical table');
    assert.equal(h.doc.activeElement, h.doc.body);
    h.views.setView('board'); await h.wait();
    assert.equal(table.hidden, true, 'table remains fenced during canonical load');
    return { input, table, release };
}

test('stale Table refresh retains the same dirty title control, selection, scroll and draft revision', async () => {
    const h = await fixture(); try {
        const { input, table, release } = await hideDirtyTitleForRefresh(h);
        release(); await h.wait();
        assert.equal(table.hidden, false);
        assert.equal(h.board.getState().tasks.get('p0').title, 'Remote title');
        assert.equal(h.doc.querySelector('#projects-board-rows [data-task-id="p0"] input[data-field-kind="title"]'), input);
        assert.equal(h.doc.activeElement, input);
        assert.equal(input.value, 'Local dirty draft');
        assert.equal(input.selectionStart, 5); assert.equal(input.selectionEnd, 5);
        assert.equal(h.elements.projectsBoardScroll.scrollTop, 44);
        assert.equal(h.elements.projectsBoardScroll.scrollLeft, 71);
        assert.equal(h.calls.filter(c => c.method === 'PATCH').length, 0, 'hiding cannot implicitly save');
        await h.board.saveTaskField('p0', 'title', input);
        assert.equal(h.calls.filter(c => c.method === 'PATCH').at(-1).body.expectedRevision, 1, 'refresh cannot rebase the draft');
    } finally { h.dispose(); }
});

for (const change of ['focus', 'pointer', 'view', 'project', 'filters', 'denied', 'downgrade']) {
    test(`stale Table editor restoration yields to ${change}`, async () => {
        const h = await fixture(); try {
            const { input, release } = await hideDirtyTitleForRefresh(h);
            if (change === 'focus') h.doc.getElementById('projects-view-retry').focus();
            if (change === 'pointer') h.doc.body.dispatchEvent(new h.win.Event('pointerdown', { bubbles: true }));
            if (change === 'view') h.views.setView('kanban');
            if (change === 'project') await h.select('q');
            if (change === 'filters') { h.views.applyFilters({ title: 'Công việc 1' }); }
            if (change === 'denied') h.views.invalidateAccess('p');
            if (change === 'downgrade') h.role = 'Viewer';
            release(); await h.wait();
            if (change === 'downgrade') { await h.board.refresh(); await h.wait(); }
            assert.notEqual(h.doc.activeElement, input);
            assert.equal(h.calls.filter(c => c.method === 'PATCH').length, 0);
            if (['denied', 'downgrade', 'project', 'filters'].includes(change)) assert.equal(input.isConnected, false);
        } finally { h.dispose(); }
    });
}
test('newer projection rechecks filtered and moved branch membership and preserves draft base revision', async () => {
    const h = await fixture(); try {
        await h.views.applyFilters({ status: 'not_started' }); await h.views.openTask('p0');
        const input = h.doc.querySelector('#projects-board-detail-body input[data-column-id="notes"]');
        input.value = 'Keep base one'; input.dispatchEvent(new h.win.Event('input', { bubbles: true }));
        h.views.setView('kanban'); await h.wait();
        Object.assign(h.tasks[0], { revision: 2, title: 'New filtered title', parentTaskId: 'p2', pathIds: ['p2'] });
        await h.views.refresh(); h.views.setView('board'); await h.wait();
        assert.equal(h.doc.querySelector('#projects-board-rows [data-task-id="p0"]'), null, 'moved task is not a root member');
        const retained = h.doc.querySelector('#projects-board-detail-body input[data-column-id="notes"]');
        assert.equal(retained.value, 'Keep base one');
        await h.board.saveTaskField('p0', 'value', retained);
        const write = h.calls.filter(c => c.method === 'PATCH').at(-1);
        assert.equal(write.body.expectedRevision, 1, 'remote refresh must not rebase draft');
    } finally { h.dispose(); }
});
test('newer projection does not overwrite a pending optimistic edit and activation waits for its queue', async () => {
    const h = await fixture(); try {
        await h.views.openTask('p0'); h.views.setView('kanban'); await h.wait();
        const release = h.hold('/tasks/p0', 'PATCH');
        const saving = h.board.saveTaskField('p0', 'title', { value: 'Optimistic title', dataset: {} }); await h.wait();
        Object.assign(h.tasks[0], { revision: 3, title: 'Remote title after save' });
        await h.views.refresh();
        assert.equal(h.board.getState().tasks.get('p0').title, 'Optimistic title');
        h.views.setView('board'); await h.wait();
        assert.equal(h.board.getState().mutationPending, true);
        assert.equal(h.doc.querySelector('#projects-board-table-wrap').hidden, true);
        release(); await saving; await h.wait(); await h.wait();
        assert.equal(h.board.getState().tasks.get('p0').revision, 3);
        assert.equal(h.doc.querySelector('#projects-board-table-wrap').hidden, false);
    } finally { h.dispose(); }
});

test('disappearance closes an affected row picker and moves its focus to a surviving row', async () => {
    const h = await fixture(); try {
        h.doc.querySelector('#projects-board-rows [data-task-id="p0"] [data-action="pick-status"]').click();
        const picker = h.doc.querySelector('.crm-status-popover');
        assert.ok(picker); picker.querySelector('button').focus();
        h.tasks = h.tasks.filter(t => t.id !== 'p0');
        await assert.rejects(h.board.resolveTask('p0'));
        assert.equal(picker.isConnected, false);
        assert.equal(h.doc.activeElement.dataset.taskId, 'p1');
    } finally { h.dispose(); }
});
test('failed Table reconciliation stays hidden and retries only on explicit activation', async () => {
    const h = await fixture(); try {
        h.views.setView('kanban'); await h.wait(); h.tasks[0].revision = 2;
        await h.views.refresh(); h.failures.push({ match: '/tasks?', status: 500 });
        const reads = () => h.calls.filter(c => c.url.includes('/tasks?')).length;
        const before = reads(); h.views.setView('board'); await h.wait(); await h.wait();
        assert.equal(reads(), before + 1); assert.equal(h.doc.querySelector('#projects-board-table-wrap').hidden, true);
        assert.match(h.doc.querySelector('#projects-view-status').textContent, /retry/);
        h.views.setView('board'); await h.wait();
        assert.equal(reads(), before + 2); assert.equal(h.board.getState().tasks.get('p0').revision, 2);
        assert.equal(h.doc.querySelector('#projects-board-table-wrap').hidden, false);
    } finally { h.dispose(); }
});
test('delayed Table reconciliation cannot publish across project or actor changes', async () => {
    const h = await fixture(); try {
        h.views.setView('kanban'); await h.wait(); h.tasks[0].revision = 2; await h.views.refresh();
        const release = h.hold('/tasks?'); h.views.setView('board'); await h.wait();
        await h.select('q'); await h.wait(); release(); await h.wait();
        assert.equal(h.board.getState().project.id, 'q'); assert.equal(h.board.getState().tasks.has('p0'), false);
        assert.equal(h.doc.querySelector('#projects-board-table-wrap').hidden, false);
        h.views.setView('kanban'); await h.wait(); h.tasks.find(t => t.id === 'q0').revision = 2; await h.views.refresh();
        const releaseActor = h.hold('/tasks?'); h.views.setView('board'); await h.wait();
        h.actor = 'b'; releaseActor(); await h.wait();
        assert.equal(h.board.getState().tasks.has('q0'), false);
        assert.equal(h.doc.querySelector('#projects-board-rows [data-task-id="q0"]'), null);
    } finally { h.dispose(); }
});

test('an unloaded-only newer projection does not read or add a hidden List branch', async () => {
    const h = await fixture(); try {
        h.views.setView('kanban'); await h.wait(); h.tasks[4].revision = 2;
        const before = h.calls.filter(c => c.url.includes('/tasks?')).length;
        await h.views.refresh(); h.views.setView('board'); await h.wait();
        assert.equal(h.board.getState().tasks.has('p4'), false);
        assert.equal(h.calls.filter(c => c.url.includes('/tasks?')).length, before);
        h.doc.querySelector('[data-task-id="p0"] [data-action="toggle-task"]').click(); await h.wait();
        assert.equal(h.board.getState().tasks.get('p4').revision, 2);
        assert.equal(h.calls.filter(c => c.url.includes('/tasks?')).length, before + 1);
    } finally { h.dispose(); }
});
test('a read older than the observed revision cannot unhide Table', async () => {
    const h = await fixture(); try {
        h.views.setView('kanban'); await h.wait(); h.tasks[0].revision = 3; await h.views.refresh();
        h.tasks[0].revision = 2; h.views.setView('board'); await h.wait();
        assert.equal(h.doc.querySelector('#projects-board-table-wrap').hidden, true);
        assert.match(h.doc.querySelector('#projects-view-status').textContent, /retry/);
        h.tasks[0].revision = 3; h.views.setView('board'); await h.wait();
        assert.equal(h.doc.querySelector('#projects-board-table-wrap').hidden, false);
    } finally { h.dispose(); }
});

test('returning project never compares its projection with a same-ID task from the previous project', async () => {
    const h = await fixture(); try {
        await h.select('q'); await h.wait();
        const foreign = h.tasks.find(t => t.id === 'q0');
        foreign.id = 'p0'; await h.board.refresh();
        h.tasks.find(t => t.projectId === 'p' && t.id === 'p0').revision = 3;
        // Views can receive the new selection before the observer admits Board's load.
        h.views.setProject('p'); await h.wait();
        assert.equal(h.board.getState().project.id, 'q');
        assert.equal(h.doc.querySelector('#projects-board-table-wrap').hidden, true, 'previous project stays fenced');
        const release = h.hold('/projects/p/tasks?');
        await h.select('p'); await h.wait();
        assert.equal(h.doc.querySelector('#projects-board-table-wrap').hidden, true, 'returned project waits for canonical authority');
        release(); await h.wait(); await h.wait();
        assert.equal(h.board.getState().project.id, 'p');
        assert.equal(h.board.getState().authorizationReady, true);
        assert.equal(h.board.getState().tasks.get('p0').revision, 3);
        assert.equal(h.doc.querySelector('#projects-board-table-wrap').hidden, false);
    } finally { h.dispose(); }
});

test('a newer projection received while Table is active reconciles without another tab click', async () => {
    const h = await fixture(); try {
        h.tasks[0].revision = 3;
        const release = h.hold('/tasks?');
        await h.views.refresh(); await h.wait();
        assert.equal(h.doc.querySelector('#projects-board-table-wrap').hidden, true);
        release(); await h.wait(); await h.wait();
        assert.equal(h.board.getState().tasks.get('p0').revision, 3);
        assert.equal(h.board.getState().authorizationReady, true);
        assert.equal(h.doc.querySelector('#projects-board-table-wrap').hidden, false);
    } finally { h.dispose(); }
});

test('returning Table retains its observed revision floor until the current project catches up', async () => {
    const h = await fixture(); try {
        await h.select('q'); await h.wait();
        h.tasks.find(t => t.id === 'q0').id = 'p0'; await h.board.refresh();
        const own = h.tasks.find(t => t.projectId === 'p' && t.id === 'p0');
        own.revision = 3; h.views.setProject('p'); await h.wait();
        own.revision = 2; await h.select('p'); await h.wait(); await h.wait();
        assert.equal(h.board.getState().project.id, 'p');
        assert.equal(h.board.getState().tasks.get('p0').revision, 2);
        assert.equal(h.doc.querySelector('#projects-board-table-wrap').hidden, true, 'settled authority cannot expose a projection behind the returned project view');
        own.revision = 3; h.views.setView('board'); await h.wait();
        assert.equal(h.board.getState().tasks.get('p0').revision, 3);
        assert.equal(h.doc.querySelector('#projects-board-table-wrap').hidden, false);
    } finally { h.dispose(); }
});

for (const presentationV2 of [false, true]) test(`overlapping project refreshes isolate every publication (v2=${presentationV2})`, async () => {
    const h = await fixture(undefined, presentationV2);
    const releases = [];
    const publications = [];
    const unsubscribe = h.board.subscribeContext(snapshot => {
        if (snapshot.project) publications.push({ projectId: snapshot.project.id, tasks: [...snapshot.tasks.values()] });
    });
    try {
        const own = h.tasks.find(t => t.projectId === 'p' && t.id === 'p0');
        const foreign = h.tasks.find(t => t.projectId === 'q' && t.id === 'q0');
        foreign.id = 'p0'; foreign.title = 'Project B only';
        own.revision = 2; await h.board.refresh(); await h.wait();
        const releaseA = h.hold('/projects/p'); releases.push(releaseA);
        const refreshA = h.board.refresh(); await h.wait();
        h.board.getState(); // A consumer can cache the held A snapshot before selection changes.
        const releaseInitialB = h.hold('/projects/q/tasks?'); releases.push(releaseInitialB);
        await h.select('q'); await h.wait();
        releaseInitialB(); await h.wait(); await h.wait();
        assert.deepEqual(publications.filter(snapshot => snapshot.tasks.some(task => task.projectId !== snapshot.projectId)), [], 'every publication must bind its task map to its project, including intermediate authority fences');
        assert.equal(h.board.getState().authorizationReady, true);
        assert.equal(h.board.getState().tasks.get('p0').title, 'Project B only');
        assert.equal(h.doc.querySelector('#projects-board-table-wrap').hidden, false);

        foreign.revision = 3;
        const releaseB = h.hold('/projects/q/tasks?'); releases.push(releaseB);
        await h.views.refresh(); await h.wait();
        const overlappingB = h.board.refresh(); await h.wait();
        releaseB(); await overlappingB; await h.wait(); await h.wait();
        assert.equal(h.board.getState().authorizationReady, true);
        assert.equal(h.doc.querySelector('#projects-board-table-wrap').hidden, false, 'a completed older refresh must not latch the retry state over the final publication');
        assert.equal(h.board.getState().tasks.get('p0').revision, 3);

        own.revision = 4; h.views.setProject('p'); await h.wait();
        own.revision = 2;
        const releaseReturn = h.hold('/projects/p/tasks?'); releases.push(releaseReturn);
        await h.select('p'); await h.wait();
        assert.equal(h.doc.querySelector('#projects-board-table-wrap').hidden, true);
        releaseA(); await refreshA; await h.wait();
        assert.equal(h.doc.querySelector('#projects-board-table-wrap').hidden, true, 'old A generation cannot release the returned A fence');
        releaseReturn(); await h.wait(); await h.wait();
        assert.equal(h.doc.querySelector('#projects-board-table-wrap').hidden, true, 'return floor survives stale canonical publication');
        own.revision = 4; h.views.setView('board'); await h.wait();
        assert.equal(h.doc.querySelector('#projects-board-table-wrap').hidden, false);
    } finally { unsubscribe(); releases.forEach(release => release()); h.dispose(); }
});

test('Kanban resolves arbitrary priority IDs, labels multiple fields, and separates section from ancestry',async()=>{
 const h=await fixture();try {
  h.views.setView('kanban');await h.wait();
  const card=id=>h.doc.querySelector(`[data-kanban-task="${id}"]`);
  assert.equal(card('p0').querySelector('[data-priority-column="priority-custom-123"]').textContent,'High');
  assert.equal(card('p0').querySelector('.crm-projects-kanban-sec').textContent,'Công việc');
  assert.equal(card('p0').querySelector('.crm-projects-kanban-ancestors'),null);
  assert.equal(card('p4').querySelector('.crm-projects-kanban-sec').textContent,'Công việc');
  assert.equal(card('p4').querySelector('.crm-projects-kanban-ancestors').textContent,'Parent context');
  h.columns.push({id:'risk',type:'priority',label:'Risk <b>'});h.tasks[0].values.risk='low';h.tasks[0].values.priority='urgent';await h.views.refresh();await h.wait();
  assert.equal(card('p0').querySelector('[data-priority-column="priority-custom-123"]').textContent,'Priority: High');
  assert.equal(card('p0').querySelector('[data-priority-column="risk"]').textContent,'Risk <b>: Low');assert.equal(card('p0').querySelector('b'),null);
  const before=JSON.stringify(h.tasks[0].values);const status=card('p0').querySelector('[data-task-status]');status.value='done';status.dispatchEvent(new h.win.Event('change',{bubbles:true}));await h.wait();
  const write=h.calls.find(c=>c.method==='PATCH');assert.deepEqual(Object.keys(write.body).sort(),['expectedRevision','operationId','status']);assert.equal(JSON.stringify(h.tasks[0].values),before);assert.equal(h.tasks[0].sectionId,'s');
  h.views.setView('board');await h.wait();assert.equal(h.doc.querySelector('[data-task-id="p0"] [data-column-key="custom:priority-custom-123"] select').value,'high');
 }finally{h.dispose();}
});

test('project selection hydrates one snapshot after canonical authority without a reset refresh', async () => {
    const h = await fixture(); try {
        for (const id of ['p', 'q']) {
            if (id === 'q') { h.calls.length = 0; await h.select(id); await h.wait(); }
            assert.equal(h.views.getState().response?.project?.id, id);
            assert.equal(h.doc.getElementById('projects-view-status').textContent, '');
            assert.equal(h.calls.filter(c => c.url.startsWith(`/api/projects/${id}/tasks?`)).length, 1);
            assert.equal(h.calls.filter(c => c.url.startsWith(`/api/projects/${id}/views?`)).length, 1);
        }
        h.calls.length = 0;
        await h.views.applyFilters({ status: 'done' }); await h.wait();
        assert.equal(h.calls.filter(c => c.url.includes('/tasks?')).length, 1);
        assert.equal(h.calls.filter(c => c.url.includes('/views?')).length, 0);
        assert.equal(h.board.getState().tasks.size, 1);
    } finally { h.dispose(); }
});

for (const presentationV2 of [false, true]) test(`initial snapshot recovers after another canonical publication (v2=${presentationV2})`, async () => {
    const h = await fixture(undefined, presentationV2);
    let release;
    try {
        release = h.hold('/projects/q/views?');
        await h.select('q'); await h.wait();
        await h.board.refresh(); await h.wait();
        release(); await h.wait(); await h.wait();
        assert.equal(h.views.getState().response?.project?.id, 'q');
        assert.equal(h.doc.getElementById('projects-view-status').textContent, '');
        assert.equal(h.board.getState().authorizationReady, true);
    } finally { release?.(); h.dispose(); }
});
