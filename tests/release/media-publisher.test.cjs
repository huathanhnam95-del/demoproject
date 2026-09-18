'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const {
  MEDIA_EXTENSIONS,
  CONTENT_TYPES,
  sha256File,
  sha256String,
  canonicalJson,
  discoverModeAssets,
  buildInventory,
  buildCatalogs,
  generatePublicationId,
  CheckpointManager,
  runPlanCommand,
  runPublishCommand
} = require('../../scripts/release/media-publisher.cjs');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'media-pub-test-'));
}

test('Media Publisher: MEDIA_EXTENSIONS and CONTENT_TYPES support standard practice audio and image formats', () => {
  assert.ok(MEDIA_EXTENSIONS.has('.mp3'));
  assert.ok(MEDIA_EXTENSIONS.has('.wav'));
  assert.ok(MEDIA_EXTENSIONS.has('.png'));
  assert.ok(MEDIA_EXTENSIONS.has('.webp'));
  assert.equal(MEDIA_EXTENSIONS.has('.xlsx'), false);
  assert.equal(MEDIA_EXTENSIONS.has('.json'), false);
  assert.equal(MEDIA_EXTENSIONS.has('.md'), false);
  assert.equal(CONTENT_TYPES['.mp3'], 'audio/mpeg');
  assert.equal(CONTENT_TYPES['.png'], 'image/png');
});

