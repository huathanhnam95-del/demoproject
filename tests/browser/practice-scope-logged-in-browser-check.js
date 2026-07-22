/**
 * Practice Scope Logged-In Browser Check
 *
 * Covers:
 *  - Real Firebase login via the app's auth UI (emulator-backed)
 *  - Scope toggle behavior while authenticated
 *  - PTE scope persistence across reload while logged in
 *  - No auth overlay or redirect interferes with scope changes
 *
 * Prerequisites:
 *  - Start local dev with emulators (recommended): `npm run dev`
 *    - Or: `start-emulators.bat`
 *  - App server running on https://localhost:8443
 *  - Auth emulator reachable on http://localhost:9099
 *
 * Credentials: reads from .local/browser-test-credentials.md
 */

/* eslint-disable no-console */
const assert = require('assert');
const http = require('http');
const { chromium } = require('playwright');
const {
    readBrowserTestCredentials,
    redactAuthIdentity
} = require('./helpers/browser-test-credentials');

const TAG = '[Logged-in]';
const EMULATOR_HOST = 'http://localhost:9099';
const API_KEY = 'AIzaSyB0vXX7NwOvME_XoaGiJlYaiLRcaHJtrIQ';
const PROJECT_ID = 'listening-tasks-3ae34';
const ORIGIN = 'https://localhost:8443';
let browserTestCredentials = null;

// ── Utilities ──────────────────────────────────────────────────────────

/**
 * Send an HTTP request and return { status, body }.
 * Body is parsed as JSON if possible, otherwise returned as string.
 */
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

// ── Emulator Provisioning ──────────────────────────────────────────────

/**
 * Pre-create the test user in the Firebase Auth Emulator and set
 * emailVerified=true via the emulator's admin API.
 *
 * Uses two endpoints:
 *  1. identitytoolkit/accounts:signUp (or signInWithPassword) to get localId
 *  2. projects/{pid}/accounts:update with Authorization: Bearer owner
 */
async function provisionEmulatorUser(email, password) {
    // Step 1: Create user (or sign in if already exists) to get localId
    const signupUrl = `${EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`;
    const signup = await httpRequest(signupUrl, 'POST', { email, password, returnSecureToken: true });

    let localId;
    if (signup.status === 200) {
        localId = signup.body.localId;
        if (browserTestCredentials) browserTestCredentials.localId = localId;
        console.log(TAG, 'Emulator user provisioned for the browser test account.');
    } else if (signup.body?.error?.message === 'EMAIL_EXISTS') {
        const signinUrl = `${EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`;
        const signin = await httpRequest(signinUrl, 'POST', { email, password, returnSecureToken: true });
        if (signin.status === 200) {
            localId = signin.body.localId;
            if (browserTestCredentials) browserTestCredentials.localId = localId;
            console.log(TAG, 'Existing emulator browser test account is ready.');
        } else {
            throw new Error(`Could not sign in existing emulator user: ${signin.status}`);
        }
    } else if (signup.status === 0) {
        throw new Error(`Firebase Auth Emulator not reachable on port 9099. Run: firebase emulators:start --only auth`);
    } else {
        throw new Error(`Unexpected emulator signup response: ${signup.status} ${JSON.stringify(signup.body).slice(0, 200)}`);
    }

    // Step 2: Set emailVerified=true via the admin API (requires "Bearer owner" auth)
    const adminUrl = `${EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:update`;
    const adminRes = await httpRequest(adminUrl, 'POST', { localId, emailVerified: true }, { 'Authorization': 'Bearer owner' });
    if (adminRes.status === 200) {
        console.log(TAG, 'emailVerified set to true via admin API');
    } else {
        throw new Error(`Failed to set emailVerified: ${adminRes.status} ${JSON.stringify(adminRes.body).slice(0, 200)}`);
    }

    return localId;
}

// ── Page Helpers ────────────────────────────────────────────────────────

async function dismissPreloader(page) {
    await page.waitForFunction(() => {
        const el = document.getElementById('app-preloader');
        if (!el) return true;
        return getComputedStyle(el).display === 'none'
            || Boolean(document.getElementById('preloader-dismiss-btn'));
    }, { timeout: 20000 });

    const btn = page.locator('#preloader-dismiss-btn');
    if (await btn.count()) {
        try { await btn.click({ timeout: 3000 }); } catch (_) { /* auto-dismiss */ }
    }

    await page.waitForFunction(() => {
        const el = document.getElementById('app-preloader');
        return !el || getComputedStyle(el).display === 'none';
    }, { timeout: 15000 });
}

async function waitForLayout(page, timeout = 15000) {
    await page.waitForFunction(() => {
        const w = document.getElementById('page-layout-wrapper');
        return w && getComputedStyle(w).display !== 'none';
    }, { timeout });
}

async function isElementVisible(locator) {
    return locator.evaluate((el) => getComputedStyle(el).display !== 'none').catch(() => false);
}

