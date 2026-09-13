const SECTION_ORDER = ['speaking', 'vocab', 'grammar', 'listen_write'];

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function classes(...values) {
  return values.filter(Boolean).join(' ');
}

function sectionTitle(copy, sectionId) {
  return copy[sectionId] || sectionId;
}

function itemFor(summary, questionId) {
  return (summary?.items || []).find((item) => item.questionId === questionId) || {
    questionId, sectionId: '', type: '', answered: 0, total: 0, state: 'empty', flagged: false, missingBlankIds: []
  };
}

function questionNumber(question, questions) {
  return (questions || []).findIndex((item) => item.questionId === question.questionId) + 1;
}

function questionParts(question, draft, copy) {
  const values = draft.answers?.[question.questionId] || {};
  return (question.parts || []).map((part) => {
    if (part.type === 'text') return escapeHtml(part.text);
    const blankId = escapeHtml(part.blankId);
    const value = String(values[part.blankId] ?? '');
    const label = `${copy.typeAnswer}: ${part.blankId}`;
    if (Array.isArray(part.options)) {
      const options = [`<option value="">${escapeHtml(copy.choose)}</option>`, ...part.options.map((option) => `<option value="${escapeHtml(option)}"${option === value ? ' selected' : ''}>${escapeHtml(option)}</option>`)].join('');
      return `<label class="et-answer-label" for="answer-${blankId}">${escapeHtml(label)}</label><select class="et-inline-select${value ? ' is-filled' : ''}" id="answer-${blankId}" data-answer-question="${escapeHtml(question.questionId)}" data-answer-blank="${blankId}" aria-label="${escapeHtml(label)}">${options}</select>`;
    }
    return `<label class="et-answer-label" for="answer-${blankId}">${escapeHtml(label)}</label><input class="et-inline-text${value.trim() ? ' is-filled' : ''}" id="answer-${blankId}" type="text" autocomplete="off" value="${escapeHtml(value)}" data-answer-question="${escapeHtml(question.questionId)}" data-answer-blank="${blankId}" aria-label="${escapeHtml(label)}" />`;
  }).join('');
}

function renderHeaderTools({ draft, copy, persistenceState = 'saved' }) {
  const saveText = persistenceState === 'saving' ? copy.saving : persistenceState === 'error' ? copy.saveFailed : persistenceState === 'memory' ? copy.notSaved : copy.saved;
  const saveClass = persistenceState === 'error' || persistenceState === 'memory' ? 'is-error' : persistenceState === 'saved' ? 'is-success' : '';
  const localeButton = (locale, label) => `<button class="${draft.locale === locale ? 'is-active' : ''}" type="button" data-action="locale" data-value="${locale}" aria-pressed="${draft.locale === locale}">${label}</button>`;
  const scaleButton = (scale, label) => `<button class="${Number(draft.textScale) === scale ? 'is-active' : ''}" type="button" data-action="scale" data-value="${scale}" aria-pressed="${Number(draft.textScale) === scale}">${label}</button>`;
  return `<div class="et-header-tools" data-demo-font-default="Noto Sans">
    <span class="et-save-copy ${saveClass}" role="status" aria-live="polite">${escapeHtml(saveText)}</span>
    <div class="et-control-cluster">
      <div class="et-language-toggle" aria-label="${escapeHtml(copy.language)}"><span class="et-tool-label">${escapeHtml(copy.language)}</span><div class="et-segmented">${localeButton('en', copy.english)}${localeButton('vi', copy.vietnamese)}</div></div>
      <div class="et-text-size" aria-label="${escapeHtml(copy.textSize)}"><span class="et-tool-label">${escapeHtml(copy.textSize)}</span><div class="et-segmented">${scaleButton(100, copy.textScale100)}${scaleButton(115, copy.textScale115)}${scaleButton(130, copy.textScale130)}</div></div>
    </div>
  </div>`;
}

