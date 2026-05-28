/* eslint-disable no-console */
const assert = require('assert');
const admin = require('../functions/node_modules/firebase-admin');

if (admin.apps.length === 0) {
  admin.initializeApp({ projectId: 'demo-sst-tests' });
}

const { _private } = require('../functions/src/scoreSST');

const {
  applyDeterministicFormScore,
  isSummaryEligibleForAi,
  normalizeResult,
  releaseDailySSTScore,
  scoreSSTForm
} = _private;

function words(n, prefix = 'word') {
  return Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`).join(' ');
}

const formCases = [
  { name: '39 words scores zero', text: `${words(39)}.`, score: 0 },
  { name: '40 words scores one', text: `${words(40)}.`, score: 1 },
  { name: '49 words scores one', text: `${words(49)}.`, score: 1 },
  { name: '50 words scores two', text: `${words(50)}.`, score: 2 },
  { name: '70 words scores two', text: `${words(70)}.`, score: 2 },
  { name: '71 words scores one', text: `${words(71)}.`, score: 1 },
  { name: '100 words scores one', text: `${words(100)}.`, score: 1 },
  { name: '101 words scores zero', text: `${words(101)}.`, score: 0 },
  { name: 'all caps invalidates ideal length', text: `${words(50, 'WORD')}.`, score: 0 },
  { name: 'missing punctuation invalidates ideal length', text: words(50), score: 0 },
  { name: 'bullet list invalidates ideal length', text: `- ${words(25)}\n- ${words(25)}.`, score: 0 },
  { name: 'numeric response invalidates ideal length', text: `${Array(50).fill('123').join(' ')}.`, score: 0 },
  { name: 'very short sentence list invalidates ideal length', text: `${Array(17).fill('This is short.').join(' ')} Final item.`, score: 0 }
];

formCases.forEach((testCase) => {
  const result = scoreSSTForm(testCase.text);
  assert.equal(result.score, testCase.score, `${testCase.name}: ${result.rationale}`);
});

assert.equal(
  isSummaryEligibleForAi(`${words(39)}.`),
  true,
  'a submitted summary with Form zero must still be eligible for AI practice feedback'
);
assert.equal(isSummaryEligibleForAi(''), false, 'empty summaries should not call AI scoring');

const normalized = normalizeResult({
  scores: {
    content: { score: 4, rationale: 'Complete.' },
    form: { score: 2, rationale: 'Model estimate.' },
    grammar: { score: 2, rationale: 'Clean.' },
    vocabulary: { score: 2, rationale: 'Precise.' },
    spelling: { score: 2, rationale: 'Correct.' }
  },
  teacherAdviceChat: 'Capture each major idea once.'
});

assert.equal(normalized.overall.maxTotal, 12, 'SST full rubric maximum should be 12');
assert.equal(normalized.overall.total, 12, 'SST normalized full-score response should total 12');

const overridden = applyDeterministicFormScore(normalized, `${words(39)}.`);
assert.equal(overridden.scores.form.score, 0, 'server deterministic Form must override model Form');
assert.equal(overridden.overall.total, 10, 'overall score must be recomputed after Form override');

(async () => {
  let releasedStats = null;
  const fakeDatabase = {
    runTransaction: async (callback) => callback({
      get: async () => ({ data: () => ({ aiSSTScoreStats: { lastDate: '2026-05-26', count: 2 } }) }),
      set: (_reference, data) => { releasedStats = data.aiSSTScoreStats; }
    })
  };
  await releaseDailySSTScore({ path: 'users/test' }, { today: '2026-05-26' }, fakeDatabase);
  assert.deepEqual(
    releasedStats,
    { lastDate: '2026-05-26', count: 1 },
    'quota release after a failed model request should restore one reserved SST score'
  );
  console.log('SST form scoring tests passed.');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
