const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

const {
    TextRevisionError,
    validateSourceMetadata,
    snapshotImmutableSource,
    buildRevisionRecord,
    createRevision,
    claimRevision,
    updateWithFence
} = require('../../functions/src/crm/book-text-revision-service');

const orchestration = require('../../functions/src/crm/book-text-revision-service');

const PROCESSOR = Object.freeze({
    processor: 'projects/example/locations/us/processors/books',
    location: 'us',
    processorVersion: 'projects/example/locations/us/processors/books/processorVersions/v1'
});

function sourceMetadata(overrides = {}) {
    return {
        contentType: 'application/pdf',
        size: '12',
        generation: '17',
        metadata: { pageCount: '2' },
        ...overrides
    };
}

function createStorageFake({
    bytes = Buffer.from('immutable PDF'),
    metadata = sourceMetadata(),
    destinationBytes = bytes,
    destinationMetadata = { ...sourceMetadata(), generation: 'destination-1', size: String(destinationBytes.length) }
} = {}) {
    const calls = [];
    const metadataResponses = Array.isArray(metadata) ? metadata : [metadata];
    const sourceFile = {
        name: 'uploads/book.pdf',
        async getMetadata() {
            calls.push({ method: 'getMetadata' });
            const next = metadataResponses[Math.min(
                calls.filter((call) => call.method === 'getMetadata').length - 1,
                metadataResponses.length - 1
            )];
            return [next];
        },
        async download(options) {
            calls.push({ method: 'download', options });
            return [bytes];
        },
        async copy(destination, options) {
            calls.push({ method: 'copy', destination: destination.name, options });
            return [destination];
        }
    };
    const destinationFile = {
        name: 'crm-books/book-1/text-revisions/revision-1/source/source.pdf',
        async getMetadata() {
            calls.push({ method: 'destinationMetadata' });
            return [destinationMetadata];
        },
        async download(options) {
            calls.push({ method: 'destinationDownload', options });
            return [destinationBytes];
        }
    };
    const pinnedSourceFile = {
        ...sourceFile,
        download: sourceFile.download.bind(sourceFile),
        copy: sourceFile.copy.bind(sourceFile)
    };
    const bucket = {
        name: 'books-bucket',
        file(path, options) {
            calls.push({ method: 'file', path, options });
            if (path === 'uploads/book.pdf' && !options) return sourceFile;
            if (path === 'uploads/book.pdf' && options?.generation) return pinnedSourceFile;
            if (path.startsWith('crm-books/book-1/text-revisions/') && path.endsWith('/source/source.pdf')) {
                return { ...destinationFile, name: path };
            }
            return { name: path };
        }
    };
    return { bucket, sourceFile, calls };
}

class FakeDocRef {
    constructor(db, path) {
        this.db = db;
        this.path = path;
        this.id = path.split('/').pop();
    }

    collection(name) {
        return {
            doc: (id) => new FakeDocRef(this.db, `${this.path}/${name}/${id}`)
        };
    }
}

class FakeDb {
    constructor(seed = {}) {
        this.docs = new Map(Object.entries(seed));
        this.transactionCount = 0;
    }

    collection(name) {
        return { doc: (id) => new FakeDocRef(this, `${name}/${id}`) };
    }

    async runTransaction(callback) {
        this.transactionCount += 1;
        if (this.throwOnTransaction === this.transactionCount) {
            throw new Error('simulated transaction interruption');
        }
        const writes = [];
        const transaction = {
            get: async (ref) => {
                const data = this.docs.get(ref.path);
                return {
                    exists: data !== undefined,
                    id: ref.id,
                    ref,
                    data: () => (data === undefined ? undefined : structuredClone(data))
                };
            },
            create: (ref, data) => writes.push({ type: 'create', ref, data }),
            set: (ref, data, options) => writes.push({ type: 'set', ref, data, options }),
            update: (ref, patch) => writes.push({ type: 'update', ref, patch })
        };
        const result = await callback(transaction);
        if (this.replayTransactions) await callback(transaction);
        for (const write of writes) {
            if (write.type === 'create' && this.docs.has(write.ref.path)) {
                throw new Error(`already exists: ${write.ref.path}`);
            }
            if (write.type === 'create' || write.type === 'set') {
                const previous = write.options?.merge ? (this.docs.get(write.ref.path) || {}) : {};
                this.docs.set(write.ref.path, { ...previous, ...structuredClone(write.data) });
            } else {
                const previous = this.docs.get(write.ref.path);
                if (!previous) throw new Error(`missing: ${write.ref.path}`);
                this.docs.set(write.ref.path, { ...previous, ...structuredClone(write.patch) });
            }
        }
        return result;
    }
}

function seedRevision(db, record) {
    db.docs.set(`crmBooks/${record.bookId}/textRevisions/${record.revisionId}`, structuredClone(record));
}

test('validateSourceMetadata accepts only bounded PDF metadata and normalizes storage strings', () => {
    assert.deepEqual(validateSourceMetadata(sourceMetadata()), {
        contentType: 'application/pdf',
        sizeBytes: 12,
        pageCount: 2,
        generation: '17'
    });

    for (const [name, value] of [
        ['content type', { contentType: 'application/octet-stream' }],
        ['zero size', { size: '0' }],
        ['oversized source', { size: String(100 * 1024 * 1024 + 1) }],
        ['non-integer page count', { metadata: { pageCount: '2.5' } }],
        ['page count out of range', { metadata: { pageCount: '501' } }]
    ]) {
        assert.throws(
            () => validateSourceMetadata(sourceMetadata(value)),
            (error) => error instanceof TextRevisionError && error.code === 'SOURCE_METADATA_INVALID',
            name
        );
    }
});

test('snapshotImmutableSource pins the generation, hashes bytes, and creates the exact immutable source copy', async () => {
    const bytes = Buffer.from('source bytes');
    const { bucket, calls } = createStorageFake({ bytes });
    const result = await snapshotImmutableSource({
        bucket,
        sourcePath: 'uploads/book.pdf',
        bookId: 'book-1',
        revisionId: 'revision-1'
    });

    assert.equal(result.sourceUri, 'gs://books-bucket/crm-books/book-1/text-revisions/revision-1/source/source.pdf');
    assert.equal(result.sourceGeneration, 'destination-1');
    assert.equal(result.sourceSha256, crypto.createHash('sha256').update(bytes).digest('hex'));
    assert.equal(result.pageCount, 2);
    assert.deepEqual(calls.find((call) => call.method === 'download').options, {
        ifGenerationMatch: '17'
    });
    assert.deepEqual(calls.find((call) => call.method === 'copy').options, {
        preconditionOpts: { ifGenerationMatch: 0 }
    });
    assert.deepEqual(calls.find((call) => call.method === 'file' && call.options).options, { generation: '17' });
    assert.equal(result.sourceGeneration, 'destination-1');
    assert.deepEqual(calls.find((call) => call.method === 'destinationDownload').options, {
        ifGenerationMatch: 'destination-1'
    });
    assert.equal(
        calls.find((call) => call.method === 'copy').destination,
        'crm-books/book-1/text-revisions/revision-1/source/source.pdf'
    );
});

