/* eslint-disable no-console */
// Download study corpus metadata/audio from an authenticated endpoint.
// Credentials are intentionally external: use SEGMENTATION_STUDY_TOKEN (or an
// equivalent token env var), or Google ADC for an identity token. Dry-run is
// the default and never writes audio or manifests.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { execFileSync } = require('child_process');
const { validateManifest } = require('../segmentation-study/sync-manifest');

const ROOT = path.resolve(__dirname, '../..');
const DEFAULT_API_BASE = process.env.SEGMENTATION_STUDY_API_BASE || 'https://us-central1-listening-tasks-3ae34.cloudfunctions.net';
const DEFAULT_AUDIO_DIR = path.join(ROOT, 'test-results/segmentation-study-v2/audio');
const DEFAULT_MANIFEST = path.join(ROOT, 'test-results/segmentation-study-v2/segmentation-study-export-v2.json');
const V2_SCHEMA_VERSION = 'segmentation-study-export-v2';
const V2_STUDY_VERSION = 'study-v2';
const V2_MANIFEST_VERSION = '2.0.0';
const V2_SAMPLE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const V2_TASK_ID_RE = /^segmentation-study-v2-\d{4}$/;

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const value = argv[index + 1];
    args[key] = value && !value.startsWith('--') ? value : true;
    if (args[key] !== true) index += 1;
  }
  return args;
}

function tokenFromEnvironment(env = process.env) {
  return env.SEGMENTATION_STUDY_TOKEN || env.SEGMENTATION_STUDY_BEARER_TOKEN || env.CORPUS_SYNC_TOKEN || env.FIREBASE_ID_TOKEN || null;
}

async function tokenFromAdc(apiBase, dependencies = {}) {
  if (dependencies.adcToken) return dependencies.adcToken;
  try {
    // google-auth-library is optional in the app root but available in many
    // Firebase/Cloud Run checkouts. Do not turn an ADC failure into a secret
    // or credential log.
    const { GoogleAuth } = require('google-auth-library');
    const auth = new GoogleAuth();
    const client = await auth.getIdTokenClient(apiBase);
    return client.idTokenProvider.fetchIdToken(apiBase);
  } catch (error) {
    try {
      return execFileSync('gcloud', ['auth', 'print-identity-token', `--audiences=${apiBase}`], { encoding: 'utf8' }).trim() || null;
    } catch (_) {
      throw new Error(`No bearer token supplied and Google ADC is unavailable: ${error.message}`);
    }
  }
}

async function resolveAuthToken(apiBase, dependencies = {}) {
  return tokenFromEnvironment(dependencies.env || process.env) || tokenFromAdc(apiBase, dependencies);
}

function endpoint(apiBase, studyVersion) {
  const base = String(apiBase || DEFAULT_API_BASE).replace(/\/+$/, '');
  return `${base}/api/admin/dev/segmentation-study/${encodeURIComponent(studyVersion)}/export`;
}

function sanitizeCaptureSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const blocked = new Set(['deviceid', 'groupid', 'device_id', 'group_id']);
  const clean = {};
  Object.entries(value).slice(0, 64).forEach(([key, item]) => {
    const normalized = String(key).trim();
    if (!normalized || blocked.has(normalized.toLowerCase())) return;
    if (typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item)) || typeof item === 'string') {
      clean[normalized] = typeof item === 'string' ? item.slice(0, 200) : item;
    }
  });
  return clean;
}

function normalizePromotionEligibility(...values) {
  const supplied = values.filter((value) => value !== undefined);
  if (supplied.some((value) => value === null || typeof value !== 'boolean')) return false;
  if (supplied.some((value) => value === false)) return false;
  return supplied.some((value) => value === true);
}

function automaticOrderFor(manifestSha256, taskId) {
  return sha256(`${manifestSha256}${taskId}`);
}

function automaticVersionOrderFor(manifestSha256, taskId) {
  const digest = automaticOrderFor(manifestSha256, taskId);
  return ['v2', 'v3', 'v4']
    .map((version, index) => ({ version, key: digest.slice(index * 16, (index + 1) * 16) }))
    .sort((left, right) => (left.key < right.key ? -1 : (left.key > right.key ? 1 : 0)))
    .map((item) => item.version);
}

