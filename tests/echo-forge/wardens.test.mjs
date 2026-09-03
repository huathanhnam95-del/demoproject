import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WARDENS,
  selectWardenMove,
  calculateMoveIncomingDamage,
} from '../../public/js/echo-forge/core/wardens.js';

test('WARDENS roster defines 3 immutable wardens with clear escalation', () => {
  assert.equal(WARDENS.length, 3);
  assert.equal(Object.isFrozen(WARDENS), true);

  const [sentinel, cinder, voidWarden] = WARDENS;

  assert.equal(sentinel.id, 'echo_sentinel');
  assert.equal(sentinel.name, 'Echo Sentinel');
  assert.equal(sentinel.colorToken, 'sentinel');
  assert.equal(sentinel.maxHp, 120);
  assert.equal(sentinel.baseDamage, 20);

  assert.equal(cinder.id, 'cinder_weaver');
  assert.equal(cinder.maxHp, 150);
  assert.equal(cinder.baseDamage, 24);

  assert.equal(voidWarden.id, 'void_singer');
  assert.equal(voidWarden.maxHp, 185);
  assert.equal(voidWarden.baseDamage, 28);

  for (const warden of WARDENS) {
    assert.equal(Object.isFrozen(warden), true);
    assert.equal(Object.isFrozen(warden.moves), true);
    assert.ok(warden.moves.length >= 3);
    for (const move of warden.moves) {
      assert.equal(Object.isFrozen(move), true);
      assert.ok(['block', 'parry', 'either'].includes(move.counter));
      assert.ok(move.damageMultiplier >= 1.0);
      assert.ok(move.wrongCounterMultiplier >= 1.0);
      assert.ok(typeof move.tell === 'string' && move.tell.length > 0);
    }
  }
});

test('selectWardenMove pins round 1 of first warden to moves[0]', () => {
  const sentinel = WARDENS[0];
  const move1 = selectWardenMove(sentinel, { seed: 12345, wardenIndex: 0, round: 1 });
  const move2 = selectWardenMove(sentinel, { seed: 99999, wardenIndex: 0, round: 1 });

  assert.equal(move1.id, 'pulse_strike');
  assert.equal(move2.id, 'pulse_strike');
  assert.equal(move1, sentinel.moves[0]);
});

test('selectWardenMove is deterministic across seeds and rounds', () => {
  const cinder = WARDENS[1];
  const a = selectWardenMove(cinder, { seed: 42, wardenIndex: 1, round: 2 });
  const b = selectWardenMove(cinder, { seed: 42, wardenIndex: 1, round: 2 });

  assert.equal(a.id, b.id);
  assert.ok(cinder.moves.some((m) => m.id === a.id));
});

test('calculateMoveIncomingDamage applies counter matching and wrong counter penalties', () => {
  const sentinel = WARDENS[0];
  const pulseStrike = sentinel.moves[0]; // either, 1.0x, wrong: 1.0x
  const shatterTone = sentinel.moves[1]; // block, 1.15x, wrong: 1.35x
  const flutterBurst = sentinel.moves[2]; // parry, 1.10x, wrong: 1.35x

  // Round 1 pulse_strike deals exactly 20 for both defenses
  assert.equal(calculateMoveIncomingDamage(sentinel, pulseStrike, 'block'), 20);
  assert.equal(calculateMoveIncomingDamage(sentinel, pulseStrike, 'parry'), 20);

  // Shatter Tone rewards block and penalizes parry
  // Base: 20 * 1.15 = 23 (matching block)
  // Wrong: 20 * 1.15 * 1.35 = 31.05 -> 31
  assert.equal(calculateMoveIncomingDamage(sentinel, shatterTone, 'block'), 23);
  assert.equal(calculateMoveIncomingDamage(sentinel, shatterTone, 'parry'), 31);

  // Flutter Burst rewards parry and penalizes block
  // Base: 20 * 1.10 = 22 (matching parry)
  // Wrong: 20 * 1.10 * 1.35 = 29.7 -> 30
  assert.equal(calculateMoveIncomingDamage(sentinel, flutterBurst, 'parry'), 22);
  assert.equal(calculateMoveIncomingDamage(sentinel, flutterBurst, 'block'), 30);
});
