import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildAudioManifest,
  validateListeningWav,
} from '../../scripts/echo-forge/listening-audio-core.js';
import {
  loadAzureCredentials,
  runListeningAudioSemanticQa,
  validatePrivacySafeOutput,
} from '../../scripts/echo-forge/listening-audio-semantic-qa-core.mjs';
import { main as semanticQaMain, parseArgs as parseSemanticQaArgs } from '../../scripts/echo-forge/verify-listening-audio-azure.mjs';

const catalog = JSON.parse(await readFile(new URL('../../public/database/echo-forge/challenges.v1.json', import.meta.url), 'utf8'));
const source = JSON.parse(await readFile(new URL('../../data/echo-forge/challenges.source.json', import.meta.url), 'utf8'));
const KEY = 'test-azure-key-that-must-not-leak';
const REGION = 'test-region';
const MODEL_HASH = 'a'.repeat(64);
const VOICE_HASH = 'b'.repeat(64);

function sineWav({ durationMs = 100, amplitude = 0.2 } = {}) {
  const sampleRate = 24_000;
  const sampleCount = Math.max(1, Math.round(sampleRate * durationMs / 1000));
  const dataSize = sampleCount * 2;
  const bytes = new Uint8Array(44 + dataSize);
  const view = new DataView(bytes.buffer);
  const encoder = new TextEncoder();
  bytes.set(encoder.encode('RIFF'), 0);
  view.setUint32(4, bytes.byteLength - 8, true);
  bytes.set(encoder.encode('WAVEfmt '), 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  bytes.set(encoder.encode('data'), 36);
  view.setUint32(40, dataSize, true);
  for (let index = 0; index < sampleCount; index += 1) {
    const sample = Math.round(Math.sin(index / 5) * amplitude * 32767);
    view.setInt16(44 + index * 2, sample, true);
  }
  return bytes;
}

function azureResponse(score = 90) {
  return new Response(JSON.stringify({
    NBest: [{ PronunciationAssessment: { AccuracyScore: score } }],
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

async function makeFixture({ tamperManifest = null, mismatchDataManifest = null, tamperAudio = null } = {}) {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'echo-forge-semantic-qa-'));
  const audioRoot = path.join(fixtureRoot, 'public');
  const publicManifestPath = path.join(audioRoot, 'database/echo-forge/audio-manifest.v1.json');
  const dataManifestPath = path.join(fixtureRoot, 'data/echo-forge/audio-manifest.v1.json');
  const catalogPath = path.join(fixtureRoot, 'public/database/echo-forge/challenges.v1.json');
  const sourcePath = path.join(fixtureRoot, 'data/echo-forge/challenges.source.json');
  const wav = sineWav();
  const metadata = validateListeningWav(wav);
  const records = catalog.challenges
    .filter((challenge) => challenge.unitType === 'listening')
    .sort((left, right) => left.challengeId.localeCompare(right.challengeId))
    .map((challenge) => ({ challenge, ...metadata }));
  let manifest = buildAudioManifest({
    catalog,
    source,
    records,
    modelSha256: MODEL_HASH,
    voiceSha256: VOICE_HASH,
    generatedAt: '2026-08-25T00:00:00.000Z',
  });
  if (tamperManifest) manifest = tamperManifest(manifest);
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  const dataManifestText = `${JSON.stringify(mismatchDataManifest ? mismatchDataManifest(manifest) : manifest, null, 2)}\n`;
  await mkdir(path.dirname(publicManifestPath), { recursive: true });
  await mkdir(path.dirname(dataManifestPath), { recursive: true });
  await mkdir(path.join(audioRoot, 'database/echo-forge/audio/v1/a1/listening'), { recursive: true });
  await writeFile(catalogPath, `${JSON.stringify(catalog)}\n`);
  await writeFile(sourcePath, `${JSON.stringify(source)}\n`);
  await writeFile(publicManifestPath, manifestText);
  await writeFile(dataManifestPath, dataManifestText);
  for (const entry of manifest.entries) {
    const filePath = path.join(audioRoot, entry.path.replace(/^\//, '').split('/').join(path.sep));
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, tamperAudio?.(entry, wav) || wav);
  }
  return {
    fixtureRoot,
    audioRoot,
    catalogPath,
    sourcePath,
    publicManifestPath,
    dataManifestPath,
    wav,
    manifest,
  };
}

function optionsFor(fixture, overrides = {}) {
  return {
    ...fixture,
    jsonPath: path.join(fixture.fixtureRoot, 'report.json'),
    csvPath: path.join(fixture.fixtureRoot, 'report.csv'),
    key: KEY,
    region: REGION,
    threshold: 80,
    generatedAt: '2026-08-25T01:02:03.000Z',
    ...overrides,
  };
}

test('posts all 30 WAVs with exact Comprehensive Word assessment config and emits safe JSON/CSV', async () => {
  const fixture = await makeFixture();
  const requests = [];
  try {
    const result = await runListeningAudioSemanticQa(optionsFor(fixture, {
      fetchImpl: async (url, request) => {
        requests.push({ url: String(url), request });
        return azureResponse(90);
      },
    }));
    assert.equal(result.passed, true);
    assert.equal(result.report.summary.count, 30);
    assert.equal(result.report.summary.passCount, 30);
    assert.equal(result.report.entries.length, 30);
    assert.equal(requests.length, 30);
    const first = requests[0];
    assert.equal(first.url, `https://${REGION}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=en-US&format=detailed`);
    assert.equal(first.request.method, 'POST');
    assert.equal(first.request.headers.Accept, 'application/json');
    assert.equal(first.request.headers['Content-Type'], 'audio/wav; codecs=audio/pcm; samplerate=24000');
    assert.equal(first.request.headers['Ocp-Apim-Subscription-Key'], KEY);
    const assessment = JSON.parse(Buffer.from(first.request.headers['Pronunciation-Assessment'], 'base64').toString('utf8'));
    assert.deepEqual(assessment, {
      ReferenceText: 'ship',
      GradingSystem: 'HundredMark',
      Dimension: 'Comprehensive',
      Granularity: 'Word',
      EnableMiscue: true,
    });
    const reportText = await readFile(optionsFor(fixture).jsonPath, 'utf8');
    const csvText = await readFile(optionsFor(fixture).csvPath, 'utf8');
    assert.doesNotMatch(reportText, /test-azure-key|ReferenceText|ship|stt\.speech|NBest|payload|transcript|audio bytes/i);
    assert.doesNotMatch(csvText, /test-azure-key|ReferenceText|ship|stt\.speech|NBest|payload|transcript|audio bytes/i);
    assert.deepEqual(Object.keys(result.report.entries[0]).sort(), [
      'accuracyScore', 'audioByteCount', 'audioDurationMs', 'audioSha256', 'challengeId', 'reasonCode', 'status',
    ].sort());
  } finally {
    await rm(fixture.fixtureRoot, { recursive: true, force: true });
  }
});

test('accepts Azure REST aggregate AccuracyScore on the NBest item', async () => {
  const fixture = await makeFixture();
  try {
    const result = await runListeningAudioSemanticQa(optionsFor(fixture, {
      fetchImpl: async () => new Response(JSON.stringify({
        NBest: [{ AccuracyScore: 91 }],
      }), { status: 200, headers: { 'content-type': 'application/json' } }),
    }));
    assert.equal(result.passed, true);
    assert.equal(result.report.summary.passCount, 30);
    assert.equal(result.report.entries[0].accuracyScore, 91);
  } finally {
    await rm(fixture.fixtureRoot, { recursive: true, force: true });
  }
});

test('marks a threshold failure while still writing the complete report and rejects pass status', async () => {
  const fixture = await makeFixture();
  try {
    const result = await runListeningAudioSemanticQa(optionsFor(fixture, {
      threshold: 95,
      fetchImpl: async () => azureResponse(90),
    }));
    assert.equal(result.passed, false);
    assert.equal(result.report.summary.failCount, 30);
    assert.equal(result.report.entries.every((entry) => entry.status === 'below_threshold'), true);
    assert.equal(JSON.parse(await readFile(path.join(fixture.fixtureRoot, 'report.json'), 'utf8')).summary.failCount, 30);
  } finally {
    await rm(fixture.fixtureRoot, { recursive: true, force: true });
  }
});

test('classifies missing aggregate score as unrateable and HTTP errors as unavailable', async () => {
  const missing = await makeFixture();
  try {
    const result = await runListeningAudioSemanticQa(optionsFor(missing, {
      fetchImpl: async () => new Response(JSON.stringify({ NBest: [{ PronunciationAssessment: {} }] }), { status: 200 }),
    }));
    assert.equal(result.passed, false);
    assert.equal(result.report.summary.unrateable, 30);
    assert.equal(result.report.entries[0].status, 'unrateable');
    assert.equal(result.report.entries[0].accuracyScore, null);
  } finally {
    await rm(missing.fixtureRoot, { recursive: true, force: true });
  }
  const unavailable = await makeFixture();
  try {
    const result = await runListeningAudioSemanticQa(optionsFor(unavailable, {
      fetchImpl: async () => new Response('', { status: 503 }),
    }));
    assert.equal(result.passed, false);
    assert.equal(result.report.summary.unavailable, 30);
    assert.equal(result.report.entries[0].status, 'unavailable');
    assert.equal(result.report.entries[0].reasonCode, 'http_error');
  } finally {
    await rm(unavailable.fixtureRoot, { recursive: true, force: true });
  }
});

test('rejects audio hash tamper and manifest mismatch before producing either output', async () => {
  const fixture = await makeFixture({ tamperAudio: (_entry, wav) => {
    const tampered = new Uint8Array(wav);
    tampered[44] ^= 1;
    return tampered;
  } });
  try {
    await assert.rejects(
      () => runListeningAudioSemanticQa(optionsFor(fixture, { fetchImpl: async () => azureResponse(90) })),
      /hash|audio/i,
    );
    await assert.rejects(() => readFile(path.join(fixture.fixtureRoot, 'report.json')), { code: 'ENOENT' });
    await assert.rejects(() => readFile(path.join(fixture.fixtureRoot, 'report.csv')), { code: 'ENOENT' });
  } finally {
    await rm(fixture.fixtureRoot, { recursive: true, force: true });
  }

  const mismatch = await makeFixture({ tamperManifest: (manifest) => ({ ...manifest, sourceSha256: 'c'.repeat(64) }) });
  try {
    await assert.rejects(
      () => runListeningAudioSemanticQa(optionsFor(mismatch, { fetchImpl: async () => azureResponse(90) })),
      /manifest|source|binding/i,
    );
    await assert.rejects(() => readFile(path.join(mismatch.fixtureRoot, 'report.json')), { code: 'ENOENT' });
    await assert.rejects(() => readFile(path.join(mismatch.fixtureRoot, 'report.csv')), { code: 'ENOENT' });
  } finally {
    await rm(mismatch.fixtureRoot, { recursive: true, force: true });
  }

  const pairMismatch = await makeFixture({ mismatchDataManifest: (manifest) => ({ ...manifest, generatedAt: '2026-08-25T00:00:01.000Z' }) });
  try {
    await assert.rejects(
      () => runListeningAudioSemanticQa(optionsFor(pairMismatch, { fetchImpl: async () => azureResponse(90) })),
      /public and data|manifest|differ/i,
    );
    await assert.rejects(() => readFile(path.join(pairMismatch.fixtureRoot, 'report.json')), { code: 'ENOENT' });
    await assert.rejects(() => readFile(path.join(pairMismatch.fixtureRoot, 'report.csv')), { code: 'ENOENT' });
  } finally {
    await rm(pairMismatch.fixtureRoot, { recursive: true, force: true });
  }
});

test('privacy denylist is recursive and rejects forbidden output keys and values', () => {
  assert.throws(() => validatePrivacySafeOutput({ safe: { nested: { referenceText: 'ship' } } }), /privacy|forbidden|reference/i);
  assert.throws(() => validatePrivacySafeOutput({ safe: { nested: { requestId: 'abc' } } }), /privacy|forbidden|request/i);
  assert.throws(() => validatePrivacySafeOutput({ safe: { nested: { value: 'https://example.test' } } }), /privacy|forbidden|url/i);
  assert.throws(() => validatePrivacySafeOutput({ safe: { nested: { value: 'recognized transcript' } } }), /privacy|forbidden|recognized|transcript/i);
  assert.doesNotThrow(() => validatePrivacySafeOutput({ schemaVersion: 'v1', audioSha256: 'a'.repeat(64), audioDurationMs: 100 }));
});

test('transport failure leaves no partial output after earlier successful requests', async () => {
  const fixture = await makeFixture();
  let calls = 0;
  try {
    await assert.rejects(
      () => runListeningAudioSemanticQa(optionsFor(fixture, {
        fetchImpl: async () => {
          calls += 1;
          if (calls === 8) throw new Error('simulated transport failure');
          return azureResponse(90);
        },
      })),
      /unavailable|transport|assessment/i,
    );
    assert.equal(calls, 30);
    await assert.rejects(() => readFile(path.join(fixture.fixtureRoot, 'report.json')), { code: 'ENOENT' });
    await assert.rejects(() => readFile(path.join(fixture.fixtureRoot, 'report.csv')), { code: 'ENOENT' });
  } finally {
    await rm(fixture.fixtureRoot, { recursive: true, force: true });
  }
});

test('report hashes are derived from the validated WAV bytes', async () => {
  const fixture = await makeFixture();
  try {
    const result = await runListeningAudioSemanticQa(optionsFor(fixture, { fetchImpl: async () => azureResponse(90) }));
    const expected = createHash('sha256').update(fixture.wav).digest('hex');
    assert.equal(result.report.entries[0].audioSha256, expected);
    assert.equal(result.report.entries[0].audioByteCount, fixture.wav.byteLength);
    assert.equal(result.report.entries[0].audioDurationMs, 100);
  } finally {
    await rm(fixture.fixtureRoot, { recursive: true, force: true });
  }
});

test('CLI requires explicit execution and both output paths', async () => {
  const parsed = parseSemanticQaArgs(['--json', 'report.json', '--csv', 'report.csv']);
  assert.equal(parsed.execute, false);
  await assert.rejects(
    () => semanticQaMain(['--json', 'report.json', '--csv', 'report.csv'], { env: {} }),
    /execute/i,
  );
  await assert.rejects(
    () => semanticQaMain(['--execute', '--json', 'report.json'], { env: {} }),
    /csv|output/i,
  );
});

test('credential loading gives process environment precedence and uses local/fallback dotenv files only for missing values', async () => {
  const roots = await mkdtemp(path.join(os.tmpdir(), 'echo-forge-semantic-env-'));
  const sandboxRoot = path.join(roots, 'sandbox');
  const primaryRoot = path.join(roots, 'primary');
  await mkdir(sandboxRoot, { recursive: true });
  await mkdir(primaryRoot, { recursive: true });
  try {
    await writeFile(path.join(sandboxRoot, '.env'), 'AZURE_SPEECH_KEY=local-key\nAZURE_SPEECH_REGION=local-region\n');
    await writeFile(path.join(primaryRoot, '.env'), 'AZURE_SPEECH_KEY=fallback-key\nAZURE_SPEECH_REGION=fallback-region\n');
    assert.deepEqual(await loadAzureCredentials({ env: {}, sandboxRoot, primaryRoot }), { key: 'local-key', region: 'local-region' });
    assert.deepEqual(await loadAzureCredentials({ env: { AZURE_SPEECH_KEY: 'process-key', AZURE_SPEECH_REGION: 'process-region' }, sandboxRoot, primaryRoot }), { key: 'process-key', region: 'process-region' });
    assert.deepEqual(await loadAzureCredentials({ env: { AZURE_SPEECH_KEY: 'process-key' }, sandboxRoot, primaryRoot }), { key: 'process-key', region: 'local-region' });
  } finally {
    await rm(roots, { recursive: true, force: true });
  }
});