test('snapshotImmutableSource rejects a source that changes between metadata reads', async () => {
    const { bucket } = createStorageFake({
        metadata: [sourceMetadata(), sourceMetadata({ generation: '18' })]
    });

    await assert.rejects(
        () => snapshotImmutableSource({
            bucket,
            sourcePath: 'uploads/book.pdf',
            bookId: 'book-1',
            revisionId: 'revision-1'
        }),
        (error) => error instanceof TextRevisionError && error.code === 'SOURCE_CHANGED'
    );
});

test('snapshotImmutableSource copies the pinned generation when the mutable source is replaced before copy', async () => {
    const { bucket, sourceFile, calls } = createStorageFake({
        bytes: Buffer.from('source-A-123'),
        destinationBytes: Buffer.from('source-A-123')
    });
    sourceFile.copy = async () => {
        throw new Error('unpinned source copy must not be used');
    };
    const result = await snapshotImmutableSource({
        bucket, sourcePath: 'uploads/book.pdf', bookId: 'book-1', revisionId: 'revision-1'
    });
    assert.equal(result.sourceGeneration, 'destination-1');
    assert.equal(result.sourceSha256, crypto.createHash('sha256').update('source-A-123').digest('hex'));
    assert.equal(calls.filter((call) => call.method === 'copy').length, 1);
});

test('buildRevisionRecord creates a running OCR-submit revision with pinned source and processor metadata', () => {
    const now = new Date('2026-09-02T01:02:03.000Z');
    const source = {
        sourceUri: 'gs://books-bucket/crm-books/book-1/text-revisions/revision-1/source/source.pdf',
        sourceGeneration: '17',
        sourceSha256: 'a'.repeat(64),
        sourceSizeBytes: 12,
        sourceContentType: 'application/pdf',
        pageCount: 2
    };
    const record = buildRevisionRecord({
        bookId: 'book-1',
        revisionId: 'revision-1',
        source,
        processor: PROCESSOR,
        now
    });

    assert.deepEqual(record, {
        bookId: 'book-1',
        revisionId: 'revision-1',
        stage: 'ocr_submit',
        status: 'running',
        source: {
            uri: source.sourceUri,
            generation: '17',
            sha256: 'a'.repeat(64),
            sizeBytes: 12,
            contentType: 'application/pdf',
            pageCount: 2
        },
        processor: PROCESSOR,
        submit: { status: 'not_started' },
        lease: { workerId: null, expiresAt: null, fence: 0 },
        createdAt: now,
        updatedAt: now
    });
});

test('createRevision snapshots source and atomically writes one processing candidate without activating it', async () => {
    const now = new Date('2026-09-02T01:02:03.000Z');
    const db = new FakeDb({ 'crmBooks/book-1': { title: 'Book' } });
    const storage = createStorageFake({ bytes: Buffer.from('source bytes') });
    const result = await createRevision(db, {
        bucket: storage.bucket,
        sourcePath: 'uploads/book.pdf',
        bookId: 'book-1',
        revisionId: 'revision-1',
        processor: PROCESSOR,
        now
    });

    const revision = db.docs.get('crmBooks/book-1/textRevisions/revision-1');
    const book = db.docs.get('crmBooks/book-1');
    assert.equal(result.revisionId, 'revision-1');
    assert.equal(revision.stage, 'ocr_submit');
    assert.equal(revision.source.uri, 'gs://books-bucket/crm-books/book-1/text-revisions/revision-1/source/source.pdf');
    assert.equal(book.activeTextRevisionId, undefined);
    assert.equal(book.processingTextRevisionId, 'revision-1');
});

test('createRevision rejects a different processing candidate already registered for the book', async () => {
    const now = new Date('2026-09-02T01:02:03.000Z');
    const db = new FakeDb({ 'crmBooks/book-1': { processingTextRevisionId: 'revision-existing' } });
    const storage = createStorageFake({ bytes: Buffer.from('123456789012') });
    await assert.rejects(
        () => createRevision(db, {
            bucket: storage.bucket,
            sourcePath: 'uploads/book.pdf',
            bookId: 'book-1',
            revisionId: 'revision-new',
            processor: PROCESSOR,
            now
        }),
        (error) => error instanceof TextRevisionError && error.code === 'REVISION_PROCESSING_ACTIVE'
    );
    assert.equal(db.docs.has('crmBooks/book-1/textRevisions/revision-new'), false);
});

test('claimRevision rejects active leases and increments the fence when unleased or stale', async () => {
    const now = new Date('2026-09-02T01:02:03.000Z');
    const record = buildRevisionRecord({
        bookId: 'book-1',
        revisionId: 'revision-1',
        source: {
            sourceUri: 'gs://bucket/source.pdf',
            sourceGeneration: '17',
            sourceSha256: 'a'.repeat(64),
            sourceSizeBytes: 12,
            sourceContentType: 'application/pdf',
            pageCount: 2
        },
        processor: PROCESSOR,
        now
    });
    const db = new FakeDb();
    seedRevision(db, record);

    const first = await claimRevision(db, {
        bookId: 'book-1', revisionId: 'revision-1', workerId: 'worker-1', now, leaseDurationMs: 1000
    });
    assert.equal(first.lease.fence, 1);
    assert.equal(first.lease.workerId, 'worker-1');

    await assert.rejects(
        () => claimRevision(db, {
            bookId: 'book-1', revisionId: 'revision-1', workerId: 'worker-2', now, leaseDurationMs: 1000
        }),
        (error) => error instanceof TextRevisionError && error.code === 'REVISION_LEASE_ACTIVE'
    );

    const second = await claimRevision(db, {
        bookId: 'book-1',
        revisionId: 'revision-1',
        workerId: 'worker-2',
        now: new Date(now.getTime() + 1001),
        leaseDurationMs: 1000
    });
    assert.equal(second.lease.fence, 2);
    assert.equal(second.lease.workerId, 'worker-2');
});

