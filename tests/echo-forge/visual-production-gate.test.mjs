import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';

import { createTimingTelemetry } from '../../public/js/echo-forge/adapters/timing-telemetry.js';

const ROOT = path.resolve(import.meta.dirname, '../..');
const DOCS = path.join(ROOT, 'docs', 'echo-forge');
const GEMINI = path.join(DOCS, 'gemini');
const CLAUDE = path.join(DOCS, 'claude');
const MANIFEST_PATH = path.join(GEMINI, 'asset-manifest.draft.json');
const SCHEMA_PATH = path.join(DOCS, 'asset-manifest.schema.json');
const PROMPT_LOG_PATH = path.join(GEMINI, 'prompt-log.jsonl');
const MOTION_PATH = path.join(CLAUDE, 'motion-spec.v1.json');
const REQUEST_PATH = path.join(CLAUDE, 'gemini-asset-request.v1.json');
const PRODUCTION_REPORT_PATH = path.join(GEMINI, 'production-report.md');
const TASK_TRACKER_PATH = path.join(ROOT, 'TASK_TRACKER.csv');
const FINAL_MANIFEST_PATH = path.join(GEMINI, 'asset-manifest.v1.json');
const FINAL_ASSETS_ROOT = path.join(ROOT, 'public', 'assets', 'echo-forge', 'v1');
const TIMING_EXPORT_PATH = path.join(DOCS, 'timing', 'timing-evidence.v1.json');

const SLOT_FIELDS = [
  'assetId',
  'stateEvents',
  'canvas',
  'frameCount',
  'frameOrder',
  'pivot',
  'padding',
  'zOrder',
  'paletteConstraints',
  'staticFallbackFrame',
  'mobileSafeCrop',
  'loop',
  'timingVariable'
];

const REQUIRED_TIMING_COUNTS = {
  azure_word_scored: 30,
  azure_phrase_scored: 30,
  v3_word_formal: 30,
  unavailable_or_unrateable: 10,
};
const TIMING_MODES = ['azure_word', 'azure_phrase', 'v3_word'];
const TIMING_METRICS = [
  'audioDurationMs',
  'audioByteCount',
  'prewarmDurationMs',
  'requestDurationMs',
  'responseDurationMs',
  'normalizationDurationMs',
  'reducerResolutionDurationMs',
];
const METRIC_PERCENTILES = ['minimum', 'p50', 'p75', 'p90', 'p95', 'maximum'];
const DENYLISTED_TIMING_KEY = /audio(?!DurationMs|ByteCount)|url|referenceText|transcript|recognizedText|uid|email|token|raw|payload/i;

