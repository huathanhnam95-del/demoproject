const assert = require('assert');
const {
    formatCrmId,
    isValidCrmId,
    ensureCrmIdOnDoc
} = require('../../functions/src/crm/business-id-service');

function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createFakeDb(initialDocs = {}) {
    const docs = new Map(Object.entries(initialDocs));

    return {
        docs,
        collection(collectionName) {
            return {
                doc(docId) {
                    const key = `${collectionName}/${docId}`;
                    return {
                        id: docId,
                        async get() {
                            const exists = docs.has(key);
                            return {
                                exists,
                                id: docId,
                                data: () => clone(docs.get(key) || null)
                            };
                        },
                        async set(patch, options = {}) {
                            const current = docs.get(key) || {};
                            const next = options.merge ? { ...current, ...clone(patch) } : clone(patch);
                            docs.set(key, next);
                        }
                    };
                }
            };
        },
        async runTransaction(handler) {
            const tx = {
                async get(ref) {
                    return ref.get();
                },
                set(ref, data, options) {
                    return ref.set(data, options);
                }
            };
            return handler(tx);
        }
    };
}

assert.strictEqual(formatCrmId(0), 'a0001');
assert.strictEqual(formatCrmId(9998), 'a9999');
assert.strictEqual(formatCrmId(9999), 'b0001');
assert.strictEqual(isValidCrmId('a0001'), true);
assert.strictEqual(isValidCrmId('bad-id'), false);

(async () => {
    const validDb = createFakeDb({
        'crmCounters/crmId': { nextIndex: 3 },
        'crmStudents/student-1': { crmId: 'a0004' }
    });
    const validRef = validDb.collection('crmStudents').doc('student-1');
    const validResult = await ensureCrmIdOnDoc(validDb, validRef, { crmId: 'a0004' }, {
        serverTimestamp: () => 'SERVER_TS'
    });

    assert.deepStrictEqual(validResult, { crmId: 'a0004', allocated: false });
    assert.deepStrictEqual(validDb.docs.get('crmStudents/student-1'), { crmId: 'a0004' });

    const uppercaseDb = createFakeDb({
        'crmCounters/crmId': { nextIndex: 3 },
        'crmStudents/student-upper': { crmId: 'A0004' }
    });
    const uppercaseRef = uppercaseDb.collection('crmStudents').doc('student-upper');
    const uppercaseResult = await ensureCrmIdOnDoc(uppercaseDb, uppercaseRef, { crmId: 'A0004' }, {
        serverTimestamp: () => 'SERVER_TS',
        user: { uid: 'admin-1' }
    });

    assert.deepStrictEqual(uppercaseResult, { crmId: 'a0004', allocated: false });
    assert.deepStrictEqual(uppercaseDb.docs.get('crmStudents/student-upper'), {
        crmId: 'a0004',
        updatedAt: 'SERVER_TS',
        updatedBy: 'admin-1'
    });

    const invalidDb = createFakeDb({
        'crmCounters/crmId': { nextIndex: 0 },
        'crmStudents/student-2': { crmId: 'legacy-1' }
    });
    const invalidRef = invalidDb.collection('crmStudents').doc('student-2');
    const invalidResult = await ensureCrmIdOnDoc(invalidDb, invalidRef, { crmId: 'legacy-1' }, {
        serverTimestamp: () => 'SERVER_TS'
    });

    assert.deepStrictEqual(invalidResult, { crmId: 'a0001', allocated: true });
    assert.deepStrictEqual(invalidDb.docs.get('crmStudents/student-2'), {
        crmId: 'a0001',
        updatedAt: 'SERVER_TS',
        updatedBy: null
    });

    console.log('business id service passed');
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
