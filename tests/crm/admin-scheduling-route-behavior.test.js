const assert = require('assert');
const express = require('express');

const registerSchedulingRoutes = require('../../functions/src/routes/admin/scheduling');
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
        }
    };
}

function createSchedulingRouter(db) {
    const router = express.Router();
    registerSchedulingRoutes(router, {
        db,
        requireAdminHandlers: [
            (req, _res, next) => {
                req.user = { uid: 'admin-1', email: 'admin@example.com' };
                next();
            }
        ],
        sendSuccess: (res, data, message) => res.status(200).json({ success: true, ...(message ? { message } : {}), ...data }),
        sendError: (res, status, error, message, details) => res.status(status).json({ success: false, error, message, ...(details ? { details } : {}) }),
        serverTimestamp: () => 'SERVER_TS',
        writeAuditLog: async () => {}
    });
    return router;
}

async function testSeedRejectsAlreadySeededContractedClass() {
    const db = createFakeDb({
        [`${CRM_CLASSROOMS}/class-1`]: {
            name: 'IELTS Evening',
            courseId: 'course-1',
            primaryTeacherUid: 'teacher-1',
            scheduleConfig: {
                totalInstructionMinutes: 60,
                sessionMinutes: 60,
                targetSessionCount: 1,
                timezone: 'Asia/Bangkok',
                seedWeekdays: [1],
                seedStartTime: '09:00',
                scheduleVersion: 1
            },
            scheduleSummary: {
                contractedTargetCount: 1,
                contractedAssignedCount: 1,
                remainingToScheduleCount: 0,
                overflowCount: 0
            }
        },
        [`${CRM_SCHEDULED_SESSIONS}/session-1`]: {
            sessionId: 'session-1',
            classId: 'class-1',
            courseId: 'course-1',
            teacherUid: 'teacher-1',
            unitType: 'contracted',
            contractUnitIndex: 1,
            status: 'scheduled',
            attendanceState: 'none',
            lockState: 'unlocked',
            timezone: 'Asia/Bangkok',
            durationMinutes: 60,
            scheduledStartAtUtc: '2026-04-06T02:00:00.000Z',
            scheduledEndAtUtc: '2026-04-06T03:00:00.000Z',
            scheduledLocalDate: '2026-04-06',
            scheduledLocalTime: '09:00'
        }
    });

    const router = createSchedulingRouter(db);
    const handlers = getRouteHandlers(router, '/classrooms/:classId/sessions/seed', 'post');
    const res = buildRes();
    await invokeHandlers(handlers, {
        params: { classId: 'class-1' },
        body: {
            startDate: '2026-04-08',
            startTime: '10:00',
            weekdayNumbers: [3],
            teacherUid: 'teacher-1'
        }
    }, res);

    assert.strictEqual(res._status, 409);
    assert.strictEqual(res._json.error, 'SCHEDULE_ALREADY_SEEDED');
    const classSessionKeys = Array.from(db.docs.keys())
        .filter((key) => key.startsWith(`${CRM_SCHEDULED_SESSIONS}/`));
    assert.deepStrictEqual(classSessionKeys, [`${CRM_SCHEDULED_SESSIONS}/session-1`]);
}

(async () => {
    await testSeedRejectsAlreadySeededContractedClass();
    process.stdout.write('admin scheduling route behavior passed\n');
})().catch((error) => {
    process.stderr.write(`${error.stack || error}\n`);
    process.exit(1);
});
