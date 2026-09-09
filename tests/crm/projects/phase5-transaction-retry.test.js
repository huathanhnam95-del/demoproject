'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { DomainError } = require('../../../functions/src/crm/projects/domain/validation');
const { ProjectsAccessError } = require('../../../functions/src/crm/projects/access-service');
const { isClosedTransactionError, runTransactionWithClosedRetry } = require('../../../functions/src/crm/projects/domain/transaction-retry');

function closed() { return Object.assign(new Error('3 INVALID_ARGUMENT: Transaction is invalid or closed.'), { code: 3, details: 'Transaction is invalid or closed.' }); }

test('only the exact numeric-code closed-transaction variant is eligible', () => {
    assert.equal(isClosedTransactionError(closed()), true);
    assert.equal(isClosedTransactionError({ code: 3, message: 'Transaction is invalid or closed.' }), true);
    assert.equal(isClosedTransactionError({ code: 3, details: 'Transaction is invalid or closed.', message: 'grpc failure' }), true);
    for (const error of [null, {}, { code: '3', message: closed().message }, { code: 10, message: closed().message }, { code: 3, message: 'Invalid document reference' }, { code: 3, message: 'transaction has expired' }, { code: 3, message: 'Transaction is invalid or closed. Additional failure.' }, { code: 3, message: 'Task transaction is invalid or closed.' }, new DomainError(400, 3, 'Transaction is invalid or closed.'), new ProjectsAccessError(403, 3, 'Transaction is invalid or closed.'), { code: 3, status: 409, message: closed().message }]) assert.equal(isClosedTransactionError(error), false);
});

test('retry starts a fresh transaction, preserves options and returns its successful result', async () => {
    let attempts = 0; const seen = []; const options = { maxAttempts: 3 };
    const db = { async runTransaction(callback, actualOptions) { assert.equal(actualOptions, options); const tx = { attempt: ++attempts }; const result = await callback(tx); if (attempts === 1) throw closed(); return result; } };
    const result = await runTransactionWithClosedRetry(db, async tx => { seen.push(tx); return { attempt: tx.attempt }; }, options);
    assert.deepEqual(result, { attempt: 2 }); assert.equal(attempts, 2); assert.notEqual(seen[0], seen[1]);
});

test('one ordinary success has no extra invocation', async () => {
    let calls = 0; const result = { committed: true };
    assert.equal(await runTransactionWithClosedRetry({ async runTransaction(callback) { calls++; return callback({}); } }, async () => result), result);
    assert.equal(calls, 1);
});

test('two exact failures propagate the final error and never return a callback result', async () => {
    let calls = 0; const errors = [closed(), closed()];
    const db = { async runTransaction(callback) { await callback({}); throw errors[calls++]; } };
    await assert.rejects(runTransactionWithClosedRetry(db, async () => ({ mustNotEscape: true })), error => error === errors[1]);
    assert.equal(calls, 2);
});

test('business and other SDK failures do not get outer retries', async () => {
    for (const error of [new DomainError(409, 'STALE_REVISION', 'Refresh'), new ProjectsAccessError(404, 'PROJECT_NOT_FOUND', 'Hidden'), Object.assign(new Error('Invalid query'), { code: 3 }), Object.assign(new Error('SDK exhausted retries'), { code: 10 }), new Error('unknown commit result')]) {
        let calls = 0;
        await assert.rejects(runTransactionWithClosedRetry({ async runTransaction() { calls++; throw error; } }, async () => null), actual => actual === error);
        assert.equal(calls, 1);
    }
});

test('a business conflict or revoked authority on the fresh attempt propagates unchanged', async () => {
    for (const finalError of [new DomainError(409, 'STALE_STRUCTURE_REVISION', 'Changed'), new ProjectsAccessError(404, 'PROJECT_NOT_FOUND', 'Revoked')]) {
        let calls = 0;
        await assert.rejects(runTransactionWithClosedRetry({ async runTransaction() { if (++calls === 1) throw closed(); throw finalError; } }, async () => null), error => error === finalError);
        assert.equal(calls, 2);
    }
});