test('updateWithFence rejects stale workers and applies a patch for the matching revision identity', async () => {
    const now = new Date('2026-09-02T01:02:03.000Z');
    const record = buildRevisionRecord({
        bookId: 'book-1',
        revisionId: 'revision-1',
        source: {
            sourceUri: 'gs://bucket/source.pdf',
            sourceGeneration: '17',
            sourceSha256: 'a'.repeat(64),
            sourceSizeBytes: 12,
            sourceContentType: 'application/pdf',
            pageCount: 2
        },
        processor: PROCESSOR,
        now
    });
    record.lease = { workerId: 'worker-1', expiresAt: new Date(now.getTime() + 1000), fence: 3 };
    const db = new FakeDb();
    seedRevision(db, record);

    const updated = await updateWithFence(db, {
        bookId: 'book-1',
        revisionId: 'revision-1',
        workerId: 'worker-1',
        fence: 3,
        patch: { stage: 'ocr_wait', submit: { status: 'submitted', operationName: 'operations/1' } },
        now
    });
    assert.equal(updated.stage, 'ocr_wait');
    assert.equal(updated.submit.operationName, 'operations/1');

    await assert.rejects(
        () => updateWithFence(db, {
            bookId: 'book-1', revisionId: 'revision-1', workerId: 'worker-2', fence: 2, patch: { status: 'done' }, now
        }),
        (error) => error instanceof TextRevisionError && error.code === 'REVISION_WORKER_FENCE_MISMATCH'
    );
});

test('updateWithFence permits only one forward revision stage transition', async () => {
    const db = new FakeDb();
    const record = makeRunningRevision({ stage: 'ocr_submit' });
    seedRevision(db, record);
    const updated = await updateWithFence(db, {
        bookId: 'book-1', revisionId: 'revision-1', workerId: 'worker-1', fence: 1,
        patch: { stage: 'ocr_wait' }
    });
    assert.equal(updated.stage, 'ocr_wait');

    for (const stage of ['ocr_submit', 'candidate_chunk']) {
        await assert.rejects(
            () => updateWithFence(db, {
                bookId: 'book-1', revisionId: 'revision-1', workerId: 'worker-1', fence: 1,
                patch: { stage }
            }),
            (error) => error instanceof TextRevisionError && error.code === 'REVISION_STAGE_INVALID'
        );
    }
    const forward = await updateWithFence(db, {
        bookId: 'book-1', revisionId: 'revision-1', workerId: 'worker-1', fence: 1,
        patch: { stage: 'ocr_parse' }
    });
    assert.equal(forward.stage, 'ocr_parse');
});

test('scheduled transitions release the lease while preserving the monotonic fence', async () => {
    const db = new FakeDb();
    seedRevision(db, makeRunningRevision({
        stage: 'ocr_wait',
        submit: { status: 'submitted', state: 'submitted', operationName: 'operations/ocr-1', outputUri: 'gs://bucket/ocr/revision-1/' }
    }));
    const result = await orchestration.pollRevisionOcr(db, {
        bookId: 'book-1', revisionId: 'revision-1', workerId: 'worker-1', fence: 1,
        checkBatchOcrOperation: async () => ({ done: false, operationName: 'operations/ocr-1' }),
        now: new Date('2026-09-02T01:02:03.000Z'), pollIntervalMs: 1000
    });
    assert.equal(result.lease.workerId, null);
    assert.equal(result.lease.expiresAt, null);
    assert.equal(result.lease.fence, 1);
});

test('claimRevision has one winner for a duplicate claim and allows a stale lease to be reclaimed with the next fence', async () => {
    const db = new FakeDb();
    const stale = makeRunningRevision();
    stale.lease.expiresAt = new Date('2026-09-02T01:02:02.000Z');
    seedRevision(db, stale);
    const first = await orchestration.claimRevision(db, {
        bookId: 'book-1', revisionId: 'revision-1', workerId: 'worker-1',
        now: new Date('2026-09-02T01:02:03.000Z'), leaseDurationMs: 1000
    });
    assert.equal(first.lease.fence, 2);
    await assert.rejects(
        () => orchestration.claimRevision(db, {
            bookId: 'book-1', revisionId: 'revision-1', workerId: 'worker-2',
            now: new Date('2026-09-02T01:02:03.500Z'), leaseDurationMs: 1000
        }),
        (error) => error.code === 'REVISION_LEASE_ACTIVE'
    );
    const reclaimed = await orchestration.claimRevision(db, {
        bookId: 'book-1', revisionId: 'revision-1', workerId: 'worker-2',
        now: new Date('2026-09-02T01:02:04.001Z'), leaseDurationMs: 1000
    });
    assert.equal(reclaimed.lease.fence, 3);
});

function makeRunningRevision({ stage = 'ocr_submit', submit = { status: 'not_started' }, pageCount = 2 } = {}) {
    const now = new Date('2026-09-02T01:02:03.000Z');
    const record = buildRevisionRecord({
        bookId: 'book-1',
        revisionId: 'revision-1',
        source: {
            sourceUri: 'gs://bucket/crm-books/book-1/text-revisions/revision-1/source/source.pdf',
            sourceGeneration: '17',
            sourceSha256: 'a'.repeat(64),
            sourceSizeBytes: 12,
            sourceContentType: 'application/pdf',
            pageCount
        },
        processor: PROCESSOR,
        now
    });
    record.stage = stage;
    record.submit = submit;
    record.lease = { workerId: 'worker-1', expiresAt: new Date(now.getTime() + 60_000), fence: 1 };
    return record;
}

function seedBudget(db, monthKey = '2026-09', budget = {}) {
    db.docs.set(`crmOcrBudgets/${monthKey}`, {
        usedPages: 0,
        reservedPages: 0,
        ...budget
    });
}

