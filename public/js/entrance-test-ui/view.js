const SECTION_ORDER = ['speaking', 'vocab', 'grammar', 'listen_write'];
const SECTION_OFFSETS = { speaking: 0, vocab: 3, grammar: 7, listen_write: 11 };

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
  const found = (questions || []).findIndex((item) => item.questionId === question.questionId);
  return found >= 0 ? found + 1 : Number(question.questionNumber || 1);
}

function globalQuestionNumber(question) {
  return Number(SECTION_OFFSETS[question.sectionId] || 0) + Number(question.questionNumber || 1);
}

function sectionQuestions(sections, sectionId) {
  return sections.find((section) => section.id === sectionId)?.questions || [];
}

function instructionFor(question, draft, copy) {
  if (draft.locale === 'vi') return question.instructionVi || copy.instruction;
  return copy[`${question.sectionId}Instruction`] || copy.instruction;
}

function blankNumber(question, blankId) {
  return (question.parts || []).filter((part) => part.type === 'blank').findIndex((part) => part.blankId === blankId) + 1;
}

function questionParts(question, draft, copy) {
  const values = draft.answers?.[question.questionId] || {};
  let blankOrdinal = 0;
  let previousBlank = "start";
  return (question.parts || []).map((part) => {
    if (part.type === 'text') return `<span data-et-annotation-id="question/${escapeHtml(question.questionId)}/text/${escapeHtml(previousBlank)}" data-et-text-run>${escapeHtml(part.text)}</span>`;
    previousBlank = part.blankId;
    blankOrdinal += 1;
    const blankId = escapeHtml(part.blankId);
    const value = String(values[part.blankId] ?? '');
    const label = `${sectionTitle(copy, question.sectionId)} · ${copy.question} ${question.questionNumber} · ${copy.blank} ${blankOrdinal}`;
    const fieldId = `answer-${blankId}`;
    if (Array.isArray(part.options)) {
      const options = [`<option value="">${escapeHtml(copy.choose)}</option>`, ...part.options.map((option) => `<option value="${escapeHtml(option)}"${option === value ? ' selected' : ''}>${escapeHtml(option)}</option>`)].join('');
      return `<span class="et-answer-slot"><label class="et-answer-label" for="${fieldId}">${escapeHtml(label)}</label><select class="et-inline-select${value ? ' is-filled' : ''}" id="${fieldId}" data-et-annotation-id="question/${escapeHtml(question.questionId)}/blank/${blankId}" data-answer-question="${escapeHtml(question.questionId)}" data-answer-blank="${blankId}" data-blank-number="${blankOrdinal}" aria-label="${escapeHtml(label)}">${options}</select></span>`;
    }
    return `<span class="et-answer-slot"><label class="et-answer-label" for="${fieldId}">${escapeHtml(label)}</label><input class="et-inline-text${value.trim() ? ' is-filled' : ''}" id="${fieldId}" type="text" autocomplete="off" value="${escapeHtml(value)}" data-et-annotation-id="question/${escapeHtml(question.questionId)}/blank/${blankId}" data-answer-question="${escapeHtml(question.questionId)}" data-answer-blank="${blankId}" data-blank-number="${blankOrdinal}" aria-label="${escapeHtml(label)}" /></span>`;
  }).join('');
}

