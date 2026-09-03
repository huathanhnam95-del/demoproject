import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REWARDS,
  getRewardById,
  deriveRewardOffer,
  applyRewardEffect,
} from '../../public/js/echo-forge/core/rewards.js';

test('REWARDS defines 5 distinct immutable rewards', () => {
  assert.equal(REWARDS.length, 5);
  assert.equal(Object.isFrozen(REWARDS), true);

  const ids = new Set();
  for (const reward of REWARDS) {
    assert.equal(Object.isFrozen(reward), true);
    assert.ok(typeof reward.id === 'string');
    assert.ok(typeof reward.name === 'string');
    assert.ok(typeof reward.description === 'string');
    assert.ok(!ids.has(reward.id));
    ids.add(reward.id);
  }
});

test('getRewardById looks up rewards correctly', () => {
  assert.equal(getRewardById('resonant_reserve')?.name, 'Resonant Reserve');
  assert.equal(getRewardById('unknown_id'), undefined);
});

test('deriveRewardOffer always returns 2 distinct rewards deterministically', () => {
  const offer1 = deriveRewardOffer(12345, 0);
  const offer2 = deriveRewardOffer(12345, 0);
  assert.equal(offer1.length, 2);
  assert.notEqual(offer1[0].id, offer1[1].id);
  assert.deepEqual(offer1, offer2);

  // Different seed/warden returns valid pair
  const offer3 = deriveRewardOffer(98765, 1);
  assert.equal(offer3.length, 2);
  assert.notEqual(offer3[0].id, offer3[1].id);
});

test('applyRewardEffect modifies run state accurately', () => {
  const base = {
    heroMaxHp: 100,
    carriedHeroHp: 50,
    modifiers: { focusStart: 1, resonanceStart: 0, blockReliefBonus: 0 },
  };

  // 1. Resonant Reserve (+25 maxHp, full heal)
  const res1 = applyRewardEffect(base, 'resonant_reserve');
  assert.equal(res1.heroMaxHp, 125);
  assert.equal(res1.carriedHeroHp, 125);

  // 2. Sharpened Focus
  const res2 = applyRewardEffect(base, 'sharpened_focus');
  assert.equal(res2.modifiers.focusStart, 2);

  // 3. Ringing Echo
  const res3 = applyRewardEffect(base, 'ringing_echo');
  assert.equal(res3.modifiers.resonanceStart, 40);

  // 4. Tempered Guard
  const res4 = applyRewardEffect(base, 'tempered_guard');
  assert.equal(res4.modifiers.blockReliefBonus, 0.15);

  // 5. Second Wind (missing = 50, 60% = 30 -> 80)
  const res5 = applyRewardEffect(base, 'second_wind');
  assert.equal(res5.carriedHeroHp, 80);
});
