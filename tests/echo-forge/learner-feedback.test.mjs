import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  LEVEL_DESCRIPTORS,
  SUPPORT_DESCRIPTORS,
  describeActionCard,
  formatAnalysisFeedback,
  summarizeRun,
} from '../../public/js/echo-forge/core/learner-feedback.js';
import { selectChallenge } from '../../public/js/echo-forge/core/challenge-selector.js';

const catalog = JSON.parse(await (await import('node:fs/promises')).readFile(new URL('../../public/database/echo-forge/challenges.v1.json', import.meta.url), 'utf8'));

const challenge = {
  challengeId: 'ef-a1-azure-word-001',
  level: 'A1',
  evaluationMode: 'azure_word',
  unitType: 'word',
  text: 'water',
  pronunciation: { ipa: '/ˈwɔːtər/', variantId: 'water-v1', focus: 'clear /t/ release' },
  resource: { definition: 'a drinkable liquid', example: 'I drink water.' },
};

test('level and support descriptors preserve manual autonomy and concise disclosure', () => {
  assert.equal(LEVEL_DESCRIPTORS.A1, 'Everyday words and short exchanges.');
  assert.equal(LEVEL_DESCRIPTORS.C1, 'Nuanced academic and professional language.');
  assert.match(SUPPORT_DESCRIPTORS.guided, /IPA|meaning|example/i);
  assert.match(SUPPORT_DESCRIPTORS.challenge, /after your attempt|post-attempt/i);
});

test('action cards communicate engine, damage, cost, risk, and accessible disabled reason', () => {
  const card = describeActionCard({ id: 'echo_chain', label: 'Echo Chain', evaluationMode: 'azure_phrase', baseDamage: 26, focusCost: 1 }, { focus: 0 });
  assert.match(card.label, /Echo Chain/);
  assert.match(card.description, /Azure phrase|26|Focus|unavailable/i);
  assert.equal(card.disabled, true);
  assert.match(card.disabledReason, /Focus/i);
});

test('feedback includes engine evidence, challenge focus, exact damage, and neutral technical noop wording', () => {
  const azure = formatAnalysisFeedback({
    challenge,
    card: { label: 'Precision Strike', evaluationMode: 'azure_word' },
    analysis: { status: 'scored', score: 84, dimensions: { accuracy: 84 } },
    damage: 18,
    supportPreset: 'standard',
  });
  assert.match(azure.text, /Score: 84/);
  assert.match(azure.text, /Azure word accuracy: 84/);
  assert.match(azure.text, /clear \/t\/ release/);
  assert.match(azure.text, /18 damage/);
  const noop = formatAnalysisFeedback({ challenge, card: { label: 'Precision Strike', evaluationMode: 'azure_word' }, analysis: { status: 'unavailable', score: null, reasonCode: 'REQUEST_FAILED' }, damage: 0, supportPreset: 'guided' });
  assert.equal(noop.technicalNoop, true);
  assert.match(noop.text, /could not be rated|no damage|no resource|try again/i);
  assert.doesNotMatch(noop.text, /you failed|bad pronunciation/i);
});

test('feedback and run summaries use catalog pronunciation.focus for every support preset', () => {
  const realChallenge = catalog.challenges.find((item) => item.challengeId === 'ef-a1-azure-word-001');
  assert.ok(realChallenge?.pronunciation?.focus);
  for (const supportPreset of ['guided', 'standard', 'challenge']) {
    const feedback = formatAnalysisFeedback({
      challenge: realChallenge,
      card: { label: 'Precision Strike', evaluationMode: realChallenge.evaluationMode },
      analysis: { status: 'scored', score: 84, dimensions: { accuracy: 84 } },
      damage: 18,
      supportPreset,
    });
    assert.match(feedback.text, new RegExp(realChallenge.pronunciation.focus.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  const summary = summarizeRun({
    outcome: 'victory',
    rounds: 1,
    attempts: [{ challenge: realChallenge, status: 'scored', score: 84, damage: 18, success: true }],
  });
  assert.deepEqual(summary.pronunciationFocusReview, [realChallenge.pronunciation.focus]);
});

test('phrase and V3 feedback expose required dimensions', () => {
  const phrase = formatAnalysisFeedback({ challenge: { ...challenge, evaluationMode: 'azure_phrase', unitType: 'phrase' }, card: { label: 'Echo Chain', evaluationMode: 'azure_phrase' }, analysis: { status: 'incorrect', score: 52, dimensions: { accuracy: 50, fluency: 55, completeness: 51 } }, damage: 10, supportPreset: 'challenge' });
  assert.match(phrase.text, /accuracy: 50|fluency: 55|completeness: 51/i);
  const v3 = formatAnalysisFeedback({ challenge, card: { label: 'Stress Breaker', evaluationMode: 'v3_word' }, analysis: { status: 'incorrect', score: 55, dimensions: { countStatus: 'verified', stressStatus: 'incorrect' } }, damage: 9, supportPreset: 'guided' });
  assert.match(v3.text, /count evidence: verified/i);
  assert.match(v3.text, /stress evidence: incorrect/i);
});

test('run summary reports outcome, rounds, scored attempts, averages, actions, and focus review', () => {
  const summary = summarizeRun({ outcome: 'victory', rounds: 4, attempts: [
    { status: 'scored', score: 80, damage: 16, success: true, focus: 'vowel length' },
    { status: 'incorrect', score: 45, damage: 8, success: false, focus: 'final consonant' },
    { status: 'unavailable', score: null, damage: 0, success: false, focus: 'vowel length' },
  ] });
  assert.equal(summary.outcome, 'victory');
  assert.equal(summary.rounds, 4);
  assert.equal(summary.scoredAttempts, 2);
  assert.equal(summary.averageScore, 63);
  assert.equal(summary.bestScore, 80);
  assert.equal(summary.successfulActions, 1);
  assert.deepEqual(summary.pronunciationFocusReview, ['vowel length', 'final consonant']);
});

test('challenge selector supports deterministic no-immediate-repeat within a run', () => {
  const challenges = [1, 2, 3].map((id) => ({ ...challenge, challengeId: `ef-a1-azure-word-00${id}` }));
  const values = [0.1, 0.1, 0.1, 0.1];
  const rng = { nextFloat: () => values.shift() };
  const history = new Set();
  const selected = Array.from({ length: 4 }, () => selectChallenge(challenges, { level: 'A1', evaluationMode: 'azure_word', unitType: 'word', rng, recentChallengeIds: history }).challengeId);
  assert.deepEqual(selected.slice(0, 3), ['ef-a1-azure-word-001', 'ef-a1-azure-word-002', 'ef-a1-azure-word-003']);
  assert.equal(selected[3], 'ef-a1-azure-word-001');
});

test('challenge selector avoids an immediate repeat after the eligible pool is exhausted', () => {
  const challenges = [1, 2].map((id) => ({ ...challenge, challengeId: `ef-a1-azure-word-00${id}` }));
  const values = [0.1, 0.9, 0.9];
  const history = new Set();
  const rng = { nextFloat: () => values.shift() };
  const selected = Array.from({ length: 3 }, () => selectChallenge(challenges, {
    level: 'A1', evaluationMode: 'azure_word', unitType: 'word', rng, recentChallengeIds: history,
  }).challengeId);
  assert.deepEqual(selected, ['ef-a1-azure-word-001', 'ef-a1-azure-word-002', 'ef-a1-azure-word-001']);
  assert.ok(history instanceof Set);
  assert.equal(history.has('ef-a1-azure-word-002'), true, 'last selected eligible ID is retained across pool reset');
  assert.equal(history.has('ef-a1-azure-word-001'), true);
});
