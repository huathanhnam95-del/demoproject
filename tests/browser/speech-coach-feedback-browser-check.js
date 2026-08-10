/**
 * Speech Coach Feedback UI Bugfixes Browser Check
 * Tests all 5 user points:
 * 1. Accordion down arrows expand reduced words cards without double-toggling
 * 2. Single word titles like "have" display full text without "h.." truncation
 * 3. Successful links section displays expandable cards with reasons for success and coaching tips
 * 4. Clicking ? / ⓘ info icons opens educational Speech Coach info modals
 * 5. Speech Coach feedback has no redundant layer-navigation row and keeps all event families visible
 */
const { chromium } = require('playwright');
const express = require('express');
const fs = require('fs');
const path = require('path');

(async () => {
  const runScenario = async (name, callback) => {
    console.log(`SCENARIO ${name}`);
    return callback();
  };
  const app = express();
  app.use(express.static(path.join(__dirname, '../../public')));
  const server = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`Test server running on ${baseUrl}`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  const ignoredExternalErrors = [];
  const unexpectedConsoleErrors = [];
  page.on('console', msg => {
    if (msg.type() !== 'error') return;
    const message = msg.text();
    if (/firebase|firestore|securetoken|ERR_CONNECTION_|Failed to load resource|Database error \(getWord\)|Error fetching word data|blob:recording/i.test(message)) {
      ignoredExternalErrors.push(message);
      return;
    }
    unexpectedConsoleErrors.push(message);
    console.log('PAGE ERROR:', message);
  });

  await page.addInitScript(() => {
    sessionStorage.setItem('onboarding_complete', 'true');
    sessionStorage.setItem('user_scope', 'pte');
    localStorage.setItem('readAloudTutorialCompleted', 'true');
  });

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => typeof window.ReadAloudMode !== 'undefined', null, { timeout: 15000 });

  const visualArtifactDir = path.join(__dirname, '../../test-results/speech-coach-navigation');
  fs.mkdirSync(visualArtifactDir, { recursive: true });

  // Initialize Read Aloud mode instance
  await page.evaluate(() => {
    if (typeof switchToMode === 'function') switchToMode('read-aloud');
    else if (typeof window.switchToMode === 'function') window.switchToMode('read-aloud');
  });
  await page.waitForFunction(() => {
    const mode = window.ReadAloudMode || window.currentPracticeModeInstance;
    return !!mode && !!document.getElementById('ra-result-box');
  }, null, { timeout: 15000 });
  await page.waitForFunction(() => {
    const preloader = document.getElementById('app-preloader');
    return !preloader || getComputedStyle(preloader).display === 'none' || getComputedStyle(preloader).visibility === 'hidden';
  }, null, { timeout: 15000 });
  const guestModeButton = page.locator('#guest-mode-btn');
  if (await guestModeButton.isVisible().catch(() => false)) {
    await guestModeButton.click();
    await guestModeButton.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  }
  const guestToastClose = page.locator('#toast-close');
  if (await guestToastClose.isVisible().catch(() => false)) {
    await guestToastClose.click();
  }

  // Trigger renderConnectedSpeechResults with test events
  const testResults = await runScenario('feedback lifecycle, modes, tooltips, races, and playback', () => page.evaluate(async () => {
    const raMode = window.ReadAloudMode || window.currentPracticeModeInstance;
    if (!raMode || typeof raMode.renderConnectedSpeechResults !== 'function') {
      return { error: 'ReadAloudMode instance not found' };
    }

    const mockData = {
      status: 'available',
      summary: { detectedCount: 3, notDetectedCount: 1, uncertainCount: 0 },
      events: [
        {
          phrase: 'Pick it',
          category: 'linking',
          status: 'detected',
          startMs: 100,
          endMs: 500,
          feedbackText: 'Smooth transition between Pick and it'
        },
        {
          phrase: 'and',
          category: 'weak_forms',
          status: 'detected',
          startMs: 1200,
          endMs: 1450,
          feedbackText: 'Good weak form /ən/'
        },
        {
          phrase: 'and',
          category: 'weak_forms',
          status: 'not_detected',
          startMs: 4200,
          endMs: 4550,
          feedbackText: 'Strong form used instead of weak form'
        },
        {
          phrase: 'have',
          category: 'weak_forms',
          status: 'not_detected',
          startMs: 9340,
          endMs: 9600,
          feedbackText: 'Strong pronunciation /hæv/ used'
        },
        {
          phrase: 'Pancreatic cancer',
          category: 'linking',
          status: 'detected',
          startMs: 1420,
          endMs: 1890,
          feedbackText: 'Smooth C-V transition'
        },
        {
          phrase: 'cancer is',
          category: 'consonant_to_vowel',
          status: 'detected',
          startMs: 2280,
          endMs: 2600,
          feedbackText: 'Linked /r/ to /ɪ/'
        },
        {
          phrase: 'about the',
          category: 'linking',
          status: 'not_detected',
          startMs: 16320,
          endMs: 16800,
          feedbackText: 'Unnatural pause of 320ms detected'
        },
        {
          phrase: 'in mathematics',
          category: 'sound_changes',
          family: 'n_bilabial_assimilation',
          status: 'detected',
          startMs: 18100,
          endMs: 18600,
          feedbackText: 'Final /n/ assimilated to /m/'
        }
      ]
    };

    const initialRenderOutcome = await raMode.renderConnectedSpeechResults(mockData, {
      transcriptText: 'Pancreatic cancer is tricky to manage because it spreads easily and early, and the tumors have a unique biological makeup.',
      sessionViewMode: 'advanced'
    });

    window.__wordPlaybackStarts = [];
    raMode.assessmentAudioBuffer = { duration: 2 };
    raMode.wordPlaybackContext = {
      state: 'running',
      currentTime: 0,
      destination: {},
      createBufferSource() {
        return {
          connect() {},
          start(...args) { window.__wordPlaybackStarts.push(args); },
          stop() { window.__wordPlaybackStops = Number(window.__wordPlaybackStops || 0) + 1; },
          onended: null
        };
      }
    };

    await raMode.renderRecognizedTranscript([
      { word: 'Pick', accuracyScore: 93, errorType: 'None', startMs: 100, endMs: 300 },
      { word: 'it', accuracyScore: 91, errorType: 'None', startMs: 320, endMs: 500 },
      { word: 'extra', accuracyScore: 45, errorType: 'Insertion', startMs: 520, endMs: 700 },
      { word: 'missing', accuracyScore: 0, errorType: 'Omission', startMs: null, endMs: null }
    ], 'Pick it extra', mockData.events);

    const checks = {};
    checks.speechCoachHelperLoaded = typeof window.ReadAloudSpeechCoach?.buildResultModel === 'function';
    checks.resultRenderReturnsOutcome = initialRenderOutcome?.visible === true
      && initialRenderOutcome?.reason === 'visible'
      && Number.isInteger(initialRenderOutcome?.revision);

    const mergedTranscript = document.getElementById('ra-merged-recognized-transcript');
    checks.mergedTranscriptExists = !!mergedTranscript;
    checks.mergedTranscriptHasAllWords = mergedTranscript?.querySelectorAll('.ra-word-token').length === 4;
    checks.omittedWordIsNonPlayable = !!mergedTranscript?.querySelector('.ra-word-token[data-error-type="Omission"]:not([data-playable="true"])');
    checks.insertedWordIsBracketed = mergedTranscript?.querySelector('.ra-word-token[data-error-type="Insertion"]')?.textContent.trim() === '[extra]';
    checks.transcriptInstructionVisible = /Ctrl\+click/.test(document.getElementById('ra-transcript-instruction')?.textContent || '');
    checks.duplicateCoachTranscriptRemoved = (document.getElementById('ra-connected-speech-paragraph')?.textContent || '').trim() === '';

    window.__speechCoachScrollCalls = 0;
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = function () { window.__speechCoachScrollCalls += 1; };
    const playableToken = mergedTranscript?.querySelector('.ra-word-token[data-word-index="0"]');
    playableToken?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    checks.hoverDoesNotScroll = window.__speechCoachScrollCalls === 0;
    checks.hoverHighlightsMatchingFeedback = !!document.querySelector('#ra-connected-speech-list .sc-card--hovered');
    playableToken?.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    playableToken?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    checks.normalClickDoesNotNavigate = window.__speechCoachScrollCalls === 0;
    checks.normalClickSchedulesExactWord = window.__wordPlaybackStarts.length === 1
      && Math.abs(window.__wordPlaybackStarts[0][1] - 0.1) < 0.000001
      && Math.abs(window.__wordPlaybackStarts[0][2] - 0.2) < 0.000001;
    playableToken?.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    checks.ctrlClickNavigates = window.__speechCoachScrollCalls > 0;
    checks.ctrlClickDoesNotReplay = window.__wordPlaybackStarts.length === 1;
    HTMLElement.prototype.scrollIntoView = originalScrollIntoView;

    const hoveredCard = document.querySelector('#ra-connected-speech-list [data-event-index="0"]');
    hoveredCard?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: null }));
    const coachHoverHighlightsTranscript = document.querySelectorAll('#ra-merged-recognized-transcript .sc-token--hovered').length > 0;
    hoveredCard?.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
    checks.coachHoverHighlightsTranscript = coachHoverHighlightsTranscript;
    checks.coachHoverExitClearsTranscript = document.querySelectorAll('#ra-merged-recognized-transcript .sc-token--hovered').length === 0;

    await raMode.renderRecognizedTranscript([
      { word: 'and', accuracyScore: 90, errorType: 'None', startMs: 100, endMs: 200 },
      { word: 'and', accuracyScore: 70, errorType: 'None', startMs: 500, endMs: 600 }
    ], 'and and', [{ phrase: 'and', status: 'not_detected', startMs: 480, endMs: 580 }]);
    const repeatedTokens = Array.from(document.querySelectorAll('#ra-merged-recognized-transcript .ra-word-token'));
    checks.repeatedWordsUseTimestampOverlap = repeatedTokens.length === 2
      && !repeatedTokens[0].hasAttribute('data-event-index')
      && repeatedTokens[1].getAttribute('data-event-index') === '0';

    raMode.stopRecordedWordPlayback();
    window.__wordPlaybackStarts = [];
    window.__wordPlaybackStops = 0;
    repeatedTokens[0]?.click();
    repeatedTokens[1]?.click();
    checks.rapidClicksStopPreviousSource = window.__wordPlaybackStarts.length === 2 && window.__wordPlaybackStops === 1;

    raMode.stopRecordedWordPlayback();
    const decodedPlaybackOutcome = await raMode.playRecordedWordSegment(100, 200, repeatedTokens[0]);
    checks.decodedPlaybackReturnsOutcome = decodedPlaybackOutcome?.started === true
      && decodedPlaybackOutcome?.source === 'decoded-buffer'
      && decodedPlaybackOutcome?.reason === 'started';

    raMode.stopRecordedWordPlayback();
    raMode.assessmentAudioBuffer = null;
    await raMode.renderRecognizedTranscript([
      { word: 'silent', accuracyScore: 90, errorType: 'None', startMs: 100, endMs: 200 }
    ], 'silent', []);
    const unavailableToken = document.querySelector('#ra-merged-recognized-transcript .ra-word-token');
    const startsBeforeUnavailableClick = window.__wordPlaybackStarts.length;
    unavailableToken?.click();
    checks.missingAudioMakesTokenUnavailable = unavailableToken?.dataset.playable === 'false'
      && window.__wordPlaybackStarts.length === startsBeforeUnavailableClick;

    raMode.assessmentAudioBuffer = { duration: 2 };
    await raMode.renderRecognizedTranscript([
      { word: 'cleanup', accuracyScore: 90, errorType: 'None', startMs: 100, endMs: 200 }
    ], 'cleanup', []);
    document.querySelector('#ra-merged-recognized-transcript .ra-word-token')?.click();
    raMode.cleanup();
    checks.cleanupClearsWordPlaybackState = raMode.assessmentAudioBuffer === null && raMode.wordPlaybackSource === null;

    // Check 1: Single word "have" title is not truncated to "h.."
    const haveTitleEl = Array.from(document.querySelectorAll('.sc-word-title')).find(el => el.textContent.trim() === 'have');
    checks.haveTitleExists = !!haveTitleEl;
    checks.haveTitleText = haveTitleEl ? haveTitleEl.textContent.trim() : null;

    // Check 2: Accordion toggle functionality on "and" multiple card
    const toggleBtn = document.querySelector('[data-sc-accordion-toggle="sc-accordion-red-0"]');
    checks.accordionToggleExists = !!toggleBtn;
    if (toggleBtn) {
      toggleBtn.click();
      const contentEl = document.getElementById('sc-accordion-red-0');
      checks.accordionExpandedOnClick = toggleBtn.getAttribute('aria-expanded') === 'true' && contentEl && !contentEl.hidden;
    }

    // Check 3: Successful links expandable cards
    const successCardToggle = document.querySelector('[data-sc-accordion-toggle="sc-success-acc-0"]');
    checks.successCardExists = !!successCardToggle;
    if (successCardToggle) {
      if (successCardToggle.getAttribute('aria-expanded') !== 'true') successCardToggle.click();
      const successContent = document.getElementById('sc-success-acc-0');
      checks.successCardExpanded = successCardToggle.getAttribute('aria-expanded') === 'true' && successContent && !successContent.hidden;
      checks.successReasonTextPresent = successContent ? successContent.textContent.includes('Seamless Link') || successContent.textContent.includes('Why you nailed it') : false;
    }

    // Check 4: Info tip ? / ⓘ button click opens modal
    const infoTip = document.querySelector('.sc-info-tip[data-sc-info="reduced"]');
    checks.infoTipExists = !!infoTip;
    if (infoTip) {
      infoTip.click();
      const modal = document.getElementById('sc-info-modal-overlay');
      checks.infoModalOpens = modal && getComputedStyle(modal).display !== 'none';
      checks.infoModalTitle = modal ? modal.querySelector('h3')?.textContent : null;
      // Close modal
      document.getElementById('sc-info-modal-close')?.click();
    }

    // Check 5: No redundant layer row; all feedback families remain visible together
    checks.redundantLayerRowAbsent = !document.getElementById('ra-connected-speech-layers');
    checks.legacyLayerButtonsAbsent = !document.getElementById('ra-layer-level1') && !document.getElementById('ra-layer-level2');
    const sectionHeadings = Array.from(document.querySelectorAll('.sc-section-header')).map(el => el.textContent.trim());
    checks.reducedSectionVisible = sectionHeadings.some(text => text.startsWith('Reduced Words'));
    checks.linkingSectionVisible = sectionHeadings.some(text => text.startsWith('Needs Attention') || text.startsWith('Successful Links'));
    checks.soundChangesSectionVisible = sectionHeadings.some(text => text.startsWith('Sound Changes'));
    const listGrid = document.getElementById('ra-connected-speech-list');
    checks.feedbackGridUsesResponsiveColumns = !!listGrid && getComputedStyle(listGrid).gridTemplateColumns.split(' ').length === 2;

    // Check 6: Single-family results do not render an empty companion column
    await raMode.renderConnectedSpeechResults({
      status: 'available',
      summary: { detectedCount: 1, notDetectedCount: 0, uncertainCount: 0 },
      events: [{
        phrase: 'and',
        category: 'weak_forms',
        status: 'detected',
        startMs: 1200,
        endMs: 1450,
        feedbackText: 'Good weak form /ən/'
      }]
    }, { transcriptText: 'and', sessionViewMode: 'advanced' });
    checks.singleFamilyHasOnePopulatedColumn = listGrid.querySelectorAll(':scope > .sc-grid-left, :scope > .sc-grid-right').length === 1;

    // Check 7: Empty results do not leave blank grid columns behind
    await raMode.renderConnectedSpeechResults({
      status: 'available',
      summary: { detectedCount: 0, notDetectedCount: 0, uncertainCount: 0 },
      events: []
    }, { transcriptText: 'No connected speech patterns.', sessionViewMode: 'advanced' });
    checks.emptyResultsHaveNoColumns = listGrid.querySelectorAll(':scope > .sc-grid-left, :scope > .sc-grid-right').length === 0;

    const modeEvents = [
      { phrase: 'link words', category: 'linking', status: 'detected', startMs: 100, endMs: 300, feedbackText: 'Good linking.' },
      { phrase: 'uncertain pair', category: 'linking', status: 'uncertain', startMs: 400, endMs: 600, feedbackText: 'Try the link again.' },
      { phrase: 'the', category: 'weak_forms', status: 'not_detected', startMs: 700, endMs: 900, feedbackText: 'Use the weak form.' },
      { phrase: 'in mathematics', category: 'sound_changes', family: 'n_bilabial_assimilation', status: 'detected', startMs: 1000, endMs: 1200, feedbackText: 'Blend the boundary.' }
    ];

    raMode.assessmentAudioBuffer = { duration: 2 };
    await raMode.renderConnectedSpeechResults({
      status: 'available',
      summary: { detectedCount: 4, notDetectedCount: 0, uncertainCount: 0 },
      events: modeEvents
    }, {
      transcriptText: 'link words the',
      words: [
        { word: 'link', accuracyScore: 95, errorType: 'None', startMs: 100, endMs: 300 },
        { word: 'the', accuracyScore: 45, errorType: 'Mispronunciation', startMs: 700, endMs: 900 }
      ],
      sessionViewMode: 'advanced',
      sessionConnectedSpeechModes: []
    });
    const noModeTokens = Array.from(document.querySelectorAll('#ra-merged-recognized-transcript .ra-word-token'));
    checks.noModesHideCoachPanel = getComputedStyle(document.getElementById('ra-connected-speech-box')).display === 'none';
    checks.noModesKeepRecognizedTranscript = noModeTokens.length === 2;
    checks.noModesKeepAccuracyColors = noModeTokens.some((token) => token.classList.contains('ra-word-token--success'))
      && noModeTokens.some((token) => token.classList.contains('ra-word-token--error'));
    checks.noModesShowGuidance = /For detailed Speech Coach feedback next time/i.test(document.getElementById('ra-feedback-mode-hint')?.textContent || '');
    const detailedHintTrigger = document.querySelector('#ra-feedback-mode-hint .ra-feedback-mode-hint__trigger');
    const detailedTooltip = document.querySelector('#ra-feedback-mode-hint [role="tooltip"]');
    checks.noModesUseAccessibleTooltip = !!detailedHintTrigger
      && !!detailedTooltip
      && detailedHintTrigger.getAttribute('aria-describedby') === detailedTooltip.id
      && detailedTooltip.hidden;
    detailedHintTrigger?.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
    checks.tooltipOpensOnHover = detailedTooltip?.hidden === false;
    detailedHintTrigger?.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true, relatedTarget: document.body }));
    checks.tooltipClosesOnPointerExit = detailedTooltip?.hidden === true;
    const resultBox = document.getElementById('ra-result-box');
    if (resultBox) resultBox.style.display = 'block';
    detailedHintTrigger?.focus();
    checks.tooltipOpensOnFocus = detailedTooltip?.hidden === false;
    detailedHintTrigger?.blur();
    checks.tooltipClosesOnFocusExit = detailedTooltip?.hidden === true;
    detailedHintTrigger?.click();
    checks.tooltipOpensOnClick = detailedTooltip?.hidden === false;
    document.body.click();
    checks.tooltipClosesOnOutsideClick = detailedTooltip?.hidden === true;
    detailedHintTrigger?.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    checks.tooltipClosesOnEscape = detailedTooltip?.hidden === true;
    raMode.lastAssessmentPayload = {
      recognizedText: 'link words the',
      connectedSpeech: { status: 'available', summary: {}, events: modeEvents }
    };
    raMode.lastAssessmentSession = { sessionViewMode: 'basic', sessionConnectedSpeechModes: [] };
    const noModeToggleOutcome = await raMode.toggleAdvancedAnalysisView();
    checks.noModesCannotReopenCoachPanel = getComputedStyle(document.getElementById('ra-connected-speech-box')).display === 'none'
      && noModeToggleOutcome?.reason === 'no_modes';

    await raMode.renderConnectedSpeechResults({
      status: 'available',
      summary: { detectedCount: 99, notDetectedCount: 0, uncertainCount: 0 },
      events: modeEvents
    }, {
      transcriptText: 'link words the',
      sessionViewMode: 'advanced',
      sessionConnectedSpeechModes: ['linking']
    });
    const partialHeadings = Array.from(document.querySelectorAll('.sc-section-header')).map((node) => node.textContent.trim());
    checks.partialModesFilterSections = partialHeadings.some((text) => text.startsWith('Successful Links'))
      && !partialHeadings.some((text) => text.startsWith('Reduced Words'))
      && !partialHeadings.some((text) => text.startsWith('Sound Changes'));
    checks.partialModesDeriveAttentionCount = /You nailed 1 pattern! 1 needs attention\./i.test(document.getElementById('ra-connected-speech-summary')?.textContent || '');
    checks.partialModesShowGuidance = /For fuller feedback next time/i.test(document.getElementById('ra-connected-speech-mode-hint')?.textContent || '');
    checks.partialModesUseTooltipTrigger = !!document.querySelector('#ra-connected-speech-mode-hint .ra-feedback-mode-hint__trigger');

    raMode.lastAssessmentSession = { sessionViewMode: 'advanced', sessionConnectedSpeechModes: ['linking'] };
    raMode.connectedSpeechModes = new Set(['reduced_words']);
    await raMode.renderConnectedSpeechResults({ status: 'available', summary: {}, events: modeEvents }, { transcriptText: 'link words the' });
    const snapshotHeadings = Array.from(document.querySelectorAll('.sc-section-header')).map((node) => node.textContent.trim());
    checks.modeSnapshotSurvivesLaterToggle = snapshotHeadings.some((text) => text.startsWith('Successful Links'))
      && !snapshotHeadings.some((text) => text.startsWith('Reduced Words'));

    await raMode.renderConnectedSpeechResults({
      status: 'available',
      summary: { detectedCount: 0, notDetectedCount: 0, uncertainCount: 0 },
      events: modeEvents
    }, {
      transcriptText: 'link words the',
      sessionViewMode: 'advanced',
      sessionConnectedSpeechModes: ['linking', 'reduced_words', 'sound_changes']
    });
    const allHeadings = Array.from(document.querySelectorAll('.sc-section-header')).map((node) => node.textContent.trim());
    checks.allModesShowAllSections = allHeadings.some((text) => text.startsWith('Reduced Words'))
      && allHeadings.some((text) => text.startsWith('Needs Attention'))
      && allHeadings.some((text) => text.startsWith('Sound Changes'));
    checks.allModesHideGuidance = !(document.getElementById('ra-connected-speech-mode-hint')?.textContent || '').trim();
    checks.allModesRemoveGuidanceTrigger = !document.querySelector('#ra-connected-speech-mode-hint .ra-feedback-mode-hint__trigger');

    const threeAttentionEvents = [
      { phrase: 'good link', category: 'linking', status: 'detected', startMs: 100, endMs: 200 },
      { phrase: 'first uncertain', category: 'linking', status: 'uncertain', startMs: 300, endMs: 400 },
      { phrase: 'second uncertain', category: 'linking', status: 'UNCERTAIN', startMs: 500, endMs: 600 },
      { phrase: 'missed link', category: 'linking', status: 'not-detected', startMs: 700, endMs: 800 }
    ];
    await raMode.renderConnectedSpeechResults({ status: 'available', events: threeAttentionEvents }, {
      transcriptText: 'good link first uncertain second uncertain missed link',
      sessionViewMode: 'advanced',
      sessionConnectedSpeechModes: ['linking']
    });
    const attentionSection = Array.from(document.querySelectorAll('.sc-section')).find((section) => /Needs Attention/i.test(section.querySelector('.sc-section-header')?.textContent || ''));
    checks.threeAttentionItemsMatchHeadline = attentionSection?.querySelectorAll('.sc-accordion-card, .sc-single-card').length === 3
      && /You nailed 1 pattern! 3 need attention\./i.test(document.getElementById('ra-connected-speech-summary')?.textContent || '');

    const recordingAudio = document.getElementById('ra-user-recording-audio');
    const originalAudioPlay = recordingAudio?.play;
    let fallbackPlayCalls = 0;
    let metadataReady = false;
    if (recordingAudio) {
      recordingAudio.src = 'blob:recording';
      recordingAudio.play = () => { fallbackPlayCalls += 1; return Promise.resolve(); };
      Object.defineProperty(recordingAudio, 'readyState', { configurable: true, get: () => metadataReady ? 1 : 0 });
    }
    raMode.assessmentAudioBuffer = null;
    raMode.userRecordingUrl = 'blob:recording';
    await raMode.renderConnectedSpeechResults({ status: 'available', summary: {}, events: [modeEvents[0]] }, {
      transcriptText: 'link words',
      sessionViewMode: 'advanced',
      sessionConnectedSpeechModes: ['linking']
    });
    const fallbackButton = document.querySelector('.sc-play-word-btn');
    const nativePlayback = raMode.playRecordedWordSegment(100, 300, fallbackButton);
    await Promise.resolve();
    checks.nativePlaybackWaitsForMetadata = fallbackPlayCalls === 0;
    metadataReady = true;
    recordingAudio?.dispatchEvent(new Event('loadedmetadata'));
    const nativeOutcome = await nativePlayback;
    checks.recordingAudioFallbackPlays = fallbackPlayCalls === 1
      && nativeOutcome?.started === true
      && nativeOutcome?.source === 'native-audio';

    raMode.stopRecordedWordPlayback();
    if (recordingAudio) recordingAudio.play = () => Promise.reject(new Error('test rejection'));
    const rejectedOutcome = await raMode.playRecordedWordSegment(100, 300, fallbackButton);
    checks.nativePlayRejectionReturnsReason = rejectedOutcome?.started === false
      && rejectedOutcome?.source === 'native-audio'
      && rejectedOutcome?.reason === 'play_rejected'
      && !fallbackButton?.classList.contains('is-playing');

    let stalePlayCalls = 0;
    metadataReady = false;
    if (recordingAudio) recordingAudio.play = () => { stalePlayCalls += 1; return Promise.resolve(); };
    const staleNativePlayback = raMode.playRecordedWordSegment(100, 300, fallbackButton);
    await Promise.resolve();
    raMode.assessmentAudioBuffer = { duration: 2 };
    const replacementButton = document.createElement('button');
    replacementButton.className = 'sc-play-word-btn';
    replacementButton.innerHTML = '<span>Yours</span>';
    const replacementOutcome = await raMode.playRecordedWordSegment(400, 600, replacementButton);
    metadataReady = true;
    recordingAudio?.dispatchEvent(new Event('loadedmetadata'));
    const staleOutcome = await staleNativePlayback;
    checks.staleNativeCallbackIsCancelled = replacementOutcome?.started === true
      && staleOutcome?.reason === 'stale'
      && stalePlayCalls === 0;
    raMode.stopRecordedWordPlayback();
    raMode.assessmentAudioBuffer = null;
    if (recordingAudio) {
      recordingAudio.removeAttribute('src');
      if (originalAudioPlay) recordingAudio.play = originalAudioPlay;
    }
    raMode.userRecordingUrl = null;
    await raMode.renderConnectedSpeechResults({ status: 'available', summary: {}, events: [modeEvents[0]] }, {
      transcriptText: 'link words',
      sessionViewMode: 'advanced',
      sessionConnectedSpeechModes: ['linking']
    });
    const unavailableYours = document.querySelector('.sc-play-word-btn');
    checks.missingRecordingSourceDisablesYours = !!unavailableYours
      && unavailableYours.disabled
      && unavailableYours.getAttribute('aria-disabled') === 'true'
      && /unavailable/i.test(unavailableYours.getAttribute('aria-label') || '');

    let interactionPlaybackCalls = 0;
    const originalPlayAudioSegment = raMode.playAudioSegment;
    raMode.playAudioSegment = (...args) => {
      interactionPlaybackCalls += 1;
      return originalPlayAudioSegment.apply(raMode, args);
    };
    raMode.assessmentAudioBuffer = { duration: 2 };
    await raMode.renderConnectedSpeechResults({ status: 'available', summary: {}, events: [modeEvents[0]] }, {
      transcriptText: 'link words',
      sessionViewMode: 'advanced',
      sessionConnectedSpeechModes: ['linking']
    });
    await raMode.renderConnectedSpeechResults({ status: 'available', summary: {}, events: [modeEvents[0]] }, {
      transcriptText: 'link words',
      sessionViewMode: 'advanced',
      sessionConnectedSpeechModes: ['linking']
    });
    document.querySelector('.sc-play-word-btn')?.click();
    checks.interactionBindingIsIdempotent = interactionPlaybackCalls === 1;
    raMode.playAudioSegment = originalPlayAudioSegment;

    const originalManifestLoader = raMode.loadSpeechCoachAudioManifest;
    const originalPronunciationPrimer = raMode.primeSharedPronunciations;
    const pendingManifests = [];
    raMode.loadSpeechCoachAudioManifest = () => new Promise((resolve) => pendingManifests.push(resolve));
    raMode.primeSharedPronunciations = () => Promise.resolve();
    const olderRender = raMode.renderConnectedSpeechResults({
      status: 'available',
      events: [{ phrase: 'older link', category: 'linking', status: 'detected', startMs: 100, endMs: 200 }]
    }, { transcriptText: 'older link', sessionViewMode: 'advanced', sessionConnectedSpeechModes: ['linking'] });
    await Promise.resolve();
    const newerRender = raMode.renderConnectedSpeechResults({
      status: 'available',
      events: [{ phrase: 'newer link', category: 'linking', status: 'uncertain', startMs: 300, endMs: 400 }]
    }, { transcriptText: 'newer link', sessionViewMode: 'advanced', sessionConnectedSpeechModes: ['linking'] });
    await Promise.resolve();
    pendingManifests[1]?.(null);
    const newerOutcome = await newerRender;
    pendingManifests[0]?.(null);
    const olderOutcome = await olderRender;
    checks.newerRenderWinsAsyncRace = newerOutcome?.visible === true
      && olderOutcome?.reason === 'stale'
      && /newer link/i.test(document.getElementById('ra-connected-speech-list')?.textContent || '')
      && !/older link/i.test(document.getElementById('ra-connected-speech-list')?.textContent || '');
    raMode.loadSpeechCoachAudioManifest = originalManifestLoader;
    raMode.primeSharedPronunciations = originalPronunciationPrimer;

    const originalGetPromptAnalysis = raMode.getPromptAnalysis;
    let resolveDeferredAnalysis;
    const deferredAnalysis = new Promise((resolve) => { resolveDeferredAnalysis = resolve; });
    raMode.isActive = true;
    raMode.state = 'PREP';
    raMode.connectedSpeechModes = new Set(['linking']);
    raMode.currentPromptPlainText = 'link it';
    raMode.activePromptKey = 'hydration-race';
    raMode.activePromptRenderToken += 1;
    raMode.currentPromptRenderState = { blockedBoundarySet: new Set(), wordMap: new Map() };
    raMode.getPromptAnalysis = () => deferredAnalysis;
    const deferredHydration = raMode.hydrateLinkingView(raMode.activePromptKey, raMode.activePromptRenderToken);
    await Promise.resolve();
    raMode.state = 'RESULTS';
    await raMode.renderConnectedSpeechResults({
      status: 'available',
      events: [{ phrase: 'link it', category: 'linking', status: 'detected', startMs: 100, endMs: 300 }]
    }, { transcriptText: 'link it', sessionViewMode: 'advanced', sessionConnectedSpeechModes: ['linking'] });
    resolveDeferredAnalysis(window.ReadAloudLinking.analyzePrompt('link it', {
      connectedSpeechLevel: 'sound_changes',
      enabledRuleSet: 'connected-speech-v3'
    }));
    await deferredHydration;
    await new Promise((resolve) => requestAnimationFrame(() => resolve()));
    checks.deferredPromptHydrationCannotOverwriteResults = raMode.connectedSpeechPanelMode === 'results'
      && document.getElementById('ra-connected-speech-meta')?.textContent.trim() === 'Feedback';
    raMode.getPromptAnalysis = originalGetPromptAnalysis;

    const originalMediaDevices = navigator.mediaDevices;
    let resolveMicrophone;
    const microphoneRequest = new Promise((resolve) => { resolveMicrophone = resolve; });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: () => microphoneRequest }
    });
    raMode.state = 'PREP';
    raMode.isActive = true;
    raMode.currentPromptPlainText = 'record this prompt';
    raMode.connectedSpeechModes = new Set(['linking', 'reduced_words']);
    const recordingStart = raMode.startRecording();
    const recordingModeSnapshot = raMode.currentRecordingSession?.sessionConnectedSpeechModes;
    raMode.connectedSpeechModes.clear();
    checks.recordingSessionKeepsImmutableModeSnapshot = Object.isFrozen(recordingModeSnapshot)
      && JSON.stringify(recordingModeSnapshot) === JSON.stringify(['linking', 'reduced_words']);
    if (raMode.currentRecordingSession) raMode.currentRecordingSession.disposition = 'discard';
    resolveMicrophone({ getTracks: () => [{ stop() {} }] });
    await recordingStart;
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: originalMediaDevices
    });

    return checks;
  }));

  await page.evaluate(async () => {
    const raMode = window.ReadAloudMode || window.currentPracticeModeInstance;
    await raMode.renderConnectedSpeechResults({
      status: 'available',
      summary: { detectedCount: 3, notDetectedCount: 0, uncertainCount: 0 },
      events: [
        { phrase: 'and', category: 'weak_forms', status: 'detected', startMs: 1200, endMs: 1450 },
        { phrase: 'Pancreatic cancer', category: 'linking', status: 'detected', startMs: 1420, endMs: 1890 },
        { phrase: 'in mathematics', category: 'sound_changes', family: 'n_bilabial_assimilation', status: 'detected', startMs: 18100, endMs: 18600 }
      ]
    }, { transcriptText: 'Pancreatic cancer and in mathematics.', sessionViewMode: 'advanced' });
  });
  await page.evaluate(() => {
    document.querySelectorAll('df-messenger').forEach((element) => { element.style.display = 'none'; });
    const chatTrigger = document.getElementById('bel-chat-trigger');
    if (chatTrigger) chatTrigger.style.display = 'none';
  });
  await page.screenshot({ path: path.join(visualArtifactDir, 'speech-coach-navigation-desktop.png'), fullPage: true });
  const layoutWidths = [390, 768, 900, 1036, 1280];
  const layoutResults = {};
  await runScenario('responsive geometry at required Chrome widths', async () => {
  for (const width of layoutWidths) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForFunction((expectedWidth) => window.innerWidth === expectedWidth, width);
    await page.evaluate(async () => {
      const raMode = window.ReadAloudMode || window.currentPracticeModeInstance;
      const modePanel = document.getElementById('mode-read-aloud');
      const controller = modePanel?.querySelector('.spc-controller');
      if (modePanel) modePanel.dataset.spcView = 'advanced';
      if (controller) controller.dataset.spcView = 'advanced';
      raMode.assessmentAudioBuffer = { duration: 20 };
      const connectedSpeech = {
        status: 'available',
        summary: {},
        events: [
          { phrase: 'and', category: 'weak_forms', status: 'detected', startMs: 1200, endMs: 1450 },
          { phrase: 'Pancreatic cancer', category: 'linking', status: 'uncertain', startMs: 1420, endMs: 1890 },
          { phrase: 'in mathematics', category: 'sound_changes', family: 'n_bilabial_assimilation', status: 'not_detected', startMs: 18100, endMs: 18600 }
        ]
      };
      raMode.state = 'RESULTS';
      raMode.lastAssessmentPayload = { recognizedText: 'Pancreatic cancer and in mathematics.', connectedSpeech };
      raMode.lastAssessmentSession = {
        sessionViewMode: 'advanced',
        sessionConnectedSpeechModes: ['linking', 'reduced_words', 'sound_changes']
      };
      await raMode.renderConnectedSpeechResults(connectedSpeech, {
        transcriptText: 'Pancreatic cancer and in mathematics.',
        sessionViewMode: 'advanced',
        sessionConnectedSpeechModes: ['linking', 'reduced_words', 'sound_changes']
      });
      raMode.setSpeechCoachModeHint(
        'ra-connected-speech-mode-hint',
        window.ReadAloudSpeechCoach.getGuidance(['linking'])
      );
      document.querySelector('#ra-connected-speech-mode-hint .ra-feedback-mode-hint__trigger')?.click();
    });
    layoutResults[width] = await page.evaluate(() => {
      const panel = document.getElementById('ra-connected-speech-box');
      const list = document.getElementById('ra-connected-speech-list');
      const panelRect = panel?.getBoundingClientRect();
      const raMode = window.ReadAloudMode || window.currentPracticeModeInstance;
      const cards = Array.from(list?.querySelectorAll('.sc-accordion-card, .sc-single-card') || []);
      const overflowingCards = cards.filter(card => card.scrollWidth > card.clientWidth + 1).length;
      const controlGeometry = Array.from(list?.querySelectorAll('.sc-audio-btn') || []).map((button) => {
        const card = button.closest('.sc-accordion-card, .sc-single-card');
        const buttonRect = button.getBoundingClientRect();
        const cardRect = card?.getBoundingClientRect();
        return {
          label: button.textContent.trim(),
          inside: !!cardRect
          && buttonRect.left >= cardRect.left - 1
          && buttonRect.right <= cardRect.right + 1,
          button: [buttonRect.left, buttonRect.right],
          card: cardRect ? [cardRect.left, cardRect.right] : null
        };
      });
      const controlsInsideCards = controlGeometry.every((item) => item.inside);
      const tooltip = panel?.querySelector('[role="tooltip"]:not([hidden])');
      const tooltipRect = tooltip?.getBoundingClientRect();
      const statusesInsideCards = Array.from(list?.querySelectorAll('.sc-status-badge') || []).every((status) => {
        const card = status.closest('.sc-accordion-card, .sc-single-card');
        const statusRect = status.getBoundingClientRect();
        const cardRect = card?.getBoundingClientRect();
        return !!cardRect && statusRect.left >= cardRect.left - 1 && statusRect.right <= cardRect.right + 1;
      });
      return {
        speechCoachVisible: !!panelRect && panelRect.width > 0 && panelRect.height > 0 && getComputedStyle(panel).display !== 'none',
        speechCoachShowsResults: raMode?.connectedSpeechPanelMode === 'results'
          && document.getElementById('ra-connected-speech-meta')?.textContent.trim() === 'Feedback',
        speechCoachFitsViewport: !!panelRect && panelRect.left >= -1 && panelRect.right <= window.innerWidth + 1,
        feedbackListFitsPanel: !!list && list.scrollWidth <= list.clientWidth + 1,
        cardsWithoutHorizontalOverflow: overflowingCards === 0,
        controlsInsideCards,
        statusesInsideCards,
        tooltipInsidePanel: !!tooltipRect && !!panelRect
          && tooltipRect.left >= panelRect.left - 1
          && tooltipRect.right <= panelRect.right + 1,
        panelDoesNotHideOverflow: getComputedStyle(panel).overflowX !== 'hidden',
        listDoesNotHideOverflow: getComputedStyle(list).overflowX !== 'hidden'
        , diagnostics: {
          list: list ? [list.clientWidth, list.scrollWidth] : null,
          overflowingCards: cards.filter((card) => card.scrollWidth > card.clientWidth + 1).map((card) => [card.className, card.clientWidth, card.scrollWidth]),
          overflowingControls: controlGeometry.filter((item) => !item.inside)
        }
      };
    });
    const coachPanel = page.locator('#ra-connected-speech-box');
    if (layoutResults[width].speechCoachVisible) {
      await coachPanel.scrollIntoViewIfNeeded();
      await coachPanel.screenshot({
        path: path.join(visualArtifactDir, `speech-coach-navigation-${width}.png`)
      });
    }
  }
  });
  Object.assign(testResults, {
    speechCoachVisibleAtAllWidths: Object.values(layoutResults).every((result) => result.speechCoachVisible),
    speechCoachRemainsFeedbackAtAllWidths: Object.values(layoutResults).every((result) => result.speechCoachShowsResults),
    speechCoachFitsViewport: Object.values(layoutResults).every((result) => result.speechCoachFitsViewport),
    feedbackListFitsPanel: Object.values(layoutResults).every((result) => result.feedbackListFitsPanel),
    cardsWithoutHorizontalOverflow: Object.values(layoutResults).every((result) => result.cardsWithoutHorizontalOverflow),
    audioControlsStayInsideCards: Object.values(layoutResults).every((result) => result.controlsInsideCards),
    statusesStayInsideCards: Object.values(layoutResults).every((result) => result.statusesInsideCards),
    tooltipsStayInsideCoachPanel: Object.values(layoutResults).every((result) => result.tooltipInsidePanel),
    feedbackDoesNotHideHorizontalOverflow: Object.values(layoutResults).every((result) => result.panelDoesNotHideOverflow && result.listDoesNotHideOverflow),
    unexpectedConsoleErrors: unexpectedConsoleErrors.length,
    isolatedExternalErrorCount: ignoredExternalErrors.length,
    layoutResults
  });
  await page.setViewportSize({ width: 1280, height: 900 });

  console.log('Test Results:', JSON.stringify(testResults, null, 2));

  await browser.close();
  server.close();

  const failed = Object.entries(testResults).filter(([k, v]) => v === false || v === null || (k === 'unexpectedConsoleErrors' && v !== 0));
  if (failed.length === 0 && !testResults.error) {
    console.log('✅ ALL SPEECH COACH FEEDBACK CHECKS PASSED SUCCESSFULLY!');
    process.exit(0);
  } else {
    console.error('❌ SOME CHECKS FAILED:', failed);
    process.exit(1);
  }
})();
