'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHarness, initScript, dismissOverlays } = require('./helpers/pte-shell-harness');

const evidence = process.env.PTE_SHELL_EVIDENCE;
if (!evidence) throw new Error('PTE_SHELL_EVIDENCE must be an external directory');

function wave(sample = 0) {
  const samples = 1600; // 0.1s at 16kHz
  const b = Buffer.alloc(44 + samples * 2);
  b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(samples * 2, 40);
  for (let i = 44; i < b.length; i += 2) b.writeInt16LE(sample, i);
  return b;
}

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
      console.log(`[PTE SGD v3] Testing viewport ${vp.width}x${vp.height} (${vp.name})...`);
      const page = await harness.browser.newPage({ viewport: { width: vp.width, height: vp.height } });
      const errors = [];
      page.on('pageerror', err => { console.log('PAGEERROR:', err); errors.push(err.message); });
      page.on('console', msg => console.log('PAGE:', msg.text()));

      await page.addInitScript(initScript);
      await page.addInitScript(() => {
        sessionStorage.removeItem('guestMode');
        sessionStorage.setItem('onboardingDismissed', 'true');
        localStorage.setItem('hasSeenEntryModal', 'true');
        document.addEventListener('DOMContentLoaded', () => {
          const m = document.getElementById('entry-modal');
          if (m) m.remove();
        });

        window.__PTE_TEST_TIME_SCALE = 0.05; // 20x speedup
        class Recognition {
          start() {
            this.onstart?.();
            setTimeout(() => {
              const result = [{ transcript: 'The students discuss essay planning and writing center support.' }];
              result.isFinal = true;
              this.onresult?.({ resultIndex: 0, results: [result] });
            }, 50);
          }
          stop() { this.onend?.(); }
        }
        window.SpeechRecognition = Recognition;
        window.webkitSpeechRecognition = Recognition;
      });

      await page.route('**/*.{mp3,wav}*', route => route.fulfill({ contentType: 'audio/wav', body: wave() }));
      await page.goto(`${harness.baseURL}/?pteShell=v3`, { waitUntil: 'domcontentloaded' });
      await dismissOverlays(page);

      // 1. Switch to SGD mode
      await page.evaluate(async () => {
        await window.switchToMode('sgd');
      });

      // 2. Verify v3 elements rendered
      await page.waitForFunction(() => {
        return window.SGDMode?.getPtePhase?.() !== 'loading' &&
          document.getElementById('sgd-pte-stage');
      }, null, { timeout: 10000 });

      assert.equal(await page.locator('.pte-modebar').count(), 1, 'exactly one v3 modebar');
      assert.equal(await page.locator('#play-sgd-btn').isVisible(), false, 'legacy play button hidden in v3');
      assert.equal(await page.locator('#sgd-step-progress').isVisible(), false, 'legacy progress hidden in v3');
      assert.equal(await page.locator('#sgd-next-step-btn').isVisible(), false, 'legacy next step btn hidden in v3');
      assert.equal(await page.locator('#sgd-back-to-notes-btn').isVisible(), false, 'legacy back to notes btn hidden in v3');
      assert.equal(await page.locator('#sgd-pte-instruction').isVisible(), true, 'PTE instruction visible');
      assert.equal(
        await page.locator('#sgd-pte-instruction').innerText(),
        'You will hear three people having a discussion. When you hear the beep, summarize the whole discussion. You will have 10 seconds to prepare and 2 minutes to give your response.',
        'Instruction text matches canonical copy'
      );

      // Verify notes panel is present and editable on the single screen
      assert.equal(await page.locator('#sgd-speaker-notes').isVisible(), true, 'Notes panel visible in one-screen layout');
      const tabs = page.locator('#sgd-speaker-tabs .sgd-speaker-tab');
      assert.equal(await tabs.count(), 4, '4 speaker tabs (Topic, Speaker 1, 2, 3)');

      // Type some notes into Topic & Speaker 1
      await page.locator('#sgd-note-panels .sgd-note-textarea').first().fill('Essay topic planning notes');
      await tabs.nth(1).click();
      await page.locator('#sgd-note-panels .sgd-note-panel:not([style*="display: none"]) .sgd-note-textarea').fill('Speaker 1 focus ideas');

      // 3. Wait for flow to reach prep (after audio countdown & playback)
      await page.waitForFunction(() => {
        const ph = window.SGDMode?.getPtePhase?.();
        return ph === 'prep' || ph === 'recording';
      }, null, { timeout: 10000 });

      const phaseNow = await page.evaluate(() => window.SGDMode?.getPtePhase?.());
      if (phaseNow === 'prep') {
        assert.equal(await page.locator('#sgd-record-btn').isVisible(), true, 'Start recording button visible in prep dock');

        // Verify "Cannot skip" dialog during prep countdown
        await page.locator('#pte-next-sgd').click();
        await page.waitForFunction(() => document.querySelector('.pte-dialog'));
        assert.match(await page.locator('.pte-dialog').innerText(), /Cannot skip/, 'Cannot skip dialog shown in prep');
        await page.locator('.pte-dialog button').click();
        await page.waitForFunction(() => !document.querySelector('.pte-dialog'));

        // Manually click Start recording
        await page.locator('#sgd-record-btn').click();
      }

      // 4. In recording phase:
      await page.waitForFunction(() => window.SGDMode?.getPtePhase?.() === 'recording', null, { timeout: 5000 });
      assert.equal(await page.locator('#sgd-stop-btn').isVisible(), true, 'Finish recording visible in recording phase');
      assert.equal(await page.locator('#sgd-cancel-btn').isVisible(), true, 'Cancel button visible in recording phase');

      // Notes panel MUST remain visible and editable during recording
      assert.equal(await page.locator('#sgd-speaker-notes').isVisible(), true, 'Notes panel still visible during recording');
      assert.equal(
        await page.locator('#sgd-note-panels .sgd-note-textarea').first().inputValue(),
        'Essay topic planning notes',
        'Notes typed during prep remain intact during recording'
      );

      // Test Cancel in recording returns to prep
      await page.locator('#sgd-cancel-btn').click();
      await page.waitForFunction(() => window.SGDMode?.getPtePhase?.() === 'prep', null, { timeout: 5000 });
      assert.equal(await page.evaluate(() => window.SGDMode?.getPtePhase?.()), 'prep', 'Cancel returns to prep');

      // Click Start recording again to re-enter recording
      await page.locator('#sgd-record-btn').click();
      await page.waitForFunction(() => window.SGDMode?.getPtePhase?.() === 'recording', null, { timeout: 5000 });

      // Next during recording triggers confirmation dialog - test Stay here
      await page.locator('#pte-next-sgd').click();
      await page.waitForFunction(() => document.querySelector('.pte-dialog'));
      assert.match(await page.locator('.pte-dialog').innerText(), /Go to the next question\?/, 'Confirmation dialog on Next in recording');
      await page.locator('.pte-dialog button:has-text("Stay here")').click();
      await page.waitForFunction(() => !document.querySelector('.pte-dialog'));
      assert.equal(await page.evaluate(() => window.SGDMode?.getPtePhase?.()), 'recording', 'Stay here keeps recording');

      // 5. Finish recording advances to complete phase
      await page.locator('#sgd-stop-btn').click();
      await page.waitForFunction(() => window.SGDMode?.getPtePhase?.() === 'complete', null, { timeout: 5000 });

      // In complete phase:
      assert.equal(await page.locator('#sgd-submit-btn').isVisible(), true, 'Get feedback visible in complete phase');
      assert.equal(await page.locator('#sgd-retry-btn').isVisible(), true, 'Record again visible in complete phase');
      assert.equal(await page.locator('#sgd-play-user-btn').isVisible(), true, 'Play user audio button visible in complete phase');

      // Results must NOT be shown yet (gated behind Get feedback)
      assert.equal(await page.locator('#sgd-pte-feedback').isVisible(), false, 'feedback hidden in complete phase');

      // Test Play user audio click
      await page.locator('#sgd-play-user-btn').click();
      await page.waitForTimeout(100);

      // 6. Click Get feedback -> transition to feedback phase
      await page.locator('#sgd-submit-btn').click();
      await page.waitForFunction(() => window.SGDMode?.getPtePhase?.() === 'feedback', null, { timeout: 8000 });

      // Feedback phase layout:
      assert.equal(await page.locator('#sgd-pte-feedback').isVisible(), true, 'feedback container visible');
      assert.equal(await page.locator('#sgd-redo-btn').isVisible(), true, 'Try again visible in feedback dock');
      assert.equal(await page.locator('#pte-next-sgd').isVisible(), true, 'Next question button visible in feedback dock');

      // Left column: student recording playback + notes review
      assert.equal(await page.locator('#sgd-v3-playback').isVisible(), true, 'student recording playback visible');
      assert.equal(await page.locator('#sgd-v3-notes-review').isVisible(), true, 'notes review visible in left column');

      // Right column: "Who said what" tab & "Transcript" tab
      assert.equal(await page.locator('[data-v3-tab="stats"]').isVisible(), true, 'Who said what stats tab visible');
      assert.equal(await page.locator('[data-v3-tab="transcript"]').isVisible(), true, 'Transcript tab visible');

      // Stats panel: overall accuracy tile + speaker breakdown
      assert.equal(await page.locator('#sgd-v3-stats-panel').isVisible(), true, 'Stats panel visible');
      assert.match(await page.locator('#sgd-v3-stats-panel').innerText(), /overall accuracy/i, 'overall accuracy rendered');

      // Switch to Transcript tab
      await page.locator('[data-v3-tab="transcript"]').click();
      assert.equal(await page.locator('#sgd-v3-transcript-panel').isVisible(), true, 'Transcript panel visible');
      assert.match(await page.locator('#sgd-v3-transcript-panel').innerText(), /Speaker/, 'Transcript panel has speaker labels');

      // 7. Retry practice resets to clean state
      await page.locator('#sgd-redo-btn').click();
      await page.waitForFunction(() => {
        const ph = window.SGDMode?.getPtePhase?.();
        return ph === 'prep' || ph === 'recording' || ph === 'listen';
      }, null, { timeout: 8000 });

      // 8. Mobile horizontal overflow check
      if (vp.width === 390) {
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
        assert.equal(overflow, true, 'mobile viewport has no horizontal overflow');
      }

      // Screenshot for evidence
      await page.screenshot({ path: path.join(evidence, `sgd-v3-${vp.name}.png`), fullPage: true });

      assert.deepEqual(errors, [], `no uncaught page errors on ${vp.name}`);
      report.push({ viewport: vp.name, status: 'passed' });
      await page.close();
    }

    // 9. Legacy mode regression test (flag = 'legacy' and default flag off)
    for (const flag of ['legacy', '']) {
      console.log(`[PTE SGD v3] Testing legacy fallback (flag='${flag}')...`);
      const page = await harness.open({ flag });
      await page.evaluate(async () => {
        await window.switchToMode('sgd');
      });

      // Under legacy, v3 modebar is not present
      assert.equal(await page.locator('.pte-modebar').count(), 0, 'no v3 modebar in legacy');
      assert.equal(await page.locator('#play-sgd-btn').isVisible(), true, 'legacy play button is visible');
      assert.equal(await page.locator('#sgd-pte-instruction').count(), 0, 'no v3 instruction in legacy');

      report.push({ legacyFlag: flag || 'default', status: 'passed' });
      await page.close();
    }

    fs.writeFileSync(path.join(evidence, 'sgd-v3-report.json'), JSON.stringify(report, null, 2));
    console.log('[PTE SGD v3] All Summarize Group Discussion v3 tests PASSED!');
  } catch (err) {
    console.error('[PTE SGD v3] FAILED:', err);
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
