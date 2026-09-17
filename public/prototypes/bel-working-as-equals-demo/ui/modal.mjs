// Accessible In-World Reading Overlay (Phase 04 / P04.2)
// Rendered inside #world-wrap so the popup belongs to the game view instead of
// floating over the whole browser window as a top-layer <dialog>. Keeps the
// dialog semantics: focus trap, Escape handler, bounded scrolling, text
// selection, and a scrim limited to the play area. Complies with C27.

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
    dialog = document.createElement('div');
    dialog.id = 'bel-reading-modal';
    dialog.className = 'bel-overlay';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'bel-modal-title');
    dialog.hidden = true;
    container.appendChild(dialog);
  }
  // A legacy <dialog> in the markup would still open in the browser top layer.
  if (dialog.tagName === 'DIALOG') {
    const replacement = document.createElement('div');
    for (const attr of Array.from(dialog.attributes)) replacement.setAttribute(attr.name, attr.value);
    replacement.className = 'bel-overlay';
    replacement.setAttribute('role', 'dialog');
    replacement.setAttribute('aria-modal', 'true');
    replacement.hidden = true;
    dialog.replaceWith(replacement);
    dialog = replacement;
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
      dialog.open = true;

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
      activeCloseHandler = onClose;
      const slideNum = Number(slide) || 10;
      const voiceIndex = Math.max(1, Math.min(5, slideNum - 9));
      const folioStr = String(voiceIndex).padStart(2, '0') + ' of 05';
      const counterStr = String(slideNum).padStart(2, '0') + ' / 21';

      // Clean role by stripping the person's name from attribution if present
      let cleanRole = attribution || '';
      if (cleanRole.startsWith(name)) {
        cleanRole = cleanRole.slice(name.length).trim();
      }

      // Metadata for takeaway titles matching deck.html
      const TAKEAWAYS = {
        10: { title: 'ACTION OVER PERMISSION', fallbackText: 'Don’t wait to be asked. If you notice an exercise explanation isn’t clicking with learners, step forward, pull in a colleague, and refine it right away.' },
        11: { title: 'HEALTHY BOUNDARIES', fallbackText: 'Four or five hours of energized, focused teamwork beats twelve hours of exhausted, late-night grinding every time. High-quality pronunciation curriculum requires fresh, well-rested minds.' },
        12: { title: 'TEACHING TEAM TAKEAWAY — REAL-TIME COLLABORATION', fallbackText: 'Stop emailing drafts back and forth over three weeks. Jump on a shared document or short call for 90 minutes to co-create, test audio samples, and polish the lesson together.' },
        13: { title: 'EGO-FREE ITERATION', fallbackText: 'Don’t fall in love with your first draft. When students struggle with a tongue-placement diagram or audio cue, take it as friendly learning data and iterate as a team.' },
        14: { title: 'GUILT-FREE REST', fallbackText: 'Protect team evenings and weekends. Close laptops on time with zero guilt.' }
      };

      const takeawayInfo = TAKEAWAYS[slideNum] || { title: 'KEY TAKEAWAY', fallbackText: '' };
      const takeawayTitle = takeawayInfo.title;
      const takeawayBody = (paragraphs && paragraphs.length > 0) ? paragraphs.join(' ') : takeawayInfo.fallbackText;

      dialog.innerHTML = `
        <div class="bel-modal-card portrait-slide" role="document">
          <button class="bel-modal-close" data-close aria-label="Close dialog">×</button>
          <div class="portrait-slide-grid">
            <div class="portrait-slide-photo-col">
              <div class="portrait-slide-photo-frame">
                <img src="${escapeHtml(image)}" alt="${escapeHtml(name)}" class="portrait-slide-img">
                <div class="portrait-slide-badge">
                  <div class="portrait-slide-name">${escapeHtml(name)}</div>
                  ${cleanRole ? `<div class="portrait-slide-role">${escapeHtml(cleanRole)}</div>` : ''}
                </div>
              </div>
            </div>
            <div class="portrait-slide-content-col">
              <div class="portrait-slide-top-bar">
                <span class="portrait-slide-eyebrow">Voices of experience · ${escapeHtml(folioStr)}</span>
                <span class="portrait-slide-counter">${escapeHtml(counterStr)}</span>
              </div>
              <div class="portrait-slide-body" tabindex="0">
                <blockquote class="portrait-slide-quote">${escapeHtml(quote)}</blockquote>
                <div class="portrait-slide-takeaway">
                  <div class="portrait-slide-takeaway-label">${escapeHtml(takeawayTitle)}</div>
                  <p class="portrait-slide-takeaway-text">${escapeHtml(takeawayBody)}</p>
                </div>
              </div>
              <div class="portrait-slide-footer">
                <button class="primary" data-close>Close · Esc</button>
              </div>
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
      dialog.open = true;

      const closeBtn = dialog.querySelector('.bel-modal-close');
      if (closeBtn) closeBtn.focus();
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
