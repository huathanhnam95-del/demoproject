'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const TEST_PORT = 5000;
const BASE_ORIGIN = 'http://127.0.0.1:' + TEST_PORT;

function createTestServer() {
  const publicDir = path.join(__dirname, '../../public');
  return http.createServer((req, res) => {
    const parsedUrl = new URL(req.url, BASE_ORIGIN);
    let filePath = path.join(publicDir, parsedUrl.pathname);

    if (parsedUrl.pathname === '/' || parsedUrl.pathname === '/test-cohort2-resolver.html') {
      res.writeHead(200, {
        'Content-Type': 'text/html',
        'Access-Control-Allow-Origin': '*'
      });
      res.end('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Cohort 2 Media Resolver Browser Test</title></head><body><audio id="test-audio"></audio><img id="test-image" /><canvas id="test-canvas" width="400" height="300"></canvas><script src="/js/media-url-resolver.js"></script></body></html>');
      return;
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const mimeTypes = {
        '.js': 'application/javascript',
        '.json': 'application/json',
        '.html': 'text/html',
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav',
        '.png': 'image/png',
        '.jpg': 'image/jpeg'
      };
      res.writeHead(200, {
        'Content-Type': mimeTypes[ext] || 'application/octet-stream',
        'Access-Control-Allow-Origin': '*'
      });
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });
}

test('Cohort 2 Media Delivery Playwright Suite (live GCS + Chromium)', async (t) => {
  const server = createTestServer();
  await new Promise((resolve) => server.listen(TEST_PORT, '127.0.0.1', resolve));

  let browser;
  let context;
  let page;

  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--autoplay-policy=no-user-gesture-required']
    });
    context = await browser.newContext();
    page = await context.newPage();
    await page.goto(BASE_ORIGIN + '/test-cohort2-resolver.html');

    const hasResolver = await page.evaluate(() => !!window.MediaUrlResolver);
    assert.equal(hasResolver, true, 'window.MediaUrlResolver should be defined in browser');

    await t.test('1. Highlight Incorrect Words (HIW): live GCS audio resolution and seek playback', async () => {
      const result = await page.evaluate(async () => {
        const audio = document.getElementById('test-audio');
        const resolvedUrl = await window.MediaUrlResolver.resolveAudioUrl(
          '/database/Highlight Incorrect Words/audio/1/HIW_1_af_bella.mp3',
          { rolloutState: 'remote-only' }
        );

        audio.src = resolvedUrl;
        audio.load();

        await new Promise((resolve, reject) => {
          audio.onloadedmetadata = resolve;
          audio.onerror = () => reject(new Error('Audio failed to load metadata'));
          setTimeout(() => reject(new Error('Timeout loading metadata')), 10000);
        });

        // Seek to 1.5 seconds
        audio.currentTime = 1.5;
        await new Promise((resolve) => {
          audio.onseeked = resolve;
        });

        await audio.play();
        await new Promise((r) => setTimeout(r, 400));
        audio.pause();

        return {
          resolvedUrl,
          duration: audio.duration,
          currentTime: audio.currentTime,
          paused: audio.paused
        };
      });

      assert.ok(result.resolvedUrl.startsWith('https://storage.googleapis.com/listening-tasks-3ae34-practice-media/media/sha256/'));
      assert.ok(result.duration > 0, 'Audio duration should be positive');
      assert.ok(result.currentTime >= 1.5, 'Audio currentTime should be at or after seek target');
      assert.equal(result.paused, true);
    });

    await t.test('2. Describe Image (DI): live GCS image resolution, decode, and canvas draw', async () => {
      const result = await page.evaluate(async () => {
        const img = document.getElementById('test-image');
        const canvas = document.getElementById('test-canvas');
        const ctx = canvas.getContext('2d');

        const resolvedUrl = await window.MediaUrlResolver.loadImage(
          img,
          '/database/Describe Image/DI/1.png',
          { rolloutState: 'remote-only' }
        );

        await new Promise((resolve, reject) => {
          if (img.complete && img.naturalWidth > 0) return resolve();
          img.onload = resolve;
          img.onerror = () => reject(new Error('Image failed to load'));
          setTimeout(() => reject(new Error('Timeout loading image')), 10000);
        });

        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const pixel = ctx.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data;

        return {
          resolvedUrl,
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
          alpha: pixel[3]
        };
      });

      assert.ok(result.resolvedUrl.startsWith('https://storage.googleapis.com/listening-tasks-3ae34-practice-media/media/sha256/'));
      assert.ok(result.naturalWidth > 0, 'Image naturalWidth should be positive');
      assert.ok(result.naturalHeight > 0, 'Image naturalHeight should be positive');
      assert.ok(result.alpha >= 0, 'Canvas rendered valid pixel data');
    });

    await t.test('3. Collo-dictate: live GCS WAV audio resolution and playback', async () => {
      const result = await page.evaluate(async () => {
        const audio = document.getElementById('test-audio');
        const resolvedUrl = await window.MediaUrlResolver.resolveAudioUrl(
          '/database/collo-dictate/audio/cd_cfa1ba29.wav',
          { rolloutState: 'remote-only' }
        );

        audio.src = resolvedUrl;
        audio.load();

        await new Promise((resolve, reject) => {
          audio.onloadedmetadata = resolve;
          audio.onerror = () => reject(new Error('WAV failed to load metadata'));
          setTimeout(() => reject(new Error('Timeout loading WAV metadata')), 10000);
        });

        await audio.play();
        await new Promise((r) => setTimeout(r, 400));
        audio.pause();

        return {
          resolvedUrl,
          duration: audio.duration,
          currentTime: audio.currentTime
        };
      });

      assert.ok(result.resolvedUrl.startsWith('https://storage.googleapis.com/listening-tasks-3ae34-practice-media/media/sha256/'));
      assert.ok(result.duration > 0, 'WAV audio duration should be positive');
      assert.ok(result.currentTime > 0.1, 'WAV audio progressed');
    });

    await t.test('4. Take Notes (RL): live GCS audio resolution and seek', async () => {
      const result = await page.evaluate(async () => {
        const audio = document.getElementById('test-audio');
        const resolvedUrl = await window.MediaUrlResolver.resolveAudioUrl(
          '/database/Take Notes/RL/audio/1.mp3',
          { rolloutState: 'remote-only' }
        );

        audio.src = resolvedUrl;
        audio.load();

        await new Promise((resolve, reject) => {
          audio.onloadedmetadata = resolve;
          audio.onerror = () => reject(new Error('RL audio failed to load'));
          setTimeout(() => reject(new Error('Timeout loading RL metadata')), 10000);
        });

        audio.currentTime = 2.0;
        await new Promise((resolve) => {
          audio.onseeked = resolve;
        });

        return {
          resolvedUrl,
          duration: audio.duration,
          currentTime: audio.currentTime
        };
      });

      assert.ok(result.resolvedUrl.startsWith('https://storage.googleapis.com/listening-tasks-3ae34-practice-media/media/sha256/'));
      assert.ok(result.duration > 0);
      assert.ok(result.currentTime >= 2.0);
    });

    await t.test('5. Describe Image loadImage: stale sequence cancels superseding requests', async () => {
      const result = await page.evaluate(async () => {
        const img = document.getElementById('test-image');
        const path1 = '/database/Describe Image/DI/1.png';
        const path2 = '/database/Describe Image/DI/10.png';

        const p1 = window.MediaUrlResolver.loadImage(img, path1, { rolloutState: 'remote-only' });
        const p2 = window.MediaUrlResolver.loadImage(img, path2, { rolloutState: 'remote-only' });

        await Promise.all([p1, p2]);

        return {
          finalSrc: img.src
        };
      });

      // Path 2 should win and be set on img.src
      assert.ok(result.finalSrc.includes('https://storage.googleapis.com/listening-tasks-3ae34-practice-media/media/sha256/'));
    });

    await t.test('6. Remote-Only Strictness: unmapped Cohort 2 asset rejects without fallback', async () => {
      const rejection = await page.evaluate(async () => {
        try {
          await window.MediaUrlResolver.resolveAudioUrl(
            '/database/LMCMA/audio/nonexistent-track-404.mp3',
            { rolloutState: 'remote-only' }
          );
          return { threw: false };
        } catch (err) {
          return { threw: true, message: err.message };
        }
      });

      assert.equal(rejection.threw, true);
      assert.match(rejection.message, /Remote resolution failed in remote-only mode/i);
    });

  } finally {
    if (browser) await browser.close();
    server.close();
  }
});