test('submitRevisionOcr survives transaction callback replay without duplicating the external submit', async () => {
    const db = new FakeDb();
    db.replayTransactions = true;
    const record = makeRunningRevision();
    seedRevision(db, record);
    seedBudget(db);
    let quotaChecks = 0;
    let submitCalls = 0;
    const result = await orchestration.submitRevisionOcr(db, {
        bookId: 'book-1',
        revisionId: 'revision-1',
        workerId: 'worker-1',
        fence: 1,
        monthKey: '2026-09',
        monthlyLimit: 10,
        quota: async () => { quotaChecks += 1; },
        outputUri: 'gs://bucket/ocr/revision-1/',
        submitBatchOcr: async (request) => {
            submitCalls += 1;
            assert.equal(request.sourceUri, record.source.uri);
            assert.equal(request.sourceGeneration, record.source.generation);
            assert.equal(request.sourceSha256, record.source.sha256);
            return {
                operationName: 'operations/ocr-1',
                outputUri: request.outputUri,
                processorVersion: PROCESSOR.processorVersion
            };
        },
        now: new Date('2026-09-02T01:02:03.000Z')
    });

    assert.equal(quotaChecks, 1);
    assert.equal(submitCalls, 1);
    assert.equal(result.stage, 'ocr_wait');
    assert.equal(result.submit.state, 'submitted');
    assert.equal(result.submit.operationName, 'operations/ocr-1');
    assert.equal(result.submit.outputUri, 'gs://bucket/ocr/revision-1/');
    assert.equal(db.docs.get('crmOcrBudgets/2026-09').reservedPages, 2);
});

test('submitRevisionOcr never resubmits a confirmed operation and fails closed on preexisting in-flight state', async () => {
    const db = new FakeDb();
    const confirmed = makeRunningRevision({
        stage: 'ocr_wait',
        submit: { status: 'submitted', state: 'submitted', operationName: 'operations/ocr-1', outputUri: 'gs://bucket/ocr/revision-1/' }
    });
    seedRevision(db, confirmed);
    let calls = 0;
    const resumed = await orchestration.submitRevisionOcr(db, {
        bookId: 'book-1', revisionId: 'revision-1', workerId: 'worker-1', fence: 1,
        submitBatchOcr: async () => { calls += 1; return { operationName: 'operations/duplicate' }; }
    });
    assert.equal(calls, 0);
    assert.equal(resumed.submit.operationName, 'operations/ocr-1');

    const inFlightDb = new FakeDb();
    seedRevision(inFlightDb, makeRunningRevision({
        submit: { status: 'in_flight', state: 'in_flight', reservationId: 'book-1/revision-1/2026-09' }
    }));
    await assert.rejects(
        () => orchestration.submitRevisionOcr(inFlightDb, {
            bookId: 'book-1', revisionId: 'revision-1', workerId: 'worker-1', fence: 1,
            submitBatchOcr: async () => { calls += 1; return { operationName: 'operations/duplicate' }; }
        }),
        (error) => error instanceof TextRevisionError && error.code === 'OCR_SUBMIT_IN_FLIGHT'
    );
    assert.equal(calls, 0);
});

test('submitRevisionOcr marks every post-reservation submit failure as reconciliation-required and never retries it', async () => {
    const db = new FakeDb();
    seedRevision(db, makeRunningRevision());
    seedBudget(db);
    let calls = 0;
    const submit = async () => {
        calls += 1;
        throw Object.assign(new Error('connection lost after request'), { code: 'ETIMEDOUT' });
    };
    await assert.rejects(
        () => orchestration.submitRevisionOcr(db, {
            bookId: 'book-1', revisionId: 'revision-1', workerId: 'worker-1', fence: 1,
            monthKey: '2026-09', monthlyLimit: 10, outputUri: 'gs://bucket/ocr/revision-1/', submitBatchOcr: submit
        }),
        (error) => error.code === 'OCR_SUBMIT_UNCERTAIN'
    );
    const afterFailure = db.docs.get('crmBooks/book-1/textRevisions/revision-1');
    assert.equal(calls, 1);
    assert.equal(afterFailure.status, 'needs_reconciliation');
    assert.equal(afterFailure.error.code, 'OCR_SUBMIT_UNCERTAIN');
    assert.equal(afterFailure.submit.state, 'in_flight');
    await assert.rejects(
        () => orchestration.submitRevisionOcr(db, {
            bookId: 'book-1', revisionId: 'revision-1', workerId: 'worker-1', fence: 1,
            monthKey: '2026-09', monthlyLimit: 10, outputUri: 'gs://bucket/ocr/revision-1/', submitBatchOcr: submit
        }),
        (error) => error.code === 'OCR_SUBMIT_UNCERTAIN' || error.code === 'OCR_SUBMIT_IN_FLIGHT'
    );
    assert.equal(calls, 1);
});

test('submitRevisionOcr denies quota or monthly budget before making an external call', async () => {
    const deniedDb = new FakeDb();
    seedRevision(deniedDb, makeRunningRevision());
    seedBudget(deniedDb);
    let calls = 0;
    await assert.rejects(
        () => orchestration.submitRevisionOcr(deniedDb, {
            bookId: 'book-1', revisionId: 'revision-1', workerId: 'worker-1', fence: 1,
            monthKey: '2026-09', monthlyLimit: 10, quota: async () => false,
            submitBatchOcr: async () => { calls += 1; return { operationName: 'operations/nope' }; }
        }),
        (error) => error.code === 'OCR_QUOTA_EXCEEDED'
    );
    assert.equal(calls, 0);
    assert.equal(deniedDb.docs.get('crmBooks/book-1/textRevisions/revision-1').lease.workerId, null);

    const budgetDb = new FakeDb();
    seedRevision(budgetDb, makeRunningRevision());
    seedBudget(budgetDb, '2026-09', { reservedPages: 9 });
    await assert.rejects(
        () => orchestration.submitRevisionOcr(budgetDb, {
            bookId: 'book-1', revisionId: 'revision-1', workerId: 'worker-1', fence: 1,
            monthKey: '2026-09', monthlyLimit: 10, submitBatchOcr: async () => { calls += 1; }
        }),
        (error) => error.code === 'OCR_BUDGET_EXCEEDED'
    );
    assert.equal(calls, 0);
    assert.equal(budgetDb.docs.get('crmBooks/book-1/textRevisions/revision-1').lease.workerId, null);
});

