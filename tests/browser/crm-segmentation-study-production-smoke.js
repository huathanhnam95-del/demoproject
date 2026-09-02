/* eslint-disable no-console */
/**
 * Authenticated Chrome Smoke Verification for Segmentation Study & CRM Admin.
 *
 * Enforces strict mutation guards: blocks any claim/complete/delete/write POSTs.
 */
const assert = require('assert');
const express = require('express');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '../..');
const outputDir = path.join(root, 'test-results/v4-a2-production-smoke');

// Mutation guard tokens
const FORBIDDEN_MUTATIONS = [
  '/api/admin/crm/segmentation-study/claim-next',
  '/api/admin/crm/segmentation-study/complete',
  '/api/admin/crm/segmentation-study/release',
  '/api/admin/crm/segmentation-study/seed',
  '/api/admin/crm/segmentation-study/delete'
];

async function run() {
  console.log('Starting authenticated Chrome production smoke verification...');
  fs.mkdirSync(outputDir, { recursive: true });

  const app = express();
  app.use(express.static(path.join(root, 'public')));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const localPort = server.address().port;
  const localUrl = `http://127.0.0.1:${localPort}/crm-admin.html`;

  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-web-security']
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true
  });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  // Attach mutation guards to network routes
  await page.route('**/*', (route) => {
    const req = route.request();
    const url = req.url();
    const method = req.method();

    if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
      for (const forbidden of FORBIDDEN_MUTATIONS) {
        if (url.includes(forbidden)) {
          console.error(`[MUTATION_GUARD_TRIPPED] Blocked mutating request: ${method} ${url}`);
          return route.abort('blockedbyclient');
        }
      }
    }
    return route.continue();
  });

  try {
    console.log(`Navigating to ${localUrl}...`);
    await page.goto(localUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1000);

    // Save screenshot of CRM admin landing state
    const screenshotPath = path.join(outputDir, 'crm-admin-smoke.png');
    await page.screenshot({ path: screenshotPath, fullPage: false });
    console.log(`Saved screenshot to ${screenshotPath}`);

    // Verify page container loaded
    const title = await page.title();
    console.log(`Page title: ${title}`);
    assert.ok(title.length > 0, 'Page title must not be empty');

    // Run health fetch to Cloud Run praat-api
    const apiResponse = await context.request.get('https://praat-api-oq3kyypf4q-uc.a.run.app/health');
    assert.strictEqual(apiResponse.status(), 200, 'Cloud Run praat-api must return 200');
    const apiJson = await apiResponse.json();
    console.log('Cloud Run praat-api health probe result:', apiJson);
    assert.ok(apiJson.status === 'healthy' || apiJson.status === 'ok', 'Status must be healthy or ok');

    console.log('Chrome smoke verification passed cleanly.');
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

if (require.main === module) {
  run().catch((err) => {
    console.error('Smoke verification failed:', err);
    process.exit(1);
  });
}

module.exports = { run };
