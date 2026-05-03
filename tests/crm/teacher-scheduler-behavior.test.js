const assert = require('assert');
const express = require('express');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

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

    function makeQuery(collectionName, filters = [], sortField = null, sortDirection = 'asc', limitCount = null) {
        return {
            where(field, op, value) {
                return makeQuery(collectionName, filters.concat([{ field, op, value }]), sortField, sortDirection, limitCount);
            },
            orderBy(field, direction = 'asc') {
                return makeQuery(collectionName, filters, field, direction, limitCount);
            },
            limit(count) {
                return makeQuery(collectionName, filters, sortField, sortDirection, count);
            },
            async get() {
                let rows = listCollectionDocs(collectionName);

                for (const filter of filters) {
                    rows = rows.filter((row) => compare(filter.op, row.data?.[filter.field], filter.value));
                }

                if (sortField) {
                    rows.sort((left, right) => {
                        const a = left.data?.[sortField];
                        const b = right.data?.[sortField];
                        if (a === b) return 0;
                        const direction = sortDirection === 'desc' ? -1 : 1;
                        return a > b ? direction : -direction;
                    });
                }

                if (Number.isInteger(limitCount) && limitCount >= 0) {
                    rows = rows.slice(0, limitCount);
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
                orderBy(field, direction = 'asc') {
                    return makeQuery(collectionName, [], field, direction);
                },
                limit(count) {
                    return makeQuery(collectionName, [], null, 'asc', count);
                },
                async get() {
                    return makeQuery(collectionName).get();
                }
            };
        },
        batch() {
            const operations = [];
            return {
                set(ref, payload) {
                    operations.push(() => ref.set(payload));
                },
                async commit() {
                    for (const operation of operations) {
                        await operation();
                    }
                }
            };
        }
    };
}

async function testAddMultiPersistsPattern() {
    const db = createFakeDb({
        [`${CRM_CLASSROOMS}/class-1`]: {
            name: 'Class One',
            primaryTeacherUid: 'teacher-1',
            courseId: 'course-1',
            createdAt: '2026-04-01T00:00:00.000Z',
            scheduleConfig: {
                totalInstructionMinutes: 240,
                sessionMinutes: 120,
                targetSessionCount: 2,
                timezone: 'Asia/Bangkok',
                durationStepMinutes: 30,
                seedWeekdays: [],
                seedStartTime: null,
                scheduleVersion: 1
            },
            scheduleSummary: {
                contractedTargetCount: 2,
                contractedAssignedCount: 0,
                contractedCompletedCount: 0,
                remainingToScheduleCount: 2,
                overflowCount: 0,
                nextScheduledAt: null
            }
        }
    });

    const router = createTeacherSchedulerRouter({
        db,
        authMiddleware: (req, _res, next) => {
            req.user = { uid: 'teacher-1', email: 'teacher@example.com' };
            next();
        },
        sendSuccess: (res, data, message) => res.status(200).json({ success: true, ...(message ? { message } : {}), ...data }),
        sendError: (res, status, error, message, details) => res.status(status).json({ success: false, error, message, ...(details ? { details } : {}) }),
        serverTimestamp: () => 'SERVER_TS'
    });

    const handlers = getRouteHandlers(router, '/classrooms/:classId/sessions/add-multi', 'post');
    const res = buildRes();
    await invokeHandlers(handlers, {
        params: { classId: 'class-1' },
        body: {
            weekdays: [1],
            startTime: '09:00',
            from: '2026-04-06',
            to: '2026-04-06'
        }
    }, res);

    assert.strictEqual(res._status, 200);
    assert.strictEqual(Array.isArray(res._json.createdSessions), true);
    assert.strictEqual(res._json.createdSessions.length, 1);

    const classroom = db.docs.get(`${CRM_CLASSROOMS}/class-1`);
    assert.deepStrictEqual(classroom.scheduleConfig.seedWeekdays, ['1']);
    assert.strictEqual(classroom.scheduleConfig.seedStartTime, '09:00');
    assert.strictEqual(classroom.scheduleConfig.scheduleVersion, 2);

    const createdSessionDocs = Array.from(db.docs.keys())
        .filter((key) => key.startsWith(`${CRM_SCHEDULED_SESSIONS}/`));
    assert.strictEqual(createdSessionDocs.length, 1);
}

