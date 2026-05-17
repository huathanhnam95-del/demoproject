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
    let isSubmitting = false;
    let isAiScoring = false;
    let activeFeedbackRequestId = 0;

    // Last submitted essay snapshot (used for AI scoring + re-rendering)
    let lastSubmittedEssayText = '';
    let lastSubmittedEssayPrompt = '';
    let lastSubmittedEssayWordCount = 0;
    let lastBasicFeedbackHtml = '';
    let lastBasicFeedbackSectionsHtml = '';

    // Cached resources / callables
    let scoreEssayFn = null;
    let rubricTextCache = null;
    let rubricTextPromise = null;
    let authStateRefreshBound = false;

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
        registerAuthStateRefresh();
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
        lastBasicFeedbackHtml = '';
        lastBasicFeedbackSectionsHtml = '';
        if (el.practiceArea) el.practiceArea.style.display = 'none';
        if (el.stepWrite) el.stepWrite.style.display = 'none';
        if (el.stepResults) el.stepResults.style.display = 'none';
        if (el.essayInput) { el.essayInput.value = ''; el.essayInput.readOnly = false; }
        if (el.startBtn) el.startBtn.style.display = '';
        if (el.questionSelect) el.questionSelect.disabled = false;
        if (el.backBtn) el.backBtn.disabled = false;
        if (el.nextBtn) el.nextBtn.disabled = false;
        if (el.resultsContainer) el.resultsContainer.innerHTML = '';
        if (el.resultsTitle) el.resultsTitle.textContent = 'Your Essay Scores';
        if (el.aiScoreHint) { el.aiScoreHint.style.display = 'none'; el.aiScoreHint.innerHTML = ''; }
        if (el.aiScoreBtn) { el.aiScoreBtn.disabled = false; el.aiScoreBtn.textContent = 'Submit to AI scoring'; }
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
        el.resultsTitle = document.getElementById('essay-results-title');
        el.resultsContainer = document.getElementById('essay-results-container');
        el.retryBtn = document.getElementById('essay-retry-btn');
        el.aiScoreBtn = document.getElementById('essay-ai-score-btn');
        el.aiScoreHint = document.getElementById('essay-ai-score-hint');
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
        if (el.aiScoreBtn) el.aiScoreBtn.addEventListener('click', submitToAiScoring);
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
        lastBasicFeedbackHtml = feedbackHtml;

        // Display results
        el.stepWrite.style.display = 'none';
        el.stepResults.style.display = 'block';
        displayFeedbackOnly({ feedbackHtml });

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

    function renderScoreRow(label, result, maxScore) {
        const score = typeof result?.score === 'number' ? result.score : -1;
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
        if (!el.aiScoreBtn) return;
        if (!lastSubmittedEssayText) {
            el.aiScoreBtn.disabled = true;
            return;
        }

        const user = getCurrentUser();
        const allowed = Boolean(user) && !isGuestMode();
        el.aiScoreBtn.disabled = !allowed;

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
        throw new Error('AI scoring unavailable (Firebase functions not loaded)');
    }

    async function submitToAiScoring() {
        if (isAiScoring) return;
        if (!lastSubmittedEssayText) {
            alert('Please submit your essay first.');
            return;
        }

        updateAiScoreButtonState();
        if (el.aiScoreBtn && el.aiScoreBtn.disabled) {
            return;
        }

        isAiScoring = true;
        if (el.aiScoreBtn) {
            el.aiScoreBtn.disabled = true;
            el.aiScoreBtn.textContent = '⏳ AI scoring…';
        }
        if (el.aiScoreHint) el.aiScoreHint.style.display = 'none';

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
            if (data?.limited) {
                alert(data.message || 'AI scoring is limited. Please try again later.');
                return;
            }
            if (!data?.success) {
                throw new Error(data?.message || 'AI scoring failed');
            }

            if (el.resultsTitle) el.resultsTitle.textContent = 'Your Essay Scores';
            displayAiScoreResults(data);

            if (data.teacherAdviceChat) {
                postTeacherAdviceToChat(String(data.teacherAdviceChat));
            }
        } catch (error) {
            console.error('[WriteEssay] scoreEssay failed:', error);
            alert('AI scoring failed. Please try again.');
        } finally {
            isAiScoring = false;
            if (el.aiScoreBtn) {
                el.aiScoreBtn.textContent = 'Submit to AI scoring';
            }
            updateAiScoreButtonState();
        }
    }

    function displayAiScoreResults(data) {
        if (!el.resultsContainer) return;

        const overall = data.overall || {};
        const total = Number(overall.total || 0);
        const maxTotal = Number(overall.maxTotal || 0);
        const percent = Number.isFinite(Number(overall.percent)) ? Number(overall.percent) : (maxTotal > 0 ? Math.round((total / maxTotal) * 100) : 0);

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
            const s = scores[item.key] || {};
            const detailParts = [];
            const rationale = s.rationale || s.detail || '';
            if (rationale) detailParts.push(String(rationale));

            const fixTips = Array.isArray(s.fixTips) ? s.fixTips : [];
            if (fixTips.length > 0) {
                detailParts.push('Fix: ' + fixTips.slice(0, 2).join(' | '));
            }

            const evidence = Array.isArray(s.evidence) ? s.evidence : [];
            if (evidence.length > 0) {
                detailParts.push('Evidence: ' + evidence.slice(0, 1).join(''));
            }

            return renderScoreRow(item.label, {
                score: Number.isFinite(Number(s.score)) ? Number(s.score) : -1,
                detail: detailParts.join(' ')
            }, item.max);
        }).join('');

        const basicFeedbackDetails = lastBasicFeedbackSectionsHtml ? `
            <details class="essay-basic-feedback">
                <summary>Basic feedback (Form/Grammar/Spelling)</summary>
                <div class="essay-basic-feedback-body">
                    ${lastBasicFeedbackSectionsHtml}
                </div>
            </details>
        ` : '';

        el.resultsContainer.innerHTML = `
            ${renderSubmittedEssayBlockHtml({
                essayText: lastSubmittedEssayText,
                promptText: lastSubmittedEssayPrompt,
                wordCount: lastSubmittedEssayWordCount
            })}

            <div class="essay-results-summary">
                <div class="essay-results-score-circle">
                    <span class="essay-score-number">${total}</span>
                    <span class="essay-score-divider">/</span>
                    <span class="essay-score-total">${maxTotal}</span>
                </div>
                <div class="essay-results-percentage">${percent}%</div>
            </div>

            <div class="essay-results-breakdown">
                ${breakdownHtml}
            </div>

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
            if (bubble && typeof bubble.openChat === 'function') {
                bubble.openChat();
            }
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

        const handler = () => {
            render();
        };
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

    window.WriteEssayMode = {
        init: init,
        reset: reset,
        loadEntries: loadEntries,
        updateAiScoreButtonState: updateAiScoreButtonState
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
