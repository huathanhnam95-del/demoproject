/* eslint-disable no-console */
const assert = require('assert');
const express = require('express');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

function buildHarnessHtml() {
  return `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Pronunciation Test Browser Harness</title>
    </head>
    <body>
      <div id="segmental-screening-root"></div>
      <script type="module" src="/pronunciation-test/test-mode.js"></script>
    </body>
  </html>`;
}

function startHarnessServer() {
  const app = express();
  const publicDir = path.join(__dirname, '..', '..', 'public');

  app.use(express.static(publicDir));
  app.get('/pronunciation-test-test', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.type('html').send(buildHarnessHtml());
  });

  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        server,
        origin: `http://127.0.0.1:${address.port}`
      });
    });
  });
}

async function recordCurrentItem(page) {
  await page.click('[data-action="record-toggle"]');
  await page.waitForTimeout(30);
  await page.click('[data-action="record-toggle"]');
}

function extractMultipartField(postData, fieldName) {
  const pattern = new RegExp(`name="${fieldName}"\\r\\n\\r\\n([^\\r]+)`);
  const match = String(postData || '').match(pattern);
  return match ? match[1] : null;
}

function buildAssessSuccess(itemId, overrides = {}) {
  return {
    success: true,
    provisional: true,
    itemId,
    contrastId: overrides.contrastId || 'placeholder',
    usable: true,
    assessmentStatus: 'ok',
    unusableReason: null,
    word: overrides.word || itemId,
    targetPhoneme: overrides.targetPhoneme || 't',
    contrastPartnerPhoneme: overrides.contrastPartnerPhoneme ?? null,
    targetPosition: overrides.targetPosition || 'initial',
    referencePhonemeIndex: overrides.referencePhonemeIndex ?? 0,
    wordAccuracyScore: overrides.wordAccuracyScore ?? 82,
    targetPhonemeAccuracyScore: overrides.targetPhonemeAccuracyScore ?? 82,
    provisionalBand: overrides.provisionalBand || 'clear',
    mostLikelySpokenPhoneme: overrides.mostLikelySpokenPhoneme || overrides.targetPhoneme || 't',
    pairedContrastDetected: overrides.pairedContrastDetected ?? false,
    spokenPhonemeCandidates: overrides.spokenPhonemeCandidates || [
      { phoneme: overrides.mostLikelySpokenPhoneme || overrides.targetPhoneme || 't', score: overrides.targetPhonemeAccuracyScore ?? 82 }
    ],
    wordErrorType: overrides.wordErrorType || 'Mispronunciation',
    extractionMode: overrides.extractionMode || 'reference_index',
    feedbackCode: overrides.feedbackCode || 'target_clear',
    audioQuality: {
      passed: true,
      speechDurationMs: overrides.speechDurationMs ?? 720,
      clipped: false
    },
    azureRecognizedText: overrides.azureRecognizedText || overrides.word || itemId,
    rawPhonemes: []
  };
}

function buildAssessUnusable(itemId, overrides = {}) {
  return {
    success: true,
    provisional: true,
    itemId,
    contrastId: overrides.contrastId || 'placeholder',
    usable: false,
    assessmentStatus: 'unusable',
    unusableReason: overrides.unusableReason || 'phoneme_alignment_ambiguous',
    word: overrides.word || itemId,
    targetPhoneme: overrides.targetPhoneme || 't',
    contrastPartnerPhoneme: overrides.contrastPartnerPhoneme ?? null,
    targetPosition: overrides.targetPosition || 'initial',
    referencePhonemeIndex: overrides.referencePhonemeIndex ?? 0,
    wordAccuracyScore: overrides.wordAccuracyScore ?? 0,
    targetPhonemeAccuracyScore: null,
    provisionalBand: null,
    mostLikelySpokenPhoneme: null,
    pairedContrastDetected: false,
    spokenPhonemeCandidates: [],
    wordErrorType: overrides.wordErrorType || 'Mispronunciation',
    extractionMode: 'unusable',
    feedbackCode: 'audio_retry_needed',
    audioQuality: {
      passed: true,
      speechDurationMs: overrides.speechDurationMs ?? 710,
      clipped: false
    },
    azureRecognizedText: overrides.azureRecognizedText || overrides.word || itemId,
    rawPhonemes: []
  };
}

