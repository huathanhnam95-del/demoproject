/**
 * Deterministic shot renderer.
 *
 * Rather than screen-recording in real time, this seeks the scene to an exact
 * timestamp and screenshots each frame. Same input -> byte-identical output,
 * and frame pacing is perfect regardless of how slow the machine is.
 *
 *   node demo/render-shot.mjs --shot shots/01-dsp.html --seconds 5 --fps 60
 */
import { chromium } from 'playwright';
import { spawnSync } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 ? process.argv[i + 1] : fallback;
}

const SHOT = arg('shot', 'shots/01-dsp.html');
const SECONDS = Number(arg('seconds', 5));
const FPS = Number(arg('fps', 60));
const WIDTH = Number(arg('width', 1920));
const HEIGHT = Number(arg('height', 1080));
const OUT = arg('out', path.join(HERE, 'out', path.basename(SHOT, '.html') + '.mp4'));
const FRAME_DIR = path.join(HERE, 'out', 'frames', path.basename(SHOT, '.html'));

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
               '.json': 'application/json', '.ttf': 'font/ttf', '.wav': 'audio/wav' };

/** Static server rooted at demo/ so the scene can fetch its data and fonts. */
function serve(root) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
      const file = path.join(root, rel);
      if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); return res.end('not found');
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(cmd + ' exited ' + r.status);
};

(async () => {
  fs.rmSync(FRAME_DIR, { recursive: true, force: true });
  fs.mkdirSync(FRAME_DIR, { recursive: true });
  fs.mkdirSync(path.dirname(OUT), { recursive: true });

  const { srv, port } = await serve(HERE);
  const browser = await chromium.launch({
    args: ['--force-color-profile=srgb', '--disable-lcd-text', '--hide-scrollbars'],
  });
  const page = await browser.newPage({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1,
  });

  const url = 'http://127.0.0.1:' + port + '/' + SHOT.replace(/\\/g, '/');
  await page.goto(url, { waitUntil: 'load' });
  await page.evaluate(() => window.__ready);

  const total = Math.round(SECONDS * FPS);
  const t0 = Date.now();
  for (let f = 0; f < total; f++) {
    const t = f / FPS;
    await page.evaluate((tt) => window.__seek(tt), t);
    await page.screenshot({
      path: path.join(FRAME_DIR, String(f).padStart(5, '0') + '.png'),
      animations: 'disabled',
    });
    if (f % 30 === 0 || f === total - 1) {
      const pct = (((f + 1) / total) * 100).toFixed(0);
      process.stdout.write('\r  frame ' + (f + 1) + '/' + total + '  (' + pct + '%)   ');
    }
  }
  process.stdout.write('\n  captured in ' + ((Date.now() - t0) / 1000).toFixed(1) + 's\n');

  await browser.close();
  srv.close();

  run('ffmpeg', [
    '-y', '-v', 'error', '-stats',
    '-framerate', String(FPS),
    '-i', path.join(FRAME_DIR, '%05d.png'),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '16',
    '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-movflags', '+faststart',
    '-r', String(FPS),
    OUT,
  ]);

  console.log('\n  -> ' + OUT + '  (' + (fs.statSync(OUT).size / 1048576).toFixed(2) + ' MB)');
})().catch((e) => { console.error(e); process.exit(1); });
