// Procedural WebAudio sound generator for Echo Forge
// Clean arcade synthesizer sound palette using native AudioContext

export function createEchoForgeSfx({
  contextFactory = null,
  enabled = true,
  testHooks = null,
} = {}) {
  let audioContext = null;
  let isMuted = !enabled;

  if (typeof window !== 'undefined' && window.matchMedia) {
    try {
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reducedMotion && enabled === true) {
        isMuted = true;
      }
    } catch {
      // media query fallback
    }
  }

  function getContext() {
    if (testHooks?.sfx === null || testHooks?.sfxDisabled === true) {
      return null;
    }
    if (!audioContext) {
      if (contextFactory) {
        audioContext = contextFactory();
      } else if (typeof window !== 'undefined') {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (AudioContextClass) {
          audioContext = new AudioContextClass();
        }
      }
    }
    if (audioContext && audioContext.state === 'suspended') {
      audioContext.resume().catch(() => {});
    }
    return audioContext;
  }

  function playTone({ type = 'square', freq = 440, endFreq = null, duration = 0.08, gain = 0.15 }) {
    const ctx = getContext();
    if (!ctx || isMuted) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, now);
      if (endFreq !== null) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(10, endFreq), now + duration);
      }

      const attackTime = Math.min(0.005, duration * 0.1);
      gainNode.gain.setValueAtTime(0.0001, now);
      gainNode.gain.exponentialRampToValueAtTime(Math.max(0.001, gain), now + attackTime);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, now + duration);

      osc.connect(gainNode);
      gainNode.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + duration);
    } catch {
      // Audio playback best effort
    }
  }

  function playNoise({ duration = 0.04, gain = 0.12 }) {
    const ctx = getContext();
    if (!ctx || isMuted) return;

    try {
      const now = ctx.currentTime;
      const bufferSize = Math.floor(ctx.sampleRate * duration);
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i += 1) {
        data[i] = Math.random() * 2 - 1;
      }

      const noise = ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(800, now);

      const gainNode = ctx.createGain();
      const attackTime = Math.min(0.004, duration * 0.1);
      gainNode.gain.setValueAtTime(0.0001, now);
      gainNode.gain.exponentialRampToValueAtTime(Math.max(0.001, gain), now + attackTime);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, now + duration);

      noise.connect(filter);
      filter.connect(gainNode);
      gainNode.connect(ctx.destination);

      noise.start(now);
      noise.stop(now + duration);
    } catch {
      // Noise playback best effort
    }
  }

  function play(cue) {
    if (isMuted) return;

    switch (cue) {
      case 'hit':
        playTone({ type: 'square', freq: 280, endFreq: 90, duration: 0.08, gain: 0.16 });
        playNoise({ duration: 0.03, gain: 0.1 });
        break;
      case 'crit':
        playTone({ type: 'square', freq: 520, endFreq: 880, duration: 0.12, gain: 0.2 });
        playNoise({ duration: 0.05, gain: 0.14 });
        break;
      case 'burst':
        playTone({ type: 'triangle', freq: 140, endFreq: 45, duration: 0.18, gain: 0.25 });
        playTone({ type: 'square', freq: 660, endFreq: 990, duration: 0.14, gain: 0.18 });
        break;
      case 'block':
        playTone({ type: 'triangle', freq: 220, endFreq: 110, duration: 0.07, gain: 0.18 });
        break;
      case 'parry':
        playTone({ type: 'square', freq: 587, endFreq: 880, duration: 0.09, gain: 0.18 });
        playTone({ type: 'sine', freq: 880, endFreq: 1174, duration: 0.09, gain: 0.14 });
        break;
      case 'focusGain':
        playTone({ type: 'triangle', freq: 659, endFreq: 987, duration: 0.08, gain: 0.15 });
        break;
      case 'resonanceReady':
        playTone({ type: 'triangle', freq: 523, duration: 0.06, gain: 0.15 });
        setTimeout(() => playTone({ type: 'triangle', freq: 659, duration: 0.06, gain: 0.15 }), 50);
        setTimeout(() => playTone({ type: 'square', freq: 784, duration: 0.1, gain: 0.18 }), 100);
        break;
      case 'victory':
        playTone({ type: 'triangle', freq: 440, duration: 0.08, gain: 0.16 });
        setTimeout(() => playTone({ type: 'triangle', freq: 554, duration: 0.08, gain: 0.16 }), 80);
        setTimeout(() => playTone({ type: 'square', freq: 659, duration: 0.18, gain: 0.2 }), 160);
        break;
      case 'defeat':
        playTone({ type: 'sawtooth', freq: 330, endFreq: 220, duration: 0.14, gain: 0.18 });
        setTimeout(() => playTone({ type: 'square', freq: 220, endFreq: 110, duration: 0.22, gain: 0.16 }), 140);
        break;
      default:
        break;
    }
  }

  function setEnabled(flag) {
    isMuted = !flag;
  }

  function isEnabled() {
    return !isMuted;
  }

  function dispose() {
    if (audioContext && typeof audioContext.close === 'function') {
      audioContext.close().catch(() => {});
      audioContext = null;
    }
  }

  return Object.freeze({
    play,
    setEnabled,
    isEnabled,
    dispose,
    getContext: () => getContext(),
  });
}
