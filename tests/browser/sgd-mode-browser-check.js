const assert = require('assert');
const express = require('express');
const http = require('http');
const path = require('path');
const ExcelJS = require('exceljs');
const { chromium } = require('playwright');

async function buildWorkbookBuffer() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('SGD');

  sheet.addRow(['ID', 'TITLE', 'ANSWER', 'NARRATION', 'SPEAKER1_TEXT', 'SPEAKER2_TEXT', 'SPEAKER3_TEXT', 'SPEAKER_COUNT']);
  sheet.addRow([
    2,
    'Essay Planning Discussion',
    'Narration: Three students discuss essay planning.\nSpeaker1: Discussion starts with <img id=sgd-xss-probe src=x onerror=window.__sgdXssExecuted=1> essay focus and topic planning.\nSpeaker2: They suggest understanding the question, drafting, revising, and using campus resources.\nSpeaker3: They mention a brain dump, writing center support, and taking one step at a time.',
    'Three students discuss essay planning.',
    'Discussion starts with <img id=sgd-xss-probe src=x onerror=window.__sgdXssExecuted=1> essay focus and topic planning.',
    'They suggest understanding the question, drafting, revising, and using campus resources.',
    'They mention a brain dump, writing center support, and taking one step at a time.',
    3
  ]);
  sheet.addRow([
    4,
    'Audio Missing Prompt',
    'Narration: Three students discuss an audio-free backup prompt.\nSpeaker1: One student outlines the issue.\nSpeaker2: Another student offers a response.\nSpeaker3: A third student wraps up the discussion.',
    'Three students discuss an audio-free backup prompt.',
    'One student outlines the issue.',
    'Another student offers a response.',
    'A third student wraps up the discussion.',
    3
  ]);
  sheet.addRow([
    6,
    'Parsed Answer Fallback',
    'Narration: Two students compare study routines.\nThe conversation focuses on what works before exams.\nSpeaker1: One student reviews in short sessions\nand uses flashcards every evening.\nSpeaker2: The other prefers practice tests\nand explains mistakes out loud afterward.',
    '',
    '',
    '',
    '',
    2
  ]);

  return workbook.xlsx.writeBuffer();
}

async function startHarnessServer() {
  const app = express();
  const publicDir = path.join(__dirname, '..', '..', 'public');
  const audioBody = Buffer.from('ID3');
  const workbookBuffer = Buffer.from(await buildWorkbookBuffer());
  const requestCounts = {
    head: new Map(),
    get: new Map()
  };

  function bumpCount(bucket, filename) {
    bucket.set(filename, (bucket.get(filename) || 0) + 1);
  }

  app.head('/database/SGD/audio/:filename', (req, res) => {
    bumpCount(requestCounts.head, req.params.filename);
    if (req.params.filename === '2.mp3') {
      res.setHeader('Cache-Control', 'no-store');
      res.type('audio/mpeg');
      res.status(200).end();
      return;
    }
    if (req.params.filename === '6.mp3') {
      res.setHeader('Cache-Control', 'no-store');
      res.status(405).end();
      return;
    }
    res.status(404).end();
  });

  app.get('/database/SGD/audio/:filename', (req, res) => {
    bumpCount(requestCounts.get, req.params.filename);
    if (req.params.filename === '2.mp3' || req.params.filename === '6.mp3') {
      res.setHeader('Cache-Control', 'no-store');
      res.type('audio/mpeg');
      res.status(200).send(audioBody);
      return;
    }
    res.status(404).end();
  });

  app.get('/database/SGD/SGD/SGD.xlsx', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.status(200).send(workbookBuffer);
  });

  app.use(express.static(publicDir));
  app.get('/', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        server,
        origin: `http://127.0.0.1:${address.port}`,
        requestCounts
      });
    });
  });
}

async function dismissBlockingOverlays(page) {
  await page.waitForFunction(() => {
    const preloader = document.getElementById('app-preloader');
    if (!preloader) return true;
    const display = getComputedStyle(preloader).display;
    const dismiss = document.getElementById('preloader-dismiss-btn');
    return display === 'none' || Boolean(dismiss);
  }, { timeout: 15000 });

  const dismissButton = page.locator('#preloader-dismiss-btn');
  if (await dismissButton.count()) {
    try {
      await dismissButton.click({ timeout: 3000 });
    } catch (_) {
      // ignore
    }
  }

  await page.waitForFunction(() => {
    const preloader = document.getElementById('app-preloader');
    return !preloader || getComputedStyle(preloader).display === 'none';
  }, { timeout: 15000 });

  const guestButton = page.locator('#guest-mode-btn');
  if (await guestButton.isVisible().catch(() => false)) {
    await guestButton.click();
  }

  await page.waitForFunction(() => {
    const entryModal = document.getElementById('entry-modal');
    const wrapper = document.getElementById('page-layout-wrapper');
    const modalHidden = !entryModal || getComputedStyle(entryModal).display === 'none';
    const wrapperVisible = !!wrapper && getComputedStyle(wrapper).display !== 'none';
    return modalHidden && wrapperVisible;
  }, { timeout: 15000 });
}

