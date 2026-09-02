/**
 * Echo Forge — State Machine (Static Prototype)
 * Cycles through all 21 contract events with visual treatments.
 * Uses static fallbacks only — no production animation timings.
 */

const CONTRACT_EVENTS = [
  'sandbox.setup.completed',
  'combat.started',
  'player.action.selected',
  'recording.started',
  'recording.stopped',
  'analysis.pending',
  'analysis.resolved',
  'analysis.noop',
  'player.attack.resolved',
  'enemy.intent.presented',
  'player.block.resolved',
  'player.parry.started',
  'player.parry.resolved',
  'combat.damage.applied',
  'combat.focus.changed',
  'combat.resonance.ready',
  'combat.resonance.consumed',
  'combat.victory',
  'combat.defeat',
  'combat.abandoned',
  'telemetry.exported'
];

/**
 * State definitions mapping each event to visual treatments.
 * Visual layer NEVER calculates damage, reinterprets scores,
 * or infers learner verdicts.
 */
const STATE_MAP = {
  'sandbox.setup.completed': {
    statusText: 'Arena ready',
    statusIcon: '⚔',
    heroHealth: 100,
    enemyHealth: 100,
    focus: 0,
    resonance: 0,
    recording: false,
    heroClass: '',
    enemyClass: '',
    waveformState: 'idle',
    ariaLive: 'polite',
    ariaMessage: 'Arena ready. Choose your action.'
  },
  'combat.started': {
    statusText: 'Combat begins',
    statusIcon: '⚔',
    heroHealth: 100,
    enemyHealth: 100,
    focus: 0,
    resonance: 0,
    recording: false,
    heroClass: '',
    enemyClass: '',
    waveformState: 'idle',
    ariaLive: 'assertive',
    ariaMessage: 'Combat begins.'
  },
  'player.action.selected': {
    statusText: 'Action selected — speak to execute',
    statusIcon: '🎯',
    heroHealth: 100,
    enemyHealth: 100,
    focus: 0,
    resonance: 0,
    recording: false,
    heroClass: '',
    enemyClass: '',
    waveformState: 'idle',
    ariaLive: 'polite',
    ariaMessage: 'Action selected. Speak to execute.'
  },
  'recording.started': {
    statusText: 'Recording — speak now',
    statusIcon: '🎙',
    heroHealth: 100,
    enemyHealth: 100,
    focus: 0,
    resonance: 0,
    recording: true,
    heroClass: 'speaking',
    enemyClass: 'telegraph',
    waveformState: 'recording',
    ariaLive: 'assertive',
    ariaMessage: 'Recording started. Speak now.'
  },
  'recording.stopped': {
    statusText: 'Recording stopped',
    statusIcon: '⏹',
    heroHealth: 100,
    enemyHealth: 100,
    focus: 0,
    resonance: 0,
    recording: false,
    heroClass: '',
    enemyClass: '',
    waveformState: 'idle',
    ariaLive: 'polite',
    ariaMessage: 'Recording stopped.'
  },
  'analysis.pending': {
    statusText: 'Analyzing pronunciation…',
    statusIcon: '◐',
    heroHealth: 100,
    enemyHealth: 100,
    focus: 0,
    resonance: 0,
    recording: false,
    heroClass: 'listening',
    enemyClass: 'waiting',
    waveformState: 'analyzing',
    ariaLive: 'polite',
    ariaMessage: 'Analyzing pronunciation...'
  },
  'analysis.resolved': {
    statusText: 'Analysis complete — attack resolved',
    statusIcon: '✓',
    heroHealth: 100,
    enemyHealth: 80,
    focus: 1,
    resonance: 1,
    recording: false,
    heroClass: 'attacking',
    enemyClass: 'hit',
    waveformState: 'idle',
    resultFlash: 'success',
    ariaLive: 'assertive',
    ariaMessage: 'Analysis complete. Attack resolved.'
  },
  'analysis.noop': {
    statusText: 'Analysis unavailable — no combat judgment was made',
    statusIcon: '⚠',
    heroHealth: 100,
    enemyHealth: 100,
    focus: 0,
    resonance: 0,
    recording: false,
    heroClass: '',
    enemyClass: '',
    waveformState: 'idle',
    ariaLive: 'assertive',
    ariaMessage: 'Analysis unavailable. No combat judgment was made.'
  },
  'player.attack.resolved': {
    statusText: 'Precision Strike!',
    statusIcon: '⚡',
    heroHealth: 100,
    enemyHealth: 70,
    focus: 2,
    resonance: 1,
    recording: false,
    heroClass: 'attacking',
    enemyClass: 'hit',
    waveformState: 'idle',
    resultFlash: 'success',
    ariaLive: 'assertive',
    ariaMessage: 'Precision Strike hit!'
  },
  'enemy.intent.presented': {
    statusText: 'Enemy preparing attack…',
    statusIcon: '⚠',
    heroHealth: 100,
    enemyHealth: 70,
    focus: 2,
    resonance: 1,
    recording: false,
    heroClass: '',
    enemyClass: 'telegraph',
    waveformState: 'idle',
    ariaLive: 'polite',
    ariaMessage: 'Enemy preparing attack.'
  },
  'player.block.resolved': {
    statusText: 'Stress Breaker — blocked!',
    statusIcon: '🛡',
    heroHealth: 100,
    enemyHealth: 70,
    focus: 2,
    resonance: 2,
    recording: false,
    heroClass: 'guarding',
    enemyClass: 'deflected',
    waveformState: 'idle',
    resultFlash: 'success',
    ariaLive: 'assertive',
    ariaMessage: 'Block successful.'
  },
  'player.parry.started': {
    statusText: 'Parry wind-up…',
    statusIcon: '↺',
    heroHealth: 100,
    enemyHealth: 70,
    focus: 2,
    resonance: 2,
    recording: false,
    heroClass: 'parrying',
    enemyClass: 'attacking',
    waveformState: 'idle',
    ariaLive: 'polite',
    ariaMessage: 'Parry initiated.'
  },
  'player.parry.resolved': {
    statusText: 'Echo Chain — parried!',
    statusIcon: '🔄',
    heroHealth: 100,
    enemyHealth: 55,
    focus: 3,
    resonance: 3,
    recording: false,
    heroClass: 'parrying',
    enemyClass: 'reflected',
    waveformState: 'idle',
    resultFlash: 'success',
    ariaLive: 'assertive',
    ariaMessage: 'Parry successful.'
  },
  'combat.damage.applied': {
    statusText: 'Damage applied',
    statusIcon: '💥',
    heroHealth: 85,
    enemyHealth: 55,
    focus: 3,
    resonance: 3,
    recording: false,
    heroClass: 'hit',
    enemyClass: '',
    waveformState: 'idle',
    resultFlash: 'failure',
    ariaLive: 'assertive',
    ariaMessage: 'Damage received.'
  },
  'combat.focus.changed': {
    statusText: '+1 Focus',
    statusIcon: '◆',
    heroHealth: 85,
    enemyHealth: 55,
    focus: 4,
    resonance: 3,
    recording: false,
    heroClass: '',
    enemyClass: '',
    waveformState: 'idle',
    ariaLive: 'polite',
    ariaMessage: 'Focus increased to 4.'
  },
  'combat.resonance.ready': {
    statusText: 'Resonance READY',
    statusIcon: '◆◆◆◆◆',
    heroHealth: 85,
    enemyHealth: 55,
    focus: 4,
    resonance: 5,
    recording: false,
    heroClass: 'resonance-ready',
    enemyClass: '',
    waveformState: 'idle',
    ariaLive: 'assertive',
    ariaMessage: 'Resonance fully charged. Ready to burst.'
  },
  'combat.resonance.consumed': {
    statusText: 'Resonance Burst!',
    statusIcon: '✦',
    heroHealth: 85,
    enemyHealth: 25,
    focus: 5,
    resonance: 0,
    recording: false,
    heroClass: 'burst',
    enemyClass: 'hit',
    waveformState: 'idle',
    resultFlash: 'success',
    ariaLive: 'assertive',
    ariaMessage: 'Resonance Burst activated!'
  },
  'combat.victory': {
    statusText: 'Victory! Training complete',
    statusIcon: '🏆',
    heroHealth: 85,
    enemyHealth: 0,
    focus: 5,
    resonance: 0,
    recording: false,
    heroClass: 'victory',
    enemyClass: 'defeated',
    waveformState: 'idle',
    resultFlash: 'success',
    ariaLive: 'assertive',
    ariaMessage: 'Victory! Training complete.'
  },
  'combat.defeat': {
    statusText: 'Defeat — training ended',
    statusIcon: '💀',
    heroHealth: 0,
    enemyHealth: 40,
    focus: 0,
    resonance: 0,
    recording: false,
    heroClass: 'defeated',
    enemyClass: 'victory',
    waveformState: 'idle',
    resultFlash: 'failure',
    ariaLive: 'assertive',
    ariaMessage: 'Defeat. Training ended.'
  },
  'combat.abandoned': {
    statusText: 'Training session ended',
    statusIcon: '🚪',
    heroHealth: 85,
    enemyHealth: 40,
    focus: 0,
    resonance: 0,
    recording: false,
    heroClass: '',
    enemyClass: '',
    waveformState: 'idle',
    ariaLive: 'polite',
    ariaMessage: 'Training session abandoned.'
  },
  'telemetry.exported': {
    statusText: 'Session data exported',
    statusIcon: '📊',
    heroHealth: 85,
    enemyHealth: 40,
    focus: 0,
    resonance: 0,
    recording: false,
    heroClass: '',
    enemyClass: '',
    waveformState: 'idle',
    ariaLive: 'polite',
    ariaMessage: 'Session data exported.'
  }
};

