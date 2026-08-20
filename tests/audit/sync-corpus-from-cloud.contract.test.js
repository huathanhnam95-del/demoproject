/* eslint-disable no-console */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { automaticOrderFor, automaticVersionOrderFor, sha256, syncCorpus, tokenFromEnvironment } = require('../../scripts/audit/sync_corpus_from_cloud');
const frozenManifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../../scripts/data/segmentation-study-v2.json'), 'utf8'));
const frozenManifestSha256 = frozenManifest.manifestSha256;

function proofFor(taskId) {
  const automaticOrder = automaticOrderFor(frozenManifestSha256, taskId);
  const automaticVersionOrder = automaticVersionOrderFor(frozenManifestSha256, taskId);
  const exposureLog = automaticVersionOrder.map((version, index) => ({
    version,
    automaticOrder,
    viewedAt: `2026-08-19T00:00:0${index}.000Z`
  }));
  return { automaticOrder, automaticVersionOrder, exposureLog };
}

assert.strictEqual(tokenFromEnvironment({ SEGMENTATION_STUDY_TOKEN: 'test-token' }), 'test-token');
assert.strictEqual(tokenFromEnvironment({ API_KEY: 'must-not-be-used' }), null);

let audioRequests = 0;
const requestedUrls = [];
const sample = {
  sampleId: 'sample-v2-001',
  taskId: 'segmentation-study-v2-0001',
  speakerCohort: 'segmentation-study-v2',
  studyId: 'segmentation-study-v2', studyVersion: 'study-v2', manifestVersion: '2.0.0', manifestSha256: frozenManifestSha256,
  targetWord: frozenManifest.entries[0].targetWord,
  targetSyllableCount: frozenManifest.entries[0].targetSyllableCount,
  expectedObservedCount: frozenManifest.entries[0].expectedObservedCount,
  split: frozenManifest.entries[0].split,
  referenceIpa: frozenManifest.entries[0].referenceIpa,
  referenceSyllableIpa: frozenManifest.entries[0].referenceSyllableIpa,
  referenceProvenance: frozenManifest.entries[0].referenceProvenance,
  referenceLabelProvenance: frozenManifest.entries[0].referenceLabelProvenance,
  referenceDialect: frozenManifest.entries[0].referenceDialect,
  referenceSource: frozenManifest.entries[0].referenceSource,
  dialect: frozenManifest.entries[0].dialect,
  labelProvenance: frozenManifest.entries[0].labelProvenance,
  exceptionRationale: frozenManifest.entries[0].exceptionRationale,
  sourceHash: 'a'.repeat(64),
  audioUrl: 'https://example.invalid/audio.wav'
};
const dryRunSamples = frozenManifest.entries.map((entry, index) => {
  const proof = proofFor(entry.taskId);
  return {
    ...sample,
    sampleId: `sample-v2-${String(index + 1).padStart(3, '0')}`,
    taskId: entry.taskId,
    targetWord: entry.targetWord,
    targetSyllableCount: entry.targetSyllableCount,
    expectedObservedCount: entry.expectedObservedCount,
    split: entry.split,
    referenceIpa: entry.referenceIpa,
    referenceSyllableIpa: entry.referenceSyllableIpa,
    referenceProvenance: entry.referenceProvenance,
    referenceLabelProvenance: entry.referenceLabelProvenance,
    referenceDialect: entry.referenceDialect,
    referenceSource: entry.referenceSource,
    dialect: entry.dialect,
    labelProvenance: entry.labelProvenance,
    exceptionRationale: entry.exceptionRationale,
    sourceHash: `${index + 1}`.padStart(64, '0'),
    ...proof,
    annotationProtocol: 'automatic-visible-assisted-v1',
    assistedMetadata: { assisted: true, annotationProtocol: 'automatic-visible-assisted-v1', exposureLog: proof.exposureLog }
  };
});
const fetchImpl = async (url) => {
  requestedUrls.push(String(url));
  if (String(url).includes('audio.wav')) audioRequests += 1;
  return {
    ok: true,
    status: 200,
    json: async () => ({ schemaVersion: 'segmentation-study-export-v2', studyVersion: 'study-v2', manifestVersion: '2.0.0', manifestSha256: frozenManifestSha256, samples: dryRunSamples }),
    arrayBuffer: async () => Buffer.from('not-used-in-dry-run')
  };
};
 (async () => {
const result = await syncCorpus({
  apiBase: 'https://example.invalid',
  audioDir: fs.mkdtempSync(path.join(os.tmpdir(), 'study-v2-audio-')),
  manifest: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'study-v2-manifest-')), 'manifest.json'),
  studyVersion: 'v2',
  apply: false
}, { env: { SEGMENTATION_STUDY_TOKEN: 'test-token' }, fetchImpl });
assert.strictEqual(result.mode, 'dry-run');
assert.strictEqual(result.downloaded, 0);
assert.strictEqual(audioRequests, 0, 'dry-run must not download audio');
assert.ok(requestedUrls[0].includes('/api/admin/dev/segmentation-study/v2/export'), 'sync must consume the canonical v2 export endpoint');
assert.strictEqual(result.entries[0].manualSpans, null);
assert.strictEqual(result.entries[0].captureEligibility, null, 'missing capture eligibility must remain missing');
assert.strictEqual(result.entries[0].captureMetadata, null, 'missing capture identity must not be invented');
assert.strictEqual(result.entries[0].assistedMetadata.assisted, true, 'canonical v2 review metadata must be preserved');
assert.strictEqual(result.entries[0].annotationProtocol, 'automatic-visible-assisted-v1', 'canonical v2 annotation protocol must be preserved');
assert.strictEqual(result.entries[0].promotionEligible, false, 'missing eligibility must conservatively remain non-promotable');
console.log('cloud corpus sync credential and dry-run contracts passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });

(async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'study-v2-apply-'));
  const audioBuffers = Array.from({ length: 100 }, (_, index) => Buffer.from(`wav-${index}`));
  const wrappedSamples = audioBuffers.map((buffer, index) => {
    const entry = frozenManifest.entries[index];
    const proof = proofFor(entry.taskId);
    const exposureLog = proof.exposureLog;
    const spans = Array.from({ length: entry.targetSyllableCount }, (_, spanIndex) => ({ startTime: spanIndex, endTime: spanIndex + 1 }));
    const routeVersions = {
      v2: { spans, variant: 'v2', analysisVersion: 'analysis-v2', source: 'route-comparison-v2', schemaVersion: 'pronunciation-comparison-v2' },
      v3: { spans, variant: 'v3', analysisVersion: 'analysis-v3', source: 'route-partition-v3', schemaVersion: 'pronunciation-partition-variants-v2' },
      v4: { spans, variant: 'v4', analysisVersion: 'analysis-v4', source: 'route-partition-v4', schemaVersion: 'pronunciation-partition-variants-v2' }
    };
    const assistedMetadata = { assisted: true, annotationProtocol: 'automatic-visible-assisted-v1', exposureLog, reviewer: 'route-reviewer', reviewerSessionId: 'route-session-1' };
    const task = {
      taskId: entry.taskId, studyId: frozenManifest.studyId, studyVersion: 'study-v2', manifestVersion: frozenManifest.version, manifestSha256: frozenManifestSha256,
      automaticOrder: proof.automaticOrder, automaticVersionOrder: proof.automaticVersionOrder,
      targetWord: entry.targetWord, targetSyllableCount: entry.targetSyllableCount, expectedObservedCount: entry.expectedObservedCount, split: entry.split,
      speakerCohort: frozenManifest.studyId, referenceIpa: entry.referenceIpa, referenceSyllableIpa: entry.referenceSyllableIpa,
      referenceProvenance: entry.referenceProvenance, referenceLabelProvenance: entry.referenceLabelProvenance, referenceDialect: entry.referenceDialect,
      referenceSource: entry.referenceSource, dialect: entry.dialect, labelProvenance: entry.labelProvenance, exceptionRationale: entry.exceptionRationale
    };
    const sampleRecord = {
      sampleId: `sample-${index}`, id: `sample-${index}`, ...task, sourceHash: sha256(buffer), audioSha256: sha256(buffer),
      manualSegments: spans, variantProvenance: { v2: routeVersions.v2, v3: routeVersions.v3, v4: routeVersions.v4 }, analysisRevision: 'route-analysis-revision-v2',
      annotationProtocol: 'automatic-visible-assisted-v1', captureEligibility: true, captureSettings: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, deviceId: 'must-not-persist' },
      operatorSessionId: 'route-session-1', referenceLabelProvenance: entry.referenceLabelProvenance, certainty: 'certain', promotionEligible: true
    };
    return {
      ...task, promotionEligible: true, automaticOrder: proof.automaticOrder, automaticVersionOrder: proof.automaticVersionOrder, annotationProtocol: 'automatic-visible-assisted-v1', captureEligibility: true, assistedMetadata, variantProvenance: sampleRecord.variantProvenance,
      analysisRevision: sampleRecord.analysisRevision, versions: routeVersions, sample: sampleRecord, task, activeReview: { manualSegments: spans }, audioUrl: `https://example.invalid/audio-${index}.wav`
    };
  });
  const payload = { data: { schemaVersion: 'segmentation-study-export-v2', studyVersion: 'study-v2', manifestVersion: '2.0.0', manifestSha256: frozenManifestSha256, samples: wrappedSamples } };
  const applyFetch = async (url) => {
    const textUrl = String(url);
    if (textUrl.includes('/export')) return { ok: true, status: 200, json: async () => payload };
    const index = Number(textUrl.match(/audio-(\d+)\.wav/)?.[1]);
    return { ok: true, status: 200, arrayBuffer: async () => audioBuffers[index] };
  };
  const manifestPath = path.join(tempRoot, 'segmentation-study-export-v2.json');
  const result = await syncCorpus({ apiBase: 'https://example.invalid', studyVersion: 'v2', audioDir: path.join(tempRoot, 'audio'), manifest: manifestPath, apply: true }, { env: { SEGMENTATION_STUDY_TOKEN: 'test-token' }, fetchImpl: applyFetch });
  assert.strictEqual(result.downloaded, 100);
  const syncedManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const firstProof = proofFor(frozenManifest.entries[0].taskId);
  assert.strictEqual(syncedManifest.schemaVersion, 'segmentation-study-export-v2');
  assert.ok(syncedManifest.samples[0].manualSpans, 'nested export must flatten manual spans');
  assert.strictEqual(syncedManifest.samples[0].versions.v3.schemaVersion, 'pronunciation-partition-variants-v2');
  assert.strictEqual(syncedManifest.samples[0].versions.v4.schemaVersion, 'pronunciation-partition-variants-v2');
  assert.strictEqual(syncedManifest.samples[0].studyVersion, 'study-v2');
  assert.strictEqual(syncedManifest.samples[0].referenceSource, frozenManifest.entries[0].referenceSource);
  assert.strictEqual(syncedManifest.samples[0].variantProvenance.v3.variant, 'v3');
  assert.strictEqual(syncedManifest.samples[0].captureMetadata.sessionId, 'route-session-1');
  assert.strictEqual(syncedManifest.samples[0].captureMetadata.deviceId, undefined);
  assert.strictEqual(syncedManifest.samples[0].assistedMetadata.assisted, true);
  assert.strictEqual(syncedManifest.samples[0].automaticOrder, firstProof.automaticOrder);
  assert.deepStrictEqual(syncedManifest.samples[0].automaticVersionOrder, firstProof.automaticVersionOrder);
  assert.deepStrictEqual(syncedManifest.samples[0].assistedMetadata.exposureLog, firstProof.exposureLog);
  assert.strictEqual(syncedManifest.samples[0].promotionEligible, true);
  const canonicalLoaderCheck = [
    'import importlib.util, json, sys',
    'from pathlib import Path',
    'root = Path.cwd()',
    'spec = importlib.util.spec_from_file_location("reanalysis", root / "scripts/audit/segmentation_spectrogram_reanalysis.py")',
    'module = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(module)',
    'document = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))',
    'manifest = json.loads((root / "scripts/data/segmentation-study-v2.json").read_text(encoding="utf-8"))',
    'loaded = module.load_canonical_export_v2(document, manifest=manifest)',
    'assert len(loaded) == 100 and all(item["_canonicalExportV2"] for item in loaded)'
  ].join('; ');
  execFileSync('python', ['-c', canonicalLoaderCheck, manifestPath], { cwd: path.resolve(__dirname, '../..'), stdio: 'pipe' });
  const expectExposureProofFailure = async (badPayload, label) => {
    const badAudio = path.join(tempRoot, `${label}-audio`);
    const badManifest = path.join(tempRoot, `${label}.json`);
    await assert.rejects(() => syncCorpus({ apiBase: 'https://example.invalid', studyVersion: 'v2', audioDir: badAudio, manifest: badManifest, apply: true }, {
      env: { SEGMENTATION_STUDY_TOKEN: 'test-token' },
      fetchImpl: async (url) => {
        if (String(url).includes('/export')) return { ok: true, status: 200, json: async () => badPayload };
        throw new Error('audio must not be requested for invalid exposure proof');
      }
    }), /invalid deterministic automatic exposure order|invalid exposure order, token, or timestamp/);
    assert.ok(!fs.existsSync(badAudio), `${label} must be rejected before staging audio`);
    assert.ok(!fs.existsSync(badManifest), `${label} must be rejected before staging manifest`);
  };
  const wrongOrderPayload = JSON.parse(JSON.stringify(payload));
  wrongOrderPayload.data.samples[0].assistedMetadata.exposureLog.reverse();
  await expectExposureProofFailure(wrongOrderPayload, 'wrong-order');
  const invalidTokenPayload = JSON.parse(JSON.stringify(payload));
  invalidTokenPayload.data.samples[0].assistedMetadata.exposureLog[0].automaticOrder = '0'.repeat(64);
  await expectExposureProofFailure(invalidTokenPayload, 'invalid-token');
  const invalidTimestampPayload = JSON.parse(JSON.stringify(payload));
  invalidTimestampPayload.data.samples[0].assistedMetadata.exposureLog[0].viewedAt = 'not-a-timestamp';
  await expectExposureProofFailure(invalidTimestampPayload, 'invalid-timestamp');
  const uncertainWrapper = JSON.parse(JSON.stringify(wrappedSamples[0]));
  uncertainWrapper.promotionEligible = false;
  uncertainWrapper.sample.promotionEligible = true;
  const flattenedUncertain = require('../../scripts/audit/sync_corpus_from_cloud').flattenExportSample(uncertainWrapper);
  assert.strictEqual(flattenedUncertain.promotionEligible, false, 'wrapper false must override nested true');
  assert.strictEqual(require('../../scripts/audit/sync_corpus_from_cloud').buildManifestEntry(uncertainWrapper, audioBuffers[0] && sha256(audioBuffers[0]), 'v2').promotionEligible, false, 'manifest construction must preserve uncertain non-promotion');
  uncertainWrapper.promotionEligible = 'true';
  assert.strictEqual(require('../../scripts/audit/sync_corpus_from_cloud').flattenExportSample(uncertainWrapper).promotionEligible, false, 'invalid eligibility must remain non-promotable');
  const forcedAudio = path.join(tempRoot, 'forced-audio');
  const forcedManifest = path.join(tempRoot, 'forced.json');
  await assert.rejects(() => syncCorpus({ apiBase: 'https://example.invalid', studyVersion: 'v2', audioDir: forcedAudio, manifest: forcedManifest, apply: true }, {
    env: { SEGMENTATION_STUDY_TOKEN: 'test-token' },
    fetchImpl: applyFetch,
    publishHook: async ({ kind }) => { if (kind === 'manifest') throw new Error('forced publication failure'); }
  }), /forced publication failure/);
  assert.ok(!fs.existsSync(forcedAudio), 'publication failure must roll back all audio files');
  assert.ok(!fs.existsSync(forcedManifest), 'publication failure must roll back the manifest');
  const duplicatePayload = JSON.parse(JSON.stringify(payload));
  duplicatePayload.data.samples[1].sample.sourceHash = duplicatePayload.data.samples[0].sample.sourceHash;
  duplicatePayload.data.samples[1].sample.audioSha256 = duplicatePayload.data.samples[0].sample.audioSha256;
  await assert.rejects(() => syncCorpus({ apiBase: 'https://example.invalid', studyVersion: 'v2', audioDir: path.join(tempRoot, 'duplicate-audio'), manifest: path.join(tempRoot, 'duplicate.json'), apply: false }, { env: { SEGMENTATION_STUDY_TOKEN: 'test-token' }, fetchImpl: async (url, options) => ({ ok: true, status: 200, json: async () => duplicatePayload }) }), /duplicate source SHA/);
  const mismatch = JSON.parse(JSON.stringify(payload));
  mismatch.data.samples[0].sample.sourceHash = 'f'.repeat(64);
  mismatch.data.samples[0].sample.audioSha256 = 'f'.repeat(64);
  const mismatchAudio = path.join(tempRoot, 'mismatch-audio');
  const mismatchManifest = path.join(tempRoot, 'mismatch.json');
  await assert.rejects(() => syncCorpus({ apiBase: 'https://example.invalid', studyVersion: 'v2', audioDir: mismatchAudio, manifest: mismatchManifest, apply: true }, { env: { SEGMENTATION_STUDY_TOKEN: 'test-token' }, fetchImpl: async (url, options) => {
    if (String(url).includes('/export')) return { ok: true, status: 200, json: async () => mismatch };
    return applyFetch(url, options);
  } }), /SHA-256 mismatch/);
  assert.ok(!fs.existsSync(mismatchAudio), 'hash mismatch must not publish an audio directory');
  assert.ok(!fs.existsSync(mismatchManifest), 'hash mismatch must not publish a manifest');

  const shortPayload = JSON.parse(JSON.stringify(payload));
  shortPayload.data.samples = shortPayload.data.samples.slice(0, 99);
  const shortAudio = path.join(tempRoot, 'short-audio');
  const shortManifest = path.join(tempRoot, 'short.json');
  await assert.rejects(() => syncCorpus({ apiBase: 'https://example.invalid', studyVersion: 'v2', audioDir: shortAudio, manifest: shortManifest, apply: true }, { env: { SEGMENTATION_STUDY_TOKEN: 'test-token' }, fetchImpl: async (url, options) => {
    if (String(url).includes('/export')) return { ok: true, status: 200, json: async () => shortPayload };
    return applyFetch(url, options);
  } }), /exact 100-sample cohort coverage/);
  assert.ok(!fs.existsSync(shortAudio), 'short cohort must not publish an audio directory');
  assert.ok(!fs.existsSync(shortManifest), 'short cohort must not publish a manifest');

  const maliciousPayload = JSON.parse(JSON.stringify(payload));
  maliciousPayload.data.samples[0].sample.sampleId = '../escape';
  const maliciousAudio = path.join(tempRoot, 'malicious-audio');
  const maliciousManifest = path.join(tempRoot, 'malicious.json');
  await assert.rejects(() => syncCorpus({ apiBase: 'https://example.invalid', studyVersion: 'v2', audioDir: maliciousAudio, manifest: maliciousManifest, apply: true }, { env: { SEGMENTATION_STUDY_TOKEN: 'test-token' }, fetchImpl: async (url, options) => {
    if (String(url).includes('/export')) return { ok: true, status: 200, json: async () => maliciousPayload };
    return applyFetch(url, options);
  } }), /unsafe/);
  assert.ok(!fs.existsSync(maliciousAudio), 'unsafe sample ID must not publish an audio directory');
  assert.ok(!fs.existsSync(maliciousManifest), 'unsafe sample ID must not publish a manifest');
  console.log('canonical nested export flatten/apply/hash contracts passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