function renderIntro({ draft, sections, summary, copy }) {
  const hasAttempt = Number(draft.revision) > 0 || Object.keys(draft.answers || {}).length > 0 || Object.keys(draft.recordingRefs || {}).length > 0 || draft.micCheck !== 'not-checked';
  const action = hasAttempt ? 'continue-demo' : 'start-demo';
  const actionLabel = hasAttempt ? copy.introResume : copy.introStart;
  return `<section class="et-screen et-intro" data-view="intro">
    <header class="et-screen-header"><p class="et-kicker">${escapeHtml(copy.demoLabel)}</p><h1 class="et-title">${escapeHtml(copy.introTitle)}</h1><p class="et-lead">${escapeHtml(copy.introLead)}</p></header>
    <div class="et-intro-grid">
      <div class="et-intro-overview"><h2 class="et-screen-title">${escapeHtml(copy.introSections)}</h2><div class="et-section-list">${sections.map((section) => `<div class="et-section-row"><div class="et-section-row-main"><div class="et-section-row-title">${escapeHtml(sectionTitle(copy, section.id))}</div><div class="et-section-row-copy">${escapeHtml(copy[`${section.id}Copy`] || '')}</div></div><div class="et-section-row-count">${section.questions.length} ${escapeHtml(copy.group)}</div></div>`).join('')}</div>
        <div class="et-actions"><button class="et-btn et-btn-primary" type="button" data-action="${action}">${escapeHtml(actionLabel)}</button>${hasAttempt ? `<button class="et-btn" type="button" data-action="new-demo">${escapeHtml(copy.introNew)}</button>` : ''}</div>
      </div>
      <aside class="et-intro-aside"><h2 class="et-aside-heading">${escapeHtml(copy.introSections)}</h2><ul class="et-check-list">${copy.introChecks.map((check) => `<li><span class="et-check-mark" aria-hidden="true">✓</span><span>${escapeHtml(check)}</span></li>`).join('')}</ul>${hasAttempt ? `<p class="et-helper-copy">${escapeHtml(summary.completeQuestions)} / ${escapeHtml(summary.totalQuestions)} ${escapeHtml(copy.completed)}</p>` : ''}</aside>
    </div>
    ${renderQa(copy)}
  </section>`;
}

function renderQa(copy) {
  return `<details class="et-qa"><summary>${escapeHtml(copy.qa)}</summary><p class="et-qa-note">${escapeHtml(copy.qaNote)}</p><div class="et-qa-grid"><button class="et-btn et-btn-small" type="button" data-action="qa-fill-all">${escapeHtml(copy.qaFillAll)}</button><button class="et-btn et-btn-small" type="button" data-action="qa-partial">${escapeHtml(copy.qaPartial)}</button><button class="et-btn et-btn-small" type="button" data-action="qa-clear-current">${escapeHtml(copy.qaClear)}</button><button class="et-btn et-btn-small" type="button" data-action="qa-toggle-flag">${escapeHtml(copy.qaFlag)}</button><button class="et-btn et-btn-small" type="button" data-action="qa-jump-missing">${escapeHtml(copy.qaJump)}</button><button class="et-btn et-btn-small" type="button" data-action="qa-complete">${escapeHtml(copy.qaComplete)}</button><button class="et-btn et-btn-small et-btn-danger" type="button" data-action="qa-reset">${escapeHtml(copy.qaReset)}</button><button class="et-btn et-btn-small" type="button" data-action="qa-import">${escapeHtml(copy.qaImport)}</button></div></details>`;
}

