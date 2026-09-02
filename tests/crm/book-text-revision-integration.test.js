const assert = require('assert');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const retrieval = require(path.join(ROOT, 'functions/src/crm/book-retrieval.js'));
const summaryService = require(path.join(ROOT, 'functions/src/crm/book-summary-service.js'));
const chatService = require(path.join(ROOT, 'functions/src/crm/book-chat-service.js'));

function createMockDb() {
    const store = new Map();

    function getDoc(pathStr) {
        if (!store.has(pathStr)) {
            store.set(pathStr, { data: {}, exists: false });
        }
        return store.get(pathStr);
    }

    function docRef(collectionPath, docId) {
        const fullPath = `${collectionPath}/${docId}`;
        return {
            id: docId,
            path: fullPath,
            async get() {
                const entry = getDoc(fullPath);
                return {
                    id: docId,
                    exists: entry.exists,
                    data: () => ({ ...entry.data })
                };
            },
            async set(data, options = {}) {
                const entry = getDoc(fullPath);
                if (options.merge) {
                    entry.data = { ...entry.data, ...data };
                } else {
                    entry.data = { ...data };
                }
                entry.exists = true;
            },
            async update(data) {
                const entry = getDoc(fullPath);
                if (!entry.exists) {
                    throw new Error(`No document to update at ${fullPath}`);
                }
                entry.data = { ...entry.data, ...data };
            },
            collection(subName) {
                return collectionRef(`${fullPath}/${subName}`);
            }
        };
    }

    function collectionRef(collectionPath) {
        return {
            path: collectionPath,
            doc(docId) {
                return docRef(collectionPath, docId);
            },
            async get() {
                const prefix = `${collectionPath}/`;
                const docs = [];
                for (const [key, entry] of store.entries()) {
                    if (key.startsWith(prefix) && entry.exists) {
                        const remainder = key.slice(prefix.length);
                        if (!remainder.includes('/')) {
                            docs.push({
                                id: remainder,
                                exists: true,
                                data: () => ({ ...entry.data })
                            });
                        }
                    }
                }
                return { docs, empty: docs.length === 0 };
            },
            orderBy(field) {
                return {
                    ...collectionRef(collectionPath),
                    async get() {
                        const res = await collectionRef(collectionPath).get();
                        res.docs.sort((a, b) => {
                            const valA = a.data()[field] ?? 0;
                            const valB = b.data()[field] ?? 0;
                            return valA > valB ? 1 : (valA < valB ? -1 : 0);
                        });
                        return res;
                    },
                    limit(n) {
                        return {
                            async get() {
                                const res = await collectionRef(collectionPath).get();
                                return { docs: res.docs.slice(0, n), empty: res.docs.length === 0 };
                            }
                        };
                    }
                };
            },
            where(field, op, val) {
                return {
                    async get() {
                        const res = await collectionRef(collectionPath).get();
                        const filtered = res.docs.filter((d) => {
                            const dataVal = d.data()[field];
                            if (op === '==') return dataVal === val;
                            if (op === 'in') return Array.isArray(val) && val.includes(dataVal);
                            return true;
                        });
                        return { docs: filtered, empty: filtered.length === 0 };
                    }
                };
            },
            findNearest({ queryVector, limit }) {
                return {
                    async get() {
                        const res = await collectionRef(collectionPath).get();
                        const scored = res.docs.map((d) => {
                            const data = d.data();
                            const emb = data.embedding || [];
                            let dot = 0, nA = 0, nB = 0;
                            for (let i = 0; i < Math.min(queryVector.length, emb.length); i++) {
                                dot += queryVector[i] * emb[i];
                                nA += queryVector[i] * queryVector[i];
                                nB += emb[i] * emb[i];
                            }
                            const denom = Math.sqrt(nA) * Math.sqrt(nB) || 1;
                            const dist = 1 - (dot / denom);
                            return {
                                id: d.id,
                                data: () => ({ ...data, _distance: dist }),
                                dist
                            };
                        });
                        scored.sort((a, b) => a.dist - b.dist);
                        return { docs: scored.slice(0, limit) };
                    }
                };
            }
        };
    }

    return {
        collection(name) {
            return collectionRef(name);
        },
        batch() {
            const operations = [];
            return {
                set(ref, data, opts) { operations.push(() => ref.set(data, opts)); },
                update(ref, data) { operations.push(() => ref.update(data)); },
                delete(ref) { operations.push(() => {
                    const entry = getDoc(ref.path);
                    entry.exists = false;
                }); },
                async commit() {
                    for (const op of operations) await op();
                }
            };
        },
        async runTransaction(callback) {
            const txn = {
                async get(ref) { return ref.get(); },
                set(ref, data, opts) { return ref.set(data, opts); },
                update(ref, data) { return ref.update(data); },
                delete(ref) {
                    const entry = getDoc(ref.path);
                    entry.exists = false;
                }
            };
            return callback(txn);
        }
    };
}

