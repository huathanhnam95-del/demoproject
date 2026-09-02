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
  recentChallengeIds,
}) {
  if (!rng || typeof rng.nextFloat !== 'function') {
    throw new TypeError('a seeded rng is required');
  }
  const eligible = filterChallenges(challenges, { level, evaluationMode, unitType });
  if (eligible.length === 0) throw new RangeError('no eligible Echo Forge challenges');
  const recent = recentChallengeIds instanceof Set ? recentChallengeIds : new Set();
  let available = eligible.length > 1 ? eligible.filter((challenge) => !recent.has(challenge.challengeId)) : eligible;
  if (!available.length && eligible.length > 1) {
    const lastEligibleId = [...recent].reverse().find((challengeId) => eligible.some((challenge) => challenge.challengeId === challengeId));
    for (const challenge of eligible) recent.delete(challenge.challengeId);
    if (lastEligibleId) recent.add(lastEligibleId);
    available = eligible.filter((challenge) => challenge.challengeId !== lastEligibleId);
  }
  const pool = available.length ? available : eligible;
  const randomValue = rng.nextFloat();
  if (!Number.isFinite(randomValue) || randomValue < 0 || randomValue >= 1) {
    throw new RangeError('rng.nextFloat() must return a finite random value in [0, 1)');
  }
  const index = Math.floor(randomValue * pool.length);
  const selected = pool[index];
  recent.add(selected.challengeId);
  return selected;
}
