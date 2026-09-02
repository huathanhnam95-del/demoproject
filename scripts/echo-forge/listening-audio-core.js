import { createHash } from 'node:crypto';
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { canonicalStringify, validateBuiltCatalog } from './build-challenge-catalog.js';

export const AUDIO_MANIFEST_SCHEMA = 'echo-forge-audio-manifest-v1';
export const AUDIO_MANIFEST_VERSION = 'v1';
export const AUDIO_PROVIDER = 'kokoro';
export const AUDIO_MODEL = 'kokoro';
export const AUDIO_VOICE = 'af_heart';
export const AUDIO_SAMPLE_RATE = 24_000;
export const AUDIO_MAX_BYTES = 1024 * 1024;
export const AUDIO_MAX_DURATION_MS = 15_000;
export const AUDIO_TTS_ENDPOINT = 'http://127.0.0.1:8880/v1/audio/speech';
export const AUDIO_LICENSE = 'Apache-2.0';
export const GENERATOR_REVISION = 'echo-forge-listening-audio-v1';
export const PROVIDER_REVISION = 'kokoro-v1';
const RIFF_SENTINEL = 0xffffffff;
const LISTENING_COUNT = 30;

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  throw new TypeError('WAV input must be an ArrayBuffer or Uint8Array');
}

function ascii(bytes, start, end) {
  return String.fromCharCode(...bytes.slice(start, end));
}

function readU32(view, offset) {
  if (offset < 0 || offset + 4 > view.byteLength) throw new Error('WAV chunk header is truncated');
  return view.getUint32(offset, true);
}

function readU16(view, offset) {
  if (offset < 0 || offset + 2 > view.byteLength) throw new Error('WAV format chunk is truncated');
  return view.getUint16(offset, true);
}

function scanWav(input, { allowSentinels = false } = {}) {
  const bytes = asBytes(input);
  if (bytes.byteLength < 44) throw new Error('WAV is shorter than a RIFF header');
  if (ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 12) !== 'WAVE') {
    throw new Error('WAV must contain RIFF/WAVE headers');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const riffSize = readU32(view, 4);
  if (riffSize !== RIFF_SENTINEL && riffSize + 8 !== bytes.byteLength) {
    throw new Error('WAV RIFF size does not match the response');
  }

  let format = null;
  let data = null;
  for (let offset = 12; offset < bytes.byteLength;) {
    if (offset + 8 > bytes.byteLength) throw new Error('WAV chunk header is truncated');
    const chunkId = ascii(bytes, offset, offset + 4);
    const chunkSize = readU32(view, offset + 4);
    const chunkStart = offset + 8;
    if (chunkSize === RIFF_SENTINEL) {
      if (!allowSentinels || chunkId !== 'data' || data) {
        throw new Error('WAV contains an unsupported sentinel chunk length');
      }
      const remaining = bytes.byteLength - chunkStart;
      if (remaining <= 0) throw new Error('WAV data chunk is empty');
      data = { headerOffset: offset, start: chunkStart, size: remaining, sentinel: true };
      break;
    }
    const chunkEnd = chunkStart + chunkSize;
    const paddedEnd = chunkEnd + (chunkSize % 2);
    if (chunkEnd > bytes.byteLength || paddedEnd > bytes.byteLength) {
      throw new Error('WAV chunk exceeds response bounds');
    }
    if (chunkId === 'fmt ') {
      if (format) throw new Error('WAV contains duplicate fmt chunks');
      if (chunkSize < 16) throw new Error('WAV format chunk is too small');
      format = {
        audioFormat: readU16(view, chunkStart),
        channels: readU16(view, chunkStart + 2),
        sampleRate: readU32(view, chunkStart + 4),
        byteRate: readU32(view, chunkStart + 8),
        blockAlign: readU16(view, chunkStart + 12),
        bitsPerSample: readU16(view, chunkStart + 14),
      };
    } else if (chunkId === 'data') {
      if (data) throw new Error('WAV contains duplicate data chunks');
      data = { headerOffset: offset, start: chunkStart, size: chunkSize, sentinel: false };
    }
    offset = paddedEnd;
  }
  if (!format || !data || data.size <= 0) throw new Error('WAV must contain non-empty fmt and data chunks');
  if (data.start + data.size > bytes.byteLength) throw new Error('WAV data exceeds response bounds');
  return { bytes, view, riffSize, format, data };
}

export function sha256Bytes(input) {
  return createHash('sha256').update(asBytes(input)).digest('hex');
}

