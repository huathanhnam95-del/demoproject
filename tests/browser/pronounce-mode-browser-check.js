// eslint-disable-next-line
const assert = require('assert');
const express = require('express');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

function harnessHtml() {
  return `<!doctype html>
  <html><head>
    <link rel="stylesheet" href="/pronunciation-analyzer/style.css">
    <style>html, body { background: #fff; color: #111; }</style>
    <script src="/vendor/chart.umd.js"></script>
    <script>
      window.__charts = window.__charts || [];
      const BrowserHarnessChart = window.Chart;
      window.Chart = class TrackedChart extends BrowserHarnessChart {
        constructor(canvas, config) {
          config.options = { ...config.options, animation: false };
          super(canvas, config);
          window.__charts.push(config);
        }
      };
    </script>
  </head><body>
    <button id="tab-pronounce" class="tab-btn">Pronounce</button>
    <div id="mode-pronounce" class="mode-panel" style="display:block">
      <button id="pa-record-btn">Record</button>
      <button id="pa-stop-btn" disabled>Stop</button>
      <div id="pa-status"></div><div id="pa-spinner"></div>
      <div class="pa-word-input-container">
        <input id="pa-word-input" value="car"><button id="pa-search-btn">Search</button>
        <div id="pa-word-forms" class="hidden"></div>
        <div id="pa-reference-status" aria-live="polite"></div>
        <div class="pa-merged-info-box">
          <div id="pa-word-info" class="pa-word-info">
            <div class="pa-ipa-summary">
              <div class="pa-ipa-label-val">
                <span class="pa-info-label">American IPA</span>
                <span id="pa-ipa-display" class="pa-ipa-text"></span>
              </div>
              <div id="pa-native-audio-container" class="pa-reference-audio" style="display: none;">
                <button id="pa-play-native-btn" class="pa-btn-play-native" type="button">🔊 Listen</button>
                <audio id="pa-native-audio" preload="none"></audio>
              </div>
            </div>
            <div class="pa-pattern-summary">
              <span class="pa-info-label">Stress pattern</span>
              <div class="pa-pattern-facts" aria-hidden="true">
                <span class="pa-pattern-fact pa-pattern-fact--count">
                  <strong id="pa-syllable-count"></strong>
                </span>
                <span id="pa-primary-stress-fact" class="pa-pattern-fact pa-pattern-fact--primary">
                  <span class="pa-pattern-fact-label">Primary stress</span><strong id="pa-primary-stress"></strong>
                </span>
                <span id="pa-secondary-stress-fact" class="pa-pattern-fact pa-pattern-fact--secondary">
                  <span class="pa-pattern-fact-label">Secondary</span><strong id="pa-secondary-stress"></strong>
                </span>
              </div>
              <div id="pa-syllable-strip" class="pa-syllable-strip" aria-hidden="true"></div>
              <span id="pa-pattern-display" class="pa-sr-only"></span>
            </div>
          </div>
        </div>
      </div>
      <div id="pa-loading-placeholder"></div>
      <div id="pa-results-summary"></div>
      <div id="pa-review-layout" class="pa-review-layout">
        <div class="pa-review-main">
          <section id="pa-version-comparison" class="pa-version-comparison" hidden aria-labelledby="pa-version-comparison-title">
            <div class="pa-version-comparison-header">
              <div>
                <p class="pa-version-eyebrow">Admin comparison</p>
                <h3 id="pa-version-comparison-title">Which analysis matches the recording?</h3>
                <p class="pa-version-description">Both engines analyzed the same recording. Inspect the boundaries, then save your judgment.</p>
              </div>
              <span id="pa-version-comparison-state" class="pa-version-state" role="status">Ready for review</span>
            </div>
            <div id="pa-version-columns" class="pa-version-columns" role="group" aria-label="Pronunciation engine comparison">
              <article id="pa-version-v2" class="pa-version-column" aria-labelledby="pa-version-v2-title"></article>
              <article id="pa-version-v3" class="pa-version-column" aria-labelledby="pa-version-v3-title"></article>
            </div>
          </section>
          <div id="pa-charts-container" class="pa-charts-grid">
            <div class="pa-chart-card">
              <div class="pa-chart-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                <div class="pa-chart-title" style="margin: 0; text-align: left;">Prosody Comparison</div>
                <div class="pa-chart-toggle-group" id="pa-chart-mode-toggle">
                  <button type="button" class="pa-chart-toggle-btn active" data-mode="pitch">Pitch</button>
                  <button type="button" class="pa-chart-toggle-btn" data-mode="intensity">Volume</button>
                </div>
              </div>
              <canvas id="pa-pitch-chart"></canvas>
            </div>
            <div class="pa-chart-card">
              <div class="pa-chart-title">Syllable Duration Comparison</div>
              <canvas id="pa-stress-chart"></canvas>
            </div>
          </div>
          <div id="pa-timeline-container"></div>
          <div id="syllable-verifier-container"></div>
        </div>
        <div id="pa-version-review-bar" class="pa-version-review-bar" hidden aria-label="Comparison controls">
          <fieldset id="pa-version-judgment" class="pa-version-judgment">
            <legend>Which version is more accurate?</legend>
            <div class="pa-version-judgment-options">
              <label><input type="radio" name="pa-version-judgment" value="v2"> V2 is more accurate</label>
              <label><input type="radio" name="pa-version-judgment" value="v3"> V3 is more accurate</label>
              <label><input type="radio" name="pa-version-judgment" value="tie"> They are about the same</label>
              <label><input type="radio" name="pa-version-judgment" value="neither"> Neither is accurate</label>
            </div>
          </fieldset>
          <div class="pa-version-save-row">
            <button id="pa-version-save" type="button" class="pa-btn pa-version-save" disabled>Save comparison</button>
            <span id="pa-version-save-status" class="pa-version-save-status" role="status" aria-live="polite"></span>
          </div>
          <details id="pa-version-technical-details" class="pa-version-technical-details">
            <summary>Technical details</summary>
            <pre id="pa-version-technical-content"></pre>
          </details>
        </div>
      </div>
      <div id="pa-feedback-section"><div id="pa-syllable-tabs"></div><div id="pa-feedback-content"></div></div>
    </div>
    <script type="module" src="/pronunciation-analyzer/main.js"></script>
  </body></html>`;
}

