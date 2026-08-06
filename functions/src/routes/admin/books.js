const crypto = require('crypto');
const {
    CRM_BOOKS,
    CRM_BOOK_INGEST_JOBS,
    CRM_RECYCLE_BIN
} = require('../../crm/collections');
const { handleChatMessage } = require('../../crm/book-chat-service');

function cleanStr(value, fallback = '') {
    return String(value ?? '').trim() || fallback;
}

function mapBookRecord(doc, docId) {
    const d = doc.data ? doc.data() : doc;
    const id = docId || doc.id || '';
    return {
        bookId: id,
        title: d.title || '',
        author: d.author || '',
        description: d.description || '',
        pageCount: d.pageCount ?? null,
        sizeBytes: d.sizeBytes ?? null,
        sha256: d.sha256 || null,
        status: d.status || 'awaiting_upload',
        ingest: d.ingest || null,
        embedding: d.embedding || null,
        chunkingVersion: d.chunkingVersion ?? 0,
        summaryVersion: d.summaryVersion ?? 0,
        source: d.source || null,
        createdAt: d.createdAt?.toDate?.() ?? d.createdAt ?? null,
        updatedAt: d.updatedAt?.toDate?.() ?? d.updatedAt ?? null,
        createdByUid: d.createdByUid || null
    };
}