function renderHeaderTools({ draft, copy, persistenceState = 'saved' }) {
  const saveText = persistenceState === 'saving' ? copy.saving : persistenceState === 'error' ? copy.saveFailed : persistenceState === 'memory' ? copy.notSaved : copy.saved;
  const saveClass = persistenceState === 'error' || persistenceState === 'memory' ? 'is-error' : persistenceState === 'saved' ? 'is-success' : '';
  const localeButton = (locale, label) => `<button class="${draft.locale === locale ? 'is-active' : ''}" type="button" data-action="locale" data-value="${locale}" aria-pressed="${draft.locale === locale}">${label}</button>`;
  const scaleButton = (scale, label) => `<button class="${Number(draft.textScale) === scale ? 'is-active' : ''}" type="button" data-action="scale" data-value="${scale}" aria-pressed="${Number(draft.textScale) === scale}">${label}</button>`;
  const retry = persistenceState === 'error' ? `<button class="et-header-retry" type="button" data-action="retry-save">${escapeHtml(copy.retry)}</button>` : '';
  return `<div class="et-header-tools-content" data-demo-font-default="Noto Sans" data-visual-revision="signal-noto-v2">
    <span class="et-save-copy ${saveClass}" role="status" aria-live="polite">${escapeHtml(saveText)}</span>${retry}
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
    <header class="et-screen-header"><span class="et-title-rule" aria-hidden="true"></span><h1 class="et-title">${escapeHtml(copy.introTitle)}</h1><p class="et-lead">${escapeHtml(copy.introLead)}</p></header>
    <div class="et-intro-grid">
      <div class="et-intro-overview"><div class="et-section-list" aria-label="${escapeHtml(copy.introSections)}">${sections.map((section, index) => `<div class="et-section-row"><div class="et-section-row-index">${String(index + 1).padStart(2, '0')}</div><div class="et-section-row-main"><div class="et-section-row-title">${escapeHtml(sectionTitle(copy, section.id))}</div><div class="et-section-row-copy">${escapeHtml(copy[`${section.id}Copy`] || '')}</div></div><div class="et-section-row-count">${section.questions.length} ${escapeHtml(copy.groups)}</div></div>`).join('')}</div>
        <div class="et-actions"><button class="et-btn et-btn-primary" type="button" data-action="${action}">${escapeHtml(actionLabel)}</button>${hasAttempt ? `<button class="et-btn" type="button" data-action="new-demo">${escapeHtml(copy.introNew)}</button>` : ''}</div>
      </div>
      <aside class="et-intro-aside"><h2 class="et-aside-heading">${escapeHtml(copy.beforeBegin)}</h2><div class="et-preparation-copy">${copy.introPreparation.map((line) => `<p>${escapeHtml(line)}</p>`).join('')}</div><p class="et-demo-note">${escapeHtml(copy.introDemoNote)}</p>${hasAttempt ? `<p class="et-helper-copy">${escapeHtml(summary.completeQuestions)} / ${escapeHtml(summary.totalQuestions)} ${escapeHtml(copy.completed)}</p>` : ''}</aside>
    </div>
    ${renderQa(copy)}
  </section>`;
}

function renderQa(copy) {
  return `<details class="et-qa" data-qa-disclosure><summary>${escapeHtml(copy.qa)}</summary><p class="et-qa-note">${escapeHtml(copy.qaNote)}</p><div class="et-qa-grid"><button class="et-btn et-btn-small" type="button" data-action="qa-fill-all">${escapeHtml(copy.qaFillAll)}</button><button class="et-btn et-btn-small" type="button" data-action="qa-partial">${escapeHtml(copy.qaPartial)}</button><button class="et-btn et-btn-small" type="button" data-action="qa-clear-current">${escapeHtml(copy.qaClear)}</button><button class="et-btn et-btn-small" type="button" data-action="qa-toggle-flag">${escapeHtml(copy.qaFlag)}</button><button class="et-btn et-btn-small" type="button" data-action="qa-jump-missing">${escapeHtml(copy.qaJump)}</button><button class="et-btn et-btn-small" type="button" data-action="qa-complete">${escapeHtml(copy.qaComplete)}</button><button class="et-btn et-btn-small et-btn-danger" type="button" data-action="qa-reset">${escapeHtml(copy.qaReset)}</button><button class="et-btn et-btn-small" type="button" data-action="qa-import">${escapeHtml(copy.qaImport)}</button></div></details>`;
}