let currentEventIndex = 0;
let waveformInterval = null;

/** Update the entire UI to reflect a given event state */
function applyState(eventName) {
  const state = STATE_MAP[eventName];
  if (!state) return;

  // Status text
  const statusEl = document.getElementById('ef-status');
  statusEl.innerHTML = `<span class="ef-status-icon">${state.statusIcon}</span> ${state.statusText}`;

  // Health bars
  const heroFill = document.getElementById('hero-health-fill');
  const enemyFill = document.getElementById('enemy-health-fill');
  const heroVal = document.getElementById('hero-health-value');
  const enemyVal = document.getElementById('enemy-health-value');

  heroFill.style.width = state.heroHealth + '%';
  enemyFill.style.width = state.enemyHealth + '%';
  heroVal.textContent = state.heroHealth + '/100';
  enemyVal.textContent = state.enemyHealth + '/100';

  // Focus pips
  const focusPips = document.querySelectorAll('.ef-pip--focus');
  focusPips.forEach((pip, i) => {
    pip.classList.toggle('ef-pip--filled', i < state.focus);
  });

  // Resonance pips
  const resPips = document.querySelectorAll('.ef-pip--resonance');
  resPips.forEach((pip, i) => {
    pip.classList.toggle('ef-pip--filled', i < state.resonance);
  });

  // Recording indicator
  const recEl = document.getElementById('ef-rec');
  recEl.classList.toggle('active', state.recording);

  // Mic button
  const micBtn = document.getElementById('ef-mic-btn');
  micBtn.classList.toggle('active', state.recording);

  // Sound waves
  const soundWaves = document.getElementById('ef-sound-waves');
  soundWaves.classList.toggle('active', state.recording || state.heroClass === 'attacking');

  // Waveform
  const waveform = document.getElementById('ef-waveform');
  waveform.className = 'ef-waveform ' + state.waveformState;
  updateWaveform(state.waveformState);

  // Result flash
  const flash = document.getElementById('ef-result-flash');
  flash.className = 'ef-result-flash';
  if (state.resultFlash) {
    flash.classList.add(state.resultFlash);
    setTimeout(() => { flash.className = 'ef-result-flash'; }, 600);
  }

  // ARIA live region
  const liveEl = document.getElementById('ef-aria-live');
  liveEl.setAttribute('aria-live', state.ariaLive);
  liveEl.textContent = state.ariaMessage;

  // Update event selector
  const select = document.getElementById('event-select');
  if (select) select.value = eventName;

  // Update current event display
  const currentEl = document.getElementById('current-event');
  if (currentEl) currentEl.textContent = eventName;
}

