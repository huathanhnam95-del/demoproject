window.CrmBooksWorkspace = (function () {
    'use strict';

    function fallbackEscapeHtml(value) {
        const div = document.createElement('div');
        div.textContent = String(value ?? '');
        return div.innerHTML;
    }

    function clean(value) {
        return String(value ?? '').trim();
    }

    function normalizeBooks(source) {
        return (Array.isArray(source) ? source : [])
            .map((item) => ({
                bookId: clean(item?.bookId),
                title: clean(item?.title),
                author: clean(item?.author),
                description: clean(item?.description),
                pageCount: item?.pageCount ?? null,
                sizeBytes: item?.sizeBytes ?? null,
                sha256: item?.sha256 || null,
                status: clean(item?.status || 'awaiting_upload'),
                ingest: item?.ingest || null,
                source: item?.source || null,
                createdAt: item?.createdAt || null
            }))
            .filter((item) => item.bookId);
    }

    function buildIngestLabel(ingest, status) {
        if (!ingest && status === 'awaiting_upload') return 'Upload incomplete';
        if (!ingest && status === 'ready') return 'Ready';
        if (!ingest) return status || '';
        const stage = clean(ingest.stage);
        const percent = typeof ingest.percent === 'number' ? ingest.percent : 0;
        if (status === 'failed') {
            const rawError = clean(ingest.error) || clean(ingest.error?.message);
            const codeMatch = rawError.match(/^\[([A-Z_]+)\]/);
            const code = codeMatch ? codeMatch[1] : clean(ingest.error?.code);
            const map = {
                SCANNED_PDF_NO_TEXT: 'This PDF is scanned images with no selectable text. Run OCR on it first, then re-upload.',
                PDF_PARSE_FAILED: 'Could not read this PDF. It may be encrypted or corrupt.',
                EMBED_QUOTA: 'The AI service was busy. Nothing was lost — processing resumes from where it stopped.',
                AI_UNAVAILABLE: 'The AI service was busy. Nothing was lost — processing resumes from where it stopped.',
                INGEST_ERROR: rawError.replace(/^\[[A-Z_]+\]\s*/, '') || 'Processing failed'
            };
            return map[code] || rawError || 'Processing failed';
        }
        if (status === 'ready') return 'Ready';
        const stageLabels = {
            extract: 'Extracting text',
            chunk: 'Chunking',
            chunk_done: 'Chunking complete',
            embed: 'Embedding',
            summarize: 'Summarizing'
        };
        const label = stageLabels[stage] || stage || 'Processing';
        if (stage === 'embed' && ingest.totalChunks > 0) {
            return `${label} ${ingest.embeddedChunks || 0} / ${ingest.totalChunks}`;
        }
        return `${label}${percent > 0 ? ` ${Math.round(percent)}%` : ''}`;
    }

    function formatEta(ingest) {
        if (!ingest || ingest.stage !== 'embed') return null;
        const embedded = ingest.embeddedChunks || 0;
        const total = ingest.totalChunks || 0;
        if (embedded < 10 || total <= embedded) return null;
        const started = ingest.startedAt;
        if (!started) return null;
        const startMs = typeof started === 'number' ? started :
            (started?.seconds ? started.seconds * 1000 : new Date(started).getTime());
        if (!startMs || isNaN(startMs)) return null;
        const elapsedMs = Date.now() - startMs;
        if (elapsedMs < 5000) return null;
        const ratePerMs = embedded / elapsedMs;
        const remaining = total - embedded;
        const etaMs = remaining / ratePerMs;
        const etaMin = Math.ceil(etaMs / 60000);
        if (etaMin < 1) return 'less than a minute left';
        if (etaMin === 1) return 'about 1 min left';
        return `about ${etaMin} min left`;
    }

    function renderCitations(citations, escHtml) {
        if (!Array.isArray(citations) || citations.length === 0) return '';
        return citations.map((c, i) => {
            const num = i + 1;
            const pages = c.pageStart === c.pageEnd
                ? `p. ${c.pageStart}`
                : `pp. ${c.pageStart}–${c.pageEnd}`;
            const snippet = escHtml(clean(c.snippet).slice(0, 200));
            return `<span class="crm-books-citation-ref" data-citation-idx="${num}" title="${escHtml(pages)}">[${num}]</span>` +
                `<span class="crm-books-citation-detail" data-citation-idx="${num}" style="display:none;">` +
                `<span class="crm-books-citation-pages">${escHtml(pages)}</span> ` +
                `<span class="crm-books-citation-snippet">${snippet}</span>` +
                `</span>`;
        }).join('');
    }

    function ingestWeightedPercent(ingest, status) {
        if (status === 'ready') return 100;
        if (status === 'failed' || !ingest) return 0;
        const stage = clean(ingest.stage);
        const normalizedStage = stage === 'chunk_done' ? 'embed' : stage;
        const weights = { extract: 10, chunk: 5, embed: 60, summarize: 25 };
        const order = ['extract', 'chunk', 'embed', 'summarize'];
        let base = 0;
        for (const s of order) {
            if (s === normalizedStage) break;
            base += weights[s] || 0;
        }
        const stageWeight = weights[normalizedStage] || 0;
        let stageProgress = 0;
        if (stage === 'embed' && ingest.totalChunks > 0) {
            stageProgress = (ingest.embeddedChunks || 0) / ingest.totalChunks;
        } else if (typeof ingest.percent === 'number' && ingest.percent > 0) {
            stageProgress = ingest.percent / 100;
        }
        return Math.min(100, Math.round(base + stageWeight * stageProgress));
    }

    async function computeSha256(file) {
        const buffer = await file.arrayBuffer();
        const hash = await crypto.subtle.digest('SHA-256', buffer);
        return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
    }

    function createController(deps = {}) {
        const elements = deps.elements || {};
        const showToast = typeof deps.showToast === 'function' ? deps.showToast : null;
        const apiFetchJson = typeof deps.apiFetchJson === 'function' ? deps.apiFetchJson : null;
        const escapeHtml = typeof deps.escapeHtml === 'function' ? deps.escapeHtml : fallbackEscapeHtml;
        const formatDateTime = typeof deps.formatDateTime === 'function' ? deps.formatDateTime : (v) => clean(v) || '-';
        const firebaseApp = deps.firebase || (typeof firebase !== 'undefined' ? firebase : null);

        let bound = false;
        let books = [];
        let selectedBookId = '';
        let selectionCounter = 0;
        let selectedBook = null;
        let selectedSummary = null;
        let activeTab = 'summary';
        let uploadTask = null;
        let snapshotUnsubscribe = null;
        let threads = [];
        let selectedThreadId = '';
        let messages = [];
        let renderListTimer = null;

        // --- DOM references ---
        const panel = elements.booksPanel || document.querySelector('[data-panel="books"]');

        function qs(sel) { return panel ? panel.querySelector(sel) : document.querySelector(sel); }

        // --- API helpers ---
        async function apiGet(path) {
            if (!apiFetchJson) throw new Error('No API client');
            return apiFetchJson(path);
        }

        async function apiPost(path, body) {
            if (!apiFetchJson) throw new Error('No API client');
            return apiFetchJson(path, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
        }

        async function apiDelete(path) {
            if (!apiFetchJson) throw new Error('No API client');
            return apiFetchJson(path, { method: 'DELETE' });
        }

        // --- Render: book list ---
        function renderList() {
            const list = qs('.crm-books-list');
            if (!list) return;
            if (books.length === 0) {
                list.innerHTML = '<li class="crm-books-empty-item">No books yet. Click <strong>+ Add book</strong> to upload a PDF.</li>';
                return;
            }
            list.innerHTML = books.map((b) => {
                const isSelected = b.bookId === selectedBookId;
                const statusIcon = b.status === 'ready' ? '<span class="crm-books-status-icon ready" title="Ready">&#10003;</span>'
                    : b.status === 'failed' ? '<span class="crm-books-status-icon failed" title="Failed">&#9888;</span>'
                        : '';
                const ingestLine = (b.status !== 'ready' && b.status !== 'awaiting_upload')
                    ? `<div class="crm-books-ingest-line"><div class="crm-books-progress-bar"><div class="crm-books-progress-fill" style="width:${ingestWeightedPercent(b.ingest, b.status)}%"></div></div><span class="crm-muted" style="font-size:0.75rem;">${escapeHtml(buildIngestLabel(b.ingest, b.status))}</span></div>`
                    : b.status === 'awaiting_upload'
                        ? `<div class="crm-books-ingest-line"><span class="crm-muted" style="font-size:0.75rem;">Upload incomplete</span></div>`
                        : '';
                return `<li class="crm-books-list-item${isSelected ? ' selected' : ''}" data-book-id="${escapeHtml(b.bookId)}">` +
                    `<div class="crm-books-list-item-header"><span class="crm-books-list-title">${escapeHtml(b.title)}</span>${statusIcon}</div>` +
                    `<div class="crm-books-list-author crm-muted">${escapeHtml(b.author || '')}</div>` +
                    ingestLine +
                    `</li>`;
            }).join('');
        }

        // --- Render: detail (right column) ---
        function renderDetail() {
            const detail = qs('.crm-books-detail');
            if (!detail) return;

            if (!selectedBook) {
                detail.innerHTML = '<div class="crm-books-empty-detail"><p class="crm-muted">Select a book from the library to view its summary, chat, or pages.</p></div>';
                return;
            }

            const b = selectedBook;
            const pageLabel = b.pageCount ? `${b.pageCount} pages` : '';

            let tabsHtml = '';
            let contentHtml = '';

            if (b.status === 'ready') {
                tabsHtml = `<div class="crm-books-tabs">` +
                    `<button class="crm-books-tab${activeTab === 'summary' ? ' active' : ''}" data-books-tab="summary">Summary</button>` +
                    `<button class="crm-books-tab${activeTab === 'chat' ? ' active' : ''}" data-books-tab="chat">Chat</button>` +
                    `<button class="crm-books-tab${activeTab === 'pages' ? ' active' : ''}" data-books-tab="pages">Pages</button>` +
                    `</div>`;
                contentHtml = renderTabContent();
            } else if (b.status === 'failed') {
                contentHtml = renderFailedState(b);
            } else if (b.status === 'awaiting_upload') {
                contentHtml = renderAwaitingUpload(b);
            } else {
                contentHtml = renderProcessingState(b);
            }

            detail.innerHTML =
                `<div class="crm-section-header" style="border-bottom:1px solid var(--border-color, #e2e8f0); padding-bottom:12px; margin-bottom:16px;">` +
                `<div><h3>${escapeHtml(b.title)}</h3>` +
                `<p class="crm-muted">${[escapeHtml(b.author), pageLabel].filter(Boolean).join(' · ')}</p></div>` +
                `<button class="crm-btn-secondary crm-books-delete-btn" data-book-id="${escapeHtml(b.bookId)}" title="Delete this book" style="color:var(--danger-color, #e53e3e);">Delete</button>` +
                `</div>` +
                tabsHtml +
                `<div class="crm-books-tab-body">${contentHtml}</div>`;
        }

        function renderTabContent() {
            if (activeTab === 'summary') return renderSummaryTab();
            if (activeTab === 'chat') return renderChatTab();
            if (activeTab === 'pages') return '<div class="crm-muted" style="padding:24px;">Pages viewer will be available after full implementation.</div>';
            return '';
        }

        function renderSummaryTab() {
            if (!selectedSummary) return '<div class="crm-muted" style="padding:24px;">No summary available yet.</div>';
            const s = selectedSummary;
            let html = '';
            if (s.oneLiner) html += `<p style="font-size:1.15rem; font-weight:600; margin-bottom:16px;">${escapeHtml(s.oneLiner)}</p>`;
            if (s.overview) html += `<div class="crm-books-overview">${escapeHtml(s.overview).replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</div>`;
            if (s.audience) html += `<p class="crm-muted" style="margin:12px 0;"><strong>Audience:</strong> ${escapeHtml(s.audience)}</p>`;
            if (Array.isArray(s.keyTopics) && s.keyTopics.length > 0) {
                html += `<div class="crm-books-topics-header" style="margin-top:20px;"><strong>Key topics</strong></div>`;
                html += `<div class="crm-books-topics">${s.keyTopics.map((t) =>
                    `<span class="crm-books-topic-chip">${escapeHtml(t.topic)}${t.pages?.length ? ` <span class="crm-muted">(p. ${escapeHtml(String(t.pages.join(', ')))})</span>` : ''}</span>`
                ).join('')}</div>`;
            }
            if (Array.isArray(s.outline) && s.outline.length > 0) {
                html += `<div style="margin-top:20px;"><strong>Outline</strong></div>`;
                html += renderOutline(s.outline);
            }
            return html || '<div class="crm-muted" style="padding:24px;">Summary is empty.</div>';
        }

        function renderOutline(items, depth = 0) {
            if (!Array.isArray(items) || items.length === 0) return '';
            return `<ol class="crm-books-outline" style="padding-left:${depth > 0 ? 20 : 0}px;">` +
                items.map((item) => {
                    const pages = item.pageStart != null && item.pageEnd != null
                        ? ` <span class="crm-muted">(pp. ${escapeHtml(String(item.pageStart))}–${escapeHtml(String(item.pageEnd))})</span>` : '';
                    const summary = item.summary ? `<p class="crm-muted" style="margin:2px 0 6px;">${escapeHtml(item.summary)}</p>` : '';
                    const children = renderOutline(item.children, depth + 1);
                    return `<li><strong>${escapeHtml(item.title || '')}</strong>${pages}${summary}${children}</li>`;
                }).join('') +
                `</ol>`;
        }

        function renderChatTab() {
            const threadSelect = threads.length > 0
                ? `<select class="crm-input crm-books-thread-select" style="max-width:240px;">${threads.map((t) =>
                    `<option value="${escapeHtml(t.threadId)}"${t.threadId === selectedThreadId ? ' selected' : ''}>${escapeHtml(t.title)}</option>`
                ).join('')}</select>`
                : '';

            let messagesHtml = '';
            if (messages.length === 0) {
                const starters = buildStarterQuestions();
                messagesHtml = `<div class="crm-books-chat-starters">` +
                    `<p class="crm-muted" style="margin-bottom:12px;">Ask a question about this book, or try one of these:</p>` +
                    starters.map((q) => `<button class="crm-books-starter-btn">${escapeHtml(q)}</button>`).join('') +
                    `</div>`;
            } else {
                messagesHtml = `<div class="crm-books-chat-messages">${messages.map(renderMessage).join('')}</div>`;
            }

            return `<div class="crm-books-chat-header" style="display:flex; gap:8px; align-items:center; margin-bottom:12px;">` +
                threadSelect +
                `<button class="crm-btn-secondary crm-books-new-thread-btn" style="font-size:0.8rem;">+ New thread</button>` +
                `</div>` +
                messagesHtml +
                `<div class="crm-books-composer">` +
                `<textarea class="crm-input crm-books-composer-input" placeholder="Ask about the book..." rows="2"></textarea>` +
                `<button class="crm-btn-primary crm-books-send-btn" style="align-self:flex-end;">Send</button>` +
                `</div>`;
        }

        function renderMessage(msg) {
            const isUser = msg.role === 'user';
            const cls = isUser ? 'crm-books-msg-user' : 'crm-books-msg-assistant';

            if (msg._loading) {
                return `<div class="crm-books-msg ${cls}">` +
                    `<div class="crm-books-msg-text crm-books-msg-loading crm-muted">Searching the book...</div>` +
                    `</div>`;
            }

            const answered = msg.answered !== false;
            const textCls = answered ? '' : ' crm-books-msg-unanswered';
            const citationsHtml = !isUser && msg.citations?.length > 0
                ? `<div class="crm-books-msg-citations">${renderCitations(msg.citations, escapeHtml)}</div>`
                : '';
            return `<div class="crm-books-msg ${cls}${textCls}">` +
                `<div class="crm-books-msg-text">${escapeHtml(msg.text || '')}</div>` +
                citationsHtml +
                `</div>`;
        }

        function buildStarterQuestions() {
            if (!selectedSummary?.keyTopics?.length) {
                return ['What is this book about?', 'What are the main topics?', 'Who is the target audience?', 'Summarize the key takeaways.'];
            }
            return selectedSummary.keyTopics.slice(0, 4).map((t) =>
                `What does the book say about ${t.topic.toLowerCase()}?`
            );
        }

        function renderFailedState(b) {
            const label = buildIngestLabel(b.ingest, b.status);
            const rawError = clean(b.ingest?.error);
            const codeMatch = rawError.match(/^\[([A-Z_]+)\]/);
            const code = codeMatch ? codeMatch[1] : clean(b.ingest?.error?.code);
            const nonRetryable = new Set(['SCANNED_PDF_NO_TEXT', 'PDF_PARSE_FAILED']);
            const canRetry = !nonRetryable.has(code);
            return `<div class="crm-books-state-notice" style="padding:24px;">` +
                `<p style="color:var(--danger-color, #e53e3e); font-weight:600; margin-bottom:8px;">Processing failed</p>` +
                `<p class="crm-muted">${escapeHtml(label)}</p>` +
                `<div style="margin-top:16px; display:flex; gap:8px;">` +
                (canRetry ? `<button class="crm-btn-secondary crm-books-retry-btn" data-book-id="${escapeHtml(b.bookId)}">Retry</button>` : '') +
                `<button class="crm-btn-secondary crm-books-delete-btn" data-book-id="${escapeHtml(b.bookId)}" style="color:var(--danger-color, #e53e3e);">Remove</button>` +
                `</div></div>`;
        }

        function renderAwaitingUpload(b) {
            return `<div class="crm-books-state-notice" style="padding:24px;">` +
                `<p class="crm-muted" style="margin-bottom:8px;">This book's PDF has not been uploaded yet.</p>` +
                `<div style="display:flex; gap:8px;">` +
                `<button class="crm-btn-primary crm-books-reupload-btn" data-book-id="${escapeHtml(b.bookId)}">Upload PDF</button>` +
                `<button class="crm-btn-secondary crm-books-delete-btn" data-book-id="${escapeHtml(b.bookId)}" style="color:var(--danger-color, #e53e3e);">Remove</button>` +
                `</div></div>`;
        }

        function renderProcessingState(b) {
            const percent = ingestWeightedPercent(b.ingest, b.status);
            const label = buildIngestLabel(b.ingest, b.status);
            const eta = formatEta(b.ingest);
            return `<div class="crm-books-state-notice" style="padding:24px;">` +
                `<p style="font-weight:600; margin-bottom:8px;">Processing...</p>` +
                `<div class="crm-books-progress-bar" style="height:8px; margin-bottom:8px;"><div class="crm-books-progress-fill" style="width:${percent}%"></div></div>` +
                `<p class="crm-muted">${escapeHtml(label)}</p>` +
                (eta ? `<p class="crm-muted" style="font-size:0.8rem;">${escapeHtml(eta)}</p>` : '') +
                `</div>`;
        }

        // --- Data loading ---
        async function refresh() {
            try {
                const res = await apiGet('/api/admin/books');
                books = normalizeBooks(res.books);
                renderList();
                if (selectedBookId) {
                    selectedBook = books.find((b) => b.bookId === selectedBookId) || null;
                    if (selectedBook) {
                        renderDetail();
                    }
                }
            } catch (err) {
                console.error('[CRM Books] Failed to refresh books:', err);
            }
        }

        async function selectBook(bookId) {
            selectedBookId = clean(bookId);
            const thisSelection = ++selectionCounter;
            selectedBook = books.find((b) => b.bookId === selectedBookId) || null;
            selectedSummary = null;
            threads = [];
            messages = [];
            selectedThreadId = '';
            activeTab = 'summary';

            detachSnapshot();
            renderList();

            if (!selectedBook) {
                renderDetail();
                return;
            }

            try {
                const res = await apiGet(`/api/admin/books/${selectedBookId}`);
                if (thisSelection !== selectionCounter) return;
                if (res.book) {
                    selectedBook = res.book;
                    const idx = books.findIndex((b) => b.bookId === selectedBookId);
                    if (idx >= 0) books[idx] = { ...books[idx], ...selectedBook };
                }
                selectedSummary = res.summary || null;
            } catch (err) {
                if (thisSelection !== selectionCounter) return;
                console.error('[CRM Books] Failed to load book detail:', err);
            }

            renderDetail();

            if (selectedBook.status === 'ready') {
                loadThreads().catch(console.error);
            }

            if (selectedBook.status !== 'ready' && selectedBook.status !== 'failed') {
                attachSnapshot(selectedBookId);
            }

            updateHash();
        }

        async function loadThreads() {
            if (!selectedBookId) return;
            try {
                const res = await apiGet(`/api/admin/books/${selectedBookId}/threads`);
                threads = Array.isArray(res.threads) ? res.threads : [];
                if (threads.length > 0 && !selectedThreadId) {
                    selectedThreadId = threads[0].threadId;
                    await loadMessages();
                }
                renderDetail();
            } catch (err) {
                console.error('[CRM Books] Failed to load threads:', err);
            }
        }

        async function loadMessages() {
            if (!selectedBookId || !selectedThreadId) { messages = []; return; }
            try {
                const res = await apiGet(`/api/admin/books/${selectedBookId}/threads/${selectedThreadId}/messages`);
                messages = Array.isArray(res.messages) ? res.messages : [];
            } catch (err) {
                console.error('[CRM Books] Failed to load messages:', err);
                messages = [];
            }
        }

        // --- Snapshot listener for live ingest progress ---
        function attachSnapshot(bookId) {
            detachSnapshot();
            try {
                const db = firebaseApp?.firestore?.() || (typeof firebase !== 'undefined' ? firebase.firestore() : null);
                if (!db) return;
                snapshotUnsubscribe = db.collection('crmBooks').doc(bookId)
                    .onSnapshot((snap) => {
                        if (!snap.exists) return;
                        const data = snap.data() || {};
                        const idx = books.findIndex((b) => b.bookId === bookId);
                        const updated = {
                            ...(idx >= 0 ? books[idx] : {}),
                            status: data.status,
                            ingest: data.ingest,
                            pageCount: data.pageCount ?? null
                        };
                        if (idx >= 0) books[idx] = updated;
                        if (selectedBookId === bookId) {
                            selectedBook = updated;
                            renderDetail();
                        }
                        renderList();
                        if (data.status === 'ready' || data.status === 'failed') {
                            detachSnapshot();
                            if (data.status === 'ready' && selectedBookId === bookId) {
                                selectBook(bookId).catch(console.error);
                            }
                        }
                    }, (err) => {
                        console.warn('[CRM Books] Snapshot error, falling back to polling:', err);
                        detachSnapshot();
                    });
            } catch (err) {
                console.warn('[CRM Books] Could not attach snapshot:', err);
            }
        }

        function detachSnapshot() {
            if (snapshotUnsubscribe) {
                snapshotUnsubscribe();
                snapshotUnsubscribe = null;
            }
        }

        // --- Hash management ---
        function updateHash() {
            if (selectedBookId) {
                const hash = `#books/${selectedBookId}`;
                if (window.location.hash !== hash) {
                    history.replaceState(null, '', hash);
                }
            }
        }

        // --- Upload ---
        function openAddBookModal() {
            const existing = qs('.crm-books-add-modal');
            if (existing) existing.remove();

            const modal = document.createElement('div');
            modal.className = 'crm-modal-overlay crm-books-add-modal';
            modal.setAttribute('role', 'dialog');
            modal.setAttribute('aria-modal', 'true');
            modal.innerHTML =
                `<div class="crm-modal-container" style="max-width:480px;">` +
                `<div class="crm-modal-header"><h2>Add Book</h2>` +
                `<button class="crm-icon-btn crm-books-modal-close" title="Close"><svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg></button>` +
                `</div>` +
                `<div class="crm-modal-body" style="flex-direction:column; padding:20px;">` +
                `<div class="crm-form-grid" style="grid-template-columns:1fr;">` +
                `<div class="crm-form-group"><label for="crm-book-title">Title <span style="color:var(--danger-color,#e53e3e);">*</span></label><input id="crm-book-title" class="crm-input" type="text" placeholder="e.g. Sound Foundations"></div>` +
                `<div class="crm-form-group"><label for="crm-book-author">Author</label><input id="crm-book-author" class="crm-input" type="text" placeholder="e.g. Adrian Underhill"></div>` +
                `<div class="crm-form-group"><label for="crm-book-file">PDF file <span style="color:var(--danger-color,#e53e3e);">*</span></label><input id="crm-book-file" class="crm-input" type="file" accept=".pdf,application/pdf"></div>` +
                `<p class="crm-books-modal-error crm-muted" style="color:var(--danger-color,#e53e3e); display:none;"></p>` +
                `</div></div>` +
                `<div class="crm-modal-footer" style="padding:12px 20px; display:flex; justify-content:flex-end; gap:8px;">` +
                `<button class="crm-btn-secondary crm-books-modal-cancel">Cancel</button>` +
                `<button class="crm-btn-primary crm-books-modal-submit">Upload</button>` +
                `</div></div>`;

            document.body.appendChild(modal);
            modal.style.display = 'flex';

            const closeModal = () => { modal.style.display = 'none'; modal.remove(); };
            modal.querySelector('.crm-books-modal-close').addEventListener('click', closeModal);
            modal.querySelector('.crm-books-modal-cancel').addEventListener('click', closeModal);
            modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

            const submitBtn = modal.querySelector('.crm-books-modal-submit');
            const errorEl = modal.querySelector('.crm-books-modal-error');
            submitBtn.addEventListener('click', async () => {
                errorEl.style.display = 'none';
                const title = clean(modal.querySelector('#crm-book-title').value);
                const author = clean(modal.querySelector('#crm-book-author').value);
                const fileInput = modal.querySelector('#crm-book-file');
                const file = fileInput?.files?.[0];

                if (!title) { errorEl.textContent = 'Title is required.'; errorEl.style.display = 'block'; return; }
                if (!file) { errorEl.textContent = 'Please select a PDF file.'; errorEl.style.display = 'block'; return; }
                if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
                    errorEl.textContent = 'Only PDF files are supported.'; errorEl.style.display = 'block'; return;
                }
                if (file.size > 100 * 1024 * 1024) {
                    errorEl.textContent = 'File must be under 100 MB.'; errorEl.style.display = 'block'; return;
                }

                submitBtn.disabled = true;
                submitBtn.textContent = 'Preparing...';

                try {
                    const sha256 = await computeSha256(file);

                    const res = await apiPost('/api/admin/books', {
                        title,
                        author,
                        sha256,
                        originalFilename: file.name
                    });

                    if (!res.success && res.error === 'DUPLICATE_BOOK') {
                        errorEl.textContent = res.message || 'A book with this file already exists.';
                        errorEl.style.display = 'block';
                        submitBtn.disabled = false;
                        submitBtn.textContent = 'Upload';
                        return;
                    }

                    const book = res.book;
                    if (!book?.bookId) throw new Error('No book ID returned');

                    closeModal();

                    books.unshift({
                        bookId: book.bookId,
                        title,
                        author,
                        status: 'awaiting_upload',
                        ingest: null,
                        pageCount: null,
                        sizeBytes: null,
                        sha256,
                        source: { storagePath: book.storagePath }
                    });
                    renderList();

                    await startUpload(book.bookId, book.storagePath || `crm-books/${book.bookId}/source.pdf`, file);
                } catch (err) {
                    console.error('[CRM Books] Create/upload error:', err);
                    errorEl.textContent = err?.message || 'Failed to create book.';
                    errorEl.style.display = 'block';
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Upload';
                }
            });
        }

        async function startUpload(bookId, storagePath, file) {
            try {
                const storageRef = firebaseApp.storage().ref(storagePath);
                uploadTask = storageRef.put(file, { contentType: 'application/pdf' });

                uploadTask.on('state_changed',
                    (snapshot) => {
                        const pct = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
                        const idx = books.findIndex((b) => b.bookId === bookId);
                        if (idx >= 0) {
                            books[idx] = {
                                ...books[idx],
                                status: 'uploading',
                                ingest: { stage: 'upload', percent: pct, totalPages: 0, totalChunks: 0, embeddedChunks: 0, error: null }
                            };
                            if (!renderListTimer) {
                                renderListTimer = setTimeout(() => { renderListTimer = null; renderList(); }, 250);
                            }
                            if (selectedBookId === bookId) {
                                selectedBook = books[idx];
                                renderDetail();
                            }
                        }
                    },
                    async (error) => {
                        if (error?.code === 'storage/canceled') {
                            showToast?.('Upload cancelled.', 'info');
                            return;
                        }
                        console.error('[CRM Books] Upload error:', error);
                        showToast?.('Upload failed: ' + (error?.message || 'Unknown error'), 'error');
                        const idx = books.findIndex((b) => b.bookId === bookId);
                        if (idx >= 0) {
                            books[idx].status = 'awaiting_upload';
                            books[idx].ingest = null;
                            renderList();
                            if (selectedBookId === bookId) { selectedBook = books[idx]; renderDetail(); }
                        }
                    },
                    async () => {
                        uploadTask = null;
                        showToast?.('PDF uploaded. Queuing for processing...', 'info');
                        try {
                            await apiPost(`/api/admin/books/${bookId}/ingest`, {});
                            await refresh();
                            if (selectedBookId === bookId) {
                                attachSnapshot(bookId);
                            }
                        } catch (err) {
                            console.error('[CRM Books] Failed to queue ingest:', err);
                            showToast?.('Uploaded but failed to start processing. You can retry from the book detail.', 'error');
                            await refresh();
                        }
                    }
                );
            } catch (err) {
                console.error('[CRM Books] startUpload error:', err);
                showToast?.('Upload failed: ' + (err?.message || 'Unknown error'), 'error');
            }
        }

        // --- Actions ---
        async function deleteBook(bookId) {
            if (!confirm('Delete this book? It will be moved to the recycle bin.')) return;
            try {
                await apiDelete(`/api/admin/books/${bookId}`);
                showToast?.('Book deleted.', 'info');
                books = books.filter((b) => b.bookId !== bookId);
                if (selectedBookId === bookId) {
                    selectedBookId = '';
                    selectedBook = null;
                    selectedSummary = null;
                    detachSnapshot();
                }
                renderList();
                renderDetail();
            } catch (err) {
                console.error('[CRM Books] Delete error:', err);
                showToast?.('Failed to delete book.', 'error');
            }
        }

        async function retryIngest(bookId) {
            try {
                await apiPost(`/api/admin/books/${bookId}/ingest`, {});
                showToast?.('Re-queued for processing.', 'info');
                await refresh();
                if (selectedBookId === bookId) {
                    attachSnapshot(bookId);
                }
            } catch (err) {
                console.error('[CRM Books] Retry error:', err);
                showToast?.('Failed to retry.', 'error');
            }
        }

        async function createThread() {
            if (!selectedBookId) return;
            try {
                const res = await apiPost(`/api/admin/books/${selectedBookId}/threads`, {});
                if (res.threadId) {
                    selectedThreadId = res.threadId;
                    messages = [];
                    await loadThreads();
                }
            } catch (err) {
                console.error('[CRM Books] Create thread error:', err);
                showToast?.('Failed to create thread.', 'error');
            }
        }

        let chatInFlight = false;

        async function sendMessage(text) {
            if (!selectedBookId || chatInFlight) return;
            if (!text || text.length < 2) return;

            chatInFlight = true;

            if (!selectedThreadId) {
                try {
                    const res = await apiPost(`/api/admin/books/${selectedBookId}/threads`, {});
                    if (res.threadId) {
                        selectedThreadId = res.threadId;
                        threads.unshift({ threadId: res.threadId, title: 'New thread', messageCount: 0 });
                    }
                } catch (err) {
                    chatInFlight = false;
                    console.error('[CRM Books] Auto-create thread failed:', err);
                    showToast?.('Could not start a new conversation.', 'error');
                    return;
                }
            }

            messages.push({ role: 'user', text, citations: [] });
            messages.push({ role: 'assistant', text: '', citations: [], _loading: true });
            renderDetail();

            let liveInput = qs('.crm-books-composer-input');
            let liveSendBtn = qs('.crm-books-send-btn');
            if (liveSendBtn) liveSendBtn.disabled = true;
            if (liveInput) { liveInput.value = ''; liveInput.disabled = true; }

            updateLoadingIndicator('Searching the book...');

            try {
                const res = await apiPost(
                    `/api/admin/books/${selectedBookId}/threads/${selectedThreadId}/messages`,
                    { text }
                );

                messages.pop();
                messages.pop();

                if (res.userMessage) messages.push(res.userMessage);
                if (res.assistantMessage) messages.push(res.assistantMessage);

                if (res.quota && res.quota.remaining <= 10) {
                    showToast?.(`${res.quota.remaining} chat messages remaining today.`, 'info');
                }

                renderDetail();
            } catch (err) {
                console.error('[CRM Books] Chat error:', err);
                messages.pop();
                messages.pop();

                const errorCode = err?.error || err?.code || '';
                if (errorCode === 'QUOTA_EXHAUSTED') {
                    showToast?.('Daily chat limit reached. Resets tomorrow.', 'error');
                } else {
                    showToast?.('Failed to get a response. Your message is still in the box — try again.', 'error');
                }
                renderDetail();
                const retryInput = qs('.crm-books-composer-input');
                if (retryInput && errorCode !== 'QUOTA_EXHAUSTED') retryInput.value = text;
            } finally {
                chatInFlight = false;
                liveInput = qs('.crm-books-composer-input');
                liveSendBtn = qs('.crm-books-send-btn');
                if (liveInput) liveInput.disabled = false;
                if (liveSendBtn) liveSendBtn.disabled = false;
            }
        }

        function updateLoadingIndicator(stage) {
            const loadingEl = qs('.crm-books-msg-loading');
            if (loadingEl) {
                loadingEl.textContent = stage;
            }
        }

        // --- Event binding ---
        function bindEvents() {
            if (bound || !panel) return;
            bound = true;

            panel.addEventListener('click', async (e) => {
                const target = e.target.closest('[data-book-id]');
                if (target) {
                    const bookId = target.dataset.bookId;
                    if (target.classList.contains('crm-books-delete-btn')) {
                        e.stopPropagation();
                        await deleteBook(bookId);
                        return;
                    }
                    if (target.classList.contains('crm-books-retry-btn')) {
                        e.stopPropagation();
                        await retryIngest(bookId);
                        return;
                    }
                    if (target.classList.contains('crm-books-reupload-btn')) {
                        e.stopPropagation();
                        openAddBookModal();
                        return;
                    }
                    if (target.classList.contains('crm-books-list-item')) {
                        await selectBook(bookId);
                        return;
                    }
                }

                const tab = e.target.closest('[data-books-tab]');
                if (tab) {
                    activeTab = tab.dataset.booksTab;
                    renderDetail();
                    if (activeTab === 'chat' && threads.length === 0 && selectedBook?.status === 'ready') {
                        loadThreads().catch(console.error);
                    }
                    return;
                }

                if (e.target.closest('.crm-books-add-btn')) {
                    openAddBookModal();
                    return;
                }

                if (e.target.closest('.crm-books-new-thread-btn')) {
                    await createThread();
                    return;
                }

                if (e.target.closest('.crm-books-send-btn')) {
                    const input = qs('.crm-books-composer-input');
                    const text = clean(input?.value);
                    if (text) {
                        await sendMessage(text);
                    }
                    return;
                }

                if (e.target.closest('.crm-books-starter-btn')) {
                    const text = clean(e.target.textContent);
                    if (text) await sendMessage(text);
                    return;
                }

                const citRef = e.target.closest('.crm-books-citation-ref');
                if (citRef) {
                    const idx = citRef.dataset.citationIdx;
                    const detail = panel.querySelector(`.crm-books-citation-detail[data-citation-idx="${idx}"]`);
                    if (detail) {
                        detail.style.display = detail.style.display === 'none' ? 'inline' : 'none';
                    }
                    return;
                }
            });

            panel.addEventListener('change', async (e) => {
                if (e.target.classList.contains('crm-books-thread-select')) {
                    selectedThreadId = clean(e.target.value);
                    await loadMessages();
                    renderDetail();
                }
            });

            panel.addEventListener('keydown', (e) => {
                if (e.target.classList.contains('crm-books-composer-input') && e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    const text = clean(e.target.value);
                    if (text) sendMessage(text);
                }
            });
        }

        // --- Lifecycle ---
        async function init() {
            bindEvents();
            await refresh();
        }

        function dispose() {
            detachSnapshot();
            if (uploadTask) {
                try { uploadTask.cancel(); } catch (_ignored) {
                    // Ignore cancel error if upload task is already completed or cancelled
                }
                uploadTask = null;
            }
        }

        function activateWithBookId(bookId) {
            if (bookId && bookId !== selectedBookId) {
                selectBook(bookId).catch(console.error);
            } else {
                refresh().catch(console.error);
            }
        }

        return {
            init,
            activate: activateWithBookId,
            refresh,
            dispose,
            selectBook,
            sendMessage
        };
    }

    return {
        createController,
        normalizeBooks,
        buildIngestLabel,
        formatEta,
        renderCitations,
        ingestWeightedPercent
    };
})();