function validateExposureProof(sample, manifestSha256, taskId) {
  const assisted = sample?.assistedMetadata;
  if (!assisted || typeof assisted !== 'object' || assisted.assisted !== true || assisted.annotationProtocol !== 'automatic-visible-assisted-v1') {
    throw new Error(`Refusing v2 sync: task ${taskId} requires explicit assisted metadata.`);
  }
  const automaticOrder = automaticOrderFor(manifestSha256, taskId);
  const automaticVersionOrder = automaticVersionOrderFor(manifestSha256, taskId);
  if (sample.automaticOrder !== automaticOrder || JSON.stringify(sample.automaticVersionOrder) !== JSON.stringify(automaticVersionOrder)) {
    throw new Error(`Refusing v2 sync: task ${taskId} has an invalid deterministic automatic exposure order.`);
  }
  const exposureLog = assisted.exposureLog;
  if (!Array.isArray(exposureLog) || exposureLog.length !== 3) throw new Error(`Refusing v2 sync: task ${taskId} requires exactly three exposure entries.`);
  exposureLog.forEach((entry, index) => {
    if (!entry || entry.version !== automaticVersionOrder[index] || entry.automaticOrder !== automaticOrder || typeof entry.viewedAt !== 'string' || !entry.viewedAt.trim() || !Number.isFinite(Date.parse(entry.viewedAt))) {
      throw new Error(`Refusing v2 sync: task ${taskId} has invalid exposure order, token, or timestamp.`);
    }
  });
  return { automaticOrder, automaticVersionOrder };
}

function flattenExportSample(item) {
  if (!item || typeof item !== 'object') return item;
  if (!item.sample || !item.task) return item;
  const sample = item.sample;
  const task = item.task;
  const review = item.activeReview || {};
  const rawCaptureSettings = sample.captureSettings || sample.getSettings || sample.audioCaptureSettings || item.captureSettings;
  const captureSettings = sanitizeCaptureSettings(rawCaptureSettings);
  const captureIdentity = {
    captureId: sample.captureId,
    capturedAt: sample.capturedAt || sample.createdAt,
    sessionId: sample.operatorSessionId || sample.sessionId
  };
  const hasCaptureIdentity = Object.values(captureIdentity).some((value) => value != null && value !== '');
  const captureMetadata = sample.captureMetadata || item.captureMetadata || (captureSettings && hasCaptureIdentity ? { ...captureSettings, ...captureIdentity } : undefined);
  const annotationProtocol = sample.annotationProtocol || item.annotationProtocol || review.annotationProtocol;
  const promotionEligible = normalizePromotionEligibility(item.promotionEligible, sample.promotionEligible, task.promotionEligible);
  return {
    ...sample,
    ...task,
    sampleId: sample.sampleId || sample.id || task.completedSampleId,
    id: sample.id || sample.sampleId || task.completedSampleId,
    studyId: sample.studyId || task.studyId || item.studyId,
    studyVersion: sample.studyVersion || task.studyVersion || item.studyVersion,
    manifestVersion: sample.manifestVersion || task.manifestVersion || item.manifestVersion,
    manifestSha256: sample.manifestSha256 || task.manifestSha256 || item.manifestSha256,
    automaticOrder: sample.automaticOrder || task.automaticOrder || item.automaticOrder,
    automaticVersionOrder: sample.automaticVersionOrder || task.automaticVersionOrder || item.automaticVersionOrder,
    targetWord: sample.targetWord || task.targetWord,
    referenceIpa: sample.referenceIpa || task.referenceIpa,
    referenceSyllableIpa: sample.referenceSyllableIpa || task.referenceSyllableIpa,
    referenceProvenance: sample.referenceProvenance || task.referenceProvenance,
    referenceLabelProvenance: sample.referenceLabelProvenance || task.referenceLabelProvenance,
    referenceDialect: sample.referenceDialect || task.referenceDialect || item.referenceDialect,
    referenceSource: sample.referenceSource || task.referenceSource || item.referenceSource,
    dialect: sample.dialect || task.dialect || item.dialect,
    labelProvenance: sample.labelProvenance || task.labelProvenance || sample.referenceLabelProvenance || task.referenceLabelProvenance || item.labelProvenance || item.referenceLabelProvenance,
    exceptionRationale: sample.exceptionRationale || task.exceptionRationale || item.exceptionRationale,
    manualSpans: sample.manualSpans || sample.manualSegments || review.manualSegments,
    versions: item.versions || sample.versions || sample.partitionVariants,
    sourceHash: sample.sourceHash || sample.audioSha256,
    audioSha256: sample.audioSha256 || sample.sourceHash,
    audioUrl: sample.audioUrl || item.audioUrl,
    captureEligibility: sample.captureEligibility ?? item.captureEligibility,
    captureMetadata,
    assistedMetadata: sample.assistedMetadata || item.assistedMetadata || review.assistedMetadata,
    annotationProtocol,
    promotionEligible,
    variantProvenance: sample.variantProvenance || item.variantProvenance,
    analysisRevision: sample.analysisRevision || item.analysisRevision
  };
}

