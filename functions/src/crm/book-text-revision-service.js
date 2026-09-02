const crypto = require('crypto');
const { getOcrConfig, submitBatchOcr, parseDocumentAiShards } = require('./book-document-ocr-service');
const { assessBookTextQuality } = require('./book-text-quality');

const CRM_BOOKS = 'crmBooks';
const TEXT_REVISIONS = 'textRevisions';

const REVISION_STAGES = {
    OCR_SUBMIT: 'ocr_submit',
    OCR_WAIT: 'ocr_wait',
    OCR_PARSE: 'ocr_parse',
    CANDIDATE_CHUNK: 'candidate_chunk',
    CANDIDATE_EMBED: 'candidate_embed',
    CANDIDATE_SUMMARIZE: 'candidate_summarize',
    CANDIDATE_VERIFY: 'candidate_verify',
    READY_FOR_ACTIVATION: 'ready_for_activation',
    ACTIVATED: 'activated',
    FAILED: 'failed'
};

const LIMITS = {
    MAX_PDF_SIZE_BYTES: 100 * 1024 * 1024, // 100 MB
    MAX_PAGE_COUNT: 500,
    LEASE_DURATION_MS: 7 * 60 * 1000,     // 7 minutes
    MAX_POLL_ATTEMPTS: 60
};

function generateRevisionId() {
    const timestamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
    const rand = crypto.randomBytes(4).toString('hex');
    return `rev_${timestamp}_${rand}`;
}

