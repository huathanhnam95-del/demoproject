'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHarness } = require('./helpers/pte-shell-harness');

const evidence = process.env.PTE_SHELL_EVIDENCE;
if (!evidence) throw new Error('PTE_SHELL_EVIDENCE must be an external directory');

const VALID_WEBM_BASE64 = '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';
const VALID_WEBM_SHA256 = 'DF83438032C65F0058713B44D60C7C0ED09DFE5279CC3CCD0EAECC33B3B82B5C';
const validWebmBytes = Buffer.from(VALID_WEBM_BASE64, 'base64');

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
      await page.route('**/api/config', route => route.fulfill({ json: { features: { speechV3Modes: [] } } }));
      const errors = [];
      page.on('pageerror', err => errors.push(err.message));
      await page.route('**/media-release.json*', route => route.fulfill({ json: { defaultRolloutState: 'legacy', modes: {} } }));
      await page.route(/\/database\/Describe(%20| )Image\/DI\/.*\.(png|jpe?g)/i, route => route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900"><rect width="1200" height="900" fill="#dbeafe"/></svg>'
      }));

      await page.evaluate(({ bytes }) => {
        const originalBytes = Uint8Array.from(bytes);
        const originalStart = MediaRecorder.prototype.start;
        MediaRecorder.prototype.start = function (...args) {
          this.mimeType = 'audio/webm';
          return originalStart?.apply(this, args);
        };
        MediaRecorder.prototype.stop = function () {
          this.state = 'inactive';
          const data = new Blob([originalBytes], { type: 'audio/webm' });
          const event = new Event('dataavailable'); Object.defineProperty(event, 'data', { value: data });
          this.ondataavailable?.(event); this.dispatchEvent(event);
          const stop = new Event('stop'); this.onstop?.(stop); this.dispatchEvent(stop);
        };
      }, { bytes: [...validWebmBytes] });
      // 1. Switch to Describe Image mode with fast test time scale
      await page.evaluate(async () => {
        window.__PTE_TEST_TIME_SCALE = 0.2; // 5x speedup: 5s prep, 8s record
        await window.switchToMode('describe-image');
      });

      // 2. Auto-start on load: verify v3 shell, instruction, and prep phase
      await page.waitForFunction(() => {
        return window.DescribeImageMode?.getPtePhase?.() === 'prep' &&
          document.getElementById('di-pte-stage') &&
          getComputedStyle(document.getElementById('di-pte-stage')).display !== 'none';
      }, null, { timeout: 10000 });
      // The learner-driven steps below run at real speed, so the prep countdown cannot
      // auto-start the recording under a Start recording click. (A sped-up clock raced the
      // click, which is why these clicks had become optional and could no longer fail.)
      await page.evaluate(() => { window.__PTE_TEST_TIME_SCALE = 1; });

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
      await page.evaluate(() => { window.__PTE_TEST_TIME_SCALE = 0.2; });

      const rawPlayback = await page.evaluate(async () => {
        const audio = document.getElementById('di-recording-playback');
        const blob = await fetch(audio.src).then(response => response.blob());
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        return {
          type: blob.type,
          byteLength: bytes.byteLength,
          sha256: [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('').toUpperCase()
        };
      });
      assert.deepEqual(rawPlayback, { type: 'audio/webm', byteLength: validWebmBytes.length, sha256: VALID_WEBM_SHA256 }, 'Describe Image playback keeps the original decodable WebM capture identity');

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
      // Zoom appears once the thumbnail has loaded (nothing to enlarge before that).
      await page.waitForSelector('#di-fb-zoom-btn', { state: 'visible', timeout: 5000 });
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

      // Right column: tabs, neutral checklist with \u2014/5 stat, sample answer
      assert.equal(await page.locator('#di-tab-keypoints').isVisible(), true, 'Key points tab visible');
      assert.equal(await page.locator('#di-tab-sample').isVisible(), true, 'Sample answer tab visible');
      assert.match(await page.locator('#di-panel-keypoints .pte-stats').innerText(), /\u2014\/5/, 'Key points shows \u2014/5 neutral format');

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

    // 11. Legacy mode regression test (flag = 'legacy')
    for (const flag of ['legacy']) {
      console.log(`[PTE DI v3] Testing legacy fallback (flag='${flag}')...`);
      const page = await harness.open({ flag });
      await page.route('**/api/config', route => route.fulfill({ json: { features: { speechV3Modes: [] } } }));
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
