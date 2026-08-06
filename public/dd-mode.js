(function () {
  'use strict';

  const DATA_URL = '/database/DD/dd-questions.json';

  const state = {
    initialized: false,
    listenersBound: false,
    loadingPromise: null,
    questions: [],
    questionIndexById: new Map(),
    currentQuestionIndex: 0,
    currentQuestion: null,
    placements: {}, // key: blankId, value: option object { optionId, text, kind, blankId }
    selectedOptionId: null, // selected in word bank for click-to-place fallback
    submitted: false,
    shuffledOptions: [], // array of option objects stored per question load to keep order consistent
    randomMode: localStorage.getItem('pte_random_nav_mode') === 'true',
    navHistory: [],
    pickerPage: 1
  };

  const elements = {};

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function parseMarkdownToHtml(text) {
    if (!text) return '';
    let escaped = escapeHtml(text);
    escaped = escaped.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    escaped = escaped.replace(/`(.*?)`/g, '<span class="rop-highlight">$1</span>');
    escaped = escaped.replace(/\n/g, '<br>');
    return escaped;
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
    elements.panel = document.getElementById('mode-dd');
    
    // v7 Question Picker Elements
    elements.prevBtn = document.getElementById('dd-v7-prev-btn');
    elements.nextBtn = document.getElementById('dd-v7-next-btn');
    elements.randomToggleBtn = document.getElementById('dd-random-toggle-btn');
    elements.questionPill = document.getElementById('dd-v7-question-pill');
    elements.backdrop = document.getElementById('dd-v7-backdrop');
    elements.sheet = document.getElementById('dd-v7-sheet');
    elements.sheetClose = document.getElementById('dd-v7-sheet-close');
    elements.jumpSearch = document.getElementById('dd-v7-jump-search');
    elements.jumpList = document.getElementById('dd-v7-jump-list');

    // Workspace & Cards
    elements.passage = document.getElementById('dd-passage');
    elements.wordBank = document.getElementById('dd-word-bank');
    
    // Buttons
    elements.submitBtn = document.getElementById('dd-submit-btn');
    elements.retryBtn = document.getElementById('dd-retry-btn');
    elements.nextQuestionBtn = document.getElementById('dd-next-question-btn');

    // Score & Feedback
    elements.resultSummary = document.getElementById('dd-result-summary');
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
        updateNavigationUI();
      });
    }

    if (elements.prevBtn) {
      elements.prevBtn.addEventListener('click', () => {
        if (state.randomMode && state.navHistory.length > 0) {
          const prevIdx = state.navHistory.pop();
          loadQuestionByIndex(prevIdx);
        } else if (state.currentQuestionIndex > 0) {
          loadQuestionByIndex(state.currentQuestionIndex - 1);
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
          loadQuestionByIndex(randomIdx);
        } else if (state.currentQuestionIndex < state.questions.length - 1) {
          loadQuestionByIndex(state.currentQuestionIndex + 1);
        }
      });
    }

    if (elements.questionPill) {
      elements.questionPill.addEventListener('click', () => {
        if (elements.sheet && elements.sheet.classList.contains('is-open')) {
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
          const index = parseInt(item.dataset.index, 10);
          if (Number.isFinite(index)) {
            loadQuestionByIndex(index);
          }
        }
      });
    }

    if (elements.submitBtn) {
      elements.submitBtn.addEventListener('click', submitAnswers);
    }

    if (elements.retryBtn) {
      elements.retryBtn.addEventListener('click', () => {
        if (!state.currentQuestion) return;
        loadQuestionById(state.currentQuestion.id, { freshAttempt: true });
      });
    }

    if (elements.nextQuestionBtn) {
      elements.nextQuestionBtn.addEventListener('click', () => {
        if (state.currentQuestionIndex < state.questions.length - 1) {
          loadQuestionByIndex(state.currentQuestionIndex + 1);
        }
      });
    }

    // click fallback delegation on wordBank
    if (elements.wordBank) {
      elements.wordBank.addEventListener('click', (e) => {
        if (state.submitted) return;
        const chip = e.target.closest('.dd-option-chip');
        if (!chip || chip.classList.contains('is-used')) return;
        
        const optionId = chip.dataset.optionId;
        selectOption(optionId);
      });
    }

    // click / drag delegation on passage (slots)
    if (elements.passage) {
      elements.passage.addEventListener('click', (e) => {
        if (state.submitted) return;

        // check if remove button clicked
        const removeBtn = e.target.closest('.dd-placed-chip-remove');
        if (removeBtn) {
          const slot = removeBtn.closest('.dd-blank-slot');
          if (slot) {
            const blankId = slot.dataset.blankId;
            removeOption(blankId);
          }
          return;
        }

        // check if slot itself clicked
        const slot = e.target.closest('.dd-blank-slot');
        if (slot) {
          const blankId = slot.dataset.blankId;
          const isFilled = slot.classList.contains('is-filled');
          
          if (!isFilled && state.selectedOptionId) {
            // place selected option
            placeOption(state.selectedOptionId, blankId);
          } else if (isFilled) {
            // remove option
            removeOption(blankId);
          }
        }
      });

      // drag and drop listeners
      elements.passage.addEventListener('dragover', (e) => {
        if (state.submitted) return;
        const slot = e.target.closest('.dd-blank-slot');
        if (slot) {
          e.preventDefault();
          slot.classList.add('drag-over');
        }
      });

      elements.passage.addEventListener('dragleave', (e) => {
        const slot = e.target.closest('.dd-blank-slot');
        if (slot) {
          slot.classList.remove('drag-over');
        }
      });

      elements.passage.addEventListener('drop', (e) => {
        if (state.submitted) return;
        const slot = e.target.closest('.dd-blank-slot');
        if (slot) {
          e.preventDefault();
          slot.classList.remove('drag-over');
          const optionId = e.dataTransfer.getData('text/plain');
          if (optionId) {
            placeOption(optionId, slot.dataset.blankId);
          }
        }
      });
    }
  }

  function openPicker() {
    if (!elements.sheet || !elements.backdrop) return;
    elements.backdrop.classList.add('is-visible');
    elements.backdrop.setAttribute('aria-hidden', 'false');
    elements.sheet.classList.add('is-open');
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
    elements.backdrop.classList.remove('is-visible');
    elements.backdrop.setAttribute('aria-hidden', 'true');
    elements.sheet.classList.remove('is-open');
    if (elements.questionPill) {
      elements.questionPill.setAttribute('aria-expanded', 'false');
    }
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
    // In random mode the arrows walk the shuffle history, not the index order,
    // so the position in the list must not disable them.
    if (elements.prevBtn) {
      elements.prevBtn.disabled = state.randomMode
        ? state.navHistory.length === 0
        : state.currentQuestionIndex <= 0;
    }
    if (elements.nextBtn) {
      elements.nextBtn.disabled = state.randomMode
        ? state.questions.length <= 1
        : state.currentQuestionIndex >= state.questions.length - 1;
    }
    if (elements.questionPill && state.currentQuestion) {
      elements.questionPill.textContent = `#${state.currentQuestion.id} — ${state.currentQuestion.title}`;
    }
  }

  async function loadData() {
    if (state.questions.length > 0) return state.questions;
    if (state.loadingPromise) return state.loadingPromise;
    state.loadingPromise = (async () => {
      const response = await fetch(`${DATA_URL}?v=${Date.now()}`);
      if (!response.ok) {
        throw new Error(`Failed to load Drag & Drop data: ${response.status}`);
      }
      const data = await response.json();
      state.questions = Array.isArray(data) ? data : [];
      state.questions.sort((a, b) => Number(a.id) - Number(b.id));
      state.questionIndexById = new Map(state.questions.map((q, idx) => [Number(q.id), idx]));

      if (state.questions.length > 0 && !state.currentQuestion) {
        // Restore last question id or use index 0
        const lastId = Number(localStorage.getItem('dd-last-question-id'));
        if (lastId && state.questionIndexById.has(lastId)) {
          state.currentQuestionIndex = state.questionIndexById.get(lastId);
          state.currentQuestion = state.questions[state.currentQuestionIndex];
        } else {
          state.currentQuestionIndex = 0;
          state.currentQuestion = state.questions[0];
        }
      }
      return state.questions;
    })();

    try {
      return await state.loadingPromise;
    } finally {
      state.loadingPromise = null;
    }
  }

  function loadQuestionByIndex(index) {
    if (index < 0 || index >= state.questions.length) return;
    const q = state.questions[index];
    loadQuestionById(q.id);
  }

  function loadQuestionByIdSync(questionId) {
    const index = state.questionIndexById.get(Number(questionId));
    if (index === undefined) return false;

    state.currentQuestionIndex = index;
    state.currentQuestion = state.questions[index];
    localStorage.setItem('dd-last-question-id', String(state.currentQuestion.id));

    state.placements = {};
    state.selectedOptionId = null;
    state.submitted = false;

    // Shuffle options once per question load and store them in state
    state.shuffledOptions = shuffleArray(state.currentQuestion.options);

    closePicker();
    updateNavigationUI();
    renderQuestion();

    if (window.PracticeRouter && state.currentQuestion?.id != null) {
      window.PracticeRouter.replaceRoute('dd', state.currentQuestion.id);
    }
    return true;
  }

  async function loadQuestionById(questionId, options = {}) {
    if (state.questions.length > 0) {
      if (loadQuestionByIdSync(questionId)) return;
    }
    await loadData();
    loadQuestionByIdSync(questionId);
  }

  function renderQuestion() {
    if (!state.currentQuestion) return;

    // 1. Render passage
    renderPassage();

    // 2. Render word bank
    renderWordBank();

    // 3. Reset controls
    if (elements.submitBtn) {
      elements.submitBtn.style.display = 'block';
      elements.submitBtn.disabled = true;
    }
    if (elements.retryBtn) {
      elements.retryBtn.style.display = 'none';
    }
    if (elements.nextQuestionBtn) {
      elements.nextQuestionBtn.style.display = 'none';
    }
    if (elements.resultSummary) {
      elements.resultSummary.style.display = 'none';
      elements.resultSummary.innerHTML = '';
    }
    hidePopover();
  }

  function renderPassage() {
    if (!elements.passage || !state.currentQuestion) return;
    elements.passage.innerHTML = '';

    state.currentQuestion.segments.forEach((seg) => {
      if (seg.type === 'text') {
        const textNode = document.createTextNode(seg.text);
        elements.passage.appendChild(textNode);
      } else if (seg.type === 'blank') {
        // A real <button>, not a div: the click-to-place fallback is the only
        // way to answer without a mouse, and a div with no tabindex cannot be
        // reached. (It also carried role="option" with no listbox parent,
        // which is invalid ARIA.)
        const slot = document.createElement('button');
        slot.type = 'button';
        slot.className = 'dd-blank-slot';
        slot.dataset.blankId = seg.blankId;
        slot.dataset.index = seg.index;
        if (state.submitted) slot.disabled = true;

        // Check if placed
        const placed = state.placements[seg.blankId];
        if (placed) {
          slot.classList.add('is-filled');

          const chipSpan = document.createElement('span');
          chipSpan.className = 'dd-placed-chip';
          chipSpan.textContent = placed.text;

          if (!state.submitted) {
            // Decorative only. Activating the slot already removes the word,
            // and a <button> cannot legally contain another button.
            const removeMark = document.createElement('span');
            removeMark.className = 'dd-placed-chip-remove';
            removeMark.setAttribute('aria-hidden', 'true');
            removeMark.innerHTML = '&times;';
            chipSpan.appendChild(removeMark);
          }

          slot.appendChild(chipSpan);
        }

        // seg.index arrives from the JSON as a string ("0", "1", ...), so it
        // must be coerced before arithmetic or the label reads "Blank 01".
        const blankNumber = Number(seg.index) + 1;
        slot.setAttribute('aria-label', placed
          ? `Blank ${blankNumber}, filled with ${placed.text}. Activate to remove.`
          : `Blank ${blankNumber}, empty. Select a word, then activate to place it.`);

        elements.passage.appendChild(slot);
      }
    });
  }

  function renderWordBank() {
    if (!elements.wordBank) return;
    elements.wordBank.innerHTML = '';

    // Create a fragment to avoid layouts thrashing
    const fragment = document.createDocumentFragment();

    state.shuffledOptions.forEach((opt) => {
      const chip = document.createElement('button');
      chip.className = 'dd-option-chip';
      chip.type = 'button';
      chip.dataset.optionId = opt.optionId;
      chip.textContent = opt.text;

      // check if used
      const isUsed = Object.values(state.placements).some((placed) => placed.optionId === opt.optionId);
      if (isUsed) {
        chip.classList.add('is-used');
        chip.setAttribute('disabled', 'true');
      } else {
        if (!state.submitted) {
          chip.setAttribute('draggable', 'true');
          
          // drag events
          chip.addEventListener('dragstart', (e) => {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', opt.optionId);
            chip.classList.add('is-dragging');
          });
          
          chip.addEventListener('dragend', () => {
            chip.classList.remove('is-dragging');
          });
        }
      }

      if (state.selectedOptionId === opt.optionId) {
        chip.classList.add('is-selected');
      }

      fragment.appendChild(chip);
    });

    elements.wordBank.appendChild(fragment);
  }

  function selectOption(optionId) {
    if (state.selectedOptionId === optionId) {
      state.selectedOptionId = null;
    } else {
      state.selectedOptionId = optionId;
    }
    renderWordBank();
  }

  function placeOption(optionId, blankId) {
    if (!state.currentQuestion) return;
    const option = state.currentQuestion.options.find((o) => o.optionId === optionId);
    if (!option) return;

    // Check if the option is already used in another blank. If so, remove it.
    for (const [bId, placed] of Object.entries(state.placements)) {
      if (placed.optionId === optionId) {
        delete state.placements[bId];
      }
    }

    // Place option
    state.placements[blankId] = option;
    state.selectedOptionId = null;

    // Check if any slot is filled
    const hasAnyFilled = Object.keys(state.placements).length > 0;
    
    if (elements.submitBtn) {
      elements.submitBtn.disabled = !hasAnyFilled;
    }

    renderQuestionLayout();
  }

  function removeOption(blankId) {
    if (state.placements[blankId]) {
      delete state.placements[blankId];
    }
    state.selectedOptionId = null;

    // Check if any slot is filled
    const hasAnyFilled = Object.keys(state.placements).length > 0;
    if (elements.submitBtn) {
      elements.submitBtn.disabled = !hasAnyFilled;
    }

    renderQuestionLayout();
  }

  // A lightweight re-render that preserves scrolled/focus elements where possible
  function renderQuestionLayout() {
    renderPassage();
    renderWordBank();
  }

  function submitAnswers() {
    if (state.submitted || !state.currentQuestion) return;

    state.submitted = true;
    state.selectedOptionId = null;

    if (elements.submitBtn) {
      elements.submitBtn.disabled = true;
      elements.submitBtn.style.display = 'none';
    }
    if (elements.retryBtn) {
      elements.retryBtn.style.display = 'block';
    }
    if (elements.nextQuestionBtn) {
      // only show if not the last question
      if (state.currentQuestionIndex < state.questions.length - 1) {
        elements.nextQuestionBtn.style.display = 'block';
      }
    }

    // Check answers & compute score
    const blanks = state.currentQuestion.blanks;
    let correctCount = 0;
    const totalBlanks = blanks.length;

    const results = blanks.map((blank) => {
      const placed = state.placements[blank.blankId];
      const isCorrect = placed && placed.text.trim().toLowerCase() === blank.answer.trim().toLowerCase();
      if (isCorrect) correctCount++;

      return {
        blank,
        placed,
        isCorrect
      };
    });

    // 1. Highlight blanks in passage
    results.forEach((res) => {
      const slot = elements.passage.querySelector(`[data-blank-id="${res.blank.blankId}"]`);
      if (slot) {
        slot.classList.add(res.isCorrect ? 'is-correct' : 'is-incorrect');
        // remove click handles / class edits
        slot.style.cursor = 'default';
      }
    });

    // Disable dragging on remaining option chips
    renderWordBank();

    // 2. Render Score summary
    const isPerfect = correctCount === totalBlanks;
    if (elements.resultSummary) {
      elements.resultSummary.style.display = 'block';
      elements.resultSummary.className = `dd-result-summary-box ${isPerfect ? 'is-perfect' : 'has-misses'}`;
      elements.resultSummary.innerHTML = isPerfect
        ? `🎉 ${correctCount}/${totalBlanks} blanks correct — Perfect!`
        : `${correctCount}/${totalBlanks} blanks correct — Click ? for explanations`;
    }

    // 3. Attach a ? next to each blank, the same explanation affordance the
    //    other Reading fill-in-the-blanks task uses.
    renderHintButtons(results);

    window.PTEAttemptArchive?.saveAttempt?.({
      practiceMode: 'dd',
      promptSnapshot: window.PTEAttemptArchive.summarizeQuestion(state.currentQuestion),
      responseSnapshot: {
        placements: Object.fromEntries(Object.entries(state.placements || {}).map(([blankId, placed]) => [
          blankId,
          placed ? { id: placed.id || null, text: placed.text || null } : null
        ]))
      },
      answerSnapshot: {
        blanks: blanks.map((blank) => ({
          blankId: blank.blankId,
          answer: blank.answer,
          options: blank.options || null
        }))
      },
      resultSnapshot: {
        score: correctCount,
        maxScore: totalBlanks,
        results: results.map((item) => ({
          blankId: item.blank.blankId,
          placed: item.placed ? { id: item.placed.id || null, text: item.placed.text || null } : null,
          correctAnswer: item.blank.answer,
          isCorrect: item.isCorrect
        }))
      },
      scoringSource: 'client'
    }).catch((error) => console.warn('[PTE Archive] DD save failed:', error));
  }

  /* -- Explanations: inline ? button + floating popover -----------------
     Mirrors the Reading Fill in the Blanks task: the passage stays readable
     after grading and each blank explains itself on demand, instead of a wall
     of always-open cards below the score. */

  let popoverEl = null;
  let activeHintBtn = null;

  function ensurePopoverElement() {
    if (popoverEl) return popoverEl;
    popoverEl = document.createElement('div');
    popoverEl.className = 'dd-popover';
    popoverEl.innerHTML = `
      <div class="dd-popover-arrow arrow-top"></div>
      <div class="dd-popover-header">
        <span class="dd-popover-blank-label"></span>
        <span class="dd-popover-verdict"></span>
        <button type="button" class="dd-popover-close" aria-label="Close explanation">&times;</button>
      </div>
      <div class="dd-popover-body"></div>
    `;
    document.body.appendChild(popoverEl);

    popoverEl.querySelector('.dd-popover-close').addEventListener('click', hidePopover);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && popoverEl?.classList.contains('is-visible')) {
        hidePopover();
      }
    });

    document.addEventListener('mousedown', (e) => {
      if (!popoverEl?.classList.contains('is-visible')) return;
      if (popoverEl.contains(e.target)) return;
      if (e.target.closest('.dd-hint-btn')) return;
      hidePopover();
    });

    return popoverEl;
  }

  function positionPopover(anchorEl) {
    if (!popoverEl) return;
    const anchorRect = anchorEl.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 16;
    const arrowEl = popoverEl.querySelector('.dd-popover-arrow');

    // Measure off-screen before committing to a side.
    popoverEl.style.left = '-9999px';
    popoverEl.style.top = '-9999px';
    popoverEl.classList.add('is-visible');
    const popRect = popoverEl.getBoundingClientRect();
    popoverEl.classList.remove('is-visible');

    let top = anchorRect.bottom + 10;
    let placeAbove = false;
    if (top + popRect.height > vh - margin) {
      top = anchorRect.top - popRect.height - 10;
      placeAbove = true;
    }
    if (top < margin) {
      top = margin;
      placeAbove = false;
    }

    let left = anchorRect.left + anchorRect.width / 2 - popRect.width / 2;
    if (left + popRect.width > vw - margin) left = vw - popRect.width - margin;
    if (left < margin) left = margin;

    popoverEl.style.top = `${top}px`;
    popoverEl.style.left = `${left}px`;

    if (arrowEl) {
      arrowEl.classList.toggle('arrow-top', !placeAbove);
      arrowEl.classList.toggle('arrow-bottom', placeAbove);
      const arrowLeft = Math.max(16, Math.min(anchorRect.left + anchorRect.width / 2 - left - 6, popRect.width - 28));
      arrowEl.style.left = `${arrowLeft}px`;
    }
  }

  function buildPopoverBodyHtml(res) {
    const blank = res.blank;
    let html = '';

    if (!res.isCorrect) {
      html += `
        <div class="dd-popover-answers">
          <div class="dd-popover-answer-item">
            <div class="dd-popover-answer-label">Your answer</div>
            <div class="dd-popover-answer-val">${escapeHtml(res.placed ? res.placed.text : 'None')}</div>
          </div>
          <div class="dd-popover-answer-item is-correct">
            <div class="dd-popover-answer-label">Correct answer</div>
            <div class="dd-popover-answer-val">${escapeHtml(blank.answer)}</div>
          </div>
        </div>
      `;
    }

    if (blank.coherenceCue) {
      html += `
        <div class="dd-popover-section">
          <div class="dd-popover-section-label">Coherence cue</div>
          <div class="dd-popover-section-text">${parseMarkdownToHtml(blank.coherenceCue)}</div>
        </div>
      `;
    }

    if (blank.vocabGrammarCue) {
      html += `
        <div class="dd-popover-section">
          <div class="dd-popover-section-label">Grammar &amp; vocab cue</div>
          <div class="dd-popover-section-text">${parseMarkdownToHtml(blank.vocabGrammarCue)}</div>
        </div>
      `;
    }

    if (blank.collocationCohesionClue) {
      html += `
        <div class="dd-popover-section">
          <div class="dd-popover-section-label">Clue</div>
          <div class="dd-popover-section-text">${escapeHtml(blank.collocationCohesionClue)}</div>
        </div>
      `;
    }

    if (!res.isCorrect && res.placed) {
      const distNote = Array.isArray(blank.distractorNotes)
        ? blank.distractorNotes.find((dn) => String(dn.option || '').trim().toLowerCase() === res.placed.text.trim().toLowerCase())
        : null;
      if (distNote) {
        html += `
          <div class="dd-popover-section dd-popover-section-distractor">
            <div class="dd-popover-section-label">Why ${escapeHtml(res.placed.text)} is wrong</div>
            <div class="dd-popover-section-text">${parseMarkdownToHtml(distNote.reason)}</div>
          </div>
        `;
      }
    }

    if (blank.explanation) {
      html += `
        <div class="dd-popover-section dd-popover-section-explanation">
          <div class="dd-popover-section-label">Explanation</div>
          <div class="dd-popover-section-text">${parseMarkdownToHtml(blank.explanation)}</div>
        </div>
      `;
    }

    if (!html) {
      html = '<div class="dd-popover-empty">No explanation available for this blank.</div>';
    }

    return html;
  }

  function showPopover(res, blankNumber, anchorEl) {
    ensurePopoverElement();

    // Clicking the same ? closes it again.
    if (activeHintBtn === anchorEl && popoverEl.classList.contains('is-visible')) {
      hidePopover();
      return;
    }

    if (activeHintBtn) activeHintBtn.classList.remove('is-active');
    activeHintBtn = anchorEl;
    anchorEl.classList.add('is-active');

    popoverEl.querySelector('.dd-popover-blank-label').textContent = `Blank ${blankNumber}`;

    const verdict = popoverEl.querySelector('.dd-popover-verdict');
    verdict.textContent = res.isCorrect ? 'Correct' : 'Incorrect';
    verdict.classList.toggle('is-correct', res.isCorrect);
    verdict.classList.toggle('is-incorrect', !res.isCorrect);

    popoverEl.querySelector('.dd-popover-body').innerHTML = buildPopoverBodyHtml(res);

    positionPopover(anchorEl);
    popoverEl.classList.add('is-visible');
  }

  function hidePopover() {
    if (activeHintBtn) {
      activeHintBtn.classList.remove('is-active');
      activeHintBtn = null;
    }
    if (popoverEl) popoverEl.classList.remove('is-visible');
  }

  function removeHintButtons() {
    hidePopover();
    if (!elements.passage) return;
    elements.passage.querySelectorAll('.dd-hint-btn').forEach((el) => el.remove());
  }

  function renderHintButtons(results) {
    if (!elements.passage) return;
    removeHintButtons();

    results.forEach((res, idx) => {
      const slot = elements.passage.querySelector(`[data-blank-id="${res.blank.blankId}"]`);
      if (!slot) return;

      const hintBtn = document.createElement('button');
      hintBtn.type = 'button';
      hintBtn.className = 'dd-hint-btn';
      hintBtn.textContent = '?';
      hintBtn.title = 'Show explanation';
      hintBtn.setAttribute('aria-label', `Explanation for blank ${idx + 1}`);
      hintBtn.addEventListener('click', () => showPopover(res, idx + 1, hintBtn));

      // A <button> cannot nest, so the ? sits directly after the slot.
      slot.insertAdjacentElement('afterend', hintBtn);
    });
  }

  // Public Interface
  window.DDMode = {
    async activate() {
      cacheElements();
      // Bind once. Re-binding on every activation stacked duplicate handlers, and
      // the Random toggle flipped its state twice per click — reading as dead.
      if (!state.listenersBound) {
        setupEventListeners();
        state.listenersBound = true;
      }

      await loadData();
      
      if (elements.panel) {
        elements.panel.style.display = 'block';
      }

      const urlRoute = window.PracticeRouter ? window.PracticeRouter.initFromURL() : null;
      if (urlRoute && urlRoute.mode === 'dd' && urlRoute.questionId) {
        await loadQuestionById(urlRoute.questionId);
      } else if (state.currentQuestion) {
        await loadQuestionById(state.currentQuestion.id);
      }
      state.initialized = true;
    },

    onExit() {
      if (elements.panel) {
        elements.panel.style.display = 'none';
      }
      closePicker();
    },

    shouldConfirmExit() {
      // Confirm exit if user placed some elements but did not submit yet
      if (state.submitted) return false;
      const placementCount = Object.keys(state.placements).length;
      return placementCount > 0;
    }
  };

  // Deep-link support: listen for PracticeRouter question navigation events
  window.addEventListener('practice-route-question', async (event) => {
    const { mode, questionId } = event.detail || {};
    if (mode !== 'dd' || !questionId) return;
    await loadQuestionById(questionId);
  });
})();
