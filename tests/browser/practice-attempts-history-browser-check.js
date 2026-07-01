const assert = require('assert');
const { chromium } = require('playwright');
const http = require('http');
const {
    readBrowserTestCredentials,
    redactAuthIdentity
} = require('./helpers/browser-test-credentials');

const TAG = '[Attempts-History]';
const ORIGIN = 'https://localhost:8443';
const EMULATOR_HOST = 'http://localhost:9099';
const API_KEY = 'AIzaSyB0vXX7NwOvME_XoaGiJlYaiLRcaHJtrIQ';
const PROJECT_ID = 'listening-tasks-3ae34';
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
    const signupUrl = `${EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`;
    const signup = await httpRequest(signupUrl, 'POST', { email, password, returnSecureToken: true });

    let localId;
    if (signup.status === 200) {
        localId = signup.body.localId;
        if (browserTestCredentials) browserTestCredentials.localId = localId;
    } else if (signup.body?.error?.message === 'EMAIL_EXISTS') {
        const signinUrl = `${EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`;
        const signin = await httpRequest(signinUrl, 'POST', { email, password, returnSecureToken: true });
        if (signin.status === 200) {
            localId = signin.body.localId;
            if (browserTestCredentials) browserTestCredentials.localId = localId;
        } else {
            throw new Error(`Could not sign in existing emulator user: ${signin.status}`);
        }
    } else {
        throw new Error(`Unexpected emulator response: ${signup.status}`);
    }

    const adminUrl = `${EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:update`;
    await httpRequest(adminUrl, 'POST', { localId, emailVerified: true }, { 'Authorization': 'Bearer owner' });

    return localId;
}

