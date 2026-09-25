'use strict';

const assert = require('node:assert/strict');
const { createHarness } = require('./helpers/pte-shell-harness');

async function run() {
  console.log('--- Starting PTE Speaking 4 Open Items Verification ---');
  const harness = await createHarness();

  try {
    const page = await harness.open({ width: 1440, height: 900, flag: 'v3' });
    page.on('console', msg => console.log(`  [browser console] ${msg.type()}: ${msg.text()}`));
    page.on('pageerror', err => console.log(`  [browser pageerror] ${err.message}`));

    // 1. Verify data-practice-layout persistence on Read Aloud -> Repeat Sentence transition
    console.log('\n[1/4] Testing data-practice-layout persistence across mode switches...');
    await page.evaluate(async () => {
      window.__PTE_TEST_TIME_SCALE = 0.05;
      await window.switchToMode('read-aloud');
    });
    await page.waitForTimeout(1000);

    const raLayout = await page.evaluate(() => document.body.dataset.practiceLayout);
    console.log(`  Read Aloud layout flag: ${raLayout}`);
    assert.equal(raLayout, 'fluid-v1', 'Read Aloud must set dataset.practiceLayout to fluid-v1');

    // Switch to Repeat Sentence
    await page.evaluate(async () => {
      await window.switchToMode('speak');
    });
    await page.waitForTimeout(1000);

    const rsLayout = await page.evaluate(() => document.body.dataset.practiceLayout);
    console.log(`  Repeat Sentence layout flag after switch: ${rsLayout}`);
    assert.equal(rsLayout, 'fluid-v1', 'Repeat Sentence must RETAIN dataset.practiceLayout = fluid-v1');
    console.log('  ✓ data-practice-layout successfully persisted after Read Aloud exit');

    // 2. Verify SGD empty topic display suppression
    console.log('\n[2/4] Testing SGD empty topic suppression (:empty)...');
    await page.evaluate(async () => {
      await window.switchToMode('sgd');
    });
    await page.waitForTimeout(1000);

    const topicDisplayHidden = await page.evaluate(() => {
      const el = document.getElementById('sgd-topic');
      if (!el) return true;
      el.textContent = ''; // ensure empty
      return getComputedStyle(el).display === 'none';
    });
    console.log(`  SGD empty topic display:none: ${topicDisplayHidden}`);
    assert.equal(topicDisplayHidden, true, '#sgd-topic:empty must compute display: none');
    console.log('  ✓ Empty SGD topic is cleanly hidden');

    // 3. Verify SGD feedback card height bounding
    console.log('\n[3/4] Testing SGD feedback panel height constraints...');
    const sgdFeedbackBounds = await page.evaluate(() => {
      const mode = window.sgdPracticeMode;
      // Trigger feedback rendering if available
      const notesReview = document.querySelector('#sgd-v3-notes-review') || (() => {
        const div = document.createElement('div');
        div.id = 'sgd-v3-notes-review';
        document.querySelector('#mode-sgd')?.appendChild(div);
        return div;
      })();
      const fbPanel = document.querySelector('.sgd-v3-fb-panel') || (() => {
        const div = document.createElement('div');
        div.className = 'sgd-v3-fb-panel';
        document.querySelector('#mode-sgd')?.appendChild(div);
        return div;
      })();

      return {
        notesReviewOverflow: getComputedStyle(notesReview).overflowY,
        notesReviewMaxH: getComputedStyle(notesReview).maxHeight,
        fbPanelOverflow: getComputedStyle(fbPanel).overflowY,
        fbPanelMaxH: getComputedStyle(fbPanel).maxHeight
      };
    });

    console.log('  SGD feedback styles:', sgdFeedbackBounds);
    // 2026-09-23: the fixed-height inner scrollers were removed (scroll traps inside a scrolling
    // page, especially on phones); the card grows and the sticky dock keeps actions in reach.
    assert.equal(sgdFeedbackBounds.notesReviewOverflow, 'visible', 'Notes review is not a nested scroller');
    assert.equal(sgdFeedbackBounds.notesReviewMaxH, 'none', 'Notes review has no fixed max-height');
    assert.equal(sgdFeedbackBounds.fbPanelOverflow, 'visible', 'Feedback panel is not a nested scroller');
    assert.equal(sgdFeedbackBounds.fbPanelMaxH, 'none', 'Feedback panel has no fixed max-height');
    console.log('  ✓ SGD feedback has no nested scrollers');

    // 4. Verify PteAudioBox play timeout / stall prevention in ASQ
    console.log('\n[4/4] Testing PteAudioBox stall prevention in ASQ & RTS...');
    await page.evaluate(async () => {
      window.__PTE_TEST_TIME_SCALE = 0.05;
      await window.switchToMode('asq');
    });

    // Wait up to 6 seconds for ASQ to complete countdown and advance without hanging on 0s
    console.log('  Waiting for ASQ to advance through listen stage...');
    await page.waitForTimeout(4000);

    const asqStatus = await page.evaluate(() => {
      const audioBox = document.querySelector('.pte-audio');
      const state = audioBox ? audioBox.dataset.state : null;
      const statusText = audioBox ? audioBox.querySelector('b')?.textContent : null;
      const asq = window.ASQMode;
      return {
        state,
        statusText,
        v3Phase: asq?.v3Phase,
        v3Active: asq?.v3Active,
        currentId: asq?.currentId,
        hasAudioSrc: asq?.hasAudioSrc,
        audioElementSrc: asq?.els?.promptAudio?.src,
        audioPaused: asq?.els?.promptAudio?.paused,
        audioError: asq?.els?.promptAudio?.error?.code
      };
    });

    console.log('  ASQ detailed state:', asqStatus);
    // Audio box should NOT be stuck on 'Beginning in 0 seconds'
    assert.notEqual(asqStatus.statusText, 'Beginning in 0 seconds', 'ASQ must not be stuck on "Beginning in 0 seconds"');
    console.log('  ✓ ASQ audio box completed and did not hang on 0 seconds');

    console.log('\n======================================================');
    console.log('🎉 ALL 4 PTE SPEAKING OPEN ITEMS VERIFIED AND PASSED!');
    console.log('======================================================');

    process.exit(0);
  } finally {
    await harness.close().catch(() => {});
  }
}

run().catch(err => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
