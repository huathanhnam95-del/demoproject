/**
 * dialog-a11y.js — accessible-dialog behaviour for existing modals.
 *
 * PROVENANCE
 * The focus-trap, scroll-lock and visibility helpers below are copied from
 * `createSheet()` in js/speaking-practice-controller.js (the only dialog in this
 * codebase implementing the full set: role/aria-modal, focus trap, focus restore,
 * capture-phase ESC, `inert` background, ref-counted scroll lock).
 *
 * They were COPIED rather than extracted because the speaking controller is a
 * shipped, working flow and refactoring it in place would risk a regression for no
 * benefit to this change. Intentional, temporary duplication: the two should
 * converge on this module later.
 *
 * Unlike createSheet(), this attaches to a modal that ALREADY exists in the DOM
 * and keeps that modal's own open/close mechanics intact — the vocab list modal's
 * two-phase reveal (display:flex, then .active on a timeout) is asserted by
 * tests/browser/ui-refactor-check.js and must not change.
 */

let scrollLockCount = 0;
let savedBodyOverflow = null;

function isElementVisible(el) {
    if (el.hidden || el.style.display === 'none') return false;
    if (el.offsetParent !== null) return true;
    // offsetParent is null for fixed-position elements
    const style = getComputedStyle(el);
    return style.position === 'fixed' && style.display !== 'none';
}

export function getFocusableElements(container) {
    const sel = 'a[href], button:not([disabled]), input:not([disabled]), '
        + 'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    return Array.from(container.querySelectorAll(sel)).filter(isElementVisible);
}

function trapFocus(container, event) {
    const focusable = getFocusableElements(container);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
    }
}

export function lockScroll() {
    if (scrollLockCount === 0) {
        savedBodyOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
    }
    scrollLockCount += 1;
}

export function unlockScroll() {
    scrollLockCount -= 1;
    if (scrollLockCount <= 0) {
        scrollLockCount = 0;
        if (savedBodyOverflow !== null) {
            if (savedBodyOverflow) document.body.style.overflow = savedBodyOverflow;
            else document.body.style.removeProperty('overflow');
        }
        savedBodyOverflow = null;
    }
}

/**
 * Make an existing modal element accessible.
 *
 * @param {HTMLElement} modal the overlay element
 * @param {object} [opts]
 * @param {string} [opts.labelledBy] id of the element naming the dialog
 * @param {() => void} opts.onRequestClose called for ESC (the caller owns closing)
 * @param {() => boolean} [opts.isOpen] defaults to checking the `.active` class
 * @returns {{ handleOpened: Function, handleClosed: Function, destroy: Function }}
 */
export function makeDialogAccessible(modal, opts = {}) {
    if (!modal) return null;

    const isOpen = opts.isOpen || (() => modal.classList.contains('active'));
    let lastFocused = null;
    let scrollLocked = false;

    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    if (opts.labelledBy) modal.setAttribute('aria-labelledby', opts.labelledBy);

    // Capture phase so the dialog wins over any page-level key handling, and
    // stopPropagation so ESC does not also close something behind it.
    const onKeyDown = (event) => {
        if (!isOpen()) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            opts.onRequestClose?.();
            return;
        }
        if (event.key === 'Tab') trapFocus(modal, event);
    };

    document.addEventListener('keydown', onKeyDown, true);

    return {
        /** Call once the modal has become visible. Safe to call while already open. */
        handleOpened() {
            // Only capture the return target on a genuine closed -> open
            // transition. Re-opening an already-open dialog would otherwise
            // record an element INSIDE the dialog, and focus would never get
            // back out. Also never record something already inside the modal.
            if (!scrollLocked) {
                const active = document.activeElement;
                lastFocused = active && !modal.contains(active) ? active : null;
                lockScroll();
                scrollLocked = true;
            }
            modal.removeAttribute('aria-hidden');
            requestAnimationFrame(() => {
                const focusable = getFocusableElements(modal);
                if (focusable.length) focusable[0].focus();
                else modal.focus?.();
            });
        },

        /** Call once the modal has been hidden. */
        handleClosed() {
            if (scrollLocked) {
                unlockScroll();
                scrollLocked = false;
            }
            modal.setAttribute('aria-hidden', 'true');
            // Return focus where the user left it — but only if that element is
            // still in the document. Re-rendering can detach it, and focusing a
            // detached node silently drops focus to <body>.
            if (lastFocused && typeof lastFocused.focus === 'function'
                && document.contains(lastFocused)) {
                lastFocused.focus({ preventScroll: true });
            }
            lastFocused = null;
        },

        destroy() {
            document.removeEventListener('keydown', onKeyDown, true);
            if (scrollLocked) {
                unlockScroll();
                scrollLocked = false;
            }
        }
    };
}
