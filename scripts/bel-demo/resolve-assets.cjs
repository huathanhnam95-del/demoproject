'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const repo = path.resolve(__dirname, '../..');
const defaultRoot = path.join(repo, 'public/prototypes/bel-working-as-equals-demo');
const defaultManifestPath = path.join(defaultRoot, 'presentation/source-manifest.json');

function hash(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function normalizeUrl(url) {
  if (typeof url !== 'string') throw new Error('Invalid URL type');
  if (!url.startsWith('/')) throw new Error(`Alias must start with '/': ${url}`);
  if (url.includes('\\')) throw new Error(`Alias must not contain backslashes: ${url}`);
  const segments = url.slice(1).split('/');
  for (const seg of segments) {
    if (!seg || seg === '.' || seg === '..') {
      throw new Error(`Directory traversal or empty segment rejected in alias: ${url}`);
    }
  }
  return url;
}

function resolveManifestInputs(options = {}) {
  const root = path.resolve(options.root || defaultRoot);
  const manifestPath = path.resolve(options.manifestPath || defaultManifestPath);
  const overrideDir = options.overrideDir ? path.resolve(options.overrideDir) : null;

  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Manifest not found at ${manifestPath}`);
  }

  const manifestRaw = fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, '');
  const manifest = JSON.parse(manifestRaw);
  if (!Array.isArray(manifest.inputs)) {
    throw new Error('Manifest missing inputs array');
  }

  const results = [];
  for (const input of manifest.inputs) {
    const cleanUrl = normalizeUrl(input.url);
    const expectedSha = input.sha256;
    const expectedBytes = input.bytes;

    let candidatePath = null;
    let sourceMode = null;

    // 1. Check optional override directory first
    if (overrideDir) {
      const overridePath = path.join(overrideDir, ...cleanUrl.slice(1).split('/'));
      if (fs.existsSync(overridePath)) {
        const bytes = fs.readFileSync(overridePath);
        if (bytes.length === expectedBytes && hash(bytes) === expectedSha) {
          candidatePath = overridePath;
          sourceMode = 'override';
        }
      }
    }

    // 2. Check repository-relative verified copy
    if (!candidatePath) {
      const repoRelPath = path.join(root, ...cleanUrl.slice(1).split('/'));
      if (fs.existsSync(repoRelPath)) {
        const bytes = fs.readFileSync(repoRelPath);
        if (bytes.length === expectedBytes && hash(bytes) === expectedSha) {
          candidatePath = repoRelPath;
          sourceMode = 'repository-relative';
        }
      }
    }

    // 3. Fallback to declared external path
    if (!candidatePath && input.path && fs.existsSync(input.path)) {
      const bytes = fs.readFileSync(input.path);
      if (bytes.length === expectedBytes && hash(bytes) === expectedSha) {
        candidatePath = input.path;
        sourceMode = 'external';
      }
    }

    if (!candidatePath) {
      throw new Error(`Cannot resolve verified source for alias: ${cleanUrl} (expected sha256: ${expectedSha}, bytes: ${expectedBytes})`);
    }

    results.push({
      url: cleanUrl,
      path: candidatePath,
      sha256: expectedSha,
      bytes: expectedBytes,
      sourceMode
    });
  }

  return results;
}

function getAliasMap(options = {}) {
  const resolved = resolveManifestInputs(options);
  const map = new Map();
  for (const entry of resolved) {
    map.set(entry.url, entry.path);
  }
  return map;
}

function verifyAll(options = {}) {
  const inputs = resolveManifestInputs(options);
  return {
    verifiedCount: inputs.length,
    repoRelativeCount: inputs.filter(i => i.sourceMode === 'repository-relative').length,
    externalCount: inputs.filter(i => i.sourceMode === 'external').length,
    overrideCount: inputs.filter(i => i.sourceMode === 'override').length,
    inputs
  };
}

if (require.main === module) {
  try {
    const summary = verifyAll();
    console.log(`Resolved ${summary.verifiedCount} assets (${summary.repoRelativeCount} repo-relative, ${summary.externalCount} external)`);
  } catch (err) {
    console.error(`Asset resolution error: ${err.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  hash,
  normalizeUrl,
  resolveManifestInputs,
  getAliasMap,
  verifyAll
};
