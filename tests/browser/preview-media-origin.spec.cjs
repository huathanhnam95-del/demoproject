'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const PREVIEW_URL = 'https://listening-tasks-3ae34--preview-v2012-n0bzws0k.web.app';

test('Preview Channel Origin & Live Media Verification (Chrome / Chromium)', async (t) => {
  let browser;
  let context;
  let page;

  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--autoplay-policy=no-user-gesture-required']
    });
    context = await browser.newContext({
      viewport: { width: 1280, height: 800 }
    });
    page = await context.newPage();

    // Set welcome modal flag before navigation
    await page.addInitScript(() => {
      sessionStorage.setItem('pte_welcome_seen', 'true');
    });

    console.log('[Test] Navigating to preview URL:', PREVIEW_URL);
    const response = await page.goto(PREVIEW_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    assert.equal(response.status(), 200, 'Preview origin must return HTTP 200');

    // 1. Verify Version indicator V2.0.12
    const versionText = await page.evaluate(() => {
      const el = document.getElementById('version-indicator');
      return el ? el.textContent.trim() : null;
    });
    console.log('[Test] Deployed version indicator:', versionText);
    assert.equal(versionText, 'V2.0.12', 'Version indicator must show V2.0.12 on preview channel');

    // 2. Verify MediaUrlResolver availability
    const hasResolver = await page.evaluate(() => typeof window.MediaUrlResolver === 'object');
    assert.equal(hasResolver, true, 'window.MediaUrlResolver must be present');

    // 3. Test Remote-Only resolution and GCS fetch from preview origin
    const testCases = [
      {
        name: 'Read Aloud audio',
        path: 'public/database/RA/Voice/audio/Audio by folder/1/RA_1_af_alloy_100.mp3',
        expectedPrefix: 'media/sha256/'
      },
      {
        name: 'Summarize Spoken Text audio',
        path: 'public/database/SST/audio/1/SST_1_af_bella.mp3',
        expectedPrefix: 'media/sha256/'
      },
      {
        name: 'Highlight Incorrect Words audio',
        path: 'public/database/Highlight Incorrect Words/audio/1/HIW_1_af_bella.mp3',
        expectedPrefix: 'media/sha256/'
      }
    ];

    for (const tc of testCases) {
      console.log(`[Test] Resolving ${tc.name}: ${tc.path}`);
      const resolveResult = await page.evaluate(async (assetPath) => {
        // Enforce remote-only rollout mode
        const url = await window.MediaUrlResolver.resolveMediaUrl(assetPath, {
          rolloutState: 'remote-only'
        });

        // Perform actual fetch with CORS mode
        const res = await fetch(url, {
          mode: 'cors',
          headers: { 'Range': 'bytes=0-2048' }
        });

        return {
          resolvedUrl: url,
          status: res.status,
          type: res.type,
          contentRange: res.headers.get('content-range'),
          corsHeader: res.headers.get('access-control-allow-origin')
        };
      }, tc.path);

      console.log(`[Test] ${tc.name} resolved to:`, resolveResult.resolvedUrl);
      console.log(`[Test] HTTP Status: ${resolveResult.status}, CORS: ${resolveResult.corsHeader}, Range: ${resolveResult.contentRange}`);

      assert.ok(resolveResult.resolvedUrl.startsWith('https://storage.googleapis.com/listening-tasks-3ae34-practice-media/'), 'Must resolve to GCS bucket');
      assert.ok(resolveResult.status === 200 || resolveResult.status === 206, 'Must return HTTP 200 or 206');
    }

    // 4. Test Audio Element Playback in Browser
    const audioPlaybackResult = await page.evaluate(async () => {
      const audioUrl = await window.MediaUrlResolver.resolveMediaUrl('public/database/RA/Voice/audio/Audio by folder/1/RA_1_af_alloy_100.mp3', {
        rolloutState: 'remote-only'
      });

      return new Promise((resolve, reject) => {
        const audio = new Audio();
        audio.crossOrigin = 'anonymous';
        audio.src = audioUrl;

        const timeout = setTimeout(() => {
          reject(new Error('Audio load timed out after 10s'));
        }, 10000);

        audio.oncanplaythrough = () => {
          clearTimeout(timeout);
          resolve({
            canPlay: true,
            duration: audio.duration,
            readyState: audio.readyState
          });
        };

        audio.onerror = (e) => {
          clearTimeout(timeout);
          reject(new Error('Audio playback error code: ' + (audio.error ? audio.error.code : 'unknown')));
        };

        audio.load();
      });
    });

    console.log('[Test] Browser <audio> playback element verification:', audioPlaybackResult);
    assert.equal(audioPlaybackResult.canPlay, true, 'Audio element canplaythrough must fire');
    assert.ok(audioPlaybackResult.duration > 0, 'Audio duration must be > 0');

    // 5. Test Connected Speech index prompt data
    const csIndexResult = await page.evaluate(async () => {
      const res = await fetch('/database/RA/connected-speech-index.json');
      const data = await res.json();
      return {
        status: res.status,
        indexVersion: data.indexVersion,
        generatedAt: data.generatedAt,
        promptsCount: Array.isArray(data.prompts) ? data.prompts.length : 0,
        samplePrompt: data.prompts && data.prompts[0] ? {
          questionId: data.prompts[0].questionId,
          hasAnalysis: Boolean(data.prompts[0].hasAnyConnectedSpeech && data.prompts[0].representativeExamples && data.prompts[0].representativeExamples.length > 0)
        } : null
      };
    });

    console.log('[Test] Connected speech index data verification:', csIndexResult);
    assert.equal(csIndexResult.status, 200, 'Connected speech index must return HTTP 200');
    assert.equal(csIndexResult.indexVersion, '1');
    assert.ok(csIndexResult.promptsCount > 1000, 'Must have > 1,000 prompts in index');
    assert.ok(csIndexResult.samplePrompt.hasAnalysis, 'Sample prompt must have connected speech analysis');

  } finally {
    if (page) await page.close();
    if (context) await context.close();
    if (browser) await browser.close();
  }
});
