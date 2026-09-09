'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createTransactionWorkspace } = require('../../../functions/src/crm/data-input/transaction-workspace');
const { convertLead, createEnrollment } = require('../../../functions/src/crm/workflow-write-service');

const { fixture } = require('./transaction-fixture.cjs');

/* transaction-workspace.js resolves firebase-admin from functions/node_modules, while this test
   file would resolve it from the repo root. Those are two distinct copies, so a Timestamp built
   here would fail the implementation's `instanceof Timestamp` check. Resolve from the
   implementation's own directory so both sides share one class. */
const { Timestamp } = require(require.resolve('firebase-admin/firestore', {
    paths: [require('node:path').dirname(require.resolve('../../../functions/src/crm/data-input/transaction-workspace'))]
}));

test('review before values are the original record and isolated from caller mutation', async () => {
    const f = fixture({ 'items/a': { name: 'Lan', nested: { score: 65 } } });
    await f.workspace.db.runTransaction(tx => {
        tx.set(f.workspace.db.collection('items').doc('a'), { name: 'Mai' }, { merge: true });
        tx.set(f.workspace.db.collection('items').doc('a'), { name: 'An' }, { merge: true });
        tx.set(f.workspace.db.collection('items').doc('b'), { name: 'New' });
    });
    const plan = await f.workspace.prepare();
    assert.deepEqual(plan.writes.find(write => write.path === 'items/a').before, { name: 'Lan', nested: { score: 65 } });
    assert.equal(plan.writes.find(write => write.path === 'items/b').before, null);
    plan.writes[0].before.nested.score = 0;
    assert.equal((await f.workspace.prepare()).writes[0].before.nested.score, 65);
    await f.workspace.flush();
    assert.equal(f.rows.get('items/a').name, 'An');
    assert.equal(f.rows.get('items/a').nested.score, 65);
});

test('native timestamp input and returned preview mutations cannot change staged writes', async () => {
    const timestamp = new Timestamp(123, 456789123), f = fixture();
    let written;
    f.transaction.set = (_reference, data) => { written = data; };
    await f.workspace.db.runTransaction(tx => tx.set(f.workspace.db.collection('items').doc('a'), { occurredAt: timestamp }));
    timestamp._seconds = 999;
    const plan = await f.workspace.prepare();
    assert.ok(plan.writes[0].data.occurredAt instanceof Timestamp);
    assert.equal(plan.writes[0].data.occurredAt.seconds, 123);
    assert.equal(plan.writes[0].data.occurredAt.nanoseconds, 456789123);
    plan.writes[0].data.occurredAt._seconds = 777;
    plan.writes[0].data.occurredAt._nanoseconds = 1;
    await f.workspace.flush();
    assert.equal(written.occurredAt.seconds, 123);
    assert.equal(written.occurredAt.nanoseconds, 456789123);
});

test('mutating a native timestamp returned from a staged read cannot change later reads', async () => {
    const f = fixture();
    f.transaction.get = async reference => ({ id: reference.id, exists: true, data: () => ({ occurredAt: new Timestamp(123, 456) }), updateTime: { seconds: 1, nanoseconds: 2 } });
    await f.workspace.db.runTransaction(async tx => {
        const ref = f.workspace.db.collection('items').doc('a');
        const first = (await tx.get(ref)).data(); first.occurredAt._nanoseconds = 999;
        assert.equal((await tx.get(ref)).data().occurredAt.nanoseconds, 456);
    });
});

test('an arbitrary toMillis method is not accepted as a timestamp value', async () => {
    const f = fixture();
    const impostor = { toMillis() { return 123; }, mutable: 1 };
    await assert.rejects(f.workspace.db.runTransaction(tx => tx.set(f.workspace.db.collection('items').doc('a'), { timestamp: impostor })), /Unsupported value/i);
    assert.equal(f.calls.some(([kind]) => kind === 'write'), false);
});

test('canonical conversion and enrollment compose into one write-free preview', async () => {
    const f = fixture({ 'crmLeads/l1': { name: 'Lan', source: 'facebook', crmId: 'CRM000001', stage: 'new' }, 'crmClassrooms/c1': { name: 'Class', status: 'active' } });
    const context = { user: { uid: 'admin' }, serverTimestamp: () => new Date('2026-09-07T15:00:00Z') };
    const converted = await convertLead(f.workspace.db, 'l1', context);
    const enrolled = await createEnrollment(f.workspace.db, { studentId: converted.studentId, classId: 'c1' }, context);
    const plan = await f.workspace.prepare();
    assert.equal(f.calls.some(([kind]) => kind === 'write'), false);
    assert.equal(f.rows.size, 2);
    assert.ok(plan.writes.some(w => w.path === `crmStudents/${converted.studentId}`));
    await f.workspace.flush();
    assert.equal(f.rows.get('crmLeads/l1').studentId, converted.studentId);
    assert.equal(f.rows.get(`crmEnrollments/${enrolled.enrollmentId}`).studentId, converted.studentId);
    assert.equal(f.rows.get(`crmEnrollments/${enrolled.enrollmentId}`).classId, 'c1');
});

