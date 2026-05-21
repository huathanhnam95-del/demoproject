(function () {
  'use strict';

  const EXCEL_PATH = '/database/ROP/ROP/ROP.xlsx';

  const state = {
    initialized: false,
    questions: [],
    currentQuestionIndex: 0,
    currentQuestion: null,
    sourceItems: [], // items currently on the left
    targetItems: [], // items currently on the right
    selectedItemId: null, // ID of the currently clicked/selected card
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

  function stripHtml(html) {
    const temp = document.createElement('div');
    temp.innerHTML = html || '';
    return temp.textContent || temp.innerText || '';
  }

  function sanitizeExplanationHtml(rawHtml) {
    const allowedTags = new Set(['P', 'STRONG', 'B', 'EM', 'I', 'UL', 'OL', 'LI', 'BR', 'H3', 'H4', 'SPAN', 'DIV']);
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

      // Preserve class, data-link, data-tooltip for cohesion links
      Array.from(node.attributes).forEach((attribute) => {
        if (!['class', 'data-link', 'data-tooltip'].includes(attribute.name)) {
          node.removeAttribute(attribute.name);
        }
      });
      Array.from(node.childNodes).forEach(cleanNode);
    };

    Array.from(template.content.childNodes).forEach(cleanNode);
    return template.innerHTML;
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
    elements.prevBtn = document.getElementById('rop-v7-prev-btn');
    elements.nextBtn = document.getElementById('rop-v7-next-btn');
    elements.questionPill = document.getElementById('rop-v7-question-pill');
    elements.backdrop = document.getElementById('rop-v7-backdrop');
    elements.sheet = document.getElementById('rop-v7-sheet');
    elements.sheetClose = document.getElementById('rop-v7-sheet-close');
    elements.jumpSearch = document.getElementById('rop-v7-jump-search');
    elements.jumpList = document.getElementById('rop-v7-jump-list');

    // practice areas
    elements.sourceList = document.getElementById('rop-source-list');
    elements.targetList = document.getElementById('rop-target-list');

    // movement buttons
    elements.btnMoveRight = document.getElementById('rop-btn-move-right');
    elements.btnMoveLeft = document.getElementById('rop-btn-move-left');
    elements.btnMoveUp = document.getElementById('rop-btn-move-up');
    elements.btnMoveDown = document.getElementById('rop-btn-move-down');

    // action buttons
    elements.submitBtn = document.getElementById('rop-submit-btn');
    elements.retryBtn = document.getElementById('rop-retry-btn');
    elements.explanationToggle = document.getElementById('rop-explanation-toggle');

    // results and explanations
    elements.resultBox = document.getElementById('rop-result-box');
    elements.explanationPanel = document.getElementById('rop-explanation-panel');
    elements.explanationContent = document.getElementById('rop-explanation-content');
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

    // Move right button click
    if (elements.btnMoveRight) {
      elements.btnMoveRight.addEventListener('click', () => {
        moveSelectedCard(elements.sourceList, elements.targetList);
      });
    }

    // Move left button click
    if (elements.btnMoveLeft) {
      elements.btnMoveLeft.addEventListener('click', () => {
        moveSelectedCard(elements.targetList, elements.sourceList);
      });
    }

    // Move up button click
    if (elements.btnMoveUp) {
      elements.btnMoveUp.addEventListener('click', () => {
        shiftSelectedCard(-1);
      });
    }

    // Move down button click
    if (elements.btnMoveDown) {
      elements.btnMoveDown.addEventListener('click', () => {
        shiftSelectedCard(1);
      });
    }

    // Submit button
    if (elements.submitBtn) {
      elements.submitBtn.addEventListener('click', submitAnswers);
    }

    // Retry button
    if (elements.retryBtn) {
      elements.retryBtn.addEventListener('click', () => {
        loadQuestion(state.currentQuestionIndex);
      });
    }

    // Explanation toggle button
    if (elements.explanationToggle) {
      elements.explanationToggle.addEventListener('click', toggleExplanation);
    }

    // Setup drag & drop on container areas
    setupDragAndDrop(elements.sourceList);
    setupDragAndDrop(elements.targetList);

    // Cohesion markers hover delegation
    setupCohesionHoverHandlers();
  }

  /* Cohesion Highlight Sync */
  function setupCohesionHoverHandlers() {
    document.addEventListener('mouseover', (e) => {
      const link = e.target.closest('.cohesion-link');
      if (link) {
        const linkId = link.getAttribute('data-link');
        if (linkId) {
          document.querySelectorAll(`.cohesion-link[data-link="${linkId}"]`).forEach(el => {
            el.classList.add('cohesion-link-hovered');
          });
        }
      }
    });

    document.addEventListener('mouseout', (e) => {
      const link = e.target.closest('.cohesion-link');
      if (link) {
        const linkId = link.getAttribute('data-link');
        if (linkId) {
          document.querySelectorAll(`.cohesion-link[data-link="${linkId}"]`).forEach(el => {
            el.classList.remove('cohesion-link-hovered');
          });
        }
      }
    });
  }

  /* Picker controls */
  function openPicker() {
    if (!elements.sheet || !elements.backdrop || state.questions.length === 0) return;
    state.pickerOpen = true;
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
    state.pickerOpen = false;
    elements.backdrop.classList.remove('is-visible');
    elements.backdrop.setAttribute('aria-hidden', 'true');
    elements.sheet.classList.remove('is-open');
    if (elements.questionPill) {
      elements.questionPill.setAttribute('aria-expanded', 'false');
    }
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
      const answerSource = row.ENRICHED_ANSWER || row.ANSWER || '';
      const paragraphs = parseParagraphs(answerSource);

      return {
        id: Number(row.ID) || 0,
        title: String(row.TITLE || '').trim(),
        paragraphs: paragraphs,
        explanation: String(row.EXPLANATION || '').trim()
      };
    }).sort((a, b) => a.id - b.id);
  }

  /* Parse paragraphs from line-by-line format */
  function parseParagraphs(text) {
    if (!text) return [];
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const paragraphs = [];

    for (const line of lines) {
      const match = line.match(/^(\d+)[.)\s]\s*(.*)$/);
      if (match) {
        paragraphs.push({
          originalIndex: parseInt(match[1], 10),
          text: match[2].trim()
        });
      } else {
        paragraphs.push({
          originalIndex: paragraphs.length + 1,
          text: line
        });
      }
    }
    return paragraphs;
  }

  /* Load Question */
  function loadQuestion(index) {
    if (index < 0 || index >= state.questions.length) return;

    state.currentQuestionIndex = index;
    state.currentQuestion = state.questions[index];
    state.selectedItemId = null;
    state.submitted = false;
    state.explanationVisible = false;

    // Load source list shuffled, target list empty
    state.sourceItems = shuffleArray(state.currentQuestion.paragraphs).map((p, idx) => ({
      ...p,
      id: `rop-item-${idx}`
    }));
    state.targetItems = [];

    closePicker();
    updateNavigationUI();
    renderQuestion();
  }

  function renderQuestion() {
    if (!state.currentQuestion) return;

    renderListArea(elements.sourceList, state.sourceItems);
    renderListArea(elements.targetList, state.targetItems);

    // Reset button states
    if (elements.submitBtn) {
      elements.submitBtn.style.display = 'block';
      elements.submitBtn.disabled = true; // disabled until all are placed in target
    }
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

    updateControlButtons();
  }

  function renderListArea(container, items) {
    if (!container) return;
    container.innerHTML = '';

    if (items.length === 0) {
      return;
    }

    items.forEach((item) => {
      const card = document.createElement('div');
      card.id = item.id;
      card.className = 'rop-item';
      if (state.selectedItemId === item.id) {
        card.classList.add('is-selected');
      }
      card.dataset.originalIndex = item.originalIndex;
      
      // Make draggable unless submitted
      if (!state.submitted) {
        card.setAttribute('draggable', 'true');
        card.addEventListener('dragstart', handleDragStart);
        card.addEventListener('dragend', handleDragEnd);
        card.addEventListener('click', () => selectCard(item.id));
      }

      // Strip HTML tags for practice view unless submitted
      const textToDisplay = state.submitted ? item.text : stripHtml(item.text);

      card.innerHTML = `
        <div class="rop-item-handle" aria-hidden="true">
          <svg width="12" height="18" viewBox="0 0 12 18" fill="none" stroke="currentColor" stroke-width="2.5">
            <circle cx="2.5" cy="3" r="1.25" fill="currentColor"></circle>
            <circle cx="2.5" cy="9" r="1.25" fill="currentColor"></circle>
            <circle cx="2.5" cy="15" r="1.25" fill="currentColor"></circle>
            <circle cx="9.5" cy="3" r="1.25" fill="currentColor"></circle>
            <circle cx="9.5" cy="9" r="1.25" fill="currentColor"></circle>
            <circle cx="9.5" cy="15" r="1.25" fill="currentColor"></circle>
          </svg>
        </div>
        <div class="rop-item-content">${textToDisplay}</div>
      `;

      container.appendChild(card);
    });
  }

  /* Selection logic */
  function selectCard(id) {
    if (state.submitted) return;

    if (state.selectedItemId === id) {
      state.selectedItemId = null;
    } else {
      state.selectedItemId = id;
    }

    // Toggle active classes
    const allCards = document.querySelectorAll('.rop-item');
    allCards.forEach((card) => {
      const isSelected = card.id === state.selectedItemId;
      card.classList.toggle('is-selected', isSelected);
    });

    updateControlButtons();
  }

  /* Controls activation */
  function updateControlButtons() {
    if (state.submitted) {
      if (elements.btnMoveRight) elements.btnMoveRight.disabled = true;
      if (elements.btnMoveLeft) elements.btnMoveLeft.disabled = true;
      if (elements.btnMoveUp) elements.btnMoveUp.disabled = true;
      if (elements.btnMoveDown) elements.btnMoveDown.disabled = true;
      return;
    }

    const selectedInSource = state.selectedItemId && elements.sourceList.querySelector(`#${state.selectedItemId}`);
    const selectedInTarget = state.selectedItemId && elements.targetList.querySelector(`#${state.selectedItemId}`);

    if (elements.btnMoveRight) {
      elements.btnMoveRight.disabled = !selectedInSource;
    }
    if (elements.btnMoveLeft) {
      elements.btnMoveLeft.disabled = !selectedInTarget;
    }

    if (elements.btnMoveUp || elements.btnMoveDown) {
      let isUpDisabled = true;
      let isDownDisabled = true;

      if (selectedInTarget) {
        const targetCards = Array.from(elements.targetList.querySelectorAll('.rop-item'));
        const index = targetCards.findIndex(card => card.id === state.selectedItemId);
        if (index > 0) isUpDisabled = false;
        if (index !== -1 && index < targetCards.length - 1) isDownDisabled = false;
      }

      if (elements.btnMoveUp) elements.btnMoveUp.disabled = isUpDisabled;
      if (elements.btnMoveDown) elements.btnMoveDown.disabled = isDownDisabled;
    }

    // Submit button is active once all source items are moved to the target list
    if (elements.submitBtn) {
      elements.submitBtn.disabled = state.sourceItems.length > 0;
    }
  }

  /* Move cards using button clicks */
  function moveSelectedCard(fromContainer, toContainer) {
    if (!state.selectedItemId) return;
    const cardEl = fromContainer.querySelector(`#${state.selectedItemId}`);
    if (!cardEl) return;

    // Shift in DOM
    toContainer.appendChild(cardEl);
    
    // Deselect after moving so selection state is clean
    state.selectedItemId = null;
    cardEl.classList.remove('is-selected');
    
    // Sync array lists and refresh buttons
    syncStateFromDOM();
  }

  /* Shift card order inside Target box using Up/Down buttons */
  function shiftSelectedCard(direction) {
    if (!state.selectedItemId) return;
    const cardEl = elements.targetList.querySelector(`#${state.selectedItemId}`);
    if (!cardEl) return;

    const cards = Array.from(elements.targetList.querySelectorAll('.rop-item'));
    const index = cards.findIndex(c => c.id === state.selectedItemId);
    if (index === -1) return;

    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= cards.length) return;

    // Swap elements in DOM
    if (direction === -1) {
      elements.targetList.insertBefore(cardEl, cards[targetIndex]);
    } else {
      elements.targetList.insertBefore(cardEl, cards[targetIndex].nextSibling);
    }

    // Sync states
    syncStateFromDOM();
  }

  /* DOM to State synchronization */
  function syncStateFromDOM() {
    const readItems = (container) => {
      return Array.from(container.querySelectorAll('.rop-item')).map((el) => {
        const id = el.id;
        const originalIndex = parseInt(el.dataset.originalIndex, 10);
        const itemObj = state.currentQuestion.paragraphs.find(p => p.originalIndex === originalIndex);
        return {
          id: id,
          originalIndex: originalIndex,
          text: itemObj ? itemObj.text : el.querySelector('.rop-item-content').innerHTML
        };
      });
    };

    state.sourceItems = readItems(elements.sourceList);
    state.targetItems = readItems(elements.targetList);

    updateControlButtons();
  }

  /* HTML5 Drag & Drop handlers */
  let dragSrcEl = null;

  function handleDragStart(e) {
    if (state.submitted) return;
    dragSrcEl = this;
    this.classList.add('is-dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', this.id);
  }

  function handleDragEnd(e) {
    this.classList.remove('is-dragging');
    const lists = [elements.sourceList, elements.targetList];
    lists.forEach(list => {
      if (list) list.classList.remove('drag-over');
    });
  }

  function setupDragAndDrop(listArea) {
    if (!listArea) return;

    listArea.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      listArea.classList.add('drag-over');

      const draggingItem = document.querySelector('.is-dragging');
      if (!draggingItem) return;

      const afterElement = getDragAfterElement(listArea, e.clientY);
      if (afterElement == null) {
        listArea.appendChild(draggingItem);
      } else {
        listArea.insertBefore(draggingItem, afterElement);
      }
    });

    listArea.addEventListener('dragleave', () => {
      listArea.classList.remove('drag-over');
    });

    listArea.addEventListener('drop', (e) => {
      e.preventDefault();
      listArea.classList.remove('drag-over');
      syncStateFromDOM();
    });
  }

  function getDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll('.rop-item:not(.is-dragging)')];
    return draggableElements.reduce((closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) {
        return { offset: offset, element: child };
      } else {
        return closest;
      }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
  }

  /* Submit flow and scoring */
  function submitAnswers() {
    if (state.submitted || state.sourceItems.length > 0) return;
    state.submitted = true;
    state.selectedItemId = null;

    // Disable dragging and click selections
    const cards = elements.targetList.querySelectorAll('.rop-item');
    cards.forEach((card) => {
      card.removeAttribute('draggable');
      card.classList.remove('is-selected');
      card.style.cursor = 'default';
    });

    // Score computation: Check adjacent correct index pairs
    const correctSequence = state.currentQuestion.paragraphs.map(p => p.originalIndex);
    const correctPairs = new Set();
    for (let i = 0; i < correctSequence.length - 1; i++) {
      correctPairs.add(`${correctSequence[i]}-${correctSequence[i+1]}`);
    }

    const userSequence = state.targetItems.map(item => item.originalIndex);
    let score = 0;
    const pairResults = [];

    for (let i = 0; i < userSequence.length - 1; i++) {
      const pairKey = `${userSequence[i]}-${userSequence[i+1]}`;
      const isPairCorrect = correctPairs.has(pairKey);
      if (isPairCorrect) {
        score++;
      }
      pairResults.push({
        firstIndex: userSequence[i],
        secondIndex: userSequence[i+1],
        isCorrect: isPairCorrect
      });
    }

    const maxPossibleScore = correctSequence.length - 1;

    // Show result scores
    if (elements.resultBox) {
      elements.resultBox.style.display = 'block';

      const percentage = maxPossibleScore > 0 ? (score / maxPossibleScore) * 100 : 0;
      let scoreBadgeClass = 'score-badge';
      if (score === maxPossibleScore) {
        scoreBadgeClass += ' max-score';
      }

      let breakdownRows = pairResults.map((res) => {
        const statusClass = res.isCorrect ? 'correct' : 'incorrect';
        const label = res.isCorrect ? 'Correct Pair' : 'Incorrect Pair';
        return `
          <div class="rop-pair-row">
            <span class="rop-pair-status ${statusClass}"></span>
            <span>Transition [${res.firstIndex}] → [${res.secondIndex}]: <strong>${label}</strong></span>
          </div>
        `;
      }).join('');

      elements.resultBox.innerHTML = `
        <div class="rop-score-display">
          <span>Score:</span>
          <span class="${scoreBadgeClass}">${score} / ${maxPossibleScore} Points</span>
        </div>
        <div class="rop-pair-details">
          ${breakdownRows}
        </div>
      `;
    }

    // Refresh right items view to render correct badges and highlight HTML cohesion links
    renderTargetResults(pairResults);

    // Toggle button visibilities
    if (elements.submitBtn) {
      elements.submitBtn.style.display = 'none';
    }
    if (elements.retryBtn) {
      elements.retryBtn.style.display = 'block';
    }

    // Show explanation panel if explanations exist
    if (elements.explanationToggle && state.currentQuestion.explanation) {
      elements.explanationToggle.style.display = 'block';
      if (elements.explanationContent) {
        elements.explanationContent.innerHTML = sanitizeExplanationHtml(state.currentQuestion.explanation);
      }
    }
  }

  function renderTargetResults(pairResults) {
    if (!elements.targetList) return;
    elements.targetList.innerHTML = '';

    state.targetItems.forEach((item, idx) => {
      // If this is not the first card, render a connector line between the previous and current cards
      let pairClass = '';
      if (idx > 0) {
        const precedingPair = pairResults[idx - 1];
        const isPairCorrect = precedingPair && precedingPair.isCorrect;
        
        const connector = document.createElement('div');
        connector.className = `rop-card-connector ${isPairCorrect ? 'is-correct' : 'is-incorrect'}`;
        elements.targetList.appendChild(connector);
        
        pairClass = isPairCorrect ? 'pair-correct' : 'pair-incorrect';
      }

      const card = document.createElement('div');
      card.id = item.id;
      card.className = 'rop-item';
      card.dataset.originalIndex = item.originalIndex;

      // Determine correct badge class and correct index positioning
      const isPositionCorrect = item.originalIndex === (idx + 1);
      const positionClass = isPositionCorrect ? 'is-correct' : 'is-incorrect';

      if (pairClass) {
        card.classList.add(pairClass);
      }

      card.innerHTML = `
        <div class="rop-badge-number ${positionClass}" title="Correct Position: #${item.originalIndex}">
          #${item.originalIndex}
        </div>
        <div class="rop-item-content">${item.text}</div>
      `;

      elements.targetList.appendChild(card);
    });
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

  /* Global Controller Hooks */
  async function activate() {
    cacheElements();
    if (!state.initialized) {
      setupEventListeners();
      state.initialized = true;
    }

    if (state.questions.length === 0) {
      if (elements.sourceList) {
        elements.sourceList.innerHTML = '<div style="padding: 20px; color: var(--rop-muted);">Loading paragraphs database...</div>';
      }
      try {
        await loadData();
      } catch (error) {
        console.error('[ROPMode] Error loading excel database:', error);
        if (elements.sourceList) {
          elements.sourceList.innerHTML = '<div style="padding: 20px; color: var(--rop-danger);">Failed to load database. Please check your connection and reload.</div>';
        }
        return;
      }
    }

    if (state.questions.length > 0) {
      loadQuestion(0);
    }
  }

  function onExit() {
    closePicker();
    state.selectedItemId = null;
    state.submitted = false;
    state.explanationVisible = false;
  }

  window.ROPMode = {
    activate,
    onExit
  };
})();
