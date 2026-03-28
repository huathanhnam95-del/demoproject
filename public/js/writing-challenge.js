/**
 * Writing Challenge Module
 * Handles the logic for the "Write a sentence" challenge in SRS Review.
 */
import {
    buildAssessWritingContext,
    createActiveWritingChallengeContext,
    getWritingChallengeValidationTarget,
    normalizeWritingChallengeOptions
} from './writing-challenge-utils.js';

export class WritingChallenge {
    constructor(dependencies) {
        this.deps = dependencies;
        this.elements = dependencies.elements;
        this.log = dependencies.log || console;

        this.currentWord = null;
        this.currentChallengeItem = null;
        this.currentPrompt = null;
        this.onCompleteCallback = null;
        this.userLevel = 1;
        this.activeRequestId = null;
        this.activeAiRequestId = null;
        this.pendingTimers = new Set();

        this.initEventListeners();
    }

    initEventListeners() {
        const { srsWritingSubmit, srsWritingSkip, srsWritingCloseBtn, srsWritingInput, skipAiToggle, refreshStarterBtn } = this.elements;

        // NEW: AI Check Button (if exists in HTML, or we create it dynamically)
        // Ideally we should inject this button or expect it in the HTML.
        // For now, let's assume we might need to create it if it doesn't exist.
        this.aiCheckBtn = document.getElementById('srs-writing-ai-check');
        if (!this.aiCheckBtn) {
            // Create it if missing (simplest for integration without touching HTML file yet)
            this.createAiCheckButton();
        }

        if (srsWritingSubmit) srsWritingSubmit.addEventListener('click', () => this.handleSubmit());
        if (this.aiCheckBtn) this.aiCheckBtn.addEventListener('click', () => this.handleAiCheck());
        if (srsWritingSkip) srsWritingSkip.addEventListener('click', () => this.handleSkip());
        if (srsWritingCloseBtn) srsWritingCloseBtn.addEventListener('click', () => this.close());

        // Auto-save draft
        if (srsWritingInput) {
            srsWritingInput.addEventListener('input', (e) => {
                if (this.currentWord) {
                    this.deps.saveDraft(this.currentWord.lemma || this.currentWord.originalWord, e.target.value);
                }
            });
        }

        // Toggle AI
        if (skipAiToggle) {
            const savedSkip = localStorage.getItem('SRS_SKIP_AI') === 'true';
            skipAiToggle.checked = savedSkip;
            skipAiToggle.addEventListener('change', (e) => {
                localStorage.setItem('SRS_SKIP_AI', e.target.checked);
            });
        }

        // Refresh Starter
        if (refreshStarterBtn) {
            refreshStarterBtn.addEventListener('click', () => this.regenerateStarter());
        }

        // Click-to-Insert Starter (New Feature)
        const starterVal = document.getElementById('hint-starter-value');
        if (starterVal) {
            starterVal.style.cursor = 'pointer';
            starterVal.title = 'Click to insert into text box';
            starterVal.addEventListener('click', () => {
                if (srsWritingInput && starterVal.textContent && starterVal.textContent !== '-') {
                    const text = starterVal.textContent;
                    // Append or replace? Append is safer usually, or if empty replace.
                    if (!srsWritingInput.value) {
                        srsWritingInput.value = text + ' ';
                    } else {
                        srsWritingInput.value += ' ' + text;
                    }
                    srsWritingInput.focus();
                    // Pulse animation
                    srsWritingInput.style.backgroundColor = '#f0fdf4';
                    setTimeout(() => srsWritingInput.style.backgroundColor = 'white', 300);
                }
            });
        }
    }

    trackTimer(timerId) {
        this.pendingTimers.add(timerId);
        return timerId;
    }

    clearPendingTimers() {
        this.pendingTimers.forEach((timerId) => clearTimeout(timerId));
        this.pendingTimers.clear();
    }

    isActiveRequest(requestId) {
        return Boolean(requestId) && this.activeRequestId === requestId;
    }

