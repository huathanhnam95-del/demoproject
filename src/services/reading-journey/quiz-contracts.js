const ALLOWED_LEVELS = new Set(['A2', 'B1', 'B2', 'C1']);

const QUESTION_TYPES = Object.freeze({
  MCQ_MAIN_IDEA: 'mcq_main_idea',
  CLICK_WORD_MEANING: 'click_word_meaning',
  TAP_EVIDENCE: 'tap_evidence',
  SEQUENCE_EVENTS: 'sequence_events',
  SHORT_ANSWER: 'short_answer'
});

function normalizeScalar(value) {
  return String(value ?? '').trim();
}

function normalizeLevel(level) {
  const value = normalizeScalar(level).toUpperCase();
  if (!ALLOWED_LEVELS.has(value)) {
    throw new Error(`Invalid level: ${level}`);
  }
  return value;
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function normalizeStorySnapshot(storySnapshot) {
  const input = storySnapshot && typeof storySnapshot === 'object' ? storySnapshot : {};
  const paragraphs = Array.isArray(input.paragraphs) ? input.paragraphs : [];

  return {
    title: normalizeScalar(input.title),
    paragraphs: paragraphs.map((paragraph, index) => ({
      id: normalizeScalar(paragraph?.id) || `p${index + 1}`,
      text: normalizeScalar(paragraph?.text),
      sentences: Array.isArray(paragraph?.sentences)
        ? paragraph.sentences.map((sentence, sentenceIndex) => ({
          id: normalizeScalar(sentence?.id) || `p${index + 1}s${sentenceIndex + 1}`,
          text: normalizeScalar(sentence?.text)
        })).filter((sentence) => sentence.text)
        : []
    }))
  };
}

function validateQuizQuestion(question) {
  const safeQuestion = question && typeof question === 'object' ? question : {};
  const errors = [];
  const type = normalizeScalar(safeQuestion.type);

  if (!normalizeScalar(safeQuestion.id)) errors.push('id is required');
  if (!type) errors.push('type is required');
  if (!normalizeScalar(safeQuestion.skill)) errors.push('skill is required');
  if (!normalizeScalar(safeQuestion.prompt)) errors.push('prompt is required');

  switch (type) {
    case QUESTION_TYPES.CLICK_WORD_MEANING: {
      const target = safeQuestion.target && typeof safeQuestion.target === 'object' ? safeQuestion.target : {};
      if (!normalizeScalar(target.word)) errors.push('target.word is required');
      if (!isNonNegativeInteger(target.paragraphIndex)) errors.push('target.paragraphIndex must be a non-negative integer');
      const acceptedSurfaceForms = Array.isArray(target.acceptedSurfaceForms)
        ? target.acceptedSurfaceForms.map((value) => normalizeScalar(value)).filter(Boolean)
        : [];
      if (acceptedSurfaceForms.length === 0) errors.push('target.acceptedSurfaceForms must contain at least one value');
      break;
    }
    case QUESTION_TYPES.TAP_EVIDENCE: {
      const target = safeQuestion.target && typeof safeQuestion.target === 'object' ? safeQuestion.target : {};
      if (!isNonNegativeInteger(target.paragraphIndex)) errors.push('target.paragraphIndex must be a non-negative integer');
      const evidenceAnchors = Array.isArray(target.evidenceAnchors)
        ? target.evidenceAnchors.map((value) => normalizeScalar(value)).filter(Boolean)
        : [];
      if (evidenceAnchors.length === 0) errors.push('target.evidenceAnchors must contain at least one value');
      break;
    }
    case QUESTION_TYPES.SEQUENCE_EVENTS: {
      const items = Array.isArray(safeQuestion.items) ? safeQuestion.items : [];
      const correctOrder = Array.isArray(safeQuestion.correctOrder) ? safeQuestion.correctOrder : [];
      if (items.length < 2) errors.push('items must contain at least two events');
      const itemIds = items.map((item) => normalizeScalar(item?.id)).filter(Boolean);
      if (itemIds.length !== items.length) errors.push('items must all contain stable ids');
      if (correctOrder.length !== items.length) errors.push('correctOrder must include every item id');
      const hasUnknownIds = correctOrder.some((id) => !itemIds.includes(normalizeScalar(id)));
      if (correctOrder.length === items.length && hasUnknownIds) {
        errors.push('correctOrder must only contain ids from items');
      }
      break;
    }
    case QUESTION_TYPES.SHORT_ANSWER: {
      const rubric = safeQuestion.rubric && typeof safeQuestion.rubric === 'object' ? safeQuestion.rubric : null;
      const idealAnswers = Array.isArray(safeQuestion.idealAnswers)
        ? safeQuestion.idealAnswers.map((value) => normalizeScalar(value)).filter(Boolean)
        : [];
      if (!rubric) errors.push('rubric is required');
      if (idealAnswers.length === 0) errors.push('idealAnswers must contain at least one value');
      break;
    }
    case QUESTION_TYPES.MCQ_MAIN_IDEA: {
      const options = Array.isArray(safeQuestion.options) ? safeQuestion.options : [];
      const optionIds = options.map((option) => normalizeScalar(option?.id)).filter(Boolean);
      if (options.length < 2) errors.push('options must contain at least two choices');
      if (!normalizeScalar(safeQuestion.correctOptionId)) {
        errors.push('correctOptionId is required');
      } else if (!optionIds.includes(normalizeScalar(safeQuestion.correctOptionId))) {
        errors.push('correctOptionId must match one of the option ids');
      }
      break;
    }
    default:
      if (type) errors.push(`Unsupported question type: ${type}`);
      break;
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

function normalizeQuizDeck(deck) {
  const safeDeck = deck && typeof deck === 'object' ? deck : {};
  const quizId = normalizeScalar(safeDeck.quizId);
  const outlineId = normalizeScalar(safeDeck.outlineId);
  const level = normalizeLevel(safeDeck.level);
  const questions = Array.isArray(safeDeck.questions) ? safeDeck.questions : [];
  const normalizedQuestions = questions.map((question) => ({ ...question }));
  const storySnapshot = normalizeStorySnapshot(safeDeck.storySnapshot);

  if (!quizId) {
    throw new Error('quizId is required');
  }
  if (!outlineId) {
    throw new Error('outlineId is required');
  }
  if (storySnapshot.paragraphs.length === 0) {
    throw new Error('storySnapshot must contain at least one paragraph');
  }

  normalizedQuestions.forEach((question) => {
    const result = validateQuizQuestion(question);
    if (!result.valid) {
      throw new Error(`Invalid question ${normalizeScalar(question?.id) || '(missing id)'}: ${result.errors.join('; ')}`);
    }
  });

  return {
    quizId,
    outlineId,
    level,
    storySnapshot,
    questions: normalizedQuestions
  };
}

function normalizeReviewItem(item) {
  const safeItem = item && typeof item === 'object' ? item : {};
  const reviewId = normalizeScalar(safeItem.reviewId);
  const questionType = normalizeScalar(safeItem.questionType);
  const prompt = normalizeScalar(safeItem.prompt);
  const level = normalizeLevel(safeItem.level);
  const storyTitle = normalizeScalar(safeItem.storyTitle);
  const reviewState = safeItem.reviewState && typeof safeItem.reviewState === 'object' ? safeItem.reviewState : {};

  if (!reviewId) throw new Error('reviewId is required');
  if (!questionType) throw new Error('questionType is required');
  if (!Object.values(QUESTION_TYPES).includes(questionType)) throw new Error(`Unsupported questionType: ${questionType}`);
  if (!prompt) throw new Error('prompt is required');
  if (!storyTitle) throw new Error('storyTitle is required');

  return {
    reviewId,
    questionType,
    prompt,
    level,
    storyTitle,
    reviewState: {
      intervalDays: Number(reviewState.intervalDays) || 0,
      nextReviewAt: Number(reviewState.nextReviewAt) || 0,
      failures: Number(reviewState.failures) || 0
    }
  };
}

function normalizeReviewQueue(queue) {
  if (!queue || typeof queue !== 'object') {
    return { version: 1, items: [] };
  }

  const version = Number(queue.version) || 1;
  const items = Array.isArray(queue.items) ? queue.items : [];
  const normalizedItems = [];

  items.forEach((item) => {
    try {
      normalizedItems.push(normalizeReviewItem(item));
    } catch (_) {
      // Drop malformed entries instead of throwing so the browser can recover.
    }
  });

  return {
    version,
    items: normalizedItems
  };
}

module.exports = {
  QUESTION_TYPES,
  normalizeQuizDeck,
  validateQuizQuestion,
  normalizeReviewQueue
};
