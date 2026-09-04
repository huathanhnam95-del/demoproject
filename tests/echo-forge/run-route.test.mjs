import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialRunState,
  createResumedRunState,
  reduceRun,
  replayRun,
} from '../../public/js/echo-forge/core/run-reducer.js';
import { validateRunState } from '../../public/js/echo-forge/core/run-contract.js';
import {
  generateRoute,
  getNode,
  getSuccessorIds,
} from '../../public/js/echo-forge/core/route.js';
import { createAnalysisResult } from '../../public/js/echo-forge/contracts/analysis-result.js';

function scored(score = 100) {
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

function turnAction(combat) {
  return combat.turn === 'player'
    ? {
      type: 'RESOLVE_PLAYER_ATTACK',
      cardId: 'precision_strike',
      useBurst: false,
      analysis: scored(100),
    }
    : { type: 'RESOLVE_PARRY', timing: 'timely', score: 100, analysis: scored(100), enemyBaseDamage: 20 };
}

/** Drives combat at the current node until it resolves. Returns the last events too. */
function fightToTheEnd(state) {
  let events = [];
  let guard = 0;
  while (state.combat && state.combat.status === 'active' && guard < 200) {
    const result = reduceRun(state, {
      type: 'COMBAT_ACTION',
      combatAction: turnAction(state.combat),
    });
    state = result.state;
    events = result.events;
    guard += 1;
  }
  return { state, events };
}

/** Walks reward and map screens by always taking the first option. */
function advanceToNextEncounter(state) {
  let guard = 0;
  while (guard < 20) {
    if (state.status === 'reward_pending' && state.rewardOffer) {
      state = reduceRun(state, { type: 'CLAIM_REWARD', rewardId: state.rewardOffer[0].id }).state;
    } else if (state.status === 'map_pending') {
      const next = state.availableNodeIds[0];
      if (!next) break;
      state = reduceRun(state, { type: 'SELECT_NODE', nodeId: next }).state;
      if (state.status === 'active') return state;
    } else {
      break;
    }
    guard += 1;
  }
  return state;
}

/** Start a run and clear its opening fight, leaving the player on the map. */
function toFirstMap(seed, floorsPerAct) {
  let state = reduceRun(
    createInitialRunState({ level: 'B1', seed, floorsPerAct }),
    { type: 'START_RUN', seed, floorsPerAct },
  ).state;
  state = fightToTheEnd(state).state;
  return reduceRun(state, { type: 'CLAIM_REWARD', rewardId: state.rewardOffer[0].id }).state;
}

/** Find a seed whose first branch floor offers the given node type. */
function seedOffering(type) {
  for (let i = 0; i < 600; i += 1) {
    const seed = (0x1000 + i * 7919) >>> 0;
    const route = generateRoute(seed);
    const id = getSuccessorIds(route, 'f0n0').find((nodeId) => getNode(route, nodeId).type === type);
    if (id) return { seed, nodeId: id };
  }
  return null;
}

test('claiming a reward opens the map instead of spawning the next fight', () => {
  const state = toFirstMap(0x4543484f);

  assert.equal(state.status, 'map_pending');
  assert.equal(state.combat, null, 'no fight is queued behind the map');
  assert.equal(state.rewardOffer, null);
  assert.ok(state.availableNodeIds.length >= 1, 'the player is offered somewhere to go');

  // Everything on offer really is a successor of where the player stands.
  const successors = getSuccessorIds(state.route, state.nodeId);
  for (const id of state.availableNodeIds) {
    assert.ok(successors.includes(id), `${id} is reachable from ${state.nodeId}`);
  }
});

test('SELECT_NODE refuses anything not currently on offer', () => {
  const state = toFirstMap(0x4543484f);

  // A node that genuinely exists, but far away in the graph.
  const distant = 'f9n0';
  assert.ok(getNode(state.route, distant), 'target exists in the graph');
  assert.ok(!state.availableNodeIds.includes(distant), 'but is not reachable from here');

  const jump = reduceRun(state, { type: 'SELECT_NODE', nodeId: distant });
  assert.equal(jump.state, state, 'state is untouched');
  assert.equal(jump.events.length, 0, 'nothing is announced');

  assert.equal(reduceRun(state, { type: 'SELECT_NODE', nodeId: 'nope' }).state, state);
  assert.equal(reduceRun(state, { type: 'SELECT_NODE' }).state, state);

  // And selection is inert outside map_pending.
  const entered = reduceRun(state, { type: 'SELECT_NODE', nodeId: state.availableNodeIds[0] }).state;
  if (entered.status === 'active') {
    assert.equal(reduceRun(entered, { type: 'SELECT_NODE', nodeId: 'f1n0' }).state, entered);
  }
});

test('a rest node heals and hands the map straight back', () => {
  const found = seedOffering('rest');
  assert.ok(found, 'some seed offers a reachable rest node');

  let state = toFirstMap(found.seed);
  const hpBefore = state.carriedHeroHp;

  const result = reduceRun(state, { type: 'SELECT_NODE', nodeId: found.nodeId });
  state = result.state;

  assert.equal(state.status, 'map_pending', 'rest returns to the map');
  assert.equal(state.combat, null, 'no combat is spawned');
  assert.ok(state.carriedHeroHp >= hpBefore, 'health never drops at a rest');
  assert.equal(result.combatEvents.length, 0);

  const resolved = result.events.find((e) => e.type === 'run.node.resolved');
  assert.ok(resolved, 'the rest is announced');
  assert.equal(resolved.payload.effect, 'heal');
  assert.ok(result.events.some((e) => e.type === 'run.map.offered'), 'and the map reopens');
});

test('rest restores 30% of maximum health, clamped at full', () => {
  const found = seedOffering('rest');
  let state = toFirstMap(found.seed);

  // Max HP is whatever the opening reward left it at, so derive the expectation
  // rather than hardcoding it.
  const max = state.heroMaxHp;
  const expectedHeal = Math.round(max * 0.30);

  const wounded = Object.freeze({ ...state, carriedHeroHp: 40 });
  const healed = reduceRun(wounded, { type: 'SELECT_NODE', nodeId: found.nodeId }).state;
  assert.equal(healed.carriedHeroHp, 40 + expectedHeal, '40 plus 30% of max');

  const nearlyFull = Object.freeze({ ...state, carriedHeroHp: max - 5 });
  const capped = reduceRun(nearlyFull, { type: 'SELECT_NODE', nodeId: found.nodeId }).state;
  assert.equal(capped.carriedHeroHp, max, 'never exceeds the maximum');
});

test('a cache node drafts three distinct rewards without a fight', () => {
  const found = seedOffering('cache');
  assert.ok(found, 'some seed offers a reachable cache node');

  let state = toFirstMap(found.seed);
  const result = reduceRun(state, { type: 'SELECT_NODE', nodeId: found.nodeId });
  state = result.state;

  assert.equal(state.status, 'reward_pending');
  assert.equal(state.rewardSource, 'cache');
  assert.equal(state.combat, null);
  assert.equal(state.rewardOffer.length, 3, 'a cache drafts three');
  assert.equal(new Set(state.rewardOffer.map((r) => r.id)).size, 3, 'all distinct');

  const offered = result.events.find((e) => e.type === 'run.reward.offered');
  assert.equal(offered.payload.source, 'cache');

  // Claiming from a cache returns to the map like any other reward.
  const claimed = reduceRun(state, { type: 'CLAIM_REWARD', rewardId: state.rewardOffer[0].id }).state;
  assert.equal(claimed.status, 'map_pending');
  assert.equal(claimed.claimedRewards.length, 2, 'the opening fight reward plus this one');
});

test('defeating an act boss advances the act and announces the new stage', () => {
  let state = toFirstMap(0x4543484f, 2);   // floorsPerAct 2: entry fight, then boss
  assert.equal(state.route.floorsPerAct, 2);

  state = advanceToNextEncounter(state);
  assert.equal(getNode(state.route, state.nodeId).type, 'boss', 'the act boss is next');
  assert.equal(state.act, 0);

  const { state: afterBoss, events } = fightToTheEnd(state);

  assert.ok(events.some((e) => e.type === 'run.act.completed'), 'Act I closes');
  const entered = events.find((e) => e.type === 'run.act.entered');
  assert.ok(entered, 'Act II opens');
  assert.equal(entered.payload.act, 1);
  assert.equal(entered.payload.stageId, 'cinder_forge');
  assert.equal(entered.payload.title, 'The Cinder Forge');

  assert.equal(afterBoss.act, 1);
  assert.equal(afterBoss.wardenIndex, 1, 'the derived compatibility field follows the act');
});

test('a full run walks three acts and ends in victory', () => {
  let state = reduceRun(
    createInitialRunState({ level: 'B1', floorsPerAct: 2 }),
    { type: 'START_RUN', floorsPerAct: 2 },
  ).state;

  let guard = 0;
  while (!['victory', 'defeat'].includes(state.status) && guard < 40) {
    if (state.combat && state.combat.status === 'active') {
      state = fightToTheEnd(state).state;
    } else {
      const before = state.status;
      state = advanceToNextEncounter(state);
      if (state.status === before && !state.combat) break;
    }
    guard += 1;
  }

  assert.equal(state.status, 'victory');
  assert.equal(state.act, 2, 'finished in the final act');
  assert.equal(state.ledger.length, 6, 'six encounters on the spine at two floors per act');

  const bosses = state.ledger.filter((entry) => entry.nodeType === 'boss');
  assert.deepEqual(
    bosses.map((entry) => entry.wardenId),
    ['echo_sentinel', 'cinder_weaver', 'void_singer'],
    'all three Wardens fell, in order',
  );
});

test('replayRun reproduces a branching run exactly and emits nothing extra', () => {
  const initial = createInitialRunState({ level: 'B1', seed: 4242, floorsPerAct: 2 });
  const actions = [{ type: 'START_RUN', seed: 4242, floorsPerAct: 2 }];

  let state = reduceRun(initial, actions[0]).state;
  let guard = 0;
  while (state.combat && state.combat.status === 'active' && guard < 40) {
    const action = { type: 'COMBAT_ACTION', combatAction: turnAction(state.combat) };
    actions.push(action);
    state = reduceRun(state, action).state;
    guard += 1;
  }
  if (state.status === 'reward_pending') {
    const claim = { type: 'CLAIM_REWARD', rewardId: state.rewardOffer[0].id };
    actions.push(claim);
    state = reduceRun(state, claim).state;
  }
  if (state.status === 'map_pending') {
    const select = { type: 'SELECT_NODE', nodeId: state.availableNodeIds[0] };
    actions.push(select);
    state = reduceRun(state, select).state;
  }

  const replayed = replayRun(initial, actions);
  assert.deepEqual(replayed.state, state, 'replay lands on the identical state');
  assert.deepEqual(replayed.state.visitedNodeIds, state.visitedNodeIds);
  assert.deepEqual(replayed.state.route, state.route, 'route regenerates identically');
});

test('run state stays serializable and deeply frozen', () => {
  const state = reduceRun(createInitialRunState({ level: 'B1' }), { type: 'START_RUN' }).state;

  assert.deepEqual(JSON.parse(JSON.stringify(state.route)), state.route, 'no RNG object leaked in');
  assert.ok(Object.isFrozen(state.route));
  assert.ok(Object.isFrozen(state.route.floors[1].nodes[0]));
  assert.ok(Object.isFrozen(state.visitedNodeIds));
  assert.ok(Object.isFrozen(state.availableNodeIds));
  assert.ok(validateRunState(state));
});

test('the ledger records which node each encounter happened at', () => {
  let state = toFirstMap(0x4543484f, 2);
  assert.equal(state.ledger.length, 1);

  const entry = state.ledger[0];
  assert.equal(entry.nodeId, 'f0n0');
  assert.equal(entry.nodeType, 'fight');
  assert.equal(entry.act, 0);
  assert.equal(entry.outcome, 'victory');
});

test('createResumedRunState rebuilds the route from the seed, not from the save', () => {
  const original = reduceRun(
    createInitialRunState({ level: 'B1', seed: 777 }),
    { type: 'START_RUN', seed: 777 },
  ).state;

  const resumed = createResumedRunState({
    runId: original.runId,
    status: 'active',
    level: 'B1',
    seed: 777,
    floor: 0,
    nodeId: 'f0n0',
    visitedNodeIds: ['f0n0'],
    wardenIndex: 0,
    heroMaxHp: 100,
    carriedHeroHp: 88,
    modifiers: original.modifiers,
    claimedRewards: [],
    ledger: [],
  });

  assert.deepEqual(resumed.route, original.route, 'identical graph regenerated from the seed');
  assert.equal(resumed.carriedHeroHp, 88);
  assert.equal(resumed.combat, null, 'mid-fight state is never restored');
  assert.ok(validateRunState(resumed));
});

test('resuming onto the map recomputes what is reachable', () => {
  const live = toFirstMap(0x4543484f);
  const resumed = createResumedRunState({
    runId: live.runId,
    status: 'map_pending',
    level: 'B1',
    seed: live.seed,
    floor: live.floor,
    nodeId: live.nodeId,
    visitedNodeIds: [...live.visitedNodeIds],
    wardenIndex: live.wardenIndex,
    heroMaxHp: live.heroMaxHp,
    carriedHeroHp: live.carriedHeroHp,
    modifiers: live.modifiers,
    claimedRewards: [...live.claimedRewards],
    ledger: [...live.ledger],
  });

  assert.equal(resumed.status, 'map_pending');
  assert.deepEqual([...resumed.availableNodeIds], [...live.availableNodeIds]);
});

test('a legacy save without route fields lands on the pinned spine', () => {
  const resumed = createResumedRunState({
    runId: 'legacy_run',
    status: 'active',
    level: 'B1',
    seed: 0x4543484f,
    wardenIndex: 1,          // the old linear shape: "on the second Warden"
    heroMaxHp: 100,
    carriedHeroHp: 70,
    modifiers: { focusStart: 1, resonanceStart: 0, blockReliefBonus: 0 },
    claimedRewards: ['sharpened_focus'],
    ledger: [],
  });

  const perAct = resumed.route.floorsPerAct;
  assert.equal(resumed.act, 1, 'maps onto Act II');
  assert.equal(resumed.floor, perAct, 'at that act entry floor');
  assert.equal(resumed.nodeId, `f${perAct}n0`);
  assert.deepEqual(
    [...resumed.visitedNodeIds],
    Array.from({ length: perAct + 1 }, (_, i) => `f${i}n0`),
    'history is reconstructed along the spine',
  );
  assert.equal(resumed.carriedHeroHp, 70, 'progress is preserved');
  assert.ok(validateRunState(resumed));
});

test('a tampered save cannot inject its own graph', () => {
  const resumed = createResumedRunState({
    runId: 'tampered',
    status: 'active',
    level: 'B1',
    seed: 0x4543484f,
    wardenIndex: 0,
    heroMaxHp: 100,
    carriedHeroHp: 100,
    modifiers: { focusStart: 1, resonanceStart: 0, blockReliefBonus: 0 },
    claimedRewards: [],
    ledger: [],
    // A hostile blob claiming a one-node route straight to the final boss.
    route: { routeVersion: 'echo-forge-route-v1', floorsPerAct: 1, floors: [], edges: [] },
    nodeId: 'f0n0',
  });

  assert.deepEqual(resumed.route, generateRoute(0x4543484f), 'the seed decides the graph');
  assert.ok(resumed.route.floors.length > 1);
  assert.ok(validateRunState(resumed));
});
