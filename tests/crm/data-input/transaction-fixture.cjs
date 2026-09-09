'use strict';
const assert = require('node:assert/strict');
const { createTransactionWorkspace } = require('../../../functions/src/crm/data-input/transaction-workspace');
function fixture(initial = {}) {
    const rows = new Map(Object.entries(initial)), calls = [];
    const doc = path => ({ path, id: path.split('/').at(-1), collection: name => collection(`${path}/${name}`) });
    const collection = (path, filters = [], count = Infinity) => ({ path, filters, count,
        doc: id => doc(`${path}/${id}`), where: (field, op, value) => collection(path, [...filters, [field, op, value]], count), limit: limit => collection(path, filters, limit)
    });
    const snapshot = reference => ({ id: reference.id, ref: reference, exists: rows.has(reference.path), data: () => structuredClone(rows.get(reference.path)), updateTime: rows.has(reference.path) ? { seconds: 1, nanoseconds: 2 } : undefined });
    const db = { collection };
    let writing = false;
    const transaction = {
        async get(reference) {
            assert.equal(writing, false, 'Firestore does not allow reads after writes');
            calls.push(['read', reference.path]);
            if (!reference.filters) return snapshot(reference);
            const docs = [...rows.keys()].filter(path => path.split('/').length === reference.path.split('/').length + 1 && path.startsWith(`${reference.path}/`))
                .filter(path => reference.filters.every(([field, op, value]) => op === '==' && rows.get(path)[field] === value))
                .slice(0, reference.count).map(path => snapshot(doc(path)));
            return { docs };
        },
        set(reference, data) { writing = true; calls.push(['write', reference.path]); rows.set(reference.path, structuredClone(data)); },
        delete(reference) { writing = true; calls.push(['delete', reference.path]); rows.delete(reference.path); }
    };
    return { rows, calls, db, transaction, workspace: createTransactionWorkspace({ db, transaction, seed: 'draft-revision-1' }) };
}


module.exports = { fixture };
