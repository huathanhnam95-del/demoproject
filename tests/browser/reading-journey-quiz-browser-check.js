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
      <title>Reading Journey Quiz Harness</title>
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
  app.get('/readingjourney-test', (req, res) => {
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

const setupPayload = {
  success: true,
  setup: {
    outlineId: 'outline-quiz',
    title: 'Lanterns at the Library',
    level: 'B1',
    topicTags: ['mystery', 'library'],
    characters: ['Maya'],
    beatOutline: [
      'Maya notices a strange light.',
      'Maya follows the clue.',
      'Maya solves the mystery.'
    ]
  },
  beat: {
    beatNumber: 1,
    path: [],
    formatVersion: 2,
    questionType: 'mcq',
    shouldEnd: false,
    segment: 'Maya arrived at the library just before sunset. A warm glimmer floated near the history shelves and made the dust look golden. She remembered the librarian warning her that old notes sometimes slipped out of books when the evening wind entered through the high windows.',
    highlights: ['glimmer', 'librarian'],
    choiceQuestion: {
      question: 'What should Maya do first?',
      options: [
        { id: 'investigate', text: 'Walk toward the glowing shelf.' },
        { id: 'ask', text: 'Call the librarian immediately.' },
        { id: 'wait', text: 'Ignore it and keep studying.' }
      ]
    },
    icon: '📚'
  }
};

const endingBeatPayload = {
  success: true,
  beat: {
    beatNumber: 6,
    path: ['investigate'],
    formatVersion: 2,
    questionType: 'end',
    shouldEnd: true,
    segment: 'Maya discovered that a brass lantern hidden behind an atlas had been reflecting the sunset through a cracked pane. Inside the atlas, she found a thank-you note from a former student who had once felt lonely in the library but learned to love reading there.',
    endWrap: 'She left smiling, certain that small acts of kindness can keep glowing long after a story seems finished.',
    highlights: ['thank-you note', 'kindness'],
    icon: '🏁'
  }
};

const quizPayload = {
  quizId: 'quiz-123',
  outlineId: 'outline-quiz',
  level: 'B1',
  recommendedReviewCount: 1,
  storySnapshot: {
    title: 'Lanterns at the Library',
    paragraphs: [
      {
        id: 'p1',
        text: 'Maya arrived at the library just before sunset. A warm glimmer floated near the history shelves and made the dust look golden.',
        sentences: [
          { id: 'p1s1', text: 'Maya arrived at the library just before sunset.' },
          { id: 'p1s2', text: 'A warm glimmer floated near the history shelves and made the dust look golden.' }
        ]
      },
      {
        id: 'p2',
        text: 'Inside the atlas, she found a thank-you note from a former student who had once felt lonely in the library but learned to love reading there.',
        sentences: [
          { id: 'p2s1', text: 'Inside the atlas, she found a thank-you note from a former student.' },
          { id: 'p2s2', text: 'The student had once felt lonely in the library but learned to love reading there.' }
        ]
      }
    ]
  },
  questions: [
    {
      id: 'q1',
      type: 'click_word_meaning',
      skill: 'vocabulary',
      prompt: 'Click the word that means "a soft shining light".',
      explanation: '"Glimmer" means a faint or gentle light.',
      target: {
        word: 'glimmer',
        paragraphIndex: 0,
        acceptedSurfaceForms: ['glimmer', 'glimmered']
      }
    },
    {
      id: 'q2',
      type: 'mcq_main_idea',
      skill: 'comprehension',
      prompt: 'What is the main idea of the story?',
      explanation: 'The story shows how a small mystery reveals the lasting effect of kindness in a familiar place.',
      options: [
        { id: 'a', text: 'Libraries should close before sunset.' },
        { id: 'b', text: 'A small mystery leads Maya to a message about kindness.' },
        { id: 'c', text: 'Maya wants to become the next librarian.' },
        { id: 'd', text: 'Old books are too dusty to read.' }
      ],
      correctOptionId: 'b'
    }
  ]
};

async function fullyRevealBeat(page) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const beatReady = await page.evaluate(() => {
      const choiceWrap = document.getElementById('rj-choice-wrap');
      const prodWrap = document.getElementById('rj-prod-wrap');
      const button = document.getElementById('rj-continue-btn');
      const choiceVisible = Boolean(choiceWrap && getComputedStyle(choiceWrap).display !== 'none');
      const prodVisible = Boolean(prodWrap && getComputedStyle(prodWrap).display !== 'none');
      const finishVisible = Boolean(button && /finish journey/i.test(button.textContent || ''));
      return choiceVisible || prodVisible || finishVisible;
    });

    if (beatReady) {
      return;
    }

    await page.click('#rj-continue-btn');
    await page.waitForTimeout(120);
  }
}

