import assert from 'node:assert/strict';

import { GameConfig } from '../public/js/survival-game/GameConfig.js';

console.log('Starting survival config balance tests...');

assert.equal(GameConfig.BALANCE.ENEMY_SPEED_MULT, 0.52, 'enemy movement should be reduced by 20%');
assert.equal(GameConfig.BALANCE.ENEMY_SPAWN_INTERVAL_MULT, 1.68, 'ambient spawn interval should be 20% longer');
assert.equal(GameConfig.BALANCE.ENEMY_BEAT_SPAWN_CHANCE_MULT, 0.8, 'beat spawns should be reduced by 20%');
assert.equal(GameConfig.ENEMIES.SHIELD_LINK.RADIUS, 70, 'shield link radius should be reduced by 50%');
assert.equal(GameConfig.ENEMIES.TRAITS.SHIELD.MAX_ACTIVE, 2, 'shielded enemies should cap at two active');

console.log('survival config balance tests passed');
