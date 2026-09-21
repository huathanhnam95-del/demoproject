/* eslint-disable no-console */
const assert = require('assert');
const express = require('express');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { launchPracticeChrome } = require('./helpers/launch-practice-chrome');

const EVIDENCE_DIR = process.env.RETELL_LAUNCHER_EVIDENCE_DIR || '';

function startHarnessServer() {
  const app = express();
  const publicDir = path.join(__dirname, '..', '..', 'public');
  app.use(express.static(publicDir));
  app.get('/', (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => resolve({ server, origin: `http://127.0.0.1:${server.address().port}` }));
  });
}

async function waitForDashboard(page) {
  await page.waitForFunction(() => typeof window.switchToMode === 'function', { timeout: 30000 });
  await page.waitForFunction(() => {
    const wrapper = document.getElementById('page-layout-wrapper');
    return wrapper && getComputedStyle(wrapper).display !== 'none';
  }, { timeout: 15000 });
  const tutorials = page.locator('#btn-panel-tutorials');
  if (await tutorials.count()) await tutorials.click().catch(() => {});
  await page.waitForFunction(() => document.getElementById('panel-tutorials')?.classList.contains('active'), { timeout: 15000 });
  await page.evaluate(() => window.setPracticeScope?.('pte'));
  await page.locator('#practice-skill-filter .practice-skill-btn[data-practice-skill="speaking"]').click();
  await page.waitForFunction(() => {
    const card = document.getElementById('mode-btn-notes');
    return !!card && !card.hidden && getComputedStyle(card).display !== 'none';
  }, { timeout: 10000 });
}

