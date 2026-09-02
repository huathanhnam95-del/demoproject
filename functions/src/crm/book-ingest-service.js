/* eslint-disable no-console */
const { FieldValue } = require('firebase-admin/firestore');
const { CRM_BOOKS, CRM_BOOK_INGEST_JOBS, CRM_RECYCLE_BIN } = require('./collections');
const { extractPdfPages } = require('./book-pdf-extractor');
const { chunkPages } = require('./book-chunker');
const { embedTexts, getConfig: getEmbedConfig } = require('./book-embeddings');
const { groupChunksIntoSections, summarizeSection, reduceSummary } = require('./book-summary-service');
const { runBookTextRevisionQueue } = require('./book-text-revision-service');

const LEASE_DURATION_MS = 9 * 60 * 1000;
const SOFT_DEADLINE_MS = 7 * 60 * 1000;
const MAX_RETRIES = 5;
const CHUNK_BATCH_SIZE = 400;
const EMBED_ITERATION_SIZE = 64;
const ABANDONED_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;

function log(action, payload) {
    try {
        console.log('[book-ingest]', JSON.stringify({ action, at: new Date().toISOString(), ...payload }));
    } catch (_) {
        console.log('[book-ingest]', action, payload);
    }
}

function asDate(value) {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof value?.toDate === 'function') return value.toDate();
    if (typeof value === 'string') {
        const ms = Date.parse(value);
        return Number.isFinite(ms) ? new Date(ms) : null;
    }
    return null;
}

async function claimJob(db, now) {
    const jobs = db.collection(CRM_BOOK_INGEST_JOBS);

    const pendingSnap = await jobs.where('status', '==', 'pending').limit(1).get();
    if (!pendingSnap.empty) {
        const doc = pendingSnap.docs[0];
        return tryClaimDoc(db, doc, now);
    }

    const staleSnap = await jobs.where('status', '==', 'claimed').get();
    for (const doc of staleSnap.docs) {
        const data = doc.data();
        const expires = asDate(data.leaseExpiresAt);
        if (expires && expires < now) {
            const retryCount = (data.retryCount || 0) + 1;
            if (retryCount > MAX_RETRIES) {
                await failJob(db, doc.id, `Exceeded ${MAX_RETRIES} retries`, now);
                continue;
            }
            log('reclaim-stale-lease', { bookId: doc.id, retryCount });
            return tryClaimDoc(db, doc, now, retryCount);
        }
    }

    return null;
}

