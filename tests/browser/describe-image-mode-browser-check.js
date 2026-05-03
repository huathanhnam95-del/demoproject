/* eslint-disable no-console */
const assert = require('assert');
const express = require('express');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

function buildHarnessHtml() {
  return `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Describe Image Mode Harness</title>
      <link rel="stylesheet" href="/style.css">
      <style>
        .di-progress-step { display: inline-block; }
      </style>
    </head>
    <body>
      <div id="mode-describe-image" class="mode-panel" style="display:block;">
        <div class="question-selector">
          <span id="current-question-id-di">1</span>
          <button id="back-btn-di" type="button">Back</button>
          <select id="question-select-di"><option value="0">Loading...</option></select>
          <button id="next-btn-di" type="button">Next</button>
        </div>
        <div class="question-total">
          <span id="total-questions-di">0</span>
        </div>

        <div id="di-image-preview" class="di-image-section di-image-preview-section">
          <div class="di-image-container">
            <img id="di-preview-img" class="di-image" alt="Preview" />
          </div>
        </div>

        <button id="play-di-btn" type="button">Play</button>

        <div id="di-practice-area" style="display:none;">
          <div id="di-step-progress">
            <div class="di-progress-step"></div>
            <div class="di-progress-step"></div>
            <div class="di-progress-step"></div>
          </div>

          <div id="di-step-prepare" style="display:none;">
            <div class="di-image-section">
              <div id="di-image-container" class="di-image-container">
                <img id="di-image" class="di-image" alt="Describe" />
              </div>
            </div>
            <div id="di-prep-timer"></div>
            <div id="di-prep-bar-fill"></div>
          </div>

          <div id="di-step-record" style="display:none;">
            <div class="di-image-section di-image-section--compact">
              <div class="di-image-container di-image-container--small">
                <img id="di-image-record" class="di-image" alt="Record" />
              </div>
            </div>
            <div id="di-record-timer"></div>
            <div id="di-record-bar-fill"></div>
            <div id="di-record-status"></div>
            <div id="di-record-status-text"></div>
            <button id="di-stop-btn" type="button">Stop</button>
          </div>

          <div id="di-step-review" style="display:none;">
            <audio id="di-recording-playback"></audio>
            <div id="di-transcript"></div>
            <button id="di-retry-btn" type="button">Retry</button>
            <button id="di-submit-btn" type="button">Submit</button>
          </div>

          <div id="di-step-results" style="display:none;">
            <div id="di-sample-answer"></div>
            <ul id="di-key-points"></ul>
            <button id="di-ai-btn" type="button">AI</button>
            <button id="di-results-retry-btn" type="button">Retry</button>
            <button id="di-next-question-btn" type="button">Next</button>
          </div>
        </div>

        <div id="di-zoom-overlay" style="display:none;">
          <div class="di-zoom-backdrop"></div>
          <img id="di-zoom-image" alt="Zoomed" />
          <button id="di-zoom-close" type="button">Close</button>
        </div>
      </div>

      <script src="/describe-image-mode.js"></script>
    </body>
  </html>`;
}

function startServer() {
  const app = express();
  const publicDir = path.join(__dirname, '..', '..', 'public');

  app.use(express.static(publicDir));
  app.get('/describe-image-harness', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.type('html').send(buildHarnessHtml());
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

async function run() {
  const { server, origin } = await startServer();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  try {
    await page.goto(`${origin}/describe-image-harness`);
    await page.waitForFunction(() => Boolean(window.DescribeImageMode));

    // Regression check: reset() must not auto-show the review step later.
    await page.evaluate(() => {
      window.DescribeImageMode.reset();
    });

    await page.waitForTimeout(600);

    const state = await page.evaluate(() => {
      const review = document.getElementById('di-step-review');
      const practiceArea = document.getElementById('di-practice-area');
      return {
        reviewInline: review ? review.style.display : null,
        reviewComputed: review ? getComputedStyle(review).display : null,
        practiceInline: practiceArea ? practiceArea.style.display : null,
        practiceComputed: practiceArea ? getComputedStyle(practiceArea).display : null,
        currentStep: window.DescribeImageMode ? window.DescribeImageMode.__debug?.currentStep : null
      };
    });

    assert.ok(state.reviewInline !== null, 'harness should expose di-step-review element');
    assert.strictEqual(state.reviewComputed, 'none', 'reset() should not reveal the review step');
    assert.strictEqual(state.practiceComputed, 'none', 'reset() should keep the practice area hidden');

    // Regression check: show() must not force display:block, otherwise the prep/record grid breaks.
    await page.waitForFunction(() => {
      const total = document.getElementById('total-questions-di');
      return Boolean(total) && Number(total.textContent) > 0;
    });

    await page.click('#play-di-btn');

    await page.waitForFunction(() => {
      const step = document.getElementById('di-step-prepare');
      return Boolean(step) && getComputedStyle(step).display !== 'none';
    });

    const layout = await page.evaluate(() => {
      const step = document.getElementById('di-step-prepare');
      const container = document.getElementById('di-image-container');
      const image = document.getElementById('di-image');
      return {
        stepDisplay: step ? getComputedStyle(step).display : null,
        containerBorderTop: container ? getComputedStyle(container).borderTopWidth : null,
        containerRadius: container ? getComputedStyle(container).borderTopLeftRadius : null,
        imageMaxHeight: image ? getComputedStyle(image).maxHeight : null
      };
    });

    assert.strictEqual(layout.stepDisplay, 'grid', 'prep step should render as a grid (image left, timer right)');
    assert.strictEqual(layout.containerBorderTop, '0px', 'image container should not add a border');
    assert.strictEqual(layout.containerRadius, '0px', 'image container should not round corners');

    const maxHeight = Number.parseFloat(layout.imageMaxHeight) || 0;
    assert.ok(maxHeight > 560, `prep image should be scaled up (max-height=${layout.imageMaxHeight})`);

    await page.screenshot({ path: 'tmp/describe-image-mode-browser-check.png', fullPage: true });
    console.log('Describe Image mode browser verification complete.');
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
