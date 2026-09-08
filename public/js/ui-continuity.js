/* Shared, opt-in feedback for asynchronous work and focus lifecycle for CRM dialogs.
 * Business actions never await motion. Superseded work cannot clear current feedback. */
(function (root) {
  'use strict';
  if (root.UIContinuity) return;
  const tasks = new Map();

  /** Start one replaceable UI operation; callers must still guard their data commits. */
  function begin(key, { region = null, message = 'Loading…' } = {}) {
    tasks.get(key)?.finish();
    const previousBusy = region?.getAttribute('aria-busy');
    const previousHeight = region?.style.minHeight;
    const heldHeight = region ? `${region.getBoundingClientRect().height}px` : '';
    if (region) {
      region.setAttribute('aria-busy', 'true');
      region.style.minHeight = heldHeight;
    }
    let stack = document.getElementById('ui-feedback-stack');
    if (!stack) {
      stack = document.createElement('div');
      stack.id = 'ui-feedback-stack';
      document.body.appendChild(stack);
    }
    const feedback = document.createElement('div');
    feedback.className = 'ui-task-feedback';
    feedback.setAttribute('role', 'status');
    feedback.setAttribute('aria-live', 'polite');
    stack.appendChild(feedback);
    feedback.textContent = message;
    const task = {
      isCurrent: () => tasks.get(key) === task,
      finish() {
        if (!task.isCurrent()) return;
        tasks.delete(key);
        feedback.remove();
        if (region) {
          if (previousBusy === null) region.removeAttribute('aria-busy');
          else region.setAttribute('aria-busy', previousBusy);
          if (region.style.minHeight === heldHeight) region.style.minHeight = previousHeight;
        }
      }
    };
    tasks.set(key, task);
    return task;
  }

  function cancel(key) { tasks.get(key)?.finish(); }

  // Observe only explicit dialog surfaces, not arbitrary controls or list updates.
  // Existing controllers still own opening, closing, saving and cancellation.
  function observeDialogs() {
    const selector = '.crm-modal-overlay, .crm-books-modal-overlay';
    const states = new WeakMap();
    const openDialogs = [];
    const focusHistory = [document.activeElement];
    document.addEventListener('focusin', (event) => {
      focusHistory.push(event.target);
      if (focusHistory.length > 12) focusHistory.shift();
    }, true);
    const focusable = (dialog) => Array.from(dialog.querySelectorAll(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter((el) => !el.closest('[inert]') && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
    const topDialog = () => openDialogs[openDialogs.length - 1];

    function sync(dialog) {
      let state = states.get(dialog);
      if (!state) { state = { open: false, opener: null }; states.set(dialog, state); }
      const open = dialog.isConnected && !dialog.hidden && dialog.style.display !== 'none'
        && dialog.getAttribute('aria-hidden') !== 'true' && getComputedStyle(dialog).display !== 'none';
      if (dialog.dataset.uiOpen !== String(open)) dialog.dataset.uiOpen = String(open);
      dialog.inert = !open;
      if (open === state.open) return;
      state.open = open;
      if (open) {
        // A controller may focus an input synchronously, before this observer runs.
        state.opener = dialog.contains(document.activeElement)
          ? focusHistory.slice().reverse().find((el) => el?.isConnected && !dialog.contains(el) && !el.closest('[inert]'))
          : document.activeElement;
        openDialogs.push(dialog);
        if (!dialog.hasAttribute('role')) dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        if (!dialog.hasAttribute('tabindex')) dialog.tabIndex = -1;
        if (!dialog.contains(document.activeElement)) (focusable(dialog)[0] || dialog).focus({ preventScroll: true });
      } else {
        const wasTop = topDialog() === dialog;
        const index = openDialogs.indexOf(dialog);
        if (index !== -1) openDialogs.splice(index, 1);
        const focusNeedsRestore = document.activeElement === document.body || dialog.contains(document.activeElement);
        if (wasTop && focusNeedsRestore && state.opener?.isConnected && !state.opener.closest('[inert]')
          && (!topDialog() || topDialog().contains(state.opener))) {
          state.opener.focus({ preventScroll: true });
        }
      }
    }
    document.querySelectorAll(selector).forEach(sync);
    new MutationObserver((records) => {
      const changed = new Set();
      records.forEach((record) => {
        if (record.type === 'attributes' && record.target.matches(selector)) changed.add(record.target);
        if (record.type === 'childList') record.addedNodes.forEach((node) => {
          if (node.nodeType !== 1) return;
          if (node.matches(selector)) changed.add(node);
          node.querySelectorAll(selector).forEach((dialog) => changed.add(dialog));
        });
      });
      openDialogs.slice().filter((dialog) => !dialog.isConnected).forEach((dialog) => changed.add(dialog));
      changed.forEach(sync);
    }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'aria-hidden', 'hidden'] });
    document.addEventListener('keydown', (event) => {
      const dialog = topDialog();
      if (!dialog || event.defaultPrevented) return;
      if (event.key === 'Tab') {
        const items = focusable(dialog);
        const first = items[0] || dialog;
        const last = items[items.length - 1] || dialog;
        if (!dialog.contains(document.activeElement) || (event.shiftKey && document.activeElement === first)
          || (!event.shiftKey && document.activeElement === last) || !items.length) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus({ preventScroll: true });
        }
      }
    });
  }
  root.UIContinuity = { begin, cancel };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', observeDialogs, { once: true });
  else observeDialogs();
})(window);