function renderMiccheck({ copy, audioState = {} }) {
  const state = audioState.status || 'idle';
  const isRecording = state === 'recording';
  const isProcessing = state === 'processing';
  const hasTest = Boolean(audioState.testUrl);
  const status = isRecording ? copy.micRecording : isProcessing ? copy.micProcessing : hasTest ? copy.micSaved : state === 'error' ? copy.micError : copy.micIdle;
  const startLabel = hasTest ? copy.micRecordAgain : copy.micStart;
  return `<section class="et-screen et-miccheck" data-view="miccheck"><header class="et-screen-header"><span class="et-title-rule" aria-hidden="true"></span><h1 class="et-title">${escapeHtml(copy.micTitle)}</h1><p class="et-lead">${escapeHtml(copy.micLead)}</p></header>
    <div class="et-mic-stage"><p class="et-task-instruction">${escapeHtml(copy.micInstruction)}</p><div class="et-recorder-visual"><canvas class="et-recorder-canvas" id="et-mic-canvas" aria-label="${escapeHtml(copy.micSignal)}"></canvas></div><div class="et-recorder-caption"><span class="${isRecording ? 'et-recording-live' : ''}">${escapeHtml(status)}</span>${isRecording ? `<span class="et-recording-time">${escapeHtml(copy.elapsed)} <span data-recording-elapsed>${escapeHtml(audioState.elapsedLabel || '0:00')}</span></span>` : ''}</div><div class="et-recorder-actions">${isRecording ? `<button class="et-btn et-btn-primary" type="button" data-mic-action="stop">${escapeHtml(copy.micStop)}</button>` : `<button class="et-btn et-btn-primary" type="button" data-mic-action="start"${isProcessing ? ' disabled' : ''}>${escapeHtml(startLabel)}</button>`}${hasTest ? `<audio class="et-native-audio" controls preload="metadata" src="${escapeHtml(audioState.testUrl)}"></audio><button class="et-btn et-btn-primary" type="button" data-mic-action="continue">${escapeHtml(copy.next)}</button>` : ''}<button class="et-btn et-btn-quiet" type="button" data-mic-action="skip"${isProcessing ? ' disabled' : ''}>${escapeHtml(copy.micSkip)}</button></div>${audioState.error ? `<p class="et-status is-error">${escapeHtml(audioState.error === 'permission' ? copy.micPermission : copy.recordingFailed)}</p>` : ''}</div></section>`;
}

function renderRecorder({ question, draft, copy, audioState = {}, recordingUrl = '' }) {
  const ref = draft.recordingRefs?.[question.questionId];
  const status = audioState.questionId === question.questionId ? audioState.status : 'idle';
  const isRecording = status === 'recording';
  const isProcessing = status === 'processing';
  const hasRecording = Boolean(ref);
  const statusText = isRecording ? copy.micRecording : isProcessing ? copy.recordingProcessing : hasRecording ? copy.recordingSaved : copy.recordingReady;
  return `<div class="et-recorder" data-recorder-question="${escapeHtml(question.questionId)}"><div class="et-recorder-visual"><canvas class="et-recorder-canvas" id="et-recorder-canvas" aria-label="${escapeHtml(copy.recordingSignal)}"></canvas></div><div class="et-recorder-caption"><span class="${isRecording ? 'et-recording-live' : ''}">${escapeHtml(statusText)}</span><span class="et-recording-time">${isRecording ? `${escapeHtml(copy.elapsed)} <span data-recording-elapsed>${escapeHtml(audioState.elapsedLabel || '0:00')}</span>` : ''}</span></div><div class="et-recorder-actions">${isRecording ? `<button class="et-btn et-btn-primary" type="button" data-record-action="stop" data-question-id="${escapeHtml(question.questionId)}">${escapeHtml(copy.recordingStop)}</button>` : `<button class="et-btn et-btn-primary" type="button" data-record-action="start" data-question-id="${escapeHtml(question.questionId)}"${isProcessing ? ' disabled' : ''}>${escapeHtml(hasRecording ? copy.recordingReplace : copy.recordingStart)}</button>`}</div>${audioState.error && audioState.questionId === question.questionId ? `<p class="et-status is-error">${escapeHtml(copy.recordingFailed)}</p>` : ''}${hasRecording && recordingUrl ? `<div class="et-recording-take"><span class="et-recording-take-label">${escapeHtml(copy.recordingSaved)}</span><audio controls preload="metadata" src="${escapeHtml(recordingUrl)}"></audio></div>` : ''}</div>`;
}

