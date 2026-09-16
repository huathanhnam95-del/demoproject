// Loopback-only demo server. External inputs are finite, hash-checked aliases.
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { getAliasMap } = require('./resolve-assets.cjs');

const repo = path.resolve(__dirname, '../..');
const root = path.resolve(repo, 'public/prototypes/bel-working-as-equals-demo');

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('Usage: node scripts/bel-demo/serve.cjs [port]');
  console.log('Starts loopback demo server on 127.0.0.1 (default port: 4178)');
  process.exit(0);
}

let port = 4178;
if (process.argv[2]) {
  const parsed = Number(process.argv[2]);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    console.error(`Invalid port: "${process.argv[2]}". Must be an integer between 1 and 65535.`);
    process.exit(1);
  }
  port = parsed;
}

const aliases = getAliasMap({ root });

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
  '.bin': 'application/octet-stream',
  '.ktx2': 'image/ktx2'
};

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

function isBlocked(pathname) {
  if (typeof pathname !== 'string') return false;
  const normalized = pathname.replace(/\\/g, '/');
  return blockedPatterns.some(pat => pat.test(normalized));
}

const server = http.createServer((req, res) => {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain' });
      return res.end('Method not allowed');
    }

    const url = new URL(req.url, 'http://localhost');
    let pathname = decodeURIComponent(url.pathname);

    // Reject null bytes, backslashes, explicit traversal
    if (pathname.includes('\0') || pathname.includes('\\') || /(?:^|\/)\.\.(?:\/|$)/.test(pathname)) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      return res.end('Bad request: path traversal rejected');
    }

    if (pathname === '/favicon.ico') {
      res.writeHead(204);
      return res.end();
    }

    // Support nested base path prefixes
    const nestedPrefix = '/public/prototypes/bel-working-as-equals-demo';
    if (pathname.startsWith(nestedPrefix)) {
      pathname = pathname.slice(nestedPrefix.length) || '/';
    }
    const shortPrefix = '/prototypes/bel-working-as-equals-demo';
    if (pathname.startsWith(shortPrefix)) {
      pathname = pathname.slice(shortPrefix.length) || '/';
    }

    if (pathname === '/') {
      pathname = '/index.html';
    }

    if (isBlocked(pathname)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      return res.end('Access denied');
    }

    // Check manifest aliases first
    let file = aliases.get(pathname);

    if (!file) {
      file = path.resolve(root, '.' + pathname);
      const normalizedRoot = path.normalize(root) + path.sep;
      const normalizedFile = path.normalize(file);
      if (!normalizedFile.startsWith(normalizedRoot)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        return res.end('Access denied');
      }
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('File not found');
      }
    }

    let body = fs.readFileSync(file);

    // Inject frame adapter into deck.html idempotently if not already present
    if (pathname === '/native/deck.html') {
      const scriptTag = '<script type="module" src="../presentation/frame.mjs"></script>';
      const str = body.toString('utf8');
      if (!str.includes('presentation/frame.mjs')) {
        body = Buffer.from(str.replace('</body>', scriptTag + '</body>'));
      }
    }

    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': types[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    });

    if (req.method === 'HEAD') {
      return res.end();
    }
    res.end(body);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal server error');
  }
});

const isDirectRun = require.main === module;
if (isDirectRun) {
  server.listen(port, '127.0.0.1', () => {
    console.log(`BEL local demo: http://127.0.0.1:${port} (${aliases.size} verified source inputs)`);
  });
}

module.exports = server;
