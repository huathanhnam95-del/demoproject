import test from 'node:test';
import assert from 'node:assert/strict';

import SurvivalGame from '../public/js/survival-game/SurvivalGame.js';
import EntityManager from '../public/js/survival-game/EntityManager.js';
import Renderer from '../public/js/survival-game/Renderer.js';

function sequence(values) {
  let index = 0;
  return () => {
    const value = values[Math.min(index, values.length - 1)];
    index += 1;
    return value;
  };
}

test('survival game uses injected clock and frame seams', () => {
  const previousDocument = globalThis.document;
  const scheduled = [];
  const cancelled = [];

  try {
    globalThis.document = {
      body: {
        classList: {
          remove() {}
        }
      }
    };

    const state = Object.create(SurvivalGame.prototype);
    state.rafId = null;
    state.state = null;
    state.now = () => 1234;
    state.requestFrame = (cb) => {
      scheduled.push(cb);
      return 77;
    };
    state.cancelFrame = (id) => {
      cancelled.push(id);
    };
    state.resetCommandInput = () => {};
    state.setAudioPanelOpen = () => {};
    state.syncEnemyTutorialPrompt = () => {};
    state.audioManager = { stopBGM() {} };
    state.resume();

    assert.equal(state.lastTime, 1234);
    assert.equal(state.rafId, 77);
    assert.equal(scheduled.length, 1);

    state.stop();

    assert.deepEqual(cancelled, [77]);
    assert.equal(state.rafId, null);
  } finally {
    globalThis.document = previousDocument;
  }
});

test('survival game rollTraits uses the injected RNG deterministically', () => {
  const state = {
    wave: 999,
    omenConfig: { traitChanceMult: 1 },
    entityManager: { enemies: [] },
    getActiveShieldedEnemyCount() {
      return 0;
    },
    random: sequence([0, 0, 0, 0, 0.75])
  };

  const traits = SurvivalGame.prototype.rollTraits.call(state);

  assert.deepEqual(traits, { buffer: true });
});

test('entity manager spawnParticles uses the game RNG seam', () => {
  const manager = Object.create(EntityManager.prototype);
  manager.game = { random: sequence([0, 0, 0, 0, 0, 0]) };
  manager.particlePool = [];
  manager.particles = [];
  manager.maxParticles = 10;

  manager.spawnParticles(10, 20, '#fff', 1);

  assert.equal(manager.particles.length, 1);
  const particle = manager.particles[0];
  assert.equal(particle.x, 10);
  assert.equal(particle.y, 20);
  assert.equal(particle.vx, 60);
  assert.equal(particle.vy, 0);
  assert.equal(particle.size, 1);
  assert.equal(particle.rot, 0);
  assert.equal(particle.vr, -7);
  assert.equal(particle.shape, 'line');
  assert.equal(particle.len, 6);
});

test('renderer starfield uses the game RNG seam', () => {
  const renderer = Object.create(Renderer.prototype);
  renderer.game = { random: sequence([0.25, 0.5, 0.75, 0.1, 0.2]) };
  renderer.width = 100;
  renderer.height = 50;
  renderer._stars = [];

  renderer._buildStarfield();

  assert.equal(renderer._stars.length, 120);
  assert.deepEqual(renderer._stars[0], {
    x: 25,
    y: 15.5,
    r: 1.2,
    layer: 0.19,
    tw: Math.PI * 0.4
  });
});
