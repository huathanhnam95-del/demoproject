import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { validateBuiltCatalog } from './build-challenge-catalog.js';
import { createAnalysisClient } from '../../public/js/echo-forge/adapters/analysis-client.js';
import {
  createInitialCombatState,
  reduceCombat,
} from '../../public/js/echo-forge/core/combat-reducer.js';
import {
  createTimingTelemetry,
  evaluateTimingGate,
} from '../../public/js/echo-forge/adapters/timing-telemetry.js';

const LEVELS = Object.freeze(['A1', 'A2', 'B1', 'B2', 'C1']);
const MODES = Object.freeze({
  azureWord: Object.freeze({ evaluationMode: 'azure_word', unitType: 'word' }),
  azurePhrase: Object.freeze({ evaluationMode: 'azure_phrase', unitType: 'phrase' }),
  v3Word: Object.freeze({ evaluationMode: 'v3_word', unitType: 'word' }),
});
const DEFAULT_TTS_ENDPOINT = 'http://127.0.0.1:8880/v1/audio/speech';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_COUNTS = Object.freeze({ azureWord: 30, azurePhrase: 30, v3Word: 30, silence: 10 });
const MAX_COUNT_PER_MODE = 100;
const MAX_AUDIO_BYTES = 1024 * 1024;
const MAX_AUDIO_DURATION_MS = 15_000;
const SENTINEL_SIZE = 0xffffffff;
const CARD_BY_MODE = Object.freeze({
  azure_word: 'precision_strike',
  azure_phrase: 'echo_chain',
  v3_word: 'stress_breaker',
});

function nowDefault() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function ownString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function parseNonNegativeInteger(value, flag, { maximum = MAX_COUNT_PER_MODE } = {}) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > maximum) {
    throw new RangeError(`${flag} must be an integer from 0 to ${maximum}`);
  }
  return parsed;
}

function parsePositiveInteger(value, flag, maximum = 120_000) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new RangeError(`${flag} must be an integer from 1 to ${maximum}`);
  }
  return parsed;
}

function requireFlagValue(argv, index, flag) {
  const value = argv[index + 1];
  if (value == null || String(value).startsWith('--')) throw new TypeError(`${flag} requires a value`);
  return String(value);
}

function assertHttpUrl(value, flag) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError(`${flag} must be an absolute http(s) URL`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new TypeError(`${flag} must be an absolute http(s) URL`);
  }
  return value.replace(/\/+$/, '');
}

