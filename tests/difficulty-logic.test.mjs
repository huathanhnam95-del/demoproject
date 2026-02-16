/**
 * Test Suite for DifficultyLogic
 * Run with: node tests/difficulty-logic.test.mjs
 */

import assert from 'node:assert/strict';
import { DifficultyLogic } from '../public/js/difficulty/DifficultyLogic.js';
import { DifficultyConfig } from '../public/js/difficulty/DifficultyConfig.js';

console.log('🧪 Starting DifficultyLogic Tests...');

const logic = new DifficultyLogic();

// Config sanity checks (calibration knobs)
assert.equal(DifficultyConfig.GRACE_PERIOD_ATTEMPTS, 10, 'Grace period should be 10 attempts');
assert.equal(DifficultyConfig.THRESHOLDS.UP, 0.85, 'UP threshold should be 0.85');
assert.equal(DifficultyConfig.THRESHOLDS.DOWN, 0.60, 'DOWN threshold should be 0.60');

// Replay caps should be consistent (Type + Speak)
assert.equal(logic.getLevelSettings('type', 1).maxReplays, 5, 'Type maxReplays should be 5');
assert.equal(logic.getLevelSettings('speak', 1).maxReplays, 5, 'Speak maxReplays should be 5');

const settingsAuto = { autoAdjustEnabled: true, adjustmentSensitivity: 'medium' };

function makeProfile(level, scores, assisted = false) {
  return {
    level,
    exp: 0,
    attemptsAtLevel: scores.length,
    history: scores.map((score) => ({ level, score, assisted }))
  };
}

// 1) Promote after grace period + strong rolling avg
{
  const profile = makeProfile(1, Array.from({ length: 10 }, () => 0.90));
  const result = logic.calculateAdjustment(profile, 0.90, settingsAuto);
  assert.deepEqual(result, { newLevel: 2, direction: 'increase', reason: 'performance' });
}

// 2) Demote after grace period + weak rolling avg
{
  const profile = makeProfile(3, Array.from({ length: 10 }, () => 0.40));
  const result = logic.calculateAdjustment(profile, 0.40, settingsAuto);
  assert.deepEqual(result, { newLevel: 2, direction: 'decrease', reason: 'struggle' });
}

// 3) No adjustment before grace period
{
  const profile = makeProfile(2, Array.from({ length: 10 }, () => 0.95));
  profile.attemptsAtLevel = 9;
  const result = logic.calculateAdjustment(profile, 0.95, settingsAuto);
  assert.equal(result, null);
}

// 4) Manual mode disables adjustments
{
  const profile = makeProfile(2, Array.from({ length: 10 }, () => 0.95));
  const settingsManual = { autoAdjustEnabled: false, adjustmentSensitivity: 'medium' };
  const result = logic.calculateAdjustment(profile, 0.95, settingsManual);
  assert.equal(result, null);
}

console.log('✅ DifficultyLogic tests passed');

