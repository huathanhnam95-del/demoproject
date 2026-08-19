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
    class Regions { constructor(){this.items=[];this.isRegionsPlugin=true;} addRegion(item){this.items.push(item);return item;} clearRegions(){this.items=[];} getRegions(){return this.items;} }
    class FakeWave { constructor(options){this.options=options;this.handlers={};this.duration=1;const c=typeof options.container==='string'?document.querySelector(options.container):options.container;this.container=c;c?.addEventListener('click',(event)=>{const rect=c.getBoundingClientRect();const t=rect.width?Math.max(0.02,Math.min(0.98,(event.clientX-rect.left)/rect.width)):0.2;this.handlers.interaction?.forEach((cb)=>cb(t));});}
      static create(options){return new FakeWave(options);} registerPlugin(plugin){if(plugin?.isRegionsPlugin)this.__regionPlugin=plugin;return plugin;} on(event,cb){(this.handlers[event] ||= []).push(cb);return()=>{};} async load(){await Promise.resolve();this.handlers.ready?.forEach((cb)=>cb());} getDuration(){return this.duration;} destroy(){} }
    window.WaveSurfer={create:(options)=>{const wave=new FakeWave(options);window.__lastStudyWave=wave;return wave;},RegionsPlugin:{create:()=>new Regions()},TimelinePlugin:{create:()=>({})},SpectrogramPlugin:{create:()=>({})}};
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
    let completed = false;
    let analysisAttempts = 0;
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      const method = route.request().method();
      if (url.hostname === 'betterenglishlearning.test') {
        if (url.pathname.startsWith('/api/')) {
          requests.push({ method, path: url.pathname, query: url.search });
          const json = (payload, status = 200) => route.fulfill({ status, contentType: 'application/json; charset=utf-8', body: JSON.stringify({ success: true, ...payload }) });
          if (url.pathname === '/api/config') return json({ config: { apiKey: 'mock', authDomain: 'mock', projectId: 'mock', storageBucket: 'mock', messagingSenderId: 'mock', appId: 'mock' } });
          if (url.pathname === '/api/admin/status') return json({ isAdmin: true, uid: 'admin-1', email: 'admin@example.com', bootstrapped: true });
          if (url.pathname === '/api/admin/dev/segmentation-study/v1' && method === 'GET') {
            return json({ data: {
              manifest: [{ taskId: 'study-v1-0001', targetWord: 'photograph', referenceIpa: '/ˈfoʊtəˌgræf/', referenceSyllableIpa: ['foʊ', 'tə', 'græf'], targetSyllableCount: 3 }],
              tasks: [{ taskId: 'study-v1-0001', targetWord: 'photograph', referenceIpa: '/ˈfoʊtəˌgræf/', referenceSyllableIpa: ['foʊ', 'tə', 'græf'], targetSyllableCount: 3, status: completed ? 'completed' : 'available' }],
              progress: { available: completed ? 0 : 1, reserved: 0, completed: completed ? 1 : 0, uncertain: 0, failed: 0 },
              previousSamples: []
            }});
          }
          if (url.pathname.endsWith('/claim-next') && method === 'POST') return json({ task: { taskId: 'study-v1-0001', targetWord: 'photograph', referenceIpa: '/ˈfoʊtəˌgræf/', referenceSyllableIpa: ['foʊ', 'tə', 'græf'], targetSyllableCount: 3, status: 'reserved' } });
          if (/\/segmentation-study\/study-v1\/tasks\/study-v1-0001\/(heartbeat|release)$/.test(url.pathname)) return json({ ok: true });
          if (url.pathname.endsWith('/tasks/study-v1-0001/complete') && method === 'POST') { completed = true; return json({ taskId: 'study-v1-0001', status: 'completed' }); }
          if (/^\/api\/admin\/dev\/corpus-samples\/[^/]+\/audio$/.test(url.pathname)) return route.fulfill({ status: 200, contentType: 'audio/wav', body: makeWavBuffer() });
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
        return jsonComparison(route);
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
    await page.click('#segmentation-study-record');
    await page.waitForTimeout(500);
    await page.click('#segmentation-study-stop');
    await page.waitForFunction(() => !document.querySelector('#segmentation-study-analyze')?.disabled, null, { timeout: 30000 });
    await page.click('#segmentation-study-analyze');
    await page.waitForFunction(() => /failed/i.test(document.querySelector('#segmentation-study-analysis-status')?.textContent || ''), null, { timeout: 30000 });
    assert.ok(await page.locator('#segmentation-study-audio').getAttribute('src'), 'Analysis failure must preserve the recorded WAV for retry.');
    assert.strictEqual(await page.locator('#segmentation-study-analyze').isDisabled(), false, 'Analysis failure must permit retry without re-recording.');
    await page.click('#segmentation-study-analyze');
    await page.waitForFunction(() => /loaded/i.test(document.querySelector('#segmentation-study-analysis-status')?.textContent || ''), null, { timeout: 30000 });
    await page.click('[data-study-version="manual"]');
    await page.check('#segmentation-study-manual-certainty');
    await page.click('#segmentation-study-redo');
    assert.strictEqual(await page.locator('input[name="segmentation-study-certainty"]:checked').count(), 0, 'Redo must clear the prior certainty choice.');
    await page.click('#segmentation-study-record');
    await page.waitForTimeout(250);
    await page.click('#segmentation-study-stop');
    await page.waitForFunction(() => !document.querySelector('#segmentation-study-analyze')?.disabled, null, { timeout: 30000 });
    await page.click('#segmentation-study-analyze');
    await page.waitForFunction(() => /loaded/i.test(document.querySelector('#segmentation-study-analysis-status')?.textContent || ''), null, { timeout: 30000 });
    assert.ok(await page.locator('#segmentation-study-panel-v2 .segmentation-study-playback button').count() >= 2, 'Whole-word and syllable playback controls should be visible.');
    await page.selectOption('#segmentation-study-playback-speed', '0.75');
    for (const tab of ['v2', 'v3', 'v4', 'manual']) await page.click(`[data-study-version="${tab}"]`);
    await page.locator('#segmentation-study-tab-manual').focus();
    await page.keyboard.press('ArrowLeft');
    assert.strictEqual(await page.locator('.segmentation-study-tab.is-active').getAttribute('data-study-version'), 'v4');
    await page.keyboard.press('End');
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
    const snappedBoundary = await page.evaluate(() => {
      const wave = window.__lastStudyWave;
      const manual = document.querySelector('#segmentation-study-tab-manual');
      if (!wave || !manual) return null;
      const regionPlugin = wave.__regionPlugin || null;
      const visibleRegions = regionPlugin?.getRegions?.() || [];
      if (visibleRegions.length < 2) return null;
      visibleRegions[1].start = 0.42;
      wave.handlers['region-update-end'].forEach((callback) => callback(visibleRegions[1]));
      const rebuilt = regionPlugin.getRegions();
      return { leftEnd: rebuilt[0]?.end, rightStart: rebuilt[1]?.start };
    });
    assert.ok(snappedBoundary && Math.abs(snappedBoundary.leftEnd - snappedBoundary.rightStart) < 0.000001, 'Dragging either side of a manual boundary must keep adjacent syllables contiguous.');
    await page.check('#segmentation-study-manual-certainty');
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
    await page.mouse.click(box.x + box.width * 0.92, box.y + 40);
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
    assert.ok(requests.some((item) => item.path.endsWith('/tasks/study-v1-0001/complete') && item.method === 'POST'));
    await page.click('#segmentation-study-next');
    assert.strictEqual(await page.locator('input[name="segmentation-study-certainty"]:checked').count(), 0, 'The next task must require a new certainty choice.');
    assert.strictEqual(pageErrors.length, 0, `Unexpected page errors:\n${pageErrors.join('\n')}`);
    const unexpectedConsoleErrors = consoleErrors.filter((message) => !/503 \(Service Unavailable\)/.test(message));
    assert.strictEqual(unexpectedConsoleErrors.length, 0, `Unexpected console errors:\n${unexpectedConsoleErrors.join('\n')}`);
    console.log('crm segmentation study browser check passed');
  } finally { await browser.close(); }
}

