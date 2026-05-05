/**
 * Write Essay Mode Module (PTE Practice → Writing)
 * Handles the Write Essay practice mode in the learner app
 * Flow: Select prompt → Read prompt → Write essay (textarea, word count) → Submit → Scoring
 *
 * Scoring rubrics (PTE):
 *   Form (0-2): Word count based
 *   Grammar (0-2): AI-assessed via assessWriting Cloud Function
 *   Spelling (0-2): Error count based
 */

(function () {
    'use strict';

    const ESSAY_JSON_PATH = 'database/Write Essay/essay-questions-with-vocab.json';
    const MAX_ESSAY_TIME_SECONDS = 20 * 60; // 20 minutes

    // State
    let entries = [];
    let filteredEntries = [];
    let currentEntryIndex = 0;
    let currentEntry = null;
    let isInitialized = false;
    let hasLoadedEntries = false;
    let loadEntriesPromise = null;
    let isSubmitting = false;

    // Timer state
    let essayTimerId = null;
    let essaySecondsLeft = MAX_ESSAY_TIME_SECONDS;

    // DOM Elements
    const el = {};

    /* ──────────────────────────── INIT ──────────────────────────── */

    function init() {
        if (isInitialized) return;
        cacheElements();
        if (!el.questionSelect) {
            console.warn('[WriteEssay] UI elements not found, skipping init');
            return;
        }
        setupEventListeners();
        loadEntries();
        isInitialized = true;
    }

    function reset() {
        stopTimer();
        isSubmitting = false;
        if (el.practiceArea) el.practiceArea.style.display = 'none';
        if (el.stepWrite) el.stepWrite.style.display = 'none';
        if (el.stepResults) el.stepResults.style.display = 'none';
        if (el.essayInput) { el.essayInput.value = ''; el.essayInput.readOnly = false; }
        if (el.startBtn) el.startBtn.style.display = '';
        if (el.questionSelect) el.questionSelect.disabled = false;
        if (el.backBtn) el.backBtn.disabled = false;
        if (el.nextBtn) el.nextBtn.disabled = false;
        updateWordCount();
    }

    /* ──────────────────────────── DOM CACHE ──────────────────────── */

    function cacheElements() {
        // Question selector
        el.currentQuestionId = document.getElementById('current-question-id-essay');
        el.backBtn = document.getElementById('back-btn-essay');
        el.nextBtn = document.getElementById('next-btn-essay');
        el.questionSelect = document.getElementById('question-select-essay');
        el.totalQuestions = document.getElementById('total-questions-essay');
        el.startBtn = document.getElementById('start-essay-btn');

        // Practice area
        el.practiceArea = document.getElementById('essay-practice-area');

        // Step 1: Write
        el.stepWrite = document.getElementById('essay-step-write');
        el.promptDisplay = document.getElementById('essay-prompt-display');
        el.essayInput = document.getElementById('essay-input');
        el.wordCountDisplay = document.getElementById('essay-word-count');
        el.timerDisplay = document.getElementById('essay-timer');
        el.submitBtn = document.getElementById('essay-submit-btn');

        // Step 2: Results
        el.stepResults = document.getElementById('essay-step-results');
        el.resultsContainer = document.getElementById('essay-results-container');
        el.retryBtn = document.getElementById('essay-retry-btn');
    }

    /* ──────────────────────────── EVENT LISTENERS ────────────────── */

    function setupEventListeners() {
        if (el.backBtn) el.backBtn.addEventListener('click', goToPrevious);
        if (el.nextBtn) el.nextBtn.addEventListener('click', goToNext);
        if (el.questionSelect) el.questionSelect.addEventListener('change', onQuestionSelectChange);
        if (el.startBtn) el.startBtn.addEventListener('click', startPractice);
        if (el.essayInput) el.essayInput.addEventListener('input', updateWordCount);
        if (el.submitBtn) el.submitBtn.addEventListener('click', submitEssay);
        if (el.retryBtn) el.retryBtn.addEventListener('click', retryPractice);
    }

    /* ──────────────────────────── DATA LOADING ───────────────────── */

    async function loadEntries() {
        if (!el.questionSelect) return;
        if (loadEntriesPromise) return loadEntriesPromise;
        if (hasLoadedEntries && entries.length > 0) { applyFilter(); return; }

        const pendingLoad = (async () => {
            el.questionSelect.innerHTML = '<option value="">Loading...</option>';
            try {
                const resp = await fetch(ESSAY_JSON_PATH);
                if (!resp.ok) throw new Error(`JSON not found (${resp.status})`);
                const data = await resp.json();

                entries = data.map(item => ({
                    id: String(item.id).trim(),
                    title: String(item.title || '').trim(),
                    prompt: String(item.prompt || '').trim(),
                    targetVocabulary: item.targetVocabulary || null,
                    sampleResponses: item.sampleResponses || null
                })).filter(e => e.id.length > 0 && e.prompt.length > 0);

                entries.sort((a, b) => {
                    const ia = parseInt(a.id, 10), ib = parseInt(b.id, 10);
                    return (isNaN(ia) || isNaN(ib)) ? a.id.localeCompare(b.id) : ia - ib;
                });

                applyFilter();
                hasLoadedEntries = true;
            } catch (error) {
                hasLoadedEntries = false;
                console.error('[WriteEssay] Error loading entries:', error);
                el.questionSelect.innerHTML = '<option value="">Error loading</option>';
                if (el.totalQuestions) el.totalQuestions.textContent = '0';
            }
        })();

        loadEntriesPromise = pendingLoad;
        try { await pendingLoad; } finally { if (loadEntriesPromise === pendingLoad) loadEntriesPromise = null; }
    }

    /* ──────────────────────────── FILTERS & NAV ──────────────────── */

    function applyFilter() {
        filteredEntries = [...entries];
        updateQuestionSelector();
        if (filteredEntries.length === 0) {
            handleEmptyState();
        } else {
            if (el.startBtn) el.startBtn.disabled = false;
            if (el.questionSelect) el.questionSelect.disabled = false;
            currentEntryIndex = 0;
            selectEntry(currentEntryIndex);
        }
    }

    function handleEmptyState() {
        if (el.questionSelect) { el.questionSelect.innerHTML = '<option value="">No questions</option>'; el.questionSelect.disabled = true; }
        if (el.totalQuestions) el.totalQuestions.textContent = '0';
        if (el.currentQuestionId) el.currentQuestionId.textContent = '-';
        if (el.startBtn) el.startBtn.disabled = true;
        currentEntry = null;
        currentEntryIndex = -1;
        reset();
    }

    function updateQuestionSelector() {
        if (!el.questionSelect || filteredEntries.length === 0) return;
        el.questionSelect.innerHTML = filteredEntries.map((e, i) =>
            `<option value="${i}">${e.id} – ${e.title || 'Essay Prompt'}</option>`
        ).join('');
        if (el.totalQuestions) el.totalQuestions.textContent = filteredEntries.length;
    }

    function onQuestionSelectChange() {
        const i = parseInt(el.questionSelect.value, 10);
        if (!isNaN(i)) selectEntry(i);
    }

    function goToPrevious() { if (currentEntryIndex > 0) selectEntry(currentEntryIndex - 1); }
    function goToNext() { if (currentEntryIndex < filteredEntries.length - 1) selectEntry(currentEntryIndex + 1); }

    function selectEntry(index) {
        if (index < 0 || index >= filteredEntries.length) return;
        currentEntryIndex = index;
        currentEntry = filteredEntries[index];
        if (el.currentQuestionId) el.currentQuestionId.textContent = currentEntry.id;
        if (el.questionSelect) el.questionSelect.value = index;
        reset();

        // Update URL with current question ID (replaceState — no history entry per question)
        if (window.PracticeRouter && currentEntry.id) {
            window.PracticeRouter.replaceRoute('write-essay', currentEntry.id);
        }
    }

    /* ──────────────────────────── PRACTICE FLOW ──────────────────── */

    function startPractice() {
        if (!currentEntry) { alert('Please select a question first'); return; }
        el.practiceArea.style.display = 'block';
        el.stepWrite.style.display = 'block';
        el.stepResults.style.display = 'none';

        // Lock UI
        if (el.startBtn) el.startBtn.style.display = 'none';
        if (el.questionSelect) el.questionSelect.disabled = true;
        if (el.backBtn) el.backBtn.disabled = true;
        if (el.nextBtn) el.nextBtn.disabled = true;

        // Show prompt
        if (el.promptDisplay) {
            el.promptDisplay.innerHTML = `<div class="essay-prompt-text">${escapeHtml(currentEntry.prompt)}</div>`;
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

    /**
     * Score Spelling (0-2) — simple client-side check using misspelled word detection
     */
    function scoreSpelling(text) {
        // Use a simple heuristic: check for common misspelling patterns
        // In production, call LanguageTool or browser spell API
        const words = text.replace(/[^a-zA-Z\s'-]/g, '').split(/\s+/).filter(w => w.length > 0);
        let spellingErrors = 0;

        // Check each word against a simple validation (length, repeated chars)
        for (const word of words) {
            const clean = word.toLowerCase().replace(/['-]/g, '');
            if (clean.length < 2) continue;
            // Detect obvious errors: triple letters, no vowels in long words
            if (/(.)\1\1/.test(clean)) spellingErrors++;
            else if (clean.length > 4 && !/[aeiou]/i.test(clean)) spellingErrors++;
        }

        if (spellingErrors === 0) return { score: 2, detail: 'No spelling errors detected', errors: spellingErrors };
        if (spellingErrors === 1) return { score: 1, detail: '1 spelling error detected', errors: spellingErrors };
        return { score: 0, detail: `${spellingErrors} spelling errors detected`, errors: spellingErrors };
    }

    // Cache the callable function
    let assessWritingFn = null;

    /**
     * Score Grammar (0-2) — calls assessWriting Cloud Function (Gemini 1.5 Flash)
     * Returns a promise
     */
    async function scoreGrammar(text) {
        try {
            if (!assessWritingFn) {
                if (window.__FIREBASE_INTERNAL__ && window.__FIREBASE_INTERNAL__.functions) {
                    const { httpsCallable } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js');
                    assessWritingFn = httpsCallable(window.__FIREBASE_INTERNAL__.functions, 'assessWriting');
                } else if (typeof firebase !== 'undefined' && firebase.functions) {
                    assessWritingFn = firebase.functions().httpsCallable('assessWriting');
                } else {
                    return { score: -1, detail: 'AI grammar check unavailable (Firebase not loaded)', corrections: [] };
                }
            }

            const result = await assessWritingFn({
                text: text.substring(0, 2000), // Max 2000 chars
                context: {
                    entryType: 'pte_essay',
                    promptText: currentEntry?.prompt || '',
                }
            });

            if (result.data?.limited) {
                return { score: -1, detail: result.data.message || 'Rate limit reached', corrections: [] };
            }

            if (!result.data?.success) {
                return { score: -1, detail: 'AI analysis failed', corrections: [] };
            }

            // Extract grammar corrections
            const corrections = (result.data.corrections || []).filter(c =>
                c.type === 'grammar' || c.type === 'punctuation'
            );
            const grammarCount = corrections.length;

            let score, detail;
            if (grammarCount === 0) {
                score = 2;
                detail = 'Consistent grammatical control. Errors are rare and difficult to spot.';
            } else if (grammarCount <= 2) {
                score = 1;
                detail = 'Relatively high degree of grammatical control. No mistakes which would lead to misunderstandings.';
            } else {
                score = 0;
                detail = 'Contains mainly simple structures and/or several basic mistakes.';
            }

            return {
                score,
                detail,
                corrections,
                aiFeedback: result.data.feedback || '',
                aiScore: result.data.score
            };
        } catch (error) {
            console.error('[WriteEssay] Grammar scoring error:', error);
            return { score: -1, detail: 'AI grammar check failed: ' + (error.message || 'Unknown error'), corrections: [] };
        }
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

        // Lock UI while scoring
        if (el.submitBtn) {
            el.submitBtn.disabled = true;
            el.submitBtn.textContent = '⏳ Scoring with AI…';
        }
        if (el.essayInput) el.essayInput.readOnly = true;

        const formResult = scoreForm(text);
        const spellingResult = scoreSpelling(text);

        // Call the Gemini Cloud Function for grammar scoring
        const grammarResult = await scoreGrammar(text);

        // Display results
        el.stepWrite.style.display = 'none';
        el.stepResults.style.display = 'block';
        displayResults(formResult, grammarResult, spellingResult, text);

        // Restore UI state
        if (el.submitBtn) {
            el.submitBtn.disabled = false;
            el.submitBtn.textContent = 'Submit Essay';
        }
        if (el.essayInput) el.essayInput.readOnly = false;
        isSubmitting = false;
    }

    function displayResults(formResult, grammarResult, spellingResult, text) {
        if (!el.resultsContainer) return;

        const totalMax = 6; // 2+2+2
        const validScores = [formResult, grammarResult, spellingResult].filter(r => r.score >= 0);
        const totalScore = validScores.reduce((sum, r) => sum + r.score, 0);
        const totalPossible = validScores.length * 2;
        const percentage = totalPossible > 0 ? Math.round((totalScore / totalPossible) * 100) : 0;

        const sampleResponses = currentEntry && currentEntry.sampleResponses ? currentEntry.sampleResponses : null;
        const sampleHtml = renderSampleEssays(sampleResponses);

        el.resultsContainer.innerHTML = `
            <div class="essay-results-summary">
                <div class="essay-results-score-circle">
                    <span class="essay-score-number">${totalScore}</span>
                    <span class="essay-score-divider">/</span>
                    <span class="essay-score-total">${totalPossible}</span>
                </div>
                <div class="essay-results-percentage">${percentage}%</div>
            </div>

            <div class="essay-results-breakdown">
                ${renderScoreRow('📏 Form', formResult, 2)}
                ${renderScoreRow('📝 Grammar', grammarResult, 2)}
                ${renderScoreRow('🔤 Spelling', spellingResult, 2)}
            </div>

            ${grammarResult.corrections && grammarResult.corrections.length > 0 ? `
                <div class="essay-corrections">
                    <h4>Grammar & Punctuation Corrections</h4>
                    <ul class="essay-corrections-list">
                        ${grammarResult.corrections.map(c => `
                            <li class="essay-correction-item">
                                <span class="correction-original">${escapeHtml(c.original)}</span>
                                → <span class="correction-replacement">${escapeHtml(c.replacement)}</span>
                                <span class="correction-reason">${escapeHtml(c.reason || '')}</span>
                            </li>
                        `).join('')}
                    </ul>
                </div>
            ` : ''}

            ${grammarResult.aiFeedback ? `
                <div class="essay-ai-feedback">
                    <h4>💡 AI Feedback</h4>
                    <p>${escapeHtml(grammarResult.aiFeedback)}</p>
                </div>
            ` : ''}
        `;

        if (sampleHtml) {
            el.resultsContainer.insertAdjacentHTML('beforeend', sampleHtml);
            initSampleEssaysUI(sampleResponses);
        }
    }

    function renderScoreRow(label, result, maxScore) {
        const score = result.score;
        const isUnavailable = score < 0;
        const badgeClass = isUnavailable ? 'essay-score-na' :
            score === maxScore ? 'essay-score-full' :
                score > 0 ? 'essay-score-partial' : 'essay-score-zero';

        return `
            <div class="essay-score-row">
                <div class="essay-score-label">${label}</div>
                <div class="essay-score-badge ${badgeClass}">
                    ${isUnavailable ? 'N/A' : `${score}/${maxScore}`}
                </div>
                <div class="essay-score-detail">${escapeHtml(result.detail)}</div>
            </div>
        `;
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

    window.WriteEssayMode = {
        init: init,
        reset: reset,
        loadEntries: loadEntries
    };

    // Deep-link support: listen for PracticeRouter question navigation events
    window.addEventListener('practice-route-question', (event) => {
        const { mode, questionId } = event.detail || {};
        if (mode !== 'write-essay' || !questionId) return;
        if (!hasLoadedEntries || filteredEntries.length === 0) return;
        const idx = filteredEntries.findIndex((e) => String(e.id) === String(questionId));
        if (idx >= 0) {
            selectEntry(idx);
        }
    });

})();