(async () => {
  const { server, origin } = await startHarnessServer();
  const browser = await launchPracticeChrome({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(() => {
    localStorage.setItem('practiceScope', 'pte');
    localStorage.setItem('hasSeenScopeTutorial', 'true');
    sessionStorage.setItem('guestMode', 'true');
    ['notes', 'read-aloud', 'speak', 'type', 'rfib'].forEach((mode) => localStorage.setItem(`${mode}ModeFirstUse`, 'true'));
  });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(String(error.message || error)));
  page.on('requestfailed', (request) => {
    failedRequests.push({ url: request.url(), error: request.failure()?.errorText || '' });
  });
  try {
    // Reproduce the real failure mode: the index-level optional CDN scripts are unavailable.
    await page.route('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js', (route) => route.abort());
    await page.route('https://cdn.jsdelivr.net/npm/compromise@14.10.0/builds/compromise.min.js', (route) => route.abort());
    await page.goto(`${origin}/index.html`, { waitUntil: 'domcontentloaded' });
    await waitForDashboard(page);

    // Keep the launcher test focused on dashboard navigation and provide a bounded local
    // entry source so the Notes controller can finish without Firebase/network dependency.
    await page.evaluate(() => {
      const entry = { id: '1', title: 'Local Retell Lecture', transcript: 'A local lecture transcript.', level: 1, videoUrl: '' };
      const database = {
        collection: () => ({
          get: async () => ({ empty: false, docs: [{ id: entry.id, data: () => entry }] })
        })
      };
      if (window.firebase) window.firebase.firestore = () => database;

      const originalSwitch = window.switchToMode;
      const timeline = [];
      const mark = (label, detail = {}) => timeline.push({ label, atMs: Math.round(performance.now()), ...detail });
      window.__retellLaunchTimeline = timeline;
      window.__retellLaunch = { status: 'pending', value: null, error: '' };
      window.switchToMode = function trackedSwitch(mode, ...args) {
        mark('switchToMode:start', { mode });
        const result = originalSwitch.call(this, mode, ...args);
        if (mode === 'notes') {
          Promise.resolve(result).then(
            (value) => {
              mark('switchToMode:fulfilled', { mode, value: value ?? null });
              window.__retellLaunch = { status: 'fulfilled', value: value ?? null, error: '' };
            },
            (error) => {
              const message = String(error?.message || error);
              mark('switchToMode:rejected', { mode, error: message });
              window.__retellLaunch = { status: 'rejected', value: null, error: message };
            }
          );
        }
        return result;
      };

      const originalEnsureModeScripts = window.BELLazyLoader.ensureModeScripts;
      window.BELLazyLoader.ensureModeScripts = async function trackedEnsureModeScripts(mode) {
        mark('lazy-loader:start', { mode });
        try {
          const result = await originalEnsureModeScripts.call(this, mode);
          mark('lazy-loader:fulfilled', { mode, result });
          return result;
        } catch (error) {
          const message = String(error?.message || error);
          mark('lazy-loader:rejected', { mode, error: message });
          throw error;
        }
      };

      let notesMode;
      Object.defineProperty(window, 'TakeNotesMode', {
        configurable: true,
        get: () => notesMode,
        set: (next) => {
          notesMode = next;
          mark('TakeNotesMode:assigned');
          if (next && typeof next.onEnter === 'function') {
            const originalOnEnter = next.onEnter;
            next.onEnter = async function trackedOnEnter(...onEnterArgs) {
              mark('TakeNotesMode.onEnter:start');
              try {
                return await originalOnEnter.apply(this, onEnterArgs);
              } finally {
                mark('TakeNotesMode.onEnter:end');
              }
            };
          }
        }
      });
    });

    await page.locator('#mode-btn-notes').click();
    await page.waitForFunction(() => window.__retellLaunch?.status !== 'pending', { timeout: 5000 });
    await page.waitForFunction(() => {
      const panel = document.getElementById('mode-notes');
      return panel && panel.classList.contains('active') && getComputedStyle(panel).display !== 'none';
    }, { timeout: 5000 });

    const state = await page.evaluate(() => ({
      launch: window.__retellLaunch,
      launchTimeline: window.__retellLaunchTimeline || [],
      href: window.location.href,
      activeMode: window.appState?.currentMode || '',
      activePanel: document.querySelector('.mode-panel.active')?.id || '',
      controllerCount: document.querySelectorAll('#mode-notes .spc-controller').length,
      entryStatus: document.getElementById('notes-entry-status')?.dataset.notesStatus || '',
      feedbackCount: document.querySelectorAll('#ui-feedback-stack .ui-task-feedback').length
    }));
    console.log('Retell launcher state:', JSON.stringify(state));

    const timeline = state.launchTimeline || [];
    assert.equal(state.launch.status, 'fulfilled', `Retell Lecture dashboard launch should settle: ${JSON.stringify(state.launch)}`);
    assert.equal(state.activeMode, 'notes', 'Dashboard card should activate Retell Lecture');
    assert.equal(state.activePanel, 'mode-notes', 'Retell Lecture panel should be active after card click');
    assert.match(state.href, /\/pte-practice\/speaking\/notes\/1$/, 'Dashboard entry should route to PTE Retell Lecture');
    assert.equal(state.controllerCount, 1, 'Retell Lecture should mount one speaking controller');
    assert.equal(state.entryStatus, 'ready', 'Retell Lecture should reach ready state from the local entry source');
    assert.equal(state.feedbackCount, 0, 'Opening feedback should finish after dashboard launch settles');
    assert.deepEqual(
      timeline.map((entry) => entry.label),
      [
        'switchToMode:start',
        'lazy-loader:start',
        'TakeNotesMode:assigned',
        'lazy-loader:fulfilled',
        'TakeNotesMode.onEnter:start',
        'TakeNotesMode.onEnter:end',
        'switchToMode:fulfilled'
      ],
      `Retell Lecture launcher timing markers should show the required load/entry order: ${JSON.stringify(timeline)}`
    );
    assert.deepEqual(pageErrors, [], `Retell Lecture launcher should not raise page errors: ${JSON.stringify(pageErrors)}`);

    if (EVIDENCE_DIR) {
      fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
      await page.screenshot({ path: path.join(EVIDENCE_DIR, 'retell-lecture-launcher.png'), fullPage: true });
      fs.writeFileSync(path.join(EVIDENCE_DIR, 'retell-lecture-launcher.json'), `${JSON.stringify({ state, consoleErrors, pageErrors, failedRequests }, null, 2)}\n`);
    }

    const failureContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await failureContext.addInitScript(() => {
      localStorage.setItem('practiceScope', 'pte');
      localStorage.setItem('hasSeenScopeTutorial', 'true');
      sessionStorage.setItem('guestMode', 'true');
      ['notes', 'read-aloud', 'speak', 'type', 'rfib'].forEach((mode) => localStorage.setItem(`${mode}ModeFirstUse`, 'true'));
    });
    const failurePage = await failureContext.newPage();
    const failurePageErrors = [];
    failurePage.on('pageerror', (error) => failurePageErrors.push(String(error.message || error)));
    await failurePage.goto(`${origin}/index.html`, { waitUntil: 'domcontentloaded' });
    await waitForDashboard(failurePage);
    await failurePage.evaluate(() => {
      window.__retellRequiredAssetFailure = { status: 'pending', error: '' };
      const originalEnsureModeScripts = window.BELLazyLoader.ensureModeScripts;
      window.BELLazyLoader.ensureModeScripts = async function forcedRequiredAssetFailure(mode) {
        if (mode === 'notes') throw new Error('Required Notes asset intentionally unavailable');
        return originalEnsureModeScripts.call(this, mode);
      };
      const originalSwitch = window.switchToMode;
      window.switchToMode = function trackedRequiredAssetFailure(mode, ...args) {
        const result = originalSwitch.call(this, mode, ...args);
        Promise.resolve(result).then(
          () => { window.__retellRequiredAssetFailure = { status: 'fulfilled', error: '' }; },
          (error) => { window.__retellRequiredAssetFailure = { status: 'rejected', error: String(error?.message || error) }; }
        );
        return result;
      };
    });
    await failurePage.locator('#mode-btn-notes').click();
    await failurePage.waitForFunction(() => window.__retellRequiredAssetFailure?.status !== 'pending', { timeout: 5000 });
    const failureState = await failurePage.evaluate(() => {
      const dashboard = document.querySelector('.dashboard-modern-container');
      const panel = document.getElementById('mode-notes');
      const alert = document.getElementById('shop-alert-modal');
      return {
        launch: window.__retellRequiredAssetFailure,
        activeMode: window.appState?.currentMode || '',
        dashboardVisible: !!dashboard && getComputedStyle(dashboard).display !== 'none',
        panelActive: panel?.classList.contains('active') || false,
        panelDisplay: panel ? getComputedStyle(panel).display : 'missing',
        alertVisible: !!alert && getComputedStyle(alert).display !== 'none',
        feedbackCount: document.querySelectorAll('#ui-feedback-stack .ui-task-feedback').length
      };
    });
    assert.equal(failureState.launch.status, 'fulfilled', `Required Notes asset failure should settle: ${JSON.stringify(failureState.launch)}`);
    assert.equal(failureState.activeMode, '', 'Failed Retell Lecture assets must not claim that Notes is active');
    assert.equal(failureState.dashboardVisible, true, 'Failed Retell Lecture assets must restore the dashboard');
    assert.equal(failureState.panelActive, false, 'Failed Retell Lecture assets must remove the temporary Notes shell');
    assert.equal(failureState.panelDisplay, 'none', 'Failed Retell Lecture assets must hide the Notes shell');
    assert.equal(failureState.alertVisible, true, 'Failed Retell Lecture assets must show the existing alert');
    assert.equal(failureState.feedbackCount, 0, 'Required asset failure must finish opening feedback');
    assert.deepEqual(failurePageErrors, [], `Required asset failure should not raise page errors: ${JSON.stringify(failurePageErrors)}`);
    if (EVIDENCE_DIR) {
      await failurePage.screenshot({ path: path.join(EVIDENCE_DIR, 'retell-lecture-launcher-required-asset-failure.png'), fullPage: true });
      fs.writeFileSync(path.join(EVIDENCE_DIR, 'retell-lecture-launcher-required-asset-failure.json'), `${JSON.stringify({ failureState, failurePageErrors }, null, 2)}\n`);
    }
    await failurePage.close();
    await failureContext.close();
    console.log('Retell Lecture dashboard launcher browser check passed');
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
