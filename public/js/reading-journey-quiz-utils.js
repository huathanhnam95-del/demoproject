function normalizeScalar(value) {
  return String(value ?? '').trim();
}

function normalizeTokenText(value) {
  return normalizeScalar(value).toLowerCase().replace(/^[^a-z0-9']+|[^a-z0-9']+$/gi, '');
}

export function normalizeAcceptedForms(values) {
  const safeValues = Array.isArray(values) ? values : [values];
  const seen = new Set();
  const out = [];

  safeValues.forEach((value) => {
    const normalized = normalizeTokenText(value);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    out.push(normalized);
  });

  return out;
}

function tokenizeParagraph(paragraph, paragraphIndex) {
  const paragraphId = normalizeScalar(paragraph?.id) || `p${paragraphIndex + 1}`;
  const text = normalizeScalar(paragraph?.text);
  const matches = text.match(/\b[\w']+\b/g) || [];

  return {
    id: paragraphId,
    text,
    sentences: Array.isArray(paragraph?.sentences) ? paragraph.sentences : [],
    tokens: matches.map((token, tokenIndex) => ({
      id: `${paragraphId}-w${tokenIndex + 1}`,
      text: token,
      normalized: normalizeTokenText(token),
      paragraphIndex
    }))
  };
}

export function tokenizeStorySnapshot(storySnapshot) {
  const safeSnapshot = storySnapshot && typeof storySnapshot === 'object' ? storySnapshot : {};
  const paragraphs = Array.isArray(safeSnapshot.paragraphs) ? safeSnapshot.paragraphs : [];

  return {
    title: normalizeScalar(safeSnapshot.title),
    paragraphs: paragraphs.map((paragraph, index) => tokenizeParagraph(paragraph, index))
  };
}

export function checkClickWordAnswer(question, selectedToken) {
  const target = question?.target && typeof question.target === 'object' ? question.target : {};
  const acceptedSurfaceForms = normalizeAcceptedForms(target.acceptedSurfaceForms?.length ? target.acceptedSurfaceForms : [target.word]);
  const selectedWord = normalizeTokenText(selectedToken?.text || selectedToken?.normalized);
  const matchedForm = acceptedSurfaceForms.find((value) => value === selectedWord) || '';

  return {
    correct: Boolean(matchedForm),
    paragraphIndex: Number(target.paragraphIndex) || 0,
    selectedWord,
    matchedForm
  };
}

export function checkEvidenceTap(question, selectedParagraphIndex) {
  const targetParagraphIndex = Number(question?.target?.paragraphIndex);
  return {
    correct: Number(selectedParagraphIndex) === targetParagraphIndex,
    paragraphIndex: Number.isInteger(targetParagraphIndex) ? targetParagraphIndex : 0
  };
}

export function computeSequenceResult(userOrder, correctOrder) {
  const safeUserOrder = Array.isArray(userOrder) ? userOrder.map((value) => normalizeScalar(value)) : [];
  const safeCorrectOrder = Array.isArray(correctOrder) ? correctOrder.map((value) => normalizeScalar(value)) : [];

  let correctCount = 0;
  const misplacedIds = [];

  safeUserOrder.forEach((value, index) => {
    if (value === safeCorrectOrder[index]) {
      correctCount += 1;
    } else if (value) {
      misplacedIds.push(value);
    }
  });

  return {
    correct: safeUserOrder.length === safeCorrectOrder.length && correctCount === safeCorrectOrder.length,
    correctCount,
    misplacedIds
  };
}

export function buildQuizStatusMessage({ correct, retryAvailable, promptType } = {}) {
  if (correct) return 'Correct. You can continue.';
  if (retryAvailable && promptType === 'click_word_meaning') {
    return 'Try again. The correct word is in the highlighted paragraph.';
  }
  if (retryAvailable && promptType === 'tap_evidence') {
    return 'Try again. Look for the evidence in the highlighted part of the story.';
  }
  return 'Not quite. Review the explanation and continue.';
}
