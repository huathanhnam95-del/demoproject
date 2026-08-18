const crypto = require('crypto');
const {
    CRM_BOOKS,
    CRM_BOOK_INGEST_JOBS,
    CRM_RECYCLE_BIN,
    CRM_BOOK_LINKS,
    CRM_BOOK_COLLECTIONS,
    CRM_BOOK_SHARES
} = require('../../crm/collections');
const { handleChatMessage } = require('../../crm/book-chat-service');
const { getUsageSummary, approveOverage } = require('../../crm/book-usage-tracker');
const { generateChapterStudyNotes, generateBookMindMap, expandMindMapNode, compileResearch } = require('../../crm/book-summary-service');

const MAX_THREAD_TITLE_LENGTH = 120;
const SOURCE_DOWNLOAD_TTL_MS = 5 * 60 * 1000;



function cleanStr(value, fallback = '') {
    return String(value ?? '').trim() || fallback;
}

function sourceDownloadFilename(bookData) {
    const original = cleanStr(bookData?.source?.originalFilename);
    const fallbackTitle = cleanStr(bookData?.title, 'source');
    const raw = original || `${fallbackTitle}.pdf`;
    const safe = raw
        .replace(/[\\/:?%*|"<>\r\n]/g, '-')
        .replace(/\s+/g, ' ')
        .trim();
    return /\.pdf$/i.test(safe) ? safe : `${safe || 'source'}.pdf`;
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

    // ─── Usage (before :bookId wildcard) ───
    router.get('/books/usage', ...requireAdminHandlers, async (req, res) => {
        try {
            const summary = await getUsageSummary(db);
            return sendSuccess(res, summary);
        } catch (error) {
            return sendError(res, 500, 'USAGE_ERROR', 'Failed to load usage.', error?.message || error);
        }
    });

    router.post('/books/usage/approve', ...requireAdminHandlers, async (req, res) => {
        try {
            const confirm = cleanStr(req.body?.confirm);
            if (confirm !== 'approve') {
                return sendError(res, 400, 'INVALID_CONFIRM', 'You must send { confirm: "approve" }.');
            }
            const email = req.user?.email || req.user?.uid || 'unknown';
            await approveOverage(db, email);
            return sendSuccess(res, { success: true }, 'Budget approved and reset.');
        } catch (error) {
            return sendError(res, 500, 'APPROVE_ERROR', 'Failed to approve budget.', error?.message || error);
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

    router.get('/books/:bookId/sections', ...requireAdminHandlers, async (req, res) => {
        try {
            const bookId = cleanStr(req.params.bookId);
            if (!bookId) {
                return sendError(res, 400, 'INVALID_BOOK_ID', 'Missing book ID.');
            }

            const sectionsSnap = await db.collection(CRM_BOOKS).doc(bookId)
                .collection('sections')
                .orderBy('pageStart')
                .get();

            const sections = sectionsSnap.docs.map((d) => {
                const data = d.data();
                return {
                    title: data.title || '',
                    gist: data.gist || '',
                    keyPoints: Array.isArray(data.keyPoints) ? data.keyPoints : [],
                    topics: Array.isArray(data.topics) ? data.topics : [],
                    pageStart: data.pageStart ?? null,
                    pageEnd: data.pageEnd ?? null
                };
            });

            return sendSuccess(res, { sections });
        } catch (error) {
            return sendError(res, 500, 'GET_SECTIONS_ERROR', 'Failed to retrieve sections.', error?.message || error);
        }
    });

    router.get('/books/:bookId/sections/:sectionIndex/study-notes', ...requireAdminHandlers, async (req, res) => {
        try {
            const bookId = cleanStr(req.params.bookId);
            const sectionIndex = cleanStr(req.params.sectionIndex);
            if (!bookId || sectionIndex === '') {
                return sendError(res, 400, 'INVALID_PARAMS', 'Missing book or section index.');
            }

            const docSnap = await db.collection(CRM_BOOKS).doc(bookId)
                .collection('sections').doc(sectionIndex)
                .collection('artifacts').doc('study_notes').get();

            if (!docSnap.exists) {
                return sendSuccess(res, { studyNotes: null });
            }

            return sendSuccess(res, { studyNotes: docSnap.data() });
        } catch (error) {
            return sendError(res, 500, 'GET_STUDY_NOTES_ERROR', 'Failed to retrieve study notes.', error?.message || error);
        }
    });

    router.post('/books/:bookId/sections/:sectionIndex/study-notes', ...requireAdminHandlers, async (req, res) => {
        try {
            const bookId = cleanStr(req.params.bookId);
            const sectionIndex = cleanStr(req.params.sectionIndex);
            const force = req.body?.force === true;
            if (!bookId || sectionIndex === '') {
                return sendError(res, 400, 'INVALID_PARAMS', 'Missing book or section index.');
            }

            if (!force) {
                const existing = await db.collection(CRM_BOOKS).doc(bookId)
                    .collection('sections').doc(sectionIndex)
                    .collection('artifacts').doc('study_notes').get();
                if (existing.exists) {
                    return sendSuccess(res, { studyNotes: existing.data() }, 'Study notes already exist. Use force:true to regenerate.');
                }
            }

            const usage = await getUsageSummary(db);
            if (usage && usage.isOverBudget && !usage.overageApproved) {
                return sendError(res, 429, 'BUDGET_EXCEEDED', 'Monthly CRM Books budget exceeded. Admin approval required.');
            }

            const studyNotes = await generateChapterStudyNotes(db, bookId, sectionIndex);

            await writeAuditLog?.({
                action: 'book.section_study_notes_generated',
                entityType: 'book',
                entityId: bookId,
                metadata: { sectionIndex, title: studyNotes.title }
            }, { user: req.user });

            return sendSuccess(res, { studyNotes }, 'Study notes generated successfully.');
        } catch (error) {
            return sendError(res, 500, 'GENERATE_STUDY_NOTES_ERROR', 'Failed to generate study notes.', error?.message || error);
        }
    });

    router.post('/books/:bookId/mind-map', ...requireAdminHandlers, async (req, res) => {
        try {
            const bookId = cleanStr(req.params.bookId);
            const force = req.body?.force === true;
            const noteIds = Array.isArray(req.body?.noteIds) ? req.body.noteIds : null;
            if (!bookId) {
                return sendError(res, 400, 'INVALID_PARAMS', 'Missing book ID.');
            }

            const usage = await getUsageSummary(db);
            if (usage && usage.isOverBudget && !usage.overageApproved) {
                return sendError(res, 429, 'BUDGET_EXCEEDED', 'Monthly CRM Books budget exceeded. Admin approval required.');
            }

            const mindMap = await generateBookMindMap(db, bookId, force, noteIds);

            await writeAuditLog?.({
                action: 'book.mind_map_generated',
                entityType: 'book',
                entityId: bookId,
                metadata: { centralTopic: mindMap.centralTopic, noteCount: mindMap.noteCount }
            }, { user: req.user });

            return sendSuccess(res, { mindMap }, 'Mind map generated successfully.');
        } catch (error) {
            return sendError(res, 500, 'GENERATE_MIND_MAP_ERROR', 'Failed to generate mind map.', error?.message || error);
        }
    });

    router.patch('/books/:bookId/mind-map', ...requireAdminHandlers, async (req, res) => {
        try {
            const bookId = cleanStr(req.params.bookId);
            if (!bookId) return sendError(res, 400, 'INVALID_PARAMS', 'Missing book ID.');

            const { positions, userNodes, userEdits } = req.body || {};
            const update = {};
            if (positions && typeof positions === 'object') update.positions = positions;
            if (Array.isArray(userNodes)) update.userNodes = userNodes;
            if (userEdits && typeof userEdits === 'object') update.userEdits = userEdits;

            if (Object.keys(update).length === 0) {
                return sendError(res, 400, 'INVALID_PARAMS', 'No valid fields to update.');
            }

            await db.collection(CRM_BOOKS).doc(bookId)
                .collection('artifacts').doc('mind_map')
                .set(update, { merge: true });

            return sendSuccess(res, { ok: true }, 'Mind map edits saved.');
        } catch (error) {
            return sendError(res, 500, 'SAVE_MIND_MAP_ERROR', 'Failed to save mind map edits.', error?.message || error);
        }
    });

    // ── Mind Map Version History ───────────────────────────────────────
    router.get('/books/:bookId/mind-map/versions', ...requireAdminHandlers, async (req, res) => {
        try {
            const bookId = cleanStr(req.params.bookId);
            if (!bookId) return sendError(res, 400, 'INVALID_PARAMS', 'Missing book ID.');

            const snap = await db.collection(CRM_BOOKS).doc(bookId)
                .collection('artifacts').doc('mind_map')
                .collection('versions')
                .orderBy('createdAt', 'desc')
                .limit(10)
                .get();

            const versions = snap.docs.map(d => ({
                id: d.id,
                name: d.data().name || 'Snapshot',
                createdAt: d.data().createdAt,
                noteCount: d.data().noteCount || 0,
                categoryCount: d.data().categoryCount || 0
            }));

            return sendSuccess(res, { versions });
        } catch (error) {
            return sendError(res, 500, 'LIST_VERSIONS_ERROR', 'Failed to list mind map versions.', error?.message || error);
        }
    });

    router.post('/books/:bookId/mind-map/snapshot', ...requireAdminHandlers, async (req, res) => {
        try {
            const bookId = cleanStr(req.params.bookId);
            const name = cleanStr(req.body?.name) || `Snapshot ${new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
            if (!bookId) return sendError(res, 400, 'INVALID_PARAMS', 'Missing book ID.');

            const currentDoc = await db.collection(CRM_BOOKS).doc(bookId)
                .collection('artifacts').doc('mind_map').get();

            if (!currentDoc.exists) {
                return sendError(res, 404, 'NO_MIND_MAP', 'No mind map exists to snapshot.');
            }

            const currentData = currentDoc.data();
            const versionData = {
                name,
                createdAt: new Date().toISOString(),
                noteCount: currentData.noteCount || 0,
                categoryCount: (currentData.categories || []).length,
                centralTopic: currentData.centralTopic || '',
                categories: currentData.categories || [],
                positions: currentData.positions || {},
                userNodes: currentData.userNodes || [],
                userEdits: currentData.userEdits || {}
            };

            const versionsRef = db.collection(CRM_BOOKS).doc(bookId)
                .collection('artifacts').doc('mind_map')
                .collection('versions');

            await versionsRef.add(versionData);

            // Prune old versions beyond 10
            const allVersions = await versionsRef.orderBy('createdAt', 'desc').get();
            if (allVersions.size > 10) {
                const batch = db.batch();
                allVersions.docs.slice(10).forEach(d => batch.delete(d.ref));
                await batch.commit();
            }

            return sendSuccess(res, { ok: true, name }, 'Snapshot saved.');
        } catch (error) {
            return sendError(res, 500, 'SNAPSHOT_ERROR', 'Failed to save mind map snapshot.', error?.message || error);
        }
    });

    router.post('/books/:bookId/mind-map/restore/:versionId', ...requireAdminHandlers, async (req, res) => {
        try {
            const bookId = cleanStr(req.params.bookId);
            const versionId = cleanStr(req.params.versionId);
            if (!bookId || !versionId) return sendError(res, 400, 'INVALID_PARAMS', 'Missing book or version ID.');

            const versionDoc = await db.collection(CRM_BOOKS).doc(bookId)
                .collection('artifacts').doc('mind_map')
                .collection('versions').doc(versionId).get();

            if (!versionDoc.exists) {
                return sendError(res, 404, 'VERSION_NOT_FOUND', 'Version not found.');
            }

            const versionData = versionDoc.data();
            const restore = {
                centralTopic: versionData.centralTopic,
                categories: versionData.categories || [],
                positions: versionData.positions || {},
                userNodes: versionData.userNodes || [],
                userEdits: versionData.userEdits || {}
            };

            await db.collection(CRM_BOOKS).doc(bookId)
                .collection('artifacts').doc('mind_map')
                .set(restore, { merge: true });

            return sendSuccess(res, { mindMap: { ...restore, noteCount: versionData.noteCount } }, 'Mind map restored from snapshot.');
        } catch (error) {
            return sendError(res, 500, 'RESTORE_ERROR', 'Failed to restore mind map version.', error?.message || error);
        }
    });


    // --- Book Notes CRUD (Firestore-backed) ---
    router.get('/books/:bookId/notes', ...requireAdminHandlers, async (req, res) => {
        try {
            const bookId = cleanStr(req.params.bookId);
            if (!bookId) return sendError(res, 400, 'INVALID_PARAMS', 'Missing book ID.');

            const snap = await db.collection(CRM_BOOKS).doc(bookId)
                .collection('user_notes')
                .orderBy('savedAt', 'desc')
                .limit(200)
                .get();

            const notes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            return sendSuccess(res, { notes });
        } catch (error) {
            return sendError(res, 500, 'GET_NOTES_ERROR', 'Failed to retrieve notes.', error?.message || error);
        }
    });

    router.post('/books/:bookId/notes', ...requireAdminHandlers, async (req, res) => {
        try {
            const bookId = cleanStr(req.params.bookId);
            const text = cleanStr(req.body?.text);
            if (!bookId || !text) return sendError(res, 400, 'INVALID_PARAMS', 'Missing book ID or note text.');

            const noteData = {
                text,
                savedAt: Date.now(),
                createdAt: new Date()
            };
            const docRef = await db.collection(CRM_BOOKS).doc(bookId)
                .collection('user_notes').add(noteData);

            return sendSuccess(res, { note: { id: docRef.id, ...noteData } }, 'Note saved.');
        } catch (error) {
            return sendError(res, 500, 'SAVE_NOTE_ERROR', 'Failed to save note.', error?.message || error);
        }
    });

    router.delete('/books/:bookId/notes/:noteId', ...requireAdminHandlers, async (req, res) => {
        try {
            const bookId = cleanStr(req.params.bookId);
            const noteId = cleanStr(req.params.noteId);
            if (!bookId || !noteId) return sendError(res, 400, 'INVALID_PARAMS', 'Missing book or note ID.');

            await db.collection(CRM_BOOKS).doc(bookId)
                .collection('user_notes').doc(noteId).delete();

            return sendSuccess(res, {}, 'Note deleted.');
        } catch (error) {
            return sendError(res, 500, 'DELETE_NOTE_ERROR', 'Failed to delete note.', error?.message || error);
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
                    const bucket = await getStorageBucket();
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
                    const bucket = await getStorageBucket();
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

    router.get('/books/:bookId/source', ...requireAdminHandlers, async (req, res) => {
        try {
            const bookId = cleanStr(req.params.bookId);
            if (!bookId) {
                return sendError(res, 400, 'INVALID_BOOK_ID', 'Missing book ID.');
            }
            if (!getStorageBucket) {
                return sendError(res, 500, 'NO_STORAGE', 'Storage not configured.');
            }

            const bookSnap = await db.collection(CRM_BOOKS).doc(bookId).get();
            if (!bookSnap.exists) {
                return sendError(res, 404, 'BOOK_NOT_FOUND', 'Book not found.');
            }

            const bookData = bookSnap.data() || {};
            const storagePath = cleanStr(bookData.source?.storagePath);
            if (!storagePath) {
                return sendError(res, 404, 'SOURCE_NOT_FOUND', 'The source file is not available.');
            }

            const bucket = await getStorageBucket();
            const file = bucket.file(storagePath);
            const [exists] = await file.exists();
            if (!exists) {
                return sendError(res, 404, 'SOURCE_NOT_FOUND', 'The source file is not available.');
            }

            const filename = sourceDownloadFilename(bookData);
            const [downloadUrl] = await file.getSignedUrl({
                action: 'read',
                expires: Date.now() + SOURCE_DOWNLOAD_TTL_MS,
                responseDisposition: `attachment; filename="${filename.replace(/"/g, '')}"`,
                responseType: 'application/pdf'
            });

            if (!downloadUrl) {
                return sendError(res, 500, 'SOURCE_DOWNLOAD_ERROR', 'Could not create a source download link.');
            }

            await writeAuditLog?.({
                action: 'book.source_download',
                entityType: 'book',
                entityId: bookId,
                metadata: { title: bookData.title || '', filename }
            }, { user: req.user });

            return sendSuccess(res, { downloadUrl, filename });
        } catch (error) {
            return sendError(res, 500, 'SOURCE_DOWNLOAD_ERROR', 'Failed to prepare the source download.', error?.message || error);
        }
    });

    router.patch('/books/:bookId/threads/:threadId', ...requireAdminHandlers, async (req, res) => {
        try {
            const bookId = cleanStr(req.params.bookId);
            const threadId = cleanStr(req.params.threadId);
            const title = cleanStr(req.body?.title);

            if (!bookId || !threadId) {
                return sendError(res, 400, 'INVALID_PARAMS', 'Missing book or thread ID.');
            }
            if (!title || title.length > MAX_THREAD_TITLE_LENGTH) {
                return sendError(res, 400, 'INVALID_THREAD_TITLE', `Thread title must be between 1 and ${MAX_THREAD_TITLE_LENGTH} characters.`);
            }

            const threadRef = db.collection(CRM_BOOKS).doc(bookId).collection('threads').doc(threadId);
            const threadSnap = await threadRef.get();
            if (!threadSnap.exists) {
                return sendError(res, 404, 'THREAD_NOT_FOUND', 'Thread not found.');
            }

            // Keep updatedAt reserved for conversation activity so renaming does not reorder history.
            await threadRef.update({ title, titleUpdatedAt: serverTimestamp() });
            return sendSuccess(res, { thread: { threadId, title } }, 'Thread renamed.');
        } catch (error) {
            return sendError(res, 500, 'RENAME_THREAD_ERROR', 'Failed to rename thread.', error?.message || error);
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

    // ─── Pages ───
    const pagesCache = new Map();
    const PAGES_CACHE_TTL = 5 * 60 * 1000;

    router.get('/books/:bookId/pages', ...requireAdminHandlers, async (req, res) => {
        try {
            const bookId = cleanStr(req.params.bookId);
            if (!bookId) return sendError(res, 400, 'MISSING_BOOK_ID', 'bookId is required.');

            const cached = pagesCache.get(bookId);
            if (cached && Date.now() - cached.ts < PAGES_CACHE_TTL) {
                return sendSuccess(res, { totalPages: cached.data.totalPages, pages: cached.data.pages });
            }

            if (!getStorageBucket) return sendError(res, 500, 'NO_STORAGE', 'Storage not configured.');

            const bucket = await getStorageBucket();
            const pagesPath = `crm-books/${bookId}/pages.json`;
            const file = bucket.file(pagesPath);
            const [exists] = await file.exists();
            if (!exists) return sendSuccess(res, { totalPages: 0, pages: [] });

            const [buffer] = await file.download();
            const parsed = JSON.parse(buffer.toString('utf8'));
            const result = { totalPages: parsed.totalPages || 0, pages: parsed.pages || [] };

            pagesCache.set(bookId, { data: result, ts: Date.now() });
            if (pagesCache.size > 50) {
                const oldest = pagesCache.keys().next().value;
                pagesCache.delete(oldest);
            }

            return sendSuccess(res, result);
        } catch (error) {
            return sendError(res, 500, 'PAGES_ERROR', 'Failed to load pages.', error?.message || error);
        }
    });

    // ─── Background Music (Audio) ───
    router.get('/books/:bookId/audio', ...requireAdminHandlers, async (req, res) => {
        try {
            const bookId = cleanStr(req.params.bookId);
            if (!bookId) return sendError(res, 400, 'MISSING_BOOK_ID', 'bookId is required.');

            const audioSnap = await db.collection(CRM_BOOKS).doc(bookId)
                .collection('audio')
                .orderBy('createdAt', 'asc')
                .get();

            const tracks = audioSnap.docs.map((doc) => {
                const d = doc.data();
                return {
                    id: doc.id,
                    title: d.title || 'Untitled Track',
                    storagePath: d.storagePath || '',
                    downloadUrl: d.downloadUrl || '',
                    originalFilename: d.originalFilename || '',
                    sizeBytes: d.sizeBytes || null,
                    duration: d.duration || null,
                    createdAt: d.createdAt?.toDate?.() ?? d.createdAt ?? null
                };
            });

            return sendSuccess(res, { tracks, count: tracks.length });
        } catch (error) {
            return sendError(res, 500, 'GET_AUDIO_ERROR', 'Failed to load background music tracks.', error?.message || error);
        }
    });

    router.post('/books/:bookId/audio', ...requireAdminHandlers, async (req, res) => {
        try {
            const bookId = cleanStr(req.params.bookId);
            if (!bookId) return sendError(res, 400, 'MISSING_BOOK_ID', 'bookId is required.');

            const title = cleanStr(req.body?.title) || cleanStr(req.body?.originalFilename) || 'Background Music';
            const storagePath = cleanStr(req.body?.storagePath);
            const downloadUrl = cleanStr(req.body?.downloadUrl);
            const originalFilename = cleanStr(req.body?.originalFilename);
            const sizeBytes = Number(req.body?.sizeBytes) || null;
            const duration = Number(req.body?.duration) || null;

            if (!storagePath && !downloadUrl) {
                return sendError(res, 400, 'INVALID_AUDIO_DATA', 'Either storagePath or downloadUrl is required.');
            }

            const ref = db.collection(CRM_BOOKS).doc(bookId).collection('audio').doc();
            const payload = {
                title,
                storagePath,
                downloadUrl,
                originalFilename,
                sizeBytes,
                duration,
                createdAt: serverTimestamp(),
                createdByUid: req.user?.uid || null
            };

            await ref.set(payload);

            await writeAuditLog?.({
                action: 'book.audio_added',
                entityType: 'book',
                entityId: bookId,
                metadata: { audioId: ref.id, title, originalFilename }
            }, { user: req.user });

            return sendSuccess(res, { track: { id: ref.id, ...payload } }, 'Audio track saved.');
        } catch (error) {
            return sendError(res, 500, 'POST_AUDIO_ERROR', 'Failed to save background music track.', error?.message || error);
        }
    });

    router.delete('/books/:bookId/audio/:audioId', ...requireAdminHandlers, async (req, res) => {
        try {
            const bookId = cleanStr(req.params.bookId);
            const audioId = cleanStr(req.params.audioId);
            if (!bookId || !audioId) return sendError(res, 400, 'INVALID_PARAMS', 'Missing book or audio ID.');

            const docRef = db.collection(CRM_BOOKS).doc(bookId).collection('audio').doc(audioId);
            const docSnap = await docRef.get();
            if (!docSnap.exists) {
                return sendError(res, 404, 'AUDIO_NOT_FOUND', 'Audio track not found.');
            }

            const data = docSnap.data() || {};
            const storagePath = data.storagePath;

            if (storagePath && getStorageBucket) {
                try {
                    const bucket = await getStorageBucket();
                    const file = bucket.file(storagePath);
                    const [exists] = await file.exists();
                    if (exists) {
                        await file.delete();
                    }
                } catch (storageErr) {
                    console.warn('[CRM Books] Failed to delete audio file from storage:', storageErr);
                }
            }

            await docRef.delete();

            await writeAuditLog?.({
                action: 'book.audio_deleted',
                entityType: 'book',
                entityId: bookId,
                metadata: { audioId, title: data.title }
            }, { user: req.user });

            return sendSuccess(res, { audioId }, 'Audio track deleted.');
        } catch (error) {
            return sendError(res, 500, 'DELETE_AUDIO_ERROR', 'Failed to delete audio track.', error?.message || error);
        }
    });

    // ─── Mind Map: AI Node Expansion ───
    router.post('/books/:bookId/mind-map/expand', ...requireAdminHandlers, async (req, res) => {
        try {
            const { bookId } = req.params;
            const nodeTitle = String(req.body?.nodeTitle || '').trim();
            const nodeSummary = String(req.body?.nodeSummary || '').trim();

            if (!nodeTitle) {
                return sendError(res, 400, 'MISSING_TITLE', 'nodeTitle is required.');
            }

            const usage = await getUsageSummary(db);
            if (usage && usage.isOverBudget && !usage.overageApproved) {
                return sendError(res, 429, 'BUDGET_EXCEEDED', 'Monthly CRM Books budget exceeded. Admin approval required.');
            }

            const result = await expandMindMapNode(db, bookId, nodeTitle, nodeSummary);

            await writeAuditLog?.({
                action: 'book.mind_map_expand',
                entityType: 'book',
                entityId: bookId,
                metadata: { nodeTitle, subtopicCount: result.subtopics.length }
            }, { user: req.user });

            return sendSuccess(res, result, 'Node expanded successfully.');
        } catch (error) {
            if (error.code === 'not-found') {
                return sendError(res, 404, 'BOOK_NOT_FOUND', 'Book not found.');
            }
            return sendError(res, 500, 'EXPAND_NODE_ERROR', 'Failed to expand node.', error?.message || error);
        }
    });

    // ─── Research Compilation ───
    router.post('/books/:bookId/compile', ...requireAdminHandlers, async (req, res) => {
        try {
            const { bookId } = req.params;
            const bookTitle = String(req.body?.bookTitle || '').trim();
            const sources = req.body?.sources || {};

            const usage = await getUsageSummary(db);
            if (usage && usage.isOverBudget && !usage.overageApproved) {
                return sendError(res, 429, 'BUDGET_EXCEEDED', 'Monthly CRM Books budget exceeded. Admin approval required.');
            }

            const result = await compileResearch(db, bookId, bookTitle, sources);

            await writeAuditLog?.({
                action: 'book.compile_research',
                entityType: 'book',
                entityId: bookId,
                metadata: { bookTitle }
            }, { user: req.user });

            return sendSuccess(res, result, 'Research compiled successfully.');
        } catch (error) {
            if (error.code === 'not-found') {
                return sendError(res, 404, 'BOOK_NOT_FOUND', 'Book not found.');
            }
            return sendError(res, 500, 'COMPILE_ERROR', 'Failed to compile research.', error?.message || error);
        }
    });

    // ─── Cross-Book Links (Knowledge Graph) ───
    router.get('/book-links', ...requireAdminHandlers, async (req, res) => {
        try {
            const snap = await db.collection(CRM_BOOK_LINKS).orderBy('createdAt', 'desc').limit(500).get();
            const links = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            return sendSuccess(res, { links });
        } catch (error) {
            return sendError(res, 500, 'LIST_LINKS_ERROR', 'Failed to list book links.', error?.message || error);
        }
    });

    router.post('/book-links', ...requireAdminHandlers, async (req, res) => {
        try {
            const sourceBookId = cleanStr(req.body?.sourceBookId);
            const sourceNodeId = cleanStr(req.body?.sourceNodeId);
            const sourceTitle = cleanStr(req.body?.sourceTitle);
            const targetBookId = cleanStr(req.body?.targetBookId);
            const targetNodeId = cleanStr(req.body?.targetNodeId);
            const targetTitle = cleanStr(req.body?.targetTitle);
            const label = cleanStr(req.body?.label, 'related');

            if (!sourceBookId || !targetBookId) {
                return sendError(res, 400, 'MISSING_FIELDS', 'sourceBookId and targetBookId are required.');
            }
            if (sourceBookId === targetBookId) {
                return sendError(res, 400, 'SELF_LINK', 'Cannot link a book to itself.');
            }

            const linkDoc = {
                sourceBookId, sourceNodeId, sourceTitle,
                targetBookId, targetNodeId, targetTitle,
                label,
                createdBy: req.user?.uid || '',
                createdAt: serverTimestamp()
            };
            const ref = await db.collection(CRM_BOOK_LINKS).add(linkDoc);
            return sendSuccess(res, { id: ref.id, ...linkDoc }, 'Link created.');
        } catch (error) {
            return sendError(res, 500, 'CREATE_LINK_ERROR', 'Failed to create link.', error?.message || error);
        }
    });

    router.delete('/book-links/:linkId', ...requireAdminHandlers, async (req, res) => {
        try {
            const linkId = cleanStr(req.params.linkId);
            if (!linkId) return sendError(res, 400, 'MISSING_ID', 'Link ID is required.');
            const snap = await db.collection(CRM_BOOK_LINKS).doc(linkId).get();
            if (!snap.exists) return sendError(res, 404, 'NOT_FOUND', 'Link not found.');
            await db.collection(CRM_BOOK_LINKS).doc(linkId).delete();
            return sendSuccess(res, { linkId }, 'Link deleted.');
        } catch (error) {
            return sendError(res, 500, 'DELETE_LINK_ERROR', 'Failed to delete link.', error?.message || error);
        }
    });

    // ─── Shareable Mind Map Links ───
    router.post('/books/:bookId/mind-map/share', ...requireAdminHandlers, async (req, res) => {
        try {
            const { bookId } = req.params;
            const bookSnap = await db.collection(CRM_BOOKS).doc(bookId).get();
            if (!bookSnap.exists) return sendError(res, 404, 'BOOK_NOT_FOUND', 'Book not found.');

            const token = crypto.randomBytes(24).toString('hex');
            const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

            const mindMapSnap = await db.collection(CRM_BOOKS).doc(bookId).collection('artifacts').doc('mind_map').get();
            const mindMapData = mindMapSnap.exists ? mindMapSnap.data() : null;

            const shareDoc = {
                bookId,
                bookTitle: bookSnap.data().title || '',
                token,
                expiresAt,
                mindMapSnapshot: mindMapData,
                createdBy: req.user?.uid || '',
                createdAt: serverTimestamp()
            };
            await db.collection(CRM_BOOK_SHARES).doc(token).set(shareDoc);

            return sendSuccess(res, { token, expiresAt: expiresAt.toISOString(), shareUrl: `/shared-mindmap.html?token=${token}` }, 'Share link created.');
        } catch (error) {
            return sendError(res, 500, 'SHARE_ERROR', 'Failed to create share link.', error?.message || error);
        }
    });

    router.get('/shared/mind-map/:token', async (req, res) => {
        try {
            const shareSnap = await db.collection(CRM_BOOK_SHARES).doc(req.params.token).get();
            if (!shareSnap.exists) return sendError(res, 404, 'NOT_FOUND', 'Share link not found or expired.');
            const data = shareSnap.data();
            if (data.expiresAt && new Date(data.expiresAt.toDate?.() || data.expiresAt) < new Date()) {
                return sendError(res, 410, 'EXPIRED', 'This share link has expired.');
            }
            return sendSuccess(res, {
                bookTitle: data.bookTitle || '',
                mindMap: data.mindMapSnapshot || null
            });
        } catch (error) {
            return sendError(res, 500, 'SHARED_READ_ERROR', 'Failed to load shared mind map.', error?.message || error);
        }
    });

    // ─── Shared Book Collections ───
    router.get('/book-collections', ...requireAdminHandlers, async (req, res) => {
        try {
            const snap = await db.collection(CRM_BOOK_COLLECTIONS).orderBy('createdAt', 'desc').limit(100).get();
            const collections = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            return sendSuccess(res, { collections });
        } catch (error) {
            return sendError(res, 500, 'LIST_COLLECTIONS_ERROR', 'Failed to list collections.', error?.message || error);
        }
    });

    router.post('/book-collections', ...requireAdminHandlers, async (req, res) => {
        try {
            const name = cleanStr(req.body?.name);
            const description = cleanStr(req.body?.description);
            const bookIds = Array.isArray(req.body?.bookIds) ? req.body.bookIds : [];
            if (!name) return sendError(res, 400, 'MISSING_NAME', 'Collection name is required.');

            const colDoc = {
                name, description, bookIds,
                createdBy: req.user?.uid || '',
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            };
            const ref = await db.collection(CRM_BOOK_COLLECTIONS).add(colDoc);
            return sendSuccess(res, { id: ref.id, ...colDoc }, 'Collection created.');
        } catch (error) {
            return sendError(res, 500, 'CREATE_COLLECTION_ERROR', 'Failed to create collection.', error?.message || error);
        }
    });

    router.patch('/book-collections/:collectionId', ...requireAdminHandlers, async (req, res) => {
        try {
            const updates = {};
            if (req.body?.name !== undefined) updates.name = cleanStr(req.body.name);
            if (req.body?.description !== undefined) updates.description = cleanStr(req.body.description);
            if (Array.isArray(req.body?.bookIds)) updates.bookIds = req.body.bookIds;
            updates.updatedAt = serverTimestamp();

            await db.collection(CRM_BOOK_COLLECTIONS).doc(req.params.collectionId).update(updates);
            return sendSuccess(res, { collectionId: req.params.collectionId }, 'Collection updated.');
        } catch (error) {
            return sendError(res, 500, 'UPDATE_COLLECTION_ERROR', 'Failed to update collection.', error?.message || error);
        }
    });

    router.delete('/book-collections/:collectionId', ...requireAdminHandlers, async (req, res) => {
        try {
            const collectionId = cleanStr(req.params.collectionId);
            if (!collectionId) return sendError(res, 400, 'MISSING_ID', 'Collection ID is required.');
            const snap = await db.collection(CRM_BOOK_COLLECTIONS).doc(collectionId).get();
            if (!snap.exists) return sendError(res, 404, 'NOT_FOUND', 'Collection not found.');
            await db.collection(CRM_BOOK_COLLECTIONS).doc(collectionId).delete();
            return sendSuccess(res, { collectionId }, 'Collection deleted.');
        } catch (error) {
            return sendError(res, 500, 'DELETE_COLLECTION_ERROR', 'Failed to delete collection.', error?.message || error);
        }
    });

};

