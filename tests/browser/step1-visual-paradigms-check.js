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

    // Assert Stage 1 Prompt Analyzer exists prominently in Mind Map mode
    console.log('2.1. Verifying Stage 1 Prompt Analyzer in Mind Map mode...');
    const mmAnalyzer = page.locator('.essay-mindmap-stage-analyzer');
    assert.strictEqual(await mmAnalyzer.isVisible(), true, 'Stage 1 Prompt Analyzer must be visible in Mind Map mode');

    const mmPromptHero = mmAnalyzer.locator('.essay-guided-prompt-hero');
    assert.strictEqual(await mmPromptHero.isVisible(), true, 'Deconstructed Prompt Hero strip must be visible');
    const mmHlClauses = mmPromptHero.locator('.essay-prompt-hl');
    assert.strictEqual(await mmHlClauses.count(), 2, 'Should highlight both prompt clauses in hero strip');

    const mmClauseCards = mmAnalyzer.locator('.essay-cards-clause-grid .essay-cards-clause-card');
    assert.strictEqual(await mmClauseCards.count(), 2, 'Should display clause cards breakdown in Stage 1');

    // Check keywords and traps in clause cards
    const mmKeywords = mmAnalyzer.locator('.essay-clause-kw-tag');
    assert.ok(await mmKeywords.count() > 0, 'Clause cards must render core keyword chips');

    const mmTraps = mmAnalyzer.locator('.essay-clause-trap');
    assert.ok(await mmTraps.count() > 0, 'Clause cards must render interpretation traps');

    // Check Prompt Tension Banner
    const mmTensionBanner = mmAnalyzer.locator('.essay-prompt-tension-banner');
    assert.strictEqual(await mmTensionBanner.isVisible(), true, 'Prompt Tension Banner must be visible in Mind Map');
    const mmTensionText = await mmTensionBanner.locator('.essay-tension-text').textContent();
    assert.ok(mmTensionText.trim().length > 10, 'Prompt tension description should be informative');

    // Test clicking highlighted clause 1 in hero strip triggers card selection
    await mmHlClauses.first().click();
    await page.waitForTimeout(200);
    assert.strictEqual(await page.locator('#clause-card-1').evaluate(el => el.classList.contains('is-selected')), true, 'Clause card 1 should be selected after clicking hero clause 1');

    // Test clicking again toggles off selection
    await mmHlClauses.first().click();
    await page.waitForTimeout(200);
    assert.strictEqual(await page.locator('#clause-card-1').evaluate(el => el.classList.contains('is-selected')), false, 'Clause card 1 should deselect when clicked again');

    // Capture screenshot of Mind Map with prominent Prompt Analyzer
    const screenshotDir = path.join(__dirname, '..', '..', '.tempmediaStorage');
    const mindmapScreenshotPath = path.join(screenshotDir, 'mindmap_prompt_analyzer_verified.png');
    await page.screenshot({ path: mindmapScreenshotPath, fullPage: false });
    console.log(`Captured verification screenshot: ${mindmapScreenshotPath}`);

    // Stage 2: Radiating Mind Map Tree & Canvas
    console.log('2.2. Verifying Stage 2 Radiating Tree & Canvas...');
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

    await page.evaluate(() => {
      const stage1 = document.querySelector('.essay-mindmap-stage-analyzer');
      if (stage1) stage1.scrollIntoView({ behavior: 'instant', block: 'start' });
    });
    await page.waitForTimeout(200);
    await page.locator('.essay-guided-mindmap-layout').screenshot({ path: path.join(screenshotDir, 'mindmap_full_stage1_and_stage2.png') });
    console.log('Saved element screenshot of entire Mind Map mode (Stage 1 + Stage 2)');

    console.log('3. Testing Paradigm 2: Flowchart (POS-PEEL Assembly Line)...');
    const flowchartBtn = page.locator('button[data-guided-action="set-step1-layout"][data-layout="flowchart"]');
    await flowchartBtn.click();
    await page.waitForTimeout(300);

    const flowchartLayout = page.locator('.essay-guided-flowchart-layout');
    assert.strictEqual(await flowchartLayout.isVisible(), true, 'Flowchart layout should be visible');

    // Assert Stage 1 Prompt Analyzer & Flowchart exists
    const fcPromptHero = flowchartLayout.locator('.essay-flowchart-stage .essay-guided-prompt-hero');
    assert.strictEqual(await fcPromptHero.isVisible(), true, 'Prompt Hero strip should be visible in Flowchart Stage 1');

    const clauseFlowchart = page.locator('.essay-guided-flowchart');
    assert.strictEqual(await clauseFlowchart.isVisible(), true, 'Clause directional flowchart should be visible');

    const fcKeywords = clauseFlowchart.locator('.essay-clause-kw-tag');
    assert.ok(await fcKeywords.count() > 0, 'Flowchart cards must render core keyword chips');

    const fcTraps = clauseFlowchart.locator('.essay-clause-trap');
    assert.ok(await fcTraps.count() > 0, 'Flowchart cards must render interpretation traps');

    const fcTensionBanner = flowchartLayout.locator('.essay-flowchart-stage .essay-prompt-tension-banner');
    assert.strictEqual(await fcTensionBanner.isVisible(), true, 'Flowchart Stage 1 must include prompt tension banner');

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

    // Assert Stage 1 Prompt Analyzer exists in Table mode
    const tableAnalyzer = tableLayout.locator('.essay-table-stage-analyzer');
    assert.strictEqual(await tableAnalyzer.isVisible(), true, 'Stage 1 Prompt Analyzer must be visible in Table mode');
    assert.strictEqual(await tableAnalyzer.locator('.essay-guided-prompt-hero').isVisible(), true, 'Prompt Hero strip must be visible in Table Stage 1');
    assert.strictEqual(await tableAnalyzer.locator('.essay-prompt-tension-banner').isVisible(), true, 'Prompt Tension Banner must be visible in Table Stage 1');

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

    // Assert Part 1 contains prompt hero, clause cards, and tension banner
    assert.strictEqual(await cardsLayout.locator('.essay-step1-part-1 .essay-guided-prompt-hero').isVisible(), true, 'Cards Part 1 must contain Prompt Hero strip');
    assert.strictEqual(await cardsLayout.locator('.essay-step1-part-1 .essay-prompt-tension-banner').isVisible(), true, 'Cards Part 1 must contain Prompt Tension Banner');

    const clauseGrid = page.locator('.essay-cards-clause-grid');
    assert.strictEqual(await clauseGrid.isVisible(), true, 'Clause cards grid should be visible');

    const cardsKeywords = clauseGrid.locator('.essay-clause-kw-tag');
    assert.ok(await cardsKeywords.count() > 0, 'Cards mode clause cards must render keyword chips');

    const cardsTraps = clauseGrid.locator('.essay-clause-trap');
    assert.ok(await cardsTraps.count() > 0, 'Cards mode clause cards must render traps');

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

    console.log('9. Testing Bilingual Stage Pills Localization in Mind Map, Flowchart, Table, and Cards...');
    // Reset to desktop viewport
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(200);

    // Switch to English language via the active rail toggle button
    await page.locator('#essay-guided-language-toggle').click();
    await page.waitForTimeout(200);

    // 9.1 Table in English
    await page.locator('button[data-guided-action="set-step1-layout"][data-layout="table"]').click();
    await page.waitForTimeout(200);
    const tablePill1En = await page.locator('.essay-table-stage-analyzer .essay-step1-stage-pill').textContent();
    assert.strictEqual(tablePill1En.trim(), 'Part 1: Understand Prompt', 'Table Stage 1 pill should be in English');
    const tablePill2En = await page.locator('.essay-guided-table-layout > .essay-step1-stage-header .essay-step1-stage-pill').textContent();
    assert.strictEqual(tablePill2En.trim(), 'Part 2: Compare 2 Stances', 'Table Stage 2 pill should be in English');

    // 9.2 Cards in English
    await page.locator('button[data-guided-action="set-step1-layout"][data-layout="cards"]').click();
    await page.waitForTimeout(200);
    const cardsPill1En = await page.locator('.essay-step1-part-1 .essay-step1-part-pill').textContent();
    assert.strictEqual(cardsPill1En.trim(), 'Part 1', 'Cards Part 1 pill should be Part 1 in English');
    const cardsPill2En = await page.locator('.essay-step1-part-2 .essay-step1-part-pill').textContent();
    assert.strictEqual(cardsPill2En.trim(), 'Part 2', 'Cards Part 2 pill should be Part 2 in English');

    // 9.3 Mindmap in English
    await page.locator('button[data-guided-action="set-step1-layout"][data-layout="mindmap"]').click();
    await page.waitForTimeout(200);
    const mmPill1En = await page.locator('.essay-mindmap-stage-analyzer .essay-step1-stage-pill').textContent();
    assert.strictEqual(mmPill1En.trim(), 'Part 1: Understand Prompt', 'Mindmap Stage 1 pill should be in English');
    const mmPill2En = await page.locator('.essay-guided-mindmap-layout > .essay-step1-stage-header .essay-step1-stage-pill').textContent();
    assert.strictEqual(mmPill2En.trim(), 'Part 2: Choose Stance & Arguments', 'Mindmap Stage 2 pill should be in English');

    // 9.4 Flowchart in English
    await page.locator('button[data-guided-action="set-step1-layout"][data-layout="flowchart"]').click();
    await page.waitForTimeout(200);
    const fcPill1En = await page.locator('.essay-flowchart-stage-pill').textContent();
    assert.strictEqual(fcPill1En.trim(), 'Stage 1', 'Flowchart Stage 1 pill should be Stage 1 in English');

    // Switch back to Vietnamese
    await page.locator('#essay-guided-language-toggle').click();
    await page.waitForTimeout(200);
    await page.locator('button[data-guided-action="set-step1-layout"][data-layout="table"]').click();
    await page.waitForTimeout(200);
    const tablePill1Vi = await page.locator('.essay-table-stage-analyzer .essay-step1-stage-pill').textContent();
    assert.strictEqual(tablePill1Vi.trim(), 'Phần 1: Hiểu đề bài', 'Table Stage 1 pill should be in Vietnamese');
    const tablePill2Vi = await page.locator('.essay-guided-table-layout > .essay-step1-stage-header .essay-step1-stage-pill').textContent();
    assert.strictEqual(tablePill2Vi.trim(), 'Phần 2: Đối chiếu 2 phe', 'Table Stage 2 pill should be in Vietnamese');

    console.log('10. Testing Clause Splitting & Segmentation Engine Edge Cases...');
    const edgeCaseResults = await page.evaluate(() => {
      const splitter = window.WriteEssayMode.splitPromptIntoClauses;
      const parser = window.WriteEssayMode.parsePromptSegments;

      // Case 1: Trailing clause without terminal punctuation
      const textNoTrailingPunct = '“Climate change is real.” To what extent do you agree or disagree discuss advantages';
      const clausesNoTrailingPunct = splitter(textNoTrailingPunct);

      // Case 2: Quote with internal period followed by author attribution
      const textQuoteWithAttribution = '“The only thing that interferes with my learning is my education.” – Albert Einstein. Do you agree or disagree?';
      const clausesQuote = splitter(textQuoteWithAttribution);

      // Case 3: Prompt with abbreviations (e.g., etc., Dr., U.S.)
      const textWithAbbr = 'Some people believe modern tech (e.g. smartphones) harms students in the U.S. vs. traditional methods. Discuss both views.';
      const clausesAbbr = splitter(textWithAbbr);

      // Case 4: Parsing segments and extracting keywords from mock guidedPack
      const parsedSegments = parser([], textQuoteWithAttribution);

      return {
        clausesNoTrailingPunct,
        clausesQuote,
        clausesAbbr,
        parsedSegments
      };
    });

    console.log('Edge case 1 (trailing unpunctuated clause):', edgeCaseResults.clausesNoTrailingPunct);
    assert.strictEqual(edgeCaseResults.clausesNoTrailingPunct.length, 2, 'Should split into 2 clauses without losing trailing text');
    assert.ok(edgeCaseResults.clausesNoTrailingPunct[1].includes('discuss advantages'), 'Trailing unpunctuated clause must be preserved');

    console.log('Edge case 2 (quote with attribution):', edgeCaseResults.clausesQuote);
    assert.strictEqual(edgeCaseResults.clausesQuote.length, 2, 'Should keep quote intact and not fracture at internal period');
    assert.ok(edgeCaseResults.clausesQuote[0].includes('Albert Einstein'), 'First clause should retain author attribution');

    console.log('Edge case 3 (abbreviations):', edgeCaseResults.clausesAbbr);
    assert.strictEqual(edgeCaseResults.clausesAbbr.length, 2, 'Should not split on abbreviations like e.g. or U.S.');
    assert.ok(edgeCaseResults.clausesAbbr[0].includes('e.g.'), 'e.g. must be unmasked properly');

    console.log('Edge case 4 (parsed segments structure):', edgeCaseResults.parsedSegments.length);
    assert.strictEqual(edgeCaseResults.parsedSegments.length, 2, 'Should yield 2 parsed segments');
    assert.ok(edgeCaseResults.parsedSegments[0].keywords.length > 0, 'Should have extracted keywords');

    console.log('✅ ALL STEP 1 VISUAL PARADIGMS & RESPONSIVENESS CHECKS PASSED!');

  } finally {
    await browser.close();
    server.close();
  }
})().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
