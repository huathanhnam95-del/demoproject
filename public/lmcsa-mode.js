/* eslint-disable no-console */
(function () {
  'use strict';

  const EXCEL_PATH = '/database/LMCSA/LMCSA/LMCSA.xlsx';
  const MANIFEST_PATH = '/database/LMCSA/audio/manifest.json';

  const state = {
    initialized: false,
    questions: [],
    audioManifest: {},
    currentQuestionIndex: 0,
    currentQuestion: null,
    selectedIndices: new Set(),
    shuffledChoices: [],
    submitted: false,
    pickerOpen: false,
    explanationVisible: false,
    explanationFontScale: 100,
    currentSpeed: 1.0,
    activeVoiceId: null
  };

  const elements = {};

  function sanitizeExplanationHtml(rawHtml) {
    const allowedTags = new Set(['P', 'STRONG', 'B', 'EM', 'I', 'UL', 'OL', 'LI', 'BR', 'H3', 'H4']);
    const parser = new DOMParser();
    const doc = parser.parseFromString(String(rawHtml || ''), 'text/html');

    const cleanNode = (node) => {
      if (node.nodeType === Node.COMMENT_NODE) {
        node.remove();
        return;
      }

      if (node.nodeType !== Node.ELEMENT_NODE) return;

      if (!allowedTags.has(node.tagName)) {
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

  function parseMarkdownInHtml(html) {
    if (!html) return '';
    let parsed = html;
    parsed = parsed.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    parsed = parsed.replace(/`(.*?)`/g, '<span class="lmcsa-inline-code">$1</span>');
    return parsed;
  }

  function safeRenderHtml(rawHtml, container) {
    if (!container) return;
    container.replaceChildren(); // clear previous content safely
    const cleanHtml = parseMarkdownInHtml(sanitizeExplanationHtml(rawHtml));
    
    // Parse using DOMParser (fully inert)
    const parser = new DOMParser();
    const doc = parser.parseFromString(cleanHtml, 'text/html');
    
    // Append children safely
    Array.from(doc.body.childNodes).forEach(node => {
      container.appendChild(node.cloneNode(true));
    });
  }

  function shuffleArray(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
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

  function appendScoreDescription(container, score, total) {
    const descDiv = document.createElement('div');
    descDiv.className = 'lmcsa-result-desc';
    descDiv.append('You scored ');

    const scoreStrong = document.createElement('strong');
    scoreStrong.textContent = String(score);
    descDiv.appendChild(scoreStrong);

    descDiv.append(' out of ');

    const totalStrong = document.createElement('strong');
    totalStrong.textContent = String(total);
    descDiv.appendChild(totalStrong);

    descDiv.append(' maximum possible points.');
    container.appendChild(descDiv);
  }

  function cacheElements() {
    // v7 question picker elements
    elements.prevBtn = document.getElementById('lmcsa-v7-prev-btn');
    elements.nextBtn = document.getElementById('lmcsa-v7-next-btn');
    elements.questionPill = document.getElementById('lmcsa-v7-question-pill');
    elements.backdrop = document.getElementById('lmcsa-v7-backdrop');
    elements.sheet = document.getElementById('lmcsa-v7-sheet');
    elements.sheetClose = document.getElementById('lmcsa-v7-sheet-close');
    elements.jumpSearch = document.getElementById('lmcsa-v7-jump-search');
    elements.jumpList = document.getElementById('lmcsa-v7-jump-list');

    // audio element and player elements
    elements.audioElement = document.getElementById('lmcsa-audio-element');
    elements.playBtn = document.getElementById('lmcsa-play-btn');
    elements.playIcon = document.getElementById('lmcsa-play-icon');
    elements.playLabel = document.getElementById('lmcsa-play-label');
    elements.progressFill = document.getElementById('lmcsa-progress-fill');
    elements.seek = document.getElementById('lmcsa-seek');
    elements.audioTime = document.getElementById('lmcsa-audio-time');
    elements.volume = document.getElementById('lmcsa-volume');
    elements.voiceSelect = document.getElementById('lmcsa-voice-select');
    elements.speedBtns = document.querySelectorAll('.lmcsa-speed-btn');

    // practice card elements
    elements.passageText = document.getElementById('lmcsa-passage-text'); // audio transcript text container
    elements.questionPrompt = document.getElementById('lmcsa-question-prompt');
    elements.choicesContainer = document.getElementById('lmcsa-choices-container');

    // action buttons
    elements.submitBtn = document.getElementById('lmcsa-submit-btn');
    elements.retryBtn = document.getElementById('lmcsa-retry-btn');

    // results and explanations
    elements.resultBox = document.getElementById('lmcsa-result-box');
    elements.reviewContent = document.getElementById('lmcsa-review-content');
    elements.containerEl = document.querySelector('.lmcsa-container');
    elements.explanationContent = document.getElementById('lmcsa-explanation-content');
    elements.fontDecrease = document.getElementById('lmcsa-font-decrease');
    elements.fontIncrease = document.getElementById('lmcsa-font-increase');
    elements.fontLabel = document.getElementById('lmcsa-font-label');
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

    if (elements.fontDecrease) {
      elements.fontDecrease.addEventListener('click', () => adjustFontSize(-10));
    }
    if (elements.fontIncrease) {
      elements.fontIncrease.addEventListener('click', () => adjustFontSize(10));
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

    if (elements.volume) {
      elements.volume.addEventListener('input', () => {
        if (elements.audioElement) {
          elements.audioElement.volume = Number(elements.volume.value);
        }
      });
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
  }

  /* Audio player logic */
  function toggleAudio() {
    if (!elements.audioElement || !elements.audioElement.src) return;

    if (elements.audioElement.paused) {
      elements.audioElement.volume = Number(elements.volume?.value ?? 1);
      elements.audioElement.playbackRate = state.currentSpeed;
      elements.audioElement.play().catch((err) => {
        console.error('[LMCSAMode] Play failed:', err);
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

    const audioUrl = `/database/LMCSA/audio/${qId}/${voiceMeta.file}`;
    const wasPlaying = !elements.audioElement.paused;
    const curTime = elements.audioElement.currentTime;

    if (window.MediaUrlResolver && typeof window.MediaUrlResolver.loadAudio === 'function') {
      window.MediaUrlResolver.loadAudio(elements.audioElement, audioUrl, { mode: 'LMCSA' });
    } else {
      elements.audioElement.src = audioUrl;
      elements.audioElement.load();
    }

    const restoreState = () => {
      elements.audioElement.currentTime = curTime;
      elements.audioElement.playbackRate = state.currentSpeed;
      if (wasPlaying) {
        elements.audioElement.play().catch((err) => console.log('[LMCSAMode] Switch play failed:', err));
      }
      elements.audioElement.removeEventListener('loadedmetadata', restoreState);
    };

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

  function closePicker() {
    if (!elements.sheet || !elements.backdrop) return;
    state.pickerOpen = false;
    elements.backdrop.classList.remove('is-visible');
    elements.backdrop.setAttribute('aria-hidden', 'true');
    elements.sheet.classList.remove('is-open');
    elements.sheet.setAttribute('aria-hidden', 'true');
    if (elements.questionPill) {
      elements.questionPill.setAttribute('aria-expanded', 'false');
    }
  }

  function resetFeedbackUI() {
    state.explanationVisible = false;
    if (elements.retryBtn) {
      elements.retryBtn.style.display = 'none';
    }
    if (elements.resultBox) {
      elements.resultBox.style.display = 'none';
      elements.resultBox.replaceChildren();
    }
    if (elements.containerEl) {
      elements.containerEl.classList.remove('is-reviewed');
    }
    if (elements.reviewContent) {
      elements.reviewContent.style.display = 'none';
    }
    if (elements.explanationContent) {
      elements.explanationContent.replaceChildren();
      elements.explanationContent.style.fontSize = '';
    }
    state.explanationFontScale = 100;
    if (elements.fontLabel) elements.fontLabel.textContent = '100%';
    if (elements.fontDecrease) elements.fontDecrease.disabled = false;
    if (elements.fontIncrease) elements.fontIncrease.disabled = false;
  }

  function setLoadingState(message) {
    if (elements.questionPrompt) {
      elements.questionPrompt.textContent = message;
    }
    if (elements.choicesContainer) {
      elements.choicesContainer.replaceChildren();
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

    // 1. Fetch Excel question bank
    const excelRes = await fetch(`${EXCEL_PATH}?v=${Date.now()}`);
    if (!excelRes.ok) {
      throw new Error(`Failed to fetch Excel database: ${excelRes.statusText}`);
    }
    const arrayBuffer = await excelRes.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rawData = XLSX.utils.sheet_to_json(sheet);

    // 2. Fetch Audio Manifest
    try {
      const manifestRes = await fetch(`${MANIFEST_PATH}?v=${Date.now()}`);
      if (manifestRes.ok) {
        state.audioManifest = await manifestRes.json();
      } else {
        console.warn('[LMCSAMode] Manifest res failed, falling back to empty manifest');
        state.audioManifest = {};
      }
    } catch (err) {
      console.error('[LMCSAMode] Error fetching manifest.json:', err);
      state.audioManifest = {};
    }

    state.questions = rawData.map((row) => {
      // Split ANSWER column which contains: prompt, separator (---), then radio choices
      const parts = String(row.ANSWER || '').split(/\r?\n-+\r?\n|---\r?\n|\r?\n---/);
      const cleanParts = parts.map(p => p.trim()).filter(Boolean);

      let question = '';
      let choicesRaw = '';

      if (cleanParts.length >= 2) {
        question = cleanParts[0];
        choicesRaw = cleanParts[1];
      } else {
        choicesRaw = String(row.ANSWER || '').trim();
      }

      const choices = [];
      choicesRaw.split('\n').forEach((line) => {
        const cleanLine = line.trim();
        if (!cleanLine) return;
        const match = cleanLine.match(/^\[([xX\s]*)\]\s*(.*)$/);
        if (match) {
          choices.push({
            text: match[2].trim(),
            isCorrect: match[1].toLowerCase().includes('x')
          });
        }
      });

      return {
        id: Number(row.ID) || 0,
        title: String(row.TITLE || '').trim(),
        transcript: String(row['ANSWER FOR COMPARE OR TRANSCRIPT'] || '').trim(),
        question,
        choices,
        explanation: String(row.EXPLANATION || '').trim()
      };
    }).filter((question) => {
      const isValid = question.id > 0 && question.choices.length > 0;
      if (!isValid) {
        console.warn('[LMCSAMode] Skipping invalid workbook row:', question);
      }
      return isValid;
    }).sort((a, b) => a.id - b.id);
  }

  /* Load Question */
  function loadQuestion(index) {
    if (index < 0 || index >= state.questions.length) return;

    // Reset current audio playback
    if (elements.audioElement) {
      elements.audioElement.pause();
      elements.audioElement.src = '';
    }
    setAudioControlsEnabled(false);
    resetAudioProgress();
    onAudioPause();

    state.currentQuestionIndex = index;
    state.currentQuestion = state.questions[index];
    state.selectedIndices.clear();
    state.submitted = false;
    state.explanationVisible = false;

    // Shuffle choices on load
    state.shuffledChoices = shuffleArray(state.currentQuestion.choices);

    closePicker();
    updateNavigationUI();
    renderQuestion();

    if (window.PracticeRouter && state.currentQuestion?.id != null) {
      window.PracticeRouter.replaceRoute('lmcsa', state.currentQuestion.id);
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

        // Load the first voice by default
        state.activeVoiceId = voices[0].id;
        elements.voiceSelect.value = voices[0].id;
        const firstVoiceUrl = `/database/LMCSA/audio/${qId}/${voices[0].file}`;
        if (elements.audioElement) {
          if (window.MediaUrlResolver && typeof window.MediaUrlResolver.loadAudio === 'function') {
            window.MediaUrlResolver.loadAudio(elements.audioElement, firstVoiceUrl, { mode: 'LMCSA' });
          } else {
            elements.audioElement.src = firstVoiceUrl;
            elements.audioElement.load();
          }
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

    // Reset progress text and visualizer
    resetAudioProgress();

    // Apply speed settings to player
    if (elements.audioElement) {
      elements.audioElement.playbackRate = state.currentSpeed;
    }

    // 2. Render question prompt
    if (elements.questionPrompt) {
      elements.questionPrompt.textContent = state.currentQuestion.question || 'Select the correct option based on the audio recording.';
    }

    // 3. Render choices list
    if (elements.choicesContainer) {
      elements.choicesContainer.replaceChildren();
      
      state.shuffledChoices.forEach((choice, idx) => {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'lmcsa-choice-card';
        card.dataset.index = idx;
        card.setAttribute('aria-pressed', 'false');
        
        const radio = document.createElement('div');
        radio.className = 'lmcsa-choice-radio';
        card.appendChild(radio);

        const textDiv = document.createElement('div');
        textDiv.className = 'lmcsa-choice-text';
        textDiv.textContent = choice.text;
        card.appendChild(textDiv);

        card.addEventListener('click', () => selectChoice(idx));
        elements.choicesContainer.appendChild(card);
      });
    }

    // 4. Reset button display states
    if (elements.submitBtn) {
      elements.submitBtn.style.display = 'block';
      elements.submitBtn.disabled = true; // Disabled until an option is selected
    }
    resetFeedbackUI();
  }

  function selectChoice(idx) {
    if (state.submitted) return;

    // Single choice selection (radio button behavior)
    state.selectedIndices.clear();
    state.selectedIndices.add(idx);

    // Update option card active classes
    if (elements.choicesContainer) {
      const cards = elements.choicesContainer.querySelectorAll('.lmcsa-choice-card');
      cards.forEach((card, i) => {
        const isSelected = state.selectedIndices.has(i);
        card.classList.toggle('is-selected', isSelected);
        card.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
      });
    }

    // Update submit button disabled status
    if (elements.submitBtn) {
      elements.submitBtn.disabled = false;
    }
  }

  /* Submit flow */
  function submitAnswers() {
    if (state.submitted || state.selectedIndices.size === 0) return;
    state.submitted = true;

    // Pause audio playback on submission
    if (elements.audioElement) {
      elements.audioElement.pause();
    }
    onAudioPause();

    // Disable choices interaction
    const cards = elements.choicesContainer.querySelectorAll('.lmcsa-choice-card');
    cards.forEach((card) => {
      card.disabled = true;
    });

    let score = 0;

    state.shuffledChoices.forEach((choice, idx) => {
      const isSelected = state.selectedIndices.has(idx);

      const card = cards[idx];
      if (choice.isCorrect && isSelected) {
        score = 1;
        card.classList.remove('is-selected');
        card.classList.add('is-correct-selected'); // Solid green border & soft green bg
      } else if (!choice.isCorrect && isSelected) {
        card.classList.remove('is-selected');
        card.classList.add('is-incorrect-selected'); // Solid red border & soft red bg
      } else if (choice.isCorrect && !isSelected) {
        card.classList.add('is-missed-correct'); // Dashed green border
      } else {
        card.classList.add('is-disabled'); // Faded out
      }
    });

    // Show score banner
    if (elements.resultBox) {
      elements.resultBox.style.display = 'block';
      elements.resultBox.replaceChildren();
      
      const titleClass = score === 1 ? 'is-correct' : 'is-incorrect';
      const titleText = score === 1 ? 'Correct!' : 'Incorrect';

      const headerDiv = document.createElement('div');
      headerDiv.className = `lmcsa-result-header ${titleClass}`;
      headerDiv.textContent = titleText;
      elements.resultBox.appendChild(headerDiv);
      appendScoreDescription(elements.resultBox, score, 1);
    }

    // Toggle button visibilities
    if (elements.submitBtn) {
      elements.submitBtn.style.display = 'none';
    }
    if (elements.retryBtn) {
      elements.retryBtn.style.display = 'block';
    }

    window.PTEAttemptArchive?.saveChoiceAttempt?.('lmcsa', state, {
      score,
      maxScore: 1,
      correct: score === 1
    }).catch((error) => console.warn('[PTE Archive] LMCSA save failed:', error));

    // Render transcript and explanation post-submission
    if (elements.passageText) {
      elements.passageText.textContent = state.currentQuestion.transcript || 'No transcript available for this audio.';
    }

    if (state.currentQuestion.explanation || state.currentQuestion.transcript) {
      if (elements.explanationContent) {
        const explanation = state.currentQuestion.explanation ||
          '<p>No detailed explanation is available for this question yet. Use the transcript to review the evidence before retrying.</p>';
        safeRenderHtml(explanation, elements.explanationContent);
      }
      if (elements.containerEl) {
        elements.containerEl.classList.add('is-reviewed');
      }
    }
  }

  function adjustFontSize(delta) {
    const MIN = 70, MAX = 150;
    state.explanationFontScale = Math.max(MIN, Math.min(MAX, state.explanationFontScale + delta));
    if (elements.explanationContent) {
      elements.explanationContent.style.fontSize = (0.96 * state.explanationFontScale / 100) + 'rem';
    }
    if (elements.fontLabel) {
      elements.fontLabel.textContent = state.explanationFontScale + '%';
    }
    if (elements.fontDecrease) elements.fontDecrease.disabled = state.explanationFontScale <= MIN;
    if (elements.fontIncrease) elements.fontIncrease.disabled = state.explanationFontScale >= MAX;
  }

  async function loadQuestionById(questionId) {
    if (state.questions.length === 0) {
      await loadData();
    }
    const numericId = Number(questionId);
    const index = state.questions.findIndex(q => Number(q.id) === numericId);
    if (index !== -1) {
      loadQuestion(index);
    }
  }

  /* Global Controller Hooks */
  async function activate() {
    cacheElements();
    if (!state.initialized) {
      setupEventListeners();
      state.initialized = true;
    }

    if (state.questions.length === 0) {
      setLoadingState('Loading listening questions...');
      try {
        await loadData();
      } catch (error) {
        console.error('[LMCSAMode] Error loading excel database:', error);
        setLoadingState('Failed to load question database. Please check your network connection and reload.');
        return;
      }
    }

    if (state.questions.length > 0) {
      const urlRoute = window.PracticeRouter ? window.PracticeRouter.initFromURL() : null;
      if (urlRoute && urlRoute.mode === 'lmcsa' && urlRoute.questionId) {
        await loadQuestionById(urlRoute.questionId);
      } else {
        loadQuestion(0);
      }
    }
  }

  function onExit() {
    closePicker();
    // Stop audio playback
    if (elements.audioElement) {
      elements.audioElement.pause();
      elements.audioElement.src = '';
    }
    setAudioControlsEnabled(false);
    resetAudioProgress();
    onAudioPause();
    state.selectedIndices.clear();
    state.submitted = false;
    state.explanationVisible = false;
  }

  window.LMCSAMode = {
    activate,
    onExit
  };

  // Deep-link support: listen for PracticeRouter question navigation events
  window.addEventListener('practice-route-question', async (event) => {
    const { mode, questionId } = event.detail || {};
    if (mode !== 'lmcsa' || !questionId) return;
    await loadQuestionById(questionId);
  });
})();
