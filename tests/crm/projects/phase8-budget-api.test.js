'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const http = require('node:http');
const createRouter = require('../../../functions/src/routes/crm/projects');
const { createProjectsAccessService } = require('../../../functions/src/crm/projects/access-service');

function fixture() {
    const records = new Map();
    const snapshot = p => ({ id: p.split('/').pop(), exists: records.has(p), data: () => structuredClone(records.get(p)) });
    const doc = p => ({ path: p, get: async () => snapshot(p) });
    const collection = (p, filters = [], after = '', size = 100) => ({
        doc: id => doc(`${p}/${id}`), where: (key, op, value) => { assert.equal(op, '=='); return collection(p, [...filters, [key, value]], after, size); },
        orderBy: key => { assert.equal(key, '__name__'); return collection(p, filters, after, size); },
        startAfter: id => collection(p, filters, id, size), limit: n => collection(p, filters, after, n),
        async get() { return { docs: [...records.keys()].filter(k => k.startsWith(`${p}/`) && k.split('/').length === 2 && k.split('/').pop() > after && filters.every(([key, value]) => records.get(k)[key] === value)).sort().slice(0, size).map(snapshot) }; }
    });
    const db = { collection, async runTransaction(fn) { const writes = []; const result = await fn({ get: ref => ref.get(), set: (ref, data, opts) => writes.push(() => records.set(ref.path, opts?.merge ? { ...records.get(ref.path), ...data } : data)) }); writes.forEach(fn => fn()); return result; } };
    for (const uid of ['admin', 'staff', 'other', 'student', 'revoked']) {
        records.set(`users/${uid}`, { accountStatus: 'active', ...(uid === 'student' ? { role: 'student' } : {}) });
        records.set(`crmWorkforceAccounts/${uid}`, { status: 'active', moduleGrants: { projects: uid !== 'revoked' }, ...(uid === 'admin' ? { organizationRole: 'admin' } : {}) });
    }
    const auth = { verifyIdToken: async token => { if (!records.has(`users/${token}`)) throw Error('invalid'); return { uid: token }; }, getUser: async uid => ({ uid, disabled: false }) };
    return { records, db, auth, service: createProjectsAccessService({ db, auth }) };
}

