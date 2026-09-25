(function () {
  'use strict';
  const local = new Map();
  const mounted = new Set();
  const sessionIds = new Set();
  let player = null;
  const dateOf = value => new Date(value && typeof value === 'object'
    ? (value.seconds ?? value._seconds ?? NaN) * 1000 : value);
  const text = (tag, className, content) => {
    const el = document.createElement(tag); el.className = className; el.textContent = content; return el;
  };
  /** Session-only summaries supplied by guest mode completion; never persists recordings. */
  function recordLocal(summary) {
    if (!summary?.practiceMode) return;
    const row = { ...summary, attemptId: summary.attemptId || `local-${Date.now()}-${Math.random()}`, createdAt: summary.createdAt || new Date().toISOString() };
    local.set(row.attemptId, row); sessionIds.add(row.attemptId);
    mounted.forEach(instance => instance.refresh());
  }
  window.addEventListener('pte-attempt-archive:saved', event => {
    if (event.detail?.attemptId) {
      sessionIds.add(event.detail.attemptId);
      // A saved event may contain only identity. Do not invent scores or audio.
      if (event.detail.practiceMode) local.set(event.detail.attemptId, { ...event.detail, createdAt: new Date().toISOString() });
    }
    mounted.forEach(instance => instance.refresh());
  });
  window.addEventListener('auth-state-changed', () => {
    player?.pause();
    mounted.forEach(instance => instance.refresh());
  });
  function mount(host, options) {
    let all = false, destroyed = false, request = 0, lastPrompt;
    host.classList.add('pte-attempts');
    const header = text('div', 'pte-attempts__header', '');
    const heading = text('h2', '', 'Previous attempts');
    const trend = text('span', 'pte-attempts__trend', '');
    const choices = text('div', 'pte-attempts__scope', '');
    const current = text('button', 'pte-btn', 'This question');
    const every = text('button', 'pte-btn', `All ${options.modeLabel}`);
    current.type = every.type = 'button'; choices.append(current, every);
    header.append(heading, trend, choices);
    const list = text('div', 'pte-attempts__list', '');
    const note = text('p', 'pte-attempts__note', '');
    host.replaceChildren(header, list, note);
    function promptId() {
      const fallback = options.getPromptId?.();
      return window.PTEAttemptArchive?.resolveHistoryQuestionId?.(options.practiceMode, fallback) ?? fallback;
    }
    async function refresh() {
      const id = ++request;
      const prompt = promptId(); lastPrompt = prompt;
      let attempts;
      try { attempts = await window.PTEAttemptArchive?.fetchUserAttemptsCached?.() ?? null; }
      catch (_) {
        if (!destroyed && id === request) note.textContent = 'Could not load previous attempts. Try again later.';
        return;
      }
      if (destroyed || id !== request) return;
      const guest = attempts === null;
      const rows = (guest ? [...local.values()] : attempts).filter(a => a.practiceMode === options.practiceMode)
        .sort((a, b) => dateOf(b.createdAt || b.submittedAt || 0) - dateOf(a.createdAt || a.submittedAt || 0));
      const questionRows = rows.filter(a => {
        const rowId = window.PTEAttemptArchive?.getAttemptPromptId?.(a) ?? a.promptId ?? a.promptSnapshot?.id;
        return prompt != null && rowId != null && String(rowId) === String(prompt);
      });
      current.textContent = `This question · ${questionRows.length}`;
      options.onUpdate?.({ questionCount: questionRows.length, guest });
      current.setAttribute('aria-pressed', String(!all)); every.setAttribute('aria-pressed', String(all));
      const trendText = options.formatTrend?.(questionRows) || '';
      trend.textContent = trendText; trend.hidden = !trendText;
      list.replaceChildren();
      const shown = all ? rows : questionRows;
      shown.forEach(attempt => {
        const row = text('div', 'pte-attempts__row', '');
        row.classList.toggle('is-new', sessionIds.has(attempt.attemptId));
        const date = dateOf(attempt.createdAt || attempt.submittedAt);
        const now = new Date(), yesterday = new Date(); yesterday.setDate(now.getDate() - 1);
        const label = Number.isNaN(date.getTime()) ? '' : now - date < 60000 ? 'Just now'
          : date.toDateString() === yesterday.toDateString() ? 'Yesterday'
          : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
        const when = text('div', 'pte-attempts__when', '');
        when.append(text('strong', '', label), text('small', '', Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })));
        if (sessionIds.has(attempt.attemptId)) when.append(text('span', 'pte-attempts__new', 'New'));
        const scores = text('div', 'pte-attempts__scores', '');
        (options.formatScores?.(attempt) || []).forEach(score => scores.append(text('span', 'pte-attempts__score', score)));
        const secs = Math.floor((Number(attempt.audio?.durationMs) || 0) / 1000);
        const duration = text('span', 'pte-attempts__duration', `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`);
        const play = text('button', 'pte-btn', '▶ Play'); play.type = 'button'; play.disabled = !attempt.audio?.studentUrl;
        play.addEventListener('click', async () => {
          if (!player) player = new Audio();
          player.pause(); player.src = attempt.audio.studentUrl;
          try { await player.play(); } catch (_) { note.textContent = 'This recording could not be played.'; }
        });
        const feedback = text('button', 'pte-btn', 'Open feedback'); feedback.type = 'button';
        feedback.disabled = guest && !attempt.openFeedback;
        feedback.addEventListener('click', () => {
          if (guest) attempt.openFeedback?.();
          else window.dispatchEvent(new CustomEvent('pte-attempt-archive:open', { detail: { attemptId: attempt.attemptId } }));
        });
        row.append(when, scores, duration, play, feedback); list.append(row);
      });
      if (!shown.length) list.append(text('p', 'pte-attempts__empty', 'No attempts for this question yet.'));
      note.textContent = guest ? 'Sign in to keep your attempts. Attempts from this session stay here until you leave the page.'
        : 'Your recordings and scores for this question are kept here after every attempt.';
    }
    current.addEventListener('click', () => { all = false; refresh(); });
    every.addEventListener('click', () => { all = true; refresh(); });
    const instance = { refresh,
      sync() { if (String(promptId()) !== String(lastPrompt)) refresh(); },
      destroy() { destroyed = true; request++; mounted.delete(instance); player?.pause(); host.replaceChildren(); }
    };
    mounted.add(instance); refresh(); return instance;
  }
  window.PteAttemptHistory = { mount, recordLocal };
})();
