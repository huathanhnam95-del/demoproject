const { chromium } = require('playwright');
const express = require('express');
const http = require('http');
const path = require('path');
const assert = require('assert');
const crypto = require('crypto');

(async () => {
  const publicDir = path.join(__dirname, '..', '..', 'public');
  const app = express();
  app.use(express.static(publicDir));
  app.use((_req, res) => res.sendFile(path.join(publicDir, 'index.html')));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(() => {
    localStorage.setItem('userStatus', 'guest');
    localStorage.setItem('hasSeenScopeTutorial', 'true');
  });
  const page = await context.newPage();
  const pack = {
    schemaVersion: 'EssaySupportPackV1', questionId: '1', prompt: 'A prompt',
    common: {
      promptSegments: [{ role: 'prompt_clause', text: 'A prompt' }],
      requirements: [{ en: 'State your position.', vi: 'Nêu quan điểm.' }],
      angles: [{ en: 'Consider two effects.', vi: 'Xem xét hai tác động.' }],
      promptTraps: [{ en: 'Do not ignore the task.', vi: 'Không bỏ qua yêu cầu.' }],
      faq: [{ questionEn: 'What is the task?', questionVi: 'Đề hỏi gì?', answerEn: 'Answer the prompt.', answerVi: 'Trả lời đề.' }]
    },
    levels: Object.fromEntries(['a2_b1', 'b2', 'c1'].map(level => [level, {
      cefrEvidence: 'Controlled frames and prompt-specific vocabulary.', coreTargets: [],
      languageKit: { vocabulary: [{ term: 'impact', enGloss: 'effect', viGloss: 'tác động' }], collocations: [], grammar: [{ en: 'Although X, I believe Y.', vi: 'Mặc dù X, tôi tin Y.' }], cohesion: [{ term: 'however', en: 'contrast', vi: 'tương phản' }] },
      plans: [{ variantId: 'agree', label: 'Agree', stance: 'agree', thesisFrame: 'I agree because ____.', point1: 'Point one', point2: 'Point two' }],
      scaffolds: { agree: [{ sentenceId: 'p1s1', paragraph: 'introduction', purpose: 'state your position', ideaCue: 'Give your position.', frame: 'I believe ____.', modelSentence: 'I believe this is important.' }] }
    }])),
    audit: { status: 'PASSED_UNCONTESTED' }
  };
  const packText = JSON.stringify(pack);
  const packHash = crypto.createHash('sha256').update(packText).digest('hex');
  await page.route('**/database/**/support/v1/manifest.json', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ schemaVersion: 'EssaySupportManifestV1', contentVersion: 'v1', questions: { '1': { url: '/database/Write Essay/support/v1/packs/q0001.fixture.json', sha256: packHash, levels: ['a2_b1', 'b2', 'c1'], status: 'PUBLISHED' } } })
  }));
  await page.route('**/database/**/support/v1/packs/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: packText }));
  try {
    await page.goto(`${origin}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);
    await page.evaluate(() => document.querySelectorAll('.app-preloader, #app-preloader, #entry-modal, .entry-modal, .tutorial-overlay, .cookie-banner, .welcome-modal').forEach(el => el.remove()));
    await page.evaluate(() => {
      document.querySelectorAll('.mode-panel').forEach(panel => { panel.style.display = 'none'; });
      const panel = document.getElementById('mode-essay');
      panel.style.display = 'block';
      window.WriteEssayMode.init();
    });
    await page.waitForTimeout(900);
    await page.locator('input[name="essay-practice-kind"][value="guided"]').check();
    await page.locator('#start-essay-btn').click();
    await page.waitForSelector('#essay-guided-rail:not([hidden])', { timeout: 7000 });
    await page.waitForFunction(() => /Break down|Phân tích|unavailable|không khả dụng/i.test(document.querySelector('#essay-guided-content')?.textContent || '') || !document.querySelector('#essay-guided-unavailable')?.hidden, null, { timeout: 7000 });
    const supportText = await page.locator('#essay-guided-content').textContent();
    assert.ok(supportText.includes('Break down') || supportText.includes('Phân tích'));
    await page.locator('#essay-guided-language-toggle').click();
    assert.equal(await page.locator('#essay-guided-language').inputValue(), 'vi');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#essay-guided-mobile-toggle').click();
    assert.equal(await page.locator('#essay-guided-mobile-toggle').getAttribute('aria-expanded'), 'false');
    assert.equal(await page.locator('#essay-guided-rail').isVisible(), true);
    console.log('Write Essay Guided support browser check passed.');
  } finally {
    await browser.close();
    server.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
