import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = process.cwd();
const catalogSource = fs.readFileSync(path.join(root, 'public/js/skill-catalog.js'), 'utf8');
const levelSystemSource = fs.readFileSync(path.join(root, 'public/js/modules/level-system.js'), 'utf8');

function createHarness() {
  const context = {
    window: null,
    module: { exports: {} },
    exports: {},
    console,
    Logger: {
      create: () => ({
        log() {},
        warn() {},
        error() {},
        debug() {}
      })
    },
    document: {
      getElementById() {
        return null;
      },
      querySelector() {
        return null;
      }
    },
    performance: { now: () => 0 },
    matchMedia: () => ({ matches: false }),
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
    requestAnimationFrame: () => 0,
    cancelAnimationFrame() {},
    setTimeout,
    clearTimeout,
    Promise,
    Date,
    JSON,
    Map,
    Set,
    Math,
    Number,
    String,
    Array,
    Object,
    RegExp,
    encodeURIComponent,
    decodeURIComponent
  };
  context.window = context;
  context.window.window = context.window;
  context.window.document = context.document;
  context.window.performance = context.performance;
  context.window.matchMedia = context.matchMedia;
  context.window.ResizeObserver = context.ResizeObserver;
  context.window.requestAnimationFrame = context.requestAnimationFrame;
  context.window.cancelAnimationFrame = context.cancelAnimationFrame;

  vm.runInNewContext(catalogSource, context, { filename: 'public/js/skill-catalog.js' });
  vm.runInNewContext(levelSystemSource, context, { filename: 'public/js/modules/level-system.js' });

  return context.window.LevelSystem;
}

test('level system keeps difficulty_filter in the listening tree', () => {
  const levelSystem = createHarness();
  const unlockables = levelSystem.getUnlockables();
  const difficultyNode = unlockables.find((node) => node.id === 'difficulty_filter');

  assert.ok(difficultyNode, 'difficulty_filter node should exist');
  assert.equal(difficultyNode.branch, 'listening');
  assert.equal(difficultyNode.parentId, 'length_filter');
});

test('level system treats legacy difficultyFilter unlocks as difficulty_filter', () => {
  const levelSystem = createHarness();
  const legacyProfile = {
    unlockedModes: ['difficultyFilter'],
    unlockedSkills: {},
    skillPassives: {},
    coins: 0,
    skillPoints: { listening: 0 }
  };

  assert.equal(levelSystem.isUnlocked('difficulty_filter', legacyProfile), true);
});
