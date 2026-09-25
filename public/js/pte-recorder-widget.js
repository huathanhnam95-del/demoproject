(function () {
  'use strict';
  const seconds = value => Math.max(0, Number.isFinite(Number(value)) ? Number(value) : 0);
  const formatClock = value => {
    const n = Math.floor(seconds(value));
    return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
  };
  const countdownMessage = value => {
    const n = Math.ceil(seconds(value));
    return `The recording will begin in ${n} ${n === 1 ? 'second' : 'seconds'}`;
  };
  const barsOn = (elapsed, total, count = 64) => total > 0
    ? Math.min(count, Math.floor(seconds(elapsed) / total * count)) : 0;

  // Plain-language copy for each way the microphone can fail to start. The modes used to
  // write these to hidden status elements, short toasts or only the console, so a learner
  // pressing Start recording saw nothing happen.
  // `detail` sits in the recorder beside the task; `hint` is the short form for the dock, so
  // the same sentence is not shown twice on one screen.
  const MIC_ERRORS = {
    blocked: { title: 'Microphone blocked', detail: 'Allow microphone access for this site (the icon at the left of the address bar), then press Start recording again.', hint: 'Allow it for this site, then press Start recording.' },
    missing: { title: 'No microphone found', detail: 'Connect a microphone or headset, then press Start recording again.', hint: 'Connect one, then press Start recording.' },
    busy: { title: 'Microphone in use', detail: 'Another app or tab is using your microphone. Close it, then press Start recording again.', hint: 'Close the app using it, then press Start recording.' },
    unsupported: { title: "This browser can't record", detail: 'Open this page in an up-to-date Chrome, Edge or Safari to record your answer.', hint: 'Use an up-to-date Chrome, Edge or Safari.' },
    unknown: { title: "Recording couldn't start", detail: 'Check your microphone, then press Start recording again.', hint: 'Check your microphone, then press Start recording.' }
  };
  const MIC_ERROR_KINDS = {
    NotAllowedError: 'blocked', SecurityError: 'blocked', PermissionDeniedError: 'blocked',
    NotFoundError: 'missing', DevicesNotFoundError: 'missing', OverconstrainedError: 'missing',
    NotReadableError: 'busy', TrackStartError: 'busy', AbortError: 'busy',
    NotSupportedError: 'unsupported'
  };
  /** Maps a getUserMedia failure (or any start error) to a kind, copy for the recorder
      (title, detail, message) and a short dock line (notice). */
  function describeMicError(error) {
    const name = String((error && (error.name || error.code)) || '');
    const kind = MIC_ERROR_KINDS[name] || 'unknown';
    const { title, detail, hint } = MIC_ERRORS[kind];
    return { kind, title, detail, hint, message: `${title}. ${detail}`, notice: `${title}. ${hint}` };
  }

  /** Presentation only: the owning mode supplies every timing update. Never stops its stream. */
  function create(host, { totalSeconds = 0 } = {}) {
    const visual = document.createElement('div');
    visual.className = 'pte-rec';
    visual.setAttribute('aria-hidden', 'true');
    const status = document.createElement('span');
    status.className = 'pte-sr-only';
    status.setAttribute('role', 'status');
    // Errors interrupt; everything else is announced politely through `status`.
    const alert = document.createElement('span');
    alert.className = 'pte-sr-only';
    alert.setAttribute('role', 'alert');
    host.replaceChildren(visual, status, alert);
    let state, total = seconds(totalSeconds), elapsed = 0, bars = [], context, source, analyser, frame;
    let destroyed = false;
    function detach() {
      if (frame) cancelAnimationFrame(frame);
      frame = null;
      source?.disconnect();
      analyser?.disconnect();
      if (context) context.close().catch(() => {});
      source = analyser = context = null;
    }
    function announce(next, message) {
      // An error is spoken once, through the alert region, never twice.
      if (next === 'error') status.textContent = '';
      else { if (state !== next) status.textContent = message; alert.textContent = ''; }
      state = next;
      visual.dataset.state = next;
    }
    function tick(n) {
      if (destroyed || state !== 'countdown') return;
      visual.querySelector('.pte-rec__ring').textContent = Math.ceil(seconds(n));
      visual.querySelector('.pte-rec__msg').textContent = countdownMessage(n);
    }
    function showCountdown(n) {
      if (destroyed) return;
      detach();
      visual.innerHTML = '<span class="pte-rec__ring"></span><span class="pte-rec__msg"></span>';
      announce('countdown', `Recording starts in ${Math.ceil(seconds(n))} seconds`);
      tick(n);
    }
    function showRecording(n = total) {
      if (destroyed) return;
      detach(); total = seconds(n); elapsed = 0;
      visual.innerHTML = '<span class="pte-rec__ring pte-rec__ring--rec"><i></i></span><span class="pte-rec__col"><small class="pte-rec__elapsed">00:00</small><span>Recording</span></span><span class="pte-rec__wave"></span><span class="pte-rec__total"></span>';
      bars = Array.from({ length: 64 }, () => document.createElement('i'));
      visual.querySelector('.pte-rec__wave').append(...bars);
      visual.querySelector('.pte-rec__total').textContent = formatClock(total);
      announce('recording', 'Recording');
    }
    function setElapsed(n) {
      if (destroyed || state !== 'recording') return;
      elapsed = Math.min(total, seconds(n));
      visual.querySelector('.pte-rec__elapsed').textContent = formatClock(elapsed);
      const count = barsOn(elapsed, total);
      bars.forEach((bar, i) => {
        bar.classList.toggle('is-recorded', i < count);
        bar.classList.toggle('is-recent', i < count && i >= count - 4);
        if (!analyser) bar.style.height = `${i < count ? 3 + ((i * 17 + 11) % 24) : 1}px`;
      });
    }
    function attachStream(stream) {
      if (destroyed || state !== 'recording') return;
      detach();
      try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        context = new AudioContext();
        source = context.createMediaStreamSource(stream);
        analyser = context.createAnalyser(); analyser.fftSize = 256;
        source.connect(analyser);
        context.resume().catch(() => { detach(); setElapsed(elapsed); });
        const samples = new Uint8Array(analyser.fftSize);
        const draw = () => {
          if (!analyser || destroyed || state !== 'recording') return;
          analyser.getByteTimeDomainData(samples);
          const rms = Math.sqrt(samples.reduce((sum, x) => sum + ((x - 128) / 128) ** 2, 0) / samples.length);
          const index = Math.min(63, barsOn(elapsed, total));
          bars[index].style.height = `${Math.min(26, Math.max(3, rms * 100))}px`;
          frame = requestAnimationFrame(draw);
        };
        draw();
      } catch (_) { detach(); setElapsed(elapsed); }
    }
    function showComplete() {
      if (destroyed) return;
      detach();
      visual.innerHTML = '<span class="pte-rec__ring pte-rec__ring--done"><i></i></span><span>Complete</span><span class="pte-rec__line"></span>';
      announce('complete', 'Recording complete');
    }
    /** The browser is asking for (or waiting on) microphone permission. */
    function showMicWaiting() {
      if (destroyed) return;
      detach();
      visual.innerHTML = '<span class="pte-rec__ring pte-rec__ring--wait"><i></i></span><span class="pte-rec__msg">Waiting for your microphone…</span>';
      announce('waiting', 'Waiting for microphone access');
    }
    /**
     * Shows the waiting state only if a microphone request is still pending after a moment,
     * so an already-allowed microphone never flashes it. Returns the request unchanged; the
     * caller still awaits its own promise and moves on to showRecording or showMicError.
     */
    function waitForMic(request, delayMs = 400) {
      if (destroyed || !request || typeof request.then !== 'function') return request;
      const timer = setTimeout(() => { if (state !== 'recording') showMicWaiting(); }, delayMs);
      const clear = () => clearTimeout(timer);
      request.then(clear, clear);
      return request;
    }
    /** Shows why recording could not start. Accepts an Error or a describeMicError() result. */
    function showMicError(errorOrInfo) {
      if (destroyed) return;
      detach();
      const info = errorOrInfo && errorOrInfo.title && errorOrInfo.detail ? errorOrInfo : describeMicError(errorOrInfo);
      visual.innerHTML = '<span class="pte-rec__ring pte-rec__ring--error">!</span><span class="pte-rec__col"><strong class="pte-rec__error-title"></strong><span class="pte-rec__error-detail"></span></span>';
      visual.querySelector('.pte-rec__error-title').textContent = info.title;
      visual.querySelector('.pte-rec__error-detail').textContent = info.detail;
      announce('error', info.message);
      // Cleared first so a second identical failure is announced again.
      alert.textContent = '';
      setTimeout(() => { if (!destroyed && state === 'error') alert.textContent = info.message; }, 60);
    }
    return { showCountdown, tick, showRecording, setElapsed, attachStream, showComplete, showMicWaiting, showMicError, waitForMic,
      destroy() { destroyed = true; detach(); host.replaceChildren(); }
    };
  }
  const api = { create, formatClock, countdownMessage, barsOn, describeMicError };
  if (typeof window !== 'undefined') window.PteRecorderWidget = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})();
