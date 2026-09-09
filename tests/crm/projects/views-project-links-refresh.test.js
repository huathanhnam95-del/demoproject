'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require(process.env.CRM_TEST_JSDOM || 'jsdom');
const source = fs.readFileSync(path.resolve(__dirname, '../../../public/js/crm/projects/views.js'), 'utf8');
const flush = async () => { for (let i = 0; i < 4; i++) await new Promise(setImmediate); };
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function harness() {
    const dom = new JSDOM('<div id="projects-project-links"></div><div id="projects-task-planning"></div><div id="projects-view-status"></div>', { runScripts: 'outside-only', url: 'https://example.test/' });
    const { window } = dom; window.eval(source);
    let actor = 'a', project = 'p', role = 'Owner', access = true, linksHold = null, lookupHold = null, saveHold = null, saved = [], revision = 3;
    const requests = [];
    const controller = window.CrmProjectsViews.createController({ getCurrentUser: () => ({ uid: actor }), board: { getState: () => ({ project: { id: project }, membership: { role } }) }, apiFetchJson: async (url, options) => {
        requests.push({ url, options });
        if (url.includes('/views?')) return { project: { id: project, lifecycle: 'active', revision }, membership: { role }, tasks: [], matchingTaskCount: 0 };
        if (url.includes('/crm-link-options?')) return lookupHold ? lookupHold.promise : { options: [{ type: 'student', recordId: 'student-1', label: 'Current student' }] };
        if (options?.method === 'PATCH') { const body = JSON.parse(options.body); assert.equal(body.expectedRevision, revision); if (saveHold) await saveHold.promise; saved = body.links; revision++; return {}; }
        if (url.endsWith('/links')) return linksHold ? linksHold.promise : { canManage: access, links: saved.map(link => ({ ...link, label: 'Current student' })) };
        throw Error('Unexpected request ' + url);
    } }); controller.init();
    const el = id => window.document.getElementById(id);
    return { dom, window, controller, requests, el, async start() { controller.setProject(project); await flush(); }, async lookup() { el('projects-project-link-type').value = 'student'; el('projects-project-link-query').value = 'Current'; el('projects-project-link-query').dispatchEvent(new window.Event('input', { bubbles: true })); el('projects-project-link-lookup').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); await flush(); }, holdLinks() { return linksHold = deferred(); }, holdLookup() { return lookupHold = deferred(); }, holdSave() { return saveHold = deferred(); }, clearLinks() { linksHold = null; }, setRole(value) { role = value; }, deny() { access = false; }, switchScope(id, uid) { project = id; actor = uid; controller.setProject(id); }, saved: () => saved, button: () => el('projects-project-link-options')?.querySelector('button') || null };
}
test('same-authority background links preserve lookup form, focused query and usable result', async () => {
    const h = harness();
    try {
        await h.start(); const held = h.holdLinks(); await h.controller.refresh(); await h.lookup();
        const form = h.el('projects-project-link-lookup'), input = h.el('projects-project-link-query'), button = h.button();
        assert.ok(button?.isConnected); input.focus(); input.setSelectionRange(2, 5);
        h.clearLinks(); held.resolve({ canManage: true, links: [] }); await flush();
        assert.equal(h.el('projects-project-link-lookup'), form, 'background refresh preserves the actual lookup form');
        assert.equal(h.button(), button); assert.equal(h.window.document.activeElement, input); assert.equal(input.selectionStart, 2);
        assert.equal(input.value, 'Current'); assert.equal(h.el('projects-project-link-type').value, 'student');
        button.click(); await flush();
        assert.deepEqual(h.saved(), [{ type: 'student', recordId: 'student-1' }]);
        assert.equal(h.requests.filter(r => r.options?.method === 'PATCH').length, 1);
    } finally { h.dom.window.close(); }
});
test('busy mutation disables lookup/result actions and re-enables them after canonical refresh', async () => {
    const h = harness();
    try {
        await h.start(); await h.lookup(); const save = h.holdSave(), button = h.button(); button.click(); await flush();
        assert.equal(button.disabled, true, 'a pending save must visibly disable result actions');
        assert.equal(h.el('projects-project-link-lookup').querySelector('button').disabled, true);
        assert.equal(h.el('projects-project-link-query').disabled, true);
        button.click(); assert.equal(h.requests.filter(r => r.options?.method === 'PATCH').length, 1);
        save.resolve(); await flush();
        assert.equal(h.el('projects-project-link-query').disabled, false);
        assert.equal(h.el('projects-project-link-lookup').querySelector('button').disabled, false);
        assert.deepEqual(h.saved(), [{ type: 'student', recordId: 'student-1' }]);
    } finally { h.dom.window.close(); }
});
for (const field of ['query', 'type']) test(`changed ${field} clears results and fences a held lookup`, async () => {
    const h = harness();
    try {
        await h.start(); await h.lookup(); const oldButton = h.button(), held = h.holdLookup(); await h.lookup();
        const control = h.el('projects-project-link-' + field); control.value = field === 'type' ? 'lead' : 'Different'; control.dispatchEvent(new h.window.Event(field === 'type' ? 'change' : 'input', { bubbles: true }));
        held.resolve({ options: [{ type: 'student', recordId: 'stale', label: 'Old query' }] }); await flush();
        assert.equal(h.button(), null); oldButton.click(); await flush();
        assert.equal(h.requests.filter(r => r.options?.method === 'PATCH').length, 0);
    } finally { h.dom.window.close(); }
});
for (const invalidation of ['project', 'actor', 'role', 'access']) test(`${invalidation} invalidation rejects held lookup and detached option action`, async () => {
    const h = harness();
    try {
        await h.start(); await h.lookup(); const oldButton = h.button(), held = h.holdLookup(); await h.lookup();
        if (invalidation === 'project') h.switchScope('q', 'a');
        if (invalidation === 'actor') h.switchScope('p', 'b');
        if (invalidation === 'role') { h.setRole('Viewer'); await h.controller.refresh(); }
        if (invalidation === 'access') { h.deny(); await h.controller.refresh(); }
        await flush(); held.resolve({ options: [{ type: 'student', recordId: 'secret', label: 'Old authority' }] }); await flush();
        assert.equal(h.button(), null); oldButton.click(); await flush();
        assert.equal(h.requests.filter(r => r.options?.method === 'PATCH').length, 0);
        assert.ok(!h.el('projects-project-links').textContent.includes('Old authority'));
    } finally { h.dom.window.close(); }
});
