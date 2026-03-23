const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  console.log('Navigating to https://localhost:8443/');
  await page.goto('https://localhost:8443/', { waitUntil: 'domcontentloaded' });

  // Dismiss entry modal
  console.log('Dismissing entry modal...');
  await page.click('#guest-mode-btn');

  // Wait for mode cards
  console.log('Waiting for mode cards...');
  await page.waitForSelector('.mode-switch-btn', { state: 'visible' });

  // Locate Read Aloud card
  const cards = await page.$$('.card-body h3');
  let readAloudFound = false;
  for (const card of cards) {
    const text = await card.textContent();
    if (text.includes('Read Aloud')) {
      readAloudFound = true;
      console.log('Read Aloud card found! Clicking it...');
      await card.evaluate(node => node.closest('.mode-switch-btn').click());
      break;
    }
  }

  if (!readAloudFound) {
    console.error('FAIL: Read Aloud card not found!');
    await browser.close();
    process.exit(1);
  }

  // Wait for Tutorial and read aloud mode panel
  console.log('Checking for tutorial...');
  const isTutorialVisible = await page.isVisible('#tutorial-overlay');
  if (isTutorialVisible) {
    console.log('Tutorial is visible. Skipping tutorial...');
    await page.click('#tutorial-skip-btn');
  } else {
    console.log('Tutorial not visible, maybe already skipped.');
  }

  await page.waitForSelector('#mode-read-aloud.active', { state: 'visible', timeout: 5000 });
  console.log('Read Aloud mode panel is active.');

  // Check initial state (PREP)
  const statusMsg = await page.textContent('#ra-status-message');
  console.log('Status message:', statusMsg);
  
  const recordBtnText = await page.textContent('#ra-record-btn');
  console.log('Record button text:', recordBtnText);
  
  if (recordBtnText.includes('Unsupported Browser')) {
    console.log('Browser does not support STT, gracefully handling unsupported state.');
  } else if (recordBtnText.includes('Skip Prep')) {
    console.log('In Prep state. Skipping prep...');
    await page.click('#ra-record-btn');
    
    // Check if recording starts
    await page.waitForTimeout(500); // UI update
    const newRecordBtnText = await page.textContent('#ra-record-btn');
    console.log('Record button changed to:', newRecordBtnText);
    
    if (newRecordBtnText.includes('Finish Recording')) {
      console.log('SUCCESS: Recording started.');
    } else {
      console.log('FAIL: Did not enter recording state.');
    }
  }

  console.log('Test complete. Closing browser.');
  await browser.close();
})();
