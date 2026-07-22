/**
 * Speaking Practice Controller — Core Module
 * Provides a unified controller shell for PTE Speaking practice modes.
 *
 * Public API:
 *   SpeakingPracticeController.register(config)
 *   SpeakingPracticeController.activate(modeId, { scope })
 *   SpeakingPracticeController.sync(modeId)
 *   SpeakingPracticeController.getPreferredView()
 *   SpeakingPracticeController.setPreferredView(view)
 *   SpeakingPracticeController.unmount(modeId)
 *   SpeakingPracticeController.isV2Active(modeId, scope)
 */
(function () {
  'use strict';

  /* ═══════════════════════════ CONSTANTS ═══════════════════════════ */

  const STORAGE_KEY = 'bel:speaking-controller:view:v1';
  const VALID_VIEWS = new Set(['basic', 'advanced']);
  const FALLBACK_VIEW = 'basic';

  // All valid scope:mode combinations
  const TARGETS = new Set([
    'pte:speak', 'pte:read-aloud', 'pte:notes', 'pte:asq',
    'pte:sgd', 'pte:describe-image', 'pte:rts',
    'english:speak', 'english:read-aloud'
  ]);

  // All production adapters have now reached the integrated gate. The
  // controller is enabled from the production target list by default.
  const DEFAULT_ENABLED_TARGETS = new Set([
    'pte:speak', 'pte:read-aloud', 'pte:notes', 'pte:asq',
    'pte:sgd', 'pte:describe-image', 'pte:rts',
    'english:speak', 'english:read-aloud'
  ]);

  // Never enable these scope/mode combinations.
  const EXCLUDED_TARGETS = new Set([
    'pte:pronounce', 'english:notes', 'english:asq',
    'english:sgd', 'english:describe-image', 'english:rts'
  ]);

  /* ═══════════════════════════ STATE ═══════════════════════════ */

  /** @type {Map<string, Object>} modeId → adapter config */
  const registry = new Map();

  /** @type {Map<string, Object>} modeId → active controller state */
  const activeControllers = new Map();

  /** @type {Set<string>} resolved enabled targets for this session */
  let resolvedTargets = null;

  /** @type {string} in-memory view fallback */
  let inMemoryView = FALLBACK_VIEW;

  /** @type {number} scroll-lock counter */
  let scrollLockCount = 0;
  let savedBodyOverflow = '';

  function resolveTargets() {
    if (resolvedTargets) return resolvedTargets;
    resolvedTargets = new Set();

    for (const t of DEFAULT_ENABLED_TARGETS) {
      if (TARGETS.has(t) && !EXCLUDED_TARGETS.has(t)) resolvedTargets.add(t);
    }

    return resolvedTargets;
  }

  function isScopeEnabled(config, scope) {
    if (!config || !Array.isArray(config.enabledScopes) || config.enabledScopes.length === 0) {
      return true;
    }
    return config.enabledScopes.includes(scope);
  }

  function isV2Active(modeId, scope) {
    if (!scope) scope = 'pte';
    const key = scope + ':' + modeId;
    const config = registry.get(modeId);
    if (config && !isScopeEnabled(config, scope)) return false;
    const targets = resolveTargets();
    if (targets.has(key)) return true;
    // Test-only fixtures are opt-in and never part of production targets.
    if (!EXCLUDED_TARGETS.has(key) && config?.testOnly === true) {
      return true;
    }
    return false;
  }

  /* ═══════════════════════════ VIEW PREFERENCE ═══════════════════════════ */

  function readStoredView() {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      return VALID_VIEWS.has(v) ? v : FALLBACK_VIEW;
    } catch (_) {
      return inMemoryView;
    }
  }

  function writeStoredView(view) {
    if (!VALID_VIEWS.has(view)) return;
    inMemoryView = view;
    try {
      localStorage.setItem(STORAGE_KEY, view);
    } catch (_) { /* quota or private mode */ }
  }

  function getPreferredView() {
    return readStoredView();
  }

  function setPreferredView(view) {
    if (!VALID_VIEWS.has(view)) return;
    writeStoredView(view);
    // Sync all active controllers
    for (const [, state] of activeControllers) {
      applyView(state);
    }
  }

  // Cross-tab sync
  window.addEventListener('storage', function (e) {
    if (e.key !== STORAGE_KEY) return;
    const view = VALID_VIEWS.has(e.newValue) ? e.newValue : FALLBACK_VIEW;
    inMemoryView = view;
    for (const [, state] of activeControllers) {
      applyView(state);
    }
  });

  /* ═══════════════════════════ FOCUS TRAP ═══════════════════════════ */

  function getFocusableElements(container) {
    const sel = 'a[href], button:not([disabled]), input:not([disabled]), ' +
      'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    return Array.from(container.querySelectorAll(sel)).filter(
      el => el.offsetParent !== null
    );
  }

  function trapFocus(container, e) {
    const focusable = getFocusableElements(container);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  /* ═══════════════════════════ SCROLL LOCK ═══════════════════════════ */

  function lockScroll() {
    if (scrollLockCount === 0) {
      savedBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    scrollLockCount++;
  }

  function unlockScroll() {
    scrollLockCount--;
    if (scrollLockCount <= 0) {
      scrollLockCount = 0;
      if (savedBodyOverflow) {
        document.body.style.overflow = savedBodyOverflow;
      } else {
        document.body.style.removeProperty('overflow');
      }
      savedBodyOverflow = '';
    }
  }

  /* ═══════════════════════════ SHEET INFRASTRUCTURE ═══════════════════════════ */

  /**
   * Create a reusable sheet (right panel on desktop, bottom sheet on mobile).
   * @param {{ id: string, title: string, className?: string }} opts
   * @returns {{ el: HTMLElement, backdrop: HTMLElement, open: Function, close: Function, isOpen: Function, body: HTMLElement }}
   */
  function createSheet(opts) {
    const backdrop = document.createElement('div');
    backdrop.className = 'spc-sheet-backdrop';
    backdrop.setAttribute('data-spc-sheet-id', opts.id);

    const sheet = document.createElement('div');
    sheet.className = 'spc-sheet' + (opts.className ? ' ' + opts.className : '');
    sheet.id = opts.id;
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', opts.title);

    const header = document.createElement('div');
    header.className = 'spc-sheet-header';

    const title = document.createElement('h3');
    title.className = 'spc-sheet-title';
    title.textContent = opts.title;

    const closeBtn = document.createElement('button');
    closeBtn.className = 'spc-sheet-close';
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.textContent = '\u00d7';

    header.appendChild(title);
    header.appendChild(closeBtn);

    const body = document.createElement('div');
    body.className = 'spc-sheet-body';

    sheet.appendChild(header);
    sheet.appendChild(body);

    document.body.appendChild(backdrop);
    document.body.appendChild(sheet);

    let savedFocus = null;
    let keyHandler = null;
    let openState = false;

    sheet.setAttribute('aria-hidden', 'true');
    sheet.inert = true;
    closeBtn.tabIndex = -1;

    function open() {
      if (openState) return;
      openState = true;
      savedFocus = document.activeElement;
      backdrop.classList.add('is-active');
      sheet.classList.add('is-active');
      sheet.setAttribute('aria-hidden', 'false');
      sheet.inert = false;
      closeBtn.tabIndex = 0;
      lockScroll();

      // Focus first focusable element in sheet
      requestAnimationFrame(() => {
        const focusable = getFocusableElements(sheet);
        if (focusable.length > 0) focusable[0].focus();
      });

      keyHandler = function (e) {
        if (e.key === 'Escape') {
          e.stopPropagation();
          close();
        } else if (e.key === 'Tab') {
          trapFocus(sheet, e);
        }
      };
      document.addEventListener('keydown', keyHandler, true);
      if (typeof opts.onOpen === 'function') opts.onOpen();
    }

    function close() {
      if (!openState) return;
      openState = false;
      backdrop.classList.remove('is-active');
      sheet.classList.remove('is-active');
      sheet.setAttribute('aria-hidden', 'true');
      sheet.inert = true;
      closeBtn.tabIndex = -1;
      unlockScroll();

      if (keyHandler) {
        document.removeEventListener('keydown', keyHandler, true);
        keyHandler = null;
      }

      if (savedFocus && savedFocus.isConnected) {
        savedFocus.focus();
      }
      savedFocus = null;
      if (typeof opts.onClose === 'function') opts.onClose();
    }

    function isOpen() {
      return sheet.classList.contains('is-active');
    }

    function destroy() {
      if (openState) close();
      backdrop.remove();
      sheet.remove();
    }

    backdrop.addEventListener('click', close);
    closeBtn.addEventListener('click', close);

    return { el: sheet, backdrop, body, open, close, isOpen, destroy };
  }

  /* ═══════════════════════════ PICKER ═══════════════════════════ */

  /**
   * Build picker infrastructure for an adapter config.
   * @param {Object} config - adapter config
   * @param {Object} controllerState - active controller state
   */
  function buildPicker(config, controllerState) {
    const picker = config.picker;
    if (!picker) return;

    const pillEl = controllerState.dom.pill;
    const pillId = controllerState.dom.pillId;
    const pillLabel = controllerState.dom.pillLabel;
    const prevBtn = controllerState.dom.prevBtn;
    const nextBtn = controllerState.dom.nextBtn;

    // Determine if select-backed or custom-backed
    const isSelectBacked = !!picker.sourceSelectId;
    let sourceSelect = null;

    if (isSelectBacked) {
      sourceSelect = document.getElementById(picker.sourceSelectId);
      if (sourceSelect) {
        controllerState.sourceSelectOriginalDisplay = sourceSelect.style.display;
        sourceSelect.style.display = 'none';
        controllerState.sourceSelect = sourceSelect;
      }
    }

    // Wire navigation buttons
    if (picker.previousButtonId) {
      const srcPrev = document.getElementById(picker.previousButtonId);
      if (srcPrev) {
        controllerState.srcPrevOriginalDisplay = srcPrev.style.display;
        srcPrev.style.display = 'none';
        controllerState.srcPrevBtn = srcPrev;
        prevBtn.addEventListener('click', () => srcPrev.click());
        prevBtn.style.display = '';
      } else if (typeof picker.previous === 'function') {
        prevBtn.addEventListener('click', () => { try { picker.previous(); } catch (e) { console.error('[SPC] picker.previous() error:', e); } });
        prevBtn.style.display = '';
      } else {
        prevBtn.style.display = 'none';
      }
    } else if (typeof picker.previous === 'function') {
      prevBtn.addEventListener('click', () => { try { picker.previous(); } catch (e) { console.error('[SPC] picker.previous() error:', e); } });
      prevBtn.style.display = '';
    } else {
      prevBtn.style.display = 'none';
    }

    if (picker.nextButtonId) {
      const srcNext = document.getElementById(picker.nextButtonId);
      if (srcNext) {
        controllerState.srcNextOriginalDisplay = srcNext.style.display;
        srcNext.style.display = 'none';
        controllerState.srcNextBtn = srcNext;
        nextBtn.addEventListener('click', () => srcNext.click());
        nextBtn.style.display = '';
      } else if (typeof picker.next === 'function') {
        nextBtn.addEventListener('click', () => { try { picker.next(); } catch (e) { console.error('[SPC] picker.next() error:', e); } });
        nextBtn.style.display = '';
      } else {
        nextBtn.style.display = 'none';
      }
    } else if (typeof picker.next === 'function') {
      nextBtn.addEventListener('click', () => { try { picker.next(); } catch (e) { console.error('[SPC] picker.next() error:', e); } });
      nextBtn.style.display = '';
    } else {
      nextBtn.style.display = 'none';
    }

    if (picker.randomButtonId) {
      const srcRandom = document.getElementById(picker.randomButtonId);
      if (srcRandom) {
        // For random, wire it to the prev button spot or add a separate random btn
        controllerState.srcRandomBtn = srcRandom;
        // If no prev button, the random button gets the prev slot
        if (!picker.previousButtonId && prevBtn.style.display === 'none') {
          prevBtn.textContent = '🎲';
          prevBtn.setAttribute('aria-label', 'Random question');
          prevBtn.style.display = '';
          prevBtn.addEventListener('click', () => srcRandom.click());
        }
        srcRandom.style.display = 'none';
      }
    }

    // Build picker sheet
    const sheet = createSheet({
      id: 'spc-picker-sheet-' + config.modeId,
      title: 'Select Question',
      onOpen: () => pillEl.setAttribute('aria-expanded', 'true'),
      onClose: () => pillEl.setAttribute('aria-expanded', 'false')
    });
    controllerState.pickerSheet = sheet;

    // Build search input
    const searchInput = document.createElement('input');
    searchInput.className = 'spc-sheet-search';
    searchInput.type = 'search';
    searchInput.placeholder = 'Search by ID, title, or prompt\u2026';
    searchInput.setAttribute('aria-label', 'Search questions');

    const listEl = document.createElement('ul');
    listEl.className = 'spc-sheet-list';
    listEl.setAttribute('role', 'listbox');

    const emptyEl = document.createElement('div');
    emptyEl.className = 'spc-sheet-empty';
    emptyEl.textContent = 'No questions found';
    emptyEl.style.display = 'none';

    sheet.body.appendChild(searchInput);
    sheet.body.appendChild(listEl);
    sheet.body.appendChild(emptyEl);

    controllerState.pickerListEl = listEl;
    controllerState.pickerEmptyEl = emptyEl;
    controllerState.pickerSearchInput = searchInput;

    pillEl.addEventListener('click', () => {
      syncPickerSheet(config, controllerState);
      sheet.open();
      requestAnimationFrame(() => searchInput.focus());
    });

    // Search filtering
    searchInput.addEventListener('input', () => {
      filterPickerSheet(controllerState, searchInput.value);
    });

    // Listen to source select changes
    if (sourceSelect) {
      const onSelectChange = () => updatePillDisplay(config, controllerState);
      sourceSelect.addEventListener('change', onSelectChange);
      controllerState.selectChangeHandler = onSelectChange;
    }

    // Initial pill display
    updatePillDisplay(config, controllerState);
  }

  function getPickerItems(config, controllerState) {
    const picker = config.picker;
    if (picker.sourceSelectId && controllerState.sourceSelect) {
      const select = controllerState.sourceSelect;
      return Array.from(select.options).map(opt => ({
        id: opt.value,
        label: opt.textContent.trim(),
        searchText: opt.textContent.trim(),
        disabled: opt.disabled,
        selected: opt.selected
      }));
    } else if (picker.getItems) {
      try {
        return picker.getItems();
      } catch (e) {
        console.error('[SPC] picker.getItems() error:', e);
        return [];
      }
    }
    return [];
  }

  function getCurrentPickerId(config, controllerState) {
    const picker = config.picker;
    if (picker.sourceSelectId && controllerState.sourceSelect) {
      return controllerState.sourceSelect.value;
    } else if (picker.getCurrentId) {
      try {
        return picker.getCurrentId();
      } catch (e) {
        console.error('[SPC] picker.getCurrentId() error:', e);
        return null;
      }
    }
    return null;
  }

  function selectPickerItem(config, controllerState, id) {
    const picker = config.picker;
    if (picker.sourceSelectId && controllerState.sourceSelect) {
      controllerState.sourceSelect.value = id;
      controllerState.sourceSelect.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (picker.select) {
      try {
        picker.select(id);
      } catch (e) {
        console.error('[SPC] picker.select() error:', e);
      }
    }
  }

  function updatePillDisplay(config, controllerState) {
    const currentId = getCurrentPickerId(config, controllerState);
    const items = getPickerItems(config, controllerState);
    const current = items.find(i => i.id === currentId);

    const pillId = controllerState.dom.pillId;
    const pillLabel = controllerState.dom.pillLabel;

    if (current) {
      pillId.textContent = '#' + current.id;
      pillLabel.textContent = current.label;
    } else if (items.length === 0) {
      pillId.textContent = '';
      pillLabel.textContent = 'Loading\u2026';
    } else {
      pillId.textContent = '';
      pillLabel.textContent = 'Select question';
    }
  }

  function syncPickerSheet(config, controllerState) {
    const items = getPickerItems(config, controllerState);
    const currentId = getCurrentPickerId(config, controllerState);
    const listEl = controllerState.pickerListEl;
    const emptyEl = controllerState.pickerEmptyEl;
    const searchInput = controllerState.pickerSearchInput;

    searchInput.value = '';
    listEl.innerHTML = '';

    if (items.length === 0) {
      emptyEl.textContent = 'No questions available';
      emptyEl.style.display = '';
      return;
    }

    emptyEl.style.display = 'none';

    items.forEach(item => {
      const li = document.createElement('li');
      li.className = 'spc-sheet-item' + (item.id === currentId ? ' is-current' : '');
      li.setAttribute('role', 'option');
      li.tabIndex = 0;
      li.setAttribute('aria-selected', item.id === currentId ? 'true' : 'false');
      if (item.disabled) li.setAttribute('aria-disabled', 'true');
      li.dataset.id = item.id;
      li.dataset.search = (item.id + ' ' + item.label + ' ' + (item.searchText || '')).toLowerCase();

      const idSpan = document.createElement('span');
      idSpan.className = 'spc-sheet-item-id';
      idSpan.textContent = '#' + item.id;

      const labelSpan = document.createElement('span');
      labelSpan.className = 'spc-sheet-item-label';
      labelSpan.textContent = item.label;

      li.appendChild(idSpan);
      li.appendChild(labelSpan);

      li.addEventListener('click', () => {
        if (item.disabled) return;
        selectPickerItem(config, controllerState, item.id);
        controllerState.pickerSheet.close();
        updatePillDisplay(config, controllerState);
      });

      li.addEventListener('keydown', (event) => {
        if (item.disabled) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          li.click();
        }
      });

      listEl.appendChild(li);
    });
  }

  function filterPickerSheet(controllerState, query) {
    const normalized = query.toLowerCase().trim();
    const items = controllerState.pickerListEl.children;
    const emptyEl = controllerState.pickerEmptyEl;
    let visibleCount = 0;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const matches = !normalized || item.dataset.search.includes(normalized);
      item.style.display = matches ? '' : 'none';
      if (matches) visibleCount++;
    }

    emptyEl.textContent = 'No matching questions';
    emptyEl.style.display = visibleCount === 0 ? '' : 'none';
  }

  /* ═══════════════════════════ DOM CONSTRUCTION ═══════════════════════════ */

  function buildControllerDOM(config) {
    const controller = document.createElement('div');
    controller.className = 'spc-controller';
    controller.dataset.spcMode = config.modeId;
    controller.dataset.spcView = FALLBACK_VIEW;

    // Row 1: Primary (picker + toggle)
    const row1 = document.createElement('div');
    row1.className = 'spc-row spc-row--primary';

    const pickerNav = document.createElement('div');
    pickerNav.className = 'spc-picker-nav';

    const prevBtn = document.createElement('button');
    prevBtn.className = 'spc-picker-prev';
    prevBtn.type = 'button';
    prevBtn.setAttribute('aria-label', 'Previous question');
    prevBtn.textContent = '\u2039';

    const pill = document.createElement('button');
    pill.className = 'spc-picker-pill';
    pill.id = 'spc-picker-' + config.modeId;
    pill.type = 'button';
    pill.setAttribute('aria-expanded', 'false');
    pill.setAttribute('aria-haspopup', 'dialog');

    const pillId = document.createElement('span');
    pillId.className = 'spc-picker-pill-id';
    const pillLabel = document.createElement('span');
    pillLabel.className = 'spc-picker-pill-label';
    pillLabel.textContent = 'Select question';
    const pillArrow = document.createElement('span');
    pillArrow.className = 'spc-picker-pill-arrow';
    pillArrow.textContent = '\u25be';

    pill.appendChild(pillId);
    pill.appendChild(pillLabel);
    pill.appendChild(pillArrow);

    const nextBtn = document.createElement('button');
    nextBtn.className = 'spc-picker-next';
    nextBtn.type = 'button';
    nextBtn.setAttribute('aria-label', 'Next question');
    nextBtn.textContent = '\u203a';

    pickerNav.appendChild(prevBtn);
    pickerNav.appendChild(pill);
    pickerNav.appendChild(nextBtn);

    // View toggle
    const toggle = document.createElement('div');
    toggle.className = 'spc-view-toggle';
    toggle.setAttribute('role', 'group');
    toggle.setAttribute('aria-label', 'View mode');

    const basicBtn = document.createElement('button');
    basicBtn.className = 'spc-view-toggle-btn';
    basicBtn.type = 'button';
    basicBtn.dataset.view = 'basic';
    basicBtn.setAttribute('aria-pressed', 'true');
    basicBtn.textContent = 'Basic';

    const advancedBtn = document.createElement('button');
    advancedBtn.className = 'spc-view-toggle-btn';
    advancedBtn.type = 'button';
    advancedBtn.dataset.view = 'advanced';
    advancedBtn.setAttribute('aria-pressed', 'false');
    advancedBtn.textContent = 'Advanced';

    toggle.appendChild(basicBtn);
    toggle.appendChild(advancedBtn);

    row1.appendChild(pickerNav);
    row1.appendChild(toggle);

    // Row 2: Actions (media + attempt)
    const row2 = document.createElement('div');
    row2.className = 'spc-row spc-row--actions';

    const slotMedia = document.createElement('div');
    slotMedia.className = 'spc-slot-media';
    const slotAttempt = document.createElement('div');
    slotAttempt.className = 'spc-slot-attempt';

    row2.appendChild(slotMedia);
    row2.appendChild(slotAttempt);

    // Row 3: Advanced
    const row3 = document.createElement('div');
    row3.className = 'spc-row spc-row--advanced';

    const activeChip = document.createElement('span');
    activeChip.className = 'spc-active-chip';
    activeChip.dataset.count = '0';
    activeChip.setAttribute('role', 'status');
    activeChip.setAttribute('aria-live', 'polite');
    activeChip.tabIndex = 0;
    activeChip.textContent = 'Advanced settings active (0)';

    const slotAdvAction = document.createElement('div');
    slotAdvAction.className = 'spc-slot-advanced-action';
    const slotAdvSetting = document.createElement('div');
    slotAdvSetting.className = 'spc-slot-advanced-setting';

    row3.appendChild(activeChip);
    row3.appendChild(slotAdvAction);
    row3.appendChild(slotAdvSetting);

    controller.appendChild(row1);
    controller.appendChild(row2);
    controller.appendChild(row3);

    return {
      controller, row1, row2, row3,
      pickerNav, prevBtn, pill, pillId, pillLabel, pillArrow, nextBtn,
      toggle, basicBtn, advancedBtn,
      slotMedia, slotAttempt, slotAdvAction, slotAdvSetting,
      activeChip
    };
  }

  /* ═══════════════════════════ DOM ADOPTION ═══════════════════════════ */

  function adoptControls(config, controllerState) {
    const controls = config.controls || [];
    const adoptedNodes = [];

    const slotMap = {
      'media': controllerState.dom.slotMedia,
      'attempt': controllerState.dom.slotAttempt,
      'advanced-action': controllerState.dom.slotAdvAction,
      'advanced-setting': controllerState.dom.slotAdvSetting
    };

    // Sort by order
    const sorted = controls.slice().sort((a, b) => (a.order || 0) - (b.order || 0));

    try {
      sorted.forEach(ctrl => {
        const el = document.getElementById(ctrl.sourceId);
        if (!el) {
          console.warn('[SPC] Control element not found:', ctrl.sourceId);
          return;
        }

        const slot = slotMap[ctrl.slot];
        if (!slot) {
          console.warn('[SPC] Unknown slot:', ctrl.slot);
          return;
        }

        // Insert restoration anchor
        const anchor = document.createComment('spc-anchor:' + ctrl.sourceId);
        el.parentNode.insertBefore(anchor, el);

        // Record original position
        adoptedNodes.push({
          sourceId: ctrl.sourceId,
          element: el,
          anchor: anchor,
          originalDisplay: el.style.display
        });

        // Set level attribute for CSS visibility
        if (ctrl.level === 'advanced') {
          el.dataset.spcLevel = 'advanced';
        }

        // Move into slot
        slot.appendChild(el);

        // Visibility scope observer
        if (ctrl.visibilityScopeId) {
          const scopeEl = document.getElementById(ctrl.visibilityScopeId);
          if (scopeEl) {
            const observer = new MutationObserver(() => {
              const scopeVisible = scopeEl.style.display !== 'none' &&
                !scopeEl.hidden &&
                scopeEl.offsetParent !== null;
              el.style.display = scopeVisible ? '' : 'none';
            });
            observer.observe(scopeEl, {
              attributes: true,
              attributeFilter: ['style', 'hidden', 'class']
            });
            adoptedNodes[adoptedNodes.length - 1].observer = observer;
          }
        }
      });

      controllerState.adoptedNodes = adoptedNodes;

      // In-place controls (stay in mode panel, get visibility gating)
      const inPlaceControls = config.inPlaceControls || [];
      const inPlaceTracked = [];

      inPlaceControls.forEach(ctrl => {
        const el = document.getElementById(ctrl.sourceId);
        if (!el) return;
        el.dataset.spcLevel = ctrl.level;
        inPlaceTracked.push({ sourceId: ctrl.sourceId, element: el });
      });

      controllerState.inPlaceNodes = inPlaceTracked;
    } catch (e) {
      console.error('[SPC] Error adopting controls:', e);
      restoreControls(controllerState);
    }
  }

  function hideLegacyPicker(config, controllerState) {
    const legacyId = config?.picker?.legacyContainerId;
    if (!legacyId) return;
    const legacy = document.getElementById(legacyId);
    if (!legacy) return;
    controllerState.legacyPickerContainer = legacy;
    controllerState.legacyPickerOriginalDisplay = legacy.style.display;
    legacy.style.display = 'none';
  }

  function restoreControls(controllerState) {
    // Restore adopted nodes
    const adopted = controllerState.adoptedNodes || [];
    adopted.forEach(record => {
      if (record.observer) {
        record.observer.disconnect();
      }

      const anchor = record.anchor;
      const el = record.element;

      if (anchor && anchor.parentNode) {
        anchor.parentNode.insertBefore(el, anchor.nextSibling);
        anchor.remove();
      }

      // Restore display
      if (record.originalDisplay !== undefined) {
        el.style.display = record.originalDisplay;
      }

      // Remove level attribute
      delete el.dataset.spcLevel;
    });

    // Restore in-place controls
    const inPlace = controllerState.inPlaceNodes || [];
    inPlace.forEach(record => {
      delete record.element.dataset.spcLevel;
    });

    // Restore source elements
    if (controllerState.sourceSelect) {
      controllerState.sourceSelect.style.display = controllerState.sourceSelectOriginalDisplay ?? '';
    }
    if (controllerState.srcPrevBtn) {
      controllerState.srcPrevBtn.style.display = controllerState.srcPrevOriginalDisplay ?? '';
    }
    if (controllerState.srcNextBtn) {
      controllerState.srcNextBtn.style.display = controllerState.srcNextOriginalDisplay ?? '';
    }
    if (controllerState.srcRandomBtn) {
      controllerState.srcRandomBtn.style.display = '';
    }
  }

  /* ═══════════════════════════ VIEW MANAGEMENT ═══════════════════════════ */

  function applyView(controllerState) {
    const config = controllerState.config;
    const dom = controllerState.dom;
    const hasAdvanced = hasAdvancedCapability(config);
    const view = hasAdvanced ? getPreferredView() : FALLBACK_VIEW;

    dom.controller.dataset.spcView = view;

    // Also set on the mode panel so in-place controls (outside .spc-controller)
    // are CSS-gated via [data-spc-view]:not([data-spc-view="advanced"]) selector
    if (controllerState.panel) {
      controllerState.panel.dataset.spcView = view;
    }

    // Update toggle buttons
    dom.basicBtn.setAttribute('aria-pressed', view === 'basic' ? 'true' : 'false');
    dom.advancedBtn.setAttribute('aria-pressed', view === 'advanced' ? 'true' : 'false');

    // Update active chip
    updateActiveChip(controllerState);
  }

  function hasAdvancedCapability(config) {
    const hasAdvControls = (config.controls || []).some(c => c.level === 'advanced');
    const hasAdvInPlace = (config.inPlaceControls || []).some(c => c.level === 'advanced');
    const hasAdvSettings = (config.advancedSettings || []).length > 0;
    return hasAdvControls || hasAdvInPlace || hasAdvSettings;
  }

  function updateActiveChip(controllerState) {
    const config = controllerState.config;
    const chip = controllerState.dom.activeChip;
    const settings = config.advancedSettings || [];

    let activeCount = 0;
    settings.forEach(s => {
      try {
        if (typeof s.isActive === 'function' && s.isActive()) {
          activeCount++;
        }
      } catch (_) { /* guard */ }
    });

    chip.dataset.count = String(activeCount);
    chip.textContent = 'Advanced settings active (' + activeCount + ')';
  }

  function wireViewToggle(controllerState) {
    const dom = controllerState.dom;

    function handleToggle(view) {
      // Close any open sheet when switching to basic
      if (view === 'basic') {
        if (controllerState.pickerSheet && controllerState.pickerSheet.isOpen()) {
          controllerState.pickerSheet.close();
        }
      }

      setPreferredView(view);
    }

    dom.basicBtn.addEventListener('click', () => handleToggle('basic'));
    dom.advancedBtn.addEventListener('click', () => handleToggle('advanced'));

    // Active chip: click switches to Advanced
    dom.activeChip.addEventListener('click', () => handleToggle('advanced'));
    dom.activeChip.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleToggle('advanced');
      }
    });
  }

  /* ═══════════════════════════ SYNC ═══════════════════════════ */

  function syncController(modeId) {
    const state = activeControllers.get(modeId);
    if (!state) return;

    updatePillDisplay(state.config, state);
    updateActiveChip(state);
  }

  /* ═══════════════════════════ PUBLIC API ═══════════════════════════ */

  function register(config) {
    if (!config || !config.modeId) {
      console.error('[SPC] register() requires config.modeId');
      return;
    }
    registry.set(config.modeId, config);
  }

  function activate(modeId, opts) {
    opts = opts || {};
    const scope = opts.scope || 'pte';

    const config = registry.get(modeId);
    if (!config) {
      console.warn('[SPC] No registered adapter for mode:', modeId);
      return;
    }

    if (!isScopeEnabled(config, scope) || !isV2Active(modeId, scope)) {
      unmount(modeId);
      return;
    }

    // If already active, just sync
    if (activeControllers.has(modeId)) {
      const activeState = activeControllers.get(modeId);
      activeState.scope = scope;
      applyView(activeState);
      syncController(modeId);
      return;
    }

    // Get mode panel
    const panel = document.getElementById(config.panelId);
    if (!panel) {
      console.warn('[SPC] Panel not found:', config.panelId);
      return;
    }

    // Build DOM
    const dom = buildControllerDOM(config);

    // Check if has advanced capability
    if (!hasAdvancedCapability(config)) {
      dom.controller.dataset.spcNoToggle = '';
    }

    // Create state
    const state = {
      modeId: modeId,
      scope: scope,
      config: config,
      dom: dom,
      panel: panel,
      adoptedNodes: [],
      inPlaceNodes: [],
      sourceSelect: null,
      srcPrevBtn: null,
      srcNextBtn: null,
      srcRandomBtn: null,
      pickerSheet: null,
      pickerListEl: null,
      pickerEmptyEl: null,
      pickerSearchInput: null,
      selectChangeHandler: null,
      legacyPickerContainer: null,
      legacyPickerOriginalDisplay: ''
    };

    activeControllers.set(modeId, state);

    hideLegacyPicker(config, state);

    // Insert controller as first child of panel
    panel.insertBefore(dom.controller, panel.firstChild);

    // Build picker
    buildPicker(config, state);

    // Adopt controls
    adoptControls(config, state);

    // Wire toggle
    wireViewToggle(state);

    // Apply view
    applyView(state);
  }

  function unmount(modeId) {
    const state = activeControllers.get(modeId);
    if (!state) return;

    // Close sheets
    if (state.pickerSheet) {
      state.pickerSheet.destroy();
    }

    // Restore adopted controls
    restoreControls(state);

    if (state.legacyPickerContainer) {
      state.legacyPickerContainer.style.display = state.legacyPickerOriginalDisplay ?? '';
    }

    // Remove select change listener
    if (state.sourceSelect && state.selectChangeHandler) {
      state.sourceSelect.removeEventListener('change', state.selectChangeHandler);
    }

    // Remove controller DOM
    if (state.dom.controller.parentNode) {
      state.dom.controller.remove();
    }

    // Remove panel-level view attribute
    if (state.panel) {
      delete state.panel.dataset.spcView;
    }

    activeControllers.delete(modeId);
  }

  /* ═══════════════════════════ EXPOSE ═══════════════════════════ */

  window.SpeakingPracticeController = {
    register: register,
    activate: activate,
    sync: function (modeId) { syncController(modeId); },
    getPreferredView: getPreferredView,
    setPreferredView: setPreferredView,
    unmount: unmount,
    isV2Active: isV2Active
  };

})();