const EMPTY_SHA256 = crypto.createHash('sha256').update('').digest('hex');
const A_SHA256 = crypto.createHash('sha256').update('a').digest('hex');
const PLACEHOLDER_HASHES = new Set([EMPTY_SHA256, A_SHA256, '0'.repeat(64), 'f'.repeat(64)]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readJsonl(filePath) {
  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${filePath}:${index + 1} is not JSONL: ${error.message}`);
      }
    });
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function resolveLocalRef(schema, rootSchema) {
  if (!schema.$ref) return schema;
  assert.match(schema.$ref, /^#\//, `focused evaluator only supports local refs: ${schema.$ref}`);
  return schema.$ref.slice(2).split('/').reduce(
    (node, segment) => node[segment.replaceAll('~1', '/').replaceAll('~0', '~')],
    rootSchema
  );
}

const FOCUSED_SCHEMA_KEYWORDS = new Set([
  '$defs', '$id', '$ref', '$schema', 'additionalProperties', 'const', 'enum',
  'anyOf', 'items', 'maxItems', 'maxLength', 'maximum', 'minItems', 'minLength',
  'minimum', 'pattern', 'properties', 'required', 'title', 'type', 'uniqueItems'
]);

// A deliberately narrow evaluator for this closed local schema. It is not a general JSON Schema implementation.
function assertFocusedSchemaValid(value, schema, label = '$', rootSchema = schema) {
  function assertSupportedKeywords(node, pointer) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    for (const key of Object.keys(node)) {
      assert.ok(FOCUSED_SCHEMA_KEYWORDS.has(key), `${pointer} unsupported keyword ${key}`);
      if (key === 'properties' || key === '$defs') {
        for (const [childKey, childSchema] of Object.entries(node[key])) {
          assertSupportedKeywords(childSchema, `${pointer}.${key}.${childKey}`);
        }
      } else if (key === 'anyOf') {
        node[key].forEach((childSchema, index) => assertSupportedKeywords(childSchema, `${pointer}.anyOf[${index}]`));
      } else if (key === 'items') {
        assertSupportedKeywords(node[key], `${pointer}.items`);
      }
    }
  }

  function visit(node, rawSchema, pointer) {
    const current = resolveLocalRef(rawSchema, rootSchema);
    if (current.anyOf) {
      const matched = current.anyOf.some((candidate, index) => {
        try {
          visit(node, candidate, `${pointer}.anyOf[${index}]`);
          return true;
        } catch {
          return false;
        }
      });
      assert.equal(matched, true, `${pointer} anyOf`);
      return;
    }
    if (current.const !== undefined) assert.deepEqual(node, current.const, `${pointer} const`);
    if (current.enum) assert.ok(current.enum.some((allowed) => canonical(allowed) === canonical(node)), `${pointer} enum`);
    if (current.type) {
      const types = Array.isArray(current.type) ? current.type : [current.type];
      const typeMatches = {
        object: node !== null && typeof node === 'object' && !Array.isArray(node),
        array: Array.isArray(node),
        string: typeof node === 'string',
        null: node === null,
        integer: Number.isInteger(node),
        boolean: typeof node === 'boolean'
      };
      assert.ok(types.some((type) => typeMatches[type]), `${pointer} type ${types.join('|')}`);
    }
    if (typeof node === 'string') {
      if (current.minLength !== undefined) assert.ok(node.length >= current.minLength, `${pointer} minLength`);
      if (current.maxLength !== undefined) assert.ok(node.length <= current.maxLength, `${pointer} maxLength`);
      if (current.pattern) assert.match(node, new RegExp(current.pattern), `${pointer} pattern`);
    }
    if (typeof node === 'number') {
      if (current.minimum !== undefined) assert.ok(node >= current.minimum, `${pointer} minimum`);
      if (current.maximum !== undefined) assert.ok(node <= current.maximum, `${pointer} maximum`);
    }
    if (Array.isArray(node)) {
      if (current.minItems !== undefined) assert.ok(node.length >= current.minItems, `${pointer} minItems`);
      if (current.maxItems !== undefined) assert.ok(node.length <= current.maxItems, `${pointer} maxItems`);
      if (current.uniqueItems) assert.equal(new Set(node.map(canonical)).size, node.length, `${pointer} uniqueItems`);
      if (current.items) node.forEach((item, index) => visit(item, current.items, `${pointer}[${index}]`));
    }
    if (node !== null && typeof node === 'object' && !Array.isArray(node)) {
      if (current.required) {
        for (const requiredKey of current.required) {
          assert.ok(Object.hasOwn(node, requiredKey), `${pointer}.${requiredKey} required`);
        }
      }
      if (current.additionalProperties === false) {
        for (const key of Object.keys(node)) {
          assert.ok(current.properties && Object.hasOwn(current.properties, key), `${pointer}.${key} unknown`);
        }
      }
      for (const [key, childSchema] of Object.entries(current.properties || {})) {
        if (Object.hasOwn(node, key)) visit(node[key], childSchema, `${pointer}.${key}`);
      }
    }
  }

  assertSupportedKeywords(rootSchema, '$schema');
  visit(value, schema, label);
}

function assertNoPlaceholderHash(hash, label) {
  if (hash === null) return;
  assert.equal(typeof hash, 'string', `${label} hash type`);
  assert.match(hash, /^[0-9a-f]{64}$/, `${label} hash format`);
  assert.equal(PLACEHOLDER_HASHES.has(hash) || /^(.)\1{63}$/.test(hash), false, `${label} placeholder hash`);
}

function resolveAssetPath(assetsRoot, binaryPath) {
  assert.equal(typeof binaryPath, 'string', 'generated asset binaryPath must be a string');
  const root = path.resolve(assetsRoot);
  const resolved = path.resolve(root, binaryPath);
  const relative = path.relative(root, resolved);
  assert.equal(relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)), true, 'asset binaryPath must remain inside the asset root');
  return resolved;
}

function assertGeneratedClaimsHaveExistingBinary(manifest, assetsRoot) {
  for (const sidecar of manifest.provenanceSidecars || []) {
    assertNoPlaceholderHash(sidecar.sha256, `${sidecar.assetId}`);
    if (sidecar.generationStatus !== 'generated') {
      assert.equal(sidecar.generationStatus, 'not_generated', `${sidecar.assetId} generation status`);
      assert.equal(sidecar.binaryPath, null, `${sidecar.assetId} not_generated binaryPath`);
      continue;
    }
    const binaryPath = resolveAssetPath(assetsRoot, sidecar.binaryPath);
    assert.equal(fs.existsSync(binaryPath), true, `${sidecar.assetId} generated claim requires an existing binary`);
    assert.ok(fs.statSync(binaryPath).isFile(), `${sidecar.assetId} binary must be a file`);
  }
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function readPngMetadata(filePath) {
  const bytes = fs.readFileSync(filePath);
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${filePath} PNG signature`);
  let offset = 8;
  let header = null;
  let hasData = false;
  let hasEnd = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const chunkEnd = offset + 12 + length;
    assert.ok(chunkEnd <= bytes.length, `${filePath} truncated PNG chunk`);
    if (type === 'IHDR') {
      assert.equal(length, 13, `${filePath} IHDR length`);
      header = {
        width: bytes.readUInt32BE(offset + 8),
        height: bytes.readUInt32BE(offset + 12),
        bitDepth: bytes[offset + 16],
        colorType: bytes[offset + 17]
      };
    } else if (type === 'IDAT') {
      hasData = true;
    } else if (type === 'IEND') {
      hasEnd = true;
      break;
    }
    offset = chunkEnd;
  }
  assert.ok(header, `${filePath} PNG IHDR`);
  assert.equal(hasData, true, `${filePath} PNG IDAT`);
  assert.equal(hasEnd, true, `${filePath} PNG IEND`);
  return {
    width: header.width,
    height: header.height,
    hasAlpha: header.bitDepth === 8 && (header.colorType === 4 || header.colorType === 6)
  };
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, expectedKeys) {
  if (!isRecord(value)) return false;
  const actualKeys = Object.keys(value);
  return actualKeys.length === expectedKeys.length && expectedKeys.every((key) => Object.hasOwn(value, key));
}

