import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { createSession } from '../../public/prototypes/bel-working-as-equals-demo/state/session.mjs';
import {
  createWorld,
  transition,
  act,
  stepWorld
} from '../../public/prototypes/bel-working-as-equals-demo/world/simulation.mjs';

/**
 * P02.3 Canonical State Projection.
 * Extracts all authoritative simulation, session, activity, and progression state,
 * while excluding transient display-only metadata (such as waveUntil arm animation,
 * mismatchUntil visual shake, and transport loop tick counters).
 */
export function projectCanonicalState(world, sessionState) {
  const players = {};
  for (const [id, p] of Object.entries(world.players)) {
    players[id] = {
      scene: p.scene,
      instance: p.instance,
      x: Math.round(p.x * 100) / 100,
      y: Math.round(p.y * 100) / 100,
      facing: p.facing,
      pose: p.pose,
      carry: p.carry,
      seat: p.seat,
      ride: p.ride,
      leader: p.leader,
      follower: p.follower,
      inspect: p.inspect
    };
  }

  const bridge = world.bridge ? {
    generation: world.bridge.generation,
    phase: world.bridge.phase,
    remaining: world.bridge.remaining,
    attempt: world.bridge.attempt,
    placed: world.bridge.placed,
    assisted: world.bridge.assisted,
    planks: world.bridge.planks.map(pl => ({
      index: pl.index,
      owner: pl.owner,
      placed: pl.placed,
      x: pl.x,
      y: pl.y
    }))
  } : null;

  const reversal = world.reversal ? {
    phase: world.reversal.phase,
    index: world.reversal.index,
    remaining: world.reversal.remaining,
    results: JSON.parse(JSON.stringify(world.reversal.results)),
    debuffs: { ...world.reversal.debuffs }
  } : null;

  const cubes = world.cubes ? {
    pairs: [...world.cubes.pairs],
    cubes: world.cubes.cubes.map(c => ({
      index: c.index,
      pair: c.pair,
      owner: c.owner,
      placed: c.placed,
      x: c.x,
      y: c.y
    }))
  } : null;

  const deck = {
    slide: world.deck?.slide ?? null,
    finalPage: world.deck?.finalPage ?? null,
    etaOrigin: world.deck?.etaOrigin ?? null
  };

  const unlocked = { ...world.unlocked };

  const session = sessionState ? {
    step: sessionState.step,
    activePresentation: !!sessionState.presentation?.active,
    presentationRoom: sessionState.presentation?.roomId ?? null,
    pauseReasons: [...(sessionState.pauseReasons || [])]
  } : null;

  return {
    players,
    bridge,
    reversal,
    cubes,
    deck,
    unlocked,
    session
  };
}

export function hashState(projection) {
  return crypto.createHash('sha256').update(JSON.stringify(projection)).digest('hex');
}

test('P02.3: Canonical state projection captures authoritative simulation fields and ignores view transients', () => {
  const session = createSession({ id: 'parity-test' });
  const b = session.state;
  const w = createWorld(b);

  const p0 = w.players.p0;
  p0.waveUntil = 999999; // Visual wave animation timer
  p0.mismatchUntil = 888888; // Visual shake pulse

  const proj1 = projectCanonicalState(w, b);
  const hash1 = hashState(proj1);

  // Changing a transient view property does not alter canonical state hash
  p0.waveUntil = 111111;
  p0.mismatchUntil = 222222;
  const proj2 = projectCanonicalState(w, b);
  const hash2 = hashState(proj2);
  assert.equal(hash1, hash2, 'Transient view properties must not affect canonical state projection');

  // Changing an authoritative property changes canonical hash
  p0.x += 10;
  const proj3 = projectCanonicalState(w, b);
  const hash3 = hashState(proj3);
  assert.notEqual(hash1, hash3, 'Authoritative coordinate change must change canonical hash');
});

test('P02.3: Mutation sensitivity detects alteration to activity, pair mappings, and progression', () => {
  const session = createSession({ id: 'mutation-test' });
  const b = session.state;
  const w = createWorld(b);
  transition(w, 'p1', 'F');

  const baseHash = hashState(projectCanonicalState(w, b));

  // Bridge placed count
  w.bridge.placed = 1;
  const hBridge = hashState(projectCanonicalState(w, b));
  assert.notEqual(baseHash, hBridge, 'Bridge placed count change must alter projection');
  w.bridge.placed = 0;

  // Unlocked room
  w.unlocked.G = true;
  const hUnlocked = hashState(projectCanonicalState(w, b));
  assert.notEqual(baseHash, hUnlocked, 'Room unlock change must alter projection');
  w.unlocked.G = false;

  // Deck finalPage / ETA
  w.deck.finalPage = 'eta';
  const hDeck = hashState(projectCanonicalState(w, b));
  assert.notEqual(baseHash, hDeck, 'Deck finalPage change must alter projection');
  w.deck.finalPage = 'determine';

  // Cubes pair completion
  transition(w, 'p1', 'J');
  w.cubes.pairs[0] = true;
  const hCubes = hashState(projectCanonicalState(w, b));
  assert.notEqual(baseHash, hCubes, 'Cube pair match change must alter projection');
});

test('P02.3: Deterministic simulation runs produce identical canonical state projections', () => {
  function runSequence() {
    const s = createSession({ id: 'deterministic-run' });
    const b = s.state;
    for (const p of Object.values(b.players)) {
      p.connected = true;
      p.ready = true;
    }
    const w = createWorld(b);
    for (const id of Object.keys(w.players)) {
      transition(w, id, 'F');
    }

    act(w, b, 'p0', {
      type: 'activity',
      payload: {
        action: 'start',
        instance: w.players.p0.instance,
        generation: w.bridge.generation
      }
    });
    stepWorld(w, b, {}, 20, 20000);
    stepWorld(w, b, { p1: { keys: { w: false, a: false, s: false, d: true }, at: 20100 } }, 0.1, 20100);

    return projectCanonicalState(w, b);
  }

  const run1 = runSequence();
  const run2 = runSequence();
  assert.deepEqual(run1, run2, 'Two identical simulation runs must yield deep-equal canonical state projections');
  assert.equal(hashState(run1), hashState(run2), 'State projection hashes must match exactly');
});