export function parseArgs(argv = []) {
  if (!Array.isArray(argv)) throw new TypeError('argv must be an array');
  const counts = { ...DEFAULT_COUNTS };
  const options = {
    execute: false,
    azureEndpoint: null,
    v3BaseUrl: null,
    ttsEndpoint: DEFAULT_TTS_ENDPOINT,
    catalogPath: null,
    jsonOutput: null,
    csvOutput: null,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    supportPreset: 'standard',
    silenceDurationMs: 1000,
    counts,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = String(argv[index]);
    if (flag === '--execute') {
      options.execute = true;
    } else if (flag === '--dry-run') {
      options.execute = false;
    } else if (flag === '--azure-endpoint') {
      options.azureEndpoint = assertHttpUrl(requireFlagValue(argv, index++, flag), flag);
    } else if (flag === '--v3-base-url') {
      options.v3BaseUrl = assertHttpUrl(requireFlagValue(argv, index++, flag), flag);
    } else if (flag === '--tts-endpoint') {
      options.ttsEndpoint = assertHttpUrl(requireFlagValue(argv, index++, flag), flag);
    } else if (flag === '--catalog') {
      options.catalogPath = requireFlagValue(argv, index++, flag);
    } else if (flag === '--json-output') {
      options.jsonOutput = requireFlagValue(argv, index++, flag);
    } else if (flag === '--csv-output') {
      options.csvOutput = requireFlagValue(argv, index++, flag);
    } else if (flag === '--timeout-ms') {
      options.timeoutMs = parsePositiveInteger(requireFlagValue(argv, index++, flag), flag);
    } else if (flag === '--support-preset') {
      options.supportPreset = requireFlagValue(argv, index++, flag);
      if (!['guided', 'standard', 'challenge'].includes(options.supportPreset)) {
        throw new RangeError('--support-preset must be guided, standard, or challenge');
      }
    } else if (flag === '--silence-duration-ms') {
      options.silenceDurationMs = parsePositiveInteger(requireFlagValue(argv, index++, flag), flag, MAX_AUDIO_DURATION_MS);
    } else if (flag === '--azure-word-count') {
      counts.azureWord = parseNonNegativeInteger(requireFlagValue(argv, index++, flag), flag);
    } else if (flag === '--azure-phrase-count') {
      counts.azurePhrase = parseNonNegativeInteger(requireFlagValue(argv, index++, flag), flag);
    } else if (flag === '--v3-word-count') {
      counts.v3Word = parseNonNegativeInteger(requireFlagValue(argv, index++, flag), flag);
    } else if (flag === '--silence-count') {
      counts.silence = parseNonNegativeInteger(requireFlagValue(argv, index++, flag), flag);
    } else {
      throw new TypeError(`unknown option: ${flag}`);
    }
  }

  if (options.execute) {
    const missing = [];
    if (!options.azureEndpoint) missing.push('--azure-endpoint');
    if (!options.v3BaseUrl) missing.push('--v3-base-url');
    if (!options.jsonOutput) missing.push('--json-output');
    if (!options.csvOutput) missing.push('--csv-output');
    if (missing.length) throw new TypeError(`--execute requires ${missing.join(', ')}`);
  }
  return Object.freeze({ ...options, counts: Object.freeze({ ...counts }) });
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

function readUint32(view, offset) {
  if (offset < 0 || offset + 4 > view.byteLength) throw new Error('WAV chunk header is truncated');
  return view.getUint32(offset, true);
}

function readUint16(view, offset) {
  if (offset < 0 || offset + 2 > view.byteLength) throw new Error('WAV format chunk is truncated');
  return view.getUint16(offset, true);
}

function scanWav(bytes, { allowSentinels = false } = {}) {
  if (bytes.byteLength < 44) throw new Error('WAV is shorter than a RIFF header');
  if (ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 12) !== 'WAVE') throw new Error('WAV must contain RIFF/WAVE headers');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const riffSize = readUint32(view, 4);
  if (riffSize !== SENTINEL_SIZE && riffSize + 8 !== bytes.byteLength) throw new Error('WAV RIFF size does not match the response');

  let format = null;
  let data = null;
  for (let offset = 12; offset < bytes.byteLength;) {
    if (offset + 8 > bytes.byteLength) throw new Error('WAV chunk header is truncated');
    const chunkId = ascii(bytes, offset, offset + 4);
    const chunkSize = readUint32(view, offset + 4);
    const chunkStart = offset + 8;
    if (chunkId === 'data' && chunkSize === SENTINEL_SIZE && allowSentinels) {
      if (data) throw new Error('WAV contains duplicate data chunks');
      const remainingBytes = bytes.byteLength - chunkStart;
      if (remainingBytes <= 0) throw new Error('WAV data chunk is empty');
      data = { headerOffset: offset, start: chunkStart, size: remainingBytes, sentinel: true };
      break;
    }
    const chunkEnd = chunkStart + chunkSize;
    const paddedEnd = chunkEnd + (chunkSize % 2);
    if (chunkEnd > bytes.byteLength || paddedEnd > bytes.byteLength) throw new Error('WAV chunk exceeds response bounds');
    if (chunkId === 'fmt ') {
      if (chunkSize < 16) throw new Error('WAV format chunk is too small');
      format = {
        audioFormat: readUint16(view, chunkStart),
        channels: readUint16(view, chunkStart + 2),
        sampleRate: readUint32(view, chunkStart + 4),
        byteRate: readUint32(view, chunkStart + 8),
        blockAlign: readUint16(view, chunkStart + 12),
        bitsPerSample: readUint16(view, chunkStart + 14),
      };
    } else if (chunkId === 'data') {
      if (data) throw new Error('WAV contains duplicate data chunks');
      data = { headerOffset: offset, start: chunkStart, size: chunkSize, sentinel: false };
    }
    offset = paddedEnd;
  }
  if (!format || !data || data.size <= 0) throw new Error('WAV must contain non-empty fmt and data chunks');
  if (data.start + data.size > bytes.byteLength) throw new Error('WAV data exceeds response bounds');
  return { view, riffSize, format, data };
}

