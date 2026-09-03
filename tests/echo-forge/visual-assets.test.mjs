import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { createVisualAssetLoader } from '../../public/js/echo-forge/visual/asset-loader.js';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const MANIFEST_PATH = path.join(ROOT, 'public/assets/echo-forge/v1/visual-manifest.v1.json');
const SCHEMA_PATH = path.join(ROOT, 'docs/echo-forge/production/visual-manifest.schema.json');
const SOURCE_ROOT = path.join(ROOT, 'assets/echo-forge/v1/src');
const BUILD_SCRIPT = path.join(ROOT, 'scripts/echo-forge/build-visual-assets.mjs');
const EXPECTED = {
  'ef-hero-idle': { width: 256, height: 256, frames: 1, fallback: 0 },
  'ef-enemy-idle': { width: 256, height: 256, frames: 1, fallback: 0 },
  'ef-analysis-hold': { width: 256, height: 256, frames: 4, fallback: 0, pivot: { x: 128, y: 128 } },
  'ef-combat-result': { width: 320, height: 320, frames: 3, fallback: 1 },
};

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function pngInfo(filePath) {
  const bytes = fs.readFileSync(filePath);
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  const colorType = bytes[25];
  return { width, height, alpha: colorType === 6 || colorType === 4 };
}

test('production visual manifest is closed, project-authored, and complete', () => {
  assert.equal(fs.existsSync(MANIFEST_PATH), true, 'runtime visual manifest exists');
  assert.equal(fs.existsSync(SCHEMA_PATH), true, 'closed visual schema exists');
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  assert.equal(manifest.schemaVersion, 'echo-forge-visual-manifest-v1');
  assert.equal(manifest.provenance.kind, 'project-authored-deterministic-vector');
  assert.match(manifest.provenance.review, /approved internal integration review/i);
  assert.notEqual(manifest.provenance.provider, 'gemini');
  assert.match(manifest.tool.revision, /^playwright@\d+\.\d+\.\d+; chromium@\d+\.\d+\.\d+\.\d+$/);
  assert.notEqual(manifest.tool.revision, 'project-pinned-playwright');
  assert.equal(manifest.assetIds.length, 4);
  assert.equal(new Set(manifest.assetIds).size, manifest.assetIds.length);
  for (const [assetId, expected] of Object.entries(EXPECTED)) {
    const asset = manifest.assets.find((item) => item.assetId === assetId);
    assert.ok(asset, `${assetId} manifest asset`);
    assert.equal(asset.canvas.width, expected.width);
    assert.equal(asset.canvas.height, expected.height);
    assert.equal(asset.frames.length, expected.frames);
    assert.equal(asset.staticFallbackFrame, expected.fallback);
    assert.deepEqual(asset.pivot, expected.pivot || { x: expected.width / 2, y: expected.height - 32 });
    assert.equal(asset.frames.every((frame, index) => frame.frameIndex === index), true);
    for (const frame of asset.frames) {
      const resolved = path.resolve(ROOT, 'public/assets/echo-forge/v1', frame.path);
      const relative = path.relative(path.resolve(ROOT, 'public/assets/echo-forge/v1'), resolved);
      assert.equal(relative.startsWith('..') || path.isAbsolute(relative), false, `${assetId} path containment`);
      assert.equal(fs.existsSync(resolved), true, `${assetId} frame binary exists`);
      assert.equal(frame.sha256, sha256(resolved), `${assetId} frame hash`);
      assert.deepEqual(pngInfo(resolved), { width: expected.width, height: expected.height, alpha: true });
    }
  }
  const sourceFiles = fs.readdirSync(SOURCE_ROOT).filter((name) => name.endsWith('.svg')).sort();
  const sourceHash = crypto.createHash('sha256');
  for (const name of sourceFiles) sourceHash.update(name).update(fs.readFileSync(path.join(SOURCE_ROOT, name)));
  assert.equal(manifest.sourceSha256, sourceHash.digest('hex'));
});

