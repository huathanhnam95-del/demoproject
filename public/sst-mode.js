/* eslint-disable no-console */
(function () {
  'use strict';

  const EXCEL_PATH = '/database/SST/SST/SST.xlsx';
  const MANIFEST_PATH = '/database/SST/audio/manifest.json';
  const MAX_SECONDS = Math.max(1, Number(window.__SST_TEST_DURATION_SECONDS__) || 600);
  const state = {
    initialized: false,
    questions: [],
    manifest: {},
    index: 0,
    selectedAudio: null,
    started: false,
    active: false,
    submitted: false,
    invalidated: false,
    ended: false,
    timerStartedAt: 0,
    timerRunId: 0,
    timerRaf: null,
    feedbackRequestId: 0,
    aiRequestId: 0,
    aiScoring: false,
    submission: null,
    archiveAttemptId: null,
    archiveSavePromise: null,
    scoreFn: null,
    elements: null
  };

  function $(id) { return document.getElementById(id); }
  function escapeHtml(text) {
    return String(text || '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[ch]);
  }
  function newlineToHtml(text) { return escapeHtml(text).replace(/\n/g, '<br>'); }
  function wordCount(text) { return String(text || '').trim().split(/\s+/).filter(Boolean).length; }
  function hasAlphabeticLetter(text) { return /[A-Za-z]/.test(String(text || '')); }
  function isAllCaps(text) {
    const letters = String(text || '').match(/[A-Za-z]/g) || [];
    return letters.length >= 4 && !letters.some((letter) => letter >= 'a' && letter <= 'z');
  }
  function isBulletOnly(text) {
    const nonEmptyLines = String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    return nonEmptyLines.length > 0 && nonEmptyLines.every((line) => /^(?:[-*]|\d+[.)])\s+/.test(line));
  }
  function isVeryShortSentenceOnly(text) {
    const sentences = String(text || '').split(/[.!?]+/).map((part) => part.trim()).filter(Boolean);
    return sentences.length >= 3 && sentences.every((sentence) => wordCount(sentence) <= 4);
  }
  function structurallyUnusable(text) {
    const trimmed = String(text || '').trim();
    return !trimmed || !hasAlphabeticLetter(trimmed) || isAllCaps(trimmed) ||
      !/[.!?]/.test(trimmed) || isBulletOnly(trimmed) || isVeryShortSentenceOnly(trimmed);
  }
  function scoreForm(text) {
    const trimmed = String(text || '').trim();
    const count = wordCount(trimmed);
    if (!trimmed) return { score: 0, detail: 'No response submitted.' };
    if (!hasAlphabeticLetter(trimmed)) return { score: 0, detail: 'Response must contain words.' };
    if (isAllCaps(trimmed)) return { score: 0, detail: 'Response is written entirely in capital letters.' };
    if (!/[.!?]/.test(trimmed)) return { score: 0, detail: 'Response contains no punctuation.' };
    if (isBulletOnly(trimmed)) return { score: 0, detail: 'Response consists only of bullet points.' };
    if (isVeryShortSentenceOnly(trimmed)) return { score: 0, detail: 'Response consists only of very short sentences.' };
    if (count >= 50 && count <= 70) return { score: 2, detail: `${count} words is within the 50-70 target.` };
    if ((count >= 40 && count <= 49) || (count >= 71 && count <= 100)) {
      return { score: 1, detail: `${count} words receives partial Form credit.` };
    }
    return { score: 0, detail: `${count} words is outside the accepted 40-100 range.` };
  }
  function rememberArchiveSave(promise) {
    state.archiveSavePromise = Promise.resolve(promise || null)
      .then((result) => {
        state.archiveAttemptId = result?.attemptId || state.archiveAttemptId;
        return state.archiveAttemptId;
      })
      .catch((error) => {
        console.warn('[PTE Archive] SST save failed:', error);
        return null;
      });
    return state.archiveSavePromise;
  }
  async function ensureArchiveAttemptId() {
    if (state.archiveAttemptId) return state.archiveAttemptId;
    if (state.archiveSavePromise) {
      const attemptId = await state.archiveSavePromise;
      return attemptId || state.archiveAttemptId;
    }
    return null;
  }
  function formatTime(seconds) {
    const value = Math.max(0, Math.floor(seconds));
    return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
  }
  function parseMainPoints(raw) {
    try {
      const parsed = JSON.parse(String(raw || '[]'));
      return Array.isArray(parsed) ? parsed.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 5) : [];
    } catch {
      return [];
    }
  }
  function cacheElements() {
    state.elements = {
      previous: $('sst-prev-btn'),
      next: $('sst-next-btn'),
      select: $('sst-question-select'),
      title: $('sst-question-title'),
      timer: $('sst-timer'),
      play: $('sst-play-btn'),
      playIcon: $('sst-play-icon'),
      playLabel: $('sst-play-label'),
      progress: $('sst-progress-fill'),
      seek: $('sst-seek'),
      audioTime: $('sst-audio-time'),
      volume: $('sst-volume'),
      audio: $('sst-audio-element'),
      audioStatus: $('sst-audio-status'),
      response: $('sst-response'),
      count: $('sst-word-count'),
      submit: $('sst-submit-btn'),
      retry: $('sst-retry-btn'),
      ai: $('sst-ai-score-btn'),
      aiHint: $('sst-ai-hint'),
      results: $('sst-results')
    };
  }
  function getCurrentQuestion() { return state.questions[state.index] || null; }
  function setStatus(message, isError = false) {
    const el = state.elements.audioStatus;
    if (!el) return;
    el.textContent = message;
    el.classList.toggle('is-error', isError);
  }
  function updateCount() {
    if (state.elements.count) state.elements.count.textContent = String(wordCount(state.elements.response?.value || ''));
  }
  function setPlayControl(label, ariaLabel, icon = 'play_arrow') {
    state.elements.playLabel.textContent = label;
    state.elements.playIcon.textContent = icon;
    state.elements.play.setAttribute('aria-label', ariaLabel);
  }
  function setReviewControls(enabled) {
    state.elements.seek.disabled = !enabled;
    state.elements.seek.setAttribute(
      'aria-label',
      enabled ? 'Seek lecture audio for review' : 'Lecture audio timeline; seeking is available after submission'
    );
  }
  function stopTimer() {
    state.timerRunId += 1;
    if (state.timerRaf) cancelAnimationFrame(state.timerRaf);
    state.timerRaf = null;
    state.timerStartedAt = 0;
  }
  function startTimer() {
    stopTimer();
    const runId = state.timerRunId + 1;
    state.timerRunId = runId;
    state.timerStartedAt = performance.now();
    const tick = () => {
      if (runId !== state.timerRunId || !state.active || !state.timerStartedAt) return;
      const remaining = Math.max(0, MAX_SECONDS - (performance.now() - state.timerStartedAt) / 1000);
      state.elements.timer.textContent = formatTime(Math.ceil(remaining));
      state.elements.timer.classList.toggle('is-warning', remaining <= 60);
      if (remaining <= 0) {
        submitAttempt(true);
        return;
      }
      state.timerRaf = requestAnimationFrame(tick);
    };
    state.timerRaf = requestAnimationFrame(tick);
  }
  function resetPlayer() {
    const audio = state.elements.audio;
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    state.elements.progress.style.width = '0';
    state.elements.seek.value = '0';
    state.elements.audioTime.textContent = '00:00 / 00:00';
  }
  function pickAudio(question) {
    const entries = state.manifest[question.id] || [];
    if (!Array.isArray(entries) || entries.length === 0) return null;
    return entries[Math.floor(Math.random() * entries.length)];
  }
  function setNavigationLocked(locked) {
    state.elements.previous.disabled = locked || state.index <= 0;
    state.elements.next.disabled = locked || state.index >= state.questions.length - 1;
    state.elements.select.disabled = locked;
  }
  function resetAttempt({ keepDraft = false } = {}) {
    state.active = false;
    stopTimer();
    resetPlayer();
    state.started = false;
    state.submitted = false;
    state.invalidated = false;
    state.ended = false;
    state.submission = null;
    state.archiveAttemptId = null;
    state.archiveSavePromise = null;
    state.aiScoring = false;
    state.aiRequestId += 1;
    state.feedbackRequestId += 1;
    const question = getCurrentQuestion();
    state.selectedAudio = question ? pickAudio(question) : null;
    if (!keepDraft) state.elements.response.value = '';
    state.elements.response.disabled = false;
    state.elements.timer.textContent = '10:00';
    state.elements.timer.classList.remove('is-warning');
    state.elements.submit.disabled = true;
    setReviewControls(false);
    setPlayControl('Play lecture', 'Play lecture once');
    state.elements.retry.style.display = 'none';
    state.elements.ai.style.display = 'none';
    state.elements.aiHint.style.display = 'none';
    state.elements.results.innerHTML = '';
    setNavigationLocked(false);
    updateCount();
    if (!state.selectedAudio || !question) {
      state.elements.play.disabled = true;
      setStatus('Audio is unavailable for this question. Choose another question or retry.', true);
      return;
    }
    state.elements.audio.src = `/database/SST/audio/${encodeURIComponent(question.id)}/${encodeURIComponent(state.selectedAudio.file)}`;
    state.elements.audio.load();
    state.elements.play.disabled = false;
    setStatus('Select Play when you are ready. Audio plays once.');
  }
  function renderQuestion() {
    const question = getCurrentQuestion();
    if (!question) {
      state.elements.title.textContent = 'No SST questions available';
      return;
    }
    state.elements.title.textContent = `${question.title}`;
    state.elements.select.value = String(state.index);
    resetAttempt();
    if (window.PracticeRouter && window.appState?.currentMode === 'sst') {
      window.PracticeRouter.replaceRoute('sst', question.id);
    }
  }
  function selectQuestion(index) {
    if (state.active) return;
    if (!Number.isInteger(index) || index < 0 || index >= state.questions.length) return;
    state.index = index;
    renderQuestion();
  }
  async function loadQuestionById(questionId) {
    if (state.questions.length === 0) await loadData();
    const index = state.questions.findIndex((question) => String(question.id) === String(questionId));
    selectQuestion(index === -1 ? 0 : index);
  }
  async function loadData() {
    if (typeof XLSX === 'undefined') throw new Error('Spreadsheet support is unavailable.');
    const [workbookResponse, manifestResponse] = await Promise.all([
      fetch(`${EXCEL_PATH}?v=${Date.now()}`),
      fetch(`${MANIFEST_PATH}?v=${Date.now()}`)
    ]);
    if (!workbookResponse.ok) throw new Error(`Question bank could not load (${workbookResponse.status}).`);
    const workbook = XLSX.read(await workbookResponse.arrayBuffer(), { type: 'array' });
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '' });
    state.questions = rows.map((row) => ({
      id: String(row.ID || '').trim(),
      title: String(row.TITLE || '').trim(),
      transcript: String(row.ANSWER || '').trim(),
      mainPoints: parseMainPoints(row.MAIN_POINTS)
    })).filter((question) => question.id && question.title && question.transcript);
    state.manifest = manifestResponse.ok ? await manifestResponse.json() : {};
    state.elements.select.replaceChildren();
    state.questions.forEach((question, index) => {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = `${question.title} (${question.id})`;
      state.elements.select.appendChild(option);
    });
  }
  async function handlePlay() {
    if (state.submitted && !state.invalidated) {
      const audio = state.elements.audio;
      try {
        if (!audio.paused) {
          audio.pause();
          setPlayControl('Resume replay', 'Resume lecture audio review');
          return;
        }
        if (audio.ended || (Number.isFinite(audio.duration) && audio.currentTime >= audio.duration)) {
          audio.currentTime = 0;
          updateAudioProgress();
        }
        audio.volume = Number(state.elements.volume.value);
        await audio.play();
        setPlayControl('Pause replay', 'Pause lecture audio review', 'pause');
        setStatus('Audio review unlocked. Replay or seek through the lecture.');
      } catch (error) {
        console.error('[SST] Review audio playback failed:', error);
        setStatus('Review audio could not be played. Your submitted response and feedback remain available.', true);
      }
      return;
    }
    if (state.started || state.invalidated || !state.selectedAudio) return;
    try {
      state.elements.audio.volume = Number(state.elements.volume.value);
      await state.elements.audio.play();
      state.started = true;
      state.active = true;
      state.elements.play.disabled = true;
      state.elements.submit.disabled = false;
      setNavigationLocked(true);
      setStatus('Listening attempt in progress. Playback is available once only.');
      startTimer();
    } catch (error) {
      console.error('[SST] Audio playback could not start:', error);
      setStatus('Audio could not start. Check the media file and try again.', true);
    }
  }
  function handleAudioFailure() {
    if (state.submitted) {
      state.elements.play.disabled = true;
      setReviewControls(false);
      setStatus('Review audio could not be played. Your submitted response and feedback remain available.', true);
      return;
    }
    if (!state.started) {
      state.elements.play.disabled = true;
      state.elements.retry.style.display = 'inline-flex';
      setStatus('Audio could not load. Retry to begin a fresh attempt.', true);
      return;
    }
    state.active = false;
    state.invalidated = true;
    stopTimer();
    state.elements.submit.disabled = true;
    state.elements.retry.style.display = 'inline-flex';
    state.elements.response.disabled = true;
    setStatus('Audio failed during playback. This attempt is void; retry to begin a fresh attempt.', true);
  }
  function updateAudioProgress() {
    const audio = state.elements.audio;
    if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
    const percentage = Math.min(100, (audio.currentTime / audio.duration) * 100);
    state.elements.progress.style.width = `${percentage}%`;
    state.elements.seek.value = String(percentage);
    state.elements.audioTime.textContent = `${formatTime(audio.currentTime)} / ${formatTime(audio.duration)}`;
  }
  function handleSeek() {
    const audio = state.elements.audio;
    if (!state.submitted || state.invalidated || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
    const percentage = Math.min(100, Math.max(0, Number(state.elements.seek.value) || 0));
    audio.currentTime = (percentage / 100) * audio.duration;
    updateAudioProgress();
  }
  function renderPoints(points) {
    if (!points || points.length === 0) return '';
    return `<div class="sst-points"><h3>Main points for review</h3><ul>${points.map((point) => `<li>${escapeHtml(point)}</li>`).join('')}</ul></div>`;
  }
  function renderRow(label, result, max) {
    const score = Number.isInteger(result?.score) ? `${result.score}/${max}` : 'N/A';
    return `<div class="sst-score-row"><strong>${escapeHtml(label)}</strong><span class="sst-score-badge">${score}</span><span class="sst-score-detail">${escapeHtml(result?.detail || result?.rationale || '')}</span></div>`;
  }
  function renderSubmittedBase(form, basicRows = '') {
    const submission = state.submission;
    if (!submission) return;
    state.elements.results.innerHTML = `
      <div class="sst-submitted"><h3>Your submitted summary</h3><p>${escapeHtml(submission.text || '(No response submitted)')}</p><small>${submission.wordCount} word${submission.wordCount === 1 ? '' : 's'}</small></div>
      <div class="sst-score-grid">${renderRow('Form', form, 2)}${basicRows}</div>
      ${renderPoints(submission.mainPoints)}`;
  }
  function classifyLanguageToolMatch(match) {
    const category = `${match?.rule?.category?.id || ''} ${match?.rule?.category?.name || ''}`.toLowerCase();
    const issue = String(match?.rule?.issueType || '').toLowerCase();
    return issue === 'misspelling' || category.includes('typo') ? 'spelling' : 'grammar';
  }
  async function checkLanguage(text) {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = controller ? setTimeout(() => controller.abort(), 12000) : null;
    try {
      const body = new URLSearchParams({ language: 'en-US', text });
      const response = await fetch('https://api.languagetool.org/v2/check', {
        method: 'POST',
        body,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal: controller?.signal
      });
      if (!response.ok) throw new Error(`LanguageTool HTTP ${response.status}`);
      return { ok: true, matches: (await response.json()).matches || [] };
    } catch (error) {
      console.warn('[SST] Language check unavailable:', error);
      return { ok: false, matches: [] };
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }
  function getProvisionalRows(text, languageResult) {
    if (!languageResult.ok) {
      return renderRow('Provisional Grammar', { detail: 'Language check unavailable.' }, 2) +
        renderRow('Provisional Spelling', { detail: 'Language check unavailable.' }, 2);
    }
    const spellingMatches = languageResult.matches.filter((match) => classifyLanguageToolMatch(match) === 'spelling');
    const grammarMatches = languageResult.matches.filter((match) => classifyLanguageToolMatch(match) === 'grammar');
    const spellingScore = spellingMatches.length === 0 ? 2 : spellingMatches.length === 1 ? 1 : 0;
    const grammarScore = structurallyUnusable(text) ? 0 : grammarMatches.length === 0 ? 2 : 1;
    const correctionText = (matches, fallback) => matches.length
      ? `${matches.length} suggested correction${matches.length === 1 ? '' : 's'}: ${matches.slice(0, 2).map((item) => item.message).join(' | ')}`
      : fallback;
    return renderRow('Provisional Grammar', { score: grammarScore, detail: correctionText(grammarMatches, 'No grammar issues detected.') }, 2) +
      renderRow('Provisional Spelling', { score: spellingScore, detail: correctionText(spellingMatches, 'No spelling issues detected.') }, 2);
  }
  async function submitAttempt(autoSubmitted = false) {
    if (state.submitted || state.invalidated || (!state.started && !autoSubmitted)) return;
    state.active = false;
    state.submitted = true;
    stopTimer();
    state.elements.audio.pause();
    state.elements.audio.currentTime = 0;
    updateAudioProgress();
    const question = getCurrentQuestion();
    const text = state.elements.response.value.trim();
    state.submission = {
      text,
      wordCount: wordCount(text),
      questionId: question?.id || '',
      transcript: question?.transcript || '',
      mainPoints: question?.mainPoints || [],
      audio: state.selectedAudio
    };
    state.archiveAttemptId = null;
    state.archiveSavePromise = null;
    state.elements.response.disabled = true;
    state.elements.submit.disabled = true;
    state.elements.play.disabled = false;
    setReviewControls(true);
    setPlayControl('Replay lecture', 'Replay lecture audio after submission');
    state.elements.retry.style.display = 'inline-flex';
    setNavigationLocked(false);
    setStatus(autoSubmitted ? 'Time expired. Your response was submitted. Audio review is now available.' : 'Response submitted. Review your feedback below or replay the lecture.');
    const form = scoreForm(text);
    renderSubmittedBase(form, renderRow('Provisional Grammar', { detail: 'Checking...' }, 2) + renderRow('Provisional Spelling', { detail: 'Checking...' }, 2));
    rememberArchiveSave(window.PTEAttemptArchive?.saveTextAttempt?.('sst', {
      ...(question || {}),
      audioPath: state.selectedAudio || question?.audioPath || question?.audio || null,
      transcript: question?.transcript || ''
    }, text, {
      form,
      wordCount: state.submission.wordCount,
      autoSubmitted,
      submitted: true
    }, { scoringSource: 'client-form' }));
    if (text) updateAiButton();
    const requestId = ++state.feedbackRequestId;
    const languageResult = await checkLanguage(text);
    if (requestId !== state.feedbackRequestId || !state.submission) return;
    renderSubmittedBase(form, getProvisionalRows(text, languageResult));
  }
  function isGuestMode() { return sessionStorage.getItem('guestMode') === 'true'; }
  function currentUser() { return window.__FIREBASE_INTERNAL__?.auth?.currentUser || window.auth?.currentUser || null; }
  function updateAiButton() {
    if (!state.submission?.text) return;
    state.elements.ai.style.display = 'inline-flex';
    const allowed = Boolean(currentUser()) && !isGuestMode();
    state.elements.ai.disabled = !allowed;
    state.elements.aiHint.style.display = allowed ? 'none' : 'block';
    state.elements.aiHint.textContent = allowed ? '' : 'Log in to get AI practice feedback.';
  }
  async function getScoreFunction() {
    if (state.scoreFn) return state.scoreFn;
    if (window.__FIREBASE_INTERNAL__?.functions) {
      const { httpsCallable } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js');
      state.scoreFn = httpsCallable(window.__FIREBASE_INTERNAL__.functions, 'scoreSST');
      return state.scoreFn;
    }
    if (typeof firebase !== 'undefined' && firebase.functions) {
      state.scoreFn = firebase.functions().httpsCallable('scoreSST');
      return state.scoreFn;
    }
    throw new Error('AI scoring unavailable (Firebase functions not loaded)');
  }
  function postTeacherAdviceToChat(advice) {
    const text = String(advice || '').trim();
    if (!text) return;
    const message = `SST Teacher's Advice:\n${text}`;
    const render = () => {
      const widget = document.querySelector('df-messenger');
      if (widget && typeof widget.renderCustomText === 'function') {
        widget.renderCustomText(message, true);
        return true;
      }
      if (window.BELChatAssistant && typeof window.BELChatAssistant.sendMessage === 'function') {
        window.BELChatAssistant.sendMessage(message);
        return true;
      }
      return false;
    };
    document.querySelector('df-messenger-chat-bubble')?.openChat?.();
    if (!render()) {
      const handler = () => render();
      window.addEventListener('df-messenger-loaded', handler, { once: true });
      window.addEventListener('dfMessengerLoaded', handler, { once: true });
    }
  }
  function renderAiResults(data) {
    const scores = data.scores || {};
    const overall = data.overall || { total: 0, maxTotal: 12, percent: 0 };
    const order = [['content', 'Content', 4], ['form', 'Form', 2], ['grammar', 'Grammar', 2], ['vocabulary', 'Vocabulary', 2], ['spelling', 'Spelling', 2]];
    const rows = order.map(([key, label, max]) => renderRow(label, scores[key] || {}, max)).join('');
    const analysis = data.mainPointsAnalysis || {};
    const analysisHtml = `<div class="sst-points"><h3>Main points analysis</h3>
      ${Array.isArray(analysis.identified) && analysis.identified.length ? `<p><strong>Captured:</strong> ${escapeHtml(analysis.identified.join(' '))}</p>` : ''}
      ${Array.isArray(analysis.missed) && analysis.missed.length ? `<p><strong>Missed:</strong> ${escapeHtml(analysis.missed.join(' '))}</p>` : ''}
      ${analysis.paraphrasingQuality ? `<p><strong>Paraphrasing:</strong> ${escapeHtml(analysis.paraphrasingQuality)}</p>` : ''}</div>`;
    const advice = String(data.teacherAdviceChat || data.teacherAdvice || '').trim();
    state.elements.results.innerHTML = `
      <div class="sst-submitted"><h3>Your submitted summary</h3><p>${escapeHtml(state.submission.text)}</p><small>${state.submission.wordCount} words</small></div>
      <p class="sst-status"><strong>AI practice feedback:</strong> this is not an official PTE score.</p>
      <div class="sst-score-summary"><span class="sst-score-total">${Number(overall.total) || 0}/${Number(overall.maxTotal) || 12}</span><span>${Number(overall.percent) || 0}%</span></div>
      <div class="sst-score-grid">${rows}</div>${analysisHtml}${renderPoints(state.submission.mainPoints)}
      ${advice ? `<div class="sst-advice"><h3>Teacher advice</h3><p>${newlineToHtml(advice)}</p></div>` : ''}`;
    state.elements.ai.style.display = 'none';
    ensureArchiveAttemptId().then((archiveAttemptId) => {
      if (!archiveAttemptId) return;
      window.PTEAttemptArchive?.patchAttempt?.(archiveAttemptId, {
        resultSnapshot: {
          overall,
          scores,
          mainPointsAnalysis: analysis,
          teacherAdvice: data.teacherAdvice || null
        },
        scoringSnapshot: {
          source: 'ai',
          success: data.success === true,
          teacherAdviceChat: data.teacherAdviceChat || null
        }
      }).catch((error) => console.warn('[PTE Archive] SST AI patch failed:', error));
    }).catch((error) => console.warn('[PTE Archive] SST AI patch skipped:', error));
  }
  async function handleAiScore() {
    if (!state.submission?.text || state.aiScoring) return;
    updateAiButton();
    if (state.elements.ai.disabled) return;
    state.aiScoring = true;
    const requestId = ++state.aiRequestId;
    state.elements.ai.disabled = true;
    state.elements.ai.textContent = 'Analyzing...';
    state.elements.aiHint.style.display = 'block';
    state.elements.aiHint.textContent = 'Gemini is preparing AI practice feedback...';
    try {
      const callable = await getScoreFunction();
      const result = await callable({
        text: state.submission.text,
        sourceText: state.submission.transcript,
        mainPoints: state.submission.mainPoints,
        questionId: state.submission.questionId
      });
      if (requestId !== state.aiRequestId) return;
      const data = result.data || {};
      if (data.limited) {
        state.elements.aiHint.textContent = data.message || 'Daily AI practice feedback limit reached.';
        return;
      }
      if (!data.success) throw new Error('AI feedback returned no score.');
      renderAiResults(data);
      state.elements.aiHint.style.display = 'none';
      postTeacherAdviceToChat(data.teacherAdviceChat || data.teacherAdvice);
    } catch (error) {
      console.error('[SST] AI feedback error:', error);
      state.elements.aiHint.textContent = String(error?.code || '').includes('unauthenticated')
        ? 'Log in to get AI practice feedback.'
        : 'AI practice feedback failed. Please try again.';
    } finally {
      if (requestId === state.aiRequestId) {
        state.aiScoring = false;
        state.elements.ai.textContent = 'Get AI practice feedback';
        if (state.elements.ai.style.display !== 'none') updateAiButton();
      }
    }
  }
  function bindEvents() {
    const el = state.elements;
    el.previous.addEventListener('click', () => selectQuestion(state.index - 1));
    el.next.addEventListener('click', () => selectQuestion(state.index + 1));
    el.select.addEventListener('change', () => selectQuestion(Number(el.select.value)));
    el.play.addEventListener('click', handlePlay);
    el.volume.addEventListener('input', () => { el.audio.volume = Number(el.volume.value); });
    el.seek.addEventListener('input', handleSeek);
    el.audio.addEventListener('timeupdate', updateAudioProgress);
    el.audio.addEventListener('loadedmetadata', updateAudioProgress);
    el.audio.addEventListener('error', handleAudioFailure);
    el.audio.addEventListener('ended', () => {
      state.ended = true;
      if (state.submitted) {
        setPlayControl('Replay lecture', 'Replay lecture audio after submission');
        setStatus('Review playback complete. Replay or seek through the lecture again.');
        return;
      }
      setStatus('Audio complete. Finish your summary before time runs out.');
    });
    el.audio.addEventListener('pause', () => {
      if (state.submitted && !state.invalidated && el.audio.currentTime > 0 && !el.audio.ended) {
        setPlayControl('Resume replay', 'Resume lecture audio review');
        return;
      }
      if (state.active && state.started && !state.ended && !state.invalidated) {
        el.audio.play().catch(handleAudioFailure);
      }
    });
    el.response.addEventListener('input', updateCount);
    el.response.addEventListener('paste', (event) => {
      event.preventDefault();
      window.alert('Pasting is not allowed in PTE writing practice.');
    });
    el.submit.addEventListener('click', () => submitAttempt(false));
    el.retry.addEventListener('click', () => resetAttempt());
    el.ai.addEventListener('click', handleAiScore);
  }
  async function activate() {
    if (!state.initialized) {
      cacheElements();
      bindEvents();
      state.initialized = true;
    }
    try {
      if (state.questions.length === 0) await loadData();
      const route = window.PracticeRouter ? window.PracticeRouter.initFromURL() : null;
      if (route && route.mode === 'sst' && route.questionId) {
        await loadQuestionById(route.questionId);
      } else {
        renderQuestion();
      }
    } catch (error) {
      console.error('[SST] Initialization failed:', error);
      state.elements.title.textContent = 'Summarize Spoken Text is unavailable';
      state.elements.play.disabled = true;
      setStatus(error.message || 'Question data could not load.', true);
    }
  }
  function shouldConfirmExit() {
    return !state.submitted && (state.active || Boolean(state.elements?.response?.value.trim()));
  }
  function onExit() {
    state.active = false;
    state.aiRequestId += 1;
    state.feedbackRequestId += 1;
    stopTimer();
    if (state.elements?.audio) state.elements.audio.pause();
  }

  window.SSTMode = {
    activate,
    onExit,
    shouldConfirmExit,
    __debug: { scoreForm, structurallyUnusable }
  };

  window.addEventListener('practice-route-question', async (event) => {
    const { mode, questionId } = event.detail || {};
    if (mode !== 'sst' || !questionId) return;
    await loadQuestionById(questionId);
  });
})();
