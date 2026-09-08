'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const flush = () => new Promise(setImmediate);
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function harness() {
    let uid = 'actor-a', nextTimer = 0;
    const timers = new Map(), calls = [], applied = [];
    const context = { setTimeout(fn, delay) { const id = ++nextTimer; timers.set(id, { fn, delay }); return id; }, clearTimeout(id) { timers.delete(id); } };
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../../public/js/crm/projects/remote-observer.js'), 'utf8'), context);
    let fetchHook = null, applyHook = null;
    const observer = context.CrmProjectsRemoteObserver.createController({
        getCurrentUser: () => ({ uid }),
        apiFetchJson: async url => {
            const request = { url, uid }; calls.push(request);
            if (fetchHook) { const response = fetchHook(request); if (response) return response; }
            return page(request);
        },
        apply: async change => { applied.push(change.cursor); return applyHook ? applyHook(change) : true; }
    });
    function page({ url, uid: actor }) { const project = url.split('/')[3]; return { cursor: `${project}-${actor}-${url.includes('?') ? 'ack' : 'head'}`, authority: { signature: `${project}-${actor}` }, taskIds: [], messageIds: [], hasMore: false }; }
    return { observer, calls, applied, timers, page, setUid(value) { uid = value; }, fetch(fn) { fetchHook = fn; }, apply(fn) { applyHook = fn; } };
}
for (const actorSwitch of [false, true]) test(`held snapshot releases lane on ${actorSwitch ? 'account' : 'project'} handoff`, async () => {
    const h = harness(), gate = deferred(); let oldDone = false, newDone = false;
    try {
        const old = h.observer.snapshot('a', async () => { await gate.promise; oldDone = true; });
        await flush(); h.observer.tick(); await flush();
        assert.equal(h.observer.getState().queuedPoll, true);
        if (actorSwitch) h.setUid('actor-b');
        const project = actorSwitch ? 'a' : 'b';
        const fresh = h.observer.snapshot(project, async () => { newDone = true; });
        await flush();
        assert.equal(newDone, true, 'new scope snapshot finishes before old request release');
        await fresh; h.observer.tick(); await flush();
        assert.equal(oldDone, false);
        assert.equal(h.observer.getState().cursor, `${project}-${actorSwitch ? 'actor-b' : 'actor-a'}-ack`);
        assert.equal(h.applied.length, 1, 'only current scope applied');
        const before = JSON.stringify(h.observer.getState()), timerIds = [...h.timers.keys()];
        gate.resolve(); await old; await flush();
        assert.equal(JSON.stringify(h.observer.getState()), before);
        assert.deepEqual([...h.timers.keys()], timerIds, 'stale snapshot and queued poll cannot replace current timer');
    } finally { gate.resolve(); h.observer.dispose(); }
});
test('stale in-flight poll cannot clear current queued poll, acknowledge, or replace timer', async () => {
    const h = harness(), oldGate = deferred(), newGate = deferred();
    try {
        await h.observer.snapshot('a', async () => true);
        h.fetch(request => request.url.includes('/a/changes?') ? oldGate.promise : null);
        h.observer.tick(); await flush();
        let loaded = false;
        const fresh = h.observer.snapshot('b', async () => { loaded = true; }); await flush();
        assert.equal(loaded, true, 'new snapshot bypasses old in-flight poll'); await fresh;
        h.apply(change => change.cursor.startsWith('b-') ? newGate.promise : true);
        h.observer.tick(); await flush();
        assert.equal(h.observer.getState().queuedPoll, true);
        const timerIds = [...h.timers.keys()];
        oldGate.resolve(h.page({ url: '/api/projects/a/changes?cursor=old', uid: 'actor-a' })); await flush();
        assert.equal(h.observer.getState().queuedPoll, true);
        assert.equal(h.observer.getState().cursor, 'b-actor-a-head');
        assert.deepEqual([...h.timers.keys()], timerIds);
        assert.deepEqual(h.applied, ['b-actor-a-ack']);
        newGate.resolve(true); await flush();
        assert.equal(h.observer.getState().cursor, 'b-actor-a-ack');
        assert.equal(h.observer.getState().queuedPoll, false);
    } finally { oldGate.resolve({}); newGate.resolve(true); h.observer.dispose(); }
});
test('same project and actor serialize snapshots then poll and acknowledge only after apply', async () => {
    const h = harness(), gate = deferred(), applyGate = deferred(), order = [];
    try {
        const first = h.observer.snapshot('a', async () => { order.push('first'); await gate.promise; order.push('first-end'); });
        await flush();
        const second = h.observer.snapshot('a', async () => { order.push('second'); });
        h.apply(async () => { order.push('apply'); return applyGate.promise; });
        h.observer.tick(); h.observer.tick(); await flush();
        assert.deepEqual(order, ['first']); assert.equal(h.calls.length, 1);
        gate.resolve(); await first; await second; await flush();
        assert.deepEqual(order, ['first', 'first-end', 'second', 'apply']);
        assert.equal(h.calls.filter(call => call.url.includes('?')).length, 1);
        assert.equal(h.observer.getState().cursor, 'a-actor-a-head');
        applyGate.resolve(true); await flush();
        assert.equal(h.observer.getState().cursor, 'a-actor-a-ack');
    } finally { gate.resolve(); applyGate.resolve(true); h.observer.dispose(); }
});
