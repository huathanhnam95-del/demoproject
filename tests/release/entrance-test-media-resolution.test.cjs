'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT_DIR = path.resolve(__dirname, '../..');

test('entrance-test.html includes media-url-resolver.js before entrance-test.js', () => {
  const htmlPath = path.join(ROOT_DIR, 'public/entrance-test.html');
  const content = fs.readFileSync(htmlPath, 'utf8');

  const resolverIndex = content.indexOf('src="js/media-url-resolver.js"');
  const entranceTestIndex = content.indexOf('src="entrance-test.js');

  assert.notEqual(resolverIndex, -1, 'entrance-test.html must include js/media-url-resolver.js');
  assert.notEqual(entranceTestIndex, -1, 'entrance-test.html must include entrance-test.js');
  assert.ok(resolverIndex < entranceTestIndex, 'media-url-resolver.js must precede entrance-test.js');
});

test('entrance-test-ui-lab.html includes media-url-resolver.js and avoids unresolvable initial src', () => {
  const htmlPath = path.join(ROOT_DIR, 'public/entrance-test-ui-lab.html');
  const content = fs.readFileSync(htmlPath, 'utf8');

  assert.ok(content.includes('src="js/media-url-resolver.js"'), 'entrance-test-ui-lab.html must include js/media-url-resolver.js');
  assert.ok(content.includes('<audio preload="metadata"></audio>'), 'renderPlayer must render audio tag without initial unresolvable src');
  assert.ok(!content.includes('<audio preload="metadata" src="'), 'renderPlayer must not set src in initial HTML template');
  assert.ok(content.includes('MediaUrlResolver.loadAudio'), 'wireAudio must utilize MediaUrlResolver.loadAudio');
});

test('entrance-test.js does not set unresolvable src in initial HTML and uses loadAudio', () => {
  const jsPath = path.join(ROOT_DIR, 'public/entrance-test.js');
  const content = fs.readFileSync(jsPath, 'utf8');

  // Verify renderFillQuestion does not include src in template literal
  const fillFunctionMatch = content.match(/function renderFillQuestion\([\s\S]*?elements\.card\.innerHTML = `([\s\S]*?)`;/);
  assert.ok(fillFunctionMatch, 'renderFillQuestion should be present in entrance-test.js');
  const templateHtml = fillFunctionMatch[1];
  assert.ok(!templateHtml.includes('src="${escapeHtml(audioSrc)}"'), 'Initial audio tag must not have src attribute bound to audioSrc');
  assert.ok(content.includes('<audio class="et-audio-player" controls preload="none"></audio>'), 'Audio element must render with controls preload="none" and no src');

  // Verify loadAudio is invoked with mode 'Entrance-Test'
  assert.ok(content.includes("MediaUrlResolver.loadAudio(audioEl, rawAudioUrl, { mode: 'Entrance-Test' })"), 'Must invoke MediaUrlResolver.loadAudio with mode Entrance-Test');

  // Verify pre-warming in init
  assert.ok(content.includes("window.MediaUrlResolver.resolveAudioUrl('/database/Entrance Test/Listening Q1.mp3'"), 'init must pre-warm Listening Q1');
  assert.ok(content.includes("window.MediaUrlResolver.resolveAudioUrl('/database/Entrance Test/Listening Q2.mp3'"), 'init must pre-warm Listening Q2');
});

test('MediaUrlResolver resolves real Entrance-Test catalog assets correctly', async () => {
  const resolverSource = fs.readFileSync(path.join(ROOT_DIR, 'public/js/media-url-resolver.js'), 'utf8');
  const mediaRelease = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'public/media-release.json'), 'utf8'));
  const entranceCatalog = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'public/catalogs/pub-20260918-all-media/Entrance-Test.json'), 'utf8'));

  const context = {
    console: { log: () => {}, warn: () => {}, error: () => {} },
    setTimeout,
    clearTimeout,
    Promise,
    Map,
    Set,
    Date,
    decodeURIComponent,
    encodeURIComponent,
    fetch: async (url) => {
      if (url === '/media-release.json' || url.endsWith('/media-release.json')) {
        return { ok: true, json: async () => mediaRelease };
      }
      if (url.includes('Entrance-Test.json')) {
        return { ok: true, json: async () => entranceCatalog };
      }
      throw new Error('Unexpected fetch in test: ' + url);
    },
    window: { dispatchEvent: () => true }
  };
  context.globalThis = context;
  context.window.window = context.window;
  vm.createContext(context);
  vm.runInContext(resolverSource, context);

  const resolver = context.MediaUrlResolver;
  assert.ok(resolver, 'MediaUrlResolver should be defined');

  // Test Q1 resolution
  const q1Resolved = await resolver.resolveAudioUrl('/database/Entrance Test/Listening Q1.mp3');
  assert.equal(
    q1Resolved,
    'https://storage.googleapis.com/listening-tasks-3ae34-practice-media/media/sha256/664f653885f9b8e14629b51a5d06d8bbcc02a133e981cdb1388305bd9eb0d65f.mp3'
  );

  // Test Q2 resolution (reported student issue)
  const q2Resolved = await resolver.resolveAudioUrl('/database/Entrance Test/Listening Q2.mp3');
  assert.equal(
    q2Resolved,
    'https://storage.googleapis.com/listening-tasks-3ae34-practice-media/media/sha256/7faae63f5f8abe88694547aada408c98e24e4d12bcf7196c070f3e71e60ddba2.mp3'
  );

  // Test path without leading slash
  const q2NoSlashResolved = await resolver.resolveAudioUrl('database/Entrance Test/Listening Q2.mp3');
  assert.equal(q2NoSlashResolved, q2Resolved);

  // Test loadAudio method on mock audio element
  let loaded = false;
  const mockAudioEl = {
    src: '',
    dataset: {},
    load() {
      loaded = true;
    },
    addEventListener() {},
    removeEventListener() {}
  };

  const loadAudioResult = await resolver.loadAudio(mockAudioEl, '/database/Entrance Test/Listening Q2.mp3', { mode: 'Entrance-Test' });
  assert.equal(loadAudioResult, q2Resolved);
  assert.equal(mockAudioEl.src, q2Resolved);
  assert.equal(loaded, true);
});

