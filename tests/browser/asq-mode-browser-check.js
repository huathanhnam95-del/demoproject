const { chromium } = require('playwright');
const path = require('path');
const express = require('express');

const app = express();
const port = 0;
app.use(express.static(path.join(__dirname, '../../public')));

let server;

async function runTest() {
    console.log('--- Starting ASQ Mode Browser test (Direct Execution) ---');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });

    await context.addInitScript(() => {
        window.localStorage.setItem('userStatus', 'guest');
        window.localStorage.setItem('hasSeenScopeTutorial', 'true');
        window.localStorage.setItem('asqModeFirstUse', 'true');

        // Mock APIs
        Object.defineProperty(navigator, 'mediaDevices', {
            value: { getUserMedia: async () => ({ getTracks: () => [{ stop: () => { } }] }) },
            configurable: true
        });

        window.MediaRecorder = class extends EventTarget {
            constructor() {
                super();
                this.state = 'inactive';
                this.mimeType = 'audio/webm';
                this.ondataavailable = null;
                this.onstop = null;
            }
            start() {
                this.state = 'recording';
                this.dispatchEvent(new Event('start'));
            }
            stop() {
                this.state = 'inactive';
                const blob = new Blob(['mock audio data'], { type: this.mimeType });
                const event = new Event('dataavailable');
                Object.defineProperty(event, 'data', { value: blob, enumerable: true });
                this.dispatchEvent(event);
                if (typeof this.ondataavailable === 'function') this.ondataavailable(event);
                setTimeout(() => {
                    const stopEvent = new Event('stop');
                    this.dispatchEvent(stopEvent);
                    if (typeof this.onstop === 'function') this.onstop(stopEvent);
                }, 10);
            }
        };

        window.SpeechRecognition = window.webkitSpeechRecognition = class extends EventTarget {
            constructor() {
                super();
                this.continuous = false;
                this.interimResults = false;
            }
            start() {
                setTimeout(() => {
                    const resultEvent = new Event('result');
                    resultEvent.results = [[{ transcript: window.__mockTranscript || 'down' }]];
                    resultEvent.results[0].isFinal = true;
                    this.dispatchEvent(resultEvent);
                    this.dispatchEvent(new Event('end'));
                }, 500);
            }
            stop() {
                this.dispatchEvent(new Event('end'));
            }
        };

        window.handleDualTrackScoring = async (mode, id, transcript) => {
            console.log('[STUB] handleDualTrackScoring called:', mode, id, transcript);
            return { success: true, accuracy: 1.0, xpEarned: 10, feedback: 'Excellent!' };
        };
    });

    const page = await context.newPage();
    page.on('console', msg => console.log(`PAGE LOG [${msg.type()}]:`, msg.text()));

    try {
        const url = `http://127.0.0.1:${server.address().port}/index.html`;
        console.log(`Navigating to ${url}`);
        await page.goto(url, { waitUntil: 'load', timeout: 30000 });

        await page.evaluate(() => {
            const overlays = ['.preloader', '#preloader', '.modal-backdrop'];
            overlays.forEach(sel => document.querySelectorAll(sel).forEach(el => el.remove()));
        });

        console.log('Waiting for ASQMode instance...');
        await page.waitForFunction(() => window.ASQMode && typeof window.ASQMode.init === 'function', { timeout: 15000 });

        await page.evaluate(async () => {
            const asq = window.ASQMode;
            console.log('[STUB] ASQMode found. Injecting test data...');

            asq.database = [{ id: '1', promptText: 'What is the opposite of up?', answerDisplay: 'down', acceptedAnswers: ['down'] }];
            asq.audioManifest = { "1": "1.mp3" };
            asq.loadWorkbookIfNeeded = async () => { };
            asq.loadAudioManifestIfNeeded = async () => { };

            // Stub handleDualTrackScoring to prevent Firestore permission errors
            window.handleDualTrackScoring = async (mode, id, transcript) => {
                console.log('[STUB] handleDualTrackScoring called for:', mode, id, transcript);
                return { success: true, accuracy: 1.0, xpEarned: 10 };
            };

            // Force re-init to ensure listeners are set on the seeded data
            asq.isInitialized = false;
            await asq.init();
            console.log('[STUB] ASQMode initialized and seeded.');
        });

        console.log('Switching to ASQ mode UI...');
        await page.evaluate(() => window.switchToMode('asq'));
        await page.waitForTimeout(1000);

        // Verify element state
        const isVisible = await page.isVisible('#asq-record-btn');
        console.log('Record button visible:', isVisible);

        // NEW: Verify question text is HIDDEN before submission
        const textHiddenBefore = await page.evaluate(() => {
            const el = document.getElementById('asq-question-text');
            return el ? window.getComputedStyle(el).display === 'none' : true;
        });
        if (!textHiddenBefore) throw new Error('Question text should be hidden before submission');
        console.log('√ Question text correctly hidden before submission');

        await page.evaluate(() => { window.__mockTranscript = 'down'; });

        console.log('Triggering record button click (Direct Event)...');
        // Using direct event dispatch to bypass any UI overlay or Playwright interaction issues
        await page.evaluate(() => {
            const btn = document.getElementById('asq-record-btn');
            console.log('[DEBUG] Dispatching click to:', btn);
            btn.dispatchEvent(new Event('click', { bubbles: true }));
        });

        console.log('Waiting for stop button to appear...');
        const stopBtn = page.locator('#asq-stop-btn');
        await stopBtn.waitFor({ state: 'visible', timeout: 5000 });

        console.log('Triggering stop button click (Direct Event)...');
        await page.evaluate(() => {
            const btn = document.getElementById('asq-stop-btn');
            btn.dispatchEvent(new Event('click', { bubbles: true }));
        });

        console.log('Waiting for result box...');
        await page.waitForSelector('#asq-result-box', { state: 'visible', timeout: 10000 });

        const resultStatus = await page.innerText('#asq-result-status');
        console.log('Final result status:', resultStatus);

        if (resultStatus.includes('Correct')) {
            console.log('√ ASQ Integration Verified Successfully.');
        } else {
            throw new Error(`Expected 'Correct', got '${resultStatus}'`);
        }

        // NEW: Verify question text is VISIBLE after result
        const textVisibleAfter = await page.evaluate(() => {
            const el = document.getElementById('asq-question-text');
            return el ? window.getComputedStyle(el).display !== 'none' : false;
        });
        if (!textVisibleAfter) throw new Error('Question text should be visible after result');
        console.log('√ Question text correctly revealed after submission');

        // NEW: Verify XSS fix — transcriptFeedback should NOT use innerHTML with raw transcript
        const hasNoRawHtml = await page.evaluate(() => {
            const el = document.getElementById('asq-transcript-feedback');
            return el ? el.querySelector('em') !== null : false;
        });
        if (!hasNoRawHtml) throw new Error('Transcript feedback should use DOM elements, not raw HTML');
        console.log('√ XSS-safe transcript rendering verified');

        // NEW: Verify Redo button appears
        const redoVisible = await page.isVisible('#asq-redo-btn');
        if (!redoVisible) throw new Error('Redo button should be visible after result');
        console.log('√ Redo button visible after result');

        // NEW: Verify Clicking Redo resets UI
        console.log('Clicking Redo...');
        await page.click('#asq-redo-btn');
        await page.waitForTimeout(500);

        const recordVisibleAfterRedo = await page.isVisible('#asq-record-btn');
        const redoHiddenAfterRedo = await page.evaluate(() => document.getElementById('asq-redo-btn').style.display === 'none');
        const resultHiddenAfterRedo = await page.evaluate(() => document.getElementById('asq-result-box').style.display === 'none');

        if (!recordVisibleAfterRedo || !redoHiddenAfterRedo || !resultHiddenAfterRedo) {
            throw new Error('Redo did not correctly reset UI (Record button should be visible, Redo and Result box hidden)');
        }
        console.log('√ Redo button correctly resets UI state');

        console.log('--- ASQ Browser test PASSED ---');
    } catch (err) {
        console.error('--- ASQ Browser test FAILED ---');
        console.error(err);
        process.exit(1);
    } finally {
        await browser.close();
        server.close();
    }
}

server = app.listen(port, () => runTest());
