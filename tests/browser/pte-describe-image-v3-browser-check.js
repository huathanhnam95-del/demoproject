'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHarness } = require('./helpers/pte-shell-harness');

const evidence = process.env.PTE_SHELL_EVIDENCE;
if (!evidence) throw new Error('PTE_SHELL_EVIDENCE must be an external directory');

async function run() {
  const harness = await createHarness();
  const report = [];
  const failures = [];

  try {
    const viewports = [
      { width: 1440, height: 900, name: 'desktop' },
      { width: 390, height: 844, name: 'mobile' }
    ];

    for (const vp of viewports) {
      console.log(`[PTE DI v3] Testing viewport ${vp.width}x${vp.height} (${vp.name})...`);
      const page = await harness.open({ width: vp.width, height: vp.height, flag: 'v3' });
      const errors = [];
      page.on('pageerror', err => errors.push(err.message));

      // 1. Switch to Describe Image mode with fast test time scale
      await page.evaluate(async () => {
        window.__PTE_TEST_TIME_SCALE = 0.05; // 20x speedup
        await window.switchToMode('describe-image');
      });

      // 2. Auto-start on load: verify v3 shell, instruction, and prep phase
      await page.waitForFunction(() => {
        return window.DescribeImageMode?.getPtePhase?.() === 'prep' &&
          document.getElementById('di-pte-stage') &&
          getComputedStyle(document.getElementById('di-pte-stage')).display !== 'none';
      }, null, { timeout: 10000 });

      assert.equal(await page.locator('.pte-modebar').count(), 1, 'exactly one v3 modebar');
      assert.equal(await page.locator('#play-di-btn').isVisible(), false, 'legacy play button hidden in v3');
      assert.equal(await page.locator('#di-pte-instruction').isVisible(), true, 'PTE instruction visible');
      assert.match(await page.locator('#di-pte-instruction').innerText(), /In 25 seconds/);

      // Recorder in prep shows countdown
      assert.equal(await page.locator('#di-pte-recorder .pte-rec').isVisible(), true, 'recorder widget visible in stage');
      assert.equal(await page.locator('#di-record-btn').isVisible(), true, 'Start recording button visible in prep dock');
      assert.equal(await page.locator('#pte-next-describe-image').isVisible(), true, 'Next button visible in dock');

      // Prep next click should show "Cannot skip" dialog per next rules
      await page.locator('#pte-next-describe-image').click();
      await page.waitForFunction(() => document.querySelector('.pte-dialog'));
      assert.match(await page.locator('.pte-dialog').innerText(), /Cannot skip/, 'Cannot skip dialog during prep');
      await page.locator('.pte-dialog button').click(); // dismiss dialog
      await page.waitForFunction(() => !document.querySelector('.pte-dialog'));

      // 3. Start recording manually skips prep immediately and enters recording
      await page.locator('#di-record-btn').click();
      await page.waitForFunction(() => window.DescribeImageMode?.getPtePhase?.() === 'recording', null, { timeout: 5000 });
      assert.equal(await page.locator('#di-cancel-btn').isVisible(), true, 'Cancel button visible in recording dock');
      assert.equal(await page.locator('#di-stop-btn').isVisible(), true, 'Finish recording button visible in recording dock');

      // Next during recording requires confirmation
      await page.locator('#pte-next-describe-image').click();
      await page.waitForFunction(() => document.querySelector('.pte-dialog'));
      assert.match(await page.locator('.pte-dialog').innerText(), /Go to the next question/, 'Confirm next dialog in recording');
      await page.locator('.pte-dialog button').first().click(); // Stay here
      await page.waitForFunction(() => !document.querySelector('.pte-dialog'));

      // 4. Cancel button cancels recording and restarts prep
      await page.locator('#di-cancel-btn').click();
      await page.waitForFunction(() => window.DescribeImageMode?.getPtePhase?.() === 'prep', null, { timeout: 5000 });
      assert.equal(await page.locator('#di-record-btn').isVisible(), true, 'returns to prep after Cancel');

      // 5. Test Zoom modal from stage
      const zoomBtn = page.locator('#di-zoom-btn');
      assert.equal(await zoomBtn.isVisible(), true, 'corner zoom button visible on image container');
      await zoomBtn.click();
      await page.waitForFunction(() => {
        const overlay = document.getElementById('di-zoom-overlay');
        return overlay && getComputedStyle(overlay).display !== 'none';
      });
      assert.equal(await page.locator('#di-zoom-overlay').isVisible(), true, 'zoom overlay opened');

      // Focus should be inside zoom overlay (close button)
      const focusedId = await page.evaluate(() => document.activeElement?.id);
      assert.equal(focusedId, 'di-zoom-close', 'zoom close button receives focus');

      // Close zoom with Escape
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => {
        const overlay = document.getElementById('di-zoom-overlay');
        return !overlay || getComputedStyle(overlay).display === 'none';
      });
      assert.equal(await page.locator('#di-zoom-overlay').isVisible(), false, 'zoom overlay closed via Escape');

      // Re-open and close with backdrop click
      await zoomBtn.click();
      await page.waitForFunction(() => {
        const overlay = document.getElementById('di-zoom-overlay');
        return overlay && getComputedStyle(overlay).display !== 'none';
      });
      await page.locator('.di-zoom-backdrop').click({ position: { x: 10, y: 10 } });
      await page.waitForFunction(() => {
        const overlay = document.getElementById('di-zoom-overlay');
        return !overlay || getComputedStyle(overlay).display === 'none';
      });
      assert.equal(await page.locator('#di-zoom-overlay').isVisible(), false, 'zoom overlay closed via backdrop click');

      // 6. Enter recording again and finish to reach Complete phase
      await page.locator('#di-record-btn').click();
      await page.waitForFunction(() => window.DescribeImageMode?.getPtePhase?.() === 'recording', null, { timeout: 5000 });

      // Click Finish recording
      await page.locator('#di-stop-btn').click();
      await page.waitForFunction(() => window.DescribeImageMode?.getPtePhase?.() === 'complete', null, { timeout: 5000 });

      // Verify Complete dock actions: Record again, Play, Get feedback, Next
      assert.equal(await page.locator('#di-retry-btn').isVisible(), true, 'Record again button visible in complete dock');
      assert.equal(await page.locator('#di-play-btn').isVisible(), true, 'Play button visible in complete dock');
      assert.equal(await page.locator('#di-submit-btn').isVisible(), true, 'Get feedback button visible in complete dock');
      assert.equal(await page.locator('#pte-next-describe-image').isVisible(), true, 'Next button visible in complete dock');

      // Verify Play button toggles audio state
      await page.locator('#di-play-btn').click();
      await page.waitForFunction(() => {
        const audio = document.getElementById('di-recording-playback');
        return audio && !audio.paused;
      }, null, { timeout: 3000 });
      assert.equal(await page.evaluate(() => {
        const audio = document.getElementById('di-recording-playback');
        return audio && !audio.paused;
      }), true, 'audio playback started via Play button');
      await page.locator('#di-play-btn').click();
      await page.waitForFunction(() => {
        const audio = document.getElementById('di-recording-playback');
        return audio && audio.paused;
      }, null, { timeout: 3000 });
      assert.equal(await page.evaluate(() => {
        const audio = document.getElementById('di-recording-playback');
        return audio && audio.paused;
      }), true, 'audio playback paused via Play button');

      // 7. Click Get feedback to transition to Feedback phase
      await page.locator('#di-submit-btn').click();
      await page.waitForFunction(() => window.DescribeImageMode?.getPtePhase?.() === 'feedback', null, { timeout: 5000 });

      // Verify Feedback UI: stage is hidden, feedback is visible
      assert.equal(await page.locator('#di-pte-feedback').isVisible(), true, 'two-column feedback container visible');
      assert.equal(await page.locator('#di-pte-stage').isVisible(), false, 'prep stage hidden in feedback');

      // Left column: thumbnail with zoom, listen-back player, transcript
      assert.equal(await page.locator('#di-fb-thumb-img').isVisible(), true, 'thumbnail image visible');
      assert.equal(await page.locator('#di-fb-zoom-btn').isVisible(), true, 'zoom button on thumbnail visible');
      assert.equal(await page.locator('#di-fb-listen').isVisible(), true, 'listen-back row visible');
      assert.equal(await page.locator('#di-fb-transcript').isVisible(), true, 'transcript visible');

      // Test thumbnail zoom
      await page.locator('#di-fb-zoom-btn').click();
      await page.waitForFunction(() => {
        const overlay = document.getElementById('di-zoom-overlay');
        return overlay && getComputedStyle(overlay).display !== 'none';
      });
      assert.equal(await page.locator('#di-zoom-overlay').isVisible(), true, 'zoom opened from feedback thumbnail');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => {
        const overlay = document.getElementById('di-zoom-overlay');
        return !overlay || getComputedStyle(overlay).display === 'none';
      });

      // Right column: tabs, neutral checklist with —/5 stat, sample answer
      assert.equal(await page.locator('#di-tab-keypoints').isVisible(), true, 'Key points tab visible');
      assert.equal(await page.locator('#di-tab-sample').isVisible(), true, 'Sample answer tab visible');
      assert.match(await page.locator('#di-panel-keypoints .pte-stats').innerText(), /—\/5/, 'Key points shows —/5 neutral format');

      // Switch to Sample answer tab
      await page.locator('#di-tab-sample').click();
      assert.equal(await page.locator('#di-panel-sample').isVisible(), true, 'Sample answer panel visible');
      assert.equal(await page.locator('#di-panel-keypoints').isVisible(), false, 'Key points panel hidden');

      // Switch back to Key points tab
      await page.locator('#di-tab-keypoints').click();
      assert.equal(await page.locator('#di-panel-keypoints').isVisible(), true, 'Key points panel visible again');

      // Test AI button in feedback
      const aiBtn = page.locator('#di-fb-ai-btn');
      assert.equal(await aiBtn.isVisible(), true, 'AI Content Assessment button visible');
      await aiBtn.click();
      // Should show sent message or toast without throwing error
      await page.waitForTimeout(200);

      // Verify Feedback dock: Try again, Next question
      assert.equal(await page.locator('#di-results-retry-btn').isVisible(), true, 'Try again button visible in feedback dock');
      const nextBtn = page.locator('#pte-next-describe-image');
      assert.equal(await nextBtn.isVisible(), true, 'Next question button visible in feedback dock');
      assert.match(await nextBtn.innerText(), /Next question/, 'Next button text is Next question in feedback');

      // 8. Mobile layout: assert no horizontal overflow
      if (vp.width === 390) {
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
        assert.equal(overflow, true, 'mobile viewport has no horizontal overflow');
      }

      // 9. Advance to next question via shell Next question button
      const currentQId = await page.evaluate(() => window.DescribeImageMode?.getCurrentQuestionId?.());
      await nextBtn.click();
      await page.waitForFunction((prevId) => {
        return window.DescribeImageMode?.getPtePhase?.() === 'prep' &&
          window.DescribeImageMode?.getCurrentQuestionId?.() !== prevId;
      }, currentQId, { timeout: 8000 });

      assert.equal(await page.evaluate(() => window.DescribeImageMode?.getPtePhase?.()), 'prep', 'auto-starts prep on next question');

      // 10. Filters: test difficulty filter
      const diffFilter = await page.evaluate(() => window.DescribeImageMode?.getDifficultyFilter?.());
      assert.equal(diffFilter, 'all', 'default difficulty filter is all');
      await page.evaluate(() => window.DescribeImageMode?.setDifficultyFilter?.('2'));
      assert.equal(await page.evaluate(() => window.DescribeImageMode?.getDifficultyFilter?.()), '2', 'difficulty filter updated');
      await page.evaluate(() => window.DescribeImageMode?.setDifficultyFilter?.('all'));
      assert.equal(await page.evaluate(() => window.DescribeImageMode?.getPtePhase?.()), 'prep', 'remains in prep after filter update');

      // Screenshot for evidence
      await page.screenshot({ path: path.join(evidence, `di-v3-${vp.name}.png`), fullPage: true });

      assert.deepEqual(errors, [], `no uncaught page errors on ${vp.name}`);
      report.push({ viewport: vp.name, status: 'passed' });
      await page.close();
    }

    // 11. Legacy mode regression test (flag = 'legacy' and default flag off)
    for (const flag of ['legacy', '']) {
      console.log(`[PTE DI v3] Testing legacy fallback (flag='${flag}')...`);
      const page = await harness.open({ flag });
      await page.evaluate(async () => {
        await window.switchToMode('describe-image');
      });

      // Under legacy, v3 modebar is not present
      assert.equal(await page.locator('.pte-modebar').count(), 0, 'no v3 modebar in legacy');
      assert.equal(await page.locator('#play-di-btn').isVisible(), true, 'legacy play button is visible');
      assert.equal(await page.locator('#di-practice-area').isVisible(), false, 'practice area hidden until play clicked');

      // Click play to start legacy flow
      await page.locator('#play-di-btn').click();
      await page.waitForFunction(() => {
        const area = document.getElementById('di-practice-area');
        return area && getComputedStyle(area).display !== 'none';
      });
      assert.equal(await page.locator('#di-practice-area').isVisible(), true, 'practice area visible after legacy play');

      report.push({ legacyFlag: flag || 'default', status: 'passed' });
      await page.close();
    }

    fs.writeFileSync(path.join(evidence, 'describe-image-v3-report.json'), JSON.stringify(report, null, 2));
    console.log('[PTE DI v3] All Describe Image v3 tests PASSED!');
  } catch (err) {
    console.error('[PTE DI v3] FAILED:', err);
    failures.push(err.message);
    throw err;
  } finally {
    await harness.close();
  }
}

run().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