async function tryClaimDoc(db, doc, now, retryCount) {
    const workerId = `worker-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const leaseExpiresAt = new Date(now.getTime() + LEASE_DURATION_MS);
    const jobRef = db.collection(CRM_BOOK_INGEST_JOBS).doc(doc.id);

    const result = await db.runTransaction(async (txn) => {
        const fresh = await txn.get(jobRef);
        if (!fresh.exists) return null;
        const data = fresh.data();

        if (data.status !== 'pending') {
            if (data.status !== 'claimed') return null;
            const expires = asDate(data.leaseExpiresAt);
            if (!expires || expires >= now) return null;
        }

        const update = {
            status: 'claimed',
            workerId,
            claimedAt: now,
            leaseExpiresAt,
            error: null
        };
        if (typeof retryCount === 'number') {
            update.retryCount = retryCount;
        }
        txn.update(jobRef, update);
        return { bookId: doc.id, ...data, ...update };
    });

    return result;
}

async function failJob(db, bookId, errorMessage, now) {
    const jobRef = db.collection(CRM_BOOK_INGEST_JOBS).doc(bookId);
    const bookRef = db.collection(CRM_BOOKS).doc(bookId);

    await db.runTransaction(async (txn) => {
        txn.update(jobRef, {
            status: 'failed',
            error: errorMessage,
            completedAt: now
        });
        txn.update(bookRef, {
            status: 'failed',
            'ingest.error': errorMessage,
            'ingest.finishedAt': now,
            updatedAt: FieldValue.serverTimestamp()
        });
    });

    log('job-failed', { bookId, error: errorMessage });
}

async function updateProgress(db, bookId, stage, fields) {
    const bookRef = db.collection(CRM_BOOKS).doc(bookId);
    const update = { 'ingest.stage': stage, updatedAt: FieldValue.serverTimestamp() };
    for (const [key, value] of Object.entries(fields)) {
        update[`ingest.${key}`] = value;
    }
    await bookRef.update(update);
}

async function runExtractStage(db, job, deps) {
    const { bookId } = job;
    log('extract-start', { bookId });

    await updateProgress(db, bookId, 'extract', { percent: 0 });

    const bookSnap = await db.collection(CRM_BOOKS).doc(bookId).get();
    const storagePath = bookSnap.data()?.source?.storagePath;
    if (!storagePath) throw new Error('No storage path on book document');

    const bucket = await deps.getStorageBucket();
    const [fileBuffer] = await bucket.file(storagePath).download();

    const result = await extractPdfPages(fileBuffer);

    if (result.isScanned) {
        throw Object.assign(new Error('PDF contains scanned images with no selectable text'), {
            code: 'SCANNED_PDF_NO_TEXT'
        });
    }

    if (result.totalPages === 0) {
        throw Object.assign(new Error('PDF has no pages'), { code: 'PDF_PARSE_FAILED' });
    }

    const pagesJson = JSON.stringify({
        totalPages: result.totalPages,
        pages: result.pages
    });
    const pagesPath = `crm-books/${bookId}/pages.json`;
    await bucket.file(pagesPath).save(Buffer.from(pagesJson), {
        contentType: 'application/json',
        resumable: false
    });

    await db.collection(CRM_BOOKS).doc(bookId).update({
        pageCount: result.totalPages,
        'source.uploadedAt': FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
    });

    await updateProgress(db, bookId, 'extract', {
        percent: 10,
        totalPages: result.totalPages
    });

    log('extract-done', { bookId, totalPages: result.totalPages, avgCharsPerPage: result.avgCharsPerPage });
    return result;
}

async function runChunkStage(db, job, extractResult, deps) {
    const { bookId } = job;
    log('chunk-start', { bookId });

    await updateProgress(db, bookId, 'chunk', { percent: 10 });

    let pages;
    if (extractResult) {
        pages = extractResult.pages;
    } else {
        const bucket = await deps.getStorageBucket();
        const pagesPath = `crm-books/${bookId}/pages.json`;
        const [pagesBuffer] = await bucket.file(pagesPath).download();
        const parsed = JSON.parse(pagesBuffer.toString('utf8'));
        pages = parsed.pages;
    }

    const { chunks } = chunkPages(pages);

    const chunksCol = db.collection(CRM_BOOKS).doc(bookId).collection('chunks');
    for (let batchStart = 0; batchStart < chunks.length; batchStart += CHUNK_BATCH_SIZE) {
        const batchEnd = Math.min(batchStart + CHUNK_BATCH_SIZE, chunks.length);
        const batch = db.batch();
        for (let i = batchStart; i < batchEnd; i++) {
            const chunk = chunks[i];
            const chunkId = `c${String(chunk.index).padStart(6, '0')}`;
            batch.set(chunksCol.doc(chunkId), {
                index: chunk.index,
                text: chunk.text,
                charCount: chunk.charCount,
                pageStart: chunk.pageStart,
                pageEnd: chunk.pageEnd,
                sectionIndex: null,
                embedding: null,
                embeddingModel: null
            });
        }
        await batch.commit();
    }

    const jobRef = db.collection(CRM_BOOK_INGEST_JOBS).doc(bookId);
    await jobRef.update({
        totalChunks: chunks.length,
        stage: 'chunk_done'
    });

    await updateProgress(db, bookId, 'chunk_done', {
        percent: 15,
        totalChunks: chunks.length
    });

    log('chunk-done', { bookId, totalChunks: chunks.length });
    return chunks.length;
}

async function runEmbedStage(db, job, startTime) {
    const { bookId } = job;
    const cursor = job.cursor || { chunkIndex: 0 };
    let chunkIndex = cursor.chunkIndex || 0;
    const jobRef = db.collection(CRM_BOOK_INGEST_JOBS).doc(bookId);
    const chunksCol = db.collection(CRM_BOOKS).doc(bookId).collection('chunks');

    const bookSnap = await db.collection(CRM_BOOKS).doc(bookId).get();
    const bookData = bookSnap.data() || {};
    const bookTitle = bookData.title || '';
    const embedCfg = getEmbedConfig();

    const countSnap = await chunksCol.count().get();
    const totalChunks = countSnap.data().count || 0;

    if (totalChunks === 0) {
        throw Object.assign(new Error('No chunks found for embedding'), { code: 'INGEST_ERROR' });
    }

    if (!bookData.embedding || !bookData.embedding.model) {
        await db.collection(CRM_BOOKS).doc(bookId).update({
            'embedding.model': embedCfg.model,
            'embedding.dimensions': embedCfg.dimensions,
            'embedding.taskType': 'RETRIEVAL_DOCUMENT'
        });
    }

    log('embed-start', { bookId, startAt: chunkIndex, totalChunks });

    await updateProgress(db, bookId, 'embed', {
        totalChunks,
        embeddedChunks: chunkIndex
    });

    let embedded = chunkIndex;

    while (embedded < totalChunks) {
        if (Date.now() - startTime > SOFT_DEADLINE_MS) {
            await jobRef.update({
                'cursor.chunkIndex': embedded,
                stage: 'embed'
            });
            log('embed-yielding', { bookId, embedded, totalChunks, elapsed: Date.now() - startTime });
            return { complete: false, embedded };
        }

        const batchSize = Math.min(EMBED_ITERATION_SIZE, totalChunks - embedded);
        const snap = await chunksCol
            .orderBy('index')
            .startAt(embedded)
            .limit(batchSize)
            .get();

        if (snap.empty) {
            embedded = totalChunks;
            break;
        }

        const docs = snap.docs;
        const texts = docs.map((d) => d.data().text);

        let vectors;
        try {
            vectors = await embedTexts(texts, { taskType: 'RETRIEVAL_DOCUMENT', title: bookTitle, db });
        } catch (err) {
            const msg = String(err?.message || '');
            if (msg.includes('quota') || msg.includes('429')) {
                throw Object.assign(new Error('Embedding quota exceeded'), { code: 'EMBED_QUOTA' });
            }
            if (msg.includes('unavailable') || msg.includes('503')) {
                throw Object.assign(new Error('AI service unavailable'), { code: 'AI_UNAVAILABLE' });
            }
            throw err;
        }

        const writeBatch = db.batch();
        for (let i = 0; i < docs.length; i++) {
            writeBatch.update(docs[i].ref, {
                embedding: FieldValue.vector(vectors[i]),
                embeddingModel: embedCfg.model
            });
        }
        await writeBatch.commit();

        embedded += docs.length;

        await jobRef.update({ 'cursor.chunkIndex': embedded });
        await updateProgress(db, bookId, 'embed', {
            embeddedChunks: embedded,
            totalChunks
        });

        log('embed-progress', { bookId, embedded, totalChunks });
    }

    log('embed-done', { bookId, totalChunks, elapsed: Date.now() - startTime });
    return { complete: true, embedded };
}

async function runSummarizeStage(db, job, startTime) {
    const { bookId } = job;
    const cursor = job.cursor || { sectionIndex: 0 };
    let sectionIndex = cursor.sectionIndex || 0;
    const jobRef = db.collection(CRM_BOOK_INGEST_JOBS).doc(bookId);
    const chunksCol = db.collection(CRM_BOOKS).doc(bookId).collection('chunks');

    log('summarize-start', { bookId, startAt: sectionIndex });

    const chunkSnap = await chunksCol.orderBy('index').get();
    const allChunks = chunkSnap.docs.map((d) => {
        const data = d.data();
        return { index: data.index, text: data.text, charCount: data.charCount, pageStart: data.pageStart, pageEnd: data.pageEnd };
    });
    const sections = groupChunksIntoSections(allChunks);
    const totalSections = sections.length;

    await updateProgress(db, bookId, 'summarize', { percent: 75 });

    while (sectionIndex < totalSections) {
        if (Date.now() - startTime > SOFT_DEADLINE_MS) {
            await jobRef.update({ 'cursor.sectionIndex': sectionIndex, stage: 'summarize' });
            log('summarize-yielding', { bookId, sectionIndex, totalSections, elapsed: Date.now() - startTime });
            return { complete: false };
        }

        const section = sections[sectionIndex];
        await summarizeSection(db, bookId, sectionIndex, section.chunks, totalSections);

        sectionIndex++;

        const mapPercent = 75 + Math.round((sectionIndex / totalSections) * 20);
        await updateProgress(db, bookId, 'summarize', { percent: mapPercent });
        await jobRef.update({ 'cursor.sectionIndex': sectionIndex });

        log('summarize-section', { bookId, sectionIndex, totalSections });
    }

    log('summarize-reduce', { bookId });
    await reduceSummary(db, bookId);

    await updateProgress(db, bookId, 'summarize', { percent: 100 });
    log('summarize-done', { bookId, totalSections, elapsed: Date.now() - startTime });
    return { complete: true };
}

async function sweepAbandonedUploads(db, now) {
    const cutoff = new Date(now.getTime() - ABANDONED_UPLOAD_TTL_MS);
    const snap = await db.collection(CRM_BOOKS)
        .where('status', '==', 'awaiting_upload')
        .get();

    let swept = 0;
    for (const doc of snap.docs) {
        const data = doc.data();
        const created = asDate(data.createdAt);
        if (!created || created >= cutoff) continue;

        const recycleBinRef = db.collection(CRM_RECYCLE_BIN).doc();
        await recycleBinRef.set({
            originalCollection: CRM_BOOKS,
            originalId: doc.id,
            data,
            deletedAt: FieldValue.serverTimestamp(),
            deletedByUid: 'system',
            expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
            reason: 'abandoned_upload'
        });
        await doc.ref.delete();
        swept++;
        log('sweep-abandoned', { bookId: doc.id });
    }

    return swept;
}

async function runBookIngestQueue(db, deps) {
    const now = deps.now || new Date();

    const sweptCount = await sweepAbandonedUploads(db, now);
    if (sweptCount > 0) {
        log('sweep-complete', { count: sweptCount });
    }

    const job = await claimJob(db, now);
    if (!job) {
        log('no-jobs', {});
        return;
    }

    const { bookId } = job;
    const startTime = Date.now();
    log('job-claimed', { bookId, stage: job.stage, workerId: job.workerId });

    await db.collection(CRM_BOOKS).doc(bookId).update({
        status: 'processing',
        updatedAt: FieldValue.serverTimestamp()
    });

    try {
        const stage = job.stage || 'extract';
        let extractResult = null;

        if (stage === 'extract') {
            extractResult = await runExtractStage(db, job, deps);

            if (Date.now() - startTime > SOFT_DEADLINE_MS) {
                await releaseForResume(db, bookId, 'chunk');
                log('yielding', { bookId, nextStage: 'chunk', elapsed: Date.now() - startTime });
                return;
            }

            await runChunkStage(db, job, extractResult, deps);

            if (Date.now() - startTime > SOFT_DEADLINE_MS) {
                await releaseForResume(db, bookId, 'embed');
                log('yielding', { bookId, nextStage: 'embed', elapsed: Date.now() - startTime });
                return;
            }

            const embedResult = await runEmbedStage(db, job, startTime);
            if (!embedResult.complete) {
                await releaseForResume(db, bookId, 'embed');
                return;
            }

            if (Date.now() - startTime > SOFT_DEADLINE_MS) {
                await releaseForResume(db, bookId, 'summarize');
                return;
            }

            const sumResult = await runSummarizeStage(db, job, startTime);
            if (!sumResult.complete) {
                await releaseForResume(db, bookId, 'summarize');
                return;
            }
        } else if (stage === 'chunk' || stage === 'chunk_resume') {
            await runChunkStage(db, job, null, deps);

            if (Date.now() - startTime > SOFT_DEADLINE_MS) {
                await releaseForResume(db, bookId, 'embed');
                return;
            }

            const embedResult = await runEmbedStage(db, job, startTime);
            if (!embedResult.complete) {
                await releaseForResume(db, bookId, 'embed');
                return;
            }

            if (Date.now() - startTime > SOFT_DEADLINE_MS) {
                await releaseForResume(db, bookId, 'summarize');
                return;
            }

            const sumResult = await runSummarizeStage(db, job, startTime);
            if (!sumResult.complete) {
                await releaseForResume(db, bookId, 'summarize');
                return;
            }
        } else if (stage === 'chunk_done' || stage === 'embed') {
            const embedResult = await runEmbedStage(db, job, startTime);
            if (!embedResult.complete) {
                await releaseForResume(db, bookId, 'embed');
                return;
            }

            if (Date.now() - startTime > SOFT_DEADLINE_MS) {
                await releaseForResume(db, bookId, 'summarize');
                return;
            }

            const sumResult = await runSummarizeStage(db, job, startTime);
            if (!sumResult.complete) {
                await releaseForResume(db, bookId, 'summarize');
                return;
            }
        } else if (stage === 'summarize') {
            const sumResult = await runSummarizeStage(db, job, startTime);
            if (!sumResult.complete) {
                await releaseForResume(db, bookId, 'summarize');
                return;
            }
        }

        await completeJob(db, bookId, now);
        log('ingest-complete', { bookId, elapsed: Date.now() - startTime });

    } catch (error) {
        const errorCode = error.code || 'INGEST_ERROR';
        const errorMessage = `[${errorCode}] ${error.message || String(error)}`;
        await failJob(db, bookId, errorMessage, now);
    }
}

async function completeJob(db, bookId, now) {
    const jobRef = db.collection(CRM_BOOK_INGEST_JOBS).doc(bookId);
    const bookRef = db.collection(CRM_BOOKS).doc(bookId);

    await db.runTransaction(async (txn) => {
        txn.update(jobRef, {
            status: 'done',
            stage: 'complete',
            completedAt: now,
            workerId: null,
            claimedAt: null,
            leaseExpiresAt: null
        });
        txn.update(bookRef, {
            status: 'ready',
            'ingest.stage': 'complete',
            'ingest.percent': 100,
            'ingest.finishedAt': now,
            'ingest.error': null,
            updatedAt: FieldValue.serverTimestamp()
        });
    });

    log('job-complete', { bookId });
}

async function releaseForResume(db, bookId, nextStage) {
    const jobRef = db.collection(CRM_BOOK_INGEST_JOBS).doc(bookId);
    await jobRef.update({
        status: 'pending',
        stage: nextStage,
        workerId: null,
        claimedAt: null,
        leaseExpiresAt: null
    });
}

module.exports = {
    runBookIngestQueue,
    runBookTextRevisionQueue,
    sweepAbandonedUploads,
    claimJob,
    failJob,
    LEASE_DURATION_MS,
    SOFT_DEADLINE_MS,
    MAX_RETRIES,
    CHUNK_BATCH_SIZE,
    EMBED_ITERATION_SIZE,
    ABANDONED_UPLOAD_TTL_MS
};
