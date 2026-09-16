// Accessible Screen-Space HTML Reading Modal (Phase 04 / P04.2)
// Uses native HTML <dialog> with focus trap, Escape handler, bounded scrolling,
// text selection, and inert background handling. Complies with C27.

export const escapeHtml = text => String(text).replace(/[&<>"']/g, c => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[c]));

/**
 * Creates the modal controller on the given container or document body.
 */
export function createReadingModal(container, { onFocusReturn } = {}) {
  let dialog = container.querySelector('#bel-reading-modal');
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = 'bel-reading-modal';
    dialog.className = 'bel-dialog';
    dialog.setAttribute('aria-labelledby', 'bel-modal-title');
    container.appendChild(dialog);
  }

  let activeCloseHandler = null;

  function close() {
    if (!dialog.open && dialog.hidden) return;
    try {
      if (typeof dialog.close === 'function') {
        dialog.close();
      }
    } catch {
      // Ignore if already closed
    }
    dialog.open = false;
    dialog.hidden = true;
    dialog.innerHTML = '';
    if (activeCloseHandler) {
      const handler = activeCloseHandler;
      activeCloseHandler = null;
      handler();
    }
    if (typeof onFocusReturn === 'function') {
      onFocusReturn();
    }
  }

  // Handle native cancel event (Esc key)
  dialog.addEventListener('cancel', e => {
    e.preventDefault();
    close();
  });

  // Handle backdrop click
  dialog.addEventListener('click', e => {
    // If click directly on dialog backdrop (outside modal card)
    const card = dialog.querySelector('.bel-modal-card');
    if (card && !card.contains(e.target)) {
      e.stopPropagation();
      close();
    }
  });

  // Focus trap
  dialog.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key === 'Tab') {
      const focusables = dialog.querySelectorAll('button:not([disabled]), [tabindex="0"], a[href], input:not([disabled]), textarea:not([disabled])');
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });

  return {
    get open() {
      return Boolean(dialog.open && !dialog.hidden);
    },
    close,
    show({ eyebrow = '', title = '', bodyHtml = '', slideId = '', route = '', onClose = null }) {
      activeCloseHandler = onClose;
      dialog.innerHTML = `
        <div class="bel-modal-card" role="document">
          <div class="bel-modal-header">
            <div class="bel-modal-titles">
              ${eyebrow ? `<p class="bel-modal-eyebrow">${escapeHtml(eyebrow)}</p>` : ''}
              <h2 id="bel-modal-title" tabindex="-1">${escapeHtml(title)}</h2>
            </div>
            <button class="bel-modal-close" data-close aria-label="Close dialog">×</button>
          </div>
          <div class="bel-modal-body" id="bel-modal-body" tabindex="0">
            ${bodyHtml}
          </div>
          <div class="bel-modal-footer">
            <span class="bel-modal-slide-id">${slideId ? `Slide ${escapeHtml(String(slideId).padStart(2, '0'))}${route ? ' · ' + escapeHtml(route) : ''}` : ''}</span>
            <div class="actions">
              <button class="primary" data-close>Close · Esc</button>
            </div>
          </div>
        </div>
      `;

      dialog.querySelectorAll('[data-close]').forEach(b => {
        b.onclick = e => {
          e.preventDefault();
          close();
        };
      });

      dialog.hidden = false;
      try {
        if (typeof dialog.showModal === 'function') {
          dialog.showModal();
        } else {
          dialog.open = true;
        }
      } catch {
        dialog.open = true;
      }

      // Initial focus
      const closeBtn = dialog.querySelector('.bel-modal-close');
      if (closeBtn) closeBtn.focus();
    },
    showReflection({ title, heading, text, slide, route, onClose }) {
      this.show({
        eyebrow: 'BETTER ENGLISH LEARNING · READING',
        title,
        bodyHtml: `
          <h3 class="bel-section-heading">${escapeHtml(heading)}</h3>
          <div class="source-text ${heading === 'The shift' ? 'shift' : ''}">${escapeHtml(text)}</div>
        `,
        slideId: slide,
        route,
        onClose
      });
    },
    showPortrait({ name, image, attribution, quote, paragraphs, slide, onClose }) {
      this.show({
        eyebrow: 'GALLERY D · PERSPECTIVE',
        title: name,
        bodyHtml: `
          <div class="portrait-head">
            <img src="${image}" alt="${escapeHtml(name)}">
            <p class="attribution">${escapeHtml(attribution)}</p>
          </div>
          <blockquote>${escapeHtml(quote)}</blockquote>
          ${paragraphs.map(p => `<p>${escapeHtml(p)}</p>`).join('')}
        `,
        slideId: slide,
        onClose
      });
    },
    showBridgeReview({ phase, planks, onClose }) {
      this.show({
        eyebrow: 'BRIDGE ROOM · REVIEW',
        title: `Bridge Phase: ${phase}`,
        bodyHtml: `
          <div class="bel-review-grid">
            ${planks.map(p => `
              <div class="bel-review-card">
                <span class="bel-chip" style="border-color: ${p.color}">${escapeHtml(p.mark)}</span>
                <p class="source-text">${escapeHtml(p.text)}</p>
              </div>
            `).join('')}
          </div>
        `,
        slideId: 10,
        onClose
      });
    },
    showObjective({ index, title, detail, onClose }) {
      this.show({
        eyebrow: 'ROOM J · MATCHED OBJECTIVE',
        title,
        bodyHtml: `
          <div class="bel-objective-view">
            <p class="source-text">${escapeHtml(detail || 'Objective matched. Gather at the monitor for the closing presentation.')}</p>
          </div>
        `,
        slideId: 21,
        onClose
      });
    }
  };
}