function assertSafeSampleId(sampleId) {
  if (!V2_SAMPLE_ID_RE.test(String(sampleId || '')) || String(sampleId).includes('..')) {
    throw new Error(`Cloud corpus sampleId is unsafe: ${sampleId || '<missing>'}.`);
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]));
}

function checkedInV2Manifest() {
  const manifestPath = path.join(ROOT, 'scripts/data/segmentation-study-v2.json');
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    validateManifest(manifest, 'v2');
    if (manifest.studyId !== 'segmentation-study-v2' || manifest.version !== V2_MANIFEST_VERSION) throw new Error('manifest identity');
    const entriesByTaskId = new Map();
    manifest.entries.forEach((entry, index) => {
      const expectedTaskId = `segmentation-study-v2-${String(index + 1).padStart(4, '0')}`;
      if (entry.taskId !== expectedTaskId || entry.order !== index + 1 || entriesByTaskId.has(entry.taskId)) throw new Error('manifest task identity');
      entriesByTaskId.set(entry.taskId, entry);
    });
    return { manifest, entriesByTaskId };
  } catch (_) {
    // The primary sync must fail closed below when the frozen manifest is unavailable.
  }
  throw new Error('Refusing v2 sync: the checked-in frozen v2 manifest is unavailable or invalid.');
}