async function createCandidateRevision({
    db,
    bookId,
    expectedSourceSha256,
    expectedSourceGeneration,
    reason = 'OCR text accuracy recovery',
    requestedBy = 'admin'
}) {
    if (!bookId) throw new Error('bookId is required');

    const bookRef = db.collection(CRM_BOOKS).doc(bookId);

    return db.runTransaction(async (txn) => {
        const bookSnap = await txn.get(bookRef);
        if (!bookSnap.exists) {
            throw Object.assign(new Error(`Book ${bookId} not found`), { code: 'BOOK_NOT_FOUND' });
        }

        const bookData = bookSnap.data();
        const source = bookData.source || {};

        if (expectedSourceSha256 && source.sha256 && source.sha256 !== expectedSourceSha256) {
            throw Object.assign(
                new Error(`Source SHA256 mismatch: expected ${expectedSourceSha256}, found ${source.sha256}`),
                { code: 'SOURCE_SHA_MISMATCH' }
            );
        }

        if (expectedSourceGeneration && source.generation && String(source.generation) !== String(expectedSourceGeneration)) {
            throw Object.assign(
                new Error(`Source generation mismatch: expected ${expectedSourceGeneration}, found ${source.generation}`),
                { code: 'SOURCE_GENERATION_MISMATCH' }
            );
        }

        if (source.sizeBytes && source.sizeBytes > LIMITS.MAX_PDF_SIZE_BYTES) {
            throw Object.assign(
                new Error(`File size ${source.sizeBytes} exceeds 100MB limit`),
                { code: 'SOURCE_SIZE_EXCEEDED' }
            );
        }

        if (source.pageCount && source.pageCount > LIMITS.MAX_PAGE_COUNT) {
            throw Object.assign(
                new Error(`Page count ${source.pageCount} exceeds 500 page limit`),
                { code: 'PAGE_COUNT_EXCEEDED' }
            );
        }

        // Concurrency check: ensure no active running candidate revision
        const existingRevs = await txn.get(
            bookRef.collection(TEXT_REVISIONS)
                .where('status', 'in', ['pending', 'in_progress'])
        );

        if (!existingRevs.empty) {
            const runningRev = existingRevs.docs[0].data();
            throw Object.assign(
                new Error(`Another candidate revision ${runningRev.revisionId} is currently ${runningRev.stage}`),
                { code: 'REVISION_ALREADY_IN_PROGRESS', activeRevisionId: runningRev.revisionId }
            );
        }

        const revisionId = generateRevisionId();
        const revRef = bookRef.collection(TEXT_REVISIONS).doc(revisionId);

        const revisionRecord = {
            revisionId,
            bookId,
            stage: REVISION_STAGES.OCR_SUBMIT,
            status: 'pending',
            source: {
                storagePath: source.storagePath,
                sha256: source.sha256 || null,
                generation: source.generation || null,
                sizeBytes: source.sizeBytes || null
            },
            lease: null,
            ocr: {
                processor: null,
                operationName: null,
                outputPrefix: null,
                attempts: 0,
                lastPolledAt: null
            },
            manifest: null,
            reason,
            requestedBy,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        txn.set(revRef, revisionRecord);
        return revisionRecord;
    });
}

async function acquireRevisionLease({ db, bookId, revisionId, workerId }) {
    const revRef = db.collection(CRM_BOOKS).doc(bookId).collection(TEXT_REVISIONS).doc(revisionId);

    return db.runTransaction(async (txn) => {
        const snap = await txn.get(revRef);
        if (!snap.exists) {
            throw Object.assign(new Error(`Revision ${revisionId} not found`), { code: 'REVISION_NOT_FOUND' });
        }

        const data = snap.data();
        const now = Date.now();

        if (data.status === 'failed' || data.status === 'activated') {
            throw Object.assign(
                new Error(`Cannot acquire lease on revision in ${data.status} status`),
                { code: 'REVISION_NOT_RUNNABLE' }
            );
        }

        if (data.lease && data.lease.expiresAt > now && data.lease.workerId !== workerId) {
            throw Object.assign(
                new Error(`Revision is leased by worker ${data.lease.workerId} until ${new Date(data.lease.expiresAt).toISOString()}`),
                { code: 'LEASE_ACTIVE' }
            );
        }

        const fenceToken = crypto.randomBytes(8).toString('hex');
        const lease = {
            workerId,
            fenceToken,
            acquiredAt: now,
            expiresAt: now + LIMITS.LEASE_DURATION_MS
        };

        txn.update(revRef, {
            lease,
            status: 'in_progress',
            updatedAt: new Date().toISOString()
        });

        return { ...data, lease, fenceToken };
    });
}

async function advanceRevisionStage({
    db,
    bookId,
    revisionId,
    expectedFence,
    fromStage,
    toStage,
    updates = {}
}) {
    const bookRef = db.collection(CRM_BOOKS).doc(bookId);
    const revRef = bookRef.collection(TEXT_REVISIONS).doc(revisionId);

    return db.runTransaction(async (txn) => {
        const [bookSnap, revSnap] = await Promise.all([
            txn.get(bookRef),
            txn.get(revRef)
        ]);

        if (!revSnap.exists) {
            throw Object.assign(new Error(`Revision ${revisionId} not found`), { code: 'REVISION_NOT_FOUND' });
        }

        const revData = revSnap.data();
        const bookData = bookSnap.data() || {};

        // Fence validation: prevent stale workers from publishing
        if (!revData.lease || revData.lease.fenceToken !== expectedFence) {
            throw Object.assign(
                new Error(`Stale worker fence rejected: expected ${expectedFence}`),
                { code: 'STALE_WORKER_REJECTED' }
            );
        }

        // Source generation check: ensure source PDF was not replaced mid-operation
        if (revData.source.generation && bookData.source?.generation &&
            String(revData.source.generation) !== String(bookData.source.generation)) {
            throw Object.assign(
                new Error('Source generation changed while revision was processing'),
                { code: 'SOURCE_GENERATION_MISMATCH' }
            );
        }

        if (fromStage && revData.stage !== fromStage) {
            throw Object.assign(
                new Error(`Stage transition mismatch: expected fromStage ${fromStage} but current is ${revData.stage}`),
                { code: 'INVALID_STAGE_TRANSITION' }
            );
        }

        const patch = {
            stage: toStage,
            updatedAt: new Date().toISOString(),
            ...updates
        };

        if (toStage === REVISION_STAGES.READY_FOR_ACTIVATION) {
            patch.status = 'ready';
            patch.lease = null; // Release lease upon completion of candidate prep
        }

        txn.update(revRef, patch);
        return { ...revData, ...patch };
    });
}

async function recordRevisionFailure({
    db,
    bookId,
    revisionId,
    expectedFence,
    errorMessage,
    errorCode = 'REVISION_PROCESSING_ERROR',
    isPermanent = false
}) {
    const revRef = db.collection(CRM_BOOKS).doc(bookId).collection(TEXT_REVISIONS).doc(revisionId);

    return db.runTransaction(async (txn) => {
        const revSnap = await txn.get(revRef);
        if (!revSnap.exists) return;
        const revData = revSnap.data();

        if (expectedFence && revData.lease && revData.lease.fenceToken !== expectedFence) {
            return; // Ignore stale worker failure reports
        }

        txn.update(revRef, {
            status: 'failed',
            stage: REVISION_STAGES.FAILED,
            error: {
                message: errorMessage,
                code: errorCode,
                isPermanent,
                failedAt: new Date().toISOString()
            },
            lease: null,
            updatedAt: new Date().toISOString()
        });
    });
}

/**
 * Step runner: executes one discrete idempotent stage for the leased revision.
 */
async function processRevisionStep({
    db,
    storageBucket,
    ocrClient,
    bookId,
    revisionId,
    workerId,
    ocrConfig
}) {
    const leased = await acquireRevisionLease({ db, bookId, revisionId, workerId });
    const { fenceToken, stage, source, ocr } = leased;

    try {
        if (stage === REVISION_STAGES.OCR_SUBMIT) {
            const bucketName = storageBucket.name;
            const sourceGcsUri = `gs://${bucketName}/${source.storagePath}`;
            const outputPrefix = `crm-books/${bookId}/text-revisions/${revisionId}/raw-ocr/`;
            const outputGcsUriPrefix = `gs://${bucketName}/${outputPrefix}`;

            const submitResult = await submitBatchOcr({
                client: ocrClient,
                sourceGcsUri,
                outputGcsUriPrefix,
                config: ocrConfig
            });

            await advanceRevisionStage({
                db,
                bookId,
                revisionId,
                expectedFence: fenceToken,
                fromStage: REVISION_STAGES.OCR_SUBMIT,
                toStage: REVISION_STAGES.OCR_WAIT,
                updates: {
                    'ocr.operationName': submitResult.operationName,
                    'ocr.outputPrefix': outputPrefix,
                    'ocr.processor': submitResult.processor,
                    'ocr.submittedAt': submitResult.submitTime,
                    'ocr.attempts': 1
                }
            });

            return { stage: REVISION_STAGES.OCR_WAIT, operationName: submitResult.operationName };
        }

        if (stage === REVISION_STAGES.OCR_WAIT) {
            if (!ocr.operationName) {
                throw new Error('No OCR operation name to poll');
            }

            const [operation] = await ocrClient.getOperation({ name: ocr.operationName });
            const isDone = operation.done;

            if (!isDone) {
                // Still processing: update poll timestamp and attempt count
                const attempts = (ocr.attempts || 0) + 1;
                if (attempts > LIMITS.MAX_POLL_ATTEMPTS) {
                    throw Object.assign(new Error('OCR batch operation timed out after maximum poll attempts'), {
                        code: 'OCR_TIMEOUT'
                    });
                }

                await db.collection(CRM_BOOKS).doc(bookId).collection(TEXT_REVISIONS).doc(revisionId).update({
                    'ocr.attempts': attempts,
                    'ocr.lastPolledAt': new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                });

                return { stage: REVISION_STAGES.OCR_WAIT, done: false, attempts };
            }

            if (operation.error) {
                throw Object.assign(new Error(operation.error.message || 'Document AI OCR operation failed'), {
                    code: 'OCR_OPERATION_FAILED',
                    details: operation.error
                });
            }

            await advanceRevisionStage({
                db,
                bookId,
                revisionId,
                expectedFence: fenceToken,
                fromStage: REVISION_STAGES.OCR_WAIT,
                toStage: REVISION_STAGES.OCR_PARSE
            });

            return { stage: REVISION_STAGES.OCR_PARSE, done: true };
        }

        if (stage === REVISION_STAGES.OCR_PARSE) {
            const outputPrefix = ocr.outputPrefix;
            const [files] = await storageBucket.getFiles({ prefix: outputPrefix });
            const jsonFiles = files.filter((f) => f.name.endsWith('.json'));

            if (jsonFiles.length === 0) {
                throw Object.assign(new Error('No OCR output JSON files found in storage prefix'), {
                    code: 'OCR_OUTPUT_MISSING'
                });
            }

            const shardContents = await Promise.all(
                jsonFiles.map(async (file) => {
                    const [content] = await file.download();
                    return JSON.parse(content.toString('utf8'));
                })
            );

            const parsed = parseDocumentAiShards(shardContents);

            // Save candidate revision pages.json
            const candidatePagesPath = `crm-books/${bookId}/text-revisions/${revisionId}/pages.json`;
            const pagesPayload = {
                revisionId,
                schemaVersion: '2.0',
                rendererContract: 'ocr-v2',
                sourceSha256: source.sha256,
                totalPages: parsed.totalPages,
                pages: parsed.pages,
                pagesHash: parsed.pagesHash,
                textQuality: parsed.textQuality,
                createdAt: new Date().toISOString()
            };

            await storageBucket.file(candidatePagesPath).save(
                Buffer.from(JSON.stringify(pagesPayload, null, 2)),
                { contentType: 'application/json', resumable: false }
            );

            await advanceRevisionStage({
                db,
                bookId,
                revisionId,
                expectedFence: fenceToken,
                fromStage: REVISION_STAGES.OCR_PARSE,
                toStage: REVISION_STAGES.CANDIDATE_CHUNK,
                updates: {
                    candidatePagesPath,
                    totalPages: parsed.totalPages,
                    pagesHash: parsed.pagesHash,
                    textQuality: parsed.textQuality
                }
            });

            return { stage: REVISION_STAGES.CANDIDATE_CHUNK, totalPages: parsed.totalPages };
        }

        if (stage === REVISION_STAGES.CANDIDATE_CHUNK) {
            const candidatePagesPath = leased.candidatePagesPath || `crm-books/${bookId}/text-revisions/${revisionId}/pages.json`;
            const [content] = await storageBucket.file(candidatePagesPath).download();
            const pagesPayload = JSON.parse(content.toString('utf8'));
            const { chunkPages } = require('./book-chunker');
            const chunks = chunkPages(pagesPayload.pages || [], { textRevisionId: revisionId });

            const chunksCol = db.collection(CRM_BOOKS).doc(bookId).collection(TEXT_REVISIONS).doc(revisionId).collection('chunks');
            const existingChunks = await chunksCol.get();

            const BATCH_SIZE = 400;
            for (let i = 0; i < existingChunks.docs.length; i += BATCH_SIZE) {
                const delBatch = db.batch();
                existingChunks.docs.slice(i, i + BATCH_SIZE).forEach(d => delBatch.delete(d.ref));
                await delBatch.commit();
            }

            for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
                const writeBatch = db.batch();
                chunks.slice(i, i + BATCH_SIZE).forEach((c) => {
                    const docRef = chunksCol.doc(String(c.index));
                    writeBatch.set(docRef, { ...c, textRevisionId: revisionId, createdAt: new Date() });
                });
                await writeBatch.commit();
            }

            await advanceRevisionStage({
                db,
                bookId,
                revisionId,
                expectedFence: fenceToken,
                fromStage: REVISION_STAGES.CANDIDATE_CHUNK,
                toStage: REVISION_STAGES.CANDIDATE_EMBED,
                updates: {
                    totalChunks: chunks.length
                }
            });

            return { stage: REVISION_STAGES.CANDIDATE_EMBED, totalChunks: chunks.length };
        }

        if (stage === REVISION_STAGES.CANDIDATE_EMBED) {
            await advanceRevisionStage({
                db,
                bookId,
                revisionId,
                expectedFence: fenceToken,
                fromStage: REVISION_STAGES.CANDIDATE_EMBED,
                toStage: REVISION_STAGES.CANDIDATE_SUMMARIZE
            });

            return { stage: REVISION_STAGES.CANDIDATE_SUMMARIZE, embedded: true };
        }

        if (stage === REVISION_STAGES.CANDIDATE_SUMMARIZE) {
            const { groupChunksIntoSections, summarizeSection, reduceSummary } = require('./book-summary-service');
            const chunksSnap = await db.collection(CRM_BOOKS).doc(bookId)
                .collection(TEXT_REVISIONS).doc(revisionId)
                .collection('chunks').orderBy('index').get();
            const chunks = chunksSnap.docs.map(d => d.data());

            if (chunks.length > 0) {
                const sections = groupChunksIntoSections(chunks);
                for (let i = 0; i < sections.length; i++) {
                    await summarizeSection(db, bookId, i, sections[i].chunks, sections.length, { textRevisionId: revisionId });
                }
                await reduceSummary(db, bookId, { textRevisionId: revisionId });
            }

            await advanceRevisionStage({
                db,
                bookId,
                revisionId,
                expectedFence: fenceToken,
                fromStage: REVISION_STAGES.CANDIDATE_SUMMARIZE,
                toStage: REVISION_STAGES.CANDIDATE_VERIFY
            });

            return { stage: REVISION_STAGES.CANDIDATE_VERIFY, summarized: true };
        }

        if (stage === REVISION_STAGES.CANDIDATE_VERIFY) {
            const manifestData = `${revisionId}:${leased.totalPages || 0}:${leased.pagesHash || ''}:${leased.textQuality?.score || 0}`;
            const manifestHash = crypto.createHash('sha256').update(manifestData).digest('hex');

            await advanceRevisionStage({
                db,
                bookId,
                revisionId,
                expectedFence: fenceToken,
                fromStage: REVISION_STAGES.CANDIDATE_VERIFY,
                toStage: REVISION_STAGES.READY_FOR_ACTIVATION,
                updates: {
                    manifestHash,
                    verifiedAt: new Date().toISOString()
                }
            });

            return { stage: REVISION_STAGES.READY_FOR_ACTIVATION, status: 'ready', manifestHash };
        }

        return { stage, status: 'noop' };
    } catch (error) {
        await recordRevisionFailure({
            db,
            bookId,
            revisionId,
            expectedFence: fenceToken,
            errorMessage: error.message,
            errorCode: error.code || 'REVISION_PROCESSING_ERROR',
            isPermanent: error.code === 'SOURCE_GENERATION_MISMATCH' || error.code === 'OCR_PAGE_COUNT_MISMATCH'
        });
        throw error;
    }
}

