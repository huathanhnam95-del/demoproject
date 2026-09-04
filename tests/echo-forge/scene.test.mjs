import assert from 'node:assert/strict';
import test from 'node:test';

import { createEchoForgeScene, ACT_TITLES } from '../../public/js/echo-forge/visual/scene.js';

function mockNode() {
  const classes = new Set();
  const styles = new Map();
  return {
    hidden: false,
    textContent: '',
    dataset: {},
    classList: {
      add: (...values) => values.forEach((val) => classes.add(val)),
      remove: (...values) => values.forEach((val) => classes.delete(val)),
      contains: (val) => classes.has(val),
    },
    style: {
      setProperty(prop, val) { styles.set(prop, String(val)); },
      getPropertyValue(prop) { return styles.get(prop) || ''; },
    },
  };
}

function fixture({ prefersReducedMotion = false } = {}) {
  const stage = mockNode();
  const titleCard = mockNode();
  const badge = mockNode();
  const title = mockNode();
  const body = mockNode();

  const listeners = new Map();
  const root = {
    querySelector(selector) {
      if (selector === '.battle-stage') return stage;
      if (selector === '#ef-act-title-card') return titleCard;
      if (selector === '#ef-act-badge') return badge;
      if (selector === '#ef-act-title') return title;
      return null;
    },
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); },
    dispatchEvent(event) {
      const fn = listeners.get(event.type);
      if (fn) fn(event);
    },
  };

  const timers = [];
  let currentTime = 0;
  const setTimeoutImpl = (callback, delay) => {
    const timer = { callback, runAt: currentTime + delay, cleared: false };
    timers.push(timer);
    return timer;
  };
  const clearTimeoutImpl = (timer) => {
    if (timer) timer.cleared = true;
  };

  const advanceTimers = (ms) => {
    currentTime += ms;
    for (const timer of [...timers]) {
      if (!timer.cleared && timer.runAt <= currentTime) {
        timer.cleared = true;
        timer.callback();
      }
    }
  };

  const windowRef = {
    matchMedia: (query) => ({
      matches: query.includes('prefers-reduced-motion') ? prefersReducedMotion : false,
    }),
  };

  return {
    root, stage, titleCard, badge, title, body,
    setTimeoutImpl, clearTimeoutImpl, advanceTimers,
    windowRef, listeners,
  };
}

test('scene controller initializes with frozen act definitions', () => {
  assert.equal(ACT_TITLES.length, 3);
  assert.equal(ACT_TITLES[0].stageId, 'resonant_hall');
  assert.equal(ACT_TITLES[1].stageId, 'cinder_forge');
  assert.equal(ACT_TITLES[2].stageId, 'void_beneath');
  assert.ok(Object.isFrozen(ACT_TITLES));
});

test('setParallaxOffset writes --ef-par-x to stage and schedules auto-return', () => {
  const f = fixture();
  const scene = createEchoForgeScene({
    root: f.root,
    documentRef: { body: f.body },
    windowRef: f.windowRef,
    setTimeoutImpl: f.setTimeoutImpl,
    clearTimeoutImpl: f.clearTimeoutImpl,
  });

  scene.setParallaxOffset(12, 400);
  assert.equal(f.stage.style.getPropertyValue('--ef-par-x'), '12px');

  f.advanceTimers(399);
  assert.equal(f.stage.style.getPropertyValue('--ef-par-x'), '12px');

  f.advanceTimers(1);
  assert.equal(f.stage.style.getPropertyValue('--ef-par-x'), '0px');

  scene.destroy();
});

test('subsequent parallax offsets cancel pending return timer and update value', () => {
  const f = fixture();
  const scene = createEchoForgeScene({
    root: f.root,
    documentRef: { body: f.body },
    windowRef: f.windowRef,
    setTimeoutImpl: f.setTimeoutImpl,
    clearTimeoutImpl: f.clearTimeoutImpl,
  });

  scene.setParallaxOffset(12, 400);
  assert.equal(f.stage.style.getPropertyValue('--ef-par-x'), '12px');

  f.advanceTimers(200);
  scene.setParallaxOffset(-8, 500);
  assert.equal(f.stage.style.getPropertyValue('--ef-par-x'), '-8px');

  // At t=400 (200ms after second offset), old timer would have fired if not cleared
  f.advanceTimers(200);
  assert.equal(f.stage.style.getPropertyValue('--ef-par-x'), '-8px');

  // At t=700 (500ms after second offset), new timer returns to 0
  f.advanceTimers(300);
  assert.equal(f.stage.style.getPropertyValue('--ef-par-x'), '0px');

  scene.destroy();
});

