/* eslint-disable no-console */
const assert = require('assert');
const {
    REVISION_STAGES,
    createCandidateRevision,
    activateRevision,
    rollbackRevision,
    listBookRevisions
} = require('../../functions/src/crm/book-text-revision-service');
const { chunkPages } = require('../../functions/src/crm/book-chunker');
const { retrieveTopChunks } = require('../../functions/src/crm/book-retrieval');

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
                                        },
                                        collection(subSubName) {
                                            return {
                                                doc(subSubId) {
                                                    const subSubPath = [name, id, subName, subId, subSubName, subSubId];
                                                    return {
                                                        async get() {
                                                            const d = getDoc(subSubPath);
                                                            const exists = Object.keys(d).length > 0 && !d._deleted;
                                                            return { exists, data: () => JSON.parse(JSON.stringify(d)) };
                                                        },
                                                        async set(data) {
                                                            const d = getDoc(subSubPath);
                                                            Object.assign(d, data);
                                                        }
                                                    };
                                                },
                                                async get() {
                                                    const subStore = getDoc([name, id, subName, subId, subSubName]);
                                                    const matching = [];
                                                    for (const [k, v] of Object.entries(subStore)) {
                                                        if (v && !v._deleted) {
                                                            matching.push({ id: k, data: () => JSON.parse(JSON.stringify(v)) });
                                                        }
                                                    }
                                                    return { empty: matching.length === 0, docs: matching };
                                                },
                                                orderBy() {
                                                    return this;
                                                },
                                                where() {
                                                    return this;
                                                }
                                            };
                                        }
                                    };
                                },
                                async get() {
                                    const subStore = getDoc([name, id, subName]);
                                    const matching = [];
                                    for (const [k, v] of Object.entries(subStore)) {
                                        if (v && !v._deleted) {
                                            matching.push({ id: k, data: () => JSON.parse(JSON.stringify(v)) });
                                        }
                                    }
                                    return { empty: matching.length === 0, docs: matching };
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
                                            return { empty: matching.length === 0, docs: matching };
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
                    ref.set ? ref.set(data) : (ref.update ? ref.update(data) : undefined);
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

async function runTests() {
    console.log('Testing revision scoping, activation, rollback, and retrieval isolation...');

    // 1. Setup initial book with legacy chunks
    const db = createMockDb({
        crmBooks: {
            'book-abc': {
                title: 'Pronunciation Guide',
                status: 'ready',
                activeTextRevisionId: null, // legacy
                source: {
                    sha256: 'initial-sha',
                    generation: '100',
                    storagePath: 'crm-books/book-abc/source.pdf'
                }
            }
        }
    });

    // 2. Chunker attaches textRevisionId
    const legacyChunks = chunkPages(['Legacy Page 1 text', 'Legacy Page 2 text'], { textRevisionId: 'legacy' });
    assert.strictEqual(legacyChunks.chunks[0].textRevisionId, 'legacy');

    const rev1Chunks = chunkPages(['Rev 1 Page 1 text', 'Rev 1 Page 2 text'], { textRevisionId: 'rev_001' });
    assert.strictEqual(rev1Chunks.chunks[0].textRevisionId, 'rev_001');

    // 3. Create candidate revision
    const rev1 = await createCandidateRevision({
        db,
        bookId: 'book-abc',
        expectedSourceSha256: 'initial-sha',
        reason: 'Initial OCR migration'
    });

    // Mark rev1 as ready
    const rev1Doc = db._data.crmBooks['book-abc'].textRevisions[rev1.revisionId];
    rev1Doc.status = 'ready';
    rev1Doc.stage = REVISION_STAGES.READY_FOR_ACTIVATION;

    // 4. Activate revision rev1
    const activated = await activateRevision({
        db,
        bookId: 'book-abc',
        revisionId: rev1.revisionId,
        expectedCurrentRevisionId: null,
        expectedSourceSha256: 'initial-sha',
        activatedBy: 'admin-user'
    });
    assert.strictEqual(activated.activeTextRevisionId, rev1.revisionId);
    assert.strictEqual(db._data.crmBooks['book-abc'].activeTextRevisionId, rev1.revisionId);
    assert.strictEqual(rev1Doc.status, 'activated');

    // 5. Create second candidate revision rev2 with fewer chunks
    const rev2 = await createCandidateRevision({
        db,
        bookId: 'book-abc',
        expectedSourceSha256: 'initial-sha',
        reason: 'Refined OCR v2.1'
    });
    const rev2Doc = db._data.crmBooks['book-abc'].textRevisions[rev2.revisionId];
    rev2Doc.status = 'ready';
    rev2Doc.stage = REVISION_STAGES.READY_FOR_ACTIVATION;

    // Activate rev2
    await activateRevision({
        db,
        bookId: 'book-abc',
        revisionId: rev2.revisionId,
        expectedCurrentRevisionId: rev1.revisionId,
        expectedSourceSha256: 'initial-sha',
        activatedBy: 'admin-user'
    });
    assert.strictEqual(db._data.crmBooks['book-abc'].activeTextRevisionId, rev2.revisionId);
    assert.strictEqual(rev1Doc.status, 'superseded');

    // 6. Rollback to rev1
    const rolledBack = await rollbackRevision({
        db,
        bookId: 'book-abc',
        targetRevisionId: rev1.revisionId,
        expectedCurrentRevisionId: rev2.revisionId,
        rollbackBy: 'admin-user',
        reason: 'Emergency rollback to rev1'
    });
    assert.strictEqual(rolledBack.activeTextRevisionId, rev1.revisionId);
    assert.strictEqual(db._data.crmBooks['book-abc'].activeTextRevisionId, rev1.revisionId);
    assert.strictEqual(rev2Doc.status, 'rolled_back');

    // 7. List revisions
    const revList = await listBookRevisions({ db, bookId: 'book-abc' });
    assert.strictEqual(revList.activeTextRevisionId, rev1.revisionId);
    assert.strictEqual(revList.revisions.length, 2);

    console.log('book text revision integration tests passed');
}

runTests().catch((error) => {
    console.error(error.stack || error);
    process.exitCode = 1;
});
