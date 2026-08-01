// eslint-disable-next-line
const assert = require('assert');
const { chromium } = require('playwright');
const { startServer } = require('./pronounce-mode-browser-check.js');

async function run() {
  const { server, origin } = await startServer();
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(() => {
    window.Logger = { log() {}, warn() {}, error() {} };
    window.__adminStatus = true;
    window.__comparisonRequests = [];
    window.__savedComparisons = [];
    window.__comparisonSaveAuthHeader = null;
    window.AudioContext = class {
      constructor() { this.state = 'running'; this.sampleRate = 16000; this.destination = {}; }
      decodeAudioData() { return Promise.resolve({ duration: 0.8, sampleRate: 16000, getChannelData: () => new Float32Array(8000) }); }
      resume() { return Promise.resolve(); }
    };
    window.SyllableVerifier = class {
      constructor(_id, options) {
        this.options = options;
        this.syllables = [];
        window.__comparisonVerifier = this;
      }
      async loadAudio(_audio, syllables) { this.syllables = syllables; }
      setAutomaticSyllables(syllables) { this.syllables = syllables; }
      destroy() {}
    };
    window.firebaseAuthFunctions = {
      getCurrentUser: () => ({ getIdToken: async () => 'comparison-admin-token' })
    };
    const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' }
    });
    window.fetch = async (resource, options = {}) => {
      const url = String(resource?.url || resource || '');
      if (url.endsWith('/health')) return jsonResponse({ status: 'ok', pronunciationV3Mode: 'shadow' });
      if (url.includes('/api/admin/status')) return jsonResponse({ success: true, isAdmin: true });
      if (url.includes('/dictionary/v2/')) {
        return jsonResponse({
          schemaVersion: 10,
          algorithmVersion: 'pronunciation-reference-v4',
          word: 'photograph',
          dialect: 'en-US',
          defaultVariantId: '8888888888888888',
          variants: [{
            id: '8888888888888888',
            rawIpa: 'ËˆfoÊŠtÉ™ËŒgrÃ¦f',
            displayIpa: '/ËˆfoÊŠtÉ™ËŒÉ¡rÃ¦f/',
            syllableCount: 3,
            primaryStress: 0,
            secondaryStress: [2],
            syllables: [{ ipa: 'pho' }, { ipa: 'to' }, { ipa: 'graph' }],
            audioUrl: null,
            validation: { status: 'valid', conflicts: [] },
            capabilities: { playAudio: false, scoreCountStress: true, showNativeGraphs: false }
          }]
        });
      }
      if (url.includes('/analyze/compare')) {
        window.__comparisonRequests.push(options.body);
        return jsonResponse({
          schemaVersion: 'pronunciation-comparison-v1', mode: 'comparison', status: 'complete', comparisonId: 'browser-comparison-1',
          context: { targetWord: 'photograph', referenceIpa: '/ËˆfoÊŠtÉ™ËŒÉ¡rÃ¦f/', expectedSyllables: 3, variantId: '8888888888888888' },
          revisions: { comparisonSchema: 'pronunciation-comparison-v1', v2: 'pronunciation-analysis-v2', v3: 'pronunciation-analysis-v3', v3Model: 'browser-model' },
          v2: { status: 'available', analysis: { analysisVersion: 'pronunciation-analysis-v2', quality: { confidence: 0.81 }, duration: 0.8, observed: { syllableCount: 2, syllables: [{ startTime: 0.05, endTime: 0.35, duration: 0.3, label: 'pho' }, { startTime: 0.35, endTime: 0.8, duration: 0.45, label: 'graph' }] } } },
          v3: { status: 'available', analysis: { analysisVersion: 'pronunciation-analysis-v3', confidence: 0.94, total_duration: 0.78, syllable_count: 3, observed_syllables: [{ startTime: 0.05, endTime: 0.25, duration: 0.2, label: 'pho' }, { startTime: 0.25, endTime: 0.48, duration: 0.23, label: 'to' }, { startTime: 0.48, endTime: 0.78, duration: 0.3, label: 'graph' }] } }
        });
      }
      if (url.includes('/api/admin/dev/save-analysis-comparison')) {
        let metadata = {};
        for (const [key, value] of options.body?.entries?.() || []) {
          if (key === 'metadata' && typeof value === 'string') metadata = JSON.parse(value);
        }
        window.__comparisonSaveAuthHeader = options.headers?.Authorization || null;
        window.__savedComparisons.push(metadata);
        return jsonResponse({ success: true, data: { comparisonId: metadata.comparisonId } });
      }
      if (url.includes('/analyze-url/v2')) return jsonResponse({ analysisVersion: 'pronunciation-analysis-v2', observed: { syllableCount: 3, syllables: [] }, quality: { rateable: false }, pitch: { times: [], values: [] }, intensity: { times: [], values: [] } });
      if (url.includes('/proxy-audio')) return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
      return jsonResponse({});
    };
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  try {
    await page.goto(`${origin}/pronounce-v2-harness`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(250);

    const result = await page.evaluate(async () => {
      const { bootPronunciationApp } = await import('/pronunciation-analyzer/main.js');
      const app = bootPronunciationApp();
      const comparison = await app.praatAPI.analyzeComparison(
        new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/wav' }),
        { referenceIpa: '/ËˆfoÊŠtÉ™ËŒÉ¡rÃ¦f/', expectedSyllables: 3, targetWord: 'photograph', variantId: '8888888888888888' }
      );
      app.userAudioBlob = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/wav' });
      app.praatAPI.ensureWav = async (blob) => blob;
      app.renderVersionComparison(comparison, app.userAudioBlob);
      await new Promise((resolve) => setTimeout(resolve, 20));
      const originalManual = [{ startTime: 0.1, endTime: 0.2, source: 'manual-review' }];
      app.versionComparisonManualSegments = originalManual.map((segment) => ({ ...segment }));
      app.setVersionComparisonBoundarySource('v3');
      const sourceAfterToggle = app.versionComparisonBoundarySource;
      const manualAfterToggle = app.versionComparisonManualSegments;
      const saveDisabledBeforeVote = document.querySelector('#pa-version-save').disabled;
      document.querySelector('input[name="pa-version-judgment"][value="v3"]').focus();
      document.querySelector('input[name="pa-version-judgment"][value="v3"]').click();
      const saveEnabledAfterVote = document.querySelector('#pa-version-save').disabled;
      await app.saveVersionComparison();
      return {
        compareRequests: window.__comparisonRequests.length,
        v2Count: document.querySelector('#pa-version-v2 .pa-version-metric-row dd')?.textContent,
        v3Count: document.querySelector('#pa-version-v3 .pa-version-metric-row dd')?.textContent,
        radioCount: document.querySelectorAll('input[name="pa-version-judgment"]').length,
        visible: !document.querySelector('#pa-version-comparison').hidden,
        sourceAfterToggle,
        manualAfterToggle,
        saveDisabledBeforeVote,
        saveEnabledAfterVote,
        saved: window.__savedComparisons,
        auth: window.__comparisonSaveAuthHeader,
        overflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth
      };
    });

    assert.equal(result.compareRequests, 1);
    assert.equal(result.v2Count, '2');
    assert.equal(result.v3Count, '3');
    assert.equal(result.radioCount, 4);
    assert.equal(result.visible, true);
    assert.equal(result.sourceAfterToggle, 'v3');
    assert.deepEqual(result.manualAfterToggle, [{ startTime: 0.1, endTime: 0.2, source: 'manual-review' }]);
    assert.equal(result.saveDisabledBeforeVote, true);
    assert.equal(result.saveEnabledAfterVote, false);
    assert.equal(result.saved.length, 1);
    assert.equal(result.saved[0].judgment, 'v3');
    assert.equal(result.saved[0].analyses.v2.status, 'available');
    assert.equal(result.auth, 'Bearer comparison-admin-token');
    assert.equal(result.overflow, true);
    assert.deepEqual(pageErrors, []);
  } finally {
    await browser.close();
    server.close();
  }
}

run().then(() => process.stdout.write('pronounce-version-comparison browser check passed\n')).catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