export function normalizeWavBytes(input) {
  const source = asBytes(input);
  if (source.byteLength > AUDIO_MAX_BYTES) throw new RangeError('WAV exceeds the 1 MiB limit');
  const bytes = new Uint8Array(source);
  const scanned = scanWav(bytes, { allowSentinels: true });
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (scanned.riffSize === RIFF_SENTINEL) view.setUint32(4, bytes.byteLength - 8, true);
  if (scanned.data.sentinel) view.setUint32(scanned.data.headerOffset + 4, scanned.data.size, true);
  validateListeningWav(bytes);
  return bytes;
}

export function validateListeningWav(input) {
  const bytes = asBytes(input);
  if (bytes.byteLength > AUDIO_MAX_BYTES) throw new RangeError('WAV exceeds the 1 MiB limit');
  const { format, data } = scanWav(bytes);
  if (format.audioFormat !== 1 || format.channels !== 1 || format.bitsPerSample !== 16) {
    throw new TypeError('WAV must be mono PCM16');
  }
  if (format.sampleRate !== AUDIO_SAMPLE_RATE) throw new RangeError('WAV sample rate must be 24000 Hz');
  if (format.blockAlign !== 2 || format.byteRate !== AUDIO_SAMPLE_RATE * 2 || data.size % 2 !== 0) {
    throw new TypeError('WAV format has incoherent PCM byte rates');
  }
  const sampleCount = data.size / 2;
  const durationMs = data.size / format.byteRate * 1000;
  if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > AUDIO_MAX_DURATION_MS) {
    throw new RangeError('WAV duration must be greater than 0 and at most 15 seconds');
  }
  const dataView = new DataView(bytes.buffer, bytes.byteOffset + data.start, data.size);
  let sumSquares = 0;
  let clippedSamples = 0;
  for (let index = 0; index < sampleCount; index += 1) {
    const sample = dataView.getInt16(index * 2, true);
    const normalized = sample / 32768;
    sumSquares += normalized * normalized;
    if (sample >= 32767 || sample <= -32768) clippedSamples += 1;
  }
  const rms = Math.sqrt(sumSquares / sampleCount);
  const clippingRatio = clippedSamples / sampleCount;
  if (rms <= 0.001) throw new RangeError('WAV RMS must be greater than 0.001');
  if (clippingRatio > 0.01) throw new RangeError('WAV clipping must be at most 1%');
  return Object.freeze({
    sampleRate: format.sampleRate,
    channels: format.channels,
    bitsPerSample: format.bitsPerSample,
    durationMs,
    audioDurationMs: durationMs,
    byteLength: bytes.byteLength,
    audioByteCount: bytes.byteLength,
    rms,
    clippingRatio,
    sha256: sha256Bytes(bytes),
  });
}

function assertSha256(value, label) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value)) {
    throw new TypeError(`${label} must be a 64-character SHA-256 hash`);
  }
  return value.toLowerCase();
}

function listeningChallenges(catalog) {
  validateBuiltCatalog(catalog);
  const challenges = catalog.challenges
    .filter((challenge) => challenge.challengeKind === 'listening' && challenge.unitType === 'listening')
    .sort((left, right) => left.challengeId.localeCompare(right.challengeId));
  if (challenges.length !== LISTENING_COUNT) {
    throw new RangeError(`audio manifest requires exactly ${LISTENING_COUNT} listening challenges`);
  }
  return challenges;
}

function assertCatalogSourceBinding(catalog, source) {
  if (!source) return;
  if (!isObject(source) || source.contentVersion !== catalog.contentVersion || source.locale !== catalog.locale) {
    throw new Error('catalog source content binding is invalid');
  }
  const sourceHash = createHash('sha256').update(canonicalStringify(source)).digest('hex');
  if (sourceHash !== catalog.sourceSha256) throw new Error('catalog source hash binding is invalid');
}

function audioPathFor(challenge) {
  const id = challenge.challengeId.slice(-3);
  const pathValue = `/database/echo-forge/audio/${AUDIO_MANIFEST_VERSION}/${challenge.level.toLowerCase()}/listening/${id}.wav`;
  if (!/^\/database\/echo-forge\/audio\/v1\/(a1|a2|b1|b2|c1)\/listening\/\d{3}\.wav$/.test(pathValue)) {
    throw new Error(`invalid audio path for ${challenge.challengeId}`);
  }
  return pathValue;
}

