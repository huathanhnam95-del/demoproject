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
        body: {
            outcome: 'absent_makeup',
            note: 'Spoken pronunciation dictation note'
        }
    }, res);

    assert.strictEqual(res._status, 200);
    assert.strictEqual(res._json.success, true);
    assert.strictEqual(res._json.sessionId, 'session-1');
    assert.strictEqual(res._json.sessionNote, 'Spoken pronunciation dictation note');

    const session = db.docs.get(`${CRM_SCHEDULED_SESSIONS}/session-1`);
    assert.strictEqual(session.sessionOutcome, 'absent_makeup');
    assert.strictEqual(session.sessionNote, 'Spoken pronunciation dictation note');
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

async function testAdminCanManageAllTeacherSchedules() {
    const db = createFakeDb({
        'users/admin-1': {
            email: 'admin@example.com',
            isAdmin: true
        },
        'users/teacher-1': {
            email: 'teacher1@example.com',
            isTeacher: true,
            crmRole: 'teacher'
        },
        'users/teacher-2': {
            email: 'teacher2@example.com',
            isTeacher: true,
            crmRole: 'teacher'
        },
        [`${CRM_CLASSROOMS}/class-1`]: {
            name: 'Teacher 1 Class',
            primaryTeacherUid: 'teacher-1',
            courseId: 'course-1',
            createdAt: '2026-04-01T00:00:00.000Z',
            scheduleConfig: {
                totalInstructionMinutes: 1200,
                sessionMinutes: 120,
                targetSessionCount: 10,
                timezone: 'UTC',
                scheduleVersion: 1
            }
        },
        [`${CRM_CLASSROOMS}/class-2`]: {
            name: 'Teacher 2 Class',
            primaryTeacherUid: 'teacher-2',
            courseId: 'course-2',
            createdAt: '2026-04-01T00:00:00.000Z',
            scheduleConfig: {
                totalInstructionMinutes: 1200,
                sessionMinutes: 120,
                targetSessionCount: 10,
                timezone: 'UTC',
                scheduleVersion: 1
            }
        },
        [`${CRM_SCHEDULED_SESSIONS}/session-t1`]: {
            classId: 'class-1',
            teacherUid: 'teacher-1',
            status: 'scheduled',
            scheduledLocalDate: '2026-04-06',
            scheduledLocalTime: '09:00',
            scheduledStartAtUtc: '2026-04-06T09:00:00.000Z',
            scheduledEndAtUtc: '2026-04-06T11:00:00.000Z',
            durationMinutes: 120
        },
        [`${CRM_SCHEDULED_SESSIONS}/session-t2`]: {
            classId: 'class-2',
            teacherUid: 'teacher-2',
            status: 'scheduled',
            scheduledLocalDate: '2026-04-06',
            scheduledLocalTime: '14:00',
            scheduledStartAtUtc: '2026-04-06T14:00:00.000Z',
            scheduledEndAtUtc: '2026-04-06T16:00:00.000Z',
            durationMinutes: 120
        }
    });

    let currentReqUser = { uid: 'admin-1', email: 'admin@example.com', isAdmin: true };

    const router = createTeacherSchedulerRouter({
        db,
        authMiddleware: (req, _res, next) => {
            req.user = currentReqUser;
            next();
        },
        sendSuccess: (res, data, message) => res.status(200).json({ success: true, ...(message ? { message } : {}), ...data }),
        sendError: (res, status, error, message, details) => res.status(status).json({ success: false, error, message, ...(details ? { details } : {}) }),
        serverTimestamp: () => 'SERVER_TS'
    });

    // 1. Admin loads workspace for ALL teachers
    const workspaceHandlers = getRouteHandlers(router, '/scheduler/workspace', 'get');
    let res = buildRes();
    await invokeHandlers(workspaceHandlers, {
        query: { teacherUid: 'all', from: '2026-04-01', to: '2026-04-30' }
    }, res);
    assert.strictEqual(res._status, 200);
    assert.strictEqual(res._json.classrooms.length, 2, 'Admin in all mode should see all classrooms');
    assert.strictEqual(res._json.sessions.length, 2, 'Admin in all mode should see sessions from both teachers');

    // 2. Admin loads workspace for specific teacher: teacher-2
    res = buildRes();
    await invokeHandlers(workspaceHandlers, {
        query: { teacherUid: 'teacher-2', from: '2026-04-01', to: '2026-04-30' }
    }, res);
    assert.strictEqual(res._status, 200);
    assert.strictEqual(res._json.classrooms.length, 1);
    assert.strictEqual(res._json.classrooms[0].classroomId, 'class-2');
    assert.strictEqual(res._json.sessions.length, 1);
    assert.strictEqual(res._json.sessions[0].sessionId, 'session-t2');

    // 3. Regular teacher cannot see other teacher's schedule
    currentReqUser = { uid: 'teacher-1', email: 'teacher1@example.com', isTeacher: true };
    res = buildRes();
    await invokeHandlers(workspaceHandlers, {
        query: { teacherUid: 'teacher-2', from: '2026-04-01', to: '2026-04-30' }
    }, res);
    assert.strictEqual(res._status, 200);
    // Non-admin query is forced to caller's own uid (teacher-1)
    assert.strictEqual(res._json.teacherUid, 'teacher-1');
    assert.strictEqual(res._json.classrooms.length, 1);
    assert.strictEqual(res._json.classrooms[0].classroomId, 'class-1');

    // 4. Admin adds session to teacher-2's classroom
    currentReqUser = { uid: 'admin-1', email: 'admin@example.com', isAdmin: true };
    const addHandlers = getRouteHandlers(router, '/classrooms/:classId/sessions/add', 'post');
    res = buildRes();
    await invokeHandlers(addHandlers, {
        params: { classId: 'class-2' },
        body: {
            targetLocalDate: '2026-04-07',
            targetLocalTime: '10:00',
            durationMinutes: 120
        }
    }, res);
    assert.strictEqual(res._status, 200, `Admin adding session failed: ${JSON.stringify(res._json)}`);
    assert.strictEqual(res._json.session.teacherUid, 'teacher-2', 'Session should be assigned to primary teacher of classroom');

    // 5. Admin reschedules teacher-2's session
    const rescheduleHandlers = getRouteHandlers(router, '/sessions/:sessionId/reschedule', 'patch');
    res = buildRes();
    await invokeHandlers(rescheduleHandlers, {
        params: { sessionId: 'session-t2' },
        body: {
            targetLocalDate: '2026-04-08',
            targetLocalTime: '15:00',
            durationMinutes: 120
        }
    }, res);
    assert.strictEqual(res._status, 200, `Admin rescheduling failed: ${JSON.stringify(res._json)}`);

    // 6. Admin cancels teacher-1's session
    const cancelHandlers = getRouteHandlers(router, '/sessions/:sessionId/cancel', 'post');
    res = buildRes();
    await invokeHandlers(cancelHandlers, {
        params: { sessionId: 'session-t1' }
    }, res);
    assert.strictEqual(res._status, 200, `Admin cancelling failed: ${JSON.stringify(res._json)}`);
}

