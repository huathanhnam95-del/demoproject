'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const https = require('node:https');
const http = require('node:http');

const DEFAULT_PROJECT_ID = 'listening-tasks-3ae34';
const DEFAULT_BUCKET_NAME = 'listening-tasks-3ae34-practice-media';
const DEFAULT_DELIVERY_BASE_URL = `https://storage.googleapis.com/${DEFAULT_BUCKET_NAME}/`;

// Exactly 26 representative pilot files covering all required test criteria
const PILOT_ASSETS = Object.freeze([
  // 1-7: Multiple Voices & Accents (RA folder 1)
  { category: 'Voices & Accents (US Female)', path: 'public/database/RA/Voice/audio/Audio by folder/1/RA_1_af_alloy_100.mp3' },
  { category: 'Voices & Accents (US Female)', path: 'public/database/RA/Voice/audio/Audio by folder/1/RA_1_af_bella_100.mp3' },
  { category: 'Voices & Accents (US Male)', path: 'public/database/RA/Voice/audio/Audio by folder/1/RA_1_am_echo_100.mp3' },
  { category: 'Voices & Accents (US Male)', path: 'public/database/RA/Voice/audio/Audio by folder/1/RA_1_am_fenrir_100.mp3' },
  { category: 'Voices & Accents (UK Female)', path: 'public/database/RA/Voice/audio/Audio by folder/1/RA_1_bf_emma_100.mp3' },
  { category: 'Voices & Accents (UK Male)', path: 'public/database/RA/Voice/audio/Audio by folder/1/RA_1_bm_george_100.mp3' },
  { category: 'Voices & Accents (UK Male)', path: 'public/database/RA/Voice/audio/Audio by folder/1/RA_1_bm_lewis_100.mp3' },

  // 8-10: Multiple Speeds (80% vs 100%)
  { category: 'Speech Speeds (80% speed)', path: 'public/database/RA/Voice/audio/Audio by folder/1/RA_1_af_alloy_80.mp3' },
  { category: 'Speech Speeds (80% speed)', path: 'public/database/RA/Voice/audio/Audio by folder/1/RA_1_bf_emma_80.mp3' },
  { category: 'Speech Speeds (80% speed)', path: 'public/database/RA/Voice/audio/Audio by folder/1/RA_1_bm_george_80.mp3' },

  // 11-13: Segmented Micro-Clips (Speech Coach)
  { category: 'Segmented Clips', path: 'public/database/RA/speech-coach-audio/v1/clips/03/0377aa5df43feaadcb6ea137a9aad78b026486582ed6b0c04cb81c8c46c833ae.mp3' },
  { category: 'Segmented Clips', path: 'public/database/RA/speech-coach-audio/v1/clips/04/04097ea03028e0f3f0f85e9fda9e70f2a90f6955ba71b6f762fc279216355541.mp3' },
  { category: 'Segmented Clips', path: 'public/database/RA/speech-coach-audio/v1/clips/05/05db4dd4b0e1cb9e49b4943b4d1d25e04c5c13fdad2ee5bbd5cdef9552cbfe15.mp3' },

  // 14-17: Practice Images (PNG & JPG)
  { category: 'Practice Images (PNG)', path: 'public/database/Describe Image/DI/1.png' },
  { category: 'Practice Images (PNG)', path: 'public/database/Describe Image/DI/10.png' },
  { category: 'Practice Images (JPG)', path: 'public/database/Describe Image/DI/1001.jpg' },
  { category: 'Practice Images (JPG)', path: 'public/database/Describe Image/DI/1002.jpg' },

  // 18-20: Paths with Spaces & Subfolders
  { category: 'Paths with Spaces', path: 'public/database/Highlight Incorrect Words/audio/1/HIW_1_af_bella.mp3' },
  { category: 'Paths with Spaces', path: 'public/database/Highlight Incorrect Words/audio/10/HIW_10_am_puck.mp3' },
  { category: 'Paths with Spaces', path: 'public/database/Take Notes/RL/audio/1.mp3' },

  // 21-24: Duplicate Content Testing (2 pairs)
  { category: 'Duplicate Content (Pair 1 - type)', path: 'public/database/type/audio/221.mp3' },
  { category: 'Duplicate Content (Pair 1 - speak)', path: 'public/database/speak/audio/767.mp3' },
  { category: 'Duplicate Content (Pair 2 - WAV)', path: 'public/database/collo-dictate/audio/cd_cfa1ba29.wav' },
  { category: 'Duplicate Content (Pair 2 - WAV)', path: 'public/database/collo-dictate/audio/cd_d2a87aa7.wav' },

  // 25-26: Long Audio (SST Multi-voice)
  { category: 'SST Multi-voice', path: 'public/database/SST/audio/1/SST_1_af_bella.mp3' },
  { category: 'SST Multi-voice', path: 'public/database/SST/audio/1/SST_1_bm_lewis.mp3' }
]);

