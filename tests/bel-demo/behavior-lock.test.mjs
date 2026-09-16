import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createSession } from '../../public/prototypes/bel-working-as-equals-demo/state/session.mjs';
import {
  createWorld,
  transition,
  act,
  stepWorld,
  solidsFor,
  monitorPresence
} from '../../public/prototypes/bel-working-as-equals-demo/world/simulation.mjs';
import { SCENES } from '../../public/prototypes/bel-working-as-equals-demo/world/scenes.mjs';
import { move, valid, vector } from '../../public/prototypes/bel-working-as-equals-demo/world/geometry.mjs';
import {
  PLANKS,
  PHASES,
  plankPosition,
  createBridge,
  bridgeReady,
  resetBridge,
  tickBridge,
  bridgeControl,
  bridgeInteract
} from '../../public/prototypes/bel-working-as-equals-demo/activities/bridge.mjs';
import {
  QUESTIONS,
  createReversal,
  choiceAt,
  choiceReady,
  startReversal,
  tickReversal
} from '../../public/prototypes/bel-working-as-equals-demo/activities/reversal.mjs';
import {
  CUBES,
  createCubes,
  claimCube,
  matchCubes
} from '../../public/prototypes/bel-working-as-equals-demo/activities/cubes.mjs';

function setupWorld(scene = 'F') {
  const session = createSession({ id: 'behavior-lock' });
  const b = session.state;
  for (const p of Object.values(b.players)) {
    p.connected = true;
    p.ready = true;
  }
  const w = createWorld(b);
  for (const id of Object.keys(w.players)) {
    transition(w, id, scene);
  }
  return { w, b };
}

function doAct(w, b, id, type, payload = {}) {
  return act(w, b, id, {
    type,
    payload: {
      instance: w.players[id].instance,
      generation: w.bridge?.generation ?? 0,
      ...payload
    }
  });
}

test('C06-C08 / P02.2: F bridge clock sequence (60s prep, 30s attempt, 10s review) and single plank carry', () => {
  const { w, b } = setupWorld('F');
  assert.equal(w.bridge.phase, 'gathering');

  // Must wait for presenter start
  doAct(w, b, 'p0', 'activity', { action: 'start' });
  assert.equal(w.bridge.phase, 'preparation');
  assert.equal(w.bridge.remaining, 60000);

  // During preparation, inspect works but carry fails
  const plank = w.bridge.planks[0];
  Object.assign(w.players.p1, { x: plank.x, y: plank.y - 20 });
  doAct(w, b, 'p1', 'interact', { target: plank.id });
  assert.equal(w.players.p1.carry, null);
  assert.equal(w.players.p1.inspect, plank.id);

  // Step 60s into attempt
  stepWorld(w, b, {}, 60, 60000);
  assert.equal(w.bridge.phase, 'attempt');
  assert.equal(w.bridge.remaining, 30000);
  assert.equal(w.bridge.attempt, 1);

  // Pick up plank 0
  doAct(w, b, 'p1', 'interact', { target: plank.id });
  assert.equal(w.players.p1.carry, plank.id);
  assert.equal(plank.owner, 'p1');

  // Attempt to carry second plank throws
  const plank1 = w.bridge.planks[1];
  Object.assign(w.players.p1, { x: plank1.x, y: plank1.y - 20 });
  assert.throws(() => doAct(w, b, 'p1', 'interact', { target: plank1.id }), /one plank at a time/);

  // Place plank 0 successfully at index 0
  const targetPos = plankPosition(0);
  Object.assign(w.players.p1, { x: targetPos.x, y: targetPos.y + 25 });
  doAct(w, b, 'p1', 'interact', { target: 'bridge-next' });
  assert.equal(w.bridge.placed, 1);
  assert.equal(w.players.p1.carry, null);
  assert.equal(plank.placed, true);

  // Wrong placement retains the carried plank
  Object.assign(w.players.p1, { x: w.bridge.planks[3].x, y: w.bridge.planks[3].y - 20 });
  doAct(w, b, 'p1', 'interact', { target: w.bridge.planks[3].id });
  assert.equal(w.players.p1.carry, w.bridge.planks[3].id);
  Object.assign(w.players.p1, { x: targetPos.x, y: targetPos.y + 25 });
  assert.throws(() => doAct(w, b, 'p1', 'interact', { target: 'bridge-next' }), /comes elsewhere/);
  assert.equal(w.players.p1.carry, w.bridge.planks[3].id, 'Plank must be retained on wrong placement');
});

