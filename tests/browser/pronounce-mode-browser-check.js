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
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(Number(process.env.PRONOUNCE_HARNESS_PORT || 0), '127.0.0.1', () => resolve({
      server,
      origin: `http://127.0.0.1:${server.address().port}`
    }));
  });
}

async function run() {
  const { server, origin } = await startServer();
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });

  await context.addInitScript(() => {
    window.__charts = [];
    window.__dictionaryCalls = {};
    window.__nativeAnalysisAttempts = {};
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
  page.on('pageerror', (error) => pageErrors.push(error.message));
  try {
    await page.goto(`${origin}/pronounce-v2-harness`, { waitUntil: 'networkidle' });
    try {
      await page.waitForFunction(() => document.querySelector('#pa-pattern-display')?.textContent.includes('Single-syllable'));
    } catch (error) {
      console.error('pronunciation harness boot diagnostics', {
        pageErrors,
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
  } finally {
    await browser.close();
    server.close();
  }
}

if (process.argv.includes('--serve-only')) {
  startServer().then(({ origin }) => process.stdout.write(`Pronunciation harness listening at ${origin}\n`));
} else {
  run().then(() => process.stdout.write('pronounce-mode browser check passed\n')).catch((error) => {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
  });
}

module.exports = { startServer };
