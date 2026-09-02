const assert = require('assert');

const recycleBinService = require('../../functions/src/crm/recycle-bin-service');

const {
    previewArchiveRecords,
    archiveRecords,
    restoreRecycleEntries,
    listRecycleBinEntries,
    purgeRecycleEntries
} = recycleBinService;

assert.strictEqual(typeof previewArchiveRecords, 'function', 'previewArchiveRecords should be exported');
assert.strictEqual(typeof archiveRecords, 'function', 'archiveRecords should be exported');
assert.strictEqual(typeof restoreRecycleEntries, 'function', 'restoreRecycleEntries should be exported');
assert.strictEqual(typeof listRecycleBinEntries, 'function', 'listRecycleBinEntries should be exported');
assert.strictEqual(typeof purgeRecycleEntries, 'function', 'purgeRecycleEntries should be exported');

const TEST_NOW = new Date('2026-03-30T00:00:00.000Z');
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function clone(value) {
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
}

class FakeDocRef {
    constructor(db, segments) {
        this.db = db;
        this.segments = segments;
        this.id = segments[segments.length - 1];
        this.path = segments.join('/');
        this.parent = segments.length > 1
            ? new FakeCollectionRef(db, segments.slice(0, -1))
            : null;
    }

    collection(name) {
        return new FakeCollectionRef(this.db, [...this.segments, name]);
    }

    async get() {
        const entry = this.db.store.get(this.path);
        return {
            exists: !!entry,
            id: this.id,
            ref: this,
            data: () => (entry ? clone(entry) : undefined)
        };
    }

    async set(data, options = {}) {
        const existing = this.db.store.get(this.path);
        const next = options.merge && existing
            ? { ...clone(existing), ...clone(data) }
            : clone(data);
        this.db.store.set(this.path, next);
    }

    async update(data) {
        const existing = this.db.store.get(this.path) || {};
        this.db.store.set(this.path, { ...clone(existing), ...clone(data) });
    }

    async delete() {
        this.db.store.delete(this.path);
    }
}

class FakeQuerySnapshot {
    constructor(docs) {
        this.docs = docs;
        this.empty = docs.length === 0;
        this.size = docs.length;
    }
}

class FakeQueryRef {
    constructor(db, segments, filters = []) {
        this.db = db;
        this.segments = segments;
        this.filters = filters;
    }

    where(field, op, value) {
        return new FakeQueryRef(this.db, this.segments, [...this.filters, { field, op, value }]);
    }

    limit(count) {
        return new FakeQueryRef(this.db, this.segments, [...this.filters, { type: 'limit', count }]);
    }

    offset(count) {
        return new FakeQueryRef(this.db, this.segments, [...this.filters, { type: 'offset', count }]);
    }

    async get() {
        const docs = this.db.listDocs(this.segments);
        let rows = docs.filter((doc) => this.filters.every((filter) => {
            if (filter.type === 'limit' || filter.type === 'offset') return true;
            if (filter.op === '==') return doc.data?.[filter.field] === filter.value;
            if (filter.op === '<=') return doc.data?.[filter.field] <= filter.value;
            return true;
        }));

        const offsetFilter = this.filters.find((filter) => filter.type === 'offset');
        const limitFilter = this.filters.find((filter) => filter.type === 'limit');
        if (offsetFilter) rows = rows.slice(Number(offsetFilter.count || 0));
        if (limitFilter) rows = rows.slice(0, Number(limitFilter.count || rows.length));

        return new FakeQuerySnapshot(rows.map((row) => row.snapshot));
    }
}

class FakeCollectionRef {
    constructor(db, segments) {
        this.db = db;
        this.segments = segments;
        this.id = segments[segments.length - 1];
        this.path = segments.join('/');
    }

    doc(id = null) {
        const nextId = id || `auto_${Math.random().toString(36).slice(2, 10)}`;
        return new FakeDocRef(this.db, [...this.segments, nextId]);
    }