function renderMiccheck({ draft, copy, audioState = {} }) {
  const state = audioState.status || 'idle';
  const isRecording = state === 'recording';
  const isProcessing = state === 'processing';
  const hasTest = Boolean(audioState.testUrl);
  const status = isRecording ? copy.micRecording : isProcessing ? copy.micProcessing : hasTest ? copy.micSaved : copy.micIdle;
  return `<section class="et-screen" data-view="miccheck"><header class="et-screen-header"><p class="et-kicker">${escapeHtml(copy.demoLabel)}</p><h1 class="et-title">${escapeHtml(copy.micTitle)}</h1><p class="et-lead">${escapeHtml(copy.micLead)}</p></header>
    <div class="et-recorder"><div class="et-recorder-visual"><canvas class="et-recorder-canvas" id="et-mic-canvas" aria-label="${escapeHtml(copy.micTitle)}"></canvas></div><div class="et-recorder-caption"><span>${escapeHtml(status)}</span><span class="et-recording-time">${escapeHtml(copy.elapsed)} <span data-recording-elapsed>0:00</span></span></div><div class="et-recorder-actions">${isRecording ? `<button class="et-btn et-btn-primary" type="button" data-mic-action="stop">${escapeHtml(copy.micStop)}</button>` : `<button class="et-btn et-btn-primary" type="button" data-mic-action="start"${isProcessing ? ' disabled' : ''}>${escapeHtml(copy.micStart)}</button>`}${hasTest ? `<button class="et-btn" type="button" data-mic-action="play">${escapeHtml(copy.micPlay)}</button><button class="et-btn et-btn-primary" type="button" data-mic-action="continue">${escapeHtml(copy.next)}</button>` : ''}<button class="et-btn et-btn-quiet" type="button" data-mic-action="skip"${isProcessing ? ' disabled' : ''}>${escapeHtml(copy.micSkip)}</button></div>${audioState.error ? `<p class="et-status is-error">${escapeHtml(audioState.error === 'permission' ? copy.micPermission : copy.recordingFailed)}</p>` : ''}</div></section>`;
}

function renderRecorder({ question, draft, copy, audioState = {}, recordingUrl = '' }) {
  const ref = draft.recordingRefs?.[question.questionId];
  const status = audioState.questionId === question.questionId ? audioState.status : 'idle';
  const isRecording = status === 'recording';
  const isProcessing = status === 'processing';
  const hasRecording = Boolean(ref);
  const statusText = isRecording ? copy.micRecording : isProcessing ? copy.recordingProcessing : hasRecording ? copy.recordingSaved : copy.recordingStart;
  return `<div class="et-recorder" data-recorder-question="${escapeHtml(question.questionId)}"><div class="et-recorder-visual"><canvas class="et-recorder-canvas" id="et-recorder-canvas" aria-label="${escapeHtml(copy.recordingStart)}"></canvas></div><div class="et-recorder-caption"><span class="${isRecording ? 'et-recording-live' : ''}">${escapeHtml(statusText)}</span><span class="et-recording-time">${escapeHtml(copy.elapsed)} <span data-recording-elapsed>${escapeHtml(audioState.elapsedLabel || '0:00')}</span></span></div><div class="et-recorder-actions">${isRecording ? `<button class="et-btn et-btn-primary" type="button" data-record-action="stop" data-question-id="${escapeHtml(question.questionId)}">${escapeHtml(copy.recordingStop)}</button>` : `<button class="et-btn et-btn-primary" type="button" data-record-action="start" data-question-id="${escapeHtml(question.questionId)}"${isProcessing ? ' disabled' : ''}>${escapeHtml(hasRecording ? copy.recordingReplace : copy.recordingStart)}</button>`}${hasRecording && recordingUrl ? `<button class="et-btn" type="button" data-record-action="play" data-question-id="${escapeHtml(question.questionId)}">${escapeHtml(copy.recordingPlay)}</button>` : ''}</div>${audioState.error && audioState.questionId === question.questionId ? `<p class="et-status is-error">${escapeHtml(copy.recordingFailed)}</p>` : ''}${hasRecording ? `<div class="et-recording-take"><span>${escapeHtml(copy.recordingSaved)} · ${Math.max(0, Math.round(Number(ref.durationMs) / 1000))}s</span>${recordingUrl ? `<audio controls preload="metadata" src="${escapeHtml(recordingUrl)}"></audio>` : ''}</div>` : ''}</div>`;
}

