/* eslint-disable no-console */
const assert = require('assert');
const createTeacherSchedulerRouter = require('../../functions/src/routes/teacher/scheduler');
const { CRM_CLASSROOMS, CRM_SCHEDULED_SESSIONS } = require('../../functions/src/crm/collections');

function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}

function buildRes() {
    return {
        _status: 200,
        _json: null,
        status(code) {
            this._status = code;
            return this;
        },
        json(payload) {
            this._json = payload;
            return this;
        }
    };
}

function getRouteHandlers(router, routePath, method) {
    const layer = (router.stack || []).find((entry) =>
        entry.route
        && entry.route.path === routePath
        && Array.isArray(entry.route.stack)
        && entry.route.stack.some((step) => step.method === method)
    );
    assert(layer, `Route ${routePath} not found.`);
    return (layer.route.stack || [])
        .filter((step) => step.method === method)
        .map((step) => step.handle);
}

async function invokeHandlers(handlers, req, res) {
    for (const handler of handlers) {
        if (handler.length >= 3) {
            await new Promise((resolve, reject) => {
                handler(req, res, (err) => (err ? reject(err) : resolve()));
            });
            continue;
        }

        const result = handler(req, res);
        if (result && typeof result.then === 'function') {
            await result;
        }
    }
}

function createFakeDb(initialDocs = {}) {
    const docs = new Map(Object.entries(initialDocs).map(([key, value]) => [key, clone(value)]));
    let autoId = 0;
    let transactionTail = Promise.resolve();

    function listCollectionDocs(collectionName) {
        return Array.from(docs.entries())
            .filter(([key]) => key.startsWith(`${collectionName}/`))
            .map(([key, value]) => ({
                id: key.slice(collectionName.length + 1),
                data: clone(value)
            }));
    }

    function compare(op, left, right) {
        if (op === '==') return left === right;
        if (op === '>=') return left >= right;
        if (op === '<=') return left <= right;
        throw new Error(`Unsupported operator in fake db: ${op}`);
    }

    function makeDocRef(collectionName, docId) {
        const key = `${collectionName}/${docId}`;
        return {
            id: docId,
            async get() {
                const exists = docs.has(key);
                return {
                    exists,
                    id: docId,
                    data: () => clone(docs.get(key) || null)
                };
            },
            async set(patch, options = {}) {
                const current = docs.get(key) || {};
                const next = options.merge ? { ...current, ...clone(patch) } : clone(patch);
                docs.set(key, next);
            }
        };
    }

    function makeQuery(collectionName, filters = []) {
        return {
            where(field, op, value) {
                return makeQuery(collectionName, filters.concat([{ field, op, value }]));
            },
            limit() {
                return this;
            },
            async get() {
                let rows = listCollectionDocs(collectionName);
                for (const filter of filters) {
                    rows = rows.filter((row) => compare(filter.op, row.data?.[filter.field], filter.value));
                }
                return {
                    docs: rows.map((row) => ({
                        id: row.id,
                        data: () => clone(row.data)
                    }))
                };
            }
        };
    }

    return {
        docs,
        collection(collectionName) {
            return {
                doc(docId) {
                    const resolvedId = docId || `${collectionName}-auto-${++autoId}`;
                    return makeDocRef(collectionName, resolvedId);
                },
                where(field, op, value) {
                    return makeQuery(collectionName, [{ field, op, value }]);
                },
                async get() {
                    return makeQuery(collectionName).get();
                }
            };
        },
        batch() {
            const operations = [];
            return {
                set(ref, payload, options = {}) {
                    operations.push(() => ref.set(payload, options));
                },
                async commit() {
                    for (const operation of operations) {
                        await operation();
                    }
                }
            };
        },
        async runTransaction(callback) {
            const run = transactionTail.then(async () => {
                const operations = [];
                const before = new Map([...docs].map(([key, value]) => [key, clone(value)]));
                const tx = {
                    get(ref) {
                        if (operations.length) throw new Error('Transaction reads must precede writes.');
                        return ref.get();
                    },
                    set(ref, payload, options = {}) {
                        operations.push(() => ref.set(payload, options));
                        return tx;
                    }
                };
                try {
                    const result = await callback(tx);
                    for (const operation of operations) await operation();
                    return result;
                } catch (error) {
                    docs.clear();
                    for (const [key, value] of before) docs.set(key, value);
                    throw error;
                }
            });
            transactionTail = run.catch(() => {});
            return run;
        }
    };
}

