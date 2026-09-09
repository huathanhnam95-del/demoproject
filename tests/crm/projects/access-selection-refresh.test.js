'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
let JSDOM;
try { ({ JSDOM } = require(process.env.CRM_TEST_JSDOM || 'jsdom')); } catch (_) { /* Required below, never skipped. */ }
const source = fs.readFileSync(process.env.ACCESS_SOURCE || path.resolve(__dirname, '../../../public/js/crm/projects/access.js'), 'utf8');
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(setImmediate); };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
async function fixture(adminMode = true) {
    assert.ok(JSDOM, 'Required DOM dependency missing: set CRM_TEST_JSDOM to the external jsdom module path.');
    const dom = new JSDOM('<select id="board"></select><select id="access"></select><button id="refresh"></button><div id="members"></div><div id="editor"></div><select id="person"></select><select id="role"><option>Editor</option></select><button id="save"></button>');
    const document = dom.window.document;
    const elements = Object.fromEntries(Object.entries({ projectsProjectSelect: 'access', projectsRefresh: 'refresh', projectsMembersList: 'members', projectsMemberEditor: 'editor', projectsMemberPerson: 'person', projectsMemberRole: 'role', projectsMemberSave: 'save' }).map(([key, id]) => [key, document.getElementById(id)]));
    const board = document.getElementById('board'), requests = [], notices = [], holds = new Map();
    const summary = { projects: ['a', 'b'].map(id => ({ id, name: id, role: 'Owner', membershipRevision: 1 })) };
    const context = { document, console };
    vm.runInNewContext(source, context);
    const controller = context.CrmProjectsAccess.createController({ adminMode, elements, getCurrentUser: () => ({ uid: 'actor' }), onProjectsRendered: selection => {
        notices.push(selection);
        // The board picker uses this selection and delegates change to access.selectProject.
        board.innerHTML = selection.projects.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
        board.value = selection.selectedProjectId;
        board.disabled = !selection.projects.length;
    }, apiFetchJson: async (url, options = {}) => {
        const method = options.method || 'GET'; requests.push({ url, method });
        const held = holds.get(`${method} ${url}`); if (held) return held.promise;
        if (url === '/api/projects/' || url === '/api/projects/access') return summary;
        if (url === '/api/projects/people') return { people: [] };
        if (url.endsWith('/members')) return { members: [{ uid: `${url.split('/')[3]}-member`, role: 'Editor' }] };
        return {};
    } });
    let lastChange;
    board.addEventListener('change', event => { lastChange = controller.selectProject(event.target.value); });
    controller.init(); await controller.refresh();
    return { controller, elements, board, requests, notices, summary,
        hold(url, method = 'GET') { const d = deferred(); holds.set(`${method} ${url}`, d); return d; },
        release(url, value, method = 'GET') { const key = `${method} ${url}`, d = holds.get(key); holds.delete(key); d.resolve(value); },
        choose(id) { board.value = id; board.dispatchEvent(new dom.window.Event('change')); return lastChange; }
    };
}

test('known board selection survives held admin content-denial membership read', async () => {
    const h = await fixture(); h.hold('/api/projects/a/members');
    const denial = h.controller.handleProjectContentDenied('a');
    assert.equal(h.elements.projectsRefresh.disabled, true);
    assert.equal(h.board.disabled, false);
    assert.equal(await h.choose('b'), true);
    assert.equal(h.controller.getSelection().selectedProjectId, 'b');
    assert.equal(h.controller.getSelection().contentDeniedProjectIds.includes('a'), true);
    assert.match(h.elements.projectsMembersList.innerHTML, /b-member/);
    h.release('/api/projects/a/members', { members: [{ uid: 'old-secret', role: 'Owner' }] }); await denial;
    assert.equal(h.controller.getSelection().selectedProjectId, 'b');
    assert.doesNotMatch(h.elements.projectsMembersList.innerHTML, /old-secret/);
    assert.equal(h.elements.projectsRefresh.disabled, false);
});

