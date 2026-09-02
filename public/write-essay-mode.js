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
    let essayElapsedSeconds = 0;
    let practiceKind = 'exam';
    let guidedLevel = 'b2';
    let guidedLanguage = 'en';
    let guidedPack = null;
    let guidedSection = 'understand';
    let guidedHintDepth = 1;
    let guidedSelectedVariantId = null;
    let guidedSelectedTargetIds = [];
    let guidedSelectedPointIds = [];
    let guidedExpandedPointExplId = null;
    let guidedQuizSelectedOption = null;
    let guidedPackRequestId = 0;
    // Disclosure + checklist state must outlive a re-render: switching step or
    // support language used to wipe every tick and reopen every group.
    let guidedVisitedSections = new Set(['understand']);
    let guidedOpenGroups = new Set();
    let guidedChecklistState = new Set();
    let guidedChecklistOpen = false;

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

    /* ──────────────── FULLSCREEN TOGGLE ──────────────── */
    const FULLSCREEN_STORAGE_KEY = 'essay-fullscreen';
    const EXPAND_SVG = '<path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"/>';
    const COMPRESS_SVG = '<path d="M4 14h6m0 0v6m0-6L3 21M20 10h-6m0 0V4m0 6l7-7"/>';
    let _modePanelEl = null;
    function getModePanelEl() {
        return _modePanelEl || (_modePanelEl = document.getElementById('mode-essay'));
    }

    /**
     * User-initiated toggle (button click).
     */
    function toggleEssayFullscreen() {
        const mp = getModePanelEl();
        if (!mp) return;
        const entering = !mp.classList.contains('essay-fullscreen');
        _applyFullscreen(entering);
        // Persist only on explicit user action
        _persistFullscreenPref(entering);
    }

    /**
     * Exit fullscreen when the user presses Escape.
     * Also clears the sessionStorage preference (deliberate exit).
     */
    function exitEssayFullscreen() {
        _applyFullscreen(false);
        _persistFullscreenPref(false);
    }

    /**
     * Internal: apply or remove the fullscreen CSS class + body scroll lock.
     * Does NOT touch sessionStorage — callers decide persistence.
     */
    function _applyFullscreen(on) {
        const mp = getModePanelEl();
        if (!mp) return;
        if (mp.classList.contains('essay-fullscreen') === on) return;

        mp.classList.toggle('essay-fullscreen', on);
        // Clean up writing phase when exiting fullscreen entirely
        if (!on) mp.classList.remove('essay-fs-writing');

        // Update button icon + label on all fullscreen buttons
        [el.fullscreenBtn, el.railFullscreenBtn].forEach(btn => {
            if (!btn) return;
            const svg = btn.querySelector('svg');
            const lbl = btn.querySelector('.essay-fullscreen-label');
            if (svg) svg.innerHTML = on ? COMPRESS_SVG : EXPAND_SVG;
            if (lbl) lbl.textContent = on ? 'Collapse' : 'Expand';
            btn.setAttribute('aria-pressed', String(on));
        });

        // Prevent body scroll behind the fixed overlay
        document.body.style.overflow = on ? 'hidden' : '';

        // Scroll overlay to top on enter so the user sees the full workspace
        if (on) mp.scrollTop = 0;
    }

    function _persistFullscreenPref(on) {
        try {
            if (on) sessionStorage.setItem(FULLSCREEN_STORAGE_KEY, '1');
            else sessionStorage.removeItem(FULLSCREEN_STORAGE_KEY);
        } catch (_) { /* quota / private mode */ }
    }

    function restoreEssayFullscreen() {
        try {
            if (sessionStorage.getItem(FULLSCREEN_STORAGE_KEY) === '1') {
                _applyFullscreen(true);
            }
        } catch (_) { /* ignore */ }
    }

    /* ── Guided Walkthrough & Writing Phase Transitions ─────────────── */

    /**
     * Transition from walkthrough to writing phase.
     * Reveals the essay textarea, displays the generated draft card, and focuses the editor.
     */
    function enterFsWritingPhase() {
        const mp = getModePanelEl();
        if (!mp) return;
        mp.classList.add('essay-writing-phase');
        if (mp.classList.contains('essay-fullscreen')) {
            mp.classList.add('essay-fs-writing');
        }
        // Ensure the compose card is visible
        if (el.stepWrite) el.stepWrite.style.display = 'block';

        // Render generated draft card based on user's choices in Steps 1-5
        renderGuidedDraft();

        if (el.essayInput) {
            el.essayInput.focus();
            el.essayInput.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
        }
    }

    /**
     * Return from writing phase back to walkthrough view.
     */
    function exitFsWritingPhase() {
        const mp = getModePanelEl();
        if (!mp) return;
        mp.classList.remove('essay-writing-phase');
        mp.classList.remove('essay-fs-writing');

        // Hide compose card if in guided walkthrough mode
        if (practiceKind === 'guided' && el.stepWrite) {
            el.stepWrite.style.display = 'none';
        }
        // Scroll back to top
        mp.scrollTop = 0;
        if (el.guidedRail) el.guidedRail.scrollTop = 0;
    }

    /**
     * Synthesize a coherent, academic 4-paragraph PTE essay draft from the user's
     * chosen stance, arguments, and sentence scaffolding frames.
     */
    function generateGuidedDraft(levelData) {
        if (!guidedPack || !levelData) return null;
        const common = guidedPack.common || {};
        const activePlan = (levelData.plans || []).find(p => p.variantId === guidedSelectedVariantId) || levelData.plans?.[0] || {};
        const variantId = activePlan.variantId || 'agree';
        const [body1Point, body2Point] = getSelectedPointsForPlan(activePlan, levelData, common);
        const stance = String(activePlan.stance || variantId).toLowerCase();
        const isDisagree = stance.includes('disagree');

        // Extract topic title or clean prompt
        const promptText = String(currentEntry?.prompt || '').trim();
        const topicName = (common.topics?.[0] || 'the given topic').toLowerCase();

        // 1. Introduction Paragraph
        let introP1 = `The debate surrounding whether ${promptText ? `"${promptText.replace(/^["“]|["”]$/g, '').trim()}"` : topicName} has garnered significant attention in contemporary society.`;
        if (activePlan.thesisFrame) {
            introP1 += ` In my perspective, I ${isDisagree ? 'firmly disagree with this viewpoint' : 'strongly advocate this point of view'} as ${activePlan.thesisFrame.replace(/^In my view,?\s*/i, '').replace(/\.$/, '')}.`;
        } else {
            introP1 += ` In my perspective, I ${isDisagree ? 'firmly disagree with this statement' : 'strongly agree with this notion'} due to several compelling educational and practical factors.`;
        }
        introP1 += ` This essay will examine how ${body1Point ? body1Point.replace(/\.$/, '').toLowerCase() : 'inflexible systems limit development'} and demonstrate that ${body2Point ? body2Point.replace(/\.$/, '').toLowerCase() : 'holistic approaches provide essential skills'}.`;

        // 2. Body Paragraph 1
        let body1 = `To begin with, the primary argument in support of this stance is that ${body1Point ? body1Point.replace(/\.$/, '') : 'standardized frameworks often constrain personal curiosity'}.`;
        body1 += ` Specifically, when instructional methods enforce rigid adherence to prescribed curricula, learners are frequently discouraged from pursuing self-directed exploration and critical thinking.`;
        body1 += ` For instance, empirical studies in educational psychology illustrate that students who are given the autonomy to explore concepts independently demonstrate superior retention and creative problem-solving skills compared to those subjected to rote memorization.`;
        body1 += ` Consequently, this evidence clearly substantiates the position that ${body1Point ? body1Point.replace(/\.$/, '').toLowerCase() : 'over-regulation hinders natural intellectual growth'}.`;

        // 3. Body Paragraph 2
        let body2 = `Furthermore, another vital aspect that warrants careful consideration is that ${body2Point ? body2Point.replace(/\.$/, '') : 'academic settings must balance foundational instruction with practical life aptitudes'}.`;
        body2 += ` That is to say, genuine competency extends beyond mere theoretical test scores to encompass collaborative teamwork, adaptability, and real-world application.`;
        body2 += ` A pertinent example can be observed in modern workplaces, where analytical resilience and emotional intelligence are consistently valued above mechanical recall of factual data.`;
        body2 += ` Hence, it becomes unequivocally clear that ${body2Point ? body2Point.replace(/\.$/, '').toLowerCase() : 'balanced learning environments cultivate lasting competence'}.`;

        // 4. Conclusion Paragraph
        let concl = `In conclusion, having analyzed both theoretical principles and practical ramifications, I reaffirm my conviction that ${isDisagree ? 'formal education remains fundamentally beneficial when properly adapted' : 'unyielding academic constraints can indeed impede meaningful self-discovery'}.`;
        concl += ` Looking forward, educational institutions should strive to harmonize rigorous academic benchmarks with flexible, passion-driven inquiry to optimize intellectual potential for future generations.`;

        const fullText = `${introP1}\n\n${body1}\n\n${body2}\n\n${concl}`;
        const wordCount = fullText.trim().split(/\s+/).length;

        return {
            stance: isDisagree ? 'DISAGREE' : 'AGREE',
            thesis: activePlan.thesisFrame || '',
            point1: body1Point,
            point2: body2Point,
            introduction: introP1,
            body1: body1,
            body2: body2,
            conclusion: concl,
            fullText: fullText,
            wordCount: wordCount
        };
    }

    /**
     * Render the generated draft card in the writing area.
     */
    function renderGuidedDraft() {
        if (!el.guidedDraftContainer) return;
        const levelData = getGuidedLevelData();
        const draft = generateGuidedDraft(levelData);
        if (!draft) {
            el.guidedDraftContainer.style.display = 'none';
            return;
        }

        el.guidedDraftContainer.style.display = 'block';
        el.guidedDraftContainer.innerHTML = `
            <div class="essay-guided-draft-header">
                <div class="essay-guided-draft-title">
                    <span>📝 ${guidedText('Generated Essay Draft', 'Dàn bài hoàn chỉnh từ Guided')}</span>
                    <span class="essay-guided-draft-badge">${escapeHtml(draft.stance)} · ~${draft.wordCount} words</span>
                </div>
                <div class="essay-guided-draft-actions">
                    <button type="button" class="essay-guided-draft-btn-insert" id="essay-draft-insert-btn" title="${guidedText('Populate this draft into the essay editor', 'Điền dàn bài này vào khung viết')}">
                        ⚡ ${guidedText('Insert Draft into Editor', 'Điền vào bài viết')}
                    </button>
                    <button type="button" class="essay-guided-draft-btn-copy" id="essay-draft-copy-btn" title="${guidedText('Copy entire draft to clipboard', 'Sao chép toàn bộ dàn bài')}">
                        📋 ${guidedText('Copy Draft', 'Sao chép')}
                    </button>
                </div>
            </div>
            <div class="essay-guided-draft-content">
                <div class="essay-guided-draft-para">
                    <div class="essay-guided-draft-para-label">📌 ${guidedText('1. Introduction', '1. Mở bài (Introduction)')}</div>
                    <p class="essay-guided-draft-para-text">${escapeHtml(draft.introduction)}</p>
                </div>
                <div class="essay-guided-draft-para">
                    <div class="essay-guided-draft-para-label">📌 ${guidedText('2. Body Paragraph 1 (Main Point 1)', '2. Thân bài 1 (Luận điểm 1)')}</div>
                    <p class="essay-guided-draft-para-text">${escapeHtml(draft.body1)}</p>
                </div>
                <div class="essay-guided-draft-para">
                    <div class="essay-guided-draft-para-label">📌 ${guidedText('3. Body Paragraph 2 (Main Point 2)', '3. Thân bài 2 (Luận điểm 2)')}</div>
                    <p class="essay-guided-draft-para-text">${escapeHtml(draft.body2)}</p>
                </div>
                <div class="essay-guided-draft-para">
                    <div class="essay-guided-draft-para-label">📌 ${guidedText('4. Conclusion', '4. Kết bài (Conclusion)')}</div>
                    <p class="essay-guided-draft-para-text">${escapeHtml(draft.conclusion)}</p>
                </div>
            </div>
        `;

        // Wire up dynamic buttons
        const insertBtn = document.getElementById('essay-draft-insert-btn');
        if (insertBtn) {
            insertBtn.addEventListener('click', () => {
                if (el.essayInput) {
                    el.essayInput.value = draft.fullText;
                    updateWordCount();
                    el.essayInput.focus();
                    el.essayInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    insertBtn.textContent = '✓ ' + guidedText('Draft Inserted!', 'Đã điền vào bài!');
                    setTimeout(() => {
                        insertBtn.innerHTML = '⚡ ' + guidedText('Insert Draft into Editor', 'Điền vào bài viết');
                    }, 2000);
                }
            });
        }

        const copyBtn = document.getElementById('essay-draft-copy-btn');
        if (copyBtn) {
            copyBtn.addEventListener('click', () => {
                copyGuidedText(draft.fullText, copyBtn);
            });
        }
    }

    /**
     * Watch for the mode panel being hidden externally (e.g. user switches
     * to a different practice mode via the tab bar). When that happens,
     * remove the fullscreen overlay so body.overflow isn't left locked.
     * Does NOT clear sessionStorage so fullscreen restores when they return.
     */
    function _watchForModeHide() {
        const mp = getModePanelEl();
        if (!mp || typeof MutationObserver === 'undefined') return;
        const obs = new MutationObserver(() => {
            if (mp.style.display === 'none' && mp.classList.contains('essay-fullscreen')) {
                _applyFullscreen(false);
            }
        });
        obs.observe(mp, { attributes: true, attributeFilter: ['style'] });
    }

    function reset() {
        stopTimer();
        _applyFullscreen(false);
        const mp = getModePanelEl();
        if (mp) {
            mp.classList.remove('essay-guided-mode');
            mp.classList.remove('essay-writing-phase');
            mp.classList.remove('essay-fs-writing');
        }
        if (el.guidedDraftContainer) el.guidedDraftContainer.style.display = 'none';
        if (window.WriteEssaySupport?.abortPackLoad) window.WriteEssaySupport.abortPackLoad();
        isSubmitting = false;
        isAiScoring = false;
        activeFeedbackRequestId = 0;
        lastSubmittedEssayText = '';
        lastSubmittedEssayPrompt = '';
        lastSubmittedEssayWordCount = 0;
        lastBasicFeedbackSectionsHtml = '';
        lastArchiveAttemptId = null;
        lastArchiveSavePromise = null;
        essayElapsedSeconds = 0;
        guidedPack = null;
        guidedSection = 'understand';
        guidedHintDepth = 1;
        guidedSelectedVariantId = null;
        guidedSelectedTargetIds = [];
        guidedSelectedPointIds = [];
        guidedExpandedPointExplId = null;
        guidedQuizSelectedOption = null;
        guidedPackRequestId += 1;
        guidedVisitedSections = new Set(['understand']);
        guidedOpenGroups = new Set();
        guidedChecklistState = new Set();
        guidedChecklistOpen = false;
        if (el.practiceArea) el.practiceArea.style.display = 'none';
        if (el.stepWrite) el.stepWrite.style.display = 'none';
        if (el.stepResults) el.stepResults.style.display = 'none';
        if (el.essayInput) { el.essayInput.value = ''; el.essayInput.readOnly = false; }
        if (el.startBtn) el.startBtn.style.display = '';
        if (el.practiceChoice) el.practiceChoice.style.display = '';
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
        if (el.guidedRail) el.guidedRail.hidden = true;
        if (el.guidedChecklist) { el.guidedChecklist.hidden = true; el.guidedChecklist.innerHTML = ''; }
        if (el.guidedRecycle) { el.guidedRecycle.hidden = true; el.guidedRecycle.innerHTML = ''; }
        if (el.guidedUnavailable) { el.guidedUnavailable.hidden = true; el.guidedUnavailable.innerHTML = ''; }
        updatePracticeChoiceUI();
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
        el.practiceChoice = document.getElementById('essay-practice-choice');
        el.guidedPreferences = document.getElementById('essay-guided-preferences');
        el.guidedLevel = document.getElementById('essay-guided-level');
        el.guidedLanguage = document.getElementById('essay-guided-language');

        // Filters
        el.filterToolbar = document.getElementById('essay-filter-toolbar');
        el.filterType = document.getElementById('essay-filter-type');
        el.filterTopic = document.getElementById('essay-filter-topic');
        el.filterCounter = document.getElementById('essay-filter-counter');
        el.filterResetBtn = document.getElementById('essay-filter-reset');

        // Practice area
        el.practiceArea = document.getElementById('essay-practice-area');
        el.guidedWorkspace = document.getElementById('essay-guided-workspace');
        el.guidedRail = document.getElementById('essay-guided-rail');
        el.guidedRailTitle = document.getElementById('essay-guided-rail-title');
        el.guidedLanguageToggle = document.getElementById('essay-guided-language-toggle');
        el.guidedMobileToggle = document.getElementById('essay-guided-mobile-toggle');
        el.guidedUnavailable = document.getElementById('essay-guided-unavailable');
        el.guidedNav = document.getElementById('essay-guided-nav');
        el.guidedProgress = document.getElementById('essay-guided-progress');
        el.guidedContent = document.getElementById('essay-guided-content');
        el.guidedChecklist = document.getElementById('essay-guided-checklist');
        el.guidedRecycle = document.getElementById('essay-guided-recycle');
        el.requestGuidedBtn = document.getElementById('essay-request-guided-btn');
        el.fullscreenBtn = document.getElementById('essay-fullscreen-btn');
        el.railFullscreenBtn = document.getElementById('essay-rail-fullscreen-btn');
        el.fsReadyBtn = document.getElementById('essay-fs-ready-btn');
        el.fsBackBtn = document.getElementById('essay-fs-back-btn');
        el.guidedDraftContainer = document.getElementById('essay-guided-draft-container');

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
            if (e.key === 'Escape') {
                // Exit fullscreen first if active
                const mp = getModePanelEl();
                if (mp && mp.classList.contains('essay-fullscreen')) {
                    exitEssayFullscreen();
                    return;
                }
                if (pickerOpen) {
                    closePicker();
                    if (el.questionPill) el.questionPill.focus();
                }
            }
        });
        if (el.startBtn) el.startBtn.addEventListener('click', startPractice);
        if (el.essayInput) el.essayInput.addEventListener('input', updateWordCount);
        if (el.submitBtn) el.submitBtn.addEventListener('click', submitEssay);
        if (el.retryBtn) el.retryBtn.addEventListener('click', retryPractice);
        if (el.aiScoreBtn) el.aiScoreBtn.addEventListener('click', submitToGeminiScoring);
        if (el.localAiScoreBtn) el.localAiScoreBtn.addEventListener('click', submitToLocalAiScoring);
        document.querySelectorAll('input[name="essay-practice-kind"]').forEach(input => {
            input.addEventListener('change', () => {
                practiceKind = input.checked ? input.value : practiceKind;
                updatePracticeChoiceUI();
            });
        });
        if (el.guidedLevel) el.guidedLevel.addEventListener('change', () => {
            guidedLevel = el.guidedLevel.value;
            persistGuidedPreferences();
        });
        if (el.guidedLanguage) el.guidedLanguage.addEventListener('change', () => {
            guidedLanguage = el.guidedLanguage.value;
            persistGuidedPreferences();
        });
        if (el.guidedLanguageToggle) el.guidedLanguageToggle.addEventListener('click', toggleGuidedLanguage);
        if (el.guidedMobileToggle) el.guidedMobileToggle.addEventListener('click', toggleGuidedMobileRail);
        if (el.guidedNav) el.guidedNav.addEventListener('click', onGuidedSectionChosen);
        if (el.guidedContent) el.guidedContent.addEventListener('click', onGuidedContentAction);
        if (el.guidedChecklist) {
            el.guidedChecklist.addEventListener('change', updateGuidedChecklistState);
            el.guidedChecklist.addEventListener('click', onGuidedChecklistClick);
        }
        if (el.requestGuidedBtn) el.requestGuidedBtn.addEventListener('click', requestGuidedHelpMidAttempt);
        if (el.fullscreenBtn) el.fullscreenBtn.addEventListener('click', toggleEssayFullscreen);
        if (el.railFullscreenBtn) el.railFullscreenBtn.addEventListener('click', toggleEssayFullscreen);
        if (el.fsReadyBtn) el.fsReadyBtn.addEventListener('click', enterFsWritingPhase);
        if (el.fsBackBtn) el.fsBackBtn.addEventListener('click', exitFsWritingPhase);
        _watchForModeHide();
        restoreGuidedPreferences();
    }

    function restoreGuidedPreferences() {
        const prefs = window.WriteEssaySupport?.readPreferences?.() || {};
        const profile = window.currentUserProfile || null;
        guidedLevel = window.WriteEssaySupport?.resolveSupportLevel?.({
            profile,
            onboardingLevel: prefs.onboardingLevel || profile?.englishLevel,
            manualOverride: prefs.level,
        }) || prefs.level || 'b2';
        guidedLanguage = prefs.language === 'vi' ? 'vi' : 'en';
        if (el.guidedLevel) el.guidedLevel.value = guidedLevel;
        if (el.guidedLanguage) el.guidedLanguage.value = guidedLanguage;
        updatePracticeChoiceUI();
    }

    function persistGuidedPreferences() {
        window.WriteEssaySupport?.writePreferences?.({ level: guidedLevel, language: guidedLanguage });
    }

    function updatePracticeChoiceUI() {
        const guided = practiceKind === 'guided';
        if (el.guidedPreferences) el.guidedPreferences.hidden = !guided;
        if (el.practiceChoice) el.practiceChoice.dataset.mode = practiceKind;
        const selected = document.querySelector(`input[name="essay-practice-kind"][value="${practiceKind}"]`);
        if (selected) selected.checked = true;
    }

    function getGuidedLevelData() {
        return guidedPack?.levels?.[guidedLevel] || null;
    }

    function bilingual(item, enKey = 'en', viKey = 'vi') {
        if (!item) return '';
        return String(item[guidedLanguage === 'vi' ? viKey : enKey] || item[enKey] || item[viKey] || '').trim();
    }

    function guidedText(en, vi) {
        return guidedLanguage === 'vi' ? (vi || en) : (en || vi);
    }

    function toggleGuidedLanguage() {
        guidedLanguage = guidedLanguage === 'en' ? 'vi' : 'en';
        if (el.guidedLanguage) el.guidedLanguage.value = guidedLanguage;
        persistGuidedPreferences();
        renderGuidedSupport();
        if (getModePanelEl()?.classList.contains('essay-writing-phase')) {
            renderGuidedDraft();
        }
    }

    function toggleGuidedMobileRail() {
        if (!el.guidedRail || !el.guidedMobileToggle) return;
        const collapsed = el.guidedRail.classList.toggle('is-collapsed');
        el.guidedMobileToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        el.guidedMobileToggle.textContent = collapsed ? guidedText('Expand', 'Mở rộng') : guidedText('Collapse', 'Thu gọn');
    }

    /* ──────────────────────── GUIDED SUPPORT RENDERING ───────────── */
    /*
       The rail is a six-step walkthrough, not a document. Each step shows one
       job, long lists live behind disclosure groups, and a footer moves the
       learner forward so nothing arrives as a single wall of text.
    */

    const GUIDED_SECTIONS = Object.freeze([
        { id: 'understand', icon: '🔍', en: 'Understand the prompt', vi: 'Hiểu đề bài' },
        { id: 'direction', icon: '🧭', en: 'Choose a direction', vi: 'Chọn hướng đi' },
        { id: 'language', icon: '🧰', en: 'Language kit', vi: 'Bộ ngôn ngữ' },
        { id: 'plan', icon: '🗂️', en: 'Make a plan', vi: 'Lập dàn ý' },
        { id: 'further', icon: '✍️', en: 'Sentence support', vi: 'Hỗ trợ từng câu' },
        { id: 'faq', icon: '💬', en: 'FAQ', vi: 'Hỏi đáp' },
    ]);

    const GUIDED_MAX_TARGETS = 6;
    const GUIDED_DEFAULT_OPEN_GROUPS = ['parts', 'requirements', 'vocabulary'];

    // Machine role keys ship inside the packs; learners must never see them.
    const GUIDED_SEGMENT_ROLES = Object.freeze({
        prompt_clause: { en: 'Prompt part', vi: 'Phần đề' },
        statement: { en: 'Statement', vi: 'Nhận định' },
        question: { en: 'Question', vi: 'Câu hỏi' },
        instruction: { en: 'Instruction', vi: 'Yêu cầu' },
        context: { en: 'Context', vi: 'Bối cảnh' },
    });

    function guidedSectionIndex(id) {
        const index = GUIDED_SECTIONS.findIndex(section => section.id === id);
        return index < 0 ? 0 : index;
    }

    function guidedSectionLabel(section) {
        return guidedText(section.en, section.vi);
    }

    function guidedTargetKey(target) {
        return String(target?.term || target?.id || '').trim();
    }

    function guidedSegmentRoleLabel(role) {
        const known = GUIDED_SEGMENT_ROLES[String(role || '').trim().toLowerCase()];
        if (known) return guidedText(known.en, known.vi);
        return guidedText('Prompt part', 'Phần đề');
    }

    /**
     * Some packs carry a Vietnamese string that is only an English sentence with
     * a Vietnamese label glued on front. Showing that is worse than showing the
     * English, so fall back whenever the translation adds no Vietnamese.
     */
    function preferTranslated(en, vi) {
        const source = String(en || '').trim();
        const translated = String(vi || '').trim();
        if (!translated) return source;
        if (!source) return translated;
        const stripped = translated.replace(/^[^:]{1,24}:\s*/, '').trim();
        if (stripped.toLowerCase() === source.toLowerCase()) return source;
        return translated;
    }

    function isGuidedGroupOpen(key, defaultOpen = false) {
        if (guidedOpenGroups.has(`-${key}`)) return false;
        if (guidedOpenGroups.has(key)) return true;
        return defaultOpen;
    }

    function setGuidedGroupOpen(key, open) {
        guidedOpenGroups.delete(key);
        guidedOpenGroups.delete(`-${key}`);
        guidedOpenGroups.add(open ? key : `-${key}`);
    }

    /** Collapsible block: the main tool against the old wall of bullet lists. */
    function guidedGroup(key, title, bodyHtml, { count = null, defaultOpen = false, tone = '' } = {}) {
        if (!bodyHtml) return '';
        const open = isGuidedGroupOpen(key, defaultOpen);
        const badge = count === null ? '' : `<span class="essay-guided-group-count">${escapeHtml(String(count))}</span>`;
        return `<div class="essay-guided-group${open ? ' is-open' : ''}${tone ? ` essay-guided-group--${tone}` : ''}">
            <button type="button" class="essay-guided-group-toggle" data-guided-action="toggle-group" data-group-key="${escapeHtml(key)}" aria-expanded="${open ? 'true' : 'false'}">
                <span class="essay-guided-group-title">${escapeHtml(title)}</span>
                ${badge}
                <span class="essay-guided-group-chevron" aria-hidden="true"></span>
            </button>
            <div class="essay-guided-group-body"${open ? '' : ' hidden'}>${bodyHtml}</div>
        </div>`;
    }

    function guidedSectionHead(section, lede) {
        const index = guidedSectionIndex(section.id);
        return `<header class="essay-guided-section-head">
            <span class="essay-guided-step-tag">${guidedText('Step', 'Bước')} ${index + 1}/${GUIDED_SECTIONS.length}</span>
            <h3><span class="essay-guided-section-icon" aria-hidden="true">${section.icon}</span>${escapeHtml(guidedSectionLabel(section))}</h3>
            ${lede ? `<p class="essay-guided-section-lede">${escapeHtml(lede)}</p>` : ''}
        </header>`;
    }

    function guidedStepNav() {
        const index = guidedSectionIndex(guidedSection);
        const prev = GUIDED_SECTIONS[index - 1];
        const next = GUIDED_SECTIONS[index + 1];
        const prevBtn = prev
            ? `<button type="button" class="essay-guided-stepnav-btn" data-guided-action="go-section" data-section-id="${escapeHtml(prev.id)}">← ${escapeHtml(guidedSectionLabel(prev))}</button>`
            : '<span></span>';
        const nextBtn = next
            ? `<button type="button" class="essay-guided-stepnav-btn is-primary" data-guided-action="go-section" data-section-id="${escapeHtml(next.id)}">${escapeHtml(guidedSectionLabel(next))} →</button>`
            : `<button type="button" class="essay-guided-stepnav-btn is-primary" data-guided-action="focus-editor">${guidedText('Start writing', 'Bắt đầu viết')} →</button>`;
        return `<nav class="essay-guided-stepnav" aria-label="${guidedText('Support step navigation', 'Điều hướng bước hỗ trợ')}">${prevBtn}${nextBtn}</nav>`;
    }

    function goToGuidedSection(id) {
        const target = GUIDED_SECTIONS.find(section => section.id === id);
        if (!target) return;
        guidedSection = target.id;
        guidedVisitedSections.add(target.id);
        renderGuidedSupport();
        if (el.guidedContent?.scrollIntoView) {
            el.guidedRail?.scrollTo?.({ top: 0, behavior: 'smooth' });
        }
    }

    function onGuidedSectionChosen(event) {
        const button = event.target.closest('[data-guided-section]');
        if (!button || !guidedPack) return;
        goToGuidedSection(button.dataset.guidedSection || 'understand');
    }

    async function copyGuidedText(text, button) {
        const value = String(text || '');
        if (!value) return;
        try {
            await navigator.clipboard?.writeText(value);
            if (!button) return;
            const original = button.dataset.copyLabel || button.textContent;
            button.dataset.copyLabel = original;
            button.textContent = guidedText('Copied', 'Đã sao chép');
            button.classList.add('is-copied');
            setTimeout(() => {
                button.textContent = button.dataset.copyLabel || original;
                button.classList.remove('is-copied');
            }, 1400);
        } catch (_) { /* clipboard blocked; nothing to recover */ }
    }

    function onGuidedContentAction(event) {
        const target = event.target.closest('[data-guided-action]');
        if (!target) return;
        const action = target.dataset.guidedAction;
        if (action === 'retry-pack') {
            loadGuidedPack({ force: true });
        } else if (action === 'go-section') {
            goToGuidedSection(target.dataset.sectionId);
        } else if (action === 'toggle-group') {
            const key = target.dataset.groupKey;
            if (!key) return;
            const open = target.getAttribute('aria-expanded') !== 'true';
            setGuidedGroupOpen(key, open);
            const group = target.closest('.essay-guided-group');
            const body = group?.querySelector('.essay-guided-group-body');
            target.setAttribute('aria-expanded', open ? 'true' : 'false');
            group?.classList.toggle('is-open', open);
            if (body) body.hidden = !open;
        } else if (action === 'focus-editor') {
            enterFsWritingPhase();
        } else if (action === 'answer-prompt-quiz') {
            const optIdx = Number(target.dataset.optionIndex);
            guidedQuizSelectedOption = isNaN(optIdx) ? null : optIdx;
            renderGuidedSupport();
        } else if (action === 'select-variant') {
            guidedSelectedVariantId = target.dataset.variantId || null;
            guidedSelectedPointIds = [];
            guidedExpandedPointExplId = null;
            renderGuidedSupport();
        } else if (action === 'select-point') {
            const pointId = target.dataset.pointId;
            if (pointId) {
                const idx = guidedSelectedPointIds.indexOf(pointId);
                if (idx >= 0) {
                    if (guidedSelectedPointIds.length > 1) {
                        guidedSelectedPointIds.splice(idx, 1);
                    }
                } else {
                    if (guidedSelectedPointIds.length >= 2) {
                        guidedSelectedPointIds.shift();
                    }
                    guidedSelectedPointIds.push(pointId);
                }
                renderGuidedSupport();
            }
        } else if (action === 'toggle-point-expl') {
            const pointId = target.dataset.pointId;
            guidedExpandedPointExplId = guidedExpandedPointExplId === pointId ? null : pointId;
            renderGuidedSupport();
        } else if (action === 'set-depth') {
            guidedHintDepth = Math.min(3, Math.max(1, Number(target.dataset.depth) || 1));
            renderGuidedSupport();
        } else if (action === 'reveal-hint') {
            guidedHintDepth = Math.min(3, Math.max(guidedHintDepth, Number(target.dataset.depth) || 1));
            renderGuidedSupport();
        } else if (action === 'copy') {
            copyGuidedText(target.dataset.copyText, target);
        } else if (action === 'target') {
            const id = target.dataset.targetId;
            if (!id) return;
            const existing = guidedSelectedTargetIds.indexOf(id);
            if (existing >= 0) {
                guidedSelectedTargetIds.splice(existing, 1);
            } else if (guidedSelectedTargetIds.length < GUIDED_MAX_TARGETS) {
                guidedSelectedTargetIds.push(id);
            } else {
                return;
            }
            renderGuidedSupport();
        } else if (action === 'tutor') {
            const handoff = guidedPack?.common?.tutorHandoff;
            if (handoff) {
                const context = bilingual(handoff, 'contextEn', 'contextVi')
                    .replace('{questionId}', String(currentEntry?.id || ''));
                postTeacherAdviceToChat(`${context}\n\nPrompt: ${currentEntry?.prompt || ''}\nSelected direction: ${guidedSelectedVariantId || 'not selected'}\nSelected target IDs: ${guidedSelectedTargetIds.join(', ') || 'none'}`);
            }
        }
    }

    function renderGuidedUnavailable(message) {
        if (!el.guidedUnavailable) return;
        el.guidedUnavailable.hidden = false;
        el.guidedUnavailable.innerHTML = `<p>${escapeHtml(message || guidedText('Guided support is temporarily unavailable.', 'Hỗ trợ Guided hiện tạm thời không khả dụng.'))}</p><button type="button" data-guided-action="retry-pack">${guidedText('Retry', 'Thử lại')}</button>`;
        if (el.guidedContent) el.guidedContent.innerHTML = '';
    }

    async function loadGuidedPack({ force = false } = {}) {
        if (practiceKind !== 'guided' || !currentEntry || !window.WriteEssaySupport?.loadPack) return null;
        const requestId = ++guidedPackRequestId;
        guidedPack = null;
        if (el.guidedUnavailable) { el.guidedUnavailable.hidden = true; el.guidedUnavailable.innerHTML = ''; }
        renderGuidedSupport();
        try {
            const pack = await window.WriteEssaySupport.loadPack(currentEntry.id, { force });
            if (requestId !== guidedPackRequestId || !currentEntry) return null;
            guidedPack = pack;
            guidedSelectedVariantId = getGuidedLevelData()?.plans?.[0]?.variantId || null;
            const levelData = getGuidedLevelData();
            // Chips in the Language kit are keyed by term, so seed the selection
            // the same way or the counter reads 2/6 with nothing highlighted.
            guidedSelectedTargetIds = (levelData?.coreTargets || []).slice(0, 2).map(guidedTargetKey);
            renderGuidedSupport();
            return pack;
        } catch (error) {
            if (error?.name === 'AbortError') return null;
            if (requestId !== guidedPackRequestId) return null;
            renderGuidedUnavailable(error?.message);
            return null;
        }
    }

    function renderGuidedNav() {
        if (!el.guidedNav) return;
        const enabled = Boolean(guidedPack);
        el.guidedNav.innerHTML = GUIDED_SECTIONS.map((section, index) => {
            const active = section.id === guidedSection;
            const visited = guidedVisitedSections.has(section.id) && !active;
            return `<button type="button" data-guided-section="${escapeHtml(section.id)}" class="${active ? 'is-active' : ''}${visited ? ' is-visited' : ''}" aria-current="${active ? 'step' : 'false'}"${enabled ? '' : ' disabled'}>
                <span class="essay-guided-nav-index" aria-hidden="true">${visited ? '✓' : index + 1}</span>
                <span class="essay-guided-nav-label">${escapeHtml(guidedSectionLabel(section))}</span>
            </button>`;
        }).join('');
    }

    function renderGuidedProgress() {
        if (!el.guidedProgress) return;
        const index = guidedSectionIndex(guidedSection);
        const percent = Math.round(((index + 1) / GUIDED_SECTIONS.length) * 100);
        el.guidedProgress.innerHTML = `<div class="essay-guided-progress-bar"><span style="width:${percent}%"></span></div>`;
        el.guidedProgress.hidden = !guidedPack;
    }

    function renderGuidedSupport() {
        if (!el.guidedRail) return;
        el.guidedRail.hidden = practiceKind !== 'guided';
        if (practiceKind !== 'guided') return;
        if (el.guidedRailTitle) el.guidedRailTitle.textContent = guidedText('Guided support', 'Hỗ trợ Guided');
        if (el.guidedLanguageToggle) {
            el.guidedLanguageToggle.textContent = guidedLanguage === 'en' ? 'VI' : 'EN';
            el.guidedLanguageToggle.title = guidedLanguage === 'en' ? 'Chuyển sang tiếng Việt' : 'Switch to English';
        }
        guidedVisitedSections.add(guidedSection);
        renderGuidedNav();
        renderGuidedProgress();
        if (!guidedPack) {
            if (el.guidedContent) el.guidedContent.innerHTML = `<div class="essay-guided-loading"><span class="essay-guided-spinner" aria-hidden="true"></span>${guidedText('Loading prompt-specific support…', 'Đang tải hỗ trợ riêng cho đề…')}</div>`;
            if (el.guidedChecklist) el.guidedChecklist.hidden = true;
            if (el.guidedRecycle) el.guidedRecycle.hidden = true;
            return;
        }
        const levelData = getGuidedLevelData();
        if (!levelData) { renderGuidedUnavailable(guidedText('This support level is unavailable.', 'Mức hỗ trợ này không khả dụng.')); return; }
        const section = guidedSection;
        let html = '';
        if (section === 'understand') html = renderGuidedUnderstand();
        if (section === 'direction') html = renderGuidedDirection(levelData);
        if (section === 'language') html = renderGuidedLanguage(levelData);
        if (section === 'plan') html = renderGuidedPlan(levelData);
        if (section === 'further') html = renderGuidedFurther(levelData);
        if (section === 'faq') html = renderGuidedFaq();
        if (el.guidedContent) el.guidedContent.innerHTML = html + guidedStepNav();
        renderGuidedChecklist();
        renderGuidedRecycle(levelData);
    }

    function buildPromptQuiz(pack, entry) {
        const rawType = (entry?.standardizedTaskType || entry?.promptType || '').toLowerCase();
        
        let correctTextEn = 'Take a clear stance and defend it with specific reasons and real-world examples.';
        let correctTextVi = 'Chọn một lập trường rõ ràng (đồng ý hoặc không đồng ý) và bảo vệ bằng các lý do, dẫn chứng cụ thể.';
        let d1En = 'Just summarize general background facts without giving any personal viewpoint.';
        let d1Vi = 'Chỉ tóm tắt sự thật chung mà không thể hiện quan điểm cá nhân rõ ràng.';
        let d2En = 'List every possible opinion without organizing them into structured paragraphs.';
        let d2Vi = 'Liệt kê mọi ý kiến rời rạc mà không phân chia bố cục đoạn văn mạch lạc.';

        if (rawType.includes('advantage') || rawType.includes('outweigh')) {
            correctTextEn = 'Analyze both advantages and disadvantages, then state which side is stronger.';
            correctTextVi = 'Phân tích cả mặt thuận lợi lẫn bất lợi, sau đó kết luận mặt nào chiếm ưu thế hơn.';
            d1En = 'Only discuss the positive aspects and completely ignore drawbacks.';
            d1Vi = 'Chỉ nói về mặt tích cực và bỏ qua hoàn toàn các hạn chế.';
        } else if (rawType.includes('cause') || rawType.includes('solution') || rawType.includes('problem')) {
            correctTextEn = 'Identify the root causes and propose realistic, actionable solutions.';
            correctTextVi = 'Chỉ ra các nguyên nhân gốc rễ và đề xuất các giải pháp thực tế, khả thi.';
            d1En = 'Argue whether the problem is good or bad without proposing solutions.';
            d1Vi = 'Tranh cãi vấn đề là tốt hay xấu mà không đề xuất giải pháp nào.';
        } else if (rawType.includes('both') || rawType.includes('discuss')) {
            correctTextEn = 'Examine both perspectives fairly before concluding with your own reasoned position.';
            correctTextVi = 'Xem xét công bằng cả hai quan điểm trước khi đưa ra kết luận và lập trường của bạn.';
            d1En = 'Only discuss one perspective and dismiss the other side immediately.';
            d1Vi = 'Chỉ bàn luận một góc nhìn duy nhất và bác bỏ ngay góc nhìn còn lại.';
        }

        const options = [
            { en: correctTextEn, vi: correctTextVi, isCorrect: true },
            { en: d1En, vi: d1Vi, isCorrect: false },
            { en: d2En, vi: d2Vi, isCorrect: false },
        ];
        return {
            questionEn: 'Quick Check: What is the core task required for this essay prompt?',
            questionVi: 'Kiểm tra nhanh: Yêu cầu cốt lõi bạn cần thực hiện cho đề bài này là gì?',
            options,
        };
    }

    function renderGuidedUnderstand() {
        const common = guidedPack.common || {};
        const section = GUIDED_SECTIONS[0];

        // 1. Interactive Prompt Comprehension Quiz
        const quiz = buildPromptQuiz(guidedPack, currentEntry);
        const isAnswered = guidedQuizSelectedOption !== null;
        const selectedOpt = isAnswered ? quiz.options[guidedQuizSelectedOption] : null;

        const quizHtml = `<div class="essay-guided-quiz">
            <div class="essay-guided-quiz-head">
                <span class="essay-guided-quiz-badge">💡 ${guidedText('Comprehension Check', 'Kiểm tra nhanh')}</span>
                <p class="essay-guided-quiz-question">${escapeHtml(guidedText(quiz.questionEn, quiz.questionVi))}</p>
            </div>
            <div class="essay-guided-quiz-options">
                ${quiz.options.map((opt, idx) => {
                    const isSelected = guidedQuizSelectedOption === idx;
                    let statusClass = '';
                    if (isAnswered) {
                        if (opt.isCorrect) statusClass = ' is-correct';
                        else if (isSelected) statusClass = ' is-incorrect';
                    }
                    return `<button type="button" class="essay-guided-quiz-opt${statusClass}${isSelected ? ' is-selected' : ''}" data-guided-action="answer-prompt-quiz" data-option-index="${idx}">
                        <span class="essay-guided-quiz-radio" aria-hidden="true">${opt.isCorrect && isAnswered ? '✓' : (isSelected && !opt.isCorrect ? '✕' : (idx + 1))}</span>
                        <span class="essay-guided-quiz-text">${escapeHtml(preferTranslated(opt.en, guidedLanguage === 'vi' ? opt.vi : ''))}</span>
                    </button>`;
                }).join('')}
            </div>
            ${isAnswered ? `
            <div class="essay-guided-quiz-feedback ${selectedOpt?.isCorrect ? 'is-success' : 'is-warning'}">
                <span class="essay-guided-quiz-feedback-icon" aria-hidden="true">${selectedOpt?.isCorrect ? '🎉' : '⚠️'}</span>
                <div>
                    <strong>${selectedOpt?.isCorrect ? guidedText('Correct! You identified the core requirements.', 'Chính xác! Bạn đã nắm đúng dạng bài và yêu cầu cốt lõi.') : guidedText('Not quite. Review the requirements checklist below.', 'Chưa chính xác. Hãy xem kỹ phần Yêu cầu bắt buộc ở bên dưới để nắm đúng dạng bài.')}</strong>
                    <p>${selectedOpt?.isCorrect ? guidedText('Proceed to the next step to select your stance and main points.', 'Hãy tiếp tục sang bước tiếp theo để chọn lập trường và luận điểm phù hợp.') : guidedText('Make sure to address all parts of the question to achieve high task achievement.', 'Đảm bảo trả lời đầy đủ các phần của đề để đạt điểm tối đa.')}</p>
                </div>
            </div>` : ''}
        </div>`;

        // 2. Prompt Segments (Structure)
        const segments = common.promptSegments || [];
        const showRoles = new Set(segments.map(segment => String(segment.role || ''))).size > 1;
        const segmentsHtml = segments.length ? `<ol class="essay-guided-parts">${segments.map((segment, index) => `<li>
            <span class="essay-guided-part-index" aria-hidden="true">${index + 1}</span>
            <div>${showRoles ? `<span class="essay-guided-part-role">${escapeHtml(guidedSegmentRoleLabel(segment.role))}</span>` : ''}<p>${escapeHtml(segment.text)}</p></div>
        </li>`).join('')}</ol>` : '';

        // 3. Requirements
        const reqs = common.requirements || [];
        const reqsHtml = reqs.length ? `<ul class="essay-guided-ticklist">${reqs.map(item => `<li><span class="essay-guided-check" aria-hidden="true">✓</span><span>${escapeHtml(bilingual(item))}</span></li>`).join('')}</ul>` : '';

        // 4. Traps
        const traps = common.promptTraps || [];
        const trapsHtml = traps.length ? `<ul class="essay-guided-ticklist essay-guided-ticklist--warn">${traps.map(item => `<li><span class="essay-guided-warn" aria-hidden="true">!</span><span>${escapeHtml(bilingual(item))}</span></li>`).join('')}</ul>` : '';

        // 5. Grouped Stances & Approaches (Angles)
        const angles = common.angles || [];
        const grouped = {};
        angles.forEach((item, idx) => {
            let stanceKey = String(item.sourceVariantId || 'general').trim().toLowerCase();
            if (!stanceKey || stanceKey === 'undefined') stanceKey = 'general';
            if (!grouped[stanceKey]) grouped[stanceKey] = [];
            grouped[stanceKey].push({ ...item, originalIndex: idx });
        });

        const stanceLabels = {
            agree: { en: 'Stance 1: Agree / Support', vi: 'Hướng 1: Quan điểm Đồng ý (Agree)', icon: '👍', tone: 'agree' },
            disagree: { en: 'Stance 2: Disagree / Alternative', vi: 'Hướng 2: Quan điểm Không đồng ý (Disagree)', icon: '👎', tone: 'disagree' },
            advantage: { en: 'Advantages / Positive Aspects', vi: 'Mặt Thuận lợi / Tích cực', icon: '✨', tone: 'agree' },
            disadvantage: { en: 'Disadvantages / Negative Aspects', vi: 'Mặt Bất lợi / Hạn chế', icon: '⚠️', tone: 'disagree' },
            general: { en: 'Key Perspectives', vi: 'Các góc nhìn trọng tâm', icon: '🎯', tone: 'general' }
        };

        let anglesHtml = '';
        const stanceKeys = Object.keys(grouped);
        if (stanceKeys.length > 0) {
            anglesHtml = `<div class="essay-guided-stance-groups">${stanceKeys.map(key => {
                const meta = stanceLabels[key] || { en: `Approach: ${key.toUpperCase()}`, vi: `Hướng tiếp cận: ${key.toUpperCase()}`, icon: '📌', tone: 'general' };
                const items = grouped[key];
                return `<div class="essay-guided-stance-card is-${meta.tone}">
                    <div class="essay-guided-stance-head">
                        <span class="essay-guided-stance-icon" aria-hidden="true">${meta.icon}</span>
                        <strong>${escapeHtml(guidedText(meta.en, meta.vi))}</strong>
                        <span class="essay-guided-stance-count">${items.length} ${guidedText('ideas', 'ý')}</span>
                    </div>
                    <ul class="essay-guided-anglelist">
                        ${items.map(item => `<li><span>${escapeHtml(preferTranslated(item.en, guidedLanguage === 'vi' ? item.vi : ''))}</span></li>`).join('')}
                    </ul>
                </div>`;
            }).join('')}</div>`;
        }

        return `<section class="essay-guided-section">
            ${guidedSectionHead(section, guidedText('Analyze the prompt structure and core requirements before formulating your argument.', 'Phân tích kỹ cấu trúc câu hỏi và yêu cầu bắt buộc trước khi lập luận.'))}
            <h4 class="essay-guided-visually-hidden">${guidedText('Break down the prompt', 'Phân tích đề')}</h4>
            <blockquote class="essay-guided-prompt">${escapeHtml(guidedPack.prompt)}</blockquote>
            ${quizHtml}
            ${guidedGroup('parts', guidedText('Question Structure', 'Cấu trúc câu hỏi'), segmentsHtml, { count: segments.length, defaultOpen: true })}
            ${guidedGroup('requirements', guidedText('Mandatory Requirements', 'Yêu cầu bắt buộc'), reqsHtml, { count: reqs.length, defaultOpen: true })}
            ${guidedGroup('traps', guidedText('Common Traps to Avoid', 'Các bẫy cần tránh'), trapsHtml, { count: traps.length, tone: 'warn' })}
            ${guidedGroup('angles', guidedText('Suggested Approaches', 'Gợi ý các hướng tiếp cận'), anglesHtml, { count: angles.length, defaultOpen: true })}
        </section>`;
    }

    function getAvailablePointsForPlan(plan, levelData, common) {
        if (!plan) return [];
        const variantId = plan.variantId || 'default';
        const points = [];
        const seenTexts = new Set();

        const addPoint = (id, en, vi, explEn = '', explVi = '') => {
            const cleanEn = String(en || '').trim();
            if (!cleanEn || seenTexts.has(cleanEn.toLowerCase())) return;
            seenTexts.add(cleanEn.toLowerCase());
            points.push({
                id,
                en: cleanEn,
                vi: String(vi || '').trim(),
                explEn: String(explEn || '').trim(),
                explVi: String(explVi || '').trim(),
            });
        };

        if (plan.point1) {
            addPoint(
                `${variantId}_p1`,
                plan.point1,
                guidedLanguage === 'vi' ? 'Luận điểm trọng tâm 1 cho phần thân bài' : 'Core Argument 1 for Body Paragraph 1',
                'Develop this argument with specific explanation and supporting evidence in Body 1.',
                'Phát triển luận điểm này kèm theo giải thích nguyên nhân/hệ quả và dẫn chứng cụ thể trong Thân bài 1.'
            );
        }
        if (plan.point2) {
            addPoint(
                `${variantId}_p2`,
                plan.point2,
                guidedLanguage === 'vi' ? 'Luận điểm trọng tâm 2 cho phần thân bài' : 'Core Argument 2 for Body Paragraph 2',
                'Develop this complementary argument with distinct examples in Body 2.',
                'Phát triển luận điểm bổ trợ này với các ví dụ hoặc khía cạnh thực tế khác biệt trong Thân bài 2.'
            );
        }

        const angles = common?.angles || [];
        const targetStance = String(plan.stance || plan.variantId || '').trim().toLowerCase();
        angles.forEach((angle, idx) => {
            const angleStance = String(angle.sourceVariantId || '').trim().toLowerCase();
            if (angleStance === targetStance || targetStance === 'all' || !targetStance) {
                const angleEn = String(angle.en || '').trim();
                const angleVi = String(angle.vi || '').trim();
                addPoint(
                    `${variantId}_ang_${idx}`,
                    angleEn,
                    angleVi,
                    'You can use this perspective as one of your two main body arguments.',
                    'Bạn có thể chọn góc nhìn này làm một trong hai luận điểm chính để bảo vệ lập trường của bài viết.'
                );
            }
        });

        return points;
    }

    function getSelectedPointsForPlan(plan, levelData, common) {
        const available = getAvailablePointsForPlan(plan, levelData, common);
        if (available.length === 0) return [plan?.point1 || '', plan?.point2 || ''];

        const validIds = new Set(available.map(p => p.id));
        let selected = guidedSelectedPointIds.filter(id => validIds.has(id));
        if (selected.length < 2) {
            for (const p of available) {
                if (!selected.includes(p.id)) selected.push(p.id);
                if (selected.length === 2) break;
            }
            guidedSelectedPointIds = selected.slice(0, 2);
        }

        const selectedObjects = guidedSelectedPointIds.map(id => available.find(p => p.id === id)).filter(Boolean);
        return [
            selectedObjects[0]?.en || plan?.point1 || '',
            selectedObjects[1]?.en || plan?.point2 || ''
        ];
    }

    function renderGuidedDirection(levelData) {
        const section = GUIDED_SECTIONS[1];
        const common = guidedPack.common || {};
        const plans = levelData.plans || [];
        if (plans.length === 0) {
            return `<section class="essay-guided-section">
                ${guidedSectionHead(section, guidedText('Pick one stance and choose 2 main arguments.', 'Xác định quan điểm rõ ràng và chọn 2 luận điểm chính bạn muốn bảo vệ.'))}
                <p class="essay-guided-empty">${guidedText('No directions are available for this level.', 'Chưa có hướng triển khai cho mức này.')}</p>
            </section>`;
        }

        const activePlan = plans.find(p => p.variantId === guidedSelectedVariantId) || plans[0];
        if (!guidedSelectedVariantId && activePlan) {
            guidedSelectedVariantId = activePlan.variantId;
        }

        const availablePoints = getAvailablePointsForPlan(activePlan, levelData, common);
        const validIds = new Set(availablePoints.map(p => p.id));
        if (!guidedSelectedPointIds.some(id => validIds.has(id)) || guidedSelectedPointIds.length < 2) {
            guidedSelectedPointIds = availablePoints.slice(0, 2).map(p => p.id);
        }

        // Stance selector tabs
        const stanceSelectorHtml = `
        <div class="essay-guided-stance-selector" role="group" aria-label="${guidedText('Select essay stance', 'Chọn lập trường bài viết')}">
            ${plans.map(plan => {
                const isSelected = guidedSelectedVariantId === plan.variantId;
                const isDisagree = String(plan.stance || plan.variantId).toLowerCase().includes('disagree');
                return `<button type="button" class="essay-guided-stance-tab${isSelected ? ' is-active' : ''}" data-guided-action="select-variant" data-variant-id="${escapeHtml(plan.variantId)}" aria-pressed="${isSelected ? 'true' : 'false'}">
                    <span class="essay-guided-stance-tab-icon">${isDisagree ? '👎' : '👍'}</span>
                    <span class="essay-guided-stance-tab-label">${escapeHtml(plan.label || plan.variantId)}</span>
                    <span class="essay-guided-stance-tab-state">${isSelected ? guidedText('Selected', 'Đang chọn') : guidedText('Choose', 'Chọn')}</span>
                </button>`;
            }).join('')}
        </div>`;

        // Points Picker with <?> Vietnamese explanation button
        const selectedCount = guidedSelectedPointIds.length;
        const pointsPickerHtml = `
        <div class="essay-guided-points-container">
            <div class="essay-guided-points-head">
                <div>
                    <h4>${guidedText('Choose 2 Main Points for Your Essay', 'Chọn 2 luận điểm cho bài viết của bạn')}</h4>
                    <p class="essay-guided-points-subtitle">${guidedText('Select the 2 most convincing arguments you want to develop in Body 1 & Body 2.', 'Chọn 2 luận điểm bạn thấy thuyết phục nhất để triển khai trong Thân bài 1 & Thân bài 2.')}</p>
                </div>
                <div class="essay-guided-meter${selectedCount >= 2 ? ' is-full' : ''}">
                    <span>${guidedText('Selected', 'Đã chọn')}</span>
                    <strong>${selectedCount}/2</strong>
                </div>
            </div>
            <div class="essay-guided-points-list">
                ${availablePoints.map((point) => {
                    const isSelected = guidedSelectedPointIds.includes(point.id);
                    const isExplOpen = guidedExpandedPointExplId === point.id;
                    const selectedIdx = isSelected ? guidedSelectedPointIds.indexOf(point.id) + 1 : null;
                    return `
                    <div class="essay-guided-point-card${isSelected ? ' is-selected' : ''}">
                        <div class="essay-guided-point-main">
                            <button type="button" class="essay-guided-point-select-btn" data-guided-action="select-point" data-point-id="${escapeHtml(point.id)}" aria-pressed="${isSelected ? 'true' : 'false'}">
                                <span class="essay-guided-point-checkbox" aria-hidden="true">${isSelected ? `✓ ${selectedIdx}` : ''}</span>
                                <div class="essay-guided-point-text">
                                    <strong class="essay-guided-point-title">${escapeHtml(point.en)}</strong>
                                    ${point.vi ? `<span class="essay-guided-point-vi">${escapeHtml(preferTranslated(point.en, guidedLanguage === 'vi' ? point.vi : ''))}</span>` : ''}
                                </div>
                            </button>
                            <button type="button" class="essay-guided-info-btn${isExplOpen ? ' is-open' : ''}" data-guided-action="toggle-point-expl" data-point-id="${escapeHtml(point.id)}" title="${guidedText('Show Vietnamese explanation & elaboration', 'Xem giải thích chi tiết và cách triển khai bằng tiếng Việt')}" aria-label="${guidedText('Show explanation', 'Xem giải thích')}">
                                <span aria-hidden="true">?</span>
                            </button>
                        </div>
                        ${isExplOpen ? `
                        <div class="essay-guided-point-expl">
                            <div class="essay-guided-point-expl-head">
                                <span class="essay-guided-point-expl-icon" aria-hidden="true">💡</span>
                                <strong>${guidedText('Vietnamese Explanation & Argument Strategy', 'Giải thích chi tiết & Hướng dẫn triển khai')}</strong>
                            </div>
                            <p class="essay-guided-point-expl-desc">${escapeHtml(preferTranslated(point.explEn, guidedLanguage === 'vi' ? (point.explVi || point.vi || 'Luận điểm này giúp làm rõ lập trường của bạn. Bạn nên đưa ra giải thích lý do tại sao điều này xảy ra và dẫn chứng thực tế.') : point.explEn))}</p>
                            <div class="essay-guided-point-expl-tip">
                                <strong>${guidedText('Writing cue:', 'Gợi ý câu:')}</strong>
                                <span>${guidedText('Begin with a topic sentence introducing this point, then explain the mechanism (why/how) and give a specific real-world example.', 'Bắt đầu bằng câu chủ đề nêu luận điểm này, sau đó giải thích nguyên nhân / tác động và đưa ra ví dụ cụ thể.')}</span>
                            </div>
                        </div>` : ''}
                    </div>`;
                }).join('')}
            </div>
        </div>`;

        return `<section class="essay-guided-section">
            ${guidedSectionHead(section, guidedText('Pick one stance and choose 2 main arguments for your body paragraphs.', 'Xác định quan điểm rõ ràng và chọn 2 luận điểm chính bạn muốn bảo vệ.'))}
            ${stanceSelectorHtml}
            ${pointsPickerHtml}
        </section>`;
    }

    function getVocabContextExample(item, currentEntry, guidedPack) {
        if (item.example || item.exampleSentence) {
            return item.example || item.exampleSentence;
        }
        const term = String(item.term || '').trim().toLowerCase();
        const topic = String(currentEntry?.verifiedPrimaryTopic || 'Education').toLowerCase();

        const examples = {
            'system': 'A well-structured educational system should nurture critical inquiry rather than enforce rigid conformity.',
            'test': 'Standardized tests often assess rote memorization instead of evaluating practical analytical thinking.',
            'learn': 'Students learn most effectively when actively engaged in problem-solving and open discussions.',
            'facts': 'Merely absorbing isolated facts does not equip young learners for complex modern challenges.',
            'art': 'Integrating creative arts into the curriculum fosters innovation, emotional intelligence, and self-expression.',
            'passion': 'Pursuing a personal passion enables students to sustain long-term intellectual motivation.',
            'rote learning': 'Over-reliance on rote learning restricts independent analytical capabilities in schoolchildren.',
            'memorization': 'Excessive memorization can diminish a student’s innate curiosity and enthusiasm for discovery.',
            'curriculum': 'A balanced school curriculum should harmonize fundamental theory with practical application.',
            'skill': 'Acquiring critical reasoning and collaboration skills is essential for modern professional success.',
            'knowledge': 'Practical knowledge empowers individuals to make informed ethical and economic decisions.',
            'opportunity': 'Providing equal educational opportunities is crucial for bridging socio-economic divides.',
            'technology': 'Digital technology provides students with instantaneous access to global research resources.',
            'environment': 'Environmental sustainability should be embedded into school curricula to raise eco-awareness.',
            'society': 'A progressive society depends fundamentally on the intellectual freedom of its citizens.',
            'development': 'Holistic intellectual development occurs when learners are encouraged to think independently.',
            'impact': 'Formal schooling exerts a profound impact on cognitive development and lifelong career trajectories.',
            'challenge': 'Overcoming contemporary challenges demands adaptable thinking and cross-disciplinary collaboration.'
        };

        if (examples[term]) return examples[term];
        return `Using "${item.term}" effectively articulates core concepts related to ${currentEntry?.verifiedPrimaryTopic || 'the essay prompt'}.`;
    }

    function getCollocationInfo(item, currentEntry) {
        const rawTerm = String(item.term || '').trim().toLowerCase();
        const existingGloss = String(item.viGloss || item.vi || item.enGloss || item.en || '').trim();
        const isGenericBoilerplate = existingGloss.toLowerCase().includes('cụm từ học thuật tự nhiên') || existingGloss.toLowerCase().includes('natural academic collocation');

        const dictionary = {
            'active participant': {
                vi: 'Người tham gia chủ động / đóng góp tích cực',
                example: 'Students should become active participants in seminars rather than passive listeners.'
            },
            'active participation': {
                vi: 'Sự tham gia tích cực / tương tác chủ động',
                example: 'Active participation in group discussions promotes deeper comprehension and retention.'
            },
            'artificial intelligence': {
                vi: 'Trí tuệ nhân tạo (AI)',
                example: 'Artificial intelligence can personalize learning materials to suit individual student needs.'
            },
            'binary system': {
                vi: 'Hệ thống đánh giá nhị phân / phân loại hai mặt',
                example: 'Evaluating student progress through a strict binary system oversimplifies nuanced talents.'
            },
            'critical thinking': {
                vi: 'Tư duy phản biện',
                example: 'Fostering critical thinking enables learners to evaluate controversial information objectively.'
            },
            'rote learning': {
                vi: 'Phương pháp học vẹt / học thuộc lòng thụ động',
                example: 'Rote learning fails to cultivate genuine problem-solving capabilities in students.'
            },
            'academic achievement': {
                vi: 'Thành tích học tập / thành tựu học thuật',
                example: 'Standardized test scores alone should not define an individual’s overall academic achievement.'
            },
            'curriculum design': {
                vi: 'Thiết kế chương trình giảng dạy',
                example: 'Modern curriculum design must integrate experiential learning with core academic subjects.'
            },
            'technological advancement': {
                vi: 'Sự tiến bộ vượt bậc của công nghệ',
                example: 'Technological advancement has revolutionized independent research and remote education.'
            },
            'higher education': {
                vi: 'Giáo dục bậc cao (đại học & sau đại học)',
                example: 'Higher education institutions play an indispensable role in fostering social mobility.'
            },
            'equal opportunity': {
                vi: 'Cơ hội bình đẳng / tiếp cận công bằng',
                example: 'Governments should guarantee equal opportunity for all students regardless of socio-economic status.'
            },
            'sustainable development': {
                vi: 'Sự phát triển bền vững',
                example: 'Promoting sustainable development requires coordinated environmental education and policy.'
            },
            'economic growth': {
                vi: 'Sự tăng trưởng kinh tế',
                example: 'Investing in quality education is a vital prerequisite for sustained economic growth.'
            }
        };

        const entry = dictionary[rawTerm];
        if (entry) {
            return {
                meaning: guidedLanguage === 'vi' ? entry.vi : (item.enGloss || item.en || entry.vi),
                example: entry.example
            };
        }

        let cleanMeaning = existingGloss;
        if (isGenericBoilerplate) {
            cleanMeaning = guidedLanguage === 'vi' 
                ? `Cụm từ diễn đạt học thuật chuyên sâu về "${item.term}"` 
                : `Key academic phrase for "${item.term}"`;
        }
        return {
            meaning: cleanMeaning || item.term,
            example: `Incorporating "${item.term}" enhances the formal academic register of your arguments.`
        };
    }

    function renderGuidedLanguage(levelData) {
        const section = GUIDED_SECTIONS[2];
        const kit = levelData.languageKit || {};

        const vocabulary = kit.vocabulary || [];
        const vocabHtml = vocabulary.length ? `<div class="essay-guided-target-grid">${vocabulary.map(item => {
            const selected = guidedSelectedTargetIds.includes(item.term);
            const full = !selected && guidedSelectedTargetIds.length >= GUIDED_MAX_TARGETS;
            const example = getVocabContextExample(item, currentEntry, guidedPack);
            return `<button type="button" class="essay-guided-target${selected ? ' is-selected' : ''}" data-guided-action="target" data-target-id="${escapeHtml(item.term)}" aria-pressed="${selected ? 'true' : 'false'}"${full ? ' disabled' : ''}>
                <div class="essay-guided-target-head">
                    <strong class="essay-guided-target-term">${escapeHtml(item.term)}</strong>
                    <span class="essay-guided-target-gloss">${escapeHtml(bilingual(item, 'enGloss', 'viGloss'))}</span>
                    <span class="essay-guided-target-badge">${selected ? '✓ ' + guidedText('Selected', 'Đã chọn') : '+ ' + guidedText('Add Target', 'Chọn mục tiêu')}</span>
                </div>
                <div class="essay-guided-vocab-example">
                    <span class="essay-guided-vocab-example-label">📝 ${guidedText('Essay Example:', 'Ví dụ trong bài:')}</span>
                    <p class="essay-guided-vocab-example-text">"${escapeHtml(example)}"</p>
                </div>
            </button>`;
        }).join('')}</div>` : '';

        const collocations = kit.collocations || [];
        const colloHtml = collocations.length ? `<div class="essay-guided-collo-grid">${collocations.map(item => {
            const info = getCollocationInfo(item, currentEntry);
            return `<div class="essay-guided-collo-card">
                <div class="essay-guided-collo-head">
                    <strong class="essay-guided-collo-term">${escapeHtml(item.term)}</strong>
                    <span class="essay-guided-collo-meaning">${escapeHtml(info.meaning)}</span>
                </div>
                <p class="essay-guided-collo-example">📝 <em>"${escapeHtml(info.example)}"</em></p>
            </div>`;
        }).join('')}</div>` : '';

        const grammar = kit.grammar || [];
        const grammarHtml = grammar.length ? `<dl class="essay-guided-deflist">${grammar.map(item => {
            const pattern = String(item.en || '').trim();
            const gloss = guidedLanguage === 'vi'
                ? preferTranslated(item.purpose || '', item.vi)
                : String(item.purpose || '').trim();
            return `<div><dt>${escapeHtml(pattern)}</dt><dd>${escapeHtml(gloss)}</dd></div>`;
        }).join('')}</dl>` : '';

        const cohesion = kit.cohesion || [];
        const cohesionHtml = cohesion.length ? `<dl class="essay-guided-deflist">${cohesion.map(item => `<div><dt>${escapeHtml(item.term || '')}</dt><dd>${escapeHtml(bilingual(item))}</dd></div>`).join('')}</dl>` : '';

        const used = guidedSelectedTargetIds.length;
        return `<section class="essay-guided-section">
            ${guidedSectionHead(section, guidedText('Select vocabulary with in-context essay examples. Key terms and collocations strengthen your lexical resource score.', 'Chọn từ vựng kèm ví dụ minh họa theo ngữ cảnh đề bài. Sử dụng các cụm từ học thuật giúp nâng cao điểm Lexical Resource.'))}
            <div class="essay-guided-meter${used >= GUIDED_MAX_TARGETS ? ' is-full' : ''}">
                <span>${guidedText('Targets selected for your checklist', 'Từ vựng mục tiêu đã chọn (hiển thị trong checklist)')}</span>
                <strong>${used}/${GUIDED_MAX_TARGETS}</strong>
            </div>
            ${guidedGroup('vocabulary', guidedText('Core vocabulary with Context Examples', 'Từ vựng cốt lõi & Ví dụ trong ngữ cảnh'), vocabHtml, { count: vocabulary.length, defaultOpen: true })}
            ${guidedGroup('collocations', guidedText('Collocations & Academic Usage', 'Cụm từ đi kèm & Cách dùng học thuật'), colloHtml, { count: collocations.length, defaultOpen: true })}
            ${guidedGroup('grammar', guidedText('Sentence patterns', 'Mẫu câu học thuật'), grammarHtml, { count: grammar.length })}
            ${guidedGroup('cohesion', guidedText('Linking words', 'Từ nối chuyển đoạn'), cohesionHtml, { count: cohesion.length })}
        </section>`;
    }

    function renderGuidedPlan(levelData) {
        const section = GUIDED_SECTIONS[3];
        const common = guidedPack.common || {};
        const plan = (levelData.plans || []).find(item => item.variantId === guidedSelectedVariantId) || levelData.plans?.[0];
        if (!plan) {
            return `<section class="essay-guided-section">
                ${guidedSectionHead(section, '')}
                <p class="essay-guided-empty">${guidedText('Choose a direction first.', 'Hãy chọn hướng triển khai trước.')}</p>
                <button type="button" class="essay-guided-stepnav-btn is-primary" data-guided-action="go-section" data-section-id="direction">${guidedText('Choose a direction', 'Chọn hướng đi')} →</button>
            </section>`;
        }

        const [body1Text, body2Text] = getSelectedPointsForPlan(plan, levelData, common);
        const rows = [
            { label: guidedText('Thesis', 'Luận đề'), text: plan.thesisFrame },
            { label: guidedText('Body 1 (Main Point 1)', 'Thân bài 1 (Luận điểm 1)'), text: body1Text },
            { label: guidedText('Body 2 (Main Point 2)', 'Thân bài 2 (Luận điểm 2)'), text: body2Text },
        ].filter(row => String(row.text || '').trim());
        const copyText = rows.map(row => `${row.label}: ${row.text}`).join('\n');
        return `<section class="essay-guided-section">
            ${guidedSectionHead(section, guidedText('This outline follows your chosen stance and selected main points.', 'Dàn ý hoàn chỉnh được xây dựng dựa trên lập trường và luận điểm bạn đã chọn.'))}
            <div class="essay-guided-plan">
                ${rows.map((row, index) => `<div class="essay-guided-plan-row">
                    <span class="essay-guided-plan-index" aria-hidden="true">${index + 1}</span>
                    <div><span class="essay-guided-plan-label">${escapeHtml(row.label)}</span><p>${escapeHtml(row.text)}</p></div>
                </div>`).join('')}
            </div>
            <div class="essay-guided-inline-actions">
                <button type="button" class="essay-guided-ghost-btn" data-guided-action="copy" data-copy-text="${escapeHtml(copyText)}">${guidedText('Copy outline', 'Sao chép dàn ý')}</button>
                <span class="essay-guided-source-note">${guidedText('Source:', 'Nguồn:')} ${escapeHtml(plan.sampleSourceStatus || 'sample')}</span>
            </div>
        </section>`;
    }

    function getDetailedSentenceCue(sentence, paragraph, index) {
        const rawCue = String(sentence.ideaCue || '').trim();
        const purpose = String(sentence.purpose || '').trim().toLowerCase();
        const pName = String(paragraph || sentence.paragraph || '').trim().toLowerCase();

        if (rawCue && !rawCue.toLowerCase().includes('connect this sentence to') && !rawCue.toLowerCase().includes('give your position')) {
            return rawCue;
        }

        if (pName.includes('intro')) {
            if (purpose.includes('paraphrase') || index === 1) {
                return guidedText(
                    'Introduction · Sentence 1: Paraphrase the prompt to introduce the topic in your own words.',
                    'Mở bài · Câu 1: Giới thiệu chủ đề bằng cách diễn đạt lại đề bài theo từ ngữ của bạn (Paraphrase).'
                );
            }
            if (purpose.includes('position') || purpose.includes('thesis') || index === 2) {
                return guidedText(
                    'Introduction · Sentence 2: State your clear thesis / position to establish the essay direction.',
                    'Mở bài · Câu 2: Nêu rõ lập trường của bạn (Thesis Statement) để định hướng luận điểm toàn bài.'
                );
            }
        } else if (pName.includes('body 1') || (pName.includes('body') && !pName.includes('2'))) {
            if (purpose.includes('topic') || index === 1) {
                return guidedText(
                    'Body Paragraph 1 · Topic Sentence: State your first main argument clearly.',
                    'Thân bài 1 · Câu 1 (Câu chủ đề): Nêu rõ luận điểm chính thứ nhất bạn đã chọn.'
                );
            }
            if (purpose.includes('explain') || purpose.includes('mechanism') || index === 2) {
                return guidedText(
                    'Body Paragraph 1 · Explanation: Explain why or how this argument works effectively.',
                    'Thân bài 1 · Câu 2 (Giải thích): Phân tích nguyên nhân, cơ chế hoặc tác động vì sao luận điểm này đúng.'
                );
            }
            if (purpose.includes('example') || purpose.includes('evidence') || index === 3) {
                return guidedText(
                    'Body Paragraph 1 · Example: Provide a concrete real-world example or case study.',
                    'Thân bài 1 · Câu 3 (Dẫn chứng): Đưa ra ví dụ thực tế hoặc trường hợp cụ thể minh họa cho luận điểm.'
                );
            }
        } else if (pName.includes('body 2')) {
            if (purpose.includes('topic') || index === 1) {
                return guidedText(
                    'Body Paragraph 2 · Topic Sentence: State your second main argument or complementary factor.',
                    'Thân bài 2 · Câu 1 (Câu chủ đề): Nêu rõ luận điểm chính thứ hai bạn đã chọn.'
                );
            }
            if (purpose.includes('explain') || purpose.includes('mechanism') || index === 2) {
                return guidedText(
                    'Body Paragraph 2 · Explanation: Elaborate on secondary factors or broader implications.',
                    'Thân bài 2 · Câu 2 (Giải thích): Phân tích sâu hơn các khía cạnh bổ trợ hoặc hệ quả thực tế.'
                );
            }
            if (purpose.includes('example') || purpose.includes('evidence') || index === 3) {
                return guidedText(
                    'Body Paragraph 2 · Example: Provide a supporting example or outcome.',
                    'Thân bài 2 · Câu 3 (Dẫn chứng): Cung cấp ví dụ minh họa hoặc kết quả thực tiễn.'
                );
            }
        } else if (pName.includes('conclu')) {
            if (purpose.includes('restate') || index === 1) {
                return guidedText(
                    'Conclusion · Sentence 1: Reiterate your overall thesis and summarize main arguments.',
                    'Kết bài · Câu 1: Khẳng định lại lập trường ban đầu và tóm lược các luận điểm chính.'
                );
            }
            return guidedText(
                'Conclusion · Sentence 2: Provide a concluding thought, broader implication, or recommendation.',
                'Kết bài · Câu 2: Đưa ra thông điệp tổng kết, khuyến nghị hoặc góc nhìn mở rộng.'
            );
        }

        return rawCue || guidedText('Write a coherent sentence supporting your essay structure.', 'Viết câu mạch lạc làm sáng tỏ luận điểm của đoạn văn.');
    }

    function renderGuidedFurther(levelData) {
        const section = GUIDED_SECTIONS[4];
        const variantId = guidedSelectedVariantId || levelData.plans?.[0]?.variantId || 'default';
        const sentences = levelData.scaffolds?.[variantId] || [];
        const depths = [
            { depth: 1, en: '1 · Purpose', vi: 'Mức 1: Mục đích câu' },
            { depth: 2, en: '2 · Fillable Frame', vi: 'Mức 2: Khung câu mẫu' },
            { depth: 3, en: '3 · Full Model', vi: 'Mức 3: Câu hoàn chỉnh mẫu' },
        ];

        const workflowGuideHtml = `
        <div class="essay-guided-scaffold-guide">
            <div class="essay-guided-scaffold-guide-head">
                <span class="essay-guided-scaffold-guide-icon" aria-hidden="true">💡</span>
                <strong>${guidedText('How to use Sentence Support progressively:', 'Hướng dẫn 3 bước viết câu hoàn chỉnh:')}</strong>
            </div>
            <ul class="essay-guided-scaffold-guide-steps">
                <li><strong>${guidedText('Level 1 (Purpose):', 'Mức 1 (Mục đích):')}</strong> ${guidedText('Read each sentence goal and write in your own words.', 'Đọc mục đích từng câu và tự diễn đạt bằng từ ngữ của bạn.')}</li>
                <li><strong>${guidedText('Level 2 (Frame):', 'Mức 2 (Khung điền):')}</strong> ${guidedText('Use fillable frames to ensure correct academic grammar.', 'Dùng khung câu có sẵn và điền ý tưởng của bạn vào chỗ trống (____).')}</li>
                <li><strong>${guidedText('Level 3 (Model):', 'Mức 3 (Câu mẫu):')}</strong> ${guidedText('Review full model sentences to learn natural collocations & phrasing.', 'Tham khảo câu hoàn chỉnh mẫu để học cách phát triển từ ngữ tự nhiên.')}</li>
            </ul>
            <p class="essay-guided-scaffold-guide-note">📌 ${guidedText('Tip: Click "[Copy Frame]" to paste a structure into your essay editor, or click "[+ Track as Target]" to monitor required structures in your checklist.', 'Mẹo: Nhấp "[Sao chép khung]" để dán vào bài viết, hoặc nhấp "[+ Chọn làm mục tiêu]" để lưu vào danh sách kiểm tra.')}</p>
        </div>`;

        const depthSwitch = `<div class="essay-guided-depth">
            <span class="essay-guided-depth-label">${guidedText('Hint level (Adjust how much support you need)', 'Mức độ gợi ý (Điều chỉnh mức trợ giúp bạn cần)')}</span>
            <div class="essay-guided-depth-track" role="group" aria-label="${guidedText('Hint level', 'Mức gợi ý')}">
                ${depths.map(item => `<button type="button" class="${guidedHintDepth === item.depth ? 'is-active' : ''}" data-guided-action="set-depth" data-depth="${item.depth}" aria-pressed="${guidedHintDepth === item.depth ? 'true' : 'false'}">${escapeHtml(guidedText(item.en, item.vi))}</button>`).join('')}
            </div>
        </div>`;

        let currentParagraph = '';
        const cards = sentences.map(sentence => {
            const paragraph = String(sentence.paragraph || '').trim();
            const heading = paragraph && paragraph !== currentParagraph
                ? `<h4 class="essay-guided-paragraph-head">📌 ${escapeHtml(paragraph.toUpperCase())}</h4>`
                : '';
            currentParagraph = paragraph || currentParagraph;
            const selected = guidedSelectedTargetIds.includes(sentence.sentenceId);
            const full = !selected && guidedSelectedTargetIds.length >= GUIDED_MAX_TARGETS;
            const contextualCue = getDetailedSentenceCue(sentence, paragraph, sentence.index || 1);

            const frame = guidedHintDepth >= 2 && sentence.frame
                ? `<div class="essay-guided-frame">
                    <div class="essay-guided-frame-head">
                        <span class="essay-guided-reveal-label">📝 ${guidedText('Fillable Frame (Fill your idea into the blank):', 'Khung câu mẫu (Điền ý tưởng vào chỗ trống):')}</span>
                        <button type="button" class="essay-guided-ghost-btn" data-guided-action="copy" data-copy-text="${escapeHtml(sentence.frame)}">📋 ${guidedText('Copy Frame', 'Sao chép khung')}</button>
                    </div>
                    <p class="essay-guided-frame-text">${escapeHtml(sentence.frame)}</p>
                </div>`
                : '';
            const model = guidedHintDepth >= 3 && sentence.modelSentence
                ? `<div class="essay-guided-model">
                    <span class="essay-guided-reveal-label">🌟 ${guidedText('Full Model Sentence:', 'Câu hoàn chỉnh mẫu:')}</span>
                    <p class="essay-guided-model-text">${escapeHtml(sentence.modelSentence)}</p>
                </div>`
                : '';
            const reveal = guidedHintDepth < 3
                ? `<button type="button" class="essay-guided-ghost-btn" data-guided-action="reveal-hint" data-depth="${guidedHintDepth + 1}">🔍 ${guidedText(guidedHintDepth === 1 ? 'Show Fillable Frame' : 'Show Full Model Sentence', guidedHintDepth === 1 ? 'Hiện khung câu mẫu' : 'Hiện câu hoàn chỉnh mẫu')}</button>`
                : '';
            return `${heading}<article class="essay-guided-sentence">
                <div class="essay-guided-sentence-meta">
                    <span class="essay-guided-sentence-num">${guidedText('Sentence', 'Câu')} ${escapeHtml(String(sentence.index || ''))}</span>
                    <span class="essay-guided-sentence-purpose">${escapeHtml(sentence.purpose || '')}</span>
                </div>
                <p class="essay-guided-sentence-cue">${escapeHtml(contextualCue)}</p>
                ${frame}${model}
                <div class="essay-guided-sentence-actions">
                    ${reveal}
                    <button type="button" class="essay-guided-ghost-btn${selected ? ' is-selected' : ''}" data-guided-action="target" data-target-id="${escapeHtml(sentence.sentenceId)}" aria-pressed="${selected ? 'true' : 'false'}"${full ? ' disabled' : ''}>${selected ? '✓ ' + guidedText('Target Selected', 'Đã chọn mục tiêu') : '+ ' + guidedText('Track as Target', 'Chọn làm mục tiêu')}</button>
                </div>
            </article>`;
        }).join('');

        return `<section class="essay-guided-section">
            ${guidedSectionHead(section, guidedText('Review sentence scaffolds progressively to develop your own writing.', 'Xem gợi ý câu theo từng mức độ để tự phát triển bài viết của riêng bạn.'))}
            ${workflowGuideHtml}
            ${depthSwitch}
            ${cards || `<p class="essay-guided-empty">${guidedText('No scaffold is available for this direction.', 'Hướng này chưa có khung hỗ trợ.')}</p>`}
        </section>`;
    }

    function renderGuidedFaq() {
        const section = GUIDED_SECTIONS[5];
        const faq = guidedPack.common?.faq || [];
        const items = faq.map((item, index) => guidedGroup(
            `faq-${index}`,
            guidedText(item.questionEn, item.questionVi),
            `<p>${escapeHtml(guidedText(item.answerEn, item.answerVi))}</p>`,
            { defaultOpen: index === 0 }
        )).join('');
        return `<section class="essay-guided-section">
            ${guidedSectionHead(section, guidedText('Quick answers to frequently asked questions about this prompt and scoring criteria.', 'Giải đáp các thắc mắc thường gặp về đề bài và tiêu chí chấm điểm.'))}
            ${items || `<p class="essay-guided-empty">${guidedText('No FAQ for this prompt.', 'Đề này chưa có phần hỏi đáp.')}</p>`}
            <button type="button" class="essay-guided-primary-btn" data-guided-action="tutor">${guidedText('Ask AI Tutor about this prompt', 'Hỏi AI Tutor về đề này')}</button>
        </section>`;
    }

    function buildGuidedChecklistLabels() {
        const requirements = guidedPack?.common?.requirements || [];
        return [
            ...requirements.map(item => bilingual(item)),
            guidedText('My stance is consistent throughout the essay.', 'Quan điểm của tôi nhất quán trong toàn bộ bài viết.'),
            guidedText('Each body paragraph has a clear topic and evidence.', 'Mỗi đoạn thân bài có luận điểm rõ ràng và dẫn chứng phù hợp.'),
            guidedText('I used my selected language targets accurately.', 'Tôi đã sử dụng chính xác các từ vựng mục tiêu đã chọn.'),
        ];
    }

    /**
     * The checklist gates Submit, so its ticks must survive a step change or a
     * language switch — the state lives in guidedChecklistState, not the DOM.
     */
    function renderGuidedChecklist() {
        if (!el.guidedChecklist) return;
        const checks = buildGuidedChecklistLabels();
        const done = checks.filter((_, index) => guidedChecklistState.has(index)).length;
        const complete = checks.length > 0 && done === checks.length;
        // Opens itself on the last step, where "before you submit" is the job.
        const open = guidedChecklistOpen || (!complete && guidedSection === 'faq');
        el.guidedChecklist.hidden = false;
        el.guidedChecklist.classList.toggle('is-complete', complete);
        el.guidedChecklist.classList.toggle('is-open', open);
        el.guidedChecklist.innerHTML = `
            <button type="button" class="essay-guided-checklist-toggle" data-guided-checklist-toggle aria-expanded="${open ? 'true' : 'false'}">
                <span class="essay-guided-checklist-title">${guidedText('Before you submit', 'Trước khi nộp bài')}</span>
                <span class="essay-guided-checklist-count${complete ? ' is-complete' : ''}">${done}/${checks.length}</span>
                <span class="essay-guided-group-chevron" aria-hidden="true"></span>
            </button>
            <div class="essay-guided-checklist-body"${open ? '' : ' hidden'}>
                ${checks.map((label, index) => `<label class="${guidedChecklistState.has(index) ? 'is-checked' : ''}"><input type="checkbox" data-guided-check="${index}"${guidedChecklistState.has(index) ? ' checked' : ''}> <span>${escapeHtml(label)}</span></label>`).join('')}
                <small>${guidedText('Tick every item to unlock Submit.', 'Đánh dấu mọi mục để mở khoá nút Nộp bài.')}</small>
            </div>`;
    }

    /**
     * Updated in place rather than re-rendered: rebuilding the list on every
     * tick would throw keyboard focus back to the body mid-checklist.
     */
    function updateGuidedChecklistState(event) {
        if (!el.guidedChecklist) return;
        const input = event?.target?.closest?.('[data-guided-check]');
        if (!input) return;
        const index = Number(input.dataset.guidedCheck);
        if (input.checked) guidedChecklistState.add(index); else guidedChecklistState.delete(index);
        input.closest('label')?.classList.toggle('is-checked', input.checked);
        const total = buildGuidedChecklistLabels().length;
        const done = el.guidedChecklist.querySelectorAll('[data-guided-check]:checked').length;
        const complete = total > 0 && done === total;
        const counter = el.guidedChecklist.querySelector('.essay-guided-checklist-count');
        if (counter) {
            counter.textContent = `${done}/${total}`;
            counter.classList.toggle('is-complete', complete);
        }
        el.guidedChecklist.classList.toggle('is-complete', complete);
    }

    function onGuidedChecklistClick(event) {
        const toggle = event.target.closest('[data-guided-checklist-toggle]');
        if (!toggle) return;
        guidedChecklistOpen = toggle.getAttribute('aria-expanded') !== 'true';
        renderGuidedChecklist();
    }

    function isGuidedChecklistComplete() {
        if (practiceKind !== 'guided' || !el.guidedChecklist || !guidedPack) return true;
        const checks = buildGuidedChecklistLabels();
        return checks.length > 0 && checks.every((_, index) => guidedChecklistState.has(index));
    }

    /** Blocking Submit silently is hostile; open the list and point at it. */
    function revealGuidedChecklist() {
        guidedChecklistOpen = true;
        renderGuidedChecklist();
        el.guidedChecklist?.classList.add('is-attention');
        el.guidedChecklist?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
        setTimeout(() => el.guidedChecklist?.classList.remove('is-attention'), 1600);
    }

    function renderGuidedRecycle(levelData) {
        if (!el.guidedRecycle || !window.WriteEssaySupport?.getRecycledTargetIds) return;
        const currentIds = (levelData?.coreTargets || []).map(guidedTargetKey);
        const ids = window.WriteEssaySupport.getRecycledTargetIds({ exclude: currentIds, limit: 2 });
        el.guidedRecycle.hidden = ids.length === 0;
        el.guidedRecycle.innerHTML = ids.length ? `<strong>${guidedText('Recycle from your last Guided lesson', 'Ôn lại từ bài Guided trước')}</strong><span>${ids.map(id => `<span class="essay-guided-chip">${escapeHtml(id)}</span>`).join('')}</span>` : '';
    }

    async function requestGuidedHelpMidAttempt() {
        if (practiceKind === 'guided' || !isPracticeActive()) return;
        const accepted = await window.showCustomConfirm?.(
            'Switch to Guided Practice?',
            'This attempt will be permanently marked Guided and will keep the time already used.',
            true
        );
        if (!accepted) return;
        const elapsed = Math.max(0, MAX_ESSAY_TIME_SECONDS - essaySecondsLeft);
        practiceKind = 'guided';
        essayElapsedSeconds = elapsed;
        persistGuidedPreferences();
        updatePracticeChoiceUI();
        if (el.guidedRail) el.guidedRail.hidden = false;
        if (el.guidedNav) el.guidedNav.hidden = false;
        if (el.requestGuidedBtn) el.requestGuidedBtn.hidden = true;
        await loadGuidedPack();
        startTimer();
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

    async function startPractice() {
        if (!currentEntry) { alert('Please select a question first'); return; }
        practiceKind = document.querySelector('input[name="essay-practice-kind"]:checked')?.value || practiceKind || 'exam';
        if (practiceKind === 'guided') {
            guidedLevel = el.guidedLevel?.value || guidedLevel || 'b2';
            guidedLanguage = el.guidedLanguage?.value === 'vi' ? 'vi' : 'en';
            persistGuidedPreferences();
        }
        el.practiceArea.style.display = 'block';
        el.stepResults.style.display = 'none';
        if (el.promptCard) el.promptCard.style.display = 'none';

        const mp = getModePanelEl();
        if (practiceKind === 'guided') {
            // Guided Walkthrough Phase: Editor is completely removed/hidden during steps 1-6
            if (mp) {
                mp.classList.add('essay-guided-mode');
                mp.classList.remove('essay-writing-phase');
                mp.classList.remove('essay-fs-writing');
            }
            if (el.stepWrite) el.stepWrite.style.display = 'none';
            if (el.guidedDraftContainer) el.guidedDraftContainer.style.display = 'none';
            if (el.fullscreenBtn) el.fullscreenBtn.style.display = '';
            if (el.railFullscreenBtn) el.railFullscreenBtn.style.display = '';
            restoreEssayFullscreen();
        } else {
            // Exam Practice: Standard exam editor
            if (mp) {
                mp.classList.remove('essay-guided-mode');
                mp.classList.remove('essay-writing-phase');
                mp.classList.remove('essay-fs-writing');
            }
            if (el.stepWrite) el.stepWrite.style.display = 'block';
            if (el.guidedDraftContainer) el.guidedDraftContainer.style.display = 'none';
            if (el.fullscreenBtn) el.fullscreenBtn.style.display = 'none';
            if (el.railFullscreenBtn) el.railFullscreenBtn.style.display = 'none';
        }

        // Lock UI
        if (el.startBtn) el.startBtn.style.display = 'none';
        if (el.practiceChoice) el.practiceChoice.style.display = 'none';
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
        essayElapsedSeconds = 0;
        essaySecondsLeft = MAX_ESSAY_TIME_SECONDS;
        updateTimerDisplay();
        startTimer();

        if (practiceKind === 'guided') {
            if (el.guidedRail) el.guidedRail.hidden = false;
            if (el.guidedNav) el.guidedNav.hidden = false;
            if (el.requestGuidedBtn) el.requestGuidedBtn.hidden = true;
            guidedSection = 'understand';
            renderGuidedSupport();
            await loadGuidedPack();
        } else {
            if (el.guidedRail) el.guidedRail.hidden = false;
            if (el.guidedNav) el.guidedNav.hidden = true;
            if (el.requestGuidedBtn) el.requestGuidedBtn.hidden = false;
            if (el.guidedContent) el.guidedContent.innerHTML = `<p>${guidedText('Exam Practice keeps the 20-minute countdown. Ask for Guided help only if you want this attempt permanently marked assisted.', 'Exam Practice giữ đồng hồ đếm ngược 20 phút. Chỉ yêu cầu Guided nếu bạn muốn bài này được đánh dấu là có hỗ trợ.')}</p>`;
        }

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
            if (practiceKind === 'guided') {
                essayElapsedSeconds++;
            } else {
                essaySecondsLeft--;
            }
            updateTimerDisplay();
            if (practiceKind !== 'guided' && essaySecondsLeft <= 0) {
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
        const seconds = practiceKind === 'guided' ? essayElapsedSeconds : essaySecondsLeft;
        const m = Math.floor(Math.max(0, seconds) / 60);
        const s = Math.max(0, seconds) % 60;
        el.timerDisplay.textContent = `${practiceKind === 'guided' ? 'Guided · ' : ''}${m}:${String(s).padStart(2, '0')}`;
        if (practiceKind !== 'guided' && essaySecondsLeft <= 120) {
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
        if (!isGuidedChecklistComplete()) {
            revealGuidedChecklist();
            alert(guidedText('Please complete the pre-submission checklist first.', 'Vui lòng hoàn thành bảng kiểm trước khi nộp bài.'));
            startTimer();
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
        const guidanceSnapshot = buildGuidanceSnapshot();
        rememberArchiveSave(window.PTEAttemptArchive?.saveTextAttempt?.('essay', currentEntry, text, {
            wordCount: lastSubmittedEssayWordCount,
            form: formResult,
            guidance: guidanceSnapshot,
            languageTool: langTool?.ok ? {
                matchCount: Array.isArray(langTool.data?.matches) ? langTool.data.matches.length : 0
            } : { unavailable: true }
        }, { scoringSource: 'client-basic' }));

        if (practiceKind === 'guided' && window.WriteEssaySupport?.recordGuidedUsage) {
            window.WriteEssaySupport.recordGuidedUsage({
                questionId: currentEntry?.id,
                targetIds: guidedSelectedTargetIds,
                level: guidedLevel,
                language: guidedLanguage,
            });
        }

        // Restore UI state
        if (el.submitBtn) {
            el.submitBtn.disabled = false;
            el.submitBtn.textContent = 'Submit Essay';
        }
        if (el.essayInput) el.essayInput.readOnly = false;
        isSubmitting = false;

        updateAiScoreButtonState();
    }

    function buildGuidanceSnapshot() {
        if (practiceKind !== 'guided') return { practiceKind: 'exam' };
        const levelData = getGuidedLevelData();
        const sections = {};
        el.guidedContent?.querySelectorAll?.('.essay-guided-section').forEach(section => {
            const heading = section.querySelector('h3')?.textContent?.trim();
            if (heading) sections[heading] = (section.textContent || '').split(/\s+/).filter(Boolean).length;
        });
        return {
            practiceKind: 'guided',
            level: guidedLevel,
            language: guidedLanguage,
            maximumRevealedHintDepth: Math.min(3, Math.max(1, guidedHintDepth)),
            sectionCounts: sections,
            recycledTargetIds: window.WriteEssaySupport?.getRecycledTargetIds?.({ limit: 2 }) || [],
            selectedTargetIds: [...new Set(guidedSelectedTargetIds)].slice(0, 6),
            supportSchemaVersion: guidedPack?.schemaVersion || 'EssaySupportPackV1',
            supportContentVersion: 'v1',
            assisted: true,
            elapsedSeconds: practiceKind === 'guided' ? essayElapsedSeconds : Math.max(0, MAX_ESSAY_TIME_SECONDS - essaySecondsLeft),
            levelCoreTargetCount: Math.min(6, levelData?.coreTargets?.length || 0),
        };
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
