import assert from 'node:assert/strict';

import {
  canSpawnShieldedEnemy,
  pickSpawnEnemyType,
  updateEnemyIntroState
} from '../public/js/survival-game/SurvivalBalance.js';

console.log('Starting survival balance tests...');

{
  const next = updateEnemyIntroState(
    {
      stableTime: 0,
      introducedTypes: ['drone']
    },
    {
      wave: 5,
      wpm: 48,
      combo: 18,
      mistakePenalty: 0,
      loadRatio: 0.4
    },
    24
  );

  assert.equal(next.unlockedType, 'rusher', 'stable rhythm should unlock the next enemy type first');
  assert.deepEqual(next.introducedTypes, ['drone', 'rusher']);
  assert.equal(next.stableTime, 0, 'unlocking should reset the stability timer');
}

{
  const next = updateEnemyIntroState(
    {
      stableTime: 0,
      introducedTypes: ['drone', 'rusher']
    },
    {
      wave: 5,
      wpm: 48,
      combo: 18,
      mistakePenalty: 0,
      loadRatio: 0.4
    },
    24
  );

  assert.equal(next.unlockedType, 'turret', 'late-wave stable play should introduce turret only after rusher');
  assert.deepEqual(next.introducedTypes, ['drone', 'rusher', 'turret']);
}

{
  const type = pickSpawnEnemyType({
    wave: 10,
    introducedTypes: ['drone'],
    splitterRoll: 0,
    typeRoll: 0.05
  });

  assert.equal(type, 'drone', 'late waves should still stay on drones until new types are introduced');
}

{
  const type = pickSpawnEnemyType({
    wave: 10,
    introducedTypes: ['drone', 'rusher', 'turret', 'tank'],
    splitterRoll: 1,
    typeRoll: 0.2
  });

  assert.equal(type, 'turret', 'introduced enemy types should use the weighted late-wave mix');
}

assert.equal(canSpawnShieldedEnemy(0, 2), true, 'shielded spawns should be allowed below the cap');
assert.equal(canSpawnShieldedEnemy(2, 2), false, 'shielded spawns should stop at the active cap');

console.log('survival balance tests passed');