export function validateWav(input) {
  const bytes = asBytes(input);
  if (bytes.byteLength > MAX_AUDIO_BYTES) throw new RangeError('WAV exceeds the 1 MiB limit');
  const { format, data } = scanWav(bytes);
  if (format.audioFormat !== 1 || format.channels !== 1 || format.bitsPerSample !== 16) {
    throw new TypeError('WAV must be mono PCM16');
  }
  if (!Number.isInteger(format.sampleRate) || format.sampleRate < 8000 || format.sampleRate > 48000) {
    throw new RangeError('WAV sample rate is outside the supported range');
  }
  if (format.blockAlign !== 2 || format.byteRate !== format.sampleRate * 2 || data.size % format.blockAlign !== 0) {
    throw new TypeError('WAV format has incoherent PCM byte rates');
  }
  const audioDurationMs = data.size / format.byteRate * 1000;
  if (!Number.isFinite(audioDurationMs) || audioDurationMs <= 0 || audioDurationMs > MAX_AUDIO_DURATION_MS) {
    throw new RangeError('WAV duration must be greater than 0 and at most 15 seconds');
  }
  return Object.freeze({
    sampleRate: format.sampleRate,
    audioDurationMs,
    audioByteCount: bytes.byteLength,
  });
}

export function finalizeStreamingWav(input) {
  const source = asBytes(input);
  if (source.byteLength > MAX_AUDIO_BYTES) throw new RangeError('WAV exceeds the 1 MiB limit');
  const bytes = new Uint8Array(source);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 44 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 12) !== 'WAVE') {
    throw new Error('TTS did not return a RIFF/WAVE response');
  }
  const riffSize = readUint32(view, 4);
  const scanned = scanWav(bytes, { allowSentinels: true });
  if (riffSize === SENTINEL_SIZE) view.setUint32(4, bytes.byteLength - 8, true);
  if (scanned.data.sentinel) view.setUint32(scanned.data.headerOffset + 4, scanned.data.size, true);
  validateWav(bytes);
  return bytes;
}

export function createSilenceWav(durationMs = 1000, sampleRate = 16_000) {
  if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > MAX_AUDIO_DURATION_MS) {
    throw new RangeError('silence duration must be greater than 0 and at most 15 seconds');
  }
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 48000) {
    throw new RangeError('silence sample rate is outside the supported range');
  }
  const sampleCount = Math.max(1, Math.round(sampleRate * durationMs / 1000));
  const dataSize = sampleCount * 2;
  const bytes = new Uint8Array(44 + dataSize);
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode('RIFF'), 0);
  view.setUint32(4, bytes.byteLength - 8, true);
  bytes.set(new TextEncoder().encode('WAVEfmt '), 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  bytes.set(new TextEncoder().encode('data'), 36);
  view.setUint32(40, dataSize, true);
  return bytes;
}

function normalizedCounts(input) {
  const counts = input?.counts || input || {};
  return Object.freeze(Object.fromEntries(Object.keys(DEFAULT_COUNTS).map((key) => {
    const value = counts[key] == null ? DEFAULT_COUNTS[key] : counts[key];
    return [key, parseNonNegativeInteger(value, `counts.${key}`)];
  })));
}

function selectChallenges(catalog, mode, count) {
  const candidates = catalog.challenges
    .filter((challenge) => LEVELS.includes(challenge.level)
      && challenge.evaluationMode === mode.evaluationMode
      && challenge.unitType === mode.unitType)
    .sort((a, b) => a.challengeId.localeCompare(b.challengeId));
  if (count > 0 && candidates.length === 0) throw new RangeError(`catalog has no ${mode.evaluationMode} ${mode.unitType} challenges in A1-C1`);
  return Array.from({ length: count }, (_, index) => candidates[index % candidates.length]);
}

function toPlanItem(challenge, supportPreset, silence = false) {
  return Object.freeze({
    challenge,
    challengeId: challenge.challengeId,
    evaluationMode: challenge.evaluationMode,
    selectedLevel: challenge.level,
    supportPreset,
    silence,
  });
}

export function buildTimingPlan(catalog, options = {}) {
  validateBuiltCatalog(catalog);
  const supportPreset = options.supportPreset || 'standard';
  if (!['guided', 'standard', 'challenge'].includes(supportPreset)) throw new RangeError('supportPreset is invalid');
  const counts = normalizedCounts(options);
  const plan = [];
  for (const [key, mode] of Object.entries(MODES)) {
    plan.push(...selectChallenges(catalog, mode, counts[key]).map((challenge) => toPlanItem(challenge, supportPreset)));
  }
  plan.push(...selectChallenges(catalog, MODES.azureWord, counts.silence)
    .map((challenge) => toPlanItem(challenge, supportPreset, true)));
  return Object.freeze(plan);
}

