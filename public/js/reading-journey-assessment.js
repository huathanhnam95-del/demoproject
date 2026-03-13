import {
  buildQuizStatusMessage,
  checkClickWordAnswer,
  checkEvidenceTap
} from './reading-journey-quiz-utils.js';
import { summarizeQuizPerformance } from './reading-journey-quiz-results.js';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    '\'': '&#39;'
  }[char] || char));
}

function normalizeAnswerText(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function normalizeAssessmentToken(value) {
  return normalizeAnswerText(value).replace(/^[^a-z0-9']+|[^a-z0-9']+$/gi, '');
}

export function createEmptyAssessmentState() {
  return {
    loading: false,
    deck: null,
    tokenizedStory: null,
    currentQuestionIndex: 0,
    answers: {},
    results: [],
    reviewWrite: null
  };
}

export function getCurrentQuizQuestion(assessmentState) {
  const assessment = assessmentState && typeof assessmentState === 'object' ? assessmentState : {};
  const questions = Array.isArray(assessment.deck?.questions) ? assessment.deck.questions : [];
  return questions[assessment.currentQuestionIndex] || null;
}

export function ensureAnswerState(assessmentState, question) {
  const assessment = assessmentState && typeof assessmentState === 'object' ? assessmentState : {};
  if (!question?.id) return {};

  if (!assessment.answers || typeof assessment.answers !== 'object') {
    assessment.answers = {};
  }

  if (!assessment.answers[question.id]) {
    assessment.answers[question.id] = {
      selectedOptionId: '',
      text: '',
      order: Array.isArray(question.items) ? question.items.map((item) => item.id) : [],
      attempts: 0,
      resolved: false,
      correct: false,
      feedback: '',
      hintParagraphIndex: null,
      selectedParagraphIndex: null,
      selectedTokenId: '',
      wrongTokenId: ''
    };
  }

  return assessment.answers[question.id];
}

export function isQuestionReady(question, answer) {
  if (!question) return false;

  switch (question.type) {
    case 'click_word_meaning':
    case 'tap_evidence':
      return Boolean(answer?.resolved);
    case 'mcq_main_idea':
      return Boolean(answer?.selectedOptionId);
    case 'short_answer':
      return Boolean(String(answer?.text || '').trim());
    case 'sequence_events':
      return Array.isArray(answer?.order) && answer.order.length === (question.items || []).length;
    default:
      return false;
  }
}

function buildQuizFooterMarkup({ isFinalQuestion, ready }) {
  return `
    <div class="rj-quiz__footer">
      <button class="rj-btn rj-btn--outline" type="button" id="rj-quiz-exit-btn">Exit Quiz</button>
      <button class="rj-btn rj-btn--primary" type="button" id="rj-quiz-next-btn" ${ready ? '' : 'disabled'}>
        ${isFinalQuestion ? 'Submit' : 'Next'}
      </button>
    </div>
  `;
}

export function buildCompletionSummaryMarkup({
  title,
  level,
  choicesMade,
  skipped = false,
  note = '',
  questionCount = 5
} = {}) {
  const safeChoices = Array.isArray(choicesMade) ? choicesMade : [];
  const completionNote = note || (skipped
    ? 'Assessment skipped for now. You can come back to it before starting a new story.'
    : 'Check your understanding with a short mix of comprehension and vocabulary questions.');

  return `
    <div class="rj-complete__hero">
      <div class="rj-complete__badge">🏆</div>
      <h2>Journey Complete!</h2>
      <p class="rj-muted">You've successfully finished "${escapeHtml(title)}"</p>
    </div>

    <div class="rj-report">
      <div class="rj-report__row">
        <span class="rj-report__label">Topic</span>
        <span class="rj-report__val">${escapeHtml(title)}</span>
      </div>
      <div class="rj-report__row">
        <span class="rj-report__label">Level</span>
        <span class="rj-report__val">${escapeHtml(level)}</span>
      </div>
      <div class="rj-report__row">
        <span class="rj-report__label">Date</span>
        <span class="rj-report__val">${new Date().toLocaleDateString()}</span>
      </div>
    </div>

    <div class="rj-complete__assessment">
      <div>
        <div class="rj-quiz__eyebrow">Reader's Notebook</div>
        <h3 class="rj-complete__assessment-title">Learning check</h3>
        <p id="rj-complete-note" class="rj-muted">${escapeHtml(completionNote)}</p>
      </div>
      <div class="rj-complete__assessment-meta">
        <span class="rj-complete__level">${escapeHtml(level)}</span>
        <span class="rj-complete__count">${Number(questionCount) || 5} quick prompts</span>
      </div>
    </div>

    <div class="rj-path-diagram">
      <div class="rj-path-label">Your Path</div>
      <div class="rj-path-track">
        ${safeChoices.map((icon, index) => `
          <div class="rj-path-node">
            <span class="rj-path-icon">${icon}</span>
            <span class="rj-path-beat">Beat ${index + 1}</span>
          </div>
          ${index < safeChoices.length - 1 ? '<div class="rj-path-arrow">→</div>' : ''}
        `).join('')}
      </div>
    </div>

    <div class="rj-complete__actions">
      <button class="rj-btn rj-btn--primary" type="button" id="rj-launch-quiz-btn">Check Understanding</button>
      <button class="rj-btn rj-btn--outline" type="button" id="rj-skip-quiz-btn">Skip for now</button>
      <button class="rj-btn rj-btn--outline" type="button" id="rj-copy-btn">Copy Story</button>
      <button class="rj-btn rj-btn--outline" type="button" id="rj-new-journey-btn">New Journey</button>
    </div>
  `;
}

export function buildQuizInteractionMarkup(question, answer) {
  if (!question) return '';

  if (question.type === 'mcq_main_idea') {
    const options = Array.isArray(question.options) ? question.options : [];
    return `
      <fieldset class="rj-quiz-options">
        ${options.map((option, index) => `
          <label class="rj-quiz-option">
            <input
              type="radio"
              name="rj-quiz-option"
              value="${escapeHtml(option.id)}"
              ${answer?.selectedOptionId === option.id ? 'checked' : ''}
            >
            <span class="rj-quiz-option__badge">${String.fromCharCode(65 + index)}</span>
            <span>${escapeHtml(option.text)}</span>
          </label>
        `).join('')}
      </fieldset>
    `;
  }

  if (question.type === 'short_answer') {
    return `
      <label class="rj-label" for="rj-quiz-short-answer">Your answer</label>
      <textarea id="rj-quiz-short-answer" class="rj-textarea rj-quiz__textarea" placeholder="Write one short answer...">${escapeHtml(answer?.text || '')}</textarea>
    `;
  }

  if (question.type === 'sequence_events') {
    const order = Array.isArray(answer?.order) ? answer.order : [];
    const itemsById = new Map((question.items || []).map((item) => [item.id, item]));
    return `
      <div class="rj-quiz-sequence">
        ${order.map((itemId, index) => {
          const item = itemsById.get(itemId);
          return `
            <div class="rj-quiz-sequence__item">
              <span class="rj-quiz-sequence__index">${index + 1}</span>
              <div class="rj-quiz-sequence__text">${escapeHtml(item?.text || '')}</div>
              <div class="rj-quiz-sequence__actions">
                <button class="rj-icon-btn" type="button" data-move="up" data-item-id="${escapeHtml(itemId)}" ${index === 0 ? 'disabled' : ''}>↑</button>
                <button class="rj-icon-btn" type="button" data-move="down" data-item-id="${escapeHtml(itemId)}" ${index === order.length - 1 ? 'disabled' : ''}>↓</button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  return `
    <div class="rj-quiz-passage">
      <div class="rj-quiz-passage__label">Story Passage</div>
      <div id="rj-quiz-passage-body" class="rj-quiz-passage__body"></div>
    </div>
  `;
}

export function buildQuizQuestionMarkup({
  title,
  level,
  question,
  questionNumber,
  totalQuestions,
  answer,
  interactionMarkup
} = {}) {
  return `
    <div class="rj-quiz">
      <div class="rj-quiz__header">
        <div>
          <div class="rj-quiz__eyebrow">Reader's Notebook</div>
          <h2 class="rj-quiz__title">Check Understanding</h2>
          <p class="rj-muted">Short retrieval practice based on "${escapeHtml(title)}".</p>
        </div>
        <div class="rj-quiz__meta">
          <span class="rj-complete__level">${escapeHtml(level)}</span>
          <span class="rj-quiz__progress">Question ${questionNumber} of ${totalQuestions}</span>
        </div>
      </div>

      <div id="rj-quiz-status" class="rj-quiz__status" aria-live="polite" aria-atomic="true">${escapeHtml(answer?.feedback || '')}</div>

      <div class="rj-quiz__card">
        <div class="rj-quiz__prompt-wrap">
          <span class="rj-quiz__skill">${escapeHtml(question?.skill)}</span>
          <h3 class="rj-quiz__prompt">${escapeHtml(question?.prompt)}</h3>
        </div>
        <div id="rj-quiz-interaction" class="rj-quiz__interaction">${interactionMarkup || ''}</div>
        ${answer?.resolved ? `<div class="rj-quiz__explanation">${escapeHtml(question?.explanation || '')}</div>` : ''}
      </div>

      ${buildQuizFooterMarkup({
        isFinalQuestion: questionNumber === totalQuestions,
        ready: isQuestionReady(question, answer)
      })}
    </div>
  `;
}

export function buildQuizResultsMarkup({
  level,
  results,
  reviewWrite
} = {}) {
  const safeResults = Array.isArray(results) ? results : [];
  const summary = summarizeQuizPerformance(safeResults, { level });
  const strengths = summary.strengths.length ? summary.strengths.join(', ') : 'Keep building your recall';
  const reviewAreas = summary.reviewAreas.length ? summary.reviewAreas.join(', ') : 'None this round';
  const queuedCount = Number(reviewWrite?.enqueuedCount) || 0;
  const nextStoryLabel = summary.recommendation.key === 'harder_level'
    ? `Try ${summary.recommendation.suggestedLevel}`
    : `Read Another ${summary.recommendation.suggestedLevel}`;

  return `
    <div class="rj-quiz-results">
      <div class="rj-complete__hero">
        <div class="rj-complete__badge">📝</div>
        <h2>Understanding Check Complete</h2>
        <p class="rj-muted">${summary.correctCount} of ${safeResults.length} correct. ${summary.recommendation.title}.</p>
      </div>

      <div class="rj-quiz-results__score">
        <div class="rj-quiz-results__percent">${summary.scorePercent}%</div>
        <div>
          <div class="rj-quiz-results__label">Reader's Notebook Score</div>
          <div class="rj-muted">${summary.recommendation.detail}</div>
        </div>
      </div>

      <div class="rj-quiz-results__summary-grid">
        <article class="rj-quiz-results__summary-card">
          <div class="rj-quiz-results__label">Strengths</div>
          <p>${escapeHtml(strengths)}</p>
        </article>
        <article class="rj-quiz-results__summary-card">
          <div class="rj-quiz-results__label">Review Areas</div>
          <p>${escapeHtml(reviewAreas)}</p>
        </article>
        <article class="rj-quiz-results__summary-card">
          <div class="rj-quiz-results__label">Saved For Review</div>
          <p>${queuedCount} missed ${queuedCount === 1 ? 'item' : 'items'} added to the spaced queue on this device.</p>
        </article>
      </div>

      <div class="rj-quiz-results__list">
        ${safeResults.map((item) => `
          <article class="rj-quiz-results__item ${item.correct ? 'rj-quiz-results__item--correct' : 'rj-quiz-results__item--missed'}">
            <div class="rj-quiz-results__item-head">
              <span class="rj-quiz__skill">${escapeHtml(item.skill)}</span>
              <span class="rj-quiz-results__badge">${item.correct ? 'Correct' : 'Review'}</span>
            </div>
            <h3>${escapeHtml(item.prompt)}</h3>
            <p>${escapeHtml(item.explanation)}</p>
            ${!item.correct ? `<p><strong>Correct answer:</strong> ${escapeHtml(item.correctAnswer || 'Review the passage.')}</p>` : ''}
            ${!item.correct && item.evidenceText ? `<p><strong>Evidence:</strong> ${escapeHtml(item.evidenceText)}</p>` : ''}
          </article>
        `).join('')}
      </div>

      <div class="rj-complete__actions">
        <button class="rj-btn rj-btn--primary" type="button" id="rj-retry-quiz-btn">Retry Quiz</button>
        <button class="rj-btn rj-btn--outline" type="button" id="rj-next-story-btn">${escapeHtml(nextStoryLabel)}</button>
        <button class="rj-btn rj-btn--outline" type="button" id="rj-copy-btn">Copy Story</button>
      </div>
    </div>
  `;
}

export function applyClickWordSelection(answer, question, token) {
  const nextAnswer = answer && typeof answer === 'object' ? answer : {};
  const result = checkClickWordAnswer(question, token);

  nextAnswer.selectedTokenId = token.id;
  nextAnswer.wrongTokenId = '';
  nextAnswer.hintParagraphIndex = result.paragraphIndex;

  if (result.correct) {
    nextAnswer.correct = true;
    nextAnswer.resolved = true;
    nextAnswer.feedback = buildQuizStatusMessage({ correct: true, promptType: question.type });
  } else if (nextAnswer.attempts === 0) {
    nextAnswer.attempts = 1;
    nextAnswer.correct = false;
    nextAnswer.resolved = false;
    nextAnswer.wrongTokenId = token.id;
    nextAnswer.feedback = buildQuizStatusMessage({ correct: false, retryAvailable: true, promptType: question.type });
  } else {
    nextAnswer.attempts = 2;
    nextAnswer.correct = false;
    nextAnswer.resolved = true;
    nextAnswer.feedback = buildQuizStatusMessage({ correct: false, retryAvailable: false, promptType: question.type });
  }

  return nextAnswer;
}

export function applyEvidenceSelection(answer, question, paragraphIndex) {
  const nextAnswer = answer && typeof answer === 'object' ? answer : {};
  const result = checkEvidenceTap(question, paragraphIndex);

  nextAnswer.selectedParagraphIndex = paragraphIndex;
  nextAnswer.wrongTokenId = '';
  nextAnswer.hintParagraphIndex = result.paragraphIndex;

  if (result.correct) {
    nextAnswer.correct = true;
    nextAnswer.resolved = true;
    nextAnswer.feedback = buildQuizStatusMessage({ correct: true, promptType: question.type });
  } else if (nextAnswer.attempts === 0) {
    nextAnswer.attempts = 1;
    nextAnswer.correct = false;
    nextAnswer.resolved = false;
    nextAnswer.wrongTokenId = `paragraph-${paragraphIndex}`;
    nextAnswer.feedback = buildQuizStatusMessage({ correct: false, retryAvailable: true, promptType: question.type });
  } else {
    nextAnswer.attempts = 2;
    nextAnswer.correct = false;
    nextAnswer.resolved = true;
    nextAnswer.feedback = buildQuizStatusMessage({ correct: false, retryAvailable: false, promptType: question.type });
  }

  return nextAnswer;
}