test('pollRevisionOcr passes pinned operation inputs, yields incomplete work, and advances confirmed completion', async () => {
    const db = new FakeDb();
    seedRevision(db, makeRunningRevision({
        stage: 'ocr_wait',
        submit: {
            status: 'submitted', state: 'submitted', operationName: 'operations/ocr-1',
            outputUri: 'gs://bucket/ocr/revision-1/'
        }
    }));
    let request;
    const incomplete = await orchestration.pollRevisionOcr(db, {
        bookId: 'book-1', revisionId: 'revision-1', workerId: 'worker-1', fence: 1,
        checkBatchOcrOperation: async (input) => {
            request = input;
            return { done: false, operationName: input.operationName, metadata: {} };
        },
        now: new Date('2026-09-02T01:02:03.000Z'), pollIntervalMs: 5000
    });
    assert.equal(incomplete.stage, 'ocr_wait');
    assert.equal(incomplete.nextPollAt.getTime(), Date.parse('2026-09-02T01:02:08.000Z'));
    assert.equal(request.operationName, 'operations/ocr-1');
    assert.equal(request.expectedSourceUri, 'gs://bucket/crm-books/book-1/text-revisions/revision-1/source/source.pdf');
    assert.equal(request.expectedOutputUri, 'gs://bucket/ocr/revision-1/');

    const nextClaim = await orchestration.claimRevision(db, {
        bookId: 'book-1', revisionId: 'revision-1', workerId: 'worker-2',
        now: new Date('2026-09-02T01:02:08.000Z'), leaseDurationMs: 60_000
    });
    const complete = await orchestration.pollRevisionOcr(db, {
        bookId: 'book-1', revisionId: 'revision-1', workerId: 'worker-2', fence: nextClaim.lease.fence,
        checkBatchOcrOperation: async () => ({
            done: true, operationName: 'operations/ocr-1', outputUri: 'gs://bucket/ocr/revision-1/',
            inputGcsSource: 'gs://bucket/crm-books/book-1/text-revisions/revision-1/source/source.pdf',
            metadata: { processorVersion: PROCESSOR.processorVersion }, error: null
        }),
        now: new Date('2026-09-02T01:03:03.000Z')
    });
    assert.equal(complete.stage, 'ocr_parse');
    assert.equal(complete.submit.operationName, 'operations/ocr-1');
});

test('pollRevisionOcr accepts only the pinned operation and a strict descendant output prefix', async () => {
    const db = new FakeDb();
    seedRevision(db, makeRunningRevision({
        stage: 'ocr_wait',
        submit: {
            status: 'submitted', state: 'submitted', operationName: 'operations/ocr-1',
            outputUri: 'gs://bucket/ocr/revision-1/'
        }
    }));
    const nested = await orchestration.pollRevisionOcr(db, {
        bookId: 'book-1', revisionId: 'revision-1', workerId: 'worker-1', fence: 1,
        checkBatchOcrOperation: async () => ({
            done: true, operationName: 'operations/ocr-1',
            inputGcsSource: 'gs://bucket/crm-books/book-1/text-revisions/revision-1/source/source.pdf',
            outputUri: 'gs://bucket/ocr/revision-1/shards/',
            metadata: { processorVersion: PROCESSOR.processorVersion }, error: null
        })
    });
    assert.equal(nested.stage, 'ocr_parse');
    assert.equal(nested.submit.outputUri, 'gs://bucket/ocr/revision-1/shards/');

    const mismatchDb = new FakeDb();
    seedRevision(mismatchDb, makeRunningRevision({
        stage: 'ocr_wait',
        submit: { status: 'submitted', state: 'submitted', operationName: 'operations/ocr-1', outputUri: 'gs://bucket/ocr/revision-1/' }
    }));
    await assert.rejects(
        () => orchestration.pollRevisionOcr(mismatchDb, {
            bookId: 'book-1', revisionId: 'revision-1', workerId: 'worker-1', fence: 1,
            checkBatchOcrOperation: async () => ({ done: false, operationName: 'operations/other' })
        }),
        (error) => error.code === 'OCR_OPERATION_MISMATCH'
    );
});

test('pollRevisionOcr fails a long-running operation based on the pinned submission age', async () => {
    const db = new FakeDb();
    seedRevision(db, makeRunningRevision({
        stage: 'ocr_wait',
        submit: {
            status: 'submitted', state: 'submitted', operationName: 'operations/ocr-1',
            outputUri: 'gs://bucket/ocr/revision-1/', submittedAt: new Date('2026-08-31T00:00:00.000Z')
        }
    }));
    let checks = 0;
    await assert.rejects(
        () => orchestration.pollRevisionOcr(db, {
            bookId: 'book-1', revisionId: 'revision-1', workerId: 'worker-1', fence: 1,
            now: new Date('2026-09-02T01:02:03.000Z'),
            checkBatchOcrOperation: async () => { checks += 1; return { done: false }; }
        }),
        (error) => error.code === 'OCR_LRO_TIMEOUT'
    );
    assert.equal(checks, 0);
    assert.equal(db.docs.get('crmBooks/book-1/textRevisions/revision-1').status, 'failed');
});

test('pollRevisionOcr fails terminal, timeout, and processor-mismatch results before parse', async () => {
    for (const pollResult of [
        { done: true, operationName: 'operations/ocr-1', outputUri: 'gs://bucket/ocr/revision-1/', error: { code: 'DOCUMENT_AI_PROCESSOR_ERROR', message: 'bad processor' } },
        { done: true, operationName: 'operations/ocr-1', outputUri: 'gs://bucket/ocr/revision-1/', metadata: { processorVersion: 'wrong' }, error: null },
        { done: true, operationName: 'operations/ocr-1', inputGcsSource: 'gs://bucket/wrong.pdf', outputUri: 'gs://bucket/ocr/revision-1/', error: null },
        { done: true, operationName: 'operations/ocr-1', inputGcsSource: 'gs://bucket/crm-books/book-1/text-revisions/revision-1/source/source.pdf', outputUri: 'gs://bucket/wrong-output/', error: null }
    ]) {
        const db = new FakeDb();
        seedRevision(db, makeRunningRevision({
            stage: 'ocr_wait',
            submit: {
                status: 'submitted', state: 'submitted', operationName: 'operations/ocr-1',
                outputUri: 'gs://bucket/ocr/revision-1/'
            }
        }));
        await assert.rejects(
            () => orchestration.pollRevisionOcr(db, {
                bookId: 'book-1', revisionId: 'revision-1', workerId: 'worker-1', fence: 1,
                checkBatchOcrOperation: async () => pollResult
            }),
            /processor|terminal|OCR/i
        );
        assert.equal(db.docs.get('crmBooks/book-1/textRevisions/revision-1').status, 'failed');
    }

    const timeoutDb = new FakeDb();
    seedRevision(timeoutDb, makeRunningRevision({
        stage: 'ocr_wait',
        submit: { status: 'submitted', state: 'submitted', operationName: 'operations/ocr-1', outputUri: 'gs://bucket/ocr/revision-1/' }
    }));
    await assert.rejects(
        () => orchestration.pollRevisionOcr(timeoutDb, {
            bookId: 'book-1', revisionId: 'revision-1', workerId: 'worker-1', fence: 1,
            checkBatchOcrOperation: async () => { throw Object.assign(new Error('timeout'), { code: 'DOCUMENT_AI_POLL_TIMEOUT' }); }
        }),
        /timeout/i
    );
    assert.equal(timeoutDb.docs.get('crmBooks/book-1/textRevisions/revision-1').status, 'failed');
});