async function dismissPreloader(page) {
    await page.waitForFunction(() => {
        const el = document.getElementById('app-preloader');
        if (!el) return true;
        return getComputedStyle(el).display === 'none'
            || Boolean(document.getElementById('preloader-dismiss-btn'));
    }, { timeout: 20000 });

    const btn = page.locator('#preloader-dismiss-btn');
    if (await btn.count()) {
        try { await btn.click({ timeout: 3000 }); } catch (_) {}
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

(async () => {
    browserTestCredentials = readBrowserTestCredentials();
    const { email, password } = browserTestCredentials;

    console.log(TAG, 'Provisioning user...');
    await provisionEmulatorUser(email, password);

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        viewport: { width: 1440, height: 1200 },
        ignoreHTTPSErrors: true
    });
    const page = await context.newPage();
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));

    // Setup local storage to disable tutorials
    await page.addInitScript(() => {
        ['type', 'collo-dictate', 'speak', 'extended', 'watch', 'notes', 'pronounce', 'read-aloud', 'rfib']
            .forEach((m) => localStorage.setItem(`${m}ModeFirstUse`, 'true'));
        window.addEventListener('DOMContentLoaded', () => {
            const style = document.createElement('style');
            style.textContent = '#level-selection-modal { display: none !important; }';
            document.head.appendChild(style);
        });
    });

    // Mock admin status to bypass classroom redirect
    await page.route('**/api/admin/status*', (route) => {
        route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ success: true, isAdmin: true })
        });
    });

    // Setup active question ID and mock attempts lists
    let activeEssayId = '1';
    let activeSwtId = '1';

    await page.route(url => url.pathname.includes('/api/practice-attempts'), (route) => {
        const urlStr = route.request().url();
        console.log(TAG, 'Intercepted API request:', urlStr);
        if (urlStr.includes('/get') || urlStr.includes('/att_') || urlStr.includes('attempt-1')) {
            const isSwt = urlStr.includes('swt-attempt-1');
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    success: true,
                    attempt: {
                        attemptId: isSwt ? 'swt-attempt-1' : 'essay-attempt-1',
                        practiceMode: isSwt ? 'swt' : 'essay',
                        submittedAt: { _seconds: 1782897877, _nanoseconds: 0 },
                        score: isSwt ? 1 : 78,
                        promptSnapshot: {
                            promptId: isSwt ? activeSwtId : activeEssayId,
                            title: isSwt ? 'Mocked SWT Prompt' : 'Mocked Essay Prompt',
                            prompt: 'Mocked prompt body'
                        },
                        responseSnapshot: {
                            text: isSwt ? 'Mocked swt response' : 'Mocked essay response'
                        },
                        resultSnapshot: {
                            overall: { total: isSwt ? 1 : 78, maxTotal: isSwt ? 1 : 90, percent: 86 }
                        }
                    }
                })
            });
        } else {
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    success: true,
                    attempts: [
                        {
                            attemptId: 'essay-attempt-1',
                            practiceMode: 'essay',
                            submittedAt: { _seconds: 1782897877, _nanoseconds: 0 },
                            score: 78,
                            promptId: activeEssayId,
                            responseSummary: 'This is the mocked essay attempt response summary.'
                        },
                        {
                            attemptId: 'swt-attempt-1',
                            practiceMode: 'swt',
                            submittedAt: { _seconds: 1782897899, _nanoseconds: 0 },
                            score: 1,
                            promptId: activeSwtId,
                            responseSummary: 'This is the mocked swt attempt response summary.'
                        }
                    ]
                })
            });
        }
    });

    try {
        console.log(TAG, 'Navigating to login page...');
        await page.goto(`${ORIGIN}/index.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await dismissPreloader(page);

        // Open auth panel to log in
        const entryModal = page.locator('#entry-modal');
        if (await entryModal.isVisible().catch(() => false)) {
            const loginChoiceBtn = page.locator('#login-choice-btn');
            if (await loginChoiceBtn.isVisible().catch(() => false)) {
                await loginChoiceBtn.click();
            } else {
                const guestBtn = page.locator('#guest-mode-btn');
                if (await guestBtn.isVisible().catch(() => false)) await guestBtn.click();
            }
        }
        await waitForLayout(page);

        const authOverlay = page.locator('#auth-overlay');
        const isAuthVisible = await authOverlay.evaluate((el) => getComputedStyle(el).display !== 'none').catch(() => false);
        if (!isAuthVisible) {
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

        console.log(TAG, 'Logging in...');
        await page.waitForSelector('#login-email', { state: 'visible' });
        await page.fill('#login-email', email);
        await page.fill('#login-password', password);
        await page.click('#login-form-element button[type="submit"]');

        await page.waitForFunction(() => {
            const wrapper = document.getElementById('page-layout-wrapper');
            const authOvl = document.getElementById('auth-overlay');
            return wrapper && getComputedStyle(wrapper).display !== 'none' && (!authOvl || getComputedStyle(authOvl).display === 'none');
        }, { timeout: 30000 });

        // Select level selection bypass
        const levelModal = page.locator('#level-selection-modal');
        if (await levelModal.isVisible().catch(() => false)) {
            await page.evaluate(() => {
                const modal = document.getElementById('level-selection-modal');
                if (modal) modal.style.display = 'none';
            });
        }

        // Toggle to PTE scope
        await page.click('[data-practice-scope="pte"]');
        await page.waitForTimeout(500);

        // ── Verify Write Essay Mode History ──
        console.log(TAG, 'Entering Essay practice...');
        await page.click('[data-practice-skill="writing"]');
        await page.waitForTimeout(200);
        await page.click('#mode-btn-essay');

        await page.waitForFunction(() => {
            const p = document.getElementById('mode-essay');
            return p && getComputedStyle(p).display !== 'none';
        }, { timeout: 10000 });

        // Get actual active essay ID from DOM
        activeEssayId = await page.evaluate(() => {
            return document.getElementById('current-question-id-essay').textContent.trim();
        });
        console.log(TAG, 'Active Essay question ID:', activeEssayId);

        // Check if toggle button exists
        const essayToggle = page.locator('#essay-history-toggle');
        await essayToggle.waitFor({ state: 'visible', timeout: 5000 });
        assert.ok(await essayToggle.isVisible(), 'Essay history toggle button should be visible');

        // Click history toggle
        console.log(TAG, 'Opening Essay history list...');
        await essayToggle.click();
        const essayHistoryContainer = page.locator('#essay-history-container');
        await essayHistoryContainer.waitFor({ state: 'visible' });

        await page.waitForTimeout(1000);
        console.log(TAG, 'History Container HTML:', await essayHistoryContainer.innerHTML());
        
        // Assert attempt list content is shown
        const firstHistoryItemText = await page.textContent('.history-attempt-content');
        assert.ok(firstHistoryItemText.includes('mocked essay attempt'), 'History list should render correct responseSummary');

        // Click for details modal
        console.log(TAG, 'Clicking Essay detail details button...');
        await page.click('#essay-history-container .history-details-btn');
        const modal = page.locator('.pte-attempt-review-overlay');
        await modal.waitFor({ state: 'visible' });
        
        // Assert review modal body has the user answer
        await page.waitForFunction(() => {
            const body = document.querySelector('.pte-attempt-review-body');
            return body && body.textContent.includes('Mocked essay response');
        }, { timeout: 5000 });
        
        // Close modal
        await page.click('.pte-attempt-review-close-btn');
        await modal.waitFor({ state: 'hidden' });

        // ── Verify Summarize Written Text (SWT) Mode History ──
        console.log(TAG, 'Entering SWT practice...');
        
        // Go back to dashboard first
        await page.click('#back-to-dashboard-btn');
        await page.waitForFunction(() => {
            const db = document.getElementById('panel-tutorials');
            return db && getComputedStyle(db).display !== 'none';
        }, { timeout: 10000 });
        
        // Click SWT card on dashboard
        await page.click('#mode-btn-swt');
        await page.waitForFunction(() => {
            const p = document.getElementById('mode-swt');
            return p && getComputedStyle(p).display !== 'none';
        }, { timeout: 10000 });

        // Get actual active SWT ID from DOM
        activeSwtId = await page.evaluate(() => {
            const pill = document.getElementById('swt-v7-question-pill');
            const match = pill ? pill.textContent.match(/^#(\S+)/) : null;
            return match ? match[1] : '1';
        });
        console.log(TAG, 'Active SWT question ID:', activeSwtId);

        // Check if toggle button exists
        const swtToggle = page.locator('#swt-history-toggle');
        await swtToggle.waitFor({ state: 'visible', timeout: 5000 });
        assert.ok(await swtToggle.isVisible(), 'SWT history toggle button should be visible');

        // Click history toggle
        console.log(TAG, 'Opening SWT history list...');
        await swtToggle.click();
        const swtHistoryContainer = page.locator('#swt-history-container');
        await swtHistoryContainer.waitFor({ state: 'visible' });

        // Assert attempt list content is shown
        const firstSwtHistoryItemText = await page.textContent('#swt-history-container .history-attempt-content');
        assert.ok(firstSwtHistoryItemText.includes('mocked swt attempt'), 'SWT History list should render correct responseSummary');

        // Click details button
        console.log(TAG, 'Clicking SWT details button...');
        await page.click('#swt-history-container .history-details-btn');
        await modal.waitFor({ state: 'visible' });

        // Assert review modal body has the user answer
        await page.waitForFunction(() => {
            const body = document.querySelector('.pte-attempt-review-body');
            return body && body.textContent.includes('Mocked swt response');
        }, { timeout: 5000 });

        console.log(TAG, 'Attempts history E2E checks passed perfectly!');
    } finally {
        await browser.close();
    }
})().catch((error) => {
    console.error(redactAuthIdentity(error.stack || error.message, browserTestCredentials || {}));
    process.exit(1);
});
