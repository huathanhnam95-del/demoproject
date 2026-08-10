/* eslint-disable no-console */
const assert = require('assert');
const { spawn } = require('child_process');
const net = require('net');
const { chromium } = require('playwright');

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close(() => {
        if (typeof port === 'number') {
          resolve(port);
          return;
        }
        reject(new Error('Failed to allocate free port'));
      });
    });
    server.on('error', reject);
  });
}

async function waitForServer(url, timeoutMs = 45000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (_) {
      // Retry until ready.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Server did not become ready: ${url}`);
}

async function preparePage(page, baseUrl) {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.switchToMode === 'function', { timeout: 30000 });
}

async function mockWorkbookRows(page, rows) {
  await page.evaluate((mockRows) => {
    const originalSheetToJson = window.XLSX.utils.sheet_to_json.bind(window.XLSX.utils);
    window.__raMockRows = mockRows;

    window.XLSX.read = () => ({
      SheetNames: ['Sheet1'],
      Sheets: {
        Sheet1: {
          __mockRows: window.__raMockRows
        }
      }
    });

    window.XLSX.utils.sheet_to_json = (worksheet) => {
      if (Array.isArray(worksheet?.__mockRows)) {
        return worksheet.__mockRows.slice();
      }
      return originalSheetToJson(worksheet);
    };
  }, rows);
}

async function stubPrepareWavBlob(page) {
  await page.evaluate(() => {
    window.ReadAloudMode.prepareWavBlob = async (blob) => blob;
  });
}

async function submitMockReadAloudAttempt(page) {
  await page.evaluate(async () => {
    const mode = window.ReadAloudMode;
    const rawBlob = new Blob(['fake-audio'], { type: 'audio/wav' });
    const recordingSession = {
      id: mode.recordingRequestId + 1,
      disposition: 'submit',
      promptToken: mode.promptLifecycleToken,
      referenceText: mode.currentPromptPlainText,
      questionId: mode.currentQuestionId || null
    };
    mode.recordingRequestId = recordingSession.id;
    mode.currentRecordingSession = recordingSession;
    mode.state = 'RESULTS';
    mode.updateUIForState();
    mode.setRecordedAudio(rawBlob);
    await mode.submitToAzure(rawBlob, recordingSession);
  });
}

async function waitForPromptReady(page, expected = {}) {
  await page.waitForFunction(({ questionId, textPattern }) => {
    const mode = window.ReadAloudMode;
    if (!mode || !mode.currentPromptReady) return false;
    if (questionId !== undefined && questionId !== null) {
      if (String(mode.currentQuestionId || '') !== String(questionId)) return false;
    }
    if (textPattern) {
      const text = String(document.getElementById('ra-text-prompt')?.textContent || '').toLowerCase();
      if (!text.includes(String(textPattern).toLowerCase())) return false;
    }
    return true;
  }, expected, { timeout: 30000 });
}

async function waitForAnimationFrames(page, count = 2) {
  await page.evaluate(async (frameCount) => {
    for (let index = 0; index < frameCount; index += 1) {
      await new Promise((resolve) => requestAnimationFrame(() => resolve()));
    }
  }, count);
}

async function assertUnsupportedFlow(browser, baseUrl) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.addInitScript(() => {
    Object.defineProperty(window, 'MediaRecorder', {
      configurable: true,
      writable: true,
      value: undefined
    });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: undefined
    });

    const originalFetch = window.fetch.bind(window);
    window.__raFetchCount = 0;
    window.fetch = (...args) => {
      const [resource] = args;
      const url = String(resource && resource.url ? resource.url : resource || '');
      if (url.includes('database/RA/RA.xlsx')) {
        window.__raFetchCount += 1;
      }
      return originalFetch(...args);
    };
  });

  const page = await context.newPage();
  await preparePage(page, baseUrl);
  await mockWorkbookRows(page, [
    { ID: 1, ANSWER: 'Pick it up now', 'ANSWER CHUNKED': 'Pick it / up now', 'Word count': 4 }
  ]);

  const initialFetchCount = await page.evaluate(() => Number(window.__raFetchCount || 0));
  assert.equal(initialFetchCount, 0, 'Read Aloud database should not fetch before mode entry');

  await page.evaluate(async () => {
    await window.switchToMode('read-aloud');
  });
  await waitForPromptReady(page);
  await page.evaluate(async () => {
    await window.ReadAloudMode.loadSpecificPrompt(0);
  });
  await waitForPromptReady(page, { questionId: '1', textPattern: 'pick it up now' });

  const state = await page.evaluate(() => {
    const panel = document.getElementById('mode-read-aloud');
    const tab = document.getElementById('tab-read-aloud');
    const status = document.getElementById('ra-status-message');
    const recordBtn = document.getElementById('ra-record-btn');
    const chunkingBtn = document.getElementById('ra-toggle-chunking-btn');
    const offBtn = document.getElementById('ra-toggle-connected-off-btn');
    const linkingBtn = document.getElementById('ra-toggle-linking-btn');
    const reducedWordsBtn = document.getElementById('ra-toggle-reduced-words-btn');
    const soundChangesBtn = document.getElementById('ra-toggle-sound-changes-btn');
    const overlay = document.getElementById('ra-linking-overlay');
    return {
      panelActive: !!panel && panel.classList.contains('active') && getComputedStyle(panel).display !== 'none',
      tabActive: !!tab && tab.classList.contains('active'),
      fetchCount: Number(window.__raFetchCount || 0),
      statusText: status ? String(status.textContent || '').trim() : '',
      recordDisabled: recordBtn ? !!recordBtn.disabled : null,
      chunkingPressed: chunkingBtn ? String(chunkingBtn.getAttribute('aria-pressed') || '') : '',
      chunkingDisabled: chunkingBtn ? !!chunkingBtn.disabled : null,
      offPressed: offBtn
        ? String(offBtn.getAttribute('aria-pressed') || '')
        : (window.ReadAloudMode?.isConnectedSpeechEnabled?.() ? 'false' : 'true'),
      linkingPressed: linkingBtn ? String(linkingBtn.getAttribute('aria-pressed') || '') : '',
      reducedWordsPressed: reducedWordsBtn ? String(reducedWordsBtn.getAttribute('aria-pressed') || '') : '',
      soundChangesPressed: soundChangesBtn ? String(soundChangesBtn.getAttribute('aria-pressed') || '') : '',
      overlayPointerEvents: overlay ? getComputedStyle(overlay).pointerEvents : ''
    };
  });

  assert.equal(state.panelActive, true, 'Read Aloud panel should activate via switchToMode');
  assert.equal(state.tabActive, true, 'Read Aloud tab should activate via switchToMode');
  assert.equal(state.fetchCount, 1, 'Read Aloud database should fetch on first mode entry');
  assert.equal(state.recordDisabled, true, 'record button should stay disabled when microphone recording is unavailable');
  assert.equal(state.chunkingPressed, 'false', 'Chunking should be off by default');
  assert.equal(state.offPressed, 'true', 'Connected speech should default to off');
  assert.equal(state.linkingPressed, 'false', 'Linking should be off by default');
  assert.equal(state.reducedWordsPressed, 'false', 'Reduced words should be off by default');
  assert.equal(state.soundChangesPressed, 'false', 'Sound changes should be off by default');
  assert.equal(state.overlayPointerEvents, 'none', 'linking overlay should not block pointer events');

  await page.evaluate(() => {
    window.startTutorial('read-aloud', true);
  });
  await page.waitForFunction(() => {
    const overlay = document.getElementById('tutorial-overlay');
    const title = document.getElementById('tutorial-title');
    return (
      !!overlay &&
      overlay.classList.contains('active') &&
      !!title &&
      /read aloud/i.test(String(title.textContent || ''))
    );
  }, { timeout: 30000 });

  const tutorialTargets = await page.evaluate(() => ([
    '.ra-prompt-box',
    '#ra-prompt-guides-group',
    '.ra-status-bar',
    '#ra-read-aloud-controls'
  ].map((selector) => ({
    selector,
    exists: !!document.querySelector(selector)
  }))));
  tutorialTargets.forEach(({ selector, exists }) => {
    assert.equal(exists, true, `Read Aloud tutorial target should exist: ${selector}`);
  });

  await page.evaluate(() => {
    document.getElementById('tutorial-next')?.click();
  });
  await page.waitForFunction(() => {
    const title = document.getElementById('tutorial-title');
    return !!title && /read the prompt/i.test(String(title.textContent || ''));
  }, { timeout: 30000 });

  await page.evaluate(() => {
    document.getElementById('tutorial-next')?.click();
  });
  await page.waitForFunction(() => {
    const title = document.getElementById('tutorial-title');
    const text = document.getElementById('tutorial-text');
    return (
      !!title &&
      /use prompt guides/i.test(String(title.textContent || '')) &&
      !!text &&
      /can be enabled together/i.test(String(text.textContent || '')) &&
      /reduced words/i.test(String(text.textContent || ''))
    );
  }, { timeout: 30000 });

  await context.close();
}