function validateV2Export(exportPayload, samples) {
  if (!exportPayload || typeof exportPayload !== 'object') throw new Error('Refusing v2 sync: export payload is missing.');
  if (exportPayload.schemaVersion !== V2_SCHEMA_VERSION || exportPayload.studyVersion !== V2_STUDY_VERSION || exportPayload.manifestVersion !== V2_MANIFEST_VERSION || !/^[0-9a-f]{64}$/.test(String(exportPayload.manifestSha256 || ''))) {
    throw new Error('Refusing v2 sync: schemaVersion, studyVersion, manifestVersion, and manifestSha256 must be genuine and complete.');
  }
  const frozen = checkedInV2Manifest();
  if (exportPayload.manifestSha256 !== frozen.manifest.manifestSha256) throw new Error('Refusing v2 sync: export manifestSha256 does not match the frozen v2 manifest.');
  if (!Array.isArray(samples) || samples.length !== 100) throw new Error('Refusing v2 sync: exact 100-sample cohort coverage is required.');
  const taskIds = new Set();
  const sampleIds = new Set();
  const sourceHashes = new Set();
  for (const sample of samples) {
    const taskId = String(sample.taskId || '');
    const sampleId = String(sample.sampleId || sample.id || '');
    const suppliedSourceHash = String(sample.sourceHash || '').toLowerCase();
    const suppliedAudioHash = String(sample.audioSha256 || '').toLowerCase();
    if (suppliedSourceHash && suppliedAudioHash && suppliedSourceHash !== suppliedAudioHash) throw new Error(`Refusing v2 sync: sourceHash and audioSha256 differ for ${sampleId || '<missing>'}.`);
    const sourceHash = suppliedSourceHash || suppliedAudioHash;
    if (!V2_TASK_ID_RE.test(taskId) || taskIds.has(taskId)) throw new Error(`Refusing v2 sync: invalid or duplicate taskId ${taskId || '<missing>'}.`);
    assertSafeSampleId(sampleId);
    if (sampleIds.has(sampleId)) throw new Error(`Refusing v2 sync: duplicate sampleId ${sampleId}.`);
    if (!/^[0-9a-f]{64}$/.test(sourceHash) || sourceHashes.has(sourceHash)) throw new Error(`Refusing v2 sync: invalid or duplicate source SHA for ${sampleId}.`);
    if (sample.speakerCohort !== 'segmentation-study-v2') throw new Error(`Refusing v2 sync: sample ${sampleId} is outside the exact cohort.`);
    const entry = frozen.entriesByTaskId.get(taskId);
    if (!entry) throw new Error(`Refusing v2 sync: task ${taskId} is not in the frozen v2 manifest.`);
    const exactFields = [
      ['studyId', sample.studyId, frozen.manifest.studyId],
      ['studyVersion', sample.studyVersion, V2_STUDY_VERSION],
      ['manifestVersion', sample.manifestVersion, frozen.manifest.version],
      ['manifestSha256', sample.manifestSha256, frozen.manifest.manifestSha256],
      ['targetWord', sample.targetWord, entry.targetWord],
      ['split', sample.split, entry.split],
      ['referenceIpa', sample.referenceIpa, entry.referenceIpa],
      ['targetSyllableCount', sample.targetSyllableCount, entry.targetSyllableCount],
      ['expectedObservedCount', sample.expectedObservedCount, entry.expectedObservedCount],
      ['referenceDialect', sample.referenceDialect, entry.referenceDialect],
      ['dialect', sample.dialect, entry.dialect],
      ['referenceSource', sample.referenceSource, entry.referenceSource],
      ['referenceLabelProvenance', sample.referenceLabelProvenance, entry.referenceLabelProvenance],
      ['labelProvenance', sample.labelProvenance, entry.labelProvenance],
      ['exceptionRationale', sample.exceptionRationale, entry.exceptionRationale]
    ];
    if (exactFields.some(([, actual, expected]) => actual !== expected)
      || JSON.stringify(canonicalJson(sample.referenceSyllableIpa)) !== JSON.stringify(canonicalJson(entry.referenceSyllableIpa))
      || JSON.stringify(canonicalJson(sample.referenceProvenance)) !== JSON.stringify(canonicalJson(entry.referenceProvenance))) {
      throw new Error(`Refusing v2 sync: task ${taskId} does not exactly match the frozen manifest fields.`);
    }
    const proof = validateExposureProof(sample, frozen.manifest.manifestSha256, taskId);
    // Re-persist the locally recomputed proof after validation; do not let a
    // remote representation become the source of truth for downstream files.
    sample.automaticOrder = proof.automaticOrder;
    sample.automaticVersionOrder = proof.automaticVersionOrder;
    taskIds.add(taskId);
    sampleIds.add(sampleId);
    sourceHashes.add(sourceHash);
  }
  if (taskIds.size !== 100) throw new Error('Refusing v2 sync: task IDs do not cover the exact 100-task cohort.');
  for (let index = 1; index <= 100; index += 1) {
    const expectedTaskId = `segmentation-study-v2-${String(index).padStart(4, '0')}`;
    if (!taskIds.has(expectedTaskId)) throw new Error(`Refusing v2 sync: missing exact cohort task ID ${expectedTaskId}.`);
  }
}

async function getJson(url, token, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch is required to sync a corpus.');
  const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
  const body = await response.json();
  if (!response.ok) throw new Error(`Cloud request failed (${response.status}): ${JSON.stringify(body)}`);
  return body;
}

