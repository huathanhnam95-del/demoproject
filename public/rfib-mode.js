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
    supportVisible: false,
    supportVoice: {
      full: 'male',
      beginner: 'male',
      intermediate: 'male'
    },
    reviewMetadata: {},
    randomMode: localStorage.getItem('pte_random_nav_mode') === 'true',
    navHistory: []
  };

  const elements = {};

  function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  }

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

  /** Convert escaped markdown bold/italic back to HTML after escapeHtml(). */
  function renderMarkdownInline(escaped) {
    return escaped
      .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')  // ***bold-italic***
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')               // **bold**
      .replace(/\*(.+?)\*/g, '<em>$1</em>');                          // *italic*
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
    elements.fullAudioCurrentTime = document.getElementById('rfib-full-audio-current-time');
    elements.fullAudioSlider = document.getElementById('rfib-full-audio-slider');
    elements.fullAudioTotalTime = document.getElementById('rfib-full-audio-total-time');
    elements.supportToggleRow = elements.panel?.querySelector('.rfib-support-toggle-row');
    elements.supportFullBtn = document.getElementById('rfib-support-full-btn');
    elements.supportBeginnerBtn = document.getElementById('rfib-support-beginner-btn');
    elements.supportIntermediateBtn = document.getElementById('rfib-support-intermediate-btn');
    elements.supportPanel = document.getElementById('rfib-support-panel');
    elements.supportVariant = document.getElementById('rfib-support-variant');
    elements.supportText = document.getElementById('rfib-support-text');
    elements.supportAudio = document.getElementById('rfib-support-audio');
    elements.supportAudioPlayer = document.getElementById('rfib-support-audio-player');
    elements.supportAudioNote = document.getElementById('rfib-support-audio-note');
    elements.easyReadingBtn = document.getElementById('rfib-easy-reading-btn');
    elements.checkBtn = document.getElementById('rfib-check-btn');
    elements.retryBtn = document.getElementById('rfib-retry-btn');
    elements.nextQuestionBtn = document.getElementById('rfib-next-question-btn');
    elements.resultBox = document.getElementById('rfib-result-box');
  }

  function updateSupportVisibility() {
    const isVisible = !!state.supportVisible;
    if (elements.supportToggleRow) {
      elements.supportToggleRow.style.display = isVisible ? 'flex' : 'none';
    }
    if (elements.supportPanel) {
      elements.supportPanel.style.display = isVisible ? 'block' : 'none';
    }
  }

  function updateRandomToggleUI() {
    if (!elements.randomToggleBtn) return;
    elements.randomToggleBtn.classList.toggle('is-active', state.randomMode);
    elements.randomToggleBtn.setAttribute('aria-pressed', state.randomMode ? 'true' : 'false');
    elements.randomToggleBtn.textContent = state.randomMode ? '🎲 Random: ON' : '🎲 Random: OFF';
  }

  function setupEventListeners() {
    if (elements.randomToggleBtn) {
      updateRandomToggleUI();
      elements.randomToggleBtn.addEventListener('click', () => {
        state.randomMode = !state.randomMode;
        localStorage.setItem('pte_random_nav_mode', String(state.randomMode));
        updateRandomToggleUI();
      });
    }
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

    if (elements.easyReadingBtn) {
      elements.easyReadingBtn.addEventListener('click', () => {
        state.supportVisible = true;
        if (state.supportVariant === 'full') {
          state.supportVariant = 'beginner';
        }
        renderSupportVariantButtons();
        renderSupportAudio(state.supportVariant);
        updateSupportVisibility();
        if (elements.supportPanel) {
          elements.supportPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      });
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

    if (elements.nextQuestionBtn) {
      elements.nextQuestionBtn.addEventListener('click', () => navigateQuestion(1));
    }

    if (elements.fullAudioPlay && elements.fullAudioPlayer) {
      elements.fullAudioPlay.addEventListener('click', () => {
        if (elements.fullAudioPlayer.paused) {
          playAudio('full');
        } else {
          elements.fullAudioPlayer.pause();
        }
      });

      elements.fullAudioPlayer.addEventListener('play', () => {
        elements.fullAudioPlay.textContent = 'Pause';
        elements.fullAudioPlay.classList.add('is-playing');
      });

      elements.fullAudioPlayer.addEventListener('pause', () => {
        elements.fullAudioPlay.textContent = 'Play';
        elements.fullAudioPlay.classList.remove('is-playing');
      });

      elements.fullAudioPlayer.addEventListener('ended', () => {
        elements.fullAudioPlay.textContent = 'Play';
        elements.fullAudioPlay.classList.remove('is-playing');
        if (elements.fullAudioSlider) elements.fullAudioSlider.value = '0';
        if (elements.fullAudioCurrentTime) elements.fullAudioCurrentTime.textContent = '0:00';
      });

      elements.fullAudioPlayer.addEventListener('timeupdate', () => {
        if (!elements.fullAudioPlayer.duration) return;
        const current = elements.fullAudioPlayer.currentTime;
        const duration = elements.fullAudioPlayer.duration;
        if (elements.fullAudioSlider && !elements.fullAudioSlider.dataset.dragging) {
          elements.fullAudioSlider.value = String((current / duration) * 100);
        }
        if (elements.fullAudioCurrentTime) {
          elements.fullAudioCurrentTime.textContent = formatTime(current);
        }
      });

      const handleDurationUpdate = () => {
        if (elements.fullAudioTotalTime && elements.fullAudioPlayer.duration) {
          elements.fullAudioTotalTime.textContent = formatTime(elements.fullAudioPlayer.duration);
        }
      };
      elements.fullAudioPlayer.addEventListener('loadedmetadata', handleDurationUpdate);
      elements.fullAudioPlayer.addEventListener('durationchange', handleDurationUpdate);
    }

    if (elements.fullAudioSlider) {
      const slider = elements.fullAudioSlider;
      slider.addEventListener('mousedown', () => { slider.dataset.dragging = 'true'; });
      slider.addEventListener('touchstart', () => { slider.dataset.dragging = 'true'; });
      slider.addEventListener('input', () => {
        if (elements.fullAudioPlayer?.duration) {
          const targetSecs = (Number(slider.value) / 100) * elements.fullAudioPlayer.duration;
          if (elements.fullAudioCurrentTime) {
            elements.fullAudioCurrentTime.textContent = formatTime(targetSecs);
          }
        }
      });
      const endDrag = () => {
        delete slider.dataset.dragging;
        if (elements.fullAudioPlayer?.duration) {
          elements.fullAudioPlayer.currentTime = (Number(slider.value) / 100) * elements.fullAudioPlayer.duration;
        }
      };
      slider.addEventListener('change', endDrag);
      slider.addEventListener('mouseup', endDrag);
      slider.addEventListener('touchend', endDrag);
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
          <span class="rfib-blank-wrapper" data-blank-index="${part.index}">
            <select
              class="rfib-blank-select"
              data-blank-index="${part.index}"
              style="min-width: ${Math.min(Math.max(maxOptionLength + 2, 10), 22)}ch"
              aria-label="Blank ${part.index + 1}"
            >
              ${optionHtml}
            </select>
          </span>
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
        // Remove any injected hint elements when re-answering
        const wrapper = select.closest('.rfib-blank-wrapper');
        if (wrapper) {
          wrapper.querySelectorAll('.rfib-hint-btn, .rfib-correct-label').forEach((el) => el.remove());
        }
        hidePopover();
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
      <div class="rfib-audio-card rfib-support-audio-card">
        <div class="rfib-audio-actions">
          <button type="button" class="rfib-inline-play modern-btn modern-btn--play">Play ${textLabel}</button>
          <div class="rfib-voice-toggle rfib-voice-toggle-inline"></div>
        </div>
        <div class="rfib-audio-slider-container">
          <span class="rfib-support-audio-current-time rfib-audio-time">0:00</span>
          <input type="range" class="rfib-support-audio-slider audio-slider" min="0" max="100" value="0" step="0.1" aria-label="Support audio progress slider">
          <span class="rfib-support-audio-total-time rfib-audio-time">0:00</span>
        </div>
      </div>
    `;
    elements.supportAudioNote.textContent = `${textLabel} audio`;

    const inlinePlay = elements.supportAudio.querySelector('.rfib-inline-play');
    const inlineToggle = elements.supportAudio.querySelector('.rfib-voice-toggle-inline');
    const currentTimeEl = elements.supportAudio.querySelector('.rfib-support-audio-current-time');
    const totalTimeEl = elements.supportAudio.querySelector('.rfib-support-audio-total-time');
    const sliderEl = elements.supportAudio.querySelector('.rfib-support-audio-slider');

    renderVoiceToggle(inlineToggle, variant, entry);

    elements.supportAudioPlayer.src = `/database/RFIB/audio/${encodeURIComponent(fileName)}`;
    elements.supportAudioPlayer.dataset.variant = variant;
    elements.supportAudioPlayer.dataset.voice = state.supportVoice[variant] || 'male';

    inlinePlay?.addEventListener('click', async () => {
      if (elements.supportAudioPlayer.paused) {
        try {
          await elements.supportAudioPlayer.play();
        } catch (error) {
          console.error('[RFIB] Failed to play support audio', error);
        }
      } else {
        elements.supportAudioPlayer.pause();
      }
    });

    const player = elements.supportAudioPlayer;
    const onPlay = () => {
      if (inlinePlay) {
        inlinePlay.textContent = `Pause ${textLabel}`;
        inlinePlay.classList.add('is-playing');
      }
    };
    const onPause = () => {
      if (inlinePlay) {
        inlinePlay.textContent = `Play ${textLabel}`;
        inlinePlay.classList.remove('is-playing');
      }
    };
    const onEnded = () => {
      if (inlinePlay) {
        inlinePlay.textContent = `Play ${textLabel}`;
        inlinePlay.classList.remove('is-playing');
      }
      if (sliderEl) sliderEl.value = '0';
      if (currentTimeEl) currentTimeEl.textContent = '0:00';
    };
    const onTimeUpdate = () => {
      if (!player.duration) return;
      if (sliderEl && !sliderEl.dataset.dragging) {
        sliderEl.value = String((player.currentTime / player.duration) * 100);
      }
      if (currentTimeEl) currentTimeEl.textContent = formatTime(player.currentTime);
    };
    const onDuration = () => {
      if (totalTimeEl && player.duration) {
        totalTimeEl.textContent = formatTime(player.duration);
      }
    };

    player.onplay = onPlay;
    player.onpause = onPause;
    player.onended = onEnded;
    player.ontimeupdate = onTimeUpdate;
    player.onloadedmetadata = onDuration;
    player.ondurationchange = onDuration;

    if (sliderEl) {
      sliderEl.addEventListener('mousedown', () => { sliderEl.dataset.dragging = 'true'; });
      sliderEl.addEventListener('touchstart', () => { sliderEl.dataset.dragging = 'true'; });
      sliderEl.addEventListener('input', () => {
        if (player.duration) {
          const targetSecs = (Number(sliderEl.value) / 100) * player.duration;
          if (currentTimeEl) currentTimeEl.textContent = formatTime(targetSecs);
        }
      });
      const endDrag = () => {
        delete sliderEl.dataset.dragging;
        if (player.duration) {
          player.currentTime = (Number(sliderEl.value) / 100) * player.duration;
        }
      };
      sliderEl.addEventListener('change', endDrag);
      sliderEl.addEventListener('mouseup', endDrag);
      sliderEl.addEventListener('touchend', endDrag);
    }
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

  /* ── Popover lifecycle ─────────────────────────────────────────── */

  let popoverEl = null;
  let activeHintBtn = null;

  function ensurePopoverElement() {
    if (popoverEl) return popoverEl;
    popoverEl = document.createElement('div');
    popoverEl.className = 'rfib-popover';
    popoverEl.innerHTML = `
      <div class="rfib-popover-arrow arrow-top"></div>
      <div class="rfib-popover-header">
        <span class="rfib-popover-blank-label"></span>
        <span class="rfib-popover-grammar-badge"></span>
        <button type="button" class="rfib-popover-close" aria-label="Close explanation">&times;</button>
      </div>
      <div class="rfib-popover-body"></div>
    `;
    document.body.appendChild(popoverEl);

    popoverEl.querySelector('.rfib-popover-close').addEventListener('click', hidePopover);

    // Close on Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && popoverEl?.classList.contains('is-visible')) {
        hidePopover();
      }
    });

    // Close on click outside (skip during drag)
    let isDragging = false;
    document.addEventListener('mousedown', (e) => {
      if (isDragging) return;
      if (!popoverEl?.classList.contains('is-visible')) return;
      if (popoverEl.contains(e.target)) return;
      if (e.target.closest('.rfib-hint-btn')) return;
      hidePopover();
    });

    // Drag-to-move via header
    const header = popoverEl.querySelector('.rfib-popover-header');
    let dragStartX = 0;
    let dragStartY = 0;
    let popStartX = 0;
    let popStartY = 0;

    header.addEventListener('mousedown', (e) => {
      // Don't drag when clicking the close button
      if (e.target.closest('.rfib-popover-close')) return;
      e.preventDefault();
      isDragging = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      popStartX = popoverEl.offsetLeft;
      popStartY = popoverEl.offsetTop;
      popoverEl.classList.add('is-dragging');
      // Hide arrow once user drags (it no longer points at the anchor)
      const arrow = popoverEl.querySelector('.rfib-popover-arrow');
      if (arrow) arrow.style.display = 'none';
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      popoverEl.style.left = `${popStartX + dx}px`;
      popoverEl.style.top = `${popStartY + dy}px`;
    });

    document.addEventListener('mouseup', () => {
      if (!isDragging) return;
      isDragging = false;
      popoverEl.classList.remove('is-dragging');
    });

    return popoverEl;
  }

  function positionPopover(anchorEl) {
    if (!popoverEl) return;
    const anchorRect = anchorEl.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 16;
    const arrowEl = popoverEl.querySelector('.rfib-popover-arrow');

    // Temporarily make visible off-screen to measure
    popoverEl.style.left = '-9999px';
    popoverEl.style.top = '-9999px';
    popoverEl.classList.add('is-visible');
    const popRect = popoverEl.getBoundingClientRect();
    popoverEl.classList.remove('is-visible');

    // Default: below the anchor
    let top = anchorRect.bottom + 10;
    let placeAbove = false;

    // If below overflows, try above
    if (top + popRect.height > vh - margin) {
      top = anchorRect.top - popRect.height - 10;
      placeAbove = true;
    }
    // If above also overflows, clamp at top
    if (top < margin) {
      top = margin;
      placeAbove = false;
    }

    // Horizontal: try to center on anchor, clamp to edges
    let left = anchorRect.left + anchorRect.width / 2 - popRect.width / 2;
    if (left + popRect.width > vw - margin) {
      left = vw - popRect.width - margin;
    }
    if (left < margin) {
      left = margin;
    }

    popoverEl.style.top = `${top}px`;
    popoverEl.style.left = `${left}px`;

    // Arrow positioning
    if (arrowEl) {
      arrowEl.classList.toggle('arrow-top', !placeAbove);
      arrowEl.classList.toggle('arrow-bottom', placeAbove);
      const arrowLeft = Math.max(16, Math.min(anchorRect.left + anchorRect.width / 2 - left - 6, popRect.width - 28));
      arrowEl.style.left = `${arrowLeft}px`;
    }
  }

  function showPopover(blankIndex, analysisData, anchorEl) {
    ensurePopoverElement();

    // Toggle: if clicking the same hint button, close
    if (activeHintBtn === anchorEl && popoverEl.classList.contains('is-visible')) {
      hidePopover();
      return;
    }

    // Deactivate previous hint button
    if (activeHintBtn) {
      activeHintBtn.classList.remove('is-active');
    }
    activeHintBtn = anchorEl;
    anchorEl.classList.add('is-active');

    const { grammarTag, engExp, viExp, isCorrect, displayAnswer } = analysisData;

    // Header
    const blankLabel = popoverEl.querySelector('.rfib-popover-blank-label');
    const grammarBadge = popoverEl.querySelector('.rfib-popover-grammar-badge');
    blankLabel.textContent = `Blank ${blankIndex + 1}`;
    if (grammarTag) {
      grammarBadge.textContent = grammarTag;
      grammarBadge.style.display = '';
    } else {
      grammarBadge.style.display = 'none';
    }

    // Body
    const body = popoverEl.querySelector('.rfib-popover-body');
    let bodyHtml = '';

    if (!isCorrect && displayAnswer) {
      bodyHtml += `<div class="rfib-popover-section" style="font-weight:700;color:var(--rfib-success);font-size:0.84rem;margin-bottom:2px;">✓ Correct: ${escapeHtml(displayAnswer)}</div>`;
    }

    if (engExp) {
      bodyHtml += `
        <div class="rfib-popover-section rfib-popover-section-en">
          <div class="rfib-popover-exp-label">🇬🇧 Explanation</div>
          <div class="rfib-popover-exp-text">${renderMarkdownInline(escapeHtml(engExp)).replace(/\n/g, '<br>')}</div>
        </div>
      `;
    }
    if (viExp) {
      bodyHtml += `
        <div class="rfib-popover-section rfib-popover-section-vi">
          <div class="rfib-popover-exp-label">🇻🇳 Giải thích chi tiết</div>
          <div class="rfib-popover-exp-text">${renderMarkdownInline(escapeHtml(viExp)).replace(/\n/g, '<br>')}</div>
        </div>
      `;
    }

    if (!engExp && !viExp) {
      bodyHtml = '<div class="rfib-popover-empty">No explanation available for this blank.</div>';
    }

    body.innerHTML = bodyHtml;

    // Reset arrow (may have been hidden during drag) and position
    const arrowReset = popoverEl.querySelector('.rfib-popover-arrow');
    if (arrowReset) arrowReset.style.display = '';
    positionPopover(anchorEl);
    popoverEl.classList.add('is-visible');
  }

  function hidePopover() {
    if (activeHintBtn) {
      activeHintBtn.classList.remove('is-active');
      activeHintBtn = null;
    }
    if (popoverEl) {
      popoverEl.classList.remove('is-visible');
    }
  }

  function removeHintButtons() {
    hidePopover();
    if (!elements.clozeView) return;
    // Fully remove injected hint buttons and correct labels from DOM
    elements.clozeView.querySelectorAll('.rfib-hint-btn, .rfib-correct-label').forEach((el) => el.remove());
  }

  function clearResultBox() {
    if (!elements.resultBox) return;
    elements.resultBox.innerHTML = '';
    elements.resultBox.classList.remove('is-visible');
    removeHintButtons();
    resetActionButtons();
  }

  /** Pre-grade action bar: Check only. */
  function resetActionButtons() {
    if (elements.checkBtn) elements.checkBtn.style.display = '';
    if (elements.retryBtn) elements.retryBtn.style.display = 'none';
    if (elements.nextQuestionBtn) elements.nextQuestionBtn.style.display = 'none';
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
      state.supportVisible = false;
    }

    renderQuestionSelect();
    renderAttempt();
    renderSupportVariantButtons();
    renderSupportAudio(state.supportVariant);
    renderFullAudio();
    updateSupportVisibility();
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
      state.supportVisible = false;
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
    let nextIndex;
    if (delta < 0) {
      if (state.randomMode && state.navHistory.length > 0) {
        nextIndex = state.navHistory.pop();
      } else {
        nextIndex = Math.max(0, state.currentQuestionIndex - 1);
      }
    } else {
      if (state.randomMode && state.questions.length > 1) {
        state.navHistory.push(state.currentQuestionIndex);
        do {
          nextIndex = Math.floor(Math.random() * state.questions.length);
        } while (nextIndex === state.currentQuestionIndex && state.questions.length > 1);
      } else {
        nextIndex = Math.min(state.questions.length - 1, state.currentQuestionIndex + 1);
      }
    }

    if (nextIndex === state.currentQuestionIndex) return;
    state.currentQuestionIndex = nextIndex;
    state.currentQuestion = state.questions[nextIndex];
    state.currentAttempt = buildAttempt(state.currentQuestion);
    state.supportVisible = false;
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

    state.supportVisible = true;
    updateSupportVisibility();

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
        displayAnswer: blank.displayAnswer || '',
        isCorrect
      };
    });

    const total = results.length;
    const correct = results.filter((result) => result.isCorrect).length;
    const isPerfect = total > 0 && correct === total;

    applyBlankClasses(results);

    // Load enrichment metadata for explanations
    const metadata = getReviewMetadata(state.currentQuestion.id) || await loadReviewMetadata().then(() => getReviewMetadata(state.currentQuestion.id));
    let blankAnalysisMap = new Map();
    if (metadata && metadata.blankAnalysis) {
      try {
        const analysisList = typeof metadata.blankAnalysis === 'string'
          ? JSON.parse(metadata.blankAnalysis)
          : metadata.blankAnalysis;
        if (Array.isArray(analysisList)) {
          analysisList.forEach((item) => {
            if (item && item.blank_index != null) {
              blankAnalysisMap.set(Number(item.blank_index), item);
            }
          });
        }
      } catch (e) {
        console.warn('[RFIB] Failed to parse blankAnalysis', e);
      }
    }

    // Inject inline hint buttons + correct labels for each blank (created dynamically, not pre-rendered)
    results.forEach((result) => {
      const wrapper = elements.clozeView?.querySelector(`.rfib-blank-wrapper[data-blank-index="${result.index}"]`);
      if (!wrapper) return;

      // Remove any leftover hint elements from a previous Check
      wrapper.querySelectorAll('.rfib-hint-btn, .rfib-correct-label').forEach((el) => el.remove());

      // Show correct answer label for incorrect blanks (only if user actually picked something)
      if (!result.isCorrect && result.userAnswer) {
        const correctLabel = document.createElement('span');
        correctLabel.className = 'rfib-correct-label is-visible';
        correctLabel.textContent = `→ ${result.displayAnswer || result.correctAnswer}`;
        wrapper.appendChild(correctLabel);
      }

      // Build analysis data for this blank
      const analysis = blankAnalysisMap.get(result.index + 1);
      const grammarTag = analysis?.grammar_tag || '';
      const engExp = analysis?.final_explanation || analysis?.detailed_explanation || analysis?.concise_explanation || analysis?.student_explanation || analysis?.simplified_explanation || '';
      const viExp = analysis?.vi_explanation || '';

      // Create and append hint button
      const hintBtn = document.createElement('button');
      hintBtn.type = 'button';
      hintBtn.className = 'rfib-hint-btn is-visible';
      hintBtn.setAttribute('aria-label', `Explanation for blank ${result.index + 1}`);
      hintBtn.title = 'Show explanation';
      hintBtn.textContent = '?';
      hintBtn.addEventListener('click', () => {
        showPopover(result.index, {
          grammarTag,
          engExp,
          viExp,
          isCorrect: result.isCorrect,
          displayAnswer: result.displayAnswer || result.correctAnswer
        }, hintBtn);
      });
      wrapper.appendChild(hintBtn);
    });

    // Compact score summary (no per-blank wall of text)
    if (elements.resultBox) {
      const icon = isPerfect ? '🎉' : '';
      elements.resultBox.innerHTML = `
        <div class="rfib-result-summary ${isPerfect ? 'is-perfect' : 'has-misses'}">
          ${icon} ${correct}/${total} blanks correct ${isPerfect ? '— Perfect!' : '— Click ? for explanations'}
        </div>
      `;
      elements.resultBox.classList.add('is-visible');
    }

    // Match the other Reading tasks: Retry and Next Question appear only once
    // the attempt has been graded.
    if (elements.checkBtn) elements.checkBtn.style.display = 'none';
    if (elements.retryBtn) elements.retryBtn.style.display = '';
    if (elements.nextQuestionBtn) {
      elements.nextQuestionBtn.style.display =
        state.currentQuestionIndex < state.questions.length - 1 ? '' : 'none';
    }

    if (window.handleDualTrackScoring) {
      await window.handleDualTrackScoring('rfib', state.currentQuestion.id, { answers });
    }

    if (window.recordPracticeAttempt) {
      await window.recordPracticeAttempt(state.currentQuestion.id, isPerfect, 'rfib');
    }

    window.PTEAttemptArchive?.saveAttempt?.({
      practiceMode: 'rfib',
      promptSnapshot: window.PTEAttemptArchive.summarizeQuestion(state.currentQuestion),
      responseSnapshot: {
        answers
      },
      answerSnapshot: {
        blanks: results.map((result) => ({
          index: result.index,
          correctAnswer: result.correctAnswer,
          userAnswer: result.userAnswer,
          isCorrect: result.isCorrect
        }))
      },
      resultSnapshot: {
        score: correct,
        maxScore: total,
        correct: isPerfect,
        results
      },
      scoringSource: 'client'
    }).catch((error) => console.warn('[PTE Archive] RFIB save failed:', error));

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
        elements.resultBox.classList.add('is-visible');
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
        elements.resultBox.classList.add('is-visible');
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
