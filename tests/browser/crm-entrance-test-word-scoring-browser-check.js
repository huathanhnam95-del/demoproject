const assert = require('assert');
const express = require('express');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');
const { db } = require('../../src/utils/firebase');
const { buildPublicSession } = require('../../functions/src/entrance-test/test36plus');

const TEST_ID = 'b0ee5b86c13c42e4d2fd005552f28faf76ed7d4bfc32914d426181f5672ca267';

function buildFirebaseStubScript() {
  return `(function () {
    const firebase = window.firebase || (window.firebase = {});
    const currentUser = {
      email: 'admin@example.com',
      getIdToken: async () => 'fake-admin-token'
    };
    const authState = {
      currentUser,
      setPersistence: async () => {},
      onAuthStateChanged(callback) {
        callback(currentUser);
        return () => {};
      }
    };

    firebase.apps = firebase.apps || [];
    firebase.initializeApp = firebase.initializeApp || function initializeApp(config) {
      firebase.apps.push(config);
      return firebase;
    };
    firebase.auth = firebase.auth || function auth() {
      return authState;
    };
    firebase.auth.Auth = firebase.auth.Auth || { Persistence: { LOCAL: 'LOCAL' } };
    firebase.firestore = firebase.firestore || function firestore() {
      return {};
    };
  })();`;
}

