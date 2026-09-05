const { chromium } = require('playwright');
const assert = require('assert');
const express = require('express');
const http = require('http');
const path = require('path');

async function run() {
  const app = express();
  const publicDir = path.resolve(process.cwd(), 'public');
  app.use(express.static(publicDir));
  app.use((req, res) => res.sendFile(path.join(publicDir, 'index.html')));

  const server = http.createServer(app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  console.log('Test harness server running on port', port);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  await page.goto(`http://127.0.0.1:${port}/pte-practice`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  await page.evaluate(() => {
    const p = document.querySelector('.app-preloader');
    if (p) p.style.display = 'none';
    const entry = document.getElementById('entry-modal');
    if (entry) entry.remove();
  });

  // Test 1: PTE Practice Writing Cards Height
  console.log('[Test 1] Checking PTE Practice Writing card heights...');
  await page.click('button.practice-skill-btn.card-writing');
  await page.waitForTimeout(500);

  const essayBox = await page.locator('#mode-btn-essay').boundingBox();
  const swtBox = await page.locator('#mode-btn-swt').boundingBox();
  const writingGridBox = await page.locator('#panel-tutorials .tutorial-grid').boundingBox();

  console.log('  Write Essay card height:', essayBox?.height);
  console.log('  Summarize Written Text card height:', swtBox?.height);
  console.log('  Writing grid height:', writingGridBox?.height);

  assert(essayBox && essayBox.height > 200 && essayBox.height < 450, `Write Essay card height expected ~300px, got ${essayBox?.height}`);
  assert(swtBox && swtBox.height > 200 && swtBox.height < 450, `SWT card height expected ~300px, got ${swtBox?.height}`);
  assert(writingGridBox && writingGridBox.height > 200 && writingGridBox.height < 450, `Writing grid height expected ~300px, got ${writingGridBox?.height}`);

  // Test 2: PTE Practice Speaking Cards Height (2-row grid)
  console.log('[Test 2] Checking PTE Practice Speaking card heights...');
  await page.click('button.practice-skill-btn.card-speaking');
  await page.waitForTimeout(500);

  const raBox = await page.locator('#mode-btn-read-aloud').boundingBox();
  const speakingGridBox = await page.locator('#panel-tutorials .tutorial-grid').boundingBox();

  console.log('  Read Aloud card height:', raBox?.height);
  console.log('  Speaking grid height:', speakingGridBox?.height);

  assert(raBox && raBox.height > 200 && raBox.height < 450, `Read Aloud card height expected ~300px, got ${raBox?.height}`);
  assert(speakingGridBox && speakingGridBox.height > 400 && speakingGridBox.height < 800, `Speaking grid height expected 2-row height ~650-750px, got ${speakingGridBox?.height}`);

  // Test 3: English Practice Writing Cards Height
  console.log('[Test 3] Checking English Practice Writing card heights...');
  await page.click('button.practice-scope-btn[data-practice-scope="english"]');
  await page.waitForTimeout(500);
  await page.click('button.practice-skill-btn.card-writing');
  await page.waitForTimeout(500);

  const englishWritingGrid = await page.locator('#panel-tutorials .tutorial-grid').boundingBox();
  console.log('  English Writing grid height:', englishWritingGrid?.height);

  assert(englishWritingGrid && englishWritingGrid.height < 450, `English Writing grid height expected < 450px, got ${englishWritingGrid?.height}`);

  console.log('All practice card height regression assertions passed successfully!');

  await browser.close();
  server.close();
}

run().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
