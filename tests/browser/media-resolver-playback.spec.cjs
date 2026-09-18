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

    if (parsedUrl.pathname === '/' || parsedUrl.pathname === '/test-resolver.html') {
      res.writeHead(200, {
        'Content-Type': 'text/html',
        'Access-Control-Allow-Origin': '*'
      });
      res.end('<!DOCTYPE html><html><head><meta charset="utf-8"><title>MediaUrlResolver Browser Test</title></head><body><audio id="test-audio"></audio><script src="/js/media-url-resolver.js"></script></body></html>');
      return;
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const mimeTypes = {
        '.js': 'application/javascript',
        '.json': 'application/json',
        '.html': 'text/html',
        '.mp3': 'audio/mpeg'
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

test('MediaUrlResolver Playwright Delivery Suite (live GCS + Chromium)', async (t) => {
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
    await page.goto(BASE_ORIGIN + '/test-resolver.html');

    const hasResolver = await page.evaluate(() => !!window.MediaUrlResolver);
    assert.equal(hasResolver, true, 'window.MediaUrlResolver should be defined in browser');

    await t.test('1. Read Aloud: live GCS audio resolution and playback progression (remote-only)', async () => {
      const result = await page.evaluate(async () => {
        const audio = document.getElementById('test-audio');
        const resolvedUrl = await window.MediaUrlResolver.resolveAudioUrl(
          '/database/RA/Voice/audio/Audio by folder/1/RA_1_af_alloy_100.mp3',
          { rolloutState: 'remote-only' }
        );

        audio.src = resolvedUrl;
        audio.load();

        await new Promise((resolve, reject) => {
          audio.onloadedmetadata = resolve;
          audio.onerror = () => reject(new Error('Audio failed to load metadata: ' + (audio.error ? audio.error.message : 'unknown')));
          setTimeout(() => reject(new Error('Timeout loading audio metadata')), 10000);
        });

        await audio.play();
        await new Promise((r) => setTimeout(r, 600));
        audio.pause();

        return {
          resolvedUrl,
          duration: audio.duration,
          currentTime: audio.currentTime,
          paused: audio.paused
        };
      });

      assert.ok(
        result.resolvedUrl.startsWith('https://storage.googleapis.com/listening-tasks-3ae34-practice-media/media/sha256/0ac3e88e6e516eac81c9cf2202b35398da0ec39bf0ddd841954d6dd4498115f6.mp3'),
        'Resolved to expected content-addressed GCS URL'
      );
      assert.ok(result.duration > 0, 'Audio duration should be positive');
      assert.ok(result.currentTime > 0.3, 'Audio currentTime should have advanced during playback');
      assert.equal(result.paused, true, 'Audio was paused after play verification');
    });

    await t.test('2. Summarize Spoken Text: live GCS audio resolution and playback progression (remote-only)', async () => {
      const result = await page.evaluate(async () => {
        const audio = document.getElementById('test-audio');
        const resolvedUrl = await window.MediaUrlResolver.resolveAudioUrl(
          '/database/SST/audio/1/SST_1_af_bella.mp3',
          { rolloutState: 'remote-only' }
        );

        audio.src = resolvedUrl;
        audio.load();

        await new Promise((resolve, reject) => {
          audio.onloadedmetadata = resolve;
          audio.onerror = () => reject(new Error('Audio failed to load metadata: ' + (audio.error ? audio.error.message : 'unknown')));
          setTimeout(() => reject(new Error('Timeout loading SST audio metadata')), 10000);
        });

        await audio.play();
        await new Promise((r) => setTimeout(r, 600));
        audio.pause();

        return {
          resolvedUrl,
          duration: audio.duration,
          currentTime: audio.currentTime
        };
      });

      assert.ok(
        result.resolvedUrl.startsWith('https://storage.googleapis.com/listening-tasks-3ae34-practice-media/media/sha256/9a5d54c050d0325f48762398d1bf5dbaee81ccd8709ae83da928cb918a984a9a.mp3'),
        'SST resolved to expected content-addressed GCS URL'
      );
      assert.ok(result.duration > 0, 'SST audio duration should be positive');
      assert.ok(result.currentTime > 0.3, 'SST audio currentTime advanced');
    });

    await t.test('3. Observable Fallback: unmapped path triggers bel:media-fallback event and local path', async () => {
      const fallbackResult = await page.evaluate(async () => {
        let capturedEvent = null;
        window.addEventListener('bel:media-fallback', (e) => {
          capturedEvent = e.detail;
        }, { once: true });

        const unmappedPath = '/database/RA/Voice/audio/Audio by folder/9999/nonexistent.mp3';
        const resolvedUrl = await window.MediaUrlResolver.resolveAudioUrl(unmappedPath, {
          rolloutState: 'remote-with-fallback'
        });

        return {
          resolvedUrl,
          unmappedPath,
          capturedEvent
        };
      });

      assert.equal(fallbackResult.resolvedUrl, fallbackResult.unmappedPath, 'Returned legacy path upon fallback');
      assert.ok(fallbackResult.capturedEvent, 'Dispatched bel:media-fallback event');
      assert.equal(fallbackResult.capturedEvent.logicalPath, fallbackResult.unmappedPath);
      assert.equal(fallbackResult.capturedEvent.mode, 'RA');
    });

    await t.test('4. Rapid Navigation Concurrency: loadAudio cancels stale in-flight resolution', async () => {
      const result = await page.evaluate(async () => {
        const audio = document.getElementById('test-audio');
        const path1 = '/database/RA/Voice/audio/Audio by folder/1/RA_1_af_alloy_100.mp3';
        const path2 = '/database/SST/audio/1/SST_1_af_bella.mp3';

        const p1 = window.MediaUrlResolver.loadAudio(audio, path1, { rolloutState: 'remote-only' });
        const p2 = window.MediaUrlResolver.loadAudio(audio, path2, { rolloutState: 'remote-only' });

        await Promise.all([p1, p2]);

        return {
          finalSrc: audio.src
        };
      });

      assert.ok(
        result.finalSrc.includes('9a5d54c050d0325f48762398d1bf5dbaee81ccd8709ae83da928cb918a984a9a.mp3'),
        'Final audio.src matches the latest requested asset (path2), not the superseded asset (path1)'
      );
    });

    await t.test('5. Speech Coach: segmented micro-clip GCS resolution and playback progression', async () => {
      const result = await page.evaluate(async () => {
        const audio = document.getElementById('test-audio');
        const clipPath = '/database/RA/speech-coach-audio/v1/clips/03/0377aa5df43feaadcb6ea137a9aad78b026486582ed6b0c04cb81c8c46c833ae.mp3';
        const resolvedUrl = await window.MediaUrlResolver.resolveAudioUrl(clipPath, { rolloutState: 'remote-only' });

        audio.src = resolvedUrl;
        audio.load();

        await new Promise((resolve, reject) => {
          audio.onloadedmetadata = resolve;
          audio.onerror = () => reject(new Error('Failed to load clip audio: ' + (audio.error ? audio.error.message : 'unknown')));
          setTimeout(() => reject(new Error('Timeout loading clip metadata')), 10000);
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

      assert.ok(result.resolvedUrl.startsWith('https://storage.googleapis.com/listening-tasks-3ae34-practice-media/media/sha256/'), 'Resolved to GCS content-addressed URL');
      assert.ok(result.duration > 0, 'Clip duration is positive');
      assert.ok(result.currentTime > 0.1, 'Clip currentTime progressed');
    });

    await t.test('6. Byte-range seeking: seek forward on GCS audio and resume progression', async () => {
      const result = await page.evaluate(async () => {
        const audio = document.getElementById('test-audio');
        const sstPath = '/database/SST/audio/1/SST_1_af_bella.mp3';
        const resolvedUrl = await window.MediaUrlResolver.resolveAudioUrl(sstPath, { rolloutState: 'remote-only' });

        audio.src = resolvedUrl;
        audio.load();

        await new Promise((resolve, reject) => {
          audio.onloadedmetadata = resolve;
          audio.onerror = () => reject(new Error('Failed to load audio for seeking'));
          setTimeout(() => reject(new Error('Timeout loading metadata')), 10000);
        });

        // Seek forward to 5 seconds
        audio.currentTime = 5.0;
        await new Promise((resolve) => {
          audio.onseeked = resolve;
          setTimeout(resolve, 3000);
        });

        await audio.play();
        await new Promise((r) => setTimeout(r, 500));
        audio.pause();

        return {
          duration: audio.duration,
          currentTime: audio.currentTime
        };
      });

      assert.ok(result.currentTime >= 5.2, `CurrentTime (${result.currentTime}) should be >= 5.2s after seeking to 5s and playing for 500ms`);
    });

    await t.test('7. Strict remote-only defect: unmapped asset rejects with defect in browser', async () => {
      const result = await page.evaluate(async () => {
        try {
          await window.MediaUrlResolver.resolveAudioUrl('/database/RA/Voice/audio/Audio by folder/9999/does_not_exist.mp3', {
            rolloutState: 'remote-only'
          });
          return { threw: false };
        } catch (err) {
          return { threw: true, message: err.message };
        }
      });

      assert.equal(result.threw, true, 'Must throw error on unmapped asset in remote-only mode');
      assert.match(result.message, /Remote resolution failed in remote-only mode/i);
    });

  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
