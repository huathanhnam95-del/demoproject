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
      console.log(`[PTE ASQ v3] Testing viewport ${vp.width}x${vp.height} (${vp.name})...`);
      const page = await harness.browser.newPage({ viewport: { width: vp.width, height: vp.height } });
      const errors = [];
      page.on('pageerror', err => { console.log('PAGEERROR:', err); errors.push(err.message); });
      page.on('console', msg => console.log('PAGE:', msg.text()));

      await page.addInitScript(initScript);
      await page.addInitScript(() => {
        window.__PTE_TEST_TIME_SCALE = 0.05; // 20x speedup
        class Recognition {
          start() {
            this.onstart?.();
            setTimeout(() => {
              const result = [{ transcript: 'thermometer' }];
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

      // 1. Seed ASQ database and audio stubs, switch to ASQ
      await page.evaluate(async () => {
        const asq = window.ASQMode;
        if (asq) {
          asq.database = [
            { id: '1', promptText: 'What instrument is used to measure temperature?', answerDisplay: 'thermometer', acceptedAnswers: ['thermometer', 'a thermometer'] },
            { id: '2', promptText: 'What is the capital of France?', answerDisplay: 'Paris', acceptedAnswers: ['paris'] }
          ];
          asq.databaseById = new Map(asq.database.map(item => [item.id, item]));
          asq.audioManifest = { '1': '1.mp3', '2': '2.mp3' };
          asq.loadWorkbookIfNeeded = async () => {};
          asq.loadAudioManifestIfNeeded = async () => {};
        }
        window.handleDualTrackScoring = async (mode, id, transcript) => {
          return { success: true, accuracy: 1.0, xpEarned: 5 };
        };
        await window.switchToMode('asq');
        if (asq) {
          await asq.setQuestionById('1');
        }
      });

      // 2. Verify v3 modebar & structure
      await page.waitForFunction(() => {
        return window.ASQMode?.getPtePhase?.() !== 'loading' &&
          document.getElementById('asq-pte-stage');
      }, null, { timeout: 10000 });

      assert.equal(await page.locator('.pte-modebar').count(), 1, 'exactly one v3 modebar');
      assert.equal(await page.locator('.asq-audio').isVisible(), false, 'legacy audio player hidden in v3');
      assert.equal(await page.locator('#asq-status-message').isVisible(), false, 'legacy status message hidden in v3');
      assert.equal(await page.locator('#asq-action-host').isVisible(), false, 'legacy action host hidden in v3');
      assert.equal(await page.locator('#asq-pte-instruction').isVisible(), true, 'PTE instruction visible');
      assert.match(await page.locator('#asq-pte-instruction').innerText(), /You will hear a question/);

      // ASQ has NO Filters button
      assert.equal(await page.locator('[data-pte-filter]').count(), 0, 'no filter buttons in ASQ');

      // 3. Wait for flow to reach prep (after prompt audio finishes)
      await page.waitForFunction(() => {
        const ph = window.ASQMode?.getPtePhase?.();
        return ph === 'prep' || ph === 'recording';
      }, null, { timeout: 10000 }).catch(async (err) => {
        const info = await page.evaluate(() => ({
          phase: window.ASQMode?.getPtePhase?.(),
          currentId: window.ASQMode?.currentId,
          v3Active: window.ASQMode?.v3Active,
          audioSrc: document.getElementById('asq-prompt-audio')?.src,
          audioCurrentSrc: document.getElementById('asq-prompt-audio')?.currentSrc,
          paused: document.getElementById('asq-prompt-audio')?.paused,
          ended: document.getElementById('asq-prompt-audio')?.ended,
          audioError: document.getElementById('asq-prompt-audio')?.error?.message || document.getElementById('asq-prompt-audio')?.error?.code,
          audioBoxState: document.querySelector('.pte-audio')?.dataset?.state,
          audioBoxText: document.querySelector('.pte-audio__status b')?.textContent
        }));
        console.log('PAGE ERRORS:', errors);
        console.log('DEBUG INFO:', info);
        throw err;
      });

      // If in prep, verify countdown and dock
      const phaseNow = await page.evaluate(() => window.ASQMode?.getPtePhase?.());
      if (phaseNow === 'prep') {
        assert.equal(await page.locator('#asq-replay-btn').isVisible(), true, 'Replay question helper visible in prep');
        assert.equal(await page.locator('#asq-record-btn').isVisible(), true, 'Start recording button visible in prep dock');

        // Verify "Cannot skip" dialog during prep countdown
        await page.locator('#pte-next-asq').click();
        await page.waitForFunction(() => document.querySelector('.pte-dialog'));
        assert.match(await page.locator('.pte-dialog').innerText(), /Cannot skip/, 'Cannot skip dialog shown in prep');
        await page.locator('.pte-dialog button').click(); // dismiss OK
        await page.waitForFunction(() => !document.querySelector('.pte-dialog'));

        // Manually click Start recording to skip prep countdown
        await page.locator('#asq-record-btn').click();
      }

      // 4. In recording phase:
      await page.waitForFunction(() => window.ASQMode?.getPtePhase?.() === 'recording', null, { timeout: 5000 });
      assert.equal(await page.locator('#asq-stop-btn').isVisible(), true, 'Finish recording visible in recording phase');
      assert.equal(await page.locator('#asq-cancel-btn').isVisible(), true, 'Cancel button visible in recording phase');
      assert.equal(await page.locator('#asq-replay-btn').isVisible(), false, 'Replay helper hidden during recording');

      // Test Cancel in recording returns to prep
      await page.locator('#asq-cancel-btn').click();
      await page.waitForFunction(() => window.ASQMode?.getPtePhase?.() === 'prep', null, { timeout: 5000 });
      assert.equal(await page.evaluate(() => window.ASQMode?.getPtePhase?.()), 'prep', 'Cancel returns to prep');

      // Click Start recording again to re-enter recording
      await page.locator('#asq-record-btn').click();
      await page.waitForFunction(() => window.ASQMode?.getPtePhase?.() === 'recording', null, { timeout: 5000 });

      // Next during recording triggers confirmation dialog
      await page.locator('#pte-next-asq').click();
      await page.waitForFunction(() => document.querySelector('.pte-dialog'));
      assert.match(await page.locator('.pte-dialog').innerText(), /Go to the next question\?/, 'Confirmation dialog on Next in recording');
      await page.locator('.pte-dialog button:has-text("Stay here")').click();
      await page.waitForFunction(() => !document.querySelector('.pte-dialog'));
      assert.equal(await page.evaluate(() => window.ASQMode?.getPtePhase?.()), 'recording', 'Stay here keeps recording');

      // 5. Finish recording advances to complete phase
      await page.locator('#asq-stop-btn').click();
      await page.waitForFunction(() => window.ASQMode?.getPtePhase?.() === 'complete', null, { timeout: 5000 });

      // In complete phase:
      assert.equal(await page.locator('#asq-submit-btn').isVisible(), true, 'Get feedback visible in complete phase');
      assert.equal(await page.locator('#asq-retry-btn').isVisible(), true, 'Record again visible in complete phase');
      assert.equal(await page.locator('#asq-play-btn').isVisible(), true, 'Play user audio button visible in complete phase');
      assert.equal(await page.locator('#asq-replay-btn').isVisible(), true, 'Replay question helper visible in complete phase');

      // Results must NOT be shown yet (gated behind Get feedback)
      assert.equal(await page.locator('#asq-pte-feedback').isVisible(), false, 'feedback hidden in complete phase');

      // Test Replay question click doesn't error
      await page.locator('#asq-replay-btn').click();
      await page.waitForTimeout(200);

      // Test Play user audio click
      await page.locator('#asq-play-btn').click();
      await page.waitForTimeout(200);

      // 6. Click Get feedback -> transition to feedback phase
      await page.locator('#asq-submit-btn').click();
      await page.waitForFunction(() => window.ASQMode?.getPtePhase?.() === 'feedback', null, { timeout: 8000 });

      // Feedback phase layout:
      assert.equal(await page.locator('#asq-pte-feedback').isVisible(), true, 'feedback container visible');
      assert.equal(await page.locator('#asq-redo-btn').isVisible(), true, 'Try again visible in feedback dock');
      assert.equal(await page.locator('#pte-next-asq').isVisible(), true, 'Next question button visible in feedback dock');

      // Left column: question revealed + listen back
      assert.match(await page.locator('.asq-fb-question-text').innerText(), /What instrument is used to measure temperature\?/);
      assert.equal(await page.locator('#asq-listen-question').isVisible(), true, 'Question listen button visible');
      assert.equal(await page.locator('#asq-listen-yours').isVisible(), true, 'Your recording listen button visible');

      // Right column: verdict + transcript + accepted answers
      assert.equal(await page.locator('.asq-fb-verdict.correct').isVisible(), true, 'Correct verdict badge visible');
      assert.match(await page.locator('.asq-fb-you-said').innerText(), /thermometer/);
      assert.match(await page.locator('.asq-fb-accepted').innerText(), /thermometer/);

      // Switch listen-back source
      await page.locator('#asq-listen-yours').click();
      assert.equal(await page.locator('#asq-listen-yours').getAttribute('aria-pressed'), 'true');
      await page.locator('#asq-listen-question').click();
      assert.equal(await page.locator('#asq-listen-question').getAttribute('aria-pressed'), 'true');

      // 7. Mobile horizontal overflow check
      if (vp.width === 390) {
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
        assert.equal(overflow, true, 'mobile viewport has no horizontal overflow');
      }

      // 8. Next question advances directly without confirmation
      await page.locator('#pte-next-asq').click();
      await page.waitForFunction(() => {
        const id = window.ASQMode?.currentId;
        return id === '2';
      }, null, { timeout: 8000 });

      assert.equal(await page.evaluate(() => window.ASQMode?.currentId), '2', 'advanced to question 2');

      // Screenshot for evidence
      await page.screenshot({ path: path.join(evidence, `asq-v3-${vp.name}.png`), fullPage: true });

      assert.deepEqual(errors, [], `no uncaught page errors on ${vp.name}`);
      report.push({ viewport: vp.name, status: 'passed' });
      await page.close();
    }

    // 9. Legacy mode regression test (flag = 'legacy' and default flag off)
    for (const flag of ['legacy', '']) {
      console.log(`[PTE ASQ v3] Testing legacy fallback (flag='${flag}')...`);
      const page = await harness.open({ flag });
      await page.evaluate(async () => {
        await window.switchToMode('asq');
      });

      // Under legacy, v3 modebar is not present
      assert.equal(await page.locator('.pte-modebar').count(), 0, 'no v3 modebar in legacy');
      assert.equal(await page.locator('#asq-action-host').isVisible(), true, 'legacy action host visible in legacy');
      assert.equal(await page.locator('#asq-record-btn').isVisible(), true, 'legacy record button is visible');
      assert.equal(await page.locator('#asq-pte-instruction').count(), 0, 'no v3 instruction in legacy');

      report.push({ legacyFlag: flag || 'default', status: 'passed' });
      await page.close();
    }

    fs.writeFileSync(path.join(evidence, 'asq-v3-report.json'), JSON.stringify(report, null, 2));
    console.log('[PTE ASQ v3] All Answer Short Question v3 tests PASSED!');
  } catch (err) {
    console.error('[PTE ASQ v3] FAILED:', err);
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
