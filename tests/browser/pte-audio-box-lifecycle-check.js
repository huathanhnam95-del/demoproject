'use strict';

// Question-audio lifecycle of the shared PteAudioBox (public/js/pte-audio-box.js), and the
// production media path RTS and ASQ take to load that audio.
//
// The shell suites stub every clip with 0.1s of silence, so none of them can notice a box
// that gives up on a long lecture, skips a question when autoplay is blocked, or moves on
// silently when a clip fails. Each scenario here uses real clips of a known length.
//
// Run: node tests/browser/pte-audio-box-lifecycle-check.js

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHarness, initScript, dismissOverlays } = require('./helpers/pte-shell-harness');

function wav(seconds, sampleRate = 8000) {
  const samples = Math.round(seconds * sampleRate);
  const b = Buffer.alloc(44 + samples * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + samples * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sampleRate, 24); b.writeUInt32LE(sampleRate * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) b.writeInt16LE(Math.round(Math.sin(i / 6) * 2000), 44 + i * 2);
  return b;
}

const CLIPS = { long: wav(9), short: wav(1.5) };
const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="/css/pte-question-area.css"></head>
<body><div id="host"></div><audio id="a" preload="auto"></audio>
<script src="/js/pte-audio-box.js"></script>
<script>
  // Record every state the box passes through, with the time it was reached.
  window.__states = []; window.__texts = [];
  window.__watch = () => {
    const box = document.querySelector('.pte-audio'); const t0 = performance.now();
    new MutationObserver(() => {
      const last = window.__states[window.__states.length - 1];
      if (!last || last.state !== box.dataset.state) window.__states.push({ state: box.dataset.state, t: Math.round(performance.now() - t0) });
    }).observe(box, { attributes: true, attributeFilter: ['data-state'] });
    new MutationObserver(() => { window.__texts.push(box.querySelector('b').textContent); })
      .observe(box.querySelector('b'), { childList: true, characterData: true, subtree: true });
  };
  window.__start = (opts = {}) => {
    const audio = document.getElementById('a');
    window.__box = PteAudioBox.create(document.getElementById('host'), { audio });
    window.__watch();
    window.__result = null;
    const t0 = performance.now();
    window.__box.play().then(
      () => { window.__result = { ok: true, t: Math.round(performance.now() - t0), ended: audio.ended, currentTime: audio.currentTime, paused: audio.paused }; },
      (error) => { window.__result = { ok: false, name: error && error.name, t: Math.round(performance.now() - t0) }; });
  };