async function assertSupportedFlow(browser, baseUrl) {
  const context = await browser.newContext({ viewport: { width: 1024, height: 900 }, serviceWorkers: 'block' });
  await context.addInitScript(() => {
    class FakeMediaRecorder {
      constructor(stream) {
        this.stream = stream;
        this.state = 'inactive';
        this.mimeType = 'audio/webm';
        this.listeners = {};
      }

      addEventListener(type, handler) {
        if (!this.listeners[type]) this.listeners[type] = [];
        this.listeners[type].push(handler);
      }

      start() {
        this.state = 'recording';
        window.__raRecorderStarts = Number(window.__raRecorderStarts || 0) + 1;
      }

      stop() {
        if (this.state !== 'recording') return;
        this.state = 'inactive';
        window.__raRecorderStops = Number(window.__raRecorderStops || 0) + 1;
        const blob = new Blob(['fake-audio'], { type: this.mimeType });
        (this.listeners.dataavailable || []).forEach((handler) => handler({ data: blob }));
        (this.listeners.stop || []).forEach((handler) => handler());
      }
    }

    Object.defineProperty(window, 'MediaRecorder', {
      configurable: true,
      writable: true,
      value: FakeMediaRecorder
    });
    Object.defineProperty(window.URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: (blob) => {
        window.__raObjectUrls = Array.isArray(window.__raObjectUrls) ? window.__raObjectUrls : [];
        const nextUrl = `blob:ra-recording-${window.__raObjectUrls.length + 1}`;
        window.__raObjectUrls.push({ url: nextUrl, type: String(blob?.type || '') });
        return nextUrl;
      }
    });
    Object.defineProperty(window.URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: (url) => {
        window.__raRevokedObjectUrls = Array.isArray(window.__raRevokedObjectUrls) ? window.__raRevokedObjectUrls : [];
        window.__raRevokedObjectUrls.push(String(url || ''));
      }
    });
    const originalPlay = window.HTMLMediaElement.prototype.play;
    const originalPause = window.HTMLMediaElement.prototype.pause;
    Object.defineProperty(window.HTMLMediaElement.prototype, 'play', {
      configurable: true,
      writable: true,
      value: function play() {
        this.__raPausedState = false;
        if (this.id === 'ra-user-recording-audio') {
          window.__raUserRecordingPlayCalls = Number(window.__raUserRecordingPlayCalls || 0) + 1;
        }
        return Promise.resolve(originalPlay ? originalPlay.call(this).catch(() => { }) : undefined);
      }
    });
    Object.defineProperty(window.HTMLMediaElement.prototype, 'pause', {
      configurable: true,
      writable: true,
      value: function pause() {
        this.__raPausedState = true;
        if (this.id === 'ra-user-recording-audio') {
          window.__raUserRecordingPauseCalls = Number(window.__raUserRecordingPauseCalls || 0) + 1;
        }
        return originalPause ? originalPause.call(this) : undefined;
      }
    });
    Object.defineProperty(window.HTMLMediaElement.prototype, 'paused', {
      configurable: true,
      get() {
        return this.__raPausedState !== false;
      }
    });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => {
          window.__raGetUserMediaCalls = Number(window.__raGetUserMediaCalls || 0) + 1;
          return {
            getTracks() {
              return [{
                stop() {
                  window.__raTrackStops = Number(window.__raTrackStops || 0) + 1;
                }
              }];
            }
          };
        }
      }
    });

    const originalFetch = window.fetch.bind(window);
    window.__raFetchCount = 0;
    window.__raAssessCount = 0;
    window.fetch = async (...args) => {
      const [resource] = args;
      const url = String(resource && resource.url ? resource.url : resource || '');
      if (url.includes('database/RA/RA.xlsx')) {
        window.__raFetchCount += 1;
        return new Response(new Uint8Array([1, 2, 3, 4]).buffer, { status: 200 });
      }
      if (url.includes('database/RA/connected-speech-index.json')) {
        return new Response(JSON.stringify({
          indexVersion: '1',
          generatedAt: '2026-03-26T00:00:00.000Z',
          prompts: [
            {
              rowKey: 'id:1',
              questionId: '1',
              title: 'Prompt 1',
              referenceText: 'Pick it up now',
              hasSampleAudio: true,
              hasAnyConnectedSpeech: true,
              hasLinking: true,
              linkingCount: 1,
              hasReducedWords: false,
              reducedWordCount: 0,
              hasSoundChanges: false,
              soundChangeCount: 0,
              soundChangeSubtypes: [],
              representativeExamples: [],
              previewExamplesByCategory: {
                linking: [
                  {
                    family: 'linking',
                    type: 'boundary',
                    id: 'boundary-1',
                    guideTarget: 'boundary-1',
                    text: 'Pick it',
                    leftWord: 'Pick',
                    rightWord: 'it',
                    subtype: 'catenation',
                    category: 'consonant_to_vowel',
                    confidence: 'high',
                    markerText: 'link'
                  }
                ],
                reduced_words: [],
                sound_changes: []
              }
            },
            {
              rowKey: 'id:2',
              questionId: '2',
              title: 'Prompt 2',
              referenceText: 'I can take it to the store',
              hasSampleAudio: false,
              hasAnyConnectedSpeech: true,
              hasLinking: true,
              linkingCount: 1,
              hasReducedWords: true,
              reducedWordCount: 1,
              hasSoundChanges: false,
              soundChangeCount: 0,
              soundChangeSubtypes: [],
              representativeExamples: [],
              previewExamplesByCategory: {
                linking: [
                  {
                    family: 'linking',
                    type: 'boundary',
                    id: 'boundary-2',
                    guideTarget: 'boundary-2',
                    text: 'take it',
                    leftWord: 'take',
                    rightWord: 'it',
                    subtype: 'catenation',
                    category: 'consonant_to_vowel',
                    confidence: 'high',
                    markerText: 'link'
                  }
                ],
                reduced_words: [
                  {
                    family: 'reduced_words',
                    type: 'token',
                    id: 'token-2',
                    guideTarget: 'token-2',
                    text: 'to',
                    word: 'to',
                    spokenAs: 'tuh',
                    subtype: 'to',
                    confidence: 'medium',
                    markerText: 'Reduced word'
                  }
                ],
                sound_changes: []
              }
            },
            {
              rowKey: 'id:3',
              questionId: '3',
              title: 'Prompt 3',
              referenceText: 'Did you see it?',
              hasSampleAudio: true,
              hasAnyConnectedSpeech: true,
              hasLinking: true,
              linkingCount: 1,
              hasReducedWords: false,
              reducedWordCount: 0,
              hasSoundChanges: true,
              soundChangeCount: 1,
              soundChangeSubtypes: ['coalescent_dj'],
              representativeExamples: [],
              previewExamplesByCategory: {
                linking: [],
                reduced_words: [],
                sound_changes: [
                  {
                    family: 'sound_changes',
                    type: 'boundary',
                    id: 'boundary-3',
                    guideTarget: 'boundary-3',
                    text: 'did you',
                    leftWord: 'did',
                    rightWord: 'you',
                    subtype: 'coalescent_dj',
                    category: 'connected_speech',
                    confidence: 'high',
                    markerText: 'sound change'
                  }
                ]
              }
            }
          ]
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (url.includes('database/RA/connected-speech-featured-prompts.json')) {
        return new Response(JSON.stringify({
          version: '1',
          updatedAt: '2026-03-26T00:00:00.000Z',
          families: {
            any_connected: ['2'],
            linking: ['2'],
            reduced_words: ['2'],
            sound_changes: ['3']
          },
          subtypes: {
            sound_changes: {
              coalescent_dj: ['3']
            }
          }
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (url.includes('audio/ra/manifest.json')) {
        return new Response(JSON.stringify({
          '1': { audio: 'https://example.com/ra-1.mp3' },
          '3': { audio: 'https://example.com/ra-3.mp3' }
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (url.includes('/api/read-aloud/assess')) {
        window.__raAssessCount += 1;
        const requestBody = args[1]?.body;
        const capturedFormData = {};
        if (requestBody && typeof requestBody.entries === 'function') {
          for (const [key, value] of requestBody.entries()) {
            capturedFormData[key] = typeof value === 'string' ? value : String(value?.name || value?.type || 'blob');
          }
        }
        window.__raLastAssessmentFormData = capturedFormData;
        return new Response(JSON.stringify({
          success: true,
          accuracyScore: 92,
          fluencyScore: 89,
          completenessScore: 100,
          recognizedText: 'Pick it up now',
          words: [
            { word: 'Pick', accuracyScore: 93, errorType: 'None' },
            { word: 'it', accuracyScore: 95, errorType: 'None' },
            { word: 'up', accuracyScore: 90, errorType: 'None' },
            { word: 'now', accuracyScore: 91, errorType: 'None' }
          ],
          connectedSpeech: {
            status: 'complete',
            version: 'cs-v1',
            summary: {
              detectedCount: 1,
              notDetectedCount: 1,
              uncertainCount: 1
            },
            events: [
              {
                eventId: 'q-1-catenation-0-1',
                family: 'catenation',
                phrase: 'Pick it',
                status: 'detected',
                confidence: 0.84,
                feedbackText: 'Good connected speech in "Pick it".',
                startMs: 0,
                endMs: 520,
                evidence: {
                  variant: 'linked',
                  gapMs: 12
                }
              },
              {
                eventId: 'q-1-catenation-1-2',
                family: 'catenation',
                phrase: 'it up',
                status: 'not_detected',
                confidence: 0.33,
                feedbackText: 'Keep "it up" closer together so it sounds like one connected phrase.',
                startWordIndex: 1,
                endWordIndex: 2,
                startMs: 520,
                endMs: 970,
                evidence: {
                  variant: 'canonical',
                  gapMs: 290
                }
              },
              {
                eventId: 'q-1-catenation-2-3',
                family: 'catenation',
                phrase: 'up now',
                status: 'uncertain',
                confidence: 0.5,
                feedbackText: 'Say "up now" once more a little more clearly so we can judge the linking.',
                startWordIndex: 2,
                endWordIndex: 3,
                startMs: 970,
                endMs: 1380,
                evidence: {
                  variant: 'uncertain',
                  gapMs: null
                }
              }
            ]
          }
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return originalFetch(...args);
    };
  });

  const page = await context.newPage();
  await preparePage(page, baseUrl);
  await mockWorkbookRows(page, [
    {
      ID: 1,
      ANSWER: 'Pick / it up now',
      'ANSWER FOR COMPARE OR TRANSCRIPT': 'Pick it up now',
      'ANSWER CHUNKED': 'Pick / it up now',
      'Word count': 4
    },
    {
      ID: 2,
      ANSWER: 'I can / take it to / the store',
      'ANSWER FOR COMPARE OR TRANSCRIPT': 'I can take it to the store',
      'ANSWER CHUNKED': 'I can / take it to / the store',
      'Word count': 7
    },
    {
      ID: 3,
      ANSWER: 'Did you see it?',
      'ANSWER FOR COMPARE OR TRANSCRIPT': 'Did you see it?',
      'ANSWER CHUNKED': 'Did you see it?',
      'Word count': 4
    }
  ]);
  await stubPrepareWavBlob(page);

  await page.evaluate(async () => {
    await window.switchToMode('read-aloud');
  });
  await page.waitForFunction(() => window.ReadAloudMode && window.ReadAloudMode.hasLoadedDatabase && window.ReadAloudMode.database.length >= 2, { timeout: 30000 });
  await page.waitForFunction(() => {
    const text = document.getElementById('ra-text-prompt');
    const status = document.getElementById('ra-status-message');
    return (
      !!window.ReadAloudMode &&
      String(window.ReadAloudMode.currentPromptPlainText || '').length > 0 &&
      !!text &&
      String(text.textContent || '').trim().length > 0 &&
      !!status &&
      /read the text silently/i.test(String(status.textContent || ''))
    );
  }, { timeout: 30000 });
  await page.evaluate(async () => {
    await window.ReadAloudMode.loadSpecificPrompt(0);
  });
  await waitForPromptReady(page, { questionId: '1', textPattern: 'pick it up now' });

  const initialViewState = await page.evaluate(() => {
    const chunkingBtn = document.getElementById('ra-toggle-chunking-btn');
    const practiceTargetToggle = document.getElementById('ra-practice-target-toggle');
    const practiceTargetDrawer = document.getElementById('ra-practice-target-drawer');
    const offBtn = document.getElementById('ra-toggle-connected-off-btn');
    const linkingBtn = document.getElementById('ra-toggle-linking-btn');
    const reducedWordsBtn = document.getElementById('ra-toggle-reduced-words-btn');
    const soundChangesBtn = document.getElementById('ra-toggle-sound-changes-btn');
    const featureAllBtn = document.getElementById('ra-filter-feature-all');
    const anyConnectedBtn = document.getElementById('ra-filter-any-connected');
    const linkingFilterBtn = document.getElementById('ra-filter-linking');
    const reducedWordsFilterBtn = document.getElementById('ra-filter-reduced-words');
    const soundChangesFilterBtn = document.getElementById('ra-filter-sound-changes');
    const filterStatus = document.getElementById('ra-filter-feature-status');
    const summary = document.getElementById('ra-linking-a11y-summary');
    const connectedSpeechGroup = document.getElementById('ra-connected-speech-group');
    const recordBtn = document.getElementById('ra-record-btn');
    const nextBtn = document.querySelector('#mode-read-aloud .spc-picker-next');
    return {
      chunkingSelected: chunkingBtn ? String(chunkingBtn.getAttribute('aria-pressed') || '') : '',
      chunkingDisabled: chunkingBtn ? !!chunkingBtn.disabled : null,
      practiceTargetText: practiceTargetToggle ? String(practiceTargetToggle.textContent || '').trim() : '',
      practiceTargetExpanded: practiceTargetToggle ? String(practiceTargetToggle.getAttribute('aria-expanded') || '') : '',
      practiceTargetHidden: practiceTargetDrawer ? practiceTargetDrawer.hasAttribute('hidden') : null,
      offSelected: offBtn
        ? String(offBtn.getAttribute('aria-pressed') || '')
        : (window.ReadAloudMode?.isConnectedSpeechEnabled?.() ? 'false' : 'true'),
      offText: offBtn ? String(offBtn.textContent || '').trim() : 'Off',
      linkingSelected: linkingBtn ? String(linkingBtn.getAttribute('aria-pressed') || '') : '',
      linkingText: linkingBtn ? String(linkingBtn.textContent || '').trim() : '',
      reducedWordsSelected: reducedWordsBtn ? String(reducedWordsBtn.getAttribute('aria-pressed') || '') : '',
      reducedWordsText: reducedWordsBtn ? String(reducedWordsBtn.textContent || '').trim() : '',
      soundChangesSelected: soundChangesBtn ? String(soundChangesBtn.getAttribute('aria-pressed') || '') : '',
      soundChangesText: soundChangesBtn ? String(soundChangesBtn.textContent || '').trim() : '',
      featureAllSelected: featureAllBtn ? String(featureAllBtn.getAttribute('aria-pressed') || '') : '',
      anyConnectedDisabled: anyConnectedBtn ? !!anyConnectedBtn.disabled : null,
      linkingFilterDisabled: linkingFilterBtn ? !!linkingFilterBtn.disabled : null,
      reducedWordsFilterDisabled: reducedWordsFilterBtn ? !!reducedWordsFilterBtn.disabled : null,
      soundChangesFilterDisabled: soundChangesFilterBtn ? !!soundChangesFilterBtn.disabled : null,
      filterStatusText: filterStatus ? String(filterStatus.textContent || '').trim() : '',
      summaryText: summary ? String(summary.textContent || '').trim() : '',
      summaryLive: summary ? String(summary.getAttribute('aria-live') || '') : '',
      summaryDescribedBy: summary ? String(summary.getAttribute('aria-describedby') || '') : '',
      connectedSpeechRole: connectedSpeechGroup ? String(connectedSpeechGroup.getAttribute('role') || '') : '',
      recordText: recordBtn ? String(recordBtn.textContent || '').trim() : '',
      nextText: nextBtn ? String(nextBtn.getAttribute('aria-label') || nextBtn.textContent || '').trim() : ''
    };
  });

  assert.equal(initialViewState.chunkingSelected, 'false', 'Chunking should be off on first prompt load');
  assert.equal(initialViewState.chunkingDisabled, false, 'Chunking should be available when ANSWER CHUNKED is present');
  assert.match(
    initialViewState.practiceTargetText,
    /practice\s+target/i,
    `practice target drawer toggle should be visible: ${JSON.stringify(initialViewState)}`
  );
  assert.equal(initialViewState.practiceTargetExpanded, 'false', 'practice target drawer should start collapsed');
  assert.equal(initialViewState.practiceTargetHidden, true, 'practice target drawer should be closed by default');
  assert.equal(initialViewState.offSelected, 'true', 'Connected speech should default to off');
  assert.equal(initialViewState.offText, 'Off', 'connected speech off button should use learner copy');
  assert.equal(initialViewState.linkingSelected, 'false', 'Linking should be off by default');
  assert.equal(initialViewState.linkingText, 'Linking', 'linking button should use learner copy');
  assert.equal(initialViewState.reducedWordsSelected, 'false', 'Reduced words should be off by default');
  assert.match(initialViewState.reducedWordsText, /Reduced\s+words/, 'reduced words button should use learner copy');
  assert.equal(initialViewState.soundChangesSelected, 'false', 'Sound changes should be off by default');
  assert.match(initialViewState.soundChangesText, /Sound\s+changes/, 'sound changes button should use learner copy');
  assert.equal(initialViewState.featureAllSelected, 'true', 'prompt feature filter should default to all prompts');
  assert.equal(initialViewState.anyConnectedDisabled, false, 'any-connected filter should be available once the static index loads');
  assert.equal(initialViewState.linkingFilterDisabled, false, 'linking filter should be available once the static index loads');
  assert.equal(initialViewState.reducedWordsFilterDisabled, false, 'reduced-words filter should be available once the static index loads');
  assert.equal(initialViewState.soundChangesFilterDisabled, false, 'sound-changes filter should be available once the static index loads');
  assert.equal(initialViewState.recordText, 'Start recording now', 'prep-state primary CTA should match the current prep-state CTA copy');
  assert.equal(initialViewState.nextText, 'Next question', 'prep-state secondary CTA should use the controller navigation copy');
  assert.equal(initialViewState.filterStatusText, '', 'prompt-index status should stay empty when the index loads successfully');
  assert.equal(initialViewState.summaryText, '', 'connected speech accessibility summary should start empty when connected speech is off');
  assert.equal(initialViewState.summaryLive, 'polite', 'connected speech summary should be announced politely');
  assert.equal(initialViewState.connectedSpeechRole, 'group', 'composable connected speech controls should use group semantics');

  const readyFilterState = await page.evaluate(() => {
    const featureAllBtn = document.getElementById('ra-filter-feature-all');
    const anyConnectedBtn = document.getElementById('ra-filter-any-connected');
    const linkingBtn = document.getElementById('ra-filter-linking');
    const reducedWordsBtn = document.getElementById('ra-filter-reduced-words');
    const soundChangesBtn = document.getElementById('ra-filter-sound-changes');
    return {
      featureAllSelected: featureAllBtn ? String(featureAllBtn.getAttribute('aria-pressed') || '') : '',
      anyConnectedDisabled: anyConnectedBtn ? !!anyConnectedBtn.disabled : null,
      linkingDisabled: linkingBtn ? !!linkingBtn.disabled : null,
      reducedWordsDisabled: reducedWordsBtn ? !!reducedWordsBtn.disabled : null,
      soundChangesDisabled: soundChangesBtn ? !!soundChangesBtn.disabled : null
    };
  });
  assert.equal(readyFilterState.anyConnectedDisabled, false, 'any-connected filter should remain enabled after indexing');
  assert.equal(readyFilterState.linkingDisabled, false, 'linking filter should remain enabled after indexing');
  assert.equal(readyFilterState.reducedWordsDisabled, false, 'reduced-words filter should remain enabled after indexing');
  assert.equal(readyFilterState.soundChangesDisabled, false, 'sound-changes filter should remain enabled after indexing');

  await page.waitForFunction(() => {
    const mode = window.ReadAloudMode;
    return !!mode && mode.hasLoadedManifest && !!mode.audioManifest && Object.keys(mode.audioManifest).length > 0;
  }, { timeout: 30000 });

  const availableFilterState = await page.evaluate(() => {
    window.ReadAloudMode?.setSampleAudioFilter('available');
    const select = document.getElementById('ra-question-select');
    const filteredDb = window.ReadAloudMode?.getFilteredDatabase?.() || [];
    const options = select ? Array.from(select.options).map((option) => String(option.textContent || '').trim()) : [];
    return {
      disabled: select ? !!select.disabled : null,
      optionCount: options.length,
      filteredCount: filteredDb.length,
      options
    };
  });
  assert.equal(availableFilterState.disabled, false, 'audio filter should keep the selector enabled when matches exist');
  assert.equal(
    availableFilterState.filteredCount,
    1,
    `available audio should keep only mocked prompts present in the audio manifest: ${JSON.stringify(availableFilterState)}`
  );
  assert.equal(
    availableFilterState.optionCount,
    2,
    `available audio should keep the dropdown options present in the audio manifest plus random: ${JSON.stringify(availableFilterState)}`
  );
  assert.ok(availableFilterState.options.some((text) => /Q1:/i.test(text)), 'available audio should keep prompt 1');

  await page.evaluate(() => {
    window.ReadAloudMode?.setSampleAudioFilter('all');
  });
  const curatedSelectionState = await page.evaluate(async () => {
    const originalRandom = Math.random;
    Math.random = () => 0.99;
    try {
      window.ReadAloudMode?.setPromptFeatureFilter('linking');
      for (let attempt = 0; attempt < 20; attempt += 1) {
        if (String(window.ReadAloudMode?.currentQuestionId || '') === '2') {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const select = document.getElementById('ra-question-select');
      return {
        currentQuestionId: String(window.ReadAloudMode?.currentQuestionId || ''),
        filteredCount: window.ReadAloudMode?.getFilteredDatabase?.().length || 0,
        optionCount: select ? select.options.length : 0
      };
    } finally {
      Math.random = originalRandom;
    }
  });
  assert.equal(curatedSelectionState.currentQuestionId, '2', 'curated linking pool should steer random selection to the featured prompt');
  assert.equal(curatedSelectionState.filteredCount, 3, 'linking filter should still include all linking candidates in the dropdown pool');
  assert.equal(curatedSelectionState.optionCount, 4, 'linking filter should still show the full filtered dropdown plus random');

  await page.evaluate(() => {
    window.ReadAloudMode?.setPromptFeatureFilter('sound_changes');
  });
  await page.waitForFunction(() => String(window.ReadAloudMode?.currentQuestionId || '') === '3', { timeout: 30000 });

  const soundChangesFilterState = await page.evaluate(() => {
    const select = document.getElementById('ra-question-select');
    const filteredDb = window.ReadAloudMode?.getFilteredDatabase?.() || [];
    const options = select ? Array.from(select.options).map((option) => String(option.textContent || '').trim()) : [];
    return {
      disabled: select ? !!select.disabled : null,
      optionCount: options.length,
      filteredCount: filteredDb.length,
      options,
      currentQuestionId: String(window.ReadAloudMode?.currentQuestionId || '')
    };
  });
  assert.equal(soundChangesFilterState.disabled, false, 'sound changes filter should keep the selector enabled when matches exist');
  assert.equal(soundChangesFilterState.filteredCount, 1, 'sound-changes only should narrow the filtered database to one prompt');
  assert.equal(soundChangesFilterState.optionCount, 2, 'sound-changes only should narrow the dropdown to one prompt plus random');
  assert.ok(soundChangesFilterState.options.some((text) => /Q3:/i.test(text)), 'sound-changes only should keep the prompt with sound changes');
  assert.equal(soundChangesFilterState.currentQuestionId, '3', 'sound-changes only should load the matching sound-change prompt');

  const noMatchFilterState = await page.evaluate(() => {
    window.ReadAloudMode?.setSampleAudioFilter('available');
    const select = document.getElementById('ra-question-select');
    const filteredDb = window.ReadAloudMode?.getFilteredDatabase?.() || [];
    return {
      disabled: select ? !!select.disabled : null,
      value: select ? String(select.value || '') : '',
      text: select ? String(select.textContent || '').trim() : '',
      filteredCount: filteredDb.length
    };
  });
  assert.equal(noMatchFilterState.disabled, true, 'combined filters with no matches should disable the selector');
  assert.equal(noMatchFilterState.filteredCount, 0, 'combined filters with no matches should yield no rows');
  assert.match(noMatchFilterState.text, /No questions match the current filters/i, 'empty filter combinations should explain that no questions match');

  await page.evaluate(() => {
    window.ReadAloudMode?.setPromptFeatureFilter('all');
    window.ReadAloudMode?.setSampleAudioFilter('all');
  });
  const restoredFilterState = await page.evaluate(() => {
    const select = document.getElementById('ra-question-select');
    const allBtn = document.getElementById('ra-filter-all');
    const featureAllBtn = document.getElementById('ra-filter-feature-all');
    const filteredDb = window.ReadAloudMode?.getFilteredDatabase?.() || [];
    return {
      disabled: select ? !!select.disabled : null,
      value: select ? String(select.value || '') : '',
      allPressed: allBtn ? String(allBtn.getAttribute('aria-pressed') || '') : '',
      featureAllPressed: featureAllBtn ? String(featureAllBtn.getAttribute('aria-pressed') || '') : '',
      filteredCount: filteredDb.length,
      currentQuestionId: String(window.ReadAloudMode?.currentQuestionId || '')
    };
  });
  assert.equal(restoredFilterState.disabled, false, 'resetting filters should restore the selector');
  assert.equal(restoredFilterState.value, '2', 'resetting filters should restore the last valid prompt selection');
  assert.equal(restoredFilterState.allPressed, 'true', 'audio filter should reset to all');
  assert.equal(restoredFilterState.featureAllPressed, 'true', 'feature filter should reset to all prompts');
  assert.equal(restoredFilterState.filteredCount, 3, 'resetting filters should restore the full prompt pool');
  assert.equal(restoredFilterState.currentQuestionId, '3', 'resetting filters should restore the last valid prompt when it matches again');

  await page.evaluate(() => {
    document.getElementById('ra-toggle-chunking-btn')?.click();
    document.getElementById('ra-toggle-linking-btn')?.click();
  });
  await page.waitForFunction(() => {
    const overlay = document.getElementById('ra-linking-overlay');
    return !!overlay && overlay.querySelectorAll('path').length > 0;
  }, { timeout: 30000 });

  const wideLinkingState = await page.evaluate(() => {
    const overlay = document.getElementById('ra-linking-overlay');
    const fallbackList = document.getElementById('ra-linking-fallback-list');
    return {
      overlayPaths: overlay ? overlay.querySelectorAll('path').length : 0,
      fallbackVisible: !!fallbackList && getComputedStyle(fallbackList).display !== 'none'
    };
  });
  assert.ok(wideLinkingState.overlayPaths > 0, 'wide layouts should render at least one linking arrow');

  const staleGuideState = await page.evaluate(async () => {
    const mode = window.ReadAloudMode;
    const originalGetPromptAnalysis = mode.getPromptAnalysis.bind(mode);
    const originalLinking = window.ReadAloudLinking || {};
    let firstResolve = null;
    let callCount = 0;

    window.ReadAloudLinking = {
      ...originalLinking,
      filterAnalysisByBlockedBoundaries: (analysis) => analysis,
      applyTokenAnnotations: () => { },
      buildAccessibleSummary: (analysis) => (analysis?.marker === 'fresh' ? 'fresh summary' : 'stale summary')
    };
    mode.getPromptAnalysis = () => {
      callCount += 1;
      if (callCount === 1) {
        return new Promise((resolve) => {
          firstResolve = resolve;
        });
      }
      return Promise.resolve({ marker: 'fresh', boundaries: [], guides: [] });
    };

    try {
      mode.setConnectedSpeechLevel('off', { announce: false, persist: false });
      await new Promise((resolve) => setTimeout(resolve, 0));
      mode.setConnectedSpeechLevel('v1_linking', { announce: false, persist: false });
      await new Promise((resolve) => setTimeout(resolve, 0));
      mode.setConnectedSpeechLevel('v2_reduced_words', { announce: false, persist: false });
      let sawFreshSummary = false;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const summaryNode = document.getElementById('ra-linking-a11y-summary');
        const summaryText = summaryNode ? String(summaryNode.textContent || '').trim() : '';
        if (/fresh summary/i.test(summaryText)) {
          sawFreshSummary = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (typeof firstResolve === 'function') {
        firstResolve({ marker: 'stale', boundaries: [], guides: [] });
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
      const summary = document.getElementById('ra-linking-a11y-summary');
      return {
        summaryText: summary ? String(summary.textContent || '').trim() : '',
        sawFreshSummary
      };
    } finally {
      mode.getPromptAnalysis = originalGetPromptAnalysis;
      window.ReadAloudLinking = originalLinking;
      mode.setConnectedSpeechLevel('off', { announce: false, persist: false });
    }
  });
  assert.equal(staleGuideState.sawFreshSummary, true, 'the fresh guide render should appear before the stale result resolves');
  assert.match(staleGuideState.summaryText, /fresh summary/i, 'a late stale analysis should not overwrite the fresh guide render');

  await page.evaluate(async () => {
    document.getElementById('ra-toggle-reduced-words-btn')?.click();
    await window.ReadAloudMode.loadSpecificPrompt(1);
  });

  await page.waitForFunction(() => {
    const reducedWordsBtn = document.getElementById('ra-toggle-reduced-words-btn');
    const highlighted = document.querySelectorAll('[data-connected-speech-layer="weak_forms"]');
    const summary = document.getElementById('ra-linking-a11y-summary');
    return (
      !!reducedWordsBtn &&
      reducedWordsBtn.getAttribute('aria-pressed') === 'true' &&
      highlighted.length > 0 &&
      !!summary &&
      /reduced words/i.test(String(summary.textContent || ''))
    );
  }, { timeout: 30000 });

  const reducedWordState = await page.evaluate(() => {
    const reducedWordsBtn = document.getElementById('ra-toggle-reduced-words-btn');
    const highlighted = document.querySelectorAll('[data-connected-speech-layer="weak_forms"]');
    const summary = document.getElementById('ra-linking-a11y-summary');
    return {
      reducedWordsPressed: reducedWordsBtn ? String(reducedWordsBtn.getAttribute('aria-pressed') || '') : '',
      highlightedCount: highlighted.length,
      highlightedWords: Array.from(highlighted).map((node) => String(node.textContent || '').trim().toLowerCase()).filter(Boolean),
      summaryText: summary ? String(summary.textContent || '').trim() : ''
    };
  });

  assert.equal(reducedWordState.reducedWordsPressed, 'true', 'Reduced words should be enabled');
  assert.ok(reducedWordState.highlightedCount >= 1, 'reduced-word prompts should visibly annotate weak words');
  assert.ok(reducedWordState.highlightedWords.includes('the'), 'non-blocked reduced words should stay visible');
  assert.ok(!reducedWordState.highlightedWords.includes('can'), 'chunk-separated reduced words should stay suppressed');
  assert.ok(!reducedWordState.highlightedWords.includes('to'), 'chunk-blocked reduced words should not leak across pause groups');
  assert.match(reducedWordState.summaryText, /reduced words/i, 'reduced-word summary should mention the layer');

  await page.evaluate(() => {
    const reducedWord = document.querySelector('[data-connected-speech-layer="weak_forms"]');
    if (reducedWord instanceof HTMLElement) {
      reducedWord.click();
    }
  });
  await page.waitForFunction(() => {
    const selectedGuideCard = document.querySelector('[data-guide-item][data-selected="true"]');
    return !!selectedGuideCard && /reduced word/i.test(String(selectedGuideCard.textContent || ''));
  }, { timeout: 30000 });

  const reducedSelectionState = await page.evaluate(() => {
    const selectedGuideCard = document.querySelector('[data-guide-item][data-selected="true"]');
    return {
      selectedText: selectedGuideCard ? String(selectedGuideCard.textContent || '').trim() : '',
      selectedId: selectedGuideCard ? String(selectedGuideCard.getAttribute('data-guide-item') || '') : ''
    };
  });
  assert.match(reducedSelectionState.selectedText, /reduced word/i, 'clicking a reduced word should focus its guide card');

  await page.evaluate(() => {
    document.getElementById('ra-toggle-sound-changes-btn')?.click();
  });
  await page.evaluate(async () => {
    await window.ReadAloudMode.loadSpecificPrompt(2);
  });

  await page.waitForFunction(() => {
    const soundChangesBtn = document.getElementById('ra-toggle-sound-changes-btn');
    const summary = document.getElementById('ra-linking-a11y-summary');
    return (
      !!soundChangesBtn &&
      soundChangesBtn.getAttribute('aria-pressed') === 'true' &&
      !!summary &&
      /sound changes/i.test(String(summary.textContent || ''))
    );
  }, { timeout: 30000 });

  const soundChangeState = await page.evaluate(() => {
    const soundChangesBtn = document.getElementById('ra-toggle-sound-changes-btn');
    const summary = document.getElementById('ra-linking-a11y-summary');
    return {
      soundChangesPressed: soundChangesBtn ? String(soundChangesBtn.getAttribute('aria-pressed') || '') : '',
      summaryText: summary ? String(summary.textContent || '').trim() : ''
    };
  });
  assert.equal(soundChangeState.soundChangesPressed, 'true', 'Sound changes should be enabled');
  assert.match(soundChangeState.summaryText, /sound changes/i, 'sound-change summary should mention the layer');

  const soundChangeWord = page.locator('#ra-prompt-stage [data-sound-change-subtype]').first();
  await soundChangeWord.hover();
  await page.waitForFunction(() => {
    const tooltip = document.getElementById('ra-sound-change-tooltip');
    return !!tooltip
      && tooltip.getAttribute('aria-hidden') === 'false'
      && getComputedStyle(tooltip).display !== 'none';
  }, { timeout: 30000 });

  const soundChangeTooltipState = await page.evaluate(() => {
    const tooltip = document.getElementById('ra-sound-change-tooltip');
    const activeWord = document.querySelector('#ra-prompt-stage [data-sound-change-subtype][aria-describedby~="ra-sound-change-tooltip"]');
    return {
      labelText: String(tooltip?.querySelector('.ra-sound-change-tooltip__label')?.textContent || '').trim(),
      explanationText: String(tooltip?.querySelector('.ra-sound-change-tooltip__explanation')?.textContent || '').trim(),
      describedByTooltip: !!activeWord
    };
  });
  assert.match(soundChangeTooltipState.labelText, /(?:→|becomes|changes? to)/i, 'hovering a sound-change word should show what sound changes to what');
  assert.match(soundChangeTooltipState.explanationText, /sound|pronounc|say|blend|change/i, 'the floating sound-change explanation should tell the learner how the sound changes');
  assert.equal(soundChangeTooltipState.describedByTooltip, true, 'the active sound-change word should be associated with its tooltip');

  await page.evaluate(() => {
    const badge = document.querySelector('#ra-connected-speech-badges [data-guide-target]');
    if (badge instanceof HTMLElement) {
      badge.click();
    }
  });
  await page.waitForFunction(() => {
    const selectedGuideCard = document.querySelector('[data-guide-item][data-selected="true"]');
    return !!selectedGuideCard && /sound change/i.test(String(selectedGuideCard.textContent || ''));
  }, { timeout: 30000 });

  const soundChangeSelectionState = await page.evaluate(() => {
    const selectedGuideCard = document.querySelector('[data-guide-item][data-selected="true"]');
    return {
      selectedText: selectedGuideCard ? String(selectedGuideCard.textContent || '').trim() : '',
      selectedId: selectedGuideCard ? String(selectedGuideCard.getAttribute('data-guide-item') || '') : ''
    };
  });
  assert.match(soundChangeSelectionState.selectedText, /sound change/i, 'clicking a sound-change badge should focus its guide card');

  const guideHintState = await page.evaluate(() => {
    const connectedBox = document.getElementById('ra-connected-speech-box');
    const connectedLabel = document.getElementById('ra-connected-speech-label');
    const connectedSummary = document.getElementById('ra-connected-speech-summary');
    const connectedMeta = document.getElementById('ra-connected-speech-meta');
    const connectedList = document.getElementById('ra-connected-speech-list');
    return {
      visible: !!connectedBox && getComputedStyle(connectedBox).display !== 'none',
      labelText: connectedLabel ? String(connectedLabel.textContent || '').trim() : '',
      summaryText: connectedSummary ? String(connectedSummary.textContent || '').trim() : '',
      metaText: connectedMeta ? String(connectedMeta.textContent || '').trim() : '',
      listText: connectedList ? String(connectedList.textContent || '').trim() : '',
      listCount: connectedList ? connectedList.children.length : 0
    };
  });
  assert.equal(guideHintState.visible, true, 'connected-speech guide should show a help panel when a guide level is active');
  assert.equal(guideHintState.labelText, 'Speech Coach', 'guide shell should keep a stable product name');
  assert.equal(guideHintState.metaText, 'Preview', 'prep-state guide shell should describe itself as preview content');
  assert.ok(guideHintState.listCount >= 1, 'connected-speech guide should list at least one pronunciation hint');
  assert.match(guideHintState.listText, /did you|sound change|reduce|lighter|slide/i, 'connected-speech guide should explain how to say the highlighted items');

  await page.setViewportSize({ width: 390, height: 900 });
  const narrowGuideControlState = await page.evaluate(() => {
    const btn = document.getElementById('ra-toggle-sound-changes-btn');
    const pageWidth = document.documentElement.scrollWidth;
    if (!btn) return null;
    const rect = btn.getBoundingClientRect();
    return {
      viewportWidth: window.innerWidth,
      pageWidth,
      left: rect.left,
      right: rect.right
    };
  });
  assert.ok(narrowGuideControlState, 'sound-change control should exist on narrow layouts');
  assert.ok(narrowGuideControlState.pageWidth <= narrowGuideControlState.viewportWidth, 'read-aloud layout should not overflow horizontally on mobile');
  assert.ok(narrowGuideControlState.left >= 0, 'sound-change control should stay inside the viewport on narrow layouts');
  assert.ok(narrowGuideControlState.right <= narrowGuideControlState.viewportWidth, 'sound-change control should remain clickable on narrow layouts');

  await page.waitForFunction(() => {
    const guideBox = document.getElementById('ra-connected-speech-box');
    const toggle = document.querySelector('#ra-connected-speech-list [data-role="guide-toggle-details"]');
    const selectedCard = document.querySelector('#ra-connected-speech-list [data-role="guide-selected-card"] [data-guide-target]');
    return !!guideBox
      && getComputedStyle(guideBox).display !== 'none'
      && !!toggle
      && !!selectedCard;
  }, { timeout: 30000 });

  const compactGuideState = await page.evaluate(() => {
    const guideBox = document.getElementById('ra-connected-speech-box');
    const connectedLabel = document.getElementById('ra-connected-speech-label');
    const toggle = document.querySelector('#ra-connected-speech-list [data-role="guide-toggle-details"]');
    const selectedCard = document.querySelector('#ra-connected-speech-list [data-role="guide-selected-card"] [data-guide-target]');
    const expandedList = document.querySelector('#ra-connected-speech-list [data-role="guide-expanded-list"]');
    return {
      visible: !!guideBox && getComputedStyle(guideBox).display !== 'none',
      labelText: connectedLabel ? String(connectedLabel.textContent || '').trim() : '',
      toggleText: toggle ? String(toggle.textContent || '').trim() : '',
      toggleExpanded: toggle ? String(toggle.getAttribute('aria-expanded') || '') : '',
      selectedText: selectedCard ? String(selectedCard.textContent || '').trim() : '',
      expandedVisible: !!expandedList && getComputedStyle(expandedList).display !== 'none',
      itemCount: document.querySelectorAll('#ra-connected-speech-list [data-guide-item]').length
    };
  });
  assert.equal(compactGuideState.visible, true, 'guide panel should stay visible on narrow layouts');
  assert.equal(compactGuideState.labelText, 'Speech Coach', 'compact guide shell should keep the same title');
  assert.match(compactGuideState.toggleText, /see more/i, 'compact guide view should offer a concise expand control');
  assert.match(compactGuideState.selectedText, /did you|sound change|reduce|lighter|slide/i, 'compact guide view should keep the selected explanation visible');
  assert.equal(compactGuideState.expandedVisible, false, 'compact guide view should collapse the full list by default');

  await page.evaluate(() => {
    document.querySelector('#ra-connected-speech-list [data-role="guide-toggle-details"]')?.click();
  });
  await page.waitForFunction(() => {
    const toggle = document.querySelector('#ra-connected-speech-list [data-role="guide-toggle-details"]');
    const expandedList = document.querySelector('#ra-connected-speech-list [data-role="guide-expanded-list"]');
    return !!toggle && String(toggle.getAttribute('aria-expanded') || '') === 'true' && !!expandedList && getComputedStyle(expandedList).display !== 'none';
  }, { timeout: 30000 });

  const expandedGuideState = await page.evaluate(() => {
    const toggle = document.querySelector('#ra-connected-speech-list [data-role="guide-toggle-details"]');
    const expandedList = document.querySelector('#ra-connected-speech-list [data-role="guide-expanded-list"]');
    return {
      toggleText: toggle ? String(toggle.textContent || '').trim() : '',
      expandedVisible: !!expandedList && getComputedStyle(expandedList).display !== 'none',
      itemCount: document.querySelectorAll('#ra-connected-speech-list [data-guide-item]').length
    };
  });
  assert.match(expandedGuideState.toggleText, /hide/i, 'expanding the compact guide should update the toggle label');
  assert.equal(expandedGuideState.expandedVisible, true, 'expanding the compact guide should reveal the full list');
  assert.ok(expandedGuideState.itemCount > 1, 'expanding the compact guide should expose more than the selected hint');

  await page.setViewportSize({ width: 420, height: 900 });
  const fallbackState = await page.evaluate(async () => {
    const fallbackList = document.getElementById('ra-linking-fallback-list');
    return {
      display: fallbackList ? getComputedStyle(fallbackList).display : 'none'
    };
  });
  assert.strictEqual(fallbackState.display, 'none', 'linking fallback list below prompt should remain hidden');

  await page.setViewportSize({ width: 1024, height: 900 });
  await page.evaluate(async () => {
    document.getElementById('ra-toggle-linking-btn')?.click();
    await window.ReadAloudMode.loadSpecificPrompt(0);
  });
  await waitForPromptReady(page, { questionId: '1' });
  await page.waitForFunction(() => {
    const overlay = document.getElementById('ra-linking-overlay');
    return !!overlay && overlay.querySelectorAll('path').length > 0;
  }, { timeout: 30000 });

  await page.evaluate(() => {
    document.getElementById('ra-record-btn')?.click();
  });

  await page.waitForFunction(() => {
    const status = document.getElementById('ra-status-message');
    const stopBtn = document.getElementById('ra-stop-btn');
    return (
      Number(window.__raRecorderStarts || 0) === 1 &&
      Number(window.__raGetUserMediaCalls || 0) === 1 &&
      !!status &&
      /recording/i.test(String(status.textContent || '')) &&
      !!stopBtn &&
      getComputedStyle(stopBtn).display !== 'none'
    );
  }, { timeout: 30000 });

  await page.evaluate(() => {
    document.getElementById('ra-stop-btn')?.click();
  });

  await page.waitForFunction(() => {
    const status = document.getElementById('ra-status-message');
    const checkBtn = document.getElementById('ra-check-btn');
    const retryBtn = document.getElementById('ra-retry-btn');
    const audio = document.getElementById('ra-user-recording-audio');
    return Number(window.__raAssessCount || 0) === 0
      && !!status
      && /recording captured/i.test(String(status.textContent || ''))
      && !!checkBtn
      && getComputedStyle(checkBtn).display !== 'none'
      && !!retryBtn
      && getComputedStyle(retryBtn).display !== 'none'
      && !!audio
      && getComputedStyle(audio).display !== 'none';
  }, { timeout: 30000 });

  await page.evaluate(() => {
    document.getElementById('ra-check-btn')?.click();
  });

  await page.waitForFunction(() => {
    const resultBox = document.getElementById('ra-result-box');
    const connectedBox = document.getElementById('ra-connected-speech-box');
    const connectedLabel = document.getElementById('ra-connected-speech-label');
    const connectedMeta = document.getElementById('ra-connected-speech-meta');
    const accuracy = document.getElementById('ra-accuracy-value');
    const feedback = document.getElementById('ra-transcript-feedback');
    const connectedSummary = document.getElementById('ra-connected-speech-summary');
    const status = document.getElementById('ra-status-message');
    const checkBtn = document.getElementById('ra-check-btn');
    return (
      Number(window.__raAssessCount || 0) === 1 &&
      !!resultBox &&
      getComputedStyle(resultBox).display !== 'none' &&
      !!connectedBox &&
      getComputedStyle(connectedBox).display !== 'none' &&
      !!connectedLabel &&
      /speech coach/i.test(String(connectedLabel.textContent || '')) &&
      !!connectedMeta &&
      /feedback/i.test(String(connectedMeta.textContent || '')) &&
      !!accuracy &&
      String(accuracy.textContent || '').trim() === '92' &&
      !!feedback &&
      /pick/i.test(String(feedback.textContent || '')) &&
      !!connectedSummary &&
      /nailed|pattern|practice|keep going/i.test(String(connectedSummary.textContent || '')) &&
      !!connectedBox.querySelector('#ra-connected-speech-list') &&
      !/gap|confidence|phoneme|duration ratio/i.test(String(connectedBox.querySelector('#ra-connected-speech-list')?.textContent || '')) &&
      !!status &&
      /analysis complete/i.test(String(status.textContent || '')) &&
      !!checkBtn &&
      getComputedStyle(checkBtn).display === 'none'
    );
  }, { timeout: 30000 });

  const supportedAssessmentState = await page.evaluate(() => {
    const resultBox = document.getElementById('ra-result-box');
    const connectedBox = document.getElementById('ra-connected-speech-box');
    const connectedLabel = document.getElementById('ra-connected-speech-label');
    const connectedMeta = document.getElementById('ra-connected-speech-meta');
    const accuracy = document.getElementById('ra-accuracy-value');
    const feedback = document.getElementById('ra-transcript-feedback');
    const connectedSummary = document.getElementById('ra-connected-speech-summary');
    const connectedList = document.getElementById('ra-connected-speech-list');
    const status = document.getElementById('ra-status-message');
    const recordBtn = document.getElementById('ra-record-btn');
    const checkBtn = document.getElementById('ra-check-btn');
    const retryBtn = document.getElementById('ra-retry-btn');
    return {
      assessCount: Number(window.__raAssessCount || 0),
      postedQuestionId: String(window.__raLastAssessmentFormData?.questionId || ''),
      currentQuestionId: String(window.ReadAloudMode?.currentQuestionId || ''),
      resultVisible: !!resultBox && getComputedStyle(resultBox).display !== 'none',
      connectedVisible: !!connectedBox && getComputedStyle(connectedBox).display !== 'none',
      connectedLabelText: connectedLabel ? String(connectedLabel.textContent || '').trim() : '',
      connectedMetaText: connectedMeta ? String(connectedMeta.textContent || '').trim() : '',
      accuracyText: accuracy ? String(accuracy.textContent || '').trim() : '',
      feedbackText: feedback ? String(feedback.textContent || '').trim() : '',
      connectedSummaryText: connectedSummary ? String(connectedSummary.textContent || '').trim() : '',
      connectedListText: connectedList ? String(connectedList.textContent || '').trim() : '',
      connectedChildren: connectedList ? connectedList.children.length : 0,
      coachButtonCount: connectedList ? connectedList.querySelectorAll('button[data-guide-target]').length : 0,
      selectedTargetIds: connectedList
        ? Array.from(new Set(Array.from(connectedList.querySelectorAll('button[data-guide-target][aria-pressed="true"]')).map((node) => String(node.getAttribute('data-guide-target') || ''))))
        : [],
      startHereText: connectedList?.querySelector('h4') ? Array.from(connectedList.querySelectorAll('h4')).map((node) => String(node.textContent || '').trim()).join('|') : '',
      statusText: status ? String(status.textContent || '').trim() : '',
      recordText: recordBtn ? String(recordBtn.textContent || '').trim() : '',
      checkVisible: !!checkBtn && getComputedStyle(checkBtn).display !== 'none',
      retryVisible: !!retryBtn && getComputedStyle(retryBtn).display !== 'none'
    };
  });

  assert.equal(supportedAssessmentState.assessCount, 1, 'supported flow should submit exactly one assessment');
  assert.equal(
    supportedAssessmentState.postedQuestionId,
    supportedAssessmentState.currentQuestionId,
    'read-aloud assessment should post the active prompt questionId'
  );
  assert.equal(supportedAssessmentState.resultVisible, true, 'result box should be visible after assessment');
  assert.equal(supportedAssessmentState.connectedVisible, true, 'connected speech box should be visible after assessment');
  assert.equal(supportedAssessmentState.connectedLabelText, 'Speech Coach', 'results shell should keep the same title');
  assert.equal(supportedAssessmentState.connectedMetaText, 'Feedback', 'results shell should describe itself as feedback');
  assert.equal(supportedAssessmentState.accuracyText, '92', 'accuracy score should render from the mocked response');
  assert.match(supportedAssessmentState.feedbackText, /pick/i, 'transcript feedback should render from the mocked response');
  assert.match(supportedAssessmentState.connectedSummaryText, /nailed|pattern|practice|keep going/i, 'connected speech summary should use the learner-facing feedback format');
  assert.ok(supportedAssessmentState.connectedChildren >= 2, 'connected speech result should render left and right grid columns');
  assert.ok(supportedAssessmentState.connectedListText.length > 0, 'connected speech result list should contain rendered content');
  assert.match(supportedAssessmentState.startHereText, /Needs Attention|Successful Links/i, 'results view should render the refactored sc-section headers');
  assert.doesNotMatch(supportedAssessmentState.connectedListText, /gap|confidence|phoneme|duration ratio/i, 'connected speech result should hide raw evidence details');
  assert.match(supportedAssessmentState.statusText, /analysis complete/i, 'status message should update after assessment');
  assert.equal(supportedAssessmentState.checkVisible, false, 'results state should hide the Check action after assessment');
  assert.equal(supportedAssessmentState.retryVisible, true, 'retry should be visible after assessment');

  // Verify refactored sc-* DOM structure (T1-T4 from browser test plan)
  const scDomState = await page.evaluate(() => {
    const list = document.getElementById('ra-connected-speech-list');
    const leftCol = list?.querySelector('.sc-grid-left');
    const rightCol = list?.querySelector('.sc-grid-right');
    const issueCards = rightCol?.querySelectorAll('.sc-issue-card') || [];
    const pills = rightCol?.querySelectorAll('.sc-success-pill') || [];
    const annotated = document.querySelector('.sc-annotated-paragraph');
    const styleTags = annotated ? annotated.querySelectorAll('style') : [];
    return {
      hasLeftCol: !!leftCol,
      hasRightCol: !!rightCol,
      issueCardCount: issueCards.length,
      hasErrorBorder: issueCards.length > 0 && issueCards[0].classList.contains('sc-border--error'),
      pillCount: pills.length,
      hasCheckIcon: pills.length > 0 && !!pills[0].querySelector('.sc-check-icon'),
      pillText: pills.length > 0 ? String(pills[0].textContent || '').trim() : '',
      injectedStyleCount: styleTags.length,
      feedbackText: Array.from(issueCards).map(c => String(c.querySelector('.sc-issue-feedback')?.textContent || '').trim()).join(' | ')
    };
  });
  assert.ok(scDomState.hasLeftCol, 'results should render sc-grid-left column');
  assert.ok(scDomState.hasRightCol, 'results should render sc-grid-right column');
  assert.ok(scDomState.issueCardCount >= 1, 'should render at least 1 issue card for not_detected/uncertain events');
  assert.ok(scDomState.hasErrorBorder, 'not_detected issue card should have sc-border--error class');
  assert.ok(scDomState.pillCount >= 1, 'should render at least 1 success pill for detected events');
  assert.ok(scDomState.hasCheckIcon, 'success pill should contain sc-check-icon');
  assert.equal(scDomState.injectedStyleCount, 0, 'no <style> tags should be injected into annotated paragraph');
  assert.match(scDomState.feedbackText, /Keep "it up" closer together/i, 'issue card should expose the action-focused feedback text');

  await page.waitForFunction(() => {
    const retryBtn = document.getElementById('ra-retry-btn');
    const checkBtn = document.getElementById('ra-check-btn');
    const status = document.getElementById('ra-status-message');
    return !!retryBtn
      && getComputedStyle(retryBtn).display !== 'none'
      && (!checkBtn || getComputedStyle(checkBtn).display === 'none')
      && !!status
      && /analysis complete/i.test(String(status.textContent || ''));
  }, { timeout: 30000 });

  await page.waitForFunction(() => {
    const playOwnBtn = document.getElementById('ra-play-recording-btn');
    const ownAudio = document.getElementById('ra-user-recording-audio');
    return !!playOwnBtn
      && getComputedStyle(playOwnBtn).display !== 'none'
      && !playOwnBtn.disabled
      && /play your recording/i.test(String(playOwnBtn.textContent || ''))
      && !!ownAudio
      && /^blob:ra-recording-/i.test(String(ownAudio.getAttribute('src') || ''));
  }, { timeout: 30000 });

  const recordedPlaybackState = await page.evaluate(() => ({
    buttonText: String(document.getElementById('ra-play-recording-btn')?.textContent || '').trim(),
    audioSrc: String(document.getElementById('ra-user-recording-audio')?.getAttribute('src') || '').trim(),
    objectUrlCount: Array.isArray(window.__raObjectUrls) ? window.__raObjectUrls.length : 0
  }));
  assert.match(recordedPlaybackState.buttonText, /play your recording/i, 'completed attempts should expose playback for the learner recording');
  assert.match(recordedPlaybackState.audioSrc, /^blob:ra-recording-/i, 'completed attempts should attach the captured recording to a local audio player');
  assert.equal(recordedPlaybackState.objectUrlCount, 1, 'captured learner audio should create one object URL');

  await page.evaluate(() => {
    document.getElementById('ra-play-recording-btn')?.click();
  });
  await page.waitForFunction(() => {
    const playOwnBtn = document.getElementById('ra-play-recording-btn');
    return Number(window.__raUserRecordingPlayCalls || 0) === 1
      && !!playOwnBtn
      && /pause your recording/i.test(String(playOwnBtn.textContent || ''));
  }, { timeout: 30000 });

  await page.evaluate(() => {
    document.getElementById('ra-play-recording-btn')?.click();
  });
  await page.waitForFunction(() => {
    const playOwnBtn = document.getElementById('ra-play-recording-btn');
    return Number(window.__raUserRecordingPauseCalls || 0) >= 1
      && !!playOwnBtn
      && /play your recording/i.test(String(playOwnBtn.textContent || ''));
  }, { timeout: 30000 });

  await page.evaluate(() => {
    document.getElementById('ra-retry-btn')?.click();
  });

  await page.waitForFunction(() => {
    const status = document.getElementById('ra-status-message');
    const recordBtn = document.getElementById('ra-record-btn');
    const nextBtn = document.getElementById('ra-next-btn');
    return (
      !!status &&
      /read the text silently/i.test(String(status.textContent || '')) &&
      !!recordBtn &&
      /start recording/i.test(String(recordBtn.textContent || '')) &&
      !!nextBtn &&
      /next prompt/i.test(String(nextBtn.textContent || ''))
    );
  }, { timeout: 30000 });

  await page.evaluate(async () => {
    await window.ReadAloudMode.loadSpecificPrompt(1);
  });
  await waitForPromptReady(page, { questionId: '2' });

  const playbackResetState = await page.evaluate(() => ({
    buttonVisible: (() => {
      const btn = document.getElementById('ra-play-recording-btn');
      return !!btn && getComputedStyle(btn).display !== 'none';
    })(),
    audioSrc: String(document.getElementById('ra-user-recording-audio')?.getAttribute('src') || '').trim(),
    revokedCount: Array.isArray(window.__raRevokedObjectUrls) ? window.__raRevokedObjectUrls.length : 0
  }));
  assert.equal(playbackResetState.buttonVisible, false, 'moving to the next prompt should hide the previous learner recording playback button');
  assert.equal(playbackResetState.audioSrc, '', 'moving to the next prompt should clear the previous learner recording source');
  assert.ok(playbackResetState.revokedCount >= 1, 'moving to the next prompt should revoke the previous learner recording URL');

  await page.evaluate(() => {
    const originalFetch = window.fetch.bind(window);
    window.__raDelayedAssessmentStarted = false;
    window.__raReleaseDelayedAssessment = null;
    window.fetch = (...args) => {
      const [resource] = args;
      const url = String(resource && resource.url ? resource.url : resource || '');
      if (url.includes('/api/read-aloud/assess')) {
        const nextCount = Number(window.__raAssessCount || 0) + 1;
        if (nextCount === 2) {
          window.__raAssessCount = nextCount;
          window.__raDelayedAssessmentStarted = true;
          const requestBody = args[1]?.body;
          const capturedFormData = {};
          if (requestBody && typeof requestBody.entries === 'function') {
            for (const [key, value] of requestBody.entries()) {
              capturedFormData[key] = typeof value === 'string' ? value : String(value?.name || value?.type || 'blob');
            }
          }
          window.__raLastAssessmentFormData = capturedFormData;
          return new Promise((resolve) => {
            window.__raReleaseDelayedAssessment = () => resolve(new Response(JSON.stringify({
              success: true,
              accuracyScore: 88,
              fluencyScore: 84,
              completenessScore: 100,
              recognizedText: 'I can take it to the store',
              words: [
                { word: 'I', accuracyScore: 90, errorType: 'None' },
                { word: 'can', accuracyScore: 82, errorType: 'None' },
                { word: 'take', accuracyScore: 87, errorType: 'None' },
                { word: 'it', accuracyScore: 89, errorType: 'None' },
                { word: 'to', accuracyScore: 78, errorType: 'None' },
                { word: 'the', accuracyScore: 85, errorType: 'None' },
                { word: 'store', accuracyScore: 92, errorType: 'None' }
              ],
              connectedSpeech: {
                status: 'complete',
                version: 'cs-v1',
                summary: {
                  detectedCount: 1,
                  notDetectedCount: 0,
                  uncertainCount: 0
                },
                events: [
                  {
                    eventId: 'q-2-catenation-2-3',
                    family: 'catenation',
                    phrase: 'take it',
                    status: 'detected',
                    confidence: 0.82,
                    feedbackText: 'Good connected speech in "take it".',
                    startMs: 0,
                    endMs: 610,
                    evidence: {
                      variant: 'linked',
                      gapMs: 10
                    }
                  }
                ]
              }
            }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            }));
          });
        }
      }
      return originalFetch(...args);
    };
  });

  await page.evaluate(() => {
    document.getElementById('ra-record-btn')?.click();
  });
  await page.waitForFunction(() => {
    const status = document.getElementById('ra-status-message');
    return Number(window.__raRecorderStarts || 0) === 2
      && !!status
      && /recording/i.test(String(status.textContent || ''));
  }, { timeout: 30000 });
  await page.evaluate(() => {
    document.getElementById('ra-stop-btn')?.click();
  });

  await page.waitForFunction(() => {
    const status = document.getElementById('ra-status-message');
    const checkBtn = document.getElementById('ra-check-btn');
    return Number(window.__raAssessCount || 0) === 1
      && !!status
      && /recording captured/i.test(String(status.textContent || ''))
      && !!checkBtn
      && getComputedStyle(checkBtn).display !== 'none';
  }, { timeout: 30000 });

  await page.evaluate(() => {
    document.getElementById('ra-check-btn')?.click();
  });

  await page.waitForFunction(() => {
    const status = document.getElementById('ra-status-message');
    return window.__raDelayedAssessmentStarted === true
      && !!status
      && /formatting audio|analyzing pronunciation/i.test(String(status.textContent || ''));
  }, { timeout: 30000 });

  const pendingSecondAssessmentState = await page.evaluate(() => {
    const resultBox = document.getElementById('ra-result-box');
    const accuracy = document.getElementById('ra-accuracy-value');
    const feedback = document.getElementById('ra-transcript-feedback');
    return {
      resultVisible: !!resultBox && getComputedStyle(resultBox).display !== 'none',
      accuracyText: String(accuracy?.textContent || '').trim(),
      feedbackText: String(feedback?.textContent || '').trim()
    };
  });
  assert.equal(pendingSecondAssessmentState.resultVisible, false, 'previous result box should stay hidden while the next prompt is being assessed');
  assert.equal(pendingSecondAssessmentState.accuracyText, '--', 'previous accuracy score should be cleared before the next result arrives');
  assert.doesNotMatch(pendingSecondAssessmentState.feedbackText, /pick it up now/i, 'previous transcript feedback should not bleed into the next prompt');

  await page.evaluate(() => {
    window.__raReleaseDelayedAssessment?.();
  });
  await page.waitForFunction(() => {
    const accuracy = document.getElementById('ra-accuracy-value');
    const feedback = document.getElementById('ra-transcript-feedback');
    const resultBox = document.getElementById('ra-result-box');
    return Number(window.__raAssessCount || 0) === 2
      && !!resultBox
      && getComputedStyle(resultBox).display !== 'none'
      && !!accuracy
      && String(accuracy.textContent || '').trim() === '88'
      && !!feedback
      && /store/i.test(String(feedback.textContent || ''));
  }, { timeout: 30000 });

  const supportedState = await page.evaluate(() => ({
    fetchCount: Number(window.__raFetchCount || 0),
    recorderStarts: Number(window.__raRecorderStarts || 0),
    recorderStops: Number(window.__raRecorderStops || 0),
    assessCount: Number(window.__raAssessCount || 0),
    trackStops: Number(window.__raTrackStops || 0)
  }));

  assert.equal(supportedState.fetchCount, 1, 'database should stay cached between prompts');
  assert.equal(supportedState.recorderStarts, 2, 'recording should start once per completed attempt');
  assert.ok(supportedState.recorderStops >= 2, 'recording should stop when finishing each attempt');
  assert.equal(supportedState.assessCount, 2, 'two completed attempts should submit two assessments');
  assert.ok(supportedState.trackStops >= 2, 'microphone tracks should be stopped after each recording');

  await context.close();
}

async function assertChunkingDisabledStateReset(browser, baseUrl) {
  const context = await browser.newContext({ viewport: { width: 1024, height: 900 }, serviceWorkers: 'block' });
  await context.addInitScript(() => {
    Object.defineProperty(window, 'MediaRecorder', {
      configurable: true,
      writable: true,
      value: undefined
    });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: undefined
    });

    const originalFetch = window.fetch.bind(window);
    window.fetch = (...args) => {
      const [resource] = args;
      const url = String(resource && resource.url ? resource.url : resource || '');
      if (url.includes('database/RA/RA.xlsx')) {
        return Promise.resolve(new Response(new Uint8Array([1, 2, 3, 4]).buffer, { status: 200 }));
      }
      return originalFetch(...args);
    };
  });

  const page = await context.newPage();
  await preparePage(page, baseUrl);
  await mockWorkbookRows(page, [
    {
      ID: 1,
      ANSWER: 'Pick / it up now',
      'ANSWER FOR COMPARE OR TRANSCRIPT': 'Pick it up now',
      'ANSWER CHUNKED': 'Pick / it up now',
      'Word count': 4
    },
    {
      ID: 2,
      ANSWER: 'Turn it on',
      'ANSWER FOR COMPARE OR TRANSCRIPT': 'Turn it on',
      'Word count': 3
    }
  ]);

  await page.evaluate(async () => {
    await window.switchToMode('read-aloud');
  });
  await page.waitForFunction(() => window.ReadAloudMode && window.ReadAloudMode.hasLoadedDatabase, { timeout: 30000 });
  await page.evaluate(async () => {
    await window.ReadAloudMode.loadSpecificPrompt(0);
  });
  await waitForPromptReady(page, { questionId: '1', textPattern: 'pick it up now' });

  await page.evaluate(() => {
    document.getElementById('ra-toggle-chunking-btn')?.click();
  });

  await page.evaluate(async () => {
    await window.ReadAloudMode.loadSpecificPrompt(1);
  });
  await waitForPromptReady(page, { questionId: '2', textPattern: 'turn it on' });

  const unavailableState = await page.evaluate(() => {
    const chunkingBtn = document.getElementById('ra-toggle-chunking-btn');
    return {
      disabled: !!chunkingBtn?.disabled,
      pressed: chunkingBtn?.getAttribute('aria-pressed') || ''
    };
  });

  assert.equal(unavailableState.disabled, true, 'chunking should disable itself on rows without ANSWER CHUNKED');
  assert.equal(unavailableState.pressed, 'false', 'disabled chunking rows should not keep a pressed state from the prior prompt');

  await context.close();
}

async function assertAssessmentGuards(browser, baseUrl) {
  const context = await browser.newContext({ viewport: { width: 1024, height: 900 }, serviceWorkers: 'block' });
  await context.addInitScript(() => {
    class FakeMediaRecorder {
      constructor(stream) {
        this.stream = stream;
        this.state = 'inactive';
        this.mimeType = 'audio/webm';
        this.listeners = {};
      }

      addEventListener(type, handler) {
        if (!this.listeners[type]) this.listeners[type] = [];
        this.listeners[type].push(handler);
      }

      start() {
        this.state = 'recording';
        window.__raRecorderStarts = Number(window.__raRecorderStarts || 0) + 1;
      }

      stop() {
        if (this.state !== 'recording') return;
        this.state = 'inactive';
        window.__raRecorderStops = Number(window.__raRecorderStops || 0) + 1;
        const blob = new Blob(['fake-audio'], { type: this.mimeType });
        (this.listeners.dataavailable || []).forEach((handler) => handler({ data: blob }));
        (this.listeners.stop || []).forEach((handler) => handler());
      }
    }

    Object.defineProperty(window, 'MediaRecorder', {
      configurable: true,
      writable: true,
      value: FakeMediaRecorder
    });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => ({
          getTracks() {
            return [{
              stop() {
                window.__raTrackStops = Number(window.__raTrackStops || 0) + 1;
              }
            }];
          }
        })
      }
    });

    const originalFetch = window.fetch.bind(window);
    window.__raFetchCount = 0;
    window.__raAssessCount = 0;
    window.__raAssessQueue = [];
    window.__resolveNextAssessment = (payload) => {
      const pending = window.__raAssessQueue.shift();
      if (!pending) return false;
      pending.resolve(new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }));
      return true;
    };

    window.fetch = (...args) => {
      const [resource] = args;
      const url = String(resource && resource.url ? resource.url : resource || '');
      if (url.includes('database/RA/RA.xlsx')) {
        window.__raFetchCount += 1;
        return Promise.resolve(new Response(new Uint8Array([1, 2, 3, 4]).buffer, { status: 200 }));
      }
      if (url.includes('/api/read-aloud/assess')) {
        window.__raAssessCount += 1;
        return new Promise((resolve, reject) => {
          window.__raAssessQueue.push({ resolve, reject });
        });
      }
      return originalFetch(...args);
    };
  });

  const page = await context.newPage();
  await preparePage(page, baseUrl);
  await mockWorkbookRows(page, [
    { ID: 1, ANSWER: 'Pick it up now', 'Word count': 4 },
    { ID: 2, ANSWER: 'Turn it on', 'Word count': 3 },
    { ID: 3, ANSWER: 'Take it away', 'Word count': 3 }
  ]);
  await stubPrepareWavBlob(page);

  await page.evaluate(async () => {
    await window.switchToMode('read-aloud');
  });
  await page.waitForFunction(() => window.ReadAloudMode && window.ReadAloudMode.hasLoadedDatabase && window.ReadAloudMode.database.length === 3, { timeout: 30000 });
  await page.evaluate(async () => {
    await window.ReadAloudMode.loadSpecificPrompt(0);
  });
  await waitForPromptReady(page, { questionId: '1', textPattern: 'pick it up now' });
  const firstPromptState = await page.evaluate(() => ({
    questionId: window.ReadAloudMode?.currentQuestionId || null,
    promptText: String(window.ReadAloudMode?.currentPromptPlainText || ''),
    statusText: String(document.getElementById('ra-status-message')?.textContent || '').trim()
  }));
  assert.equal(firstPromptState.questionId, '1', 'first prompt should load the first workbook row');
  assert.match(firstPromptState.promptText, /pick it up now/i, 'first prompt text should match the workbook row');

  await page.evaluate(() => {
    document.getElementById('ra-record-btn')?.click();
  });
  await page.waitForFunction(() => Number(window.__raRecorderStarts || 0) === 1, { timeout: 30000 });

  await page.evaluate(async () => {
    await window.ReadAloudMode.loadSpecificPrompt(1);
  });
  await waitForPromptReady(page, { questionId: '2', textPattern: 'turn it on' });
  const secondPromptState = await page.evaluate(() => ({
    questionId: window.ReadAloudMode?.currentQuestionId || null,
    promptText: String(window.ReadAloudMode?.currentPromptPlainText || ''),
    statusText: String(document.getElementById('ra-status-message')?.textContent || '').trim()
  }));
  assert.equal(secondPromptState.questionId, '2', 'second prompt should load the second workbook row');
  assert.match(secondPromptState.promptText, /turn it on/i, 'second prompt text should match the workbook row');

  const abandonedRecordingState = await page.evaluate(() => ({
    assessCount: Number(window.__raAssessCount || 0),
    recorderStops: Number(window.__raRecorderStops || 0)
  }));
  assert.equal(abandonedRecordingState.assessCount, 0, 'abandoning a recording should not submit an assessment');
  assert.ok(abandonedRecordingState.recorderStops >= 1, 'abandoning a recording should still stop the recorder');

  await page.evaluate(() => {
    document.getElementById('ra-record-btn')?.click();
  });
  await page.waitForFunction(() => Number(window.__raRecorderStarts || 0) === 2, { timeout: 30000 });

  await page.evaluate(() => {
    document.getElementById('ra-stop-btn')?.click();
  });

  await page.waitForFunction(() => {
    const status = document.getElementById('ra-status-message');
    const checkBtn = document.getElementById('ra-check-btn');
    return !!status
      && /recording captured/i.test(String(status.textContent || ''))
      && !!checkBtn
      && getComputedStyle(checkBtn).display !== 'none';
  }, { timeout: 30000 });

  await page.evaluate(() => {
    document.getElementById('ra-check-btn')?.click();
  });

  await page.waitForFunction(() => Number(window.__raAssessCount || 0) === 1 && window.__raAssessQueue.length === 1, { timeout: 30000 });

  await page.evaluate(async () => {
    await window.ReadAloudMode.loadSpecificPrompt(2);
  });
  await waitForPromptReady(page, { questionId: '3', textPattern: 'take it away' });
  const thirdPromptState = await page.evaluate(() => ({
    questionId: window.ReadAloudMode?.currentQuestionId || null,
    promptText: String(window.ReadAloudMode?.currentPromptPlainText || ''),
    statusText: String(document.getElementById('ra-status-message')?.textContent || '').trim()
  }));
  assert.equal(thirdPromptState.questionId, '3', 'third prompt should load the third workbook row');
  assert.match(thirdPromptState.promptText, /take it away/i, 'third prompt text should match the workbook row');
  assert.match(thirdPromptState.statusText, /read the text silently/i, 'loading a new prompt should reset the status to prep text');

  await page.evaluate(() => {
    window.__resolveNextAssessment({
      success: true,
      accuracyScore: 77,
      fluencyScore: 75,
      completenessScore: 80,
      recognizedText: 'Turn it on',
      words: [
        { word: 'Turn', accuracyScore: 78, errorType: 'None' },
        { word: 'it', accuracyScore: 80, errorType: 'None' },
        { word: 'on', accuracyScore: 74, errorType: 'None' }
      ]
    });
  });
  await waitForAnimationFrames(page);

  const staleAssessmentState = await page.evaluate(() => {
    const status = document.getElementById('ra-status-message');
    const accuracy = document.getElementById('ra-accuracy-value');
    const feedback = document.getElementById('ra-transcript-feedback');
    return {
      statusText: status ? String(status.textContent || '').trim() : '',
      accuracyText: accuracy ? String(accuracy.textContent || '').trim() : '',
      feedbackText: feedback ? String(feedback.textContent || '').trim() : ''
    };
  });

  assert.match(staleAssessmentState.statusText, /read the text silently/i, 'stale assessments should not overwrite the current prompt status');
  assert.notStrictEqual(staleAssessmentState.accuracyText, '77', 'stale assessments should not overwrite the current prompt score');
  assert.doesNotMatch(staleAssessmentState.feedbackText, /turn it on/i, 'stale assessments should not overwrite the current prompt feedback');

  await context.close();
}

async function assertPendingMicrophoneRequestGuards(browser, baseUrl) {
  const context = await browser.newContext({ viewport: { width: 1024, height: 900 }, serviceWorkers: 'block' });
  await context.addInitScript(() => {
    class FakeMediaRecorder {
      constructor(stream) {
        this.stream = stream;
        this.state = 'inactive';
        this.mimeType = 'audio/webm';
        this.listeners = {};
      }

      addEventListener(type, handler) {
        if (!this.listeners[type]) this.listeners[type] = [];
        this.listeners[type].push(handler);
      }

      start() {
        this.state = 'recording';
        window.__raRecorderStarts = Number(window.__raRecorderStarts || 0) + 1;
      }

      stop() {
        if (this.state !== 'recording') return;
        this.state = 'inactive';
        window.__raRecorderStops = Number(window.__raRecorderStops || 0) + 1;
        const blob = new Blob(['fake-audio'], { type: this.mimeType });
        (this.listeners.dataavailable || []).forEach((handler) => handler({ data: blob }));
        (this.listeners.stop || []).forEach((handler) => handler());
      }
    }

    Object.defineProperty(window, 'MediaRecorder', {
      configurable: true,
      writable: true,
      value: FakeMediaRecorder
    });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: () => {
          window.__raGetUserMediaCalls = Number(window.__raGetUserMediaCalls || 0) + 1;
          return new Promise((resolve) => {
            window.__raPendingMicResolvers = window.__raPendingMicResolvers || [];
            window.__raPendingMicResolvers.push(resolve);
          });
        }
      }
    });

    window.__raResolveNextMicRequest = () => {
      const pending = Array.isArray(window.__raPendingMicResolvers) ? window.__raPendingMicResolvers.shift() : null;
      if (!pending) return false;
      pending({
        getTracks() {
          return [{
            stop() {
              window.__raTrackStops = Number(window.__raTrackStops || 0) + 1;
            }
          }];
        }
      });
      return true;
    };

    const originalFetch = window.fetch.bind(window);
    window.__raFetchCount = 0;
    window.__raAssessCount = 0;
    window.fetch = (...args) => {
      const [resource] = args;
      const url = String(resource && resource.url ? resource.url : resource || '');
      if (url.includes('database/RA/RA.xlsx')) {
        window.__raFetchCount += 1;
        return Promise.resolve(new Response(new Uint8Array([1, 2, 3, 4]).buffer, { status: 200 }));
      }
      if (url.includes('/api/read-aloud/assess')) {
        window.__raAssessCount += 1;
        return Promise.resolve(new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }));
      }
      return originalFetch(...args);
    };
  });

  const page = await context.newPage();
  await preparePage(page, baseUrl);
  await mockWorkbookRows(page, [
    { ID: 1, ANSWER: 'Pick it up now', 'Word count': 4 },
    { ID: 2, ANSWER: 'Turn it on', 'Word count': 3 }
  ]);
  await stubPrepareWavBlob(page);

  await page.evaluate(async () => {
    await window.switchToMode('read-aloud');
  });
  await page.waitForFunction(() => window.ReadAloudMode && window.ReadAloudMode.hasLoadedDatabase && window.ReadAloudMode.database.length === 2, { timeout: 30000 });
  await waitForPromptReady(page);
  await page.evaluate(async () => {
    await window.ReadAloudMode.loadSpecificPrompt(0);
  });
  await waitForPromptReady(page, { questionId: '1', textPattern: 'pick it up now' });
  await page.waitForFunction(() => {
    const recordBtn = document.getElementById('ra-record-btn');
    return !!recordBtn && !recordBtn.disabled && /start recording/i.test(String(recordBtn.textContent || ''));
  }, { timeout: 30000 });

  await page.evaluate(() => {
    document.getElementById('ra-record-btn')?.click();
  });
  await page.waitForFunction(() => Number(window.__raGetUserMediaCalls || 0) === 1, { timeout: 30000 });

  await page.evaluate(async () => {
    await window.ReadAloudMode.loadSpecificPrompt(1);
  });
  await waitForPromptReady(page, { questionId: '2', textPattern: 'turn it on' });

  await page.evaluate(() => {
    window.__raResolveNextMicRequest();
  });
  await page.waitForFunction(() => {
    const status = document.getElementById('ra-status-message');
    const recordBtn = document.getElementById('ra-record-btn');
    return (
      Number(window.__raTrackStops || 0) >= 1 &&
      !!status &&
      /read the text silently/i.test(String(status.textContent || '')) &&
      !!recordBtn &&
      /start recording/i.test(String(recordBtn.textContent || ''))
    );
  }, { timeout: 30000 });

  const afterPromptSwitch = await page.evaluate(() => {
    const status = document.getElementById('ra-status-message');
    const recordBtn = document.getElementById('ra-record-btn');
    return {
      recorderStarts: Number(window.__raRecorderStarts || 0),
      assessCount: Number(window.__raAssessCount || 0),
      trackStops: Number(window.__raTrackStops || 0),
      statusText: status ? String(status.textContent || '').trim() : '',
      recordText: recordBtn ? String(recordBtn.textContent || '').trim() : ''
    };
  });
  assert.equal(afterPromptSwitch.recorderStarts, 0, 'a stale microphone request should not start recording after prompt change');
  assert.equal(afterPromptSwitch.assessCount, 0, 'a stale microphone request should not submit an assessment after prompt change');
  assert.ok(afterPromptSwitch.trackStops >= 1, 'stale microphone streams should be stopped after prompt change');
  assert.match(afterPromptSwitch.statusText, /read the text silently/i, 'prompt switch should keep prep status after stale microphone resolution');
  assert.match(afterPromptSwitch.recordText, /start recording/i, 'prompt switch should leave the prompt ready to record again');

  await page.evaluate(async () => {
    await window.ReadAloudMode.loadSpecificPrompt(0);
  });
  await waitForPromptReady(page, { questionId: '1', textPattern: 'pick it up now' });

  await page.evaluate(() => {
    document.getElementById('ra-record-btn')?.click();
  });
  await page.waitForFunction(() => Number(window.__raGetUserMediaCalls || 0) === 2, { timeout: 30000 });

  await page.evaluate(async () => {
    await window.switchToMode('type');
  });
  await page.evaluate(() => {
    window.__raResolveNextMicRequest();
  });
  await page.waitForFunction(() => (
    Number(window.__raTrackStops || 0) >= 2 &&
    !document.getElementById('mode-read-aloud')?.classList.contains('active') &&
    !!document.getElementById('mode-type')?.classList.contains('active') &&
    !window.ReadAloudMode?.currentPromptReady
  ), { timeout: 30000 });

  const afterExit = await page.evaluate(() => ({
    recorderStarts: Number(window.__raRecorderStarts || 0),
    assessCount: Number(window.__raAssessCount || 0),
    trackStops: Number(window.__raTrackStops || 0),
    promptReady: !!window.ReadAloudMode?.currentPromptReady,
    readAloudActive: !!document.getElementById('mode-read-aloud')?.classList.contains('active'),
    typeActive: !!document.getElementById('mode-type')?.classList.contains('active')
  }));
  assert.equal(afterExit.recorderStarts, 0, 'leaving Read Aloud should cancel pending microphone requests before recording starts');
  assert.equal(afterExit.assessCount, 0, 'leaving Read Aloud should not submit assessments from stale microphone requests');
  assert.ok(afterExit.trackStops >= 2, 'stale microphone streams should be stopped after leaving Read Aloud');
  assert.equal(afterExit.promptReady, false, 'leaving Read Aloud should clear prompt readiness state');
  assert.equal(afterExit.readAloudActive, false, 'Read Aloud should stay inactive after leaving the mode');
  assert.equal(afterExit.typeActive, true, 'the fallback mode should remain active after cancelling a stale microphone request');

  await context.close();
}

async function assertMicrophoneErrorRecovery(browser, baseUrl) {
  const context = await browser.newContext({ viewport: { width: 1024, height: 900 }, serviceWorkers: 'block' });
  await context.addInitScript(() => {
    class FakeMediaRecorder {
      constructor(stream) {
        this.stream = stream;
        this.state = 'inactive';
      }

      addEventListener() { }
      start() {
        this.state = 'recording';
        window.__raRecorderStarts = Number(window.__raRecorderStarts || 0) + 1;
      }
      stop() {
        this.state = 'inactive';
      }
    }

    Object.defineProperty(window, 'MediaRecorder', {
      configurable: true,
      writable: true,
      value: FakeMediaRecorder
    });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => {
          throw new DOMException('Permission blocked', 'NotAllowedError');
        }
      }
    });

    const originalFetch = window.fetch.bind(window);
    window.__raFetchCount = 0;
    window.fetch = (...args) => {
      const [resource] = args;
      const url = String(resource && resource.url ? resource.url : resource || '');
      if (url.includes('database/RA/RA.xlsx')) {
        window.__raFetchCount += 1;
        return Promise.resolve(new Response(new Uint8Array([1, 2, 3, 4]).buffer, { status: 200 }));
      }
      return originalFetch(...args);
    };
  });

  const page = await context.newPage();
  await preparePage(page, baseUrl);
  await mockWorkbookRows(page, [
    { ID: 1, ANSWER: 'Pick it up now', 'Word count': 4 }
  ]);

  await page.evaluate(async () => {
    await window.switchToMode('read-aloud');
  });
  await page.waitForFunction(() => window.ReadAloudMode && window.ReadAloudMode.hasLoadedDatabase && window.ReadAloudMode.database.length === 1, { timeout: 30000 });
  await waitForPromptReady(page, { questionId: '1', textPattern: 'pick it up now' });
  await page.evaluate(async () => {
    await window.ReadAloudMode.loadSpecificPrompt(0);
  });
  await waitForPromptReady(page, { questionId: '1', textPattern: 'pick it up now' });

  await page.waitForFunction(() => {
    const text = document.getElementById('ra-text-prompt');
    return !!text && /pick it up now/i.test(String(text.textContent || ''));
  }, { timeout: 30000 });

  await page.evaluate(() => {
    document.getElementById('ra-record-btn')?.click();
  });

  await page.waitForFunction(() => {
    const status = document.getElementById('ra-status-message');
    const recordBtn = document.getElementById('ra-record-btn');
    const stopBtn = document.getElementById('ra-stop-btn');
    return (
      !!status &&
      /blocked|allow microphone access/i.test(String(status.textContent || '')) &&
      !!recordBtn &&
      /start recording/i.test(String(recordBtn.textContent || '')) &&
      !recordBtn.disabled &&
      !!stopBtn &&
      getComputedStyle(stopBtn).display === 'none'
    );
  }, { timeout: 30000 });

  const state = await page.evaluate(() => {
    const status = document.getElementById('ra-status-message');
    const recordBtn = document.getElementById('ra-record-btn');
    return {
      fetchCount: Number(window.__raFetchCount || 0),
      statusText: status ? String(status.textContent || '').trim() : '',
      recordText: recordBtn ? String(recordBtn.textContent || '').trim() : '',
      recordDisabled: recordBtn ? !!recordBtn.disabled : null
    };
  });
  assert.equal(state.fetchCount, 1, 'permission denial should not reload the database');
  assert.match(state.statusText, /blocked|allow microphone access/i, 'permission denial should show a retryable microphone access message');
  assert.doesNotMatch(state.statusText, /unsupported/i, 'permission denial should not be reported as unsupported browser');
  assert.match(state.recordText, /start recording/i, 'permission denial should leave the prompt in prep state');
  assert.equal(state.recordDisabled, false, 'permission denial should keep the record button enabled');

  await context.close();
}

async function assertUnsupportedWithoutWebAudio(browser, baseUrl) {
  const context = await browser.newContext({ viewport: { width: 1024, height: 900 }, serviceWorkers: 'block' });
  await context.addInitScript(() => {
    class FakeMediaRecorder {
      addEventListener() { }
      start() { }
      stop() { }
    }

    Object.defineProperty(window, 'MediaRecorder', {
      configurable: true,
      writable: true,
      value: FakeMediaRecorder
    });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => ({
          getTracks() {
            return [];
          }
        })
      }
    });
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      writable: true,
      value: undefined
    });
    Object.defineProperty(window, 'webkitAudioContext', {
      configurable: true,
      writable: true,
      value: undefined
    });
    Object.defineProperty(window, 'OfflineAudioContext', {
      configurable: true,
      writable: true,
      value: undefined
    });

    const originalFetch = window.fetch.bind(window);
    window.__raFetchCount = 0;
    window.fetch = (...args) => {
      const [resource] = args;
      const url = String(resource && resource.url ? resource.url : resource || '');
      if (url.includes('database/RA/RA.xlsx')) {
        window.__raFetchCount += 1;
        return Promise.resolve(new Response(new Uint8Array([1, 2, 3, 4]).buffer, { status: 200 }));
      }
      return originalFetch(...args);
    };
  });

  const page = await context.newPage();
  await preparePage(page, baseUrl);
  await mockWorkbookRows(page, [
    { ID: 1, ANSWER: 'Pick it up now', 'Word count': 4 }
  ]);

  await page.evaluate(async () => {
    await window.switchToMode('read-aloud');
  });
  await page.waitForFunction(() => window.ReadAloudMode && window.ReadAloudMode.hasLoadedDatabase && window.ReadAloudMode.database.length === 1, { timeout: 30000 });
  await page.evaluate(async () => {
    await window.ReadAloudMode.loadSpecificPrompt(0);
  });
  await waitForPromptReady(page, { questionId: '1', textPattern: 'pick it up now' });
  await page.waitForFunction(() => {
    const status = document.getElementById('ra-status-message');
    const recordBtn = document.getElementById('ra-record-btn');
    const prepTimerBox = document.getElementById('ra-prep-timer-box');
    const recordTimerBox = document.getElementById('ra-record-timer-box');
    return (
      !!window.ReadAloudMode &&
      !!window.ReadAloudMode.currentPromptReady &&
      Number(window.__raFetchCount || 0) >= 1 &&
      !!status &&
      /microphone recording is not supported/i.test(String(status.textContent || '')) &&
      !!recordBtn &&
      String(recordBtn.textContent || '').trim() === 'Unsupported Browser' &&
      recordBtn.disabled &&
      !!prepTimerBox &&
      !!recordTimerBox &&
      Number.parseFloat(getComputedStyle(prepTimerBox).opacity || '1') < 1 &&
      Number.parseFloat(getComputedStyle(recordTimerBox).opacity || '1') < 1
    );
  }, { timeout: 30000 });

  const debug = await page.evaluate(() => {
    const status = document.getElementById('ra-status-message');
    const recordBtn = document.getElementById('ra-record-btn');
    const prepTimerBox = document.getElementById('ra-prep-timer-box');
    const recordTimerBox = document.getElementById('ra-record-timer-box');
    return {
      fetchCount: Number(window.__raFetchCount || 0),
      support: window.ReadAloudMode ? window.ReadAloudMode.getRecordingSupportState() : null,
      statusText: status ? String(status.textContent || '').trim() : '',
      recordText: recordBtn ? String(recordBtn.textContent || '').trim() : '',
      recordDisabled: recordBtn ? Boolean(recordBtn.disabled) : null,
      prepOpacity: prepTimerBox ? getComputedStyle(prepTimerBox).opacity : null,
      recordOpacity: recordTimerBox ? getComputedStyle(recordTimerBox).opacity : null
    };
  });

  assert.equal(debug.fetchCount, 1, 'unsupported browser should load the database once');
  assert.match(debug.statusText, /microphone recording is not supported/i, 'unsupported browser should show the unsupported message');
  assert.equal(debug.recordText, 'Unsupported Browser', 'unsupported browser should disable recording');
  assert.equal(debug.recordDisabled, true, 'unsupported browser should keep the record button disabled');
  assert.ok(Number.parseFloat(debug.prepOpacity || '1') < 1, 'unsupported browser should dim the prep timer');
  assert.ok(Number.parseFloat(debug.recordOpacity || '1') < 1, 'unsupported browser should dim the record timer');

  await context.close();
}

