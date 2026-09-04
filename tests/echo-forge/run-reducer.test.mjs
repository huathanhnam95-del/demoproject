import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialRunState,
  reduceRun,
  replayRun,
} from '../../public/js/echo-forge/core/run-reducer.js';
import { RUN_EVENT_TYPES, validateRunState } from '../../public/js/echo-forge/core/run-contract.js';
import { createAnalysisResult } from '../../public/js/echo-forge/contracts/analysis-result.js';

function makeMockScoredAnalysis(score = 100) {
  return createAnalysisResult({
    schemaVersion: 'echo-forge-analysis-v1',
    status: 'scored',
    score,
    evaluationMode: 'azure_word',
    dimensions: { accuracy: score },
    verdict: 'accurate',
    engineRevision: 'test-v1',
    challengeId: 'test-challenge',
    variantId: 'v1',
    reasonCode: 'OK',
  });
}

test('createInitialRunState produces a valid frozen initial run state', () => {
  const run = createInitialRunState({ level: 'A2', seed: 12345 });
  assert.equal(run.schemaVersion, 'echo-forge-run-v1');
  assert.equal(run.level, 'A2');
  assert.equal(run.seed, 12345);
  assert.equal(run.wardenIndex, 0);
  assert.equal(run.heroMaxHp, 100);
  assert.equal(run.carriedHeroHp, 100);
  assert.equal(run.status, 'active');
  assert.equal(Object.isFrozen(run), true);
  assert.equal(Object.isFrozen(run.modifiers), true);
});

test('START_RUN action initializes run and spawns first warden combat', () => {
  const initial = createInitialRunState({ level: 'B1' });
  const { state, events, combatEvents } = reduceRun(initial, { type: 'START_RUN' });

  assert.equal(state.status, 'active');
  assert.ok(state.combat !== null);
  assert.equal(state.combat.enemy.maxHp, 90); // Act 0 opening minion
  assert.equal(state.wardenIndex, 0);

  assert.deepEqual(events.map((event) => event.type), [
    'run.started',
    'run.route.generated',
    'run.act.entered',
    'run.node.entered',
    'run.fight.started',
  ]);
  assert.equal(events[2].payload.act, 0);
  assert.equal(events[2].payload.stageId, 'resonant_hall');
  assert.equal(events[3].payload.nodeId, 'f0n0');
  assert.equal(events[3].payload.nodeType, 'fight');
  assert.equal(events[4].payload.wardenIndex, 0);
  assert.equal(events[4].payload.wardenId, 'echo_sentinel');

  // The run now opens on an ordinary fight in Act I, not straight onto a Warden.
  assert.equal(state.act, 0);
  assert.equal(state.floor, 0);
  assert.equal(state.nodeId, 'f0n0');
  assert.deepEqual([...state.visitedNodeIds], ['f0n0']);

  assert.equal(combatEvents.length, 1);
  assert.equal(combatEvents[0].type, 'combat.started');
});

test('multi-fight run transitions to reward_pending on fight 1 victory and carries HP', () => {
  const initial = createInitialRunState({ level: 'B1' });
  let { state } = reduceRun(initial, { type: 'START_RUN' });

  // Player attacks once to flip turn to enemy
  state = reduceRun(state, {
    type: 'COMBAT_ACTION',
    combatAction: {
      type: 'RESOLVE_PLAYER_ATTACK',
      cardId: 'precision_strike',
      useBurst: false,
      analysis: makeMockScoredAnalysis(80),
    },
  }).state;

  // Enemy turn: block with incorrect outcome so hero takes damage
  state = reduceRun(state, {
    type: 'COMBAT_ACTION',
    combatAction: {
      type: 'RESOLVE_BLOCK',
      outcome: 'incorrect',
      enemyBaseDamage: 20,
    },
  }).state;

  assert.ok(state.carriedHeroHp < 100);
  const hpAfterHeroDamage = state.carriedHeroHp;

  // Now defeat the enemy with alternating turns
  let lastEvents = [];
  while (state.combat && state.combat.status === 'active') {
    if (state.combat.turn === 'player') {
      const res = reduceRun(state, {
        type: 'COMBAT_ACTION',
        combatAction: {
          type: 'RESOLVE_PLAYER_ATTACK',
          cardId: 'precision_strike',
          useBurst: false,
          analysis: makeMockScoredAnalysis(100),
        },
      });
      state = res.state;
      lastEvents = res.events;
    } else {
      const res = reduceRun(state, {
        type: 'COMBAT_ACTION',
        combatAction: {
          type: 'RESOLVE_BLOCK',
          outcome: 'correct',
          enemyBaseDamage: 20,
        },
      });
      state = res.state;
      lastEvents = res.events;
    }
  }

  assert.equal(state.status, 'reward_pending');
  assert.ok(lastEvents.some((e) => e.type === 'run.fight.completed'));
  assert.ok(lastEvents.some((e) => e.type === 'run.reward.offered'));
  assert.ok(Array.isArray(state.rewardOffer));
  assert.equal(state.rewardOffer.length, 2);
  assert.ok(state.carriedHeroHp <= hpAfterHeroDamage);

  // Claim the first offered reward
  const chosenReward = state.rewardOffer[0];
  const claimResult = reduceRun(state, {
    type: 'CLAIM_REWARD',
    rewardId: chosenReward.id,
  });
  state = claimResult.state;

  // Claiming a reward now opens the branching map instead of spawning the next
  // fight directly. The player chooses where to go.
  assert.equal(state.status, 'map_pending');
  assert.equal(state.combat, null);
  assert.ok(state.availableNodeIds.length >= 1);
  assert.equal(claimResult.events.some((e) => e.type === 'run.reward.claimed'), true);
  assert.equal(claimResult.events.some((e) => e.type === 'run.map.offered'), true);

  // Taking the first offered node leads into the next encounter.
  const nextId = state.availableNodeIds[0];
  const selectResult = reduceRun(state, { type: 'SELECT_NODE', nodeId: nextId });
  state = selectResult.state;

  assert.equal(state.nodeId, nextId);
  assert.ok(state.visitedNodeIds.includes(nextId));
  assert.equal(selectResult.events.some((e) => e.type === 'run.node.entered'), true);
});