/** Update waveform visualization bars */
function updateWaveform(state) {
  const bars = document.querySelectorAll('.ef-waveform-bar');
  if (waveformInterval) {
    clearInterval(waveformInterval);
    waveformInterval = null;
  }

  const isReducedMotion = document.body.classList.contains('reduced-motion');

  if (state === 'idle') {
    bars.forEach(bar => { bar.style.height = '4px'; });
  } else if (state === 'recording' || state === 'analyzing') {
    if (isReducedMotion) {
      // Static waveform snapshot
      bars.forEach((bar, i) => {
        bar.style.height = (8 + Math.abs(Math.sin(i * 0.7)) * 30) + 'px';
      });
    } else {
      // Animated waveform
      waveformInterval = setInterval(() => {
        bars.forEach(bar => {
          bar.style.height = (4 + Math.random() * 40) + 'px';
        });
      }, 100);
    }
  }
}

/** Cycle to next event */
function nextEvent() {
  currentEventIndex = (currentEventIndex + 1) % CONTRACT_EVENTS.length;
  applyState(CONTRACT_EVENTS[currentEventIndex]);
}

/** Cycle to previous event */
function prevEvent() {
  currentEventIndex = (currentEventIndex - 1 + CONTRACT_EVENTS.length) % CONTRACT_EVENTS.length;
  applyState(CONTRACT_EVENTS[currentEventIndex]);
}