async function testAdminRecurrenceActivationForSpecificTeacherAndBatchChunking() {
    const batchSizes = [];
    const db = createFakeDb({
        [`${CRM_CLASSROOMS}/class-target`]: {
            name: 'Target Teacher Class',
            primaryTeacherUid: 'teacher-target',
            courseId: 'course-target',
            createdAt: '2026-04-01T00:00:00.000Z',
            scheduleConfig: {
                totalInstructionMinutes: 240,
                sessionMinutes: 120,
                targetSessionCount: 2,
                timezone: 'Asia/Bangkok',
                durationStepMinutes: 30,
                seedWeekdays: ['mon', 'wed'],
                seedStartTime: '10:00',
                scheduleVersion: 1
            },
            scheduleSummary: {
                contractedTargetCount: 2,
                contractedAssignedCount: 0,
                contractedCompletedCount: 0,
                remainingToScheduleCount: 2,
                overflowCount: 0
            }
        }
    });

    const originalBatch = db.batch.bind(db);
    db.batch = function () {
        const batchInst = originalBatch();
        const originalSet = batchInst.set.bind(batchInst);
        let count = 0;
        batchInst.set = function (ref, payload) {
            count += 1;
            return originalSet(ref, payload);
        };
        const originalCommit = batchInst.commit.bind(batchInst);
        batchInst.commit = async function () {
            batchSizes.push(count);
            return originalCommit();
        };
        return batchInst;
    };

    const router = createTeacherSchedulerRouter({
        db,
        authMiddleware: (req, _res, next) => {
            req.user = { uid: 'admin-super', email: 'admin@example.com', isAdmin: true };
            next();
        },
        sendSuccess: (res, data, message) => res.status(200).json({ success: true, ...(message ? { message } : {}), ...data }),
        sendError: (res, status, error, message, details) => res.status(status).json({ success: false, error, message, ...(details ? { details } : {}) }),
        serverTimestamp: () => 'SERVER_TS'
    });

    const activateHandlers = getRouteHandlers(router, '/scheduler/activate-recurrences', 'post');
    const res = buildRes();
    await invokeHandlers(activateHandlers, {
        body: {
            teacherUid: 'teacher-target',
            from: '2026-04-06',
            to: '2026-04-12'
        }
    }, res);

    assert.strictEqual(res._status, 200, `Activation failed: ${JSON.stringify(res._json)}`);
    assert.strictEqual(res._json.success, true);
    assert(res._json.details && res._json.details.length > 0, 'Should have activation details');
    assert.strictEqual(res._json.details[0].status, 'success');
    assert.strictEqual(res._json.details[0].createdCount, 2);

    const createdSessions = Array.from(db.docs.entries())
        .filter(([key]) => key.startsWith(`${CRM_SCHEDULED_SESSIONS}/`))
        .map(([, val]) => val);
    assert.strictEqual(createdSessions.length, 2, 'Should create 2 sessions');
    for (const session of createdSessions) {
        assert.strictEqual(session.teacherUid, 'teacher-target', 'Session must be assigned to target teacher, not admin');
        assert.strictEqual(session.createdBy, 'admin-super', 'Created by should track admin caller');
    }

    assert(batchSizes.length > 0, 'Should have used batch commits');
    for (const size of batchSizes) {
        assert(size <= 400, `Batch size ${size} exceeded maximum limit of 400`);
    }
}