function renderListeningPlayer({ question, copy, audioState = {} }) {
  const hasAudio = audioState.audioUrl !== false;
  const url = audioState.audioUrl || `/${String(question.audioUrl || '').replace(/^\/+/, '')}`;
  return `<div class="et-listening-player"><div class="et-audio-player"><span class="et-tool-label">${escapeHtml(copy.listeningPlayer)}</span>${hasAudio ? `<audio id="et-listening-audio" preload="metadata" src="${escapeHtml(url)}" aria-label="${escapeHtml(copy.listeningPlayer)}"></audio><button class="et-btn et-btn-small" type="button" data-audio-action="toggle">${escapeHtml(audioState.playing ? copy.pause : copy.play)}</button><input class="et-audio-progress" type="range" min="0" max="1000" value="${Number(audioState.progress || 0)}" data-audio-action="seek" aria-label="${escapeHtml(copy.seek)}" /><span class="et-audio-time" data-audio-time>0:00 / 0:00</span><label class="et-tool-label" for="et-audio-rate">${escapeHtml(copy.speed)}</label><select class="et-rate-control" id="et-audio-rate" data-audio-action="rate" aria-label="${escapeHtml(copy.speed)}"><option value="0.8"${Number(audioState.rate) === 0.8 ? ' selected' : ''}>0.8×</option><option value="1"${!audioState.rate || Number(audioState.rate) === 1 ? ' selected' : ''}>1×</option><option value="1.2"${Number(audioState.rate) === 1.2 ? ' selected' : ''}>1.2×</option></select>` : `<span class="et-status is-error">${escapeHtml(copy.noAudio)}</span><button class="et-btn et-btn-small" type="button" data-audio-action="retry">${escapeHtml(copy.retryAudio)}</button>`}</div></div>`;
}

function stateLabel(item, copy) {
  if (item.state === 'complete' && item.type === 'speaking') return copy.recordingSaved;
  if (item.state === 'complete') return `${item.answered} ${copy.of} ${item.total} ${copy.blanksFilled}`;
  if (item.state === 'partial') return `${item.answered} ${copy.of} ${item.total} ${copy.blanksFilled}`;
  return copy.unanswered;
}

function groupButton({ question, item, copy, currentQuestionId = '', action = 'nav-question', anchorScope = 'nav' }) {
  const number = globalQuestionNumber(question);
  const current = question.questionId === currentQuestionId;
  const label = `${sectionTitle(copy, question.sectionId)}, ${copy.question} ${number}, ${stateLabel(item, copy)}${item.flagged ? `, ${copy.flagged}` : ''}`;
  return `<button class="et-group-link ${classes(current && 'is-current', item.state === 'complete' && 'is-complete', item.state === 'partial' && 'is-partial', item.flagged && 'is-flagged')}" data-et-annotation-id="${anchorScope}/question/${escapeHtml(question.questionId)}" type="button" data-action="${action}" data-question-id="${escapeHtml(question.questionId)}" aria-label="${escapeHtml(label)}"${current ? ' aria-current="step"' : ''}><span class="et-group-number">${number}</span><span class="et-group-name">${escapeHtml(sectionTitle(copy, question.sectionId))} · ${escapeHtml(copy.question)} ${number}</span><span class="et-group-state">${escapeHtml(stateLabel(item, copy))}</span>${item.flagged ? '<span class="et-flag-symbol" aria-hidden="true">⚑</span>' : ''}</button>`;
}

function renderPartDock({ sections, summary, copy, currentQuestion }) {
  const currentSection = currentQuestion?.sectionId || SECTION_ORDER[0];
  const groups = sectionQuestions(sections, currentSection);
  return `<nav class="et-part-dock" aria-label="${escapeHtml(copy.partNavigation)}"><div class="et-part-row"><div class="et-part-buttons">${SECTION_ORDER.map((sectionId) => `<button class="et-part-button${currentSection === sectionId ? ' is-current' : ''}" type="button" data-et-annotation-id="nav/section/${sectionId}" data-action="nav-part" data-section-id="${sectionId}"${currentSection === sectionId ? ' aria-current="step"' : ''}>${escapeHtml(sectionTitle(copy, sectionId))}<span>${sectionQuestions(sections, sectionId).length}</span></button>`).join('')}</div><button class="et-btn et-btn-small et-overview-button" type="button" data-action="open-overview">${escapeHtml(copy.overview)}</button></div><div class="et-part-groups">${groups.map((question) => groupButton({ question, item: itemFor(summary, question.questionId), copy, currentQuestionId: currentQuestion?.questionId })).join('')}</div><div class="et-part-footer"><span>${escapeHtml(copy.navLegend)}</span><button class="et-link-btn" type="button" data-action="review">${escapeHtml(copy.review)} →</button></div></nav>`;
}

