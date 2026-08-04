(function () {
  'use strict';

  const EXCEL_PATH = '/database/RMCMA/RMCMA/RMCMA.xlsx';

  const state = {
    initialized: false,
    questions: [],
    currentQuestionIndex: 0,
    currentQuestion: null,
    selectedIndices: new Set(),
    shuffledChoices: [],
    submitted: false,
    pickerOpen: false,
    explanationVisible: false,
    randomMode: localStorage.getItem('pte_random_nav_mode') === 'true',
    navHistory: [],
    pickerPage: 1
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

  function cacheElements() {
    // v7 question picker elements
    elements.prevBtn = document.getElementById('rmcma-v7-prev-btn');
    elements.nextBtn = document.getElementById('rmcma-v7-next-btn');
    elements.randomToggleBtn = document.getElementById('rmcma-random-toggle-btn');
    elements.questionPill = document.getElementById('rmcma-v7-question-pill');
    elements.backdrop = document.getElementById('rmcma-v7-backdrop');
    elements.sheet = document.getElementById('rmcma-v7-sheet');
    elements.sheetClose = document.getElementById('rmcma-v7-sheet-close');
    elements.jumpSearch = document.getElementById('rmcma-v7-jump-search');
    elements.jumpList = document.getElementById('rmcma-v7-jump-list');

    // practice card elements
    elements.passageText = document.getElementById('rmcma-passage-text');
    elements.questionPrompt = document.getElementById('rmcma-question-prompt');
    elements.choicesContainer = document.getElementById('rmcma-choices-container');

    // action buttons
    elements.submitBtn = document.getElementById('rmcma-submit-btn');
    elements.retryBtn = document.getElementById('rmcma-retry-btn');
    elements.explanationToggle = document.getElementById('rmcma-explanation-toggle');

    // results and explanations
    elements.resultBox = document.getElementById('rmcma-result-box');
    elements.explanationPanel = document.getElementById('rmcma-explanation-panel');
    elements.explanationContent = document.getElementById('rmcma-explanation-content');
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

    if (elements.prevBtn) {
      elements.prevBtn.addEventListener('click', () => {
        if (state.randomMode && state.navHistory.length > 0) {
          const prevIdx = state.navHistory.pop();
          loadQuestion(prevIdx);
        } else if (state.currentQuestionIndex > 0) {
          loadQuestion(state.currentQuestionIndex - 1);
        }
      });
    }

    if (elements.nextBtn) {
      elements.nextBtn.addEventListener('click', () => {
        if (state.randomMode && state.questions.length > 1) {
          state.navHistory.push(state.currentQuestionIndex);
          let randomIdx;
          do {
            randomIdx = Math.floor(Math.random() * state.questions.length);
          } while (randomIdx === state.currentQuestionIndex && state.questions.length > 1);
          loadQuestion(randomIdx);
        } else if (state.currentQuestionIndex < state.questions.length - 1) {
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

  function renderJumpList(filter = '', page = null) {
    if (!elements.jumpList) return;
    const cleanFilter = filter.toLowerCase().trim();

    const filtered = state.questions
      .map((q, idx) => ({ q, idx }))
      .filter(({ q }) => {
        return !cleanFilter ||
          String(q.id).includes(cleanFilter) ||
          q.title.toLowerCase().includes(cleanFilter);
      });

    const pageSize = 20;
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));

    if (page === null || page === undefined) {
      const activeFilteredIndex = filtered.findIndex(item => item.idx === state.currentQuestionIndex);
      state.pickerPage = activeFilteredIndex >= 0 ? Math.floor(activeFilteredIndex / pageSize) + 1 : 1;
    } else {
      state.pickerPage = Math.max(1, Math.min(page, totalPages));
    }

    const currentPage = state.pickerPage;
    const pagedItems = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

    const itemsHtml = pagedItems
      .map(({ q, idx }) => {
        const isActive = idx === state.currentQuestionIndex;
        return `
          <button class="ra-v7-list-item${isActive ? ' is-active' : ''}" type="button" data-index="${idx}" role="option" ${isActive ? 'aria-selected="true"' : ''}>
            <span class="ra-v7-item-id">#${q.id}</span>
            <span class="ra-v7-item-title">${escapeHtml(q.title)}</span>
          </button>
        `;
      })
      .join('');

    const paginationHtml = totalPages > 1 ? `
      <div class="ra-v7-pagination">
        <button class="ra-v7-pagination-btn prev-page-btn" type="button" ${currentPage <= 1 ? 'disabled' : ''}>← Prev</button>
        <span class="ra-v7-pagination-info">Page ${currentPage} of ${totalPages} (${filtered.length} items)</span>
        <button class="ra-v7-pagination-btn next-page-btn" type="button" ${currentPage >= totalPages ? 'disabled' : ''}>Next →</button>
      </div>
    ` : '';

    elements.jumpList.innerHTML = (itemsHtml || '<div class="ra-v7-empty">No matching questions</div>') + paginationHtml;

    const prevPageBtn = elements.jumpList.querySelector('.prev-page-btn');
    const nextPageBtn = elements.jumpList.querySelector('.next-page-btn');
    if (prevPageBtn) {
      prevPageBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        renderJumpList(filter, currentPage - 1);
      });
    }
    if (nextPageBtn) {
      nextPageBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        renderJumpList(filter, currentPage + 1);
      });
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
      const parts = String(row.ANSWER || '').split(/\n-+\n|---\n|\n---/);
      let passage = '';
      let question = '';
      let choicesRaw = '';

      if (parts.length >= 3) {
        passage = parts[0].trim();
        question = parts[1].trim();
        choicesRaw = parts.slice(2).join('\n');
      } else {
        // Fallback: simpler split
        const simpleParts = String(row.ANSWER || '').split('---');
        if (simpleParts.length >= 3) {
          passage = simpleParts[0].trim();
          question = simpleParts[1].trim();
          choicesRaw = simpleParts.slice(2).join('\n');
        } else {
          passage = String(row.ANSWER || '').trim();
        }
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
        passage,
        question,
        choices,
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
      window.PracticeRouter.replaceRoute('rmcma', state.currentQuestion.id);
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
      elements.questionPrompt.textContent = state.currentQuestion.question || 'Select the correct options based on the text.';
    }

    // Render choices
    if (elements.choicesContainer) {
      elements.choicesContainer.innerHTML = '';
      // The options were an unlabelled bag of toggle buttons. A group with a
      // name tells a screen reader what they belong to and that more than one
      // may be chosen; checkbox matches the tick-box the sighted user sees.
      elements.choicesContainer.setAttribute('role', 'group');
      elements.choicesContainer.setAttribute('aria-label', 'Answer options — select all that apply');
      state.shuffledChoices.forEach((choice, idx) => {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'rmcma-choice-card';
        card.dataset.index = idx;
        card.setAttribute('role', 'checkbox');
        card.setAttribute('aria-checked', 'false');
        card.innerHTML = `
          <div class="rmcma-choice-checkbox"></div>
          <div class="rmcma-choice-text">${escapeHtml(choice.text)}</div>
        `;
        card.addEventListener('click', () => selectChoice(idx));
        elements.choicesContainer.appendChild(card);
      });
    }

    // Reset button display states
    if (elements.submitBtn) {
      elements.submitBtn.style.display = 'block';
      elements.submitBtn.disabled = true; // Disabled until at least one option selected
    }
    resetFeedbackUI();
  }

  function selectChoice(idx) {
    if (state.submitted) return;

    if (state.selectedIndices.has(idx)) {
      state.selectedIndices.delete(idx);
    } else {
      state.selectedIndices.add(idx);
    }

    // Update option card active classes
    if (elements.choicesContainer) {
      const cards = elements.choicesContainer.querySelectorAll('.rmcma-choice-card');
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
    const cards = elements.choicesContainer.querySelectorAll('.rmcma-choice-card');
    cards.forEach((card) => {
      card.disabled = true;
    });

    let correctCount = 0;
    let incorrectCount = 0;
    let totalCorrectChoices = 0;

    state.shuffledChoices.forEach((choice, idx) => {
      const isSelected = state.selectedIndices.has(idx);
      if (choice.isCorrect) {
        totalCorrectChoices++;
      }

      const card = cards[idx];
      if (choice.isCorrect && isSelected) {
        correctCount++;
        card.classList.remove('is-selected');
        card.classList.add('is-correct-selected'); // Solid green border & soft green bg
      } else if (!choice.isCorrect && isSelected) {
        incorrectCount++;
        card.classList.remove('is-selected');
        card.classList.add('is-incorrect-selected'); // Solid red border & soft red bg
      } else if (choice.isCorrect && !isSelected) {
        card.classList.add('is-missed-correct'); // Dashed green border
      } else {
        card.classList.add('is-disabled'); // Faded out
      }
    });

    // Score: correct choices minus incorrect, minimum 0
    const finalScore = Math.max(0, correctCount - incorrectCount);

    // Show score banner
    if (elements.resultBox) {
      elements.resultBox.style.display = 'block';
      let titleClass = 'is-partial';
      let titleText = 'Partially Correct';
      if (finalScore === totalCorrectChoices && incorrectCount === 0) {
        titleClass = 'is-correct';
        titleText = 'Correct!';
      } else if (finalScore === 0) {
        titleClass = 'is-incorrect';
        titleText = 'Incorrect';
      }

      elements.resultBox.innerHTML = `
        <div class="rmcma-result-header ${titleClass}">${titleText}</div>
        <div class="rmcma-result-desc">You scored <strong>${finalScore}</strong> out of <strong>${totalCorrectChoices}</strong> maximum possible points.</div>
      `;
    }

    // Toggle button visibilities
    if (elements.submitBtn) {
      elements.submitBtn.style.display = 'none';
    }
    if (elements.retryBtn) {
      elements.retryBtn.style.display = 'block';
    }

    window.PTEAttemptArchive?.saveChoiceAttempt?.('rmcma', state, {
      score: finalScore,
      maxScore: totalCorrectChoices,
      correctCount,
      incorrectCount
    }).catch((error) => console.warn('[PTE Archive] RMCMA save failed:', error));

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
        console.error('[RMCMAMode] Error loading excel database:', error);
        setLoadingState('Failed to load question database. Please check your network connection and reload.');
        return;
      }
    }

    if (state.questions.length > 0) {
      const urlRoute = window.PracticeRouter ? window.PracticeRouter.initFromURL() : null;
      if (urlRoute && urlRoute.mode === 'rmcma' && urlRoute.questionId) {
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

  window.RMCMAMode = {
    activate,
    onExit
  };

  // Deep-link support: listen for PracticeRouter question navigation events
  window.addEventListener('practice-route-question', async (event) => {
    const { mode, questionId } = event.detail || {};
    if (mode !== 'rmcma' || !questionId) return;
    await loadQuestionById(questionId);
  });
})();