async function assertAssessmentFailureFeedback(browser, baseUrl) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.addInitScript(() => {
    class FakeMediaRecorder {
      constructor() {
        this.state = 'inactive';
        this.listeners = {};
        this.mimeType = 'audio/webm';
      }

      addEventListener(type, handler) {
        if (!this.listeners[type]) this.listeners[type] = [];
        this.listeners[type].push(handler);
      }

      removeEventListener(type, handler) {
        this.listeners[type] = (this.listeners[type] || []).filter((item) => item !== handler);
      }

      start() {
        this.state = 'recording';
        window.__raRecorderStarts = Number(window.__raRecorderStarts || 0) + 1;
      }

      stop() {
        if (this.state !== 'recording') return;
        this.state = 'inactive';
        const blob = new Blob(['fake-audio'], { type: this.mimeType });
        (this.listeners.dataavailable || []).forEach((handler) => handler({ data: blob }));
        (this.listeners.stop || []).forEach((handler) => handler());
      }
    }

    Object.defineProperty(window, 'MediaRecorder', {
      configurable: true,
      writable: true,
      value: FakeMediaRecorder
    });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => ({
          getTracks() {
            return [{ stop() { } }];
          }
        })
      }
    });

    const originalFetch = window.fetch.bind(window);
    window.fetch = (...args) => {
      const [resource] = args;
      const url = String(resource && resource.url ? resource.url : resource || '');
      if (url.includes('database/RA/RA.xlsx')) {
        return Promise.resolve(new Response(new Uint8Array([1, 2, 3, 4]).buffer, { status: 200 }));
      }
      if (url.includes('/api/read-aloud/assess')) {
        return Promise.resolve(new Response(JSON.stringify({
          success: false,
          error: 'INVALID_AUDIO',
          message: 'Audio file could not be processed.',
          details: {
            reason: 'too_long',
            maxDurationMs: 45000
          }
        }), {
          status: 422,
          headers: { 'Content-Type': 'application/json' }
        }));
      }
      return originalFetch(...args);
    };
  });

  const page = await context.newPage();
  await preparePage(page, baseUrl);
  await mockWorkbookRows(page, [
    { ID: 1, ANSWER: 'Pick it up now', 'Word count': 4 }
  ]);
  await stubPrepareWavBlob(page);

  await page.evaluate(async () => {
    await window.switchToMode('read-aloud');
  });
  await page.waitForFunction(() => window.ReadAloudMode && window.ReadAloudMode.hasLoadedDatabase && window.ReadAloudMode.database.length === 1, { timeout: 30000 });
  await page.evaluate(async () => {
    await window.ReadAloudMode.loadSpecificPrompt(0);
  });
  await waitForPromptReady(page, { questionId: '1', textPattern: 'pick it up now' });
  await page.waitForFunction(() => {
    const recordBtn = document.getElementById('ra-record-btn');
    return !!recordBtn && !recordBtn.disabled && /start recording/i.test(String(recordBtn.textContent || ''));
  }, { timeout: 30000 });

  await page.evaluate(() => {
    document.getElementById('ra-record-btn')?.click();
  });
  await page.waitForFunction(() => Number(window.__raRecorderStarts || 0) === 1, { timeout: 30000 });
  await page.evaluate(() => {
    document.getElementById('ra-stop-btn')?.click();
  });

  await page.waitForFunction(() => {
    const checkBtn = document.getElementById('ra-check-btn');
    return !!checkBtn && getComputedStyle(checkBtn).display !== 'none';
  }, { timeout: 30000 });
  await page.evaluate(() => {
    document.getElementById('ra-check-btn')?.click();
  });

  await page.waitForFunction(() => {
    const status = document.getElementById('ra-status-message');
    const accuracy = document.getElementById('ra-accuracy-value');
    const feedback = document.getElementById('ra-transcript-feedback');
    return (
      !!status &&
      /too long to score|under 40 seconds/i.test(String(status.textContent || '')) &&
      !!accuracy &&
      String(accuracy.textContent || '').trim() === '--' &&
      !!feedback &&
      /too long/i.test(String(feedback.textContent || ''))
    );
  }, { timeout: 30000 });

  const failureState = await page.evaluate(() => ({
    statusText: String(document.getElementById('ra-status-message')?.textContent || '').trim(),
    accuracyText: String(document.getElementById('ra-accuracy-value')?.textContent || '').trim(),
    feedbackText: String(document.getElementById('ra-transcript-feedback')?.textContent || '').trim()
  }));
  assert.match(failureState.statusText, /too long to score|under 40 seconds/i, 'too-long assessment should show a specific retry message');
  assert.equal(failureState.accuracyText, '--', 'failed assessment should not present a fake 0% score');
  assert.match(failureState.feedbackText, /too long/i, 'failed assessment should explain why scoring was unavailable');

  await context.close();
}

