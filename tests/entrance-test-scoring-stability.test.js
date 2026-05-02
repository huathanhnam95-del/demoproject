/* eslint-disable no-console */
const assert = require('assert');

const { buildPublicSession, scoreSubmission, TEST_36PLUS } = require('../src/entrance-test/test36plus');

function normalizeSpaces(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function parseMultipleChoiceBlanks(raw, questionId) {
  const text = String(raw || '');
  const blanks = [];
  let cursor = 0;
  let blankIndex = 0;

  while (cursor < text.length) {
    const start = text.indexOf('__', cursor);
    if (start === -1) break;
    const end = text.indexOf('__', start + 2);
    if (end === -1) break;

    const inside = text.slice(start + 2, end);
    const options = inside
      .split('/')
      .map((s) => normalizeSpaces(s))
      .filter((s) => s.length > 0);

    blankIndex += 1;
    blanks.push({
      blankId: `${questionId}__b${blankIndex}`,
      options,
      correctAnswer: options[0] || ''
    });

    cursor = end + 2;
  }

  return blanks;
}

function getBlankOptionsFromSession(session, sectionId, questionId, blankId) {
  const sections = Array.isArray(session?.sections) ? session.sections : [];
  const section = sections.find((s) => String(s?.id || '') === sectionId) || null;
  const questions = Array.isArray(section?.questions) ? section.questions : [];
  const question = questions.find((q) => String(q?.questionId || '') === questionId) || null;
  const parts = Array.isArray(question?.parts) ? question.parts : [];
  const part = parts.find((p) => p && p.type === 'blank' && String(p.blankId || '') === blankId) || null;
  return Array.isArray(part?.options) ? part.options : null;
}

function findSeedWhereFirstOptionIsWrong({ sectionId, questionId, blankId, correctAnswer }) {
  for (let i = 0; i < 2500; i += 1) {
    const testId = `seed-${i}`;
    const session = buildPublicSession(testId);
    const options = getBlankOptionsFromSession(session, sectionId, questionId, blankId);
    if (!options || options.length < 2) continue;
    if (String(options[0]) !== String(correctAnswer)) {
      return { testId, options };
    }
  }
  return null;
}

function verifyScoringIgnoresShuffledOrdering() {
  const vocab = TEST_36PLUS.sections.find((s) => s.id === 'vocab');
  const q1 = vocab?.questions?.find((q) => q.id === 'vocab_q1') || null;
  assert(q1 && q1.raw, 'Missing vocab_q1 test content.');

  const blanks = parseMultipleChoiceBlanks(q1.raw, q1.id);
  assert.strictEqual(blanks.length, 4, 'Expected vocab_q1 to have 4 blanks.');

  const seedResult = findSeedWhereFirstOptionIsWrong({
    sectionId: 'vocab',
    questionId: 'vocab_q1',
    blankId: blanks[0].blankId,
    correctAnswer: blanks[0].correctAnswer
  });
  assert(seedResult, 'Failed to find a deterministic seed where shuffled options[0] is not the correct answer.');

  // Build a session for the chosen testId first; this should never affect canonical scoring.
  buildPublicSession(seedResult.testId);

  const responses = {
    vocab: { vocab_q1: blanks.map((b) => b.correctAnswer) },
    grammar: {},
    listen_write: {}
  };
  const scoring = scoreSubmission(responses);

  const scoredQ1 = scoring?.vocab?.questions?.find((q) => q.questionId === 'vocab_q1') || null;
  assert(scoredQ1, 'Missing scored vocab_q1 result.');
  assert.strictEqual(scoredQ1.correct, 4, `Expected vocab_q1 to score 4/4 even when options are shuffled (seed=${seedResult.testId}).`);
}

verifyScoringIgnoresShuffledOrdering();
console.log('ok - entrance test scoring stability');