</script></body></html>`;

async function openBoxPage(harness, { routes = {}, scale = 1 } = {}) {
  const page = await harness.browser.newPage({ viewport: { width: 800, height: 600 } });
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  await page.route('**/__audio-box.html', route => route.fulfill({ contentType: 'text/html', body: PAGE }));
  for (const [pattern, handler] of Object.entries(routes)) await page.route(pattern, handler);
  await page.addInitScript(s => { window.__PTE_TEST_TIME_SCALE = s; }, scale);
  await page.goto(`${harness.baseURL}/__audio-box.html`);
  await page.waitForFunction(() => typeof window.PteAudioBox?.create === 'function');
  return { page, errors };
}

const serve = (clip, delayMs = 0) => async route => {
  if (delayMs) await new Promise(r => setTimeout(r, delayMs));
  await route.fulfill({ contentType: 'audio/wav', body: clip }).catch(() => {});
};
const states = page => page.evaluate(() => window.__states.map(s => s.state));
const result = page => page.evaluate(() => window.__result);
const boxState = page => page.evaluate(() => document.querySelector('.pte-audio').dataset.state);
const actionsVisible = page => page.evaluate(() => {
  const actions = document.querySelector('.pte-audio__actions');
  return !!actions && !actions.hidden && getComputedStyle(actions).display !== 'none';
});

const scenarios = {
  // The old box armed a (duration || 4) + 2 second timer before metadata arrived, so a
  // lecture was marked Completed after about six seconds and the recorder started while it
  // was still playing.
  async 'a long clip with slow metadata plays to the end'(harness) {
    const { page, errors } = await openBoxPage(harness, { routes: { '**/__media/long.wav': serve(CLIPS.long, 1500) } });
    await page.evaluate(() => { document.getElementById('a').src = '/__media/long.wav'; window.__start(); });
    await page.waitForFunction(() => window.__result, null, { timeout: 30000 });
    const res = await result(page); const seen = await states(page);
    assert.equal(res.ok, true, 'play() resolves');
    assert.equal(res.ended, true, 'resolves only once the clip has ended');
    assert.ok(res.currentTime >= 8.5, `played the whole 9s clip (currentTime ${res.currentTime})`);
    assert.ok(res.t >= 9000, `took at least the clip length (${res.t}ms)`);
    assert.deepEqual(seen.filter(s => s !== 'idle'), ['loading', 'playing', 'completed'], `states ${seen.join(' > ')}`);
    assert.deepEqual(errors, []);
    await page.close();
  },

  // Autoplay blocked must wait for the learner's click, however long that takes.
  async 'blocked autoplay waits for a click and never skips the question'(harness) {
    const { page } = await openBoxPage(harness, { scale: 0.2, routes: { '**/__media/short.wav': serve(CLIPS.short) } });
    await page.evaluate(() => {
      const audio = document.getElementById('a'); audio.src = '/__media/short.wav';
      const realPlay = HTMLMediaElement.prototype.play; let blocked = true;
      audio.play = function () {
        if (blocked) { blocked = false; return Promise.reject(new DOMException('Autoplay blocked', 'NotAllowedError')); }
        return realPlay.call(this);
      };
      window.__start();
    });
    await page.waitForFunction(() => document.querySelector('.pte-audio').dataset.state === 'blocked');
    // Longer than the scaled 3s stall limit and than the old box's (duration || 4) + 2s
    // wall-clock fallback, which skipped the question while it waited for this click.
    await page.waitForTimeout(7000);
    assert.equal(await boxState(page), 'blocked', 'still waiting for the learner');
    assert.equal(await result(page), null, 'play() has not settled');
    assert.equal(await page.getAttribute('.pte-audio', 'role'), 'button');
    await page.click('.pte-audio');
    await page.waitForFunction(() => window.__result, null, { timeout: 15000 });
    const res = await result(page);
    assert.equal(res.ok, true); assert.equal(res.ended, true, 'the clip played after the click');
    assert.ok(!(await states(page)).includes('failed'));
    await page.close();
  },

  // A clip that cannot load stops and asks: Try again or Continue. It never moves on alone.
  async 'a missing clip shows Try again and Continue'(harness) {
    let requests = 0;
    const { page } = await openBoxPage(harness, {
      scale: 0.2,
      routes: { '**/__media/missing.wav': route => { requests++; return route.fulfill({ status: 404, contentType: 'text/html', body: '<h1>404</h1>' }); } }
    });
    await page.evaluate(() => { document.getElementById('a').src = '/__media/missing.wav'; window.__start(); });
    await page.waitForFunction(() => document.querySelector('.pte-audio').dataset.state === 'failed', null, { timeout: 10000 });
    assert.equal(await actionsVisible(page), true, 'Try again and Continue are shown');
    assert.equal(await result(page), null, 'play() waits for the learner');
    assert.match(await page.textContent('.pte-audio__status'), /couldn't play/);
    await page.waitForTimeout(1500);
    assert.equal(await result(page), null, 'still waiting after the failure');

    const before = requests;
    await page.click('.pte-audio__btn[data-action="retry"]');
    await page.waitForFunction(() => {
      const box = document.querySelector('.pte-audio');
      return box.dataset.state === 'failed' && window.__states.filter(s => s.state === 'failed').length >= 2;
    }, null, { timeout: 10000 });
    assert.ok(requests > before, 'Try again fetched the clip again');

    await page.click('.pte-audio__btn[data-action="continue"]');
    await page.waitForFunction(() => window.__result, null, { timeout: 5000 });
    const res = await result(page);
    assert.equal(res.ok, true, 'Continue resolves play() so the mode can move to the recorder');
    assert.equal(await actionsVisible(page), false, 'the actions go away');
    assert.match(await page.textContent('.pte-audio__status'), /Skipped/);
    await page.close();
  },

  // A source that never answers is caught by the progress watchdog, not by the clip length.
  async 'a clip that never loads fails after the stall limit'(harness) {
    const { page } = await openBoxPage(harness, { scale: 0.2, routes: { '**/__media/hang.wav': () => new Promise(() => {}) } });
    await page.evaluate(() => { document.getElementById('a').src = '/__media/hang.wav'; window.__start(); });
    await page.waitForFunction(() => document.querySelector('.pte-audio').dataset.state === 'failed', null, { timeout: 15000 });
    const failedAt = await page.evaluate(() => window.__states.find(s => s.state === 'failed').t);
    assert.ok(failedAt >= 2500, `waited out the scaled 3s stall limit (${failedAt}ms)`);
    assert.equal(await actionsVisible(page), true);
    await page.click('.pte-audio__btn[data-action="continue"]');
    await page.waitForFunction(() => window.__result);
    assert.equal((await result(page)).ok, true);
    await page.close();
  },

  // The media resolver can hand over the delivery URL after play() has started (src plus
  // load()), which rejects that play() with AbortError. The box plays the new source.
  async 'a source that arrives after play() starts still plays'(harness) {
    const { page } = await openBoxPage(harness, { routes: { '**/__media/short.wav': serve(CLIPS.short) } });
    await page.evaluate(() => {
      window.__start();
      setTimeout(() => { const audio = document.getElementById('a'); audio.src = '/__media/short.wav'; audio.load(); }, 800);
    });
    await page.waitForFunction(() => window.__result, null, { timeout: 20000 });
    const res = await result(page);
    assert.equal(res.ok, true); assert.equal(res.ended, true, 'the late source played to the end');
    assert.ok(!(await states(page)).includes('failed'), `no failure (${(await states(page)).join(' > ')})`);
    await page.close();
  },

  async 'the countdown hands over without showing zero seconds'(harness) {
    const { page } = await openBoxPage(harness, { scale: 0.1, routes: { '**/__media/short.wav': serve(CLIPS.short) } });
    await page.evaluate(async () => {
      const audio = document.getElementById('a'); audio.src = '/__media/short.wav';
      window.__box = PteAudioBox.create(document.getElementById('host'), { audio }); window.__watch();
      await window.__box.countdown(3);
      window.__countdownDone = true;
    });
    await page.waitForFunction(() => window.__countdownDone);
    const texts = await page.evaluate(() => window.__texts);
    assert.ok(texts.includes('Beginning in 3 seconds'), texts.join(' | '));
    assert.ok(texts.includes('Beginning in 1 second'), 'singular at one');
    assert.ok(!texts.some(t => /Beginning in 0/.test(t)), `never shows zero: ${texts.join(' | ')}`);
    await page.close();
  },

  // Production serves practice audio from media storage and rewrites the raw /database
  // paths to /404.html (firebase.json). RTS and ASQ must load through the resolver and
  // never request the raw path while the resolver works.
  async 'RTS and ASQ load question audio through the resolver only'(harness) {
    const rts = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../public/database/RTS/rts_questions.json'), 'utf8'));
    const rtsItems = Array.isArray(rts) ? rts : (rts.questions || rts.items || []);
    const assets = { RTS: {}, quiz: {} };
    for (const item of rtsItems) assets.RTS[`public/database/RTS/audio/RTS_${item.id}.mp3`] = { key: `media/RTS_${item.id}.mp3` };
    for (let id = 1; id <= 3000; id++) assets.quiz[`public/database/quiz/ASQ/audio/${id}.mp3`] = { key: `media/ASQ_${id}.mp3` };
    const raw = [];
    const delivery = `${harness.baseURL}/__delivery/`;

    const page = await harness.browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.addInitScript(initScript);
    await page.route('**/*', async route => {
      const url = route.request().url();
      if (/\/database\/(RTS\/audio|quiz\/ASQ\/audio)\/[^/]+\.(mp3|wav|m4a)/i.test(url)) {
        raw.push(url);
        return route.fulfill({ status: 404, contentType: 'text/html', body: '<h1>404</h1>' });
      }
      if (url.includes('/media-release.json')) {
        return route.fulfill({ json: { schemaVersion: 1, publicationId: 'test', deliveryBaseUrl: delivery, defaultRolloutState: 'remote-only',
          modes: { RTS: { state: 'remote-only', shardKey: 'catalogs/test/RTS.json' }, quiz: { state: 'remote-only', shardKey: 'catalogs/test/quiz.json' } } } });
      }
      const shard = url.match(/\/__delivery\/catalogs\/test\/(RTS|quiz)\.json/);
      if (shard) return route.fulfill({ json: { assets: assets[shard[1]] } });
      if (url.includes('/__delivery/media/')) return route.fulfill({ contentType: 'audio/wav', body: CLIPS.short });
      if (url.includes('/api/')) return route.fulfill({ json: {} });
      return route.fallback();
    });
    await page.goto(`${harness.baseURL}/?pteShell=v3`, { waitUntil: 'domcontentloaded' });
    await dismissOverlays(page);

    for (const [mode, audioId] of [['rts', 'rts-audio-player'], ['asq', 'asq-prompt-audio']]) {
      await page.evaluate(m => window.switchToMode(m), mode);
      await page.waitForFunction(id => {
        const audio = document.getElementById(id);
        return audio && (audio.currentSrc || audio.src || '').includes('/__delivery/media/');
      }, audioId, { timeout: 30000 });
    }
    assert.deepEqual(raw, [], `no request to the raw /database audio path: ${raw.join(', ')}`);
    await page.close();
  },

  // In the speaking shell the dock must not keep saying the recorder appears when the audio
  // ends while the question audio has failed. It says what the box says, once.
  async 'the shell dock reports a failed clip and clears it again'(harness) {
    const page = await harness.browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = []; page.on('pageerror', err => errors.push(err.message));
    await page.addInitScript(initScript);
    // Every clip fails, as when the media host is down.
    await page.route(/\.(mp3|wav|m4a|ogg|webm|aac)(\?.*)?$/i, route => route.fulfill({ status: 404, contentType: 'text/html', body: '<h1>404</h1>' }));
    await page.goto(`${harness.baseURL}/?pteShell=v3`, { waitUntil: 'domcontentloaded' });
    await dismissOverlays(page);
    await page.evaluate(() => { window.__PTE_TEST_TIME_SCALE = 0.2; window.switchToMode('asq'); });
    const box = '#mode-asq .pte-audio';
    const read = () => page.evaluate(sel => ({
      dock: document.querySelector('.pte-dock__status').textContent.trim(),
      said: document.querySelector(sel).parentElement.querySelector('.pte-sr-only[role="status"]').textContent,
      phase: document.querySelector('.pte-card').dataset.ptePhase
    }), box);

    await page.waitForSelector(`${box}[data-state="failed"]`, { timeout: 30000 });
    const failed = await read();
    assert.equal(failed.dock, "The audio couldn't play. Try again, or continue without it.");
    assert.doesNotMatch(failed.said, /couldn't play/, 'the dock announces it, so the box does not repeat it');
    await page.click(`${box} .pte-audio__btn[data-action="retry"]`);
    assert.notEqual((await read()).dock, failed.dock, 'Try again clears the dock line');
    await page.waitForSelector(`${box}[data-state="failed"]`, { timeout: 30000 });
    assert.equal((await read()).dock, failed.dock, 'a second failure shows it again');
    await page.click(`${box} .pte-audio__btn[data-action="continue"]`);
    await page.waitForFunction(() => document.querySelector('.pte-card').dataset.ptePhase === 'prep', null, { timeout: 15000 });
    assert.notEqual((await read()).dock, failed.dock, 'Continue moves on and clears it');
    assert.deepEqual(errors, []);
    await page.close();
  }
};

async function run() {
  const only = process.argv[2];
  const harness = await createHarness();
  const results = [];
  try {
    for (const [name, fn] of Object.entries(scenarios)) {
      if (only && !name.includes(only)) continue;
      const started = Date.now();
      try {
        await fn(harness);
        results.push({ name, ok: true });
        console.log(`  PASS  ${name} (${Date.now() - started}ms)`);
      } catch (error) {
        results.push({ name, ok: false, error: error.message });
        console.log(`  FAIL  ${name}\n        ${error.message.split('\n').join('\n        ')}`);
      }
    }
  } finally {
    await harness.close();
  }
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} audio-box lifecycle scenarios passed`);
  if (failed.length) process.exit(1);
}

run().catch(error => { console.error(error); process.exit(1); });
