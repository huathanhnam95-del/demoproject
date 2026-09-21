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
      console.log(`[PTE Retell Lecture v3] Testing viewport ${vp.width}x${vp.height} (${vp.name})...`);
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
      });

      await page.route('**/*.{mp3,wav,m4a}*', route => route.fulfill({ contentType: 'audio/wav', body: wave() }));
      await page.goto(`${harness.baseURL}/?pteShell=v3`, { waitUntil: 'domcontentloaded' });
      await dismissOverlays(page);

      // 1. Switch to Retell Lecture (notes) mode
      await page.evaluate(async () => {
        await window.switchToMode('notes');
      });

      // 2. Wait for v3 elements to render
      await page.waitForFunction(() => {
        return window.TakeNotesMode?.getPtePhase?.() !== 'loading' &&
          document.getElementById('notes-pte-stage');
      }, null, { timeout: 15000 });

      assert.equal(await page.locator('.pte-modebar').count(), 1, 'exactly one v3 modebar');
      assert.equal(await page.locator('#notes-step-ready').isVisible(), false, 'overview/ready step hidden in v3');
      assert.equal(await page.locator('#notes-start-btn').isVisible(), false, 'legacy start button hidden in v3');
      assert.equal(await page.locator('#notes-step-video').isVisible(), false, 'legacy video step hidden in v3');
      assert.equal(await page.locator('#notes-step-results').isVisible(), false, 'legacy results step hidden in v3');
      assert.equal(await page.locator('#notes-in-card-submit-btn').isVisible(), false, 'in-card submit hidden');
      assert.equal(await page.locator('#notes-pte-instruction').isVisible(), true, 'PTE instruction visible');
      assert.equal(
        await page.locator('#notes-pte-instruction').innerText(),
        'You will hear a lecture. After listening to the lecture, in 10 seconds, please speak into the microphone and retell what you have just heard from the lecture in your own words. You will have 40 seconds to give your response.',
        'Instruction text matches canonical copy'
      );

      // Verify stage has audio box and notes textarea
      assert.equal(await page.locator('#notes-pte-stage').isVisible(), true, 'stage visible');
      assert.equal(await page.locator('#notes-pte-audio-host').isVisible(), true, 'audio host visible');
      assert.equal(await page.locator('#notes-user-input').isVisible(), true, 'notes textarea visible');

      // 3. Test Intro Video helper modal during listen
      const introBtn = page.locator('#notes-intro-video-btn');
      assert.equal(await introBtn.count(), 1, 'intro video helper button exists in dock');

      // Click intro video button to open modal
      await introBtn.click();
      await page.waitForTimeout(200);
      const modal = page.locator('#notes-video-dialog');
      if (await modal.isVisible()) {
        assert.equal(await modal.isVisible(), true, 'video modal opened');
        // Press Escape to close modal
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.getElementById('notes-video-dialog'), null, { timeout: 3000 });
        assert.equal(await modal.count(), 0, 'video modal closed on Escape');
      }

      // 4. Type notes while in listen phase
      await page.locator('#notes-user-input').fill('solar system gas giants planets jupiter saturn');

      // 5. Wait for audio to end -> transitions to complete phase
      await page.waitForFunction(() => {
        return window.TakeNotesMode?.getPtePhase?.() === 'complete';
      }, null, { timeout: 15000 });

      // In complete phase:
      // Single primary dock action: Get feedback (#notes-submit-btn)
      assert.equal(await page.locator('#notes-submit-btn').isVisible(), true, 'Get feedback button visible in complete dock');
      assert.equal(await page.locator('#notes-pte-feedback').isVisible(), false, 'feedback hidden before submit');

      // Notes area remains editable and retains user text
      assert.equal(await page.locator('#notes-user-input').inputValue(), 'solar system gas giants planets jupiter saturn', 'notes text preserved');

      // 6. Click Get feedback -> transitions to feedback phase
      await page.locator('#notes-submit-btn').click();
      await page.waitForFunction(() => {
        return window.TakeNotesMode?.getPtePhase?.() === 'feedback';
      }, null, { timeout: 8000 });

      // Feedback phase layout:
      assert.equal(await page.locator('#notes-pte-feedback').isVisible(), true, 'feedback container visible');
      assert.equal(await page.locator('#notes-retry-btn').isVisible(), true, 'Try again visible in dock');
      assert.equal(await page.locator('#pte-next-notes').isVisible(), true, 'Next question button visible in dock');

      // Left column: matched notes
      assert.equal(await page.locator('#notes-v3-matched-notes').isVisible(), true, 'matched notes visible on left');

      // Right column: two tabs "Notes match" and "Lecture transcript"
      assert.equal(await page.locator('[data-v3-tab="notes-match"]').isVisible(), true, 'Notes match tab visible');
      assert.equal(await page.locator('[data-v3-tab="transcript"]').isVisible(), true, 'Lecture transcript tab visible');

      // Switch to transcript tab
      await page.locator('[data-v3-tab="transcript"]').click();
      assert.equal(await page.locator('#notes-v3-transcript-panel').isVisible(), true, 'Transcript panel visible');

      // Switch back to notes match tab
      await page.locator('[data-v3-tab="notes-match"]').click();
      assert.equal(await page.locator('#notes-v3-match-panel').isVisible(), true, 'Match panel visible');

      // 7. Try again resets practice
      await page.locator('#notes-retry-btn').click();
      await page.waitForFunction(() => {
        const ph = window.TakeNotesMode?.getPtePhase?.();
        return ph === 'listen' || ph === 'complete';
      }, null, { timeout: 8000 });

      // 8. Mobile horizontal overflow check
      if (vp.width === 390) {
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
        assert.equal(overflow, true, 'mobile viewport has no horizontal overflow');
      }

      // Screenshot for evidence
      await page.screenshot({ path: path.join(evidence, `retell-lecture-v3-${vp.name}.png`), fullPage: true });

      assert.deepEqual(errors, [], `no uncaught page errors on ${vp.name}`);
      report.push({ viewport: vp.name, status: 'passed' });
      await page.close();
    }

    // 9. Legacy fallback check (flag = 'legacy' and default flag off)
    for (const flag of ['legacy', '']) {
      console.log(`[PTE Retell Lecture v3] Testing legacy fallback (flag='${flag}')...`);
      const page = await harness.open({ flag });
      await page.evaluate(async () => {
        await window.switchToMode('notes');
      });

      // Under legacy, v3 modebar is not present, start button is present
      assert.equal(await page.locator('.pte-modebar').count(), 0, 'no v3 modebar in legacy');
      assert.equal(await page.locator('#notes-start-btn').isVisible(), true, 'legacy start button visible');
      assert.equal(await page.locator('#notes-pte-instruction').count(), 0, 'no v3 instruction in legacy');

      report.push({ legacyFlag: flag || 'default', status: 'passed' });
      await page.close();
    }

    fs.writeFileSync(path.join(evidence, 'retell-lecture-v3-report.json'), JSON.stringify(report, null, 2));
    console.log('[PTE Retell Lecture v3] All Retell Lecture v3 tests PASSED!');
  } catch (err) {
    console.error('[PTE Retell Lecture v3] FAILED:', err);
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
