import test from 'node:test';
import assert from 'node:assert/strict';
import { createEchoForgeBridge } from '../../public/js/echo-forge-bridge.js';
import { ECHO_FORGE_RUN_STORAGE_KEY } from '../../public/js/echo-forge-run-storage.js';

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
  runId: 'run_bridge_1',
  status: 'reward_pending',
  level: 'B1',
  seed: 12345,
  wardenIndex: 0,
  heroMaxHp: 100,
  carriedHeroHp: 80,
  modifiers: { focusStart: 1, resonanceStart: 0, blockReliefBonus: 0 },
  rewardOffer: null,
  claimedRewards: [],
  combat: null,
  ledger: [{ wardenIndex: 0, wardenId: 'echo_sentinel', outcome: 'victory', rounds: 3, finalHeroHp: 80 }],
};

test('bridge attaches, saves on fight completed, and clears on terminal', () => {
  const root = new EventTarget();
  const storage = createMockStorage();
  const bridge = createEchoForgeBridge({ root, storage });
  bridge.attach();
  bridge.updateRunState(mockRunState);

  // 1. Fight completed -> saves to storage
  root.dispatchEvent(new CustomEvent('echo-forge:run', {
    detail: { type: 'run.fight.completed', payload: { runId: 'run_bridge_1', wardenIndex: 0, outcome: 'victory' } },
  }));

  assert.ok(storage.getItem(ECHO_FORGE_RUN_STORAGE_KEY) !== null);
  const saved = bridge.getSavedRun();
  assert.equal(saved?.runId, 'run_bridge_1');
  assert.equal(saved?.carriedHeroHp, 80);

  // 2. Terminal run.completed -> clears storage
  root.dispatchEvent(new CustomEvent('echo-forge:run', {
    detail: { type: 'run.completed', payload: { runId: 'run_bridge_1' } },
  }));

  assert.equal(storage.getItem(ECHO_FORGE_RUN_STORAGE_KEY), null);
  assert.equal(bridge.getSavedRun(), null);
});

test('bridge does not award profile XP on fight completion', () => {
  const root = new EventTarget();
  const storage = createMockStorage();
  const bridge = createEchoForgeBridge({ root, storage });
  bridge.attach();
  bridge.updateRunState(mockRunState);

  const eventPayload = {
    detail: {
      type: 'run.fight.completed',
      payload: { runId: 'run_bridge_1', wardenIndex: 0, wardenId: 'echo_sentinel', outcome: 'victory' },
    },
  };

  root.dispatchEvent(new CustomEvent('echo-forge:run', eventPayload));
  assert.ok(storage.getItem(ECHO_FORGE_RUN_STORAGE_KEY) !== null);
});

test('bridge buffers missed vocabulary and flushes on user initiation', () => {
  const root = new EventTarget();
  const storage = createMockStorage();
  const vocabCalls = [];
  const bridge = createEchoForgeBridge({
    root,
    storage,
    captureVocab: (items) => vocabCalls.push(items),
  });
  bridge.attach();

  // Scored attempt >= 70: not missed
  root.dispatchEvent(new CustomEvent('echo-forge:event', {
    detail: { type: 'analysis.resolved', payload: { status: 'scored', score: 85, challengeId: 'c-pass' } },
  }));
  assert.equal(bridge.getPendingCaptures().length, 0);

  // Incorrect attempt: buffered
  root.dispatchEvent(new CustomEvent('echo-forge:event', {
    detail: { type: 'analysis.resolved', payload: { status: 'incorrect', score: 40, challengeId: 'c-fail-1' } },
  }));
  assert.equal(bridge.getPendingCaptures().length, 1);
  assert.equal(bridge.getPendingCaptures()[0].challengeId, 'c-fail-1');

  // Flush captures
  const flushed = bridge.flushCaptures();
  assert.equal(flushed.length, 1);
  assert.equal(vocabCalls.length, 1);
  assert.equal(bridge.getPendingCaptures().length, 0);
});

test('bridge detach stops listening to events', () => {
  const root = new EventTarget();
  const storage = createMockStorage();
  const bridge = createEchoForgeBridge({ root, storage });
  bridge.attach();
  bridge.updateRunState(mockRunState);
  bridge.detach();

  root.dispatchEvent(new CustomEvent('echo-forge:run', {
    detail: { type: 'run.fight.completed', payload: { runId: 'run_bridge_1', wardenIndex: 0, outcome: 'victory' } },
  }));

  assert.equal(storage.getItem(ECHO_FORGE_RUN_STORAGE_KEY), null);
});

test('bridge exposes getSavedRun and clearSavedRun for campaign resume lifecycle', () => {
  const root = new EventTarget();
  const storage = createMockStorage();
  const bridge = createEchoForgeBridge({ root, storage });
  assert.equal(bridge.getSavedRun(), null);

  bridge.attach();
  bridge.updateRunState(mockRunState);
  root.dispatchEvent(new CustomEvent('echo-forge:run', {
    detail: { type: 'run.fight.completed', payload: { runId: 'run_bridge_1', wardenIndex: 0, outcome: 'victory' } },
  }));

  const saved = bridge.getSavedRun();
  assert.equal(saved?.runId, 'run_bridge_1');
  assert.equal(saved?.status, 'reward_pending');

  bridge.clearSavedRun();
  assert.equal(bridge.getSavedRun(), null);
});

