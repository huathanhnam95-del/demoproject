import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildTimingPlan,
  collectTimingEvidence,
  createSilenceWav,
  finalizeStreamingWav,
  measureReducerResolution,
  parseArgs,
  validateWav,
} from '../../scripts/echo-forge/collect-timing-evidence.js';
import { reduceCombat } from '../../public/js/echo-forge/core/combat-reducer.js';

const catalog = JSON.parse(await readFile(new URL('../../public/database/echo-forge/challenges.v1.json', import.meta.url), 'utf8'));

function response(body, { status = 200, contentType = 'application/json' } = {}) {
  return new Response(body, { status, headers: { 'content-type': contentType } });
}

function analysisResponseFor(mode, { noOp = false } = {}) {
  if (noOp) return response(JSON.stringify({ success: false, error: 'AZURE_REQUIRED_SCORE_MISSING' }));
  if (mode === 'v3_word') {
    return response(JSON.stringify({ verification: {
      count: { status: 'verified', expected: 2, observed: 2, reasons: [] },
      primary_stress: { applicable: true, status: 'verified', matches_expected: true, reasons: [] },
      model_revision: 'test-model-v1',
    } }));
  }
  return response(JSON.stringify({ success: true, accuracyScore: 92, fluencyScore: 88, completenessScore: 90 }));
}

test('dry-run builds a deterministic A1-C1 plan without calling the network', async () => {
  let calls = 0;
  const result = await collectTimingEvidence({
    catalog,
    fetchImpl: async () => { calls += 1; throw new Error('network must not be called in dry-run'); },
    counts: { azureWord: 3, azurePhrase: 3, v3Word: 3, silence: 2 },
  });

  assert.equal(result.dryRun, true);
  assert.equal(calls, 0);
  assert.equal(result.records.length, 0);
  assert.deepEqual(result.plan.map((item) => item.evaluationMode), [
    'azure_word', 'azure_word', 'azure_word',
    'azure_phrase', 'azure_phrase', 'azure_phrase',
    'v3_word', 'v3_word', 'v3_word',
    'azure_word', 'azure_word',
  ]);
  assert.equal(result.plan.filter((item) => item.silence).length, 2);
  assert.equal(result.plan.every((item) => ['A1', 'A2', 'B1', 'B2', 'C1'].includes(item.challenge.level)), true);
  assert.equal(result.plan.some((item) => item.challenge.level === 'C2'), false);
  assert.deepEqual(buildTimingPlan(catalog, { counts: { azureWord: 3, azurePhrase: 3, v3Word: 3, silence: 2 } }), result.plan);
});

test('plan selection cycles deterministically when a mode has fewer catalog items than the requested count', () => {
  const plan = buildTimingPlan(catalog, { counts: { azureWord: 31, azurePhrase: 21, v3Word: 21, silence: 0 } });
  const azureWords = plan.filter((item) => item.evaluationMode === 'azure_word');
  const phrases = plan.filter((item) => item.evaluationMode === 'azure_phrase');
  const v3Words = plan.filter((item) => item.evaluationMode === 'v3_word');
  assert.equal(azureWords.length, 31);
  assert.equal(phrases.length, 21);
  assert.equal(v3Words.length, 21);
  assert.equal(phrases.at(-1).challengeId, phrases[0].challengeId);
  assert.equal(v3Words.at(-1).challengeId, v3Words[0].challengeId);
  assert.equal(plan.every((item) => item.challenge.level !== 'C2'), true);
});

test('silence WAV is valid mono PCM16 and WAV validation derives duration and bytes', async () => {
  const silence = createSilenceWav(250, 16000);
  const metadata = validateWav(silence);
  assert.equal(metadata.sampleRate, 16000);
  assert.equal(metadata.audioDurationMs, 250);
  assert.equal(metadata.audioByteCount, silence.byteLength);
  assert.throws(() => validateWav(new Uint8Array([1, 2, 3])), /RIFF|WAV/i);

  const oversized = new Uint8Array(1024 * 1024 + 1);
  assert.throws(() => validateWav(oversized), /1 MiB|size|WAV/i);
});

