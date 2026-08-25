import { COMBAT_POLICY } from './policy.js';

export function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function assertScore(score) {
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    throw new RangeError('score must be from 0 through 100');
  }
}

function assertDamage(damage) {
  if (!Number.isFinite(damage) || damage < 0) throw new RangeError('damage must be non-negative');
}

export function calculateAttackDamage({ base, score, combo = 0, burst = false }) {
  assertDamage(base);
  assertScore(score);
  if (!Number.isFinite(combo) || combo < 0) throw new RangeError('combo must be non-negative');
  const accuracyFactor = 0.20 + 1.30 * (score / 100) ** 1.6;
  const comboBonus = 1 + 0.05 * Math.min(combo, COMBAT_POLICY.combo.damageCap);
  const burstBonus = burst ? COMBAT_POLICY.burst.multiplier : 1;
  return Math.round(base * accuracyFactor * comboBonus * burstBonus);
}

export function resolveBlock({ outcome, enemyBaseDamage }) {
  assertDamage(enemyBaseDamage);
  const multipliers = { correct: 0.5, incorrect: 0.8, timeout: 1 };
  if (!Object.hasOwn(multipliers, outcome)) throw new RangeError(`invalid Block outcome: ${outcome}`);
  const incomingMultiplier = multipliers[outcome];
  return Object.freeze({
    damage: Math.round(enemyBaseDamage * incomingMultiplier),
    incomingMultiplier,
    focusRestored: outcome === 'correct' ? 1 : 0,
  });
}

export function resolveParry({ score, timing, enemyBaseDamage }) {
  assertScore(score);
  assertDamage(enemyBaseDamage);
  if (timing !== 'timely' && timing !== 'late') throw new RangeError(`invalid Parry timing: ${timing}`);
  const timelyMultiplier = clamp(1 - score / 90, 0, 1);
  const incomingMultiplier = timing === 'late' ? Math.max(0.5, timelyMultiplier) : timelyMultiplier;
  return Object.freeze({
    damage: Math.round(enemyBaseDamage * incomingMultiplier),
    incomingMultiplier,
    reflectedDamage: timing === 'timely' && score >= 95 ? Math.round(enemyBaseDamage * 0.5) : 0,
    timing,
  });
}