test('prefers-reduced-motion clamps parallax offset to 0', () => {
  const f = fixture({ prefersReducedMotion: true });
  const scene = createEchoForgeScene({
    root: f.root,
    documentRef: { body: f.body },
    windowRef: f.windowRef,
    setTimeoutImpl: f.setTimeoutImpl,
    clearTimeoutImpl: f.clearTimeoutImpl,
  });

  scene.setParallaxOffset(12, 400);
  assert.equal(f.stage.style.getPropertyValue('--ef-par-x'), '0px');

  scene.destroy();
});

test('showActTitleCard displays act metadata and auto-dismisses smoothly', () => {
  const f = fixture();
  const scene = createEchoForgeScene({
    root: f.root,
    documentRef: { body: f.body },
    windowRef: f.windowRef,
    setTimeoutImpl: f.setTimeoutImpl,
    clearTimeoutImpl: f.clearTimeoutImpl,
  });

  scene.showActTitleCard(1);
  assert.equal(f.titleCard.hidden, false);
  assert.equal(f.badge.textContent, 'ACT II');
  assert.equal(f.title.textContent, 'THE CINDER FORGE');
  assert.ok(f.titleCard.classList.contains('ef-title-enter'));

  f.advanceTimers(2400);
  assert.ok(f.titleCard.classList.contains('ef-title-leave'));
  assert.ok(!f.titleCard.classList.contains('ef-title-enter'));

  f.advanceTimers(400);
  assert.equal(f.titleCard.hidden, true);
  assert.ok(!f.titleCard.classList.contains('ef-title-leave'));

  scene.destroy();
});

test('handleRunEvent synchronizes document.body.dataset.stage on run.act.entered', () => {
  const f = fixture();
  const scene = createEchoForgeScene({
    root: f.root,
    documentRef: { body: f.body },
    windowRef: f.windowRef,
    setTimeoutImpl: f.setTimeoutImpl,
    clearTimeoutImpl: f.clearTimeoutImpl,
  });

  f.root.dispatchEvent({
    type: 'echo-forge:run',
    detail: { type: 'run.act.entered', payload: { act: 2 } },
  });

  assert.equal(f.body.dataset.stage, 'void_beneath');
  assert.equal(f.badge.textContent, 'ACT III');
  assert.equal(f.title.textContent, 'THE VOID BENEATH');
  assert.equal(f.titleCard.hidden, false);

  scene.destroy();
});

test('handleCombatEvent triggers corresponding parallax motions', () => {
  const f = fixture();
  const scene = createEchoForgeScene({
    root: f.root,
    documentRef: { body: f.body },
    windowRef: f.windowRef,
    setTimeoutImpl: f.setTimeoutImpl,
    clearTimeoutImpl: f.clearTimeoutImpl,
  });

  // Player attack
  f.root.dispatchEvent({
    type: 'echo-forge:event',
    detail: { type: 'player.attack.resolved' },
  });
  assert.equal(f.stage.style.getPropertyValue('--ef-par-x'), '12px');

  // Enemy intent
  f.root.dispatchEvent({
    type: 'echo-forge:event',
    detail: { type: 'enemy.intent.presented' },
  });
  assert.equal(f.stage.style.getPropertyValue('--ef-par-x'), '-8px');

  // Combat damage
  f.root.dispatchEvent({
    type: 'echo-forge:event',
    detail: { type: 'combat.damage.applied', target: 'hero' },
  });
  assert.equal(f.stage.style.getPropertyValue('--ef-par-x'), '-10px');

  scene.destroy();
});

test('reset and destroy clean up timers, listeners, and DOM properties', () => {
  const f = fixture();
  const scene = createEchoForgeScene({
    root: f.root,
    documentRef: { body: f.body },
    windowRef: f.windowRef,
    setTimeoutImpl: f.setTimeoutImpl,
    clearTimeoutImpl: f.clearTimeoutImpl,
  });

  scene.setParallaxOffset(10, 500);
  scene.showActTitleCard(0);
  assert.equal(f.titleCard.hidden, false);

  scene.reset();
  assert.equal(f.stage.style.getPropertyValue('--ef-par-x'), '0px');
  assert.equal(f.titleCard.hidden, true);

  scene.destroy();
  assert.equal(f.listeners.size, 0);
});