async function testTeacherOutcomeUpdatesContractCounting() {
    const db = createFakeDb({
        [`${CRM_CLASSROOMS}/class-1`]: {
            name: 'Class One',
            primaryTeacherUid: 'teacher-1',
            courseId: 'course-1',
            createdAt: '2026-04-01T00:00:00.000Z',
            scheduleConfig: {
                totalInstructionMinutes: 60,
                sessionMinutes: 60,
                targetSessionCount: 1,
                timezone: 'Asia/Bangkok',
                durationStepMinutes: 30,
                seedWeekdays: [],
                seedStartTime: null,
                scheduleVersion: 1
            },
            scheduleSummary: {
                contractedTargetCount: 1,
                contractedAssignedCount: 1,
                contractedCompletedCount: 0,
                remainingToScheduleCount: 0,
                overflowCount: 0,
                nextScheduledAt: '2026-04-06T03:00:00.000Z'
            }
        },
        [`${CRM_SCHEDULED_SESSIONS}/session-1`]: {
            sessionId: 'session-1',
            classId: 'class-1',
            teacherUid: 'teacher-1',
            unitType: 'contracted',
            contractUnitIndex: 1,
            status: 'scheduled',
            sessionOutcome: 'none',
            contractCountState: 'counts',
            attendanceState: 'none',
            lockState: 'unlocked',
            timezone: 'Asia/Bangkok',
            durationMinutes: 60,
            scheduledStartAtUtc: '2026-04-06T03:00:00.000Z',
            scheduledEndAtUtc: '2026-04-06T04:00:00.000Z',
            scheduledLocalDate: '2026-04-06',
            scheduledLocalTime: '10:00'
        }
    });

    const router = createTeacherSchedulerRouter({
        db,
        authMiddleware: (req, _res, next) => {
            req.user = { uid: 'teacher-1', email: 'teacher@example.com' };
            next();
        },
        sendSuccess: (res, data, message) => res.status(200).json({ success: true, ...(message ? { message } : {}), ...data }),
        sendError: (res, status, error, message, details) => res.status(status).json({ success: false, error, message, ...(details ? { details } : {}) }),
        serverTimestamp: () => 'SERVER_TS'
    });

    const handlers = getRouteHandlers(router, '/sessions/:sessionId/outcome', 'post');
    const res = buildRes();
    await invokeHandlers(handlers, {
        params: { sessionId: 'session-1' },
        body: { outcome: 'absent_makeup' }
    }, res);

    assert.strictEqual(res._status, 200);
    assert.strictEqual(res._json.success, true);
    assert.strictEqual(res._json.sessionId, 'session-1');

    const session = db.docs.get(`${CRM_SCHEDULED_SESSIONS}/session-1`);
    assert.strictEqual(session.sessionOutcome, 'absent_makeup');
    assert.strictEqual(session.contractCountState, 'does_not_count');

    const classroom = db.docs.get(`${CRM_CLASSROOMS}/class-1`);
    assert.strictEqual(classroom.scheduleSummary.contractedAssignedCount, 0);
    assert.strictEqual(classroom.scheduleSummary.remainingToScheduleCount, 1);

    const cancelledDb = createFakeDb({
        [`${CRM_CLASSROOMS}/class-2`]: {
            name: 'Class Two',
            primaryTeacherUid: 'teacher-1',
            courseId: 'course-1',
            scheduleConfig: {
                totalInstructionMinutes: 60,
                sessionMinutes: 60,
                targetSessionCount: 1,
                timezone: 'Asia/Bangkok',
                durationStepMinutes: 30,
                seedWeekdays: [],
                seedStartTime: null,
                scheduleVersion: 1
            }
        },
        [`${CRM_SCHEDULED_SESSIONS}/session-2`]: {
            sessionId: 'session-2',
            classId: 'class-2',
            teacherUid: 'teacher-1',
            unitType: 'contracted',
            contractUnitIndex: 1,
            status: 'cancelled',
            sessionOutcome: 'none',
            contractCountState: 'does_not_count',
            attendanceState: 'none',
            lockState: 'unlocked',
            timezone: 'Asia/Bangkok',
            durationMinutes: 60,
            scheduledStartAtUtc: '2026-04-06T03:00:00.000Z',
            scheduledEndAtUtc: '2026-04-06T04:00:00.000Z',
            scheduledLocalDate: '2026-04-06',
            scheduledLocalTime: '10:00'
        }
    });

    const cancelledRouter = createTeacherSchedulerRouter({
        db: cancelledDb,
        authMiddleware: (req, _res, next) => {
            req.user = { uid: 'teacher-1', email: 'teacher@example.com' };
            next();
        },
        sendSuccess: (res, data, message) => res.status(200).json({ success: true, ...(message ? { message } : {}), ...data }),
        sendError: (res, status, error, message, details) => res.status(status).json({ success: false, error, message, ...(details ? { details } : {}) }),
        serverTimestamp: () => 'SERVER_TS'
    });

    const cancelledHandlers = getRouteHandlers(cancelledRouter, '/sessions/:sessionId/outcome', 'post');
    const cancelledRes = buildRes();
    await invokeHandlers(cancelledHandlers, {
        params: { sessionId: 'session-2' },
        body: { outcome: 'completed' }
    }, cancelledRes);

    assert.strictEqual(cancelledRes._status, 409);
    assert.strictEqual(cancelledRes._json.error, 'SESSION_LOCKED');
}

async function testTeacherApiErrorMessages() {
    const scriptPath = path.resolve(__dirname, '../../public/js/classroom-api.js');
    const source = fs.readFileSync(scriptPath, 'utf8');
    const context = {
        window: {},
        firebase: {
            auth() {
                return {
                    currentUser: {
                        async getIdToken() {
                            return 'token-123';
                        }
                    }
                };
            }
        },
        fetch: async () => ({
            ok: false,
            status: 409,
            async json() {
                return {
                    success: false,
                    error: 'TEACHER_CONFLICT',
                    message: 'Teacher conflict with an existing session.',
                    details: {
                        conflictSession: { sessionId: 'session-2' }
                    }
                };
            }
        }),
        console,
        URLSearchParams,
        Blob,
        setTimeout,
        clearTimeout
    };
    context.window = context;
    vm.runInNewContext(source, context, { filename: 'classroom-api.js' });

    await assert.rejects(
        () => context.ClassroomAPI.teacherAddClassroomSession('class-1', {
            targetLocalDate: '2026-04-06',
            targetLocalTime: '09:00'
        }),
        (error) => {
            assert.strictEqual(error.message, 'Teacher conflict with an existing session.');
            assert.strictEqual(error.status, 409);
            assert.strictEqual(error.code, 'TEACHER_CONFLICT');
            assert.deepStrictEqual(error.details, {
                conflictSession: { sessionId: 'session-2' }
            });
            return true;
        }
    );
}

(async () => {
    await testAddMultiPersistsPattern();
    await testTeacherOutcomeUpdatesContractCounting();
    await testTeacherApiErrorMessages();
    process.stdout.write('teacher scheduler behavior passed\n');
})().catch((error) => {
    process.stderr.write(`${error.stack || error}\n`);
    process.exit(1);
});