    cancelPendingWork() {
        this.clearPendingTimers();
        this.activeAiRequestId = null;
    }

    getDraftKey() {
        return this.currentWord?.lemma || this.currentWord?.originalWord || '';
    }

    getActiveContext() {
        return this.deps.getActiveWritingChallengeContext?.() || null;
    }

    seedActiveContext(challengeItem, contextId) {
        const context = createActiveWritingChallengeContext(challengeItem, contextId);
        this.deps.setActiveWritingChallengeContext?.(context);
        return context;
    }

    patchActiveContext(partial) {
        if (!this.activeRequestId) return null;
        return this.deps.patchActiveWritingChallengeContext?.(this.activeRequestId, partial) || null;
    }

    getValidationTarget() {
        const context = this.getActiveContext();
        return getWritingChallengeValidationTarget(context || {
            wordObj: this.currentWord,
            usedCollocation: this.currentPrompt?.usedCollocation || null,
            validationTarget: this.currentPrompt?.usedCollocation || this.currentWord?.lemma || this.currentWord?.originalWord || ''
        });
    }

    buildAiContext() {
        const context = this.getActiveContext() || createActiveWritingChallengeContext({
            challengeId: this.currentChallengeItem?.challengeId,
            wordKey: this.currentChallengeItem?.wordKey,
            wordObj: this.currentWord
        }, this.activeRequestId);

        return buildAssessWritingContext({
            ...context,
            promptText: this.currentPrompt?.prompt || context.promptText || '',
            usedCollocation: this.currentPrompt?.usedCollocation || context.usedCollocation || null,
            validationTarget: this.getValidationTarget()
        });
    }

    resetFeedbackUI() {
        if (!this.elements.srsWritingFeedback) return;
        this.elements.srsWritingFeedback.textContent = '';
        this.elements.srsWritingFeedback.className = 'srs-writing-feedback';
        this.elements.srsWritingFeedback.style.display = 'none';
    }

    resetModalUI({ preserveDraftField = false } = {}) {
        if (this.elements.srsWritingPrompt) {
            this.elements.srsWritingPrompt.textContent = '';
        }
        this.resetFeedbackUI();
        this.updateStarterUI('', false);
        this.toggleHintsVisibility(false);
        this.updateHintsUI({}, null);

        const posTag = document.getElementById('writing-pos-tag');
        if (posTag) {
            posTag.textContent = '';
            posTag.style.display = 'none';
            posTag.style.color = '';
            posTag.style.backgroundColor = '';
        }

        const optionContainer = document.getElementById('writing-option-container');
        if (optionContainer) {
            optionContainer.innerHTML = '';
            optionContainer.style.display = 'none';
        }

        if (!preserveDraftField && this.elements.srsWritingInput) {
            this.elements.srsWritingInput.value = '';
        }
    }

    setInputModeVisible(visible) {
        if (this.elements.srsWritingInput?.parentElement) {
            this.elements.srsWritingInput.parentElement.style.display = visible ? 'block' : 'none';
        }
        if (this.elements.srsWritingSubmit) {
            this.elements.srsWritingSubmit.style.display = visible ? 'block' : 'none';
        }
        if (this.aiCheckBtn) {
            this.aiCheckBtn.style.display = visible ? 'inline-flex' : 'none';
        }
    }

