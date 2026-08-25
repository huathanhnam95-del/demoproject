import { assertCefrLevel } from './policy.js';
import { EVALUATION_MODES } from '../contracts/analysis-result.js';

function assertChallenge(challenge) {
  if (!challenge || typeof challenge !== 'object') throw new TypeError('challenge must be an object');
  assertCefrLevel(challenge.level);
  if (!EVALUATION_MODES.includes(challenge.evaluationMode)) {
    throw new RangeError(`unsupported evaluationMode: ${challenge.evaluationMode}`);
  }
  if (challenge.unitType !== 'word' && challenge.unitType !== 'phrase' && challenge.unitType !== 'listening') {
    throw new RangeError(`unsupported unitType: ${challenge.unitType}`);
  }
  if (challenge.evaluationMode === 'v3_word' && challenge.unitType !== 'word') {
    throw new RangeError('V3 v3_word challenges are word-only');
  }
}

export function filterChallenges(challenges, { level, evaluationMode, unitType } = {}) {
  if (!Array.isArray(challenges)) throw new TypeError('challenges must be an array');
  if (level !== undefined) assertCefrLevel(level);
  for (const challenge of challenges) assertChallenge(challenge);
  return challenges.filter((challenge) => (
    (level === undefined || challenge.level === level)
    && (evaluationMode === undefined || challenge.evaluationMode === evaluationMode)
    && (unitType === undefined || challenge.unitType === unitType)
  ));
}

export function selectChallenge(challenges, {
  level,
  evaluationMode,
  unitType,
  rng,
}) {
  if (!rng || typeof rng.nextFloat !== 'function') {
    throw new TypeError('a seeded rng is required');
  }
  const eligible = filterChallenges(challenges, { level, evaluationMode, unitType });
  if (eligible.length === 0) throw new RangeError('no eligible Echo Forge challenges');
  const randomValue = rng.nextFloat();
  if (!Number.isFinite(randomValue) || randomValue < 0 || randomValue >= 1) {
    throw new RangeError('rng.nextFloat() must return a finite random value in [0, 1)');
  }
  const index = Math.floor(randomValue * eligible.length);
  return eligible[index];
}