async function testNonAdminCannotSpoofTeacherUidInRecurrenceActivation() {
    const db = createFakeDb({
        [`${CRM_CLASSROOMS}/class-teacher-own`]: {
            name: 'Teacher Own Class',
            primaryTeacherUid: 'teacher-normal',
            courseId: 'course-own',
            createdAt: '2026-04-01T00:00:00.000Z',
            scheduleConfig: {
                totalInstructionMinutes: 120,
                sessionMinutes: 60,
                targetSessionCount: 1,
                timezone: 'Asia/Bangkok',
                seedWeekdays: ['tue'],
                seedStartTime: '09:00',
                scheduleVersion: 1
            },
            scheduleSummary: {
                contractedTargetCount: 1,
                contractedAssignedCount: 0,
                contractedCompletedCount: 0,
                remainingToScheduleCount: 1,
                overflowCount: 0
            }
        },
        [`${CRM_CLASSROOMS}/class-target-other`]: {
            name: 'Target Other Class',
            primaryTeacherUid: 'teacher-other',
            courseId: 'course-other',
            createdAt: '2026-04-01T00:00:00.000Z',
            scheduleConfig: {
                totalInstructionMinutes: 120,
                sessionMinutes: 60,
                targetSessionCount: 1,
                timezone: 'Asia/Bangkok',
                seedWeekdays: ['fri'],
                seedStartTime: '15:00',
                scheduleVersion: 1
            },
            scheduleSummary: {
                contractedTargetCount: 1,
                contractedAssignedCount: 0,
                contractedCompletedCount: 0,
                remainingToScheduleCount: 1,
                overflowCount: 0
            }
        }
    });

    const router = createTeacherSchedulerRouter({
        db,
        authMiddleware: (req, _res, next) => {
            req.user = { uid: 'teacher-normal', email: 'teacher@example.com', isTeacher: true, isAdmin: false };
            next();
        },
        sendSuccess: (res, data, message) => res.status(200).json({ success: true, ...(message ? { message } : {}), ...data }),
        sendError: (res, status, error, message, details) => res.status(status).json({ success: false, error, message, ...(details ? { details } : {}) }),
        serverTimestamp: () => 'SERVER_TS'
    });

    const activateHandlers = getRouteHandlers(router, '/scheduler/activate-recurrences', 'post');
    const res = buildRes();
    // Non-admin attempts to pass teacherUid: 'teacher-other'
    await invokeHandlers(activateHandlers, {
        body: {
            teacherUid: 'teacher-other',
            from: '2026-04-06',
            to: '2026-04-12'
        }
    }, res);

    assert.strictEqual(res._status, 200);
    assert.strictEqual(res._json.success, true);

    const createdSessions = Array.from(db.docs.entries())
        .filter(([key]) => key.startsWith(`${CRM_SCHEDULED_SESSIONS}/`))
        .map(([, val]) => val);

    // Created sessions must be for teacher-normal's own classroom, assigned to teacher-normal
    assert.strictEqual(createdSessions.length, 1);
    assert.strictEqual(createdSessions[0].teacherUid, 'teacher-normal', 'Non-admin caller cannot spoof teacherUid');
    assert.strictEqual(createdSessions[0].classId, 'class-teacher-own', 'Must only process caller teacher classrooms');
}