export function measureReducerResolution({
  task,
  analysis,
  clock = nowDefault,
  reducer = reduceCombat,
  initialStateFactory = createInitialCombatState,
} = {}) {
  if (typeof clock !== 'function') throw new TypeError('reducer timing clock is required');
  if (typeof reducer !== 'function') throw new TypeError('combat reducer is required');
  if (typeof initialStateFactory !== 'function') throw new TypeError('combat state factory is required');
  const evaluationMode = task?.evaluationMode || task?.challenge?.evaluationMode;
  const level = task?.selectedLevel || task?.challenge?.level;
  const cardId = CARD_BY_MODE[evaluationMode];
  if (!cardId) throw new RangeError(`no combat card is mapped to ${evaluationMode}`);
  const setupState = initialStateFactory({ level });
  const startedState = reducer(setupState, { type: 'START_COMBAT' }).state;
  const startedAt = clock();
  const resolved = reducer(startedState, {
    type: 'RESOLVE_PLAYER_ATTACK',
    cardId,
    analysis,
  });
  const endedAt = clock();
  const durationMs = Number.isFinite(startedAt) && Number.isFinite(endedAt)
    ? Math.max(0, endedAt - startedAt)
    : 0;
  return Object.freeze({ durationMs, stateBefore: startedState, stateAfter: resolved.state });
}

function createTimeoutFetch(fetchImpl, timeoutMs) {
  return async (input, init = {}) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const externalSignal = init.signal;
    const abortFromExternal = () => controller.abort(externalSignal.reason);
    if (externalSignal?.aborted) abortFromExternal();
    else externalSignal?.addEventListener('abort', abortFromExternal, { once: true });
    try {
      return await fetchImpl(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener('abort', abortFromExternal);
    }
  };
}

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function fetchTtsWav(fetchImpl, endpoint, challenge, voiceId, timeoutMs) {
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'audio/wav' },
      body: JSON.stringify({ input: challenge.text, voice: voiceId, response_format: 'wav' }),
    });
  } catch (error) {
    throw codedError('TTS_REQUEST_FAILED', error?.name === 'AbortError' ? 'TTS request timed out' : 'TTS request failed');
  }
  if (!response?.ok) {
    const status = Number(response?.status);
    if ([400, 406, 415].includes(status)) throw codedError('TTS_WAV_UNSUPPORTED', 'TTS endpoint does not support response_format wav');
    throw codedError('TTS_REQUEST_FAILED', 'TTS endpoint was unavailable');
  }
  const contentType = response.headers?.get?.('content-type')?.toLowerCase() || '';
  if (contentType && !/(?:audio|application)\/(?:x-)?wav(?:\s*;|$)/.test(contentType)) {
    throw codedError('TTS_WAV_UNSUPPORTED', 'TTS endpoint returned a non-WAV format; no transcoding is performed');
  }
  let bytes;
  try {
    bytes = new Uint8Array(await response.arrayBuffer());
    const finalized = finalizeStreamingWav(bytes);
    const metadata = validateWav(finalized);
    return { blob: new Blob([finalized], { type: 'audio/wav' }), metadata };
  } catch (error) {
    if (error?.code === 'TTS_WAV_UNSUPPORTED') throw error;
    throw codedError('TTS_WAV_UNSUPPORTED', 'TTS endpoint did not return a supported RIFF/WAVE PCM16 response');
  }
}

function safeAnalysisRecord(task, metadata, prewarmDurationMs, reducerResolutionDurationMs, result) {
  const analysis = result.analysis;
  const timing = result.timing;
  return {
    challengeId: task.challengeId,
    evaluationMode: task.evaluationMode,
    selectedLevel: task.selectedLevel,
    supportPreset: task.supportPreset,
    audioDurationMs: metadata.audioDurationMs,
    audioByteCount: metadata.audioByteCount,
    prewarmDurationMs,
    requestDurationMs: timing.requestDurationMs,
    responseDurationMs: timing.responseDurationMs,
    normalizationDurationMs: timing.normalizationDurationMs,
    reducerResolutionDurationMs,
    outcome: analysis.status,
    httpCode: timing.httpCode,
    errorCode: timing.errorCode,
    retryOrdinal: 0,
  };
}

function defaultCatalogPath() {
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(scriptDirectory, '..', '..', 'public', 'database', 'echo-forge', 'challenges.v1.json');
}

async function loadCatalog(catalogPath) {
  const value = JSON.parse(await readFile(catalogPath || defaultCatalogPath(), 'utf8'));
  validateBuiltCatalog(value);
  return value;
}

