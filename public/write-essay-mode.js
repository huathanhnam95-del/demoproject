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
    let guidedFontFamily = 'be-vietnam-pro';
    let guidedFontScale = 1.0;
    let guidedPack = null;
    let guidedSection = 'understand';
    let guidedHintDepth = 2;
    let guidedSelectedVariantId = null;
    let guidedSelectedTargetIds = [];
    let guidedSelectedPointIds = [];
    let guidedExpandedPointExplId = null;
    let guidedExpandedVocabViIds = new Set();
    let guidedExpandedColloViIds = new Set();
    let guidedFilledSentenceSlots = {};
    let guidedActiveScaffoldPara = 'intro';
    let guidedDraftSpoilers = new Set();
    let guidedDraftCollapsed = false;
    let guidedQuizSelectedOption = null;
    let guidedPackRequestId = 0;
    // Disclosure + checklist state must outlive a re-render: switching step or
    // support language used to wipe every tick and reopen every group.
    let guidedVisitedSections = new Set(['understand']);
    let guidedOpenGroups = new Set();
    let guidedChecklistState = new Set();
    let guidedChecklistOpen = false;
    let guidedSelectedPromptSegment = null;
    let guidedComprehensionQuizAnswer = null;
    let guidedComprehensionGapSlots = {};
    const GUIDED_VIEW_MODE_KEY = 'pte_guided_essay_view_mode';
    let guidedViewMode = 'mindmap';
    try {
        guidedViewMode = localStorage.getItem(GUIDED_VIEW_MODE_KEY) || 'mindmap';
    } catch (_) {}

    const GUIDED_STEP1_LAYOUT_KEY = 'pte_guided_step1_layout';
    let guidedStep1Layout = 'whiteboard';
    try {
        guidedStep1Layout = localStorage.getItem(GUIDED_STEP1_LAYOUT_KEY) || 'whiteboard';
    } catch (_) {}
    let guidedStep1PipelineStep = 1;
    let guidedStep1StationTab = 'blueprint';
    let guidedStep1SelectedChips = new Set(['agree-0', 'agree-1', 'disagree-0']);
    let guidedLanguageKitTab = 'all'; // 'all' | 'vocab' | 'collo' | 'grammar' | 'cohesion'
    let guidedPlanExpandedNode = null; // node index: 0 (intro), 1 (body1), 2 (body2), 3 (concl)

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

    let activeReadyModalCleanup = null;

    /**
     * Shows a web modal confirmation before entering the writing phase.
     * Prevents accidental clicks from disrupting the walkthrough.
     * Bilingual (Vietnamese or English) matching guidedLanguage.
     */
    function showReadyConfirmModal() {
        if (activeReadyModalCleanup) {
            activeReadyModalCleanup();
        }

        let modal = document.getElementById('essay-ready-confirm-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'essay-ready-confirm-modal';
            modal.className = 'essay-ready-modal-backdrop';
            modal.setAttribute('role', 'dialog');
            modal.setAttribute('aria-modal', 'true');
            modal.setAttribute('aria-labelledby', 'essay-ready-modal-title');
            document.body.appendChild(modal);
        }

        const isVi = guidedLanguage === 'vi';
        const title = isVi ? 'Sẵn sàng bước vào giai đoạn viết bài?' : 'Ready to Start Writing?';
        const desc = isVi
            ? 'Bạn chuẩn bị chuyển từ phần hướng dẫn sang giai đoạn viết bài thực tế (Writing Phase).<br><br>Trình soạn thảo sẽ mở ra và dàn ý cùng các câu văn bạn đã xây dựng sẽ được chuẩn bị sẵn trong bài nháp. Bạn có chắc chắn muốn bắt đầu viết bài bây giờ không?'
            : 'You are about to transition from the guided walkthrough to the writing phase.<br><br>The essay editor will open, and your selected outline and constructed sentences will be pre-populated into your draft. Are you sure you want to begin writing now?';
        const backBtnText = isVi ? '← Quay lại kiểm tra' : '← Back to review';
        const contBtnText = isVi ? 'Tiếp tục viết bài →' : 'Continue to writing →';

        modal.innerHTML = `
            <div class="essay-ready-modal-box">
                <div class="essay-ready-modal-icon">✍️</div>
                <h3 id="essay-ready-modal-title" class="essay-ready-modal-title">${escapeHtml(title)}</h3>
                <p class="essay-ready-modal-desc">${desc}</p>
                <div class="essay-ready-modal-actions">
                    <button type="button" class="essay-ready-modal-btn essay-ready-modal-btn-back" data-ready-action="back">${escapeHtml(backBtnText)}</button>
                    <button type="button" class="essay-ready-modal-btn essay-ready-modal-btn-cont" data-ready-action="continue">${escapeHtml(contBtnText)}</button>
                </div>
            </div>
        `;

        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';

        const prevFocus = document.activeElement;
        const contBtn = modal.querySelector('[data-ready-action="continue"]');
        contBtn?.focus();

        function closeModal() {
            if (activeReadyModalCleanup) {
                const cleanup = activeReadyModalCleanup;
                activeReadyModalCleanup = null;
                cleanup();
            }
        }

        function onKeyDown(e) {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                closeModal();
                return;
            }
            if (e.key === 'Tab') {
                const focusable = modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
                if (!focusable.length) {
                    e.preventDefault();
                    return;
                }
                const first = focusable[0];
                const last = focusable[focusable.length - 1];
                if (e.shiftKey && document.activeElement === first) {
                    e.preventDefault();
                    last.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                    e.preventDefault();
                    first.focus();
                }
            }
        }

        function handleModalClick(e) {
            if (e.target === modal || e.target.closest('[data-ready-action="back"]')) {
                closeModal();
            } else if (e.target.closest('[data-ready-action="continue"]')) {
                closeModal();
                enterFsWritingPhase();
            }
        }

        document.addEventListener('keydown', onKeyDown, true);
        modal.addEventListener('click', handleModalClick);

        activeReadyModalCleanup = () => {
            modal.style.display = 'none';
            document.body.style.overflow = '';
            document.removeEventListener('keydown', onKeyDown, true);
            modal.removeEventListener('click', handleModalClick);
            if (prevFocus && typeof prevFocus.focus === 'function') {
                try { prevFocus.focus(); } catch (_) {}
            }
        };
    }

    /**
     * Transition from walkthrough to writing phase.
     * Reveals the essay textarea, displays the scaffolding draft card with spoiler tags,
     * and focuses the editor with user's constructed sentences automatically transferred.
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

        // Render scaffolding draft card with spoiler tags
        renderGuidedDraft();

        // Automatically transfer user's assembled sentences and outline into editor if empty
        if (el.essayInput && !el.essayInput.value.trim()) {
            const levelData = getGuidedLevelData();
            const draft = compileUserScaffoldDraft(levelData);
            if (draft && draft.scaffoldEditorText) {
                el.essayInput.value = draft.scaffoldEditorText;
                updateWordCount();
            }
        }

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

    function getScaffoldSentences(levelData, activePlan) {
        if (!levelData || !levelData.scaffolds) return [];
        if (Array.isArray(levelData.scaffolds)) return levelData.scaffolds;
        const candidates = [
            activePlan?.variantId,
            activePlan?.stance,
            activePlan?.id,
            guidedSelectedVariantId,
            'agree',
            'disagree',
            'default'
        ].filter(Boolean);
        for (const key of candidates) {
            if (Array.isArray(levelData.scaffolds[key]) && levelData.scaffolds[key].length > 0) {
                return levelData.scaffolds[key];
            }
        }
        const firstKey = Object.keys(levelData.scaffolds)[0];
        return firstKey && Array.isArray(levelData.scaffolds[firstKey]) ? levelData.scaffolds[firstKey] : [];
    }

    /**
     * Synthesize user's constructed sentences and outline into a clean scaffolding draft.
     */
    function compileUserScaffoldDraft(levelData) {
        if (!guidedPack || !levelData) return null;
        const common = guidedPack.common || {};
        const activePlan = (levelData.plans || []).find(p => (p.variantId || p.stance || p.id) === guidedSelectedVariantId) || levelData.plans?.[0] || {};
        const variantId = activePlan.variantId || activePlan.stance || 'agree';
        const [body1Point, body2Point] = getSelectedPointsForPlan(activePlan, levelData, common);
        const stance = String(activePlan.stance || variantId).toLowerCase();
        const isDisagree = stance.includes('disagree');

        // Extract topic title or clean prompt
        const promptText = String(currentEntry?.prompt || '').trim();
        const topicName = (common.topics?.[0] || 'the given topic').toLowerCase();

        // Natural thesis & cleaned argument claims
        const naturalThesis = generateNaturalThesis(activePlan, promptText, guidedLevel);
        const cleanP1 = cleanArgumentClaim(body1Point || 'standardized frameworks often constrain personal curiosity');
        const cleanP2 = cleanArgumentClaim(body2Point || 'holistic learning approaches provide essential life skills');

        // Check user-assembled sentences from Step 5
        const sentences = getScaffoldSentences(levelData, activePlan);
        const introUser = [];
        const body1User = [];
        const body2User = [];
        const conclUser = [];

        sentences.forEach((sentence, idx) => {
            const pName = String(sentence.paragraph || '').toLowerCase();
            const sId = sentence.sentenceId || `s${idx + 1}`;
            const slots = guidedFilledSentenceSlots[sId];
            const hasFilled = slots && Object.values(slots).some(v => String(v || '').trim().length > 0);
            if (hasFilled) {
                const text = getUserAssembledSentence(sentence, sId, true);
                if (text) {
                    if (pName.includes('intro')) introUser.push(text);
                    else if (pName.includes('body 1') || (pName.includes('body') && !pName.includes('2'))) body1User.push(text);
                    else if (pName.includes('body 2')) body2User.push(text);
                    else if (pName.includes('concl')) conclUser.push(text);
                }
            }
        });

        // 1. Introduction Paragraph Model
        const cleanPromptQuote = promptText ? `"${promptText.replace(/^["“]|["”]$/g, '').trim()}"` : topicName;
        const introModel = `The debate surrounding whether ${cleanPromptQuote} has garnered significant attention in contemporary society. ${naturalThesis} This essay will examine how ${cleanP1.charAt(0).toLowerCase() + cleanP1.slice(1).replace(/\.$/, '')} and demonstrate why ${cleanP2.charAt(0).toLowerCase() + cleanP2.slice(1).replace(/\.$/, '')}.`;

        // 2. Body Paragraph 1 Model
        const body1Model = `To begin with, the primary argument in support of this stance is that ${cleanP1.charAt(0).toLowerCase() + cleanP1.slice(1).replace(/\.$/, '')}. Specifically, when instructional methods enforce rigid adherence to prescribed curricula, learners are frequently discouraged from pursuing self-directed exploration and critical thinking. For instance, empirical studies in educational psychology illustrate that students who are given the autonomy to explore concepts independently demonstrate superior retention and creative problem-solving skills compared to those subjected to rote memorization. Consequently, this evidence clearly substantiates the position that over-regulation hinders natural intellectual growth.`;

        // 3. Body Paragraph 2 Model
        const body2Model = `Furthermore, another vital aspect that warrants careful consideration is that ${cleanP2.charAt(0).toLowerCase() + cleanP2.slice(1).replace(/\.$/, '')}. That is to say, genuine competency extends beyond mere theoretical test scores to encompass collaborative teamwork, adaptability, and real-world application. A pertinent example can be observed in modern workplaces, where analytical resilience and emotional intelligence are consistently valued above mechanical recall of factual data. Hence, it becomes unequivocally clear that balanced learning environments cultivate lasting competence.`;

        // 4. Conclusion Paragraph Model
        const conclModel = `In conclusion, having analyzed both theoretical principles and practical ramifications, I reaffirm my conviction that ${isDisagree ? 'formal education remains fundamentally beneficial when properly adapted' : 'unyielding academic constraints can indeed impede meaningful self-discovery'}. Looking forward, educational institutions should strive to harmonize rigorous academic benchmarks with flexible, passion-driven inquiry to optimize intellectual potential for future generations.`;

        // Scaffolding draft text for editor
        const introEditor = introUser.length ? introUser.join(' ') : `The question of whether ${cleanPromptQuote} remains a vital topic. ${naturalThesis} This essay explores key arguments and real-world considerations.`;
        const body1Editor = body1User.length ? body1User.join(' ') : `To begin with, ${cleanP1.charAt(0).toLowerCase() + cleanP1.slice(1).replace(/\.$/, '')}. Specifically, [Explain the main reason or mechanism here]. For example, [Insert concrete example here]. Consequently, [State the impact or outcome].`;
        const body2Editor = body2User.length ? body2User.join(' ') : `Furthermore, ${cleanP2.charAt(0).toLowerCase() + cleanP2.slice(1).replace(/\.$/, '')}. In other words, [Elaborate on why this matters]. A clear illustration is [Provide supporting evidence]. Therefore, [Summarize this point].`;
        const conclEditor = conclUser.length ? conclUser.join(' ') : `In conclusion, I firmly maintain that ${naturalThesis.replace(/^In my view,?\s*/i, '').replace(/\.$/, '')}. Moving forward, educational systems should adopt a balanced approach for future learners.`;

        const scaffoldEditorText = `${introEditor}\n\n${body1Editor}\n\n${body2Editor}\n\n${conclEditor}`;
        const fullModelText = `${introModel}\n\n${body1Model}\n\n${body2Model}\n\n${conclModel}`;

        return {
            stance: isDisagree ? 'DISAGREE' : 'AGREE',
            thesis: naturalThesis,
            point1: cleanP1,
            point2: cleanP2,
            introModel,
            body1Model,
            body2Model,
            conclModel,
            introUser: introUser.join(' '),
            body1User: body1User.join(' '),
            body2User: body2User.join(' '),
            conclUser: conclUser.join(' '),
            scaffoldEditorText,
            fullModelText,
            hasAnyUserSentences: (introUser.length + body1User.length + body2User.length + conclUser.length) > 0
        };
    }

    /**
     * Synthesize a coherent, academic 4-paragraph PTE essay draft from the user's
     * chosen stance, arguments, and sentence scaffolding frames.
     */
    function generateGuidedDraft(levelData) {
        const scaffold = compileUserScaffoldDraft(levelData);
        if (!scaffold) return null;
        return {
            stance: scaffold.stance,
            thesis: scaffold.thesis,
            point1: scaffold.point1,
            point2: scaffold.point2,
            introduction: scaffold.introModel,
            body1: scaffold.body1Model,
            body2: scaffold.body2Model,
            conclusion: scaffold.conclModel,
            fullText: scaffold.fullModelText,
            wordCount: scaffold.fullModelText.trim().split(/\s+/).length
        };
    }

    /**
     * Render the scaffolding draft card in the writing area with spoiler tags.
     */
    function renderGuidedDraft() {
        if (!el.guidedDraftContainer) return;
        const levelData = getGuidedLevelData();
        const draft = compileUserScaffoldDraft(levelData);
        if (!draft) {
            el.guidedDraftContainer.style.display = 'none';
            return;
        }

        const paragraphs = [
            {
                key: 'intro',
                titleEn: '1. Introduction',
                titleVi: '1. Mở bài (Introduction)',
                blueprintEn: 'Paraphrase prompt + Thesis statement + Outline map',
                blueprintVi: 'Paraphrase đề bài + Luận đề (Thesis) + Giới thiệu hướng đi',
                userText: draft.introUser,
                points: [
                    { labelEn: 'Your Stance', labelVi: 'Lập trường', text: draft.stance },
                    { labelEn: 'Thesis Statement', labelVi: 'Luận đề', text: draft.thesis }
                ],
                modelText: draft.introModel
            },
            {
                key: 'body1',
                titleEn: '2. Body Paragraph 1',
                titleVi: '2. Thân bài 1 (Body 1)',
                blueprintEn: 'Topic sentence + Explanation of mechanism + Concrete example + Consequence',
                blueprintVi: 'Câu chủ đề + Phân tích cơ chế + Dẫn chứng cụ thể + Hệ quả',
                userText: draft.body1User,
                points: [
                    { labelEn: 'Main Point 1', labelVi: 'Luận điểm 1', text: draft.point1 }
                ],
                modelText: draft.body1Model
            },
            {
                key: 'body2',
                titleEn: '3. Body Paragraph 2',
                titleVi: '3. Thân bài 2 (Body 2)',
                blueprintEn: 'Topic sentence + Elaboration + Real-world illustration + Impact',
                blueprintVi: 'Câu chủ đề + Mở rộng khía cạnh + Minh chứng thực tiễn + Đánh giá',
                userText: draft.body2User,
                points: [
                    { labelEn: 'Main Point 2', labelVi: 'Luận điểm 2', text: draft.point2 }
                ],
                modelText: draft.body2Model
            },
            {
                key: 'concl',
                titleEn: '4. Conclusion',
                titleVi: '4. Kết bài (Conclusion)',
                blueprintEn: 'Reiterate Thesis with finality + Synthesize main arguments (No new ideas)',
                blueprintVi: 'Khẳng định lại Luận đề + Tổng hợp các luận điểm (Không đưa ý mới)',
                userText: draft.conclUser,
                points: [
                    { labelEn: 'Final Synthesis', labelVi: 'Tổng kết', text: `Reaffirm ${draft.stance} based on Point 1 & Point 2` }
                ],
                modelText: draft.conclModel
            }
        ];

        el.guidedDraftContainer.style.display = 'block';
        el.guidedDraftContainer.innerHTML = `
            <div class="essay-guided-draft-header">
                <div class="essay-guided-draft-title">
                    <button type="button" class="essay-guided-draft-collapse" id="essay-draft-collapse-btn" aria-expanded="${guidedDraftCollapsed ? 'false' : 'true'}" aria-controls="essay-draft-body">
                        <span class="essay-guided-group-chevron" aria-hidden="true"></span>
                        <span>${guidedText('Outline blueprint', 'Khung dàn ý')}</span>
                    </button>
                    <span class="essay-guided-draft-badge">${escapeHtml(draft.stance)} · ${guidedText('4 paragraphs', '4 đoạn')}</span>
                </div>
                <div class="essay-guided-draft-actions">
                    <button type="button" class="essay-guided-draft-btn-insert" id="essay-draft-insert-btn" title="${guidedText('Populate scaffold outline into the essay editor', 'Điền khung dàn ý vào bài viết')}">
                        ${guidedText('Insert into editor', 'Điền vào bài')}
                    </button>
                    <button type="button" class="essay-guided-draft-btn-copy" id="essay-draft-copy-btn" title="${guidedText('Copy scaffold outline to clipboard', 'Sao chép khung dàn ý')}">
                        ${guidedText('Copy', 'Sao chép')}
                    </button>
                    ${guidedHelpBtn('draft-insert')}
                </div>
            </div>
            <div id="essay-draft-body" class="essay-guided-draft-collapsible"${guidedDraftCollapsed ? ' hidden' : ''}>
            <p class="essay-guided-draft-instructions">
                ${guidedText(
                    'A scaffold, not a finished essay. Write from your own points below and only open a spoiler when you are stuck on phrasing.',
                    'Đây là khung sườn, không phải bài viết sẵn. Hãy tự viết từ các luận điểm bên dưới và chỉ mở spoiler khi bí cách diễn đạt.'
                )}
            </p>
            <div class="essay-guided-draft-content">
                ${paragraphs.map(p => {
                    const isRevealed = guidedDraftSpoilers.has(p.key);
                    return `
                    <div class="essay-guided-draft-para" data-para-key="${p.key}">
                        <div class="essay-guided-draft-para-head">
                            <div class="essay-guided-draft-para-label">${escapeHtml(guidedText(p.titleEn, p.titleVi))}</div>
                            <span class="essay-guided-draft-blueprint-tag">${escapeHtml(guidedText(p.blueprintEn, p.blueprintVi))}</span>
                        </div>
                        <div class="essay-guided-draft-para-blueprint">
                            <ul class="essay-guided-draft-point-list">
                                ${p.points.map(pt => `<li><strong>${escapeHtml(guidedText(pt.labelEn, pt.labelVi))}:</strong> <span>${escapeHtml(pt.text)}</span></li>`).join('')}
                            </ul>
                            ${p.userText ? `
                            <div class="essay-guided-draft-user-box">
                                <span class="essay-guided-draft-user-label">${guidedText('Your sentences from step 5', 'Câu bạn đã ghép ở bước 5')}</span>
                                <p class="essay-guided-draft-user-text">&ldquo;${escapeHtml(p.userText)}&rdquo;</p>
                            </div>` : ''}
                        </div>
                        <div class="essay-guided-draft-spoiler-wrap">
                            <button type="button" class="essay-guided-draft-spoiler-toggle${isRevealed ? ' is-revealed' : ''}" data-guided-action="toggle-draft-spoiler" data-para-key="${p.key}">
                                <span class="essay-guided-spoiler-text">${isRevealed ? guidedText('Hide model wording', 'Ẩn câu mẫu') : guidedText('Reveal model wording', 'Hiện câu mẫu')}</span>
                            </button>
                            ${guidedHelpBtn('draft-spoiler')}
                            ${isRevealed ? `
                            <div class="essay-guided-draft-spoiler-content">
                                <span class="essay-guided-spoiler-badge">${guidedText('Sample academic wording', 'Câu mẫu học thuật')}</span>
                                <p class="essay-guided-draft-model-text">${escapeHtml(p.modelText)}</p>
                            </div>` : ''}
                        </div>
                    </div>`;
                }).join('')}
            </div>
            </div>
        `;

        const collapseBtn = document.getElementById('essay-draft-collapse-btn');
        if (collapseBtn) {
            collapseBtn.addEventListener('click', () => {
                guidedDraftCollapsed = !guidedDraftCollapsed;
                const body = document.getElementById('essay-draft-body');
                if (body) body.hidden = guidedDraftCollapsed;
                collapseBtn.setAttribute('aria-expanded', guidedDraftCollapsed ? 'false' : 'true');
                el.guidedDraftContainer.classList.toggle('is-collapsed', guidedDraftCollapsed);
            });
        }
        el.guidedDraftContainer.classList.toggle('is-collapsed', guidedDraftCollapsed);

        // Wire up dynamic buttons
        const insertBtn = document.getElementById('essay-draft-insert-btn');
        if (insertBtn) {
            insertBtn.addEventListener('click', () => {
                if (el.essayInput) {
                    el.essayInput.value = draft.scaffoldEditorText;
                    updateWordCount();
                    el.essayInput.focus();
                    el.essayInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    insertBtn.textContent = '✓ ' + guidedText('Inserted', 'Đã điền');
                    setTimeout(() => {
                        insertBtn.textContent = guidedText('Insert into editor', 'Điền vào bài');
                    }, 2000);
                }
            });
        }

        const copyBtn = document.getElementById('essay-draft-copy-btn');
        if (copyBtn) {
            copyBtn.addEventListener('click', () => {
                copyGuidedText(draft.scaffoldEditorText, copyBtn);
            });
        }

        el.guidedDraftContainer.querySelectorAll('.essay-guided-draft-spoiler-toggle').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const key = btn.dataset.paraKey;
                if (key) {
                    if (guidedDraftSpoilers.has(key)) guidedDraftSpoilers.delete(key);
                    else guidedDraftSpoilers.add(key);
                    renderGuidedDraft();
                }
            });
        });
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
            mp.classList.remove('essay-writing-active');
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
        guidedHintDepth = 2;
        guidedSelectedVariantId = null;
        guidedSelectedTargetIds = [];
        guidedSelectedPointIds = [];
        guidedExpandedPointExplId = null;
        guidedExpandedVocabViIds = new Set();
        guidedExpandedColloViIds = new Set();
        guidedFilledSentenceSlots = {};
        guidedActiveScaffoldPara = 'intro';
        guidedDraftSpoilers = new Set();
        guidedDraftCollapsed = false;
        guidedQuizSelectedOption = null;
        guidedPackRequestId += 1;
        guidedVisitedSections = new Set(['understand']);
        guidedOpenGroups = new Set();
        guidedChecklistState = new Set();
        guidedChecklistOpen = false;
        guidedSelectedPromptSegment = null;
        guidedComprehensionQuizAnswer = null;
        guidedComprehensionGapSlots = {};
        if (el.practiceArea) el.practiceArea.style.display = 'none';
        if (el.stepWrite) el.stepWrite.style.display = 'none';
        if (el.stepResults) el.stepResults.style.display = 'none';
        if (el.essayInput) { el.essayInput.value = ''; el.essayInput.readOnly = false; }
        if (el.startBtn) el.startBtn.style.display = '';
        if (el.practiceChoice) el.practiceChoice.style.display = '';
        if (el.promptCard) el.promptCard.style.display = '';
        const headerCard = document.querySelector('#mode-essay .essay-header-card');
        if (headerCard) headerCard.style.display = '';
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
        el.guidedFontSelect = document.getElementById('essay-guided-font-select');
        el.guidedFontScale = document.getElementById('essay-guided-font-scale');
        el.guidedFontScaleVal = document.getElementById('essay-guided-font-scale-val');
        el.guidedScaleDown = document.getElementById('essay-guided-scale-down');
        el.guidedScaleUp = document.getElementById('essay-guided-scale-up');
        el.guidedTypoBtn = document.getElementById('essay-guided-typo-btn');
        el.guidedTypoPopover = document.getElementById('essay-guided-typo-popover');
        el.guidedTypoClose = document.getElementById('essay-guided-typo-close');
        el.guidedPopoverFont = document.getElementById('essay-guided-popover-font');
        el.guidedPopoverScaleVal = document.getElementById('essay-guided-popover-scale-val');
        el.guidedPopoverScaleDown = document.getElementById('essay-guided-popover-scale-down');
        el.guidedPopoverScaleUp = document.getElementById('essay-guided-popover-scale-up');
        el.guidedPopoverScaleRange = document.getElementById('essay-guided-popover-scale-range');

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
        el.guidedRailTop = document.querySelector('#essay-guided-rail .essay-guided-railtop');
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
        el.writeSticky = document.getElementById('essay-write-sticky');
        el.wordCountSticky = document.getElementById('essay-word-count-sticky');
        el.promptExpandBtn = document.getElementById('essay-prompt-expand-btn');
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
                applyFilter({ preserveSelection: true, selectMatch: false });
                renderJumpList(searchQuery, 1);
            });
            el.jumpSearch.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    if (!filteredEntries || filteredEntries.length === 0) return;
                    const q = (searchQuery || '').trim().toLowerCase();
                    if (!q) return;
                    // 1. Prefer exact ID match within filtered entries
                    const exactIdx = filteredEntries.findIndex(entry => String(entry.id).trim().toLowerCase() === q);
                    if (exactIdx >= 0) {
                        onPickerItemChosen(exactIdx);
                        return;
                    }
                    // 2. Fallback to first matching item in current search
                    onPickerItemChosen(0);
                }
            });
        }
        if (el.filterType) {
            el.filterType.addEventListener('change', (e) => {
                selectedTypeFilter = e.target.value;
                applyFilter({ preserveSelection: true, selectMatch: false });
                renderJumpList(searchQuery, 1);
            });
        }
        if (el.filterTopic) {
            el.filterTopic.addEventListener('change', (e) => {
                selectedTopicFilter = e.target.value;
                applyFilter({ preserveSelection: true, selectMatch: false });
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
                const readyModal = document.getElementById('essay-ready-confirm-modal');
                if (readyModal && readyModal.style.display !== 'none') {
                    return;
                }
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
        if (el.guidedFontSelect) {
            el.guidedFontSelect.addEventListener('change', () => {
                applyGuidedTypography(el.guidedFontSelect.value, guidedFontScale, true);
            });
        }
        if (el.guidedFontScale) {
            el.guidedFontScale.addEventListener('input', () => {
                const scale = parseFloat(el.guidedFontScale.value) || 1.0;
                applyGuidedTypography(guidedFontFamily, scale, true);
            });
        }
        if (el.guidedScaleDown) {
            el.guidedScaleDown.addEventListener('click', () => {
                const nextScale = Math.max(0.8, Math.round((guidedFontScale - 0.1) * 10) / 10);
                applyGuidedTypography(guidedFontFamily, nextScale, true);
            });
        }
        if (el.guidedScaleUp) {
            el.guidedScaleUp.addEventListener('click', () => {
                const nextScale = Math.min(1.5, Math.round((guidedFontScale + 0.1) * 10) / 10);
                applyGuidedTypography(guidedFontFamily, nextScale, true);
            });
        }

        // Rail header typography popover
        if (el.guidedTypoBtn) {
            el.guidedTypoBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleGuidedTypoPopover();
            });
        }
        if (el.guidedTypoClose) {
            el.guidedTypoClose.addEventListener('click', (e) => {
                e.stopPropagation();
                closeGuidedTypoPopover();
            });
        }
        if (el.guidedPopoverFont) {
            el.guidedPopoverFont.addEventListener('change', () => {
                applyGuidedTypography(el.guidedPopoverFont.value, guidedFontScale, true);
            });
        }
        if (el.guidedPopoverScaleRange) {
            el.guidedPopoverScaleRange.addEventListener('input', () => {
                const scale = parseFloat(el.guidedPopoverScaleRange.value) || 1.0;
                applyGuidedTypography(guidedFontFamily, scale, true);
            });
        }
        if (el.guidedPopoverScaleDown) {
            el.guidedPopoverScaleDown.addEventListener('click', () => {
                const nextScale = Math.max(0.8, Math.round((guidedFontScale - 0.1) * 10) / 10);
                applyGuidedTypography(guidedFontFamily, nextScale, true);
            });
        }
        if (el.guidedPopoverScaleUp) {
            el.guidedPopoverScaleUp.addEventListener('click', () => {
                const nextScale = Math.min(1.5, Math.round((guidedFontScale + 0.1) * 10) / 10);
                applyGuidedTypography(guidedFontFamily, nextScale, true);
            });
        }

        // Close typography popover when clicking outside
        document.addEventListener('click', (e) => {
            if (!el.guidedTypoPopover || el.guidedTypoPopover.hidden) return;
            if (!el.guidedTypoPopover.contains(e.target) && !el.guidedTypoBtn?.contains(e.target)) {
                closeGuidedTypoPopover();
            }
        });
        if (el.guidedLanguageToggle) el.guidedLanguageToggle.addEventListener('click', toggleGuidedLanguage);
        if (el.guidedMobileToggle) el.guidedMobileToggle.addEventListener('click', toggleGuidedMobileRail);
        if (el.guidedNav) el.guidedNav.addEventListener('click', onGuidedSectionChosen);
        if (el.guidedContent) {
            el.guidedContent.addEventListener('click', onGuidedContentAction);
            el.guidedContent.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    const target = e.target.closest?.('[data-guided-action]');
                    if (target && target.getAttribute('role') === 'button') {
                        e.preventDefault();
                        target.click();
                    }
                }
            });
            el.guidedContent.addEventListener('input', onGuidedFrameInput);
        }
        if (el.guidedDraftContainer) {
            el.guidedDraftContainer.addEventListener('click', onGuidedContentAction);
        }
        if (el.guidedChecklist) {
            el.guidedChecklist.addEventListener('change', updateGuidedChecklistState);
            el.guidedChecklist.addEventListener('click', onGuidedChecklistClick);
        }
        if (el.requestGuidedBtn) el.requestGuidedBtn.addEventListener('click', requestGuidedHelpMidAttempt);
        if (el.fullscreenBtn) el.fullscreenBtn.addEventListener('click', toggleEssayFullscreen);
        if (el.railFullscreenBtn) el.railFullscreenBtn.addEventListener('click', toggleEssayFullscreen);
        if (el.fsReadyBtn) el.fsReadyBtn.addEventListener('click', showReadyConfirmModal);
        if (el.fsBackBtn) el.fsBackBtn.addEventListener('click', exitFsWritingPhase);
        if (el.promptExpandBtn) el.promptExpandBtn.addEventListener('click', toggleStickyPrompt);
        bindGuidedHelp();
        observeGuidedRailTop();
        _watchForModeHide();
        restoreGuidedPreferences();
    }

    /**
     * Step 5 pins its own controls directly beneath the frozen stepper, so the
     * stepper's height has to be a live value rather than a guessed constant.
     */
    function syncGuidedRailTopHeight() {
        const panel = getModePanelEl();
        if (!el.guidedRailTop || !panel) return;
        const height = Math.round(el.guidedRailTop.getBoundingClientRect().height);
        if (height > 0) panel.style.setProperty('--essay-railtop-h', `${height}px`);
    }

    function observeGuidedRailTop() {
        if (!el.guidedRailTop) return;
        // ResizeObserver is the cheap path; the explicit calls from
        // renderGuidedSupport and the phase switches are the reliable one.
        if (typeof ResizeObserver !== 'undefined') {
            try { new ResizeObserver(syncGuidedRailTopHeight).observe(el.guidedRailTop); } catch (_) { /* not critical */ }
        }
        window.addEventListener('resize', syncGuidedRailTopHeight);
        syncGuidedRailTopHeight();
    }

    /**
     * The prompt bar is frozen above the editor, so it is clamped to two lines
     * by default and opens on demand. Without the clamp a four-line prompt eats
     * a third of the writing area on a laptop.
     */
    function toggleStickyPrompt() {
        if (!el.writeSticky || !el.promptExpandBtn) return;
        const expanded = el.writeSticky.classList.toggle('is-prompt-expanded');
        el.promptExpandBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    }

    /** True when the prompt actually overflows its two-line clamp. */
    function syncStickyPromptAffordance() {
        if (!el.writeSticky || !el.promptExpandBtn || !el.promptDisplay) return;
        el.writeSticky.classList.remove('is-prompt-expanded');
        el.promptExpandBtn.setAttribute('aria-expanded', 'false');
        // Reading scrollHeight forces the pending layout, so the clamp is already
        // applied; rAF would be throttled whenever the tab is not rendering.
        const measure = () => {
            const overflows = el.promptDisplay.scrollHeight - el.promptDisplay.clientHeight > 4;
            el.writeSticky.classList.toggle('has-prompt-overflow', overflows);
        };
        measure();
        setTimeout(measure, 60);
    }

    const GUIDED_FONTS = Object.freeze({
        'be-vietnam-pro': {
            name: 'Be Vietnam Pro',
            css: "'Be Vietnam Pro', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
        },
        'plus-jakarta-sans': {
            name: 'Plus Jakarta Sans',
            css: "'Plus Jakarta Sans', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
        },
        'lexend': {
            name: 'Lexend',
            css: "'Lexend', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
        },
        'inter': {
            name: 'Inter',
            css: "'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
        },
        'manrope': {
            name: 'Manrope',
            css: "'Manrope', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
        }
    });

    function applyGuidedTypography(fontKey, scaleVal, shouldPersist = true) {
        if (!GUIDED_FONTS[fontKey]) fontKey = 'be-vietnam-pro';
        const scale = Math.max(0.8, Math.min(1.5, Math.round((Number(scaleVal) || 1.0) * 100) / 100));
        guidedFontFamily = fontKey;
        guidedFontScale = scale;

        const fontEntry = GUIDED_FONTS[fontKey];
        const panel = getModePanelEl();
        const targets = [
            panel,
            el.guidedPreferences,
            el.guidedWorkspace,
            el.guidedRail,
            el.guidedDraftContainer,
            el.guidedTypoPopover
        ].filter(Boolean);

        targets.forEach(node => {
            node.style.setProperty('--essay-guided-font-family', fontEntry.css);
            node.style.setProperty('--essay-guided-font-scale', String(scale));
            node.setAttribute('data-guided-font', fontKey);
        });

        // Sync setup inputs
        if (el.guidedFontSelect && el.guidedFontSelect.value !== fontKey) {
            el.guidedFontSelect.value = fontKey;
        }
        if (el.guidedFontScale) {
            el.guidedFontScale.value = String(scale);
        }
        if (el.guidedFontScaleVal) {
            el.guidedFontScaleVal.textContent = `${scale.toFixed(1)}x (${Math.round(scale * 100)}%)`;
        }

        // Sync popover inputs
        if (el.guidedPopoverFont && el.guidedPopoverFont.value !== fontKey) {
            el.guidedPopoverFont.value = fontKey;
        }
        if (el.guidedPopoverScaleRange) {
            el.guidedPopoverScaleRange.value = String(scale);
        }
        if (el.guidedPopoverScaleVal) {
            el.guidedPopoverScaleVal.textContent = `${scale.toFixed(1)}x`;
        }

        if (shouldPersist) {
            persistGuidedPreferences();
        }
    }

    function toggleGuidedTypoPopover() {
        if (!el.guidedTypoPopover) return;
        const isOpen = !el.guidedTypoPopover.hidden;
        if (isOpen) {
            closeGuidedTypoPopover();
        } else {
            openGuidedTypoPopover();
        }
    }

    function openGuidedTypoPopover() {
        if (!el.guidedTypoPopover || !el.guidedTypoBtn) return;
        el.guidedTypoPopover.hidden = false;
        el.guidedTypoBtn.setAttribute('aria-expanded', 'true');
    }

    function closeGuidedTypoPopover() {
        if (!el.guidedTypoPopover || !el.guidedTypoBtn) return;
        el.guidedTypoPopover.hidden = true;
        el.guidedTypoBtn.setAttribute('aria-expanded', 'false');
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
        guidedFontFamily = GUIDED_FONTS[prefs.fontFamily] ? prefs.fontFamily : 'be-vietnam-pro';
        guidedFontScale = typeof prefs.fontScale === 'number' && !isNaN(prefs.fontScale)
            ? Math.max(0.8, Math.min(1.5, Math.round(prefs.fontScale * 100) / 100))
            : 1.0;

        if (el.guidedLevel) el.guidedLevel.value = guidedLevel;
        if (el.guidedLanguage) el.guidedLanguage.value = guidedLanguage;
        applyGuidedTypography(guidedFontFamily, guidedFontScale, false);
        updatePracticeChoiceUI();
    }

    function persistGuidedPreferences() {
        window.WriteEssaySupport?.writePreferences?.({
            level: guidedLevel,
            language: guidedLanguage,
            fontFamily: guidedFontFamily,
            fontScale: guidedFontScale
        });
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
       The rail is a five-step scaffolded walkthrough, not a document. Each step
       focuses on one core skill, with interactive sentence building leading directly
       into the writing phase.
    */

    const GUIDED_SECTIONS = Object.freeze([
        { id: 'understand', icon: '🔍', en: 'Understand the prompt', vi: 'Hiểu đề bài' },
        { id: 'direction', icon: '🧭', en: 'Choose a direction', vi: 'Chọn hướng đi' },
        { id: 'language', icon: '🧰', en: 'Language kit', vi: 'Bộ ngôn ngữ' },
        { id: 'plan', icon: '🗂️', en: 'Make a plan', vi: 'Lập dàn ý' },
        { id: 'further', icon: '✍️', en: 'Sentence builder', vi: 'Xây dựng câu' },
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

    /* -- Vietnamese help affordance ---------------------------------------
       Every guided control that is not self-evident carries a <?> that opens
       this popover. The copy is always Vietnamese: the learner reaches for it
       precisely when the English label did not land. One floating element is
       reused for all of them so it can escape the rail's own scroll clipping. */
    const GUIDED_HELP = Object.freeze({
        'practice-mode': {
            title: 'Hai chế độ luyện tập',
            body: '<strong>Exam Practice</strong> mô phỏng phòng thi: đồng hồ đếm ngược 20 phút, không có gợi ý.<br><strong>Guided Practice</strong> là chế độ học: đồng hồ đếm xuôi (không áp lực) và bạn được đi qua 5 bước hướng dẫn trước khi viết.<br>Dùng Guided khi bạn còn lúng túng về cách triển khai, và chuyển sang Exam khi muốn kiểm tra tốc độ thật.',
        },
        'support-level': {
            title: 'Mức hỗ trợ (A2–B1 / B2 / C1)',
            body: 'Quyết định độ khó của từ vựng, cấu trúc câu và câu mẫu mà phần hướng dẫn đưa ra.<br><strong>A2–B1</strong>: câu ngắn, từ thông dụng.<br><strong>B2</strong>: mức chuẩn cho PTE / IELTS.<br><strong>C1</strong>: từ vựng học thuật và câu phức nâng cao.<br>Chọn đúng trình độ hiện tại của bạn — chọn quá cao sẽ khiến bạn chép máy móc thay vì tự viết.',
        },
        'support-language': {
            title: 'Ngôn ngữ hiển thị hướng dẫn',
            body: 'Đổi ngôn ngữ của phần <em>giải thích</em> (nhãn, hướng dẫn, lưu ý). Từ vựng, câu mẫu và bài viết của bạn luôn giữ nguyên tiếng Anh.<br>Mẹo: để <strong>English</strong> cho quen thuật ngữ bài thi, và bấm nút <strong>VI</strong> ở góc phải khi gặp chỗ khó hiểu.',
        },
        'guided-font': {
            title: 'Tùy chỉnh Font chữ & Cỡ chữ (Guided Mode)',
            body: 'Hệ thống hỗ trợ 5 font chữ được thiết kế tối ưu riêng cho tiếng Việt và trải nghiệm đọc học thuật:<br>• <strong>Be Vietnam Pro</strong>: Font chuẩn vàng quốc gia cho tiếng Việt, dấu thanh cân đối tuyệt đối.<br>• <strong>Plus Jakarta Sans</strong>: Hình học hiện đại, liền mạch với phong cách Outfit.<br>• <strong>Lexend</strong>: Tăng tốc độ đọc và độ tập trung.<br>• <strong>Inter</strong>: Chuẩn giao diện UI quốc tế, rõ ràng sắc nét.<br>• <strong>Manrope</strong>: Hiện đại, thanh lịch.<br>Bạn có thể tăng giảm cỡ chữ linh hoạt từ <strong>0.8x đến 1.5x</strong> mà không sợ bị vỡ hay tràn giao diện.',
        },
        'steps': {
            title: '5 bước của phần hướng dẫn',
            body: '<strong>1. Hiểu đề bài</strong> — tách đề thành từng vế và xác định yêu cầu bắt buộc.<br><strong>2. Chọn hướng đi</strong> — chốt lập trường và 2 luận điểm chính.<br><strong>3. Bộ ngôn ngữ</strong> — từ vựng, cụm từ, mẫu câu và từ nối.<br><strong>4. Lập dàn ý</strong> — khung bài dựng theo lựa chọn của bạn.<br><strong>5. Xây dựng câu</strong> — viết từng câu; các câu này chuyển thẳng vào bài viết.<br>Bạn có thể quay lại bất kỳ bước nào; dấu ✓ cho biết bước đã xem qua.',
        },
        'clauses': {
            title: 'Vì sao phải tách đề thành từng vế?',
            body: 'Mất điểm Task Achievement thường không phải vì tiếng Anh yếu, mà vì bỏ sót một vế của đề. Mỗi thẻ bên dưới là một vế: nó cho biết vế đó <strong>đóng vai trò gì</strong>, phải trả lời ở <strong>đoạn nào</strong>, và <strong>lỗi thường gặp</strong> khi xử lý vế đó.',
        },
        'traps': {
            title: 'Lỗi phổ biến cần tránh với đề này',
            body: 'Thay vì những lời nhắc chung chung "đừng làm gì", phần này phân tích sâu <strong>các lỗi thí sinh hay mắc nhất</strong> với chính dạng đề này:<br>• <strong>Nhầm lẫn:</strong> Điểm mà đa số thí sinh hay hiểu sai hoặc viết nhầm.<br>• <strong>Tại sao mất điểm:</strong> Hậu quả cụ thể lên điểm Content và Task Achievement.<br>• <strong>Cách viết chuẩn:</strong> Hướng xử lý chính xác để bài viết đạt điểm tối đa.<br>Đọc kỹ phần này trước khi lên dàn bài sẽ giúp bạn tiết kiệm thời gian sửa bài sau này.',
        },
        'stance': {
            title: 'Chọn lập trường',
            body: 'Chọn <strong>một</strong> hướng và giữ nguyên xuyên suốt bài viết. Bài trung lập hoặc đổi quan điểm giữa chừng sẽ bị trừ điểm.<br>Không có hướng nào “đúng” hơn hướng nào — hãy chọn hướng bạn nghĩ ra được nhiều dẫn chứng nhất. Đổi lập trường sẽ cập nhật lại dàn ý và câu mẫu ở các bước sau.',
        },
        'main-points': {
            title: 'Vì sao chỉ chọn đúng 2 luận điểm?',
            body: 'Bài 200–300 từ chỉ đủ chỗ cho 2 đoạn thân bài. Mỗi luận điểm cần: câu chủ đề → giải thích → dẫn chứng → câu chốt. Chọn 3–4 luận điểm sẽ khiến mỗi ý bị hụt và mất điểm Development.<br>Bấm <strong>?</strong> ở từng luận điểm để xem cách triển khai chi tiết.',
        },
        'targets': {
            title: 'Từ vựng / câu mục tiêu',
            body: 'Đánh dấu tối đa 6 mục bạn <em>cam kết sẽ dùng</em> trong bài. Chúng sẽ xuất hiện trong bảng kiểm “Trước khi nộp bài”, và được ghi nhớ để ôn lại ở các đề sau.<br>Chọn có chủ đích tốt hơn chọn thật nhiều: dùng đúng 4 từ học thuật ghi điểm cao hơn nhồi 20 từ sai ngữ cảnh.',
        },
        'pattern': {
            title: 'Mẫu câu phức',
            body: 'Giám khảo chấm điểm Grammar dựa trên <em>sự đa dạng</em> của cấu trúc câu. Mẫu <code>Although [X], I believe [Y] because [Z]</code> ghi điểm vì vừa nhượng bộ quan điểm đối lập vừa bảo vệ lập trường trong cùng một câu.<br>Dùng ở Mở bài (câu luận đề) hoặc mở đầu Thân bài 2.',
        },
        'cohesion': {
            title: 'Từ nối theo từng giai đoạn',
            body: 'Đây không phải danh sách từ nối để học thuộc, mà là <strong>thứ tự sử dụng</strong>: mỗi giai đoạn ứng với một vị trí cụ thể trong bài. Đi đúng thứ tự này thì mạch bài tự nhiên và ghi điểm Coherence.<br>Chỉ dùng mỗi từ nối một lần trong toàn bài.',
        },
        'plan-source': {
            title: 'Nguồn dàn ý',
            body: 'Cho biết dàn ý này lấy từ bài mẫu đã kiểm duyệt hay được dựng tự động từ các lựa chọn của bạn. Đây là <em>một</em> cách triển khai hợp lệ, không phải đáp án duy nhất — hãy diễn đạt lại bằng từ ngữ của bạn.',
        },
        'hint-level': {
            title: 'Mức độ gợi ý (1 → 3)',
            body: '<strong>Mức 1</strong>: chỉ nói câu này để làm gì — bạn tự viết hoàn toàn.<br><strong>Mức 2</strong>: khung câu có chỗ trống để bạn điền.<br><strong>Mức 3</strong>: câu hoàn chỉnh mẫu để tham khảo cách diễn đạt.<br>Hãy bắt đầu ở mức thấp nhất bạn chịu được và chỉ tăng khi thật sự bí. Bạn học được nhiều nhất ở mức phải cố gắng một chút.',
        },
        'scaffold-tabs': {
            title: 'Chọn đoạn để viết',
            body: 'Lọc danh sách câu theo từng đoạn để bạn viết xong một đoạn rồi mới sang đoạn tiếp theo. Số trong ngoặc là số câu gợi ý cho đoạn đó. Chọn <strong>Tất cả các câu</strong> khi muốn xem lại toàn bộ mạch bài.',
        },
        'frame': {
            title: 'Khung điền câu',
            body: 'Gõ trực tiếp vào các ô trống; câu hoàn chỉnh hiện ngay bên dưới. Những câu bạn ghép ở đây sẽ được <strong>tự động đưa vào khung bài viết</strong> khi bạn bấm bắt đầu viết, nên hãy viết bằng ý của chính bạn thay vì chép câu mẫu.',
        },
        'checklist': {
            title: 'Bảng kiểm trước khi nộp',
            body: 'Nút <strong>Nộp bài</strong> chỉ mở khoá khi bạn đã tự kiểm tra đủ các mục. Đây là thói quen của thí sinh điểm cao: dành 1–2 phút cuối rà lại yêu cầu đề, tính nhất quán của lập trường và các từ mục tiêu đã chọn.',
        },
        'draft-insert': {
            title: 'Điền khung vào bài viết',
            body: 'Chèn dàn ý cùng các câu bạn đã ghép ở Bước 5 vào ô soạn thảo, để bạn viết tiếp thay vì bắt đầu từ trang trắng.<br><strong>Lưu ý:</strong> hãy viết lại và mở rộng phần được chèn — nộp nguyên khung sẽ bị đánh giá là bài chưa phát triển.',
        },
        'draft-spoiler': {
            title: 'Câu mẫu (ẩn có chủ đích)',
            body: 'Câu mẫu bị ẩn để bạn tự viết trước đã. Hãy viết phiên bản của bạn, rồi mới mở ra so sánh cách diễn đạt. Đọc mẫu trước khi tự viết là cách nhanh nhất để chép lại mà không học được gì.',
        },
    });

    let guidedHelpEl = null;
    let guidedHelpAnchor = null;
    let guidedHelpBound = false;

    /** The <?> trigger. Vietnamese copy on purpose - see GUIDED_HELP. */
    function guidedHelpBtn(key) {
        if (!GUIDED_HELP[key]) return '';
        return `<button type="button" class="essay-guided-help" data-guided-action="help" data-help-key="${escapeHtml(key)}" aria-expanded="false" aria-label="Giải thích" title="Giải thích (tiếng Việt)"><span aria-hidden="true">?</span></button>`;
    }

    function ensureGuidedHelpEl() {
        if (guidedHelpEl && document.body.contains(guidedHelpEl)) return guidedHelpEl;
        guidedHelpEl = document.createElement('div');
        guidedHelpEl.id = 'essay-guided-help-pop';
        guidedHelpEl.className = 'essay-guided-help-pop';
        guidedHelpEl.setAttribute('role', 'dialog');
        guidedHelpEl.tabIndex = -1;
        guidedHelpEl.hidden = true;
        document.body.appendChild(guidedHelpEl);
        return guidedHelpEl;
    }

    /** Fixed-positioned so the rail's own overflow cannot clip it. */
    function positionGuidedHelp(anchor) {
        if (!guidedHelpEl || !anchor?.isConnected) return;
        const gap = 10;
        const margin = 12;
        const rect = anchor.getBoundingClientRect();
        const pop = guidedHelpEl.getBoundingClientRect();
        let left = rect.left + rect.width / 2 - pop.width / 2;
        left = Math.max(margin, Math.min(left, window.innerWidth - pop.width - margin));
        let top = rect.bottom + gap;
        if (top + pop.height > window.innerHeight - margin) {
            const above = rect.top - gap - pop.height;
            top = above >= margin ? above : window.innerHeight - pop.height - margin;
        }
        // Last resort: an anchor scrolled out of view must not drag the popover
        // off-screen with it.
        top = Math.max(margin, Math.min(top, Math.max(margin, window.innerHeight - pop.height - margin)));
        guidedHelpEl.style.left = `${Math.round(left)}px`;
        guidedHelpEl.style.top = `${Math.round(top)}px`;
    }

    function closeGuidedHelp({ restoreFocus = false } = {}) {
        if (!guidedHelpEl || guidedHelpEl.hidden) return;
        guidedHelpEl.hidden = true;
        const anchor = guidedHelpAnchor;
        guidedHelpAnchor = null;
        if (anchor?.isConnected) {
            anchor.setAttribute('aria-expanded', 'false');
            if (restoreFocus) anchor.focus();
        }
    }

    function openGuidedHelp(anchor) {
        const entry = GUIDED_HELP[anchor?.dataset?.helpKey];
        if (!entry) return;
        if (guidedHelpAnchor === anchor && guidedHelpEl && !guidedHelpEl.hidden) {
            closeGuidedHelp({ restoreFocus: true });
            return;
        }
        closeGuidedHelp();
        const pop = ensureGuidedHelpEl();
        pop.innerHTML = `<div class="essay-guided-help-head"><strong>${escapeHtml(entry.title)}</strong>
            <button type="button" class="essay-guided-help-close" data-guided-help-close aria-label="Đóng">&times;</button></div>
            <div class="essay-guided-help-body">${entry.body}</div>`;
        pop.setAttribute('aria-label', entry.title);
        pop.hidden = false;
        guidedHelpAnchor = anchor;
        anchor.setAttribute('aria-expanded', 'true');
        positionGuidedHelp(anchor);
        pop.focus();
    }

    /** Bound once on the document: triggers live in both static and rendered markup. */
    function bindGuidedHelp() {
        if (guidedHelpBound) return;
        guidedHelpBound = true;
        document.addEventListener('click', (event) => {
            const trigger = event.target.closest?.('[data-guided-action="help"]');
            if (trigger) {
                event.preventDefault();
                event.stopPropagation();
                openGuidedHelp(trigger);
                return;
            }
            if (event.target.closest?.('[data-guided-help-close]')) { closeGuidedHelp({ restoreFocus: true }); return; }
            if (guidedHelpEl && !guidedHelpEl.hidden && !event.target.closest?.('#essay-guided-help-pop')) closeGuidedHelp();
        }, true);
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && guidedHelpEl && !guidedHelpEl.hidden) closeGuidedHelp({ restoreFocus: true });
        });
        window.addEventListener('resize', () => closeGuidedHelp());
        // Any scroll (page or rail) would leave the popover stranded.
        window.addEventListener('scroll', () => closeGuidedHelp(), true);
    }

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
    function guidedGroup(key, title, bodyHtml, { count = null, defaultOpen = false, tone = '', help = '' } = {}) {
        if (!bodyHtml) return '';
        const open = isGuidedGroupOpen(key, defaultOpen);
        const badge = count === null ? '' : `<span class="essay-guided-group-count">${escapeHtml(String(count))}</span>`;
        // The <?> is a sibling of the toggle, never inside it: nesting two
        // buttons is invalid and breaks keyboard traversal.
        return `<div class="essay-guided-group${open ? ' is-open' : ''}${tone ? ` essay-guided-group--${tone}` : ''}" data-guided-group="${escapeHtml(key)}">
            <div class="essay-guided-group-head">
                <button type="button" class="essay-guided-group-toggle" data-guided-action="toggle-group" data-group-key="${escapeHtml(key)}" aria-expanded="${open ? 'true' : 'false'}">
                    <span class="essay-guided-group-title">${escapeHtml(title)}</span>
                    ${badge}
                    <span class="essay-guided-group-chevron" aria-hidden="true"></span>
                </button>
                ${help ? guidedHelpBtn(help) : ''}
            </div>
            <div class="essay-guided-group-body"${open ? '' : ' hidden'}>${bodyHtml}</div>
        </div>`;
    }

    function guidedSectionHead(section, lede) {
        const index = guidedSectionIndex(section.id);
        return `<header class="essay-guided-section-head">
            <span class="essay-guided-step-tag">${guidedText('Step', 'Bước')} ${index + 1}/${GUIDED_SECTIONS.length}</span>
            <h3>${escapeHtml(guidedSectionLabel(section))}</h3>
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

    function onGuidedFrameInput(event) {
        const input = event.target.closest('.essay-guided-slot-input');
        if (!input) return;
        const sentenceId = input.dataset.guidedSentenceId;
        const slotIdx = Number(input.dataset.slotIdx);
        if (!sentenceId || isNaN(slotIdx)) return;
        if (!guidedFilledSentenceSlots[sentenceId]) guidedFilledSentenceSlots[sentenceId] = {};
        guidedFilledSentenceSlots[sentenceId][slotIdx] = input.value;

        // Update live assembled preview without re-rendering or losing focus
        const frameCard = input.closest('.essay-guided-frame');
        const previewEl = frameCard?.querySelector('.essay-guided-assembled-text');
        const copyBtn = frameCard?.querySelector('[data-guided-action="copy"]');
        if (frameCard && previewEl) {
            const allInputs = frameCard.querySelectorAll('.essay-guided-slot-input');
            const staticParts = frameCard.querySelectorAll('.essay-guided-frame-static-text');
            let previewText = '';
            let rawText = '';
            staticParts.forEach((partEl, pIdx) => {
                const textPart = partEl.textContent;
                previewText += textPart;
                rawText += textPart;
                const matchInput = allInputs[pIdx];
                if (matchInput) {
                    const val = matchInput.value.trim();
                    if (val) {
                        previewText += ` <b class="essay-guided-filled-slot">${escapeHtml(val)}</b> `;
                        rawText += ` ${val} `;
                    } else {
                        previewText += ' <span class="essay-guided-empty-slot">_____</span> ';
                        rawText += ' _____ ';
                    }
                }
            });
            previewEl.innerHTML = previewText.replace(/\s+/g, ' ').trim();
            if (copyBtn) {
                copyBtn.dataset.copyText = rawText.replace(/\s+/g, ' ').trim();
            }
        }
    }

    function onGuidedContentAction(event) {
        const target = event.target.closest('[data-guided-action]');
        if (!target) return;
        const action = target.dataset.guidedAction;
        if (action === 'retry-pack') {
            loadGuidedPack({ force: true });
        } else if (action === 'set-guided-view-mode') {
            const mode = target.dataset.viewMode;
            if (mode === 'mindmap' || mode === 'list') {
                guidedViewMode = mode;
                try {
                    localStorage.setItem(GUIDED_VIEW_MODE_KEY, mode);
                } catch (_) {}
                renderGuidedSupport();
            }
        } else if (action === 'set-step1-layout') {
            const layout = target.dataset.layout;
            if (['whiteboard', 'stations', 'hud', 'list'].includes(layout)) {
                guidedStep1Layout = layout;
                try {
                    localStorage.setItem(GUIDED_STEP1_LAYOUT_KEY, layout);
                } catch (_) {}
                renderGuidedSupport();
            }
        } else if (action === 'select-pipeline-step') {
            const stepNum = parseInt(target.dataset.stepNum, 10);
            if (!isNaN(stepNum)) {
                guidedStep1PipelineStep = stepNum;
                renderGuidedSupport();
            }
        } else if (action === 'select-station-tab') {
            const station = target.dataset.station;
            if (station) {
                guidedStep1StationTab = station;
                renderGuidedSupport();
            }
        } else if (action === 'toggle-side-chip') {
            const chipId = target.dataset.chipId;
            if (chipId) {
                if (guidedStep1SelectedChips.has(chipId)) {
                    guidedStep1SelectedChips.delete(chipId);
                } else {
                    guidedStep1SelectedChips.add(chipId);
                }
                renderGuidedSupport();
            }
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
            showReadyConfirmModal();
        } else if (action === 'select-gap-chip') {
            const slotId = target.dataset.slotId;
            const optionId = target.dataset.optionId;
            if (slotId && optionId) {
                guidedComprehensionGapSlots = { ...guidedComprehensionGapSlots, [slotId]: optionId };
                renderGuidedSupport();
            }
        } else if (action === 'reset-gap-fill') {
            guidedComprehensionGapSlots = {};
            renderGuidedSupport();
        } else if (action === 'select-prompt-segment') {
            const segId = target.dataset.segmentId;
            guidedSelectedPromptSegment = guidedSelectedPromptSegment === segId ? null : segId;
            renderGuidedSupport();
            if (guidedSelectedPromptSegment) {
                const cardNum = guidedSelectedPromptSegment.replace('seg_', '');
                const targetCard = document.getElementById(`flowchart-card-${cardNum}`);
                if (targetCard && typeof targetCard.scrollIntoView === 'function') {
                    try {
                        targetCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    } catch (_) {
                        targetCard.scrollIntoView(false);
                    }
                }
            }
        } else if (action === 'answer-comprehension-quiz') {
            guidedComprehensionQuizAnswer = target.dataset.quizOption || null;
            renderGuidedSupport();
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
        } else if (action === 'toggle-vocab-vi') {
            const term = target.dataset.term;
            if (term) {
                if (guidedExpandedVocabViIds.has(term)) guidedExpandedVocabViIds.delete(term);
                else guidedExpandedVocabViIds.add(term);
                renderGuidedSupport();
            }
        } else if (action === 'toggle-collo-vi') {
            const term = target.dataset.term;
            if (term) {
                if (guidedExpandedColloViIds.has(term)) guidedExpandedColloViIds.delete(term);
                else guidedExpandedColloViIds.add(term);
                renderGuidedSupport();
            }
        } else if (action === 'set-language-kit-tab') {
            guidedLanguageKitTab = target.dataset.tab || 'all';
            renderGuidedSupport();
        } else if (action === 'toggle-plan-node') {
            const nodeIdx = parseInt(target.dataset.nodeIndex, 10);
            guidedPlanExpandedNode = (guidedPlanExpandedNode === nodeIdx ? null : nodeIdx);
            renderGuidedSupport();
        } else if (action === 'transfer-sentence') {
            const sId = target.dataset.sentenceId;
            const levelData = guidedPack?.levels?.[guidedLevel] || {};
            const activePlan = (levelData.plans || []).find(p => (p.variantId || p.stance || p.id) === guidedSelectedVariantId) || levelData.plans?.[0] || {};
            const allSentences = getScaffoldSentences(levelData, activePlan);
            const sentence = allSentences.find(s => (s.sentenceId || `sent_${s.index || 1}`) === sId);
            const inputEl = el.essayInput || document.getElementById('essay-input');
            if (sentence && inputEl) {
                const assembled = getUserAssembledSentence(sentence, sId, true);
                const textToInsert = (assembled && !assembled.includes('_____'))
                    ? assembled
                    : getAuthenticModelSentence(sentence, currentEntry, activePlan, sentence.index);
                if (textToInsert) {
                    const curVal = (inputEl.value || '').trim();
                    inputEl.value = curVal ? `${curVal} ${textToInsert}` : textToInsert;
                    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
                    inputEl.focus();
                    const origText = target.innerHTML;
                    target.innerHTML = '✓ ' + guidedText('Added!', 'Đã thêm vào bài!');
                    target.classList.add('is-added');
                    setTimeout(() => {
                        target.innerHTML = origText;
                        target.classList.remove('is-added');
                    }, 1800);
                }
            }
        } else if (action === 'set-depth') {
            guidedHintDepth = Math.min(3, Math.max(1, Number(target.dataset.depth) || 1));
            renderGuidedSupport();
        } else if (action === 'set-scaffold-tab') {
            guidedActiveScaffoldPara = target.dataset.tab || 'all';
            renderGuidedSupport();
        } else if (action === 'toggle-draft-spoiler') {
            const key = target.dataset.paraKey;
            if (key) {
                if (guidedDraftSpoilers.has(key)) guidedDraftSpoilers.delete(key);
                else guidedDraftSpoilers.add(key);
                renderGuidedDraft();
            }
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

    function renderGuidedMindMapSVGLines() {
        if (guidedSection === 'understand' ? (guidedStep1Layout !== 'whiteboard') : (guidedViewMode !== 'mindmap')) return;

        // 1. Step 1: Prompt Mind Map
        const promptCanvas = document.getElementById('essay-prompt-mindmap-canvas');
        const promptSvg = document.getElementById('essay-prompt-mindmap-svg');
        const promptCore = document.getElementById('mm-prompt-core');

        if (promptCanvas && promptSvg && promptCore) {
            const canvasRect = promptCanvas.getBoundingClientRect();
            if (canvasRect.width > 0 && canvasRect.height > 0) {
                promptSvg.setAttribute('width', canvasRect.width);
                promptSvg.setAttribute('height', canvasRect.height);

                const coreRect = promptCore.getBoundingClientRect();
                const sourceX = (coreRect.left + coreRect.right) / 2 - canvasRect.left;
                const sourceY = coreRect.bottom - canvasRect.top;

                const bubbles = promptCanvas.querySelectorAll('.essay-thought-bubble');
                let pathsHtml = '';

                bubbles.forEach((bubble) => {
                    const bubbleRect = bubble.getBoundingClientRect();
                    const targetX = (bubbleRect.left + bubbleRect.right) / 2 - canvasRect.left;
                    const targetY = bubbleRect.top - canvasRect.top;
                    const isActive = bubble.classList.contains('is-active');

                    const deltaY = targetY - sourceY;
                    const cpY1 = sourceY + deltaY * 0.45;
                    const cpY2 = sourceY + deltaY * 0.55;
                    const d = `M ${sourceX} ${sourceY} C ${sourceX} ${cpY1}, ${targetX} ${cpY2}, ${targetX} ${targetY}`;

                    const strokeColor = isActive ? '#ea580c' : 'rgba(154, 87, 34, 0.35)';
                    const strokeWidth = isActive ? '3' : '2';
                    const strokeDash = isActive ? '6 4' : 'none';
                    const animClass = isActive ? 'class="mm-path-active"' : '';

                    pathsHtml += `<path d="${d}" stroke="${strokeColor}" stroke-width="${strokeWidth}" fill="none" stroke-dasharray="${strokeDash}" ${animClass} />`;
                    pathsHtml += `<circle cx="${sourceX}" cy="${sourceY}" r="3.5" fill="${strokeColor}" />`;
                    pathsHtml += `<circle cx="${targetX}" cy="${targetY}" r="4.5" fill="${strokeColor}" />`;
                });

                promptSvg.innerHTML = pathsHtml;
            }
        }

        // 2. Step 2: Stance & Idea Mind Map
        const stanceCanvas = document.getElementById('essay-brainstorm-mindmap-canvas');
        const stanceSvg = document.getElementById('essay-brainstorm-mindmap-svg');
        const stanceCore = document.getElementById('mm-stance-core');
        const stemBody1 = document.getElementById('mm-stem-body1');
        const stemBody2 = document.getElementById('mm-stem-body2');

        if (stanceCanvas && stanceSvg && stanceCore && stemBody1 && stemBody2) {
            const canvasRect = stanceCanvas.getBoundingClientRect();
            if (canvasRect.width > 0 && canvasRect.height > 0) {
                stanceSvg.setAttribute('width', canvasRect.width);
                stanceSvg.setAttribute('height', canvasRect.height);

                let pathsHtml = '';
                const coreRect = stanceCore.getBoundingClientRect();
                const coreX = (coreRect.left + coreRect.right) / 2 - canvasRect.left;
                const coreY = coreRect.bottom - canvasRect.top;

                // Core to Stems
                [stemBody1, stemBody2].forEach((stem) => {
                    const stemRect = stem.getBoundingClientRect();
                    const targetX = (stemRect.left + stemRect.right) / 2 - canvasRect.left;
                    const targetY = stemRect.top - canvasRect.top;

                    const deltaY = targetY - coreY;
                    const cpY1 = coreY + deltaY * 0.45;
                    const cpY2 = coreY + deltaY * 0.55;
                    const d = `M ${coreX} ${coreY} C ${coreX} ${cpY1}, ${targetX} ${cpY2}, ${targetX} ${targetY}`;

                    pathsHtml += `<path d="${d}" stroke="rgba(154, 87, 34, 0.4)" stroke-width="2.5" fill="none" />`;
                    pathsHtml += `<circle cx="${targetX}" cy="${targetY}" r="4" fill="#ea580c" />`;
                });

                // Stems to Picked Idea Bubbles
                const pickedBubbles = stanceCanvas.querySelectorAll('.essay-idea-bubble.is-picked');
                pickedBubbles.forEach((bubble, bIdx) => {
                    const stem = bIdx === 0 ? stemBody1 : stemBody2;
                    if (!stem) return;
                    const stemRect = stem.getBoundingClientRect();
                    const bubbleRect = bubble.getBoundingClientRect();

                    const startX = (stemRect.left + stemRect.right) / 2 - canvasRect.left;
                    const startY = stemRect.bottom - canvasRect.top;
                    const endX = (bubbleRect.left + bubbleRect.right) / 2 - canvasRect.left;
                    const endY = bubbleRect.top - canvasRect.top;

                    const deltaY = endY - startY;
                    const cpY1 = startY + deltaY * 0.5;
                    const cpY2 = startY + deltaY * 0.5;
                    const d = `M ${startX} ${startY} C ${startX} ${cpY1}, ${endX} ${cpY2}, ${endX} ${endY}`;

                    pathsHtml += `<path d="${d}" stroke="#ea580c" stroke-width="3" fill="none" stroke-dasharray="6 4" class="mm-path-active" />`;
                    pathsHtml += `<circle cx="${endX}" cy="${endY}" r="4.5" fill="#ea580c" />`;
                });

                pathsHtml += `<circle cx="${coreX}" cy="${coreY}" r="4" fill="#ea580c" />`;
                stanceSvg.innerHTML = pathsHtml;
            }
        }
    }

    if (typeof window !== 'undefined' && !window.__guidedMindMapResizeAttached) {
        window.__guidedMindMapResizeAttached = true;
        window.addEventListener('resize', () => {
            if (guidedViewMode === 'mindmap') {
                renderGuidedMindMapSVGLines();
            }
        });
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
        el.guidedRail.dataset.step = guidedSection;
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
        if (el.guidedContent) el.guidedContent.innerHTML = html + guidedStepNav();
        syncGuidedRailTopHeight();
        renderGuidedChecklist();
        renderGuidedRecycle(levelData);

        if (guidedViewMode === 'mindmap' && (section === 'understand' || section === 'direction')) {
            requestAnimationFrame(() => {
                renderGuidedMindMapSVGLines();
                setTimeout(renderGuidedMindMapSVGLines, 60);
                setTimeout(renderGuidedMindMapSVGLines, 220);
            });
        }
    }

    /** A claim reused mid-sentence: lower-cased opener, no trailing stop. */
    function asClause(text) {
        return cleanArgumentClaim(text)
            .replace(/[.\s]+$/, '')
            .replace(/^./, ch => ch.toLowerCase());
    }

    function cleanArgumentClaim(text) {
        if (!text) return '';
        let cleaned = String(text).trim();
        // Remove meta-analytical wrappers
        cleaned = cleaned.replace(/^The essay argues that\s+/i, '');
        cleaned = cleaned.replace(/^The essay uses the concept of\s+/i, '');
        cleaned = cleaned.replace(/^The essay uses two main points:\s*/i, '');
        cleaned = cleaned.replace(/^The essay emphasizes that\s+/i, '');
        cleaned = cleaned.replace(/^The body paragraphs detail how\s+/i, '');
        cleaned = cleaned.replace(/^The body paragraphs detail\s+/i, '');
        cleaned = cleaned.replace(/^School systems focus on facts, and the school limits personal passion\./i, 'Rigid schooling systems often focus excessively on facts at the expense of personal passion.');
        cleaned = cleaned.replace(/^The essay uses the concept of 'rote learning' and 'narrow scope' to support the idea that structured education can hinder genuine intellectual development\./i, 'Structured education can hinder genuine intellectual development through rote learning and restricted academic scope.');
        cleaned = cleaned.replace(/^The essay argues that formal school education is beneficial and does not interfere with natural learning\./i, 'Formal school education is fundamentally beneficial and fosters, rather than impedes, intellectual growth.');
        cleaned = cleaned.replace(/^The essay uses two main points:\s*1\)\s*Schools teach practical skills like teamwork\.\s*2\)\s*Schools provide essential knowledge for life\./i, 'Schools teach collaborative practical skills like teamwork while providing essential foundational knowledge for life.');
        // Clean leading quotes or punctuation
        cleaned = cleaned.replace(/^['"]|['"]$/g, '');
        if (cleaned.length > 0) {
            cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
        }
        return cleaned;
    }

    function generateNaturalThesis(plan, currentPrompt, level) {
        const stance = String(plan?.stance || plan?.variantId || 'agree').toLowerCase();
        const isDisagree = stance.includes('disagree');
        const promptText = String(currentPrompt || currentEntry?.prompt || '').trim();
        
        // Custom authentic theses for Q1 Einstein
        if (promptText.includes('interferes with my learning') || promptText.includes('Einstein')) {
            if (level === 'a2_b1') {
                return isDisagree 
                    ? "In my view, I disagree with Einstein because formal schooling teaches essential skills and knowledge."
                    : "In my view, I agree with Einstein because school rules and memorization can limit real learning.";
            } else if (level === 'c1') {
                return isDisagree
                    ? "In my view, I firmly refute this assertion, arguing that institutional education is indispensable for cultivating disciplined inquiry and multifaceted competence."
                    : "In my view, I firmly advocate the premise that standardized schooling frequently constrains autonomous intellectual curiosity and creativity.";
            } else {
                return isDisagree
                    ? "In my view, I disagree with Einstein's statement because structured education provides vital intellectual and social foundations."
                    : "In my view, I strongly agree with Einstein's observation because rigid school systems often hinder genuine, self-directed learning.";
            }
        }
        
        // General natural academic thesis for other prompts
        const topic = currentEntry?.verifiedPrimaryTopic || 'the given topic';
        if (isDisagree) {
            return level === 'a2_b1'
                ? `In my view, I disagree with this statement and believe that ${topic.toLowerCase()} brings significant benefits.`
                : `In my view, I firmly disagree with this viewpoint, as the practical benefits of ${topic.toLowerCase()} outweigh the perceived drawbacks.`;
        } else {
            return level === 'a2_b1'
                ? `In my view, I agree with this statement because ${topic.toLowerCase()} has several important positive effects on society.`
                : `In my view, I strongly support this perspective due to compelling educational and practical evidence.`;
        }
    }

    function getPromptSpecificTraps(promptText, common) {
        const text = String(promptText || '').toLowerCase();
        
        // 1. If pack provides rich structured common mistakes, prioritize it
        const packMistakes = (common?.commonMistakes && common.commonMistakes.length > 0) ? common.commonMistakes : common?.promptTraps;
        if (packMistakes && packMistakes.length > 0 && (packMistakes[0].mistakeEn || packMistakes[0].mistakeVi || packMistakes[0].titleEn)) {
            return packMistakes;
        }

        // 2. High-value prompt-specific common mistakes
        if (text.includes('einstein') || text.includes('interferes with my learning')) {
            return [
                {
                    titleEn: "Conflating Schooling with Genuine Learning",
                    titleVi: "Đồng nhất trường học với việc học hỏi",
                    mistakeEn: "Treating 'education' (formal schooling) and 'learning' as identical synonyms, arguing that schools are wonderful simply because learning is beneficial.",
                    mistakeVi: "Xem 'trường học' và 'sự học hỏi' là một, rồi viết bài ca ngợi trường lớp vì cho rằng việc học luôn mang lại lợi ích.",
                    whyEn: "Misses Einstein's central paradox: rigid institutional rules, rote memorization, and exam pressure can crush natural curiosity. Conflating them leads to an off-topic essay and lower Task Achievement.",
                    whyVi: "Bỏ qua nghịch lý cốt lõi của Einstein: chương trình gò bó và áp lực thi cử có thể triệt tiêu sự tò mò tự nhiên. Viết như vậy sẽ lạc đề và bị trừ điểm Task Achievement.",
                    fixEn: "Explicitly separate institutional schooling (standardized syllabus, tests) from intrinsic learning (self-driven curiosity), then debate whether school structures hinder or nurture that curiosity.",
                    fixVi: "Tách bạch rõ ràng: 'Trường lớp' là kỷ luật và thi cử, còn 'Học hỏi' là niềm vui tự khám phá. Sau đó bàn xem quy tắc trường học đang cản trở hay chắp cánh cho sự tò mò.",
                    en: "Conflating Schooling with Learning: Treating 'education' and 'learning' as synonyms leads to praising schools generally, missing Einstein's core claim that rigid curricula suppress natural curiosity. Better approach: Distinguish institutional schooling from intrinsic curiosity.",
                    vi: "Đồng nhất trường lớp với việc học: Xem trường học và học hỏi là một sẽ dẫn đến việc chỉ khen trường lớp chung chung, bỏ qua ý Einstein rằng thi cử gò bó bóp nghẹt tính tò mò. Cách viết chuẩn: Phân biệt rõ kỷ luật trường học với niềm đam mê tự học."
                },
                {
                    titleEn: "Writing an Einstein Biography Instead of an Essay",
                    titleVi: "Viết về tiểu sử Einstein thay vì bàn về giáo dục",
                    mistakeEn: "Spending whole paragraphs recounting Albert Einstein's life, his school struggles in Germany, his patent office job, or the theory of relativity.",
                    mistakeVi: "Dành cả đoạn văn kể chuyện Einstein hồi nhỏ học dốt ra sao, làm việc ở phòng cấp bằng sáng chế thế nào, hoặc giải thích thuyết tương đối.",
                    whyEn: "The prompt quotes Einstein merely to introduce a debate on modern schooling. Historical trivia wastes your 200-300 word budget and fails the prompt question.",
                    whyVi: "Đề bài trích lời Einstein chỉ để mở đầu chủ đề bàn về giáo dục. Kể chuyện tiểu sử làm lãng phí dung lượng từ (200-300 từ) và không trả lời đúng câu hỏi.",
                    fixEn: "Treat Einstein only as the speaker. Focus 100% of your arguments and evidence on modern educational institutions, curricula, and student learning today.",
                    fixVi: "Chỉ coi Einstein là người nêu vấn đề. Toàn bộ dẫn chứng và lập luận phải hướng vào hệ thống giáo dục hiện đại và học sinh ngày nay.",
                    en: "Writing a Biography: Recounting Einstein's life or physics discoveries wastes the 200-300 word limit. Better approach: Evaluate modern school systems and contemporary learning directly.",
                    vi: "Kể tiểu sử Einstein: Kể lể đời tư hay các phát minh của Einstein làm phí dung lượng từ. Cách viết chuẩn: Bàn trực tiếp về hệ thống trường học và việc học của học sinh ngày nay."
                },
                {
                    titleEn: "Answering Only One Part of the Two-Part Prompt",
                    titleVi: "Chỉ trả lời một trong hai yêu cầu của đề",
                    mistakeEn: "Jumping directly into 'I agree' without ever explaining what the statement means, or spending 250 words explaining the quote without stating a personal stance.",
                    mistakeVi: "Vào bài là đồng ý ngay mà không giải thích Einstein muốn nói gì, hoặc ngược lại giải thích cả bài mà không chốt rõ quan điểm của mình.",
                    whyEn: "The prompt asks two distinct tasks: what the statement means AND whether you think he is correct. Answering only one caps your Content score at 50%.",
                    whyVi: "Đề hỏi rõ 2 vế: câu nói đó có ý nghĩa gì VÀ bạn có nghĩ ông ấy đúng không. Trả lời thiếu một vế sẽ bị mất nửa số điểm Content.",
                    fixEn: "Dedicate the introduction and opening of Body 1 to explaining the quote's meaning, then clearly state and defend your stance across both body paragraphs.",
                    fixVi: "Dành phần mở bài và đầu thân bài 1 để giải thích ý nghĩa câu nói, sau đó khẳng định và bảo vệ lập trường của bạn xuyên suốt bài viết.",
                    en: "Single-Task Answering: Answering only what the quote means or only whether you agree loses 50% Content score. Better approach: Interpret the statement first, then defend your stance with two body paragraphs.",
                    vi: "Chỉ trả lời một vế: Chỉ giải thích câu nói hoặc chỉ nêu đồng ý sẽ mất 50% điểm Content. Cách viết chuẩn: Giải thích ý nghĩa câu nói trước, rồi bảo vệ lập trường ở 2 đoạn thân bài."
                }
            ];
        }
        
        if (text.includes('advantages outweigh') || text.includes('advantages and disadvantages') || text.includes('extreme sport') || text.includes('adventure')) {
            return [
                {
                    titleEn: "One-Sided Bias Without Analyzing Both Angles",
                    titleVi: "Viết lệch một bên mà không phân tích cả hai mặt",
                    mistakeEn: "Focusing exclusively on thrilling adventures and adrenaline rushes, completely ignoring life-threatening perils, injuries, or emergency rescue costs.",
                    mistakeVi: "Chỉ tập trung viết về sự phấn khích và rèn luyện bản lĩnh, bỏ qua hoàn toàn các mối nguy hiểm tính mạng, chấn thương hay chi phí cứu hộ.",
                    whyEn: "In an 'Advantages vs Disadvantages' essay, omitting either side immediately violates PTE Content criteria, resulting in a heavy Task Achievement deduction.",
                    whyVi: "Với dạng bài Ưu & Nhược điểm, bỏ qua một trong hai mặt sẽ vi phạm trực tiếp tiêu chí Content của PTE và bị trừ điểm rất nặng.",
                    fixEn: "Dedicate Body Paragraph 1 to psychological benefits (resilience, courage) and Body Paragraph 2 to grave hazards (fatal accidents, physical trauma).",
                    fixVi: "Chia đều: Đoạn Thân bài 1 viết về lợi ích tinh thần (bản lĩnh, dũng cảm), Đoạn Thân bài 2 viết về rủi ro nghiêm trọng (tai nạn chết người, chấn thương).",
                    en: "One-Sided Bias: Discussing only advantages or only disadvantages fails PTE Content requirements. Better approach: Analyze benefits in Body 1 and hazards in Body 2.",
                    vi: "Viết lệch một bên: Chỉ viết ưu điểm hoặc chỉ viết nhược điểm sẽ bị trừ điểm Content. Cách viết chuẩn: Phân tích mặt tốt ở Thân bài 1 và nguy cơ ở Thân bài 2."
                },
                {
                    titleEn: "Failure to Deliver a Decisive Verdict",
                    titleVi: "Liệt kê ưu nhược điểm nhưng không chốt bên nào hơn",
                    mistakeEn: "Listing pros and cons neutrally and concluding with 'there are good and bad points' without declaring which side outweighs the other.",
                    mistakeVi: "Liệt kê điểm tốt điểm xấu rồi kết luận chung chung 'cái gì cũng có hai mặt' mà không chốt rõ mặt nào áp đảo hơn.",
                    whyEn: "The prompt explicitly asks whether advantages OUTWEIGH disadvantages. An indecisive essay fails to answer the main prompt question.",
                    whyVi: "Đề bài hỏi rõ mặt lợi có ÁP ĐẢO (outweigh) mặt hại không. Kết bài nước đôi đồng nghĩa với việc chưa hoàn thành nhiệm vụ của đề.",
                    fixEn: "Explicitly declare in both your thesis and conclusion that one side decisively outweighs the other (e.g., benefits to personal growth far outweigh managed risks).",
                    fixVi: "Khẳng định dứt khoát ở cả Mở bài và Kết bài rằng mặt nào chiếm ưu thế hơn (ví dụ: giá trị phát triển bản thân vượt trội so với các rủi ro có thể kiểm soát).",
                    en: "Missing Outweigh Verdict: Simply listing pros and cons without declaring which side outweighs fails the prompt. Better approach: State decisively which side prevails in both intro and conclusion.",
                    vi: "Không chốt bên nào hơn: Liệt kê hai mặt mà không kết luận bên nào vượt trội sẽ mất điểm. Cách viết chuẩn: Khẳng định rõ mặt chiếm ưu thế ở cả Mở bài và Kết bài."
                }
            ];
        }
        
        if (text.includes('more important') && (text.includes('than') || text.includes('diet') || text.includes('exercise'))) {
            return [
                {
                    titleEn: "Fence-Sitting Instead of Comparative Evaluation",
                    titleVi: "Nói nước đôi thay vì so sánh xem yếu tố nào quan trọng hơn",
                    mistakeEn: "Writing that 'both diet and exercise are equally important 50/50' throughout the essay, avoiding taking any definitive stand.",
                    mistakeVi: "Viết cả bài khẳng định 'cả ăn uống lẫn tập luyện đều quan trọng ngang nhau 50/50', né tránh việc so sánh yếu tố nào mang tính quyết định.",
                    whyEn: "The prompt asks if diet is MORE important than exercise. A purely balanced 50/50 stance that avoids comparing their relative impact loses Task Achievement marks.",
                    whyVi: "Đề bài hỏi ăn uống có QUAN TRỌNG HƠN (more important) tập luyện không. Viết ngang bằng 50/50 và không so sánh sức ảnh hưởng sẽ bị trừ điểm Task Achievement.",
                    fixEn: "Acknowledge both play essential roles, but argue why one is more fundamental (e.g., diet provides the baseline biochemical energy and calorie control that enables exercise).",
                    fixVi: "Thừa nhận cả hai đều cần thiết, nhưng chọn một yếu tố mang tính nền tảng hơn (ví dụ: dinh dưỡng quyết định năng lượng và kiểm soát cân nặng, tạo tiền đề cho tập luyện).",
                    en: "Fence-Sitting: Saying diet and exercise are identical in importance dodges the comparative prompt. Better approach: Acknowledge both but prove why one is more fundamental.",
                    vi: "Né tránh so sánh: Cho rằng hai yếu tố quan trọng y hệt nhau sẽ trượt yêu cầu so sánh của đề. Cách viết chuẩn: Công nhận cả hai nhưng chứng minh một bên là nền tảng cốt lõi."
                },
                {
                    titleEn: "Discussing Only One Factor Exclusively",
                    titleVi: "Chỉ viết về một yếu tố mà bỏ quên yếu tố đối trọng",
                    mistakeEn: "Writing an entire essay about healthy meal planning, vitamins, and vegetables without ever mentioning physical workouts or cardiovascular exercise.",
                    mistakeVi: "Viết cả bài chỉ bàn về thực đơn ăn kiêng, rau củ quả mà không hề nhắc đến việc tập thể dục, vận động hay rèn luyện tim mạch.",
                    whyEn: "This transforms a comparative essay into a one-topic monologue, directly failing the comparative requirement of the prompt.",
                    whyVi: "Điều này biến bài luận so sánh thành bài văn chỉ nói về một chủ đề đơn lẻ, làm mất điểm hoàn thành nhiệm vụ.",
                    fixEn: "Dedicate attention to both factors: evaluate diet's primary role in Body 1, and evaluate exercise's contribution and limitations in Body 2.",
                    fixVi: "Bao quát cả hai: Phân tích vai trò cốt lõi của dinh dưỡng ở Thân bài 1, và đánh giá đóng góp cũng như giới hạn của tập luyện ở Thân bài 2.",
                    en: "Single-Topic Monologue: Omitting exercise completely turns a comparative task into a one-sided essay. Better approach: Compare both factors directly across your body paragraphs.",
                    vi: "Bỏ quên yếu tố so sánh: Chỉ nói về ăn uống mà không nhắc đến tập luyện sẽ làm hỏng dạng bài so sánh. Cách viết chuẩn: Đặt cả hai lên bàn cân xuyên suốt các đoạn thân bài."
                }
            ];
        }
        
        if (text.includes('discuss both views')) {
            return [
                {
                    titleEn: "One-Sided Favoritism in a Both-Views Task",
                    titleVi: "Thiên vị một phe trong dạng bài thảo luận cả hai quan điểm",
                    mistakeEn: "Spending 80% of the essay elaborating only the viewpoint you agree with, while giving the opposing view a single superficial sentence.",
                    mistakeVi: "Dành 80% dung lượng bài chỉ để nói về quan điểm mình ủng hộ, trong khi phe còn lại chỉ nhắc qua loa một câu ngắn.",
                    whyEn: "'Discuss both views' strictly commands equal, well-substantiated coverage of each perspective before drawing a conclusion.",
                    whyVi: "Dạng bài 'Discuss both views' yêu cầu phải phân tích công bằng và có dẫn chứng đầy đủ cho cả hai chiều quan điểm trước khi kết luận.",
                    fixEn: "Allocate Body 1 fully to exploring Viewpoint A with valid evidence, and Body 2 to exploring Viewpoint B, then justify your personal stance.",
                    fixVi: "Dành trọn vẹn Thân bài 1 cho Quan điểm A với dẫn chứng thuyết phục, và Thân bài 2 cho Quan điểm B, sau đó bảo vệ lập trường cá nhân của bạn.",
                    en: "One-Sided Favoritism: Neglecting one view in a 'Discuss both views' prompt leads to immediate score penalties. Better approach: Dedicate Body 1 to View A and Body 2 to View B fairly.",
                    vi: "Thiên vị một quan điểm: Bỏ quên một bên trong đề 'Discuss both views' sẽ bị phạt điểm nặng. Cách viết chuẩn: Dành Thân bài 1 cho Quan điểm A và Thân bài 2 cho Quan điểm B một cách công bằng."
                },
                {
                    titleEn: "Remaining Neutral Without Declaring a Stance",
                    titleVi: "Giữ thái độ trung lập mà không chốt quan điểm cá nhân",
                    mistakeEn: "Discussing both views well but failing to state which viewpoint you personally endorse or believe is correct.",
                    mistakeVi: "Phân tích cả hai quan điểm khá tốt nhưng không bao giờ nói rõ bản thân bạn đồng tình với quan điểm nào hơn.",
                    whyEn: "PTE Task Achievement requires a clear position throughout the response. An essay without a declared stance cannot score in the highest band.",
                    whyVi: "Tiêu chí chấm PTE yêu cầu người viết phải có lập trường xuyên suốt. Một bài viết không chốt phe sẽ không thể đạt band điểm tối đa.",
                    fixEn: "State your opinion clearly in the introduction thesis, maintain it through the body, and reaffirm it in the conclusion.",
                    fixVi: "Nêu rõ quan điểm của bạn ngay trong câu luận đề mở bài, duy trì sự nhất quán và khẳng định lại ở phần kết bài.",
                    en: "Ghost Stance: Failing to state your personal perspective results in lost Task Achievement points. Better approach: Declare your clear stance in both the introduction and conclusion.",
                    vi: "Không có lập trường: Không chốt quan điểm cá nhân sẽ bị trừ điểm Task Achievement. Cách viết chuẩn: Tuyên bố rõ ràng bạn theo phe nào ở cả Mở bài lẫn Kết bài."
                }
            ];
        }
        
        if (packMistakes && packMistakes.length > 0) {
            return packMistakes;
        }
        
        return [
            {
                titleEn: "Off-Topic Generalizations Without Answering the Core Prompt",
                titleVi: "Chém gió lan man ngoài đề, không bám sát từ khóa trọng tâm",
                mistakeEn: "Writing memorized, generic statements about how 'society is developing fast' instead of engaging with the exact debate in the prompt.",
                mistakeVi: "Sử dụng các câu văn học thuộc lòng chung chung như 'xã hội ngày nay đang phát triển' thay vì tập trung vào đúng vấn đề đề bài đặt ra.",
                whyEn: "PTE automated scoring checks semantic keyword relevance. Generic template padding results in lower Content scores.",
                whyVi: "Hệ thống chấm điểm tự động của PTE kiểm tra độ bám sát từ khóa. Viết câu khuôn mẫu lan man sẽ làm tụt điểm Content.",
                fixEn: "Ground every single paragraph in the prompt keywords and formulate specific, context-relevant topic sentences.",
                fixVi: "Bám sát các từ khóa chính của đề trong từng đoạn và viết câu chủ đề trực diện, chính xác với ngữ cảnh.",
                en: "Generic Vagueness: Memorized filler about modern society lowers Content scores. Better approach: Anchor every sentence in the prompt's specific keywords.",
                vi: "Lan man sáo rỗng: Nhồi nhét câu văn học thuộc lòng sẽ làm giảm điểm Content. Cách viết chuẩn: Gắn chặt từng câu vào từ khóa cụ thể của đề bài."
            },
            {
                titleEn: "Unsupported Claims Lacking Concrete Real-World Evidence",
                titleVi: "Đưa ra khẳng định suông mà không có dẫn chứng thực tế",
                mistakeEn: "Making sweeping assertions (e.g. 'this causes many problems') without providing a concrete mechanism or realistic example.",
                mistakeVi: "Đưa ra các nhận định chung chung (ví dụ: 'điều này gây ra nhiều vấn đề') nhưng không giải thích vì sao hoặc không có ví dụ cụ thể.",
                whyEn: "PTE Development criteria requires ideas to be substantiated with concrete reasons and illustrative examples.",
                whyVi: "Tiêu chí Development của PTE yêu cầu mọi luận điểm phải được làm rõ bằng nguyên nhân và ví dụ thực tế.",
                fixEn: "Follow the PEEL structure for every body idea: Point -> Explanation -> Concrete Real-World Example -> Link back to thesis.",
                fixVi: "Áp dụng cấu trúc PEEL cho từng ý: Nêu luận điểm -> Giải thích nguyên nhân -> Dẫn chứng đời thực cụ thể -> Khẳng định lại quan điểm.",
                en: "Unsupported Claims: Vague assertions without proof fail development criteria. Better approach: Use Point -> Explanation -> Concrete Example for each main idea.",
                vi: "Luận điểm thiếu chứng minh: Khẳng định suông không có ví dụ sẽ mất điểm phát triển ý. Cách viết chuẩn: Nêu ý -> Giải thích -> Ví dụ thực tế cho mỗi luận điểm."
            }
        ];
    }

    function resolveEssayTypeInfo(promptText, common) {
        const text = String(promptText || '').toLowerCase();
        const typeFromPack = String(common?.promptType || '').toLowerCase();

        // 1. Comparative Opinion (e.g. Diet vs Exercise, A more important than B)
        if (typeFromPack.includes('compare') || typeFromPack.includes('comparative') || (text.includes('more important') && (text.includes('than') || text.includes('versus') || text.includes('vs'))) || (text.includes('diet') && text.includes('exercise'))) {
            return {
                typeKey: 'comparative_opinion',
                titleEn: 'Comparative Opinion Essay',
                titleVi: 'Dạng bài: So sánh cái nào quan trọng hơn',
                icon: '⚖️',
                badgeClass: 'is-comparative',
                triggerPhraseEn: text.includes('more important for keeping fit than exercise') ? '“more important for keeping fit than exercise... To what extent do you agree?”' : '“...is more important than... To what extent do you agree?”',
                triggerPhraseVi: 'Cụm so sánh: “...is more important than... To what extent do you agree?”',
                howToRecognizeEn: 'The prompt sets two essential concepts in direct contrast and asks which holds greater weight. You MUST evaluate BOTH factors before declaring a decisive verdict on which is more vital.',
                howToRecognizeVi: 'Đề so sánh hai thứ xem cái nào quan trọng hơn. Bạn cần nhắc đến cả hai, rồi chốt rõ mình nghiêng về bên nào hơn.',
                blueprint: [
                    { partEn: 'Introduction', partVi: 'Mở bài', roleEn: 'Paraphrase comparison & state thesis declaring the paramount factor', roleVi: 'Nhắc lại 2 yếu tố & chốt xem bên nào quan trọng hơn' },
                    { partEn: 'Body Paragraph 1', partVi: 'Thân bài 1', roleEn: 'Analyze the indispensable role and benefits of Factor 1', roleVi: 'Chỉ ra mặt tốt của Yếu tố 1' },
                    { partEn: 'Body Paragraph 2', partVi: 'Thân bài 2', roleEn: 'Analyze Factor 2 and demonstrate why it exerts a more decisive impact', roleVi: 'Giải thích vì sao Yếu tố 2 quan trọng hơn hẳn' },
                    { partEn: 'Conclusion', partVi: 'Kết bài', roleEn: 'Synthesize the comparative analysis and reaffirm the primary factor', roleVi: 'Nhắc lại lựa chọn của bạn một cách ngắn gọn' }
                ]
            };
        }

        // 2. Advantages and Disadvantages
        if (typeFromPack.includes('advantage') || text.includes('advantages and disadvantages') || text.includes('benefits and drawbacks') || text.includes('pros and cons') || text.includes('extreme sports') || text.includes('adventure sports')) {
            return {
                typeKey: 'advantages_disadvantages',
                titleEn: 'Advantages & Disadvantages Essay',
                titleVi: 'Dạng bài: Lợi và Hại (Ưu & Nhược điểm)',
                icon: '⚡',
                badgeClass: 'is-adv-disadv',
                triggerPhraseEn: '“Do you think the advantages outweigh the disadvantages?” or “Discuss advantages and disadvantages”',
                triggerPhraseVi: 'Cụm từ hai mặt: “advantages / disadvantages” hoặc “outweigh”',
                howToRecognizeEn: 'The prompt highlights a trend, activity, or policy with conflicting outcomes. You must objectively explore BOTH dimensions and declare which side prevails.',
                howToRecognizeVi: 'Đề hỏi về mặt tốt và mặt xấu của một vấn đề. Bạn cần phân tích cả hai bên, rồi chốt xem cái nào nhiều hơn.',
                blueprint: [
                    { partEn: 'Introduction', partVi: 'Mở bài', roleEn: 'Introduce the topic and state whether advantages or disadvantages outweigh', roleVi: 'Nêu chủ đề & chốt xem lợi hay hại nhiều hơn' },
                    { partEn: 'Body Paragraph 1', partVi: 'Thân bài 1', roleEn: 'Examine the primary advantages and positive impacts with concrete evidence', roleVi: 'Kể ra các mặt tốt / lợi ích kèm ví dụ' },
                    { partEn: 'Body Paragraph 2', partVi: 'Thân bài 2', roleEn: 'Address the severe disadvantages / perils and evaluate their severity', roleVi: 'Chỉ ra các mặt hại / rủi ro kèm ví dụ' },
                    { partEn: 'Conclusion', partVi: 'Kết bài', roleEn: 'Deliver a final reasoned verdict on which dimension decisively prevails', roleVi: 'Khẳng định lại bên nào chiếm ưu thế' }
                ]
            };
        }

        // 3. Problem and Solution
        if (typeFromPack.includes('problem') || typeFromPack.includes('solution') || (text.includes('problems') && text.includes('solutions')) || (text.includes('causes') && text.includes('measures'))) {
            return {
                typeKey: 'problem_solution',
                titleEn: 'Problem & Solution Essay',
                titleVi: 'Dạng bài: Vấn đề & Cách giải quyết',
                icon: '🔧',
                badgeClass: 'is-problem-solution',
                triggerPhraseEn: '“What are the causes and what solutions can be proposed?”',
                triggerPhraseVi: 'Hỏi nguyên nhân & cách xử lý: “causes / solutions”',
                howToRecognizeEn: 'The prompt presents a serious issue and asks why it occurs and how it can be mitigated.',
                howToRecognizeVi: 'Đề nêu một vấn đề xã hội và hỏi tại sao lại bị như vậy, xử lý thế nào. Bạn chia bài làm 2 ý: nguyên nhân và giải pháp.',
                blueprint: [
                    { partEn: 'Introduction', partVi: 'Mở bài', roleEn: 'Paraphrase the pressing issue and outline causes and remedies', roleVi: 'Nêu vấn đề đang xảy ra và hướng giải quyết' },
                    { partEn: 'Body Paragraph 1', partVi: 'Thân bài 1', roleEn: 'Analyze the underlying root causes driving the issue', roleVi: 'Chỉ ra 1-2 nguyên nhân chính dẫn đến vấn đề' },
                    { partEn: 'Body Paragraph 2', partVi: 'Thân bài 2', roleEn: 'Propose feasible, impactful policy or technological solutions', roleVi: 'Đưa ra 1-2 cách giải quyết thực tế, làm được ngay' },
                    { partEn: 'Conclusion', partVi: 'Kết bài', roleEn: 'Reiterate the necessity of prompt action to resolve the issue', roleVi: 'Nhấn mạnh lại việc cần sớm hành động' }
                ]
            };
        }

        // 4. Default: Agree / Disagree (Quote evaluation or direct opinion)
        return {
            typeKey: 'agree_disagree',
            titleEn: 'Agree or Disagree / Opinion Essay',
            titleVi: 'Dạng bài: Đồng ý hay Phản đối (Agree / Disagree)',
            icon: '💡',
            badgeClass: 'is-agree-disagree',
            triggerPhraseEn: text.includes('do you think he is correct') ? '“What did he mean by that? Do you think he is correct?”' : '“Do you agree or disagree?” or “To what extent do you agree?”',
            triggerPhraseVi: text.includes('do you think he is correct') ? 'Hỏi thẳng ý kiến: “What did he mean by that? Do you think he is correct?”' : 'Hỏi lập trường: “Do you agree or disagree?” hoặc “To what extent do you agree?”',
            howToRecognizeEn: 'The prompt presents an assertion, philosophy, or quote and asks if you agree. You MUST interpret the core premise and establish an unambiguous, consistent stance (Strongly Agree or Strongly Disagree) supported by reasoned arguments.',
            howToRecognizeVi: 'Đề đưa ra một câu nói/ý kiến rồi hỏi bạn có đồng tình không. Bạn chỉ cần chọn rõ một phe (Đồng ý hoặc Phản đối) và giải thích lý do, đừng nói nước đôi.',
            blueprint: [
                { partEn: 'Introduction', partVi: 'Mở bài', roleEn: 'Paraphrase the quote/statement and declare a clear thesis position', roleVi: 'Nhắc lại câu nói & chốt rõ bạn theo phe nào' },
                { partEn: 'Body Paragraph 1', partVi: 'Thân bài 1', roleEn: 'Explain the core meaning and evaluate Reason 1 with evidence', roleVi: 'Giải thích ý câu nói & đưa ra lý do 1 kèm ví dụ' },
                { partEn: 'Body Paragraph 2', partVi: 'Thân bài 2', roleEn: 'Substantiate Reason 2 defending your stance with real-world examples', roleVi: 'Đưa tiếp lý do 2 kèm ví dụ thực tế để củng cố' },
                { partEn: 'Conclusion', partVi: 'Kết bài', roleEn: 'Reaffirm your definitive position and summarize core arguments', roleVi: 'Tóm tắt lại quan điểm của bạn thật ngắn gọn' }
            ]
        };
    }

    function normalizeRequirementVi(vi, en) {
        if (!vi) return String(en || '').trim();
        let str = String(vi).trim();
        if (/nêu mức độ đồng ý|state your position|agree or disagree/i.test(str)) {
            return 'Chọn rõ: Đồng ý hay Không đồng ý (tránh nói nước đôi).';
        }
        if (/hỗ trợ quan điểm bằng hai lý do|support.*two reasons|give two reasons|hai lý do rõ ràng/i.test(str)) {
            return 'Nêu đủ 2 lý do chính để bảo vệ quan điểm.';
        }
        if (/dùng ví dụ|dẫn chứng thực tế|use examples|evidence/i.test(str)) {
            return 'Kèm ví dụ thực tế cụ thể cho từng lý do.';
        }
        if (/cân nhắc|phân tích cả hai mặt|both sides|advantages and disadvantages/i.test(str)) {
            return 'Nhắc đến cả hai mặt (lợi và hại) trước khi chốt.';
        }
        return str;
    }

    function normalizeMcqVi(mcq, promptText) {
        if (!mcq) return mcq;
        const pLower = String(promptText || '').toLowerCase();
        const copy = JSON.parse(JSON.stringify(mcq));
        
        if (pLower.includes('einstein') || pLower.includes('interferes with my learning')) {
            copy.questionVi = 'Đề bài này muốn bạn làm gì nhất?';
            if (Array.isArray(copy.options)) {
                copy.options.forEach(opt => {
                    if (opt.id === 'a') {
                        opt.textVi = 'Giải thích ý của Einstein và nêu rõ bạn đồng tình hay phản đối.';
                        opt.feedbackVi = '✓ Chuẩn luôn! Cứ giải thích ngắn gọn rồi chốt phe là đúng hướng.';
                    } else if (opt.id === 'b') {
                        opt.textVi = 'Kể lại tiểu sử và các phát minh của Einstein.';
                        opt.feedbackVi = '❌ Lạc đề rồi! Đây là bài nghị luận, không phải kể chuyện lịch sử nhé.';
                    } else if (opt.id === 'c') {
                        opt.textVi = 'Kêu gọi xóa bỏ trường học mà không có giải pháp.';
                        opt.feedbackVi = '❌ Cực đoan quá! Viết luận học thuật thì đừng kết luận phiến diện nhé.';
                    }
                });
            }
        } else if (pLower.includes('exercise') && pLower.includes('diet')) {
            copy.questionVi = 'Với đề này, nhiệm vụ mấu chốt của bạn là gì?';
            if (Array.isArray(copy.options)) {
                copy.options.forEach(opt => {
                    if (opt.id === 'a') {
                        opt.textVi = 'So sánh ăn uống với tập luyện, rồi chốt xem cái nào quan trọng hơn.';
                        opt.feedbackVi = '✓ Chính xác! Phải so sánh cả 2 rồi chốt phe rõ ràng.';
                    } else if (opt.id === 'b') {
                        opt.textVi = 'Chỉ viết về chuyện ăn uống mà bỏ quên việc tập luyện.';
                        opt.feedbackVi = '❌ Thiếu ý rồi! Đề hỏi cả 2 thì phải nhắc cả 2 nhé.';
                    }
                });
            }
        } else if (pLower.includes('extreme sports') || (pLower.includes('advantages') && pLower.includes('disadvantages'))) {
            copy.questionVi = 'Gặp dạng bài Ưu & Nhược điểm, bạn cần viết thế nào?';
            if (Array.isArray(copy.options)) {
                copy.options.forEach(opt => {
                    if (opt.id === 'a') {
                        opt.textVi = 'Chỉ khen hoặc chỉ chê để bài viết quyết liệt hơn.';
                        opt.feedbackVi = '❌ Chưa đủ! Dạng này bắt buộc phải nêu cả điểm tốt lẫn điểm xấu.';
                    } else if (opt.id === 'b') {
                        opt.textVi = 'Nêu cả mặt lợi lẫn mặt hại, rồi chỉ ra mặt nào áp đảo hơn.';
                        opt.feedbackVi = '✓ Quá chuẩn! Phân tích 2 mặt rồi kết luận là ghi điểm trọn vẹn.';
                    }
                });
            }
        } else {
            if (/nhiệm vụ cốt lõi|mục tiêu|yêu cầu/i.test(copy.questionVi || '')) {
                copy.questionVi = 'Nguyên tắc quan trọng nhất khi làm bài viết luận PTE là gì?';
            }
            if (Array.isArray(copy.options)) {
                copy.options.forEach(opt => {
                    if (opt.id === 'a' && /lập trường|dứt khoát/i.test(opt.textVi || '')) {
                        opt.textVi = 'Chọn lập trường rõ ràng, có lý lẽ và ví dụ thực tế đi kèm.';
                        opt.feedbackVi = '✓ Rất tốt! Có quan điểm rõ ràng và dẫn chứng là có điểm.';
                    } else if (opt.id === 'b' && /trung lập|tránh/i.test(opt.textVi || '')) {
                        opt.textVi = 'Viết chung chung, không nghiêng về phe nào cho an toàn.';
                        opt.feedbackVi = '❌ Tránh nhé! Viết nước đôi sẽ bị trừ điểm Content đấy.';
                    }
                });
            }
        }
        return copy;
    }

    function normalizeGapFillVi(gapFill, promptText) {
        if (!gapFill) return gapFill;
        const pLower = String(promptText || '').toLowerCase();
        const copy = JSON.parse(JSON.stringify(gapFill));
        copy.instructionsVi = 'Bấm chọn các mảnh ghép để hoàn thành kế hoạch viết bài:';

        if (pLower.includes('einstein') || pLower.includes('interferes with my learning')) {
            copy.sentenceTemplateVi = 'Để làm tốt bài này, mình cần hiểu {slot1}, chọn rõ {slot2}, và đưa ra {slot3}.';
            if (Array.isArray(copy.slots)) {
                copy.slots.forEach(slot => {
                    if (slot.id === 'slot1') {
                        slot.labelVi = 'Ý kiến Einstein';
                        slot.options?.forEach(opt => {
                            if (opt.id === 'c1') opt.textVi = 'câu nói của Einstein về trường học';
                            if (opt.id === 'w1') { opt.textVi = 'các phát minh vật lý của Einstein'; opt.hintVi = 'Tập trung vào chuyện học hành thôi nhé!'; }
                        });
                    } else if (slot.id === 'slot2') {
                        slot.labelVi = 'Chọn lập trường';
                        slot.options?.forEach(opt => {
                            if (opt.id === 'c2') opt.textVi = 'phe đồng ý hoặc phản đối';
                            if (opt.id === 'w2') { opt.textVi = 'thái độ nước đôi, không rõ ràng'; opt.hintVi = 'Cần chốt phe rõ ràng bạn nhé!'; }
                        });
                    } else if (slot.id === 'slot3') {
                        slot.labelVi = 'Căn cứ bảo vệ';
                        slot.options?.forEach(opt => {
                            if (opt.id === 'c3') opt.textVi = 'lý do và ví dụ thực tế';
                            if (opt.id === 'w3') { opt.textVi = 'nhận xét chung chung'; opt.hintVi = 'Phải có ví dụ thực tế mới thuyết phục nha!'; }
                        });
                    }
                });
            }
        } else if (pLower.includes('exercise') && pLower.includes('diet')) {
            copy.sentenceTemplateVi = 'Với đề này, mình cần so sánh {slot1} với {slot2}, rồi chốt xem yếu tố nào {slot3}.';
            if (Array.isArray(copy.slots)) {
                copy.slots.forEach(slot => {
                    if (slot.id === 'slot1') {
                        slot.labelVi = 'Yếu tố 1: Ăn uống';
                        slot.options?.forEach(opt => {
                            if (opt.id === 'c1') opt.textVi = 'chế độ ăn uống';
                            if (opt.id === 'w1') { opt.textVi = 'đi ăn tiệm đắt tiền'; opt.hintVi = 'Tập trung vào dinh dưỡng lành mạnh nhé.'; }
                        });
                    } else if (slot.id === 'slot2') {
                        slot.labelVi = 'Yếu tố 2: Tập luyện';
                        slot.options?.forEach(opt => {
                            if (opt.id === 'c2') opt.textVi = 'việc tập luyện thể thao';
                            if (opt.id === 'w2') { opt.textVi = 'xem đá bóng trên TV'; opt.hintVi = 'Đang nói về việc tự vận động cơ thể nha.'; }
                        });
                    } else if (slot.id === 'slot3') {
                        slot.labelVi = 'Đánh giá chốt';
                        slot.options?.forEach(opt => {
                            if (opt.id === 'c3') opt.textVi = 'quan trọng hơn với sức khỏe';
                            if (opt.id === 'w3') { opt.textVi = 'không có tác dụng gì'; opt.hintVi = 'Cả hai đều quan trọng, hãy so sánh xem cái nào nhỉnh hơn.'; }
                        });
                    }
                });
            }
        } else if (pLower.includes('extreme sports') || (pLower.includes('advantages') && pLower.includes('disadvantages'))) {
            copy.sentenceTemplateVi = 'Bài này mình cần phân tích cả {slot1} lẫn {slot2} của thể thao mạo hiểm, rồi nêu rõ mặt nào {slot3}.';
            if (Array.isArray(copy.slots)) {
                copy.slots.forEach(slot => {
                    if (slot.id === 'slot1') {
                        slot.labelVi = 'Mặt 1: Điểm tốt';
                        slot.options?.forEach(opt => {
                            if (opt.id === 'c1') opt.textVi = 'lợi ích rèn luyện tinh thần';
                            if (opt.id === 'w1') { opt.textVi = 'giá dụng cụ rẻ tiền'; opt.hintVi = 'Tập trung vào cảm giác vượt qua chính mình nhé.'; }
                        });
                    } else if (slot.id === 'slot2') {
                        slot.labelVi = 'Mặt 2: Điểm xấu';
                        slot.options?.forEach(opt => {
                            if (opt.id === 'c2') opt.textVi = 'nguy cơ chấn thương nguy hiểm';
                            if (opt.id === 'w2') { opt.textVi = 'việc tốn một chút thời gian'; opt.hintVi = 'Môn này nguy hiểm tính mạng đấy nhé.'; }
                        });
                    } else if (slot.id === 'slot3') {
                        slot.labelVi = 'Kết luận';
                        slot.options?.forEach(opt => {
                            if (opt.id === 'c3') opt.textVi = 'chiếm ưu thế hơn';
                            if (opt.id === 'w3') { opt.textVi = 'hoàn toàn vô nghĩa'; opt.hintVi = 'So sánh xem lợi hay hại nhiều hơn nha.'; }
                        });
                    }
                });
            }
        } else {
            if (/để đạt điểm cao/i.test(copy.sentenceTemplateVi || '')) {
                copy.sentenceTemplateVi = 'Để đạt điểm cao, mình cần phân tích {slot1}, giữ vững {slot2}, và chứng minh bằng {slot3}.';
            }
        }
        return copy;
    }

    function renderGuidedViewToggle() {
        if (guidedSection === 'understand') {
            return `
            <div class="essay-guided-view-toggle-bar">
                <span class="essay-guided-view-toggle-label">${guidedText('Layout Mode:', 'Cách xem:')}</span>
                <div class="essay-guided-view-toggle" role="group" aria-label="${guidedText('Select view mode', 'Chọn cách xem')}">
                    <button type="button" class="essay-view-toggle-btn${guidedStep1Layout === 'whiteboard' ? ' is-active' : ''}" data-guided-action="set-step1-layout" data-layout="whiteboard" title="${guidedText('Whiteboard Canvas', 'Bảng vẽ ý tưởng')}">
                        <span class="essay-view-toggle-icon">🗺️</span>
                        <span>${guidedText('Whiteboard', 'Bảng vẽ ý tưởng')}</span>
                    </button>
                    <button type="button" class="essay-view-toggle-btn${guidedStep1Layout === 'stations' ? ' is-active' : ''}" data-guided-action="set-step1-layout" data-layout="stations" title="${guidedText('Station Tabs', 'Chia theo trạm')}">
                        <span class="essay-view-toggle-icon">🏛️</span>
                        <span>${guidedText('Station Tabs', 'Chia theo trạm')}</span>
                    </button>
                    <button type="button" class="essay-view-toggle-btn${guidedStep1Layout === 'hud' ? ' is-active' : ''}" data-guided-action="set-step1-layout" data-layout="hud" title="${guidedText('Quick Summary', 'Tóm tắt nhanh')}">
                        <span class="essay-view-toggle-icon">⚡</span>
                        <span>${guidedText('Quick Summary', 'Tóm tắt nhanh')}</span>
                    </button>
                    <button type="button" class="essay-view-toggle-btn${guidedStep1Layout === 'list' ? ' is-active' : ''}" data-guided-action="set-step1-layout" data-layout="list" title="${guidedText('Compact List', 'Danh sách')}">
                        <span class="essay-view-toggle-icon">📋</span>
                        <span>${guidedText('Compact List', 'Danh sách')}</span>
                    </button>
                </div>
            </div>`;
        }

        return `
        <div class="essay-guided-view-toggle-bar">
            <span class="essay-guided-view-toggle-label">${guidedText('Ideation View:', 'Góc nhìn tư duy:')}</span>
            <div class="essay-guided-view-toggle" role="group" aria-label="${guidedText('Select view mode', 'Chọn chế độ xem')}">
                <button type="button" class="essay-view-toggle-btn${guidedViewMode === 'mindmap' ? ' is-active' : ''}" data-guided-action="set-guided-view-mode" data-view-mode="mindmap" aria-pressed="${guidedViewMode === 'mindmap' ? 'true' : 'false'}">
                    <span class="essay-view-toggle-icon">🗺️</span>
                    <span>${guidedText('Mind Map', 'Sơ đồ tư duy')}</span>
                </button>
                <button type="button" class="essay-view-toggle-btn${guidedViewMode === 'list' ? ' is-active' : ''}" data-guided-action="set-guided-view-mode" data-view-mode="list" aria-pressed="${guidedViewMode === 'list' ? 'true' : 'false'}">
                    <span class="essay-view-toggle-icon">📋</span>
                    <span>${guidedText('Compact List', 'Danh sách')}</span>
                </button>
            </div>
        </div>`;
    }

    function renderInteractivePromptStructure(segments, promptText) {
        let segList = segments;
        if (!segList || segList.length === 0) {
            if (promptText) {
                const rawMatches = promptText.match(/[^.!?]+[.!?]+/g) || [promptText];
                segList = rawMatches.map((s, idx) => ({ id: `segment-${idx + 1}`, text: s.trim() }));
            }
        }
        if (!segList || segList.length === 0) return '';
        
        const parsedSegments = segList.map((seg, idx) => {
            const text = String(seg.text || '').trim();
            const lower = text.toLowerCase();
            const pLower = String(promptText || '').toLowerCase();
            
            let roleTitleEn = seg.roleTitleEn || 'Prompt Component';
            let roleTitleVi = seg.roleTitleVi || 'Thành phần đề bài';
            let roleIcon = '💡';
            let meaningEn = seg.meaningEn || '';
            let meaningVi = seg.meaningVi || '';
            let takeawayEn = seg.takeawayEn || '';
            let takeawayVi = seg.takeawayVi || '';

            // 1. Question #1: Einstein Quote
            if (pLower.includes('einstein') || pLower.includes('interferes with my learning')) {
                if (idx === 0 || lower.includes('interferes') || lower.includes('einstein')) {
                    roleTitleEn = 'The Quote & Paradox';
                    roleTitleVi = 'Câu danh ngôn của Einstein';
                    roleIcon = '📌';
                    meaningEn = 'Einstein claimed that rigid, standardized schooling ("education") can actually stifle a person\'s natural curiosity and authentic discovery ("learning").';
                    meaningVi = 'Einstein cho rằng trường lớp gò bó và áp lực điểm số dễ làm mất đi niềm vui tự học và tính tò mò tự nhiên.';
                    takeawayEn = 'Core contrast: Formal schooling ("education") vs. self-driven curiosity ("learning").';
                    takeawayVi = 'Mấu chốt: Khác biệt giữa học bị ép ("education") và tự học say mê ("learning").';
                } else if (lower.includes('what did he mean') || lower.includes('explain')) {
                    roleTitleEn = 'Interpretation Task';
                    roleTitleVi = 'Giải thích ý câu nói';
                    roleIcon = '🔍';
                    meaningEn = 'Asks you to unpack Einstein\'s logic: why and how do traditional school structures restrict independent creative thought?';
                    meaningVi = 'Đề muốn bạn chỉ ra: vì sao cách dạy rập khuôn ở trường lại cản trở sự sáng tạo?';
                    takeawayEn = 'Explain the underlying reason why schooling can hinder creative development.';
                    takeawayVi = 'Cần nêu: lý do trường học truyền thống hạn chế học sinh tự do tìm tòi.';
                } else {
                    roleTitleEn = 'Your Judgment';
                    roleTitleVi = 'Chọn phe của bạn';
                    roleIcon = '⚖️';
                    meaningEn = 'Asks for your personal stance: Do you agree that schooling stifles learning, or do you believe structured education is essential for foundation?';
                    meaningVi = 'Bạn thấy câu của Einstein đúng hay sai? Đồng ý, phản đối, hay thấy cả hai bên đều có lý?';
                    takeawayEn = 'Form a clear judgment: Agree, Disagree, or Balanced perspective.';
                    takeawayVi = 'Chốt rõ: Đồng ý, Phản đối, hoặc Dung hòa cả hai bên.';
                }
            }
            // 2. Question #2: Diet vs Exercise
            else if (pLower.includes('exercise') && pLower.includes('diet')) {
                if (idx === 0 || lower.includes('exercise') || lower.includes('diet')) {
                    roleTitleEn = 'The Core Debate';
                    roleTitleVi = 'Chủ đề so sánh';
                    roleIcon = '🥗';
                    meaningEn = 'Presents a common health debate: comparing regular physical workouts directly against strict dietary regimens.';
                    meaningVi = 'Đề đặt việc ăn uống lành mạnh lên bàn cân với việc chăm chỉ tập thể dục.';
                    takeawayEn = 'Direct comparison: Physical exercise vs. nutritional control.';
                    takeawayVi = 'Mấu chốt: So sánh trực tiếp giữa Ăn uống và Tập luyện.';
                } else if (lower.includes('extent do you agree') || lower.includes('agree or disagree') || lower.includes('opinion')) {
                    roleTitleEn = 'Your Position';
                    roleTitleVi = 'Chọn lập trường';
                    roleIcon = '⚖️';
                    meaningEn = 'Asks where you stand: is exercise truly more vital, is nutrition more fundamental, or must both work in synergy?';
                    meaningVi = 'Bạn nghiêng về bên nào hơn: ăn uống quyết định tất cả, tập luyện quan trọng hơn, hay cả hai phải đi đôi?';
                    takeawayEn = 'Take a clear side or argue that health requires an integrated combination.';
                    takeawayVi = 'Chốt rõ: Chọn một bên quan trọng hơn hoặc kết hợp cả hai.';
                } else {
                    roleTitleEn = 'Evidence Requirement';
                    roleTitleVi = 'Đưa dẫn chứng';
                    roleIcon = '💡';
                    meaningEn = 'Reminds you to back up your claims with realistic facts, scientific logic, or everyday observations.';
                    meaningVi = 'Đừng nói suông, hãy dùng ví dụ thực tế hoặc dẫn chứng đời thường để bảo vệ ý kiến.';
                    takeawayEn = 'Ground your opinions in believable real-world examples.';
                    takeawayVi = 'Ghi nhớ: Luôn có ví dụ thực tế đi kèm lý lẽ.';
                }
            }
            // 3. Question #23: Extreme Sports
            else if (pLower.includes('extreme sports') || (pLower.includes('advantages') && pLower.includes('disadvantages'))) {
                if (lower.includes('advantages and disadvantages') || lower.includes('pros and cons') || idx === 0) {
                    roleTitleEn = 'Two-Sided Evaluation';
                    roleTitleVi = 'Phân tích hai mặt';
                    roleIcon = '🧗';
                    meaningEn = 'Asks you to examine high-risk sports (skydiving, rock climbing, big-wave surfing): evaluating both positive thrills and dangerous drawbacks.';
                    meaningVi = 'Nêu cả hai mặt của thể thao mạo hiểm: cảm giác phấn khích, thử thách bản thân vs nguy hiểm tính mạng.';
                    takeawayEn = 'Must examine both positive thrills and physical perils objectively.';
                    takeawayVi = 'Bắt buộc: Phải viết cả điểm tốt và điểm xấu, không bỏ sót mặt nào.';
                } else {
                    roleTitleEn = 'Evidence & Substantiation';
                    roleTitleVi = 'Dẫn chứng thực tế';
                    roleIcon = '💡';
                    meaningEn = 'Substantiate both the benefits and risks with realistic scenarios and clear explanations.';
                    meaningVi = 'Dùng các môn quen thuộc (nhảy dù, leo núi...) làm ví dụ minh họa cho lập luận của bạn.';
                    takeawayEn = 'Illustrate both advantages and risks with concrete real-world contexts.';
                    takeawayVi = 'Ghi nhớ: Dẫn chứng càng cụ thể, bài viết càng thuyết phục.';
                }
            }
            // 4. General Fallback for all other prompts
            else {
                const isQuote = text.includes('“') || text.includes('"') || text.includes('–') || lower.includes('said') || lower.includes('stated');
                if (isQuote || (!text.includes('?') && idx === 0)) {
                    roleTitleEn = isQuote ? 'Quote / Central Premise' : 'Background Topic Premise';
                    roleTitleVi = isQuote ? 'Nhận định gốc' : 'Chủ đề chính của đề';
                    roleIcon = '📌';
                    meaningEn = `Introduces the primary subject of discussion: "${text.replace(/[“”"–-]/g, '').trim()}".`;
                    meaningVi = `Chủ đề chính cần bàn: "${text.replace(/[“”"–-]/g, '').trim()}".`;
                    takeawayEn = 'Understand the underlying context and key concept being debated.';
                    takeawayVi = 'Nắm chắc ý chính của câu nói trước khi viết.';
                } else if (lower.includes('what did he mean') || lower.includes('what do you mean') || lower.includes('explain')) {
                    roleTitleEn = 'Meaning & Interpretation';
                    roleTitleVi = 'Giải thích ý nghĩa';
                    roleIcon = '🔍';
                    meaningEn = 'Asks you to clarify the deeper meaning, underlying mechanism, or rationale behind the statement.';
                    meaningVi = 'Làm rõ: vì sao tác giả lại đưa ra nhận định như vậy?';
                    takeawayEn = 'Unpack the "why" and "how" behind the prompt statement.';
                    takeawayVi = 'Chỉ ra lý do và bản chất cốt lõi của vấn đề.';
                } else if (lower.includes('agree or disagree') || lower.includes('extent do you agree') || lower.includes('do you agree') || lower.includes('correct?')) {
                    roleTitleEn = 'Personal Stance Request';
                    roleTitleVi = 'Chọn phe của bạn';
                    roleIcon = '⚖️';
                    meaningEn = 'Directly checks where you stand: whether you support the prompt claim, oppose it, or take a balanced view.';
                    meaningVi = 'Bạn đồng ý hay phản đối nhận định này? Hãy chọn rõ ràng ngay từ đầu.';
                    takeawayEn = 'Establish a clear, consistent personal position.';
                    takeawayVi = 'Giữ lập trường nhất quán từ mở bài đến kết bài.';
                } else if (lower.includes('cause') || lower.includes('solution') || lower.includes('problem') || lower.includes('measure')) {
                    roleTitleEn = 'Problem Analysis & Remedies';
                    roleTitleVi = 'Nguyên nhân & Giải pháp';
                    roleIcon = '🔧';
                    meaningEn = 'Asks you to examine why this social problem exists and identify concrete measures to solve or mitigate it.';
                    meaningVi = 'Tìm lý do vì sao vấn đề xảy ra và đề xuất cách xử lý thực tế.';
                    takeawayEn = 'Connect underlying root causes with realistic, actionable solutions.';
                    takeawayVi = 'Mỗi nguyên nhân cần đi kèm một giải pháp tương ứng.';
                } else if (lower.includes('example') || lower.includes('experience') || lower.includes('reasons')) {
                    roleTitleEn = 'Supporting Evidence';
                    roleTitleVi = 'Lý lẽ & Ví dụ';
                    roleIcon = '💡';
                    meaningEn = 'Reminds you that all arguments must be supported by sound reasoning and believable real-world examples.';
                    meaningVi = 'Củng cố quan điểm bằng lập luận logic và ví dụ thực tế đời thường.';
                    takeawayEn = 'Back up every assertion with logical explanations and examples.';
                    takeawayVi = 'Ý nào cũng nên có ví dụ đi kèm cho thuyết phục.';
                } else {
                    roleTitleEn = 'Task Directive';
                    roleTitleVi = 'Yêu cầu của đề';
                    roleIcon = '🎯';
                    meaningEn = `Focuses your attention on this specific requirement: "${text}".`;
                    meaningVi = `Tập trung vào nhiệm vụ này: "${text}".`;
                    takeawayEn = 'Make sure this requirement is clearly understood.';
                    takeawayVi = 'Hiểu đúng yêu cầu để không bị lạc đề.';
                }
            }
            
            const isSegSelected = guidedSelectedPromptSegment === `seg_${idx + 1}`;
            return {
                index: idx + 1,
                text,
                roleTitleEn,
                roleTitleVi,
                roleIcon,
                meaningEn,
                meaningVi,
                takeawayEn,
                takeawayVi,
                isSegSelected
            };
        });

        if (guidedViewMode === 'mindmap') {
            const promptQuote = parsedSegments[0]?.text || promptText;
            let formattedMainQuote = String(promptQuote).replace(/^[“"']+|[”"']+$/g, '').trim();
            return `
            <div class="essay-guided-dissector-wrap essay-mindmap-mode">
                <div class="essay-mindmap-canvas" id="essay-prompt-mindmap-canvas">
                    <svg class="essay-mindmap-svg" id="essay-prompt-mindmap-svg" aria-hidden="true"></svg>

                    <!-- Central Question Hub -->
                    <div class="essay-mindmap-core" id="mm-prompt-core">
                        <div class="essay-mindmap-core-spark">💡</div>
                        <div class="essay-mindmap-core-badge">${guidedText('Core Question & Quote', 'Nhận định trọng tâm')}</div>
                        <div class="essay-mindmap-core-title">“${escapeHtml(formattedMainQuote)}”</div>
                        <div class="essay-mindmap-core-hint">${guidedText('Click any thought bubble below to brainstorm its meaning', 'Bấm vào từng bóng ý nghĩ bên dưới để khám phá góc nhìn')}</div>
                    </div>

                    <!-- Thought Bubbles Row -->
                    <div class="essay-mindmap-bubbles-row">
                        ${parsedSegments.map(item => {
                            let formattedQuote = String(item.text || '').trim();
                            if (!formattedQuote.startsWith('“') && !formattedQuote.startsWith('"')) {
                                formattedQuote = `“${formattedQuote}”`;
                            }
                            const isSelected = item.isSegSelected;
                            return `
                            <div class="essay-thought-bubble bubble-${item.index}${isSelected ? ' is-active' : ''}" id="mm-bubble-${item.index}" data-guided-action="select-prompt-segment" data-segment-id="seg_${item.index}" role="button" tabindex="0">
                                <div class="essay-thought-tail" aria-hidden="true">
                                    <span class="tail-dot d1"></span>
                                    <span class="tail-dot d2"></span>
                                    <span class="tail-dot d3"></span>
                                </div>
                                <div class="essay-thought-head">
                                    <span class="essay-thought-icon">${item.roleIcon}</span>
                                    <div class="essay-thought-meta">
                                        <span class="essay-thought-badge">${guidedText('Clause', 'Vế')} ${item.index}</span>
                                        <strong class="essay-thought-role">${escapeHtml(guidedText(item.roleTitleEn, item.roleTitleVi))}</strong>
                                    </div>
                                </div>
                                <div class="essay-thought-quote">${escapeHtml(formattedQuote)}</div>
                                <div class="essay-thought-hint-bar">
                                    <span class="essay-thought-hint-text">${isSelected ? guidedText('▲ Hide details', '▲ Thu gọn') : guidedText('💭 Click to explore thought', '💭 Bấm xem góc nhìn tư duy')}</span>
                                </div>
                                ${isSelected ? `
                                <div class="essay-thought-callout">
                                    <div class="essay-thought-callout-item">
                                        <span class="essay-thought-callout-tag">📖 ${guidedText('Simple meaning:', 'Ý đơn giản là:')}</span>
                                        <p class="essay-thought-callout-text">${escapeHtml(guidedText(item.meaningEn, item.meaningVi))}</p>
                                    </div>
                                    <div class="essay-thought-callout-item">
                                        <span class="essay-thought-callout-tag">💡 ${guidedText('Key concept:', 'Điểm mấu chốt:')}</span>
                                        <p class="essay-thought-callout-text">${escapeHtml(guidedText(item.takeawayEn, item.takeawayVi))}</p>
                                    </div>
                                </div>` : ''}
                            </div>`;
                        }).join('')}
                    </div>
                </div>
            </div>`;
        }

        return `
        <div class="essay-guided-dissector-wrap essay-list-mode">
            <div class="essay-guided-prompt-hero">
                <div class="essay-guided-prompt-hero-head">
                    <div class="essay-prompt-hero-title-group">
                        <span class="essay-prompt-hero-badge">📌 ${guidedText('Deconstructed Question Prompt', 'Đề bài tách theo từng vế')}</span>
                        <span class="essay-prompt-hero-hint">${guidedText('Click any highlighted clause to view its meaning below', 'Bấm vào từng vế màu bên dưới để xem giải nghĩa nhanh')}</span>
                    </div>
                    ${guidedHelpBtn('clauses')}
                </div>
                <div class="essay-guided-prompt-flow-text">
                    ${parsedSegments.map(item => `
                        <span class="essay-prompt-hl hl-${item.index}${item.isSegSelected ? ' is-selected' : ''}" data-guided-action="select-prompt-segment" data-segment-id="seg_${item.index}" role="button" tabindex="0">
                            <span class="essay-prompt-hl-num">${item.index}</span>
                            <span class="essay-prompt-hl-body">${escapeHtml(item.text)}</span>
                        </span>
                    `).join(' ')}
                </div>
            </div>

            <div class="essay-guided-flowchart">
                <div class="essay-flowchart-arrow-strip" aria-hidden="true">
                    ${parsedSegments.map(item => `
                        <div class="essay-flowchart-arrow-col col-${item.index}${item.isSegSelected ? ' is-selected' : ''}">
                            <span class="essay-flowchart-arrow-label">${guidedText('Clause', 'Vế')} ${item.index}</span>
                            <span class="essay-flowchart-arrow-icon">↓</span>
                        </div>
                    `).join('')}
                </div>
                <div class="essay-flowchart-nodes-grid">
                    ${parsedSegments.map((item) => {
                        let formattedQuote = String(item.text || '').trim();
                        if (!formattedQuote.startsWith('“') && !formattedQuote.startsWith('"')) {
                            formattedQuote = `“${formattedQuote}”`;
                        }
                        return `
                    <div class="essay-flowchart-card card-${item.index}${item.isSegSelected ? ' is-selected' : ''}" id="flowchart-card-${item.index}" data-guided-action="select-prompt-segment" data-segment-id="seg_${item.index}" role="button" tabindex="0">
                        <div class="essay-flowchart-card-head">
                            <span class="essay-flowchart-card-num num-${item.index}">${item.index}</span>
                            <div class="essay-flowchart-card-meta">
                                <strong class="essay-flowchart-card-role">${escapeHtml(guidedText(item.roleTitleEn, item.roleTitleVi))}</strong>
                            </div>
                        </div>
                        <div class="essay-flowchart-card-body">
                            <div class="essay-clause-quote">${escapeHtml(formattedQuote)}</div>
                            <div class="essay-clause-meaning">
                                <span class="essay-clause-label">📖 ${guidedText('What this means in plain terms', 'Ý đơn giản là:')}</span>
                                <p class="essay-clause-text">${escapeHtml(guidedText(item.meaningEn, item.meaningVi))}</p>
                            </div>
                            <div class="essay-clause-takeaway">
                                <span class="essay-clause-takeaway-label">💡 ${guidedText('Key concept', 'Điểm mấu chốt:')}</span>
                                <p class="essay-clause-takeaway-text">${escapeHtml(guidedText(item.takeawayEn, item.takeawayVi))}</p>
                            </div>
                        </div>
                    </div>`;
                    }).join('')}
                </div>
            </div>
        </div>`;
    }

    function renderGuidedUnderstand() {
        const common = guidedPack.common || {};
        const section = GUIDED_SECTIONS[0];
        const promptText = String(guidedPack.prompt || currentEntry?.prompt || '').trim();

        // 1. Part 1: Interactive Question Structure & Visual Flowchart
        const segments = common.promptSegments || [];
        const segmentsHtml = renderInteractivePromptStructure(segments, promptText);

        // 2. Part 2: Essay Type & Recognition Blueprint
        const essayTypeInfo = resolveEssayTypeInfo(promptText, common);
        const essayTypeCardHtml = `
        <div class="essay-guided-type-card ${essayTypeInfo.badgeClass}">
            <div class="essay-type-card-top">
                <div class="essay-type-badge-row">
                    <span class="essay-type-badge">${essayTypeInfo.icon} ${escapeHtml(guidedText(essayTypeInfo.titleEn, essayTypeInfo.titleVi))}</span>
                    <span class="essay-type-tag">PTE Standard</span>
                </div>
                <div class="essay-type-trigger-row">
                    <span class="essay-type-trigger-label">🔍 ${guidedText('Trigger in prompt:', 'Từ khóa nhận biết:')}</span>
                    <code class="essay-type-trigger-code">${escapeHtml(guidedText(essayTypeInfo.triggerPhraseEn, essayTypeInfo.triggerPhraseVi))}</code>
                </div>
                <div class="essay-type-reasoning">
                    <strong>${guidedText('How do we know what type it is?', 'Cách nhận biết dạng bài:')}</strong>
                    <p>${escapeHtml(guidedText(essayTypeInfo.howToRecognizeEn, essayTypeInfo.howToRecognizeVi))}</p>
                </div>
            </div>
            <div class="essay-type-blueprint">
                <span class="essay-blueprint-title">📐 ${guidedText('PTE 4-Paragraph Blueprint for this type:', 'Dàn ý chuẩn 4 đoạn cho dạng này:')}</span>
                <div class="essay-blueprint-grid">
                    ${essayTypeInfo.blueprint.map((b, bIdx) => `
                        <div class="essay-blueprint-step">
                            <span class="essay-blueprint-step-num">${bIdx + 1}</span>
                            <div class="essay-blueprint-step-content">
                                <strong class="essay-blueprint-step-part">${escapeHtml(guidedText(b.partEn, b.partVi))}</strong>
                                <span class="essay-blueprint-step-role">${escapeHtml(guidedText(b.roleEn, b.roleVi))}</span>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>`;

        // 3. Clear Instructional Requirements Criteria (No dummy checkboxes, no "Task Response", natural Vietnamese)
        const reqs = common.requirements || [];
        const reqsHtml = reqs.length ? `
            <div class="essay-guided-req-guide">
                <div class="essay-guided-req-head">
                    <span class="essay-guided-req-badge">📋 ${guidedText('PTE Mandatory Scoring Criteria', '3 yêu cầu cần có trong bài')}</span>
                    <p class="essay-guided-req-subtext">${guidedText('Core criteria required by PTE official scoring rubrics (Content, Form & Development):', 'Để giám khảo chấm trọn điểm nội dung (Content), bài của bạn cần có:')}</p>
                </div>
                <div class="essay-guided-req-list">
                    ${reqs.map((item, idx) => {
                        const viText = normalizeRequirementVi(item.vi, item.en);
                        const displayText = guidedLanguage === 'vi' ? viText : (item.en || viText);
                        return `
                        <div class="essay-guided-req-card-static">
                            <span class="essay-guided-req-num">${idx + 1}</span>
                            <span class="essay-guided-req-text">${escapeHtml(displayText)}</span>
                        </div>`;
                    }).join('')}
                </div>
            </div>` : '';

        // 4. Prompt-Specific Common Mistakes (Insightful 3-tier Breakdown)
        const traps = getPromptSpecificTraps(promptText, common);
        const trapsHtml = traps.length ? `
            <div class="essay-guided-mistakes-container">
                <div class="essay-guided-mistakes-intro">
                    <p class="essay-guided-mistakes-sub">${guidedText('Review these high-risk pitfalls to understand what goes wrong, why it hurts your score, and how to write it properly:', 'Xem kỹ các lỗi thường gặp dưới đây để biết cách tránh mất điểm Content và Task Achievement:')}</p>
                </div>
                <div class="essay-guided-mistakes-list">
                    ${traps.map((item, idx) => {
                        const title = guidedText(item.titleEn, item.titleVi) || `${guidedText('Mistake', 'Lỗi')} #${idx + 1}`;
                        const mistake = guidedText(item.mistakeEn, item.mistakeVi);
                        const why = guidedText(item.whyEn, item.whyVi);
                        const fix = guidedText(item.fixEn, item.fixVi);
                        
                        if (mistake || why || fix) {
                            return `
                            <div class="essay-guided-mistake-card">
                                <div class="essay-guided-mistake-head">
                                    <span class="essay-guided-mistake-badge">⚠️ ${guidedText('Mistake', 'Lỗi')} #${idx + 1}</span>
                                    <h4 class="essay-guided-mistake-title">${escapeHtml(title)}</h4>
                                </div>
                                <div class="essay-guided-mistake-body">
                                    ${mistake ? `
                                    <div class="essay-guided-mistake-row is-mistake">
                                        <span class="essay-guided-mistake-tag">🛑 ${guidedText('The Mistake', 'Nhầm lẫn phổ biến')}</span>
                                        <p class="essay-guided-mistake-desc">${escapeHtml(mistake)}</p>
                                    </div>` : ''}
                                    ${why ? `
                                    <div class="essay-guided-mistake-row is-why">
                                        <span class="essay-guided-mistake-tag">💥 ${guidedText('Why It Fails', 'Tại sao mất điểm')}</span>
                                        <p class="essay-guided-mistake-desc">${escapeHtml(why)}</p>
                                    </div>` : ''}
                                    ${fix ? `
                                    <div class="essay-guided-mistake-row is-fix">
                                        <span class="essay-guided-mistake-tag">💡 ${guidedText('Better Approach', 'Cách viết chuẩn')}</span>
                                        <p class="essay-guided-mistake-desc">${escapeHtml(fix)}</p>
                                    </div>` : ''}
                                </div>
                            </div>`;
                        }

                        const rawText = bilingual(item);
                        return `
                        <div class="essay-guided-mistake-card">
                            <div class="essay-guided-mistake-head">
                                <span class="essay-guided-mistake-badge">⚠️ ${guidedText('Mistake', 'Lỗi')} #${idx + 1}</span>
                                <h4 class="essay-guided-mistake-title">${escapeHtml(title)}</h4>
                            </div>
                            <div class="essay-guided-mistake-body">
                                <div class="essay-guided-mistake-row is-fix">
                                    <p class="essay-guided-mistake-desc">${escapeHtml(rawText)}</p>
                                </div>
                            </div>
                        </div>`;
                    }).join('')}
                </div>
            </div>` : '';

        // 5. Grouped Stances & Approaches (2 Columns for Comparison with Bullet Points)
        const angles = common.angles || [];
        const grouped = {};
        angles.forEach((item, idx) => {
            let stanceKey = String(item.sourceVariantId || 'general').trim().toLowerCase();
            if (!stanceKey || stanceKey === 'undefined') stanceKey = 'general';
            if (!grouped[stanceKey]) grouped[stanceKey] = [];
            grouped[stanceKey].push({ ...item, originalIndex: idx });
        });

        const stanceLabels = {
            agree: { en: 'Stance 1: Agree (Support)', vi: 'Phe 1: Đồng ý (Agree)', icon: '👍', tone: 'agree' },
            disagree: { en: 'Stance 2: Disagree (Alternative)', vi: 'Phe 2: Phản đối (Disagree)', icon: '👎', tone: 'disagree' },
            positive: { en: 'Stance 1: More Benefits', vi: 'Phe 1: Nghiêng về mặt tốt', icon: '✨', tone: 'agree' },
            negative: { en: 'Stance 2: More Drawbacks', vi: 'Phe 2: Nghiêng về mặt hại', icon: '⚠️', tone: 'disagree' },
            advantage: { en: 'Advantages / Positive Aspects', vi: 'Mặt tốt / Thuận lợi', icon: '✨', tone: 'agree' },
            disadvantage: { en: 'Disadvantages / Negative Aspects', vi: 'Mặt hại / Rủi ro', icon: '⚠️', tone: 'disagree' },
            general: { en: 'Key Perspectives', vi: 'Các góc nhìn trọng tâm', icon: '🎯', tone: 'general' }
        };

        let anglesHtml = '';
        const stanceKeys = Object.keys(grouped);
        if (stanceKeys.length > 0) {
            anglesHtml = `
            <div class="essay-guided-approaches-box">
                <div class="essay-guided-approaches-head">
                    <span class="essay-guided-approaches-badge">⚖️ ${guidedText('Comparative Approaches (Side-by-Side)', 'Gợi ý 2 hướng viết')}</span>
                    <p class="essay-guided-approaches-sub">${guidedText('Compare both stances side-by-side to choose the most convincing direction for your essay:', 'Xem nhanh 2 phe để chọn hướng bạn thấy dễ viết nhất:')}</p>
                </div>
                <div class="essay-guided-stance-columns">
                    ${stanceKeys.map(key => {
                        const meta = stanceLabels[key] || { en: `Approach: ${key.toUpperCase()}`, vi: `Hướng tiếp cận: ${key.toUpperCase()}`, icon: '📌', tone: 'general' };
                        const items = grouped[key];
                        return `
                        <div class="essay-guided-stance-col is-${meta.tone}">
                            <div class="essay-guided-stance-head">
                                <span class="essay-guided-stance-badge">${meta.icon} ${escapeHtml(guidedText(meta.en, meta.vi))}</span>
                                <span class="essay-guided-stance-count">${items.length} ${guidedText('ideas', 'ý')}</span>
                            </div>
                            <ul class="essay-guided-bullet-list">
                                ${items.map(item => {
                                    const rawText = cleanArgumentClaim(preferTranslated(item.en, guidedLanguage === 'vi' ? item.vi : ''));
                                    let boldTitle = '';
                                    let restText = rawText;
                                    const colonIdx = rawText.indexOf(':');
                                    if (colonIdx > 0 && colonIdx < 60) {
                                        boldTitle = rawText.slice(0, colonIdx + 1);
                                        restText = rawText.slice(colonIdx + 1).trim();
                                    }
                                    return `<li>
                                        ${boldTitle ? `<strong class="essay-bullet-lead">${escapeHtml(boldTitle)}</strong> ` : ''}<span>${escapeHtml(restText)}</span>
                                    </li>`;
                                }).join('')}
                            </ul>
                        </div>`;
                    }).join('')}
                </div>
            </div>`;
        }

        // 6. Robust Interactive Comprehension Checks (MCQ + Gap Fill Blueprint)
        const checkData = common.comprehensionCheck || {};
        const isAdvPrompt = promptText.toLowerCase().includes('advantages and disadvantages') || promptText.toLowerCase().includes('advantages');
        const isDietPrompt = promptText.toLowerCase().includes('diet') && promptText.toLowerCase().includes('exercise');
        const isEinsteinPrompt = promptText.toLowerCase().includes('einstein') || promptText.toLowerCase().includes('interferes with my learning');

        // Check 1: Multiple Choice Question (MCQ)
        let mcq = checkData.mcq ? normalizeMcqVi(checkData.mcq, promptText) : null;
        if (!mcq) {
            if (isEinsteinPrompt) {
                mcq = {
                    questionEn: 'What is the primary objective of your essay response to Einstein\'s quote?',
                    questionVi: 'Đề bài này muốn bạn làm gì nhất?',
                    correct: 'a',
                    options: [
                        {
                            id: 'a',
                            textEn: 'Interpret Einstein\'s core meaning, declare a decisive stance (agree or disagree), and justify it with educational reasoning.',
                            textVi: 'Giải thích ý của Einstein và nêu rõ bạn đồng tình hay phản đối.',
                            feedbackEn: '✓ Correct! PTE scoring requires both interpreting the quote\'s core meaning and articulating a clear personal stance.',
                            feedbackVi: '✓ Chuẩn luôn! Cứ giải thích ngắn gọn rồi chốt phe là đúng hướng.'
                        },
                        {
                            id: 'b',
                            textEn: 'Recount the life biography and scientific discoveries of Albert Einstein in chronological order.',
                            textVi: 'Kể lại tiểu sử và các phát minh của Einstein.',
                            feedbackEn: '❌ Off-target: This is an argumentative essay on education, not a biographical summary of Einstein.',
                            feedbackVi: '❌ Lạc đề rồi! Đây là bài nghị luận, không phải kể chuyện lịch sử nhé.'
                        }
                    ]
                };
            } else if (isDietPrompt) {
                mcq = {
                    questionEn: 'What is the critical PTE requirement when evaluating diet versus exercise?',
                    questionVi: 'Với đề này, nhiệm vụ mấu chốt của bạn là gì?',
                    correct: 'a',
                    options: [
                        {
                            id: 'a',
                            textEn: 'Directly compare the relative contributions of diet and exercise to fitness, then take a definitive stand on which is more vital.',
                            textVi: 'So sánh ăn uống với tập luyện, rồi chốt xem cái nào quan trọng hơn.',
                            feedbackEn: '✓ Correct! A comparative essay demands direct evaluation of both factors followed by a clear, reasoned verdict.',
                            feedbackVi: '✓ Chính xác! Phải so sánh cả 2 rồi chốt phe rõ ràng.'
                        },
                        {
                            id: 'b',
                            textEn: 'Discuss only healthy meal recipes and completely omit any discussion of physical workouts.',
                            textVi: 'Chỉ viết về chuyện ăn uống mà bỏ quên việc tập luyện.',
                            feedbackEn: '❌ Incomplete essay content: You must evaluate BOTH diet and exercise to satisfy the comparative prompt.',
                            feedbackVi: '❌ Thiếu ý rồi! Đề hỏi cả 2 thì phải nhắc cả 2 nhé.'
                        }
                    ]
                };
            } else if (isAdvPrompt) {
                mcq = {
                    questionEn: 'What is the primary requirement of this Advantages & Disadvantages prompt?',
                    questionVi: 'Gặp dạng bài Ưu & Nhược điểm, bạn cần viết thế nào?',
                    correct: 'b',
                    options: [
                        {
                            id: 'a',
                            textEn: 'Argue only one single side to make your essay as persuasive as possible.',
                            textVi: 'Chỉ khen hoặc chỉ chê để bài viết quyết liệt hơn.',
                            feedbackEn: '❌ Incomplete essay content: You must address both advantages and disadvantages to satisfy PTE Content criteria.',
                            feedbackVi: '❌ Chưa đủ! Dạng này bắt buộc phải nêu cả điểm tốt lẫn điểm xấu.'
                        },
                        {
                            id: 'b',
                            textEn: 'Objectively analyze both advantages and disadvantages, and state which side outweighs.',
                            textVi: 'Nêu cả mặt lợi lẫn mặt hại, rồi chỉ ra mặt nào áp đảo hơn.',
                            feedbackEn: '✓ Excellent! Both sides must be analyzed with a clear personal stance.',
                            feedbackVi: '✓ Quá chuẩn! Phân tích 2 mặt rồi kết luận là ghi điểm trọn vẹn.'
                        }
                    ]
                };
            } else {
                mcq = {
                    questionEn: 'What does PTE scoring require for your argument in this essay?',
                    questionVi: 'Nguyên tắc quan trọng nhất khi làm bài viết luận PTE là gì?',
                    correct: 'a',
                    options: [
                        {
                            id: 'a',
                            textEn: 'State a clear and decisive stance, supported by well-developed reasons and examples.',
                            textVi: 'Chọn lập trường rõ ràng, có lý lẽ và ví dụ thực tế đi kèm.',
                            feedbackEn: '✓ Excellent! A decisive, well-supported stance is required.',
                            feedbackVi: '✓ Rất tốt! Có quan điểm rõ ràng và dẫn chứng là có điểm.'
                        },
                        {
                            id: 'b',
                            textEn: 'Avoid choosing a stance and remain completely neutral throughout.',
                            textVi: 'Viết chung chung, không nghiêng về phe nào cho an toàn.',
                            feedbackEn: '❌ Incorrect: PTE requires you to establish and defend a clear stance.',
                            feedbackVi: '❌ Tránh nhé! Viết nước đôi sẽ bị trừ điểm Content đấy.'
                        }
                    ]
                };
            }
        }

        const mcqHtml = `
        <div class="essay-guided-interactive-quiz">
            <div class="essay-guided-quiz-head">
                <span class="essay-guided-quiz-badge">💡 ${guidedText('Comprehension Check 1: Core Prompt Task', 'Câu hỏi nhanh: Bạn hiểu đề bài thế nào?')}</span>
                <p class="essay-guided-quiz-question">${escapeHtml(guidedText(mcq.questionEn, mcq.questionVi))}</p>
            </div>
            <div class="essay-guided-quiz-options">
                ${mcq.options.map(opt => {
                    const isSelected = guidedComprehensionQuizAnswer === opt.id;
                    const isCorrectOpt = opt.id === mcq.correct;
                    const optClass = isSelected ? (isCorrectOpt ? ' is-correct' : ' is-wrong') : '';
                    return `
                    <button type="button" class="essay-guided-quiz-opt${optClass}" data-guided-action="answer-comprehension-quiz" data-quiz-option="${opt.id}">
                        <span class="essay-guided-quiz-letter">${opt.id.toUpperCase()}</span>
                        <span class="essay-guided-quiz-opt-text">${escapeHtml(guidedText(opt.textEn, opt.textVi))}</span>
                        ${isSelected ? `<span class="essay-guided-quiz-feedback${isCorrectOpt ? ' is-correct' : ' is-wrong'}">${escapeHtml(guidedText(opt.feedbackEn, opt.feedbackVi))}</span>` : ''}
                    </button>`;
                }).join('')}
            </div>
        </div>`;

        // Check 2: Interactive Gap-Fill (Macro Strategy Blueprint)
        let gapFill = checkData.gapFill ? normalizeGapFillVi(checkData.gapFill, promptText) : null;
        if (!gapFill) {
            if (isEinsteinPrompt) {
                gapFill = {
                    sentenceTemplateEn: 'To excel in this essay, I must evaluate {slot1}, declare a {slot2}, and defend my position with {slot3}.',
                    sentenceTemplateVi: 'Để làm tốt bài này, mình cần hiểu {slot1}, chọn rõ {slot2}, và đưa ra {slot3}.',
                    slots: [
                        {
                            id: 'slot1',
                            labelEn: 'Einstein\'s Quote',
                            labelVi: 'Ý kiến Einstein',
                            correctId: 'c1',
                            options: [
                                { id: 'c1', textEn: 'Einstein\'s critique of schooling', textVi: 'câu nói của Einstein về trường học' },
                                { id: 'w1', textEn: 'Einstein\'s physics discoveries', textVi: 'các phát minh vật lý của Einstein', hintEn: 'Stay focused on the quote about education and learning.', hintVi: 'Tập trung vào chuyện học hành thôi nhé!' }
                            ]
                        },
                        {
                            id: 'slot2',
                            labelEn: 'Personal Stance',
                            labelVi: 'Chọn lập trường',
                            correctId: 'c2',
                            options: [
                                { id: 'c2', textEn: 'clear agree or disagree stance', textVi: 'phe đồng ý hoặc phản đối' },
                                { id: 'w2', textEn: 'neutral, undecided viewpoint', textVi: 'thái độ nước đôi, không rõ ràng', hintEn: 'A decisive stance is essential for high PTE marks.', hintVi: 'Cần chốt phe rõ ràng bạn nhé!' }
                            ]
                        },
                        {
                            id: 'slot3',
                            labelEn: 'Support Type',
                            labelVi: 'Căn cứ bảo vệ',
                            correctId: 'c3',
                            options: [
                                { id: 'c3', textEn: 'concrete educational evidence', textVi: 'lý do và ví dụ thực tế' },
                                { id: 'w3', textEn: 'unsupported generalizations', textVi: 'nhận xét chung chung', hintEn: 'Support your claims with reasons and real-world observations.', hintVi: 'Phải có ví dụ thực tế mới thuyết phục nha!' }
                            ]
                        }
                    ]
                };
            } else if (isDietPrompt) {
                gapFill = {
                    sentenceTemplateEn: 'To answer this prompt effectively, I must compare {slot1} with {slot2}, and justify which has a {slot3}.',
                    sentenceTemplateVi: 'Với đề này, mình cần so sánh {slot1} với {slot2}, rồi chốt xem yếu tố nào {slot3}.',
                    slots: [
                        {
                            id: 'slot1',
                            labelEn: 'Core Factor 1',
                            labelVi: 'Yếu tố 1: Ăn uống',
                            correctId: 'c1',
                            options: [
                                { id: 'c1', textEn: 'nutritional dietary habits', textVi: 'chế độ ăn uống' },
                                { id: 'w1', textEn: 'expensive restaurant meals', textVi: 'đi ăn tiệm đắt tiền', hintEn: 'Focus on balanced diet and nutrition.', hintVi: 'Tập trung vào dinh dưỡng lành mạnh nhé.' }
                            ]
                        },
                        {
                            id: 'slot2',
                            labelEn: 'Core Factor 2',
                            labelVi: 'Yếu tố 2: Tập luyện',
                            correctId: 'c2',
                            options: [
                                { id: 'c2', textEn: 'regular physical workout regimens', textVi: 'việc tập luyện thể thao' },
                                { id: 'w2', textEn: 'watching professional sports on TV', textVi: 'xem đá bóng trên TV', hintEn: 'Evaluate actual physical exercise and activity.', hintVi: 'Đang nói về việc tự vận động cơ thể nha.' }
                            ]
                        },
                        {
                            id: 'slot3',
                            labelEn: 'Definitive Verdict',
                            labelVi: 'Đánh giá chốt',
                            correctId: 'c3',
                            options: [
                                { id: 'c3', textEn: 'more profound effect on overall fitness', textVi: 'quan trọng hơn với sức khỏe' },
                                { id: 'w3', textEn: 'negligible influence on the human body', textVi: 'không có tác dụng gì', hintEn: 'Both play significant roles; evaluate the greater contribution.', hintVi: 'Cả hai đều quan trọng, hãy so sánh xem cái nào nhỉnh hơn.' }
                            ]
                        }
                    ]
                };
            } else if (isAdvPrompt) {
                gapFill = {
                    sentenceTemplateEn: 'In this essay, I must examine the {slot1} alongside the {slot2} of adventure sports before deciding which aspect {slot3}.',
                    sentenceTemplateVi: 'Bài này mình cần phân tích cả {slot1} lẫn {slot2} của thể thao mạo hiểm, rồi nêu rõ mặt nào {slot3}.',
                    slots: [
                        {
                            id: 'slot1',
                            labelEn: 'Side 1: Advantages',
                            labelVi: 'Mặt 1: Điểm tốt',
                            correctId: 'c1',
                            options: [
                                { id: 'c1', textEn: 'psychological & physical benefits', textVi: 'lợi ích rèn luyện tinh thần' },
                                { id: 'w1', textEn: 'cheap equipment costs', textVi: 'giá dụng cụ rẻ tiền', hintEn: 'Focus on authentic personal and societal benefits.', hintVi: 'Tập trung vào cảm giác vượt qua chính mình nhé.' }
                            ]
                        },
                        {
                            id: 'slot2',
                            labelEn: 'Side 2: Disadvantages',
                            labelVi: 'Mặt 2: Điểm xấu',
                            correctId: 'c2',
                            options: [
                                { id: 'c2', textEn: 'life-threatening injury hazards', textVi: 'nguy cơ chấn thương nguy hiểm' },
                                { id: 'w2', textEn: 'minor scheduling conflicts', textVi: 'việc tốn một chút thời gian', hintEn: 'Extreme sports carry severe, catastrophic physical perils.', hintVi: 'Môn này nguy hiểm tính mạng đấy nhé.' }
                            ]
                        },
                        {
                            id: 'slot3',
                            labelEn: 'Personal Stance',
                            labelVi: 'Kết luận',
                            correctId: 'c3',
                            options: [
                                { id: 'c3', textEn: 'decisively outweighs the other', textVi: 'chiếm ưu thế hơn' },
                                { id: 'w3', textEn: 'is completely irrelevant', textVi: 'hoàn toàn vô nghĩa', hintEn: 'State clearly whether benefits exceed drawbacks or vice versa.', hintVi: 'So sánh xem lợi hay hại nhiều hơn nha.' }
                            ]
                        }
                    ]
                };
            } else {
                gapFill = {
                    sentenceTemplateEn: 'To address this essay prompt, I must evaluate {slot1}, articulate a {slot2}, and substantiate my argument with {slot3}.',
                    sentenceTemplateVi: 'Để đạt điểm cao, mình cần phân tích {slot1}, giữ vững {slot2}, và chứng minh bằng {slot3}.',
                    slots: [
                        {
                            id: 'slot1',
                            labelEn: 'Core Task',
                            labelVi: 'Trọng tâm đề',
                            correctId: 'c1',
                            options: [
                                { id: 'c1', textEn: 'the central prompt controversy', textVi: 'vấn đề chính của đề bài' },
                                { id: 'w1', textEn: 'unrelated background topics', textVi: 'chuyện ngoài lề', hintEn: 'Stay directly focused on the prompt topic.', hintVi: 'Bám sát đề bài nhé!' }
                            ]
                        },
                        {
                            id: 'slot2',
                            labelEn: 'Thesis Statement',
                            labelVi: 'Quan điểm cá nhân',
                            correctId: 'c2',
                            options: [
                                { id: 'c2', textEn: 'clear, unambiguous stance', textVi: 'lập trường rõ ràng từ đầu đến cuối' },
                                { id: 'w2', textEn: 'vague, contradictory opinion', textVi: 'ý kiến nước đôi, mâu thuẫn', hintEn: 'A clear position throughout is essential for high scores.', hintVi: 'Đừng nói nước đôi nha.' }
                            ]
                        },
                        {
                            id: 'slot3',
                            labelEn: 'Supporting Evidence',
                            labelVi: 'Dẫn chứng',
                            correctId: 'c3',
                            options: [
                                { id: 'c3', textEn: 'logical reasons and relevant examples', textVi: 'lý do kèm ví dụ thực tế' },
                                { id: 'w3', textEn: 'hasty, unsubstantiated generalizations', textVi: 'nhận định vu vơ không căn cứ', hintEn: 'PTE requires well-developed logical progression.', hintVi: 'Nhớ đưa ví dụ thực tế nhé!' }
                            ]
                        }
                    ]
                };
            }
        }

        let sentenceEn = gapFill.sentenceTemplateEn;
        let sentenceVi = gapFill.sentenceTemplateVi;
        let allSlotsFilled = true;
        let allSlotsCorrect = true;

        gapFill.slots.forEach(slot => {
            const chosenId = guidedComprehensionGapSlots[slot.id];
            const chosenOpt = slot.options.find(o => o.id === chosenId);
            const isFilled = !!chosenOpt;
            const isCorrect = isFilled && chosenId === slot.correctId;
            if (!isFilled) allSlotsFilled = false;
            if (!isCorrect) allSlotsCorrect = false;

            const slotTextEn = isFilled ? chosenOpt.textEn : `[ ${slot.labelEn} ]`;
            const slotTextVi = isFilled ? chosenOpt.textVi : `[ ${slot.labelVi} ]`;
            const slotClass = isFilled ? (isCorrect ? ' is-filled' : ' is-wrong') : '';

            sentenceEn = sentenceEn.replace(`{${slot.id}}`, `<span class="essay-guided-gap-slot${slotClass}">${escapeHtml(slotTextEn)}</span>`);
            sentenceVi = sentenceVi.replace(`{${slot.id}}`, `<span class="essay-guided-gap-slot${slotClass}">${escapeHtml(slotTextVi)}</span>`);
        });

        const gapFillHtml = `
        <div class="essay-guided-gapfill-box">
            <div class="essay-guided-gapfill-head">
                <div class="essay-guided-gapfill-title-wrap">
                    <span class="essay-guided-gapfill-badge">🧩 ${guidedText('Comprehension Check 2: Core Strategy Blueprint', 'Ghép từ: Chốt nhanh chiến lược làm bài')}</span>
                    ${Object.keys(guidedComprehensionGapSlots).length > 0 ? `<button type="button" class="essay-guided-gapfill-reset" data-guided-action="reset-gap-fill">${guidedText('↺ Reset', '↺ Làm lại')}</button>` : ''}
                </div>
                <p class="essay-guided-gapfill-instructions">${escapeHtml(guidedText(gapFill.instructionsEn || 'Select the correct strategic blocks below to lock in the core essay execution plan:', gapFill.instructionsVi || 'Bấm chọn các mảnh ghép để hoàn thành kế hoạch viết bài:'))}</p>
            </div>
            <div class="essay-guided-gapfill-sentence">
                ${guidedLanguage === 'vi' ? sentenceVi : sentenceEn}
            </div>
            ${allSlotsFilled && allSlotsCorrect ? `
                <div class="essay-guided-gapfill-success">
                    <span>🎉 ${guidedText('Outstanding! You have mastered the core essay strategy and are ready to select your arguments.', 'Tuyệt vời! Bạn đã nắm chắc hướng làm bài rồi đấy.')}</span>
                </div>
            ` : `
                <div class="essay-guided-gapfill-slots">
                    ${gapFill.slots.map((slot, sIdx) => {
                        const currentChosen = guidedComprehensionGapSlots[slot.id];
                        const chosenOpt = slot.options.find(o => o.id === currentChosen);
                        return `
                        <div class="essay-guided-gap-row">
                            <span class="essay-guided-gap-row-label">${sIdx + 1}. ${escapeHtml(guidedText(slot.labelEn, slot.labelVi))}:</span>
                            <div class="essay-guided-gap-options">
                                ${slot.options.map(opt => {
                                    const isSelected = currentChosen === opt.id;
                                    const isCorrect = opt.id === slot.correctId;
                                    const chipClass = isSelected ? (isCorrect ? ' is-correct' : ' is-wrong') : '';
                                    return `<button type="button" class="essay-guided-gap-chip${chipClass}" data-guided-action="select-gap-chip" data-slot-id="${slot.id}" data-option-id="${opt.id}">
                                        ${isSelected ? (isCorrect ? '✓ ' : '✕ ') : ''}${escapeHtml(guidedText(opt.textEn, opt.textVi))}
                                    </button>`;
                                }).join('')}
                            </div>
                            ${chosenOpt && chosenOpt.hintEn && chosenOpt.id !== slot.correctId ? `<span class="essay-guided-gap-hint">⚠️ ${escapeHtml(guidedText(chosenOpt.hintEn, chosenOpt.hintVi))}</span>` : ''}
                        </div>`;
                    }).join('')}
                </div>
            `}
        </div>`;

        let contentHtml = '';
        if (guidedStep1Layout === 'whiteboard') {
            contentHtml = renderStep1Whiteboard(segments, promptText, essayTypeInfo, grouped, stanceLabels, traps, reqs, mcqHtml, gapFillHtml);
        } else if (guidedStep1Layout === 'stations') {
            contentHtml = renderStep1Stations(segments, promptText, essayTypeInfo, grouped, stanceLabels, traps, reqs, mcqHtml, gapFillHtml);
        } else if (guidedStep1Layout === 'hud') {
            contentHtml = renderStep1Hud(segments, promptText, essayTypeInfo, grouped, stanceLabels, traps, reqs, mcqHtml, gapFillHtml);
        } else {
            contentHtml = renderStep1List(segmentsHtml, essayTypeCardHtml, reqsHtml, trapsHtml, anglesHtml, mcqHtml, gapFillHtml);
        }

        return `<section class="essay-guided-section essay-step1-container">
            ${renderGuidedViewToggle()}
            ${contentHtml}
        </section>`;
    }

    function renderStep1Whiteboard(segments, promptText, essayTypeInfo, grouped, stanceLabels, traps, reqs, mcqHtml, gapFillHtml) {
        const segmentsHtml = renderInteractivePromptStructure(segments, promptText);
        const stanceKeys = Object.keys(grouped);

        let twoSidesHtml = '';
        if (stanceKeys.length >= 2) {
            const side1Key = stanceKeys[0];
            const side2Key = stanceKeys[1];
            const meta1 = stanceLabels[side1Key] || { en: 'Stance 1', vi: 'Phe 1', icon: '👍', tone: 'agree' };
            const meta2 = stanceLabels[side2Key] || { en: 'Stance 2', vi: 'Phe 2', icon: '👎', tone: 'disagree' };
            const items1 = grouped[side1Key] || [];
            const items2 = grouped[side2Key] || [];

            let side1Count = 0;
            items1.forEach((_, idx) => { if (guidedStep1SelectedChips.has(`${side1Key}-${idx}`)) side1Count++; });
            let side2Count = 0;
            items2.forEach((_, idx) => { if (guidedStep1SelectedChips.has(`${side2Key}-${idx}`)) side2Count++; });

            twoSidesHtml = `
            <div class="essay-wb-twosides-box">
                <div class="essay-wb-section-head">
                    <span class="essay-wb-section-badge">⚖️ ${guidedText('Two Angles to Consider', 'So sánh 2 phe')}</span>
                    <p class="essay-wb-section-sub">${guidedText('Click on ideas to test which direction is easier and more natural for you to write:', 'Bấm chọn thử các ý để xem bạn thấy phe nào dễ viết và thuyết phục hơn:')}</p>
                </div>
                <div class="essay-wb-twosides-grid">
                    <div class="essay-wb-side-card is-${meta1.tone}">
                        <div class="essay-wb-side-head">
                            <span class="essay-wb-side-title">${meta1.icon} ${escapeHtml(guidedText(meta1.en, meta1.vi))}</span>
                            <span class="essay-wb-side-count">${side1Count} ${guidedText('selected', 'ý đã chọn')}</span>
                        </div>
                        <div class="essay-wb-side-chips">
                            ${items1.map((item, idx) => {
                                const chipId = `${side1Key}-${idx}`;
                                const isPicked = guidedStep1SelectedChips.has(chipId);
                                const rawText = cleanArgumentClaim(preferTranslated(item.en, guidedLanguage === 'vi' ? item.vi : ''));
                                return `
                                <button type="button" class="essay-wb-chip${isPicked ? ' is-active' : ''}" data-guided-action="toggle-side-chip" data-chip-id="${chipId}">
                                    <span class="essay-wb-chip-icon">${isPicked ? '✓' : '+'}</span>
                                    <span>${escapeHtml(rawText)}</span>
                                </button>`;
                            }).join('')}
                        </div>
                    </div>
                    <div class="essay-wb-side-card is-${meta2.tone}">
                        <div class="essay-wb-side-head">
                            <span class="essay-wb-side-title">${meta2.icon} ${escapeHtml(guidedText(meta2.en, meta2.vi))}</span>
                            <span class="essay-wb-side-count">${side2Count} ${guidedText('selected', 'ý đã chọn')}</span>
                        </div>
                        <div class="essay-wb-side-chips">
                            ${items2.map((item, idx) => {
                                const chipId = `${side2Key}-${idx}`;
                                const isPicked = guidedStep1SelectedChips.has(chipId);
                                const rawText = cleanArgumentClaim(preferTranslated(item.en, guidedLanguage === 'vi' ? item.vi : ''));
                                return `
                                <button type="button" class="essay-wb-chip${isPicked ? ' is-active' : ''}" data-guided-action="toggle-side-chip" data-chip-id="${chipId}">
                                    <span class="essay-wb-chip-icon">${isPicked ? '✓' : '+'}</span>
                                    <span>${escapeHtml(rawText)}</span>
                                </button>`;
                            }).join('')}
                        </div>
                    </div>
                </div>
            </div>`;
        }

        const blueprint = essayTypeInfo.blueprint || [];
        const activeStepIdx = Math.max(0, Math.min(guidedStep1PipelineStep - 1, blueprint.length - 1));
        const activeBlueprint = blueprint[activeStepIdx] || { partVi: 'Đoạn ' + guidedStep1PipelineStep, roleVi: 'Nhiệm vụ đoạn' };

        let stepTrap = null;
        if (traps && traps.length > 0) {
            if (activeStepIdx === 0 && traps[1]) stepTrap = traps[1];
            else if (activeStepIdx === 1 && traps[0]) stepTrap = traps[0];
            else if (activeStepIdx === 2 && traps[2]) stepTrap = traps[2];
            else stepTrap = traps[0];
        }

        const pipelineHtml = `
        <div class="essay-wb-pipeline-box">
            <div class="essay-wb-section-head">
                <span class="essay-wb-section-badge">🏛️ ${guidedText('4-Paragraph Blueprint', 'Khung dàn ý 4 đoạn')}</span>
                <p class="essay-wb-section-sub">${guidedText('Click on each paragraph to view its primary mission and common pitfalls to avoid:', 'Bấm vào từng đoạn để xem nhiệm vụ chính và mẹo tránh mất điểm:')}</p>
            </div>
            <div class="essay-wb-pipeline-stepper">
                ${blueprint.map((b, idx) => {
                    const stepNum = idx + 1;
                    const isActive = stepNum === guidedStep1PipelineStep;
                    return `
                    <button type="button" class="essay-wb-pipe-btn${isActive ? ' is-active' : ''}" data-guided-action="select-pipeline-step" data-step-num="${stepNum}">
                        <div class="essay-wb-pipe-top">
                            <span class="essay-wb-pipe-num">${stepNum}</span>
                            <span class="essay-wb-pipe-label">${escapeHtml(guidedText(b.partEn, b.partVi))}</span>
                        </div>
                        <div class="essay-wb-pipe-role">${escapeHtml(guidedText(b.roleEn, b.roleVi))}</div>
                        <div class="essay-wb-pipe-footer">
                            <span class="essay-wb-pipe-tag">${idx === 0 ? '2-3 câu' : (idx === 3 ? '1-2 câu' : '4-5 câu')}</span>
                            ${isActive ? '<span class="essay-wb-pipe-trap-badge">⚠️ Lưu ý</span>' : ''}
                        </div>
                    </button>`;
                }).join('')}
            </div>

            <div class="essay-wb-pipeline-drawer">
                <div class="essay-wb-drawer-head">
                    <span class="essay-wb-drawer-pill">🎯 ${guidedText('Viewing:', 'Đang xem:')} ${escapeHtml(guidedText(activeBlueprint.partEn, activeBlueprint.partVi))}</span>
                </div>
                <div class="essay-wb-drawer-content">
                    <p class="essay-wb-drawer-mission">
                        <strong>${guidedText('Mission:', 'Nhiệm vụ chính:')}</strong> ${escapeHtml(guidedText(activeBlueprint.roleEn, activeBlueprint.roleVi))}
                    </p>
                    ${stepTrap ? `
                    <div class="essay-wb-drawer-trap">
                        <span class="essay-wb-drawer-trap-icon">⚠️</span>
                        <div class="essay-wb-drawer-trap-text">
                            <strong>${guidedText('Watch out:', 'Lưu ý tránh mất điểm:')}</strong>
                            <span>${escapeHtml(guidedText(stepTrap.mistakeEn || stepTrap.en, stepTrap.mistakeVi || stepTrap.vi))}</span>
                        </div>
                    </div>` : ''}
                </div>
            </div>
        </div>`;

        return `
        <div class="essay-guided-whiteboard-layout">
            <div class="essay-step1-part essay-step1-part-1">
                <div class="essay-step1-part-header">
                    <span class="essay-step1-part-pill">Part 1</span>
                    <h3 class="essay-step1-part-title">${guidedText('Understanding Parts of the Question', 'Hiểu nhanh các vế của đề bài')}</h3>
                </div>
                ${segmentsHtml}
            </div>
            <div class="essay-step1-part essay-step1-part-2">
                <div class="essay-step1-part-header">
                    <span class="essay-step1-part-pill">Part 2</span>
                    <h3 class="essay-step1-part-title">${guidedText('Stances & Structure', 'So sánh 2 phe & Khung dàn ý')}</h3>
                </div>
                ${twoSidesHtml}
                ${pipelineHtml}
                ${mcqHtml}
                ${gapFillHtml}
            </div>
        </div>`;
    }

    function renderStep1Stations(segments, promptText, essayTypeInfo, grouped, stanceLabels, traps, reqs, mcqHtml, gapFillHtml) {
        const blueprint = essayTypeInfo.blueprint || [];
        const stanceKeys = Object.keys(grouped);

        const navHtml = `
        <div class="essay-stations-nav-bar">
            <span class="essay-stations-nav-label">${guidedText('Quick Stations:', 'Xem theo từng phần:')}</span>
            <div class="essay-stations-nav" role="tablist">
                <button type="button" class="essay-station-tab-btn${guidedStep1StationTab === 'blueprint' ? ' is-active' : ''}" data-guided-action="select-station-tab" data-station="blueprint">
                    <span>🏛️</span>
                    <span>${guidedText('Station 1: 4-Paragraph Outline', 'Trạm 1: Dàn ý 4 đoạn')}</span>
                </button>
                <button type="button" class="essay-station-tab-btn${guidedStep1StationTab === 'stances' ? ' is-active' : ''}" data-guided-action="select-station-tab" data-station="stances">
                    <span>⚖️</span>
                    <span>${guidedText('Station 2: Two Angles', 'Trạm 2: Hai hướng làm bài')}</span>
                </button>
                <button type="button" class="essay-station-tab-btn${guidedStep1StationTab === 'traps' ? ' is-active' : ''}" data-guided-action="select-station-tab" data-station="traps">
                    <span>⚠️</span>
                    <span>${guidedText('Station 3: Tips & Practice', 'Trạm 3: Mẹo tránh lỗi & Luyện tập')}</span>
                </button>
            </div>
        </div>`;

        let paneContent = '';
        if (guidedStep1StationTab === 'blueprint') {
            paneContent = `
            <div class="essay-station-pane is-blueprint">
                <div class="essay-station-blueprint-grid">
                    <div class="essay-station-type-card">
                        <span class="essay-station-card-badge">🔍 ${guidedText('Essay Type', 'Dạng bài nhận biết')}</span>
                        <h4 class="essay-station-type-title">${escapeHtml(guidedText(essayTypeInfo.titleEn, essayTypeInfo.titleVi))}</h4>
                        <p class="essay-station-type-desc">${escapeHtml(guidedText(essayTypeInfo.howToRecognizeEn, essayTypeInfo.howToRecognizeVi))}</p>
                        <div class="essay-station-trigger">
                            <span class="essay-station-trigger-lbl">${guidedText('Trigger in prompt:', 'Từ khóa trong đề:')}</span>
                            <code>${escapeHtml(guidedText(essayTypeInfo.triggerPhraseEn, essayTypeInfo.triggerPhraseVi))}</code>
                        </div>
                    </div>
                    <div class="essay-station-outline-card">
                        <span class="essay-station-card-badge">📐 ${guidedText('4-Paragraph Structure', 'Khung bài 4 đoạn')}</span>
                        <div class="essay-station-outline-rows">
                            ${blueprint.map((b, idx) => `
                            <div class="essay-station-outline-row">
                                <span class="essay-station-outline-num">${idx + 1}</span>
                                <div class="essay-station-outline-text">
                                    <strong class="essay-station-outline-part">${escapeHtml(guidedText(b.partEn, b.partVi))}</strong>
                                    <span class="essay-station-outline-role">${escapeHtml(guidedText(b.roleEn, b.roleVi))}</span>
                                </div>
                            </div>`).join('')}
                        </div>
                    </div>
                </div>
            </div>`;
        } else if (guidedStep1StationTab === 'stances') {
            paneContent = `
            <div class="essay-station-pane is-stances">
                <div class="essay-station-stances-grid">
                    ${stanceKeys.slice(0, 2).map(key => {
                        const meta = stanceLabels[key] || { en: 'Stance', vi: 'Phe', icon: '📌', tone: 'general' };
                        const items = grouped[key] || [];
                        return `
                        <div class="essay-station-stance-card is-${meta.tone}">
                            <div class="essay-station-stance-head">
                                <span class="essay-station-stance-title">${meta.icon} ${escapeHtml(guidedText(meta.en, meta.vi))}</span>
                                <span class="essay-station-stance-count">${items.length} ${guidedText('ideas', 'ý')}</span>
                            </div>
                            <ul class="essay-station-bullet-list">
                                ${items.map(item => {
                                    const rawText = cleanArgumentClaim(preferTranslated(item.en, guidedLanguage === 'vi' ? item.vi : ''));
                                    return `<li>${escapeHtml(rawText)}</li>`;
                                }).join('')}
                            </ul>
                        </div>`;
                    }).join('')}
                </div>
            </div>`;
        } else {
            paneContent = `
            <div class="essay-station-pane is-traps">
                <div class="essay-station-traps-cards">
                    ${(traps || []).slice(0, 3).map((item, idx) => `
                    <div class="essay-station-trap-card">
                        <div class="essay-station-trap-head">
                            <span class="essay-station-trap-badge">⚠️ ${guidedText('Tip', 'Lưu ý')} #${idx + 1}</span>
                            <h4 class="essay-station-trap-title">${escapeHtml(guidedText(item.titleEn, item.titleVi) || '')}</h4>
                        </div>
                        <div class="essay-station-trap-body">
                            <div class="essay-station-trap-row is-wrong">
                                <span class="essay-station-trap-tag">🛑 ${guidedText('Avoid', 'Nên tránh')}</span>
                                <p>${escapeHtml(guidedText(item.mistakeEn || item.en, item.mistakeVi || item.vi))}</p>
                            </div>
                            ${item.fixVi || item.fixEn ? `
                            <div class="essay-station-trap-row is-right">
                                <span class="essay-station-trap-tag">💡 ${guidedText('Do this', 'Nên làm')}</span>
                                <p>${escapeHtml(guidedText(item.fixEn, item.fixVi))}</p>
                            </div>` : ''}
                        </div>
                    </div>`).join('')}
                </div>
                ${mcqHtml}
                ${gapFillHtml}
            </div>`;
        }

        return `
        <div class="essay-guided-stations-layout">
            ${navHtml}
            ${paneContent}
        </div>`;
    }

    function renderStep1Hud(segments, promptText, essayTypeInfo, grouped, stanceLabels, traps, reqs, mcqHtml, gapFillHtml) {
        const blueprint = essayTypeInfo.blueprint || [];
        
        const ribbonHtml = `
        <div class="essay-hud-ribbon-box">
            <span class="essay-hud-section-label">1. ${guidedText('4-Step Flow', 'Mạch bài viết 4 đoạn')}</span>
            <div class="essay-hud-ribbon">
                ${blueprint.map((b, idx) => `
                <div class="essay-hud-ribbon-step">
                    <span class="essay-hud-step-num">${idx + 1}</span>
                    <div class="essay-hud-step-text">
                        <strong class="essay-hud-step-part">${escapeHtml(guidedText(b.partEn, b.partVi))}</strong>
                        <span class="essay-hud-step-role">${escapeHtml(guidedText(b.roleEn, b.roleVi))}</span>
                    </div>
                </div>
                ${idx < blueprint.length - 1 ? '<span class="essay-hud-ribbon-arrow">→</span>' : ''}
                `).join('')}
            </div>
        </div>`;

        const dontItems = [];
        const doItems = [];
        (traps || []).slice(0, 3).forEach(t => {
            if (t.mistakeVi || t.mistakeEn) dontItems.push(guidedText(t.mistakeEn, t.mistakeVi));
            if (t.fixVi || t.fixEn) doItems.push(guidedText(t.fixEn, t.fixVi));
        });

        const doDontHtml = `
        <div class="essay-hud-dodont-box">
            <span class="essay-hud-section-label">2. ${guidedText('Do vs Don\'t Guidelines', 'Cách viết nên làm & nên tránh')}</span>
            <div class="essay-hud-dodont-grid">
                <div class="essay-hud-dodont-col is-dont">
                    <div class="essay-hud-dodont-head">
                        <span class="essay-hud-dodont-icon">✕</span>
                        <h4 class="essay-hud-dodont-title">${guidedText('WHAT TO AVOID', 'NÊN TRÁNH ✕')}</h4>
                    </div>
                    <ul class="essay-hud-dodont-list">
                        ${dontItems.map(txt => `<li><span class="bullet">•</span><span>${escapeHtml(txt)}</span></li>`).join('')}
                    </ul>
                </div>
                <div class="essay-hud-dodont-col is-do">
                    <div class="essay-hud-dodont-head">
                        <span class="essay-hud-dodont-icon">✓</span>
                        <h4 class="essay-hud-dodont-title">${guidedText('WHAT TO DO', 'NÊN LÀM ✓')}</h4>
                    </div>
                    <ul class="essay-hud-dodont-list">
                        ${doItems.map(txt => `<li><span class="bullet">•</span><span>${escapeHtml(txt)}</span></li>`).join('')}
                    </ul>
                </div>
            </div>
        </div>`;

        return `
        <div class="essay-guided-hud-layout">
            ${ribbonHtml}
            ${doDontHtml}
            ${mcqHtml}
            ${gapFillHtml}
        </div>`;
    }

    function renderStep1List(segmentsHtml, essayTypeCardHtml, reqsHtml, trapsHtml, anglesHtml, mcqHtml, gapFillHtml) {
        return `
        <div class="essay-guided-list-layout">
            <div class="essay-step1-part essay-step1-part-1">
                <div class="essay-step1-part-header">
                    <span class="essay-step1-part-pill">Part 1</span>
                    <h3 class="essay-step1-part-title">${guidedText('Understanding Parts of the Question', 'Hiểu nhanh các vế của đề bài')}</h3>
                </div>
                ${segmentsHtml}
            </div>
            <div class="essay-step1-part essay-step1-part-2">
                <div class="essay-step1-part-header">
                    <span class="essay-step1-part-pill">Part 2</span>
                    <h3 class="essay-step1-part-title">${guidedText('Type of Essay & Strategic Blueprint', 'Dạng bài & Khung dàn ý 4 đoạn')}</h3>
                </div>
                ${essayTypeCardHtml}
                ${reqsHtml}
                ${trapsHtml}
                ${anglesHtml}
                ${mcqHtml}
                ${gapFillHtml}
            </div>
        </div>`;
    }

    function getAvailablePointsForPlan(plan, levelData, common) {
        if (!plan) return [];
        const variantId = plan.variantId || plan.id || plan.stance || 'default';
        const points = [];
        const seenTexts = new Set();

        const addPoint = (id, en, vi, explEn = '', explVi = '', titleEn = '', titleVi = '', writingCue = '') => {
            const cleanEn = cleanArgumentClaim(en);
            if (!cleanEn || seenTexts.has(cleanEn.toLowerCase())) return;
            seenTexts.add(cleanEn.toLowerCase());
            points.push({
                id,
                en: cleanEn,
                vi: String(vi || '').trim(),
                explEn: String(explEn || '').trim(),
                explVi: String(explVi || '').trim(),
                titleEn: String(titleEn || '').trim(),
                titleVi: String(titleVi || '').trim(),
                writingCue: String(writingCue || '').trim()
            });
        };

        // 1. Candidate points array (if explicitly defined in the plan, e.g. 6 options per side)
        if (Array.isArray(plan.candidatePoints) && plan.candidatePoints.length > 0) {
            plan.candidatePoints.forEach((pt, idx) => {
                const titleEn = pt.titleEn || '';
                const titleVi = pt.titleVi || '';
                const rawEn = pt.pointEn || pt.en || '';
                const rawVi = pt.pointVi || pt.vi || '';
                const en = titleEn && rawEn && !rawEn.startsWith(titleEn) ? `${titleEn}: ${rawEn}` : (rawEn || titleEn);
                const vi = titleVi && rawVi && !rawVi.startsWith(titleVi) ? `${titleVi}: ${rawVi}` : (rawVi || titleVi);
                const explVi = pt.strategyVi || pt.explVi || '';
                const explEn = pt.explEn || '';
                const writingCue = pt.writingCue || '';
                const pointId = pt.id || `${variantId}_cand_${idx}`;
                addPoint(pointId, en, vi, explEn, explVi, titleEn, titleVi, writingCue);
            });
        }

        // 2. Default point1 and point2
        if (plan.point1) {
            addPoint(`${variantId}_p1`, plan.point1, 'Luận điểm trọng tâm 1');
        }
        if (plan.point2) {
            addPoint(`${variantId}_p2`, plan.point2, 'Luận điểm trọng tâm 2');
        }

        // 3. Angles matching this stance
        const angles = common?.angles || [];
        const targetStance = String(plan.stance || plan.variantId || plan.id || '').trim().toLowerCase();
        angles.forEach((angle, idx) => {
            const angleStance = String(angle.sourceVariantId || '').trim().toLowerCase();
            const isMatch = angleStance === targetStance ||
                            angleStance === String(plan.variantId || '').trim().toLowerCase() ||
                            angleStance === String(plan.id || '').trim().toLowerCase() ||
                            (targetStance.includes('agree') && angleStance.includes('pos')) ||
                            (targetStance.includes('disagree') && angleStance.includes('neg')) ||
                            targetStance === 'all' || !targetStance;
            if (isMatch) {
                const angleEn = String(angle.en || '').trim();
                let angleVi = String(angle.vi || '').trim();
                if (angleVi.startsWith('Góc nhìn: ')) angleVi = '';
                addPoint(
                    `${variantId}_ang_${idx}`,
                    angleEn,
                    angleVi,
                    'You can select this perspective as one of your two main body arguments.',
                    'Bạn có thể chọn góc nhìn này làm một trong hai luận điểm chính để phát triển bài viết.'
                );
            }
        });

        return points;
    }

    function getSelectedPointsForPlan(plan, levelData, common) {
        const available = getAvailablePointsForPlan(plan, levelData, common);
        if (available.length === 0) return [cleanArgumentClaim(plan?.point1 || ''), cleanArgumentClaim(plan?.point2 || '')];

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
            cleanArgumentClaim(selectedObjects[0]?.en || plan?.point1 || ''),
            cleanArgumentClaim(selectedObjects[1]?.en || plan?.point2 || '')
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

        const activePlan = plans.find(p => (p.variantId || p.id || p.stance) === guidedSelectedVariantId) || plans[0];
        if (!guidedSelectedVariantId && activePlan) {
            guidedSelectedVariantId = activePlan.variantId || activePlan.id || activePlan.stance;
        }

        const availablePoints = getAvailablePointsForPlan(activePlan, levelData, common);
        const validIds = new Set(availablePoints.map(p => p.id));
        if (!guidedSelectedPointIds.some(id => validIds.has(id)) || guidedSelectedPointIds.length < 2) {
            guidedSelectedPointIds = availablePoints.slice(0, 2).map(p => p.id);
        }

        // Stance selector tabs
        const stanceSelectorHtml = `
        <div class="essay-guided-subhead">
            <span>${guidedText('Your stance', 'Lập trường của bạn')}</span>${guidedHelpBtn('stance')}
        </div>
        <div class="essay-guided-stance-selector" role="group" aria-label="${guidedText('Select essay stance', 'Chọn lập trường bài viết')}">
            ${plans.map(plan => {
                const planId = plan.variantId || plan.id || plan.stance || 'default';
                const isSelected = guidedSelectedVariantId === planId || guidedSelectedVariantId === plan.id || guidedSelectedVariantId === plan.stance;
                const isDisagree = String(plan.stance || planId).toLowerCase().includes('disagree') || String(plan.stance || planId).toLowerCase().includes('against');
                
                let labelText = '';
                if (guidedLanguage === 'vi') {
                    labelText = plan.stanceLabelVi || plan.labelVi || plan.label;
                    if (!labelText) {
                        if (plan.stance === 'agree') labelText = 'Đồng ý (Agree)';
                        else if (plan.stance === 'disagree') labelText = 'Phản đối (Disagree)';
                        else labelText = plan.stanceLabelEn || plan.labelEn || plan.stance || planId;
                    }
                } else {
                    labelText = plan.stanceLabelEn || plan.labelEn || plan.label;
                    if (!labelText) {
                        if (plan.stance === 'agree') labelText = 'Agree';
                        else if (plan.stance === 'disagree') labelText = 'Disagree';
                        else labelText = plan.stanceLabelVi || plan.labelVi || plan.stance || planId;
                    }
                }

                return `<button type="button" class="essay-guided-stance-tab${isSelected ? ' is-active' : ''}${isDisagree ? ' is-against' : ' is-for'}" data-guided-action="select-variant" data-variant-id="${escapeHtml(planId)}" aria-pressed="${isSelected ? 'true' : 'false'}">
                    <span class="essay-guided-stance-tab-label">${escapeHtml(labelText)}</span>
                    <span class="essay-guided-stance-tab-state">${isSelected ? guidedText('Selected', 'Đang chọn') : guidedText('Choose', 'Chọn')}</span>
                </button>`;
            }).join('')}
        </div>`;

        let activePlanLabel = '';
        if (guidedLanguage === 'vi') {
            activePlanLabel = activePlan.stanceLabelVi || activePlan.labelVi || activePlan.label || (activePlan.stance === 'agree' ? 'Đồng ý (Agree)' : 'Phản đối (Disagree)') || activePlan.stance || 'Lập trường';
        } else {
            activePlanLabel = activePlan.stanceLabelEn || activePlan.labelEn || activePlan.label || (activePlan.stance === 'agree' ? 'Agree' : 'Disagree') || activePlan.stance || 'Stance';
        }

        let pointsPickerHtml = '';
        if (guidedViewMode === 'mindmap') {
            const body1PointId = guidedSelectedPointIds[0];
            const body2PointId = guidedSelectedPointIds[1];
            const body1Selected = availablePoints.find(p => p.id === body1PointId);
            const body2Selected = availablePoints.find(p => p.id === body2PointId);

            pointsPickerHtml = `
            <div class="essay-brainstorm-mindmap-wrap">
                <div class="essay-mindmap-canvas" id="essay-brainstorm-mindmap-canvas">
                    <svg class="essay-mindmap-svg" id="essay-brainstorm-mindmap-svg" aria-hidden="true"></svg>

                    <!-- Active Stance Focal Hub -->
                    <div class="essay-brainstorm-stance-core" id="mm-stance-core">
                        <div class="essay-brainstorm-stance-icon">⚖️</div>
                        <div class="essay-brainstorm-stance-badge">${guidedText('Chosen Stance Direction', 'Lập trường đang chọn')}</div>
                        <strong class="essay-brainstorm-stance-title">${escapeHtml(activePlanLabel)}</strong>
                        <div class="essay-brainstorm-stance-sub">${guidedText('Branching into 2 Body Paragraphs • Click idea bubbles below to assign', 'Phân nhánh 2 đoạn thân bài • Bấm chọn 2 bóng ý tưởng bên dưới')}</div>
                    </div>

                    <!-- Paragraph Target Stems (Body 1 & Body 2) -->
                    <div class="essay-brainstorm-stems-row">
                        <div class="essay-brainstorm-stem stem-body1" id="mm-stem-body1">
                            <div class="essay-brainstorm-stem-badge">${guidedText('Body Paragraph 1 Stem', 'Nhánh Thân bài 1')}</div>
                            <div class="essay-brainstorm-stem-point">
                                ${body1Selected ? `
                                    <strong class="essay-brainstorm-stem-point-title">1. ${escapeHtml(body1Selected.titleEn || body1Selected.en)}</strong>
                                    ${guidedLanguage === 'vi' && body1Selected.titleVi ? `<span class="essay-brainstorm-stem-point-vi">${escapeHtml(body1Selected.titleVi || body1Selected.vi)}</span>` : ''}
                                ` : `
                                    <span class="essay-brainstorm-stem-placeholder">${guidedText('Click an idea bubble below to assign to Body 1', 'Bấm một bóng ý tưởng bên dưới để gán cho Thân bài 1')}</span>
                                `}
                            </div>
                        </div>
                        <div class="essay-brainstorm-stem stem-body2" id="mm-stem-body2">
                            <div class="essay-brainstorm-stem-badge">${guidedText('Body Paragraph 2 Stem', 'Nhánh Thân bài 2')}</div>
                            <div class="essay-brainstorm-stem-point">
                                ${body2Selected ? `
                                    <strong class="essay-brainstorm-stem-point-title">2. ${escapeHtml(body2Selected.titleEn || body2Selected.en)}</strong>
                                    ${guidedLanguage === 'vi' && body2Selected.titleVi ? `<span class="essay-brainstorm-stem-point-vi">${escapeHtml(body2Selected.titleVi || body2Selected.vi)}</span>` : ''}
                                ` : `
                                    <span class="essay-brainstorm-stem-placeholder">${guidedText('Click an idea bubble below to assign to Body 2', 'Bấm một bóng ý tưởng bên dưới để gán cho Thân bài 2')}</span>
                                `}
                            </div>
                        </div>
                    </div>

                    <!-- Floating Idea Bubbles Field -->
                    <div class="essay-brainstorm-bubbles-grid">
                        ${availablePoints.map((point, pIdx) => {
                            const isSelected = guidedSelectedPointIds.includes(point.id);
                            const slotIdx = isSelected ? guidedSelectedPointIds.indexOf(point.id) + 1 : null;
                            const slotName = slotIdx ? `Body ${slotIdx}` : '';
                            const isExplOpen = guidedExpandedPointExplId === point.id;
                            return `
                            <div class="essay-idea-bubble bubble-cand-${pIdx + 1}${isSelected ? ' is-picked' : ''}" id="mm-idea-bubble-${pIdx + 1}" data-guided-action="select-point" data-point-id="${escapeHtml(point.id)}" role="button" tabindex="0">
                                <div class="essay-idea-bubble-top">
                                    <span class="essay-idea-bubble-badge${isSelected ? ' is-active' : ''}">${isSelected ? `✓ ${guidedText('Assigned to', 'Đã gán cho')} ${slotName}` : guidedText('Idea Bubble', 'Bóng ý tưởng') + ' #' + (pIdx + 1)}</span>
                                    <button type="button" class="essay-idea-bubble-help-btn${isExplOpen ? ' is-open' : ''}" data-guided-action="toggle-point-expl" data-point-id="${escapeHtml(point.id)}" title="${guidedText('Show explanation & strategy', 'Xem giải thích chi tiết và gợi ý viết')}">
                                        <span aria-hidden="true">?</span>
                                    </button>
                                </div>
                                <div class="essay-idea-bubble-body">
                                    <strong class="essay-idea-bubble-title">${escapeHtml(point.en)}</strong>
                                    ${guidedLanguage === 'vi' && point.vi && point.vi !== point.en ? `<span class="essay-idea-bubble-vi">${escapeHtml(point.vi)}</span>` : ''}
                                </div>
                                <div class="essay-idea-bubble-foot">
                                    <span class="essay-idea-bubble-state">${isSelected ? guidedText('✓ Pinned to outline', '✓ Đã ghim vào dàn ý') : guidedText('+ Click to pin to outline', '+ Bấm để ghim vào dàn ý')}</span>
                                </div>
                                ${isExplOpen ? `
                                <div class="essay-idea-bubble-callout">
                                    <div class="essay-idea-callout-sec">
                                        <span class="essay-idea-callout-tag">${guidedText('Development Strategy:', 'Cách triển khai luận điểm:')}</span>
                                        <p>${escapeHtml(guidedLanguage === 'vi' ? (point.explVi || 'Giải thích nguyên nhân và đưa ra dẫn chứng thực tế.') : (point.explEn || 'Develop this argument with causal explanation and evidence.'))}</p>
                                    </div>
                                    ${(point.writingCue || point.explEn) ? `
                                    <div class="essay-idea-callout-sec cue-box">
                                        <span class="essay-idea-callout-tag">${guidedText('Writing Cue & Topic Sentence:', 'Gợi ý câu chủ đề & Dẫn chứng:')}</span>
                                        <p>${escapeHtml(point.writingCue || point.explEn)}</p>
                                    </div>` : ''}
                                </div>` : ''}
                            </div>`;
                        }).join('')}
                    </div>
                </div>
            </div>`;
        } else {
            // Points Picker with <?> Vietnamese explanation button (Compact List Mode)
            const selectedCount = guidedSelectedPointIds.length;
            pointsPickerHtml = `
            <div class="essay-guided-points-container essay-list-mode">
                <div class="essay-guided-points-head">
                    <div>
                        <h4>${guidedText('Choose 2 main points', 'Chọn 2 luận điểm')}${guidedHelpBtn('main-points')}</h4>
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
                        const hasViSubtitle = guidedLanguage === 'vi' && point.vi && point.vi !== point.en && !point.vi.startsWith('Góc nhìn: ' + point.en);
                        return `
                        <div class="essay-guided-point-card${isSelected ? ' is-selected' : ''}" data-guided-action="select-point" data-point-id="${escapeHtml(point.id)}" role="button" tabindex="0">
                            <div class="essay-guided-point-main">
                                <div class="essay-guided-point-select-wrap">
                                    <span class="essay-guided-point-checkbox" aria-hidden="true">${isSelected ? `✓ ${selectedIdx}` : ''}</span>
                                    <div class="essay-guided-point-text">
                                        <strong class="essay-guided-point-title">${escapeHtml(point.en)}</strong>
                                        ${hasViSubtitle ? `<span class="essay-guided-point-vi">${escapeHtml(point.vi)}</span>` : ''}
                                    </div>
                                </div>
                                <button type="button" class="essay-guided-info-btn${isExplOpen ? ' is-open' : ''}" data-guided-action="toggle-point-expl" data-point-id="${escapeHtml(point.id)}" title="${guidedText('Show explanation & strategy', 'Xem giải thích chi tiết và cách triển khai bằng tiếng Việt')}" aria-label="${guidedText('Show explanation', 'Xem giải thích')}">
                                    <span aria-hidden="true">?</span>
                                </button>
                            </div>
                            ${isExplOpen ? `
                            <div class="essay-guided-point-expl">
                                <div class="essay-guided-point-expl-head">
                                    <strong>${guidedText('Argument Strategy & Real-World Elaboration', 'Hướng dẫn triển khai chi tiết & Gợi ý câu viết')}</strong>
                                </div>
                                <div class="essay-guided-point-expl-body">
                                    <div class="essay-guided-point-expl-sec">
                                        <span class="essay-guided-point-expl-tag">${guidedText('Development Strategy:', 'Cách triển khai luận điểm:')}</span>
                                        <p class="essay-guided-point-expl-desc">${escapeHtml(guidedLanguage === 'vi' ? (point.explVi || 'Luận điểm này làm rõ lập trường của bạn. Hãy giải thích nguyên nhân và đưa ra dẫn chứng thực tế.') : (point.explEn || 'Develop this argument with a clear causal explanation and supporting real-world evidence.'))}</p>
                                    </div>
                                    ${(point.writingCue || point.explEn) ? `
                                    <div class="essay-guided-point-expl-sec essay-guided-point-expl-cue-box">
                                        <span class="essay-guided-point-expl-tag">${guidedText('Writing Cue & Topic Sentence:', 'Gợi ý câu chủ đề & Dẫn chứng:')}</span>
                                        <p class="essay-guided-point-expl-cue">${escapeHtml(point.writingCue || point.explEn)}</p>
                                    </div>` : ''}
                                </div>
                            </div>` : ''}
                        </div>`;
                    }).join('')}
                </div>
            </div>`;
        }

        return `<section class="essay-guided-section">
            ${guidedSectionHead(section, guidedText('Pick one stance and choose 2 main arguments for your body paragraphs.', 'Xác định quan điểm rõ ràng và chọn 2 luận điểm chính bạn muốn bảo vệ.'))}
            ${renderGuidedViewToggle()}
            ${stanceSelectorHtml}
            ${pointsPickerHtml}
        </section>`;
    }

    function getVocabContextExample(item, currentEntry, guidedPack, level) {
        const term = String(item.term || '').trim().toLowerCase();
        const currentLevel = String(level || guidedLevel || 'b2').toLowerCase();
        if (item.example) {
            return {
                en: item.example,
                vi: item.exampleVi || item.viGloss || ''
            };
        }

        const dictionary = {
            'memorization': {
                a2_b1: {
                    en: 'Students easily forget lessons when they rely only on memorization.',
                    vi: 'Học sinh dễ dàng quên bài khi các em chỉ dựa vào việc học thuộc lòng.'
                },
                b2: {
                    en: 'Excessive memorization discourages students from developing genuine critical thinking skills.',
                    vi: 'Việc học thuộc lòng quá mức làm mất đi cơ hội phát triển tư duy phản biện của học sinh.'
                },
                c1: {
                    en: 'Excessive memorization can diminish a student’s innate curiosity and enthusiasm for autonomous discovery.',
                    vi: 'Học thuộc lòng thái quá có thể làm suy giảm tính tò mò bẩm sinh và niềm say mê tự khám phá của người học.'
                }
            },
            'rote learning': {
                a2_b1: {
                    en: 'Rote learning makes school boring and stops children from thinking creatively.',
                    vi: 'Học vẹt làm cho trường học nhàm chán và ngăn trẻ suy nghĩ sáng tạo.'
                },
                b2: {
                    en: 'Over-reliance on rote learning fails to prepare students for real-world problem solving.',
                    vi: 'Quá dựa dẫm vào học vẹt khiến học sinh không được chuẩn bị tốt cho việc giải quyết vấn đề thực tế.'
                },
                c1: {
                    en: 'Institutional reliance on rote learning constrains independent analytical capabilities in schoolchildren.',
                    vi: 'Sự phụ thuộc của hệ thống giáo dục vào phương pháp học vẹt kìm hãm năng lực phân tích độc lập ở học sinh.'
                }
            },
            'curricula': {
                a2_b1: {
                    en: 'Schools should update their curricula to teach useful daily life skills.',
                    vi: 'Các trường học nên cập nhật chương trình giảng dạy để dạy các kỹ năng sống hữu ích.'
                },
                b2: {
                    en: 'Modern school curricula need to balance academic theory with practical hands-on projects.',
                    vi: 'Chương trình giảng dạy hiện đại cần cân bằng giữa lý thuyết học thuật với các dự án thực hành.'
                },
                c1: {
                    en: 'Rigidly standardized curricula impede educators from catering to diverse pedagogical needs.',
                    vi: 'Các chương trình đào tạo chuẩn hóa cứng nhắc cản trở giáo viên đáp ứng nhu cầu sư phạm đa dạng.'
                }
            },
            'curriculum': {
                a2_b1: {
                    en: 'Schools should update their curriculum to teach useful daily life skills.',
                    vi: 'Các trường học nên cập nhật chương trình giảng dạy để dạy các kỹ năng sống hữu ích.'
                },
                b2: {
                    en: 'A flexible school curriculum allows students to explore their personal strengths.',
                    vi: 'Một chương trình học linh hoạt cho phép học sinh khám phá những thế mạnh cá nhân.'
                },
                c1: {
                    en: 'A holistic school curriculum harmonizes fundamental theory with experiential inquiry.',
                    vi: 'Chương trình giáo dục toàn diện cần kết hợp hài hòa giữa lý thuyết nền tảng và nghiên cứu trải nghiệm.'
                }
            },
            'motivation': {
                a2_b1: {
                    en: 'Fun and practical lessons give students strong motivation to study hard.',
                    vi: 'Các bài học thực tế và thú vị mang lại cho học sinh động lực mạnh mẽ để học tập.'
                },
                b2: {
                    en: 'Intrinsic motivation is essential for students to sustain academic progress over time.',
                    vi: 'Động lực tự thân là yếu tố thiết yếu giúp học sinh duy trì sự tiến bộ trong học tập lâu dài.'
                },
                c1: {
                    en: 'Standardized grading frequently undermines intrinsic academic motivation and intellectual curiosity.',
                    vi: 'Việc chấm điểm chuẩn hóa thường làm suy giảm động lực học tập tự thân và trí tò mò trí tuệ.'
                }
            },
            'natural development': {
                a2_b1: {
                    en: 'Creative play and free reading are very important for a child’s natural development.',
                    vi: 'Vui chơi sáng tạo và đọc sách tự do rất quan trọng cho sự phát triển tự nhiên của trẻ.'
                },
                b2: {
                    en: 'Rigid school routines can hinder the natural development of independent thinking.',
                    vi: 'Thời khóa biểu trường học cứng nhắc có thể cản trở sự phát triển tự nhiên của tư duy độc lập.'
                },
                c1: {
                    en: 'Holistic cognitive growth requires an environment that nurtures spontaneous, natural development.',
                    vi: 'Sự phát triển nhận thức toàn diện đòi hỏi một môi trường nuôi dưỡng sự phát triển tự nhiên, tự phát.'
                }
            },
            'limit': {
                a2_b1: {
                    en: 'Strict classroom rules can limit students’ imagination and curiosity.',
                    vi: 'Các nội quy lớp học khắt khe có thể giới hạn trí tưởng tượng và sự tò mò của học sinh.'
                },
                b2: {
                    en: 'Focusing only on test scores may limit students from exploring different career paths.',
                    vi: 'Chỉ chú trọng điểm số có thể giới hạn học sinh trong việc khám phá các định hướng nghề nghiệp khác nhau.'
                },
                c1: {
                    en: 'Conformist academic benchmarks inevitably limit unconventional, innovative thinking.',
                    vi: 'Các tiêu chuẩn học thuật mang tính rập khuôn chắc chắn sẽ giới hạn tư duy đổi mới, đột phá.'
                }
            },
            'system': {
                a2_b1: {
                    en: 'A good school system should help every child learn at their own pace.',
                    vi: 'Một hệ thống trường học tốt nên giúp mỗi đứa trẻ học theo nhịp độ riêng của mình.'
                },
                b2: {
                    en: 'Educational systems must adapt quickly to changes in technology and workplace needs.',
                    vi: 'Hệ thống giáo dục cần thích ứng nhanh với những thay đổi công nghệ và nhu cầu làm việc.'
                },
                c1: {
                    en: 'An inflexible educational system risks alienating learners with divergent cognitive talents.',
                    vi: 'Một hệ thống giáo dục thiếu linh hoạt có nguy cơ cô lập những người học có năng khiếu nhận thức khác biệt.'
                }
            },
            'test': {
                a2_b1: {
                    en: 'Regular class tests help teachers see what students need to practice more.',
                    vi: 'Các bài kiểm tra lớp định kỳ giúp giáo viên biết học sinh cần luyện tập thêm phần nào.'
                },
                b2: {
                    en: 'Standardized tests often fail to reflect a student’s overall competence and creativity.',
                    vi: 'Các kỳ thi chuẩn hóa thường không phản ánh được năng lực toàn diện và óc sáng tạo của học sinh.'
                },
                c1: {
                    en: 'Over-reliance on standardized testing reduces multifaceted learning into quantifiable metrics.',
                    vi: 'Quá lệ thuộc vào khảo thí chuẩn hóa biến quá trình học đa diện thành những chỉ số định lượng máy móc.'
                }
            },
            'learn': {
                a2_b1: {
                    en: 'Children learn best when they can practice and share ideas with friends.',
                    vi: 'Trẻ học tốt nhất khi được thực hành và chia sẻ ý kiến với bạn bè.'
                },
                b2: {
                    en: 'Students learn more deeply when teachers encourage active discussion rather than passive listening.',
                    vi: 'Học sinh tiếp thu sâu hơn khi giáo viên khuyến khích thảo luận chủ động thay vì lắng nghe thụ động.'
                },
                c1: {
                    en: 'Learners assimilate complex concepts most effectively when engaging in autonomous inquiry.',
                    vi: 'Người học tiếp thu các khái niệm phức tạp hiệu quả nhất khi tham gia vào quá trình nghiên cứu độc lập.'
                }
            },
            'passion': {
                a2_b1: {
                    en: 'When students find a true passion, they enjoy studying every single day.',
                    vi: 'Khi học sinh tìm thấy niềm đam mê thực sự, các em sẽ yêu thích việc học mỗi ngày.'
                },
                b2: {
                    en: 'Encouraging personal passion helps young learners choose fulfilling career trajectories.',
                    vi: 'Khuyến khích đam mê cá nhân giúp người học trẻ chọn lựa con đường sự nghiệp thỏa mãn.'
                },
                c1: {
                    en: 'Cultivating authentic intellectual passion is far more consequential than enforcing mechanical compliance.',
                    vi: 'Bồi dưỡng niềm đam mê học thuật thực sự mang lại kết quả lớn hơn nhiều so với việc áp đặt tuân thủ máy móc.'
                }
            },
            'facts': {
                a2_b1: {
                    en: 'Memorizing facts is helpful, but knowing how to use them is more important.',
                    vi: 'Ghi nhớ sự thật là hữu ích, nhưng biết cách áp dụng chúng thì quan trọng hơn.'
                },
                b2: {
                    en: 'Absorbing isolated facts does not equate to genuine intellectual comprehension.',
                    vi: 'Tiếp thu các sự kiện rời rạc không đồng nghĩa với sự hiểu biết trí tuệ thực chất.'
                },
                c1: {
                    en: 'Merely cataloging empirical facts does not foster nuanced analytical acumen.',
                    vi: 'Chỉ đơn thuần tổng hợp dữ kiện thực nghiệm sẽ không thể phát triển tư duy phân tích sâu sắc.'
                }
            }
        };

        const found = dictionary[term];
        if (found) {
            const tier = found[currentLevel] || found.b2 || found.a2_b1;
            return {
                en: tier.en,
                vi: tier.vi
            };
        }

        const topic = currentEntry?.verifiedPrimaryTopic || 'this subject';
        if (currentLevel === 'a2_b1') {
            return {
                en: `Understanding ${item.term} helps students discuss ${topic.toLowerCase()} clearly.`,
                vi: `Hiểu rõ từ "${item.term}" giúp học sinh diễn đạt về chủ đề ${topic.toLowerCase()} rõ ràng hơn.`
            };
        } else if (currentLevel === 'c1') {
            return {
                en: `Integrating ${item.term} into your discourse substantiates formal academic arguments concerning ${topic.toLowerCase()}.`,
                vi: `Việc vận dụng "${item.term}" củng cố tính học thuật sâu sắc cho lập luận về ${topic.toLowerCase()}.`
            };
        }
        return {
            en: `Using ${item.term} properly strengthens your analysis of ${topic.toLowerCase()}.`,
            vi: `Sử dụng "${item.term}" chính xác giúp củng cố lập luận phân tích về ${topic.toLowerCase()}.`
        };
    }

    function getCollocationInfo(item, currentEntry, level) {
        const rawTerm = String(item.term || '').trim().toLowerCase();

        const dictionary = {
            'have limitations': {
                vi: 'Có những hạn chế nhất định',
                exampleEn: 'Standardized exams have limitations because they cannot measure real-world creativity.',
                exampleVi: 'Các kỳ thi chuẩn hóa có những hạn chế nhất định vì không thể đo lường óc sáng tạo thực tế.'
            },
            'impose limitations': {
                vi: 'Áp đặt những rào cản / giới hạn',
                exampleEn: 'Strict national guidelines impose limitations on innovative teaching methods.',
                exampleVi: 'Các hướng dẫn quốc gia khắt khe áp đặt những rào cản lên các phương pháp giảng dạy đổi mới.'
            },
            'limited access': {
                vi: 'Sự hạn chế trong tiếp cận',
                exampleEn: 'Students in remote areas face limited access to modern digital learning tools.',
                exampleVi: 'Học sinh ở vùng xa gặp phải sự hạn chế trong tiếp cận các công cụ học tập kỹ thuật số hiện đại.'
            },
            'limited capacity': {
                vi: 'Quy mô hoặc năng lực bị hạn chế',
                exampleEn: 'Schools with limited capacity cannot provide personalized tutoring for every struggling student.',
                exampleVi: 'Các trường học có quy mô hạn chế không thể tổ chức kèm cặp riêng cho từng học sinh gặp khó khăn.'
            },
            'active participant': {
                vi: 'Người tham gia chủ động / tích cực',
                exampleEn: 'Students who become active participants in discussions understand key concepts much faster.',
                exampleVi: 'Những học sinh trở thành người tham gia chủ động trong thảo luận sẽ hiểu khái niệm nhanh hơn nhiều.'
            },
            'active participation': {
                vi: 'Sự tham gia tích cực / chủ động',
                exampleEn: 'Active participation in group projects fosters leadership and communication skills.',
                exampleVi: 'Sự tham gia tích cực vào các dự án nhóm bồi dưỡng kỹ năng lãnh đạo và giao tiếp.'
            },
            'binary system': {
                vi: 'Hệ thống đánh giá nhị phân (đúng/sai cứng nhắc)',
                exampleEn: 'Evaluating intelligence through a binary system ignores diverse creative talents.',
                exampleVi: 'Đánh giá trí tuệ qua một hệ thống nhị phân cứng nhắc sẽ bỏ qua những tài năng sáng tạo đa dạng.'
            },
            'critical thinking': {
                vi: 'Tư duy phản biện',
                exampleEn: 'Modern education should foster critical thinking rather than simple mechanical recall.',
                exampleVi: 'Giáo dục hiện đại nên bồi dưỡng tư duy phản biện thay vì chỉ ghi nhớ máy móc.'
            },
            'rote learning': {
                vi: 'Phương pháp học vẹt',
                exampleEn: 'Rote learning fails to cultivate independent problem-solving skills in schoolchildren.',
                exampleVi: 'Học vẹt không thể rèn luyện kỹ năng giải quyết vấn đề độc lập cho học sinh.'
            },
            'curriculum design': {
                vi: 'Thiết kế chương trình đào tạo',
                exampleEn: 'Modern curriculum design should integrate practical technology with core theoretical subjects.',
                exampleVi: 'Thiết kế chương trình hiện đại cần kết hợp công nghệ thực tiễn với các môn lý thuyết cốt lõi.'
            },
            'academic achievement': {
                vi: 'Thành tích học thuật',
                exampleEn: 'Standardized test scores alone should not define an individual’s overall academic achievement.',
                exampleVi: 'Điểm số bài thi chuẩn hóa không nên là thước đo duy nhất cho toàn bộ thành tích học tập của một cá nhân.'
            },
            'higher education': {
                vi: 'Giáo dục bậc cao (đại học & sau đại học)',
                exampleEn: 'Higher education institutions play an indispensable role in promoting social and career mobility.',
                exampleVi: 'Các cơ sở giáo dục đại học đóng vai trò không thể thiếu trong việc thúc đẩy thăng tiến xã hội và nghề nghiệp.'
            },
            'technological advancement': {
                vi: 'Sự tiến bộ vượt bậc của công nghệ',
                exampleEn: 'Technological advancement has dramatically expanded access to self-directed learning materials.',
                exampleVi: 'Tiến bộ công nghệ đã mở rộng đáng kể khả năng tiếp cận tài liệu tự học cho học sinh.'
            }
        };

        const entry = dictionary[rawTerm];
        if (entry) {
            return {
                viCandidate: entry.vi,
                meaning: guidedLanguage === 'vi' ? entry.vi : (item.enGloss || item.en || entry.vi),
                example: entry.exampleEn,
                exampleVi: entry.exampleVi
            };
        }

        const topic = currentEntry?.verifiedPrimaryTopic || 'the essay prompt';
        return {
            viCandidate: item.viGloss || item.vi || '',
            meaning: guidedLanguage === 'vi' ? `Cụm từ học thuật về "${item.term}"` : `Academic collocation for "${item.term}"`,
            example: `Employing "${item.term}" clarifies your academic reasoning regarding ${topic.toLowerCase()}.`,
            exampleVi: `Sử dụng "${item.term}" giúp làm sáng tỏ lập luận học thuật của bạn về ${topic.toLowerCase()}.`
        };
    }

    function getVocabEssayTip(item, currentEntry, activePlan) {
        const term = String(item.term || '').trim().toLowerCase();
        const tips = {
            'memorization': 'Dùng từ này khi viết Thân bài 1 để nhấn mạnh: việc chỉ học thuộc lòng máy móc sẽ khiến học sinh mau quên và mất đi tư duy phản biện thực tế.',
            'rote learning': 'Dùng trong câu nêu nguyên nhân: lối học vẹt kìm hãm sự sáng tạo tự nhiên và khiến học sinh lúng túng khi gặp các bài toán giải quyết vấn đề mới.',
            'curricula': 'Dùng khi đưa ra giải pháp: các trường học cần đổi mới chương trình đào tạo linh hoạt hơn để kích thích học sinh tự do khám phá.',
            'curriculum': 'Dùng khi đưa ra giải pháp: chương trình học hiện đại cần cân bằng giữa lý thuyết trên lớp và kỹ năng thực tiễn ngoài đời sống.',
            'motivation': 'Dùng khi phân tích tâm lý người học: động lực tự thân (intrinsic motivation) là yếu tố quyết định giúp duy trì sự tiến bộ lâu dài.',
            'natural development': 'Dùng để bảo vệ quan điểm tự do học tập: việc gò ép khuôn mẫu quá sớm sẽ cản trở sự phát triển năng khiếu tự nhiên của người học.',
            'critical thinking': 'Dùng làm luận điểm cốt lõi: giáo dục thế kỷ 21 không chỉ dừng lại ở truyền thụ kiến thức mà phải rèn luyện năng lực phản biện.',
            'autonomous': 'Dùng khi đề cao việc tự học: khả năng học tập tự chủ giúp học sinh chủ động theo đuổi đam mê mà không phụ thuộc vào thi cử.',
            'collaborative skills': 'Dùng ở Thân bài 2 khi bảo vệ trường học: môi trường lớp học giúp rèn luyện kỹ năng làm việc nhóm và giao tiếp liên cá nhân.',
            'foundational': 'Dùng để khẳng định vai trò trường học: cung cấp kiến thức nền tảng vững chắc trước khi người học có thể tự do sáng tạo.',
            'technological advancement': 'Dùng khi phân tích bối cảnh: công nghệ ngày nay giúp việc tiếp cận kho tàng tri thức trở nên thuận tiện và đa dạng hơn.',
            'academic achievement': 'Dùng để phản biện: điểm số trên lớp không phải là thước đo duy nhất cho năng lực toàn diện của một cá nhân.'
        };
        if (tips[term]) return tips[term];
        const gloss = item.viGloss || item.vi || item.meaningVi || '';
        if (gloss) {
            return `Dùng từ này trong câu phân tích hoặc dẫn chứng về "${gloss}". Hãy kết hợp với các từ nối như "Specifically" hoặc "For instance" để câu văn tự nhiên và thuyết phục.`;
        }
        return 'Dùng từ này trong câu chủ đề hoặc câu giải thích để nâng cao vốn từ vựng học thuật cho bài viết.';
    }

    function getColloEssayTip(item, currentEntry, activePlan) {
        const term = String(item.term || '').trim().toLowerCase();
        const tips = {
            'have limitations': 'Dùng để mở đầu phản biện: nêu rõ rằng phương pháp hoặc chính sách hiện tại vẫn còn những điểm hạn chế nhất định.',
            'impose limitations': 'Dùng khi phân tích nguyên nhân: các quy định khắt khe đang vô tình áp đặt rào cản lên sự tự do đổi mới.',
            'limited access': 'Dùng trong câu dẫn chứng thực tế: học sinh ở vùng sâu vùng xa còn gặp nhiều bất lợi trong việc tiếp cận công nghệ.',
            'limited capacity': 'Dùng để nêu lý do khách quan: các cơ sở giáo dục có nguồn lực giới hạn nên khó có thể đáp ứng riêng cho từng cá nhân.',
            'active participant': 'Dùng để miêu tả người học tích cực: chủ động tham gia thảo luận và đóng góp ý kiến thay vì chỉ ngồi nghe thụ động.',
            'active participation': 'Dùng làm luận điểm: sự tham gia tích cực vào các hoạt động tập thể giúp bồi dưỡng kỹ năng lãnh đạo.',
            'binary system': 'Dùng để phê phán cách đánh giá cứng nhắc: chỉ phân loại đúng/sai nhị phân sẽ bỏ sót nhiều tiềm năng sáng tạo.',
            'critical thinking': 'Dùng khi khẳng định mục tiêu giáo dục: rèn luyện tư duy phản biện để biết tự đặt câu hỏi và giải quyết vấn đề.',
            'curriculum design': 'Dùng khi đưa ra khuyến nghị: thiết kế chương trình học cần cập nhật liên tục theo nhu cầu thực tế của xã hội.',
            'academic achievement': 'Dùng để lập luận cân bằng: thành tích học tập tốt là cần thiết nhưng không nên đánh đổi sức khỏe tinh thần.',
            'higher education': 'Dùng để nhấn mạnh tầm quan trọng của bậc đại học: đóng vai trò bàn đạp thúc đẩy sự phát triển nghề nghiệp.',
            'technological advancement': 'Dùng để phân tích xu hướng: sự phát triển công nghệ mở ra cơ hội học tập suốt đời cho mọi người.'
        };
        if (tips[term]) return tips[term];
        return 'Dùng cụm từ này để diễn đạt tự nhiên theo chuẩn văn phong học thuật, giúp nâng điểm tiêu chí Từ vựng (Lexical Resource).';
    }

    function generateNaturalConclusion(plan, currentPrompt, thesisText, level) {
        const stance = String(plan?.stance || plan?.variantId || 'agree').toLowerCase();
        const isDisagree = stance.includes('disagree');
        const promptText = String(currentPrompt || currentEntry?.prompt || '').trim();

        if (promptText.includes('interferes with my learning') || promptText.includes('Einstein')) {
            if (level === 'a2_b1') {
                return isDisagree
                    ? "In conclusion, while schools have some flaws, formal education is still essential for students to build useful life skills."
                    : "In conclusion, schools should give students more freedom to explore their own interests and enjoy true learning.";
            } else if (level === 'c1') {
                return isDisagree
                    ? "In conclusion, despite the inevitable constraints of standardized curricula, institutional education remains an indispensable foundation for intellectual rigor and social cohesion."
                    : "In conclusion, educational institutions must urgently evolve to cultivate self-directed intellectual passion rather than perpetuating rigid pedagogical compliance.";
            } else {
                return isDisagree
                    ? "In conclusion, having analyzed both perspectives, I maintain that reforming curriculum flexibility is far more beneficial than abandoning structured formal schooling."
                    : "In conclusion, having evaluated both sides, I firmly reaffirm that education systems must adapt to nurture students' intrinsic curiosity and creative freedom.";
            }
        }

        const topic = (currentEntry?.verifiedPrimaryTopic || 'this subject').toLowerCase();
        if (isDisagree) {
            return `In conclusion, having examined both viewpoints, I reaffirm that ${topic} brings vital advantages that warrant continued support and refinement.`;
        }
        return `In conclusion, while acknowledging alternative concerns, I maintain that addressing the key challenges of ${topic} is crucial for sustainable progress.`;
    }

    /**
     * Highlights target terms in example sentences for both English and Vietnamese.
     * Supports markdown **term**, inflections (plurals, -ed, -ing), and phrase matching.
     */
    function highlightSentenceTerms(sentence, targetTerm, lang = 'en', fallbackCandidate = '') {
        if (!sentence) return '';
        let text = String(sentence).trim();

        // 1. If text already has markdown **bold**, convert to highlighted strong tag
        if (text.includes('**')) {
            return text.replace(/\*\*(.*?)\*\*/g, '<strong class="essay-term-hl">$1</strong>');
        }

        // 2. Identify candidate terms to highlight
        const candidates = [];
        if (lang === 'en') {
            if (targetTerm) {
                const cleanTerm = targetTerm.trim();
                candidates.push(cleanTerm);
                if (cleanTerm.endsWith('s') && cleanTerm.length > 3) candidates.push(cleanTerm.slice(0, -1));
            }
        } else {
            // Vietnamese candidate: extract clean phrases from fallbackCandidate and targetTerm
            if (fallbackCandidate) {
                const clean = fallbackCandidate.replace(/[[\]().,;:]/g, ' ').trim();
                const rawParts = clean.split(/\s+(?:hoặc|hay|tức|nghĩa là|\/)\s+/i);
                rawParts.forEach(p => {
                    const t = p.trim();
                    if (t.length >= 2 && !candidates.includes(t)) candidates.push(t);
                });
            }
            if (targetTerm && !candidates.includes(targetTerm.trim())) {
                candidates.push(targetTerm.trim());
            }
        }

        // Sort candidates by descending length so longer multi-word phrases match first
        candidates.sort((a, b) => b.length - a.length);

        // 3. Search and wrap candidates safely without regex lastIndex bugs
        for (const cand of candidates) {
            if (!cand || cand.length < 2) continue;
            const escaped = cand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const pattern = lang === 'en'
                ? new RegExp('\\b(' + escaped + '(?:s|es|ed|ing)?)\\b', 'gi')
                : new RegExp('(' + escaped + ')', 'gi');

            if (pattern.test(text)) {
                pattern.lastIndex = 0;
                return text.replace(pattern, '<strong class="essay-term-hl">$1</strong>');
            }
        }

        return escapeHtml(text);
    }

    function renderGuidedLanguage(levelData) {
        const section = GUIDED_SECTIONS[2];
        const kit = levelData.languageKit || {};
        const common = guidedPack.common || {};
        const activePlan = (levelData.plans || []).find(p => (p.variantId || p.id || p.stance) === guidedSelectedVariantId) || levelData.plans?.[0] || {};
        const [body1Point, body2Point] = getSelectedPointsForPlan(activePlan, levelData, common);

        // 1. Core Vocabulary with Level-Adapted Examples & <?> Vietnamese Toggle (Flat toolbelt tiles, zero box-in-box)
        const vocabulary = kit.vocabulary || [];
        const vocabHtml = vocabulary.length ? `<div class="essay-guided-toolbelt-grid">${vocabulary.map(item => {
            const selected = guidedSelectedTargetIds.includes(item.term);
            const full = !selected && guidedSelectedTargetIds.length >= GUIDED_MAX_TARGETS;
            const vocabInfo = getVocabContextExample(item, currentEntry, guidedPack, guidedLevel);
            const isViOpen = guidedExpandedVocabViIds.has(item.term);
            const enExampleHtml = highlightSentenceTerms(vocabInfo.en, item.term, 'en');
            const viExampleHtml = highlightSentenceTerms(vocabInfo.vi, item.term, 'vi', item.viGloss || item.vi || item.meaningVi || '');
            const writingTip = getVocabEssayTip(item, currentEntry, activePlan);
            return `<div class="essay-guided-toolbelt-card${selected ? ' is-selected' : ''}">
                <div class="essay-guided-toolbelt-head">
                    <button type="button" class="essay-guided-toolbelt-select-btn${selected ? ' is-selected' : ''}" data-guided-action="target" data-target-id="${escapeHtml(item.term)}" title="${selected ? guidedText('Remove target', 'Bỏ chọn mục tiêu') : guidedText('Select target', 'Chọn làm mục tiêu')}">
                        <span class="essay-guided-toolbelt-checkbox">${selected ? '✓' : '+'}</span>
                        <strong class="essay-guided-toolbelt-term">${escapeHtml(item.term)}</strong>
                        <span class="essay-guided-toolbelt-gloss">${escapeHtml(bilingual(item, 'enGloss', 'viGloss'))}</span>
                    </button>
                    <button type="button" class="essay-guided-toolbelt-tip-toggle${isViOpen ? ' is-open' : ''}" data-guided-action="toggle-vocab-vi" data-term="${escapeHtml(item.term)}" title="${isViOpen ? guidedText('Hide writing tip', 'Thu gọn mẹo viết') : guidedText('Show writing tip', 'Xem mẹo triển khai vào bài')}">
                        <span>?</span>
                    </button>
                </div>
                <div class="essay-guided-toolbelt-bilingual">
                    <p class="essay-guided-toolbelt-en">&ldquo;${enExampleHtml}&rdquo;</p>
                    <p class="essay-guided-toolbelt-vi">&ldquo;${viExampleHtml}&rdquo;</p>
                </div>
                ${isViOpen ? `
                <div class="essay-guided-toolbelt-tip-box">
                    <span class="essay-guided-toolbelt-tip-label">💡 ${guidedText('Writing Strategy in Vietnamese', 'Mẹo triển khai vào bài viết')}</span>
                    <p class="essay-guided-toolbelt-tip-text">${escapeHtml(writingTip)}</p>
                </div>` : ''}
            </div>`;
        }).join('')}</div>` : '';

        // 2. Collocations with Contextual Usage & <?> Vietnamese Toggle (Flat toolbelt tiles, zero box-in-box)
        const collocations = kit.collocations || [];
        const colloHtml = collocations.length ? `<div class="essay-guided-toolbelt-grid">${collocations.map(item => {
            const info = getCollocationInfo(item, currentEntry, guidedLevel);
            const isColloViOpen = guidedExpandedColloViIds.has(item.term);
            const colloEnHtml = highlightSentenceTerms(info.example, item.term, 'en');
            const colloViHtml = highlightSentenceTerms(info.exampleVi, item.term, 'vi', info.viCandidate || info.meaning || item.viGloss || '');
            const writingTip = getColloEssayTip(item, currentEntry, activePlan);
            return `<div class="essay-guided-toolbelt-card">
                <div class="essay-guided-toolbelt-head">
                    <div class="essay-guided-toolbelt-title-wrap">
                        <strong class="essay-guided-toolbelt-term">${escapeHtml(item.term)}</strong>
                        <span class="essay-guided-toolbelt-meaning">${escapeHtml(info.meaning)}</span>
                    </div>
                    <button type="button" class="essay-guided-toolbelt-tip-toggle${isColloViOpen ? ' is-open' : ''}" data-guided-action="toggle-collo-vi" data-term="${escapeHtml(item.term)}" title="${isColloViOpen ? guidedText('Hide writing tip', 'Thu gọn mẹo viết') : guidedText('Show writing tip', 'Xem mẹo triển khai vào bài')}">
                        <span>?</span>
                    </button>
                </div>
                <div class="essay-guided-toolbelt-bilingual">
                    <p class="essay-guided-toolbelt-en">&ldquo;${colloEnHtml}&rdquo;</p>
                    <p class="essay-guided-toolbelt-vi">&ldquo;${colloViHtml}&rdquo;</p>
                </div>
                ${isColloViOpen ? `
                <div class="essay-guided-toolbelt-tip-box">
                    <span class="essay-guided-toolbelt-tip-label">💡 ${guidedText('Writing Strategy in Vietnamese', 'Mẹo triển khai vào bài viết')}</span>
                    <p class="essay-guided-toolbelt-tip-text">${escapeHtml(writingTip)}</p>
                </div>` : ''}
            </div>`;
        }).join('')}</div>` : '';

        // 3. Sentence Pattern Workbench with Visual Formula Tokens
        const isDisagree = String(activePlan.stance || activePlan.variantId).toLowerCase().includes('disagree');
        const promptText = String(currentEntry?.prompt || '').toLowerCase();
        let appliedPattern = '';
        if (promptText.includes('einstein') || promptText.includes('interferes with my learning')) {
            appliedPattern = isDisagree
                ? 'Although autonomous self-study encourages personal passion [X], I believe structured school education is indispensable [Y] because it cultivates disciplined teamwork and essential foundational knowledge [Z].'
                : 'Although formal schooling provides essential literacy skills [X], I believe it often limits natural learning [Y] because rigid curricula discourage creative curiosity [Z].';
        } else {
            appliedPattern = isDisagree
                ? 'Although alternative viewpoints offer interesting perspectives [X], I believe this approach is superior [Y] because empirical evidence strongly supports its efficacy [Z].'
                : 'Although some critics highlight initial difficulties [X], I believe this policy is vital [Y] because it delivers substantial long-term benefits for society [Z].';
        }

        let grammarPatterns = [];
        if (Array.isArray(kit.grammar) && kit.grammar.length > 0) {
            grammarPatterns = kit.grammar;
        } else {
            grammarPatterns = [{
                name: 'Concession & Contrast',
                pattern: 'Although [Concession X], I believe [Your Stance Y] because [Reason Z].',
                applied: appliedPattern,
                purpose: 'Use this pattern in your Introduction (Sentence 2) to state a balanced thesis, or in Body 2 to concede a counter-argument before defending your stance.'
            }];
        }

        const grammarHtml = `
        <div class="essay-guided-pattern-workbench">
            <div class="essay-guided-pattern-purpose">
                <strong>${guidedText('Advanced Academic Sentence Models', 'Các mẫu câu phức chuẩn học thuật')}</strong>
                <span>${guidedText(
                    'Using diverse complex sentence structures earns high Grammatical Range scores. Choose from the models below:',
                    'Sử dụng đa dạng cấu trúc câu phức giúp đạt điểm tối đa tiêu chí Ngữ pháp. Tham khảo công thức bên dưới:'
                )}</span>
            </div>
            <div class="essay-guided-pattern-list">
                ${grammarPatterns.map((g, gIdx) => `
                <div class="essay-guided-pattern-card">
                    <div class="essay-guided-pattern-card-head">
                        <span class="essay-guided-pattern-badge">${escapeHtml(g.name || `Model ${gIdx + 1}`)}</span>
                        ${g.purpose ? `<p class="essay-guided-pattern-purpose-note">${escapeHtml(g.purpose)}</p>` : ''}
                    </div>
                    <div class="essay-guided-formula-tokens">
                        <span class="essay-guided-formula-token is-concession">[Mệnh đề nhượng bộ X]</span>
                        <span class="essay-guided-formula-plus">+</span>
                        <span class="essay-guided-formula-token is-stance">[Lập trường của bạn Y]</span>
                        <span class="essay-guided-formula-plus">+</span>
                        <span class="essay-guided-formula-token is-reason">[Lý do cốt lõi Z]</span>
                    </div>
                    <div class="essay-guided-pattern-row">
                        <span class="essay-guided-pattern-sublabel">${guidedText('Applied example', 'Ví dụ áp dụng')}</span>
                        <p class="essay-guided-pattern-sentence">&ldquo;${escapeHtml(g.applied || appliedPattern)}&rdquo;</p>
                    </div>
                    ${(guidedLanguage === 'vi' && (g.patternVi || g.vi)) ? `
                    <div class="essay-guided-pattern-row">
                        <span class="essay-guided-pattern-sublabel">${guidedText('Translation', 'Bản dịch ví dụ')}</span>
                        <p class="essay-guided-pattern-sentence essay-guided-pattern-vi">&ldquo;${escapeHtml(g.patternVi || g.vi)}&rdquo;</p>
                    </div>` : ''}
                </div>`).join('')}
            </div>
        </div>`;

        // 4. Cohesive Linking Words (4 Writing Stages)
        const linkingStages = [
            {
                badgeEn: 'Stage 1 · Body 1 Opener',
                badgeVi: 'Chặng 1 · Mở Thân bài 1',
                words: ['To begin with', 'First and foremost', 'Principally', 'In the first place'],
                purposeEn: 'Introduce your first selected main point in Body 1.',
                purposeVi: 'Mở đầu Thân bài 1 và giới thiệu Luận điểm 1 đã chọn.',
                example: `To begin with, ${asClause(body1Point || 'rigid educational frameworks frequently suppress curiosity')}.`
            },
            {
                badgeEn: 'Stage 2 · Elaboration & Mechanism',
                badgeVi: 'Chặng 2 · Phân tích lý do & Cơ chế',
                words: ['Specifically', 'In other words', 'More precisely', 'To elucidate'],
                purposeEn: 'Explain why or how this phenomenon occurs in detail.',
                purposeVi: 'Giải thích chi tiết tại sao hiện tượng hoặc vấn đề này lại xảy ra.',
                example: 'Specifically, when schools enforce rote memorization, students lose intrinsic motivation to explore independently.'
            },
            {
                badgeEn: 'Stage 3 · Body 2 Transition',
                badgeVi: 'Chặng 3 · Chuyển tiếp Thân bài 2',
                words: ['Furthermore', 'In addition', 'Equally important', 'On the other hand', 'Conversely'],
                purposeEn: 'Transition smoothly to your second main argument in Body 2.',
                purposeVi: 'Chuyển ý mượt mà sang Luận điểm 2 ở Thân bài 2.',
                example: `Furthermore, ${asClause(body2Point || 'structured schooling provides essential collaborative skills')}.`
            },
            {
                badgeEn: 'Stage 4 · Conclusion Synthesis',
                badgeVi: 'Chặng 4 · Khẳng định lại ở Kết bài',
                words: ['In conclusion', 'To recapitulate', 'Ultimately', 'In the final analysis'],
                purposeEn: 'Reaffirm your position with finality in the conclusion.',
                purposeVi: 'Tóm lược và khẳng định lại lập trường ở đoạn kết bài.',
                example: 'In conclusion, having examined both viewpoints, I firmly maintain that a balanced educational approach is vital.'
            }
        ];

        const cohesionHtml = `
        <div class="essay-guided-cohesion-stages">
            <p class="essay-guided-cohesion-intro">
                ${guidedText(
                    'Transitions organized by the 4 essay writing stages, tied directly to your selected points.',
                    'Hệ thống từ nối theo 4 chặng viết bài, gắn liền với các luận điểm bạn đã chọn.'
                )}
            </p>
            <div class="essay-guided-cohesion-cards">
                ${linkingStages.map(stage => `
                <div class="essay-guided-cohesion-card">
                    <div class="essay-guided-cohesion-head">
                        <span class="essay-guided-cohesion-stage-badge">${escapeHtml(guidedText(stage.badgeEn, stage.badgeVi))}</span>
                        <div class="essay-guided-cohesion-words">
                            ${stage.words.map(w => `<span class="essay-guided-cohesion-pill">${escapeHtml(w)}</span>`).join('')}
                        </div>
                    </div>
                    <p class="essay-guided-cohesion-purpose">${escapeHtml(guidedText(stage.purposeEn, stage.purposeVi))}</p>
                    <div class="essay-guided-cohesion-demo">
                        <span class="essay-guided-cohesion-demo-label">${guidedText('In action', 'Câu mẫu')}</span>
                        <p class="essay-guided-cohesion-demo-text">&ldquo;${escapeHtml(stage.example)}&rdquo;</p>
                    </div>
                </div>`).join('')}
            </div>
        </div>`;

        const used = guidedSelectedTargetIds.length;
        const toolbeltNavHtml = `
        <div class="essay-guided-toolbelt-nav" role="tablist" aria-label="${guidedText('Language kit categories', 'Danh mục đồ nghề')}">
            <button type="button" class="essay-guided-toolbelt-tab${guidedLanguageKitTab === 'all' ? ' is-active' : ''}" data-guided-action="set-language-kit-tab" data-tab="all">
                ${guidedText('All Tools', 'Tất cả')}
            </button>
            <button type="button" class="essay-guided-toolbelt-tab${guidedLanguageKitTab === 'vocab' ? ' is-active' : ''}" data-guided-action="set-language-kit-tab" data-tab="vocab">
                🎯 ${guidedText('Vocabulary', 'Từ vựng cốt lõi')} (${vocabulary.length})
            </button>
            <button type="button" class="essay-guided-toolbelt-tab${guidedLanguageKitTab === 'collo' ? ' is-active' : ''}" data-guided-action="set-language-kit-tab" data-tab="collo">
                ✨ ${guidedText('Collocations', 'Cụm từ ghi điểm')} (${collocations.length})
            </button>
            <button type="button" class="essay-guided-toolbelt-tab${guidedLanguageKitTab === 'grammar' ? ' is-active' : ''}" data-guided-action="set-language-kit-tab" data-tab="grammar">
                📐 ${guidedText('Sentence Models', 'Mẫu câu chuẩn')} (${grammarPatterns.length})
            </button>
            <button type="button" class="essay-guided-toolbelt-tab${guidedLanguageKitTab === 'cohesion' ? ' is-active' : ''}" data-guided-action="set-language-kit-tab" data-tab="cohesion">
                🔗 ${guidedText('Roadmap', 'Từ nối 4 chặng')} (${linkingStages.length})
            </button>
        </div>`;

        const commitMeterHtml = `
        <div class="essay-guided-meter-bar${used >= GUIDED_MAX_TARGETS ? ' is-full' : ''}">
            <div class="essay-guided-meter-info">
                <span>🎯 ${guidedText('Target words to use in your essay:', 'Từ khóa bạn chọn dùng vào bài viết:')}</span>
                <strong>${used}/${GUIDED_MAX_TARGETS}</strong>
            </div>
            <div class="essay-guided-meter-track">
                <div class="essay-guided-meter-fill" style="width: ${Math.min(100, (used / GUIDED_MAX_TARGETS) * 100)}%;"></div>
            </div>
        </div>`;

        let sectionsHtml = '';
        if (guidedLanguageKitTab === 'all' || guidedLanguageKitTab === 'vocab') {
            sectionsHtml += `<div class="essay-guided-toolbelt-section">
                <div class="essay-guided-toolbelt-sec-head">
                    <strong>🎯 ${guidedText('Core Vocabulary', 'Từ vựng cốt lõi theo trình độ')}</strong>
                    <span>${guidedText('Select up to 3 words to commit to using in your essay draft.', 'Chọn tối đa 3 từ tâm đắc để cam kết sử dụng vào bài viết.')}</span>
                </div>
                ${vocabHtml}
            </div>`;
        }
        if (guidedLanguageKitTab === 'all' || guidedLanguageKitTab === 'collo') {
            sectionsHtml += `<div class="essay-guided-toolbelt-section">
                <div class="essay-guided-toolbelt-sec-head">
                    <strong>✨ ${guidedText('Academic Collocations', 'Cụm từ ghi điểm học thuật')}</strong>
                    <span>${guidedText('Natural combinations to impress examiners and boost Lexical Resource.', 'Các cụm từ đi liền tự nhiên giúp bài viết uyển chuyển và đúng chuẩn.')}</span>
                </div>
                ${colloHtml}
            </div>`;
        }
        if (guidedLanguageKitTab === 'all' || guidedLanguageKitTab === 'grammar') {
            sectionsHtml += `<div class="essay-guided-toolbelt-section">
                <div class="essay-guided-toolbelt-sec-head">
                    <strong>📐 ${guidedText('Complex Sentence Models', 'Mẫu câu phức ghi điểm')}</strong>
                </div>
                ${grammarHtml}
            </div>`;
        }
        if (guidedLanguageKitTab === 'all' || guidedLanguageKitTab === 'cohesion') {
            sectionsHtml += `<div class="essay-guided-toolbelt-section">
                <div class="essay-guided-toolbelt-sec-head">
                    <strong>🔗 ${guidedText('Cohesive Linking Roadmap', 'Từ nối theo 4 chặng bài viết')}</strong>
                </div>
                ${cohesionHtml}
            </div>`;
        }

        return `<section class="essay-guided-section">
            ${guidedSectionHead(section, guidedText('Essential vocabulary, collocations, sentence patterns, and linking words for your essay.', 'Túi đồ nghề từ vựng, cụm từ ghi điểm, mẫu câu chuẩn và từ nối 4 chặng cho bài viết của bạn.'))}
            ${commitMeterHtml}
            ${toolbeltNavHtml}
            ${sectionsHtml}
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
        const naturalThesis = generateNaturalThesis(plan, currentEntry?.prompt, guidedLevel);
        const naturalConclusion = generateNaturalConclusion(plan, currentEntry?.prompt, naturalThesis, guidedLevel);

        const nodes = [
            {
                stepNum: 1,
                tagEn: 'Introduction',
                tagVi: '1. Mở bài',
                labelEn: 'Thesis Statement',
                labelVi: 'Câu luận đề (Thesis)',
                text: naturalThesis,
                tipEn: 'Paraphrase the prompt in Sentence 1, then state your clear thesis in Sentence 2 to set up your essay direction.',
                tipVi: 'Diễn đạt lại đề bài ở câu 1, sau đó nêu rõ lập trường của bạn ở câu 2 để định hướng toàn bài viết.'
            },
            {
                stepNum: 2,
                tagEn: 'Body Paragraph 1',
                tagVi: '2. Thân bài 1',
                labelEn: 'Main Point 1',
                labelVi: 'Luận điểm then chốt 1',
                text: cleanArgumentClaim(body1Text) || 'Rigid curriculum suppresses natural creativity.',
                tipEn: 'State your main topic clearly, explain the underlying cause/mechanism, and support it with a concrete real-world example.',
                tipVi: 'Nêu câu chủ đề rõ ràng, phân tích sâu nguyên nhân hoặc cơ chế, và minh họa bằng ví dụ thực tế thuyết phục.'
            },
            {
                stepNum: 3,
                tagEn: 'Body Paragraph 2',
                tagVi: '3. Thân bài 2',
                labelEn: 'Main Point 2',
                labelVi: 'Luận điểm then chốt 2',
                text: cleanArgumentClaim(body2Text) || 'Structured schooling builds essential collaborative habits.',
                tipEn: 'Use a smooth transition (Furthermore / On the other hand) to present your second argument or address the opposing viewpoint.',
                tipVi: 'Dùng từ nối chuyển ý mượt mà để phân tích khía cạnh bổ trợ hoặc phản biện quan điểm đối lập.'
            },
            {
                stepNum: 4,
                tagEn: 'Conclusion',
                tagVi: '4. Kết bài',
                labelEn: 'Synthesis & Final Thought',
                labelVi: 'Khẳng định lập trường & Thông điệp',
                text: naturalConclusion,
                tipEn: 'Reiterate your core thesis without repeating verbatim, summarize both main points, and leave a forward-looking thought.',
                tipVi: 'Khẳng định lại lập trường mà không lặp lại nguyên văn, tóm lược ngắn gọn 2 luận điểm và đưa ra thông điệp mở rộng.'
            }
        ];

        const copyText = nodes.map(n => `${guidedText(n.tagEn, n.tagVi)} - ${guidedText(n.labelEn, n.labelVi)}:\n${n.text}`).join('\n\n');

        const nodesHtml = nodes.map((node, idx) => {
            const isExpanded = guidedPlanExpandedNode === idx;
            return `
            <div class="essay-plan-timeline-card${isExpanded ? ' is-expanded' : ''}">
                <div class="essay-plan-node-header">
                    <div class="essay-plan-badge-group">
                        <span class="essay-plan-step-num">${node.stepNum}</span>
                        <span class="essay-plan-step-tag">${escapeHtml(guidedText(node.tagEn, node.tagVi))}</span>
                        <strong class="essay-plan-step-title">${escapeHtml(guidedText(node.labelEn, node.labelVi))}</strong>
                    </div>
                    <button type="button" class="essay-plan-tip-toggle${isExpanded ? ' is-open' : ''}" data-guided-action="toggle-plan-node" data-node-index="${idx}" title="${isExpanded ? guidedText('Hide tip', 'Thu gọn mẹo') : guidedText('Show writing strategy', 'Xem bí kíp viết đoạn')}">
                        <span>${isExpanded ? '▲ ' + guidedText('Hide tip', 'Thu gọn') : '💡 ' + guidedText('Writing strategy', 'Bí kíp viết')}</span>
                    </button>
                </div>
                <p class="essay-plan-node-text">${escapeHtml(node.text)}</p>
                ${isExpanded ? `
                <div class="essay-plan-strategy-tip">
                    <span class="essay-plan-strategy-label">💡 ${guidedText('How to write this paragraph:', 'Cách phát triển đoạn này:')}</span>
                    <p class="essay-plan-strategy-content">${escapeHtml(guidedText(node.tipEn, node.tipVi))}</p>
                </div>` : ''}
            </div>
            ${idx < nodes.length - 1 ? `
            <div class="essay-plan-timeline-connector">
                <span class="essay-plan-connector-line"></span>
                <span class="essay-plan-connector-arrow">↓</span>
            </div>` : ''}`;
        }).join('');

        return `<section class="essay-guided-section">
            ${guidedSectionHead(section, guidedText('Visual 4-paragraph outline connected to your chosen stance and ideas.', 'Bản đồ dàn ý 4 chặng kết nối trực tiếp với lập trường và ý tưởng bạn đã chọn.'))}
            <div class="essay-plan-timeline">
                ${nodesHtml}
            </div>
            <div class="essay-guided-inline-actions">
                <button type="button" class="essay-guided-ghost-btn" data-guided-action="copy" data-copy-text="${escapeHtml(copyText)}">📋 ${guidedText('Copy outline', 'Sao chép toàn bộ dàn ý')}</button>
                <span class="essay-guided-source-note">${guidedText('Stance:', 'Lập trường:')} <strong>${escapeHtml(plan.title || plan.stance || 'Balanced')}</strong></span>
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

    function getAuthenticModelSentence(sentence, currentEntry, activePlan, index) {
        const raw = String(sentence.modelSentence || '').trim();
        const isPlaceholder = !raw || /this prompt concerns/i.test(raw) || /using this prompt effectively/i.test(raw);
        if (!isPlaceholder) return raw;

        const promptText = String(currentEntry?.prompt || guidedPack?.prompt || '').toLowerCase();
        const isEinstein = promptText.includes('einstein') || promptText.includes('interferes with my learning');
        const isDisagree = String(activePlan?.stance || activePlan?.variantId || '').toLowerCase().includes('disagree');
        const pName = String(sentence.paragraph || '').toLowerCase();
        const idx = sentence.index || index || 1;

        if (isEinstein) {
            if (pName.includes('intro')) {
                if (idx === 1) return "Albert Einstein famously observed that rigid schooling often obstructed his natural passion for genuine learning.";
                if (idx === 2) return isDisagree
                    ? "In my view, I disagree with this assertion because formal education remains indispensable for developing foundational literacy and essential social skills."
                    : "In my view, I strongly agree with Einstein's view because standardized curricula frequently stifle creative curiosity.";
                return "This essay will examine both viewpoints and present a balanced evaluation of institutional education.";
            } else if (pName.includes('body 1') || (pName.includes('body') && !pName.includes('2'))) {
                if (idx === 1) return "To begin with, standardized schooling frequently forces students to focus on rote memorization rather than creative problem-solving.";
                if (idx === 2) return "Specifically, rigid testing systems discourage learners from pursuing independent intellectual exploration.";
                if (idx === 3) return "For instance, students who only memorize facts for exams quickly forget the practical meaning behind those lessons.";
                return "Consequently, excessive academic rigidity can diminish a student's intrinsic motivation to learn.";
            } else if (pName.includes('body 2')) {
                if (idx === 1) return "Furthermore, structured education provides vital collaborative skills and disciplined study habits that self-study cannot replicate.";
                if (idx === 2) return "That is to say, classroom environments cultivate teamwork, communication, and interpersonal resilience.";
                if (idx === 3) return "In contemporary workplaces, the capacity to collaborate effectively is just as critical as individual brilliance.";
                return "Hence, balanced schooling remains an essential pillar for holistic personal and professional development.";
            } else if (pName.includes('conclu')) {
                if (idx === 1) return "In conclusion, while formal schooling has limitations, reforming curriculum design is far more effective than abandoning institutional learning.";
                return "Looking forward, educational systems should foster autonomous curiosity while preserving foundational academic rigor.";
            }
        }

        const topic = (currentEntry?.verifiedPrimaryTopic || guidedPack?.common?.topics?.[0] || 'this subject').toLowerCase();
        if (pName.includes('intro')) {
            if (idx === 1) return `The impact of ${topic} on contemporary society has become a central subject of widespread academic discussion.`;
            if (idx === 2) return isDisagree
                ? `In my view, I disagree with the premise because ${topic} entails fundamental complexities that require cautious management.`
                : `In my view, I strongly agree with this perspective because ${topic} provides substantial practical benefits for development.`;
            return `This essay will examine key dimensions of ${topic} and present a coherent academic evaluation.`;
        } else if (pName.includes('body 1') || (pName.includes('body') && !pName.includes('2'))) {
            if (idx === 1) return `First and foremost, a primary consideration regarding ${topic} is its direct contribution to efficiency and human capability.`;
            if (idx === 2) return `Specifically, structured frameworks ensure that key principles of ${topic} are systematically understood.`;
            if (idx === 3) return `For instance, real-world case studies consistently illustrate the advantages of proactive involvement in ${topic}.`;
            return `Consequently, this evidence confirms the profound significance of ${topic} in daily life.`;
        } else if (pName.includes('body 2')) {
            if (idx === 1) return `Furthermore, another vital dimension is the long-term sustainability and social impact of ${topic}.`;
            if (idx === 2) return `That is to say, holistic development requires continuous adaptation to challenges posed by ${topic}.`;
            if (idx === 3) return `A pertinent example can be observed in organizations that successfully integrate ${topic} into their core operations.`;
            return `Hence, embracing balanced strategies regarding ${topic} ensures lasting success.`;
        }
        if (idx === 1) return `In conclusion, having analyzed both theoretical concepts and practical implications, I reaffirm that ${topic} warrants balanced implementation.`;
        return `Looking forward, policymakers and individuals should work together to maximize the positive potential of ${topic}.`;
    }

    function getUserAssembledSentence(sentence, sentenceId, cleanPreview = false) {
        const rawFrame = String(sentence.frame || '').trim();
        if (!rawFrame) return getAuthenticModelSentence(sentence, currentEntry, null, sentence.index);
        const parts = rawFrame.split(/_{2,}/);
        if (parts.length <= 1) return rawFrame;

        const userSlots = guidedFilledSentenceSlots[sentenceId] || {};
        let result = '';
        parts.forEach((part, idx) => {
            result += part;
            if (idx < parts.length - 1) {
                const val = (userSlots[idx] || '').trim();
                if (val) {
                    result += ` ${val} `;
                } else if (cleanPreview) {
                    result += ' [your idea] ';
                } else {
                    result += ' _____ ';
                }
            }
        });
        return result.replace(/\s+/g, ' ').trim();
    }

    function renderInteractiveFillableFrame(sentence, sentenceId) {
        const rawFrame = String(sentence.frame || '').trim();
        if (!rawFrame) return '';
        const parts = rawFrame.split(/_{2,}/);
        const userSlots = guidedFilledSentenceSlots[sentenceId] || {};

        let inputsHtml = '<div class="essay-guided-frame-inputs">';
        let previewHtml = '';

        parts.forEach((part, idx) => {
            inputsHtml += `<span class="essay-guided-frame-static-text">${escapeHtml(part)}</span>`;
            previewHtml += escapeHtml(part);
            if (idx < parts.length - 1) {
                const userVal = userSlots[idx] || '';
                const placeholder = idx === 0 ? guidedText('Type your main idea...', 'Gõ ý tưởng của bạn...') : guidedText('Add reason / detail...', 'Gõ lý do / chi tiết...');
                inputsHtml += `<input type="text" class="essay-guided-slot-input" data-guided-sentence-id="${escapeHtml(sentenceId)}" data-slot-idx="${idx}" value="${escapeHtml(userVal)}" placeholder="${placeholder}" aria-label="Blank ${idx + 1}" />`;
                previewHtml += userVal ? ` <b class="essay-guided-filled-slot">${escapeHtml(userVal)}</b> ` : ' <span class="essay-guided-empty-slot">_____</span> ';
            }
        });
        inputsHtml += '</div>';

        const assembledRaw = getUserAssembledSentence(sentence, sentenceId);

        return `
        <div class="essay-guided-frame is-interactive">
            <div class="essay-guided-frame-head">
                <span class="essay-guided-reveal-label">✏️ ${guidedText('Assemble your sentence', 'Ghép câu của bạn')}${guidedHelpBtn('frame')}</span>
                <button type="button" class="essay-guided-ghost-btn" data-guided-action="copy" data-copy-text="${escapeHtml(assembledRaw)}">📋 ${guidedText('Copy sentence', 'Sao chép câu')}</button>
            </div>
            ${inputsHtml}
        </div>`;
    }

    function renderGuidedFurther(levelData) {
        const section = GUIDED_SECTIONS[4];
        const activePlan = (levelData.plans || []).find(p => (p.variantId || p.stance || p.id) === guidedSelectedVariantId) || levelData.plans?.[0] || {};
        const allSentences = getScaffoldSentences(levelData, activePlan);
        const depths = [
            { depth: 1, en: '1 · Purpose', vi: 'Mức 1 · Mục đích câu' },
            { depth: 2, en: '2 · Fillable Frame', vi: 'Mức 2 · Khung ghép câu' },
            { depth: 3, en: '3 · Full Model', vi: 'Mức 3 · Câu mẫu tham khảo' },
        ];

        // Paragraph sentence counts
        const introCount = allSentences.filter(s => String(s.paragraph || '').toLowerCase().includes('intro')).length;
        const body1Count = allSentences.filter(s => {
            const p = String(s.paragraph || '').toLowerCase();
            return p.includes('body 1') || (p.includes('body') && !p.includes('2'));
        }).length;
        const body2Count = allSentences.filter(s => String(s.paragraph || '').toLowerCase().includes('body 2')).length;
        const conclCount = allSentences.filter(s => String(s.paragraph || '').toLowerCase().includes('conclu')).length;

        // Filter sentences by selected tab to avoid wall of text
        const visibleSentences = allSentences.filter(s => {
            if (guidedActiveScaffoldPara === 'all') return true;
            const p = String(s.paragraph || '').toLowerCase();
            if (guidedActiveScaffoldPara === 'intro') return p.includes('intro');
            if (guidedActiveScaffoldPara === 'body1') return p.includes('body 1') || (p.includes('body') && !p.includes('2'));
            if (guidedActiveScaffoldPara === 'body2') return p.includes('body 2');
            if (guidedActiveScaffoldPara === 'concl') return p.includes('conclu');
            return true;
        });

        const workflowGuideHtml = `
        <div class="essay-guided-scaffold-guide-compact">
            <span class="essay-guided-scaffold-guide-pill">💡 ${guidedText('Sentence Construction Studio', 'Xưởng ghép câu hoàn chỉnh')}</span>
            <span class="essay-guided-scaffold-guide-text">${guidedText('Draft sentences below and click "Add to draft" to transfer directly into your final essay.', 'Ghép câu theo gợi ý bên dưới và bấm "Đưa câu vào bài" để hoàn thiện bài luận từng bước.')}</span>
        </div>`;

        const scaffoldTabsHtml = `
        <div class="essay-guided-scaffold-tabs" role="tablist" aria-label="${guidedText('Paragraph', 'Đoạn văn')}">
            <button type="button" class="essay-guided-scaffold-tab${guidedActiveScaffoldPara === 'intro' ? ' is-active' : ''}" data-guided-action="set-scaffold-tab" data-tab="intro">
                1. ${guidedText('Introduction', 'Mở bài')} (${introCount})
            </button>
            <button type="button" class="essay-guided-scaffold-tab${guidedActiveScaffoldPara === 'body1' ? ' is-active' : ''}" data-guided-action="set-scaffold-tab" data-tab="body1">
                2. ${guidedText('Body Paragraph 1', 'Thân bài 1')} (${body1Count})
            </button>
            <button type="button" class="essay-guided-scaffold-tab${guidedActiveScaffoldPara === 'body2' ? ' is-active' : ''}" data-guided-action="set-scaffold-tab" data-tab="body2">
                3. ${guidedText('Body Paragraph 2', 'Thân bài 2')} (${body2Count})
            </button>
            <button type="button" class="essay-guided-scaffold-tab${guidedActiveScaffoldPara === 'concl' ? ' is-active' : ''}" data-guided-action="set-scaffold-tab" data-tab="concl">
                4. ${guidedText('Conclusion', 'Kết bài')} (${conclCount})
            </button>
            <button type="button" class="essay-guided-scaffold-tab${guidedActiveScaffoldPara === 'all' ? ' is-active' : ''}" data-guided-action="set-scaffold-tab" data-tab="all">
                ${guidedText('All Sentences', 'Tất cả các câu')} (${allSentences.length})
            </button>
        </div>`;

        const depthSwitch = `<div class="essay-guided-depth">
            <span class="essay-guided-depth-label">${guidedText('Hint level', 'Mức độ gợi ý')}${guidedHelpBtn('hint-level')}</span>
            <div class="essay-guided-depth-track" role="group" aria-label="${guidedText('Hint level', 'Mức độ gợi ý')}">
                ${depths.map(item => `<button type="button" class="${guidedHintDepth === item.depth ? 'is-active' : ''}" data-guided-action="set-depth" data-depth="${item.depth}" aria-pressed="${guidedHintDepth === item.depth ? 'true' : 'false'}">${escapeHtml(guidedText(item.en, item.vi))}</button>`).join('')}
            </div>
        </div>`;

        let currentParagraph = '';
        const cards = visibleSentences.map(sentence => {
            const paragraph = String(sentence.paragraph || '').trim();
            const heading = paragraph && paragraph !== currentParagraph
                ? `<h4 class="essay-guided-paragraph-head">${escapeHtml(paragraph)}</h4>`
                : '';
            currentParagraph = paragraph || currentParagraph;
            const sId = sentence.sentenceId || `sent_${sentence.index || 1}`;
            const selected = guidedSelectedTargetIds.includes(sId);
            const full = !selected && guidedSelectedTargetIds.length >= GUIDED_MAX_TARGETS;
            const contextualCue = getDetailedSentenceCue(sentence, paragraph, sentence.index || 1);
            const modelSentence = getAuthenticModelSentence(sentence, currentEntry, activePlan, sentence.index);

            const frame = guidedHintDepth >= 2 && sentence.frame
                ? renderInteractiveFillableFrame(sentence, sId)
                : '';
            const model = guidedHintDepth >= 3 && modelSentence
                ? `<div class="essay-guided-model">
                    <span class="essay-guided-reveal-label">${guidedText('Model sentence', 'Câu mẫu tham khảo')}</span>
                    <p class="essay-guided-model-text">${escapeHtml(modelSentence)}</p>
                </div>`
                : '';
            const reveal = guidedHintDepth < 3
                ? `<button type="button" class="essay-guided-ghost-btn" data-guided-action="reveal-hint" data-depth="${guidedHintDepth + 1}">${guidedText(guidedHintDepth === 1 ? 'Show fillable frame' : 'Show model sentence', guidedHintDepth === 1 ? 'Hiện khung ghép câu' : 'Hiện câu mẫu')}</button>`
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
                    <button type="button" class="essay-guided-transfer-btn" data-guided-action="transfer-sentence" data-sentence-id="${escapeHtml(sId)}">📝 ${guidedText('Add to draft', 'Đưa câu vào bài')}</button>
                    <button type="button" class="essay-guided-ghost-btn${selected ? ' is-selected' : ''}" data-guided-action="target" data-target-id="${escapeHtml(sId)}" aria-pressed="${selected ? 'true' : 'false'}"${full ? ' disabled' : ''}>${selected ? '✓ ' + guidedText('Target set', 'Đã chọn mục tiêu') : '+ ' + guidedText('Track as target', 'Chọn làm mục tiêu')}</button>
                    ${guidedHelpBtn('targets')}
                </div>
            </article>`;
        }).join('');

        return `<section class="essay-guided-section">
            ${guidedSectionHead(section, guidedText('Build your essay sentence-by-sentence. Type directly into the blanks or use model sentences to stream into your final essay.', 'Xây dựng bài viết theo từng câu. Gõ trực tiếp vào chỗ trống hoặc dùng câu mẫu để chuyển sang bài viết hoàn chỉnh.'))}
            ${workflowGuideHtml}
            <!-- Frozen while the sentence list scrolls: paragraph and hint level are
                 the two controls a learner reaches for mid-list. -->
            <div class="essay-guided-scaffold-controls">
                <div class="essay-guided-scaffold-tabs-row">
                    ${scaffoldTabsHtml}
                    ${guidedHelpBtn('scaffold-tabs')}
                </div>
                ${depthSwitch}
            </div>
            ${cards || `<p class="essay-guided-empty">${guidedText('No scaffold is available for this direction.', 'Hướng này chưa có khung hỗ trợ.')}</p>`}

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
        // Opens itself on the last step (Sentence builder), where "before you submit" is the job.
        const open = guidedChecklistOpen || (!complete && guidedSection === 'further');
        el.guidedChecklist.hidden = false;
        el.guidedChecklist.classList.toggle('is-complete', complete);
        el.guidedChecklist.classList.toggle('is-open', open);
        el.guidedChecklist.innerHTML = `
            <button type="button" class="essay-guided-checklist-toggle" data-guided-checklist-toggle aria-expanded="${open ? 'true' : 'false'}">
                <span class="essay-guided-checklist-title">${guidedText('Before you submit', 'Trước khi nộp bài')}</span>
                <span class="essay-guided-checklist-count${complete ? ' is-complete' : ''}">${done}/${checks.length}</span>
                <span class="essay-guided-group-chevron" aria-hidden="true"></span>
            </button>
            ${guidedHelpBtn('checklist')}
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

    function applyFilter({ preserveSelection = false, selectMatch = true } = {}) {
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
            if (selectMatch) {
                handleEmptyState();
            }
        } else {
            if (el.startBtn) el.startBtn.disabled = false;
            if (el.questionPill) el.questionPill.disabled = false;

            let targetIndex = -1;
            if (preserveSelection && currentEntry) {
                const existingIdx = filteredEntries.findIndex(e => String(e.id) === String(currentEntry.id));
                if (existingIdx >= 0) targetIndex = existingIdx;
            } else {
                const routeQuestionId = pendingRouteQuestionId || getCurrentRouteQuestionId();
                const routeIndex = routeQuestionId
                    ? filteredEntries.findIndex((e) => String(e.id) === String(routeQuestionId))
                    : -1;
                targetIndex = routeIndex >= 0 ? routeIndex : (selectMatch ? 0 : -1);
            }
            currentEntryIndex = targetIndex;
            if (selectMatch && currentEntryIndex >= 0) {
                selectEntry(currentEntryIndex, { updateRoute: true });
            }
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
        applyFilter({ preserveSelection: true, selectMatch: false });
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
        searchQuery = '';
        if (el.jumpSearch) {
            el.jumpSearch.value = '';
            el.jumpSearch.focus();
        }
        applyFilter({ preserveSelection: true, selectMatch: false });
        renderJumpList('', null);
    }

    function closePicker() {
        if (!el.sheet || !el.backdrop) return;
        pickerOpen = false;
        el.backdrop.classList.remove('is-visible');
        el.backdrop.setAttribute('aria-hidden', 'true');
        el.sheet.classList.remove('is-open');
        el.sheet.setAttribute('aria-hidden', 'true');
        if (el.questionPill) el.questionPill.setAttribute('aria-expanded', 'false');
        if (searchQuery) {
            searchQuery = '';
            if (el.jumpSearch) el.jumpSearch.value = '';
            applyFilter({ preserveSelection: true, selectMatch: false });
        }
    }

    function renderJumpList(filter = '', page = null) {
        if (!el.jumpList) return;

        const filtered = filteredEntries.map((entry, idx) => ({ entry, idx }));
        const totalPages = Math.max(1, Math.ceil(filtered.length / PICKER_PAGE_SIZE));

        if (page === null || page === undefined) {
            // Open on the page holding the current prompt rather than page 1.
            const activeFilteredIndex = currentEntry
                ? filtered.findIndex((item) => String(item.entry.id) === String(currentEntry.id))
                : -1;
            pickerPage = activeFilteredIndex >= 0
                ? Math.floor(activeFilteredIndex / PICKER_PAGE_SIZE) + 1
                : 1;
        } else {
            pickerPage = Math.max(1, Math.min(page, totalPages));
        }

        const currentPage = pickerPage;
        const pagedItems = filtered.slice((currentPage - 1) * PICKER_PAGE_SIZE, currentPage * PICKER_PAGE_SIZE);

        const itemsHtml = pagedItems.map(({ entry, idx }) => {
            const isActive = currentEntry && String(entry.id) === String(currentEntry.id);
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
        if (filteredEntries[index] && currentEntry && String(filteredEntries[index].id) === String(currentEntry.id)) {
            closePicker();
            return;
        }
        if (!(await confirmLeaveDraft())) return;
        if (randomMode && currentEntryIndex >= 0) navHistory.push(currentEntryIndex);
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
        const headerCard = document.querySelector('#mode-essay .essay-header-card');
        if (headerCard) headerCard.style.display = 'none';

        const mp = getModePanelEl();
        if (mp) mp.classList.add('essay-writing-active');
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
            syncStickyPromptAffordance();
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

    function syncStickyWordCount() {
        if (!el.wordCountSticky || !el.wordCountDisplay) return;
        el.wordCountSticky.textContent = el.wordCountDisplay.textContent;
        el.wordCountSticky.className = `essay-word-count-sticky ${el.wordCountDisplay.classList.contains('essay-wc-good') ? 'essay-wc-good' : el.wordCountDisplay.classList.contains('essay-wc-warn') ? 'essay-wc-warn' : 'essay-wc-bad'}`;
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
        syncStickyWordCount();
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
        onEnter: onEnter,
        applyGuidedTypography: applyGuidedTypography,
        restoreGuidedPreferences: restoreGuidedPreferences
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
