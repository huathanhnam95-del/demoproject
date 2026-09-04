import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ECHO_FORGE_RUN_STORAGE_KEY,
  normalizeSavedRun,
  saveRun,
  loadSavedRun,
} from '../../public/js/echo-forge-run-storage.js';

function memoryStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)); },
    removeItem: (key) => { store.delete(key); },
    _dump: () => Object.fromEntries(store),
  };
}

const BASE = Object.freeze({
  schemaVersion: 'echo-forge-run-v1',
  runId: 'run_test',
  status: 'active',
  level: 'B1',
  seed: 0x4543484f,
  wardenIndex: 0,
  heroMaxHp: 100,
  carriedHeroHp: 90,
  modifiers: { focusStart: 1, resonanceStart: 0, blockReliefBonus: 0 },
  claimedRewards: [],
  ledger: [],
});

test('route position round-trips through storage', () => {
  const storage = memoryStorage();
  const saved = saveRun({
    ...BASE,
    status: 'map_pending',
    floorsPerAct: 4,
    act: 1,
    floor: 5,
    nodeId: 'f5n2',
    visitedNodeIds: ['f0n0', 'f1n1', 'f2n0', 'f3n0', 'f4n0', 'f5n2'],
    rewardSource: 'boss',
  }, storage);

  assert.ok(saved);
  assert.equal(saved.status, 'map_pending');
  assert.equal(saved.act, 1);
  assert.equal(saved.floor, 5);
  assert.equal(saved.nodeId, 'f5n2');
  assert.equal(saved.visitedNodeIds.length, 6);
  assert.equal(saved.rewardSource, 'boss');

  const loaded = loadSavedRun(storage);
  assert.deepEqual(loaded.visitedNodeIds, saved.visitedNodeIds);
  assert.equal(loaded.nodeId, 'f5n2');
});

test('the route graph is never persisted', () => {
  const storage = memoryStorage();
  saveRun({
    ...BASE,
    // A hostile blob trying to smuggle its own map into storage.
    route: { routeVersion: 'echo-forge-route-v1', floorsPerAct: 1, floors: [], edges: [] },
  }, storage);

  const rawText = storage._dump()[ECHO_FORGE_RUN_STORAGE_KEY];
  assert.ok(!rawText.includes('routeVersion'), 'no graph reached storage');

  const loaded = loadSavedRun(storage);
  assert.equal(loaded.route, undefined, 'and none comes back out');
});

test('map_pending is an accepted status', () => {
  assert.ok(normalizeSavedRun({ ...BASE, status: 'map_pending', savedAt: Date.now() }));
  assert.equal(normalizeSavedRun({ ...BASE, status: 'wandering', savedAt: Date.now() }), null);
});

test('a legacy save is migrated onto the pinned spine', () => {
  // Exactly the shape written before the route layer existed.
  const legacy = {
    schemaVersion: 'echo-forge-run-v1',
    runId: 'legacy',
    status: 'active',
    level: 'B1',
    seed: 0x4543484f,
    wardenIndex: 2,
    heroMaxHp: 125,
    carriedHeroHp: 60,
    modifiers: { focusStart: 2, resonanceStart: 0, blockReliefBonus: 0 },
    claimedRewards: ['sharpened_focus', 'resonant_reserve'],
    ledger: [],
    savedAt: Date.now(),
  };

  const migrated = normalizeSavedRun(legacy);
  assert.ok(migrated, 'a legacy save is not thrown away');
  assert.equal(migrated.act, 2, 'the third Warden becomes Act III');
  assert.equal(migrated.floor, 8, 'at that act entry floor with 4 floors per act');
  assert.equal(migrated.nodeId, 'f8n0', 'standing on the spine');
  assert.deepEqual(migrated.visitedNodeIds, ['f0n0', 'f1n0', 'f2n0', 'f3n0', 'f4n0', 'f5n0', 'f6n0', 'f7n0', 'f8n0']);
  assert.equal(migrated.carriedHeroHp, 60, 'progress preserved');
  assert.deepEqual(migrated.claimedRewards, ['sharpened_focus', 'resonant_reserve']);
});

test('hostile route position values are rejected or clamped', () => {
  const now = Date.now();

  const badFloor = normalizeSavedRun({ ...BASE, floor: 999, savedAt: now });
  assert.ok(badFloor);
  assert.ok(badFloor.floor >= 0 && badFloor.floor < 12, 'out-of-range floor falls back');

  const negative = normalizeSavedRun({ ...BASE, floor: -5, savedAt: now });
  assert.ok(negative.floor >= 0);

  const injected = normalizeSavedRun({ ...BASE, nodeId: '<script>alert(1)</script>', savedAt: now });
  assert.equal(injected.nodeId, 'f0n0', 'a non-positional id is replaced');

  const junkVisited = normalizeSavedRun({
    ...BASE,
    visitedNodeIds: ['f0n0', 'javascript:void(0)', null, 'f1n1', 42],
    savedAt: now,
  });
  assert.deepEqual(junkVisited.visitedNodeIds, ['f0n0', 'f1n1'], 'only positional ids survive');

  const hugeHistory = normalizeSavedRun({
    ...BASE,
    visitedNodeIds: Array.from({ length: 500 }, () => 'f0n0'),
    savedAt: now,
  });
  assert.ok(hugeHistory.visitedNodeIds.length <= 64, 'history is bounded');

  const badSource = normalizeSavedRun({ ...BASE, rewardSource: 'anything', savedAt: now });
  assert.equal(badSource.rewardSource, null);
});

test('ledger entries keep their node provenance', () => {
  const saved = normalizeSavedRun({
    ...BASE,
    savedAt: Date.now(),
    ledger: [
      { wardenIndex: 0, wardenId: 'echo_sentinel', nodeId: 'f0n0', nodeType: 'fight', act: 0, outcome: 'victory', rounds: 4, finalHeroHp: 90 },
      { wardenIndex: 0, wardenId: 'echo_sentinel', nodeId: 'f3n0', nodeType: 'boss', act: 0, outcome: 'victory', rounds: 7, finalHeroHp: 60 },
    ],
  });

  assert.equal(saved.ledger.length, 2);
  assert.equal(saved.ledger[0].nodeId, 'f0n0');
  assert.equal(saved.ledger[0].nodeType, 'fight');
  assert.equal(saved.ledger[1].nodeType, 'boss');
  assert.equal(saved.ledger[1].act, 0);

  const dirty = normalizeSavedRun({
    ...BASE,
    savedAt: Date.now(),
    ledger: [{ wardenIndex: 0, nodeId: 'not-a-node', nodeType: 'shop', outcome: 'victory' }],
  });
  assert.equal(dirty.ledger[0].nodeId, null, 'a bad node id is dropped');
  assert.equal(dirty.ledger[0].nodeType, null, 'an unknown node type is dropped');
});

test('floorsPerAct is clamped to a supported range', () => {
  const now = Date.now();
  assert.equal(normalizeSavedRun({ ...BASE, savedAt: now }).floorsPerAct, 4);
  assert.equal(normalizeSavedRun({ ...BASE, floorsPerAct: 2, savedAt: now }).floorsPerAct, 2);
  assert.equal(normalizeSavedRun({ ...BASE, floorsPerAct: 99, savedAt: now }).floorsPerAct, 6);
  assert.equal(normalizeSavedRun({ ...BASE, floorsPerAct: 'x', savedAt: now }).floorsPerAct, 4);
});