test('parseRevisionOcr records output-loader failures and retries transient worker failures with bounded backoff', async () => {
    const db = new FakeDb();
    seedRevision(db, makeRunningRevision({ stage: 'ocr_parse' }));
    const retryResult = await orchestration.parseRevisionOcr(db, {
        bookId: 'book-1', revisionId: 'revision-1', workerId: 'worker-1', fence: 1,
        loadOutputShards: async () => { throw Object.assign(new Error('temporary storage'), { code: 'ETIMEDOUT' }); },
        now: new Date('2026-09-02T01:02:03.000Z')
    });
    assert.equal(retryResult.stage, 'ocr_parse');
    const after = db.docs.get('crmBooks/book-1/textRevisions/revision-1');
    assert.equal(after.status, 'running');
    assert.equal(after.retry.attempt, 1);
    assert.equal(after.nextPollAt.getTime(), Date.parse('2026-09-02T01:02:04.000Z'));
});

test('parseRevisionOcr persists candidate pages and provenance under the revision, never legacy root pages', async () => {
    const db = new FakeDb();
    seedRevision(db, makeRunningRevision({
        stage: 'ocr_parse',
        submit: {
            status: 'submitted', state: 'submitted', operationName: 'operations/ocr-1',
            outputUri: 'gs://bucket/ocr/revision-1/'
        }
    }));
    let expected;
    const parsed = {
        pages: [{ pageNumber: 1, text: 'One', words: [] }, { pageNumber: 2, text: 'Two', words: [] }],
        pageCount: 2, physicalPageCount: 2, provenanceVerified: true,
        sourceGeneration: '17', sourceSha256: 'a'.repeat(64)
    };
    const result = await orchestration.parseRevisionOcr(db, {
        bookId: 'book-1', revisionId: 'revision-1', workerId: 'worker-1', fence: 1,
        shards: ['raw-shard'],
        parseDocumentAiOutput: (input) => { expected = input; return parsed; },
        persistCandidateArtifact: async (input) => ({
            path: 'crm-books/book-1/text-revisions/revision-1/candidate/pages.json',
            generation: 'candidate-1', sha256: 'b'.repeat(64), sizeBytes: 123,
            pageCount: input.pageCount, provenanceVerified: input.provenanceVerified
        })
    });
    assert.equal(result.stage, 'candidate_chunk');
    assert.equal(result.candidate.path, 'crm-books/book-1/text-revisions/revision-1/candidate/pages.json');
    assert.equal(result.candidate.sha256, 'b'.repeat(64));
    assert.equal(result.candidate.provenanceVerified, true);
    assert.equal(expected.expectedPageCount, 2);
    assert.equal(expected.expectedSourceGeneration, '17');
    assert.equal(expected.expectedSourceSha256, 'a'.repeat(64));
    assert.equal(db.docs.has('crmBooks/book-1/pages'), false);
});

test('parseRevisionOcr uses the production loader and immutable candidate artifact for 211 pages without embedding pages in Firestore', async () => {
    const db = new FakeDb();
    seedRevision(db, makeRunningRevision({ stage: 'ocr_parse', pageCount: 211 }));
    const bytes = Buffer.from(JSON.stringify({ pages: Array.from({ length: 211 }, (_, index) => ({ pageNumber: index + 1, text: 'x'.repeat(100) })) }));
    const saved = new Map();
    const candidateBucket = {
        name: 'bucket',
        file(path) {
            return {
                name: path,
                async save(value, options) {
                    if (saved.has(path)) throw Object.assign(new Error('exists'), { code: 412 });
                    assert.equal(options.preconditionOpts.ifGenerationMatch, 0);
                    saved.set(path, Buffer.from(value));
                },
                async getMetadata() { return [{ generation: 'candidate-1', size: String(saved.get(path)?.length || 0) }]; },
                async download() { return [saved.get(path)]; }
            };
        },
        async getFiles({ prefix }) {
            assert.equal(prefix, 'ocr/revision-1/shards/');
            return [[{
                name: 'ocr/revision-1/shards/0001.json',
                async getMetadata() { return [{ generation: 'shard-1' }]; },
                async download(options) {
                    assert.equal(options.ifGenerationMatch, 'shard-1');
                    return [Buffer.from('raw-shard')];
                }
            }]];
        }
    };
    const parsed = {
        pages: Array.from({ length: 211 }, (_, index) => ({ pageNumber: index + 1, text: 'x'.repeat(100), words: [] })),
        pageCount: 211, physicalPageCount: 211, provenanceVerified: true,
        sourceGeneration: '17', sourceSha256: 'a'.repeat(64)
    };
    const result = await orchestration.parseRevisionOcr(db, {
        bookId: 'book-1', revisionId: 'revision-1', workerId: 'worker-1', fence: 1,
        getStorageBucket: async () => candidateBucket,
        parseDocumentAiOutput: (input) => {
            assert.equal(input.shards[0].sourceGeneration, '17');
            assert.equal(input.shards[0].sourceSha256, 'a'.repeat(64));
            return parsed;
        },
        outputUri: 'gs://bucket/ocr/revision-1/shards/'
    });
    const revision = db.docs.get('crmBooks/book-1/textRevisions/revision-1');
    assert.equal(result.stage, 'candidate_chunk');
    assert.equal(revision.candidate.path, 'crm-books/book-1/text-revisions/revision-1/candidate/pages.json');
    assert.equal(Object.prototype.hasOwnProperty.call(revision.candidate, 'pages'), false);
    assert.ok(saved.get('crm-books/book-1/text-revisions/revision-1/candidate/pages.json').length > 211 * 100);
    assert.ok(saved.get('crm-books/book-1/text-revisions/revision-1/candidate/pages.json').length < 1024 * 1024);
});

