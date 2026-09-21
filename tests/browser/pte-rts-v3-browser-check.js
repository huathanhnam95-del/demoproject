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
      console.log(`[PTE RTS v3] Testing viewport ${vp.width}x${vp.height} (${vp.name})...`);
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
              const result = [{ transcript: 'I would politely explain the library policy.' }];
              result.isFinal = true;
              this.onresult?.({ resultIndex: 0, results: [result] });
            }, 50);
          }
          stop() { this.onend?.(); }
        }
        window.SpeechRecognition = Recognition;
        window.webkitSpeechRecognition = Recognition;

        // Mock Firebase Auth and Functions for AI scoring
        window.__FIREBASE_INTERNAL__ = window.__FIREBASE_INTERNAL__ || {};
        window.__FIREBASE_INTERNAL__.auth = { currentUser: { uid: 'test-user', email: 'test@example.com' } };
        window.__mockScoreRTSFn = async (params) => {
          return {
            data: {
              success: true,
              overall: { total: 5, maxTotal: 6, percent: 83 },
              scores: {
                content: {
                  score: 5,
                  rationale: 'Clear and appropriate response to the situation.',
                  fixTips: ['Add a firm deadline'],
                  evidence: ['Good polite opening', 'Clear explanation']
                }
              },
              responseAnalysis: {
                register: 'Professional',
                communicationGoal: 'Address clutter in shared study space',
                strengthPoints: ['Polite tone', 'Direct approach'],
                improvementAreas: ['Set clear expectations']
              },
              sampleResponse: {
                full: 'Excuse me everyone, please remember to take personal belongings with you when leaving.',
                simplified: 'Please keep the study area tidy.'
              },
              teacherAdvice: 'Great job responding appropriately to the situation.'
            }
          };
        };
        window.firebase = {
          functions: () => ({
            httpsCallable: (name) => window.__mockScoreRTSFn
          })
        };
      });

      await page.route('**/*.{mp3,wav}*', route => route.fulfill({ contentType: 'audio/wav', body: wave() }));
      await page.goto(`${harness.baseURL}/?pteShell=v3`, { waitUntil: 'domcontentloaded' });
      await dismissOverlays(page);

      // 1. Switch to RTS mode and ensure non-guest auth
      await page.evaluate(async () => {
        sessionStorage.removeItem('guestMode');
        window.auth = { currentUser: { uid: 'test-user', email: 'test@example.com' } };
        window.__FIREBASE_INTERNAL__ = window.__FIREBASE_INTERNAL__ || {};
        window.__FIREBASE_INTERNAL__.auth = { currentUser: { uid: 'test-user', email: 'test@example.com' } };
        await window.switchToMode('rts');
      });

      // 2. Verify v3 elements rendered
      await page.waitForFunction(() => {
        return window.RTSMode?.getPtePhase?.() !== 'loading' &&
          document.getElementById('rts-pte-stage');
      }, null, { timeout: 10000 });

      assert.equal(await page.locator('.pte-modebar').count(), 1, 'exactly one v3 modebar');
      assert.equal(await page.locator('#play-rts-btn').isVisible(), false, 'legacy play button hidden in v3');
      assert.equal(await page.locator('#rts-step-progress').isVisible(), false, 'legacy progress hidden in v3');
      assert.equal(await page.locator('#rts-step-audio').isVisible(), false, 'legacy audio step hidden in v3');
      assert.equal(await page.locator('#rts-step-prep').isVisible(), false, 'legacy prep step hidden in v3');
      assert.equal(await page.locator('#rts-step-record').isVisible(), false, 'legacy record step hidden in v3');
      assert.equal(await page.locator('#rts-step-results').isVisible(), false, 'legacy results step hidden in v3');
      assert.equal(await page.locator('#rts-pte-instruction').isVisible(), true, 'PTE instruction visible');
      assert.match(await page.locator('#rts-pte-instruction').innerText(), /description of a situation/);

      // RTS has NO Filters button
      assert.equal(await page.locator('[data-pte-filter]').count(), 0, 'no filter buttons in RTS');

      // 3. Wait for flow to reach prep (after audio countdown & playback)
      await page.waitForFunction(() => {
        const ph = window.RTSMode?.getPtePhase?.();
        return ph === 'prep' || ph === 'recording';
      }, null, { timeout: 10000 });

      // If in prep phase, verify dock and countdown
      const phaseNow = await page.evaluate(() => window.RTSMode?.getPtePhase?.());
      if (phaseNow === 'prep') {
        assert.equal(await page.locator('#rts-record-btn').isVisible(), true, 'Start recording button visible in prep dock');

        // Verify "Cannot skip" dialog during prep countdown
        await page.locator('#pte-next-rts').click();
        await page.waitForFunction(() => document.querySelector('.pte-dialog'));
        assert.match(await page.locator('.pte-dialog').innerText(), /Cannot skip/, 'Cannot skip dialog shown in prep');
        await page.locator('.pte-dialog button').click(); // dismiss OK
        await page.waitForFunction(() => !document.querySelector('.pte-dialog'));

        // Manually click Start recording to skip prep countdown
        await page.locator('#rts-record-btn').click();
      }

      // 4. In recording phase:
      await page.waitForFunction(() => window.RTSMode?.getPtePhase?.() === 'recording', null, { timeout: 5000 });
      assert.equal(await page.locator('#rts-stop-btn').isVisible(), true, 'Finish recording visible in recording phase');
      assert.equal(await page.locator('#rts-cancel-btn').isVisible(), true, 'Cancel button visible in recording phase');

      // Test Cancel in recording returns to prep
      await page.locator('#rts-cancel-btn').click();
      await page.waitForFunction(() => window.RTSMode?.getPtePhase?.() === 'prep', null, { timeout: 5000 });
      assert.equal(await page.evaluate(() => window.RTSMode?.getPtePhase?.()), 'prep', 'Cancel returns to prep');

      // Click Start recording again to re-enter recording
      await page.locator('#rts-record-btn').click();
      await page.waitForFunction(() => window.RTSMode?.getPtePhase?.() === 'recording', null, { timeout: 5000 });

      // Next during recording triggers confirmation dialog
      await page.locator('#pte-next-rts').click();
      await page.waitForFunction(() => document.querySelector('.pte-dialog'));
      assert.match(await page.locator('.pte-dialog').innerText(), /Go to the next question\?/, 'Confirmation dialog on Next in recording');
      await page.locator('.pte-dialog button:has-text("Stay here")').click();
      await page.waitForFunction(() => !document.querySelector('.pte-dialog'));
      assert.equal(await page.evaluate(() => window.RTSMode?.getPtePhase?.()), 'recording', 'Stay here keeps recording');

      // 5. Finish recording advances to complete phase
      await page.locator('#rts-stop-btn').click();
      await page.waitForFunction(() => window.RTSMode?.getPtePhase?.() === 'complete', null, { timeout: 5000 });

      // In complete phase:
      assert.equal(await page.locator('#rts-submit-btn').isVisible(), true, 'Get feedback visible in complete phase');
      assert.equal(await page.locator('#rts-retry-btn').isVisible(), true, 'Record again visible in complete phase');
      assert.equal(await page.locator('#rts-play-btn').isVisible(), true, 'Play user audio button visible in complete phase');

      // Results must NOT be shown yet (gated behind Get feedback)
      assert.equal(await page.locator('#rts-pte-feedback').isVisible(), false, 'feedback hidden in complete phase');

      // Test Play user audio click
      await page.locator('#rts-play-btn').click();
      await page.waitForTimeout(200);

      // 6. Click Get feedback -> transition to feedback phase
      await page.locator('#rts-submit-btn').click();
      await page.waitForFunction(() => window.RTSMode?.getPtePhase?.() === 'feedback', null, { timeout: 8000 });

      // Feedback phase layout:
      assert.equal(await page.locator('#rts-pte-feedback').isVisible(), true, 'feedback container visible');
      assert.equal(await page.locator('#rts-redo-btn').isVisible(), true, 'Try again visible in feedback dock');
      assert.equal(await page.locator('#pte-next-rts').isVisible(), true, 'Next question button visible in feedback dock');

      // Left column: student recording playback + transcript
      assert.equal(await page.locator('#rts-v3-playback').isVisible(), true, 'student recording playback visible');
      assert.match(await page.locator('#rts-v3-transcript').innerText(), /library policy/);

      // Right column: AI Score tab & Sample answers tab
      assert.equal(await page.locator('[data-v3-tab="ai"]').isVisible(), true, 'AI score tab visible');
      assert.equal(await page.locator('[data-v3-tab="sample"]').isVisible(), true, 'Sample answers tab visible');

      // Initial AI score state: Not scored yet + Submit button
      await page.evaluate(() => {
        sessionStorage.removeItem('guestMode');
        window.auth = { currentUser: { uid: 'test-user', email: 'test@example.com' } };
        window.__FIREBASE_INTERNAL__ = window.__FIREBASE_INTERNAL__ || {};
        window.__FIREBASE_INTERNAL__.auth = { currentUser: { uid: 'test-user', email: 'test@example.com' } };
        const btn = document.getElementById('rts-ai-score-btn');
        if (btn) btn.disabled = false;
      });
      assert.equal(await page.locator('#rts-v3-ai-empty').isVisible(), true, 'Not scored yet empty state visible');
      assert.equal(await page.locator('#rts-ai-score-btn').isVisible(), true, 'Submit to AI scoring button visible');

      // 7. Submit to AI scoring
      await page.locator('#rts-ai-score-btn').click();
      await page.waitForFunction(() => {
        const results = document.getElementById('rts-v3-results-container');
        return results && results.style.display !== 'none' && results.innerText.includes('Content');
      }, null, { timeout: 8000 });

      assert.equal(await page.locator('#rts-v3-ai-empty').isVisible(), false, 'Empty state hidden after scoring');
      assert.match(await page.locator('#rts-v3-results-container').innerText(), /5\/6/, 'Score 5/6 rendered');
      assert.match(await page.locator('#rts-v3-results-container').innerText(), /Response Analysis/, 'Response Analysis rendered');

      // 8. Sample Answers tab switching
      await page.locator('[data-v3-tab="sample"]').click();
      assert.equal(await page.locator('#rts-v3-sample-panel').isVisible(), true, 'Sample panel visible');
      assert.match(await page.locator('#rts-v3-sample-full').innerText(), /Excuse me everyone/, 'Full sample visible');

      // Switch to simplified sample
      await page.locator('[data-v3-sample-tab="simplified"]').click();
      assert.equal(await page.locator('#rts-v3-sample-simplified').isVisible(), true, 'Simplified sample visible');
      assert.match(await page.locator('#rts-v3-sample-simplified').innerText(), /keep the study area tidy/, 'Simplified text visible');

      // 9. Mobile horizontal overflow check
      if (vp.width === 390) {
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
        assert.equal(overflow, true, 'mobile viewport has no horizontal overflow');
      }

      // 10. Next question advances directly without confirmation
      await page.locator('#pte-next-rts').click();
      await page.waitForFunction(() => {
        const id = window.RTSMode?.getCurrentId?.();
        return id === '2';
      }, null, { timeout: 8000 });

      assert.equal(await page.evaluate(() => window.RTSMode?.getCurrentId?.()), '2', 'advanced to question 2');

      // Screenshot for evidence
      await page.screenshot({ path: path.join(evidence, `rts-v3-${vp.name}.png`), fullPage: true });

      assert.deepEqual(errors, [], `no uncaught page errors on ${vp.name}`);
      report.push({ viewport: vp.name, status: 'passed' });
      await page.close();
    }

    // 11. Legacy mode regression test (flag = 'legacy' and default flag off)
    for (const flag of ['legacy', '']) {
      console.log(`[PTE RTS v3] Testing legacy fallback (flag='${flag}')...`);
      const page = await harness.open({ flag });
      await page.evaluate(async () => {
        await window.switchToMode('rts');
      });

      // Under legacy, v3 modebar is not present
      assert.equal(await page.locator('.pte-modebar').count(), 0, 'no v3 modebar in legacy');
      assert.equal(await page.locator('#play-rts-btn').isVisible(), true, 'legacy play button is visible');
      assert.equal(await page.locator('#rts-pte-instruction').count(), 0, 'no v3 instruction in legacy');

      report.push({ legacyFlag: flag || 'default', status: 'passed' });
      await page.close();
    }

    fs.writeFileSync(path.join(evidence, 'rts-v3-report.json'), JSON.stringify(report, null, 2));
    console.log('[PTE RTS v3] All Respond to a Situation v3 tests PASSED!');
  } catch (err) {
    console.error('[PTE RTS v3] FAILED:', err);
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
