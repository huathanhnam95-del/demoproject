const assert = require('node:assert/strict');
const test = require('node:test');

const {
    SchedulingOperationError,
    executeSchedulingOperation,
    fingerprintSchedulingPayload,
    schedulingReceiptId
} = require('../../functions/src/crm/scheduling-operation-service');
const {
    CRM_SCHEDULED_SESSIONS,
    CRM_SCHEDULING_OPERATION_RECEIPTS,
    CRM_TEACHER_SCHEDULE_LOCKS
} = require('../../functions/src/crm/collections');

function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

class FakeDocumentReference {
    constructor(db, collectionName, id) {
        this.db = db;
        this.collectionName = collectionName;
        this.id = id;
        this.path = `${collectionName}/${id}`;
    }

    async get() {
        return this.db.snapshot(this);
    }
}

class FakeQuery {
    constructor(db, collectionName, filters = []) {
        this.db = db;
        this.collectionName = collectionName;
        this.filters = filters;
    }

    where(field, operator, value) {
        assert.equal(operator, '==');
        return new FakeQuery(this.db, this.collectionName, this.filters.concat({ field, value }));
    }

    async get() {
        return this.db.querySnapshot(this);
    }
}

class FakeCollectionReference extends FakeQuery {
    doc(id) {
        const resolvedId = id || `auto-${++this.db.autoId}`;
        return new FakeDocumentReference(this.db, this.collectionName, resolvedId);
    }
}

class FakeTransaction {
    constructor(db) {
        this.db = db;
        this.writes = [];
    }

    async get(target) {
        if (target instanceof FakeDocumentReference) return this.db.snapshot(target);
        if (target instanceof FakeQuery) return this.db.querySnapshot(target);
        throw new TypeError('Unsupported transaction read target.');
    }

    set(ref, data, options = {}) {
        this.writes.push({ ref, data: clone(data), merge: options.merge === true });
        return this;
    }

    commit() {
        for (const write of this.writes) {
            const before = this.db.docs.get(write.ref.path) || {};
            this.db.docs.set(write.ref.path, write.merge
                ? { ...clone(before), ...clone(write.data) }
                : clone(write.data));
        }
    }
}

class FakeFirestore {
    constructor() {
        this.docs = new Map();
        this.autoId = 0;
        this.queue = Promise.resolve();
    }

    collection(name) {
        return new FakeCollectionReference(this, name);
    }

    snapshot(ref) {
        const value = this.docs.get(ref.path);
        return {
            id: ref.id,
            ref,
            exists: value !== undefined,
            data: () => clone(value)
        };
    }

    querySnapshot(query) {
        const prefix = `${query.collectionName}/`;
        const docs = [];
        for (const [path, data] of this.docs.entries()) {
            if (!path.startsWith(prefix) || path.slice(prefix.length).includes('/')) continue;
            const matches = query.filters.every(({ field, value }) => data?.[field] === value);
            if (!matches) continue;
            const id = path.slice(prefix.length);
            docs.push({
                id,
                ref: new FakeDocumentReference(this, query.collectionName, id),
                data: () => clone(data)
            });
        }
        return { docs, empty: docs.length === 0, size: docs.length };
    }

    async runTransaction(callback) {
        const previous = this.queue;
        let release;
        this.queue = new Promise((resolve) => { release = resolve; });
        await previous;
        try {
            const transaction = new FakeTransaction(this);
            const result = await callback(transaction);
            transaction.commit();
            return result;
        } finally {
            release();
        }
    }
}

function operationOptions(db, overrides = {}) {
    const sessionRef = db.collection(CRM_SCHEDULED_SESSIONS).doc('session-1');
    return {
        db,
        operationId: 'sched_test_operation_0001',
        actorUid: 'teacher-1',
        operationType: 'teacher.session.add',
        payload: {
            classId: 'class-1',
            targetLocalDate: '2026-09-21',
            targetLocalTime: '09:00'
        },
        serverTimestamp: () => 'SERVER_TIME',
        prepare: async () => ({
            teacherUids: ['teacher-1'],
            state: { sessionRef }
        }),
        commit: async ({ tx, state, teacherSessionsByUid }) => {
            assert.deepEqual(teacherSessionsByUid.get('teacher-1'), []);
            tx.set(state.sessionRef, {
                classId: 'class-1',
                teacherUid: 'teacher-1',
                status: 'scheduled',
                scheduledStartAtUtc: '2026-09-21T02:00:00.000Z',
                scheduledEndAtUtc: '2026-09-21T03:00:00.000Z'
            });
            return {
                committedIds: [state.sessionRef.id],
                result: { sessionId: state.sessionRef.id }
            };
        },
        ...overrides
    };
}

test('canonical payload fingerprints ignore object key order but preserve array order', () => {
    const left = fingerprintSchedulingPayload('teacher.session.add', {
        b: 2,
        a: { y: ['first', 'second'], x: true }
    });
    const right = fingerprintSchedulingPayload('teacher.session.add', {
        a: { x: true, y: ['first', 'second'] },
        b: 2
    });
    const reorderedArray = fingerprintSchedulingPayload('teacher.session.add', {
        a: { x: true, y: ['second', 'first'] },
        b: 2
    });

    assert.equal(left, right);
    assert.notEqual(left, reorderedArray);
});