test('current-user budget routes enforce authentication, staff access and bounded queries', async () => {
    const previous = process.env.CRM_PROJECTS_ENABLED; process.env.CRM_PROJECTS_ENABLED = 'true';
    const f = fixture(); const app = express(); app.use(express.json()); app.use('/api/projects', createRouter({ db: f.db, auth: f.auth, accessService: f.service }));
    const server = http.createServer(app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    async function request(route, uid = 'staff') { const r = await fetch(`http://127.0.0.1:${server.address().port}/api/projects${route}`, { headers: uid ? { Authorization: `Bearer ${uid}` } : {} }); return { status: r.status, body: await r.json(), cache: r.headers.get('cache-control') }; }
    try {
        const valid = await request('/budget'); assert.equal(valid.status, 200); assert.equal(valid.body.budget.uid, 'staff'); assert.equal(valid.body.budget.allowanceNano, '5000000000'); assert.equal(valid.body.budget.paidDispatchAvailable, false); assert.equal(valid.cache, 'no-store');
        assert.equal((await request('/budget', '')).status, 401);
        for (const uid of ['student', 'revoked']) for (const route of ['/budget', '/budget/reservations']) assert.equal((await request(route, uid)).status, 403);
        for (const route of ['/budget?uid=other', '/budget?price=1', '/budget/reservations?uid=other', '/budget/reservations?pageSize=51', '/budget/reservations?pageSize=0', '/budget/reservations?pageSize=1&pageSize=2', '/budget/reservations?pageSize=1.5', '/budget/reservations?cursor=', `/budget/reservations?cursor=${'x'.repeat(1025)}`, '/budget/reservations?cursor=not-a-valid-cursor']) assert.equal((await request(route)).status, 400, route);
        const list = await request('/budget/reservations?pageSize=50'); assert.equal(list.status, 200); assert.deepEqual(list.body.items, []); assert.equal(list.body.nextCursor, null);
        for (const [id, uid, feature] of [['a', 'staff', 'projects'], ['b', 'other', 'projects'], ['c', 'staff', 'data-input']]) f.records.set(`crmAiBudgetReservations/${id}`, { reservationId: id, uid, feature, pricing: { versionId: 'v1' }, prompt: 'private prompt', providerEvidence: 'private provider record' });
        const first = await request('/budget/reservations?pageSize=1'); assert.equal(first.body.items[0].reservationId, 'a'); assert.equal(first.body.hasMore, true); assert.ok(first.body.nextCursor);
        assert.equal((await request(`/budget/reservations?cursor=${first.body.nextCursor}`, 'other')).status, 400);
        const last = await request(`/budget/reservations?pageSize=1&cursor=${first.body.nextCursor}`); assert.deepEqual(last.body.items.map(x => x.reservationId), ['c']); assert.equal(last.body.hasMore, false); assert.equal(last.body.nextCursor, null);
        assert.ok(!JSON.stringify([first.body, last.body]).includes('private'));

    } finally { await new Promise(resolve => server.close(resolve)); if (previous === undefined) delete process.env.CRM_PROJECTS_ENABLED; else process.env.CRM_PROJECTS_ENABLED = previous; }
});

test('allowance cap includes zero, keeps obligations and preserves optimistic revision', async () => {
    const f = fixture(); const identity = await f.service.authenticateRequest({ headers: { authorization: 'Bearer admin' } });
    f.records.set('crmAiBudgetLedgers/existing', { settledNano: '4000000000', pendingNano: '1000000000' });
    const obligations = structuredClone(f.records.get('crmAiBudgetLedgers/existing'));
    for (const uid of [null, 'staff']) {
        for (const cents of [501, 100000000, -1, 1.5, null, true]) await assert.rejects(f.service.updateAllowanceConfig(identity, { monthlyAllowanceCents: cents }, uid), e => e.code === 'INVALID_ALLOWANCE');
        assert.equal((await f.service.updateAllowanceConfig(identity, { monthlyAllowanceCents: 500, expectedRevision: 0 }, uid)).revision, 1);
        assert.equal((await f.service.updateAllowanceConfig(identity, { monthlyAllowanceCents: 0, expectedRevision: 1 }, uid)).monthlyAllowanceCents, 0);
        await assert.rejects(f.service.updateAllowanceConfig(identity, { monthlyAllowanceCents: 250, expectedRevision: 1 }, uid), e => e.code === 'STALE_REVISION');
        assert.equal((await f.service.getAllowanceConfig(identity, uid)).monthlyAllowanceCents, 0);
    }
    assert.deepEqual(f.records.get('crmAiBudgetLedgers/existing'), obligations);
});

test('shared accounting rules deny direct clients and reservation index matches UID/document ordering', () => {
    const root = path.resolve(__dirname, '../../..'); const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');
    for (const collection of ['crmAiBudgetAccounts', 'crmAiBudgetLedgers', 'crmAiBudgetReservations']) assert.match(rules, new RegExp(`match /${collection}/\\{recordId\\}\\s*\\{\\s*allow read, write: if false;\\s*\\}`));
    const indexes = JSON.parse(fs.readFileSync(path.join(root, 'firestore.indexes.json'), 'utf8')).indexes;
    assert.ok(indexes.some(index => index.collectionGroup === 'crmAiBudgetReservations' && index.queryScope === 'COLLECTION' && JSON.stringify(index.fields) === JSON.stringify([{ fieldPath: 'uid', order: 'ASCENDING' }, { fieldPath: '__name__', order: 'ASCENDING' }])));
});
