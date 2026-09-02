import { createHash } from 'node:crypto';
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';

import { canonicalStringify, validateBuiltCatalog } from './build-challenge-catalog.js';
import {
  AUDIO_MANIFEST_SCHEMA,
  AUDIO_MANIFEST_VERSION,
  AUDIO_PROVIDER,
  validateAudioManifest,
  validateListeningWav,
  sha256Bytes,
} from './listening-audio-core.js';

export const SEMANTIC_QA_SCHEMA = 'echo-forge-listening-audio-semantic-qa-v1';
export const SEMANTIC_QA_VERSION = 'v1';
export const TOOL_REVISION = 'echo-forge-listening-audio-semantic-qa-v1';
export const ENGINE_REVISION = 'azure-speech-pronunciation-assessment-comprehensive-word-v1';
export const DEFAULT_THRESHOLD = 80;
export const DEFAULT_TIMEOUT_MS = 20_000;
export const LISTENING_COUNT = 30;
const WORKSPACE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const ALLOWED_STATUSES = new Set(['scored', 'below_threshold', 'unavailable', 'unrateable']);
const SAFE_REASON_CODES = new Set([
  null,
  'below_threshold',
  'http_error',
  'transport_error',
  'timeout',
  'invalid_response',
  'missing_accuracy_score',
]);
const FORBIDDEN_KEY = /(?:reference|transcript|recognized|payload|response|request|token|secret|credential|(?:api|subscription)[_-]?key|audio(?:bytes?|data|buffer)(?:$|[_-])|uid|email|url|raw|binary)/i;
const FORBIDDEN_VALUE = /https?:\/\/|data:audio|-----BEGIN|ocp-apim-subscription-key|\b(?:reference(?:text)?|transcript|recognized(?:text)?|nbest|payload|request(?:id)?|token|uid|email)\b/i;

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertSha256(value, label) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error(`${label} hash is invalid`);
  }
  return value.toLowerCase();
}

function assertThreshold(value) {
  const threshold = Number(value);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
    throw new RangeError('threshold must be between 0 and 100');
  }
  return threshold;
}

