'use strict';
// Opening a board uses one /open request whose change cursor seeds the
// observer; refreshes keep the separate handshake. Remembered boards paint
// after a reload for the same account only and stay read-only until confirmed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require(process.env.CRM_TEST_JSDOM || 'jsdom');
const root = path.resolve(__dirname, '../../..');
const tick = async () => { for (let i = 0; i < 15; i++) await new Promise(setImmediate); };

function page() {
    const dom = new JSDOM(fs.readFileSync(path.join(root, 'public/crm-admin.html'), 'utf8'), { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://fixture.invalid' });
    const win = dom.window;
    for (const name of ['presentation/column-model', 'presentation/table-layout', 'presentation/field-feedback', 'presentation/row-layout', 'presentation/contextual-create', 'state', 'board']) win.eval(fs.readFileSync(path.join(root, `public/js/crm/projects/${name}.js`), 'utf8'));
    return win;
}

function mount(win, { actor = 'a', role = 'Owner', deny = 0, hold = null } = {}) {
    const doc = win.document;
    const elements = Object.fromEntries([...fs.readFileSync(path.join(root, 'public/crm-admin.js'), 'utf8').matchAll(/elements\.(projects\w+) = document.getElementById\('([^']+)'\)/g)].map(m => [m[1], doc.getElementById(m[2])]));
    const tasks = [{ id: 't', title: 'Parent', sectionId: 's', effectiveSectionId: 's', rank: '0/1', revision: 1, status: 'not_started' }];
    const sections = [{ id: 's', title: 'Section', rank: '0/1' }];
    const requests = [];
    const pageBody = () => ({ tasks: structuredClone(tasks), sections: sections.slice(), columns: [], revision: { structureRevision: 1, schemaRevision: 1 } });
    const apiFetchJson = async url => {
        requests.push(url);
        if (hold) await hold;
        if (deny) throw Object.assign(Error('denied'), { status: deny });
        const id = url.split('/api/projects/')[1].split(/[/?]/)[0];
        if (url.includes('/open?')) return { project: { id, lifecycle: 'active', structureRevision: 1, schemaRevision: 1 }, membership: { role }, people: [], page: pageBody(), changes: { cursor: `cursor-${id}`, authority: { signature: role } } };
        if (url.includes('member-directory')) return { people: [] };
        if (url.includes('/tasks?')) return pageBody();
        return { project: { id, lifecycle: 'active' }, membership: { role } };
    };
    const feed = { seeds: [], handshakes: 0 };
    const observer = {
        snapshot(id, load, options = {}) {
            assert.equal(options.inline, true, 'board opens use inline observer snapshots');
            return load({ seed(result) { feed.seeds.push(result?.cursor); return !!result?.cursor; }, async handshake() { feed.handshakes++; requests.push(`/api/projects/${id}/changes`); return true; } });
        },
        stop() {}
    };
    const board = win.CrmProjectsBoard.createController({ elements, presentationV2: true, getCurrentUser: () => ({ uid: actor }), apiFetchJson });
    board.init();
    board.attachRemoteObserver(observer);
    const select = id => board.setProjects({ projects: [{ id: 'p', lifecycle: 'active' }, { id: 'q', lifecycle: 'active' }], selectedProjectId: id });
    return { board, requests, feed, select, doc };
}

test('opening a board makes one /open request and seeds the observer cursor from it', async () => {
    const win = page();
    try {
        const h = mount(win);
        h.select('p'); await tick();
        assert.deepEqual(h.requests.map(url => url.split('?')[0]), ['/api/projects/p/open']);
        assert.deepEqual(h.feed.seeds, ['cursor-p']);
        assert.equal(h.feed.handshakes, 0);
        assert.equal(h.board.getState().authorizationReady, true);
        assert.ok(h.doc.querySelector('[data-task-id="t"]'));
    } finally { win.close(); }
});

test('a refresh keeps the separate handshake before its project and task reads', async () => {
    const win = page();
    try {
        const h = mount(win);
        h.select('p'); await tick();
        h.requests.length = 0;
        await h.board.refresh();
        const paths = h.requests.map(url => url.split('?')[0]);
        assert.equal(paths[0], '/api/projects/p/changes', 'handshake precedes refresh reads');
        assert.ok(!paths.includes('/api/projects/p/open'));
        assert.ok(paths.includes('/api/projects/p') && paths.includes('/api/projects/p/tasks'));
    } finally { win.close(); }
});

test('a board prefetched on intent is used by the next open without another request', async () => {
    const win = page();
    try {
        const h = mount(win);
        h.select('p'); await tick();
        assert.equal(h.board.prefetchProject('q'), true);
        assert.equal(h.board.prefetchProject('q'), true, 'a fresh prefetch is reused, not repeated');
        await tick();
        h.select('q'); await tick();
        assert.equal(h.requests.filter(url => url.startsWith('/api/projects/q/open')).length, 1);
        assert.deepEqual(h.feed.seeds.at(-1), 'cursor-q');
        assert.equal(h.board.getState().project.id, 'q');
    } finally { win.close(); }
});

test('an /open denial clears the board and never seeds the observer', async () => {
    const win = page();
    try {
        const h = mount(win, { deny: 403 });
        h.select('p'); await tick();
        assert.notEqual(h.board.getState().project?.id, 'p');
        assert.deepEqual(h.feed.seeds, []);
    } finally { win.close(); }
});

test('after a reload the remembered board paints read-only for the same account only', async () => {
    const win = page();
    try {
        const first = mount(win);
        first.select('p'); await tick();
        first.select('q'); await tick();
        const stored = JSON.parse(win.localStorage.getItem('crmProjectsBoardCache:v1'));
        assert.equal(stored.uid, 'a');
        assert.ok(stored.entries.p, 'switching away stores the confirmed board');
        first.board.disposePresentation();
        let release;
        const reloaded = mount(win, { hold: new Promise(resolve => { release = resolve; }) });
        reloaded.select('p');
        assert.equal(reloaded.board.getState().project?.id, 'p', 'remembered board paints before the network answers');
        assert.ok(reloaded.board.getState().tasks.has('t'));
        assert.equal(reloaded.board.getState().authorizationReady, false, 'remembered membership never authorizes writes');
        release(); await tick();
        assert.equal(reloaded.board.getState().authorizationReady, true);
        reloaded.board.disposePresentation();
        const other = mount(win, { actor: 'b', hold: new Promise(() => {}) });
        other.select('p');
        assert.notEqual(other.board.getState().project?.id, 'p', 'another account never receives the remembered board');
    } finally { win.close(); }
});
