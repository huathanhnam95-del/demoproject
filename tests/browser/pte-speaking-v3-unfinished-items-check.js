'use strict';

const assert = require('node:assert/strict');
const { createHarness } = require('./helpers/pte-shell-harness');

async function run() {
  console.log('--- Starting PTE Speaking v3 Unfinished Items Verification Check ---');
  const harness = await createHarness();

  try {
    // 1. Verify Read Aloud in v3 shell
    console.log('\n[1/4] Testing Read Aloud under ?pteShell=v3...');
    const pageV3 = await harness.open({ width: 1440, height: 900, flag: 'v3' });

    await pageV3.evaluate(async () => {
      window.__PTE_TEST_TIME_SCALE = 0.05;
      await window.switchToMode('read-aloud');
    });

    // Wait for Read Aloud v3 shell to mount
    await pageV3.waitForFunction(() => {
      const panel = document.getElementById('mode-read-aloud');
      return panel && getComputedStyle(panel).display !== 'none' && document.querySelector('.pte-modebar');
    }, null, { timeout: 30000 });

    // Wait for prompt and guide analysis to load
    await pageV3.waitForFunction(() => {
      const mode = window.ReadAloudMode;
      return mode && mode.currentPromptReady && Array.isArray(mode.currentGuideExplanationItems);
    }, null, { timeout: 30000 });

    // Assertion 1: Heading host ("Question 818 READ ALOUD · Random • 1449 questions") is NOT visible
    const headingVisible = await pageV3.locator('#ra-workspace-heading').isVisible().catch(() => false);
    assert.equal(headingVisible, false, 'Read Aloud #ra-workspace-heading must NOT be visible under v3');
    console.log('  ✓ #ra-workspace-heading is hidden under v3');

    // Assertion 2: Steps host is NOT visible
    const stepsVisible = await pageV3.locator('#ra-workspace-steps-host').isVisible().catch(() => false);
    assert.equal(stepsVisible, false, 'Read Aloud #ra-workspace-steps-host must NOT be visible under v3');
    console.log('  ✓ #ra-workspace-steps-host is hidden under v3');

    // Assertion 3: Coach host (Speaking tips box) is NOT visible
    const coachHostVisible = await pageV3.locator('#ra-workspace-coach-host').isVisible().catch(() => false);
    assert.equal(coachHostVisible, false, 'Read Aloud #ra-workspace-coach-host (Speaking tips box) must NOT be visible under v3');
    console.log('  ✓ #ra-workspace-coach-host (Speaking tips box) is hidden under v3');

    // Assertion 4: Legacy stage instruction ("Read silently and plan your phrasing...") is visually hidden (.pte-sr-only)
    const instructionEl = pageV3.locator('#ra-workspace-instruction');
    const instructionCount = await instructionEl.count();
    assert.ok(instructionCount >= 1, '#ra-workspace-instruction must exist in DOM for screen readers');
    const hasSrOnly = await instructionEl.first().evaluate(el => el.classList.contains('pte-sr-only'));
    assert.equal(hasSrOnly, true, '#ra-workspace-instruction must have .pte-sr-only class');
    const instructionBox = await instructionEl.first().boundingBox();
    const isVisuallyTiny = !instructionBox || instructionBox.width <= 1 || instructionBox.height <= 1;
    assert.equal(isVisuallyTiny, true, '#ra-workspace-instruction must be visually 1x1 or hidden');
    console.log('  ✓ #ra-workspace-instruction is visually hidden (.pte-sr-only)');

    // Assertion 5: Legacy status message is visually hidden (.pte-sr-only)
    const statusMsg = pageV3.locator('#ra-status-message');
    if (await statusMsg.count() > 0) {
      const statusSrOnly = await statusMsg.evaluate(el => el.classList.contains('pte-sr-only') || getComputedStyle(el).clip === 'rect(0px, 0px, 0px, 0px)');
      assert.equal(statusSrOnly, true, '#ra-status-message must be visually hidden');
    }
    console.log('  ✓ #ra-status-message is visually hidden');

    // Assertion 6: New PTE instruction is visible
    const pteInstr = pageV3.locator('#ra-pte-instruction');
    assert.equal(await pteInstr.isVisible(), true, '#ra-pte-instruction must be visible');
    const instrText = await pteInstr.textContent();
    assert.ok(instrText.includes('Look at the text below.'), `Instruction text must be PTE prompt: ${instrText}`);
    console.log('  ✓ New test instruction (#ra-pte-instruction) is visible');

    // Assertion 7: Coach button count badge is wired up to the number of pronunciation hints
    await pageV3.waitForFunction(() => {
      const btn = document.getElementById('ra-pte-coach-btn');
      const mode = window.ReadAloudMode;
      const expectedCount = mode?.currentGuideExplanationItems?.length ?? 0;
      return btn && expectedCount > 0 && btn.textContent.trim() === `Coach · ${expectedCount}`;
    }, null, { timeout: 15000 });

    const coachBtn = pageV3.locator('#ra-pte-coach-btn');
    const coachBtnText = await coachBtn.textContent();
    const hintsCount = await pageV3.evaluate(() => window.ReadAloudMode?.currentGuideExplanationItems?.length);
    console.log(`  ✓ Coach button reads "${coachBtnText}" matching ${hintsCount} pronunciation hints`);
    assert.equal(coachBtnText.trim(), `Coach · ${hintsCount}`, `Coach button badge must equal Coach · ${hintsCount}`);

    // Assertion 8: Coach button click toggles aria-pressed
    await coachBtn.click();
    assert.equal(await coachBtn.getAttribute('aria-pressed'), 'true', 'Coach button aria-pressed should be true when opened');
    await coachBtn.click();
    assert.equal(await coachBtn.getAttribute('aria-pressed'), 'false', 'Coach button aria-pressed should be false when closed');
    console.log('  ✓ Coach button aria-pressed toggles correctly on click');

    // 2. Audit other 6 speaking modes under v3 for duplicate legacy elements
    console.log('\n[2/4] Auditing other 6 speaking modes under ?pteShell=v3...');

    // Mode: ASQ
    await pageV3.evaluate(async () => { await window.switchToMode('asq'); });
    await pageV3.waitForFunction(() => document.getElementById('mode-asq')?.style.display !== 'none');
    const asqSelectorVisible = await pageV3.locator('#mode-asq .question-selector').isVisible().catch(() => false);
    assert.equal(asqSelectorVisible, false, 'ASQ .question-selector must be hidden under v3');
    console.log('  ✓ ASQ .question-selector is hidden under v3');

    // Mode: RTS
    await pageV3.evaluate(async () => { await window.switchToMode('rts'); });
    await pageV3.waitForFunction(() => document.getElementById('mode-rts')?.style.display !== 'none');
    const rtsSelectorVisible = await pageV3.locator('#mode-rts > .question-selector').isVisible().catch(() => false);
    const rtsControlsVisible = await pageV3.locator('#rts-start-controls').isVisible().catch(() => false);
    assert.equal(rtsSelectorVisible, false, 'RTS .question-selector must be hidden under v3');
    assert.equal(rtsControlsVisible, false, 'RTS #rts-start-controls must be hidden under v3');
    console.log('  ✓ RTS .question-selector and #rts-start-controls are hidden under v3');

    // Mode: SGD
    await pageV3.evaluate(async () => { await window.switchToMode('sgd'); });
    await pageV3.waitForFunction(() => document.getElementById('mode-sgd')?.style.display !== 'none');
    const sgdSelectorVisible = await pageV3.locator('#mode-sgd > .question-selector').isVisible().catch(() => false);
    const sgdControlsVisible = await pageV3.locator('#sgd-start-controls').isVisible().catch(() => false);
    assert.equal(sgdSelectorVisible, false, 'SGD .question-selector must be hidden under v3');
    assert.equal(sgdControlsVisible, false, 'SGD #sgd-start-controls must be hidden under v3');
    console.log('  ✓ SGD .question-selector and #sgd-start-controls are hidden under v3');

    // Mode: Retell Lecture (notes)
    await pageV3.evaluate(async () => { await window.switchToMode('notes'); });
    await pageV3.waitForFunction(() => document.getElementById('mode-notes')?.style.display !== 'none');
    const notesSelectorVisible = await pageV3.locator('#mode-notes > .question-selector').isVisible().catch(() => false);
    const notesControlsVisible = await pageV3.locator('#notes-legacy-start-controls').isVisible().catch(() => false);
    const notesReadyVisible = await pageV3.locator('#notes-step-ready').isVisible().catch(() => false);
    assert.equal(notesSelectorVisible, false, 'Notes .question-selector must be hidden under v3');
    assert.equal(notesControlsVisible, false, 'Notes #notes-legacy-start-controls must be hidden under v3');
    assert.equal(notesReadyVisible, false, 'Notes #notes-step-ready overview card must be hidden under v3');
    console.log('  ✓ Notes .question-selector, start-controls, and overview card are hidden under v3');

    // Mode: Describe Image
    await pageV3.evaluate(async () => { await window.switchToMode('describe-image'); });
    await pageV3.waitForFunction(() => document.getElementById('mode-describe-image')?.style.display !== 'none');
    const diSelectorVisible = await pageV3.locator('#mode-describe-image .question-selector').isVisible().catch(() => false);
    const diControlsVisible = await pageV3.locator('#di-start-controls').isVisible().catch(() => false);
    assert.equal(diSelectorVisible, false, 'Describe Image .question-selector must be hidden under v3');
    assert.equal(diControlsVisible, false, 'Describe Image #di-start-controls must be hidden under v3');
    console.log('  ✓ Describe Image .question-selector and #di-start-controls are hidden under v3');

    // Mode: Repeat Sentence (speak)
    await pageV3.evaluate(async () => { await window.switchToMode('speak'); });
    await pageV3.waitForFunction(() => document.getElementById('mode-speak')?.style.display !== 'none');
    const speakSourceVisible = await pageV3.locator('#mode-speak .spc-source-controls').isVisible().catch(() => false);
    assert.equal(speakSourceVisible, false, 'Repeat Sentence .spc-source-controls must be hidden under v3');
    console.log('  ✓ Repeat Sentence .spc-source-controls is hidden under v3');

    await pageV3.close();

    // 3. Verify in-session dynamic unmount & restoration
    console.log('\n[3/4] Testing in-session dynamic unmount and restoration...');
    const pageDynamic = await harness.open({ width: 1440, height: 900, flag: 'v3' });
    await pageDynamic.evaluate(async () => {
      window.__PTE_TEST_TIME_SCALE = 0.05;
      await window.switchToMode('read-aloud');
    });
    await pageDynamic.waitForFunction(() => document.querySelector('.ra-pte-v3') && document.querySelector('.pte-modebar'));

    // Dynamically unmount v3 shell in this session
    await pageDynamic.evaluate(() => {
      window.ReadAloudMode?.unmountPteShell();
    });

    // Verify legacy elements are restored
    const restoredHeading = await pageDynamic.locator('#ra-workspace-heading').isVisible();
    assert.equal(restoredHeading, true, 'Dynamically unmounted shell must restore #ra-workspace-heading');
    const restoredCoach = await pageDynamic.locator('#ra-workspace-coach-host').isVisible();
    assert.equal(restoredCoach, true, 'Dynamically unmounted shell must restore #ra-workspace-coach-host');
    const restoredInstrSrOnly = await pageDynamic.locator('#ra-workspace-instruction').evaluate(el => el.classList.contains('pte-sr-only'));
    assert.equal(restoredInstrSrOnly, false, 'Dynamically unmounted shell must remove .pte-sr-only from #ra-workspace-instruction');
    console.log('  ✓ In-session unmount cleanly restores legacy heading, tips box, and instruction');
    await pageDynamic.close();

    // 4. Verify Legacy Mode (?pteShell=legacy)
    console.log('\n[4/4] Testing Legacy mode (?pteShell=legacy)...');
    const pageLegacy = await harness.open({ width: 1440, height: 900, flag: 'legacy' });

    await pageLegacy.evaluate(async () => {
      window.__PTE_TEST_TIME_SCALE = 0.05;
      await window.switchToMode('read-aloud');
    });

    await pageLegacy.waitForFunction(() => {
      const panel = document.getElementById('mode-read-aloud');
      return panel && getComputedStyle(panel).display !== 'none';
    }, null, { timeout: 30000 });

    // Under legacy mode, v3 modebar must NOT exist
    const legacyModebar = await pageLegacy.locator('.pte-modebar').count();
    assert.equal(legacyModebar, 0, 'No .pte-modebar in legacy mode');
    console.log('  ✓ No .pte-modebar in legacy mode');

    // Under legacy mode, #ra-workspace-heading MUST be visible
    const legacyHeading = await pageLegacy.locator('#ra-workspace-heading').isVisible();
    assert.equal(legacyHeading, true, '#ra-workspace-heading MUST be visible in legacy mode');
    console.log('  ✓ #ra-workspace-heading is visible in legacy mode');

    // Under legacy mode, #ra-workspace-steps-host MUST be visible
    const legacySteps = await pageLegacy.locator('#ra-workspace-steps-host').isVisible();
    assert.equal(legacySteps, true, '#ra-workspace-steps-host MUST be visible in legacy mode');
    console.log('  ✓ #ra-workspace-steps-host is visible in legacy mode');

    // Under legacy mode, #ra-workspace-coach-host MUST be visible
    const legacyCoach = await pageLegacy.locator('#ra-workspace-coach-host').isVisible();
    assert.equal(legacyCoach, true, '#ra-workspace-coach-host MUST be visible in legacy mode');
    console.log('  ✓ #ra-workspace-coach-host is visible in legacy mode');

    // Under legacy mode, #ra-workspace-instruction must NOT have .pte-sr-only
    const legacyInstrSrOnly = await pageLegacy.locator('#ra-workspace-instruction').evaluate(el => el.classList.contains('pte-sr-only'));
    assert.equal(legacyInstrSrOnly, false, '#ra-workspace-instruction must NOT be sr-only in legacy mode');
    console.log('  ✓ #ra-workspace-instruction is visible (not sr-only) in legacy mode');

    await pageLegacy.close();

    // 5. Verify Default View (no ?pteShell query param) -> v3 is active by default
    console.log('\n[5/5] Testing Default Mode (no query parameter)...');
    const pageDefault = await harness.open({ width: 1440, height: 900, flag: null });
    await pageDefault.evaluate(async () => {
      window.__PTE_TEST_TIME_SCALE = 0.05;
      await window.switchToMode('read-aloud');
    });
    await pageDefault.waitForFunction(() => {
      const panel = document.getElementById('mode-read-aloud');
      return panel && getComputedStyle(panel).display !== 'none' && document.querySelector('.pte-modebar');
    }, null, { timeout: 30000 });
    const defaultModebar = await pageDefault.locator('.pte-modebar').count();
    assert.equal(defaultModebar, 1, 'PTE modebar MUST be visible on default URL without query params');
    const defaultHeading = await pageDefault.locator('#ra-workspace-heading').isVisible().catch(() => false);
    assert.equal(defaultHeading, false, '#ra-workspace-heading must be hidden on default URL');
    console.log('  ✓ V3 shell is active by default on standard URL without query param');
    await pageDefault.close();

    console.log('\n======================================================');
    console.log('✓ ALL VERIFICATION CHECKS (V3, MODES, UNMOUNT, LEGACY, DEFAULT) PASSED!');
    console.log('======================================================');
  } finally {
    await harness.close();
  }
}

run().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('\n❌ Verification Failed:', err);
  process.exit(1);
});