async function hideLevelSelectionModalIfVisible(page) {
    const levelModal = page.locator('#level-selection-modal');
    if (!await isElementVisible(levelModal)) {
        return;
    }

    console.log(TAG, 'Hiding level selection modal (no click to avoid page reload)...');
    await page.evaluate(() => {
        const modal = document.getElementById('level-selection-modal');
        if (modal) modal.style.display = 'none';
    });
    await page.waitForTimeout(500);
}

/**
 * Assert the user is authenticated by checking firebase.auth().currentUser.
 * We check the Firebase auth object directly rather than panel DOM because
 * the panel update depends on onAuthStateChanged completing Firestore
 * operations (startSession, checkLevelSelection, etc.) which may hang
 * when only the Auth emulator is running without Firestore.
 */
async function assertAuthenticated(page, expectedEmail, label) {
    // Poll window.firebaseAuthFunctions.getCurrentUser() for up to 15 seconds.
    // Note: The app uses the MODULAR Firebase SDK for auth (firebase-auth-module.js),
    // exposed as window.firebaseAuthFunctions. The compat SDK (window.firebase) is a
    // separate instance, so firebase.auth().currentUser would return null.
    const authState = await page.evaluate((timeout) => {
        return new Promise((resolve) => {
            let attempts = 0;
            const maxAttempts = timeout / 250;
            const poll = setInterval(() => {
                attempts++;
                const fns = window.firebaseAuthFunctions;
                const user = fns && typeof fns.getCurrentUser === 'function'
                    ? fns.getCurrentUser() : null;
                if (user || attempts > maxAttempts) {
                    clearInterval(poll);
                    resolve({
                        email: user?.email || null,
                        uid: user?.uid || null,
                        emailVerified: user?.emailVerified || false,
                        isNull: !user
                    });
                }
            }, 250);
        });
    }, 15000);

    assert.ok(!authState.isNull,
        `[${label}] browser test user should be authenticated`);
    // Avoid assert.strictEqual() so we never print the real email in assertion diffs.
    assert.ok(authState.email === expectedEmail,
        `[${label}] currentUser.email should match the configured browser test credential`);
    assert.ok(authState.emailVerified,
        `[${label}] currentUser.emailVerified should be true`);

    if (browserTestCredentials && authState.uid) {
        browserTestCredentials.uid = authState.uid;
    }

    console.log(TAG, `Auth state verified (${label}): browser test account active, emailVerified=${authState.emailVerified}`);
}

// ── Main Test ──────────────────────────────────────────────────────────