function renderListeningPlayer({ question, copy, audioState = {} }) {
  const hasAudio = audioState.audioUrl !== false;
  const url = audioState.audioUrl || `/${String(question.audioUrl || '').replace(/^\/+/, '')}`;
  return `<div class="et-listening-player"><div class="et-audio-player"><span class="et-tool-label">${escapeHtml(copy.listeningPlayer)}</span>${hasAudio ? `<audio id="et-listening-audio" preload="metadata" src="${escapeHtml(url)}"></audio><button class="et-btn et-btn-small" type="button" data-audio-action="toggle">${escapeHtml(audioState.playing ? copy.pause : copy.play)}</button><input class="et-audio-progress" type="range" min="0" max="1000" value="${Number(audioState.progress || 0)}" data-audio-action="seek" aria-label="${escapeHtml(copy.listeningPlayer)}" /><span class="et-audio-time" data-audio-time>0:00 / 0:00</span><label class="et-tool-label" for="et-audio-rate">${escapeHtml(copy.speed)}</label><select class="et-rate-control" id="et-audio-rate" data-audio-action="rate"><option value="0.8"${Number(audioState.rate) === 0.8 ? ' selected' : ''}>0.8×</option><option value="1"${!audioState.rate || Number(audioState.rate) === 1 ? ' selected' : ''}>1×</option><option value="1.2"${Number(audioState.rate) === 1.2 ? ' selected' : ''}>1.2×</option></select>` : `<span class="et-status is-error">${escapeHtml(copy.noAudio)}</span><button class="et-btn et-btn-small" type="button" data-audio-action="retry">${escapeHtml(copy.retryAudio)}</button>`}</div></div>`;
}

function renderTask({ draft, question, questions, sections, summary, copy, audioState, recordingUrl = '', listeningState = {} }) {
  const item = itemFor(summary, question.questionId);
  const qNo = questionNumber(question, questions);
  const sectionQuestions = sections.find((section) => section.id === question.sectionId)?.questions || [];
  const sectionPosition = Math.max(0, sectionQuestions.findIndex((item) => item.questionId === question.questionId)) + 1;
  const instruction = draft.locale === 'vi' ? question.instructionVi : question.instruction || copy.instruction;
  const passage = question.type === 'speaking' ? `<p>${escapeHtml(question.text)}</p>` : `<p>${questionParts(question, draft, copy)}</p>`;
  const taskBody = question.type === 'speaking' ? renderRecorder({ question, draft, copy, audioState, recordingUrl }) : `${question.type === 'fill' ? renderListeningPlayer({ question, copy, audioState: listeningState }) : ''}<div class="et-passage">${passage}</div>`;
  return `<section class="et-screen" data-view="question" data-question-id="${escapeHtml(question.questionId)}"><div class="et-nav-mobile"><button class="et-btn et-btn-small" type="button" data-action="open-overview">${escapeHtml(copy.overview)}</button></div><div class="et-task-layout"><main class="et-task-main"><div class="et-task-meta"><span>${escapeHtml(sectionTitle(copy, question.sectionId))}</span><strong>${escapeHtml(copy.group)} ${sectionPosition} ${escapeHtml(copy.of)} ${sectionQuestions.length}</strong><span>${escapeHtml(copy.current)} ${qNo} ${escapeHtml(copy.of)} ${questions.length}</span></div><p class="et-task-instruction"><span class="et-kicker">${escapeHtml(copy.instruction)}</span><br />${escapeHtml(instruction)}</p>${taskBody}<div class="et-task-footer"><button class="et-btn et-btn-small et-flag-btn" type="button" data-action="toggle-flag" data-question-id="${escapeHtml(question.questionId)}" aria-pressed="${item.flagged}">${escapeHtml(item.flagged ? copy.unflag : copy.flag)}</button><div class="et-task-footer-actions">${qNo > 1 ? `<button class="et-btn" type="button" data-action="previous-question">${escapeHtml(copy.previous)}</button>` : ''}${qNo < questions.length ? `<button class="et-btn et-btn-primary" type="button" data-action="next-question">${escapeHtml(copy.next)}</button>` : `<button class="et-btn et-btn-primary" type="button" data-action="review">${escapeHtml(copy.review)}</button>`}</div></div></main><aside class="et-task-aside"><div class="et-progress-block"><h2 class="et-progress-title">${escapeHtml(copy.overview)}</h2><p class="et-progress-copy">${summary.completeQuestions} / ${summary.totalQuestions} ${escapeHtml(copy.completed)}</p><nav class="et-group-nav" aria-label="${escapeHtml(copy.overview)}">${questions.map((itemQuestion) => { const navItem = itemFor(summary, itemQuestion.questionId); return `<button class="et-group-link ${itemQuestion.questionId === question.questionId ? 'is-current' : ''} ${navItem.state === 'complete' ? 'is-complete' : ''} ${navItem.flagged ? 'is-flagged' : ''}" type="button" data-action="nav-question" data-question-id="${escapeHtml(itemQuestion.questionId)}"><span class="et-group-name">${escapeHtml(sectionTitle(copy, itemQuestion.sectionId))} · ${itemQuestion.questionNumber}</span><span class="et-group-state">${escapeHtml(navItem.state === 'complete' ? copy.completed : navItem.state === 'partial' ? copy.partial : copy.unanswered)}</span></button>`; }).join('')}</nav></div></aside></div>${renderOverviewDialog({ questions, summary, copy })}</section>`;
}

