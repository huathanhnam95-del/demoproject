import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const SOURCE_ROOT = path.join(ROOT, 'assets/echo-forge/v1/src');
const ASSET_ROOT = path.join(ROOT, 'public/assets/echo-forge/v1');
const MANIFEST_PATH = path.join(ASSET_ROOT, 'visual-manifest.v1.json');
const DOC_ROOT = path.join(ROOT, 'docs/echo-forge/production');
const DOC_MANIFEST_PATH = path.join(DOC_ROOT, 'visual-manifest.v1.json');
const REBUILD = process.argv.includes('--rebuild');
const require = createRequire(import.meta.url);
const PLAYWRIGHT_VERSION = require('playwright/package.json').version;

const ASSETS = Object.freeze([
  { assetId: 'ef-hero-idle', width: 256, height: 256, pivot: { x: 128, y: 224 }, safe: 224, files: [['idle', 'ef-hero-idle.svg']] },
  { assetId: 'ef-enemy-idle', width: 256, height: 256, pivot: { x: 128, y: 224 }, safe: 224, files: [['idle', 'ef-enemy-idle.svg']] },
  { assetId: 'ef-analysis-hold', width: 256, height: 256, pivot: { x: 128, y: 128 }, safe: 208, files: [['hold-1', 'ef-analysis-hold-0.svg'], ['hold-2', 'ef-analysis-hold-1.svg'], ['hold-3', 'ef-analysis-hold-2.svg'], ['hold-4', 'ef-analysis-hold-3.svg']] },
  { assetId: 'ef-combat-result', width: 320, height: 320, pivot: { x: 160, y: 288 }, safe: 272, files: [['wind-up', 'ef-combat-result-0.svg'], ['resolve', 'ef-combat-result-1.svg'], ['return', 'ef-combat-result-2.svg']] },
]);