    async show(challengeItem, userLevel, uniqueId, onComplete) {
        const requestId = uniqueId || `writing_${Date.now()}`;
        this.cancelPendingWork();
        this.activeRequestId = requestId;
        this.currentChallengeItem = challengeItem?.wordObj ? challengeItem : { wordObj: challengeItem };
        this.currentWord = this.currentChallengeItem.wordObj
            ? JSON.parse(JSON.stringify(this.currentChallengeItem.wordObj))
            : null;
        this.currentPrompt = null;
        this.onCompleteCallback = onComplete;
        this.userLevel = userLevel;

        if (!this.elements.srsWritingModal || !this.currentWord) {
            this.handleSkip();
            return;
        }

        try {
            const draftKey = this.getDraftKey();
            const existingContext = this.getActiveContext();
            if (!existingContext || existingContext.contextId !== requestId) {
                this.seedActiveContext(this.currentChallengeItem, requestId);
            } else {
                this.patchActiveContext({
                    status: 'loading',
                    wordObj: { ...this.currentWord },
                    validationTarget: this.currentWord.lemma || this.currentWord.originalWord || ''
                });
            }

            this.resetModalUI({ preserveDraftField: false });

            document.body.appendChild(this.elements.srsWritingModal);

            requestAnimationFrame(() => {
                if (!this.isActiveRequest(requestId)) return;
                this.elements.srsWritingModal.classList.add('visible');
                this.elements.srsWritingModal.style.pointerEvents = 'auto';
            });

            this.currentPrompt = await this.deps.generateWritingPrompt(this.currentWord, userLevel);
            if (!this.isActiveRequest(requestId)) return;

            if (this.currentPrompt.type === 'multi-option') {
                const options = normalizeWritingChallengeOptions(this.currentPrompt.options);
                if (options.length <= 1) {
                    const selected = options[0] || null;
                    const promptText = selected
                        ? `Write a sentence using "${selected.text}".`
                        : this.currentPrompt.prompt;
                    this.currentPrompt = {
                        ...this.currentPrompt,
                        usedCollocation: selected?.text || this.currentPrompt.usedCollocation || null,
                        prompt: promptText,
                        type: 'single-option'
                    };
                    this.renderWritingUI();
                    if (this.elements.srsWritingPrompt) this.elements.srsWritingPrompt.textContent = promptText;
                    this.updateStarterUI(this.currentPrompt.starter, this.currentPrompt.showStarter);
                    this.updateHintsUI(this.currentWord, this.currentPrompt.usedCollocation);
                    this.toggleHintsVisibility(true);
                } else {
                    this.renderSelectionUI(options);
                    this.setInputModeVisible(false);
                    if (this.elements.srsWritingPrompt) this.elements.srsWritingPrompt.textContent = this.currentPrompt.prompt;
                    this.toggleHintsVisibility(false);
                }
            } else {
                const optionContainer = document.getElementById('writing-option-container');
                if (optionContainer) optionContainer.style.display = 'none';

                this.renderWritingUI();
                if (this.elements.srsWritingPrompt) this.elements.srsWritingPrompt.textContent = this.currentPrompt.prompt;
                this.updateStarterUI(this.currentPrompt.starter, this.currentPrompt.showStarter);
                this.updateHintsUI(this.currentWord, this.currentPrompt.usedCollocation);
                this.toggleHintsVisibility(true);
            }

            this.patchActiveContext({
                status: 'ready',
                promptText: this.currentPrompt?.prompt || '',
                promptType: this.currentPrompt?.type || null,
                usedCollocation: this.currentPrompt?.usedCollocation || null,
                starter: this.currentPrompt?.starter || null,
                showStarter: this.currentPrompt?.showStarter === true,
                validationTarget: this.currentPrompt?.usedCollocation || this.currentWord.lemma || this.currentWord.originalWord || ''
            });

            const draft = this.deps.loadDraft(draftKey);
            if (this.elements.srsWritingInput) this.elements.srsWritingInput.value = draft || '';
            this.resetFeedbackUI();

            this.trackTimer(setTimeout(() => {
                if (!this.isActiveRequest(requestId)) return;
                if (this.elements.srsWritingInput && this.elements.srsWritingInput.parentElement?.style.display !== 'none') {
                    this.elements.srsWritingInput.focus();
                }
            }, 300));

        } catch (e) {
            this.log.error('Error showing writing challenge', e);
            this.handleSkip();
        }
    }

    updateStarterUI(starterText, show) {
        const starterEl = document.getElementById('hint-starter-value');
        const starterContainer = document.getElementById('hint-starter');
        if (starterEl) starterEl.textContent = starterText || '-';
        if (starterContainer) starterContainer.style.display = show ? 'flex' : 'none';
    }

