const assert = require('assert');

const { CRM_COUNTERS, CRM_STUDENTS } = require('../../functions/src/crm/collections');
const { isValidCrmId } = require('../../functions/src/crm/business-id-service');
const { runBackfill } = require('../../scripts/crm/backfill-student-crm-ids');

function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createFakeDb(initialDocs = {}) {
    const docs = new Map(Object.entries(initialDocs));
    let autoId = 0;

    function listCollectionDocs(collectionName) {
        return Array.from(docs.entries())
            .filter(([key]) => key.startsWith(`${collectionName}/`))
            .map(([key, value]) => ({
                id: key.slice(collectionName.length + 1),
                data: clone(value)
            }));
    }

    function makeRef(collectionName, docId) {
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

    return {
        docs,
        collection(collectionName) {
            return {
                doc(docId) {
                    if (!docId) {
                        autoId += 1;
                        docId = `${collectionName}-auto-${autoId}`;
                    }
                    return makeRef(collectionName, docId);
                },
                async get() {
                    return { docs: listCollectionDocs(collectionName) };
                },
                where() {
                    throw new Error('Backfill script test does not use queries.');
                },
                orderBy() {
                    throw new Error('Backfill script test does not use ordered queries.');
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

(async () => {
    const db = createFakeDb({
        [`${CRM_COUNTERS}/crmId`]: { nextIndex: 1 },
        [`${CRM_STUDENTS}/student-1`]: {
            name: 'Alice Nguyen',
            crmId: 'a0001',
            createdAt: '2026-01-01T00:00:00.000Z'
        },
        [`${CRM_STUDENTS}/student-2`]: {
            name: 'Bob Tran',
            createdAt: '2026-01-02T00:00:00.000Z'
        },
        [`${CRM_STUDENTS}/student-3`]: {
            name: 'Carol Pham',
            crmId: 'legacy-3',
            createdAt: '2026-01-03T00:00:00.000Z'
        },
        [`${CRM_STUDENTS}/student-4`]: {
            name: 'Dana Vu',
            crmId: 'A0007',
            createdAt: '2026-01-04T00:00:00.000Z'
        }
    });

    const preview = await runBackfill({ db, apply: false });
    assert.strictEqual(preview.apply, false);
    assert.strictEqual(preview.needsBackfillCount, 3);
    assert.strictEqual(db.docs.get(`${CRM_STUDENTS}/student-2`).crmId, undefined);
    assert.strictEqual(db.docs.get(`${CRM_STUDENTS}/student-3`).crmId, 'legacy-3');
    assert.strictEqual(db.docs.get(`${CRM_STUDENTS}/student-4`).crmId, 'A0007');

    const applied = await runBackfill({ db, apply: true });
    assert.strictEqual(applied.apply, true);
    assert.strictEqual(applied.updatedCount, 3);
    assert.ok(isValidCrmId(db.docs.get(`${CRM_STUDENTS}/student-2`).crmId));
    assert.ok(isValidCrmId(db.docs.get(`${CRM_STUDENTS}/student-3`).crmId));
    assert.strictEqual(db.docs.get(`${CRM_STUDENTS}/student-4`).crmId, 'a0007');
    assert.notStrictEqual(db.docs.get(`${CRM_STUDENTS}/student-2`).crmId, db.docs.get(`${CRM_STUDENTS}/student-3`).crmId);

    const secondPass = await runBackfill({ db, apply: true });
    assert.strictEqual(secondPass.updatedCount, 0);

    const duplicateDb = createFakeDb({
        [`${CRM_COUNTERS}/crmId`]: { nextIndex: 5 },
        [`${CRM_STUDENTS}/student-a`]: {
            name: 'Duplicate One',
            crmId: 'a0005',
            createdAt: '2026-01-04T00:00:00.000Z'
        },
        [`${CRM_STUDENTS}/student-b`]: {
            name: 'Duplicate Two',
            crmId: 'a0005',
            createdAt: '2026-01-05T00:00:00.000Z'
        }
    });

    const duplicatePreview = await runBackfill({ db: duplicateDb, apply: false });
    assert.strictEqual(duplicatePreview.duplicateCrmIds.length, 1);
    await assert.rejects(
        () => runBackfill({ db: duplicateDb, apply: true }),
        /Duplicate crmId/
    );

    console.log('student crm-id backfill script passed');
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
