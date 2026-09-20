'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHarness, initScript, dismissOverlays } = require('./helpers/pte-shell-harness');
const evidence = process.env.PTE_SHELL_EVIDENCE;
if (!evidence) throw new Error('PTE_SHELL_EVIDENCE must be an external directory');
const sentence = 'The library opens during the examination period.';
const assessment = { success: true, pronScore: 72, fluencyScore: 80, completenessScore: 91,
  words: sentence.split(' ').map((word, i) => ({ word, accuracyScore: i === 5 ? 45 : i === 1 ? 70 : 95,
    startMs: i * 100, endMs: (i + 1) * 100, syllables: [{ text: word, accuracyScore: 70, startMs: i * 100, endMs: (i + 1) * 100, heardIpa: 'e' }] })) };
function wave() {
  const samples = 8000, b = Buffer.alloc(44 + samples * 2);
  b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(samples * 2, 40);
  return b;
}

async function exerciseCancelledCapture(page, width) {
  await page.locator('#record-btn').click();
  await page.waitForFunction(() => window.RepeatSentenceV3.phase === 'recording' && !window.RepeatSentenceV3.busy);
  const cancelledId = await page.evaluate(() => window.RepeatSentenceV3.attempt.id);
  await page.evaluate(() => {
    const enhance = window.AudioDspPipeline.enhance;
    window.__oldDspPending = false;
    window.AudioDspPipeline = { enhance: async blob => {
      window.__oldDspPending = true;
      await new Promise(resolve => { window.__releaseOldDsp = resolve; });
      window.__oldDspPending = false;
      window.AudioDspPipeline = { enhance };
      return enhance(blob);
    } };
  });
  await page.locator('#speak-pte-cancel').click();
  await page.waitForFunction(() => window.__oldDspPending);
  await page.locator('#speak-pte-cancel').click();
  // Queue the real Start control while Cancel is still draining DSP. A fixed
  // implementation makes it available only after the cancelled capture settles.
  const startClick = page.locator('#record-btn').click();
  await page.waitForFunction(id => window.RepeatSentenceV3.phase === 'recording'
    && window.RepeatSentenceV3.attempt?.id !== id, cancelledId, { timeout: 1500 }).catch(() => {});
  const beforeRelease = await page.evaluate(() => ({ phase: RepeatSentenceV3.phase, id: RepeatSentenceV3.attempt?.id }));
  await page.evaluate(() => window.__releaseOldDsp());
  await startClick;
  await page.waitForTimeout(200); // Drain the obsolete continuation, without advancing the next prep countdown.
  const afterRelease = await page.evaluate(() => ({ phase: RepeatSentenceV3.phase, id: RepeatSentenceV3.attempt?.id }));
  fs.writeFileSync(path.join(evidence, `${width}-cancel-race.json`), JSON.stringify({ cancelledId, beforeRelease, afterRelease }, null, 2));
  assert.equal(beforeRelease.id, cancelledId, 'pending Cancel must retain ownership until DSP settles');
  assert.equal(afterRelease.phase, 'recording', 'obsolete Cancel must not switch the fresh recording to PREP');
  assert.ok(afterRelease.id && afterRelease.id !== cancelledId, 'Start creates exactly one fresh attempt');
  await page.locator('#speak-pte-stop').click();
  await page.waitForFunction(() => window.RepeatSentenceV3.phase === 'complete' && !window.RepeatSentenceV3.busy);
  assert.deepEqual(await page.evaluate(() => window.__saves.map(item => item.attemptId)), [afterRelease.id], 'only the fresh capture is saved');
  assert.equal(await page.evaluate(() => window.__dsp), 2, 'both captures finish through DSP');
}

