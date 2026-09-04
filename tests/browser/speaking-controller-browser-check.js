/* eslint-disable no-console */
/**
 * Speaking Controller Browser Check — Wave 0
 * Exercises the controller contract with a synthetic adapter injected at runtime.
 * Verifies: registration, activation, picker, Basic/Advanced toggle, DOM adoption,
 * restoration, sheets, focus management, persistence, responsive layout.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const express = require('express');

const app = express();
const port = 0;
app.use(express.static(path.join(__dirname, '../../public')));

let server;

const SCREENSHOT_DIR = path.resolve(__dirname, '../../test-results/reading-speaking-rfib-ui');

function screenshotPath(filename) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    return path.join(SCREENSHOT_DIR, filename);
}

async function activateSpeakingMode(page, mode) {
    await page.evaluate(async (modeId) => {
        await window.switchToMode(modeId);
    }, mode);
    await page.waitForFunction((modeId) => {
        const panel = document.getElementById(`mode-${modeId}`);
        return !!panel
            && panel.classList.contains('active')
            && getComputedStyle(panel).display !== 'none'
            && !!panel.querySelector('.spc-controller');
    }, mode, { timeout: 30000 });
    await page.waitForTimeout(450);
}

async function captureSpeakingScreenshots(browser, server) {
    const desktop = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
    await desktop.addInitScript(() => {
        window.localStorage.setItem('userStatus', 'guest');
        window.localStorage.setItem('hasSeenScopeTutorial', 'true');
        ['asq', 'read-aloud', 'sgd', 'speak'].forEach((mode) => {
            window.localStorage.setItem(`${mode}ModeFirstUse`, 'true');
        });
        class ScreenshotMediaRecorder extends EventTarget {
            constructor(stream) {
                super();
                this.stream = stream;
                this.state = 'inactive';
                this.mimeType = 'audio/wav';
                this.ondataavailable = null;
                this.onstop = null;
            }

            start() {
                this.state = 'recording';
                this.dispatchEvent(new Event('start'));
            }

            stop() {
                this.state = 'inactive';
                const dataEvent = new Event('dataavailable');
                Object.defineProperty(dataEvent, 'data', {
                    value: new Blob(['screenshot-audio'], { type: this.mimeType })
                });
                this.ondataavailable?.(dataEvent);
                this.dispatchEvent(dataEvent);
                const stopEvent = new Event('stop');
                this.onstop?.(stopEvent);
                this.dispatchEvent(stopEvent);
            }
        }
        Object.defineProperty(window, 'MediaRecorder', {
            configurable: true,
            writable: true,
            value: ScreenshotMediaRecorder
        });
        Object.defineProperty(navigator, 'mediaDevices', {
            configurable: true,
            value: {
                getUserMedia: async () => ({
                    getTracks: () => [{ stop() {} }]
                })
            }
        });
    });
    const desktopPage = await desktop.newPage();

    try {
        await desktopPage.goto(`http://localhost:${server.address().port}/?speakingController=v2`, { waitUntil: 'domcontentloaded' });
        await dismissBlockingOverlays(desktopPage);

        await activateSpeakingMode(desktopPage, 'asq');
        await desktopPage.screenshot({ path: screenshotPath('speaking-asq-desktop.png'), fullPage: true });

        await activateSpeakingMode(desktopPage, 'sgd');
        await desktopPage.screenshot({ path: screenshotPath('speaking-sgd-desktop.png'), fullPage: true });

        await activateSpeakingMode(desktopPage, 'read-aloud');
        await desktopPage.waitForFunction(() => window.ReadAloudMode?.currentPromptReady, { timeout: 30000 }).catch(() => {});
        await desktopPage.evaluate(() => document.getElementById('ra-record-btn')?.click());
        await desktopPage.waitForFunction(() => {
            const stop = document.getElementById('ra-stop-btn');
            return !!stop && getComputedStyle(stop).display !== 'none';
        }, { timeout: 30000 });
        await desktopPage.evaluate(() => document.getElementById('ra-stop-btn')?.click());
        await desktopPage.waitForFunction(() => {
            const check = document.getElementById('ra-check-btn');
            return window.ReadAloudMode?.state === 'RECORDED'
                && !!check && getComputedStyle(check).display !== 'none';
        }, { timeout: 30000 });
        await desktopPage.screenshot({ path: screenshotPath('speaking-read-aloud-recorded-desktop.png'), fullPage: true });

        await activateSpeakingMode(desktopPage, 'speak');
        await desktopPage.evaluate(() => document.querySelector('#mode-speak .spc-settings-btn')?.click());
        await desktopPage.waitForFunction(() => document.getElementById('spc-settings-sheet-speak')?.classList.contains('is-active'), { timeout: 15000 });
        await desktopPage.waitForTimeout(400);
        await desktopPage.screenshot({ path: screenshotPath('speaking-settings-desktop.png'), fullPage: true });
    } finally {
        await desktop.close();
    }

    const tablet = await browser.newContext({ viewport: { width: 768, height: 1024 } });
    await tablet.addInitScript(() => {
        window.localStorage.setItem('userStatus', 'guest');
        window.localStorage.setItem('hasSeenScopeTutorial', 'true');
        window.localStorage.setItem('speakModeFirstUse', 'true');
    });
    const tabletPage = await tablet.newPage();
    try {
        await tabletPage.goto(`http://localhost:${server.address().port}/?speakingController=v2`, { waitUntil: 'domcontentloaded' });
        await dismissBlockingOverlays(tabletPage);
        await activateSpeakingMode(tabletPage, 'speak');
        await tabletPage.screenshot({ path: screenshotPath('speaking-controller-tablet.png'), fullPage: true });
        await tabletPage.evaluate(() => document.querySelector('#mode-speak .spc-settings-btn')?.click());
        await tabletPage.waitForFunction(() => document.getElementById('spc-settings-sheet-speak')?.classList.contains('is-active'), { timeout: 15000 });
        await tabletPage.waitForTimeout(400);
        await tabletPage.screenshot({ path: screenshotPath('speaking-settings-tablet.png'), fullPage: true });
    } finally {
        await tablet.close();
    }

    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await mobile.addInitScript(() => {
        window.localStorage.setItem('userStatus', 'guest');
        window.localStorage.setItem('hasSeenScopeTutorial', 'true');
        window.localStorage.setItem('speakModeFirstUse', 'true');
    });
    const mobilePage = await mobile.newPage();
    try {
        await mobilePage.goto(`http://localhost:${server.address().port}/?speakingController=v2`, { waitUntil: 'domcontentloaded' });
        await dismissBlockingOverlays(mobilePage);
        await activateSpeakingMode(mobilePage, 'speak');
        await mobilePage.screenshot({ path: screenshotPath('speaking-controller-mobile.png'), fullPage: true });
        await mobilePage.locator('#spc-picker-speak').click();
        await mobilePage.waitForFunction(() => document.getElementById('spc-picker-sheet-speak')?.classList.contains('is-active'), { timeout: 15000 });
        await mobilePage.waitForTimeout(400);
        await mobilePage.screenshot({ path: screenshotPath('speaking-picker-mobile.png'), fullPage: true });
        await mobilePage.locator('#spc-picker-sheet-speak .spc-sheet-close').click();
        await mobilePage.waitForFunction(() => !document.getElementById('spc-picker-sheet-speak')?.classList.contains('is-active'), { timeout: 15000 });
        await mobilePage.waitForTimeout(400);
        await mobilePage.evaluate(() => document.querySelector('#mode-speak .spc-settings-btn')?.click());
        await mobilePage.waitForFunction(() => document.getElementById('spc-settings-sheet-speak')?.classList.contains('is-active'), { timeout: 15000 });
        await mobilePage.waitForTimeout(400);
        await mobilePage.screenshot({ path: screenshotPath('speaking-settings-mobile.png'), fullPage: true });
    } finally {
        await mobile.close();
    }
}

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
        } catch (_) { /* ignore */ }
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
    console.log('--- Starting Speaking Controller Browser Check (Wave 0) ---');
    const browser = await chromium.launch({
      headless: true,
      args: [
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream'
      ]
    });
    let passed = 0;
    let failed = 0;

    function assert(label, condition) {
        if (condition) {
            console.log('  √ ' + label);
            passed++;
        } else {
            console.error('  ✗ ' + label);
            failed++;
        }
    }

    try {
        // ===== Test 1: Controller module loads =====
        console.log('\n[Test 1] Controller module loads');
        const context1 = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
        await context1.addInitScript(() => {
            window.localStorage.setItem('userStatus', 'guest');
            window.localStorage.setItem('hasSeenScopeTutorial', 'true');
        });
        const page1 = await context1.newPage();
        const url = `http://localhost:${server.address().port}/?speakingController=v2`;
        await page1.goto(url, { waitUntil: 'domcontentloaded' });
        await dismissBlockingOverlays(page1);

        const hasController = await page1.evaluate(() => {
            return typeof window.SpeakingPracticeController === 'object' &&
                typeof window.SpeakingPracticeController.register === 'function' &&
                typeof window.SpeakingPracticeController.activate === 'function' &&
                typeof window.SpeakingPracticeController.sync === 'function' &&
                typeof window.SpeakingPracticeController.unmount === 'function' &&
                typeof window.SpeakingPracticeController.isV2Active === 'function' &&
                typeof window.SpeakingPracticeController.getPreferredView === 'function' &&
                typeof window.SpeakingPracticeController.setPreferredView === 'function';
        });
        assert('SpeakingPracticeController API is available', hasController);
        await context1.close();

        // ===== Test 2: Integrated target resolution =====
        console.log('\n[Test 2] Integrated target resolution');
        const context2 = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
        await context2.addInitScript(() => {
            window.localStorage.setItem('userStatus', 'guest');
            window.localStorage.setItem('hasSeenScopeTutorial', 'true');
        });
        const page2 = await context2.newPage();
        await page2.goto(`http://localhost:${server.address().port}/?speakingController=v2`, { waitUntil: 'domcontentloaded' });
        await dismissBlockingOverlays(page2);

        const flagResults = await page2.evaluate(() => {
            const SPC = window.SpeakingPracticeController;
            return {
                pteSpeak: SPC.isV2Active('speak', 'pte'),
                pteReadAloud: SPC.isV2Active('read-aloud', 'pte'),
                pteAsq: SPC.isV2Active('asq', 'pte'),
                englishSpeak: SPC.isV2Active('speak', 'english'),
                englishReadAloud: SPC.isV2Active('read-aloud', 'english'),
                // Excluded combinations
                ptePronounce: SPC.isV2Active('pronounce', 'pte'),
                englishNotes: SPC.isV2Active('notes', 'english'),
                englishAsq: SPC.isV2Active('asq', 'english')
            };
        });
        assert('pte:speak enabled by integrated defaults', flagResults.pteSpeak);
        assert('pte:read-aloud enabled by integrated defaults', flagResults.pteReadAloud);
        assert('pte:asq enabled by integrated defaults', flagResults.pteAsq);
        assert('english:speak enabled by integrated defaults', flagResults.englishSpeak);
        assert('english:read-aloud enabled by integrated defaults', flagResults.englishReadAloud);
        assert('pte:pronounce remains excluded', !flagResults.ptePronounce);
        assert('english:notes remains excluded', !flagResults.englishNotes);
        assert('english:asq remains excluded', !flagResults.englishAsq);

        // Test legacy override
        await page2.goto(`http://localhost:${server.address().port}/?speakingController=legacy`, { waitUntil: 'domcontentloaded' });
        await dismissBlockingOverlays(page2);

        const legacyResult = await page2.evaluate(() => {
            return window.SpeakingPracticeController.isV2Active('speak', 'pte');
        });
        assert('legacy query override no longer disables integrated targets', legacyResult);
        await context2.close();

        // ===== Test 3: Synthetic adapter — full contract =====
        console.log('\n[Test 3] Synthetic adapter — registration, activation, DOM');
        const context3 = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
        await context3.addInitScript(() => {
            window.localStorage.setItem('userStatus', 'guest');
            window.localStorage.setItem('hasSeenScopeTutorial', 'true');
        });
        const page3 = await context3.newPage();

        // Collect console errors
        const consoleErrors = [];
        page3.on('console', msg => {
            if (msg.type() === 'error') consoleErrors.push(msg.text());
        });
        const pageErrors = [];
        page3.on('pageerror', err => pageErrors.push(err.message));

        await page3.goto(`http://localhost:${server.address().port}/?speakingController=v2`, { waitUntil: 'domcontentloaded' });
        await dismissBlockingOverlays(page3);

        // Navigate to speak mode panel to get a real panel context
        const navigated = await page3.evaluate(() => {
            if (typeof window.switchToMode === 'function') {
                window.switchToMode('speak');
                return true;
            }
            return false;
        });

        if (navigated) {
            await page3.waitForTimeout(1000);
        }

        const speakLayout = await page3.evaluate(() => ({
            controllerCount: document.querySelectorAll('#mode-speak .spc-controller').length,
            legacyToolbarHidden: getComputedStyle(document.querySelector('#mode-speak > .unified-controls')).display === 'none',
            replayInController: Boolean(document.querySelector('#mode-speak .practice-audio-player #replay-counter-speak, #mode-speak .spc-slot-media #replay-counter-speak, #mode-speak #replay-counter-speak'))
        }));
        assert('Repeat Sentence has one active controller', speakLayout.controllerCount === 1);
        assert('Repeat Sentence legacy toolbar is hidden', speakLayout.legacyToolbarHidden);
        assert('Repeat Sentence replay status is in the controller', speakLayout.replayInController);

        // Inject a synthetic adapter and test the full contract
        const syntheticResults = await page3.evaluate(() => {
            const SPC = window.SpeakingPracticeController;
            const results = {};

            // Create a test container to act as a mode panel
            const testPanel = document.createElement('div');
            testPanel.id = 'mode-synthetic-test';
            testPanel.style.cssText = 'padding: 20px; min-height: 200px;';
            document.body.appendChild(testPanel);

            // Create synthetic source elements
            const sourceSelect = document.createElement('select');
            sourceSelect.id = 'synth-question-select';
            for (let i = 1; i <= 10; i++) {
                const opt = document.createElement('option');
                opt.value = String(i);
                opt.textContent = 'Test Question ' + i;
                sourceSelect.appendChild(opt);
            }
            sourceSelect.value = '3';
            testPanel.appendChild(sourceSelect);

            const prevBtn = document.createElement('button');
            prevBtn.id = 'synth-prev-btn';
            prevBtn.textContent = 'Prev';
            testPanel.appendChild(prevBtn);

            const nextBtn = document.createElement('button');
            nextBtn.id = 'synth-next-btn';
            nextBtn.textContent = 'Next';
            testPanel.appendChild(nextBtn);

            const randomBtn = document.createElement('button');
            randomBtn.id = 'synth-random-btn';
            randomBtn.textContent = 'Random';
            randomBtn.style.display = 'inline-flex';
            testPanel.appendChild(randomBtn);

            const playBtn = document.createElement('button');
            playBtn.id = 'synth-play-btn';
            playBtn.textContent = 'Play';
            testPanel.appendChild(playBtn);

            const recordBtn = document.createElement('button');
            recordBtn.id = 'synth-record-btn';
            recordBtn.textContent = 'Record';
            recordBtn.dataset.spcActionRole = 'legacy-record';
            testPanel.appendChild(recordBtn);

            const stopBtn = document.createElement('button');
            stopBtn.id = 'synth-stop-btn';
            stopBtn.textContent = 'Stop';
            testPanel.appendChild(stopBtn);

            const filterWrapper = document.createElement('div');
            filterWrapper.id = 'synth-filter-wrapper';
            filterWrapper.innerHTML = '<select id="synth-difficulty"><option value="all">All</option><option value="easy">Easy</option></select>';
            testPanel.appendChild(filterWrapper);

            const inPlaceGuide = document.createElement('div');
            inPlaceGuide.id = 'synth-guide-toggle';
            inPlaceGuide.textContent = 'Show Guide';
            testPanel.appendChild(inPlaceGuide);

            // Record original child count
            const originalChildCount = testPanel.children.length;

            // Register synthetic adapter
            SPC.register({
                modeId: 'synthetic-test',
                testOnly: true,
                enabledScopes: ['pte'],
                panelId: 'mode-synthetic-test',
                picker: {
                    sourceSelectId: 'synth-question-select',
                    previousButtonId: 'synth-prev-btn',
                    nextButtonId: 'synth-next-btn',
                    randomButtonId: 'synth-random-btn'
                },
                controls: [
                    { sourceId: 'synth-play-btn', slot: 'media', level: 'basic', order: 1, actionRole: 'play' },
                    { sourceId: 'synth-record-btn', slot: 'attempt', level: 'basic', order: 1, actionRole: 'record' },
                    { sourceId: 'synth-stop-btn', slot: 'attempt', level: 'basic', order: 2, actionRole: 'stop' },
                    { sourceId: 'synth-filter-wrapper', slot: 'advanced-setting', level: 'advanced', order: 1 }
                ],
                inPlaceControls: [
                    { sourceId: 'synth-guide-toggle', level: 'advanced' }
                ],
                advancedSettings: [
                    {
                        key: 'difficulty',
                        sourceId: 'synth-filter-wrapper',
                        isActive: () => document.getElementById('synth-difficulty').value !== 'all',
                        summaryLabel: 'Difficulty filter'
                    }
                ]
            });

            results.registered = true;

            // Activate
            SPC.activate('synthetic-test', { scope: 'pte' });

            // Check controller DOM was created
            const controller = testPanel.querySelector('.spc-controller');
            results.controllerCreated = !!controller;
            results.isFirstChild = testPanel.firstElementChild === controller;

            // Check picker pill shows current question
            const pillId = controller?.querySelector('.spc-picker-pill-id');
            const pillLabel = controller?.querySelector('.spc-picker-pill-label');
            results.pickerShowsId = pillId?.textContent === '#3';
            results.pickerShowsLabel = pillLabel?.textContent === 'Test Question 3';

            // Check controls were adopted
            const playInSlot = testPanel.querySelector('.spc-slot-media #synth-play-btn');
            const recordInSlot = testPanel.querySelector('.spc-slot-attempt #synth-record-btn');
            const stopInSlot = testPanel.querySelector('.spc-slot-attempt #synth-stop-btn');
            const filterInSlot = testPanel.querySelector('.spc-slot-advanced-setting #synth-filter-wrapper');
            results.playAdopted = !!playInSlot;
            results.recordAdopted = !!recordInSlot;
            results.stopAdopted = !!stopInSlot;
            results.filterAdopted = !!filterInSlot;
            results.playActionRole = playInSlot?.dataset.spcActionRole === 'play';
            results.recordActionRole = recordInSlot?.dataset.spcActionRole === 'record';
            results.stopActionRole = stopInSlot?.dataset.spcActionRole === 'stop';

            // Check anchors were created
            const anchors = [];
            const walker = document.createTreeWalker(testPanel, NodeFilter.SHOW_COMMENT);
            while (walker.nextNode()) {
                if (walker.currentNode.textContent.startsWith('spc-anchor:')) {
                    anchors.push(walker.currentNode.textContent);
                }
            }
            results.anchorsCreated = anchors.length >= 4;

            // Check source elements are hidden
            results.sourceSelectHidden = sourceSelect.style.display === 'none';
            results.prevBtnHidden = prevBtn.style.display === 'none';
            results.nextBtnHidden = nextBtn.style.display === 'none';

            // Check in-place control has level attribute
            results.inPlaceHasLevel = inPlaceGuide.dataset.spcLevel === 'advanced';

            // Check view toggle exists
            const toggleGroup = controller?.querySelector('.spc-view-toggle');
            const basicBtn = controller?.querySelector('[data-view="basic"]');
            const advancedBtn = controller?.querySelector('[data-view="advanced"]');
            results.toggleExists = !!toggleGroup && !!basicBtn && !!advancedBtn;

            // Check initial view is Basic
            results.initialViewBasic = controller?.dataset.spcView === 'basic';

            // Check advanced row is hidden in Basic view
            const advRow = controller?.querySelector('.spc-row--advanced');
            results.advRowHiddenInBasic = advRow ? getComputedStyle(advRow).display === 'none' : false;

            // Check filter is hidden in Basic view (advanced level)
            results.filterHiddenInBasic = filterInSlot ? getComputedStyle(filterInSlot).display === 'none' : false;

            // Check in-place guide is hidden in Basic view
            results.guideHiddenInBasic = getComputedStyle(inPlaceGuide).display === 'none';

            // Switch to Advanced
            advancedBtn?.click();

            // Check view switched
            results.switchedToAdvanced = controller?.dataset.spcView === 'advanced';
            results.advRowVisibleInAdvanced = advRow ? getComputedStyle(advRow).display !== 'none' : false;
            results.filterVisibleInAdvanced = filterInSlot ? getComputedStyle(filterInSlot).display !== 'none' : false;
            results.guideVisibleInAdvanced = getComputedStyle(inPlaceGuide).display !== 'none';

            // Check preference was stored
            results.preferenceStored = SPC.getPreferredView() === 'advanced';

            // Switch back to Basic
            basicBtn?.click();
            results.switchedBackToBasic = controller?.dataset.spcView === 'basic';

            // Test picker sync: change source select
            sourceSelect.value = '7';
            sourceSelect.dispatchEvent(new Event('change', { bubbles: true }));
            results.pickerSyncsOnChange = pillId?.textContent === '#7';

            // Test sync API
            SPC.sync('synthetic-test');
            results.syncApiWorks = pillId?.textContent === '#7';

            // Active chip: set difficulty to non-default
            document.getElementById('synth-difficulty').value = 'easy';
            SPC.sync('synthetic-test');
            const chip = controller?.querySelector('.spc-active-chip');
            results.activeChipCount = chip?.dataset.count === '1';
            results.activeChipText = chip?.textContent === 'Advanced settings active (1)';

            // Unmount and verify restoration
            SPC.unmount('synthetic-test');

            // Check controller DOM removed
            results.controllerRemoved = !testPanel.querySelector('.spc-controller');

            // Check controls restored to panel
            results.playRestored = testPanel.contains(playBtn);
            results.recordRestored = testPanel.contains(recordBtn);
            results.filterRestored = testPanel.contains(filterWrapper);
            results.playActionRoleRestored = !playBtn.dataset.spcActionRole;
            results.recordActionRoleRestored = recordBtn.dataset.spcActionRole === 'legacy-record';
            results.stopActionRoleRestored = !stopBtn.dataset.spcActionRole;

            // Check source elements visible again
            results.sourceSelectRestored = sourceSelect.style.display !== 'none';
            results.prevBtnRestored = prevBtn.style.display !== 'none';
            results.nextBtnRestored = nextBtn.style.display !== 'none';
            results.randomBtnDisplayRestored = randomBtn.style.display === 'inline-flex';

            // Check in-place control level removed
            results.inPlaceLevelRemoved = !inPlaceGuide.dataset.spcLevel;

            // Check anchors removed
            const anchorsAfter = [];
            const walker2 = document.createTreeWalker(testPanel, NodeFilter.SHOW_COMMENT);
            while (walker2.nextNode()) {
                if (walker2.currentNode.textContent.startsWith('spc-anchor:')) {
                    anchorsAfter.push(walker2.currentNode.textContent);
                }
            }
            results.anchorsRemoved = anchorsAfter.length === 0;

            // Cleanup
            testPanel.remove();

            return results;
        });

        // Assert all synthetic adapter results
        assert('Adapter registered', syntheticResults.registered);
        assert('Controller DOM created', syntheticResults.controllerCreated);
        assert('Controller is first child of panel', syntheticResults.isFirstChild);
        assert('Picker shows current question ID (#3)', syntheticResults.pickerShowsId);
        assert('Picker shows current question label', syntheticResults.pickerShowsLabel);
        assert('Play button adopted into media slot', syntheticResults.playAdopted);
        assert('Record button adopted into attempt slot', syntheticResults.recordAdopted);
        assert('Stop button adopted into attempt slot', syntheticResults.stopAdopted);
        assert('Filter wrapper adopted into advanced-setting slot', syntheticResults.filterAdopted);
        assert('Play action role is applied', syntheticResults.playActionRole);
        assert('Record action role is applied', syntheticResults.recordActionRole);
        assert('Stop action role is applied', syntheticResults.stopActionRole);
        assert('Comment anchors created (≥4)', syntheticResults.anchorsCreated);
        assert('Source select hidden after adoption', syntheticResults.sourceSelectHidden);
        assert('Previous button hidden after adoption', syntheticResults.prevBtnHidden);
        assert('Next button hidden after adoption', syntheticResults.nextBtnHidden);
        assert('In-place control has data-spc-level', syntheticResults.inPlaceHasLevel);
        assert('View toggle exists', syntheticResults.toggleExists);
        assert('Initial view is Basic', syntheticResults.initialViewBasic);
        assert('Advanced row hidden in Basic', syntheticResults.advRowHiddenInBasic);
        assert('Advanced filter hidden in Basic', syntheticResults.filterHiddenInBasic);
        assert('In-place guide hidden in Basic', syntheticResults.guideHiddenInBasic);
        assert('View switched to Advanced', syntheticResults.switchedToAdvanced);
        assert('Advanced row visible in Advanced', syntheticResults.advRowVisibleInAdvanced);
        assert('Filter visible in Advanced', syntheticResults.filterVisibleInAdvanced);
        assert('In-place guide visible in Advanced', syntheticResults.guideVisibleInAdvanced);
        assert('Preference stored in localStorage', syntheticResults.preferenceStored);
        assert('Switched back to Basic', syntheticResults.switchedBackToBasic);
        assert('Picker syncs on source change', syntheticResults.pickerSyncsOnChange);
        assert('Sync API updates display', syntheticResults.syncApiWorks);
        assert('Active chip shows count 1', syntheticResults.activeChipCount);
        assert('Active chip text correct', syntheticResults.activeChipText);
        assert('Controller DOM removed after unmount', syntheticResults.controllerRemoved);
        assert('Play button restored after unmount', syntheticResults.playRestored);
        assert('Record button restored after unmount', syntheticResults.recordRestored);
        assert('Filter restored after unmount', syntheticResults.filterRestored);
        assert('Play action role is removed after unmount', syntheticResults.playActionRoleRestored);
        assert('Pre-existing record action role is restored', syntheticResults.recordActionRoleRestored);
        assert('Stop action role is removed after unmount', syntheticResults.stopActionRoleRestored);
        assert('Source select visible after unmount', syntheticResults.sourceSelectRestored);
        assert('Previous button visible after unmount', syntheticResults.prevBtnRestored);
        assert('Next button visible after unmount', syntheticResults.nextBtnRestored);
        assert('Random button display restored exactly after unmount', syntheticResults.randomBtnDisplayRestored);
        assert('In-place level attribute removed after unmount', syntheticResults.inPlaceLevelRemoved);
        assert('Comment anchors removed after unmount', syntheticResults.anchorsRemoved);

        // ===== Test 4: Picker sheet functionality =====
        console.log('\n[Test 4] Picker sheet — open, search, select, close');
        const pickerSheetResults = await page3.evaluate(() => {
            const SPC = window.SpeakingPracticeController;
            const results = {};

            // Rebuild synthetic panel
            const testPanel = document.createElement('div');
            testPanel.id = 'mode-sheet-test';
            testPanel.style.cssText = 'padding: 20px; min-height: 200px;';
            document.body.appendChild(testPanel);

            const sourceSelect = document.createElement('select');
            sourceSelect.id = 'sheet-test-select';
            for (let i = 1; i <= 5; i++) {
                const opt = document.createElement('option');
                opt.value = String(i);
                opt.textContent = 'Sheet Question ' + i;
                sourceSelect.appendChild(opt);
            }
            sourceSelect.value = '2';
            testPanel.appendChild(sourceSelect);

            SPC.register({
                modeId: 'sheet-test',
                testOnly: true,
                enabledScopes: ['pte'],
                panelId: 'mode-sheet-test',
                picker: { sourceSelectId: 'sheet-test-select' },
                controls: [],
                inPlaceControls: [],
                advancedSettings: []
            });

            SPC.activate('sheet-test', { scope: 'pte' });

            // Click picker pill
            const pill = document.getElementById('spc-picker-sheet-test');
            pill.click();

            // Wait a frame for sheet to open
            return new Promise(resolve => {
                requestAnimationFrame(() => {
                    const sheet = document.getElementById('spc-picker-sheet-sheet-test');
                    const backdrop = document.querySelector('[data-spc-sheet-id="spc-picker-sheet-sheet-test"]');

                    results.sheetExists = !!sheet;
                    results.sheetOpen = sheet?.classList.contains('is-active');
                    results.backdropActive = backdrop?.classList.contains('is-active');
                    const sheetStyle = sheet ? getComputedStyle(sheet) : null;
                    const searchStyle = sheet?.querySelector('.spc-sheet-search') ? getComputedStyle(sheet.querySelector('.spc-sheet-search')) : null;
                    const closeStyle = sheet?.querySelector('.spc-sheet-close') ? getComputedStyle(sheet.querySelector('.spc-sheet-close')) : null;
                    results.sheetUsesRfibRadius = sheetStyle?.borderTopLeftRadius === '12px';
                    results.searchUsesRfibHeight = parseFloat(searchStyle?.minHeight || '0') >= 44;
                    results.closeUsesCompactGeometry = closeStyle?.width === '36px' && closeStyle?.height === '36px';

                    // Check list items
                    const items = sheet?.querySelectorAll('.spc-sheet-item');
                    results.itemCount = items?.length || 0;

                    // Check current is highlighted
                    const currentItem = sheet?.querySelector('.spc-sheet-item.is-current');
                    results.currentHighlighted = currentItem?.dataset.id === '2';

                    // Test search
                    const searchInput = sheet?.querySelector('.spc-sheet-search');
                    if (searchInput) {
                        searchInput.value = 'Question 4';
                        searchInput.dispatchEvent(new Event('input'));
                    }

                    requestAnimationFrame(() => {
                        const visibleItems = Array.from(sheet?.querySelectorAll('.spc-sheet-item') || [])
                            .filter(el => el.style.display !== 'none');
                        results.searchFilters = visibleItems.length === 1;
                        results.searchMatchesCorrect = visibleItems[0]?.dataset.id === '4';

                        // Select item
                        visibleItems[0]?.click();

                        requestAnimationFrame(() => {
                            results.sheetClosedAfterSelect = !sheet?.classList.contains('is-active');
                            results.selectValueUpdated = sourceSelect.value === '4';

                            const pillId = document.querySelector('#mode-sheet-test .spc-picker-pill-id');
                            results.pillUpdatedAfterSelect = pillId?.textContent === '#4';

                            // Cleanup
                            SPC.unmount('sheet-test');
                            testPanel.remove();

                            resolve(results);
                        });
                    });
                });
            });
        });

        assert('Picker sheet element exists', pickerSheetResults.sheetExists);
        assert('Picker sheet opens on pill click', pickerSheetResults.sheetOpen);
        assert('Backdrop activates', pickerSheetResults.backdropActive);
        assert('Picker sheet uses RFIB radius', pickerSheetResults.sheetUsesRfibRadius);
        assert('Picker search meets RFIB control height', pickerSheetResults.searchUsesRfibHeight);
        assert('Picker close uses compact geometry', pickerSheetResults.closeUsesCompactGeometry);
        assert('Sheet lists all 5 items', pickerSheetResults.itemCount === 5);
        assert('Current question highlighted', pickerSheetResults.currentHighlighted);
        assert('Search filters to 1 result', pickerSheetResults.searchFilters);
        assert('Search matches correct item', pickerSheetResults.searchMatchesCorrect);
        assert('Sheet closes after item selection', pickerSheetResults.sheetClosedAfterSelect);
        assert('Source select value updated', pickerSheetResults.selectValueUpdated);
        assert('Pill updated after selection', pickerSheetResults.pillUpdatedAfterSelect);

        // ===== Test 5: No-toggle adapter =====
        console.log('\n[Test 5] No-toggle adapter (ASQ/RTS pattern)');
        const noToggleResults = await page3.evaluate(() => {
            const SPC = window.SpeakingPracticeController;
            const results = {};

            // Set preference to advanced first
            SPC.setPreferredView('advanced');

            const testPanel = document.createElement('div');
            testPanel.id = 'mode-no-toggle-test';
            testPanel.style.cssText = 'padding: 20px;';
            document.body.appendChild(testPanel);

            const sourceSelect = document.createElement('select');
            sourceSelect.id = 'no-toggle-select';
            const opt = document.createElement('option');
            opt.value = '1';
            opt.textContent = 'Q1';
            sourceSelect.appendChild(opt);
            testPanel.appendChild(sourceSelect);

            SPC.register({
                modeId: 'no-toggle-test',
                testOnly: true,
                enabledScopes: ['pte'],
                panelId: 'mode-no-toggle-test',
                picker: { sourceSelectId: 'no-toggle-select' },
                controls: [],
                inPlaceControls: [],
                advancedSettings: []
            });

            SPC.activate('no-toggle-test', { scope: 'pte' });

            const controller = testPanel.querySelector('.spc-controller');
            results.hasNoToggleAttr = controller?.hasAttribute('data-spc-no-toggle');

            const toggle = controller?.querySelector('.spc-view-toggle');
            results.toggleHidden = toggle ? getComputedStyle(toggle).display === 'none' : true;

            // View forced to basic despite preference being advanced
            results.viewIsBasic = controller?.dataset.spcView === 'basic';

            // Check that stored preference was NOT overwritten
            results.storedPreferenceUnchanged = SPC.getPreferredView() === 'advanced';

            SPC.unmount('no-toggle-test');
            testPanel.remove();

            // Reset preference
            SPC.setPreferredView('basic');

            return results;
        });

        assert('No-toggle attribute present', noToggleResults.hasNoToggleAttr);
        assert('Toggle is hidden for no-advanced modes', noToggleResults.toggleHidden);
        assert('View forced to basic', noToggleResults.viewIsBasic);
        assert('Stored preference NOT overwritten', noToggleResults.storedPreferenceUnchanged);

        // ===== Test 6: switchToMode lifecycle integration =====
        console.log('\n[Test 6] switchToMode lifecycle integration');
        const context6 = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
        await context6.addInitScript(() => {
            window.localStorage.setItem('userStatus', 'guest');
            window.localStorage.setItem('hasSeenScopeTutorial', 'true');
        });
        const page6 = await context6.newPage();
        await page6.goto(`http://localhost:${server.address().port}/?speakingController=v2`, { waitUntil: 'domcontentloaded' });
        await dismissBlockingOverlays(page6);

        const lifecycleResults = await page6.evaluate(async () => {
            const SPC = window.SpeakingPracticeController;
            const panel = document.getElementById('mode-speak');
            const sourceSelect = document.getElementById('question-select-speak');
            if (!panel || !sourceSelect || typeof window.switchToMode !== 'function') {
                return { available: false };
            }

            SPC.register({
                modeId: 'speak',
                testOnly: true,
                enabledScopes: ['pte'],
                panelId: 'mode-speak',
                picker: { sourceSelectId: 'question-select-speak' },
                controls: [],
                inPlaceControls: [],
                advancedSettings: []
            });

            await window.switchToMode('speak');
            await new Promise(resolve => setTimeout(resolve, 200));
            const results = {
                available: true,
                mountedAfterSwitch: !!panel.querySelector('.spc-controller')
            };

            window.PracticeScopeManager?.setScope('english', { persist: false });
            await new Promise(resolve => setTimeout(resolve, 100));
            results.unmountedAfterScopeChange = !panel.querySelector('.spc-controller');

            window.PracticeScopeManager?.setScope('pte', { persist: false });
            await new Promise(resolve => setTimeout(resolve, 100));
            results.remountedAfterScopeChange = !!panel.querySelector('.spc-controller');

            SPC.unmount('speak');
            return results;
        });

        await context6.close();

        assert('Lifecycle integration is available', lifecycleResults.available);
        assert('Controller mounts after switchToMode', lifecycleResults.mountedAfterSwitch);
        assert('Controller unmounts after scope change', lifecycleResults.unmountedAfterScopeChange);
        assert('Controller remounts after returning to eligible scope', lifecycleResults.remountedAfterScopeChange);

        // ===== Test 7: asynchronous notes activation =====
        console.log('\n[Test 7] Asynchronous notes activation');
        const notesTimingResults = await page3.evaluate(async () => {
            const SPC = window.SpeakingPracticeController;
            const panel = document.getElementById('mode-notes');
            const sourceSelect = document.getElementById('question-select-notes');
            const loader = window.BELLazyLoader;
            const originalEnsure = loader?.ensureModeScripts;
            const originalTakeNotes = window.TakeNotesMode;
            if (!panel || !sourceSelect || !loader || typeof window.switchToMode !== 'function') {
                return { available: false };
            }

            let entriesLoaded = false;
            loader.ensureModeScripts = async () => true;
            window.TakeNotesMode = {
                loadEntries: () => new Promise(resolve => {
                    setTimeout(() => {
                        entriesLoaded = true;
                        resolve();
                    }, 100);
                })
            };

            SPC.register({
                modeId: 'notes',
                testOnly: true,
                enabledScopes: ['pte'],
                panelId: 'mode-notes',
                picker: { sourceSelectId: 'question-select-notes' },
                controls: [],
                inPlaceControls: [],
                advancedSettings: []
            });

            const switchPromise = window.switchToMode('notes');
            await new Promise(resolve => setTimeout(resolve, 30));
            const results = {
                available: true,
                notMountedBeforeEntriesLoad: !panel.querySelector('.spc-controller'),
                entriesLoadedBeforeSwitchResolves: false
            };
            await switchPromise;
            results.entriesLoadedBeforeSwitchResolves = entriesLoaded;
            results.mountedAfterEntriesLoad = !!panel.querySelector('.spc-controller');

            SPC.unmount('notes');
            window.TakeNotesMode = originalTakeNotes;
            if (loader) loader.ensureModeScripts = originalEnsure;
            return results;
        });

        assert('Notes timing fixture is available', notesTimingResults.available);
        assert('Notes controller waits for entries before mounting', notesTimingResults.notMountedBeforeEntriesLoad);
        assert('Entries finish before switch resolves', notesTimingResults.entriesLoadedBeforeSwitchResolves);
        assert('Notes controller mounts after entries load', notesTimingResults.mountedAfterEntriesLoad);

        // ===== Test 8: Production adapter registration =====
        console.log('\n[Test 8] Production adapter registration');
        const context8 = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
        await context8.addInitScript(() => {
            window.localStorage.setItem('userStatus', 'guest');
            window.localStorage.setItem('hasSeenScopeTutorial', 'true');
        });
        const page8 = await context8.newPage();
        await page8.goto(`http://localhost:${server.address().port}/?speakingController=v2`, { waitUntil: 'domcontentloaded' });
        await dismissBlockingOverlays(page8);
        await page8.evaluate(async () => window.switchToMode('rts'));
        await page8.waitForFunction(() => (window.RTSMode?.getItems?.() || []).length > 1, { timeout: 15000 });

        const productionAdapterResults = await page8.evaluate(async () => {
            const SPC = window.SpeakingPracticeController;
            const results = {};
            const actionRole = (root, id) => root?.querySelector(`#${id}`)?.dataset.spcActionRole || null;
            const asqPanel = document.getElementById('mode-asq');
            const rtsPanel = document.getElementById('mode-rts');
            const sgdPanel = document.getElementById('mode-sgd');

            SPC.activate('asq', { scope: 'pte' });
            const asqController = asqPanel?.querySelector('.spc-controller');
            results.asqMounted = !!asqController;
            results.asqPlayAdopted = !!asqPanel?.querySelector('#asq-play-prompt-btn');
            results.asqActionRoles = [
                actionRole(asqPanel, 'asq-record-btn'),
                actionRole(asqPanel, 'asq-stop-btn'),
                actionRole(asqPanel, 'asq-redo-btn')
            ].join(',') === 'record,stop,retry';
            results.asqNoToggle = asqController?.hasAttribute('data-spc-no-toggle') === true;
            SPC.unmount('asq');

            results.rtsApiAvailable = !!window.RTSMode &&
                typeof window.RTSMode.getItems === 'function' &&
                typeof window.RTSMode.getCurrentId === 'function' &&
                typeof window.RTSMode.select === 'function';
            SPC.activate('rts', { scope: 'pte' });
            const rtsController = rtsPanel?.querySelector('.spc-controller');
            results.rtsMounted = !!rtsController;
            results.rtsPlayAdopted = !!rtsPanel?.querySelector('#play-rts-btn');
            results.rtsActionRoles = [
                actionRole(rtsPanel, 'play-rts-btn'),
                actionRole(rtsPanel, 'rts-stop-btn'),
                actionRole(rtsPanel, 'rts-retry-btn'),
                actionRole(rtsPanel, 'rts-ai-score-btn'),
                actionRole(rtsPanel, 'rts-next-question-btn')
            ].join(',') === 'play,stop,retry,ai,next';
            results.rtsNoToggle = rtsPanel?.querySelector('.spc-controller')?.hasAttribute('data-spc-no-toggle') === true;
            const rtsLegacyPicker = document.getElementById('rts-v7-picker-bar');
            results.rtsLegacyPickerHidden = !rtsLegacyPicker || rtsLegacyPicker.style.display === 'none';
            const rtsBeforeId = window.RTSMode?.getCurrentId?.();
            rtsController?.querySelector('.spc-picker-next')?.click();
            await new Promise(resolve => setTimeout(resolve, 100));
            results.rtsSharedNextNavigates = !!rtsBeforeId && window.RTSMode?.getCurrentId?.() !== rtsBeforeId;
            SPC.unmount('rts');

            const diPanel = document.getElementById('mode-describe-image');
            SPC.activate('describe-image', { scope: 'pte' });
            const diController = diPanel?.querySelector('.spc-controller');
            results.diMounted = !!diController;
            results.diPlayAdopted = !!diPanel?.querySelector('#play-di-btn');
            results.diActionRoles = [
                actionRole(diPanel, 'play-di-btn'),
                actionRole(diPanel, 'di-stop-btn'),
                actionRole(diPanel, 'di-retry-btn'),
                actionRole(diPanel, 'di-submit-btn'),
                actionRole(diPanel, 'di-results-retry-btn'),
                actionRole(diPanel, 'di-next-question-btn'),
                actionRole(diPanel, 'di-ai-btn')
            ].join(',') === 'play,stop,retry,primary,retry,next,ai';
            results.diHasAdvanced = !!diController && !diController.hasAttribute('data-spc-no-toggle');
            // The filter is a real Settings control, so it belongs in the
            // mode sheet rather than being duplicated in the controller.
            const diSettingsSheet = document.querySelector('#spc-settings-sheet-describe-image');
            results.diDifficultyAdopted = !!diSettingsSheet?.querySelector('#difficulty-filter-container-di');
            results.diDifficultyInPanel = !!diPanel?.querySelector('#difficulty-filter-container-di');
            SPC.unmount('describe-image');

            const notesPanel = document.getElementById('mode-notes');
            SPC.activate('notes', { scope: 'pte' });
            const notesController = notesPanel?.querySelector('.spc-controller');
            results.notesMountedInPte = !!notesController;
            results.notesPlayAdopted = !!notesPanel?.querySelector('#play-notes-btn');
            results.notesActionRoles = [
                actionRole(notesPanel, 'play-notes-btn'),
                actionRole(notesPanel, 'notes-submit-btn'),
                actionRole(notesPanel, 'notes-retry-btn'),
                actionRole(notesPanel, 'recommended-btn-notes')
            ].join(',') === 'play,primary,retry,support';
            results.notesHasAdvanced = !!notesController && !notesController.hasAttribute('data-spc-no-toggle');
            SPC.activate('notes', { scope: 'english' });
            results.notesUnmountedInEnglish = !notesPanel?.querySelector('.spc-controller');
            SPC.unmount('notes');

            results.sgdDifficultyFilterPresent = !!document.getElementById('difficulty-filter-container-sgd');
            results.sgdDeadStatusFilterRemoved = !document.getElementById('status-filter-container-sgd');
            SPC.activate('sgd', { scope: 'pte' });
            const sgdController = sgdPanel?.querySelector('.spc-controller');
            results.sgdMounted = !!sgdController;
            results.sgdPlayAdopted = !!sgdPanel?.querySelector('#play-sgd-btn');
            results.sgdActionRoles = [
                actionRole(sgdPanel, 'play-sgd-btn'),
                actionRole(sgdPanel, 'sgd-record-btn'),
                actionRole(sgdPanel, 'sgd-stop-btn'),
                actionRole(sgdPanel, 'sgd-submit-btn'),
                actionRole(sgdPanel, 'sgd-retry-btn'),
                actionRole(sgdPanel, 'recommended-btn-sgd')
            ].join(',') === 'play,record,stop,primary,retry,support';
            results.sgdHasAdvanced = !!sgdController && !sgdController.hasAttribute('data-spc-no-toggle');
            results.sgdDifficultyFilterAdopted = !!document.querySelector('#spc-settings-sheet-sgd #difficulty-filter-container-sgd');
            SPC.unmount('sgd');

            const speakPanel = document.getElementById('mode-speak');
            SPC.activate('speak', { scope: 'pte' });
            const speakController = speakPanel?.querySelector('.spc-controller');
            results.speakMounted = !!speakController;
            results.speakPlayAdopted = !!speakPanel?.querySelector('#play-btn-speak');
            results.speakRecordAdopted = !!speakPanel?.querySelector('#record-btn');
            results.speakCheckAdopted = !!speakPanel?.querySelector('#check-btn-speak');
            results.speakRetryAdopted = !!speakPanel?.querySelector('#retry-btn-speak');
            results.speakActionRoles = [
                actionRole(speakPanel, 'record-btn'),
                actionRole(speakPanel, 'check-btn-speak'),
                actionRole(speakPanel, 'retry-btn-speak'),
                actionRole(speakPanel, 'shadow-mode-btn'),
                actionRole(speakPanel, 'recommended-btn-speak')
            ].join(',') === 'record,primary,retry,support,support';
            results.speakStatusBadgeHasNoActionRole = !speakController?.querySelector('#replay-counter-speak')?.dataset.spcActionRole;
            results.speakRecommendedAdopted = !!speakController?.querySelector('#recommended-btn-speak');
            const speakSettingsSheet = document.querySelector('#spc-settings-sheet-speak');
            results.speakSettingsNodesHaveNoActionRole = !speakSettingsSheet?.querySelector('[data-spc-action-role]');
            results.speakStatusFilterAdopted = !!speakSettingsSheet?.querySelector('#status-filter-container-speak');
            results.speakLengthFilterAdopted = !!speakSettingsSheet?.querySelector('#length-filter-container-speak');
            results.speakDifficultyFilterAdopted = !!speakSettingsSheet?.querySelector('#difficulty-filter-container-speak');
            results.speakHasAdvanced = !!speakController && !speakController.hasAttribute('data-spc-no-toggle');
            // Settings sheets own moved controls and must be fully cleaned up
            // when the mode unmounts, so repeated mode switches cannot strand
            // controls or create duplicate IDs.
            results.speakSettingsSheetCreated = document.querySelectorAll('#spc-settings-sheet-speak').length === 1;
            results.speakAdaptiveMovedToSettings = !!document.querySelector('#spc-settings-sheet-speak #adaptive-toggle-container-speak');
            SPC.unmount('speak');

            results.speakSettingsSheetRemovedOnUnmount = document.querySelectorAll('#spc-settings-sheet-speak').length === 0;
            results.speakAdaptiveRestoredToPanel = !!speakPanel?.querySelector('#adaptive-toggle-container-speak');
            SPC.activate('speak', { scope: 'pte' });
            const remountedSpeakSheet = document.querySelector('#spc-settings-sheet-speak');
            results.speakRemountHasSingleSettingsSheet = document.querySelectorAll('#spc-settings-sheet-speak').length === 1;
            results.speakRemountRestoresAdaptive = !!remountedSpeakSheet?.querySelector('#adaptive-toggle-container-speak');
            // Count/score copy is intentionally removed from the shared
            // Speaking shell; retain the scoring target hidden when needed,
            // but do not restore the old question-total surface.
            results.speakRemountHasNoQuestionTotal = !remountedSpeakSheet?.querySelector('.question-total');
            SPC.unmount('speak');

            const typePanel = document.getElementById('mode-type');
            SPC.activate('type', { scope: 'pte' });
            const typeController = typePanel?.querySelector('.spc-controller');
            results.typeHasNoActionRoles = !typeController?.querySelector('[data-spc-action-role]');
            SPC.unmount('type');

            const raPanel = document.getElementById('mode-read-aloud');
            SPC.activate('read-aloud', { scope: 'pte' });
            const raController = raPanel?.querySelector('.spc-controller');
            results.raMounted = !!raController;
            results.raPickerAdopted = !!raController?.querySelector('#spc-picker-read-aloud');
            const raSettingsSheet = document.querySelector('#ra-settings-sheet');
            results.raSampleListenAdopted = !!raSettingsSheet?.querySelector('#ra-play-audio-btn');
            results.raRecordAdopted = !!raPanel?.querySelector('#ra-record-btn');
            results.raStopAdopted = !!raPanel?.querySelector('#ra-stop-btn');
            results.raPlaybackAdopted = !!raPanel?.querySelector('#ra-play-recording-btn');
            results.raCheckAdopted = !!raPanel?.querySelector('#ra-check-btn');
            results.raRetryAdopted = !!raPanel?.querySelector('#ra-retry-btn');
            results.raFilterActionRemoved = !document.getElementById('ra-v7-filters-btn');
            results.raFilterDrawerAdopted = !!raSettingsSheet?.querySelector('#ra-filter-all');
            results.raAudioSettingsAdopted = !!raSettingsSheet?.querySelector('#ra-audio-player');
            results.raGuidesRemainInPanel = !!raPanel?.querySelector('#ra-prompt-guides-group[data-spc-level="advanced"]');
            const raLegacyPicker = document.getElementById('ra-v7-picker-bar');
            results.raLegacyPickerHidden = !raLegacyPicker || raLegacyPicker.style.display === 'none';
            results.raHasAdvanced = !!raController && !raController.hasAttribute('data-spc-no-toggle');
            results.raArchiveApiAvailable = !!window.PTEAttemptArchive &&
                typeof window.PTEAttemptArchive.updateHistoryUI === 'function';
            if (results.raArchiveApiAvailable) {
                await window.PTEAttemptArchive.updateHistoryUI('read-aloud', '1');
            }
            results.raHistoryActionHostAdopted = !!raSettingsSheet?.querySelector('#ra-history-action-host');
            results.raHistoryToggleUsesDedicatedHost = !!document.querySelector('#ra-history-action-host #read-aloud-history-toggle');
            results.raHistoryContentUsesDedicatedHost = !!document.querySelector('#ra-history-content-host #read-aloud-history-container');
            SPC.unmount('read-aloud');
            results.raLegacyPickerRestored = !raLegacyPicker || raLegacyPicker.style.display !== 'none';
            results.raHistoryActionHostHiddenAfterUnmount = document.getElementById('ra-settings-sheet')?.getAttribute('aria-hidden') === 'true';
            return results;
        });

        await context8.close();

        assert('ASQ production adapter mounts', productionAdapterResults.asqMounted);
        assert('ASQ Play control is adopted', productionAdapterResults.asqPlayAdopted);
        assert('ASQ action roles are mapped', productionAdapterResults.asqActionRoles);
        assert('ASQ omits Advanced toggle', productionAdapterResults.asqNoToggle);
        assert('RTS picker bridge API is available', productionAdapterResults.rtsApiAvailable);
        assert('RTS production adapter mounts', productionAdapterResults.rtsMounted);
        assert('RTS action roles are mapped', productionAdapterResults.rtsActionRoles);
        assert('RTS omits Advanced toggle', productionAdapterResults.rtsNoToggle);
        assert('RTS legacy picker is hidden', productionAdapterResults.rtsLegacyPickerHidden);
        assert('RTS shared Next navigates', productionAdapterResults.rtsSharedNextNavigates);
        assert('Describe Image production adapter mounts', productionAdapterResults.diMounted);
        assert('Describe Image Play control is adopted', productionAdapterResults.diPlayAdopted);
        assert('Describe Image action roles are mapped', productionAdapterResults.diActionRoles);
        assert('Describe Image exposes Advanced view', productionAdapterResults.diHasAdvanced);
        assert('Describe Image difficulty filter is adopted', productionAdapterResults.diDifficultyAdopted);
        assert('Retell Lecture mounts in PTE', productionAdapterResults.notesMountedInPte);
        assert('Retell Lecture Play control is adopted', productionAdapterResults.notesPlayAdopted);
        assert('Retell Lecture action roles are mapped', productionAdapterResults.notesActionRoles);
        assert('Retell Lecture exposes Advanced view', productionAdapterResults.notesHasAdvanced);
        assert('English Take Notes remains unmounted', productionAdapterResults.notesUnmountedInEnglish);
        assert('SGD difficulty filter markup exists', productionAdapterResults.sgdDifficultyFilterPresent);
        assert('SGD dead status filter is removed', productionAdapterResults.sgdDeadStatusFilterRemoved);
        assert('SGD production adapter mounts', productionAdapterResults.sgdMounted);
        assert('SGD Play control is adopted', productionAdapterResults.sgdPlayAdopted);
        assert('SGD action roles are mapped', productionAdapterResults.sgdActionRoles);
        assert('SGD exposes Advanced view', productionAdapterResults.sgdHasAdvanced);
        assert('SGD difficulty filter is adopted', productionAdapterResults.sgdDifficultyFilterAdopted);
        assert('Speak production adapter mounts', productionAdapterResults.speakMounted);
        assert('Speak Play control is adopted', productionAdapterResults.speakPlayAdopted);
        assert('Speak Record control is adopted', productionAdapterResults.speakRecordAdopted);
        assert('Speak Check control is adopted', productionAdapterResults.speakCheckAdopted);
        assert('Speak Retry control is adopted', productionAdapterResults.speakRetryAdopted);
        assert('Speak action roles are mapped', productionAdapterResults.speakActionRoles);
        assert('Speak status badge has no action role', productionAdapterResults.speakStatusBadgeHasNoActionRole);
        assert('Speak Recommended action is adopted', productionAdapterResults.speakRecommendedAdopted);
        assert('Speak status filter is adopted', productionAdapterResults.speakStatusFilterAdopted);
        assert('Speak length filter is adopted', productionAdapterResults.speakLengthFilterAdopted);
        assert('Speak difficulty filter is adopted', productionAdapterResults.speakDifficultyFilterAdopted);
        assert('Speak exposes Advanced view', productionAdapterResults.speakHasAdvanced);
        assert('Speak settings nodes have no action roles', productionAdapterResults.speakSettingsNodesHaveNoActionRole);
        assert('Speak settings sheet is created once', productionAdapterResults.speakSettingsSheetCreated);
        assert('Speak adaptive controls move into settings', productionAdapterResults.speakAdaptiveMovedToSettings);
        assert('Speak settings sheet is removed on unmount', productionAdapterResults.speakSettingsSheetRemovedOnUnmount);
        assert('Speak adaptive controls restore to panel on unmount', productionAdapterResults.speakAdaptiveRestoredToPanel);
        assert('Speak remount keeps one settings sheet', productionAdapterResults.speakRemountHasSingleSettingsSheet);
        assert('Speak remount restores adaptive controls', productionAdapterResults.speakRemountRestoresAdaptive);
        assert('Speak remount keeps question total surface removed', productionAdapterResults.speakRemountHasNoQuestionTotal);
        assert('Listening Type receives no action roles', productionAdapterResults.typeHasNoActionRoles);
        assert('Read Aloud production adapter mounts', productionAdapterResults.raMounted);
        assert('Read Aloud shared picker is present', productionAdapterResults.raPickerAdopted);
        assert('Read Aloud sample Listen is adopted', productionAdapterResults.raSampleListenAdopted);
        assert('Read Aloud Record control is adopted', productionAdapterResults.raRecordAdopted);
        assert('Read Aloud Stop control is adopted', productionAdapterResults.raStopAdopted);
        assert('Read Aloud playback control is adopted', productionAdapterResults.raPlaybackAdopted);
        assert('Read Aloud Check control is adopted', productionAdapterResults.raCheckAdopted);
        assert('Read Aloud Retry control is adopted', productionAdapterResults.raRetryAdopted);
        assert('Read Aloud legacy filter action is removed', productionAdapterResults.raFilterActionRemoved);
        assert('Read Aloud filter drawer is adopted', productionAdapterResults.raFilterDrawerAdopted);
        assert('Read Aloud audio settings are adopted', productionAdapterResults.raAudioSettingsAdopted);
        assert('Read Aloud guides remain in panel and are advanced-gated', productionAdapterResults.raGuidesRemainInPanel);
        assert('Read Aloud legacy picker is hidden', productionAdapterResults.raLegacyPickerHidden);
        assert('Read Aloud exposes Advanced view', productionAdapterResults.raHasAdvanced);
        assert('Read Aloud legacy picker restores on unmount', productionAdapterResults.raLegacyPickerRestored);
        assert('Read Aloud archive API is available', productionAdapterResults.raArchiveApiAvailable);
        assert('Read Aloud history action host is adopted', productionAdapterResults.raHistoryActionHostAdopted);
        assert('Read Aloud history toggle uses dedicated host', productionAdapterResults.raHistoryToggleUsesDedicatedHost);
        assert('Read Aloud history content uses dedicated host', productionAdapterResults.raHistoryContentUsesDedicatedHost);
        assert('Read Aloud history action hides after unmount', productionAdapterResults.raHistoryActionHostHiddenAfterUnmount);

        // ===== Test 9: No console/page errors =====
        console.log('\n[Test 9] Error checks');
        const spcErrors = consoleErrors.filter(e => e.includes('[SPC]'));
        assert('No SPC-specific console errors', spcErrors.length === 0);
        assert('No page errors', pageErrors.length === 0);

        if (spcErrors.length > 0) {
            console.log('  SPC console errors:', spcErrors);
        }
        if (pageErrors.length > 0) {
            console.log('  Page errors:', pageErrors);
        }

        await context3.close();

        // ===== Test 10: View preference persistence across page reload =====
        console.log('\n[Test 10] View preference persistence');
        const context7 = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
        await context7.addInitScript(() => {
            window.localStorage.setItem('userStatus', 'guest');
            window.localStorage.setItem('hasSeenScopeTutorial', 'true');
            window.localStorage.setItem('bel:speaking-controller:view:v1', 'advanced');
        });
        const page7 = await context7.newPage();
        await page7.goto(`http://localhost:${server.address().port}/?speakingController=v2`, { waitUntil: 'domcontentloaded' });
        await dismissBlockingOverlays(page7);

        const persistedView = await page7.evaluate(() => {
            return window.SpeakingPracticeController.getPreferredView();
        });
        assert('View preference persists across page load', persistedView === 'advanced');

        // ===== Test 11: Wave 0 remediation contract =====
        console.log('\n[Test 11] Wave 0 remediation contract');
        const remediationResults = await page7.evaluate(() => {
            const SPC = window.SpeakingPracticeController;
            const results = {};
            const testPanel = document.createElement('div');
            testPanel.id = 'mode-remediation-test';
            document.body.appendChild(testPanel);

            const sourceSelect = document.createElement('select');
            sourceSelect.id = 'remediation-select';
            sourceSelect.style.display = 'inline-block';
            ['1', '2'].forEach(id => {
                const option = document.createElement('option');
                option.value = id;
                option.textContent = 'Question ' + id;
                sourceSelect.appendChild(option);
            });
            testPanel.appendChild(sourceSelect);

            const prevBtn = document.createElement('button');
            prevBtn.id = 'remediation-prev';
            prevBtn.style.display = 'flex';
            testPanel.appendChild(prevBtn);

            const nextBtn = document.createElement('button');
            nextBtn.id = 'remediation-next';
            nextBtn.style.display = 'inline-flex';
            testPanel.appendChild(nextBtn);

            SPC.register({
                modeId: 'remediation-test',
                testOnly: true,
                enabledScopes: ['pte'],
                panelId: 'mode-remediation-test',
                picker: {
                    sourceSelectId: 'remediation-select',
                    previousButtonId: 'remediation-prev',
                    nextButtonId: 'remediation-next'
                },
                controls: [],
                inPlaceControls: [],
                advancedSettings: [{
                    key: 'example',
                    sourceId: 'remediation-select',
                    isActive: () => false,
                    summaryLabel: 'Example'
                }]
            });

            SPC.activate('remediation-test', { scope: 'pte' });
            const controller = testPanel.querySelector('.spc-controller');
            const advancedBtn = controller?.querySelector('[data-view="advanced"]');
            const pill = controller?.querySelector('.spc-picker-pill');

            advancedBtn?.click();
            results.toggleUsesPressed = advancedBtn?.getAttribute('aria-pressed') === 'true';

            pill?.click();
            return new Promise(resolve => requestAnimationFrame(() => {
                const sheet = document.getElementById('spc-picker-sheet-remediation-test');
                const firstItem = sheet?.querySelector('.spc-sheet-item');
                results.pillExpandedWhenOpen = pill?.getAttribute('aria-expanded') === 'true';
                results.itemKeyboardFocusable = Number(firstItem?.tabIndex) >= 0;

                document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
                requestAnimationFrame(() => {
                    results.sheetHiddenWhenClosed = sheet?.getAttribute('aria-hidden') === 'true';
                    results.sheetInertWhenClosed = sheet?.inert === true;
                    results.pillCollapsedWhenClosed = pill?.getAttribute('aria-expanded') === 'false';

                    SPC.unmount('remediation-test');
                    results.selectDisplayRestored = sourceSelect.style.display === 'inline-block';
                    results.prevDisplayRestored = prevBtn.style.display === 'flex';
                    results.nextDisplayRestored = nextBtn.style.display === 'inline-flex';

                    // An ineligible scope must remove an existing controller.
                    SPC.activate('remediation-test', { scope: 'pte' });
                    SPC.activate('remediation-test', { scope: 'english' });
                    results.ineligibleScopeUnmounts = !testPanel.querySelector('.spc-controller');

                    testPanel.remove();
                    resolve(results);
                });
            }));
        });

        assert('Toggle exposes aria-pressed state', remediationResults.toggleUsesPressed);
        assert('Picker pill expands its ARIA state', remediationResults.pillExpandedWhenOpen);
        assert('Picker item is keyboard focusable', remediationResults.itemKeyboardFocusable);
        assert('Closed sheet is aria-hidden', remediationResults.sheetHiddenWhenClosed);
        assert('Closed sheet is inert', remediationResults.sheetInertWhenClosed);
        assert('Picker pill collapses its ARIA state', remediationResults.pillCollapsedWhenClosed);
        assert('Original select display is restored exactly', remediationResults.selectDisplayRestored);
        assert('Original previous-button display is restored exactly', remediationResults.prevDisplayRestored);
        assert('Original next-button display is restored exactly', remediationResults.nextDisplayRestored);
        assert('Ineligible scope unmounts active controller', remediationResults.ineligibleScopeUnmounts);
        await context7.close();

        // ===== Test 12: Integrated default targets and scope switching =====
        console.log('\n[Test 12] Integrated default targets and scope switching');
        const context12 = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
        await context12.addInitScript(() => {
            window.localStorage.setItem('userStatus', 'guest');
            window.localStorage.setItem('hasSeenScopeTutorial', 'true');
        });
        const page12 = await context12.newPage();
        await page12.goto(`http://localhost:${server.address().port}/`, { waitUntil: 'domcontentloaded' });
        await dismissBlockingOverlays(page12);
        const defaultResults = await page12.evaluate(async () => {
            const SPC = window.SpeakingPracticeController;
            const targets = [
                ['speak', 'pte'], ['read-aloud', 'pte'], ['notes', 'pte'], ['asq', 'pte'],
                ['sgd', 'pte'], ['describe-image', 'pte'], ['rts', 'pte'],
                ['speak', 'english'], ['read-aloud', 'english']
            ];
            const defaultsEnabled = targets.every(([mode, scope]) => SPC.isV2Active(mode, scope));
            const exclusionsRemainOff = !SPC.isV2Active('pronounce', 'pte')
                && !SPC.isV2Active('notes', 'english')
                && !SPC.isV2Active('asq', 'english');

            await window.switchToMode('speak');
            const pteMounted = !!document.querySelector('#mode-speak .spc-controller');
            window.setPracticeScope('english', { persist: false });
            await new Promise(resolve => setTimeout(resolve, 100));
            const englishSpeakMounted = !!document.querySelector('#mode-speak .spc-controller');
            await window.switchToMode('notes');
            const englishNotesUnmounted = !document.querySelector('#mode-notes .spc-controller');
            window.setPracticeScope('pte', { persist: false });
            await new Promise(resolve => setTimeout(resolve, 100));
            return { defaultsEnabled, exclusionsRemainOff, pteMounted, englishSpeakMounted, englishNotesUnmounted };
        });
        assert('All migrated targets enabled by default', defaultResults.defaultsEnabled);
        assert('Excluded scope/mode combinations remain disabled', defaultResults.exclusionsRemainOff);
        assert('PTE controller mounts without query override', defaultResults.pteMounted);
        assert('English Speak remains mounted after scope switch', defaultResults.englishSpeakMounted);
        assert('English Retell Lecture remains legacy/unmounted', defaultResults.englishNotesUnmounted);

        // ===== Test 13: RFIB visual contract for Speaking controller =====
        console.log('\n[Test 13] RFIB visual contract for Speaking controller');
        const speakingDesktopStyles = await page12.evaluate(async () => {
            await window.switchToMode('speak');
            await new Promise(resolve => setTimeout(resolve, 250));

            const speakPanel = document.querySelector('#mode-speak');
            const controller = speakPanel?.querySelector('.spc-controller');
            const styleOf = (selector, pseudo = null) => {
                const element = controller?.querySelector(selector);
                return element ? getComputedStyle(element, pseudo) : null;
            };
            const prev = controller?.querySelector('.spc-picker-prev');
            const next = controller?.querySelector('.spc-picker-next');
            const pill = controller?.querySelector('.spc-picker-pill');
            const primary = speakPanel?.querySelector('[data-spc-action-role="primary"]');
            const retry = speakPanel?.querySelector('[data-spc-action-role="retry"]');
            const record = speakPanel?.querySelector('[data-spc-action-role="record"]');
            const support = speakPanel?.querySelector('[data-spc-action-role="support"]');
            const normalPrev = prev ? getComputedStyle(prev) : null;
            const normalNext = next ? getComputedStyle(next) : null;
            const normalPill = pill ? getComputedStyle(pill) : null;
            const originalNextTransition = next?.style.transition || '';

            if (next) next.disabled = false;
            const enabledNext = next ? {
                opacity: getComputedStyle(next).opacity,
                cursor: getComputedStyle(next).cursor
            } : null;
            if (next) next.style.transition = 'none';
            if (next) next.disabled = true;
            const disabledNext = next ? {
                opacity: getComputedStyle(next).opacity,
                cursor: getComputedStyle(next).cursor,
                matchesDisabled: next.matches(':disabled'),
                disabled: next.disabled
            } : null;
            if (next) {
                next.disabled = false;
                next.style.transition = originalNextTransition;
            }

            return {
                controllerPresent: !!controller,
                previousSlate: !!normalPrev?.backgroundImage?.includes('107, 114, 128'),
                nextPurple: !!normalNext?.backgroundImage?.includes('139, 92, 246'),
                pillRadius: normalPill?.borderRadius === '12px',
                pillHasBorder: normalPill?.borderTopWidth === '1px',
                pillMinHeight: parseFloat(normalPill?.minHeight || '0') >= 44,
                primaryGreen: !!primary && getComputedStyle(primary).backgroundImage.includes('34, 197, 94'),
                retryAmber: !!retry && getComputedStyle(retry).backgroundImage.includes('245, 158, 11'),
                recordRed: !!record && getComputedStyle(record).backgroundImage.includes('244, 63, 94'),
                supportPeach: !!support && getComputedStyle(support).backgroundImage.includes('255, 247, 237'),
                disabledDistinct: !!disabledNext && disabledNext.opacity !== enabledNext?.opacity && disabledNext.cursor === 'not-allowed',
                reducedMotionDuration: null
            };
        });
        await page12.emulateMedia({ reducedMotion: 'reduce' });
        const reducedMotionResult = await page12.evaluate(() => {
            const controller = document.querySelector('#mode-speak .spc-controller');
            const target = controller?.querySelector('.spc-picker-next');
            return target ? getComputedStyle(target).transitionDuration : null;
        });
        speakingDesktopStyles.reducedMotionDuration = reducedMotionResult;

        assert('Speaking controller is present for style checks', speakingDesktopStyles.controllerPresent);
        assert('Speaking Previous uses slate gradient', speakingDesktopStyles.previousSlate);
        assert('Speaking Next uses purple gradient', speakingDesktopStyles.nextPurple);
        assert('Speaking picker pill uses RFIB radius', speakingDesktopStyles.pillRadius);
        assert('Speaking picker pill has RFIB border', speakingDesktopStyles.pillHasBorder);
        assert('Speaking picker pill meets 44px control height', speakingDesktopStyles.pillMinHeight);
        assert('Speaking primary action uses green gradient', speakingDesktopStyles.primaryGreen);
        assert('Speaking retry action uses amber gradient', speakingDesktopStyles.retryAmber);
        assert('Speaking record action uses red gradient', speakingDesktopStyles.recordRed);
        assert('Speaking support action uses peach treatment', speakingDesktopStyles.supportPeach);
        assert('Speaking disabled state is distinct', speakingDesktopStyles.disabledDistinct);
        assert('Speaking reduced-motion transition is disabled', speakingDesktopStyles.reducedMotionDuration === '0s');

        const context13 = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'no-preference' });
        await context13.addInitScript(() => {
            window.localStorage.setItem('userStatus', 'guest');
            window.localStorage.setItem('hasSeenScopeTutorial', 'true');
        });
        const page13 = await context13.newPage();
        await page13.goto(`http://localhost:${server.address().port}/?speakingController=v2`, { waitUntil: 'domcontentloaded' });
        await dismissBlockingOverlays(page13);
        const speakingMobileLayout = await page13.evaluate(async () => {
            await window.switchToMode('speak');
            await new Promise(resolve => setTimeout(resolve, 250));
            const panel = document.getElementById('mode-speak');
            const controller = panel?.querySelector('.spc-controller');
            const nav = controller?.querySelector('.spc-picker-nav');
            const row = controller?.querySelector('.spc-row--primary');
            const pill = controller?.querySelector('.spc-picker-pill');
            const navRect = nav?.getBoundingClientRect();
            const rowRect = row?.getBoundingClientRect();
            return {
                controllerPresent: !!controller,
                navigationFitsRow: !!navRect && !!rowRect && navRect.right <= rowRect.right + 1,
                noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth,
                pillHeight: pill ? getComputedStyle(pill).minHeight : null
            };
        });
        assert('Speaking mobile controller is present', speakingMobileLayout.controllerPresent);
        assert('Speaking mobile navigation fits its row', speakingMobileLayout.navigationFitsRow);
        assert('Speaking mobile layout has no horizontal overflow', speakingMobileLayout.noHorizontalOverflow);
        assert('Speaking mobile picker remains 44px high', speakingMobileLayout.pillHeight === '44px');
        await captureSpeakingScreenshots(browser, server);
        console.log(`Speaking screenshot matrix: PASS (${fs.readdirSync(SCREENSHOT_DIR).filter((name) => name.startsWith('speaking-')).length} files)`);
        await context13.close();
        await context12.close();

        // ===== Summary =====
        console.log('\n---');
        console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);

        if (failed > 0) {
            console.error('--- Speaking Controller Browser Check FAILED ---');
            process.exit(1);
        } else {
            console.log('--- Speaking Controller Browser Check PASSED ---');
        }

    } catch (err) {
        console.error('--- Speaking Controller Browser Check FAILED (exception) ---');
        console.error(err);
        process.exit(1);
    } finally {
        await browser.close();
        server.close();
    }
}

server = app.listen(port, () => runTest());