function startServer() {
  const app = express();
  app.get('/vendor/chart.umd.js', (_request, response) => {
    response.sendFile(path.resolve('node_modules/chart.js/dist/chart.umd.js'));
  });
  app.use(express.static('public'));
  app.get('/pronounce-v2-harness', (_request, response) => response.type('html').send(harnessHtml()));
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    const onError = (error) => reject(error);
    server.once('error', onError);
    server.listen(Number(process.env.PRONOUNCE_HARNESS_PORT || 0), '127.0.0.1', () => {
      server.removeListener('error', onError);
      resolve({
        server,
        origin: `http://127.0.0.1:${server.address().port}`
      });
    });
  });
}

function closeServer(server) {
  if (!server?.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function run() {
  const { server, origin } = await startServer();
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });

  await context.addInitScript(() => {
    window.__charts = [];
    window.__dictionaryCalls = {};
    window.__nativeAnalysisAttempts = {};
    window.__savedLocalSamples = [];
    window.__savedManualReviews = [];
    window.__manualReviewAuthHeader = null;
    window.__adminStatus = false;
    window.__lastV3Form = null;
    window.Logger = { log() {}, warn() {}, error() {} };
    window.__FIREBASE_INTERNAL__ = { db: null };

    class FakeAudioContext {
      constructor() {
        this.state = 'running';
        this.sampleRate = 16000;
        this.destination = {};
      }
      resume() { return Promise.resolve(); }
      decodeAudioData() {
        return Promise.resolve({
          duration: 0.5,
          sampleRate: 16000,
          length: 8000,
          getChannelData: () => new Float32Array(8000)
        });
      }
      createBufferSource() {
        return { connect() {}, disconnect() {}, start() {}, stop() {} };
      }
    }
    window.AudioContext = FakeAudioContext;
    window.webkitAudioContext = FakeAudioContext;

    const variant = ({
      id,
      pos = 'noun',
      rawIpa,
      displayIpa,
      count,
      stress,
      secondary = [],
      labels = null,
      status = 'valid',
      audio = true,
      provider = 'merriam-webster',
      formRole = 'citation'
    }) => ({
      id,
      formRole,
      usage: { isolated: 'preferred', connectedSpeech: 'preferred' },
      conditions: {},
      partOfSpeech: pos,
      definition: 'fixture',
      source: {
        provider,
        entryId: provider === 'cmu-pronouncing-dictionary' ? `cmudict:${id}` : id,
        exactMatch: true,
        transcription: provider === 'cmu-pronouncing-dictionary'
          ? 'cmu-arpabet-converted'
          : 'merriam-webster-ipa',
        dialect: 'en-US',
        labels: []
      },
      rawIpa,
      displayIpa,
      syllableCount: count,
      primaryStress: stress,
      secondaryStress: secondary,
      syllables: Array.from({ length: count }, (_, index) => ({
        index,
        ipa: count === 1 ? displayIpa.replaceAll('/', '') : `s${index + 1}`,
        label: labels?.[index] || null,
        stress: index === stress ? 'primary' : (secondary.includes(index) ? 'secondary' : 'unstressed'),
        syllabicConsonant: false
      })),
      audioUrl: audio ? `https://media.merriam-webster.com/${id}.mp3` : null,
      validation: {
        status,
        conflicts: status === 'valid' ? [] : ['COUNT_CONFLICT'],
        evidence: { phonologicalCount: count, headwordCount: null, headwordCountExplicit: false }
      },
      capabilities: {
        playAudio: audio,
        scoreCountStress: status === 'valid',
        showNativeGraphs: status === 'valid' && audio
      }
    });

    const references = {
      car: [variant({
        id: '1111111111111111', rawIpa: 'ˈkɑɚ', displayIpa: '/kɑr/', count: 1, stress: 0
      })],
      photograph: [
        variant({
          id: '8888888888888888', rawIpa: 'ˈfoʊtəˌgræf', displayIpa: '/ˈfoʊtəˌɡræf/',
          count: 3, stress: 0, secondary: [2], labels: ['pho', 'to', 'graph']
        }),
        variant({
          id: '9999999999999999', pos: 'verb', rawIpa: null, displayIpa: null,
          count: 0, stress: null, status: 'conflict', audio: false
        })
      ],
      photography: [variant({
        id: 'aaaaaaaaaaaaaaaa', rawIpa: 'fəˈtɑɡrəfi', displayIpa: '/fəˈtɑɡrəfi/',
        count: 4, stress: 1, labels: ['pho', 'TOG', 'ra', 'phy']
      })],
      busy: [variant({
        id: 'dddddddddddddddd', rawIpa: 'ˈbɪzi', displayIpa: '/ˈbɪzi/',
        count: 2, stress: 0, labels: ['BU', 'sy']
      })],
      retrygraph: [variant({
        id: 'cccccccccccccccc', rawIpa: 'ˈriːtraɪ', displayIpa: '/ˈriːtraɪ/',
        count: 2, stress: 0, labels: ['RE', 'try']
      })],
      contouronly: [variant({
        id: 'bbbbbbbbbbbbbbbb', rawIpa: 'kɑntʊr', displayIpa: '/kɑntʊr/',
        count: 2, stress: 0, labels: ['CON', 'tour']
      })],
      conflict: [variant({
        id: '2222222222222222', rawIpa: 'ˈflaʊɚ', displayIpa: '/flaʊr/',
        count: 1, stress: 0, status: 'conflict'
      })],
      import: [
        variant({
          id: '3333333333333333', rawIpa: 'ˈɪmˌpɔɚt', displayIpa: '/ˈɪmˌpɔrt/',
          count: 2, stress: 0, secondary: [1]
        }),
        variant({
          id: '4444444444444444', pos: 'verb', rawIpa: 'ɪmˈpɔɚt',
          displayIpa: '/ɪmˈpɔrt/', count: 2, stress: 1
        })
      ],
      tunnel: [variant({
        id: '5555555555555555', rawIpa: 'ˈtʌnᵊl', displayIpa: '/ˈtʌnᵊl/', count: 2, stress: 0
      })],
      silent: [variant({
        id: '6666666666666666', rawIpa: 'ˈsaɪlənt', displayIpa: '/ˈsaɪlənt/',
        count: 2, stress: 0, audio: false
      })],
      fallback: [variant({
        id: '7777777777777777', rawIpa: 'kɚˈɛktli', displayIpa: '/kərˈɛktli/',
        count: 3, stress: 1, audio: false, provider: 'cmu-pronouncing-dictionary'
      })]
    };

    const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' }
    });
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (resource, options = {}) => {
      const url = String(resource?.url || resource || '');
      if (url.endsWith('/health')) return jsonResponse({ status: 'ok' });
      if (url.includes('/warm/v3')) return jsonResponse({ status: 'ok', warmed: true });
      if (url.includes('/dictionary/v2/')) {
        const word = decodeURIComponent(url.split('/').pop());
        window.__dictionaryCalls[word] = (window.__dictionaryCalls[word] || 0) + 1;
        const variants = references[word] || [];
        const defaultVariant = variants.find((item) => item.validation.status === 'valid');
        return jsonResponse({
          schemaVersion: 10,
          algorithmVersion: 'pronunciation-reference-v4',
          deploymentVersion: 'browser-fixture',
          word,
          dialect: 'en-US',
          formDefaults: {
            isolated: defaultVariant?.id || null,
            connectedSpeech: defaultVariant?.id || null
          },
          defaultVariantId: defaultVariant?.id || null,
          variants
        });
      }
      if (url.includes('/analyze-url/v2')) {
        const request = JSON.parse(options.body);
        window.__nativeAnalysisAttempts[request.variantId] =
          (window.__nativeAnalysisAttempts[request.variantId] || 0) + 1;
        if (
          request.variantId === 'cccccccccccccccc' &&
          window.__nativeAnalysisAttempts[request.variantId] <= 2
        ) {
          return jsonResponse({ error: 'Temporary analysis outage' }, 503);
        }
        const count = request.expectedSyllableCount;
        const contourOnly = request.variantId === 'bbbbbbbbbbbbbbbb';
        const observedCount = contourOnly ? count - 1 : count;
        return jsonResponse({
          analysisVersion: 'pronunciation-analysis-v2',
          variantId: request.variantId,
          canonicalSyllableCount: count,
          quality: contourOnly
            ? { rateable: false, confidence: 0, reasons: ['ACOUSTIC_COUNT_MISMATCH'] }
            : { rateable: true, confidence: 0.92, reasons: [] },
          segmentation: {
            rawCandidateCount: observedCount,
            evidenceCandidateCount: observedCount,
            selectedCount: contourOnly ? 0 : observedCount,
            method: contourOnly ? 'insufficient-acoustic-candidates' : 'acoustic-candidate-selection',
            confidence: contourOnly ? 0 : 0.92,
            conflicts: contourOnly ? ['ACOUSTIC_COUNT_MISMATCH'] : []
          },
          observed: {
            syllableCount: contourOnly ? 0 : observedCount,
            primaryStress: contourOnly ? null : 0,
            syllables: Array.from({ length: contourOnly ? 0 : observedCount }, (_, index) => ({
              startTime: index * 0.2,
              endTime: (index + 1) * 0.2,
              duration: 0.2,
              vowelDuration: 0.15,
              avgPitch: 150 - index * 10,
              maxPitch: 160 - index * 10,
              intensity: 70 - index,
              isStressed: index === 0
            })),
            stressEvidence: { rateable: true, confidence: 0.9 }
          },
          pitch: { times: [0, 0.1, 0.2], values: [150, 160, 140] },
          intensity: { times: [0, 0.1, 0.2], values: [68, 72, 67] },
          capabilities: { showNativeGraphs: !contourOnly }
        });
      }
      if (url.includes('/analyze/v3')) {
        const formObj = {};
        if (options.body && typeof options.body.entries === 'function') {
          for (const [key, value] of options.body.entries()) {
            if (typeof value === 'string') {
              formObj[key] = value;
            }
          }
        }
        window.__lastV3Form = formObj;
        return jsonResponse({

          analysisVersion: 'pronunciation-analysis-v3',
          mode: 'active',
          engine: 'ctc-praat',
          is_rateable: true,
          confidence: 0.94,
          syllable_count: 2,
          observed_syllables: [
            { startTime: 0.05, endTime: 0.24, duration: 0.19, confidence: 0.95, nucleus: 'ɪ' },
            { startTime: 0.24, endTime: 0.43, duration: 0.19, confidence: 0.93, nucleus: 'i' }
          ],
          pitch: { times: [0.05, 0.1], values: [150, 155] },
          intensity: { times: [0.05, 0.1], values: [68, 70] },
          capabilities: { graphs: true, syllable_duration: true, phoneme_alignment: true }
        });
      }
      if (url.includes('/analyze/v2')) {
        return jsonResponse({
          analysisVersion: 'pronunciation-analysis-v2',
          canonicalSyllableCount: 2,
          quality: { rateable: true, confidence: 0.9, reasons: [] },
          segmentation: { selectedCount: 2, confidence: 0.9 },
          observed: { syllableCount: 2, syllables: [] }
        });
      }
      if (url.includes('/api/admin/dev/save-corpus-sample')) {
        let metadata = {};
        if (options.body && typeof options.body.entries === 'function') {
          for (const [key, value] of options.body.entries()) {
            if (key === 'metadata' && typeof value === 'string') metadata = JSON.parse(value);
          }
        }
        window.__manualReviewAuthHeader = options.headers?.Authorization || options.headers?.authorization || null;
        window.__savedManualReviews.push(metadata);
        return jsonResponse({
          success: true,
          data: { sampleId: metadata.sampleId, sample: { id: metadata.sampleId } }
        });
      }
      if (url.includes('/api/admin/status')) {
        return jsonResponse({ success: true, isAdmin: window.__adminStatus === true });
      }
      if (url.includes('/debug/pronounce-samples')) {
        let metadata = {};
        let audio = null;
        if (options.body && typeof options.body.entries === 'function') {
          for (const [key, value] of options.body.entries()) {
            if (key === 'metadata' && typeof value === 'string') metadata = JSON.parse(value);
            if (key === 'audio') audio = { type: value.type, size: value.size };
          }
        }
        window.__savedLocalSamples.push({ metadata, audio });
        return jsonResponse({
          success: true,
          sampleId: metadata.sampleId,
          audioPath: `test-results/pronounce-local-samples/${metadata.sampleId}.wav`,
          metadataPath: `test-results/pronounce-local-samples/${metadata.sampleId}.json`
        });
      }
      if (url.includes('/proxy-audio')) {

        return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
      }
      return originalFetch(resource, options);
    };
  });

  await context.route('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `export const doc=()=>({}); export const getDoc=async()=>({exists:()=>false});
        export const setDoc=async()=>{}; export const updateDoc=async()=>{};
        export const increment=(v)=>v; export const serverTimestamp=()=>new Date();`
    });
  });

  const page = await context.newPage();
  const pageErrors = [];
  const requestFailures = [];
  const consoleMessages = [];
  const moduleResponses = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('requestfailed', (request) => requestFailures.push({
    url: request.url(),
    failure: request.failure()?.errorText || 'unknown'
  }));
  page.on('console', (message) => consoleMessages.push({
    type: message.type(),
    text: message.text()
  }));
  page.on('response', (response) => {
    if (response.url().includes('/pronunciation-analyzer/')) {
      moduleResponses.push({ url: response.url(), status: response.status() });
    }
  });
    await page.goto(`${origin}/pronounce-v2-harness`, { waitUntil: 'networkidle' });
    try {
      await page.waitForFunction(() => document.querySelector('#pa-pattern-display')?.textContent.includes('Single-syllable'));
    } catch (error) {
      console.error('pronunciation harness boot diagnostics', {
        pageErrors,
        requestFailures,
        consoleMessages,
        moduleResponses,
        ipa: await page.locator('#pa-ipa-display').textContent(),
        pattern: await page.locator('#pa-pattern-display').textContent(),
        status: await page.locator('#pa-status').textContent()
      });
      throw error;
    }
    assert.equal(await page.locator('#pa-ipa-display').textContent(), '/kɑr/');
    assert.equal(await page.locator('#pa-record-btn').isDisabled(), false);

    await page.fill('#pa-word-input', 'photograph');
    await page.click('#pa-search-btn');
    await page.waitForFunction(() => document.querySelector('#pa-ipa-display')?.textContent === '/ˈfoʊtəˌɡræf/');
    assert.equal(await page.locator('#pa-word-forms button').count(), 0);
    assert.equal(await page.locator('#pa-word-forms').evaluate((node) => node.classList.contains('hidden')), true);
    assert.equal(await page.locator('#pa-syllable-count').textContent(), '3 syllables');
    assert.equal(await page.locator('#pa-primary-stress').textContent(), 'PHO');
    assert.equal(await page.locator('#pa-secondary-stress').textContent(), 'GRAPH');
    assert.deepEqual(
      await page.locator('#pa-syllable-strip .pa-syllable').evaluateAll((nodes) => nodes.map((node) => ({
        text: node.querySelector('.pa-syllable-label')?.textContent,
        className: node.className
      }))),
      [
        { text: 'PHO', className: 'pa-syllable pa-syllable--primary' },
        { text: 'to', className: 'pa-syllable pa-syllable--unstressed' },
        { text: 'GRAPH', className: 'pa-syllable pa-syllable--secondary' }
      ]
    );
    assert.equal(
      await page.locator('#pa-pattern-display').textContent(),
      '3 syllables. Primary stress on PHO, syllable 1. Secondary stress on GRAPH, syllable 3.'
    );
    const localSampleSave = await page.evaluate(async () => {
      const { bootPronunciationApp } = await import('/pronunciation-analyzer/main.js');
      const app = bootPronunciationApp();
      const pcm = new Uint8Array(32);
      const wav = new ArrayBuffer(44 + pcm.length);
      const view = new DataView(wav);
      const write = (offset, value) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
      write(0, 'RIFF');
      view.setUint32(4, 36 + pcm.length, true);
      write(8, 'WAVE');
      write(12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, 16000, true);
      view.setUint32(28, 32000, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      write(36, 'data');
      view.setUint32(40, pcm.length, true);
      new Uint8Array(wav, 44).set(pcm);

      app.setLocalSampleSnapshot(
        new Blob([wav], { type: 'audio/wav' }),
        {
          engine: 'praat',
          quality: { rateable: true, confidence: 0.4 },
          syllables: [{ startTime: 0.1, endTime: 0.2, duration: 0.1 }]
        }
      );
      const button = document.querySelector('#pa-save-local-sample-btn');
      const ready = { exists: Boolean(button), disabled: button?.disabled };
      await app.saveLocalSample();
      return {
        ready,
        status: document.querySelector('#pa-local-sample-status')?.textContent,
        saved: window.__savedLocalSamples
      };
    });
    assert.deepEqual(localSampleSave.ready, { exists: true, disabled: false });
    assert.match(localSampleSave.status, /Saved locally:/);
    assert.equal(localSampleSave.saved.length, 1);
    assert.equal(localSampleSave.saved[0].metadata.source, 'pronounce-mode-local');
    assert.equal(localSampleSave.saved[0].metadata.word, 'photograph');
    assert.equal(localSampleSave.saved[0].audio.type, 'audio/wav');
    const manualCloudSave = await page.evaluate(async () => {
      const { bootPronunciationApp } = await import('/pronunciation-analyzer/main.js');
      const app = bootPronunciationApp();
      app.localSampleEnabled = false;
      app.showSyllableVerifier = Object.getPrototypeOf(app).showSyllableVerifier;
      app.userAudioBlob = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/wav' });
      app.praatAPI.ensureWav = async (blob) => blob;
      app.currentReference = { word: 'photograph' };
      app.currentWordRef = {
        id: '8888888888888888',
        displayIpa: '/ˈfoʊtəˌɡræf/',
        syllableCount: 3
      };
      app.expectedData = { syllables: 3, ipa: '/ˈfoʊtəˌɡræf/' };
      app.syllableVerifier = {
        destroy() {},
        syllables: [
          { startTime: 0.05, endTime: 0.2 },
          { startTime: 0.2, endTime: 0.42 },
          { startTime: 0.42, endTime: 0.68 }
        ]
      };
      window.firebaseAuthFunctions = {
        getCurrentUser: () => ({ getIdToken: async () => 'manual-review-test-token' })
      };
      return app.saveManualReview([
        { startTime: 0.08, endTime: 0.19 },
        { startTime: 0.21, endTime: 0.4 },
        { startTime: 0.43, endTime: 0.7 }
      ]).then((result) => ({ result, saved: window.__savedManualReviews, auth: window.__manualReviewAuthHeader }));
    });
    assert.equal(manualCloudSave.result.sampleId, manualCloudSave.saved[0].sampleId);
    assert.equal(manualCloudSave.saved[0].needsManualReview, true);
    assert.equal(manualCloudSave.saved[0].reviewReason, 'manual_syllable_segmentation');
    assert.equal(manualCloudSave.saved[0].manualSegments.length, 3);
    assert.equal(manualCloudSave.saved[0].automaticSegments.length, 3);
    assert.equal(manualCloudSave.auth, 'Bearer manual-review-test-token');
    const manualLocalSave = await page.evaluate(async () => {
      const { bootPronunciationApp } = await import('/pronunciation-analyzer/main.js');
      const app = bootPronunciationApp();
      app.localSampleEnabled = true;
      app.userAudioBlob = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/wav' });
      app.praatAPI.ensureWav = async (blob) => blob;
      app.currentReference = { word: 'photograph' };
      app.currentWordRef = {
        id: '8888888888888888',
        displayIpa: '/ËˆfoÊŠtÉ™ËŒÉ¡rÃ¦f/',
        syllableCount: 3,
        syllables: [{ ipa: 'foÊŠ' }, { ipa: 'tÉ™' }, { ipa: 'É¡rÃ¦f' }]
      };
      app.expectedData = { syllables: 3, ipa: '/ËˆfoÊŠtÉ™ËŒÉ¡rÃ¦f/' };
      app.syllableVerifier = {
        destroy() {},
        syllables: [
          { startTime: 0.05, endTime: 0.2 },
          { startTime: 0.2, endTime: 0.42 },
          { startTime: 0.42, endTime: 0.68 }
        ]
      };
      window.firebaseAuthFunctions = null;
      window.auth = { currentUser: null };
      window.__savedLocalSamples = [];
      const result = await app.saveManualReview([
        { startTime: 0.08, endTime: 0.19 },
        { startTime: 0.21, endTime: 0.4 },
        { startTime: 0.43, endTime: 0.7 }
      ]);
      return { result, saved: window.__savedLocalSamples };
    });
    assert.equal(manualLocalSave.saved.length, 1);
    assert.equal(manualLocalSave.saved[0].metadata.source, 'pronounce-mode-local');
    assert.equal(manualLocalSave.saved[0].metadata.manualReview.manualSegments.length, 3);

    const targetDurationFallback = await page.evaluate(async () => {
      const { bootPronunciationApp } = await import('/pronunciation-analyzer/main.js');
      const app = bootPronunciationApp();
      app.currentReference = { word: 'photograph' };
      app.currentWordRef = {
        nativeAnalysis: { quality: { rateable: false } },
        syllables: [{ ipa: 'foÊŠ' }, { ipa: 'tÉ™' }, { ipa: 'É¡rÃ¦f' }]
      };
      app.expectedData = { syllables: 3, primaryStress: 0 };
      app.nativePattern = [
        { duration: 0.22, ipa: 'foÊŠ' },
        { duration: 0.11, ipa: 'tÉ™' },
        { duration: 0.18, ipa: 'É¡rÃ¦f' }
      ];
      app.renderSyllableFeedback(
        null,
        [
          { startTime: 0.05, endTime: 0.2, duration: 0.15 },
          { startTime: 0.2, endTime: 0.42, duration: 0.22 },
          { startTime: 0.42, endTime: 0.68, duration: 0.26 }
        ],
        0,
        { rateable: false, confidence: 0 },
        { rateable: false, confidence: 0 }
      );
      const chart = window.__charts.at(-1);
      return {
        labels: chart.data.labels,
        target: chart.data.datasets.find((dataset) => dataset.label === 'Target duration')?.data
      };
    });
    assert.deepEqual(
      targetDurationFallback.labels,
      ['Target: foÊŠ', 'Target: tÉ™', 'Target: É¡rÃ¦f', 'Observed 1', 'Observed 2', 'Observed 3']
    );
    assert.deepEqual(targetDurationFallback.target, [0.22, 0.11, 0.18, null, null, null]);
    assert.deepEqual(
      await page.evaluate(async () => {
        const { isLocalPronounceHost } = await import('/pronunciation-analyzer/app.js');
        return {
          localhost: isLocalPronounceHost('localhost'),
          loopback: isLocalPronounceHost('127.0.0.1'),
          production: isLocalPronounceHost('betterenglishlearning.com')
        };
      }),
      { localhost: true, loopback: true, production: false }
    );
    const screenshotDir = process.env.PRONOUNCE_SCREENSHOT_DIR;
    if (screenshotDir) {
      fs.mkdirSync(screenshotDir, { recursive: true });
      await page.screenshot({
        path: path.join(screenshotDir, 'pronunciation-reference-ux-desktop.png'),
        fullPage: true
      });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.locator('#pa-word-info').evaluate((node) => node.scrollWidth <= node.clientWidth),
      true
    );
    if (screenshotDir) {
      await page.screenshot({
        path: path.join(screenshotDir, 'pronunciation-reference-ux-mobile.png'),
        fullPage: true
      });
    }
    await page.setViewportSize({ width: 1280, height: 900 });

    const nativeAxes = await page.evaluate(() => {
      // Find the chart from initial draw (pitch mode)
      const chartPitch = window.__charts.find((item) => item?.options?.scales?.y && !item?.options?.scales?.y1);
      if (!chartPitch) throw new Error('chartPitch not found');
      const pitchTitle = chartPitch.options.scales.y.title.text;

      // Click on Volume button
      const toggleGroup = document.getElementById('pa-chart-mode-toggle');
      const volumeBtn = toggleGroup.querySelector('[data-mode="intensity"]');
      volumeBtn.click();

      // Find the updated chart (intensity mode, which is second-to-last because duration is redrawn last)
      const chartIntensity = window.__charts.at(-2);
      if (!chartIntensity) throw new Error('chartIntensity not found');
      const intensityTitle = chartIntensity.options.scales.y1.title.text;

      // Click back to Pitch button
      const pitchBtn = toggleGroup.querySelector('[data-mode="pitch"]');
      pitchBtn.click();

      return {
        pitch: pitchTitle,
        intensity: intensityTitle
      };
    });
    assert.deepEqual(nativeAxes, { pitch: 'Pitch (Hz)', intensity: 'Intensity (dB)' });

    await page.fill('#pa-word-input', 'photography');
    await page.click('#pa-search-btn');
    await page.waitForFunction(() => document.querySelector('#pa-ipa-display')?.textContent === '/fəˈtɑɡrəfi/');
    assert.equal(
      await page.locator('#pa-charts-container').evaluate((node) => node.classList.contains('hidden')),
      false
    );
    assert.equal(
      await page.locator('#pa-pitch-chart').evaluate((node) => node.closest('.pa-chart-card').hidden),
      false
    );
    assert.equal(
      await page.locator('#pa-stress-chart').evaluate((node) => node.closest('.pa-chart-card').hidden),
      false
    );
    assert.deepEqual(
      await page.evaluate(() => window.__charts.at(-1).data.datasets.map((dataset) => dataset.label)),
      ['Target duration']
    );

    await page.fill('#pa-word-input', 'busy');
    await page.click('#pa-search-btn');
    await page.waitForFunction(() => document.querySelector('#pa-syllable-count')?.textContent === '2 syllables');
    assert.equal(await page.locator('#pa-primary-stress').textContent(), 'BU');
    assert.deepEqual(
      await page.evaluate(() => window.__charts.at(-1).data.datasets[0].data),
      [0.15, 0.15]
    );

    // A transient native-analysis failure must not poison the session cache.
    await page.fill('#pa-word-input', 'retrygraph');
    await page.click('#pa-search-btn');
    await page.waitForFunction(() => document.querySelector('#pa-reference-status')?.textContent.includes('retried automatically'));
    assert.equal(
      await page.locator('#pa-charts-container').evaluate((node) => node.classList.contains('hidden')),
      true
    );
    assert.deepEqual(
      await page.evaluate(() => ({
        dictionaryCalls: window.__dictionaryCalls.retrygraph,
        analysisAttempts: window.__nativeAnalysisAttempts.cccccccccccccccc
      })),
      { dictionaryCalls: 1, analysisAttempts: 2 }
    );

    await page.click('#pa-search-btn');
    await page.waitForFunction(() => (
      document.querySelector('#pa-reference-status')?.textContent === '' &&
      !document.querySelector('#pa-charts-container')?.classList.contains('hidden')
    ));
    assert.deepEqual(
      await page.evaluate(() => ({
        dictionaryCalls: window.__dictionaryCalls.retrygraph,
        analysisAttempts: window.__nativeAnalysisAttempts.cccccccccccccccc
      })),
      { dictionaryCalls: 1, analysisAttempts: 3 }
    );

    const v3ClientContract = await page.evaluate(async () => {
      const { PraatAPI } = await import('/pronunciation-analyzer/praat-api.js');
      const { config } = await import('/pronunciation-analyzer/config.js');
      config.features.usePronunciationV3LearnerAnalysis = true;
      const api = new PraatAPI();
      api._v3SupportPromise = Promise.resolve('active');
      const result = await api.analyze(
        new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/wav' }),
        2,
        { referenceIpa: '/ˈbɪzi/', targetWord: 'busy' }
      );

      return {
        form: {
          referenceIpa: window.__lastV3Form.reference_ipa,
          expectedSyllables: window.__lastV3Form.expected_syllables,
          targetWord: window.__lastV3Form.target_word
        },
        count: result.syllable_count,
        timings: result.observed_syllables.map((syllable) => [
          syllable.startTime,
          syllable.endTime,
          syllable.duration
        ]),
        durationAvailable: result.capabilities.syllable_duration
      };
    });
    assert.deepEqual(v3ClientContract, {
      form: { referenceIpa: '/ˈbɪzi/', expectedSyllables: '2', targetWord: 'busy' },
      count: 2,
      timings: [[0.05, 0.24, 0.19], [0.24, 0.43, 0.19]],
      durationAvailable: true
    });

    const retryPolicyUi = await page.evaluate(async () => {
      const { bootPronunciationApp } = await import('/pronunciation-analyzer/main.js');
      const app = bootPronunciationApp();
      app.currentReference = { word: 'busy-v2' };
      app.currentWordRef = { id: 'busy-v2', displayIpa: '/ËˆbÉªzi/' };
      app.expectedData = { syllables: 2, primaryStress: 0 };
      const messages = [];
      for (let index = 0; index < 3; index += 1) {
        app.renderV3LearnerResult(
          {
            status: 'unrateable',
            count: { expected: 2, observed: 2, status: 'unrateable' },
            primary_stress: { applicable: true, status: 'unrateable' }
          },
          { available: true, observed_count: 2, expected_stress_appears_strongest: true, advisory_only: true },
          [],
          null
        );
        messages.push(document.querySelector('#pa-results-summary').textContent);
      }
      return messages;
    });
    assert.match(retryPolicyUi[0], /re-recording 1 of 2/);
    assert.match(retryPolicyUi[1], /re-recording 2 of 2/);
    assert.match(retryPolicyUi[2], /may be inaccurate/);

    const v2RetryPolicyUi = await page.evaluate(async () => {
      const { bootPronunciationApp } = await import('/pronunciation-analyzer/main.js');
      const app = bootPronunciationApp();
      const originalVisualizer = app.visualizer;
      app.currentReference = { word: 'busy-v4' };
      app.currentWordRef = { id: 'busy-v1', displayIpa: '/ËˆbÉªzi/' };
      app.expectedData = { syllables: 2, primaryStress: 0 };
      app.visualizer = { drawDurationChart() {}, clear() {} };
      app.showSyllableVerifier = () => {};
      const messages = [];
      for (let index = 0; index < 3; index += 1) {
        app.renderSyllableFeedback(
          null,
          [
            { startTime: 0.05, endTime: 0.24, duration: 0.19 },
            { startTime: 0.24, endTime: 0.43, duration: 0.19 }
          ],
          0,
          { rateable: false, confidence: 0 },
          { rateable: false, confidence: 0 }
        );
        messages.push(document.querySelector('#pa-results-summary').textContent);
      }
      app.visualizer = originalVisualizer;
      app.showSyllableVerifier = Object.getPrototypeOf(app).showSyllableVerifier;
      return messages;
    });
    assert.match(v2RetryPolicyUi[0], /re-recording 1 of 2/);
    assert.match(v2RetryPolicyUi[1], /re-recording 2 of 2/);
    assert.match(v2RetryPolicyUi[2], /may be inaccurate/);

    const manualReviewAccessUi = await page.evaluate(async () => {
      const { bootPronunciationApp } = await import('/pronunciation-analyzer/main.js');
      const app = bootPronunciationApp();
      app.localSampleEnabled = false;
      app.showSyllableVerifier = Object.getPrototypeOf(app).showSyllableVerifier;
      app.userAudioBlob = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/wav' });
      app.praatAPI.ensureWav = async (blob) => blob;
      app.currentReference = { word: 'busy' };
      app.currentWordRef = { id: 'busy-v1', displayIpa: '/ËˆbÉªzi/' };
      app.expectedData = { syllables: 2, primaryStress: 0 };
      window.firebaseAuthFunctions = {
        getCurrentUser: () => ({ getIdToken: async () => 'admin-review-test-token' })
      };
      const created = [];
      window.SyllableVerifier = class {
        constructor(_containerId, options) {
          created.push(options.enableManualReview);
        }
        loadAudio() {}
        destroy() {}
      };
      window.__adminStatus = false;
      await app.showSyllableVerifier(app.userAudioBlob, []);
      const learnerOnly = created.at(-1);
      window.__adminStatus = true;
      app._manualReviewAccessPromise = null;
      await app.showSyllableVerifier(app.userAudioBlob, []);
      return { learnerOnly, admin: created.at(-1) };
    });
    assert.deepEqual(manualReviewAccessUi, { learnerOnly: false, admin: true });
    if (screenshotDir) {
      await page.screenshot({
        path: path.join(screenshotDir, 'pronunciation-fresh-word-duration.png'),
        fullPage: true
      });
    }

    await page.fill('#pa-word-input', 'contouronly');
    await page.click('#pa-search-btn');
    await page.waitForFunction(() => document.querySelector('#pa-ipa-display')?.textContent === '/kɑntʊr/');
    assert.equal(
      await page.locator('#pa-stress-chart').evaluate((node) => node.closest('.pa-chart-card').hidden),
      true
    );

    await page.fill('#pa-word-input', 'tunnel');
    await page.click('#pa-search-btn');
    await page.waitForFunction(() => document.querySelector('#pa-ipa-display')?.textContent === '/ˈtʌnᵊl/');
    assert.equal(await page.locator('#pa-ipa-display').textContent(), '/ˈtʌnᵊl/');

    await page.fill('#pa-word-input', 'silent');
    await page.click('#pa-search-btn');
    await page.waitForFunction(() => document.querySelector('#pa-ipa-display')?.textContent.includes('saɪlənt'));
    assert.equal(await page.locator('#pa-record-btn').isDisabled(), false);
    assert.equal(await page.locator('#pa-charts-container').evaluate((node) => node.classList.contains('hidden')), true);

    await page.fill('#pa-word-input', 'fallback');
    await page.click('#pa-search-btn');
    await page.waitForFunction(() => document.querySelector('#pa-reference-status')?.textContent.includes('CMU pronunciation fallback'));
    assert.equal(await page.locator('#pa-record-btn').isDisabled(), false);
    assert.equal(await page.locator('#pa-native-audio-container').evaluate((node) => node.style.display), 'none');
    assert.equal(await page.locator('#pa-charts-container').evaluate((node) => node.classList.contains('hidden')), true);

    await page.fill('#pa-word-input', 'conflict');
    await page.click('#pa-search-btn');
    await page.waitForFunction(() => document.querySelector('#pa-reference-status')?.textContent.includes('under review'));
    assert.equal(await page.locator('#pa-record-btn').isDisabled(), true);
    assert.equal(await page.locator('#pa-charts-container').evaluate((node) => node.classList.contains('hidden')), true);

    await page.fill('#pa-word-input', 'import');
    await page.click('#pa-search-btn');
    await page.waitForFunction(() => document.querySelectorAll('#pa-word-forms button').length === 2);
    await page.evaluate(async () => {
      const { bootPronunciationApp } = await import('/pronunciation-analyzer/main.js');
      const app = bootPronunciationApp();
      app.userAudioBlob = new Blob(['old attempt'], { type: 'audio/webm' });
      app.syllableVerifier = {
        destroy() { window.__oldVerifierDestroyed = true; }
      };
      document.querySelector('#syllable-verifier-container').textContent = 'Old learner attempt';
    });
    await page.click('#pa-word-forms button[data-variant-id="4444444444444444"]');
    assert.equal(await page.locator('#pa-ipa-display').textContent(), '/ɪmˈpɔrt/');
    assert.match(await page.locator('#pa-pattern-display').textContent(), /Primary stress on s2, syllable 2/);
    assert.equal(
      await page.locator('#pa-word-forms button[data-variant-id="4444444444444444"]').getAttribute('aria-pressed'),
      'true'
    );
    assert.deepEqual(
      await page.evaluate(async () => {
        const { bootPronunciationApp } = await import('/pronunciation-analyzer/main.js');
        const app = bootPronunciationApp();
        return {
          verifierDestroyed: window.__oldVerifierDestroyed === true,
          verifierCleared: app.syllableVerifier === null,
          recordingCleared: app.userAudioBlob === null,
          verifierDom: document.querySelector('#syllable-verifier-container').textContent
        };
      }),
      {
        verifierDestroyed: true,
        verifierCleared: true,
        recordingCleared: true,
        verifierDom: ''
      }
    );

    const comparisonAxes = await page.evaluate(async () => {
      const { bootPronunciationApp } = await import('/pronunciation-analyzer/main.js');
      const app = bootPronunciationApp();
      const native = app.currentWordRef.nativeAnalysis;
      const learner = structuredClone(native);
      learner.variantId = undefined;
      learner.pitch.values = [220, 240, 210];
      app.visualizer.drawComparisonPitchContour(learner, native, app.currentWordRef.syllables);
      const chart = window.__charts.at(-2);
      const pitchTitle = chart.options.scales.y.title.text;
      const pitchTooltip = chart.options.plugins.tooltip.callbacks.label({
        dataset: chart.data.datasets[0],
        raw: chart.data.datasets[0].data[0]
      });

      // Toggle to volume/intensity to get intensity title
      const toggleGroup = document.getElementById('pa-chart-mode-toggle');
      const volumeBtn = toggleGroup.querySelector('[data-mode="intensity"]');
      volumeBtn.click();
      const intensityTitle = window.__charts.at(-2).options.scales.y.title.text;

      return {
        pitch: pitchTitle,
        intensity: intensityTitle,
        tooltip: pitchTooltip
      };
    });
    assert.equal(comparisonAxes.pitch, 'Relative pitch (semitones from speaker median)');
    assert.equal(comparisonAxes.intensity, 'Relative intensity (dB from voiced median)');
    assert.match(comparisonAxes.tooltip, /semitones.*Hz/);

    const mismatchLanes = await page.evaluate(async () => {
      const { bootPronunciationApp } = await import('/pronunciation-analyzer/main.js');
      const app = bootPronunciationApp();
      const native = app.currentWordRef.nativeAnalysis;
      const learner = structuredClone(native);
      learner.observed.syllableCount = 3;
      learner.observed.syllables.push({
        startTime: 0.4, endTime: 0.55, duration: 0.15, vowelDuration: 0.1,
        avgPitch: 130, maxPitch: 140, intensity: 67, isStressed: false
      });
      app.visualizer.drawDurationChart(native.observed.syllables, learner.observed.syllables);
      const chart = window.__charts.at(-1);
      return chart.data.datasets.map((dataset) => dataset.label);
    });
    assert.deepEqual(mismatchLanes, ['Target duration', 'Observed duration']);
    assert.deepEqual(pageErrors, []);
    assert.equal(
      requestFailures.length,
      0,
      `browser requests failed: ${JSON.stringify(requestFailures)}`
    );
  } finally {
    if (browser) await browser.close();
    await closeServer(server);
  }
}

if (require.main === module) {
  if (process.argv.includes('--serve-only')) {
    startServer().then(({ origin }) => process.stdout.write(`Pronunciation harness listening at ${origin}\n`));
  } else {
    run().then(() => process.stdout.write('pronounce-mode browser check passed\n')).catch((error) => {
      process.stderr.write(`${error.stack || error}\n`);
      process.exitCode = 1;
    });
  }
}

module.exports = { closeServer, startServer };
