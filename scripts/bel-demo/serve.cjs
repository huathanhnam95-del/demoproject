// Loopback-only demo server. External inputs are finite, hash-checked aliases.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../../public/prototypes/bel-working-as-equals-demo');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'presentation/source-manifest.json'), 'utf8').replace(/^\uFEFF/, ''));
const aliases = new Map(manifest.inputs.map(f => {
  const bytes = fs.readFileSync(f.path);
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== f.sha256) throw Error(`Source changed: ${f.path}`);
  return [f.url, f.path];
}));
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg'};
const server = http.createServer((req,res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let name = decodeURIComponent(url.pathname);
    if (name === '/favicon.ico') { res.writeHead(204); return res.end(); }
    let file = aliases.get(name);
    if (!file) {
      if (name === '/') name = '/index.html';
      file = path.resolve(root, '.' + name);
      if (!file.startsWith(root + path.sep)) throw Error('Outside root');
    }
    let body = fs.readFileSync(file);
    if (url.pathname === '/native/deck.html') body = Buffer.from(body.toString('utf8').replace('</body>', '<script type="module" src="../presentation/frame.mjs"></script></body>'));
    res.writeHead(200, {'Content-Type': types[path.extname(file)] || 'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    res.end(body);
  } catch { res.writeHead(404, {'Content-Type':'text/plain'}); res.end('File unavailable'); }
});
const port = Number(process.argv[2] || 4178);
server.listen(port, '127.0.0.1', () => console.log(`BEL local demo: http://127.0.0.1:${port} (${manifest.inputs.length} verified source inputs)`));
