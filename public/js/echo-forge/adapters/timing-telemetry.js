const ALLOWED_FIELDS = Object.freeze([
  'challengeId', 'evaluationMode', 'selectedLevel', 'supportPreset',
  'audioDurationMs', 'audioByteCount', 'prewarmDurationMs', 'requestDurationMs',
  'responseDurationMs', 'normalizationDurationMs', 'reducerResolutionDurationMs',
  'outcome', 'httpCode', 'errorCode', 'retryOrdinal',
]);

const METRIC_FIELDS = Object.freeze([
  'audioDurationMs', 'audioByteCount', 'prewarmDurationMs', 'requestDurationMs',
  'responseDurationMs', 'normalizationDurationMs', 'reducerResolutionDurationMs',
]);

const FORBIDDEN_KEY = /audio(?!DurationMs|ByteCount)|url|referenceText|transcript|recognizedText|uid|email|token|raw|payload/i;
const MODES = new Set(['azure_word', 'azure_phrase', 'v3_word']);
const LEVELS = new Set(['A1', 'A2', 'B1', 'B2', 'C1']);
const PRESETS = new Set(['guided', 'standard', 'challenge']);
const OUTCOMES = new Set(['scored', 'incorrect', 'unrateable', 'unavailable', 'cancelled', 'invalid']);

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

function validateRecord(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('telemetry record must be an object');
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('telemetry record must be a plain object with own fields');
  }
  for (const key of Object.keys(input)) {
    if (FORBIDDEN_KEY.test(key)) throw new TypeError(`forbidden telemetry field: ${key}`);
    if (!ALLOWED_FIELDS.includes(key)) throw new TypeError(`field is not on the telemetry allowlist: ${key}`);
  }
  for (const field of ALLOWED_FIELDS) {
    if (!Object.hasOwn(input, field)) throw new TypeError(`missing own telemetry field: ${field}`);
  }
  if (typeof input.challengeId !== 'string' || !input.challengeId) throw new TypeError('challengeId is required');
  if (!MODES.has(input.evaluationMode)) throw new TypeError('invalid evaluationMode');
  if (!LEVELS.has(input.selectedLevel)) throw new TypeError('invalid selectedLevel');
  if (!PRESETS.has(input.supportPreset)) throw new TypeError('invalid supportPreset');
  if (!OUTCOMES.has(input.outcome)) throw new TypeError('invalid outcome');
  for (const field of METRIC_FIELDS) {
    if (!Number.isFinite(input[field]) || input[field] < 0) throw new TypeError(`${field} must be non-negative`);
  }
  if (!Number.isInteger(input.audioByteCount)) throw new TypeError('audioByteCount must be an integer');
  if (!Number.isInteger(input.retryOrdinal) || input.retryOrdinal < 0) throw new TypeError('retryOrdinal must be non-negative');
  if (input.httpCode !== null && (!Number.isInteger(input.httpCode) || input.httpCode < 100 || input.httpCode > 599)) {
    throw new TypeError('httpCode must be null or a valid status code');
  }
  if (input.errorCode !== null && typeof input.errorCode !== 'string') throw new TypeError('errorCode must be null or a string');
  return freeze(structuredClone(input));
}

function percentile(sorted, fraction) {
  if (sorted.length === 0) return null;
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function metricSummary(records, field) {
  const values = records.map((entry) => entry[field]).sort((a, b) => a - b);
  return {
    minimum: values[0] ?? null,
    p50: percentile(values, 0.50),
    p75: percentile(values, 0.75),
    p90: percentile(values, 0.90),
    p95: percentile(values, 0.95),
    maximum: values.at(-1) ?? null,
  };
}

export function summarizeTimingRecords(records) {
  const validated = records.map(validateRecord);
  const count = validated.length;
  return {
    count,
    metrics: Object.fromEntries(METRIC_FIELDS.map((field) => [field, metricSummary(validated, field)])),
    unavailableRate: count ? validated.filter((entry) => entry.outcome === 'unavailable').length / count : 0,
    unrateableRate: count ? validated.filter((entry) => entry.outcome === 'unrateable').length / count : 0,
  };
}

export function evaluateTimingGate(records) {
  const validated = records.map(validateRecord);
  const counts = {
    azure_word_scored: validated.filter((entry) => entry.evaluationMode === 'azure_word' && entry.outcome === 'scored').length,
    azure_phrase_scored: validated.filter((entry) => entry.evaluationMode === 'azure_phrase' && entry.outcome === 'scored').length,
    v3_word_formal: validated.filter((entry) => entry.evaluationMode === 'v3_word' && (entry.outcome === 'scored' || entry.outcome === 'incorrect')).length,
    unavailable_or_unrateable: validated.filter((entry) => entry.outcome === 'unavailable' || entry.outcome === 'unrateable').length,
  };
  return { ready: counts.azure_word_scored >= 30 && counts.azure_phrase_scored >= 30 && counts.v3_word_formal >= 30 && counts.unavailable_or_unrateable >= 10, counts };
}

export function createTimingTelemetry() {
  const records = [];
  return Object.freeze({
    get size() { return records.length; },
    record(input) { records.push(validateRecord(input)); },
    clear() { records.length = 0; },
    snapshot() { return Object.freeze([...records]); },
    exportJson() {
      const byEvaluationMode = Object.fromEntries([...MODES].map((mode) => [
        mode, summarizeTimingRecords(records.filter((entry) => entry.evaluationMode === mode)),
      ]));
      return JSON.stringify({ summary: summarizeTimingRecords(records), byEvaluationMode, timingGate: evaluateTimingGate(records) }, null, 2);
    },
    exportCsv() {
      const header = 'evaluationMode,count,minimum,p50,p75,p90,p95,maximum,unavailableRate,unrateableRate,metric';
      const rows = [];
      for (const mode of MODES) {
        const summary = summarizeTimingRecords(records.filter((entry) => entry.evaluationMode === mode));
        for (const metric of METRIC_FIELDS) {
          const values = summary.metrics[metric];
          rows.push([mode, summary.count, values.minimum, values.p50, values.p75, values.p90, values.p95, values.maximum, summary.unavailableRate, summary.unrateableRate, metric].join(','));
        }
      }
      return `${header}\n${rows.join('\n')}\n`;
    },
  });
}