function buildTestEnvironment(initialDocs = {}) {
    const db = createFakeDb(initialDocs);
    const router = createTeacherSchedulerRouter({
        db,
        authMiddleware: (req, res, next) => next(),
        sendSuccess: (res, data, message) => res.status(200).json({ success: true, message, ...data }),
        sendError: (res, status, error, message, details) => res.status(status).json({ success: false, error, message, details }),
        serverTimestamp: () => '2026-09-09T00:00:00.000Z'
    });
    return { db, router };
}

function createClassroomDoc(classId, teacherUid = 'teacher-1', scheduleVersion = 1) {
    return {
        classroomId: classId,
        name: `Classroom ${classId}`,
        primaryTeacherUid: teacherUid,
        scheduleConfig: {
            totalInstructionMinutes: 600,
            sessionMinutes: 60,
            targetSessionCount: 10,
            scheduleVersion
        },
        scheduleSummary: {
            contractedTargetCount: 10,
            contractedScheduledCount: 3,
            remainingToScheduleCount: 7
        }
    };
}

function createSessionDoc(sessionId, classId, teacherUid, date, time, extra = {}) {
    return {
        sessionId,
        classId,
        teacherUid,
        scheduledLocalDate: date,
        scheduledLocalTime: time,
        scheduledStartAt: `${date}T${time}:00`,
        scheduledEndAt: `${date}T${time.slice(0, 2)}:50:00`,
        scheduledStartAtUtc: `${date}T${time}:00.000Z`,
        scheduledEndAtUtc: `${date}T${Number(time.slice(0, 2)) + 1}:00:00.000Z`,
        durationMinutes: 60,
        timezone: 'UTC',
        status: 'scheduled',
        sessionOutcome: 'none',
        contractCountState: 'counts',
        unitType: 'contracted',
        contractUnitIndex: 1,
        version: 1,
        ...extra
    };
}

