import assert from 'node:assert/strict';

const storage = new Map();
const elementCache = new Map();

function createMockElement(id = '') {
  return {
    id,
    style: {},
    textContent: '',
    innerHTML: '',
    className: '',
    dataset: {},
    classList: {
      add() {},
      remove() {},
      toggle() {},
      contains() { return false; }
    },
    appendChild() {},
    remove() {},
    addEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; }
  };
}

globalThis.window = {
  addEventListener() {},
  removeEventListener() {},
  speechSynthesis: { cancel() {} }
};

globalThis.localStorage = {
  getItem(key) {
    return storage.has(key) ? storage.get(key) : null;
  },
  setItem(key, value) {
    storage.set(key, String(value));
  },
  removeItem(key) {
    storage.delete(key);
  }
};

globalThis.document = {
  addEventListener() {},
  querySelector() { return null; },
  getElementById(id) {
    if (!elementCache.has(id)) {
      elementCache.set(id, createMockElement(id));
    }
    return elementCache.get(id);
  },
  createElement(tag) {
    return createMockElement(tag);
  },
  body: {
    appendChild() {}
  }
};

globalThis.requestAnimationFrame = (cb) => cb();

storage.set('difficulty_profile', JSON.stringify({
  version: 2,
  settings: {
    autoAdjustEnabled: true,
    adjustmentSensitivity: 'high',
    manualLevel: 4
  },
  profiles: {
    type: {
      level: 2,
      exp: 7,
      history: [{ date: 1, score: 0.9, level: 2, assisted: false, calibMult: 1 }],
      attemptsAtLevel: 1
    }
  }
}));

await import('../public/js/difficulty-manager.js');

assert.ok(window.DifficultyManager, 'DifficultyManager should attach to window');
window.DifficultyManager.init();

assert.equal(window.DifficultyManager.getCurrentSettings('type').level, 2, 'Should hydrate legacy profile level');
assert.equal(window.DifficultyManager.getContentTier('type'), 1, 'Level 2 should map to content tier 1');

const beforeProfile = window.DifficultyManager.getProfile('type');
assert.equal(beforeProfile.history.length, 1, 'Seeded history should exist before manual change');

window.DifficultyManager.setManualLevel(5);

const afterProfile = window.DifficultyManager.getProfile('type');
assert.equal(afterProfile.history.length, 1, 'Manual level change should not clear history');
assert.equal(afterProfile.attemptsAtLevel, 1, 'Manual level change should not reset attempts');
assert.equal(window.DifficultyManager.getGlobalSettings().autoAdjustEnabled, false, 'Manual mode should disable auto adjust');
assert.equal(window.DifficultyManager.getGlobalSettings().manualLevel, 5, 'Manual level should be updated');

const saved = JSON.parse(storage.get('difficulty_profile'));
assert.equal(saved.version, 3, 'Profile should be saved using schema version 3');
assert.equal(saved.profiles.type.history.length, 1, 'Saved profile should preserve history');
assert.equal(saved.globalSettings.manualLevel, 5, 'Saved profile should preserve manual level');

console.log('DifficultyManager state tests passed');
