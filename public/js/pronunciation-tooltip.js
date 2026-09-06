/**
 * PronunciationTooltip — Shared Interactive Word & Syllable Pronunciation Coaching Tooltip
 *
 * Provides:
 * - Word intelligibility scoring decoupled from narrow-band acoustic syllable precision
 * - Syllable-level acoustic breakdown with millisecond timestamps
 * - Spoken candidate phoneme substitution diagnosis (heardIpa)
 * - Articulatory physical coaching cues with Oxford American IPA normalization
 * - Single-click audio snippet playback with anti-bleed audio envelopes
 */
(function (global) {
  'use strict';

  let activeTooltipToken = null;
  let wordTooltipEl = null;
  let tooltipHideTimer = null;
  let isHoveringTooltip = false;
  let isHoveringToken = false;
  let activeAudioContext = null;
  let activeAudioSource = null;
  let activeAudioTimer = null;
  let activePlayingElement = null;

  const HTML_ESCAPE_MAP = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  };

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (ch) => HTML_ESCAPE_MAP[ch]);
  }

  function normalizeToOxfordAmericanIPA(ipa) {
    if (!ipa || typeof ipa !== 'string') return '';
    const hasSlashes = ipa.trim().startsWith('/') && ipa.trim().endsWith('/');
    const unslashed = ipa.trim().replace(/^\/+|\/+$/g, '');

    if (typeof global !== 'undefined' && global.Phonetics && typeof global.Phonetics.toOxfordAmerican === 'function') {
      try {
        const norm = global.Phonetics.toOxfordAmerican(unslashed);
        if (norm) return hasSlashes ? `/${norm}/` : norm;
      } catch (_err) {
        // Fallback to internal regex
      }
    }

    let cleaned = unslashed
      .replace(/ɹ/g, 'r')
      .replace(/:/g, 'ː')
      .replace(/[\u0361\u035C\u0329]/g, '')
      .replace(/ɾ/g, 't')
      .replace(/ɡ/g, 'g')
      .replace(/[0-9]/g, '')
      .replace(/'/g, 'ˈ')
      .replace(/ɛ/g, 'e')
      .replace(/ɚ/g, 'ər')
      .replace(/ɝ/g, 'ɜːr');

    return hasSlashes ? `/${cleaned}/` : cleaned;
  }

  function normalizeIPAsInText(text) {
    if (!text || typeof text !== 'string') return '';
    return text.replace(/\/([^/\s]+)\//g, (m, ipa) => `/${normalizeToOxfordAmericanIPA(ipa).replace(/^\/+|\/+$/g, '')}/`);
  }

  function ensureWordTooltip() {
    if (!wordTooltipEl) {
      wordTooltipEl = document.getElementById('crm-word-tooltip');
      if (!wordTooltipEl) {
        wordTooltipEl = document.createElement('div');
        wordTooltipEl.id = 'crm-word-tooltip';
        wordTooltipEl.className = 'crm-word-tooltip';
        wordTooltipEl.style.display = 'none';
        document.body.appendChild(wordTooltipEl);
      }

      if (!wordTooltipEl.dataset.pronTooltipBound) {
        wordTooltipEl.dataset.pronTooltipBound = 'true';

        wordTooltipEl.addEventListener('mouseenter', () => {
          isHoveringTooltip = true;
          if (tooltipHideTimer) {
            clearTimeout(tooltipHideTimer);
            tooltipHideTimer = null;
          }
        });

        wordTooltipEl.addEventListener('mouseleave', () => {
          isHoveringTooltip = false;
          if (!isHoveringToken) {
            tooltipHideTimer = setTimeout(() => {
              if (!isHoveringTooltip && !isHoveringToken) {
                hideWordTooltip();
              }
            }, 120);
          }
        });
      }
    }
    return wordTooltipEl;
  }

  function hideWordTooltip() {
    activeTooltipToken = null;
    isHoveringTooltip = false;
    isHoveringToken = false;
    if (tooltipHideTimer) {
      clearTimeout(tooltipHideTimer);
      tooltipHideTimer = null;
    }
    if (wordTooltipEl) {
      wordTooltipEl.style.display = 'none';
    }
  }

  function positionWordTooltip(token, tooltip) {
    if (!token || !tooltip) return;
    const rect = token.getBoundingClientRect();
    const tipRect = tooltip.getBoundingClientRect();

    let left = rect.left + (rect.width / 2) - (tipRect.width / 2);
    let top = rect.top - tipRect.height - 8;

    const padding = 8;
    if (left + tipRect.width > window.innerWidth - padding) {
      left = window.innerWidth - tipRect.width - padding;
    }
    if (left < padding) left = padding;

    if (top < padding) {
      top = rect.bottom + 8;
    }
    if (top + tipRect.height > window.innerHeight - padding) {
      top = Math.max(padding, window.innerHeight - tipRect.height - padding);
    }

    tooltip.style.left = `${Math.round(left)}px`;
    tooltip.style.top = `${Math.round(top)}px`;
    tooltip.style.visibility = 'visible';
  }

  function stopSegmentPlayback() {
    if (activeAudioTimer) {
      clearTimeout(activeAudioTimer);
      activeAudioTimer = null;
    }
    if (activeAudioSource) {
      try {
        activeAudioSource.stop();
        activeAudioSource.disconnect();
      } catch (_) {
        // Ignore cleanup errors if audio source is already stopped
      }
      activeAudioSource = null;
    }
    if (activePlayingElement) {
      activePlayingElement.classList.remove('is-playing');
      activePlayingElement = null;
    }
  }

  function getAudioContext() {
    if (!activeAudioContext || activeAudioContext.state === 'closed') {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        activeAudioContext = new AudioCtx();
      }
    }
    return activeAudioContext;
  }

  async function playAudioSegment(audioSource, startMs, endMs, triggerEl) {
    if (triggerEl && activePlayingElement === triggerEl) {
      stopSegmentPlayback();
      return true;
    }

    stopSegmentPlayback();

    const start = Number(startMs);
    const end = Number(endMs);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return false;
    }

    const durationSec = (end - start) / 1000;
    const startSec = start / 1000;

    if (triggerEl) {
      activePlayingElement = triggerEl;
      triggerEl.classList.add('is-playing');
    }

    // Case 1: WebAudio AudioBuffer
    const isAudioBuffer = (typeof AudioBuffer !== 'undefined' && audioSource instanceof AudioBuffer)
      || (audioSource && typeof audioSource.getChannelData === 'function')
      || (audioSource && typeof audioSource.duration === 'number' && typeof audioSource.sampleRate === 'number');
    if (isAudioBuffer) {
      const ctx = getAudioContext();
      if (!ctx) return false;
      if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
        await ctx.resume();
      }

      const source = ctx.createBufferSource();
      const gainNode = ctx.createGain();

      source.buffer = audioSource;

      // Safe monotonic anti-bleed envelope (handles even ultra-short durations < 20ms without timing exception)
      const now = ctx.currentTime;
      const attackSec = Math.min(0.005, durationSec * 0.25);
      const releaseSec = Math.min(0.005, durationSec * 0.25);
      const sustainEnd = Math.max(attackSec, durationSec - releaseSec);

      gainNode.gain.setValueAtTime(0.0001, now);
      gainNode.gain.exponentialRampToValueAtTime(1.0, now + attackSec);
      if (sustainEnd > attackSec) {
        gainNode.gain.setValueAtTime(1.0, now + sustainEnd);
      }
      gainNode.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);

      source.connect(gainNode);
      gainNode.connect(ctx.destination);

      source.start(now, startSec, durationSec);
      activeAudioSource = source;

      activeAudioTimer = setTimeout(() => {
        stopSegmentPlayback();
      }, durationSec * 1000 + 20);

      return true;
    }

    // Case 2: HTMLAudioElement
    if (audioSource && typeof audioSource.play === 'function') {
      try {
        audioSource.currentTime = startSec;
        await audioSource.play();

        activeAudioTimer = setTimeout(() => {
          try {
            audioSource.pause();
          } catch (_) {
            // Ignore pause errors
          }
          stopSegmentPlayback();
        }, durationSec * 1000);

        return true;
      } catch (err) {
        console.warn('[PronunciationTooltip] HTMLAudio playback failed:', err);
        stopSegmentPlayback();
        return false;
      }
    }

    stopSegmentPlayback();
    return false;
  }

  function showWordTooltip(token, options = {}) {
    if (!token) return;
    const tooltip = ensureWordTooltip();
    activeTooltipToken = token;

    const wordText = String(token.dataset.word || token.textContent || '').trim().replace(/^\[|\]$/g, '');
    const rawAcc = token.dataset.accuracy;
    const acc = (rawAcc !== undefined && rawAcc !== '' && !Number.isNaN(Number(rawAcc))) ? Number(rawAcc) : null;

    let syllables = [];
    try {
      if (token.dataset.syllables) {
        syllables = JSON.parse(token.dataset.syllables);
      }
    } catch (_) {
      syllables = [];
    }

    let badgeClass = 'syl-green';
    if (acc != null) {
      if (acc < 60) badgeClass = 'syl-red';
      else if (acc < 80) badgeClass = 'syl-amber';
    }

    const badgeHtml = acc != null
      ? `<span class="crm-tooltip-badge ${badgeClass}">${acc}%</span>`
      : '';

    // Calculate syllable average / status
    const sylScores = Array.isArray(syllables)
      ? syllables.map(s => Math.round(Number(s.accuracyScore ?? 0)))
      : [];
    const avgSylScore = sylScores.length > 0
      ? Math.round(sylScores.reduce((a, b) => a + b, 0) / sylScores.length)
      : null;

    // Subtitle context: if word is green but syllables show divergence
    let subtitleHtml = '<div class="crm-tooltip-subtitle">Word Intelligibility</div>';
    if (acc != null && acc >= 80 && avgSylScore != null && avgSylScore < 80) {
      subtitleHtml = '<div class="crm-tooltip-subtitle">Word is clearly intelligible, but syllables show accent variance.</div>';
    }

    let syllablesHtml = '';
    if (Array.isArray(syllables) && syllables.length > 0) {
      const chips = syllables.map((s, sIdx) => {
        const score = Math.round(Number(s.accuracyScore ?? 0));
        let chipClass = 'syl-green';
        if (score < 60) chipClass = 'syl-red';
        else if (score < 80) chipClass = 'syl-amber';
        const sText = escapeHtml(s.text || normalizeToOxfordAmericanIPA(s.ipa) || `syl-${sIdx + 1}`);
        const hasTiming = s.startMs != null && s.endMs != null;
        const timeAttr = hasTiming
          ? ` data-start-ms="${s.startMs}" data-end-ms="${s.endMs}" title="Click to listen to '${sText}'"`
          : '';
        const playIcon = hasTiming ? '<span class="crm-syl-play">🔊</span> ' : '';
        return `<span class="crm-syl-chip ${chipClass}" role="button" tabindex="0"${timeAttr}>${playIcon}<span class="crm-syl-text">${sText}</span> <span class="crm-syl-score">${score}%</span></span>`;
      }).join('');

      const matchLabel = avgSylScore != null ? ` (Acoustic Match: ${avgSylScore}%)` : '';
      syllablesHtml = `
        <div class="crm-tooltip-section">
          <div class="crm-tooltip-section-title">Syllables${matchLabel}</div>
          <div class="crm-tooltip-syllables">${chips}</div>
        </div>
      `;
    }

    // Diagnostic insights for low-scoring or substituted syllables
    let insightHtml = '';
    const diagnosticItems = [];
    if (Array.isArray(syllables)) {
      for (const s of syllables) {
        if (s.diagnosis) {
          const sLabel = escapeHtml(s.text || normalizeToOxfordAmericanIPA(s.ipa) || '');
          const diagText = escapeHtml(normalizeIPAsInText(s.diagnosis));
          let tipHtml = '';
          if (s.tip) {
            const tipText = escapeHtml(normalizeIPAsInText(s.tip));
            tipHtml = `
              <div class="crm-insight-tip">
                <span class="crm-tip-badge">💡 Tip</span>
                <span class="crm-tip-text">${tipText}</span>
              </div>
            `;
          }
          diagnosticItems.push(`
            <div class="crm-insight-item">
              <div class="crm-insight-obs">
                <strong class="crm-insight-syl">${sLabel}:</strong> ${diagText}
              </div>
              ${tipHtml}
            </div>
          `);
        }
      }
    }
    if (diagnosticItems.length > 0) {
      insightHtml = `
        <div class="crm-tooltip-insight">
          <div class="crm-insight-title">💡 Acoustic Diagnosis & Coaching</div>
          <div class="crm-insight-list">${diagnosticItems.join('')}</div>
        </div>
      `;
    }

    const hasSyllableAudio = Array.isArray(syllables) && syllables.some(s => s.startMs != null);
    const hasWordAudio = token.dataset.playable === 'true' || (token.dataset.startMs != null && token.dataset.endMs != null);
    const hintText = hasSyllableAudio
      ? '🔊 Click word or syllable chip to listen'
      : (hasWordAudio ? '🔊 Click word to listen' : '');
    const hintHtml = hintText
      ? `<div class="crm-tooltip-hint">${hintText}</div>`
      : '';

    tooltip.innerHTML = `
      <div class="crm-tooltip-header">
        <span class="crm-tooltip-word">${escapeHtml(wordText)}</span>
        ${badgeHtml}
      </div>
      ${subtitleHtml}
      ${syllablesHtml}
      ${insightHtml}
      ${hintHtml}
    `;

    tooltip.style.display = 'flex';
    tooltip.style.visibility = 'hidden';

    positionWordTooltip(token, tooltip);

    // Setup chip click handler for this specific tooltip render
    const chipClickHandler = (e) => {
      const chip = e.target.closest('.crm-syl-chip');
      if (!chip) return;
      const sStart = chip.dataset.startMs;
      const sEnd = chip.dataset.endMs;
      if (sStart == null || sEnd == null) return;

      e.stopPropagation();
      e.preventDefault();

      if (typeof options.playSyllable === 'function') {
        options.playSyllable(Number(sStart), Number(sEnd), chip, token);
      } else if (typeof options.getAudioSource === 'function') {
        const src = options.getAudioSource(token);
        if (src) {
          playAudioSegment(src, Number(sStart), Number(sEnd), chip);
        }
      }
    };

    // Remove previous click listener if any and add fresh one
    tooltip.onclick = chipClickHandler;
  }

  function bindHoverTooltip(rootEl, options = {}) {
    if (!rootEl) return;
    const selector = options.selector || '.crm-word-token, .ra-word-token, .speak-word-token';

    rootEl.addEventListener('mouseover', (e) => {
      const token = e.target.closest(selector);
      if (!token) return;

      isHoveringToken = true;
      if (tooltipHideTimer) {
        clearTimeout(tooltipHideTimer);
        tooltipHideTimer = null;
      }
      if (token === activeTooltipToken) return;
      showWordTooltip(token, options);
    });

    rootEl.addEventListener('mouseout', (e) => {
      const token = e.target.closest(selector);
      if (!token) return;

      const related = e.relatedTarget;
      if (related && (token.contains(related) || (wordTooltipEl && wordTooltipEl.contains(related)))) return;

      isHoveringToken = false;
      if (tooltipHideTimer) {
        clearTimeout(tooltipHideTimer);
        tooltipHideTimer = null;
      }
      tooltipHideTimer = setTimeout(() => {
        if (!isHoveringTooltip && !isHoveringToken) {
          hideWordTooltip();
        }
      }, 120);
    });

    rootEl.addEventListener('focusin', (e) => {
      const token = e.target.closest(selector);
      if (!token) return;
      isHoveringToken = true;
      showWordTooltip(token, options);
    });

    rootEl.addEventListener('focusout', (e) => {
      const token = e.target.closest(selector);
      if (!token) return;
      isHoveringToken = false;
      tooltipHideTimer = setTimeout(() => {
        if (!isHoveringTooltip && !isHoveringToken) {
          hideWordTooltip();
        }
      }, 120);
    });
  }

  const PronunciationTooltip = {
    ensureWordTooltip,
    hideWordTooltip,
    positionWordTooltip,
    showWordTooltip,
    bindHoverTooltip,
    playAudioSegment,
    stopSegmentPlayback,
    getAudioContext,
    normalizeToOxfordAmericanIPA,
    normalizeIPAsInText
  };

  global.PronunciationTooltip = PronunciationTooltip;
})(typeof window !== 'undefined' ? window : global);