async function waitForActivePanel(page, panelId) {
  await page.waitForFunction((expectedPanelId) => {
    const panel = document.getElementById(expectedPanelId);
    return !!panel && panel.classList.contains('active') && getComputedStyle(panel).display !== 'none';
  }, panelId, { timeout: 15000 });
}

(async () => {
  const { server, origin, requestCounts } = await startHarnessServer();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];

  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.addInitScript(() => {
    [
      'type',
      'collo-dictate',
      'speak',
      'extended',
      'watch',
      'notes',
      'pronounce',
      'read-aloud',
      'rfib',
      'sgd'
    ].forEach((mode) => {
      localStorage.setItem(`${mode}ModeFirstUse`, 'true');
    });

    localStorage.removeItem('practiceScope');
    window.alert = () => { };

    if (!navigator.mediaDevices) {
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: {}
      });
    }

    navigator.mediaDevices.getUserMedia = async () => ({
      getTracks() {
        return [{ stop() { } }];
      }
    });

    class FakeMediaRecorder extends EventTarget {
      constructor(stream) {
        super();
        this.stream = stream;
        this.state = 'inactive';
        this.mimeType = 'audio/webm';
      }

      start() {
        this.state = 'recording';
      }

      stop() {
        if (this.state !== 'recording') return;
        this.state = 'inactive';
        const blob = new Blob(['fake-audio'], { type: this.mimeType });
        const dataEvent = new Event('dataavailable');
        Object.defineProperty(dataEvent, 'data', { configurable: true, value: blob });
        this.dispatchEvent(dataEvent);
        this.dispatchEvent(new Event('stop'));
      }
    }

    window.MediaRecorder = FakeMediaRecorder;
  });

  try {
    await page.goto(`${origin}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.switchToMode === 'function', { timeout: 30000 });
    await dismissBlockingOverlays(page);

    assert.deepStrictEqual(pageErrors, [], `Unexpected JS runtime errors: ${pageErrors.join(' | ')}`);
    const noisePattern = /favicon\.ico|net::ERR_|Failed to fetch|firebase|googleapis|identitytoolkit|database|WebSocket|ERR_NAME|400|responded with a status/i;
    const realConsoleErrors = consoleErrors.filter((entry) => !noisePattern.test(entry));
    assert.deepStrictEqual(realConsoleErrors, [], `Unexpected console errors (after noise filter): ${realConsoleErrors.join(' | ')}`);

    await page.evaluate(async () => {
      await window.switchToMode('sgd');
    });
    await waitForActivePanel(page, 'mode-sgd');
    await page.waitForFunction(() => {
      const select = document.getElementById('question-select-sgd');
      return !!select && Array.from(select.options).some((option) => !/loading/i.test(option.textContent || ''));
    }, { timeout: 15000 });

    await page.click('#play-sgd-btn');
    await page.waitForFunction(() => {
      const step = document.getElementById('sgd-step-listen');
      return !!step && getComputedStyle(step).display !== 'none';
    }, { timeout: 15000 });

    await page.evaluate(async () => {
      await window.switchToMode('speak');
    });
    await waitForActivePanel(page, 'mode-speak');
    await page.keyboard.down('Alt');
    await page.keyboard.press('2');
    await page.keyboard.up('Alt');

    const cleanupState = await page.evaluate(() => {
      const practiceArea = document.getElementById('sgd-practice-area');
      const listenStep = document.getElementById('sgd-step-listen');
      const speakerTabs = document.getElementById('sgd-speaker-tabs');
      return {
        practiceHidden: !practiceArea || getComputedStyle(practiceArea).display === 'none',
        listenHidden: !listenStep || getComputedStyle(listenStep).display === 'none',
        speakerTabCount: speakerTabs ? speakerTabs.children.length : 0,
        activeSpeaker: speakerTabs?.querySelector('.sgd-speaker-tab.active')?.getAttribute('data-speaker') || null
      };
    });

    assert.strictEqual(cleanupState.practiceHidden, true, 'switching away from SGD should hide the SGD practice area');
    assert.strictEqual(cleanupState.listenHidden, true, 'switching away from SGD should hide the listen step');
    assert.strictEqual(cleanupState.speakerTabCount, 0, 'switching away from SGD should clear speaker tabs');
    assert.strictEqual(cleanupState.activeSpeaker, null, 'hidden SGD shortcuts should not change speaker state');

    await page.evaluate(async () => {
      await window.switchToMode('sgd');
      window.SGDMode?.reset?.();
    });
    await waitForActivePanel(page, 'mode-sgd');

    await page.selectOption('#question-select-sgd', '1');
    await page.click('#play-sgd-btn');
    await page.waitForFunction(() => {
      const status = document.getElementById('sgd-audio-status');
      return !!status && /audio not available/i.test(status.textContent || '');
    }, { timeout: 15000 });

    const missingAudioState = await page.evaluate(() => ({
      audioStatus: document.getElementById('sgd-audio-status')?.textContent?.trim() || '',
      nextDisabled: Boolean(document.getElementById('sgd-next-step-btn')?.disabled),
      audioSrc: document.getElementById('sgd-audio')?.getAttribute('src') || ''
    }));

    assert.match(missingAudioState.audioStatus, /audio not available/i, 'missing audio should show a visible status');
    assert.strictEqual(missingAudioState.nextDisabled, true, 'missing audio should disable the proceed button');
    assert.strictEqual(missingAudioState.audioSrc, '', 'missing audio should clear the audio source');

    const missingProbeBaseline = {
      m4a: requestCounts.head.get('4.m4a') || 0,
      wav: requestCounts.head.get('4.wav') || 0,
      mp3: requestCounts.head.get('4.mp3') || 0,
      aac: requestCounts.head.get('4.aac') || 0,
      ogg: requestCounts.head.get('4.ogg') || 0
    };

    await page.evaluate(() => {
      window.SGDMode?.reset?.();
    });
    await page.click('#play-sgd-btn');
    await page.waitForFunction(() => {
      const status = document.getElementById('sgd-audio-status');
      return !!status && /audio not available/i.test(status.textContent || '');
    }, { timeout: 15000 });

    assert.deepStrictEqual({
      m4a: requestCounts.head.get('4.m4a') || 0,
      wav: requestCounts.head.get('4.wav') || 0,
      mp3: requestCounts.head.get('4.mp3') || 0,
      aac: requestCounts.head.get('4.aac') || 0,
      ogg: requestCounts.head.get('4.ogg') || 0
    }, missingProbeBaseline, 'replaying the same missing-audio SGD prompt should not re-probe every extension');

    await page.selectOption('#question-select-sgd', '2');
    await page.click('#play-sgd-btn');
    await page.waitForFunction(() => {
      const inputs = document.querySelectorAll('#sgd-note-panels .sgd-note-input');
      const audio = document.getElementById('sgd-audio');
      const src = audio?.getAttribute('src') || '';
      return inputs.length >= 2 && src.includes('database/SGD/audio/6.mp3');
    }, { timeout: 15000 });

    const parsedFallbackState = await page.evaluate(() => ({
      topicText: document.getElementById('sgd-topic')?.textContent || '',
      speakerLabels: Array.from(document.querySelectorAll('#sgd-note-panels .sgd-note-label')).map((el) => el.textContent || ''),
      speakerInputCount: document.querySelectorAll('#sgd-note-panels .sgd-note-input').length,
      audioSrc: document.getElementById('sgd-audio')?.getAttribute('src') || '',
      nextDisabled: Boolean(document.getElementById('sgd-next-step-btn')?.disabled)
    }));

    assert.match(parsedFallbackState.topicText, /Two students compare study routines/i, 'SGD should keep narration parsed from the ANSWER transcript when narration column is blank');
    assert.strictEqual(parsedFallbackState.speakerInputCount, 3, 'SGD should build note inputs from parsed speaker content (2 speakers + 1 topic) when speaker columns are blank');
    assert.match(parsedFallbackState.speakerLabels[1] || '', /Speaker 1/i, 'SGD should render Speaker 1 from parsed ANSWER content');
    assert.match(parsedFallbackState.speakerLabels[2] || '', /Speaker 2/i, 'SGD should render Speaker 2 from parsed ANSWER content');
    assert.match(parsedFallbackState.audioSrc, /database\/SGD\/audio\/6\.mp3$/, 'SGD should fall back to a GET-capable audio URL when HEAD probing is rejected');
    assert.strictEqual(parsedFallbackState.nextDisabled, false, 'SGD should enable proceed when audio is reachable through GET fallback');

    await page.selectOption('#question-select-sgd', '0');
    await page.click('#play-sgd-btn');
    await page.waitForFunction(() => {
      const audio = document.getElementById('sgd-audio');
      const status = document.getElementById('sgd-audio-status');
      const src = audio?.getAttribute('src') || '';
      return src.includes('database/SGD/audio/2.mp3') && !!status;
    }, { timeout: 15000 });

    const audioReadyState = await page.evaluate(() => ({
      audioStatus: document.getElementById('sgd-audio-status')?.textContent?.trim() || '',
      nextDisabled: Boolean(document.getElementById('sgd-next-step-btn')?.disabled),
      audioSrc: document.getElementById('sgd-audio')?.getAttribute('src') || ''
    }));

    assert.strictEqual(audioReadyState.audioStatus, '', 'available audio should clear the audio status');
    assert.strictEqual(audioReadyState.nextDisabled, false, 'available audio should enable the proceed button');
    assert.match(audioReadyState.audioSrc, /database\/SGD\/audio\/2\.mp3$/, 'available audio should resolve the mp3 source');

    const availableProbeBaseline = {
      m4a: requestCounts.head.get('2.m4a') || 0,
      wav: requestCounts.head.get('2.wav') || 0,
      mp3: requestCounts.head.get('2.mp3') || 0
    };

    await page.evaluate(() => {
      window.SGDMode?.reset?.();
    });
    await page.click('#play-sgd-btn');
    await page.waitForFunction(() => {
      const audio = document.getElementById('sgd-audio');
      const src = audio?.getAttribute('src') || '';
      return src.includes('database/SGD/audio/2.mp3');
    }, { timeout: 15000 });

    assert.deepStrictEqual({
      m4a: requestCounts.head.get('2.m4a') || 0,
      wav: requestCounts.head.get('2.wav') || 0,
      mp3: requestCounts.head.get('2.mp3') || 0
    }, availableProbeBaseline, 'replaying the same available-audio SGD prompt should reuse the resolved audio path');

    await page.evaluate(() => {
      const noteInputs = Array.from(document.querySelectorAll('#sgd-note-panels .sgd-note-input'));
      // Index 0 is "Topic"
      if (noteInputs[0]) noteInputs[0].value = 'Essay Planning';
      // Index 1 is "Speaker 1"
      if (noteInputs[1]) noteInputs[1].value = 'essay focus and topic planning';
      // Index 2 is "Speaker 2"
      if (noteInputs[2]) noteInputs[2].value = 'understanding the question drafting revising campus resources';
      // Index 3 is "Speaker 3"
      if (noteInputs[3]) noteInputs[3].value = 'brain dump writing center one step at a time';
    });

    await page.click('#sgd-next-step-btn');
    await page.waitForFunction(() => {
      const step = document.getElementById('sgd-step-record');
      return !!step && getComputedStyle(step).display !== 'none';
    }, { timeout: 15000 });

    await page.click('#sgd-record-btn');
    await page.click('#sgd-stop-btn');
    await page.waitForFunction(() => {
      const submit = document.getElementById('sgd-submit-btn');
      const playback = document.getElementById('sgd-playback-area');
      return !!submit && getComputedStyle(submit).display !== 'none' &&
        !!playback && getComputedStyle(playback).display !== 'none';
    }, { timeout: 15000 });

    await page.click('#sgd-submit-btn');
    await page.waitForFunction(() => {
      const step = document.getElementById('sgd-step-results');
      const matches = document.querySelectorAll('#sgd-results-container .sgd-matched').length;
      const overall = Number.parseInt(document.getElementById('sgd-overall-accuracy')?.textContent || '0', 10);
      return !!step && getComputedStyle(step).display !== 'none' && matches > 0 && overall > 0;
    }, { timeout: 15000 });

    const resultsState = await page.evaluate(() => ({
      overallAccuracy: Number.parseInt(document.getElementById('sgd-overall-accuracy')?.textContent || '0', 10),
      matchedCount: document.querySelectorAll('#sgd-results-container .sgd-matched').length,
      speakerResultCount: document.querySelectorAll('#sgd-results-container .sgd-speaker-result').length,
      xssProbePresent: Boolean(document.getElementById('sgd-xss-probe')),
      xssExecuted: Boolean(window.__sgdXssExecuted),
      resultsText: document.getElementById('sgd-results-container')?.textContent || ''
    }));

    assert.ok(resultsState.overallAccuracy > 0, 'SGD results should compute an overall accuracy score');
    assert.ok(resultsState.matchedCount > 0, 'SGD results should highlight matched transcript content');
    assert.ok(resultsState.speakerResultCount >= 3, 'SGD results should render per-speaker result cards');
    assert.strictEqual(resultsState.xssProbePresent, false, 'SGD results should not render raw HTML from transcript content');
    assert.strictEqual(resultsState.xssExecuted, false, 'escaped SGD transcript content must not execute scriptable HTML');
    assert.match(resultsState.resultsText, /sgd-xss-probe/, 'escaped SGD transcript content should remain visible as text');

    await page.screenshot({ path: 'tmp/sgd-mode-browser-check.png', fullPage: true });
    console.log('SGD mode browser verification complete.');
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
