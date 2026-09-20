'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require(process.env.CRM_TEST_JSDOM || 'jsdom');
const root = path.resolve(__dirname, '../../..');
async function fixture(url = 'https://fixture.invalid/crm-admin.html?keep=yes#projects', count = 30, width = 1280) {
    const dom = new JSDOM(fs.readFileSync(path.join(root, 'public/crm-admin.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ''), { runScripts: 'outside-only', pretendToBeVisual: true, url });
    const win = dom.window;
    win.HTMLDialogElement.prototype.show = win.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    win.HTMLDialogElement.prototype.close = function () { this.open = false; };
    win.document.querySelector('[data-panel="projects"]').getBoundingClientRect = () => ({ width });
    win.document.querySelector('[data-panel="projects"]').dataset.projectsUi = 'v2';
    for (const name of ['presentation/column-model', 'presentation/table-layout', 'presentation/field-feedback', 'state', 'presentation/detail-surface', 'board', 'discussion', 'views']) win.eval(fs.readFileSync(path.join(root, `public/js/crm/projects/${name}.js`), 'utf8'));
    const admin = fs.readFileSync(path.join(root, 'public/crm-admin.js'), 'utf8');
    const bindings = Object.fromEntries([...admin.matchAll(/elements\.(projects\w+) = document.getElementById\('([^']+)'\)/g)].map(m => [m[1], m[2]]));
    win.eval(fs.readFileSync(path.join(root, 'tests/fixtures/crm/projects-v2-performance.js'), 'utf8'));
    const h = await win.createProjectsPerformanceFixture(bindings, count);
    return Object.assign(h, { win, doc: win.document, dispose() { h.close(); win.close(); } });
}
test('Overview is lazy; Updates loads once and preserves composer through repeat activation', async () => {
    const h = await fixture(); try {
        const reads = () => h.calls.filter(c => c.url.includes('/discussion')).length;
        await h.views.openTask('p0'); await h.wait();
        assert.equal(reads(), 0, 'Overview must not fetch Updates');
        h.board.activateDetailTab('updates'); await h.wait(); assert.equal(reads(), 1);
        const input = h.elements.projectsBoardDiscussionInput; input.value = 'Retained draft'; input.focus(); input.setSelectionRange(2, 5);
        h.board.activateDetailTab('details'); h.board.activateDetailTab('updates'); await h.wait();
        assert.equal(reads(), 1); assert.equal(input.value, 'Retained draft'); assert.equal(input.selectionStart, 2);
    } finally { h.dispose(); }
});
test('repeated view activation and refresh join one pending scoped request', async () => {
    const h = await fixture(); try {
        const release = h.hold('/views?'); const before = h.calls.filter(c => c.url.includes('/views?')).length;
        h.views.setView('calendar'); h.views.setView('calendar'); h.views.refresh(); h.views.refresh();
        assert.equal(h.calls.filter(c => c.url.includes('/views?')).length - before, 1);
        release(); await h.wait(); assert.equal(h.views.getState().view, 'calendar');
    } finally { h.dispose(); }
});
test('ordinary save plus observer echo performs one view reconciliation and no unrelated link reads', async () => {
    const h = await fixture(); try {
        h.views.setView('kanban'); await h.wait(); h.calls.length = 0;
        await h.command('p0', 'title', 'Saved title'); await h.wait();
        const saved = h.tasks.find(t => t.id === 'p0'), op = h.calls.find(c => c.method === 'PATCH').body.operationId;
        await h.remote({isCurrent:()=>true, authority:{project:{...h.board.getState().project},membership:{role:'Owner'}}, changes:[{operationId:op,taskIds:['p0'],command:'updateTask'}],hydration:{tasks:[{...saved}]}}); await h.wait();
        assert.equal(h.calls.filter(c=>c.url.includes('/views?')).length, 1);
        assert.equal(h.calls.filter(c=>c.url.includes('/links')).length, 0);
        assert.equal(h.board.getState().tasks.get('p0').revision, saved.revision);
    } finally { h.dispose(); }
});

for (const boundary of ['actor', 'project', 'access']) test(`pending deduplicated read is fenced after ${boundary}`, async () => {
    const h = await fixture(); try {
        const release = h.hold('/views?'); h.views.setView('calendar');
        if (boundary === 'actor') { h.actor = 'b'; await h.select('p'); }
        if (boundary === 'project') await h.select('q');
        if (boundary === 'access') h.views.invalidateAccess('p');
        release(); await h.wait();
        if (boundary === 'access' || boundary === 'actor') { assert.equal(h.views.getState().response, null); assert.equal(h.board.getState().authorizationReady, false); }
        else { assert.equal(h.views.getState().actorUid, h.actor); assert.equal(h.views.getState().response.project.id, boundary === 'project' ? 'q' : 'p'); }
    } finally { h.dispose(); }
});
test('failed active reconciliation refuses acknowledgement and retries the same dirty projection', async () => {
    const h = await fixture(); try {
        h.views.setView('kanban'); await h.wait();
        const task = h.tasks[0]; task.title = 'Remote title'; task.revision++;
        const change = {isCurrent:()=>true,authority:{project:{...h.board.getState().project},membership:{role:'Owner'}},changes:[{taskIds:['p0'],command:'updateTask'}],hydration:{tasks:[{...task}]}};
        h.failures.push({match:'/views?',status:503}); assert.equal(await h.remote(change),false);
        assert.equal(await h.remote(change),true); await h.wait();
        assert.equal(h.views.getState().response.tasks.find(t=>t.id==='p0').title,'Remote title');
    } finally { h.dispose(); }
});
test('remote task link updates reload the selected Overview links while Table is active', async () => {
    const h = await fixture(); try {
        await h.views.openTask('p0'); await h.wait(); h.calls.length=0;
        await h.remote({isCurrent:()=>true,authority:{project:{...h.board.getState().project},membership:{role:'Owner'}},changes:[{taskIds:['p0'],command:'updateTaskLinks'}],hydration:{tasks:[]}});
        assert.equal(h.calls.filter(c=>c.url.endsWith('/tasks/p0/links')).length,1);
        assert.equal(h.calls.filter(c=>c.url.includes('/views?')).length,0);
    } finally { h.dispose(); }
});
test('repeated initialization and disposal retain one context subscription', async () => {
    const h = await fixture(); try {
        for(let i=0;i<10;i++)h.views.init(); assert.equal(h.contextSubscriptions,1);
        const release=h.hold('/views?');h.views.setView('calendar');h.views.dispose();assert.equal(h.contextSubscriptions,0);release();await h.wait();
        assert.equal(h.views.getState().response,null);
        h.calls.length=0;h.board.updateTask({...h.tasks[0],revision:3});await h.wait();assert.equal(h.calls.length,0);
    } finally { h.dispose(); }
});

async function automationFixture() {
    const dom = new JSDOM(fs.readFileSync(path.join(root, 'public/crm-admin.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ''), { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://fixture.invalid/crm-admin.html?keep=yes#projects' });
    const w = dom.window; w.TextEncoder = TextEncoder; w.document.querySelector('[data-panel="projects"]').dataset.projectsUi = 'v2';
    for (const name of ['automation-definition-editor', 'automations-renderer', 'automations', 'presentation/shell']) w.eval(fs.readFileSync(path.join(root, `public/js/crm/projects/${name}.js`), 'utf8'));
    w.eval(fs.readFileSync(path.join(root, 'tests/fixtures/crm/projects-v2-automations.js'), 'utf8'));
    const h = await w.createProjectsAutomationsFixture();
    return Object.assign(h, { w, doc: w.document, close: () => { h.shell.dispose(); w.close(); } });
}

test('automation repeated activation coalesces the current query and retains newer filter reads', async () => {
    const h = await automationFixture(); try {
        h.calls.length=0;const release=h.hold('/automations?','GET');const first=h.controller.show();h.controller.show();h.controller.loadList();
        assert.equal(h.calls.length,1);await h.controller.setFilters({query:'New filter'});assert.equal(h.calls.length,2);
        release();await first;assert.equal(h.controller.getState().filters.query,'New filter');
    } finally { h.close(); }
});
test('newer canonical view snapshot does not schedule a second self-triggered read', async () => {
    const h = await fixture();try {
        await h.views.openTask('p0');await h.wait();h.tasks[0].revision=5;h.tasks[0].title='Server snapshot';h.calls.length=0;
        // The initial snapshot is now hydrated. Explicitly request the newer
        // server snapshot, then ensure its publication does not trigger another read.
        h.views.setView('kanban');await h.views.refresh();await h.wait();
        assert.equal(h.calls.filter(c=>c.url.includes('/views?')).length,1);
        assert.equal(h.board.getState().tasks.get('p0').revision,5);
    } finally { h.dispose(); }
});

test('mobile repeated paging stays bounded and can return to earlier loaded rows', async () => {
    const h = await fixture(undefined, 500, 390); try {
        h.doc.querySelector('[data-panel="projects"]').getBoundingClientRect=()=>({width:390});h.win.dispatchEvent(new h.win.Event('resize'));
        for(let i=0;i<6;i++)h.doc.querySelector('[data-mobile-more]').click();
        assert.ok(h.doc.querySelectorAll('#projects-board-rows [data-row-id]').length<=208);
        const previous=h.doc.querySelector('[data-mobile-previous]');assert.equal(previous.hidden,false);previous.click();
        assert.ok(h.doc.activeElement.closest('[data-row-id]'));assert.ok(h.doc.querySelectorAll('#projects-board-rows [data-row-id]').length<=208);
    } finally { h.dispose(); }
});

test('remote changes to an unloaded branch invalidate a visible cross-view projection', async () => {
    const h=await fixture();try {
        h.views.setView('kanban');await h.wait();assert.equal(h.board.getState().tasks.has('p4'),false);h.calls.length=0;
        const task=h.tasks.find(t=>t.id==='p4');task.title='Changed unloaded child';task.revision++;
        const change={isCurrent:()=>true,authority:{project:{...h.board.getState().project},membership:{role:'Owner'}},changes:[{taskIds:['p4'],command:'updateTask'}],hydration:{tasks:[{...task}]}};
        await h.remote(change);await h.wait();
        assert.equal(h.calls.filter(c=>c.url.includes('/views?')).length,1);
        assert.equal(h.views.getState().response.tasks.find(t=>t.id==='p4').revision,2);
        assert.equal(h.board.getState().tasks.has('p4'),false);
    } finally {h.dispose();}
});

function remoteChange(h, extra = {}) {
    return { isCurrent: () => true, cursor: 'repair-1', messageIds: [], changes: [],
        authority: { project: { ...h.board.getState().project }, membership: { role: h.role } },
        hydration: { tasks: [], messages: [], unavailableTaskIds: [], unavailableMessageIds: [] }, ...extra };
}
async function loadedDiscussion(h, count = 65) {
    h.messages = Array.from({ length: count }, (_, i) => ({ id: `m${i}`, taskId: 'p0', body: `Update ${i}`, revision: 1, authorUid: 'a', createdAt: new Date(Date.UTC(2026, 8, 1, 0, 0, count - i)).toISOString() }));
    await h.views.openTask('p0'); h.board.activateDetailTab('updates'); await h.wait();
    while (h.discussion.getState().messages.length < count) await h.discussion.refresh({ append: true });
    h.elements.projectsBoardDiscussionInput.value = 'Retained draft';
    h.elements.projectsBoardDiscussionInput.setSelectionRange(2, 6);
    h.elements.projectsBoardDiscussionList.scrollTop = 45;
    h.board.activateDetailTab('details'); h.calls.length = 0;
}
const discussionReads = h => h.calls.filter(c => c.url.includes('/discussion') || c.url.includes('/changes/hydrate'));
for (const kind of ['edit', 'redaction', 'unavailable']) test(`hidden older ${kind} survives reopening more than 50 updates without fetching`, async () => {
    const h = await fixture(); try {
        await loadedDiscussion(h);
        const row = h.messages.find(m => m.id === 'm64'); row.revision++;
        if (kind === 'edit') row.body = 'Edited older body';
        if (kind === 'redaction') Object.assign(row, { body: null, redacted: true, moderationState: 'hidden' });
        if (kind === 'unavailable') h.messages = h.messages.filter(m => m.id !== 'm64');
        const change = remoteChange(h); change.hydration.messages = kind === 'unavailable' ? [] : [{ ...row }];
        change.hydration.unavailableMessageIds = kind === 'unavailable' ? ['m64'] : [];
        assert.equal(await h.remote(change), true);
        h.board.activateDetailTab('updates'); await h.wait();
        const current = h.discussion.getState().messages.find(m => m.id === 'm64');
        if (kind === 'unavailable') assert.equal(current, undefined);
        else { assert.equal(current.body, row.body); assert.equal(current.redacted, row.redacted); }
        assert.equal(h.discussion.getState().messages.length, kind === 'unavailable' ? 64 : 65);
        assert.equal(discussionReads(h).length, 0);
        assert.equal(h.elements.projectsBoardDiscussionInput.value, 'Retained draft');
        assert.equal(h.elements.projectsBoardDiscussionInput.selectionStart, 2);
        assert.equal(h.elements.projectsBoardDiscussionList.scrollTop, 45);
    } finally { h.dispose(); }
});
test('empty polls, unrelated tasks and ordinary field echoes do not dirty hidden Updates', async () => {
    const h = await fixture(); try {
        await loadedDiscussion(h);
        for (let i = 0; i < 4; i++) {
            await h.remote(remoteChange(h));
            await h.remote(remoteChange(h, { changes: [{ command: 'updateTask', taskIds: ['p1'] }] }));
            await h.remote(remoteChange(h, { changes: [{ command: 'updateTask', taskIds: ['p0'] }] }));
        }
        h.board.activateDetailTab('updates'); await h.wait();
        assert.equal(discussionReads(h).length, 0); assert.equal(h.discussion.getState().messages.length, 65);
    } finally { h.dispose(); }
});
for (const fallback of [false, true]) test(`hidden discussionRefresh repairs loaded history with bounded ${fallback ? 'page fallback' : 'ID hydration'}`, async () => {
    const h = await fixture(); try {
        await loadedDiscussion(h, 165);
        h.messages[164].body = 'Older repaired'; h.messages[164].revision++;
        h.messages = h.messages.filter(m => m.id !== 'm163');
        const change = remoteChange(h, { discussionRefresh: true, hydrationFallback: fallback });
        const first = await h.remote(change);
        assert.ok(discussionReads(h).length <= 4);
        if (!fallback) { assert.equal(first, false); assert.equal(await h.remote(change), true); }
        else assert.equal(first, true);
        assert.equal(discussionReads(h).length, fallback ? 4 : 6);
        for (const call of discussionReads(h).filter(c => c.body)) assert.ok(call.body.messageIds.length <= 32);
        h.board.activateDetailTab('updates'); await h.wait();
        assert.equal(h.discussion.getState().messages.find(m => m.id === 'm164').body, 'Older repaired');
        assert.equal(h.discussion.getState().messages.some(m => m.id === 'm163'), false);
        assert.equal(h.discussion.getState().messages.length, 164);
        assert.equal(discussionReads(h).length, fallback ? 4 : 6);
    } finally { h.dispose(); }
});
test('failed hidden repair retains its obligation through retry and a held response', async () => {
    const h = await fixture(); try {
        await loadedDiscussion(h); h.messages[64].body = 'After retry'; h.messages[64].revision++;
        const change = remoteChange(h, { discussionRefresh: true });
        h.failures.push({ match: '/changes/hydrate', status: 503 });
        await assert.rejects(h.remote(change), /Synthetic rejection/);
        h.board.activateDetailTab('updates'); await h.wait();
        assert.doesNotMatch(h.elements.projectsBoardDiscussionList.textContent, /Update 64/);
        assert.match(h.elements.projectsBoardDiscussionList.textContent, /Refreshing this update/);
        const release = h.hold('/changes/hydrate', 'POST'); const retry = h.remote(change); await h.wait();
        assert.equal(h.discussion.getState().messages.find(m => m.id === 'm64').body, 'Update 64');
        release(); assert.equal(await retry, true);
        h.board.activateDetailTab('updates'); await h.wait();
        assert.equal(h.discussion.getState().messages.find(m => m.id === 'm64').body, 'After retry');
        assert.equal(discussionReads(h).length, 4);
    } finally { h.dispose(); }
});
for (const boundary of ['actor', 'project', 'access']) test(`pending calendar data cannot render or cache after ${boundary}`, async () => {
    const h = await fixture(); try {
        const old = h.hold('/calendar?'); h.views.setView('calendar'); await h.wait();
        h.calendarStatus = 'unverified';
        if (boundary === 'actor') { h.actor = 'b'; await h.select('p'); }
        if (boundary === 'project') await h.select('q');
        if (boundary === 'access') h.views.invalidateAccess('p');
        old(); await h.wait();
        assert.doesNotMatch(h.doc.getElementById('projects-calendar-view-provenance')?.textContent || '', /Verified/);
        if (boundary !== 'project') assert.equal(h.views.getState().response, null);
        else { h.views.setView('calendar'); await h.wait(); assert.equal(calendarReads(h).length, 2); }
    } finally { h.dispose(); }
});
test('never opened Overview does not eagerly fetch discussion history for a refresh', async () => {
    const h = await fixture(); try {
        await h.views.openTask('p0'); h.calls.length = 0;
        assert.equal(await h.remote(remoteChange(h, { discussionRefresh: true, hydrationFallback: true })), true);
        assert.equal(discussionReads(h).length, 0);
        h.board.activateDetailTab('updates'); await h.wait(); assert.equal(discussionReads(h).length, 1);
    } finally { h.dispose(); }
});
for (const boundary of ['task', 'actor', 'project', 'authority']) test(`late hidden repair cannot cross ${boundary} scope`, async () => {
    const h = await fixture(); try {
        await loadedDiscussion(h); h.messages[64].body = 'Obsolete repair'; h.messages[64].revision++;
        const release = h.hold('/changes/hydrate', 'POST');
        const pending = h.discussion.applyRemote(remoteChange(h, { discussionRefresh: true })); await h.wait();
        if (boundary === 'actor') h.actor = 'b';
        h.discussion.setSelection({ projectId: boundary === 'project' ? 'q' : 'p', taskId: boundary === 'task' ? 'p1' : 'p0', role: boundary === 'authority' ? 'Viewer' : 'Owner', deferLoad: true });
        release(); assert.equal(await pending, false);
        assert.equal(h.discussion.getState().messages.some(m => m.body === 'Obsolete repair'), false);
        assert.equal(discussionReads(h).length, 1);
    } finally { h.dispose(); }
});
const calendarReads = h => h.calls.filter(c => c.url.includes('/calendar?'));
for (const boundary of ['role', 'membership', 'authority', 'refresh']) for (const order of ['old-first', 'new-first']) test(`calendar ${boundary} fences pending/completed cache (${order})`, async () => {
    const h = await fixture(); try {
        const old = h.hold('/calendar?'); h.views.setView('calendar'); await h.wait();
        assert.equal(calendarReads(h).length, 1);
        h.calendarStatus = 'unverified';
        if (boundary === 'role') h.role = 'Viewer';
        if (boundary === 'membership') h.membershipRevision++;
        const fresh = h.hold('/calendar?');
        const change = remoteChange(h, { authorityChanged: boundary !== 'refresh', refresh: boundary === 'refresh' });
        change.authority.project.membershipRevision = h.membershipRevision;
        await h.remote(change); await h.wait();
        for (let i = 0; i < 3; i++) h.views.setView('calendar');
        assert.equal(calendarReads(h).length, 2);
        const rendered = () => h.doc.getElementById('projects-calendar-view-provenance')?.textContent || '';
        if (order === 'old-first') { old(); await h.wait(); assert.doesNotMatch(rendered(), /Verified/); fresh(); }
        else { fresh(); await h.wait(); old(); }
        await h.wait(); assert.doesNotMatch(rendered(), /Verified/);
        assert.match(h.doc.getElementById('projects-calendar-details').textContent, /Coverage incomplete/);
        h.views.setView('kanban'); h.views.setView('calendar'); await h.wait();
        assert.doesNotMatch(rendered(), /Verified/); assert.equal(calendarReads(h).length, 2);
    } finally { h.dispose(); }
});
test('explicit calendar refresh fences old reads and current failures can retry', async () => {
    const h = await fixture(); try {
        const old = h.hold('/calendar?'); h.views.setView('calendar'); await h.wait();
        h.calendarStatus = 'unverified'; h.failures.push({ match: '/calendar?', status: 503 });
        await h.views.refresh(); await h.wait();
        old(); await h.wait(); assert.doesNotMatch(h.doc.getElementById('projects-calendar-view-provenance').textContent, /Verified/);
        h.doc.getElementById('projects-view-retry').click(); await h.wait();
        assert.equal(calendarReads(h).length, 3);
        assert.doesNotMatch(h.doc.getElementById('projects-calendar-view-provenance').textContent, /Verified/);
    } finally { h.dispose(); }
});
test('calendar completed cache retains only six months and repeated month activation shares reads', async () => {
    const h = await fixture(); try {
        h.views.setView('calendar'); await h.wait(); h.calls.length = 0;
        const month = async value => {
            const control = h.doc.getElementById('projects-view-month'); control.value = value;
            control.dispatchEvent(new h.win.Event('change', { bubbles: true }));
            h.views.setView('calendar'); h.views.setView('calendar'); await h.wait();
        };
        for (let i = 1; i <= 7; i++) await month(`2027-0${i}`);
        assert.equal(calendarReads(h).length, 7);
        await month('2027-02'); assert.equal(calendarReads(h).length, 7);
        await month('2027-01'); assert.equal(calendarReads(h).length, 8, 'oldest completed month must be evicted');
    } finally { h.dispose(); }
});
