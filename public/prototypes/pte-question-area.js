/**
 * PTE question-area prototype (mockup only — not loaded by the app).
 *
 * Swaps ONLY the question area of each practice mode for the PTE test layout:
 * the instruction line, the question content, the blue audio / recorder boxes
 * with their status lines, and the "Time Remaining" timer. Everything else in
 * the mode (picker, steps, Basic/Advanced/Settings, Speech Coach, tips, notes,
 * voice/speed settings, footer buttons, results) is left exactly as it is.
 *
 * Existing question nodes (choices, passages, images, prompts) are moved or
 * restyled rather than rebuilt, so their listeners keep working.
 *
 * Usage (from a browser console or a test): PTEQ.apply('lmcma')
 *   Audio-then-record tasks: PTEQ.phase('speak', 'record') shows a step; PTEQ.run('speak') plays the sequence.
 */
(function () {
  'use strict';

  const CSS = `
  .pteq-hide{display:none!important}
  .pteq-block{font-family:Arial,Helvetica,sans-serif;color:#333;display:flex;flex-direction:column;gap:22px;margin:6px 0 22px;width:100%}
  .pteq-instr{font:15px/1.6 Arial,Helvetica,sans-serif!important;color:#333!important;margin:0!important;font-weight:normal!important;max-width:none}
  .pteq-timer{align-self:flex-end;font:13px Arial,Helvetica,sans-serif;color:#333;margin-bottom:-12px}
  .pteq-timer b{font-weight:bold;font-variant-numeric:tabular-nums}
  .pteq-row{display:flex;gap:24px 36px;flex-wrap:wrap;align-items:flex-start}
  .pteq-row.pteq-center{justify-content:center}
  .pteq-grow{flex:1 1 420px;min-width:0;display:flex;flex-direction:column;gap:10px}
  .pteq-side{flex:0 0 auto;display:flex;flex-direction:column;gap:12px}
  .pteq-box{width:300px;max-width:100%;background:linear-gradient(#36699f,#28598f);border:1px solid #1c4675;color:#fff;padding:14px 20px 16px;border-radius:2px;box-shadow:0 1px 3px rgba(0,0,0,.25);font:14px/1.5 Arial,Helvetica,sans-serif;text-align:left}
  .pteq-box-h{display:flex;justify-content:space-between;align-items:center;font-weight:bold;font-size:15px;margin-bottom:8px}
  .pteq-box-h svg{width:16px;height:16px;fill:#fff}
  .pteq-box b{font-weight:bold}
  .pteq-bar{height:10px;background:#a4bddb;border:1px solid #1c4675;margin-top:12px;overflow:hidden}
  .pteq-bar i{display:block;height:100%;background:#fff}
  .pteq-vol{display:flex;align-items:center;gap:8px;margin-top:12px}
  .pteq-vol svg{width:15px;height:15px;fill:#fff}
  .pteq-vol span{display:block;width:120px;height:4px;background:#fff;border-radius:2px;position:relative}
  .pteq-vol span::after{content:"";position:absolute;right:18px;top:-5px;width:14px;height:14px;border-radius:7px;background:#fff;box-shadow:0 0 0 1px #1c4675}
  .pteq-text,.pteq-text *{font-family:Arial,Helvetica,sans-serif!important}
  .pteq-text{font-size:16px!important;line-height:1.9!important;color:#222!important}
  .pteq-text span{font-size:inherit!important}
  .pteq-text p,.pteq-text .ra-text{font-size:17px!important;line-height:2!important}
  .pteq-plain{border:0!important;background:none!important;box-shadow:none!important;padding:0!important;border-radius:0!important;margin:0!important;min-height:0!important}
  .pteq-q{font:bold 15px/1.55 Arial,Helvetica,sans-serif!important;color:#222!important;margin:0 0 6px!important}
  .pteq-prompt-bold,.pteq-prompt-bold *{font:bold 15px/1.65 Arial,Helvetica,sans-serif!important;color:#222!important;font-style:normal!important}
  /* option lists: plain PTE rows (checkbox / radio + text), yellow when selected */
  .pteq-choices{display:flex!important;flex-direction:column!important;gap:2px!important}
  .pteq-choices > *{background:none!important;border:0!important;box-shadow:none!important;border-radius:0!important;padding:7px 8px!important;margin:0!important;min-height:0!important;transform:none!important}
  .pteq-choices,.pteq-choices *{font-family:Arial,Helvetica,sans-serif!important;font-size:15px!important;line-height:1.5!important;color:#222!important}
  .pteq-choices > *:has(input:checked),.pteq-choices > .selected,.pteq-choices > .is-selected{background:#fff200!important}
  .pteq-people svg{width:150px;height:auto}
  .pteq-in{animation:pteq-in .35s ease-out both}
  @keyframes pteq-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
  .pteq-dot{display:inline-block;width:9px;height:9px;border-radius:5px;background:#ff5a4f;margin-right:6px;animation:pteq-blink 1s steps(2) infinite}
  @keyframes pteq-blink{50%{opacity:.2}}
  @media (prefers-reduced-motion:reduce){.pteq-in,.pteq-dot{animation:none}}
  `;

  const MIC = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-3.1A7 7 0 0 0 19 11h-2z"/></svg>';
  const SPK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z"/></svg>';
  const PEOPLE = '<svg viewBox="0 0 120 100" aria-hidden="true" fill="#222"><circle cx="30" cy="30" r="11"/><path d="M12 72c0-12 8-20 18-20s18 8 18 20z"/><circle cx="90" cy="30" r="11"/><path d="M72 72c0-12 8-20 18-20s18 8 18 20z"/><circle cx="60" cy="48" r="12"/><path d="M40 96c0-13 9-22 20-22s20 9 20 22z"/><path d="M40 6h26a6 6 0 0 1 6 6v10a6 6 0 0 1-6 6H52l-8 7v-7h-4a6 6 0 0 1-6-6V12a6 6 0 0 1 6-6z" fill="#444"/></svg>';

  const INSTR = {
    'read-aloud': 'Look at the text below. In 35 seconds, you must read this text aloud as naturally and clearly as possible. You have 40 seconds to read aloud.',
    speak: 'You will hear a sentence. Please repeat the sentence exactly as you hear it. You will hear the sentence only once.',
    'describe-image': 'Look at the image below. In 25 seconds, please speak into the microphone and describe in detail what the image is showing. You will have 40 seconds to give your response.',
    notes: 'You will hear a lecture. After listening to the lecture, in 10 seconds, please speak into the microphone and retell what you have just heard from the lecture in your own words. You will have 40 seconds to give your response.',
    asq: 'You will hear a question. Please give a simple and short answer. Often just one or a few words is enough.',
    sgd: 'You will hear three people having a discussion. When you hear the beep, summarize the whole discussion. You will have 10 seconds to prepare and 2 minutes to give your response.',
    rts: 'Listen to and read a description of a situation. You will have 20 seconds to think about your answer. Then you will hear a beep. You will have 40 seconds to answer the question. Please answer as completely as you can.',
    essay: 'You will have 20 minutes to plan, write and revise an essay about the topic below. Your response will be judged on how well you develop a position, organize your ideas, present supporting details, and control the elements of standard written English. You should write 200-300 words.',
    swt: 'Read the passage below and summarize it using one sentence. Type your response in the box at the bottom of the screen. You have 10 minutes to finish this task. Your response will be judged on the quality of your writing and on how well your response presents the key points in the passage.',
    sst: 'You will hear a short lecture. Write a summary for a fellow student who was not at the lecture. You should write 50-70 words. You have 10 minutes to finish this task. Your response will be judged on the quality of your writing and on how well your response presents the key points presented in the lecture.',
    lmcma: 'Listen to the recording and answer the question by selecting all the correct responses. You will need to select more than one response.',
    lmcsa: 'Listen to the recording and answer the single-choice question by selecting the correct response. Only one response is correct.',
    extended: 'You will hear a recording. Type the missing words in each blank.',
    hcs: 'You will hear a recording. Click on the paragraph that best relates to the recording.',
    smw: 'You will hear a recording. At the end of the recording the last word or group of words has been replaced by a beep. Select the correct option to complete the recording.',
    hiw: 'You will hear a recording. Below is a transcription of the recording. Some words in the transcription differ from what the speaker(s) said. Please click on the words that are different.',
    type: 'You will hear a sentence. Type the sentence in the box below exactly as you hear it. Write as much of the sentence as you can. You will hear the sentence only once.'
  };

  const $ = (s, r) => (r || document).querySelector(s);
  const hide = (...sels) => sels.forEach((s) => document.querySelectorAll(s).forEach((e) => e.classList.add('pteq-hide')));
  const hideEl = (e) => e && e.classList.add('pteq-hide');
  const add = (sel, ...cls) => document.querySelectorAll(sel).forEach((e) => e.classList.add(...cls));
  const make = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  const secs = (txt, fallback) => { const m = String(txt || '').match(/(\d+):(\d+)/); if (m) return (+m[1]) * 60 + (+m[2]); const n = parseInt(txt, 10); return Number.isFinite(n) ? n : fallback; };
  const byText = (root, tag, re) => [...(root || document).querySelectorAll(tag)].find((e) => re.test(e.textContent));

  const audioBox = (status, pct) => `<div class="pteq-box"><div>Status: <b>${status}</b></div><div class="pteq-bar"><i style="width:${pct || 0}%"></i></div><div class="pteq-vol">${SPK}<span></span></div></div>`;
  const recBox = (status, pct, cls) => `<div class="pteq-box ${cls || ''}"><div class="pteq-box-h">Recorded Answer ${MIC}</div><div>Current Status:</div><div><b>${status}</b></div><div class="pteq-bar"><i style="width:${pct || 0}%"></i></div></div>`;

  /* Audio-then-record tasks: the recorder box only appears once the audio has finished,
     as in the test. prep = seconds between the end of the audio and recording, rec = recording length. */
  const SEQ = {
    speak: { prep: 1, rec: 15 },
    notes: { prep: 10, rec: 40 },
    asq: { prep: 1, rec: 10 },
    sgd: { prep: 10, rec: 120, lead: () => `<div class="pteq-people">${PEOPLE}</div>` },
    rts: { prep: 20, rec: 40 }
  };
  const REC_NOW = '<span class="pteq-dot"></span>Recording...';
  function seqHtml(mode, st) {
    const c = SEQ[mode]; const lead = c.lead ? c.lead() : '';
    switch (st.phase) {
      case 'listen': return lead + audioBox(beginning(st.n));
      case 'playing': return lead + audioBox('Playing', st.pct);
      case 'prep': return lead + audioBox('Completed', 100) + recBox(beginning(st.n), 0, st.fresh ? 'pteq-in' : '');
      case 'record': return lead + audioBox('Completed', 100) + recBox(REC_NOW, st.pct == null ? 30 : st.pct, st.fresh ? 'pteq-in' : '');
      default: return lead + audioBox('Completed', 100) + recBox('Completed', 100);
    }
  }
  const seqRow = (mode, start) => `<div class="pteq-row pteq-center pteq-seq" data-seq="${mode}" data-start="${start}">${seqHtml(mode, { phase: 'listen', n: start })}</div>`;
  const timers = {};
  /** Show one phase statically: 'listen' | 'prep' | 'record' | 'done'. */
  function phase(mode, ph) {
    const el = document.querySelector(`[data-seq="${mode}"]`); if (!el) return false;
    clearInterval(timers[mode]);
    el.innerHTML = seqHtml(mode, { phase: ph, n: ph === 'prep' ? SEQ[mode].prep : +el.dataset.start, fresh: true });
    return true;
  }
  /** Play the whole sequence live: countdown, audio, gap, then the recorder appears and records. */
  function run(mode, opts) {
    const el = document.querySelector(`[data-seq="${mode}"]`); if (!el) return false;
    const c = SEQ[mode]; const audioSecs = (opts && opts.audioSecs) || 6; const recSecs = (opts && opts.recSecs) || c.rec;
    const steps = [['listen', +el.dataset.start], ['playing', audioSecs], ['prep', c.prep], ['record', recSecs]];
    let i = 0, left = steps[0][1], fresh = false;
    clearInterval(timers[mode]);
    const draw = () => {
      const [ph, total] = steps[i];
      const pct = Math.round(((total - left) / total) * 100);
      el.innerHTML = seqHtml(mode, { phase: ph, n: left, pct, fresh });
      fresh = false;
    };
    draw();
    timers[mode] = setInterval(() => {
      left -= 1;
      if (left <= 0) {
        i += 1;
        if (i >= steps.length) { clearInterval(timers[mode]); el.innerHTML = seqHtml(mode, { phase: 'done' }); return; }
        left = steps[i][1]; fresh = steps[i][0] === 'prep';
      }
      draw();
    }, 1000);
    return true;
  }
  const timer = (v) => (v ? `<div class="pteq-timer">Time Remaining <b>${v}</b></div>` : '');
  const block = (mode, inner, t) => make(`<div class="pteq-block" data-pteq="${mode}">${timer(t)}<p class="pteq-instr">${INSTR[mode]}</p>${inner || ''}</div>`);
  const beginning = (n) => `Beginning in ${n} seconds`;

  /* A two-column PTE row whose left column receives moved nodes. */
  function splitRow(leftNodes, rightHtml) {
    const row = make(`<div class="pteq-row"><div class="pteq-grow"></div><div class="pteq-side">${rightHtml}</div></div>`);
    leftNodes.filter(Boolean).forEach((n) => row.firstElementChild.appendChild(n));
    return row;
  }

  function listeningChoice(mode, opts) {
    const split = $(`#mode-${mode} .${mode}-split-layout`);
    if (!split) return;
    const prompt = $(`#${mode}-question-prompt`);
    const choices = $(`#${mode}-choices-container`);
    const b = block(mode);
    if (prompt && !opts.promptIsInstruction) prompt.classList.add('pteq-q');
    if (opts.promptIsInstruction) hideEl(prompt);
    if (choices) choices.classList.add('pteq-choices');
    b.appendChild(splitRow([opts.promptIsInstruction ? null : prompt, choices], audioBox(beginning(3))));
    split.parentNode.insertBefore(b, split);
    hide(`#mode-${mode} .${mode}-card-header`, `#mode-${mode} .${mode}-subtitle`, `#mode-${mode} section.${mode}-audio`);
  }

  const T = {
    'read-aloud'() {
      const stage = $('#ra-prompt-stage');
      const n = secs($('#ra-prep-time') && $('#ra-prep-time').textContent, 35);
      stage.parentNode.insertBefore(block('read-aloud', `<div class="pteq-row pteq-center">${recBox(beginning(n))}</div>`), stage);
      hide('#ra-workspace-instruction', '#ra-status-message');
      stage.classList.add('pteq-plain', 'pteq-text');
      window.dispatchEvent(new Event('resize')); // re-lay the Speech Coach linking arcs on the new line breaks
    },
    speak() {
      const player = $('#mode-speak section.speak-audio');
      player.parentNode.insertBefore(block('speak', seqRow('speak', 3)), player);
      hideEl(player);
    },
    'describe-image'() {
      const step = $('#di-step-prepare');
      const img = $('#di-image-container');
      const zoom = $('#di-zoom-btn');
      const n = secs(($('#di-prep-timer') || {}).textContent, 1);
      const b = block('describe-image');
      const row = splitRow([img, zoom], recBox(beginning(Math.max(0, 25 - n))));
      b.appendChild(row);
      const header = $('.notes-step-header', step);
      step.insertBefore(b, header ? header.nextSibling : step.firstChild);
      hide('#di-prep-timer');
      if (zoom) zoom.style.alignSelf = 'flex-start';
    },
    notes() {
      const player = $('#mode-notes section.notes-audio');
      player.parentNode.insertBefore(block('notes', seqRow('notes', 3)), player);
      hideEl(player); hide('#notes-audio-status');
    },
    asq() {
      const player = $('#mode-asq section.asq-audio');
      player.parentNode.insertBefore(block('asq', seqRow('asq', 3)), player);
      hideEl(player); hide('#asq-status-message');
    },
    sgd() {
      const player = $('#mode-sgd section.sgd-audio');
      player.parentNode.insertBefore(block('sgd', seqRow('sgd', 3)), player);
      hideEl(player); hide('#sgd-audio-status');
    },
    rts() {
      const step = $('#rts-step-audio');
      const prompt = $('#rts-prompt-text');
      const n = secs(($('#rts-audio-countdown-timer') || {}).textContent, 15);
      const b = block('rts');
      prompt.classList.add('pteq-plain', 'pteq-text');
      b.appendChild(prompt);
      b.appendChild(make(seqRow('rts', n)));
      step.insertBefore(b, step.firstChild);
      hide('#rts-audio-countdown-box');
    },
    essay() {
      const step = $('#essay-step-write');
      const t = ($('#essay-timer') || {}).textContent;
      step.insertBefore(block('essay', '', t && t.trim()), step.firstChild);
      hide('#essay-timer');
      add('#essay-prompt-display', 'pteq-plain', 'pteq-prompt-bold');
    },
    swt() {
      const step = $('#swt-step-write');
      const t = ($('#swt-timer') || {}).textContent;
      step.insertBefore(block('swt', '', t && t.trim()), step.firstChild);
      hide('#swt-timer');
      add('#swt-source-display', 'pteq-plain', 'pteq-text');
    },
    sst() {
      const instr = $('#mode-sst .sst-instructions');
      const player = $('#mode-sst section.sst-audio');
      const t = ($('#sst-timer') || {}).textContent;
      const b = block('sst', `<div class="pteq-row pteq-center">${audioBox(beginning(3))}</div>`, t && t.trim());
      instr.parentNode.insertBefore(b, instr);
      hideEl(instr); hideEl(player); hide('#mode-sst .sst-title-row', '#sst-audio-status');
    },
    lmcma() { listeningChoice('lmcma', {}); },
    lmcsa() { listeningChoice('lmcsa', {}); },
    smw() { listeningChoice('smw', { promptIsInstruction: true }); },
    hcs() { listeningChoice('hcs', {}); },
    hiw() {
      const split = $('#mode-hiw .hiw-split-layout');
      split.parentNode.insertBefore(block('hiw', `<div class="pteq-row pteq-center">${audioBox(beginning(3))}</div>`), split);
      hide('#mode-hiw .hiw-card-header', '#mode-hiw section.hiw-audio');
      const helper = byText($('#mode-hiw .hiw-text-card'), 'p,div', /^\s*Identify the words/);
      hideEl(helper);
      add('#hiw-passage-container', 'pteq-text', 'pteq-plain');
      add('#mode-hiw .hiw-text-card', 'pteq-plain');
      const card = $('#hiw-passage-container'); if (card && card.parentElement) card.parentElement.classList.add('pteq-plain');
    },
    extended() {
      const phase = $('#reading-phase');
      const n = secs(($('#reading-timer-display') || {}).textContent, 30);
      phase.parentNode.insertBefore(block('extended', `<div class="pteq-row pteq-center">${audioBox(beginning(n))}</div>`), phase);
      // the "Reading time: N seconds" line and the tip are replaced by the audio box status; Skip stays
      hide('#reading-phase .reading-timer', '#reading-phase .reading-tip');
      add('#reading-phase', 'pteq-plain');
      add('#full-transcript', 'pteq-plain', 'pteq-text');
    },
    type() {
      const player = $('#wfd-play-btn') && $('#wfd-play-btn').closest('section, .practice-audio-player');
      player.parentNode.insertBefore(block('type', `<div class="pteq-row pteq-center">${audioBox(beginning(3))}</div>`), player);
      hideEl(player);
    }
  };

  function apply(mode) {
    if (!document.getElementById('pteq-style')) {
      const s = document.createElement('style'); s.id = 'pteq-style'; s.textContent = CSS; document.head.appendChild(s);
    }
    if (document.querySelector(`[data-pteq="${mode}"]`)) return true;
    if (!T[mode]) throw new Error('No PTE layout for ' + mode);
    T[mode]();
    return true;
  }

  window.PTEQ = { apply, phase, run, modes: Object.keys(T), sequenced: Object.keys(SEQ) };
})();
