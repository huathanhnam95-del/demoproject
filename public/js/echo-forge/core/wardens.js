// @ts-check

/**
 * @typedef {'block' | 'parry' | 'either'} WardenCounter
 *
 * @typedef {Object} WardenMove
 * @property {string} id
 * @property {string} label
 * @property {number} damageMultiplier
 * @property {WardenCounter} counter
 * @property {number} wrongCounterMultiplier
 * @property {string} tell
 *
 * @typedef {Object} Warden
 * @property {string} id
 * @property {string} name
 * @property {string} colorToken
 * @property {number} maxHp
 * @property {number} baseDamage
 * @property {string} taunt
 * @property {readonly WardenMove[]} moves
 */

/** @type {readonly Warden[]} */
export const WARDENS = Object.freeze([
  Object.freeze({
    id: 'echo_sentinel',
    name: 'Echo Sentinel',
    colorToken: 'sentinel',
    maxHp: 120,
    baseDamage: 20,
    taunt: 'Your cadence falters before the chime.',
    moves: Object.freeze([
      Object.freeze({
        id: 'pulse_strike',
        label: 'Pulse Strike',
        damageMultiplier: 1.0,
        counter: 'either',
        wrongCounterMultiplier: 1.0,
        tell: 'The Sentinel charges a rhythmic blast.',
      }),
      Object.freeze({
        id: 'shatter_tone',
        label: 'Shatter Tone',
        damageMultiplier: 1.15,
        counter: 'block',
        wrongCounterMultiplier: 1.35,
        tell: 'High harmonics form — brace your shield with Block!',
      }),
      Object.freeze({
        id: 'flutter_burst',
        label: 'Flutter Burst',
        damageMultiplier: 1.10,
        counter: 'parry',
        wrongCounterMultiplier: 1.35,
        tell: 'Rapid echoes gather — match the pitch with Parry!',
      }),
    ]),
  }),
  Object.freeze({
    id: 'cinder_weaver',
    name: 'Cinder Weaver',
    colorToken: 'cinder',
    maxHp: 150,
    baseDamage: 24,
    taunt: 'Ash and breath weave the pyre.',
    moves: Object.freeze([
      Object.freeze({
        id: 'flame_cadence',
        label: 'Flame Cadence',
        damageMultiplier: 1.0,
        counter: 'block',
        wrongCounterMultiplier: 1.4,
        tell: 'Blazing embers form a wall — Block the heat!',
      }),
      Object.freeze({
        id: 'spark_echo',
        label: 'Spark Echo',
        damageMultiplier: 1.2,
        counter: 'parry',
        wrongCounterMultiplier: 1.4,
        tell: 'A lightning spark crackles — Parry instantly!',
      }),
      Object.freeze({
        id: 'inferno_surge',
        label: 'Inferno Surge',
        damageMultiplier: 1.25,
        counter: 'either',
        wrongCounterMultiplier: 1.3,
        tell: 'The furnace roars — prepare any defense!',
      }),
    ]),
  }),
  Object.freeze({
    id: 'void_singer',
    name: 'Void Singer',
    colorToken: 'void',
    maxHp: 185,
    baseDamage: 28,
    taunt: 'In the silence beneath, no voice returns.',
    moves: Object.freeze([
      Object.freeze({
        id: 'null_hymn',
        label: 'Null Hymn',
        damageMultiplier: 1.1,
        counter: 'parry',
        wrongCounterMultiplier: 1.5,
        tell: 'A dissonant hymn pierces the dark — Parry the chant!',
      }),
      Object.freeze({
        id: 'gravity_surge',
        label: 'Gravity Surge',
        damageMultiplier: 1.2,
        counter: 'block',
        wrongCounterMultiplier: 1.5,
        tell: 'Crushing pressure builds — Block and ground yourself!',
      }),
      Object.freeze({
        id: 'eclipse_blast',
        label: 'Eclipse Blast',
        damageMultiplier: 1.3,
        counter: 'either',
        wrongCounterMultiplier: 1.4,
        tell: 'The void collapses into a sphere — defend now!',
      }),
    ]),
  }),
]);

/**
 * Select a move deterministically for a Warden based on run seed, index, and round.
 * Round 1 of Warden 0 is pinned to moves[0] (Pulse Strike) for strict baseline reproducibility.
 *
 * @param {Warden} warden
 * @param {{ seed?: number, wardenIndex?: number, round?: number }} [options]
 * @returns {WardenMove}
 */
export function selectWardenMove(warden, { seed = 0, wardenIndex = 0, round = 1 } = {}) {
  if (!warden || !Array.isArray(warden.moves) || warden.moves.length === 0) {
    throw new Error('Invalid warden supplied to selectWardenMove');
  }

  // Baseline pin: Round 1 for the first Warden always selects moves[0]
  if (round === 1 && wardenIndex === 0) {
    return warden.moves[0];
  }

  // Pure deterministic hashing
  let hash = (Number(seed) ^ (wardenIndex * 10007) ^ (round * 997)) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35) >>> 0;
  hash = (hash ^ (hash >>> 16)) >>> 0;

  const moveIndex = hash % warden.moves.length;
  return warden.moves[moveIndex];
}

/**
 * Calculates incoming base damage for a given move and player defense choice.
 * If player uses the counter indicated by the move (or if counter is 'either'), normal damage applies.
 * If player uses the wrong counter, the wrongCounterMultiplier is applied.
 *
 * @param {Warden} warden
 * @param {WardenMove} move
 * @param {'block' | 'parry'} counterUsed
 * @returns {number}
 */
export function calculateMoveIncomingDamage(warden, move, counterUsed) {
  if (!warden || !move) return 20;

  const counterMatches = move.counter === 'either' || move.counter === counterUsed;
  const multiplier = counterMatches ? 1 : (move.wrongCounterMultiplier || 1);
  const rawDamage = (warden.baseDamage || 20) * (move.damageMultiplier || 1) * multiplier;

  return Math.round(rawDamage);
}