module.exports = function registerBookRoutes(router, deps) {
    const { db, sendSuccess, sendError, requireAdminHandlers, serverTimestamp, writeAuditLog } = deps;

    const getStorageBucket = typeof deps.getStorageBucket === 'function'
        ? deps.getStorageBucket
        : null;

    router.get('/books', ...requireAdminHandlers, async (req, res) => {
        try {
            const snap = await db.collection(CRM_BOOKS)
                .orderBy('createdAt', 'desc')
                .limit(200)
                .get();

            const books = snap.docs.map((doc) => mapBookRecord(doc, doc.id));
            return sendSuccess(res, { books, count: books.length });
        } catch (error) {
            return sendError(res, 500, 'LIST_BOOKS_ERROR', 'Failed to list books.', error?.message || error);
        }
    });

    router.get('/books/:bookId', ...requireAdminHandlers, async (req, res) => {
        try {
            const bookId = cleanStr(req.params.bookId);
            if (!bookId) {
                return sendError(res, 400, 'INVALID_BOOK_ID', 'Missing book ID.');
            }

            const bookSnap = await db.collection(CRM_BOOKS).doc(bookId).get();
            if (!bookSnap.exists) {
                return sendError(res, 404, 'BOOK_NOT_FOUND', 'Book not found.');
            }

            const book = mapBookRecord(bookSnap, bookId);

            let summary = null;
            try {
                const summarySnap = await db.collection(CRM_BOOKS).doc(bookId)
                    .collection('artifacts').doc('summary').get();
                if (summarySnap.exists) {
                    summary = summarySnap.data() || null;
                }
            } catch (_) { /* summary not yet generated */ }

            return sendSuccess(res, { book, summary });
        } catch (error) {
            return sendError(res, 500, 'GET_BOOK_ERROR', 'Failed to retrieve book.', error?.message || error);
        }
    });

    router.post('/books', ...requireAdminHandlers, async (req, res) => {
        try {
            const title = cleanStr(req.body?.title);
            const author = cleanStr(req.body?.author);
            const description = cleanStr(req.body?.description);
            const sha256 = cleanStr(req.body?.sha256);

            if (!title) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Title is required.');
            }

            if (sha256) {
                const existingSnap = await db.collection(CRM_BOOKS)
                    .where('sha256', '==', sha256)
                    .get();

                const activeDoc = existingSnap.docs.find((d) => (d.data()?.status || '') !== 'deleted');
                if (activeDoc) {
                    const existingBook = mapBookRecord(activeDoc, activeDoc.id);
                    return sendError(res, 409, 'DUPLICATE_BOOK',
                        `A book with this file already exists: "${existingBook.title}".`,
                        { existingBookId: existingBook.bookId });
                }
            }

            const ref = db.collection(CRM_BOOKS).doc();
            const bookId = ref.id;
            const storagePath = `crm-books/${bookId}/source.pdf`;

            const payload = {
                title,
                author,
                description,
                pageCount: null,
                sizeBytes: null,
                sha256: sha256 || null,
                status: 'awaiting_upload',
                ingest: null,
                embedding: null,
                chunkingVersion: 0,
                summaryVersion: 0,
                source: {
                    storagePath,
                    originalFilename: cleanStr(req.body?.originalFilename) || null,
                    uploadedAt: null
                },
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
                createdByUid: req.user?.uid || null
            };

            await ref.set(payload);

            await writeAuditLog?.({
                action: 'book.create',
                entityType: 'book',
                entityId: bookId,
                metadata: { title }
            }, { user: req.user });

            return sendSuccess(res, {
                book: { bookId, ...payload, storagePath }
            }, 'Book created. Upload the PDF to the returned storagePath.');
        } catch (error) {
            return sendError(res, 500, 'CREATE_BOOK_ERROR', 'Failed to create book.', error?.message || error);
        }
    });

    router.post('/books/:bookId/ingest', ...requireAdminHandlers, async (req, res) => {
        try {
            const bookId = cleanStr(req.params.bookId);
            if (!bookId) {
                return sendError(res, 400, 'INVALID_BOOK_ID', 'Missing book ID.');
            }

            const bookRef = db.collection(CRM_BOOKS).doc(bookId);
            const jobRef = db.collection(CRM_BOOK_INGEST_JOBS).doc(bookId);

            const result = await db.runTransaction(async (txn) => {
                const bookSnap = await txn.get(bookRef);
                if (!bookSnap.exists) {
                    return { error: { status: 404, code: 'BOOK_NOT_FOUND', message: 'Book not found.' } };
                }

                const bookData = bookSnap.data() || {};
                const status = bookData.status;

                if (status === 'ready') {
                    return { error: { status: 400, code: 'ALREADY_READY', message: 'Book is already processed.' } };
                }

                if (status === 'awaiting_upload') {
                    if (!getStorageBucket) {
                        return { error: { status: 500, code: 'NO_STORAGE', message: 'Storage not available.' } };
                    }
                    const storagePath = bookData.source?.storagePath;
                    if (!storagePath) {
                        return { error: { status: 400, code: 'NO_STORAGE_PATH', message: 'No storage path configured.' } };
                    }
                    const bucket = getStorageBucket();
                    const [exists] = await bucket.file(storagePath).exists();
                    if (!exists) {
                        return { error: { status: 400, code: 'FILE_NOT_UPLOADED', message: 'PDF file has not been uploaded yet.' } };
                    }
                }

                const jobSnap = await txn.get(jobRef);
                const existingJob = jobSnap.exists ? jobSnap.data() : null;

                if (existingJob && (existingJob.status === 'pending' || existingJob.status === 'claimed')) {
                    return { alreadyQueued: true, jobStatus: existingJob.status };
                }

                const now = new Date();
                const runGeneration = (existingJob?.runGeneration || 0) + 1;

                const jobPayload = {
                    bookId,
                    status: 'pending',
                    stage: 'extract',
                    cursor: { chunkIndex: 0, sectionIndex: 0 },
                    totalChunks: 0,
                    totalPages: 0,
                    claimedAt: null,
                    leaseExpiresAt: null,
                    workerId: null,
                    runGeneration,
                    retryCount: 0,
                    resetCount: existingJob ? (existingJob.resetCount || 0) + 1 : 0,
                    error: null,
                    submittedAt: now,
                    completedAt: null
                };

                txn.set(jobRef, jobPayload);

                txn.update(bookRef, {
                    status: 'queued',
                    ingest: {
                        stage: 'extract',
                        percent: 0,
                        totalPages: 0,
                        totalChunks: 0,
                        embeddedChunks: 0,
                        startedAt: now,
                        finishedAt: null,
                        error: null
                    },
                    updatedAt: serverTimestamp()
                });

                return { queued: true, runGeneration };
            });

            if (result.error) {
                return sendError(res, result.error.status, result.error.code, result.error.message);
            }

            if (result.alreadyQueued) {
                return sendSuccess(res, { bookId, status: result.jobStatus }, 'Ingestion already in progress.');
            }

            await writeAuditLog?.({
                action: 'book.ingest_queued',
                entityType: 'book',
                entityId: bookId,
                metadata: { runGeneration: result.runGeneration }
            }, { user: req.user });

            return sendSuccess(res, { bookId, status: 'queued' }, 'Book queued for ingestion.');
        } catch (error) {
            return sendError(res, 500, 'INGEST_ERROR', 'Failed to queue book for ingestion.', error?.message || error);
        }
    });

    router.delete('/books/:bookId', ...requireAdminHandlers, async (req, res) => {
        try {
            const bookId = cleanStr(req.params.bookId);
            if (!bookId) {
                return sendError(res, 400, 'INVALID_BOOK_ID', 'Missing book ID.');
            }

            const bookRef = db.collection(CRM_BOOKS).doc(bookId);
            const bookSnap = await bookRef.get();
            if (!bookSnap.exists) {
                return sendError(res, 404, 'BOOK_NOT_FOUND', 'Book not found.');
            }

            const bookData = bookSnap.data() || {};

            const recycleBinRef = db.collection(CRM_RECYCLE_BIN).doc();
            await recycleBinRef.set({
                originalCollection: CRM_BOOKS,
                originalId: bookId,
                data: bookData,
                deletedAt: serverTimestamp(),
                deletedByUid: req.user?.uid || null,
                expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
            });

            await bookRef.delete();

            const jobRef = db.collection(CRM_BOOK_INGEST_JOBS).doc(bookId);
            const jobSnap = await jobRef.get();
            if (jobSnap.exists) {
                await jobRef.delete();
            }

            if (getStorageBucket && bookData.source?.storagePath) {
                try {
                    const bucket = getStorageBucket();
                    const [files] = await bucket.getFiles({ prefix: `crm-books/${bookId}/` });
                    await Promise.all(files.map((f) => f.delete().catch(() => {})));
                } catch (_) { /* best-effort storage cleanup */ }
            }

            await writeAuditLog?.({
                action: 'book.delete',
                entityType: 'book',
                entityId: bookId,
                metadata: { title: bookData.title || '' }
            }, { user: req.user });

            return sendSuccess(res, { bookId }, 'Book deleted.');
        } catch (error) {
            return sendError(res, 500, 'DELETE_BOOK_ERROR', 'Failed to delete book.', error?.message || error);
        }
    });

    router.get('/books/:bookId/threads', ...requireAdminHandlers, async (req, res) => {
        try {
            const bookId = cleanStr(req.params.bookId);
            if (!bookId) {
                return sendError(res, 400, 'INVALID_BOOK_ID', 'Missing book ID.');
            }

            const bookSnap = await db.collection(CRM_BOOKS).doc(bookId).get();
            if (!bookSnap.exists) {
                return sendError(res, 404, 'BOOK_NOT_FOUND', 'Book not found.');
            }

            const snap = await db.collection(CRM_BOOKS).doc(bookId)
                .collection('threads')
                .orderBy('updatedAt', 'desc')
                .limit(50)
                .get();

            const threads = snap.docs.map((doc) => {
                const d = doc.data() || {};
                return {
                    threadId: doc.id,
                    title: d.title || 'New thread',
                    messageCount: d.messageCount || 0,
                    createdAt: d.createdAt?.toDate?.() ?? d.createdAt ?? null,
                    updatedAt: d.updatedAt?.toDate?.() ?? d.updatedAt ?? null,
                    createdByUid: d.createdByUid || null
                };
            });

            return sendSuccess(res, { threads, count: threads.length });
        } catch (error) {
            return sendError(res, 500, 'LIST_THREADS_ERROR', 'Failed to list threads.', error?.message || error);
        }
    });

    router.post('/books/:bookId/threads', ...requireAdminHandlers, async (req, res) => {
        try {
            const bookId = cleanStr(req.params.bookId);
            if (!bookId) {
                return sendError(res, 400, 'INVALID_BOOK_ID', 'Missing book ID.');
            }

            const bookSnap = await db.collection(CRM_BOOKS).doc(bookId).get();
            if (!bookSnap.exists) {
                return sendError(res, 404, 'BOOK_NOT_FOUND', 'Book not found.');
            }

            if ((bookSnap.data()?.status || '') !== 'ready') {
                return sendError(res, 400, 'BOOK_NOT_READY', 'Book must be fully processed before chat.');
            }

            const ref = db.collection(CRM_BOOKS).doc(bookId).collection('threads').doc();
            const payload = {
                title: cleanStr(req.body?.title) || 'New thread',
                messageCount: 0,
                rollingSummary: null,
                rollingSummaryThroughMessage: null,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
                createdByUid: req.user?.uid || null
            };
            await ref.set(payload);

            return sendSuccess(res, { threadId: ref.id, ...payload }, 'Thread created.');
        } catch (error) {
            return sendError(res, 500, 'CREATE_THREAD_ERROR', 'Failed to create thread.', error?.message || error);
        }
    });

    router.get('/books/:bookId/threads/:threadId/messages', ...requireAdminHandlers, async (req, res) => {
        try {
            const bookId = cleanStr(req.params.bookId);
            const threadId = cleanStr(req.params.threadId);
            if (!bookId || !threadId) {
                return sendError(res, 400, 'INVALID_PARAMS', 'Missing book or thread ID.');
            }

            const snap = await db.collection(CRM_BOOKS).doc(bookId)
                .collection('threads').doc(threadId)
                .collection('messages')
                .orderBy('createdAt', 'asc')
                .limit(200)
                .get();

            const messages = snap.docs.map((doc) => {
                const d = doc.data() || {};
                return {
                    messageId: doc.id,
                    role: d.role || 'user',
                    text: d.text || '',
                    citations: d.citations || [],
                    createdAt: d.createdAt?.toDate?.() ?? d.createdAt ?? null,
                    model: d.model || null,
                    latencyMs: d.latencyMs ?? null
                };
            });

            return sendSuccess(res, { messages, count: messages.length });
        } catch (error) {
            return sendError(res, 500, 'LIST_MESSAGES_ERROR', 'Failed to list messages.', error?.message || error);
        }
    });

    router.post('/books/:bookId/threads/:threadId/messages', ...requireAdminHandlers, async (req, res) => {
        try {
            const bookId = cleanStr(req.params.bookId);
            const threadId = cleanStr(req.params.threadId);
            const question = cleanStr(req.body?.text || req.body?.question);

            if (!bookId || !threadId) {
                return sendError(res, 400, 'INVALID_PARAMS', 'Missing book or thread ID.');
            }
            if (!question || question.length < 2) {
                return sendError(res, 400, 'INVALID_QUESTION', 'Question text is required.');
            }
            if (question.length > 2000) {
                return sendError(res, 400, 'QUESTION_TOO_LONG', 'Question must be under 2000 characters.');
            }

            const result = await handleChatMessage(db, {
                bookId,
                threadId,
                question,
                uid: req.user?.uid
            });

            return sendSuccess(res, {
                userMessage: result.userMessage,
                assistantMessage: result.assistantMessage,
                quota: result.quota
            });
        } catch (error) {
            const code = error?.code || '';
            if (code === 'not-found') {
                return sendError(res, 404, 'NOT_FOUND', error.message);
            }
            if (code === 'failed-precondition') {
                return sendError(res, 400, 'BOOK_NOT_READY', error.message);
            }
            if (code === 'resource-exhausted') {
                return sendError(res, 429, 'QUOTA_EXHAUSTED', error.message);
            }
            return sendError(res, 500, 'CHAT_ERROR', 'Failed to process chat message.', error?.message || error);
        }
    });

    router.delete('/books/:bookId/threads/:threadId', ...requireAdminHandlers, async (req, res) => {
        try {
            const bookId = cleanStr(req.params.bookId);
            const threadId = cleanStr(req.params.threadId);
            if (!bookId || !threadId) {
                return sendError(res, 400, 'INVALID_PARAMS', 'Missing book or thread ID.');
            }

            const threadRef = db.collection(CRM_BOOKS).doc(bookId)
                .collection('threads').doc(threadId);
            const threadSnap = await threadRef.get();
            if (!threadSnap.exists) {
                return sendError(res, 404, 'THREAD_NOT_FOUND', 'Thread not found.');
            }

            const msgSnap = await threadRef.collection('messages').limit(500).get();
            const batch = db.batch();
            msgSnap.docs.forEach((doc) => batch.delete(doc.ref));
            batch.delete(threadRef);
            await batch.commit();

            return sendSuccess(res, { threadId }, 'Thread deleted.');
        } catch (error) {
            return sendError(res, 500, 'DELETE_THREAD_ERROR', 'Failed to delete thread.', error?.message || error);
        }
    });
};
