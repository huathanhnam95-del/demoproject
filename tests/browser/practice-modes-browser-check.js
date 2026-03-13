const assert = require('assert');
const express = require('express');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const CORRUPTION_MARKERS = ['Ã°', 'Ã¢', 'â†', 'âœ', 'ðŸ'];

function startHarnessServer() {
  const app = express();
  const publicDir = path.join(__dirname, '..', '..', 'public');

  app.use(express.static(publicDir));
  app.get('/', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        server,
        origin: `http://127.0.0.1:${address.port}`
      });
    });
  });
}

function containsCorruption(text) {
  return CORRUPTION_MARKERS.some((marker) => text.includes(marker));
}

async function checkMode(page, mode) {
  const expectations = {
    type: { difficulty: true, status: true },
    speak: { difficulty: true, status: true },
    extended: { difficulty: true, status: false }
  };

  await page.evaluate((targetMode) => window.switchToMode(targetMode), mode);
  await page.waitForTimeout(300);

  const result = await page.evaluate((targetMode) => {
    const modePanel = document.getElementById(`mode-${targetMode}`);
    const difficultyContainer = document.getElementById(`difficulty-filter-container-${targetMode}`);
    const statusContainer = document.getElementById(`status-filter-container-${targetMode}`);
    const questionSelect = document.getElementById(`question-select-${targetMode}`);
    const backButton = document.getElementById(`back-btn-${targetMode}`);
    const nextButton = document.getElementById(`next-btn-${targetMode}`);
    const breadcrumb = modePanel?.querySelector('.breadcrumb-back')?.textContent?.trim() || '';
    const text = modePanel?.innerText || '';

    return {
      hasVisibleMode: Boolean(modePanel && getComputedStyle(modePanel).display !== 'none'),
      hasDifficultyFilter: Boolean(difficultyContainer),
      hasStatusFilter: Boolean(statusContainer),
      hasQuestionSelect: Boolean(questionSelect),
      hasBackButton: Boolean(backButton),
      hasNextButton: Boolean(nextButton),
      breadcrumb,
      text
    };
  }, mode);

  assert.strictEqual(result.hasVisibleMode, true, `${mode} mode should be visible after switchToMode`);
  assert.strictEqual(
    result.hasStatusFilter,
    expectations[mode].status,
    `${mode} mode should match its status-filter contract`
  );
  assert.strictEqual(
    result.hasDifficultyFilter,
    expectations[mode].difficulty,
    `${mode} mode should match its difficulty-filter contract`
  );
  assert.strictEqual(result.hasQuestionSelect, true, `${mode} mode should expose its question selector`);
  assert.strictEqual(result.hasBackButton, true, `${mode} mode should expose its previous button`);
  assert.strictEqual(result.hasNextButton, true, `${mode} mode should expose its next button`);
  assert.strictEqual(containsCorruption(result.text), false, `${mode} mode should not render corrupted text`);
  assert.match(result.breadcrumb, /Dashboard/i, `${mode} mode should render the dashboard breadcrumb`);
}

(async () => {
  const { server, origin } = await startHarnessServer();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
  const pageErrors = [];
  const consoleWarnings = [];

  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'warning' || message.type() === 'error') {
      consoleWarnings.push(`${message.type()}: ${message.text()}`);
    }
  });

  try {
    const [scriptSource, htmlSource] = await Promise.all([
      fetch(`${origin}/script.js`).then((res) => res.text()),
      fetch(`${origin}/index.html`).then((res) => res.text())
    ]);

    assert.strictEqual(containsCorruption(scriptSource), false, 'public/script.js should not contain corrupted text markers');
    assert.strictEqual(containsCorruption(htmlSource), false, 'public/index.html should not contain corrupted text markers');

    await page.goto(`${origin}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    assert.deepStrictEqual(pageErrors, [], `Expected no page errors, got: ${pageErrors.join(' | ')}`);
    assert.strictEqual(
      consoleWarnings.some((warning) => warning.includes('Difficulty filter elements not found')),
      false,
      `Expected no missing difficulty filter warnings, got: ${consoleWarnings.join(' | ')}`
    );

    for (const mode of ['type', 'speak', 'extended']) {
      // eslint-disable-next-line no-await-in-loop
      await checkMode(page, mode);
    }

    await page.screenshot({ path: 'tmp/practice-modes-browser-check.png', fullPage: true });
    console.log('Practice modes browser verification complete.');
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
