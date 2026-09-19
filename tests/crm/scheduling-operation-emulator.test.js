const assert = require('node:assert/strict');
const test = require('node:test');

const { FieldValue, Firestore } = require('@google-cloud/firestore');
const {
    SchedulingOperationError,
    executeSchedulingOperation,
    schedulingReceiptId,
    teacherLockId
} = require('../../functions/src/crm/scheduling-operation-service');
const {
    CRM_SCHEDULED_SESSIONS,
    CRM_SCHEDULING_OPERATION_RECEIPTS,
    CRM_TEACHER_SCHEDULE_LOCKS
} = require('../../functions/src/crm/collections');
const { sessionsOverlapUtc } = require('../../functions/src/crm/scheduling-service');

const emulatorAvailable = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

test('Firestore serializes conflicting bookings and replays the committed authoritative receipt', {
    skip: emulatorAvailable ? false : 'FIRESTORE_EMULATOR_HOST is not configured.'
}, async () => {
    const suffix = `${process.pid}-${Date.now()}`;
    const actorUid = `teacher-r9-${suffix}`;
    const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'demo-bel-r9';
    const db = new Firestore({
        projectId,
        credentials: {
            client_email: 'firestore-emulator@example.test',
            private_key: 'unused-by-firestore-emulator'
        }
    });
    const startsAt = '2026-09-21T02:00:00.000Z';
    const endsAt = '2026-09-21T03:00:00.000Z';

    function book(operationId, sessionId, teacherUid = actorUid) {
        const sessionRef = db.collection(CRM_SCHEDULED_SESSIONS).doc(sessionId);
        const payload = { sessionId, teacherUid, startsAt, endsAt };
        return executeSchedulingOperation({
            db,
            operationId,
            actorUid: teacherUid,
            operationType: 'teacher.session.add',
            payload,
            serverTimestamp: () => new Date('2026-09-19T12:00:00.000Z'),
            prepare: async () => ({ teacherUids: [teacherUid], state: { sessionRef } }),
            commit: async ({ tx, state, teacherSessionsByUid }) => {
                const proposed = {
                    sessionId,
                    classId: `class-${sessionId}`,
                    teacherUid,
                    status: 'scheduled',
                    scheduledStartAtUtc: startsAt,
                    scheduledEndAtUtc: endsAt
                };
                const conflict = (teacherSessionsByUid.get(teacherUid) || [])
                    .find((session) => sessionsOverlapUtc(session, proposed));
                if (conflict) {
                    throw new SchedulingOperationError(409, 'TEACHER_CONFLICT', 'Teacher conflict.', {
                        conflictSessionId: conflict.sessionId
                    });
                }
                tx.set(state.sessionRef, proposed);
                return {
                    committedIds: [sessionId],
                    result: { sessionId, receiptTimestamp: FieldValue.serverTimestamp() }
                };
            }
        });
    }

    try {
        const operationA = `sched_emulator_a_${suffix}`;
        const operationB = `sched_emulator_b_${suffix}`;
        const concurrent = await Promise.allSettled([
            book(operationA, `session-a-${suffix}`),
            book(operationB, `session-b-${suffix}`)
        ]);

        const fulfilled = concurrent.filter((entry) => entry.status === 'fulfilled');
        const rejected = concurrent.filter((entry) => entry.status === 'rejected');
        assert.equal(fulfilled.length, 1);
        assert.equal(rejected.length, 1);
        assert.equal(rejected[0].reason.code, 'TEACHER_CONFLICT');

        const committed = fulfilled[0].value;
        assert.equal(typeof committed.receiptTimestamp?.toDate, 'function');
        const committedOperationId = committed.sessionId.includes('session-a') ? operationA : operationB;
        const rejectedOperationId = committedOperationId === operationA ? operationB : operationA;
        const sessionsSnap = await db.collection(CRM_SCHEDULED_SESSIONS)
            .where('teacherUid', '==', actorUid)
            .get();
        assert.equal(sessionsSnap.size, 1);

        const receiptSnap = await db.collection(CRM_SCHEDULING_OPERATION_RECEIPTS)
            .doc(schedulingReceiptId(committedOperationId))
            .get();
        assert.equal(receiptSnap.exists, true);
        assert.equal(receiptSnap.data().status, 'committed');
        assert.deepEqual(receiptSnap.data().committedIds, [committed.sessionId]);

        const rejectedReceipt = await db.collection(CRM_SCHEDULING_OPERATION_RECEIPTS)
            .doc(schedulingReceiptId(rejectedOperationId))
            .get();
        assert.equal(rejectedReceipt.exists, false);

        const lockSnap = await db.collection(CRM_TEACHER_SCHEDULE_LOCKS)
            .doc(teacherLockId(actorUid))
            .get();
        assert.equal(lockSnap.data().teacherUid, actorUid);
        assert.equal(lockSnap.data().revision, 1);

        const sameKeyTeacherUid = `teacher-r9-same-key-${suffix}`;
        const sameKeyOperationId = `sched_emulator_same_key_${suffix}`;
        const sameKeySessionId = `session-same-key-${suffix}`;
        const sameKeyResults = await Promise.all([
            book(sameKeyOperationId, sameKeySessionId, sameKeyTeacherUid),
            book(sameKeyOperationId, sameKeySessionId, sameKeyTeacherUid)
        ]);
        assert.deepEqual(sameKeyResults.map((entry) => entry.sessionId), [sameKeySessionId, sameKeySessionId]);
        assert.deepEqual(sameKeyResults.map((entry) => entry.idempotentReplay).sort(), [false, true]);
        assert.equal((await db.collection(CRM_SCHEDULED_SESSIONS).where('teacherUid', '==', sameKeyTeacherUid).get()).size, 1);
        assert.equal((await db.collection(CRM_TEACHER_SCHEDULE_LOCKS).doc(teacherLockId(sameKeyTeacherUid)).get()).data().revision, 1);

        const replay = await book(committedOperationId, committed.sessionId);
        assert.equal(replay.idempotentReplay, true);
        assert.equal(replay.sessionId, committed.sessionId);
        assert.equal(replay.receiptTimestamp.toMillis(), committed.receiptTimestamp.toMillis());
        assert.equal((await db.collection(CRM_SCHEDULED_SESSIONS).where('teacherUid', '==', actorUid).get()).size, 1);

        await assert.rejects(
            executeSchedulingOperation({
                db,
                operationId: committedOperationId,
                actorUid,
                operationType: 'teacher.session.add',
                payload: { sessionId: committed.sessionId, teacherUid: actorUid, startsAt, endsAt: '2026-09-21T04:00:00.000Z' },
                prepare: async () => { throw new Error('must not prepare'); },
                commit: async () => { throw new Error('must not commit'); }
            }),
            (error) => error.code === 'OPERATION_ID_PAYLOAD_MISMATCH'
        );

        await assert.rejects(
            executeSchedulingOperation({
                db,
                operationId: committedOperationId,
                actorUid: `other-${actorUid}`,
                operationType: 'teacher.session.add',
                payload: { sessionId: committed.sessionId, teacherUid: actorUid, startsAt, endsAt },
                prepare: async () => { throw new Error('must not prepare'); },
                commit: async () => { throw new Error('must not commit'); }
            }),
            (error) => error.code === 'OPERATION_ID_ACTOR_MISMATCH'
        );
    } finally {
        await db.terminate();
    }
});
