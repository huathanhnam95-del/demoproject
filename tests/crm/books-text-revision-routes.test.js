const assert = require('assert');
const path = require('path');

const registerBookRoutes = require(path.resolve(__dirname, '../../functions/src/routes/admin/books.js'));

const handlers = { get: [], post: [], patch: [], delete: [] };
const router = {
    get(pathname, ...routeHandlers) {
        handlers.get.push({ pathname, routeHandlers, handler: routeHandlers[routeHandlers.length - 1] });
    },
    post(pathname, ...routeHandlers) {
        handlers.post.push({ pathname, routeHandlers, handler: routeHandlers[routeHandlers.length - 1] });
    },
    delete(pathname, ...routeHandlers) {
        handlers.delete.push({ pathname, routeHandlers, handler: routeHandlers[routeHandlers.length - 1] });
    },
    patch(pathname, ...routeHandlers) {
        handlers.patch.push({ pathname, routeHandlers, handler: routeHandlers[routeHandlers.length - 1] });
    }
};

const adminGuard = (req, res, next) => {
    if (!req.user || !req.user.admin) {
        return res.status(403).json({ success: false, error: 'FORBIDDEN' });
    }
    if (next) next();
};

const store = new Map();
function getDoc(pathStr) {
    if (!store.has(pathStr)) store.set(pathStr, { data: {}, exists: false });
    return store.get(pathStr);
}

function docRef(collectionPath, docId) {
    const fullPath = `${collectionPath}/${docId}`;
    return {
        id: docId,
        path: fullPath,
        async get() {
            const entry = getDoc(fullPath);
            return { id: docId, exists: entry.exists, data: () => ({ ...entry.data }) };
        },
        async set(data, options = {}) {
            const entry = getDoc(fullPath);
            entry.data = options.merge ? { ...entry.data, ...data } : { ...data };
            entry.exists = true;
        },
        async update(data) {
            const entry = getDoc(fullPath);
            if (!entry.exists) throw new Error(`Document ${fullPath} not found`);
            entry.data = { ...entry.data, ...data };
        },
        collection(subName) {
            return collectionRef(`${fullPath}/${subName}`);
        }
    };
}

function collectionRef(collectionPath) {
    return {
        path: collectionPath,
        doc(docId) { return docRef(collectionPath, docId); },
        async get() {
            const prefix = `${collectionPath}/`;
            const docs = [];
            for (const [key, entry] of store.entries()) {
                if (key.startsWith(prefix) && entry.exists) {
                    const rem = key.slice(prefix.length);
                    if (!rem.includes('/')) {
                        docs.push({ id: rem, exists: true, data: () => ({ ...entry.data }) });
                    }
                }
            }
            return { docs, empty: docs.length === 0 };
        }
    };
}

const db = {
    collection(name) { return collectionRef(name); },
    batch() {
        return {
            set(ref, data) { ref.set(data); },
            update(ref, data) { ref.update(data); },
            delete(ref) {
                const entry = getDoc(ref.path);
                entry.exists = false;
            },
            async commit() {}
        };
    },
    async runTransaction(callback) {
        const txn = {
            async get(ref) { return ref.get(); },
            set(ref, data, opts) { return ref.set(data, opts); },
            update(ref, data) { return ref.update(data); },
            delete(ref) {
                const entry = getDoc(ref.path);
                entry.exists = false;
            }
        };
        return callback(txn);
    }
};

const fakeStorage = {
    file(storagePath) {
        return {
            async exists() {
                return [store.has(`storage:${storagePath}`)];
            },
            async download() {
                const data = store.get(`storage:${storagePath}`);
                return [Buffer.from(JSON.stringify(data))];
            }
        };
    }
};

registerBookRoutes(router, {
    db,
    sendSuccess: (res, data, msg) => res.json({ success: true, ...data, message: msg }),
    sendError: (res, status, error, message) => res.status(status).json({ success: false, error, message }),
    requireAdminHandlers: [adminGuard],
    serverTimestamp: () => 'SERVER_TIMESTAMP',
    writeAuditLog: async () => undefined,
    getStorageBucket: async () => fakeStorage
});

