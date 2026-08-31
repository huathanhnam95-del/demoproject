/* eslint-disable no-console */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PUBLIC_DIR = path.join(process.cwd(), 'public');
const BASE_ORIGIN = 'https://betterenglishlearning.test';

function makeWavBuffer() {
  const dataSize = 32000;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + dataSize, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(16000, 24); buffer.writeUInt32LE(32000, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

async function captureStudyShot(page, name) {
  const dir = path.join(process.cwd(), 'tmp');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `crm-segmentation-study-${name}.png`);
  await page.locator('#segmentation-study-workspace').screenshot({ path: file });
  console.log(`Screenshot saved to tmp\\crm-segmentation-study-${name}.png`);
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js') return 'application/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.json') return 'application/json';
  return 'application/octet-stream';
}

function serveLocalAsset(route, url) {
  const pathname = decodeURIComponent(url.pathname);
  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
  const localPath = path.join(PUBLIC_DIR, relativePath);
  if (!fs.existsSync(localPath) || !fs.statSync(localPath).isFile()) {
    return route.fulfill({ status: pathname === '/favicon.ico' ? 204 : 404, body: '' });
  }
  return route.fulfill({ status: 200, contentType: contentTypeFor(localPath), body: fs.readFileSync(localPath) });
}

function firebaseStub() {
  return `(function(){const user={uid:'admin-1',email:'admin@example.com',displayName:'Admin',getIdToken:async()=> 'browser-test-token'};window.firebase={apps:[],initializeApp(c){this.apps.push(c);return this;},auth(){return{currentUser:user,onAuthStateChanged(cb){setTimeout(()=>cb(user),0);return()=>{};}}},firestore(){return{collection(){return{doc(){return{get:async()=>({exists:false,data:()=>null}),set:async()=>{}}}}}}}};})();`;
}

function waveSurferStub() {
  return `(function(){
    // Mirrors wavesurfer.js 7.12.6 dist/plugins/regions.js: region events are
    // emitted by the PLUGIN (not the wavesurfer instance) and are named
    // 'region-update' (live, during a drag) and 'region-updated' (on drag end).
    // There is no 'region-update-end'. addRegion() emits 'region-created'
    // synchronously via saveRegion(), and getRegions() returns the live array.
    class Regions {
      constructor(){this.items=[];this.isRegionsPlugin=true;this.handlers={};this.dragSelectionThreshold=null;}
      addRegion(item){const self=this;const region=Object.assign({},item,{remove(){const i=self.items.indexOf(region);if(i>=0)self.items.splice(i,1);self.emit('region-removed',region);},setOptions(options){Object.assign(region,options);}});this.items.push(region);this.emit('region-created',region);return region;}
      clearRegions(){this.items=[];}
      getRegions(){return this.items;}
      enableDragSelection(options,threshold){this.dragSelectionOptions=options;this.dragSelectionThreshold=threshold;return()=>{this.dragSelectionThreshold=null;};}
      on(event,cb){(this.handlers[event] ||= []).push(cb);return()=>{};}
      emit(event,...payload){this.handlers[event]?.forEach((cb)=>cb(...payload));}
    }
    class Spectrogram { constructor(options){this.container=options?.container;this.isSpectrogramPlugin=true;} render(){const canvas=document.createElement('canvas');canvas.width=Math.max(640,this.container?.clientWidth||640);canvas.height=128;canvas.style.width='100%';canvas.style.height='128px';this.container?.appendChild(canvas);} }
    class FakeWave { constructor(options){this.options=options;this.handlers={};this.duration=0;const c=typeof options.container==='string'?document.querySelector(options.container):options.container;this.container=c;c?.addEventListener('click',(event)=>{const rect=c.getBoundingClientRect();const t=rect.width?Math.max(0.02,Math.min(0.98,(event.clientX-rect.left)/rect.width)):0.2;this.handlers.interaction?.forEach((cb)=>cb(t));});}
      static create(options){return new FakeWave(options);} registerPlugin(plugin){if(plugin?.isRegionsPlugin)this.__regionPlugin=plugin;if(plugin?.isSpectrogramPlugin)this.__spectrogramPlugin=plugin;return plugin;} on(event,cb){(this.handlers[event] ||= []).push(cb);return()=>{};}
      emit(event,payload){this.handlers[event]?.forEach((cb)=>cb(payload));}
      async load(url){
        (window.__studyWaveSurferLegacyLoads ||= []).push(url);
        try { await fetch(url); } catch (error) { this.emit('error', error); throw error; }
        const error = new Error('Legacy URL loading should not be used under the page CSP.');
        this.emit('error', error);
        throw error;
      }
      async loadBlob(blob){
        (window.__studyWaveSurferBlobLoads ||= []).push(blob);
        if (!(blob instanceof Blob)) throw new TypeError('WaveSurfer.loadBlob requires a Blob.');
        await blob.arrayBuffer();
        if (window.__studyWaveformFailNext) {
          window.__studyWaveformFailNext = false;
          const error = new Error('fixture visualization failure');
          this.emit('error', error);
          throw error;
        }
        this.duration = 1;
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(640, this.container?.clientWidth || 640);
        canvas.height = 96;
        canvas.style.width = '100%';
        canvas.style.height = '96px';
        this.container?.appendChild(canvas);
        this.__spectrogramPlugin?.render?.();
        this.emit('ready');
      }
      getDuration(){return this.duration;} destroy(){} }
    window.WaveSurfer={create:(options)=>{const wave=new FakeWave(options);window.__lastStudyWave=wave;return wave;},RegionsPlugin:{create:()=>new Regions()},TimelinePlugin:{create:()=>({})},SpectrogramPlugin:{create:(options)=>new Spectrogram(options)}};
  })();`;
}

async function main() {
  const requests = [];
  const pageErrors = [];
  const consoleErrors = [];
  const browser = await chromium.launch({
    headless: true,
    channel: 'chrome',
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
  });
  try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1200 }, permissions: ['microphone'] });
    await context.addInitScript(() => { window.__CRM_BROWSER_TEST__ = true; });
    await context.addInitScript(() => {
      const originalGetUserMedia = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
      if (!originalGetUserMedia) return;
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        window.__studyCaptureConstraints = constraints;
        const stream = await originalGetUserMedia(constraints);
        stream.getTracks().forEach((track) => {
          const originalGetSettings = track.getSettings?.bind(track);
          track.getSettings = () => ({ ...(originalGetSettings ? originalGetSettings() : {}), echoCancellation: false, noiseSuppression: false, autoGainControl: false, deviceId: 'browser-device-id', groupId: 'browser-group-id' });
        });
        return stream;
      };
    });
    let completed = false;
    let analysisAttempts = 0;
    let submittedMetadata = null;
    let submittedManualReview = null;
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      const method = route.request().method();
      if (url.hostname === 'betterenglishlearning.test') {
        if (url.pathname.startsWith('/api/')) {
          requests.push({ method, path: url.pathname, query: url.search });
          const json = (payload, status = 200) => route.fulfill({ status, contentType: 'application/json; charset=utf-8', body: JSON.stringify({ success: true, ...payload }) });
          if (url.pathname === '/api/config') return json({ config: { apiKey: 'mock', authDomain: 'mock', projectId: 'mock', storageBucket: 'mock', messagingSenderId: 'mock', appId: 'mock' } });
          if (url.pathname === '/api/admin/status') return json({ isAdmin: true, uid: 'admin-1', email: 'admin@example.com', bootstrapped: true });
          if (url.pathname === '/api/admin/dev/segmentation-study/v2' && method === 'GET') {
            return json({ data: {
              studyVersion: 'study-v2', studyId: 'segmentation-study-v2', manifestVersion: '2.0.0', manifestSha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', dialect: 'en-US',
              manifest: [{ taskId: 'segmentation-study-v2-0001', targetWord: 'photograph', referenceIpa: '/ˈfoʊtəˌgræf/', referenceSyllableIpa: ['foʊ', 'tə', 'græf'], targetSyllableCount: 3, dialect: 'en-US', referenceLabelProvenance: 'explicit-reviewed-en-US-v1' }],
              tasks: [{ taskId: 'segmentation-study-v2-0001', targetWord: 'photograph', referenceIpa: '/ˈfoʊtəˌgræf/', referenceSyllableIpa: ['foʊ', 'tə', 'græf'], targetSyllableCount: 3, status: completed ? 'completed' : 'available', dialect: 'en-US', referenceLabelProvenance: 'explicit-reviewed-en-US-v1' }],
              progress: { available: completed ? 0 : 1, reserved: 0, completed: completed ? 1 : 0, uncertain: 0, failed: 0 },
              previousSamples: [{ taskId: 'segmentation-study-v2-previous-0001', targetWord: 'previous', referenceIpa: '/ˈpriː.vi.əs/', referenceSyllableIpa: ['priː', 'vi', 'əs'], targetSyllableCount: 3, status: 'completed', manualSegments: [{ startTime: 0.08, endTime: 0.3 }, { startTime: 0.3, endTime: 0.62 }, { startTime: 0.62, endTime: 0.95 }] }]
            }});
          }
          if (url.pathname.endsWith('/claim-next') && method === 'POST') return json({ task: { taskId: 'segmentation-study-v2-0001', targetWord: 'photograph', referenceIpa: '/ˈfoʊtəˌgræf/', referenceSyllableIpa: ['foʊ', 'tə', 'græf'], targetSyllableCount: 3, status: 'reserved', dialect: 'en-US', referenceLabelProvenance: 'explicit-reviewed-en-US-v1', manifestVersion: '2.0.0', manifestSha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', automaticOrder: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', automaticVersionOrder: ['v3', 'v2', 'v4'], exposureLog: [] } });
          if (/\/segmentation-study\/study-v2\/tasks\/segmentation-study-v2-0001\/(heartbeat|release)$/.test(url.pathname)) return json({ ok: true });
          if (url.pathname.endsWith('/tasks/segmentation-study-v2-0001/complete') && method === 'POST') {
            const postData = route.request().postData() || '';
            const metadataStart = postData.indexOf('name="metadata"\r\n\r\n');
            if (metadataStart >= 0) {
              const jsonStart = metadataStart + 'name="metadata"\r\n\r\n'.length;
              const jsonEnd = postData.indexOf('\r\n--', jsonStart);
              submittedMetadata = JSON.parse(postData.slice(jsonStart, jsonEnd >= 0 ? jsonEnd : undefined));
            }
            completed = true;
            return json({ taskId: 'segmentation-study-v2-0001', status: 'completed' });
          }
          if (/^\/api\/admin\/dev\/corpus-samples\/[^/]+\/audio$/.test(url.pathname)) return route.fulfill({ status: 200, contentType: 'audio/wav', body: makeWavBuffer() });
          if (/^\/api\/admin\/dev\/corpus-samples\/[^/]+\/manual-reviews$/.test(url.pathname) && method === 'POST') {
            try { submittedManualReview = JSON.parse(route.request().postData() || '{}'); } catch (_) { submittedManualReview = null; }
            return json({ reviewId: 'review-browser-test' });
          }
          return json({});
        }
        return serveLocalAsset(route, url);
      }
      if (url.hostname === 'www.gstatic.com' && /firebasejs/.test(url.pathname)) return route.fulfill({ status: 200, contentType: 'application/javascript', body: firebaseStub() });
      if (url.hostname === 'unpkg.com' && url.pathname.includes('wavesurfer.js@7') && !url.pathname.includes('/dist/plugins/')) return route.fulfill({ status: 200, contentType: 'application/javascript', body: waveSurferStub() });
      if (url.hostname === 'unpkg.com' && url.pathname.includes('/dist/plugins/')) return route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
      if (url.hostname.includes('praat-api-') && url.pathname === '/analyze/compare') {
        analysisAttempts += 1;
        if (analysisAttempts === 1) {
          return route.fulfill({ status: 503, contentType: 'application/json; charset=utf-8', body: JSON.stringify({ error: 'temporary analysis failure' }) });
        }
        return jsonComparison(route, analysisAttempts === 3);
      }
      return route.fulfill({ status: 204, body: '' });
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    await page.goto(`${BASE_ORIGIN}/crm-admin.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#nav-pronunciation-samples-container', { state: 'attached' });
    await page.waitForFunction(() => {
      const el = document.getElementById('nav-pronunciation-samples-container');
      return el && el.style.display !== 'none';
    });
    if (await page.locator('.crm-nav-more-dropdown').count() > 0) {
      await page.hover('.crm-nav-more-dropdown');
    }
    await page.click('#nav-pronunciation-samples-container button');
    if (await page.locator('#pv-tab-study').count() > 0) {
      await page.click('#pv-tab-study');
    }
    await page.waitForSelector('#segmentation-study-workspace', { state: 'visible' });
    assert.strictEqual(await page.locator('#segmentation-study-time-ruler').count(), 1, 'The shared timeline must include a WaveSurfer Timeline plugin container.');
    const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
    assert.match(csp || '', /connect-src[^;]*'self'/, 'The browser fixture must retain the CRM page CSP connect-src policy.');
    assert.doesNotMatch(csp || '', /connect-src[^;]*\bblob:/, 'The CRM page CSP must exclude blob: from connect-src.');
    const legacyBlobFetchBlocked = await page.evaluate(async () => {
      const url = URL.createObjectURL(new Blob(['legacy-fetch'], { type: 'audio/wav' }));
      try { await fetch(url); return false; } catch (_) { return true; } finally { URL.revokeObjectURL(url); }
    });
    assert.strictEqual(legacyBlobFetchBlocked, true, 'The page CSP must block legacy fetch(blob:) loading.');
    await page.fill('#segmentation-study-operator', 'Team reviewer');
    await page.click('#segmentation-study-claim');
    try {
      await page.waitForFunction(() => document.querySelector('#segmentation-study-word')?.textContent === 'photograph', null, { timeout: 5000 });
    } catch (error) {
      console.log('DEBUG study state', await page.evaluate(() => ({
        word: document.querySelector('#segmentation-study-word')?.textContent,
        status: document.querySelector('#segmentation-study-status')?.textContent,
        active: document.querySelector('.segmentation-study-tab.is-active')?.dataset.studyVersion,
        focused: document.activeElement?.id,
        keyEvents: window.__studyKeyEvents,
        operator: document.querySelector('#segmentation-study-operator')?.value,
        body: document.querySelector('#segmentation-study-workspace')?.innerText,
        requests: window.__studyRequests || null
      })));
      console.log('DEBUG requests', requests);
      console.log('DEBUG pageErrors', pageErrors, consoleErrors);
      throw error;
    }
    assert.deepStrictEqual(await page.locator('.segmentation-study-tab').evaluateAll((tabs) => tabs.map((tab) => tab.dataset.studyVersion)), ['v3', 'v2', 'v4', 'manual', 'compare'], 'Automatic tabs must follow the server-provided deterministic order, with Compare all last.');
    assert.strictEqual(await page.locator('.segmentation-study-tab.is-active').getAttribute('data-study-version'), 'v3', 'The initial automatic view must be the first server-provided version.');
    assert.strictEqual(await page.locator('#segmentation-study-tab-compare').isHidden(), true, 'Compare all must stay locked before any ordered exposure.');
    assert.strictEqual(await page.locator('#segmentation-study-playback-speed option[value="0.25"]').count(), 1, 'Slower playback rates must be available for close boundary work.');
    assert.strictEqual(await page.locator('#segmentation-study-checklist .segmentation-study-check').count(), 9, 'The save checklist must surface every save requirement.');
    await page.evaluate(() => { window.__studyWaveformFailNext = true; });
    await page.click('#segmentation-study-record');
    await page.waitForTimeout(500);
    assert.deepStrictEqual(await page.evaluate(() => window.__studyCaptureConstraints.audio), { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, 'Raw microphone capture must disable browser processing.');
    await page.click('#segmentation-study-stop');
    await page.waitForFunction(() => /verified|blocked/i.test(document.querySelector('#segmentation-study-capture-status')?.textContent || ''), null, { timeout: 5000 });
    await page.waitForFunction(() => /waveform/i.test(document.querySelector('#segmentation-study-status')?.textContent || ''), null, { timeout: 5000 });
    assert.match(await page.locator('#segmentation-study-status').textContent(), /waveform unavailable/i, 'Waveform failure must provide a retryable unavailable status.');
    assert.ok(await page.locator('#segmentation-study-audio').getAttribute('src'), 'Waveform failure must preserve the native audio object URL.');
    assert.strictEqual(await page.locator('#segmentation-study-timeline-empty').isHidden(), false, 'The empty state must remain visible when visualization is unavailable.');
    assert.strictEqual(await page.locator('#segmentation-study-save').isDisabled(), true, 'Save must remain disabled before waveform readiness.');
    assert.strictEqual(await page.evaluate(() => (window.__studyWaveSurferLegacyLoads || []).length), 0, 'WaveSurfer must not use legacy URL loading.');
    assert.ok(await page.evaluate(() => (window.__studyWaveSurferBlobLoads || []).length === 1 && window.__studyWaveSurferBlobLoads[0] instanceof Blob && window.__studyWaveSurferBlobLoads[0].size > 0), 'WaveSurfer.loadBlob must receive the recorded Blob.');
    await page.waitForFunction(() => !document.querySelector('#segmentation-study-analyze')?.disabled, null, { timeout: 30000 });
    await page.click('#segmentation-study-analyze');
    await page.waitForFunction(() => /failed/i.test(document.querySelector('#segmentation-study-analysis-status')?.textContent || ''), null, { timeout: 30000 });
    assert.ok(await page.locator('#segmentation-study-audio').getAttribute('src'), 'Analysis failure must preserve the recorded WAV for retry.');
    assert.strictEqual(await page.locator('#segmentation-study-analyze').isDisabled(), false, 'Analysis failure must permit retry without re-recording.');
    await page.click('#segmentation-study-analyze');
    await page.waitForFunction(() => /loaded/i.test(document.querySelector('#segmentation-study-analysis-status')?.textContent || ''), null, { timeout: 30000 });
    assert.match(await page.locator('#segmentation-study-status').textContent(), /audio and analysis are retained.*re-record/i, 'Visualization failure must retain textual analysis with a retry/re-record status.');
    assert.match(await page.locator('#segmentation-study-panel-v2').textContent(), /pronunciation-analysis-v2/, 'Textual V2 analysis must remain available when visualization fails.');
    assert.strictEqual(await page.locator('#segmentation-study-save').isDisabled(), true, 'Save must remain disabled while waveform visualization is unavailable.');
    await page.click('[data-study-version="manual"]');
    await page.check('#segmentation-study-manual-certainty');
    assert.strictEqual(await page.locator('input[name="segmentation-study-certainty"]:checked').count(), 1, 'Recording A must allow a certainty choice before replacement.');
    await page.check('#segmentation-study-playback-confirmed');
    assert.strictEqual(await page.locator('#segmentation-study-playback-confirmed').isChecked(), true);
    await page.click('#segmentation-study-record');
    await page.waitForFunction(() => /Recording/i.test(document.querySelector('#segmentation-study-record-status')?.textContent || ''), null, { timeout: 5000 });
    assert.strictEqual(await page.locator('#segmentation-study-playback-confirmed').isChecked(), false, 'A direct replacement recording must require fresh playback confirmation.');
    assert.strictEqual(await page.locator('input[name="segmentation-study-certainty"]:checked').count(), 0, 'A direct replacement recording must clear certainty from recording A.');
    assert.strictEqual(await page.locator('#segmentation-study-audio').getAttribute('src'), null, 'A direct replacement recording must clear the prior native audio URL.');
    assert.strictEqual(await page.locator('#segmentation-study-audio').isHidden(), true, 'A direct replacement recording must hide the prior native audio player.');
    await page.click('#segmentation-study-stop');
    await page.waitForFunction(() => {
      const wave = window.__lastStudyWave;
      const waveformCanvas = document.querySelector('#segmentation-study-waveform canvas');
      const spectrogramCanvas = document.querySelector('#segmentation-study-spectrogram canvas');
      return Number(wave?.getDuration?.()) > 0
        && Number(waveformCanvas?.width) > 0 && Number(waveformCanvas?.height) > 0
        && Number(spectrogramCanvas?.width) > 0 && Number(spectrogramCanvas?.height) > 0;
    }, null, { timeout: 5000 });
    const waveformDimensions = await page.evaluate(() => {
      const wave = window.__lastStudyWave;
      const waveformCanvas = document.querySelector('#segmentation-study-waveform canvas');
      const spectrogramCanvas = document.querySelector('#segmentation-study-spectrogram canvas');
      const waveformRect = waveformCanvas?.getBoundingClientRect();
      const spectrogramRect = spectrogramCanvas?.getBoundingClientRect();
      return {
        duration: wave?.getDuration?.() || 0,
        waveform: { width: waveformCanvas?.width || 0, height: waveformCanvas?.height || 0, renderedWidth: waveformRect?.width || 0, renderedHeight: waveformRect?.height || 0 },
        spectrogram: { width: spectrogramCanvas?.width || 0, height: spectrogramCanvas?.height || 0, renderedWidth: spectrogramRect?.width || 0, renderedHeight: spectrogramRect?.height || 0 }
      };
    });
    assert.ok(waveformDimensions.duration > 0, 'Ready waveform must expose a positive duration.');
    assert.ok(waveformDimensions.waveform.width > 0 && waveformDimensions.waveform.height > 0 && waveformDimensions.waveform.renderedWidth > 0 && waveformDimensions.waveform.renderedHeight > 0, 'Ready waveform canvas must have positive intrinsic and rendered dimensions.');
    assert.ok(waveformDimensions.spectrogram.width > 0 && waveformDimensions.spectrogram.height > 0 && waveformDimensions.spectrogram.renderedWidth > 0 && waveformDimensions.spectrogram.renderedHeight > 0, 'Ready spectrogram canvas must have positive intrinsic and rendered dimensions.');
    assert.strictEqual(await page.locator('#segmentation-study-timeline-empty').isHidden(), true, 'The empty state must be hidden after a real waveform ready event.');
    assert.strictEqual(await page.evaluate(() => (window.__studyWaveSurferLegacyLoads || []).length), 0, 'The production path must never call legacy WaveSurfer.load(url).');
    assert.ok(await page.evaluate(() => (window.__studyWaveSurferBlobLoads || []).length === 2 && window.__studyWaveSurferBlobLoads.every((blob) => blob instanceof Blob && blob.size > 0)), 'Each recording must pass its original Blob to WaveSurfer.loadBlob.');
    await page.waitForFunction(() => !document.querySelector('#segmentation-study-analyze')?.disabled, null, { timeout: 30000 });
    await page.click('#segmentation-study-analyze');
    await page.waitForFunction(() => /failed/i.test(document.querySelector('#segmentation-study-analysis-status')?.textContent || ''), null, { timeout: 30000 });
    assert.strictEqual(await page.locator('#segmentation-study-save').isDisabled(), true, 'A direct V4 mismatch must keep Save disabled.');
    await page.click('#segmentation-study-analyze');
    await page.waitForFunction(() => /loaded/i.test(document.querySelector('#segmentation-study-analysis-status')?.textContent || ''), null, { timeout: 30000 });
    assert.match(await page.locator('#segmentation-study-panel-v4').textContent(), /pronunciation-partition-variants-v2/, 'V4 must visibly identify the authoritative partition schema.');
    assert.match(await page.locator('#segmentation-study-panel-v4').textContent(), /partitionVariants\.v4/, 'V4 must visibly identify its authoritative provenance source.');
    assert.ok(await page.locator('.segmentation-study-lane-track.is-locked').count() >= 2, 'Automatic versions the reviewer has not reached yet must stay behind the blind exposure lock.');
    assert.strictEqual(await page.locator('#segmentation-study-tab-compare').isHidden(), true, 'Compare all must stay locked until every automatic version has been viewed in order.');
    await page.check('#segmentation-study-playback-confirmed');
    await page.click('[data-study-version="v3"]');
    await page.click('[data-study-version="v2"]');
    assert.strictEqual(await page.locator('#segmentation-study-save').isDisabled(), true, 'Save must remain disabled until the final automatic exposure.');
    assert.match(await page.locator('#segmentation-study-status').textContent(), /Next required automatic view: V4\./, 'The UI must identify the final required automatic version.');
    await page.click('[data-study-version="v3"]');
    await page.click('[data-study-version="v4"]');
    assert.match(await page.locator('#segmentation-study-status').textContent(), /All automatic versions viewed/, 'The UI must clear the exposure prerequisite after the final automatic view.');
    assert.ok(await page.locator('#segmentation-study-panel-v2 .segmentation-study-playback button').count() >= 2, 'Whole-word and syllable playback controls should be visible.');

    // V4 is a boundary refinement of V3, so the review has to show which
    // boundaries moved and on what evidence.
    const v4PanelText = await page.locator('#segmentation-study-panel-v4').textContent();
    assert.match(v4PanelText, /V4 moved 2 of 3 boundaries/, 'The V4 panel must summarise how many boundaries the refinement moved.');
    assert.match(v4PanelText, /final extension/, 'The V4 panel must name each correction type applied.');
    assert.strictEqual(await page.locator('#segmentation-study-panel-v4 .segmentation-study-diagnostics tbody tr').count(), 3, 'Every V4 diagnostic must be listed.');

    await captureStudyShot(page, 'ordered-exposure');

    // The blind ordering evidence is now complete, so the combined view unlocks.
    assert.strictEqual(await page.locator('#segmentation-study-tab-compare').isHidden(), false, 'Compare all must unlock once the ordered exposure is complete.');
    assert.strictEqual(await page.locator('.segmentation-study-lane-track.is-locked').count(), 0, 'Every lane must unlock once the ordered exposure evidence is complete.');
    assert.deepStrictEqual(await page.locator('.segmentation-study-lane').evaluateAll((lanes) => lanes.map((lane) => lane.dataset.version)), ['v2', 'v3', 'v4', 'manual'], 'The lane strip must place all four segmentations on one shared time axis.');
    await page.click('[data-study-version="compare"]');
    assert.strictEqual(await page.locator('.segmentation-study-tab.is-active').getAttribute('data-study-version'), 'compare');
    assert.strictEqual(await page.locator('#segmentation-study-panel-compare .segmentation-study-legend-item').count(), 4, 'Compare all must legend every version it draws.');
    await captureStudyShot(page, 'compare-all');

    // Narrow viewport: the lane strip drops its note column and the timeline
    // must follow, or the two stop sharing a time axis.
    await page.setViewportSize({ width: 860, height: 1200 });
    await page.waitForTimeout(300);
    const narrowAlignment = await page.evaluate(() => {
      const track = document.querySelector('.segmentation-study-lane-track');
      const waveform = document.querySelector('#segmentation-study-waveform');
      if (!track || !waveform) return null;
      const laneBox = track.getBoundingClientRect();
      const waveBox = waveform.getBoundingClientRect();
      return {
        leftDelta: Math.abs(laneBox.left - waveBox.left),
        widthDelta: Math.abs(laneBox.width - waveBox.width),
        bodyOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
      };
    });
    assert.ok(narrowAlignment, 'The lane strip and waveform must both be present at a narrow viewport.');
    assert.ok(narrowAlignment.leftDelta <= 1 && narrowAlignment.widthDelta <= 1, `Lane tracks must share the waveform time axis at narrow widths (left off by ${narrowAlignment.leftDelta}px, width off by ${narrowAlignment.widthDelta}px).`);
    assert.ok(narrowAlignment.bodyOverflow <= 0, `The study workspace must not force horizontal page scrolling (overflow ${narrowAlignment.bodyOverflow}px).`);
    await captureStudyShot(page, 'narrow-860');
    await page.setViewportSize({ width: 1600, height: 1200 });
    await page.waitForTimeout(300);

    // A–B listening selection: a stray micro-drag is not a selection.
    const abSelection = await page.evaluate(() => {
      const plugin = window.__lastStudyWave?.__regionPlugin;
      if (!plugin) return null;
      // addRegion emits 'region-created' itself, exactly as the real plugin's
      // saveRegion() does at the end of a drag-selection gesture.
      const tiny = plugin.addRegion({ id: 'drag-tiny', start: 0.1, end: 0.105 });
      const tinyKept = plugin.getRegions().includes(tiny);
      const real = plugin.addRegion({ id: 'drag-real', start: 0.2, end: 0.55 });
      return {
        tinyKept,
        realKept: plugin.getRegions().includes(real),
        readout: document.querySelector('#segmentation-study-ab-readout')?.textContent || '',
        playLabel: document.querySelector('#segmentation-study-play')?.textContent || '',
        clearDisabled: document.querySelector('#segmentation-study-ab-clear')?.disabled
      };
    });
    assert.ok(abSelection, 'The regions plugin must be reachable for the A–B selection check.');
    assert.strictEqual(abSelection.tinyKept, false, 'A sub-20 ms drag must be discarded instead of becoming an A–B selection.');
    assert.strictEqual(abSelection.realKept, true, 'A deliberate drag must be kept as the A–B selection.');
    assert.match(abSelection.readout, /0\.200 → 0\.550 s \(350 ms\)/, 'The transport must publish the A–B slice bounds and length.');
    assert.match(abSelection.playLabel, /Play A–B/, 'Play must target the A–B slice once one is selected.');
    assert.strictEqual(abSelection.clearDisabled, false, 'Clear A–B must enable once a slice is selected.');
    await captureStudyShot(page, 'ab-selection');

    const loopState = await page.evaluate(() => {
      const button = document.querySelector('#segmentation-study-loop');
      button.click();
      const on = { pressed: button.getAttribute('aria-pressed'), active: button.classList.contains('is-active') };
      button.click();
      return { on, offPressed: button.getAttribute('aria-pressed') };
    });
    assert.strictEqual(loopState.on.pressed, 'true', 'The loop toggle must expose its state to assistive technology.');
    assert.strictEqual(loopState.on.active, true, 'The loop toggle must show an active state.');
    assert.strictEqual(loopState.offPressed, 'false', 'The loop toggle must switch back off.');

    // Shrinking the slice below the minimum on drag end must drop it, rather
    // than leaving the readout describing a slice no longer on the waveform.
    const abShrunk = await page.evaluate(() => {
      const plugin = window.__lastStudyWave?.__regionPlugin;
      const region = plugin.getRegions().find((item) => item.id === 'drag-real');
      region.end = region.start + 0.004;
      plugin.emit('region-update', region);
      const midDrag = document.querySelector('#segmentation-study-ab-readout')?.textContent || '';
      plugin.emit('region-updated', region);
      return { midDrag, afterDrag: document.querySelector('#segmentation-study-ab-readout')?.textContent || '', kept: plugin.getRegions().includes(region) };
    });
    assert.match(abShrunk.midDrag, /0\.200 → 0\.550/, 'A drag passing through a tiny state must keep the previous slice until it ends.');
    assert.match(abShrunk.afterDrag, /drag across the waveform/, 'A slice resized below the minimum must be dropped on drag end.');
    assert.strictEqual(abShrunk.kept, false, 'The discarded A–B region must be removed from the waveform.');
    assert.strictEqual(await page.locator('#segmentation-study-ab-clear').isDisabled(), true, 'Clear A–B must disable once the slice is gone.');

    // Re-select, then clear it through the button.
    await page.evaluate(() => { window.__lastStudyWave.__regionPlugin.addRegion({ id: 'drag-again', start: 0.3, end: 0.62 }); });
    assert.match(await page.locator('#segmentation-study-ab-readout').textContent(), /0\.300 → 0\.620/, 'A fresh drag must replace the discarded slice.');
    await page.click('#segmentation-study-ab-clear');
    assert.match(await page.locator('#segmentation-study-ab-readout').textContent(), /drag across the waveform/, 'Clearing A–B must restore the selection hint.');

    await page.selectOption('#segmentation-study-playback-speed', '0.75');
    for (const tab of ['v2', 'v3', 'v4', 'manual']) await page.click(`[data-study-version="${tab}"]`);
    await page.locator('#segmentation-study-tab-manual').focus();
    await page.keyboard.press('ArrowLeft');
    assert.strictEqual(await page.locator('.segmentation-study-tab.is-active').getAttribute('data-study-version'), 'v4');
    await page.keyboard.press('End');
    assert.strictEqual(await page.locator('.segmentation-study-tab.is-active').getAttribute('data-study-version'), 'compare', 'Compare all is the last tab once unlocked.');
    await page.click('[data-study-version="manual"]');
    assert.strictEqual(await page.locator('.segmentation-study-tab.is-active').getAttribute('data-study-version'), 'manual');
    const waveform = page.locator('#segmentation-study-waveform');
    const box = await waveform.boundingBox();
    assert.ok(box && box.width > 100, 'Aligned waveform should render for the review.');
    for (const ratio of [0.08, 0.35, 0.68, 0.92]) await page.mouse.click(box.x + box.width * ratio, box.y + 40);
    try {
      await page.waitForFunction(() => /3 of 3 segments/.test(document.querySelector('#segmentation-study-manual-count')?.textContent || ''), null, { timeout: 5000 });
    } catch (error) {
      console.log('DEBUG manual state', await page.evaluate(() => ({
        count: document.querySelector('#segmentation-study-manual-count')?.textContent,
        active: document.querySelector('.segmentation-study-tab.is-active')?.dataset.studyVersion,
        waveform: document.querySelector('#segmentation-study-waveform')?.innerText,
        status: document.querySelector('#segmentation-study-status')?.textContent,
        panel: document.querySelector('#segmentation-study-panel-manual')?.innerText
      })));
      throw error;
    }
    assert.strictEqual(await page.locator('input[name="segmentation-study-certainty"]:checked').count(), 0, 'Certainty must require an explicit reviewer choice.');
    assert.strictEqual(await page.locator('#segmentation-study-save').isDisabled(), true, 'Save must remain disabled until certainty is chosen.');
    // WaveSurfer 7 emits region events from the plugin, named 'region-update'
    // (live) and 'region-updated' (drag end). Binding the wrong names silently
    // skips the re-snap that keeps adjacent syllables contiguous.
    assert.deepStrictEqual(
      await page.evaluate(() => Object.keys(window.__lastStudyWave?.handlers || {}).filter((name) => name.startsWith('region-'))),
      [],
      'Region events must be bound to the regions plugin; the wavesurfer instance does not re-emit them in v7.'
    );
    assert.deepStrictEqual(
      await page.evaluate(() => Object.keys(window.__lastStudyWave?.__regionPlugin?.handlers || {}).filter((name) => name.startsWith('region-')).sort()),
      ['region-created', 'region-update', 'region-updated'],
      'The study must bind the region event names WaveSurfer 7 actually emits.'
    );
    assert.strictEqual(await page.evaluate(() => window.__lastStudyWave?.__regionPlugin?.dragSelectionThreshold), 8, 'Drag selection must use a raised threshold so an ordinary boundary click is not swallowed as a drag.');

    const snappedBoundary = await page.evaluate(() => {
      const plugin = window.__lastStudyWave?.__regionPlugin;
      if (!plugin) return null;
      const manualRegions = () => plugin.getRegions().filter((region) => String(region.id || '').startsWith('study-manual-'));
      const before = manualRegions();
      if (before.length < 2) return null;
      const target = before[1];
      target.start = 0.42;
      plugin.emit('region-update', target);
      plugin.emit('region-updated', target);
      const rebuilt = manualRegions();
      return { leftEnd: rebuilt[0]?.end, rightStart: rebuilt[1]?.start };
    });
    assert.ok(snappedBoundary && Math.abs(snappedBoundary.leftEnd - snappedBoundary.rightStart) < 0.000001, 'Dragging either side of a manual boundary must keep adjacent syllables contiguous.');
    await page.check('#segmentation-study-manual-certainty');

    // With a complete manual segmentation the study's own metric — how far each
    // automatic version sits from the reviewer's boundaries — becomes visible
    // while the boundaries can still be corrected.
    assert.strictEqual(await page.locator('#segmentation-study-deltas .segmentation-study-delta-table').count(), 1, 'A complete manual segmentation must surface the manual-vs-automatic deltas.');
    assert.deepStrictEqual(await page.locator('#segmentation-study-deltas thead th').evaluateAll((cells) => cells.map((cell) => cell.textContent)), ['Boundary', 'V2', 'V3', 'V4'], 'The delta table must compare every automatic version against the manual boundaries.');
    assert.strictEqual(await page.locator('#segmentation-study-deltas tfoot td').count(), 3, 'The delta table must report a mean absolute error per version.');
    assert.strictEqual(await page.locator('#segmentation-study-checklist .segmentation-study-check:not(.is-done)').count(), 0, 'Every save requirement must read as met once Save is enabled.');
    assert.strictEqual(await page.locator('#segmentation-study-save').isDisabled(), false, 'Save must enable once every requirement is met.');
    await captureStudyShot(page, 'manual-and-deltas');

    // Nudging a boundary must move the regions already on screen rather than
    // tearing the overlay down and rebuilding it, which re-runs the plugin's
    // deferred label layout and leaks a subscription set per region per press.
    await page.locator('#segmentation-study-timeline').focus();
    const nudgeReuse = await page.evaluate(() => {
      const manual = () => window.__lastStudyWave.__regionPlugin.getRegions().filter((region) => String(region.id || '').startsWith('study-manual-'));
      window.__regionsBeforeNudge = manual();
      // Snapshot the numbers, not the objects: reuse means the objects are the
      // same ones, so reading them afterwards would show the moved value.
      return { count: window.__regionsBeforeNudge.length, bounds: window.__regionsBeforeNudge.map((region) => [region.start, region.end]) };
    });
    await page.locator('#segmentation-study-timeline').press('ArrowLeft');
    const afterNudge = await page.evaluate((before) => {
      const after = window.__lastStudyWave.__regionPlugin.getRegions().filter((region) => String(region.id || '').startsWith('study-manual-'));
      return {
        count: after.length,
        sameObjects: after.length === window.__regionsBeforeNudge.length && after.every((region, index) => region === window.__regionsBeforeNudge[index]),
        moved: after.some((region, index) => region.start !== before.bounds[index][0] || region.end !== before.bounds[index][1])
      };
    }, nudgeReuse);
    assert.strictEqual(afterNudge.count, nudgeReuse.count, 'A nudge must not change how many regions are drawn.');
    assert.strictEqual(afterNudge.sameObjects, true, 'A nudge must reposition the existing regions, not recreate them.');
    assert.strictEqual(afterNudge.moved, true, 'A nudge must actually move a boundary.');

    await page.click('#segmentation-study-manual-undo');
    await page.locator('#segmentation-study-timeline').focus();
    await page.locator('#segmentation-study-timeline').press('ArrowLeft');
    try {
      await page.waitForFunction(() => /Boundary 1 moved/.test(document.querySelector('#segmentation-study-status')?.textContent || ''), null, { timeout: 5000 });
    } catch (error) {
      console.log('DEBUG keyboard state', await page.evaluate(() => ({
        status: document.querySelector('#segmentation-study-status')?.textContent,
        active: document.querySelector('.segmentation-study-tab.is-active')?.dataset.studyVersion,
        focused: document.activeElement?.id,
        timeline: document.querySelector('#segmentation-study-timeline')?.outerHTML.slice(0, 300),
        count: document.querySelector('#segmentation-study-manual-count')?.textContent,
        undoDisabled: document.querySelector('#segmentation-study-manual-undo')?.disabled
      })));
      throw error;
    }
    // Re-measure: scrolling (screenshots, focus moves) invalidates the earlier box.
    const replacedBox = await waveform.boundingBox();
    await page.mouse.click(replacedBox.x + replacedBox.width * 0.92, replacedBox.y + 40);
    await page.waitForFunction(() => /3 of 3 segments/.test(document.querySelector('#segmentation-study-manual-count')?.textContent || ''), null, { timeout: 5000 });
    await page.click('#segmentation-study-save');
    try {
      await page.waitForFunction(() => /saved/i.test(document.querySelector('#segmentation-study-status')?.textContent || ''), null, { timeout: 5000 });
    } catch (error) {
      console.log('DEBUG save state', await page.evaluate(() => ({
        status: document.querySelector('#segmentation-study-status')?.textContent,
        saveDisabled: document.querySelector('#segmentation-study-save')?.disabled,
        count: document.querySelector('#segmentation-study-manual-count')?.textContent,
        certainty: document.querySelector('input[name="segmentation-study-certainty"]:checked')?.value,
        panel: document.querySelector('#segmentation-study-panel-manual')?.innerText
      })));
      console.log('DEBUG requests', requests);
      throw error;
    }
    assert.ok(submittedMetadata, 'Completion must submit parseable metadata in the multipart request.');
    assert.deepStrictEqual(submittedMetadata.automaticVersionOrder, ['v3', 'v2', 'v4']);
    assert.deepStrictEqual(submittedMetadata.versionExposureLog.map((entry) => entry.version), ['v3', 'v2', 'v4']);
    assert.strictEqual(new Set(submittedMetadata.versionExposureLog.map((entry) => entry.version)).size, 3, 'Revisited automatic tabs must not duplicate exposure entries.');
    assert.ok(submittedMetadata.versionExposureLog.every((entry) => entry.automaticOrder === 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' && Number.isFinite(Date.parse(entry.viewedAt))));
    assert.ok(requests.some((item) => item.path.endsWith('/tasks/segmentation-study-v2-0001/complete') && item.method === 'POST'));
    await page.click('#segmentation-study-next');
    assert.strictEqual(await page.locator('input[name="segmentation-study-certainty"]:checked').count(), 0, 'The next task must require a new certainty choice.');
    await page.click('[data-study-mode="previous"]');
    await page.waitForSelector('#segmentation-study-queue [data-task-id="segmentation-study-v2-previous-0001"]', { state: 'visible' });
    await page.click('#segmentation-study-queue [data-task-id="segmentation-study-v2-previous-0001"]');
    await page.waitForFunction(() => document.querySelector('#segmentation-study-word')?.textContent === 'previous' && /^blob:/.test(document.querySelector('#segmentation-study-audio')?.getAttribute('src') || ''), null, { timeout: 30000 });
    await page.waitForFunction(() => /loaded/i.test(document.querySelector('#segmentation-study-analysis-status')?.textContent || ''), null, { timeout: 30000 });
    assert.match(await page.locator('#segmentation-study-audio').getAttribute('src') || '', /^blob:/, 'Previously saved samples must retain a native audio object URL.');
    assert.ok(await page.evaluate(() => (window.__studyWaveSurferBlobLoads || []).length === 3 && window.__studyWaveSurferBlobLoads[2] instanceof Blob && window.__studyWaveSurferBlobLoads[2].size > 0), 'Previously saved sample audio must reach WaveSurfer.loadBlob as a Blob.');
    assert.strictEqual(await page.locator('#segmentation-study-timeline-empty').isHidden(), true, 'Previously saved samples must hide the empty state after waveform and spectrogram readiness.');
    assert.strictEqual(await page.evaluate(() => (window.__studyWaveSurferLegacyLoads || []).length), 0, 'Previously saved samples must not use legacy URL loading.');

    // Opening a stored sample must discard everything from the previous take,
    // including the A-B listening selection.
    assert.match(await page.locator('#segmentation-study-ab-readout').textContent(), /drag across the waveform/, 'Opening a stored sample must clear the previous A–B selection.');

    // A stored sample carries no server-issued automatic order and no capture
    // settings from this session, so its checklist drops the capture row and
    // proves ordered exposure by viewing rather than by token. The corpus
    // manual-review endpoint validates neither, so this review must be savable.
    assert.deepStrictEqual(
      await page.evaluate(() => {
        const item = (window.__studyPreviousSampleProbe = document.querySelector('#segmentation-study-queue [data-task-id="segmentation-study-v2-previous-0001"]'));
        return { hasQueueItem: Boolean(item), captureStatus: document.querySelector('#segmentation-study-capture-status')?.textContent };
      }),
      { hasQueueItem: true, captureStatus: 'Capture settings unavailable.' },
      'A stored sample has no capture settings from this session — which is exactly why the checklist must not demand them.'
    );
    assert.strictEqual(await page.locator('#segmentation-study-checklist .segmentation-study-check').count(), 8, 'A stored sample must not be asked for this session\'s raw capture settings.');
    assert.strictEqual(await page.locator('#segmentation-study-tab-compare').isHidden(), true, 'Compare all must start locked for a stored sample too.');
    for (const version of ['v2', 'v3', 'v4']) await page.click(`[data-study-version="${version}"]`);
    assert.strictEqual(await page.locator('#segmentation-study-tab-compare').isHidden(), false, 'Compare all must unlock for a stored sample once all three versions have been viewed.');
    assert.strictEqual(await page.locator('.segmentation-study-lane-track.is-locked').count(), 0, 'Every lane must unlock for a stored sample once all three versions have been viewed.');

    await page.click('[data-study-version="manual"]');
    await page.check('#segmentation-study-playback-confirmed');
    await page.check('#segmentation-study-manual-certainty');
    assert.strictEqual(await page.locator('#segmentation-study-checklist .segmentation-study-check:not(.is-done)').count(), 0, 'A stored sample with boundaries, playback and certainty must satisfy every requirement.');
    assert.strictEqual(await page.locator('#segmentation-study-save').isDisabled(), false, 'A stored sample review must be savable.');
    await page.click('#segmentation-study-save');
    await page.waitForFunction(() => /saved/i.test(document.querySelector('#segmentation-study-status')?.textContent || ''), null, { timeout: 5000 });
    assert.ok(submittedManualReview, 'A stored sample review must POST to the corpus manual-reviews endpoint.');
    assert.strictEqual(submittedManualReview.manualSegments.length, 3, 'The stored sample review must carry its manual segments.');
    assert.strictEqual(submittedManualReview.certainty, 'certain');
    assert.ok(requests.some((item) => /\/corpus-samples\/segmentation-study-v2-previous-0001\/manual-reviews$/.test(item.path) && item.method === 'POST'));

    assert.strictEqual(pageErrors.length, 0, `Unexpected page errors:\n${pageErrors.join('\n')}`);
    const unexpectedConsoleErrors = consoleErrors.filter((message) => !/503 \(Service Unavailable\)|blob:.*Content Security Policy|Fetch API cannot load blob:/i.test(message));
    assert.strictEqual(unexpectedConsoleErrors.length, 0, `Unexpected console errors:\n${unexpectedConsoleErrors.join('\n')}`);
    console.log('crm segmentation study browser check passed');
  } finally { await browser.close(); }
}

function jsonComparison(route, directMismatch = false) {
  const payload = {
    schemaVersion: 'pronunciation-comparison-v2', status: 'complete', comparisonId: 'comparison-study-v2-1', dialect: 'en-US',
    context: { targetWord: 'photograph', referenceIpa: '/ˈfoʊtəˌgræf/', referenceSyllableIpa: ['foʊ', 'tə', 'græf'], expectedSyllables: 3 },
    v2: { status: 'complete', analysis: { analysisVersion: 'pronunciation-analysis-v2', observed_syllables: [{ startTime: 0.08, endTime: 0.3 }, { startTime: 0.3, endTime: 0.62 }, { startTime: 0.62, endTime: 0.95 }] } },
    v3: { status: 'complete', analysis: { analysisVersion: 'pronunciation-analysis-v3', observed_syllables: [{ startTime: 0.1, endTime: 0.32 }, { startTime: 0.32, endTime: 0.63 }, { startTime: 0.63, endTime: 0.92 }], partitionVariants: { schemaVersion: 'pronunciation-partition-variants-v2', v3: [{ startTime: 0.1, endTime: 0.32 }, { startTime: 0.32, endTime: 0.63 }, { startTime: 0.63, endTime: 0.92 }], v4: [{ startTime: 0.08, endTime: 0.31 }, { startTime: 0.31, endTime: 0.64 }, { startTime: 0.64, endTime: 0.94 }], v4AnalysisVersion: 'pronunciation-analysis-v4', v4Diagnostics: [
      { index: 0, correction_type: 'onset', confidence: 0.18, blend_weight: 1, shift_ms: 20, signed_shift_ms: -20, reason: 'intensity rise', boundary: 'partition_start_time', side: 'start', old: 0.1, new: 0.08, mutation: true },
      { index: 1, correction_type: 'none', confidence: 0.71, blend_weight: 0, shift_ms: 0, signed_shift_ms: 0, reason: 'high confidence', boundary: null, side: null, old: null, new: null, mutation: false },
      { index: 2, correction_type: 'final_extension', confidence: 0.24, blend_weight: 0.9, shift_ms: 20, signed_shift_ms: 20, reason: 'voicing decay', boundary: 'partition_end_time', side: 'end', old: 0.92, new: 0.94, mutation: true }
    ] } } },
    v4: { status: 'complete', analysis: {
      analysisVersion: 'pronunciation-analysis-v4', source: 'partitionVariants.v4', partitionSchemaVersion: 'pronunciation-partition-variants-v2',
      provenance: { source: 'partitionVariants.v4', variant: 'v4', schemaVersion: 'pronunciation-partition-variants-v2' }, observed_syllables: [{ startTime: 0.08, endTime: 0.31 }, { startTime: 0.31, endTime: 0.64 }, { startTime: 0.64, endTime: 0.94 }]
    } }
  };
  if (directMismatch) payload.v4.analysis.observed_syllables = [{ startTime: 0.08, endTime: 0.3 }, { startTime: 0.3, endTime: 0.64 }, { startTime: 0.64, endTime: 0.94 }];
  return route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify(payload) });
}

main().catch((error) => { console.error(error.stack || error.message || String(error)); process.exit(1); });
