import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createTimingTelemetry,
  evaluateTimingGate,
  summarizeTimingRecords,
} from '../../public/js/echo-forge/adapters/timing-telemetry.js';

const record = (ordinal, overrides = {}) => ({
  challengeId: `ef-a1-azure-word-${String(ordinal).padStart(3, '0')}`,
  evaluationMode: 'azure_word',
  selectedLevel: 'A1',
  supportPreset: 'standard',
  audioDurationMs: 1000 + ordinal,
  audioByteCount: 2000 + ordinal,
  prewarmDurationMs: 10,
  requestDurationMs: ordinal * 10,
  responseDurationMs: ordinal * 20,
  normalizationDurationMs: 2,
  reducerResolutionDurationMs: 1,
  outcome: 'scored',
  httpCode: 200,
  errorCode: null,
  retryOrdinal: 0,
  ...overrides,
});

test('timing telemetry remains in memory and accepts allowlisted technical fields only', () => {
  const telemetry = createTimingTelemetry();
  telemetry.record(record(1));
  assert.equal(telemetry.size, 1);
  assert.deepEqual(telemetry.snapshot(), [record(1)]);
  assert.equal(Object.isFrozen(telemetry.snapshot()[0]), true);

  for (const forbidden of [
    { transcript: 'secret' }, { recognizedText: 'hello' }, { uid: '123' },
    { email: 'a@example.com' }, { token: 'secret' }, { audioUrl: 'blob:secret' },
    { rawPayload: { score: 80 } }, { audio: new Uint8Array([1, 2]) },
  ]) {
    assert.throws(() => telemetry.record({ ...record(2), ...forbidden }), /forbidden|allowlist|telemetry/);
  }

  const inherited = Object.create(record(3));
  assert.throws(() => telemetry.record(inherited), /own|plain|missing|telemetry/);
});

test('summary includes exact distribution statistics and availability rates', () => {
  const records = [1, 2, 3, 4].map((value) => record(value, {
    requestDurationMs: value * 10,
    outcome: value === 3 ? 'unavailable' : (value === 4 ? 'unrateable' : 'scored'),
  }));
  const summary = summarizeTimingRecords(records);
  assert.equal(summary.count, 4);
  assert.deepEqual(summary.metrics.requestDurationMs, {
    minimum: 10, p50: 25, p75: 32.5, p90: 37, p95: 38.5, maximum: 40,
  });
  assert.equal(summary.unavailableRate, 0.25);
  assert.equal(summary.unrateableRate, 0.25);
});

test('JSON/CSV exports contain summaries, never lexical or audio payloads', () => {
  const telemetry = createTimingTelemetry();
  telemetry.record(record(1));
  const json = telemetry.exportJson();
  const csv = telemetry.exportCsv();
  assert.equal(JSON.parse(json).summary.count, 1);
  assert.match(csv, /evaluationMode,count,minimum,p50,p75,p90,p95,maximum,unavailableRate,unrateableRate/);
  assert.doesNotMatch(`${json}\n${csv}`, /transcript|recognizedText|referenceText|audioUrl|token|email/);
});

test('timing gate requires 30 Azure words, 30 phrases, 30 V3 words, and 10 no-op outcomes', () => {
  const records = [
    ...Array.from({ length: 30 }, (_, index) => record(index + 1)),
    ...Array.from({ length: 30 }, (_, index) => record(index + 1, { evaluationMode: 'azure_phrase' })),
    ...Array.from({ length: 30 }, (_, index) => record(index + 1, { evaluationMode: 'v3_word' })),
    ...Array.from({ length: 10 }, (_, index) => record(index + 1, {
      outcome: index % 2 ? 'unavailable' : 'unrateable',
    })),
  ];
  assert.deepEqual(evaluateTimingGate(records), {
    ready: true,
    counts: { azure_word_scored: 30, azure_phrase_scored: 30, v3_word_formal: 30, unavailable_or_unrateable: 10 },
  });
  assert.equal(evaluateTimingGate(records.slice(1)).ready, false);
});
