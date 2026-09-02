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
    let guidedExpandedVocabViIds = new Set();
    let guidedExpandedColloViIds = new Set();
    let guidedFilledSentenceSlots = {};
    let guidedActiveScaffoldPara = 'intro';
    let guidedDraftSpoilers = new Set();
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

    /**
     * Synthesize user's constructed sentences and outline into a clean scaffolding draft.
     */
    function compileUserScaffoldDraft(levelData) {
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

        // Natural thesis & cleaned argument claims
        const naturalThesis = generateNaturalThesis(activePlan, promptText, guidedLevel);
        const cleanP1 = cleanArgumentClaim(body1Point || 'standardized frameworks often constrain personal curiosity');
        const cleanP2 = cleanArgumentClaim(body2Point || 'holistic learning approaches provide essential life skills');

        // Check user-assembled sentences from Step 5
        const sentences = levelData.scaffolds?.[variantId] || [];
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
                    <span>🏗️ ${guidedText('Essay Writing Scaffolding & Draft Blueprint', 'Khung dàn ý & Giàn giáo hỗ trợ viết bài')}</span>
                    <span class="essay-guided-draft-badge">${escapeHtml(draft.stance)} · 4 Paragraphs</span>
                </div>
                <div class="essay-guided-draft-actions">
                    <button type="button" class="essay-guided-draft-btn-insert" id="essay-draft-insert-btn" title="${guidedText('Populate scaffold outline into the essay editor', 'Điền khung dàn ý vào bài viết')}">
                        ⚡ ${guidedText('Insert Outline into Editor', 'Điền khung vào bài')}
                    </button>
                    <button type="button" class="essay-guided-draft-btn-copy" id="essay-draft-copy-btn" title="${guidedText('Copy scaffold outline to clipboard', 'Sao chép khung dàn ý')}">
                        📋 ${guidedText('Copy Outline', 'Sao chép khung')}
                    </button>
                </div>
            </div>
            <p class="essay-guided-draft-instructions">
                💡 ${guidedText(
                    'This scaffolding guides your writing without giving away a full essay to copy. Use your chosen points below, and click the spoiler tag only when you need sample phrasing inspiration.',
                    'Khung dàn ý này hỗ trợ bạn tự viết bài mà không hiển thị sẵn nguyên văn toàn bài. Hãy dựa vào các luận điểm bên dưới và chỉ mở spoiler khi cần gợi ý cách diễn đạt.'
                )}
            </p>
            <div class="essay-guided-draft-content">
                ${paragraphs.map(p => {
                    const isRevealed = guidedDraftSpoilers.has(p.key);
                    return `
                    <div class="essay-guided-draft-para" data-para-key="${p.key}">
                        <div class="essay-guided-draft-para-head">
                            <div class="essay-guided-draft-para-label">📌 ${escapeHtml(guidedText(p.titleEn, p.titleVi))}</div>
                            <span class="essay-guided-draft-blueprint-tag">${escapeHtml(guidedText(p.blueprintEn, p.blueprintVi))}</span>
                        </div>
                        <div class="essay-guided-draft-para-blueprint">
                            <ul class="essay-guided-draft-point-list">
                                ${p.points.map(pt => `<li><strong>${escapeHtml(guidedText(pt.labelEn, pt.labelVi))}:</strong> <span>${escapeHtml(pt.text)}</span></li>`).join('')}
                            </ul>
                            ${p.userText ? `
                            <div class="essay-guided-draft-user-box">
                                <span class="essay-guided-draft-user-label">✍️ ${guidedText('Your Constructed Sentences from Step 5:', 'Các câu bạn đã ghép ở Bước 5:')}</span>
                                <p class="essay-guided-draft-user-text">"${escapeHtml(p.userText)}"</p>
                            </div>` : ''}
                        </div>
                        <div class="essay-guided-draft-spoiler-wrap">
                            <button type="button" class="essay-guided-draft-spoiler-toggle${isRevealed ? ' is-revealed' : ''}" data-guided-action="toggle-draft-spoiler" data-para-key="${p.key}">
                                <span class="essay-guided-spoiler-icon" aria-hidden="true">${isRevealed ? '🙈' : '👁️'}</span>
                                <span class="essay-guided-spoiler-text">${isRevealed ? guidedText('Hide Model Wording (Spoiler)', 'Ẩn câu mẫu (Spoiler)') : guidedText('Reveal Model Wording (Spoiler)', 'Hiện câu mẫu tham khảo (Spoiler)')}</span>
                            </button>
                            ${isRevealed ? `
                            <div class="essay-guided-draft-spoiler-content">
                                <span class="essay-guided-spoiler-badge">🌟 ${guidedText('Sample Academic Wording:', 'Câu hoàn chỉnh mẫu:')}</span>
                                <p class="essay-guided-draft-model-text">${escapeHtml(p.modelText)}</p>
                            </div>` : ''}
                        </div>
                    </div>`;
                }).join('')}
            </div>
        `;

        // Wire up dynamic buttons
        const insertBtn = document.getElementById('essay-draft-insert-btn');
        if (insertBtn) {
            insertBtn.addEventListener('click', () => {
                if (el.essayInput) {
                    el.essayInput.value = draft.scaffoldEditorText;
                    updateWordCount();
                    el.essayInput.focus();
                    el.essayInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    insertBtn.textContent = '✓ ' + guidedText('Outline Inserted!', 'Đã điền vào bài!');
                    setTimeout(() => {
                        insertBtn.innerHTML = '⚡ ' + guidedText('Insert Outline into Editor', 'Điền khung vào bài');
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
        guidedExpandedVocabViIds = new Set();
        guidedExpandedColloViIds = new Set();
        guidedFilledSentenceSlots = {};
        guidedActiveScaffoldPara = 'intro';
        guidedDraftSpoilers = new Set();
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
        if (el.guidedContent) {
            el.guidedContent.addEventListener('click', onGuidedContentAction);
            el.guidedContent.addEventListener('input', onGuidedFrameInput);
        }
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
        if (el.guidedContent) el.guidedContent.innerHTML = html + guidedStepNav();
        renderGuidedChecklist();
        renderGuidedRecycle(levelData);
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
        
        if (text.includes('einstein') || text.includes('interferes with my learning')) {
            return [
                {
                    en: "Do NOT write a biography or history lesson about Albert Einstein; evaluate the educational concept, not his personal life.",
                    vi: "Không viết về tiểu sử hay cuộc đời của Albert Einstein; hãy tập trung phản biện và đánh giá nhận định về giáo dục."
                },
                {
                    en: "Do NOT confuse 'formal schooling' (institutional rules and curricula) with 'genuine learning' (autonomous curiosity and discovery).",
                    vi: "Không đánh đồng 'giáo dục trường lớp' (nội quy và giáo trình) với 'việc học thực chất' (sự tò mò và tự khám phá kiến thức)."
                },
                {
                    en: "Ensure you answer BOTH questions: what the statement means AND whether you think he is correct.",
                    vi: "Đảm bảo trả lời đầy đủ CẢ HAI câu hỏi của đề: nhận định đó có ý nghĩa gì VÀ bạn có đồng ý với điều đó hay không."
                }
            ];
        }
        
        if (text.includes('advantages outweigh') || text.includes('advantages and disadvantages')) {
            return [
                {
                    en: "Do NOT discuss only advantages; you must examine both sides fairly before delivering your final verdict.",
                    vi: "Không chỉ bàn về mặt tích cực; bạn phải phân tích cả hai mặt một cách công bằng trước khi đưa ra kết luận."
                },
                {
                    en: "Do NOT forget to state clearly which side outweighs the other in both your thesis and conclusion.",
                    vi: "Đừng quên nêu rõ ràng mặt nào chiếm ưu thế hơn (outweigh) trong cả câu luận đề lẫn phần kết bài."
                }
            ];
        }
        
        if (text.includes('discuss both views')) {
            return [
                {
                    en: "Do NOT dedicate the entire essay to the side you agree with; give balanced coverage to both perspectives.",
                    vi: "Không dành toàn bộ bài viết cho quan điểm bạn ủng hộ; hãy phân tích cân bằng cả hai luồng ý kiến."
                },
                {
                    en: "State your personal stance clearly; a neutral essay without an explicit opinion will lose Task Achievement points.",
                    vi: "Nêu rõ lập trường cá nhân; một bài viết trung lập không có quan điểm rõ ràng sẽ bị trừ điểm Task Achievement."
                }
            ];
        }
        
        if (common?.promptTraps && common.promptTraps.length > 0) {
            return common.promptTraps;
        }
        
        return [
            {
                en: "Do NOT write off-topic generalizations; directly connect every paragraph to the specific prompt keywords.",
                vi: "Không viết chung chung lạc đề; hãy gắn chặt từng đoạn văn với các từ khóa cụ thể trong đề bài."
            },
            {
                en: "Support every main idea with a concrete reason and a realistic real-world example.",
                vi: "Hỗ trợ mọi ý chính bằng một lý do cụ thể và một ví dụ thực tế có tính thuyết phục."
            }
        ];
    }

    function renderInteractivePromptStructure(segments, promptText) {
        if (!segments || segments.length === 0) return '';
        
        const parsedSegments = segments.map((seg, idx) => {
            const text = String(seg.text || '').trim();
            const lower = text.toLowerCase();
            
            let roleTitleEn = 'Core Instruction';
            let roleTitleVi = 'Chỉ dẫn trọng tâm';
            let roleIcon = '💡';
            let targetParagraphEn = 'Introduction & Body Paragraphs';
            let targetParagraphVi = 'Mở bài & Các đoạn Thân bài';
            let instructionEn = 'Address this requirement directly in your essay.';
            let instructionVi = 'Trả lời trực tiếp yêu cầu này trong bài viết.';
            let trapEn = 'Do not overlook this element when structuring your response.';
            let trapVi = 'Không bỏ qua thành phần này khi lập dàn ý bài viết.';
            
            if (text.includes('“') || text.includes('"') || text.includes('–') || text.includes('-') || lower.includes('einstein') || (!text.includes('?') && idx === 0)) {
                roleTitleEn = 'Background Context & Quote';
                roleTitleVi = 'Bối cảnh & Nhận định gốc';
                roleIcon = '📌';
                targetParagraphEn = 'Introduction (Sentence 1)';
                targetParagraphVi = 'Mở bài (Câu 1: Paraphrase)';
                instructionEn = 'Paraphrase this quote/premise in your opening sentence using synonyms. Do not copy word-for-word.';
                instructionVi = 'Diễn đạt lại câu trích dẫn/nhận định này ở câu mở đầu bằng từ ngữ của bạn. Không chép y nguyên từng từ.';
                trapEn = 'Do NOT write a biography or history lesson about the author; analyze the educational concept itself.';
                trapVi = 'Không đi sâu kể tiểu sử hay cuộc đời tác giả; chỉ tập trung phân tích quan điểm giáo dục.';
            } else if (lower.includes('what did he mean') || lower.includes('what do you mean') || lower.includes('explain')) {
                roleTitleEn = 'Sub-Question 1: Meaning & Interpretation';
                roleTitleVi = 'Câu hỏi 1: Giải thích ý nghĩa nhận định';
                roleIcon = '🎯';
                targetParagraphEn = 'Body Paragraph 1';
                targetParagraphVi = 'Thân bài 1 (Giải thích ý nghĩa & Cơ chế)';
                instructionEn = 'Explain what Einstein meant: traditional schooling often relies on rigid curricula and rote memorization, which can stifle natural curiosity.';
                instructionVi = 'Giải thích ý nghĩa câu nói: trường học truyền thống thường dựa vào học vẹt và giáo trình cứng nhắc, dễ làm thui chột tính tò mò tự nhiên.';
                trapEn = 'Do NOT simply rephrase the quote again; explain the underlying mechanism (why and how schooling interferes with learning).';
                trapVi = 'Không chỉ diễn đạt lại nhận định; hãy giải thích cơ chế (tại sao và bằng cách nào trường lớp cản trở việc học).';
            } else if (lower.includes('do you think he is correct') || lower.includes('do you agree') || lower.includes('extent do you agree') || lower.includes('correct?')) {
                roleTitleEn = 'Sub-Question 2: Personal Stance & Evaluation';
                roleTitleVi = 'Câu hỏi 2: Quan điểm cá nhân & Đánh giá';
                roleIcon = '⚖️';
                targetParagraphEn = 'Introduction (Thesis) & Body Paragraph 2 / Conclusion';
                targetParagraphVi = 'Mở bài (Luận đề) & Thân bài 2 / Kết bài';
                instructionEn = 'State your clear position (Agree or Disagree) in your thesis, then provide your own reasoned argument in Body 2.';
                instructionVi = 'Tuyên bố lập trường rõ ràng (Đồng ý hay Không đồng ý) trong câu luận đề, sau đó đưa ra lập luận chặt chẽ trong Thân bài 2.';
                trapEn = 'Do NOT remain vague or undecided. PTE requires a decisive, consistent position supported with reasons.';
                trapVi = 'Không trả lời chung chung hoặc nửa vời. PTE đòi hỏi bạn phải có lập trường dứt khoát và nhất quán.';
            }
            
            return {
                index: idx + 1,
                text,
                roleTitleEn,
                roleTitleVi,
                roleIcon,
                targetParagraphEn,
                targetParagraphVi,
                instructionEn,
                instructionVi,
                trapEn,
                trapVi
            };
        });

        return `
        <div class="essay-guided-clause-dissector">
            <p class="essay-guided-clause-intro">
                🔍 ${guidedText(
                    'Interactive Prompt Breakdown: Click each part to see its role, target paragraph, and how to address it.',
                    'Phân tích đề bài tương tác: Nhấn vào từng phần để xem vai trò, vị trí trong bài và cách triển khai.'
                )}
            </p>
            <div class="essay-guided-clause-cards">
                ${parsedSegments.map((item) => `
                <div class="essay-guided-clause-card is-open" data-clause-idx="${item.index}">
                    <div class="essay-guided-clause-head">
                        <span class="essay-guided-clause-idx" aria-hidden="true">${item.index}</span>
                        <div class="essay-guided-clause-main">
                            <div class="essay-guided-clause-meta">
                                <span class="essay-guided-clause-role-badge">
                                    ${item.roleIcon} ${escapeHtml(guidedText(item.roleTitleEn, item.roleTitleVi))}
                                </span>
                                <span class="essay-guided-clause-target-pill">
                                    ${escapeHtml(guidedText(item.targetParagraphEn, item.targetParagraphVi))}
                                </span>
                            </div>
                            <blockquote class="essay-guided-clause-text">${escapeHtml(item.text)}</blockquote>
                        </div>
                    </div>
                    <div class="essay-guided-clause-body">
                        <div class="essay-guided-clause-detail">
                            <span class="essay-guided-clause-detail-label">✍️ ${guidedText('How to address in your essay:', 'Cách triển khai trong bài:')}</span>
                            <p class="essay-guided-clause-detail-text">${escapeHtml(guidedText(item.instructionEn, item.instructionVi))}</p>
                        </div>
                        <div class="essay-guided-clause-trap">
                            <span class="essay-guided-clause-trap-label">⚠️ ${guidedText('Pitfall for this clause:', 'Lưu ý tránh bẫy cho phần này:')}</span>
                            <p class="essay-guided-clause-trap-text">${escapeHtml(guidedText(item.trapEn, item.trapVi))}</p>
                        </div>
                    </div>
                </div>`).join('')}
            </div>
        </div>`;
    }

    function renderGuidedUnderstand() {
        const common = guidedPack.common || {};
        const section = GUIDED_SECTIONS[0];
        const promptText = String(guidedPack.prompt || currentEntry?.prompt || '').trim();

        // 1. Interactive Question Structure (Prompt Dissector)
        const segments = common.promptSegments || [];
        const segmentsHtml = renderInteractivePromptStructure(segments, promptText);

        // 2. Requirements
        const reqs = common.requirements || [];
        const reqsHtml = reqs.length ? `<ul class="essay-guided-ticklist">${reqs.map(item => `<li><span class="essay-guided-check" aria-hidden="true">✓</span><span>${escapeHtml(bilingual(item))}</span></li>`).join('')}</ul>` : '';

        // 3. Prompt-Specific Traps (Cleaned & High-Value)
        const traps = getPromptSpecificTraps(promptText, common);
        const trapsHtml = traps.length ? `<ul class="essay-guided-ticklist essay-guided-ticklist--warn">${traps.map(item => `<li><span class="essay-guided-warn" aria-hidden="true">!</span><span>${escapeHtml(bilingual(item))}</span></li>`).join('')}</ul>` : '';

        // 4. Grouped Stances & Approaches (Angles)
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
                        ${items.map(item => `<li><span>${escapeHtml(cleanArgumentClaim(preferTranslated(item.en, guidedLanguage === 'vi' ? item.vi : '')))}</span></li>`).join('')}
                    </ul>
                </div>`;
            }).join('')}</div>`;
        }

        return `<section class="essay-guided-section">
            ${guidedSectionHead(section, guidedText('Analyze the prompt structure and core requirements before formulating your argument.', 'Phân tích kỹ cấu trúc câu hỏi và yêu cầu bắt buộc trước khi lập luận.'))}
            <h4 class="essay-guided-visually-hidden">${guidedText('Break down the prompt', 'Phân tích đề')}</h4>
            <blockquote class="essay-guided-prompt">${escapeHtml(guidedPack.prompt)}</blockquote>
            ${guidedGroup('parts', guidedText('Interactive Question Structure', 'Cấu trúc câu hỏi tương tác'), segmentsHtml, { count: segments.length, defaultOpen: true })}
            ${guidedGroup('requirements', guidedText('Mandatory Requirements', 'Yêu cầu bắt buộc'), reqsHtml, { count: reqs.length, defaultOpen: true })}
            ${guidedGroup('traps', guidedText('Prompt-Specific Traps to Avoid', 'Các bẫy đề thi cần tránh'), trapsHtml, { count: traps.length, tone: 'warn', defaultOpen: true })}
            ${guidedGroup('angles', guidedText('Suggested Approaches', 'Gợi ý các hướng tiếp cận'), anglesHtml, { count: angles.length, defaultOpen: true })}
        </section>`;
    }

    function getAvailablePointsForPlan(plan, levelData, common) {
        if (!plan) return [];
        const variantId = plan.variantId || 'default';
        const points = [];
        const seenTexts = new Set();
        const promptText = String(guidedPack?.prompt || currentEntry?.prompt || '').toLowerCase();
        const isEinstein = promptText.includes('einstein') || promptText.includes('interferes with my learning');

        const addPoint = (id, en, vi, explEn = '', explVi = '') => {
            const cleanEn = cleanArgumentClaim(en);
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
            let vi = isEinstein
                ? 'Hệ thống trường học cứng nhắc và học vẹt kìm hãm sự tò mò và khả năng học tự nhiên của học sinh.'
                : 'Luận điểm trọng tâm 1 cho Thân bài 1';
            let explEn = isEinstein
                ? 'Traditional schooling often emphasizes memorizing facts for exams, which dampens students\' innate curiosity and autonomous discovery.'
                : 'Develop this argument with a clear causal explanation and supporting real-world evidence in Body 1.';
            let explVi = isEinstein
                ? 'Trường học truyền thống quá chú trọng việc học thuộc lòng để vượt qua thi cử, khiến học sinh mất đi khả năng tự suy nghĩ và tò mò khám phá kiến thức mới.'
                : 'Phát triển luận điểm này kèm theo phân tích nguyên nhân/hệ quả và dẫn chứng thực tế trong Thân bài 1.';
            addPoint(`${variantId}_p1`, plan.point1, vi, explEn, explVi);
        }
        if (plan.point2) {
            let vi = isEinstein
                ? 'Trường học cung cấp kiến thức nền tảng có hệ thống và rèn luyện kỹ năng hợp tác thực tế.'
                : 'Luận điểm trọng tâm 2 cho Thân bài 2';
            let explEn = isEinstein
                ? 'Institutional schooling provides structured cognitive frameworks and fosters essential collaborative and interpersonal skills that self-study cannot replicate.'
                : 'Develop this complementary argument with distinct real-world examples in Body 2.';
            let explVi = isEinstein
                ? 'Trường học không chỉ truyền thụ kiến thức cơ bản mà còn tạo môi trường rèn luyện tính kỷ luật, kỹ năng giao tiếp và làm việc nhóm mà việc tự học không thể có được.'
                : 'Phát triển luận điểm bổ trợ này với các ví dụ hoặc khía cạnh thực tế khác biệt trong Thân bài 2.';
            addPoint(`${variantId}_p2`, plan.point2, vi, explEn, explVi);
        }

        const angles = common?.angles || [];
        const targetStance = String(plan.stance || plan.variantId || '').trim().toLowerCase();
        angles.forEach((angle, idx) => {
            const angleStance = String(angle.sourceVariantId || '').trim().toLowerCase();
            if (angleStance === targetStance || targetStance === 'all' || !targetStance) {
                const angleEn = String(angle.en || '').trim();
                let angleVi = String(angle.vi || '').trim();
                if (angleVi.startsWith('Góc nhìn: ')) angleVi = '';
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
                    const hasViSubtitle = guidedLanguage === 'vi' && point.vi && point.vi !== point.en && !point.vi.startsWith('Góc nhìn: ' + point.en);
                    return `
                    <div class="essay-guided-point-card${isSelected ? ' is-selected' : ''}">
                        <div class="essay-guided-point-main">
                            <button type="button" class="essay-guided-point-select-btn" data-guided-action="select-point" data-point-id="${escapeHtml(point.id)}" aria-pressed="${isSelected ? 'true' : 'false'}">
                                <span class="essay-guided-point-checkbox" aria-hidden="true">${isSelected ? `✓ ${selectedIdx}` : ''}</span>
                                <div class="essay-guided-point-text">
                                    <strong class="essay-guided-point-title">${escapeHtml(point.en)}</strong>
                                    ${hasViSubtitle ? `<span class="essay-guided-point-vi">${escapeHtml(point.vi)}</span>` : ''}
                                </div>
                            </button>
                            <button type="button" class="essay-guided-info-btn${isExplOpen ? ' is-open' : ''}" data-guided-action="toggle-point-expl" data-point-id="${escapeHtml(point.id)}" title="${guidedText('Show explanation & strategy', 'Xem giải thích chi tiết và cách triển khai bằng tiếng Việt')}" aria-label="${guidedText('Show explanation', 'Xem giải thích')}">
                                <span aria-hidden="true">?</span>
                            </button>
                        </div>
                        ${isExplOpen ? `
                        <div class="essay-guided-point-expl">
                            <div class="essay-guided-point-expl-head">
                                <span class="essay-guided-point-expl-icon" aria-hidden="true">💡</span>
                                <strong>${guidedText('Argument Strategy & Real-World Elaboration', 'Giải thích chi tiết & Hướng dẫn triển khai')}</strong>
                            </div>
                            <p class="essay-guided-point-expl-desc">${escapeHtml(guidedLanguage === 'vi' ? (point.explVi || 'Luận điểm này làm rõ lập trường của bạn. Hãy giải thích nguyên nhân và đưa ra dẫn chứng thực tế.') : (point.explEn || 'Develop this argument with a clear causal explanation and supporting real-world evidence.'))}</p>
                            <div class="essay-guided-point-expl-tip">
                                <strong>${guidedText('Writing cue:', 'Gợi ý triển khai câu:')}</strong>
                                <span>${guidedText('Topic Sentence: State this argument directly -> Explanation: Explain why this happens -> Evidence: Give a concrete example -> Link back to thesis.', 'Câu chủ đề: Nêu luận điểm rõ ràng -> Giải thích: Phân tích nguyên nhân sâu xa -> Dẫn chứng: Đưa ví dụ thực tế -> Câu chốt: Liên kết lại với lập trường.')}</span>
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

    function getVocabContextExample(item, currentEntry, guidedPack, level) {
        const term = String(item.term || '').trim().toLowerCase();
        const currentLevel = String(level || guidedLevel || 'b2').toLowerCase();

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
                meaning: guidedLanguage === 'vi' ? entry.vi : (item.enGloss || item.en || entry.vi),
                example: entry.exampleEn,
                exampleVi: entry.exampleVi
            };
        }

        const topic = currentEntry?.verifiedPrimaryTopic || 'the essay prompt';
        return {
            meaning: guidedLanguage === 'vi' ? `Cụm từ học thuật về "${item.term}"` : `Academic collocation for "${item.term}"`,
            example: `Employing "${item.term}" clarifies your academic reasoning regarding ${topic.toLowerCase()}.`,
            exampleVi: `Sử dụng "${item.term}" giúp làm sáng tỏ lập luận học thuật của bạn về ${topic.toLowerCase()}.`
        };
    }

    function renderGuidedLanguage(levelData) {
        const section = GUIDED_SECTIONS[2];
        const kit = levelData.languageKit || {};
        const common = guidedPack.common || {};
        const activePlan = (levelData.plans || []).find(p => p.variantId === guidedSelectedVariantId) || levelData.plans?.[0] || {};
        const [body1Point, body2Point] = getSelectedPointsForPlan(activePlan, levelData, common);

        // 1. Core Vocabulary with Level-Adapted Examples & <?> Vietnamese Toggle
        const vocabulary = kit.vocabulary || [];
        const vocabHtml = vocabulary.length ? `<div class="essay-guided-target-grid">${vocabulary.map(item => {
            const selected = guidedSelectedTargetIds.includes(item.term);
            const full = !selected && guidedSelectedTargetIds.length >= GUIDED_MAX_TARGETS;
            const vocabInfo = getVocabContextExample(item, currentEntry, guidedPack, guidedLevel);
            const isViOpen = guidedExpandedVocabViIds.has(item.term) || guidedLanguage === 'vi';
            return `<div class="essay-guided-target-card${selected ? ' is-selected' : ''}">
                <div class="essay-guided-target-head">
                    <button type="button" class="essay-guided-target-select-btn" data-guided-action="target" data-target-id="${escapeHtml(item.term)}" aria-pressed="${selected ? 'true' : 'false'}"${full ? ' disabled' : ''}>
                        <span class="essay-guided-target-checkbox">${selected ? '✓' : '+'}</span>
                        <strong class="essay-guided-target-term">${escapeHtml(item.term)}</strong>
                        <span class="essay-guided-target-gloss">${escapeHtml(bilingual(item, 'enGloss', 'viGloss'))}</span>
                    </button>
                    <button type="button" class="essay-guided-vocab-vi-toggle${isViOpen ? ' is-open' : ''}" data-guided-action="toggle-vocab-vi" data-term="${escapeHtml(item.term)}" title="${guidedText('Show Vietnamese translation', 'Xem bản dịch tiếng Việt')}" aria-label="${guidedText('Show Vietnamese translation', 'Xem bản dịch tiếng Việt')}">
                        <span aria-hidden="true">?</span>
                    </button>
                </div>
                <div class="essay-guided-vocab-example">
                    <span class="essay-guided-vocab-example-label">📝 ${guidedText('Essay Example:', 'Ví dụ trong bài:')}</span>
                    <p class="essay-guided-vocab-example-text">"${escapeHtml(vocabInfo.en)}"</p>
                </div>
                ${isViOpen ? `
                <div class="essay-guided-vocab-vi-box">
                    <span class="essay-guided-vocab-vi-label">🇻🇳 ${guidedText('Vietnamese:', 'Dịch nghĩa & ngữ cảnh:')}</span>
                    <p class="essay-guided-vocab-vi-text">${escapeHtml(vocabInfo.vi)}</p>
                </div>` : ''}
            </div>`;
        }).join('')}</div>` : '';

        // 2. Collocations with Contextual Usage & <?> Vietnamese Toggle
        const collocations = kit.collocations || [];
        const colloHtml = collocations.length ? `<div class="essay-guided-collo-grid">${collocations.map(item => {
            const info = getCollocationInfo(item, currentEntry, guidedLevel);
            const isColloViOpen = guidedExpandedColloViIds.has(item.term) || guidedLanguage === 'vi';
            return `<div class="essay-guided-collo-card">
                <div class="essay-guided-collo-head">
                    <div class="essay-guided-collo-title-wrap">
                        <strong class="essay-guided-collo-term">${escapeHtml(item.term)}</strong>
                        <span class="essay-guided-collo-meaning">${escapeHtml(info.meaning)}</span>
                    </div>
                    <button type="button" class="essay-guided-vocab-vi-toggle${isColloViOpen ? ' is-open' : ''}" data-guided-action="toggle-collo-vi" data-term="${escapeHtml(item.term)}" title="${guidedText('Show Vietnamese translation', 'Xem bản dịch tiếng Việt')}" aria-label="${guidedText('Show Vietnamese translation', 'Xem bản dịch tiếng Việt')}">
                        <span aria-hidden="true">?</span>
                    </button>
                </div>
                <p class="essay-guided-collo-example">📝 <em>"${escapeHtml(info.example)}"</em></p>
                ${isColloViOpen ? `
                <div class="essay-guided-collo-vi-box">
                    <p class="essay-guided-collo-vi-text">🇻🇳 <em>"${escapeHtml(info.exampleVi)}"</em></p>
                </div>` : ''}
            </div>`;
        }).join('')}</div>` : '';

        // 3. Sentence Pattern Workbench with Slot-Filling Demo
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

        const grammarHtml = `
        <div class="essay-guided-pattern-workbench">
            <div class="essay-guided-pattern-purpose">
                <strong>🎯 ${guidedText('How to use in your essay:', 'Mục đích & Cách sử dụng:')}</strong>
                <span>${guidedText(
                    'Use this pattern in your Introduction (Sentence 2) to state a balanced thesis, or in Body 2 to concede a counter-argument before defending your stance.',
                    'Dùng cấu trúc này ở Mở bài (Câu 2) để nêu luận đề cân bằng, hoặc ở Thân bài 2 để thừa nhận góc nhìn đối lập trước khi bảo vệ lập trường của bạn.'
                )}</span>
            </div>
            <div class="essay-guided-pattern-formula-card">
                <span class="essay-guided-pattern-badge">📐 ${guidedText('Complex Sentence Formula', 'Công thức câu phức')}</span>
                <code class="essay-guided-pattern-code">Although [Concession X], I believe [Your Stance Y] because [Reason Z].</code>
            </div>
            <div class="essay-guided-pattern-applied-card">
                <span class="essay-guided-pattern-badge">✍️ ${guidedText('Concrete Application for this Essay', 'Áp dụng thực tế cho bài viết này')}</span>
                <p class="essay-guided-pattern-sentence">"${escapeHtml(appliedPattern)}"</p>
            </div>
        </div>`;

        // 4. Cohesive Linking Words by Essay Writing Stages
        const linkingStages = [
            {
                badgeEn: 'Stage 1 · Body 1 Opener',
                badgeVi: 'Bước 1 · Mở đoạn Thân bài 1',
                words: ['To begin with', 'First and foremost'],
                purposeEn: 'Introduce your first selected main point in Body 1.',
                purposeVi: 'Mở đầu Thân bài 1 và giới thiệu Luận điểm 1 đã chọn.',
                example: `To begin with, ${cleanArgumentClaim(body1Point || 'rigid educational frameworks frequently suppress curiosity').toLowerCase()}.`
            },
            {
                badgeEn: 'Stage 2 · Elaboration & Mechanism',
                badgeVi: 'Bước 2 · Phân tích lý do / cơ chế',
                words: ['Specifically', 'In other words'],
                purposeEn: 'Explain why or how this phenomenon occurs in detail.',
                purposeVi: 'Giải thích chi tiết tại sao hiện tượng/vấn đề này lại xảy ra.',
                example: 'Specifically, when schools enforce rote memorization, students lose intrinsic motivation to explore independently.'
            },
            {
                badgeEn: 'Stage 3 · Real-World Evidence',
                badgeVi: 'Bước 3 · Đưa dẫn chứng thực tế',
                words: ['For instance', 'A clear illustration is'],
                purposeEn: 'Provide concrete empirical evidence or examples.',
                purposeVi: 'Cung cấp dẫn chứng hoặc ví dụ thực tế minh họa cho luận điểm.',
                example: 'For instance, students who focus only on standardized tests often struggle with practical creative problem solving.'
            },
            {
                badgeEn: 'Stage 4 · Consequence & Impact',
                badgeVi: 'Bước 4 · Nêu hệ quả & Kết nối',
                words: ['Consequently', 'As a result'],
                purposeEn: 'State the direct consequence connecting back to your thesis.',
                purposeVi: 'Nêu hệ quả trực tiếp và liên kết chặt chẽ trở lại luận đề.',
                example: 'Consequently, excessive curriculum rigidity diminishes natural intellectual curiosity.'
            },
            {
                badgeEn: 'Stage 5 · Body 2 Transition',
                badgeVi: 'Bước 5 · Chuyển tiếp sang Thân bài 2',
                words: ['Furthermore', 'In addition'],
                purposeEn: 'Transition smoothly to your second main argument in Body 2.',
                purposeVi: 'Chuyển ý mượt mà sang Luận điểm 2 ở Thân bài 2.',
                example: `Furthermore, ${cleanArgumentClaim(body2Point || 'structured schooling provides essential collaborative skills').toLowerCase()}.`
            },
            {
                badgeEn: 'Stage 6 · Conclusion Synthesis',
                badgeVi: 'Bước 6 · Khẳng định lại ở Kết bài',
                words: ['In conclusion', 'To recapitulate'],
                purposeEn: 'Reaffirm your position with finality in the conclusion.',
                purposeVi: 'Tóm lược và khẳng định lại lập trường ở đoạn kết bài.',
                example: 'In conclusion, having examined both viewpoints, I firmly maintain that a balanced educational approach is vital.'
            }
        ];

        const cohesionHtml = `
        <div class="essay-guided-cohesion-stages">
            <p class="essay-guided-cohesion-intro">
                🔗 ${guidedText(
                    'Step-by-step cohesive transitions mapped to your chosen main points and essay paragraphs:',
                    'Hệ thống từ nối theo từng giai đoạn viết đoạn văn, liên kết trực tiếp với các luận điểm bạn đã chọn:'
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
                        <span class="essay-guided-cohesion-demo-label">📝 ${guidedText('Sentence in Action:', 'Câu mẫu áp dụng:')}</span>
                        <p class="essay-guided-cohesion-demo-text">"${escapeHtml(stage.example)}"</p>
                    </div>
                </div>`).join('')}
            </div>
        </div>`;

        const used = guidedSelectedTargetIds.length;
        return `<section class="essay-guided-section">
            ${guidedSectionHead(section, guidedText('Select vocabulary with level-adapted examples, contextual collocations, and paragraph-by-paragraph cohesive linking words.', 'Chọn từ vựng theo trình độ, các cụm từ học thuật và hệ thống từ nối liên kết trực tiếp với dàn bài của bạn.'))}
            <div class="essay-guided-meter${used >= GUIDED_MAX_TARGETS ? ' is-full' : ''}">
                <span>${guidedText('Targets selected for your checklist', 'Từ vựng mục tiêu đã chọn (hiển thị trong checklist)')}</span>
                <strong>${used}/${GUIDED_MAX_TARGETS}</strong>
            </div>
            ${guidedGroup('vocabulary', guidedText('Core Vocabulary with Context Examples', 'Từ vựng cốt lõi & Ví dụ theo trình độ'), vocabHtml, { count: vocabulary.length, defaultOpen: true })}
            ${guidedGroup('collocations', guidedText('Collocations & Academic Usage', 'Cụm từ đi kèm & Cách dùng học thuật'), colloHtml, { count: collocations.length, defaultOpen: true })}
            ${guidedGroup('grammar', guidedText('Complex Sentence Pattern Workbench', 'Mẫu câu phức học thuật & Cách áp dụng'), grammarHtml, { count: 1, defaultOpen: true })}
            ${guidedGroup('cohesion', guidedText('Cohesive Linking Words by Paragraph Stage', 'Từ nối mạch lạc theo từng giai đoạn thân bài'), cohesionHtml, { count: linkingStages.length, defaultOpen: true })}
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
        const rows = [
            { label: guidedText('Thesis Statement', 'Câu luận đề (Thesis)'), text: naturalThesis },
            { label: guidedText('Body 1 (Main Point 1)', 'Thân bài 1 (Luận điểm 1)'), text: cleanArgumentClaim(body1Text) },
            { label: guidedText('Body 2 (Main Point 2)', 'Thân bài 2 (Luận điểm 2)'), text: cleanArgumentClaim(body2Text) },
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
                <span class="essay-guided-reveal-label">✏️ ${guidedText('Interactive Sentence Builder (Type in the blanks):', 'Tự ghép câu hoàn chỉnh (Gõ trực tiếp vào chỗ trống):')}</span>
                <button type="button" class="essay-guided-ghost-btn" data-guided-action="copy" data-copy-text="${escapeHtml(assembledRaw)}">📋 ${guidedText('Copy Assembled Sentence', 'Sao chép câu hoàn chỉnh')}</button>
            </div>
            ${inputsHtml}
            <div class="essay-guided-frame-assembled">
                <span class="essay-guided-assembled-label">🚀 ${guidedText('Your Sentence in Real Time:', 'Câu bạn đã ghép:')}</span>
                <p class="essay-guided-assembled-text">${previewHtml.trim()}</p>
            </div>
        </div>`;
    }

    function renderGuidedFurther(levelData) {
        const section = GUIDED_SECTIONS[4];
        const activePlan = (levelData.plans || []).find(p => p.variantId === guidedSelectedVariantId) || levelData.plans?.[0] || {};
        const variantId = activePlan.variantId || 'default';
        const allSentences = levelData.scaffolds?.[variantId] || [];
        const depths = [
            { depth: 1, en: '1 · Purpose', vi: 'Mức 1: Mục đích câu' },
            { depth: 2, en: '2 · Fillable Frame', vi: 'Mức 2: Khung câu mẫu' },
            { depth: 3, en: '3 · Full Model', vi: 'Mức 3: Câu hoàn chỉnh mẫu' },
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
        <div class="essay-guided-scaffold-guide">
            <div class="essay-guided-scaffold-guide-head">
                <span class="essay-guided-scaffold-guide-icon" aria-hidden="true">💡</span>
                <strong>${guidedText('How to use Sentence Support progressively:', 'Hướng dẫn 3 bước viết câu hoàn chỉnh:')}</strong>
            </div>
            <ul class="essay-guided-scaffold-guide-steps">
                <li><strong>${guidedText('Level 1 (Purpose):', 'Mức 1 (Mục đích):')}</strong> ${guidedText('Read each sentence goal and write in your own words.', 'Đọc mục đích từng câu và tự diễn đạt bằng từ ngữ của bạn.')}</li>
                <li><strong>${guidedText('Level 2 (Frame):', 'Mức 2 (Khung điền):')}</strong> ${guidedText('Type directly into the blanks below. Your sentences will automatically transfer to your essay draft.', 'Gõ trực tiếp vào các chỗ trống bên dưới. Các câu của bạn sẽ tự động chuyển vào bài viết.')}</li>
                <li><strong>${guidedText('Level 3 (Model):', 'Mức 3 (Câu mẫu):')}</strong> ${guidedText('Review full model sentences to learn natural academic phrasing.', 'Tham khảo câu hoàn chỉnh mẫu chuẩn học thuật.')}</li>
            </ul>
        </div>`;

        const scaffoldTabsHtml = `
        <div class="essay-guided-scaffold-tabs" role="tablist">
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
            <span class="essay-guided-depth-label">${guidedText('Hint level (Adjust how much support you need)', 'Mức độ gợi ý (Điều chỉnh mức trợ giúp bạn cần)')}</span>
            <div class="essay-guided-depth-track" role="group" aria-label="${guidedText('Hint level', 'Mức gợi ý')}">
                ${depths.map(item => `<button type="button" class="${guidedHintDepth === item.depth ? 'is-active' : ''}" data-guided-action="set-depth" data-depth="${item.depth}" aria-pressed="${guidedHintDepth === item.depth ? 'true' : 'false'}">${escapeHtml(guidedText(item.en, item.vi))}</button>`).join('')}
            </div>
        </div>`;

        let currentParagraph = '';
        const cards = visibleSentences.map(sentence => {
            const paragraph = String(sentence.paragraph || '').trim();
            const heading = paragraph && paragraph !== currentParagraph
                ? `<h4 class="essay-guided-paragraph-head">📌 ${escapeHtml(paragraph.toUpperCase())}</h4>`
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
                    <span class="essay-guided-reveal-label">🌟 ${guidedText('Full Model Sentence:', 'Câu hoàn chỉnh mẫu:')}</span>
                    <p class="essay-guided-model-text">${escapeHtml(modelSentence)}</p>
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
                    <button type="button" class="essay-guided-ghost-btn${selected ? ' is-selected' : ''}" data-guided-action="target" data-target-id="${escapeHtml(sId)}" aria-pressed="${selected ? 'true' : 'false'}"${full ? ' disabled' : ''}>${selected ? '✓ ' + guidedText('Target Selected', 'Đã chọn mục tiêu') : '+ ' + guidedText('Track as Target', 'Chọn làm mục tiêu')}</button>
                </div>
            </article>`;
        }).join('');

        return `<section class="essay-guided-section">
            ${guidedSectionHead(section, guidedText('Build your essay sentence-by-sentence. Type directly into the blanks to auto-transfer into your final essay.', 'Xây dựng bài viết theo từng câu. Gõ trực tiếp vào chỗ trống để câu tự động chuyển sang bài viết hoàn chỉnh.'))}
            ${workflowGuideHtml}
            ${scaffoldTabsHtml}
            ${depthSwitch}
            ${cards || `<p class="essay-guided-empty">${guidedText('No scaffold is available for this direction.', 'Hướng này chưa có khung hỗ trợ.')}</p>`}
            <div class="essay-guided-scaffold-footer-cta">
                <button type="button" class="essay-guided-stepnav-btn is-primary" data-guided-action="focus-editor">
                    🚀 ${guidedText('Start writing & Transfer my sentences →', 'Bắt đầu viết & Chuyển câu đã ghép vào bài →')}
                </button>
            </div>
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
