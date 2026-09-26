'use strict';
// Side tabs keep a clear way back to the selected project; archive and trash
// confirm through the existing recovery preview; loading messages show a spinner.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require(process.env.CRM_TEST_JSDOM || 'jsdom');
const root = path.resolve(__dirname, '../../..');
const tick = async () => { for (let i = 0; i < 10; i++) await new Promise(setImmediate); };

function fixture({ preview = { allowed: true, expectedRevision: 3, expectedStructureRevision: 4, expectedAncestorRevisions: {}, affected: [{}, {}] }, fail = null } = {}) {
    const dom = new JSDOM(fs.readFileSync(path.join(root, 'public/crm-admin.html'), 'utf8'), { runScripts: 'outside-only', url: 'https://fixture.invalid' });
    const win = dom.window, document = win.document;
    if (typeof win.HTMLDialogElement.prototype.showModal !== 'function') {
        win.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
        win.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new win.Event('close')); };
    }
    for (const name of ['workspace', 'presentation/shell']) win.eval(fs.readFileSync(path.join(root, `public/js/crm/projects/${name}.js`), 'utf8'));
    const panel = document.querySelector('[data-panel="projects"]');
    const calls = { api: [], selected: [], lifecycle: [], toasts: [] };
    const base = { document, panel, getCurrentUser: () => ({ uid: 'actor' }) };
    const shell = win.CrmProjectsShellV2.createController(base);
    const workspace = win.CrmProjectsWorkspace.createController({
        ...base, presentationV2: true,
        selectProject: id => calls.selected.push(id),
        showBoard: () => shell.showBoard(),
        showToast: (message, type) => calls.toasts.push([message, type]),
        onProjectLifecycleChanged: (id, action) => calls.lifecycle.push([id, action]),
        apiFetchJson: async (url, options) => {
            calls.api.push({ url, method: options?.method || 'GET', body: options?.body ? JSON.parse(options.body) : null });
            if (fail && options?.method === 'POST') throw Object.assign(Error(fail), { status: 409 });
            return options?.method === 'POST' ? { ok: true } : preview;
        }
    });
    shell.init(); workspace.init();
    const selection = { selectedProjectId: 'p', selectedProject: { id: 'p', name: 'Alpha', role: 'Owner' }, projects: [{ id: 'p', name: 'Alpha', role: 'Owner' }, { id: 'q', name: 'Beta', role: 'Owner' }, { id: 'r', name: 'Gamma', role: 'Viewer' }] };
    shell.setSelection(selection); workspace.setSelection(selection);
    const $ = selector => document.querySelector(selector);
    return { dom, win, document, panel, shell, workspace, calls, $, close: () => { workspace.dispose(); shell.dispose(); win.close(); } };
}

test('side tabs show a named way back, the page title and direct view shortcuts', async () => {
    const h = fixture();
    try {
        const board = h.$('#projects-board-section'), page = h.$('#projects-utility-page');
        assert.ok(!h.$('#projects-workspace-rail').textContent.includes('Project views'), 'the old rail link is gone');
        h.$('[data-u="notifications"]').click();
        assert.equal(board.hidden, true); assert.equal(page.hidden, false);
        assert.match(h.$('#projects-v2-table').textContent, /Back to Alpha/);
        assert.equal(h.$('.crm-projects-utility-title').textContent, 'Inbox');
        assert.equal(h.panel.dataset.projectsUtility, 'notifications');
        h.$('#projects-v2-table').click();
        assert.equal(board.hidden, false); assert.equal(page.hidden, true); assert.equal(h.panel.dataset.projectsUtility, '');
        h.$('[data-u="recovery"]').click();
        assert.equal(h.$('.crm-projects-utility-title').textContent, 'Archive & trash');
        let opened = '';
        h.$('#projects-view-tabs [data-view="kanban"]').addEventListener('click', () => { opened = 'kanban'; });
        h.$('[data-open-view="kanban"]').click();
        assert.equal(board.hidden, false); assert.equal(opened, 'kanban', 'the shortcut opens that view of the project');
    } finally { h.close(); }
});

