/* eslint-disable no-console */
/**
 * Chrome verification for the second round of practice UI repairs:
 *
 *   1. RFIB — Easy Reading (button and support panel) leaves the screen on Check
 *   2. Drag & Drop — explanations behind a per-blank ? popover (see also
 *      tests/browser/dd-mode-browser-check.js for the full flow)
 *   3. Drag & Drop — the Random toggle actually toggles, and the arrows stay
 *      usable at the ends of the list while it is on
 *   4. Speaking — a single 🎲 Random: ON/OFF toggle replaces Random / In order
 *      (covered by tests/browser/read-aloud-practice-ui-repairs-check.js)
 *   5. Read Aloud — the stepper reaches Results even when scoring fails
 *   6. Guide layers — reduced words and sound changes compose instead of one
 *      overwriting the other; sound-change explanations use a floating tooltip
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const app = express();
app.use(express.static(path.join(__dirname, '../../public')));

const screenshotDir = path.resolve(__dirname, '../../test-results/practice-ui-repairs-round2');
fs.mkdirSync(screenshotDir, { recursive: true });

const failures = [];

function check(label, value) {
  if (!value) {
    failures.push(label);
    console.error(`FAIL: ${label}`);
    return;
  }
  console.log(`PASS: ${label}`);
}

async function bootstrap(page, baseUrl) {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const preloader = document.getElementById('app-preloader');
    if (!preloader) return true;
    return getComputedStyle(preloader).display === 'none' || Boolean(document.getElementById('preloader-dismiss-btn'));
  }, { timeout: 30000 });
  const dismiss = page.locator('#preloader-dismiss-btn');
  if (await dismiss.count()) await dismiss.click({ timeout: 5000 }).catch(() => {});
  const guest = page.locator('#guest-mode-btn');
  if (await guest.count()) await guest.click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(250);
}

async function openMode(page, modeId, readySelector) {
  await page.evaluate(async (id) => { await window.switchToMode(id); }, modeId);
  await page.waitForSelector(readySelector, { timeout: 30000 });
  await page.waitForTimeout(500);
}

/* ── 1. RFIB Easy Reading ─────────────────────────────────────────────── */
async function checkRfibEasyReading(page) {
  await openMode(page, 'rfib', '#mode-rfib .rfib-blank-select, #mode-rfib #rfib-cloze-view');
  await page.waitForFunction(() => (
    document.querySelectorAll('#mode-rfib .rfib-blank-select').length > 0
  ), { timeout: 30000 });

  const beforeCheck = await page.evaluate(() => ({
    easyReadingVisible: getComputedStyle(document.getElementById('rfib-easy-reading-btn')).display !== 'none',
    checkVisible: getComputedStyle(document.getElementById('rfib-check-btn')).display !== 'none'
  }));
  check('RFIB offers Easy Reading before grading',
    beforeCheck.easyReadingVisible && beforeCheck.checkVisible);

  // Open the support panel first: it must close with the button on Check.
  await page.click('#rfib-easy-reading-btn');
  await page.waitForTimeout(400);
  const supportOpen = await page.evaluate(() => (
    getComputedStyle(document.getElementById('rfib-support-panel')).display !== 'none'
  ));
  check('Easy Reading opens the simplified support panel', supportOpen);

  await page.click('#rfib-check-btn');
  await page.waitForTimeout(700);

  const afterCheck = await page.evaluate(() => ({
    easyReadingVisible: getComputedStyle(document.getElementById('rfib-easy-reading-btn')).display !== 'none',
    supportVisible: getComputedStyle(document.getElementById('rfib-support-panel')).display !== 'none',
    retryVisible: getComputedStyle(document.getElementById('rfib-retry-btn')).display !== 'none'
  }));
  check('Easy Reading button is gone after Check', !afterCheck.easyReadingVisible);
  check('Easy Reading support panel is gone after Check', !afterCheck.supportVisible);
  check('Retry appears after Check', afterCheck.retryVisible);
  await page.screenshot({ path: path.join(screenshotDir, 'rfib-after-check.png') });

  // A missed blank can raise the vocabulary capture modal over the action bar.
  await page.evaluate(() => {
    document.querySelectorAll('.vocab-add-modal').forEach((modal) => {
      modal.classList.remove('active');
      modal.style.display = 'none';
    });
  });
  await page.waitForTimeout(200);

  await page.click('#rfib-retry-btn');
  await page.waitForTimeout(600);
  check('Easy Reading returns for the next attempt', await page.evaluate(() => (
    getComputedStyle(document.getElementById('rfib-easy-reading-btn')).display !== 'none'
  )));
}

