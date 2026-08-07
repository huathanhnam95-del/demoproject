/* eslint-disable no-console */
const assert = require('assert');
const path = require('path');

const registerBookRoutes = require(path.resolve(__dirname, '../../functions/src/routes/admin/books.js'));

const handlers = { patch: [] };
const router = {
    get() {},
    post() {},
    delete() {},
    patch(pathname, ...routeHandlers) {
        handlers.patch.push({ pathname, routeHandlers, handler: routeHandlers[routeHandlers.length - 1] });
    }
};

let updatedPayload = null;
let threadExists = true;
const threadRef = {
    get: async () => ({ exists: threadExists, data: () => ({ title: 'Old title', messageCount: 2 }) }),
    update: async (payload) => { updatedPayload = payload; }
};
const adminGuard = () => undefined;
const db = {
    collection(name) {
        assert.strictEqual(name, 'crmBooks');
        return {
            doc(bookId) {
                assert.strictEqual(bookId, 'book-1');
                return { collection: (subcollection) => {
                    assert.strictEqual(subcollection, 'threads');
                    return { doc: (threadId) => {
                        assert.strictEqual(threadId, 'thread-1');
                        return threadRef;
                    } };
                } };
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
    writeAuditLog: async () => undefined,
    getStorageBucket: null
});

const renameRoute = handlers.patch.find((entry) => entry.pathname === '/books/:bookId/threads/:threadId');
assert(renameRoute, 'Books routes must register the thread rename PATCH endpoint.');
assert.strictEqual(renameRoute.routeHandlers[0], adminGuard, 'Thread rename must retain the existing admin guard.');

async function invoke(body) {
    const response = {
        statusCode: 200,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; return payload; }
    };
    await renameRoute.handler({
        params: { bookId: 'book-1', threadId: 'thread-1' },
        body,
        user: { uid: 'admin-1' }
    }, response);
    return response;
}

(async () => {
    let response = await invoke({ title: '  Renamed thread  ' });
    assert.strictEqual(response.statusCode, 200);
    assert.deepStrictEqual(response.body.thread, { threadId: 'thread-1', title: 'Renamed thread' });
    assert.strictEqual(updatedPayload.title, 'Renamed thread');

    response = await invoke({ title: '   ' });
    assert.strictEqual(response.statusCode, 400, 'Blank thread titles must be rejected.');

    response = await invoke({ title: 'x'.repeat(121) });
    assert.strictEqual(response.statusCode, 400, 'Oversized thread titles must be rejected.');

    threadExists = false;
    response = await invoke({ title: 'Missing thread' });
    assert.strictEqual(response.statusCode, 404, 'Missing threads must return 404.');

    console.log('books route rename contracts passed');
})().catch((error) => {
    console.error(error.stack || error);
    process.exitCode = 1;
});