function renderOverviewDialog({ questions, summary, copy }) {
  return `<dialog class="et-overview-dialog" id="et-overview-dialog"><div class="et-dialog-head"><h2 class="et-dialog-title">${escapeHtml(copy.overview)}</h2><button class="et-btn et-btn-small" type="button" data-action="close-overview">${escapeHtml(copy.close)}</button></div><div class="et-dialog-body">${questions.map((question) => { const item = itemFor(summary, question.questionId); return `<button class="et-group-link ${item.state === 'complete' ? 'is-complete' : ''}" type="button" data-action="nav-question" data-question-id="${escapeHtml(question.questionId)}"><span class="et-group-name">${escapeHtml(sectionTitle(copy, question.sectionId))} · ${question.questionNumber}</span><span class="et-group-state">${escapeHtml(item.state === 'complete' ? copy.completed : item.state === 'partial' ? copy.partial : copy.unanswered)}</span></button>`; }).join('')}</div></dialog>`;
}

function renderReview({ draft, questions, sections, summary, copy }) {
  const missingWritten = summary.items.flatMap((item) => item.type === 'speaking' ? [] : item.missingBlankIds.map((blankId) => ({ ...item, blankId })));
  const missingQuestions = summary.items.filter((item) => item.state !== 'complete');
  const missingSpeaking = missingQuestions.some((item) => item.type === 'speaking');
  const canSubmit = !missingSpeaking && (!missingWritten.length || draft.reviewAcknowledged);
  return `<section class="et-screen" data-view="review"><header class="et-screen-header"><p class="et-kicker">${escapeHtml(copy.demoLabel)}</p><h1 class="et-title">${escapeHtml(copy.reviewTitle)}</h1><p class="et-lead">${escapeHtml(copy.reviewLead)}</p></header><div class="et-review-list">${SECTION_ORDER.map((sectionId) => { const sectionItems = summary.items.filter((item) => item.sectionId === sectionId); const sectionMissing = sectionItems.filter((item) => item.state !== 'complete'); return `<section class="et-review-section"><div class="et-review-head"><span class="et-review-name">${escapeHtml(sectionTitle(copy, sectionId))}</span><span class="et-review-count">${sectionMissing.length ? `${sectionMissing.length} ${escapeHtml(copy.missing)}` : escapeHtml(copy.nothingMissing)}</span></div>${sectionMissing.length ? `<div class="et-review-items">${sectionMissing.map((item) => item.missingBlankIds.length ? item.missingBlankIds.map((blankId) => `<button class="et-review-item ${item.flagged ? 'is-flagged' : ''}" type="button" data-action="jump-blank" data-question-id="${escapeHtml(item.questionId)}" data-blank-id="${escapeHtml(blankId)}">${escapeHtml(copy.jump)} · ${escapeHtml(item.questionId)} · ${escapeHtml(blankId)}</button>`).join('') : `<button class="et-review-item ${item.flagged ? 'is-flagged' : ''}" type="button" data-action="jump-question" data-question-id="${escapeHtml(item.questionId)}">${escapeHtml(copy.jump)} · ${escapeHtml(item.questionId)}</button>`).join('')}</div>` : `<p class="et-review-empty">${escapeHtml(copy.nothingMissing)}</p>`}</section>`; }).join('')}</div>${missingWritten.length || missingSpeaking ? `<div class="et-review-note">${missingWritten.length ? escapeHtml(`${missingWritten.length} ${copy.missing}`) : ''}${missingSpeaking ? (missingWritten.length ? ' · ' : '') + escapeHtml(copy.recordingStart) : ''}</div>` : ''}<div class="et-submit-panel">${missingWritten.length ? `<label><input type="checkbox" data-action="review-ack"${draft.reviewAcknowledged ? ' checked' : ''} /> ${escapeHtml(copy.acknowledge)}</label>` : ''}<div class="et-actions"><button class="et-btn" type="button" data-action="back-to-question">${escapeHtml(copy.backToReview)}</button><button class="et-btn et-btn-primary" type="button" data-action="submit-demo"${canSubmit ? '' : ' disabled'}>${escapeHtml(copy.submitDemo)}</button></div></div></section>`;
}