async function testNonAdminCannotSpoofTeacherUidInSessionOrPattern() {
    const db = createFakeDb({
        [`${CRM_CLASSROOMS}/class-spoof-target`]: {
            name: 'Spoof Target Class',
            primaryTeacherUid: 'teacher-normal',
            courseId: 'course-normal',
            createdAt: '2026-04-01T00:00:00.000Z',
            scheduleConfig: {
                totalInstructionMinutes: 300,
                sessionMinutes: 60,
                targetSessionCount: 5,
                timezone: 'Asia/Bangkok',
                seedWeekdays: ['mon'],
                seedStartTime: '09:00',
                scheduleVersion: 1
            },
            scheduleSummary: {
                contractedTargetCount: 5,
                contractedAssignedCount: 0,
                contractedCompletedCount: 0,
                remainingToScheduleCount: 5,
                overflowCount: 0
            }
        }
    });

    const teacherRouter = createTeacherSchedulerRouter({
        db,
        authMiddleware: (req, _res, next) => {
            req.user = { uid: 'teacher-normal', email: 'teacher@example.com', isTeacher: true, isAdmin: false };
            next();
        },
        sendSuccess: (res, data, message) => res.status(200).json({ success: true, ...(message ? { message } : {}), ...data }),
        sendError: (res, status, error, message, details) => res.status(status).json({ success: false, error, message, ...(details ? { details } : {}) }),
        serverTimestamp: () => 'SERVER_TS'
    });

    // 1. Non-admin POST /classrooms/:classId/sessions/add attempting to spoof teacherUid: 'teacher-other'
    const sessionHandlers = getRouteHandlers(teacherRouter, '/classrooms/:classId/sessions/add', 'post');
    const res1 = buildRes();
    await invokeHandlers(sessionHandlers, {
        params: { classId: 'class-spoof-target' },
        body: {
            teacherUid: 'teacher-other',
            targetLocalDate: '2026-04-06',
            targetLocalTime: '09:00',
            durationMinutes: 60
        }
    }, res1);

    assert.strictEqual(res1._status, 200);
    assert.strictEqual(res1._json.success, true);
    const createdSessionId = res1._json.sessionId;
    const sessionData = db.docs.get(`${CRM_SCHEDULED_SESSIONS}/${createdSessionId}`);
    assert.strictEqual(sessionData.teacherUid, 'teacher-normal', 'Non-admin caller cannot spoof teacherUid in single session');

    // 2. Non-admin POST /classrooms/:classId/sessions/add-multi attempting to spoof teacherUid: 'teacher-other'
    const patternHandlers = getRouteHandlers(teacherRouter, '/classrooms/:classId/sessions/add-multi', 'post');
    const res2 = buildRes();
    await invokeHandlers(patternHandlers, {
        params: { classId: 'class-spoof-target' },
        body: {
            teacherUid: 'teacher-other',
            from: '2026-04-13',
            to: '2026-04-19',
            startTime: '09:00',
            durationMinutes: 60,
            weekdays: ['mon']
        }
    }, res2);

    assert.strictEqual(res2._status, 200);
    assert.strictEqual(res2._json.success, true);
    const patternSessions = Array.from(db.docs.entries())
        .filter(([k, v]) => k.startsWith(`${CRM_SCHEDULED_SESSIONS}/`) && v.scheduledLocalDate === '2026-04-13')
        .map(([, v]) => v);
    assert.strictEqual(patternSessions.length, 1);
    assert.strictEqual(patternSessions[0].teacherUid, 'teacher-normal', 'Non-admin caller cannot spoof teacherUid in pattern');

    // 3. Admin POST /classrooms/:classId/sessions/add passing teacherUid: 'all'
    const adminRouter = createTeacherSchedulerRouter({
        db,
        authMiddleware: (req, _res, next) => {
            req.user = { uid: 'admin-super', email: 'admin@example.com', isTeacher: false, isAdmin: true };
            next();
        },
        sendSuccess: (res, data, message) => res.status(200).json({ success: true, ...(message ? { message } : {}), ...data }),
        sendError: (res, status, error, message, details) => res.status(status).json({ success: false, error, message, ...(details ? { details } : {}) }),
        serverTimestamp: () => 'SERVER_TS'
    });
    const adminSessionHandlers = getRouteHandlers(adminRouter, '/classrooms/:classId/sessions/add', 'post');
    const res3 = buildRes();
    await invokeHandlers(adminSessionHandlers, {
        params: { classId: 'class-spoof-target' },
        body: {
            teacherUid: 'all',
            targetLocalDate: '2026-04-20',
            targetLocalTime: '09:00',
            durationMinutes: 60
        }
    }, res3);

    assert.strictEqual(res3._status, 200);
    const adminSessionId = res3._json.sessionId;
    const adminSessionData = db.docs.get(`${CRM_SCHEDULED_SESSIONS}/${adminSessionId}`);
    assert.strictEqual(adminSessionData.teacherUid, 'teacher-normal', 'Admin passing "all" must fall back to classroom primary teacher');

    // 4. Admin POST /classrooms/:classId/sessions/add-multi passing teacherUid: 'all'
    const adminPatternHandlers = getRouteHandlers(adminRouter, '/classrooms/:classId/sessions/add-multi', 'post');
    const res4 = buildRes();
    await invokeHandlers(adminPatternHandlers, {
        params: { classId: 'class-spoof-target' },
        body: {
            teacherUid: 'all',
            from: '2026-04-27',
            to: '2026-05-03',
            startTime: '09:00',
            durationMinutes: 60,
            weekdays: ['mon']
        }
    }, res4);

    assert.strictEqual(res4._status, 200);
    const adminPatternSessions = Array.from(db.docs.entries())
        .filter(([k, v]) => k.startsWith(`${CRM_SCHEDULED_SESSIONS}/`) && v.scheduledLocalDate === '2026-04-27')
        .map(([, v]) => v);
    assert.strictEqual(adminPatternSessions.length, 1);
    assert.strictEqual(adminPatternSessions[0].teacherUid, 'teacher-normal', 'Admin passing "all" in pattern must fall back to classroom primary teacher');
}