async function finishAndAssess(page) {
  await page.waitForFunction(() => window.RepeatSentenceV3.phase === 'recording' && !window.RepeatSentenceV3.busy
    && document.getElementById('transcription-text').textContent.includes('library'));
  await page.locator('#speak-pte-stop').click();
  await page.waitForFunction(() => window.RepeatSentenceV3.phase === 'complete' && !window.RepeatSentenceV3.busy);
  await page.locator('#check-btn-speak').click();
  await page.waitForFunction(() => window.RepeatSentenceV3.phase === 'feedback' && !window.RepeatSentenceV3.busy);
  if (await page.locator('#vocab-skip-btn').isVisible()) await page.locator('#vocab-skip-btn').click();
}

async function exerciseListenBackRetry(page, width) {
  await page.locator('#record-btn').click();
  await finishAndAssess(page);
  await page.locator('#speak-pte-original').click();
  const original = await page.evaluate(() => {
    const audio = document.getElementById('speak-pte-playback');
    window.__playedSources = [];
    audio.addEventListener('play', () => window.__playedSources.push(audio.currentSrc));
    return { src: audio.src, label: audio.getAttribute('aria-label'),
      selected: document.getElementById('speak-pte-original').getAttribute('aria-pressed'),
      yours: document.getElementById('speak-pte-yours').getAttribute('aria-pressed') };
  });
  assert.equal(original.selected, 'true');
  assert.equal(original.yours, 'false');
  assert.equal(original.label, 'Original sentence');
  assert.match(original.src, /\/database\/speak\/audio\//);
  await page.locator('#speak-pte-playback').click({ position: { x: 20, y: 20 } });
  await page.waitForFunction(() => window.__playedSources.length > 0);
  assert.deepEqual(await page.evaluate(() => window.__playedSources), [original.src]);
  await page.locator('#retry-btn-speak').click();
  await page.waitForFunction(() => window.RepeatSentenceV3.phase === 'prep');
  await page.locator('#record-btn').click();
  await finishAndAssess(page);
  const state = await page.evaluate(() => {
    const audio = document.getElementById('speak-pte-playback');
    window.__playedSources = [];
    return { yours: document.getElementById('speak-pte-yours').getAttribute('aria-pressed'),
      original: document.getElementById('speak-pte-original').getAttribute('aria-pressed'),
      label: audio.getAttribute('aria-label'), src: audio.src, recordingUrl: window.RepeatSentenceV3.attempt.url };
  });
  fs.writeFileSync(path.join(evidence, `${width}-listen-back-retry.json`), JSON.stringify({ original, state }, null, 2));
  assert.equal(state.yours, 'true', 'new capture selects Your recording');
  assert.equal(state.original, 'false', 'Original sentence selection is cleared with the source change');
  assert.equal(state.src, state.recordingUrl);
  assert.equal(state.label, 'Your recording');
  // Use the Chrome native audio play control, not a direct player method.
  await page.locator('#speak-pte-playback').click({ position: { x: 20, y: 20 } });
  await page.waitForFunction(() => window.__playedSources.length > 0);
  assert.deepEqual(await page.evaluate(() => window.__playedSources), [state.recordingUrl]);
}

async function run() {
  fs.mkdirSync(evidence, { recursive: true });
  const harness = await createHarness(); const report = [], failures = [];
  const scenarios = process.argv.includes('--cancel-race-only') ? ['cancel']
    : process.argv.includes('--listen-back-only') ? ['listen']
      : process.argv.includes('--replay-start-only') ? ['full'] : ['full', 'cancel', 'listen'];
  try {
    for (const scenario of scenarios) for (const width of [1440, 390]) {
      const page = await harness.browser.newPage({ viewport: { width, height: width === 390 ? 844 : 900 } });
      const errors = []; page.on('pageerror', e => errors.push(e.stack));
      await page.addInitScript(initScript);
      await page.addInitScript(() => {
        sessionStorage.setItem('welcomeModalSeen', 'true');
        class Recognition {
          start() { this.onstart?.(); setTimeout(() => {
            const result = [{ transcript: 'The library opens during the exam period.' }]; result.isFinal = true;
            this.onresult?.({ resultIndex: 0, results: [result] });
          }, 30); }
          stop() { this.onend?.(); }
        }
        window.SpeechRecognition = Recognition; window.webkitSpeechRecognition = Recognition;
        Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => {
          const ctx = new AudioContext(); return ctx.createMediaStreamDestination().stream;
        } } });
      });
      await page.route('**/database/speak/index.json*', route => route.fulfill({ json: { items: [1, 2, 3].map(id => ({ id, audioFile: `${id}.mp3`, correctSentence: sentence, level: 1 })) } }));
      await page.route('**/*.{mp3,wav}*', route => route.fulfill({ contentType: 'audio/wav', body: wave() }));
      await page.route('**/api/**', route => route.fulfill({ json: route.request().url().includes('repeat-sentence/assess') ? assessment : {} }));
      await page.goto(`${harness.baseURL}/?pteShell=v3`, { waitUntil: 'domcontentloaded' });
      await dismissOverlays(page);
      await page.evaluate(bytes => {
        window.__saves = []; window.__patches = []; window.__dsp = 0;
        window.AudioDspPipeline = { enhance: async () => { window.__dsp++; return { wavBlob: new Blob([Uint8Array.from(bytes)], { type: 'audio/wav' }) }; } };
        window.PTEAttemptArchive.saveAttempt = async input => { window.__saves.push({ ...input, media: input.media.map(m => ({ slot: m.slot, size: m.blob.size })) }); return window.__persistedFixture ? { attemptId: input.attemptId } : { skipped: true, reason: 'guest' }; };
        window.PTEAttemptArchive.patchAttempt = async (id, input) => {
          window.__patches.push({ id, input });
          if (window.__failPatch) { window.__failPatch = false; throw new Error('Fixture patch failed'); }
          return { attemptId: id };
        };
        window.PTEAttemptArchive.fetchUserAttemptsCached = async () => null;
      }, [...wave()]);
      if (process.argv.includes('--replay-start-only')) await page.clock.install();
      await page.evaluate(async () => { await window.switchToMode('speak'); });
      assert.equal(await page.locator('#mode-speak .pte-card').count(), 1, 'Repeat Sentence must mount its v3 card');
      await page.waitForFunction(() => window.RepeatSentenceV3.phase === 'listen');
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: path.join(evidence, `${width}-listen.png`), fullPage: true });
      await page.waitForFunction(() => window.RepeatSentenceV3.phase === 'prep').catch(async error => { console.log(await page.evaluate(() => ({ phase: RepeatSentenceV3.phase, status: document.querySelector('#mode-speak .pte-dock__status')?.textContent, audio: [...document.querySelectorAll('audio')].map(a => ({id:a.id,src:a.currentSrc,paused:a.paused,error:a.error?.message})), errors: [] }))); console.log(errors); throw error; });
      assert.equal(await page.evaluate(() => window.speakReplayCount || 0), 0, 'automatic first play does not spend replay');
      assert.equal(await page.locator('#transcription-display').isVisible(), false);
      if (scenario !== 'full') {
        try {
          if (scenario === 'cancel') await exerciseCancelledCapture(page, width);
          else await exerciseListenBackRetry(page, width);
          assert.deepEqual(errors, [], 'review regressions produce no JavaScript errors');
          report.push({ scenario, width, passed: true });
        } catch (error) { failures.push(`${scenario} ${width}: ${error.message}`); report.push({ scenario, width, passed: false, error: error.message }); }
        await page.close();
        continue;
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: path.join(evidence, `${width}-prep.png`), fullPage: true });
      if (process.argv.includes('--replay-start-only')) {
        await page.clock.pauseAt(new Date());
        await page.evaluate(() => {
          document.getElementById('speak-pte-replay').click();
          document.getElementById('record-btn').click();
        });
        await page.clock.runFor(200);
        await page.waitForFunction(() => window.RepeatSentenceV3.phase === 'recording');
        await page.clock.runFor(15100);
        await page.waitForFunction(() => window.RepeatSentenceV3.phase === 'complete', null, { timeout: 2000 }).catch(async error => {
          console.log(await page.evaluate(() => ({ phase: RepeatSentenceV3.phase, busy: !!RepeatSentenceV3.busy,
            elapsed: Date.now() - RepeatSentenceV3.attempt?.started, generation: RepeatSentenceV3.generation,
            replaying: RepeatSentenceV3.replaying, recorder: document.querySelector('#speak-pte-recorder')?.textContent,
            status: document.querySelector('#mode-speak .pte-dock__status')?.textContent, dsp: window.__dsp })));
          throw error;
        });
        assert.equal(await page.evaluate(() => window.speakReplayCount), 1);
        assert.deepEqual(errors, []);
        console.log('Replay interrupted by Start preserves recording auto-stop: PASS');
        return;
      }
      await page.waitForFunction(() => window.RepeatSentenceV3.phase === 'recording');
      assert.equal(await page.locator('#shadow-mode-btn').isVisible(), false);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: path.join(evidence, `${width}-recording.png`), fullPage: true });
      await page.waitForFunction(() => window.RepeatSentenceV3.phase === 'complete', null, { timeout: 20000 });
      await page.waitForFunction(() => !window.RepeatSentenceV3.busy);
      assert.equal(await page.evaluate(() => window.__dsp), 1, 'auto-stop enhances capture');
      assert.equal(await page.evaluate(() => window.__saves.length), 1, 'auto-stop archives capture');
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: path.join(evidence, `${width}-complete.png`), fullPage: true });
      await page.evaluate(() => { const original = window.DifficultyManager; window.DifficultyManager = { ...original, getCurrentSettings: mode => ({ ...original.getCurrentSettings(mode), maxReplays: 2 }) }; });
      for (let count = 1; count <= 2; count++) {
        await page.locator('#speak-pte-replay').click();
        await page.waitForFunction(() => !window.RepeatSentenceV3.replaying);
        assert.equal(await page.evaluate(() => window.speakReplayCount), count);
      }
      assert.equal(await page.locator('#speak-pte-replay').isDisabled(), true, 'replay exhausted');
      await page.locator('#check-btn-speak').click();
      await page.waitForFunction(() => window.RepeatSentenceV3.phase === 'feedback' && !window.RepeatSentenceV3.busy);
      assert.equal(await page.locator('#speak-pte-sentence .speak-word-token').count(), 7);
      assert.equal(await page.locator('#speak-pte-sentence .speak-word-token--error').count(), 1);
      assert.match(await page.locator('#speak-pte-results .pte-stats').innerText(), /72%/);
      assert.equal(await page.evaluate(() => window.__saves.length), 2, 'feedback updates the archived attempt');
      assert.equal(await page.evaluate(() => window.__saves[0].attemptId === window.__saves[1].attemptId), true);
      if (await page.locator('#vocab-skip-btn').isVisible()) await page.locator('#vocab-skip-btn').click();
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: path.join(evidence, `${width}-feedback.png`), fullPage: true });
      await page.locator('#speak-pte-practice-tab').click();
      assert.equal(await page.locator('#speak-pte-practice').isVisible(), true);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: path.join(evidence, `${width}-practice.png`), fullPage: true });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no horizontal overflow');
      if (width === 1440) assert.ok(await page.locator('#mode-speak .pte-card').evaluate(el => el.getBoundingClientRect().height) <= 740, 'feedback fits height target');
      await page.clock.install(); await page.clock.pauseAt(new Date());
      await page.locator('#retry-btn-speak').click();
      await page.waitForFunction(() => window.RepeatSentenceV3.phase === 'prep');
      assert.equal(await page.locator('#transcription-display').isVisible(), false);
      assert.equal(await page.locator('#speak-pte-replay').isDisabled(), true, 'retry preserves replay limit');
      await page.evaluate(() => {
        window.__shadowUses = 0; window.__locked = 0; window.__persistedFixture = true;
        window.shopModule = { ...window.shopModule, showAlertModal() { window.__locked++; } };
        window.useActiveSkillForAttempt = async () => { window.__shadowUses++; return { success: true }; };
        document.getElementById('shadow-mode-btn').classList.add('locked');
      });
      await page.locator('#shadow-mode-btn').click();
      assert.equal(await page.evaluate(() => window.isShadowModeActive), false, 'locked Shadow remains off');
      assert.equal(await page.evaluate(() => window.__shadowUses), 0);
      await page.evaluate(() => document.getElementById('shadow-mode-btn').classList.remove('locked'));
      await page.locator('#shadow-mode-btn').focus(); await page.keyboard.press('Enter');
      assert.equal(await page.locator('#shadow-mode-btn').getAttribute('aria-pressed'), 'true');
      assert.equal(await page.evaluate(() => window.__shadowUses), 1, 'existing Shadow skill handler is adopted');
      await page.locator('#pte-next-speak').click();
      assert.match(await page.locator('.pte-dialog').innerText(), /Cannot skip/);
      await page.locator('.pte-dialog button').click();
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.clock.runFor(3300);
      await page.waitForFunction(() => window.RepeatSentenceV3.phase === 'recording');
      assert.equal(await page.locator('.pte-rec__ring--rec i').evaluate(el => getComputedStyle(el).animationName), 'none');
      await page.locator('#speak-pte-stop').click();
      await page.waitForFunction(() => window.RepeatSentenceV3.phase === 'complete' && !window.RepeatSentenceV3.busy);
      await page.locator('#pte-next-speak').click();
      assert.match(await page.locator('.pte-dialog').innerText(), /Go to the next question/);
      await page.locator('.pte-dialog button').first().click();
      await page.evaluate(() => { window.__failPatch = true; });
      await page.locator('#check-btn-speak').click();
      await page.waitForFunction(() => window.RepeatSentenceV3.phase === 'feedback' && !window.RepeatSentenceV3.busy);
      if (await page.locator('#vocab-skip-btn').isVisible()) await page.locator('#vocab-skip-btn').click();
      assert.equal(await page.evaluate(() => window.__patches.length), 1, 'assessment patches saved capture');
      assert.match(await page.locator('#mode-speak .pte-dock__status').innerText(), /could not be saved/);
      assert.equal(await page.locator('#current-question-id-speak').textContent(), '1', 'failed archive patch preserves current prompt');
      await page.locator('#pte-next-speak').click();
      await page.waitForFunction(() => document.getElementById('current-question-id-speak').textContent === '2');
      assert.equal(await page.evaluate(() => window.__patches.length), 2, 'Next retries the failed assessed save');
      assert.equal(await page.evaluate(() => window.__patches[0].id === window.__patches[1].id), true, 'save retry retains attempt identity');
      assert.equal(await page.evaluate(() => window.speakReplayCount || 0), 0, 'new question resets replay budget');
      await page.locator('#mode-speak .spc-picker-prev').click();
      await page.locator('.pte-dialog button').last().click();
      await page.waitForFunction(() => document.getElementById('current-question-id-speak').textContent === '1');
      assert.ok(await page.locator('#mode-speak .pte-attempts__row').count() >= 1, 'history survives navigation');
      await page.evaluate(() => window.SpeakingPracticeController.unmount('speak'));
      assert.equal(await page.locator('#mode-speak #result').count(), 0, 'shared result restored');
      assert.equal(await page.locator('#speak-pte-view').count(), 0);
      assert.deepEqual(errors, [], 'no new JavaScript errors');
      report.push({ width, errors }); await page.close();
    }
    for (const flag of scenarios.includes('full') ? ['legacy', ''] : []) {
      const page = await harness.open({ flag });
      await page.evaluate(async () => { await window.switchToMode('speak'); });
      assert.equal(await page.locator('#mode-speak .pte-card').count(), 0, 'flag off stays legacy');
      assert.equal(await page.locator('#transcription-display').isVisible(), true);
      assert.equal(await page.locator('#mode-speak .speak-audio').isVisible(), true);
      report.push({ flag: flag || 'default', legacy: 'passed' }); await page.close();
    }
    fs.writeFileSync(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
    assert.deepEqual(failures, [], 'review regressions must pass at both widths');
  } finally { await harness.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