    renderSelectionUI(options) {
        // Clear any existing options
        let container = document.getElementById('writing-option-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'writing-option-container';
            container.className = 'writing-option-container';
            // Insert before Input Container
            const inputContainer = this.elements.srsWritingInput?.parentElement;
            if (inputContainer) {
                inputContainer.parentElement.insertBefore(container, inputContainer);
            }
        }

        container.style.display = 'flex';
        container.innerHTML = '';

        options.forEach((opt, idx) => {
            const btn = document.createElement('div'); // Using div for card-like feel
            btn.className = 'writing-option-card';

            const isPTE = opt.source.includes('PTE');
            const icon = isPTE ? '🏆' : '📝';
            const badgeClass = isPTE ? 'badge-pte' : 'badge-common';

            btn.innerHTML = `
                <div class="option-header">
                    <span class="option-icon">${icon}</span>
                    <span class="option-source ${badgeClass}">${opt.source}</span>
                </div>
                <div class="option-text">${opt.text}</div>
            `;

            btn.onclick = () => this.handleOptionSelect(opt);
            container.appendChild(btn);
        });
    }

    handleOptionSelect(option) {
        const container = document.getElementById('writing-option-container');
        if (container) container.style.display = 'none';

        // Update Prompt to reflect choice
        const newPrompt = `Write a sentence using "${option.text}".`;
        if (this.elements.srsWritingPrompt) this.elements.srsWritingPrompt.textContent = newPrompt;

        // Show Input and Hints
        this.renderWritingUI();
        this.toggleHintsVisibility(true);
        this.updateHintsUI(this.currentWord, option.text); // Highlight the chosen one

        // Update current prompt context so feedback knows what to check
        this.currentPrompt = {
            ...this.currentPrompt,
            usedCollocation: option.text,
            prompt: newPrompt
        };
        this.patchActiveContext({
            status: 'ready',
            promptText: newPrompt,
            usedCollocation: option.text,
            validationTarget: option.text
        });

        // Focus Input
        this.trackTimer(setTimeout(() => {
            if (this.elements.srsWritingInput) this.elements.srsWritingInput.focus();
        }, 100));
    }

    renderWritingUI() {
        this.setInputModeVisible(true);
    }

    toggleHintsVisibility(show) {
        // Find hint container if it exists, or just manage visibility of rows
        // For now, updateHintsUI handles the rows explicitly, but we might want to hide the whole block
        const hintContainer = document.querySelector('.srs-writing-hints');
        if (hintContainer) hintContainer.style.display = show ? 'block' : 'none';

        // Also hide/show Scaffolding toggles if needed
    }

    updateHintsUI(wordObj, usedCollo) {
        // Definition
        const defRow = document.getElementById('hint-definition');
        const defVal = document.getElementById('hint-definition-value');
        if (wordObj.definition && defVal) {
            defVal.textContent = wordObj.definition;
            if (defRow) defRow.style.display = 'flex';
        } else {
            if (defRow) defRow.style.display = 'none';
        }

        // Example
        // Example - HIDDEN to prevent duplication with Scaffolding/Main Card
        const exRow = document.getElementById('hint-example');
        if (exRow) exRow.style.display = 'none';

        /* Original Code preserved for reference:
        const exVal = document.getElementById('hint-example-value');
        if (wordObj.example) {
            if (exVal) exVal.textContent = wordObj.example;
            if (exRow) exRow.style.display = 'flex';
        } else {
            if (exRow) exRow.style.display = 'none';
        }
        */

        // Collocations
        const colloRow = document.getElementById('hint-collocations');
        const colloVal = document.getElementById('hint-collocations-value');
        const collocations = this.deps.getCollocations(wordObj.lemma || wordObj.originalWord, wordObj);

        if (collocations.length > 0 && colloVal) {
            const escapeHtml = (s) => String(s)
                .replaceAll('&', '&amp;')
                .replaceAll('<', '&lt;')
                .replaceAll('>', '&gt;')
                .replaceAll('"', '&quot;')
                .replaceAll("'", '&#039;');

            colloVal.innerHTML = collocations.map((c) => {
                const isUsed = usedCollo && String(c).toLowerCase() === String(usedCollo).toLowerCase();
                const cls = isUsed ? 'collocation-pill collocation-pill-used' : 'collocation-pill';
                return `<span class="${cls}">${escapeHtml(c)}</span>`;
            }).join('');
            if (colloRow) colloRow.style.display = 'flex';
        } else {
            if (colloRow) colloRow.style.display = 'none';
        }
    }

