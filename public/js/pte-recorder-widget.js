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

  /** Presentation only: the owning mode supplies every timing update. Never stops its stream. */
  function create(host, { totalSeconds = 0 } = {}) {
    const visual = document.createElement('div');
    visual.className = 'pte-rec';
    visual.setAttribute('aria-hidden', 'true');
    const status = document.createElement('span');
    status.className = 'pte-sr-only';
    status.setAttribute('role', 'status');
    host.replaceChildren(visual, status);
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
      if (state !== next) status.textContent = message;
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
    return { showCountdown, tick, showRecording, setElapsed, attachStream, showComplete,
      destroy() { destroyed = true; detach(); host.replaceChildren(); }
    };
  }
  const api = { create, formatClock, countdownMessage, barsOn };
  if (typeof window !== 'undefined') window.PteRecorderWidget = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})();
