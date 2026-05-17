/* eslint-disable no-console */
const assert = require('assert');
const admin = require('../functions/node_modules/firebase-admin');

if (admin.apps.length === 0) {
  admin.initializeApp({ projectId: 'demo-swt-tests' });
}

const { _private } = require('../functions/src/scoreSWT');

const {
  applyDeterministicFormScore,
  getSWTFormBlockingReason,
  normalizeResult,
  scoreSWTForm
} = _private;

function words(n) {
  return Array.from({ length: n }, (_, i) => `word${i + 1}`).join(' ');
}

const cases = [
  {
    name: 'valid one-sentence summary',
    text: 'Global sports events are reducing their carbon footprint by joining climate networks.',
    score: 1
  },
  {
    name: 'allows abbreviation at sentence end',
    text: 'The policy encouraged cleaner transport investment across the U.S.',
    score: 1
  },
  {
    name: 'allows dotted academic abbreviations inside one sentence',
    text: 'The passage explains that Ph.D. researchers developed a practical system for safer public health planning.',
    score: 1
  },
  {
    name: 'allows initialisms inside one sentence',
    text: 'The passage explains that the U.N.E.P. encouraged sports events to reduce emissions through climate networks.',
    score: 1
  },
  {
    name: 'allows decimal punctuation inside one sentence',
    text: 'The study found 3.5 percent growth while warning that long-term risks remain.',
    score: 1
  },
  {
    name: 'rejects too few words',
    text: 'Too few words.',
    score: 0
  },
  {
    name: 'rejects too many words',
    text: `${words(76)}.`,
    score: 0
  },
  {
    name: 'rejects multiple sentences',
    text: 'The passage discusses climate action. It also explains sporting events.',
    score: 0
  },
  {
    name: 'rejects question mark ending',
    text: 'The passage discusses climate action and sporting events?',
    score: 0
  },
  {
    name: 'rejects lowercase start',
    text: 'the passage discusses climate action and sporting events.',
    score: 0
  },
  {
    name: 'rejects summaries with no alphabetic words',
    text: '123 456 789 000 111.',
    score: 0
  },
  {
    name: 'rejects all caps',
    text: 'THE PASSAGE DISCUSSES CLIMATE ACTION AND SPORTING EVENTS.',
    score: 0
  },
  {
    name: 'rejects line breaks',
    text: 'The passage discusses climate action.\nIt also explains sporting events.',
    score: 0
  }
];

for (const testCase of cases) {
  const result = scoreSWTForm(testCase.text);
  assert.strictEqual(result.score, testCase.score, `${testCase.name}: ${result.rationale}`);
}

const normalized = normalizeResult({
  scores: {
    content: { score: 4, rationale: 'Complete.' },
    form: { score: 1, rationale: 'Model said valid.' },
    grammar: { score: 2, rationale: 'Clean.' },
    vocabulary: { score: 2, rationale: 'Strong.' }
  }
});

const overridden = applyDeterministicFormScore(
  normalized,
  'The passage discusses climate action. It also explains sporting events.'
);

assert.strictEqual(overridden.scores.form.score, 0, 'deterministic form score should override model form score');
assert.strictEqual(overridden.overall.total, 8, 'overall should be recomputed after deterministic form override');
assert.strictEqual(overridden.overall.maxTotal, 9, 'overall max should stay 9');

assert.strictEqual(
  getSWTFormBlockingReason('The passage discusses climate action and sporting events.'),
  '',
  'valid summaries should not be blocked before AI scoring'
);
assert.ok(
  getSWTFormBlockingReason('The passage discusses climate action. It also explains sporting events.').includes('Multiple sentences'),
  'invalid form summaries should be blocked before AI scoring'
);
assert.ok(
  getSWTFormBlockingReason('123 456 789 000 111.').includes('alphabetic'),
  'numeric-only summaries should be blocked before AI scoring'
);

console.log('SWT form scoring tests passed.');
