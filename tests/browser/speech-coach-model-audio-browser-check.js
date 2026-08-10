/* eslint-disable no-console */
const assert = require('assert');
const express = require('express');
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const app = express();
  const readyEvent = (eventId, hexCharacter) => {
    const assetId = String(hexCharacter).repeat(64);
    return ({
    eventId,
    assetId,
    status: 'ready',
    file: `/database/RA/speech-coach-audio/v1/clips/${assetId.slice(0, 2)}/${assetId}.mp3`,
    durationMs: 800,
    mp3Sha256: 'a'.repeat(64)
    });
  };
  app.get('/database/RA/speech-coach-audio/v1/questions/731.json', (_req, res) => {
    res.json({
      version: 'sc-kokoro-v1',
      questionId: '731',
      events: {
        'q-731-weak_form_reduction-0-1': readyEvent('q-731-weak_form_reduction-0-1', 'a'),
        'q-731-catenation-3-4': readyEvent('q-731-catenation-3-4', 'b'),
        'q-731-n_bilabial_assimilation-5-6': readyEvent('q-731-n_bilabial_assimilation-5-6', 'c'),
        'q-731-yod_coalescence-7-8': readyEvent('q-731-yod_coalescence-7-8', 'd')
      }
    });
  });
  app.get('/database/RA/speech-coach-audio/v1/questions/998.json', (_req, res) => {
    res.json({
      version: 'stale-contract',
      questionId: '998',
      events: {
        'q-998-catenation-0-1': readyEvent('q-998-catenation-0-1', 'e')
      }
    });
  });
  app.get('/database/RA/speech-coach-audio/v1/questions/997.json', (_req, res) => {
    res.json({
      version: 'sc-kokoro-v1',
      questionId: '997',
      events: {
        'q-997-catenation-0-1': { ...readyEvent('wrong-event-id', 'f'), file: 'javascript:alert(1)', mp3Sha256: 'bad' }
      }
    });
  });
  app.use(express.static(path.join(__dirname, '../../public')));
  const server = await new Promise((resolve) => {
    const value = app.listen(0, '127.0.0.1', () => resolve(value));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  await page.addInitScript(() => {
    sessionStorage.setItem('onboarding_complete', 'true');
    sessionStorage.setItem('user_scope', 'pte');
    window.__modelAudioState = { playCalls: 0, pauseCalls: 0 };
    class FakeAudio {
      constructor() {
        this.paused = true;
        this.currentTime = 0;
        this.src = '';
        this.listeners = {};
      }
      addEventListener(name, handler) { (this.listeners[name] ||= []).push(handler); }
      removeAttribute(name) { if (name === 'src') this.src = ''; }
      load() {}
      play() { this.paused = false; window.__modelAudioState.playCalls += 1; return Promise.resolve(); }
      pause() { this.paused = true; window.__modelAudioState.pauseCalls += 1; }
    }
    window.Audio = FakeAudio;
    HTMLMediaElement.prototype.play = function play() { this.paused = false; return Promise.resolve(); };
    HTMLMediaElement.prototype.pause = function pause() { this.paused = true; };
  });

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    if (typeof switchToMode === 'function') switchToMode('read-aloud');
  });
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    const ra = window.ReadAloudMode || window.currentPracticeModeInstance;
    ra.currentQuestionId = '731';
    ra.currentPromptPlainText = 'The cold storage structures are ready.';
    ra.assessmentAudioBuffer = { duration: 2 };
    ra.wordPlaybackContext = {
      state: 'running',
      destination: {},
      createBufferSource() {
        return { connect() {}, start() {}, stop() {}, onended: null };
      }
    };
  });

  await page.evaluate(() => {
    const ra = window.ReadAloudMode || window.currentPracticeModeInstance;
    ra.speechCoachAudioManifestCache.delete('731');
    ra.speechCoachAudioManifestPromises.delete('731');
    ra.currentGuideExplanationItems = [
      {
        id: 'boundary-5',
        category: 'sound_changes',
        layer: 'assimilation',
        subtype: 'n_bilabial_assimilation',
        startWordIndex: 5,
        endWordIndex: 6,
        label: 'in mathematics',
        badge: 'Sound change',
        explanation: 'Blend the final n toward m.'
      },
      {
        id: 'weak-the',
        category: 'weak_forms',
        layer: 'weak_forms',
        label: 'the',
        badge: 'Reduced word',
        strongAs: '/ðiː/',
        spokenAs: '/ðə/ or /ði/',
        explanation: 'Keep this function word light in connected speech.'
      }
    ];
    ra.currentGuideHasVisibleAssimilation = true;
    ra.connectedSpeechPanelMode = 'guide';
    ra.selectedGuideItemId = 'boundary-5';
    ra.renderConnectedSpeechGuidePanel();
  });
  await page.waitForSelector('.sc-model-play-btn:not(:disabled)');
  const guide = await page.evaluate(() => {
    const model = document.querySelector('.sc-model-play-btn:not(:disabled)');
    const list = document.getElementById('ra-connected-speech-list');
    const cards = Array.from(document.querySelectorAll('[data-guide-item]'));
    const cardRects = cards.map((card) => {
      const rect = card.getBoundingClientRect();
      return { left: rect.left, right: rect.right };
    });
    const listRect = list?.getBoundingClientRect();
    return {
      modelInsideGuideItem: Boolean(model?.closest('[data-guide-item]')),
      nestedInteractiveControl: Boolean(model?.parentElement?.closest('button')),
      modelCount: document.querySelectorAll('.sc-model-play-btn:not(:disabled)').length,
      horizontalGap: cardRects.length > 1 ? cardRects[1].left - cardRects[0].right : null,
      cardsStayInsideList: Boolean(listRect && cardRects.every((rect) => rect.left >= listRect.left && rect.right <= listRect.right + 0.5))
    };
  });
  assert.strictEqual(guide.modelCount, 1);
  assert.strictEqual(guide.modelInsideGuideItem, true, 'Model must remain inside its guide item after HTML parsing');
  assert.strictEqual(guide.nestedInteractiveControl, false, 'guide playback must not nest a button inside another button');
  assert.ok(guide.horizontalGap >= 8, `guide cards must not overlap; measured gap ${guide.horizontalGap}px`);
  assert.strictEqual(guide.cardsStayInsideList, true, 'guide cards must stay within the Speech Coach list');

  await page.evaluate(() => document.querySelector('.sc-model-play-btn:not(:disabled)')?.click());
  await page.waitForTimeout(0);
  const guidePlayback = await page.evaluate(() => ({ ...window.__modelAudioState }));
  assert.strictEqual(guidePlayback.playCalls, 1, 'preview Model control must play before assessment results exist');

  const result = await page.evaluate(async () => {
    const ra = window.ReadAloudMode || window.currentPracticeModeInstance;
    await ra.renderConnectedSpeechResults({
      status: 'available',
      summary: { detectedCount: 1, notDetectedCount: 1, uncertainCount: 0 },
      events: [
        { eventId: 'q-731-weak_form_reduction-0-1', phrase: 'The', family: 'weak_form_reduction', category: 'weak_forms', status: 'detected', startMs: 100, endMs: 350, feedbackText: 'Good weak form.' },
        { eventId: 'q-731-catenation-3-4', phrase: 'structures are', family: 'catenation', category: 'linking', status: 'not_detected', startMs: 500, endMs: 900, feedbackText: 'Link these words.' }
        ,{ eventId: 'q-731-n_bilabial_assimilation-5-6', phrase: 'in mathematics', family: 'n_bilabial_assimilation', category: 'sound_changes', status: 'not_detected', startMs: 950, endMs: 1200, feedbackText: 'Let n blend toward m.' }
        ,{ eventId: 'q-731-yod_coalescence-7-8', phrase: 'did you', family: 'yod_coalescence', category: 'sound_changes', status: 'uncertain', startMs: 1250, endMs: 1500, feedbackText: 'Try this boundary again.' }
      ]
    }, { transcriptText: 'The cold storage structures are ready.', sessionViewMode: 'advanced' });
    return {
      currentQuestionId: ra.currentQuestionId,
      cachedManifest: ra.speechCoachAudioManifestCache?.get('731') || null,
      modelButtons: document.querySelectorAll('.sc-model-play-btn').length,
      readyModelButtons: document.querySelectorAll('.sc-model-play-btn:not(:disabled)').length,
      unavailableModelButtons: document.querySelectorAll('.sc-model-play-btn:disabled').length,
      yoursButtons: document.querySelectorAll('.sc-play-word-btn').length,
      labels: Array.from(document.querySelectorAll('.sc-audio-btn span')).map((node) => node.textContent.trim()),
      soundChangeSection: Array.from(document.querySelectorAll('.sc-section-header')).some((node) => node.textContent.includes('Sound Changes')),
      uncertainSoundChangeUsesWarningStyle: Boolean(document.querySelector('.sc-sound-change-actions .sc-badge--uncertain'))
    };
  });
  console.log('DOM result:', JSON.stringify(result));

  assert.strictEqual(result.modelButtons, 4);
  assert.strictEqual(result.readyModelButtons, 4);
  assert.strictEqual(result.unavailableModelButtons, 0);
  assert.strictEqual(result.yoursButtons, 4);
  assert.strictEqual(result.soundChangeSection, true);
  assert.strictEqual(result.uncertainSoundChangeUsesWarningStyle, true);
  assert.ok(result.labels.includes('Model'));
  assert.ok(result.labels.includes('Yours'));

  await page.evaluate(() => document.querySelector('.sc-model-play-btn')?.click());
  await page.waitForTimeout(0);
  const afterModel = await page.evaluate(() => ({ ...window.__modelAudioState }));
  console.log('after model:', JSON.stringify(afterModel));
  assert.strictEqual(afterModel.playCalls, 2);

  const modelStoppedState = await page.evaluate(() => {
    const button = document.querySelector('.sc-model-play-btn');
    button?.click();
    return { label: button?.querySelector('span')?.textContent, ariaLabel: button?.getAttribute('aria-label') };
  });
  assert.deepStrictEqual(modelStoppedState, { label: 'Model', ariaLabel: 'Play model pronunciation' });

  await page.evaluate(() => {
    const ra = window.ReadAloudMode || window.currentPracticeModeInstance;
    ra.userRecordingUrl = 'blob:recording';
    const audio = document.getElementById('ra-user-recording-audio');
    if (audio) audio.src = 'blob:recording';
  });
  await page.evaluate(() => document.querySelector('.sc-play-word-btn')?.click());
  await page.waitForTimeout(0);
  const yoursPlayingState = await page.evaluate(() => {
    const button = document.querySelector('.sc-play-word-btn');
    return { label: button?.querySelector('span')?.textContent, ariaLabel: button?.getAttribute('aria-label') };
  });
  assert.deepStrictEqual(yoursPlayingState, { label: 'Stop yours', ariaLabel: 'Stop your recording segment' });
  const afterYours = await page.evaluate(() => ({ ...window.__modelAudioState }));
  assert.ok(afterYours.pauseCalls >= 1, 'starting Yours must stop Model');

  const missingManifest = await page.evaluate(async () => {
    const ra = window.ReadAloudMode || window.currentPracticeModeInstance;
    ra.currentQuestionId = '999';
    await ra.renderConnectedSpeechResults({
      status: 'available',
      summary: { detectedCount: 0, notDetectedCount: 1, uncertainCount: 0 },
      events: [{ eventId: 'q-999-catenation-0-1', phrase: 'missing audio', family: 'catenation', status: 'not_detected', startMs: 1, endMs: 2 }]
    }, { transcriptText: 'Missing audio', sessionViewMode: 'advanced' });
    return document.querySelectorAll('.sc-model-play-btn:disabled').length;
  });
  assert.strictEqual(missingManifest, 1, 'missing manifest must disable Model playback');

  for (const questionId of ['998', '997']) {
    const unavailable = await page.evaluate(async (id) => {
      const ra = window.ReadAloudMode || window.currentPracticeModeInstance;
      ra.currentQuestionId = id;
      await ra.renderConnectedSpeechResults({
        status: 'available',
        summary: { detectedCount: 0, notDetectedCount: 1, uncertainCount: 0 },
        events: [{ eventId: `q-${id}-catenation-0-1`, phrase: 'invalid audio', family: 'catenation', status: 'not_detected', startMs: 1, endMs: 2 }]
      }, { transcriptText: 'Invalid audio', sessionViewMode: 'advanced' });
      return document.querySelectorAll('.sc-model-play-btn:disabled').length;
    }, questionId);
    assert.strictEqual(unavailable, 1, `${questionId} manifest must not expose invalid Model playback`);
  }

  console.log('Speech Coach model audio browser check passed:', JSON.stringify(result));
  await browser.close();
  server.close();
})().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
