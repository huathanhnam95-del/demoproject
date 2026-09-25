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

async function startV3RecordingIfStillInPrep(page) {
  return page.evaluate(() => {
    const phase = window.SGDMode?.getPtePhase?.();
    if (phase !== 'prep') return { phase, clickedStart: false };
    const button = document.getElementById('sgd-record-btn');
    const visible = !!button && !!(button.offsetWidth || button.offsetHeight || button.getClientRects().length);
    if (!visible) return { phase, clickedStart: false };
    button.click();
    return { phase, clickedStart: true };
  });
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

      await page.route('**/media-release.json*', route => route.fulfill({ json: { defaultRolloutState: 'legacy', modes: {} } }));
      await page.route('**/*.{mp3,wav}*', route => route.fulfill({ contentType: 'audio/wav', body: wave() }));
      // Keep this browser gate on the prepared-WAV consent path. The static
      // harness has no backend /api/config route; without this explicit
      // capability fixture speechV3Enabled() fetches a 404 and aborts before
      // blobToBase64() can record the assessment bytes asserted below.
      await page.route('**/api/config', route => route.fulfill({ json: {
        success: true,
        config: {},
        features: { speechV3Modes: [] }
      } }));
      await page.goto(`${harness.baseURL}/?pteShell=v3`, { waitUntil: 'domcontentloaded' });
      await dismissOverlays(page);

      await page.evaluate(bytes => {
        const pipeline = window.AudioDspPipeline;
        const prepared = new Blob([Uint8Array.from(bytes)], { type: 'audio/wav' });
        window.AudioDspPipeline = {
          ...pipeline,
          prepareForAssessment: async rawBlob => ({
            rawBlob, outputBlob: prepared, wavBlob: prepared, outputMimeType: 'audio/wav', outputFormat: 'wav',
            processingStatus: 'format-only', sampleCount: 1600,
            audioBuffer: { sampleRate: 16000, numberOfChannels: 1, length: 1600 },
            stats: { removedLeadingMs: 0, removedTrailingMs: 0 }
          })
        };
        window.__sgdRawArchive = null;
        const archiveSave = window.PTEAttemptArchive?.saveAttempt;
        if (archiveSave) window.PTEAttemptArchive.saveAttempt = async input => {
          const blob = input.media?.[0]?.blob;
          window.__sgdRawArchive = blob ? { type: blob.type, sample: new DataView(await blob.slice(44, 46).arrayBuffer()).getInt16(0, true) } : null;
          return archiveSave(input);
        };
        const gate = window.AiScoringGate || {};
        window.AiScoringGate = {
          ...gate,
          blobToBase64: async blob => {
            window.__sgdAssessment = { type: blob?.type || '', sample: blob ? new DataView(await blob.slice(44, 46).arrayBuffer()).getInt16(0, true) : null };
            return 'fixture-audio';
          },
          requestConsentAndConfirm: async () => ({ allowed: false, cancelled: true })
        };
      }, [...wave(222)]);

      // 1. Switch to SGD mode
      // 1. Switch to SGD mode. Countdowns run at real speed from here, so the manual Start
      // recording clicks below are never raced by the auto-start. (Under a 20x clock the
      // clicks had become optional and swallowed their errors, so a broken button passed.)
      await page.evaluate(async () => {
        window.__PTE_TEST_TIME_SCALE = 1;
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
      assert.equal(phaseNow, 'prep', 'the audio hands over to a prep countdown');
      assert.equal(await page.locator('#sgd-record-btn').isVisible(), true, 'Start recording button visible in prep dock');

      // Verify "Cannot skip" dialog during prep countdown
      await page.locator('#pte-next-sgd').click();
      await page.waitForFunction(() => document.querySelector('.pte-dialog'));
      assert.match(await page.locator('.pte-dialog').innerText(), /Cannot skip/, 'Cannot skip dialog shown in prep');
      await page.locator('.pte-dialog button').click();
      await page.waitForFunction(() => !document.querySelector('.pte-dialog'));

      // Manually click Start recording
      await page.locator('#sgd-record-btn').click();

      // 4. In recording phase:
      await page.waitForFunction(() => window.SGDMode?.getPtePhase?.() === 'recording', null, { timeout: 5000 });
      assert.equal(await page.locator('#sgd-pte-rec-host .pte-rec').getAttribute('data-state'), 'recording', 'V3 recorder is actively recording');
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

      // Restart through the visible prep control if the accelerated countdown has not already started.
      await startV3RecordingIfStillInPrep(page);
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
      assert.equal(await page.locator('#pte-listen-back').isVisible(), true, 'student recording playback visible');
      assert.equal(await page.locator('#sgd-v3-playback').isVisible(), false, 'legacy bare playback player stays hidden');
      const listenBackSources = page.locator('#pte-listen-back .pte-listen__sources button');
      assert.deepEqual(
        await listenBackSources.allInnerTexts(),
        ['Your recording', 'Discussion'],
        'listen-back exposes recording and discussion sources'
      );
      assert.equal(await listenBackSources.nth(0).getAttribute('aria-pressed'), 'true', 'recording source selected by default');
      await listenBackSources.nth(1).click();
      await page.waitForFunction(
        () => document.querySelector('#pte-listen-back .pte-listen__play')?.getAttribute('aria-label') === 'Play the discussion',
        null,
        { timeout: 3000 }
      );
      assert.equal(await listenBackSources.nth(1).getAttribute('aria-pressed'), 'true', 'discussion source selected after toggle');
      await listenBackSources.nth(0).click();
      await page.waitForFunction(
        () => document.querySelector('#pte-listen-back .pte-listen__play')?.getAttribute('aria-label') === 'Play your recording',
        null,
        { timeout: 3000 }
      );
      assert.equal(await listenBackSources.nth(0).getAttribute('aria-pressed'), 'true', 'recording source restored after toggle');
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

      const aiScoreButton = page.locator('#sgd-v3-ai-score-btn');
      if (await aiScoreButton.count() && await aiScoreButton.isVisible()) {
        await aiScoreButton.click();
        await page.waitForTimeout(50);
      }
      const audioContract = await page.evaluate(() => ({ raw: window.__sgdRawArchive, assessment: window.__sgdAssessment }));
      assert.deepEqual(audioContract, {
        raw: { type: 'audio/wav', sample: 0 },
        assessment: { type: 'audio/wav', sample: 222 }
      }, 'SGD archives the original capture and scores the separate prepared WAV');

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
    for (const flag of ['legacy']) {
      console.log(`[PTE SGD v3] Testing legacy fallback (flag='${flag}')...`);
      const page = await harness.open({ flag });
      await page.route('**/api/config', route => route.fulfill({ json: { features: { speechV3Modes: [] } } }));
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
