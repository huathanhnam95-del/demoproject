const assert = require('assert');
const express = require('express');

const registerLeadRoutes = require('../../functions/src/routes/admin/leads');
const registerEntranceTestRoutes = require('../../functions/src/routes/admin/entrance-tests');
const { CRM_LEADS, CRM_STUDENTS, ENTRANCE_TESTS } = require('../../functions/src/crm/collections');

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

    function docKey(collectionName, docId) {
        return `${collectionName}/${docId}`;
    }

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
        throw new Error(`Unsupported operator in fake db: ${op}`);
    }

    function makeSnapshot(ref, collectionName, docId) {
        const key = docKey(collectionName, docId);
        const exists = docs.has(key);
        return {
            exists,
            id: docId,
            ref,
            data: () => clone(docs.get(key) || null)
        };
    }

    function makeDocRef(collectionName, docId) {
        const key = docKey(collectionName, docId);
        const ref = {
            id: docId,
            async get() {
                return makeSnapshot(ref, collectionName, docId);
            },
            async set(patch, options = {}) {
                const current = docs.get(key) || {};
                const next = options.merge ? { ...current, ...clone(patch) } : clone(patch);
                docs.set(key, next);
            },
            async update(patch) {
                if (!docs.has(key)) {
                    throw new Error(`Missing fake doc: ${key}`);
                }
                docs.set(key, { ...(docs.get(key) || {}), ...clone(patch) });
            }
        };
        return ref;
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
                    docs: rows.map((row) => {
                        const ref = makeDocRef(collectionName, row.id);
                        return {
                            id: row.id,
                            ref,
                            data: () => clone(row.data)
                        };
                    })
                };
            }
        };
    }

    function makeCollectionRef(collectionName) {
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

    return {
        docs,
        collection: makeCollectionRef,
        batch() {
            const operations = [];
            return {
                set(ref, patch, options = {}) {
                    operations.push({ ref, patch, options });
                },
                async commit() {
                    for (const operation of operations) {
                        await operation.ref.set(operation.patch, operation.options);
                    }
                }
            };
        },
        async runTransaction(callback) {
            const tx = {
                get(ref) {
                    return ref.get();
                },
                set(ref, patch, options = {}) {
                    return ref.set(patch, options);
                },
                update(ref, patch) {
                    return ref.update(patch);
                }
            };
            return callback(tx);
        }
    };
}

function createReq({ params = {}, body = {}, query = {}, headers = {}, ip = '127.0.0.1' } = {}) {
    const normalizedHeaders = Object.fromEntries(
        Object.entries(headers).map(([key, value]) => [String(key).toLowerCase(), value])
    );
    return {
        params,
        body,
        query,
        headers: normalizedHeaders,
        protocol: normalizedHeaders['x-forwarded-proto'] || 'https',
        ip,
        get(name) {
            return normalizedHeaders[String(name || '').toLowerCase()];
        }
    };
}

function createCrmRouter(db) {
    const router = express.Router();
    const deps = {
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
    };

    registerLeadRoutes(router, deps);
    registerEntranceTestRoutes(router, deps);
    return router;
}

async function callRoute(router, routePath, method, reqOptions) {
    const handlers = getRouteHandlers(router, routePath, method);
    const res = buildRes();
    await invokeHandlers(handlers, createReq(reqOptions), res);
    return res;
}

