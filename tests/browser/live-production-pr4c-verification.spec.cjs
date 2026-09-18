'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const PROD_ORIGIN = 'https://listening-tasks-3ae34.web.app';
const CUSTOM_DOMAIN = 'https://betterenglishlearning.com';

test('Production Live Verification: PR 4c Practice Media Delivery on listening-tasks-3ae34', async (t) => {
  // 1. Verify production runtime manifest
  await t.test('1. Verify live /media-release.json is pinned to pub-20260918-all-media', async () => {
    const res = await fetch(PROD_ORIGIN + '/media-release.json', { cache: 'no-store' });
    assert.equal(res.status, 200, 'HTTP 200 for /media-release.json');
    const data = await res.json();
    assert.equal(data.publicationId, 'pub-20260918-all-media');
    assert.equal(data.defaultRolloutState, 'remote-with-fallback');
    assert.equal(Object.keys(data.modes).length, 20, 'All 20 modes configured');
    for (const [mode, config] of Object.entries(data.modes)) {
      assert.equal(config.state, 'remote-only', `Mode ${mode} must be remote-only`);
      assert.ok(config.shardKey.startsWith('catalogs/pub-20260918-all-media/'), `Mode ${mode} shardKey must point to pub-20260918-all-media`);
    }
  });

  // 2. Verify 404 rewrite protects against SPA fallback on externalized media paths
  await t.test('2. Verify legacy media path returns 404/Not-Found and NOT SPA index.html', async () => {
    const testPaths = [
      '/database/RA/Voice/audio/Audio by folder/1/RA_1_af_alloy_100.mp3',
      '/database/SST/audio/1/SST_1_af_bella.mp3',
      '/database/Highlight Incorrect Words/audio/1/HIW_1_af_bella.mp3',
      '/database/Describe Image/DI/1.png',
      '/database/RFIB/audio/0001_Full_F_100.mp3'
    ];

    for (const p of testPaths) {
      const res = await fetch(PROD_ORIGIN + p, { cache: 'no-store' });
      const text = await res.text();
      assert.ok(res.status === 404 || text.includes('Page Not Found'), `Legacy path ${p} must return 404 or Page Not Found`);
      assert.ok(!text.includes('practice-layout') && !text.includes('tab-practice'), 'Must not serve SPA practice application');
    }
  });

  // 3. Browser Live Chromium Verification
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

    // Navigate to production origin
    const navRes = await page.goto(PROD_ORIGIN + '/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
    assert.ok(navRes.status() === 200 || navRes.status() === 304, 'Loaded production index.html');

    // Wait for MediaUrlResolver
    await page.waitForFunction(() => typeof window.MediaUrlResolver !== 'undefined', { timeout: 15000 });

    // Initialize resolver with live manifest
    await page.evaluate(async () => {
      window.testAudio = document.createElement('audio');
      document.body.appendChild(window.testAudio);
      window.testImg = document.createElement('img');
      document.body.appendChild(window.testImg);
      window.testCanvas = document.createElement('canvas');
      window.testCanvas.width = 300;
      window.testCanvas.height = 200;
      document.body.appendChild(window.testCanvas);
      await window.MediaUrlResolver.init();
    });

    // Test RA voice variants, 100% and 80% speed, seeking, and playback progression
    await t.test('3. Read Aloud: live GCS audio resolution, voice switching, seeking, and decode', async () => {
      const result = await page.evaluate(async () => {
        const audio = window.testAudio;
        const testPrompts = [
          { path: '/database/RA/Voice/audio/Audio by folder/1/RA_1_af_alloy_100.mp3', label: 'alloy 100%' },
          { path: '/database/RA/Voice/audio/Audio by folder/1/RA_1_am_fenrir_100.mp3', label: 'fenrir 100%' },
          { path: '/database/RA/Voice/audio/Audio by folder/1/RA_1_af_alloy_80.mp3', label: 'alloy 80%' }
        ];

        const outcomes = [];
        for (const item of testPrompts) {
          const resolvedUrl = await window.MediaUrlResolver.resolveAudioUrl(item.path);
          audio.src = resolvedUrl;
          audio.load();

          await new Promise((resolve, reject) => {
            audio.onloadedmetadata = resolve;
            audio.onerror = () => reject(new Error('Failed to load metadata for ' + item.label));
            setTimeout(() => reject(new Error('Timeout loading metadata for ' + item.label)), 10000);
          });

          // Seek to 1s
          audio.currentTime = 1.0;
          await new Promise((r) => { audio.onseeked = r; });

          await audio.play();
          await new Promise((r) => setTimeout(r, 400));
          audio.pause();

          outcomes.push({
            label: item.label,
            resolvedUrl,
            duration: audio.duration,
            currentTime: audio.currentTime
          });
        }
        return outcomes;
      });

      for (const out of result) {
        assert.ok(out.resolvedUrl.startsWith('https://storage.googleapis.com/listening-tasks-3ae34-practice-media/media/sha256/'), `${out.label} resolved to GCS`);
        assert.ok(out.duration > 0, `${out.label} duration positive`);
        assert.ok(out.currentTime >= 1.0, `${out.label} currentTime advanced`);
      }
    });

    // Test SST live audio playback
    await t.test('4. Summarize Spoken Text: live GCS audio decode and playback progression', async () => {
      const result = await page.evaluate(async () => {
        const audio = window.testAudio;
        const resolvedUrl = await window.MediaUrlResolver.resolveAudioUrl('/database/SST/audio/1/SST_1_af_bella.mp3');
        audio.src = resolvedUrl;
        audio.load();

        await new Promise((resolve, reject) => {
          audio.onloadedmetadata = resolve;
          audio.onerror = () => reject(new Error('SST metadata error'));
          setTimeout(() => reject(new Error('Timeout SST')), 10000);
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
      assert.ok(result.duration > 0);
      assert.ok(result.currentTime > 0.1);
    });

    // Test Describe Image live image loading, decode, and canvas render
    await t.test('5. Describe Image (DI): live GCS image resolution, decode, and canvas draw without CORS taint', async () => {
      const result = await page.evaluate(async () => {
        const img = window.testImg;
        const canvas = window.testCanvas;
        const ctx = canvas.getContext('2d');

        const resolvedUrl = await window.MediaUrlResolver.loadImage(img, '/database/Describe Image/DI/1.png');

        await new Promise((resolve, reject) => {
          if (img.complete && img.naturalWidth > 0) return resolve();
          img.onload = resolve;
          img.onerror = () => reject(new Error('DI image failed to load'));
          setTimeout(() => reject(new Error('Timeout loading DI image')), 10000);
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
      assert.ok(result.naturalWidth > 0, 'Image decoded successfully with positive naturalWidth');
      assert.ok(result.naturalHeight > 0, 'Image naturalHeight positive');
      assert.ok(result.alpha >= 0, 'Canvas rendered without SecurityError (CORS valid on production origin)');
    });

    // Test HIW live audio playback and seek
    await t.test('6. Highlight Incorrect Words (HIW): live GCS audio resolution and seek playback', async () => {
      const result = await page.evaluate(async () => {
        const audio = window.testAudio;
        const resolvedUrl = await window.MediaUrlResolver.resolveAudioUrl('/database/Highlight Incorrect Words/audio/1/HIW_1_af_bella.mp3');
        audio.src = resolvedUrl;
        audio.load();

        await new Promise((resolve, reject) => {
          audio.onloadedmetadata = resolve;
          audio.onerror = () => reject(new Error('HIW metadata error'));
          setTimeout(() => reject(new Error('Timeout HIW')), 10000);
        });

        audio.currentTime = 2.0;
        await new Promise((r) => { audio.onseeked = r; });

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
      assert.ok(result.duration > 0);
      assert.ok(result.currentTime >= 2.0);
    });

    // Test Collo-dictate WAV live audio playback
    await t.test('7. Collo-dictate: live GCS WAV audio resolution and playback', async () => {
      const result = await page.evaluate(async () => {
        const audio = window.testAudio;
        const resolvedUrl = await window.MediaUrlResolver.resolveAudioUrl('/database/collo-dictate/audio/cd_cfa1ba29.wav');
        audio.src = resolvedUrl;
        audio.load();

        await new Promise((resolve, reject) => {
          audio.onloadedmetadata = resolve;
          audio.onerror = () => reject(new Error('Collo-dictate WAV error'));
          setTimeout(() => reject(new Error('Timeout WAV')), 10000);
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
      assert.ok(result.duration > 0);
      assert.ok(result.currentTime > 0.1);
    });

    // Test Take Notes (RL) live audio playback and seek
    await t.test('8. Take Notes (RL): live GCS audio resolution and seek', async () => {
      const result = await page.evaluate(async () => {
        const audio = window.testAudio;
        const resolvedUrl = await window.MediaUrlResolver.resolveAudioUrl('/database/Take Notes/RL/audio/1.mp3');
        audio.src = resolvedUrl;
        audio.load();

        await new Promise((resolve, reject) => {
          audio.onloadedmetadata = resolve;
          audio.onerror = () => reject(new Error('RL metadata error'));
          setTimeout(() => reject(new Error('Timeout RL')), 10000);
        });

        audio.currentTime = 1.5;
        await new Promise((r) => { audio.onseeked = r; });

        return {
          resolvedUrl,
          duration: audio.duration,
          currentTime: audio.currentTime
        };
      });

      assert.ok(result.resolvedUrl.startsWith('https://storage.googleapis.com/listening-tasks-3ae34-practice-media/media/sha256/'));
      assert.ok(result.duration > 0);
      assert.ok(result.currentTime >= 1.5);
    });

    // Test RFIB live audio decode
    await t.test('9. Reading FIB (RFIB): live GCS audio resolution and decode', async () => {
      const result = await page.evaluate(async () => {
        const audio = window.testAudio;
        const resolvedUrl = await window.MediaUrlResolver.resolveAudioUrl('/database/RFIB/audio/0001_Full_F_100.mp3');
        audio.src = resolvedUrl;
        audio.load();

        await new Promise((resolve, reject) => {
          audio.onloadedmetadata = resolve;
          audio.onerror = () => reject(new Error('RFIB metadata error'));
          setTimeout(() => reject(new Error('Timeout RFIB')), 10000);
        });

        return {
          resolvedUrl,
          duration: audio.duration
        };
      });

      assert.ok(result.resolvedUrl.startsWith('https://storage.googleapis.com/listening-tasks-3ae34-practice-media/media/sha256/'));
      assert.ok(result.duration > 0);
    });

    // Test multiple Cohort 2 modes: LMCMA, LMCSA, HCS, SMW, RTS, type, speak
    await t.test('10. Multi-mode Catalog Resolution: LMCMA, LMCSA, HCS, SMW, RTS, type, speak', async () => {
      const testCases = [
        { mode: 'LMCMA', path: '/database/LMCMA/audio/1/LMCMA_1_af_heart.mp3' },
        { mode: 'LMCSA', path: '/database/LMCSA/audio/1/LMCSA_1_af_bella.mp3' },
        { mode: 'HCS', path: '/database/HCS/audio/1/HCS_1_af_bella.mp3' },
        { mode: 'SMW', path: '/database/SMW/audio/1/SMW_1_af_bella.mp3' },
        { mode: 'RTS', path: '/database/RTS/audio/RTS_1.mp3' },
        { mode: 'type', path: '/database/type/audio/1.mp3' },
        { mode: 'speak', path: '/database/speak/audio/1.mp3' }
      ];

      const outcomes = await page.evaluate(async (cases) => {
        const results = [];
        for (const c of cases) {
          try {
            const url = await window.MediaUrlResolver.resolveAudioUrl(c.path, { mode: c.mode });
            results.push({ mode: c.mode, url, success: url.startsWith('https://storage.googleapis.com/') });
          } catch (err) {
            results.push({ mode: c.mode, error: err.message, success: false });
          }
        }
        return results;
      }, testCases);

      for (const r of outcomes) {
        assert.equal(r.success, true, `Mode ${r.mode} resolution failed: ${r.error || 'bad url'}`);
      }
    });

    // Test rapid navigation concurrency
    await t.test('11. Rapid Navigation: cancels superseding requests cleanly', async () => {
      const result = await page.evaluate(async () => {
        const audio = window.testAudio;
        const p1 = window.MediaUrlResolver.loadAudio(audio, '/database/RA/Voice/audio/Audio by folder/1/RA_1_af_alloy_100.mp3');
        const p2 = window.MediaUrlResolver.loadAudio(audio, '/database/SST/audio/1/SST_1_af_bella.mp3');
        await Promise.all([p1, p2]);
        return { finalSrc: audio.src };
      });
      assert.ok(result.finalSrc.includes('https://storage.googleapis.com/listening-tasks-3ae34-practice-media/media/sha256/'));
    });

    // Test strict remote-only defect
    await t.test('12. Remote-Only Strictness: unmapped asset rejects without local fallback', async () => {
      const rejection = await page.evaluate(async () => {
        try {
          await window.MediaUrlResolver.resolveAudioUrl('/database/RFIB/audio/unmapped-file-404.mp3');
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
  }
});
