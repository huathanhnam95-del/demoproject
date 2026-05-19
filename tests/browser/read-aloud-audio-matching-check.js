/* eslint-disable no-console */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const isHeaded = process.argv.includes('--headed');
  const browser = await chromium.launch({
    headless: !isHeaded,
    slowMo: isHeaded ? 500 : 0
  });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  
  // Set up FakeMediaRecorder in case mic access is requested
  await context.addInitScript(() => {
    class FakeMediaRecorder {
      constructor(stream) {
        this.stream = stream;
        this.state = 'inactive';
        this.mimeType = 'audio/webm';
        this.listeners = {};
      }
      addEventListener(type, handler) {
        if (!this.listeners[type]) this.listeners[type] = [];
        this.listeners[type].push(handler);
      }
      start() {
        this.state = 'recording';
      }
      stop() {
        if (this.state !== 'recording') return;
        this.state = 'inactive';
        const blob = new Blob(['fake-audio'], { type: this.mimeType });
        (this.listeners.dataavailable || []).forEach((handler) => handler({ data: blob }));
        (this.listeners.stop || []).forEach((handler) => handler());
      }
    }
    Object.defineProperty(window, 'MediaRecorder', {
      configurable: true,
      writable: true,
      value: FakeMediaRecorder
    });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => ({
          getTracks() {
            return [{ stop() {} }];
          }
        })
      }
    });
  });

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (!text.includes('Failed to load resource')) {
        errors.push(text);
      }
    }
  });

  // Helper to skip tutorial
  async function dismissTutorialIfVisible() {
    await page.waitForTimeout(1000);
    const isTutorialVisible = await page.evaluate(() => {
      const overlay = document.getElementById('tutorial-overlay');
      return !!overlay && overlay.classList.contains('active') && getComputedStyle(overlay).display !== 'none';
    });
    if (!isTutorialVisible) {
      return;
    }
    console.log('Tutorial is visible. Skipping tutorial...');
    await page.click('#tutorial-skip');
    await page.waitForFunction(() => {
      const overlay = document.getElementById('tutorial-overlay');
      return !overlay || !overlay.classList.contains('active') || getComputedStyle(overlay).display === 'none';
    }, { timeout: 5000 });
  }

  // Load manifest.json
  const manifestPath = path.join(__dirname, '../../public/database/RA/Voice/audio/manifest.json');
  console.log(`Loading manifest from: ${manifestPath}`);
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Manifest file not found at ${manifestPath}`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const manifestKeys = Object.keys(manifest);
  console.log(`Manifest loaded with ${manifestKeys.length} question entries.`);

  console.log('Navigating to https://localhost:8443/');
  await page.goto('https://localhost:8443/', { waitUntil: 'domcontentloaded' });

  // Dismiss entry modal
  console.log('Dismissing entry modal...');
  const guestModeBtn = await page.waitForSelector('#guest-mode-btn', { state: 'visible', timeout: 5000 });
  await guestModeBtn.click();

  // Wait for mode cards
  console.log('Waiting for mode cards...');
  await page.waitForSelector('.mode-switch-btn', { state: 'visible' });

  // Switch to Read Aloud mode
  console.log('Switching to Read Aloud mode...');
  await page.evaluate(() => window.switchToMode('read-aloud'));
  await page.waitForSelector('#mode-read-aloud.active', { state: 'visible', timeout: 10000 });
  console.log('Read Aloud mode active.');

  // Handle tutorial
  await dismissTutorialIfVisible();

  // Wait for database loading
  console.log('Waiting for Read Aloud database to load...');
  await page.waitForFunction(() => window.ReadAloudMode && window.ReadAloudMode.hasLoadedDatabase === true, { timeout: 15000 });
  console.log('Database loaded successfully.');

  // Extract database
  const db = await page.evaluate(() => window.ReadAloudMode.database);
  console.log(`Browser database contains ${db.length} entries.`);

  // Pick 3 random keys from manifest
  const selectedIds = [];
  while (selectedIds.length < 3) {
    const randomKey = manifestKeys[Math.floor(Math.random() * manifestKeys.length)];
    // Make sure it is in our database too
    const dbIndex = db.findIndex(row => String(row.ID) === String(randomKey));
    if (dbIndex !== -1 && !selectedIds.includes(randomKey)) {
      selectedIds.push(randomKey);
    }
  }

  console.log('Picked random IDs to verify:', selectedIds);

  for (const id of selectedIds) {
    console.log(`\n=================== Verifying Question ID: ${id} ===================`);
    
    // Find index in database
    const idx = db.findIndex(row => String(row.ID) === String(id));
    const expectedTranscript = db[idx]['ANSWER FOR COMPARE OR TRANSCRIPT'] || db[idx].ANSWER || '';
    
    console.log(`Expected Transcript: "${expectedTranscript.substring(0, 60)}..."`);

    // Load question via UI method
    await page.evaluate((index) => {
      window.ReadAloudMode.loadSpecificPrompt(index);
    }, idx);

    // Verify UI updates text
    await page.waitForFunction((txt) => {
      const el = document.getElementById('ra-text-prompt');
      return el && el.textContent.trim().includes(txt.trim().substring(0, 15));
    }, expectedTranscript, { timeout: 5000 });

    const uiText = await page.textContent('#ra-text-prompt');
    console.log(`UI Transcript displayed: "${uiText.trim().substring(0, 60)}..."`);
    if (!uiText.trim().includes(expectedTranscript.trim().substring(0, 15))) {
      throw new Error(`Transcript text mismatch for ID ${id}. Expected: "${expectedTranscript}", Got: "${uiText}"`);
    }

    // Settings combinations to test
    const combinations = [
      { gender: 'female', speed: '100', btnId: '#ra-voice-female', speedId: '#ra-speed-100' },
      { gender: 'female', speed: '80', btnId: '#ra-voice-female', speedId: '#ra-speed-80' },
      { gender: 'male', speed: '100', btnId: '#ra-voice-male', speedId: '#ra-speed-100' },
      { gender: 'male', speed: '80', btnId: '#ra-voice-male', speedId: '#ra-speed-80' }
    ];

    for (const comb of combinations) {
      console.log(`Testing combo: Gender=${comb.gender}, Speed=${comb.speed}`);
      
      // Click gender button
      const genderBtn = await page.waitForSelector(comb.btnId, { state: 'visible' });
      await genderBtn.click();
      
      // Click speed button
      const speedBtn = await page.waitForSelector(comb.speedId, { state: 'visible' });
      await speedBtn.click();

      // Wait a short time for audio element to update
      await page.waitForTimeout(500);

      // Verify audio element source
      const resolvedSrc = await page.evaluate(() => {
        const audioEl = document.getElementById('ra-elevenlabs-audio');
        return audioEl ? audioEl.src : null;
      });

      if (!resolvedSrc) {
        throw new Error(`Audio player element source is missing for ID ${id}, Gender ${comb.gender}, Speed ${comb.speed}`);
      }

      const filename = path.basename(new URL(resolvedSrc).pathname);
      console.log(`Resolved audio source URL: ${resolvedSrc}`);
      console.log(`Resolved filename: ${filename}`);

      // Verify the filename is valid in manifest
      const qManifest = manifest[id];
      if (!qManifest) {
        throw new Error(`Manifest lacks entries for question ID ${id}`);
      }

      const genderManifest = qManifest[comb.gender];
      if (!genderManifest) {
        throw new Error(`Manifest has no entries for ID ${id}, Gender ${comb.gender}`);
      }

      let isMatch = false;
      for (const voiceId in genderManifest) {
        const voiceInfo = genderManifest[voiceId];
        if (voiceInfo.files && voiceInfo.files[comb.speed] === filename) {
          isMatch = true;
          console.log(`✓ Matched manifest entry: Voice=${voiceId}, File=${filename}`);
          break;
        }
      }

      if (!isMatch) {
        throw new Error(`Resolved filename ${filename} for ID ${id}, Gender ${comb.gender}, Speed ${comb.speed} does not match any entry in manifest.json`);
      }

      // Check if the file is reachable on the local server (fetch status 200)
      const fetchStatus = await page.evaluate(async (src) => {
        try {
          const res = await fetch(src, { method: 'HEAD' });
          return res.status;
        } catch (err) {
          return 0;
        }
      }, resolvedSrc);

      console.log(`Fetch HEAD status for audio file: ${fetchStatus}`);
      if (fetchStatus !== 200) {
        throw new Error(`Audio asset not reachable! Status ${fetchStatus} for URL ${resolvedSrc}`);
      }
    }
  }

  // Perform comprehensive UI/UX interactive flow checks
  await verifyUIUXFlow(page);

  // Print any errors collected
  if (errors.length) {
    console.error('Errors found in browser log:');
    errors.forEach((err) => console.error(`- ${err}`));
    throw new Error('Verification failed due to browser console errors');
  }

  await browser.close();
  console.log('\n=========================================');
  console.log('SUCCESS: Read Aloud Playwright Verification Test Passed!');
  console.log('=========================================');
})().catch((err) => {
  console.error('Verification FAILED:', err);
  process.exit(1);
});

async function verifyUIUXFlow(page) {
  console.log('\n--- Starting UI/UX Interactive Flow Verification ---');

  // 1. Gender/Speed Button Styles Active highlights
  console.log('Verifying Voice Gender button active styling...');
  await page.click('#ra-voice-female');
  await page.waitForTimeout(200);
  const femaleActive = await page.evaluate(() => {
    const btn = document.getElementById('ra-voice-female');
    return btn.style.background === 'rgb(59, 130, 246)' || btn.style.background === '#3b82f6';
  });
  if (!femaleActive) throw new Error('Female voice button style not set to active highlight');

  await page.click('#ra-voice-male');
  await page.waitForTimeout(200);
  const maleActive = await page.evaluate(() => {
    const btn = document.getElementById('ra-voice-male');
    return btn.style.background === 'rgb(59, 130, 246)' || btn.style.background === '#3b82f6';
  });
  if (!maleActive) throw new Error('Male voice button style not set to active highlight');

  console.log('Verifying Voice Speed button active styling...');
  await page.click('#ra-speed-80');
  await page.waitForTimeout(200);
  const slowActive = await page.evaluate(() => {
    const btn = document.getElementById('ra-speed-80');
    return btn.style.background === 'rgb(59, 130, 246)' || btn.style.background === '#3b82f6';
  });
  if (!slowActive) throw new Error('Slow speed button style not set to active highlight');

  await page.click('#ra-speed-100');
  await page.waitForTimeout(200);
  const normalActive = await page.evaluate(() => {
    const btn = document.getElementById('ra-speed-100');
    return btn.style.background === 'rgb(59, 130, 246)' || btn.style.background === '#3b82f6';
  });
  if (!normalActive) throw new Error('Normal speed button style not set to active highlight');

  // 2. Prompt Guides (Chunking & Linking)
  console.log('Verifying Chunking toggle prompt guide highlights...');
  await page.click('#ra-toggle-chunking-btn');
  await page.waitForTimeout(300);
  const chunkMarkersExist = await page.evaluate(() => {
    return document.querySelectorAll('.ra-chunk-marker').length > 0;
  });
  if (!chunkMarkersExist) throw new Error('No chunking markers rendered after enabling Chunking');

  await page.click('#ra-toggle-chunking-btn');
  await page.waitForTimeout(300);
  const chunkMarkersCleared = await page.evaluate(() => {
    return document.querySelectorAll('.ra-chunk-marker').length === 0;
  });
  if (!chunkMarkersCleared) throw new Error('Chunking markers not cleared after disabling Chunking');

  console.log('Verifying Connected Speech/Linking toggle highlights...');
  await page.click('#ra-toggle-linking-btn');
  await page.waitForTimeout(300);
  const linkingRendered = await page.evaluate(() => {
    const overlay = document.getElementById('ra-linking-overlay');
    const isOverlayActive = overlay && getComputedStyle(overlay).display !== 'none';
    const linkWords = document.querySelectorAll('.ra-link-word').length > 0;
    return isOverlayActive || linkWords;
  });
  if (!linkingRendered) throw new Error('Linking overlay or words not rendered after enabling Connected Speech');

  await page.click('#ra-toggle-connected-off-btn');
  await page.waitForTimeout(300);
  const linkingCleared = await page.evaluate(() => {
    const overlay = document.getElementById('ra-linking-overlay');
    const isOverlayHidden = !overlay || getComputedStyle(overlay).display === 'none' || overlay.innerHTML === '';
    const linkWords = document.querySelectorAll('.ra-link-word').length === 0;
    return isOverlayHidden && linkWords;
  });
  if (!linkingCleared) throw new Error('Linking decorations not cleared after disabling Connected Speech');

  // 3. Question Picker drawer
  console.log('Verifying V7 Question Picker drawer...');
  const pickerClosed = await page.evaluate(() => {
    const sheet = document.getElementById('ra-v7-sheet');
    return !sheet || !sheet.classList.contains('is-open');
  });
  if (!pickerClosed) throw new Error('V7 sheet is unexpectedly open initially');

  await page.click('#ra-v7-question-pill');
  await page.waitForTimeout(300);
  const pickerOpened = await page.evaluate(() => {
    const sheet = document.getElementById('ra-v7-sheet');
    return sheet && sheet.classList.contains('is-open');
  });
  if (!pickerOpened) throw new Error('V7 sheet did not open when clicking question pill');

  console.log('Searching in V7 Question Picker...');
  await page.fill('#ra-v7-jump-search', '12');
  await page.waitForTimeout(300);
  const hasSearchResults = await page.evaluate(() => {
    const list = document.getElementById('ra-v7-jump-list');
    return list && list.querySelectorAll('button').length > 0;
  });
  if (!hasSearchResults) throw new Error('No items matched search query "12" in jump list');

  await page.click('#ra-v7-sheet-close');
  await page.waitForTimeout(300);
  const pickerClosedAfterClose = await page.evaluate(() => {
    const sheet = document.getElementById('ra-v7-sheet');
    return !sheet || !sheet.classList.contains('is-open');
  });
  if (!pickerClosedAfterClose) throw new Error('V7 sheet stayed open after clicking close button');

  console.log('--- UI/UX Interactive Flow Verification Passed ---');
}