test('clicking the current project in the sidebar returns to its board; another project is selected', () => {
    const h = fixture();
    try {
        h.$('[data-u="notifications"]').click();
        h.$('[data-workspace-project="p"]').click();
        assert.equal(h.$('#projects-board-section').hidden, false);
        assert.deepEqual(h.calls.selected, []);
        h.$('[data-workspace-project="q"]').click();
        assert.deepEqual(h.calls.selected, ['q']);
    } finally { h.close(); }
});

test('the red header trash confirms through the recovery preview before moving the project to trash', async () => {
    const h = fixture();
    try {
        const trash = h.$('#projects-v2-trash');
        assert.ok(trash && !trash.disabled, 'Owners see an enabled header trash button');
        trash.click(); await tick();
        const dialog = h.$('#projects-lifecycle-dialog');
        assert.equal(dialog.open, true);
        assert.match(dialog.querySelector('h3').textContent, /Move "Alpha" to trash\?/);
        assert.equal(h.calls.api[0].url, '/api/projects/p/recovery/preview?targetType=project&targetId=p&action=trash&restoreChain=false');
        const confirm = dialog.querySelector('[data-lifecycle-confirm]');
        assert.equal(confirm.disabled, false);
        confirm.click(); await tick();
        const post = h.calls.api.find(call => call.method === 'POST');
        assert.equal(post.url, '/api/projects/p/trash');
        assert.equal(post.body.expectedRevision, 3); assert.equal(post.body.expectedStructureRevision, 4); assert.match(post.body.operationId, /^crm-project-trash-/);
        assert.equal(dialog.open, false);
        assert.deepEqual(h.calls.lifecycle, [['p', 'trash']]);
        assert.match(h.calls.toasts[0][0], /moved to trash/);
    } finally { h.close(); }
});

test('sidebar trash icons appear for Owner projects only; a refused preview cannot be confirmed', async () => {
    const h = fixture({ preview: { allowed: false, reason: 'This action requires the project Owner.' } });
    try {
        assert.ok(h.$('[data-workspace-trash="q"]'));
        assert.equal(h.$('[data-workspace-trash="r"]'), null, 'no trash icon for a Viewer project');
        h.$('[data-workspace-trash="q"]').click(); await tick();
        const dialog = h.$('#projects-lifecycle-dialog');
        assert.match(dialog.querySelector('h3').textContent, /Beta/);
        assert.match(dialog.textContent, /requires the project Owner/);
        dialog.querySelector('[data-lifecycle-confirm]').click(); await tick();
        assert.equal(h.calls.api.filter(call => call.method === 'POST').length, 0);
        assert.deepEqual(h.calls.selected, [], 'the trash icon does not open the project');
    } finally { h.close(); }
});

test('archive is offered in the project menu and a failed save keeps the dialog open with the reason', async () => {
    const h = fixture({ fail: 'Project changed; refresh.' });
    try {
        const archive = h.$('.crm-projects-view-options-popover #projects-v2-archive');
        assert.ok(archive && !archive.disabled);
        archive.click(); await tick();
        const dialog = h.$('#projects-lifecycle-dialog');
        assert.match(dialog.querySelector('h3').textContent, /Archive "Alpha"\?/);
        dialog.querySelector('[data-lifecycle-confirm]').click(); await tick();
        assert.equal(h.calls.api.find(call => call.method === 'POST').url, '/api/projects/p/archive');
        assert.equal(dialog.open, true);
        assert.match(dialog.textContent, /Project changed; refresh\./);
        assert.deepEqual(h.calls.lifecycle, []);
    } finally { h.close(); }
});

test('loading and updating messages show a spinner that clears when loaded', async () => {
    const h = fixture();
    try {
        const status = h.$('#projects-board-status');
        status.textContent = 'Loading project board…'; await tick();
        assert.equal(status.classList.contains('crm-projects-is-loading'), true);
        status.textContent = ''; await tick();
        assert.equal(status.classList.contains('crm-projects-is-loading'), false);
        const content = h.$('#projects-view-content');
        content.innerHTML = '<p class="crm-muted" role="status">Loading tasks…</p>'; await tick();
        assert.equal(content.querySelector('[role="status"]').classList.contains('crm-projects-is-loading'), true);
        assert.ok(h.$('#projects-board-initial-loading .crm-projects-spinner'), 'the board placeholder has a spinner');
    } finally { h.close(); }
});
