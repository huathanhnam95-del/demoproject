// @ts-check

/**
 * Storage adapter for Echo Forge multi-fight runs.
 * Modelled on reading-journey-quiz-storage.js with injectable storage.
 */

export const ECHO_FORGE_RUN_STORAGE_KEY = 'ef_run_v1';
export const ECHO_FORGE_RUN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function getStorage(storage) {
  if (storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function') {
    return storage;
  }
  if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
    return globalThis.localStorage;
  }
  return null;
}

function normalizeScalar(value) {
  return String(value ?? '').trim();
}

/**
 * Validates and normalizes a saved run object.
 * Returns null if the run is malformed or expired past the 7-day TTL.
 *
 * @param {any} raw
 * @param {number} [now=Date.now()]
 * @returns {Object | null}
 */
export function normalizeSavedRun(raw, now = Date.now()) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.schemaVersion !== 'echo-forge-run-v1') return null;

  const savedAt = Number(raw.savedAt);
  if (!Number.isFinite(savedAt) || savedAt <= 0) return null;
  if (now - savedAt > ECHO_FORGE_RUN_TTL_MS || savedAt > now + 60000) {
    return null; // Expired or future-dated past 1 min clock skew
  }

  const runId = normalizeScalar(raw.runId);
  if (!runId) return null;

  const status = normalizeScalar(raw.status);
  if (!['active', 'reward_pending', 'victory', 'defeat', 'abandoned'].includes(status)) {
    return null;
  }

  const level = normalizeScalar(raw.level).toUpperCase();
  const validLevel = ['A1', 'A2', 'B1', 'B2', 'C1'].includes(level) ? level : 'B1';

  const seed = Number(raw.seed);
  if (!Number.isFinite(seed)) return null;

  const wardenIndex = Number(raw.wardenIndex);
  if (!Number.isInteger(wardenIndex) || wardenIndex < 0 || wardenIndex > 3) return null;

  const heroMaxHp = Number(raw.heroMaxHp);
  if (!Number.isFinite(heroMaxHp) || heroMaxHp <= 0) return null;

  const carriedHeroHp = Number(raw.carriedHeroHp);
  if (!Number.isFinite(carriedHeroHp) || carriedHeroHp < 0) return null;

  const rawMods = raw.modifiers && typeof raw.modifiers === 'object' ? raw.modifiers : {};
  const modifiers = {
    focusStart: Math.max(1, Number(rawMods.focusStart) || 1),
    resonanceStart: Math.max(0, Number(rawMods.resonanceStart) || 0),
    blockReliefBonus: Math.max(0, Number(rawMods.blockReliefBonus) || 0),
  };

  const claimedRewards = Array.isArray(raw.claimedRewards)
    ? raw.claimedRewards.map(normalizeScalar).filter(Boolean)
    : [];

  const ledger = Array.isArray(raw.ledger)
    ? raw.ledger.map((entry) => ({
        wardenIndex: Number(entry?.wardenIndex) || 0,
        wardenId: normalizeScalar(entry?.wardenId),
        outcome: normalizeScalar(entry?.outcome),
        rounds: Number(entry?.rounds) || 0,
        finalHeroHp: Number(entry?.finalHeroHp) || 0,
        xpAwarded: Boolean(entry?.xpAwarded),
      }))
    : [];

  let rewardOffer = null;
  if (Array.isArray(raw.rewardOffer) && status === 'reward_pending') {
    rewardOffer = raw.rewardOffer.map((r) => ({
      id: normalizeScalar(r?.id),
      name: normalizeScalar(r?.name),
      description: normalizeScalar(r?.description),
    })).filter((r) => r.id);
  }

  return {
    schemaVersion: 'echo-forge-run-v1',
    runId,
    status,
    level: validLevel,
    seed,
    wardenIndex,
    heroMaxHp,
    carriedHeroHp,
    modifiers,
    rewardOffer,
    claimedRewards,
    combat: null, // Ephemeral combat state is never persisted
    ledger,
    savedAt,
  };
}

/**
 * Loads a persisted run from storage.
 *
 * @param {Object} [storage]
 * @param {number} [now=Date.now()]
 * @returns {Object | null}
 */
export function loadSavedRun(storage, now = Date.now()) {
  const target = getStorage(storage);
  if (!target) return null;

  try {
    const raw = target.getItem(ECHO_FORGE_RUN_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return normalizeSavedRun(parsed, now);
  } catch {
    return null;
  }
}

/**
 * Persists an active run slice to storage (stripping ephemeral combat state).
 *
 * @param {Object} runState
 * @param {Object} [storage]
 * @param {number} [now=Date.now()]
 * @returns {Object | null}
 */
export function saveRun(runState, storage, now = Date.now()) {
  const target = getStorage(storage);
  if (!target || !runState || typeof runState !== 'object') return null;

  const candidate = {
    ...runState,
    combat: null,
    savedAt: now,
  };

  const normalized = normalizeSavedRun(candidate, now);
  if (!normalized) return null;

  try {
    target.setItem(ECHO_FORGE_RUN_STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
  } catch {
    return null;
  }
}

/**
 * Clears any saved run from storage.
 *
 * @param {Object} [storage]
 */
export function clearSavedRun(storage) {
  const target = getStorage(storage);
  if (!target) return;
  try {
    target.removeItem(ECHO_FORGE_RUN_STORAGE_KEY);
  } catch {
    // best-effort
  }
}
