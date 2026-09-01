import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildAudioManifest,
  generateListeningAudio,
  normalizeWavBytes,
  validateListeningWav,
} from '../../scripts/echo-forge/listening-audio-core.js';
import { parseArgs as parseAudioBuildArgs } from '../../scripts/echo-forge/build-listening-audio.js';

const catalog = JSON.parse(await readFile(new URL('../../public/database/echo-forge/challenges.v1.json', import.meta.url), 'utf8'));
const source = JSON.parse(await readFile(new URL('../../data/echo-forge/challenges.source.json', import.meta.url), 'utf8'));
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function sineWav({ sampleRate = 24_000, durationMs = 100, amplitude = 0.2, sentinel = false } = {}) {
  const sampleCount = Math.max(1, Math.round(sampleRate * durationMs / 1000));
  const dataSize = sampleCount * 2;
  const bytes = new Uint8Array(44 + dataSize);
  const view = new DataView(bytes.buffer);
  const encoder = new TextEncoder();
  bytes.set(encoder.encode('RIFF'), 0);
  view.setUint32(4, sentinel ? 0xffffffff : bytes.byteLength - 8, true);
  bytes.set(encoder.encode('WAVEfmt '), 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  bytes.set(encoder.encode('data'), 36);
  view.setUint32(40, sentinel ? 0xffffffff : dataSize, true);
  for (let index = 0; index < sampleCount; index += 1) {
    const sample = amplitude >= 1 ? 32767 : Math.round(Math.sin(index / 5) * amplitude * 32767);
    view.setInt16(44 + index * 2, sample, true);
  }
  return bytes;
}

function response(body, contentType = 'audio/wav') {
  return new Response(body, { status: 200, headers: { 'content-type': contentType } });
}

test('normalizes Kokoro sentinel lengths and validates shipped 24 kHz PCM16 bytes', () => {
  const normalized = normalizeWavBytes(sineWav({ sentinel: true }));
  const metadata = validateListeningWav(normalized);
  assert.equal(metadata.sampleRate, 24_000);
  assert.equal(metadata.channels, 1);
  assert.equal(metadata.bitsPerSample, 16);
  assert.equal(metadata.durationMs, 100);
  assert.ok(metadata.rms > 0.001);
  assert.equal(metadata.clippingRatio, 0);
  assert.match(metadata.sha256, /^[a-f0-9]{64}$/);
  assert.equal(metadata.sha256, createHash('sha256').update(normalized).digest('hex'));
  assert.notEqual(new DataView(normalized.buffer).getUint32(4, true), 0xffffffff);
  assert.notEqual(new DataView(normalized.buffer).getUint32(40, true), 0xffffffff);
});

test('strict listening WAV validation rejects wrong rate, silence, clipping, and oversized bytes', () => {
  assert.throws(() => validateListeningWav(sineWav({ sampleRate: 16_000 })), /24.?000/i);
  assert.throws(() => validateListeningWav(sineWav({ amplitude: 0 })), /RMS|silence/i);
  assert.throws(() => validateListeningWav(sineWav({ amplitude: 1 })), /clipping/i);
  assert.throws(() => validateListeningWav(new Uint8Array(1024 * 1024 + 1)), /1 MiB|size/i);
});

test('audio manifest is exactly the sorted listening catalog and binds source/content/identity', () => {
  const entries = catalog.challenges
    .filter((challenge) => challenge.unitType === 'listening')
    .sort((a, b) => a.challengeId.localeCompare(b.challengeId))
    .map((challenge, index) => ({
      challenge,
      sha256: `${String(index + 1).padStart(2, '0')}${'c'.repeat(62)}`,
      byteLength: 5000,
      durationMs: 100,
      rms: 0.2,
      clippingRatio: 0,
      artifactStatus: 'generated',
    }));
  const manifest = buildAudioManifest({ catalog, records: entries, modelSha256: HASH_A, voiceSha256: HASH_B });
  assert.equal(manifest.schemaVersion, 'echo-forge-audio-manifest-v1');
  assert.equal(manifest.entries.length, 30);
  assert.deepEqual(manifest.entries.map((entry) => entry.challengeId), [...manifest.entries].sort((a, b) => a.challengeId.localeCompare(b.challengeId)).map((entry) => entry.challengeId));
  assert.equal(manifest.catalogSourceSha256, catalog.sourceSha256);
  assert.equal(manifest.sourceSha256, catalog.sourceSha256);
  assert.equal(manifest.model.sha256, HASH_A);
  assert.equal(manifest.voice.sha256, HASH_B);
  assert.equal(manifest.providerRevision, 'kokoro-v1');
  assert.equal(manifest.generatorRevision, 'echo-forge-listening-audio-v1');
  assert.match(manifest.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
  for (const entry of manifest.entries) {
    const challenge = catalog.challenges.find((candidate) => candidate.challengeId === entry.challengeId);
    assert.equal(entry.contentHash, challenge.contentHash);
    assert.equal(entry.audioIdentitySha256, challenge.audio.identitySha256);
    assert.equal(entry.sourceId, challenge.provenance.sourceId);
    assert.equal(entry.status, 'verified');
    assert.equal(entry.reviewStatus, 'automated_verified');
    assert.equal(entry.reviewMethod, 'structural_audio_validation');
    assert.equal(entry.artifactStatus, 'generated');
    assert.match(entry.path, /^\/database\/echo-forge\/audio\/v1\/(a1|a2|b1|b2|c1)\/listening\/\d{3}\.wav$/);
  }
});

test('generator sends the exact Kokoro request, atomically writes 30 artifacts, reuses hashes, and rejects changed overwrites', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'echo-forge-audio-'));
  const manifestPath = path.join(root, 'audio-manifest.v1.json');
  const dataManifestPath = path.join(root, 'data/echo-forge/audio-manifest.v1.json');
  const audioRoot = path.join(root, 'public');
  const wav = sineWav();
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    return response(wav);
  };
  try {
    const first = await generateListeningAudio({
      catalog,
      source,
      audioRoot,
      manifestPath,
      dataManifestPath,
      ttsEndpoint: 'http://tts.test/v1/audio/speech',
      modelSha256: HASH_A,
      voiceSha256: HASH_B,
      fetchImpl,
    });
    assert.equal(first.manifest.entries.length, 30);
    const firstManifestText = await readFile(manifestPath, 'utf8');
    assert.deepEqual(JSON.parse(firstManifestText), JSON.parse(await readFile(dataManifestPath, 'utf8')));
    assert.equal(calls.length, 30);
    assert.deepEqual(JSON.parse(calls[0].options.body), {
      model: 'kokoro', input: 'ship', voice: 'af_heart', response_format: 'wav', speed: 1, stream: false, lang_code: 'a',
    });
    const firstPath = path.join(audioRoot, 'database/echo-forge/audio/v1/a1/listening/001.wav');
    assert.equal((await readFile(firstPath)).byteLength, wav.byteLength);

    calls.length = 0;
    const second = await generateListeningAudio({
      catalog,
      source,
      audioRoot,
      manifestPath,
      dataManifestPath,
      ttsEndpoint: 'http://tts.test/v1/audio/speech',
      modelSha256: HASH_A,
      voiceSha256: HASH_B,
      fetchImpl,
    });
    assert.equal(second.reusedCount, 30);
    assert.equal(calls.length, 0);
    assert.equal(await readFile(manifestPath, 'utf8'), firstManifestText);

    calls.length = 0;
    await (await import('node:fs/promises')).rm(manifestPath);
    await (await import('node:fs/promises')).rm(dataManifestPath);
    await assert.rejects(() => generateListeningAudio({
      catalog,
      source,
      audioRoot,
      manifestPath,
      dataManifestPath,
      ttsEndpoint: 'http://tts.test/v1/audio/speech',
      modelSha256: HASH_A,
      voiceSha256: HASH_B,
      fetchImpl: async () => response(sineWav({ amplitude: 0.3 })),
    }), /overwrite|different hash/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('generator refuses a different regenerated WAV when the manifest entry is still valid', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'echo-forge-audio-missing-'));
  const manifestPath = path.join(root, 'audio-manifest.v1.json');
  const dataManifestPath = path.join(root, 'data/echo-forge/audio-manifest.v1.json');
  const audioRoot = path.join(root, 'public');
  const baselineWav = sineWav({ amplitude: 0.2 });
  const differentWav = sineWav({ amplitude: 0.3 });
  try {
    const options = {
      catalog,
      source,
      audioRoot,
      manifestPath,
      dataManifestPath,
      ttsEndpoint: 'http://tts.test/v1/audio/speech',
      modelSha256: HASH_A,
      voiceSha256: HASH_B,
    };
    await generateListeningAudio({ ...options, fetchImpl: async () => response(baselineWav) });
    const beforePublic = await readFile(manifestPath);
    const beforeData = await readFile(dataManifestPath);
    const missingPath = path.join(audioRoot, 'database/echo-forge/audio/v1/a1/listening/001.wav');
    await rm(missingPath);

    await assert.rejects(
      () => generateListeningAudio({ ...options, fetchImpl: async () => response(differentWav) }),
      /manifest|different hash|refusing/i,
    );
    await assert.rejects(() => readFile(missingPath), { code: 'ENOENT' });
    assert.deepEqual(await readFile(manifestPath), beforePublic);
    assert.deepEqual(await readFile(dataManifestPath), beforeData);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('paired manifest promotion rolls back the first manifest when the public promotion fails', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'echo-forge-audio-pair-'));
  const manifestPath = path.join(root, 'audio-manifest.v1.json');
  const dataManifestPath = path.join(root, 'data/echo-forge/audio-manifest.v1.json');
  const audioRoot = path.join(root, 'public');
  const wav = sineWav();
  const options = {
    catalog,
    source,
    audioRoot,
    manifestPath,
    dataManifestPath,
    ttsEndpoint: 'http://tts.test/v1/audio/speech',
    modelSha256: HASH_A,
    voiceSha256: HASH_B,
    fetchImpl: async () => response(wav),
  };
  try {
    await generateListeningAudio(options);
    const beforePublic = await readFile(manifestPath);
    const beforeData = await readFile(dataManifestPath);
    const promoted = [];
    await assert.rejects(
      () => generateListeningAudio({
        ...options,
        beforeManifestPromote: async ({ targetPath }) => {
          promoted.push(targetPath);
          if (targetPath === manifestPath) throw new Error('injected second manifest promotion failure');
        },
      }),
      /injected second manifest promotion failure/,
    );
    assert.deepEqual(promoted, [dataManifestPath, manifestPath], 'data manifest must promote before the public runtime manifest');
    assert.deepEqual(await readFile(manifestPath), beforePublic);
    assert.deepEqual(await readFile(dataManifestPath), beforeData);

    await generateListeningAudio(options);
    assert.deepEqual(await readFile(manifestPath), await readFile(dataManifestPath));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('audio build defaults find Kokoro artifacts in the primary workspace when the sandbox omits them', () => {
  const parsed = parseAudioBuildArgs([]);
  assert.match(parsed.modelPath, /Cursor AI[\\/]Kokoro-FastAPI[\\/]api[\\/]src[\\/]models/i);
  assert.match(parsed.voicePath, /Cursor AI[\\/]Kokoro-FastAPI[\\/]api[\\/]src[\\/]voices/i);
});
