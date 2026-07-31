(function () {
  'use strict';

  const EXCEL_PATH = '/database/ROP/ROP/ROP.xlsx';

  const state = {
    initialized: false,
    questions: [],
    filteredQuestions: [],
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

  function parseMarkdownInHtml(html) {
    if (!html) return '';
    let parsed = html;
    parsed = parsed.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    parsed = parsed.replace(/`(.*?)`/g, '<span class="rop-highlight">$1</span>');
    return parsed;
  }

  function parseMarkdownToHtml(text) {
    if (!text) return '';
    let escaped = escapeHtml(text);
    escaped = escaped.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    escaped = escaped.replace(/`(.*?)`/g, '<span class="rop-highlight">$1</span>');
    escaped = escaped.replace(/\n/g, '<br>');
    return escaped;
  }

  function isCritiquePanelVisible() {
    return elements.critiquePanel && elements.critiquePanel.style.display === 'block';
  }

  function updateReviewSplitVisibility(showSplit) {
    if (!elements.reviewSplit || !elements.workspace || !elements.footerActions || !elements.reviewRight) return;

    if (showSplit) {
      elements.workspace.style.display = 'none';
      elements.reviewSplit.style.display = 'grid';

      if (elements.resultBox) elements.reviewRight.appendChild(elements.resultBox);
      if (elements.cohesionFeedback) elements.reviewRight.appendChild(elements.cohesionFeedback);
      if (elements.critiquePanel) elements.reviewRight.appendChild(elements.critiquePanel);
      if (elements.explanationPanel) elements.reviewRight.appendChild(elements.explanationPanel);

      renderCorrectParagraphs();
    } else {
      elements.workspace.style.display = 'grid';
      elements.reviewSplit.style.display = 'none';

      if (elements.resultBox) elements.footerActions.appendChild(elements.resultBox);
      if (elements.cohesionFeedback) elements.footerActions.appendChild(elements.cohesionFeedback);
      if (elements.critiquePanel) elements.footerActions.appendChild(elements.critiquePanel);
      if (elements.explanationPanel) elements.footerActions.appendChild(elements.explanationPanel);
    }
  }

  function renderCorrectParagraphs() {
    if (!elements.correctOrderList || !state.currentQuestion) return;
    elements.correctOrderList.innerHTML = '';

    state.currentQuestion.paragraphs.forEach((p, idx) => {
      const card = document.createElement('div');
      card.className = 'rop-correct-item';
      card.innerHTML = `
        <span class="rop-correct-badge">#${idx + 1}</span>
        <div class="rop-item-content">${p.text}</div>
      `;
      elements.correctOrderList.appendChild(card);
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
    elements.liveRegion = document.getElementById('rop-live-region');

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

    // cohesion and critique elements
    elements.cohesionFeedback = document.getElementById('rop-cohesion-feedback');
    elements.critiqueBtn = document.getElementById('rop-critique-btn');
    elements.critiqueSpinner = document.getElementById('rop-critique-spinner');
    elements.critiquePanel = document.getElementById('rop-critique-panel');
    elements.critiqueContent = document.getElementById('rop-critique-content');

    // split-screen review elements
    elements.reviewSplit = document.getElementById('rop-review-split');
    elements.correctOrderList = document.getElementById('rop-correct-order-list');
    elements.reviewRight = document.getElementById('rop-review-right');
    elements.footerActions = document.querySelector('.rop-footer-actions');
    elements.workspace = document.querySelector('.rop-workspace');
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
        if (state.currentQuestionIndex < state.filteredQuestions.length - 1) {
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

    // Critique button
    if (elements.critiqueBtn) {
      elements.critiqueBtn.addEventListener('click', requestAiCritique);
    }

    // Setup drag & drop on container areas
    setupDragAndDrop(elements.sourceList);
    setupDragAndDrop(elements.targetList);

    // Keyboard operation of both listboxes
    if (elements.sourceList) elements.sourceList.addEventListener('keydown', handleListKeydown);
    if (elements.targetList) elements.targetList.addEventListener('keydown', handleListKeydown);

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
    if (!elements.sheet || !elements.backdrop || state.filteredQuestions.length === 0) return;
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

    const itemsHtml = state.filteredQuestions
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
      elements.nextBtn.disabled = state.currentQuestionIndex >= state.filteredQuestions.length - 1;
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
      const rawLevel = Number(row.LEVEL || row.level);

      let cohesionReasons = {};
      try {
        if (row.COHESION_REASONS) {
          cohesionReasons = JSON.parse(String(row.COHESION_REASONS));
        }
      } catch (err) {
        console.warn(`[ROPMode] Failed to parse cohesion reasons for question #${row.ID}:`, err);
      }

      return {
        id: Number(row.ID) || 0,
        title: String(row.TITLE || '').trim(),
        paragraphs: paragraphs,
        explanation: String(row.EXPLANATION || '').trim(),
        cohesionReasons: cohesionReasons,
        level: [1, 2, 3].includes(rawLevel) ? rawLevel : null
      };
    }).sort((a, b) => a.id - b.id);
  }

  /* Parse paragraphs from line-by-line format */
  function parseParagraphs(text) {
    if (!text) return [];
    const parts = text.split(/\r?\n(?=\s*\d+[.)\s])/g);
    const paragraphs = [];

    for (const part of parts) {
      const cleanPart = part.trim();
      if (!cleanPart) continue;

      const match = cleanPart.match(/^\s*(\d+)[.)\s]\s*([\s\S]*)$/);
      if (match) {
        paragraphs.push({
          originalIndex: parseInt(match[1], 10),
          text: match[2].replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim()
        });
      } else {
        paragraphs.push({
          originalIndex: paragraphs.length + 1,
          text: cleanPart.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim()
        });
      }
    }
    return paragraphs;
  }

  /* Load Question */
  function loadQuestion(index) {
    if (index < 0 || index >= state.filteredQuestions.length) return;

    state.currentQuestionIndex = index;
    state.currentQuestion = state.filteredQuestions[index];
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

    // Reset split-screen view
    updateReviewSplitVisibility(false);

    // Sync route
    if (window.PracticeRouter && state.currentQuestion?.id != null) {
      window.PracticeRouter.replaceRoute('rop', state.currentQuestion.id);
    }
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

    // Reset cohesion and critique UI
    if (elements.cohesionFeedback) {
      elements.cohesionFeedback.style.display = 'none';
      elements.cohesionFeedback.innerHTML = '';
    }
    if (elements.critiqueBtn) {
      elements.critiqueBtn.style.display = 'none';
      elements.critiqueBtn.disabled = false;
    }
    if (elements.critiquePanel) {
      elements.critiquePanel.style.display = 'none';
    }
    if (elements.critiqueContent) {
      elements.critiqueContent.innerHTML = '';
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

      // Real listbox option: the container carries role="listbox", so children
      // must be options or the ARIA is invalid. Roving tabindex is applied by
      // refreshRovingTabindex() once the whole list is in the DOM.
      card.setAttribute('role', 'option');
      card.setAttribute('aria-selected', state.selectedItemId === item.id ? 'true' : 'false');
      card.tabIndex = -1;

      // Make draggable unless submitted
      if (!state.submitted) {
        card.setAttribute('draggable', 'true');
        card.addEventListener('dragstart', handleDragStart);
        card.addEventListener('dragend', handleDragEnd);
        card.addEventListener('click', () => selectCard(item.id));
      }
      card.dataset.touchDrag = state.submitted ? 'off' : 'on';

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
      if (!state.submitted) attachTouchDrag(card);
    });

    refreshRovingTabindex(container);
  }

  /* ── Keyboard support ────────────────────────────────────────────────────
     Each list is a listbox; exactly one option in it is tabbable at a time
     (roving tabindex), and arrow keys move focus between options. Without
     this the mode could only be operated with a mouse: the arrow buttons stay
     disabled until something is selected, and nothing was focusable to select.
     ──────────────────────────────────────────────────────────────────────── */

  function optionsIn(container) {
    return Array.from(container.querySelectorAll('.rop-item'));
  }

  // Keep one tabbable option per list: the selected one, else the first.
  function refreshRovingTabindex(container) {
    const options = optionsIn(container);
    if (options.length === 0) return;
    const preferred = options.find((el) => el.id === state.selectedItemId) || options[0];
    options.forEach((el) => { el.tabIndex = el === preferred ? 0 : -1; });
  }

  function refreshAllRovingTabindex() {
    if (elements.sourceList) refreshRovingTabindex(elements.sourceList);
    if (elements.targetList) refreshRovingTabindex(elements.targetList);
  }

  let announceToggle = false;
  function announce(message) {
    if (!elements.liveRegion) return;
    // Set synchronously so the region is readable immediately. Alternating a
    // trailing space makes consecutive identical messages differ, which is what
    // forces a screen reader to re-announce them.
    announceToggle = !announceToggle;
    elements.liveRegion.textContent = announceToggle ? message : `${message} `;
  }

  function positionLabel(cardEl) {
    const inTarget = elements.targetList.contains(cardEl);
    const list = inTarget ? elements.targetList : elements.sourceList;
    const options = optionsIn(list);
    const index = options.indexOf(cardEl);
    return `${inTarget ? 'Target order' : 'Source paragraphs'}, position ${index + 1} of ${options.length}`;
  }

  function focusCard(cardEl) {
    if (!cardEl) return;
    // Make cardEl the sole tabbable option in ITS list, then let the other list
    // pick its own. Setting tabIndex after a blanket refresh would leave two
    // tabbable options whenever cardEl is not the one the refresh preferred.
    const list = elements.targetList.contains(cardEl) ? elements.targetList : elements.sourceList;
    const otherList = list === elements.targetList ? elements.sourceList : elements.targetList;
    optionsIn(list).forEach((el) => { el.tabIndex = el === cardEl ? 0 : -1; });
    if (otherList) refreshRovingTabindex(otherList);
    cardEl.focus();
  }

  function handleListKeydown(event) {
    if (state.submitted) return;

    const card = event.target.closest('.rop-item');
    if (!card) return;

    const inTarget = elements.targetList.contains(card);
    const list = inTarget ? elements.targetList : elements.sourceList;
    const options = optionsIn(list);
    const index = options.indexOf(card);
    const { key, altKey } = event;

    // Alt + arrows act on the focused card directly, so a keyboard user never
    // has to select first. Plain arrows just move focus.
    if (altKey) {
      if (key === 'ArrowRight' || key === 'ArrowLeft') {
        const movingToTarget = key === 'ArrowRight';
        if (movingToTarget === inTarget) return; // already in that list
        event.preventDefault();
        moveCardBetweenLists(card, movingToTarget);
        return;
      }
      if ((key === 'ArrowUp' || key === 'ArrowDown') && inTarget) {
        event.preventDefault();
        shiftCard(card, key === 'ArrowUp' ? -1 : 1);
        return;
      }
      return;
    }

    switch (key) {
      case 'ArrowDown':
      case 'ArrowRight':
        if (options.length < 2) return;
        event.preventDefault();
        focusCard(options[(index + 1) % options.length]);
        break;
      case 'ArrowUp':
      case 'ArrowLeft':
        if (options.length < 2) return;
        event.preventDefault();
        focusCard(options[(index - 1 + options.length) % options.length]);
        break;
      case 'Home':
        event.preventDefault();
        focusCard(options[0]);
        break;
      case 'End':
        event.preventDefault();
        focusCard(options[options.length - 1]);
        break;
      case ' ':
      case 'Enter':
        event.preventDefault();
        selectCard(card.id);
        card.focus();
        announce(
          state.selectedItemId === card.id
            ? `Selected. ${positionLabel(card)}`
            : 'Deselected'
        );
        break;
      default:
        break;
    }
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
      card.setAttribute('aria-selected', isSelected ? 'true' : 'false');
    });

    refreshAllRovingTabindex();
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
  /* Move one card across lists. Shared by the arrow buttons and Alt+Arrow. */
  function moveCardBetweenLists(cardEl, toTarget) {
    if (!cardEl) return;
    const toContainer = toTarget ? elements.targetList : elements.sourceList;
    const hadFocus = document.activeElement === cardEl;

    toContainer.appendChild(cardEl);

    // Deselect after moving so selection state is clean
    if (state.selectedItemId === cardEl.id) {
      state.selectedItemId = null;
      cardEl.classList.remove('is-selected');
      cardEl.setAttribute('aria-selected', 'false');
    }

    // Sync array lists and refresh buttons
    syncStateFromDOM();
    refreshAllRovingTabindex();

    // A moved card must not drop focus, or keyboard users lose their place.
    if (hadFocus) focusCard(cardEl);
    announce(`Moved. ${positionLabel(cardEl)}`);
  }

  function moveSelectedCard(fromContainer, toContainer) {
    if (!state.selectedItemId) return;
    const cardEl = fromContainer.querySelector(`#${state.selectedItemId}`);
    if (!cardEl) return;
    moveCardBetweenLists(cardEl, toContainer === elements.targetList);
  }

  /* Shift one card within the Target list. Shared by buttons and Alt+Arrow. */
  function shiftCard(cardEl, direction) {
    if (!cardEl || !elements.targetList.contains(cardEl)) return;

    const cards = Array.from(elements.targetList.querySelectorAll('.rop-item'));
    const index = cards.indexOf(cardEl);
    if (index === -1) return;

    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= cards.length) return;

    const hadFocus = document.activeElement === cardEl;

    if (direction === -1) {
      elements.targetList.insertBefore(cardEl, cards[targetIndex]);
    } else {
      elements.targetList.insertBefore(cardEl, cards[targetIndex].nextSibling);
    }

    syncStateFromDOM();
    refreshAllRovingTabindex();

    if (hadFocus) focusCard(cardEl);
    announce(positionLabel(cardEl));
  }

  /* Shift card order inside Target box using Up/Down buttons */
  function shiftSelectedCard(direction) {
    if (!state.selectedItemId) return;
    shiftCard(elements.targetList.querySelector(`#${state.selectedItemId}`), direction);
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

  /* ── Touch dragging ──────────────────────────────────────────────────────
     HTML5 drag-and-drop (draggable + dragstart) never fires on touch devices,
     so on a phone the drag affordance was purely decorative. Pointer Events do
     fire, so touch and pen get their own drag here; mouse keeps the native
     implementation above, which already works.

     The gesture starts on the grip handle only. Giving the whole card
     touch-action: none would swallow page scrolling, whereas a handle-only
     gesture leaves the rest of the card scrollable and tappable.
     ──────────────────────────────────────────────────────────────────────── */

  const touchDrag = {
    card: null, ghost: null, pointerId: null,
    offsetX: 0, offsetY: 0, lastX: 0, lastY: 0, rafId: null
  };

  function isTouchDragging() {
    return touchDrag.card !== null;
  }

  function beginTouchDrag(card, event) {
    const rect = card.getBoundingClientRect();
    touchDrag.card = card;
    touchDrag.pointerId = event.pointerId;
    touchDrag.offsetX = event.clientX - rect.left;
    touchDrag.offsetY = event.clientY - rect.top;

    // Track on the document, not the handle. Dragging reparents the card
    // between the two lists, and reparenting drops pointer capture — which
    // silently killed every pointermove and the final pointerup.
    document.addEventListener('pointermove', moveTouchDrag, { passive: false });
    document.addEventListener('pointerup', endTouchDrag);
    document.addEventListener('pointercancel', endTouchDrag);

    // Ghost follows the finger; the real card stays in the list, dimmed, and is
    // live-reordered so the drop position is always visible.
    const ghost = card.cloneNode(true);
    ghost.classList.add('rop-ghost');
    ghost.removeAttribute('id');
    ghost.style.width = `${rect.width}px`;
    ghost.style.left = `${rect.left}px`;
    ghost.style.top = `${rect.top}px`;
    document.body.appendChild(ghost);
    touchDrag.ghost = ghost;

    card.classList.add('is-dragging');

    touchDrag.lastX = event.clientX;
    touchDrag.lastY = event.clientY;
    touchDrag.rafId = window.requestAnimationFrame(autoScrollStep);
  }

  /* Below 900px the two lists stack, so the drop target is usually off-screen
     when the drag starts. Without this the gesture is impossible on a phone:
     the finger cannot reach the other list, and elementFromPoint returns null
     for any point outside the viewport. Scroll when the finger nears an edge. */
  const EDGE_ZONE = 88;
  const EDGE_SPEED = 26;   // px per frame at the very edge (~1500px/s at 60fps)

  function autoScrollStep() {
    if (!isTouchDragging()) { touchDrag.rafId = null; return; }
    const y = touchDrag.lastY;
    const h = window.innerHeight;
    let dy = 0;
    if (y < EDGE_ZONE) dy = -EDGE_SPEED * (1 - y / EDGE_ZONE);
    else if (y > h - EDGE_ZONE) dy = EDGE_SPEED * (1 - (h - y) / EDGE_ZONE);
    if (dy) {
      const before = window.scrollY;
      window.scrollBy(0, dy);
      // Nothing left to scroll: stop nudging so the drop target stays stable.
      if (window.scrollY !== before) updateDropTarget(touchDrag.lastX, touchDrag.lastY);
    }
    touchDrag.rafId = window.requestAnimationFrame(autoScrollStep);
  }

  function updateDropTarget(clientX, clientY) {
    // The ghost has pointer-events: none, so this returns what is underneath.
    const under = document.elementFromPoint(clientX, clientY);
    const list = under && under.closest ? under.closest('.rop-list-area') : null;
    if (!list) return;

    [elements.sourceList, elements.targetList].forEach((el) => {
      if (el) el.classList.toggle('drag-over', el === list);
    });

    const after = getDragAfterElement(list, clientY);
    if (after == null) {
      list.appendChild(touchDrag.card);
    } else if (after !== touchDrag.card) {
      list.insertBefore(touchDrag.card, after);
    }
  }

  function moveTouchDrag(event) {
    if (!isTouchDragging() || event.pointerId !== touchDrag.pointerId) return;
    event.preventDefault();

    touchDrag.lastX = event.clientX;
    touchDrag.lastY = event.clientY;
    touchDrag.ghost.style.left = `${event.clientX - touchDrag.offsetX}px`;
    touchDrag.ghost.style.top = `${event.clientY - touchDrag.offsetY}px`;

    updateDropTarget(event.clientX, event.clientY);
  }

  function endTouchDrag(event) {
    if (!isTouchDragging() || (event && event.pointerId !== touchDrag.pointerId)) return;

    document.removeEventListener('pointermove', moveTouchDrag);
    document.removeEventListener('pointerup', endTouchDrag);
    document.removeEventListener('pointercancel', endTouchDrag);
    if (touchDrag.rafId !== null) {
      window.cancelAnimationFrame(touchDrag.rafId);
      touchDrag.rafId = null;
    }

    const card = touchDrag.card;
    touchDrag.ghost?.remove();
    card.classList.remove('is-dragging');
    [elements.sourceList, elements.targetList].forEach((el) => el && el.classList.remove('drag-over'));

    touchDrag.card = null;
    touchDrag.ghost = null;
    touchDrag.pointerId = null;

    syncStateFromDOM();
    refreshAllRovingTabindex();
    announce(`Moved. ${positionLabel(card)}`);
  }

  function attachTouchDrag(card) {
    const handle = card.querySelector('.rop-item-handle');
    if (!handle) return;
    handle.addEventListener('pointerdown', (event) => {
      // Mouse keeps the native HTML5 path, which already works on desktop.
      if (state.submitted || event.pointerType === 'mouse' || isTouchDragging()) return;
      event.preventDefault();
      beginTouchDrag(card, event);
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

    // Render cohesion feedback cards for incorrect adjacent user transitions (up to 4 cards)
    const incorrectPairs = pairResults.filter(p => !p.isCorrect);
    const maxFeedbackCards = 4;
    const cardsToRender = incorrectPairs.slice(0, maxFeedbackCards);
    const finalParagraphIndex = correctSequence[correctSequence.length - 1];

    if (cardsToRender.length > 0 && elements.cohesionFeedback) {
      const feedbackCardsHtml = cardsToRender.map((res) => {
        const A = res.firstIndex;
        const B = res.secondIndex;
        let content = '';
        if (A === finalParagraphIndex) {
          content = `Paragraph ${A} is the concluding paragraph.`;
        } else if (B === 1) {
          content = `Paragraph 1 is the starting paragraph.`;
        } else {
          const key = `${A}-${A+1}`;
          const reason = state.currentQuestion.cohesionReasons?.[key] || '';
          content = `Paragraph ${A} should be followed by Paragraph ${A+1}.${reason ? ' ' + escapeHtml(reason) : ''}`;
        }
        return `
          <div class="rop-cohesion-card">
            <div class="rop-cohesion-card-icon">⚠️</div>
            <div class="rop-cohesion-card-text">${content}</div>
          </div>
        `;
      }).join('');

      elements.cohesionFeedback.innerHTML = `
        <div class="rop-cohesion-header">Cohesion Feedback</div>
        <div class="rop-cohesion-grid">${feedbackCardsHtml}</div>
      `;
      elements.cohesionFeedback.style.display = 'block';
    } else if (elements.cohesionFeedback) {
      elements.cohesionFeedback.style.display = 'none';
      elements.cohesionFeedback.innerHTML = '';
    }

    // Toggle button visibilities
    if (elements.submitBtn) {
      elements.submitBtn.style.display = 'none';
    }
    if (elements.retryBtn) {
      elements.retryBtn.style.display = 'block';
    }
    // Show AI critique button if user is not 100% correct
    if (elements.critiqueBtn) {
      if (score < maxPossibleScore) {
        elements.critiqueBtn.style.display = 'block';
      } else {
        elements.critiqueBtn.style.display = 'none';
      }
    }

    window.PTEAttemptArchive?.saveAttempt?.({
      practiceMode: 'rop',
      promptSnapshot: window.PTEAttemptArchive.summarizeQuestion(state.currentQuestion),
      responseSnapshot: {
        selectedOrder: state.targetItems.map((item, index) => ({
          position: index,
          id: item.id || item.originalIndex,
          originalIndex: item.originalIndex,
          text: item.text || item.paragraph || ''
        }))
      },
      answerSnapshot: {
        correctOrder: state.currentQuestion.paragraphs.map((item, index) => ({
          position: index,
          id: item.id || item.originalIndex,
          originalIndex: item.originalIndex,
          text: item.text || item.paragraph || ''
        })),
        pairResults
      },
      resultSnapshot: {
        score,
        maxScore: maxPossibleScore,
        pairResults
      },
      scoringSource: 'client'
    }).catch((error) => console.warn('[PTE Archive] ROP save failed:', error));

    // Show explanation panel if explanations exist
    if (elements.explanationToggle && state.currentQuestion.explanation) {
      elements.explanationToggle.style.display = 'block';
      if (elements.explanationContent) {
        elements.explanationContent.innerHTML = parseMarkdownInHtml(sanitizeExplanationHtml(state.currentQuestion.explanation));
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
    updateReviewSplitVisibility(state.explanationVisible || isCritiquePanelVisible());
  }

  async function requestAiCritique() {
    if (!state.currentQuestion || state.sourceItems.length > 0) return;

    const user = firebase.auth().currentUser;
    if (!user) {
      if (window.authUI && typeof window.authUI.showLoginModal === 'function') {
        window.authUI.showLoginModal();
      } else {
        alert('Please log in to use the AI order critique feature.');
      }
      return;
    }

    const correctSequence = state.currentQuestion.paragraphs.map(p => p.originalIndex);
    const userSequence = state.targetItems.map(item => item.originalIndex);
    const paragraphsObj = {};
    state.currentQuestion.paragraphs.forEach(p => {
      paragraphsObj[String(p.originalIndex)] = p.text;
    });

    if (elements.critiqueBtn) elements.critiqueBtn.disabled = true;
    if (elements.critiqueSpinner) elements.critiqueSpinner.style.display = 'inline-block';
    if (elements.critiquePanel) elements.critiquePanel.style.display = 'none';
    if (elements.critiqueContent) elements.critiqueContent.innerHTML = '';

    try {
      const idToken = await user.getIdToken();
      const response = await fetch('/api/rop/explain-order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({
          correctSequence,
          userSequence,
          paragraphs: paragraphsObj
        })
      });

      const resJson = await response.json().catch(() => null);

      if (response.ok && resJson && resJson.success && resJson.data?.critique) {
        if (elements.critiqueContent) {
          elements.critiqueContent.innerHTML = parseMarkdownToHtml(resJson.data.critique);
        }
        if (elements.critiquePanel) {
          elements.critiquePanel.style.display = 'block';
        }
      } else {
        const errorMsg = resJson?.message || 'Failed to generate AI critique. Please try again.';
        if (elements.critiqueContent) {
          elements.critiqueContent.innerHTML = parseMarkdownToHtml(errorMsg);
        }
        if (elements.critiquePanel) {
          elements.critiquePanel.style.display = 'block';
        }
      }
    } catch (err) {
      console.error('[ROPMode] AI critique request failed:', err);
      if (elements.critiqueContent) {
        elements.critiqueContent.innerHTML = parseMarkdownToHtml('An error occurred while calling the AI critique service. Please try again later.');
      }
      if (elements.critiquePanel) {
        elements.critiquePanel.style.display = 'block';
      }
    } finally {
      if (elements.critiqueBtn) elements.critiqueBtn.disabled = false;
      if (elements.critiqueSpinner) elements.critiqueSpinner.style.display = 'none';
      updateReviewSplitVisibility(state.explanationVisible || isCritiquePanelVisible());
    }
  }

  /* Global Controller Hooks */
  function applyFilters() {
    const selected = window.DifficultyFilter?.getCurrentDifficulty('rop') || 'all';
    const adaptive = !!window.DifficultyManager?.getGlobalSettings?.()?.autoAdjustEnabled;

    let targetLevel = null;
    if (selected !== 'all') {
      targetLevel = Number(selected);
    } else if (adaptive && window.DifficultyManager?.isCalibrated?.('rop')) {
      targetLevel = window.DifficultyManager.getContentTier?.('rop') ?? null;
    }

    state.filteredQuestions = targetLevel
      ? state.questions.filter(q => q.level === targetLevel)
      : [...state.questions];

    // After filtering, make sure we have questions
    if (state.filteredQuestions.length === 0) {
      state.currentQuestionIndex = 0;
      state.currentQuestion = null;
      updateNavigationUI();
      if (elements.sourceList) {
        elements.sourceList.innerHTML = '<div style="padding: 20px; color: var(--rop-muted);">No questions available for this difficulty level.</div>';
      }
      if (elements.targetList) elements.targetList.innerHTML = '';
      if (elements.submitBtn) elements.submitBtn.style.display = 'none';
      if (elements.retryBtn) elements.retryBtn.style.display = 'none';
      if (elements.explanationToggle) elements.explanationToggle.style.display = 'none';
      if (elements.resultBox) elements.resultBox.style.display = 'none';
      if (elements.explanationPanel) elements.explanationPanel.style.display = 'none';
      return;
    }

    let newIndex = 0;
    if (state.currentQuestion) {
      const idx = state.filteredQuestions.findIndex(q => q.id === state.currentQuestion.id);
      if (idx !== -1) {
        newIndex = idx;
      }
    }

    loadQuestion(newIndex);
  }

  async function loadQuestionById(questionId) {
    if (state.questions.length === 0) {
      await loadData();
    }
    const numericId = Number(questionId);
    const index = state.questions.findIndex(q => q.id === numericId);
    if (index === -1) return;

    // Check if the question is in the current filtered questions
    let filteredIndex = state.filteredQuestions.findIndex(q => q.id === numericId);
    if (filteredIndex === -1) {
      // Not in filtered list, reset difficulty to all
      if (window.DifficultyFilter && typeof window.DifficultyFilter.setCurrentDifficulty === 'function') {
        window.DifficultyFilter.setCurrentDifficulty('rop', 'all');
      }
      state.currentQuestion = state.questions[index];
      applyFilters();
    } else {
      loadQuestion(filteredIndex);
    }
  }

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
      const urlRoute = window.PracticeRouter ? window.PracticeRouter.initFromURL() : null;
      if (urlRoute && urlRoute.mode === 'rop' && urlRoute.questionId) {
        await loadQuestionById(urlRoute.questionId);
      } else {
        applyFilters();
      }
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
    onExit,
    applyFilters
  };

  // Deep-link support: listen for PracticeRouter question navigation events
  window.addEventListener('practice-route-question', async (event) => {
    const { mode, questionId } = event.detail || {};
    if (mode !== 'rop' || !questionId) return;
    await loadQuestionById(questionId);
  });
})();