function containsDenylistedTimingField(value, seen = new Set()) {
  if (!value || typeof value !== 'object') return false;
  if (seen.has(value)) return true;
  seen.add(value);
  if (Array.isArray(value)) return value.some((child) => containsDenylistedTimingField(child, seen));
  return Object.entries(value).some(([key, child]) => (
    DENYLISTED_TIMING_KEY.test(key) || containsDenylistedTimingField(child, seen)
  ));
}

function hasMetricPercentiles(metric) {
  if (!hasExactKeys(metric, METRIC_PERCENTILES)) return false;
  return METRIC_PERCENTILES.every((percentile) => Number.isFinite(metric[percentile]) && metric[percentile] >= 0);
}

function hasTimingSummary(summary, minimumCount) {
  if (!hasExactKeys(summary, ['count', 'metrics', 'unavailableRate', 'unrateableRate'])) return false;
  if (!Number.isInteger(summary.count) || summary.count < minimumCount) return false;
  if (!Number.isFinite(summary.unavailableRate) || summary.unavailableRate < 0 || summary.unavailableRate > 1) return false;
  if (!Number.isFinite(summary.unrateableRate) || summary.unrateableRate < 0 || summary.unrateableRate > 1) return false;
  if (!hasExactKeys(summary.metrics, TIMING_METRICS)) return false;
  return TIMING_METRICS.every((metric) => hasMetricPercentiles(summary.metrics[metric]));
}

