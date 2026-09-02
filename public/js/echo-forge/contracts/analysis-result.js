export const ANALYSIS_SCHEMA_VERSION = 'echo-forge-analysis-v1';

export const ANALYSIS_STATUSES = Object.freeze([
  'scored',
  'incorrect',
  'unrateable',
  'unavailable',
  'cancelled',
  'invalid',
]);

export const EVALUATION_MODES = Object.freeze([
  'azure_word',
  'azure_phrase',
  'v3_word',
]);

export const NOOP_ANALYSIS_STATUSES = Object.freeze([
  'unrateable',
  'unavailable',
  'cancelled',
  'invalid',
]);

const RESULT_FIELDS = new Set([
  'schemaVersion',
  'status',
  'score',
  'evaluationMode',
  'dimensions',
  'verdict',
  'engineRevision',
  'challengeId',
  'variantId',
  'reasonCode',
]);

function assertNullableString(value, field) {
  if (value !== null && typeof value !== 'string') {
    throw new TypeError(`${field} must be a string or null`);
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function assertJsonValue(value, path, ancestors = new WeakSet()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${path} must contain finite JSON numbers`);
    return;
  }
  if (typeof value !== 'object') throw new TypeError(`${path} must contain JSON-compatible values`);
  if (ancestors.has(value)) throw new TypeError(`${path} must not contain cyclic values`);
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${path} must contain only arrays and plain JSON objects`);
  }
  ancestors.add(value);
  for (const [key, child] of Object.entries(value)) {
    assertJsonValue(child, `${path}.${key}`, ancestors);
  }
  ancestors.delete(value);
}

export function createAnalysisResult(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('analysis result must be an object');
  }

  for (const field of Object.keys(input)) {
    if (!RESULT_FIELDS.has(field)) throw new TypeError(`unexpected analysis field: ${field}`);
  }
  for (const field of RESULT_FIELDS) {
    if (!(field in input)) throw new TypeError(`missing analysis field: ${field}`);
  }
  if (input.schemaVersion !== ANALYSIS_SCHEMA_VERSION) {
    throw new TypeError(`schemaVersion must be ${ANALYSIS_SCHEMA_VERSION}`);
  }
  if (!ANALYSIS_STATUSES.includes(input.status)) {
    throw new TypeError(`invalid status: ${input.status}`);
  }
  if (!EVALUATION_MODES.includes(input.evaluationMode)) {
    throw new TypeError(`invalid evaluationMode: ${input.evaluationMode}`);
  }
  if (input.score !== null
    && (!Number.isFinite(input.score) || input.score < 0 || input.score > 100)) {
    throw new TypeError('score must be null or a number from 0 through 100');
  }
  if ((input.status === 'scored' || input.status === 'incorrect') && input.score === null) {
    throw new TypeError(`${input.status} results require a score`);
  }
  if (!input.dimensions || typeof input.dimensions !== 'object' || Array.isArray(input.dimensions)) {
    throw new TypeError('dimensions must be an object');
  }
  assertJsonValue(input.dimensions, 'dimensions');
  for (const field of ['verdict', 'engineRevision', 'challengeId']) {
    if (typeof input[field] !== 'string' || !input[field]) {
      throw new TypeError(`${field} must be a non-empty string`);
    }
  }
  assertNullableString(input.variantId, 'variantId');
  assertNullableString(input.reasonCode, 'reasonCode');

  return deepFreeze({
    schemaVersion: input.schemaVersion,
    status: input.status,
    score: input.score,
    evaluationMode: input.evaluationMode,
    dimensions: structuredClone(input.dimensions),
    verdict: input.verdict,
    engineRevision: input.engineRevision,
    challengeId: input.challengeId,
    variantId: input.variantId,
    reasonCode: input.reasonCode,
  });
}

export function isCombatNoopAnalysis(result) {
  return NOOP_ANALYSIS_STATUSES.includes(result?.status)
    || result?.dimensions?.referenceConflict === true
    || result?.reasonCode === 'REFERENCE_CONFLICT';
}
