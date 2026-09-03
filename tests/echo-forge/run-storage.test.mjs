import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ECHO_FORGE_RUN_STORAGE_KEY,
  ECHO_FORGE_RUN_TTL_MS,
  normalizeSavedRun,
  loadSavedRun,
  saveRun,
  clearSavedRun,
} from '../../public/js/echo-forge-run-storage.js';

function createMockStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
    clear: () => { map.clear(); },
  };
}

const mockRunState = {
  schemaVersion: 'echo-forge-run-v1',
  runId: 'run_test_123',
  status: 'reward_pending',
  level: 'B1',
  seed: 42,
  wardenIndex: 0,
  heroMaxHp: 100,
  carriedHeroHp: 75,
  modifiers: { focusStart: 1, resonanceStart: 0, blockReliefBonus: 0 },
  rewardOffer: [{ id: 'resonant_reserve', name: 'Resonant Reserve', description: 'desc' }],
  claimedRewards: [],
  combat: { turn: 'player', status: 'active' }, // should be stripped!
  ledger: [{ wardenIndex: 0, wardenId: 'echo_sentinel', outcome: 'victory', rounds: 4, finalHeroHp: 75 }],
};

test('saveRun strips combat and serializes valid run', () => {
  const storage = createMockStorage();
  const now = 1000000000;
  const saved = saveRun(mockRunState, storage, now);

  assert.ok(saved !== null);
  assert.equal(saved.combat, null);
  assert.equal(saved.savedAt, now);
  assert.equal(saved.runId, 'run_test_123');

  const raw = storage.getItem(ECHO_FORGE_RUN_STORAGE_KEY);
  assert.ok(raw !== null);
  const parsed = JSON.parse(raw);
  assert.equal(parsed.combat, null);
});

test('loadSavedRun restores valid run within TTL', () => {
  const storage = createMockStorage();
  const now = 1000000000;
  saveRun(mockRunState, storage, now);

  // Load immediately
  const loaded = loadSavedRun(storage, now + 1000);
  assert.ok(loaded !== null);
  assert.equal(loaded.runId, 'run_test_123');
  assert.equal(loaded.carriedHeroHp, 75);
  assert.equal(loaded.combat, null);
});

test('loadSavedRun rejects expired run after 7 days', () => {
  const storage = createMockStorage();
  const now = 1000000000;
  saveRun(mockRunState, storage, now);

  // Load after 7 days + 1 second
  const expired = loadSavedRun(storage, now + ECHO_FORGE_RUN_TTL_MS + 1000);
  assert.equal(expired, null);
});

test('loadSavedRun gracefully handles corrupt JSON or invalid schemas', () => {
  const storage = createMockStorage({ [ECHO_FORGE_RUN_STORAGE_KEY]: '{ invalid json' });
  assert.equal(loadSavedRun(storage), null);

  const badSchema = createMockStorage({
    [ECHO_FORGE_RUN_STORAGE_KEY]: JSON.stringify({ schemaVersion: 'unknown', savedAt: Date.now() }),
  });
  assert.equal(loadSavedRun(badSchema), null);
});

test('clearSavedRun removes the key from storage', () => {
  const storage = createMockStorage();
  saveRun(mockRunState, storage);
  assert.ok(storage.getItem(ECHO_FORGE_RUN_STORAGE_KEY) !== null);

  clearSavedRun(storage);
  assert.equal(storage.getItem(ECHO_FORGE_RUN_STORAGE_KEY), null);
});