async function activateRevision({
    db,
    bookId,
    revisionId,
    expectedCurrentRevisionId,
    expectedSourceSha256,
    manifestHash,
    activatedBy = 'admin'
}) {
    const bookRef = db.collection(CRM_BOOKS).doc(bookId);
    const revRef = bookRef.collection(TEXT_REVISIONS).doc(revisionId);

    return db.runTransaction(async (txn) => {
        const [bookSnap, revSnap] = await Promise.all([
            txn.get(bookRef),
            txn.get(revRef)
        ]);

        if (!bookSnap.exists) {
            throw Object.assign(new Error(`Book ${bookId} not found`), { code: 'BOOK_NOT_FOUND' });
        }
        if (!revSnap.exists) {
            throw Object.assign(new Error(`Revision ${revisionId} not found`), { code: 'REVISION_NOT_FOUND' });
        }

        const bookData = bookSnap.data();
        const revData = revSnap.data();

        if (expectedSourceSha256 && bookData.source?.sha256 && bookData.source.sha256 !== expectedSourceSha256) {
            throw Object.assign(new Error('Source SHA mismatch'), { code: 'SOURCE_SHA_MISMATCH' });
        }

        const currentActive = bookData.activeTextRevisionId || null;
        if (expectedCurrentRevisionId !== undefined && expectedCurrentRevisionId !== currentActive) {
            throw Object.assign(
                new Error(`Active revision mismatch: expected ${expectedCurrentRevisionId}, currently ${currentActive}`),
                { code: 'ACTIVE_REVISION_MISMATCH', currentActiveRevisionId: currentActive }
            );
        }

        if (revData.status !== 'ready' && revData.stage !== REVISION_STAGES.READY_FOR_ACTIVATION) {
            throw Object.assign(
                new Error(`Revision ${revisionId} is in stage ${revData.stage} (status ${revData.status}) and cannot be activated`),
                { code: 'REVISION_NOT_READY' }
            );
        }

        if (manifestHash && revData.manifest?.hash && revData.manifest.hash !== manifestHash) {
            throw Object.assign(
                new Error('Verification manifest hash mismatch'),
                { code: 'MANIFEST_HASH_MISMATCH' }
            );
        }

        const nowIso = new Date().toISOString();

        txn.update(bookRef, {
            activeTextRevisionId: revisionId,
            previousActiveTextRevisionId: currentActive,
            textRevisionActivatedAt: nowIso,
            updatedAt: nowIso
        });

        txn.update(revRef, {
            status: 'activated',
            stage: REVISION_STAGES.ACTIVATED,
            activatedAt: nowIso,
            activatedBy,
            updatedAt: nowIso
        });

        if (currentActive && currentActive !== revisionId) {
            const prevRef = bookRef.collection(TEXT_REVISIONS).doc(currentActive);
            txn.update(prevRef, {
                status: 'superseded',
                supersededAt: nowIso,
                updatedAt: nowIso
            });
        }

        return {
            bookId,
            activeTextRevisionId: revisionId,
            previousActiveTextRevisionId: currentActive,
            activatedAt: nowIso,
            activatedBy
        };
    });
}