async function testTeacherRescheduleCancelOutcomeWithAllHealingAndAuth() {
    const db = createFakeDb({
        [`${CRM_CLASSROOMS}/class-heal-target`]: {
            name: 'Heal Target Class',
            primaryTeacherUid: 'teacher-owner',
            courseId: 'course-owner',
            createdAt: '2026-04-01T00:00:00.000Z',
            scheduleConfig: {
                totalInstructionMinutes: 300,
                sessionMinutes: 60,
                targetSessionCount: 5,
                timezone: 'Asia/Bangkok',
                seedWeekdays: ['mon'],
                seedStartTime: '09:00',
                scheduleVersion: 1
            },
            scheduleSummary: {
                contractedTargetCount: 5,
                contractedAssignedCount: 3,
                remainingToScheduleCount: 2,
                overflowCount: 0
            }
        },
        [`${CRM_SCHEDULED_SESSIONS}/session-all-resched`]: {
            sessionId: 'session-all-resched',
            classId: 'class-heal-target',
            teacherUid: 'all',
            unitType: 'contracted',
            status: 'scheduled',
            attendanceState: 'none',
            lockState: 'unlocked',
            timezone: 'Asia/Bangkok',
            durationMinutes: 60,
            scheduledStartAtUtc: '2026-04-06T02:00:00.000Z',
            scheduledEndAtUtc: '2026-04-06T03:00:00.000Z',
            scheduledLocalDate: '2026-04-06',
            scheduledLocalTime: '09:00'
        },
        [`${CRM_SCHEDULED_SESSIONS}/session-all-cancel`]: {
            sessionId: 'session-all-cancel',
            classId: 'class-heal-target',
            teacherUid: 'all',
            unitType: 'contracted',
            status: 'scheduled',
            attendanceState: 'none',
            lockState: 'unlocked',
            timezone: 'Asia/Bangkok',
            durationMinutes: 60,
            scheduledStartAtUtc: '2026-04-07T02:00:00.000Z',
            scheduledEndAtUtc: '2026-04-07T03:00:00.000Z',
            scheduledLocalDate: '2026-04-07',
            scheduledLocalTime: '09:00'
        },
        [`${CRM_SCHEDULED_SESSIONS}/session-all-outcome`]: {
            sessionId: 'session-all-outcome',
            classId: 'class-heal-target',
            teacherUid: 'all',
            unitType: 'contracted',
            status: 'scheduled',
            attendanceState: 'none',
            lockState: 'unlocked',
            timezone: 'Asia/Bangkok',
            durationMinutes: 60,
            scheduledStartAtUtc: '2026-04-08T02:00:00.000Z',
            scheduledEndAtUtc: '2026-04-08T03:00:00.000Z',
            scheduledLocalDate: '2026-04-08',
            scheduledLocalTime: '09:00'
        }
    });

    const teacherRouter = createTeacherSchedulerRouter({
        db,
        authMiddleware: (req, _res, next) => {
            req.user = { uid: 'teacher-owner', email: 'owner@example.com', isTeacher: true, isAdmin: false };
            next();
        },
        sendSuccess: (res, data, message) => res.status(200).json({ success: true, ...(message ? { message } : {}), ...data }),
        sendError: (res, status, error, message, details) => res.status(status).json({ success: false, error, message, ...(details ? { details } : {}) }),
        serverTimestamp: () => 'SERVER_TS'
    });

    // 1. Primary teacher can reschedule session that has teacherUid: 'all', and it heals to teacher-owner
    const reschedHandlers = getRouteHandlers(teacherRouter, '/sessions/:sessionId/reschedule', 'patch');
    const res1 = buildRes();
    await invokeHandlers(reschedHandlers, {
        params: { sessionId: 'session-all-resched' },
        body: {
            targetLocalDate: '2026-04-13',
            targetLocalTime: '09:00',
            durationMinutes: 60
        }
    }, res1);

    assert.strictEqual(res1._status, 200);
    const sessionAfterResched = db.docs.get(`${CRM_SCHEDULED_SESSIONS}/session-all-resched`);
    assert.strictEqual(sessionAfterResched.teacherUid, 'teacher-owner', 'Reschedule must heal "all" to primary teacher');

    // 2. Primary teacher can cancel session that has teacherUid: 'all'
    const cancelHandlers = getRouteHandlers(teacherRouter, '/sessions/:sessionId/cancel', 'post');
    const res2 = buildRes();
    await invokeHandlers(cancelHandlers, {
        params: { sessionId: 'session-all-cancel' }
    }, res2);

    assert.strictEqual(res2._status, 200);
    const sessionAfterCancel = db.docs.get(`${CRM_SCHEDULED_SESSIONS}/session-all-cancel`);
    assert.strictEqual(sessionAfterCancel.status, 'cancelled');

    // 3. Primary teacher can set outcome on session that has teacherUid: 'all'
    const outcomeHandlers = getRouteHandlers(teacherRouter, '/sessions/:sessionId/outcome', 'post');
    const res3 = buildRes();
    await invokeHandlers(outcomeHandlers, {
        params: { sessionId: 'session-all-outcome' },
        body: {
            outcome: 'completed',
            note: 'Well done'
        }
    }, res3);

    assert.strictEqual(res3._status, 200);
    const sessionAfterOutcome = db.docs.get(`${CRM_SCHEDULED_SESSIONS}/session-all-outcome`);
    assert.strictEqual(sessionAfterOutcome.sessionOutcome, 'completed');
    assert.strictEqual(sessionAfterOutcome.teacherUid, 'teacher-owner', 'Outcome must heal "all" to primary teacher');

    // 4. Non-owner teacher cannot edit this session (403 FORBIDDEN)
    const otherTeacherRouter = createTeacherSchedulerRouter({
        db,
        authMiddleware: (req, _res, next) => {
            req.user = { uid: 'teacher-other', email: 'other@example.com', isTeacher: true, isAdmin: false };
            next();
        },
        sendSuccess: (res, data, message) => res.status(200).json({ success: true, ...(message ? { message } : {}), ...data }),
        sendError: (res, status, error, message, details) => res.status(status).json({ success: false, error, message, ...(details ? { details } : {}) }),
        serverTimestamp: () => 'SERVER_TS'
    });
    const otherReschedHandlers = getRouteHandlers(otherTeacherRouter, '/sessions/:sessionId/reschedule', 'patch');
    const res4 = buildRes();
    await invokeHandlers(otherReschedHandlers, {
        params: { sessionId: 'session-all-resched' },
        body: {
            targetLocalDate: '2026-04-20',
            targetLocalTime: '09:00',
            durationMinutes: 60
        }
    }, res4);
    assert.strictEqual(res4._status, 403, 'Non-owner teacher must be forbidden from editing sessions');
}

(async () => {
    await testAddMultiPersistsPattern();
    await testTeacherOutcomeUpdatesContractCounting();
    await testTeacherApiErrorMessages();
    await testAdminCanManageAllTeacherSchedules();
    await testAdminRecurrenceActivationForSpecificTeacherAndBatchChunking();
    await testNonAdminCannotSpoofTeacherUidInRecurrenceActivation();
    await testNonAdminCannotSpoofTeacherUidInSessionOrPattern();
    await testTeacherRescheduleCancelOutcomeWithAllHealingAndAuth();
    process.stdout.write('teacher scheduler behavior passed\n');
})().catch((error) => {
    process.stderr.write(`${error.stack || error}\n`);
    process.exit(1);
});