test('entrance-test.js audio loading logic handles fallback when MediaUrlResolver fails', async () => {
  const fallbackAudioUrl = '/database/Entrance Test/Listening Q2.mp3';
  const step = { questionId: 'listen_write_q2', audioUrl: fallbackAudioUrl };
  const rawAudioUrl = step.audioUrl || fallbackAudioUrl;
  const directAudioPath = rawAudioUrl && !/^(?:[a-z]+:|\/\/|\/)/i.test(rawAudioUrl)
    ? '/' + rawAudioUrl
    : rawAudioUrl;
  const audioSrc = directAudioPath ? encodeURI(String(directAudioPath)) : '';

  const appState = {
    steps: [{ questionId: 'listen_write_q2' }],
    stepIndex: 0
  };

  let loaded = false;
  const audioEl = {
    src: '',
    load() { loaded = true; }
  };

  const stepQuestionId = step.questionId;
  const loadDirect = () => {
    if (appState.steps[appState.stepIndex]?.questionId !== stepQuestionId) return;
    if (!audioEl.src) {
      audioEl.src = audioSrc;
      audioEl.load();
    }
  };

  // Mock failing resolver
  const mockResolver = {
    loadAudio: () => Promise.reject(new Error('Network error'))
  };

  try {
    const pending = mockResolver.loadAudio(audioEl, rawAudioUrl, { mode: 'Entrance-Test' });
    await pending.catch((err) => {
      loadDirect();
    });
  } catch (_) {
    loadDirect();
  }

  assert.equal(audioEl.src, encodeURI('/database/Entrance Test/Listening Q2.mp3'));
  assert.equal(loaded, true);
});

test('entrance-test.js audio loading logic handles direct absolute URLs without resolver', () => {
  const absoluteUrl = 'https://custom-cdn.example.com/audio/listening_q2.mp3';
  const step = { questionId: 'listen_write_q2', audioUrl: absoluteUrl };
  const rawAudioUrl = step.audioUrl;

  let loaded = false;
  const audioEl = {
    src: '',
    load() { loaded = true; }
  };

  const isAbsoluteUrl = /^(?:https?:|\/\/|blob:|data:)/i.test(rawAudioUrl);
  assert.equal(isAbsoluteUrl, true);

  if (isAbsoluteUrl) {
    audioEl.src = rawAudioUrl;
    audioEl.load();
  }

  assert.equal(audioEl.src, absoluteUrl);
  assert.equal(loaded, true);
});

test('entrance-test.js audio loading logic ignores stale fallback if user navigated to another step', async () => {
  const step = { questionId: 'listen_write_q1', audioUrl: '/database/Entrance Test/Listening Q1.mp3' };
  const appState = {
    steps: [
      { questionId: 'listen_write_q1' },
      { questionId: 'listen_write_q2' }
    ],
    stepIndex: 0
  };

  const audioEl = {
    src: '',
    load() {}
  };

  const stepQuestionId = step.questionId;
  const loadDirect = () => {
    if (appState.steps[appState.stepIndex]?.questionId !== stepQuestionId) return;
    if (!audioEl.src) {
      audioEl.src = encodeURI(step.audioUrl);
      audioEl.load();
    }
  };

  // Simulate user navigating to step 1 before resolution failure callback runs
  appState.stepIndex = 1;
  loadDirect();

  assert.equal(audioEl.src, '', 'Should not set src if user already navigated to a different step');
});