function jsonComparison(route) {
  return route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify({
    schemaVersion: 'pronunciation-comparison-v1', status: 'complete', comparisonId: 'comparison-study-1',
    context: { targetWord: 'photograph', referenceIpa: '/ˈfoʊtəˌgræf/', referenceSyllableIpa: ['foʊ', 'tə', 'græf'], expectedSyllables: 3 },
    v2: { status: 'available', analysis: { analysisVersion: 'pronunciation-analysis-v2', observed_syllables: [{ startTime: 0.08, endTime: 0.3 }, { startTime: 0.3, endTime: 0.62 }, { startTime: 0.62, endTime: 0.95 }] } },
    v3: { status: 'available', analysis: { analysisVersion: 'pronunciation-analysis-v3', observed_syllables: [{ startTime: 0.1, endTime: 0.32 }, { startTime: 0.32, endTime: 0.63 }, { startTime: 0.63, endTime: 0.92 }], partitionVariants: { schemaVersion: 'pronunciation-partition-variants-v1', v3: [{ startTime: 0.1, endTime: 0.32 }, { startTime: 0.32, endTime: 0.63 }, { startTime: 0.63, endTime: 0.92 }], v4: [{ startTime: 0.08, endTime: 0.31 }, { startTime: 0.31, endTime: 0.64 }, { startTime: 0.64, endTime: 0.94 }], v4Diagnostics: [] } } }
  }) });
}

main().catch((error) => { console.error(error.stack || error.message || String(error)); process.exit(1); });
