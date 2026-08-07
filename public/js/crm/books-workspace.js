window.CrmBooksWorkspace = (function () {
    'use strict';

    // ─── SVG Icon Constants ───
    const ICON_BOOK = '<svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/></svg>';
    const ICON_TRASH = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>';
    const ICON_PLUS = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>';
    const ICON_SEND = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>';
    const ICON_CLOSE = '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';
    const ICON_ERROR = '<svg viewBox="0 0 24 24" width="40" height="40" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>';
    const ICON_UPLOAD = '<svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/></svg>';
    const ICON_DOC = '<svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>';

    function fallbackEscapeHtml(value) {
        const div = document.createElement('div');
        div.textContent = String(value ?? '');
        return div.innerHTML;
    }

    function clean(value) {
        return String(value ?? '').trim();
    }

    const AUTO_THREAD_TITLE_LENGTH = 72;
    const MAX_THREAD_TITLE_LENGTH = 120;

    function normalizeCitationText(value) {
        return String(value ?? '')
            .normalize('NFKC')
            .replace(/[\u2018\u2019]/g, "'")
            .replace(/[\u201C\u201D]/g, '"')
            .replace(/[\u2013\u2014]/g, '-')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }

    function deriveThreadTitle(question) {
        const normalized = String(question ?? '').replace(/\s+/g, ' ').trim();
        if (normalized.length <= AUTO_THREAD_TITLE_LENGTH) return normalized;
        return `${normalized.slice(0, AUTO_THREAD_TITLE_LENGTH - 1).trimEnd()}…`;
    }

    function reflowPageText(text) {
        const source = String(text ?? '').replace(/\r\n?/g, '\n').trim();
        if (!source) return '';
        return source
            .split(/\n\s*\n/)
            .map((block) => {
                const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
                let output = '';
                lines.forEach((line) => {
                    if (!output) {
                        output = line;
                        return;
                    }
                    const previous = output.slice(-1);
                    if (previous === '-' && /^[\p{L}\p{N}]/u.test(line)) {
                        output = output.slice(0, -1) + line;
                    } else {
                        output += ` ${line}`;
                    }
                });
                return output;
            })
            .filter(Boolean)
            .join('\n\n');
    }

    function normalizeWithSourceMap(value) {
        const source = String(value ?? '');
        let normalized = '';
        const sourceIndexes = [];
        let pendingSpace = false;

        for (let i = 0; i < source.length; i += 1) {
            const char = source[i];
            if (/\s/.test(char)) {
                if (normalized && !pendingSpace) {
                    pendingSpace = true;
                }
                continue;
            }

            if (pendingSpace) {
                normalized += ' ';
                sourceIndexes.push(i - 1);
                pendingSpace = false;
            }

            const canonical = char
                .normalize('NFKC')
                .replace(/[\u2018\u2019]/g, "'")
                .replace(/[\u201C\u201D]/g, '"')
                .replace(/[\u2013\u2014]/g, '-')
                .toLowerCase();
            normalized += canonical;
            for (let offset = 0; offset < canonical.length; offset += 1) sourceIndexes.push(i);
        }

        return { normalized, sourceIndexes };
    }

    function findCitationMatch(pageText, quote) {
        const target = normalizeCitationText(quote);
        if (!target) return null;
        const mapped = normalizeWithSourceMap(pageText);
        const normalizedTarget = normalizeCitationText(target);
        const start = mapped.normalized.indexOf(normalizedTarget);
        if (start < 0) return null;
        const endIndex = start + normalizedTarget.length - 1;
        const startOffset = mapped.sourceIndexes[start];
        const endOffset = mapped.sourceIndexes[endIndex];
        if (startOffset == null || endOffset == null) return null;
        return { start: startOffset, end: endOffset + 1 };
    }

    function highlightPageText(pageText, quote, escHtml = fallbackEscapeHtml) {
        const text = String(pageText ?? '');
        const match = findCitationMatch(text, quote);
        if (!match) return { html: escHtml(text), matched: false };
        return {
            html: `${escHtml(text.slice(0, match.start))}<mark class="crm-books-citation-highlight">${escHtml(text.slice(match.start, match.end))}</mark>${escHtml(text.slice(match.end))}`,
            matched: true
        };
    }

    function citationMarker(citation, fallbackIndex = 0) {
        const raw = clean(citation?.marker).toUpperCase();
        return /^C\d+$/.test(raw) ? raw : `C${fallbackIndex + 1}`;
    }

    function citationNumber(citation, fallbackIndex = 0) {
        const marker = citationMarker(citation, fallbackIndex);
        return Number(marker.slice(1)) || fallbackIndex + 1;
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
            const errRaw = ingest.error;
            const rawError = (typeof errRaw === 'string') ? clean(errRaw)
                : clean(errRaw?.message) || clean(errRaw?.code) || '';
            const codeMatch = rawError.match(/^\[([A-Z_]+)\]/);
            const code = codeMatch ? codeMatch[1]
                : (typeof errRaw === 'object' ? clean(errRaw?.code) : '');
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
        return `<div class="crm-books-msg-citations">${citations.map((c, i) => {
            const marker = citationMarker(c, i);
            const num = citationNumber(c, i);
            const pages = c.pageStart === c.pageEnd
                ? `p. ${c.pageStart}`
                : `pp. ${c.pageStart}\u2013${c.pageEnd}`;
            const snippet = escHtml(clean(c.snippet || c.highlightText).slice(0, 240));
            return `<span class="crm-books-citation-wrap" data-citation-marker="${escHtml(marker)}">` +
                `<button type="button" class="crm-books-citation-ref" data-citation-marker="${escHtml(marker)}" title="Open ${escHtml(pages)}" aria-label="Open citation ${num}, ${escHtml(pages)}">${num}</button>` +
                `<span class="crm-books-citation-preview" role="tooltip">` +
                `<span class="crm-books-citation-pages">${escHtml(pages)}</span>` +
                `<span class="crm-books-citation-snippet">${snippet}</span>` +
                `</span></span>`;
        }).join('')}</div>`;
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

    function extractTitleAndAuthorFromFileName(filename) {
        if (!filename) return { title: '', author: '' };

        let name = String(filename || '').trim();
        name = name.replace(/\.[^/.]+$/, '');
        name = name.replace(/[-_]\d{8,14}$/, '');
        name = name.replace(/\s*\(\d+\)$/, '');

        let title = '';
        let author = '';

        if (/\s+by\s+/i.test(name)) {
            const parts = name.split(/\s+by\s+/i);
            title = parts[0];
            author = parts.slice(1).join(' by ');
        } else if (name.includes(' - ')) {
            const parts = name.split(' - ');
            author = parts[0];
            title = parts.slice(1).join(' - ');
        } else if (name.includes('_-_')) {
            const parts = name.split('_-_');
            author = parts[0];
            title = parts.slice(1).join(' - ');
        } else {
            title = name;
        }

        const formatSegment = (str) => {
            if (!str) return '';
            const s = str.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
            if (!s) return '';
            if (s === s.toLowerCase() || s === s.toUpperCase()) {
                return s.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase());
            }
            return s;
        };

        return {
            title: formatSegment(title),
            author: formatSegment(author)
        };
    }

    function extractPdfMetadata(file) {
        return new Promise((resolve) => {
            if (!file || !file.slice) return resolve({ title: '', author: '' });
            const reader = new FileReader();
            reader.onload = () => {
                try {
                    const text = String(reader.result || '');
                    let title = '';
                    let author = '';

                    const titleMatch = text.match(/\/Title\s*\(([^)]+)\)/i);
                    if (titleMatch && titleMatch[1]) {
                        title = titleMatch[1].replace(/\\([()\\])/g, '$1').trim();
                    }
                    const authorMatch = text.match(/\/Author\s*\(([^)]+)\)/i);
                    if (authorMatch && authorMatch[1]) {
                        author = authorMatch[1].replace(/\\([()\\])/g, '$1').trim();
                    }
                    resolve({ title, author });
                } catch (_) {
                    resolve({ title: '', author: '' });
                }
            };
            reader.onerror = () => resolve({ title: '', author: '' });
            reader.readAsText(file.slice(0, 16384), 'latin1');
        });
    }

    // ─── Controller ───
    function createController(deps = {}) {
        const elements = deps.elements || {};
        const showToast = typeof deps.showToast === 'function' ? deps.showToast : null;
        const apiFetchJson = typeof deps.apiFetchJson === 'function' ? deps.apiFetchJson : null;
        const escapeHtml = typeof deps.escapeHtml === 'function' ? deps.escapeHtml : fallbackEscapeHtml;
        const formatDateTime = typeof deps.formatDateTime === 'function' ? deps.formatDateTime : (v) => clean(v) || '-'; // Reserved — kept for controller interface contract
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
        let searchQuery = '';
        let collapsedOutline = {};
        let currentPage = 1;
        let pagesData = null;
        let activeCitation = null;
        let pageNotice = '';
        let editingThreadId = '';
        let editingThreadTitle = '';
        let usageData = null;

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

        async function apiPatch(path, body) {
            if (!apiFetchJson) throw new Error('No API client');
            return apiFetchJson(path, { method: 'PATCH', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
        }

        async function apiDelete(path) {
            if (!apiFetchJson) throw new Error('No API client');
            return apiFetchJson(path, { method: 'DELETE' });
        }

        // --- Render: Sources Panel (left) ---
        function renderSourcesPanel() {
            const list = qs('.crm-books-list');
            const countBadge = qs('.crm-books-sources-count');
            if (!list) return;

            const filtered = searchQuery
                ? books.filter((b) => b.title.toLowerCase().includes(searchQuery.toLowerCase()) || b.author.toLowerCase().includes(searchQuery.toLowerCase()))
                : books;

            if (countBadge) countBadge.textContent = String(books.length);

            if (filtered.length === 0) {
                list.innerHTML = `<li class="crm-books-empty-item">${books.length === 0 ? 'No books yet. Add a source to get started.' : 'No matching books.'}</li>`;
                return;
            }
            list.innerHTML = filtered.map((b) => {
                const isSelected = b.bookId === selectedBookId;
                const statusIcon = b.status === 'ready' ? '<span class="crm-books-status-icon ready" title="Ready">&#10003;</span>'
                    : b.status === 'failed' ? '<span class="crm-books-status-icon failed" title="Failed">&#9888;</span>'
                        : '';
                const ingestLine = (b.status !== 'ready' && b.status !== 'awaiting_upload')
                    ? `<div class="crm-books-ingest-line"><div class="crm-books-progress-bar"><div class="crm-books-progress-fill" style="width:${ingestWeightedPercent(b.ingest, b.status)}%"></div></div><span class="crm-books-list-stage">${escapeHtml(buildIngestLabel(b.ingest, b.status))}</span></div>`
                    : b.status === 'awaiting_upload'
                        ? `<div class="crm-books-ingest-line"><span class="crm-books-list-stage">Upload incomplete</span></div>`
                        : '';
                return `<li class="crm-books-list-item${isSelected ? ' selected' : ''}" data-book-id="${escapeHtml(b.bookId)}">` +
                    `<div class="crm-books-list-item-header"><span class="crm-books-list-title">${escapeHtml(b.title)}</span>${statusIcon}</div>` +
                    `<div class="crm-books-list-author">${escapeHtml(b.author || '')}</div>` +
                    ingestLine +
                    `</li>`;
            }).join('');
        }

        // --- Render: Explorer Panel (center) ---
        function renderExplorerPanel() {
            const detail = qs('.crm-books-detail');
            if (!detail) return;

            if (!selectedBook) {
                detail.innerHTML = `<div class="crm-books-empty-detail">` +
                    `<div class="crm-books-empty-icon">${ICON_BOOK}</div>` +
                    `<h3 style="margin:12px 0 6px; font-weight:600;">Select a book</h3>` +
                    `<p class="crm-muted">Choose a source from the library to explore its summary, chat, or pages.</p>` +
                    `</div>`;
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
                    `<button class="crm-books-tab${activeTab === 'history' ? ' active' : ''}" data-books-tab="history">Chat History</button>` +
                    `<button class="crm-books-tab${activeTab === 'pages' ? ' active' : ''}" data-books-tab="pages">Pages</button>` +
                    `<button class="crm-books-tab${activeTab === 'notes' ? ' active' : ''}" data-books-tab="notes">Notes</button>` +
                    `</div>`;
                contentHtml = renderTabContent();
            } else if (b.status === 'failed') {
                contentHtml = renderFailedState(b);
            } else if (b.status === 'awaiting_upload') {
                contentHtml = renderAwaitingUpload(b);
            } else {
                contentHtml = renderProcessingState(b);
            }

            const isDark = panel?.classList.contains('books-dark');
            const darkIcon = isDark
                ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zM2 13h2c.55 0 1-.45 1-1s-.45-1-1-1H2c-.55 0-1 .45-1 1s.45 1 1 1zm18 0h2c.55 0 1-.45 1-1s-.45-1-1-1h-2c-.55 0-1 .45-1 1s.45 1 1 1zM11 2v2c0 .55.45 1 1 1s1-.45 1-1V2c0-.55-.45-1-1-1s-1 .45-1 1zm0 18v2c0 .55.45 1 1 1s1-.45 1-1v-2c0-.55-.45-1-1-1s-1 .45-1 1zM5.99 4.58a.996.996 0 00-1.41 0 .996.996 0 000 1.41l1.06 1.06c.39.39 1.03.39 1.41 0s.39-1.03 0-1.41L5.99 4.58zm12.37 12.37a.996.996 0 00-1.41 0 .996.996 0 000 1.41l1.06 1.06c.39.39 1.03.39 1.41 0a.996.996 0 000-1.41l-1.06-1.06zm1.06-10.96a.996.996 0 000-1.41.996.996 0 00-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06zM7.05 18.36a.996.996 0 000-1.41.996.996 0 00-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06z"/></svg>'
                : '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 3a9 9 0 109 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 01-4.4 2.26 5.403 5.403 0 01-3.14-9.8c-.44-.06-.9-.1-1.36-.1z"/></svg>';
            const usageHtml = renderUsageIndicator();
            const headerHtml = `<div class="crm-books-explorer-header">` +
                `<button class="crm-books-sources-toggle" title="Toggle sources panel"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/></svg></button>` +
                `<div class="crm-books-explorer-title-group">` +
                `<h3 class="crm-books-explorer-title">${escapeHtml(b.title)}</h3>` +
                `<p class="crm-books-explorer-meta">${[escapeHtml(b.author), pageLabel].filter(Boolean).join(' \u00b7 ')}</p>` +
                `</div>` +
                usageHtml +
                `<button class="crm-books-dark-toggle" title="Toggle dark mode">${darkIcon}</button>` +
                `<button class="crm-books-delete-btn" data-book-id="${escapeHtml(b.bookId)}" title="Delete this book">${ICON_TRASH}</button>` +
                `</div>`;

            const budgetHtml = renderBudgetBanner();
            detail.innerHTML = headerHtml + tabsHtml + budgetHtml +
                `<div class="crm-books-tab-body${activeTab === 'chat' ? ' chat-active' : ''}">${contentHtml}</div>`;

            // Auto-scroll chat to bottom
            if (activeTab === 'chat') {
                const msgContainer = detail.querySelector('.crm-books-chat-messages');
                if (msgContainer) {
                    requestAnimationFrame(() => { msgContainer.scrollTop = msgContainer.scrollHeight; });
                }
            }
        }

        // --- Combined render ---
        function renderAll() {
            renderSourcesPanel();
            renderExplorerPanel();
        }


        // --- Tab content ---
        function renderTabContent() {
            if (activeTab === 'summary') return renderSummaryTab();
            if (activeTab === 'chat') return renderChatTab();
            if (activeTab === 'history') return renderHistoryTab();
            if (activeTab === 'pages') return renderPagesTab();
            if (activeTab === 'notes') return renderNotesTab();
            return '';
        }

        function renderSummaryTab() {
            if (!selectedSummary) return '<div class="crm-books-summary-empty"><p class="crm-muted">No summary available yet.</p></div>';
            const s = selectedSummary;
            let html = '';

            // One-liner
            if (s.oneLiner) {
                html += `<div class="crm-books-section-card">` +
                    `<p class="crm-books-one-liner">${escapeHtml(s.oneLiner)}</p>` +
                    `</div>`;
            }

            // Overview
            if (s.overview) {
                html += `<div class="crm-books-section-card">` +
                    `<h4 class="crm-books-section-title">Overview</h4>` +
                    `<div class="crm-books-overview"><p>${escapeHtml(s.overview).replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</p></div>` +
                    `</div>`;
            }

            // Audience
            if (s.audience) {
                html += `<div class="crm-books-section-card" data-section="audience">` +
                    `<h4 class="crm-books-section-title">Target Audience</h4>` +
                    `<p class="crm-books-audience-text">${escapeHtml(s.audience)}</p>` +
                    `</div>`;
            }

            // Key Topics
            if (Array.isArray(s.keyTopics) && s.keyTopics.length > 0) {
                html += `<div class="crm-books-section-card" data-section="topics">` +
                    `<h4 class="crm-books-section-title">Key Topics</h4>` +
                    `<div class="crm-books-topics">${s.keyTopics.map((t) =>
                        `<button class="crm-books-topic-chip" data-topic="${escapeHtml(t.topic)}">${escapeHtml(t.topic)}${t.pages?.length ? ` <span class="crm-books-topic-pages">p. ${escapeHtml(String(t.pages.join(', ')))}</span>` : ''}</button>`
                    ).join('')}</div>` +
                    `</div>`;
            }

            // Outline
            if (Array.isArray(s.outline) && s.outline.length > 0) {
                html += `<div class="crm-books-section-card" data-section="outline">` +
                    `<h4 class="crm-books-section-title">Outline</h4>` +
                    renderOutline(s.outline) +
                    `</div>`;
            }

            return html || '<div class="crm-books-summary-empty"><p class="crm-muted">Summary is empty.</p></div>';
        }

        function renderOutline(items, depth = 0) {
            if (!Array.isArray(items) || items.length === 0) return '';
            return `<ol class="crm-books-outline${depth > 0 ? ' crm-books-outline-nested' : ''}">` +
                items.map((item, idx) => {
                    const key = `${depth}-${idx}`;
                    const isCollapsed = collapsedOutline[key];
                    const hasChildren = Array.isArray(item.children) && item.children.length > 0;
                    const pages = item.pageStart != null && item.pageEnd != null
                        ? ` <span class="crm-books-outline-pages">pp. ${escapeHtml(String(item.pageStart))}\u2013${escapeHtml(String(item.pageEnd))}</span>` : '';
                    const summary = item.summary ? `<p class="crm-books-outline-summary">${escapeHtml(item.summary)}</p>` : '';
                    const toggleBtn = hasChildren
                        ? `<button class="crm-books-outline-toggle" data-outline-key="${key}">${isCollapsed ? '\u25b6' : '\u25bc'}</button>`
                        : '<span class="crm-books-outline-toggle-spacer"></span>';
                    const children = (hasChildren && !isCollapsed) ? renderOutline(item.children, depth + 1) : '';
                    return `<li>${toggleBtn}<strong>${escapeHtml(item.title || '')}</strong>${pages}${summary}${children}</li>`;
                }).join('') +
                `</ol>`;
        }

        function renderChatTab() {
            let messagesHtml = '';
            if (messages.length === 0) {
                const starters = buildStarterQuestions();
                messagesHtml = `<div class="crm-books-chat-starters">` +
                    `<p class="crm-books-starters-label">Ask a question about this book, or try one of these:</p>` +
                    `<div class="crm-books-starters-grid">${starters.map((q) => `<button class="crm-books-starter-btn">${escapeHtml(q)}</button>`).join('')}</div>` +
                    `</div>`;
            } else {
                messagesHtml = `<div class="crm-books-chat-messages">${messages.map(renderMessage).join('')}</div>`;
            }

            const activeThread = threads.find((thread) => thread.threadId === selectedThreadId) || null;
            const titleHtml = activeThread
                ? renderThreadTitle(activeThread)
                : `<div class="crm-books-chat-draft-title"><span class="crm-books-chat-draft-label">New chat</span><span class="crm-books-chat-draft-hint">Your first question will start a thread.</span></div>`;

            return `<div class="crm-books-chat-header">` +
                `<div class="crm-books-chat-header-left">${titleHtml}</div>` +
                `<button class="crm-books-new-chat-btn crm-books-new-thread-btn" title="Start a new chat">${ICON_PLUS} New chat</button>` +
                `</div>` +
                messagesHtml +
                `<div class="crm-books-composer">` +
                `<textarea class="crm-books-composer-input" placeholder="Ask about the book\u2026" rows="1"></textarea>` +
                `<button class="crm-books-send-btn" title="Send">${ICON_SEND}</button>` +
                `</div>`;
        }

        function renderThreadTitle(thread) {
            if (!thread) return '';
            if (editingThreadId === thread.threadId) {
                return `<form class="crm-books-thread-title-editor" data-thread-id="${escapeHtml(thread.threadId)}">` +
                    `<label class="crm-books-sr-only" for="crm-books-thread-title-input">Thread name</label>` +
                    `<input id="crm-books-thread-title-input" class="crm-books-thread-title-input" type="text" maxlength="${MAX_THREAD_TITLE_LENGTH}" value="${escapeHtml(editingThreadTitle)}" autocomplete="off">` +
                    `<button type="submit" class="crm-books-thread-title-save">Save</button>` +
                    `<button type="button" class="crm-books-thread-title-cancel">Cancel</button>` +
                    `</form>`;
            }
            return `<div class="crm-books-thread-title-view">` +
                `<span class="crm-books-thread-title-text">${escapeHtml(thread.title || 'Untitled chat')}</span>` +
                `<button type="button" class="crm-books-thread-rename-btn" data-thread-id="${escapeHtml(thread.threadId)}" aria-label="Edit thread name" title="Edit thread name">✎</button>` +
                `</div>`;
        }

        function renderHistoryTab() {
            const newChatButton = `<button class="crm-books-new-chat-btn crm-books-history-new-chat" title="Start a new chat">${ICON_PLUS} New chat</button>`;
            if (threads.length === 0) {
                return `<section class="crm-books-history" aria-labelledby="crm-books-history-title">` +
                    `<div class="crm-books-history-header"><div><h4 id="crm-books-history-title">Chat History</h4><p>Saved conversations about this book.</p></div>${newChatButton}</div>` +
                    `<div class="crm-books-history-empty"><p>No saved chats yet.</p><p>Ask your first question from the Chat tab to create one.</p></div>` +
                    `</section>`;
            }

            const rows = threads.map((thread) => {
                const updated = thread.updatedAt ? new Date(thread.updatedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'No activity yet';
                if (editingThreadId === thread.threadId) {
                    return `<div class="crm-books-history-row editing" data-thread-id="${escapeHtml(thread.threadId)}">` +
                        `<div class="crm-books-history-row-editor">${renderThreadTitle(thread)}</div>` +
                        `<div class="crm-books-history-meta">${thread.messageCount || 0} messages · ${escapeHtml(updated)}</div>` +
                        `</div>`;
                }
                return `<div class="crm-books-history-row${thread.threadId === selectedThreadId ? ' selected' : ''}" data-thread-id="${escapeHtml(thread.threadId)}">` +
                    `<button type="button" class="crm-books-history-open" data-history-thread-id="${escapeHtml(thread.threadId)}">` +
                    `<span class="crm-books-history-row-title">${escapeHtml(thread.title || 'Untitled chat')}</span>` +
                    `<span class="crm-books-history-meta">${thread.messageCount || 0} messages · ${escapeHtml(updated)}</span>` +
                    `</button>` +
                    `<button type="button" class="crm-books-thread-rename-btn crm-books-history-rename-btn" data-thread-id="${escapeHtml(thread.threadId)}" aria-label="Edit thread name" title="Edit thread name">✎</button>` +
                    `</div>`;
            }).join('');

            return `<section class="crm-books-history" aria-labelledby="crm-books-history-title">` +
                `<div class="crm-books-history-header"><div><h4 id="crm-books-history-title">Chat History</h4><p>${threads.length} saved conversation${threads.length === 1 ? '' : 's'} about this book.</p></div>${newChatButton}</div>` +
                `<div class="crm-books-history-list">${rows}</div>` +
                `</section>`;
        }

        function renderMessage(msg) {
            const isUser = msg.role === 'user';
            const cls = isUser ? 'crm-books-msg-user' : 'crm-books-msg-assistant';

            if (msg._loading) {
                return `<div class="crm-books-msg ${cls}">` +
                    `<div class="crm-books-msg-text crm-books-msg-loading">` +
                    `<span class="crm-books-typing-indicator"><span></span><span></span><span></span></span> Searching the book\u2026` +
                    `</div></div>`;
            }

            const answered = msg.answered !== false;
            const textCls = answered ? '' : ' crm-books-msg-unanswered';
            const citationsHtml = !isUser && msg.citations?.length > 0
                ? renderCitations(msg.citations, escapeHtml) : '';
            const saveBtn = !isUser && msg.text
                ? `<div class="crm-books-msg-actions"><button class="crm-books-msg-save-btn" title="Save to Notes"><svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M17 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm2 16H5V5h11.17L19 7.83V19zm-7-7c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3zM6 6h9v4H6z"/></svg> Save</button></div>` : '';
            return `<div class="crm-books-msg ${cls}${textCls}">` +
                `<div class="crm-books-msg-text">${isUser ? escapeHtml(msg.text || '') : formatMessageText(msg.text || '', msg.citations, escapeHtml)}</div>` +
                citationsHtml +
                saveBtn +
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

        function renderPagesTab() {
            if (!pagesData) {
                loadPagesMetadata();
                return `<div class="crm-books-pages-placeholder">` +
                    `<div class="crm-books-empty-icon" style="margin-bottom:12px;">${ICON_DOC}</div>` +
                    `<p class="crm-muted">Loading pages…</p></div>`;
            }
            if (pagesData.totalPages === 0) {
                return `<div class="crm-books-pages-placeholder">` +
                    `<div class="crm-books-empty-icon" style="margin-bottom:12px;">${ICON_DOC}</div>` +
                    `<h4>No Pages</h4><p class="crm-muted">Page data is not available for this book.</p></div>`;
            }
            const pageText = pagesData.pages?.[currentPage - 1] ?? '';
            const prevDisabled = currentPage <= 1 ? ' disabled' : '';
            const nextDisabled = currentPage >= pagesData.totalPages ? ' disabled' : '';
            const readingText = reflowPageText(pageText);
            const highlight = activeCitation?.page === currentPage
                ? highlightPageText(readingText, activeCitation.quote, escapeHtml)
                : { html: escapeHtml(readingText), matched: false };
            return `<div class="crm-books-pages-nav">` +
                `<button class="crm-books-page-prev"${prevDisabled}>← Prev</button>` +
                `<span class="crm-books-pages-indicator">Page <input type="number" class="crm-books-page-input" value="${currentPage}" min="1" max="${pagesData.totalPages}"> of ${pagesData.totalPages}</span>` +
                `<button class="crm-books-page-next"${nextDisabled}>Next →</button>` +
                `</div>` +
                `<div class="crm-books-reading-label">Reading view · extracted text</div>` +
                (pageNotice ? `<div class="crm-books-page-notice" role="status">${escapeHtml(pageNotice)}</div>` : '') +
                `<article class="crm-books-page-paper" tabindex="-1" aria-label="Reading view page ${currentPage} of ${pagesData.totalPages}">` +
                `<div class="crm-books-page-content">${highlight.html}</div>` +
                `</article>`;
        }

        async function loadPagesMetadata() {
            if (!selectedBookId || pagesData) return;
            try {
                const res = await apiGet(`/api/admin/books/${selectedBookId}/pages`);
                pagesData = res?.data || res;
                currentPage = 1;
                if (activeTab === 'pages') renderExplorerPanel();
            } catch (err) {
                console.error('[CRM Books] Failed to load pages:', err);
                pagesData = { totalPages: 0, pages: [] };
                if (activeTab === 'pages') renderExplorerPanel();
            }
        }

        function findMessageCitation(marker) {
            const target = clean(marker).toUpperCase();
            for (const message of messages) {
                if (message.role === 'user' || !Array.isArray(message.citations)) continue;
                for (let i = 0; i < message.citations.length; i += 1) {
                    const citation = message.citations[i];
                    if (citationMarker(citation, i) === target) return citation;
                }
            }
            return null;
        }

        function resetPageCitation() {
            activeCitation = null;
            pageNotice = '';
        }

        async function openCitation(marker) {
            const citation = findMessageCitation(marker);
            if (!citation || !selectedBookId) return;

            activeTab = 'pages';
            pageNotice = '';
            if (!pagesData) await loadPagesMetadata();
            if (!pagesData || pagesData.totalPages === 0) {
                pageNotice = 'The cited page text is unavailable.';
                renderExplorerPanel();
                return;
            }

            const startPage = Math.max(1, Math.min(Number(citation.pageStart) || 1, pagesData.totalPages));
            const endPage = Math.max(startPage, Math.min(Number(citation.pageEnd) || startPage, pagesData.totalPages));
            const quote = clean(citation.highlightText || citation.snippet);
            let matchedPage = null;
            for (let page = startPage; page <= endPage; page += 1) {
                const readingText = reflowPageText(pagesData.pages?.[page - 1] || '');
                if (quote && findCitationMatch(readingText, quote)) {
                    matchedPage = page;
                    break;
                }
            }

            currentPage = matchedPage || startPage;
            activeCitation = {
                marker: citationMarker(citation),
                page: currentPage,
                quote
            };
            pageNotice = matchedPage
                ? `Citation ${citationMarker(citation)} opened on page ${currentPage}.`
                : `Citation ${citationMarker(citation)} opened on page ${currentPage}; the exact passage is unavailable in this saved citation.`;
            renderExplorerPanel();

            requestAnimationFrame(() => {
                const page = qs('.crm-books-page-paper');
                const mark = page?.querySelector('mark.crm-books-citation-highlight');
                page?.focus({ preventScroll: true });
                mark?.scrollIntoView({ block: 'center', behavior: 'smooth' });
            });
        }

        function showCitationPreview(wrap) {
            const preview = wrap?.querySelector('.crm-books-citation-preview');
            const trigger = wrap?.querySelector('.crm-books-citation-ref');
            if (!preview || !trigger) return;
            preview.classList.add('visible');
            const rect = trigger.getBoundingClientRect();
            const viewportMargin = 12;
            const previewRect = preview.getBoundingClientRect();
            let left = rect.left;
            let top = rect.bottom + 8;
            if (left + previewRect.width > window.innerWidth - viewportMargin) {
                left = window.innerWidth - previewRect.width - viewportMargin;
            }
            if (top + previewRect.height > window.innerHeight - viewportMargin) {
                top = rect.top - previewRect.height - 8;
            }
            preview.style.left = `${Math.max(viewportMargin, left)}px`;
            preview.style.top = `${Math.max(viewportMargin, top)}px`;
        }

        function hideCitationPreview(wrap) {
            const preview = wrap?.querySelector('.crm-books-citation-preview');
            if (preview) preview.classList.remove('visible');
        }

        function loadBookNotes(bookId) {
            if (!bookId) return [];
            try {
                const raw = localStorage.getItem(`crm_books_notes_${bookId}`);
                return raw ? JSON.parse(raw) : [];
            } catch (_) {
                return [];
            }
        }

        function saveBookNote(bookId, text) {
            if (!bookId || !text) return;
            const notes = loadBookNotes(bookId);
            const newNote = {
                id: 'note_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
                text,
                savedAt: Date.now()
            };
            notes.unshift(newNote);
            try {
                localStorage.setItem(`crm_books_notes_${bookId}`, JSON.stringify(notes));
            } catch (e) {
                console.error('Failed to save book note:', e);
            }
        }

        function deleteBookNote(bookId, noteId) {
            if (!bookId || !noteId) return;
            let notes = loadBookNotes(bookId);
            notes = notes.filter(n => n.id !== noteId);
            try {
                localStorage.setItem(`crm_books_notes_${bookId}`, JSON.stringify(notes));
            } catch (e) {
                console.error('Failed to delete book note:', e);
            }
        }

        function formatMessageText(text, citations, escHtml) {
            if (!text) return '';
            let html = escHtml(text);

            const citationMap = new Map((Array.isArray(citations) ? citations : []).map((citation, index) => [
                citationMarker(citation, index), citation
            ]));

            html = html.replace(/\[C?(\d+)(?:\s*,\s*C?(\d+))*\]/gi, (match) => {
                const nums = match.match(/\d+/g);
                if (!nums || nums.length === 0) return match;

                const pills = nums.map((nStr) => {
                    const idx = parseInt(nStr, 10);
                    const marker = `C${idx}`;
                    const c = citationMap.get(marker) || (citations && citations[idx - 1]);
                    if (c) {
                        const pages = c.pageStart === c.pageEnd ? `p. ${c.pageStart}` : `pp. ${c.pageStart}\u2013${c.pageEnd}`;
                        const actualMarker = citationMarker(c, idx - 1);
                        return `<button type="button" class="crm-books-citation-ref crm-books-inline-citation" title="Open ${escHtml(pages)}" aria-label="Open citation ${idx}, ${escHtml(pages)}" data-citation-marker="${escHtml(actualMarker)}">${idx}</button>`;
                    }
                    return escHtml(nStr);
                });

                return pills.join(' ');
            });

            return html;
        }

        function renderNotesTab() {
            if (!selectedBookId) return '<div class="crm-books-notes-empty">Select a book first.</div>';
            const notes = loadBookNotes(selectedBookId);
            if (notes.length === 0) {
                return `<div class="crm-books-notes-empty">` +
                    `<p>No saved notes yet.</p>` +
                    `<p style="font-size:0.8rem; margin-top:8px; color:var(--books-text-muted);">Save interesting chat responses using the Save button on messages.</p>` +
                    `</div>`;
            }
            return `<div class="crm-books-notes-list">${notes.map((n) => {
                const timeStr = n.savedAt ? new Date(n.savedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
                return `<div class="crm-books-note-card" data-note-id="${escapeHtml(n.id)}">` +
                    `<div class="crm-books-note-card-text">${escapeHtml(n.text)}</div>` +
                    `<div class="crm-books-note-card-meta">` +
                    `<span>${escapeHtml(timeStr)}</span>` +
                    `<button class="crm-books-note-delete-btn" data-note-id="${escapeHtml(n.id)}" title="Remove note">&times;</button>` +
                    `</div></div>`;
            }).join('')}</div>`;
        }

        function renderUsageIndicator() {
            if (!usageData) return '';
            const pct = Math.min(100, Math.round((usageData.estimatedCostUsd / usageData.budgetLimitUsd) * 100));
            const colorCls = pct < 60 ? 'green' : pct < 90 ? 'yellow' : 'red';
            return `<div class="crm-books-usage-wrap">` +
                `<span class="crm-books-usage-label">$${usageData.estimatedCostUsd.toFixed(2)} / $${usageData.budgetLimitUsd.toFixed(2)}</span>` +
                `<div class="crm-books-usage-bar"><div class="crm-books-usage-fill ${colorCls}" style="width:${pct}%"></div></div>` +
                `</div>`;
        }

        function renderBudgetBanner() {
            if (!usageData || usageData.estimatedCostUsd < usageData.budgetLimitUsd || usageData.approved) return '';
            return `<div class="crm-books-budget-banner">` +
                `<span>Monthly AI budget ($${usageData.budgetLimitUsd.toFixed(2)}) exceeded.</span>` +
                `<input type="text" class="crm-books-approve-input" placeholder="Type approve">` +
                `<button class="crm-books-approve-btn">Confirm</button>` +
                `</div>`;
        }

        async function loadUsage() {
            try {
                const res = await apiGet('/api/admin/books/usage');
                usageData = res;
            } catch (_) {
                usageData = null;
            }
        }

        function renderFailedState(b) {
            const label = buildIngestLabel(b.ingest, b.status);
            const rawError = clean(b.ingest?.error);
            const codeMatch = rawError.match(/^\[([A-Z_]+)\]/);
            const code = codeMatch ? codeMatch[1] : clean(b.ingest?.error?.code);
            const nonRetryable = new Set(['SCANNED_PDF_NO_TEXT', 'PDF_PARSE_FAILED']);
            const canRetry = !nonRetryable.has(code);
            return `<div class="crm-books-state-notice">` +
                `<div class="crm-books-state-icon danger">${ICON_ERROR}</div>` +
                `<p class="crm-books-state-notice-title">Processing failed</p>` +
                `<p class="crm-muted">${escapeHtml(label)}</p>` +
                `<div class="crm-books-state-notice-actions">` +
                (canRetry ? `<button class="crm-books-retry-btn" data-book-id="${escapeHtml(b.bookId)}">Retry</button>` : '') +
                `<button class="crm-books-delete-btn danger" data-book-id="${escapeHtml(b.bookId)}">Remove</button>` +
                `</div></div>`;
        }

        function renderAwaitingUpload(b) {
            return `<div class="crm-books-state-notice">` +
                `<div class="crm-books-state-icon">${ICON_UPLOAD}</div>` +
                `<p class="crm-books-state-notice-title">Upload needed</p>` +
                `<p class="crm-muted">This book's PDF has not been uploaded yet.</p>` +
                `<div class="crm-books-state-notice-actions">` +
                `<button class="crm-books-reupload-btn" data-book-id="${escapeHtml(b.bookId)}">Upload PDF</button>` +
                `<button class="crm-books-delete-btn danger" data-book-id="${escapeHtml(b.bookId)}">Remove</button>` +
                `</div></div>`;
        }

        function renderProcessingState(b) {
            const percent = ingestWeightedPercent(b.ingest, b.status);
            const label = buildIngestLabel(b.ingest, b.status);
            const eta = formatEta(b.ingest);
            return `<div class="crm-books-state-notice">` +
                `<div class="crm-books-processing-ring">` +
                `<svg viewBox="0 0 48 48" width="56" height="56"><circle cx="24" cy="24" r="20" fill="none" stroke="#E8E2D9" stroke-width="3"/><circle cx="24" cy="24" r="20" fill="none" stroke="#B8860B" stroke-width="3" stroke-dasharray="${Math.round(125.6 * percent / 100)} 125.6" stroke-linecap="round" transform="rotate(-90 24 24)" style="transition:stroke-dasharray 0.5s;"/></svg>` +
                `<span class="crm-books-processing-pct">${percent}%</span>` +
                `</div>` +
                `<p class="crm-books-state-notice-title">Processing…</p>` +
                `<p class="crm-muted">${escapeHtml(label)}</p>` +
                (eta ? `<p class="crm-muted crm-books-eta">${escapeHtml(eta)}</p>` : '') +
                `</div>`;
        }

        // --- Data loading ---
        async function refresh() {
            try {
                const res = await apiGet('/api/admin/books');
                books = normalizeBooks(res.books);
                renderSourcesPanel();
                if (selectedBookId) {
                    selectedBook = books.find((b) => b.bookId === selectedBookId) || null;
                    if (selectedBook) {
                        renderExplorerPanel();
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
            collapsedOutline = {};
            pagesData = null;
            currentPage = 1;
            resetPageCitation();
            editingThreadId = '';
            editingThreadTitle = '';

            detachSnapshot();
            renderSourcesPanel();

            if (!selectedBook) {
                renderExplorerPanel();
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

            renderExplorerPanel();

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
                renderExplorerPanel();
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
                            renderExplorerPanel();
                        }
                        renderSourcesPanel();
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
                `<button class="crm-icon-btn crm-books-modal-close" title="Close">${ICON_CLOSE}</button>` +
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

            const fileInput = modal.querySelector('#crm-book-file');
            const titleInput = modal.querySelector('#crm-book-title');
            const authorInput = modal.querySelector('#crm-book-author');

            fileInput?.addEventListener('change', () => {
                const file = fileInput?.files?.[0];
                if (!file) return;

                const extracted = extractTitleAndAuthorFromFileName(file.name);
                if (extracted.title && !titleInput.value.trim()) {
                    titleInput.value = extracted.title;
                }
                if (extracted.author && !authorInput.value.trim()) {
                    authorInput.value = extracted.author;
                }

                extractPdfMetadata(file).then((meta) => {
                    if (meta.title && (!titleInput.value || titleInput.value === extracted.title)) {
                        titleInput.value = meta.title;
                    }
                    if (meta.author && !authorInput.value) {
                        authorInput.value = meta.author;
                    }
                }).catch(() => {});
            });

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
                    renderSourcesPanel();

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
                                renderListTimer = setTimeout(() => { renderListTimer = null; renderSourcesPanel(); }, 250);
                            }
                            if (selectedBookId === bookId) {
                                selectedBook = books[idx];
                                renderExplorerPanel();
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
                            renderSourcesPanel();
                            if (selectedBookId === bookId) { selectedBook = books[idx]; renderExplorerPanel(); }
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
                renderAll();
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

        async function createThread(title = 'New thread') {
            if (!selectedBookId) return null;
            try {
                const threadTitle = clean(title) || 'New thread';
                const res = await apiPost(`/api/admin/books/${selectedBookId}/threads`, { title: threadTitle });
                if (res.threadId) {
                    selectedThreadId = res.threadId;
                    messages = [];
                    threads = [
                        { threadId: res.threadId, title: res.title || threadTitle, messageCount: 0, createdAt: new Date(), updatedAt: new Date() },
                        ...threads.filter((thread) => thread.threadId !== res.threadId)
                    ];
                    renderExplorerPanel();
                }
                return res;
            } catch (err) {
                console.error('[CRM Books] Create thread error:', err);
                showToast?.('Failed to create thread.', 'error');
                return null;
            }
        }

        function startNewChat() {
            selectedThreadId = '';
            messages = [];
            editingThreadId = '';
            editingThreadTitle = '';
            activeTab = 'chat';
            resetPageCitation();
            renderExplorerPanel();
            requestAnimationFrame(() => qs('.crm-books-composer-input')?.focus());
        }

        function beginThreadRename(threadId) {
            const thread = threads.find((item) => item.threadId === threadId);
            if (!thread) return;
            editingThreadId = threadId;
            editingThreadTitle = thread.title || '';
            renderExplorerPanel();
            requestAnimationFrame(() => {
                const input = qs('.crm-books-thread-title-input');
                input?.focus();
                input?.select();
            });
        }

        function cancelThreadRename() {
            editingThreadId = '';
            editingThreadTitle = '';
            renderExplorerPanel();
        }

        async function saveThreadTitle() {
            const threadId = editingThreadId;
            if (!threadId) return;
            const input = qs('.crm-books-thread-title-input');
            const title = clean(input?.value ?? editingThreadTitle);
            if (!title || title.length > MAX_THREAD_TITLE_LENGTH) {
                showToast?.(`Thread name must be between 1 and ${MAX_THREAD_TITLE_LENGTH} characters.`, 'error');
                input?.focus();
                return;
            }
            try {
                const res = await apiPatch(`/api/admin/books/${selectedBookId}/threads/${threadId}`, { title });
                const savedTitle = res.thread?.title || title;
                threads = threads.map((thread) => thread.threadId === threadId ? { ...thread, title: savedTitle } : thread);
                editingThreadId = '';
                editingThreadTitle = '';
                renderExplorerPanel();
                showToast?.('Thread renamed.', 'info');
            } catch (err) {
                console.error('[CRM Books] Rename thread error:', err);
                showToast?.(err?.message || 'Failed to rename thread.', 'error');
            }
        }

        let chatInFlight = false;

        async function sendMessage(text) {
            if (!selectedBookId || chatInFlight) return;
            if (!text || text.length < 2) return;

            chatInFlight = true;

            if (!selectedThreadId) {
                try {
                    const res = await createThread(deriveThreadTitle(text));
                    if (!res?.threadId) throw new Error('Thread creation failed.');
                } catch (err) {
                    chatInFlight = false;
                    console.error('[CRM Books] Auto-create thread failed:', err);
                    showToast?.('Could not start a new conversation.', 'error');
                    return;
                }
            }

            messages.push({ role: 'user', text, citations: [] });
            messages.push({ role: 'assistant', text: '', citations: [], _loading: true });
            renderExplorerPanel();

            let liveInput = qs('.crm-books-composer-input');
            let liveSendBtn = qs('.crm-books-send-btn');
            if (liveSendBtn) liveSendBtn.disabled = true;
            if (liveInput) { liveInput.value = ''; liveInput.disabled = true; }

            try {
                const res = await apiPost(
                    `/api/admin/books/${selectedBookId}/threads/${selectedThreadId}/messages`,
                    { text }
                );

                messages.pop();
                messages.pop();

                if (res.userMessage) messages.push(res.userMessage);
                if (res.assistantMessage) messages.push(res.assistantMessage);

                threads = threads.map((thread) => thread.threadId === selectedThreadId
                    ? { ...thread, messageCount: (thread.messageCount || 0) + 2, updatedAt: new Date() }
                    : thread);

                if (res.quota && res.quota.remaining <= 10) {
                    showToast?.(`${res.quota.remaining} chat messages remaining today.`, 'info');
                }

                renderExplorerPanel();
            } catch (err) {
                console.error('[CRM Books] Chat error:', err);
                messages.pop();
                messages.pop();

                const errorCode = err?.error || err?.code || '';
                if (errorCode === 'QUOTA_EXHAUSTED') {
                    showToast?.('Daily chat limit reached. Resets tomorrow.', 'error');
                } else {
                    showToast?.('Failed to get a response. Your message is still in the box \u2014 try again.', 'error');
                }
                renderExplorerPanel();
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


        // --- Event binding ---
        function bindEvents() {
            if (bound || !panel) return;
            bound = true;

            // Search filter
            panel.addEventListener('input', (e) => {
                if (e.target.classList.contains('crm-books-search')) {
                    searchQuery = clean(e.target.value);
                    renderSourcesPanel();
                }
                // Auto-resize composer textarea
                if (e.target.classList.contains('crm-books-composer-input')) {
                    e.target.style.height = 'auto';
                    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
                }
            });

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
                        const book = books.find((b) => b.bookId === bookId);
                        if (!book) return;
                        const input = document.createElement('input');
                        input.type = 'file';
                        input.accept = 'application/pdf';
                        input.addEventListener('change', async () => {
                            const file = input.files?.[0];
                            if (!file) return;
                            if (file.size > 100 * 1024 * 1024) {
                                showToast?.('File must be under 100 MB.', 'error');
                                return;
                            }
                            const path = book.source?.storagePath || `crm-books/${bookId}/source.pdf`;
                            await startUpload(bookId, path, file);
                        });
                        input.click();
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
                    renderExplorerPanel();
                    if ((activeTab === 'chat' || activeTab === 'history') && threads.length === 0 && selectedBook?.status === 'ready') {
                        loadThreads().catch(console.error);
                    }
                    return;
                }

                if (e.target.closest('.crm-books-add-btn')) {
                    openAddBookModal();
                    return;
                }

                if (e.target.closest('.crm-books-new-chat-btn')) {
                    startNewChat();
                    return;
                }

                const historyOpen = e.target.closest('.crm-books-history-open');
                if (historyOpen) {
                    selectedThreadId = clean(historyOpen.dataset.historyThreadId);
                    activeTab = 'chat';
                    await loadMessages();
                    renderExplorerPanel();
                    return;
                }

                const renameButton = e.target.closest('.crm-books-thread-rename-btn');
                if (renameButton) {
                    beginThreadRename(clean(renameButton.dataset.threadId));
                    return;
                }

                if (e.target.closest('.crm-books-thread-title-cancel')) {
                    cancelThreadRename();
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
                    const text = clean(e.target.closest('.crm-books-starter-btn').textContent);
                    if (text) await sendMessage(text);
                    return;
                }

                // Topic chip → prefill chat
                const topicChip = e.target.closest('.crm-books-topic-chip');
                if (topicChip) {
                    const topic = topicChip.dataset.topic;
                    if (topic) {
                        activeTab = 'chat';
                        renderExplorerPanel();
                        if (threads.length === 0 && selectedBook?.status === 'ready') {
                            await loadThreads();
                        }
                        requestAnimationFrame(() => {
                            const input = qs('.crm-books-composer-input');
                            if (input) {
                                input.value = `What does the book say about ${topic.toLowerCase()}?`;
                                input.focus();
                            }
                        });
                    }
                    return;
                }

                // Save to notes
                const saveBtn = e.target.closest('.crm-books-msg-save-btn');
                if (saveBtn && selectedBookId) {
                    const msgEl = saveBtn.closest('.crm-books-msg');
                    if (msgEl) {
                        const answerText = msgEl.querySelector('.crm-books-msg-text')?.textContent || '';
                        let questionText = '';
                        let prev = msgEl.previousElementSibling;
                        while (prev) {
                            if (prev.classList.contains('crm-books-msg-user')) {
                                questionText = prev.querySelector('.crm-books-msg-text')?.textContent || '';
                                break;
                            }
                            prev = prev.previousElementSibling;
                        }

                        const fullNoteText = questionText.trim()
                            ? `Q: ${questionText.trim()}\n\nA: ${answerText.trim()}`
                            : answerText.trim();

                        saveBookNote(selectedBookId, fullNoteText);
                        showToast?.('Saved to notes.', 'info');
                        if (activeTab === 'notes') renderExplorerPanel();
                    }
                    return;
                }

                // Delete note
                const noteDeleteBtn = e.target.closest('.crm-books-note-delete');
                if (noteDeleteBtn && selectedBookId) {
                    const noteId = noteDeleteBtn.dataset.noteId;
                    if (noteId) {
                        deleteBookNote(selectedBookId, noteId);
                        renderExplorerPanel();
                    }
                    return;
                }

                const citationButton = e.target.closest('.crm-books-citation-ref[data-citation-marker]');
                if (citationButton) {
                    await openCitation(citationButton.dataset.citationMarker);
                    return;
                }

                // Outline toggle
                const outlineToggle = e.target.closest('.crm-books-outline-toggle');
                if (outlineToggle) {
                    const key = outlineToggle.dataset.outlineKey;
                    if (key) {
                        collapsedOutline[key] = !collapsedOutline[key];
                        renderExplorerPanel();
                    }
                    return;
                }
            });

            panel.addEventListener('submit', async (e) => {
                if (e.target.classList.contains('crm-books-thread-title-editor')) {
                    e.preventDefault();
                    await saveThreadTitle();
                }
            });

            panel.addEventListener('keydown', (e) => {
                if (e.target.classList.contains('crm-books-composer-input') && e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    const text = clean(e.target.value);
                    if (text) sendMessage(text);
                }
                if (e.target.classList.contains('crm-books-thread-title-input') && e.key === 'Escape') {
                    e.preventDefault();
                    cancelThreadRename();
                }
            });

            // Citation hover tooltips — target the wrapper to avoid flicker
            panel.addEventListener('mouseenter', (e) => {
                const wrap = e.target.closest?.('.crm-books-citation-wrap');
                if (wrap) {
                    showCitationPreview(wrap);
                }
            }, true);

            panel.addEventListener('mouseleave', (e) => {
                const wrap = e.target.closest?.('.crm-books-citation-wrap');
                if (wrap && !wrap.contains(e.relatedTarget)) {
                    hideCitationPreview(wrap);
                }
            }, true);

            panel.addEventListener('focusin', (e) => {
                const wrap = e.target.closest?.('.crm-books-citation-wrap');
                if (wrap) showCitationPreview(wrap);
            });
            panel.addEventListener('focusout', (e) => {
                const wrap = e.target.closest?.('.crm-books-citation-wrap');
                if (wrap && !wrap.contains(e.relatedTarget)) hideCitationPreview(wrap);
            });

            // Sources toggle
            panel.addEventListener('click', (e) => {
                if (e.target.closest('.crm-books-sources-toggle')) {
                    const workspace = panel.querySelector('.crm-books-workspace');
                    if (workspace) workspace.classList.toggle('sources-collapsed');
                }
            });

            // Dark mode toggle
            panel.addEventListener('click', (e) => {
                if (e.target.closest('.crm-books-dark-toggle')) {
                    panel.classList.toggle('books-dark');
                    localStorage.setItem('crm_books_dark_mode', panel.classList.contains('books-dark') ? '1' : '0');
                    renderExplorerPanel();
                }
            });

            // Pages navigation
            panel.addEventListener('click', (e) => {
                if (e.target.closest('.crm-books-page-prev') && currentPage > 1) {
                    currentPage--;
                    resetPageCitation();
                    renderExplorerPanel();
                    return;
                }
                if (e.target.closest('.crm-books-page-next') && pagesData && currentPage < pagesData.totalPages) {
                    currentPage++;
                    resetPageCitation();
                    renderExplorerPanel();
                    return;
                }
            });
            panel.addEventListener('change', (e) => {
                if (e.target.classList.contains('crm-books-page-input') && pagesData) {
                    const val = parseInt(e.target.value, 10);
                    if (val >= 1 && val <= pagesData.totalPages) {
                        currentPage = val;
                        resetPageCitation();
                        renderExplorerPanel();
                    } else {
                        e.target.value = currentPage;
                    }
                }
            });

            // Budget approval
            panel.addEventListener('click', async (e) => {
                if (e.target.closest('.crm-books-approve-btn')) {
                    const input = panel.querySelector('.crm-books-approve-input');
                    if (input && clean(input.value).toLowerCase() === 'approve') {
                        try {
                            await apiPost('/api/admin/books/usage/approve', { confirm: 'approve' });
                            showToast?.('Budget approved. Counter reset.', 'info');
                            await loadUsage();
                            renderExplorerPanel();
                        } catch (err) {
                            showToast?.('Failed to approve budget.', 'error');
                        }
                    } else {
                        showToast?.('Type "approve" to confirm.', 'error');
                    }
                }
            });
        }

        // --- Lifecycle ---
        async function init() {
            if (localStorage.getItem('crm_books_dark_mode') === '1' && panel) {
                panel.classList.add('books-dark');
            }
            bindEvents();
            loadUsage().catch(() => {});
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
        ingestWeightedPercent,
        deriveThreadTitle,
        reflowPageText,
        findCitationMatch,
        highlightPageText,
        normalizeCitationText
    };
})();
