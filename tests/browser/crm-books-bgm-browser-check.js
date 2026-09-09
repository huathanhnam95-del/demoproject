/* Bounded CRM Books Background Music control audit.
 * Read-only Playwright fixture: API, localStorage, Firebase storage, and Audio
 * are all mocked. It loads ui-continuity.js because the production shell owns
 * modal focus, inertness, and Tab lifecycle. No provider or real backend call. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..', '..');
const outputArgIndex = process.argv.indexOf('--output-dir');
if (outputArgIndex === -1 || !process.argv[outputArgIndex + 1]) {
  throw new Error('crm-books-bgm-browser-check.js requires --output-dir <external evidence directory>.');
}
const OUT = path.resolve(process.argv[outputArgIndex + 1]);
const relativeOutput = path.relative(ROOT, OUT);
if (relativeOutput === '' || (!relativeOutput.startsWith(`..${path.sep}`) && relativeOutput !== '..' && !path.isAbsolute(relativeOutput))) {
  throw new Error(`--output-dir must resolve outside the repository root: ${OUT}`);
}
const SOURCE_FILES = [
  'public/js/crm/books-workspace.js',
  'public/js/ui-continuity.js',
  'public/crm-admin.css',
  'public/style.css',
  'tests/browser/crm-books-bgm-browser-check.js'
];
const VIEWPORTS = [
  { id: 'desktop-1440', width: 1440, height: 900 },
  { id: 'mobile-390', width: 390, height: 844 }
];
const MODES = ['populated', 'empty', 'load-failure', 'firestore-fallback', 'retry-recovery', 'stale-response'];
const BOOK = { bookId: 'book-1', title: 'The Practice of Clear Thinking', author: 'Maya Chen', pageCount: 2, status: 'ready', ingest: null };

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function snapshotSources() {
  return Object.fromEntries(SOURCE_FILES.map((relative) => [relative, {
    sha256: sha256File(path.join(ROOT, relative)),
    bytes: fs.statSync(path.join(ROOT, relative)).size
  }]));
}

function installMemoryLocalStorage() {
  const data = new Map();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key) => data.has(key) ? data.get(key) : null,
      setItem: (key, value) => data.set(key, String(value)),
      removeItem: (key) => data.delete(key),
      clear: () => data.clear()
    }
  });
}

function installAudioMock() {
  window.__bgmAudioEvents = [];
  window.Audio = class MockAudio {
    constructor(src = '') {
      this.src = src;
      this.paused = true;
      this.listeners = {};
    }
    addEventListener(type, callback) {
      (this.listeners[type] ||= []).push(callback);
    }
    play() {
      this.paused = false;
      window.__bgmAudioEvents.push({ type: 'play', src: this.src });
      return Promise.resolve();
    }
    pause() {
      this.paused = true;
      window.__bgmAudioEvents.push({ type: 'pause', src: this.src });
    }
  };
}

function fixtureMarkup() {
  return `
    <section class="crm-panel" data-panel="books" style="display:block;width:100%;height:100vh;">
      <div class="crm-books-workspace">
        <div class="crm-books-sources-panel">
          <div class="crm-books-sources-header"><button class="crm-books-sources-header-toggle" type="button" aria-expanded="true">☰</button><h3>Sources</h3><span class="crm-books-sources-count">0</span></div>
          <button class="crm-books-add-btn" type="button">Add source</button>
          <div class="crm-books-search-wrap"><input class="crm-books-search" placeholder="Search books..." /></div>
          <div class="crm-books-source-actions"><button class="crm-books-add-btn" type="button">Add book</button></div>
          <div class="crm-books-sidebar-tag-filter-bar"></div><div class="crm-books-collection-filter-area"></div>
          <ul class="crm-books-list"></ul>
        </div>
        <div class="crm-books-explorer-panel"><div class="crm-books-detail"><div class="crm-books-empty-detail"><h3>Select a book</h3></div></div></div>
      </div>
    </section>`;
}

async function installFixture(page, mode, requests, toasts, externalRequests) {
  await page.addInitScript(installMemoryLocalStorage);
  await page.addInitScript(installAudioMock);
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (/^https?:\/\//i.test(url)) {
      externalRequests.push(url);
      await route.abort();
      return;
    }
    await route.continue();
  });
  await page.setContent(fixtureMarkup());
  // about:blank has an opaque origin; reapply the fixture store after the
  // document exists so the production module can read localStorage safely.
  await page.evaluate(installMemoryLocalStorage);
  await page.evaluate(installAudioMock);
  await page.evaluate(() => { window.__bgmToasts = []; });
  await page.addStyleTag({ path: path.join(ROOT, 'public', 'crm-admin.css') });
  await page.addStyleTag({ path: path.join(ROOT, 'public', 'style.css') });
  await page.addScriptTag({ path: path.join(ROOT, 'public', 'js', 'ui-continuity.js') });
  await page.addScriptTag({ path: path.join(ROOT, 'public', 'js', 'crm', 'books-workspace.js') });
  await page.evaluate(async ({ mode }) => {
    const book = { bookId: 'book-1', title: 'The Practice of Clear Thinking', author: 'Maya Chen', pageCount: 2, status: 'ready', ingest: null };
    const track = {
      id: 'audio-1', title: 'Fixture Focus', originalFilename: 'fixture-focus.mp3',
      sizeBytes: 1024, duration: 18, downloadUrl: 'https://blocked.invalid/fixture-focus.mp3'
    };
    window.__bgmTracks = ['populated', 'firestore-fallback', 'retry-recovery'].includes(mode) ? [track] : [];
    window.__bgmMode = mode;
    window.__bgmRetryReady = false;
    window.__bgmStaleResolve = null;
    window.__bgmRequests = [];
    const request = async (requestPath, options = {}) => {
      const method = options.method || 'GET';
      const body = options.body ? JSON.parse(options.body) : null;
      window.__bgmRequests.push({ path: requestPath, method, body });
      if (requestPath === '/api/admin/books/usage') return { estimatedCostUsd: 0, budgetLimitUsd: 10, approved: false };
      if (requestPath === '/api/admin/books/ensure-seed') return {};
      if (requestPath === '/api/admin/book-collections') return { collections: [] };
      if (requestPath === '/api/admin/book-tags') return { tags: [] };
      if (requestPath === '/api/admin/books') return { books: [book] };
      if (requestPath === '/api/admin/books/book-1' && method === 'GET') return { book, summary: null };
      if (requestPath === '/api/admin/books/book-1/pages') return { totalPages: 2, pages: ['Fixture page one.', 'Fixture page two.'] };
      if (requestPath === '/api/admin/books/book-1/threads') return { threads: [] };
      if (requestPath === '/api/admin/books/book-1/notes') return { notes: [] };
      if (requestPath === '/api/admin/book-links') return { links: [] };
      if (requestPath === '/api/admin/books/book-1/audio' && method === 'GET') {
        if (window.__bgmMode === 'load-failure' || (window.__bgmMode === 'firestore-fallback')) throw new Error('fixture audio API load failed');
        if (window.__bgmMode === 'retry-recovery' && !window.__bgmRetryReady) throw new Error('fixture retryable audio load failed');
        if (window.__bgmMode === 'stale-response') {
          return new Promise((resolve) => {
            window.__bgmStaleResolve = () => resolve({ tracks: [{ ...track, title: 'Stale response track' }] });
          });
        }
        return { tracks: window.__bgmTracks };
      }
      if (requestPath === '/api/admin/books/book-1/audio' && method === 'POST') {
        return { track: body };
      }
      if (requestPath === '/api/admin/books/book-1/audio/audio-1' && method === 'DELETE') {
        window.__bgmTracks = window.__bgmTracks.filter((item) => item.id !== 'audio-1');
        return {};
      }
      throw new Error(`Unexpected Books BGM request: ${method} ${requestPath}`);
    };
    const fallbackBehavior = ['load-failure', 'firestore-fallback'].includes(mode)
      ? {
        firestore: () => ({
          collection: () => ({
            doc: () => ({
              collection: () => ({
                orderBy: () => ({
                  get: async () => {
                    if (mode === 'load-failure') throw new Error('fixture Firestore fallback failed');
                    return { docs: [{ id: 'audio-1', data: () => track }] };
                  }
                })
              })
            })
          })
        })
      }
      : null;
    const panel = document.querySelector('[data-panel="books"]');
    window.__bgmController = window.CrmBooksWorkspace.createController({
      elements: { booksPanel: panel },
      apiFetchJson: request,
      showToast: (message, level) => window.__bgmToasts.push({ message, level }),
      firebase: fallbackBehavior
    });
    await window.__bgmController.init();
    await window.__bgmController.selectBook('book-1');
  }, { mode });
  // Ensure the closure-visible fixture is installed before init above.
}

async function runCase(browser, viewport, mode) {
  const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
  const pageErrors = [];
  const consoleErrors = [];
  const requests = [];
  const toasts = [];
  const externalRequests = [];
  const caseResult = {
    viewport: viewport.id,
    mode,
    status: 'pass',
    findings: [],
    acceptance: {},
    pageErrors,
    consoleErrors,
    externalRequests,
    requests,
    toasts
  };
  const check = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  try {
    await page.addInitScript(() => {
      window.__bgmBookFixture = { bookId: 'book-1', title: 'The Practice of Clear Thinking', author: 'Maya Chen', pageCount: 2, status: 'ready', ingest: null };
      window.__bgmToasts = [];
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('request', (request) => requests.push({ method: request.method(), url: request.url() }));
    page.on('dialog', async (dialog) => { await dialog.accept(); });
    await installFixture(page, mode, requests, toasts, externalRequests);
    await page.waitForSelector('.crm-books-list-item[data-book-id="book-1"]');
    const opener = page.locator('.crm-books-bgm-btn[data-book-id="book-1"]');
    check(await opener.count() === 1, 'BGM opener must render for the ready book.');

    const openModal = async () => {
      await opener.click();
      await page.waitForSelector('.crm-books-bgm-modal[style*="display: flex"]');
      await page.waitForTimeout(80);
      await page.evaluate(() => document.querySelector('.crm-books-bgm-btn[data-book-id="book-1"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
      await page.waitForSelector('.crm-books-bgm-modal[style*="display: flex"]');
      await page.waitForTimeout(80);
      check(await page.locator('.crm-books-bgm-modal').count() === 1, 'Reopening BGM must leave exactly one body-level modal.');
      const geometry = await page.evaluate(() => {
        const modal = document.querySelector('.crm-books-bgm-modal');
        const container = modal?.querySelector('.crm-modal-container');
        const mr = modal?.getBoundingClientRect();
        const cr = container?.getBoundingClientRect();
        return {
          modal: mr && { left: mr.left, right: mr.right, top: mr.top, bottom: mr.bottom, width: mr.width, height: mr.height },
          container: cr && { left: cr.left, right: cr.right, top: cr.top, bottom: cr.bottom, width: cr.width, height: cr.height },
          viewport: { width: innerWidth, height: innerHeight },
          visibleControls: {
            close: !!document.querySelector('.crm-books-modal-close')?.getClientRects().length,
            dropzone: !!document.querySelector('#crm-books-bgm-dropzone')?.getClientRects().length,
            list: !!document.querySelector('#crm-books-bgm-list')?.getClientRects().length
          }
        };
      });
      caseResult.geometry = geometry;
      check(geometry.container && geometry.container.left >= -1 && geometry.container.right <= geometry.viewport.width + 1, 'BGM modal container must stay within the viewport.');
      check(Object.values(geometry.visibleControls).every(Boolean), 'BGM modal controls must be visible.');
    };

    await openModal();
    const openFocus = await page.evaluate(() => document.activeElement?.className || '');
    caseResult.acceptance.openFocusClose = openFocus.includes('crm-books-modal-close');
    caseResult.focusAfterOpen = openFocus;
    check(caseResult.acceptance.openFocusClose, 'Opening BGM modal must focus Close.');

    await page.evaluate(() => {
      const hidden = document.createElement('div');
      hidden.className = 'crm-modal-overlay crm-books-bgm-hidden-later';
      hidden.hidden = true;
      document.body.appendChild(hidden);
    });
    await page.keyboard.press('Escape');
    check(await page.locator('.crm-books-bgm-modal').count() === 0, 'A hidden later overlay must not block BGM Escape.');
    check(await page.locator('.crm-books-bgm-hidden-later').count() === 1, 'Hidden later overlay should remain untouched by BGM Escape.');
    caseResult.acceptance.hiddenLaterOverlayIgnored = true;
    await page.locator('.crm-books-bgm-hidden-later').evaluate((element) => element.remove());
    await openModal();

    await page.evaluate(() => {
      const alternate = document.createElement('button');
      alternate.type = 'button';
      alternate.id = 'crm-books-bgm-alternate-opener';
      alternate.className = 'crm-books-bgm-btn';
      alternate.dataset.bookId = 'book-1';
      alternate.textContent = 'Alternate opener';
      document.querySelector('[data-panel="books"]')?.appendChild(alternate);
      alternate.focus();
      alternate.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await page.waitForSelector('.crm-books-bgm-modal[style*="display: flex"]');
    await page.waitForTimeout(50);
    check(await page.locator('.crm-books-bgm-modal').count() === 1, 'Replacing from a different opener must leave one BGM modal.');
    await page.locator('.crm-books-modal-close').click();
    await page.waitForSelector('.crm-books-bgm-modal', { state: 'detached' });
    check(await page.evaluate(() => document.activeElement?.id === 'crm-books-bgm-alternate-opener'), 'Replacing from a different opener must restore that exact opener.');
    caseResult.acceptance.reopenDifferentOpener = true;
    await page.evaluate(() => document.getElementById('crm-books-bgm-alternate-opener')?.remove());
    await opener.focus();
    await openModal();

    const hasTracks = ['populated', 'firestore-fallback'].includes(mode);
    const expectedFocusTargets = hasTracks
      ? ['.crm-books-bgm-preview-btn', '.crm-books-bgm-delete-btn', '.crm-books-modal-close-btn', '.crm-books-modal-close']
      : ['.crm-books-modal-close-btn', '.crm-books-modal-close'];
    const focusInfo = () => page.evaluate((expected) => {
      const modal = document.querySelector('.crm-books-bgm-modal');
      const active = document.activeElement;
      return {
        tag: active?.tagName || '',
        id: active?.id || '',
        className: active?.className || '',
        inside: !!modal?.contains(active),
        matches: expected.filter((selector) => active?.matches(selector))
      };
    }, expectedFocusTargets);
    const tabSequence = [];
    for (let i = 0; i < expectedFocusTargets.length + 2; i += 1) {
      await page.keyboard.press('Tab');
      tabSequence.push(await focusInfo());
    }
    await page.keyboard.press('Shift+Tab');
    const shiftTabInfo = await focusInfo();
    caseResult.tabSequence = tabSequence;
    caseResult.shiftTab = shiftTabInfo;
    caseResult.acceptance.tabContained = tabSequence.every((item) => item.inside) && shiftTabInfo.inside;
    caseResult.acceptance.tabReachability = expectedFocusTargets.every((selector) =>
      tabSequence.some((item) => item.matches.includes(selector))
    );
    // Retain the exact observed targets for review; do not fail the rest of
    // this case solely because a keyboard target is absent or reordered.
    if (!caseResult.acceptance.tabContained || !caseResult.acceptance.tabReachability) {
      caseResult.findings.push({
        id: 'bgm-tab-focus-boundary',
        severity: 'P2',
        message: 'BGM Tab/Shift+Tab focus sequence did not keep every observed target inside the dialog or did not reach every expected control.'
      });
    }

    await page.keyboard.press('Escape');
    await page.waitForTimeout(60);
    const escapeClosed = await page.locator('.crm-books-bgm-modal').count() === 0;
    caseResult.acceptance.escapeClose = escapeClosed;
    if (!escapeClosed) {
      caseResult.findings.push({ id: 'bgm-escape-does-not-close', severity: 'P2', message: 'Escape leaves the native Background Music modal open in the combined books-workspace + ui-continuity shell.' });
      await page.locator('.crm-books-modal-close').click();
    }
    await page.waitForSelector('.crm-books-bgm-modal', { state: 'detached' });
    caseResult.acceptance.closeFocusRestore = await page.evaluate(() => document.activeElement?.matches('.crm-books-bgm-btn[data-book-id="book-1"]'));
    check(caseResult.acceptance.closeFocusRestore, 'Closing the BGM modal must restore focus to its opener.');

    await openModal();
    // A synthetic child dialog must consume Escape first; the BGM parent stays
    // open until the child is gone, proving topmost-only handling.
    await page.evaluate(() => {
      const child = document.createElement('div');
      child.className = 'crm-modal-overlay crm-books-modal-overlay crm-books-bgm-test-child';
      child.style.display = 'flex';
      child.innerHTML = '<button type="button" class="crm-books-bgm-test-child-close">Child close</button>';
      child.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          child.remove();
        }
      });
      document.body.appendChild(child);
      child.querySelector('button').focus();
    });
    await page.keyboard.press('Escape');
    check(await page.locator('.crm-books-bgm-test-child').count() === 0, 'Topmost child dialog must close on the first Escape.');
    check(await page.locator('.crm-books-bgm-modal').count() === 1, 'Parent BGM modal must remain open when a child dialog consumes Escape.');
    caseResult.acceptance.topmostEscape = true;
    await page.evaluate(() => {
      const child = document.createElement('div');
      child.className = 'crm-modal-overlay crm-books-modal-overlay crm-books-bgm-test-child';
      child.style.display = 'flex';
      child.innerHTML = '<button type="button" class="crm-books-bgm-test-child-close">Child close</button>';
      document.body.appendChild(child);
      child.querySelector('button').focus();
    });
    await page.evaluate(() => document.querySelector('.crm-books-bgm-modal')?.__crmBooksBgmClose?.());
    await page.waitForSelector('.crm-books-bgm-modal', { state: 'detached' });
    check(await page.locator('.crm-books-bgm-test-child').count() === 1, 'Closing a BGM modal beneath an active child must leave the child open.');
    check(await page.evaluate(() => document.activeElement?.matches('.crm-books-bgm-test-child-close')), 'Closing a BGM modal beneath an active child must not steal child focus.');
    caseResult.acceptance.underlyingClosePreservesChildFocus = true;
    await page.locator('.crm-books-bgm-test-child').evaluate((element) => element.remove());
    await opener.focus();

    await openModal();
    const itemCount = await page.locator('.crm-books-bgm-item').count();
    if (hasTracks) {
      check(itemCount === 1, 'Populated fixture must render one BGM track.');
      caseResult.acceptance.populatedRender = true;
      await page.locator('.crm-books-bgm-preview-btn[data-audio-id="audio-1"]').click();
      await page.waitForTimeout(30);
      const previewState = await page.evaluate(() => ({
        title: document.querySelector('.crm-books-bgm-preview-btn')?.title,
        events: window.__bgmAudioEvents
      }));
      check(previewState.title === 'Pause preview', 'Preview click must enter playing state.');
      check(previewState.events.some((event) => event.type === 'play'), 'Preview click must invoke mocked Audio.play.');
      await page.locator('.crm-books-bgm-preview-btn[data-audio-id="audio-1"]').click();
      const pausedState = await page.evaluate(() => ({
        title: document.querySelector('.crm-books-bgm-preview-btn')?.title,
        events: window.__bgmAudioEvents
      }));
      check(pausedState.title === 'Play preview', 'Second preview click must pause the track.');
      check(pausedState.events.some((event) => event.type === 'pause'), 'Second preview click must invoke mocked Audio.pause.');
      caseResult.acceptance.previewPause = true;
      await page.locator('.crm-books-bgm-delete-btn[data-audio-id="audio-1"]').click();
      await page.waitForSelector('.crm-books-bgm-item', { state: 'detached' });
      const deletes = await page.evaluate(() => window.__bgmRequests.filter((request) => request.method === 'DELETE'));
      check(deletes.length === 1 && deletes[0].path.endsWith('/audio/audio-1'), 'Delete must call the scoped audio DELETE endpoint.');
      caseResult.acceptance.delete = true;
    } else {
      const emptyText = await page.locator('#crm-books-bgm-list').textContent();
      caseResult.emptyText = emptyText.trim();
      if (mode === 'stale-response') {
        caseResult.acceptance.pendingLoadObserved = /Loading tracks/i.test(emptyText);
      } else if (mode === 'load-failure' || mode === 'retry-recovery') {
        check(itemCount === 0 && /Unable to load background music/i.test(emptyText), `${mode} fixture must render an honest BGM load error.`);
        check(await page.locator('.crm-books-bgm-retry-btn').count() === 1, `${mode} fixture must render a Retry action.`);
        caseResult.acceptance.loadErrorWithRetry = true;
        if (mode === 'retry-recovery') {
          await page.evaluate(() => { window.__bgmRetryReady = true; });
          await page.locator('.crm-books-bgm-retry-btn').click();
          await page.waitForSelector('.crm-books-bgm-item[data-audio-id="audio-1"]');
          check(await page.locator('.crm-books-bgm-item').count() === 1, 'Retry must recover the populated BGM track list.');
          caseResult.acceptance.retryRecovery = true;
        }
      } else {
        check(itemCount === 0 && /No custom background music uploaded yet/i.test(emptyText), `${mode} fixture must render the empty BGM state.`);
        caseResult.acceptance.emptyState = true;
      }
      if (mode === 'stale-response') {
        await page.locator('.crm-books-modal-close').click();
        await page.waitForSelector('.crm-books-bgm-modal', { state: 'detached' });
        await page.evaluate(() => {
          window.__bgmStaleResolve?.();
          window.__bgmMode = 'empty';
        });
        await page.waitForTimeout(50);
        check(await page.locator('.crm-books-bgm-modal').count() === 0, 'Closing during a pending audio load must not reopen or retain the modal.');
        await openModal();
        check(await page.locator('.crm-books-bgm-item').count() === 0, 'A stale response after close must not populate a later BGM modal.');
        caseResult.acceptance.staleResponseIgnored = true;
      }
    }

    const beforeInvalidRequests = await page.evaluate(() => window.__bgmRequests.length);
    await page.locator('#crm-books-bgm-file-input').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not audio') });
    await page.waitForTimeout(60);
    const fixtureToasts = await page.evaluate(() => (window.__bgmToasts || []).slice());
    toasts.push(...fixtureToasts);
    check(fixtureToasts.some((toast) => /Only select an MP3|Please select an MP3/i.test(toast.message)), 'Invalid file must produce the MP3 validation toast.');
    const afterInvalidRequests = await page.evaluate(() => window.__bgmRequests.length);
    check(beforeInvalidRequests === afterInvalidRequests, 'Invalid file must not call storage or API upload paths.');
    caseResult.acceptance.invalidFileValidation = true;

    await page.locator('.crm-books-modal-close-btn').click();
    await page.waitForSelector('.crm-books-bgm-modal', { state: 'detached' });
    check(await page.evaluate(() => document.activeElement?.matches('.crm-books-bgm-btn[data-book-id="book-1"]')), 'Done must close and restore focus to the opener.');
    caseResult.acceptance.doneClose = true;
    check(pageErrors.length === 0, `Unexpected page errors: ${pageErrors.join('; ')}`);
    check(consoleErrors.length === 0, `Unexpected console errors: ${consoleErrors.join('; ')}`);
    check(externalRequests.length === 0, `External requests were attempted: ${externalRequests.join('; ')}`);
    caseResult.requests = await page.evaluate(() => window.__bgmRequests);
  } catch (error) {
    caseResult.status = 'fail';
    caseResult.error = error.stack || error.message || String(error);
    try { caseResult.requests = await page.evaluate(() => window.__bgmRequests || []); } catch (_) { /* preserve primary failure */ }
  } finally {
    caseResult.toasts = toasts.length ? toasts : await page.evaluate(() => window.__bgmToasts || []).catch(() => []);
    caseResult.sourceHashesAfterCase = snapshotSources();
    await page.close();
  }
  return caseResult;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const sourceHashesBefore = snapshotSources();
  const run = {
    audit: 'remaining-books-bgm-controls',
    browser: 'installed Chrome via Playwright channel',
    sourceHashesBefore,
    sourceHashesAfter: null,
    sourceStable: null,
    cases: [],
    findings: [],
    limitations: [
      'API responses, Firebase Storage, localStorage, and HTMLAudioElement are fixture-simulated; no provider, real Firebase, media backend, or persisted reload was exercised.',
      'Map-backed localStorage proves browser-side key/value behavior only; it is not persisted-production evidence.',
      'Audio preview uses a synthetic Audio object and proves UI play/pause wiring only, not decoded audio quality or playback on a physical device.',
      'Escape behavior is classified from the combined books-workspace.js + ui-continuity.js shell loaded in this audit.'
    ]
  };
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    for (const viewport of VIEWPORTS) {
      for (const mode of MODES) {
        run.cases.push(await runCase(browser, viewport, mode));
      }
    }
  } catch (error) {
    run.launchError = error.stack || error.message || String(error);
  } finally {
    if (browser) await browser.close();
    run.sourceHashesAfter = snapshotSources();
    run.sourceStable = JSON.stringify(run.sourceHashesBefore) === JSON.stringify(run.sourceHashesAfter);
    if (!run.sourceStable) run.findings.push({ id: 'source-changed-during-audit', severity: 'blocking-for-acceptance', message: 'One or more audited source files changed between the before and after snapshots; case evidence is unstable.' });
    for (const item of run.cases) {
      for (const finding of item.findings || []) {
        run.findings.push({ viewport: item.viewport, mode: item.mode, ...finding });
      }
    }
    const failedCases = run.cases.filter((item) => item.status === 'fail');
    run.status = run.launchError || failedCases.length
      ? 'fail'
      : (run.sourceStable ? (run.findings.length ? 'pass-with-finding' : 'pass') : 'unstable');
    const jsonPath = path.join(OUT, 'books-bgm-audit.json');
    const textPath = path.join(OUT, 'books-bgm-audit.txt');
    fs.writeFileSync(jsonPath, JSON.stringify(run, null, 2) + '\n');
    const lines = [
      `CRM Books Background Music bounded audit: ${run.status.toUpperCase()}`,
      `Browser: installed Chrome via Playwright channel; viewports: 1440x900 and 390x844.`,
      `Source stable: ${run.sourceStable}; before/after hashes retained in books-bgm-audit.json.`,
      ''
    ];
    for (const item of run.cases) {
      lines.push(`${item.viewport} / ${item.mode}: ${item.status.toUpperCase()}${item.error ? ` — ${item.error.split('\n')[0]}` : ''}`);
      if (item.findings?.length) item.findings.forEach((finding) => lines.push(`  Finding ${finding.severity}: ${finding.message}`));
      const accepted = Object.entries(item.acceptance || {}).filter(([, value]) => value).map(([key]) => key);
      if (accepted.length) lines.push(`  Acceptance: ${accepted.join(', ')}`);
    }
    if (run.findings.length) {
      lines.push('', 'Findings:');
      run.findings.forEach((finding) => lines.push(`- ${finding.severity}: ${finding.message}`));
    }
    lines.push('', 'Limitations:', ...run.limitations.map((item) => `- ${item}`), '');
    fs.writeFileSync(textPath, lines.join('\n'));
    console.log(JSON.stringify({ status: run.status, jsonPath, textPath, findings: run.findings.length }));
  }
  if (run.status !== 'pass') process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
