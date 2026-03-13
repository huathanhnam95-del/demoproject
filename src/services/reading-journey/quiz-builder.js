const gemini = require('./gemini');
const {
  QUESTION_TYPES,
  normalizeQuizDeck,
  validateQuizQuestion
} = require('./quiz-contracts');

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'that', 'this', 'these', 'those', 'with', 'from',
  'into', 'onto', 'about', 'after', 'before', 'under', 'over', 'again', 'their', 'there', 'because',
  'through', 'quiet', 'small', 'final', 'kind'
]);

const VOCAB_MEANINGS = Object.freeze({
  note: 'a short written message',
  clue: 'a detail that helps solve a mystery',
  envelope: 'a paper cover for a letter',
  bookmark: 'something used to keep your place in a book',
  relieved: 'feeling calm after worry',
  reward: 'something good given for helpful behavior',
  honesty: 'the quality of telling the truth and doing the right thing'
});

function normalizeScalar(value) {
  return String(value ?? '').trim();
}

function normalizeLevel(level) {
  return gemini.normalizeLevel(level);
}

function splitSentences(text) {
  const source = normalizeScalar(text);
  if (!source) return [];
  return source.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) || [source];
}

function buildStorySnapshot({ outline, segments, endWrap }) {
  const paragraphs = [];
  const safeSegments = Array.isArray(segments) ? segments : [];

  safeSegments.forEach((segment, index) => {
    const text = normalizeScalar(segment);
    if (!text) return;
    const sentences = splitSentences(text).map((sentence, sentenceIndex) => ({
      id: `p${index + 1}s${sentenceIndex + 1}`,
      text: normalizeScalar(sentence)
    })).filter((sentence) => sentence.text);

    paragraphs.push({
      id: `p${index + 1}`,
      text,
      sentences
    });
  });

  const ending = normalizeScalar(endWrap);
  if (ending) {
    const index = paragraphs.length;
    paragraphs.push({
      id: `p${index + 1}`,
      text: ending,
      sentences: splitSentences(ending).map((sentence, sentenceIndex) => ({
        id: `p${index + 1}s${sentenceIndex + 1}`,
        text: normalizeScalar(sentence)
      })).filter((sentence) => sentence.text)
    });
  }

  return {
    title: normalizeScalar(outline?.title),
    paragraphs
  };
}

function buildQuestionId(outlineId, suffix) {
  return `${normalizeScalar(outlineId) || 'outline'}-${suffix}`;
}

