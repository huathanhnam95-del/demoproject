/* eslint-disable no-console */
(function () {
  'use strict';

  const EXCEL_PATH = '/database/SMW/SMW/SMW.xlsx';
  const MANIFEST_PATH = '/database/SMW/audio/manifest.json';
  const ALLOWED_EXPLANATION_TAGS = new Set(['P', 'STRONG', 'B', 'EM', 'I', 'UL', 'OL', 'LI', 'BR', 'H3', 'H4']);

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
    currentSpeed: 1.0,
    activeVoiceId: null,
    activeLoadedMetadataListener: null
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
    if (elements.timeCurrent) elements.timeCurrent.textContent = '00:00';
    if (elements.timeDuration) elements.timeDuration.textContent = '00:00';
    if (elements.timelineFill) elements.timelineFill.style.width = '0%';
    if (elements.timelineThumb) elements.timelineThumb.style.left = '0%';
  }

  function setAudioControlsEnabled(enabled) {
    if (elements.playBtn) {
      elements.playBtn.disabled = !enabled;
      elements.playBtn.setAttribute('aria-disabled', enabled ? 'false' : 'true');
    }
    if (elements.timelineWrapper) {
      elements.timelineWrapper.setAttribute('aria-disabled', enabled ? 'false' : 'true');
    }
  }

  function appendScoreDescription(container, score, total) {
    const descDiv = document.createElement('div');
    descDiv.className = 'smw-result-desc';
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
    elements.prevBtn = document.getElementById('smw-v7-prev-btn');
    elements.nextBtn = document.getElementById('smw-v7-next-btn');
    elements.questionPill = document.getElementById('smw-v7-question-pill');
    elements.backdrop = document.getElementById('smw-v7-backdrop');
    elements.sheet = document.getElementById('smw-v7-sheet');
    elements.sheetClose = document.getElementById('smw-v7-sheet-close');
    elements.jumpSearch = document.getElementById('smw-v7-jump-search');
    elements.jumpList = document.getElementById('smw-v7-jump-list');

    // audio element and player elements
    elements.audioElement = document.getElementById('smw-audio-element');
    elements.visualizer = document.getElementById('smw-visualizer');
    elements.playBtn = document.getElementById('smw-play-btn');
    elements.playIcon = document.getElementById('smw-play-icon');
    elements.pauseIcon = document.getElementById('smw-pause-icon');
    elements.timelineWrapper = document.getElementById('smw-timeline-wrapper');
    elements.timelineFill = document.getElementById('smw-timeline-fill');
    elements.timelineThumb = document.getElementById('smw-timeline-thumb');
    elements.timeCurrent = document.getElementById('smw-time-current');
    elements.timeDuration = document.getElementById('smw-time-duration');
    elements.voiceSelect = document.getElementById('smw-voice-select');
    elements.speedBtns = document.querySelectorAll('.smw-speed-btn');

    // practice card elements
    elements.passageText = document.getElementById('smw-passage-text'); // audio transcript text container
    elements.questionPrompt = document.getElementById('smw-question-prompt');
    elements.choicesContainer = document.getElementById('smw-choices-container');

    // action buttons
    elements.submitBtn = document.getElementById('smw-submit-btn');
    elements.retryBtn = document.getElementById('smw-retry-btn');
    elements.explanationToggle = document.getElementById('smw-explanation-toggle');

    // results and explanations
    elements.resultBox = document.getElementById('smw-result-box');
    elements.explanationPanel = document.getElementById('smw-explanation-panel');
    elements.explanationContent = document.getElementById('smw-explanation-content');
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

    if (elements.timelineWrapper) {
      elements.timelineWrapper.addEventListener('click', seekAudio);
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
      elements.audioElement.playbackRate = state.currentSpeed;
      elements.audioElement.play().catch((err) => {
        console.error('[SMWMode] Play failed:', err);
      });
    } else {
      elements.audioElement.pause();
    }
  }

  function onAudioPlay() {
    if (elements.playIcon) elements.playIcon.style.display = 'none';
    if (elements.pauseIcon) elements.pauseIcon.style.display = 'block';
    if (elements.visualizer) elements.visualizer.classList.add('is-playing');
  }

  function onAudioPause() {
    if (elements.playIcon) elements.playIcon.style.display = 'block';
    if (elements.pauseIcon) elements.pauseIcon.style.display = 'none';
    if (elements.visualizer) elements.visualizer.classList.remove('is-playing');
  }

  function onAudioEnded() {
    onAudioPause();
    if (elements.audioElement) {
      elements.audioElement.currentTime = 0;
    }
    resetAudioProgress();
  }

  // Visual feedback update of timeline progress
  function updateAudioProgress() {
    const audio = elements.audioElement;
    if (!audio || !audio.duration) return;

    const percentage = (audio.currentTime / audio.duration) * 100;
    if (elements.timelineFill) elements.timelineFill.style.width = `${percentage}%`;
    if (elements.timelineThumb) elements.timelineThumb.style.left = `${percentage}%`;
    if (elements.timeCurrent) elements.timeCurrent.textContent = formatTime(audio.currentTime);
  }

  function updateAudioDuration() {
    const audio = elements.audioElement;
    if (!audio || !audio.duration) return;
    if (elements.timeDuration) elements.timeDuration.textContent = formatTime(audio.duration);
  }

  function seekAudio(e) {
    const audio = elements.audioElement;
    const wrapper = elements.timelineWrapper;
    if (!audio || !audio.duration || !wrapper) return;

    const rect = wrapper.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, clickX / rect.width));
    
    audio.currentTime = percentage * audio.duration;
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

    // Clean up any pending listener before starting a new load
    if (state.activeLoadedMetadataListener) {
      elements.audioElement.removeEventListener('loadedmetadata', state.activeLoadedMetadataListener);
      state.activeLoadedMetadataListener = null;
    }

    const audioUrl = `/database/SMW/audio/${qId}/${voiceMeta.file}`;
    const wasPlaying = !elements.audioElement.paused;
    const curTime = elements.audioElement.currentTime;

    elements.audioElement.src = audioUrl;
    elements.audioElement.load();

    const restoreState = () => {
      elements.audioElement.currentTime = curTime;
      elements.audioElement.playbackRate = state.currentSpeed;
      if (wasPlaying) {
        elements.audioElement.play().catch((err) => console.log('[SMWMode] Switch play failed:', err));
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
    if (elements.passageText) {
      elements.passageText.replaceChildren();
    }
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
        console.warn('[SMWMode] Manifest res failed, falling back to empty manifest');
        state.audioManifest = {};
      }
    } catch (err) {
      console.error('[SMWMode] Error fetching manifest.json:', err);
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
        console.warn('[SMWMode] Skipping invalid workbook row:', question);
      }
      return isValid;
    }).sort((a, b) => a.id - b.id);
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
    state.selectedIndices.clear();
    state.submitted = false;
    state.explanationVisible = false;

    // Shuffle choices on load
    state.shuffledChoices = shuffleArray(state.currentQuestion.choices);

    closePicker();
    updateNavigationUI();
    renderQuestion();

    if (window.PracticeRouter && state.currentQuestion?.id != null) {
      window.PracticeRouter.replaceRoute('smw', state.currentQuestion.id);
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
        const firstVoiceUrl = `/database/SMW/audio/${qId}/${voices[0].file}`;
        if (elements.audioElement) {
          elements.audioElement.src = firstVoiceUrl;
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
        card.className = 'smw-choice-card';
        card.dataset.index = idx;
        card.setAttribute('aria-pressed', 'false');
        
        const radio = document.createElement('div');
        radio.className = 'smw-choice-radio';
        card.appendChild(radio);

        const textDiv = document.createElement('div');
        textDiv.className = 'smw-choice-text';
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
      const cards = elements.choicesContainer.querySelectorAll('.smw-choice-card');
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
    const cards = elements.choicesContainer.querySelectorAll('.smw-choice-card');
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
      headerDiv.className = `smw-result-header ${titleClass}`;
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

    // Render transcript and explanation post-submission
    if (elements.passageText) {
      let rawTranscript = state.currentQuestion.transcript || 'No transcript available for this audio.';
      
      // Special UX: Replace trailing [BEEP] with a bold highlighted correct answer
      const correctChoice = state.currentQuestion.choices.find(c => c.isCorrect);
      const correctText = correctChoice ? escapeHtmlText(correctChoice.text) : '';
      
      const beepPattern = /\[BEEP\]\s*$/i;
      if (beepPattern.test(rawTranscript)) {
        rawTranscript = rawTranscript.replace(beepPattern, '').trim();
        rawTranscript = rawTranscript + ` <strong>${correctText}</strong>.`;
      }
      
      safeRenderHtml(rawTranscript, elements.passageText);
    }

    if (elements.explanationToggle && (state.currentQuestion.explanation || state.currentQuestion.transcript)) {
      elements.explanationToggle.style.display = 'block';
      if (elements.explanationContent) {
        const explanation = state.currentQuestion.explanation ||
          '<p>No detailed explanation is available for this question yet. Use the transcript to review the evidence before retrying.</p>';
        safeRenderHtml(explanation, elements.explanationContent);
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
      setLoadingState('Loading Select Missing Word database...');
      try {
        await loadData();
      } catch (error) {
        console.error('[SMWMode] Error loading excel database:', error);
        setLoadingState('Failed to load question database. Please check your network connection and reload.');
        return;
      }
    }

    if (state.questions.length > 0) {
      const urlRoute = window.PracticeRouter ? window.PracticeRouter.initFromURL() : null;
      if (urlRoute && urlRoute.mode === 'smw' && urlRoute.questionId) {
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
    state.selectedIndices.clear();
    state.submitted = false;
    state.explanationVisible = false;
  }

  window.SMWMode = {
    activate,
    onExit
  };

  // Deep-link support: listen for PracticeRouter question navigation events
  window.addEventListener('practice-route-question', async (event) => {
    const { mode, questionId } = event.detail || {};
    if (mode !== 'smw' || !questionId) return;
    await loadQuestionById(questionId);
  });
})();
