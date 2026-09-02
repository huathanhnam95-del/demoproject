/* eslint-disable no-console */
const assert = require('assert');
const path = require('path');

const registerBookRoutes = require(path.resolve(__dirname, '../../functions/src/routes/admin/books.js'));

const handlers = { get: [], post: [], patch: [] };
const router = {
    get(pathname, ...routeHandlers) {
        handlers.get.push({ pathname, routeHandlers, handler: routeHandlers[routeHandlers.length - 1] });
    },
    post(pathname, ...routeHandlers) {
        handlers.post.push({ pathname, routeHandlers, handler: routeHandlers[routeHandlers.length - 1] });
    },
    delete() {},
    patch(pathname, ...routeHandlers) {
        handlers.patch.push({ pathname, routeHandlers, handler: routeHandlers[routeHandlers.length - 1] });
    }
};

const adminGuard = (req, res, next) => next ? next() : undefined;
let auditLogs = [];

function createMockDb(initialData = {}) {
    const dataStore = JSON.parse(JSON.stringify(initialData));

    function getDoc(pathParts) {
        let curr = dataStore;
        for (const p of pathParts) {
            if (!curr[p]) curr[p] = {};
            curr = curr[p];
        }
        return curr;
    }

    function applyPatch(target, patch) {
        for (const [k, v] of Object.entries(patch)) {
            if (k.includes('.')) {
                const parts = k.split('.');
                let curr = target;
                for (let i = 0; i < parts.length - 1; i++) {
                    if (!curr[parts[i]]) curr[parts[i]] = {};
                    curr = curr[parts[i]];
                }
                curr[parts[parts.length - 1]] = v;
            } else {
                target[k] = v;
            }
        }
    }

    const db = {
        _data: dataStore,
        collection(name) {
            return {
                doc(id) {
                    const bookPath = [name, id];
                    return {
                        async get() {
                            const d = getDoc(bookPath);
                            const exists = Object.keys(d).length > 0 && !d._deleted;
                            return { exists, data: () => JSON.parse(JSON.stringify(d)) };
                        },
                        async update(patch) {
                            const d = getDoc(bookPath);
                            applyPatch(d, patch);
                        },
                        collection(subName) {
                            return {
                                doc(subId) {
                                    const subPath = [name, id, subName, subId];
                                    return {
                                        async get() {
                                            const d = getDoc(subPath);
                                            const exists = Object.keys(d).length > 0 && !d._deleted;
                                            return { exists, data: () => JSON.parse(JSON.stringify(d)) };
                                        },
                                        async update(patch) {
                                            const d = getDoc(subPath);
                                            applyPatch(d, patch);
                                        }
                                    };
                                },
                                async get() {
                                    const subStore = getDoc([name, id, subName]);
                                    const matching = [];
                                    for (const [k, v] of Object.entries(subStore)) {
                                        if (v && !v._deleted) {
                                            matching.push({ id: k, data: () => JSON.parse(JSON.stringify(v)) });
                                        }
                                    }
                                    return { empty: matching.length === 0, docs: matching };
                                },
                                where(field, op, val) {
                                    return {
                                        async get() {
                                            const subStore = getDoc([name, id, subName]);
                                            const matching = [];
                                            for (const [k, v] of Object.entries(subStore)) {
                                                if (v && !v._deleted) {
                                                    if (op === 'in' && Array.isArray(val) && val.includes(v[field])) {
                                                        matching.push({ id: k, data: () => JSON.parse(JSON.stringify(v)) });
                                                    } else if (op === '==' && v[field] === val) {
                                                        matching.push({ id: k, data: () => JSON.parse(JSON.stringify(v)) });
                                                    }
                                                }
                                            }
                                            return { empty: matching.length === 0, docs: matching };
                                        }
                                    };
                                }
                            };
                        }
                    };
                }
            };
        },
        async runTransaction(callback) {
            const txn = {
                async get(ref) { return ref.get(); },
                set(ref, data) { ref.update ? ref.update(data) : undefined; },
                update(ref, patch) { ref.update ? ref.update(patch) : undefined; }
            };
            return callback(txn);
        }
    };
    return db;
}

const db = createMockDb({
    crmBooks: {
        'book-test-1': {
            title: 'Sample Book',
            status: 'ready',
            activeTextRevisionId: null,
            source: {
                storagePath: 'crm-books/book-test-1/source.pdf',
                sha256: 'sha-valid-123',
                generation: '1001',
                sizeBytes: 5000000,
                pageCount: 10
            },
            textRevisions: {
                'rev-candidate-1': {
                    revisionId: 'rev-candidate-1',
                    bookId: 'book-test-1',
                    stage: 'ready_for_activation',
                    status: 'ready',
                    source: { sha256: 'sha-valid-123', generation: '1001' },
                    totalPages: 10,
                    pagesHash: 'hash-pages-10',
                    manifest: { hash: 'manifest-hash-abc' },
                    createdAt: '2026-09-01T00:00:00Z',
                    updatedAt: '2026-09-01T00:00:00Z'
                }
            }
        }
    }
});

const mockFiles = {
    'crm-books/book-test-1/pages.json': Buffer.from(JSON.stringify({
        totalPages: 2,
        pages: ['Legacy page 1', 'Legacy page 2'],
        rendererContract: 'legacy'
    })),
    'crm-books/book-test-1/text-revisions/rev-candidate-1/pages.json': Buffer.from(JSON.stringify({
        totalPages: 2,
        pages: ['OCR-v2 page 1', 'OCR-v2 page 2'],
        rendererContract: 'ocr-v2',
        schemaVersion: '2.0',
        pagesHash: 'hash-pages-10'
    }))
};

