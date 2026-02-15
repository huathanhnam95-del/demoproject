(function () {
  'use strict';

  const elements = {
    root: document.getElementById('crm-result-root'),
    subtitle: document.getElementById('crm-result-subtitle'),
    userEmail: document.getElementById('crm-result-user-email'),
    gate: document.getElementById('crm-loading'),
    gateText: document.getElementById('crm-loading-text'),
    gateSubtext: document.getElementById('crm-loading-subtext')
  };

  const urlParams = new URLSearchParams(window.location.search || '');
  const testId = String(urlParams.get('testId') || '').trim();
  const UI_DASH = '—';
  const UI_BULLET = '•';

  document.addEventListener('DOMContentLoaded', () => {
    init().catch((e) => {
      console.error('[EntranceTestResult] init error:', e);
      hideGate();
      renderError(e?.message || 'Failed to load entrance test result.');
    });
  });

  async function init() {
    showGate('Checking admin access…', 'Please wait');
    await initFirebaseFromServer();

    const user = await waitForAuthUser({ timeoutMs: 6500 });
    if (!user) {
      showGate('Please log in as admin first.', 'Redirecting to the app…');
      setTimeout(() => (window.location.href = 'index.html'), 1800);
      return;
    }

    const adminOk = await isAdminUser(user);
    if (!adminOk) {
      showGate('Access denied.', 'Admin privileges required.');
      setTimeout(() => (window.location.href = 'index.html'), 2200);
      return;
    }

    if (elements.userEmail) elements.userEmail.textContent = user.email || '';
    hideGate();

    if (!testId) {
      renderError('Missing testId in URL.');
      return;
    }

    renderLoading();

    const json = await apiFetchJson(`/api/admin/entrance-tests/${encodeURIComponent(testId)}`, { method: 'GET' });
    const test = json.test || {};
    const student = json.student || null;
    const session = json.session || null;

    const audioUrls = await fetchSpeakingAudioUrls(testId, test);
    renderResult({ testId, test, student, session, audioUrls });
  }

  function showGate(text, subtext) {
    if (elements.gateText) elements.gateText.textContent = text || '';
    if (elements.gateSubtext) elements.gateSubtext.textContent = subtext || '';
    if (elements.gate) elements.gate.style.display = 'flex';
  }

  function hideGate() {
    if (elements.gate) elements.gate.style.display = 'none';
  }

  async function initFirebaseFromServer() {
    const res = await fetch('/api/config', { cache: 'no-store' });
    const result = await res.json().catch(() => null);

    if (!res.ok || !result?.success || !result?.config?.apiKey) {
      const msg = result?.message || 'Could not fetch /api/config. Ensure the server is running.';
      throw new Error(msg);
    }

    if (!firebase.apps.length) {
      firebase.initializeApp(result.config);
    }
  }

  function waitForAuthUser({ timeoutMs }) {
    return new Promise((resolve) => {
      let done = false;
      let unsubscribe = () => { };

      const complete = (user) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        unsubscribe();
        resolve(user || null);
      };

      const timer = setTimeout(() => {
        complete(null);
      }, timeoutMs);

      unsubscribe = firebase.auth().onAuthStateChanged((user) => {
        complete(user || null);
      }, () => {
        complete(null);
      });
    });
  }

  async function isAdminUser(user) {
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/admin/status', {
        method: 'GET',
        headers: { Authorization: `Bearer ${idToken}` },
        cache: 'no-store'
      });
      const json = await res.json().catch(() => null);
      return !!(res.ok && json?.success && json?.isAdmin);
    } catch (e) {
      console.warn('[EntranceTestResult] Admin check failed:', e);
      return false;
    }
  }

  async function apiFetchJson(url, options) {
    const user = firebase.auth().currentUser;
    if (!user) throw new Error('Not logged in.');
    const idToken = await user.getIdToken();
    const headers = Object.assign({}, options?.headers || {}, {
      Authorization: `Bearer ${idToken}`
    });
    const res = await fetch(url, Object.assign({}, options || {}, { headers, cache: 'no-store' }));
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.success) {
      const msg = json?.message || `Request failed (${res.status}).`;
      throw new Error(msg);
    }
    return json;
  }

  function renderLoading() {
    if (!elements.root) return;
    elements.root.innerHTML = '<div class="crm-placeholder-card">Loading…</div>';
  }

  function renderError(message) {
    if (!elements.root) return;
    elements.root.innerHTML = `<div class="crm-result-error">${escapeHtml(message || 'Unknown error')}</div>`;
  }

  function setSubtitle(text) {
    if (elements.subtitle) elements.subtitle.textContent = text || '';
  }

  function tsToDate(ts) {
    if (!ts) return null;
    if (typeof ts === 'string') {
      const d = new Date(ts);
      return Number.isFinite(d.getTime()) ? d : null;
    }
    if (typeof ts === 'number') {
      const d = new Date(ts);
      return Number.isFinite(d.getTime()) ? d : null;
    }
    if (typeof ts === 'object') {
      if (typeof ts.toMillis === 'function') return new Date(ts.toMillis());
      if (typeof ts._seconds === 'number') return new Date(ts._seconds * 1000);
      if (typeof ts.seconds === 'number') return new Date(ts.seconds * 1000);
    }
    return null;
  }

  function formatDateTime(ts) {
    const d = tsToDate(ts);
    if (!d) return UI_DASH;
    return d.toLocaleString();
  }

  function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = String(value || '');
    return div.innerHTML;
  }

  function safeLower(value) {
    return String(value || '').trim().toLowerCase();
  }

  function getStatusPill(statusRaw) {
    const status = safeLower(statusRaw) || 'created';
    const label = status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Created';
    return `<span class="crm-test-status ${escapeHtml(status)}">${escapeHtml(label)}</span>`;
  }

  function normalizeScoring(test) {
    const scoring = test?.scoring && typeof test.scoring === 'object' ? test.scoring : null;
    const vocab = scoring?.vocab || null;
    const grammar = scoring?.grammar || null;
    const listenWrite = scoring?.listenWrite || null;
    const overall = scoring?.overall || null;
    return { scoring, vocab, grammar, listenWrite, overall };
  }

  function sumSpeakingAveragePercent(speaking) {
    const entries = speaking && typeof speaking === 'object' ? Object.values(speaking) : [];
    const percents = entries
      .map((e) => (typeof e?.accuracyPercent === 'number' ? e.accuracyPercent : null))
      .filter((n) => typeof n === 'number' && Number.isFinite(n));
    if (percents.length === 0) return null;
    const avg = percents.reduce((a, b) => a + b, 0) / percents.length;
    return Math.round(avg * 10) / 10;
  }

  async function fetchSpeakingAudioUrls(testId, test) {
    const speaking = test?.speaking && typeof test.speaking === 'object' ? test.speaking : {};
    const questionIds = Object.keys(speaking);
    if (questionIds.length === 0) return {};

    const out = {};
    await Promise.all(
      questionIds.map(async (questionId) => {
        const storagePath = speaking?.[questionId]?.audio?.storagePath || null;
        if (!storagePath) return;
        try {
          const json = await apiFetchJson(
            `/api/admin/entrance-tests/${encodeURIComponent(testId)}/speaking/${encodeURIComponent(questionId)}/audio-url`,
            { method: 'GET' }
          );
          if (json?.url) out[questionId] = String(json.url);
        } catch (e) {
          console.warn('[EntranceTestResult] Failed to fetch audio URL:', questionId, e?.message || e);
        }
      })
    );

    return out;
  }

  function buildBlankMapForSection(sectionScoring) {
    const out = new Map();
    const questions = Array.isArray(sectionScoring?.questions) ? sectionScoring.questions : [];
    for (const q of questions) {
      const blanks = Array.isArray(q?.blanks) ? q.blanks : [];
      for (const b of blanks) {
        if (!b?.blankId) continue;
        out.set(String(b.blankId), b);
      }
    }
    return out;
  }

  function renderParagraphFromParts(parts, blankMap) {
    const safeParts = Array.isArray(parts) ? parts : [];
    const chunks = [];
    for (const part of safeParts) {
      if (!part || typeof part !== 'object') continue;
      if (part.type !== 'blank') {
        chunks.push(escapeHtml(part.text || ''));
        continue;
      }
      const blankId = String(part.blankId || '');
      const detail = blankMap?.get ? blankMap.get(blankId) : null;
      const actual = detail?.actual ? String(detail.actual) : '';
      const expected = detail?.expected ? String(detail.expected) : '';
      const isCorrect = detail?.isCorrect === true;
      const isWrong = detail?.isCorrect === false;
      const isUnscored = detail?.scored === false;
      const className = isUnscored ? 'unscored' : (isCorrect ? 'correct' : (isWrong ? 'wrong' : 'empty'));

      let title = '';
      if (isUnscored) title = 'Not scored';
      else if (expected) title = `Expected: ${expected}`;

      const label = actual || UI_DASH;
      chunks.push(
        `<span class="crm-result-blank ${className}" title="${escapeHtml(title)}">${escapeHtml(label)}</span>`
      );
    }
    return chunks.join('');
  }

  function renderQuestionBlanksTable(scoredQuestion) {
    const blanks = Array.isArray(scoredQuestion?.blanks) ? scoredQuestion.blanks : [];
    if (blanks.length === 0) return '';

    const rows = blanks
      .map((b, idx) => {
        const expected = b?.expected ?? null;
        const actual = b?.actual ?? null;
        const scored = b?.scored !== false;
        const correct = b?.isCorrect === true;
        const wrong = b?.isCorrect === false;

        let resultLabel = UI_DASH;
        if (!scored) resultLabel = 'Not scored';
        else if (correct) resultLabel = 'Correct';
        else if (wrong) resultLabel = 'Wrong';

        return `\n          <tr>\n            <td class="td-bold">${idx + 1}</td>\n            <td>${expected ? escapeHtml(expected) : UI_DASH}</td>\n            <td>${actual ? escapeHtml(actual) : UI_DASH}</td>\n            <td>${escapeHtml(resultLabel)}</td>\n          </tr>\n        `;
      })
      .join('');

    return `\n      <div class="crm-result-table-container">\n        <table class="crm-table">\n          <thead>\n            <tr>\n              <th>#</th>\n              <th>Expected</th>\n              <th>Answer</th>\n              <th>Result</th>\n            </tr>\n          </thead>\n          <tbody>\n            ${rows}\n          </tbody>\n        </table>\n      </div>\n    `;
  }

  function findSection(session, id) {
    const sections = Array.isArray(session?.sections) ? session.sections : [];
    return sections.find((s) => String(s?.id || '') === id) || null;
  }

  function findScoredQuestion(sectionScoring, questionId) {
    const questions = Array.isArray(sectionScoring?.questions) ? sectionScoring.questions : [];
    return questions.find((q) => String(q?.questionId || '') === questionId) || null;
  }

  function renderSpeakingSection({ test, session, audioUrls }) {
    const speakingSession = findSection(session, 'speaking');
    const questions = Array.isArray(speakingSession?.questions) ? speakingSession.questions : [];

    const speaking = test?.speaking && typeof test.speaking === 'object' ? test.speaking : {};

    const questionBlocks =
      questions.length > 0
        ? questions
          .map((q, idx) => {
            const qId = String(q.questionId || '');
            const entry = speaking[qId] || null;
            const accuracy = typeof entry?.accuracyPercent === 'number' ? `${entry.accuracyPercent}%` : UI_DASH;
            const transcript = entry?.transcript ? String(entry.transcript) : '';
            const asrError = entry?.asrError ? String(entry.asrError) : '';
            const audioUrl = audioUrls?.[qId] ? String(audioUrls[qId]) : '';
            const expectedText = q?.text ? String(q.text) : '';

            const audioHtml = audioUrl
              ? `<audio class="crm-result-audio" controls src="${escapeHtml(audioUrl)}"></audio>`
              : '<div class="crm-result-muted">Audio not available.</div>';

            const transcriptHtml = transcript
              ? `<div class="crm-result-transcript"><strong>Transcript:</strong>\n${escapeHtml(transcript)}</div>`
              : (asrError
                ? `<div class="crm-result-transcript"><strong>ASR error:</strong>\n${escapeHtml(asrError)}</div>`
                : '<div class="crm-result-muted">Transcript not available.</div>');

            return `\n            <div class="crm-result-question">\n              <div class="crm-result-question-header">\n                <div class="crm-result-question-title">Question ${idx + 1}</div>\n                <div class="crm-result-muted"><strong>Accuracy:</strong> ${escapeHtml(accuracy)}</div>\n              </div>\n              <p class="crm-result-paragraph">${escapeHtml(expectedText)}</p>\n              ${audioHtml}\n              ${transcriptHtml}\n            </div>\n          `;
          })
          .join('')
        : '<div class="crm-result-muted">No speaking questions found for this version.</div>';

    const note = speakingSession?.instructionVi ? String(speakingSession.instructionVi) : '';

    return `\n      <details class="crm-result-details" open>\n        <summary>\n          <span>Speaking (ĐỌC & NÓI)</span>\n          <span class="crm-result-muted">${escapeHtml(questions.length)} questions</span>\n        </summary>\n        <div class="crm-result-details-body">\n          ${note ? `<p class="crm-result-section-note">${escapeHtml(note)}</p>` : ''}\n          ${questionBlocks}\n        </div>\n      </details>\n    `;
  }

  function renderObjectiveSection({ title, sectionId, session, sectionScoring }) {
    const sec = findSection(session, sectionId);
    const questions = Array.isArray(sec?.questions) ? sec.questions : [];
    const blankMap = buildBlankMapForSection(sectionScoring);

    const blocks =
      questions.length > 0
        ? questions
          .map((q, idx) => {
            const qId = String(q.questionId || '');
            const scoredQ = findScoredQuestion(sectionScoring, qId);
            const correct = typeof scoredQ?.correct === 'number' ? scoredQ.correct : 0;
            const total = typeof scoredQ?.total === 'number' ? scoredQ.total : 0;
            const unscored = typeof scoredQ?.unscored === 'number' ? scoredQ.unscored : 0;

            const headerRight =
              sectionId === 'listen_write'
                ? `<div class="crm-result-muted"><strong>Correct:</strong> ${correct}/${total}${unscored ? ` ${UI_BULLET} <strong>Unscored:</strong> ${unscored}` : ''
                }</div>`
                : `<div class="crm-result-muted"><strong>Correct:</strong> ${correct}/${total}</div>`;

            const paragraphHtml = q?.parts
              ? renderParagraphFromParts(q.parts, blankMap)
              : '<span class="crm-result-muted">Question text unavailable.</span>';

            const blanksTable = scoredQ ? renderQuestionBlanksTable(scoredQ) : '';

            return `\n            <div class="crm-result-question">\n              <div class="crm-result-question-header">\n                <div class="crm-result-question-title">Question ${idx + 1}</div>\n                ${headerRight}\n              </div>\n              <p class="crm-result-paragraph">${paragraphHtml}</p>\n              ${blanksTable}\n            </div>\n          `;
          })
          .join('')
        : '<div class="crm-result-muted">No questions found for this section.</div>';

    const note = sec?.instructionVi ? String(sec.instructionVi) : '';

    return `\n      <details class="crm-result-details">\n        <summary>\n          <span>${escapeHtml(title)}</span>\n          <span class="crm-result-muted">${escapeHtml(questions.length)} questions</span>\n        </summary>\n        <div class="crm-result-details-body">\n          ${note ? `<p class="crm-result-section-note">${escapeHtml(note)}</p>` : ''}\n          ${blocks}\n        </div>\n      </details>\n    `;
  }

  function renderResult({ testId, test, student, session, audioUrls }) {
    if (!elements.root) return;

    const status = safeLower(test?.status) || 'created';
    const studentLabel = student?.name ? String(student.name) : (student?.email ? String(student.email) : (student?.phone ? String(student.phone) : 'Student'));
    setSubtitle(`${studentLabel} ${UI_BULLET} ${testId}`);

    const { scoring, vocab, grammar, listenWrite, overall } = normalizeScoring(test);
    const speakingAvg = sumSpeakingAveragePercent(test?.speaking);

    const overallLabel = overall
      ? `${overall.scoredCorrect || 0}/${overall.scoredTotal || 0}`
      : UI_DASH;
    const vocabLabel = vocab ? `${vocab.correctTotal || 0}/${vocab.blanksTotal || 0}` : UI_DASH;
    const grammarLabel = grammar ? `${grammar.correctTotal || 0}/${grammar.blanksTotal || 0}` : UI_DASH;
    const listenWriteLabel = listenWrite ? `${listenWrite.correctTotal || 0}/${listenWrite.blanksTotal || 0}` : UI_DASH;

    const clampPercent = (n) => {
      const num = typeof n === 'number' ? n : Number(n);
      if (!Number.isFinite(num)) return 0;
      return Math.max(0, Math.min(100, num));
    };

    const percentFromFraction = (correct, total) => {
      const c = typeof correct === 'number' ? correct : Number(correct);
      const t = typeof total === 'number' ? total : Number(total);
      if (!Number.isFinite(c) || !Number.isFinite(t) || t <= 0) return null;
      const raw = (c / t) * 100;
      return Math.round(clampPercent(raw) * 10) / 10;
    };

    const formatPercent = (pct) => (pct == null ? UI_DASH : `${pct}%`);

    const overallCorrect = overall?.scoredCorrect || 0;
    const overallTotal = overall?.scoredTotal || 0;
    const overallPct = scoring ? percentFromFraction(overallCorrect, overallTotal) : null;

    const vocabPct = scoring ? percentFromFraction(vocab?.correctTotal || 0, vocab?.blanksTotal || 0) : null;
    const grammarPct = scoring ? percentFromFraction(grammar?.correctTotal || 0, grammar?.blanksTotal || 0) : null;
    const listenWritePct = scoring
      ? percentFromFraction(listenWrite?.correctTotal || 0, listenWrite?.blanksTotal || 0)
      : null;

    const speakingPct = speakingAvg == null ? null : Math.round(clampPercent(speakingAvg) * 10) / 10;
    const speakingSection = findSection(session, 'speaking');
    const speakingExpected = Array.isArray(speakingSection?.questions) ? speakingSection.questions.length : 0;
    const speakingUploaded = test?.speaking && typeof test.speaking === 'object' ? Object.keys(test.speaking).length : 0;
    const speakingBadge = speakingExpected ? `${speakingUploaded}/${speakingExpected}` : (speakingUploaded ? String(speakingUploaded) : UI_DASH);

    const studentCard = `\n      <div class="crm-result-card">\n        <div class="crm-result-card-header">\n          <h3>Student</h3>\n          ${student ? `<span class="crm-result-muted">${escapeHtml(student.id || '')}</span>` : ''}\n        </div>\n        <div class="crm-result-card-body">\n          ${student
      ? `\n            <div class="crm-result-kv">\n              <div class="crm-result-kv-label">Name</div>\n              <div class="crm-result-kv-value">${escapeHtml(student.name || UI_DASH)}</div>\n              <div class="crm-result-kv-label">Phone</div>\n              <div class="crm-result-kv-value">${escapeHtml(student.phone || UI_DASH)}</div>\n              <div class="crm-result-kv-label">Email</div>\n              <div class="crm-result-kv-value">${escapeHtml(student.email || UI_DASH)}</div>\n              ${student.label ? `<div class="crm-result-kv-label">Label</div><div class="crm-result-kv-value">${escapeHtml(student.label)}</div>` : ''}\n              ${student.zalo ? `<div class="crm-result-kv-label">Zalo</div><div class="crm-result-kv-value">${escapeHtml(student.zalo)}</div>` : ''}\n              ${student.facebook ? `<div class="crm-result-kv-label">Facebook</div><div class="crm-result-kv-value">${escapeHtml(student.facebook)}</div>` : ''}\n            </div>\n          `
      : '<div class="crm-result-muted">Student profile not found.</div>'
      }\n        </div>\n      </div>\n    `;

    const metaCard = `\n      <div class="crm-result-card">\n        <div class="crm-result-card-header">\n          <h3>Test</h3>\n          ${getStatusPill(status)}\n        </div>\n        <div class="crm-result-card-body">\n          <div class="crm-result-kv">\n            <div class="crm-result-kv-label">Test ID</div>\n            <div class="crm-result-kv-value">${escapeHtml(testId)}</div>\n            <div class="crm-result-kv-label">Version</div>\n            <div class="crm-result-kv-value">${escapeHtml(test?.version || UI_DASH)}</div>\n            <div class="crm-result-kv-label">Created</div>\n            <div class="crm-result-kv-value">${escapeHtml(formatDateTime(test?.createdAt))}</div>\n            <div class="crm-result-kv-label">Started</div>\n            <div class="crm-result-kv-value">${escapeHtml(formatDateTime(test?.startedAt))}</div>\n            <div class="crm-result-kv-label">Submitted</div>\n            <div class="crm-result-kv-value">${escapeHtml(formatDateTime(test?.submittedAt))}</div>\n          </div>\n        </div>\n      </div>\n    `;

    const summary = `
      <div class="crm-result-summary">
        <div class="crm-scoreboard">
          <div class="crm-score-card crm-score-hero theme-overall">
            <div class="crm-score-top">
              <div>
                <div class="crm-score-label">Overall (Objective)</div>
                <div class="crm-score-value">${escapeHtml(scoring ? overallLabel : UI_DASH)}</div>
                ${scoring ? '' : '<div class="crm-score-sub">Not submitted yet</div>'}
              </div>
              <div class="crm-score-badge">${escapeHtml(formatPercent(overallPct))}</div>
            </div>
            <div class="crm-score-bar" aria-hidden="true">
              <div class="crm-score-bar-fill" style="width:${clampPercent(overallPct || 0)}%"></div>
            </div>
            <div class="crm-score-breakdown">
              <div class="crm-score-break">Vocab <span class="crm-score-break-main">${escapeHtml(vocabLabel)}</span><span class="crm-score-break-sub">${escapeHtml(formatPercent(vocabPct))}</span></div>
              <div class="crm-score-break">Grammar <span class="crm-score-break-main">${escapeHtml(grammarLabel)}</span><span class="crm-score-break-sub">${escapeHtml(formatPercent(grammarPct))}</span></div>
              <div class="crm-score-break">Listen &amp; Write <span class="crm-score-break-main">${escapeHtml(listenWriteLabel)}</span><span class="crm-score-break-sub">${escapeHtml(formatPercent(listenWritePct))}</span></div>
              ${listenWrite?.unscoredTotal ? `<div class="crm-score-break subtle">Unscored <span class="crm-score-break-main">${escapeHtml(String(listenWrite.unscoredTotal))}</span></div>` : ''}
            </div>
          </div>
        </div>
      </div>
    `;


    let detailsHtml = '';
    if (!session) {
      detailsHtml = '<div class="crm-result-error">Session definition missing from server response.</div>';
    } else {
      detailsHtml = [
        renderSpeakingSection({ test, session, audioUrls }),
        scoring
          ? renderObjectiveSection({ title: 'Vocab (TỪ VỰNG)', sectionId: 'vocab', session, sectionScoring: vocab })
          : '<div class="crm-result-muted" style="margin-top:18px;">Objective scoring will appear after submission.</div>',
        scoring
          ? renderObjectiveSection({ title: 'Grammar (NGỮ PHÁP)', sectionId: 'grammar', session, sectionScoring: grammar })
          : '',
        scoring
          ? renderObjectiveSection({ title: 'Nghe & Viết (NGHE & VIẾT)', sectionId: 'listen_write', session, sectionScoring: listenWrite })
          : ''
      ].join('\n');
    }


    // Show export button now that content is rendered
    const exportBtn = document.getElementById('crm-export-pdf-btn');
    if (exportBtn) exportBtn.style.display = '';

    elements.root.innerHTML = `\n      <div class="crm-result-grid">\n        ${studentCard}\n        ${metaCard}\n      </div>\n      ${summary}\n      ${detailsHtml}\n    `;

    // Show export button now that content is rendered
    if (exportBtn) exportBtn.style.display = '';
  }

  /* ── PDF Export ─────────────────────────────────── */
  window.__exportResultPdf = async function () {
    if (typeof html2pdf === 'undefined') {
      alert('PDF library not loaded. Please refresh the page and try again.');
      return;
    }

    const btn = document.getElementById('crm-export-pdf-btn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '⏳ Generating…';
    }

    const container = document.querySelector('.crm-admin');
    if (!container) {
      alert('Nothing to export.');
      if (btn) { btn.disabled = false; btn.textContent = '📄 Export PDF'; }
      return;
    }

    // 1. Expand all <details> and remember which were closed
    const allDetails = container.querySelectorAll('details');
    const closedDetails = [];
    allDetails.forEach((d) => {
      if (!d.open) {
        closedDetails.push(d);
        d.open = true;
      }
    });

    // 2. Hide header actions (buttons) during capture
    const headerActions = container.querySelector('.crm-result-header-actions');
    let headerActionsDisplay = '';
    if (headerActions) {
      headerActionsDisplay = headerActions.style.display;
      headerActions.style.display = 'none';
    }

    // 3. Add export class for print-color-adjust
    container.classList.add('crm-pdf-exporting');

    // 3b. Constrain width to precise A4 printable area
    //     A4 = 210mm width.
    //     Margins = 10mm left + 10mm right = 20mm.
    //     Printable width = 190mm.
    //     190mm @ 96 DPI ~= 718px.
    //     We use 715px to be safe and avoid any partial pixel clipping.
    const origMaxWidth = container.style.maxWidth;
    const origWidth = container.style.width;
    const origMargin = container.style.margin;
    const origPadding = container.style.padding;

    // CRITICAL: Force left-alignment and exact printable width
    container.style.maxWidth = '715px';
    container.style.width = '715px';
    container.style.marginLeft = '0';
    container.style.marginRight = 'auto';
    container.style.padding = '0';

    // 3c. Hide the "Test" card and force 1-column layout
    const grid = container.querySelector('.crm-result-grid');
    let origGridTemplate = '';
    if (grid) {
      origGridTemplate = grid.style.gridTemplateColumns;
      grid.style.gridTemplateColumns = '1fr';

      const cards = grid.querySelectorAll('.crm-result-card');
      if (cards.length > 1) {
        const testCard = cards[1];
        testCard.classList.add('crm-pdf-hide');
      }
    }

    // 4. Add page-break-before markers on each section <details>
    //    Skip the FIRST section to avoid a blank page after the summary.
    const sectionDetails = container.querySelectorAll('.crm-result-details');
    sectionDetails.forEach((d, i) => {
      if (i > 0) d.classList.add('html2pdf__page-break');
    });

    // 5. Hide audio elements (they render as blank blocks in the PDF)
    const audioEls = container.querySelectorAll('audio');
    audioEls.forEach((a) => {
      a.dataset.origDisplay = a.style.display;
      a.style.display = 'none';
    });

    // 6. Add footer
    const footer = document.createElement('div');
    footer.className = 'crm-pdf-footer';
    const now = new Date();
    footer.textContent = `Generated on ${now.toLocaleString()} • BEL Entrance Test`;
    const root = document.getElementById('crm-result-root');
    if (root) root.appendChild(footer);

    // 7. Build filename
    const subtitleEl = document.getElementById('crm-result-subtitle');
    const subtitleText = subtitleEl ? subtitleEl.textContent.trim() : '';
    const studentName = subtitleText.split('•')[0].trim().replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '-') || 'student';
    const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const filename = `entrance-test-${studentName}-${dateStr}.pdf`;

    try {
      const opt = {
        margin: [20, 10, 10, 10], // Increased top margin to 20mm to prevent cutting
        filename: filename,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: {
          scale: 2, // High quality
          useCORS: true,
          logging: true, // Enable for debugging
          letterRendering: true,
          scrollX: 0,
          scrollY: 0
        },
        jsPDF: {
          unit: 'mm',
          format: 'a4',
          orientation: 'portrait'
        },
        pagebreak: { mode: ['css', 'legacy'] } // Added legacy mode for better splitting
      };

      await html2pdf().set(opt).from(container).save();
    } catch (e) {
      console.error('[ExportPDF] Error:', e);
      alert('Failed to generate PDF. See console for details.');
    } finally {
      // 8. Restore original state
      container.classList.remove('crm-pdf-exporting');
      container.style.maxWidth = origMaxWidth;
      container.style.width = origWidth;
      container.style.marginLeft = ''; // Reset inline style
      container.style.marginRight = ''; // Reset inline style
      container.style.padding = origPadding;

      if (grid) {
        grid.style.gridTemplateColumns = origGridTemplate;
        const cards = grid.querySelectorAll('.crm-result-card');
        if (cards.length > 1) {
          const testCard = cards[1];
          testCard.classList.remove('crm-pdf-hide');
        }
      }

      closedDetails.forEach((d) => (d.open = false));
      sectionDetails.forEach((d) => {
        d.classList.remove('html2pdf__page-break');
      });
      audioEls.forEach((a) => {
        a.style.display = a.dataset.origDisplay || '';
        delete a.dataset.origDisplay;
      });
      if (headerActions) headerActions.style.display = headerActionsDisplay;
      if (footer.parentNode) footer.parentNode.removeChild(footer);
      if (btn) { btn.disabled = false; btn.textContent = '📄 Export PDF'; }
    }
  };
})();
