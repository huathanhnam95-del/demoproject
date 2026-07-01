/**
 * swt-mode.js — Summarize Written Text (SWT) Practice Mode
 *
 * Modeled after write-essay-mode.js with v7 question picker from Read Aloud.
 * Scoring: Content (0-4), Form (0-1), Grammar (0-2), Vocabulary (0-2) = 9 max
 */
/* eslint-disable no-console */
(function () {
  'use strict';

  // ── State ──
  let questions = [];
  let currentIndex = 0;
  let timerRAF = null;
  let timerStartedAt = null;
  let timerRunId = 0;
  let isWriting = false;
  let isAiScoring = false;
  let activeAiRequestId = 0;
  let pickerOpen = false;
  let lastSubmittedSummaryText = '';
  let lastSubmittedWordCount = 0;
  let lastSubmittedFormResult = null;
  let lastSubmittedQuestion = null;
  let lastArchiveAttemptId = null;
  let lastArchiveSavePromise = null;
  let hasAiScoreResult = false;
  let scoreSWTFn = null;
  let authStateRefreshBound = false;
  const MAX_SWT_SECONDS = 600;

  // ── DOM Cache (populated once in init) ──
  const $ = (id) => document.getElementById(id);
  let d = null;

  function cacheDom() {
    d = {
      panel: $('mode-swt'),
      infoBox: $('swt-info-box'),
      // v7 picker
      prevBtn: $('swt-v7-prev-btn'),
      nextBtn: $('swt-v7-next-btn'),
      questionPill: $('swt-v7-question-pill'),
      backdrop: $('swt-v7-backdrop'),
      sheet: $('swt-v7-sheet'),
      sheetClose: $('swt-v7-sheet-close'),
      jumpSearch: $('swt-v7-jump-search'),
      jumpList: $('swt-v7-jump-list'),
      // Practice area
      startBtn: $('start-swt-btn'),
      practiceArea: $('swt-practice-area'),
      stepWrite: $('swt-step-write'),
      stepResults: $('swt-step-results'),
      timer: $('swt-timer'),
      sourceDisplay: $('swt-source-display'),
      textarea: $('swt-input'),
      wordCount: $('swt-word-count'),
      submitBtn: $('swt-submit-btn'),
      resultsContainer: $('swt-results-container'),
      retryBtn: $('swt-retry-btn'),
      aiScoreBtn: $('swt-ai-score-btn'),
      aiScoreHint: $('swt-ai-score-hint')
    };
  }

  function rememberArchiveSave(promise) {
    lastArchiveSavePromise = Promise.resolve(promise || null)
      .then((result) => {
        lastArchiveAttemptId = result?.attemptId || lastArchiveAttemptId;
        return lastArchiveAttemptId;
      })
      .catch((error) => {
        console.warn('[PTE Archive] SWT save failed:', error);
        return null;
      });
    return lastArchiveSavePromise;
  }

  async function ensureArchiveAttemptId() {
    if (lastArchiveAttemptId) return lastArchiveAttemptId;
    if (lastArchiveSavePromise) {
      const attemptId = await lastArchiveSavePromise;
      return attemptId || lastArchiveAttemptId;
    }
    return null;
  }

  // ── Data Loading ──
  async function loadQuestions() {
    try {
      const res = await fetch(`/database/Summarize Written Text/SWT/swt-questions.json?v=${Date.now()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rawQuestions = await res.json();
      if (!Array.isArray(rawQuestions)) {
        throw new Error('SWT questions payload is not an array');
      }
      questions = rawQuestions
        .map(normalizeQuestion)
        .filter(q => q.id && q.sourceText);
      console.log(`[SWT] Loaded ${questions.length} questions`);
    } catch (err) {
      console.error('[SWT] Failed to load questions:', err);
      questions = [];
    }
  }

  function normalizeQuestion(q) {
    const id = String(q?.id ?? '').trim();
    const title = String(q?.title || `Question ${id || '?'}`).trim();
    const sourceText = String(q?.sourceText || '').trim();
    const mainPoints = Array.isArray(q?.mainPoints)
      ? q.mainPoints.map(p => String(p || '').trim()).filter(Boolean)
      : [];
    return { id, title, sourceText, mainPoints };
  }

  // ── Question Picker (v7 style) ──
  function renderPicker() {
    if (!d || !d.questionPill) return;
    const q = questions[currentIndex];
    d.questionPill.textContent = q ? `#${q.id} — ${q.title}` : 'No SWT questions available';
    setNavigationLocked(isWriting || questions.length === 0);
    if (d.startBtn) d.startBtn.disabled = questions.length === 0;
  }

  function renderJumpList(filter = '') {
    if (!d || !d.jumpList) return;
    const lowerFilter = filter.toLowerCase().trim();
    const items = questions.map((q, i) => {
      if (lowerFilter && !q.title.toLowerCase().includes(lowerFilter) && !q.id.toString().includes(lowerFilter)) {
        return '';
      }
      const isActive = i === currentIndex;
      return `<button class="ra-v7-list-item${isActive ? ' is-active' : ''}" type="button" data-index="${i}" role="option" ${isActive ? 'aria-selected="true"' : ''}>
        <span class="ra-v7-item-id">#${escapeHtml(q.id)}</span>
        <span class="ra-v7-item-title">${escapeHtml(q.title)}</span>
      </button>`;
    }).filter(Boolean);
    d.jumpList.innerHTML = items.length > 0 ? items.join('') : '<div class="ra-v7-empty">No matching questions</div>';
  }

  function openPicker() {
    if (!d || !d.sheet || !d.backdrop || isWriting || questions.length === 0) return;
    pickerOpen = true;
    d.backdrop.classList.add('is-visible');
    d.backdrop.setAttribute('aria-hidden', 'false');
    d.sheet.classList.add('is-open');
    d.sheet.setAttribute('aria-hidden', 'false');
    if (d.questionPill) d.questionPill.setAttribute('aria-expanded', 'true');
    renderJumpList();
    if (d.jumpSearch) { d.jumpSearch.value = ''; d.jumpSearch.focus(); }
  }

  function closePicker() {
    if (!d || !d.sheet || !d.backdrop) return;
    pickerOpen = false;
    d.backdrop.classList.remove('is-visible');
    d.backdrop.setAttribute('aria-hidden', 'true');
    d.sheet.classList.remove('is-open');
    d.sheet.setAttribute('aria-hidden', 'true');
    if (d.questionPill) d.questionPill.setAttribute('aria-expanded', 'false');
  }

  function selectQuestion(index) {
    if (isWriting || index < 0 || index >= questions.length) return;
    currentIndex = index;
    renderPicker();
    renderSource();
    closePicker();

    if (window.PTEAttemptArchive && typeof window.PTEAttemptArchive.updateHistoryUI === 'function') {
      window.PTEAttemptArchive.updateHistoryUI('swt', questions[index]?.id);
    }
  }

  function setNavigationLocked(locked) {
    if (!d) return;
    const hasQuestions = questions.length > 0;
    if (d.prevBtn) d.prevBtn.disabled = locked || currentIndex <= 0;
    if (d.nextBtn) d.nextBtn.disabled = locked || currentIndex >= questions.length - 1;
    if (d.questionPill) d.questionPill.disabled = locked || !hasQuestions;
  }

  // ── Source Text Display ──
  function renderSource() {
    if (!d) return;
    const q = questions[currentIndex];
    if (d.sourceDisplay && q) {
      d.sourceDisplay.innerHTML = `<p>${escapeHtml(q.sourceText).replace(/\n/g, '<br>')}</p>`;
    } else if (d.sourceDisplay) {
      d.sourceDisplay.innerHTML = '<p>SWT questions could not be loaded. Please refresh and try again.</p>';
    }
  }

  // ── Timer ──
  function formatTime(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function startTimer() {
    stopTimer();
    const runId = timerRunId + 1;
    timerRunId = runId;
    timerStartedAt = performance.now();
    if (d.timer) d.timer.textContent = formatTime(MAX_SWT_SECONDS);

    function tick() {
      if (runId !== timerRunId || !timerStartedAt || !isWriting) return;
      const elapsed = (performance.now() - timerStartedAt) / 1000;
      const remaining = Math.max(0, MAX_SWT_SECONDS - elapsed);
      if (d.timer) {
        d.timer.textContent = formatTime(Math.ceil(remaining));
        d.timer.classList.toggle('essay-timer-warning', remaining <= 60);
      }
      if (remaining <= 0) {
        timerRAF = null;
        timerRunId += 1;
        handleSubmit();
        return;
      }
      timerRAF = requestAnimationFrame(tick);
    }
    timerRAF = requestAnimationFrame(tick);
  }

  function stopTimer() {
    timerRunId += 1;
    if (timerRAF) { cancelAnimationFrame(timerRAF); timerRAF = null; }
    timerStartedAt = null;
  }

  // ── Word Count ──
  function getWordCount(text) {
    return text.trim().split(/\s+/).filter(Boolean).length;
  }

  function updateWordCount() {
    if (!d || !d.textarea || !d.wordCount) return;
    const count = getWordCount(d.textarea.value);
    const isGood = count >= 5 && count <= 75;
    const isWarn = count > 0 && (count < 5 || count > 75);
    d.wordCount.textContent = `${count} word${count !== 1 ? 's' : ''}`;
    d.wordCount.className = 'essay-word-count ' + (isGood ? 'essay-wc-good' : isWarn ? 'essay-wc-bad' : '');
  }

  // ── Form Scoring (client-side) ──
  function scoreForm(text) {
    const trimmed = text.trim();
    if (!trimmed) return { score: 0, rationale: 'No text submitted.' };

    const wordCount = getWordCount(trimmed);
    if (wordCount < 5) return { score: 0, rationale: `Too few words (${wordCount}). Minimum is 5.` };
    if (wordCount > 75) return { score: 0, rationale: `Too many words (${wordCount}). Maximum is 75.` };
    if (isAllCaps(trimmed)) return { score: 0, rationale: 'Written entirely in capital letters.' };
    if (!hasAlphabeticLetter(trimmed)) return { score: 0, rationale: 'Response must contain alphabetic words.' };

    if (!startsWithUppercaseLetter(trimmed)) {
      return { score: 0, rationale: 'Sentence should begin with an uppercase letter.' };
    }

    if (/\n/.test(trimmed) || /(^|\n)\s*(?:[-•*]|\d+[.)])\s/.test(trimmed)) {
      return { score: 0, rationale: 'Response contains line breaks, bullet points, or a numbered list.' };
    }

    if (!/\.$/.test(trimmed)) {
      return { score: 0, rationale: 'Sentence must end with a full stop.' };
    }

    const sentenceBody = trimmed.slice(0, -1);
    if (/[.!?]/.test(maskNonSentencePeriods(sentenceBody))) {
      return { score: 0, rationale: 'Multiple sentences or extra sentence-ending punctuation detected.' };
    }

    return { score: 1, rationale: 'Written as one complete sentence within the required word range.' };
  }

  function isAllCaps(text) {
    const letters = text.match(/[A-Za-z]/g) || [];
    if (letters.length < 4) return false;
    return letters.some(ch => ch >= 'A' && ch <= 'Z') && !letters.some(ch => ch >= 'a' && ch <= 'z');
  }

  function hasAlphabeticLetter(text) {
    return /[A-Za-z]/.test(text);
  }

  function startsWithUppercaseLetter(text) {
    const firstLetter = text.match(/[A-Za-z]/);
    return Boolean(firstLetter && firstLetter[0] === firstLetter[0].toUpperCase());
  }

  function maskNonSentencePeriods(text) {
    const abbreviationPattern = /\b(?:Mr|Mrs|Ms|Dr|Prof|Jr|Sr|St|No|vs|etc|approx|dept|govt|Inc|Corp|Ltd|U\.S\.A|U\.S|U\.K|e\.g|i\.e)\./gi;
    return text
      .replace(/\b\d+\.\d+\b/g, match => match.replace(/\./g, ''))
      .replace(/\b(?:[A-Z]\.){2,}/g, match => match.replace(/\./g, ''))
      .replace(/\b[A-Z][a-z]?\.(?:[A-Z][a-z]?\.)+/g, match => match.replace(/\./g, ''))
      .replace(/\b(?:U\.S\.A|U\.S|U\.K|e\.g|i\.e)\b\.?/gi, match => match.replace(/\./g, ''))
      .replace(abbreviationPattern, match => match.replace(/\./g, ''));
  }

  // ── Start Practice ──
  function handleStart() {
    if (!d) return;
    if (isWriting || questions.length === 0 || !questions[currentIndex]) return;
    closePicker();
    isWriting = true;
    activeAiRequestId += 1;
    lastSubmittedSummaryText = '';
    lastSubmittedWordCount = 0;
    lastSubmittedFormResult = null;
    lastSubmittedQuestion = null;
    hasAiScoreResult = false;
    if (d.startBtn) d.startBtn.style.display = 'none';
    const toggleBtn = document.getElementById('swt-history-toggle');
    const historyContainer = document.getElementById('swt-history-container');
    if (toggleBtn) toggleBtn.style.display = 'none';
    if (historyContainer) historyContainer.style.display = 'none';

    if (d.practiceArea) d.practiceArea.style.display = 'block';
    if (d.stepWrite) d.stepWrite.style.display = 'block';
    if (d.stepResults) d.stepResults.style.display = 'none';
    if (d.textarea) { d.textarea.value = ''; d.textarea.disabled = false; d.textarea.focus(); }
    if (d.submitBtn) d.submitBtn.disabled = false;
    if (d.resultsContainer) d.resultsContainer.innerHTML = '';
    if (d.aiScoreBtn) d.aiScoreBtn.style.display = 'none';
    if (d.aiScoreHint) d.aiScoreHint.style.display = 'none';
    updateWordCount();
    startTimer();
    setNavigationLocked(true);
  }

  // ── Submit ──
  function handleSubmit() {
    if (!d) return;
    if (!isWriting) return; // Already submitted or not started
    stopTimer();
    isWriting = false;
    if (d.textarea) d.textarea.disabled = true;
    if (d.submitBtn) d.submitBtn.disabled = true;

    const text = d.textarea ? d.textarea.value.trim() : '';
    if (!text) {
      showResults({ empty: true });
      renderPicker();
      return;
    }

    const formResult = scoreForm(text);
    const wordCount = getWordCount(text);
    showResults({ text, formResult, wordCount });
  }

  // ── Results Display ──
  function showResults({ empty, text, formResult, wordCount }) {
    if (!d) return;
    if (d.stepWrite) d.stepWrite.style.display = 'none';
    if (d.stepResults) d.stepResults.style.display = 'block';

    if (empty) {
      lastSubmittedSummaryText = '';
      lastSubmittedWordCount = 0;
      lastSubmittedFormResult = null;
      lastSubmittedQuestion = null;
      hasAiScoreResult = false;
      if (d.resultsContainer) {
        d.resultsContainer.innerHTML = `
          <div class="essay-submitted">
            <h4>No text submitted</h4>
            <p>You did not write anything. Try again.</p>
          </div>`;
      }
      if (d.aiScoreBtn) d.aiScoreBtn.style.display = 'none';
      return;
    }

    lastSubmittedSummaryText = text;
    lastSubmittedWordCount = wordCount;
    lastSubmittedFormResult = formResult;
    lastSubmittedQuestion = questions[currentIndex] || null;
    lastArchiveAttemptId = null;
    lastArchiveSavePromise = null;
    hasAiScoreResult = false;

    if (d.resultsContainer) {
      d.resultsContainer.innerHTML = `
        ${renderSubmittedSummaryBlockHtml({ summaryText: text, wordCount })}
        <div class="essay-results-breakdown">
          ${renderScoreRow('Form', { score: formResult.score, detail: formResult.rationale }, 1)}
        </div>`;
    }

    if (formResult.score === 0) {
      if (d.aiScoreBtn) d.aiScoreBtn.style.display = 'none';
      if (d.aiScoreHint) {
        d.aiScoreHint.style.display = 'block';
        d.aiScoreHint.textContent = 'Summary does not meet basic form requirements. AI scoring disabled.';
      }
    } else {
      updateAiScoreButtonState();
    }
    rememberArchiveSave(window.PTEAttemptArchive?.saveTextAttempt?.('swt', lastSubmittedQuestion, text, {
      score: formResult.score,
      maxScore: 1,
      form: formResult,
      wordCount
    }, { scoringSource: 'client-form' }));
    renderPicker();
  }

  function isGuestMode() {
    return sessionStorage.getItem('guestMode') === 'true';
  }

  function getCurrentUser() {
    return window.__FIREBASE_INTERNAL__?.auth?.currentUser || window.auth?.currentUser || null;
  }

  function updateAiScoreButtonState() {
    if (!d || !d.aiScoreBtn) return;
    if (!lastSubmittedSummaryText || !lastSubmittedFormResult || lastSubmittedFormResult.score === 0) {
      d.aiScoreBtn.disabled = true;
      return;
    }
    const user = getCurrentUser();
    const allowed = Boolean(user) && !isGuestMode();

    d.aiScoreBtn.disabled = !allowed;
    d.aiScoreBtn.style.display = 'inline-flex';
    d.aiScoreBtn.textContent = 'Submit to AI scoring';

    if (!d.aiScoreHint) return;
    if (allowed) {
      d.aiScoreHint.style.display = 'none';
      d.aiScoreHint.innerHTML = '';
    } else {
      d.aiScoreHint.style.display = 'block';
      d.aiScoreHint.innerHTML = `
        <div class="swt-ai-score-hint-text" style="margin-bottom:8px;font-size:0.9rem;color:var(--text-secondary);">AI scoring requires login.</div>
        <button id="swt-ai-score-login-btn" class="modern-btn modern-btn--hint" type="button">Log in</button>
      `;
      const loginBtn = document.getElementById('swt-ai-score-login-btn');
      if (loginBtn) {
        loginBtn.addEventListener('click', () => {
          if (typeof window.showLoginForm === 'function') {
            window.showLoginForm();
          } else {
            alert('Please log in or sign up to use AI scoring.');
          }
        });
      }
    }
  }

  function escapeHtml(str) {
    const el = document.createElement('span');
    el.textContent = String(str || '');
    return el.innerHTML;
  }

  function newlineToHtml(text) {
    return escapeHtml(text).replace(/\n/g, '<br>');
  }

  function renderSubmittedSummaryBlockHtml({ summaryText, wordCount }) {
    return `
      <div class="essay-submitted">
        <h4>Your Summary</h4>
        <p>${escapeHtml(summaryText)}</p>
        <div class="essay-submitted-meta">${wordCount} word${wordCount !== 1 ? 's' : ''}</div>
      </div>`;
  }

  function renderScoreRow(label, result, maxScore) {
    const score = typeof result?.score === 'number' ? result.score : -1;
    const isUnavailable = score < 0;
    const badgeClass = isUnavailable ? 'essay-score-na' :
      score === maxScore ? 'essay-score-full' :
        score > 0 ? 'essay-score-partial' : 'essay-score-zero';

    return `
      <div class="essay-score-row">
        <div class="essay-score-label">${escapeHtml(label)}</div>
        <div class="essay-score-badge ${badgeClass}">
          ${isUnavailable ? 'N/A' : `${score}/${maxScore}`}
        </div>
        <div class="essay-score-detail">${escapeHtml(result?.detail || '')}</div>
      </div>`;
  }

  async function getScoreSWTFn() {
    if (scoreSWTFn) return scoreSWTFn;
    if (window.__FIREBASE_INTERNAL__ && window.__FIREBASE_INTERNAL__.functions) {
      const { httpsCallable } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js');
      scoreSWTFn = httpsCallable(window.__FIREBASE_INTERNAL__.functions, 'scoreSWT');
      return scoreSWTFn;
    }
    if (typeof firebase !== 'undefined' && firebase.functions) {
      scoreSWTFn = firebase.functions().httpsCallable('scoreSWT');
      return scoreSWTFn;
    }
    throw new Error('AI scoring unavailable (Firebase functions not loaded)');
  }

  // ── AI Scoring ──
  async function handleAIScore() {
    if (!d) return;
    if (isAiScoring) return;
    updateAiScoreButtonState();
    if (d.aiScoreBtn && d.aiScoreBtn.disabled) return;

    const text = lastSubmittedSummaryText || (d.textarea ? d.textarea.value.trim() : '');
    if (!text) return;

    const q = lastSubmittedQuestion || questions[currentIndex];
    if (!q) return;

    isAiScoring = true;
    activeAiRequestId += 1;
    const requestId = activeAiRequestId;

    if (d.aiScoreBtn) { d.aiScoreBtn.disabled = true; d.aiScoreBtn.textContent = 'Scoring…'; }
    if (d.aiScoreHint) { d.aiScoreHint.style.display = 'block'; d.aiScoreHint.textContent = 'AI is analyzing your summary…'; }

    let aiScoreCompleted = false;
    let preserveAiHint = false;
    try {
      const scoreSWTFn = await getScoreSWTFn();

      const result = await scoreSWTFn({
        text,
        sourceText: q.sourceText,
        mainPoints: q.mainPoints || []
      });

      const data = result.data;
      if (requestId !== activeAiRequestId) return;

      if (data.limited) {
        preserveAiHint = true;
        if (d.aiScoreHint) { d.aiScoreHint.textContent = data.message || 'Daily SWT AI scoring limit reached.'; d.aiScoreHint.style.display = 'block'; }
        if (d.aiScoreBtn) { d.aiScoreBtn.textContent = 'Submit to AI scoring'; d.aiScoreBtn.disabled = false; }
        return;
      }

      if (data.success) {
        renderAIResults(data);
        aiScoreCompleted = true;
        // Push to BEL chat
        const teacherAdviceForChat = String(data.teacherAdviceChat || data.teacherAdvice || '').trim();
        if (teacherAdviceForChat) {
          postTeacherAdviceToChat(teacherAdviceForChat);
        }
      } else if (d.aiScoreHint) {
        preserveAiHint = true;
        d.aiScoreHint.textContent = 'AI scoring returned no result. Please try again.';
        d.aiScoreHint.style.display = 'block';
      }
    } catch (err) {
      console.error('[SWT] AI scoring error:', err);
      if (d.aiScoreHint) {
        preserveAiHint = true;
        const code = String(err?.code || '');
        const msg = code.includes('unauthenticated') || err?.message?.includes('unauthenticated')
          ? 'Please log in to use AI scoring.'
          : code.includes('invalid-argument')
            ? (err?.message || 'Summary does not meet SWT form requirements.')
            : 'AI scoring failed. Please try again.';
        d.aiScoreHint.textContent = msg;
        d.aiScoreHint.style.display = 'block';
      }
    } finally {
      if (requestId === activeAiRequestId) {
        isAiScoring = false;
        if (!aiScoreCompleted && preserveAiHint) {
          const allowed = Boolean(getCurrentUser()) && !isGuestMode();
          if (d.aiScoreBtn) {
            d.aiScoreBtn.textContent = 'Submit to AI scoring';
            d.aiScoreBtn.disabled = !allowed;
          }
        } else if (!aiScoreCompleted) {
          updateAiScoreButtonState();
        }
      }
    }
  }

  function renderAIResults(data) {
    if (!d || !d.resultsContainer) return;
    hasAiScoreResult = true;

    const scores = data?.scores && typeof data.scores === 'object' ? data.scores : {};
    const overall = data?.overall && typeof data.overall === 'object'
      ? data.overall
      : { total: 0, maxTotal: 9, percent: 0 };
    const mainPointsAnalysis = data?.mainPointsAnalysis && typeof data.mainPointsAnalysis === 'object'
      ? data.mainPointsAnalysis
      : null;
    const criteriaOrder = [
      { key: 'content', label: 'Content', max: 4 },
      { key: 'form', label: 'Form', max: 1 },
      { key: 'grammar', label: 'Grammar', max: 2 },
      { key: 'vocabulary', label: 'Vocabulary', max: 2 }
    ];

    const breakdownHtml = criteriaOrder.map(c => {
      const s = scores[c.key] || { score: 0, max: c.max, rationale: '', evidence: [], fixTips: [] };
      const evidence = Array.isArray(s.evidence) ? s.evidence : [];
      const fixTips = Array.isArray(s.fixTips) ? s.fixTips : [];
      const detailParts = [];
      if (s.rationale) detailParts.push(String(s.rationale));
      if (fixTips.length > 0) detailParts.push('Fix: ' + fixTips.slice(0, 2).join(' | '));
      if (evidence.length > 0) detailParts.push('Evidence: ' + evidence.slice(0, 1).join(''));
      return renderScoreRow(c.label, {
        score: Number.isFinite(Number(s.score)) ? Number(s.score) : -1,
        detail: detailParts.join(' ')
      }, c.max);
    }).join('');

    let mpHtml = '';
    if (mainPointsAnalysis) {
      const identified = Array.isArray(mainPointsAnalysis.identified) ? mainPointsAnalysis.identified : [];
      const missed = Array.isArray(mainPointsAnalysis.missed) ? mainPointsAnalysis.missed : [];
      const paraphrasingQuality = mainPointsAnalysis.paraphrasingQuality || '';
      mpHtml = `
        <div class="essay-submitted">
          <h4>Main Points Analysis</h4>
          ${identified.length > 0 ? `<p><strong>Captured:</strong> ${escapeHtml(identified.join(' '))}</p>` : ''}
          ${missed.length > 0 ? `<p><strong>Missed:</strong> ${escapeHtml(missed.join(' '))}</p>` : ''}
          ${paraphrasingQuality ? `<p><strong>Paraphrasing:</strong> ${escapeHtml(paraphrasingQuality)}</p>` : ''}
        </div>`;
    }

    const overallPct = Number.isFinite(Number(overall.percent)) ? Number(overall.percent) : 0;
    const overallTotal = Number.isFinite(Number(overall.total)) ? Number(overall.total) : 0;
    const overallMax = Number.isFinite(Number(overall.maxTotal)) ? Number(overall.maxTotal) : 9;
    const teacherAdvice = String(data?.teacherAdviceChat || data?.teacherAdvice || '').trim();
    const teacherAdviceHtml = teacherAdvice ? `
      <div class="essay-submitted">
        <h4>Teacher advice</h4>
        <p>${newlineToHtml(teacherAdvice)}</p>
      </div>` : '';

    d.resultsContainer.innerHTML = `
      ${renderSubmittedSummaryBlockHtml({
        summaryText: lastSubmittedSummaryText || (d.textarea ? d.textarea.value.trim() : ''),
        wordCount: lastSubmittedWordCount || getWordCount(lastSubmittedSummaryText || '')
      })}
      <div class="essay-results-summary">
        <div class="essay-results-score-circle">
          <span class="essay-score-number">${overallTotal}</span>
          <span class="essay-score-divider">/</span>
          <span class="essay-score-total">${overallMax}</span>
        </div>
        <div class="essay-results-percentage">${overallPct}%</div>
      </div>
      <div class="essay-results-breakdown">
        ${breakdownHtml}
      </div>
      ${mpHtml}
      ${teacherAdviceHtml}`;

    if (d.aiScoreBtn) d.aiScoreBtn.style.display = 'none';
    if (d.aiScoreHint) d.aiScoreHint.style.display = 'none';

    ensureArchiveAttemptId().then((archiveAttemptId) => {
      if (!archiveAttemptId) return;
      window.PTEAttemptArchive?.patchAttempt?.(archiveAttemptId, {
        resultSnapshot: {
          overall,
          scores,
          mainPointsAnalysis,
          teacherAdvice: data?.teacherAdvice || null
        },
        scoringSnapshot: {
          source: 'ai',
          success: data?.success === true,
          teacherAdviceChat: data?.teacherAdviceChat || null
        }
      }).catch((error) => console.warn('[PTE Archive] SWT AI patch failed:', error));
    }).catch((error) => console.warn('[PTE Archive] SWT AI patch skipped:', error));
  }

  // ── BEL Chat Integration ──
  function postTeacherAdviceToChat(advice) {
    const text = String(advice || '').trim();
    if (!text) return;

    const message = `SWT Teacher's Advice:\n${text}`;

    const openChat = () => {
      const bubble = document.querySelector('df-messenger-chat-bubble');
      if (bubble && typeof bubble.openChat === 'function') {
        bubble.openChat();
      }
    };

    const render = () => {
      try {
        const chatWidget = document.querySelector('df-messenger');
        if (chatWidget && typeof chatWidget.renderCustomText === 'function') {
          chatWidget.renderCustomText(message, true);
          return true;
        }
        if (window.BELChatAssistant && typeof window.BELChatAssistant.sendMessage === 'function') {
          window.BELChatAssistant.sendMessage(`SWT Teacher Advice: ${text}`);
          return true;
        }
      } catch (err) {
        console.warn('[SWT] Chat integration error:', err);
      }
      return false;
    };

    openChat();
    if (render()) return;

    const handler = () => {
      openChat();
      render();
    };
    window.addEventListener('df-messenger-loaded', handler, { once: true });
    window.addEventListener('dfMessengerLoaded', handler, { once: true });
  }

  // ── Retry ──
  function handleRetry() {
    resetAttempt({ clearDraft: true });
    renderSource();
  }

  function resetAttempt({ clearDraft = true } = {}) {
    if (!d) return;
    stopTimer();
    isWriting = false;
    isAiScoring = false;
    activeAiRequestId += 1;
    lastSubmittedSummaryText = '';
    lastSubmittedWordCount = 0;
    lastSubmittedFormResult = null;
    lastSubmittedQuestion = null;
    hasAiScoreResult = false;
    if (d.stepResults) d.stepResults.style.display = 'none';
    if (d.startBtn) d.startBtn.style.display = 'inline-flex';
    const toggleBtn = document.getElementById('swt-history-toggle');
    if (toggleBtn) toggleBtn.style.display = '';

    if (d.practiceArea) d.practiceArea.style.display = 'none';
    if (d.submitBtn) d.submitBtn.disabled = false;
    if (d.textarea) {
      if (clearDraft) d.textarea.value = '';
      d.textarea.disabled = false;
    }
    if (d.resultsContainer) d.resultsContainer.innerHTML = '';
    if (d.aiScoreBtn) {
      d.aiScoreBtn.style.display = 'none';
      d.aiScoreBtn.disabled = false;
      d.aiScoreBtn.textContent = 'Submit to AI scoring';
    }
    if (d.aiScoreHint) {
      d.aiScoreHint.textContent = '';
      d.aiScoreHint.style.display = 'none';
    }
    // Reset timer display for next attempt
    timerStartedAt = null;
    if (d.timer) {
      d.timer.textContent = formatTime(MAX_SWT_SECONDS);
      d.timer.classList.remove('essay-timer-warning');
    }
    updateWordCount();
    renderPicker();
  }

  function registerAuthStateRefresh() {
    if (authStateRefreshBound) return;
    const register = window.authUI && (
      window.authUI.onAuthStateChanged ||
      window.authUI.onAuthStateChange
    );
    if (typeof register !== 'function') return;

    authStateRefreshBound = true;
    register(() => {
      if (d?.stepResults && d.stepResults.style.display === 'block' && lastSubmittedFormResult?.score === 1 && !hasAiScoreResult) {
        updateAiScoreButtonState();
      }
    });
  }

  // ── Event Binding ──
  function bindEvents() {
    if (!d) return;

    // v7 Picker
    if (d.prevBtn) d.prevBtn.addEventListener('click', () => { if (currentIndex > 0) selectQuestion(currentIndex - 1); });
    if (d.nextBtn) d.nextBtn.addEventListener('click', () => { if (currentIndex < questions.length - 1) selectQuestion(currentIndex + 1); });
    if (d.questionPill) d.questionPill.addEventListener('click', () => { pickerOpen ? closePicker() : openPicker(); });
    if (d.backdrop) d.backdrop.addEventListener('click', closePicker);
    if (d.sheetClose) d.sheetClose.addEventListener('click', closePicker);

    if (d.jumpSearch) {
      d.jumpSearch.addEventListener('input', (e) => renderJumpList(e.target.value));
    }

    if (d.jumpList) {
      d.jumpList.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-index]');
        if (btn) selectQuestion(Number(btn.dataset.index));
      });
    }

    // Practice flow
    if (d.startBtn) d.startBtn.addEventListener('click', handleStart);
    if (d.submitBtn) d.submitBtn.addEventListener('click', handleSubmit);
    if (d.retryBtn) d.retryBtn.addEventListener('click', handleRetry);
    if (d.aiScoreBtn) d.aiScoreBtn.addEventListener('click', handleAIScore);
    if (d.textarea) {
      d.textarea.addEventListener('input', updateWordCount);
      d.textarea.addEventListener('paste', (e) => {
        e.preventDefault();
        alert('Pasting is not allowed in PTE writing practice.');
      });
    }
    if (d.sourceDisplay) {
      d.sourceDisplay.addEventListener('copy', (e) => {
        e.preventDefault();
        alert('Copying is not allowed in PTE practice.');
      });
    }

    // Dismiss info box
    const infoBox = d.infoBox;
    if (infoBox) {
      const closeBtn = infoBox.querySelector('.info-box-close');
      if (closeBtn) {
        closeBtn.addEventListener('click', () => {
          infoBox.style.display = 'none';
          localStorage.setItem('swtInfoDismissed', '1');
        });
      }
      if (localStorage.getItem('swtInfoDismissed') === '1') {
        infoBox.style.display = 'none';
      }
    }
  }

  // ── Init / Enter / Exit ──
  let initialized = false;

  async function init() {
    if (initialized) return;
    initialized = true;
    await loadQuestions();
    cacheDom();
    bindEvents();
    registerAuthStateRefresh();
    renderPicker();
    renderSource();
  }

  async function onEnter() {
    if (!initialized) await init();
    resetAttempt({ clearDraft: true });
    renderPicker();
    renderSource();

    if (window.PTEAttemptArchive && typeof window.PTEAttemptArchive.updateHistoryUI === 'function') {
      window.PTEAttemptArchive.updateHistoryUI('swt', questions[currentIndex]?.id);
    }
  }

  function onExit() {
    resetAttempt({ clearDraft: true });
    closePicker();
  }

  function shouldConfirmExit() {
    return Boolean(isWriting && d?.textarea && d.textarea.value.trim());
  }

  // ── Public API ──
  window.SWTMode = {
    init,
    onEnter,
    onExit,
    shouldConfirmExit,
    __debug: {
      getWordCount,
      scoreForm,
      formatTime
    }
  };
})();