function extractCandidateWords(highlights, storySnapshot) {
  const paragraphs = Array.isArray(storySnapshot?.paragraphs) ? storySnapshot.paragraphs : [];
  const paragraphTexts = paragraphs.map((paragraph) => String(paragraph.text || ''));
  const candidates = [];
  const safeHighlights = Array.isArray(highlights) ? highlights : [];

  safeHighlights.forEach((group) => {
    const safeGroup = Array.isArray(group) ? group : [group];
    safeGroup.forEach((phrase) => {
      const value = normalizeScalar(phrase);
      if (!value) return;
      value.split(/[\s-]+/).forEach((word) => {
        const normalizedWord = normalizeScalar(word).replace(/[^A-Za-z']/g, '').toLowerCase();
        if (!normalizedWord || STOPWORDS.has(normalizedWord) || normalizedWord.length < 4) return;
        paragraphTexts.forEach((paragraphText, paragraphIndex) => {
          const regex = new RegExp(`\\b${normalizedWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
          if (regex.test(paragraphText)) {
            candidates.push({ word: normalizedWord, paragraphIndex });
          }
        });
      });
    });
  });

  for (let paragraphIndex = 0; paragraphIndex < paragraphTexts.length; paragraphIndex += 1) {
    const words = paragraphTexts[paragraphIndex].match(/\b[A-Za-z']+\b/g) || [];
    words.forEach((word) => {
      const normalizedWord = word.toLowerCase();
      if (!STOPWORDS.has(normalizedWord) && normalizedWord.length >= 4) {
        candidates.push({ word: normalizedWord, paragraphIndex });
      }
    });
  }

  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = `${candidate.word}|${candidate.paragraphIndex}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function findWordTarget(storySnapshot, highlights) {
  const candidates = extractCandidateWords(highlights, storySnapshot);
  if (!candidates.length) {
    return {
      word: 'story',
      paragraphIndex: 0,
      acceptedSurfaceForms: ['story']
    };
  }

  const preferred = candidates.find((candidate) => VOCAB_MEANINGS[candidate.word]) || candidates[0];
  return {
    word: preferred.word,
    paragraphIndex: preferred.paragraphIndex,
    acceptedSurfaceForms: [preferred.word]
  };
}

function buildMainIdeaQuestion({ outlineId, outline }) {
  const title = normalizeScalar(outline?.title) || 'the story';
  return {
    id: buildQuestionId(outlineId, 'main-idea'),
    type: QUESTION_TYPES.MCQ_MAIN_IDEA,
    skill: 'comprehension',
    prompt: `What is the main idea of "${title}"?`,
    options: [
      { id: 'a', text: 'A student follows clues and learns her kindness is valued.' },
      { id: 'b', text: 'A storm forces the library to close early.' },
      { id: 'c', text: 'Two friends plan to hide books from a teacher.' },
      { id: 'd', text: 'A class forgets to return a library atlas.' }
    ],
    correctOptionId: 'a'
  };
}

function buildClickWordQuestion({ outlineId, storySnapshot, highlights }) {
  const target = findWordTarget(storySnapshot, highlights);
  return {
    id: buildQuestionId(outlineId, 'click-word'),
    type: QUESTION_TYPES.CLICK_WORD_MEANING,
    skill: 'vocabulary',
    prompt: `Click the word that means: ${VOCAB_MEANINGS[target.word] || `a key idea in the story ("${target.word}")`}.`,
    target
  };
}

function buildTapEvidenceQuestion({ outlineId, storySnapshot }) {
  const paragraphs = storySnapshot.paragraphs || [];
  const paragraphIndex = Math.max(0, paragraphs.findIndex((paragraph) =>
    /thank-you|reward|honesty|helping/i.test(paragraph.text)
  ));
  const evidenceText = normalizeScalar(paragraphs[paragraphIndex]?.text || paragraphs[0]?.text || '');
  const anchor = evidenceText.split(/(?<=[.!?])\s+/)[0] || evidenceText;

  return {
    id: buildQuestionId(outlineId, 'tap-evidence'),
    type: QUESTION_TYPES.TAP_EVIDENCE,
    skill: 'comprehension',
    prompt: 'Tap the paragraph that proves Maya was appreciated for her good actions.',
    target: {
      paragraphIndex,
      evidenceAnchors: [anchor]
    }
  };
}

function buildSequenceQuestion({ outlineId, beatOutline }) {
  const milestones = (Array.isArray(beatOutline) ? beatOutline : []).slice(0, 3);
  const items = milestones.map((beat, index) => ({
    id: `event-${index + 1}`,
    text: normalizeScalar(beat?.milestone) || `Event ${index + 1}`
  }));

  while (items.length < 3) {
    const nextIndex = items.length + 1;
    items.push({ id: `event-${nextIndex}`, text: `Event ${nextIndex}` });
  }

  return {
    id: buildQuestionId(outlineId, 'sequence'),
    type: QUESTION_TYPES.SEQUENCE_EVENTS,
    skill: 'comprehension',
    prompt: 'Put these story events in the correct order.',
    items,
    correctOrder: items.map((item) => item.id)
  };
}

function buildShortAnswerQuestion({ outlineId, storySnapshot, level }) {
  const prompt = level === 'C1'
    ? 'In one or two sentences, explain what Maya learns from the surprise and why it matters.'
    : 'Why does Maya feel happy at the end of the story?';

  return {
    id: buildQuestionId(outlineId, 'short-answer'),
    type: QUESTION_TYPES.SHORT_ANSWER,
    skill: 'comprehension',
    prompt,
    rubric: {
      focus: level === 'C1' ? 'theme' : 'ending_reason',
      requireEvidence: level === 'C1'
    },
    idealAnswers: [
      'She learns that her quiet honesty and kindness were noticed and appreciated.'
    ]
  };
}

function buildFallbackQuestions({ outlineId, outline, storySnapshot, beatOutline, highlights, level }) {
  return [
    buildMainIdeaQuestion({ outlineId, outline }),
    buildClickWordQuestion({ outlineId, storySnapshot, highlights }),
    buildTapEvidenceQuestion({ outlineId, storySnapshot }),
    buildSequenceQuestion({ outlineId, beatOutline }),
    buildShortAnswerQuestion({ outlineId, storySnapshot, level })
  ];
}

function questionExistsInStory(question, storySnapshot) {
  const storyText = (storySnapshot.paragraphs || []).map((paragraph) => paragraph.text).join(' ').toLowerCase();

  if (question.type === QUESTION_TYPES.CLICK_WORD_MEANING) {
    const targetWord = normalizeScalar(question?.target?.word).toLowerCase();
    const paragraphIndex = Number(question?.target?.paragraphIndex);
    return Boolean(targetWord)
      && Number.isInteger(paragraphIndex)
      && paragraphIndex >= 0
      && paragraphIndex < storySnapshot.paragraphs.length
      && storyText.includes(targetWord);
  }

  if (question.type === QUESTION_TYPES.TAP_EVIDENCE) {
    const paragraphIndex = Number(question?.target?.paragraphIndex);
    return Number.isInteger(paragraphIndex)
      && paragraphIndex >= 0
      && paragraphIndex < storySnapshot.paragraphs.length;
  }

  return true;
}

function sanitizeQuestion(question, storySnapshot) {
  const result = validateQuizQuestion(question);
  if (!result.valid) return null;
  if (!questionExistsInStory(question, storySnapshot)) return null;
  return { ...question };
}

async function buildAssessmentQuiz({
  outline,
  outlineId,
  level = 'B1',
  segments,
  endWrap,
  beatOutline,
  highlights,
  draftGenerator
} = {}) {
  const safeLevel = normalizeLevel(level);
  const storySnapshot = buildStorySnapshot({ outline, segments, endWrap });
  const fallbackQuestions = buildFallbackQuestions({
    outlineId,
    outline,
    storySnapshot,
    beatOutline,
    highlights,
    level: safeLevel
  });

  let draftQuestions = [];
  try {
    const generator = typeof draftGenerator === 'function'
      ? draftGenerator
      : gemini.generateAssessmentQuizDraft;
    const draft = await generator({
      outline,
      outlineId,
      level: safeLevel,
      storySnapshot,
      beatOutline,
      highlights
    });
    draftQuestions = Array.isArray(draft?.questions) ? draft.questions : [];
  } catch (_) {
    draftQuestions = [];
  }

  const merged = [];
  const usedTypes = new Set();

  draftQuestions.forEach((question) => {
    const sanitized = sanitizeQuestion(question, storySnapshot);
    if (!sanitized) return;
    if (usedTypes.has(sanitized.type)) return;
    if (safeLevel === 'A2' && sanitized.type === QUESTION_TYPES.SHORT_ANSWER) {
      const shortAnswerCount = merged.filter((item) => item.type === QUESTION_TYPES.SHORT_ANSWER).length;
      if (shortAnswerCount >= 1) return;
    }
    merged.push(sanitized);
    usedTypes.add(sanitized.type);
  });

  fallbackQuestions.forEach((question) => {
    if (merged.length >= 5) return;
    if (usedTypes.has(question.type)) return;
    merged.push(question);
    usedTypes.add(question.type);
  });

  return normalizeQuizDeck({
    quizId: buildQuestionId(outlineId, 'assessment'),
    outlineId,
    level: safeLevel,
    storySnapshot,
    questions: merged.slice(0, 5)
  });
}

module.exports = {
  buildAssessmentQuiz,
  buildStorySnapshot
};
