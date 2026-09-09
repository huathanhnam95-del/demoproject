'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createProjectsContextDetails } = require('../../../functions/src/crm/projects/voice/context-details');
const { createProjectsAccessService, memberDocumentId } = require('../../../functions/src/crm/projects/access-service');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const ref = path => ({ path, doc: id => ref(`${path}/${id}`), where() { return this; }, limit() { return this; } });
const db = { collection: ref };
function fixture(count = 9) {
    const calls = [], gates = [], reads = [], membership = deferred(), calendar = deferred();
    const tx = { get(query) { reads.push(query.path); return query.path === 'crmProjectMembers' ? membership.promise : calendar.promise; } };
    const accessService = { assertTransactionEligible(transaction, uid) { assert.equal(transaction, tx); calls.push(uid); const gate = deferred(); gates.push(gate); return gate.promise; } };
    const service = createProjectsContextDetails({ db, accessService, now: () => Date.parse('2026-09-09T00:00:00Z') });
    const docs = Array.from({ length: count }, (_, i) => ({ id: memberDocumentId('p', `u${i}`), data: () => ({ projectId: 'p', uid: `u${i}`, role: 'Editor' }) }));
    return { calls, gates, reads, membership, calendar, docs, resolve: () => service.resolve({ tx, actorUid: 'u0', projectId: 'p', selectedTaskIds: [], access: {} }) };
}
test('reads overlap and member calls run in settled chunks of four with deterministic DTO', async () => {
    const f = fixture(); const pending = f.resolve(); await tick();
    assert.deepEqual(f.reads, ['crmProjectMembers', 'crmProjectOrganizationConfig/calendar']);
    f.membership.resolve({ docs: f.docs }); f.calendar.resolve({ exists: false }); await tick(); assert.equal(f.calls.length, 4);
    f.gates[3].resolve({ uid: 'u3', profile: { displayName: 'Same' } }); await tick(); assert.equal(f.calls.length, 4);
    for (const i of [2, 1, 0]) f.gates[i].resolve({ uid: `u${i}`, profile: { displayName: 'Same' } });
    await tick(); assert.equal(f.calls.length, 8);
    for (const i of [7, 6, 5, 4]) f.gates[i].resolve({ uid: `u${i}`, profile: { displayName: 'Same' } });
    await tick(); assert.equal(f.calls.length, 9); f.gates[8].resolve({ uid: 'u8', profile: { displayName: 'Same' } });
    f.calendar.resolve({ exists: false });
    const result = await pending;
    assert.deepEqual(result.people, { members: Array.from({ length: 9 }, (_, i) => ({ uid: `u${i}`, displayName: 'Same', role: 'Editor' })), incomplete: false });
    assert.deepEqual(result.discussions, []); assert.deepEqual(result.linkedRecords, { project: [], tasks: [] });
});
test('people error order beats completion order and a handled calendar rejection', async () => {
    for (const invalid of [false, true]) {
        const f = fixture(5); const pending = f.resolve(); const first = new Error('first');
        const check = assert.rejects(pending, error => invalid ? error.code === 'INVALID_CONTEXT_IDENTITY' : error === first);
        f.calendar.reject(new Error('calendar')); f.membership.resolve({ docs: f.docs }); await tick();
        f.gates[3].reject(new Error('last')); f.gates[2].reject(new Error('second'));
        f.gates[1].reject(Object.assign(new Error('revoked'), { code: 'REVOKED_TOKEN' }));
        if (invalid) f.gates[0].resolve({ uid: 'wrong' }); else f.gates[0].reject(first);
        await check; assert.equal(f.calls.length, 4);
    }
});
test('membership read error precedes calendar error without unhandled rejection', async () => {
    const f = fixture(); const pending = f.resolve(); const error = new Error('membership'); const check = assert.rejects(pending, e => e === error);
    let finished = false; pending.catch(() => { finished = true; });
    f.membership.reject(error); await tick(); assert.equal(finished, false);
    f.calendar.reject(new Error('calendar')); await check; assert.equal(f.calls.length, 0);
});
test('access independent reads overlap, preserve error order and refresh identity on repeated transactions', async () => {
    let authCalls = 0; const reads = []; let gates;
    const service = createProjectsAccessService({ db, verifyIdToken: async () => ({}), getAuthUser: async uid => { authCalls++; return { uid }; } });
    const tx = { async get(query) {
        reads.push(query.path);
        if (query.path === 'users/u') return { exists: true, data: () => ({}) };
        if (query.path === 'crmWorkforceAccounts/u') return { exists: true, data: () => ({ status: 'active', moduleGrants: { projects: true } }) };
        return query.path === 'crmProjects/p' ? gates[0].promise : gates[1].promise;
    } };
    for (const mode of ['errors', 'viewer', 'success', 'missing', 'malformed']) {
        gates = [deferred(), deferred()]; const before = reads.length;
        const pending = service.assertTransactionContentAccess(tx, 'u', 'p', { write: true });
        const projectError = new Error('project');
        const check = mode === 'errors' ? assert.rejects(pending, e => e === projectError) : mode === 'viewer' ? assert.rejects(pending, { code: 'PROJECT_WRITE_FORBIDDEN' }) : mode !== 'success' ? assert.rejects(pending, { code: 'PROJECT_NOT_FOUND' }) : pending;
        await tick(); assert.deepEqual(reads.slice(before), ['users/u', 'crmWorkforceAccounts/u', 'crmProjects/p', `crmProjectMembers/${memberDocumentId('p', 'u')}`]);
        if (mode === 'errors') { gates[1].reject(new Error('member')); gates[0].reject(projectError); }
        else { gates[0].resolve({ exists: mode !== 'missing', data: () => ({ title: 'Project' }) }); gates[1].resolve({ exists: true, id: mode === 'malformed' ? 'forged' : memberDocumentId('p', 'u'), data: () => ({ projectId: 'p', uid: 'u', role: mode === 'viewer' ? 'Viewer' : 'Editor' }) }); }
        const result = await check; if (mode === 'success') assert.equal(result.role, 'Editor');
    }
    assert.equal(authCalls, 5);
});

test('malformed document errors are not mistaken for eligibility denials', async () => {
    const f = fixture(1); const error = Object.assign(new Error('malformed data'), { code: 'REVOKED_TOKEN' });
    f.docs[0].data = () => { throw error; };
    const pending = f.resolve(); const check = assert.rejects(pending, e => e === error);
    f.membership.resolve({ docs: f.docs }); f.calendar.resolve({ exists: false }); await check;
    assert.equal(f.calls.length, 0);
});