function recordForChallenge(record, challenge) {
  const entry = record?.challenge?.challengeId === challenge.challengeId ? record : { challenge, ...record };
  const sha256 = assertSha256(entry.sha256, `${challenge.challengeId}.sha256`);
  const byteLength = entry.byteLength ?? entry.audioByteCount;
  const durationMs = entry.durationMs ?? entry.audioDurationMs;
  if (!Number.isInteger(byteLength) || byteLength <= 0 || byteLength > AUDIO_MAX_BYTES) {
    throw new RangeError(`${challenge.challengeId}.byteLength is invalid`);
  }
  if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > AUDIO_MAX_DURATION_MS) {
    throw new RangeError(`${challenge.challengeId}.durationMs is invalid`);
  }
  if (!Number.isFinite(entry.rms) || entry.rms <= 0.001) throw new RangeError(`${challenge.challengeId}.rms is invalid`);
  if (!Number.isFinite(entry.clippingRatio) || entry.clippingRatio < 0 || entry.clippingRatio > 0.01) {
    throw new RangeError(`${challenge.challengeId}.clippingRatio is invalid`);
  }
  return {
    challengeId: challenge.challengeId,
    level: challenge.level,
    sourceId: challenge.provenance.sourceId,
    contentHash: challenge.contentHash,
    audioIdentitySha256: challenge.audio.identitySha256,
    path: audioPathFor(challenge),
    sha256,
    byteLength,
    durationMs,
    sampleRate: AUDIO_SAMPLE_RATE,
    channels: 1,
    bitsPerSample: 16,
    rms: entry.rms,
    clippingRatio: entry.clippingRatio,
    artifactStatus: 'generated',
    status: 'verified',
    reviewStatus: 'automated_verified',
    reviewMethod: 'structural_audio_validation',
  };
}

export function buildAudioManifest({ catalog, source, records, modelSha256, voiceSha256, generatedAt = new Date().toISOString() } = {}) {
  assertCatalogSourceBinding(catalog, source);
  if (typeof generatedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(generatedAt) || Number.isNaN(Date.parse(generatedAt))) throw new TypeError('generatedAt must be an ISO timestamp');
  const challenges = listeningChallenges(catalog);
  if (!Array.isArray(records) || records.length !== challenges.length) {
    throw new RangeError(`audio records must contain exactly ${challenges.length} entries`);
  }
  const recordsById = new Map(records.map((record) => [record?.challenge?.challengeId || record?.challengeId, record]));
  const entries = challenges.map((challenge) => recordForChallenge(recordsById.get(challenge.challengeId), challenge));
  return Object.freeze({
    schemaVersion: AUDIO_MANIFEST_SCHEMA,
    audioVersion: AUDIO_MANIFEST_VERSION,
    contentVersion: catalog.contentVersion,
    locale: catalog.locale,
    catalogSourceSha256: catalog.sourceSha256,
    sourceSha256: catalog.sourceSha256,
    provider: AUDIO_PROVIDER,
    providerRevision: PROVIDER_REVISION,
    generatorRevision: GENERATOR_REVISION,
    generatedAt,
    model: Object.freeze({ id: AUDIO_MODEL, sha256: assertSha256(modelSha256, 'modelSha256') }),
    voice: Object.freeze({ id: AUDIO_VOICE, sha256: assertSha256(voiceSha256, 'voiceSha256') }),
    modelSha256: assertSha256(modelSha256, 'modelSha256'),
    voiceSha256: assertSha256(voiceSha256, 'voiceSha256'),
    provenance: Object.freeze({
      provider: 'Kokoro',
      license: AUDIO_LICENSE,
      licenseUrl: 'https://github.com/remsky/Kokoro-FastAPI/blob/main/LICENSE',
      reviewStatus: 'automated_verified',
      reviewMethod: 'structural_audio_validation',
    }),
    entries: Object.freeze(entries.map((entry) => Object.freeze(entry))),
  });
}

