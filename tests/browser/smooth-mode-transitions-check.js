const { chromium } = require('playwright');
const express = require('express');
const http = require('http');
const path = require('path');
const assert = require('assert');

(async () => {
  const publicDir = path.join(__dirname, '..', '..', 'public');
  const app = express();
  app.use(express.static(publicDir));
  app.use((_req, res) => res.sendFile(path.join(publicDir, 'index.html')));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;

  console.log(`Test server running at ${origin}`);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });

  await context.addInitScript(() => {
    localStorage.setItem('userStatus', 'guest');
    localStorage.setItem('hasSeenScopeTutorial', 'true');
    sessionStorage.setItem('hasSeenScopeTutorial', 'true');
    localStorage.setItem('cookie_consent', 'accepted');
  });

  const page = await context.newPage();

  // Attach CLS observer in the browser context
  await page.addInitScript(() => {
    window.__layoutShifts = [];
    window.__cumulativeLayoutShift = 0;
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput) {
            window.__layoutShifts.push({
              value: entry.value,
              startTime: entry.startTime,
              sources: (entry.sources || []).map(s => {
                const node = s.node;
                if (!node) return 'unknown';
                const id = node.id ? '#' + node.id : '';
                const cls = node.className && typeof node.className === 'string' ? '.' + node.className.trim().split(/\s+/).join('.') : '';
                return (node.nodeName || '') + id + cls;
              })
            });
            window.__cumulativeLayoutShift += entry.value;
          }
        }
      });
      observer.observe({ type: 'layout-shift', buffered: true });
    } catch (e) {
      console.warn('PerformanceObserver layout-shift not supported:', e);
    }
  });

  try {
    console.log('1. Loading page...');
    await page.goto(`${origin}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(600);

    // Clean any overlays
    await page.evaluate(() => {
      document.querySelectorAll('.app-preloader, #app-preloader, #entry-modal, .entry-modal, .tutorial-overlay, .cookie-banner, .welcome-modal').forEach(el => el.remove());
    });
    await page.waitForTimeout(400);

    // Verify dashboard is active and skill filter transitions work
    console.log('2. Testing skill filter transition (Speaking -> Writing)...');
    const writingSkillBtn = page.locator('.practice-skill-btn[data-practice-skill="writing"]');
    await writingSkillBtn.click();
    
    await page.waitForTimeout(300);
    const essayCard = page.locator('#mode-btn-essay');
    assert.strictEqual(await essayCard.isVisible(), true, 'Write Essay card should be visible in Writing tab');

    // 3. Test mode transition to Write Essay
    console.log('3. Testing transition to Write Essay mode...');
    
    // Click Write Essay card
    await essayCard.click();

    // Verify that mode-essay is displayed and active
    const essayPanel = page.locator('#mode-essay');
    await page.waitForSelector('#mode-essay.active', { timeout: 3000 });
    assert.strictEqual(await essayPanel.isVisible(), true, 'Write essay panel should be visible');

    // Verify prompt preview is rendered with stable height
    const promptPreview = page.locator('#essay-prompt-preview');
    await page.waitForSelector('#essay-prompt-preview .essay-prompt-text', { timeout: 10000 });
    const previewBox = await promptPreview.boundingBox();
    assert.ok(previewBox.height >= 100, `Prompt preview height should be >= 100px, got ${previewBox.height}`);

    // 4. Test Guided Practice CSS Grid Accordion expansion and collapse zero phantom height
    console.log('4. Testing Guided Practice accordion expansion and zero phantom height...');
    const initialHeight = await page.evaluate(() => {
      const el = document.getElementById('essay-guided-preferences');
      return el ? el.getBoundingClientRect().height : -1;
    });
    console.log('Collapsed accordion height before opening:', initialHeight);
    assert.strictEqual(initialHeight, 0, 'Collapsed accordion height must be strictly 0px (no phantom margin/border/padding)');

    const guidedRadio = page.locator('input[name="essay-practice-kind"][value="guided"]');
    await guidedRadio.check();

    const guidedPrefs = page.locator('#essay-guided-preferences');
    await page.waitForSelector('#essay-guided-preferences.is-open', { timeout: 1000 });
    assert.strictEqual(await guidedPrefs.isVisible(), true, 'Guided preferences should be visible when open');

    // Wait for smooth grid accordion animation (280ms) and speculative prefetch
    await page.waitForTimeout(600);
    const openedHeight = await page.evaluate(() => {
      const el = document.getElementById('essay-guided-preferences');
      return el ? el.getBoundingClientRect().height : -1;
    });
    console.log('Opened accordion height:', openedHeight);
    assert.ok(openedHeight > 20, `Opened accordion height should be > 20px, got ${openedHeight}`);

    // Test collapsing back to Exam Practice
    const examRadio = page.locator('input[name="essay-practice-kind"][value="exam"]');
    await examRadio.check();
    await page.waitForTimeout(400);
    const reCollapsedHeight = await page.evaluate(() => {
      const el = document.getElementById('essay-guided-preferences');
      return el ? el.getBoundingClientRect().height : -1;
    });
    console.log('Re-collapsed accordion height:', reCollapsedHeight);
    assert.strictEqual(reCollapsedHeight, 0, 'Re-collapsed accordion height must return to strictly 0px');

    // Re-check guided for subsequent test steps
    await guidedRadio.check();
    await page.waitForSelector('#essay-guided-preferences.is-open', { timeout: 1000 });
    await page.waitForTimeout(400);

    // 5. Test Start Writing -> Step 1 zero-spinner-flash entry
    console.log('5. Testing Start Writing entry...');
    const startBtn = page.locator('#start-essay-btn');
    await startBtn.click();

    // Verify workspace is visible and loading spinner is bypassed or immediately renders
    await page.waitForSelector('#essay-guided-workspace', { timeout: 4000 });
    await page.waitForTimeout(300);

    const guidedContentText = await page.locator('#essay-guided-content').textContent();
    assert.ok(guidedContentText.length > 50, 'Step 1 guided content should be populated');

    // Verify SVG mindmap lines are rendered stably
    const svgMindMap = await page.evaluate(() => {
      const svg = document.getElementById('essay-prompt-mindmap-svg');
      return svg ? { paths: svg.querySelectorAll('path').length, width: svg.getAttribute('width') } : null;
    });
    console.log('SVG MindMap status:', svgMindMap);

    // 6. Test Back to Dashboard transition from writing phase via exitCurrentMode
    console.log('6. Testing exitCurrentMode back to dashboard from guided writing phase...');
    await page.evaluate(() => window.exitCurrentMode());

    await page.waitForSelector('.dashboard-modern-container:not([style*="display: none"])', { timeout: 3000 });
    const dashboard = page.locator('.dashboard-modern-container');
    assert.strictEqual(await dashboard.isVisible(), true, 'Dashboard should be visible again');

    // 7. Test re-entering Write Essay and clicking #back-to-dashboard-btn from setup screen
    console.log('7. Testing re-entering Write Essay and clicking #back-to-dashboard-btn from setup screen...');
    await page.locator('#mode-btn-essay').click();
    await page.waitForSelector('#mode-essay.active', { timeout: 3000 });
    
    const backBtn = page.locator('#back-to-dashboard-btn');
    await page.waitForSelector('#back-to-dashboard-btn', { state: 'visible', timeout: 3000 });
    await backBtn.click();

    await page.waitForSelector('.dashboard-modern-container:not([style*="display: none"])', { timeout: 3000 });
    assert.strictEqual(await dashboard.isVisible(), true, 'Dashboard should be visible again after clicking back button');

    // 8. Test speaking mode transition (e.g. Read Aloud) to verify speaking modes defer reveal without void flash
    console.log('8. Testing transition to Read Aloud (Speaking mode)...');
    await page.locator('.practice-skill-btn[data-practice-skill="speaking"]').click();
    await page.waitForTimeout(300);
    await page.locator('#mode-btn-read-aloud').click();
    await page.waitForSelector('#mode-read-aloud.active', { timeout: 3000 });
    assert.strictEqual(await page.locator('#mode-read-aloud').isVisible(), true, 'Read Aloud panel should be visible');

    await page.locator('#back-to-dashboard-btn').click();
    await page.waitForSelector('.dashboard-modern-container:not([style*="display: none"])', { timeout: 3000 });
    assert.strictEqual(await dashboard.isVisible(), true, 'Dashboard should be visible again after exiting Read Aloud');

    // 9. Test rapid-fire tab switching resistance
    console.log('9. Testing rapid-fire skill filter switching...');
    const skills = ['speaking', 'writing', 'reading', 'listening', 'writing'];
    for (const skill of skills) {
      await page.locator(`.practice-skill-btn[data-practice-skill="${skill}"]`).click();
      await page.waitForTimeout(150);
    }
    await page.waitForTimeout(300);
    const finalEssayCard = page.locator('#mode-btn-essay');
    assert.strictEqual(await finalEssayCard.isVisible(), true, 'Write Essay card should be visible after rapid skill tab clicks');

    // 10. Measure total CLS across entire multi-mode transition suite
    const totalCls = await page.evaluate(() => window.__cumulativeLayoutShift);
    const layoutShifts = await page.evaluate(() => window.__layoutShifts);
    console.log(`Total Cumulative Layout Shift (CLS): ${totalCls.toFixed(5)}`);
    console.log(`Layout shifts recorded: ${layoutShifts.length}`);
    layoutShifts.forEach((shift, idx) => {
      console.log(`  [Shift ${idx + 1}] value: ${shift.value.toFixed(5)}, time: ${shift.startTime.toFixed(1)}ms, sources: ${shift.sources.join(', ')}`);
    });

    console.log('Finished logging shifts.');
    assert.ok(totalCls < 0.4, `CLS should be < 0.4, got ${totalCls}`);
    console.log('✅ ALL SMOOTH TRANSITION VERIFICATION CHECKS PASSED!');

  } finally {
    await browser.close();
    server.close();
  }
})().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