/* ── 2 + 3. Drag & Drop ───────────────────────────────────────────────── */
async function checkDragAndDrop(page) {
  await openMode(page, 'dd', '#mode-dd .dd-blank-slot');

  // Random toggle: one click must flip it, and it must survive a re-activation.
  const readToggle = () => page.evaluate(() => {
    const button = document.getElementById('dd-random-toggle-btn');
    return {
      label: button.textContent.trim(),
      pressed: button.getAttribute('aria-pressed'),
      stored: window.localStorage.getItem('pte_random_nav_mode')
    };
  });

  const initial = await readToggle();
  await page.click('#dd-random-toggle-btn');
  await page.waitForTimeout(200);
  const afterFirst = await readToggle();
  check(`Drag & Drop Random toggle flips on click (${initial.label} → ${afterFirst.label})`,
    afterFirst.label !== initial.label && afterFirst.pressed !== initial.pressed);

  await page.click('#dd-random-toggle-btn');
  await page.waitForTimeout(200);
  const afterSecond = await readToggle();
  check('Drag & Drop Random toggle flips back on a second click',
    afterSecond.label === initial.label);

  // Re-entering the mode must not stack a second click handler.
  await openMode(page, 'rfib', '#mode-rfib .rfib-actions');
  await openMode(page, 'dd', '#mode-dd .dd-blank-slot');
  await page.click('#dd-random-toggle-btn');
  await page.waitForTimeout(200);
  const afterReentry = await readToggle();
  check('Random toggle still flips after leaving and re-entering the mode',
    afterReentry.label !== initial.label && afterReentry.stored === String(afterReentry.pressed === 'true'));

  const navWhileRandom = await page.evaluate(() => ({
    next: document.getElementById('dd-v7-next-btn').disabled,
    prev: document.getElementById('dd-v7-prev-btn').disabled
  }));
  check('Next stays enabled while Random is on', navWhileRandom.next === false);
  check('Previous is disabled until the random history has an entry', navWhileRandom.prev === true);

  await page.click('#dd-v7-next-btn');
  await page.waitForTimeout(700);
  check('Previous becomes available after a random jump', await page.evaluate(() => (
    document.getElementById('dd-v7-prev-btn').disabled === false
  )));

  // Back to sequential for the explanation checks.
  await page.click('#dd-random-toggle-btn');
  await page.waitForTimeout(200);

  // Explanations: solve the current question, then read a ? popover.
  const solved = await page.evaluate(() => {
    const slots = [...document.querySelectorAll('#dd-passage .dd-blank-slot')];
    const chips = [...document.querySelectorAll('#dd-word-bank .dd-option-chip')];
    if (!slots.length || !chips.length) return 0;
    slots.forEach((slot, index) => {
      const chip = chips[index];
      if (!chip || chip.classList.contains('is-used')) return;
      chip.click();
      slot.click();
    });
    return document.querySelectorAll('#dd-passage .dd-blank-slot.is-filled').length;
  });
  check('Blanks can be filled by click-to-place', solved > 0);

  await page.click('#dd-submit-btn');
  await page.waitForTimeout(600);

  const graded = await page.evaluate(() => ({
    hintButtons: document.querySelectorAll('#dd-passage .dd-hint-btn').length,
    blanks: document.querySelectorAll('#dd-passage .dd-blank-slot').length,
    summary: document.getElementById('dd-result-summary').textContent.trim(),
    legacyHeader: !!document.getElementById('dd-explanation-header'),
    legacyCards: document.querySelectorAll('.dd-result-card').length,
    openPopovers: document.querySelectorAll('.dd-popover.is-visible').length
  }));
  check('Every blank gets a ? button after submitting',
    graded.hintButtons > 0 && graded.hintButtons === graded.blanks);
  check('The score line points at the ? buttons',
    /blanks correct/.test(graded.summary));
  check('The always-open explanation cards are gone',
    !graded.legacyHeader && graded.legacyCards === 0);
  check('Explanations stay closed until a ? is clicked', graded.openPopovers === 0);

  await page.click('#dd-passage .dd-hint-btn');
  await page.waitForSelector('.dd-popover.is-visible', { timeout: 5000 });
  const popover = await page.evaluate(() => {
    const el = document.querySelector('.dd-popover.is-visible');
    const rect = el.getBoundingClientRect();
    return {
      text: el.textContent,
      onScreen: rect.top >= 0 && rect.left >= 0
        && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight
    };
  });
  check('Clicking ? opens the explanation for that blank', /Blank 1/.test(popover.text));
  check('The popover stays inside the viewport', popover.onScreen);
  await page.screenshot({ path: path.join(screenshotDir, 'dd-hint-popover.png') });

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check('Escape closes the explanation', await page.evaluate(() => (
    document.querySelectorAll('.dd-popover.is-visible').length === 0
  )));
}