    where(field, op, value) {
        return new FakeQueryRef(this.db, this.segments, [{ field, op, value }]);
    }

    limit(count) {
        return new FakeQueryRef(this.db, this.segments, [{ type: 'limit', count }]);
    }

    async get() {
        const docs = this.db.listDocs(this.segments);
        return new FakeQuerySnapshot(docs.map((row) => row.snapshot));
    }
}

class FakeDb {
    constructor(initial = {}) {
        this.store = new Map();
        Object.entries(initial).forEach(([path, data]) => {
            this.store.set(path, clone(data));
        });
    }

    collection(name) {
        return new FakeCollectionRef(this, [name]);
    }

    doc(path) {
        return new FakeDocRef(this, String(path || '').split('/').filter(Boolean));
    }

    listDocs(collectionSegments) {
        const prefix = collectionSegments.join('/');
        const prefixSegments = collectionSegments.length;
        const out = [];
        for (const [path, data] of this.store.entries()) {
            const segments = path.split('/').filter(Boolean);
            if (segments.length !== prefixSegments + 1) continue;
            if (segments.slice(0, prefixSegments).join('/') !== prefix) continue;
            const docRef = new FakeDocRef(this, segments);
            out.push({
                path,
                data: clone(data),
                snapshot: {
                    exists: true,
                    id: docRef.id,
                    ref: docRef,
                    data: () => clone(data)
                }
            });
        }
        return out;
    }
}