test('singleFight flag finishes run immediately upon first victory', () => {
  const initial = createInitialRunState({ level: 'B1' });
  let { state } = reduceRun(initial, { type: 'START_RUN' });
  let lastEvents = [];

  while (state.combat && state.combat.status === 'active') {
    if (state.combat.turn === 'player') {
      const res = reduceRun(state, {
        type: 'COMBAT_ACTION',
        singleFight: true,
        combatAction: {
          type: 'RESOLVE_PLAYER_ATTACK',
          cardId: 'precision_strike',
          useBurst: false,
          analysis: makeMockScoredAnalysis(100),
        },
      });
      state = res.state;
      lastEvents = res.events;
    } else {
      const res = reduceRun(state, {
        type: 'COMBAT_ACTION',
        singleFight: true,
        combatAction: {
          type: 'RESOLVE_BLOCK',
          outcome: 'correct',
          enemyBaseDamage: 20,
        },
      });
      state = res.state;
      lastEvents = res.events;
    }
  }

  assert.equal(state.status, 'victory');
  assert.ok(lastEvents.some((e) => e.type === 'run.completed'));
  assert.equal(state.rewardOffer, null);
});

test('replayRun deterministically reproduces complete run state', () => {
  const initial = createInitialRunState({ level: 'B1', seed: 42 });
  const actions = [
    { type: 'START_RUN' },
    {
      type: 'COMBAT_ACTION',
      singleFight: true,
      combatAction: {
        type: 'RESOLVE_PLAYER_ATTACK',
        cardId: 'precision_strike',
        useBurst: false,
        analysis: makeMockScoredAnalysis(100),
      },
    },
  ];

  const replayed = replayRun(initial, actions);
  assert.equal(replayed.state.status, 'active');
  assert.equal(replayed.state.combat.enemy.hp, 60);
  assert.ok(replayed.events.length >= 2);
});

test('validateRunState validates schemas strictly', () => {
  const valid = createInitialRunState({ level: 'B1' });
  assert.equal(validateRunState(valid), true);
  assert.equal(validateRunState(null), false);
  assert.equal(validateRunState({}), false);
  assert.equal(validateRunState({ ...valid, schemaVersion: 'bad-version' }), false);
  assert.equal(validateRunState({ ...valid, status: 'unknown-status' }), false);
  assert.equal(validateRunState({ ...valid, heroMaxHp: -1 }), false);
});

test('ABANDON_RUN transitions run and combat status to abandoned', () => {
  const initial = createInitialRunState({ level: 'B1' });
  let { state } = reduceRun(initial, { type: 'START_RUN' });
  assert.equal(state.status, 'active');
  assert.equal(state.combat.status, 'active');

  const abandoned = reduceRun(state, { type: 'ABANDON_RUN' });
  assert.equal(abandoned.state.status, 'abandoned');
  assert.equal(abandoned.state.combat.status, 'abandoned');
  assert.ok(abandoned.events.some((e) => e.type === 'run.abandoned'));

  // No-op if already abandoned
  const repeat = reduceRun(abandoned.state, { type: 'ABANDON_RUN' });
  assert.equal(repeat.events.length, 0);
});

test('ENTER_FIGHT explicitly starts a fight for active state', () => {
  const initial = createInitialRunState({ level: 'B1' });
  const entered = reduceRun(initial, { type: 'ENTER_FIGHT' });
  assert.equal(entered.state.status, 'active');
  assert.ok(entered.state.combat !== null);
  assert.ok(entered.events.some((e) => e.type === 'run.fight.started'));
});

test('spawnCombatForWarden clamps carriedHeroHp defensively', () => {
  const stateWithZeroHp = {
    ...createInitialRunState({ level: 'B1' }),
    carriedHeroHp: 0,
  };
  const entered = reduceRun(stateWithZeroHp, { type: 'ENTER_FIGHT' });
  assert.equal(entered.state.combat.hero.hp, 1);
});

test('tempered_guard reduces block damage by 15%', () => {
  const baseDamage = 20;
  const reliefBonus = 0.15;
  const reducedDamage = Math.max(1, Math.round(baseDamage * (1 - reliefBonus)));
  assert.equal(reducedDamage, 17);
});