function fail(message) { throw new Error(`Echo Forge visual build blocked: ${message}`); }
function isContained(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
function hashBytes(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function hashSources(files) {
  const hash = crypto.createHash('sha256');
  for (const file of files) hash.update(file.name).update(file.bytes);
  return hash.digest('hex');
}
function parseSvgDimensions(source, fileName) {
  if (/<script\b|<text\b|<foreignObject\b|<image\b|<use\b|<style\b|<import\b|\bon[a-z]+\s*=|\bstyle\s*=|(?:href|src)\s*=|url\s*\(|(?:href|src)\s*=\s*["']https?:/i.test(source)) fail(`${fileName} contains active content, text, or external references`);
  const root = source.match(/^\s*<svg\b([^>]*)>/i)?.[1] || '';
  const width = Number(root.match(/\bwidth="(\d+)"/)?.[1]);
  const height = Number(root.match(/\bheight="(\d+)"/)?.[1]);
  if (!Number.isInteger(width) || !Number.isInteger(height)) fail(`${fileName} must have integer SVG dimensions`);
  return { width, height };
}
function pngDimensions(bytes) {
  if (bytes.readUInt32BE(0) !== 0x89504e47 || bytes.readUInt32BE(4) !== 0x0d0a1a0a) fail('rasterizer did not produce a PNG');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), alpha: bytes[25] === 6 || bytes[25] === 4 };
}

async function sourceRecords() {
  const files = [];
  const names = new Set();
  for (const asset of ASSETS) {
    if (!asset.assetId || names.has(asset.assetId)) fail(`duplicate asset ID ${asset.assetId}`);
    names.add(asset.assetId);
    const frameNames = new Set();
    for (const [frameName, fileName] of asset.files) {
      if (frameNames.has(frameName)) fail(`duplicate frame ${asset.assetId}/${frameName}`);
      frameNames.add(frameName);
      if (fileName.includes('/') || fileName.includes('\\') || path.basename(fileName) !== fileName) fail(`unsafe source path ${fileName}`);
      const absolute = path.resolve(SOURCE_ROOT, fileName);
      if (!isContained(SOURCE_ROOT, absolute)) fail(`source path escapes source root: ${fileName}`);
      const bytes = await fs.readFile(absolute);
      const dimensions = parseSvgDimensions(bytes.toString('utf8'), fileName);
      if (dimensions.width !== asset.width || dimensions.height !== asset.height) fail(`${fileName} dimensions do not match ${asset.assetId}`);
      files.push({ asset, frameName, fileName, bytes });
    }
  }
  return files;
}

async function main() {
  const files = await sourceRecords();
  const sourceSha256 = hashSources(files.map(({ fileName, bytes }) => ({ name: fileName, bytes })).sort((left, right) => left.name.localeCompare(right.name)));
  await fs.mkdir(ASSET_ROOT, { recursive: true });
  await fs.mkdir(DOC_ROOT, { recursive: true });
  let previous = null;
  try { previous = JSON.parse(await fs.readFile(MANIFEST_PATH, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (previous && previous.sourceSha256 !== sourceSha256 && !REBUILD) fail('source hash changed; use --rebuild to explicitly regenerate the same production package');

  const browser = await chromium.launch({ headless: true });
  const chromiumVersion = browser.version();
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const manifestAssets = [];
  try {
    for (const asset of ASSETS) {
      const frames = [];
      for (let frameIndex = 0; frameIndex < asset.files.length; frameIndex += 1) {
        const [frameName, fileName] = asset.files[frameIndex];
        const source = files.find((record) => record.asset === asset && record.fileName === fileName);
        const dataUrl = `data:image/svg+xml;base64,${source.bytes.toString('base64')}`;
        await page.setViewportSize({ width: asset.width, height: asset.height });
        await page.setContent(`<style>html,body{margin:0;width:${asset.width}px;height:${asset.height}px;background:transparent;overflow:hidden}img{display:block;width:${asset.width}px;height:${asset.height}px}</style><img id="frame" src="${dataUrl}" alt="">`);
        await page.locator('#frame').waitFor({ state: 'visible' });
        const outputPath = path.join(ASSET_ROOT, asset.assetId, `${frameName}.png`);
        if (!isContained(ASSET_ROOT, outputPath)) fail(`unsafe output path ${outputPath}`);
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        const rendered = await page.locator('#frame').screenshot({ omitBackground: true });
        const info = pngDimensions(rendered);
        if (info.width !== asset.width || info.height !== asset.height || !info.alpha) fail(`${asset.assetId}/${frameName} has wrong dimensions or alpha`);
        const frame = { frameIndex, name: frameName, path: `${asset.assetId}/${frameName}.png`, sha256: hashBytes(rendered), width: info.width, height: info.height, alpha: info.alpha };
        const oldFrame = previous?.assets?.find((item) => item.assetId === asset.assetId)?.frames?.find((item) => item.frameIndex === frameIndex);
        try {
          const existing = await fs.readFile(outputPath);
          if ((!oldFrame || hashBytes(existing) !== oldFrame.sha256) && !REBUILD) fail(`${asset.assetId}/${frameName} existing binary changed; use --rebuild to explicitly replace it`);
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
        if (oldFrame && oldFrame.sha256 !== frame.sha256 && !REBUILD) fail(`${asset.assetId}/${frameName} binary changed; use --rebuild to explicitly replace it`);
        await fs.writeFile(outputPath, rendered);
        frames.push(frame);
      }
      manifestAssets.push({ assetId: asset.assetId, canvas: { width: asset.width, height: asset.height }, frames, pivot: asset.pivot, mobileSafeCrop: { width: asset.safe, height: asset.safe }, staticFallbackFrame: asset.assetId === 'ef-combat-result' ? 1 : 0, loop: asset.assetId === 'ef-analysis-hold', timingVariable: asset.assetId === 'ef-analysis-hold' ? 'motion.analysisHold' : asset.assetId === 'ef-combat-result' ? 'motion.resultResolve' : 'motion.idle' });
    }
  } finally { await page.close(); await browser.close(); }

  const manifest = {
    $schema: './visual-manifest.schema.json',
    contractId: 'echo-forge-visual-v1',
    schemaVersion: 'echo-forge-visual-manifest-v1',
    manifestStage: 'production-ready',
    sourceSha256,
    assetIds: ASSETS.map((asset) => asset.assetId),
    assets: manifestAssets,
    tool: { name: 'Playwright Chromium', revision: `playwright@${PLAYWRIGHT_VERSION}; chromium@${chromiumVersion}` },
    provenance: { kind: 'project-authored-deterministic-vector', provider: 'internal-authored-svg', review: 'approved internal integration review; deterministic package generated without Gemini binaries' },
    motion: { windUpMs: 200, analysisHoldFrameCount: 4, analysisHoldCycleMs: 600, resultEnterMs: 100, resultHoldMs: 1000, resultReturnMs: 400, reducedMotion: 'static-equivalent' },
  };
  const contents = `${JSON.stringify(manifest, null, 2)}\n`;
  await fs.writeFile(MANIFEST_PATH, contents, 'utf8');
  await fs.writeFile(DOC_MANIFEST_PATH, contents, 'utf8');
  process.stdout.write(`Built ${manifestAssets.reduce((sum, asset) => sum + asset.frames.length, 0)} deterministic Echo Forge visual frames (source ${sourceSha256}).\n`);
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
