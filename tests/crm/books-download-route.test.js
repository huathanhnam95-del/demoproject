/* eslint-disable no-console */
const assert = require('assert');
const path = require('path');

const registerBookRoutes = require(path.resolve(__dirname, '../../functions/src/routes/admin/books.js'));

const handlers = { get: [] };
const router = {
    get(pathname, ...routeHandlers) {
        handlers.get.push({ pathname, routeHandlers, handler: routeHandlers[routeHandlers.length - 1] });
    },
    post() {},
    patch() {},
    delete() {}
};

const bookRef = {
    exists: true,
    data: () => ({
        title: 'Teaching Pronunciation with Confidence',
        source: {
            storagePath: 'crm-books/book-1/source.pdf',
            originalFilename: 'Teaching Pronunciation with Confidence.pdf'
        }
    }),
    async get() { return this; }
};

let signedUrlOptions = null;
const sourceFile = {
    async exists() { return [true]; },
    async getSignedUrl(options) {
        signedUrlOptions = options;
        return ['https://storage.example.test/signed-source'];
    }
};

const bucket = {
    file(storagePath) {
        assert.strictEqual(storagePath, 'crm-books/book-1/source.pdf');
        return sourceFile;
    }
};

const adminGuard = () => undefined;
const db = {
    collection(name) {
        assert.strictEqual(name, 'crmBooks');
        return { doc(bookId) {
            assert.strictEqual(bookId, 'book-1');
            return bookRef;
        } };
    }
};

registerBookRoutes(router, {
    db,
    sendSuccess: (res, data) => res.json({ success: true, ...data }),
    sendError: (res, status, error, message) => res.status(status).json({ success: false, error, message }),
    requireAdminHandlers: [adminGuard],
    serverTimestamp: () => 'SERVER_TIMESTAMP',
    writeAuditLog: async () => undefined,
    getStorageBucket: async () => bucket
});

const downloadRoute = handlers.get.find((entry) => entry.pathname === '/books/:bookId/source');
assert(downloadRoute, 'Books routes must register the authenticated source download endpoint.');
assert.strictEqual(downloadRoute.routeHandlers[0], adminGuard, 'Source download must retain the existing admin guard.');

const response = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return payload; }
};

(async () => {
    await downloadRoute.handler({ params: { bookId: 'book-1' }, user: { uid: 'admin-1' } }, response);

    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(response.body.success, true);
    assert.strictEqual(response.body.downloadUrl, 'https://storage.example.test/signed-source');
    assert.strictEqual(response.body.filename, 'Teaching Pronunciation with Confidence.pdf');
    assert.strictEqual(signedUrlOptions.action, 'read');
    assert.ok(Number(signedUrlOptions.expires) > Date.now(), 'Signed source URL must expire in the future.');
    assert.match(signedUrlOptions.responseDisposition, /attachment/i, 'Source downloads must be attachments.');

    console.log('books source download route contracts passed');
})().catch((error) => {
    console.error(error.stack || error);
    process.exitCode = 1;
});
