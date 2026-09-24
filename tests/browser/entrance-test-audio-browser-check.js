/* eslint-disable no-console */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');

const PUBLIC_DIR = path.resolve(__dirname, '../../public');

function createStaticServer() {
  return http.createServer((req, res) => {
    const rawUrl = req.url.split('?')[0];

    if (rawUrl === '/api/entrance-tests/session') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        testId: 'mock-test-id-12345',
        session: {
          sections: [
            {
              id: 'listen_write',
              titleVi: 'IV. Nghe & Viết',
              instructionVi: 'Hãy điền từ phù hợp',
              questions: [
                {
                  id: 'listen_write_q1',
                  type: 'fill',
                  sectionId: 'listen_write',
                  questionNumber: 1,
                  audioUrl: 'database/Entrance Test/Listening Q1.mp3',
                  parts: [{ type: 'text', text: 'Sentence 1' }, { type: 'blank', blankId: 'b1' }]
                },
                {
                  id: 'listen_write_q2',
                  type: 'fill',
                  sectionId: 'listen_write',
                  questionNumber: 2,
                  audioUrl: 'database/Entrance Test/Listening Q2.mp3',
                  parts: [{ type: 'text', text: 'Sentence 2' }, { type: 'blank', blankId: 'b2' }]
                }
              ]
            }
          ]
        },
        progress: {
          stepIndex: 3
        }
      }));
      return;
    }

    const safePath = path.normalize(decodeURIComponent(rawUrl)).replace(/^(\.\.[/\\])+/, '');
    const cleanPath = safePath === '/' ? '/entrance-test-ui-lab.html' : safePath;
    const filePath = path.join(PUBLIC_DIR, cleanPath);

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const contentTypes = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.mp3': 'audio/mpeg'
      };
      res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found: ' + safePath);
    }
  });
}

