/* eslint-disable no-console */
const assert = require('assert');
const express = require('express');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

function startHarnessServer() {
  const app = express();
  const publicDir = path.join(__dirname, '..', '..', 'public');

  app.use(express.static(publicDir));
  app.get('/', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(publicDir, 'index.html'));
  });
  app.get(/^(?!\/api).*$/, (req, res, next) => {
    if (/\.\w{2,5}(\?.*)?$/.test(req.path)) {
      return next();
    }
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(publicDir, 'index.html'));
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

function buildEssayText() {
  // Deterministic 200-300 word filler so submit never triggers the "few sentences" alert.
  // Kept simple and B2-ish to match the product context.
  const sentence = 'Many people use phones and social media every day, so clear communication matters.';
  const parts = [];
  while (parts.join(' ').split(/\s+/).length < 210) parts.push(sentence);
  return parts.join(' ');
}

(async () => {
  const { server, origin } = await startHarnessServer();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
  const pageErrors = [];
  const consoleWarnings = [];

  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'warning' || message.type() === 'error') {
      consoleWarnings.push(`${message.type()}: ${message.text()}`);
    }
  });

  // Avoid one-time banners interfering with test visibility.
  await page.addInitScript(() => {
    localStorage.setItem('essayInfoDismissed', '1');
    localStorage.setItem('essayModeFirstUse', 'true');
  });

  try {
    await page.goto(`${origin}/pte-practice/writing/essay/4`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    assert.deepStrictEqual(pageErrors, [], `Expected no page errors, got: ${pageErrors.join(' | ')}`);

    const writeEssayScriptSrc = await page.evaluate(() => {
      const script = document.querySelector('script[src*="write-essay-mode.js"]');
      return script ? String(script.getAttribute('src') || '') : '';
    });
    assert.ok(
      /\bwrite-essay-mode\.js\?v=/.test(writeEssayScriptSrc),
      `Write Essay script should be cache-busted, got: ${writeEssayScriptSrc || '(missing)'}`
    );

    const modeVisible = await page.evaluate(() => {
      const panel = document.getElementById('mode-essay');
      return Boolean(panel && getComputedStyle(panel).display !== 'none' && panel.classList.contains('active'));
    });
    assert.strictEqual(modeVisible, true, 'Write Essay mode should be visible after switching to it');

    // Wait for WriteEssayMode.loadEntries() to replace the picker's loading
    // placeholder with a real prompt label.
    await page.waitForFunction(() => {
      const pill = document.getElementById('essay-v7-question-pill');
      const label = pill ? String(pill.textContent || '') : '';
      return Boolean(pill && !pill.disabled && /^#/.test(label.trim()));
    }, { timeout: 20000 });

    const routeSelectedPrompt = await page.evaluate(() => document.getElementById('current-question-id-essay')?.textContent?.trim() || '');
    assert.strictEqual(routeSelectedPrompt, '4', 'Direct Write Essay route should select prompt 4 before manual interaction');
    const routePathAfterLoad = await page.evaluate(() => window.location.pathname);
    assert.ok(
      routePathAfterLoad.endsWith('/pte-practice/writing/essay/4'),
      `Direct Write Essay route should keep prompt 4 in the URL, got: ${routePathAfterLoad}`
    );

    // Select a pilot prompt that has sample variants + idea flow (mindmap/flowchart).
    // The picker's jump list is searchable, so filter down to prompt 4 and click it.
    await page.evaluate(() => {
      const pill = document.getElementById('essay-v7-question-pill');
      if (pill) pill.click();
      const search = document.getElementById('essay-v7-jump-search');
      if (search) {
        search.value = '4';
        search.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const items = Array.from(document.querySelectorAll('#essay-v7-jump-list .ra-v7-list-item'));
      const target = items.find((item) => {
        const id = item.querySelector('.ra-v7-item-id');
        return id && id.textContent.trim() === '#4';
      });
      if (target) target.click();
    });
    await page.waitForTimeout(250);
    await page.waitForFunction(() => {
      const cur = document.getElementById('current-question-id-essay');
      return cur && cur.textContent && cur.textContent.trim() === '4';
    }, { timeout: 10000 });

    const promptPreview = await page.evaluate(() => {
      const preview = document.getElementById('essay-prompt-preview');
      const panel = document.getElementById('mode-essay');
      const previewRect = preview?.getBoundingClientRect();
      const panelRect = panel?.getBoundingClientRect();
      return {
        visible: Boolean(preview && getComputedStyle(preview).display !== 'none' && previewRect.width > 0 && previewRect.height > 0),
        textLength: preview?.innerText?.trim()?.length || 0,
        insidePanel: Boolean(panel && preview && panel.contains(preview)),
        withinPanel: Boolean(previewRect && panelRect && previewRect.left >= panelRect.left - 1 && previewRect.right <= panelRect.right + 1),
        text: preview?.innerText?.trim()?.slice(0, 80) || ''
      };
    });
    assert.strictEqual(promptPreview.visible, true, 'Write Essay prompt preview should be visible before Start Writing');
    assert.ok(promptPreview.textLength > 30, `Prompt preview should contain the selected question, got: ${promptPreview.text}`);
    assert.strictEqual(promptPreview.insidePanel, true, 'Prompt preview should stay inside Write Essay panel');
    assert.strictEqual(promptPreview.withinPanel, true, 'Prompt preview should not overflow the Write Essay panel horizontally');

    // Some environments show onboarding overlays (preloader/entry modal) that can intercept pointer events.
    // Use a DOM click to keep this check resilient and focus on verifying sample rendering.
    await page.evaluate(() => document.getElementById('start-essay-btn')?.click());
    await page.waitForTimeout(400);

    const essayText = buildEssayText();
    await page.evaluate((text) => {
      const textarea = document.getElementById('essay-input');
      if (!textarea) return;
      textarea.value = text;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }, essayText);
    await page.waitForTimeout(150);

    await page.evaluate(() => document.getElementById('essay-submit-btn')?.click());

    await page.waitForFunction(() => {
      const submitted = document.querySelector('.essay-submitted');
      const aiBtn = document.getElementById('essay-ai-score-btn');
      const aiHint = document.getElementById('essay-ai-score-hint');
      const hintVisible = aiHint ? getComputedStyle(aiHint).display !== 'none' : false;
      return Boolean(submitted && aiBtn && hintVisible);
    }, { timeout: 20000 });

    // Basic submit should show the submitted essay + feedback-only (no numeric score summary).
    const basicResultsState = await page.evaluate(() => {
      const submitted = document.querySelector('.essay-submitted');
      const hasOverallScore = Boolean(document.querySelector('.essay-results-summary'));
      const aiBtn = document.getElementById('essay-ai-score-btn');
      const aiHint = document.getElementById('essay-ai-score-hint');
      const aiHintVisible = aiHint ? getComputedStyle(aiHint).display !== 'none' : false;
      const title = document.getElementById('essay-results-title')?.textContent?.trim() || '';
      return {
        hasSubmittedEssay: Boolean(submitted),
        hasOverallScore,
        aiBtnExists: Boolean(aiBtn),
        aiBtnDisabled: aiBtn ? Boolean(aiBtn.disabled) : null,
        aiHintVisible,
        title
      };
    });

    assert.strictEqual(basicResultsState.hasSubmittedEssay, true, 'Results should show the submitted essay after clicking Submit Essay');
    assert.strictEqual(basicResultsState.hasOverallScore, false, 'Basic submit should not render numeric score summary');
    assert.strictEqual(basicResultsState.title, 'Your Essay Feedback', 'Basic submit should use the feedback-only title');
    assert.strictEqual(basicResultsState.aiBtnExists, true, 'Results should include the Submit to AI scoring button');
    assert.strictEqual(basicResultsState.aiBtnDisabled, true, 'AI scoring button should be disabled when not logged in');
    assert.strictEqual(basicResultsState.aiHintVisible, true, 'AI scoring hint should be visible when not logged in');

    const samplePanel = await page.evaluate(() => {
      const details = document.querySelector('details.essay-samples');
      const summaryText = details?.querySelector('summary')?.innerText || '';
      const hasLevelSelect = Boolean(details?.querySelector('#essay-sample-level-select'));
      const hasVariantSelect = Boolean(details?.querySelector('#essay-sample-select'));
      const hasEssay = Boolean(details?.querySelector('.essay-sample-essay'));
      const hasIdeaFlow = Boolean(details?.querySelector('.essay-sample-ideaflow'));
      const hasIdeaFlowPre = Boolean(details?.querySelector('.essay-sample-ideaflow pre.essay-sample-pre'));
      const hasVocabTable = Boolean(details?.querySelector('table.essay-sample-vocab'));
      const levelPillText = details?.querySelector('.essay-sample-meta-row .essay-sample-meta-pill')?.textContent || '';
      return { exists: Boolean(details), summaryText, hasLevelSelect, hasVariantSelect, hasEssay, hasIdeaFlow, hasIdeaFlowPre, hasVocabTable, levelPillText };
    });

    assert.strictEqual(samplePanel.exists, true, 'Results should render a Sample Essays panel for pilot prompts');
    assert.strictEqual(
      samplePanel.summaryText.toLowerCase().includes('sample essays'),
      true,
      `Sample panel summary should mention "Sample Essays", got: ${samplePanel.summaryText}`
    );
    assert.strictEqual(samplePanel.hasLevelSelect, true, 'Sample panel should include a level selector for multi-level sample responses');
    assert.strictEqual(samplePanel.hasVariantSelect, true, 'Sample panel should include a variant selector when 2+ variants exist');
    assert.strictEqual(samplePanel.hasEssay, true, 'Sample panel should render the sample essay text');
    assert.strictEqual(samplePanel.hasIdeaFlow, true, 'Sample panel should render an Idea Flow section (mindmap/flowchart)');
    assert.strictEqual(samplePanel.hasIdeaFlowPre, true, 'Idea Flow section should contain preformatted mindmap/flowchart text');
    assert.strictEqual(samplePanel.hasVocabTable, true, 'Sample panel should include the vocabulary table');

    // Switching level should re-render the sample.
    const beforeLevel = await page.evaluate(() => {
      const pill = document.querySelector('details.essay-samples .essay-sample-meta-row .essay-sample-meta-pill');
      return pill ? String(pill.textContent || '').trim() : '';
    });

    await page.evaluate(() => {
      const select = document.getElementById('essay-sample-level-select');
      if (!select) return;
      // Prefer C1 if available, else pick last option to ensure change.
      const opts = Array.from(select.options || []);
      const c1 = opts.find(o => String(o.value) === 'c1');
      select.value = c1 ? c1.value : (opts.length ? opts[opts.length - 1].value : select.value);
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForTimeout(200);

    const afterLevel = await page.evaluate(() => {
      const pill = document.querySelector('details.essay-samples .essay-sample-meta-row .essay-sample-meta-pill');
      return pill ? String(pill.textContent || '').trim() : '';
    });

    assert.notStrictEqual(afterLevel, beforeLevel, 'Changing level should change the rendered sample (level pill text should change)');

    await page.screenshot({ path: 'tmp/write-essay-samples-browser-check.png', fullPage: true });
    console.log('Write Essay samples browser verification complete.');
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