function jsonParse(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} JSON is invalid`);
  }
}

function sourceHash(source) {
  return createHash('sha256').update(canonicalStringify(source)).digest('hex');
}

function assertCatalogSourceBinding(catalog, source) {
  if (!isObject(source) || source.contentVersion !== catalog.contentVersion || source.locale !== catalog.locale) {
    throw new Error('catalog source binding is invalid');
  }
  if (sourceHash(source) !== catalog.sourceSha256) throw new Error('catalog source hash binding is invalid');
}

function listeningChallenges(catalog) {
  const challenges = catalog.challenges
    .filter((challenge) => challenge.challengeKind === 'listening' && challenge.unitType === 'listening')
    .sort((left, right) => left.challengeId.localeCompare(right.challengeId));
  if (challenges.length !== LISTENING_COUNT) throw new Error(`expected ${LISTENING_COUNT} listening challenges`);
  return challenges;
}

function safeAudioPath(audioRoot, manifestPath) {
  if (typeof manifestPath !== 'string' || !manifestPath.startsWith('/database/echo-forge/audio/')) {
    throw new Error('audio manifest path is invalid');
  }
  const root = path.resolve(audioRoot);
  const relative = manifestPath.replace(/^\/+/, '').split('/').join(path.sep);
  const filePath = path.resolve(root, relative);
  const outside = path.relative(root, filePath);
  if (outside.startsWith('..') || path.isAbsolute(outside)) throw new Error('audio manifest path escapes audio root');
  return filePath;
}

function compareManifestObjects(publicManifest, dataManifest) {
  if (canonicalStringify(publicManifest) !== canonicalStringify(dataManifest)) {
    throw new Error('public and data audio manifests differ');
  }
}

function compareAudioMetadata(actual, entry, challenge) {
  const expectedHash = assertSha256(entry.sha256, `${challenge.challengeId}.sha256`);
  if (actual.sha256 !== expectedHash) throw new Error(`audio hash mismatch for ${challenge.challengeId}`);
  if (actual.byteLength !== entry.byteLength || actual.durationMs !== entry.durationMs) {
    throw new Error(`audio metadata mismatch for ${challenge.challengeId}`);
  }
  return expectedHash;
}

async function loadFixture({ catalogPath, sourcePath, publicManifestPath, dataManifestPath, audioRoot }) {
  const [catalogText, sourceText, publicText, dataText] = await Promise.all([
    readFile(catalogPath, 'utf8'),
    readFile(sourcePath, 'utf8'),
    readFile(publicManifestPath, 'utf8'),
    readFile(dataManifestPath, 'utf8'),
  ]);
  const catalog = jsonParse(catalogText, 'catalog');
  const source = jsonParse(sourceText, 'source');
  const publicManifest = jsonParse(publicText, 'public audio manifest');
  const dataManifest = jsonParse(dataText, 'data audio manifest');
  validateBuiltCatalog(catalog);
  assertCatalogSourceBinding(catalog, source);
  compareManifestObjects(publicManifest, dataManifest);
  validateAudioManifest(publicManifest, catalog);
  if (publicManifest.schemaVersion !== AUDIO_MANIFEST_SCHEMA
    || publicManifest.audioVersion !== AUDIO_MANIFEST_VERSION
    || publicManifest.provider !== AUDIO_PROVIDER
    || publicManifest.contentVersion !== catalog.contentVersion
    || publicManifest.locale !== catalog.locale
    || publicManifest.catalogSourceSha256 !== catalog.sourceSha256
    || publicManifest.sourceSha256 !== catalog.sourceSha256) {
    throw new Error('audio manifest identity is invalid');
  }
  const challenges = listeningChallenges(catalog);
  const entries = [];
  for (let index = 0; index < challenges.length; index += 1) {
    const challenge = challenges[index];
    const entry = publicManifest.entries[index];
    const filePath = safeAudioPath(audioRoot, entry.path);
    let bytes;
    try {
      bytes = new Uint8Array(await readFile(filePath));
    } catch {
      throw new Error(`audio file is missing for ${challenge.challengeId}`);
    }
    let metadata;
    try {
      metadata = validateListeningWav(bytes);
    } catch {
      throw new Error(`audio WAV validation failed for ${challenge.challengeId}`);
    }
    const audioSha256 = compareAudioMetadata(metadata, entry, challenge);
    entries.push(Object.freeze({ challenge, entry, bytes, metadata, audioSha256 }));
  }
  return Object.freeze({ catalog, source, audioManifest: publicManifest, entries });
}

function buildAssessmentHeader(referenceText) {
  return Buffer.from(JSON.stringify({
    ReferenceText: referenceText,
    GradingSystem: 'HundredMark',
    Dimension: 'Comprehensive',
    Granularity: 'Word',
    EnableMiscue: true,
  })).toString('base64');
}

function scoreFromPayload(payload) {
  const best = payload?.NBest?.[0];
  const score = best?.PronunciationAssessment?.AccuracyScore ?? best?.AccuracyScore;
  if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 100) return null;
  return score;
}

async function assessAudio({ audioEntry, region, key, fetchImpl, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const url = `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=en-US&format=detailed`;
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'Content-Type': `audio/wav; codecs=audio/pcm; samplerate=${audioEntry.metadata.sampleRate}`,
        'Ocp-Apim-Subscription-Key': key,
        'Pronunciation-Assessment': buildAssessmentHeader(audioEntry.challenge.text),
      },
      body: new Uint8Array(audioEntry.bytes),
    });
    if (!response?.ok) return { score: null, status: 'unavailable', reasonCode: 'http_error' };
    let payload;
    try {
      if (typeof response.json === 'function') payload = await response.json();
      else if (typeof response.text === 'function') payload = jsonParse(await response.text(), 'Azure response');
      else return { score: null, status: 'unrateable', reasonCode: 'invalid_response' };
    } catch {
      return { score: null, status: 'unrateable', reasonCode: 'invalid_response' };
    }
    const score = scoreFromPayload(payload);
    if (score === null) return { score: null, status: 'unrateable', reasonCode: 'missing_accuracy_score' };
    return { score, status: 'scored', reasonCode: null };
  } catch (error) {
    return { score: null, status: 'unavailable', reasonCode: error?.name === 'AbortError' ? 'timeout' : 'transport_error' };
  } finally {
    clearTimeout(timer);
  }
}

function percentile(values, percentage) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = (sorted.length - 1) * percentage;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function makeSummary(entries) {
  const scores = entries.map((entry) => entry.accuracyScore).filter((score) => typeof score === 'number');
  return {
    count: entries.length,
    min: scores.length ? Math.min(...scores) : null,
    p50: percentile(scores, 0.50),
    p75: percentile(scores, 0.75),
    p90: percentile(scores, 0.90),
    p95: percentile(scores, 0.95),
    max: scores.length ? Math.max(...scores) : null,
    passCount: 0,
    failCount: 0,
    unavailable: entries.filter((entry) => entry.status === 'unavailable').length,
    unrateable: entries.filter((entry) => entry.status === 'unrateable').length,
  };
}

function exactKeys(value, keys, label) {
  if (!isObject(value) || Object.keys(value).sort().join('\u0000') !== [...keys].sort().join('\u0000')) {
    throw new Error(`${label} contains an unapproved field`);
  }
}

function assertReportShape(report) {
  exactKeys(report, [
    'schemaVersion', 'reportVersion', 'reviewStatus', 'catalog', 'audio', 'generatedAt',
    'toolRevision', 'engineRevision', 'threshold', 'summary', 'entries',
  ], 'report');
  exactKeys(report.catalog, ['schemaVersion', 'contentVersion', 'locale', 'sourceSha256'], 'catalog evidence');
  exactKeys(report.audio, [
    'schemaVersion', 'audioVersion', 'contentVersion', 'locale', 'catalogSourceSha256', 'sourceSha256',
    'provider', 'providerRevision', 'generatorRevision', 'generatedAt', 'modelSha256', 'voiceSha256',
  ], 'audio evidence');
  exactKeys(report.summary, [
    'count', 'min', 'p50', 'p75', 'p90', 'p95', 'max', 'passCount', 'failCount', 'unavailable', 'unrateable',
  ], 'summary');
  for (const entry of report.entries) {
    exactKeys(entry, [
      'challengeId', 'audioSha256', 'accuracyScore', 'status', 'reasonCode', 'audioDurationMs', 'audioByteCount',
    ], 'entry');
    if (!ALLOWED_STATUSES.has(entry.status) || !SAFE_REASON_CODES.has(entry.reasonCode)) throw new Error('report status is invalid');
  }
}

export function validatePrivacySafeOutput(value) {
  const visit = (node, parentKey = '') => {
    if (typeof node === 'string' && FORBIDDEN_VALUE.test(node)) {
      throw new Error(`privacy denylist rejected ${parentKey || 'value'}`);
    }
    if (Array.isArray(node)) {
      for (const item of node) visit(item, parentKey);
      return;
    }
    if (!isObject(node)) return;
    for (const [key, child] of Object.entries(node)) {
      if (FORBIDDEN_KEY.test(key)) throw new Error(`privacy denylist rejected ${key}`);
      visit(child, key);
    }
  };
  visit(value);
  return true;
}

function csvCell(value) {
  if (value == null) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function buildCsv(report) {
  const headers = [
    'schemaVersion', 'reportVersion', 'reviewStatus', 'catalogSchemaVersion', 'catalogContentVersion',
    'catalogLocale', 'catalogSourceSha256', 'audioSchemaVersion', 'audioVersion', 'audioContentVersion',
    'audioLocale', 'audioCatalogSourceSha256', 'audioSourceSha256', 'audioProvider', 'audioProviderRevision',
    'audioGeneratorRevision', 'audioGeneratedAt', 'generatedAt', 'toolRevision', 'engineRevision', 'threshold',
    'summaryCount', 'summaryMin', 'summaryP50', 'summaryP75', 'summaryP90', 'summaryP95', 'summaryMax',
    'summaryPassCount', 'summaryFailCount', 'summaryUnavailable', 'summaryUnrateable', 'challengeId',
    'audioSha256', 'accuracyScore', 'status', 'reasonCode', 'audioDurationMs', 'audioByteCount',
  ];
  const rows = report.entries.map((entry) => [
    report.schemaVersion, report.reportVersion, report.reviewStatus, report.catalog.schemaVersion,
    report.catalog.contentVersion, report.catalog.locale, report.catalog.sourceSha256, report.audio.schemaVersion,
    report.audio.audioVersion, report.audio.contentVersion, report.audio.locale, report.audio.catalogSourceSha256,
    report.audio.sourceSha256, report.audio.provider, report.audio.providerRevision, report.audio.generatorRevision,
    report.audio.generatedAt, report.generatedAt, report.toolRevision, report.engineRevision, report.threshold,
    report.summary.count, report.summary.min, report.summary.p50, report.summary.p75, report.summary.p90,
    report.summary.p95, report.summary.max, report.summary.passCount, report.summary.failCount,
    report.summary.unavailable, report.summary.unrateable, entry.challengeId, entry.audioSha256,
    entry.accuracyScore, entry.status, entry.reasonCode, entry.audioDurationMs, entry.audioByteCount,
  ]);
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\n') + '\n';
  validatePrivacySafeOutput({ headers, rows });
  return csv;
}

async function atomicPairWrite(jsonPath, jsonBytes, csvPath, csvBytes) {
  if (typeof jsonPath !== 'string' || typeof csvPath !== 'string' || jsonPath === csvPath) {
    throw new TypeError('JSON and CSV output paths must be distinct');
  }
  const targets = [{ path: jsonPath, bytes: jsonBytes }, { path: csvPath, bytes: csvBytes }];
  const staged = [];
  const backups = new Map();
  const promoted = [];
  let complete = false;
  try {
    for (const target of targets) {
      await mkdir(path.dirname(target.path), { recursive: true });
      const stagePath = `${target.path}.semantic-qa-stage-${process.pid}-${Math.random().toString(16).slice(2)}`;
      await writeFile(stagePath, target.bytes);
      target.stagePath = stagePath;
      staged.push(stagePath);
    }
    for (const target of targets) {
      try {
        await access(target.path);
        const backupPath = `${target.path}.semantic-qa-backup-${process.pid}-${Math.random().toString(16).slice(2)}`;
        await rename(target.path, backupPath);
        backups.set(target.path, backupPath);
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
    for (const target of targets) {
      await rename(target.stagePath, target.path);
      promoted.push(target.path);
    }
    complete = true;
  } catch (error) {
    for (const target of [...promoted].reverse()) await rm(target, { force: true });
    for (const [targetPath, backupPath] of backups.entries()) {
      try { await rename(backupPath, targetPath); } catch { /* best effort rollback */ }
    }
    throw new Error('semantic QA output promotion failed');
  } finally {
    for (const stagePath of staged) await rm(stagePath, { force: true });
    if (complete) for (const backupPath of backups.values()) await rm(backupPath, { force: true });
  }
}

function checkCredentials(key, region) {
  if (typeof key !== 'string' || !key.trim() || typeof region !== 'string' || !region.trim()) {
    throw new Error('Azure credentials are unavailable');
  }
  return { key: key.trim(), region: region.trim() };
}

function safeEnvValue(env, name) {
  const value = env?.[name];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

async function readEnvFile(filePath) {
  try {
    return dotenv.parse(await readFile(filePath, 'utf8'));
  } catch {
    return {};
  }
}

export async function loadAzureCredentials({ env = process.env, sandboxRoot, primaryRoot } = {}) {
  const effectiveSandboxRoot = sandboxRoot || WORKSPACE_ROOT;
  const effectivePrimaryRoot = primaryRoot || path.resolve(effectiveSandboxRoot, '..', 'Cursor AI');
  let key = safeEnvValue(env, 'AZURE_SPEECH_KEY');
  let region = safeEnvValue(env, 'AZURE_SPEECH_REGION');
  if (!key || !region) {
    const local = await readEnvFile(path.join(effectiveSandboxRoot, '.env'));
    key ||= safeEnvValue(local, 'AZURE_SPEECH_KEY');
    region ||= safeEnvValue(local, 'AZURE_SPEECH_REGION');
  }
  if (!key || !region) {
    const fallback = await readEnvFile(path.join(effectivePrimaryRoot, '.env'));
    key ||= safeEnvValue(fallback, 'AZURE_SPEECH_KEY');
    region ||= safeEnvValue(fallback, 'AZURE_SPEECH_REGION');
  }
  return checkCredentials(key, region);
}

export async function runListeningAudioSemanticQa(options = {}) {
  const {
    catalogPath,
    sourcePath,
    publicManifestPath: publicManifestPathOption,
    manifestPath,
    dataManifestPath,
    audioRoot,
    key,
    region,
    threshold = DEFAULT_THRESHOLD,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchImpl = globalThis.fetch,
    jsonPath: jsonPathOption,
    csvPath: csvPathOption,
    jsonOutput,
    csvOutput,
    generatedAt = new Date().toISOString(),
  } = options;
  const publicManifestPath = publicManifestPathOption || manifestPath;
  const jsonPath = jsonPathOption || jsonOutput;
  const csvPath = csvPathOption || csvOutput;
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required');
  const safeThreshold = assertThreshold(threshold);
  const credentials = checkCredentials(key, region);
  const fixture = await loadFixture({ catalogPath, sourcePath, publicManifestPath, dataManifestPath, audioRoot });
  const reportEntries = [];
  let transportFailure = false;
  for (const entry of fixture.entries) {
    const outcome = await assessAudio({ audioEntry: entry, ...credentials, fetchImpl, timeoutMs });
    if (outcome.reasonCode === 'transport_error' || outcome.reasonCode === 'timeout') transportFailure = true;
    let status = outcome.status;
    let reasonCode = outcome.reasonCode;
    if (outcome.status === 'scored' && outcome.score < safeThreshold) {
      status = 'below_threshold';
      reasonCode = 'below_threshold';
    }
    reportEntries.push({
      challengeId: entry.challenge.challengeId,
      audioSha256: entry.audioSha256,
      accuracyScore: outcome.score,
      status,
      reasonCode,
      audioDurationMs: entry.metadata.durationMs,
      audioByteCount: entry.metadata.byteLength,
    });
  }
  if (transportFailure) throw new Error('Azure transport unavailable');
  const summary = makeSummary(reportEntries);
  summary.passCount = reportEntries.filter((entry) => entry.status === 'scored').length;
  summary.failCount = reportEntries.filter((entry) => entry.status === 'below_threshold').length;
  const report = {
    schemaVersion: SEMANTIC_QA_SCHEMA,
    reportVersion: SEMANTIC_QA_VERSION,
    reviewStatus: 'automated_only',
    catalog: {
      schemaVersion: fixture.catalog.schemaVersion,
      contentVersion: fixture.catalog.contentVersion,
      locale: fixture.catalog.locale,
      sourceSha256: fixture.catalog.sourceSha256,
    },
    audio: {
      schemaVersion: fixture.audioManifest.schemaVersion,
      audioVersion: fixture.audioManifest.audioVersion,
      contentVersion: fixture.audioManifest.contentVersion,
      locale: fixture.audioManifest.locale,
      catalogSourceSha256: fixture.audioManifest.catalogSourceSha256,
      sourceSha256: fixture.audioManifest.sourceSha256,
      provider: fixture.audioManifest.provider,
      providerRevision: fixture.audioManifest.providerRevision,
      generatorRevision: fixture.audioManifest.generatorRevision,
      generatedAt: fixture.audioManifest.generatedAt,
      modelSha256: fixture.audioManifest.model.sha256,
      voiceSha256: fixture.audioManifest.voice.sha256,
    },
    generatedAt,
    toolRevision: TOOL_REVISION,
    engineRevision: ENGINE_REVISION,
    threshold: safeThreshold,
    summary,
    entries: reportEntries,
  };
  assertReportShape(report);
  validatePrivacySafeOutput(report);
  const reportJson = `${JSON.stringify(report, null, 2)}\n`;
  const reportCsv = buildCsv(report);
  if (jsonPath || csvPath) await atomicPairWrite(jsonPath, reportJson, csvPath, reportCsv);
  return Object.freeze({ report: Object.freeze(report), passed: summary.failCount === 0 && summary.unavailable === 0 && summary.unrateable === 0 });
}
