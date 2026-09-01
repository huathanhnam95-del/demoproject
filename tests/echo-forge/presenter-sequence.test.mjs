import assert from 'node:assert/strict';
import test from 'node:test';

import { createVisualPresenter, RESULT_READABILITY_HOLD_MS } from '../../public/js/echo-forge/visual/presenter.js';

function node() {
  const classes = new Set();
  return {
    hidden: true,
    src: '',
    dataset: {},
    setAttribute(name, value) { this[name] = String(value); },
    classList: {
      add: (...values) => values.forEach((value) => classes.add(value)),
      remove: (...values) => values.forEach((value) => classes.delete(value)),
      contains: (value) => classes.has(value),
    },
  };
}

function fixture() {
  const stage = node();
  const hero = node();
  const enemy = node();
  const effect = node();
  const listeners = new Map();
  const root = {
    querySelector(selector) {
      return selector === '.echo-visual-layer' ? stage
        : selector === '[data-visual="hero"]' ? hero
          : selector === '[data-visual="enemy"]' ? enemy
            : effect;
    },
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); },
  };
  const assets = new Map([
    ['ef-hero-idle', { staticFallbackFrame: 0, frames: [{ url: 'hero-0' }] }],
    ['ef-enemy-idle', { staticFallbackFrame: 0, frames: [{ url: 'enemy-0' }] }],
    ['ef-analysis-hold', { staticFallbackFrame: 0, frames: [{ url: 'hold-0' }, { url: 'hold-1' }] }],
    ['ef-combat-result', { staticFallbackFrame: 1, frames: [{ url: 'result-0' }, { url: 'result-1' }, { url: 'result-2' }] }],
  ]);
  const timers = [];
  const setTimeoutImpl = (callback, delay) => {
    const timer = { callback, delay, cleared: false };
    timers.push(timer);
    return timer;
  };
  const clearTimeoutImpl = (timer) => { if (timer) timer.cleared = true; };
  return {
    root, stage, hero, enemy, effect, timers,
    loader: { load: async () => ({ assets }), dispose() {} },
    setTimeoutImpl,
    clearTimeoutImpl,
  };
}

test('presenter keeps combat result readable across synchronous low-priority events and cancels only on noop/abandon', async () => {
  const view = fixture();
  const presenter = createVisualPresenter({
    root: view.root,
    loader: view.loader,
    reducedMotion: false,
    setTimeoutImpl: view.setTimeoutImpl,
    clearTimeoutImpl: view.clearTimeoutImpl,
  });
  await presenter.load();

  presenter.handleEvent({ type: 'analysis.resolved' });
  assert.equal(view.effect.dataset.frame, '0');
  presenter.handleEvent({ type: 'combat.focus.changed' });
  presenter.handleEvent({ type: 'enemy.intent.presented' });
  presenter.handleEvent({ type: 'combat.resonance.ready' });
  assert.equal(view.effect.dataset.frame, '0');
  assert.equal(view.stage.classList.contains('enemy-telegraph'), true);
  assert.equal(view.stage.classList.contains('resonance-ready'), true);
  assert.equal(view.timers.some((timer) => timer.delay === RESULT_READABILITY_HOLD_MS), true);

  presenter.handleEvent({ type: 'player.action.selected' });
  assert.equal(view.effect.dataset.frame, '0');
  assert.equal(view.stage.classList.contains('enemy-telegraph'), false);
  assert.equal(view.stage.classList.contains('resonance-ready'), true);

  presenter.handleEvent({ type: 'analysis.noop' });
  assert.equal(view.effect.hidden, true);
  assert.equal(view.timers.every((timer) => timer.cleared), true);
  presenter.handleEvent({ type: 'enemy.intent.presented' });
  presenter.handleEvent({ type: 'player.parry.started' });
  assert.equal(view.stage.classList.contains('enemy-telegraph'), false);
  presenter.handleEvent({ type: 'combat.resonance.ready' });
  presenter.handleEvent({ type: 'combat.resonance.consumed' });
  assert.equal(view.stage.classList.contains('resonance-ready'), false);
  presenter.handleEvent({ type: 'combat.abandoned' });
  assert.equal(view.effect.hidden, true);
});

test('presenter uses the static result fallback for reduced motion and terminal outcomes', async () => {
  const reduced = fixture();
  const presenter = createVisualPresenter({
    root: reduced.root,
    loader: reduced.loader,
    reducedMotion: true,
    setTimeoutImpl: reduced.setTimeoutImpl,
    clearTimeoutImpl: reduced.clearTimeoutImpl,
  });
  await presenter.load();
  presenter.handleEvent({ type: 'analysis.resolved' });
  assert.equal(reduced.effect.dataset.frame, '1');
  assert.equal(reduced.timers.some((timer) => timer.delay === RESULT_READABILITY_HOLD_MS), true);

  const terminal = fixture();
  const terminalPresenter = createVisualPresenter({ root: terminal.root, loader: terminal.loader, reducedMotion: false });
  await terminalPresenter.load();
  terminalPresenter.handleEvent({ type: 'combat.victory' });
  assert.equal(terminal.effect.dataset.frame, '1');
  terminalPresenter.handleEvent({ type: 'combat.defeat' });
  assert.equal(terminal.effect.dataset.frame, '1');
});
