'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createContextService, parseCalendarDate } = require('../../../functions/src/crm/data-input/context-service');

function fixture(records = []) {
    const state = { allowed: true, deniedIds: new Set(), reads: 0, authCalls: 0, queries: [] };
    const snapshot = row => ({ id: row.id, exists: true, data: () => row.data, updateTime: { seconds: 123, nanoseconds: row.nano || 7 } });
    const db = { collection(name) {
        return {
            doc(id) { return { async get() {
                state.reads++;
                const row = records.find(r => r.collection === name && r.id === id);
                return row ? snapshot(row) : { id, exists: false };
            } }; },
            where(field, operator, value) { return { limit(count) { return { async get() {
                state.reads++; state.queries.push({ name, field, operator, value, count });
                return { docs: records.filter(r => r.collection === name && r.data[field] === value).slice(0, count).map(snapshot) };
            } }; } }; }
        };
    } };
    const service = createContextService({ db,
        authorize: async ({ actorUid }) => { state.authCalls++; return actorUid === 'staff-1' && state.allowed; },
        authorizeRecord: async ({ id }) => !state.deniedIds.has(id)
    });
    return { service, state };
}
const student = (id, data = {}, nano) => ({ collection: 'crmStudents', id, data: { name: 'Lan', ...data }, nano });
const request = { actorUid: 'staff-1', kind: 'student', id: 's1' };

test('student contact context retains complete allowed entries and marks incomplete groups', async () => {
    const contacts = { guardians: [{ name: 'Mai', phone: '123', email: null, secret: 'hidden' }], companies: [{ name: 'Company' }] };
    const { service } = fixture([student('s1', { contacts })]);
    const record = (await service.resolve(request)).record;
    assert.deepEqual(record.values.contacts, { guardians: [{ name: 'Mai', phone: '123', email: null }], companies: [{ name: 'Company' }] });
    assert.deepEqual(record.truncatedFields, []);
    contacts.guardians = Array.from({ length: 21 }, () => ({ name: 'Guardian' }));
    contacts.companies = [{ name: 'x'.repeat(8001) }];
    const limited = (await service.resolve(request)).record;
    assert.equal(limited.values.contacts.guardians.length, 20);
    assert.ok(limited.truncatedFields.includes('contacts.guardians'));
    assert.ok(limited.truncatedFields.some(field => field.startsWith('contacts.companies')));
});

test('agent source search offers active identities without rates; historical ID lookup retains status', async () => {
    const { service } = fixture([
        { collection: 'crmAgentSources', id: 'active', data: { name: 'Agency', status: 'active', notes: 'private', courseRates: { course: 1000 } } },
        { collection: 'crmAgentSources', id: 'inactive', data: { name: 'Agency', status: 'inactive' } }
    ]);
    const result = await service.resolve({ actorUid: 'staff-1', kind: 'agentSource', match: { field: 'name', value: 'Agency' } });
    assert.equal(result.status, 'resolved'); assert.equal(result.record.id, 'active');
    assert.deepEqual(result.record.values, { name: 'Agency', status: 'active' });
    assert.equal((await service.resolve({ actorUid: 'staff-1', kind: 'agentSource', id: 'inactive' })).record.values.status, 'inactive');
});

test('teacher context filters user roles and disabled accounts and exposes only identity', async () => {
    const rows = [
        { id: 't1', data: { displayName: 'Lan', email: 'teacher@example.test', isTeacher: true, token: 'secret', phone: 'private' } },
        { id: 't2', data: { displayName: 'Lan', name: 'Lan Nguyen', crmRole: 'teacher' } },
        { id: 'student', data: { displayName: 'Lan', isStudent: true } },
        { id: 'disabled', data: { displayName: 'Lan', isTeacher: true, disabled: true } },
        { id: 'deleted', data: { displayName: 'Lan', isTeacher: true, deletedAt: 123 } }
    ].map(row => ({ collection: 'users', ...row }));
    const { service, state } = fixture(rows);
    const query = { actorUid: 'staff-1', kind: 'teacher', match: { field: 'displayName', value: 'Lan' } };
    const result = await service.resolve(query);
    assert.equal(result.status, 'ambiguous');
    assert.deepEqual(result.candidates.map(record => record.id), ['t1', 't2']);
    assert.deepEqual(result.candidates[0].values, { displayName: 'Lan', email: 'teacher@example.test' });
    assert.equal(state.queries[0].count, 21);
    assert.equal((await service.resolve({ actorUid: 'staff-1', kind: 'teacher', id: 'student' })).status, 'not_found');
    assert.equal((await service.resolve({ actorUid: 'staff-1', kind: 'teacher', match: { field: 'email', value: 'teacher@example.test' } })).record.id, 't1');
    rows[0].data.isTeacher = false;
    assert.equal((await service.resolve({ actorUid: 'staff-1', kind: 'teacher', id: 't1' })).status, 'not_found');
    state.deniedIds.add('t2');
    assert.equal((await service.resolve(query)).status, 'not_found');
});