function buildManifestEntry(sample, calculatedHash, studyVersion) {
  const wrapper = flattenExportSample(sample);
  const task = sample?.task || {};
  const review = sample?.activeReview || {};
  const promotionEligible = normalizePromotionEligibility(wrapper?.promotionEligible, sample?.promotionEligible, task?.promotionEligible);
  const targetSyllableCount = Number.isInteger(wrapper.targetSyllableCount) ? wrapper.targetSyllableCount : Number(wrapper.expectedObservedCount || task.targetSyllableCount || 0);
  if (!wrapper.targetWord && !task.targetWord || !targetSyllableCount) throw new Error('Cloud sample is missing targetWord or syllable count.');
  return {
    sampleId: wrapper.sampleId || wrapper.id,
    id: wrapper.sampleId || wrapper.id,
    taskId: wrapper.taskId || task.taskId,
    studyId: wrapper.studyId || task.studyId || null,
    studyVersion: wrapper.studyVersion || task.studyVersion || null,
    manifestVersion: wrapper.manifestVersion || task.manifestVersion || null,
    manifestSha256: wrapper.manifestSha256 || task.manifestSha256 || null,
    automaticOrder: wrapper.automaticOrder || task.automaticOrder || null,
    automaticVersionOrder: wrapper.automaticVersionOrder || task.automaticVersionOrder || null,
    targetWord: wrapper.targetWord || task.targetWord,
    speakerCohort: wrapper.speakerCohort || task.speakerCohort || (studyVersion === 'v2' ? 'segmentation-study-v2' : `segmentation-study-${studyVersion}`),
    split: wrapper.split || task.split || null,
    referenceIpa: wrapper.referenceIpa || task.referenceIpa || null,
    referenceSyllableIpa: Array.isArray(wrapper.referenceSyllableIpa) ? wrapper.referenceSyllableIpa : (Array.isArray(task.referenceSyllableIpa) ? task.referenceSyllableIpa : null),
    referenceProvenance: wrapper.referenceProvenance || task.referenceProvenance || null,
    referenceLabelProvenance: wrapper.referenceLabelProvenance || task.referenceLabelProvenance || null,
    referenceDialect: wrapper.referenceDialect || task.referenceDialect || null,
    referenceSource: wrapper.referenceSource || task.referenceSource || null,
    dialect: wrapper.dialect || task.dialect || null,
    labelProvenance: wrapper.labelProvenance || task.labelProvenance || wrapper.referenceLabelProvenance || task.referenceLabelProvenance || null,
    exceptionRationale: wrapper.exceptionRationale || task.exceptionRationale || null,
    expectedObservedCount: Number.isInteger(wrapper.expectedObservedCount) ? wrapper.expectedObservedCount : targetSyllableCount,
    targetSyllableCount,
    category: wrapper.category || 'clean',
    sourceHash: calculatedHash || wrapper.sourceHash || wrapper.audioSha256 || null,
    audioSha256: calculatedHash || wrapper.audioSha256 || wrapper.sourceHash || null,
    manualSpans: wrapper.manualSpans || wrapper.manualSegments || review.manualSegments || null,
    versions: wrapper.versions || wrapper.partitionVariants || null,
    variantProvenance: wrapper.variantProvenance || null,
    analysisRevision: wrapper.analysisRevision || null,
    certainty: wrapper.certainty || null,
    captureEligibility: wrapper.captureEligibility ?? null,
    captureMetadata: wrapper.captureMetadata || wrapper.captureSettings || null,
    annotationProtocol: wrapper.annotationProtocol || null,
    assistedMetadata: wrapper.assistedMetadata || null,
    historicalCompatibility: wrapper.historicalCompatibility || null,
    promotionEligible,
    substitutionUsed: wrapper.substitutionUsed || false
  };
}