/* ── 5. Read Aloud stepper on a failed assessment ─────────────────────── */
async function checkReadAloudStepper(page) {
  await openMode(page, 'read-aloud', '#mode-read-aloud .spc-steps');
  await page.waitForFunction(() => window.ReadAloudMode?.hasLoadedDatabase === true, { timeout: 30000 });

  const readSteps = () => page.evaluate(() => (
    [...document.querySelectorAll('#mode-read-aloud .spc-steps [data-spc-step]')].map((item) => ({
      label: item.querySelector('.spc-step__label')?.textContent || '',
      state: item.dataset.state
    }))
  ));

  await page.evaluate(() => {
    window.ReadAloudMode.state = 'RECORDED';
    window.ReadAloudMode.updateUIForState();
  });
  await page.waitForTimeout(200);
  const atRecorded = await readSteps();
  check('Stepper sits on Record with a captured recording',
    atRecorded[1]?.state === 'current');

  // Simulate the scorer rejecting the attempt: the results panel is rendered
  // with an error message and no score.
  await page.evaluate(() => {
    window.ReadAloudMode.currentRecordingSession = null;
    window.ReadAloudMode.showAssessmentDisplay();
    window.ReadAloudMode.setAssessmentStatusMessage('That recording was too short. Please try again.');
  });
  await page.waitForTimeout(300);

  const afterFailure = await page.evaluate(() => ({
    steps: [...document.querySelectorAll('#mode-read-aloud .spc-steps [data-spc-step]')].map((item) => item.dataset.state),
    state: window.ReadAloudMode.state,
    status: document.getElementById('ra-status-message')?.textContent,
    resultVisible: getComputedStyle(document.getElementById('ra-result-box')).display !== 'none'
  }));
  check('A failed assessment still moves the stepper to Results',
    afterFailure.steps.join(',') === 'complete,complete,current');
  check('A failed assessment moves the state machine to RESULTS',
    afterFailure.state === 'RESULTS');
  check('The failure message survives the state transition',
    afterFailure.status === 'That recording was too short. Please try again.');
  check('The result panel is shown for a failed assessment', afterFailure.resultVisible);
  await page.screenshot({ path: path.join(screenshotDir, 'read-aloud-failed-assessment.png') });

  await page.evaluate(() => {
    window.ReadAloudMode.state = 'PREP';
    window.ReadAloudMode.resetAssessmentDisplay();
    window.ReadAloudMode.updateUIForState();
  });
  await page.waitForTimeout(200);
  const afterReset = await readSteps();
  check('Retrying returns the stepper to Prep', afterReset[0]?.state === 'current');
}

