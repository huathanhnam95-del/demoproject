'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAttachmentCleanup } = require('../../../functions/src/crm/data-input/attachment-cleanup');
function fixture() {
    const state = { now: 1800000000000, row: null, calls: [] }; let queue = Promise.resolve();
    const ref = {};
    const db = { collection: name => { assert.equal(name, 'crmDataInputMaintenance'); return { doc: id => { assert.equal(id, 'attachment-expiry'); return ref; } }; }, runTransaction(fn) {
        const job = queue.then(async () => { let write; const value = await fn({ get: async r => { assert.equal(r, ref); return { exists: !!state.row, data: () => structuredClone(state.row) }; }, set: (r, data) => { assert.equal(r, ref); write = structuredClone(data); } }); if (write) state.row = write; return value; }); queue = job.catch(() => {}); return job;
    } };
    const storage = { async sweepExpired(input) { state.calls.push(input); if (state.sweep) return state.sweep(input); return { scanned: 1, deleted: 1, retained: 0, skipped: 0, conflicted: 0, nextPageToken: state.next || null }; } };
    const create = () => createAttachmentCleanup({ db, storage, now: () => state.now });
    return { state, create };
}
test('cleanup resumes the durable cursor across instances and wraps after the last page', async () => {
    const f = fixture(); f.state.next = 'page-2';
    assert.equal((await f.create().run()).status, 'completed');
    assert.equal(f.state.row.pageToken, 'page-2'); assert.equal(f.state.row.leaseToken, null);
    f.state.next = null; await f.create().run();
    assert.deepEqual(f.state.calls, [{ limit: 100 }, { limit: 100, pageToken: 'page-2' }]);
    assert.equal(f.state.row.pageToken, null); assert.equal(f.state.row.completedScans, 1);
});
test('overlapping runs do not dispatch storage work twice', async () => {
    const f = fixture(); let release;
    f.state.sweep = () => new Promise(resolve => { release = resolve; });
    const first = f.create().run(); while (!release) await new Promise(resolve => setImmediate(resolve));
    assert.equal((await f.create().run()).status, 'busy'); assert.equal(f.state.calls.length, 1);
    release({ scanned: 0, deleted: 0, retained: 0, skipped: 0, conflicted: 0, nextPageToken: null }); await first;
});
test('failed pages retain their cursor and release only their own lease', async () => {
    const f = fixture(); f.state.next = 'retry-this'; await f.create().run();
    f.state.sweep = async () => { throw Error('storage failure with private details'); };
    await assert.rejects(f.create().run(), /storage failure/);
    assert.equal(f.state.row.pageToken, 'retry-this'); assert.equal(f.state.row.leaseToken, null);
    assert.equal(f.state.row.lastErrorCode, 'SWEEP_FAILED'); assert.ok(!JSON.stringify(f.state.row).includes('private details'));
    f.state.sweep = null; await f.create().run(); assert.equal(f.state.calls.at(-1).pageToken, 'retry-this');
});
test('expired leases recover and stale workers cannot overwrite the successor cursor', async () => {
    const f = fixture(); let release;
    f.state.sweep = () => new Promise(resolve => { release = resolve; });
    const stale = f.create().run(); while (!release) await new Promise(resolve => setImmediate(resolve));
    f.state.now += 600001; f.state.sweep = null; f.state.next = 'successor';
    await f.create().run();
    release({ scanned: 1, deleted: 0, retained: 1, skipped: 0, conflicted: 0, nextPageToken: 'stale' });
    assert.equal((await stale).status, 'lease-lost'); assert.equal(f.state.row.pageToken, 'successor');
});
