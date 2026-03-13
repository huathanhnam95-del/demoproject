/* eslint-disable no-console */
const assert = require('assert');
const { spawn } = require('child_process');
const net = require('net');
const { chromium } = require('playwright');

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close(() => {
        if (typeof port === 'number') {
          resolve(port);
          return;
        }
        reject(new Error('Failed to allocate free port'));
      });
    });
    server.on('error', reject);
  });
}

async function waitForServer(url, timeoutMs = 45000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (_) {
      // Intentional retry.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Server did not become ready: ${url}`);
}

async function runScenario(page, mode, config) {
  const {
    switchExpr,
    questionSelectId,
    recommendationButtonId,
    currentQuestionIdId,
    audioSelector,
    summaryId
  } = config;

  const result = await page.evaluate(async ({ mode, switchExpr, questionSelectId, recommendationButtonId, currentQuestionIdId, audioSelector, summaryId }) => {
    if (window.DifficultyManager?.globalSettings) {
      window.DifficultyManager.globalSettings.autoAdjustEnabled = false;
      window.DifficultyManager.globalSettings.manualLevel = 2;
    }

    if (switchExpr === 'switchToMode') {
      await window.switchToMode(mode);
    } else if (switchExpr === 'clickTab') {
      document.getElementById('tab-extended')?.click();
      await new Promise((resolve) => setTimeout(resolve, 80));
    }

    const select = document.getElementById(questionSelectId);
    const smartJumpBtn = document.getElementById(recommendationButtonId);
    const summary = document.getElementById(summaryId);
    if (!select || !smartJumpBtn) {
      throw new Error(`Missing controls for mode ${mode}`);
    }

    smartJumpBtn.disabled = false;
    if (summary) {
      summary.textContent = 'Recommended next: #2 - level + continuity fit';
      summary.classList.remove('is-hidden');
    }

    select.value = '1';
    select.dispatchEvent(new Event('change'));
    await new Promise((resolve) => setTimeout(resolve, 10));

    smartJumpBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 1400));

    return {
      currentId: document.getElementById(currentQuestionIdId)?.textContent?.trim() || '',
      selectValue: select.value,
      sourceSrc: document.querySelector(audioSelector)?.getAttribute('src') || '',
      summaryText: summary?.textContent?.trim() || ''
    };
  }, { mode, ...config });

  assert.equal(result.currentId, '2', `${mode} current question id should be 2 after Smart Jump`);
  assert.equal(result.selectValue, '2', `${mode} select value should stay on 2 after Smart Jump`);
  assert.match(result.sourceSrc, /\/2\.(mp3|wav|m4a|aac|ogg)(\?|$)/, `${mode} audio source should point to question 2`);
  return result;
}

async function run() {
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let serverLogs = '';
  server.stdout.on('data', (chunk) => { serverLogs += String(chunk); });
  server.stderr.on('data', (chunk) => { serverLogs += String(chunk); });

  let browser;
  try {
    await waitForServer(`${baseUrl}/api/health`);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    const sharedItems = [
      { id: 1, audioFile: '1.mp3', correctSentence: 'climate birds migration study', transcript: 'climate birds migration study', level: 1, category: 'general' },
      { id: 2, audioFile: '2.mp3', correctSentence: 'climate birds migration pattern', transcript: 'climate birds migration pattern', level: 1, category: 'general' },
      { id: 3, audioFile: '3.mp3', correctSentence: 'stone bridge river valley', transcript: 'stone bridge river valley', level: 3, category: 'general' }
    ];

    await page.route('**/database/type/index.json*', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: sharedItems }) });
    });
    await page.route('**/database/speak/index.json*', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: sharedItems }) });
    });
    await page.route('**/database/extended/index.json*', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: sharedItems }) });
    });

    for (const mode of ['type', 'speak', 'extended']) {
      await page.route(`**/database/${mode}/audio/*`, async (route) => {
        const request = route.request();
        const match = request.url().match(/\/audio\/(\d+)\./);
        const questionId = match ? match[1] : '0';
        const delayMs = questionId === '1' ? 900 : 50;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        await route.fulfill({
          status: 200,
          headers: { 'content-type': 'audio/mpeg' },
          body: request.method() === 'HEAD' ? '' : `audio-${mode}-${questionId}`
        });
      });
    }

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.switchToMode === 'function', { timeout: 30000 });
    await page.waitForTimeout(400);

    const results = {};
    results.type = await runScenario(page, 'type', {
      switchExpr: 'switchToMode',
      questionSelectId: 'question-select-type',
      recommendationButtonId: 'recommended-btn-type',
      currentQuestionIdId: 'current-question-id-type',
      audioSelector: '#audio source',
      summaryId: 'recommendation-summary-type'
    });

    results.speak = await runScenario(page, 'speak', {
      switchExpr: 'switchToMode',
      questionSelectId: 'question-select-speak',
      recommendationButtonId: 'recommended-btn-speak',
      currentQuestionIdId: 'current-question-id-speak',
      audioSelector: '#audio source',
      summaryId: 'recommendation-summary-speak'
    });

    results.extended = await runScenario(page, 'extended', {
      switchExpr: 'clickTab',
      questionSelectId: 'question-select-extended',
      recommendationButtonId: 'recommended-btn-extended',
      currentQuestionIdId: 'current-question-id-extended',
      audioSelector: '#audio-extended source',
      summaryId: 'recommendation-summary-extended'
    });

    console.log(JSON.stringify(results, null, 2));
  } catch (error) {
    const tail = serverLogs.slice(-10000);
    if (tail) {
      console.error('SERVER_LOG_TAIL_START');
      console.error(tail);
      console.error('SERVER_LOG_TAIL_END');
    }
    throw error;
  } finally {
    try {
      if (browser) await browser.close();
    } catch (_) {
      // Intentional cleanup best effort.
    }
    try {
      server.kill();
    } catch (_) {
      // Intentional cleanup best effort.
    }
  }
}

run().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
