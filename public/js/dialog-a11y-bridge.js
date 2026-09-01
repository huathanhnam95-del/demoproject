/**
 * dialog-a11y-bridge.js — exposes js/dialog-a11y.js to classic (non-module) scripts.
 *
 * `makeDialogAccessible()` already solves role/aria-modal, focus trap, ESC-to-close,
 * focus restore and ref-counted scroll lock, but it is an ES module and had exactly one
 * consumer (vocab-book.js). Most of this app's modals live in classic scripts
 * (shop-module.js, script.js, the entry/level modals), which cannot `import`. Rather than
 * converting those files to modules — a much larger, riskier change — this bridge
 * publishes the same helper on `window.DialogA11y` so they can adopt it as-is.
 *
 * Load order: this is a module script, so it runs deferred. Callers should register
 * lazily (at open time, or after DOMContentLoaded) rather than at parse time.
 */
import { makeDialogAccessible, getFocusableElements, lockScroll, unlockScroll } from './dialog-a11y.js';

const registry = new WeakMap();

/**
 * Register a modal once and return its controller. Safe to call repeatedly — the same
 * controller is returned, so callers do not need to track registration themselves.
 *
 * @param {HTMLElement} modal
 * @param {object} [opts] forwarded to makeDialogAccessible
 */
function register(modal, opts = {}) {
    if (!modal) return null;
    if (registry.has(modal)) return registry.get(modal);
    const controller = makeDialogAccessible(modal, opts);
    if (controller) registry.set(modal, controller);
    return controller;
}

window.DialogA11y = {
    register,
    makeDialogAccessible,
    getFocusableElements,
    lockScroll,
    unlockScroll
};

window.dispatchEvent(new CustomEvent('dialog-a11y:ready'));