export async function collectTimingEvidence(options = {}, dependencies = {}) {
  if (!isObject(options)) throw new TypeError('collector options must be an object');
  const execute = options.execute === true;
  const catalog = options.catalog || await loadCatalog(options.catalogPath);
  const plan = buildTimingPlan(catalog, options);
  if (!execute) {
    return Object.freeze({
      dryRun: true,
      plan,
      records: Object.freeze([]),
      timingGate: evaluateTimingGate([]),
      json: null,
      csv: null,
    });
  }

  const azureEndpoint = ownString(options.azureEndpoint);
  const v3BaseUrl = ownString(options.v3BaseUrl);
  const jsonOutput = ownString(options.jsonOutput);
  const csvOutput = ownString(options.csvOutput);
  if (!azureEndpoint || !v3BaseUrl || !jsonOutput || !csvOutput) {
    throw new TypeError('--execute requires azureEndpoint, v3BaseUrl, jsonOutput, and csvOutput');
  }
  const fetchImpl = dependencies.fetchImpl || options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required for execute mode');
  const timeoutMs = options.timeoutMs == null ? DEFAULT_TIMEOUT_MS : parsePositiveInteger(options.timeoutMs, 'timeoutMs');
  const timedFetch = createTimeoutFetch(fetchImpl, timeoutMs);
  const timingClock = dependencies.clock || options.clock || nowDefault;
  const analysisClient = createAnalysisClient({
    fetchImpl: timedFetch,
    azureEndpoint,
    v3BaseUrl,
    clock: timingClock,
  });
  const telemetry = createTimingTelemetry();
  const voiceId = catalog.challenges.find((challenge) => challenge.audio?.voiceId)?.audio.voiceId || 'af_heart';
  const ttsEndpoint = options.ttsEndpoint || DEFAULT_TTS_ENDPOINT;
  const prewarm = plan.some((task) => task.evaluationMode === 'v3_word')
    ? await analysisClient.prewarmV3()
    : { durationMs: 0 };
  const prewarmDurationMs = Number.isFinite(prewarm.durationMs) ? Math.max(0, prewarm.durationMs) : 0;
  let prewarmRecorded = false;

  for (const task of plan) {
    let audio;
    if (task.silence) {
      const silence = createSilenceWav(options.silenceDurationMs || 1000);
      audio = { blob: new Blob([silence], { type: 'audio/wav' }), metadata: validateWav(silence) };
    } else {
      try {
        audio = await fetchTtsWav(timedFetch, ttsEndpoint, task.challenge, voiceId, timeoutMs);
      } catch (error) {
        if (error?.code === 'TTS_WAV_UNSUPPORTED') throw error;
        const silence = createSilenceWav(options.silenceDurationMs || 1000);
        audio = { blob: new Blob([silence], { type: 'audio/wav' }), metadata: validateWav(silence) };
      }
    }
    const result = await analysisClient.analyze({ blob: audio.blob, challenge: task.challenge });
    const reducerTiming = measureReducerResolution({ task, analysis: result.analysis, clock: timingClock });
    const recordPrewarmDurationMs = task.evaluationMode === 'v3_word' && !prewarmRecorded
      ? prewarmDurationMs
      : 0;
    if (task.evaluationMode === 'v3_word') prewarmRecorded = true;
    telemetry.record(safeAnalysisRecord(task, audio.metadata, recordPrewarmDurationMs, reducerTiming.durationMs, result));
  }

  const records = telemetry.snapshot();
  const json = telemetry.exportJson();
  const csv = telemetry.exportCsv();
  await mkdir(path.dirname(jsonOutput), { recursive: true });
  await writeFile(jsonOutput, `${json}\n`, 'utf8');
  await mkdir(path.dirname(csvOutput), { recursive: true });
  await writeFile(csvOutput, csv, 'utf8');
  return Object.freeze({
    dryRun: false,
    plan,
    records,
    timingGate: evaluateTimingGate(records),
    json,
    csv,
  });
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const options = parseArgs(argv);
  const result = await collectTimingEvidence(options, dependencies);
  if (result.dryRun) {
    process.stdout.write(`Echo Forge timing dry-run: ${result.plan.length} bounded attempts; no network calls or files written.\n`);
  } else {
    process.stdout.write(`Echo Forge timing collection complete: ${result.records.length} attempts; timing gate ready=${result.timingGate.ready}.\n`);
  }
  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => {
    process.stderr.write(`Echo Forge timing collection failed: ${error?.message || 'unknown error'}\n`);
    process.exitCode = 1;
  });
}
