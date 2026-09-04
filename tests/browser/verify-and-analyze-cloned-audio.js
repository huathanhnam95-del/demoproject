/* eslint-disable no-console */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { readBrowserTestCredentials, redactAuthIdentity } = require('c:\\Cursor AI\\tests\\browser\\helpers\\browser-test-credentials');

const ROOT = path.resolve('c:\\Cursor AI');
const ORIGIN = process.env.VOICE_CLONING_ORIGIN || 'https://listening-tasks-3ae34.web.app';
const PINCHED_AUDIO_PATH = path.resolve('C:\\Users\\Admin\\Downloads\\c85d215e-8084-4cc7-b770-707d7599d237.weba');
const SCREENSHOT_PATH = path.resolve('C:\\Users\\Admin\\.gemini\\antigravity\\brain\\2ddf6a08-4267-4057-9a48-c01821deadde\\live_voice_cloning_studio_verified.png');
const OUTPUT_MP3_PATH = path.resolve('C:\\Users\\Admin\\Downloads\\live_browser_cloned_voice.mp3');
const JOB_ID = 'test_1788517544420_b6abd977';

async function signInOnPage(page, credentials) {
    return page.evaluate(async ({ email, password }) => {
        const auth = window.__FIREBASE_INTERNAL__?.auth;
        if (!auth) throw new Error('Production Firebase auth is not available on index.html.');
        const { signInWithEmailAndPassword } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const result = await signInWithEmailAndPassword(auth, email, password);
        return { uid: result?.user?.uid || '' };
    }, credentials);
}

(async () => {
    console.log('=== Checking Live Browser Voice Cloning Completion ===');
    console.log(`Job ID: ${JOB_ID}`);

    const credentials = readBrowserTestCredentials();
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        viewport: { width: 1440, height: 960 },
        ignoreHTTPSErrors: true
    });
    const page = await context.newPage();

    // Intercept workspace script to serve local fixed code
    await page.route('**/js/crm/voice-cloning-workspace.js*', async (route) => {
        const localScriptPath = path.join(ROOT, 'public', 'js', 'crm', 'voice-cloning-workspace.js');
        const content = fs.readFileSync(localScriptPath, 'utf8');
        await route.fulfill({
            status: 200,
            contentType: 'application/javascript; charset=utf-8',
            body: content
        });
    });

    try {
        console.log('Step 1: Signing in on index.html...');
        await page.goto(`${ORIGIN}/index.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForFunction(() => Boolean(window.__FIREBASE_INTERNAL__?.auth), null, { timeout: 30000 });
        await signInOnPage(page, credentials);

        console.log('Step 2: Navigating to CRM Admin Voice Cloning tab...');
        await page.goto(`${ORIGIN}/crm-admin.html#voice-cloning`, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(3000);

        const navBtn = page.locator('button.crm-nav-item[data-main="voice-cloning"]');
        if (await navBtn.isVisible()) {
            await navBtn.click();
            await page.waitForTimeout(1000);
        }

        console.log(`Step 3: Waiting for job ${JOB_ID} to complete in UI (timeout: 5m)...`);
        await page.waitForFunction((jobId) => {
            const player = document.getElementById('vc-test-audio-player');
            const box = document.getElementById('vc-test-output-box');
            return box && box.style.display !== 'none' && player && player.src && player.src.includes(jobId);
        }, JOB_ID, { timeout: 300000, polling: 2000 });

        const metricsBadge = page.locator('#vc-test-metrics-badge');
        const metricsText = (await metricsBadge.textContent()) || '';
        console.log(`Job ${JOB_ID} finished! Metrics text: "${metricsText.trim()}"`);

        // Capture screenshot of the verified live UI
        await page.screenshot({ path: SCREENSHOT_PATH, fullPage: false });
        console.log(`Screenshot saved to: ${SCREENSHOT_PATH}`);

        // Download cloned MP3
        console.log('Step 4: Downloading cloned MP3 audio...');
        const audioUrl = `/api/admin/voice-cloning/audio/${JOB_ID}`;
        const audioBuffer = await page.evaluate(async (url) => {
            const user = window.firebase?.auth?.().currentUser;
            const headers = {};
            if (user) {
                const token = await user.getIdToken();
                headers['Authorization'] = `Bearer ${token}`;
            }
            const res = await fetch(url, { headers });
            const arrayBuf = await res.arrayBuffer();
            return Array.from(new Uint8Array(arrayBuf));
        }, audioUrl);

        fs.writeFileSync(OUTPUT_MP3_PATH, Buffer.from(audioBuffer));
        console.log(`Downloaded ${audioBuffer.length} bytes to: ${OUTPUT_MP3_PATH}`);
        console.log('=== Browser check successfully completed! ===');
    } catch (err) {
        console.error('Error during verification:', err);
        process.exit(1);
    } finally {
        await browser.close();
    }
})();