test('loadRevisionOutputShards enforces per-shard and total byte limits before retaining output', async () => {
    const oversizedDownloads = [];
    const oversizedFile = {
        name: 'ocr/revision-1/oversized.json',
        async getMetadata() { return [{ generation: 'large', size: String(50 * 1024 * 1024 + 1) }]; },
        async download() {
            oversizedDownloads.push(true);
            return [Buffer.from('{}')];
        }
    };
    await assert.rejects(
        () => orchestration.loadRevisionOutputShards({
            record: { source: { generation: '17', sha256: 'a'.repeat(64) }, submit: { outputUri: 'gs://bucket/ocr/revision-1/' } },
            bucket: { name: 'bucket', async getFiles() { return [[oversizedFile]]; } }
        }),
        (error) => error.code === 'OCR_OUTPUT_SHARD_LIMIT'
    );
    assert.equal(oversizedDownloads.length, 0);

    const files = Array.from({ length: 5 }, (_, index) => ({
        name: `ocr/revision-1/${String(index).padStart(4, '0')}.json`,
        async getMetadata() { return [{ generation: String(index), size: String(45 * 1024 * 1024) }]; },
        async download() { return [Buffer.alloc(45 * 1024 * 1024)]; }
    }));
    await assert.rejects(
        () => orchestration.loadRevisionOutputShards({
            record: { source: { generation: '17', sha256: 'a'.repeat(64) }, submit: { outputUri: 'gs://bucket/ocr/revision-1/' } },
            bucket: { name: 'bucket', async getFiles() { return [files]; } }
        }),
        (error) => error.code === 'OCR_OUTPUT_TOTAL_LIMIT'
    );
});

test('persistCandidateArtifact verifies identical immutable bytes on an idempotent retry', async () => {
    const saved = new Map();
    const bucket = {
        file(path) {
            return {
                name: path,
                async save(value) {
                    if (saved.has(path)) throw Object.assign(new Error('already exists'), { code: 412 });
                    saved.set(path, Buffer.from(value));
                },
                async getMetadata() { return [{ generation: 'candidate-1' }]; },
                async download() { return [saved.get(path)]; }
            };
        }
    };
    const parsed = { pages: [{ pageNumber: 1, text: 'same', words: [] }], pageCount: 1, provenanceVerified: true };
    const source = { generation: '17', sha256: 'a'.repeat(64) };
    const first = await orchestration.persistCandidateArtifact({
        bookId: 'book-1', revisionId: 'revision-1', parsed, source, bucket
    });
    const second = await orchestration.persistCandidateArtifact({
        bookId: 'book-1', revisionId: 'revision-1', parsed, source, bucket
    });
    assert.deepEqual(second, first);
    await assert.rejects(
        () => orchestration.persistCandidateArtifact({
            bookId: 'book-1', revisionId: 'revision-1',
            parsed: { ...parsed, pages: [{ pageNumber: 1, text: 'changed', words: [] }] }, source, bucket
        }),
        (error) => error.code === 'OCR_CANDIDATE_CONFLICT'
    );
});

test('parseRevisionOcr marks bounded parse failures and stale fences without writing candidate output', async () => {
    const db = new FakeDb({ 'crmBooks/book-1': { processingTextRevisionId: 'revision-1' } });
    seedRevision(db, makeRunningRevision({ stage: 'ocr_parse' }));
    await assert.rejects(
        () => orchestration.parseRevisionOcr(db, {
            bookId: 'book-1', revisionId: 'revision-1', workerId: 'worker-1', fence: 1,
            shards: ['bad'], parseDocumentAiOutput: () => { throw Object.assign(new Error('malformed output'), { code: 'DOCUMENT_AI_OUTPUT_INVALID' }); }
        }),
        /malformed|output/i
    );
    assert.equal(db.docs.get('crmBooks/book-1/textRevisions/revision-1').status, 'failed');
    assert.equal(db.docs.get('crmBooks/book-1').processingTextRevisionId, null);

    const staleDb = new FakeDb();
    seedRevision(staleDb, makeRunningRevision({ stage: 'ocr_parse' }));
    await assert.rejects(
        () => orchestration.parseRevisionOcr(staleDb, {
            bookId: 'book-1', revisionId: 'revision-1', workerId: 'worker-2', fence: 1,
            shards: ['bad'], parseDocumentAiOutput: () => ({ pages: [] })
        }),
        (error) => error.code === 'REVISION_WORKER_FENCE_MISMATCH'
    );
});

test('classifyRevisionError distinguishes transient retries, exhaustion, and permanent failures with bounded backoff', () => {
    assert.deepEqual(orchestration.classifyRevisionError(Object.assign(new Error('busy'), { code: 'ETIMEDOUT' }), {
        attempt: 0, maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 5000
    }), { classification: 'transient', retry: true, delayMs: 1000, code: 'ETIMEDOUT' });
    assert.deepEqual(orchestration.classifyRevisionError(Object.assign(new Error('busy'), { code: 503 }), {
        attempt: 4, maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 5000
    }), { classification: 'retry_exhausted', retry: false, delayMs: 5000, code: 503 });
    assert.equal(orchestration.classifyRevisionError(Object.assign(new Error('bad'), { code: 'DOCUMENT_AI_OUTPUT_INVALID' })).classification, 'permanent');
});

test('production OCR limits fail closed at finite monthly and active-count defaults', async () => {
    const monthlyDb = new FakeDb();
    seedRevision(monthlyDb, makeRunningRevision());
    seedBudget(monthlyDb, '2026-09', { reservedPages: orchestration.DEFAULT_MONTHLY_PAGE_LIMIT });
    await assert.rejects(
        () => orchestration.submitRevisionOcr(monthlyDb, {
            bookId: 'book-1', revisionId: 'revision-1', workerId: 'worker-1', fence: 1,
            monthKey: '2026-09', submitBatchOcr: async () => ({ operationName: 'operations/nope' })
        }),
        (error) => error.code === 'OCR_BUDGET_EXCEEDED'
    );
    const activeDb = new FakeDb();
    seedRevision(activeDb, makeRunningRevision());
    seedBudget(activeDb, '2026-09', { activeCount: orchestration.DEFAULT_MAX_ACTIVE_OCR });
    await assert.rejects(
        () => orchestration.submitRevisionOcr(activeDb, {
            bookId: 'book-1', revisionId: 'revision-1', workerId: 'worker-1', fence: 1,
            monthKey: '2026-09', submitBatchOcr: async () => ({ operationName: 'operations/nope' })
        }),
        (error) => error.code === 'OCR_ACTIVE_LIMIT_EXCEEDED'
    );
});

