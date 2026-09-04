const { chromium } = require('playwright');
const path = require('path');
const express = require('express');
const http = require('http');

async function testOvershoot() {
  const app = express();
  app.use(express.static(path.resolve(__dirname, '../../public')));
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  // Navigate to blank page and test HTMLAudioElement seek & pause timing
  await page.setContent(`
    <html><body>
      <audio id="audio" src="/database/RA/connected-speech-featured-prompts.json"></audio>
    </body></html>
  `);

  // Let's test with real audio file:
  const wavUrl = 'http://127.0.0.1:' + port + '/scripts/entrance-test/audio_analysis/testB0_q1.wav';
  // Allow express to serve scripts/entrance-test/audio_analysis
  app.use('/scripts/entrance-test/audio_analysis', express.static(path.resolve(__dirname, 'audio_analysis')));

  const overshootResult = await page.evaluate(async (url) => {
    const audio = new Audio(url);
    await new Promise(r => { audio.oncanplaythrough = r; audio.load(); });
    
    // Test word 'give' in testB0: start=7.940s, end=8.250s
    const start = 7.940;
    const end = 8.250;
    audio.currentTime = start;
    await audio.play();
    
    const startTime = performance.now();
    return new Promise((resolve) => {
      const timer = setInterval(() => {
        if (audio.currentTime >= end) {
          clearInterval(timer);
          const reachedCurrentTime = audio.currentTime;
          audio.pause();
          // Check currentTime after 50ms
          setTimeout(() => {
            resolve({
              targetEnd: end,
              timeWhenPauseCalled: reachedCurrentTime,
              overshootWhenPauseCalledMs: Math.round((reachedCurrentTime - end) * 1000),
              finalCurrentTime: audio.currentTime,
              finalOvershootMs: Math.round((audio.currentTime - end) * 1000)
            });
          }, 60);
        }
      }, 25);
    });
  }, wavUrl);

  console.log('HTMLAudioElement Overshoot Test Result:', overshootResult);
  await browser.close();
  server.close();
}

testOvershoot().then(() => process.exit(0)).catch(console.error);
