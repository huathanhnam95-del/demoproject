/**
 * BEL A2 (Vietnamese) PTE Auth + Admin Journey Audit Runner
 *
 * Empirically tests:
 * - Guest -> signup -> level selection onboarding
 * - Logged-in loop (Vocab -> SRS -> Writing Challenge)
 * - Skill Tree + Adaptive Engine profile surfaces
 * - Admin pages + entrance test flow (create link -> open -> submit -> view result)
 * - AI proxy caching (2 identical prompts -> fromCache)
 *
 * Usage:
 *   node scripts/audit/run-a2-auth-admin-audit.js --base-url https://localhost:8443
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');
const https = require('https');
const { chromium } = require('playwright');

// Load local env defaults (ADMIN_EMAIL etc.) for audit helpers.
require('dotenv').config();

function parseArgs(argv) {
  const args = {
    baseUrl: 'https://localhost:8443',
    outputRoot: path.join('docs', 'audits', '2026-03-01-a2-vn-pte-onboarding', 'artifacts'),
    startServer: true,
    headed: false
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
  }

  return args;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
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
          resolve({ status: res.statusCode || 0, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode || 0, data: null, raw: data });
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error(`Timeout fetching ${url}`)));
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
      // ignore
    }
    if (Date.now() - start > timeoutMs) throw new Error(`Server health check timed out: ${healthUrl}`);
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
  return { child, getOutput: () => lines.join('') };
}

async function stopLocalServer(serverProc) {
  if (!serverProc || !serverProc.child || serverProc.child.killed) return;
  serverProc.child.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 500));
  if (!serverProc.child.killed) serverProc.child.kill('SIGKILL');
}

async function safeScreenshot(page, filePath, { fullPage = false } = {}) {
  await page.screenshot({ path: filePath, fullPage });
}

async function isVisible(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }, selector).catch(() => false);
}

async function dismissKnownOverlays(page) {
  const maxPasses = 6;
  for (let i = 0; i < maxPasses; i += 1) {
    let dismissed = false;
    const clickIfVisible = async (modalSel, btnSel) => {
      if (!(await isVisible(page, modalSel))) return false;
      await page.locator(btnSel).click({ timeout: 3_000 }).catch(() => {});
      return true;
    };
    const clickIfPresent = async (btnSel) => {
      const loc = page.locator(btnSel);
      const count = await loc.count().catch(() => 0);
      if (!count) return false;
      await loc.first().click({ timeout: 3_000, force: true }).catch(() => {});
      return true;
    };

    dismissed ||= await clickIfVisible('#tutorial-overlay', '#tutorial-skip');
    dismissed ||= await clickIfVisible('#shop-alert-modal', '#shop-alert-modal-ok');
    dismissed ||= await clickIfVisible('#shop-modal', '#shop-close-btn');
    dismissed ||= await clickIfVisible('#mode-helper-modal', '#mode-helper-close-btn');
    dismissed ||= await clickIfVisible('#grammar-warning-modal', '#grammar-warning-ok-btn');
    dismissed ||= await clickIfVisible('#vocab-alert-modal', '#vocab-alert-ok');
    dismissed ||= await clickIfVisible('#explanation-modal', '#explanation-close-btn');
    // The vocab tutorial overlay can animate opacity but still intercept clicks.
    dismissed ||= await clickIfPresent('#vocab-tutorial-skip');
    dismissed ||= await clickIfVisible('#vocab-add-modal', '#vocab-add-close');
    dismissed ||= await clickIfVisible('#srs-writing-modal', '#srs-writing-close-btn');

    if (!dismissed) break;
    await page.waitForTimeout(250);
  }
}

async function bypassPreloaderIfPresent(page) {
  if (!(await isVisible(page, '#app-preloader'))) return { visible: false, bypassed: false };
  const bypassBtn = page.locator('#preloader-bypass-btn');
  const dismissBtn = page.locator('#preloader-dismiss-btn');
  if (await bypassBtn.count().then((c) => c > 0).catch(() => false)) {
    await bypassBtn.click({ timeout: 3_000 }).catch(() => {});
    await page.waitForTimeout(300);
    return { visible: true, bypassed: true, action: 'bypass' };
  }
  if (await dismissBtn.count().then((c) => c > 0).catch(() => false)) {
    await dismissBtn.click({ timeout: 3_000 }).catch(() => {});
    await page.waitForTimeout(300);
    return { visible: true, bypassed: true, action: 'dismiss' };
  }
  return { visible: true, bypassed: false };
}

function loadSentenceMap(mode) {
  const map = new Map();
  try {
    const filePath = path.resolve(__dirname, '..', '..', 'public', 'database', mode, 'index.json');
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const items = Array.isArray(parsed.items) ? parsed.items : [];
    for (const item of items) {
      if (!item || typeof item.id === 'undefined') continue;
      map.set(Number(item.id), String(item.correctSentence || ''));
    }
  } catch {
    // ignore
  }
  return map;
}

function loadAdminCredentials() {
  const fallbackEmail = String(process.env.ADMIN_EMAIL || '').trim();
  const repoRoot = path.resolve(__dirname, '..', '..');
  const filePath = path.resolve(repoRoot, 'Admin account');
  const meta = { filePath, exists: false, sizeBytes: 0, emailMatch: false, passMatch: false };
  try {
    meta.exists = fs.existsSync(filePath);
    if (meta.exists) meta.sizeBytes = fs.statSync(filePath).size;
  } catch {
    // ignore
  }
  if (!meta.exists) return { email: fallbackEmail, password: '', meta };

  const text = fs.readFileSync(filePath, 'utf8');
  const emailMatch = text.match(/Log\s*in\s*with\s*Email:\s*(.+)/i);
  const passMatch = text.match(/Password:\s*(.+)/i);
  meta.emailMatch = !!emailMatch;
  meta.passMatch = !!passMatch;

  return {
    email: String(emailMatch ? emailMatch[1] : fallbackEmail).trim(),
    password: String(passMatch ? passMatch[1] : '').trim(),
    meta
  };
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
    scenarios: []
  };

  const device = {
    id: 'desktop_1366',
    name: 'Desktop 1366x768',
    viewport: { width: 1366, height: 768 },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false
  };

  const sentenceMapType = loadSentenceMap('type');
  const adminCreds = loadAdminCredentials();
  report.adminCredsMeta = {
    emailLen: adminCreds.email.length,
    passwordLen: adminCreds.password.length,
    ...(adminCreds.meta || {})
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

    const scenarioId = `${device.id}__fast__auth_admin`;
    const scenario = {
      id: scenarioId,
      device,
      network: { id: 'fast', name: 'Fast (no throttle)' },
      steps: [],
      console: [],
      pageErrors: [],
      requestFailed: [],
      videoFiles: []
    };

    const context = await browser.newContext({
      viewport: device.viewport,
      deviceScaleFactor: device.deviceScaleFactor,
      isMobile: device.isMobile,
      hasTouch: device.hasTouch,
      ignoreHTTPSErrors: true,
      recordVideo: { dir: outputDirs.videosTmp, size: device.viewport }
    });
    const page = await context.newPage();

    page.on('console', (msg) => scenario.console.push({ type: msg.type(), text: msg.text() }));
    page.on('pageerror', (err) => scenario.pageErrors.push(String(err)));
    page.on('requestfailed', (req) => {
      scenario.requestFailed.push({
        url: req.url(),
        failure: req.failure() ? req.failure().errorText : 'unknown'
      });
    });

    const step = async (stepId, action) => {
      const startedAt = Date.now();
      const record = { id: stepId, startedAt: new Date(startedAt).toISOString(), ok: true };
      try {
        await action(record);
      } catch (err) {
        record.ok = false;
        record.error = String(err && err.stack ? err.stack : err);
      } finally {
        record.durationMs = Date.now() - startedAt;
        scenario.steps.push(record);
      }
    };

    const base = args.baseUrl.replace(/\/$/, '');
    const appUrl = `${base}/index.html`;

    const testUser = {
      email: `bel.audit.${runId}@example.com`,
      password: 'AuditPass123!'
    };

    await step('AUTH1_open_app_entry_modal', async (r) => {
      await page.goto(appUrl, { waitUntil: 'load', timeout: 60_000 });
      await page.waitForTimeout(800);
      await dismissKnownOverlays(page);
      r.preloader = await bypassPreloaderIfPresent(page);

      await page.waitForFunction(() => {
        const el = document.getElementById('entry-modal');
        if (!el) return false;
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
      }, { timeout: 30_000 });

      r.entryModalVisible = await isVisible(page, '#entry-modal');
      const shot = path.join(outputDirs.screenshots, `${runId}__${scenarioId}__AUTH1_entry_modal.png`);
      await safeScreenshot(page, shot);
      r.screenshot = path.relative(outputDirs.outputRoot, shot);
    });

    await step('A11Y1_entry_modal_keyboard_tab_order', async (r) => {
      const focused = [];
      for (let i = 0; i < 6; i += 1) {
        await page.keyboard.press('Tab');
        focused.push(
          await page.evaluate(() => {
            const el = document.activeElement;
            if (!el) return null;
            return {
              tag: el.tagName,
              id: el.id || null,
              className: el.className || null,
              text: (el.innerText || el.value || '').slice(0, 60)
            };
          })
        );
      }
      r.focused = focused;
      const shot = path.join(outputDirs.screenshots, `${runId}__${scenarioId}__A11Y1_entry_tab.png`);
      await safeScreenshot(page, shot);
      r.screenshot = path.relative(outputDirs.outputRoot, shot);
    });

    await step('AUTH2_guest_type_attempt_then_register', async (r) => {
      await page.locator('#guest-mode-btn').click({ timeout: 10_000 });
      await page.waitForTimeout(700);
      await dismissKnownOverlays(page);

      await page.evaluate(() => window.toggleDashboardPanel && window.toggleDashboardPanel('panel-tutorials'));
      await page.waitForTimeout(400);
      await page.evaluate(() => window.switchToMode && window.switchToMode('type'));
      await page.waitForTimeout(800);

      await page.waitForFunction(() => {
        const sel = document.getElementById('question-select-type');
        if (!sel) return false;
        const opt = sel.options && sel.options[0] ? sel.options[0].textContent || '' : '';
        return !/loading/i.test(opt);
      }, { timeout: 45_000 });

      const questionIdText = await page.locator('#current-question-id-type').innerText({ timeout: 5_000 });
      const questionId = Number.parseInt(questionIdText, 10);
      const correct = Number.isFinite(questionId) && sentenceMapType.get(questionId) ? sentenceMapType.get(questionId) : '';
      r.questionId = Number.isFinite(questionId) ? questionId : null;

      await page.locator('#play-btn').click({ timeout: 10_000 });
      await page.waitForFunction(() => {
        const ta = document.getElementById('answer-input');
        return ta && ta.disabled === false;
      }, { timeout: 20_000 });

      await page.fill('#answer-input', correct || '');
      await page.locator('#check-btn').click({ timeout: 10_000 });
      await page.waitForTimeout(1_200);

      const shot = path.join(outputDirs.screenshots, `${runId}__${scenarioId}__AUTH2_guest_type_result.png`);
      await safeScreenshot(page, shot);
      r.screenshot = path.relative(outputDirs.outputRoot, shot);

      // Account panel -> open auth overlay (guest uses guest-login button; then we switch to signup)
      await page.locator('#account-panel-toggle').click({ timeout: 10_000 });
      await page.waitForFunction(() => {
        const side = document.getElementById('account-panel-side');
        return !!side && side.classList.contains('expanded');
      }, { timeout: 10_000 });

      const guestLoginBtn = page.locator('#panel-guest-login-btn');
      const registerBtn = page.locator('#panel-register-btn');
      if (await guestLoginBtn.isVisible().catch(() => false)) {
        await guestLoginBtn.click({ timeout: 10_000 });
      } else {
        await registerBtn.click({ timeout: 10_000 });
      }
      await page.waitForTimeout(500);
      r.authOverlayVisible = await isVisible(page, '#auth-overlay');

      const shot2 = path.join(outputDirs.screenshots, `${runId}__${scenarioId}__AUTH2_register_open.png`);
      await safeScreenshot(page, shot2);
      r.registerScreenshot = path.relative(outputDirs.outputRoot, shot2);
    });

    await step('AUTH3_signup_validation_error', async (r) => {
      await page.waitForFunction(() => {
        const el = document.getElementById('auth-overlay');
        return !!el && window.getComputedStyle(el).display !== 'none';
      }, { timeout: 10_000 });

      // Ensure signup form is visible
      const switchToSignup = page.locator('#switch-to-signup');
      if (await switchToSignup.isVisible().catch(() => false)) {
        await switchToSignup.click({ timeout: 5_000 }).catch(() => {});
      }
      await page.waitForFunction(() => {
        const el = document.getElementById('signup-form');
        return !!el && window.getComputedStyle(el).display !== 'none';
      }, { timeout: 10_000 });

      await page.fill('#signup-email', testUser.email);
      await page.fill('#signup-password', testUser.password);
      await page.fill('#signup-password-confirm', `${testUser.password}nope`);
      await page.locator('#signup-form-element button[type=\"submit\"]').click({ timeout: 10_000 });
      await page.waitForTimeout(900);

      r.signupErrorText = await page.locator('#signup-error').innerText({ timeout: 3_000 }).catch(() => null);

      const shot = path.join(outputDirs.screenshots, `${runId}__${scenarioId}__AUTH3_signup_error.png`);
      await safeScreenshot(page, shot);
      r.screenshot = path.relative(outputDirs.outputRoot, shot);
    });

    await step('AUTH4_signup_success_level_selection', async (r) => {
      await page.waitForFunction(() => {
        const el = document.getElementById('signup-form');
        return !!el && window.getComputedStyle(el).display !== 'none';
      }, { timeout: 10_000 });

      await page.fill('#signup-email', testUser.email);
      await page.fill('#signup-password', testUser.password);
      await page.fill('#signup-password-confirm', testUser.password);
      await page.locator('#signup-form-element button[type=\"submit\"]').click({ timeout: 10_000 });

      await page.waitForTimeout(1_800);
      await dismissKnownOverlays(page);

      r.levelSelectionVisible = await isVisible(page, '#level-selection-modal');
      if (r.levelSelectionVisible) {
        const shot = path.join(outputDirs.screenshots, `${runId}__${scenarioId}__AUTH4_level_selection.png`);
        await safeScreenshot(page, shot);
        r.levelSelectionScreenshot = path.relative(outputDirs.outputRoot, shot);
        await page.locator('#level-selection-modal .level-btn[data-level=\"beginner\"]').click({ timeout: 10_000 });
        await page.waitForTimeout(900);
        r.levelSelectionDismissed = await page.waitForFunction(() => {
          const el = document.getElementById('level-selection-modal');
          return !el || window.getComputedStyle(el).display === 'none';
        }, { timeout: 10_000 }).then(() => true).catch(() => false);
      }

      // Auth overlay should be gone; capture logged-in state in account panel
      await page.locator('#account-panel-toggle').click({ timeout: 10_000 });
      await page.waitForTimeout(500);
      r.panelEmail = await page.locator('#panel-email').innerText({ timeout: 5_000 }).catch(() => null);
      const shot2 = path.join(outputDirs.screenshots, `${runId}__${scenarioId}__AUTH4_logged_in_panel.png`);
      await safeScreenshot(page, shot2);
      r.screenshot = path.relative(outputDirs.outputRoot, shot2);
    });

    await step('AUTH5_skill_tree_and_profile_surfaces', async (r) => {
      // Safety: close level selection if still blocking UI
      if (await isVisible(page, '#level-selection-modal')) {
        await page.locator('#level-selection-modal .level-btn[data-level=\"beginner\"]').click({ timeout: 10_000 }).catch(() => {});
        await page.waitForTimeout(900);
      }

      // Ensure account panel is expanded (shopping card only visible while logged in)
      if (!(await isVisible(page, '#panel-shopping-card'))) {
        await page.locator('#account-panel-toggle').click({ timeout: 10_000 }).catch(() => {});
        await page.waitForTimeout(600);
      }

      await page.locator('#panel-shopping-card').click({ timeout: 10_000 });
      await page.waitForTimeout(700);
      r.shopModalVisible = await isVisible(page, '#shop-modal');
      const shopShot = path.join(outputDirs.screenshots, `${runId}__${scenarioId}__AUTH5_skill_tree.png`);
      await safeScreenshot(page, shopShot);
      r.skillTreeScreenshot = path.relative(outputDirs.outputRoot, shopShot);
      await dismissKnownOverlays(page);

      // Ensure account panel is open before clicking "View Profile" (Adaptive Engine entrypoint)
      const ensureAccountPanelOpen = async () => {
        const isExpanded = await page
          .evaluate(() => {
            const el = document.getElementById('account-panel-side');
            return !!el && el.classList.contains('expanded');
          })
          .catch(() => false);
        if (!isExpanded) {
          await page.locator('#account-panel-toggle').click({ timeout: 10_000 }).catch(() => {});
          await page.waitForTimeout(600);
        }
      };

      await ensureAccountPanelOpen();
      await page.locator('#panel-view-profile-btn').click({ timeout: 10_000 });

      r.adaptiveEngineModalVisible = await page
        .waitForFunction(() => {
          const el = document.getElementById('adaptive-engine-modal');
          if (!el) return false;
          return window.getComputedStyle(el).display !== 'none';
        }, { timeout: 10_000 })
        .then(() => true)
        .catch(() => false);
      const aeShot = path.join(outputDirs.screenshots, `${runId}__${scenarioId}__AUTH5_adaptive_engine.png`);
      await safeScreenshot(page, aeShot);
      r.adaptiveEngineScreenshot = path.relative(outputDirs.outputRoot, aeShot);
      await page.locator('#ae-close-btn').click({ timeout: 5_000 }).catch(() => {});
      await page.waitForTimeout(250);
    });

    await step('AUTH6_vocab_add_and_srs_session', async (r) => {
      await dismissKnownOverlays(page);

      // Safety: close level selection if still blocking UI
      if (await isVisible(page, '#level-selection-modal')) {
        await page.locator('#level-selection-modal .level-btn[data-level=\"beginner\"]').click({ timeout: 10_000 }).catch(() => {});
        await page.waitForTimeout(900);
      }

      // Trigger auto-unlock: miss keywords in Type mode while logged in
      await page.evaluate(() => window.toggleDashboardPanel && window.toggleDashboardPanel('panel-tutorials'));
      await page.waitForTimeout(400);
      await page.evaluate(() => window.switchToMode && window.switchToMode('type'));
      await page.waitForTimeout(800);

      const retry = page.locator('#retry-btn');
      if (await retry.isVisible().catch(() => false)) {
        await retry.click().catch(() => {});
        await page.waitForTimeout(500);
      }

      if (await page.locator('#answer-input').isDisabled().catch(() => false)) {
        await page.locator('#play-btn').click({ timeout: 10_000 });
        await page.waitForTimeout(700);
      }

      // Avoid triggering the Writing Tips modal (capital letter + period).
      await page.fill('#answer-input', "I don't know.");
      await page.locator('#check-btn').click({ timeout: 10_000 });

      // The app shows the vocab modal only after the correction animation finishes.
      r.typeResultReady = await page
        .waitForFunction(() => {
          const el = document.querySelector('#result .correct-sentence');
          return !!el;
        }, { timeout: 90_000 })
        .then(() => true)
        .catch(() => false);

      // Wait for the vocab add modal to appear (it fetches Vietnamese entries asynchronously)
      r.vocabAddModalVisible = await page
        .waitForFunction(() => {
          const el = document.getElementById('vocab-add-modal');
          if (!el) return false;
          return window.getComputedStyle(el).display !== 'none';
        }, { timeout: 90_000 })
        .then(() => true)
        .catch(() => false);

      if (r.vocabAddModalVisible) {
        // The vocab tutorial overlay can start slightly after the modal appears.
        // If it activates, skip it so we can interact with the checklist.
        await page.waitForTimeout(800);
        const overlayActive = await page
          .evaluate(() => {
            const el = document.getElementById('vocab-tutorial-overlay');
            if (!el) return false;
            return window.getComputedStyle(el).display !== 'none';
          })
          .catch(() => false);
        if (overlayActive) {
          await page.locator('#vocab-tutorial-skip').first().click({ timeout: 5_000, force: true }).catch(() => {});
          await page.waitForTimeout(400);
        }

        // Wait for at least 1 checkbox (loading state -> populated state)
        await page
          .waitForSelector('#vocab-add-words input[type=\"checkbox\"]', { timeout: 15_000 })
          .catch(() => {});

        // Select at least 1 word so "Add Selected" does real work.
        await page.locator('#vocab-add-words input[type=\"checkbox\"]').first().check({ timeout: 5_000 }).catch(() => {});

        const addShot = path.join(outputDirs.screenshots, `${runId}__${scenarioId}__AUTH6_vocab_add_modal.png`);
        await safeScreenshot(page, addShot);
        r.vocabAddModalScreenshot = path.relative(outputDirs.outputRoot, addShot);
        await page.locator('#vocab-add-btn').click({ timeout: 10_000, force: true }).catch(() => {});
        r.vocabAddModalDismissed = await page
          .waitForFunction(() => {
            const el = document.getElementById('vocab-add-modal');
            if (!el) return true;
            return window.getComputedStyle(el).display === 'none';
          }, { timeout: 20_000 })
          .then(() => true)
          .catch(() => false);
        await page.waitForTimeout(600);
        await dismissKnownOverlays(page);
      }

      // Open vocab panel (should now be unlocked)
      await page.locator('#vocab-panel-toggle').click({ timeout: 10_000 }).catch(() => {});
      await page.waitForTimeout(600);
      r.vocabPanelExpanded = await page.evaluate(() => {
        const el = document.getElementById('vocab-panel-side');
        return !!el && el.classList.contains('expanded');
      }).catch(() => null);
      r.shopAlertVisible = await isVisible(page, '#shop-alert-modal');

      // Fallback: if Add Selected didn't add anything (UI still empty), use Manual Add to seed SRS.
      r.bookmarkedEmpty = await page
        .evaluate(() => {
          const list = document.getElementById('vocab-bookmarked-list');
          if (!list) return null;
          return /No bookmarked words yet/i.test(list.innerText || '');
        })
        .catch(() => null);

      if (r.bookmarkedEmpty === true) {
        await page.locator('#vocab-manual-add-btn').click({ timeout: 10_000 }).catch(() => {});
        await page.waitForTimeout(400);
        await page.fill('#manual-add-input', 'policy').catch(() => {});
        await page.locator('#manual-add-submit').click({ timeout: 10_000 }).catch(() => {});
        await page.waitForTimeout(1_200);
        r.bookmarkedEmptyAfterManual = await page
          .evaluate(() => {
            const list = document.getElementById('vocab-bookmarked-list');
            if (!list) return null;
            return /No bookmarked words yet/i.test(list.innerText || '');
          })
          .catch(() => null);
      }

      const vocabShot = path.join(outputDirs.screenshots, `${runId}__${scenarioId}__AUTH6_vocab_panel.png`);
      await safeScreenshot(page, vocabShot);
      r.vocabScreenshot = path.relative(outputDirs.outputRoot, vocabShot);
      await dismissKnownOverlays(page);

      await page.evaluate(() => window.toggleDashboardPanel && window.toggleDashboardPanel('panel-srs'));
      await page.waitForTimeout(700);
      await dismissKnownOverlays(page);

      // Start SRS session programmatically (more reliable than clicking cards in test automation).
      r.srsStartTriggered = await page
        .evaluate(() => {
          if (!window.SRSReview || typeof window.SRSReview.startReviewSession !== 'function') return false;
          window.SRSReview.startReviewSession(true); // force early review
          return true;
        })
        .catch(() => false);

      // First-time users must pick an algorithm (SM2/FSRS).
      if (await isVisible(page, '#srs-algo-modal-overlay')) {
        await page.locator('#srs-algo-sm2').click({ timeout: 10_000 }).catch(() => {});
        await page.waitForTimeout(800);
      }

      // Rating-buttons tutorial can appear via the VocabTutorial overlay.
      await dismissKnownOverlays(page);

      r.srsPanelVisible = await page
        .waitForFunction(() => {
          const el = document.getElementById('srs-review-panel');
          if (!el) return false;
          return window.getComputedStyle(el).display !== 'none';
        }, { timeout: 20_000 })
        .then(() => true)
        .catch(() => false);
      r.dueCountText = await page.locator('#srs-due-count').innerText({ timeout: 5_000 }).catch(() => null);

      const srsShot = path.join(outputDirs.screenshots, `${runId}__${scenarioId}__AUTH6_srs_panel.png`);
      await safeScreenshot(page, srsShot);
      r.srsScreenshot = path.relative(outputDirs.outputRoot, srsShot);

      if (await page.locator('#srs-flashcard').isVisible().catch(() => false)) {
        await page.locator('#srs-flashcard').click({ timeout: 5_000 }).catch(() => {});
        await page.waitForTimeout(500);
        r.vnText = await page.locator('#srs-vietnamese').innerText({ timeout: 2_000 }).catch(() => null);

        const vnShot = path.join(outputDirs.screenshots, `${runId}__${scenarioId}__AUTH6_srs_vietnamese.png`);
        await safeScreenshot(page, vnShot);
        r.srsVietnameseScreenshot = path.relative(outputDirs.outputRoot, vnShot);

        await page.locator('button.quality-option[data-quality=\"3\"]').click({ timeout: 5_000 }).catch(() => {});
        await page.waitForTimeout(600);
      }
    });

    await step('AUTH7_writing_challenge_smoke', async (r) => {
      r.opened = await page.evaluate(() => {
        if (!window.SRSReview || typeof window.SRSReview.showWritingChallenge !== 'function') return false;
        window.SRSReview.showWritingChallenge({ lemma: 'believe', originalWord: 'believe' }, () => {});
        return true;
      });
      await page.waitForTimeout(900);
      r.modalVisible = await isVisible(page, '#srs-writing-modal');

      if (r.modalVisible) {
        await page.locator('#srs-skip-ai-toggle').check({ timeout: 5_000 }).catch(() => {});
        await page.fill('#srs-writing-input', 'I believe I can improve my listening.');
        await page.locator('#srs-writing-submit').click({ timeout: 10_000 }).catch(() => {});
        await page.waitForTimeout(1_200);
      }

      const shot = path.join(outputDirs.screenshots, `${runId}__${scenarioId}__AUTH7_writing_challenge.png`);
      await safeScreenshot(page, shot);
      r.screenshot = path.relative(outputDirs.outputRoot, shot);
      await page.locator('#srs-writing-close-btn').click({ timeout: 5_000 }).catch(() => {});
      await page.waitForTimeout(400);
      if (await isVisible(page, '#srs-writing-modal')) {
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(400);
      }
      r.closed = !(await isVisible(page, '#srs-writing-modal'));
    });

    await step('AI2_ai_proxy_cache_behavior', async (r) => {
      r.responses = await page.evaluate(async () => {
        const payload = {
          prompt: 'Reply with exactly: OK',
          model: 'meta-llama/Llama-3.1-8B-Instruct',
          max_tokens: 16
        };
        const t0 = performance.now();
        const resp1 = await fetch('/api/ai-proxy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const json1 = await resp1.json().catch(() => null);
        const t1 = performance.now();
        const resp2 = await fetch('/api/ai-proxy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const json2 = await resp2.json().catch(() => null);
        const t2 = performance.now();
        return {
          first: { ok: resp1.ok, status: resp1.status, ms: Math.round(t1 - t0), json: json1 },
          second: { ok: resp2.ok, status: resp2.status, ms: Math.round(t2 - t1), json: json2 }
        };
      });
    });

    await step('ADMIN1_login_admin_and_verify_links', async (r) => {
      // Reset UI state so stacked modals/tutorials don't block the auth flow
      await page.goto(appUrl, { waitUntil: 'load', timeout: 60_000 });
      await page.waitForTimeout(1_000);
      await dismissKnownOverlays(page);

      // Ensure no modal is blocking pointer events
      if (await isVisible(page, '#level-selection-modal')) {
        await page.locator('#level-selection-modal .level-btn[data-level=\"beginner\"]').click({ timeout: 10_000 }).catch(() => {});
        await page.waitForTimeout(900);
      }
      if (await isVisible(page, '#srs-writing-modal')) {
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(600);
      }

      // Ensure account panel is expanded (toggle is not idempotent)
      const ensureAccountExpanded = async () => {
        const expanded = await page
          .evaluate(() => {
            const side = document.getElementById('account-panel-side');
            return !!side && side.classList.contains('expanded');
          })
          .catch(() => false);
        if (!expanded) {
          await page.locator('#account-panel-toggle').click({ timeout: 10_000 });
          await page.waitForTimeout(500);
        }
      };

      await ensureAccountExpanded();
      const logoutBtn = page.locator('#panel-logout-btn');
      if (await logoutBtn.isVisible().catch(() => false)) {
        await logoutBtn.click({ timeout: 10_000 });
        await page.waitForTimeout(1_200);
      }

      // Login button depends on current state (logged out vs guest mode)
      const panelLoginBtn = page.locator('#panel-login-btn');
      const guestLoginBtn = page.locator('#panel-guest-login-btn');
      await ensureAccountExpanded();
      if (await panelLoginBtn.isVisible().catch(() => false)) {
        await panelLoginBtn.click({ timeout: 10_000 });
      } else {
        await guestLoginBtn.click({ timeout: 10_000 });
      }
      await page.waitForTimeout(400);
      await page.fill('#login-email', adminCreds.email);
      await page.fill('#login-password', adminCreds.password);
      r.loginFieldLens = await page.evaluate(() => {
        const email = document.getElementById('login-email');
        const pass = document.getElementById('login-password');
        return {
          emailLen: email && typeof email.value === 'string' ? email.value.length : 0,
          passwordLen: pass && typeof pass.value === 'string' ? pass.value.length : 0
        };
      });
      const filledShot = path.join(outputDirs.screenshots, `${runId}__${scenarioId}__ADMIN1_login_filled.png`);
      await safeScreenshot(page, filledShot);
      r.loginFilledScreenshot = path.relative(outputDirs.outputRoot, filledShot);
      await page.locator('#login-form-element button[type=\"submit\"]').click({ timeout: 10_000 });
      // Wait for auth state to resolve (or show an inline login error)
      r.loginResolved = await page
        .waitForFunction((email) => {
          const f = window.firebaseAuthFunctions;
          if (!f || typeof f.getCurrentUser !== 'function') return false;
          const u = f.getCurrentUser();
          if (!u || !u.email) return false;
          return String(u.email).toLowerCase() === String(email).toLowerCase();
        }, adminCreds.email, { timeout: 20_000 })
        .then(() => true)
        .catch(() => false);

      if (!r.loginResolved) {
        r.loginErrorText = await page.locator('#login-error').innerText({ timeout: 2_000 }).catch(() => null);
        const errShot = path.join(outputDirs.screenshots, `${runId}__${scenarioId}__ADMIN1_login_error.png`);
        await safeScreenshot(page, errShot);
        r.loginErrorScreenshot = path.relative(outputDirs.outputRoot, errShot);
        throw new Error(`Admin login failed: ${r.loginErrorText || 'unknown error'}`);
      }

      r.adminStatus = await page.evaluate(async () => {
        const f = window.firebaseAuthFunctions;
        if (!f || typeof f.getCurrentUser !== 'function') return { ok: false, error: 'authFunctions not ready' };
        const user = f.getCurrentUser();
        if (!user) return { ok: false, error: 'no currentUser' };
        const emailVerified = !!user.emailVerified;
        const token = await user.getIdToken();
        const res = await fetch('/api/admin/status', {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${token}` },
          cache: 'no-store'
        });
        const json = await res.json().catch(() => null);
        return { ok: res.ok, status: res.status, emailVerified, json };
      });

      await page.locator('#account-panel-toggle').click({ timeout: 10_000 }).catch(() => {});
      await page.waitForTimeout(600);
      r.watchAdminLinkVisible = await isVisible(page, '#panel-admin-link');
      r.crmAdminLinkVisible = await isVisible(page, '#panel-crm-admin-link');

      const shot = path.join(outputDirs.screenshots, `${runId}__${scenarioId}__ADMIN1_admin_panel.png`);
      await safeScreenshot(page, shot);
      r.screenshot = path.relative(outputDirs.outputRoot, shot);
    });

    await step('ADMIN2_watch_admin_page_load', async (r) => {
      await page.goto(`${base}/watch-admin.html`, { waitUntil: 'load', timeout: 60_000 });
      await page.waitForTimeout(1_500);
      r.url = page.url();
      r.userEmail = await page.locator('#admin-user-email').innerText({ timeout: 10_000 }).catch(() => null);
      const shot = path.join(outputDirs.screenshots, `${runId}__${scenarioId}__ADMIN2_watch_admin.png`);
      await safeScreenshot(page, shot);
      r.screenshot = path.relative(outputDirs.outputRoot, shot);
    });

    await step('ADMIN3_crm_admin_page_load', async (r) => {
      await page.goto(`${base}/crm-admin.html`, { waitUntil: 'load', timeout: 60_000 });
      await page.waitForTimeout(1_500);
      r.url = page.url();
      const shot = path.join(outputDirs.screenshots, `${runId}__${scenarioId}__ADMIN3_crm_admin.png`);
      await safeScreenshot(page, shot);
      r.screenshot = path.relative(outputDirs.outputRoot, shot);
    });

    await step('ADMIN4_entrance_test_create_submit_view', async (r) => {
      // Run on the main app page to ensure Firebase Auth is initialized
      await page.goto(appUrl, { waitUntil: 'load', timeout: 60_000 });
      await page.waitForTimeout(900);
      await dismissKnownOverlays(page);

      // Wait for Firebase auth state to rehydrate (navigating away to admin pages can reset JS runtime)
      r.currentUserReady = await page
        .waitForFunction(() => {
          const f = window.firebaseAuthFunctions;
          if (!f || typeof f.getCurrentUser !== 'function') return false;
          return !!f.getCurrentUser();
        }, { timeout: 30_000 })
        .then(() => true)
        .catch(() => false);
      if (!r.currentUserReady) {
        throw new Error('Firebase auth not ready: currentUser is null on index.html after admin navigation.');
      }

      const created = await page.evaluate(async (studentEmail) => {
        const f = window.firebaseAuthFunctions;
        if (!f || typeof f.getCurrentUser !== 'function') return { ok: false, error: 'authFunctions not ready' };
        const user = f.getCurrentUser();
        if (!user) return { ok: false, error: 'no currentUser' };
        const token = await user.getIdToken();

        const createStudentRes = await fetch('/api/admin/students', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ name: 'Audit Student', label: 'A2 VN PTE audit', email: studentEmail })
        });
        const createStudentJson = await createStudentRes.json().catch(() => null);
        if (!createStudentRes.ok || !createStudentJson?.success) {
          return { ok: false, stage: 'createStudent', status: createStudentRes.status, json: createStudentJson };
        }
        const studentId = createStudentJson.studentId;

        const createTestRes = await fetch(`/api/admin/students/${encodeURIComponent(studentId)}/entrance-tests`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const createTestJson = await createTestRes.json().catch(() => null);
        if (!createTestRes.ok || !createTestJson?.success) {
          return { ok: false, stage: 'createTest', status: createTestRes.status, json: createTestJson, studentId };
        }

        return { ok: true, studentId, ...createTestJson };
      }, `audit.student.${runId}@example.com`);

      r.created = created;
      if (!created || !created.ok) {
        throw new Error(`Failed to create entrance test link: ${JSON.stringify(created)}`);
      }

      const publicPage = await context.newPage();
      await publicPage.goto(created.testLink, { waitUntil: 'load', timeout: 60_000 });
      await publicPage.waitForTimeout(1_800);
      const publicShot = path.join(outputDirs.screenshots, `${runId}__${scenarioId}__ADMIN4_entrance_public.png`);
      await safeScreenshot(publicPage, publicShot, { fullPage: true });
      r.publicScreenshot = path.relative(outputDirs.outputRoot, publicShot);

      const token = (() => {
        try {
          const url = new URL(created.testLink);
          return url.searchParams.get('token');
        } catch {
          return null;
        }
      })();
      r.submission = await publicPage.evaluate(async (t) => {
        const res = await fetch('/api/entrance-tests/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: t, responses: {} })
        });
        const json = await res.json().catch(() => null);
        return { ok: res.ok, status: res.status, json };
      }, token);
      await publicPage.close();

      await page.goto(created.resultLink, { waitUntil: 'load', timeout: 60_000 });
      await page.waitForTimeout(1_800);
      const resultShot = path.join(outputDirs.screenshots, `${runId}__${scenarioId}__ADMIN4_entrance_result.png`);
      await safeScreenshot(page, resultShot, { fullPage: true });
      r.resultScreenshot = path.relative(outputDirs.outputRoot, resultShot);
    });

    await page.close();
    await context.close();

    // Move recorded video to stable name
    const entries = fs.existsSync(outputDirs.videosTmp) ? fs.readdirSync(outputDirs.videosTmp) : [];
    for (const entry of entries) {
      if (!entry.toLowerCase().endsWith('.webm')) continue;
      const src = path.join(outputDirs.videosTmp, entry);
      const dest = path.join(outputDirs.videos, `${runId}__${scenarioId}__flow.webm`);
      const finalDest = fs.existsSync(dest)
        ? path.join(outputDirs.videos, `${runId}__${scenarioId}__flow_${Date.now()}.webm`)
        : dest;
      fs.renameSync(src, finalDest);
      scenario.videoFiles.push(path.relative(outputDirs.outputRoot, finalDest));
    }

    const logFile = path.join(outputDirs.logs, `${runId}__${scenarioId}.log.json`);
    fs.writeFileSync(
      logFile,
      JSON.stringify(
        { console: scenario.console, pageErrors: scenario.pageErrors, requestFailed: scenario.requestFailed },
        null,
        2
      ),
      'utf8'
    );
    scenario.logFile = path.relative(outputDirs.outputRoot, logFile);

    report.scenarios.push(scenario);
    await browser.close();
  } finally {
    if (serverProc) {
      const serverLog = path.join(outputDirs.logs, `${runId}__local_server.auth_admin.log.txt`);
      try {
        fs.writeFileSync(serverLog, serverProc.getOutput(), 'utf8');
        report.localServerLog = path.relative(outputDirs.outputRoot, serverLog);
      } catch {
        // ignore
      }
      await stopLocalServer(serverProc);
    }
  }

  const reportPath = path.join(outputDirs.reports, `${runId}__auth-admin-audit.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

  // eslint-disable-next-line no-console
  console.log(`[audit-auth-admin] Done. Report: ${reportPath}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});