test('commits the booking, teacher revision, and durable authoritative receipt atomically', async () => {
    const db = new FakeFirestore();

    const outcome = await executeSchedulingOperation(operationOptions(db));

    assert.deepEqual(outcome, {
        operationId: 'sched_test_operation_0001',
        idempotentReplay: false,
        sessionId: 'session-1'
    });
    assert.equal(db.docs.get(`${CRM_SCHEDULED_SESSIONS}/session-1`).teacherUid, 'teacher-1');

    const lockDocs = [...db.docs.entries()].filter(([path]) => path.startsWith(`${CRM_TEACHER_SCHEDULE_LOCKS}/`));
    assert.equal(lockDocs.length, 1);
    assert.equal(lockDocs[0][1].teacherUid, 'teacher-1');
    assert.equal(lockDocs[0][1].revision, 1);

    const receipt = db.docs.get(`${CRM_SCHEDULING_OPERATION_RECEIPTS}/${schedulingReceiptId('sched_test_operation_0001')}`);
    assert.equal(receipt.actorUid, 'teacher-1');
    assert.equal(receipt.operationType, 'teacher.session.add');
    assert.equal(receipt.status, 'committed');
    assert.deepEqual(receipt.committedIds, ['session-1']);
    assert.deepEqual(receipt.authoritativeResult, { sessionId: 'session-1' });
    assert.equal(receipt.createdAt, 'SERVER_TIME');
    assert.equal(receipt.committedAt, 'SERVER_TIME');
    assert.equal(receipt.updatedAt, 'SERVER_TIME');
});

test('stores concrete receipt timestamps instead of nested Firestore transforms', async () => {
    class ServerTimestampTransform {}
    const db = new FakeFirestore();
    const outcome = await executeSchedulingOperation(operationOptions(db, {
        commit: async ({ tx, state }) => {
            tx.set(state.sessionRef, { teacherUid: 'teacher-1' });
            return {
                committedIds: ['session-1'],
                result: {
                    sessionId: 'session-1',
                    session: { createdAt: new ServerTimestampTransform() }
                }
            };
        }
    }));

    assert.match(outcome.session.createdAt, /^\d{4}-\d{2}-\d{2}T/);
    const receipt = db.docs.get(`${CRM_SCHEDULING_OPERATION_RECEIPTS}/${schedulingReceiptId('sched_test_operation_0001')}`);
    assert.match(receipt.authoritativeResult.session.createdAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('same actor, operation id, and payload replays the receipt without running preparation or writes', async () => {
    const db = new FakeFirestore();
    await executeSchedulingOperation(operationOptions(db));
    let prepareCalls = 0;
    let commitCalls = 0;

    const replay = await executeSchedulingOperation(operationOptions(db, {
        prepare: async () => {
            prepareCalls += 1;
            throw new Error('prepare must not run for a committed replay');
        },
        commit: async () => {
            commitCalls += 1;
            throw new Error('commit must not run for a committed replay');
        }
    }));

    assert.deepEqual(replay, {
        operationId: 'sched_test_operation_0001',
        idempotentReplay: true,
        sessionId: 'session-1'
    });
    assert.equal(prepareCalls, 0);
    assert.equal(commitCalls, 0);
});

test('same operation id with a changed payload conflicts', async () => {
    const db = new FakeFirestore();
    await executeSchedulingOperation(operationOptions(db));

    await assert.rejects(
        executeSchedulingOperation(operationOptions(db, {
            payload: {
                classId: 'class-1',
                targetLocalDate: '2026-09-21',
                targetLocalTime: '10:00'
            }
        })),
        (error) => error instanceof SchedulingOperationError
            && error.status === 409
            && error.code === 'OPERATION_ID_PAYLOAD_MISMATCH'
    );
});

test('same operation id from a different actor is rejected', async () => {
    const db = new FakeFirestore();
    await executeSchedulingOperation(operationOptions(db));

    await assert.rejects(
        executeSchedulingOperation(operationOptions(db, { actorUid: 'teacher-2' })),
        (error) => error instanceof SchedulingOperationError
            && error.status === 403
            && error.code === 'OPERATION_ID_ACTOR_MISMATCH'
    );
});

test('per-teacher serialization prevents two concurrent overlapping bookings from both committing', async () => {
    const db = new FakeFirestore();

    async function book(operationId, sessionId) {
        const sessionRef = db.collection(CRM_SCHEDULED_SESSIONS).doc(sessionId);
        return executeSchedulingOperation(operationOptions(db, {
            operationId,
            payload: { sessionId, start: '2026-09-21T02:00:00.000Z' },
            prepare: async () => ({ teacherUids: ['teacher-1'], state: { sessionRef } }),
            commit: async ({ tx, state, teacherSessionsByUid }) => {
                if (teacherSessionsByUid.get('teacher-1').length) {
                    throw new SchedulingOperationError(409, 'TEACHER_CONFLICT', 'Teacher conflict.');
                }
                tx.set(state.sessionRef, {
                    classId: sessionId,
                    teacherUid: 'teacher-1',
                    status: 'scheduled',
                    scheduledStartAtUtc: '2026-09-21T02:00:00.000Z',
                    scheduledEndAtUtc: '2026-09-21T03:00:00.000Z'
                });
                return { committedIds: [sessionId], result: { sessionId } };
            }
        }));
    }

    const results = await Promise.allSettled([
        book('sched_concurrent_operation_a', 'session-a'),
        book('sched_concurrent_operation_b', 'session-b')
    ]);

    assert.equal(results.filter((entry) => entry.status === 'fulfilled').length, 1);
    assert.equal(results.filter((entry) => entry.status === 'rejected').length, 1);
    assert.equal([...db.docs.keys()].filter((path) => path.startsWith(`${CRM_SCHEDULED_SESSIONS}/`)).length, 1);
});
