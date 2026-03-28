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
    const page = await browser.newPage();

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.switchToMode === 'function', { timeout: 30000 });

    await page.evaluate(async () => {
      if (window.DifficultyManager?.globalSettings) {
        window.DifficultyManager.setAutoAdjustEnabled(false);
      }
      await window.switchToMode('extended');
      const manualRadio = document.getElementById('manual-extended');
      if (manualRadio) {
        manualRadio.checked = true;
        manualRadio.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    await page.waitForFunction(() => {
      const select = document.getElementById('question-select-extended');
      const button = document.getElementById('recommended-btn-extended');
      return !!(select && select.options && select.options.length > 1 && button && !button.disabled);
    }, { timeout: 120000 });

    const manualSelection = await page.evaluate(() => {
      const select = document.getElementById('question-select-extended');
      if (!select || !select.options || select.options.length < 2) {
        return { nextValue: null };
      }

      const nextValue = String(select.options[1].value);
      select.value = nextValue;
      select.dispatchEvent(new Event('change'));
      return { nextValue };
    });

    assert.ok(manualSelection.nextValue, 'expected a second extended option');

    await page.waitForFunction((expectedValue) => {
      const current = document.getElementById('current-question-id-extended');
      return current && String(current.textContent || '').trim() === String(expectedValue);
    }, manualSelection.nextValue, { timeout: 30000 });
    console.log('extended manual selection sync regression test passed');

    const recommendationTarget = await page.evaluate(() => {
      const select = document.getElementById('question-select-extended');
      return select ? String(select.value || '') : '';
    });

    await page.evaluate(() => {
      document.getElementById('recommended-btn-extended')?.click();
    });

    await page.waitForFunction((previousValue) => {
      const select = document.getElementById('question-select-extended');
      const current = document.getElementById('current-question-id-extended');
      if (!select || !current) return false;
      const selectedValue = String(select.value || '');
      const displayedValue = String(current.textContent || '').trim();
      return selectedValue !== String(previousValue) && displayedValue === selectedValue;
    }, recommendationTarget, { timeout: 30000 });
    console.log('extended recommendation sync regression test passed');
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
