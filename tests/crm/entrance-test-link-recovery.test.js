const assert = require('assert');

const {
    buildEntranceTestAdminList,
    buildRecoveryRecord,
    extractDeliveryToken,
    loadEntranceTestRecoveryTokens,
    ENTRANCE_TEST_LINK_RECOVERY
} = require('../../functions/src/crm/entrance-test-link-recovery');

function makeDoc(data) {
    return {
        exists: !!data,
        data: () => data
    };
}

function makeDb(records = {}) {
    return {
        collection(name) {
            return {
                doc(id) {
                    return {
                        async get() {
                            const bucket = records[name] || {};
                            return makeDoc(bucket[id] || null);
                        }
                    };
                }
            };
        }
    };
}

const db = makeDb({
    [ENTRANCE_TEST_LINK_RECOVERY]: {
        'test-started': { deliveryToken: 'recovered-token' },
        'test-submitted': { deliveryToken: 'submitted-token' },
        'test-empty': { deliveryToken: '   ' }
    }
});

assert.strictEqual(
    extractDeliveryToken('https://betterenglishlearning.com/entrance-test.html?token=abc123&fbclid=test'),
    'abc123'
);
assert.strictEqual(extractDeliveryToken('plain-token-value'), 'plain-token-value');
assert.strictEqual(extractDeliveryToken('https://betterenglishlearning.com/entrance-test.html?foo=bar'), '');

assert.deepStrictEqual(buildRecoveryRecord('known-token', {
    source: 'manual',
    actor: 'admin@example.com',
    serverTimestamp: 'SERVER_TS'
}), {
    deliveryToken: 'known-token',
    source: 'manual',
    updatedAt: 'SERVER_TS',
    updatedBy: 'admin@example.com'
});

(async () => {
    const tokenMap = await loadEntranceTestRecoveryTokens(db, [
        { testId: 'test-started', status: 'started', deliveryToken: '' },
        { testId: 'test-created', status: 'created', deliveryToken: 'inline-token' },
        { testId: 'test-submitted', status: 'submitted', deliveryToken: '' },
        { testId: 'test-empty', status: 'started', deliveryToken: '' }
    ]);

    assert.strictEqual(tokenMap.get('test-started'), 'recovered-token');
    assert.strictEqual(tokenMap.has('test-submitted'), false, 'Submitted tests must not load recovery tokens.');
    assert.strictEqual(tokenMap.has('test-empty'), false, 'Blank recovery tokens must be ignored.');

    const req = {
        headers: {
            host: 'betterenglishlearning.com',
            'x-forwarded-proto': 'https'
        },
        protocol: 'https',
        get(name) {
            return this.headers[name.toLowerCase()] || this.headers[name] || '';
        }
    };

    const tests = await buildEntranceTestAdminList(req, db, [
        {
            testId: 'test-started',
            status: 'started',
            deliveryToken: '',
            createdAt: '2026-03-29T00:00:00.000Z',
            startedAt: '2026-03-29T00:01:00.000Z',
            submittedAt: null
        },
        {
            testId: 'test-inline',
            status: 'created',
            deliveryToken: 'inline-token',
            createdAt: '2026-03-29T00:02:00.000Z',
            startedAt: null,
            submittedAt: null
        },
        {
            testId: 'test-submitted',
            status: 'submitted',
            deliveryToken: '',
            createdAt: '2026-03-29T00:03:00.000Z',
            startedAt: '2026-03-29T00:04:00.000Z',
            submittedAt: '2026-03-29T00:05:00.000Z'
        }
    ]);

    assert.strictEqual(
        tests[0].testLink,
        'https://betterenglishlearning.com/entrance-test.html?token=recovered-token'
    );
    assert.strictEqual(
        tests[1].testLink,
        'https://betterenglishlearning.com/entrance-test.html?token=inline-token'
    );
    assert.strictEqual(tests[2].testLink, null, 'Submitted tests must not expose learner links.');
    assert.strictEqual(Object.prototype.hasOwnProperty.call(tests[0], 'deliveryToken'), false, 'Admin list items must not expose raw tokens.');
    assert.strictEqual(
        tests[2].resultLink,
        'https://betterenglishlearning.com/crm-entrance-test-result.html?testId=test-submitted'
    );

    console.log('entrance test link recovery passed');
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
