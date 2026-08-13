/* eslint-disable no-console */
const assert = require('assert');
const path = require('path');
const {
  AUDIO_HASH_COLLECTION,
  buildAudioHashDocument,
  buildCorpusDocument,
  loadManifest,
  readHistoricalSamples
} = require('../../scripts/audit/import-segmentation-study-previous-samples');

const root = path.resolve(__dirname, '../..');
const samples = readHistoricalSamples(path.join(root, 'test-results/pronounce-local-samples'));
assert.strictEqual(samples.length, 6);
assert.strictEqual(new Set(samples.map((sample) => sample.sourceHash)).size, 6);
assert.ok(samples.every((sample) => sample.legacyManualSegments.length > 0));
assert.strictEqual(loadManifest(path.join(root, 'scripts/data/segmentation-study-v1.json')).length, 100);
assert.strictEqual(AUDIO_HASH_COLLECTION, 'pronunciationSegmentationStudyAudioHashes');
const timestamp = new Date('2026-08-13T00:00:00Z');
const audioMeta = { duration: 1.5, sampleRate: 16000, channels: 1, bitsPerSample: 16 };
const corpusDocument = buildCorpusDocument(samples[0], audioMeta, timestamp);
assert.strictEqual(corpusDocument.sourceHash, samples[0].sourceHash);
assert.deepStrictEqual(buildAudioHashDocument(samples[0], timestamp), {
  sourceHash: samples[0].sourceHash,
  sampleId: samples[0].sampleId,
  studyVersion: 'study-v1',
  sourceKind: 'pronounce-mode-local',
  createdAt: timestamp,
  updatedAt: timestamp
});
console.log('segmentation study historical import contract passed');