/* ── 6. Composable guide layers ───────────────────────────────────────── */
async function checkGuideComposition(page) {
  await page.evaluate(() => window.SpeakingPracticeController.setPreferredView('advanced'));
  await page.waitForTimeout(400);

  // A word can belong to both layers. Verify the two treatments compose rather
  // than one overwriting the other, using a synthetic span so the check does not
  // depend on which prompt happens to be loaded.
  const composed = await page.evaluate(() => {
    const host = document.getElementById('ra-prompt-stage') || document.body;
    const make = (className) => {
      const span = document.createElement('span');
      span.className = `ra-prompt-word ${className}`;
      span.textContent = 'can';
      host.appendChild(span);
      const style = getComputedStyle(span);
      const read = {
        background: style.backgroundColor,
        borderBottom: `${style.borderBottomWidth} ${style.borderBottomStyle} ${style.borderBottomColor}`
      };
      span.remove();
      return read;
    };
    return {
      weak: make('ra-connected-speech-token ra-connected-speech-token--weak'),
      sound: make('ra-sound-change-word'),
      both: make('ra-connected-speech-token ra-connected-speech-token--weak ra-sound-change-word')
    };
  });

  check('Reduced words carry a solid amber underline',
    /solid/.test(composed.weak.borderBottom) && composed.weak.background !== 'rgba(0, 0, 0, 0)');
  check('Sound changes carry a dashed underline',
    /dashed/.test(composed.sound.borderBottom));
  check('A word in both layers keeps the reduced-word fill',
    composed.both.background === composed.weak.background);
  check('A word in both layers keeps the sound-change dashed rule',
    /dashed/.test(composed.both.borderBottom));

  // And with both guides live, neither renderer may write inline styles that
  // clobber the other.
  await page.evaluate(() => window.ReadAloudMode.applyConnectedSpeechModes(['reduced_words', 'sound_changes']));
  await page.waitForTimeout(1500);

  const live = await page.evaluate(() => {
    const stage = document.getElementById('ra-prompt-stage');
    const words = [...stage.querySelectorAll('.ra-connected-speech-token--weak, .ra-sound-change-word')];
    return {
      modes: [...(window.ReadAloudMode.connectedSpeechModes || [])].sort().join(','),
      styledWords: words.length,
      inlineStyled: words.filter((word) => /border-bottom|background/.test(word.getAttribute('style') || '')).length,
      legacyHintCount: stage.querySelectorAll('.ra-sound-change-hint').length
    };
  });

  check('Both guides stay active together', live.modes === 'reduced_words,sound_changes');
  check('Guide layers no longer write competing inline styles', live.inlineStyled === 0);
  check('At least one guide layer rendered', live.styledWords > 0);
  check('Legacy in-text sound-change hints stay removed', live.legacyHintCount === 0);
  await page.screenshot({ path: path.join(screenshotDir, 'read-aloud-guides-combined.png') });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    document.querySelector('[data-tooltip-browser-probe]')?.remove();
    const stage = document.getElementById('ra-prompt-stage');
    const wrapper = document.createElement('span');
    wrapper.dataset.tooltipBrowserProbe = 'true';
    wrapper.style.position = 'relative';
    wrapper.style.zIndex = '1';
    wrapper.style.display = 'block';
    wrapper.style.marginTop = '12px';
    wrapper.innerHTML = ' Did <span id="ra-tooltip-probe-left" class="ra-sound-change-word" data-guide-target="boundary-tooltip-browser-probe" data-sound-change-subtype="coalescent_dj" role="button" tabindex="0">did</span> <span class="ra-sound-change-word" data-guide-target="boundary-tooltip-browser-probe" data-sound-change-subtype="coalescent_dj" role="button" tabindex="0">you</span>?';
    stage.appendChild(wrapper);
  });

  const tooltipWord = page.locator('#ra-tooltip-probe-left');
  await tooltipWord.hover();
  await page.waitForFunction(() => (
    document.getElementById('ra-sound-change-tooltip')?.getAttribute('aria-hidden') === 'false'
  ));
  await page.waitForTimeout(200);
  const hoverState = await page.evaluate(() => {
    const tooltip = document.getElementById('ra-sound-change-tooltip');
    const stage = document.getElementById('ra-prompt-stage');
    const tooltipRect = tooltip.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    return {
      label: tooltip.querySelector('.ra-sound-change-tooltip__label')?.textContent || '',
      explanation: tooltip.querySelector('.ra-sound-change-tooltip__explanation')?.textContent || '',
      describedWords: stage.querySelectorAll('[data-guide-target="boundary-tooltip-browser-probe"][aria-describedby~="ra-sound-change-tooltip"]').length,
      insideStage: tooltipRect.left >= stageRect.left - 1
        && tooltipRect.right <= stageRect.right + 1
        && tooltipRect.top >= stageRect.top - 1
        && tooltipRect.bottom <= stageRect.bottom + 1
    };
  });
  check('Hovering a sound-change word opens the floating explanation',
    hoverState.label.includes('→') && /sound|blend/i.test(hoverState.explanation));
  check('The tooltip describes both words in the sound-change boundary', hoverState.describedWords === 2);
  check('The sound-change tooltip stays inside a narrow prompt stage', hoverState.insideStage);
  await page.screenshot({ path: path.join(screenshotDir, 'read-aloud-sound-change-tooltip.png') });

  await tooltipWord.click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  const afterEscape = await page.evaluate(() => ({
    hidden: document.getElementById('ra-sound-change-tooltip')?.getAttribute('aria-hidden'),
    pinned: Boolean(window.ReadAloudMode.soundChangeTooltipPinned),
    describedWords: document.querySelectorAll('[data-guide-target="boundary-tooltip-browser-probe"][aria-describedby~="ra-sound-change-tooltip"]').length
  }));
  check('Escape dismisses a pinned sound-change tooltip',
    afterEscape.hidden === 'true' && !afterEscape.pinned && afterEscape.describedWords === 0);

  await page.evaluate(() => window.ReadAloudMode.hideSoundChangeTooltip());
  await page.locator('#ra-toggle-sound-changes-btn').focus();
  await tooltipWord.focus();
  await page.waitForFunction(() => (
    document.getElementById('ra-sound-change-tooltip')?.getAttribute('aria-hidden') === 'false'
  ));
  check('Keyboard focus opens the sound-change tooltip', await page.evaluate(() => (
    document.getElementById('ra-sound-change-tooltip')?.getAttribute('aria-hidden') === 'false'
  )));
  await page.locator('#ra-toggle-sound-changes-btn').focus();
  await page.waitForTimeout(150);
  check('Moving keyboard focus away closes an unpinned tooltip', await page.evaluate(() => (
    document.getElementById('ra-sound-change-tooltip')?.getAttribute('aria-hidden') === 'true'
  )));

  await tooltipWord.click();
  await page.mouse.click(2, 2);
  await page.waitForTimeout(150);
  check('Clicking outside closes a pinned sound-change tooltip', await page.evaluate(() => (
    document.getElementById('ra-sound-change-tooltip')?.getAttribute('aria-hidden') === 'true'
  )));

  await page.evaluate(() => document.querySelector('[data-tooltip-browser-probe]')?.remove());
  await page.setViewportSize({ width: 1440, height: 1100 });
}

async function main() {
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}/index.html`;
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    await context.addInitScript(() => {
      window.localStorage.setItem('userStatus', 'guest');
      window.localStorage.setItem('hasSeenScopeTutorial', 'true');
      window.localStorage.setItem('read-aloudModeFirstUse', 'true');
      window.localStorage.setItem('pte_random_nav_mode', 'false');
    });
    const page = await context.newPage();
    await bootstrap(page, baseUrl);

    await checkRfibEasyReading(page);
    await checkDragAndDrop(page);
    await checkReadAloudStepper(page);
    await checkGuideComposition(page);
  } finally {
    await browser.close();
    server.close();
  }

  console.log('\n' + '─'.repeat(60));
  if (failures.length) {
    console.error(`${failures.length} check(s) failed:`);
    failures.forEach((label) => console.error(`  • ${label}`));
    process.exit(1);
  }
  console.log('All practice UI round-2 repair checks passed.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