    regenerateStarter() {
        if (!this.currentWord) return;

        const lemma = this.currentWord.lemma || this.currentWord.originalWord;
        const userLevel = this.userLevel || 1;
        const collocations = this.deps.getCollocations ? this.deps.getCollocations(lemma, this.currentWord) : [];

        // Helper to pick random item
        const pickRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];

        let newStarter = '';
        const isExpert = userLevel >= 15;

        if (collocations && collocations.length > 0) {
            const collocation = pickRandom(collocations);

            // Collocation-based starter templates
            const collocationStarterTemplates = [
                `I had to ${collocation} when...`,
                `Yesterday, I ${collocation} because...`,
                `My friend ${collocation} and then...`,
                `Sometimes people ${collocation} to...`,
                `Last week, I ${collocation}...`,
                `It's common to ${collocation} when...`
            ];

            if (isExpert) {
                newStarter = ''; // Expert: no starter
            } else {
                newStarter = pickRandom(collocationStarterTemplates);
            }
        } else {
            // Definition-based fallback starters
            const definitionStarterTemplates = [
                `An example of ${lemma} is when...`,
                `I once saw someone ${lemma}...`,
                `${lemma.charAt(0).toUpperCase() + lemma.slice(1)} happened when...`,
                `${lemma.charAt(0).toUpperCase() + lemma.slice(1)} is important because...`
            ];
            newStarter = pickRandom(definitionStarterTemplates);
        }