test('Media Publisher: discoverModeAssets captures media and ignores non-media files', () => {
  const tempDir = makeTempDir();
  try {
    const audioDir = path.join(tempDir, 'public', 'database', 'SST', 'audio');
    fs.mkdirSync(audioDir, { recursive: true });

    // Valid audio files
    fs.writeFileSync(path.join(audioDir, 'clip1.mp3'), 'audio-data-1', 'utf8');
    fs.writeFileSync(path.join(audioDir, 'clip2.wav'), 'audio-data-2', 'utf8');
    // Non-media files that must be excluded
    fs.writeFileSync(path.join(audioDir, 'manifest.json'), '{"name":"manifest"}', 'utf8');
    fs.writeFileSync(path.join(audioDir, 'notes.xlsx'), 'fake-excel', 'utf8');
    fs.writeFileSync(path.join(audioDir, 'README.md'), '# Notes', 'utf8');

    const modeConfig = { id: 'SST', roots: ['public/database/SST/audio'] };
    const discovered = discoverModeAssets(tempDir, modeConfig);

    assert.equal(discovered.length, 2);
    const paths = discovered.map((d) => d.logicalPath).sort();
    assert.deepEqual(paths, [
      'public/database/SST/audio/clip1.mp3',
      'public/database/SST/audio/clip2.wav'
    ]);

    for (const item of discovered) {
      assert.ok(item.storageKey.startsWith('media/sha256/'));
      assert.ok(item.storageKey.endsWith(path.extname(item.logicalPath)));
      assert.equal(item.sha256.length, 64);
      assert.ok(item.size > 0);
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Media Publisher: content-addressed deduplication maps identical payloads to single storage object', () => {
  const tempDir = makeTempDir();
  try {
    const dirA = path.join(tempDir, 'public', 'database', 'RA', 'Voice', 'audio');
    const dirB = path.join(tempDir, 'public', 'database', 'Highlight Incorrect Words', 'audio');
    fs.mkdirSync(dirA, { recursive: true });
    fs.mkdirSync(dirB, { recursive: true });

    const sharedAudio = Buffer.from('IDENTICAL_AUDIO_PAYLOAD_FOR_DEDUPLICATION_TEST');
    fs.writeFileSync(path.join(dirA, 'question1.mp3'), sharedAudio);
    fs.writeFileSync(path.join(dirB, 'word_test.mp3'), sharedAudio);
    fs.writeFileSync(path.join(dirB, 'unique_sample.mp3'), Buffer.from('UNIQUE_DIFFERENT_AUDIO'));

    const inventory = buildInventory(tempDir);
    assert.equal(inventory.stats.totalLogicalAssets, 3);
    assert.equal(inventory.stats.uniqueStorageObjects, 2);
    assert.equal(inventory.stats.deduplicatedCount, 1);
    assert.equal(inventory.stats.deduplicationSavingsBytes, sharedAudio.length);

    // Verify deduplicated storage key
    const sharedSha = crypto.createHash('sha256').update(sharedAudio).digest('hex');
    const expectedKey = `media/sha256/${sharedSha}.mp3`;
    const sharedObj = inventory.uniqueObjects.get(expectedKey);
    assert.ok(sharedObj);
    assert.equal(sharedObj.logicalPaths.length, 2);
    assert.ok(sharedObj.logicalPaths.includes('public/database/RA/Voice/audio/question1.mp3'));
    assert.ok(sharedObj.logicalPaths.includes('public/database/Highlight Incorrect Words/audio/word_test.mp3'));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Media Publisher: buildCatalogs creates valid sharded catalogs and root release manifest', () => {
  const tempDir = makeTempDir();
  try {
    const audioDir = path.join(tempDir, 'public', 'database', 'SMW');
    fs.mkdirSync(audioDir, { recursive: true });
    fs.writeFileSync(path.join(audioDir, 'test1.mp3'), 'audio-smw-1');

    const inventory = buildInventory(tempDir, { cohort: 'SMW' });
    const publicationId = generatePublicationId('test-pub');
    const catalogs = buildCatalogs(inventory, publicationId, {
      deliveryBaseUrl: 'https://storage.googleapis.com/test-bucket/'
    });

    assert.equal(catalogs.publicationId, publicationId);
    assert.ok(catalogs.rootReleaseKey.endsWith('release.json'));
    assert.equal(catalogs.rootRelease.schemaVersion, 1);
    assert.equal(catalogs.rootRelease.summary.totalLogicalAssets, 1);
    assert.equal(catalogs.rootRelease.summary.uniqueStorageObjects, 1);
    assert.ok(catalogs.shards.SMW);
    assert.equal(catalogs.shards.SMW.assetCount, 1);

    const shardPayload = JSON.parse(catalogs.shardPayloads[catalogs.shards.SMW.shardKey]);
    assert.equal(shardPayload.schemaVersion, 1);
    assert.equal(shardPayload.mode, 'SMW');
    assert.equal(shardPayload.assetCount, 1);
    assert.ok(shardPayload.assets['public/database/SMW/test1.mp3']);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Media Publisher: CheckpointManager tracks progress, persists to disk, and survives reload', () => {
  const tempDir = makeTempDir();
  try {
    const checkpointDir = path.join(tempDir, '.media-checkpoints');
    const publicationId = 'pub-checkpoint-test-123';

    const cp1 = new CheckpointManager(checkpointDir, publicationId);
    assert.equal(cp1.isObjectCompleted('media/sha256/abc.mp3'), false);

    cp1.recordObjectCompleted('media/sha256/abc.mp3', { sha256: 'abc', size: 100 });
    cp1.recordShardCompleted('catalogs/pub/RA.json', 'shardsha');
    assert.equal(cp1.isObjectCompleted('media/sha256/abc.mp3'), true);
    assert.equal(cp1.isShardCompleted('catalogs/pub/RA.json'), true);

    // Reload from fresh instance
    const cp2 = new CheckpointManager(checkpointDir, publicationId);
    assert.equal(cp2.isObjectCompleted('media/sha256/abc.mp3'), true);
    assert.equal(cp2.isShardCompleted('catalogs/pub/RA.json'), true);
    assert.equal(cp2.isObjectCompleted('media/sha256/xyz.mp3'), false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Media Publisher: dry-run publish accurately calculates pending uploads without remote calls', async () => {
  const tempDir = makeTempDir();
  try {
    const audioDir = path.join(tempDir, 'public', 'database', 'LFIB');
    fs.mkdirSync(audioDir, { recursive: true });
    fs.writeFileSync(path.join(audioDir, 'q1.mp3'), 'audio-lfib-1');
    fs.writeFileSync(path.join(audioDir, 'q2.mp3'), 'audio-lfib-2');

    const result = await runPublishCommand({
      projectRoot: tempDir,
      cohort: 'LFIB',
      dryRun: true
    });

    assert.equal(result.dryRun, true);
    assert.equal(result.pendingObjects, 2);
    assert.equal(result.shardsCount, 1);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