async function testLeadEntranceTestConversionKeepsLinkedRecords() {
    const db = createFakeDb({
        [`${CRM_LEADS}/lead-1`]: {
            name: 'Lead Nguyen',
            realName: 'Nguyen Van Lead',
            email: 'lead@example.com',
            phone: '0123',
            source: 'facebook',
            agentSourceId: 'agent-source-1',
            crmId: 'a0001',
            ownerUid: 'admin-1',
            stage: 'contacted',
            probability: 50,
            learningNeeds: 'Needs placement before IELTS class.',
            preferredLearningDays: ['Tuesday', 'Thursday'],
            preferredLearningHours: ['19:00-21:00'],
            createdAt: 'CREATED_TS'
        }
    });
    const router = createCrmRouter(db);

    const createTestRes = await callRoute(router, '/leads/:leadId/entrance-tests', 'post', {
        params: { leadId: 'lead-1' },
        body: { testType: 'segmental_screening_v1' },
        headers: { host: 'crm.local.test' }
    });
    assert.strictEqual(createTestRes._status, 200);
    assert.strictEqual(createTestRes._json.success, true);

    const testLink = createTestRes._json.testLink;
    const token = new URL(testLink).searchParams.get('token');
    const testId = createTestRes._json.testId;
    assert(token && token.length >= 10, 'Expected a reusable delivery token in the generated test link.');

    const createdLead = db.docs.get(`${CRM_LEADS}/lead-1`);
    assert.strictEqual(createdLead.stage, 'test_scheduled');
    assert.strictEqual(createdLead.crmId, 'a0001');

    const createdTest = db.docs.get(`${ENTRANCE_TESTS}/${testId}`);
    assert.strictEqual(createdTest.leadId, 'lead-1');
    assert.strictEqual(createdTest.crmId, 'a0001');
    assert.strictEqual(createdTest.studentId, null);
    assert.strictEqual(createdTest.status, 'created');
    assert.strictEqual(createdTest.testType, 'segmental_screening_v1');
    assert.strictEqual(createdTest.deliveryToken, token);

    const submitRes = await callRoute(router, '/entrance-tests/submit-segmental', 'post', {
        body: {
            token,
            results: { overall: 'b1', pronunciation: 72 },
            contrastSummaries: [{ contrast: '/i/ vs /ɪ/', status: 'watch' }]
        },
        headers: { 'user-agent': 'crm-route-test' }
    });
    assert.strictEqual(submitRes._status, 200);
    assert.strictEqual(submitRes._json.success, true);
    assert.strictEqual(db.docs.get(`${CRM_LEADS}/lead-1`).stage, 'test_completed');
    assert.strictEqual(db.docs.get(`${ENTRANCE_TESTS}/${testId}`).status, 'submitted');

    const convertRes = await callRoute(router, '/leads/:leadId/convert', 'post', {
        params: { leadId: 'lead-1' }
    });
    assert.strictEqual(convertRes._status, 200);
    assert.strictEqual(convertRes._json.success, true);

    const studentId = convertRes._json.student.studentId;
    const convertedLead = db.docs.get(`${CRM_LEADS}/lead-1`);
    const createdStudent = db.docs.get(`${CRM_STUDENTS}/${studentId}`);
    const linkedTest = db.docs.get(`${ENTRANCE_TESTS}/${testId}`);

    assert.strictEqual(convertedLead.stage, 'converted');
    assert.strictEqual(convertedLead.studentId, studentId);
    assert.strictEqual(convertedLead.crmId, 'a0001');
    assert.strictEqual(createdStudent.leadId, 'lead-1');
    assert.strictEqual(createdStudent.crmId, 'a0001');
    assert.strictEqual(createdStudent.agentSourceId, 'agent-source-1');
    assert.strictEqual(createdStudent.acquisitionSource, 'facebook');
    assert.strictEqual(linkedTest.leadId, 'lead-1');
    assert.strictEqual(linkedTest.studentId, studentId);
    assert.strictEqual(linkedTest.crmId, 'a0001');

    const studentTestsRes = await callRoute(router, '/students/:studentId/entrance-tests', 'get', {
        params: { studentId },
        headers: { host: 'crm.local.test' }
    });
    assert.strictEqual(studentTestsRes._status, 200);
    assert.strictEqual(studentTestsRes._json.success, true);
    assert.strictEqual(studentTestsRes._json.tests.length, 1);
    assert.strictEqual(studentTestsRes._json.tests[0].testId, testId);
    assert.strictEqual(studentTestsRes._json.tests[0].studentId, studentId);
    assert.strictEqual(studentTestsRes._json.tests[0].leadId, 'lead-1');
    assert(studentTestsRes._json.tests[0].resultLink.includes(`testId=${testId}`));
}

(async () => {
    await testLeadEntranceTestConversionKeepsLinkedRecords();
    process.stdout.write('lead entrance conversion route behavior passed\n');
})().catch((error) => {
    process.stderr.write(`${error.stack || error}\n`);
    process.exit(1);
});