async function assertZeroScoreAssessmentPayloadShowsFailure(browser, baseUrl) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.addInitScript(() => {
    class FakeMediaRecorder {
      constructor() {
        this.state = 'inactive';
        this.listeners = {};
        this.mimeType = 'audio/webm';
      }

      addEventListener(type, handler) {
        if (!this.listeners[type]) this.listeners[type] = [];
        this.listeners[type].push(handler);
      }

      removeEventListener(type, handler) {
        this.listeners[type] = (this.listeners[type] || []).filter((item) => item !== handler);
      }

      start() {
        this.state = 'recording';
        window.__raRecorderStarts = Number(window.__raRecorderStarts || 0) + 1;
      }

      stop() {
        if (this.state !== 'recording') return;
        this.state = 'inactive';
        const blob = new Blob(['fake-audio'], { type: this.mimeType });
        (this.listeners.dataavailable || []).forEach((handler) => handler({ data: blob }));
        (this.listeners.stop || []).forEach((handler) => handler());
      }
    }

    Object.defineProperty(window, 'MediaRecorder', {
      configurable: true,
      writable: true,
      value: FakeMediaRecorder
    });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => ({
          getTracks() {
            return [{ stop() { } }];
          }
        })
      }
    });

    const originalFetch = window.fetch.bind(window);
    window.fetch = (...args) => {
      const [resource] = args;
      const url = String(resource && resource.url ? resource.url : resource || '');
      if (url.includes('database/RA/RA.xlsx')) {
        return Promise.resolve(new Response(new Uint8Array([1, 2, 3, 4]).buffer, { status: 200 }));
      }
      if (url.includes('/api/read-aloud/assess')) {
        return Promise.resolve(new Response(JSON.stringify({
          success: true,
          accuracyScore: 0,
          fluencyScore: 0,
          completenessScore: 0,
          pronScore: 0,
          recognizedText: 'Hopefully this will treat and prevent acne',
          words: [
            { word: 'Hopefully', accuracyScore: 0, errorType: 'None' },
            { word: 'this', accuracyScore: 0, errorType: 'None' },
            { word: 'will', accuracyScore: 0, errorType: 'None' }
          ],
          connectedSpeech: {
            status: 'unavailable',
            summary: { detectedCount: 0, notDetectedCount: 0, uncertainCount: 0 },
            events: []
          }
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }));
      }
      return originalFetch(...args);
    };
  });

  const page = await context.newPage();
  await preparePage(page, baseUrl);
  await mockWorkbookRows(page, [
    { ID: 1, ANSWER: 'Hopefully this will treat and prevent acne', 'Word count': 7 }
  ]);
  await stubPrepareWavBlob(page);

  await page.evaluate(async () => {
    await window.switchToMode('read-aloud');
  });
  await page.waitForFunction(() => window.ReadAloudMode && window.ReadAloudMode.hasLoadedDatabase && window.ReadAloudMode.database.length === 1, { timeout: 30000 });
  await page.evaluate(async () => {
    await window.ReadAloudMode.loadSpecificPrompt(0);
  });
  await waitForPromptReady(page, { questionId: '1', textPattern: 'hopefully this will treat' });
  await page.waitForFunction(() => {
    const recordBtn = document.getElementById('ra-record-btn');
    return !!recordBtn && !recordBtn.disabled && /start recording/i.test(String(recordBtn.textContent || ''));
  }, { timeout: 30000 });

  await page.evaluate(() => {
    document.getElementById('ra-record-btn')?.click();
  });
  await page.waitForFunction(() => Number(window.__raRecorderStarts || 0) === 1, { timeout: 30000 });
  await page.evaluate(() => {
    document.getElementById('ra-stop-btn')?.click();
  });

  await page.waitForFunction(() => {
    const checkBtn = document.getElementById('ra-check-btn');
    return !!checkBtn && getComputedStyle(checkBtn).display !== 'none';
  }, { timeout: 30000 });
  await page.evaluate(() => {
    document.getElementById('ra-check-btn')?.click();
  });

  await page.waitForFunction(() => {
    const status = document.getElementById('ra-status-message');
    const accuracy = document.getElementById('ra-accuracy-value');
    const feedback = document.getElementById('ra-transcript-feedback');
    return (
      !!status &&
      /scoring was unavailable|under 40 seconds/i.test(String(status.textContent || '')) &&
      !!accuracy &&
      String(accuracy.textContent || '').trim() === '--' &&
      !!feedback &&
      /not returned|could not score/i.test(String(feedback.textContent || ''))
    );
  }, { timeout: 30000 });

  const failureState = await page.evaluate(() => ({
    statusText: String(document.getElementById('ra-status-message')?.textContent || '').trim(),
    accuracyText: String(document.getElementById('ra-accuracy-value')?.textContent || '').trim(),
    feedbackText: String(document.getElementById('ra-transcript-feedback')?.textContent || '').trim()
  }));
  assert.match(failureState.statusText, /scoring was unavailable|under 40 seconds/i, 'all-zero payload should be treated as a scoring failure');
  assert.equal(failureState.accuracyText, '--', 'all-zero payload should not present a fake 0% score');
  assert.match(failureState.feedbackText, /not returned|could not score/i, 'all-zero payload should explain that scoring was unavailable');

  await context.close();
}

