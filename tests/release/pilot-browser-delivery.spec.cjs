'use strict';

const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_BUCKET_NAME = 'listening-tasks-3ae34-practice-media';
const BASE_GCS_URL = `https://storage.googleapis.com/${DEFAULT_BUCKET_NAME}`;

// Representative pilot objects across the categories
const SAMPLE_MP3 = {
  name: 'RA Voice Alloy (US Female)',
  storageKey: 'media/sha256/26e382d3fd441d4ee5fc07b539414d6eaeb2491e84ce7e0129bc62c040d8594e.mp3',
  expectedSha256: '26e382d3fd441d4ee5fc07b539414d6eaeb2491e84ce7e0129bc62c040d8594e',
  contentType: 'audio/mpeg'
};

const SAMPLE_WAV = {
  name: 'Collo-Dictate WAV Audio',
  storageKey: 'media/sha256/d4c9940a5937e82a91fa9a610f62706a5d918cd36bd4755da35bc266a77af810.wav',
  expectedSha256: 'd4c9940a5937e82a91fa9a610f62706a5d918cd36bd4755da35bc266a77af810',
  contentType: 'audio/wav'
};

const SAMPLE_PNG = {
  name: 'Describe Image PNG (1.png)',
  storageKey: 'media/sha256/55694247502c1f51feae07310578aa271fc1ec93e78f9f7435f448c484042838.png',
  expectedSha256: '55694247502c1f51feae07310578aa271fc1ec93e78f9f7435f448c484042838',
  contentType: 'image/png'
};

const SAMPLE_JPG = {
  name: 'Describe Image JPG (1001.jpg)',
  storageKey: 'media/sha256/15d9a9f2425d76d4a0466be91a131b0f5b9cb79e7c10b7f87c53d9eeb459f635.jpg',
  expectedSha256: '15d9a9f2425d76d4a0466be91a131b0f5b9cb79e7c10b7f87c53d9eeb459f635',
  contentType: 'image/jpeg'
};

test.describe('GCS Direct Delivery & Browser Compatibility Verification', () => {
  test.beforeEach(async ({ page }) => {
    // Disable any local cache or service worker interceptors
    await page.goto('about:blank');
  });

  test('1. Browser Fetch & CORS headers over GCS without local fallback', async ({ page }) => {
    const targetUrl = `${BASE_GCS_URL}/${SAMPLE_MP3.storageKey}`;
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

    expect(result.status).toBe(200);
    expect(result.ok).toBe(true);
    expect(result.contentType).toBe(SAMPLE_MP3.contentType);
    expect(result.sha256).toBe(SAMPLE_MP3.expectedSha256);
  });

  test('2. Audio element loading, progression, and seeking on remote GCS URL', async ({ page }) => {
    const targetUrl = `${BASE_GCS_URL}/${SAMPLE_MP3.storageKey}`;
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
            // Test seeking halfway
            const targetSeek = Math.min(1.5, audio.duration / 2);
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

        audio.addEventListener('error', (e) => {
          clearTimeout(timeout);
          reject(new Error(`Audio element error: ${audio.error ? audio.error.message : 'unknown'}`));
        });
      });
    }, targetUrl);

    expect(playbackResult.played).toBe(true);
    expect(playbackResult.seeked).toBe(true);
    expect(playbackResult.duration).toBeGreaterThan(0);
    expect(playbackResult.positionAfterSeek).toBeGreaterThan(0.5);
  });

  test('3. Web Audio API decoding (AudioContext.decodeAudioData) on MP3 and WAV', async ({ page }) => {
    const mp3Url = `${BASE_GCS_URL}/${SAMPLE_MP3.storageKey}`;
    const wavUrl = `${BASE_GCS_URL}/${SAMPLE_WAV.storageKey}`;

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

    expect(decodeResults.mp3Data.duration).toBeGreaterThan(0);
    expect(decodeResults.mp3Data.numberOfChannels).toBeGreaterThanOrEqual(1);
    expect(decodeResults.wavData.duration).toBeGreaterThan(0);
    expect(decodeResults.wavData.numberOfChannels).toBeGreaterThanOrEqual(1);
  });

  test('4. Image decoding and canvas render on PNG and JPG', async ({ page }) => {
    const pngUrl = `${BASE_GCS_URL}/${SAMPLE_PNG.storageKey}`;
    const jpgUrl = `${BASE_GCS_URL}/${SAMPLE_JPG.storageKey}`;

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

    expect(imageResults.pngData.hasPixels).toBe(true);
    expect(imageResults.pngData.width).toBeGreaterThan(0);
    expect(imageResults.jpgData.hasPixels).toBe(true);
    expect(imageResults.jpgData.width).toBeGreaterThan(0);
  });

  test('5. Audio interruption and pause/resume recovery', async ({ page }) => {
    const targetUrl = `${BASE_GCS_URL}/${SAMPLE_MP3.storageKey}`;
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

        audio.addEventListener('timeupdate', async () => {
          if (audio.currentTime > 0.1 && !pausedOnce) {
            pausedOnce = true;
            audio.pause();
            // Simulate 200ms network/user delay, then resume
            setTimeout(async () => {
              try {
                await audio.play();
              } catch (e) {
                clearTimeout(timeout);
                reject(e);
              }
            }, 200);
          } else if (pausedOnce && audio.currentTime > 0.3 && !resumedOnce) {
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

        audio.addEventListener('error', (e) => {
          clearTimeout(timeout);
          reject(new Error(`Audio element error during recovery: ${audio.error ? audio.error.message : 'unknown'}`));
        });
      });
    }, targetUrl);

    expect(recoveryResult.pausedOnce).toBe(true);
    expect(recoveryResult.resumedOnce).toBe(true);
    expect(recoveryResult.finalTime).toBeGreaterThan(0.3);
  });
});