function renderDone({ draft, copy }) {
  return `<section class="et-screen et-done" data-view="done"><header class="et-screen-header"><p class="et-kicker">${escapeHtml(copy.demoLabel)}</p><h1 class="et-title">${escapeHtml(copy.doneTitle)}</h1><p class="et-lead">${escapeHtml(copy.doneLead)}</p></header><div class="et-done-receipt"><div class="et-receipt-label">${escapeHtml(copy.receipt)} · demo-local</div><div class="et-receipt-id">${escapeHtml(draft.submission?.receiptId || '')}</div></div><div class="et-actions"><button class="et-btn et-btn-primary" type="button" data-action="done-again">${escapeHtml(copy.doneAgain)}</button></div></section>`;
}

function renderRecovery({ copy, recovery }) {
  return `<section class="et-screen" data-view="intro"><div class="et-recovery"><h1 class="et-recovery-title">${escapeHtml(copy.recoveryTitle)}</h1><p class="et-recovery-copy">${escapeHtml(recovery?.message || copy.recoveryCopy)}</p><div class="et-actions"><button class="et-btn et-btn-primary" type="button" data-action="new-demo">${escapeHtml(copy.recoverNew)}</button></div></div></section>`;
}

function renderFooterStatus({ persistenceState, copy, notice = '' }) {
  const text = notice || (persistenceState === 'saving' ? copy.saving : persistenceState === 'error' ? copy.saveFailed : persistenceState === 'memory' ? copy.notSaved : copy.saved);
  const statusClass = persistenceState === 'error' || persistenceState === 'memory' ? 'is-error' : persistenceState === 'saved' ? 'is-success' : '';
  return `<span class="et-status ${statusClass}" role="status" aria-live="polite">${escapeHtml(text)}</span><span class="et-footer-note">${escapeHtml(copy.demoLabel)}</span>`;
}

function renderApp({ draft, sections = [], questions = [], summary, currentQuestion, copy, persistenceState = 'saved', audioState = {}, recordingUrl = '', listeningState = {}, recovery = null, notice = '' }) {
  if (recovery) return renderRecovery({ copy, recovery });
  const view = draft.view === 'question' && currentQuestion ? renderTask({ draft, question: currentQuestion, questions, sections, summary, copy, audioState, recordingUrl, listeningState }) : draft.view === 'miccheck' ? renderMiccheck({ draft, copy, audioState }) : draft.view === 'review' ? renderReview({ draft, questions, sections, summary, copy }) : draft.view === 'done' ? renderDone({ draft, copy }) : renderIntro({ draft, sections, summary, copy });
  return `${view}`;
}

export { escapeHtml, renderHeaderTools, renderApp, renderFooterStatus, SECTION_ORDER };