export function validateAudioManifest(manifest, catalog) {
  if (!isObject(manifest) || manifest.schemaVersion !== AUDIO_MANIFEST_SCHEMA) {
    throw new TypeError('audio manifest schemaVersion is invalid');
  }
  if (manifest.audioVersion !== AUDIO_MANIFEST_VERSION || manifest.provider !== AUDIO_PROVIDER) {
    throw new TypeError('audio manifest version or provider is invalid');
  }
  if (manifest.providerRevision !== PROVIDER_REVISION || manifest.generatorRevision !== GENERATOR_REVISION
    || typeof manifest.generatedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(manifest.generatedAt) || Number.isNaN(Date.parse(manifest.generatedAt))) {
    throw new Error('audio manifest revision metadata is invalid');
  }
  if (manifest.contentVersion !== catalog.contentVersion || manifest.locale !== catalog.locale) {
    throw new Error('audio manifest content binding is invalid');
  }
  if (manifest.catalogSourceSha256 !== catalog.sourceSha256) throw new Error('audio manifest source binding is invalid');
  if (manifest.sourceSha256 != null && manifest.sourceSha256 !== catalog.sourceSha256) throw new Error('audio manifest source binding is invalid');
  assertSha256(manifest.model?.sha256, 'manifest.model.sha256');
  assertSha256(manifest.voice?.sha256, 'manifest.voice.sha256');
  if (manifest.model.id !== AUDIO_MODEL || manifest.voice.id !== AUDIO_VOICE) throw new Error('audio manifest model or voice is invalid');
  if (manifest.provenance?.license !== AUDIO_LICENSE) throw new Error('audio manifest provenance license is invalid');
  const challenges = listeningChallenges(catalog);
  if (!Array.isArray(manifest.entries) || manifest.entries.length !== challenges.length) throw new Error('audio manifest entry count is invalid');
  const expected = new Set(challenges.map((challenge) => challenge.challengeId));
  for (let index = 0; index < manifest.entries.length; index += 1) {
    const entry = manifest.entries[index];
    const challenge = challenges[index];
    if (!expected.has(entry?.challengeId) || entry.challengeId !== challenge.challengeId) throw new Error('audio manifest entries are not sorted');
    if (entry.contentHash !== challenge.contentHash || entry.audioIdentitySha256 !== challenge.audio.identitySha256 || entry.sourceId !== challenge.provenance.sourceId) {
      throw new Error(`audio manifest catalog identity binding failed for ${challenge.challengeId}`);
    }
    if (entry.path !== audioPathFor(challenge)) throw new Error(`audio manifest path is invalid for ${challenge.challengeId}`);
    assertSha256(entry.sha256, `${challenge.challengeId}.sha256`);
    if (entry.artifactStatus !== 'generated' || entry.status !== 'verified' || entry.reviewStatus !== 'automated_verified' || entry.reviewMethod !== 'structural_audio_validation') {
      throw new Error(`audio manifest status is invalid for ${challenge.challengeId}`);
    }
    recordForChallenge(entry, challenge);
  }
  return true;
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function writeAtomic(filePath, bytes) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, bytes);
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function stageFile(filePath, bytes) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${randomUUID()}.stage`;
  await writeFile(temporaryPath, bytes);
  return temporaryPath;
}

export async function promoteManifestPair({
  dataManifestPath,
  publicManifestPath,
  dataBytes,
  publicBytes,
  beforePromote,
} = {}) {
  if (typeof dataManifestPath !== 'string' || typeof publicManifestPath !== 'string' || dataManifestPath === publicManifestPath) {
    throw new TypeError('paired manifest paths must be distinct strings');
  }
  const targets = [
    { path: dataManifestPath, bytes: dataBytes },
    { path: publicManifestPath, bytes: publicBytes },
  ];
  const staged = [];
  const backups = new Map();
  const promoted = [];
  let complete = false;
  try {
    for (const target of targets) {
      target.stagePath = await stageFile(target.path, target.bytes);
      staged.push(target.stagePath);
    }
    for (const target of targets) {
      if (await fileExists(target.path)) {
        const backupPath = `${target.path}.${randomUUID()}.bak`;
        await rename(target.path, backupPath);
        backups.set(target.path, backupPath);
      }
    }
    for (const [index, target] of targets.entries()) {
      await beforePromote?.({ targetPath: target.path, index });
      await rename(target.stagePath, target.path);
      promoted.push(target);
    }
    complete = true;
  } catch (error) {
    for (const target of [...promoted].reverse()) await rm(target.path, { force: true });
    for (const target of [...targets].reverse()) {
      const backupPath = backups.get(target.path);
      if (backupPath && await fileExists(backupPath)) await rename(backupPath, target.path);
    }
    throw error;
  } finally {
    for (const temporaryPath of staged) await rm(temporaryPath, { force: true });
    if (complete) {
      for (const backupPath of backups.values()) await rm(backupPath, { force: true });
    }
  }
}

function relativeArtifactPath(entry) {
  return entry.path.replace(/^\//, '').split('/').join(path.sep);
}

async function loadExistingManifest(manifestPath, catalog) {
  if (!(await fileExists(manifestPath))) return null;
  const existing = JSON.parse(await readFile(manifestPath, 'utf8'));
  validateAudioManifest(existing, catalog);
  return existing;
}

async function fetchAudio(fetchImpl, endpoint, challenge) {
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'audio/wav' },
    body: JSON.stringify({
      model: AUDIO_MODEL,
      input: challenge.text,
      voice: AUDIO_VOICE,
      response_format: 'wav',
      speed: 1,
      stream: false,
      lang_code: 'a',
    }),
  });
  if (!response?.ok) throw new Error(`Kokoro request failed (${response?.status || 'unknown'})`);
  const contentType = response.headers?.get?.('content-type')?.toLowerCase() || '';
  if (contentType && !/(?:audio|application)\/(?:x-)?wav(?:\s*;|$)/.test(contentType)) {
    throw new Error('Kokoro response was not audio/wav');
  }
  const normalized = normalizeWavBytes(new Uint8Array(await response.arrayBuffer()));
  return { bytes: normalized, metadata: validateListeningWav(normalized) };
}

export async function generateListeningAudio(options = {}) {
  const {
    catalog,
    source,
    audioRoot,
    outputRoot,
    manifestPath,
    outputManifestPath,
    dataManifestPath,
    ttsEndpoint = AUDIO_TTS_ENDPOINT,
    fetchImpl = globalThis.fetch,
    modelSha256,
    voiceSha256,
    beforeManifestPromote,
  } = options;
  const effectiveAudioRoot = audioRoot || outputRoot || path.resolve(process.cwd(), 'public');
  const effectiveManifestPath = manifestPath || outputManifestPath || path.resolve(effectiveAudioRoot, 'database/echo-forge/audio-manifest.v1.json');
  const effectiveDataManifestPath = dataManifestPath || path.resolve(effectiveAudioRoot, '..', 'data/echo-forge/audio-manifest.v1.json');
  const challenges = listeningChallenges(catalog);
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required');
  const modelHash = assertSha256(modelSha256, 'modelSha256');
  const voiceHash = assertSha256(voiceSha256, 'voiceSha256');
  const existingPublicManifest = await loadExistingManifest(effectiveManifestPath, catalog);
  const existingDataManifest = await loadExistingManifest(effectiveDataManifestPath, catalog);
  if (existingPublicManifest && existingDataManifest
    && JSON.stringify(existingPublicManifest) !== JSON.stringify(existingDataManifest)) {
    throw new Error('public and data audio manifests differ; refusing to continue');
  }
  const existingManifest = existingPublicManifest || existingDataManifest;
  if (existingManifest && (existingManifest.model.sha256 !== modelHash || existingManifest.voice.sha256 !== voiceHash)) {
    throw new Error('existing audio manifest model or voice hash differs; refusing overwrite');
  }
  const existingEntries = new Map(existingManifest?.entries?.map((entry) => [entry.challengeId, entry]) || []);
  const records = [];
  const writes = [];
  let reusedCount = 0;
  for (const challenge of challenges) {
    const entry = existingEntries.get(challenge.challengeId);
    const filePath = path.resolve(effectiveAudioRoot, relativeArtifactPath({ path: audioPathFor(challenge) }));
    let audio;
    if (entry && (await fileExists(filePath))) {
      const existingBytes = new Uint8Array(await readFile(filePath));
      const metadata = validateListeningWav(existingBytes);
      if (metadata.sha256 !== entry.sha256) throw new Error(`existing audio has a different hash from its manifest; refusing overwrite for ${challenge.challengeId}`);
      audio = { bytes: existingBytes, metadata };
      reusedCount += 1;
    } else {
      audio = await fetchAudio(fetchImpl, ttsEndpoint, challenge);
      if (entry && audio.metadata.sha256 !== entry.sha256) {
        throw new Error(`different hash from the existing manifest for ${challenge.challengeId}; refusing regeneration`);
      }
      if (await fileExists(filePath)) {
        const existingHash = sha256Bytes(await readFile(filePath));
        if (existingHash !== audio.metadata.sha256) {
          throw new Error(`different hash for ${challenge.challengeId}; refusing overwrite`);
        }
      } else {
        writes.push({ filePath, bytes: audio.bytes });
      }
    }
    records.push({ challenge, ...audio.metadata });
  }
  const manifest = buildAudioManifest({
    catalog,
    source,
    records,
    modelSha256: modelHash,
    voiceSha256: voiceHash,
    generatedAt: existingManifest?.generatedAt,
  });
  validateAudioManifest(manifest, catalog);
  for (const write of writes) await writeAtomic(write.filePath, write.bytes);
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  await promoteManifestPair({
    dataManifestPath: effectiveDataManifestPath,
    publicManifestPath: effectiveManifestPath,
    dataBytes: manifestText,
    publicBytes: manifestText,
    beforePromote: beforeManifestPromote,
  });
  return Object.freeze({ manifest, generatedCount: writes.length, reusedCount });
}

export { audioPathFor, listeningChallenges };

export const validateWav = validateListeningWav;
export const finalizeStreamingWav = normalizeWavBytes;
export const buildListeningAudioManifest = buildAudioManifest;
export const generateListeningAudioManifest = generateListeningAudio;
