/* eslint-disable no-console */
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
  const app = express();
  app.get('/dashboard-workspace.js', (_req, res) => {
    res.sendFile(path.join(process.cwd(), 'public', 'js', 'crm', 'dashboard-workspace.js'));
  });
  app.get('/', (_req, res) => {
    res.type('html').send(`<!doctype html>
      <button id="preview">Preview unscored</button>
      <button id="trigger">Score all unscored</button>
      <div id="status" role="status"></div>
      <script src="/dashboard-workspace.js"></script>
      <script>
        const calls = [];
        const apiFetchJson = async (url, options = {}) => {
          calls.push({ url, options });
          if (url.endsWith('/status')) return {
            worker: { ready: true, lastHeartbeatAt: new Date().toISOString(), ollamaReachable: true, modelsReady: true },
            pendingCount: 0
          };
          if (url.endsWith('/preview')) return { jobId: 'preview-1' };
          if (url.endsWith('/trigger')) return { jobId: 'enqueue-1' };
          if (url.endsWith('/preview-1')) return { jobId: 'preview-1', mode: 'preview', status: 'completed', candidateCount: 2, invalidCount: 0 };
          if (url.endsWith('/enqueue-1')) return { jobId: 'enqueue-1', mode: 'enqueue', status: 'completed', enqueuedCount: 2, skippedCount: 0 };
          throw new Error('Unexpected API path: ' + url);
        };
        window.controller = window.CrmDashboardWorkspace.createController({
          elements: {
            btnEssayAiPreview: document.getElementById('preview'),
            btnEssayAiTrigger: document.getElementById('trigger'),
            essayAiAdminStatus: document.getElementById('status')
          },
          apiFetchJson,
          showToast: () => {},
          getAdminCapabilities: () => ({})
        });
        window.calls = calls;
        window.controller.activate();
      </script>`);
  });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('dialog', (dialog) => dialog.accept());
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'networkidle' });
    await page.click('#preview');
    await page.waitForFunction(() => document.getElementById('status').textContent.includes('2 unscored'));
    assert.equal(await page.$eval('#trigger', (button) => button.disabled), false);
    await page.click('#trigger');
    await page.waitForFunction(() => document.getElementById('status').textContent.includes('2 queued'));
    const calls = await page.evaluate(() => window.calls.map((call) => call.url));
    assert.ok(calls.some((url) => url.endsWith('/preview')));
    assert.ok(calls.some((url) => url.endsWith('/trigger')));
    assert.deepEqual(pageErrors, []);
    console.log('crm essay-ai trigger browser check passed');
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
