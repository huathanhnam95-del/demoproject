const assert = require('assert');
const express = require('express');

const createStudentRoutes = require('../../functions/src/routes/admin/students');
const { CRM_STUDENTS, CRM_COUNTERS } = require('../../functions/src/crm/collections');

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

function getRouteHandlers(router, path, method) {
    const layer = (router.stack || []).find((entry) =>
        entry.route
        && entry.route.path === path
        && Array.isArray(entry.route.stack)
        && entry.route.stack.some((step) => step.method === method)
    );
    assert(layer, `Route ${path} not found`);
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
    const docs = new Map(Object.entries(initialDocs));
    const counters = new Map();
    let autoId = 0;

    function listCollectionDocs(collectionName) {
        return Array.from(docs.entries())
            .filter(([key]) => key.startsWith(`${collectionName}/`))
            .map(([key, value]) => ({
                id: key.slice(collectionName.length + 1),
                data: clone(value)
            }));
    }

    function makeRef(collectionName, docId) {
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

    function makeQuery(collectionName, filters = [], orderByField = null, orderByDirection = 'asc') {
        return {
            where(field, op, value) {
                return makeQuery(collectionName, filters.concat([{ field, op, value }]), orderByField, orderByDirection);
            },
            orderBy(field, direction = 'asc') {
                return makeQuery(collectionName, filters, field, direction);
            },
            limit() {
                return this;
            },
            async get() {
                let rows = listCollectionDocs(collectionName).map((row) => ({
                    id: row.id,
                    data: () => clone(row.data)
                }));

                for (const filter of filters) {
                    rows = rows.filter((row) => {
                        const data = row.data() || {};
                        if (filter.op !== '==') {
                            throw new Error(`Unsupported operator in fake db: ${filter.op}`);
                        }
                        return String(data[filter.field] || '') === String(filter.value || '');
                    });
                }

                if (orderByField) {
                    rows.sort((left, right) => {
                        const a = left.data()?.[orderByField];
                        const b = right.data()?.[orderByField];
                        const leftValue = a?.toMillis ? a.toMillis() : new Date(a || 0).getTime?.() || 0;
                        const rightValue = b?.toMillis ? b.toMillis() : new Date(b || 0).getTime?.() || 0;
                        return orderByDirection === 'desc' ? rightValue - leftValue : leftValue - rightValue;
                    });
                }

                return { docs: rows };
            }
        };
    }

    return {
        docs,
        collection(collectionName) {
            return {
                doc(docId) {
                    if (!docId) {
                        autoId += 1;
                        docId = `${collectionName}-auto-${autoId}`;
                    }
                    return makeRef(collectionName, docId);
                },
                where(field, op, value) {
                    return makeQuery(collectionName, [{ field, op, value }]);
                },
                orderBy(field, direction = 'asc') {
                    return makeQuery(collectionName, [], field, direction);
                },
                async get() {
                    return makeQuery(collectionName).get();
                }
            };
        },
        async runTransaction(handler) {
            const tx = {
                async get(ref) {
                    return ref.get();
                },
                set(ref, data, options) {
                    return ref.set(data, options);
                }
            };
            return handler(tx);
        }
    };
}

(async () => {
    const db = createFakeDb({
        [`${CRM_COUNTERS}/crmId`]: { nextIndex: 1 },
        [`${CRM_STUDENTS}/student-1`]: {
            name: 'Alice Nguyen',
            email: 'alice@example.com',
            lifecycleStage: 'potential',
            crmId: 'a0001',
            createdAt: 'SERVER_TS'
        },
        [`${CRM_STUDENTS}/student-legacy`]: {
            name: 'Legacy Student',
            email: 'legacy@example.com',
            lifecycleStage: 'enrolled',
            createdAt: '2026-01-01T00:00:00.000Z'
        },
        [`${CRM_STUDENTS}/student-upper`]: {
            name: 'Uppercase CRM ID',
            email: 'upper@example.com',
            lifecycleStage: 'potential',
            crmId: 'A0004',
            createdAt: '2026-01-04T00:00:00.000Z'
        }
    });

    const router = express.Router();
    createStudentRoutes(router, {
        db,
        admin: {},
        authMiddleware: (req, _res, next) => {
            req.user = { uid: 'admin-1', email: 'admin@example.com' };
            next();
        },
        adminMiddleware: (req, _res, next) => next(),
        sendSuccess: (res, data, message) => res.status(200).json({ success: true, ...(message ? { message } : {}), ...data }),
        sendError: (res, status, error, message, details) => res.status(status).json({ success: false, error, message, ...(details ? { details } : {}) }),
        requireAdminHandlers: [
            (req, _res, next) => {
                req.user = { uid: 'admin-1', email: 'admin@example.com' };
                next();
            }
        ],
        serverTimestamp: () => 'SERVER_TS',
        writeAuditLog: async () => null
    });

    const lookupHandlers = getRouteHandlers(router, '/students/by-crm-id/:crmId', 'get');
    assert(lookupHandlers.length > 0, 'Expected CRM-ID lookup route to be mounted.');
    const lookupRes = buildRes();
    await invokeHandlers(lookupHandlers, { params: { crmId: 'a0001' } }, lookupRes);
    assert.strictEqual(lookupRes._status, 200);
    assert.strictEqual(lookupRes._json.student.crmId, 'a0001');
    assert.strictEqual(lookupRes._json.student.studentId, 'student-1');

    const uppercaseLookupRes = buildRes();
    await invokeHandlers(lookupHandlers, { params: { crmId: 'a0004' } }, uppercaseLookupRes);
    assert.strictEqual(uppercaseLookupRes._status, 200);
    assert.strictEqual(uppercaseLookupRes._json.student.crmId, 'a0004');
    assert.strictEqual(uppercaseLookupRes._json.student.studentId, 'student-upper');
    assert.strictEqual(db.docs.get(`${CRM_STUDENTS}/student-upper`).crmId, 'A0004', 'Read-only lookup must not rewrite stored casing.');

    const listHandlers = getRouteHandlers(router, '/students', 'get');
    assert(listHandlers.length > 0, 'Expected student list route to be mounted.');
    const listRes = buildRes();
    await invokeHandlers(listHandlers, {}, listRes);
    assert.strictEqual(listRes._status, 200);
    const legacyRow = Array.isArray(listRes._json.students)
        ? listRes._json.students.find((student) => student.studentId === 'student-legacy')
        : null;
    assert(legacyRow, 'Expected legacy student to be returned in the list.');
    assert.strictEqual(legacyRow.crmId, null);
    assert.strictEqual(db.docs.get(`${CRM_STUDENTS}/student-legacy`).crmId, undefined, 'Listing students must not allocate a legacy ID.');
    assert.strictEqual(db.docs.get(`${CRM_COUNTERS}/crmId`).nextIndex, 1, 'GET must not advance the counter.');

    const createHandlers = getRouteHandlers(router, '/students', 'post');
    assert(createHandlers.length > 0, 'Expected student create route to be mounted.');
    const createRes = buildRes();
    await invokeHandlers(createHandlers, {
        body: {
            name: 'Bob Tran',
            email: 'bob@example.com'
        }
    }, createRes);

    assert.strictEqual(createRes._status, 200);
    assert.strictEqual(createRes._json.success, true);
    assert.ok(String(createRes._json.studentId || '').trim(), 'Create response should include a studentId.');
    assert.strictEqual(createRes._json.student.studentId, createRes._json.studentId);
    assert.strictEqual(createRes._json.student.crmId, 'a0002');

    const duplicateDb = createFakeDb({
        [`${CRM_COUNTERS}/crmId`]: { nextIndex: 20 },
        [`${CRM_STUDENTS}/student-a`]: {
            name: 'Duplicate One',
            crmId: 'a0021',
            createdAt: '2026-01-02T00:00:00.000Z'
        },
        [`${CRM_STUDENTS}/student-b`]: {
            name: 'Duplicate Two',
            crmId: 'A0021',
            createdAt: '2026-01-03T00:00:00.000Z'
        }
    });
    const duplicateRouter = express.Router();
    createStudentRoutes(duplicateRouter, {
        db: duplicateDb,
        admin: {},
        authMiddleware: (req, _res, next) => {
            req.user = { uid: 'admin-1', email: 'admin@example.com' };
            next();
        },
        adminMiddleware: (req, _res, next) => next(),
        sendSuccess: (res, data, message) => res.status(200).json({ success: true, ...(message ? { message } : {}), ...data }),
        sendError: (res, status, error, message, details) => res.status(status).json({ success: false, error, message, ...(details ? { details } : {}) }),
        requireAdminHandlers: [
            (req, _res, next) => {
                req.user = { uid: 'admin-1', email: 'admin@example.com' };
                next();
            }
        ],
        serverTimestamp: () => 'SERVER_TS',
        writeAuditLog: async () => null
    });
    const duplicateHandlers = getRouteHandlers(duplicateRouter, '/students/by-crm-id/:crmId', 'get');
    const duplicateRes = buildRes();
    await invokeHandlers(duplicateHandlers, { params: { crmId: 'a0021' } }, duplicateRes);
    assert.strictEqual(duplicateRes._status, 409);

    console.log('student route deep link contract passed');
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