(async () => {
    browserTestCredentials = readBrowserTestCredentials();
    const { email, password } = browserTestCredentials;

    // Pre-create the test account in the Firebase Auth Emulator
    browserTestCredentials.localId = await provisionEmulatorUser(email, password);

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        viewport: { width: 1440, height: 1200 },
        ignoreHTTPSErrors: true
    });
    const page = await context.newPage();

    // Suppress first-use tutorials on every navigation.
    // Clear practiceScope only on the first load (not on reload) using a sessionStorage flag.
    await page.addInitScript(() => {
        ['type', 'collo-dictate', 'speak', 'extended', 'watch', 'notes', 'pronounce', 'read-aloud', 'rfib']
            .forEach((m) => localStorage.setItem(`${m}ModeFirstUse`, 'true'));
        if (!sessionStorage.getItem('__test_initialized__')) {
            localStorage.removeItem('practiceScope');
            sessionStorage.setItem('__test_initialized__', '1');
        }
    });

    // Mock /api/admin/status to return isAdmin:true for the test user.
    // Without this, auth-ui.js:1229-1236 redirects non-admin users to classroom.html.
    await page.route('**/api/admin/status*', (route) => {
        route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ success: true, isAdmin: true })
        });
    });

    try {
        // ── Step 1: Navigate and dismiss preloader ──
        console.log(TAG, 'Navigating to', ORIGIN);
        await page.goto(`${ORIGIN}/index.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        console.log(TAG, 'Dismissing preloader...');
        await dismissPreloader(page);

        // ── Step 2: Handle entry modal OR guest-mode layout ──
        // The app may show an entry modal (with login button) or auto-enter guest mode.
        const entryModal = page.locator('#entry-modal');
        if (await isElementVisible(entryModal)) {
            const loginChoiceBtn = page.locator('#login-choice-btn');
            if (await loginChoiceBtn.isVisible().catch(() => false)) {
                console.log(TAG, 'Entry modal visible -- clicking Log In...');
                await loginChoiceBtn.click();
            } else {
                console.log(TAG, 'Entry modal visible but no login button -- entering guest...');
                const guestBtn = page.locator('#guest-mode-btn');
                if (await guestBtn.isVisible().catch(() => false)) await guestBtn.click();
            }
        } else {
            console.log(TAG, 'No entry modal -- app auto-entered guest mode');
        }
        await waitForLayout(page);

        // ── Step 3: Open auth overlay via account panel ──
        const authOverlay = page.locator('#auth-overlay');
        if (!await isElementVisible(authOverlay)) {
            console.log(TAG, 'Opening account panel to trigger login...');
            const toggle = page.locator('#account-panel-toggle');
            if (await toggle.isVisible().catch(() => false)) {
                await toggle.click();
                await page.waitForTimeout(300);
            }
            // Click whichever login button is visible in the panel
            for (const id of ['#panel-login-btn', '#panel-guest-login-btn']) {
                const btn = page.locator(id);
                if (await btn.isVisible().catch(() => false)) {
                    await btn.click();
                    break;
                }
            }
        }

        // ── Step 4: Fill and submit login form ──
        console.log(TAG, 'Filling browser test credentials...');
        await page.waitForSelector('#login-email', { state: 'visible', timeout: 10000 });
        await page.fill('#login-email', email);
        await page.fill('#login-password', password);
        await page.click('#login-form-element button[type="submit"]');

        // ── Step 5: Wait for auth overlay to close ──
        console.log(TAG, 'Waiting for authenticated layout...');
        await page.waitForFunction(() => {
            const wrapper = document.getElementById('page-layout-wrapper');
            const authOvl = document.getElementById('auth-overlay');
            const loginErr = document.getElementById('login-error');
            const wrapperVisible = wrapper && getComputedStyle(wrapper).display !== 'none';
            const authHidden = !authOvl || getComputedStyle(authOvl).display === 'none';
            // Fail fast on login error
            const errText = loginErr && getComputedStyle(loginErr).display !== 'none'
                ? loginErr.textContent.trim() : '';
            if (errText) throw new Error('Login error: ' + errText);
            return wrapperVisible && authHidden;
        }, { timeout: 30000 });

        // Dismiss level selection modal if it appears after first login.
        // IMPORTANT: Do NOT click a level button — that triggers handleLevelSelection
        // which calls window.location.reload() (auth-ui.js:723). Instead, hide the modal.
        await hideLevelSelectionModalIfVisible(page);
        console.log(TAG, 'Auth layout loaded.');

        // Debug: log current URL before auth assertion
        console.log(TAG, 'Current URL before auth check:', page.url());

        // ── Step 6: Assert authenticated state ──
        await assertAuthenticated(page, email, 'after-login');

        // ── Step 7: Verify PTE default, toggle to English, and back to PTE ──
        console.log(TAG, 'Verifying PTE active by default and toggling...');
        const initialPteActive = await page.evaluate(() =>
            document.querySelector('[data-practice-scope="pte"]')?.getAttribute('aria-pressed')
        );
        assert.strictEqual(initialPteActive, 'true', 'PTE should be active by default while logged in');

        console.log(TAG, 'Toggling to English Practice...');
        await hideLevelSelectionModalIfVisible(page);
        await page.click('[data-practice-scope="english"]');
        await page.waitForTimeout(500);
        const englishActive = await page.evaluate(() =>
            document.querySelector('[data-practice-scope="english"]')?.getAttribute('aria-pressed')
        );
        assert.strictEqual(englishActive, 'true', 'English should be active after toggle while logged in');

        console.log(TAG, 'Toggling back to PTE Practice...');
        await page.click('[data-practice-scope="pte"]');
        await page.waitForTimeout(500);
        const pteActive = await page.evaluate(() =>
            document.querySelector('[data-practice-scope="pte"]')?.getAttribute('aria-pressed')
        );
        assert.strictEqual(pteActive, 'true', 'PTE should be active after toggle back while logged in');

        // ── Step 8: Verify persistence across reload ──
        console.log(TAG, 'Reloading to verify persistence...');
        await page.reload({ waitUntil: 'domcontentloaded' });
        console.log(TAG, 'Dismissing preloader after reload...');
        await dismissPreloader(page);
        await waitForLayout(page, 30000);
        await hideLevelSelectionModalIfVisible(page);

        // ── Step 9: Assert authenticated state survives reload ──
        await assertAuthenticated(page, email, 'after-reload');

        const ptePersisted = await page.evaluate(() => ({
            stored: localStorage.getItem('practiceScope'),
            pressed: document.querySelector('[data-practice-scope="pte"]')?.getAttribute('aria-pressed')
        }));
        assert.strictEqual(ptePersisted.stored, 'pte', 'practiceScope should be "pte" in localStorage after reload');
        assert.strictEqual(ptePersisted.pressed, 'true', 'PTE should remain aria-pressed=true after reload');

        // ── Step 10: Launch a mode to verify no auth collision ──
        console.log(TAG, 'Launching Read Aloud...');
        await page.click('[data-practice-skill="speaking"]');
        await page.waitForTimeout(200);
        await page.click('#mode-btn-read-aloud');
        await page.waitForFunction(() => {
            const p = document.getElementById('mode-read-aloud');
            return p && p.classList.contains('active') && getComputedStyle(p).display !== 'none';
        }, { timeout: 10000 });

        const modeName = await page.evaluate(() =>
            document.getElementById('current-mode-name')?.textContent?.trim() || ''
        );
        assert.strictEqual(modeName, 'Read Aloud', 'Mode indicator should say Read Aloud');

        console.log('Practice scope logged-in browser verification complete.');
    } finally {
        await browser.close();
    }
})().catch((error) => {
    console.error(redactAuthIdentity(error.stack || error.message, browserTestCredentials || {}));
    process.exit(1);
});
