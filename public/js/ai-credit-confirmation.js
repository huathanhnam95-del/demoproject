'use strict';

/**
 * AI Credit Confirmation Modal
 * Plain-language consent and balance verification dialog.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AiCreditConfirmation = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {

  function formatDate(isoStr) {
    if (!isoStr) return 'the 1st of next month';
    try {
      const d = new Date(isoStr);
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch (_) {
      return 'the 1st of next month';
    }
  }

  function getModeDisplayName(mode) {
    const names = {
      read_aloud: 'Read Aloud',
      repeat_sentence: 'Repeat Sentence',
      retell_lecture: 'Retell Lecture',
      summarize_group_discussion: 'Summarize Group Discussion',
      respond_to_situation: 'Respond to a Situation',
      write_essay: 'Write Essay',
      essay: 'Write Essay',
      summarize_written_text: 'Summarize Written Text',
      swt: 'Summarize Written Text',
      summarize_spoken_text: 'Summarize Spoken Text',
      sst: 'Summarize Spoken Text'
    };
    return names[mode] || mode;
  }

  class AiCreditConfirmationModal {
    constructor() {
      this.modalEl = null;
      this.currentResolve = null;
      this._handleKeyDown = this._handleKeyDown.bind(this);
    }

    _ensureElement() {
      if (this.modalEl && document.body.contains(this.modalEl)) return;

      const modal = document.createElement('div');
      modal.id = 'ai-credit-confirm-modal';
      modal.className = 'ai-credit-modal-backdrop';
      modal.style.display = 'none';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.setAttribute('aria-labelledby', 'ai-credit-modal-title');

      modal.innerHTML = `
        <div class="ai-credit-modal-card" tabindex="-1">
          <div class="ai-credit-modal-header">
            <h3 id="ai-credit-modal-title" class="ai-credit-modal-title">Score your answer?</h3>
            <p id="ai-credit-modal-subtitle" class="ai-credit-modal-subtitle"></p>
          </div>
          <div class="ai-credit-modal-body">
            <p id="ai-credit-modal-desc" class="ai-credit-modal-desc"></p>
            <div id="ai-credit-balance-breakdown" class="ai-credit-breakdown-box">
              <div class="ai-credit-row">
                <span>Cost</span>
                <strong id="ai-credit-cost-val"></strong>
              </div>
              <div class="ai-credit-row">
                <span>Available balance</span>
                <span id="ai-credit-avail-val"></span>
              </div>
              <div class="ai-credit-row ai-credit-after-row">
                <span>Available after confirmation</span>
                <span id="ai-credit-after-val"></span>
              </div>
            </div>
            <div id="ai-credit-error-msg" class="ai-credit-error-box" style="display: none;"></div>
          </div>
          <div class="ai-credit-modal-footer">
            <button type="button" id="ai-credit-btn-cancel" class="ai-credit-btn secondary">Cancel</button>
            <button type="button" id="ai-credit-btn-confirm" class="ai-credit-btn primary">Confirm</button>
          </div>
          <p id="ai-credit-footer-notice" class="ai-credit-notice">No credits are charged if you cancel.</p>
        </div>
      `;

      document.body.appendChild(modal);
      this.modalEl = modal;

      modal.querySelector('#ai-credit-btn-cancel').addEventListener('click', () => this.cancel());
      modal.querySelector('#ai-credit-btn-confirm').addEventListener('click', () => this.confirm());
      modal.addEventListener('click', (e) => {
        if (e.target === modal) this.cancel();
      });
    }

    _handleKeyDown(e) {
      if (e.key === 'Escape') {
        this.cancel();
      }
    }

    /**
     * Prompts the user to confirm an offered quote.
     * @param {Object} quote
     * @returns {Promise<{ confirmed: boolean, quoteId: string }>}
     */
    async requestConfirmation(quote) {
      this._ensureElement();
      const modal = this.modalEl;

      const titleEl = modal.querySelector('#ai-credit-modal-title');
      const subtitleEl = modal.querySelector('#ai-credit-modal-subtitle');
      const descEl = modal.querySelector('#ai-credit-modal-desc');
      const costEl = modal.querySelector('#ai-credit-cost-val');
      const availEl = modal.querySelector('#ai-credit-avail-val');
      const afterEl = modal.querySelector('#ai-credit-after-val');
      const breakdownBox = modal.querySelector('#ai-credit-balance-breakdown');
      const errorBox = modal.querySelector('#ai-credit-error-msg');
      const confirmBtn = modal.querySelector('#ai-credit-btn-confirm');
      const cancelBtn = modal.querySelector('#ai-credit-btn-cancel');
      const noticeEl = modal.querySelector('#ai-credit-footer-notice');

      const modeName = getModeDisplayName(quote.mode);
      const isSpeaking = quote.inputSummary?.quotedSeconds != null;
      const durationText = isSpeaking ? `${quote.inputSummary.quotedSeconds}-second recording` : 'Written assessment';
      subtitleEl.textContent = `${modeName} · ${durationText}`;

      const credits = Number(quote.credits || 0);
      const available = Number(quote.availableCredits || 0);
      const hasEnough = available >= credits;

      if (!hasEnough) {
        titleEl.textContent = 'Not enough AI Credits';
        subtitleEl.textContent = '';
        descEl.textContent = '';
        breakdownBox.style.display = 'none';
        errorBox.style.display = 'block';
        errorBox.textContent = `This assessment needs ${credits} credits. You have ${available} available. Please purchase additional credits to continue.`;
        confirmBtn.style.display = 'none';
        cancelBtn.textContent = 'Close';
        noticeEl.style.display = 'none';
      } else {
        titleEl.textContent = 'Score your answer?';
        descEl.textContent = isSpeaking
          ? 'Includes pronunciation, fluency and configured prosody feedback.'
          : 'Includes comprehensive rubric scoring and targeted feedback.';
        breakdownBox.style.display = 'block';
        errorBox.style.display = 'none';
        costEl.textContent = `${credits} AI Credits`;
        availEl.textContent = `${available} credits`;
        afterEl.textContent = `${available - credits} credits`;
        confirmBtn.style.display = 'inline-block';
        confirmBtn.textContent = `Confirm — ${credits} credits`;
        confirmBtn.disabled = false;
        cancelBtn.textContent = 'Cancel';
        noticeEl.style.display = 'block';
      }

      modal.style.display = 'flex';
      document.addEventListener('keydown', this._handleKeyDown);
      confirmBtn.focus();

      return new Promise((resolve) => {
        this.currentResolve = resolve;
      });
    }

    confirm() {
      if (!this.currentResolve) return;
      const resolve = this.currentResolve;
      this.close();
      resolve({ confirmed: true });
    }

    cancel() {
      if (!this.currentResolve) return;
      const resolve = this.currentResolve;
      this.close();
      resolve({ confirmed: false });
    }

    close() {
      if (this.modalEl) {
        this.modalEl.style.display = 'none';
      }
      document.removeEventListener('keydown', this._handleKeyDown);
      this.currentResolve = null;
    }
  }

  return {
    AiCreditConfirmationModal,
    formatDate,
    getModeDisplayName
  };
});
