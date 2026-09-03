// @ts-check

import { loadSavedRun, saveRun, clearSavedRun } from './echo-forge-run-storage.js';

/**
 * Creates the persistence and integration bridge for Echo Forge.
 * Listens to echo-forge:event and echo-forge:run event streams outside the isolated game engine.
 *
 * @param {Object} options
 * @param {EventTarget} options.root - DOM root emitting echo-forge CustomEvents
 * @param {Object} [options.storage] - Injectable storage interface
 * @param {Function} [options.captureVocab] - Optional vocabulary capture callback: (items) => void
 * @param {Function} [options.loadCatalog] - Optional catalog loader function
 * @param {Function} [options.now] - Current time generator
 */
export function createEchoForgeBridge({
  root,
  storage,
  captureVocab = null,
  loadCatalog = null,
  now = Date.now,
} = {}) {
  if (!root || typeof root.addEventListener !== 'function') {
    throw new TypeError('root with addEventListener is required');
  }

  const pendingCaptures = [];
  let cachedCatalog = null;
  let isAttached = false;
  let latestRunState = null;

  async function resolveCatalog() {
    if (cachedCatalog) return cachedCatalog;
    if (loadCatalog) {
      try {
        cachedCatalog = await loadCatalog();
      } catch {
        // best effort
      }
    }
    return cachedCatalog;
  }

  function handleCombatEvent(event) {
    const detail = event.detail || {};
    const type = detail.type;
    const payload = detail.payload || {};

    if (type === 'analysis.resolved') {
      const { status, score, challengeId, evaluationMode } = payload;
      const isMissed = status === 'incorrect' || (typeof score === 'number' && score < 70);

      if (isMissed && challengeId) {
        const captureItem = {
          challengeId,
          status,
          score: score ?? 0,
          evaluationMode: evaluationMode || 'unknown',
          timestamp: now(),
        };

        // Async resolve challenge text & metadata from catalog without emitting to event bus
        resolveCatalog().then((cat) => {
          if (cat?.challenges) {
            const entry = cat.challenges.find((c) => c.challengeId === challengeId);
            if (entry) {
              captureItem.text = entry.text;
              captureItem.ipa = entry.pronunciation?.ipa;
              captureItem.focus = entry.pronunciation?.focus;
            }
          }
        }).catch(() => {});

        pendingCaptures.push(captureItem);
      }
    }
  }

  function handleRunEvent(event) {
    const detail = event.detail || {};
    const type = detail.type;
    const payload = detail.payload || {};

    // Update internal reference to run state if provided in detail
    if (detail.runState) {
      latestRunState = detail.runState;
    }

    switch (type) {
      case 'run.fight.completed': {
        if (latestRunState) {
          saveRun(latestRunState, storage, now());
        }
        break;
      }

      case 'run.reward.claimed': {
        if (latestRunState) {
          saveRun(latestRunState, storage, now());
        }
        break;
      }

      case 'run.completed':
      case 'run.failed':
      case 'run.abandoned': {
        clearSavedRun(storage);
        break;
      }

      default:
        break;
    }
  }

  function attach() {
    if (isAttached) return;
    root.addEventListener('echo-forge:event', handleCombatEvent);
    root.addEventListener('echo-forge:run', handleRunEvent);
    isAttached = true;
  }

  function detach() {
    if (!isAttached) return;
    root.removeEventListener('echo-forge:event', handleCombatEvent);
    root.removeEventListener('echo-forge:run', handleRunEvent);
    isAttached = false;
  }

  function getSavedRun() {
    return loadSavedRun(storage, now());
  }

  function clearSaved() {
    return clearSavedRun(storage);
  }

  function getPendingCaptures() {
    return Object.freeze([...pendingCaptures]);
  }

  function flushCaptures() {
    if (pendingCaptures.length === 0) return [];
    const items = [...pendingCaptures];
    pendingCaptures.length = 0;
    if (typeof captureVocab === 'function') {
      captureVocab(items);
    }
    return items;
  }

  function updateRunState(runState) {
    latestRunState = runState;
  }

  return Object.freeze({
    attach,
    detach,
    getSavedRun,
    clearSavedRun: clearSaved,
    getPendingCaptures,
    flushCaptures,
    updateRunState,
  });
}