test('a later canonical validation failure leaves every business record unchanged', async () => {
    const f = fixture({ 'crmLeads/l1': { name: 'Lan', source: 'facebook', crmId: 'CRM000001', stage: 'new' } });
    const context = { user: { uid: 'admin' }, serverTimestamp: () => new Date() };
    const converted = await convertLead(f.workspace.db, 'l1', context);
    await assert.rejects(createEnrollment(f.workspace.db, { studentId: converted.studentId, classId: 'missing' }, context), /classroom/i);
    assert.equal(f.rows.size, 1);
    assert.equal(f.rows.get('crmLeads/l1').stage, 'new');
    assert.equal(f.calls.some(([kind]) => kind === 'write'), false);
    await assert.rejects(f.workspace.flush(), /failed/i);
});

test('queries include staged creates and exclude changed or deleted matches', async () => {
    const f = fixture({ 'items/a': { state: 'active', nested: { old: 1, keep: 2 } }, 'items/b': { state: 'active' } });
    await f.workspace.db.runTransaction(async tx => {
        tx.set(f.workspace.db.collection('items').doc('a'), { state: 'closed', nested: { old: 3 } }, { merge: true });
        tx.delete(f.workspace.db.collection('items').doc('b'));
        tx.set(f.workspace.db.collection('items').doc('c'), { state: 'active' });
        const result = await tx.get(f.workspace.db.collection('items').where('state', '==', 'active'));
        assert.deepEqual(result.docs.map(d => d.id), ['c']);
        const a = await tx.get(f.workspace.db.collection('items').doc('a'));
        assert.deepEqual(a.data().nested, { old: 3, keep: 2 });
    });
    const plan = await f.workspace.prepare();
    assert.ok(plan.reads.documents.some(d => d.path === 'items/c' && d.version === null));
    assert.deepEqual(plan.reads.queries[0].paths, ['items/a', 'items/b']);
});

test('preview and commit retries allocate the same generated record identities', () => {
    const f = fixture();
    const other = createTransactionWorkspace({ db: f.db, transaction: f.transaction, seed: 'draft-revision-1' });
    const a = f.workspace.db.collection('items').doc(), b = f.workspace.db.collection('items').doc();
    assert.notEqual(a.id, b.id);
    assert.equal(a.id, other.db.collection('items').doc().id);
    assert.equal(b.id, other.db.collection('items').doc().id);
});

test('prepared plans cannot be mutated or flushed twice', async () => {
    const f = fixture();
    await f.workspace.db.runTransaction(tx => tx.set(f.workspace.db.collection('items').doc('a'), { name: 'original' }));
    const plan = await f.workspace.prepare(); plan.writes[0].data.name = 'forged';
    await assert.rejects(f.workspace.db.runTransaction(tx => tx.set(f.workspace.db.collection('items').doc('b'), {})), /closed/i);
    await f.workspace.flush();
    assert.equal(f.rows.get('items/a').name, 'original');
    await assert.rejects(f.workspace.flush(), /flushed/i);
});

test('write limits and unsupported queries fail before flushing', async () => {
    const f = fixture();
    const small = createTransactionWorkspace({ db: f.db, transaction: f.transaction, seed: 'bounded', maxWrites: 1 });
    await assert.rejects(small.db.runTransaction(tx => {
        tx.set(small.db.collection('items').doc('a'), {}); tx.set(small.db.collection('items').doc('b'), {});
    }), /limit/i);
    assert.throws(() => f.workspace.db.collection('items').where('state', '!=', 'active'), /query/i);
    assert.equal(f.rows.size, 0);
});

test('teacher conflicts include lessons proposed earlier in the same conversation', async () => {
    const f = fixture({ 'crmStudents/s1': { name: 'Lan' }, 'crmStudents/s2': { name: 'Mai' },
        'crmCourses/pte': { name: 'PTE', courseType: '1on1', deliveryTemplate: { totalInstructionMinutes: 60, defaultSessionMinutes: 60, durationStepMinutes: 30, timezone: 'Asia/Ho_Chi_Minh' } } });
    const input = { studentId: 's1', courseId: 'pte', teacherUid: 't1', startDate: '2026-09-08', slots: [{ weekday: 2, startTime: '09:00', durationMinutes: 60 }] };
    const context = { user: { uid: 'admin' }, serverTimestamp: () => new Date() };
    await createEnrollment(f.workspace.db, input, context);
    await assert.rejects(createEnrollment(f.workspace.db, { ...input, studentId: 's2' }, context), error => error.code === 'TEACHER_SCHEDULE_CONFLICT');
    assert.equal(f.rows.size, 3);
    await assert.rejects(f.workspace.flush(), /failed/i);
});

test('command wrapper also invalidates the plan for validation outside a transaction callback', async () => {
    const f = fixture();
    await f.workspace.db.runTransaction(tx => tx.set(f.workspace.db.collection('items').doc('a'), { name: 'pending' }));
    await assert.rejects(f.workspace.execute(db => createEnrollment(db, { studentId: '' }, {})), /Enrollment requires/);
    await assert.rejects(f.workspace.flush(), /failed/i);
    assert.equal(f.rows.size, 0);
});