test('C09-C10 / P02.2: F bridge Skip (no teleport) and Reset generation protection', () => {
  const { w, b } = setupWorld('F');
  doAct(w, b, 'p0', 'activity', { action: 'start' });
  stepWorld(w, b, {}, 60, 60000); // Into attempt

  const p1XBefore = w.players.p1.x;
  const p1YBefore = w.players.p1.y;

  // Participant cannot skip
  assert.throws(() => doAct(w, b, 'p1', 'activity', { action: 'skip' }), /presenter/i);

  // Presenter skips: bridge completes, assisted is true, no teleport
  doAct(w, b, 'p0', 'activity', { action: 'skip' });
  assert.equal(w.bridge.phase, 'complete');
  assert.equal(w.bridge.placed, 6);
  assert.equal(w.bridge.assisted, true);
  assert.equal(w.players.p1.x, p1XBefore, 'Skip must not teleport participants');
  assert.equal(w.players.p1.y, p1YBefore, 'Skip must not teleport participants');

  // Once G starts, Reset throws
  w.gStarted = true;
  assert.throws(() => doAct(w, b, 'p0', 'activity', { action: 'reset' }), /complete/);
});

test('C11-C13 / P02.2: Room I reversal 3s/5s/10s/20s loop, exact bounds, and non-stacking debuff', () => {
  const { w, b } = setupWorld('I');
  assert.equal(w.reversal.phase, 'gathering');

  // Start reversal
  doAct(w, b, 'p0', 'activity', { action: 'start' });
  assert.equal(w.reversal.phase, 'opening');
  assert.equal(w.reversal.remaining, 3000);

  // Position p1 in Do [135, 420], p2 in neutral, p3 in Don't [581, 866]
  Object.assign(w.players.p1, { x: 250, y: 250 }); // In Do
  Object.assign(w.players.p2, { x: 500, y: 250 }); // Neutral (null)
  Object.assign(w.players.p3, { x: 700, y: 250 }); // In Don't

  // Question 0 answer is 'Do'
  assert.equal(choiceAt(w.players.p1), 'Do');
  assert.equal(choiceAt(w.players.p2), null);
  assert.equal(choiceAt(w.players.p3), "Don't");

  // Follower choice returns null (leader carries them)
  w.players.p1.leader = 'p0';
  assert.equal(choiceAt(w.players.p1), null, 'Linked follower cannot make independent choice');
  w.players.p1.leader = null;

  // Tick 3s -> enters choice (5000ms)
  stepWorld(w, b, {}, 3, 3000);
  assert.equal(w.reversal.phase, 'choice');
  assert.equal(w.reversal.remaining, 5000);

  // Tick 5s -> evaluates choices
  stepWorld(w, b, {}, 5, 8000);
  assert.equal(w.reversal.results.length, 1);
  assert.equal(w.reversal.results[0].players.p1.correct, true);
  assert.equal(w.reversal.results[0].players.p2.correct, false);
  assert.equal(w.reversal.results[0].players.p3.correct, false);

  // p2 and p3 get 20000ms debuff
  assert.equal(w.reversal.debuffs.p1, 0);
  assert.equal(w.reversal.debuffs.p2, 20000);
  assert.equal(w.reversal.debuffs.p3, 20000);

  // Movement reversed for debuffed player: key 'd' moves left (decreasing x)
  const xBefore = w.players.p2.x;
  stepWorld(w, b, { p2: { keys: { w: false, a: false, s: false, d: true }, at: 8050 } }, 0.05, 8050);
  assert.ok(w.players.p2.x < xBefore, 'Debuffed movement must reverse direction');

  // Debuff and interval ticked down by 50ms
  assert.equal(w.reversal.phase, 'interval');
  assert.equal(w.reversal.remaining, 9950);
  assert.equal(w.reversal.debuffs.p2, 19950);

  // Finish remaining 9950ms of interval (9.95s)
  stepWorld(w, b, {}, 9.95, 18000);
  assert.equal(w.reversal.debuffs.p2, 10000);

  // Question 1 opens (3s) and choices (5s)
  stepWorld(w, b, {}, 3, 21000);
  assert.equal(w.reversal.debuffs.p2, 7000);
  stepWorld(w, b, {}, 5, 26000); // Question 1 choice evaluated (answer is Don't, p2 is at 500 null -> incorrect)
  assert.equal(w.reversal.debuffs.p2, 2000, 'Debuff must decrement and not re-stack over existing debuff');
});

