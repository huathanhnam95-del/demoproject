(function () {
  'use strict';
  /** Uses the mode's audio element. Reset/destroy cancel any pending countdown or playback. */
  function create(host, { audio }) {
    if (!audio) throw new TypeError('PteAudioBox requires the mode audio element');
    const box = document.createElement('div'); box.className = 'pte-audio';
    box.innerHTML = '<div class="pte-audio__status">Status: <b></b></div><div class="pte-audio__track"><i></i></div><label class="pte-audio__vol">Volume <input type="range" min="0" max="1" step="0.05" aria-label="Volume"></label>';
    const announcement = document.createElement('span');
    announcement.className = 'pte-sr-only';
    announcement.setAttribute('role', 'status');
    announcement.setAttribute('aria-live', 'polite');
    announcement.setAttribute('aria-atomic', 'true');
    host.replaceChildren(box, announcement);
    const status = box.querySelector('b'), fill = box.querySelector('.pte-audio__track i'), volume = box.querySelector('input');
    let destroyed = false, timer, pending, operation = 0;
    const setStatus = (state, text) => {
      if (box.dataset.state !== state) announcement.textContent = text;
      box.dataset.state = state; status.textContent = text;
    };
    const progress = () => { fill.style.width = `${audio.duration > 0 ? Math.min(100, audio.currentTime / audio.duration * 100) : 0}%`; };
    const syncVolume = () => { volume.value = audio.volume; };
    const changeVolume = () => { audio.volume = Number(volume.value); };
    function clearGesture() { box.removeAttribute('role'); box.removeAttribute('tabindex'); }
    function finish(error) {
      clearInterval(timer); timer = null;
      const current = pending; pending = null;
      clearGesture();
      if (current) error ? current.reject(error) : current.resolve();
    }
    function cancel() {
      operation++;
      finish(new DOMException('Audio operation cancelled', 'AbortError'));
      audio.pause();
    }
    function setCompleted() {
      if (destroyed) return;
      setStatus('completed', 'Completed'); fill.style.width = '100%'; finish();
    }
    const ended = () => { if (pending?.type === 'play') setCompleted(); };
    const failed = () => { if (pending?.type === 'play') finish(new Error('Question audio could not be played')); };
    async function startAudio() {
      const token = operation;
      try {
        await audio.play();
        if (token !== operation || destroyed) return;
        clearGesture(); setStatus('playing', 'Playing');
      } catch (error) {
        if (token !== operation || destroyed) return;
        if (error.name !== 'NotAllowedError') { finish(error); return; }
        setStatus('blocked', 'Click to start audio');
        box.setAttribute('role', 'button'); box.tabIndex = 0;
      }
    }
    const gesture = event => {
      if (box.dataset.state !== 'blocked' || event.target === volume) return;
      if (event.type === 'keydown' && !['Enter', ' '].includes(event.key)) return;
      event.preventDefault(); startAudio();
    };
    function play() {
      if (destroyed) return Promise.reject(new DOMException('Audio box destroyed', 'AbortError'));
      cancel();
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
        const update = () => {
          setStatus('countdown', `Beginning in ${remaining} ${remaining === 1 ? 'second' : 'seconds'}`);
          if (remaining <= 0) finish();
          remaining--;
        };
        timer = setInterval(update, 1000); update();
      });
    }
    function reset() {
      cancel(); audio.currentTime = 0; fill.style.width = '0%';
      // Idle is distinct from an actual countdown so its first tick announces
      // the supplied duration, including after a reset of an earlier countdown.
      box.dataset.state = 'idle'; status.textContent = 'Ready';
      announcement.textContent = '';
    }
    audio.addEventListener('timeupdate', progress);
    audio.addEventListener('volumechange', syncVolume);
    audio.addEventListener('ended', ended);
    audio.addEventListener('error', failed);
    volume.addEventListener('input', changeVolume);
    box.addEventListener('click', gesture); box.addEventListener('keydown', gesture);
    syncVolume(); reset();
    return { countdown, play, setCompleted, reset,
      replay() { audio.currentTime = 0; return play(); },
      destroy() {
        destroyed = true; cancel();
        audio.removeEventListener('timeupdate', progress); audio.removeEventListener('volumechange', syncVolume);
        audio.removeEventListener('ended', ended); audio.removeEventListener('error', failed);
        volume.removeEventListener('input', changeVolume);
        box.removeEventListener('click', gesture); box.removeEventListener('keydown', gesture);
        host.replaceChildren();
      }
    };
  }
  window.PteAudioBox = { create };
})();