/** Initialize on DOM ready */
document.addEventListener('DOMContentLoaded', () => {
  // Populate event selector
  const select = document.getElementById('event-select');
  CONTRACT_EVENTS.forEach(event => {
    const opt = document.createElement('option');
    opt.value = event;
    opt.textContent = event;
    select.appendChild(opt);
  });

  select.addEventListener('change', (e) => {
    currentEventIndex = CONTRACT_EVENTS.indexOf(e.target.value);
    applyState(e.target.value);
  });

  // Navigation buttons
  document.getElementById('btn-prev').addEventListener('click', prevEvent);
  document.getElementById('btn-next').addEventListener('click', nextEvent);

  // Action buttons trigger relevant events
  document.getElementById('btn-attack').addEventListener('click', () => {
    applyState('player.action.selected');
    setTimeout(() => applyState('recording.started'), 500);
  });

  document.getElementById('btn-block').addEventListener('click', () => {
    applyState('enemy.intent.presented');
    setTimeout(() => applyState('player.block.resolved'), 800);
  });

  document.getElementById('btn-parry').addEventListener('click', () => {
    applyState('player.parry.started');
    setTimeout(() => applyState('player.parry.resolved'), 800);
  });

  document.getElementById('ef-mic-btn').addEventListener('click', () => {
    const recEl = document.getElementById('ef-rec');
    if (recEl.classList.contains('active')) {
      applyState('recording.stopped');
      setTimeout(() => applyState('analysis.pending'), 300);
      setTimeout(() => applyState('analysis.resolved'), 2000);
    } else {
      applyState('recording.started');
    }
  });

  // Reduced motion toggle
  document.getElementById('reduced-motion-toggle').addEventListener('change', (e) => {
    document.body.classList.toggle('reduced-motion', e.target.checked);
    // Re-apply current state with new motion setting
    applyState(CONTRACT_EVENTS[currentEventIndex]);
  });

  // Keyboard navigation: Arrow keys to cycle events
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'SELECT') return;
    if (e.key === 'ArrowRight') nextEvent();
    if (e.key === 'ArrowLeft') prevEvent();
  });

  // Initialize with first event
  applyState(CONTRACT_EVENTS[0]);
});