async function main() {
  console.log('[Browser Test] Fetching test doc from Firestore for testId:', TEST_ID);
  const snap = await db.collection('entranceTests').doc(TEST_ID).get();
  if (!snap.exists) {
    throw new Error(`Test ${TEST_ID} not found in Firestore.`);
  }
  const testData = snap.data();

  const app = express();
  const publicDir = path.join(__dirname, '..', '..', 'public');
  app.use(express.static(publicDir));

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log('[Browser Test] Harness server running at:', baseUrl);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 960 } });

  // Stub Firebase CDN scripts
  await context.route('**/firebase-app-compat.js*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: buildFirebaseStubScript()
    });
  });

  await context.route('**/firebase-auth-compat.js*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: buildFirebaseStubScript()
    });
  });

  await context.route('**/firebase-firestore-compat.js*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: buildFirebaseStubScript()
    });
  });

  // Mock API endpoints
  await context.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());

    if (url.pathname === '/api/config') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          config: { apiKey: 'fake-api-key', authDomain: 'example.com', projectId: 'example' }
        })
      });
      return;
    }

    if (url.pathname === '/api/admin/status') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, isAdmin: true, email: 'admin@example.com' })
      });
      return;
    }

    if (url.pathname === `/api/admin/entrance-tests/${TEST_ID}`) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          test: {
            id: TEST_ID,
            ...testData
          },
          session: buildPublicSession(TEST_ID),
          lead: { name: 'Test Student', email: 'test@example.com' }
        })
      });
      return;
    }

    if (url.pathname.includes('/speaking/') && url.pathname.endsWith('/audio-url')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, url: 'https://example.com/audio.webm' })
      });
      return;
    }

    await route.continue();
  });

  const page = await context.newPage();

  const pageErrors = [];
  page.on('pageerror', (err) => {
    console.error('[PAGE ERROR]', err);
    pageErrors.push(err);
  });
  page.on('console', (msg) => {
    console.log('[BROWSER]', msg.text());
  });

  const targetUrl = `${baseUrl}/crm-entrance-test-result.html?testId=${TEST_ID}`;
  console.log('[Browser Test] Navigating to:', targetUrl);
  await page.goto(targetUrl, { waitUntil: 'load' });

  // Wait for the speaking questions container to render
  await page.waitForSelector('.crm-result-question', { timeout: 10000 });

  // 1. Verify Q1 "get" token
  console.log('[Browser Test] Verifying Q1 "get" token...');
  const getBtn = await page.locator('.crm-result-question:nth-of-type(1) button.crm-word-token:has-text("get")').first();
  await getBtn.waitFor({ state: 'visible', timeout: 5000 });

  const getBtnClasses = await getBtn.getAttribute('class');
  const getBtnTitle = await getBtn.getAttribute('title');
  const getBtnColor = await getBtn.evaluate((el) => window.getComputedStyle(el).color);

  console.log('  Q1 "get" classes:', getBtnClasses);
  console.log('  Q1 "get" title:', getBtnTitle);
  console.log('  Q1 "get" color:', getBtnColor);

  assert.ok(getBtnClasses.includes('crm-transcript-correct'), 'Q1 "get" must have crm-transcript-correct class');
  assert.ok(!getBtnClasses.includes('crm-transcript-missing'), 'Q1 "get" must NOT be missing');
  assert.ok(getBtnTitle.includes('Accuracy: 97%'), 'Q1 "get" title must display Accuracy: 97%');
  assert.strictEqual(getBtnColor, 'rgb(16, 185, 129)', 'Q1 "get" color must be green rgb(16, 185, 129)');

  // 2. Verify Q2 "accurately" token
  console.log('[Browser Test] Verifying Q2 "accurately" token...');
  const accBtn = await page.locator('.crm-result-question:nth-of-type(2) button.crm-word-token:has-text("accurately")').first();
  await accBtn.waitFor({ state: 'visible', timeout: 5000 });

  const accBtnClasses = await accBtn.getAttribute('class');
  const accBtnTitle = await accBtn.getAttribute('title');
  const accBtnColor = await accBtn.evaluate((el) => window.getComputedStyle(el).color);
  const accBtnTextDeco = await accBtn.evaluate((el) => {
    const s = window.getComputedStyle(el);
    return `${s.textDecorationLine} ${s.textDecorationStyle}`;
  });

  console.log('  Q2 "accurately" classes:', accBtnClasses);
  console.log('  Q2 "accurately" title:', accBtnTitle);
  console.log('  Q2 "accurately" color:', accBtnColor);
  console.log('  Q2 "accurately" text-decoration:', accBtnTextDeco);

  assert.ok(accBtnClasses.includes('crm-transcript-error'), 'Q2 "accurately" must have crm-transcript-error class');
  assert.ok(!accBtnClasses.includes('crm-transcript-correct'), 'Q2 "accurately" must NOT be correct');
  assert.ok(accBtnTitle.includes('Accuracy: 18%'), 'Q2 "accurately" title must display Accuracy: 18%');
  assert.ok(accBtnTitle.includes('[Mispronunciation]'), 'Q2 "accurately" title must display [Mispronunciation]');
  assert.strictEqual(accBtnColor, 'rgb(239, 68, 68)', 'Q2 "accurately" color must be red rgb(239, 68, 68)');
  assert.ok(accBtnTextDeco.includes('underline'), 'Q2 "accurately" must have underline');
  assert.ok(accBtnTextDeco.includes('wavy'), 'Q2 "accurately" must have wavy underline');

  // 3. Test hovering over "accurately" and inspect interactive floating tooltip & syllable chips
  console.log('[Browser Test] Testing hover on "accurately" for floating tooltip & syllable breakdown...');
  await accBtn.hover();
  await page.waitForTimeout(250);

  const tooltipLocator = page.locator('#crm-word-tooltip');
  await tooltipLocator.waitFor({ state: 'visible', timeout: 3000 });

  const tipWord = await tooltipLocator.locator('.crm-tooltip-word').textContent();
  const tipBadge = await tooltipLocator.locator('.crm-tooltip-badge').textContent();
  const tipBadgeClass = await tooltipLocator.locator('.crm-tooltip-badge').getAttribute('class');
  const sylChips = tooltipLocator.locator('.crm-syl-chip');
  const chipCount = await sylChips.count();

  console.log('  Tooltip word:', tipWord);
  console.log('  Tooltip badge:', tipBadge);
  console.log('  Tooltip badge class:', tipBadgeClass);
  console.log('  Tooltip syllable chips count:', chipCount);

  assert.strictEqual(tipWord, 'accurately', 'Tooltip word must be "accurately"');
  assert.strictEqual(tipBadge, '18%', 'Tooltip badge must show 18%');
  assert.ok(tipBadgeClass.includes('syl-red'), 'Tooltip badge for 18% must be syl-red');
  assert.strictEqual(chipCount, 4, '"accurately" must have 4 syllable chips');

  const chip1Text = await sylChips.nth(0).textContent();
  const chip1Class = await sylChips.nth(0).getAttribute('class');
  console.log('  Chip 1:', chip1Text, 'class:', chip1Class);
  assert.ok(chip1Text.includes('ac'), 'Chip 1 must contain "ac"');
  assert.ok(chip1Class.includes('syl-red'), 'Chip 1 must have syl-red');

  // Capture screenshot of the syllable tooltip
  const resultsDir = path.join(__dirname, '..', '..', 'test-results');
  if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });
  const tooltipScreenshotPath = path.join(resultsDir, 'crm-entrance-test-word-tooltip.png');
  await page.screenshot({ path: tooltipScreenshotPath });
  console.log('[Browser Test] Tooltip screenshot captured to:', tooltipScreenshotPath);

  // 3b. Test hovering over Q1 "After" for dual-metric subtitle, amber syllables & diagnostic insight
  console.log('[Browser Test] Testing hover on Q1 "After" for dual-metric subtitle and acoustic diagnosis...');
  const afterBtn = await page.locator('.crm-result-question:nth-of-type(1) button.crm-word-token:has-text("After")').first();
  await afterBtn.hover();
  await page.waitForTimeout(250);

  const afterWord = await tooltipLocator.locator('.crm-tooltip-word').textContent();
  const afterBadge = await tooltipLocator.locator('.crm-tooltip-badge').textContent();
  const afterBadgeClass = await tooltipLocator.locator('.crm-tooltip-badge').getAttribute('class');
  const afterSubtitle = await tooltipLocator.locator('.crm-tooltip-subtitle').textContent();
  const afterChips = tooltipLocator.locator('.crm-syl-chip');
  const afterChipCount = await afterChips.count();

  console.log('  After word:', afterWord);
  console.log('  After badge:', afterBadge);
  console.log('  After badge class:', afterBadgeClass);
  console.log('  After subtitle:', afterSubtitle);
  console.log('  After chips count:', afterChipCount);

  assert.strictEqual(afterWord.toLowerCase(), 'after', 'Tooltip word must be "after"');
  assert.strictEqual(afterBadge, '97%', 'Tooltip badge must show 97%');
  assert.ok(afterBadgeClass.includes('syl-green'), 'Tooltip badge for 97% must be syl-green');
  assert.ok(afterSubtitle.includes('accent variance'), 'Subtitle must explain syllable accent variance');
  assert.strictEqual(afterChipCount, 2, '"After" must have 2 syllable chips');

  const afterChip1Text = await afterChips.nth(0).textContent();
  const afterChip1Class = await afterChips.nth(0).getAttribute('class');
  const afterChip2Text = await afterChips.nth(1).textContent();
  const afterChip2Class = await afterChips.nth(1).getAttribute('class');
  console.log('  After Chip 1:', afterChip1Text, 'class:', afterChip1Class);
  console.log('  After Chip 2:', afterChip2Text, 'class:', afterChip2Class);

  assert.ok(afterChip1Text.includes('af'), 'Chip 1 must contain "af"');
  assert.ok(afterChip1Text.includes('71%'), 'Chip 1 must show 71%');
  assert.ok(afterChip1Class.includes('syl-amber'), 'Chip 1 (71%) must have syl-amber');
  assert.ok(afterChip2Text.includes('ter'), 'Chip 2 must contain "ter"');
  assert.ok(afterChip2Text.includes('75%'), 'Chip 2 must show 75%');
  assert.ok(afterChip2Class.includes('syl-amber'), 'Chip 2 (75%) must have syl-amber');

  // Verify diagnostic insight card
  const insightCard = tooltipLocator.locator('.crm-tooltip-insight');
  assert.ok(await insightCard.count() > 0, 'Diagnostic insight card must be rendered');
  const insightText = await insightCard.textContent();
  console.log('  Diagnostic insight text:', insightText);
  assert.ok(insightText.includes('Acoustic Diagnosis'), 'Insight card must have "Acoustic Diagnosis" header');
  assert.ok(insightText.includes('/æt/'), 'Insight card must show candidate substitution /æt/');
  assert.ok(insightText.includes('Tip'), 'Insight card must contain coaching Tip badge or label');
  assert.ok(insightText.includes('upper teeth'), 'Insight card must contain upper teeth articulatory cue');
  assert.ok(insightText.includes('/ər/'), 'Insight card must show Oxford American /ər/');
  assert.ok(!insightText.includes('/ɚ/'), 'Insight card must NOT contain un-normalized /ɚ/');
  assert.ok(!insightText.includes('/ɹ/'), 'Insight card must NOT contain un-normalized /ɹ/');

  const tipsList = insightCard.locator('.crm-insight-tip');
  const tipCount = await tipsList.count();
  console.log('  Coaching tips count:', tipCount);
  assert.ok(tipCount >= 2, 'Insight card must have at least 2 coaching tips for "after" syllables');

  // Test interactive syllable chip click
  console.log('[Browser Test] Testing click on syllable chip for audio playback...');
  await afterChips.nth(0).click();
  await page.waitForTimeout(200);

  const afterScreenshotPath = path.join(resultsDir, 'crm-entrance-test-after-tooltip.png');
  await page.screenshot({ path: afterScreenshotPath });
  console.log('[Browser Test] After tooltip screenshot captured to:', afterScreenshotPath);

  // Test hovering on Q1 "data" for Oxford American IPA model verification
  console.log('[Browser Test] Testing hover on Q1 "data" for Oxford American IPA verification...');
  const dataBtn = await page.locator('.crm-result-question:nth-of-type(1) button.crm-word-token:has-text("data")').first();
  assert.ok(await dataBtn.count() > 0, '"data" token must exist in Q1');
  await dataBtn.hover();
  await page.waitForTimeout(250);

  const dataWord = await tooltipLocator.locator('.crm-tooltip-word').textContent();
  const dataChips = tooltipLocator.locator('.crm-syl-chip');
  const dataChipCount = await dataChips.count();
  console.log('  Data word:', dataWord, 'chips count:', dataChipCount);
  assert.strictEqual(dataWord.toLowerCase(), 'data', 'Tooltip word must be "data"');
  assert.strictEqual(dataChipCount, 2, '"data" must have 2 syllable chips ("da", "ta")');

  const dataChip2Text = await dataChips.nth(1).textContent();
  console.log('  Data Chip 2 text:', dataChip2Text);
  assert.ok(dataChip2Text.includes('ta'), 'Chip 2 must contain "ta"');
  assert.ok(dataChip2Text.includes('38%'), 'Chip 2 must show 38%');

  // Verify diagnostic insight card for data
  const dataInsightCard = tooltipLocator.locator('.crm-tooltip-insight');
  assert.ok(await dataInsightCard.count() > 0, 'Insight card must be rendered for "data"');
  const dataInsightText = await dataInsightCard.textContent();
  console.log('  Data diagnostic insight text:', dataInsightText);

  // Oxford American IPA Model assertions for data
  assert.ok(dataInsightText.includes('/pæ/'), '"da" diagnosis must show candidate /pæ/');
  assert.ok(dataInsightText.includes('/tr/'), '"ta" diagnosis must show Oxford American /tr/');
  assert.ok(dataInsightText.includes('/r/ instead of /ə/'), '"ta" must show /r/ instead of /ə/');
  assert.ok(!dataInsightText.includes('/tɹ/'), '"ta" must NOT contain un-normalized /tɹ/');
  assert.ok(!dataInsightText.includes('/ɹ/'), 'Insight text must NOT contain un-normalized /ɹ/');
  assert.ok(!dataInsightText.includes('— Sounded like'), 'Must not contain redundant repeated observation');

  // Coaching tips for data
  const dataTips = dataInsightCard.locator('.crm-insight-tip');
  assert.ok(await dataTips.count() >= 2, '"data" must render coaching tips for both syllables');
  assert.ok(dataInsightText.includes('roof of your mouth') || dataInsightText.includes('lips apart'), '"da" tip must have physical cue');
  assert.ok(dataInsightText.includes('tongue flat') || dataInsightText.includes('neutral'), '"ta" tip must have physical cue');

  const dataScreenshotPath = path.join(resultsDir, 'crm-entrance-test-data-tooltip.png');
  await page.screenshot({ path: dataScreenshotPath });
  console.log('[Browser Test] Data tooltip screenshot captured to:', dataScreenshotPath);

  // Test hovering on "indicators" in Q2 (multi-syllabic with green/amber breakdown)
  console.log('[Browser Test] Testing hover on "indicators" for syllable breakdown...');
  const indBtn = await page.locator('.crm-result-question:nth-of-type(2) button.crm-word-token:has-text("indicators")').first();
  if (await indBtn.count() > 0) {
    await indBtn.hover();
    await page.waitForTimeout(250);
    const indWord = await tooltipLocator.locator('.crm-tooltip-word').textContent();
    const indChips = tooltipLocator.locator('.crm-syl-chip');
    const indChipCount = await indChips.count();
    console.log('  Indicators word:', indWord, 'chips count:', indChipCount);
    assert.strictEqual(indWord, 'indicators');
    assert.ok(indChipCount >= 3, 'indicators should have multiple syllables');
    const indChip1Class = await indChips.nth(0).getAttribute('class');
    console.log('  Indicators first chip class:', indChip1Class);
    assert.ok(indChip1Class.includes('syl-green'), 'first syllable of indicators should be syl-green');
    const indLastChipClass = await indChips.nth(chipCount - 1).getAttribute('class');
    console.log('  Indicators last chip class:', indLastChipClass);
    assert.ok(indLastChipClass.includes('syl-amber'), 'last syllable of indicators ("tors" 74%) should be syl-amber');
  }

  // 4. Verify Q3 uncertain token (e.g., "truly" or similar)
  console.log('[Browser Test] Verifying Q3 uncertain token...');
  const uncertainToken = await page.locator('.crm-result-question:nth-of-type(3) .crm-transcript-uncertain').first();
  if (await uncertainToken.count() > 0) {
    const uncColor = await uncertainToken.evaluate((el) => window.getComputedStyle(el).color);
    const uncTitle = await uncertainToken.getAttribute('title');
    console.log('  Q3 uncertain title:', uncTitle);
    console.log('  Q3 uncertain color:', uncColor);
    assert.strictEqual(uncColor, 'rgb(245, 158, 11)', 'Uncertain token must be amber rgb(245, 158, 11)');

    // Hover over uncertain token to verify amber tooltip badge
    await uncertainToken.hover();
    await page.waitForTimeout(200);
    const uncTipBadgeClass = await tooltipLocator.locator('.crm-tooltip-badge').getAttribute('class');
    console.log('  Uncertain tooltip badge class:', uncTipBadgeClass);
    assert.ok(uncTipBadgeClass.includes('syl-amber'), 'Uncertain tooltip badge must be syl-amber');

    // Test Escape key dismissal
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    const isEscHidden = await tooltipLocator.evaluate((el) => el.style.display === 'none');
    assert.ok(isEscHidden, 'Tooltip must hide when Escape key is pressed');
  }

  // 5. Move mouse away to test tooltip hiding
  await page.mouse.move(0, 0);
  await page.waitForTimeout(200);
  const isHidden = await tooltipLocator.evaluate((el) => el.style.display === 'none');
  assert.ok(isHidden, 'Tooltip must hide when mouse leaves token');

  // 6. Test clicking word tokens
  console.log('[Browser Test] Testing click interaction on word tokens...');
  await getBtn.click();
  await page.waitForTimeout(200);
  await accBtn.click();
  await page.waitForTimeout(200);

  // Ensure no unhandled browser page errors
  assert.strictEqual(pageErrors.length, 0, `Browser page had unhandled errors: ${pageErrors.map(e => e.message).join('; ')}`);

  // 7. Full page screenshot verification
  const screenshotPath = path.join(resultsDir, 'crm-entrance-test-word-scoring.png');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log('[Browser Test] Full page screenshot captured to:', screenshotPath);

  await browser.close();
  server.close();
  console.log('\n[PASS] All Playwright browser checks passed successfully!');
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('[FAIL]', err);
  process.exit(1);
});
