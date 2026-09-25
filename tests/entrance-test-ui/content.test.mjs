import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { DEMO_DATA, normalizeDemoData } from '../../public/js/entrance-test-ui/demo-data.js';

const require = createRequire(import.meta.url);
const { buildPublicSession } = require('../../functions/src/entrance-test/test36plus.js');

function semanticSession(session) {
  return {
    version: session.version,
    title: session.title,
    sections: session.sections.map((section) => ({
      id: section.id,
      titleVi: section.titleVi,
      instructionVi: section.instructionVi,
      questions: section.questions.map((question) => ({
        type: question.type,
        sectionId: question.sectionId,
        questionId: question.questionId,
        questionNumber: question.questionNumber,
        instructionVi: question.instructionVi,
        text: question.text,
        audioUrl: question.audioUrl,
        parts: (question.parts || []).map((part) => part.type === 'text'
          ? { type: 'text', text: part.text }
          : { type: 'blank', blankId: part.blankId, options: part.options ? [...part.options].sort() : part.options })
      }))
    }))
  };
}

test('Demo D fixture matches the canonical public Entrance Test content', () => {
  const canonical = buildPublicSession('entrance-test-ui-demo-content-test');
  assert.deepEqual(semanticSession(normalizeDemoData(DEMO_DATA)), semanticSession(canonical));
});

test('Demo D exposes stable IDs for 13 groups, 45 blanks and three speaking recordings', () => {
  const questions = DEMO_DATA.sections.flatMap((section) => section.questions);
  const blankIds = questions.flatMap((question) => (question.parts || [])
    .filter((part) => part.type === 'blank')
    .map((part) => part.blankId));

  assert.equal(DEMO_DATA.sections.length, 4);
  assert.equal(questions.length, 13);
  assert.equal(blankIds.length, 45);
  assert.equal(new Set(blankIds).size, blankIds.length);
  assert.equal(questions.filter((question) => question.type === 'speaking').length, 3);
  assert.equal(questions.filter((question) => question.type !== 'speaking')
    .every((question) => question.parts.some((part) => part.type === 'blank')), true);
});
