'use strict';

const { DomainError } = require('./validation');
const { ProjectsAccessError } = require('../access-service');

const MAX_TRANSACTION_ATTEMPTS = 2;
const CLOSED_TRANSACTION_BACKOFF_MS = 50;

function isClosedTransactionError(error) {
    if (!error || error instanceof DomainError || error instanceof ProjectsAccessError || error.status !== undefined || error.code !== 3) return false;
    // The emulator reports this expired transaction variant as INVALID_ARGUMENT;
    // the SDK only retries that code for "transaction has expired". Do not extend
    // retryability to other invalid arguments or application validation errors.
    return [error.details, error.message].some(value => typeof value === 'string'
        && /^(?:3 INVALID_ARGUMENT: )?Transaction is invalid or closed\.$/.test(value.trim()));
}

async function runTransactionWithClosedRetry(db, callback, options) {
    for (let attempt = 0; attempt < MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
        try {
            // Starting a new public SDK transaction also discards its invalid ID.
            return await db.runTransaction(callback, options);
        } catch (error) {
            if (attempt + 1 === MAX_TRANSACTION_ATTEMPTS || !isClosedTransactionError(error)) throw error;
            await new Promise(resolve => setTimeout(resolve, CLOSED_TRANSACTION_BACKOFF_MS));
        }
    }
}

module.exports = { isClosedTransactionError, runTransactionWithClosedRetry, MAX_TRANSACTION_ATTEMPTS, CLOSED_TRANSACTION_BACKOFF_MS };
