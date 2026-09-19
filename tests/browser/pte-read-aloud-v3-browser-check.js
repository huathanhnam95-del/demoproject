'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHarness } = require('./helpers/pte-shell-harness');
const evidence = process.env.PTE_SHELL_EVIDENCE;
if (!evidence) throw new Error('PTE_SHELL_EVIDENCE must point outside the repository');

async function run() {
  fs.mkdirSync(evidence, { recursive: true });
  const harness = await createHarness();
  let passed = 0;
  const check = (name, actual, expected = true) => { assert.deepEqual(actual, expected, name); passed++; console.log(`PASS ${name}`); };
  try {
    for (const width of [1440, 390]) {
      const page = await harness.open({ width, height: width === 390 ? 844 : 900 });
      // Valid local PCM capture fixture lets the real enhancement/quality path run.
      await page.evaluate(() => {
        MediaRecorder.prototype.stop = function () {
          this.state = 'inactive';
          const sampleRate = 16000, samples = sampleRate * 2;
          const buffer = new ArrayBuffer(44 + samples * 2), view = new DataView(buffer);
          const str = (at, text) => [...text].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
          str(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); str(8, 'WAVE'); str(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); str(36, 'data'); view.setUint32(40, samples * 2, true);
          for (let i = 0; i < samples; i++) view.setInt16(44 + i * 2, Math.sin(i / sampleRate * Math.PI * 440) * 12000, true);
          const event = new Event('dataavailable'); Object.defineProperty(event, 'data', { value: new Blob([buffer], { type: 'audio/wav' }) });
          this.dispatchEvent(event); this.dispatchEvent(new Event('stop'));
        };
      });
      await page.evaluate(async () => { await window.switchToMode('read-aloud'); });
      await page.waitForFunction(() => window.ReadAloudMode?.currentPromptReady);
      await page.evaluate(() => window.ReadAloudMode.stopTimer());
      check(`${width}: v3 card`, await page.locator('#mode-read-aloud .pte-card').count(), 1);
      check(`${width}: prep`, await page.locator('.pte-card').getAttribute('data-pte-phase'), 'prep');
      check(`${width}: countdown`, await page.locator('#ra-pte-recorder .pte-rec').getAttribute('data-state'), 'countdown');
      check(`${width}: instruction`, await page.locator('#ra-pte-instruction').textContent(), await page.evaluate(() => `Look at the text below. In ${window.ReadAloudMode.prepSeconds} seconds, you must read this text aloud as naturally and clearly as possible. You have ${window.ReadAloudMode.recordSeconds} seconds to read aloud.`));
      check(`${width}: settings absent`, await page.locator('#ra-settings-sheet').count(), 0);
      await page.locator('#pte-next-read-aloud').click();
      check(`${width}: cannot skip`, await page.getByRole('alertdialog').textContent().then(t => t.includes('Cannot skip')));
      await page.getByRole('button', { name: 'OK', exact: true }).click();
      await page.locator('#ra-pte-coach-btn').click();
      check(`${width}: coach preference`, await page.evaluate(() => localStorage.getItem('bel:ra:coach-open:v1')), 'true');
      await page.screenshot({ path: path.join(evidence, `ra-${width}-prep.png`), fullPage: true });
      await page.locator('#ra-record-btn').click();
      await page.waitForFunction(() => window.ReadAloudMode.state === 'RECORDING');
      check(`${width}: recording widget`, await page.locator('#ra-pte-recorder .pte-rec').getAttribute('data-state'), 'recording');
      check(`${width}: coach hidden recording`, await page.locator('#ra-connected-speech-box').isVisible(), false);
      await page.locator('#ra-pte-cancel-btn').click();
      check(`${width}: cancel returns prep`, await page.evaluate(() => window.ReadAloudMode.state), 'PREP');
      check(`${width}: cancel discards`, await page.evaluate(() => !window.ReadAloudMode.pendingBlob));
      await page.locator('#ra-record-btn').click();
      await page.waitForFunction(() => window.ReadAloudMode.state === 'RECORDING');
      await page.screenshot({ path: path.join(evidence, `ra-${width}-recording.png`), fullPage: true });
      console.log('Recording control geometry', await page.locator('#ra-stop-btn').evaluate(el => ({ parent: el.parentElement.className, animation: getComputedStyle(el).animation, transform: getComputedStyle(el).transform, panel: document.getElementById('mode-read-aloud').className })));
      await page.locator('#ra-stop-btn').click();
      await page.waitForFunction(() => window.ReadAloudMode.state === 'RECORDED');
      check(`${width}: complete`, await page.locator('#ra-pte-recorder .pte-rec').getAttribute('data-state'), 'complete');
      check(`${width}: play in dock`, await page.locator('.pte-dock #ra-play-recording-btn').isVisible());
      await page.screenshot({ path: path.join(evidence, `ra-${width}-complete.png`), fullPage: true });
      await page.evaluate(async () => {
        const mode = window.ReadAloudMode;
        const payload = { accuracyScore: 84, fluencyScore: 78, completenessScore: 96, pronScore: 82, recognizedText: mode.currentPromptPlainText, words: [{ word: 'practice', accuracyScore: 48, startMs: 0, endMs: 400 }], connectedSpeech: { events: [], summary: {} } };
        mode.state = 'RESULTS';
        await mode.processAzureResults(payload, mode.pendingSession);
        mode.updateUIForState();
      });
      check(`${width}: feedback`, await page.locator('.pte-card').getAttribute('data-pte-phase'), 'feedback');
      check(`${width}: two-column feedback host`, await page.locator('.pte-fb').count(), 1);
      check(`${width}: actual score fields`, await page.locator('.pte-stats').textContent().then(t => ['84', '78', '96', '82'].every(n => t.includes(n))));
      check(`${width}: score labels do not overlap`, await page.locator('.pte-stats').evaluate(stats => {
        const bounds = stats.getBoundingClientRect();
        const labels = [...stats.querySelectorAll('small')].map(label => {
          const range = document.createRange();
          range.selectNodeContents(label);
          return range.getBoundingClientRect();
        });
        const inside = labels.every(rect => rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1);
        const separate = labels.every((rect, index) => labels.slice(index + 1).every(other => (
          rect.right <= other.left || other.right <= rect.left || rect.bottom <= other.top || other.bottom <= rect.top
        )));
        return inside && separate;
      }));
      check(`${width}: practice next`, await page.locator('.pte-practice-next').textContent().then(t => t.includes('practice')));
      check(`${width}: prompt replaced`, await page.locator('#ra-prompt-stage').isVisible(), false);
      await page.getByRole('tab', { name: /Coach tips/ }).click();
      await page.getByRole('tab', { name: 'Your results', exact: true }).click();
      check(`${width}: history below card`, await page.evaluate(() => !!document.querySelector('.pte-card + .pte-attempts')));
      check(`${width}: guest attempt`, await page.locator('.pte-attempts__row').count() > 0);
      check(`${width}: no horizontal overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.screenshot({ path: path.join(evidence, `ra-${width}-feedback.png`), fullPage: true });
      await page.close();
    }
    for (const flag of ['legacy', '']) {
      const page = await harness.open({ flag });
      await page.evaluate(async () => { await switchToMode('read-aloud'); });
      await page.waitForFunction(() => window.ReadAloudMode.currentPromptReady);
      check(`flag ${flag || 'default'}: legacy`, await page.locator('#mode-read-aloud .pte-card').count(), 0);
      check(`flag ${flag || 'default'}: no recorder`, await page.locator('#ra-pte-recorder').count(), 0);
      await page.close();
    }
  } finally { await harness.close(); }
  console.log(`${passed} passed, 0 failed, 0 skipped`);
}
run().catch(error => { console.error(error); process.exitCode = 1; });
