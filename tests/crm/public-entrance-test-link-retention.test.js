const assert = require('assert');

const { createFakeDb, callRoute } = require('./route-test-helpers');
const {
    TEST_VERSION,
    hashTokenToTestId
} = require('../../functions/src/entrance-test/test36plus');

const token = 'retained-delivery-token-1234567890';
const testId = hashTokenToTestId(token);
const db = createFakeDb({
    [`entranceTests/${testId}`]: {
        status: 'created',
        version: TEST_VERSION,
        deliveryToken: token,
        studentId: null,
        leadId: null,
        startedAt: null
    }
});

const firebaseInitPath = require.resolve('../../functions/src/utils/firebase_admin_init');
require.cache[firebaseInitPath] = {
    id: firebaseInitPath,
    filename: firebaseInitPath,
    loaded: true,
    exports: { db }
};

const router = require('../../functions/src/routes/entrance-tests');

(async () => {
    const response = await callRoute(router, '/submit', 'post', {
        body: {
            token,
            responses: {}
        },
        headers: { 'user-agent': 'public-entrance-test-link-retention' }
    });

    assert.strictEqual(response._status, 200);
    assert.strictEqual(response._json.success, true);
    const submitted = db.docs.get(`entranceTests/${testId}`);
    assert.strictEqual(submitted.status, 'submitted');
    assert.strictEqual(
        submitted.deliveryToken,
        token,
        'Public submission must retain the generated token for authenticated CRM history.'
    );

    console.log('public entrance test link retention passed');
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
