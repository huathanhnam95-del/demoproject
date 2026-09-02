import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createAnalysisResult } from '../../public/js/echo-forge/contracts/analysis-result.js';
import { ECHO_FORGE_EVENT_TYPES, EVENT_OWNERS } from '../../public/js/echo-forge/contracts/events.js';
import {
  ATTACK_CARDS,
  CEFR_LEVELS,
  COMBAT_POLICY,
  createRunPreferences,
} from '../../public/js/echo-forge/core/policy.js';
import { createSeededRng } from '../../public/js/echo-forge/core/rng.js';
import { filterChallenges, selectChallenge } from '../../public/js/echo-forge/core/challenge-selector.js';
import { calculateAttackDamage, resolveBlock, resolveParry } from '../../public/js/echo-forge/core/combat-math.js';
import { createInitialCombatState, reduceCombat, replayCombat } from '../../public/js/echo-forge/core/combat-reducer.js';

const analysis = (overrides = {}) => createAnalysisResult({
  schemaVersion: 'echo-forge-analysis-v1',
  status: 'scored',
  score: 90,
  evaluationMode: 'azure_word',
  dimensions: { accuracy: 90 },
  verdict: 'accurate',
  engineRevision: 'test-v1',
  challengeId: 'ef-a1-word-001',
  variantId: 'variant-001',
  reasonCode: null,
  ...overrides,
});

const startCombat = (overrides = {}) => {
  const setup = createInitialCombatState({ level: 'A1', ...overrides });
  return reduceCombat(setup, { type: 'START_COMBAT' }).state;
};

test('manual level policy is exactly A1-C1 and rejects C2 without promotion', () => {
  assert.deepEqual([...CEFR_LEVELS], ['A1', 'A2', 'B1', 'B2', 'C1']);
  assert.equal(COMBAT_POLICY.locale, 'en-US');
  assert.equal(COMBAT_POLICY.focus.start, 1);
  assert.equal(COMBAT_POLICY.focus.max, 3);
  assert.equal(COMBAT_POLICY.resonance.max, 100);
  assert.deepEqual(createRunPreferences({ level: 'C1' }), {
    level: 'C1',
    locale: 'en-US',
    supportPreset: 'standard',
  });
  assert.throws(() => createRunPreferences({ level: 'C2' }), /C2|level/);
  assert.throws(() => createInitialCombatState({ level: 'C2' }), /C2|level/);
});

test('attack, block, and parry calculations match locked boundaries', () => {
  assert.equal(calculateAttackDamage({ base: 20, score: 0, combo: 0, burst: false }), 4);
  assert.equal(calculateAttackDamage({ base: 20, score: 100, combo: 0, burst: false }), 30);
  assert.equal(calculateAttackDamage({ base: 20, score: 100, combo: 5, burst: false }), 38);
  assert.equal(calculateAttackDamage({ base: 20, score: 100, combo: 99, burst: true }), 56);

  assert.deepEqual(resolveBlock({ outcome: 'correct', enemyBaseDamage: 20 }), {
    damage: 10,
    incomingMultiplier: 0.5,
    focusRestored: 1,
  });
  assert.equal(resolveBlock({ outcome: 'incorrect', enemyBaseDamage: 20 }).damage, 16);
  assert.equal(resolveBlock({ outcome: 'timeout', enemyBaseDamage: 20 }).damage, 20);
  assert.throws(() => resolveBlock({ outcome: 'toString', enemyBaseDamage: 20 }), /Block outcome/);

  assert.deepEqual(resolveParry({ score: 90, timing: 'timely', enemyBaseDamage: 20 }), {
    damage: 0,
    incomingMultiplier: 0,
    reflectedDamage: 0,
    timing: 'timely',
  });
  assert.equal(resolveParry({ score: 95, timing: 'timely', enemyBaseDamage: 20 }).reflectedDamage, 10);
  const late = resolveParry({ score: 100, timing: 'late', enemyBaseDamage: 20 });
  assert.equal(late.incomingMultiplier, 0.5);
  assert.equal(late.damage, 10);
  assert.equal(late.reflectedDamage, 0);
});

