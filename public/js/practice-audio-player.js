/**
 * Practice Audio Player — shared wiring for the `.practice-audio-player` component.
 *
 * `css/practice-audio-player.css` already unified the *look* of the seven Listening
 * player copies; every mode still hand-rolled the same play/pause, progress, seek,
 * timestamp and volume wiring. Speaking modes had neither, so their prompt audio
 * showed up as a lone Play button with no duration, position, or volume.
 *
 * This module supplies that wiring once. It binds by convention:
 *   <prefix>-play-btn | -play-icon | -play-label | -progress-fill | -seek
 *   <prefix>-audio-time | -volume
 * Any of the parts may be absent; each is wired only when present.
 *
 * Usage:
 *   const player = PracticeAudioPlayer.attach({ prefix: 'asq', audioId: 'asq-prompt-audio' });
 *   player.setEnabled(false);   // no clip for this question
 *   player.reset();             // back to 00:00 on question change
 *   player.destroy();           // drop every listener
 */
(function () {
  'use strict';

  function byId(id) {
    return id ? document.getElementById(id) : null;
  }

  function formatTime(seconds) {
    if (!seconds || !Number.isFinite(seconds)) return '00:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  /**
   * @param {Object} options
   * @param {string} options.prefix       id prefix shared by the component parts
   * @param {HTMLAudioElement} [options.audio]
   * @param {string} [options.audioId]    used when `audio` is not passed
   * @param {string} [options.playButtonId] override for `<prefix>-play-btn`
   * @param {boolean} [options.allowSeek=true] false keeps the track as a read-only
   *        progress bar, for exam flows where scrubbing would bypass a replay cap
   * @param {boolean} [options.bindPlayButton=true] false when the mode owns the click
   * @param {boolean} [options.updatePlayLabel=true] false leaves the button label alone
   * @param {() => (boolean|void)} [options.onBeforePlay] return false to block playback
   * @returns {Object|null} controller, or null when there is no audio element
   */
  function attach(options = {}) {
    const prefix = String(options.prefix || '').trim();
    const audio = options.audio || byId(options.audioId);
    if (!audio) return null;

    const els = {
      playBtn: byId(options.playButtonId || `${prefix}-play-btn`),
      playIcon: byId(`${prefix}-play-icon`),
      playLabel: byId(`${prefix}-play-label`),
      progressFill: byId(`${prefix}-progress-fill`),
      seek: byId(`${prefix}-seek`),
      audioTime: byId(`${prefix}-audio-time`),
      volume: byId(`${prefix}-volume`)
    };

    let allowSeek = options.allowSeek !== false;
    const listeners = [];

    function on(target, type, handler) {
      if (!target) return;
      target.addEventListener(type, handler);
      listeners.push([target, type, handler]);
    }

    // Repeat Sentence's Play spends a replay and restarts the clip rather than
    // toggling playback, so flipping its label to "Pause" would misdescribe it.
    const updatePlayLabel = options.updatePlayLabel !== false;

    function setPlayLabel(label, icon) {
      if (!updatePlayLabel) return;
      if (els.playLabel) els.playLabel.textContent = label;
      else if (els.playBtn && !els.playIcon) els.playBtn.textContent = label;
      if (els.playIcon) els.playIcon.textContent = icon;
    }

    function showPlaying() {
      setPlayLabel('Pause', 'pause');
    }

    function showPaused() {
      setPlayLabel('Play', 'play_arrow');
    }

    function updateProgress() {
      if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
      const percentage = Math.min(100, (audio.currentTime / audio.duration) * 100);
      if (els.progressFill) els.progressFill.style.width = `${percentage}%`;
      if (els.seek) els.seek.value = String(percentage);
      if (els.audioTime) {
        els.audioTime.textContent = `${formatTime(audio.currentTime)} / ${formatTime(audio.duration)}`;
      }
    }

    function reset() {
      if (els.progressFill) els.progressFill.style.width = '0';
      if (els.seek) els.seek.value = '0';
      if (els.audioTime) els.audioTime.textContent = '00:00 / 00:00';
      showPaused();
    }

    function toggle() {
      if (!audio.src) return;
      if (audio.paused) {
        if (typeof options.onBeforePlay === 'function' && options.onBeforePlay() === false) return;
        if (els.volume) audio.volume = Number(els.volume.value);
        audio.play().catch(() => { /* autoplay/permission rejection is surfaced by the mode */ });
        return;
      }
      audio.pause();
    }

    function setEnabled(enabled) {
      if (els.playBtn) {
        els.playBtn.disabled = !enabled;
        els.playBtn.setAttribute('aria-disabled', enabled ? 'false' : 'true');
      }
      if (els.seek) els.seek.disabled = !enabled || !allowSeek;
    }

    function setAllowSeek(next) {
      allowSeek = !!next;
      if (els.seek) els.seek.disabled = !allowSeek || (els.playBtn ? els.playBtn.disabled : false);
    }

    // The mode owns the click handler when it needs extra work (replay caps,
    // attempt bookkeeping); otherwise this module drives play/pause itself.
    if (options.bindPlayButton !== false) on(els.playBtn, 'click', toggle);

    on(audio, 'play', showPlaying);
    on(audio, 'pause', showPaused);
    on(audio, 'ended', () => {
      showPaused();
      audio.currentTime = 0;
      reset();
    });
    on(audio, 'timeupdate', updateProgress);
    on(audio, 'loadedmetadata', updateProgress);
    on(audio, 'emptied', reset);

    on(els.seek, 'input', () => {
      if (!allowSeek) return;
      if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
      const percentage = Math.min(100, Math.max(0, Number(els.seek.value) || 0));
      audio.currentTime = (percentage / 100) * audio.duration;
      updateProgress();
    });

    on(els.volume, 'input', () => {
      audio.volume = Number(els.volume.value);
    });

    if (els.volume) audio.volume = Number(els.volume.value);
    if (els.seek && !allowSeek) els.seek.disabled = true;
    reset();

    return {
      elements: els,
      audio,
      toggle,
      reset,
      refresh: updateProgress,
      setEnabled,
      setAllowSeek,
      showPlaying,
      showPaused,
      destroy() {
        listeners.splice(0).forEach(([target, type, handler]) => {
          target.removeEventListener(type, handler);
        });
      }
    };
  }

  window.PracticeAudioPlayer = { attach, formatTime };
})();
