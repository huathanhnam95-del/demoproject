/* eslint-disable no-console */
const assert = require('assert');
const {
    REVISION_STAGES,
    createCandidateRevision,
    acquireRevisionLease,
    advanceRevisionStage,
    recordRevisionFailure,
    processRevisionStep
} = require('../../functions/src/crm/book-text-revision-service');

function createMockDb(initialState = {}) {
    const dataStore = JSON.parse(JSON.stringify(initialState));

    function getDoc(pathParts) {
        let curr = dataStore;
        for (const p of pathParts) {
            if (!curr[p]) curr[p] = {};
            curr = curr[p];
        }
        return curr;
    }

    function applyPatch(target, patch) {
        for (const [k, v] of Object.entries(patch)) {
            if (k.includes('.')) {
                const parts = k.split('.');
                let curr = target;
                for (let i = 0; i < parts.length - 1; i++) {
                    if (!curr[parts[i]]) curr[parts[i]] = {};
                    curr = curr[parts[i]];
                }
                curr[parts[parts.length - 1]] = v;
            } else {
                target[k] = v;
            }
        }
    }

    const db = {
        _data: dataStore,
        collection(name) {
            return {
                doc(id) {
                    const bookPath = [name, id];
                    return {
                        async get() {
                            const d = getDoc(bookPath);
                            const exists = Object.keys(d).length > 0 && !d._deleted;
                            return {
                                exists,
                                data: () => JSON.parse(JSON.stringify(d))
                            };
                        },
                        async update(patch) {
                            const d = getDoc(bookPath);
                            applyPatch(d, patch);
                        },
                        collection(subName) {
                            return {
                                doc(subId) {
                                    const subPath = [name, id, subName, subId];
                                    return {
                                        async get() {
                                            const d = getDoc(subPath);
                                            const exists = Object.keys(d).length > 0 && !d._deleted;
                                            return {
                                                exists,
                                                data: () => JSON.parse(JSON.stringify(d))
                                            };
                                        },
                                        async update(patch) {
                                            const d = getDoc(subPath);
                                            applyPatch(d, patch);
                                        }
                                    };
                                },
                                where(field, op, val) {
                                    return {
                                        async get() {
                                            const subStore = getDoc([name, id, subName]);
                                            const matching = [];
                                            for (const [k, v] of Object.entries(subStore)) {
                                                if (v && !v._deleted) {
                                                    if (op === 'in' && Array.isArray(val) && val.includes(v[field])) {
                                                        matching.push({ id: k, data: () => JSON.parse(JSON.stringify(v)) });
                                                    } else if (op === '==' && v[field] === val) {
                                                        matching.push({ id: k, data: () => JSON.parse(JSON.stringify(v)) });
                                                    }
                                                }
                                            }
                                            return {
                                                empty: matching.length === 0,
                                                docs: matching
                                            };
                                        }
                                    };
                                }
                            };
                        }
                    };
                }
            };
        },
        async runTransaction(callback) {
            const txn = {
                async get(ref) {
                    return ref.get();
                },
                set(ref, data) {
                    // Update internal store directly
                    ref.update ? ref.update(data) : undefined;
                },
                update(ref, patch) {
                    ref.update ? ref.update(patch) : undefined;
                }
            };
            return callback(txn);
        }
    };

    return db;
}

function createMockStorage() {
    const files = {};
    return {
        name: 'test-bucket',
        _files: files,
        file(name) {
            return {
                async save(buffer, options) {
                    files[name] = { buffer: Buffer.from(buffer), options };
                },
                async download() {
                    if (!files[name]) throw new Error(`File ${name} not found`);
                    return [files[name].buffer];
                }
            };
        },
        async getFiles({ prefix }) {
            const matching = Object.keys(files)
                .filter((k) => k.startsWith(prefix))
                .map((k) => ({
                    name: k,
                    async download() {
                        return [files[k].buffer];
                    }
                }));
            return [matching];
        }
    };
}