        this.updateStarterUI(newStarter, !!newStarter);
        this.patchActiveContext({
            starter: newStarter || null,
            showStarter: !!newStarter
        });
        this.log.debug('Regenerated starter:', newStarter);
    }

    async handleSubmit() {
        if (!this.currentWord) return;
        const sentence = this.elements.srsWritingInput.value.trim();
        const draftKey = this.getDraftKey();
        const lemma = draftKey;
        const requestId = this.activeRequestId;

        // Basic Validation
        if (!sentence) return;

        // Min length check
        if (sentence.split(' ').length < 3) {
            this.showFeedback('Too short! Write a full sentence.', 'error');
            return;
        }

        // Must include target word (or the chosen phrase) to count as a valid attempt.
        const validationTarget = this.getValidationTarget();
        const normalize = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9'\s-]/g, ' ').replace(/\s+/g, ' ').trim();
        const normalizedSentence = normalize(sentence);
        const normalizedLemma = normalize(lemma);
        const normalizedPhrase = normalize(validationTarget);

        const containsTarget = (() => {
            if (normalizedPhrase && normalizedSentence.includes(normalizedPhrase)) return true;
            if (!normalizedLemma) return true;
            // Allow simple inflections: plural/3rd-person/past/gerund.
            const escaped = normalizedLemma.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const re = new RegExp(`\\b${escaped}(s|es|ed|ing)?\\b`, 'i');
            return re.test(normalizedSentence);
        })();

        if (!containsTarget) {
            const safeLemma = String(validationTarget || lemma)
                .replaceAll('&', '&amp;')
                .replaceAll('<', '&lt;')
                .replaceAll('>', '&gt;')
                .replaceAll('"', '&quot;')
                .replaceAll("'", '&#039;');
            this.showFeedback(`Make sure your sentence includes "<b>${safeLemma}</b>".`, 'error');
            return;
        }

        this.showFeedback('Checking...', 'info');

        // Skip AI check logic (simplified)
        const skipAi = this.elements.skipAiToggle?.checked;

        let feedback = 'Saved!';
        let score = null;
        let accuracy = null;

        if (!skipAi && this.deps.assessSentence) {
            // Assess
            try {
                const result = await this.deps.assessSentence(sentence, lemma);
                if (!this.isActiveRequest(requestId)) return;
                if (result) {
                    feedback = result;
                    const match = String(result).match(/Score:\s*([1-5])\s*\/\s*5/i) || String(result).match(/\b([1-5])\s*\/\s*5\b/);
                    if (match) {
                        score = Number(match[1]);
                        if (Number.isFinite(score) && score >= 1 && score <= 5) {
                            accuracy = score / 5;
                        } else {
                            score = null;
                        }
                    }
                }
            } catch (e) {
                this.log.error('AI Assess failed', e);
            }
        }

        this.showFeedback(feedback, 'success');
        if (accuracy !== null && accuracy >= 0.8) {
            this.deps.triggerConfetti?.();
        }

        if (this.deps.saveUserSentence) {
            this.deps.saveUserSentence(this.currentWord.id || 'unknown', lemma, sentence, feedback);
        }

        if (score !== null && this.deps.applyAIScoreToSRS) {
            this.deps.applyAIScoreToSRS(lemma, score);
        }

        // Dual-Track Scoring (Track A: XP, Track B: Writing Prof)
        // Always submit a meaningful attempt so users consistently earn XP/coins.
        if (window.handleDualTrackScoring) {
            const contentId = lemma || this.currentWord.id || 'writing_challenge';
            if (accuracy !== null) {
                window.handleDualTrackScoring('writingChallenge', contentId, accuracy, 1);
            } else {
                // Server will fall back to effort-based credit (word count).
                window.handleDualTrackScoring('writingChallenge', contentId, sentence, 1);
            }
        }

        this.deps.clearDraft?.(draftKey);

        // Increased timeout to 4s to allow reading feedback
        this.trackTimer(setTimeout(() => this.close({ reason: 'auto-complete' }), 4000));
    }

    showFeedback(msg, type) {
        if (!this.elements.srsWritingFeedback) return;
        this.elements.srsWritingFeedback.innerHTML = msg;
        this.elements.srsWritingFeedback.className = `srs-writing-feedback ${type}`;
        this.elements.srsWritingFeedback.style.display = 'block';
    }

    handleSkip() {
        this.close({ reason: 'skip' });
    }

    createAiCheckButton() {
        if (!this.elements.srsWritingSubmit) return;

        const btn = document.createElement('button');
        btn.id = 'srs-writing-ai-check';
        btn.className = 'srs-writing-ai-check-btn';
        btn.innerHTML = '✨ AI Check';
        btn.style.cssText = `
            margin-left: 10px;
            background: linear-gradient(135deg, #6366f1, #8b5cf6);
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 8px;
            cursor: pointer;
            font-weight: 600;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            transition: all 0.2s;
        `;

        // Insert after Submit button
        this.elements.srsWritingSubmit.parentNode.insertBefore(btn, this.elements.srsWritingSubmit.nextSibling);
        this.aiCheckBtn = btn;
    }

    async handleAiCheck() {
        const sentence = this.elements.srsWritingInput.value.trim();
        if (!sentence) return;
        const requestId = this.activeRequestId;
        const aiRequestId = `${requestId}:ai:${Date.now()}`;
        this.activeAiRequestId = aiRequestId;

        this.showFeedback('Thinking...', 'info');

        try {
            if (this.deps.assessWriting) {
                const result = await this.deps.assessWriting(sentence, this.buildAiContext());
                if (!this.isActiveRequest(requestId) || this.activeAiRequestId !== aiRequestId) return;

                if (result.limited) {
                    this.showFeedback(result.message, 'warning');
                    if (result.fallback) {
                        this.trackTimer(setTimeout(() => this.checkWithLanguageTool(sentence, aiRequestId, requestId), 1500));
                    }
                } else if (result.success) {
                    this.displayGeminiFeedback(result);
                }
            } else {
                this.checkWithLanguageTool(sentence, aiRequestId, requestId);
            }
        } catch (e) {
            if (!this.isActiveRequest(requestId) || this.activeAiRequestId !== aiRequestId) return;
            this.log.error('AI Check failed completely:', e);
            this.showFeedback('AI Check failed. Trying LanguageTool...', 'warning');
            this.trackTimer(setTimeout(() => this.checkWithLanguageTool(sentence, aiRequestId, requestId), 1000));
        }
    }

    async checkWithLanguageTool(text, aiRequestId = this.activeAiRequestId, requestId = this.activeRequestId) {
        this.showFeedback('Checking grammar...', 'info');
        try {
            const response = await fetch('https://api.languagetool.org/v2/check', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    text: text,
                    language: 'en-US'
                })
            });
            const data = await response.json();
            if (!this.isActiveRequest(requestId) || this.activeAiRequestId !== aiRequestId) return;

            // Format LanguageTool response to look like Gemini response
            const corrections = data.matches.map(m => ({
                original: text.slice(m.offset, m.offset + m.length),
                replacement: m.replacements[0]?.value || '',
                type: m.rule.issueType,
                reason: m.message
            }));

            const result = {
                score: Math.max(0, 100 - (corrections.length * 10)),
                feedback: corrections.length === 0 ? "Looks good!" : `Found ${corrections.length} issues.`,
                corrections: corrections,
                improved_text: null // LanguageTool doesn't give full rewrite easily
            };

            this.displayGeminiFeedback(result);

        } catch (e) {
            if (!this.isActiveRequest(requestId) || this.activeAiRequestId !== aiRequestId) return;
            this.showFeedback('Grammar check unavailable.', 'error');
        }
    }

    displayGeminiFeedback(data) {
        const escapeHtml = (s) => String(s ?? '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#039;');

        let html = `<div class="ai-feedback-result">`;
        html += `<div class="ai-feedback-header">
            <span class="ai-score">Score: ${escapeHtml(data.score)}/100</span>
            <span class="ai-summary">${escapeHtml(data.feedback)}</span>
        </div>`;

        if (data.corrections && data.corrections.length > 0) {
            html += `<ul class="ai-correction-list">`;
            data.corrections.forEach(c => {
                html += `<li>
                    <span class="ai-correction-original">${escapeHtml(c.original)}</span>
                    <span class="ai-correction-arrow">→</span>
                    <span class="ai-correction-replacement">${escapeHtml(c.replacement)}</span>
                    <div class="ai-correction-reason">${escapeHtml(c.reason)}</div>
                </li>`;
            });
            html += `</ul>`;
        } else {
            html += `<div class="ai-perfect-msg">Great job! No errors found.</div>`;
        }

        html += `</div>`;

        this.showFeedback(html, 'ai-result');
        // Add specific class styling for ai-result in CSS or inline here
    }

    close({ reason = 'dismiss' } = {}) {
        this.cancelPendingWork();
        const callback = this.onCompleteCallback;
        const requestId = this.activeRequestId;
        this.onCompleteCallback = null;
        this.deps.clearActiveWritingChallengeContext?.(requestId);
        this.activeRequestId = null;
        this.activeAiRequestId = null;
        this.currentPrompt = null;
        this.currentWord = null;
        this.currentChallengeItem = null;

        if (this.elements.srsWritingModal) {
            this.elements.srsWritingModal.classList.remove('visible');
            this.elements.srsWritingModal.style.pointerEvents = 'none';
        }

        this.resetModalUI({ preserveDraftField: false });
        this.setInputModeVisible(true);

        if (callback) {
            callback(reason);
        }
    }
}