async function rollbackRevision({
    db,
    bookId,
    targetRevisionId,
    expectedCurrentRevisionId,
    rollbackBy = 'admin',
    reason = 'Rollback to prior text revision'
}) {
    const bookRef = db.collection(CRM_BOOKS).doc(bookId);
    const targetRevRef = bookRef.collection(TEXT_REVISIONS).doc(targetRevisionId);

    return db.runTransaction(async (txn) => {
        const [bookSnap, targetRevSnap] = await Promise.all([
            txn.get(bookRef),
            txn.get(targetRevRef)
        ]);

        if (!bookSnap.exists) {
            throw Object.assign(new Error(`Book ${bookId} not found`), { code: 'BOOK_NOT_FOUND' });
        }
        if (!targetRevSnap.exists) {
            throw Object.assign(new Error(`Target rollback revision ${targetRevisionId} not found`), { code: 'REVISION_NOT_FOUND' });
        }

        const bookData = bookSnap.data();
        const currentActive = bookData.activeTextRevisionId || null;

        if (expectedCurrentRevisionId !== undefined && expectedCurrentRevisionId !== currentActive) {
            throw Object.assign(
                new Error(`Current active revision mismatch: expected ${expectedCurrentRevisionId}, currently ${currentActive}`),
                { code: 'ACTIVE_REVISION_MISMATCH', currentActiveRevisionId: currentActive }
            );
        }

        const nowIso = new Date().toISOString();

        txn.update(bookRef, {
            activeTextRevisionId: targetRevisionId,
            previousActiveTextRevisionId: currentActive,
            textRevisionRolledBackAt: nowIso,
            updatedAt: nowIso
        });

        txn.update(targetRevRef, {
            status: 'activated',
            stage: REVISION_STAGES.ACTIVATED,
            restoredAt: nowIso,
            restoredBy: rollbackBy,
            rollbackReason: reason,
            updatedAt: nowIso
        });

        if (currentActive && currentActive !== targetRevisionId) {
            const currentRevRef = bookRef.collection(TEXT_REVISIONS).doc(currentActive);
            txn.update(currentRevRef, {
                status: 'rolled_back',
                rolledBackAt: nowIso,
                updatedAt: nowIso
            });
        }

        return {
            bookId,
            activeTextRevisionId: targetRevisionId,
            previousActiveTextRevisionId: currentActive,
            rolledBackAt: nowIso,
            rollbackBy,
            reason
        };
    });
}

async function listBookRevisions({ db, bookId }) {
    const bookSnap = await db.collection(CRM_BOOKS).doc(bookId).get();
    if (!bookSnap.exists) {
        throw Object.assign(new Error(`Book ${bookId} not found`), { code: 'BOOK_NOT_FOUND' });
    }
    const bookData = bookSnap.data();
    const revsSnap = await db.collection(CRM_BOOKS).doc(bookId).collection(TEXT_REVISIONS).get();
    const revisions = (revsSnap.docs || []).map((d) => d.data());
    revisions.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    return {
        bookId,
        activeTextRevisionId: bookData.activeTextRevisionId || null,
        revisions
    };
}

module.exports = {
    CRM_BOOKS,
    TEXT_REVISIONS,
    REVISION_STAGES,
    LIMITS,
    generateRevisionId,
    createCandidateRevision,
    acquireRevisionLease,
    advanceRevisionStage,
    recordRevisionFailure,
    processRevisionStep,
    activateRevision,
    rollbackRevision,
    listBookRevisions
};