test('visual build is deterministic and rejects active SVG content', () => {
  assert.doesNotThrow(() => execFileSync('node', [BUILD_SCRIPT], { cwd: ROOT, stdio: 'pipe' }));
  const beforeBytes = fs.readFileSync(MANIFEST_PATH);
  const before = JSON.parse(beforeBytes.toString('utf8'));
  const beforeHashes = before.assets.flatMap((asset) => asset.frames.map((frame) => frame.sha256));
  assert.doesNotThrow(() => execFileSync('node', [BUILD_SCRIPT], { cwd: ROOT, stdio: 'pipe' }));
  const afterBytes = fs.readFileSync(MANIFEST_PATH);
  const after = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  assert.deepEqual(afterBytes, beforeBytes, 'manifest bytes remain identical across builds');
  assert.deepEqual(after, JSON.parse(afterBytes.toString('utf8')));
  assert.deepEqual(after.assets.flatMap((asset) => asset.frames.map((frame) => frame.sha256)), beforeHashes);
  const heroPath = path.join(ROOT, 'public/assets/echo-forge/v1/ef-hero-idle/idle.png');
  const heroBytes = fs.readFileSync(heroPath);
  try {
    const tampered = Buffer.from(heroBytes);
    tampered[tampered.length - 1] ^= 1;
    fs.writeFileSync(heroPath, tampered);
    assert.throws(() => execFileSync('node', [BUILD_SCRIPT], { cwd: ROOT, stdio: 'pipe' }), /existing binary changed/i);
  } finally {
    let restored = false;
    for (let i = 0; i < 5 && !restored; i++) {
      try {
        fs.writeFileSync(heroPath, heroBytes);
        restored = true;
      } catch {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
      }
    }
    if (!restored) fs.writeFileSync(heroPath, heroBytes);
  }
  assert.doesNotThrow(() => execFileSync('node', [BUILD_SCRIPT], { cwd: ROOT, stdio: 'pipe' }));
  for (const name of fs.readdirSync(SOURCE_ROOT).filter((item) => item.endsWith('.svg'))) {
    const source = fs.readFileSync(path.join(SOURCE_ROOT, name), 'utf8');
    assert.doesNotMatch(source, /<script|<text\b|(?:href|src)\s*=|url\s*\(|(?:href|src)\s*=\s*["']https?:/i, name);
  }
});

test('visual SVG source validation rejects event handlers and embedded active-content elements', () => {
  const source = fs.readFileSync(BUILD_SCRIPT, 'utf8');
  for (const token of ['foreignObject', 'image', 'use', 'style', 'import', 'on[a-z]+']) {
    assert.match(source, new RegExp(token, 'i'), `validator covers ${token}`);
  }
});

test('visual presenter maps every semantic event without combat coupling', async () => {
  const { ECHO_FORGE_EVENT_TYPES } = await import('../../public/js/echo-forge/contracts/events.js');
  const { EVENT_VISUAL_MAP } = await import('../../public/js/echo-forge/visual/event-map.js');
  assert.deepEqual(Object.keys(EVENT_VISUAL_MAP).sort(), [...ECHO_FORGE_EVENT_TYPES].sort());
  const source = fs.readFileSync(path.join(ROOT, 'public/js/echo-forge/visual/presenter.js'), 'utf8');
  assert.doesNotMatch(source, /combat-reducer|combat-math|reduceCombat|combat\s*=|state\s*=|dispatch\s*\(/i);
});

test('runtime loader fails closed before creating Blob URLs and disposes verified assets', async () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const bytesByPath = new Map();
  for (const asset of manifest.assets) for (const frame of asset.frames) bytesByPath.set(frame.path, fs.readFileSync(path.join(ROOT, 'public/assets/echo-forge/v1', frame.path)));
  const urls = [];
  const revoked = [];
  const fetchImpl = async (url) => {
    if (String(url).endsWith('visual-manifest.v1.json')) return new Response(JSON.stringify(manifest), { status: 200 });
    const pathname = new URL(url).pathname.replace('/assets/echo-forge/v1/', '');
    return new Response(bytesByPath.get(pathname), { status: 200 });
  };
  const loader = createVisualAssetLoader({
    fetchImpl,
    cryptoImpl: crypto.webcrypto,
    URLApi: { createObjectURL: () => { const url = `blob:visual-${urls.length}`; urls.push(url); return url; }, revokeObjectURL: (url) => revoked.push(url) },
    manifestUrl: '/assets/echo-forge/v1/visual-manifest.v1.json',
  });
  const loaded = await loader.load();
  assert.equal(loaded.assets.size, 4);
  assert.equal(urls.length, 9);
  loader.dispose();
  assert.deepEqual(revoked, urls);

  const unsafe = structuredClone(manifest);
  unsafe.assets[0].frames[0].path = '../escape.png';
  let objectUrlCalls = 0;
  await assert.rejects(() => createVisualAssetLoader({
    fetchImpl: async (url) => String(url).endsWith('visual-manifest.v1.json') ? new Response(JSON.stringify(unsafe), { status: 200 }) : new Response(new Uint8Array()),
    cryptoImpl: crypto.webcrypto,
    URLApi: { createObjectURL: () => { objectUrlCalls += 1; return 'blob:never'; }, revokeObjectURL: () => {} },
    manifestUrl: '/assets/echo-forge/v1/visual-manifest.v1.json',
  }).load(), /path must remain/);
  assert.equal(objectUrlCalls, 0);
});