async function main() {
    const db = new FakeDb({
        'crmLeads/lead-1': {
            name: 'Lead One',
            stage: 'test_completed',
            studentId: 'student-1',
            crmId: 'a0001',
            source: 'enquiry'
        },
        'crmStudents/student-1': {
            name: 'Student One',
            lifecycleStage: 'potential',
            leadId: 'lead-1',
            crmId: 'a0001'
        },
        'crmTasks/task-1': {
            leadId: 'lead-1',
            title: 'Call lead'
        },
        'crmTasks/task-2': {
            studentId: 'student-1',
            title: 'Call student'
        },
        'crmActivities/activity-1': {
            leadId: 'lead-1',
            subject: 'Messenger reply'
        },
        'entranceTests/test-1': {
            leadId: 'lead-1',
            studentId: 'student-1',
            status: 'created'
        }
    });

    const preview = await previewArchiveRecords(db, 'leads', ['lead-1', 'missing-1'], {
        now: TEST_NOW,
        sourcePanel: 'enquiry'
    });

    assert.deepStrictEqual(preview.requestedIds, ['lead-1', 'missing-1']);
    assert.deepStrictEqual(preview.archiveableIds, ['lead-1']);
    assert.deepStrictEqual(preview.notFoundIds, ['missing-1']);
    assert.ok(Array.isArray(preview.impactSummary));
    assert.ok(preview.impactSummary[0].recordCount >= 4);
    assert.ok(new Date(preview.expiresAt).getTime() - TEST_NOW.getTime() >= THIRTY_DAYS_MS - 1000);

    const studentPreview = await previewArchiveRecords(db, 'students', ['student-1'], {
        now: TEST_NOW
    });
    assert.deepStrictEqual(studentPreview.archiveableIds, ['student-1']);
    assert.strictEqual(studentPreview.impactSummary[0].sourcePanel, 'students');

    const archived = await archiveRecords(db, 'leads', ['lead-1'], {
        now: TEST_NOW,
        sourcePanel: 'enquiry',
        user: { uid: 'admin-1', email: 'admin@example.com' }
    });

    assert.deepStrictEqual(archived.archivedIds, ['lead-1']);
    assert.strictEqual(archived.recycleIds.length, 1);

    assert.strictEqual(await db.collection('crmLeads').doc('lead-1').get().then((snap) => snap.exists), false);
    assert.strictEqual(await db.collection('crmStudents').doc('student-1').get().then((snap) => snap.exists), false);
    assert.strictEqual(await db.collection('crmTasks').doc('task-1').get().then((snap) => snap.exists), false);
    assert.strictEqual(await db.collection('crmTasks').doc('task-2').get().then((snap) => snap.exists), false);
    assert.strictEqual(await db.collection('crmActivities').doc('activity-1').get().then((snap) => snap.exists), false);
    assert.strictEqual(await db.collection('entranceTests').doc('test-1').get().then((snap) => snap.exists), false);

    const recycleId = archived.recycleIds[0];
    const recycleSnap = await db.collection('crmRecycleBin').doc(recycleId).get();
    assert.strictEqual(recycleSnap.exists, true);
    assert.strictEqual(recycleSnap.data().rootEntityType, 'lead');
    assert.strictEqual(recycleSnap.data().rootId, 'lead-1');
    assert.strictEqual(recycleSnap.data().sourcePanel, 'enquiry');

    const bundleSnap = await db.collection('crmRecycleBin').doc(recycleId).collection('bundleDocs').get();
    assert.ok(bundleSnap.size >= 4);

    const restored = await restoreRecycleEntries(db, [recycleId], {
        now: TEST_NOW,
        user: { uid: 'admin-1', email: 'admin@example.com' }
    });

    assert.deepStrictEqual(restored.restoredIds, [recycleId]);
    assert.strictEqual(await db.collection('crmLeads').doc('lead-1').get().then((snap) => snap.exists), true);
    assert.strictEqual(await db.collection('crmStudents').doc('student-1').get().then((snap) => snap.exists), true);
    assert.strictEqual(await db.collection('crmTasks').doc('task-1').get().then((snap) => snap.exists), true);
    assert.strictEqual(await db.collection('crmTasks').doc('task-2').get().then((snap) => snap.exists), true);
    assert.strictEqual(await db.collection('crmActivities').doc('activity-1').get().then((snap) => snap.exists), true);
    assert.strictEqual(await db.collection('entranceTests').doc('test-1').get().then((snap) => snap.exists), true);
    assert.strictEqual(await db.collection('crmRecycleBin').doc(recycleId).get().then((snap) => snap.exists), false);

    const archiveAgain = await archiveRecords(db, 'leads', ['lead-1'], {
        now: TEST_NOW,
        sourcePanel: 'enquiry',
        user: { uid: 'admin-1', email: 'admin@example.com' }
    });
    const listPage = await listRecycleBinEntries(db, {
        page: 99,
        limit: 1,
        now: TEST_NOW
    });
    assert.strictEqual(listPage.items.length, 1);
    assert.strictEqual(listPage.page, 1);

    const timestampDb = new FakeDb({
        'crmRecycleBin/recycle-ts': {
            rootEntityType: 'student',
            rootId: 'student-ts',
            sourcePanel: 'students/potential',
            deletedAt: { seconds: 1774699200, nanoseconds: 0 },
            expiresAt: { seconds: 1777291200, nanoseconds: 0 },
            displayTitle: 'Timestamp Student',
            displaySubtitle: 'Potential Students',
            impactSummary: [{ label: 'Students', count: 1 }],
            bundleDocCount: 1
        }
    });
    const timestampList = await listRecycleBinEntries(timestampDb, {
        now: new Date('2026-03-30T00:00:00.000Z')
    });
    assert.strictEqual(timestampList.items.length, 1);
    assert.strictEqual(timestampList.items[0].deletedAt, '2026-03-28T12:00:00.000Z');
    assert.strictEqual(timestampList.items[0].expiresAt, '2026-04-27T12:00:00.000Z');
    assert.strictEqual(timestampList.items[0].isExpired, false);

    const purged = await purgeRecycleEntries(db, archiveAgain.recycleIds, {
        user: { uid: 'admin-1', email: 'admin@example.com' }
    });

    assert.deepStrictEqual(purged.purgedIds, archiveAgain.recycleIds);
    assert.strictEqual(await db.collection('crmRecycleBin').doc(archiveAgain.recycleIds[0]).get().then((snap) => snap.exists), false);

    console.log('recycle bin service passed');
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