test('seeded challenge selection is deterministic and filters exact policy fields', () => {
  const challenges = [
    { challengeId: 'a', level: 'A1', evaluationMode: 'azure_word', unitType: 'word' },
    { challengeId: 'b', level: 'A1', evaluationMode: 'azure_word', unitType: 'word' },
    { challengeId: 'c', level: 'A2', evaluationMode: 'azure_word', unitType: 'word' },
  ];
  assert.deepEqual(filterChallenges(challenges, {
    level: 'A1', evaluationMode: 'azure_word', unitType: 'word',
  }).map((item) => item.challengeId), ['a', 'b']);
  assert.throws(() => filterChallenges(challenges, { level: 'C2' }), /C2|level/);
  assert.throws(() => filterChallenges([
    { challengeId: 'leak', level: 'C2', evaluationMode: 'azure_word', unitType: 'word' },
  ]), /C2|level/);
  assert.throws(() => filterChallenges([
    { challengeId: 'invalid-v3', level: 'A1', evaluationMode: 'v3_word', unitType: 'phrase' },
  ]), /V3|v3_word|word-only/);

  const first = selectChallenge(challenges, {
    level: 'A1', evaluationMode: 'azure_word', unitType: 'word', rng: createSeededRng(12345),
  });
  const second = selectChallenge(challenges, {
    level: 'A1', evaluationMode: 'azure_word', unitType: 'word', rng: createSeededRng(12345),
  });
  assert.equal(first.challengeId, second.challengeId);
  assert.throws(() => selectChallenge(challenges, {
    level: 'A1', evaluationMode: 'azure_word', unitType: 'word', rng: { nextFloat: () => Number.NaN },
  }), /rng|random/);
  assert.throws(() => selectChallenge(challenges, {
    level: 'A1', evaluationMode: 'azure_word', unitType: 'word', rng: { nextFloat: () => -0.1 },
  }), /rng|random/);
});

test('every shared semantic event has one explicit producer owner', async () => {
  const visualContract = JSON.parse(await readFile(
    new URL('../../docs/echo-forge/visual-contract.v1.json', import.meta.url),
    'utf8',
  ));
  assert.deepEqual([...ECHO_FORGE_EVENT_TYPES], visualContract.eventTypes);
  assert.deepEqual(Object.keys(EVENT_OWNERS).sort(), [...ECHO_FORGE_EVENT_TYPES].sort());
  assert.equal(EVENT_OWNERS['player.action.selected'], 'sandbox');
  assert.equal(EVENT_OWNERS['recording.started'], 'recorder');
  assert.equal(EVENT_OWNERS['player.parry.started'], 'recorder');
  assert.equal(EVENT_OWNERS['analysis.pending'], 'analyzer');
  assert.equal(EVENT_OWNERS['analysis.resolved'], 'combat');
  assert.equal(EVENT_OWNERS['analysis.noop'], 'combat');
  assert.equal(EVENT_OWNERS['telemetry.exported'], 'telemetry');
  assert.equal(EVENT_OWNERS['combat.damage.applied'], 'combat');
});

test('failure and reference-conflicted analysis preserve exact combat state identity', () => {
  const state = startCombat();
  for (const status of ['unrateable', 'unavailable', 'cancelled', 'invalid']) {
    const result = reduceCombat(state, {
      type: 'RESOLVE_PLAYER_ATTACK',
      cardId: 'precision_strike',
      analysis: analysis({ status, score: null, reasonCode: status.toUpperCase() }),
    });
    assert.equal(result.state, state, status);
    assert.equal(Object.isFrozen(result.events), true, status);
    assert.deepEqual(result.events.map((event) => event.type), ['analysis.noop']);
  }
  const conflict = reduceCombat(state, {
    type: 'RESOLVE_PLAYER_ATTACK',
    cardId: 'precision_strike',
    analysis: analysis({ dimensions: { referenceConflict: true }, reasonCode: 'REFERENCE_CONFLICT' }),
  });
  assert.equal(conflict.state, state);
  assert.deepEqual(conflict.events.map((event) => event.type), ['analysis.noop']);
});

test('attacks enforce card modes, Focus, combo, Resonance, and Burst consumption', () => {
  assert.equal(ATTACK_CARDS.precision_strike.baseDamage, 20);
  assert.equal(ATTACK_CARDS.stress_breaker.focusCost, 1);
  assert.equal(ATTACK_CARDS.echo_chain.evaluationMode, 'azure_phrase');

  let state = startCombat({ enemyMaxHp: 500 });
  const before = structuredClone(state);
  const first = reduceCombat(state, {
    type: 'RESOLVE_PLAYER_ATTACK', cardId: 'precision_strike', analysis: analysis({ score: 100 }),
  });
  assert.deepEqual(state, before, 'input state mutated');
  assert.equal(first.state.hero.combo, 1);
  assert.equal(first.state.hero.resonance, 30);
  assert.equal(first.state.turn, 'enemy');

  assert.throws(() => reduceCombat(startCombat(), {
    type: 'RESOLVE_PLAYER_ATTACK', cardId: 'echo_chain', analysis: analysis(),
  }), /evaluationMode/);

  const noFocus = structuredClone(startCombat());
  noFocus.hero.focus = 0;
  assert.throws(() => reduceCombat(noFocus, {
    type: 'RESOLVE_PLAYER_ATTACK',
    cardId: 'stress_breaker',
    analysis: analysis({ evaluationMode: 'v3_word' }),
  }), /Focus/);

  const charged = structuredClone(startCombat({ enemyMaxHp: 500 }));
  charged.hero.resonance = 100;
  const burst = reduceCombat(charged, {
    type: 'RESOLVE_PLAYER_ATTACK', cardId: 'precision_strike', useBurst: true,
    analysis: analysis({ score: 100 }),
  });
  assert.equal(burst.state.hero.resonance, 30, 'burst consumes 100 before scored gain');
  assert.ok(burst.events.some((event) => event.type === 'combat.resonance.consumed'));
  for (const useBurst of ['true', 1]) {
    assert.throws(() => reduceCombat(charged, {
      type: 'RESOLVE_PLAYER_ATTACK',
      cardId: 'precision_strike',
      useBurst,
      analysis: analysis({ score: 100 }),
    }), /useBurst|boolean/);
  }

  const partial = reduceCombat(startCombat({ enemyMaxHp: 500 }), {
    type: 'RESOLVE_PLAYER_ATTACK',
    cardId: 'stress_breaker',
    analysis: analysis({ status: 'incorrect', score: 55, evaluationMode: 'v3_word', verdict: 'stress_incorrect' }),
  });
  assert.ok(partial.state.enemy.hp < partial.state.enemy.maxHp, 'incorrect keeps score-based partial damage');
  assert.equal(partial.state.hero.combo, 0);
  assert.equal(partial.state.hero.resonance, 0);
});