function renderTask({ draft, question, questions, sections, summary, copy, audioState, recordingUrl = '', listeningState = {} }) {
  const qNo = questionNumber(question, questions);
  const sectionQuestionsForCurrent = sectionQuestions(sections, question.sectionId);
  const sectionPosition = Math.max(0, sectionQuestionsForCurrent.findIndex((item) => item.questionId === question.questionId)) + 1;
  const item = itemFor(summary, question.questionId);
  const instruction = instructionFor(question, draft, copy);
  const passage = `<div class="et-passage"><p>${question.type === 'speaking' ? `<span data-et-annotation-id="question/${escapeHtml(question.questionId)}/text/passage" data-et-text-run>${escapeHtml(question.text)}</span>` : questionParts(question, draft, copy)}</p></div>`;
  const taskBody = question.type === 'speaking' ? `${passage}${renderRecorder({ question, draft, copy, audioState, recordingUrl })}` : `${question.type === 'fill' ? renderListeningPlayer({ question, copy, audioState: listeningState }) : ''}${passage}`;
  return `<section class="et-screen et-question-screen" data-view="question" data-question-id="${escapeHtml(question.questionId)}"><div class="et-task-head"><div class="et-task-meta"><span class="et-task-section">${escapeHtml(sectionTitle(copy, question.sectionId))}</span><strong>${escapeHtml(copy.group)} ${sectionPosition} ${escapeHtml(copy.of)} ${sectionQuestionsForCurrent.length}</strong><span>${escapeHtml(copy.question)} ${globalQuestionNumber(question)} ${escapeHtml(copy.of)} ${questions.length}</span></div><button class="et-btn et-btn-small et-flag-btn" type="button" data-action="toggle-flag" data-question-id="${escapeHtml(question.questionId)}" aria-pressed="${item.flagged}">${escapeHtml(item.flagged ? copy.unflag : copy.flag)}</button></div><div class="et-task-stage" tabindex="-1"><p class="et-task-instruction">${escapeHtml(instruction)}</p>${taskBody}</div><div class="et-task-footer"><div class="et-task-footer-actions">${qNo > 1 ? `<button class="et-btn" type="button" data-action="previous-question">← ${escapeHtml(copy.previous)}</button>` : ''}${qNo < questions.length ? `<button class="et-btn et-btn-primary" type="button" data-action="next-question">${escapeHtml(copy.next)} →</button>` : `<button class="et-btn et-btn-primary" type="button" data-action="review">${escapeHtml(copy.review)} →</button>`}</div></div>${renderPartDock({ sections, summary, copy, currentQuestion: question })}${renderOverviewDialog({ sections, summary, copy, currentQuestionId: question.questionId })}</section>`;
}

function renderOverviewDialog({ sections, summary, copy, currentQuestionId = '' }) {
  return `<dialog class="et-overview-dialog" id="et-overview-dialog" aria-labelledby="et-overview-title"><div class="et-dialog-head"><h2 class="et-dialog-title" id="et-overview-title">${escapeHtml(copy.overview)}</h2><button class="et-btn et-btn-small" type="button" data-action="close-overview">${escapeHtml(copy.close)}</button></div><div class="et-dialog-body">${SECTION_ORDER.map((sectionId) => `<section class="et-dialog-section"><h3>${escapeHtml(sectionTitle(copy, sectionId))}</h3>${sectionQuestions(sections, sectionId).map((question) => groupButton({ question, item: itemFor(summary, question.questionId), copy, currentQuestionId, anchorScope: 'overview' })).join('')}</section>`).join('')}</div></dialog>`;
}

