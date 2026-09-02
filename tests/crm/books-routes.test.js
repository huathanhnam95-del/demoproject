/* eslint-disable no-console */
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


let updatedPayload = null;
let threadExists = true;
const threadRef = {
    get: async () => ({ exists: threadExists, data: () => ({ title: 'Old title', messageCount: 2 }) }),
    update: async (payload) => { updatedPayload = payload; }
};
const adminGuard = () => undefined;
const mockCollections = [
    { id: 'col-1', name: 'Pronunciation', bookIds: ['book-1'] }
];

const db = {
    collection(name) {
        if (name === 'crmBooks') {
            return {
                doc(bookId) {
                    return {
                        collection: (subcollection) => ({
                            doc: (threadId) => threadRef
                        }),
                        update: async () => {},
                        get: async () => ({ exists: true, data: () => ({ collectionId: 'col-1', tags: [] }) }),
                        delete: async () => {}
                    };
                },
                get: async () => ({ docs: [] })
            };
        }
        if (name === 'crmBookCollections') {
            return {
                orderBy: () => ({ limit: () => ({ get: async () => ({ docs: mockCollections.map(c => ({ id: c.id, ...c })) }) }) }),
                get: async () => ({
                    docs: mockCollections.map(c => ({
                        id: c.id,
                        ref: { update: async () => {} },
                        data: () => c
                    }))
                }),
                add: async (data) => {
                    const id = 'col-' + (mockCollections.length + 1);
                    const item = { id, ...data };
                    mockCollections.push(item);
                    return { id };
                },
                doc(colId) {
                    const found = mockCollections.find(c => c.id === colId);
                    return {
                        get: async () => ({ exists: Boolean(found), data: () => found || {} }),
                        update: async (patch) => { if (found) Object.assign(found, patch); },
                        delete: async () => {
                            const idx = mockCollections.findIndex(c => c.id === colId);
                            if (idx >= 0) mockCollections.splice(idx, 1);
                        }
                    };
                }
            };
        }
        if (name === 'crmBookTags') {
            return {
                get: async () => ({ docs: [] }),
                doc: () => ({
                    get: async () => ({ exists: true, data: () => ({ name: 'Test' }) }),
                    delete: async () => {}
                })
            };
        }
        return { doc: () => ({ get: async () => ({ exists: false }) }) };
    }
};

registerBookRoutes(router, {
    db,
    sendSuccess: (res, data, message) => res.json({ success: true, ...data, message }),
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

    const getNotesRoute = handlers.get.find((entry) => entry.pathname === '/books/:bookId/sections/:sectionIndex/study-notes');
    assert(getNotesRoute, 'Books routes must register GET study-notes endpoint.');
    assert.strictEqual(getNotesRoute.routeHandlers[0], adminGuard, 'GET study-notes must have admin guard.');

    const postNotesRoute = handlers.post.find((entry) => entry.pathname === '/books/:bookId/sections/:sectionIndex/study-notes');
    assert(postNotesRoute, 'Books routes must register POST study-notes endpoint.');
    assert.strictEqual(postNotesRoute.routeHandlers[0], adminGuard, 'POST study-notes must have admin guard.');

    const getTagsRoute = handlers.get.find((entry) => entry.pathname === '/book-tags');
    assert(getTagsRoute, 'Books routes must register GET /book-tags endpoint.');
    assert.strictEqual(getTagsRoute.routeHandlers[0], adminGuard, 'GET /book-tags must have admin guard.');

    const postTagsRoute = handlers.post.find((entry) => entry.pathname === '/book-tags');
    assert(postTagsRoute, 'Books routes must register POST /book-tags endpoint.');
    assert.strictEqual(postTagsRoute.routeHandlers[0], adminGuard, 'POST /book-tags must have admin guard.');

    const deleteTagsRoute = handlers.delete.find((entry) => entry.pathname === '/book-tags/:tagId');
    assert(deleteTagsRoute, 'Books routes must register DELETE /book-tags/:tagId endpoint.');
    assert.strictEqual(deleteTagsRoute.routeHandlers[0], adminGuard, 'DELETE /book-tags/:tagId must have admin guard.');

    const patchTagsRoute = handlers.patch.find((entry) => entry.pathname === '/books/:bookId/tags');
    assert(patchTagsRoute, 'Books routes must register PATCH /books/:bookId/tags endpoint.');
    assert.strictEqual(patchTagsRoute.routeHandlers[0], adminGuard, 'PATCH /books/:bookId/tags must have admin guard.');

    const patchColRoute = handlers.patch.find((entry) => entry.pathname === '/books/:bookId/collection');
    assert(patchColRoute, 'Books routes must register PATCH /books/:bookId/collection endpoint.');
    assert.strictEqual(patchColRoute.routeHandlers[0], adminGuard, 'PATCH /books/:bookId/collection must have admin guard.');

    const ensureSeedRoute = handlers.post.find((entry) => entry.pathname === '/books/ensure-seed');
    assert(ensureSeedRoute, 'Books routes must register POST /books/ensure-seed endpoint.');
    assert.strictEqual(ensureSeedRoute.routeHandlers[0], adminGuard, 'POST /books/ensure-seed must have admin guard.');

    // Validate duplicate collection creation rejection
    const postColRoute = handlers.post.find((entry) => entry.pathname === '/book-collections');
    assert(postColRoute, 'Books routes must register POST /book-collections endpoint.');

    const dupColResponse = {
        statusCode: 200,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; return payload; }
    };
    await postColRoute.handler({
        body: { name: 'Pronunciation' },
        user: { uid: 'admin-1' }
    }, dupColResponse);
    assert.strictEqual(dupColResponse.statusCode, 409, 'Duplicate collection name must return 409.');

    // Validate creating new collection
    const newColResponse = {
        statusCode: 200,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; return payload; }
    };
    await postColRoute.handler({
        body: { name: 'Acoustics' },
        user: { uid: 'admin-1' }
    }, newColResponse);
    assert.strictEqual(newColResponse.statusCode, 200, 'Valid collection creation must succeed.');
    assert.strictEqual(newColResponse.body.name, 'Acoustics');

    // Validate duplicate collection rename rejection
    const patchColRouteHandler = handlers.patch.find((entry) => entry.pathname === '/book-collections/:collectionId');
    assert(patchColRouteHandler, 'Books routes must register PATCH /book-collections/:collectionId endpoint.');
    const patchDupResponse = {
        statusCode: 200,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; return payload; }
    };
    await patchColRouteHandler.handler({
        params: { collectionId: 'col-2' },
        body: { name: 'Pronunciation' },
        user: { uid: 'admin-1' }
    }, patchDupResponse);
    assert.strictEqual(patchDupResponse.statusCode, 409, 'Renaming collection to an existing name must return 409.');

    console.log('books route rename, study-notes, collection and tag contracts passed');
})().catch((error) => {
    console.error(error.stack || error);
    process.exitCode = 1;
});

