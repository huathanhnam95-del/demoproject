/**
 * Transcript Disclosure UI Component
 * Renders the required always-visible transcript disclosure banner and uncertain-word styling
 * for unscripted spoken-response modes (Retell Lecture, SGD, RTS) per BEL Spec §11-§12.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const exportsObj = factory();
    root.TranscriptDisclosure = exportsObj.TranscriptDisclosure || exportsObj;
  }
})(typeof self !== 'undefined' ? self : this, function () {

  class TranscriptDisclosure {
  constructor({ containerEl, onWordClick = null } = {}) {
    this.container = containerEl;
    this.onWordClick = onWordClick;
    this.isOpen = false;
  }

  /**
   * Renders the disclosure banner and interactive tokens into the container.
   * 
   * @param {Object} assessmentResult - The response from assessSpokenResponse
   */
  render(assessmentResult) {
    if (!this.container || !assessmentResult) return;

    const { transcription, transcriptDisclosure } = assessmentResult;
    const isV3 = assessmentResult.schemaVersion === 'bel.speech.v3';
    const words = isV3 && Array.isArray(assessmentResult.wordResults)
      ? assessmentResult.wordResults : (assessmentResult.words || []);
    const headline = transcriptDisclosure?.headline || 'Pronunciation of your response';
    const subtitle = transcriptDisclosure?.subtitle || 'Based on the words recognized in your recording. View transcript';
    const uncertainNotice = transcriptDisclosure?.uncertainWordNotice || 'Word recognition uncertain. Listen to this section and check the transcript.';

    this.container.innerHTML = `
      <section class="transcript-disclosure-wrapper" role="region" aria-label="Speech transcript disclosure">
        <header class="transcript-disclosure-header">
          <div class="disclosure-title-group">
            <span class="disclosure-badge" aria-hidden="true">ASR Transcript</span>
            <h4 class="disclosure-headline">${escapeHtml(headline)}</h4>
            <p class="disclosure-subtitle">${escapeHtml(subtitle)}</p>
          </div>
          <button type="button" class="disclosure-toggle-btn" aria-expanded="false" aria-controls="transcript-body-panel">
            <span class="toggle-btn-text">View Full Transcript</span>
            <span class="toggle-btn-icon" aria-hidden="true">▼</span>
          </button>
        </header>

        <div id="transcript-body-panel" class="transcript-body-panel" hidden>
          <div class="transcript-raw-text">
            <p>${escapeHtml(transcription?.rawTranscript || 'No transcript available.')}</p>
          </div>
        </div>

        <div class="transcript-tokens-flow" role="list">
          ${words.map((w, idx) => {
            const isUncertain = Boolean(w.isTranscriptUncertain);
            const scoreClass = typeof w.accuracyScore === 'number'
              ? (w.accuracyScore >= 80 ? 'token-pass' : (w.accuracyScore >= 60 ? 'token-amber' : 'token-red'))
              : 'token-unrated';
            const uncertainClass = isUncertain ? 'token-uncertain' : '';
            const title = w.presence === 'omitted' ? 'Word not detected in the recording'
              : isUncertain ? uncertainNotice : `Score: ${w.accuracyScore ?? 'unavailable'}`;
            const playbackLabel = w.isBoundaryUncertain || w.clipTiming?.isolationStatus === 'uncertain'
              ? ' (context playback)' : '';
            const syllables = isV3 && w.presence !== 'omitted' && Array.isArray(w.syllables)
              ? w.syllables : [];

            return `
              <span class="word-token ${scoreClass} ${uncertainClass}"
                    role="button"
                    tabindex="0"
                    data-word-index="${idx}"
                    data-occurrence-id="${escapeHtml(w.occurrenceId || '')}"
                    data-start-ms="${w.startMs ?? w.rawStartMs ?? 0}"
                    data-end-ms="${w.endMs ?? w.rawEndMs ?? 0}"
                    title="${escapeHtml(title)}"
                    aria-label="${escapeHtml(w.word)}, score ${w.accuracyScore ?? 'unavailable'}${isUncertain ? ', recognition uncertain' : ''}${playbackLabel}">
                ${escapeHtml(w.displayText || w.word)}${playbackLabel ? '<small>Context</small>' : ''}
              </span>
              ${syllables.length ? `<span class="syllable-chips" aria-label="Syllable breakdown">${syllables.map((s, syllableIndex) => {
                const score = typeof s.accuracyScore === 'number' ? s.accuracyScore : null;
                const state = score === null ? 'token-unrated' : score >= 80 ? 'token-pass' : score >= 60 ? 'token-amber' : 'token-red';
                const ipaRaw = (s.phonemes || []).map(p => p.ipaRaw || '').join('');
                const normalize = typeof window !== 'undefined' && window.Phonetics?.normalizeIPA;
                const ipa = normalize ? normalize(ipaRaw) : ipaRaw;
                return `<button type="button" class="syllable-chip ${state}" data-word-index="${idx}" data-syllable-index="${syllableIndex}" title="${escapeHtml(ipa ? `/${ipa}/ · ${score ?? 'unavailable'}` : `${score ?? 'unavailable'}`)}">${escapeHtml(s.syllable || '')}</button>`;
              }).join('')}</span>` : ''}
            `;
          }).join(' ')}
        </div>
      </section>
    `;

    // Bind toggle button
    const toggleBtn = this.container.querySelector('.disclosure-toggle-btn');
    const bodyPanel = this.container.querySelector('#transcript-body-panel');
    const toggleIcon = this.container.querySelector('.toggle-btn-icon');
    const toggleText = this.container.querySelector('.toggle-btn-text');

    if (toggleBtn && bodyPanel) {
      toggleBtn.addEventListener('click', () => {
        this.isOpen = !this.isOpen;
        bodyPanel.hidden = !this.isOpen;
        toggleBtn.setAttribute('aria-expanded', String(this.isOpen));
        if (toggleIcon) toggleIcon.textContent = this.isOpen ? '▲' : '▼';
        if (toggleText) toggleText.textContent = this.isOpen ? 'Hide Full Transcript' : 'View Full Transcript';
      });
    }

    // Bind token clicks
    if (this.onWordClick) {
      const tokens = this.container.querySelectorAll('.word-token');
      tokens.forEach(tok => {
        tok.addEventListener('click', (e) => {
          const idx = parseInt(tok.getAttribute('data-word-index'), 10);
          this.onWordClick(words[idx], idx, tok, e);
        });
        tok.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            tok.click();
          }
        });
      });
      this.container.querySelectorAll('.syllable-chip').forEach(chip => {
        chip.addEventListener('click', (event) => {
          event.stopPropagation();
          const idx = Number(chip.dataset.wordIndex);
          const syllable = words[idx]?.syllables?.[Number(chip.dataset.syllableIndex)];
          if (!syllable) return;
          const span = syllable.span;
          this.onWordClick({ ...words[idx], clip: span, clipTiming: { clipSpan: span } }, idx, chip, event);
        });
      });
    }
  }
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, m => {
    switch (m) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#039;';
      default: return m;
    }
  });
}

  return TranscriptDisclosure;
});

