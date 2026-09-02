import { EVENT_VISUAL_MAP } from './event-map.js';
import { createVisualAssetLoader } from './asset-loader.js';

const EVENT_LABELS = Object.freeze({
  'sandbox.setup.completed': 'Arena ready', 'combat.started': 'Combat begins', 'player.action.selected': 'Action selected',
  'recording.started': 'Recording started', 'recording.stopped': 'Recording stopped', 'analysis.pending': 'Checking pronunciation',
  'analysis.resolved': 'Analysis complete', 'analysis.noop': 'Analysis unavailable; no judgment recorded', 'player.attack.resolved': 'Attack resolved',
  'enemy.intent.presented': 'Enemy intent shown', 'player.block.resolved': 'Block resolved', 'player.parry.started': 'Parry window started',
  'player.parry.resolved': 'Parry resolved', 'combat.damage.applied': 'Damage applied', 'combat.focus.changed': 'Focus updated',
  'combat.resonance.ready': 'Resonance ready', 'combat.resonance.consumed': 'Resonance used', 'combat.victory': 'Victory',
  'combat.defeat': 'Defeat', 'combat.abandoned': 'Run abandoned', 'telemetry.exported': 'Timing export ready',
});

function frameFor(data, assetId, index) { return data?.assets.get(assetId)?.frames[index]?.url || ''; }

export const RESULT_READABILITY_HOLD_MS = 1500;

export function humanizeEvent(type) { return EVENT_LABELS[type] || 'Training update'; }

export function createVisualPresenter({ root = document, loader = createVisualAssetLoader(), reducedMotion = Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches), staticOnly = false, setTimeoutImpl = globalThis.setTimeout, clearTimeoutImpl = globalThis.clearTimeout, setIntervalImpl = globalThis.setInterval, clearIntervalImpl = globalThis.clearInterval } = {}) {
  const stage = root.querySelector?.('.echo-visual-layer');
  const hero = root.querySelector?.('[data-visual="hero"]');
  const enemy = root.querySelector?.('[data-visual="enemy"]');
  const effect = root.querySelector?.('[data-visual="effect"]');
  let data = null;
  let analysisTimer = null;
  let disposed = false;
  let resultTimers = [];
  let resultHoldActive = false;
  const eventListener = (event) => handleEvent(event.detail);
  function setImage(node, url, assetId, frameIndex) {
    if (!node) return;
    if (url) { node.src = url; node.dataset.assetId = assetId; node.dataset.frame = String(frameIndex); node.hidden = false; }
    else node.hidden = true;
  }
  function fallback() { stage?.classList.add('echo-visual-fallback'); stage?.setAttribute('data-visual-status', 'fallback'); }
  function clearTimers() { if (analysisTimer) clearIntervalImpl(analysisTimer); analysisTimer = null; for (const timer of resultTimers) clearTimeoutImpl(timer); resultTimers = []; resultHoldActive = false; }
  function clearTransientVisuals() { stage?.classList.remove('enemy-telegraph', 'resonance-ready'); }
  function idle() { clearTimers(); clearTransientVisuals(); if (!data) return fallback(); const heroAsset = data.assets.get('ef-hero-idle'); setImage(hero, frameFor(data, 'ef-hero-idle', heroAsset.staticFallbackFrame), 'ef-hero-idle', heroAsset.staticFallbackFrame); setImage(enemy, frameFor(data, 'ef-enemy-idle', 0), 'ef-enemy-idle', 0); setImage(effect, '', '', 0); stage?.classList.remove('echo-visual-fallback'); }
  function hold() {
    clearTimers(); if (!data) return fallback(); const asset = data.assets.get('ef-analysis-hold'); const index = reducedMotion || staticOnly ? asset.staticFallbackFrame : 0; setImage(effect, frameFor(data, 'ef-analysis-hold', index), 'ef-analysis-hold', index); if (!reducedMotion && !staticOnly) { let frame = 0; analysisTimer = setIntervalImpl(() => { frame = (frame + 1) % asset.frames.length; setImage(effect, frameFor(data, 'ef-analysis-hold', frame), 'ef-analysis-hold', frame); }, 150); } }
  function result({ terminal = false } = {}) {
    clearTimers(); if (!data) return fallback(); const asset = data.assets.get('ef-combat-result');
    if (terminal || reducedMotion || staticOnly) {
      setImage(effect, frameFor(data, 'ef-combat-result', asset.staticFallbackFrame), 'ef-combat-result', asset.staticFallbackFrame);
      if (!terminal) { resultHoldActive = true; resultTimers.push(setTimeoutImpl(() => idle(), RESULT_READABILITY_HOLD_MS)); }
      return;
    }
    resultHoldActive = true;
    setImage(effect, frameFor(data, 'ef-combat-result', 0), 'ef-combat-result', 0);
    resultTimers.push(setTimeoutImpl(() => setImage(effect, frameFor(data, 'ef-combat-result', 1), 'ef-combat-result', 1), 100));
    resultTimers.push(setTimeoutImpl(() => setImage(effect, frameFor(data, 'ef-combat-result', 2), 'ef-combat-result', 2), 1100));
    resultTimers.push(setTimeoutImpl(() => idle(), RESULT_READABILITY_HOLD_MS));
  }
  function handleEvent(event) {
    if (disposed || !event?.type || !EVENT_VISUAL_MAP[event.type]) return;
    const visual = EVENT_VISUAL_MAP[event.type];
    if (event.type === 'analysis.noop' || event.type === 'combat.abandoned' || event.type === 'combat.started' || event.type === 'sandbox.setup.completed') { idle(); return; }
    if (visual === 'analysisHold') { hold(); return; }
    if (visual === 'result') {
      if (event.type === 'combat.resonance.consumed') stage?.classList.remove('resonance-ready');
      if (['player.attack.resolved', 'player.block.resolved', 'player.parry.resolved', 'combat.damage.applied'].includes(event.type)) stage?.classList.remove('enemy-telegraph');
      result();
      return;
    }
    if (visual === 'victory' || visual === 'defeat') { clearTransientVisuals(); result({ terminal: true }); return; }
    if (visual === 'enemyTelegraph') {
      if (!resultHoldActive) idle();
      stage?.classList.add('enemy-telegraph');
      return;
    }
    if (visual === 'resonanceReady') {
      if (!resultHoldActive) idle();
      stage?.classList.add('resonance-ready');
      return;
    }
    if (['player.action.selected', 'player.parry.started'].includes(event.type)) {
      stage?.classList.remove('enemy-telegraph');
      if (!resultHoldActive) idle();
      return;
    }
    if (!resultHoldActive) idle();
  }
  async function load() {
    try { data = await loader.load(); idle(); return true; } catch { fallback(); return false; }
  }
  function attach() { root.addEventListener?.('echo-forge:event', eventListener); return () => root.removeEventListener?.('echo-forge:event', eventListener); }
  function dispose() { disposed = true; clearTimers(); root.removeEventListener?.('echo-forge:event', eventListener); loader.dispose?.(); }
  attach();
  return Object.freeze({ load, handleEvent, dispose, fallback, getLoaded: () => data });
}