test('terminal poll success and failure settle one OCR reservation exactly once', async () => {
    for (const [outcome, expectedUsed] of [['success', 2], ['failure', 0]]) {
        const db = new FakeDb();
        const record = makeRunningRevision({
            stage: 'ocr_wait',
            submit: {
                status: 'submitted', state: 'submitted', operationName: 'operations/ocr-1',
                outputUri: 'gs://bucket/ocr/revision-1/', reservationId: 'book-1/revision-1/2026-09',
                monthKey: '2026-09', reservedPages: 2
            }
        });
        seedRevision(db, record);
        seedBudget(db, '2026-09', {
            reservedPages: 2, activeCount: 1,
            reservations: { 'book-1/revision-1/2026-09': { pages: 2, bookId: 'book-1', revisionId: 'revision-1' } }
        });
        const poll = () => orchestration.pollRevisionOcr(db, {
            bookId: 'book-1', revisionId: 'revision-1', workerId: 'worker-1', fence: 1,
            checkBatchOcrOperation: async () => ({
                done: true, operationName: 'operations/ocr-1',
                inputGcsSource: record.source.uri,
                outputUri: 'gs://bucket/ocr/revision-1/',
                metadata: { processorVersion: PROCESSOR.processorVersion },
                error: outcome === 'success' ? null : { code: 'DOCUMENT_AI_PROCESSOR_ERROR', message: 'terminal failure' }
            })
        });
        let result;
        if (outcome === 'success') result = await poll();
        else await assert.rejects(poll, /terminal failure/i);
        if (result) assert.equal(result.status, 'running');
        const budget = db.docs.get('crmOcrBudgets/2026-09');
        assert.equal(budget.reservedPages, 0);
        assert.equal(budget.activeCount, 0);
        assert.equal(budget.usedPages, expectedUsed);
        assert.equal(db.docs.get('crmBooks/book-1/textRevisions/revision-1').submit.settlement.state, 'settled');
    }
});

test('terminal transition and settlement share one transaction so an interruption cannot leak a reservation', async () => {
    const db = new FakeDb({ 'crmBooks/book-1': { processingTextRevisionId: 'revision-1' } });
    db.throwOnTransaction = 3;
    const record = makeRunningRevision({
        stage: 'ocr_wait',
        submit: {
            status: 'submitted', state: 'submitted', operationName: 'operations/ocr-1',
            outputUri: 'gs://bucket/ocr/revision-1/', reservationId: 'book-1/revision-1/2026-09',
            monthKey: '2026-09', reservedPages: 2
        }
    });
    seedRevision(db, record);
    seedBudget(db, '2026-09', {
        reservedPages: 2, activeCount: 1,
        reservations: { 'book-1/revision-1/2026-09': { pages: 2 } }
    });
    const result = await orchestration.pollRevisionOcr(db, {
        bookId: 'book-1', revisionId: 'revision-1', workerId: 'worker-1', fence: 1,
        checkBatchOcrOperation: async () => ({
            done: true, operationName: 'operations/ocr-1',
            inputGcsSource: record.source.uri, outputUri: record.submit.outputUri,
            metadata: { processorVersion: PROCESSOR.processorVersion }
        })
    });
    assert.equal(result.stage, 'ocr_parse');
    assert.equal(db.docs.get('crmOcrBudgets/2026-09').reservedPages, 0);
    assert.equal(db.docs.get('crmOcrBudgets/2026-09').activeCount, 0);
    assert.equal(db.docs.get('crmBooks/book-1').processingTextRevisionId, 'revision-1');
    assert.equal(db.transactionCount, 2);
});

test('runBookTextRevisionQueue claims and dispatches only running eligible revisions through injected handlers', async () => {
    const running = makeRunningRevision({ stage: 'ocr_submit' });
    const done = makeRunningRevision({ stage: 'ocr_parse' });
    done.status = 'done';
    const seen = [];
    const result = await orchestration.runBookTextRevisionQueue(new FakeDb(), {
        workerId: 'queue-worker',
        listRevisions: async () => [running, done],
        claim: async (candidate) => {
            seen.push(['claim', candidate.revisionId]);
            return candidate.revisionId === 'revision-1' ? { ...candidate, lease: { workerId: 'queue-worker', fence: 1 } } : null;
        },
        submit: async (candidate) => { seen.push(['submit', candidate.revisionId]); return candidate; }
    });
    assert.deepEqual(seen, [['claim', 'revision-1'], ['submit', 'revision-1']]);
    assert.equal(result.processed, 1);
});

test('runBookTextRevisionQueue prioritizes waits/parses, defers expected submit blocks, and continues', async () => {
    const db = new FakeDb();
    const records = [];
    for (const [revisionId, stage] of [
        ['submit-blocked', 'ocr_submit'],
        ['wait-first', 'ocr_wait'],
        ['parse-next', 'ocr_parse'],
        ['wait-second', 'ocr_wait']
    ]) {
        const record = makeRunningRevision({ stage });
        record.revisionId = revisionId;
        record.lease = { workerId: null, expiresAt: null, fence: 0 };
        if (stage === 'ocr_wait') {
            record.submit = { status: 'submitted', state: 'submitted', operationName: `operations/${revisionId}`, outputUri: 'gs://bucket/ocr/' };
        }
        seedRevision(db, record);
        records.push(record);
    }
    const seen = [];
    const result = await orchestration.runBookTextRevisionQueue(db, {
        workerId: 'queue-worker',
        now: new Date('2026-09-02T01:02:03.000Z'),
        listRevisions: async () => records,
        poll: async (candidate) => { seen.push(candidate.revisionId); return candidate; },
        parse: async (candidate) => { seen.push(candidate.revisionId); return candidate; },
        submit: async (candidate) => {
            seen.push(candidate.revisionId);
            throw Object.assign(new Error('quota blocked'), { code: 'OCR_QUOTA_EXCEEDED' });
        }
    });
    assert.deepEqual(seen, ['wait-first', 'wait-second', 'parse-next', 'submit-blocked']);
    assert.equal(result.processed, 3);
    assert.equal(result.deferred, 1);
    const deferred = db.docs.get('crmBooks/book-1/textRevisions/submit-blocked');
    assert.equal(deferred.lease.workerId, null);
    assert.equal(deferred.nextPollAt.getTime(), Date.parse('2026-09-02T01:03:03.000Z'));
});
