/**
 * Write Essay Mode Module (PTE Practice → Writing)
 * Handles the Write Essay practice mode in the learner app.
 * Submit Essay shows feedback only; AI scoring is a separate login-gated action.
 */

(function () {
    'use strict';

    const ESSAY_JSON_PATH = '/database/Write Essay/essay-questions-with-vocab.json';
    const MAX_ESSAY_TIME_SECONDS = 20 * 60; // 20 minutes

    // State
    let entries = [];
    let filteredEntries = [];
    let currentEntryIndex = 0;
    let currentEntry = null;
    let isInitialized = false;
    let hasLoadedEntries = false;
    let loadEntriesPromise = null;
    let pendingRouteQuestionId = null;
    let isSubmitting = false;
    let isAiScoring = false;
    let activeFeedbackRequestId = 0;

    // Last submitted essay snapshot (used for AI scoring + re-rendering)
    let lastSubmittedEssayText = '';
    let lastSubmittedEssayPrompt = '';
    let lastSubmittedEssayWordCount = 0;
    let lastBasicFeedbackSectionsHtml = '';
    let lastArchiveAttemptId = null;
    let lastArchiveSavePromise = null;

    // Cached resources / callables
    let scoreEssayFn = null;
    let rubricTextCache = null;
    let rubricTextPromise = null;
    let submitEssayDeepAiFn = null;
    let authStateRefreshBound = false;

    // Timer state
    let essayTimerId = null;
    let essaySecondsLeft = MAX_ESSAY_TIME_SECONDS;

    // v7 question picker + navigation parity with the Reading tasks. The Random
    // preference is shared app-wide under this one localStorage key.
    const RANDOM_MODE_KEY = 'pte_random_nav_mode';
    const PICKER_PAGE_SIZE = 20;
    let randomMode = localStorage.getItem(RANDOM_MODE_KEY) === 'true';
    let navHistory = [];
    let pickerOpen = false;
    let pickerPage = 1;

    // Filter state
    let selectedTypeFilter = 'all';
    let selectedTopicFilter = 'all';
    let searchQuery = '';

    // Standardized task type metadata mappings
    const TASK_TYPE_LABELS = Object.freeze({
        'all': 'All Types',
        'To what extent do you agree or disagree': 'Agree / Disagree',
        'Do the advantages outweigh the disadvantages': 'Advantages & Disadvantages',
        'causes-problems-solutions': 'Causes & Solutions',
        'Discuss both views and give your opinions': 'Discuss Both Views',
        'Is it a positive or negative development': 'Positive or Negative',
        'others': 'Direct Questions / Others'
    });

    const TASK_TYPE_SHORT = Object.freeze({
        'To what extent do you agree or disagree': 'Agree / Disagree',
        'Do the advantages outweigh the disadvantages': 'Advantages & Disadvantages',
        'causes-problems-solutions': 'Causes & Solutions',
        'Discuss both views and give your opinions': 'Discuss Both Views',
        'Is it a positive or negative development': 'Positive or Negative',
        'others': 'Direct Questions'
    });

    function getTaskTypeShort(type) {
        return TASK_TYPE_SHORT[type] || type || 'General Essay';
    }

    function getTaskTypeLabel(type) {
        return TASK_TYPE_LABELS[type] || type || 'General Essay';
    }

    function buildTopicBadgesHtml(entry, { isPreview = false } = {}) {
        if (!entry) return '';
        const primTopic = entry.verifiedPrimaryTopic || 'Education';
        const secTopics = [entry.verifiedSecondaryTopic1, entry.verifiedSecondaryTopic2].filter(Boolean);
        const rawType = entry.standardizedTaskType || 'others';
        const typeLabel = getTaskTypeShort(rawType);

        if (isPreview) {
            const secHtml = secTopics.map(st => `<span class="essay-topic-badge essay-topic-badge-subtle" title="Secondary Topic Domain: ${escapeHtml(st)}">🔖 ${escapeHtml(st)}</span>`).join('');
            return `
                <span class="essay-topic-badge" title="Primary Topic Domain: ${escapeHtml(primTopic)}">📚 ${escapeHtml(primTopic)}</span>
                ${secHtml}
                <span class="essay-type-badge" title="Academic Essay Task Type: ${escapeHtml(typeLabel)}">✍️ ${escapeHtml(typeLabel)}</span>
            `;
        }

        const secHtml = secTopics.map(st => `<span class="essay-v7-item-sec-topic" title="Secondary Topic: ${escapeHtml(st)}">🔖 ${escapeHtml(st)}</span>`).join('');
        return `
            <span class="essay-v7-item-topic" title="Primary Topic: ${escapeHtml(primTopic)}">📚 ${escapeHtml(primTopic)}</span>
            ${secHtml}
            <span class="essay-v7-item-type" title="Task Type: ${escapeHtml(typeLabel)}">✍️ ${escapeHtml(typeLabel)}</span>
        `;
    }

    // DOM Elements
    const el = {};

    /* ──────────────────────────── INIT ──────────────────────────── */

    function init() {
        if (isInitialized) return;
        cacheElements();
        if (!el.questionPill) {
            console.warn('[WriteEssay] UI elements not found, skipping init');
            return;
        }
        setupEventListeners();
        registerAuthStateRefresh();
        pendingRouteQuestionId = getCurrentRouteQuestionId();
        loadEntries();
        isInitialized = true;
    }

    function reset() {
        stopTimer();
        isSubmitting = false;
        isAiScoring = false;
        activeFeedbackRequestId = 0;
        lastSubmittedEssayText = '';
        lastSubmittedEssayPrompt = '';
        lastSubmittedEssayWordCount = 0;
        lastBasicFeedbackSectionsHtml = '';
        lastArchiveAttemptId = null;
        lastArchiveSavePromise = null;
        if (el.practiceArea) el.practiceArea.style.display = 'none';
        if (el.stepWrite) el.stepWrite.style.display = 'none';
        if (el.stepResults) el.stepResults.style.display = 'none';
        if (el.essayInput) { el.essayInput.value = ''; el.essayInput.readOnly = false; }
        if (el.startBtn) el.startBtn.style.display = '';
        if (el.promptCard) el.promptCard.style.display = '';
        const toggleBtn = document.getElementById('essay-history-toggle');
        if (toggleBtn) toggleBtn.style.display = '';

        if (el.questionPill) el.questionPill.disabled = entries.length === 0;
        updateNavigationUI();
        if (el.resultBox) el.resultBox.innerHTML = '';
        if (el.resultsContainer) el.resultsContainer.innerHTML = '';
        if (el.resultsTitle) el.resultsTitle.textContent = 'Your Essay Scores';
        if (el.aiScoreHint) { el.aiScoreHint.style.display = 'none'; el.aiScoreHint.innerHTML = ''; }
        if (el.aiScoreBtn) { el.aiScoreBtn.disabled = false; el.aiScoreBtn.textContent = 'Score with Gemini'; }
        if (el.localAiScoreBtn) { el.localAiScoreBtn.disabled = false; el.localAiScoreBtn.textContent = 'Queue local AI scoring'; }
        if (el.aiScoreStatus) { el.aiScoreStatus.style.display = 'none'; el.aiScoreStatus.textContent = ''; }
        if (el.localAiScoreStatus) { el.localAiScoreStatus.style.display = 'none'; el.localAiScoreStatus.textContent = ''; }
        renderPromptPreview();
        updateWordCount();
    }

    /* ──────────────────────────── DOM CACHE ──────────────────────── */

    function cacheElements() {
        // Question selector — v7 picker, shared with the Reading tasks.
        // #current-question-id-essay is hidden markup kept because the attempt
        // archive resolves the active prompt from it.
        el.currentQuestionId = document.getElementById('current-question-id-essay');
        el.backBtn = document.getElementById('essay-v7-prev-btn');
        el.nextBtn = document.getElementById('essay-v7-next-btn');
        el.questionPill = document.getElementById('essay-v7-question-pill');
        el.randomToggleBtn = document.getElementById('essay-random-toggle-btn');
        el.filterSettingsBtn = document.getElementById('essay-filter-settings-btn');
        el.backdrop = document.getElementById('essay-v7-backdrop');
        el.sheet = document.getElementById('essay-v7-sheet');
        el.sheetClose = document.getElementById('essay-v7-sheet-close');
        el.jumpSearch = document.getElementById('essay-v7-jump-search');
        el.jumpList = document.getElementById('essay-v7-jump-list');
        el.startBtn = document.getElementById('start-essay-btn');
        el.promptPreview = document.getElementById('essay-prompt-preview');
        el.promptCard = el.promptPreview ? el.promptPreview.closest('.essay-prompt-card') : null;
        el.promptMetaBadges = document.getElementById('essay-prompt-meta-badges');

        // Filters
        el.filterToolbar = document.getElementById('essay-filter-toolbar');
        el.filterType = document.getElementById('essay-filter-type');
        el.filterTopic = document.getElementById('essay-filter-topic');
        el.filterCounter = document.getElementById('essay-filter-counter');
        el.filterResetBtn = document.getElementById('essay-filter-reset');

        // Practice area
        el.practiceArea = document.getElementById('essay-practice-area');

        // Step 1: Write
        el.stepWrite = document.getElementById('essay-step-write');
        el.writeMetaBadges = document.getElementById('essay-write-meta-badges');
        el.promptDisplay = document.getElementById('essay-prompt-display');
        el.essayInput = document.getElementById('essay-input');
        el.wordCountDisplay = document.getElementById('essay-word-count');
        el.timerDisplay = document.getElementById('essay-timer');
        el.submitBtn = document.getElementById('essay-submit-btn');

        // Step 2: Results
        el.stepResults = document.getElementById('essay-step-results');
        el.resultsTitle = document.getElementById('essay-results-title');
        el.resultBox = document.getElementById('essay-result-box');
        el.resultsContainer = document.getElementById('essay-results-container');
        el.retryBtn = document.getElementById('essay-retry-btn');
        el.aiScoreBtn = document.getElementById('essay-ai-score-btn');
        el.localAiScoreBtn = document.getElementById('essay-local-ai-score-btn');
        el.aiScoreHint = document.getElementById('essay-ai-score-hint');
        el.aiScoreStatus = document.getElementById('essay-ai-score-status');
        el.localAiScoreStatus = document.getElementById('essay-local-ai-score-status');
    }

    /* ──────────────────────────── EVENT LISTENERS ────────────────── */

    function setupEventListeners() {
        if (el.backBtn) el.backBtn.addEventListener('click', goToPrevious);
        if (el.nextBtn) el.nextBtn.addEventListener('click', goToNext);
        if (el.questionPill) {
            el.questionPill.addEventListener('click', () => {
                if (pickerOpen) closePicker(); else openPicker();
            });
        }
        if (el.backdrop) el.backdrop.addEventListener('click', closePicker);
        if (el.sheetClose) el.sheetClose.addEventListener('click', closePicker);
        if (el.jumpSearch) {
            el.jumpSearch.addEventListener('input', (e) => {
                searchQuery = e.target.value;
                applyFilter({ preserveSelection: true });
                renderJumpList(searchQuery, 1);
            });
        }
        if (el.filterType) {
            el.filterType.addEventListener('change', (e) => {
                selectedTypeFilter = e.target.value;
                applyFilter();
                renderJumpList(searchQuery, 1);
            });
        }
        if (el.filterTopic) {
            el.filterTopic.addEventListener('change', (e) => {
                selectedTopicFilter = e.target.value;
                applyFilter();
                renderJumpList(searchQuery, 1);
            });
        }
        if (el.filterResetBtn) {
            el.filterResetBtn.addEventListener('click', resetFilters);
        }
        if (el.jumpList) {
            el.jumpList.addEventListener('click', (e) => {
                const item = e.target.closest('[data-index]');
                if (!item) return;
                const index = Number.parseInt(item.dataset.index, 10);
                if (Number.isFinite(index)) onPickerItemChosen(index);
            });
        }
        if (el.randomToggleBtn) {
            updateRandomToggleUI();
            el.randomToggleBtn.addEventListener('click', () => {
                randomMode = !randomMode;
                localStorage.setItem(RANDOM_MODE_KEY, String(randomMode));
                navHistory = [];
                updateRandomToggleUI();
                updateNavigationUI();
            });
        }
        if (el.filterSettingsBtn) {
            el.filterSettingsBtn.addEventListener('click', () => {
                if (!pickerOpen) openPicker();
                if (el.filterType) el.filterType.focus();
            });
        }
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && pickerOpen) {
                closePicker();
                if (el.questionPill) el.questionPill.focus();
            }
        });
        if (el.startBtn) el.startBtn.addEventListener('click', startPractice);
        if (el.essayInput) el.essayInput.addEventListener('input', updateWordCount);
        if (el.submitBtn) el.submitBtn.addEventListener('click', submitEssay);
        if (el.retryBtn) el.retryBtn.addEventListener('click', retryPractice);
        if (el.aiScoreBtn) el.aiScoreBtn.addEventListener('click', submitToGeminiScoring);
        if (el.localAiScoreBtn) el.localAiScoreBtn.addEventListener('click', submitToLocalAiScoring);
    }

    /* ──────────────────────────── DATA LOADING ───────────────────── */

    async function loadEntries() {
        if (!el.questionPill) return;
        if (loadEntriesPromise) return loadEntriesPromise;
        if (hasLoadedEntries && entries.length > 0) { applyFilter(); return; }

        const pendingLoad = (async () => {
            setPickerLabel('Loading prompts…', { disabled: true });
            try {
                const resp = await fetch(ESSAY_JSON_PATH);
                if (!resp.ok) throw new Error(`JSON not found (${resp.status})`);
                const data = await resp.json();

                entries = data.map(item => ({
                    id: String(item.id).trim(),
                    title: String(item.title || '').trim(),
                    prompt: String(item.prompt || '').trim(),
                    targetVocabulary: item.targetVocabulary || null,
                    sampleResponses: item.sampleResponses || null,
                    verifiedPrimaryTopic: item.verifiedPrimaryTopic || 'Education',
                    verifiedSecondaryTopic1: item.verifiedSecondaryTopic1 || null,
                    verifiedSecondaryTopic2: item.verifiedSecondaryTopic2 || null,
                    standardizedTaskType: item.standardizedTaskType || 'To what extent do you agree or disagree'
                })).filter(e => e.id.length > 0 && e.prompt.length > 0);

                entries.sort((a, b) => {
                    const ia = parseInt(a.id, 10), ib = parseInt(b.id, 10);
                    return (isNaN(ia) || isNaN(ib)) ? a.id.localeCompare(b.id) : ia - ib;
                });

                populateFilterOptions();
                applyFilter();
                hasLoadedEntries = true;
                applyPendingRouteQuestion();
            } catch (error) {
                hasLoadedEntries = false;
                console.error('[WriteEssay] Error loading entries:', error);
                setPickerLabel('Could not load prompts', { disabled: true });
            }
        })();

        loadEntriesPromise = pendingLoad;
        try { await pendingLoad; } finally { if (loadEntriesPromise === pendingLoad) loadEntriesPromise = null; }
    }

    function populateFilterOptions() {
        if (!el.filterType || !el.filterTopic) return;

        const typeCounts = {};
        const topicCounts = {};

        entries.forEach(e => {
            const t = e.standardizedTaskType || 'others';
            typeCounts[t] = (typeCounts[t] || 0) + 1;

            const uniqueTopics = new Set([
                e.verifiedPrimaryTopic,
                e.verifiedSecondaryTopic1,
                e.verifiedSecondaryTopic2
            ].filter(Boolean));
            uniqueTopics.forEach(top => {
                topicCounts[top] = (topicCounts[top] || 0) + 1;
            });
        });

        const sortedTypes = Object.keys(TASK_TYPE_LABELS).filter(k => k !== 'all' && typeCounts[k]);
        let typeHtml = `<option value="all">All Types (${entries.length})</option>`;
        sortedTypes.forEach(k => {
            const count = typeCounts[k] || 0;
            const label = getTaskTypeLabel(k);
            typeHtml += `<option value="${escapeHtml(k)}">${escapeHtml(label)} (${count})</option>`;
        });
        el.filterType.innerHTML = typeHtml;
        el.filterType.value = selectedTypeFilter;

        const sortedTopics = Object.keys(topicCounts).sort((a, b) => (topicCounts[b] || 0) - (topicCounts[a] || 0));
        let topicHtml = `<option value="all">All Topics (${entries.length})</option>`;
        sortedTopics.forEach(t => {
            const count = topicCounts[t] || 0;
            topicHtml += `<option value="${escapeHtml(t)}">${escapeHtml(t)} (${count})</option>`;
        });
        el.filterTopic.innerHTML = topicHtml;
        el.filterTopic.value = selectedTopicFilter;
    }

    /* ──────────────────────────── FILTERS & NAV ──────────────────── */

    function applyFilter({ preserveSelection = false } = {}) {
        filteredEntries = entries.filter((entry) => {
            if (selectedTypeFilter !== 'all' && entry.standardizedTaskType !== selectedTypeFilter) {
                return false;
            }
            if (selectedTopicFilter !== 'all') {
                const matchPrim = entry.verifiedPrimaryTopic === selectedTopicFilter;
                const matchSec1 = entry.verifiedSecondaryTopic1 === selectedTopicFilter;
                const matchSec2 = entry.verifiedSecondaryTopic2 === selectedTopicFilter;
                if (!matchPrim && !matchSec1 && !matchSec2) return false;
            }
            if (searchQuery) {
                const q = searchQuery.toLowerCase().trim();
                const matchId = String(entry.id).toLowerCase().includes(q);
                const matchTitle = String(entry.title || '').toLowerCase().includes(q);
                const matchPrompt = String(entry.prompt || '').toLowerCase().includes(q);
                const matchTopics = [entry.verifiedPrimaryTopic, entry.verifiedSecondaryTopic1, entry.verifiedSecondaryTopic2]
                    .some(t => t && t.toLowerCase().includes(q));
                const matchType = String(entry.standardizedTaskType || '').toLowerCase().includes(q);
                if (!matchId && !matchTitle && !matchPrompt && !matchTopics && !matchType) return false;
            }
            return true;
        });

        updateFilterMetaUI();

        if (filteredEntries.length === 0) {
            handleEmptyState();
        } else {
            if (el.startBtn) el.startBtn.disabled = false;
            if (el.questionPill) el.questionPill.disabled = false;

            let targetIndex = 0;
            if (preserveSelection && currentEntry) {
                const existingIdx = filteredEntries.findIndex(e => String(e.id) === String(currentEntry.id));
                if (existingIdx >= 0) targetIndex = existingIdx;
            } else {
                const routeQuestionId = pendingRouteQuestionId || getCurrentRouteQuestionId();
                const routeIndex = routeQuestionId
                    ? filteredEntries.findIndex((e) => String(e.id) === String(routeQuestionId))
                    : -1;
                targetIndex = routeIndex >= 0 ? routeIndex : 0;
            }
            currentEntryIndex = targetIndex;
            selectEntry(currentEntryIndex, { updateRoute: true });
        }
    }

    function updateFilterMetaUI() {
        if (el.filterCounter) {
            el.filterCounter.textContent = `${filteredEntries.length} of ${entries.length} prompts`;
        }
        const hasActive = selectedTypeFilter !== 'all' || selectedTopicFilter !== 'all' || Boolean(searchQuery);
        if (el.filterResetBtn) {
            el.filterResetBtn.style.display = hasActive ? '' : 'none';
        }
        if (el.filterSettingsBtn) {
            el.filterSettingsBtn.textContent = hasActive ? '⚙️ Filters ●' : '⚙️ Filters';
        }
    }

    function resetFilters() {
        selectedTypeFilter = 'all';
        selectedTopicFilter = 'all';
        searchQuery = '';
        if (el.filterType) el.filterType.value = 'all';
        if (el.filterTopic) el.filterTopic.value = 'all';
        if (el.jumpSearch) el.jumpSearch.value = '';
        applyFilter({ preserveSelection: true });
        renderJumpList('', 1);
    }

    function handleEmptyState() {
        setPickerLabel('No prompts match filters', { disabled: true });
        if (el.currentQuestionId) el.currentQuestionId.textContent = '-';
        if (el.startBtn) el.startBtn.disabled = true;
        currentEntry = null;
        currentEntryIndex = -1;
        reset();
    }

    /* ──────────────────────────── v7 QUESTION PICKER ─────────────── */

    function setPickerLabel(text, { disabled = false } = {}) {
        if (!el.questionPill) return;
        el.questionPill.textContent = text;
        el.questionPill.disabled = disabled;
    }

    function updateRandomToggleUI() {
        if (!el.randomToggleBtn) return;
        el.randomToggleBtn.classList.toggle('is-active', randomMode);
        el.randomToggleBtn.setAttribute('aria-pressed', randomMode ? 'true' : 'false');
        el.randomToggleBtn.textContent = randomMode ? '🎲 Random: ON' : '🎲 Random: OFF';
    }

    function updateNavigationUI() {
        // In random mode the arrows walk the shuffle history, not the index
        // order, so the position in the list must not disable them.
        if (el.backBtn) {
            el.backBtn.disabled = randomMode
                ? navHistory.length === 0
                : currentEntryIndex <= 0;
        }
        if (el.nextBtn) {
            el.nextBtn.disabled = randomMode
                ? filteredEntries.length <= 1
                : currentEntryIndex >= filteredEntries.length - 1;
        }
        if (currentEntry) {
            setPickerLabel(`#${currentEntry.id} — ${currentEntry.title || 'Essay Prompt'}`);
        }
    }

    function openPicker() {
        if (!el.sheet || !el.backdrop || entries.length === 0) return;
        pickerOpen = true;
        el.backdrop.classList.add('is-visible');
        el.backdrop.setAttribute('aria-hidden', 'false');
        el.sheet.classList.add('is-open');
        el.sheet.setAttribute('aria-hidden', 'false');
        if (el.questionPill) el.questionPill.setAttribute('aria-expanded', 'true');
        renderJumpList(searchQuery);
        if (el.jumpSearch) { el.jumpSearch.value = searchQuery; el.jumpSearch.focus(); }
    }

    function closePicker() {
        if (!el.sheet || !el.backdrop) return;
        pickerOpen = false;
        el.backdrop.classList.remove('is-visible');
        el.backdrop.setAttribute('aria-hidden', 'true');
        el.sheet.classList.remove('is-open');
        el.sheet.setAttribute('aria-hidden', 'true');
        if (el.questionPill) el.questionPill.setAttribute('aria-expanded', 'false');
    }

    function renderJumpList(filter = '', page = null) {
        if (!el.jumpList) return;

        const filtered = filteredEntries.map((entry, idx) => ({ entry, idx }));
        const totalPages = Math.max(1, Math.ceil(filtered.length / PICKER_PAGE_SIZE));

        if (page === null || page === undefined) {
            // Open on the page holding the current prompt rather than page 1.
            const activeFilteredIndex = filtered.findIndex((item) => item.idx === currentEntryIndex);
            pickerPage = activeFilteredIndex >= 0
                ? Math.floor(activeFilteredIndex / PICKER_PAGE_SIZE) + 1
                : 1;
        } else {
            pickerPage = Math.max(1, Math.min(page, totalPages));
        }

        const currentPage = pickerPage;
        const pagedItems = filtered.slice((currentPage - 1) * PICKER_PAGE_SIZE, currentPage * PICKER_PAGE_SIZE);

        const itemsHtml = pagedItems.map(({ entry, idx }) => {
            const isActive = idx === currentEntryIndex;
            return `<button class="ra-v7-list-item${isActive ? ' is-active' : ''}" type="button" data-index="${idx}" role="option" ${isActive ? 'aria-selected="true"' : ''}>
                <div style="display: flex; flex-direction: column; width: 100%; text-align: left; gap: 2px;">
                    <div style="display: flex; align-items: baseline; gap: 6px;">
                        <span class="ra-v7-item-id">#${escapeHtml(entry.id)}</span>
                        <span class="ra-v7-item-title">${escapeHtml(entry.title || 'Essay Prompt')}</span>
                    </div>
                    <div class="essay-v7-item-badges">
                        ${buildTopicBadgesHtml(entry, { isPreview: false })}
                    </div>
                </div>
            </button>`;
        }).join('');

        const paginationHtml = totalPages > 1 ? `
            <div class="ra-v7-pagination">
                <button class="ra-v7-pagination-btn prev-page-btn" type="button" ${currentPage <= 1 ? 'disabled' : ''}>← Prev</button>
                <span class="ra-v7-pagination-info">Page ${currentPage} of ${totalPages} (${filtered.length} items)</span>
                <button class="ra-v7-pagination-btn next-page-btn" type="button" ${currentPage >= totalPages ? 'disabled' : ''}>Next →</button>
            </div>
        ` : '';

        el.jumpList.innerHTML = (itemsHtml || '<div class="ra-v7-empty">No matching prompts</div>') + paginationHtml;

        // The innerHTML write above destroys the previous buttons, so rebind.
        const prevPageBtn = el.jumpList.querySelector('.prev-page-btn');
        const nextPageBtn = el.jumpList.querySelector('.next-page-btn');
        if (prevPageBtn) {
            prevPageBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                renderJumpList(filter, currentPage - 1);
            });
        }
        if (nextPageBtn) {
            nextPageBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                renderJumpList(filter, currentPage + 1);
            });
        }
    }

    async function onPickerItemChosen(index) {
        if (index === currentEntryIndex) { closePicker(); return; }
        if (!(await confirmLeaveDraft())) return;
        if (randomMode) navHistory.push(currentEntryIndex);
        selectEntry(index);
    }

    function shouldConfirmExit() {
        return Boolean(el.stepWrite && getComputedStyle(el.stepWrite).display !== 'none');
    }

    /**
     * Writing-specific gate with no Reading analogue: leaving a question mid-draft
     * throws the draft away, so every navigation path asks first.
     */
    async function confirmLeaveDraft() {
        if (!shouldConfirmExit()) return true;
        return Boolean(await window.showCustomConfirm(
            "Navigate to another question?",
            "Are you sure you want to navigate to another question? Your current essay draft and progress will be lost.",
            true
        ));
    }

    async function goToPrevious() {
        const usingHistory = randomMode && navHistory.length > 0;
        if (!usingHistory && currentEntryIndex <= 0) return;
        if (!(await confirmLeaveDraft())) return;
        selectEntry(usingHistory ? navHistory.pop() : currentEntryIndex - 1);
    }

    async function goToNext() {
        const usingRandom = randomMode && filteredEntries.length > 1;
        if (!usingRandom && currentEntryIndex >= filteredEntries.length - 1) return;
        if (!(await confirmLeaveDraft())) return;

        if (usingRandom) {
            let randomIdx;
            do {
                randomIdx = Math.floor(Math.random() * filteredEntries.length);
            } while (randomIdx === currentEntryIndex && filteredEntries.length > 1);
            navHistory.push(currentEntryIndex);
            selectEntry(randomIdx);
            return;
        }
        selectEntry(currentEntryIndex + 1);
    }


    function selectEntry(index, { updateRoute = true } = {}) {
        if (index < 0 || index >= filteredEntries.length) return;
        currentEntryIndex = index;
        currentEntry = filteredEntries[index];
        if (el.currentQuestionId) el.currentQuestionId.textContent = currentEntry.id;
        updateNavigationUI();
        closePicker();
        reset();

        // Update URL with current question ID (replaceState — no history entry per question)
        if (updateRoute && window.PracticeRouter && currentEntry.id) {
            window.PracticeRouter.replaceRoute('essay', currentEntry.id);
        }

        if (window.PTEAttemptArchive && typeof window.PTEAttemptArchive.updateHistoryUI === 'function') {
            window.PTEAttemptArchive.updateHistoryUI('essay', currentEntry?.id);
        }
    }

    function getCurrentRouteQuestionId() {
        const stateQuestionId = window.history?.state?.mode === 'essay'
            ? window.history.state.questionId
            : null;
        if (!window.PracticeRouter || typeof window.PracticeRouter.parseRoute !== 'function') {
            return stateQuestionId || null;
        }
        const route = window.PracticeRouter.parseRoute(window.location.pathname);
        if (route?.mode === 'essay' && route.questionId) return route.questionId;
        return stateQuestionId || null;
    }

    function applyPendingRouteQuestion() {
        const questionId = pendingRouteQuestionId || getCurrentRouteQuestionId();
        if (!questionId || filteredEntries.length === 0) return false;
        const idx = filteredEntries.findIndex((e) => String(e.id) === String(questionId));
        if (idx < 0) return false;
        pendingRouteQuestionId = null;
        selectEntry(idx, { updateRoute: false });
        return true;
    }

    function renderPromptPreview() {
        if (!el.promptPreview) return;
        const prompt = String(currentEntry?.prompt || '').trim();
        if (!prompt) {
            el.promptPreview.innerHTML = '<p>Prompt will appear here...</p>';
            el.promptPreview.style.display = 'block';
            if (el.promptMetaBadges) el.promptMetaBadges.innerHTML = '';
            if (el.writeMetaBadges) el.writeMetaBadges.innerHTML = '';
            return;
        }
        el.promptPreview.innerHTML = `<div class="essay-prompt-text">${escapeHtml(prompt)}</div>`;
        el.promptPreview.style.display = 'block';

        const badgesHtml = buildTopicBadgesHtml(currentEntry, { isPreview: true });
        if (el.promptMetaBadges) {
            el.promptMetaBadges.innerHTML = badgesHtml;
        }
        if (el.writeMetaBadges) {
            el.writeMetaBadges.innerHTML = badgesHtml;
        }
    }

    /* ──────────────────────────── PRACTICE FLOW ──────────────────── */

    function startPractice() {
        if (!currentEntry) { alert('Please select a question first'); return; }
        el.practiceArea.style.display = 'block';
        el.stepWrite.style.display = 'block';
        el.stepResults.style.display = 'none';
        if (el.promptCard) el.promptCard.style.display = 'none';

        // Lock UI
        if (el.startBtn) el.startBtn.style.display = 'none';
        const toggleBtn = document.getElementById('essay-history-toggle');
        const historyContainer = document.getElementById('essay-history-container');
        if (toggleBtn) toggleBtn.style.display = 'none';
        if (historyContainer) historyContainer.style.display = 'none';

        // Navigation buttons are not disabled; navigation is instead gated by a confirmation dialog in event handlers.

        // Show prompt & badges
        if (el.promptDisplay) {
            el.promptDisplay.innerHTML = `<div class="essay-prompt-text">${escapeHtml(currentEntry.prompt)}</div>`;
        }
        if (el.writeMetaBadges) {
            el.writeMetaBadges.innerHTML = buildTopicBadgesHtml(currentEntry, { isPreview: true });
        }

        // Clear input
        if (el.essayInput) el.essayInput.value = '';
        updateWordCount();

        // Start timer
        essaySecondsLeft = MAX_ESSAY_TIME_SECONDS;
        updateTimerDisplay();
        startTimer();

        // Focus textarea
        if (el.essayInput) el.essayInput.focus();
    }

    function retryPractice() {
        reset();
        startPractice();
    }

    /**
     * The flat, centred score line the Reading tasks lead their results with.
     * Write Essay deliberately does not surface a numeric total (the detailed
     * feedback below is the deliverable), so the line reports the deterministic
     * Form check and points at the feedback underneath.
     */
    function renderScoreLine(formResult) {
        if (!el.resultBox) return;
        if (!formResult) { el.resultBox.innerHTML = ''; return; }

        const score = Number(formResult.score) || 0;
        const band = score >= 2 ? 'is-perfect' : score === 1 ? 'is-partial' : 'has-misses';
        el.resultBox.innerHTML = `
            <div class="essay-result-summary ${band}">
                ${score >= 2 ? '✓' : '✗'} Form ${score}/2 — ${lastSubmittedEssayWordCount} words
            </div>
            <div class="essay-result-desc">${escapeHtml(formResult.detail || 'See the feedback below for language and structure notes.')}</div>`;
    }

    function isPracticeActive() {
        return Boolean(el.practiceArea && getComputedStyle(el.practiceArea).display !== 'none');
    }

    /* ──────────────────────────── TIMER ──────────────────────────── */

    function startTimer() {
        stopTimer();
        essayTimerId = setInterval(() => {
            essaySecondsLeft--;
            updateTimerDisplay();
            if (essaySecondsLeft <= 0) {
                stopTimer();
                submitEssay(); // Auto-submit when time runs out
            }
        }, 1000);
    }

    function stopTimer() {
        if (essayTimerId) { clearInterval(essayTimerId); essayTimerId = null; }
    }

    function updateTimerDisplay() {
        if (!el.timerDisplay) return;
        const m = Math.floor(Math.max(0, essaySecondsLeft) / 60);
        const s = Math.max(0, essaySecondsLeft) % 60;
        el.timerDisplay.textContent = `${m}:${String(s).padStart(2, '0')}`;
        if (essaySecondsLeft <= 120) {
            el.timerDisplay.classList.add('essay-timer-warning');
        } else {
            el.timerDisplay.classList.remove('essay-timer-warning');
        }
    }

    /* ──────────────────────────── WORD COUNT ─────────────────────── */

    function getWordCount() {
        if (!el.essayInput) return 0;
        const text = el.essayInput.value.trim();
        if (!text) return 0;
        return text.split(/\s+/).filter(w => w.length > 0).length;
    }

    function updateWordCount() {
        const count = getWordCount();
        if (el.wordCountDisplay) {
            el.wordCountDisplay.textContent = `${count} word${count !== 1 ? 's' : ''}`;
            // Color feedback
            if (count >= 200 && count <= 300) {
                el.wordCountDisplay.className = 'essay-word-count essay-wc-good';
            } else if ((count >= 120 && count < 200) || (count > 300 && count <= 380)) {
                el.wordCountDisplay.className = 'essay-word-count essay-wc-warn';
            } else {
                el.wordCountDisplay.className = 'essay-word-count essay-wc-bad';
            }
        }
    }

    /* ──────────────────────────── SCORING ────────────────────────── */

    /**
     * Score Form (0-2) based on word count
     */
    function scoreForm(text) {
        const count = text.trim().split(/\s+/).filter(w => w.length > 0).length;

        // Check for degenerate cases → score 0
        const isAllCaps = text === text.toUpperCase() && text.length > 20;
        const noPunctuation = !/[.!?,;:]/.test(text);
        const isBulletPoints = /^[\s•\-*\d]+/.test(text) && (text.match(/\n/g) || []).length > 5;

        if (count < 120 || count > 380 || isAllCaps || (noPunctuation && count > 20) || isBulletPoints) {
            return { score: 0, detail: `${count} words — outside acceptable range or formatting issues` };
        }
        if (count >= 200 && count <= 300) {
            return { score: 2, detail: `${count} words — ideal length` };
        }
        return { score: 1, detail: `${count} words — acceptable but not ideal (aim for 200-300)` };
    }

    /* ──────────────────────────── SUBMIT & DISPLAY ───────────────── */

    async function submitEssay() {
        if (isSubmitting) return;
        stopTimer();
        const text = el.essayInput ? el.essayInput.value.trim() : '';
        if (!text || text.split(/\s+/).length < 5) {
            alert('Please write at least a few sentences before submitting.');
            startTimer(); // Resume timer
            return;
        }

        isSubmitting = true;
        const requestId = ++activeFeedbackRequestId;

        // Lock UI while analyzing (feedback-only; no numeric scores).
        if (el.submitBtn) {
            el.submitBtn.disabled = true;
            el.submitBtn.textContent = '⏳ Analyzing…';
        }
        if (el.essayInput) el.essayInput.readOnly = true;

        lastSubmittedEssayText = text;
        lastSubmittedEssayPrompt = currentEntry?.prompt || '';
        lastSubmittedEssayWordCount = getWordCount();
        lastArchiveAttemptId = null;
        lastArchiveSavePromise = null;

        if (el.resultsTitle) el.resultsTitle.textContent = 'Your Essay Feedback';
        if (el.resultsContainer) {
            el.resultsContainer.innerHTML = `<div class="essay-feedback-loading">Checking Form, Grammar, and Spelling…</div>`;
        }

        const formResult = scoreForm(text);
        const langTool = await checkWithLanguageTool(text);
        if (requestId !== activeFeedbackRequestId) return; // stale

        const feedbackSectionsHtml = renderBasicFeedbackSectionsHtml({
            essayText: text,
            formResult,
            langTool
        });

        const feedbackHtml = renderBasicFeedbackHtml({
            essayText: text,
            promptText: lastSubmittedEssayPrompt,
            wordCount: lastSubmittedEssayWordCount,
            feedbackSectionsHtml
        });

        lastBasicFeedbackSectionsHtml = feedbackSectionsHtml;

        // Display results
        el.stepWrite.style.display = 'none';
        el.stepResults.style.display = 'block';
        renderScoreLine(formResult);
        displayFeedbackOnly({ feedbackHtml });
        rememberArchiveSave(window.PTEAttemptArchive?.saveTextAttempt?.('essay', currentEntry, text, {
            wordCount: lastSubmittedEssayWordCount,
            form: formResult,
            languageTool: langTool?.ok ? {
                matchCount: Array.isArray(langTool.data?.matches) ? langTool.data.matches.length : 0
            } : { unavailable: true }
        }, { scoringSource: 'client-basic' }));

        // Restore UI state
        if (el.submitBtn) {
            el.submitBtn.disabled = false;
            el.submitBtn.textContent = 'Submit Essay';
        }
        if (el.essayInput) el.essayInput.readOnly = false;
        isSubmitting = false;

        updateAiScoreButtonState();
    }

    function displayFeedbackOnly({ feedbackHtml }) {
        if (!el.resultsContainer) return;

        const sampleResponses = currentEntry && currentEntry.sampleResponses ? currentEntry.sampleResponses : null;
        const sampleHtml = renderSampleEssays(sampleResponses);

        el.resultsContainer.innerHTML = feedbackHtml || '';

        if (sampleHtml) {
            el.resultsContainer.insertAdjacentHTML('beforeend', sampleHtml);
            initSampleEssaysUI(sampleResponses);
        }
    }

    function rememberArchiveSave(promise) {
        lastArchiveSavePromise = Promise.resolve(promise || null)
            .then((result) => {
                lastArchiveAttemptId = result?.attemptId || lastArchiveAttemptId;
                return lastArchiveAttemptId;
            })
            .catch((error) => {
                console.warn('[PTE Archive] Essay save failed:', error);
                return null;
            });
        return lastArchiveSavePromise;
    }

    async function ensureArchiveAttemptId() {
        if (lastArchiveAttemptId) return lastArchiveAttemptId;
        if (lastArchiveSavePromise) {
            const attemptId = await lastArchiveSavePromise;
            return attemptId || lastArchiveAttemptId;
        }
        return null;
    }

    function renderScoreRow(label, result, maxScore) {
        const score = typeof result?.score === 'number' ? result.score : -1;
        const isUnavailable = score < 0;
        const badgeClass = isUnavailable ? 'essay-score-na' :
            score === maxScore ? 'essay-score-full' :
                score > 0 ? 'essay-score-partial' : 'essay-score-zero';

        return `
            <div class="essay-score-row">
                <div class="essay-score-label">${escapeHtml(label)}</div>
                <div class="essay-score-badge ${badgeClass}">
                    ${isUnavailable ? 'N/A' : `${score}/${maxScore}`}
                </div>
                <div class="essay-score-detail">${escapeHtml(result?.detail || '')}</div>
            </div>
        `;
    }

    async function checkWithLanguageTool(text) {
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timeoutMs = 12000;
        let timeoutId = null;

        try {
            if (controller) timeoutId = setTimeout(() => controller.abort(), timeoutMs);
            const response = await fetch('https://api.languagetool.org/v2/check', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    text: String(text || ''),
                    language: 'en-US'
                }),
                signal: controller ? controller.signal : undefined
            });
            if (!response.ok) {
                throw new Error(`LanguageTool HTTP ${response.status}`);
            }
            const data = await response.json();
            return { ok: true, data };
        } catch (error) {
            console.warn('[WriteEssay] LanguageTool unavailable:', error);
            return { ok: false, error: error?.message || String(error) };
        } finally {
            if (timeoutId) clearTimeout(timeoutId);
        }
    }

    function renderBasicFeedbackHtml({ essayText, promptText, wordCount, feedbackSectionsHtml }) {
        return `
            ${renderSubmittedEssayBlockHtml({ essayText, promptText, wordCount })}
            ${feedbackSectionsHtml || ''}
        `;
    }

    function renderSubmittedEssayBlockHtml({ essayText, promptText, wordCount }) {
        const prompt = String(promptText || '').trim();
        const paras = splitEssayParagraphs(String(essayText || ''));
        const essayHtml = paras.length > 0
            ? paras.map(p => `<p>${escapeHtml(p)}</p>`).join('')
            : `<p>${escapeHtml(String(essayText || '').trim())}</p>`;

        return `
            <div class="essay-submitted">
                <div class="essay-submitted-header">
                    <h4>Your submitted essay</h4>
                    <div class="essay-submitted-meta">${Number(wordCount || 0)} words</div>
                </div>
                ${prompt ? `
                    <div class="essay-submitted-prompt">
                        <div class="essay-submitted-prompt-label">Prompt</div>
                        <div class="essay-submitted-prompt-text">${escapeHtml(prompt)}</div>
                    </div>
                ` : ''}
                <div class="essay-submitted-body">
                    ${essayHtml}
                </div>
            </div>
        `;
    }

    function renderBasicFeedbackSectionsHtml({ essayText, formResult, langTool }) {
        const form = formResult || { score: 0, detail: '' };
        const wordCount = lastSubmittedEssayWordCount || getWordCount();

        const formTips = [];
        if (form.score >= 2) {
            formTips.push('Length is in the ideal range (200–300 words).');
            formTips.push('Keep using paragraphs (intro → body → conclusion) so your ideas are easy to follow.');
        } else if (form.score === 1) {
            formTips.push('Length is acceptable, but not ideal.');
            formTips.push('Aim for 200–300 words by adding 1–2 specific examples or explanations.');
        } else {
            formTips.push('Length/format needs fixing to meet PTE rules.');
            formTips.push('Write 200–300 words (minimum acceptable: 120–380).');
            formTips.push('Avoid ALL CAPS and make sure you use punctuation (.,!?).');
        }

        const formHtml = `
            <div class="essay-feedback-card">
                <div class="essay-feedback-card-title">Form</div>
                <div class="essay-feedback-card-subtitle">${escapeHtml(form.detail || `${wordCount} words`)}</div>
                <ul class="essay-feedback-bullets">
                    ${formTips.map(t => `<li>${escapeHtml(t)}</li>`).join('')}
                </ul>
            </div>
        `;

        const langOk = Boolean(langTool && langTool.ok && langTool.data);
        const matches = langOk && Array.isArray(langTool.data.matches) ? langTool.data.matches : [];
        const corrections = matches.map(m => buildLanguageToolCorrection(essayText, m)).filter(Boolean);
        const spellingCorrections = corrections.filter(c => c.bucket === 'spelling');
        const grammarCorrections = corrections.filter(c => c.bucket !== 'spelling');

        const grammarHtml = renderLanguageFeedbackCard({
            title: 'Grammar',
            subtitle: langOk ? `${grammarCorrections.length} issue${grammarCorrections.length === 1 ? '' : 's'} found` : 'Grammar check unavailable',
            corrections: grammarCorrections,
            essayText,
            fallbackTips: [
                'Use complete sentences and avoid run-ons.',
                'Check subject–verb agreement (e.g., “people are”, “a person is”).',
                'Use punctuation to separate ideas (comma, full stop).'
            ],
            showRewriteExamples: true,
            unavailable: !langOk
        });

        const spellingHtml = renderLanguageFeedbackCard({
            title: 'Spelling',
            subtitle: langOk ? `${spellingCorrections.length} possible misspelling${spellingCorrections.length === 1 ? '' : 's'}` : 'Spelling check unavailable',
            corrections: spellingCorrections,
            essayText,
            fallbackTips: [
                'Re-read slowly and check long words and endings (-ed, -s).',
                'Watch common confusion pairs (their/there/they’re, affect/effect).'
            ],
            showRewriteExamples: false,
            unavailable: !langOk
        });

        const noteHtml = !langOk ? `
            <div class="essay-feedback-note">
                Grammar/spelling service is temporarily unavailable. Try again later for detailed correction suggestions.
            </div>
        ` : '';

        return `
            <div class="essay-feedback-sections">
                ${formHtml}
                ${noteHtml}
                ${grammarHtml}
                ${spellingHtml}
            </div>
        `;
    }

    function buildLanguageToolCorrection(text, match) {
        if (!match || typeof match !== 'object') return null;
        const offset = Number(match.offset);
        const length = Number(match.length);
        if (!Number.isFinite(offset) || !Number.isFinite(length) || offset < 0 || length < 0) return null;

        const rule = match.rule || {};
        const issueType = String(rule.issueType || '').toLowerCase();
        const categoryId = String(rule.category?.id || '').toLowerCase();
        const categoryName = String(rule.category?.name || '').toLowerCase();

        const isSpelling = issueType === 'misspelling' || categoryId.includes('typo') || categoryName.includes('typo');
        const bucket = isSpelling ? 'spelling' : (categoryId.includes('punct') ? 'punctuation' : (issueType || 'grammar'));

        const original = String(text || '').slice(offset, offset + length);
        const replacement = Array.isArray(match.replacements) && match.replacements.length > 0
            ? String(match.replacements[0]?.value || '')
            : '';

        return {
            bucket,
            offset,
            length,
            original,
            replacement,
            message: String(match.message || ''),
            shortMessage: String(match.shortMessage || ''),
            ruleId: String(rule.id || ''),
            categoryId: String(rule.category?.id || ''),
            categoryName: String(rule.category?.name || ''),
            issueType
        };
    }

    function renderLanguageFeedbackCard({ title, subtitle, corrections, essayText, fallbackTips, showRewriteExamples, unavailable }) {
        const list = Array.isArray(corrections) ? corrections : [];
        const hasCorrections = list.length > 0;
        const isUnavailable = Boolean(unavailable);

        const patterns = buildIssuePatternSummary(list);
        const patternsHtml = patterns.length > 0 ? `
            <div class="essay-feedback-patterns">
                ${patterns.map(p => `<span class="essay-feedback-pattern">${escapeHtml(p)}</span>`).join('')}
            </div>
        ` : '';

        const maxItems = 12;
        const items = list.slice(0, maxItems);
        const hiddenCount = Math.max(0, list.length - items.length);

        const correctionsHtml = isUnavailable ? `
            <div class="essay-feedback-empty">Detailed suggestions are unavailable right now.</div>
        ` : (hasCorrections ? `
            <ul class="essay-feedback-fixes">
                ${items.map(c => renderLanguageCorrectionItem(essayText, c)).join('')}
            </ul>
            ${hiddenCount > 0 ? `<div class="essay-feedback-more">+ ${hiddenCount} more issue${hiddenCount === 1 ? '' : 's'} not shown</div>` : ''}
        ` : `
            <div class="essay-feedback-empty">No issues found.</div>
        `);

        const rewriteExamples = showRewriteExamples ? buildRewriteExamples(essayText, list) : [];
        const rewritesHtml = rewriteExamples.length > 0 ? `
            <div class="essay-feedback-rewrites">
                <div class="essay-feedback-rewrites-title">Quick rewrite example${rewriteExamples.length === 1 ? '' : 's'}</div>
                ${rewriteExamples.map(ex => `
                    <div class="essay-feedback-rewrite">
                        <div class="essay-feedback-rewrite-before">${escapeHtml(ex.before)}</div>
                        <div class="essay-feedback-rewrite-after">${escapeHtml(ex.after)}</div>
                    </div>
                `).join('')}
            </div>
        ` : '';

        const fallbackHtml = (!hasCorrections && Array.isArray(fallbackTips) && fallbackTips.length > 0) ? `
            <ul class="essay-feedback-bullets">
                ${fallbackTips.map(t => `<li>${escapeHtml(t)}</li>`).join('')}
            </ul>
        ` : '';

        return `
            <div class="essay-feedback-card">
                <div class="essay-feedback-card-title">${escapeHtml(title)}</div>
                <div class="essay-feedback-card-subtitle">${escapeHtml(subtitle || '')}</div>
                ${patternsHtml}
                ${correctionsHtml}
                ${rewritesHtml}
                ${fallbackHtml}
            </div>
        `;
    }

    function buildIssuePatternSummary(corrections) {
        const list = Array.isArray(corrections) ? corrections : [];
        const counts = new Map();
        list.forEach((c) => {
            const key = String(c.bucket || 'other');
            counts.set(key, (counts.get(key) || 0) + 1);
        });
        const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
        return sorted.slice(0, 4).map(([bucket, count]) => `${bucket}: ${count}`);
    }

    function renderLanguageCorrectionItem(text, correction) {
        const c = correction || {};
        const replacement = c.replacement ? c.replacement : '(no suggestion)';
        const reason = c.shortMessage || c.message || '';
        const contextHtml = renderContextHtml(text, c.offset, c.length);

        return `
            <li class="essay-feedback-fix">
                <div class="essay-feedback-fix-top">
                    <span class="essay-feedback-original">${escapeHtml(c.original || '')}</span>
                    <span class="essay-feedback-arrow">→</span>
                    <span class="essay-feedback-replacement">${escapeHtml(replacement)}</span>
                </div>
                ${reason ? `<div class="essay-feedback-reason">${escapeHtml(reason)}</div>` : ''}
                ${contextHtml ? `<div class="essay-feedback-context">${contextHtml}</div>` : ''}
            </li>
        `;
    }

    function renderContextHtml(text, offset, length) {
        const t = String(text || '');
        const o = Number(offset);
        const l = Number(length);
        if (!Number.isFinite(o) || !Number.isFinite(l) || o < 0 || l <= 0 || o >= t.length) return '';

        const ctx = 30;
        const start = Math.max(0, o - ctx);
        const end = Math.min(t.length, o + l + ctx);
        const prefix = start > 0 ? '…' : '';
        const suffix = end < t.length ? '…' : '';

        const before = escapeHtml(t.slice(start, o));
        const mid = escapeHtml(t.slice(o, o + l));
        const after = escapeHtml(t.slice(o + l, end));
        return `${escapeHtml(prefix)}${before}<mark class="essay-feedback-mark">${mid}</mark>${after}${escapeHtml(suffix)}`;
    }

    function splitIntoSentenceSpans(text) {
        const t = String(text || '');
        const spans = [];
        const re = /[^.!?]+(?:[.!?]+|$)/g;
        let m;
        while ((m = re.exec(t)) !== null) {
            const raw = String(m[0] || '');
            const cleaned = raw.trim();
            if (!cleaned) continue;
            spans.push({ start: m.index, end: m.index + raw.length, text: cleaned });
        }
        return spans;
    }

    function applyCorrectionsToText(text, corrections) {
        let out = String(text || '');
        const sorted = (corrections || [])
            .filter(c => c && typeof c.offset === 'number' && typeof c.length === 'number' && typeof c.replacement === 'string')
            .sort((a, b) => b.offset - a.offset);
        sorted.forEach((c) => {
            const start = Math.max(0, c.offset);
            const end = Math.max(start, c.offset + c.length);
            out = out.slice(0, start) + c.replacement + out.slice(end);
        });
        return out;
    }

    function buildRewriteExamples(fullText, corrections) {
        const spans = splitIntoSentenceSpans(fullText);
        if (spans.length === 0) return [];
        const usable = (corrections || []).filter(c => c && typeof c.offset === 'number' && typeof c.length === 'number' && c.replacement);
        if (usable.length === 0) return [];

        const scored = spans.map((span) => {
            const related = usable.filter(c => c.offset >= span.start && (c.offset + c.length) <= span.end);
            return { span, corrections: related, count: related.length };
        }).filter(x => x.count > 0);

        scored.sort((a, b) => b.count - a.count);
        return scored.slice(0, 2).map((x) => {
            const local = x.corrections.map(c => ({
                offset: c.offset - x.span.start,
                length: c.length,
                replacement: c.replacement
            }));
            const before = x.span.text;
            const after = applyCorrectionsToText(x.span.text, local).trim();
            return after && after !== before ? { before, after } : null;
        }).filter(Boolean);
    }

    function isGuestMode() {
        return sessionStorage.getItem('guestMode') === 'true';
    }

    function getCurrentUser() {
        return window.__FIREBASE_INTERNAL__?.auth?.currentUser || window.auth?.currentUser || null;
    }

    function updateAiScoreButtonState() {
        if (!el.aiScoreBtn && !el.localAiScoreBtn) return;
        if (!lastSubmittedEssayText) {
            if (el.aiScoreBtn) el.aiScoreBtn.disabled = true;
            if (el.localAiScoreBtn) el.localAiScoreBtn.disabled = true;
            return;
        }

        const user = getCurrentUser();
        const allowed = Boolean(user) && !isGuestMode();
        if (el.aiScoreBtn) el.aiScoreBtn.disabled = !allowed || isAiScoring;
        if (el.localAiScoreBtn) el.localAiScoreBtn.disabled = !allowed || isAiScoring;

        if (!el.aiScoreHint) return;

        if (allowed) {
            el.aiScoreHint.style.display = 'none';
            el.aiScoreHint.innerHTML = '';
            return;
        }

        el.aiScoreHint.style.display = 'block';
        el.aiScoreHint.innerHTML = `
            <div class="essay-ai-score-hint-text">AI scoring requires login.</div>
            <button id="essay-ai-score-login-btn" class="modern-btn modern-btn--hint" type="button">Log in</button>
        `;

        const btn = document.getElementById('essay-ai-score-login-btn');
        if (btn) {
            btn.addEventListener('click', () => {
                if (typeof window.showLoginForm === 'function') {
                    window.showLoginForm();
                } else {
                    alert('Please log in to use AI scoring.');
                }
            });
        }
    }

    function registerAuthStateRefresh() {
        if (authStateRefreshBound) return;
        const register = window.authUI && (
            window.authUI.onAuthStateChanged ||
            window.authUI.onAuthStateChange
        );
        if (typeof register !== 'function') return;

        authStateRefreshBound = true;
        register(() => {
            if (el.stepResults && el.stepResults.style.display === 'block' && lastSubmittedEssayText) {
                updateAiScoreButtonState();
            }
        });
    }

    async function getRubricText() {
        if (rubricTextCache) return rubricTextCache;
        if (rubricTextPromise) return rubricTextPromise;

        rubricTextPromise = fetch('/database/knowledge-base/Write Essay Score Guide.txt', { cache: 'no-store' })
            .then((resp) => {
                if (!resp.ok) throw new Error(`Rubric not found (${resp.status})`);
                return resp.text();
            })
            .then((txt) => {
                rubricTextCache = String(txt || '');
                return rubricTextCache;
            })
            .catch((err) => {
                rubricTextPromise = null;
                throw err;
            });

        return rubricTextPromise;
    }

    async function getScoreEssayCallable() {
        if (scoreEssayFn) return scoreEssayFn;
        if (window.__FIREBASE_INTERNAL__ && window.__FIREBASE_INTERNAL__.functions) {
            const { httpsCallable } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js');
            scoreEssayFn = httpsCallable(window.__FIREBASE_INTERNAL__.functions, 'scoreEssay');
            return scoreEssayFn;
        }
        if (typeof firebase !== 'undefined' && firebase.functions) {
            scoreEssayFn = firebase.functions().httpsCallable('scoreEssay');
            return scoreEssayFn;
        }
        throw new Error('Gemini scoring unavailable (Firebase functions not loaded)');
    }

    async function getSubmitEssayDeepAiCallable() {
        if (submitEssayDeepAiFn) return submitEssayDeepAiFn;
        if (window.__FIREBASE_INTERNAL__ && window.__FIREBASE_INTERNAL__.functions) {
            const { httpsCallable } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js');
            submitEssayDeepAiFn = httpsCallable(window.__FIREBASE_INTERNAL__.functions, 'submitEssayDeepAi');
            return submitEssayDeepAiFn;
        }
        if (typeof firebase !== 'undefined' && firebase.functions) {
            submitEssayDeepAiFn = firebase.functions().httpsCallable('submitEssayDeepAi');
            return submitEssayDeepAiFn;
        }
        throw new Error('Local AI scoring unavailable (Firebase functions not loaded)');
    }

    async function submitToGeminiScoring() {
        if (isAiScoring) return;
        if (!lastSubmittedEssayText) {
            alert('Please submit your essay first.');
            return;
        }

        updateAiScoreButtonState();
        if (el.aiScoreBtn && el.aiScoreBtn.disabled) return;

        isAiScoring = true;
        if (el.aiScoreBtn) {
            el.aiScoreBtn.disabled = true;
            el.aiScoreBtn.textContent = '⏳ Scoring with Gemini…';
        }
        if (el.localAiScoreBtn) el.localAiScoreBtn.disabled = true;
        if (el.aiScoreHint) el.aiScoreHint.style.display = 'none';
        if (el.aiScoreStatus) el.aiScoreStatus.style.display = 'none';

        try {
            const rubricText = await getRubricText();
            const callable = await getScoreEssayCallable();
            const result = await callable({
                text: String(lastSubmittedEssayText || '').slice(0, 6000),
                promptText: String(lastSubmittedEssayPrompt || '').slice(0, 2000),
                rubricText: String(rubricText || '').slice(0, 15000),
                context: {
                    entryType: 'pte_essay',
                    questionId: currentEntry?.id || ''
                }
            });

            const data = result?.data || {};
            if (data.limited) {
                if (el.aiScoreStatus) {
                    el.aiScoreStatus.style.display = 'block';
                    el.aiScoreStatus.textContent = data.message || 'Gemini daily scoring limit reached. Try again tomorrow.';
                }
                return;
            }
            if (!data.success) throw new Error(data.message || 'Gemini scoring failed');

            if (el.resultsTitle) el.resultsTitle.textContent = 'Your Essay Scores';
            displayAiScoreResults(data);
            const archiveAttemptId = await ensureArchiveAttemptId();
            let archiveSaveFailed = false;
            if (archiveAttemptId) {
                try {
                    if (typeof window.PTEAttemptArchive?.patchAttempt !== 'function') {
                        throw new Error('Essay archive patch is unavailable');
                    }
                    await window.PTEAttemptArchive.patchAttempt(archiveAttemptId, {
                        resultSnapshot: {
                            overall: data.overall || null,
                            scores: data.scores || null,
                            teacherAdvice: data.teacherAdvice || data.teacherAdviceChat || null
                        },
                        scoringSnapshot: {
                            source: 'gemini',
                            success: true,
                            teacherAdviceChat: data.teacherAdviceChat || data.teacherAdvice || null
                        }
                    });
                } catch (archiveError) {
                    archiveSaveFailed = true;
                    console.warn('[PTE Archive] Gemini essay score patch failed:', archiveError);
                }
            } else {
                archiveSaveFailed = true;
            }

            const teacherAdvice = String(data.teacherAdviceChat || data.teacherAdvice || '').trim();
            if (teacherAdvice) postTeacherAdviceToChat(teacherAdvice);
            if (archiveSaveFailed && el.aiScoreStatus) {
                el.aiScoreStatus.style.display = 'block';
                el.aiScoreStatus.textContent = 'Gemini score is shown, but the archive could not be updated. Please try again.';
            }
        } catch (error) {
            console.error('[WriteEssay] Gemini scoreEssay failed:', error);
            if (el.aiScoreStatus) {
                el.aiScoreStatus.style.display = 'block';
                el.aiScoreStatus.textContent = 'Gemini scoring failed. Please try again.';
            }
        } finally {
            isAiScoring = false;
            if (el.aiScoreBtn) el.aiScoreBtn.textContent = 'Score with Gemini';
            updateAiScoreButtonState();
        }
    }

    async function submitToLocalAiScoring() {
        if (isAiScoring) return;
        if (!lastSubmittedEssayText) {
            alert('Please submit your essay first.');
            return;
        }

        updateAiScoreButtonState();
        if (el.localAiScoreBtn && el.localAiScoreBtn.disabled) return;

        isAiScoring = true;
        if (el.localAiScoreBtn) {
            el.localAiScoreBtn.disabled = true;
            el.localAiScoreBtn.textContent = '⏳ Queueing local scoring…';
        }
        if (el.aiScoreBtn) el.aiScoreBtn.disabled = true;
        if (el.aiScoreHint) el.aiScoreHint.style.display = 'none';

        try {
            const attemptId = await ensureArchiveAttemptId();
            if (!attemptId) throw new Error('Essay archive is still saving. Please try again.');
            const callable = await getSubmitEssayDeepAiCallable();
            const result = await callable({ attemptId });
            const data = result?.data || {};
            if (!data.queueId || !data.status) {
                throw new Error(data.message || 'Local AI queue returned an invalid response');
            }
            if (el.localAiScoreStatus) {
                el.localAiScoreStatus.style.display = 'block';
                el.localAiScoreStatus.textContent = data.created === false
                    ? `This essay is already ${data.status}.`
                    : 'Queued for local AI scoring. Waiting for AI feedback…';
            }
            if (data.queueId) {
                pollLocalAiScoreResult(data.queueId, attemptId);
            }
        } catch (error) {
            console.error('[WriteEssay] local AI queue failed:', error);
            if (el.localAiScoreStatus) {
                el.localAiScoreStatus.style.display = 'block';
                el.localAiScoreStatus.textContent = error?.message || 'Local AI scoring could not be queued. Please try again.';
            }
        } finally {
            isAiScoring = false;
            if (el.localAiScoreBtn) el.localAiScoreBtn.textContent = 'Queue local AI scoring';
            updateAiScoreButtonState();
        }
    }

    async function pollLocalAiScoreResult(queueId, attemptId) {
        if (!queueId) return;
        const startTime = Date.now();
        const maxWaitMs = 180000;
        const timer = setInterval(async () => {
            try {
                if (!window.__FIREBASE_INTERNAL__?.db) return;
                const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
                const snap = await getDoc(doc(window.__FIREBASE_INTERNAL__.db, 'essay_ai_queue', queueId));
                if (snap.exists()) {
                    const qData = snap.data() || {};
                    if (qData.status === 'completed' && qData.resultSnapshot) {
                        clearInterval(timer);
                        if (el.localAiScoreStatus) {
                            el.localAiScoreStatus.style.display = 'block';
                            el.localAiScoreStatus.textContent = '✅ Local AI scoring complete!';
                        }
                        if (el.resultsTitle) el.resultsTitle.textContent = 'Your Essay Scores (Local AI)';
                        displayAiScoreResults(qData.resultSnapshot);
                        const teacherAdvice = String(qData.resultSnapshot.teacherAdviceChat || qData.resultSnapshot.teacherAdvice || '').trim();
                        if (teacherAdvice) postTeacherAdviceToChat(teacherAdvice);
                        if (window.PTEAttemptArchive && typeof window.PTEAttemptArchive.updateHistoryUI === 'function') {
                            window.PTEAttemptArchive.updateHistoryUI('essay', currentEntry?.id);
                        }
                        return;
                    }
                    if (qData.status === 'failed') {
                        clearInterval(timer);
                        if (el.localAiScoreStatus) {
                            el.localAiScoreStatus.style.display = 'block';
                            el.localAiScoreStatus.textContent = qData.error || 'Local AI scoring failed.';
                        }
                        return;
                    }
                }
            } catch (e) {
                console.warn('[WriteEssay] Local AI poll check failed:', e);
            }
            if (Date.now() - startTime > maxWaitMs) {
                clearInterval(timer);
                if (el.localAiScoreStatus) {
                    el.localAiScoreStatus.style.display = 'block';
                    el.localAiScoreStatus.textContent = 'Queued for local AI scoring. Check back or click Previous Attempts for results.';
                }
            }
        }, 3000);
    }

    function displayAiScoreResults(data) {
        if (!el.resultsContainer) return;

        const overall = data.overall || {};
        const total = Number(overall.total || 0);
        const maxTotal = Number(overall.maxTotal || 0);
        const percent = Number.isFinite(Number(overall.percent))
            ? Number(overall.percent)
            : (maxTotal > 0 ? Math.round((total / maxTotal) * 100) : 0);
        const scores = data.scores && typeof data.scores === 'object' ? data.scores : {};
        const ordered = [
            { key: 'content', label: 'Content', max: 6 },
            { key: 'form', label: 'Form', max: 2 },
            { key: 'development_structure_coherence', label: 'Development, Structure and Coherence', max: 6 },
            { key: 'grammar', label: 'Grammar', max: 2 },
            { key: 'general_linguistic_range', label: 'General Linguistic Range', max: 6 },
            { key: 'vocabulary_range', label: 'Vocabulary Range', max: 2 },
            { key: 'spelling', label: 'Spelling', max: 2 }
        ];
        const breakdownHtml = ordered.map((item) => {
            const score = scores[item.key] || {};
            const detailParts = [];
            const rationale = score.rationale || score.detail || '';
            if (rationale) detailParts.push(String(rationale));
            if (Array.isArray(score.fixTips) && score.fixTips.length > 0) {
                detailParts.push('Fix: ' + score.fixTips.slice(0, 2).join(' | '));
            }
            if (Array.isArray(score.evidence) && score.evidence.length > 0) {
                detailParts.push('Evidence: ' + score.evidence.slice(0, 1).join(''));
            }
            return renderScoreRow(item.label, {
                score: Number.isFinite(Number(score.score)) ? Number(score.score) : -1,
                detail: detailParts.join(' ')
            }, item.max);
        }).join('');
        const basicFeedbackDetails = lastBasicFeedbackSectionsHtml ? `
            <details class="essay-basic-feedback">
                <summary>Basic feedback (Form/Grammar/Spelling)</summary>
                <div class="essay-basic-feedback-body">${lastBasicFeedbackSectionsHtml}</div>
            </details>
        ` : '';

        el.resultsContainer.innerHTML = `
            ${renderSubmittedEssayBlockHtml({ essayText: lastSubmittedEssayText, promptText: lastSubmittedEssayPrompt, wordCount: lastSubmittedEssayWordCount })}
            <div class="essay-results-summary">
                <div class="essay-results-score-circle">
                    <span class="essay-score-number">${total}</span>
                    <span class="essay-score-divider">/</span>
                    <span class="essay-score-total">${maxTotal}</span>
                </div>
                <div class="essay-results-percentage">${percent}%</div>
            </div>
            <div class="essay-results-breakdown">${breakdownHtml}</div>
            ${basicFeedbackDetails}
        `;

        const sampleResponses = currentEntry && currentEntry.sampleResponses ? currentEntry.sampleResponses : null;
        const sampleHtml = renderSampleEssays(sampleResponses);
        if (sampleHtml) {
            el.resultsContainer.insertAdjacentHTML('beforeend', sampleHtml);
            initSampleEssaysUI(sampleResponses);
        }
    }

    function postTeacherAdviceToChat(text) {
        const advice = String(text || '').trim();
        if (!advice) return;
        const openChat = () => {
            const bubble = document.querySelector('df-messenger-chat-bubble');
            if (bubble && typeof bubble.openChat === 'function') bubble.openChat();
        };
        const render = () => {
            const df = document.querySelector('df-messenger');
            if (df && typeof df.renderCustomText === 'function') {
                df.renderCustomText(advice, true);
                return true;
            }
            return false;
        };
        openChat();
        if (render()) return;
        const handler = () => render();
        window.addEventListener('df-messenger-loaded', handler, { once: true });
        window.addEventListener('dfMessengerLoaded', handler, { once: true });
    }

    /* ──────────────────────────── HELPERS ────────────────────────── */

    const SAMPLE_LEVEL_ORDER = ['a2_b1', 'b2', 'c1'];

    function normalizeSampleLevels(sampleResponses) {
        if (!sampleResponses || typeof sampleResponses !== 'object') return {};
        const levels = sampleResponses.levels && typeof sampleResponses.levels === 'object' ? sampleResponses.levels : null;
        if (levels) return levels;

        // Backward compatibility: older dataset used sampleResponses.variants (assume B2).
        const legacy = Array.isArray(sampleResponses.variants) ? sampleResponses.variants : [];
        if (legacy.length > 0) return { b2: { label: 'B2', variants: legacy } };
        return {};
    }

    function sortLevelIds(ids) {
        const knownIndex = (id) => {
            const idx = SAMPLE_LEVEL_ORDER.indexOf(String(id));
            return idx >= 0 ? idx : 999;
        };
        return (ids || []).slice().sort((a, b) => {
            const ai = knownIndex(a);
            const bi = knownIndex(b);
            if (ai !== bi) return ai - bi;
            return String(a).localeCompare(String(b));
        });
    }

    function getApprovedSampleLevels(sampleResponses) {
        const levels = normalizeSampleLevels(sampleResponses);
        const out = {};
        Object.keys(levels || {}).forEach((levelId) => {
            const lvl = levels[levelId];
            const variants = lvl && typeof lvl === 'object' && Array.isArray(lvl.variants) ? lvl.variants : [];
            const approved = variants.filter(v => v && typeof v === 'object' && v.qa && v.qa.status === 'approved');
            if (approved.length > 0) {
                out[levelId] = {
                    label: (lvl && typeof lvl.label === 'string' && lvl.label.trim()) ? lvl.label.trim() : String(levelId),
                    variants: approved
                };
            }
        });
        return out;
    }

    function pickDefaultLevelId(approvedLevels) {
        if (approvedLevels && approvedLevels.b2) return 'b2';
        const ids = sortLevelIds(Object.keys(approvedLevels || {}));
        return ids.length > 0 ? ids[0] : '';
    }

    function splitEssayParagraphs(text) {
        const t = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
        if (!t) return [];
        return t.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
    }

    function renderSampleVariantHtml(variant, opts) {
        if (!variant || typeof variant !== 'object') return '';
        const levelLabel = opts && opts.levelLabel ? String(opts.levelLabel) : '';
        const essayParas = splitEssayParagraphs(variant.essay);
        const analysis = variant.analysis && typeof variant.analysis === 'object' ? variant.analysis : {};
        const vocab = Array.isArray(analysis.vocabulary) ? analysis.vocabulary : [];
        const ideaFlow = variant.ideaFlow && typeof variant.ideaFlow === 'object' ? variant.ideaFlow : null;
        const mindmap = ideaFlow && ideaFlow.mindmap ? String(ideaFlow.mindmap) : '';
        const flowchart = ideaFlow && ideaFlow.flowchart ? String(ideaFlow.flowchart) : '';

        const essayHtml = essayParas.length > 0
            ? essayParas.map(p => `<p>${escapeHtml(p)}</p>`).join('')
            : '<p>No essay text available.</p>';

        const ideaFlowHtml = (mindmap || flowchart) ? `
            <div class="essay-sample-ideaflow">
                <h4>Idea Flow</h4>
                ${mindmap ? `
                    <details class="essay-sample-ideaflow-block">
                        <summary>Mindmap</summary>
                        <pre class="essay-sample-pre">${escapeHtml(mindmap)}</pre>
                    </details>
                ` : ''}
                ${flowchart ? `
                    <details class="essay-sample-ideaflow-block">
                        <summary>Flowchart</summary>
                        <pre class="essay-sample-pre">${escapeHtml(flowchart)}</pre>
                    </details>
                ` : ''}
            </div>
        ` : '';

        const vocabRows = vocab.map(item => {
            if (!item || typeof item !== 'object') return '';
            return `
                <tr>
                    <td>${escapeHtml(item.term || '')}</td>
                    <td>${escapeHtml(item.enGloss || '')}</td>
                    <td>${escapeHtml(item.viGloss || '')}</td>
                </tr>
            `;
        }).join('');

        return `
            <div class="essay-sample-meta-row">
                ${levelLabel ? `<span class="essay-sample-meta-pill essay-sample-meta-muted">${escapeHtml(levelLabel)}</span>` : ''}
                <span class="essay-sample-meta-pill">${escapeHtml(variant.label || variant.id || 'Sample')}</span>
                ${variant.wordCount ? `<span class="essay-sample-meta-pill essay-sample-meta-muted">${escapeHtml(String(variant.wordCount))} words</span>` : ''}
            </div>

            <div class="essay-sample-essay">
                ${essayHtml}
            </div>

            ${ideaFlowHtml}

            <div class="essay-sample-analysis">
                <h4>Analysis</h4>
                <div class="essay-sample-analysis-grid">
                    <div><strong>Point one:</strong> ${escapeHtml(analysis.point1 || '')}</div>
                    <div><strong>Point two:</strong> ${escapeHtml(analysis.point2 || '')}</div>
                </div>

                ${vocab.length > 0 ? `
                    <h4>Vocabulary (EN + VI)</h4>
                    <div class="essay-sample-vocab-wrap">
                        <table class="essay-sample-vocab">
                            <thead>
                                <tr>
                                    <th>Term</th>
                                    <th>EN</th>
                                    <th>VI</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${vocabRows}
                            </tbody>
                        </table>
                    </div>
                ` : ''}
            </div>
        `;
    }

    function renderSampleEssays(sampleResponses) {
        const approvedLevels = getApprovedSampleLevels(sampleResponses);
        const levelIds = sortLevelIds(Object.keys(approvedLevels || {}));
        if (levelIds.length === 0) return '';

        const defaultLevelId = pickDefaultLevelId(approvedLevels);
        const selectedLevelId = defaultLevelId && approvedLevels[defaultLevelId] ? defaultLevelId : levelIds[0];
        const selectedLevel = approvedLevels[selectedLevelId];
        const approved = selectedLevel && Array.isArray(selectedLevel.variants) ? selectedLevel.variants : [];
        if (approved.length === 0) return '';

        const levelOptionsHtml = levelIds.map((lvlId) => {
            const lvl = approvedLevels[lvlId] || {};
            const lbl = lvl.label || lvlId;
            return `<option value="${escapeHtml(String(lvlId))}" ${String(lvlId) === String(selectedLevelId) ? 'selected' : ''}>${escapeHtml(String(lbl))}</option>`;
        }).join('');

        const optionsHtml = approved.map((v, i) => {
            const label = v.label || v.id || `Version ${i + 1}`;
            return `<option value="${escapeHtml(v.id || String(i))}">${escapeHtml(label)}</option>`;
        }).join('');

        return `
            <details class="essay-samples">
                <summary>
                    <span class="essay-samples-title">Sample Essays (${escapeHtml(String(selectedLevel.label || selectedLevelId))})</span>
                    <span class="essay-samples-count">${approved.length} version${approved.length === 1 ? '' : 's'}</span>
                </summary>
                <div class="essay-samples-body">
                    ${(levelIds.length > 1 || approved.length > 1) ? `
                        <div class="essay-sample-controls">
                            ${levelIds.length > 1 ? `
                                <label for="essay-sample-level-select">Level</label>
                                <select id="essay-sample-level-select" class="essay-sample-select">
                                    ${levelOptionsHtml}
                                </select>
                            ` : ''}
                            ${approved.length > 1 ? `
                                <label for="essay-sample-select">Version</label>
                                <select id="essay-sample-select" class="essay-sample-select">
                                    ${optionsHtml}
                                </select>
                            ` : ''}
                        </div>
                    ` : ''}
                    <div id="essay-sample-content" class="essay-sample-content">
                        ${renderSampleVariantHtml(approved[0], { levelId: selectedLevelId, levelLabel: selectedLevel.label || selectedLevelId })}
                    </div>
                </div>
            </details>
        `;
    }

    function initSampleEssaysUI(sampleResponses) {
        const approvedLevels = getApprovedSampleLevels(sampleResponses);
        const levelIds = sortLevelIds(Object.keys(approvedLevels || {}));
        if (levelIds.length === 0) return;

        const titleEl = document.querySelector('.essay-samples .essay-samples-title');
        const countEl = document.querySelector('.essay-samples .essay-samples-count');

        const levelSelect = document.getElementById('essay-sample-level-select');
        const variantSelect = document.getElementById('essay-sample-select');
        const content = document.getElementById('essay-sample-content');
        if (!content) return;

        let currentLevelId = pickDefaultLevelId(approvedLevels);
        if (!currentLevelId || !approvedLevels[currentLevelId]) currentLevelId = levelIds[0];

        const renderFor = (levelId, variantId) => {
            const lvl = approvedLevels[levelId];
            const variants = lvl && Array.isArray(lvl.variants) ? lvl.variants : [];
            if (variants.length === 0) return;

            const selected = variants.find(x => String(x.id) === String(variantId)) || variants[0];
            content.innerHTML = renderSampleVariantHtml(selected, { levelId, levelLabel: lvl.label || levelId });

            if (titleEl) titleEl.textContent = `Sample Essays (${String(lvl.label || levelId)})`;
            if (countEl) countEl.textContent = `${variants.length} version${variants.length === 1 ? '' : 's'}`;
        };

        const rebuildVariantSelect = (levelId) => {
            if (!variantSelect) return;
            const lvl = approvedLevels[levelId];
            const variants = lvl && Array.isArray(lvl.variants) ? lvl.variants : [];
            variantSelect.innerHTML = variants.map((v, i) => {
                const label = v.label || v.id || `Version ${i + 1}`;
                return `<option value="${escapeHtml(v.id || String(i))}">${escapeHtml(label)}</option>`;
            }).join('');
        };

        if (levelSelect) {
            levelSelect.addEventListener('change', () => {
                const nextLevelId = levelSelect.value;
                if (!approvedLevels[nextLevelId]) return;
                currentLevelId = nextLevelId;
                rebuildVariantSelect(currentLevelId);
                const vars = approvedLevels[currentLevelId] && Array.isArray(approvedLevels[currentLevelId].variants)
                    ? approvedLevels[currentLevelId].variants
                    : [];
                const firstVariantId = vars.length > 0 ? (vars[0].id || '') : '';
                renderFor(currentLevelId, firstVariantId);
            });
        }

        if (variantSelect) {
            variantSelect.addEventListener('change', () => {
                const id = variantSelect.value;
                renderFor(currentLevelId, id);
            });
        }

        // Initial render (keeps summary title/count in sync).
        rebuildVariantSelect(currentLevelId);
        const initialVars = approvedLevels[currentLevelId] && Array.isArray(approvedLevels[currentLevelId].variants)
            ? approvedLevels[currentLevelId].variants
            : [];
        const initialVariantId = variantSelect && variantSelect.value ? variantSelect.value : (initialVars[0] ? initialVars[0].id : '');
        renderFor(currentLevelId, initialVariantId);
    }

    function escapeHtml(str) {
        const d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
    }

    /* ──────────────────────────── PUBLIC API ─────────────────────── */

    /**
     * Teardown on mode exit. Previously the mode had none: leaving stopped the
     * timer only because callers happened to call reset(), and an open picker
     * sheet survived the switch.
     */
    function onExit() {
        stopTimer();
        closePicker();
        navHistory = [];
        reset();
    }

    window.WriteEssayMode = {
        init: init,
        reset: reset,
        onExit: onExit,
        loadEntries: loadEntries,
        updateAiScoreButtonState: updateAiScoreButtonState,
        shouldConfirmExit: shouldConfirmExit,
        onEnter: onEnter
    };

    function onEnter() {
        init();
        if (currentEntry?.id && window.PracticeRouter) {
            window.PracticeRouter.replaceRoute('essay', currentEntry.id);
        }
    }

    // Deep-link support: listen for PracticeRouter question navigation events
    window.addEventListener('practice-route-question', (event) => {
        const { mode, questionId } = event.detail || {};
        if (mode !== 'essay' || !questionId) return;
        if (!hasLoadedEntries || filteredEntries.length === 0) {
            pendingRouteQuestionId = questionId;
            return;
        }
        const idx = filteredEntries.findIndex((e) => String(e.id) === String(questionId));
        if (idx >= 0) {
            selectEntry(idx, { updateRoute: false });
        }
    });

})();
