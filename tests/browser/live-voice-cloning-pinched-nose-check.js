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
    console.log('=== Starting Live Browser Voice Cloning End-to-End Verification ===');
    console.log(`Target origin: ${ORIGIN}`);
    console.log(`Reference audio: ${PINCHED_AUDIO_PATH}`);

    assert(fs.existsSync(PINCHED_AUDIO_PATH), `Pinched nose reference audio not found at: ${PINCHED_AUDIO_PATH}`);

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
        console.log(`[Playwright Route] Intercepting voice-cloning-workspace.js -> serving ${localScriptPath}`);
        const content = fs.readFileSync(localScriptPath, 'utf8');
        await route.fulfill({
            status: 200,
            contentType: 'application/javascript; charset=utf-8',
            body: content
        });
    });

    page.on('console', (msg) => {
        const text = msg.text();
        if (text.includes('[VoiceCloning]') || text.includes('Voice') || text.includes('error') || text.includes('Job')) {
            console.log(`[Browser Console] ${msg.type()}: ${redactAuthIdentity(text, credentials)}`);
        }
    });

    let uploadedFileId = null;
    let uploadedAudioUrl = null;
    let enqueuedJobId = null;

    page.on('response', async (res) => {
        const url = res.url();
        if (url.includes('/api/admin/voice-cloning/upload-reference')) {
            try {
                const body = await res.json();
                uploadedFileId = body?.data?.fileId || body?.fileId;
                uploadedAudioUrl = body?.data?.audioUrl || body?.audioUrl;
                console.log(`[Network] Fresh Reference Audio Uploaded! Status: ${res.status()}, FileId: ${uploadedFileId}, AudioUrl: ${uploadedAudioUrl}`);
            } catch (_) {}
        }
        if (url.includes('/api/admin/voice-cloning/synthesize-test')) {
            try {
                const body = await res.json();
                enqueuedJobId = body?.data?.jobId || body?.jobId;
                console.log(`[Network] Synthesis Test Job Enqueued! Status: ${res.status()}, JobId: ${enqueuedJobId}`);
            } catch (_) {}
        }
    });

    try {
        // 1. Sign in on index.html
        console.log('Step 1: Signing in on index.html...');
        await page.goto(`${ORIGIN}/index.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForFunction(() => Boolean(window.__FIREBASE_INTERNAL__?.auth), null, { timeout: 30000 });
        const authResult = await signInOnPage(page, credentials);
        console.log(`Authenticated user successfully (UID: ${authResult.uid.slice(0, 6)}...)`);

        // 2. Navigate to CRM Admin Voice Cloning tab
        console.log('Step 2: Navigating to CRM Admin Voice Cloning workspace...');
        await page.goto(`${ORIGIN}/crm-admin.html#voice-cloning`, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(3000);

        // Click Voice Cloning nav if needed
        const navBtn = page.locator('button.crm-nav-item[data-main="voice-cloning"]');
        if (await navBtn.isVisible()) {
            await navBtn.click();
            await page.waitForTimeout(1000);
        }

        // 3. Wait for Voice Worker status to report Ready
        console.log('Step 3: Verifying Voice Worker status badge...');
        const badge = page.locator('#vc-worker-status-badge');
        await badge.waitFor({ state: 'visible', timeout: 30000 });
        
        // Wait up to 30s for worker to report online
        for (let i = 0; i < 15; i++) {
            const badgeText = (await badge.textContent()) || '';
            console.log(`Current worker badge: "${badgeText.trim()}"`);
            if (badgeText.includes('Ready') || badgeText.includes('online')) {
                break;
            }
            // Click refresh
            const refreshBtn = page.locator('#btn-vc-worker-refresh');
            if (await refreshBtn.isVisible()) await refreshBtn.click();
            await page.waitForTimeout(2000);
        }

        const finalBadgeText = (await badge.textContent()) || '';
        assert(finalBadgeText.includes('Ready'), `Expected worker to report Ready, but was: "${finalBadgeText}"`);

        // 4. Upload pinched-nose audio
        console.log('Step 4: Uploading pinched nose audio file to calibration input...');
        const fileInput = page.locator('#vc-audio-file-input');
        await fileInput.setInputFiles(PINCHED_AUDIO_PATH);
        await page.waitForTimeout(1500);

        // Verify preview audio element is visible
        const previewAudio = page.locator('#vc-ref-audio-preview');
        await previewAudio.waitFor({ state: 'visible', timeout: 10000 });
        console.log('Preview audio element is active and loaded!');

        // 5. Generate Cloned Test Output
        console.log('Step 5: Clicking "Generate Cloned Test Output"...');
        const btnGenerate = page.locator('#btn-vc-generate-test');
        await btnGenerate.waitFor({ state: 'visible' });
        assert(await btnGenerate.isEnabled(), 'Generate button should be enabled after uploading audio');
        await btnGenerate.click();

        // 6. Monitor network upload and queue
        console.log('Step 6: Monitoring fresh upload and queue dispatch...');
        await page.waitForFunction(() => {
            const btn = document.getElementById('btn-vc-generate-test');
            return btn && (btn.textContent.includes('Synthesizing') || btn.textContent.includes('cloning'));
        }, null, { timeout: 30000 });

        console.log(`Fresh audio uploaded: FileId=${uploadedFileId}, AudioUrl=${uploadedAudioUrl}`);
        console.log(`Enqueued test job: JobId=${enqueuedJobId}`);
        assert(uploadedFileId, 'Expected a new uploadedFileId to be returned from /upload-reference');
        assert(uploadedFileId !== 'ref_1788495197872_a3c7e2eb', 'CRITICAL: Fresh upload must NOT use the stale reference ID!');

        // 7. Wait for neural flow matching inference to complete
        console.log('Step 7: Waiting for local worker F5-TTS synthesis to complete (timeout: 5 minutes)...');
        const outputBox = page.locator('#vc-test-output-box');
        await outputBox.waitFor({ state: 'visible', timeout: 300000 });

        const metricsBadge = page.locator('#vc-test-metrics-badge');
        await metricsBadge.waitFor({ state: 'visible', timeout: 10000 });
        const metricsText = (await metricsBadge.textContent()) || '';
        console.log(`Cloned test output completed! Metrics: "${metricsText.trim()}"`);

        // 8. Capture visual evidence screenshot
        await page.screenshot({ path: SCREENSHOT_PATH, fullPage: false });
        console.log(`Screenshot saved to: ${SCREENSHOT_PATH}`);

        // 9. Download the synthesized MP3 audio
        console.log('Step 8: Extracting and downloading cloned audio...');
        const audioPlayer = page.locator('#vc-test-audio-player');
        const audioSrc = await audioPlayer.getAttribute('src');
        console.log(`Cloned audio source URL: ${audioSrc}`);

        // Fetch the audio buffer using authenticated session from page
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
        }, audioSrc);

        fs.writeFileSync(OUTPUT_MP3_PATH, Buffer.from(audioBuffer));
        console.log(`Downloaded cloned MP3 (${audioBuffer.length} bytes) to: ${OUTPUT_MP3_PATH}`);

        console.log('=== Live Browser Voice Cloning Test COMPLETED SUCCESSFULLY! ===');
    } catch (err) {
        console.error('Test FAILED:', err);
        try {
            await page.screenshot({ path: SCREENSHOT_PATH });
        } catch (_) {}
        process.exit(1);
    } finally {
        await browser.close();
    }
})();
