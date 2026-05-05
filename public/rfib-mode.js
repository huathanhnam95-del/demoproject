(function () {
  'use strict';

  const DATA_URL = '/database/RFIB/index.json';
  const REVIEW_METADATA_URL = '/database/RFIB/review-metadata.json';

  const state = {
    initialized: false,
    loadingPromise: null,
    reviewMetadataPromise: null,
    questions: [],
    questionIndexById: new Map(),
    currentQuestionIndex: 0,
    currentQuestion: null,
    currentAttempt: null,
    supportVariant: 'full',
    supportVoice: {
      full: 'male',
      beginner: 'male',
      intermediate: 'male'
    },
    reviewMetadata: {}
  };

  const elements = {};

  function normalizeText(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function normalizeAnswer(value) {
    return normalizeText(value).toLowerCase();
  }

  function formatQuestionId(id) {
    const numeric = Number.parseInt(String(id), 10);
    if (!Number.isFinite(numeric)) return String(id || '');
    return String(numeric).padStart(4, '0');
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function shuffleArray(items) {
    const arr = Array.from(items || []);
    for (let index = arr.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [arr[index], arr[swapIndex]] = [arr[swapIndex], arr[index]];
    }
    return arr;
  }

  function parseParagraphs(answerText) {
    const text = String(answerText || '');
    if (!text) return [];

    return text
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .split(/\n{2,}/)
      .map((paragraph) => {
        const parts = [];
        let cursor = 0;
        let blankIndex = 0;
        let match;
        const blankPattern = /__([^_]+?)__/g;
        while ((match = blankPattern.exec(paragraph)) !== null) {
          const before = paragraph.slice(cursor, match.index);
          if (before) parts.push({ type: 'text', text: before });
          const options = String(match[1] || '')
            .split('/')
            .map((option) => normalizeText(option))
            .filter(Boolean);
          parts.push({
            type: 'blank',
            blankIndex,
            correctAnswer: options[0] || '',
            options
          });
          blankIndex += 1;
          cursor = match.index + match[0].length;
        }
        const after = paragraph.slice(cursor);
        if (after) parts.push({ type: 'text', text: after });
        return {
          rawText: normalizeText(paragraph),
          parts,
          blankCount: blankIndex
        };
      })
      .filter((paragraph) => paragraph.parts.length > 0);
  }

  function cacheElements() {
    elements.panel = document.getElementById('mode-rfib');
    elements.questionSelect = document.getElementById('rfib-question-select');
    elements.currentQuestionId = document.getElementById('rfib-current-question-id');
    elements.totalQuestions = document.getElementById('rfib-total-questions');
    elements.backBtn = document.getElementById('rfib-back-btn');
    elements.nextBtn = document.getElementById('rfib-next-btn');
    elements.clozeView = document.getElementById('rfib-cloze-view');
    elements.fullAudioPlayer = document.getElementById('rfib-full-audio-player');
    elements.fullAudioPlay = document.getElementById('rfib-full-audio-play');
    elements.fullAudioNote = document.getElementById('rfib-full-audio-note');
    elements.fullVoiceToggle = document.getElementById('rfib-full-audio-voice-male');
    elements.supportFullBtn = document.getElementById('rfib-support-full-btn');
    elements.supportBeginnerBtn = document.getElementById('rfib-support-beginner-btn');
    elements.supportIntermediateBtn = document.getElementById('rfib-support-intermediate-btn');
    elements.supportPanel = document.getElementById('rfib-support-panel');
    elements.supportVariant = document.getElementById('rfib-support-variant');
    elements.supportText = document.getElementById('rfib-support-text');
    elements.supportAudio = document.getElementById('rfib-support-audio');
    elements.supportAudioPlayer = document.getElementById('rfib-support-audio-player');
    elements.supportAudioNote = document.getElementById('rfib-support-audio-note');
    elements.checkBtn = document.getElementById('rfib-check-btn');
    elements.retryBtn = document.getElementById('rfib-retry-btn');
    elements.resultBox = document.getElementById('rfib-result-box');
  }

  function setupEventListeners() {
    if (elements.questionSelect) {
      elements.questionSelect.addEventListener('change', () => {
        const nextId = Number.parseInt(elements.questionSelect.value, 10);
        if (Number.isFinite(nextId)) {
          loadQuestionById(nextId, { freshAttempt: true });
        }
      });
    }

    if (elements.backBtn) {
      elements.backBtn.addEventListener('click', () => navigateQuestion(-1));
    }

    if (elements.nextBtn) {
      elements.nextBtn.addEventListener('click', () => navigateQuestion(1));
    }

    if (elements.checkBtn) {
      elements.checkBtn.addEventListener('click', checkAnswers);
    }

    if (elements.retryBtn) {
      elements.retryBtn.addEventListener('click', () => {
        if (!state.currentQuestion) return;
        loadQuestionById(state.currentQuestion.id, { freshAttempt: true });
      });
    }

    if (elements.fullAudioPlay) {
      elements.fullAudioPlay.addEventListener('click', () => playAudio('full'));
    }

    if (elements.supportFullBtn) {
      elements.supportFullBtn.addEventListener('click', () => setSupportVariant('full'));
    }
    if (elements.supportBeginnerBtn) {
      elements.supportBeginnerBtn.addEventListener('click', () => setSupportVariant('beginner'));
    }
    if (elements.supportIntermediateBtn) {
      elements.supportIntermediateBtn.addEventListener('click', () => setSupportVariant('intermediate'));
    }

    if (elements.fullVoiceToggle) {
      elements.fullVoiceToggle.addEventListener('click', (event) => {
        const button = event.target.closest('[data-voice]');
        if (!button) return;
        setVoice('full', button.dataset.voice);
      });
    }
  }

  async function loadData() {
    if (state.loadingPromise) return state.loadingPromise;
    state.loadingPromise = (async () => {
      const response = await fetch(`${DATA_URL}?v=${Date.now()}`);
      if (!response.ok) {
        throw new Error(`Failed to load RFIB data: ${response.status}`);
      }
      const data = await response.json();
      const items = Array.isArray(data?.items) ? data.items : [];
      state.questions = items.slice().sort((a, b) => Number(a.id) - Number(b.id));
      state.questionIndexById = new Map(state.questions.map((question, index) => [Number(question.id), index]));
      if (state.questions.length > 0 && !state.currentQuestion) {
        state.currentQuestionIndex = 0;
        state.currentQuestion = state.questions[0];
      }
      return state.questions;
    })();

    try {
      return await state.loadingPromise;
    } finally {
      state.loadingPromise = null;
    }
  }

  async function loadReviewMetadata() {
    if (state.reviewMetadataPromise) return state.reviewMetadataPromise;
    state.reviewMetadataPromise = (async () => {
      const response = await fetch(`${REVIEW_METADATA_URL}?v=${Date.now()}`);
      if (!response.ok) {
        return {};
      }
      const data = await response.json();
      const items = data?.items && typeof data.items === 'object' ? data.items : {};
      state.reviewMetadata = items;
      return items;
    })();

    try {
      return await state.reviewMetadataPromise;
    } finally {
      state.reviewMetadataPromise = null;
    }
  }

  function getReviewMetadata(questionId) {
    const key = String(questionId);
    return state.reviewMetadata?.[key] || null;
  }

  function getParagraphs(question) {
    if (Array.isArray(question?.paragraphs) && question.paragraphs.length > 0) {
      return question.paragraphs.map((paragraph) => ({
        rawText: normalizeText(paragraph.rawText),
        parts: Array.isArray(paragraph.parts)
          ? paragraph.parts.map((part) => {
            if (part?.type !== 'blank') {
              return { type: 'text', text: normalizeText(part?.text || '') };
            }
            const options = Array.isArray(part.options) ? part.options.map((option) => normalizeText(option)).filter(Boolean) : [];
            return {
              type: 'blank',
              blankIndex: Number(part.blankIndex) || 0,
              correctAnswer: normalizeText(part.correctAnswer || options[0] || ''),
              options
            };
          })
          : []
      }));
    }

    return parseParagraphs(question?.answerText || '');
  }

  function buildAttempt(question) {
    const paragraphs = getParagraphs(question);
    const blanks = [];
    let globalBlankIndex = 0;

    const renderedParagraphs = paragraphs.map((paragraph) => {
      const parts = paragraph.parts.map((part) => {
        if (part.type !== 'blank') {
          return { type: 'text', text: part.text };
        }

        const shuffledOptions = shuffleArray(part.options);
        const displayAnswer = normalizeText(part.correctAnswer || part.options?.[0] || '');
        const blank = {
          index: globalBlankIndex,
          correctAnswer: normalizeAnswer(displayAnswer),
          displayAnswer,
          options: shuffledOptions,
          answer: ''
        };
        blanks.push(blank);
        globalBlankIndex += 1;
        return {
          type: 'blank',
          index: blank.index,
          options: shuffledOptions
        };
      });

      return { rawText: paragraph.rawText, parts };
    });

    return {
      paragraphs: renderedParagraphs,
      blanks
    };
  }

  function renderQuestionSelect() {
    if (!elements.questionSelect) return;
    const options = state.questions.map((question) => {
      const id = formatQuestionId(question.id);
      return `<option value="${escapeHtml(String(question.id))}">${escapeHtml(id)}</option>`;
    }).join('');
    elements.questionSelect.innerHTML = options || '<option value="">No questions</option>';
  }

  function renderAttempt() {
    if (!elements.clozeView || !state.currentQuestion || !state.currentAttempt) return;

    const html = state.currentAttempt.paragraphs.map((paragraph) => {
      const parts = paragraph.parts.map((part) => {
        if (part.type !== 'blank') {
          return `<span class="rfib-text">${escapeHtml(part.text)}</span>`;
        }

        const blank = state.currentAttempt.blanks[part.index];
        const maxOptionLength = Math.max(8, ...(blank?.options || []).map((option) => String(option).length), String(blank?.correctAnswer || '').length);
        const optionHtml = ['<option value="">Choose</option>']
          .concat((blank?.options || []).map((option) => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`))
          .join('');

        return `
          <select
            class="rfib-blank-select"
            data-blank-index="${part.index}"
            style="min-width: ${Math.min(Math.max(maxOptionLength + 2, 10), 22)}ch"
            aria-label="Blank ${part.index + 1}"
          >
            ${optionHtml}
          </select>
        `;
      }).join('');
      return `<p class="rfib-paragraph">${parts}</p>`;
    }).join('');

    elements.clozeView.innerHTML = html;

    elements.clozeView.querySelectorAll('.rfib-blank-select').forEach((select) => {
      const blankIndex = Number.parseInt(select.dataset.blankIndex, 10);
      const existing = state.currentAttempt.blanks[blankIndex];
      if (!existing) return;
      if (existing.answer) {
        select.value = existing.answer;
      }
      select.addEventListener('change', () => {
        existing.answer = normalizeAnswer(select.value);
        select.classList.remove('is-correct', 'is-incorrect');
        if (elements.resultBox) {
          elements.resultBox.innerHTML = '';
          elements.resultBox.classList.remove('is-visible');
        }
      });
    });
  }

  function renderSupportVariantButtons() {
    const buttons = [
      { element: elements.supportFullBtn, variant: 'full' },
      { element: elements.supportBeginnerBtn, variant: 'beginner' },
      { element: elements.supportIntermediateBtn, variant: 'intermediate' }
    ];
    buttons.forEach(({ element, variant }) => {
      if (!element) return;
      element.classList.toggle('is-active', state.supportVariant === variant);
    });
  }

  function getAudioEntry(question, variant) {
    const audio = question?.audio || {};
    if (variant === 'full') return audio.full || null;
    if (variant === 'beginner') return audio.beginner || null;
    if (variant === 'intermediate') return audio.intermediate || null;
    return null;
  }

  function pickAudioFile(entry, preferredVoice = 'male') {
    if (!entry) return null;
    const order = preferredVoice === 'female'
      ? ['female100', 'female80', 'male100', 'male80']
      : ['male100', 'male80', 'female100', 'female80'];
    for (const key of order) {
      if (entry[key]) return entry[key];
    }
    return null;
  }

  function getAvailableVoices(entry, variant) {
    if (!entry) return [];
    if (variant === 'full') {
      return [
        entry.male100 || entry.male80 ? 'male' : null,
        entry.female100 || entry.female80 ? 'female' : null
      ].filter(Boolean);
    }
    return [
      entry.male80 ? 'male' : null,
      entry.female80 ? 'female' : null
    ].filter(Boolean);
  }

  function renderVoiceToggle(container, variant, entry) {
    if (!container) return;
    const voices = getAvailableVoices(entry, variant);
    const activeVoice = voices.includes(state.supportVoice[variant])
      ? state.supportVoice[variant]
      : (voices[0] || 'male');
    state.supportVoice[variant] = activeVoice;

    container.innerHTML = voices.map((voice) => {
      const isActive = voice === activeVoice;
      return `<button type="button" class="rfib-voice-btn${isActive ? ' is-active' : ''}" data-voice="${voice}">${voice === 'male' ? 'Male' : 'Female'}</button>`;
    }).join('');

    container.querySelectorAll('[data-voice]').forEach((button) => {
      button.addEventListener('click', () => {
        setVoice(variant, button.dataset.voice);
      });
    });
  }

  function renderSupportAudio(variant) {
    if (!elements.supportAudio || !elements.supportAudioPlayer || !elements.supportAudioNote) return;

    const question = state.currentQuestion;
    const entry = getAudioEntry(question, variant);
    const textLabel = variant === 'full' ? 'Full version' : `${variant.charAt(0).toUpperCase()}${variant.slice(1)} version`;
    const textToShow = variant === 'full'
      ? normalizeText(question?.fullText || '')
      : normalizeText(question?.[variant === 'beginner' ? 'beginnerText' : 'intermediateText'] || '');

    elements.supportAudioPlayer.pause();

    if (elements.supportVariant) {
      elements.supportVariant.textContent = `${textLabel}${variant === 'full' ? '' : ' support'}`;
    }
    if (elements.supportText) {
      elements.supportText.textContent = textToShow || 'No support text available for this question.';
    }

    if (variant === 'full') {
      elements.supportAudio.innerHTML = '<div class="rfib-audio-empty">Use the original audio bar above for the full passage.</div>';
      elements.supportAudioNote.textContent = 'No separate support audio';
      elements.supportAudioPlayer.pause();
      elements.supportAudioPlayer.removeAttribute('src');
      elements.supportAudioPlayer.load();
      return;
    }

    const fileName = pickAudioFile(entry, state.supportVoice[variant] || 'male');
    if (!fileName) {
      elements.supportAudio.innerHTML = '<div class="rfib-audio-empty">Audio not available.</div>';
      elements.supportAudioNote.textContent = 'Audio not available';
      elements.supportAudioPlayer.pause();
      elements.supportAudioPlayer.removeAttribute('src');
      elements.supportAudioPlayer.load();
      return;
    }

    elements.supportAudio.innerHTML = `
      <div class="rfib-audio-inline">
        <button type="button" class="rfib-inline-play modern-btn modern-btn--play">Play ${textLabel}</button>
        <div class="rfib-voice-toggle rfib-voice-toggle-inline"></div>
      </div>
    `;
    elements.supportAudioNote.textContent = `${textLabel} audio`;

    const inlinePlay = elements.supportAudio.querySelector('.rfib-inline-play');
    const inlineToggle = elements.supportAudio.querySelector('.rfib-voice-toggle-inline');
    renderVoiceToggle(inlineToggle, variant, entry);

    elements.supportAudioPlayer.src = `/database/RFIB/audio/${encodeURIComponent(fileName)}`;
    elements.supportAudioPlayer.dataset.variant = variant;
    elements.supportAudioPlayer.dataset.voice = state.supportVoice[variant] || 'male';

    inlinePlay?.addEventListener('click', async () => {
      try {
        await elements.supportAudioPlayer.play();
      } catch (error) {
        console.error('[RFIB] Failed to play support audio', error);
      }
    });
  }

  function renderFullAudio() {
    if (!elements.fullAudioPlayer || !elements.fullAudioPlay || !elements.fullAudioNote) return;

    const entry = getAudioEntry(state.currentQuestion, 'full');
    const voice = state.supportVoice.full || 'male';
    const fileName = pickAudioFile(entry, voice);
    const voices = getAvailableVoices(entry, 'full');

    elements.fullAudioPlayer.pause();

    if (!fileName) {
      elements.fullAudioPlay.disabled = true;
      elements.fullAudioNote.textContent = 'Audio not available';
      elements.fullVoiceToggle.style.display = 'none';
      elements.fullAudioPlayer.pause();
      elements.fullAudioPlayer.removeAttribute('src');
      elements.fullAudioPlayer.load();
      return;
    }

    elements.fullAudioPlay.disabled = false;
    elements.fullAudioNote.textContent = 'Full passage audio';
    elements.fullAudioPlayer.src = `/database/RFIB/audio/${encodeURIComponent(fileName)}`;
    elements.fullAudioPlayer.dataset.voice = voice;

    if (voices.length > 1) {
      elements.fullVoiceToggle.style.display = 'inline-flex';
      renderVoiceToggle(elements.fullVoiceToggle, 'full', entry);
    } else {
      elements.fullVoiceToggle.style.display = 'none';
    }
  }

  function setVoice(variant, voice) {
    if (!voice) return;
    state.supportVoice[variant] = voice;

    if (variant === 'full') {
      renderFullAudio();
      return;
    }

    if (variant === state.supportVariant) {
      renderSupportAudio(variant);
    }
  }

  function setSupportVariant(variant) {
    state.supportVariant = variant;
    renderSupportVariantButtons();
    renderSupportAudio(variant);
  }

  function clearResultBox() {
    if (!elements.resultBox) return;
    elements.resultBox.innerHTML = '';
    elements.resultBox.classList.remove('is-visible', 'is-error', 'is-success');
  }

  function applyBlankClasses(results) {
    results.forEach((result) => {
      const select = elements.clozeView?.querySelector(`.rfib-blank-select[data-blank-index="${result.index}"]`);
      if (!select) return;
      select.classList.toggle('is-correct', result.isCorrect);
      select.classList.toggle('is-incorrect', !result.isCorrect);
    });
  }

  async function maybeCaptureVocabulary(results) {
    if (!window.VocabularyBook || typeof window.VocabularyBook.handlePracticeCapture !== 'function') return;

    const question = state.currentQuestion;
    if (!question) return;

    const metadata = getReviewMetadata(question.id) || await loadReviewMetadata().then(() => getReviewMetadata(question.id));
    const blockingVocab = Array.isArray(metadata?.blockingVocab) ? metadata.blockingVocab : [];
    const candidateMap = new Map();

    results.forEach((result) => {
      if (result.isCorrect) return;
      const blank = state.currentAttempt?.blanks?.[result.index];
      if (!blank || !blank.correctAnswer) return;
      const word = normalizeText(blank.displayAnswer || blank.correctAnswer || '');
      const key = normalizeAnswer(word);
      if (!key || candidateMap.has(key)) return;
      candidateMap.set(key, {
        key,
        word,
        displayText: word,
        entryType: /\s/.test(word) ? 'phrase' : 'word',
        definition: '',
        example: '',
        sentence: normalizeText(question.fullText || ''),
        allowedModes: /\s/.test(word) ? ['cloze'] : null,
        selectedByDefault: true
      });
    });

    blockingVocab.forEach((entry) => {
      const word = normalizeText(entry?.word || '');
      const key = normalizeAnswer(word);
      if (!word || !key || candidateMap.has(key)) return;
      candidateMap.set(key, {
        key,
        word,
        displayText: word,
        entryType: /\s/.test(word) ? 'phrase' : 'word',
        definition: normalizeText(entry?.contextual_definition || ''),
        example: '',
        sentence: normalizeText(question.fullText || ''),
        allowedModes: /\s/.test(word) ? ['cloze'] : null,
        selectedByDefault: true
      });
    });

    const candidates = Array.from(candidateMap.values());
    if (candidates.length === 0) return;

    await window.VocabularyBook.handlePracticeCapture({
      mode: 'rfib',
      questionId: question.id,
      sentenceText: normalizeText(question.fullText || ''),
      candidates
    });
  }

  function renderCurrentQuestion({ freshAttempt = false } = {}) {
    if (!state.currentQuestion) return;

    if (freshAttempt || !state.currentAttempt) {
      state.currentAttempt = buildAttempt(state.currentQuestion);
    }

    renderQuestionSelect();
    renderAttempt();
    renderSupportVariantButtons();
    renderSupportAudio(state.supportVariant);
    renderFullAudio();
    clearResultBox();

    if (elements.currentQuestionId) {
      elements.currentQuestionId.textContent = formatQuestionId(state.currentQuestion.id);
    }
    if (elements.totalQuestions) {
      elements.totalQuestions.textContent = String(state.questions.length);
    }
    if (elements.questionSelect) {
      elements.questionSelect.value = String(state.currentQuestion.id);
    }
  }

  function updateQuestionButtons() {
    if (!elements.backBtn || !elements.nextBtn || !state.currentQuestion) return;
    const firstIndex = 0;
    const lastIndex = Math.max(0, state.questions.length - 1);
    elements.backBtn.disabled = state.currentQuestionIndex <= firstIndex;
    elements.nextBtn.disabled = state.currentQuestionIndex >= lastIndex;
  }

  async function loadQuestionById(questionId, { freshAttempt = true } = {}) {
    await loadData();
    const numericId = Number.parseInt(String(questionId), 10);
    const nextIndex = state.questionIndexById.get(numericId);
    if (nextIndex === undefined) return;
    state.currentQuestionIndex = nextIndex;
    state.currentQuestion = state.questions[nextIndex];
    if (freshAttempt) {
      state.currentAttempt = buildAttempt(state.currentQuestion);
    }
    renderCurrentQuestion({ freshAttempt: false });
    updateQuestionButtons();

    // Update URL with current question ID (replaceState — no history entry per question)
    if (window.PracticeRouter && state.currentQuestion?.id != null) {
      window.PracticeRouter.replaceRoute('rfib', state.currentQuestion.id);
    }
  }

  async function navigateQuestion(delta) {
    await loadData();
    if (!state.questions.length) return;
    const nextIndex = Math.max(0, Math.min(state.questions.length - 1, state.currentQuestionIndex + delta));
    if (nextIndex === state.currentQuestionIndex) return;
    state.currentQuestionIndex = nextIndex;
    state.currentQuestion = state.questions[nextIndex];
    state.currentAttempt = buildAttempt(state.currentQuestion);
    renderCurrentQuestion({ freshAttempt: false });
    updateQuestionButtons();

    // Update URL with current question ID (replaceState — no history entry per question)
    if (window.PracticeRouter && state.currentQuestion?.id != null) {
      window.PracticeRouter.replaceRoute('rfib', state.currentQuestion.id);
    }
  }

  async function playAudio(variant) {
    const audio = variant === 'full' ? elements.fullAudioPlayer : elements.supportAudioPlayer;
    if (!audio || !audio.src) return;
    try {
      await audio.play();
    } catch (error) {
      console.error('[RFIB] Failed to play audio', error);
    }
  }

  async function checkAnswers() {
    if (!state.currentQuestion || !state.currentAttempt) return;

    const selects = Array.from(elements.clozeView.querySelectorAll('.rfib-blank-select'));
    const answers = state.currentAttempt.blanks.map((blank, index) => {
      const select = selects.find((item) => Number(item.dataset.blankIndex) === index);
      const selectedValue = normalizeAnswer(select?.value || blank.answer || '');
      blank.answer = selectedValue;
      return selectedValue;
    });

    const results = state.currentAttempt.blanks.map((blank, index) => {
      const userAnswer = normalizeAnswer(answers[index]);
      const isCorrect = !!blank.correctAnswer && userAnswer === blank.correctAnswer;
      return {
        index,
        userAnswer,
        correctAnswer: blank.correctAnswer,
        isCorrect
      };
    });

    const total = results.length;
    const correct = results.filter((result) => result.isCorrect).length;
    const isPerfect = total > 0 && correct === total;

    applyBlankClasses(results);

    if (elements.resultBox) {
      const rows = results.map((result) => `
        <div class="rfib-result-row ${result.isCorrect ? 'is-correct' : 'is-incorrect'}">
          <span class="rfib-result-index">Blank ${result.index + 1}</span>
          <span class="rfib-result-value">${result.isCorrect ? 'Correct' : `Answer: ${escapeHtml(result.displayAnswer || result.correctAnswer || '')}`}</span>
        </div>
      `).join('');

      elements.resultBox.innerHTML = `
        <div class="rfib-result-summary ${isPerfect ? 'is-perfect' : 'has-misses'}">
          ${correct}/${total} blanks correct
        </div>
        <div class="rfib-result-details">${rows}</div>
      `;
      elements.resultBox.classList.add('is-visible');
      elements.resultBox.classList.toggle('is-success', isPerfect);
      elements.resultBox.classList.toggle('is-error', !isPerfect);
    }

    if (window.handleDualTrackScoring) {
      await window.handleDualTrackScoring('rfib', state.currentQuestion.id, { answers });
    }

    if (window.recordPracticeAttempt) {
      await window.recordPracticeAttempt(state.currentQuestion.id, isPerfect, 'rfib');
    }

    await maybeCaptureVocabulary(results);
  }

  async function ensureInitialized() {
    if (state.initialized) return;
    cacheElements();
    setupEventListeners();
    state.initialized = true;
  }

  async function activate() {
    try {
      await ensureInitialized();
    } catch (error) {
      console.error('[RFIB] Failed to initialize mode', error);
      if (elements.resultBox) {
        elements.resultBox.classList.add('is-visible', 'is-error');
        elements.resultBox.innerHTML = '<div class="rfib-result-summary has-misses">RFIB data failed to load.</div>';
      }
      window.shopModule?.showAlertModal?.('RFIB mode could not load right now. Please try again.', true);
      return;
    }

    if (!elements.panel) return;

    elements.panel.style.display = 'block';
    elements.panel.classList.add('active');

    try {
      await loadData();
      renderQuestionSelect();
    } catch (error) {
      console.error('[RFIB] Failed to load question data', error);
      if (elements.resultBox) {
        elements.resultBox.classList.add('is-visible', 'is-error');
        elements.resultBox.innerHTML = '<div class="rfib-result-summary has-misses">RFIB data failed to load.</div>';
      }
      return;
    }
    if (!state.currentQuestion && state.questions.length > 0) {
      state.currentQuestionIndex = 0;
      state.currentQuestion = state.questions[0];
      state.currentAttempt = buildAttempt(state.currentQuestion);
    }

    renderCurrentQuestion({ freshAttempt: false });
    updateQuestionButtons();
  }

  function reset() {
    if (elements.fullAudioPlayer) {
      elements.fullAudioPlayer.pause();
    }
    if (elements.supportAudioPlayer) {
      elements.supportAudioPlayer.pause();
    }
  }

  window.RFIBMode = {
    activate,
    reset
  };

  // Deep-link support: listen for PracticeRouter question navigation events
  window.addEventListener('practice-route-question', (event) => {
    const { mode, questionId } = event.detail || {};
    if (mode !== 'rfib' || !questionId) return;
    if (state.questions.length === 0) return;
    loadQuestionById(questionId, { freshAttempt: true });
  });
})();
