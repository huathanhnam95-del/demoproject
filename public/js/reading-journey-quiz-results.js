function normalizeScalar(value) {
  return String(value ?? '').trim();
}

function normalizeText(value) {
  return normalizeScalar(value).toLowerCase();
}

function getParagraphText(storySnapshot, paragraphIndex) {
  const paragraphs = Array.isArray(storySnapshot?.paragraphs) ? storySnapshot.paragraphs : [];
  return normalizeScalar(paragraphs[paragraphIndex]?.text);
}

function resolveCorrectAnswer(question) {
  if (!question || typeof question !== 'object') return '';

  switch (question.type) {
    case 'click_word_meaning':
      return normalizeScalar(question?.target?.word);
    case 'tap_evidence': {
      const anchors = Array.isArray(question?.target?.evidenceAnchors) ? question.target.evidenceAnchors : [];
      return anchors.map((value) => normalizeScalar(value)).filter(Boolean).join(' / ');
    }
    case 'mcq_main_idea': {
      const options = Array.isArray(question.options) ? question.options : [];
      const match = options.find((option) => normalizeScalar(option?.id) === normalizeScalar(question.correctOptionId));
      return normalizeScalar(match?.text);
    }
    case 'sequence_events': {
      const itemsById = new Map((Array.isArray(question.items) ? question.items : []).map((item) => [normalizeScalar(item?.id), item]));
      return (Array.isArray(question.correctOrder) ? question.correctOrder : [])
        .map((id) => normalizeScalar(itemsById.get(normalizeScalar(id))?.text))
        .filter(Boolean)
        .join(' -> ');
    }
    case 'short_answer': {
      const idealAnswers = Array.isArray(question.idealAnswers) ? question.idealAnswers : [];
      return normalizeScalar(idealAnswers[0]);
    }
    default:
      return '';
  }
}

function resolveEvidenceText(question, storySnapshot) {
  if (!question || typeof question !== 'object') return '';

  const paragraphIndex = Number(question?.target?.paragraphIndex);
  const paragraphText = Number.isInteger(paragraphIndex) ? getParagraphText(storySnapshot, paragraphIndex) : '';
  if (paragraphText) return paragraphText;

  const anchors = Array.isArray(question?.target?.evidenceAnchors)
    ? question.target.evidenceAnchors.map((value) => normalizeScalar(value)).filter(Boolean)
    : [];

  return anchors.join(' / ');
}

function isShortAnswerCorrect(question, answer) {
  const userText = normalizeText(answer?.text);
  const idealAnswers = Array.isArray(question?.idealAnswers) ? question.idealAnswers : [];
  return idealAnswers.some((value) => userText.includes(normalizeText(value)));
}

function isSequenceCorrect(question, answer) {
  const userOrder = Array.isArray(answer?.order) ? answer.order.map((value) => normalizeScalar(value)) : [];
  const correctOrder = Array.isArray(question?.correctOrder) ? question.correctOrder.map((value) => normalizeScalar(value)) : [];
  return userOrder.length === correctOrder.length && userOrder.every((value, index) => value === correctOrder[index]);
}

export function gradeQuizResults({ questions, answers, storySnapshot } = {}) {
  const safeQuestions = Array.isArray(questions) ? questions : [];
  const safeAnswers = answers && typeof answers === 'object' ? answers : {};

  return safeQuestions.map((question) => {
    const answer = safeAnswers[question.id] || {};
    let correct = false;

    if (question.type === 'click_word_meaning' || question.type === 'tap_evidence') {
      correct = Boolean(answer.correct);
    } else if (question.type === 'mcq_main_idea') {
      correct = normalizeScalar(answer.selectedOptionId) === normalizeScalar(question.correctOptionId);
    } else if (question.type === 'short_answer') {
      correct = isShortAnswerCorrect(question, answer);
    } else if (question.type === 'sequence_events') {
      correct = isSequenceCorrect(question, answer);
    }

    return {
      questionId: normalizeScalar(question.id),
      questionType: normalizeScalar(question.type),
      prompt: normalizeScalar(question.prompt),
      skill: normalizeScalar(question.skill) || 'comprehension',
      correct,
      explanation: normalizeScalar(question.explanation),
      correctAnswer: resolveCorrectAnswer(question),
      evidenceText: resolveEvidenceText(question, storySnapshot)
    };
  });
}

function buildRecommendation(scorePercent, level) {
  const levels = ['A2', 'B1', 'B2', 'C1'];
  const safeLevel = levels.includes(normalizeScalar(level).toUpperCase()) ? normalizeScalar(level).toUpperCase() : 'B1';
  const currentIndex = levels.indexOf(safeLevel);
  const harderLevel = currentIndex >= 0 && currentIndex < levels.length - 1 ? levels[currentIndex + 1] : safeLevel;

  if (scorePercent >= 90) {
    return {
      key: 'harder_level',
      title: 'Try a harder level next',
      detail: harderLevel === safeLevel ? `Stay at ${safeLevel} and choose a denser story next.` : `You look ready to try ${harderLevel}.`,
      suggestedLevel: harderLevel
    };
  }

  if (scorePercent >= 70) {
    return {
      key: 'same_level',
      title: 'Stay at the same level',
      detail: `Read another ${safeLevel} story to lock in the key ideas and vocabulary.`,
      suggestedLevel: safeLevel
    };
  }

  return {
    key: 'review',
    title: 'Review before moving on',
    detail: 'Retry the story or review the missed items before starting a harder text.',
    suggestedLevel: safeLevel
  };
}

export function summarizeQuizPerformance(rows, { level } = {}) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const correctCount = safeRows.filter((row) => row.correct).length;
  const totalQuestions = safeRows.length;
  const scorePercent = totalQuestions ? Math.round((correctCount / totalQuestions) * 100) : 0;

  const correctBySkill = { vocabulary: 0, comprehension: 0 };
  const missedBySkill = { vocabulary: 0, comprehension: 0 };

  safeRows.forEach((row) => {
    const bucket = normalizeText(row?.skill) === 'vocabulary' ? 'vocabulary' : 'comprehension';
    if (row?.correct) {
      correctBySkill[bucket] += 1;
    } else {
      missedBySkill[bucket] += 1;
    }
  });

  const strengths = Object.keys(correctBySkill).filter((key) => correctBySkill[key] > 0 && missedBySkill[key] === 0);
  const reviewAreas = Object.keys(missedBySkill).filter((key) => missedBySkill[key] > 0);

  return {
    totalQuestions,
    correctCount,
    scorePercent,
    correctBySkill,
    missedBySkill,
    strengths,
    reviewAreas,
    recommendation: buildRecommendation(scorePercent, level)
  };
}

export function buildMissedReviewItems(rows, { quizId, level, storyTitle } = {}) {
  const safeQuizId = normalizeScalar(quizId);
  const safeLevel = normalizeScalar(level).toUpperCase() || 'B1';
  const safeStoryTitle = normalizeScalar(storyTitle);

  return (Array.isArray(rows) ? rows : [])
    .filter((row) => !row.correct)
    .map((row) => ({
      reviewId: `${safeQuizId}:${normalizeScalar(row.questionId)}`,
      questionType: normalizeScalar(row.questionType),
      prompt: normalizeScalar(row.prompt),
      level: safeLevel,
      storyTitle: safeStoryTitle
    }));
}