async function assertDirectAccuracyPayloadShowsScoredResult(browser, baseUrl) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.addInitScript(() => {
    class FakeMediaRecorder {
      constructor() {
        this.state = 'inactive';
        this.listeners = {};
        this.mimeType = 'audio/webm';
      }

      addEventListener(type, handler) {
        if (!this.listeners[type]) this.listeners[type] = [];
        this.listeners[type].push(handler);
      }

      removeEventListener(type, handler) {
        this.listeners[type] = (this.listeners[type] || []).filter((item) => item !== handler);
      }

      start() {
        this.state = 'recording';
        window.__raRecorderStarts = Number(window.__raRecorderStarts || 0) + 1;
      }

      stop() {
        if (this.state !== 'recording') return;
        this.state = 'inactive';
        const blob = new Blob(['fake-audio'], { type: this.mimeType });
        (this.listeners.dataavailable || []).forEach((handler) => handler({ data: blob }));
        (this.listeners.stop || []).forEach((handler) => handler());
      }
    }

    Object.defineProperty(window, 'MediaRecorder', {
      configurable: true,
      writable: true,
      value: FakeMediaRecorder
    });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => ({
          getTracks() {
            return [{ stop() { } }];
          }
        })
      }
    });

    const originalFetch = window.fetch.bind(window);
    window.fetch = (...args) => {
      const [resource] = args;
      const url = String(resource && resource.url ? resource.url : resource || '');
      if (url.includes('database/RA/RA.xlsx')) {
        return Promise.resolve(new Response(new Uint8Array([1, 2, 3, 4]).buffer, { status: 200 }));
      }
      if (url.includes('/api/read-aloud/assess')) {
        return Promise.resolve(new Response(JSON.stringify({
          success: true,
          accuracyScore: 91,
          fluencyScore: null,
          completenessScore: null,
          pronScore: null,
          recognizedText: 'Pick it up now',
          words: [
            { word: 'Pick', accuracyScore: 94, errorType: 'None' },
            { word: 'it', accuracyScore: 90, errorType: 'None' },
            { word: 'up', accuracyScore: 88, errorType: 'None' },
            { word: 'now', accuracyScore: 92, errorType: 'None' }
          ],
          connectedSpeech: {
            status: 'complete',
            summary: { detectedCount: 1, notDetectedCount: 0, uncertainCount: 0 },
            events: [{
              id: 'evt-1',
              phrase: 'pick it',
              family: 'catenation',
              category: 'linking',
              status: 'detected',
              coachText: 'Linked smoothly.'
            }]
          }
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }));
      }
      return originalFetch(...args);
    };
  });

  const page = await context.newPage();
  await preparePage(page, baseUrl);
  await mockWorkbookRows(page, [
    { ID: 1, ANSWER: 'Pick it up now', 'Word count': 4 }
  ]);
  await stubPrepareWavBlob(page);

  await page.evaluate(async () => {
    await window.switchToMode('read-aloud');
  });
  await page.waitForFunction(() => window.ReadAloudMode && window.ReadAloudMode.hasLoadedDatabase && window.ReadAloudMode.database.length === 1, { timeout: 30000 });
  await page.evaluate(async () => {
    await window.ReadAloudMode.loadSpecificPrompt(0);
  });
  await waitForPromptReady(page, { questionId: '1', textPattern: 'pick it up now' });
  await page.waitForFunction(() => {
    const recordBtn = document.getElementById('ra-record-btn');
    return !!recordBtn && !recordBtn.disabled && /start recording/i.test(String(recordBtn.textContent || ''));
  }, { timeout: 30000 });

  await page.evaluate(() => {
    document.getElementById('ra-record-btn')?.click();
  });
  await page.waitForFunction(() => Number(window.__raRecorderStarts || 0) === 1, { timeout: 30000 });
  await page.evaluate(() => {
    document.getElementById('ra-stop-btn')?.click();
  });

  await page.waitForFunction(() => {
    const checkBtn = document.getElementById('ra-check-btn');
    return !!checkBtn && getComputedStyle(checkBtn).display !== 'none';
  }, { timeout: 30000 });
  await page.evaluate(() => {
    document.getElementById('ra-check-btn')?.click();
  });

  await page.waitForFunction(() => {
    const status = document.getElementById('ra-status-message');
    const accuracy = document.getElementById('ra-accuracy-value');
    const feedback = document.getElementById('ra-transcript-feedback');
    return (
      !!status &&
      /analysis complete/i.test(String(status.textContent || '')) &&
      !!accuracy &&
      String(accuracy.textContent || '').trim() === '91' &&
      !!feedback &&
      !/Fluency:/i.test(String(feedback.textContent || '')) &&
      !/Completeness:/i.test(String(feedback.textContent || ''))
    );
  }, { timeout: 30000 });

  const resultState = await page.evaluate(() => ({
    statusText: String(document.getElementById('ra-status-message')?.textContent || '').trim(),
    accuracyText: String(document.getElementById('ra-accuracy-value')?.textContent || '').trim(),
    feedbackText: String(document.getElementById('ra-transcript-feedback')?.textContent || '').trim(),
    mergedTokenCount: document.querySelectorAll('#ra-merged-recognized-transcript .ra-word-token').length,
    duplicateCoachTranscriptText: String(document.getElementById('ra-connected-speech-paragraph')?.textContent || '').trim(),
    transcriptInstruction: String(document.getElementById('ra-transcript-instruction')?.textContent || '').trim()
  }));
  assert.match(resultState.statusText, /analysis complete/i, 'direct Azure score fields should render as a successful assessment');
  assert.equal(resultState.accuracyText, '91', 'direct Azure score fields should populate the main accuracy score');
  assert.doesNotMatch(resultState.feedbackText, /Fluency:/i, 'missing fluency should stay hidden instead of showing a fake zero');
  assert.doesNotMatch(resultState.feedbackText, /Completeness:/i, 'missing completeness should stay hidden instead of showing a fake zero');
  assert.equal(resultState.mergedTokenCount, 4, 'direct Azure results should render one merged token transcript');
  assert.equal(resultState.duplicateCoachTranscriptText, '', 'Speech Coach should not render a duplicate transcript');
  assert.match(resultState.transcriptInstruction, /Ctrl\+click/i, 'merged transcript should explain Ctrl+click feedback navigation');

  await context.close();
}

