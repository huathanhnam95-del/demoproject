const assert = require('assert');
const express = require('express');
const http = require('http');
const { chromium } = require('playwright');

async function run() {
  const app = express();
  app.use(express.static('public'));
  app.get('/native-playback-harness', (_request, response) => {
    response.type('html').send('<!doctype html><html><body><audio id="native"></audio></body></html>');
  });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, channel: 'chromium' });
  const page = await browser.newPage();

  await page.addInitScript(() => {
    window.__segmentStarts = [];
    window.__elementSeeks = [];
  });

  try {
    await page.goto(`${origin}/native-playback-harness`, { waitUntil: 'networkidle' });
    const result = await page.evaluate(async () => {
      const audioElement = document.getElementById('native');
      Object.defineProperty(audioElement, 'currentTime', {
        configurable: true,
        get: () => 0,
        set: (value) => window.__elementSeeks.push(value)
      });
      audioElement.pause = () => {};
      audioElement.play = () => Promise.resolve();

      const audioContext = {
        state: 'running',
        destination: {},
        decodeAudioData: async () => ({ duration: 1.0 }),
        createBufferSource: () => ({
          connect() {},
          disconnect() {},
          stop() {},
          start: (_when, offset, duration) => {
            window.__segmentStarts.push({ offset, duration });
          }
        })
      };
      const fetchImpl = async () => ({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(16)
      });
      const { NativeAudioPlayer } = await import('/pronunciation-analyzer/native-audio-player.js');
      const player = new NativeAudioPlayer(audioContext, audioElement, fetchImpl);
      const played = await player.playSegment('https://audio.example/native.mp3', 0.30, 0.46);
      const rejected = await player.playSegment('https://audio.example/native.mp3', 0.50, 0.50);
      return {
        played,
        rejected,
        starts: window.__segmentStarts,
        elementSeeks: window.__elementSeeks
      };
    });

    assert.equal(result.played, true);
    assert.equal(result.rejected, false);
    assert.equal(result.starts.length, 1);
    assert(Math.abs(result.starts[0].offset - 0.30) < 0.001);
    assert(Math.abs(result.starts[0].duration - 0.16) < 0.001);
    assert.deepEqual(result.elementSeeks, []);
  } finally {
    await browser.close();
    server.close();
  }
}

run().then(() => console.log('pronounce-mode syllable playback check passed')).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