function hasRealTimingExport(timingExport) {
  if (!isRecord(timingExport) || containsDenylistedTimingField(timingExport)) return false;
  if (!hasExactKeys(timingExport, ['summary', 'byEvaluationMode', 'timingGate'])) return false;
  if (!hasTimingSummary(timingExport.summary, 100)) return false;

  if (!hasExactKeys(timingExport.byEvaluationMode, TIMING_MODES)) return false;
  if (!TIMING_MODES.every((mode) => hasTimingSummary(timingExport.byEvaluationMode[mode], 1))) return false;

  const { timingGate } = timingExport;
  if (!hasExactKeys(timingGate, ['ready', 'counts']) || timingGate.ready !== true) return false;
  if (!hasExactKeys(timingGate.counts, Object.keys(REQUIRED_TIMING_COUNTS))) return false;
  return Object.entries(REQUIRED_TIMING_COUNTS).every(([key, minimum]) => (
    Number.isInteger(timingGate.counts[key]) && timingGate.counts[key] >= minimum
  ));
}

function isFinalIntegrationReady({ manifestPath, assetsRoot, timingPath }) {
  if (!fs.existsSync(manifestPath) || !fs.existsSync(timingPath)) return false;
  try {
    const manifest = readJson(manifestPath);
    if (manifest.manifestStage !== 'final') return false;
    const slotsById = new Map((manifest.assetSlots || []).map((slot) => [slot.assetId, slot]));
    if (!slotsById.size || !Array.isArray(manifest.provenanceSidecars)) return false;
    if (manifest.provenanceSidecars.length !== slotsById.size) return false;
    assertGeneratedClaimsHaveExistingBinary(manifest, assetsRoot);
    const sidecarIds = new Set();
    for (const sidecar of manifest.provenanceSidecars) {
      if (sidecar.generationStatus !== 'generated' || sidecar.sha256 === null || sidecar.alpha !== true) return false;
      if (sidecarIds.has(sidecar.assetId) || !slotsById.has(sidecar.assetId)) return false;
      sidecarIds.add(sidecar.assetId);
      if (!sidecar.dimensions || sidecar.dimensions.width !== slotsById.get(sidecar.assetId).canvas.width || sidecar.dimensions.height !== slotsById.get(sidecar.assetId).canvas.height) return false;
      const binaryPath = resolveAssetPath(assetsRoot, sidecar.binaryPath);
      if (sha256File(binaryPath) !== sidecar.sha256) return false;
      const png = readPngMetadata(binaryPath);
      if (png.width !== sidecar.dimensions.width || png.height !== sidecar.dimensions.height || png.hasAlpha !== true) return false;
    }
    return hasRealTimingExport(readJson(timingPath));
  } catch {
    return false;
  }
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const payload = Buffer.concat([typeBytes, data]);
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  payload.copy(output, 4);
  output.writeUInt32BE(crc32(payload), 8 + data.length);
  return output;
}

