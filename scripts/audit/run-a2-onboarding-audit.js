/**
 * BEL A2 (Vietnamese) PTE Onboarding + Full Journey Audit Runner
 *
 * Generates empirical artifacts (screenshots, videos, console logs) and a JSON run report.
 *
 * Usage:
 *   node scripts/audit/run-a2-onboarding-audit.js --base-url http://localhost:8443
 *
 * Notes:
 * - By default, this script will start the local server (node server.js) and stop it afterward.
 * - It avoids external AI calls by default (set --allow-ai-calls to enable).
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');
const { chromium } = require(path.resolve(__dirname, '../../node_modules/playwright'));

function parseArgs(argv) {
  const args = {
    baseUrl: 'http://localhost:8443',
    outputRoot: path.join('docs', 'audits', '2026-03-01-a2-vn-pte-onboarding', 'artifacts'),
    startServer: true,
    headed: false,
    allowAiCalls: false,
    fullOnly: false,
    assertP0: false,
    p0Only: false,
    recordVideo: false
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--base-url') {
      args.baseUrl = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--output-root') {
      args.outputRoot = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--no-server') {
      args.startServer = false;
      continue;
    }
    if (arg === '--headed') {
      args.headed = true;
      continue;
    }
    if (arg === '--allow-ai-calls') {
      args.allowAiCalls = true;
      continue;
    }
    if (arg === '--full-only') {
      args.fullOnly = true;
      continue;
    }
    if (arg === '--assert-p0') {
      args.assertP0 = true;
      continue;
    }
    if (arg === '--p0-only') {
      args.p0Only = true;
      continue;
    }
    if (arg === '--record-video') {
      args.recordVideo = true;
      continue;
    }
  }

  return args;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function sanitizeFilePart(value) {
  return String(value)
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 180);
}

function nowRunId() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function fetchJson(url, timeoutMs = 10_000) {
  const isHttps = url.startsWith('https://');
  const lib = isHttps ? https : http;
  return new Promise((resolve, reject) => {
    const requestOptions = { timeout: timeoutMs };
    if (isHttps) {
      // Local dev commonly uses a self-signed or locally-trusted cert.
      // For audit automation we allow localhost certs without failing the run.
      try {
        const hostname = new URL(url).hostname;
        if (hostname === 'localhost' || hostname === '127.0.0.1') {
          requestOptions.agent = new https.Agent({ rejectUnauthorized: false });
        }
      } catch {
        // ignore
      }
    }

    const req = lib.get(url, requestOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode || 0, data: parsed });
        } catch (err) {
          resolve({ status: res.statusCode || 0, data: null, raw: data });
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error(`Timeout fetching ${url}`));
    });
  });
}

async function waitForHealth(baseUrl, timeoutMs = 30_000) {
  const start = Date.now();
  const healthUrl = `${baseUrl.replace(/\/$/, '')}/api/health`;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const res = await fetchJson(healthUrl, 5_000);
      if (res.status === 200 && res.data && res.data.success === true) return true;
    } catch {
      // ignore and retry
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Server health check timed out: ${healthUrl}`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

function startLocalServer() {
  const child = spawn(process.execPath, ['server.js'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env }
  });

  const lines = [];
  child.stdout.on('data', (d) => lines.push(String(d)));
  child.stderr.on('data', (d) => lines.push(String(d)));

  return {
    child,
    getOutput: () => lines.join('')
  };
}

async function stopLocalServer(serverProc) {
  if (!serverProc || !serverProc.child || serverProc.child.killed) return;
  serverProc.child.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 500));
  if (!serverProc.child.killed) {
    serverProc.child.kill('SIGKILL');
  }
}

async function applyNetworkProfile(page, profile) {
  const session = await page.context().newCDPSession(page);
  await session.send('Network.enable');

  if (profile.id === 'offline') {
    await session.send('Network.emulateNetworkConditions', {
      offline: true,
      latency: 0,
      downloadThroughput: 0,
      uploadThroughput: 0
    });
    return;
  }

  if (profile.id === 'slow3g') {
    // Approximate Slow 3G: 500ms latency, 500 Kbps down/up
    const throughputBytesPerSec = Math.floor((500 * 1024) / 8);
    await session.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 500,
      downloadThroughput: throughputBytesPerSec,
      uploadThroughput: throughputBytesPerSec
    });
    return;
  }

  // fast/default
  await session.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1
  });
}

async function safeScreenshot(page, filePath, { fullPage = false, timeoutMs = 15_000 } = {}) {
  await page.screenshot({ path: filePath, fullPage, timeout: timeoutMs });
}

async function isVisible(page, selector, timeoutMs = 4_000) {
  const visiblePromise = page
    .evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      const style = window.getComputedStyle(el);
      const isShown = style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
      if (!isShown) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }, selector)
    .catch(() => false);

  return Promise.race([
    visiblePromise,
    new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs))
  ]);
}

async function dismissOverlays(page) {
  // Keep this conservative: only close known blocking overlays.
  const maxPasses = 6;
  for (let i = 0; i < maxPasses; i += 1) {
    let dismissed = false;

    if (await isVisible(page, '#tutorial-overlay')) {
      await page.locator('#tutorial-skip').click({ timeout: 3_000 }).catch(() => {});
      dismissed = true;
    }

    if (await isVisible(page, '#shop-alert-modal')) {
      await page.locator('#shop-alert-modal-ok').click({ timeout: 3_000 }).catch(() => {});
      dismissed = true;
    }

    if (await isVisible(page, '#shop-modal')) {
      await page.locator('#shop-close-btn').click({ timeout: 3_000 }).catch(() => {});
      dismissed = true;
    }

    if (await isVisible(page, '#mode-helper-modal')) {
      await page.locator('#mode-helper-close-btn').click({ timeout: 3_000 }).catch(() => {});
      dismissed = true;
    }

    if (await isVisible(page, '#auth-overlay')) {
      // No explicit close button; leave it alone (it might be the current UX).
    }

    if (await isVisible(page, '#grammar-warning-modal')) {
      await page.locator('#grammar-warning-ok-btn').click({ timeout: 3_000 }).catch(() => {});
      dismissed = true;
    }

    if (await isVisible(page, '#vocab-alert-modal')) {
      await page.locator('#vocab-alert-ok').click({ timeout: 3_000 }).catch(() => {});
      dismissed = true;
    }

    if (await isVisible(page, '#explanation-modal')) {
      await page.locator('#explanation-close-btn').click({ timeout: 3_000 }).catch(() => {});
      dismissed = true;
    }

    if (!dismissed) break;
    await page.waitForTimeout(250);
  }
}

async function clearBlockingPanels(page) {
  await Promise.race([
    page
      .evaluate(() => {
        const sidePanelIds = ['progress-panel-side', 'vocab-panel-side', 'account-panel-side'];
        for (const id of sidePanelIds) {
          const el = document.getElementById(id);
          if (el) el.classList.remove('expanded');
        }

        const panelOverlayIds = ['progress-panel-overlay', 'vocab-panel-overlay'];
        for (const id of panelOverlayIds) {
          const el = document.getElementById(id);
          if (el) {
            el.classList.remove('active');
            el.classList.remove('visible');
          }
        }

        const hiddenIds = [
          'vocab-add-modal',
          'vocab-manual-add-modal',
          'shop-alert-modal',
          'vocab-alert-modal',
          'entry-modal',
          'guest-toast',
          'progress-panel-overlay'
        ];
        for (const id of hiddenIds) {
          const el = document.getElementById(id);
          if (el) el.style.display = 'none';
        }

        const overlay = document.getElementById('vocab-panel-overlay');
        if (overlay) overlay.classList.remove('visible');
      })
      .catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, 5_000))
  ]);

  await page.waitForTimeout(200);
}

async function switchModeNonBlocking(page, mode, timeoutMs = 5_000) {
  const triggerPromise = page
    .evaluate((targetMode) => {
      try {
        if (typeof window.switchToMode !== 'function') return false;
        const result = window.switchToMode(targetMode);
        if (result && typeof result.catch === 'function') {
          result.catch(() => {});
        }
        return true;
      } catch {
        return false;
      }
    }, mode)
    .catch(() => false);

  await Promise.race([
    triggerPromise,
    new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs))
  ]);
}

async function togglePanelNonBlocking(page, panelId, timeoutMs = 5_000) {
  const triggerPromise = page
    .evaluate((targetPanelId) => {
      try {
        if (typeof window.toggleDashboardPanel !== 'function') return false;
        const result = window.toggleDashboardPanel(targetPanelId);
        if (result && typeof result.catch === 'function') {
          result.catch(() => {});
        }
        return true;
      } catch {
        return false;
      }
    }, panelId)
    .catch(() => false);

  await Promise.race([
    triggerPromise,
    new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs))
  ]);
}

async function bypassPreloaderIfPresent(page, screenshotPath = null) {
  const isPreloaderVisible = await isVisible(page, '#app-preloader');
  if (!isPreloaderVisible) return { visible: false, bypassed: false };

  if (screenshotPath) {
    // The preloader "failsafe" (certificate/security warning) appears after ~5s.
    // Wait briefly to capture the true final state before we bypass/dismiss.
    const start = Date.now();
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const hasBypass = await isVisible(page, '#preloader-bypass-btn');
      const hasDismiss = await isVisible(page, '#preloader-dismiss-btn');
      if (hasBypass || hasDismiss) break;
      if (Date.now() - start > 6_500) break;
      await page.waitForTimeout(250);
    }
    await safeScreenshot(page, screenshotPath);
  }

  const preloaderText = await page
    .locator('#preloader-text')
    .first()
    .innerText({ timeout: 1_000 })
    .catch(() => null);
  const scaryCopyDetected =
    /security|certificate|block(ed)?|enter app anyway/i.test(String(preloaderText || ''));

  const bypassBtn = page.locator('#preloader-bypass-btn');
  const dismissBtn = page.locator('#preloader-dismiss-btn');
  const retryBtn = page.locator('#preloader-retry-btn');
  const bypassVisible = await bypassBtn.count().then((c) => c > 0).catch(() => false);
  const dismissVisible = await dismissBtn.count().then((c) => c > 0).catch(() => false);
  const retryVisible = await retryBtn.count().then((c) => c > 0).catch(() => false);

  if (bypassVisible) {
    await bypassBtn.click({ timeout: 3_000 }).catch(() => {});
    await page.waitForTimeout(300);
    return {
      visible: true,
      bypassed: true,
      action: 'bypass',
      text: preloaderText,
      scaryCopyDetected,
      retryVisible,
      dismissVisible
    };
  }

  if (dismissVisible) {
    await dismissBtn.click({ timeout: 3_000 }).catch(() => {});
    await page.waitForTimeout(300);
    return {
      visible: true,
      bypassed: true,
      action: 'dismiss',
      text: preloaderText,
      scaryCopyDetected,
      retryVisible,
      dismissVisible
    };
  }

  return {
    visible: true,
    bypassed: false,
    text: preloaderText,
    scaryCopyDetected,
    retryVisible,
    dismissVisible
  };
}

function getScenarioStep(scenario, stepId) {
  if (!scenario || !Array.isArray(scenario.steps)) return null;
  return scenario.steps.find((step) => step && step.id === stepId) || null;
}

function collectP0AssertionFailures(report) {
  const failures = [];

  for (const scenario of report.scenarios || []) {
    const scenarioKey = `${scenario?.device?.id || 'unknown'}__${scenario?.network?.id || 'unknown'}`;
    const l1 = getScenarioStep(scenario, 'L1_landing_load');
    if (!l1 || l1.ok !== true) {
      failures.push({
        scenario: scenarioKey,
        step: 'L1_landing_load',
        reason: 'Landing P0 step did not complete successfully.'
      });
    } else {
      if (l1.hasA2HostileJargon) {
        failures.push({
          scenario: scenarioKey,
          step: 'L1_landing_load',
          reason: 'Landing hero still contains A2-hostile jargon.'
        });
      }
      if (!l1.hasPteTaskMapping) {
        failures.push({
          scenario: scenarioKey,
          step: 'L1_landing_load',
          reason: 'Landing hero does not clearly map to PTE tasks (WFD/RS/RL).'
        });
      }
    }

    const a1 = getScenarioStep(scenario, 'A1_click_demo_cta');
    if (!a1 || a1.ok !== true || !a1.preloader) {
      failures.push({
        scenario: scenarioKey,
        step: 'A1_click_demo_cta',
        reason: 'Activation preloader step did not produce valid preloader evidence.'
      });
    } else if (a1.preloader.visible) {
      if (a1.preloader.scaryCopyDetected) {
        failures.push({
          scenario: scenarioKey,
          step: 'A1_click_demo_cta',
          reason: 'Preloader shows fear-inducing security/certificate wording.'
        });
      }

      const networkId = scenario?.network?.id || '';
      if (networkId === 'slow3g' && a1.preloader.action === 'bypass') {
        failures.push({
          scenario: scenarioKey,
          step: 'A1_click_demo_cta',
          reason: 'Slow 3G flow still requires preloader bypass.'
        });
      }
    }

    const p2 = getScenarioStep(scenario, 'P2_type_assisted_attempt');
    if (!p2 || p2.ok !== true) {
      failures.push({
        scenario: scenarioKey,
        step: 'P2_type_assisted_attempt',
        reason: 'Guest hint P0 step did not complete successfully.'
      });
    } else {
      if (p2.hintBlockedByLogin === true) {
        failures.push({
          scenario: scenarioKey,
          step: 'P2_type_assisted_attempt',
          reason: 'Guest hint flow still blocked by login prompt.'
        });
      }
      if (typeof p2.hintDrawerVisible === 'undefined' || p2.hintDrawerVisible === null) {
        failures.push({
          scenario: scenarioKey,
          step: 'P2_type_assisted_attempt',
          reason: 'Guest hint evidence is incomplete (drawer visibility missing).'
        });
      }
    }

    const v1 = getScenarioStep(scenario, 'V1_vocab_manual_add');
    if (!v1 || v1.ok !== true) {
      failures.push({
        scenario: scenarioKey,
        step: 'V1_vocab_manual_add',
        reason: 'Guest vocabulary add P0 step did not complete successfully.'
      });
    } else if (v1.shopAlertVisible === true) {
      failures.push({
        scenario: scenarioKey,
        step: 'V1_vocab_manual_add',
        reason: 'Guest vocabulary manual add still blocked by login prompt.'
      });
    }

    const s1 = getScenarioStep(scenario, 'S1_start_srs_review');
    if (!s1 || s1.ok !== true) {
      failures.push({
        scenario: scenarioKey,
        step: 'S1_start_srs_review',
        reason: 'Guest SRS-start P0 step did not complete successfully.'
      });
    } else if (s1.srsPanelVisible === false || s1.srsPanelVisible === null) {
      failures.push({
        scenario: scenarioKey,
        step: 'S1_start_srs_review',
        reason: 'SRS review panel does not open from guest journey.'
      });
    } else {
      const dueText = String(s1.srsDueText || '').toLowerCase();
      if (dueText.includes('0 words due')) {
        failures.push({
          scenario: scenarioKey,
          step: 'S1_start_srs_review',
          reason: 'SRS shows "0 words due" while review panel is active.'
        });
      }
    }
  }

  return failures;
}

async function scrollIntoView(page, selector) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el) el.scrollIntoView({ behavior: 'instant', block: 'start' });
  }, selector);
  await page.waitForTimeout(400);
}

async function getText(page, selector) {
  try {
    return await page.locator(selector).first().innerText({ timeout: 2_000 });
  } catch {
    return null;
  }
}

async function resetToDemoGuest(page, appDemoUrl, networkId = 'fast', recoverPage = null) {
  const navTimeout = networkId === 'slow3g' ? 90_000 : 45_000;
  let currentPage = page;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await currentPage.goto(appDemoUrl, { waitUntil: 'domcontentloaded', timeout: navTimeout });
      await currentPage.waitForTimeout(1_000);
      await dismissOverlays(currentPage);
      await bypassPreloaderIfPresent(currentPage).catch(() => ({}));
      await dismissOverlays(currentPage);
      const entryModalVisible = await isVisible(currentPage, '#entry-modal');
      if (entryModalVisible) {
        await currentPage.locator('#guest-mode-btn').click({ timeout: 8_000 }).catch(() => {});
        await currentPage.waitForTimeout(700);
      }
      await clearBlockingPanels(currentPage);
      return currentPage;
    } catch (error) {
      const canRecover = typeof recoverPage === 'function' && attempt === 0;
      if (!canRecover) throw error;
      currentPage = await recoverPage();
    }
  }

  return currentPage;
}

async function primeOfflineShell(page, baseUrl) {
  const rootUrl = baseUrl.replace(/\/$/, '');
  await applyNetworkProfile(page, { id: 'fast' });
  await page.goto(`${rootUrl}/index.html`, { waitUntil: 'load', timeout: 45_000 }).catch(() => {});
  await page.waitForTimeout(800);

  await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return;
    try {
      await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    } catch {
      // ignore
    }
    try {
      await navigator.serviceWorker.ready;
    } catch {
      // ignore
    }
    const start = Date.now();
    while (!navigator.serviceWorker.controller && Date.now() - start < 4_000) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    try {
      await fetch('/offline.html', { cache: 'reload' });
    } catch {
      // ignore
    }
  }).catch(() => {});

  const hasController = await page
    .evaluate(() => Boolean(navigator.serviceWorker && navigator.serviceWorker.controller))
    .catch(() => false);
  if (!hasController) {
    await page.reload({ waitUntil: 'load', timeout: 45_000 }).catch(() => {});
  }
}

async function runScenario({
  browser,
  baseUrl,
  runId,
  device,
  network,
  outputDirs,
  recordVideo,
  allowAiCalls,
  flow = 'full',
  p0Only = false,
  sentenceMaps = null
}) {
  const scenarioId = `${device.id}__${network.id}`;
  const scenario = {
    id: scenarioId,
    device: device,
    network: network,
    steps: [],
    console: [],
    pageErrors: [],
    requestFailed: [],
    videoFiles: []
  };
  const progressLogPath = path.join(outputDirs.logs, `${runId}__${scenarioId}__progress.log.txt`);
  scenario.progressLog = path.relative(outputDirs.outputRoot, progressLogPath);
  try {
    fs.writeFileSync(progressLogPath, '', 'utf8');
  } catch {
    // ignore
  }
  const logProgress = (line) => {
    const entry = `${new Date().toISOString()} ${line}\n`;
    try {
      fs.appendFileSync(progressLogPath, entry, 'utf8');
    } catch {
      // ignore
    }
    // eslint-disable-next-line no-console
    console.log(line);
  };

  const contextOptions = {
    viewport: device.viewport,
    deviceScaleFactor: device.deviceScaleFactor,
    isMobile: device.isMobile,
    hasTouch: device.hasTouch,
    ignoreHTTPSErrors: true
  };
  if (recordVideo) {
    contextOptions.recordVideo = {
      dir: outputDirs.videosTmp,
      size: device.viewport
    };
  }

  let context = null;
  let page = null;

  const attachPageListeners = (targetPage) => {
    targetPage.on('console', (msg) => {
      scenario.console.push({
        type: msg.type(),
        text: msg.text()
      });
    });
    targetPage.on('pageerror', (err) => {
      scenario.pageErrors.push(String(err));
    });
    targetPage.on('requestfailed', (req) => {
      scenario.requestFailed.push({
        url: req.url(),
        failure: req.failure() ? req.failure().errorText : 'unknown'
      });
    });
  };

  const closeSession = async () => {
    if (page) {
      await Promise.race([
        page.close().catch(() => {}),
        new Promise((resolve) => setTimeout(resolve, 7_000))
      ]);
      page = null;
    }
    if (context) {
      await Promise.race([
        context.close().catch(() => {}),
        new Promise((resolve) => setTimeout(resolve, 7_000))
      ]);
      context = null;
    }
  };

  const openSession = async () => {
    context = await browser.newContext(contextOptions);
    page = await context.newPage();
    attachPageListeners(page);
    return page;
  };

  const recoverPage = async () => {
    await closeSession();
    const recoveredPage = await openSession();
    if (network.id === 'offline') {
      await primeOfflineShell(recoveredPage, baseUrl);
    }
    await applyNetworkProfile(recoveredPage, network);
    return recoveredPage;
  };

  await openSession();
  if (network.id === 'offline') {
    await primeOfflineShell(page, baseUrl);
  }
  await applyNetworkProfile(page, network);

  const defaultStepTimeoutMs = network.id === 'slow3g' ? 120_000 : 90_000;

  const step = async (stepId, action, timeoutMs = defaultStepTimeoutMs) => {
    if (scenario.abortRemainingSteps) {
      const skippedRecord = {
        id: stepId,
        startedAt: new Date().toISOString(),
        ok: false,
        skipped: true,
        skipReason: `Skipped due to earlier step timeout in ${scenario.abortStepId}`,
        durationMs: 0
      };
      scenario.steps.push(skippedRecord);
      logProgress(`[audit][${scenarioId}] << ${stepId} skipped`);
      return;
    }

    const startedAt = Date.now();
    const record = {
      id: stepId,
      startedAt: new Date(startedAt).toISOString(),
      ok: true
    };
    logProgress(`[audit][${scenarioId}] >> ${stepId}`);

    let timeoutHandle = null;
    try {
      await Promise.race([
        action(record),
        new Promise((_, reject) => {
          timeoutHandle = setTimeout(() => {
            reject(new Error(`Step "${stepId}" timed out after ${timeoutMs}ms`));
          }, timeoutMs);
        })
      ]);
    } catch (err) {
      record.ok = false;
      record.error = String(err && err.stack ? err.stack : err);
      if (/timed out after/i.test(record.error || '')) {
        scenario.abortRemainingSteps = true;
        scenario.abortStepId = stepId;
      }
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      record.durationMs = Date.now() - startedAt;
      scenario.steps.push(record);
      logProgress(`[audit][${scenarioId}] << ${stepId} ${record.ok ? 'ok' : 'fail'} ${record.durationMs}ms`);
    }
  };

  const landingUrl = `${baseUrl.replace(/\/$/, '')}/landing/?utm_source=fb&utm_campaign=pte_wfd&utm_content=a2_vn`;
  const appDemoUrl = `${baseUrl.replace(/\/$/, '')}/index.html?demo=1`;
  const appUrl = `${baseUrl.replace(/\/$/, '')}/index.html`;

  // Phase 1: Landing page
  await step('L1_landing_load', async (r) => {
    const t0 = Date.now();
    await page.goto(landingUrl, { waitUntil: 'load', timeout: 45_000 });
    await page.waitForTimeout(600);
    r.navMs = Date.now() - t0;
    r.title = await page.title();
    r.heroTitle = await getText(page, 'h1.hero-title');
    r.heroSubtitle = await getText(page, 'p.hero-subtitle');
    const heroCombinedText = `${r.heroTitle || ''} ${r.heroSubtitle || ''}`.trim();
    r.hasA2HostileJargon =
      /rolling accuracy|masking|forced listening time|calibration|adaptive engine/i.test(heroCombinedText);
    r.hasPteTaskMapping = await page
      .evaluate(() => {
        const text = document.body ? document.body.innerText : '';
        return /\bWFD\b/i.test(text) || /\bRS\b/i.test(text) || /\bRL\b/i.test(text);
      })
      .catch(() => false);
    const file = path.join(
      outputDirs.screenshots,
      `${runId}__${scenarioId}__L1_landing_hero.png`
    );
    await safeScreenshot(page, file);
    r.screenshot = path.relative(outputDirs.outputRoot, file);
  });

  await step('L2_landing_sections', async (r) => {
    const sections = flow === 'full'
      ? [
          { id: 'hero', sel: '#hero' },
          { id: 'personalization', sel: '#personalization' },
          { id: 'how_it_works', sel: '#how-it-works' },
          { id: 'your_journey', sel: '#your-journey' },
          { id: 'features', sel: '#features' },
          { id: 'faq', sel: '#faq' }
        ]
      : [
          // Entry-focused: only capture the highest-impact sections
          { id: 'hero', sel: '#hero' },
          { id: 'how_it_works', sel: '#how-it-works' },
          { id: 'your_journey', sel: '#your-journey' }
        ];

    r.sectionScreenshots = [];
    for (const s of sections) {
      await scrollIntoView(page, s.sel);
      const file = path.join(
        outputDirs.screenshots,
        `${runId}__${scenarioId}__L2_${s.id}.png`
      );
      await safeScreenshot(page, file);
      r.sectionScreenshots.push({
        section: s.id,
        screenshot: path.relative(outputDirs.outputRoot, file)
      });
    }
  });

  // Phase 2: Landing -> App (Demo)
  await step('A1_click_demo_cta', async (r) => {
    // Scroll to top before click (CTA in hero)
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    const cta = page.getByRole('link', { name: /Start Free Demo/i }).first();
    await cta.click({ timeout: 15_000 });
    const loadTimeout = network.id === 'slow3g' ? 90_000 : 45_000;
    await page.waitForLoadState('load', { timeout: loadTimeout });
    await page.waitForTimeout(1_000);
    r.url = page.url();
    await dismissOverlays(page);

    const preloaderShot = path.join(
      outputDirs.screenshots,
      `${runId}__${scenarioId}__A1_preloader.png`
    );
    r.preloader = await bypassPreloaderIfPresent(page, preloaderShot);
    if (r.preloader.visible) {
      r.preloaderScreenshot = path.relative(outputDirs.outputRoot, preloaderShot);
    }

    // Demo mode is expected to remove ?demo=1 via history.replaceState in auth-ui.js
    r.entryModalVisible = await page.evaluate(() => {
      const el = document.getElementById('entry-modal');
      if (!el) return null;
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    });

    const file = path.join(
      outputDirs.screenshots,
      `${runId}__${scenarioId}__A1_app_demo_loaded.png`
    );
    await safeScreenshot(page, file);
    r.screenshot = path.relative(outputDirs.outputRoot, file);
  });

  // Phase 2.2: Open app without demo param
  await step('A2_open_app_direct', async (r) => {
    // IMPORTANT: run in a fresh browser context so sessionStorage/local state from demo flow
    // does not suppress the "Entry Choice" modal. This should represent a true incognito
    // user navigating directly to /index.html for the first time.
    const directContext = await browser.newContext({
      viewport: device.viewport,
      deviceScaleFactor: device.deviceScaleFactor,
      isMobile: device.isMobile,
      hasTouch: device.hasTouch,
      ignoreHTTPSErrors: true
    });
    const directPage = await directContext.newPage();
    if (network.id === 'offline') {
      await primeOfflineShell(directPage, baseUrl);
    }
    await applyNetworkProfile(directPage, network);

    const loadTimeout = network.id === 'slow3g' ? 90_000 : 45_000;
    await directPage.goto(appUrl, { waitUntil: 'domcontentloaded', timeout: loadTimeout });
    await directPage.waitForTimeout(1_000);
    r.url = directPage.url();
    await dismissOverlays(directPage);

    const preloaderShot = path.join(
      outputDirs.screenshots,
      `${runId}__${scenarioId}__A2_preloader.png`
    );
    r.preloader = await bypassPreloaderIfPresent(directPage, preloaderShot);
    if (r.preloader.visible) {
      r.preloaderScreenshot = path.relative(outputDirs.outputRoot, preloaderShot);
    }

    // Give the app enough time to run auth-ui.js `checkFirstVisit` (DOMContentLoaded+~1.5s)
    // so we don't record a false-negative on mobile.
    const entryModalStart = Date.now();
    let entryModalVisible = false;
    while (Date.now() - entryModalStart < 4_000) {
      entryModalVisible = await isVisible(directPage, '#entry-modal');
      if (entryModalVisible) break;
      await directPage.waitForTimeout(250);
    }
    r.entryModalVisible = entryModalVisible;
    const file = path.join(
      outputDirs.screenshots,
      `${runId}__${scenarioId}__A2_entry_modal.png`
    );
    await safeScreenshot(directPage, file);
    r.screenshot = path.relative(outputDirs.outputRoot, file);

    await directPage.close();
    await directContext.close();
  });

  if (flow !== 'full') {
    await closeSession();
    // Write scenario logs (handled below)
  } else {
  // Phase 3: Guest choice + basic panels
  await step('R1_choose_guest', async (r) => {
    await dismissOverlays(page);
    r.preloader = await bypassPreloaderIfPresent(page);
    const entryModalVisible = await isVisible(page, '#entry-modal');
    r.entryModalVisible = entryModalVisible;
    if (!entryModalVisible) {
      r.skipped = true;
      return;
    }

    const guestBtn = page.locator('#guest-mode-btn');
    await guestBtn.click({ timeout: 10_000 });
    await page.waitForTimeout(800);

    r.guestToastVisible = await page.evaluate(() => {
      const el = document.getElementById('guest-toast');
      if (!el) return null;
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    });

    // Open progress panel (left)
    const progressToggle = page.locator('#progress-panel-toggle');
    await progressToggle.click({ timeout: 10_000 });
    await page.waitForTimeout(600);

    const file = path.join(
      outputDirs.screenshots,
      `${runId}__${scenarioId}__R1_guest_progress_panel.png`
    );
    await safeScreenshot(page, file);
    r.screenshot = path.relative(outputDirs.outputRoot, file);
  });

  await step('R2_open_side_panels', async (r) => {
    await dismissOverlays(page);
    r.screenshots = {};

    // Progress panel (left)
    await page.locator('#progress-panel-toggle').click({ timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(500);
    const progressShot = path.join(
      outputDirs.screenshots,
      `${runId}__${scenarioId}__R2_progress_panel.png`
    );
    await safeScreenshot(page, progressShot);
    r.screenshots.progress = path.relative(outputDirs.outputRoot, progressShot);

    // Vocabulary panel (right)
    await page.locator('#vocab-panel-toggle').click({ timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(500);
    const vocabShot = path.join(
      outputDirs.screenshots,
      `${runId}__${scenarioId}__R2_vocab_panel.png`
    );
    await safeScreenshot(page, vocabShot);
    r.screenshots.vocab = path.relative(outputDirs.outputRoot, vocabShot);

    // Account panel (right)
    await page.locator('#account-panel-toggle').click({ timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(500);
    const accountShot = path.join(
      outputDirs.screenshots,
      `${runId}__${scenarioId}__R2_account_panel.png`
    );
    await safeScreenshot(page, accountShot);
    r.screenshots.account = path.relative(outputDirs.outputRoot, accountShot);
  });

  // Phase 4: Type Mode (3 attempts)
  await step('P1_type_clean_attempt', async (r) => {
    await dismissOverlays(page);
    await clearBlockingPanels(page);

    // Ensure Learning Center is active (mode cards live here)
    await togglePanelNonBlocking(page, 'panel-tutorials');
    await page.waitForTimeout(500);

    // Ensure Type mode panel is active and visible
    await switchModeNonBlocking(page, 'type');
    await page.waitForTimeout(800);
    await dismissOverlays(page);
    await scrollIntoView(page, '#mode-type');

    // Wait for questions to load
    await page.waitForFunction(() => {
      const sel = document.getElementById('question-select-type');
      if (!sel) return false;
      const opt = sel.options && sel.options[0] ? sel.options[0].textContent || '' : '';
      return !/loading/i.test(opt);
    }, { timeout: 45_000 });

    const questionIdText = await page.locator('#current-question-id-type').innerText({ timeout: 5_000 });
    const questionId = Number.parseInt(questionIdText, 10);
    r.questionId = Number.isFinite(questionId) ? questionId : null;

    const correct = (sentenceMaps && sentenceMaps.type && r.questionId && sentenceMaps.type.get(r.questionId))
      ? sentenceMaps.type.get(r.questionId)
      : '';

    await page.locator('#play-btn').click({ timeout: 10_000 });
    await page.waitForFunction(() => {
      const ta = document.getElementById('answer-input');
      return ta && ta.disabled === false;
    }, { timeout: 20_000 });

    r.correctSentenceLen = correct ? correct.length : 0;
    await page.fill('#answer-input', correct || '');

    await page.locator('#check-btn').click({ timeout: 10_000 });
    await page.waitForTimeout(1_200);

    r.resultVisible = await page.evaluate(() => {
      const el = document.getElementById('result');
      if (!el) return null;
      const style = window.getComputedStyle(el);
      return style.display !== 'none';
    });

    const file = path.join(
      outputDirs.screenshots,
      `${runId}__${scenarioId}__P1_type_clean_result.png`
    );
    await safeScreenshot(page, file);
    r.screenshot = path.relative(outputDirs.outputRoot, file);
  });

  await step('P2_type_assisted_attempt', async (r) => {
    await dismissOverlays(page);
    await clearBlockingPanels(page);

    const retry = page.locator('#retry-btn');
    if (await retry.isVisible().catch(() => false)) {
      await retry.click();
      await page.waitForTimeout(600);
    }

    // Ensure the input is enabled for this question
    if (await page.locator('#answer-input').isDisabled().catch(() => false)) {
      await page.locator('#play-btn').click({ timeout: 10_000 });
      await page.waitForTimeout(600);
    }

    // Use hint once (guest may be blocked by Skill Tree gating)
    await page.locator('#hint-btn').click({ timeout: 10_000 });
    await page.waitForTimeout(600);

    const shopAlertVisible = await isVisible(page, '#shop-alert-modal');
    r.hintBlockedByLogin = shopAlertVisible;
    r.hintDrawerVisible = await page.evaluate(() => {
      const drawer = document.getElementById('auto-hints-type');
      if (!drawer) return null;
      const style = window.getComputedStyle(drawer);
      return style.display !== 'none';
    }).catch(() => null);

    const hintShot = path.join(outputDirs.screenshots, `${runId}__${scenarioId}__P2_type_hint.png`);
    await safeScreenshot(page, hintShot);
    r.hintScreenshot = path.relative(outputDirs.outputRoot, hintShot);

    if (shopAlertVisible) {
      await dismissOverlays(page);
    }

    const questionIdText = await page.locator('#current-question-id-type').innerText({ timeout: 5_000 });
    const questionId = Number.parseInt(questionIdText, 10);
    const correct = (sentenceMaps && sentenceMaps.type && Number.isFinite(questionId) && sentenceMaps.type.get(questionId))
      ? sentenceMaps.type.get(questionId)
      : '';
    await page.fill('#answer-input', correct || '');
    await page.locator('#check-btn').click({ timeout: 10_000 });
    await page.waitForTimeout(1_000);

    const file = path.join(
      outputDirs.screenshots,
      `${runId}__${scenarioId}__P2_type_assisted_result.png`
    );
    await safeScreenshot(page, file);
    r.screenshot = path.relative(outputDirs.outputRoot, file);
  });

  await step('P3_type_fail_attempt', async (r) => {
    await dismissOverlays(page);
    await clearBlockingPanels(page);
    const retry = page.locator('#retry-btn');
    if (await retry.isVisible().catch(() => false)) {
      await retry.click();
      await page.waitForTimeout(600);
    }

    if (await page.locator('#answer-input').isDisabled().catch(() => false)) {
      await page.locator('#play-btn').click({ timeout: 10_000 });
      await page.waitForTimeout(600);
    }

    await page.fill('#answer-input', "i don't know");
    await page.locator('#check-btn').click({ timeout: 10_000 });
    await page.waitForTimeout(1_200);

    r.vocabPracticeVisible = await page.evaluate(() => {
      const el = document.getElementById('vocabulary-practice');
      if (!el) return null;
      return window.getComputedStyle(el).display !== 'none';
    }).catch(() => null);

    r.vocabAddModalVisible = await page.evaluate(() => {
      const el = document.getElementById('vocab-add-modal');
      if (!el) return null;
      const style = window.getComputedStyle(el);
      return style.display !== 'none';
    });

    const file = path.join(
      outputDirs.screenshots,
      `${runId}__${scenarioId}__P3_type_fail_panels.png`
    );
    await safeScreenshot(page, file);
    r.screenshot = path.relative(outputDirs.outputRoot, file);
  });

  // Phase 4.3: Vocab manual add (guest smoke)
  await step('V1_vocab_manual_add', async (r) => {
    await dismissOverlays(page);
    await clearBlockingPanels(page);
    // Open vocab panel
    await page.locator('#vocab-panel-toggle').click({ timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(400);

    // Open manual add modal
    await page.locator('#vocab-manual-add-btn').click({ timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      const panel = document.getElementById('vocab-panel-side');
      if (panel) panel.classList.add('expanded');
      const modal = document.getElementById('vocab-manual-add-modal');
      if (modal) {
        modal.style.display = 'flex';
        modal.style.visibility = 'visible';
        modal.style.opacity = '1';
      }
      const input = document.getElementById('manual-add-input');
      if (input) {
        input.removeAttribute('disabled');
        input.value = '';
      }
    }).catch(() => {});

    // Add a simple word (no sentence context => no dictionary call)
    await page.locator('#manual-add-input').fill('cat').catch(async () => {
      await page.evaluate(() => {
        const input = document.getElementById('manual-add-input');
        if (!input) return;
        input.value = 'cat';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
    });
    await page.locator('#manual-add-submit').click({ timeout: 10_000 }).catch(async () => {
      await page.evaluate(() => {
        const btn = document.getElementById('manual-add-submit');
        if (btn) btn.click();
      });
    });
    await page.waitForTimeout(800);

    r.shopAlertVisible = await isVisible(page, '#shop-alert-modal');
    const file = path.join(outputDirs.screenshots, `${runId}__${scenarioId}__V1_vocab_manual_add.png`);
    await safeScreenshot(page, file);
    r.screenshot = path.relative(outputDirs.outputRoot, file);

    if (r.shopAlertVisible) await dismissOverlays(page);
  });

  // Phase 4.4: SRS review access
  await step('S1_start_srs_review', async (r) => {
    await dismissOverlays(page);
    await clearBlockingPanels(page);
    // Open "Daily Review" panel, then click the card
    await togglePanelNonBlocking(page, 'panel-srs');
    await page.waitForTimeout(600);
    await page.locator('.srs-card-modern').click({ timeout: 10_000 });
    await page.waitForTimeout(1_200);

    r.srsPanelVisible = await page.evaluate(() => {
      const el = document.getElementById('srs-review-panel');
      if (!el) return null;
      return window.getComputedStyle(el).display !== 'none';
    }).catch(() => null);
    r.srsDueText = await page.evaluate(() => {
      const el = document.getElementById('srs-due-count');
      return el ? el.textContent.trim() : null;
    }).catch(() => null);

    const file = path.join(outputDirs.screenshots, `${runId}__${scenarioId}__S1_srs_start.png`);
    await safeScreenshot(page, file);
    r.screenshot = path.relative(outputDirs.outputRoot, file);
  });

  if (!p0Only) {
  // Phase 5: Speak mode basic behavior (SpeechRecognition availability)
  await step('SP1_speak_mode_smoke', async (r) => {
    page = await resetToDemoGuest(page, appDemoUrl, network.id, recoverPage);
    await togglePanelNonBlocking(page, 'panel-tutorials');
    await page.waitForTimeout(400);
    await switchModeNonBlocking(page, 'speak');
    await page.waitForTimeout(800);
    await dismissOverlays(page);

    r.speechRecognitionAvailable = await page.evaluate(() => {
      return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    });

    r.tutorialVisible = await isVisible(page, '#tutorial-overlay');

    // Try clicking record to see if UI fails gracefully (do not fail the whole audit if blocked)
    let recordClickOk = true;
    try {
      await page.locator('#record-btn').click({ timeout: 3_000 });
      await page.waitForTimeout(800);
    } catch {
      recordClickOk = false;
    }
    r.recordClickOk = recordClickOk;

    const file = path.join(
      outputDirs.screenshots,
      `${runId}__${scenarioId}__SP1_speak_mode.png`
    );
    await safeScreenshot(page, file);
    r.screenshot = path.relative(outputDirs.outputRoot, file);
  });

  // Phase 7: Mode coverage quick smoke (Fill, Notes, Watch, Pronounce, Survival)
  await step('M1_fill_mode_smoke', async (r) => {
    page = await resetToDemoGuest(page, appDemoUrl, network.id, recoverPage);
    await togglePanelNonBlocking(page, 'panel-tutorials');
    await page.waitForTimeout(400);
    await switchModeNonBlocking(page, 'extended');
    await page.waitForTimeout(800);
    const file = path.join(
      outputDirs.screenshots,
      `${runId}__${scenarioId}__M1_fill_mode.png`
    );
    const screenshotError = await safeScreenshot(page, file)
      .then(() => null)
      .catch((error) => String(error));
    r.screenshot = screenshotError ? null : path.relative(outputDirs.outputRoot, file);
    if (screenshotError) r.screenshotError = screenshotError;
  });

  await step('M2_notes_mode_smoke', async (r) => {
    page = await resetToDemoGuest(page, appDemoUrl, network.id, recoverPage);
    await togglePanelNonBlocking(page, 'panel-tutorials');
    await page.waitForTimeout(400);
    if (device.isMobile) {
      await scrollIntoView(page, '#mode-notes');
      r.mobileFallback = 'card_only';
    } else {
      await switchModeNonBlocking(page, 'notes');
      await page.waitForTimeout(800);
    }
    const file = path.join(
      outputDirs.screenshots,
      `${runId}__${scenarioId}__M2_notes_mode.png`
    );
    const screenshotError = await safeScreenshot(page, file)
      .then(() => null)
      .catch((error) => String(error));
    r.screenshot = screenshotError ? null : path.relative(outputDirs.outputRoot, file);
    if (screenshotError) r.screenshotError = screenshotError;
  }, 150_000);

  await step('M3_watch_mode_smoke', async (r) => {
    page = await resetToDemoGuest(page, appDemoUrl, network.id, recoverPage);
    await togglePanelNonBlocking(page, 'panel-tutorials');
    await page.waitForTimeout(400);
    await switchModeNonBlocking(page, 'watch');
    await page.waitForTimeout(1_200);
    const file = path.join(
      outputDirs.screenshots,
      `${runId}__${scenarioId}__M3_watch_mode.png`
    );
    const screenshotError = await safeScreenshot(page, file)
      .then(() => null)
      .catch((error) => String(error));
    r.screenshot = screenshotError ? null : path.relative(outputDirs.outputRoot, file);
    if (screenshotError) r.screenshotError = screenshotError;
  });

  await step('M4_pronounce_mode_smoke', async (r) => {
    page = await resetToDemoGuest(page, appDemoUrl, network.id, recoverPage);
    await togglePanelNonBlocking(page, 'panel-tutorials');
    await page.waitForTimeout(400);
    await switchModeNonBlocking(page, 'pronounce');
    await page.waitForTimeout(1_200);
    const file = path.join(
      outputDirs.screenshots,
      `${runId}__${scenarioId}__M4_pronounce_mode.png`
    );
    const screenshotError = await safeScreenshot(page, file)
      .then(() => null)
      .catch((error) => String(error));
    r.screenshot = screenshotError ? null : path.relative(outputDirs.outputRoot, file);
    if (screenshotError) r.screenshotError = screenshotError;
  });

  await step('M5_survival_mode_smoke', async (r) => {
    page = await resetToDemoGuest(page, appDemoUrl, network.id, recoverPage);
    await togglePanelNonBlocking(page, 'panel-entertainment');
    await page.waitForTimeout(500);
    await switchModeNonBlocking(page, 'survival');
    await page.waitForTimeout(1_200);
    const file = path.join(
      outputDirs.screenshots,
      `${runId}__${scenarioId}__M5_survival_mode.png`
    );
    const screenshotError = await safeScreenshot(page, file)
      .then(() => null)
      .catch((error) => String(error));
    r.screenshot = screenshotError ? null : path.relative(outputDirs.outputRoot, file);
    if (screenshotError) r.screenshotError = screenshotError;
  });

  // Dictionary & Vietnamese translation quick check (local overrides should be fast)
  await step('D1_dictionary_vn_translation', async (r) => {
    page = await resetToDemoGuest(page, appDemoUrl, network.id, recoverPage);
    const word = 'believe';
    const t0 = Date.now();
    const first = await page.evaluate(async (w) => {
      const timeoutMs = 15_000;
      const timeoutMarker = { __timedOut: true, timeoutMs };
      const lookup = async () => {
        if (!window.DictionaryService || !window.DictionaryService.getVietnameseTranslation) return null;
        return window.DictionaryService.getVietnameseTranslation(w);
      };
      try {
        return await Promise.race([
          lookup(),
          new Promise((resolve) => setTimeout(() => resolve(timeoutMarker), timeoutMs))
        ]);
      } catch (error) {
        return { __error: String(error) };
      }
    }, word);
    const t1 = Date.now();
    const second = await page.evaluate(async (w) => {
      const timeoutMs = 15_000;
      const timeoutMarker = { __timedOut: true, timeoutMs };
      const lookup = async () => {
        if (!window.DictionaryService || !window.DictionaryService.getVietnameseTranslation) return null;
        return window.DictionaryService.getVietnameseTranslation(w);
      };
      try {
        return await Promise.race([
          lookup(),
          new Promise((resolve) => setTimeout(() => resolve(timeoutMarker), timeoutMs))
        ]);
      } catch (error) {
        return { __error: String(error) };
      }
    }, word);
    const t2 = Date.now();
    r.word = word;
    r.firstMs = t1 - t0;
    r.secondMs = t2 - t1;
    r.first = first;
    r.second = second;

    const file = path.join(
      outputDirs.screenshots,
      `${runId}__${scenarioId}__D1_dictionary.png`
    );
    await safeScreenshot(page, file);
    r.screenshot = path.relative(outputDirs.outputRoot, file);
  });

  // AI proxy smoke: only test validation errors unless explicitly enabled
  await step('AI1_ai_proxy_smoke', async (r) => {
    page = await resetToDemoGuest(page, appDemoUrl, network.id, recoverPage);
    r.skippedExternalCalls = !allowAiCalls;
    const res = await page.evaluate(async (allow) => {
      const url = '/api/ai-proxy';
      const timeoutMs = 15_000;
      let timeoutHandle = null;
      try {
        const body = allow
          ? { prompt: 'Say hello in one short sentence.', model: 'gpt-4o-mini', max_tokens: 32 }
          : { prompt: '', model: '', max_tokens: 0 };
        const controller = new AbortController();
        timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal
        });
        const json = await resp.json().catch(() => null);
        return { ok: resp.ok, status: resp.status, json };
      } catch (e) {
        return { ok: false, status: 0, error: String(e) };
      } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle);
      }
    }, allowAiCalls);
    r.response = res;
  });

  // Admin pages access control smoke (non-admin should not access)
  await step('ADM1_admin_pages_blocked', async (r) => {
    page = await resetToDemoGuest(page, appDemoUrl, network.id, recoverPage);
    const targets = [
      { name: 'crm-admin', path: '/crm-admin.html' },
      { name: 'entrance-test', path: '/entrance-test.html' },
      { name: 'crm-entrance-test-result', path: '/crm-entrance-test-result.html' },
      { name: 'watch-admin', path: '/watch-admin.html' }
    ];
    r.targets = [];
    for (const t of targets) {
      await page.goto(`${baseUrl.replace(/\/$/, '')}${t.path}`, { waitUntil: 'load', timeout: 45_000 });
      await page.waitForTimeout(600);
      const shot = path.join(
        outputDirs.screenshots,
        `${runId}__${scenarioId}__ADM1_${sanitizeFilePart(t.name)}.png`
      );
      await safeScreenshot(page, shot);
      r.targets.push({
        name: t.name,
        url: page.url(),
        screenshot: path.relative(outputDirs.outputRoot, shot)
      });
    }
  });
  }

  // Close context to flush video
  await closeSession();
  }

  // Move any recorded videos to stable names
  if (recordVideo) {
    const videoDir = outputDirs.videosTmp;
    const entries = fs.existsSync(videoDir) ? fs.readdirSync(videoDir) : [];
    for (const entry of entries) {
      if (!entry.toLowerCase().endsWith('.webm')) continue;
      const src = path.join(videoDir, entry);
      const dest = path.join(outputDirs.videos, `${runId}__${scenarioId}__flow.webm`);
      // Avoid overwriting: if already exists, suffix
      const finalDest = fs.existsSync(dest)
        ? path.join(outputDirs.videos, `${runId}__${scenarioId}__flow_${Date.now()}.webm`)
        : dest;
      fs.renameSync(src, finalDest);
      scenario.videoFiles.push(path.relative(outputDirs.outputRoot, finalDest));
    }
  }

  // Write scenario logs
  const logFile = path.join(outputDirs.logs, `${runId}__${scenarioId}.log.json`);
  fs.writeFileSync(
    logFile,
    JSON.stringify(
      {
        console: scenario.console,
        pageErrors: scenario.pageErrors,
        requestFailed: scenario.requestFailed
      },
      null,
      2
    ),
    'utf8'
  );
  scenario.logFile = path.relative(outputDirs.outputRoot, logFile);

  return scenario;
}

async function main() {
  const args = parseArgs(process.argv);
  const runId = nowRunId();

  const outputRoot = path.resolve(args.outputRoot);
  const outputDirs = {
    outputRoot,
    screenshots: path.join(outputRoot, 'screenshots'),
    videos: path.join(outputRoot, 'videos'),
    videosTmp: path.join(outputRoot, 'videos', '_tmp'),
    logs: path.join(outputRoot, 'logs'),
    reports: path.join(outputRoot, 'reports')
  };

  for (const dir of Object.values(outputDirs)) ensureDir(dir);

  const report = {
    runId,
    timestamp: new Date().toISOString(),
    node: process.version,
    baseUrl: args.baseUrl,
    startServer: args.startServer,
    headed: args.headed,
    allowAiCalls: args.allowAiCalls,
    fullOnly: args.fullOnly,
    assertP0: args.assertP0,
    p0Only: args.p0Only,
    recordVideo: args.recordVideo,
    scenarios: []
  };

  let serverProc = null;
  try {
    if (args.startServer) {
      serverProc = startLocalServer();
      await waitForHealth(args.baseUrl, 45_000);
    }

    const browser = await chromium.launch({
      headless: !args.headed,
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
    });

    const sentenceMaps = (() => {
      const loadMap = (mode) => {
        try {
          const filePath = path.resolve(__dirname, '..', '..', 'public', 'database', mode, 'index.json');
          const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          const items = Array.isArray(parsed.items) ? parsed.items : [];
          const map = new Map();
          for (const item of items) {
            if (!item || typeof item.id === 'undefined') continue;
            map.set(Number(item.id), String(item.correctSentence || ''));
          }
          return map;
        } catch {
          return new Map();
        }
      };
      return { type: loadMap('type'), speak: loadMap('speak') };
    })();

    const devices = [
      {
        id: 'pixel5',
        name: 'Pixel 5',
        viewport: { width: 393, height: 851 },
        deviceScaleFactor: 2.75,
        isMobile: true,
        hasTouch: true
      },
      {
        id: 'iphone_se',
        name: 'iPhone SE',
        viewport: { width: 375, height: 667 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true
      },
      {
        id: 'desktop_1366',
        name: 'Desktop 1366x768',
        viewport: { width: 1366, height: 768 },
        deviceScaleFactor: 1,
        isMobile: false,
        hasTouch: false
      },
      {
        id: 'tablet_768',
        name: 'Tablet 768x1024',
        viewport: { width: 768, height: 1024 },
        deviceScaleFactor: 1.5,
        isMobile: false,
        hasTouch: true
      }
    ];

    const networks = [
      { id: 'fast', name: 'Fast (no throttle)' },
      { id: 'slow3g', name: 'Slow 3G (500ms/500kbps)' },
      { id: 'offline', name: 'Offline' }
    ];

    // Run a coverage-focused subset to keep runtime reasonable:
    // - Full flow on desktop fast (with video)
    // - Full flow on pixel5 slow3g (with video)
    // - Landing+entry only on remaining device/network combos (no video)
    const fullFlowScenarios = [
      { deviceId: 'desktop_1366', networkId: 'fast', recordVideo: args.recordVideo },
      { deviceId: 'pixel5', networkId: 'fast', recordVideo: args.recordVideo }
    ];

    const selected = [];
    if (args.fullOnly) {
      for (const cfg of fullFlowScenarios) {
        const device = devices.find((d) => d.id === cfg.deviceId);
        const network = networks.find((n) => n.id === cfg.networkId);
        if (device && network) {
          selected.push({
            device,
            network,
            recordVideo: Boolean(cfg.recordVideo),
            flow: 'full'
          });
        }
      }
    } else {
      for (const d of devices) {
        for (const n of networks) {
          const isFull = fullFlowScenarios.some((s) => s.deviceId === d.id && s.networkId === n.id);
          // Reduce total load: only run offline on desktop, and slow3g on pixel/desktop
          const allowThis =
            isFull ||
            (n.id === 'fast' && (d.id === 'iphone_se' || d.id === 'tablet_768')) ||
            (n.id === 'offline' && d.id === 'desktop_1366') ||
            (n.id === 'slow3g' && d.id === 'desktop_1366');
          if (allowThis) {
            selected.push({
              device: d,
              network: n,
              recordVideo: isFull && args.recordVideo,
              flow: isFull ? 'full' : 'entry'
            });
          }
        }
      }
    }

    for (const s of selected) {
      // eslint-disable-next-line no-console
      console.log(`[audit] Running scenario ${s.device.id} / ${s.network.id} ...`);
      const scenario = await runScenario({
        browser,
        baseUrl: args.baseUrl,
        runId,
        device: s.device,
        network: s.network,
        outputDirs,
        recordVideo: s.recordVideo,
        allowAiCalls: args.allowAiCalls,
        flow: s.flow || (s.recordVideo ? 'full' : 'entry'),
        p0Only: args.p0Only,
        sentenceMaps
      });
      report.scenarios.push(scenario);
    }

    await browser.close();
  } finally {
    if (serverProc) {
      const serverLog = path.join(outputDirs.logs, `${runId}__local_server.log.txt`);
      try {
        fs.writeFileSync(serverLog, serverProc.getOutput(), 'utf8');
        report.localServerLog = path.relative(outputDirs.outputRoot, serverLog);
      } catch {
        // ignore
      }
      await stopLocalServer(serverProc);
    }
  }

  if (args.assertP0) {
    const failures = collectP0AssertionFailures(report);
    report.p0Assertions = {
      enabled: true,
      failures,
      passed: failures.length === 0
    };
  }

  const reportPath = path.join(outputDirs.reports, `${runId}__audit-run.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

  if (args.assertP0 && report.p0Assertions && !report.p0Assertions.passed) {
    // eslint-disable-next-line no-console
    console.error('[audit] P0 assertions failed:');
    for (const failure of report.p0Assertions.failures) {
      // eslint-disable-next-line no-console
      console.error(` - [${failure.scenario}] ${failure.step}: ${failure.reason}`);
    }
    process.exitCode = 2;
  }

  // eslint-disable-next-line no-console
  console.log(`[audit] Done. Report: ${reportPath}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});
