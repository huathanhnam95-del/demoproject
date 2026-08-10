// eslint-disable-next-line
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { closeServer, startServer } = require('./pronounce-mode-browser-check.js');

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
        const learnerTimes = Array.from({ length: 40 }, (_value, index) => index * 0.02);
        const learnerPitch = learnerTimes.map((_value, index) => 150 + (index % 10));
        const learnerIntensity = learnerTimes.map((_value, index) => 65 + (index % 8));
        return jsonResponse({
          schemaVersion: 'pronunciation-comparison-v1', mode: 'comparison', status: 'complete', comparisonId: 'browser-comparison-1',
          context: { targetWord: 'photograph', referenceIpa: '/ˈfoʊtəˌɡræf/', expectedSyllables: 3, variantId: '8888888888888888' },
          revisions: { comparisonSchema: 'pronunciation-comparison-v1', v2: 'pronunciation-analysis-v2', v3: 'pronunciation-analysis-v3', v3Model: 'browser-model' },
          v2: { status: 'available', analysis: { analysisVersion: 'pronunciation-analysis-v2', quality: { confidence: 0.81 }, duration: 0.8, pitch: { times: learnerTimes, values: learnerPitch }, intensity: { times: learnerTimes, values: learnerIntensity }, observed: { syllableCount: 2, syllables: [{ startTime: 0.05, endTime: 0.35, duration: 0.3, vowelDuration: 0.18, label: 'pho' }, { startTime: 0.35, endTime: 0.8, duration: 0.45, vowelDuration: 0.22, label: 'graph' }] } } },
          v3: { status: 'available', analysis: { analysisVersion: 'pronunciation-analysis-v3', confidence: 0.94, total_duration: 0.78, segmentation_convention: 'ctc-token-coverage', measurement_convention: 'ctc-blank-midpoint-v1', pitch: { times: learnerTimes, values: learnerPitch }, intensity: { times: learnerTimes, values: learnerIntensity }, syllable_count: 3, observed_syllables: [{ startTime: 0.05, endTime: 0.25, measurementStartTime: 0.07, measurementEndTime: 0.27, duration: 0.2, label: 'pho' }, { startTime: 0.25, endTime: 0.48, measurementStartTime: 0.27, measurementEndTime: 0.45, duration: 0.23, label: 'to' }, { startTime: 0.48, endTime: 0.78, measurementStartTime: 0.48, measurementEndTime: 0.7, duration: 0.3, label: 'graph' }] } }
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
        { referenceIpa: '/ˈfoʊtəˌɡræf/', expectedSyllables: 3, targetWord: 'photograph', variantId: '8888888888888888' }
      );
      window.__comparisonFixture = comparison;
      app.userAudioBlob = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/wav' });
      app.praatAPI.ensureWav = async (blob) => blob;
      // A reviewer always reaches the comparison with a word loaded, so the
      // native reference must be present for the production draw path.
      const times = Array.from({ length: 40 }, (_value, index) => index * 0.02);
      app.currentWordRef = {
        syllables: [{ ipa: 'pho' }, { ipa: 'to' }, { ipa: 'graph' }],
        nativeAnalysis: {
          quality: { rateable: true, confidence: 0.9 },
          pitch: { times, values: times.map((_value, index) => 180 + (index % 7)) },
          intensity: { times, values: times.map((_value, index) => 70 + (index % 5)) },
          observed: {
            syllableCount: 3,
            syllables: [
              { startTime: 0.0, endTime: 0.2, duration: 0.2 },
              { startTime: 0.2, endTime: 0.5, duration: 0.3 },
              { startTime: 0.5, endTime: 0.8, duration: 0.3 }
            ]
          }
        }
      };
      const chartsBeforeComparison = (window.__charts || []).length;
      app.renderVersionComparison(comparison, app.userAudioBlob);
      await new Promise((resolve) => setTimeout(resolve, 20));
      // The charts must describe the recording under review, not the native
      // reference drawn at word load. Capture before the v3 toggle.
      const chartState = {
        chartLibraryLoaded: typeof window.Chart === 'function',
        visualizerPresent: Boolean(app.visualizer),
        comparisonChartCount: (window.__charts || []).length - chartsBeforeComparison,
        chartsHidden: document.getElementById('pa-charts-container').classList.contains('hidden'),
        pitchLabels: (app.visualizer?.pitchChart?.data?.datasets || []).map((set) => set.label),
        learnerPitchPointCount: (app.visualizer?.pitchChart?.data?.datasets || [])
          .find((ds) => /your/i.test(ds.label))?.data
          ?.filter((point) => Number.isFinite(point?.y)).length || 0,
        durationLanes: (app.visualizer?.stressChart?.data?.datasets || []).map((set) => ({
          label: set.label,
          values: (set.data || []).filter((value) => typeof value === 'number')
        })),
        barVisible: !document.getElementById('pa-version-review-bar').hidden
      };
      const confidenceLabel = (selector) => Array.from(
        document.querySelectorAll(`${selector} .pa-version-metric-row dt`)
      ).find((node) => /confidence/i.test(node.textContent || ''))?.textContent.trim() || '';
      const confidenceLabels = {
        v2: confidenceLabel('#pa-version-v2'),
        v3: confidenceLabel('#pa-version-v3')
      };
      // Prosody must remain visible even when an engine has no usable
      // syllable boundaries; only the duration lane depends on spans.
      app.drawLearnerCharts({
        ...comparison.v2.analysis,
        observed: { syllableCount: 0, syllables: [] }
      }, []);
      const contourOnlyState = {
        chartsHidden: document.getElementById('pa-charts-container').classList.contains('hidden'),
        learnerPitchPointCount: (app.visualizer?.pitchChart?.data?.datasets || [])
          .find((ds) => /your/i.test(ds.label))?.data
          ?.filter((point) => Number.isFinite(point?.y)).length || 0
      };
      app.renderVersionComparison(comparison, app.userAudioBlob);
      const originalManual = [{ startTime: 0.1, endTime: 0.2, source: 'manual-review' }];
      app.versionComparisonManualSegments = originalManual.map((segment) => ({ ...segment }));
      app.setVersionComparisonBoundarySource('v3');
      const sourceAfterToggle = app.versionComparisonBoundarySource;
      document.querySelector('#pa-chart-mode-toggle [data-mode="intensity"]')?.click();
      const v3ToggleDurationLanes = (app.visualizer?.stressChart?.data?.datasets || []).map((set) => ({
        label: set.label,
        values: (set.data || []).filter((value) => typeof value === 'number')
      }));
      const manualAfterToggle = app.versionComparisonManualSegments;
      const saveDisabledBeforeVote = document.querySelector('#pa-version-save').disabled;
      const v2Count = document.querySelector('#pa-version-v2 .pa-version-metric-row dd')?.textContent;
      const v3Count = document.querySelector('#pa-version-v3 .pa-version-metric-row dd')?.textContent;
      document.querySelector('input[name="pa-version-judgment"][value="v3"]').focus();
      document.querySelector('input[name="pa-version-judgment"][value="v3"]').click();
      const saveEnabledAfterVote = document.querySelector('#pa-version-save').disabled;
      await app.saveVersionComparison();
      const completeSavedCount = window.__savedComparisons.length;
      const v3BoundaryLabel = document.querySelector('#pa-version-v3 .pa-version-boundary-label')?.textContent || '';
      const partial = {
        ...comparison,
        status: 'partial_failure',
        v3: { status: 'unavailable', reason: 'MODEL_INFERENCE_FAILED', analysis: null }
      };
      app.renderVersionComparison(partial, null);
      await Promise.all([app.saveVersionComparison(), app.saveVersionComparison()]);
      return {
        chartState,
        contourOnlyState,
        confidenceLabels,
        compareRequests: window.__comparisonRequests.length,
        v2Count,
        v3Count,
        v3BoundaryLabel,
        radioCount: document.querySelectorAll('input[name="pa-version-judgment"]').length,
        visible: !document.querySelector('#pa-version-comparison').hidden,
        sourceAfterToggle,
        v3ToggleDurationLanes,
        manualAfterToggle,
        saveDisabledBeforeVote,
        saveEnabledAfterVote,
        saved: window.__savedComparisons,
        completeSavedCount,
        partialJudgmentHidden: document.querySelector('#pa-version-judgment').hidden,
        auth: window.__comparisonSaveAuthHeader,
        overflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth
      };
    });

    // Fix regression guard: the comparison used to leave both charts showing
    // the native-only reference, so the recording never appeared on them.
    assert.equal(result.chartState.chartLibraryLoaded, true, 'Chart.js must load or the chart assertions below prove nothing');
    assert.equal(result.chartState.visualizerPresent, true, 'visualizer must exist or drawLearnerCharts silently no-ops');
    assert.equal(
      result.chartState.comparisonChartCount,
      2,
      `comparison render should create one pitch chart and one duration chart, got ${result.chartState.comparisonChartCount}`
    );
    assert.equal(result.chartState.chartsHidden, false, 'charts stay visible for an available comparison');
    assert.ok(
      result.chartState.pitchLabels.some((label) => /your/i.test(label)),
      `prosody chart must carry a learner series, got ${JSON.stringify(result.chartState.pitchLabels)}`
    );
    assert.ok(
      result.chartState.learnerPitchPointCount > 0,
      `learner pitch dataset must carry actual data points, got ${result.chartState.learnerPitchPointCount}`
    );
    assert.equal(result.contourOnlyState.chartsHidden, false, 'prosody charts must remain visible without boundary spans');
    assert.ok(
      result.contourOnlyState.learnerPitchPointCount > 0,
      `contour-only learner pitch must carry actual data points, got ${result.contourOnlyState.learnerPitchPointCount}`
    );
    assert.match(result.confidenceLabels.v2, /Acoustic segmentation/i);
    assert.match(result.confidenceLabels.v3, /Mean forced-alignment/i);

    // Sticky review bar scroll & positioning automation assertion
    const stickyCheck = await page.evaluate(() => {
      window.scrollTo(0, 500);
      const bar = document.querySelector('#pa-version-review-bar');
      const rect = bar?.getBoundingClientRect();
      const style = window.getComputedStyle(bar);
      return {
        scrolledY: window.scrollY,
        barBottom: Math.round(rect?.bottom || 0),
        viewportHeight: window.innerHeight,
        judgmentVisible: (() => {
          const bounds = document.querySelector('#pa-version-judgment')?.getBoundingClientRect();
          return Boolean(bounds && bounds.top >= 0 && bounds.bottom <= window.innerHeight);
        })(),
        position: style.position,
        barVisible: !bar.hidden
      };
    });
    assert.equal(stickyCheck.scrolledY, 500, 'page must scroll down 500px');
    assert.equal(stickyCheck.position, 'sticky', 'review bar must use CSS sticky positioning');
    assert.equal(stickyCheck.barVisible, true, 'review bar must remain visible after scrolling');
    assert.ok(
      stickyCheck.barBottom >= stickyCheck.viewportHeight - 5 && stickyCheck.barBottom <= stickyCheck.viewportHeight + 5,
      `sticky bar bottom must stay pinned near viewport bottom, got ${stickyCheck.barBottom} vs viewport ${stickyCheck.viewportHeight}`
    );
    assert.equal(stickyCheck.judgmentVisible, true, 'judgment controls must remain in the viewport after scrolling');
    const observedLane = result.chartState.durationLanes.find((lane) => /observed/i.test(lane.label));
    assert.ok(observedLane, `duration chart must carry an observed lane, got ${JSON.stringify(result.chartState.durationLanes.map((lane) => lane.label))}`);
    assert.ok(observedLane.values.length > 0, 'observed lane must have bars');
    assert.ok(
      observedLane.values.every((value) => value > 0),
      `observed bars must have real durations, got ${JSON.stringify(observedLane.values)}`
    );
    assert.deepEqual(
      observedLane.values.map((value) => Number(value.toFixed(2))),
      [0.18, 0.22],
      'V2 duration bars must retain analyzer vowel durations instead of full boundary spans'
    );
    // Sticky review bar is present only while the comparison is live.
    assert.equal(result.chartState.barVisible, true);

    assert.equal(result.compareRequests, 1);
    assert.equal(result.v2Count, '2');
    assert.equal(result.v3Count, '3');
    assert.match(result.v3BoundaryLabel, /CTC token coverage/i);
    assert.equal(result.radioCount, 4);
    assert.equal(result.visible, true);
    assert.equal(result.sourceAfterToggle, 'v3');
    const v3ObservedLane = result.v3ToggleDurationLanes.find((lane) => /observed/i.test(lane.label));
    assert.deepEqual(
      v3ObservedLane?.values.map((value) => Number(value.toFixed(2))),
      [0.2, 0.23, 0.3],
      'chart-mode toggles must retain the selected V3 boundary durations'
    );
    assert.deepEqual(result.manualAfterToggle, [{ startTime: 0.1, endTime: 0.2, source: 'manual-review' }]);
    assert.equal(result.saveDisabledBeforeVote, true);
    assert.equal(result.saveEnabledAfterVote, false);
    assert.equal(result.saved.length, 2);
    assert.equal(result.saved[0].judgment, 'v3');
    assert.equal(result.saved[0].analyses.v2.status, 'available');
    assert.equal(result.saved[1].judgment, null);
    assert.equal(result.completeSavedCount, 1);
    assert.equal(result.partialJudgmentHidden, true);
    assert.equal(result.auth, 'Bearer comparison-admin-token');
    assert.equal(result.overflow, true);
    assert.deepEqual(pageErrors, []);
    const screenshotDir = process.env.PRONOUNCE_SCREENSHOT_DIR;
    if (screenshotDir) {
      fs.mkdirSync(screenshotDir, { recursive: true });
      await page.evaluate(async () => {
        const { bootPronunciationApp } = await import('/pronunciation-analyzer/main.js');
        bootPronunciationApp().renderVersionComparison(window.__comparisonFixture, null);
      });
      await page.screenshot({ path: path.join(screenshotDir, 'pronunciation-v2-v3-comparison-desktop.png'), fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: path.join(screenshotDir, 'pronunciation-v2-v3-comparison-mobile.png'), fullPage: true });
    }
  } finally {
    await browser.close();
    await closeServer(server);
  }
}

run().then(() => process.stdout.write('pronounce-version-comparison browser check passed\n')).catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