function makePng(width, height, withAlpha = true) {
  const channels = withAlpha ? 4 : 3;
  const row = Buffer.alloc(1 + width * channels, 0);
  for (let x = 0; x < width; x += 1) {
    const pixel = 1 + x * channels;
    row[pixel] = 34;
    row[pixel + 1] = 211;
    row[pixel + 2] = 238;
    if (withAlpha) row[pixel + 3] = 255;
  }
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = withAlpha ? 6 : 2;
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([signature, pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
}

function telemetryRecord(index, overrides = {}) {
  return {
    challengeId: `ef-a1-azure-word-${String(index).padStart(3, '0')}`,
    evaluationMode: 'azure_word',
    selectedLevel: 'A1',
    supportPreset: 'standard',
    audioDurationMs: 1000 + index,
    audioByteCount: 2000 + index,
    prewarmDurationMs: 10,
    requestDurationMs: 20 + index,
    responseDurationMs: 40 + index,
    normalizationDurationMs: 2,
    reducerResolutionDurationMs: 1,
    outcome: 'scored',
    httpCode: 200,
    errorCode: null,
    retryOrdinal: 0,
    ...overrides,
  };
}

function makeTimingExport() {
  const telemetry = createTimingTelemetry();
  for (let index = 0; index < 30; index += 1) telemetry.record(telemetryRecord(index + 1));
  for (let index = 0; index < 30; index += 1) {
    telemetry.record(telemetryRecord(index + 1, {
      challengeId: `ef-a1-azure-phrase-${String(index + 1).padStart(3, '0')}`,
      evaluationMode: 'azure_phrase',
    }));
  }
  for (let index = 0; index < 30; index += 1) {
    telemetry.record(telemetryRecord(index + 1, {
      challengeId: `ef-a1-v3-word-${String(index + 1).padStart(3, '0')}`,
      evaluationMode: 'v3_word',
      outcome: 'incorrect',
    }));
  }
  for (let index = 0; index < 10; index += 1) {
    telemetry.record(telemetryRecord(index + 1, {
      outcome: index % 2 ? 'unrateable' : 'unavailable',
    }));
  }
  return JSON.parse(telemetry.exportJson());
}

function writeCompleteFixture(root) {
  const assetsRoot = path.join(root, 'assets');
  fs.mkdirSync(assetsRoot, { recursive: true });
  const manifest = readJson(MANIFEST_PATH);
  manifest.manifestStage = 'final';
  manifest.provenanceSidecars = manifest.provenanceSidecars.map((sidecar) => {
    const slot = manifest.assetSlots.find((candidate) => candidate.assetId === sidecar.assetId);
    const binaryPath = `${sidecar.assetId}.png`;
    const absolutePath = path.join(assetsRoot, binaryPath);
    fs.writeFileSync(absolutePath, makePng(slot.canvas.width, slot.canvas.height));
    return {
      ...sidecar,
      generationStatus: 'generated',
      binaryPath,
      sha256: sha256File(absolutePath),
      dimensions: { ...slot.canvas },
      alpha: true,
      licenseStatus: 'verified',
      reviewStatus: 'approved'
    };
  });
  const manifestPath = path.join(root, 'asset-manifest.v1.json');
  const timingPath = path.join(root, 'timing-report.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  fs.writeFileSync(timingPath, JSON.stringify(makeTimingExport()));
  return { manifestPath, assetsRoot, timingPath };
}

test('stage-A draft uses a distinct closed asset-manifest schema with the clean 13-field slot shape', () => {
  const manifest = readJson(MANIFEST_PATH);
  const schema = readJson(SCHEMA_PATH);

  assert.equal(manifest.$schema, '../asset-manifest.schema.json');
  assert.equal(manifest.schemaVersion, 'asset-manifest-v1');
  assert.equal(manifest.manifestStage, 'stage-a-draft');
  assert.notEqual(manifest.$schema, '../visual-contract.schema.json');
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.$defs.assetSlot.additionalProperties, false);
  assert.deepEqual(schema.$defs.assetSlot.required, SLOT_FIELDS);
  assert.deepEqual(Object.keys(manifest.assetSlots[0]).sort(), [...SLOT_FIELDS].sort());
  assertFocusedSchemaValid(manifest, schema, 'assetManifest');
});

test('stage-A records are explicitly not_generated and reject placeholder hashes or missing generated binaries', () => {
  const manifest = readJson(MANIFEST_PATH);
  const schema = readJson(SCHEMA_PATH);
  assertFocusedSchemaValid(manifest, schema, 'assetManifest');
  assertGeneratedClaimsHaveExistingBinary(manifest, path.join(ROOT, 'public', 'assets', 'echo-forge', 'v1'));
  for (const sidecar of manifest.provenanceSidecars) {
    assert.equal(sidecar.generationStatus, 'not_generated', `${sidecar.assetId} generation status`);
    assert.equal(sidecar.sha256, null, `${sidecar.assetId} sha256`);
    assert.equal(sidecar.binaryPath, null, `${sidecar.assetId} binaryPath`);
    assert.equal(sidecar.dimensions, null, `${sidecar.assetId} dimensions`);
    assert.equal(sidecar.alpha, null, `${sidecar.assetId} alpha`);
    assert.equal(sidecar.licenseStatus, 'unverified', `${sidecar.assetId} license status`);
    assert.equal(sidecar.reviewStatus, 'unverified', `${sidecar.assetId} review status`);
  }

  const placeholder = structuredClone(manifest);
  placeholder.provenanceSidecars[0] = {
    ...placeholder.provenanceSidecars[0],
    generationStatus: 'generated',
    sha256: EMPTY_SHA256,
    binaryPath: 'missing.png'
  };
  assert.throws(() => assertGeneratedClaimsHaveExistingBinary(placeholder, os.tmpdir()), /placeholder hash/);

  const missingBinary = structuredClone(manifest);
  missingBinary.provenanceSidecars[0] = {
    ...missingBinary.provenanceSidecars[0],
    generationStatus: 'generated',
    sha256: crypto.createHash('sha256').update('missing-fixture').digest('hex'),
    binaryPath: 'missing.png'
  };
  assert.throws(() => assertGeneratedClaimsHaveExistingBinary(missingBinary, os.tmpdir()), /existing binary/);
});

test('prompt log does not claim generated PNGs or cleanup before Stage B', () => {
  const records = readJsonl(PROMPT_LOG_PATH);
  const manifest = readJson(MANIFEST_PATH);
  assert.equal(records.length, manifest.assetSlots.length, 'prompt log must cover each visual slot');
  assert.deepEqual(records.map((record) => record.assetId).sort(), manifest.assetSlots.map((slot) => slot.assetId).sort());
  for (const record of records) {
    assert.equal(record.generationStatus, 'not_generated', `${record.assetId} generation status`);
    assert.equal(record.sha256, null, `${record.assetId} prompt hash`);
    assert.equal(record.binaryPath, null, `${record.assetId} prompt binaryPath`);
    assert.equal(record.licenseStatus, 'unverified', `${record.assetId} prompt license status`);
    assert.equal(record.reviewStatus, 'unverified', `${record.assetId} prompt review status`);
    assert.equal(Object.hasOwn(record, 'cleanupTool'), false, `${record.assetId} cleanup claim`);
  }
});

test('final integration readiness remains false after timing passes until final manifest, real binaries, matching hashes, and dimensions/alpha exist', () => {
  assert.equal(hasRealTimingExport(readJson(TIMING_EXPORT_PATH)), true, 'the empirical timing export is ready');
  assert.equal(isFinalIntegrationReady({
    manifestPath: FINAL_MANIFEST_PATH,
    assetsRoot: FINAL_ASSETS_ROOT,
    timingPath: TIMING_EXPORT_PATH
  }), false, 'timing readiness alone cannot unlock the final production package');

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-forge-visual-gate-'));
  try {
    const fixture = writeCompleteFixture(tempRoot);
    assert.equal(isFinalIntegrationReady(fixture), true, 'complete fixture should satisfy every final gate');

    const manifest = readJson(fixture.manifestPath);
    manifest.provenanceSidecars[0].sha256 = '1'.repeat(64);
    fs.writeFileSync(fixture.manifestPath, JSON.stringify(manifest));
    assert.equal(isFinalIntegrationReady(fixture), false, 'mismatched SHA-256 must block integration');

    const restored = writeCompleteFixture(path.join(tempRoot, 'restored'));
    const noAlphaPath = path.join(restored.assetsRoot, 'ef-hero-idle.png');
    fs.writeFileSync(noAlphaPath, makePng(256, 256, false));
    const noAlphaManifest = readJson(restored.manifestPath);
    noAlphaManifest.provenanceSidecars[0].sha256 = sha256File(noAlphaPath);
    fs.writeFileSync(restored.manifestPath, JSON.stringify(noAlphaManifest));
    assert.equal(isFinalIntegrationReady(restored), false, 'missing alpha channel must block integration');

    const noTiming = writeCompleteFixture(path.join(tempRoot, 'no-timing'));
    fs.rmSync(noTiming.timingPath);
    assert.equal(isFinalIntegrationReady(noTiming), false, 'missing machine-readable timing export must block integration');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('timing aggregate gate rejects missing counts, false readiness, and denylisted fields', () => {
  const missingCount = structuredClone(makeTimingExport());
  delete missingCount.byEvaluationMode.azure_word.count;
  assert.equal(hasRealTimingExport(missingCount), false, 'missing mode count must block the timing gate');

  const falseReady = structuredClone(makeTimingExport());
  falseReady.timingGate.ready = false;
  assert.equal(hasRealTimingExport(falseReady), false, 'false timing readiness must block the timing gate');

  const denylistedField = structuredClone(makeTimingExport());
  denylistedField.byEvaluationMode.v3_word.metrics.requestDurationMs.rawSamples = [20, 21];
  assert.equal(hasRealTimingExport(denylistedField), false, 'denylisted raw fields must block the timing gate');
});

test('v1 motion and request are approved for empirical timing after the referenced timing gate is ready', () => {
  for (const filePath of [MOTION_PATH, REQUEST_PATH]) {
    const document = readJson(filePath);
    assert.equal(document.approvalStatus, 'approved_empirical_timing', `${filePath} approval status`);
    assert.equal(document.approvalDate, '2026-08-25', `${filePath} approval date`);
    assert.equal(document.timingGate?.status, 'ready', `${filePath} timing gate status`);
    assert.equal(document.timingGate?.ready, true, `${filePath} timing gate ready`);
    const exportReference = document.timingGate?.exportReference;
    assert.equal(exportReference, '../timing/timing-evidence.v1.json', `${filePath} timing export reference`);
    const exportPath = path.resolve(path.dirname(filePath), exportReference);
    assert.equal(fs.existsSync(exportPath), true, `${filePath} timing export must exist`);
    assert.equal(hasRealTimingExport(readJson(exportPath)), true, `${filePath} must reference a real ready timing export`);
  }
});

test('production report records timing PASS while binaries and integration remain BLOCKED, and Task 726 is done', () => {
  const report = fs.readFileSync(PRODUCTION_REPORT_PATH, 'utf8');
  assert.match(report, /stage a.*specification|not.generated/i);
  assert.match(report, /\|\s*Stage B timing gate\s*\|\s*PASS\s*\|/i);
  assert.match(report, /\|\s*Real binaries\s*\|\s*BLOCKED\s*\|/i);
  assert.match(report, /\|\s*Stage B binary generation\/integration\s*\|\s*BLOCKED\s*\|/i);
  assert.match(report, /\|\s*Final integration readiness\s*\|\s*BLOCKED\s*\|/i);
  assert.match(report, /real binaries|matching sha|alpha/i);
  assert.match(report, /asset-manifest\.schema\.json/);

  const task = fs.readFileSync(TASK_TRACKER_PATH, 'utf8')
    .split(/\r?\n/)
    .find((line) => line.startsWith('726,'));
  assert.ok(task, 'Task 726 must remain in the tracker');
  const columns = task.split(',');
  assert.equal(columns[3], 'Done');
  assert.equal(columns[4], '2026-08-25', 'Task 726 must record the timing-gate completion date');
});
