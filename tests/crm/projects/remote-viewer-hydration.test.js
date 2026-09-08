'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = process.env.PROJECTS_SOURCE_ROOT || path.resolve(__dirname, '../../..');
const flush = () => new Promise(setImmediate);
function gate() { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; }

test('actual observer/discussion completes held 167-message Owner to Viewer repair automatically', async () => {
    const timers = new Map(), requests = [], errors = [], ownerHold = gate(), viewerHold = gate();
    let nextTimer = 0, role = 'Owner', membershipRevision = 1, ownerBatches = 0, viewerBatches = 0, html = '';
    const rows = Array.from({ length: 167 }, (_, i) => ({ id: `m${String(i).padStart(3, '0')}`, taskId: 't', body: i === 0 ? 'Edited oldest remotely' : `Message ${i}`, revision: 2, authorUid: 'other', createdAt: String(i).padStart(4, '0'), moderationState: i === 0 ? 'hidden' : 'visible' }));
    const safe = row => role === 'Viewer' && row.moderationState === 'hidden' ? { ...row, body: null, redacted: true, mentions: [], attachmentIds: [] } : { ...row };
    const context = { URLSearchParams, document: { hidden: false, getElementById: () => null, addEventListener() {}, removeEventListener() {} }, setTimeout(fn, delay) { const id = ++nextTimer; timers.set(id, { fn, delay }); return id; }, clearTimeout(id) { timers.delete(id); } };
    for (const file of ['remote-observer.js', 'discussion.js']) vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'public/js/crm/projects', file), 'utf8'), context);
    const authority = () => ({ signature: JSON.stringify([role, membershipRevision, 'active']), project: { id: 'p', membershipRevision, lifecycle: 'active' }, membership: { role } });
    const api = async (url, options) => {
        requests.push({ url, role, ids: options ? JSON.parse(options.body).messageIds : [] });
        if (options) {
            const ids = JSON.parse(options.body).messageIds;
            assert.ok(ids.length <= 32);
            const response = { tasks: [], messages: rows.filter(row => ids.includes(row.id)).map(safe), unavailableTaskIds: [], unavailableMessageIds: [] };
            if (role === 'Owner' && ++ownerBatches === 4) await ownerHold.promise;
            else if (role === 'Viewer' && ++viewerBatches === 1) await viewerHold.promise;
            return response;
        }
        if (url.includes('member-directory')) return { people: [] };
        if (url.includes('/discussion?')) return { messages: rows.map(safe), hasMore: false };
        return { authority: authority(), cursor: 'empty-feed-head', taskIds: [], messageIds: [], changes: [], hasMore: false };
    };
    const list = { get innerHTML() { return html; }, set innerHTML(value) { html = value; }, querySelectorAll: () => [], insertAdjacentHTML() {}, scrollTop: 12 };
    const discussion = context.CrmProjectsDiscussion.createController({ elements: { projectsBoardDiscussionList: list }, getCurrentUser: () => ({ uid: 'a' }), apiFetchJson: api });
    const observer = context.CrmProjectsRemoteObserver.createController({ getCurrentUser: () => ({ uid: 'a' }), apiFetchJson: api, onError: error => errors.push(error), apply: async change => {
        discussion.setSelection({ projectId: 'p', taskId: 't', role: change.authority.membership.role });
        return discussion.applyRemote(change);
    } });
    const pump = async () => { await flush(); await flush(); };
    const runScheduled = async () => { assert.ok(timers.size, 'observer retains scheduled continuation'); const [id, timer] = [...timers].at(-1); timers.delete(id); timer.fn(); await pump(); };
    try {
        discussion.setSelection({ projectId: 'p', taskId: 't', role }); await pump();
        discussion.attachRemoteObserver(observer); await observer.snapshot('p', async () => true);
        membershipRevision++; await runScheduled();
        assert.equal(ownerBatches, 4); assert.equal(observer.getState().queuedPoll, true);
        role = 'Viewer'; ownerHold.resolve(); await pump(); await runScheduled();
        assert.equal(viewerBatches, 1); assert.equal(discussion.getState().selection.role, 'Viewer');
        assert.equal(discussion.getState().messages.length, 167);
        assert.equal(discussion.getState().messages.find(row => row.id === 'm000').body, null);
        assert.ok(!html.includes('Edited oldest remotely'));
        assert.ok(!observer.getState().signature.includes('Viewer'));
        viewerHold.resolve(); await pump();
        assert.ok(!observer.getState().signature.includes('Viewer'), 'four bounded Viewer chunks cannot acknowledge all 167 messages');
        await runScheduled();
        assert.equal(viewerBatches, 6);
        assert.equal(observer.getState().signature, JSON.stringify(['Viewer', 2, 'active']));
        assert.equal(observer.getState().queuedPoll, false);
        assert.equal(discussion.getState().messages.length, 167);
        assert.equal(discussion.getState().messages.find(row => row.id === 'm000').body, null);
        assert.ok(!html.includes('Edited oldest remotely')); assert.deepEqual(errors, []);
        console.log(JSON.stringify({ ownerBatches, viewerBatches, state: observer.getState(), requests: requests.length }));
    } finally { ownerHold.resolve(); viewerHold.resolve(); observer.dispose(); }
});
