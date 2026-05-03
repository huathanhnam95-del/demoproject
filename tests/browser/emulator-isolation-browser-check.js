/**
 * Emulator Isolation Browser Check (Chrome/Playwright)
 *
 * Goal:
 *   Prove that local dev (`https://localhost:8443`) never touches production Firebase endpoints.
 *
 * Prerequisites:
 *   - Start everything with `npm run dev` (recommended) OR `start-emulators.bat`
 *   - Emulator UI:   http://localhost:4000
 *   - Auth:          localhost:9099
 *   - Firestore:     localhost:8080
 *
 * Credentials:
 *   - Reads from `C:\Cursor AI\.local\browser-test-credentials.md` (do not inline).
 */

/* eslint-disable no-console */
const assert = require('assert');
const http = require('http');
const { chromium } = require('playwright');
const {
  readBrowserTestCredentials,
  redactAuthIdentity
} = require('./helpers/browser-test-credentials');

const TAG = '[Emulator isolation]';
const ORIGIN = 'https://localhost:8443';
const EMULATOR_AUTH_HOST = 'http://localhost:9099';
const PROJECT_ID = 'listening-tasks-3ae34';
const API_KEY = 'AIzaSyB0vXX7NwOvME_XoaGiJlYaiLRcaHJtrIQ';
let browserTestCredentials = null;

function httpRequest(url, method, body, headers = {}) {
  const payload = body ? JSON.stringify(body) : '';
  return new Promise((resolve) => {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json', ...headers }
    };
    const req = http.request(url, opts, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (_) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', (err) => { resolve({ status: 0, body: err.message }); });
    if (payload) req.write(payload);
    req.end();
  });
}

async function provisionEmulatorUser(email, password) {
  const signupUrl = `${EMULATOR_AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`;
  const signup = await httpRequest(signupUrl, 'POST', { email, password, returnSecureToken: true });

  let localId;
  if (signup.status === 200) {
    localId = signup.body.localId;
    console.log(TAG, 'Emulator user provisioned for the browser test account.');
  } else if (signup.body?.error?.message === 'EMAIL_EXISTS') {
    const signinUrl = `${EMULATOR_AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`;
    const signin = await httpRequest(signinUrl, 'POST', { email, password, returnSecureToken: true });
    if (signin.status === 200) {
      localId = signin.body.localId;
      console.log(TAG, 'Existing emulator browser test account is ready.');
    } else if (signin.status === 0) {
      throw new Error('Firebase Auth Emulator not reachable on port 9099. Start with: npm run dev');
    } else {
      throw new Error(`Could not sign in existing emulator user: ${signin.status} ${JSON.stringify(signin.body).slice(0, 200)}`);
    }
  } else if (signup.status === 0) {
    throw new Error('Firebase Auth Emulator not reachable on port 9099. Start with: npm run dev');
  } else {
    throw new Error(`Unexpected emulator signup response: ${signup.status} ${JSON.stringify(signup.body).slice(0, 200)}`);
  }

  // Mark email as verified so app auth policy passes.
  const adminUrl = `${EMULATOR_AUTH_HOST}/identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:update`;
  const adminRes = await httpRequest(
    adminUrl,
    'POST',
    { localId, emailVerified: true },
    { Authorization: 'Bearer owner' }
  );
  if (adminRes.status !== 200) {
    throw new Error(`Failed to mark emulator user emailVerified: ${adminRes.status} ${JSON.stringify(adminRes.body).slice(0, 200)}`);
  }
}

async function dismissPreloader(page) {
  await page.waitForFunction(() => {
    const preloader = document.getElementById('app-preloader');
    if (!preloader) return true;
    const display = getComputedStyle(preloader).display;
    const dismiss = document.getElementById('preloader-dismiss-btn');
    return display === 'none' || Boolean(dismiss);
  }, { timeout: 20000 });

  const dismissButton = page.locator('#preloader-dismiss-btn');
  if (await dismissButton.isVisible().catch(() => false)) {
    await dismissButton.click();
  }

  await page.waitForFunction(() => {
    const preloader = document.getElementById('app-preloader');
    return !preloader || getComputedStyle(preloader).display === 'none';
  }, { timeout: 20000 });
}

async function waitForLayout(page) {
  await page.waitForFunction(() => {
    const wrapper = document.getElementById('page-layout-wrapper');
    if (!wrapper) return false;
    return getComputedStyle(wrapper).display !== 'none';
  }, { timeout: 20000 });
}

