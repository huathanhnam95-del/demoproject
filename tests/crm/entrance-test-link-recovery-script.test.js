const assert = require('assert');

const {
    runBackfill,
    previewToken,
    parseArgs
} = require('../../scripts/crm/backfill-entrance-test-link-recovery');
const { hashTokenToTestId } = require('../../src/entrance-test/test36plus');

function makeDoc(data) {
    return {
        exists: !!data,
        data: () => data
    };
}

function makeDb(records = {}) {
    const writes = [];
    return {
        writes,
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
        },
        batch() {
            return {
                set(ref, data, options) {
                    writes.push({ ref, data, options });
                },
                async commit() {
                    return undefined;
                }
            };
        }
    };
}

const token = 'script-token-123';
const testId = hashTokenToTestId(token);
const db = makeDb({
    entranceTests: {
        [testId]: {
            status: 'started',
            deliveryToken: null
        }
    }
});

assert.deepStrictEqual(parseArgs(['--apply', token, 'extra']), {
    apply: true,
    values: [token, 'extra']
});
assert.strictEqual(previewToken(token), 'script...');

(async () => {
    const dryRun = await runBackfill([`https://betterenglishlearning.com/entrance-test.html?token=${token}&fbclid=abc`], {
        apply: false,
        db
    });

    assert.strictEqual(dryRun.apply, false);
    assert.strictEqual(dryRun.rows[0].status, 'ready');
    assert.strictEqual(dryRun.rows[0].testId, testId);
    assert.strictEqual(dryRun.rows[0].deliveryTokenPreview, 'script...');
    assert.strictEqual(db.writes.length, 0, 'Dry-run must not write.');

    const missingDb = makeDb({ entranceTests: {} });
    const missingRun = await runBackfill([token], {
        apply: true,
        db: missingDb
    });
    assert.strictEqual(missingRun.count, 0);
    assert.strictEqual(missingRun.rows[0].status, 'skipped_missing_test');
    assert.strictEqual(missingDb.writes.length, 0, 'Missing test rows must not be written.');

    const submittedDb = makeDb({
        entranceTests: {
            [testId]: {
                status: 'submitted',
                deliveryToken: null
            }
        }
    });
    const submittedRun = await runBackfill([token], {
        apply: true,
        db: submittedDb
    });
    assert.strictEqual(submittedRun.count, 0);
    assert.strictEqual(submittedRun.rows[0].status, 'skipped_not_active');
    assert.strictEqual(submittedDb.writes.length, 0, 'Submitted rows must not be written.');

    const activeTokenDb = makeDb({
        entranceTests: {
            [testId]: {
                status: 'created',
                deliveryToken: 'already-there'
            }
        }
    });
    const activeTokenRun = await runBackfill([token], {
        apply: true,
        db: activeTokenDb
    });
    assert.strictEqual(activeTokenRun.count, 0);
    assert.strictEqual(activeTokenRun.rows[0].status, 'skipped_already_has_token');
    assert.strictEqual(activeTokenDb.writes.length, 0, 'Existing primary tokens must not be overwritten.');

    console.log('entrance test link recovery script passed');
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