async function runTests() {
    console.log('Testing book text revision state machine and fencing...');

    const initialBookData = {
        crmBooks: {
            'book-123': {
                title: 'Test Book',
                source: {
                    storagePath: 'crm-books/book-123/source.pdf',
                    sha256: 'abc123sha256',
                    generation: '1234567890',
                    sizeBytes: 15000000,
                    pageCount: 211
                }
            }
        }
    };

    const db = createMockDb(initialBookData);

    // 1. Create candidate revision
    const rev = await createCandidateRevision({
        db,
        bookId: 'book-123',
        expectedSourceSha256: 'abc123sha256',
        expectedSourceGeneration: '1234567890',
        reason: 'Repair corrupt text layer'
    });

    assert.ok(rev.revisionId.startsWith('rev_'));
    assert.strictEqual(rev.stage, REVISION_STAGES.OCR_SUBMIT);
    assert.strictEqual(rev.status, 'pending');

    // 2. Reject mismatch source SHA / generation
    await assert.rejects(
        () => createCandidateRevision({
            db,
            bookId: 'book-123',
            expectedSourceSha256: 'wrong-sha'
        }),
        (err) => err.code === 'SOURCE_SHA_MISMATCH',
        'Should reject mismatched source SHA'
    );

    // 3. Concurrency check: reject second candidate while one is pending/in_progress
    await assert.rejects(
        () => createCandidateRevision({
            db,
            bookId: 'book-123',
            expectedSourceSha256: 'abc123sha256'
        }),
        (err) => err.code === 'REVISION_ALREADY_IN_PROGRESS',
        'Should reject concurrent revisions for same book'
    );

    // 4. Acquire lease and fence
    const leased = await acquireRevisionLease({
        db,
        bookId: 'book-123',
        revisionId: rev.revisionId,
        workerId: 'worker-1'
    });
    assert.ok(leased.fenceToken, 'Must generate fencing token');
    assert.strictEqual(leased.lease.workerId, 'worker-1');

    // 5. Competing worker rejected while lease active
    await assert.rejects(
        () => acquireRevisionLease({
            db,
            bookId: 'book-123',
            revisionId: rev.revisionId,
            workerId: 'worker-2'
        }),
        (err) => err.code === 'LEASE_ACTIVE',
        'Active lease must reject other workers'
    );

    // 6. Advance stage with invalid fence rejected
    await assert.rejects(
        () => advanceRevisionStage({
            db,
            bookId: 'book-123',
            revisionId: rev.revisionId,
            expectedFence: 'stale-fence-token',
            fromStage: REVISION_STAGES.OCR_SUBMIT,
            toStage: REVISION_STAGES.OCR_WAIT
        }),
        (err) => err.code === 'STALE_WORKER_REJECTED',
        'Stale worker fence must be rejected'
    );

    // 7. Full step execution: ocr_submit -> ocr_wait
    const storage = createMockStorage();
    let batchSubmitted = 0;
    const mockOcrClient = {
        async batchProcessDocuments(req) {
            batchSubmitted++;
            return [{ name: 'operations/ocr-op-999' }];
        },
        async getOperation({ name }) {
            return [{ done: true, name }];
        }
    };
    const ocrConfig = {
        processor: 'projects/p/locations/us/processors/ocr-v2',
        location: 'us',
        processorVersion: 'pretrained-ocr-v2.1-2024-08-07'
    };

    // Run OCR_SUBMIT step
    const step1 = await processRevisionStep({
        db,
        storageBucket: storage,
        ocrClient: mockOcrClient,
        bookId: 'book-123',
        revisionId: rev.revisionId,
        workerId: 'worker-1',
        ocrConfig
    });
    assert.strictEqual(step1.stage, REVISION_STAGES.OCR_WAIT);
    assert.strictEqual(batchSubmitted, 1, 'Exactly one OCR batch submit must occur');

    // Run OCR_WAIT step (operation is mock-done -> advances to OCR_PARSE)
    const step2 = await processRevisionStep({
        db,
        storageBucket: storage,
        ocrClient: mockOcrClient,
        bookId: 'book-123',
        revisionId: rev.revisionId,
        workerId: 'worker-1',
        ocrConfig
    });
    assert.strictEqual(step2.stage, REVISION_STAGES.OCR_PARSE);
    assert.strictEqual(step2.done, true);

    // Seed mock OCR output shard in storage
    const outputPrefix = `crm-books/book-123/text-revisions/${rev.revisionId}/raw-ocr/`;
    const mockShard = {
        document: {
            text: 'Chapter 1\nA Neglected Species',
            pages: [
                {
                    pageNumber: 1,
                    paragraphs: [{ layout: { textAnchor: { textSegments: [{ startIndex: 0, endIndex: 29 }] } } }]
                }
            ]
        }
    };
    await storage.file(`${outputPrefix}shard_0.json`).save(JSON.stringify(mockShard));

    // Run OCR_PARSE step
    const step3 = await processRevisionStep({
        db,
        storageBucket: storage,
        ocrClient: mockOcrClient,
        bookId: 'book-123',
        revisionId: rev.revisionId,
        workerId: 'worker-1',
        ocrConfig
    });
    assert.strictEqual(step3.stage, REVISION_STAGES.CANDIDATE_CHUNK);
    assert.strictEqual(step3.totalPages, 1);

    // Check candidate pages.json was written to storage
    const candidatePagesPath = `crm-books/book-123/text-revisions/${rev.revisionId}/pages.json`;
    assert.ok(storage._files[candidatePagesPath], 'Candidate pages.json must be saved in storage');
    const savedCandidate = JSON.parse(storage._files[candidatePagesPath].buffer.toString('utf8'));
    assert.strictEqual(savedCandidate.revisionId, rev.revisionId);
    assert.strictEqual(savedCandidate.rendererContract, 'ocr-v2');
    assert.strictEqual(savedCandidate.pages[0], 'Chapter 1\nA Neglected Species');

    console.log('book text revision state machine and fencing tests passed');
}

runTests().catch((error) => {
    console.error(error.stack || error);
    process.exitCode = 1;
});
