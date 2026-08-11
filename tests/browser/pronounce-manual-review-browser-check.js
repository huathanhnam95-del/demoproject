const assert = require('assert');
const express = require('express');
const http = require('http');
const { chromium } = require('playwright');

async function run() {
  const app = express();
  app.use(express.static('public'));
  app.get('/manual-review-harness', (_request, response) => {
    response.type('html').send(`<!doctype html>
      <html><head><link rel="stylesheet" href="/pronunciation-analyzer/syllable-verifier.css"></head>
      <body><div id="syllable-verifier-container"></div>
      <script src="/pronunciation-analyzer/syllable-verifier.js"></script></body></html>`);
  });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });

  try {
    await page.addInitScript(() => {
      class Emitter {
        constructor() { this.listeners = new Map(); }
        on(name, callback) {
          const list = this.listeners.get(name) || [];
          list.push(callback);
          this.listeners.set(name, list);
          return this;
        }
        un(name, callback) {
          this.listeners.set(name, (this.listeners.get(name) || []).filter((item) => item !== callback));
        }
        emit(name, ...args) { (this.listeners.get(name) || []).slice().forEach((callback) => callback(...args)); }
      }
      class FakeRegion {
        constructor(plugin, options) { this.plugin = plugin; Object.assign(this, options); }
        remove() { this.plugin.regions = this.plugin.regions.filter((region) => region !== this); }
        play() {}
      }
      class FakeRegions extends Emitter {
        constructor() { super(); this.regions = []; }
        addRegion(options) { const region = new FakeRegion(this, options); this.regions.push(region); return region; }
        getRegions() { return this.regions; }
        clearRegions() { this.regions = []; }
      }
      window.__manualSave = null;
      window.WaveSurfer = {
        Regions: { create: () => new FakeRegions() },
        create: () => {
          const wavesurfer = new Emitter();
          wavesurfer.duration = 1;
          wavesurfer.currentTime = 0;
          wavesurfer.getDuration = () => wavesurfer.duration;
          wavesurfer.getCurrentTime = () => wavesurfer.currentTime;
          wavesurfer.registerPlugin = (plugin) => plugin;
          wavesurfer.load = async () => { wavesurfer.emit('ready'); };
          wavesurfer.setPlaybackRate = () => {};
          wavesurfer.play = () => {};
          wavesurfer.pause = () => {};
          wavesurfer.stop = () => {};
          wavesurfer.setTime = (time) => { wavesurfer.currentTime = time; };
          wavesurfer.destroy = () => {};
          return wavesurfer;
        }
      };
    });

    await page.goto(`${origin}/manual-review-harness`, { waitUntil: 'networkidle' });
    const result = await page.evaluate(async () => {
      const verifier = new window.SyllableVerifier('syllable-verifier-container', {
        onManualSave: async (segments) => {
          window.__manualSave = segments;
          return { sampleId: 'photograph-manual-review-test' };
        }
      });
      const initialHint = document.querySelector('#sv-info p')?.textContent || '';
      await verifier.loadAudio(new Blob(['wav']), [
        { startTime: 0, endTime: 0.25, duration: 0.25 },
        { startTime: 0.25, endTime: 0.5, duration: 0.25 }
      ], ['pho', 'to'], ['foʊ', 'tə']);
      const loadedHint = document.querySelector('#sv-info .sv-hint')?.textContent || '';
      const waveform = document.getElementById('sv-waveform');
      waveform.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 80, right: 1000, bottom: 80 });
      let syllablePlaybackCalls = 0;
      verifier.playSyllable = () => { syllablePlaybackCalls += 1; };
      document.querySelector('.sv-syllable-label')?.click();
      const automaticRegion = verifier.regions.getRegions().find((region) => region.id === 'syllable-0');
      verifier.regions.emit('region-clicked', automaticRegion, { stopPropagation() {} });
      const playbackContract = {
        afterLabelClick: syllablePlaybackCalls,
        afterRegionClick: syllablePlaybackCalls
      };
      document.getElementById('sv-manual-review').click();
      const clickAt = (clientX) => waveform.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        clientX,
        clientY: 20
      }));
      // Annotation must name the IPA syllable, not the orthographic chunk, so
      // cluster consonants land on the phonological side of the boundary.
      const firstTargetInstructions = document.getElementById('sv-manual-instructions').textContent;
      clickAt(100);
      const pendingInstructions = document.getElementById('sv-manual-instructions').textContent;
      clickAt(350);
      const endInstructions = document.getElementById('sv-manual-instructions').textContent;
      const saveDisabledBeforeSpeechEnd = document.getElementById('sv-manual-save').disabled;
      clickAt(700);
      document.getElementById('sv-manual-save').click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const cloudResult = {
        firstTargetInstructions,
        pendingInstructions,
        endInstructions,
        saveDisabledBeforeSpeechEnd,
        count: document.getElementById('sv-manual-count').textContent,
        instructions: document.getElementById('sv-manual-instructions').textContent,
        status: document.getElementById('sv-manual-status').textContent,
        saveText: document.getElementById('sv-manual-save').textContent,
        saveDisabled: document.getElementById('sv-manual-save').disabled,
        save: window.__manualSave,
        hasAbButton: !!document.querySelector('.sv-btn-compare'),
        manualRegions: verifier.regions.getRegions().filter((region) => region.id.startsWith('manual-syllable-')).map((region) => ({
          start: region.start,
          end: region.end
        }))
      };
      verifier.options.onManualSave = async () => ({
        sampleId: 'photograph-manual-review-local-test',
        destination: 'local'
      });
      verifier.clearManualSegments();
      clickAt(100);
      clickAt(300);
      clickAt(700);
      document.getElementById('sv-manual-save').click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      return {
        initialHint,
        loadedHint,
        playbackContract,
        cloudResult,
        localStatus: document.getElementById('sv-manual-status').textContent
      };
    });

    if (process.env.PRONOUNCE_MANUAL_REVIEW_SCREENSHOT) {
      await page.screenshot({
        path: process.env.PRONOUNCE_MANUAL_REVIEW_SCREENSHOT,
        fullPage: true
      });
    }

    assert.equal(result.initialHint, 'Use the numbered syllable labels below the waveform to hear them individually.');
    assert.equal(result.loadedHint, '💡 Use a numbered label to hear that syllable');
    assert.deepEqual(result.playbackContract, { afterLabelClick: 1, afterRegionClick: 1 });
    assert.equal(result.cloudResult.count, '2 of 2 segments');
    assert.equal(
      result.cloudResult.firstTargetInstructions,
      'Click the start of the spoken word.'
    );
    assert.equal(
      result.cloudResult.pendingInstructions,
      'Click shared syllable boundary 1 of 1 between /foʊ/ and /tə/.'
    );
    assert.equal(result.cloudResult.endInstructions, 'Click the end of the spoken word.');
    assert.equal(result.cloudResult.saveDisabledBeforeSpeechEnd, true);
    assert.equal(
      result.cloudResult.instructions,
      'All contiguous syllable boundaries are marked. Review them, then save.'
    );
    assert.match(result.cloudResult.status, /^Saved to cloud: photograph-manual-review-test$/);
    assert.equal(result.cloudResult.saveText, 'Saved');
    assert.equal(result.cloudResult.saveDisabled, true);
    assert.equal(result.cloudResult.hasAbButton, false);
    assert.deepEqual(result.cloudResult.manualRegions, [
      { start: 0.1, end: 0.35 },
      { start: 0.35, end: 0.7 }
    ]);
    assert.match(result.localStatus, /^Saved locally for review: photograph-manual-review-local-test$/);
    assert.deepEqual(result.cloudResult.save.map(({ index, startTime, endTime, duration }) => ({
      index,
      startTime: Number(startTime.toFixed(3)),
      endTime: Number(endTime.toFixed(3)),
      duration: Number(duration.toFixed(3))
    })), [
      { index: 0, startTime: 0.1, endTime: 0.35, duration: 0.25 },
      { index: 1, startTime: 0.35, endTime: 0.7, duration: 0.35 }
    ]);
  } finally {
    await browser.close();
    server.close();
  }
}

run()
  .then(() => process.stdout.write('pronounce-mode manual review browser check passed\n'))
  .catch((error) => {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
  });
