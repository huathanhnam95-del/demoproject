// Produce a finite, hash-verified static site outside the checkout.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { resolveManifestInputs, hash } = require('./resolve-assets.cjs');

const repo = path.resolve(__dirname, '../..');
const root = path.join(repo, 'public/prototypes/bel-working-as-equals-demo');
const manifestPath = path.join(root, 'presentation/source-manifest.json');

const relative = (root, file) => path.relative(root, file).split(path.sep).join('/');

const allowedExtensions = /\.(mjs|js|css|html|json|png|jpg|jpeg|svg|wasm|glb|bin|ktx2)$/i;
const blockedPatterns = [
  /(^|\/)\.[^\/]/, // hidden files / .git
  /\.(patch|diff|env|lock|log|bak|tmp|md)$/i,
  /package(-lock)?\.json$/i,
  /\.test\.[a-z0-9]+$/i,
  /(^|\/)(BEL_Visual_References|reference[_-]pack)/i,
  /(^|\/)vesper([_\-./]|$)/i,
  /(^|\/)bel_batch0_reference/i,
  /(^|\/)(reference|BEL_Art_Direction_Pack)[_-]manifest\.json$/i
];

function isBlocked(relPath) {
  if (typeof relPath !== 'string') return false;
  const normalized = relPath.replace(/\\/g, '/');
  return blockedPatterns.some(p => p.test(normalized));
}

function build(destination) {
  if (!destination) throw Error('Usage: node scripts/bel-demo/package.cjs <new external directory>');
  const out = path.resolve(destination);
  const rel = path.relative(repo, out);
  if (!rel || (!rel.startsWith('..' + path.sep) && !path.isAbsolute(rel))) {
    throw Error('Output must be outside the repository');
  }
  if (fs.existsSync(out)) {
    throw Error('Output directory already exists; choose a new directory');
  }

  const entriesByUrl = new Map(); // url -> { url, source, sourceSha256, bytes }

  // Resolve manifest inputs via resolve-assets.cjs first
  const manifestInputs = resolveManifestInputs({ root, manifestPath });
  const rawManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, ''));
  const manifestAliases = new Set(manifestInputs.map(i => i.url.slice(1).toLowerCase()));

  function walk(dir) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, item.name);
      if (item.isSymbolicLink()) throw Error('Source symlinks are not allowed');
      if (item.isDirectory()) {
        walk(file);
      } else {
        const relUrl = relative(root, file);
        const lower = relUrl.toLowerCase();
        if (manifestAliases.has(lower)) {
          // Handled authoritatively by manifestInputs
          continue;
        }
        if (allowedExtensions.test(item.name) && !isBlocked(relUrl)) {
          const bytes = fs.readFileSync(file);
          const sha = hash(bytes);
          entriesByUrl.set(lower, {
            url: relUrl,
            source: file,
            sourceSha256: sha,
            bytes
          });
        }
      }
    }
  }

  walk(root);

  for (const input of manifestInputs) {
    const url = input.url.slice(1); // remove leading slash
    const lower = url.toLowerCase();
    let bytes = fs.readFileSync(input.path);

    if (input.url === '/native/deck.html') {
      const scriptTag = '<script type="module" src="../presentation/frame.mjs"></script>';
      const str = bytes.toString('utf8');
      if (!str.includes('presentation/frame.mjs')) {
        bytes = Buffer.from(str.replace('</body>', scriptTag + '</body>'));
      }
    }

    const currentSha = hash(bytes);

    if (entriesByUrl.has(lower)) {
      const existing = entriesByUrl.get(lower);
      // Coalesce if identical; if conflicting, throw Error
      if (existing.sourceSha256 !== input.sha256 && hash(existing.bytes) !== currentSha) {
        throw Error(`Conflicting duplicate output alias: ${url} (existing: ${existing.source}, manifest: ${input.path})`);
      }
      // Replace with resolved canonical input
      entriesByUrl.set(lower, {
        url,
        source: input.path,
        sourceSha256: input.sha256,
        bytes
      });
    } else {
      entriesByUrl.set(lower, {
        url,
        source: input.path,
        sourceSha256: input.sha256,
        bytes
      });
    }
  }

  const entries = Array.from(entriesByUrl.values());

  const site = path.join(out, 'site');
  fs.mkdirSync(site, { recursive: true });

  const files = entries
    .sort((a, b) => a.url.localeCompare(b.url))
    .map(({ bytes, ...entry }) => {
      const target = path.join(site, ...entry.url.split('/'));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, bytes);
      return { ...entry, bytes: bytes.length, sha256: hash(bytes) };
    });

  const record = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    site,
    sourceManifestSha256: hash(fs.readFileSync(manifestPath)),
    externalDependencies: rawManifest.externalDependencies,
    files
  };

  fs.writeFileSync(path.join(out, 'package-manifest.json'), JSON.stringify(record, null, 2) + '\n');
  return {
    site,
    files: files.length,
    manifestSha256: hash(fs.readFileSync(path.join(out, 'package-manifest.json')))
  };
}

if (require.main === module) {
  try {
    console.log(JSON.stringify(build(process.argv[2]), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { build, isBlocked, blockedPatterns };