const CONTENT_TYPES = Object.freeze({
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg'
});

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let read;
    do {
      read = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (read) hash.update(buffer.subarray(0, read));
    } while (read);
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function inspectPilotAssets(baseDir) {
  const items = [];
  const uniqueObjects = new Map();
  let totalBytes = 0;

  for (const item of PILOT_ASSETS) {
    const fullPath = path.join(baseDir, item.path);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Pilot asset not found on disk: ${fullPath}`);
    }
    const stat = fs.statSync(fullPath);
    const sha256 = sha256File(fullPath);
    const ext = path.extname(item.path).toLowerCase();
    const storageKey = `media/sha256/${sha256}${ext}`;
    const contentType = CONTENT_TYPES[ext] || 'application/octet-stream';

    totalBytes += stat.size;
    const entry = {
      category: item.category,
      logicalPath: item.path.replace(/\\/g, '/'),
      absolutePath: fullPath,
      size: stat.size,
      sha256,
      storageKey,
      contentType
    };
    items.push(entry);

    if (!uniqueObjects.has(storageKey)) {
      uniqueObjects.set(storageKey, {
        storageKey,
        sha256,
        size: stat.size,
        contentType,
        absolutePath: fullPath,
        logicalPaths: [entry.logicalPath]
      });
    } else {
      uniqueObjects.get(storageKey).logicalPaths.push(entry.logicalPath);
    }
  }

  const uniqueBytes = Array.from(uniqueObjects.values()).reduce((sum, o) => sum + o.size, 0);

  return {
    totalAssets: items.length,
    uniqueObjectsCount: uniqueObjects.size,
    totalBytes,
    uniqueBytes,
    deduplicationSavingsBytes: totalBytes - uniqueBytes,
    items,
    uniqueObjects
  };
}

function buildPilotCatalogs(pilotData, publicationId, deliveryBaseUrl = DEFAULT_DELIVERY_BASE_URL) {
  const modeGroups = {};
  for (const item of pilotData.items) {
    // Derive mode from path
    const parts = item.logicalPath.split('/');
    const mode = parts[2]; // e.g. 'RA', 'Describe Image', 'SST', etc.
    if (!modeGroups[mode]) modeGroups[mode] = [];
    modeGroups[mode].push(item);
  }

  const shards = {};
  const shardPayloads = {};

  for (const [modeId, assets] of Object.entries(modeGroups)) {
    const shardKey = `catalogs/${publicationId}/${modeId}.json`;
    const shardData = {
      schemaVersion: 1,
      publicationId,
      mode: modeId,
      createdAt: new Date().toISOString(),
      assetCount: assets.length,
      assets: Object.fromEntries(
        assets.map((a) => [
          a.logicalPath,
          {
            key: a.storageKey,
            sha256: a.sha256,
            size: a.size,
            contentType: a.contentType
          }
        ])
      )
    };
    const payload = JSON.stringify(shardData, null, 2) + '\n';
    const sha256 = crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
    shards[modeId] = {
      shardKey,
      sha256,
      size: Buffer.byteLength(payload, 'utf8'),
      assetCount: assets.length
    };
    shardPayloads[shardKey] = payload;
  }

  const rootRelease = {
    schemaVersion: 1,
    publicationId,
    type: 'pilot',
    createdAt: new Date().toISOString(),
    deliveryBaseUrl,
    summary: {
      totalLogicalAssets: pilotData.totalAssets,
      uniqueStorageObjects: pilotData.uniqueObjectsCount,
      totalLogicalBytes: pilotData.totalBytes,
      uniqueStorageBytes: pilotData.uniqueBytes,
      deduplicationSavingsBytes: pilotData.deduplicationSavingsBytes,
      modesCount: Object.keys(shards).length
    },
    shards
  };

  const rootReleasePayload = JSON.stringify(rootRelease, null, 2) + '\n';
  const rootReleaseKey = `publications/${publicationId}/release.json`;

  return {
    publicationId,
    rootRelease,
    rootReleaseKey,
    rootReleasePayload,
    shards,
    shardPayloads
  };
}

async function verifyRemoteObject(url, expected) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      if (res.statusCode !== 200 && res.statusCode !== 206) {
        return resolve({
          ok: false,
          error: `HTTP ${res.statusCode} ${res.statusMessage}`
        });
      }

      const headers = res.headers;
      const contentType = headers['content-type'];
      const cacheControl = headers['cache-control'];
      const corsOrigin = headers['access-control-allow-origin'];

      const hash = crypto.createHash('sha256');
      let bytesRead = 0;

      res.on('data', (chunk) => {
        bytesRead += chunk.length;
        hash.update(chunk);
      });

      res.on('end', () => {
        const digest = hash.digest('hex');
        const byteMatch = (bytesRead === expected.size);
        const hashMatch = (digest === expected.sha256);
        resolve({
          ok: byteMatch && hashMatch,
          statusCode: res.statusCode,
          contentType,
          cacheControl,
          corsOrigin,
          bytesRead,
          digest,
          byteMatch,
          hashMatch
        });
      });
    });

    req.on('error', (err) => resolve({ ok: false, error: err.message }));
  });
}

module.exports = {
  PILOT_ASSETS,
  CONTENT_TYPES,
  DEFAULT_PROJECT_ID,
  DEFAULT_BUCKET_NAME,
  DEFAULT_DELIVERY_BASE_URL,
  sha256File,
  inspectPilotAssets,
  buildPilotCatalogs,
  verifyRemoteObject
};
