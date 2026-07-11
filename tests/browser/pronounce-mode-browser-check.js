// eslint-disable-next-line
const assert = require('assert');
const express = require('express');
const http = require('http');
const { chromium } = require('playwright');

function harnessHtml() {
  return `<!doctype html>
  <html><body>
    <button id="tab-pronounce" class="tab-btn">Pronounce</button>
    <div id="mode-pronounce" class="mode-panel" style="display:block">
      <button id="pa-record-btn">Record</button>
      <button id="pa-stop-btn" disabled>Stop</button>
      <div id="pa-status"></div><div id="pa-spinner"></div>
      <input id="pa-word-input" value="car"><button id="pa-search-btn">Search</button>
      <div id="pa-word-forms" class="hidden"></div>
      <div id="pa-reference-status" aria-live="polite"></div>
      <div id="pa-word-info">
        <span id="pa-ipa-display"></span><span id="pa-pattern-display"></span>
      </div>
      <div id="pa-loading-placeholder"></div>
      <div id="pa-native-audio-container"><audio id="pa-native-audio"></audio></div>
      <div id="pa-results-summary"></div>
      <div id="pa-charts-container" class="pa-charts-grid">
        <canvas id="pa-pitch-chart"></canvas><canvas id="pa-stress-chart"></canvas>
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
  const browser = await chromium.launch({ headless: true, channel: 'chromium' });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });

  await context.addInitScript(() => {
    window.__charts = [];
    window.Chart = class FakeChart {
      constructor(_canvas, config) {
        this.config = config;
        this.data = config.data;
        this.options = config.options;
        window.__charts.push(config);
      }
      destroy() {}
      update() {}
    };
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
      status = 'valid',
      audio = true,
      provider = 'merriam-webster'
    }) => ({
      id,
      partOfSpeech: pos,
      definition: 'fixture',
      source: {
        provider,
        entryId: provider === 'cmu-pronouncing-dictionary' ? `cmudict:${id}` : id,
        exactMatch: true,
        transcription: provider === 'cmu-pronouncing-dictionary'
          ? 'cmu-arpabet-converted'
          : 'merriam-webster-ipa'
      },
      rawIpa,
      displayIpa,
      syllableCount: count,
      primaryStress: stress,
      secondaryStress: secondary,
      syllables: Array.from({ length: count }, (_, index) => ({
        index,
        ipa: count === 1 ? displayIpa.replaceAll('/', '') : `s${index + 1}`,
        label: null,
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
        const variants = references[word] || [];
        const defaultVariant = variants.find((item) => item.validation.status === 'valid');
        return jsonResponse({
          schemaVersion: 9,
          algorithmVersion: 'pronunciation-reference-v2',
          deploymentVersion: 'browser-fixture',
          word,
          dialect: 'en-US',
          defaultVariantId: defaultVariant?.id || null,
          variants
        });
      }
      if (url.includes('/analyze-url/v2')) {
        const request = JSON.parse(options.body);
        const count = request.expectedSyllableCount;
        return jsonResponse({
          analysisVersion: 'pronunciation-analysis-v2',
          variantId: request.variantId,
          canonicalSyllableCount: count,
          quality: { rateable: true, confidence: 0.92, reasons: [] },
          segmentation: {
            rawCandidateCount: count, evidenceCandidateCount: count, selectedCount: count,
            method: 'acoustic-candidate-selection', confidence: 0.92, conflicts: []
          },
          observed: {
            syllableCount: count,
            primaryStress: 0,
            syllables: Array.from({ length: count }, (_, index) => ({
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
          capabilities: { showNativeGraphs: true }
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
      await page.waitForFunction(() => document.querySelector('#pa-pattern-display')?.textContent.includes('single-syllable'));
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

    const nativeAxes = await page.evaluate(() => {
      const chart = window.__charts.find((item) => item?.options?.scales?.y1);
      return {
        pitch: chart.options.scales.y.title.text,
        intensity: chart.options.scales.y1.title.text
      };
    });
    assert.deepEqual(nativeAxes, { pitch: 'Pitch (Hz)', intensity: 'Intensity (dB)' });

    await page.fill('#pa-word-input', 'tunnel');
    await page.click('#pa-search-btn');
    await page.waitForFunction(() => document.querySelector('#pa-pattern-display')?.textContent.includes('2 syllables'));
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
    await page.click('#pa-word-forms button[data-variant-id="4444444444444444"]');
    assert.equal(await page.locator('#pa-ipa-display').textContent(), '/ɪmˈpɔrt/');
    assert.match(await page.locator('#pa-pattern-display').textContent(), /primary stress on 2/);

    const comparisonAxes = await page.evaluate(async () => {
      const { bootPronunciationApp } = await import('/pronunciation-analyzer/main.js');
      const app = bootPronunciationApp();
      const native = app.currentWordRef.nativeAnalysis;
      const learner = structuredClone(native);
      learner.variantId = undefined;
      learner.pitch.values = [220, 240, 210];
      app.visualizer.drawComparisonPitchContour(learner, native, app.currentWordRef.syllables);
      const chart = window.__charts.at(-2);
      return {
        pitch: chart.options.scales.y.title.text,
        intensity: chart.options.scales.y1.title.text,
        tooltip: chart.options.plugins.tooltip.callbacks.label({
          dataset: chart.data.datasets[0],
          raw: chart.data.datasets[0].data[0]
        })
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