for (const admin of [true, false]) test(`held full access read cannot overwrite explicit selection (admin=${admin})`, async () => {
    const h = await fixture(admin), url = admin ? '/api/projects/' : '/api/projects/access';
    h.hold(url); const refreshing = h.controller.refresh(); await flush();
    assert.equal(await h.choose('b'), true);
    h.release(url, { projects: [{ id: 'a', name: 'stale a', role: 'Owner' }] });
    assert.equal(await refreshing, false);
    assert.equal(h.controller.getSelection().selectedProjectId, 'b');
    assert.equal(h.board.value, 'b');
    assert.equal(h.controller.getSelection().projects.length, 2);
});

test('rapid B then A keeps latest members and outstanding busy state when older B finishes', async () => {
    const h = await fixture(); h.hold('/api/projects/b/members'); h.hold('/api/projects/a/members');
    const first = h.choose('b'); assert.equal(h.controller.getSelection().selectedProjectId, 'b');
    const latest = h.choose('a'); assert.equal(h.controller.getSelection().selectedProjectId, 'a');
    h.release('/api/projects/b/members', { members: [{ uid: 'stale-b', role: 'Owner' }] }); await first;
    assert.equal(h.elements.projectsRefresh.disabled, true);
    assert.equal(h.elements.projectsMemberSave.disabled, true);
    assert.doesNotMatch(h.elements.projectsMembersList.innerHTML, /stale-b/);
    h.release('/api/projects/a/members', { members: [{ uid: 'fresh-a', role: 'Owner' }] });
    assert.equal(await latest, true);
    assert.equal(h.controller.getSelection().selectedProjectId, 'a');
    assert.match(h.elements.projectsMembersList.innerHTML, /fresh-a/);
    assert.equal(h.elements.projectsRefresh.disabled, false);
});

test('unknown project is rejected during held read without emitting or requesting it', async () => {
    const h = await fixture(); h.hold('/api/projects/'); const reading = h.controller.refresh(); await flush();
    const before = h.notices.length;
    assert.equal(await h.controller.selectProject('unknown'), false);
    assert.equal(h.notices.length, before);
    assert.equal(h.controller.getSelection().selectedProjectId, 'a');
    assert.equal(h.requests.some(r => r.url.includes('unknown')), false);
    h.release('/api/projects/', h.summary); await reading;
});

test('actual member mutation retains selection lock through its reconciliation read', async () => {
    const h = await fixture(); h.hold('/api/projects/a/members', 'POST'); h.hold('/api/projects/');
    h.elements.projectsMemberPerson.innerHTML = '<option value="new">New member</option>';
    h.elements.projectsMemberRole.value = 'Editor'; h.elements.projectsMemberSave.click();
    assert.equal(h.requests.filter(r => r.method === 'POST').length, 1);
    assert.equal(await h.choose('b'), false);
    h.release('/api/projects/a/members', {}, 'POST'); await flush();
    assert.equal(await h.controller.selectProject('b'), false);
    assert.equal(h.controller.getSelection().selectedProjectId, 'a');
    h.release('/api/projects/', h.summary); await flush();
    assert.equal(await h.choose('b'), true);
});

test('revocation fences held old and latest membership completions without restoring access', async () => {
    const h = await fixture(); h.hold('/api/projects/a/members'); h.hold('/api/projects/b/members');
    const old = h.controller.selectProject('a'), latest = h.choose('b');
    assert.equal(h.controller.getSelection().selectedProjectId, 'b');
    assert.equal(h.controller.invalidateProjectAccess('b'), true);
    h.release('/api/projects/a/members', { members: [{ uid: 'old-secret', role: 'Owner' }] }); await old;
    assert.equal(h.elements.projectsRefresh.disabled, true);
    h.release('/api/projects/b/members', { members: [{ uid: 'revoked-secret', role: 'Owner' }] }); await latest;
    assert.equal(h.controller.getSelection().selectedProjectId, '');
    assert.equal(h.controller.getSelection().projects.some(p => p.id === 'b'), false);
    assert.doesNotMatch(h.elements.projectsMembersList.innerHTML, /old-secret|revoked-secret/);
    assert.equal(h.elements.projectsMemberSave.disabled, true);
});