/**
 * T5-T8: Speech Coach accordion interactions and edge cases.
 * Uses Mock B with reduced words (weak_forms) to test accordion rendering,
 * expand/collapse, single-card grid, and unavailable status.
 */
async function assertSpeechCoachAccordionAndEdgeCases(browser, baseUrl) {
  const context = await browser.newContext();

  await context.route('**/*', async (route) => {
    // Block non-essential resources for speed
    if (['image', 'font', 'media'].includes(route.request().resourceType())) {
      return route.abort();
    }
    return route.continue();
  });

  const page = await context.newPage();
  await preparePage(page, baseUrl);

  // Mock B: reduced words + linking for accordion testing
  await page.evaluate(() => {
    window.__scAccordionAssessCount = 0;
    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
      const url = String(args[0] || '');
      if (url.includes('/api/read-aloud/assess')) {
        window.__scAccordionAssessCount += 1;
        return new Response(JSON.stringify({
          success: true,
          recognizedText: 'I want to go to the store and pick it up',
          accuracyScore: 88,
          words: [
            { word: 'I', accuracyScore: 95, errorType: 'None' },
            { word: 'want', accuracyScore: 90, errorType: 'None' },
            { word: 'to', accuracyScore: 85, errorType: 'None' },
            { word: 'go', accuracyScore: 92, errorType: 'None' },
            { word: 'to', accuracyScore: 80, errorType: 'None' },
            { word: 'the', accuracyScore: 88, errorType: 'None' },
            { word: 'store', accuracyScore: 91, errorType: 'None' },
            { word: 'and', accuracyScore: 86, errorType: 'None' },
            { word: 'pick', accuracyScore: 93, errorType: 'None' },
            { word: 'it', accuracyScore: 89, errorType: 'None' },
            { word: 'up', accuracyScore: 87, errorType: 'None' }
          ],
          connectedSpeech: {
            status: 'complete',
            version: 'cs-v1',
            summary: { detectedCount: 2, notDetectedCount: 2, uncertainCount: 0 },
            events: [
              { eventId: 'r1', family: 'weak_forms', category: 'weak_forms', phrase: 'to', status: 'detected', feedbackText: 'Good reduction of "to".' },
              { eventId: 'r2', family: 'weak_forms', category: 'weak_forms', phrase: 'to', status: 'not_detected', feedbackText: 'Try reducing "to" more — say it like "tuh".' },
              { eventId: 'r3', family: 'weak_forms', category: 'weak_forms', phrase: 'and', status: 'detected', feedbackText: 'Good.' },
              { eventId: 'l1', family: 'catenation', category: 'linking', phrase: 'pick it', status: 'not_detected', feedbackText: 'Link "pick it" more smoothly.' }
            ]
          }
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return originalFetch(...args);
    };
  });

  await mockWorkbookRows(page, [
    {
      ID: 1,
      ANSWER: 'I want / to go / to the store / and pick / it up',
      'ANSWER FOR COMPARE OR TRANSCRIPT': 'I want to go to the store and pick it up',
      'ANSWER CHUNKED': 'I want / to go / to the store / and pick / it up',
      'Word count': 11
    }
  ]);

  await stubPrepareWavBlob(page);

  // Navigate to Read Aloud
  await page.evaluate(() => {
    window.switchToMode('read-aloud');
  });
  await page.waitForFunction(() => window.ReadAloudMode?.currentPromptReady, { timeout: 30000 });

  await submitMockReadAloudAttempt(page);

  // Wait for assessment results to render
  await page.waitForFunction(() => {
    const list = document.getElementById('ra-connected-speech-list');
    const accordion = list?.querySelector('.sc-accordion-card');
    return Number(window.__scAccordionAssessCount || 0) === 1 && !!accordion;
  }, { timeout: 30000 });

  // T5: Multi-occurrence reduced words as accordion
  const accordionState = await page.evaluate(() => {
    const list = document.getElementById('ra-connected-speech-list');
    const leftCol = list?.querySelector('.sc-grid-left');
    const accordion = leftCol?.querySelector('.sc-accordion-card');
    const toggle = accordion?.querySelector('.sc-accordion-toggle');
    const dots = accordion?.querySelectorAll('.sc-status-dot') || [];
    const countBadge = accordion?.querySelector('.sc-count-badge');
    return {
      hasAccordion: !!accordion,
      ariaExpanded: toggle?.getAttribute('aria-expanded') || '',
      dotCount: dots.length,
      countText: countBadge ? String(countBadge.textContent || '').trim() : '',
      wordTitle: accordion?.querySelector('.sc-word-title')?.textContent?.trim() || ''
    };
  });
  assert.ok(accordionState.hasAccordion, 'T5: multi-occurrence word "to" should render as accordion');
  assert.equal(accordionState.ariaExpanded, 'false', 'T5: accordion should start collapsed');
  assert.equal(accordionState.dotCount, 2, 'T5: should show 2 status dots for 2 instances of "to"');
  assert.equal(accordionState.countText, '2x', 'T5: count badge should show 2x');
  assert.match(accordionState.wordTitle, /to/i, 'T5: accordion title should show the word "to"');

  // T6: Accordion expand/collapse
  await page.evaluate(() => {
    const toggle = document.querySelector('.sc-accordion-toggle');
    if (toggle) toggle.click();
  });
  const expandedState = await page.evaluate(() => {
    const toggle = document.querySelector('.sc-accordion-toggle');
    const contentId = toggle?.getAttribute('aria-controls');
    const content = contentId ? document.getElementById(contentId) : null;
    const chevron = toggle?.querySelector('.sc-chevron');
    const instances = content?.querySelectorAll('.sc-instance') || [];
    return {
      ariaExpanded: toggle?.getAttribute('aria-expanded') || '',
      contentHidden: content ? content.hidden : true,
      chevronOpen: chevron ? chevron.classList.contains('sc-chevron--open') : false,
      instanceCount: instances.length
    };
  });
  assert.equal(expandedState.ariaExpanded, 'true', 'T6: accordion should expand on click');
  assert.equal(expandedState.contentHidden, false, 'T6: content panel should be visible');
  assert.equal(expandedState.chevronOpen, true, 'T6: chevron should rotate to open state');
  assert.equal(expandedState.instanceCount, 2, 'T6: expanded content should show 2 instance rows');

  // Click again to collapse
  await page.evaluate(() => {
    const toggle = document.querySelector('.sc-accordion-toggle');
    if (toggle) toggle.click();
  });
  const collapsedState = await page.evaluate(() => {
    const toggle = document.querySelector('.sc-accordion-toggle');
    const contentId = toggle?.getAttribute('aria-controls');
    const content = contentId ? document.getElementById(contentId) : null;
    const chevron = toggle?.querySelector('.sc-chevron');
    return {
      ariaExpanded: toggle?.getAttribute('aria-expanded') || '',
      contentHidden: content ? content.hidden : true,
      chevronOpen: chevron ? chevron.classList.contains('sc-chevron--open') : false
    };
  });
  assert.equal(collapsedState.ariaExpanded, 'false', 'T6: accordion should collapse on second click');
  assert.equal(collapsedState.contentHidden, true, 'T6: content panel should be hidden after collapse');
  assert.equal(collapsedState.chevronOpen, false, 'T6: chevron should rotate back to closed state');

  // T7: Single-occurrence reduced words as grid cards
  const singleCardState = await page.evaluate(() => {
    const leftCol = document.querySelector('.sc-grid-left');
    const singleCards = leftCol?.querySelectorAll('.sc-single-card') || [];
    const firstCard = singleCards.length > 0 ? singleCards[0] : null;
    return {
      singleCardCount: singleCards.length,
      hasStatusDot: firstCard ? !!firstCard.querySelector('.sc-status-dot') : false,
      cardWord: firstCard?.querySelector('.sc-word-title')?.textContent?.trim() || ''
    };
  });
  assert.ok(singleCardState.singleCardCount >= 1, 'T7: single-occurrence "and" should render as grid card');
  assert.ok(singleCardState.hasStatusDot, 'T7: single card should have status dot');
  assert.match(singleCardState.cardWord, /and/i, 'T7: single card should show "and"');

  await context.close();

  // T8: Unavailable status hides panel (separate context)
  const ctx2 = await browser.newContext();
  const page2 = await ctx2.newPage();
  await preparePage(page2, baseUrl);

  await page2.evaluate(() => {
    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
      const url = String(args[0] || '');
      if (url.includes('/api/read-aloud/assess')) {
        return new Response(JSON.stringify({
          success: true,
          recognizedText: 'test',
          accuracyScore: 50,
          words: [{ word: 'test', accuracyScore: 50, errorType: 'None' }],
          connectedSpeech: { status: 'unavailable' }
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return originalFetch(...args);
    };
  });

  await mockWorkbookRows(page2, [
    { ID: 1, ANSWER: 'test', 'ANSWER FOR COMPARE OR TRANSCRIPT': 'test', 'ANSWER CHUNKED': 'test', 'Word count': 1 }
  ]);
  await stubPrepareWavBlob(page2);

  await page2.evaluate(() => { window.switchToMode('read-aloud'); });
  await page2.waitForFunction(() => window.ReadAloudMode?.currentPromptReady, { timeout: 30000 });

  await submitMockReadAloudAttempt(page2);

  await page2.waitForFunction(() => {
    const summary = document.getElementById('ra-connected-speech-summary');
    return summary && /unavailable/i.test(String(summary.textContent || ''));
  }, { timeout: 30000 });

  const unavailableState = await page2.evaluate(() => {
    const summary = document.getElementById('ra-connected-speech-summary');
    const list = document.getElementById('ra-connected-speech-list');
    return {
      summaryText: String(summary?.textContent || '').trim(),
      listChildren: list ? list.children.length : -1
    };
  });
  assert.match(unavailableState.summaryText, /unavailable/i, 'T8: summary should mention unavailable');
  assert.equal(unavailableState.listChildren, 0, 'T8: list should be empty for unavailable status');

  await ctx2.close();
}

async function run() {
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let serverLogs = '';
  server.stdout.on('data', (chunk) => { serverLogs += String(chunk); });
  server.stderr.on('data', (chunk) => { serverLogs += String(chunk); });

  let browser;
  try {
    await waitForServer(`${baseUrl}/api/health`);
    browser = await chromium.launch({ headless: true });
    await assertUnsupportedFlow(browser, baseUrl);
    await assertSupportedFlow(browser, baseUrl);
    await assertChunkingDisabledStateReset(browser, baseUrl);
    await assertAssessmentGuards(browser, baseUrl);
    await assertPendingMicrophoneRequestGuards(browser, baseUrl);
    await assertMicrophoneErrorRecovery(browser, baseUrl);
    await assertAssessmentFailureFeedback(browser, baseUrl);
    await assertZeroScoreAssessmentPayloadShowsFailure(browser, baseUrl);
    await assertDirectAccuracyPayloadShowsScoredResult(browser, baseUrl);
    await assertUnsupportedWithoutWebAudio(browser, baseUrl);
    await assertSpeechCoachAccordionAndEdgeCases(browser, baseUrl);
    console.log('read-aloud mode regression test passed');
  } catch (error) {
    const tail = serverLogs.slice(-10000);
    if (tail) {
      console.error('SERVER_LOG_TAIL_START');
      console.error(tail);
      console.error('SERVER_LOG_TAIL_END');
    }
    throw error;
  } finally {
    try {
      if (browser) await browser.close();
    } catch (_) {
      // Best effort cleanup.
    }
    try {
      server.kill();
    } catch (_) {
      // Best effort cleanup.
    }
  }
}

run().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
