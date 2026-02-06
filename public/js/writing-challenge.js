/**
 * Writing Challenge Module
 * Handles the logic for the "Write a sentence" challenge in SRS Review.
 */
export class WritingChallenge {
    constructor(dependencies) {
        this.deps = dependencies;
        this.elements = dependencies.elements;
        this.log = dependencies.log || console;

        this.currentWord = null;
        this.currentPrompt = null;
        this.onCompleteCallback = null;

        this.initEventListeners();
    }

    initEventListeners() {
        const { srsWritingSubmit, srsWritingSkip, srsWritingCloseBtn, srsWritingInput, skipAiToggle, refreshStarterBtn } = this.elements;

        if (srsWritingSubmit) srsWritingSubmit.addEventListener('click', () => this.handleSubmit());
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

    async show(wordObj, userLevel, uniqueId, onComplete) {
        this.currentWord = wordObj;
        this.onCompleteCallback = onComplete;
        this.userLevel = userLevel;

        if (!this.elements.srsWritingModal) {
            this.handleSkip();
            return;
        }

        try {
            // Logic adapted from srs-review.js
            const lemma = wordObj.lemma || wordObj.originalWord;

            // Check POS (filtering logic handled by caller or here? Plan says here is fine)
            // ... (POS Check Logic) ... 
            // Reuse logic from srs-review.js but simplified

            this.elements.srsWritingModal.style.display = 'flex'; // Ensure flex for visibility checks
            document.body.appendChild(this.elements.srsWritingModal);

            // Generate Prompt
            this.currentPrompt = await this.deps.generateWritingPrompt(wordObj, userLevel);

            // Update UI
            if (this.currentPrompt.type === 'multi-option') {
                this.renderSelectionUI(this.currentPrompt.options);
                // Hide input initially
                if (this.elements.srsWritingInput) this.elements.srsWritingInput.parentElement.style.display = 'none';
                if (this.elements.srsWritingSubmit) this.elements.srsWritingSubmit.style.display = 'none';
                if (this.elements.srsWritingPrompt) this.elements.srsWritingPrompt.textContent = this.currentPrompt.prompt;
                // Hide hints initially
                this.toggleHintsVisibility(false);
            } else {
                this.renderWritingUI();
                if (this.elements.srsWritingPrompt) this.elements.srsWritingPrompt.textContent = this.currentPrompt.prompt;
                // Update Starter
                this.updateStarterUI(this.currentPrompt.starter, this.currentPrompt.showStarter);
                // Populate Hints
                this.updateHintsUI(wordObj, this.currentPrompt.usedCollocation);
            }

            // Load Draft
            const draft = this.deps.loadDraft(lemma);
            if (this.elements.srsWritingInput) this.elements.srsWritingInput.value = draft || '';

            // Reset Feedback
            if (this.elements.srsWritingFeedback) {
                this.elements.srsWritingFeedback.textContent = '';
                this.elements.srsWritingFeedback.className = 'srs-writing-feedback';
                this.elements.srsWritingFeedback.style.display = 'none';
            }

            // Show Modal
            requestAnimationFrame(() => {
                this.elements.srsWritingModal.classList.add('visible');
                this.elements.srsWritingModal.style.pointerEvents = 'auto';
            });

            // Focus Input
            setTimeout(() => {
                if (this.elements.srsWritingInput) this.elements.srsWritingInput.focus();
            }, 300);

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
        this.currentPrompt.usedCollocation = option.text;

        // Focus Input
        setTimeout(() => {
            if (this.elements.srsWritingInput) this.elements.srsWritingInput.focus();
        }, 100);
    }

    renderWritingUI() {
        if (this.elements.srsWritingInput) this.elements.srsWritingInput.parentElement.style.display = 'block';
        if (this.elements.srsWritingSubmit) this.elements.srsWritingSubmit.style.display = 'block';
    }

    toggleHintsVisibility(show) {
        // Find hint container if it exists, or just manage visibility of rows
        // For now, updateHintsUI handles the rows explicitly, but we might want to hide the whole block
        const hintContainer = document.querySelector('.srs-writing-hints');
        if (hintContainer) hintContainer.style.display = show ? 'block' : 'none';

        // Also hide/show Scaffolding toggles if needed
    }

    updateHintsUI(wordObj, usedCollo) {
        // ... (Logic from srs-review.js) ...
        const defVal = document.getElementById('hint-def-value');
        if (defVal) defVal.textContent = wordObj.definition || 'No definition';

        // Example
        const exRow = document.getElementById('hint-example');
        const exVal = document.getElementById('hint-example-value');
        if (wordObj.example) {
            if (exVal) exVal.textContent = wordObj.example;
            if (exRow) exRow.style.display = 'flex';
        } else {
            if (exRow) exRow.style.display = 'none';
        }

        // Collocations
        const colloRow = document.getElementById('hint-collocations');
        const colloVal = document.getElementById('hint-collocations-value');
        const collocations = this.deps.getCollocations(wordObj.lemma || wordObj.originalWord, wordObj);

        if (collocations.length > 0 && colloVal) {
            colloVal.innerHTML = collocations.map(c =>
                c === usedCollo ? `<b>${c}</b>` : c
            ).join(', ');
            if (colloRow) colloRow.style.display = 'block';
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
        this.log.debug('Regenerated starter:', newStarter);
    }

    async handleSubmit() {
        if (!this.currentWord) return;
        const sentence = this.elements.srsWritingInput.value.trim();
        const lemma = this.currentWord.lemma || this.currentWord.originalWord;

        // Basic Validation
        if (!sentence) return;

        // Min length check
        if (sentence.split(' ').length < 3) {
            this.showFeedback('Too short! Write a full sentence.', 'error');
            return;
        }

        this.showFeedback('Checking...', 'info');

        // Skip AI check logic (simplified)
        const skipAi = this.elements.skipAiToggle?.checked;

        let feedback = "Saved!";
        let score = 0;

        if (!skipAi && this.deps.assessSentence) {
            // Assess
            try {
                const result = await this.deps.assessSentence(sentence, lemma);
                feedback = result;
                if (result.includes('5/5')) score = 5;
                else if (result.includes('4/5')) score = 4;
            } catch (e) {
                this.log.error('AI Assess failed', e);
            }
        }

        this.showFeedback(feedback, 'success');
        this.deps.triggerConfetti?.();

        if (this.deps.saveUserSentence) {
            this.deps.saveUserSentence(this.currentWord.id || 'unknown', lemma, sentence, feedback);
        }

        if (score > 0) {
            if (this.deps.applyAIScoreToSRS) {
                this.deps.applyAIScoreToSRS(lemma, score);
            }

            // Dual-Track Scoring (Track A: XP, Track B: Writing Prof)
            if (window.handleDualTrackScoring) {
                const accuracy = score / 5;
                // Writing Challenge is inherently "Hard" (2.0)
                window.handleDualTrackScoring('writingChallenge', this.currentWord.id || 'wc', accuracy, 1);
            }
        }

        this.deps.clearDraft?.(lemma);

        setTimeout(() => this.close(), 1500);
    }

    showFeedback(msg, type) {
        if (!this.elements.srsWritingFeedback) return;
        this.elements.srsWritingFeedback.innerHTML = msg;
        this.elements.srsWritingFeedback.className = `srs-writing-feedback ${type}`;
        this.elements.srsWritingFeedback.style.display = 'block';
    }

    handleSkip() {
        this.close();
    }

    close() {
        if (this.elements.srsWritingModal) {
            this.elements.srsWritingModal.classList.remove('visible');
            this.elements.srsWritingModal.style.pointerEvents = 'none';
        }
        // Restore callback
        if (this.onCompleteCallback) {
            this.onCompleteCallback();
            this.onCompleteCallback = null;
        }
    }
}
