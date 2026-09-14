import test from 'node:test';
import assert from 'node:assert/strict';
import { createQATools } from '../../public/js/entrance-test-ui/qa.js';

const questions = [
  { questionId: 'speaking_q1', type: 'speaking', parts: [] },
  { questionId: 'vocab_q1', type: 'mc', parts: [{ type: 'blank', blankId: 'vocab_q1__b1', options: ['a', 'b'] }] },
  { questionId: 'listen_write_q1', type: 'fill', parts: [{ type: 'text', text: 'x' }, { type: 'blank', blankId: 'listen_write_q1__b1' }] }
];

test('QA fill-all uses ordinary state actions and creates explicitly labelled fixture recordings', async () => {
  const actions = [];
  const fixtureCalls = [];
  const qa = createQATools({ questions, dispatch: (action) => actions.push(action), createFixtureRecording: async (question) => { fixtureCalls.push(question.questionId); return { recordId: 'fixture-1' }; } });
  await qa.fillAll();
  assert.equal(actions.filter((action) => action.type === 'set-answer').length, 2);
  assert.deepEqual(fixtureCalls, ['speaking_q1']);
  assert.equal(qa.lastNotice(), 'Demo QA fixture recording');
});

test('QA jump-missing delegates to the current draft and reset stays explicit', async () => {
  const actions = [];
  let resetCalls = 0;
  const qa = createQATools({ questions, getDraft: () => ({ answers: {}, recordingRefs: {} }), dispatch: (action) => actions.push(action), reset: async () => { resetCalls += 1; } });
  assert.deepEqual(qa.jumpMissing(), { questionId: 'speaking_q1', blankId: null });
  await qa.reset();
  assert.equal(resetCalls, 1);
  await qa.toggleFlag('vocab_q1');
  assert.deepEqual(actions.at(-1), { type: 'toggle-flag', questionId: 'vocab_q1' });
});