async function waitForPredicate(fn, timeoutMs = 15000, intervalMs = 250) {
  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (await fn()) return;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out after ${timeoutMs}ms waiting for condition.`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

(async () => {
  browserTestCredentials = readBrowserTestCredentials();
  const { email, password } = browserTestCredentials;
  await provisionEmulatorUser(email, password);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    ignoreHTTPSErrors: true
  });
  const page = await context.newPage();

  const consoleLines = [];
  const pageErrors = [];
  const blockedProductionHosts = [];
  const emulatorPortsSeen = new Set();

  const PROD_HOST_BLOCKLIST = new Set([
    'firestore.googleapis.com',
    'identitytoolkit.googleapis.com',
    'securetoken.googleapis.com',
    'firebasestorage.googleapis.com'
  ]);

  page.on('console', (msg) => {
    const text = redactAuthIdentity(msg.text(), browserTestCredentials || {});
    consoleLines.push(text);
    if (msg.type() === 'error') {
      console.error('BROWSER console.error:', text);
    }
  });
  page.on('pageerror', (err) => pageErrors.push(redactAuthIdentity(err?.message || String(err), browserTestCredentials || {})));
  page.on('request', (req) => {
    const url = req.url();
    try {
      const parsed = new URL(url);
      const hostname = parsed.hostname;
      const port = parsed.port;

      if (PROD_HOST_BLOCKLIST.has(hostname) || hostname.endsWith('.cloudfunctions.net')) {
        blockedProductionHosts.push(url);
      }

      if (hostname === 'localhost' || hostname === '127.0.0.1') {
        if (port) emulatorPortsSeen.add(Number(port));
      }
    } catch (_e) {
      // ignore unparsable URLs (shouldn't happen)
    }
  });

  try {
    // Suppress first-use tutorials.
    await page.addInitScript(() => {
      ['type', 'collo-dictate', 'speak', 'extended', 'watch', 'notes', 'pronounce', 'read-aloud', 'rfib']
        .forEach((m) => localStorage.setItem(`${m}ModeFirstUse`, 'true'));
    });

    console.log(TAG, 'Navigating to', `${ORIGIN}/index.html`);
    await page.goto(`${ORIGIN}/index.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await dismissPreloader(page);

    // Entry modal: click "Log in" if present, otherwise proceed.
    const entryModal = page.locator('#entry-modal');
    if (await entryModal.isVisible().catch(() => false)) {
      const loginChoiceBtn = page.locator('#login-choice-btn');
      if (await loginChoiceBtn.isVisible().catch(() => false)) {
        await loginChoiceBtn.click();
      }
    }
    await waitForLayout(page);

    // Open auth overlay if needed
    const authOverlay = page.locator('#auth-overlay');
    if (!await authOverlay.isVisible().catch(() => false)) {
      const toggle = page.locator('#account-panel-toggle');
      if (await toggle.isVisible().catch(() => false)) {
        await toggle.click();
        await page.waitForTimeout(300);
      }
      for (const id of ['#panel-login-btn', '#panel-guest-login-btn']) {
        const btn = page.locator(id);
        if (await btn.isVisible().catch(() => false)) {
          await btn.click();
          break;
        }
      }
    }

    // Fill login form
    await page.waitForSelector('#login-email', { state: 'visible', timeout: 15000 });
    await page.fill('#login-email', email);
    await page.fill('#login-password', password);
    await page.click('#login-form-element button[type="submit"]');

    // Wait for overlay to close (auth success)
    await waitForPredicate(async () => {
      const visible = await authOverlay.isVisible().catch(() => false);
      return !visible;
    }, 20000);

    // Assertions: modular emulator banner
    await waitForPredicate(async () => consoleLines.some((l) => l.includes('[Modular SDK] Firebase Emulators active')), 15000);

    // Navigate to a compat flow and assert compat emulator banner.
    console.log(TAG, 'Navigating to compat page', `${ORIGIN}/classroom.html`);
    await page.goto(`${ORIGIN}/classroom.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForPredicate(async () => consoleLines.some((l) => l.includes('[AuthGuard] Compat emulators connected')), 15000);

    // Wait until we see emulator traffic for both Auth and Firestore.
    await waitForPredicate(async () => emulatorPortsSeen.has(9099), 15000);
    await waitForPredicate(async () => emulatorPortsSeen.has(8080), 20000);

    assert.strictEqual(pageErrors.length, 0, `Page errors encountered:\n${pageErrors.join('\n')}`);
    assert.strictEqual(blockedProductionHosts.length, 0, `Production Firebase endpoints were contacted:\n${blockedProductionHosts.join('\n')}`);

    console.log(TAG, 'PASS');
    console.log(TAG, 'Emulator ports observed:', Array.from(emulatorPortsSeen).sort((a, b) => a - b).join(', '));
  } finally {
    await browser.close().catch(() => null);
  }
})().catch((err) => {
  console.error(TAG, 'FAIL:', redactAuthIdentity(err?.stack || err, browserTestCredentials || {}));
  process.exit(1);
});
