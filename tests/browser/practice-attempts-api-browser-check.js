const assert = require('assert');
const { chromium } = require('playwright');
const {
    readBrowserTestCredentials,
    redactAuthIdentity
} = require('./helpers/browser-test-credentials');

const TAG = '[Pass A1 & B2/B3]';
const ORIGIN = 'https://localhost:8443';

// Extracted from browser-test-credentials / practice-scope-logged-in-browser-check
const http = require('http');
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
            console.error('Sign-in failed. Expected 200, got: ', signin.status, signin.body);
            throw new Error(`Could not sign in existing emulator user`);
        }
    } else {
        console.error('Sign-up failed with unexpected response: ', signup.status, signup.body);
        throw new Error(`Unexpected emulator response`);
    }

    const adminUrl = `${EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:update`;
    await httpRequest(adminUrl, 'POST', { localId, emailVerified: true }, { 'Authorization': 'Bearer owner' });

    const signinUrlAgain = `${EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`;
    const signinAgain = await httpRequest(signinUrlAgain, 'POST', { email, password, returnSecureToken: true });

    return { localId, idToken: signinAgain.body.idToken };
}

(async () => {
    browserTestCredentials = readBrowserTestCredentials();
    const { email, password } = browserTestCredentials;
    const provisioned = await provisionEmulatorUser(email, password);
    browserTestCredentials.localId = provisioned.localId;

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        viewport: { width: 1440, height: 1200 },
        ignoreHTTPSErrors: true
    });
    const page = await context.newPage();

    let guestPassed = false;
    let emulatorToken = null;
    try {
        emulatorToken = provisioned.idToken;
        console.log(TAG, 'Navigating and testing Guest access...');
        await page.goto(`${ORIGIN}/index.html?testMode=true`, { waitUntil: 'domcontentloaded' });

        // B1: Guest gating
        const guestRes = await page.evaluate(async () => {
            const r = await fetch('/api/practice-attempts/prepare', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ practiceMode: 'read_aloud', promptSnapshot: { promptId: '1', title: 'A', text: 'B' } })
            });
            return { status: r.status, body: await r.json().catch(() => null) };
        });
        if (guestRes.status !== 401) {
            console.error(TAG, 'Guest prepare failed security: ', JSON.stringify(guestRes));
        }
        assert.strictEqual(guestRes.status, 401, 'Guest prepare should return 401 UNAUTHORIZED');
        console.log(TAG, 'Guest gating verified.');
        guestPassed = true;

        console.log(TAG, 'Logged in via Node. Running API smoke tests...');

        const testPrepare = async (practiceMode, expectedHardMax, expectedUiMax, existingAttemptId = null) => {
            return await page.evaluate(async ({ pm, eHard, eUi, eid, tk }) => {
                const res = await fetch('/api/practice-attempts/prepare', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` },
                    body: JSON.stringify({
                        practiceMode: pm,
                        attemptId: eid,
                        promptSnapshot: { promptId: 'local', title: 'Local', text: 'hello' }
                    })
                });
                const status = res.status;
                const body = await res.json().catch(() => null);

                if (status === 200) {
                    const data = body.data || body;
                    if (data.constraints.hardMaxSeconds !== eHard || data.constraints.uiMaxSeconds !== eUi) {
                        return { status: 400, body: `Constraint mismatch. Expected ${eHard}/${eUi}, got ${data.constraints?.hardMaxSeconds}/${data.constraints?.uiMaxSeconds}` };
                    }
                    const audioPath = data.audioPath || data.upload?.path;
                    if (!data.attemptId || data.status !== 'awaiting_upload' || !audioPath) {
                        return { status: 400, body: `Missing required contract fields: attemptId=${data.attemptId} status=${data.status} audioPath=${audioPath}` };
                    }
                }

                return { status, body };
            }, { pm: practiceMode, eHard: expectedHardMax, eUi: expectedUiMax, eid: existingAttemptId, tk: emulatorToken });
        };

        // B2: Logged in prepare constraints
        console.log(TAG, 'Testing read_aloud (40/40)...');
        const raRes = await testPrepare('read_aloud', 40, 40);
        if (raRes.status !== 200) {
            console.error('read_aloud prepare failed:', raRes.status, JSON.stringify(raRes.body));
        }
        assert.strictEqual(raRes.status, 200, 'prepare read_aloud should succeed');
        const readAloudId = raRes.body.data ? raRes.body.data.attemptId : raRes.body.attemptId;

        console.log(TAG, 'Testing repeat_sentence (15/15)...');
        const rsRes = await testPrepare('repeat_sentence', 15, 15);
        assert.strictEqual(rsRes.status, 200, 'prepare repeat_sentence should succeed');

        console.log(TAG, 'Testing retell_lecture (45/40)...');
        const rlRes = await testPrepare('retell_lecture', 45, 40);
        assert.strictEqual(rlRes.status, 200, 'prepare retell_lecture should succeed');

        console.log(TAG, 'Testing future_mode rejection...');
        const fmRes = await testPrepare('some_future_mode_key', 60, 60);
        assert.strictEqual(fmRes.status, 400, 'prepare future_mode should reject modes outside the PTE allowlist');

        // B3: Prepare idempotency
        console.log(TAG, 'Testing idempotency...');
        const idempotentRes = await testPrepare('read_aloud', 40, 40, readAloudId);
        assert.strictEqual(idempotentRes.status, 200, 'idempotent prepare should succeed');

        const secondAttemptId = idempotentRes.body.data ? idempotentRes.body.data.attemptId : idempotentRes.body.attemptId;
        assert.strictEqual(secondAttemptId, readAloudId, 'idempotent prepare should return same attemptId');

        // Mode mismatch failure
        console.log(TAG, 'Testing mode mismatch...');
        const mismatchRes = await page.evaluate(async ({ aid, tk }) => {
            const res = await fetch('/api/practice-attempts/prepare', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` },
                body: JSON.stringify({ practiceMode: 'repeat_sentence', attemptId: aid })
            });
            return res.status;
        }, { aid: readAloudId, tk: emulatorToken });
        assert.strictEqual(mismatchRes, 409, 'mode mismatch should return 409 ATTEMPT_ID_MODE_MISMATCH');

        console.log(TAG, 'Pass A1 checks complete!');

    } finally {
        await browser.close();
    }
})().catch((error) => {
    console.error(redactAuthIdentity(error.stack || error.message, browserTestCredentials || {}));
    process.exit(1);
});
