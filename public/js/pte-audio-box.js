(function () {
  'use strict';
  // Browser suites run the shell faster than real time through this seam; it scales the
  // countdown tick and the stall watchdog together so both stay proportionate.
  const timeScale = () => {
    const scale = typeof window !== 'undefined' ? Number(window.__PTE_TEST_TIME_SCALE) : NaN;
    return Number.isFinite(scale) && scale > 0 ? scale : 1;
  };
  // Playback that makes no progress for this long has failed: a source that never loads,
  // a network that stopped delivering, or a resolver that never produced a URL. Measured
  // from progress, not from the clip's length, so a long lecture is never cut off.
  const STALL_MS = 15000;
  const MAX_SOURCE_RETRIES = 3;

  /** Uses the mode's audio element. Reset/destroy cancel any pending countdown or playback. */
  function create(host, { audio, stallMs = STALL_MS } = {}) {
    if (!audio) throw new TypeError('PteAudioBox requires the mode audio element');
    const box = document.createElement('div'); box.className = 'pte-audio';
    box.innerHTML = '<div class="pte-audio__status">Status: <b></b></div><div class="pte-audio__track"><i></i></div><label class="pte-audio__vol">Volume <input type="range" min="0" max="1" step="0.05" aria-label="Volume"></label>'
      + '<div class="pte-audio__actions" hidden><button type="button" class="pte-audio__btn pte-audio__btn--retry" data-action="retry">Try again</button><button type="button" class="pte-audio__btn" data-action="continue">Continue without audio</button></div>';
    const announcement = document.createElement('span');
    announcement.className = 'pte-sr-only';
    announcement.setAttribute('role', 'status');
    announcement.setAttribute('aria-live', 'polite');
    announcement.setAttribute('aria-atomic', 'true');
    host.replaceChildren(box, announcement);
    const status = box.querySelector('b'), fill = box.querySelector('.pte-audio__track i'), volume = box.querySelector('input');
    const actions = box.querySelector('.pte-audio__actions');
    let destroyed = false, timer, watchdog, pending, operation = 0;
    let lastProgressAt = 0, lastTime = 0, sourceRetries = 0;
    // A shell can take over a state's message (the speaking shell shows a failure in its dock,
    // which has its own live region); the box then stays quiet so it is not said twice.
    const emitState = (state, spoken) => !box.dispatchEvent(new CustomEvent('pte-audio-state', { bubbles: true, cancelable: true, detail: { state, spoken } }));
    // `spoken` is what the live region says on a state change; null keeps a state silent.
    const setStatus = (state, text, spoken = text) => {
      if (box.dataset.state !== state && !emitState(state, spoken) && spoken) announcement.textContent = spoken;
      box.dataset.state = state; status.textContent = text;
    };
    const progress = () => {
      fill.style.width = `${audio.duration > 0 ? Math.min(100, audio.currentTime / audio.duration * 100) : 0}%`;
      if (audio.currentTime !== lastTime) { lastTime = audio.currentTime; lastProgressAt = Date.now(); }
    };
    const syncVolume = () => { volume.value = audio.volume; };
    const changeVolume = () => { audio.volume = Number(volume.value); };
    function clearGesture() { box.removeAttribute('role'); box.removeAttribute('tabindex'); }
    function showActions(show) { actions.hidden = !show; }
    function stopWatchdog() { clearInterval(watchdog); watchdog = null; }
    function finish(error) {
      clearInterval(timer); timer = null;
      stopWatchdog();
      const current = pending; pending = null;
      clearGesture();
      if (current) error ? current.reject(error) : current.resolve();
    }
    function cancel() {
      operation++;
      showActions(false);
      finish(new DOMException('Audio operation cancelled', 'AbortError'));
      audio.pause();
    }
    function setCompleted() {
      if (destroyed) return;
      showActions(false);
      setStatus('completed', 'Completed'); fill.style.width = '100%'; finish();
    }
    // The learner is never moved on while the question is still playing, and never
    // silently: a failure stops the audio and waits for Try again or Continue.
    function fail() {
      if (destroyed || pending?.type !== 'play' || box.dataset.state === 'failed') return;
      stopWatchdog();
      audio.pause();
      clearGesture();
      setStatus('failed', "Audio couldn't play", "The audio couldn't play. Try again, or continue without it.");
      showActions(true);
    }
    function armWatchdog() {
      stopWatchdog();
      lastProgressAt = Date.now(); lastTime = audio.currentTime;
      const limit = stallMs * timeScale();
      watchdog = setInterval(() => {
        if (destroyed || pending?.type !== 'play') { stopWatchdog(); return; }
        if (Date.now() - lastProgressAt > limit) fail();
      }, Math.max(50, Math.round(1000 * timeScale())));
    }
    const ended = () => { if (pending?.type === 'play') setCompleted(); };
    // The media resolver answers an error on the delivery URL by loading the fallback
    // path, which clears audio.error. Only a source that is still broken a moment later
    // is a failure; a stall is left to the watchdog.
    const failed = () => {
      if (pending?.type !== 'play') return;
      const token = operation;
      setTimeout(() => {
        if (token === operation && pending?.type === 'play' && audio.error) fail();
      }, Math.round(1500 * timeScale()));
    };
    const started = () => {
      if (pending?.type !== 'play' || box.dataset.state === 'failed') return;
      lastProgressAt = Date.now();
      clearGesture(); setStatus('playing', 'Playing');
    };
    async function startAudio() {
      const token = operation;
      showActions(false);
      // Visual only: it usually lasts a moment, and "Playing" follows straight after.
      if (box.dataset.state !== 'playing') setStatus('loading', 'Loading audio…', null);
      armWatchdog();
      try {
        await audio.play();
        if (token !== operation || destroyed) return;
        started();
      } catch (error) {
        // fail() pauses the element, which rejects this play() with AbortError: leave the
        // failure showing rather than treating it as a source swap.
        if (token !== operation || destroyed || pending?.type !== 'play' || box.dataset.state === 'failed') return;
        if (error?.name === 'NotAllowedError') {
          stopWatchdog();
          setStatus('blocked', 'Click to start audio');
          box.setAttribute('role', 'button'); box.tabIndex = 0;
          return;
        }
        // A new source replaced the one play() started on (the media resolver swapping in
        // the delivery URL): play the new source instead of giving up on the question.
        if (error?.name === 'AbortError' && sourceRetries < MAX_SOURCE_RETRIES) {
          sourceRetries++;
          queueMicrotask(() => { if (token === operation && pending?.type === 'play') startAudio(); });
          return;
        }
        fail();
      }
    }
    const gesture = event => {
      if (box.dataset.state !== 'blocked' || event.target === volume || actions.contains(event.target)) return;
      if (event.type === 'keydown' && !['Enter', ' '].includes(event.key)) return;
      event.preventDefault(); startAudio();
    };
    const onAction = event => {
      const button = event.target.closest('button[data-action]');
      if (!button || pending?.type !== 'play') return;
      event.preventDefault(); event.stopPropagation();
      if (button.dataset.action === 'retry') {
        sourceRetries = 0;
        // A broken or never-loaded source is fetched again from the start; a clip that
        // merely stalled resumes where it stopped.
        const broken = !!audio.error || audio.readyState === 0;
        try { if (broken && (audio.currentSrc || audio.getAttribute('src'))) audio.load(); } catch (_) { /* keep going */ }
        box.dataset.state = 'retrying';
        startAudio();
      } else {
        showActions(false);
        setStatus('completed', 'Skipped'); finish();
      }
    };
    function play() {
      if (destroyed) return Promise.reject(new DOMException('Audio box destroyed', 'AbortError'));
      cancel();
      sourceRetries = 0;
      const promise = new Promise((resolve, reject) => { pending = { resolve, reject, type: 'play' }; });
      startAudio();
      return promise;
    }
    function countdown(n) {
      if (destroyed) return Promise.reject(new DOMException('Audio box destroyed', 'AbortError'));
      cancel();
      let remaining = Math.max(0, Math.ceil(Number(n) || 0));
      fill.style.width = '0%';
      return new Promise((resolve, reject) => {
        pending = { resolve, reject, type: 'countdown' };
        // Hands over to "Loading audio…" at zero instead of showing "Beginning in 0 seconds".
        const update = () => {
          if (remaining <= 0) { finish(); return; }
          setStatus('countdown', `Beginning in ${remaining} ${remaining === 1 ? 'second' : 'seconds'}`);
          remaining--;
        };
        timer = setInterval(update, Math.max(16, Math.round(1000 * timeScale()))); update();
      });
    }
    function reset() {
      cancel(); audio.currentTime = 0; fill.style.width = '0%';
      // Idle is distinct from an actual countdown so its first tick announces
      // the supplied duration, including after a reset of an earlier countdown.
      emitState('idle', null);
      box.dataset.state = 'idle'; status.textContent = 'Ready';
      announcement.textContent = '';
    }
    audio.addEventListener('timeupdate', progress);
    audio.addEventListener('volumechange', syncVolume);
    audio.addEventListener('ended', ended);
    audio.addEventListener('error', failed);
    audio.addEventListener('playing', started);
    volume.addEventListener('input', changeVolume);
    actions.addEventListener('click', onAction);
    box.addEventListener('click', gesture); box.addEventListener('keydown', gesture);
    syncVolume(); reset();
    return { countdown, play, setCompleted, reset,
      replay() { audio.currentTime = 0; return play(); },
      destroy() {
        destroyed = true; cancel();
        audio.removeEventListener('timeupdate', progress); audio.removeEventListener('volumechange', syncVolume);
        audio.removeEventListener('ended', ended); audio.removeEventListener('error', failed);
        audio.removeEventListener('playing', started);
        volume.removeEventListener('input', changeVolume);
        actions.removeEventListener('click', onAction);
        box.removeEventListener('click', gesture); box.removeEventListener('keydown', gesture);
        host.replaceChildren();
      }
    };
  }
  window.PteAudioBox = { create };
})();