const mockStorage = {
    file(name) {
        return {
            async exists() {
                return [Boolean(mockFiles[name])];
            },
            async download() {
                if (!mockFiles[name]) throw new Error(`File ${name} not found`);
                return [mockFiles[name]];
            }
        };
    }
};

registerBookRoutes(router, {
    db,
    sendSuccess: (res, data) => res.json({ success: true, ...data }),
    sendError: (res, status, error, message) => res.status(status).json({ success: false, error, message }),
    requireAdminHandlers: [adminGuard],
    serverTimestamp: () => 'SERVER_TIMESTAMP',
    writeAuditLog: async (entry) => { auditLogs.push(entry); },
    getStorageBucket: async () => mockStorage
});

async function invoke(routeEntry, { params = {}, body = {}, user = { uid: 'admin-1' } } = {}) {
    const response = {
        statusCode: 200,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; return payload; }
    };
    await routeEntry.handler({ params, body, user }, response);
    return response;
}

async function runTests() {
    console.log('Testing book text revision admin API endpoints...');

    // 1. Check route registrations and admin guards
    const listRoute = handlers.get.find((e) => e.pathname === '/books/:bookId/text-revisions');
    assert.ok(listRoute, 'GET /books/:bookId/text-revisions must be registered');
    assert.strictEqual(listRoute.routeHandlers[0], adminGuard);

    const postRevRoute = handlers.post.find((e) => e.pathname === '/books/:bookId/text-revisions');
    assert.ok(postRevRoute, 'POST /books/:bookId/text-revisions must be registered');

    const getRevRoute = handlers.get.find((e) => e.pathname === '/books/:bookId/text-revisions/:revisionId');
    assert.ok(getRevRoute, 'GET /books/:bookId/text-revisions/:revisionId must be registered');

    const activateRoute = handlers.post.find((e) => e.pathname === '/books/:bookId/text-revisions/:revisionId/activate');
    assert.ok(activateRoute, 'POST /books/:bookId/text-revisions/:revisionId/activate must be registered');

    const rollbackRoute = handlers.post.find((e) => e.pathname === '/books/:bookId/text-revisions/:revisionId/rollback');
    assert.ok(rollbackRoute, 'POST /books/:bookId/text-revisions/:revisionId/rollback must be registered');

    const pagesRoute = handlers.get.find((e) => e.pathname === '/books/:bookId/pages');
    assert.ok(pagesRoute, 'GET /books/:bookId/pages must be registered');

    // 2. Initial pages request returns legacy contract
    let pagesRes = await invoke(pagesRoute, { params: { bookId: 'book-test-1' } });
    assert.strictEqual(pagesRes.statusCode, 200);
    assert.strictEqual(pagesRes.body.textRevisionId, 'legacy');
    assert.strictEqual(pagesRes.body.pages[0], 'Legacy page 1');

    // 3. List text revisions
    const listRes = await invoke(listRoute, { params: { bookId: 'book-test-1' } });
    assert.strictEqual(listRes.statusCode, 200);
    assert.strictEqual(listRes.body.revisions.length, 1);
    assert.strictEqual(listRes.body.revisions[0].revisionId, 'rev-candidate-1');

    // 4. Get specific revision details
    const getRes = await invoke(getRevRoute, { params: { bookId: 'book-test-1', revisionId: 'rev-candidate-1' } });
    assert.strictEqual(getRes.statusCode, 200);
    assert.strictEqual(getRes.body.revision.revisionId, 'rev-candidate-1');
    assert.strictEqual(getRes.body.revision.status, 'ready');

    // 5. Activate candidate revision
    const activateRes = await invoke(activateRoute, {
        params: { bookId: 'book-test-1', revisionId: 'rev-candidate-1' },
        body: {
            expectedCurrentRevisionId: null,
            expectedSourceSha256: 'sha-valid-123',
            manifestHash: 'manifest-hash-abc'
        }
    });
    assert.strictEqual(activateRes.statusCode, 200);
    assert.strictEqual(activateRes.body.activeTextRevisionId, 'rev-candidate-1');
    assert.strictEqual(db._data.crmBooks['book-test-1'].activeTextRevisionId, 'rev-candidate-1');

    // 6. Pages request now resolves active revision (OCR-v2)
    pagesRes = await invoke(pagesRoute, { params: { bookId: 'book-test-1' } });
    assert.strictEqual(pagesRes.statusCode, 200);
    assert.strictEqual(pagesRes.body.textRevisionId, 'rev-candidate-1');
    assert.strictEqual(pagesRes.body.rendererContract, 'ocr-v2');
    assert.strictEqual(pagesRes.body.pages[0], 'OCR-v2 page 1');

    // 7. Rollback endpoint
    const rollbackRes = await invoke(rollbackRoute, {
        params: { bookId: 'book-test-1', revisionId: 'rev-candidate-1' },
        body: {
            expectedCurrentRevisionId: 'rev-candidate-1',
            reason: 'Rollback test'
        }
    });
    assert.strictEqual(rollbackRes.statusCode, 200);

    // Audit log check
    assert.ok(auditLogs.some((l) => l.action === 'activate_text_revision'));
    assert.ok(auditLogs.some((l) => l.action === 'rollback_text_revision'));

    console.log('book text revision admin API route tests passed');
}

runTests().catch((error) => {
    console.error(error.stack || error);
    process.exitCode = 1;
});
