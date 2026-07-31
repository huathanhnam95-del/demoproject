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
      await verifier.loadAudio(new Blob(['wav']), [
        { startTime: 0, endTime: 0.25, duration: 0.25 },
        { startTime: 0.25, endTime: 0.5, duration: 0.25 }
      ], ['pho', 'to'], ['foʊ', 'tə']);
      const waveform = document.getElementById('sv-waveform');
      waveform.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 80, right: 1000, bottom: 80 });
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
      clickAt(500);
      clickAt(700);
      document.getElementById('sv-manual-save').click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const cloudResult = {
        firstTargetInstructions,
        pendingInstructions,
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
      document.getElementById('sv-manual-save').click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      return {
        cloudResult,
        localStatus: document.getElementById('sv-manual-status').textContent
      };
    });

    assert.equal(result.cloudResult.count, '2 segments');
    assert.equal(
      result.cloudResult.firstTargetInstructions,
      'Mark syllable 1 of 2: /foʊ/ — click its start, then its end. Use IPA boundaries, not spelling.'
    );
    assert.equal(result.cloudResult.pendingInstructions, 'Now click the end of syllable 1 /foʊ/.');
    // Every syllable is marked, so there is no next IPA target to name.
    assert.equal(
      result.cloudResult.instructions,
      'Click the start and end of each syllable on the waveform. Use IPA boundaries, not spelling.'
    );
    assert.match(result.cloudResult.status, /^Saved to cloud: photograph-manual-review-test$/);
    assert.equal(result.cloudResult.saveText, 'Saved');
    assert.equal(result.cloudResult.saveDisabled, true);
    assert.equal(result.cloudResult.hasAbButton, false);
    assert.deepEqual(result.cloudResult.manualRegions, [
      { start: 0.1, end: 0.35 },
      { start: 0.5, end: 0.7 }
    ]);
    assert.match(result.localStatus, /^Saved locally for review: photograph-manual-review-local-test$/);
    assert.deepEqual(result.cloudResult.save.map(({ index, startTime, endTime, duration }) => ({
      index,
      startTime: Number(startTime.toFixed(3)),
      endTime: Number(endTime.toFixed(3)),
      duration: Number(duration.toFixed(3))
    })), [
      { index: 0, startTime: 0.1, endTime: 0.35, duration: 0.25 },
      { index: 1, startTime: 0.5, endTime: 0.7, duration: 0.2 }
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