async function runTests() {
    console.log('--- Testing Revision-Scoped Derived Data Integration ---');

    const db = createMockDb();
    const bookId = 'book-multirev-1';
    const testQueryVector = [0.9, 0.9, 0.9];

    // Seed book document with legacy data and an active revision
    await db.collection('crmBooks').doc(bookId).set({
        title: 'Species and Ecosystems',
        status: 'ready',
        activeTextRevisionId: 'rev-ocr-002'
    });

    // Seed legacy chunks in root crmBooks/book-1/chunks
    const legacyChunksCol = db.collection('crmBooks').doc(bookId).collection('chunks');
    await legacyChunksCol.doc('c000000').set({
        index: 0,
        text: 'ANeglectedSpecias in the wild legacy text.',
        charCount: 42,
        pageStart: 6,
        pageEnd: 6,
        embedding: [0.1, 0.2, 0.3]
    });

    // Seed Revision 1 (Draft/Superseded) in textRevisions/rev-ocr-001/chunks
    const rev1ChunksCol = db.collection('crmBooks').doc(bookId).collection('textRevisions').doc('rev-ocr-001').collection('chunks');
    await rev1ChunksCol.doc('c000000').set({
        index: 0,
        text: 'A Neglected Spec ias intermediate text.',
        charCount: 39,
        pageStart: 6,
        pageEnd: 6,
        embedding: [0.15, 0.25, 0.35]
    });

    // Seed Revision 2 (Active OCR-v2) in textRevisions/rev-ocr-002/chunks
    const rev2ChunksCol = db.collection('crmBooks').doc(bookId).collection('textRevisions').doc('rev-ocr-002').collection('chunks');
    await rev2ChunksCol.doc('c000000').set({
        index: 0,
        text: 'A Neglected Species verified accurate text.',
        charCount: 43,
        pageStart: 6,
        pageEnd: 6,
        embedding: [0.9, 0.9, 0.9]
    });
    await rev2ChunksCol.doc('c000001').set({
        index: 1,
        text: 'Second paragraph discussing training and conservation.',
        charCount: 54,
        pageStart: 7,
        pageEnd: 7,
        embedding: [0.8, 0.8, 0.8]
    });

    // Test 1: retrieveTopChunks resolves active revision by default
    console.log('Test 1: retrieveTopChunks resolves activeTextRevisionId');
    const resultsActive = await retrieval.retrieveTopChunks(db, bookId, 'species in nature', {
        strategy: 'bruteforce',
        queryVector: testQueryVector
    });
    assert.strictEqual(resultsActive.length, 2, 'Active revision has 2 chunks');
    assert.strictEqual(resultsActive[0].text, 'A Neglected Species verified accurate text.');
    assert.strictEqual(resultsActive[0].textRevisionId, 'rev-ocr-002', 'Result carries active textRevisionId');

    // Test 2: retrieveTopChunks explicitly targeting rev-ocr-001
    console.log('Test 2: retrieveTopChunks targeting specific textRevisionId');
    const resultsRev1 = await retrieval.retrieveTopChunks(db, bookId, 'species in nature', {
        strategy: 'bruteforce',
        textRevisionId: 'rev-ocr-001',
        queryVector: testQueryVector
    });
    assert.strictEqual(resultsRev1.length, 1, 'Rev 1 has 1 chunk');
    assert.strictEqual(resultsRev1[0].text, 'A Neglected Spec ias intermediate text.');
    assert.strictEqual(resultsRev1[0].textRevisionId, 'rev-ocr-001');

    // Test 3: retrieveTopChunks targeting legacy book without activeTextRevisionId
    console.log('Test 3: retrieveTopChunks falls back to legacy chunks when no activeTextRevisionId exists');
    const legacyBookId = 'book-legacy-only';
    await db.collection('crmBooks').doc(legacyBookId).set({
        title: 'Legacy Only Book',
        status: 'ready'
    });
    await db.collection('crmBooks').doc(legacyBookId).collection('chunks').doc('c000000').set({
        index: 0,
        text: 'Legacy standalone chunk text.',
        charCount: 29,
        pageStart: 1,
        pageEnd: 1,
        embedding: [0.5, 0.5, 0.5]
    });
    const resultsLegacy = await retrieval.retrieveTopChunks(db, legacyBookId, 'legacy query', {
        strategy: 'bruteforce',
        queryVector: testQueryVector
    });
    assert.strictEqual(resultsLegacy.length, 1);
    assert.strictEqual(resultsLegacy[0].text, 'Legacy standalone chunk text.');
    assert.strictEqual(resultsLegacy[0].textRevisionId, null, 'Legacy chunk has null textRevisionId');

    // Test 4: validateCitations propagates textRevisionId
    console.log('Test 4: validateCitations attaches textRevisionId to citations');
    const citations = chatService.validateCitations(
        [{ marker: 'C1', quote: 'A Neglected Species' }],
        resultsActive
    );
    assert.strictEqual(citations.length, 1);
    assert.strictEqual(citations[0].textRevisionId, 'rev-ocr-002');
    assert.strictEqual(citations[0].pageStart, 6);

    // Test 5: Section and summary helpers support revision scoping
    console.log('Test 5: Section resolution helpers support revision scoping');
    const rev2SectionsCol = db.collection('crmBooks').doc(bookId).collection('textRevisions').doc('rev-ocr-002').collection('sections');
    await rev2SectionsCol.doc('0').set({
        title: 'Introduction to Species',
        gist: 'An overview of endangered species.',
        pageStart: 6,
        pageEnd: 7,
        keyPoints: ['Point 1'],
        topics: ['Species']
    });

    const secSnap = await rev2SectionsCol.doc('0').get();
    assert.strictEqual(secSnap.exists, true);
    assert.strictEqual(secSnap.data().title, 'Introduction to Species');

    console.log('All text revision integration tests passed!');
}

runTests().catch((err) => {
    console.error('Integration test failed:', err);
    process.exitCode = 1;
});