test('defence transitions, victory/defeat, and replay are deterministic', () => {
  const active = startCombat({ heroMaxHp: 20, enemyMaxHp: 30 });
  const win = reduceCombat(active, {
    type: 'RESOLVE_PLAYER_ATTACK', cardId: 'precision_strike', analysis: analysis({ score: 100 }),
  });
  assert.equal(win.state.status, 'victory');
  assert.ok(win.events.some((event) => event.type === 'combat.victory'));

  const enemyTurn = structuredClone(startCombat({ heroMaxHp: 10 }));
  enemyTurn.turn = 'enemy';
  const loss = reduceCombat(enemyTurn, {
    type: 'RESOLVE_BLOCK', outcome: 'timeout', enemyBaseDamage: 20,
  });
  assert.equal(loss.state.status, 'defeat');
  assert.ok(loss.events.some((event) => event.type === 'combat.defeat'));

  const actions = [
    { type: 'START_COMBAT' },
    { type: 'RESOLVE_PLAYER_ATTACK', cardId: 'precision_strike', analysis: analysis({ score: 80 }) },
    { type: 'RESOLVE_BLOCK', outcome: 'correct', enemyBaseDamage: 10 },
  ];
  const a = replayCombat(createInitialCombatState({ level: 'B1', enemyMaxHp: 500 }), actions);
  const b = replayCombat(createInitialCombatState({ level: 'B1', enemyMaxHp: 500 }), actions);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('a scored Parry analyzer result is represented in the semantic event stream', () => {
  const enemyTurn = structuredClone(startCombat({ enemyMaxHp: 500 }));
  enemyTurn.turn = 'enemy';
  const result = reduceCombat(enemyTurn, {
    type: 'RESOLVE_PARRY',
    timing: 'timely',
    enemyBaseDamage: 20,
    analysis: analysis({ score: 95 }),
  });
  assert.equal(result.events[0].type, 'analysis.resolved');
  assert.equal(result.events.some((entry) => entry.type === 'player.parry.started'), false);
  assert.equal(Object.isFrozen(result.events), true);

  const incorrect = reduceCombat(enemyTurn, {
    type: 'RESOLVE_PARRY',
    timing: 'timely',
    enemyBaseDamage: 20,
    analysis: analysis({ status: 'incorrect', score: 95, verdict: 'incorrect' }),
  });
  assert.equal(incorrect.events.find((entry) => entry.type === 'player.parry.resolved').payload.reflectedDamage, 0);
});

test('combat events are immutable and abandonment is terminal and single-shot', () => {
  const setup = createInitialCombatState({ level: 'A1' });
  const started = reduceCombat(setup, { type: 'START_COMBAT' });
  assert.deepEqual(started.events.map((entry) => entry.type), ['combat.started']);
  assert.equal(Object.isFrozen(started.events), true);
  assert.throws(() => started.events.push({ type: 'combat.victory' }), /read only|extensible|frozen|object/i);

  const abandoned = reduceCombat(started.state, { type: 'ABANDON_COMBAT' });
  assert.deepEqual(abandoned.events.map((entry) => entry.type), ['combat.abandoned']);
  assert.throws(() => reduceCombat(abandoned.state, { type: 'ABANDON_COMBAT' }), /terminal|active|setup/);
});

test('Echo Forge core has no Survival, difficulty, account, or Firestore coupling', async () => {
  const files = [
    'policy.js', 'rng.js', 'challenge-selector.js', 'combat-math.js', 'combat-reducer.js',
  ];
  const source = (await Promise.all(files.map((name) => readFile(
    new URL(`../../public/js/echo-forge/core/${name}`, import.meta.url), 'utf8',
  )))).join('\n');
  assert.doesNotMatch(source, /survival|Difficulty|Firestore|submitAttempt|account XP|mastery|currency/i);
});
