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
function wave(sample = 0) {
  const samples = 8000, b = Buffer.alloc(44 + samples * 2);
  b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(samples * 2, 40);
  for (let i = 44; i < b.length; i += 2) b.writeInt16LE(sample, i);
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
  if (!await page.locator('#second-take-overlay').isVisible() && await page.locator('#vocab-skip-btn').isVisible()) await page.locator('#vocab-skip-btn').click();
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

async function leaveAndReturn(page) {
  await page.getByRole('button', { name: 'Back to dashboard', exact: true }).click();
  await page.waitForFunction(() => !window.RepeatSentenceV3.active);
  await page.locator('#mode-btn-speak').click();
  await page.waitForFunction(() => window.RepeatSentenceV3.active);
}

async function exercisePlaybackDeparture(page, width, transition) {
  await page.locator('#record-btn').click();
  await finishAndAssess(page);
  await page.locator('#speak-pte-original').click();
  await page.evaluate(() => {
    window.__departingPlayer = document.getElementById('speak-pte-playback');
    window.__departingPlayer.loop = true;
  });
  await page.locator('#speak-pte-playback').click({ position: { x: 20, y: 20 } });
  await page.waitForFunction(() => !__departingPlayer.paused && __departingPlayer.currentTime > 0);
  if (transition === 'next') await page.locator('#pte-next-speak').click();
  else if (transition === 'retry') await page.locator('#retry-btn-speak').click();
  else await page.getByRole('button', { name: 'Back to dashboard', exact: true }).click();
  if (transition === 'next') await page.waitForFunction(() => document.getElementById('current-question-id-speak').textContent === '2');
  else await page.waitForFunction(leaving => leaving ? !RepeatSentenceV3.active : RepeatSentenceV3.phase === 'prep', transition === 'unmount');
  const state = await page.evaluate(() => ({ paused: __departingPlayer.paused, time: __departingPlayer.currentTime }));
  fs.writeFileSync(path.join(evidence, `${width}-playback-${transition}.json`), JSON.stringify(state));
  assert.equal(state.paused, true, 'departing listen-back actually stops playing');
  assert.equal(state.time, 0, 'departing listen-back resets to the start');
}

async function exerciseSecondTake(page, width, outcome) {
  await page.evaluate(() => {
    window.auth = { currentUser: { uid: 'skill-fixture' } };
    window.shopModule = { ...window.shopModule, isSkillUnlocked: id => id === 'second_take' };
    window.__skillCalls = [];
    window.callUseActiveSkill = input => {
      window.__skillCalls.push(input);
      return new Promise((resolve, reject) => {
        window.__resolveSecondTake = success => resolve({ success, cost: 10 });
        window.__rejectSecondTake = () => reject(new Error('Second Take fixture failed'));
      });
    };
  });
  await page.locator('#record-btn').click();
  await finishAndAssess(page);
  const oldId = await page.evaluate(() => RepeatSentenceV3.attempt.id);
  await page.evaluate(() => { window.__secondTakeButton = document.getElementById('second-take-yes'); });
  await page.locator('#second-take-yes').click();
  await page.waitForFunction(() => !!window.__resolveSecondTake);
  if (await page.locator('#vocab-skip-btn').isVisible()) await page.locator('#vocab-skip-btn').click();
  // A queued duplicate event must not spend the skill twice, even on a detached control.
  if (outcome === 'repeated') await page.evaluate(() => window.__secondTakeButton.click());
  assert.equal(await page.evaluate(() => __skillCalls.length), 1, 'one skill request per offered retry');
  if (outcome === 'next') {
    await page.locator('#pte-next-speak').click();
    await page.waitForFunction(() => document.getElementById('current-question-id-speak').textContent === '2'
      && RepeatSentenceV3.phase === 'prep');
  } else if (outcome === 'unmount' || outcome === 'unmount-reject') {
    await leaveAndReturn(page);
    await page.waitForFunction(() => RepeatSentenceV3.phase === 'prep');
  }
  else if (outcome === 'retry' || outcome === 'recording') {
    await page.locator('#retry-btn-speak').click();
    await page.waitForFunction(() => RepeatSentenceV3.phase === 'prep');
    if (outcome === 'recording') {
      await page.locator('#record-btn').click();
      await page.waitForFunction(() => RepeatSentenceV3.phase === 'recording' && !RepeatSentenceV3.busy);
    }
  }
  const before = await page.evaluate(() => ({ generation: RepeatSentenceV3.generation, id: RepeatSentenceV3.attempt?.id,
    context: JSON.stringify(window.currentAttemptContext) }));
  await page.evaluate(outcome => outcome.includes('reject') ? __rejectSecondTake() : __resolveSecondTake(outcome !== 'failure'), outcome);
  await page.waitForTimeout(100);
  if (outcome === 'success' || outcome === 'repeated') {
    assert.equal(await page.evaluate(() => RepeatSentenceV3.phase), 'prep', 'successful Second Take uses v3 Retry');
    assert.equal(await page.locator('#speak-pte-recorder').isVisible(), true);
    assert.equal(await page.locator('#record-btn').isVisible(), true);
    await page.locator('#record-btn').click();
    await page.waitForFunction(() => RepeatSentenceV3.phase === 'recording' && !RepeatSentenceV3.busy);
    assert.notEqual(await page.evaluate(() => RepeatSentenceV3.attempt.id), oldId);
    if (outcome === 'repeated') {
      await finishAndAssess(page);
      await page.locator('#second-take-yes').click();
      await page.waitForFunction(() => __skillCalls.length === 2);
      if (await page.locator('#vocab-skip-btn').isVisible()) await page.locator('#vocab-skip-btn').click();
      await page.evaluate(() => __resolveSecondTake(true));
      await page.waitForFunction(() => RepeatSentenceV3.phase === 'prep');
      assert.equal(await page.locator('#record-btn').isVisible(), true, 'subsequent Second Take remains usable');
    }
  } else if (outcome === 'failure' || outcome === 'reject') {
    assert.equal(await page.evaluate(() => RepeatSentenceV3.phase), 'feedback');
    assert.equal(await page.evaluate(() => RepeatSentenceV3.attempt.id), oldId);
    assert.equal(await page.locator('#retry-btn-speak').isVisible(), true);
    await page.locator('#retry-btn-speak').click();
    await page.waitForFunction(() => RepeatSentenceV3.phase === 'prep');
  } else {
    const after = await page.evaluate(() => ({ generation: RepeatSentenceV3.generation, id: RepeatSentenceV3.attempt?.id,
      context: JSON.stringify(window.currentAttemptContext) }));
    assert.deepEqual(after, before, 'stale skill result cannot reset a new lifecycle, recording or assist context');
  }
  fs.writeFileSync(path.join(evidence, `${width}-second-take-${outcome}.json`), JSON.stringify({ oldId, before,
    after: await page.evaluate(() => ({ phase: RepeatSentenceV3.phase, calls: __skillCalls, generation: RepeatSentenceV3.generation })) }, null, 2));
}

async function exerciseAssessedPublication(page, width, flow) {
  await page.evaluate(flow => {
    Object.assign(window.PTEAttemptArchive, window.__nativeArchive);
    window.auth = { currentUser: flow === 'guest' ? null : { uid: 'publication-fixture', getIdToken: async () => 'local-fixture' } };
    window.firebase.storage = () => ({ ref: () => ({ put: async () => {} }) });
    window.__publication = { events: [], local: [], refreshes: 0, writes: [] };
    const originalFetch = window.fetch, persisted = new Map();
    window.fetch = async (url, options = {}) => {
      const pathname = new URL(url, location.href).pathname;
      if (!pathname.startsWith('/api/practice-attempts')) return originalFetch(url, options);
      const respond = (data, ok = true) => new Response(JSON.stringify({ success: ok, data, message: 'Capture save failed' }),
        { status: ok ? 200 : 503, headers: { 'Content-Type': 'application/json' } });
      if (!options.method || options.method === 'GET') return respond({ attempts: [...persisted.values()] });
      const input = JSON.parse(options.body);
      if (pathname.endsWith('/prepare')) return respond({ attemptId: input.attemptId,
        mediaSlots: input.mediaSlots.map(slot => ({ ...slot, storagePath: `fixture/${slot.slotFile}` })) });
      const id = input.attemptId || decodeURIComponent(pathname.split('/').at(-2));
      __publication.writes.push({ method: options.method, id });
      if (flow === 'native' && !input.resultSnapshot) return respond(null, false);
      persisted.set(id, { ...persisted.get(id), ...input, attemptId: id });
      return respond({ attemptId: id });
    };
    const fetchHistory = PTEAttemptArchive.fetchUserAttemptsCached;
    PTEAttemptArchive.fetchUserAttemptsCached = (...args) => { __publication.refreshes++; return fetchHistory(...args); };
    const local = PteAttemptHistory.recordLocal;
    PteAttemptHistory.recordLocal = input => { __publication.local.push(input.attemptId); return local(input); };
    window.addEventListener('pte-attempt-archive:saved', event => __publication.events.push(event.detail.attemptId));
  }, flow);
  await page.locator('#record-btn').click();
  await page.waitForFunction(() => RepeatSentenceV3.phase === 'recording' && !RepeatSentenceV3.busy
    && document.getElementById('transcription-text').textContent.includes('library'));
  await page.locator('#speak-pte-stop').click();
  await page.waitForFunction(() => RepeatSentenceV3.phase === 'complete' && !RepeatSentenceV3.busy);
  await page.waitForTimeout(100);
  await page.evaluate(() => { __publication.events.length = 0; __publication.local.length = 0; __publication.refreshes = 0; });
  await page.locator('#check-btn-speak').click();
  await page.waitForFunction(() => RepeatSentenceV3.phase === 'feedback' && !RepeatSentenceV3.busy);
  await page.waitForTimeout(100);
  const state = await page.evaluate(() => ({ ...__publication, id: RepeatSentenceV3.attempt.id,
    rows: document.querySelectorAll('#mode-speak .pte-attempts__row').length,
    score: document.querySelector('#mode-speak .pte-attempts__scores')?.textContent }));
  fs.writeFileSync(path.join(evidence, `${width}-publication-${flow}.json`), JSON.stringify(state, null, 2));
  assert.deepEqual(state.events, flow === 'guest' ? [] : [state.id], 'assessed save publishes exactly once');
  assert.deepEqual(state.local, flow === 'guest' ? [state.id] : [], 'guest feedback has one local publication');
  assert.equal(state.refreshes, 1, 'one history refresh per assessed save');
  assert.equal(state.rows, 1, 'history keeps one attempt through assessment/recovery');
  assert.match(state.score, /\d/, 'history displays assessed scores');
  if (flow !== 'guest') assert.equal(state.writes.at(-1).method, flow === 'patch' ? 'PATCH' : 'POST');
}

async function exerciseDeparture(page, width, ordering) {
  const uploads = [];
  await page.route('**/api/repeat-sentence/assess', route => {
    const body = route.request().postDataBuffer(), wavOffset = body.indexOf('RIFF');
    assert.ok(wavOffset >= 0, 'assessment uploads a WAV');
    uploads.push(body.readInt16LE(wavOffset + 44));
    return route.fulfill({ json: assessment });
  });
  await page.evaluate(({ oldWave, newWave }) => {
    window.__captureCalls = 0; window.__archiveAudio = [];
    window.AudioDspPipeline = { enhance: async () => {
      const capture = ++window.__captureCalls;
      if (capture === 1) await new Promise(resolve => { window.__releaseDeparture = resolve; });
      return { wavBlob: new Blob([Uint8Array.from(capture === 1 ? oldWave : newWave)], { type: 'audio/wav' }) };
    } };
    const save = window.PTEAttemptArchive.saveAttempt;
    window.PTEAttemptArchive.saveAttempt = async input => {
      window.__archiveAudio.push({ id: input.attemptId,
        sample: new DataView(await input.media[0].blob.arrayBuffer()).getInt16(44, true) });
      return save(input);
    };
  }, { oldWave: [...wave(4096)], newWave: [...wave(8192)] });
  if (ordering === 'start') await page.evaluate(() => {
    const getUserMedia = navigator.mediaDevices.getUserMedia;
    navigator.mediaDevices.getUserMedia = async (...args) => {
      await new Promise(resolve => { window.__releaseMicrophone = resolve; });
      navigator.mediaDevices.getUserMedia = getUserMedia;
      return getUserMedia(...args);
    };
  });
  await page.locator('#record-btn').click();
  if (ordering === 'start') await page.waitForFunction(() => !!window.__releaseMicrophone);
  else await page.waitForFunction(() => RepeatSentenceV3.phase === 'recording' && !RepeatSentenceV3.busy);
  const oldId = await page.evaluate(() => RepeatSentenceV3.attempt?.id || null);
  if (ordering === 'navigation') {
    await page.locator('#pte-next-speak').click();
    await page.locator('.pte-dialog button').last().click();
    await page.waitForFunction(() => !!window.__releaseDeparture);
  }
  await leaveAndReturn(page);
  if (ordering === 'start') await page.evaluate(() => window.__releaseMicrophone());
  await page.waitForFunction(() => !!window.__releaseDeparture);
  await leaveAndReturn(page); // Repeated remounts must retain the same departure barrier.
  let startedBeforeRelease = false;
  if (ordering === 'last') {
    startedBeforeRelease = await page.waitForFunction(() => RepeatSentenceV3.phase === 'prep', null, { timeout: 5000 }).then(() => true, () => false);
    if (startedBeforeRelease) {
      await page.locator('#record-btn').click();
      await page.waitForFunction(() => RepeatSentenceV3.phase === 'recording' && !RepeatSentenceV3.busy
        && document.getElementById('transcription-text').textContent.includes('library'));
      await page.locator('#speak-pte-stop').click();
      await page.waitForFunction(() => RepeatSentenceV3.phase === 'complete' && !RepeatSentenceV3.busy);
    }
  }
  await page.evaluate(() => window.__releaseDeparture());
  if (!startedBeforeRelease) {
    await page.waitForFunction(() => RepeatSentenceV3.phase === 'prep');
    await page.locator('#record-btn').click();
    await page.waitForFunction(() => RepeatSentenceV3.phase === 'recording' && !RepeatSentenceV3.busy
      && document.getElementById('transcription-text').textContent.includes('library'));
    await page.locator('#speak-pte-stop').click();
    await page.waitForFunction(() => RepeatSentenceV3.phase === 'complete' && !RepeatSentenceV3.busy);
  }
  await page.locator('#check-btn-speak').click();
  await page.waitForFunction(() => RepeatSentenceV3.phase === 'feedback' && !RepeatSentenceV3.busy);
  const state = await page.evaluate(async () => ({ id: RepeatSentenceV3.attempt.id,
    prompt: document.getElementById('current-question-id-speak').textContent,
    wav: new DataView(await window.repeatSentenceWavBlob.arrayBuffer()).getInt16(44, true),
    decoded: window.repeatSentenceAudioBuffer.getChannelData(0)[Math.floor(window.repeatSentenceAudioBuffer.length / 2)], archive: window.__archiveAudio }));
  fs.writeFileSync(path.join(evidence, `${width}-departure-${ordering}.json`), JSON.stringify({ oldId, startedBeforeRelease, uploads, state }, null, 2));
  assert.deepEqual(uploads, [8192], 'assessment must upload the current capture, not departed DSP output');
  assert.equal(state.wav, 8192);
  // Chrome resamples 16 kHz into the device-rate context; tolerate its filter
  // ripple while distinguishing the current 0.25 sample from the departed 0.125.
  assert.ok(Math.abs(state.decoded - 0.25) < 0.001, 'decoded buffer belongs to the current capture');
  assert.notEqual(state.id, oldId);
  assert.ok(state.archive.length >= 2 && state.archive.every(item => item.id === state.id && item.sample === 8192), 'archive and assessment use the same current audio');
  assert.equal(state.prompt, '1', 'departed navigation must not change the remounted question');
  assert.equal(startedBeforeRelease, false, 'new capture waits for departure DSP to settle');
}

async function exerciseShadow(page, width, outcome) {
  await page.evaluate(() => {
    window.__shadowSpeech = []; window.__shadowUtterances = []; window.__shadowCancels = 0;
    window.speechSynthesis.speak = utterance => { window.__shadowUtterances.push(utterance); window.__shadowSpeech.push(utterance.text); };
    window.speechSynthesis.cancel = () => { window.__shadowCancels++; };
    document.getElementById('shadow-mode-btn').classList.remove('locked');
    window.useActiveSkillForAttempt = () => new Promise((resolve, reject) => {
      window.__resolveShadow = () => resolve({ success: true });
      window.__rejectShadow = () => reject(new Error('Deferred Shadow activation failed'));
    });
  });
  await page.locator('#shadow-mode-btn').click();
  await page.waitForFunction(() => !!window.__resolveShadow);
  if (outcome.startsWith('active-')) {
    await page.evaluate(() => window.__resolveShadow());
    await page.waitForFunction(() => window.__shadowSpeech.length === 1);
    const cancels = await page.evaluate(() => window.__shadowCancels);
    if (outcome === 'active-unmount') await leaveAndReturn(page);
    else if (outcome === 'active-navigation') {
      await page.locator('#pte-next-speak').click();
      await page.locator('.pte-dialog button').click();
    } else {
      await page.locator('#record-btn').click();
      await page.waitForFunction(() => RepeatSentenceV3.phase === 'recording' && !RepeatSentenceV3.busy);
    }
    const stopped = await page.evaluate(() => ({ cancels: window.__shadowCancels, active: window.isShadowModeActive,
      pressed: document.getElementById('shadow-mode-btn').getAttribute('aria-pressed') }));
    assert.ok(stopped.cancels > cancels, 'leaving Shadow must cancel ongoing synthesis');
    assert.equal(stopped.active, false); assert.equal(stopped.pressed, 'false');
    await page.evaluate(() => window.__shadowUtterances[0].onend?.());
    assert.equal(await page.locator('#shadow-mode-btn').getAttribute('title'), 'Shadow Mode', 'obsolete speech completion cannot update the current controls');
    return;
  }
  if (outcome.startsWith('unmount')) await leaveAndReturn(page);
  else {
    await page.locator('#record-btn').click();
    await page.waitForFunction(() => RepeatSentenceV3.phase === 'recording' && !RepeatSentenceV3.busy);
    if (outcome === 'retry') {
      await page.locator('#speak-pte-cancel').click();
      await page.waitForFunction(() => RepeatSentenceV3.phase === 'prep');
    }
    if (outcome === 'navigation') {
      await page.locator('#pte-next-speak').click();
      await page.locator('.pte-dialog button').last().click();
      await page.waitForFunction(() => document.getElementById('current-question-id-speak').textContent === '2');
    }
  }
  await page.evaluate(reject => reject ? window.__rejectShadow() : window.__resolveShadow(), outcome.includes('reject'));
  await page.waitForTimeout(100); // Flush the activation continuation and possible unhandled rejection.
  const stale = await page.evaluate(() => ({ speech: window.__shadowSpeech, active: window.isShadowModeActive,
    pressed: document.getElementById('shadow-mode-btn').getAttribute('aria-pressed'), title: document.getElementById('shadow-mode-btn').title }));
  fs.writeFileSync(path.join(evidence, `${width}-shadow-${outcome}.json`), JSON.stringify(stale, null, 2));
  assert.deepEqual(stale.speech, [], 'stale Shadow activation must never speak');
  assert.equal(stale.active, false); assert.equal(stale.pressed, 'false');
  assert.notEqual(stale.title, 'Shadowing... speak along!');
}

async function exerciseArchiveOwnership(page, width, scenario) {
  const [stage, transition, outcome] = scenario.split('-');
  await page.evaluate(stage => {
    // Keep the real archive client, its publication boundary and history listener.
    // Only authentication, Storage and HTTP are local deterministic fixtures.
    Object.assign(window.PTEAttemptArchive, window.__nativeArchive);
    window.auth = { currentUser: { uid: 'native-archive-fixture', getIdToken: async () => 'local-fixture-token' } };
    window.firebase.storage = () => ({ ref: () => ({ put: async () => {} }) });
    window.__archiveTrace = { calls: [], local: [], events: [], errors: [], invalidations: 0, historyReads: 0 };
    const stamp = () => ({ generation: RepeatSentenceV3.generation, id: RepeatSentenceV3.attempt?.id,
      question: document.getElementById('current-question-id-speak').textContent });
    const recordLocal = window.PteAttemptHistory.recordLocal;
    window.PteAttemptHistory.recordLocal = input => {
      window.__archiveTrace.local.push({ ...stamp(), savedId: input.attemptId }); return recordLocal(input);
    };
    window.addEventListener('pte-attempt-archive:saved', event => window.__archiveTrace.events.push({ ...stamp(), savedId: event.detail.attemptId }));
    const invalidate = window.PTEAttemptArchive.invalidateHistoryCache;
    window.PTEAttemptArchive.invalidateHistoryCache = () => { window.__archiveTrace.invalidations++; invalidate(); };
    const setSaveError = window.SpeakingPracticeController.setSaveError;
    window.SpeakingPracticeController.setSaveError = (mode, message) => {
      window.__archiveTrace.errors.push({ ...stamp(), message }); return setSaveError(mode, message);
    };
    const originalFetch = window.fetch;
    const persisted = new Map();
    let first = true;
    window.fetch = async (url, options = {}) => {
      const path = new URL(url, location.href).pathname;
      if (!path.startsWith('/api/practice-attempts')) return originalFetch(url, options);
      const respond = (data, ok = true) => new Response(JSON.stringify(ok ? { success: true, data }
        : { success: false, message: 'Deferred archive save failed' }), { status: ok ? 200 : 503, headers: { 'Content-Type': 'application/json' } });
      if (!options.method || options.method === 'GET') {
        window.__archiveTrace.historyReads++;
        return respond({ attempts: [...persisted.values()] });
      }
      const input = JSON.parse(options.body);
      if (path.endsWith('/prepare')) return respond({ attemptId: input.attemptId,
        mediaSlots: input.mediaSlots.map(slot => ({ ...slot, storagePath: `fixture/${input.attemptId}/${slot.slotFile}` })) });
      const patch = options.method === 'PATCH';
      const attemptId = input.attemptId || decodeURIComponent(path.split('/').at(-2));
      if (patch === (stage === 'assessed')) {
        window.__archiveTrace.calls.push({ ...stamp(), attemptId });
        if (first) {
          first = false; window.__heldAttempt = RepeatSentenceV3.attempt;
          const rejected = await new Promise(resolve => {
            window.__resolveArchive = () => resolve(false);
            window.__rejectArchive = () => resolve(true);
          });
          if (rejected) return respond(null, false);
        }
      }
      persisted.set(attemptId, { ...persisted.get(attemptId), ...input, attemptId });
      return respond({ attemptId });
    };
  }, stage);
  await page.locator('#record-btn').click();
  await page.waitForFunction(() => RepeatSentenceV3.phase === 'recording' && !RepeatSentenceV3.busy
    && document.getElementById('transcription-text').textContent.includes('library'));
  const originalId = await page.evaluate(() => RepeatSentenceV3.attempt.id);
  const originalQuestion = await page.locator('#current-question-id-speak').textContent();
  await page.locator('#speak-pte-stop').click();
  if (stage === 'assessed') {
    await page.waitForFunction(() => RepeatSentenceV3.phase === 'complete' && !RepeatSentenceV3.busy);
    await page.waitForFunction(() => document.querySelectorAll('#mode-speak .pte-attempts__row').length === 1);
    // The owned raw-save event is legitimate; isolate subsequent assessed publication.
    await page.evaluate(() => { window.__archiveTrace.events.length = 0; });
    await page.locator('#check-btn-speak').click();
  }
  await page.waitForFunction(() => !!window.__resolveArchive);
  if (await page.locator('#vocab-skip-btn').isVisible()) await page.locator('#vocab-skip-btn').click();
  const held = await page.evaluate(() => ({ generation: RepeatSentenceV3.generation, phase: RepeatSentenceV3.phase,
    rows: document.querySelectorAll('#mode-speak .pte-attempts__row').length }));
  async function next() {
    await page.locator('#pte-next-speak').click();
    if (await page.locator('.pte-dialog').isVisible()) await page.locator('.pte-dialog button').last().click();
  }
  if (transition === 'leave') await leaveAndReturn(page);
  else if (transition === 'retry') await page.locator('#retry-btn-speak').click();
  else if (transition === 'navigation') await next();
  assert.equal(await page.locator('#current-question-id-speak').textContent(), originalQuestion, 'pending save cannot navigate early');
  const historyReads = await page.evaluate(() => window.__archiveTrace.historyReads);
  await page.evaluate(reject => reject ? window.__rejectArchive() : window.__resolveArchive(), outcome === 'reject');
  await page.waitForFunction(() => !RepeatSentenceV3.busy && !RepeatSentenceV3.retryOperation && !RepeatSentenceV3.departureCleanup);
  await page.waitForTimeout(100); // Let the real event listener finish any history refresh.
  if (transition === 'leave' || transition === 'retry') {
    await page.waitForFunction(() => RepeatSentenceV3.phase === 'prep');
    const state = await page.evaluate(() => ({ phase: RepeatSentenceV3.phase, attempt: RepeatSentenceV3.attempt,
      generation: RepeatSentenceV3.generation, status: document.querySelector('#mode-speak .pte-dock__status').textContent,
      heldSaved: !!window.__heldAttempt.saved, trace: window.__archiveTrace,
      rows: document.querySelectorAll('#mode-speak .pte-attempts__row').length }));
    fs.writeFileSync(path.join(evidence, `${width}-archive-${scenario}.json`), JSON.stringify(state, null, 2));
    assert.equal(state.attempt, null); assert.doesNotMatch(state.status, /could not be saved|Deferred archive/);
    assert.ok(state.trace.errors.filter(item => item.message).every(item => item.generation === held.generation), 'no stale save error can be written into the new lifecycle');
    if (transition === 'leave') {
      assert.equal(state.heldSaved, false, 'stale success must not mark the abandoned attempt saved');
      assert.equal(state.trace.local.length, 0); assert.equal(state.trace.events.length, 0);
      assert.equal(state.trace.invalidations, 0); assert.equal(state.rows, held.rows);
      assert.equal(state.trace.historyReads, historyReads, 'departed settlement must not refresh the new lifecycle history');
    } else {
      assert.equal(state.trace.calls.length, 2, 'Retry revalidates saving under its new lifecycle');
      assert.equal(state.trace.calls[1].generation, state.generation);
      assert.ok(state.trace.calls.every(call => call.attemptId === originalId), 'Retry retains the idempotent archive identity');
      const publications = [...state.trace.local, ...state.trace.events];
      assert.equal(publications.length, 1, 'Retry publishes only its owned recovery save');
      assert.equal(publications[0].generation, state.generation);
      assert.equal(publications[0].savedId, originalId);
    }
    await page.locator('#record-btn').click();
    await page.waitForFunction(() => RepeatSentenceV3.phase === 'recording' && !RepeatSentenceV3.busy);
    assert.notEqual(await page.evaluate(() => RepeatSentenceV3.attempt.id), originalId);
    return;
  }
  if (outcome === 'reject') {
    assert.equal(await page.locator('#current-question-id-speak').textContent(), originalQuestion);
    assert.match(await page.locator('#mode-speak .pte-dock__status').innerText(), /could not be saved|Deferred archive/);
    assert.equal(await page.evaluate(() => RepeatSentenceV3.attempt.id), originalId, 'current failure retains the recoverable attempt');
    await next();
  } else if (transition === 'recovery') await next();
  await page.waitForFunction(question => document.getElementById('current-question-id-speak').textContent !== question, originalQuestion);
  await page.waitForFunction(() => RepeatSentenceV3.phase === 'prep');
  const state = await page.evaluate(() => ({ phase: RepeatSentenceV3.phase, attempt: RepeatSentenceV3.attempt,
    question: document.getElementById('current-question-id-speak').textContent,
    status: document.querySelector('#mode-speak .pte-dock__status').textContent, trace: window.__archiveTrace,
    rows: document.querySelectorAll('#mode-speak .pte-attempts__row').length }));
  fs.writeFileSync(path.join(evidence, `${width}-archive-${scenario}.json`), JSON.stringify(state, null, 2));
  assert.equal(state.question, '2', 'exactly one intended question navigation completes');
  assert.equal(state.attempt, null); assert.doesNotMatch(state.status, /could not be saved|Deferred archive/);
  assert.equal(state.rows, 0, 'old prompt history must not appear under the new question');
  assert.ok(state.trace.calls.every(call => call.attemptId === originalId), 'recovery preserves archive identity');
  assert.equal(state.trace.calls.length, outcome === 'reject' ? 2 : 1, 'only the intended save and explicit recovery run');
  assert.equal([...state.trace.local, ...state.trace.events].length, 1, 'save/recovery publishes once');
}

async function exerciseFilters(page, width) {
  await page.locator('#record-btn').click();
  await finishAndAssess(page);
  await page.clock.install(); await page.clock.pauseAt(new Date());
  const trigger = page.locator('#mode-speak .pte-modebar').getByRole('button', { name: 'Filters', exact: true });
  assert.equal(await trigger.isVisible(), true, 'Phase 3.8 exposes Filters');
  await trigger.click();
  const menu = page.getByRole('dialog', { name: 'Filters', exact: true });
  assert.deepEqual(await menu.locator('legend').allTextContents(), ['Question order', 'Status', 'Length', 'Difficulty']);
  assert.equal(await menu.evaluate(el => {
    const rect = el.getBoundingClientRect();
    return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight;
  }), true, 'Filters stay within the viewport');
  const group = name => menu.getByRole('group', { name, exact: true });
  await group('Question order').getByRole('button', { name: 'Manual', exact: true }).click();
  assert.equal(await page.locator('#manual-speak').isChecked(), true);
  assert.equal(await page.evaluate(() => DifficultyManager.getGlobalSettings().autoAdjustEnabled), false);
  const before = await page.locator('#current-question-id-speak').textContent();
  assert.equal(await page.locator('#recommended-btn-speak').isDisabled(), false);
  await group('Question order').getByRole('button', { name: 'Recommended', exact: true }).click();
  await page.waitForFunction(previous => document.getElementById('current-question-id-speak').textContent !== previous, before);
  assert.equal(await page.locator('#adaptive-speak').isChecked(), true);
  assert.equal(await page.evaluate(() => DifficultyManager.getGlobalSettings().autoAdjustEnabled), true);
  assert.equal(await group('Question order').getByRole('button', { name: 'Recommended', exact: true }).getAttribute('aria-pressed'), 'true');
  await group('Question order').getByRole('button', { name: 'Manual', exact: true }).click();
  const status = group('Status');
  await status.getByRole('button', { name: 'Completed', exact: true }).click();
  assert.equal(await page.locator('#question-select-speak option').count(), 0, 'existing status handler filters local fixtures');
  assert.deepEqual(await page.locator('#status-filter-menu-speak .selected').evaluateAll(els => els.map(el => el.dataset.value)), ['completed']);
  await status.getByRole('button', { name: 'All', exact: true }).click();
  assert.equal(await page.locator('#question-select-speak option').count(), 3);
  await page.evaluate(() => {
    window.__filterLocks = 0;
    window.shopModule = { ...window.shopModule, showAlertModal: () => { window.__filterLocks++; } };
    for (const key of ['length', 'difficulty']) document.getElementById(`${key}-filter-container-speak`).style.display = 'none';
  });
  await group('Length').getByRole('button', { name: '4-7 words', exact: true }).click();
  await group('Difficulty').getByRole('button', { name: 'Level 2 (Medium)', exact: true }).click();
  assert.equal(await page.evaluate(() => window.__filterLocks), 2);
  assert.equal(await group('Length').getByRole('button', { name: 'All lengths', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal(await group('Difficulty').getByRole('button', { name: 'Recommended', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.evaluate(() => {
    for (const key of ['length', 'difficulty']) document.getElementById(`${key}-filter-container-speak`).style.display = 'block';
    document.querySelector('#length-filter-menu-speak [data-value="4-7"]').dataset.locked = 'false';
  });
  await group('Length').getByRole('button', { name: '4-7 words', exact: true }).click();
  assert.equal(await page.locator('#length-filter-menu-speak .selected').getAttribute('data-value'), '4-7');
  await group('Length').getByRole('button', { name: 'All lengths', exact: true }).click();
  await group('Difficulty').getByRole('button', { name: 'Level 2 (Medium)', exact: true }).click();
  assert.equal(await page.locator('#question-select-speak option').count(), 0, 'existing difficulty handler filters level-one fixtures');
  assert.equal(await page.locator('#difficulty-filter-menu-speak .selected').getAttribute('data-value'), '2');
  await group('Difficulty').getByRole('button', { name: 'Recommended', exact: true }).click();
  assert.equal(await page.locator('#question-select-speak option').count(), 3);
  await page.screenshot({ path: path.join(evidence, `${width}-filters.png`), fullPage: true });
  await page.keyboard.press('Escape');
  assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(await trigger.evaluate(el => el === document.activeElement), true);
  await trigger.click();
  await page.mouse.click(2, 2);
  assert.equal(await menu.count(), 0, 'outside click closes Filters');
  await page.evaluate(() => {
    window.__resetCalls = []; window.__resetConfirmed = false;
    window.showCustomConfirm = async (...args) => { window.__resetPrompt = args; return window.__resetConfirmed; };
    window.authUI.getCurrentUserId = () => 'local-reset-fixture';
    window.firebaseFirestoreFunctions = { ...window.firebaseFirestoreFunctions,
      resetProgress: async (...args) => { window.__resetCalls.push(args); return { success: true }; } };
  });
  const openReset = async () => {
    await page.locator('#mode-speak .pte-modebar').getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('dialog', { name: 'More', exact: true }).getByRole('button', { name: /Reset progress/ }).click();
  };
  await openReset();
  assert.equal(await page.evaluate(() => window.__resetCalls.length), 0, 'cancel keeps progress');
  assert.match(await page.evaluate(() => window.__resetPrompt[0]), /Reset Progress/);
  await page.evaluate(() => { window.__resetConfirmed = true; });
  await openReset();
  await page.waitForFunction(() => window.__resetCalls.length === 1);
  assert.deepEqual(await page.evaluate(() => window.__resetCalls[0]), ['local-reset-fixture', Number(await page.locator('#current-question-id-speak').textContent()), 'speak']);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
}

async function exerciseHistorySummary(page, width) {
  await page.clock.install(); await page.clock.pauseAt(new Date());
  await page.evaluate(() => {
    const promptId = document.getElementById('current-question-id-speak').textContent;
    // Same shape as buildAttemptSummary: no resultSnapshot and no maxScore.
    window.PTEAttemptArchive.fetchUserAttemptsCached = async () => [6, 0, null].map((score, index) => ({
      attemptId: `summary-${index}`, practiceMode: 'speak', promptId,
      createdAt: new Date(Date.now() - index * 1000).toISOString(), score,
      audio: { studentUrl: null, durationMs: 15000 }, responseSummary: 'Local summary fixture'
    }));
    window.dispatchEvent(new CustomEvent('auth-state-changed'));
  });
  await page.waitForFunction(() => document.querySelectorAll('#mode-speak .pte-attempts__row').length === 3);
  assert.deepEqual(await page.locator('#mode-speak .pte-attempts__score').allTextContents(), ['Points 6', 'Points 0']);
  assert.equal(await page.locator('#mode-speak .pte-attempts__row').last().locator('.pte-attempts__score').count(), 0);
  await page.screenshot({ path: path.join(evidence, `${width}-history-summary.png`), fullPage: true });
  await page.evaluate(() => {
    window.PTEAttemptArchive.fetchUserAttemptsCached = async () => null;
    window.PteAttemptHistory.recordLocal({ attemptId: 'snapshot-fixture', practiceMode: 'speak',
      promptId: document.getElementById('current-question-id-speak').textContent, resultSnapshot: { score: 0, maxScore: 7 } });
  });
  await page.waitForFunction(() => document.querySelector('#mode-speak .pte-attempts__score')?.textContent === 'Points 0/7');
}

async function run() {
  fs.mkdirSync(evidence, { recursive: true });
  const harness = await createHarness(); const report = [], failures = [];
  const ownershipScenarios = ['departure-first', 'departure-last', 'departure-navigation', 'departure-start',
    'shadow-resolve', 'shadow-reject', 'shadow-retry', 'shadow-navigation', 'shadow-unmount', 'shadow-unmount-reject',
    'shadow-active-start', 'shadow-active-unmount', 'shadow-active-navigation'];
  const selectedScenario = process.argv.find(arg => arg.startsWith('--scenario='))?.slice(11);
  const archiveScenarios = ['raw', 'assessed'].flatMap(stage =>
    ['leave', 'navigation', 'retry'].flatMap(transition => ['reject', 'success'].map(outcome => `archive-${stage}-${transition}-${outcome}`))
      .concat(`archive-${stage}-recovery-reject`, `archive-${stage}-recovery-success`));
  const remediationScenarios = ['next', 'retry', 'unmount'].map(s => `playback-${s}`)
    .concat(['success', 'failure', 'reject', 'next', 'retry', 'recording', 'unmount', 'unmount-reject', 'repeated'].map(s => `second-${s}`),
      ['native', 'patch', 'guest'].map(s => `publication-${s}`));
  const scenarios = selectedScenario ? [selectedScenario] : process.argv.includes('--save-only') ? archiveScenarios
    : process.argv.includes('--spec-only') ? ['spec-filters', 'spec-history']
    : process.argv.includes('--remediation-only') ? remediationScenarios
    : process.argv.includes('--ownership-only') ? ownershipScenarios
    : process.argv.includes('--departure-only') ? ownershipScenarios.filter(s => s.startsWith('departure'))
    : process.argv.includes('--shadow-only') ? ownershipScenarios.filter(s => s.startsWith('shadow'))
    : process.argv.includes('--cancel-race-only') ? ['cancel']
    : process.argv.includes('--listen-back-only') ? ['listen']
      : process.argv.includes('--replay-start-only') ? ['full'] : ['full', 'cancel', 'listen', 'spec-filters', 'spec-history', ...ownershipScenarios, ...archiveScenarios, ...remediationScenarios];
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
        window.__nativeArchive = { saveAttempt: window.PTEAttemptArchive.saveAttempt,
          patchAttempt: window.PTEAttemptArchive.patchAttempt, fetchUserAttemptsCached: window.PTEAttemptArchive.fetchUserAttemptsCached };
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
          else if (scenario.startsWith('departure-')) await exerciseDeparture(page, width, scenario.slice(10));
          else if (scenario.startsWith('shadow-')) await exerciseShadow(page, width, scenario.slice(7));
          else if (scenario.startsWith('archive-')) await exerciseArchiveOwnership(page, width, scenario.slice(8));
          else if (scenario.startsWith('playback-')) await exercisePlaybackDeparture(page, width, scenario.slice(9));
          else if (scenario.startsWith('second-')) await exerciseSecondTake(page, width, scenario.slice(7));
          else if (scenario.startsWith('publication-')) await exerciseAssessedPublication(page, width, scenario.slice(12));
          else if (scenario === 'spec-filters') await exerciseFilters(page, width);
          else if (scenario === 'spec-history') await exerciseHistorySummary(page, width);
          else await exerciseListenBackRetry(page, width);
          assert.deepEqual(errors, [], 'review regressions produce no JavaScript errors');
          report.push({ scenario, width, passed: true });
        } catch (error) {
          failures.push(`${scenario} ${width}: ${error.message}`); report.push({ scenario, width, passed: false, error: error.message });
          console.error(scenario, width, error.stack);
          await page.screenshot({ path: path.join(evidence, `${width}-${scenario}-failure.png`), fullPage: true });
        }
        console.log(JSON.stringify(report.at(-1)));
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
