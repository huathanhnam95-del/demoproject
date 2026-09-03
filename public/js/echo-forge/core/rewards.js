// @ts-check

/**
 * @typedef {Object} Reward
 * @property {string} id
 * @property {string} name
 * @property {string} description
 */

/** @type {readonly Reward[]} */
export const REWARDS = Object.freeze([
  Object.freeze({
    id: 'resonant_reserve',
    name: 'Resonant Reserve',
    description: '+25 Max HP and restore your health to full.',
  }),
  Object.freeze({
    id: 'sharpened_focus',
    name: 'Sharpened Focus',
    description: 'Start future fights with 2 Focus instead of 1.',
  }),
  Object.freeze({
    id: 'ringing_echo',
    name: 'Ringing Echo',
    description: 'Start future fights with 40% Resonance ready.',
  }),
  Object.freeze({
    id: 'tempered_guard',
    name: 'Tempered Guard',
    description: 'Incoming damage during Block is reduced by 15%.',
  }),
  Object.freeze({
    id: 'second_wind',
    name: 'Second Wind',
    description: 'Recover 60% of your missing health immediately.',
  }),
]);

const REWARD_MAP = new Map(REWARDS.map((reward) => [reward.id, reward]));

/**
 * Get a reward definition by ID.
 * @param {string} id
 * @returns {Reward | undefined}
 */
export function getRewardById(id) {
  return REWARD_MAP.get(id);
}

/**
 * Deterministically generates a 2-reward draft selection based on seed and wardenIndex.
 * @param {number} seed
 * @param {number} wardenIndex
 * @returns {Reward[]}
 */
export function deriveRewardOffer(seed = 0, wardenIndex = 0) {
  let hash = (Number(seed) ^ (wardenIndex * 31337)) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35) >>> 0;
  hash = (hash ^ (hash >>> 16)) >>> 0;

  const firstIndex = hash % REWARDS.length;
  let secondIndex = (hash >>> 8) % REWARDS.length;
  if (secondIndex === firstIndex) {
    secondIndex = (firstIndex + 1) % REWARDS.length;
  }

  return [REWARDS[firstIndex], REWARDS[secondIndex]];
}

/**
 * Applies a reward to run state fields and returns the updated fields.
 * @param {{ heroMaxHp: number, carriedHeroHp: number, modifiers: { focusStart: number, resonanceStart: number, blockReliefBonus: number } }} runState
 * @param {string} rewardId
 * @returns {{ heroMaxHp: number, carriedHeroHp: number, modifiers: { focusStart: number, resonanceStart: number, blockReliefBonus: number } }}
 */
export function applyRewardEffect(runState, rewardId) {
  let heroMaxHp = runState.heroMaxHp;
  let carriedHeroHp = runState.carriedHeroHp;
  let modifiers = { ...runState.modifiers };

  switch (rewardId) {
    case 'resonant_reserve':
      heroMaxHp += 25;
      carriedHeroHp = heroMaxHp;
      break;
    case 'sharpened_focus':
      modifiers.focusStart = Math.max(modifiers.focusStart || 1, 2);
      break;
    case 'ringing_echo':
      modifiers.resonanceStart = Math.max(modifiers.resonanceStart || 0, 40);
      break;
    case 'tempered_guard':
      modifiers.blockReliefBonus = (modifiers.blockReliefBonus || 0) + 0.15;
      break;
    case 'second_wind': {
      const missing = heroMaxHp - carriedHeroHp;
      const heal = Math.round(missing * 0.6);
      carriedHeroHp = Math.min(heroMaxHp, carriedHeroHp + heal);
      break;
    }
    default:
      break;
  }

  return { heroMaxHp, carriedHeroHp, modifiers };
}
