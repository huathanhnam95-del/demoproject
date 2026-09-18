'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const {
  PILOT_ASSETS,
  inspectPilotAssets,
  buildPilotCatalogs
} = require('../../scripts/release/pilot-media-campaign.cjs');

test('Pilot Campaign: defines exactly 26 representative files covering all 7 test categories', () => {
  assert.equal(PILOT_ASSETS.length, 26);
  const categories = new Set(PILOT_ASSETS.map((a) => a.category));
  assert.ok(categories.has('Voices & Accents (US Female)'));
  assert.ok(categories.has('Voices & Accents (UK Male)'));
  assert.ok(categories.has('Speech Speeds (80% speed)'));
  assert.ok(categories.has('Segmented Clips'));
  assert.ok(categories.has('Practice Images (PNG)'));
  assert.ok(categories.has('Practice Images (JPG)'));
  assert.ok(categories.has('Paths with Spaces'));
  assert.ok(categories.has('Duplicate Content (Pair 1 - type)'));
  assert.ok(categories.has('Duplicate Content (Pair 2 - WAV)'));
  assert.ok(categories.has('SST Multi-voice'));
});

test('Pilot Campaign: inspectPilotAssets discovers all 26 files and correctly deduplicates 2 pairs', () => {
  const baseDir = 'C:/Cursor AI';
  if (!fs.existsSync(baseDir)) return; // Skip in environments where baseDir does not exist

  const pilotData = inspectPilotAssets(baseDir);
  assert.equal(pilotData.totalAssets, 26);
  assert.equal(pilotData.uniqueObjectsCount, 24);
  assert.equal(pilotData.totalBytes, 10525202);
  assert.equal(pilotData.deduplicationSavingsBytes, 46721 + 64844);

  // Check duplicate pair 1 (type 221.mp3 and speak 767.mp3)
  const typeObj = pilotData.uniqueObjects.get('media/sha256/677018cf37671dfccbed3af6af62c2710fd48cca91fff6cdbf781a33fb2c583f.mp3');
  assert.ok(typeObj);
  assert.equal(typeObj.logicalPaths.length, 2);
  assert.ok(typeObj.logicalPaths.includes('public/database/type/audio/221.mp3'));
  assert.ok(typeObj.logicalPaths.includes('public/database/speak/audio/767.mp3'));

  // Check duplicate pair 2 (collo-dictate WAV files)
  const wavObj = pilotData.uniqueObjects.get('media/sha256/d4c9940a5937e82a91fa9a610f62706a5d918cd36bd4755da35bc266a77af810.wav');
  assert.ok(wavObj);
  assert.equal(wavObj.logicalPaths.length, 2);
});

test('Pilot Campaign: buildPilotCatalogs generates valid sharded catalogs and root manifest', () => {
  const baseDir = 'C:/Cursor AI';
  if (!fs.existsSync(baseDir)) return;

  const pilotData = inspectPilotAssets(baseDir);
  const publicationId = 'pub-pilot-20260918-test';
  const catalogs = buildPilotCatalogs(pilotData, publicationId);

  assert.equal(catalogs.publicationId, publicationId);
  assert.equal(catalogs.rootRelease.type, 'pilot');
  assert.equal(catalogs.rootRelease.summary.totalLogicalAssets, 26);
  assert.equal(catalogs.rootRelease.summary.uniqueStorageObjects, 24);

  // Mode shards present
  assert.ok(catalogs.shards['RA']);
  assert.ok(catalogs.shards['Describe Image']);
  assert.ok(catalogs.shards['SST']);
  assert.ok(catalogs.shards['type']);
  assert.ok(catalogs.shards['speak']);
  assert.ok(catalogs.shards['collo-dictate']);
  assert.ok(catalogs.shards['Highlight Incorrect Words']);
  assert.ok(catalogs.shards['Take Notes']);
});

test('Pilot Campaign: Live GCS root release manifest is valid and marked ineligibleForProduction', async () => {
  const checkpointsBase = 'C:/Cursor AI/.media-checkpoints';
  const dirs = fs.existsSync(checkpointsBase)
    ? fs.readdirSync(checkpointsBase).filter(d => d.startsWith('pilot-')).sort().reverse()
    : [];
  const publicationId = dirs.length > 0 ? dirs[0] : 'pilot-20260918-035318';
  const url = `https://storage.googleapis.com/listening-tasks-3ae34-practice-media/publications/${publicationId}/release.json`;

  const data = await new Promise((resolve, reject) => {
    const https = require('node:https');
    https.get(url, (res) => {
      assert.equal(res.statusCode, 200);
      assert.equal(res.headers['content-type'], 'application/json');
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => resolve(JSON.parse(body)));
    }).on('error', reject);
  });

  assert.equal(data.publicationId, publicationId);
  assert.equal(data.type, 'pilot');
  assert.equal(data.ineligibleForProduction, true);
  assert.equal(data.selectionRestricted, true);
  assert.equal(data.summary.totalLogicalAssets, 26);
  assert.equal(data.summary.uniqueStorageObjects, 24);
  assert.ok(data.shards['RA']);
  assert.ok(data.shards['Describe Image']);
});

test('Pilot Campaign: Live GCS streaming byte-for-byte readback and HTTP 206 Range check', async () => {
  const https = require('node:https');
  const targetKey = 'media/sha256/0ac3e88e6e516eac81c9cf2202b35398da0ec39bf0ddd841954d6dd4498115f6.mp3';
  const expectedSha256 = '0ac3e88e6e516eac81c9cf2202b35398da0ec39bf0ddd841954d6dd4498115f6';
  const localFile = 'C:/Cursor AI/public/database/RA/Voice/audio/Audio by folder/1/RA_1_af_alloy_100.mp3';

  if (!fs.existsSync(localFile)) return;
  const localBytes = fs.readFileSync(localFile);

  // 1. Full streaming readback
  const fullUrl = `https://storage.googleapis.com/listening-tasks-3ae34-practice-media/${targetKey}`;
  const streamResult = await new Promise((resolve, reject) => {
    https.get(fullUrl, (res) => {
      assert.equal(res.statusCode, 200);
      assert.equal(res.headers['content-type'], 'audio/mpeg');
      assert.ok(res.headers['cache-control'].includes('immutable'));

      const hash = require('node:crypto').createHash('sha256');
      let bytes = 0;
      res.on('data', (chunk) => {
        bytes += chunk.length;
        hash.update(chunk);
      });
      res.on('end', () => resolve({ bytes, sha256: hash.digest('hex') }));
    }).on('error', reject);
  });

  assert.equal(streamResult.bytes, localBytes.length);
  assert.equal(streamResult.sha256, expectedSha256);

  // 2. HTTP 206 Partial Content Range check
  const rangeResult = await new Promise((resolve, reject) => {
    https.get(fullUrl, { headers: { Range: 'bytes=0-1023' } }, (res) => {
      assert.equal(res.statusCode, 206);
      assert.equal(res.headers['content-range'], `bytes 0-1023/${localBytes.length}`);
      assert.equal(res.headers['content-length'], '1024');

      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });

  assert.equal(rangeResult.length, 1024);
  assert.ok(rangeResult.equals(localBytes.subarray(0, 1024)));
});