(async () => {
  const { server, origin } = await startHarnessServer();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 960 }
  });

  const consoleErrors = [];
  let assessCallCount = 0;
  let vowelHintCallCount = 0;
  const assessedItemIds = [];

  await page.addInitScript(() => {
    function buildRecordedBlob() {
      const sampleRate = 16000;
      const durationMs = 420;
      const sampleCount = Math.round((sampleRate * durationMs) / 1000);
      const wav = new ArrayBuffer(44 + (sampleCount * 2));
      const view = new DataView(wav);
      const writeString = (offset, value) => {
        for (let index = 0; index < value.length; index += 1) {
          view.setUint8(offset + index, value.charCodeAt(index));
        }
      };

      writeString(0, 'RIFF');
      view.setUint32(4, 36 + (sampleCount * 2), true);
      writeString(8, 'WAVE');
      writeString(12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      writeString(36, 'data');
      view.setUint32(40, sampleCount * 2, true);

      for (let index = 0; index < sampleCount; index += 1) {
        const sample = Math.sin((2 * Math.PI * 220 * index) / sampleRate) * 0.2;
        view.setInt16(44 + (index * 2), Math.round(sample * 32767), true);
      }

      return new Blob([wav], { type: 'audio/webm' });
    }

    window.__PRON_TEST_TEST_HOOKS__ = {
      async getMockAudioBlob() {
        return buildRecordedBlob();
      }
    };
  });

  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });

  const assessResponses = [
    buildAssessSuccess('practice-tea-001', {
      contrastId: 'practice_control',
      word: 'tea',
      targetPhoneme: 't'
    }),
    buildAssessSuccess('core-sheep-001', {
      contrastId: 'vowel_i_ih',
      word: 'sheep',
      targetPhoneme: 'i',
      contrastPartnerPhoneme: '\u026a',
      targetPhonemeAccuracyScore: 68,
      provisionalBand: 'close',
      feedbackCode: 'target_present_inconsistent'
    }),
    buildAssessSuccess('core-sheep-001', {
      contrastId: 'vowel_i_ih',
      word: 'sheep',
      targetPhoneme: 'i',
      contrastPartnerPhoneme: '\u026a',
      targetPhonemeAccuracyScore: 62,
      provisionalBand: 'close',
      feedbackCode: 'target_present_inconsistent'
    }),
    { error: true, status: 400, body: { success: false, error: 'INVALID_AUDIO', message: 'Audio did not pass quality checks.', details: { reason: 'too_short' } } },
    buildAssessUnusable('core-thin-001', {
      contrastId: 'theta_t',
      word: 'thin',
      targetPhoneme: '\u03b8',
      contrastPartnerPhoneme: 't'
    }),
    buildAssessSuccess('core-pen-001', {
      contrastId: 'vowel_e_ae',
      word: 'pen',
      targetPhoneme: '\u025b',
      contrastPartnerPhoneme: '\u00e6',
      targetPhonemeAccuracyScore: 74,
      provisionalBand: 'close',
      feedbackCode: 'target_present_inconsistent'
    }),
    buildAssessSuccess('core-shoe-001', {
      contrastId: 'sh_ch',
      word: 'shoe',
      targetPhoneme: '\u0283',
      contrastPartnerPhoneme: 't\u0283'
    }),
    {
      ...buildAssessSuccess('core-cat-001', {
        contrastId: 'final_retention',
        word: 'cat',
        targetPhoneme: 't',
        targetPosition: 'final',
        targetPhonemeAccuracyScore: 0,
        provisionalBand: 'needs_review',
        mostLikelySpokenPhoneme: null,
        spokenPhonemeCandidates: [],
        feedbackCode: 'final_target_omitted'
      }),
      assessmentStatus: 'target_omitted'
    },
    buildAssessSuccess('core-then-001', {
      contrastId: 'eth_d',
      word: 'then',
      targetPhoneme: '\u00f0',
      contrastPartnerPhoneme: 'd'
    }),
    buildAssessSuccess('core-ship-001', {
      contrastId: 'vowel_i_ih',
      word: 'ship',
      targetPhoneme: '\u026a',
      contrastPartnerPhoneme: 'i',
      targetPhonemeAccuracyScore: 55,
      provisionalBand: 'needs_review',
      feedbackCode: 'target_present_inconsistent'
    }),
    buildAssessSuccess('core-tin-001', {
      contrastId: 'theta_t',
      word: 'tin',
      targetPhoneme: 't',
      contrastPartnerPhoneme: '\u03b8'
    }),
    buildAssessSuccess('core-pan-001', {
      contrastId: 'vowel_e_ae',
      word: 'pan',
      targetPhoneme: '\u00e6',
      contrastPartnerPhoneme: '\u025b'
    }),
    buildAssessSuccess('core-chew-001', {
      contrastId: 'sh_ch',
      word: 'chew',
      targetPhoneme: 't\u0283',
      contrastPartnerPhoneme: '\u0283'
    }),
    buildAssessSuccess('core-bed-001', {
      contrastId: 'final_retention',
      word: 'bed',
      targetPhoneme: 'd',
      targetPosition: 'final',
      targetPhonemeAccuracyScore: 84,
      mostLikelySpokenPhoneme: 'd'
    }),
    buildAssessSuccess('core-den-001', {
      contrastId: 'eth_d',
      word: 'den',
      targetPhoneme: 'd',
      contrastPartnerPhoneme: '\u00f0'
    }),
    buildAssessSuccess('followup-seat-001', {
      contrastId: 'vowel_i_ih',
      word: 'seat',
      targetPhoneme: 'i',
      contrastPartnerPhoneme: '\u026a'
    }),
    buildAssessSuccess('followup-sit-001', {
      contrastId: 'vowel_i_ih',
      word: 'sit',
      targetPhoneme: '\u026a',
      contrastPartnerPhoneme: 'i'
    }),
    buildAssessSuccess('followup-ice-001', {
      contrastId: 'final_retention',
      word: 'ice',
      targetPhoneme: 's',
      targetPosition: 'final'
    }),
    buildAssessSuccess('followup-nose-001', {
      contrastId: 'final_retention',
      word: 'nose',
      targetPhoneme: 'z',
      targetPosition: 'final'
    })
  ];

  await page.route('**/api/pronunciation-test/assess', async (route) => {
    assessedItemIds.push(extractMultipartField(route.request().postData(), 'itemId'));
    const payload = assessResponses[assessCallCount];
    assessCallCount += 1;

    if (!payload) {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: 'TEST_FAILURE', message: 'Missing mock response.' })
      });
      return;
    }

    if (payload.error) {
      await route.fulfill({
        status: payload.status,
        contentType: 'application/json',
        body: JSON.stringify(payload.body)
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(payload)
    });
  });

  await page.route('**/api/pronunciation-test/vowel-hint', async (route) => {
    vowelHintCallCount += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        exploratory: true,
        usable: true,
        reason: null,
        samples: [
          { pct: 35, f1: 410.2, f2: 1964.1 },
          { pct: 50, f1: 398.4, f2: 2010.5 },
          { pct: 65, f1: 389.8, f2: 2051.7 }
        ],
        nucleusStart: 0.11,
        nucleusEnd: 0.23,
        midPitch: 178.3
      })
    });
  });

  try {
    await page.goto(`${origin}/pronunciation-test-test`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('text=tea');
    assert.strictEqual(await page.textContent('.pst-title'), 'Single-word screening for segmental contrasts');

    await recordCurrentItem(page);
    await page.waitForSelector('text=The target sound was clear in this recording.');
    await page.click('[data-action="advance"]');

    await page.waitForSelector('text=sheep');
    assert.strictEqual(await page.textContent('.pst-status-note'), 'Scored item');
    await recordCurrentItem(page);
    await page.waitForSelector('text=Exploratory acoustic hint only. This chart does not affect your score.');
    assert.strictEqual(vowelHintCallCount > 0, true, 'Expected a vowel hint request for a vowel item.');
    await page.click('[data-action="retry"]');
    await recordCurrentItem(page);
    await page.waitForSelector('text=The target sound was present, but the production was inconsistent.');
    await page.waitForFunction(() => document.querySelector('[data-action="retry"]').disabled === true);
    await page.click('[data-action="advance"]');

    await page.waitForSelector('text=thin');
    await recordCurrentItem(page);
    await page.waitForSelector('text=Reason: too_short.');
    await page.waitForFunction(() => document.querySelector('[data-action="retry"]').disabled === false);
    assert.strictEqual((await page.locator('.pst-hint-card').count()), 0, 'Consonant items must not render a vowel hint.');
    await page.click('[data-action="retry"]');
    await recordCurrentItem(page);
    await page.waitForSelector('text=The recording could not be scored reliably. Try again.');
    await page.waitForFunction(() => document.querySelector('[data-action="advance"]').textContent.includes('Skip Item'));
    await page.click('[data-action="advance"]');

    while ((await page.locator('[data-action="advance"]').count()) > 0) {
      const nextDisabled = await page.locator('[data-action="advance"]').isDisabled().catch(() => true);
      if (!nextDisabled) {
        await page.click('[data-action="advance"]');
        await page.waitForTimeout(30);
        continue;
      }

      if (await page.locator('text=Screen complete').count()) break;

      await recordCurrentItem(page);
      await page.waitForTimeout(60);
    }

    await page.waitForSelector('text=Screen complete');
    const summaryCards = await page.locator('.pst-summary-card').count();
    assert.strictEqual(summaryCards, 6, 'Expected six contrast summary cards.');
    assert.deepStrictEqual(assessedItemIds, [
      'practice-tea-001',
      'core-sheep-001',
      'core-sheep-001',
      'core-thin-001',
      'core-thin-001',
      'core-pen-001',
      'core-shoe-001',
      'core-cat-001',
      'core-then-001',
      'core-ship-001',
      'core-tin-001',
      'core-pan-001',
      'core-chew-001',
      'core-bed-001',
      'core-den-001',
      'followup-ice-001',
      'followup-nose-001',
      'followup-seat-001',
      'followup-sit-001'
    ], 'Expected the exact core and adaptive assessment sequence.');
    assert.strictEqual(assessCallCount, 19, 'Expected all mocked assessment calls to be consumed.');

    const html = await page.content();
    assert.ok(!html.includes('\u00c3\u00a2'), 'Page should not contain mojibake markers.');
    const unexpectedConsoleErrors = consoleErrors.filter((entry) => !entry.includes('status of 400'));
    assert.strictEqual(unexpectedConsoleErrors.length, 0, `Expected no unexpected console errors, got: ${unexpectedConsoleErrors.join(' | ')}`);

    console.log('Pronunciation test browser check passed.');
  } finally {
    await browser.close();
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