async function syncCorpus(options = {}, dependencies = {}) {
  const studyVersion = String(options.studyVersion || 'v2').replace(/^study-/, '');
  const apiBase = options.apiBase || DEFAULT_API_BASE;
  const token = options.token || await resolveAuthToken(apiBase, dependencies);
  if (!token) throw new Error('A bearer token or Google ADC is required.');
  const payload = await getJson(endpoint(apiBase, studyVersion), token, dependencies.fetchImpl || globalThis.fetch);
  const exportPayload = payload && payload.data && typeof payload.data === 'object' ? payload.data : (payload || {});
  const rawSamples = Array.isArray(exportPayload.samples) ? exportPayload.samples : null;
  const samples = rawSamples ? rawSamples.map(flattenExportSample) : null;
  if (!Array.isArray(samples)) throw new Error('Cloud corpus response did not contain samples[].');
  if (studyVersion === 'v2') validateV2Export(exportPayload, samples);
  const audioDir = path.resolve(options.audioDir || DEFAULT_AUDIO_DIR);
  const manifestPath = path.resolve(options.manifest || DEFAULT_MANIFEST);
  const apply = options.apply === true;
  if (!apply) {
    return {
      mode: 'dry-run', schemaVersion: exportPayload.schemaVersion || null,
      studyVersion: exportPayload.studyVersion || `study-${studyVersion}`,
      manifestVersion: exportPayload.manifestVersion || null, manifestSha256: exportPayload.manifestSha256 || null,
      studyVersionKey: studyVersion, samples: samples.length, downloaded: 0, manifestPath, audioDir,
      entries: samples.map((sample) => buildManifestEntry(sample, sample.sourceHash || sample.audioSha256, studyVersion))
    };
  }
  const stageRoot = fs.mkdtempSync(path.join(os.tmpdir(), '.segmentation-study-stage-'));
  const stageAudioDir = path.join(stageRoot, 'audio');
  const stageManifestPath = path.join(stageRoot, 'export.json');
  const resolvedAudioRoot = path.resolve(audioDir);
  const entries = [];
  const seenIds = new Set();
  const seenHashes = new Set();
  let downloaded = 0;
  const movedAudioPaths = [];
  const audioBackups = [];
  let createdAudioDir = false;
  let manifestBackupPath = null;
  let manifestTempPath = null;
  let manifestPublished = false;
  const publishHook = dependencies.publishHook;
  try {
    for (const normalizedSample of samples) {
    const sampleId = normalizedSample.sampleId || normalizedSample.id;
    if (!sampleId) throw new Error('Cloud corpus sample is missing sampleId.');
    if (seenIds.has(sampleId)) throw new Error(`Cloud corpus contains duplicate sampleId ${sampleId}.`);
    seenIds.add(sampleId);
    const wavPath = path.resolve(resolvedAudioRoot, `${sampleId}.wav`);
    if (!wavPath.startsWith(`${resolvedAudioRoot}${path.sep}`)) throw new Error(`Unsafe audio path for ${sampleId}.`);
    let buffer = null;
    if (fs.existsSync(wavPath)) {
      buffer = fs.readFileSync(wavPath);
      if (normalizedSample.sourceHash && sha256(buffer) !== normalizedSample.sourceHash) buffer = null;
    }
    if (!buffer) {
      if (!normalizedSample.audioUrl) throw new Error(`Cloud corpus sample ${sampleId} is missing audioUrl.`);
      const audioResponse = await (dependencies.fetchImpl || globalThis.fetch)(normalizedSample.audioUrl, { headers: { Authorization: `Bearer ${token}` } });
      if (!audioResponse.ok) throw new Error(`Audio download failed for ${sampleId} (${audioResponse.status}).`);
      buffer = Buffer.from(await audioResponse.arrayBuffer());
      downloaded += 1;
    }
    const calculatedHash = buffer ? sha256(buffer) : normalizedSample.sourceHash || normalizedSample.audioSha256 || null;
    const expectedHash = String(normalizedSample.sourceHash || normalizedSample.audioSha256 || '').toLowerCase() || null;
    if (apply && expectedHash && calculatedHash !== expectedHash) throw new Error(`Audio SHA-256 mismatch for ${sampleId}.`);
    if (calculatedHash && seenHashes.has(calculatedHash)) throw new Error(`Cloud corpus contains duplicate audio hash for ${sampleId}.`);
    if (calculatedHash) seenHashes.add(calculatedHash);
    entries.push(buildManifestEntry(normalizedSample, calculatedHash, studyVersion));
    fs.mkdirSync(stageAudioDir, { recursive: true });
    const stageWavPath = path.resolve(stageAudioDir, `${sampleId}.wav`);
    if (!stageWavPath.startsWith(`${path.resolve(stageAudioDir)}${path.sep}`)) throw new Error(`Unsafe staged audio path for ${sampleId}.`);
    fs.writeFileSync(stageWavPath, buffer);
    }
  entries.sort((left, right) => String(left.sampleId).localeCompare(String(right.sampleId)));
  const result = {
    mode: apply ? 'apply' : 'dry-run',
    schemaVersion: exportPayload.schemaVersion || 'segmentation-study-export-v2',
    studyVersion: exportPayload.studyVersion || `study-${studyVersion}`,
    manifestVersion: exportPayload.manifestVersion || null,
    manifestSha256: exportPayload.manifestSha256 || null,
    studyVersionKey: studyVersion,
    samples: samples.length,
    downloaded,
    manifestPath,
    audioDir,
    entries
  };
  if (studyVersion === 'v2' && (!result.manifestVersion || !result.manifestSha256)) throw new Error('Refusing to apply v2 export without manifestVersion and manifestSha256.');
  fs.writeFileSync(stageManifestPath, `${JSON.stringify({ schemaVersion: result.schemaVersion, studyVersion: result.studyVersion, manifestVersion: result.manifestVersion, manifestSha256: result.manifestSha256, samples: entries }, null, 2)}\n`, 'utf8');
  fs.mkdirSync(path.dirname(audioDir), { recursive: true });
  if (!fs.existsSync(audioDir)) {
    fs.mkdirSync(audioDir, { recursive: false });
    createdAudioDir = true;
  }
  const rollbackDir = path.join(stageRoot, 'rollback');
  fs.mkdirSync(rollbackDir, { recursive: true });
  const stagedFiles = fs.readdirSync(stageAudioDir);
  for (let index = 0; index < stagedFiles.length; index += 1) {
    const file = stagedFiles[index];
    const targetPath = path.resolve(audioDir, file);
    if (!targetPath.startsWith(`${resolvedAudioRoot}${path.sep}`)) throw new Error(`Unsafe audio publish path for ${file}.`);
    if (typeof publishHook === 'function') await publishHook({ kind: 'audio', index, file, targetPath });
    if (fs.existsSync(targetPath)) {
      const backupPath = path.join(rollbackDir, `audio-${index}.bak`);
      fs.copyFileSync(targetPath, backupPath);
      audioBackups.push({ targetPath, backupPath });
    }
    fs.renameSync(path.join(stageAudioDir, file), targetPath);
    movedAudioPaths.push(targetPath);
  }
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  if (fs.existsSync(manifestPath)) {
    manifestBackupPath = path.join(rollbackDir, 'manifest.bak');
    fs.copyFileSync(manifestPath, manifestBackupPath);
  }
  if (typeof publishHook === 'function') await publishHook({ kind: 'manifest', manifestPath });
  manifestTempPath = path.join(path.dirname(manifestPath), `.${path.basename(manifestPath)}.${crypto.randomBytes(8).toString('hex')}.stage`);
  fs.copyFileSync(stageManifestPath, manifestTempPath);
  fs.renameSync(manifestTempPath, manifestPath);
  manifestPublished = true;
  fs.rmSync(stageRoot, { recursive: true, force: true });
  return result;
  } catch (error) {
    if (manifestTempPath) fs.rmSync(manifestTempPath, { force: true });
    if (manifestPublished) {
      if (manifestBackupPath) fs.copyFileSync(manifestBackupPath, manifestPath);
      else fs.rmSync(manifestPath, { force: true });
    } else if (manifestBackupPath) {
      fs.copyFileSync(manifestBackupPath, manifestPath);
    }
    for (const targetPath of movedAudioPaths) fs.rmSync(targetPath, { force: true });
    for (const { targetPath, backupPath } of audioBackups) fs.copyFileSync(backupPath, targetPath);
    if (createdAudioDir && fs.existsSync(audioDir) && fs.readdirSync(audioDir).length === 0) fs.rmSync(audioDir, { recursive: true, force: true });
    fs.rmSync(stageRoot, { recursive: true, force: true });
    throw error;
  }
}

async function main(argv = process.argv.slice(2), dependencies = {}) {
  const args = parseArgs(argv);
  const result = await syncCorpus({
    studyVersion: args['study-version'] || 'v2',
    apiBase: args['api-base'],
    audioDir: args['audio-dir'],
    manifest: args.manifest,
    token: args.token || undefined,
    apply: Boolean(args.apply)
  }, dependencies);
  console.log(JSON.stringify({ ...result, entries: result.entries.length }, null, 2));
  return result;
}

if (require.main === module) main().catch((error) => { console.error(error.stack || error.message || error); process.exitCode = 1; });

module.exports = { DEFAULT_API_BASE, DEFAULT_AUDIO_DIR, DEFAULT_MANIFEST, automaticOrderFor, automaticVersionOrderFor, buildManifestEntry, endpoint, flattenExportSample, main, parseArgs, resolveAuthToken, sha256, syncCorpus, tokenFromEnvironment };
