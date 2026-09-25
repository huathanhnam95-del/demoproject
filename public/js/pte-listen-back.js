/**
 * Shared listen-back player for the PTE speaking shell.
 *
 * Every speaking mode already records into a hidden <audio> element, but none of them
 * showed the learner a player for it: the only control was a "Play" button in the dock,
 * with no progress, no scrub and no duration. This mounts one compact pill - round play
 * button, slim track, m:ss / m:ss - into the card whenever a mode reaches the Complete or
 * Feedback phase, bound to that mode's own recording element.
 *
 * It deliberately owns no mode state. It watches the card's data-pte-phase and the mode
 * panel, so no mode script has to call into it.
 *
 * Read Aloud is not registered here: it already builds a full player of its own
 * (#ra-real-audio-player-wrapper), which the shell reveals in the same phases.
 */
(function () {
  'use strict';

  /** Per mode: the recording elements to try, in preference order, and where to mount. */
  const MODES = {
    speak: {
      audio: ['speak-pte-playback'],
      hosts: { complete: ['#speak-practice-area'] }
    },
    'describe-image': {
      audio: ['di-recording-playback'],
      hosts: { complete: ['#di-pte-stage'] }
    },
    notes: {
      audio: ['notes-v3-student-audio', 'notes-v3-feedback-audio'],
      hosts: { complete: ['#notes-pte-stage'], feedback: ['.notes-fb-left', '.pte-fb__left'] },
      prepend: { feedback: true }
    },
    // sgd-recording-playback is assigned as soon as the recording stops;
    // sgd-v3-student-audio is only filled lazily on first play, so it comes second.
    // In feedback the learner can also hear the discussion again (spec 7.4: "Your recording |
    // Discussion"); the audio box plays it only once, before recording.
    sgd: {
      audio: ['sgd-recording-playback', 'sgd-v3-student-audio'],
      hosts: { complete: ['#sgd-pte-stage'], feedback: ['.sgd-fb-left', '.pte-fb__left'] },
      prepend: { feedback: true },
      alt: { feedback: { label: 'Discussion', noun: 'the discussion', audio: ['sgd-audio'] } }
    },
    asq: {
      audio: ['asq-user-recording-audio'],
      hosts: { complete: ['#asq-pte-stage'] }
    },
    rts: {
      audio: ['rts-v3-playback', 'rts-recording-playback'],
      hosts: { complete: ['#rts-pte-stage'], feedback: ['.pte-fb__left'] },
      prepend: { feedback: true }
    }
  };

  const PHASES = ['complete', 'feedback'];
  const HOST_ID = 'pte-listen-back';

  function fmt(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  function activeModeId() {
    const bar = document.querySelector('.pte-modebar[data-spc-mode]');
    if (bar) return bar.getAttribute('data-spc-mode');
    const panel = document.querySelector('.mode-panel.active[id^="mode-"]');
    return panel ? panel.id.slice('mode-'.length) : null;
  }

  /** The first listed element that actually holds audio. */
  function findRecording(config) {
    for (const id of config.audio) {
      const el = document.getElementById(id);
      if (!el) continue;
      const src = el.currentSrc || el.src || '';
      if (src) return el;
    }
    return null;
  }

  function findHost(config, phase) {
    const card = document.querySelector('.pte-card');
    // No host for a phase means the mode shows its own player there.
    if (!card || !config.hosts[phase]) return null;
    for (const selector of config.hosts[phase]) {
      const el = card.querySelector(selector);
      if (el) return el;
    }
    return card.querySelector('.pte-card__body');
  }

  function build() {
    const row = document.createElement('div');
    row.id = HOST_ID;
    row.className = 'pte-listen pte-listen--back';

    const label = document.createElement('span');
    label.className = 'pte-listen__label';
    label.textContent = 'Your recording';

    // Shown instead of the label when the phase offers a second source.
    const sources = document.createElement('span');
    sources.className = 'pte-listen__sources';
    sources.setAttribute('role', 'group');
    sources.setAttribute('aria-label', 'Listen to');
    sources.hidden = true;
    const yours = document.createElement('button');
    yours.type = 'button';
    yours.textContent = 'Your recording';
    yours.dataset.source = 'yours';
    const other = document.createElement('button');
    other.type = 'button';
    other.dataset.source = 'alt';
    sources.append(yours, other);

    const play = document.createElement('button');
    play.type = 'button';
    play.className = 'pte-listen__play';
    play.setAttribute('aria-label', 'Play your recording');
    play.innerHTML = '<span aria-hidden="true">&#9654;</span>';

    const seek = document.createElement('input');
    seek.type = 'range';
    seek.className = 'pte-listen__seek';
    seek.min = '0';
    seek.max = '100';
    seek.step = '0.1';
    seek.value = '0';
    seek.setAttribute('aria-label', 'Recording timeline');

    const time = document.createElement('span');
    time.className = 'pte-listen__time';
    time.textContent = '00:00 / 00:00';

    row.append(label, sources, play, seek, time);
    return { row, label, sources, yours, other, play, seek, time };
  }

  let ui = null;       // the built DOM, reused across phases
  let bound = null;    // the <audio> currently wired up
  let mountedCard = null;
  let handlers = null; // listeners on `bound`, so they can be detached
  let noun = 'your recording';
  let selected = 'yours'; // 'yours' or 'alt'; back to 'yours' whenever the pill is removed

  function unbind() {
    if (bound && handlers) {
      for (const [type, fn] of Object.entries(handlers)) bound.removeEventListener(type, fn);
    }
    bound = null;
    handlers = null;
  }

  let boundNoun = null;
  function bind(audio) {
    if (bound === audio && boundNoun === noun) {
      handlers?.timeupdate?.();
      return;
    }
    unbind();
    bound = audio;
    boundNoun = noun;

    const sync = () => {
      const dur = Number.isFinite(audio.duration) ? audio.duration : 0;
      ui.time.textContent = fmt(audio.currentTime) + ' / ' + fmt(dur);
      ui.seek.value = dur > 0 ? String((audio.currentTime / dur) * 100) : '0';
    };
    const playing = () => {
      ui.play.innerHTML = '<span aria-hidden="true">&#10073;&#10073;</span>';
      ui.play.setAttribute('aria-label', 'Pause ' + noun);
    };
    const paused = () => {
      ui.play.innerHTML = '<span aria-hidden="true">&#9654;</span>';
      ui.play.setAttribute('aria-label', 'Play ' + noun);
    };
    ui.seek.setAttribute('aria-label', noun === 'your recording' ? 'Recording timeline' : 'Timeline of ' + noun);

    handlers = { timeupdate: sync, loadedmetadata: sync, durationchange: sync, play: playing, pause: paused, ended: paused };
    for (const [type, fn] of Object.entries(handlers)) audio.addEventListener(type, fn);

    ui.play.onclick = () => {
      // Never let two recordings play over each other.
      document.querySelectorAll('audio').forEach(other => { if (other !== audio && !other.paused) other.pause(); });
      if (audio.paused) audio.play().catch(() => { /* autoplay policy or missing src */ });
      else audio.pause();
    };
    ui.seek.oninput = () => {
      const dur = Number.isFinite(audio.duration) ? audio.duration : 0;
      if (dur > 0) audio.currentTime = (Number(ui.seek.value) / 100) * dur;
    };

    audio.paused ? paused() : playing();
    sync();
  }

  function remove() {
    unbind();
    mountedCard?.classList.remove('pte-listen-back-mounted');
    mountedCard = null;
    selected = 'yours';
    document.getElementById(HOST_ID)?.remove();
  }

  /** Label or source switch; returns the <audio> the pill should play. */
  function chooseSource(recording, alt, altAudio) {
    const offered = !!(alt && altAudio);
    if (!offered) selected = 'yours';
    ui.label.hidden = offered;
    ui.sources.hidden = !offered;
    ui.row.classList.toggle('pte-listen--sources', offered);
    if (offered) {
      ui.other.textContent = alt.label;
      [ui.yours, ui.other].forEach(button => {
        button.setAttribute('aria-pressed', String(button.dataset.source === selected));
        button.onclick = () => {
          if (selected === button.dataset.source) return;
          bound?.pause();
          selected = button.dataset.source;
          refresh();
        };
      });
    }
    const useAlt = offered && selected === 'alt';
    noun = useAlt ? (alt.noun || alt.label) : 'your recording';
    return useAlt ? altAudio : recording;
  }

  function refresh() {
    const card = document.querySelector('.pte-card');
    const phase = card?.dataset.ptePhase;
    if (!card || !PHASES.includes(phase)) return remove();

    const modeId = activeModeId();
    const config = MODES[modeId];
    if (!config) return remove();

    const audio = findRecording(config);
    if (!audio) return remove();

    const host = findHost(config, phase);
    if (!host) return remove();

    if (!ui) ui = build();
    // In feedback the pill takes the place of the column's own "Your recording" player.
    const first = !!config.prepend?.[phase];
    if (ui.row.parentElement !== host || (first && host.firstElementChild !== ui.row)) {
      if (first) host.prepend(ui.row); else host.appendChild(ui.row);
    }
    if (mountedCard !== card) mountedCard?.classList.remove('pte-listen-back-mounted');
    mountedCard = card;
    card.classList.add('pte-listen-back-mounted');
    const alt = config.alt?.[phase];
    bind(chooseSource(audio, alt, alt ? findRecording(alt) : null));
  }

  function start() {
    const schedule = (() => {
      let queued = false;
      return () => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => { queued = false; try { refresh(); } catch (_) { /* never break a mode */ } });
      };
    })();

    // The card is recreated per mode, so watch the document for the card arriving, its phase
    // attribute and a recording's src. Class changes are not needed (a mode switch rebuilds the
    // card) and fired constantly during practice - word highlighting toggles classes.
    new MutationObserver(schedule).observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-pte-phase', 'src']
    });
    schedule();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  window.PteListenBack = { refresh, remove };
})();
