/* eslint-disable no-console */
const assert = require('assert');
const http = require('http');
const { chromium } = require('playwright');
const { createApp } = require('../../src/server/app');

function makeWavBuffer() {
  const dataSize = 32000;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(16000, 24);
  buffer.writeUInt32LE(32000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

async function runLiveIntegrationTest() {
  console.log('Starting live server for Dual Arena end-to-end integration test...');
  const app = createApp();
  const server = http.createServer(app);

  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`Live server listening on ${baseUrl}`);

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1400, height: 900 }
    });

    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    const apiRequests = [];
    page.on('response', (res) => {
      const url = res.url();
      if (url.includes('/api/pronunciation-assessment/')) {
        apiRequests.push({ url, status: res.status() });
      }
    });

    // 1. Navigate to standalone visual comparison runner
    console.log('Navigating to pronunciation-visual-comparison.html...');
    await page.goto(`${baseUrl}/pronunciation-visual-comparison.html`, {
      waitUntil: 'networkidle'
    });

    // 2. Confirm Dual Arena root is mounted and unboxed
    const arenaRoot = page.locator('.dual-arena-root');
    await arenaRoot.waitFor({ state: 'visible', timeout: 5000 });
    console.log('Dual Arena root is visible.');

    // 3. Check that header has zero emojis and high contrast text
    const titleText = await page.textContent('.dual-arena-title');
    assert.match(titleText, /Option A vs\. Option B Comparison/i);
    const emojiRegex = /\p{Extended_Pictographic}/u;
    assert.strictEqual(emojiRegex.test(titleText), false, 'Title must have zero emojis');

    // 4. Upload audio sample
    const wavBuffer = makeWavBuffer();
    const fileInput = page.locator('#dual-arena-file-input');
    await fileInput.setInputFiles({
      name: 'sample_audio.wav',
      mimeType: 'audio/wav',
      buffer: wavBuffer
    });

    // 5. Wait for waveform canvas and Run button
    const runBtn = page.locator('#dual-arena-btn-run');
    await page.waitForFunction(() => {
      const btn = document.getElementById('dual-arena-btn-run');
      return btn && !btn.disabled;
    });
    console.log('Audio loaded, Run Dual Analysis button enabled.');

    // 6. Click Run Dual Analysis against REAL LIVE server endpoints (NOT mocked!)
    console.log('Triggering Run Dual Analysis against live server endpoints...');
    await runBtn.click();

    // 7. Wait for analysis to complete and both cards to show Complete
    await page.waitForSelector('#option-a-status.status-success', { timeout: 15000 });
    await page.waitForSelector('#option-b-status.status-success', { timeout: 15000 });
    console.log('Both Option A and Option B analysis completed successfully with status Complete.');

    // 8. Verify live API responses were HTTP 200
    const reqA = apiRequests.find(r => r.url.includes('/option-a'));
    const reqB = apiRequests.find(r => r.url.includes('/option-b'));
    assert.ok(reqA, 'Option A API request must be sent');
    assert.strictEqual(reqA.status, 200, 'Option A must return HTTP 200');
    assert.ok(reqB, 'Option B API request must be sent');
    assert.strictEqual(reqB.status, 200, 'Option B must return HTTP 200');
    console.log('Verified: Both POST /option-a and /option-b returned HTTP 200 on live server.');

    // 9. Verify rendered metrics in DOM
    const optionASyllables = await page.locator('#option-a-body .dual-syl-row').count();
    const optionBSyllables = await page.locator('#option-b-body .dual-syl-row').count();
    assert.ok(optionASyllables >= 1, 'Option A must render syllables');
    assert.ok(optionBSyllables >= 1, 'Option B must render syllables');

    // Verify Metric Badges
    const durBadges = await page.locator('.metric-label:has-text("DUR")').count();
    const f0Badges = await page.locator('.metric-label:has-text("F0")').count();
    const intBadges = await page.locator('.metric-label:has-text("INT")').count();
    assert.ok(durBadges >= 2, 'DUR labels must be present on both cards');
    assert.ok(f0Badges >= 2, 'F0 labels must be present on both cards');
    assert.ok(intBadges >= 2, 'INT labels must be present on both cards');

    // 10. Verify Zero Emojis in the entire rendered arena DOM
    const bodyText = await page.textContent('.dual-arena-root');
    const hasEmoji = emojiRegex.test(bodyText);
    assert.strictEqual(hasEmoji, false, `Rendered DOM contains emoji: ${bodyText.match(emojiRegex)?.[0]}`);
    console.log('Verified: Rendered Dual Arena contains ZERO emojis.');

    // 11. Test Benchmark Rating Submission
    const ratingBtnA = page.locator('.rating-btn[data-winner="option-a"]');
    await ratingBtnA.click();
    assert.strictEqual(await ratingBtnA.evaluate(el => el.classList.contains('is-selected')), true);

    const notesInput = page.locator('#dual-arena-notes');
    await notesInput.fill('Live integration test rating - Option A detected stress accurately');

    const saveRatingBtn = page.locator('#dual-arena-btn-save-rating');
    assert.strictEqual(await saveRatingBtn.isEnabled(), true);
    await saveRatingBtn.click();

    const counterText = await page.textContent('#benchmark-counter');
    assert.match(counterText, /1 Comparisons Saved/i);
    console.log('Verified: Benchmark rating saved successfully.');

    // 12. Verify high-contrast color styles in CSS
    const cardTitleColor = await page.locator('.card-title').first().evaluate((el) => {
      return window.getComputedStyle(el).color;
    });
    // RGB for #ffffff is rgb(255, 255, 255)
    assert.strictEqual(cardTitleColor, 'rgb(255, 255, 255)', 'Card titles must be crisp white');

    assert.strictEqual(pageErrors.length, 0, `Page errors encountered: ${pageErrors.join(', ')}`);
    console.log('ALL LIVE SERVER DUAL ARENA CHECKS PASSED PERFECTLY!');
  } finally {
    await browser.close();
    server.close();
  }
}

runLiveIntegrationTest().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