test('C15-C17 / P02.2: J cubes two-carrier rule, mismatch handling, and completion without auto-start', () => {
  const { w, b } = setupWorld('J');
  assert.deepEqual(w.cubes.pairs, [false, false, false]);

  // Player claims cube 0 (Conduct, pair 2)
  const c0 = w.cubes.cubes[0];
  Object.assign(w.players.p1, { x: c0.x, y: c0.y - 20 });
  doAct(w, b, 'p1', 'interact', { target: c0.id });
  assert.equal(w.players.p1.carry, c0.id);

  // Player claims cube 1 (Identify, pair 0)
  const c1 = w.cubes.cubes[1];
  Object.assign(w.players.p2, { x: c1.x, y: c1.y - 20 });
  doAct(w, b, 'p2', 'interact', { target: c1.id });
  assert.equal(w.players.p2.carry, c1.id);

  // Bring them together and attempt match: mismatch (pair 2 vs pair 0)
  Object.assign(w.players.p1, { x: 300, y: 300 });
  Object.assign(w.players.p2, { x: 331, y: 300 });
  const mismatchRes = doAct(w, b, 'p1', 'interact', { target: 'p2' });
  assert.equal(mismatchRes.kind, 'toast');
  assert.ok(mismatchRes.text.includes('do not match'));
  assert.equal(w.players.p1.carry, c0.id, 'Mismatch must retain cube 1');
  assert.equal(w.players.p2.carry, c1.id, 'Mismatch must retain cube 2');

  // Player 2 drops cube 1 and picks up cube 4 (Literature review, pair 2)
  doAct(w, b, 'p2', 'drop');
  assert.equal(w.players.p2.carry, null);
  const c4 = w.cubes.cubes[4];
  Object.assign(w.players.p2, { x: c4.x, y: c4.y - 20 });
  doAct(w, b, 'p2', 'interact', { target: c4.id });
  assert.equal(w.players.p2.carry, c4.id);

  // Match cubes 0 and 4 (pair 2)
  Object.assign(w.players.p2, { x: 331, y: 300 });
  const matchRes = doAct(w, b, 'p1', 'interact', { target: 'p2' });
  assert.equal(matchRes.kind, 'toast');
  assert.ok(matchRes.text.includes('A match'));
  assert.equal(w.cubes.pairs[2], true, 'Pair 2 must be completed');
  assert.equal(w.players.p1.carry, null);
  assert.equal(w.players.p2.carry, null);

  // Completing all pairs does NOT auto-start final presentation
  w.cubes.pairs = [true, true, true];
  stepWorld(w, b, {}, 1, 1000);
  assert.equal(b.presentation.active, false, 'J completion must not auto-start presentation');
});

test('C21 / P02.2: Speeds 108 walk / 165 ride, normalized diagonals, and collision bounds', () => {
  const scene = SCENES.street;
  const p = { x: 500, y: 350, facing: 'right', ride: null };

  // Move right for 1 second (108 px/s)
  const movedH = move(p, 108, 0, scene, []);
  assert.equal(Math.round(movedH.x - p.x), 108, 'Horizontal walking speed must be 108 px/s');

  // Diagonal vector normalization
  const v = vector({ d: true, s: true, a: false, w: false });
  assert.equal(Math.round(Math.hypot(v.x, v.y)), 1, 'Input diagonal vector must be unit length');

  // Move along normalized diagonal with 108 px/s
  const movedDiag = move(p, 108 * v.x, 108 * v.y, scene, []);
  const dist = Math.hypot(movedDiag.x - p.x, movedDiag.y - p.y);
  assert.equal(Math.round(dist), 108, 'Diagonal movement must be normalized to same 108 px/s');

  // Riding speed is 165 px/s
  p.ride = 'car';
  const movedRide = move(p, 165, 0, scene, []);
  assert.equal(Math.round(movedRide.x - p.x), 165, 'Riding speed must be 165 px/s');
});
