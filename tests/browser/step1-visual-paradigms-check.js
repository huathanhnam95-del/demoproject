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

  const pack = {
    schemaVersion: 'EssaySupportPackV1', questionId: '1', prompt: '“Education has become a barrier to learning.” To what extent do you agree or disagree with this statement?',
    common: {
      promptSegments: [
        { role: 'prompt_clause', text: '“Education has become a barrier to learning.”' },
        { role: 'prompt_clause', text: 'To what extent do you agree or disagree with this statement?' }
      ],
      requirements: [{ en: 'State your position.', vi: 'Nêu quan điểm rõ ràng.' }],
      angles: [
        { sourceVariantId: 'agree', en: 'Curriculum rigidity: Standardized curricula stifle creative curiosity.', vi: 'Chương trình rập khuôn làm thui chột tính sáng tạo.' },
        { sourceVariantId: 'agree', en: 'Exam obsession: Teaching to the test reduces joy of self-learning.', vi: 'Áp lực điểm số làm mất đi niềm vui tự học.' },
        { sourceVariantId: 'disagree', en: 'Structured foundation: Systematic guidance is prerequisite for discovery.', vi: 'Kiến thức nền tảng là bệ phóng cho phát minh.' },
        { sourceVariantId: 'disagree', en: 'Peer collaboration: Schooling provides debate and teamwork skills.', vi: 'Trường học rèn luyện kỹ năng làm việc nhóm.' }
      ],
      promptTraps: [{ en: 'Do not ignore the task.', vi: 'Không bỏ qua yêu cầu.' }],
      faq: [{ questionEn: 'What is the task?', questionVi: 'Đề hỏi gì?', answerEn: 'Answer the prompt.', answerVi: 'Trả lời đề.' }]
    },
    levels: Object.fromEntries(['a2_b1', 'b2', 'c1'].map(level => [level, {
      cefrEvidence: 'Controlled frames and prompt-specific vocabulary.', coreTargets: [],
      languageKit: { vocabulary: [{ term: 'impact', enGloss: 'effect', viGloss: 'tác động' }], collocations: [], grammar: [{ en: 'Although X, I believe Y.', vi: 'Mặc dù X, tôi tin Y.' }], cohesion: [{ term: 'however', en: 'contrast', vi: 'tương phản' }] },
      plans: [
        { variantId: 'agree', label: 'Agree', stance: 'agree', thesisFrame: 'I agree because ____.', candidatePoints: [{ en: 'Curriculum rigidity' }, { en: 'Exam obsession' }] },
        { variantId: 'disagree', label: 'Disagree', stance: 'disagree', thesisFrame: 'I disagree because ____.', candidatePoints: [{ en: 'Structured foundation' }, { en: 'Peer collaboration' }] }
      ],
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
    console.log('1. Loading application...');
    await page.goto(`${origin}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(600);
    await page.evaluate(() => document.querySelectorAll('.app-preloader, #app-preloader, #entry-modal, .entry-modal, .tutorial-overlay, .cookie-banner, .welcome-modal').forEach(el => el.remove()));

    // Activate Write Essay Guided Practice
    await page.evaluate(() => {
      document.querySelectorAll('.mode-panel').forEach(panel => { panel.style.display = 'none'; });
      const panel = document.getElementById('mode-essay');
      panel.style.display = 'block';
      window.WriteEssayMode.init();
    });
    await page.waitForTimeout(600);
    console.log('1.1. Testing Pre-start Layout Cards & Bilingual Sync in Preferences...');
    await page.locator('input[name="essay-practice-kind"][value="guided"]').check();
    await page.waitForTimeout(300);

    const prestartCards = page.locator('#essay-prestart-layout-cards .essay-prestart-layout-card');
    assert.strictEqual(await prestartCards.count(), 4, 'Should have 4 pre-start layout cards');

    // Test clicking each pre-start layout card
    for (const layout of ['flowchart', 'table', 'cards', 'mindmap']) {
      const card = page.locator(`#essay-prestart-layout-cards .essay-prestart-layout-card[data-layout="${layout}"]`);
      await card.click();
      await page.waitForTimeout(100);
      assert.strictEqual(await card.evaluate(el => el.classList.contains('is-active')), true, `Prestart card ${layout} should be active`);
      const detailText = await page.locator('#essay-prestart-active-detail').textContent();
      assert.ok(detailText.length > 20, `Active detail box should render description for ${layout}`);
    }

    // Test Expandable Pedagogical Comparison Drawer
    const compareToggleBtn = page.locator('#essay-layout-compare-toggle-btn');
    await compareToggleBtn.click();
    await page.waitForTimeout(200);
    const drawer = page.locator('#essay-layout-compare-drawer');
    assert.strictEqual(await drawer.isVisible(), true, 'Comparison drawer should be open');

    // Test Bilingual sync: Switch language to English in Preferences
    console.log('1.2. Testing English language synchronization...');
    await page.selectOption('#essay-guided-language', 'en');
    await page.waitForTimeout(200);

    const mindmapNameEn = await page.locator('#essay-prestart-layout-cards .essay-prestart-layout-card[data-layout="mindmap"] .essay-prestart-layout-name').textContent();
    assert.strictEqual(mindmapNameEn.trim(), 'Mind Map', 'Mindmap card name should be localized to English');

    const flowchartNameEn = await page.locator('#essay-prestart-layout-cards .essay-prestart-layout-card[data-layout="flowchart"] .essay-prestart-layout-name').textContent();
    assert.strictEqual(flowchartNameEn.trim(), 'Flowchart', 'Flowchart card name should be localized to English');

    const tableNameEn = await page.locator('#essay-prestart-layout-cards .essay-prestart-layout-card[data-layout="table"] .essay-prestart-layout-name').textContent();
    assert.strictEqual(tableNameEn.trim(), 'Comparison Matrix', 'Table card name should be localized to English');

    const cardsNameEn = await page.locator('#essay-prestart-layout-cards .essay-prestart-layout-card[data-layout="cards"] .essay-prestart-layout-name').textContent();
    assert.strictEqual(cardsNameEn.trim(), 'Visual Cards', 'Cards card name should be localized to English');

    const drawerHeadersEn = await page.locator('#essay-layout-compare-drawer th').allTextContents();
    assert.ok(drawerHeadersEn[0].includes('Layout Mode'), 'Drawer header should be English');
    assert.ok(drawerHeadersEn[1].includes('Your Learning Style'), 'Drawer header should be English');

    // Switch back to Vietnamese
    await page.selectOption('#essay-guided-language', 'vi');
    await page.waitForTimeout(200);
    await compareToggleBtn.click(); // close drawer
    await page.waitForTimeout(200);
    assert.strictEqual(await drawer.isHidden(), true, 'Drawer should be closed');

    // Start Guided Practice
    await page.locator('#start-essay-btn').click();
    await page.waitForSelector('#essay-guided-rail:not([hidden])', { timeout: 7000 });
    await page.waitForSelector('.essay-guided-view-toggle-bar', { timeout: 5000 });

    console.log('2. Testing Paradigm 1: Mind Map (Radiating Tree)...');
    const mindmapBtn = page.locator('button[data-guided-action="set-step1-layout"][data-layout="mindmap"]');
    await mindmapBtn.click();
    await page.waitForTimeout(300);

    const mindmapLayout = page.locator('.essay-guided-mindmap-layout');
    assert.strictEqual(await mindmapLayout.isVisible(), true, 'Mind Map layout container should be visible');
    const mindmapCanvas = page.locator('#essay-prompt-mindmap-canvas');
    assert.strictEqual(await mindmapCanvas.isVisible(), true, 'Mind Map canvas should be visible');
    const coreNode = page.locator('#mm-prompt-core');
    assert.strictEqual(await coreNode.isVisible(), true, 'Core prompt hub should be visible');

    const stanceHubs = page.locator('.essay-mm-stance-hub');
    assert.strictEqual(await stanceHubs.count() >= 2, true, 'Should have at least 2 stance hubs (Agree/Disagree)');

    // Test clicking opposite stance hub
    const disagreeHub = page.locator('.essay-mm-branch.is-disagree .essay-mm-stance-hub');
    if (await disagreeHub.count() > 0) {
      await disagreeHub.click();
      await page.waitForTimeout(200);
      assert.strictEqual(await page.locator('.essay-mm-branch.is-disagree').evaluate(el => el.classList.contains('is-active-stance')), true, 'Disagree branch should become active stance');
    }

    // Test clicking argument leaf
    const firstLeaf = page.locator('.essay-mm-leaf').first();
    await firstLeaf.click();
    await page.waitForTimeout(200);

    // Verify SVG paths exist
    const svgPaths = await page.locator('#essay-prompt-mindmap-svg path').count();
    console.log(`Mind Map SVG paths rendered: ${svgPaths}`);
    assert.ok(svgPaths >= 2, 'SVG bezier curves should be drawn between core and hubs/leaves');

    console.log('3. Testing Paradigm 2: Flowchart (POS-PEEL Assembly Line)...');
    const flowchartBtn = page.locator('button[data-guided-action="set-step1-layout"][data-layout="flowchart"]');
    await flowchartBtn.click();
    await page.waitForTimeout(300);

    const flowchartLayout = page.locator('.essay-guided-flowchart-layout');
    assert.strictEqual(await flowchartLayout.isVisible(), true, 'Flowchart layout should be visible');

    const clauseFlowchart = page.locator('.essay-guided-flowchart');
    assert.strictEqual(await clauseFlowchart.isVisible(), true, 'Clause directional flowchart should be visible');

    const stanceGate = page.locator('.essay-flowchart-stance-gate');
    assert.strictEqual(await stanceGate.isVisible(), true, 'Stance Decision Gate should be visible');

    // Test clicking directional arrow col
    const arrowCol1 = page.locator('.essay-flowchart-arrow-col.col-1');
    assert.strictEqual(await arrowCol1.isVisible(), true, 'Arrow column 1 should be visible');
    await arrowCol1.click();
    await page.waitForTimeout(200);
    assert.strictEqual(await page.locator('#flowchart-card-1').evaluate(el => el.classList.contains('is-selected')), true, 'Clause card 1 should be selected after clicking arrow');

    const pipelineBox = page.locator('.essay-wb-pipeline-box');
    assert.strictEqual(await pipelineBox.isVisible(), true, 'POS-PEEL 4-paragraph pipeline box should be visible');

    // Test switching pipeline step tabs
    const body1PipeBtn = page.locator('.essay-wb-pipe-btn[data-step-num="2"]');
    await body1PipeBtn.click();
    await page.waitForTimeout(200);
    const drawerText = await page.locator('#essay-wb-pipeline-drawer').textContent();
    assert.ok(drawerText.includes('PEEL') || drawerText.includes('Thân bài 1') || drawerText.includes('Body 1'), 'Drawer should render Body 1 PEEL content');

    console.log('4. Testing Paradigm 3: Table (Comparison Matrix)...');
    const tableBtn = page.locator('button[data-guided-action="set-step1-layout"][data-layout="table"]');
    await tableBtn.click();
    await page.waitForTimeout(300);

    const tableLayout = page.locator('.essay-guided-table-layout');
    assert.strictEqual(await tableLayout.isVisible(), true, 'Table layout should be visible');

    const stanceBar = page.locator('.essay-table-stance-bar');
    assert.strictEqual(await stanceBar.isVisible(), true, 'Active Stance selection bar should be visible');

    const matrixTable = page.locator('.essay-dialectical-matrix');
    assert.strictEqual(await matrixTable.isVisible(), true, '5-Dimension dialectical matrix table should be visible');

    const matrixRows = page.locator('.essay-dialectical-matrix tbody tr');
    assert.strictEqual(await matrixRows.count(), 5, 'Should have exactly 5 structured criteria rows');

    // Test interactive matrix chips in row 2
    const matrixChip = page.locator('.essay-matrix-chip').first();
    assert.strictEqual(await matrixChip.isVisible(), true, 'Interactive argument chips should be visible in matrix');
    await matrixChip.click();
    await page.waitForTimeout(200);

    console.log('5. Testing Paradigm 4: Cards (Visual Cards & No Mindmap Leak)...');
    const cardsBtn = page.locator('button[data-guided-action="set-step1-layout"][data-layout="cards"]');
    await cardsBtn.click();
    await page.waitForTimeout(300);

    const cardsLayout = page.locator('.essay-guided-cards-layout');
    assert.strictEqual(await cardsLayout.isVisible(), true, 'Visual Cards layout should be visible');

    const clauseGrid = page.locator('.essay-cards-clause-grid');
    assert.strictEqual(await clauseGrid.isVisible(), true, 'Clause cards grid should be visible');

    // Verify Mindmap Leak is completely eliminated: canvas must NOT exist in cards mode
    const leakedCanvas = await page.locator('#essay-prompt-mindmap-canvas').count();
    assert.strictEqual(leakedCanvas, 0, 'Canvas and thought bubbles MUST NOT leak into Cards layout');

    console.log('6. Testing Cross-Step State Decoupling (Step 1 vs Step 2)...');
    // Move to Step 2 (Direction)
    const nextStepBtn = page.locator('button[data-guided-action="go-section"][data-section-id="direction"], button[data-guided-section="direction"]').first();
    await nextStepBtn.click();
    await page.waitForTimeout(400);

    // Verify in Step 2: view toggle has mindmap/list for ideation
    const step2Toggle = page.locator('.essay-guided-view-toggle button[data-guided-action="set-guided-view-mode"]');
    if (await step2Toggle.count() > 0) {
      await page.locator('button[data-guided-action="set-guided-view-mode"][data-view-mode="list"]').click();
      await page.waitForTimeout(300);
    }

    // Return to Step 1
    const prevStepBtn = page.locator('button[data-guided-action="go-section"][data-section-id="understand"], button[data-guided-section="understand"]').first();
    await prevStepBtn.click();
    await page.waitForTimeout(400);

    // Verify Step 1 retained its layout (cards) and was NOT mutated by Step 2
    const currentStep1Layout = await page.evaluate(() => {
      const activeBtn = document.querySelector('button[data-guided-action="set-step1-layout"].is-active');
      return activeBtn ? activeBtn.getAttribute('data-layout') : null;
    });
    console.log(`Step 1 layout after returning from Step 2: ${currentStep1Layout}`);
    assert.strictEqual(currentStep1Layout, 'cards', 'Step 1 must retain its layout independently of Step 2 view mode');

    console.log('7. Testing Mobile 390px Viewport Responsiveness...');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);

    const toggleBar = page.locator('.essay-guided-view-toggle-bar');
    assert.strictEqual(await toggleBar.isVisible(), true, 'Toggle bar should be visible on mobile');

    const toggleBarScroll = await page.evaluate(() => {
      const bar = document.querySelector('.essay-guided-view-toggle-bar');
      const toggle = document.querySelector('.essay-guided-view-toggle');
      return {
        barOverflowX: window.getComputedStyle(bar).overflowX,
        barScrollWidth: bar.scrollWidth,
        barClientWidth: bar.clientWidth,
        toggleWidth: toggle.getBoundingClientRect().width
      };
    });
    console.log('Mobile 390px Toggle Bar metrics:', toggleBarScroll);
    assert.strictEqual(toggleBarScroll.barOverflowX, 'auto', 'Toggle bar must have overflow-x: auto for smooth scrolling');

    // Switch through all 4 modes on 390px mobile to verify no layout blowouts
    const modes = ['mindmap', 'flowchart', 'table', 'cards'];
    for (const mode of modes) {
      console.log(`  Checking mobile rendering for mode: ${mode}...`);
      await page.locator(`button[data-guided-action="set-step1-layout"][data-layout="${mode}"]`).click();
      await page.waitForTimeout(250);

      const contentBox = await page.locator('.essay-step1-container').boundingBox();
      assert.ok(contentBox && contentBox.width <= 390, `Mode ${mode} width should fit within viewport, got ${contentBox?.width}`);

      if (mode === 'table') {
        const scrollHint = page.locator('.essay-matrix-scroll-hint');
        assert.strictEqual(await scrollHint.isVisible(), true, 'Table scroll hint should be visible on mobile');
        const stanceBarBox = await page.locator('.essay-table-stance-bar').boundingBox();
        assert.ok(stanceBarBox && stanceBarBox.width <= 390, 'Table stance bar should fit mobile viewport');
      }
    }

    console.log('8. Testing Legacy renderStep1List Fallback Safety...');
    const legacyCardsHtml = await page.evaluate(() => {
      return window.WriteEssayMode.renderStep1List([], '<div>Type</div>', '<div>Reqs</div>', '<div>Traps</div>', '<div>Angles</div>', '', '');
    });
    assert.ok(legacyCardsHtml && legacyCardsHtml.includes('essay-guided-cards-layout'), 'Legacy renderStep1List must return valid cards layout without crashing');
    assert.ok(legacyCardsHtml.includes('essay-cards-clause-card'), 'Legacy renderStep1List must render clause cards via fallback');

    console.log('✅ ALL STEP 1 VISUAL PARADIGMS & RESPONSIVENESS CHECKS PASSED!');

  } finally {
    await browser.close();
    server.close();
  }
})().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
