(function () {
  'use strict';

  const EXCEL_PATH = '/database/RMCSA/RMCSA/RMCSA.xlsx';

  const state = {
    initialized: false,
    questions: [],
    currentQuestionIndex: 0,
    currentQuestion: null,
    selectedIndices: new Set(),
    shuffledChoices: [],
    submitted: false,
    pickerOpen: false,
    explanationVisible: false
  };

  const elements = {};

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  function sanitizeExplanationHtml(rawHtml) {
    const allowedTags = new Set(['P', 'STRONG', 'B', 'EM', 'I', 'UL', 'OL', 'LI', 'BR', 'H3', 'H4']);
    const template = document.createElement('template');
    template.innerHTML = String(rawHtml || '');

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

    Array.from(template.content.childNodes).forEach(cleanNode);
    return template.innerHTML;
  }

  function parseMarkdownInHtml(html) {
    if (!html) return '';
    let parsed = html;
    parsed = parsed.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    parsed = parsed.replace(/`(.*?)`/g, '<span class="rop-highlight">$1</span>');
    return parsed;
  }

  function shuffleArray(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function parseRmcsaAnswer(answerText) {
    const normalized = String(answerText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
    let parts = normalized
      .split(/\n\s*-{3,}\s*\n/)
      .map((part) => part.trim())
      .filter(Boolean);

    if (parts.length < 3) {
      parts = normalized
        .split(/-{3,}/)
        .map((part) => part.trim())
        .filter(Boolean);
    }

    const passage = parts.length >= 1 ? parts[0] : normalized;
    const question = parts.length >= 2 ? parts[1] : '';
    const choicesRaw = parts.length >= 3 ? parts.slice(2).join('\n') : '';

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

    return { passage, question, choices };
  }

  function cacheElements() {
    // v7 question picker elements
    elements.prevBtn = document.getElementById('rmcsa-v7-prev-btn');
    elements.nextBtn = document.getElementById('rmcsa-v7-next-btn');
    elements.questionPill = document.getElementById('rmcsa-v7-question-pill');
    elements.backdrop = document.getElementById('rmcsa-v7-backdrop');
    elements.sheet = document.getElementById('rmcsa-v7-sheet');
    elements.sheetClose = document.getElementById('rmcsa-v7-sheet-close');
    elements.jumpSearch = document.getElementById('rmcsa-v7-jump-search');
    elements.jumpList = document.getElementById('rmcsa-v7-jump-list');

    // practice card elements
    elements.passageText = document.getElementById('rmcsa-passage-text');
    elements.questionPrompt = document.getElementById('rmcsa-question-prompt');
    elements.choicesContainer = document.getElementById('rmcsa-choices-container');

    // action buttons
    elements.submitBtn = document.getElementById('rmcsa-submit-btn');
    elements.retryBtn = document.getElementById('rmcsa-retry-btn');
    elements.explanationToggle = document.getElementById('rmcsa-explanation-toggle');

    // results and explanations
    elements.resultBox = document.getElementById('rmcsa-result-box');
    elements.explanationPanel = document.getElementById('rmcsa-explanation-panel');
    elements.explanationContent = document.getElementById('rmcsa-explanation-content');
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
    }
    if (elements.resultBox) {
      elements.resultBox.style.display = 'none';
      elements.resultBox.innerHTML = '';
    }
    if (elements.explanationPanel) {
      elements.explanationPanel.style.display = 'none';
    }
    if (elements.explanationContent) {
      elements.explanationContent.innerHTML = '';
    }
  }

  function setLoadingState(message) {
    if (elements.passageText) {
      elements.passageText.textContent = message;
    }
    if (elements.questionPrompt) {
      elements.questionPrompt.textContent = '';
    }
    if (elements.choicesContainer) {
      elements.choicesContainer.innerHTML = '';
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

    const itemsHtml = state.questions
      .map((q, idx) => {
        const isActive = idx === state.currentQuestionIndex;
        const matchesFilter = !cleanFilter ||
          String(q.id).includes(cleanFilter) ||
          q.title.toLowerCase().includes(cleanFilter);

        if (!matchesFilter) return '';

        return `
          <button class="ra-v7-list-item${isActive ? ' is-active' : ''}" type="button" data-index="${idx}" role="option" ${isActive ? 'aria-selected="true"' : ''}>
            <span class="ra-v7-item-id">#${q.id}</span>
            <span class="ra-v7-item-title">${escapeHtml(q.title)}</span>
          </button>
        `;
      })
      .filter(Boolean)
      .join('');

    elements.jumpList.innerHTML = itemsHtml || '<div class="ra-v7-empty">No matching questions</div>';
  }

  function updateNavigationUI() {
    if (elements.prevBtn) {
      elements.prevBtn.disabled = state.currentQuestionIndex <= 0;
    }
    if (elements.nextBtn) {
      elements.nextBtn.disabled = state.currentQuestionIndex >= state.questions.length - 1;
    }
    if (elements.questionPill && state.currentQuestion) {
      elements.questionPill.textContent = `#${state.currentQuestion.id} — ${state.currentQuestion.title}`;
    }
  }

  /* Load Excel Data */
  async function loadData() {
    if (typeof XLSX === 'undefined') {
      throw new Error('XLSX library is not loaded. Cannot parse Excel database.');
    }

    const response = await fetch(`${EXCEL_PATH}?v=${Date.now()}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch Excel database: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rawData = XLSX.utils.sheet_to_json(sheet);

    state.questions = rawData.map((row) => {
      const parsed = parseRmcsaAnswer(row.ANSWER);

      return {
        id: Number(row.ID) || 0,
        title: String(row.TITLE || '').trim(),
        passage: parsed.passage,
        question: parsed.question,
        choices: parsed.choices,
        explanation: String(row.EXPLANATION || '').trim()
      };
    }).sort((a, b) => a.id - b.id);
  }

  /* Load Question */
  function loadQuestion(index) {
    if (index < 0 || index >= state.questions.length) return;

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
      window.PracticeRouter.replaceRoute('rmcsa', state.currentQuestion.id);
    }
  }

  function renderQuestion() {
    if (!state.currentQuestion) return;

    // Render passage
    if (elements.passageText) {
      elements.passageText.textContent = state.currentQuestion.passage;
    }

    // Render question prompt
    if (elements.questionPrompt) {
      elements.questionPrompt.textContent = state.currentQuestion.question || 'Select the correct option based on the text.';
    }

    // Render choices
    if (elements.choicesContainer) {
      elements.choicesContainer.innerHTML = '';
      elements.choicesContainer.setAttribute('role', 'radiogroup');
      elements.choicesContainer.setAttribute('aria-label', 'Answer options');
      state.shuffledChoices.forEach((choice, idx) => {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'rmcsa-choice-card';
        card.dataset.index = idx;
        card.setAttribute('role', 'radio');
        card.setAttribute('aria-checked', 'false');
        card.innerHTML = `
          <div class="rmcsa-choice-radio"></div>
          <div class="rmcsa-choice-text">${escapeHtml(choice.text)}</div>
        `;
        card.addEventListener('click', () => selectChoice(idx));
        elements.choicesContainer.appendChild(card);
      });
    }

    // Reset button display states
    if (elements.submitBtn) {
      elements.submitBtn.style.display = 'block';
      elements.submitBtn.disabled = true; // Disabled until an option is selected
    }
    resetFeedbackUI();
  }

  function selectChoice(idx) {
    if (state.submitted) return;

    // Single choice behavior: clear previous and set new
    state.selectedIndices.clear();
    state.selectedIndices.add(idx);

    // Update option card active classes
    if (elements.choicesContainer) {
      const cards = elements.choicesContainer.querySelectorAll('.rmcsa-choice-card');
      cards.forEach((card, i) => {
        const isSelected = state.selectedIndices.has(i);
        card.classList.toggle('is-selected', isSelected);
        card.setAttribute('aria-checked', isSelected ? 'true' : 'false');
      });
    }

    // Update submit button disabled status
    if (elements.submitBtn) {
      elements.submitBtn.disabled = state.selectedIndices.size === 0;
    }
  }

  /* Submit flow */
  function submitAnswers() {
    if (state.submitted || state.selectedIndices.size === 0) return;
    state.submitted = true;

    // Disable choices interaction
    const cards = elements.choicesContainer.querySelectorAll('.rmcsa-choice-card');
    cards.forEach((card) => {
      card.disabled = true;
    });

    let correctCount = 0;
    let selectedCorrect = false;

    state.shuffledChoices.forEach((choice, idx) => {
      const isSelected = state.selectedIndices.has(idx);
      const card = cards[idx];
      if (choice.isCorrect && isSelected) {
        correctCount = 1;
        selectedCorrect = true;
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
      let titleClass = 'is-incorrect';
      let titleText = 'Incorrect';
      if (selectedCorrect) {
        titleClass = 'is-correct';
        titleText = 'Correct!';
      }

      elements.resultBox.innerHTML = `
        <div class="rmcsa-result-header ${titleClass}">${titleText}</div>
        <div class="rmcsa-result-desc">You scored <strong>${correctCount}</strong> out of <strong>1</strong> maximum possible points.</div>
      `;
    }

    // Toggle button visibilities
    if (elements.submitBtn) {
      elements.submitBtn.style.display = 'none';
    }
    if (elements.retryBtn) {
      elements.retryBtn.style.display = 'block';
    }

    // Show explanation toggle if explanation is present
    if (elements.explanationToggle && state.currentQuestion.explanation) {
      elements.explanationToggle.style.display = 'block';
      if (elements.explanationContent) {
        elements.explanationContent.innerHTML = parseMarkdownInHtml(sanitizeExplanationHtml(state.currentQuestion.explanation));
      }
    }
  }

  function toggleExplanation() {
    if (!elements.explanationPanel || !elements.explanationToggle) return;

    state.explanationVisible = !state.explanationVisible;
    if (state.explanationVisible) {
      elements.explanationPanel.style.display = 'block';
      elements.explanationToggle.textContent = 'Hide explanation';
    } else {
      elements.explanationPanel.style.display = 'none';
      elements.explanationToggle.textContent = 'Show explanation';
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
      setLoadingState('Loading reading questions...');
      try {
        await loadData();
      } catch (error) {
        console.error('[RMCSAMode] Error loading excel database:', error);
        setLoadingState('Failed to load question database. Please check your network connection and reload.');
        return;
      }
    }

    if (state.questions.length > 0) {
      const urlRoute = window.PracticeRouter ? window.PracticeRouter.initFromURL() : null;
      if (urlRoute && urlRoute.mode === 'rmcsa' && urlRoute.questionId) {
        await loadQuestionById(urlRoute.questionId);
      } else {
        loadQuestion(0);
      }
    }
  }

  function onExit() {
    closePicker();
    state.selectedIndices.clear();
    state.submitted = false;
    state.explanationVisible = false;
  }

  window.RMCSAMode = {
    activate,
    onExit
  };

  // Deep-link support: listen for PracticeRouter question navigation events
  window.addEventListener('practice-route-question', async (event) => {
    const { mode, questionId } = event.detail || {};
    if (mode !== 'rmcsa' || !questionId) return;
    await loadQuestionById(questionId);
  });
})();
