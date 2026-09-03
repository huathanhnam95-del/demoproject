// @ts-check

/**
 * Run layer contract definitions for Echo Forge multi-fight runs.
 */

export const RUN_SCHEMA_VERSION = 'echo-forge-run-v1';

/** @type {readonly string[]} */
export const RUN_EVENT_TYPES = Object.freeze([
  'run.started',
  'run.fight.started',
  'run.fight.completed',
  'run.reward.offered',
  'run.reward.claimed',
  'run.completed',
  'run.failed',
  'run.abandoned',
]);

const RUN_EVENT_SET = new Set(RUN_EVENT_TYPES);

/**
 * Asserts that the given string is a valid run lifecycle event type.
 * @param {string} type
 */
export function assertRunEventType(type) {
  if (!RUN_EVENT_SET.has(type)) {
    throw new Error(`Invalid Echo Forge run event type: ${type}`);
  }
}

/**
 * Validates a run state structure.
 * @param {any} state
 * @returns {boolean}
 */
export function validateRunState(state) {
  if (!state || typeof state !== 'object') return false;
  if (state.schemaVersion !== RUN_SCHEMA_VERSION) return false;
  if (typeof state.runId !== 'string' || !state.runId) return false;
  if (!['active', 'reward_pending', 'victory', 'defeat', 'abandoned'].includes(state.status)) return false;
  if (typeof state.wardenIndex !== 'number' || state.wardenIndex < 0 || state.wardenIndex > 3) return false;
  if (typeof state.heroMaxHp !== 'number' || state.heroMaxHp <= 0) return false;
  if (typeof state.carriedHeroHp !== 'number' || state.carriedHeroHp < 0) return false;
  if (!Array.isArray(state.claimedRewards)) return false;
  if (!Array.isArray(state.ledger)) return false;
  return true;
}