test('streaming sentinel WAV sizes are finalized in memory before strict validation', () => {
  const base = createSilenceWav(250, 24000);
  const list = new Uint8Array(12);
  list.set(new TextEncoder().encode('LIST'), 0);
  new DataView(list.buffer).setUint32(4, 4, true);
  list.set(new TextEncoder().encode('INFO'), 8);
  const streaming = new Uint8Array(base.byteLength + list.byteLength);
  streaming.set(base.slice(0, 36), 0);
  streaming.set(list, 36);
  streaming.set(base.slice(36), 36 + list.byteLength);
  const dataHeaderOffset = 36 + list.byteLength;
  const streamingView = new DataView(streaming.buffer);
  streamingView.setUint32(4, 0xffffffff, true);
  streamingView.setUint32(dataHeaderOffset + 4, 0xffffffff, true);

  const finalized = finalizeStreamingWav(streaming);
  assert.notDeepEqual(finalized, streaming);
  assert.deepEqual(validateWav(finalized), {
    sampleRate: 24000,
    audioDurationMs: 250,
    audioByteCount: finalized.byteLength,
  });
});

test('execute mode requires the explicit analyzer endpoints and output paths', () => {
  assert.equal(parseArgs([]).execute, false);
  assert.equal(parseArgs(['--dry-run']).execute, false);
  assert.throws(() => parseArgs(['--execute']), /--azure-endpoint|--v3-base-url/i);
  assert.throws(() => parseArgs(['--execute', '--azure-endpoint', 'http://azure.test']), /--v3-base-url/i);
  assert.throws(() => parseArgs(['--execute', '--v3-base-url', 'http://v3.test']), /--azure-endpoint/i);
  const parsed = parseArgs([
    '--execute', '--azure-endpoint', 'http://azure.test', '--v3-base-url', 'http://v3.test',
    '--json-output', 'timing.json', '--csv-output', 'timing.csv', '--timeout-ms', '3210',
  ]);
  assert.equal(parsed.execute, true);
  assert.equal(parsed.timeoutMs, 3210);
  assert.equal(parsed.ttsEndpoint, 'http://127.0.0.1:8880/v1/audio/speech');
});

test('reducer timing starts combat, resolves the matching card, and preserves no-op state identity', () => {
  const actions = [];
  const analysis = {
    schemaVersion: 'echo-forge-analysis-v1',
    status: 'unavailable',
    score: null,
    evaluationMode: 'azure_word',
    dimensions: {},
    verdict: 'unavailable',
    engineRevision: 'test-v1',
    challengeId: 'ef-a1-azure-word-001',
    variantId: null,
    reasonCode: 'REQUEST_FAILED',
  };
  let tick = 100;
  const result = measureReducerResolution({
    task: { selectedLevel: 'A1', evaluationMode: 'azure_word' },
    analysis,
    clock: () => { tick += 45; return tick; },
    reducer: (state, action) => {
      actions.push(action);
      return reduceCombat(state, action);
    },
  });
  assert.deepEqual(actions.map((action) => action.type), ['START_COMBAT', 'RESOLVE_PLAYER_ATTACK']);
  assert.equal(actions[1].cardId, 'precision_strike');
  assert.equal(result.durationMs, 45);
  assert.strictEqual(result.stateAfter, result.stateBefore);
});

