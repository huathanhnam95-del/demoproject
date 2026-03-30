(function () {
  'use strict';

  // ==================== DOM ELEMENTS ====================
  const elements = {
    root: document.getElementById('crm-result-root'),
    subtitle: document.getElementById('crm-result-subtitle'),
    userEmail: document.getElementById('crm-result-user-email'),
    gate: document.getElementById('crm-loading'),
    gateText: document.getElementById('crm-loading-text'),
    gateSubtext: document.getElementById('crm-loading-subtext')
  };

  // ==================== CONSTANTS ====================
  const urlParams = new URLSearchParams(window.location.search || '');
  const testId = String(urlParams.get('testId') || '').trim();
  const authSessionGuard = window.AuthSessionGuard || null;
  const UI_DASH = '—';
  const UI_BULLET = '•';

  // ==================== INIT ====================

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

    const user = await waitForAuthUser({ timeoutMs: 12000, nullGraceMs: 1500 });
    if (!user) {
      showGate('Please log in as admin first.', 'Redirecting to the app…');
      setTimeout(() => window.location.replace('index.html'), 1800);
      return;
    }

    const adminOk = await isAdminUser(user);
    if (!adminOk) {
      showGate('Access denied.', 'Admin privileges required.');
      setTimeout(() => window.location.replace('index.html'), 2200);
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
    const lead = json.lead || null;
    const student = json.student || null;
    const session = json.session || null;

    const audioUrls = await fetchSpeakingAudioUrls(testId, test);
    renderResult({ testId, test, lead, student, session, audioUrls });
  }

  // ==================== AUTH & GATE ====================

  function showGate(text, subtext) {
    if (elements.gateText) elements.gateText.textContent = text || '';
    if (elements.gateSubtext) elements.gateSubtext.textContent = subtext || '';
    if (elements.gate) elements.gate.style.display = 'flex';
  }

  function hideGate() {
    if (elements.gate) elements.gate.style.display = 'none';
  }

  async function initFirebaseFromServer() {
    if (authSessionGuard && typeof authSessionGuard.ensureCompatFirebaseFromConfig === 'function') {
      await authSessionGuard.ensureCompatFirebaseFromConfig(firebase);
      return;
    }

    const res = await fetch('/api/config', { cache: 'no-store' });
    const result = await res.json().catch(() => null);

    if (!res.ok || !result?.success || !result?.config?.apiKey) {
      const msg = result?.message || 'Could not fetch /api/config. Ensure the server is running.';
      throw new Error(msg);
    }

    if (!firebase.apps.length) {
      firebase.initializeApp(result.config);
    }
    if (authSessionGuard && typeof authSessionGuard.ensureCompatLocalPersistence === 'function') {
      await authSessionGuard.ensureCompatLocalPersistence(firebase);
    }
  }

  function waitForAuthUser({ timeoutMs, nullGraceMs }) {
    if (authSessionGuard && typeof authSessionGuard.waitForCompatAuthUser === 'function') {
      return authSessionGuard.waitForCompatAuthUser(firebase, {
        timeoutMs,
        nullGraceMs
      });
    }
    return Promise.resolve(firebase.auth().currentUser || null);
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

  // ==================== API ====================

  async function apiFetchJson(url, options) {
    const user = firebase.auth().currentUser;
    if (!user) throw new Error('Not logged in.');
    const idToken = await user.getIdToken();
    const headers = { ...options?.headers, Authorization: `Bearer ${idToken}` };
    const res = await fetch(url, { ...options, headers, cache: 'no-store' });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.success) {
      const msg = json?.message || `Request failed (${res.status}).`;
      throw new Error(msg);
    }
    return json;
  }

  // ==================== UTILITIES ====================

  /** Minimal HTML entity escaping via string replacement (no DOM element creation). */
  const HTML_ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (ch) => HTML_ESCAPE_MAP[ch]);
  }

  function safeLower(value) {
    return String(value || '').trim().toLowerCase();
  }

  /** Convert a Firestore timestamp, ISO string, or epoch number to a Date. */
  function tsToDate(ts) {
    if (!ts) return null;
    // Firestore Timestamp objects
    if (typeof ts === 'object') {
      if (typeof ts.toMillis === 'function') return new Date(ts.toMillis());
      if (typeof ts._seconds === 'number') return new Date(ts._seconds * 1000);
      if (typeof ts.seconds === 'number') return new Date(ts.seconds * 1000);
    }
    // Coerce string/number to number for uniform handling
    const num = typeof ts === 'string' ? Number(ts) : ts;
    if (typeof num === 'number' && Number.isFinite(num)) {
      const d = new Date(num);
      if (Number.isFinite(d.getTime())) return d;
    }
    // Try as ISO string last
    if (typeof ts === 'string') {
      const d = new Date(ts);
      return Number.isFinite(d.getTime()) ? d : null;
    }
    return null;
  }

  function formatDateTime(ts) {
    const d = tsToDate(ts);
    if (!d) return UI_DASH;
    return d.toLocaleString();
  }

  /** Clamp a number to [0, 100]. */
  function clampPercent(n) {
    const num = typeof n === 'number' ? n : Number(n);
    if (!Number.isFinite(num)) return 0;
    return Math.max(0, Math.min(100, num));
  }

  /** Compute percentage from correct/total, clamped to [0, 100], rounded to 1 decimal. */
  function percentFromFraction(correct, total) {
    const c = typeof correct === 'number' ? correct : Number(correct);
    const t = typeof total === 'number' ? total : Number(total);
    if (!Number.isFinite(c) || !Number.isFinite(t) || t <= 0) return null;
    return Math.round(clampPercent((c / t) * 100) * 10) / 10;
  }

  function formatPercent(pct) {
    return pct == null ? UI_DASH : `${pct}%`;
  }

  // ==================== SIMPLE RENDERERS ====================

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

  function getStatusPill(statusRaw) {
    const status = safeLower(statusRaw) || 'created';
    const label = status.charAt(0).toUpperCase() + status.slice(1);
    return `<span class="crm-test-status ${escapeHtml(status)}">${escapeHtml(label)}</span>`;
  }

  // ==================== DATA HELPERS ====================

  function normalizeScoring(test) {
    const scoring = test?.scoring && typeof test.scoring === 'object' ? test.scoring : null;
    return {
      scoring,
      vocab: scoring?.vocab || null,
      grammar: scoring?.grammar || null,
      listenWrite: scoring?.listenWrite || null,
      overall: scoring?.overall || null
    };
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

  // ==================== SECTION DATA HELPERS ====================

  function findSection(session, id) {
    const sections = Array.isArray(session?.sections) ? session.sections : [];
    return sections.find((s) => String(s?.id || '') === id) || null;
  }

  function findScoredQuestion(sectionScoring, questionId) {
    const questions = Array.isArray(sectionScoring?.questions) ? sectionScoring.questions : [];
    return questions.find((q) => String(q?.questionId || '') === questionId) || null;
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

  // ==================== HTML BUILDERS ====================

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

        return `
          <tr>
            <td class="td-bold">${idx + 1}</td>
            <td>${expected ? escapeHtml(expected) : UI_DASH}</td>
            <td>${actual ? escapeHtml(actual) : UI_DASH}</td>
            <td>${escapeHtml(resultLabel)}</td>
          </tr>
        `;
      })
      .join('');

    return `
      <div class="crm-result-table-container">
        <table class="crm-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Expected</th>
              <th>Answer</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    `;
  }

  // ==================== SECTION RENDERERS ====================

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

            return `
            <div class="crm-result-question">
              <div class="crm-result-question-header">
                <div class="crm-result-question-title">Question ${idx + 1}</div>
                <div class="crm-result-muted"><strong>Accuracy:</strong> ${escapeHtml(accuracy)}</div>
              </div>
              <p class="crm-result-paragraph">${escapeHtml(expectedText)}</p>
              ${audioHtml}
              ${transcriptHtml}
            </div>
          `;
          })
          .join('')
        : '<div class="crm-result-muted">No speaking questions found for this version.</div>';

    const note = speakingSession?.instructionVi ? String(speakingSession.instructionVi) : '';

    return `
      <details class="crm-result-details" open>
        <summary>
          <span>Speaking (ĐỌC & NÓI)</span>
          <span class="crm-result-muted">${escapeHtml(questions.length)} questions</span>
        </summary>
        <div class="crm-result-details-body">
          ${note ? `<p class="crm-result-section-note">${escapeHtml(note)}</p>` : ''}
          ${questionBlocks}
        </div>
      </details>
    `;
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

            return `
            <div class="crm-result-question">
              <div class="crm-result-question-header">
                <div class="crm-result-question-title">Question ${idx + 1}</div>
                ${headerRight}
              </div>
              <p class="crm-result-paragraph">${paragraphHtml}</p>
              ${blanksTable}
            </div>
          `;
          })
          .join('')
        : '<div class="crm-result-muted">No questions found for this section.</div>';

    const note = sec?.instructionVi ? String(sec.instructionVi) : '';

    return `
      <details class="crm-result-details">
        <summary>
          <span>${escapeHtml(title)}</span>
          <span class="crm-result-muted">${escapeHtml(questions.length)} questions</span>
        </summary>
        <div class="crm-result-details-body">
          ${note ? `<p class="crm-result-section-note">${escapeHtml(note)}</p>` : ''}
          ${blocks}
        </div>
      </details>
    `;
  }

  // ==================== CARD BUILDERS ====================

  function buildStudentCard(student) {
    const body = student
      ? `
        <div class="crm-result-kv">
          <div class="crm-result-kv-label">Name</div>
          <div class="crm-result-kv-value">${escapeHtml(student.name || UI_DASH)}</div>
          <div class="crm-result-kv-label">Phone</div>
          <div class="crm-result-kv-value">${escapeHtml(student.phone || UI_DASH)}</div>
          <div class="crm-result-kv-label">Email</div>
          <div class="crm-result-kv-value">${escapeHtml(student.email || UI_DASH)}</div>
          ${student.label ? `<div class="crm-result-kv-label">Label</div><div class="crm-result-kv-value">${escapeHtml(student.label)}</div>` : ''}
          ${student.zalo ? `<div class="crm-result-kv-label">Zalo</div><div class="crm-result-kv-value">${escapeHtml(student.zalo)}</div>` : ''}
          ${student.facebook ? `<div class="crm-result-kv-label">Facebook</div><div class="crm-result-kv-value">${escapeHtml(student.facebook)}</div>` : ''}
        </div>
      `
      : '<div class="crm-result-muted">Student profile not found.</div>';

    return `
      <div class="crm-result-card">
        <div class="crm-result-card-header">
          <h3>Student</h3>
          ${student ? `<span class="crm-result-muted">${escapeHtml(student.id || '')}</span>` : ''}
        </div>
        <div class="crm-result-card-body">
          ${body}
        </div>
      </div>
    `;
  }

  function buildLeadCard(lead) {
    const body = lead
      ? `
        <div class="crm-result-kv">
          <div class="crm-result-kv-label">Name</div>
          <div class="crm-result-kv-value">${escapeHtml(lead.name || UI_DASH)}</div>
          <div class="crm-result-kv-label">Phone</div>
          <div class="crm-result-kv-value">${escapeHtml(lead.phone || UI_DASH)}</div>
          <div class="crm-result-kv-label">Email</div>
          <div class="crm-result-kv-value">${escapeHtml(lead.email || UI_DASH)}</div>
          ${lead.stage ? `<div class="crm-result-kv-label">Stage</div><div class="crm-result-kv-value">${escapeHtml(lead.stage)}</div>` : ''}
          ${lead.crmId ? `<div class="crm-result-kv-label">CRM ID</div><div class="crm-result-kv-value">${escapeHtml(lead.crmId)}</div>` : ''}
          ${lead.facebookDisplayName ? `<div class="crm-result-kv-label">Facebook</div><div class="crm-result-kv-value">${escapeHtml(lead.facebookDisplayName)}</div>` : ''}
          ${lead.facebookProfileUrl ? `<div class="crm-result-kv-label">Facebook Link</div><div class="crm-result-kv-value">${escapeHtml(lead.facebookProfileUrl)}</div>` : ''}
        </div>
      `
      : '<div class="crm-result-muted">Enquiry profile not found.</div>';

    return `
      <div class="crm-result-card">
        <div class="crm-result-card-header">
          <h3>Enquiry</h3>
          ${lead ? `<span class="crm-result-muted">${escapeHtml(lead.id || '')}</span>` : ''}
        </div>
        <div class="crm-result-card-body">
          ${body}
        </div>
      </div>
    `;
  }

  function buildMetaCard(testId, test, status) {
    return `
      <div class="crm-result-card">
        <div class="crm-result-card-header">
          <h3>Test</h3>
          ${getStatusPill(status)}
        </div>
        <div class="crm-result-card-body">
          <div class="crm-result-kv">
            <div class="crm-result-kv-label">Test ID</div>
            <div class="crm-result-kv-value">${escapeHtml(testId)}</div>
            <div class="crm-result-kv-label">Version</div>
            <div class="crm-result-kv-value">${escapeHtml(test?.version || UI_DASH)}</div>
            <div class="crm-result-kv-label">Created</div>
            <div class="crm-result-kv-value">${escapeHtml(formatDateTime(test?.createdAt))}</div>
            <div class="crm-result-kv-label">Started</div>
            <div class="crm-result-kv-value">${escapeHtml(formatDateTime(test?.startedAt))}</div>
            <div class="crm-result-kv-label">Submitted</div>
            <div class="crm-result-kv-value">${escapeHtml(formatDateTime(test?.submittedAt))}</div>
          </div>
        </div>
      </div>
    `;
  }

  /** Compute all score labels and percentages from test data. */
  function computeScoreData(test, session) {
    const { scoring, vocab, grammar, listenWrite, overall } = normalizeScoring(test);

    const overallLabel = overall
      ? `${overall.scoredCorrect || 0}/${overall.scoredTotal || 0}`
      : UI_DASH;
    const vocabLabel = vocab ? `${vocab.correctTotal || 0}/${vocab.blanksTotal || 0}` : UI_DASH;
    const grammarLabel = grammar ? `${grammar.correctTotal || 0}/${grammar.blanksTotal || 0}` : UI_DASH;
    const listenWriteLabel = listenWrite ? `${listenWrite.correctTotal || 0}/${listenWrite.blanksTotal || 0}` : UI_DASH;

    const overallPct = scoring ? percentFromFraction(overall?.scoredCorrect || 0, overall?.scoredTotal || 0) : null;
    const vocabPct = scoring ? percentFromFraction(vocab?.correctTotal || 0, vocab?.blanksTotal || 0) : null;
    const grammarPct = scoring ? percentFromFraction(grammar?.correctTotal || 0, grammar?.blanksTotal || 0) : null;
    const listenWritePct = scoring ? percentFromFraction(listenWrite?.correctTotal || 0, listenWrite?.blanksTotal || 0) : null;

    return {
      scoring, vocab, grammar, listenWrite, overall,
      overallLabel, vocabLabel, grammarLabel, listenWriteLabel,
      overallPct, vocabPct, grammarPct, listenWritePct
    };
  }

  function buildScoreSummary(scoreData) {
    const { scoring, overallLabel, vocabLabel, grammarLabel, listenWriteLabel,
      overallPct, vocabPct, grammarPct, listenWritePct, listenWrite } = scoreData;

    return `
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
  }

  function buildSectionsHtml({ test, session, audioUrls, scoring, vocab, grammar, listenWrite }) {
    if (!session) {
      return '<div class="crm-result-error">Session definition missing from server response.</div>';
    }

    return [
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

  // ==================== MAIN RENDER ====================

  function renderResult({ testId, test, lead, student, session, audioUrls }) {
    if (!elements.root) return;

    const status = safeLower(test?.status) || 'created';
    const studentLabel = student?.name || lead?.name || student?.email || lead?.email || student?.phone || lead?.phone || 'Student';
    setSubtitle(`${studentLabel} ${UI_BULLET} ${testId}`);

    const scoreData = computeScoreData(test, session);

    const leadCard = buildLeadCard(lead);
    const studentCard = buildStudentCard(student);
    const metaCard = buildMetaCard(testId, test, status);
    const summary = buildScoreSummary(scoreData);
    const detailsHtml = buildSectionsHtml({ test, session, audioUrls, ...scoreData });

    elements.root.innerHTML = `
      <div class="crm-result-grid">
        ${leadCard}
        ${studentCard}
        ${metaCard}
      </div>
      ${summary}
      ${detailsHtml}
    `;

    // Show export button now that content is rendered
    const exportBtn = document.getElementById('crm-export-pdf-btn');
    if (exportBtn) exportBtn.style.display = '';
  }

  function waitForNextFrame() {
    return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
  }

  async function waitForPdfLayout() {
    if (document.fonts && document.fonts.ready && typeof document.fonts.ready.then === 'function') {
      try {
        await document.fonts.ready;
      } catch (_) {
        // Ignore font loading failures and keep the export moving.
      }
    }

    await waitForNextFrame();
    await waitForNextFrame();
  }

  function getPdfExportSubtitle() {
    const subtitleEl = document.getElementById('crm-result-subtitle');
    return subtitleEl ? subtitleEl.textContent.trim() : '';
  }

  function getPdfExportStudentName(subtitleText) {
    return String(subtitleText || '').split(UI_BULLET)[0].trim() || 'Student';
  }

  function buildPdfFooterText(now) {
    return `Generated on ${now.toLocaleString()} • BEL Entrance Test`;
  }

  function cloneResultRootForPdf() {
    if (!elements.root) return null;

    const clone = elements.root.cloneNode(true);
    clone.removeAttribute('id');
    clone.querySelector('.crm-result-grid')?.remove();

    const details = clone.querySelectorAll('details');
    details.forEach((detail) => {
      detail.open = true;
      detail.setAttribute('open', '');
    });

    clone.querySelectorAll('audio').forEach((audio) => audio.remove());
    return clone;
  }

  function buildPdfExportShell() {
    const shell = document.createElement('div');
    shell.className = 'crm-result-pdf-shell';
    shell.setAttribute('aria-hidden', 'true');
    shell.innerHTML = `
      <div class="crm-result-pdf-pages"></div>
    `;
    return shell;
  }

  function buildPdfPage(studentName, footerText, pageNumber) {
    const page = document.createElement('section');
    page.className = 'crm-result-pdf-page';
    page.innerHTML = `
      <header class="crm-result-pdf-header">
        <div class="crm-result-pdf-kicker">BEL CRM</div>
        <div class="crm-result-pdf-title">Entrance Test Result</div>
        <div class="crm-result-pdf-subtitle">${escapeHtml(studentName || 'Student')}</div>
      </header>
      <div class="crm-result-pdf-page-body"></div>
      <footer class="crm-result-pdf-footer">
        <span>${escapeHtml(footerText || '')}</span>
        <span>Page ${pageNumber}</span>
      </footer>
    `;
    return page;
  }

  function buildPdfSectionIntroBlock(detail) {
    const summary = detail?.querySelector(':scope > summary');
    if (!summary) return null;

    const block = document.createElement('section');
    block.className = 'crm-result-pdf-section-intro';
    block.appendChild(summary.cloneNode(true));

    const note = detail.querySelector(':scope > .crm-result-details-body > .crm-result-section-note');
    if (note) {
      block.appendChild(note.cloneNode(true));
    }

    return block;
  }

  function buildPdfQuestionBlocks(question) {
    const blocks = [];
    if (!question) return blocks;

    const header = question.querySelector(':scope > .crm-result-question-header');
    const children = Array.from(question.children).filter((child) => child !== header);

    const firstContent = children[0] || null;
    const primaryBlock = document.createElement('div');
    primaryBlock.className = 'crm-result-question crm-result-pdf-question-fragment';
    if (header) primaryBlock.appendChild(header.cloneNode(true));
    if (firstContent) primaryBlock.appendChild(firstContent.cloneNode(true));
    blocks.push(primaryBlock);

    children.slice(1).forEach((child) => {
      const continuation = document.createElement('div');
      continuation.className = 'crm-result-question crm-result-pdf-question-fragment crm-result-pdf-question-continuation';
      continuation.appendChild(child.cloneNode(true));
      blocks.push(continuation);
    });

    return blocks;
  }

  function buildPdfBlocks(rootClone) {
    const blocks = [];
    if (!rootClone) return blocks;

    const summary = rootClone.querySelector(':scope > .crm-result-summary');
    if (summary) {
      const summaryBlock = document.createElement('section');
      summaryBlock.className = 'crm-result-pdf-summary-block';
      summaryBlock.appendChild(summary.cloneNode(true));
      blocks.push(summaryBlock);
    }

    rootClone.querySelectorAll(':scope > .crm-result-details').forEach((detail) => {
      const intro = buildPdfSectionIntroBlock(detail);
      if (intro) blocks.push(intro);

      detail.querySelectorAll(':scope > .crm-result-details-body > .crm-result-question').forEach((question) => {
        blocks.push(...buildPdfQuestionBlocks(question));
      });
    });

    return blocks;
  }

  function paginatePdfBlocks(exportShell, blocks, studentName, footerText) {
    const pagesRoot = exportShell.querySelector('.crm-result-pdf-pages');
    if (!pagesRoot) return;

    let pageNumber = 0;
    let currentPage = null;
    let currentBody = null;

    const createPage = () => {
      pageNumber += 1;
      currentPage = buildPdfPage(studentName, footerText, pageNumber);
      currentBody = currentPage.querySelector('.crm-result-pdf-page-body');
      pagesRoot.appendChild(currentPage);
    };

    createPage();

    blocks.forEach((block) => {
      if (!currentPage || !currentBody) createPage();
      currentBody.appendChild(block);

      if (currentBody.scrollHeight <= currentBody.clientHeight + 1) {
        return;
      }

      currentBody.removeChild(block);
      createPage();
      currentBody.appendChild(block);
    });
  }

  function buildPdfCaptureOptions({ width, height, filename }) {
    return {
      margin: 0,
      filename,
      image: { type: 'jpeg', quality: 0.99 },
      html2canvas: {
        scale: 2,
        useCORS: true,
        logging: false,
        letterRendering: true,
        scrollX: 0,
        scrollY: 0,
        width,
        height,
        windowHeight: height
      },
      jsPDF: {
        unit: 'mm',
        format: 'a4',
        orientation: 'portrait'
      }
    };
  }

  function getPdfPageCount(pdf) {
    if (!pdf) return 0;
    if (pdf.internal && typeof pdf.internal.getNumberOfPages === 'function') {
      return pdf.internal.getNumberOfPages();
    }
    if (typeof pdf.getNumberOfPages === 'function') {
      return pdf.getNumberOfPages();
    }
    return 0;
  }

  function trimPdfToSinglePage(pdf) {
    if (!pdf || typeof pdf.deletePage !== 'function') return;

    while (getPdfPageCount(pdf) > 1) {
      pdf.deletePage(getPdfPageCount(pdf));
    }
  }

  async function renderPdfPages(exportShell, filename) {
    const pages = Array.from(exportShell.querySelectorAll('.crm-result-pdf-page'));
    if (!pages.length) {
      throw new Error('PDF export failed to build pages.');
    }

    let pdf = null;

    for (let i = 0; i < pages.length; i += 1) {
      const page = pages[i];
      const pageWidth = Math.round(page.getBoundingClientRect().width || page.scrollWidth || 0);
      const pageHeight = Math.round(page.getBoundingClientRect().height || page.scrollHeight || 0);
      if (!pageWidth || !pageHeight) {
        throw new Error('PDF export failed to measure page dimensions.');
      }

      const originalBreakAfter = page.style.breakAfter;
      const originalPageBreakAfter = page.style.pageBreakAfter;
      page.style.breakAfter = 'auto';
      page.style.pageBreakAfter = 'auto';

      const opt = buildPdfCaptureOptions({ width: pageWidth, height: pageHeight, filename });

      try {
        if (i === 0) {
          pdf = await html2pdf().set(opt).from(page).toPdf().get('pdf');
          trimPdfToSinglePage(pdf);
          continue;
        }

        const canvas = await html2pdf().set(opt).from(page).toCanvas().get('canvas');
        const pageSize = pdf.internal && pdf.internal.pageSize;
        const pdfWidth = pageSize && typeof pageSize.getWidth === 'function' ? pageSize.getWidth() : (pageSize?.width || 210);
        const pdfHeight = pageSize && typeof pageSize.getHeight === 'function' ? pageSize.getHeight() : (pageSize?.height || 297);
        const imageData = canvas.toDataURL('image/jpeg', opt.image.quality);
        pdf.addPage();
        pdf.addImage(imageData, 'JPEG', 0, 0, pdfWidth, pdfHeight);
      } finally {
        page.style.breakAfter = originalBreakAfter;
        page.style.pageBreakAfter = originalPageBreakAfter;
      }
    }

    if (!pdf) {
      throw new Error('PDF export failed to render pages.');
    }

    pdf.save(filename);
  }

  // ==================== PDF EXPORT ====================

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

    const rootClone = cloneResultRootForPdf();
    if (!rootClone) {
      alert('Nothing to export.');
      if (btn) { btn.disabled = false; btn.textContent = '📄 Export PDF'; }
      return;
    }

    // Collect all mutations for cleanup in finally block
    const cleanup = [];

    const subtitleText = getPdfExportSubtitle();
    const studentName = getPdfExportStudentName(subtitleText);
    const now = new Date();
    const footerText = buildPdfFooterText(now);
    const filenameStudentName = studentName
      .normalize('NFD').replace(/([\u0300-\u036f]|[^0-9a-zA-Z\s])/g, '')
      .replace(/đ/g, 'd').replace(/Đ/g, 'D')
      .replace(/\s+/g, '-') || 'student';
    const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const filename = `entrance-test-${filenameStudentName}-${dateStr}.pdf`;
    const exportShell = buildPdfExportShell();
    const blocks = buildPdfBlocks(rootClone);

    if (blocks.length === 0) {
      alert('Nothing to export.');
      if (btn) { btn.disabled = false; btn.textContent = '📄 Export PDF'; }
      return;
    }
    document.body.appendChild(exportShell);
    cleanup.push(() => {
      if (exportShell.parentNode) {
        exportShell.parentNode.removeChild(exportShell);
      }
    });

    try {
      await waitForPdfLayout();
      paginatePdfBlocks(exportShell, blocks, studentName, footerText);
      await waitForPdfLayout();
      await renderPdfPages(exportShell, filename);
    } catch (e) {
      console.error('[ExportPDF] Error:', e);
      alert('Failed to generate PDF. See console for details.');
    } finally {
      // Restore all mutations in reverse order
      for (let i = cleanup.length - 1; i >= 0; i--) {
        try { cleanup[i](); } catch (_) { /* ignore restore errors */ }
      }
      if (btn) { btn.disabled = false; btn.textContent = '📄 Export PDF'; }
    }
  };
})();
