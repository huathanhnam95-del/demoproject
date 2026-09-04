// @ts-check

/**
 * Run layer contract definitions for Echo Forge multi-fight runs.
 *
 * This channel is deliberately separate from the 21 frozen combat event types.
 * It carries no schema and no count pin, so route and act signals can be added
 * here without touching the visual contract.
 */

import { ACT_COUNT, validateRoute } from './route.js';

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
  // Route layer
  'run.route.generated',
  'run.act.entered',
  'run.act.completed',
  'run.map.offered',
  'run.node.entered',
  'run.node.resolved',
]);

const RUN_EVENT_SET = new Set(RUN_EVENT_TYPES);

/** @type {readonly string[]} */
export const RUN_STATUSES = Object.freeze([
  'active',
  'reward_pending',
  'map_pending',
  'victory',
  'defeat',
  'abandoned',
]);

const RUN_STATUS_SET = new Set(RUN_STATUSES);

/** Node ids are positional: f{floor}n{index}. */
export const NODE_ID_PATTERN = /^f\d{1,3}n\d{1,2}$/;

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
  if (!RUN_STATUS_SET.has(state.status)) return false;

  // wardenIndex is now derived from the act, and kept for storage compatibility.
  if (typeof state.wardenIndex !== 'number' || state.wardenIndex < 0 || state.wardenIndex > 3) return false;
  if (typeof state.heroMaxHp !== 'number' || state.heroMaxHp <= 0) return false;
  if (typeof state.carriedHeroHp !== 'number' || state.carriedHeroHp < 0) return false;
  if (!Array.isArray(state.claimedRewards)) return false;
  if (!Array.isArray(state.ledger)) return false;

  // Route layer
  if (!validateRoute(state.route)) return false;
  if (!Number.isInteger(state.act) || state.act < 0 || state.act >= ACT_COUNT) return false;
  if (!Number.isInteger(state.floor) || state.floor < 0 || state.floor >= state.route.floors.length) return false;
  if (state.nodeId !== null && !NODE_ID_PATTERN.test(String(state.nodeId))) return false;
  if (!Array.isArray(state.visitedNodeIds)) return false;
  if (!Array.isArray(state.availableNodeIds)) return false;

  return true;
}
