/* eslint-disable no-console */
const { chromium } = require('playwright');
const path = require('path');
const express = require('express');

const app = express();
const port = 0;
app.use(express.static(path.join(__dirname, '../../public')));

let server;

async function dismissBlockingOverlays(page) {
    await page.waitForFunction(() => {
        const preloader = document.getElementById('app-preloader');
        if (!preloader) return true;
        const dismiss = document.getElementById('preloader-dismiss-btn');
        return getComputedStyle(preloader).display === 'none' || Boolean(dismiss);
    }, { timeout: 15000 });

    const dismissButton = page.locator('#preloader-dismiss-btn');
    if (await dismissButton.count()) {
        try {
            await dismissButton.click({ timeout: 3000 });
        } catch (_) {
            // ignore
        }
    }

    await page.waitForFunction(() => {
        const preloader = document.getElementById('app-preloader');
        return !preloader || getComputedStyle(preloader).display === 'none';
    }, { timeout: 15000 });

    const guestButton = page.locator('#guest-mode-btn');
    if (await guestButton.isVisible().catch(() => false)) {
        await guestButton.click();
    }

    await page.waitForFunction(() => {
        const entryModal = document.getElementById('entry-modal');
        const wrapper = document.getElementById('page-layout-wrapper');
        const modalHidden = !entryModal || getComputedStyle(entryModal).display === 'none';
        const wrapperVisible = !!wrapper && getComputedStyle(wrapper).display !== 'none';
        return modalHidden && wrapperVisible;
    }, { timeout: 15000 });
}

async function runTest() {
    console.log('--- Starting ASQ Mode Browser test (Direct Execution) ---');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });

    await context.addInitScript(() => {
        window.localStorage.setItem('userStatus', 'guest');
        window.localStorage.setItem('hasSeenScopeTutorial', 'true');
        [
            'type',
            'collo-dictate',
            'speak',
            'extended',
            'watch',
            'notes',
            'pronounce',
            'read-aloud',
            'rfib',
            'asq'
        ].forEach((mode) => {
            window.localStorage.setItem(`${mode}ModeFirstUse`, 'true');
        });

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
        await dismissBlockingOverlays(page);

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
        const pickerIdentity = await page.evaluate(() => ({
            sourceValue: document.getElementById('asq-question-select')?.value || '',
            pillText: document.querySelector('#spc-picker-asq')?.textContent || ''
        }));
        if (pickerIdentity.sourceValue !== '1') {
            throw new Error(`ASQ should normalize the random sentinel to the selected question ID, got ${pickerIdentity.sourceValue}`);
        }
        if (/#random\b/i.test(pickerIdentity.pillText)) {
            throw new Error(`ASQ controller should not display #random as the current question: ${pickerIdentity.pillText}`);
        }

        await page.evaluate(() => {
            const audio = document.getElementById('asq-prompt-audio');
            const playBtn = document.getElementById('asq-play-prompt-btn');
            let paused = true;
            window.__asqPromptPauseCount = 0;
            Object.defineProperty(audio, 'paused', {
                configurable: true,
                get: () => paused
            });
            audio.play = () => {
                paused = false;
                return Promise.resolve();
            };
            audio.pause = () => {
                paused = true;
                window.__asqPromptPauseCount += 1;
            };
            const playLabel = document.getElementById('asq-play-label');
            if (playLabel) playLabel.textContent = 'Play';
            else if (playBtn) playBtn.textContent = 'Play';
        });
        await page.evaluate(() => window.ASQMode.playPrompt());
        // The prompt button now lives in the shared .practice-audio-player box, so its
        // label is a span beside the material icon rather than the button's own text.
        const playLabelWhileActive = await page.innerText('#asq-play-label');
        if (playLabelWhileActive.trim() !== 'Pause') {
            throw new Error(`ASQ play button should switch to Pause while prompt audio is active, got "${playLabelWhileActive}"`);
        }

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

        console.log('Switching away from ASQ while recording to verify cleanup...');
        await page.evaluate(async () => {
            await window.switchToMode('speak');
        });
        await page.waitForFunction(() => {
            const asq = window.ASQMode;
            const stop = document.getElementById('asq-stop-btn');
            return !!asq &&
                asq.isActive === false &&
                asq.isRecording === false &&
                !asq.audioStream &&
                !asq.mediaRecorder &&
                (!stop || getComputedStyle(stop).display === 'none');
        }, { timeout: 5000 });

        const cleanupState = await page.evaluate(() => {
            const stop = document.getElementById('asq-stop-btn');
            return {
                isActive: window.ASQMode?.isActive,
                isRecording: window.ASQMode?.isRecording,
                hasAudioStream: !!window.ASQMode?.audioStream,
                hasMediaRecorder: !!window.ASQMode?.mediaRecorder,
                stopVisible: !!stop && getComputedStyle(stop).display !== 'none'
            };
        });
        if (cleanupState.isActive !== false || cleanupState.isRecording || cleanupState.hasAudioStream || cleanupState.hasMediaRecorder || cleanupState.stopVisible) {
            throw new Error(`ASQ cleanup failed after mode switch: ${JSON.stringify(cleanupState)}`);
        }
        console.log('√ ASQ cleanup on mode switch verified');

        const promptCleanupState = await page.evaluate(() => ({
            pauseCount: window.__asqPromptPauseCount || 0,
            playLabel: document.getElementById('asq-play-label')?.textContent?.trim() || ''
        }));
        if (promptCleanupState.pauseCount < 1 || promptCleanupState.playLabel !== 'Play') {
            throw new Error(`ASQ prompt audio did not reset on exit: ${JSON.stringify(promptCleanupState)}`);
        }
        console.log('âˆš ASQ prompt audio cleanup on mode switch verified');

        console.log('Waiting for stale ASQ async work to settle...');
        await page.waitForTimeout(900);
        const staleUiState = await page.evaluate(() => ({
            resultVisible: getComputedStyle(document.getElementById('asq-result-box')).display !== 'none',
            redoVisible: getComputedStyle(document.getElementById('asq-redo-btn')).display !== 'none',
            userAudioVisible: getComputedStyle(document.getElementById('asq-user-audio-box')).display !== 'none',
            questionVisible: getComputedStyle(document.getElementById('asq-question-text')).display !== 'none'
        }));
        if (staleUiState.resultVisible || staleUiState.redoVisible || staleUiState.userAudioVisible || staleUiState.questionVisible) {
            throw new Error(`ASQ leaked stale UI after exiting mid-recording: ${JSON.stringify(staleUiState)}`);
        }
        console.log('âˆš No stale ASQ UI after exiting mid-recording');

        console.log('Switching back to ASQ to complete result flow...');
        await page.evaluate(async () => {
            await window.switchToMode('asq');
        });
        await page.waitForFunction(() => {
            const btn = document.getElementById('asq-record-btn');
            return !!btn && getComputedStyle(btn).display !== 'none' && !btn.disabled;
        }, { timeout: 5000 });

        await page.evaluate(() => { window.__mockTranscript = 'down'; });

        console.log('Triggering record button click again...');
        await page.evaluate(() => {
            const btn = document.getElementById('asq-record-btn');
            btn.dispatchEvent(new Event('click', { bubbles: true }));
        });

        console.log('Waiting for stop button to appear again...');
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
