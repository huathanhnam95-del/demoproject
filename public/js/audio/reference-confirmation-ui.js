/**
 * Reference Confirmation UI Component
 * Plan V3 §11.3 & User Mandate:
 * Targeted inline clarification widget for known material pronunciation minimal pairs.
 * Allows playing original audio context and confirms student intent before billing/scoring.
 */

export class ReferenceConfirmationUi {
  constructor({
    container,
    ambiguities = [],
    audioBuffer = null,
    audioElement = null,
    onConfirm = null,
    onCancel = null
  } = {}) {
    this.container = container;
    this.ambiguities = ambiguities;
    this.audioBuffer = audioBuffer;
    this.audioElement = audioElement;
    this.onConfirm = onConfirm;
    this.onCancel = onCancel;
    this.selections = {}; // tokenIndex -> chosen word
  }

  render() {
    if (!this.container) return;
    this.container.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.className = 'reference-confirmation-box';
    wrapper.setAttribute('role', 'dialog');
    wrapper.setAttribute('aria-label', 'Confirm pronunciation target words');

    const title = document.createElement('h4');
    title.className = 'ref-confirm-title';
    title.textContent = 'Please confirm what you said';
    wrapper.appendChild(title);

    const desc = document.createElement('p');
    desc.className = 'ref-confirm-desc';
    desc.textContent = 'We heard a word that sounds similar to another English word. Listen to your clip and choose the word you intended:';
    wrapper.appendChild(desc);

    const list = document.createElement('div');
    list.className = 'ref-confirm-list';

    this.ambiguities.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'ref-confirm-item';
      row.setAttribute('data-token-index', String(item.tokenIndex));

      // Play context audio button
      const playBtn = document.createElement('button');
      playBtn.type = 'button';
      playBtn.className = 'ref-play-snippet-btn';
      playBtn.setAttribute('aria-label', `Play clip for word around ${item.startMs} milliseconds`);
      playBtn.innerHTML = '▶ Listen';
      playBtn.onclick = () => this.playContextClip(item.contextSpan || { startMs: item.startMs, endMs: item.endMs });
      row.appendChild(playBtn);

      // Candidate options
      const optGroup = document.createElement('div');
      optGroup.className = 'ref-candidate-group';

      item.candidates.forEach((cand) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ref-candidate-btn';
        btn.textContent = cand;
        btn.onclick = () => {
          this.selections[item.tokenIndex] = cand;
          optGroup.querySelectorAll('.ref-candidate-btn').forEach(b => b.classList.remove('selected'));
          btn.classList.add('selected');
          this.updateConfirmState(confirmBtn);
        };
        optGroup.appendChild(btn);
      });
      row.appendChild(optGroup);
      list.appendChild(row);
    });
    wrapper.appendChild(list);

    // Actions
    const actionRow = document.createElement('div');
    actionRow.className = 'ref-confirm-actions';

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'btn-primary ref-confirm-submit';
    confirmBtn.textContent = 'Confirm and Continue Scoring';
    confirmBtn.disabled = Object.keys(this.selections).length < this.ambiguities.length;
    confirmBtn.onclick = () => {
      if (typeof this.onConfirm === 'function') {
        this.onConfirm(this.selections);
      }
    };

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn-secondary ref-confirm-cancel';
    cancelBtn.textContent = "I didn't say these / Cancel";
    cancelBtn.onclick = () => {
      if (typeof this.onCancel === 'function') {
        this.onCancel();
      }
    };

    actionRow.appendChild(cancelBtn);
    actionRow.appendChild(confirmBtn);
    wrapper.appendChild(actionRow);

    this.container.appendChild(wrapper);
  }

  updateConfirmState(confirmBtn) {
    if (!confirmBtn) return;
    const isComplete = this.ambiguities.every(a => !!this.selections[a.tokenIndex]);
    confirmBtn.disabled = !isComplete;
  }

  playContextClip(span) {
    if (!span) return;
    const startMs = Math.max(0, Number(span.startMs) || 0);
    const endMs = Math.max(startMs + 50, Number(span.endMs) || (startMs + 500));
    const startSec = startMs / 1000;
    const endSec = endMs / 1000;

    const g = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null);
    const coordinator = g?.SegmentPlaybackCoordinator?.defaultCoordinator || null;

    if (this.audioBuffer) {
      if (coordinator && typeof coordinator.playBoundedBuffer === 'function') {
        coordinator.playBoundedBuffer({
          buffer: this.audioBuffer,
          startMs,
          endMs
        });
        return;
      }

      const AudioCtx = (typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null);
      if (AudioCtx) {
        try {
          const ctx = (coordinator && typeof coordinator.getAudioContext === 'function')
            ? coordinator.getAudioContext()
            : new AudioCtx();
          if (ctx.state === 'suspended') ctx.resume().catch(() => {});
          const clipLength = Math.max(1, Math.floor((endSec - startSec) * this.audioBuffer.sampleRate));
          const clip = ctx.createBuffer(this.audioBuffer.numberOfChannels, clipLength, this.audioBuffer.sampleRate);
          const startSample = Math.floor(startSec * this.audioBuffer.sampleRate);
          for (let c = 0; c < this.audioBuffer.numberOfChannels; c++) {
            const sub = this.audioBuffer.getChannelData(c).subarray(startSample, startSample + clipLength);
            if (typeof clip.copyToChannel === 'function') {
              clip.copyToChannel(sub, c);
            } else {
              clip.getChannelData(c).set(sub);
            }
          }
          const src = ctx.createBufferSource();
          src.buffer = clip;
          src.connect(ctx.destination);
          src.start();
          return;
        } catch (_) {}
      }
    }

    if (this.audioElement) {
      if (coordinator && typeof coordinator.stopAll === 'function') {
        coordinator.stopAll();
      }
      try {
        this.audioElement.currentTime = startSec;
        const p = this.audioElement.play();
        if (p && typeof p.catch === 'function') {
          p.catch(() => {});
        }
        const durationMs = Math.max(200, (endSec - startSec) * 1000);
        setTimeout(() => {
          try {
            if (!this.audioElement.paused) {
              this.audioElement.pause();
            }
          } catch (_) {}
        }, durationMs);
      } catch (_) {}
    }
  }
}

if (typeof globalThis !== 'undefined') {
  globalThis.ReferenceConfirmationUi = ReferenceConfirmationUi;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ReferenceConfirmationUi;
  module.exports.ReferenceConfirmationUi = ReferenceConfirmationUi;
}

export default ReferenceConfirmationUi;
