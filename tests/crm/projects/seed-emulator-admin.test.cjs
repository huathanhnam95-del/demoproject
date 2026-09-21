const assert = require('node:assert/strict');
const { test } = require('node:test');
const { seedProjectsWorkforceAccess } = require('../../../scripts/seed-emulator-admin.js');

const uid = 'local-admin';
const docUrl = `http://127.0.0.1:8080/v1/projects/listening-tasks-3ae34/databases/(default)/documents/crmWorkforceAccounts/${uid}`;
const reply = (status, data) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
const compatible = () => ({
  fields: {
    status: { stringValue: 'active' },
    moduleGrants: { mapValue: { fields: { projects: { booleanValue: true }, other: { booleanValue: false } } } },
    authSync: { mapValue: { fields: { state: { stringValue: 'succeeded' }, operationId: { stringValue: 'retain' } } } },
    organizationRole: { stringValue: 'teacher' },
    revision: { integerValue: '37' },
    audit: { mapValue: { fields: { note: { stringValue: 'retain exactly' } } } }
  },
  updateTime: '2026-09-20T00:00:00Z'
});

function mockRequests(t, responses) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, ...options });
    assert.ok(responses.length, 'unexpected request (real network is never used)');
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return typeof next === 'function' ? next(url, options) : next;
  });
  return calls;
}

test('missing workforce record is created with defaults and an atomic absence precondition', async (t) => {
  const calls = mockRequests(t, [reply(404), reply(200)]);
  await seedProjectsWorkforceAccess({ uid });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].url, docUrl);
  assert.equal(calls[0].headers.Authorization, 'Bearer owner');
  assert.equal(calls[1].method, 'PATCH');
  assert.equal(calls[1].url, `${docUrl}?currentDocument.exists=false`);
  assert.equal(calls[1].headers.Authorization, 'Bearer owner');
  const { fields } = JSON.parse(calls[1].body);
  assert.deepEqual(fields, {
    uid: { stringValue: uid }, status: { stringValue: 'active' },
    organizationRole: { stringValue: 'administrator' }, isOrganizationAdmin: { booleanValue: true },
    moduleGrants: { mapValue: { fields: { projects: { booleanValue: true } } } },
    authSync: { mapValue: { fields: { state: { stringValue: 'succeeded' }, reconciled: { booleanValue: true } } } },
    revision: { integerValue: '1' }
  });
});

for (const withSync of [true, false]) {
  test(`compatible existing record is preserved exactly (authSync present: ${withSync})`, async (t) => {
    const doc = compatible();
    if (!withSync) delete doc.fields.authSync;
    doc.fields.status.stringValue = ' Active ';
    const before = structuredClone(doc);
    const calls = mockRequests(t, [reply(200, doc)]);
    await seedProjectsWorkforceAccess({ uid });
    assert.deepEqual(doc, before);
    assert.deepEqual(calls.map(c => c.method), ['GET']);
  });
}

const incompatible = {
  suspended: d => { d.fields.status.stringValue = 'suspended'; },
  'missing status': d => { delete d.fields.status; },
  'revoked grant': d => { d.fields.moduleGrants.mapValue.fields.projects.booleanValue = false; },
  'string grant': d => { d.fields.moduleGrants.mapValue.fields.projects = { stringValue: 'true' }; },
  'missing grant': d => { delete d.fields.moduleGrants; },
  'pending sync': d => { d.fields.authSync.mapValue.fields.state.stringValue = 'pending'; },
  'malformed sync': d => { d.fields.authSync = { stringValue: 'succeeded' }; },
  'missing fields': d => { delete d.fields; }
};
for (const [label, change] of Object.entries(incompatible)) {
  test(`incompatible existing record fails without any write: ${label}`, async (t) => {
    const doc = compatible();
    change(doc);
    const before = structuredClone(doc);
    const calls = mockRequests(t, [reply(200, doc)]);
    await assert.rejects(seedProjectsWorkforceAccess({ uid }), /Review its status, Projects grant, and auth sync.*not changed/);
    assert.deepEqual(doc, before);
    assert.deepEqual(calls.map(c => c.method), ['GET']);
  });
}

for (const status of [409, 412]) {
  test(`concurrent creation is protected and reported (${status})`, async (t) => {
    let stored = null;
    const winner = compatible();
    const calls = mockRequests(t, [reply(404), (url, options) => {
      // Another client creates the record between our GET and PATCH.
      stored = structuredClone(winner);
      if (new URL(url).searchParams.get('currentDocument.exists') === 'false') return reply(status);
      stored = JSON.parse(options.body);
      return reply(200, stored);
    }]);
    await assert.rejects(seedProjectsWorkforceAccess({ uid }), /conflicted.*Rerun.*not overwritten/);
    assert.deepEqual(stored, winner);
    assert.deepEqual(calls.map(c => c.method), ['GET', 'PATCH']);
  });
}

for (const status of [401, 403, 500]) {
  test(`failed read ${status} never writes`, async (t) => {
    const calls = mockRequests(t, [reply(status)]);
    await assert.rejects(seedProjectsWorkforceAccess({ uid }), /read failed.*no workforce write/);
    assert.equal(calls.length, 1);
  });
}

test('failed creation does not retry or fall back to an unconditional write', async (t) => {
  const calls = mockRequests(t, [reply(404), reply(500)]);
  await assert.rejects(seedProjectsWorkforceAccess({ uid }), /creation failed \(500\)/);
  assert.equal(calls.length, 2);
});

for (const phase of ['read', 'write', 'decode']) {
  test(`${phase} failure propagates without fallback writes`, async (t) => {
    const failure = new Error(`${phase} unavailable`);
    const responses = phase === 'write' ? [reply(404), failure]
      : phase === 'decode' ? [{ ok: true, status: 200, json: async () => { throw failure; } }]
        : [failure];
    const calls = mockRequests(t, responses);
    await assert.rejects(seedProjectsWorkforceAccess({ uid }), failure);
    assert.equal(calls.length, phase === 'write' ? 2 : 1);
  });
}
