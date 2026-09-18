'use strict';
const http = require('node:http');
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { Store } = require('./server/store.cjs');
const { PortablePackage } = require('./server/portable-package.cjs');
const ROOT = path.resolve(__dirname, '../..');
const STATIC = new Map([
  ['/', ['web/index.html', 'text/html']], ['/styles.css', ['web/styles.css', 'text/css']],
  ...['app', 'capture', 'storage-client', 'guided-session'].map(name => [`/${name}.mjs`, [`web/${name}.mjs`, 'text/javascript']]),
  ['/shared/project-schema.mjs', ['shared/project-schema.mjs', 'text/javascript']],
  ['/shared/capture-pack.v1.json', ['shared/capture-pack.v1.json', 'application/json']]
]);
async function createStudio({ dataDir, port = 8796 } = {}) {
  const schema = await import(pathToFileURL(path.join(__dirname, 'shared/project-schema.mjs')));
  const root = path.resolve(dataDir || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share'), 'BEL', 'AvatarPreparation'));
  schema.invariant(root !== ROOT && !root.startsWith(ROOT + path.sep), 'The data directory must be outside the repository');
  const store = await new Store(root, schema).init();
  schema.invariant(store.root !== ROOT && !store.root.startsWith(ROOT + path.sep), 'The resolved data directory must be outside the repository');
  const lockPath = path.join(store.root, '.studio.lock'); const lockIdentity = `${process.pid}:${crypto.randomUUID()}`;
  try { const handle = fs.openSync(lockPath, 'wx'); fs.writeFileSync(handle, lockIdentity); fs.closeSync(handle); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const owner = Number(fs.readFileSync(lockPath, 'utf8').split(':')[0]); let running = true;
    try { process.kill(owner, 0); } catch (check) { if (check.code === 'ESRCH') running = false; }
    schema.invariant(!running, 'Another studio owns this data folder. Stop that server or choose a different --data-dir.', 409);
    fs.unlinkSync(lockPath); const handle = fs.openSync(lockPath, 'wx'); fs.writeFileSync(handle, lockIdentity); fs.closeSync(handle);
  }
  const releaseLock = () => { try { if (fs.readFileSync(lockPath, 'utf8') === lockIdentity) fs.unlinkSync(lockPath); } catch {} };
  process.once('exit', releaseLock);
  const packages = new PortablePackage(store); const token = crypto.randomBytes(32).toString('hex'); let origin;
  const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };
  async function body(req) { let bytes = 0; const chunks = []; for await (const chunk of req) { bytes += chunk.length; schema.invariant(bytes <= 8 * 1024 * 1024, 'Manifest or request exceeds 8 MiB', 413); chunks.push(chunk); } try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); } }
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    try {
      schema.invariant(req.headers.host === new URL(origin).host, 'Unrecognized local host', 403);
      if (req.headers.origin) schema.invariant(req.headers.origin === origin, 'Cross-origin requests are blocked', 403);
      if (req.headers['sec-fetch-site']) schema.invariant(req.headers['sec-fetch-site'] !== 'cross-site', 'Cross-site requests are blocked', 403);
      const url = new URL(req.url, origin); const route = url.pathname; const method = req.method;
      if (!['GET', 'HEAD'].includes(method)) schema.invariant(req.headers.origin === origin && req.headers['x-studio-token'] === token, 'Local write token and origin are required', 403);
      if (method === 'GET' && route === '/api/session') return json(res, 200, { token, dataDirectory: store.root, captureLimitSeconds: 180, captureLimitBytes: 128 * 1024 * 1024 });
      if (method === 'GET' && route === '/api/projects') return json(res, 200, await store.list());
      if (method === 'POST' && route === '/api/projects') { const input = await body(req); return json(res, 201, await store.create(input.name, input.subject)); }
      let match = route.match(/^\/api\/projects\/([^/]+)$/);
      if (match && method === 'GET') return json(res, 200, await store.get(match[1]));
      if (match && method === 'PATCH') return json(res, 200, await store.update(match[1], await body(req)));
      match = route.match(/^\/api\/projects\/([^/]+)\/drafts$/);
      if (match && method === 'POST') return json(res, 201, await store.createDraft(match[1], await body(req)));
      match = route.match(/^\/api\/drafts\/([^/]+)\/media$/);
      if (match && method === 'PUT') return json(res, 200, await store.receive(match[1], req, req.headers['content-type']));
      match = route.match(/^\/api\/drafts\/([^/]+)\/commit$/);
      if (match && method === 'POST') return json(res, 200, await store.commit(match[1], (await body(req)).revision));
      match = route.match(/^\/api\/drafts\/([^/]+)$/);
      if (match && method === 'DELETE') { await store.discard(match[1]); return json(res, 200, { discarded: true }); }
      match = route.match(/^\/api\/projects\/([^/]+)\/exports$/);
      if (match && method === 'POST') return json(res, 201, await packages.export(match[1]));
      if (method === 'POST' && route === '/api/imports') return json(res, 201, await packages.begin(await body(req)));
      match = route.match(/^\/api\/imports\/([^/]+)\/media\/([^/]+)$/);
      if (match && method === 'PUT') return json(res, 200, await packages.receive(match[1], match[2], req));
      match = route.match(/^\/api\/imports\/([^/]+)\/commit$/);
      if (match && method === 'POST') return json(res, 201, await packages.commit(match[1]));
      match = route.match(/^\/api\/projects\/([^/]+)\/media\/([^/]+)$/);
      if (match && ['GET', 'HEAD'].includes(method)) {
        const { asset, file } = await store.asset(match[1], match[2]); const size = (await fsp.stat(file)).size;
        res.setHeader('Content-Type', asset.mime); res.setHeader('Accept-Ranges', 'bytes');
        let start = 0; let end = size - 1; let status = 200;
        if (req.headers.range) {
          const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
          if (!range || (!range[1] && !range[2])) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end(); }
          if (!range[1]) start = Math.max(0, size - Number(range[2]));
          else { start = Number(range[1]); if (range[2]) end = Math.min(end, Number(range[2])); }
          if (start > end || start >= size) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end(); }
          status = 206; res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
        }
        res.writeHead(status, { 'Content-Length': end - start + 1 });
        if (method === 'HEAD') return res.end();
        const stream = fs.createReadStream(file, { start, end }); stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); return stream.pipe(res);
      }
      if (['GET', 'HEAD'].includes(method) && (STATIC.has(route) || route === '/shared/audio-dsp-pipeline.js')) {
        const [filename, mime] = STATIC.get(route) || ['../../public/js/audio-dsp-pipeline.js', 'text/javascript'];
        const contents = await fsp.readFile(path.resolve(__dirname, filename)); res.writeHead(200, { 'Content-Type': `${mime}; charset=utf-8`, 'Content-Length': contents.length }); return res.end(method === 'HEAD' ? undefined : contents);
      }
      json(res, 404, { error: 'Not found' });
    } catch (error) { if (res.headersSent || res.destroyed) return; json(res, error.status || (error.code === 'ENOENT' ? 404 : 500), { error: error.code === 'ENOSPC' ? 'The local disk is full. Your unsaved preview is still available; free space and retry.' : error.message }); }
  });
  server.requestTimeout = 120000;
  try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => { origin = `http://127.0.0.1:${server.address().port}`; resolve(); }); }); }
  catch (error) { releaseLock(); process.removeListener('exit', releaseLock); throw error; }
  return { server, store, origin, close: () => new Promise(resolve => { server.closeAllConnections(); server.close(() => { releaseLock(); process.removeListener('exit', releaseLock); resolve(); }); }) };
}
if (require.main === module) {
  const args = process.argv.slice(2); const get = (flag, fallback) => args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback;
  if (args.includes('--help')) { console.log('node tools/avatar_preparation/server.cjs [--port 8796] [--data-dir ABSOLUTE_EXTERNAL_DIRECTORY]'); process.exit(0); }
  createStudio({ port: Number(get('--port', 8796)), dataDir: get('--data-dir', undefined) }).then(app => console.log(`Avatar Preparation Studio: ${app.origin}\nLocal data: ${app.store.root}\nCamera and microphone stay off until you enable them. Ctrl+C stops the server.`)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { createStudio };