test('small injected-fetch execution writes only technical JSON and CSV after all attempts', async () => {
  const outputDirectory = await mkdtemp(path.join(os.tmpdir(), 'echo-forge-timing-'));
  const jsonOutput = path.join(outputDirectory, 'timing.json');
  const csvOutput = path.join(outputDirectory, 'timing.csv');
  const calls = [];
  const wav = createSilenceWav(100, 16000);
  let clockValue = 0;
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith('/warm/v3')) return response('{}');
    if (String(url) === 'http://tts.test/v1/audio/speech') return response(wav, { contentType: 'audio/wav' });
    if (String(url).endsWith('/analyze/v3')) return analysisResponseFor('v3_word');
    const mode = options.body?.get('evaluationMode');
    return analysisResponseFor(mode, { noOp: options.body?.get('challengeId') === 'ef-a1-azure-word-001' && calls.filter((call) => call.options.body?.get?.('challengeId') === 'ef-a1-azure-word-001').length > 1 });
  };

  try {
    const result = await collectTimingEvidence({
      catalog,
      execute: true,
      azureEndpoint: 'http://azure.test/assess',
      v3BaseUrl: 'http://v3.test',
      ttsEndpoint: 'http://tts.test/v1/audio/speech',
      jsonOutput,
      csvOutput,
      counts: { azureWord: 1, azurePhrase: 1, v3Word: 1, silence: 1 },
      fetchImpl,
      timeoutMs: 1000,
      silenceDurationMs: 100,
      clock: () => { clockValue += 5; return clockValue; },
    });
    assert.equal(result.dryRun, false);
    assert.equal(result.records.length, 4);
    assert.equal(result.records.every((record) => record.audioDurationMs === 100), true);
    assert.equal(result.records.every((record) => !('raw' in record)), true);
    assert.equal(result.records.filter((record) => record.prewarmDurationMs > 0).length, 1);
    assert.equal(result.records.filter((record) => record.evaluationMode === 'v3_word')[0].prewarmDurationMs > 0, true);
    assert.equal(result.records.filter((record) => record.evaluationMode !== 'v3_word').every((record) => record.prewarmDurationMs === 0), true);
    assert.equal(result.records.every((record) => record.reducerResolutionDurationMs === 5), true);
    assert.equal(result.timingGate.ready, false);
    assert.equal(result.timingGate.counts.unavailable_or_unrateable, 1);
    assert.equal(calls[0].url, 'http://v3.test/warm/v3');
    assert.equal(calls.filter((call) => call.url === 'http://tts.test/v1/audio/speech').length, 3);
    const ttsBody = JSON.parse(calls.find((call) => call.url === 'http://tts.test/v1/audio/speech').options.body);
    assert.equal(ttsBody.response_format, 'wav');
    const json = await readFile(jsonOutput, 'utf8');
    const csv = await readFile(csvOutput, 'utf8');
    assert.equal(JSON.parse(json).summary.count, 4);
    assert.match(csv, /^evaluationMode,count,minimum,p50/m);
    assert.doesNotMatch(`${json}\n${csv}`, /referenceText|recognizedText|transcript|raw|payload|audioUrl|token|email/i);
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});

test('unsupported TTS response format fails clearly without analyzer calls or output files', async () => {
  const outputDirectory = await mkdtemp(path.join(os.tmpdir(), 'echo-forge-timing-unsupported-'));
  const jsonOutput = path.join(outputDirectory, 'timing.json');
  const csvOutput = path.join(outputDirectory, 'timing.csv');
  let analyzerCalls = 0;
  try {
    await assert.rejects(() => collectTimingEvidence({
      catalog,
      execute: true,
      azureEndpoint: 'http://azure.test/assess',
      v3BaseUrl: 'http://v3.test',
      ttsEndpoint: 'http://tts.test/v1/audio/speech',
      jsonOutput,
      csvOutput,
      counts: { azureWord: 1, azurePhrase: 0, v3Word: 0, silence: 0 },
      fetchImpl: async (url) => {
        if (String(url).endsWith('/warm/v3')) return response('{}');
        if (String(url).includes('/assess')) analyzerCalls += 1;
        return response('not-wav', { contentType: 'audio/mpeg' });
      },
    }), /TTS.*WAV|WAV.*unsupported/i);
    assert.equal(analyzerCalls, 0);
    await assert.rejects(() => readFile(jsonOutput));
    await assert.rejects(() => readFile(csvOutput));
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});
