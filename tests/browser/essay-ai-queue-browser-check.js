/* eslint-disable no-console */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('http');
const path = require('path');

(async () => {
  const app = express();
  const publicDir = path.join(__dirname, '..', '..', 'public');
  app.use(express.json());
  app.post('/api/practice-attempts/save', (_req, res) => res.json({ success: true, data: { attemptId: 'browser-essay-attempt-001' } }));
  app.use(express.static(publicDir));
  app.get('/', (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  let callablePayload = null;
  await page.route('https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: `
      export const getFunctions = () => ({});
      export const connectFunctionsEmulator = () => {};
      export const httpsCallable = (_functions, name) => async (payload) => {
        window.__callableName = name;
        window.__callablePayload = payload;
        return { data: { queueId: 'browser-queue-001', status: 'pending', created: true } };
      };
    `
  }));
  await page.addInitScript(() => {
    localStorage.setItem('essayInfoDismissed', '1');
    localStorage.setItem('essayModeFirstUse', 'true');
    sessionStorage.setItem('guestMode', 'false');
  });
  try {
    await page.goto(`${origin}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.switchToMode === 'function');
    await page.evaluate(() => {
      document.querySelector('.app-preloader')?.remove();
      document.getElementById('entry-modal')?.remove();
      window.mockUser = { uid: 'browser-user', getIdToken: async () => 'test-token' };
      window.__FIREBASE_INTERNAL__ = window.__FIREBASE_INTERNAL__ || {};
      window.__FIREBASE_INTERNAL__.functions = {};
      window.__FIREBASE_INTERNAL__.auth = { currentUser: window.mockUser };
      window.switchToMode?.('essay');
    });
    // Navigation is the shared v7 picker; entries are loaded once the pill
    // carries a real prompt label instead of the loading placeholder.
    await page.waitForFunction(() => {
      const pill = document.getElementById('essay-v7-question-pill');
      return pill && !pill.disabled && /^#/.test(pill.textContent.trim());
    });
    await page.click('#start-essay-btn');
    await page.fill('#essay-input', 'This is a sufficiently long essay response about technology and education. It contains several sentences so the archive and asynchronous scoring queue can be exercised safely.');
    await page.click('#essay-submit-btn');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#essay-step-results')).display !== 'none', { timeout: 30000 });
    await page.click('#essay-local-ai-score-btn');
    await page.waitForFunction(() => document.querySelector('#essay-local-ai-score-status')?.textContent.includes('Queued for local AI scoring'));
    callablePayload = await page.evaluate(() => ({ name: window.__callableName, payload: window.__callablePayload }));
    assert.equal(callablePayload.name, 'submitEssayDeepAi');
    assert.deepEqual(callablePayload.payload, { attemptId: 'browser-essay-attempt-001' });
    assert.deepEqual(pageErrors, []);
    console.log('essay-ai queue browser check passed');
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