(async () => {
  const { server, origin } = await startHarnessServer();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }
  });
  const page = await context.newPage();
  const errors = [];
  let advanceCalls = 0;

  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

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
    advanceCalls += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(endingBeatPayload)
    });
  });

  await page.route('**/api/reading-journey/quiz', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(quizPayload)
    });
  });

  try {
    console.log(`Navigating to ${origin}/readingjourney-test`);
    await page.goto(`${origin}/readingjourney-test`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#rj-start-btn');

    await page.fill('#rj-interests', 'mystery, library');
    await page.click('#rj-start-btn');

    await page.waitForSelector('#rj-story[style*="display: block"], #rj-story:not([style*="display:none"])');
    await fullyRevealBeat(page);
    await page.waitForSelector('.rj-choice-card');
    await page.click('.rj-choice-card');
    await page.click('#rj-continue-btn');

    assert.strictEqual(advanceCalls, 1, 'Expected to advance to the ending beat once');
    await page.waitForFunction(() => {
      const meta = document.getElementById('rj-story-meta');
      return meta && /final scene/i.test(meta.textContent || '');
    });

    await fullyRevealBeat(page);
    await page.click('#rj-continue-btn');

    await page.waitForSelector('#rj-complete button');
    const launchQuizButton = page.getByRole('button', { name: /check understanding/i });
    const skipButton = page.getByRole('button', { name: /skip for now/i });
    assert.strictEqual(await launchQuizButton.isVisible(), true, 'Expected quiz launch button on completion screen');
    assert.strictEqual(await skipButton.isVisible(), true, 'Expected skip button on completion screen');

    await launchQuizButton.click();

    await page.waitForFunction(() => {
      const progress = document.querySelector('.rj-quiz__progress');
      return progress && /question 1 of 2/i.test(progress.textContent || '');
    });

    const statusRegion = page.locator('#rj-quiz-status');
    assert.strictEqual(await statusRegion.isVisible(), true, 'Expected quiz aria-live region');

    const nextButton = page.getByRole('button', { name: /^next$/i });
    assert.strictEqual(await nextButton.isVisible(), true, 'Expected the primary quiz action to stay visible on a mobile viewport');

    await page.getByRole('button', { name: /^maya$/i }).click();
    await page.waitForFunction(() => {
      const status = document.getElementById('rj-quiz-status');
      return status && /highlighted paragraph/i.test(status.textContent || '');
    });

    const hintedParagraphCount = await page.locator('.rj-quiz-passage__paragraph--hint').count();
    assert.ok(hintedParagraphCount >= 1, 'Expected the correct paragraph to be highlighted after a wrong vocab click');

    await page.getByRole('button', { name: /^glimmer$/i }).click();
    await page.waitForFunction(() => {
      const status = document.getElementById('rj-quiz-status');
      return status && /^correct/i.test((status.textContent || '').trim());
    });

    await nextButton.click();
    await page.getByRole('radio', { name: /a small mystery leads maya to a message about kindness/i }).check();
    const submitButton = page.getByRole('button', { name: /submit/i });
    assert.strictEqual(await submitButton.isVisible(), true, 'Expected submit button to be visible on the final question');
    await submitButton.click();

    await page.waitForFunction(() => {
      const heading = document.querySelector('.rj-quiz-results h2');
      return heading && /understanding check complete/i.test(heading.textContent || '');
    });

    const screenshotPath = path.join('tmp', 'reading-journey-quiz-browser-check.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`Screenshot saved to ${screenshotPath}`);

    if (errors.length) {
      throw new Error(`Browser errors detected:\n${errors.join('\n')}`);
    }

    console.log('Reading Journey quiz browser check passed.');
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
