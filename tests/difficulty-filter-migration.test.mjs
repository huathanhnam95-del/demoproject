import assert from 'node:assert/strict';

const storage = new Map();
const elementCache = new Map();
let populateCalls = 0;

function createOption(value) {
  return {
    getAttribute(name) {
      return name === 'data-value' ? value : null;
    },
    addEventListener() {},
    classList: {
      toggle() {}
    }
  };
}

function createMockElement(id = '') {
  return {
    id,
    style: {},
    textContent: '',
    innerHTML: '',
    classList: {
      add() {},
      remove() {},
      toggle() {},
      contains() { return false; }
    },
    addEventListener() {},
    querySelectorAll() {
      return [createOption('all'), createOption('1'), createOption('2'), createOption('3')];
    }
  };
}

globalThis.window = {
  authUI: {
    getCurrentUserId() {
      return 'user-1';
    }
  },
  populateQuestionSelect() {
    populateCalls += 1;
  }
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
  readyState: 'loading',
  addEventListener() {},
  getElementById(id) {
    if (!elementCache.has(id)) {
      elementCache.set(id, createMockElement(id));
    }
    return elementCache.get(id);
  }
};

storage.set('difficultyFilter_type_user-1', '2');

await import('../public/difficulty-filter.js');

window.DifficultyFilter.reloadSavedDifficulty('type');

assert.equal(localStorage.getItem('difficultyFilter_type_user-1'), null, 'Legacy key should be removed after migration');
assert.equal(localStorage.getItem('questionDifficulty_type_user-1'), '2', 'Migrated key should preserve saved value');

assert.equal(window.DifficultyFilter.getCurrentDifficulty('type'), '2', 'Reload should read migrated key');
assert.equal(elementCache.get('difficulty-filter-label-type').textContent, 'Level 2 (Medium)', 'Label should reflect migrated selection');
assert.equal(populateCalls, 1, 'Reload should apply the migrated filter once');

window.DifficultyFilter.selectDifficulty('type', '3');

assert.equal(localStorage.getItem('questionDifficulty_type_user-1'), '3', 'Writes should use the new key');
assert.equal(localStorage.getItem('difficultyFilter_type_user-1'), null, 'Writes should not recreate the legacy key');

storage.set('questionDifficulty_speak_user-1', 'bogus');
window.DifficultyFilter.reloadSavedDifficulty('speak');

assert.equal(localStorage.getItem('questionDifficulty_speak_user-1'), 'all', 'Invalid persisted values should normalize to all');
assert.equal(window.DifficultyFilter.getCurrentDifficulty('speak'), 'all', 'Invalid persisted values should not leak into the current state');

console.log('DifficultyFilter migration tests passed');
