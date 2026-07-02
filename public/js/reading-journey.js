/**
 * Reading Journey UX Enhancement System (Phase 1-4)
 * Refined & Debugged Version 1.1
 */
import {
  filterOutlinesByTags,
  formatTopicTagLabel,
  normalizeOutlineRecord
} from './reading-journey-topic-utils.js';
import {
  tokenizeStorySnapshot
} from './reading-journey-quiz-utils.js';
import { queueQuizMisses } from './reading-journey-quiz-storage.js';
import { gradeQuizResults } from './reading-journey-quiz-results.js';
import {
  applyClickWordSelection,
  applyEvidenceSelection,
  buildQuizInteractionMarkup,
  buildQuizQuestionMarkup,
  buildQuizResultsMarkup,
  createEmptyAssessmentState,
  ensureAnswerState,
  getCurrentQuizQuestion,
  isQuestionReady,
  normalizeAssessmentToken
} from './reading-journey-assessment.js';

(function () {

  let state = {
    status: 'SETUP', // SETUP, LOADING, READING, CHOICE_PENDING, COMPLETE
    currentBeat: null,
    currentBeatRecorded: false,
    beatNumber: 0,
    title: '',
    transcript: [], // Array of story segments
    choicesMade: [], // History of icons/choices
    level: 'B1',
    assessment: createEmptyAssessmentState()
  };

  let revealState = {
    sentences: [],
    revealed: 0,
    total: 0,
    mode: lsPref('mode', 'manual'),   // 'manual' | 'auto'
    speed: lsPref('speed', 'normal'), // 'slow' | 'normal' | 'fast'
    allDone: false,
    onComplete: null,
    autoTimer: null
  };

  let focusMode = false;
  let highlightEnabled = lsPref('highlight', 'off') === 'on';

  let zenTimer = null;
  function resetZenTimer() {
    const root = document.getElementById('rj-main-container');
    if (!root) return;
    root.classList.remove('rj-zen-mode');
    if (zenTimer) clearTimeout(zenTimer);
    if (state.status === 'READING' || state.status === 'CHOICE_PENDING') {
      zenTimer = setTimeout(() => {
        root.classList.add('rj-zen-mode');
      }, 3000);
    }
  }

  // Activity listeners for Zen Mode
  window.addEventListener('mousemove', resetZenTimer);
  window.addEventListener('keydown', resetZenTimer);
  window.addEventListener('touchstart', resetZenTimer);

  // ── Utils ──────────────────────────────────────────────────────────────────
  function lsPref(key, def) { return localStorage.getItem('rj_' + key) || def; }
  function lsSet(key, val) { localStorage.setItem('rj_' + key, val); }

  function showAlert(msg, show = true) {
    const el = document.getElementById('rj-alert');
    if (!el) return;
    el.textContent = msg;
    el.style.display = show ? 'block' : 'none';
    if (show) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      '\'': '&#39;'
    }[char] || char));
  }

  function resetAssessmentState() {
    state.assessment = createEmptyAssessmentState();
  }

  function getBeatDisplayText(beat) {
    const segment = String(beat?.segment || beat?.content || beat?.text || '').trim();
    const endWrap = String(beat?.endWrap || '').trim();
    return [segment, endWrap].filter(Boolean).join(' ');
  }

  function recordCurrentBeat() {
    if (!state.currentBeat || state.currentBeatRecorded) return;

    const beatText = getBeatDisplayText(state.currentBeat);
    if (beatText) {
      state.transcript.push(beatText);
    }
    state.choicesMade.push(state.currentBeat.icon || '📖');
    state.currentBeatRecorded = true;
    updateTranscriptList();
  }

  function getCurrentStoryText() {
    const fullText = state.transcript.join('\n\n');
    return fullText.trim();
  }

  // ── Initialization ─────────────────────────────────────────────────────────
  window.initReadingJourney = function (root) {
    if (!root) return;
    renderShell(root);
    applyFocusMode(root);
    attachPreReadingListeners(root);
    loadStoryLibrary();
  };

  function renderShell(root) {
    root.innerHTML = `
      <div class="rj-shell" id="rj-shell">
        <header class="rj-header">
          <h1 class="rj-header__logo">Reading Journey</h1>
          <div class="rj-header__actions">
            <button id="rj-dark-toggle" class="rj-icon-btn" title="Toggle Dark/Light">🌙</button>
            <button id="rj-exit-btn" class="rj-btn rj-btn--exit">Exit</button>
          </div>
        </header>

        <main id="rj-main-container" class="rj-main-container">
          <div id="rj-alert" class="rj-alert" style="display:none;"></div>
          
          <section id="rj-setup" class="rj-card rj-setup-card rj-glass">
            <h2 class="rj-card__title">Start your story</h2>
            <div class="rj-form">
              <div class="rj-form-group">
                <label class="rj-label">Interests (comma-separated, up to 8)</label>
                <input type="text" id="rj-interests" class="rj-input" placeholder="ocean, mystery, friendship">
                <div id="rj-tags" class="rj-tag-chips"></div>
              </div>
              <div class="rj-form-actions">
                <button id="rj-suggest-btn" class="rj-btn rj-btn--outline">Suggest</button>
                <div class="rj-level-select">
                  <label class="rj-muted">Level</label>
                  <select id="rj-level" class="rj-select">
                    <option value="A1">A1 — Beginner</option>
                    <option value="A2">A2 — Elementary</option>
                    <option value="B1" selected>B1 — Intermediate</option>
                    <option value="B2">B2 — Upper Int</option>
                    <option value="C1">C1 — Advanced</option>
                  </select>
                </div>
                <button id="rj-start-btn" class="rj-btn rj-btn--primary">Start</button>
              </div>
            </div>
            <p id="rj-setup-hint" class="rj-muted rj-mt-sm">Visit /readingjourney to access this mode.</p>

            <div class="rj-library" id="rj-library">
              <div class="rj-library__divider"></div>
              <h3 class="rj-library__heading">📚 Story Library</h3>
              <p class="rj-muted" style="margin-top:0">Browse and read pre-generated stories</p>
              <div id="rj-library-grid" class="rj-library__grid">
                <div class="rj-muted" style="text-align:center;padding:20px 0">Loading stories...</div>
              </div>
            </div>
          </section>

          <section id="rj-story" class="rj-story-container" style="display:none;">
            <div class="rj-card rj-glass rj-story-header-card">
              <div class="rj-story__header">
                <div class="rj-title-group">
                  <h2 id="rj-story-title" class="rj-title__name">Elena's Legacy Lasagna</h2>
                  <div id="rj-story-meta" class="rj-muted">Beat 1/5 · Level B2</div>
                </div>
                <div class="rj-story__controls">
                  <button id="rj-focus-toggle" class="rj-icon-btn" title="Focus Mode">⬛</button>
                  <button id="rj-highlight-toggle" class="rj-icon-btn ${highlightEnabled ? 'rj-icon-btn--active' : ''}" title="Toggle Highlights">🔆</button>
                  <div class="rj-mode-toggle">
                    <button id="rj-mode-manual" class="rj-mode-btn" type="button">Manual</button>
                    <button id="rj-mode-auto" class="rj-mode-btn" type="button">Auto</button>
                  </div>
                </div>
              </div>

              <div id="rj-progress-wrap" class="rj-progress-wrap">
                <div id="rj-progress-bar" class="rj-progress-bar"></div>
                <div id="rj-progress-dots" class="rj-progress-dots"></div>
              </div>

              <div id="rj-speed-row" class="rj-speed-row" style="display:none;">
                <span class="rj-speed-label">Reading pace</span>
                <div class="rj-speed-btns">
                  <button class="rj-speed-btn" data-speed="slow">Slow</button>
                  <button class="rj-speed-btn" data-speed="normal">Normal</button>
                  <button class="rj-speed-btn" data-speed="fast">Fast</button>
                </div>
              </div>
            </div>

            <div class="rj-canvas rj-card rj-glass" id="rj-canvas">
              <div class="rj-segment" id="rj-segment"></div>
              <div id="rj-choice-wrap" class="rj-choice" style="display:none;">
                <div id="rj-choice-question" class="rj-choice__question"></div>
                <p id="rj-choice-hint" class="rj-choice__hint" style="display:none; color: var(--rj-text-muted); font-size: 0.9em; margin-bottom: 12px;">Select an option below.</p>
                <div id="rj-choice-options" class="rj-choice__options"></div>
              </div>
              <div id="rj-prod-wrap" class="rj-prod" style="display:none;">
                <div id="rj-prod-prompt" class="rj-choice__question"></div>
                <textarea id="rj-prod-input" class="rj-textarea" placeholder="Type your response..."></textarea>
              </div>
            </div>

            <div class="rj-story__footer">
              <p id="rj-hint" class="rj-hint">Revealing story...</p>
              <button id="rj-continue-btn" class="rj-btn rj-btn--lg">Continue →</button>
            </div>
          </section>

          <section id="rj-complete" class="rj-card rj-glass" style="display:none;"></section>
          
          <aside class="rj-transcript" id="rj-transcript-wrap" style="display:none;">
            <h3 class="rj-transcript__title">Story Path</h3>
            <div id="rj-transcript-list" class="rj-transcript__list"></div>
          </aside>
        </main>
      </div>
    `;

    root.classList.add('readingjourney-root');
    root.classList.add('rj-theme-modern');
    if (lsPref('dark', 'off') === 'on') root.classList.add('rj-dark');

    // Load Outfit font for premium UI typography
    if (!document.querySelector('link[href*="Outfit"]')) {
      const fontLink = document.createElement('link');
      fontLink.rel = 'stylesheet';
      fontLink.href = 'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=Lora:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap';
      document.head.appendChild(fontLink);
    }

    syncModeButtons();
  }

  // ── Reveal Logic ───────────────────────────────────────────────────────────
  function clearAutoTimer() {
    if (revealState.autoTimer) {
      clearTimeout(revealState.autoTimer);
      revealState.autoTimer = null;
    }
  }

  function getAutoDelay() {
    // Delay per word in ms
    const speeds = { slow: 400, normal: 250, fast: 100 };
    return speeds[revealState.speed] || 250;
  }

  function revealNextSentence() {
    if (revealState.revealed >= revealState.total) {
      revealState.allDone = true;
      if (typeof revealState.onComplete === 'function') revealState.onComplete();
      return;
    }

    const span = revealState.sentences[revealState.revealed];
    if (span) {
      span.classList.add('rj-word--visible');
    }
    revealState.revealed++;

    if (revealState.revealed >= revealState.total) {
      revealState.allDone = true;
      if (typeof revealState.onComplete === 'function') revealState.onComplete();
      return;
    }

    if (revealState.mode === 'auto') {
      const delay = getAutoDelay();
      revealState.autoTimer = setTimeout(revealNextSentence, delay);
    }
  }

  function skipToFullReveal() {
    clearAutoTimer();
    revealState.sentences.forEach(s => s.classList.add('rj-word--visible'));
    revealState.revealed = revealState.total;
    revealState.allDone = true;
    if (typeof revealState.onComplete === 'function') revealState.onComplete();
  }

  // ── Highlights ──────────────────────────────────────────────────────────────
  function applyHighlightsToSegment(segmentEl, highlights) {
    if (!highlights || !highlights.length) return;

    // We iterate children (words) to safely replace text inside spans
    const sentences = segmentEl.querySelectorAll('.rj-word');
    sentences.forEach(span => {
      let text = span.innerHTML;
      highlights.forEach(term => {
        // Escaping term for regex safety
        const safeTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(${safeTerm})`, 'gi');
        text = text.replace(regex, '<mark class="rj-highlight">$1</mark>');
      });
      span.innerHTML = text;
    });
  }

  function animateHighlights(segmentEl, show) {
    const marks = segmentEl.querySelectorAll('.rj-highlight');
    marks.forEach((m, i) => {
      setTimeout(() => {
        m.classList.toggle('rj-highlight--on', show);
      }, i * 60);
    });
  }

  // ── UI Control / Listeners ──────────────────────────────────────────────────
  function attachPreReadingListeners(root) {
    document.getElementById('rj-dark-toggle')?.addEventListener('click', () => {
      root.classList.toggle('rj-dark');
      const isDark = root.classList.contains('rj-dark');
      lsSet('dark', isDark ? 'on' : 'off');
      document.getElementById('rj-dark-toggle').textContent = isDark ? '☀️' : '🌙';
    });

    document.getElementById('rj-exit-btn')?.addEventListener('click', async () => {
      const confirmed = await window.showCustomConfirm(
        'Exit Reading Journey?',
        'Exit Reading Journey? Progress will be lost.',
        true
      );
      if (confirmed) location.reload();
    });

    document.getElementById('rj-suggest-btn')?.addEventListener('click', async () => {
      const level = document.getElementById('rj-level').value;
      const interestsEl = document.getElementById('rj-interests');
      const tagsWrap = document.getElementById('rj-tags');

      tagsWrap.innerHTML = '<span class="rj-muted">Loading suggestions...</span>';
      try {
        const res = await fetch('/api/reading-journey/suggest-topics', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ level, currentInterests: interestsEl.value })
        });
        const data = await res.json();
        tagsWrap.innerHTML = '';
        (data.topics || []).forEach(topic => {
          const chip = document.createElement('span');
          chip.className = 'rj-tag-chip';
          chip.textContent = topic;
          chip.onclick = () => {
            chip.classList.toggle('rj-tag-chip--selected');
            const selected = Array.from(tagsWrap.querySelectorAll('.rj-tag-chip--selected')).map(c => c.textContent);
            interestsEl.value = selected.join(', ');
          };
          tagsWrap.appendChild(chip);
        });
      } catch (err) {
        tagsWrap.innerHTML = '<span class="rj-alert">Error loading topics</span>';
      }
    });

    document.getElementById('rj-start-btn')?.addEventListener('click', () => startStory());

    document.getElementById('rj-focus-toggle')?.addEventListener('click', () => {
      focusMode = !focusMode;
      applyFocusMode(root);
    });

    document.getElementById('rj-highlight-toggle')?.addEventListener('click', () => {
      highlightEnabled = !highlightEnabled;
      lsSet('highlight', highlightEnabled ? 'on' : 'off');
      const btn = document.getElementById('rj-highlight-toggle');
      btn.classList.toggle('rj-icon-btn--active', highlightEnabled);
      const segEl = document.getElementById('rj-segment');
      if (segEl) animateHighlights(segEl, highlightEnabled);
    });

    document.getElementById('rj-mode-manual')?.addEventListener('click', () => {
      revealState.mode = 'manual';
      lsSet('mode', 'manual');
      syncModeButtons();
      clearAutoTimer();
    });

    document.getElementById('rj-mode-auto')?.addEventListener('click', () => {
      revealState.mode = 'auto';
      lsSet('mode', 'auto');
      syncModeButtons();
      if (!revealState.allDone && revealState.revealed > 0) {
        revealNextSentence();
      }
    });

    document.querySelectorAll('.rj-speed-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        revealState.speed = btn.dataset.speed;
        lsSet('speed', revealState.speed);
        document.querySelectorAll('.rj-speed-btn').forEach(b => b.classList.toggle('rj-speed-btn--active', b === btn));
      });
    });

    document.getElementById('rj-continue-btn')?.addEventListener('click', () => handleContinue());

    window.addEventListener('keydown', (e) => {
      if (state.status === 'READING' || state.status === 'CHOICE_PENDING') {
        if (e.code === 'Space') { e.preventDefault(); handleContinue(); }
        if (e.key === 'h' || e.key === 'H') document.getElementById('rj-highlight-toggle')?.click();
        if (e.key === 'f' || e.key === 'F') document.getElementById('rj-focus-toggle')?.click();
        if (e.key === 'Escape') { focusMode = false; applyFocusMode(root); }
        if (state.status === 'CHOICE_PENDING') {
          if (e.key === '1') selectChoice(0);
          if (e.key === '2') selectChoice(1);
          if (e.key === '3') selectChoice(2);
        }
      }
    });
  }

  function applyFocusMode(root) {
    if (focusMode) root.classList.add('rj-focus');
    else root.classList.remove('rj-focus');
    const btn = document.getElementById('rj-focus-toggle');
    if (btn) btn.textContent = focusMode ? '⊞' : '⬛';
  }

  function syncModeButtons() {
    const isAuto = revealState.mode === 'auto';
    document.getElementById('rj-mode-manual')?.classList.toggle('rj-mode-btn--active', !isAuto);
    document.getElementById('rj-mode-auto')?.classList.toggle('rj-mode-btn--active', isAuto);
    document.getElementById('rj-speed-row').style.display = isAuto ? 'flex' : 'none';
  }

  function updateContinueBtn(allRevealed, shouldEnd) {
    const btn = document.getElementById('rj-continue-btn');
    const hintEl = document.getElementById('rj-hint');
    if (!btn) return;

    if (allRevealed) {
      btn.textContent = shouldEnd ? 'Finish Journey' : 'Continue →';
      btn.classList.add('rj-btn--primary');
      if (hintEl) {
        hintEl.textContent = shouldEnd ? 'Journey complete.' : '';
        hintEl.style.display = shouldEnd ? 'block' : 'none';
      }
    } else {
      btn.textContent = revealState.mode === 'manual' ? 'Tap to reveal' : 'Skip reveal';
      btn.classList.remove('rj-btn--primary');
      if (hintEl) {
        hintEl.textContent = revealState.mode === 'manual' ? 'Tap Continue or press Space to read...' : 'Story unfolding...';
        hintEl.style.display = 'block';
      }
    }
  }

  // ── Core Lifecycle ─────────────────────────────────────────────────────────
  async function startStory() {
    const interests = document.getElementById('rj-interests').value;
    if (!interests.trim()) return showAlert('Enter some interests first!');

    // Convert comma-separated string to array of trimmed keywords
    const keywords = interests.split(',').map(k => k.trim()).filter(Boolean);
    if (keywords.length === 0) return showAlert('Enter some interests first!');

    state.level = document.getElementById('rj-level').value;
    state.status = 'LOADING';
    resetAssessmentState();
    document.getElementById('rj-setup').style.display = 'none';
    const storyView = document.getElementById('rj-story');
    storyView.style.display = 'block';
    storyView.classList.add('rj-skeleton-active');

    try {
      const res = await fetch('/api/reading-journey/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywords, level: state.level })
      });
      const data = await res.json();

      if (!res.ok || !data.beat) {
        throw new Error(data.detail || data.message || 'Setup failed');
      }

      state.title = data.setup?.title || 'Reading Journey';
      state.outlineId = data.setup?.outlineId || '';
      state.beatNumber = 1;
      state.transcript = [];
      state.choicesMade = [];
      state.currentBeatRecorded = false;
      storyView.classList.remove('rj-skeleton-active');
      renderBeat(data.beat);
    } catch (err) {
      console.error(err);
      showAlert('Failed to start story. Try again.');
      document.getElementById('rj-setup').style.display = 'block';
      storyView.style.display = 'none';
    }
  }

  function renderBeat(beat) {
    state.currentBeat = beat;
    state.currentBeatRecorded = false;
    state.beatNumber = Number(beat?.beatNumber) || state.beatNumber || 1;
    state.choiceId = null;
    state.choiceText = '';
    state.status = 'READING';
    revealState.allDone = false;
    revealState.onComplete = onAllSentencesDone;

    const titleEl = document.getElementById('rj-story-title');
    const metaEl = document.getElementById('rj-story-meta');
    const segmentEl = document.getElementById('rj-segment');
    const choiceWrap = document.getElementById('rj-choice-wrap');
    const prodWrap = document.getElementById('rj-prod-wrap');
    const transcriptWrap = document.getElementById('rj-transcript-wrap');

    if (titleEl) titleEl.textContent = state.title;
    if (metaEl) {
      metaEl.textContent = beat.shouldEnd
        ? `Final scene · Level ${state.level}`
        : `Level ${state.level}`;
    }

    // Split text into words for animated reveal
    const rawText = getBeatDisplayText(beat);
    const words = rawText.split(/(\s+)/).filter(Boolean); // Keep spaces
    
    const applyNewText = () => {
      segmentEl.innerHTML = words.map(w => {
        if (!w.trim()) return w; // render space directly without span
        return `<span class="rj-word" data-text="${w.replace(/"/g, '&quot;')}">${w}</span>`;
      }).join('');
      
      segmentEl.classList.remove('rj-fade-out');

      revealState.sentences = Array.from(segmentEl.querySelectorAll('.rj-word'));
      revealState.total = revealState.sentences.length;
      revealState.revealed = 0;

      choiceWrap.style.display = 'none';
      prodWrap.style.display = 'none';
      transcriptWrap.style.display = focusMode ? 'none' : 'block';
      updateContinueBtn(false, beat.shouldEnd);
      updateProgressBar();

      if (revealState.mode === 'auto') {
        revealNextSentence();
      }
    };

    if (segmentEl.innerHTML.trim() !== '') {
      segmentEl.classList.add('rj-fade-out');
      setTimeout(applyNewText, 300);
    } else {
      applyNewText();
    }

    function onAllSentencesDone() {
      state.status = 'CHOICE_PENDING';
      updateContinueBtn(true, beat.shouldEnd);

      applyHighlightsToSegment(segmentEl, beat.highlights);
      if (highlightEnabled) animateHighlights(segmentEl, true);

      if (beat.shouldEnd) {
        return;
      }

      const qType = (beat.questionType || '').toLowerCase();
      if (qType === 'open' || beat.productionPrompt) {
        prodWrap.style.display = 'block';
        prodWrap.classList.add('rj-fadein');
        const productionPromptText = typeof beat.productionPrompt === 'object'
          ? beat.productionPrompt?.question
          : beat.productionPrompt;
        document.getElementById('rj-prod-prompt').textContent = productionPromptText || 'Write your response:';
      } else {
        choiceWrap.style.display = 'block';
        choiceWrap.classList.add('rj-fadein');
        const choiceQuestionText = (typeof beat.choiceQuestion === 'object' ? beat.choiceQuestion?.question : beat.choiceQuestion) || 'How should the story continue?';
        document.getElementById('rj-choice-question').textContent = choiceQuestionText;
        
        const choiceHint = document.getElementById('rj-choice-hint');
        if (choiceHint) choiceHint.style.display = 'block';
        
        const optEl = document.getElementById('rj-choice-options');
        optEl.innerHTML = '';
        const choiceItems = beat.choices || (beat.choiceQuestion?.options) || [];
        choiceItems.forEach((c, i) => {
          const choiceId = c.id || c.choice_id || '';
          const choiceText = c.text || c.label || '';
          const card = document.createElement('div');
          card.className = 'rj-choice-card';
          card.innerHTML = `
            <div class="rj-choice-badge">${String.fromCharCode(65 + i)}</div>
            <div class="rj-choice-text">${choiceText}</div>
          `;
          card.onclick = () => {
            document.querySelectorAll('.rj-choice-card').forEach(x => x.classList.remove('rj-choice-card--selected'));
            card.classList.add('rj-choice-card--selected');
            state.choiceId = choiceId;
            state.choiceText = choiceText;
          };
          optEl.appendChild(card);
        });
      }
      resetZenTimer(); // Ensure Zen Timer starts after reveal is done or choice is pending
    }
    
    // Also start Zen Timer right away for reading phase
    resetZenTimer();
  }

  async function handleContinue() {
    showAlert('', false);
    if (state.status === 'READING') {
      if (revealState.mode === 'auto') skipToFullReveal();
      else revealNextSentence();
      return;
    }

    if (state.status === 'CHOICE_PENDING') {
      if (state.currentBeat?.shouldEnd) {
        showComplete();
        return;
      }

      if (!state.choiceId && !document.getElementById('rj-prod-input').value) {
        return showAlert('Please choose an option or write a response.');
      }
      advanceBeat();
    }
  }

  let isAdvancing = false;
  async function advanceBeat() {
    if (isAdvancing) return;
    
    const storyView = document.getElementById('rj-story');
    storyView.classList.add('rj-skeleton-active');
    isAdvancing = true;

    const payload = {
      outlineId: state.outlineId,
      currentBeatNumber: state.beatNumber,
      path: state.currentBeat?.path || [],
      choiceId: state.choiceId,
      level: state.level,
      productionText: document.getElementById('rj-prod-input').value,
      history: state.transcript
    };

    try {
      const res = await fetch('/api/reading-journey/advance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();

      recordCurrentBeat();

      if (data.isComplete) {
        storyView.classList.remove('rj-skeleton-active');
        isAdvancing = false;
        showComplete();
      } else {
        state.choiceId = null;
        document.getElementById('rj-prod-input').value = '';
        storyView.classList.remove('rj-skeleton-active');
        isAdvancing = false;
        renderBeat(data.beat);
      }
    } catch (err) {
      showAlert('Error advancing story.');
      storyView.classList.remove('rj-skeleton-active');
      isAdvancing = false;
    }
  }

  function updateProgressBar() {
    const bar = document.getElementById('rj-progress-bar');
    const safeBeatNumber = Math.max(1, Math.min(5, Number(state.beatNumber) || 1));
    const pct = (safeBeatNumber / 5) * 100;
    if (bar) bar.style.width = pct + '%';

    document.getElementById('rj-shell').style.setProperty('--rj-accent', getLevelColor(state.level));
  }

  function getLevelColor(lvl) {
    const colors = { A1: '#10b981', A2: '#10b981', B1: '#3b82f6', B2: '#6366f1', C1: '#8b5cf6', C2: '#a855f7' };
    return colors[lvl] || '#3b82f6';
  }

  function updateTranscriptList() {
    const list = document.getElementById('rj-transcript-list');
    list.innerHTML = state.transcript.map((seg, i) => `
      <div class="rj-transcript__item">
        <div class="rj-transcript__beat">Beat ${i + 1}</div>
        <div class="rj-transcript__segment">${seg.substring(0, 100)}...</div>
      </div>
    `).join('');
  }

  function copyCurrentStory() {
    const fullText = getCurrentStoryText();
    if (!fullText || !navigator.clipboard?.writeText) return;
    navigator.clipboard.writeText(fullText).then(() => {
      const note = document.getElementById('rj-complete-note');
      if (note) note.textContent = 'Story copied to clipboard.';
    }).catch(() => {
      const note = document.getElementById('rj-complete-note');
      if (note) note.textContent = 'Could not copy the story on this device.';
    });
  }

  function announceQuizStatus(message) {
    const status = document.getElementById('rj-quiz-status');
    if (status) status.textContent = message || '';
  }

  function handleClickWordSelection(question, token) {
    const answer = ensureAnswerState(state.assessment, question);
    applyClickWordSelection(answer, question, token);
    renderQuizQuestion();
  }

  function handleEvidenceSelection(question, paragraphIndex) {
    const answer = ensureAnswerState(state.assessment, question);
    applyEvidenceSelection(answer, question, paragraphIndex);
    renderQuizQuestion();
  }

  function renderQuizPassage(container, question, answer) {
    const tokenized = state.assessment.tokenizedStory;
    if (!container || !tokenized) return;

    const acceptedSurfaceForms = Array.isArray(question?.target?.acceptedSurfaceForms)
      ? question.target.acceptedSurfaceForms.map((value) => normalizeAssessmentToken(value)).filter(Boolean)
      : [normalizeAssessmentToken(question?.target?.word)];

    tokenized.paragraphs.forEach((paragraph, paragraphIndex) => {
      const paragraphEl = document.createElement('p');
      paragraphEl.className = 'rj-quiz-passage__paragraph';
      if (answer.hintParagraphIndex === paragraphIndex) paragraphEl.classList.add('rj-quiz-passage__paragraph--hint');

      if (question.type === 'tap_evidence') {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'rj-quiz-passage__tap';
        button.dataset.paragraphIndex = String(paragraphIndex);
        if (answer.selectedParagraphIndex === paragraphIndex && answer.correct) {
          button.classList.add('rj-quiz-passage__tap--correct');
        }
        if (answer.selectedParagraphIndex === paragraphIndex && answer.wrongTokenId === `paragraph-${paragraphIndex}`) {
          button.classList.add('rj-quiz-passage__tap--wrong');
        }
        if (answer.resolved && !answer.correct && Number(question?.target?.paragraphIndex) === paragraphIndex) {
          button.classList.add('rj-quiz-passage__tap--correct');
        }
        button.textContent = paragraph.text;
        button.addEventListener('click', () => handleEvidenceSelection(question, paragraphIndex));
        paragraphEl.appendChild(button);
      } else {
        paragraph.tokens.forEach((token, tokenIndex) => {
          const tokenButton = document.createElement('button');
          tokenButton.type = 'button';
          tokenButton.className = 'rj-quiz-token';
          tokenButton.dataset.tokenId = token.id;
          tokenButton.textContent = token.text;

          if (answer.selectedTokenId === token.id && answer.correct) tokenButton.classList.add('rj-quiz-token--correct');
          if (answer.wrongTokenId === token.id) tokenButton.classList.add('rj-quiz-token--wrong');
          if (answer.resolved && !answer.correct && acceptedSurfaceForms.includes(token.normalized)) {
            tokenButton.classList.add('rj-quiz-token--correct');
          }

          tokenButton.addEventListener('click', () => handleClickWordSelection(question, token));
          paragraphEl.appendChild(tokenButton);

          if (tokenIndex < paragraph.tokens.length - 1) {
            paragraphEl.appendChild(document.createTextNode(' '));
          }
        });
      }

      container.appendChild(paragraphEl);
    });
  }

  function renderQuizResults() {
    const completeView = document.getElementById('rj-complete');
    if (!completeView) return;

    completeView.innerHTML = buildQuizResultsMarkup({
      level: state.level,
      results: state.assessment.results,
      reviewWrite: state.assessment.reviewWrite
    });

    document.getElementById('rj-retry-quiz-btn')?.addEventListener('click', () => {
      state.assessment.currentQuestionIndex = 0;
      state.assessment.answers = {};
      state.assessment.results = [];
      state.assessment.reviewWrite = null;
      renderQuizQuestion();
    });
    document.getElementById('rj-next-story-btn')?.addEventListener('click', () => location.reload());
    document.getElementById('rj-copy-btn')?.addEventListener('click', copyCurrentStory);
  }

  function submitAssessmentQuiz() {
    state.assessment.results = gradeQuizResults({
      questions: state.assessment.deck?.questions,
      answers: state.assessment.answers,
      storySnapshot: state.assessment.deck?.storySnapshot
    });
    state.assessment.reviewWrite = queueQuizMisses(state.assessment.results, {
      quizId: state.assessment.deck?.quizId,
      level: state.level,
      storyTitle: state.title
    });
    renderQuizResults();
  }

  function renderQuizQuestion() {
    const completeView = document.getElementById('rj-complete');
    const question = getCurrentQuizQuestion(state.assessment);
    if (!completeView || !question) {
      renderQuizResults();
      return;
    }

    const answer = ensureAnswerState(state.assessment, question);
    if (question.type === 'sequence_events' && (!Array.isArray(answer.order) || answer.order.length === 0)) {
      answer.order = Array.isArray(question.items) ? question.items.map((item) => item.id) : [];
    }

    const questionNumber = state.assessment.currentQuestionIndex + 1;
    const totalQuestions = state.assessment.deck.questions.length;

    completeView.innerHTML = buildQuizQuestionMarkup({
      title: state.title,
      level: state.level,
      question,
      questionNumber,
      totalQuestions,
      answer,
      interactionMarkup: buildQuizInteractionMarkup(question, answer)
    });

    const interaction = document.getElementById('rj-quiz-interaction');
    if (!interaction) return;

    if (question.type === 'click_word_meaning' || question.type === 'tap_evidence') {
      renderQuizPassage(document.getElementById('rj-quiz-passage-body'), question, answer);
    } else if (question.type === 'mcq_main_idea') {
      interaction.querySelectorAll('input[name="rj-quiz-option"]').forEach((input) => {
        input.addEventListener('change', () => {
          answer.selectedOptionId = input.value;
          renderQuizQuestion();
        });
      });
    } else if (question.type === 'short_answer') {
      const input = document.getElementById('rj-quiz-short-answer');
      input?.addEventListener('input', () => {
        answer.text = input.value;
        document.getElementById('rj-quiz-next-btn')?.toggleAttribute('disabled', !isQuestionReady(question, answer));
      });
    } else if (question.type === 'sequence_events') {
      interaction.querySelectorAll('[data-move]').forEach((button) => {
        button.addEventListener('click', () => {
          const itemId = button.getAttribute('data-item-id');
          const direction = button.getAttribute('data-move');
          const currentIndex = answer.order.indexOf(itemId);
          const nextIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
          if (currentIndex < 0 || nextIndex < 0 || nextIndex >= answer.order.length) return;
          const nextOrder = [...answer.order];
          [nextOrder[currentIndex], nextOrder[nextIndex]] = [nextOrder[nextIndex], nextOrder[currentIndex]];
          answer.order = nextOrder;
          renderQuizQuestion();
        });
      });
    }

    document.getElementById('rj-quiz-exit-btn')?.addEventListener('click', () => renderCompletionSummary({ skipped: true }));
    document.getElementById('rj-quiz-next-btn')?.addEventListener('click', () => {
      if (!isQuestionReady(question, answer)) return;
      if (state.assessment.currentQuestionIndex === totalQuestions - 1) {
        submitAssessmentQuiz();
        return;
      }
      state.assessment.currentQuestionIndex += 1;
      renderQuizQuestion();
    });

    announceQuizStatus(answer.feedback || '');
  }

  function renderCompletionSummary({ skipped = false, note = '' } = {}) {
    const completeView = document.getElementById('rj-complete');
    if (!completeView) return;

    const completionNote = note || (skipped
      ? 'Assessment skipped for now. You can come back to it before starting a new story.'
      : 'Check your understanding with a short mix of comprehension and vocabulary questions.');

    completeView.innerHTML = `
      <div class="rj-complete__hero">
        <div class="rj-complete__badge">OK</div>
        <h2>Journey Complete!</h2>
        <p class="rj-muted">You've successfully finished "${escapeHtml(state.title)}"</p>
      </div>

      <div class="rj-report">
        <div class="rj-report__row">
          <span class="rj-report__label">Topic</span>
          <span class="rj-report__val">${escapeHtml(state.title)}</span>
        </div>
        <div class="rj-report__row">
          <span class="rj-report__label">Level</span>
          <span class="rj-report__val">${escapeHtml(state.level)}</span>
        </div>
        <div class="rj-report__row">
          <span class="rj-report__label">Date</span>
          <span class="rj-report__val">${new Date().toLocaleDateString()}</span>
        </div>
      </div>

      <div class="rj-complete__assessment">
        <div>
          <div class="rj-quiz__eyebrow">Reader's Notebook</div>
          <h3 class="rj-complete__assessment-title">Learning check</h3>
          <p id="rj-complete-note" class="rj-muted">${escapeHtml(completionNote)}</p>
        </div>
        <div class="rj-complete__assessment-meta">
          <span class="rj-complete__level">${escapeHtml(state.level)}</span>
          <span class="rj-complete__count">5 quick prompts</span>
        </div>
      </div>

      <div class="rj-path-diagram">
        <div class="rj-path-label">Your Path</div>
        <div class="rj-path-track">
          ${state.choicesMade.map((icon, i) => `
            <div class="rj-path-node">
              <span class="rj-path-icon">${icon}</span>
              <span class="rj-path-beat">Beat ${i + 1}</span>
            </div>
            ${i < state.choicesMade.length - 1 ? '<div class="rj-path-arrow">?</div>' : ''}
          `).join('')}
        </div>
      </div>

      <div class="rj-complete__actions">
        <button class="rj-btn rj-btn--primary" type="button" id="rj-launch-quiz-btn">Check Understanding</button>
        <button class="rj-btn rj-btn--outline" type="button" id="rj-skip-quiz-btn">Skip for now</button>
        <button class="rj-btn rj-btn--outline" type="button" id="rj-copy-btn">Copy Story</button>
        <button class="rj-btn rj-btn--outline" type="button" id="rj-new-journey-btn">New Journey</button>
      </div>
    `;

    document.getElementById('rj-launch-quiz-btn')?.addEventListener('click', () => startAssessmentQuiz());
    document.getElementById('rj-skip-quiz-btn')?.addEventListener('click', () => renderCompletionSummary({ skipped: true }));
    document.getElementById('rj-copy-btn')?.addEventListener('click', copyCurrentStory);
    document.getElementById('rj-new-journey-btn')?.addEventListener('click', () => location.reload());
  }

  async function startAssessmentQuiz() {
    const completeView = document.getElementById('rj-complete');
    if (!completeView || state.assessment.loading) return;

    state.assessment.loading = true;
    completeView.innerHTML = `
      <div class="rj-quiz rj-quiz--loading">
        <div class="rj-complete__hero">
          <div class="rj-complete__badge">OK</div>
          <h2>Preparing your quiz</h2>
          <p class="rj-muted">Pulling key ideas and vocabulary from the story you just finished.</p>
        </div>
      </div>
    `;

    try {
      const res = await fetch('/api/reading-journey/quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outlineId: state.outlineId,
          path: state.currentBeat?.path || [],
          level: state.level
        })
      });
      const data = await res.json();
      if (!res.ok || !Array.isArray(data.questions) || !data.storySnapshot) {
        throw new Error(data?.message || 'Quiz generation failed');
      }

      state.assessment = {
        ...createEmptyAssessmentState(),
        loading: true,
        deck: data,
        tokenizedStory: tokenizeStorySnapshot(data.storySnapshot)
      };
      renderQuizQuestion();
    } catch (err) {
      renderCompletionSummary({ note: 'Could not generate the quiz. You can still copy the story or start a new journey.' });
    } finally {
      state.assessment.loading = false;
    }
  }
  function showComplete() {
    state.status = 'COMPLETE';
    recordCurrentBeat();
    const completeView = document.getElementById('rj-complete');
    document.getElementById('rj-story').style.display = 'none';
    document.getElementById('rj-transcript-wrap').style.display = 'none';
    completeView.style.display = 'block';
    renderCompletionSummary();
  }

  function selectChoice(idx) {
    const cards = document.querySelectorAll('.rj-choice-card');
    if (cards[idx]) cards[idx].click();
  }

  // ── Story Library (Pagination + Topic Filtering) ──────────────────────────
  const STORIES_PER_PAGE = 10;
  let allOutlines = [];
  let filteredOutlines = [];
  let activeFilters = new Set();
  let libraryPage = 1;

  async function loadStoryLibrary() {
    const grid = document.getElementById('rj-library-grid');
    if (!grid) return;

    try {
      const res = await fetch('/api/reading-journey/outlines');
      const data = await res.json();
      allOutlines = (data.outlines || []).map((outline) => normalizeOutlineRecord(outline));

      if (allOutlines.length === 0) {
        grid.innerHTML = '<div class="rj-library__empty">No stories available yet. Create one above!</div>';
        return;
      }

      filteredOutlines = [...allOutlines];
      renderTagFilters();
      renderLibraryPage();
    } catch (err) {
      grid.innerHTML = '<div class="rj-library__empty">Could not load stories.</div>';
    }
  }

  function collectAllTags() {
    const tagSet = new Set();
    allOutlines.forEach(o => (o.topicTags || []).forEach(t => tagSet.add(t)));
    return [...tagSet].sort();
  }

  function renderTagFilters() {
    const library = document.getElementById('rj-library');
    if (!library) return;

    // Remove existing filter bar if any
    const existing = library.querySelector('.rj-filter-bar');
    if (existing) existing.remove();

    const allTags = collectAllTags();
    if (allTags.length === 0) return;

    const bar = document.createElement('div');
    bar.className = 'rj-filter-bar';

    const label = document.createElement('span');
    label.className = 'rj-filter-bar__label';
    label.textContent = 'Filter by topic (match all):';
    bar.appendChild(label);

    const chipWrap = document.createElement('div');
    chipWrap.className = 'rj-filter-bar__chips';

    allTags.forEach(tag => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'rj-filter-chip' + (activeFilters.has(tag) ? ' rj-filter-chip--active' : '');
      chip.textContent = formatTopicTagLabel(tag);
      chip.addEventListener('click', () => toggleTagFilter(tag));
      chipWrap.appendChild(chip);
    });

    bar.appendChild(chipWrap);

    // Insert filter bar before the grid
    const grid = document.getElementById('rj-library-grid');
    library.insertBefore(bar, grid);
  }

  function toggleTagFilter(tag) {
    if (activeFilters.has(tag)) {
      activeFilters.delete(tag);
    } else {
      activeFilters.add(tag);
    }

    // Re-filter outlines
    if (activeFilters.size === 0) {
      filteredOutlines = [...allOutlines];
    } else {
      filteredOutlines = filterOutlinesByTags(allOutlines, [...activeFilters]);
    }

    libraryPage = 1;
    renderTagFilters();
    renderLibraryPage();
  }

  function renderLibraryPage() {
    const grid = document.getElementById('rj-library-grid');
    if (!grid) return;

    const totalPages = Math.max(1, Math.ceil(filteredOutlines.length / STORIES_PER_PAGE));
    if (libraryPage > totalPages) libraryPage = totalPages;

    const start = (libraryPage - 1) * STORIES_PER_PAGE;
    const pageItems = filteredOutlines.slice(start, start + STORIES_PER_PAGE);

    grid.innerHTML = '';

    if (pageItems.length === 0) {
      grid.innerHTML = '<div class="rj-library__empty">No stories match the selected filters.</div>';
      renderPaginationControls(0, 0);
      return;
    }

    pageItems.forEach((outline) => {
      const card = document.createElement('div');
      card.className = 'rj-library-card rj-fadein';
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');

      const levelColors = { A1: '#10b981', A2: '#10b981', B1: '#3b82f6', B2: '#6366f1', C1: '#8b5cf6', C2: '#a855f7' };
      const bgColor = levelColors[outline.level] || '#3b82f6';

      const tagsHtml = (outline.topicTags || []).slice(0, 4)
        .map(t => `<span class="rj-library-card__tag">${formatTopicTagLabel(t)}</span>`)
        .join('');

      card.innerHTML = `
        <div class="rj-library-card__level" style="background:${bgColor}">${outline.level}</div>
        <div class="rj-library-card__body">
          <div class="rj-library-card__title">${outline.title}</div>
          <div class="rj-library-card__tags">${tagsHtml}</div>
        </div>
        <div class="rj-library-card__arrow">→</div>
      `;

      const startLibraryStory = () => {
        const tags = outline.topicTags || [];
        document.getElementById('rj-interests').value = tags.map((tag) => formatTopicTagLabel(tag)).join(', ');
        document.getElementById('rj-level').value = outline.level;
        startStory();
      };

      card.addEventListener('click', startLibraryStory);
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); startLibraryStory(); }
      });

      grid.appendChild(card);
    });

    renderPaginationControls(totalPages, filteredOutlines.length);
  }

  function renderPaginationControls(totalPages, totalItems) {
    const library = document.getElementById('rj-library');
    if (!library) return;

    // Remove existing pagination
    const existing = library.querySelector('.rj-pagination');
    if (existing) existing.remove();

    if (totalPages <= 1) return;

    const nav = document.createElement('div');
    nav.className = 'rj-pagination';

    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = 'rj-pagination__btn';
    prevBtn.textContent = '← Prev';
    prevBtn.disabled = libraryPage <= 1;
    prevBtn.addEventListener('click', () => { libraryPage--; renderLibraryPage(); });

    const info = document.createElement('span');
    info.className = 'rj-pagination__info';
    info.textContent = `Page ${libraryPage} of ${totalPages} (${totalItems} stories)`;

    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'rj-pagination__btn';
    nextBtn.textContent = 'Next →';
    nextBtn.disabled = libraryPage >= totalPages;
    nextBtn.addEventListener('click', () => { libraryPage++; renderLibraryPage(); });

    nav.appendChild(prevBtn);
    nav.appendChild(info);
    nav.appendChild(nextBtn);
    library.appendChild(nav);
  }

})();