async function runSeriesRouteTests() {
    console.log('Running teacher scheduler series route tests...');

    // 1. Happy path: reschedule series of 3 sessions
    {
        const initialDocs = {
            [`${CRM_CLASSROOMS}/class-1`]: createClassroomDoc('class-1', 'teacher-1', 1),
            [`${CRM_SCHEDULED_SESSIONS}/s1`]: createSessionDoc('s1', 'class-1', 'teacher-1', '2026-09-09', '18:00', { contractUnitIndex: 1 }),
            [`${CRM_SCHEDULED_SESSIONS}/s2`]: createSessionDoc('s2', 'class-1', 'teacher-1', '2026-09-16', '18:00', { contractUnitIndex: 2 }),
            [`${CRM_SCHEDULED_SESSIONS}/s3`]: createSessionDoc('s3', 'class-1', 'teacher-1', '2026-09-23', '18:00', { contractUnitIndex: 3 })
        };
        const { db, router } = buildTestEnvironment(initialDocs);
        const handlers = getRouteHandlers(router, '/sessions/:sessionId/reschedule-series', 'post');
        const req = {
            user: { uid: 'teacher-1' },
            teacherAccess: { isAdmin: false },
            params: { sessionId: 's1' },
            body: {
                targetLocalDate: '2026-09-10', // Thursday (+1 day)
                targetLocalTime: '19:00',
                durationMinutes: 60,
                timezone: 'UTC'
            }
        };
        const res = buildRes();
        await invokeHandlers(handlers, req, res);

        assert.strictEqual(res._status, 200, `Expected 200, got ${res._status}`);
        assert.strictEqual(res._json.success, true);
        assert.strictEqual(res._json.moved.length, 3, 'All 3 sessions should move');
        assert.strictEqual(res._json.conflicts.length, 0);

        // Verify docs in DB
        const s1 = db.docs.get(`${CRM_SCHEDULED_SESSIONS}/s1`);
        const s2 = db.docs.get(`${CRM_SCHEDULED_SESSIONS}/s2`);
        const s3 = db.docs.get(`${CRM_SCHEDULED_SESSIONS}/s3`);
        assert.strictEqual(s1.scheduledLocalDate, '2026-09-10');
        assert.strictEqual(s1.scheduledLocalTime, '19:00');
        assert.strictEqual(s1.unitType, 'contracted', 'Metadata preserved');
        assert.strictEqual(s1.contractUnitIndex, 1, 'Unit index preserved');
        assert.strictEqual(s1.version, 2, 'Version incremented');

        assert.strictEqual(s2.scheduledLocalDate, '2026-09-17');
        assert.strictEqual(s2.scheduledLocalTime, '19:00');
        assert.strictEqual(s3.scheduledLocalDate, '2026-09-24');
        assert.strictEqual(s3.scheduledLocalTime, '19:00');

        console.log('✓ Happy path series reschedule verified');
    }

    // 2. Locked skip
    {
        const initialDocs = {
            [`${CRM_CLASSROOMS}/class-1`]: createClassroomDoc('class-1', 'teacher-1', 1),
            [`${CRM_SCHEDULED_SESSIONS}/s1`]: createSessionDoc('s1', 'class-1', 'teacher-1', '2026-09-09', '18:00'),
            [`${CRM_SCHEDULED_SESSIONS}/s2`]: createSessionDoc('s2', 'class-1', 'teacher-1', '2026-09-16', '18:00', { lockState: 'hard_locked' }),
            [`${CRM_SCHEDULED_SESSIONS}/s3`]: createSessionDoc('s3', 'class-1', 'teacher-1', '2026-09-23', '18:00')
        };
        const { db, router } = buildTestEnvironment(initialDocs);
        const handlers = getRouteHandlers(router, '/sessions/:sessionId/reschedule-series', 'post');
        const req = {
            user: { uid: 'teacher-1' },
            teacherAccess: { isAdmin: false },
            params: { sessionId: 's1' },
            body: {
                targetLocalDate: '2026-09-10',
                targetLocalTime: '19:00',
                durationMinutes: 60,
                timezone: 'UTC'
            }
        };
        const res = buildRes();
        await invokeHandlers(handlers, req, res);

        assert.strictEqual(res._status, 200);
        assert.strictEqual(res._json.moved.length, 2, 'Two unlocked sessions moved');
        assert.strictEqual(res._json.skipped.length, 1);
        assert.strictEqual(res._json.skipped[0].sessionId, 's2');
        assert.strictEqual(res._json.skipped[0].reason, 'locked');

        const s2 = db.docs.get(`${CRM_SCHEDULED_SESSIONS}/s2`);
        assert.strictEqual(s2.scheduledLocalDate, '2026-09-16', 'Locked session unchanged');

        console.log('✓ Locked session skip verified');
    }

    // 3. Conflict -> 409 with before/after db.docs snapshot proving nothing written
    {
        const initialDocs = {
            [`${CRM_CLASSROOMS}/class-1`]: createClassroomDoc('class-1', 'teacher-1', 1),
            [`${CRM_CLASSROOMS}/class-other`]: createClassroomDoc('class-other', 'teacher-1', 1),
            [`${CRM_SCHEDULED_SESSIONS}/s1`]: createSessionDoc('s1', 'class-1', 'teacher-1', '2026-09-09', '18:00'),
            [`${CRM_SCHEDULED_SESSIONS}/s2`]: createSessionDoc('s2', 'class-1', 'teacher-1', '2026-09-16', '18:00'),
            // Conflicting session on Thursday 2026-09-17 at 19:00 for class-other
            [`${CRM_SCHEDULED_SESSIONS}/s-conflict`]: createSessionDoc('s-conflict', 'class-other', 'teacher-1', '2026-09-17', '19:00')
        };
        const { db, router } = buildTestEnvironment(initialDocs);
        const snapshotBefore = JSON.stringify(Array.from(db.docs.entries()));

        const handlers = getRouteHandlers(router, '/sessions/:sessionId/reschedule-series', 'post');
        const req = {
            user: { uid: 'teacher-1' },
            teacherAccess: { isAdmin: false },
            params: { sessionId: 's1' },
            body: {
                targetLocalDate: '2026-09-10', // Thursday (+1 day -> s2 lands on 2026-09-17 19:00)
                targetLocalTime: '19:00',
                durationMinutes: 60,
                timezone: 'UTC'
            }
        };
        const res = buildRes();
        await invokeHandlers(handlers, req, res);

        assert.strictEqual(res._status, 409, `Expected 409 SERIES_CONFLICT, got ${res._status}`);
        assert.strictEqual(res._json.error, 'SERIES_CONFLICT');
        assert(res._json.details?.conflicts?.length > 0, 'Conflicts array must be present in details');

        const snapshotAfter = JSON.stringify(Array.from(db.docs.entries()));
        assert.strictEqual(snapshotAfter, snapshotBefore, 'Database snapshot must be 100% identical before and after conflict rejection');

        console.log('✓ Conflict 409 and atomic rollback verified');
    }

    // 4. allowPartial with conflict
    {
        const initialDocs = {
            [`${CRM_CLASSROOMS}/class-1`]: createClassroomDoc('class-1', 'teacher-1', 1),
            [`${CRM_CLASSROOMS}/class-other`]: createClassroomDoc('class-other', 'teacher-1', 1),
            [`${CRM_SCHEDULED_SESSIONS}/s1`]: createSessionDoc('s1', 'class-1', 'teacher-1', '2026-09-09', '18:00'),
            [`${CRM_SCHEDULED_SESSIONS}/s2`]: createSessionDoc('s2', 'class-1', 'teacher-1', '2026-09-16', '18:00'),
            [`${CRM_SCHEDULED_SESSIONS}/s-conflict`]: createSessionDoc('s-conflict', 'class-other', 'teacher-1', '2026-09-17', '19:00')
        };
        const { db, router } = buildTestEnvironment(initialDocs);
        const handlers = getRouteHandlers(router, '/sessions/:sessionId/reschedule-series', 'post');
        const req = {
            user: { uid: 'teacher-1' },
            teacherAccess: { isAdmin: false },
            params: { sessionId: 's1' },
            body: {
                targetLocalDate: '2026-09-10',
                targetLocalTime: '19:00',
                durationMinutes: 60,
                timezone: 'UTC',
                allowPartial: true
            }
        };
        const res = buildRes();
        await invokeHandlers(handlers, req, res);

        assert.strictEqual(res._status, 200, `Expected 200 with allowPartial, got ${res._status}`);
        assert.strictEqual(res._json.moved.length, 1, 's1 should move');
        assert.strictEqual(res._json.skipped.length, 1, 's2 should be skipped due to conflict');
        assert.strictEqual(res._json.skipped[0].sessionId, 's2');
        assert.strictEqual(res._json.skipped[0].reason, 'teacher_conflict');

        const s1 = db.docs.get(`${CRM_SCHEDULED_SESSIONS}/s1`);
        const s2 = db.docs.get(`${CRM_SCHEDULED_SESSIONS}/s2`);
        assert.strictEqual(s1.scheduledLocalDate, '2026-09-10');
        assert.strictEqual(s2.scheduledLocalDate, '2026-09-16', 's2 kept original date');

        console.log('✓ allowPartial partial series move verified');
    }

    // 5. dryRun: true writes nothing and does not bump scheduleVersion
    {
        const initialDocs = {
            [`${CRM_CLASSROOMS}/class-1`]: createClassroomDoc('class-1', 'teacher-1', 5),
            [`${CRM_SCHEDULED_SESSIONS}/s1`]: createSessionDoc('s1', 'class-1', 'teacher-1', '2026-09-09', '18:00')
        };
        const { db, router } = buildTestEnvironment(initialDocs);
        const snapshotBefore = JSON.stringify(Array.from(db.docs.entries()));

        const handlers = getRouteHandlers(router, '/sessions/:sessionId/reschedule-series', 'post');
        const req = {
            user: { uid: 'teacher-1' },
            teacherAccess: { isAdmin: false },
            params: { sessionId: 's1' },
            body: {
                targetLocalDate: '2026-09-10',
                targetLocalTime: '19:00',
                durationMinutes: 60,
                timezone: 'UTC',
                dryRun: true
            }
        };
        const res = buildRes();
        await invokeHandlers(handlers, req, res);

        assert.strictEqual(res._status, 200);
        assert.strictEqual(res._json.dryRun, true);
        assert.strictEqual(res._json.moved.length, 1);

        const snapshotAfter = JSON.stringify(Array.from(db.docs.entries()));
        assert.strictEqual(snapshotAfter, snapshotBefore, 'dryRun must not mutate any documents');

        const classroom = db.docs.get(`${CRM_CLASSROOMS}/class-1`);
        assert.strictEqual(classroom.scheduleConfig.scheduleVersion, 5, 'scheduleVersion must not bump on dryRun');

        console.log('✓ dryRun idempotency verified');
    }

    // 6. Ownership 403
    {
        const initialDocs = {
            [`${CRM_CLASSROOMS}/class-1`]: createClassroomDoc('class-1', 'teacher-other', 1),
            [`${CRM_SCHEDULED_SESSIONS}/s1`]: createSessionDoc('s1', 'class-1', 'teacher-other', '2026-09-09', '18:00')
        };
        const { router } = buildTestEnvironment(initialDocs);
        const handlers = getRouteHandlers(router, '/sessions/:sessionId/reschedule-series', 'post');
        const req = {
            user: { uid: 'teacher-unauthorized' },
            teacherAccess: { isAdmin: false },
            params: { sessionId: 's1' },
            body: {
                targetLocalDate: '2026-09-10',
                targetLocalTime: '19:00'
            }
        };
        const res = buildRes();
        await invokeHandlers(handlers, req, res);

        assert.strictEqual(res._status, 403, `Expected 403, got ${res._status}`);
        assert.strictEqual(res._json.error, 'FORBIDDEN');

        console.log('✓ Ownership 403 authorization guard verified');
    }

    // 7. scheduleVersion bumps exactly once
    {
        const initialDocs = {
            [`${CRM_CLASSROOMS}/class-1`]: createClassroomDoc('class-1', 'teacher-1', 10),
            [`${CRM_SCHEDULED_SESSIONS}/s1`]: createSessionDoc('s1', 'class-1', 'teacher-1', '2026-09-09', '18:00'),
            [`${CRM_SCHEDULED_SESSIONS}/s2`]: createSessionDoc('s2', 'class-1', 'teacher-1', '2026-09-16', '18:00'),
            [`${CRM_SCHEDULED_SESSIONS}/s3`]: createSessionDoc('s3', 'class-1', 'teacher-1', '2026-09-23', '18:00')
        };
        const { db, router } = buildTestEnvironment(initialDocs);
        const handlers = getRouteHandlers(router, '/sessions/:sessionId/reschedule-series', 'post');
        const req = {
            user: { uid: 'teacher-1' },
            teacherAccess: { isAdmin: false },
            params: { sessionId: 's1' },
            body: {
                targetLocalDate: '2026-09-10',
                targetLocalTime: '19:00',
                durationMinutes: 60,
                timezone: 'UTC'
            }
        };
        const res = buildRes();
        await invokeHandlers(handlers, req, res);

        assert.strictEqual(res._status, 200);
        const classroom = db.docs.get(`${CRM_CLASSROOMS}/class-1`);
        assert.strictEqual(classroom.scheduleConfig.scheduleVersion, 11, 'Version must increment by exactly 1');

        console.log('✓ scheduleVersion bumps exactly once verified');
    }

    // 8. Round-trip undo restores every field to the fixture
    {
        const fixtureS1 = createSessionDoc('s1', 'class-1', 'teacher-1', '2026-09-09', '18:00', {
            unitType: 'contracted',
            contractUnitIndex: 1,
            sessionOutcome: 'none',
            notes: 'special test note'
        });
        const fixtureS2 = createSessionDoc('s2', 'class-1', 'teacher-1', '2026-09-16', '18:00', {
            unitType: 'contracted',
            contractUnitIndex: 2,
            sessionOutcome: 'none',
            notes: 'second test note'
        });
        const initialDocs = {
            [`${CRM_CLASSROOMS}/class-1`]: createClassroomDoc('class-1', 'teacher-1', 1),
            [`${CRM_SCHEDULED_SESSIONS}/s1`]: fixtureS1,
            [`${CRM_SCHEDULED_SESSIONS}/s2`]: fixtureS2
        };
        const { db, router } = buildTestEnvironment(initialDocs);

        // Step 1: Reschedule series
        const rescheduleHandlers = getRouteHandlers(router, '/sessions/:sessionId/reschedule-series', 'post');
        const moveReq = {
            user: { uid: 'teacher-1' },
            teacherAccess: { isAdmin: false },
            params: { sessionId: 's1' },
            body: {
                targetLocalDate: '2026-09-10',
                targetLocalTime: '19:00',
                durationMinutes: 60,
                timezone: 'UTC'
            }
        };
        const moveRes = buildRes();
        await invokeHandlers(rescheduleHandlers, moveReq, moveRes);

        assert.strictEqual(moveRes._status, 200);
        assert.strictEqual(moveRes._json.moved.length, 2);

        // Step 2: Build undo payload directly from moved[].from
        const undoMoves = moveRes._json.moved.map((m) => ({
            sessionId: m.sessionId,
            ...m.from
        }));

        // Step 3: Call bulk-reschedule route as undo primitive
        const bulkHandlers = getRouteHandlers(router, '/scheduler/sessions/bulk-reschedule', 'post');
        const undoReq = {
            user: { uid: 'teacher-1' },
            teacherAccess: { isAdmin: false },
            body: {
                moves: undoMoves,
                timezone: 'UTC',
                undoOf: moveRes._json.operationId
            }
        };
        const undoRes = buildRes();
        await invokeHandlers(bulkHandlers, undoReq, undoRes);

        assert.strictEqual(undoRes._status, 200);
        assert.strictEqual(undoRes._json.moved.length, 2, 'Undo must move both sessions back');

        // Step 4: Verify restored documents match original fixture
        const restoredS1 = db.docs.get(`${CRM_SCHEDULED_SESSIONS}/s1`);
        const restoredS2 = db.docs.get(`${CRM_SCHEDULED_SESSIONS}/s2`);

        assert.strictEqual(restoredS1.scheduledLocalDate, fixtureS1.scheduledLocalDate);
        assert.strictEqual(restoredS1.scheduledLocalTime, fixtureS1.scheduledLocalTime);
        assert.strictEqual(restoredS1.unitType, fixtureS1.unitType);
        assert.strictEqual(restoredS1.contractUnitIndex, fixtureS1.contractUnitIndex);
        assert.strictEqual(restoredS1.notes, fixtureS1.notes);

        assert.strictEqual(restoredS2.scheduledLocalDate, fixtureS2.scheduledLocalDate);
        assert.strictEqual(restoredS2.scheduledLocalTime, fixtureS2.scheduledLocalTime);
        assert.strictEqual(restoredS2.unitType, fixtureS2.unitType);
        assert.strictEqual(restoredS2.contractUnitIndex, fixtureS2.contractUnitIndex);
        assert.strictEqual(restoredS2.notes, fixtureS2.notes);

        console.log('✓ Round-trip undo restores all fields to fixture verified');
    }

    // 9. expectedScheduleVersion mismatch returns 409
    {
        const initialDocs = {
            [`${CRM_CLASSROOMS}/class-1`]: createClassroomDoc('class-1', 'teacher-1', 5),
            [`${CRM_SCHEDULED_SESSIONS}/s1`]: createSessionDoc('s1', 'class-1', 'teacher-1', '2026-09-09', '18:00')
        };
        const { router } = buildTestEnvironment(initialDocs);
        const handlers = getRouteHandlers(router, '/sessions/:sessionId/reschedule-series', 'post');
        const req = {
            user: { uid: 'teacher-1' },
            teacherAccess: { isAdmin: false },
            params: { sessionId: 's1' },
            body: {
                targetLocalDate: '2026-09-10',
                targetLocalTime: '19:00',
                durationMinutes: 60,
                timezone: 'UTC',
                expectedScheduleVersion: 4 // mismatch with current version 5
            }
        };
        const res = buildRes();
        await invokeHandlers(handlers, req, res);

        assert.strictEqual(res._status, 409, 'Must return 409 on expectedScheduleVersion mismatch');
        assert.strictEqual(res._json.error, 'SCHEDULE_VERSION_MISMATCH');

        console.log('✓ expectedScheduleVersion mismatch 409 guard verified');
    }

    // 10. candidates > 400 returns 400 TOO_MANY_MOVES
    {
        const initialDocs = {
            [`${CRM_CLASSROOMS}/class-1`]: createClassroomDoc('class-1', 'teacher-1', 1)
        };
        for (let i = 0; i < 405; i += 1) {
            initialDocs[`${CRM_SCHEDULED_SESSIONS}/s-${i}`] = createSessionDoc(`s-${i}`, 'class-1', 'teacher-1', '2026-09-09', '18:00');
        }
        const { router } = buildTestEnvironment(initialDocs);
        const handlers = getRouteHandlers(router, '/sessions/:sessionId/reschedule-series', 'post');
        const req = {
            user: { uid: 'teacher-1' },
            teacherAccess: { isAdmin: false },
            params: { sessionId: 's-0' },
            body: {
                targetLocalDate: '2026-09-10',
                targetLocalTime: '19:00',
                durationMinutes: 60,
                timezone: 'UTC'
            }
        };
        const res = buildRes();
        await invokeHandlers(handlers, req, res);

        assert.strictEqual(res._status, 400, 'Must return 400 on TOO_MANY_MOVES');
        assert.strictEqual(res._json.error, 'TOO_MANY_MOVES');

        console.log('✓ candidates > 400 TOO_MANY_MOVES 400 response verified');
    }

    // 11. Sanitized patch contains no internal fields and conflictAt is formatted as local slot
    {
        const initialDocs = {
            [`${CRM_CLASSROOMS}/class-1`]: createClassroomDoc('class-1', 'teacher-1', 1),
            [`${CRM_CLASSROOMS}/class-2`]: createClassroomDoc('class-2', 'teacher-1', 1),
            [`${CRM_SCHEDULED_SESSIONS}/s1`]: createSessionDoc('s1', 'class-1', 'teacher-1', '2026-09-09', '18:00', {
                internalLeakedField: 'secret'
            }),
            [`${CRM_SCHEDULED_SESSIONS}/s2`]: createSessionDoc('s2', 'class-1', 'teacher-1', '2026-09-16', '18:00', {
                internalLeakedField: 'secret2'
            }),
            [`${CRM_SCHEDULED_SESSIONS}/s-conf`]: createSessionDoc('s-conf', 'class-2', 'teacher-1', '2026-09-10', '19:00')
        };
        const { router } = buildTestEnvironment(initialDocs);
        const handlers = getRouteHandlers(router, '/sessions/:sessionId/reschedule-series', 'post');
        const req = {
            user: { uid: 'teacher-1' },
            teacherAccess: { isAdmin: false },
            params: { sessionId: 's1' },
            body: {
                targetLocalDate: '2026-09-10',
                targetLocalTime: '19:00',
                durationMinutes: 60,
                timezone: 'UTC',
                dryRun: true,
                allowPartial: true
            }
        };
        const res = buildRes();
        await invokeHandlers(handlers, req, res);

        assert.strictEqual(res._status, 200);
        assert(res._json.conflicts.length > 0, 'Must report conflict');
        assert.deepStrictEqual(res._json.conflicts[0].conflictAt, {
            scheduledLocalDate: '2026-09-10',
            scheduledLocalTime: '19:00'
        }, 'conflictAt must be formatted as local slot object');

        assert(res._json.moved.length > 0, 'Must report moved');
        const patch = res._json.moved[0].patch;
        assert.strictEqual(patch.sessionId, undefined, 'patch must not contain sessionId');
        assert.strictEqual(patch.internalLeakedField, undefined, 'patch must not contain raw session fields');
        assert.strictEqual(patch.scheduledLocalDate, '2026-09-17');
        assert.strictEqual(patch.scheduledLocalTime, '19:00');

        console.log('✓ Sanitized patch and conflictAt local slot format verified');
    }

    // Outcome writes use the same atomic operation/receipt boundary as cancellation.
    {
        const { db, router } = buildTestEnvironment({
            [`${CRM_CLASSROOMS}/class-1`]: createClassroomDoc('class-1'),
            [`${CRM_SCHEDULED_SESSIONS}/outcome-1`]: createSessionDoc('outcome-1', 'class-1', 'teacher-1', '2026-09-23', '18:00')
        });
        const handlers = getRouteHandlers(router, '/sessions/:sessionId/outcome', 'post');
        const req = { user: { uid: 'teacher-1' }, teacherAccess: { isAdmin: false }, params: { sessionId: 'outcome-1' }, body: { operationId: 'outcome-regression-1', outcome: 'completed', note: 'Saved note' } };
        const first = buildRes();
        await invokeHandlers(handlers, req, first);
        assert.strictEqual(first._status, 200);
        assert.strictEqual(first._json.operationId, 'outcome-regression-1', 'Outcome must produce a durable scheduling receipt');
        const replay = buildRes();
        await invokeHandlers(handlers, req, replay);
        assert.strictEqual(replay._status, 200);
        assert.strictEqual(replay._json.idempotentReplay, true);
        assert.strictEqual(db.docs.get(`${CRM_SCHEDULED_SESSIONS}/outcome-1`).version, 2, 'Replay cannot write twice');
        const mismatch = buildRes();
        await invokeHandlers(handlers, { ...req, body: { ...req.body, note: 'Different intent' } }, mismatch);
        assert.strictEqual(mismatch._status, 409);
        const cancel = buildRes();
        await invokeHandlers(getRouteHandlers(router, '/sessions/:sessionId/cancel', 'post'), { ...req, body: { operationId: 'cancel-regression-1' } }, cancel);
        assert.strictEqual(cancel._status, 200);
        const late = buildRes();
        await invokeHandlers(handlers, { ...req, body: { ...req.body, operationId: 'outcome-regression-2' } }, late);
        assert.strictEqual(late._status, 409, 'Cancelled session must reject a new outcome');
        assert.strictEqual(db.docs.get(`${CRM_SCHEDULED_SESSIONS}/outcome-1`).version, 3);
        console.log('✓ Outcome receipt replay, payload guard and cancelled-session protection');
    }

    {
        const { db, router } = buildTestEnvironment({
            [`${CRM_CLASSROOMS}/class-1`]: createClassroomDoc('class-1'),
            [`${CRM_SCHEDULED_SESSIONS}/race-1`]: createSessionDoc('race-1', 'class-1', 'teacher-1', '2026-09-23', '18:00', { sessionNote: 'Original' })
        });
        const req = { user: { uid: 'teacher-1' }, teacherAccess: { isAdmin: false }, params: { sessionId: 'race-1' } };
        const outcomeHandlers = getRouteHandlers(router, '/sessions/:sessionId/outcome', 'post');
        const forbidden = buildRes();
        await invokeHandlers(outcomeHandlers, { ...req, user: { uid: 'another-teacher' }, body: { outcome: 'completed' } }, forbidden);
        assert.strictEqual(forbidden._status, 403);
        const cancel = buildRes();
        const outcome = buildRes();
        await Promise.all([
            invokeHandlers(getRouteHandlers(router, '/sessions/:sessionId/cancel', 'post'), { ...req, body: { operationId: 'race-cancel-1' } }, cancel),
            invokeHandlers(outcomeHandlers, { ...req, body: { operationId: 'race-outcome-1', outcome: 'completed', note: 'Late note' } }, outcome)
        ]);
        assert.strictEqual(cancel._status, 200);
        assert.strictEqual(outcome._status, 409, 'Outcome must revalidate behind concurrent cancellation');
        const saved = db.docs.get(`${CRM_SCHEDULED_SESSIONS}/race-1`);
        assert.strictEqual(saved.status, 'cancelled');
        assert.strictEqual(saved.sessionNote, 'Original');
        assert.strictEqual(saved.version, 2);
        console.log('✓ Concurrent cancellation rejects stale outcome and retains authorization');
    }

    console.log('All teacher scheduler series route tests passed successfully!');
}

runSeriesRouteTests().catch((err) => {
    console.error('Test failed:', err);
    process.exit(1);
});