function sectionReviewCount(sectionId, items, summary, copy) {
  const stats = summary.bySection?.[sectionId] || {};
  if (sectionId === 'speaking') return `${Number(stats.answered || items.filter((item) => item.state === 'complete').length)} ${escapeHtml(copy.recordingsSaved)}`;
  const total = Number(stats.blanks ?? items.reduce((sum, item) => sum + Number(item.total || 0), 0));
  const answered = Number(stats.answered || items.reduce((sum, item) => sum + Number(item.answered || 0), 0));
  return `${answered} ${escapeHtml(copy.of)} ${total} ${escapeHtml(copy.blanksFilled)}`;
}

function renderReview({ draft, questions, sections, summary, copy, submitting = false }) {
  const missingWritten = summary.items.flatMap((item) => item.type === 'speaking' ? [] : item.missingBlankIds.map((blankId) => ({ ...item, blankId })));
  const missingQuestions = summary.items.filter((item) => item.state !== 'complete');
  const missingSpeaking = missingQuestions.some((item) => item.type === 'speaking');
  const canSubmit = !missingSpeaking && (!missingWritten.length || draft.reviewAcknowledged);
  const questionById = (questionId) => questions.find((question) => question.questionId === questionId) || {};
  return `<section class="et-screen et-review" data-view="review"><header class="et-screen-header"><span class="et-title-rule" aria-hidden="true"></span><h1 class="et-title">${escapeHtml(copy.reviewTitle)}</h1><p class="et-lead">${escapeHtml(copy.reviewLead)}</p></header><div class="et-review-list">${SECTION_ORDER.map((sectionId) => { const sectionItems = summary.items.filter((item) => item.sectionId === sectionId); const sectionMissing = sectionItems.filter((item) => item.state !== 'complete'); return `<section class="et-review-section"><div class="et-review-head"><h2 class="et-review-name">${escapeHtml(sectionTitle(copy, sectionId))}</h2><span class="et-review-count">${sectionReviewCount(sectionId, sectionItems, summary, copy)}</span></div><div class="et-review-groups">${sectionQuestions(sections, sectionId).map((question) => groupButton({ question, item: itemFor(summary, question.questionId), copy, currentQuestionId: draft.activeQuestionId, anchorScope: 'review' })).join('')}</div>${sectionMissing.length ? `<div class="et-review-missing">${sectionMissing.map((item) => { const question = questionById(item.questionId); const title = `${sectionTitle(copy, sectionId)} · ${copy.question} ${globalQuestionNumber(question)}`; if (!item.missingBlankIds.length) return `<button class="et-review-item" type="button" data-action="jump-question" data-question-id="${escapeHtml(item.questionId)}">${escapeHtml(title)} — ${escapeHtml(copy.recordingMissing)}</button>`; return `<details class="et-review-details" data-et-disclosure="${escapeHtml(item.questionId)}" data-et-annotation-id="review/disclosure/${escapeHtml(item.questionId)}"><summary>${escapeHtml(title)} — ${item.missingBlankIds.length} ${escapeHtml(copy.blanksMissing)}</summary><div class="et-review-detail-links">${item.missingBlankIds.map((blankId) => `<button class="et-review-item" type="button" data-action="jump-blank" data-question-id="${escapeHtml(item.questionId)}" data-blank-id="${escapeHtml(blankId)}">${escapeHtml(copy.blank)} ${blankNumber(question, blankId)}</button>`).join('')}</div></details>`; }).join('')}</div>` : ''}</section>`; }).join('')}</div>${missingWritten.length || missingSpeaking ? `<p class="et-review-note">${missingWritten.length ? escapeHtml(`${missingWritten.length} ${copy.blanksMissing}`) : ''}${missingSpeaking ? (missingWritten.length ? ' · ' : '') + escapeHtml(copy.recordingMissing) : ''}</p>` : ''}<div class="et-submit-panel">${missingWritten.length ? `<label class="et-acknowledge"><input type="checkbox" data-action="review-ack"${draft.reviewAcknowledged ? ' checked' : ''} /> ${escapeHtml(copy.acknowledge)} · ${missingWritten.length} ${escapeHtml(copy.writtenAnswersRemain)}</label>` : ''}<div class="et-actions"><button class="et-btn" type="button" data-action="back-to-question">${escapeHtml(copy.backToReview)}</button><button class="et-btn et-btn-primary" type="button" data-action="submit-demo"${canSubmit && !submitting ? '' : ' disabled'}>${escapeHtml(submitting ? copy.submitting : copy.submitDemo)}</button></div></div></section>`;
}

