/* eslint-disable no-console */
/**
 * Speaking Controller Browser Check — Wave 0
 * Exercises the controller contract with a synthetic adapter injected at runtime.
 * Verifies: registration, activation, picker, Basic/Advanced toggle, DOM adoption,
 * restoration, sheets, focus management, persistence, responsive layout.
 */
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
    const browser = await chromium.launch({ headless: true });
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

        // ===== Test 2: Feature flag — v2 override enables all targets =====
        console.log('\n[Test 2] Feature flag resolution');
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
        assert('pte:speak enabled with v2 override', flagResults.pteSpeak);
        assert('pte:read-aloud enabled with v2 override', flagResults.pteReadAloud);
        assert('pte:asq enabled with v2 override', flagResults.pteAsq);
        assert('english:speak enabled with v2 override', flagResults.englishSpeak);
        assert('english:read-aloud enabled with v2 override', flagResults.englishReadAloud);
        assert('pte:pronounce excluded despite override', !flagResults.ptePronounce);
        assert('english:notes excluded despite override', !flagResults.englishNotes);
        assert('english:asq excluded despite override', !flagResults.englishAsq);

        // Test legacy override
        await page2.goto(`http://localhost:${server.address().port}/?speakingController=legacy`, { waitUntil: 'domcontentloaded' });
        await dismissBlockingOverlays(page2);

        const legacyResult = await page2.evaluate(() => {
            return window.SpeakingPracticeController.isV2Active('speak', 'pte');
        });
        assert('pte:speak disabled with legacy override', !legacyResult);
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

            const playBtn = document.createElement('button');
            playBtn.id = 'synth-play-btn';
            playBtn.textContent = 'Play';
            testPanel.appendChild(playBtn);

            const recordBtn = document.createElement('button');
            recordBtn.id = 'synth-record-btn';
            recordBtn.textContent = 'Record';
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
                    nextButtonId: 'synth-next-btn'
                },
                controls: [
                    { sourceId: 'synth-play-btn', slot: 'media', level: 'basic', order: 1 },
                    { sourceId: 'synth-record-btn', slot: 'attempt', level: 'basic', order: 1 },
                    { sourceId: 'synth-stop-btn', slot: 'attempt', level: 'basic', order: 2 },
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
            const playInSlot = controller?.querySelector('.spc-slot-media #synth-play-btn');
            const recordInSlot = controller?.querySelector('.spc-slot-attempt #synth-record-btn');
            const stopInSlot = controller?.querySelector('.spc-slot-attempt #synth-stop-btn');
            const filterInSlot = controller?.querySelector('.spc-slot-advanced-setting #synth-filter-wrapper');
            results.playAdopted = !!playInSlot;
            results.recordAdopted = !!recordInSlot;
            results.stopAdopted = !!stopInSlot;
            results.filterAdopted = !!filterInSlot;

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

            // Check source elements visible again
            results.sourceSelectRestored = sourceSelect.style.display !== 'none';
            results.prevBtnRestored = prevBtn.style.display !== 'none';
            results.nextBtnRestored = nextBtn.style.display !== 'none';

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
        assert('Source select visible after unmount', syntheticResults.sourceSelectRestored);
        assert('Previous button visible after unmount', syntheticResults.prevBtnRestored);
        assert('Next button visible after unmount', syntheticResults.nextBtnRestored);
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

        // ===== Test 6: No console/page errors =====
        console.log('\n[Test 6] Error checks');
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

        // ===== Test 7: View preference persistence across page reload =====
        console.log('\n[Test 7] View preference persistence');
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

        // ===== Test 8: Wave 0 remediation contract =====
        console.log('\n[Test 8] Wave 0 remediation contract');
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
