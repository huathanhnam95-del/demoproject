'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHarness } = require('./helpers/pte-shell-harness');
const evidence = process.env.PTE_SHELL_EVIDENCE;
const retrySessionVariant = process.argv.includes('--retry-session-invalidation');
if (!evidence) throw new Error('PTE_SHELL_EVIDENCE must point outside the repository');

async function exerciseWordPopover(page, item, options = {}) {
  await page.evaluate(({ guideItem, linkingIpa, withModelAudio }) => {
    const mode = window.ReadAloudMode;
    const stage = document.getElementById('ra-prompt-stage');
    mode.cancelPendingHydration();
    const target = stage.querySelector('[data-guide-target]') || document.createElement('button');
    const createdTarget = !target.isConnected;
    const oldGuideTarget = target.getAttribute('data-guide-target');
    const oldSubtype = target.getAttribute('data-sound-change-subtype');
    if (createdTarget) {
      target.type = 'button';
      target.textContent = guideItem.label;
      stage.append(target);
    }
    target.dataset.guideTarget = guideItem.id;
    if (guideItem.subtype) target.dataset.soundChangeSubtype = guideItem.subtype;
    window.__ptePopoverRestore = {
      items: mode.currentGuideExplanationItems,
      interactionItems: mode.currentGuideInteractionItems,
      panelMode: mode.connectedSpeechPanelMode,
      questionId: mode.currentQuestionId,
      target,
      createdTarget,
      oldGuideTarget,
      oldSubtype
    };
    mode.currentGuideExplanationItems = [guideItem];
    mode.connectedSpeechPanelMode = 'guide';
    mode.currentQuestionId = '1';
    if (linkingIpa) {
      Object.entries(linkingIpa).forEach(([word, ipa]) => mode.sharedLinkingPronunciations.set(word, ipa));
    }
    if (withModelAudio) {
      const eventId = 'q-1-consonant_to_vowel-0-1';
      const hash = 'a'.repeat(64);
      const file = `/database/RA/speech-coach-audio/v1/clips/aa/${hash}.mp3`;
      mode.speechCoachAudioManifestCache.set('1', {
        version: 'sc-kokoro-v1', questionId: '1', events: {
          [eventId]: { status: 'ready', eventId, assetId: 'browser-fixture', durationMs: 900, mp3Sha256: hash, file }
        }
      });
      window.__pteExpectedModelSrc = file;
    }
    mode.showSoundChangeTooltip(guideItem.id, target, { pinned: true });
  }, { guideItem: item, linkingIpa: options.linkingIpa || null, withModelAudio: !!options.withModelAudio });
}

async function restoreWordPopover(page) {
  await page.evaluate(() => {
    const mode = window.ReadAloudMode;
    const restore = window.__ptePopoverRestore;
    mode.hideSoundChangeTooltip();
    if (restore) {
      mode.currentGuideExplanationItems = restore.items;
      mode.currentGuideInteractionItems = restore.interactionItems;
      mode.connectedSpeechPanelMode = restore.panelMode;
      mode.currentQuestionId = restore.questionId;
      if (restore.createdTarget) {
        restore.target?.remove();
      } else if (restore.target) {
        if (restore.oldGuideTarget === null) restore.target.removeAttribute('data-guide-target');
        else restore.target.setAttribute('data-guide-target', restore.oldGuideTarget);
        if (restore.oldSubtype === null) restore.target.removeAttribute('data-sound-change-subtype');
        else restore.target.setAttribute('data-sound-change-subtype', restore.oldSubtype);
      }
    }
    delete window.__ptePopoverRestore;
    mode.renderPromptForCurrentView();
  });
}

async function exerciseAssessedNext(page, width, check, retryDuringNext = false) {
  const referenceText = await page.evaluate(() => {
    const mode = window.ReadAloudMode;
    mode.retryCurrentPrompt();
    mode.stopTimer();
    const originals = {
      advancePtePrompt: mode.advancePtePrompt, loadNextPrompt: mode.loadNextPrompt,
      savePteCapture: mode.savePteCapture
    };
    const flow = window.__pteAssessedNext = {
      originals, loadCalls: 0, finished: false, promptToken: mode.promptLifecycleToken
    };
    mode.advancePtePrompt = async function (...args) {
      try { return await originals.advancePtePrompt.apply(this, args); }
      finally { flow.finished = true; }
    };
    mode.loadNextPrompt = function (...args) {
      flow.loadCalls += 1;
      return originals.loadNextPrompt.apply(this, args);
    };
    return mode.currentPromptPlainText;
  });
  const assessmentRequests = [];
  const fixture = {
    success: true, accuracyScore: 84, fluencyScore: 78, completenessScore: 96, pronScore: 82,
    recognizedText: referenceText,
    words: [{ word: referenceText.split(/\s+/)[0], accuracyScore: 84, startMs: 0, endMs: 350 }],
    connectedSpeech: { status: 'available', events: [], summary: { total: 0, detected: 0 } }
  };
  const respond = async route => {
    assessmentRequests.push({
      method: route.request().method(),
      referencePresent: route.request().postData()?.includes(referenceText) === true
    });
    await route.fulfill({ json: fixture });
  };
  await page.route('**/api/read-aloud/assess', respond);
  try {
    await page.locator('#ra-record-btn').click();
    await page.waitForFunction(() => window.ReadAloudMode.state === 'RECORDING');
    await page.locator('#ra-stop-btn').click();
    await page.waitForFunction(() => window.ReadAloudMode.state === 'RECORDED');
    await page.getByRole('button', { name: 'Get feedback', exact: true }).click();
    await page.waitForFunction(() => window.ReadAloudMode.state === 'RESULTS'
      && window.ReadAloudMode.pendingSession === null && !window.ReadAloudMode.isSubmitInFlight);
    check(`${width}: actual Get feedback sends recording for assessment`, assessmentRequests, [
      { method: 'POST', referencePresent: true }
    ]);
    check(`${width}: actual assessed scores`, await page.locator('.pte-stats strong').allTextContents(), ['84%', '78%', '96%', '82%']);
    const assessedAttempt = await page.evaluate(() => ({
      id: window.ReadAloudMode.lastAssessmentSession.localAttemptId,
      audioUrl: window.ReadAloudMode.lastAssessmentSession.historyAudioUrl
    }));
    check(`${width}: actual assessment retained in guest history`, !!assessedAttempt.id && !!assessedAttempt.audioUrl
      && await page.locator('.pte-attempts__row').count() > 0);
    const savedScores = await page.locator('.pte-attempts__row').first().locator('.pte-attempts__score').allTextContents();
    if (retryDuringNext) {
      await page.evaluate(() => {
        const mode = window.ReadAloudMode;
        const flow = window.__pteAssessedNext;
        const gate = new Promise(resolve => { flow.release = resolve; });
        mode.savePteCapture = async function (...args) {
          flow.saving = true;
          await gate;
          return flow.originals.savePteCapture.apply(this, args);
        };
      });
    }
    await page.locator('#pte-next-read-aloud').click();
    if (retryDuringNext) {
      await page.waitForFunction(() => window.__pteAssessedNext.saving);
      await page.locator('#ra-retry-btn').click();
      await page.waitForFunction(() => window.ReadAloudMode.state === 'PREP');
      await page.evaluate(() => window.__pteAssessedNext.release());
    }
    await page.waitForFunction(() => window.__pteAssessedNext.finished
      && !document.getElementById('pte-next-read-aloud').disabled);
    check(`${width}: actual Get feedback then ${retryDuringNext ? 'Retry cancels delayed Next' : 'Next advances completed assessment'}`, await page.evaluate(() => ({
      loadCalls: window.__pteAssessedNext.loadCalls,
      state: window.ReadAloudMode.state,
      promptChanged: window.ReadAloudMode.promptLifecycleToken !== window.__pteAssessedNext.promptToken,
      pendingSession: window.ReadAloudMode.pendingSession ?? null
    })), { loadCalls: retryDuringNext ? 0 : 1, state: 'PREP', promptChanged: !retryDuringNext, pendingSession: null });
    if (retryDuringNext) {
      check(`${width}: completed assessment Retry leaves no reusable Next ownership`, await page.evaluate(async () => {
        const mode = window.ReadAloudMode;
        const result = await window.__pteAssessedNext.originals.advancePtePrompt.call(mode);
        return { result, ownership: mode.pendingPteNextOwnership, loadCalls: window.__pteAssessedNext.loadCalls };
      }), { result: false, ownership: null, loadCalls: 0 });
    }
    // After Next, This question correctly excludes the preceding prompt's attempt.
    await page.locator('.pte-attempts__scope').getByRole('button', { name: /^All / }).click();
    const savedRow = page.locator('.pte-attempts__row').first();
    await savedRow.getByRole('button', { name: '▶ Play', exact: true }).click();
    check(`${width}: completed assessment navigation retains history scores`, await savedRow.locator('.pte-attempts__score').allTextContents(), savedScores);
    check(`${width}: completed assessment navigation retains the same recording`, await page.evaluate(() => window.__pteMediaPlayCalls.at(-1)?.src), assessedAttempt.audioUrl);
  } finally {
    await page.unroute('**/api/read-aloud/assess', respond);
    await page.evaluate(() => {
      const mode = window.ReadAloudMode;
      Object.assign(mode, window.__pteAssessedNext.originals);
      delete window.__pteAssessedNext;
      mode.stopTimer();
    });
  }
}

