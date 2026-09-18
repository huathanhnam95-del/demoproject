'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const DEFAULT_BUCKET_NAME = 'listening-tasks-3ae34-practice-media';
const BASE_GCS_URL = `https://storage.googleapis.com/${DEFAULT_BUCKET_NAME}`;

// Load the actual verified pilot summary
function loadPilotSummary() {
  const checkpointsBase = 'C:/Cursor AI/.media-checkpoints';
  const dirs = fs.readdirSync(checkpointsBase).filter(d => d.startsWith('pilot-')).sort().reverse();
  if (dirs.length === 0) throw new Error('No pilot summary found in .media-checkpoints');
  const summaryFile = path.join(checkpointsBase, dirs[0], 'pilot-summary.json');
  return JSON.parse(fs.readFileSync(summaryFile, 'utf8'));
}

test('Playwright Browser Delivery Suite against live GCS URLs', async (t) => {
  const summary = loadPilotSummary();
  const receipts = summary.objectUploadReceipts;

  const mp3Obj = receipts.find(r => r.storageKey.endsWith('.mp3'));
  const wavObj = receipts.find(r => r.storageKey.endsWith('.wav'));
  const pngObj = receipts.find(r => r.storageKey.endsWith('.png'));
  const jpgObj = receipts.find(r => r.storageKey.endsWith('.jpg'));

  assert.ok(mp3Obj, 'MP3 sample found in pilot');
  assert.ok(wavObj, 'WAV sample found in pilot');
  assert.ok(pngObj, 'PNG sample found in pilot');
  assert.ok(jpgObj, 'JPG sample found in pilot');

  console.log(`Testing Playwright against publication: ${summary.publicationId}`);

  const http = require('node:http');
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<!DOCTYPE html><html><body><h1>BEL GCS Delivery Test</h1></body></html>');
  });

  await new Promise((resolve) => server.listen(5000, '127.0.0.1', resolve));

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
    await page.goto('http://127.0.0.1:5000');

    // 1. Browser Fetch & CORS headers over GCS without local fallback
    await t.test('1. Browser Fetch & CORS headers over GCS without local fallback', async () => {
      const targetUrl = `${BASE_GCS_URL}/${mp3Obj.storageKey}`;
      const result = await page.evaluate(async (url) => {
        const resp = await fetch(url, { method: 'GET', mode: 'cors' });
        const buf = await resp.arrayBuffer();
        const hashBuf = await crypto.subtle.digest('SHA-256', buf);
        const hashHex = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
        return {
          status: resp.status,
          ok: resp.ok,
          contentType: resp.headers.get('content-type'),
          bytesLength: buf.byteLength,
          sha256: hashHex
        };
      }, targetUrl);

      assert.equal(result.status, 200);
      assert.equal(result.ok, true);
      assert.equal(result.contentType, 'audio/mpeg');
      assert.equal(result.bytesLength, mp3Obj.size);
      assert.equal(result.sha256, mp3Obj.sha256);
    });

    // 2. Audio element loading, progression, and seeking on remote GCS URL
    await t.test('2. Audio element loading, progression, and seeking on remote GCS URL', async () => {
      const targetUrl = `${BASE_GCS_URL}/${mp3Obj.storageKey}`;
      const playbackResult = await page.evaluate(async (url) => {
        return new Promise((resolve, reject) => {
          const audio = new Audio();
          audio.crossOrigin = 'anonymous';
          audio.src = url;

          let played = false;
          let seeked = false;
          const timeout = setTimeout(() => reject(new Error('Audio playback timed out after 10s')), 10000);

          audio.addEventListener('canplaythrough', async () => {
            try {
              await audio.play();
            } catch (e) {
              clearTimeout(timeout);
              return reject(e);
            }
          });

          audio.addEventListener('timeupdate', () => {
            if (audio.currentTime > 0.05 && !played) {
              played = true;
              const targetSeek = Math.min(1.0, audio.duration / 2);
              audio.currentTime = targetSeek;
            }
          });

          audio.addEventListener('seeked', () => {
            if (played && !seeked) {
              seeked = true;
              const finalPos = audio.currentTime;
              audio.pause();
              clearTimeout(timeout);
              resolve({
                played,
                seeked,
                duration: audio.duration,
                positionAfterSeek: finalPos
              });
            }
          });

          audio.addEventListener('error', () => {
            clearTimeout(timeout);
            reject(new Error(`Audio element error: ${audio.error ? audio.error.message : 'unknown'}`));
          });
        });
      }, targetUrl);

      assert.equal(playbackResult.played, true);
      assert.equal(playbackResult.seeked, true);
      assert.ok(playbackResult.duration > 0);
      assert.ok(playbackResult.positionAfterSeek > 0.3);
    });

    // 3. Web Audio API decoding on MP3 and WAV
    await t.test('3. Web Audio API decoding (AudioContext.decodeAudioData) on MP3 and WAV', async () => {
      const mp3Url = `${BASE_GCS_URL}/${mp3Obj.storageKey}`;
      const wavUrl = `${BASE_GCS_URL}/${wavObj.storageKey}`;

      const decodeResults = await page.evaluate(async ({ mp3, wav }) => {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

        async function decodeUrl(url) {
          const res = await fetch(url);
          const arrayBuf = await res.arrayBuffer();
          const decoded = await audioCtx.decodeAudioData(arrayBuf);
          return {
            duration: decoded.duration,
            sampleRate: decoded.sampleRate,
            numberOfChannels: decoded.numberOfChannels
          };
        }

        const mp3Data = await decodeUrl(mp3);
        const wavData = await decodeUrl(wav);
        await audioCtx.close();

        return { mp3Data, wavData };
      }, { mp3: mp3Url, wav: wavUrl });

      assert.ok(decodeResults.mp3Data.duration > 0, 'MP3 decoded duration > 0');
      assert.ok(decodeResults.mp3Data.numberOfChannels >= 1, 'MP3 channel count >= 1');
      assert.ok(decodeResults.wavData.duration > 0, 'WAV decoded duration > 0');
      assert.ok(decodeResults.wavData.numberOfChannels >= 1, 'WAV channel count >= 1');
    });

    // 4. Image decoding and canvas render on PNG and JPG
    await t.test('4. Image decoding and canvas render on PNG and JPG', async () => {
      const pngUrl = `${BASE_GCS_URL}/${pngObj.storageKey}`;
      const jpgUrl = `${BASE_GCS_URL}/${jpgObj.storageKey}`;

      const imageResults = await page.evaluate(async ({ png, jpg }) => {
        async function testImage(url) {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.src = url;
          await img.decode();

          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);

          return {
            width: img.naturalWidth,
            height: img.naturalHeight,
            hasPixels: canvas.width > 0 && canvas.height > 0
          };
        }

        const pngData = await testImage(png);
        const jpgData = await testImage(jpg);
        return { pngData, jpgData };
      }, { png: pngUrl, jpg: jpgUrl });

      assert.equal(imageResults.pngData.hasPixels, true);
      assert.ok(imageResults.pngData.width > 0);
      assert.equal(imageResults.jpgData.hasPixels, true);
      assert.ok(imageResults.jpgData.width > 0);
    });

    // 5. Audio interruption and pause/resume recovery
    await t.test('5. Audio interruption and pause/resume recovery', async () => {
      const targetUrl = `${BASE_GCS_URL}/${mp3Obj.storageKey}`;
      const recoveryResult = await page.evaluate(async (url) => {
        return new Promise((resolve, reject) => {
          const audio = new Audio();
          audio.crossOrigin = 'anonymous';
          audio.src = url;

          let pausedOnce = false;
          let resumedOnce = false;
          const timeout = setTimeout(() => reject(new Error('Recovery test timed out')), 10000);

          audio.addEventListener('canplaythrough', async () => {
            try {
              await audio.play();
            } catch (e) {
              clearTimeout(timeout);
              return reject(e);
            }
          });

          audio.addEventListener('timeupdate', () => {
            if (audio.currentTime > 0.05 && !pausedOnce) {
              pausedOnce = true;
              audio.pause();
              setTimeout(async () => {
                try {
                  await audio.play();
                } catch (e) {
                  clearTimeout(timeout);
                  reject(e);
                }
              }, 150);
            } else if (pausedOnce && audio.currentTime > 0.25 && !resumedOnce) {
              resumedOnce = true;
              audio.pause();
              clearTimeout(timeout);
              resolve({
                pausedOnce,
                resumedOnce,
                finalTime: audio.currentTime
              });
            }
          });

          audio.addEventListener('error', () => {
            clearTimeout(timeout);
            reject(new Error(`Audio element error during recovery: ${audio.error ? audio.error.message : 'unknown'}`));
          });
        });
      }, targetUrl);

      assert.equal(recoveryResult.pausedOnce, true);
      assert.equal(recoveryResult.resumedOnce, true);
      assert.ok(recoveryResult.finalTime > 0.2);
    });

  } finally {
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (server) server.close();
  }
});