test('teacher searches cannot infer a unique teacher from a truncated user match', async () => {
    const rows = Array.from({ length: 22 }, (_, i) => ({ collection: 'users', id: `u${i}`, data: { name: 'Lan', isTeacher: i === 0 || i === 21 } }));
    const { service } = fixture(rows);
    const result = await service.resolve({ actorUid: 'staff-1', kind: 'teacher', match: { field: 'name', value: 'Lan' } });
    assert.equal(result.status, 'refine_query');
    assert.equal(result.candidates.length, 1);
    assert.equal(result.record, undefined);
});

test('context authorization is fresh for every request and precedes database reads', async () => {
    const { service, state } = fixture([student('s1')]);
    assert.equal((await service.resolve(request)).status, 'resolved');
    state.allowed = false;
    await assert.rejects(service.resolve(request), error => error.code === 'FORBIDDEN');
    assert.equal(state.authCalls, 2);
    assert.equal(state.reads, 1);
});

test('inaccessible and nonexistent records are indistinguishable', async () => {
    const { service, state } = fixture([student('s1', { email: 'private@example.test' })]);
    state.deniedIds.add('s1');
    const denied = await service.resolve(request);
    const missing = await service.resolve({ ...request, id: 'absent' });
    assert.deepEqual(denied, missing);
    assert.deepEqual(denied, { status: 'not_found', candidates: [] });
});

test('duplicate matches require selection and a selected record is authorized again', async () => {
    const { service, state } = fixture([student('s2'), student('s1')]);
    const result = await service.resolve({ actorUid: 'staff-1', kind: 'student', match: { field: 'name', value: 'Lan' } });
    assert.equal(result.status, 'ambiguous');
    assert.deepEqual(result.candidates.map(c => c.id), ['s1', 's2']);
    assert.equal(result.record, undefined);
    state.deniedIds.add('s1');
    assert.equal((await service.resolve(request)).status, 'not_found');
});

test('context exposes allowlisted data and exact versions without authority or instruction fields', async () => {
    const { service } = fixture([student('s1', { email: 'lan@example.test', isAdmin: true, token: 'private',
        notes: 'An untrusted record note', learningProfile: { overall: 60, systemPrompt: 'untrusted' },
        targets: { exam: 'PTE', score: 79, secret: 'private' } }, 123456789)]);
    const { record } = await service.resolve(request);
    assert.deepEqual(record.version, { seconds: 123, nanoseconds: 123456789 });
    assert.equal(record.trust, 'untrusted-record-data');
    assert.deepEqual(record.values, { name: 'Lan', email: 'lan@example.test', notes: 'An untrusted record note', learningProfile: { overall: 60 }, targets: { exam: 'PTE', score: 79 } });
    assert.equal(record.values.isAdmin, undefined);
    assert.equal(record.values.token, undefined);
});

test('a bounded search never treats a partial result as a unique match', async () => {
    const rows = Array.from({ length: 23 }, (_, i) => student(`s${i}`));
    const { service, state } = fixture(rows);
    for (let i = 1; i < 23; i++) state.deniedIds.add(`s${i}`);
    const result = await service.resolve({ actorUid: 'staff-1', kind: 'student', match: { field: 'name', value: 'Lan' } });
    assert.equal(result.status, 'refine_query');
    assert.equal(result.record, undefined);
    assert.equal(result.candidates.length, 1);
    assert.equal(state.queries[0].count, 21);
});

test('lookup rejects injected collection, operators, malformed identity and empty queries', async () => {
    const { service, state } = fixture();
    for (const input of [
        { ...request, kind: 'users' }, { ...request, id: '../s1' },
        { ...request, actorUid: 123 }, { ...request, kind: ['student'] },
        { ...request, collection: 'users' },
        { actorUid: 'staff-1', kind: 'student', match: { field: 'isAdmin', value: 'true' } },
        { actorUid: 'staff-1', kind: 'student', match: { field: 'name', value: ' ' } },
        { actorUid: 'staff-1', kind: 'student', match: { field: 'name', value: 'Lan', operator: '!=' } },
        { ...request, match: { field: 'name', value: 'Lan' } }
    ]) await assert.rejects(service.resolve(input), error => error.code === 'INVALID_LOOKUP');
    assert.equal(state.reads, 0);
});

test('long note excerpts are marked and never passed off as complete record context', async () => {
    const { service } = fixture([student('s1', { notes: 'x'.repeat(10000) })]);
    const { record } = await service.resolve(request);
    assert.equal(record.values.notes.length, 8000);
    assert.deepEqual(record.truncatedFields, ['notes']);
});

test('calendar dates require an explicit unambiguous valid day without timezone shifting', () => {
    assert.deepEqual(parseCalendarDate('2028-02-29'), { status: 'resolved', value: '2028-02-29' });
    for (const input of ['03/04/2026', 'tomorrow', '2026-02-29', '2026-04-31', '2026-13-01', '', null, '2026-09-07T00:00:00Z']) {
        assert.equal(parseCalendarDate(input).status, 'needs_clarification');
    }
    assert.equal(parseCalendarDate('2026-09-07').value, '2026-09-07');
});