async function run() {
  fs.mkdirSync(evidence, { recursive: true });
  const harness = await createHarness();
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  const failures = [];
  const check = (name, actual, expected = true) => {
    try {
      assert.deepEqual(actual, expected, name);
      passed += 1;
      console.log(`PASS ${name}`);
    } catch (error) {
      failed += 1;
      failures.push(`${name}: ${error.message}`);
      console.error(`FAIL ${name}:`, { actual, expected });
    }
  };
  try {
    for (const width of [1440, 390]) {
      const page = await harness.open({ width, height: width === 390 ? 844 : 900 });
      await page.evaluate(() => {
        window.__pteMediaPlayCalls = [];
        window.__pteMediaPauseCalls = [];
        window.__pteMediaLoadCalls = [];
        const BrowserAudio = window.Audio;
        window.Audio = function (...args) {
          const audio = new BrowserAudio(...args);
          const addEventListener = audio.addEventListener.bind(audio);
          audio.addEventListener = (type, listener, options) => {
            if (type !== 'error') addEventListener(type, listener, options);
          };
          return audio;
        };
        window.Audio.prototype = BrowserAudio.prototype;
        HTMLMediaElement.prototype.play = function () {
          window.__pteMediaPlayCalls.push({
            id: this.id || '',
            src: this.getAttribute('src') || '',
            currentSrc: this.currentSrc || ''
          });
          return Promise.resolve();
        };
        HTMLMediaElement.prototype.pause = function () {
          window.__pteMediaPauseCalls.push({ id: this.id || '', src: this.getAttribute('src') || '' });
        };
        HTMLMediaElement.prototype.load = function () {
          window.__pteMediaLoadCalls.push({ id: this.id || '', src: this.getAttribute('src') || '' });
        };
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
      check(`${width}: Coach starts closed`, await page.locator('#mode-read-aloud').getAttribute('data-pte-coach'), 'closed');

      await page.getByRole('button', { name: 'Filters', exact: true }).click();
      check(`${width}: Filters state`, await page.getByRole('dialog', { name: 'Filters' }).isVisible());
      check(`${width}: Filters include connected speech`, await page.getByRole('dialog', { name: 'Filters' }).getByRole('button', { name: 'Any connected speech', exact: true }).count(), 1);
      await page.waitForFunction(() => window.ReadAloudMode.promptFeatureIndexReady);
      await page.getByRole('dialog', { name: 'Filters' }).getByRole('button', { name: 'Any connected speech', exact: true }).click();
      await page.waitForFunction(() => window.ReadAloudMode.promptFeatureFilter === 'any_connected');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(700);
      await page.evaluate(() => window.ReadAloudMode.stopTimer());
      check(`${width}: selected guide modes survive prompt load`, await page.evaluate(() => [...window.ReadAloudMode.connectedSpeechModes].sort()), ['linking', 'reduced_words']);
      check(`${width}: guide items populated`, await page.evaluate(() => window.ReadAloudMode.currentGuideExplanationItems.length > 0));
      check(`${width}: passage marks populated`, await page.locator('#ra-prompt-stage [data-guide-target]').count() > 0);

      await page.getByRole('button', { name: 'More', exact: true }).click();
      check(`${width}: More state`, await page.getByRole('dialog', { name: 'More' }).isVisible());
      check(`${width}: More content`, await page.getByRole('dialog', { name: 'More' }).textContent().then(text => text.includes('Focus mode') && text.includes('How Read Aloud works')));
      if (width === 1440) await page.screenshot({ path: path.join(evidence, 'ra-1440-more.png'), fullPage: true });
      await page.keyboard.press('Escape');

      await page.locator('#spc-picker-read-aloud').click();
      check(`${width}: picker state`, await page.locator('.spc-sheet[role="dialog"]:visible').isVisible());
      if (width === 1440) await page.screenshot({ path: path.join(evidence, 'ra-1440-picker.png'), fullPage: true });
      await page.keyboard.press('Escape');

      await page.evaluate(async () => {
        const mode = window.ReadAloudMode;
        const questionIndex = mode.database.findIndex(row => String(row.ID) === '1025');
        if (questionIndex < 0) throw new Error('Q1025 is missing from the Read Aloud database');
        await mode.loadSpecificPrompt(questionIndex);
        mode.stopTimer();
      });
      await page.waitForFunction(() => window.ReadAloudMode.currentQuestionId === '1025');
      await page.waitForFunction(() => {
        const candidates = [...document.querySelectorAll('#ra-prompt-stage [data-guide-target]')];
        return candidates.filter(node => ['and', 'can'].includes((node.textContent || '').trim().toLowerCase())).length >= 2;
      });
      const laterMarkedTarget = page.locator('#ra-prompt-stage [data-guide-target]').filter({ hasText: /^(and|can)$/i }).last();
      check(`${width}: Q1025 later marked target exists`, await laterMarkedTarget.count(), 1);
      check(`${width}: every Q1025 mark retains interaction metadata`, await page.evaluate(() => (
        [...document.querySelectorAll('#ra-prompt-stage [data-guide-target]')]
          .filter(node => !window.ReadAloudMode.currentGuideInteractionItems?.has(node.getAttribute('data-guide-target')))
          .map(node => ({ id: node.getAttribute('data-guide-target'), text: (node.textContent || '').trim() }))
      )), []);
      check(`${width}: Q1025 later target is outside capped Coach drawer`, await laterMarkedTarget.evaluate(node => {
        const id = node.getAttribute('data-guide-target');
        return !window.ReadAloudMode.currentGuideExplanationItems.some(item => item.id === id);
      }));
      await laterMarkedTarget.click({ force: true });
      check(`${width}: Q1025 later marked target opens popover`, await page.locator('#ra-sound-change-tooltip').getAttribute('aria-hidden'), 'false');
      check(`${width}: Q1025 later popover identifies its marked word`, await page.locator('.ra-sound-change-tooltip__words').textContent().then(text => /\b(and|can)\b/i.test(text)));
      check(`${width}: Q1025 later popover has coaching copy`, await page.locator('.ra-sound-change-tooltip__explanation').textContent().then(text => text.trim().length > 0));
      await page.locator('.ra-sound-change-tooltip__close').evaluate(button => button.click());

      await page.evaluate(() => {
        const mode = window.ReadAloudMode;
        const filename = 'sample-browser-fixture.mp3';
        mode.selectedGender = 'female';
        mode.selectedVoiceId = 'browser-fixture';
        mode.selectedSpeed = '100';
        mode.audioManifest = {
          ...(mode.audioManifest || {}),
          [mode.currentQuestionId]: {
            female: {
              'browser-fixture': { files: { '100': filename } }
            }
          }
        };
        mode.refreshQuestionPickerV7AudioShortcuts();
        mode.updateAudioPlayerVisibility();
      });
      check(`${width}: sample voice control`, await page.locator('#ra-play-audio-btn').count(), 1);
      check(`${width}: sample voice source selection`, await page.locator('#ra-elevenlabs-audio').getAttribute('src'), '/database/RA/Voice/audio/Audio by folder/1025/sample-browser-fixture.mp3');
      await page.evaluate(() => {
        const button = document.getElementById('ra-play-audio-btn');
        button.click();
      });
      await page.waitForTimeout(0);
      check(`${width}: sample voice invokes media play`, await page.evaluate(() => window.__pteMediaPlayCalls.at(-1)), {
        id: 'ra-elevenlabs-audio',
        src: '/database/RA/Voice/audio/Audio by folder/1025/sample-browser-fixture.mp3',
        currentSrc: await page.locator('#ra-elevenlabs-audio').evaluate(audio => audio.currentSrc)
      });
      check(`${width}: sample voice accessible playing state`, await page.locator('#ra-play-audio-btn').textContent(), 'Pause');
      check(`${width}: sample voice remains enabled`, await page.locator('#ra-play-audio-btn').isEnabled());

      await page.locator('#pte-next-read-aloud').click();
      check(`${width}: cannot-skip dialog`, await page.getByRole('alertdialog').textContent().then(text => text.includes('Cannot skip')));
      if (width === 1440) await page.screenshot({ path: path.join(evidence, 'ra-1440-dialog-cannot-skip.png'), fullPage: true });
      await page.getByRole('button', { name: 'OK', exact: true }).click();

      await page.locator('#ra-pte-coach-btn').click();
      await page.waitForTimeout(200);
      check(`${width}: coach preference`, await page.evaluate(() => localStorage.getItem('bel:ra:coach-open:v1')), 'true');
      check(`${width}: Coach open state`, await page.locator('#mode-read-aloud').getAttribute('data-pte-coach'), 'open');
      check(`${width}: Coach visible`, await page.locator('#ra-connected-speech-box').isVisible());
      check(`${width}: Coach has content`, await page.locator('#ra-connected-speech-list .sc-guide-item').count() > 0);
      if (width === 1440) {
        check('1440: Coach drawer is 360px', await page.locator('#ra-pte-right').evaluate(el => Math.round(el.getBoundingClientRect().width)), 360);
      } else {
        check('390: Coach stacks below stage', await page.evaluate(() => {
          const stage = document.querySelector('#mode-read-aloud .ra-stage').getBoundingClientRect();
          const coach = document.getElementById('ra-pte-right').getBoundingClientRect();
          return coach.top >= stage.bottom - 1;
        }));
      }
      await page.screenshot({ path: path.join(evidence, `ra-${width}-coach-open.png`), fullPage: true });
      await page.locator('#ra-pte-coach-btn').click();
      check(`${width}: Coach closed state`, await page.locator('#mode-read-aloud').getAttribute('data-pte-coach'), 'closed');
      check(`${width}: Coach closed visually`, await page.locator('#ra-connected-speech-box').isVisible(), false);
      await page.locator('#ra-pte-coach-btn').click();

      if (width === 1440) {
        await exerciseWordPopover(page, {
          id: 'browser-linking-target', category: 'linking', subtype: 'consonant_to_vowel', layer: 'linking',
          label: 'take it', badge: 'Linking', sayItLike: 'run the two words together', spokenAs: null,
          explanation: 'Carry the last consonant into the next vowel.', startWordIndex: 0, endWordIndex: 1
        }, { linkingIpa: { take: '/teɪk/', it: '/ɪt/' }, withModelAudio: true });
        check('1440: linking popover badge', await page.locator('.ra-sound-change-tooltip__badge').textContent(), 'Linking');
        check('1440: linking popover Say it like', await page.evaluate(() => {
          const text = document.querySelector('.ra-sound-change-tooltip__say')?.textContent || '';
          return text.includes('Say it like') && text.includes('run the two words together');
        }));
        check('1440: linking popover normalized IPA', await page.evaluate(() => {
          const text = document.querySelector('.ra-sound-change-tooltip__ipa')?.textContent || '';
          return text.includes('/teɪk/') && text.includes('/ɪt/');
        }));
        check('1440: linking popover explanation', await page.locator('.ra-sound-change-tooltip__explanation').textContent().then(text => text.includes('last consonant')));
        check('1440: linking popover Listen', await page.getByRole('button', { name: 'Listen', exact: true, includeHidden: true }).count(), 1);
        if (await page.getByRole('button', { name: 'Listen', exact: true, includeHidden: true }).count()) {
          await page.getByRole('button', { name: 'Listen', exact: true, includeHidden: true }).evaluate(button => button.click());
        }
        await page.waitForTimeout(0);
        check('1440: linking popover model-audio source', await page.evaluate(() => {
          const call = window.__pteMediaPlayCalls.at(-1);
          return { src: call?.src, expected: window.__pteExpectedModelSrc };
        }), await page.evaluate(() => ({ src: window.__pteExpectedModelSrc, expected: window.__pteExpectedModelSrc })));
        check('1440: linking popover invokes real model handler', await page.evaluate(() => window.ReadAloudMode.speechCoachModelAudio instanceof HTMLMediaElement));
        check('1440: linking popover accessible playing state', await page.locator('.ra-sound-change-tooltip__audio .sc-model-play-btn').getAttribute('aria-label'), 'Stop model audio');
        check('1440: popover explicit Close', await page.locator('.ra-sound-change-tooltip__close').textContent(), 'Close');
        await page.locator('.ra-sound-change-tooltip__close').evaluate(button => button.click());
        check('1440: popover Close hides', await page.locator('#ra-sound-change-tooltip').getAttribute('aria-hidden'), 'true');
        await restoreWordPopover(page);
        await page.waitForTimeout(100);

        await exerciseWordPopover(page, {
          id: 'browser-reduced-target', category: 'reduced_words', subtype: 'the', layer: 'weak_forms',
          label: 'the', badge: 'Reduced word', sayItLike: 'thuh', strongAs: '/ðiː/', spokenAs: '/ðə/', targetIpa: '/ðə/',
          explanation: 'Use the weak form before a consonant sound.', startWordIndex: 0, endWordIndex: 0
        });
        check('1440: reduced-word popover badge', await page.locator('.ra-sound-change-tooltip__badge').textContent(), 'Reduced word');
        check('1440: reduced-word popover normalized IPA', await page.evaluate(() => (document.querySelector('.ra-sound-change-tooltip__ipa')?.textContent || '').includes('/ðə/')));
        await page.keyboard.press('Escape');
        check('1440: popover Escape hides', await page.locator('#ra-sound-change-tooltip').getAttribute('aria-hidden'), 'true');
        await page.evaluate(() => {
          const mode = window.ReadAloudMode;
          const target = window.__ptePopoverRestore.target;
          mode.showSoundChangeTooltip('browser-reduced-target', target, { pinned: true });
        });
        await page.locator('#ra-pte-instruction').click();
        check('1440: popover outside click hides', await page.locator('#ra-sound-change-tooltip').getAttribute('aria-hidden'), 'true');
        await restoreWordPopover(page);
        await page.waitForTimeout(100);
      }

      const prepGuideState = await page.evaluate(() => ({ modes: [...window.ReadAloudMode.connectedSpeechModes].sort(), items: window.ReadAloudMode.currentGuideExplanationItems.length }));
      await page.locator('#ra-record-btn').click();
      await page.waitForFunction(() => window.ReadAloudMode.state === 'RECORDING');
      check(`${width}: recording widget`, await page.locator('#ra-pte-recorder .pte-rec').getAttribute('data-state'), 'recording');
      check(`${width}: coach hidden recording`, await page.locator('#ra-connected-speech-box').isVisible(), false);
      check(`${width}: guide state retained while recording`, await page.evaluate(() => ({ modes: [...window.ReadAloudMode.connectedSpeechModes].sort(), items: window.ReadAloudMode.currentGuideExplanationItems.length })), prepGuideState);
      await page.locator('#ra-pte-cancel-btn').click();
      await page.waitForTimeout(100);
      check(`${width}: cancel returns prep`, await page.evaluate(() => window.ReadAloudMode.state), 'PREP');
      check(`${width}: cancel discards`, await page.evaluate(() => !window.ReadAloudMode.pendingBlob));
      check(`${width}: Coach restores after recording`, await page.locator('#ra-connected-speech-box').isVisible());
      check(`${width}: guide state restores after recording`, await page.evaluate(() => ({ modes: [...window.ReadAloudMode.connectedSpeechModes].sort(), items: window.ReadAloudMode.currentGuideExplanationItems.length })), prepGuideState);
      await page.locator('#ra-record-btn').click();
      await page.waitForFunction(() => window.ReadAloudMode.state === 'RECORDING');
      await page.screenshot({ path: path.join(evidence, `ra-${width}-recording.png`), fullPage: true });
      await page.locator('#ra-stop-btn').click();
      await page.waitForFunction(() => window.ReadAloudMode.state === 'RECORDED');
      await page.waitForTimeout(100);
      check(`${width}: complete`, await page.locator('#ra-pte-recorder .pte-rec').getAttribute('data-state'), 'complete');
      check(`${width}: play in dock`, await page.locator('.pte-dock #ra-play-recording-btn').isVisible());
      check(`${width}: Coach restores after stop`, await page.locator('#ra-connected-speech-box').isVisible());
      await page.locator('#pte-next-read-aloud').click();
      check(`${width}: confirm-next dialog`, await page.getByRole('alertdialog').textContent().then(text => text.includes('Go to the next question?')));
      if (width === 1440) await page.screenshot({ path: path.join(evidence, 'ra-1440-dialog-confirm-next.png'), fullPage: true });
      await page.getByRole('button', { name: 'Stay here', exact: true }).click();
      check(`${width}: confirm-next stay preserves complete`, await page.evaluate(() => window.ReadAloudMode.state), 'RECORDED');
      await page.screenshot({ path: path.join(evidence, `ra-${width}-complete.png`), fullPage: true });

      await page.evaluate(async () => {
        const mode = window.ReadAloudMode;
        const event = { eventId: 'browser-linking-feedback', phrase: 'rates of', category: 'linking', family: 'linking', subtype: 'consonant_to_vowel', status: 'detected', startWordIndex: 8, endWordIndex: 9, startMs: 320, endMs: 740, feedbackText: 'Keep the words connected.' };
        const payload = { accuracyScore: 84, fluencyScore: 78, completenessScore: 96, pronScore: 82, recognizedText: mode.currentPromptPlainText, words: [{ word: 'rates', accuracyScore: 48, startMs: 320, endMs: 740 }], connectedSpeech: { status: 'available', events: [event], summary: { total: 1, detected: 1 } } };
        mode.state = 'RESULTS';
        await mode.processAzureResults(payload, mode.pendingSession);
        mode.updateUIForState();
      });
      check(`${width}: feedback`, await page.locator('.pte-card').getAttribute('data-pte-phase'), 'feedback');
      check(`${width}: two-column feedback host`, await page.locator('.pte-fb').count(), 1);
      check(`${width}: actual score fields`, await page.locator('.pte-stats').textContent().then(text => ['84', '78', '96', '82'].every(number => text.includes(number))));
      const scoreColumns = await page.locator('.pte-stats').evaluate(stats => getComputedStyle(stats).gridTemplateColumns.split(' ').filter(Boolean).length);
      check(`${width}: responsive score columns`, scoreColumns, width === 1440 ? 4 : 2);
      check(`${width}: score labels do not overlap`, await page.locator('.pte-stats').evaluate(stats => {
        const bounds = stats.getBoundingClientRect();
        const labels = [...stats.querySelectorAll('small')].map(label => { const range = document.createRange(); range.selectNodeContents(label); return range.getBoundingClientRect(); });
        return labels.every(rect => rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1)
          && labels.every((rect, index) => labels.slice(index + 1).every(other => rect.right <= other.left || other.right <= rect.left || rect.bottom <= other.top || other.bottom <= rect.top));
      }));
      check(`${width}: practice next`, await page.locator('.pte-practice-next').textContent().then(text => text.includes('practice')));
      check(`${width}: prompt replaced`, await page.locator('#ra-prompt-stage').isVisible(), false);
      check(`${width}: sample voice feedback tab`, await page.locator('#ra-source-tab-sample').isVisible());
      await page.locator('#ra-source-tab-sample').click();
      check(`${width}: sample voice feedback selected`, await page.locator('#ra-source-tab-sample').getAttribute('aria-selected'), 'true');
      check(`${width}: sample voice player visible`, await page.locator('#ra-audio-player').isVisible());
      if (width === 1440) await page.screenshot({ path: path.join(evidence, 'ra-1440-feedback-sample-voice.png'), fullPage: true });
      await page.locator('#ra-source-tab-yours').click();
      await page.getByRole('tab', { name: /Coach tips/ }).click();
      await page.waitForTimeout(200);
      check(`${width}: Coach feedback tab selected`, await page.getByRole('tab', { name: /Coach tips/ }).getAttribute('aria-selected'), 'true');
      check(`${width}: Coach feedback visible`, await page.locator('#ra-connected-speech-box').isVisible());
      check(`${width}: Coach feedback is assessed output`, await page.locator('#ra-connected-speech-meta').textContent(), 'Feedback');
      check(`${width}: Coach feedback result label`, await page.locator('#ra-connected-speech-list .sc-section-header').textContent().then(text => text.includes('Successful Links')));
      check(`${width}: Coach feedback assessed phrase`, await page.locator('#ra-connected-speech-list .sc-word-title').textContent(), 'rates of');
      check(`${width}: Coach feedback is not Preview hints`, await page.locator('#ra-connected-speech-list .sc-guide-item').count(), 0);
      if (width === 1440) await page.screenshot({ path: path.join(evidence, 'ra-1440-feedback-coach.png'), fullPage: true });
      await page.getByRole('tab', { name: 'Your results', exact: true }).click();
      check(`${width}: advanced analysis available`, await page.locator('#ra-show-advanced-btn').isVisible());
      await page.locator('#ra-show-advanced-btn').click();
      await page.waitForTimeout(300);
      check(`${width}: advanced analysis state`, await page.evaluate(() => window.ReadAloudMode.getCoachTier()), 'full');
      check(`${width}: advanced analysis visible DOM state`, await page.locator('#mode-read-aloud').getAttribute('data-spc-view'), 'advanced');
      await page.getByRole('tab', { name: /Coach tips/ }).click();
      check(`${width}: advanced analysis result content visible`, await page.locator('#ra-connected-speech-list .sc-section-header').filter({ hasText: 'Successful Links' }).isVisible());
      const analysisToggle = page.locator('#ra-connected-speech-list .sc-chevron-btn[data-sc-accordion-toggle]').first();
      const analysisContentId = await analysisToggle.getAttribute('data-sc-accordion-toggle');
      check(`${width}: advanced analysis starts collapsed`, await page.locator(`#${analysisContentId}`).getAttribute('hidden'), '');
      await analysisToggle.click();
      check(`${width}: advanced analysis expanded DOM`, await page.locator(`#${analysisContentId}`).isVisible());
      check(`${width}: advanced analysis expanded accessible state`, await analysisToggle.getAttribute('aria-expanded'), 'true');
      check(`${width}: advanced analysis expected detail`, await page.locator(`#${analysisContentId}`).textContent().then(text => text.includes('Seamless Link Connected')));
      await analysisToggle.click();
      check(`${width}: advanced analysis collapsed DOM`, await page.locator(`#${analysisContentId}`).isVisible(), false);
      check(`${width}: advanced analysis collapsed accessible state`, await analysisToggle.getAttribute('aria-expanded'), 'false');
      if (width === 1440) await page.screenshot({ path: path.join(evidence, 'ra-1440-advanced-analysis.png'), fullPage: true });
      check(`${width}: history below card`, await page.evaluate(() => !!document.querySelector('.pte-card + .pte-attempts')));
      check(`${width}: guest attempt`, await page.locator('.pte-attempts__row').count() > 0);
      check(`${width}: no horizontal overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.screenshot({ path: path.join(evidence, `ra-${width}-feedback.png`), fullPage: true });

      await page.locator('#ra-retry-btn').click();
      await page.waitForFunction(() => window.ReadAloudMode.state === 'PREP');
      check(`${width}: retry clears assessed payload ownership`, await page.evaluate(() => ({
        payload: window.ReadAloudMode.lastAssessmentPayload ?? null,
        session: window.ReadAloudMode.lastAssessmentSession ?? null,
        renderedPayload: window.ReadAloudMode.pteView?.payload ?? null
      })), { payload: null, session: null, renderedPayload: null });
      await page.evaluate(() => {
        const mode = window.ReadAloudMode;
        mode.__pteOriginalPrepareWavBlob = mode.prepareWavBlob;
        mode.prepareWavBlob = async () => { throw new Error('intentional browser capture preparation failure'); };
      });
      await page.locator('#ra-record-btn').click();
      await page.waitForFunction(() => window.ReadAloudMode.state === 'RECORDING');
      await page.locator('#ra-stop-btn').click();
      await page.waitForFunction(() => window.ReadAloudMode.state === 'RESULTS');
      check(`${width}: capture failure message`, await page.locator('#ra-status-message').textContent(), 'We couldn’t prepare that recording. Please try again.');
      check(`${width}: capture failure clears score metrics`, await page.locator('.pte-stats strong').allTextContents(), ['—', '—', '—', '—']);
      check(`${width}: capture failure has no stale successful scores`, await page.locator('.pte-stats').textContent().then(text => !['84%', '78%', '96%', '82%'].some(score => text.includes(score))));
      check(`${width}: capture failure renders explicit failure copy`, await page.locator('.pte-fixes').textContent().then(text => text.includes('We couldn’t prepare that recording.')));
      await page.evaluate(() => {
        const mode = window.ReadAloudMode;
        mode.prepareWavBlob = mode.__pteOriginalPrepareWavBlob;
        delete mode.__pteOriginalPrepareWavBlob;
      });

      const staleCompletion = await page.evaluate(async () => {
        const mode = window.ReadAloudMode;
        mode.retryCurrentPrompt();
        const row = mode.currentPromptRow;
        const session = {
          id: mode.recordingRequestId,
          disposition: 'submit',
          promptToken: mode.promptLifecycleToken,
          referenceText: mode.currentPromptPlainText,
          questionId: mode.currentQuestionId
        };
        mode.pendingSession = session;
        mode.pendingBlob = new Blob(['stale-assessment'], { type: 'audio/webm' });
        mode.state = 'RECORDED';
        mode.updateUIForState();
        const originalSubmit = mode.submitToAzure;
        let settle;
        mode.submitToAzure = () => new Promise(resolve => { settle = resolve; });
        const checkPromise = mode.handleCheckResult();
        await Promise.resolve();
        const promptLoadToken = mode.beginPromptLoad();
        settle(true);
        await checkPromise;
        const observed = {
          state: mode.state,
          payload: mode.lastAssessmentPayload ?? null,
          session: mode.lastAssessmentSession ?? null
        };
        mode.submitToAzure = originalSubmit;
        mode.applyPromptRow(row, promptLoadToken, { rememberPrompt: false });
        return observed;
      });
      check(`${width}: late assessment completion cannot restore stale results after navigation`, staleCompletion, {
        state: 'PREP', payload: null, session: null
      });

      if (retrySessionVariant) {
        await page.evaluate(() => {
          const mode = window.ReadAloudMode;
          const session = {
            id: mode.recordingRequestId,
            disposition: 'submit',
            promptToken: mode.promptLifecycleToken,
            referenceText: mode.currentPromptPlainText,
            questionId: mode.currentQuestionId,
            wavBlob: new Blob(['same-prompt-retry'], { type: 'audio/wav' }),
            archiveAttemptId: 'retry-session-old-attempt',
            sessionViewMode: mode.getEffectiveViewMode(),
            sessionConnectedSpeechModes: Object.freeze(mode.getActiveConnectedSpeechModes()),
            sessionConnectedSpeechLevel: mode.connectedSpeechLevel || 'off'
          };
          const payload = {
            success: true,
            accuracyScore: 37,
            fluencyScore: 41,
            completenessScore: 43,
            pronScore: 39,
            recognizedText: mode.currentPromptPlainText,
            words: [{ word: 'stale', accuracyScore: 37, startMs: 0, endMs: 240 }],
            connectedSpeech: {
              status: 'available',
              events: [{
                eventId: 'stale-retry-feedback',
                phrase: 'stale retry',
                category: 'linking',
                family: 'linking',
                subtype: 'consonant_to_vowel',
                status: 'detected',
                startWordIndex: 0,
                endWordIndex: 1,
                startMs: 0,
                endMs: 240,
                feedbackText: 'This prior attempt must stay stale.'
              }],
              summary: { total: 1, detected: 1 }
            }
          };

          mode.pendingSession = session;
          mode.pendingBlob = new Blob(['same-prompt-retry'], { type: 'audio/webm' });
          mode.state = 'RECORDED';
          mode.updateUIForState();

          let releaseCoach;
          const coachGate = new Promise(resolve => { releaseCoach = resolve; });
          const originals = {
            handleCheckResult: mode.handleCheckResult,
            submitToAzure: mode.submitToAzure,
            loadSpeechCoachAudioManifest: mode.loadSpeechCoachAudioManifest,
            savePteCapture: mode.savePteCapture,
            patchAttempt: window.PTEAttemptArchive?.patchAttempt
          };
          window.__pteRetrySessionRace = {
            archiveWrites: 0,
            releaseCoach,
            session,
            originals
          };
          mode.loadSpeechCoachAudioManifest = () => coachGate;
          mode.savePteCapture = async () => {
            window.__pteRetrySessionRace.archiveWrites += 1;
          };
          if (window.PTEAttemptArchive) {
            window.PTEAttemptArchive.patchAttempt = async () => {
              window.__pteRetrySessionRace.archiveWrites += 1;
            };
          }
          mode.submitToAzure = (_blob, recordingSession) => mode.processAzureResults(payload, recordingSession);
          mode.handleCheckResult = function (...args) {
            const completion = originals.handleCheckResult.apply(this, args);
            window.__pteRetrySessionRace.completion = completion;
            return completion;
          };
        });

        await page.locator('#ra-check-btn').click();
        await page.waitForFunction(() => window.ReadAloudMode.state === 'RESULTS'
          && !!window.__pteRetrySessionRace?.completion);
        await page.locator('#ra-retry-btn').click();
        await page.waitForFunction(() => window.ReadAloudMode.state === 'PREP');
        await page.evaluate(() => window.__pteRetrySessionRace.releaseCoach());
        await page.evaluate(() => window.__pteRetrySessionRace.completion);

        const retryRace = await page.evaluate(() => {
          const mode = window.ReadAloudMode;
          const race = window.__pteRetrySessionRace;
          const observed = {
            state: mode.state,
            payload: mode.lastAssessmentPayload ?? null,
            session: mode.lastAssessmentSession ?? null,
            renderedPayload: mode.pteView?.payload ?? null,
            staleMetricsVisible: [...document.querySelectorAll('.pte-stats strong')]
              .some(node => ['37', '41', '43', '39'].includes(node.textContent.trim())),
            coachMeta: document.getElementById('ra-connected-speech-meta')?.textContent || '',
            staleCoachVisible: document.getElementById('ra-connected-speech-list')?.textContent.includes('stale retry') || false,
            archiveWrites: race.archiveWrites,
            oldSessionDisposition: race.session.disposition,
            requestIdAdvanced: mode.recordingRequestId > race.session.id
          };
          mode.handleCheckResult = race.originals.handleCheckResult;
          mode.submitToAzure = race.originals.submitToAzure;
          mode.loadSpeechCoachAudioManifest = race.originals.loadSpeechCoachAudioManifest;
          mode.savePteCapture = race.originals.savePteCapture;
          if (window.PTEAttemptArchive && race.originals.patchAttempt) {
            window.PTEAttemptArchive.patchAttempt = race.originals.patchAttempt;
          }
          delete window.__pteRetrySessionRace;
          return observed;
        });
        check(`${width}: actual Retry invalidates same-prompt processing phase`, retryRace.state, 'PREP');
        check(`${width}: actual Retry keeps prior assessment ownership cleared`, {
          payload: retryRace.payload,
          session: retryRace.session,
          renderedPayload: retryRace.renderedPayload
        }, { payload: null, session: null, renderedPayload: null });
        check(`${width}: actual Retry keeps prior metrics cleared`, retryRace.staleMetricsVisible, false);
        check(`${width}: actual Retry keeps Coach out of stale feedback`, {
          feedback: retryRace.coachMeta === 'Feedback',
          staleCoachVisible: retryRace.staleCoachVisible
        }, { feedback: false, staleCoachVisible: false });
        check(`${width}: actual Retry advances and discards prior session identity`, {
          disposition: retryRace.oldSessionDisposition,
          requestIdAdvanced: retryRace.requestIdAdvanced
        }, { disposition: 'discard', requestIdAdvanced: true });
        check(`${width}: actual Retry blocks prior assessment archive writes`, retryRace.archiveWrites, 0);

        await page.evaluate(() => {
          const mode = window.ReadAloudMode;
          const session = {
            id: mode.recordingRequestId,
            disposition: 'submit',
            promptToken: mode.promptLifecycleToken,
            referenceText: mode.currentPromptPlainText,
            questionId: mode.currentQuestionId,
            wavBlob: new Blob(['delayed-capture-save'], { type: 'audio/wav' }),
            archiveAttemptId: 'retry-archive-old-attempt',
            sessionViewMode: mode.getEffectiveViewMode(),
            sessionConnectedSpeechModes: Object.freeze(mode.getActiveConnectedSpeechModes()),
            sessionConnectedSpeechLevel: mode.connectedSpeechLevel || 'off'
          };
          const payload = {
            success: true,
            accuracyScore: 21,
            fluencyScore: 22,
            completenessScore: 23,
            pronScore: 24,
            recognizedText: mode.currentPromptPlainText,
            words: [{ word: 'obsolete', accuracyScore: 21, startMs: 0, endMs: 180 }],
            connectedSpeech: { status: 'not_applicable', events: [], summary: { total: 0, detected: 0 } }
          };

          mode.pendingSession = session;
          mode.pendingBlob = new Blob(['delayed-capture-save'], { type: 'audio/webm' });
          mode.state = 'RECORDED';
          mode.updateUIForState();

          let releaseCaptureSave;
          const captureSaveGate = new Promise(resolve => { releaseCaptureSave = resolve; });
          const originals = {
            handleCheckResult: mode.handleCheckResult,
            submitToAzure: mode.submitToAzure,
            savePteCapture: mode.savePteCapture,
            patchAttempt: window.PTEAttemptArchive?.patchAttempt,
            invalidateHistoryCache: window.PTEAttemptArchive?.invalidateHistoryCache,
            recordLocal: window.PteAttemptHistory?.recordLocal
          };
          const onArchiveSaved = (event) => {
            if (event.detail?.attemptId === session.archiveAttemptId) {
              window.__pteRetryArchiveRace.savedEvents += 1;
            }
          };
          window.__pteRetryArchiveRace = {
            archivePatchStarts: 0,
            captureSaveStarted: false,
            historyInvalidations: 0,
            localHistoryWrites: 0,
            savedEvents: 0,
            releaseCaptureSave,
            session,
            originals,
            onArchiveSaved
          };
          window.addEventListener('pte-attempt-archive:saved', onArchiveSaved);
          mode.savePteCapture = async () => {
            window.__pteRetryArchiveRace.captureSaveStarted = true;
            await captureSaveGate;
          };
          if (window.PTEAttemptArchive) {
            window.PTEAttemptArchive.patchAttempt = async () => {
              window.__pteRetryArchiveRace.archivePatchStarts += 1;
            };
            window.PTEAttemptArchive.invalidateHistoryCache = () => {
              window.__pteRetryArchiveRace.historyInvalidations += 1;
            };
          }
          if (window.PteAttemptHistory) {
            window.PteAttemptHistory.recordLocal = () => {
              window.__pteRetryArchiveRace.localHistoryWrites += 1;
            };
          }
          mode.submitToAzure = (_blob, recordingSession) => mode.processAzureResults(payload, recordingSession);
          mode.handleCheckResult = function (...args) {
            const completion = originals.handleCheckResult.apply(this, args);
            window.__pteRetryArchiveRace.completion = completion;
            return completion;
          };
        });

        await page.locator('#ra-check-btn').click();
        await page.waitForFunction(() => window.ReadAloudMode.state === 'RESULTS'
          && window.__pteRetryArchiveRace?.captureSaveStarted
          && !!window.__pteRetryArchiveRace?.completion);
        await page.locator('#ra-retry-btn').click();
        await page.waitForFunction(() => window.ReadAloudMode.state === 'PREP');
        await page.evaluate(() => window.__pteRetryArchiveRace.releaseCaptureSave());
        await page.evaluate(() => window.__pteRetryArchiveRace.completion);

        const retryArchiveRace = await page.evaluate(() => {
          const mode = window.ReadAloudMode;
          const race = window.__pteRetryArchiveRace;
          const observed = {
            state: mode.state,
            payload: mode.lastAssessmentPayload ?? null,
            session: mode.lastAssessmentSession ?? null,
            renderedPayload: mode.pteView?.payload ?? null,
            staleMetricsVisible: [...document.querySelectorAll('.pte-stats strong')]
              .some(node => ['21', '22', '23', '24'].includes(node.textContent.trim())),
            archivePatchStarts: race.archivePatchStarts,
            historyInvalidations: race.historyInvalidations,
            localHistoryWrites: race.localHistoryWrites,
            savedEvents: race.savedEvents,
            oldSessionDisposition: race.session.disposition,
            requestIdAdvanced: mode.recordingRequestId > race.session.id
          };
          mode.handleCheckResult = race.originals.handleCheckResult;
          mode.submitToAzure = race.originals.submitToAzure;
          mode.savePteCapture = race.originals.savePteCapture;
          if (window.PTEAttemptArchive) {
            if (race.originals.patchAttempt) window.PTEAttemptArchive.patchAttempt = race.originals.patchAttempt;
            else delete window.PTEAttemptArchive.patchAttempt;
            if (race.originals.invalidateHistoryCache) window.PTEAttemptArchive.invalidateHistoryCache = race.originals.invalidateHistoryCache;
            else delete window.PTEAttemptArchive.invalidateHistoryCache;
          }
          if (window.PteAttemptHistory) {
            if (race.originals.recordLocal) window.PteAttemptHistory.recordLocal = race.originals.recordLocal;
            else delete window.PteAttemptHistory.recordLocal;
          }
          window.removeEventListener('pte-attempt-archive:saved', race.onArchiveSaved);
          delete window.__pteRetryArchiveRace;
          return observed;
        });
        check(`${width}: delayed capture-save Retry keeps phase in PREP`, retryArchiveRace.state, 'PREP');
        check(`${width}: delayed capture-save Retry keeps assessment ownership cleared`, {
          payload: retryArchiveRace.payload,
          session: retryArchiveRace.session,
          renderedPayload: retryArchiveRace.renderedPayload
        }, { payload: null, session: null, renderedPayload: null });
        check(`${width}: delayed capture-save Retry keeps prior metrics cleared`, retryArchiveRace.staleMetricsVisible, false);
        check(`${width}: delayed capture-save Retry blocks assessed archive patch`, retryArchiveRace.archivePatchStarts, 0);
        check(`${width}: delayed capture-save Retry blocks history and saved-event mutations`, {
          invalidations: retryArchiveRace.historyInvalidations,
          localWrites: retryArchiveRace.localHistoryWrites,
          savedEvents: retryArchiveRace.savedEvents
        }, { invalidations: 0, localWrites: 0, savedEvents: 0 });
        check(`${width}: delayed capture-save Retry discards prior session identity`, {
          disposition: retryArchiveRace.oldSessionDisposition,
          requestIdAdvanced: retryArchiveRace.requestIdAdvanced
        }, { disposition: 'discard', requestIdAdvanced: true });

        await page.evaluate(() => {
          const mode = window.ReadAloudMode;
          mode.retryCurrentPrompt();
          const session = {
            id: mode.recordingRequestId,
            disposition: 'submit',
            promptToken: mode.promptLifecycleToken,
            referenceText: mode.currentPromptPlainText,
            questionId: mode.currentQuestionId
          };
          mode.pendingSession = session;
          mode.pendingBlob = new Blob(['delayed-dsp-old-recording'], { type: 'audio/webm' });
          mode.isSubmitInFlight = false;
          mode.state = 'RECORDED';
          mode.updateUIForState();

          let releaseDsp;
          const dspGate = new Promise(resolve => { releaseDsp = resolve; });
          const originalPipelineDescriptor = Object.getOwnPropertyDescriptor(window, 'AudioDspPipeline');
          const staleBuffer = { marker: 'stale-dsp-buffer', duration: 1.25 };
          const freshBuffer = { marker: 'fresh-retry-buffer', duration: 2.5 };
          const originals = {
            pipelineDescriptor: originalPipelineDescriptor,
            validateAudioBufferQuality: mode.validateAudioBufferQuality
          };
          Object.defineProperty(window, 'AudioDspPipeline', {
            configurable: true,
            writable: true,
            value: {
              ...(window.AudioDspPipeline || {}),
              enhance: async () => {
                window.__pteRetryDspRace.dspStarted = true;
                await dspGate;
                return {
                  wavBlob: new Blob(['stale-dsp-wav'], { type: 'audio/wav' }),
                  audioBuffer: staleBuffer
                };
              }
            }
          });
          mode.validateAudioBufferQuality = () => ({ passed: true });
          window.__pteRetryDspRace = {
            completion: null,
            dspStarted: false,
            freshBuffer,
            originals,
            releaseDsp,
            session
          };
          window.__pteRetryDspRace.completion = mode.submitToAzure(mode.pendingBlob, session);
        });

        await page.waitForFunction(() => window.__pteRetryDspRace?.dspStarted);
        await page.locator('#ra-retry-btn').click();
        await page.waitForFunction(() => window.ReadAloudMode.state === 'PREP');
        await page.evaluate(() => {
          const mode = window.ReadAloudMode;
          const race = window.__pteRetryDspRace;
          mode.assessmentAudioBuffer = race.freshBuffer;
          mode.setRecordedAudio(new Blob(['fresh-retry-wav'], { type: 'audio/wav' }), { preserveAssessmentBuffer: true });
          race.freshPlaybackUrl = mode.userRecordingUrl;
          race.releaseDsp();
        });
        await page.evaluate(() => window.__pteRetryDspRace.completion);

        const retryDspRace = await page.evaluate(() => {
          const mode = window.ReadAloudMode;
          const race = window.__pteRetryDspRace;
          const observed = {
            state: mode.state,
            playbackUrlPreserved: mode.userRecordingUrl === race.freshPlaybackUrl,
            assessmentBufferPreserved: mode.assessmentAudioBuffer === race.freshBuffer,
            oldSessionDisposition: race.session.disposition,
            requestIdAdvanced: mode.recordingRequestId > race.session.id
          };
          mode.validateAudioBufferQuality = race.originals.validateAudioBufferQuality;
          if (race.originals.pipelineDescriptor) {
            Object.defineProperty(window, 'AudioDspPipeline', race.originals.pipelineDescriptor);
          } else {
            delete window.AudioDspPipeline;
          }
          delete window.__pteRetryDspRace;
          return observed;
        });
        check(`${width}: delayed DSP Retry preserves fresh shared audio`, retryDspRace, {
          state: 'PREP',
          playbackUrlPreserved: true,
          assessmentBufferPreserved: true,
          oldSessionDisposition: 'discard',
          requestIdAdvanced: true
        });

        await page.evaluate(() => {
          const mode = window.ReadAloudMode;
          mode.retryCurrentPrompt();
          let releaseSave;
          const saveGate = new Promise(resolve => { releaseSave = resolve; });
          const originals = {
            finishPteRecordingForNext: mode.finishPteRecordingForNext,
            advancePtePrompt: mode.advancePtePrompt,
            savePteCapture: mode.savePteCapture,
            loadNextPrompt: mode.loadNextPrompt
          };
          window.__pteRetryNextRace = {
            advanceCalled: false,
            finishSettled: false,
            loadCalls: 0,
            originals,
            releaseSave,
            saveStarted: false,
            session: null
          };
          mode.savePteCapture = (session) => {
            const race = window.__pteRetryNextRace;
            race.session = session;
            if (!session.__pteRetryNextSavePromise) {
              session.__pteRetryNextSavePromise = (async () => {
                race.saveStarted = true;
                await saveGate;
              })();
            }
            return session.__pteRetryNextSavePromise;
          };
          mode.loadNextPrompt = async () => {
            window.__pteRetryNextRace.loadCalls += 1;
            return true;
          };
          mode.finishPteRecordingForNext = function (...args) {
            const completion = originals.finishPteRecordingForNext.apply(this, args);
            Promise.resolve(completion).finally(() => {
              window.__pteRetryNextRace.finishSettled = true;
            });
            return completion;
          };
          mode.advancePtePrompt = function (...args) {
            window.__pteRetryNextRace.advanceCalled = true;
            return originals.advancePtePrompt.apply(this, args);
          };
        });

        await page.locator('#ra-record-btn').click();
        await page.waitForFunction(() => window.ReadAloudMode.state === 'RECORDING');
        await page.locator('#pte-next-read-aloud').click();
        await page.locator('.pte-dialog').getByRole('button', { name: 'Next question', exact: true }).click();
        await page.waitForFunction(() => window.__pteRetryNextRace?.saveStarted
          && window.ReadAloudMode.state === 'RECORDED');
        await page.locator('#ra-retry-btn').click();
        await page.waitForFunction(() => window.ReadAloudMode.state === 'PREP');
        await page.evaluate(() => window.__pteRetryNextRace.releaseSave());
        await page.waitForFunction(() => window.__pteRetryNextRace?.finishSettled);
        await page.waitForTimeout(50);

        const retryNextRace = await page.evaluate(() => {
          const mode = window.ReadAloudMode;
          const race = window.__pteRetryNextRace;
          const observed = {
            state: mode.state,
            loadCalls: race.loadCalls,
            advanceCalled: race.advanceCalled,
            oldSessionDisposition: race.session?.disposition,
            requestIdAdvanced: mode.recordingRequestId > race.session.id
          };
          mode.finishPteRecordingForNext = race.originals.finishPteRecordingForNext;
          mode.advancePtePrompt = race.originals.advancePtePrompt;
          mode.savePteCapture = race.originals.savePteCapture;
          mode.loadNextPrompt = race.originals.loadNextPrompt;
          delete window.__pteRetryNextRace;
          return observed;
        });
        check(`${width}: confirmed recording-to-Next Retry blocks forced advance`, retryNextRace, {
          state: 'PREP',
          loadCalls: 0,
          advanceCalled: false,
          oldSessionDisposition: 'discard',
          requestIdAdvanced: true
        });

        for (const cancelCapture of [true, false]) {
          await page.evaluate(() => {
            const mode = window.ReadAloudMode;
            mode.retryCurrentPrompt();
            mode.stopTimer();
            let release;
            const gate = new Promise(resolve => { release = resolve; });
            const originals = {
              prepareWavBlob: mode.prepareWavBlob,
              finishPteRecordingForNext: mode.finishPteRecordingForNext,
              advancePtePrompt: mode.advancePtePrompt,
              loadNextPrompt: mode.loadNextPrompt
            };
            const race = window.__pteCancelNextRace = {
              originals, release, preparing: false, goNextCalls: 0, loadCalls: 0,
              promptId: mode.currentQuestionId, promptToken: mode.promptLifecycleToken
            };
            mode.prepareWavBlob = async function (...args) {
              race.preparing = true;
              await gate;
              return originals.prepareWavBlob.apply(this, args);
            };
            mode.finishPteRecordingForNext = async function (...args) {
              race.session = this.currentRecordingSession;
              const result = await originals.finishPteRecordingForNext.apply(this, args);
              race.finishResult = result;
              race.finished = true;
              return result;
            };
            mode.advancePtePrompt = function (...args) {
              race.goNextCalls += 1;
              return originals.advancePtePrompt.apply(this, args);
            };
            mode.loadNextPrompt = function (...args) {
              race.loadCalls += 1;
              return originals.loadNextPrompt.apply(this, args);
            };
          });
          await page.locator('#ra-record-btn').click();
          await page.waitForFunction(() => window.ReadAloudMode.state === 'RECORDING');
          await page.locator('#pte-next-read-aloud').click();
          await page.getByRole('alertdialog').getByRole('button', { name: 'Next question', exact: true }).click();
          await page.waitForFunction(() => window.__pteCancelNextRace.preparing
            && window.ReadAloudMode.state === 'STOPPING_RECORDING');
          if (cancelCapture) {
            await page.locator('#ra-pte-cancel-btn').click();
            await page.waitForFunction(() => window.ReadAloudMode.state === 'PREP');
            await page.evaluate(() => window.ReadAloudMode.stopTimer());
          }
          await page.evaluate(() => window.__pteCancelNextRace.release());
          // nextPending is cleared in the controller's finally, after any goNext call settles.
          await page.waitForFunction(() => window.__pteCancelNextRace.finished
            && !document.getElementById('pte-next-read-aloud').disabled);
          const captureNext = await page.evaluate(async (cancelled) => {
            const mode = window.ReadAloudMode;
            const race = window.__pteCancelNextRace;
            const observed = {
              finishResult: race.finishResult,
              goNextCalls: race.goNextCalls,
              loadCalls: race.loadCalls,
              state: mode.state,
              promptUnchanged: mode.currentQuestionId === race.promptId
                && mode.promptLifecycleToken === race.promptToken,
              sessionlessLoads: 0
            };
            if (cancelled) {
              // Defense at the mode boundary: an obsolete caller must not acquire a fresh token.
              const before = race.loadCalls;
              await race.originals.advancePtePrompt.call(mode);
              observed.sessionlessLoads = race.loadCalls - before;
            }
            Object.assign(mode, race.originals);
            delete window.__pteCancelNextRace;
            return observed;
          }, cancelCapture);
          check(`${width}: pending capture ${cancelCapture ? 'Cancel stops' : 'valid Next completes'} navigation`, captureNext, {
            finishResult: !cancelCapture,
            goNextCalls: cancelCapture ? 0 : 1,
            loadCalls: cancelCapture ? 0 : 1,
            state: 'PREP',
            promptUnchanged: cancelCapture,
            sessionlessLoads: 0
          });
        }
      }
      await exerciseAssessedNext(page, width, check);
      if (retrySessionVariant) await exerciseAssessedNext(page, width, check, true);
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
  } finally {
    await harness.close();
  }
  console.log(`${passed} passed, ${failed} failed, ${skipped} skipped`);
  if (failures.length) throw new Error(`Phase 2 browser failures:\n${failures.join('\n')}`);
}
run().catch(error => { console.error(error); process.exitCode = 1; });