function formatCommittedAt(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function renderDone({ draft, copy, summary }) {
  const submission = draft.submission;
  const committed = Boolean(submission?.receiptId && submission?.committedAt);
  const memoryOnly = submission?.mode === 'memory-only';
  const status = memoryOnly ? copy.doneMemory : committed ? copy.doneSaved : copy.donePreview;
  return `<section class="et-screen et-done" data-view="done"><header class="et-screen-header"><span class="et-title-rule" aria-hidden="true"></span><h1 class="et-title">${escapeHtml(copy.doneTitle)}</h1><p class="et-lead">${escapeHtml(status)}</p></header><div class="et-done-receipt" data-receipt-mode="demo-local"><div class="et-receipt-label">${escapeHtml(copy.receipt)}</div>${committed ? `<div class="et-receipt-id">${escapeHtml(submission.receiptId)}</div><dl class="et-receipt-meta"><div><dt>${escapeHtml(copy.receiptSavedAt)}</dt><dd>${escapeHtml(formatCommittedAt(submission.committedAt))}</dd></div><div><dt>${escapeHtml(copy.responses)}</dt><dd>${escapeHtml(`${summary?.completeQuestions || 0} ${copy.of} ${summary?.totalQuestions || 0} ${copy.groupsComplete}`)}</dd></div></dl>` : `<p class="et-receipt-preview">${escapeHtml(memoryOnly ? copy.doneMemory : copy.donePreview)}</p>`}</div><div class="et-actions"><button class="et-btn et-btn-primary" type="button" data-action="done-again">${escapeHtml(copy.doneAgain)}</button></div></section>`;
}

function renderRecovery({ copy, recovery }) {
  return `<section class="et-screen" data-view="intro"><div class="et-recovery"><span class="et-title-rule" aria-hidden="true"></span><h1 class="et-recovery-title">${escapeHtml(copy.recoveryTitle)}</h1><p class="et-recovery-copy">${escapeHtml(recovery?.message || copy.recoveryCopy)}</p><div class="et-actions"><button class="et-btn et-btn-primary" type="button" data-action="new-demo">${escapeHtml(copy.recoverNew)}</button></div></div></section>`;
}

function renderFooterStatus({ copy }) {
  return `<span class="et-footer-note" data-demo-scope>${escapeHtml(copy.demoLabel)}</span>`;
}

function renderAppContent({ draft, sections = [], questions = [], summary, currentQuestion, copy, persistenceState = 'saved', audioState = {}, recordingUrl = '', listeningState = {}, recovery = null, submitting = false }) {
  if (recovery) return renderRecovery({ copy, recovery });
  if (draft.view === 'question' && currentQuestion) return renderTask({ draft, question: currentQuestion, questions, sections, summary, copy, audioState, recordingUrl, listeningState });
  if (draft.view === 'miccheck') return renderMiccheck({ copy, audioState });
  if (draft.view === 'review') return renderReview({ draft, questions, sections, summary, copy, submitting });
  if (draft.view === 'done') return renderDone({ draft, copy, summary });
  return renderIntro({ draft, sections, summary, copy });
}

function renderApp(options) {
  const prefix = options.draft.view === 'question' ? `question/${options.currentQuestion?.questionId}` : options.draft.view;
  let html = renderAppContent(options);
  const targets = { 'et-title': 'title', 'et-lead': 'body', 'et-task-instruction': 'instructions', 'et-passage': 'passage', 'et-recorder': 'recorder', 'et-mic-stage': 'recorder', 'et-listening-player': 'player', 'et-review-list': 'summary', 'et-done-receipt': 'receipt', 'et-task-stage': 'stage', 'et-task-footer': 'footer' };
  for (const [cls, id] of Object.entries(targets)) html = html.replace(`class="${cls}"`, `class="${cls}" data-et-annotation-id="${prefix}/${id}"`);
  return html;
}

export { escapeHtml, renderHeaderTools, renderApp, renderFooterStatus, SECTION_ORDER };