async function runCheck() {
  const server = createStaticServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`[Test] Local test server listening on ${baseUrl}`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const failedRequests = [];
  page.on('response', (response) => {
    if (response.status() >= 400) {
      failedRequests.push({ url: response.url(), status: response.status() });
    }
  });

  page.on('console', (msg) => {
    console.log(`[Browser ${msg.type()}] ${msg.text()}`);
  });

  try {
    // 1. Check entrance-test-ui-lab.html
    console.log('[Test] Loading entrance-test-ui-lab.html...');
    await page.goto(`${baseUrl}/entrance-test-ui-lab.html?skin=b`, { waitUntil: 'networkidle' });

    const hasResolver = await page.evaluate(() => typeof window.MediaUrlResolver?.loadAudio === 'function');
    assert.strictEqual(hasResolver, true, 'MediaUrlResolver must be available on window');

    // Switch to question view and navigate to Listening Q1 (index 11)
    console.log('[Test] Navigating to Listening Q1 (data-goq=11)...');
    await page.evaluate(() => {
      const fillAllBtn = document.querySelector('[data-test="fill-all"]');
      if (fillAllBtn) fillAllBtn.click();
    });
    await page.waitForTimeout(500);

    const q1State = await page.evaluate(async () => {
      const q1Btn = document.querySelector('[data-goq="11"]');
      const hasQ1Btn = Boolean(q1Btn);
      if (q1Btn) q1Btn.click();
      await new Promise((r) => setTimeout(r, 1000));
      const audio = document.querySelector('.player audio');
      const allAudios = Array.from(document.querySelectorAll('audio')).map((a) => ({ src: a.src, className: a.className }));
      return {
        hasQ1Btn,
        audioFound: Boolean(audio),
        audioSrc: audio ? audio.src : null,
        allAudios,
        playerFound: Boolean(document.querySelector('.player'))
      };
    });

    console.log('[Test] Q1 state:', JSON.stringify(q1State));
    const q1AudioSrc = q1State.audioSrc;
    assert.ok(q1AudioSrc && q1AudioSrc.includes('storage.googleapis.com'), 'Q1 audio src must resolve to GCS');
    assert.ok(q1AudioSrc.includes('664f653885f9b8e14629b51a5d06d8bbcc02a133e981cdb1388305bd9eb0d65f'), 'Q1 audio sha256 mismatch');

    // Navigate to Listening Q2 (index 12)
    console.log('[Test] Navigating to Listening Q2 (data-goq=12, reported student error task)...');
    const q2AudioSrc = await page.evaluate(async () => {
      const q2Btn = document.querySelector('[data-goq="12"]');
      if (q2Btn) q2Btn.click();
      await new Promise((r) => setTimeout(r, 1000));
      const audio = document.querySelector('.player audio');
      return audio ? audio.src : null;
    });

    console.log('[Test] Q2 resolved audio src:', q2AudioSrc);
    assert.ok(q2AudioSrc && q2AudioSrc.includes('storage.googleapis.com'), 'Q2 audio src must resolve to GCS');
    assert.ok(q2AudioSrc.includes('7faae63f5f8abe88694547aada408c98e24e4d12bcf7196c070f3e71e60ddba2'), 'Q2 audio sha256 mismatch');

    // Test playback / duration load of Q2
    const q2Duration = await page.evaluate(async () => {
      const audio = document.querySelector('.player audio');
      if (!audio) return null;
      if (audio.duration && !isNaN(audio.duration)) return audio.duration;
      return new Promise((resolve) => {
        audio.addEventListener('loadedmetadata', () => resolve(audio.duration), { once: true });
        audio.addEventListener('error', () => resolve(-1), { once: true });
        setTimeout(() => resolve(audio.duration || 0), 3000);
      });
    });
    console.log('[Test] Q2 audio duration:', q2Duration);
    assert.ok(typeof q2Duration === 'number' && q2Duration > 50, 'Q2 audio duration must be valid (>50s)');

    // Verify no 404s occurred for local database paths in lab
    const local404s = failedRequests.filter((r) => r.url.includes('/database/Entrance') || r.url.includes('Listening'));
    console.log('[Test] Lab local audio 404 count:', local404s.length);
    assert.strictEqual(local404s.length, 0, 'No local audio requests should 404 in lab: ' + JSON.stringify(local404s));

    // 2. Check entrance-test.html live student flow
    console.log('[Test] Loading entrance-test.html?token=test-mock-token...');
    await page.goto(`${baseUrl}/entrance-test.html?token=test-mock-token`, { waitUntil: 'networkidle' });

    // Wait for card and audio player
    await page.waitForSelector('.et-audio-player', { timeout: 5000 });

    const etAudioState = await page.evaluate(async () => {
      const audioEl = document.querySelector('.et-audio-player');
      if (!audioEl) return { found: false, src: null };
      // Wait for src to be populated if asynchronous
      if (!audioEl.src) {
        await new Promise((resolve) => {
          const timer = setInterval(() => {
            if (audioEl.src) {
              clearInterval(timer);
              resolve();
            }
          }, 50);
          setTimeout(() => { clearInterval(timer); resolve(); }, 2000);
        });
      }
      return { found: true, src: audioEl.src };
    });

    console.log('[Test] entrance-test.html student audio state:', JSON.stringify(etAudioState));
    assert.strictEqual(etAudioState.found, true, 'Audio player must render in entrance-test.html');
    assert.ok(etAudioState.src && etAudioState.src.includes('storage.googleapis.com'), 'Audio player src must resolve to GCS');
    assert.ok(etAudioState.src.includes('7faae63f5f8abe88694547aada408c98e24e4d12bcf7196c070f3e71e60ddba2'), 'Audio sha256 mismatch for student Q2');

    // Confirm no 404s for entire test
    const allLocal404s = failedRequests.filter((r) => r.url.includes('/database/Entrance') || r.url.includes('Listening'));
    console.log('[Test] Total local audio 404 count across all pages:', allLocal404s.length);
    assert.strictEqual(allLocal404s.length, 0, 'Zero local audio 404s allowed: ' + JSON.stringify(allLocal404s));

    console.log('✔ All Playwright browser audio checks passed successfully!');
  } finally {
    await browser.close();
    server.close();
  }
}

runCheck().catch((err) => {
  console.error('❌ Check failed:', err);
  process.exit(1);
});
