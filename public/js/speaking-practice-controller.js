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

  function resolveNextAction(phase) {
    return phase === 'prep' ? 'noskip' : ['listen', 'recording', 'complete'].includes(phase) ? 'confirm' : 'direct';
  }
  if (typeof module === 'object' && module.exports) module.exports = { resolveNextAction };
  if (typeof window === 'undefined') return;

  /* ═══════════════════════════ CONSTANTS ═══════════════════════════ */

  const STORAGE_KEY = 'bel:speaking-controller:view:v1';
  const VALID_VIEWS = new Set(['basic', 'advanced']);
  const FALLBACK_VIEW = 'basic';
  const FOCUS_WIDTH_KEY = 'bel:speaking-controller:focus-width:v1';
  const FOCUS_WIDTH_CLASS = 'spc-focus';

  // All valid scope:mode combinations.
  // DEFAULT_ENABLED_TARGETS was merged into TARGETS since all production adapters are now integrated.
  const TARGETS = new Set([
    'pte:speak', 'pte:read-aloud', 'pte:notes', 'pte:asq',
    'pte:sgd', 'pte:describe-image', 'pte:rts', 'pte:type',
    'english:speak', 'english:read-aloud', 'english:type'
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
  let inMemoryFocusWidth = true;

  /** @type {number} scroll-lock counter */
  let scrollLockCount = 0;
  let savedBodyOverflow = null;

  function resolveTargets() {
    if (resolvedTargets) return resolvedTargets;
    resolvedTargets = new Set();

    for (const t of TARGETS) {
      if (!EXCLUDED_TARGETS.has(t)) resolvedTargets.add(t);
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

  /* ═══════════════════════════ FOCUS WIDTH ═══════════════════════════ */

  // Practice modes want a wider working surface than the 1100px reading column
  // the rest of the app uses — the Read Aloud passage and its coach rail cannot
  // both breathe inside it. Wide is the default; the preference only records a
  // deliberate opt-out.
  function readFocusWidthPreference() {
    try {
      const stored = localStorage.getItem(FOCUS_WIDTH_KEY);
      if (stored === null) return true;
      return stored !== 'off';
    } catch (_) {
      return inMemoryFocusWidth;
    }
  }

  function writeFocusWidthPreference(enabled) {
    inMemoryFocusWidth = !!enabled;
    try {
      localStorage.setItem(FOCUS_WIDTH_KEY, enabled ? 'on' : 'off');
    } catch (_) { /* quota or private mode */ }
  }

  function applyFocusWidth(enabled, button) {
    document.body.classList.toggle(FOCUS_WIDTH_CLASS, !!enabled);
    if (button) button.setAttribute('aria-pressed', enabled ? 'true' : 'false');
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

  /** Check if a DOM element is currently visible (handles position: fixed). */
  function isElementVisible(el) {
    if (el.hidden || el.style.display === 'none') return false;
    if (el.offsetParent !== null) return true;
    // offsetParent is null for fixed-position elements
    const style = getComputedStyle(el);
    return style.position === 'fixed' && style.display !== 'none';
  }

  function getFocusableElements(container) {
    const sel = 'a[href], button:not([disabled]), input:not([disabled]), ' +
      'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    return Array.from(container.querySelectorAll(sel)).filter(isElementVisible);
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
      if (savedBodyOverflow !== null) {
        if (savedBodyOverflow) {
          document.body.style.overflow = savedBodyOverflow;
        } else {
          document.body.style.removeProperty('overflow');
        }
      }
      savedBodyOverflow = null;
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
      backdrop.removeEventListener('click', close);
      closeBtn.removeEventListener('click', close);
      backdrop.remove();
      sheet.remove();
    }

    backdrop.addEventListener('click', close);
    closeBtn.addEventListener('click', close);

    return { el: sheet, backdrop, body, open, close, isOpen, destroy };
  }

  /* ═══════════════════════════ PICKER ═══════════════════════════ */

  function wireNavButton(btn, picker, buttonIdKey, callbackKey, controllerState, srcBtnKey, srcDisplayKey) {
    if (picker[buttonIdKey]) {
      const srcBtn = document.getElementById(picker[buttonIdKey]);
      if (srcBtn) {
        controllerState[srcDisplayKey] = srcBtn.style.display;
        srcBtn.style.display = 'none';
        controllerState[srcBtnKey] = srcBtn;
        btn.addEventListener('click', () => srcBtn.click());
        btn.style.display = '';
      } else if (typeof picker[callbackKey] === 'function') {
        btn.addEventListener('click', () => { try { picker[callbackKey](); } catch (e) { console.error('[SPC] picker.' + callbackKey + '() error:', e); } });
        btn.style.display = '';
      } else {
        btn.style.display = 'none';
      }
    } else if (typeof picker[callbackKey] === 'function') {
      btn.addEventListener('click', () => { try { picker[callbackKey](); } catch (e) { console.error('[SPC] picker.' + callbackKey + '() error:', e); } });
      btn.style.display = '';
    } else {
      btn.style.display = 'none';
    }
  }

  /**
   * Build picker infrastructure for an adapter config.
   * @param {Object} config - adapter config
   * @param {Object} controllerState - active controller state
   */
  function buildPicker(config, controllerState) {
    const picker = config.picker;
    if (!picker) return;

    const pillEl = controllerState.dom.pill;
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
    wireNavButton(prevBtn, picker, 'previousButtonId', 'previous', controllerState, 'srcPrevBtn', 'srcPrevOriginalDisplay');
    wireNavButton(nextBtn, picker, 'nextButtonId', 'next', controllerState, 'srcNextBtn', 'srcNextOriginalDisplay');

    // Optional Random ON/OFF toggle
    if (!controllerState.isV3 && picker.orderModes && typeof picker.orderModes.set === 'function') {
      const orderToggle = controllerState.dom.orderToggle;
      controllerState.dom.pickerNav.appendChild(orderToggle);
      orderToggle.addEventListener('click', () => {
        const nextMode = orderToggle.getAttribute('aria-pressed') === 'true' ? 'sequential' : 'random';
        try {
          picker.orderModes.set(nextMode);
        } catch (error) {
          console.error('[SPC] order mode set failed:', error);
        }
        syncOrderToggle(controllerState);
      });
      syncOrderToggle(controllerState);
    }

    if (picker.randomButtonId) {
      const srcRandom = document.getElementById(picker.randomButtonId);
      if (srcRandom) {
        // For random, wire it to the prev button spot or add a separate random btn
        controllerState.srcRandomBtn = srcRandom;
        controllerState.srcRandomOriginalDisplay = srcRandom.style.display;
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
      className: 'spc-picker-sheet',
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

    listEl.addEventListener('keydown', function (e) {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      const items = Array.from(listEl.querySelectorAll('.spc-sheet-item')).filter(el => el.style.display !== 'none');
      if (items.length === 0) return;
      const currentIdx = items.indexOf(document.activeElement);
      let nextIdx;
      switch (e.key) {
        case 'ArrowDown': nextIdx = currentIdx < items.length - 1 ? currentIdx + 1 : 0; break;
        case 'ArrowUp': nextIdx = currentIdx > 0 ? currentIdx - 1 : items.length - 1; break;
        case 'Home': nextIdx = 0; break;
        case 'End': nextIdx = items.length - 1; break;
      }
      if (nextIdx !== undefined) items[nextIdx].focus();
    });

    listEl.addEventListener('click', function (e) {
      const li = e.target.closest('.spc-sheet-item');
      if (!li || li.getAttribute('aria-disabled') === 'true') return;
      // Update visual state before closing
      listEl.querySelectorAll('.spc-sheet-item.is-current').forEach(function (el) {
        el.classList.remove('is-current');
        el.setAttribute('aria-selected', 'false');
      });
      li.classList.add('is-current');
      li.setAttribute('aria-selected', 'true');
      const id = li.dataset.id;
      selectPickerItem(config, controllerState, id);
      controllerState.pickerSheet.close();
      updatePillDisplay(config, controllerState);
    });

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
    let searchTimer = null;
    searchInput.addEventListener('input', () => {
      if (searchTimer) cancelAnimationFrame(searchTimer);
      searchTimer = requestAnimationFrame(() => {
        syncPickerSheet(config, controllerState, 1);
      });
    });

    // Listen to source select changes
    if (sourceSelect) {
      const onSelectChange = () => {
        updatePillDisplay(config, controllerState);
        if (controllerState.isV3) controllerState.history?.sync();
      };
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
    if (controllerState.isV3) controllerState.history?.sync();
  }

  function updatePillDisplay(config, controllerState) {
    const currentId = getCurrentPickerId(config, controllerState);
    const items = getPickerItems(config, controllerState);
    const current = items.find(i => String(i.id) === String(currentId));

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

  function syncPickerSheet(config, controllerState, page = null) {
    const items = getPickerItems(config, controllerState);
    const currentId = getCurrentPickerId(config, controllerState);
    const listEl = controllerState.pickerListEl;
    const emptyEl = controllerState.pickerEmptyEl;
    const searchInput = controllerState.pickerSearchInput;
    const query = (searchInput.value || '').toLowerCase().trim();

    listEl.innerHTML = '';
    const oldPag = controllerState.pickerSheet.body.querySelector('.spc-sheet-pagination');
    if (oldPag) oldPag.remove();

    const filtered = items.filter(item => {
      const searchStr = (item.id + ' ' + item.label + ' ' + (item.searchText || '')).toLowerCase();
      return !query || searchStr.includes(query);
    });

    if (filtered.length === 0) {
      emptyEl.textContent = query ? 'No questions found' : 'No questions available';
      emptyEl.style.display = '';
      return;
    }

    emptyEl.style.display = 'none';

    const pageSize = 20;
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));

    if (page === null || page === undefined) {
      const currentIdx = filtered.findIndex(i => String(i.id) === String(currentId));
      controllerState.pickerPage = currentIdx >= 0 ? Math.floor(currentIdx / pageSize) + 1 : 1;
    } else {
      controllerState.pickerPage = Math.max(1, Math.min(page, totalPages));
    }

    const currentPage = controllerState.pickerPage;
    const pagedItems = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

    pagedItems.forEach(item => {
      const li = document.createElement('li');
      const isCurrent = String(item.id) === String(currentId);
      li.className = 'spc-sheet-item' + (isCurrent ? ' is-current' : '');
      li.setAttribute('role', 'option');
      li.tabIndex = 0;
      li.setAttribute('aria-selected', isCurrent ? 'true' : 'false');
      if (item.disabled) li.setAttribute('aria-disabled', 'true');
      li.dataset.id = item.id;

      const idSpan = document.createElement('span');
      idSpan.className = 'spc-sheet-item-id';
      idSpan.textContent = '#' + item.id;

      const labelSpan = document.createElement('span');
      labelSpan.className = 'spc-sheet-item-label';
      labelSpan.textContent = item.label;

      li.appendChild(idSpan);
      li.appendChild(labelSpan);

      li.addEventListener('keydown', (event) => {
        if (item.disabled) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          li.click();
        }
      });

      listEl.appendChild(li);
    });

    if (totalPages > 1) {
      const pagDiv = document.createElement('div');
      pagDiv.className = 'spc-sheet-pagination';

      const prevBtn = document.createElement('button');
      prevBtn.type = 'button';
      prevBtn.className = 'spc-pagination-btn';
      prevBtn.disabled = currentPage <= 1;
      prevBtn.textContent = '← Prev';
      prevBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        syncPickerSheet(config, controllerState, currentPage - 1);
      });

      const info = document.createElement('span');
      info.className = 'spc-pagination-info';
      info.textContent = `Page ${currentPage} of ${totalPages} (${filtered.length} items)`;

      const nextBtn = document.createElement('button');
      nextBtn.type = 'button';
      nextBtn.className = 'spc-pagination-btn';
      nextBtn.disabled = currentPage >= totalPages;
      nextBtn.textContent = 'Next →';
      nextBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        syncPickerSheet(config, controllerState, currentPage + 1);
      });

      pagDiv.appendChild(prevBtn);
      pagDiv.appendChild(info);
      pagDiv.appendChild(nextBtn);
      controllerState.pickerSheet.body.appendChild(pagDiv);
    }
  }

  /* ═══════════════════════════ DOM CONSTRUCTION ═══════════════════════════ */

  function buildControllerDOM(config) {
    const controller = document.createElement('div');
    controller.className = 'spc-controller';
    controller.dataset.spcMode = config.modeId;
    controller.dataset.spcView = FALLBACK_VIEW;

    // Row 1: Primary (picker + steps + toggle)
    const row1 = document.createElement('div');
    row1.className = 'spc-row spc-row--primary spc-shell-grid';

    const pickerNav = document.createElement('div');
    pickerNav.className = 'spc-picker-nav';

    const prevBtn = document.createElement('button');
    prevBtn.className = 'spc-picker-prev';
    prevBtn.type = 'button';
    prevBtn.setAttribute('aria-label', 'Previous question');
    prevBtn.setAttribute('title', 'Previous question');
    prevBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>';

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
    nextBtn.setAttribute('title', 'Next question');
    nextBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>';

    pickerNav.appendChild(prevBtn);
    pickerNav.appendChild(pill);
    pickerNav.appendChild(nextBtn);

    // Optional order toggle. Built here but deliberately NOT appended: buildPicker
    // attaches it only when the adapter declares picker.orderModes, so modes
    // without it never carry hidden zero-height buttons in the controller.
    //
    // One button, two states — the same 🎲 Random: ON/OFF affordance the Reading
    // modes use, rather than a two-button segmented control.
    const orderToggle = document.createElement('button');
    orderToggle.className = 'spc-order-toggle random-toggle-btn';
    orderToggle.type = 'button';
    orderToggle.title = 'Toggle Random Question Mode';
    orderToggle.setAttribute('aria-pressed', 'false');
    orderToggle.textContent = '🎲 Random: OFF';

    // View toggle
    const toggle = document.createElement('div');
    toggle.className = 'spc-view-toggle';
    toggle.setAttribute('role', 'group');
    toggle.setAttribute('aria-label', 'View mode');

    const basicBtn = document.createElement('button');
    basicBtn.className = 'spc-view-toggle-btn';
    basicBtn.type = 'button';
    basicBtn.dataset.view = 'basic';
    basicBtn.setAttribute('data-view', 'basic');
    basicBtn.setAttribute('aria-pressed', 'true');
    basicBtn.textContent = 'Basic';

    const advancedBtn = document.createElement('button');
    advancedBtn.className = 'spc-view-toggle-btn';
    advancedBtn.type = 'button';
    advancedBtn.dataset.view = 'advanced';
    advancedBtn.setAttribute('data-view', 'advanced');
    advancedBtn.setAttribute('aria-pressed', 'false');
    advancedBtn.textContent = 'Advanced';

    const settingsBtn = document.createElement('button');
    settingsBtn.className = 'spc-view-toggle-btn spc-settings-btn';
    settingsBtn.type = 'button';
    settingsBtn.title = 'Open practice settings';
    settingsBtn.setAttribute('aria-label', 'Settings');
    settingsBtn.innerHTML = '⚙ Settings';

    // Focus width toggle. Practice screens read better on a wide working surface
    // than inside the 1100px reading column the rest of the app uses, so the wide
    // layout is the default and this button is the way back out of it.
    const focusBtn = document.createElement('button');
    focusBtn.className = 'spc-view-toggle-btn spc-focus-btn';
    focusBtn.type = 'button';
    focusBtn.title = 'Toggle wide practice layout';
    focusBtn.setAttribute('aria-label', 'Toggle wide practice layout');
    focusBtn.setAttribute('aria-pressed', 'true');
    focusBtn.textContent = '⛶';

    toggle.appendChild(basicBtn);
    toggle.appendChild(advancedBtn);
    toggle.appendChild(settingsBtn);
    toggle.appendChild(focusBtn);

    // Steps live in the primary row rather than on a dedicated rail above it.
    // As their own row they cost every speaking mode ~44px of chrome before the
    // learner reaches any content, and they introduced a third column width.
    const slotSteps = document.createElement('div');
    slotSteps.className = 'spc-slot-steps';

    row1.appendChild(pickerNav);
    row1.appendChild(slotSteps);
    row1.appendChild(toggle);

    // Row 2: Actions (media + attempt). This remains the reversible compatibility
    // rail; migrated modes can move its existing slots into authored task hosts.
    const row2 = document.createElement('div');
    row2.className = 'spc-row spc-row--actions spc-shell-grid';

    const slotMedia = document.createElement('div');
    slotMedia.className = 'spc-slot-media';
    const slotAttempt = document.createElement('div');
    slotAttempt.className = 'spc-slot-attempt';

    row2.appendChild(slotMedia);
    row2.appendChild(slotAttempt);

    const footer = document.createElement('div');
    footer.className = 'spc-footer';
    footer.dataset.spcMode = config.modeId;
    footer.appendChild(row2);

    // Row 3: Advanced
    const row3 = document.createElement('div');
    row3.className = 'spc-row spc-row--advanced spc-shell-grid';

    const activeChip = document.createElement('span');
    activeChip.className = 'spc-active-chip';
    activeChip.dataset.count = '0';
    activeChip.setAttribute('role', 'button');
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
    controller.appendChild(row3);

    return {
      controller, footer, row1, row2, row3,
      pickerNav, prevBtn, pill, pillId, pillLabel, pillArrow, nextBtn,
      orderToggle,
      toggle, basicBtn, advancedBtn, settingsBtn, focusBtn,
      slotSteps, slotMedia, slotAttempt, slotAdvAction, slotAdvSetting,
      activeChip
    };
  }

  /* ═══════════════════════════ TASK-LOCAL LAYOUT ═══════════════════════════ */

  function isValidLayoutHost(controllerState, host, slot) {
    return !!(
      host &&
      host.nodeType === 1 &&
      controllerState?.panel?.contains(host) &&
      host !== slot &&
      !host.contains(slot) &&
      !slot?.contains(host) &&
      host !== controllerState.dom.controller &&
      !controllerState.dom.controller.contains(host) &&
      !host.contains(controllerState.dom.controller)
    );
  }

  function resolveLayoutHost(controllerState, hostResolver, slot, name) {
    if (!hostResolver || !controllerState?.panel) return null;

    let host = null;
    try {
      host = typeof hostResolver === 'function'
        ? hostResolver(controllerState)
        : controllerState.panel.querySelector(hostResolver);
    } catch (error) {
      console.warn(`[SPC] layout ${name} resolver failed for ${controllerState.modeId}:`, error);
      return null;
    }

    const isCurrentParent = host === slot?.parentNode &&
      host?.nodeType === 1 &&
      controllerState.panel?.contains(host) &&
      host !== controllerState.dom.controller &&
      !controllerState.dom.controller.contains(host) &&
      !host.contains(controllerState.dom.controller) &&
      !slot?.contains(host);
    if (!isValidLayoutHost(controllerState, host, slot) && !isCurrentParent) {
      if (host) console.warn(`[SPC] Invalid layout host for ${controllerState.modeId}:${name}`);
      return null;
    }

    return host;
  }

  function rememberSlotOrigin(controllerState, slot) {
    if (!slot) return;
    controllerState.layoutPlacement ||= { origins: new Map(), current: new Map() };
    if (controllerState.layoutPlacement.origins.has(slot)) return;
    controllerState.layoutPlacement.origins.set(slot, {
      parent: slot.parentNode,
      nextSibling: slot.nextSibling
    });
  }

  function moveLayoutSlot(controllerState, slot, host, name) {
    if (!slot) return;
    rememberSlotOrigin(controllerState, slot);
    const placement = controllerState.layoutPlacement;
    const origin = placement.origins.get(slot);
    const currentHost = placement.current.get(name);

    if (host && slot.parentNode !== host) {
      host.appendChild(slot);
      placement.current.set(name, host);
      return;
    }

    if (!host && origin?.parent && slot.parentNode !== origin.parent) {
      const nextSibling = origin.nextSibling?.parentNode === origin.parent
        ? origin.nextSibling
        : null;
      origin.parent.insertBefore(slot, nextSibling);
      placement.current.delete(name);
      return;
    }

    if (host && currentHost !== host) {
      placement.current.set(name, host);
    }
  }

  function syncLayoutPlacement(controllerState) {
    const layout = controllerState?.config?.layout;
    if (!layout) return;

    const mediaSlot = controllerState.dom?.slotMedia;
    const attemptSlot = controllerState.dom?.slotAttempt;
    const mediaHost = resolveLayoutHost(controllerState, layout.mediaHost, mediaSlot, 'media');
    const attemptHost = resolveLayoutHost(controllerState, layout.attemptHost, attemptSlot, 'attempt');

    moveLayoutSlot(controllerState, mediaSlot, mediaHost, 'media');
    moveLayoutSlot(controllerState, attemptSlot, attemptHost, 'attempt');
  }

  function syncControlPlacement(controllerState) {
    syncLayoutPlacement(controllerState);
  }

  function restoreLayoutPlacement(controllerState) {
    const placement = controllerState?.layoutPlacement;
    if (!placement) return;

    for (const [slot, origin] of placement.origins || []) {
      if (!slot || !origin?.parent || slot.parentNode === origin.parent) continue;
      const nextSibling = origin.nextSibling?.parentNode === origin.parent
        ? origin.nextSibling
        : null;
      origin.parent.insertBefore(slot, nextSibling);
    }
    placement.current?.clear?.();
  }

  function scheduleLayoutSync(modeId, state) {
    const delays = [0, 250, 750, 1500];
    state.layoutSyncTimers = delays.map((delay) => setTimeout(() => {
      if (activeControllers.get(modeId) === state) syncController(modeId);
    }, delay));
  }

  function cancelLayoutSync(state) {
    (state?.layoutSyncTimers || []).forEach((timerId) => clearTimeout(timerId));
    if (state) state.layoutSyncTimers = [];
  }

  /* ═══════════════════════════ DOM ADOPTION ═══════════════════════════ */

  function observeVisibilityScope(element, scopeElement) {
    const syncVisibility = () => {
      if (isElementVisible(scopeElement)) {
        delete element.dataset.spcScopeHidden;
      } else {
        element.dataset.spcScopeHidden = '';
      }
    };

    const observer = new MutationObserver(syncVisibility);
    observer.observe(scopeElement, {
      attributes: true,
      attributeFilter: ['style', 'hidden', 'class', 'aria-hidden']
    });
    syncVisibility();
    return observer;
  }

  function adoptControls(config, controllerState) {
    const controls = config.controls || [];
    const adoptedNodes = [];
    controllerState.adoptedNodes = adoptedNodes;

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
          originalDisplay: el.style.display,
          originalActionRole: el.dataset.spcActionRole
        });

        // Set level attribute for CSS visibility
        if (ctrl.level === 'advanced') {
          el.dataset.spcLevel = 'advanced';
        }

        // Add a stable semantic hook for shared action styling without
        // changing the control's existing ID, listeners, or mode ownership.
        if (ctrl.actionRole) {
          el.dataset.spcActionRole = ctrl.actionRole;
        }

        // Move into slot
        slot.appendChild(el);

        // Visibility scope observer
        if (ctrl.visibilityScopeId) {
          const scopeEl = document.getElementById(ctrl.visibilityScopeId);
          if (scopeEl) {
            adoptedNodes[adoptedNodes.length - 1].observer = observeVisibilityScope(el, scopeEl);
          }
        }
      });

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
    const legacySelector = config?.legacyContainerSelector;
    const legacy = legacyId
      ? document.getElementById(legacyId)
      : legacySelector
        ? document.querySelector(legacySelector)
        : null;
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
      delete el.dataset.spcScopeHidden;
      if (record.originalActionRole === undefined) {
        delete el.dataset.spcActionRole;
      } else {
        el.dataset.spcActionRole = record.originalActionRole;
      }
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
      controllerState.srcRandomBtn.style.display = controllerState.srcRandomOriginalDisplay ?? '';
    }
  }

  // Settings sheets move mode-owned nodes out of their original containers.
  // Keep restoration anchors for those nodes just like adopted controls so a
  // mode switch cannot strand controls in a detached sheet.
  function restoreSettingsNodes(controllerState) {
    const moved = controllerState.settingsMovedNodes || [];
    // Restore outer containers before descendants. Settings initialization may
    // move a filter row after moving its individual controls; reversing the
    // move order keeps every descendant anchor attached to its original
    // parent during restoration.
    moved.slice().reverse().forEach(record => {
      const { element, anchor } = record;
      if (!element) return;
      if (anchor && anchor.parentNode) {
        anchor.parentNode.insertBefore(element, anchor.nextSibling);
        anchor.remove();
      }
      if (record.originalDisplay !== undefined) {
        element.style.display = record.originalDisplay;
      }
      // Undo the segmented-group decoration so the node returns to the mode
      // panel exactly as it was authored.
      if (element.dataset && element.dataset.spcFilterGroup === 'true') {
        element.querySelectorAll('[data-spc-injected="filter-label"]').forEach(node => node.remove());
        element.querySelectorAll('.filter-option').forEach(option => {
          option.removeAttribute('role');
          option.removeAttribute('tabindex');
          option.removeAttribute('aria-checked');
        });
        const menu = element.querySelector('.status-filter-menu, .length-filter-menu, .difficulty-filter-menu');
        if (menu) {
          menu.removeAttribute('role');
          menu.removeAttribute('aria-label');
        }
        delete element.dataset.spcFilterGroup;
      }
    });
    controllerState.settingsMovedNodes = [];
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

    try {
      window.dispatchEvent(new CustomEvent('spc-view-changed', {
        detail: { view, modeId: config?.modeId }
      }));
    } catch (_) { /* guard */ }
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

  function createStepPreview(config) {
    if (!Array.isArray(config.steps) || !window.SpeakingPracticeSteps?.create) return null;
    try {
      return window.SpeakingPracticeSteps.create({
        modeId: config.modeId,
        steps: config.steps,
        currentIndex: typeof config.getStepIndex === 'function' ? config.getStepIndex() : 0
      });
    } catch (error) {
      console.warn('[SPC] Step preview could not be created:', error);
      return null;
    }
  }

  function syncOrderToggle(controllerState) {
    const orderModes = controllerState.config.picker?.orderModes;
    const orderToggle = controllerState.dom?.orderToggle;
    if (!orderModes || typeof orderModes.get !== 'function' || !orderToggle) return;
    let active = 'random';
    try {
      active = orderModes.get() === 'sequential' ? 'sequential' : 'random';
    } catch (_) { /* fall back to random */ }
    const isRandom = active === 'random';
    orderToggle.dataset.order = active;
    orderToggle.classList.toggle('is-active', isRandom);
    orderToggle.setAttribute('aria-pressed', isRandom ? 'true' : 'false');
    orderToggle.textContent = isRandom ? '🎲 Random: ON' : '🎲 Random: OFF';
  }

  function syncStepPreview(controllerState) {
    if (!controllerState.steps?.setCurrent) return;
    let currentIndex = 0;
    if (typeof controllerState.config.getStepIndex === 'function') {
      try {
        currentIndex = controllerState.config.getStepIndex();
      } catch (_) { /* keep the first step as the safe preview */ }
    }
    controllerState.steps.setCurrent(currentIndex);
  }

  function wireViewToggle(controllerState) {
    const dom = controllerState.dom;

    function handleToggle(view) {
      if (controllerState.isViewDisabled) return;
      // Close any open sheet when switching to basic
      if (view === 'basic') {
        if (controllerState.pickerSheet && controllerState.pickerSheet.isOpen()) {
          controllerState.pickerSheet.close();
        }
      }
      setPreferredView(view);
    }

    function openSettings() {
      if (controllerState.isViewDisabled) return;
      handleToggle('advanced');
      window.dispatchEvent(new CustomEvent('spc-open-settings', {
        detail: { modeId: controllerState.config.modeId }
      }));
      // Note: Read Aloud takes an intentional separate code path because ReadAloudMode manages its own mode-owned settings sheet.
      if (controllerState.config.modeId === 'read-aloud' && window.ReadAloudMode) {
        try { window.ReadAloudMode.openSettingsSheet(); } catch (e) { console.error('[SPC] openSettingsSheet error:', e); }
      } else {
        openModeSettingsSheet(controllerState);
      }
    }

    dom.basicBtn.addEventListener('click', () => handleToggle('basic'));
    dom.advancedBtn.addEventListener('click', () => handleToggle('advanced'));
    if (dom.settingsBtn) {
      dom.settingsBtn.addEventListener('click', () => openSettings());
    }

    // Active chip: click opens settings
    dom.activeChip.addEventListener('click', () => openSettings());
    dom.activeChip.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openSettings();
      }
    });
  }

  function openModeSettingsSheet(controllerState) {
    if (!controllerState.settingsSheet) {
      initModeSettingsSheet(controllerState);
    }
    if (controllerState.settingsSheet) {
      controllerState.settingsSheet.open();
    }
  }

  function initModeSettingsSheet(controllerState) {
    if (controllerState.settingsSheet) return;
    const modeId = controllerState.modeId;
    const panel = controllerState.panel;

    try {
      controllerState.settingsSheet = createSheet({
        id: 'spc-settings-sheet-' + modeId,
        title: 'Settings',
        className: 'spc-mode-settings-sheet'
      });
    } catch (e) {
      console.error('[SPC] Failed to create settings sheet for mode ' + modeId + ':', e);
      return;
    }

    const body = controllerState.settingsSheet.body;

    const moveToSettings = (element, destination) => {
      if (!element || !element.parentNode || controllerState.settingsMovedNodes.some(record => record.element === element)) {
        return;
      }
      const anchor = document.createComment('spc-settings-anchor:' + (element.id || element.className || 'node'));
      element.parentNode.insertBefore(anchor, element);
      controllerState.settingsMovedNodes.push({
        element,
        anchor,
        originalDisplay: element.style.display
      });
      destination.appendChild(element);
    };

    /**
     * Present a legacy filter dropdown as an always-visible segmented pill
     * group, matching the Read Aloud settings pattern. The trigger button and
     * popup behaviour are hidden by CSS; the original option nodes, their IDs
     * and their click handlers are untouched, so every mode module keeps
     * working exactly as before.
     *
     * `multi` selects checkbox semantics (question status, where several
     * options are selected at once) over radio semantics (length/difficulty).
     */
    const decorateFilterGroup = (container, labelText, multi) => {
      if (!container || container.dataset.spcFilterGroup === 'true') return;
      container.dataset.spcFilterGroup = 'true';

      // Label lives inside the container so it inherits the container's
      // display state — these filters stay hidden until unlocked.
      const label = document.createElement('span');
      label.className = 'spc-filter-group-label';
      label.dataset.spcInjected = 'filter-label';
      label.textContent = labelText;
      container.insertBefore(label, container.firstChild);

      const menu = container.querySelector('.status-filter-menu, .length-filter-menu, .difficulty-filter-menu');
      if (!menu) return;
      menu.setAttribute('role', multi ? 'group' : 'radiogroup');
      menu.setAttribute('aria-label', labelText);

      const options = [...menu.querySelectorAll('.filter-option')];
      const syncChecked = () => {
        options.forEach((option) => {
          option.setAttribute('aria-checked', String(option.classList.contains('selected')));
        });
      };

      options.forEach((option) => {
        option.setAttribute('role', multi ? 'checkbox' : 'radio');
        option.setAttribute('tabindex', '0');
        option.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
            event.preventDefault();
            option.click();
          }
        });
        // The owning module toggles `.selected`; mirror it onto aria-checked
        // once its handler has run. This must be bound per option rather than
        // on the menu — those handlers call stopPropagation(), so a
        // menu-level listener never sees the click.
        option.addEventListener('click', () => { setTimeout(syncChecked, 0); });
      });

      syncChecked();
    };

    // Build tabbed navigation
    const tabs = document.createElement('div');
    tabs.className = 'spc-sheet-tabs';
    tabs.setAttribute('role', 'tablist');
    tabs.innerHTML = `
      <button class="spc-sheet-tab active" role="tab" aria-selected="true" data-tab="difficulty-target" type="button">🎯 Target & Difficulty</button>
      <button class="spc-sheet-tab" role="tab" aria-selected="false" data-tab="history" type="button">📋 History</button>
    `;
    body.appendChild(tabs);

    const panelsContainer = document.createElement('div');
    panelsContainer.className = 'spc-settings-panels';

    // Panel 1: Target & Difficulty
    const targetPanel = document.createElement('div');
    targetPanel.className = 'spc-sheet-tab-panel active';
    targetPanel.dataset.tab = 'difficulty-target';
    targetPanel.setAttribute('role', 'tabpanel');

    // Section 1: Difficulty Engine (Adaptive / Manual)
    const diffSection = document.createElement('div');
    diffSection.className = 'spc-settings-section';
    diffSection.innerHTML = '<h4 class="spc-settings-section-title">🤖 Difficulty Engine</h4>';

    const adaptiveContainer = panel ? (
      panel.querySelector('#adaptive-toggle-container-' + modeId) ||
      panel.querySelector('.adaptive-toggle-container')
    ) : null;

    if (adaptiveContainer) {
      moveToSettings(adaptiveContainer, diffSection);
      adaptiveContainer.style.display = 'flex';
    }

    const questionTotal = panel ? (
      panel.querySelector('.question-total') ||
      panel.querySelector('.question-count-info')
    ) : null;

    if (questionTotal && adaptiveContainer) {
      moveToSettings(questionTotal, diffSection);
      questionTotal.style.display = 'block';
    }

    if (adaptiveContainer) {
      targetPanel.appendChild(diffSection);
    }

    // Section 2: Question Filters
    const filterSection = document.createElement('div');
    filterSection.className = 'spc-settings-section';
    let filterControlCount = 0;
    filterSection.innerHTML = '<h4 class="spc-settings-section-title">🎯 Question Filters</h4>';

    const statusFilter = panel ? (
      panel.querySelector('#status-filter-container-' + modeId) ||
      panel.querySelector('.status-filter-dropdown')
    ) : null;
    if (statusFilter) {
      moveToSettings(statusFilter, filterSection);
      decorateFilterGroup(statusFilter, '🗂️ Question Status:', true);
      filterControlCount++;
    }

    const lengthFilter = panel ? (
      panel.querySelector('#length-filter-container-' + modeId) ||
      panel.querySelector('.length-filter-dropdown')
    ) : null;
    if (lengthFilter) {
      moveToSettings(lengthFilter, filterSection);
      decorateFilterGroup(lengthFilter, '📏 Sentence Length:', false);
      filterControlCount++;
    }

    const diffFilter = panel ? (
      panel.querySelector('#difficulty-filter-container-' + modeId) ||
      panel.querySelector('.difficulty-filter-dropdown') ||
      panel.querySelector('.difficulty-filter-container')
    ) : null;
    if (diffFilter) {
      moveToSettings(diffFilter, filterSection);
      decorateFilterGroup(diffFilter, '📊 Difficulty Level:', false);
      filterControlCount++;
    }

    const filtersRow = panel ? panel.querySelector('.question-filters-row') : null;
    if (filtersRow && filtersRow.children.length > 0) {
      moveToSettings(filtersRow, filterSection);
      filterControlCount++;
    }

    const recControls = panel ? (
      panel.querySelector('#recommendation-controls-' + modeId) ||
      panel.querySelector('.recommendation-controls')
    ) : null;
    if (recControls) {
      moveToSettings(recControls, filterSection);
      filterControlCount++;
    }

    if (filterControlCount > 0) {
      targetPanel.appendChild(filterSection);
    }
    panelsContainer.appendChild(targetPanel);

    // Panel 2: History
    const historyPanel = document.createElement('div');
    historyPanel.className = 'spc-sheet-tab-panel';
    historyPanel.dataset.tab = 'history';
    historyPanel.setAttribute('role', 'tabpanel');

    const historyActionHost = panel ? panel.querySelector('#' + modeId + '-history-action-host') : null;
    const historyContentHost = panel ? panel.querySelector('#' + modeId + '-history-content-host') : null;
    const historyContainer = panel ? (
      panel.querySelector('.attempts-history-container') ||
      panel.querySelector('.history-section')
    ) : null;

    if (historyActionHost) moveToSettings(historyActionHost, historyPanel);
    if (historyContentHost) moveToSettings(historyContentHost, historyPanel);
    if (historyContainer && !historyContentHost) moveToSettings(historyContainer, historyPanel);

    const hasHistory = Boolean(historyActionHost || historyContentHost || historyContainer);
    if (hasHistory) {
      panelsContainer.appendChild(historyPanel);
    } else {
      tabs.querySelector('[data-tab="history"]')?.remove();
    }
    body.appendChild(panelsContainer);

    // Tab switching listener
    tabs.addEventListener('click', (e) => {
      const tab = e.target.closest('.spc-sheet-tab');
      if (!tab) return;
      const tabId = tab.dataset.tab;

      tabs.querySelectorAll('.spc-sheet-tab').forEach(t => {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
      });
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');

      panelsContainer.querySelectorAll('.spc-sheet-tab-panel').forEach(p => {
        p.classList.toggle('active', p.dataset.tab === tabId);
      });
    });
  }

  /* ═══════════════════════════ SYNC ═══════════════════════════ */

  function syncController(modeId) {
    const state = activeControllers.get(modeId);
    if (!state) return;

    updatePillDisplay(state.config, state);
    if (state.isV3) {
      setPhase(modeId, state.config.v3.getPhase?.() || state.phase);
      state.history?.sync();
      state.config.v3.onSync?.();
      return;
    }
    updateActiveChip(state);
    syncStepPreview(state);
    syncOrderToggle(state);
    syncControlPlacement(state);
  }

  /* ═══════════════════════════ PUBLIC API ═══════════════════════════ */

  function isV3(config, scope) {
    return config.shell === 'v3' && window.PteShellConfig?.isModeEnabled(config.modeId, scope);
  }

  function v3Element(tag, className, label) {
    const el = document.createElement(tag); el.className = className;
    if (label !== undefined) el.textContent = label;
    if (tag === 'button') el.type = 'button';
    return el;
  }

  // Preserve actual child nodes (including listeners), attributes and insertion points.
  function rememberV3(state, node, moveTo) {
    const record = { node, attributes: [...node.attributes].map(a => [a.name, a.value]) };
    if (moveTo) {
      record.anchor = document.createComment('pte-v3-origin');
      node.before(record.anchor); moveTo.append(node);
    }
    state.v3Records.push(record); return record;
  }

  function buildV3Shell(config, state) {
    const body = state.panel.querySelector(config.v3.cardBodySelector) || document.querySelector(config.v3.cardBodySelector);
    if (!body || !state.panel.contains(body)) throw new Error('PTE v3 card body must be inside its mode panel');
    state.v3Records = []; state.phase = 'loading';
    const bar = state.dom.controller;
    bar.className = 'pte-modebar';
    const back = v3Element('button', 'pte-btn pte-btn--icon', '‹');
    back.setAttribute('aria-label', 'Back to dashboard');
    back.addEventListener('click', () => document.getElementById('back-to-dashboard-btn')?.click());
    const title = v3Element('div', 'pte-modebar__title', config.v3.title);
    title.append(v3Element('small', '', config.v3.skillLabel || 'Speaking'));
    const filters = v3Element('button', 'pte-btn', 'Filters');
    filters.hidden = !(config.v3.filters?.length);
    const more = v3Element('button', 'pte-btn pte-btn--icon', '⋯');
    more.setAttribute('aria-label', 'More');
    [filters, more].forEach(button => { button.setAttribute('aria-expanded', 'false'); button.setAttribute('aria-haspopup', 'dialog'); });
    bar.replaceChildren(back, title, state.dom.pickerNav, filters, more);
    state.panel.prepend(bar);
    state.menuButtons = { filters, more };
    filters.addEventListener('click', () => openV3Menu('filters', state));
    more.addEventListener('click', () => openV3Menu('more', state));
    const badge = document.getElementById('difficulty-badge');
    if (badge) rememberV3(state, badge, bar);
    const card = v3Element('div', 'pte-card'); body.before(card);
    const progress = v3Element('div', 'pte-progress');
    (config.v3.progressSteps || ['Prepare', 'Record', 'Feedback']).forEach(label => progress.append(v3Element('span', '', label)));
    card.append(progress); rememberV3(state, body, card); body.classList.add('pte-card__body');
    const dock = v3Element('div', 'pte-dock');
    const status = v3Element('div', 'pte-dock__status', ''); status.setAttribute('aria-live', 'polite');
    const actions = v3Element('div', 'pte-dock__actions'); dock.append(status, actions); card.append(dock);
    const attempts = v3Element('section', 'pte-attempts'); card.after(attempts);
    state.v3DOM = { bar, card, progress, dock, status, actions, attempts };
    // Only shell-owned chrome is hidden here; mode-specific duplication belongs to its phase.
    document.querySelectorAll('.main-header').forEach(node => { rememberV3(state, node); node.hidden = true; node.style.display = 'none'; });
    document.body.classList.add('pte-shell-v3');
  }

  function adoptV3Dock(config, state) {
    const dock = config.v3.dock || {};
    (dock.helpers || []).forEach(helper => {
      const button = v3Element('button', 'pte-btn pte-btn--helper', helper.label);
      button.id = helper.id; button.dataset.ptePhases = (helper.phases || []).join(' ');
      button.addEventListener('click', () => helper.onClick?.());
      button._pteHelper = helper; state.v3DOM.actions.append(button);
    });
    (dock.actions || []).forEach(action => {
      const button = document.getElementById(action.sourceId);
      if (!button) return;
      const record = rememberV3(state, button, state.v3DOM.actions);
      if (action.label) {
        record.children = [...button.childNodes]; button.textContent = action.label;
      }
      button.classList.add('pte-btn', `pte-btn--${action.variant || 'secondary'}`);
      button.dataset.ptePhases = (action.phases || []).join(' ');
    });
    const next = v3Element('button', 'pte-btn pte-btn--ghost', 'Next →'); next.id = `pte-next-${state.modeId}`;
    next.addEventListener('click', () => handleV3Next(state));
    state.v3DOM.actions.append(next); state.v3DOM.next = next;
  }

  function setPhase(modeId, phase) {
    const state = activeControllers.get(modeId);
    if (!state?.isV3) return;
    const valid = ['loading', 'listen', 'prep', 'recording', 'complete', 'feedback'];
    if (!valid.includes(phase)) return;
    if (state.phase !== phase) state.nextError = '';
    state.phase = phase;
    const { card, progress, actions, status, next } = state.v3DOM;
    card.dataset.ptePhase = phase; card.classList.toggle('pte-card--wide', phase === 'feedback');
    const index = (state.config.v3.phaseToStep || { loading: 0, listen: 0, prep: 0, recording: 1, complete: 1, feedback: 2 })[phase] ?? 0;
    [...progress.children].forEach((step, i) => {
      step.classList.toggle('is-now', i === index); step.classList.toggle('is-done', i < index);
      if (i === index) step.setAttribute('aria-current', 'step'); else step.removeAttribute('aria-current');
    });
    actions.querySelectorAll('[data-pte-phases]').forEach(button => {
      button.hidden = !button.dataset.ptePhases.split(' ').includes(phase) || (phase === 'recording' && !!button._pteHelper);
      const helper = button._pteHelper;
      if (helper) {
        const count = helper.count?.();
        button.textContent = `${helper.label}${count == null ? '' : ` · ${count}`}`;
        if (helper.pressed) button.setAttribute('aria-pressed', String(!!helper.pressed()));
      }
    });
    const defaults = { listen: 'Listen carefully. The recorder appears when the audio ends.', prep: 'Recording starts automatically when the countdown ends.', complete: 'Recording saved. Listen back or get feedback.', feedback: 'Saved to Previous attempts below.' };
    status.textContent = state.nextError || state.saveError || (state.config.v3.statusText?.[phase] ?? defaults[phase] ?? '');
    next.textContent = phase === 'feedback' ? 'Next question →' : 'Next →';
    next.classList.toggle('pte-btn--primary', phase === 'feedback'); next.classList.toggle('pte-btn--ghost', phase !== 'feedback');
    next.disabled = phase === 'loading' || !!state.nextPending;
  }

  function openV3Dialog(kind, state) {
    state.closeDialog?.(false);
    const opener = state.nextPending ? state.v3DOM.next : document.activeElement;
    const overlay = v3Element('div', 'pte-dialog-overlay');
    const panel = v3Element('div', 'pte-dialog'); panel.setAttribute('role', 'alertdialog'); panel.setAttribute('aria-modal', 'true');
    const title = v3Element('h2', '', kind === 'noskip' ? 'Cannot skip' : 'Go to the next question?');
    title.id = `pte-dialog-title-${state.modeId}`; panel.setAttribute('aria-labelledby', title.id);
    const bodies = {
      listen: "You haven't answered this question yet. It will be marked as skipped.",
      recording: 'Your recording will stop and this attempt will be saved without feedback.',
      complete: 'This attempt is saved. You can get feedback on it later from Previous attempts at the bottom of the page.'
    };
    const body = v3Element('p', '', kind === 'noskip' ? "The recording is about to begin. As in the test, you can't move to the next question during the countdown." : bodies[state.phase] || bodies.complete);
    body.id = `pte-dialog-body-${state.modeId}`; panel.setAttribute('aria-describedby', body.id);
    const actions = v3Element('div', 'pte-dialog__actions');
    const yes = v3Element('button', 'pte-btn pte-btn--primary', kind === 'noskip' ? 'OK' : 'Next question');
    panel.append(title, body, actions); overlay.append(panel); document.body.append(overlay); lockScroll();
    return new Promise(resolve => {
      let closed = false;
      const close = result => {
        if (closed) return; closed = true; overlay.remove(); unlockScroll();
        state.closeDialog = null;
        resolve(result);
        queueMicrotask(() => { if (opener?.isConnected && !state.closeDialog) opener.focus(); });
      };
      state.closeDialog = close;
      if (kind !== 'noskip') {
        const stay = v3Element('button', 'pte-btn', 'Stay here'); stay.addEventListener('click', () => close(false)); actions.append(stay);
      }
      actions.append(yes); yes.addEventListener('click', () => close(kind !== 'noskip'));
      overlay.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); close(false); } else if (e.key === 'Tab') trapFocus(panel, e); });
      actions.firstElementChild.focus();
    });
  }

  async function handleV3Next(state) {
    if (state.nextPending || state.phase === 'loading') return;
    state.nextPending = true; setPhase(state.modeId, state.phase);
    try {
      const action = resolveNextAction(state.phase);
      if (action === 'noskip') { await openV3Dialog('noskip', state); return; }
      if (action === 'confirm' && !await openV3Dialog('confirm', state)) return;
      if (activeControllers.get(state.modeId) !== state || state.phase === 'loading') return;
      // Timers keep running inside dialogs; evaluate the phase again before leaving.
      if (state.phase === 'prep') { await openV3Dialog('noskip', state); return; }
      if (state.phase === 'recording') {
        if (typeof state.config.v3.next?.onConfirmFromRecording !== 'function') throw new Error('Recording must be saved before moving on.');
        // An explicit cancellation ends this Next action; legacy callbacks may return undefined.
        if (await state.config.v3.next.onConfirmFromRecording() === false) return;
      }
      if (activeControllers.get(state.modeId) === state) {
        const result = await state.config.v3.next?.goNext?.();
        if (result !== false) state.nextError = '';
      }
    } catch (error) {
      state.nextError = error.message || 'Could not move to the next question.';
    } finally {
      state.nextPending = false;
      if (activeControllers.get(state.modeId) === state) setPhase(state.modeId, state.phase);
    }
  }

  function openV3Menu(kind, state) {
    if (kind === 'picker') { syncPickerSheet(state.config, state); state.pickerSheet?.open(); return; }
    const wasOpen = state.openMenuKind === kind; state.closeMenu?.(); if (wasOpen) return;
    const trigger = state.menuButtons[kind];
    const menu = v3Element('div', 'pte-popover'); menu.setAttribute('role', 'dialog'); menu.setAttribute('aria-label', kind === 'filters' ? 'Filters' : 'More');
    const close = () => {
      menu.remove(); trigger.setAttribute('aria-expanded', 'false');
      document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', keydown, true);
      state.closeMenu = null; state.openMenuKind = null;
    };
    const outside = event => { if (!menu.contains(event.target) && !trigger.contains(event.target)) close(); };
    const keydown = event => { if (event.key === 'Escape') { event.preventDefault(); close(); trigger.focus(); } };
    if (kind === 'filters') {
      (state.config.v3.filters || []).forEach(group => {
        const field = v3Element('fieldset', 'pte-filter'); field.append(v3Element('legend', '', group.label));
        (group.options || []).forEach(option => {
          const value = typeof option === 'object' ? option.value : option;
          const button = v3Element('button', 'pte-btn', option.label || String(option));
          button.setAttribute('aria-pressed', String(group.get?.() === value));
          button.addEventListener('click', () => {
            group.set(value);
            [...field.querySelectorAll('button')].forEach(item => item.setAttribute('aria-pressed', String(item === button)));
            syncController(state.modeId);
          }); field.append(button);
        }); menu.append(field);
      });
    } else {
      const items = [{ label: 'Focus mode', description: 'Hide the page header while you practise', onSelect: () => {
        document.body.classList.toggle('pte-focus');
      } }, { label: `How ${state.config.v3.title} works`, description: 'Timing, scoring and tips', onSelect: () => document.getElementById('mode-tutorial-btn')?.click() }, ...(state.config.v3.moreItems || [])];
      items.forEach(item => {
        const button = v3Element('button', 'pte-menu-item', item.label);
        if (item.description) button.append(v3Element('small', '', item.description));
        button.addEventListener('click', () => { close(); trigger.focus(); item.onSelect?.(); }); menu.append(button);
      });
    }
    state.v3DOM.bar.append(menu); state.closeMenu = close; state.openMenuKind = kind;
    trigger.setAttribute('aria-expanded', 'true'); document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', keydown, true);
    menu.querySelector('button')?.focus();
  }

  function unmountV3(state) {
    state.closeDialog?.(false); state.closeMenu?.(); state.history?.destroy();
    [...state.v3Records].reverse().forEach(record => {
      if (record.children) record.node.replaceChildren(...record.children);
      [...record.node.attributes].forEach(attribute => record.node.removeAttribute(attribute.name));
      record.attributes.forEach(([name, value]) => record.node.setAttribute(name, value));
      if (record.anchor?.parentNode) record.anchor.replaceWith(record.node);
    });
    state.config.v3.onUnmount?.();
    state.v3DOM.card.remove(); state.v3DOM.attempts.remove();
    if (![...activeControllers.values()].some(other => other !== state && other.isV3)) document.body.classList.remove('pte-shell-v3', 'pte-focus');
  }

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
      if (activeState.isV3 !== !!isV3(config, scope)) {
        unmount(modeId); return activate(modeId, opts);
      }
      activeState.scope = scope;
      if (!activeState.isV3) applyView(activeState);
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
    const steps = createStepPreview(config);

    // Modes without advanced/settings data do not expose an empty Settings
    // entry point. Their picker remains available, while the Basic/Advanced
    // group is omitted until the adapter supplies real controls.
    const hasAdvanced = hasAdvancedCapability(config);
    if (!hasAdvanced) {
      dom.controller.dataset.spcNoToggle = '';
      dom.toggle.remove();
    }

    // Create state
    const state = {
      modeId: modeId,
      scope: scope,
      config: config,
      dom: dom,
      steps: steps,
      panel: panel,
      adoptedNodes: [],
      inPlaceNodes: [],
      settingsMovedNodes: [],
      sourceSelect: null,
      srcPrevBtn: null,
      srcNextBtn: null,
      srcRandomBtn: null,
      srcRandomOriginalDisplay: '',
      pickerSheet: null,
      pickerListEl: null,
      pickerEmptyEl: null,
      pickerSearchInput: null,
      selectChangeHandler: null,
      legacyPickerContainer: null,
      legacyPickerOriginalDisplay: '',
      layoutPlacement: { origins: new Map(), current: new Map() },
      layoutSyncTimers: []
    };

    state.isV3 = !!isV3(config, scope);

    activeControllers.set(modeId, state);

    if (state.isV3) {
      buildV3Shell(config, state);
      hideLegacyPicker(config, state);
      buildPicker(config, state);
      config.v3.onMount?.();
      adoptV3Dock(config, state);
      if (config.v3.attempts) state.history = window.PteAttemptHistory?.mount(state.v3DOM.attempts, config.v3.attempts);
      setPhase(modeId, config.v3.getPhase?.() || 'loading');
      config.v3.onSync?.();
      return;
    }

    hideLegacyPicker(config, state);

    // Header at the top, steps inside the header's primary row, and a reversible
    // action rail retained for adapters without a valid task-local host. The step
    // indicator still precedes the primary action in reading order — the reader
    // meets the phase before the button for it — without costing a row of its own.
    panel.insertBefore(dom.controller, panel.firstChild);
    if (steps?.element) {
      dom.slotSteps.appendChild(steps.element);
    }
    panel.appendChild(dom.footer);

    // Publish the action bar's rendered height so fixed page furniture (the chat
    // trigger) can sit clear of it instead of on top of the primary action.
    // The bar's height changes with the mode and with wrapping, so measure it.
    const publishFooterHeight = () => {
      const height = Math.round(dom.footer.getBoundingClientRect().height);
      document.documentElement.style.setProperty('--spc-footer-height', `${height}px`);
    };
    publishFooterHeight();
    if (typeof ResizeObserver === 'function') {
      state.footerResizeObserver = new ResizeObserver(publishFooterHeight);
      state.footerResizeObserver.observe(dom.footer);
    }

    applyFocusWidth(readFocusWidthPreference(), dom.focusBtn);
    dom.focusBtn.addEventListener('click', () => {
      const next = document.body.classList.contains(FOCUS_WIDTH_CLASS) ? false : true;
      writeFocusWidthPreference(next);
      applyFocusWidth(next, dom.focusBtn);
    });

    // Build picker
    buildPicker(config, state);

    // Adopt controls
    adoptControls(config, state);

    // Move controller slots into the authored task flow only after adoption has
    // recorded every source anchor. This keeps re-entry idempotent and allows
    // unmount to restore both slots and controls safely.
    syncLayoutPlacement(state);
    // Mode-owned state machines may finish their first phase transition just
    // after activation. Recheck on a bounded schedule; the active identity
    // guard keeps a late callback from touching an unmounted panel.
    scheduleLayoutSync(modeId, state);
    publishFooterHeight();

    // Wire toggle
    wireViewToggle(state);

    // Apply view
    applyView(state);

    // Initialize mode settings sheet (moves difficulty manager & filters into side panel).
    // Note: Read Aloud takes an intentional separate code path because ReadAloudMode manages its own
    // settings sheet setup and unmount cleanup. Other practice modes use the generic controller sheet.
    if (modeId === 'read-aloud' && window.ReadAloudMode) {
      try { window.ReadAloudMode.initSettingsSheet(); } catch (_) {}
    } else if (hasAdvanced) {
      try { initModeSettingsSheet(state); } catch (_) {}
    }
  }

  function unmount(modeId) {
    const state = activeControllers.get(modeId);
    if (!state) return;

    if (state.isV3) unmountV3(state);

    // Close sheets
    if (state.pickerSheet) {
      state.pickerSheet.destroy();
    }

    // Restore mode-owned nodes before removing the settings sheet that hosts
    // them, then destroy the sheet to prevent duplicate IDs on remount.
    restoreSettingsNodes(state);
    if (state.settingsSheet) {
      state.settingsSheet.destroy();
      state.settingsSheet = null;
    }

    // Restore adopted controls
    cancelLayoutSync(state);
    restoreLayoutPlacement(state);
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
    if (state.footerResizeObserver) {
      state.footerResizeObserver.disconnect();
      state.footerResizeObserver = null;
    }
    if (state.dom.footer?.parentNode) {
      state.dom.footer.remove();
    }
    document.documentElement.style.removeProperty('--spc-footer-height');
    if (state.steps?.element?.parentNode) {
      state.steps.element.remove();
    }

    // Remove panel-level view attribute
    if (state.panel) {
      delete state.panel.dataset.spcView;
    }

    activeControllers.delete(modeId);

    // The wide practice layout belongs to the practice screens, not to the
    // dashboard the learner returns to.
    if (!activeControllers.size) {
      document.body.classList.remove(FOCUS_WIDTH_CLASS);
    }
  }

  function setViewToggleDisabled(disabled) {
    const isDisable = !!disabled;
    for (const [, state] of activeControllers) {
      state.isViewDisabled = isDisable;
      if (!state?.dom) continue;
      const dom = state.dom;
      if (dom.basicBtn) {
        dom.basicBtn.disabled = isDisable;
        dom.basicBtn.style.pointerEvents = isDisable ? 'none' : '';
        dom.basicBtn.style.opacity = isDisable ? '0.5' : '';
      }
      if (dom.advancedBtn) {
        dom.advancedBtn.disabled = isDisable;
        dom.advancedBtn.style.pointerEvents = isDisable ? 'none' : '';
        dom.advancedBtn.style.opacity = isDisable ? '0.5' : '';
      }
      if (dom.settingsBtn) {
        dom.settingsBtn.disabled = isDisable;
        dom.settingsBtn.style.pointerEvents = isDisable ? 'none' : '';
        dom.settingsBtn.style.opacity = isDisable ? '0.5' : '';
      }
      if (dom.activeChip) {
        dom.activeChip.style.pointerEvents = isDisable ? 'none' : '';
        dom.activeChip.style.opacity = isDisable ? '0.5' : '';
      }
    }

    // The focus-width button only changes layout, never practice state, so it
    // stays live while a recording is in flight.
    const toggleBtns = document.querySelectorAll('.spc-view-toggle-btn:not(.spc-focus-btn), .spc-settings-btn, #spc-view-basic, #spc-view-advanced');
    toggleBtns.forEach(btn => {
      btn.disabled = isDisable;
      btn.style.pointerEvents = isDisable ? 'none' : '';
      btn.style.opacity = isDisable ? '0.5' : '';
    });
  }

  /* ═══════════════════════════ EXPOSE ═══════════════════════════ */

  window.SpeakingPracticeController = {
    register: register,
    activate: activate,
    sync: function (modeId) { syncController(modeId); },
    getPreferredView: getPreferredView,
    setPreferredView: setPreferredView,
    setViewToggleDisabled: setViewToggleDisabled,
    unmount: unmount,
    isV2Active: isV2Active,
    createSheet: createSheet,
    setPhase: setPhase,
    setNextError: (modeId, message) => {
      const state = activeControllers.get(modeId);
      if (!state?.isV3) return;
      state.nextError = String(message || '');
      setPhase(modeId, state.phase);
    },
    setSaveError: (modeId, message) => {
      const state = activeControllers.get(modeId);
      if (!state?.isV3) return;
      // A phase change is not proof of saving; the mode clears this on recovery or invalidation.
      state.saveError = String(message || '');
      setPhase(modeId, state.phase);
    },
    getPhase: modeId => activeControllers.get(modeId)?.phase || null,
    openDialog: (modeId, kind) => {
      const state = activeControllers.get(modeId);
      return state?.isV3 ? openV3Dialog(kind, state) : Promise.resolve(false);
    }
  };

})();
