/* eslint-disable no-console */
(function () {
  'use strict';

  const EXCEL_PATH = '/database/Highlight Incorrect Words/HIW/HIW.xlsx';
  const MANIFEST_PATH = '/database/Highlight Incorrect Words/audio/manifest.json';
  const ALLOWED_EXPLANATION_TAGS = new Set(['P', 'STRONG', 'B', 'EM', 'I', 'UL', 'OL', 'LI', 'BR', 'H3', 'H4']);

  const state = {
    initialized: false,
    questions: [],
    audioManifest: {},
    currentQuestionIndex: 0,
    currentQuestion: null,
    tokens: [], // Tokenized words in current question
    submitted: false,
    pickerOpen: false,
    explanationVisible: false,
    currentSpeed: 1.0,
    activeVoiceId: null,
    activeLoadedMetadataListener: null,
    volume: parseFloat(localStorage.getItem('hiw-volume') || '1.0'),
    preMuteVolume: null
  };

  const elements = {};

  function escapeHtmlText(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function normalizeExplanationMarkup(rawHtml) {
    return String(rawHtml || '')
      .replace(/^```html\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/`(.*?)`/g, '<em>$1</em>');
  }

  function sanitizeExplanationHtml(rawHtml) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(normalizeExplanationMarkup(rawHtml), 'text/html');

    const cleanNode = (node) => {
      if (node.nodeType === Node.COMMENT_NODE) {
        node.remove();
        return;
      }

      if (node.nodeType !== Node.ELEMENT_NODE) return;

      if (!ALLOWED_EXPLANATION_TAGS.has(node.tagName)) {
        const childNodes = Array.from(node.childNodes);
        node.replaceWith(...childNodes);
        childNodes.forEach(cleanNode);
        return;
      }

      Array.from(node.attributes).forEach((attribute) => node.removeAttribute(attribute.name));
      Array.from(node.childNodes).forEach(cleanNode);
    };

    Array.from(doc.body.childNodes).forEach(cleanNode);
    return doc.body.innerHTML;
  }

  function safeRenderHtml(rawHtml, container) {
    if (!container) return;
    container.replaceChildren();
    const cleanHtml = sanitizeExplanationHtml(rawHtml);
    
    const parser = new DOMParser();
    const doc = parser.parseFromString(cleanHtml, 'text/html');
    
    Array.from(doc.body.childNodes).forEach(node => {
      container.appendChild(node.cloneNode(true));
    });
  }

  function formatTime(seconds) {
    if (!seconds || !Number.isFinite(seconds)) return '00:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  function resetAudioProgress() {
    if (elements.progressFill) elements.progressFill.style.width = '0';
    if (elements.seek) elements.seek.value = '0';
    if (elements.audioTime) elements.audioTime.textContent = '00:00 / 00:00';
  }

  function setAudioControlsEnabled(enabled) {
    if (elements.playBtn) {
      elements.playBtn.disabled = !enabled;
      elements.playBtn.setAttribute('aria-disabled', enabled ? 'false' : 'true');
    }
    if (elements.seek) {
      elements.seek.disabled = !enabled;
    }
  }

  function cacheElements() {
    // v7 question picker elements
    elements.prevBtn = document.getElementById('hiw-v7-prev-btn');
    elements.nextBtn = document.getElementById('hiw-v7-next-btn');
    elements.questionPill = document.getElementById('hiw-v7-question-pill');
    elements.backdrop = document.getElementById('hiw-v7-backdrop');
    elements.sheet = document.getElementById('hiw-v7-sheet');
    elements.sheetClose = document.getElementById('hiw-v7-sheet-close');
    elements.jumpSearch = document.getElementById('hiw-v7-jump-search');
    elements.jumpList = document.getElementById('hiw-v7-jump-list');

    // audio element and player elements
    elements.audioElement = document.getElementById('hiw-audio-element');
    elements.playBtn = document.getElementById('hiw-play-btn');
    elements.playIcon = document.getElementById('hiw-play-icon');
    elements.playLabel = document.getElementById('hiw-play-label');
    elements.progressFill = document.getElementById('hiw-progress-fill');
    elements.seek = document.getElementById('hiw-seek');
    elements.audioTime = document.getElementById('hiw-audio-time');
    elements.volume = document.getElementById('hiw-volume');
    elements.voiceSelect = document.getElementById('hiw-voice-select');
    elements.speedBtns = document.querySelectorAll('.hiw-speed-btn');

    // practice card elements
    elements.passageContainer = document.getElementById('hiw-passage-container');

    // action buttons
    elements.submitBtn = document.getElementById('hiw-submit-btn');
    elements.retryBtn = document.getElementById('hiw-retry-btn');
    elements.explanationToggle = document.getElementById('hiw-explanation-toggle');

    // results and explanations
    elements.resultBox = document.getElementById('hiw-result-box');
    elements.explanationPanel = document.getElementById('hiw-explanation-panel');
    elements.explanationContent = document.getElementById('hiw-explanation-content');
  }

  function setupEventListeners() {
    if (elements.prevBtn) {
      elements.prevBtn.addEventListener('click', () => {
        if (state.currentQuestionIndex > 0) {
          loadQuestion(state.currentQuestionIndex - 1);
        }
      });
    }

    if (elements.nextBtn) {
      elements.nextBtn.addEventListener('click', () => {
        if (state.currentQuestionIndex < state.questions.length - 1) {
          loadQuestion(state.currentQuestionIndex + 1);
        }
      });
    }

    if (elements.questionPill) {
      elements.questionPill.addEventListener('click', () => {
        if (state.pickerOpen) {
          closePicker();
        } else {
          openPicker();
        }
      });
    }

    if (elements.backdrop) {
      elements.backdrop.addEventListener('click', closePicker);
    }

    if (elements.sheetClose) {
      elements.sheetClose.addEventListener('click', closePicker);
    }

    if (elements.jumpSearch) {
      elements.jumpSearch.addEventListener('input', (e) => {
        renderJumpList(e.target.value);
      });
    }

    if (elements.jumpList) {
      elements.jumpList.addEventListener('click', (e) => {
        const item = e.target.closest('[data-index]');
        if (item) {
          const index = Number.parseInt(item.dataset.index, 10);
          if (Number.isFinite(index)) {
            loadQuestion(index);
          }
        }
      });
    }

    if (elements.submitBtn) {
      elements.submitBtn.addEventListener('click', submitAnswers);
    }

    if (elements.retryBtn) {
      elements.retryBtn.addEventListener('click', () => {
        loadQuestion(state.currentQuestionIndex);
      });
    }

    if (elements.explanationToggle) {
      elements.explanationToggle.addEventListener('click', toggleExplanation);
    }

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && state.pickerOpen) {
        closePicker();
      }
    });

    // Audio Event Listeners
    if (elements.playBtn) {
      elements.playBtn.addEventListener('click', toggleAudio);
    }

    if (elements.audioElement) {
      elements.audioElement.addEventListener('timeupdate', updateAudioProgress);
      elements.audioElement.addEventListener('loadedmetadata', updateAudioDuration);
      elements.audioElement.addEventListener('ended', onAudioEnded);
      elements.audioElement.addEventListener('play', onAudioPlay);
      elements.audioElement.addEventListener('pause', onAudioPause);
    }

    if (elements.seek) {
      elements.seek.addEventListener('input', seekAudio);
    }

    if (elements.voiceSelect) {
      elements.voiceSelect.addEventListener('change', changeVoice);
    }

    elements.speedBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const speed = parseFloat(btn.dataset.speed);
        if (Number.isFinite(speed)) {
          changeSpeed(speed);
        }
      });
    });

    if (elements.volume) {
      elements.volume.value = state.volume;
      elements.volume.addEventListener('input', () => {
        const vol = Number(elements.volume.value);
        if (Number.isFinite(vol)) {
          state.volume = vol;
          localStorage.setItem('hiw-volume', String(vol));
          if (elements.audioElement) {
            elements.audioElement.volume = vol;
          }
        }
      });
    }
  }

  /* Audio player logic */
  function toggleAudio() {
    if (!elements.audioElement || !elements.audioElement.src) return;

    if (elements.audioElement.paused) {
      elements.audioElement.playbackRate = state.currentSpeed;
      elements.audioElement.volume = Number(elements.volume?.value ?? state.volume);
      elements.audioElement.play().catch((err) => {
        console.error('[HIWMode] Play failed:', err);
      });
    } else {
      elements.audioElement.pause();
    }
  }

  function onAudioPlay() {
    if (elements.playIcon) elements.playIcon.textContent = 'pause';
    if (elements.playLabel) elements.playLabel.textContent = 'Pause';
  }

  function onAudioPause() {
    if (elements.playIcon) elements.playIcon.textContent = 'play_arrow';
    if (elements.playLabel) elements.playLabel.textContent = 'Play';
  }

  function onAudioEnded() {
    onAudioPause();
    if (elements.audioElement) {
      elements.audioElement.currentTime = 0;
    }
    resetAudioProgress();
  }

  function updateAudioProgress() {
    const audio = elements.audioElement;
    if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return;

    const percentage = Math.min(100, (audio.currentTime / audio.duration) * 100);
    if (elements.progressFill) elements.progressFill.style.width = `${percentage}%`;
    if (elements.seek) elements.seek.value = String(percentage);
    if (elements.audioTime) {
      elements.audioTime.textContent = `${formatTime(audio.currentTime)} / ${formatTime(audio.duration)}`;
    }
  }

  function updateAudioDuration() {
    updateAudioProgress();
  }

  function seekAudio() {
    const audio = elements.audioElement;
    if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
    const percentage = Math.min(100, Math.max(0, Number(elements.seek.value) || 0));
    audio.currentTime = (percentage / 100) * audio.duration;
    updateAudioProgress();
  }

  function changeSpeed(speed) {
    state.currentSpeed = speed;
    elements.speedBtns.forEach((btn) => {
      const btnSpeed = parseFloat(btn.dataset.speed);
      btn.classList.toggle('is-active', btnSpeed === speed);
    });

    if (elements.audioElement) {
      elements.audioElement.playbackRate = speed;
    }
  }

  function changeVoice() {
    if (!elements.audioElement || !state.currentQuestion) return;

    const newVoiceId = elements.voiceSelect.value;
    if (!newVoiceId) return;

    state.activeVoiceId = newVoiceId;
    const qId = state.currentQuestion.id;
    const voiceMeta = state.audioManifest[qId]?.find(v => v.id === newVoiceId);
    if (!voiceMeta) return;

    if (state.activeLoadedMetadataListener) {
      elements.audioElement.removeEventListener('loadedmetadata', state.activeLoadedMetadataListener);
      state.activeLoadedMetadataListener = null;
    }

    const audioUrl = `/database/Highlight Incorrect Words/audio/${qId}/${voiceMeta.file}`;
    const wasPlaying = !elements.audioElement.paused;
    const curTime = elements.audioElement.currentTime;

    elements.audioElement.src = audioUrl;
    elements.audioElement.volume = state.volume;
    elements.audioElement.load();

    const restoreState = () => {
      elements.audioElement.currentTime = curTime;
      elements.audioElement.playbackRate = state.currentSpeed;
      elements.audioElement.volume = state.volume;
      if (wasPlaying) {
        elements.audioElement.play().catch((err) => console.log('[HIWMode] Switch play failed:', err));
      }
      elements.audioElement.removeEventListener('loadedmetadata', restoreState);
      if (state.activeLoadedMetadataListener === restoreState) {
        state.activeLoadedMetadataListener = null;
      }
    };

    state.activeLoadedMetadataListener = restoreState;
    elements.audioElement.addEventListener('loadedmetadata', restoreState);
  }

  /* Picker controls */
  function openPicker() {
    if (!elements.sheet || !elements.backdrop || state.questions.length === 0) return;
    state.pickerOpen = true;
    elements.backdrop.classList.add('is-visible');
    elements.backdrop.setAttribute('aria-hidden', 'false');
    elements.sheet.classList.add('is-open');
    elements.sheet.setAttribute('aria-hidden', 'false');
    if (elements.questionPill) {
      elements.questionPill.setAttribute('aria-expanded', 'true');
    }
    renderJumpList();
    if (elements.jumpSearch) {
      elements.jumpSearch.value = '';
      elements.jumpSearch.focus();
    }
  }

  function closePicker({ restoreFocus = true } = {}) {
    if (!elements.sheet || !elements.backdrop) return;
    const shouldRestoreFocus = restoreFocus && state.pickerOpen;
    state.pickerOpen = false;
    elements.backdrop.classList.remove('is-visible');
    elements.backdrop.setAttribute('aria-hidden', 'true');
    elements.sheet.classList.remove('is-open');
    elements.sheet.setAttribute('aria-hidden', 'true');
    if (elements.questionPill) {
      elements.questionPill.setAttribute('aria-expanded', 'false');
      if (shouldRestoreFocus) {
        elements.questionPill.focus();
      }
    }
  }

  function resetFeedbackUI() {
    state.explanationVisible = false;
    if (elements.retryBtn) {
      elements.retryBtn.style.display = 'none';
    }
    if (elements.explanationToggle) {
      elements.explanationToggle.style.display = 'none';
      elements.explanationToggle.textContent = 'Show explanation';
      elements.explanationToggle.setAttribute('aria-expanded', 'false');
    }
    if (elements.resultBox) {
      elements.resultBox.style.display = 'none';
      elements.resultBox.replaceChildren();
    }
    if (elements.explanationPanel) {
      elements.explanationPanel.style.display = 'none';
    }
    if (elements.explanationContent) {
      elements.explanationContent.replaceChildren();
    }
  }

  function setLoadingState(message) {
    if (elements.passageContainer) {
      elements.passageContainer.textContent = message;
    }
    if (elements.submitBtn) {
      elements.submitBtn.style.display = 'block';
      elements.submitBtn.disabled = true;
    }
    resetFeedbackUI();
  }

  function renderJumpList(filter = '') {
    if (!elements.jumpList) return;
    const cleanFilter = filter.toLowerCase().trim();

    elements.jumpList.replaceChildren();

    const fragments = document.createDocumentFragment();
    let hasMatch = false;

    state.questions.forEach((q, idx) => {
      const isActive = idx === state.currentQuestionIndex;
      const matchesFilter = !cleanFilter ||
        String(q.id).includes(cleanFilter) ||
        q.title.toLowerCase().includes(cleanFilter);

      if (!matchesFilter) return;
      hasMatch = true;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `ra-v7-list-item${isActive ? ' is-active' : ''}`;
      btn.dataset.index = idx;
      btn.setAttribute('role', 'option');
      if (isActive) {
        btn.setAttribute('aria-selected', 'true');
      }

      const idSpan = document.createElement('span');
      idSpan.className = 'ra-v7-item-id';
      idSpan.textContent = `#${q.id}`;
      btn.appendChild(idSpan);

      const titleSpan = document.createElement('span');
      titleSpan.className = 'ra-v7-item-title';
      titleSpan.textContent = q.title;
      btn.appendChild(titleSpan);

      fragments.appendChild(btn);
    });

    if (hasMatch) {
      elements.jumpList.appendChild(fragments);
    } else {
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'ra-v7-empty';
      emptyDiv.textContent = 'No matching questions';
      elements.jumpList.appendChild(emptyDiv);
    }
  }

  function updateNavigationUI() {
    if (elements.prevBtn) {
      elements.prevBtn.disabled = state.currentQuestionIndex <= 0;
    }
    if (elements.nextBtn) {
      elements.nextBtn.disabled = state.currentQuestionIndex >= state.questions.length - 1;
    }
    if (elements.questionPill && state.currentQuestion) {
      elements.questionPill.textContent = `#${state.currentQuestion.id} - ${state.currentQuestion.title}`;
    }
  }

  /* Load Excel Data & Audio Manifest */
  async function loadData() {
    if (typeof XLSX === 'undefined') {
      throw new Error('XLSX library is not loaded. Cannot parse Excel database.');
    }

    const excelRes = await fetch(`${EXCEL_PATH}?v=${Date.now()}`);
    if (!excelRes.ok) {
      throw new Error(`Failed to fetch Excel database: ${excelRes.statusText}`);
    }
    const arrayBuffer = await excelRes.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rawData = XLSX.utils.sheet_to_json(sheet);

    try {
      const manifestRes = await fetch(`${MANIFEST_PATH}?v=${Date.now()}`);
      if (manifestRes.ok) {
        state.audioManifest = await manifestRes.json();
      } else {
        console.warn('[HIWMode] Manifest res failed, falling back to empty manifest');
        state.audioManifest = {};
      }
    } catch (err) {
      console.error('[HIWMode] Error fetching manifest.json:', err);
      state.audioManifest = {};
    }

    state.questions = rawData.map((row) => {
      return {
        id: Number(row.ID) || 0,
        title: String(row.TITLE || '').trim(),
        answerRaw: String(row.ANSWER || '').trim(),
        transcript: String(row['ANSWER FOR COMPARE OR TRANSCRIPT'] || '').trim(),
        explanation: String(row.EXPLANATION || '').trim()
      };
    }).filter((question) => {
      const isValid = question.id > 0 && question.answerRaw.length > 0;
      if (!isValid) {
        console.warn('[HIWMode] Skipping invalid workbook row:', question);
      }
      return isValid;
    }).sort((a, b) => a.id - b.id);
  }

  /* Tokenize RAW Text, extracting Incorrect/Correct words and placing punctuation outside */
  function parseAndTokenizePassage(rawText) {
    const tokens = [];
    const tempContainer = document.createDocumentFragment();
    let lastIndex = 0;
    let match;
    
    // Pattern matches marked incorrect/correct words (__incorrect/correct__) 
    // or standard unicode word tokens (letters/numbers/apostrophes/hyphens).
    const regex = /__([^_/]+)\/([^_/]+)__|([\p{L}\p{N}'-]+)/gu;

    while ((match = regex.exec(rawText)) !== null) {
      // Add text/punctuation between previous word and current word
      if (match.index > lastIndex) {
        const punctuationText = rawText.substring(lastIndex, match.index);
        tempContainer.appendChild(document.createTextNode(punctuationText));
      }

      const isMismatched = match[1] !== undefined;
      const wordText = isMismatched ? match[1] : match[3];
      const correctWord = isMismatched ? match[2] : null;
      
      const tokenIdx = tokens.length;
      tokens.push({
        index: tokenIdx,
        text: wordText,
        isMismatched: isMismatched,
        correctWord: correctWord,
        selected: false
      });

      const span = document.createElement('span');
      span.className = 'hiw-word';
      span.dataset.wordIdx = tokenIdx;
      span.textContent = wordText;

      span.addEventListener('click', () => handleWordClick(tokenIdx));

      tempContainer.appendChild(span);
      lastIndex = regex.lastIndex;
    }

    if (lastIndex < rawText.length) {
      const remainingText = rawText.substring(lastIndex);
      tempContainer.appendChild(document.createTextNode(remainingText));
    }

    return { tokens, fragment: tempContainer };
  }

  function handleWordClick(tokenIdx) {
    if (state.submitted) return;

    const token = state.tokens[tokenIdx];
    if (!token) return;

    token.selected = !token.selected;

    const span = elements.passageContainer.querySelector(`.hiw-word[data-word-idx="${tokenIdx}"]`);
    if (span) {
      span.classList.toggle('is-selected', token.selected);
    }
  }

  /* Load Question */
  function loadQuestion(index) {
    if (index < 0 || index >= state.questions.length) return;

    // Reset current audio playback
    if (elements.audioElement) {
      if (state.activeLoadedMetadataListener) {
        elements.audioElement.removeEventListener('loadedmetadata', state.activeLoadedMetadataListener);
        state.activeLoadedMetadataListener = null;
      }
      elements.audioElement.pause();
      elements.audioElement.src = '';
    }
    setAudioControlsEnabled(false);
    resetAudioProgress();
    onAudioPause();

    state.currentQuestionIndex = index;
    state.currentQuestion = state.questions[index];
    state.submitted = false;
    state.explanationVisible = false;

    closePicker();
    updateNavigationUI();
    renderQuestion();

    if (window.PracticeRouter && state.currentQuestion?.id != null) {
      window.PracticeRouter.replaceRoute('hiw', state.currentQuestion.id);
    }
  }

  function renderQuestion() {
    if (!state.currentQuestion) return;

    // 1. Setup Audio & Voices list
    const qId = state.currentQuestion.id;
    const voices = state.audioManifest[qId] || [];

    if (elements.voiceSelect) {
      elements.voiceSelect.replaceChildren();
      
      if (voices.length > 0) {
        voices.forEach((voice) => {
          const opt = document.createElement('option');
          opt.value = voice.id;
          opt.textContent = `${voice.name} (${voice.accent} ${voice.gender})`;
          elements.voiceSelect.appendChild(opt);
        });

        state.activeVoiceId = voices[0].id;
        elements.voiceSelect.value = voices[0].id;
        const firstVoiceUrl = `/database/Highlight Incorrect Words/audio/${qId}/${voices[0].file}`;
        if (elements.audioElement) {
          elements.audioElement.src = firstVoiceUrl;
          elements.audioElement.volume = state.volume;
          elements.audioElement.load();
        }
        setAudioControlsEnabled(true);
      } else {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = 'No voice available';
        elements.voiceSelect.appendChild(opt);
        if (elements.audioElement) {
          elements.audioElement.src = '';
        }
        setAudioControlsEnabled(false);
      }
    }

    // Reset progress and apply speed
    resetAudioProgress();
    if (elements.audioElement) {
      elements.audioElement.playbackRate = state.currentSpeed;
    }

    // 2. Tokenize and render the passage
    if (elements.passageContainer) {
      elements.passageContainer.replaceChildren();
      const { tokens, fragment } = parseAndTokenizePassage(state.currentQuestion.answerRaw);
      state.tokens = tokens;
      elements.passageContainer.appendChild(fragment);
    }

    // 3. Reset buttons
    if (elements.submitBtn) {
      elements.submitBtn.style.display = 'block';
      elements.submitBtn.disabled = false; // Enable Submit from the start
    }
    resetFeedbackUI();
  }

  /* Submit flow */
  function submitAnswers() {
    if (state.submitted) return;
    state.submitted = true;

    // Pause audio
    if (elements.audioElement) {
      elements.audioElement.pause();
    }
    onAudioPause();

    let correctSelections = 0;
    let incorrectSelections = 0;
    let missedSelections = 0;

    // Apply color highlights to spans in the passage
    state.tokens.forEach((token) => {
      const span = elements.passageContainer.querySelector(`.hiw-word[data-word-idx="${token.index}"]`);
      if (!span) return;

      span.classList.remove('is-selected');
      
      if (token.isMismatched) {
        if (token.selected) {
          correctSelections++;
          span.classList.add('is-correct-click');
          span.title = `Clicked! Spoken: "${token.correctWord}"`;
        } else {
          missedSelections++;
          span.classList.add('is-missed');
          span.title = `Missed! Spoken: "${token.correctWord}"`;
        }
        const annotation = document.createElement('span');
        annotation.className = `hiw-word-annotation hiw-word-annotation--${token.selected ? 'correct' : 'missed'}`;
        annotation.textContent = `→ ${token.correctWord}`;
        span.after(annotation);
      } else {
        if (token.selected) {
          incorrectSelections++;
          span.classList.add('is-incorrect-click');
          span.title = `Incorrect selection! Matches audio.`;
        } else {
          span.classList.add('is-disabled');
        }
      }
    });

    // Score: correctSelections - incorrectSelections, clamped to 0
    const finalScore = Math.max(0, correctSelections - incorrectSelections);
    const maxScore = state.tokens.filter(t => t.isMismatched).length;

    // Show score banner
    if (elements.resultBox) {
      elements.resultBox.style.display = 'block';
      elements.resultBox.replaceChildren();
      
      const headerDiv = document.createElement('div');
      headerDiv.className = 'hiw-result-header has-score';
      headerDiv.textContent = `Practice Score: ${finalScore} / ${maxScore}`;
      elements.resultBox.appendChild(headerDiv);

      const descDiv = document.createElement('div');
      descDiv.className = 'hiw-result-desc';
      descDiv.innerHTML = `You made <strong>${correctSelections}</strong> correct highlights and <strong>${incorrectSelections}</strong> incorrect penalties. (Missed words: <strong>${missedSelections}</strong>)`;
      elements.resultBox.appendChild(descDiv);
    }

    // Toggle button visibilities
    if (elements.submitBtn) {
      elements.submitBtn.style.display = 'none';
    }
    if (elements.retryBtn) {
      elements.retryBtn.style.display = 'block';
    }

    window.PTEAttemptArchive?.saveAttempt?.({
      practiceMode: 'hiw',
      promptSnapshot: window.PTEAttemptArchive.summarizeQuestion(state.currentQuestion),
      responseSnapshot: {
        selectedTokens: state.tokens.filter((token) => token.selected).map((token) => ({
          index: token.index,
          text: token.text
        }))
      },
      answerSnapshot: {
        tokens: state.tokens.map((token) => ({
          index: token.index,
          text: token.text,
          keyedIncorrectWord: !!token.isMismatched,
          spokenWord: token.correctWord || null,
          selected: !!token.selected
        }))
      },
      resultSnapshot: {
        score: finalScore,
        maxScore,
        correctSelections,
        incorrectSelections,
        missedSelections
      },
      scoringSource: 'client'
    }).catch((error) => console.warn('[PTE Archive] HIW save failed:', error));

    // Render structured explanation
    const mismatchedTokens = state.tokens.filter(t => t.isMismatched);
    if (elements.explanationToggle && mismatchedTokens.length > 0) {
      elements.explanationToggle.style.display = 'block';
      if (elements.explanationContent) {
        elements.explanationContent.replaceChildren();
        const table = document.createElement('table');
        table.className = 'hiw-comparison-table';
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        ['Transcript', 'Spoken'].forEach(text => {
          const th = document.createElement('th');
          th.textContent = text;
          headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);
        table.appendChild(thead);
        const tbody = document.createElement('tbody');
        mismatchedTokens.forEach(t => {
          const tr = document.createElement('tr');
          const tdTranscript = document.createElement('td');
          tdTranscript.className = 'hiw-cmp-transcript';
          tdTranscript.textContent = t.text;
          const tdSpoken = document.createElement('td');
          tdSpoken.className = 'hiw-cmp-spoken';
          tdSpoken.textContent = t.correctWord;
          tr.appendChild(tdTranscript);
          tr.appendChild(tdSpoken);
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        elements.explanationContent.appendChild(table);
      }
    }
  }

  function toggleExplanation() {
    if (!elements.explanationPanel || !elements.explanationToggle) return;

    state.explanationVisible = !state.explanationVisible;
    if (state.explanationVisible) {
      elements.explanationPanel.style.display = 'flex';
      elements.explanationToggle.textContent = 'Hide explanation';
      elements.explanationToggle.setAttribute('aria-expanded', 'true');
      elements.explanationPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else {
      elements.explanationPanel.style.display = 'none';
      elements.explanationToggle.textContent = 'Show explanation';
      elements.explanationToggle.setAttribute('aria-expanded', 'false');
    }
  }

  async function loadQuestionByIdOrFirst(questionId) {
    if (state.questions.length === 0) {
      await loadData();
    }
    const numericId = Number(questionId);
    const index = state.questions.findIndex(q => Number(q.id) === numericId);
    loadQuestion(index === -1 ? 0 : index);
  }

  /* Global Controller Hooks */
  async function activate() {
    cacheElements();
    if (!state.initialized) {
      setupEventListeners();
      state.initialized = true;
    }

    if (elements.volume) {
      elements.volume.value = state.volume;
    }
    if (elements.audioElement) {
      elements.audioElement.volume = state.volume;
    }

    if (state.questions.length === 0) {
      setLoadingState('Loading Highlight Incorrect Words database...');
      try {
        await loadData();
      } catch (error) {
        console.error('[HIWMode] Error loading excel database:', error);
        setLoadingState('Failed to load question database. Please check your network connection and reload.');
        return;
      }
    }

    if (state.questions.length > 0) {
      const urlRoute = window.PracticeRouter ? window.PracticeRouter.initFromURL() : null;
      if (urlRoute && urlRoute.mode === 'hiw' && urlRoute.questionId) {
        await loadQuestionByIdOrFirst(urlRoute.questionId);
      } else {
        loadQuestion(0);
      }
    }
  }

  function onExit() {
    closePicker({ restoreFocus: false });
    // Stop audio
    if (elements.audioElement) {
      if (state.activeLoadedMetadataListener) {
        elements.audioElement.removeEventListener('loadedmetadata', state.activeLoadedMetadataListener);
        state.activeLoadedMetadataListener = null;
      }
      elements.audioElement.pause();
      elements.audioElement.src = '';
    }
    setAudioControlsEnabled(false);
    resetAudioProgress();
    onAudioPause();
    state.tokens = [];
    state.submitted = false;
    state.explanationVisible = false;
  }

  window.HIWMode = {
    activate,
    onExit
  };

  // Deep-link routing
  window.addEventListener('practice-route-question', async (event) => {
    const { mode, questionId } = event.detail || {};
    if (mode !== 'hiw' || !questionId) return;
    await loadQuestionByIdOrFirst(questionId);
  });
})();
