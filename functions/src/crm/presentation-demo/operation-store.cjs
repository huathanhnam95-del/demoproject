'use strict';

const crypto = require('node:crypto');
const { clone, fail } = require('./contracts.cjs');

function operationHash(value) {
    return crypto.createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex');
}

function createMemoryOperationStore() {
    const receipts = new Map();
    return {
        async run(scope, operationId, input, action) {
            const id = String(operationId || '').trim();
            if (!id) return action();
            const key = `${scope}:${id}`;
            const hash = operationHash(input);
            const previous = receipts.get(key);
            if (previous) {
                if (previous.inputHash !== hash) fail('OPERATION_ID_REUSED');
                return clone(previous.result);
            }
            const result = await action();
            receipts.set(key, { inputHash: hash, result: clone(result), createdAt: Date.now() });
            return clone(result);
        },
        receipts
    };
}

module.exports = { createMemoryOperationStore, operationHash };
