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
      <title>Reading Journey Choice Contract Harness</title>
      <link rel="stylesheet" href="/style.css">
    </head>
    <body>
      <div id="readingjourney-root"></div>
      <script type="module">
        import '/js/reading-journey.js';
        window.addEventListener('DOMContentLoaded', () => {
          window.initReadingJourney(document.getElementById('readingjourney-root'));
        });
      </script>
    </body>
  </html>`;
}

function startHarnessServer() {
  const app = express();
  const publicDir = path.join(__dirname, '..', '..', 'public');

  app.use(express.static(publicDir));
  app.get('/readingjourney-choice-test', (_req, res) => {
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

async function fullyRevealBeat(page) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const choiceVisible = await page.evaluate(() => {
      const choiceWrap = document.getElementById('rj-choice-wrap');
      return Boolean(choiceWrap && getComputedStyle(choiceWrap).display !== 'none');
    });

    if (choiceVisible) return;

    await page.click('#rj-continue-btn');
    await page.waitForTimeout(120);
  }

  throw new Error('Choice UI did not become visible.');
}

const setupPayload = {
  success: true,
  setup: {
    outlineId: 'outline-contract',
    title: 'A Trip to Remember',
    level: 'A2',
    topicTags: ['culture', 'education', 'health', 'language_learning', 'travel']
  },
  beat: {
    beatNumber: 1,
    path: [],
    formatVersion: 2,
    questionType: 'mcq',
    shouldEnd: false,
    content: 'Mai sat in the community center, the afternoon heat making her feel sleepy. Mr. Long played an English listening exercise. Mai tried to focus, but the words sounded fast and unclear. Her heart sank. She felt frustrated and discouraged, finding it very hard to understand anything! She gripped her pen tightly.',
    segment: 'Mai stepped off the bus and walked toward a community learning center in early in the morning. The sky was blue, but the front door was locked with a heavy chain. A folded map lay on the ground near the entrance. Mai picked it up and noticed a red circle marking a spot behind the building.',
    choices: [
      { id: 'next', text: 'Continue...', action: 'next' }
    ],
    choiceQuestion: {
      question: 'What should Mai do first?',
      options: [
        { id: 'investigate', label: 'Look around the area carefully for small helpful clues.' },
        { id: 'ask', label: 'Find a friendly local person and ask for help.' },
        { id: 'wait', label: 'Stay quiet and watch to see what happens next.' }
      ]
    }
  }
};

const nextBeatPayload = {
  success: true,
  beat: {
    beatNumber: 2,
    path: ['investigate'],
    formatVersion: 2,
    questionType: 'open',
    shouldEnd: false,
    segment: 'Mai walked behind the building and found a small wooden door hidden by plants. Inside, there were old posters, stacks of notebooks, and a faded sign about free English lessons for children from the neighborhood.',
    productionPrompt: {
      question: 'Write one or two sentences about what Mai should do next.'
    }
  }
};

(async () => {
  const { server, origin } = await startHarnessServer();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 }
  });

  let capturedAdvanceBody = null;

  await page.route('**/api/reading-journey/outlines', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, outlines: [] })
    });
  });

  await page.route('**/api/reading-journey/setup', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(setupPayload)
    });
  });

  await page.route('**/api/reading-journey/advance', async (route) => {
    capturedAdvanceBody = JSON.parse(route.request().postData() || '{}');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(nextBeatPayload)
    });
  });

  try {
    await page.goto(`${origin}/readingjourney-choice-test`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#rj-start-btn');
    await page.fill('#rj-interests', 'culture, education, health, language learning, travel');
    await page.selectOption('#rj-level', 'A2');
    await page.click('#rj-start-btn');

    await page.waitForSelector('#rj-story-title');
    await fullyRevealBeat(page);
    await page.locator('.rj-choice-card').first().click();
    await page.click('#rj-continue-btn');

    assert.ok(capturedAdvanceBody, 'Expected an advance request to be sent');
    assert.strictEqual(
      capturedAdvanceBody.choiceId,
      'investigate',
      'Reading Journey should send the canonical choiceQuestion option id, not the legacy `choices` id'
    );

    console.log('Reading Journey choice contract browser check passed.');
  } finally {
    await browser.close();
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