async function runRouteTests() {
    console.log('--- Testing Books Text Revision Routes ---');

    const bookId = 'book-route-test-1';
    await db.collection('crmBooks').doc(bookId).set({
        title: 'Route Test Book',
        status: 'ready',
        activeTextRevisionId: null,
        source: { storagePath: `crm-books/${bookId}/source.pdf` }
    });

    const getRevisionRoute = handlers.get.find((e) => e.pathname === '/books/:bookId/text-revisions/:revisionId');
    assert(getRevisionRoute, 'Must register GET /books/:bookId/text-revisions/:revisionId');

    const activateRoute = handlers.post.find((e) => e.pathname === '/books/:bookId/text-revisions/:revisionId/activate');
    assert(activateRoute, 'Must register POST /books/:bookId/text-revisions/:revisionId/activate');

    const rollbackRoute = handlers.post.find((e) => e.pathname === '/books/:bookId/text-revisions/:revisionId/rollback');
    assert(rollbackRoute, 'Must register POST /books/:bookId/text-revisions/:revisionId/rollback');

    const pagesRoute = handlers.get.find((e) => e.pathname === '/books/:bookId/pages');
    assert(pagesRoute, 'Must register GET /books/:bookId/pages');

    function makeRes() {
        return {
            statusCode: 200,
            body: null,
            status(code) { this.statusCode = code; return this; },
            json(data) { this.body = data; return data; }
        };
    }

    // Seed Revision
    const revRef = db.collection('crmBooks').doc(bookId).collection('textRevisions').doc('rev-001');
    await revRef.set({
        status: 'ready_for_activation',
        stage: 'candidate_verify',
        pageCount: 10
    });

    // Seed Pages in Storage
    store.set(`storage:crm-books/${bookId}/pages.json`, { totalPages: 10, pages: ['Legacy page 1'] });
    store.set(`storage:crm-books/${bookId}/text-revisions/rev-001/pages.json`, {
        totalPages: 10,
        pages: ['OCR-v2 page 1'],
        rendererContract: 'ocr-v2',
        sourceSha256: 'a'.repeat(64)
    });

    // Test 1: GET pages when in legacy mode returns legacy contract
    console.log('Test 1: GET /books/:bookId/pages returns legacy contract when activeTextRevisionId is null');
    let res = makeRes();
    await pagesRoute.handler({ params: { bookId }, user: { admin: true } }, res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.rendererContract, 'legacy');
    assert.strictEqual(res.body.pages[0], 'Legacy page 1');

    // Test 2: Activate requires valid manifest hash
    console.log('Test 2: Activation fails without valid 64-char hex manifestHash');
    res = makeRes();
    await activateRoute.handler({
        params: { bookId, revisionId: 'rev-001' },
        body: { manifestHash: 'invalid_short_hash' },
        user: { admin: true }
    }, res);
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.error, 'INVALID_MANIFEST_HASH');

    // Test 3: Activate succeeds with valid manifest hash
    console.log('Test 3: Activation succeeds with valid 64-char hex manifestHash');
    const validHash = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
    res = makeRes();
    await activateRoute.handler({
        params: { bookId, revisionId: 'rev-001' },
        body: { manifestHash: validHash },
        user: { admin: true }
    }, res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.activeTextRevisionId, 'rev-001');

    const bookDoc = await db.collection('crmBooks').doc(bookId).get();
    assert.strictEqual(bookDoc.data().activeTextRevisionId, 'rev-001');

    // Test 4: GET pages now returns active revision OCR-v2 contract
    console.log('Test 4: GET /books/:bookId/pages returns ocr-v2 contract after activation');
    res = makeRes();
    await pagesRoute.handler({ params: { bookId }, user: { admin: true } }, res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.rendererContract, 'ocr-v2');
    assert.strictEqual(res.body.textRevisionId, 'rev-001');
    assert.strictEqual(res.body.pages[0], 'OCR-v2 page 1');

    // Test 5: Rollback resets pointer to legacy
    console.log('Test 5: Rollback resets activeTextRevisionId');
    res = makeRes();
    await rollbackRoute.handler({
        params: { bookId, revisionId: 'rev-001' },
        body: { targetRevisionId: null },
        user: { admin: true }
    }, res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.activeTextRevisionId, null);

    const rolledBackBookDoc = await db.collection('crmBooks').doc(bookId).get();
    assert.strictEqual(rolledBackBookDoc.data().activeTextRevisionId, null);

    console.log('All text revision route tests passed!');
}

runRouteTests().catch((err) => {
    console.error('Route tests failed:', err);
    process.exitCode = 1;
});
