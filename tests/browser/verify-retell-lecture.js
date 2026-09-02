const { chromium } = require('../../node_modules/playwright');
const assert = require('assert');

(async () => {
  console.log('=== STARTING RETELL LECTURE & DEEP-ROUTE VERIFICATION SUITE ===');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 900 }
  });

  const page = await context.newPage();

  const httpErrors = [];
  page.on('response', res => {
    // Only track unexpected HTTP >= 400 errors (exclude expected missing audio candidate probes & beacon endpoints)
    if (res.status() >= 400 && res.url().includes('localhost')) {
      const isExpectedAudioProbe = res.url().includes('/database/Take%20Notes/RL/audio/') || res.url().includes('/database/SGD/audio/');
      const isBeaconEndpoint = res.url().includes('/api/');
      if (!isExpectedAudioProbe && !isBeaconEndpoint) {
        console.log(`[UNEXPECTED HTTP ${res.status()}] ${res.url()}`);
        httpErrors.push({ url: res.url(), status: res.status() });
      }
    }
  });

  page.on('pageerror', err => {
    console.error('PAGE ERROR:', err.message);
  });

  try {
    await page.addInitScript(() => {
      sessionStorage.setItem('welcomeModalDismissed', 'true');
      localStorage.setItem('userStatus', 'guest');
      localStorage.setItem('hasSeenScopeTutorial', 'true');
      const tutorialKeys = [
        'typeTutorialCompleted', 'speakTutorialCompleted', 'extendedTutorialCompleted',
        'writingTutorialCompleted', 'watchTutorialCompleted', 'notesTutorialCompleted',
        'pronounceTutorialCompleted', 'readAloudTutorialCompleted', 'rfibTutorialCompleted',
        'survivalTutorialCompleted', 'shopUnlockTutorialCompleted'
      ];
      tutorialKeys.forEach(k => localStorage.setItem(k, 'true'));
      ['asq', 'describe-image', 'notes', 'read-aloud', 'rts', 'sgd', 'speak', 'type', 'watch'].forEach((mode) => {
        localStorage.setItem(`${mode}ModeFirstUse`, 'false');
        localStorage.setItem(`hasSeen${mode}Tutorial`, 'true');
      });
    });

    // ----------------------------------------------------
    // Test 1: Direct navigation to Question 1 (.mp3 + video)
    // ----------------------------------------------------
    console.log('\n--- Test 1: Direct navigation to Question 1 (/pte-practice/speaking/notes/1) ---');
    await page.goto('https://localhost:8443/pte-practice/speaking/notes/1', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(2500);

    const q1State = await page.evaluate(() => {
      const qSelect = document.getElementById('question-select-notes');
      const readyTitle = document.getElementById('notes-ready-title')?.textContent?.trim();
      const videoTag = document.getElementById('notes-ready-video-tag');
      const audioTag = document.getElementById('notes-ready-audio-tag');
      return {
        selectedVal: qSelect?.value,
        optionsCount: qSelect?.options?.length,
        firstOptionText: qSelect?.options?.[0]?.text,
        readyTitle,
        videoTagVisible: videoTag ? window.getComputedStyle(videoTag).display !== 'none' : false,
        audioTagVisible: audioTag ? window.getComputedStyle(audioTag).display !== 'none' : false
      };
    });
    console.log('Q1 State:', JSON.stringify(q1State, null, 2));
    assert.strictEqual(q1State.selectedVal, '1');
    assert.strictEqual(q1State.optionsCount, 540);
    assert.ok(q1State.firstOptionText.includes('Gas Giants'));
    assert.strictEqual(q1State.videoTagVisible, true, 'Guiding video badge should show for Q1');
    assert.strictEqual(q1State.audioTagVisible, true, 'Audio badge should show for Q1');

    // Start practice on Q1 and proceed to notes
    await page.evaluate(() => document.getElementById('play-notes-btn').click());
    await page.waitForTimeout(1000);
    await page.evaluate(() => document.getElementById('notes-skip-video-btn').click());
    await page.waitForTimeout(1500);

    const q1AudioSrc = await page.evaluate(() => document.getElementById('notes-audio')?.src);
    console.log('Q1 Audio Src:', q1AudioSrc);
    assert.ok(q1AudioSrc.includes('/database/Take%20Notes/RL/audio/1.mp3'), `Expected 1.mp3, got ${q1AudioSrc}`);

    // ----------------------------------------------------
    // Test 2: Question 6 (.wav) & Question 156 (.m4a) fallback
    // ----------------------------------------------------
    console.log('\n--- Test 2: Question 6 (.wav) and Question 156 (.m4a) fallback verification ---');
    await page.evaluate(() => {
      window.TakeNotesMode.selectEntry(5); // Q6 is index 5
    });
    await page.waitForTimeout(1000);
    await page.evaluate(() => document.getElementById('play-notes-btn').click());
    await page.waitForTimeout(1000);
    const isQ6VideoShown = await page.evaluate(() => {
      const v = document.getElementById('notes-step-video');
      return v && window.getComputedStyle(v).display !== 'none';
    });
    if (isQ6VideoShown) {
      await page.evaluate(() => document.getElementById('notes-skip-video-btn').click());
      await page.waitForTimeout(1500);
    } else {
      await page.waitForTimeout(1500);
    }

    const q6AudioState = await page.evaluate(() => {
      const audio = document.getElementById('notes-audio');
      const status = document.getElementById('notes-audio-status');
      return {
        src: audio?.src,
        statusHidden: status?.hidden,
        statusText: status?.textContent
      };
    });
    console.log('Q6 Audio State (.wav):', JSON.stringify(q6AudioState, null, 2));
    assert.ok(q6AudioState.src.includes('/database/Take%20Notes/RL/audio/6.wav'), `Expected 6.wav, got ${q6AudioState.src}`);
    assert.strictEqual(q6AudioState.statusHidden, true, 'Audio status should be hidden on successful .wav load');

    // Test Question 156 (.m4a)
    await page.evaluate(() => {
      const select = document.getElementById('question-select-notes');
      select.value = '156';
      select.dispatchEvent(new Event('change'));
    });
    await page.waitForTimeout(1000);
    await page.evaluate(() => document.getElementById('play-notes-btn').click());
    await page.waitForTimeout(1500);

    const q156AudioState = await page.evaluate(() => {
      const audio = document.getElementById('notes-audio');
      const status = document.getElementById('notes-audio-status');
      return {
        src: audio?.src,
        statusHidden: status?.hidden,
        statusText: status?.textContent
      };
    });
    console.log('Q156 Audio State (.m4a):', JSON.stringify(q156AudioState, null, 2));
    assert.ok(q156AudioState.src.includes('/database/Take%20Notes/RL/audio/156.m4a'), `Expected 156.m4a, got ${q156AudioState.src}`);
    assert.strictEqual(q156AudioState.statusHidden, true, 'Audio status should be hidden on successful .m4a load');

    // ----------------------------------------------------
    // Test 3: Question 311 (no audio available)
    // ----------------------------------------------------
    console.log('\n--- Test 3: Question 311 (no audio available verification) ---');
    await page.evaluate(() => {
      const select = document.getElementById('question-select-notes');
      select.value = '311';
      select.dispatchEvent(new Event('change'));
    });
    await page.waitForTimeout(1000);
    await page.evaluate(() => document.getElementById('play-notes-btn').click());
    await page.waitForTimeout(2000);

    const q311AudioState = await page.evaluate(() => {
      const audio = document.getElementById('notes-audio');
      const status = document.getElementById('notes-audio-status');
      return {
        src: audio?.getAttribute('src') || '',
        statusHidden: status?.hidden,
        statusText: status?.textContent,
        statusClass: status?.className
      };
    });
    console.log('Q311 Audio State (Missing Audio):', JSON.stringify(q311AudioState, null, 2));
    assert.strictEqual(q311AudioState.statusHidden, false, 'Audio status should be visible for missing audio');
    assert.ok(q311AudioState.statusText.includes('Audio is not available for question 311'), `Unexpected status text: ${q311AudioState.statusText}`);
    assert.ok(q311AudioState.statusClass.includes('is-unavailable'));

    // ----------------------------------------------------
    // Test 4: English Practice Scope Button Deduplication
    // ----------------------------------------------------
    console.log('\n--- Test 4: English Practice Scope Button Deduplication ---');
    await page.evaluate(async () => {
      const scopePill = document.querySelector('[data-scope="english"]');
      if (scopePill) {
        scopePill.click();
      } else if (typeof window.switchScope === 'function') {
        window.switchScope('english');
      }
      await new Promise(r => setTimeout(r, 600));
      await window.switchToMode('notes');
      await new Promise(r => setTimeout(r, 600));
    });
    await page.waitForTimeout(1500);

    await page.evaluate(() => {
      window.TakeNotesMode.selectEntry(0);
    });
    await page.waitForTimeout(1000);
    await page.evaluate(() => document.getElementById('notes-start-btn')?.click() || document.getElementById('play-notes-btn')?.click());
    await page.waitForTimeout(1000);
    await page.evaluate(() => document.getElementById('notes-skip-video-btn')?.click());
    await page.waitForTimeout(1000);

    const buttonCounts = await page.evaluate(() => {
      const allButtons = Array.from(document.querySelectorAll('#mode-notes .notes-submit-controls button'));
      const visibleButtons = allButtons.filter(btn => window.getComputedStyle(btn).display !== 'none');
      const allRetryButtons = Array.from(document.querySelectorAll('#mode-notes .notes-results-controls button'));
      const visibleRetryButtons = allRetryButtons.filter(btn => window.getComputedStyle(btn).display !== 'none');
      return {
        allButtons: allButtons.map(b => ({ id: b.id, display: window.getComputedStyle(b).display, parent: b.parentElement.className })),
        visibleSubmitButtonsCount: visibleButtons.length,
        visibleSubmitButtonId: visibleButtons[0]?.id,
        visibleRetryButtonsCount: visibleRetryButtons.length,
        visibleRetryButtonId: visibleRetryButtons[0]?.id
      };
    });
    console.log('English Scope Button Count:', JSON.stringify(buttonCounts, null, 2));
    assert.strictEqual(buttonCounts.visibleSubmitButtonsCount, 1, 'There should be EXACTLY 1 visible submit button in English scope');
    assert.strictEqual(buttonCounts.visibleRetryButtonsCount, 1, 'There should be EXACTLY 1 visible retry button in English scope');

    // ----------------------------------------------------
    // Test 5: Empty filter / Null currentEntry state
    // ----------------------------------------------------
    console.log('\n--- Test 5: Empty filter / Null currentEntry Overview State ---');
    const emptyState = await page.evaluate(() => {
      window.TakeNotesMode.applyFilters('empty');
      const readyTitle = document.getElementById('notes-ready-title')?.textContent?.trim();
      const readyDesc = document.getElementById('notes-ready-desc')?.textContent?.trim();
      const startBtn = document.getElementById('notes-start-btn');
      const audioTag = document.getElementById('notes-ready-audio-tag');
      const videoTag = document.getElementById('notes-ready-video-tag');
      return {
        readyTitle,
        readyDesc,
        startBtnDisabled: startBtn?.disabled,
        audioTagDisplay: audioTag ? window.getComputedStyle(audioTag).display : null,
        videoTagDisplay: videoTag ? window.getComputedStyle(videoTag).display : null
      };
    });
    console.log('Empty Filter State:', JSON.stringify(emptyState, null, 2));
    assert.strictEqual(emptyState.readyTitle, 'No Lectures Found');
    assert.strictEqual(emptyState.startBtnDisabled, true);
    assert.strictEqual(emptyState.audioTagDisplay, 'none');
    assert.strictEqual(emptyState.videoTagDisplay, 'none');

    // Reset filter
    await page.evaluate(() => {
      window.TakeNotesMode.applyFilters('all');
    });
    await page.waitForTimeout(500);

    // ----------------------------------------------------
    // Test 6: Deep route in SGD mode (/pte-practice/speaking/sgd/1)
    // ----------------------------------------------------
    console.log('\n--- Test 6: Deep SPA navigation in SGD Mode ---');
    await page.goto('https://localhost:8443/pte-practice/speaking/sgd/1', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(2500);

    const sgdState = await page.evaluate(() => {
      const modeSgd = document.getElementById('mode-sgd');
      const qSelect = document.getElementById('question-select-sgd');
      const title = document.getElementById('sgd-question-title')?.textContent?.trim();
      return {
        panelVisible: modeSgd ? window.getComputedStyle(modeSgd).display !== 'none' : false,
        selectedVal: qSelect?.value,
        optionsCount: qSelect?.options?.length,
        title
      };
    });
    console.log('SGD Deep Route State:', JSON.stringify(sgdState, null, 2));
    assert.strictEqual(sgdState.panelVisible, true);
    assert.ok(sgdState.optionsCount > 50, `SGD should have loaded questions, got ${sgdState.optionsCount}`);

    // Check Local HTTP errors
    console.log('\n--- Local HTTP 4xx/5xx Errors Summary ---');
    console.log(`Total local 4xx/5xx failures: ${httpErrors.length}`);
    httpErrors.forEach(f => console.log('HTTP ERROR:', f));
    assert.strictEqual(httpErrors.length, 0, 'There should be 0 unexpected local HTTP 4xx/5xx errors');

    console.log('\n🎉 ALL RETELL LECTURE & DEEP-ROUTE VERIFICATIONS PASSED SUCCESSFULLY!');
  } finally {
    await browser.close();
  }
})();
