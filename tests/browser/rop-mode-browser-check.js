/* eslint-disable no-console */
const assert = require('assert');
const path = require('path');
const net = require('net');
const { chromium } = require('playwright');
const ExcelJS = require('exceljs');

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close(() => {
        if (typeof port === 'number') {
          resolve(port);
          return;
        }
        reject(new Error('Failed to allocate free port'));
      });
    });
    server.on('error', reject);
  });
}

function parseParagraphs(text) {
  if (!text) return [];
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const paragraphs = [];
  for (const line of lines) {
    const match = line.match(/^(\d+)[.)\s]\s*(.*)$/);
    if (match) {
      paragraphs.push({
        originalIndex: parseInt(match[1], 10),
        text: match[2].trim()
      });
    } else {
      paragraphs.push({
        originalIndex: paragraphs.length + 1,
        text: line
      });
    }
  }
  return paragraphs;
}

async function getSmokeQuestion() {
  const xlsxPath = path.join(process.cwd(), 'public', 'database', 'ROP', 'ROP', 'ROP.xlsx');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(xlsxPath);
  const sheet = workbook.worksheets[0];
  
  // Read first data row (row 2)
  const row = sheet.getRow(2);
  const id = row.getCell(1).value;
  const title = row.getCell(2).value;
  const answerText = row.getCell(4).value || row.getCell(3).value; // ENRICHED_ANSWER or ANSWER
  const explanation = row.getCell(5).value;

  const paragraphs = parseParagraphs(answerText);
  assert(paragraphs.length > 0, `Expected paragraphs to be parsed for question ${id}`);

  return {
    id,
    title,
    paragraphs,
    explanation
  };
}

async function setupFirebaseMocks(context) {
  // Mock Firebase App
  await context.route('**/firebase-app.js', (route) => {
    route.fulfill({
      contentType: 'application/javascript',
      body: `
        export const initializeApp = () => ({ name: '[DEFAULT]' });
        export const getApp = () => ({ name: '[DEFAULT]' });
      `
    });
  });

  // Mock Firebase Auth
  await context.route('**/firebase-auth.js', (route) => {
    route.fulfill({
      contentType: 'application/javascript',
      body: `
        export const getAuth = () => ({ currentUser: null });
        export const connectAuthEmulator = () => {};
        export const onAuthStateChanged = (auth, cb) => { 
          setTimeout(() => cb(null), 10); 
          return () => {}; 
        };
        export const setPersistence = () => Promise.resolve();
        export const browserLocalPersistence = 'local';
        export const signInWithEmailAndPassword = () => Promise.resolve({ user: {} });
        export const signOut = () => Promise.resolve();
        export const createUserWithEmailAndPassword = () => Promise.resolve({ user: {} });
        export const sendPasswordResetEmail = () => Promise.resolve();
        export const sendEmailVerification = () => Promise.resolve();
      `
    });
  });

  // Mock Firebase Firestore
  await context.route('**/firebase-firestore.js', (route) => {
    route.fulfill({
      contentType: 'application/javascript',
      body: `
        export const getFirestore = () => ({ _type: 'firestore' });
        export const connectFirestoreEmulator = () => {};
        export const collection = (db, path) => ({ _type: 'collection', path });
        export const doc = (db, path, ...segments) => ({ 
          _type: 'doc', 
          path: [path, ...segments].filter(Boolean).join('/') 
        });
        export const getDoc = async (docRef) => ({ 
          exists: () => false, 
          data: () => ({}) 
        });
        export const getDocs = async (q) => ({ empty: true, docs: [] });
        export const setDoc = async () => {};
        export const updateDoc = async () => {};
        export const deleteDoc = async () => {};
        export const addDoc = async () => ({ id: 'mock-id' });
        export const query = (ref) => ref;
        export const where = () => ({});
        export const limit = () => ({});
        export const orderBy = () => ({});
        export const serverTimestamp = () => new Date();
        export const increment = (v) => v;
        export const arrayUnion = (...v) => v;
        export const arrayRemove = (...v) => v;
        export const Timestamp = { 
          now: () => new Date(), 
          fromDate: (d) => d 
        };
        export const writeBatch = () => ({ 
          set: () => {}, 
          update: () => {}, 
          commit: async () => {} 
        });
        export const runTransaction = async (db, cb) => cb({ 
          get: async () => ({ exists: () => false }), 
          set: () => {}, 
          update: () => {} 
        });
        export const setLogLevel = () => {};
      `
    });
  });

  // Mock Firebase Functions
  await context.route('**/firebase-functions.js', (route) => {
    route.fulfill({
      contentType: 'application/javascript',
      body: `
        export const getFunctions = () => ({});
        export const connectFunctionsEmulator = () => {};
        export const httpsCallable = () => async () => ({ data: {} });
      `
    });
  });
}

(async () => {
  const port = await getFreePort();
  const target = await getSmokeQuestion();
  const baseUrl = `http://127.0.0.1:${port}`;
  
  const express = require('express');
  const http = require('http');
  const publicDir = path.join(process.cwd(), 'public');
  const app = express();
  app.use(express.static(publicDir));
  app.get('/', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(publicDir, 'index.html'));
  });
  
  const server = http.createServer(app);
  await new Promise((resolve) => {
    server.listen(port, '127.0.0.1', resolve);
  });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });

  await setupFirebaseMocks(context);

  const page = await context.newPage();
  
  await page.addInitScript(() => {
    window.__DISABLE_FIREBASE_EMULATORS__ = true;
    window.sessionStorage.setItem('guestMode', 'true');
  });

  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (msg) => {
    console.log('PAGE LOG:', msg.text());
    if (msg.type() === 'error') {
      const text = msg.text();
      if (!text.includes('Failed to load resource')) {
        errors.push(text);
      }
    }
  });

  try {
    // Navigate to page
    await page.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.switchToMode === 'function', { timeout: 30000 });

    // Exercise the learner click path: Reading skill filter -> ROP card.
    const readingSkillButton = page.locator('.practice-skill-btn[data-practice-skill="reading"]');
    await readingSkillButton.click();
    await page.waitForFunction(() => {
      const button = document.querySelector('.practice-skill-btn[data-practice-skill="reading"]');
      const card = document.getElementById('mode-btn-rop');
      return button?.classList.contains('is-active') &&
        card &&
        getComputedStyle(card).display !== 'none';
    }, { timeout: 10000 });

    const ropCard = page.locator('#mode-btn-rop');
    await ropCard.click();
    
    // Wait for container to become active and visible
    await page.waitForFunction(() => {
      const panel = document.getElementById('mode-rop');
      return !!panel && panel.classList.contains('active') && getComputedStyle(panel).display !== 'none';
    }, { timeout: 30000 });

    // Wait for the Excel workbook to be fetched and first question loaded
    await page.waitForFunction(() => {
      const cards = document.querySelectorAll('#rop-source-list .rop-item');
      return cards.length > 0;
    }, { timeout: 30000 });

    // Verify correct question title is shown in question picker pill
    const pillText = await page.locator('#rop-v7-question-pill').textContent();
    assert(pillText.includes(target.title), `Pill text "${pillText}" does not contain expected title "${target.title}"`);

    // Verify all source paragraphs are rendered
    const sourceCount = await page.locator('#rop-source-list .rop-item').count();
    assert.equal(sourceCount, target.paragraphs.length, `Expected ${target.paragraphs.length} paragraphs in source list, found ${sourceCount}`);

    // Click navigation next and check title change
    await page.locator('#rop-v7-next-btn').click();
    await page.waitForFunction((firstTitle) => {
      const pill = document.getElementById('rop-v7-question-pill')?.textContent || '';
      return !pill.includes(firstTitle);
    }, target.title, { timeout: 5000 });

    // Move back
    await page.locator('#rop-v7-prev-btn').click();
    await page.waitForFunction((firstTitle) => {
      const pill = document.getElementById('rop-v7-question-pill')?.textContent || '';
      return pill.includes(firstTitle);
    }, target.title, { timeout: 5000 });

    // Try selection and move controls
    const firstItem = page.locator('#rop-source-list .rop-item').first();
    await firstItem.click();

    // Verify selected class
    const isSelected = await firstItem.evaluate(el => el.classList.contains('is-selected'));
    assert(isSelected, 'First item should have class "is-selected"');

    // Move right button should be enabled
    const moveRightBtn = page.locator('#rop-btn-move-right');
    assert.equal(await moveRightBtn.getAttribute('disabled'), null, 'Move right button should be enabled after selection');

    // Click move right
    await moveRightBtn.click();

    // Check it moved to target list
    const targetCount = await page.locator('#rop-target-list .rop-item').count();
    assert.equal(targetCount, 1, 'Target list should contain exactly 1 item');

    // Select target item
    const targetItem = page.locator('#rop-target-list .rop-item').first();
    await targetItem.click();

    // Move left button should be enabled
    const moveLeftBtn = page.locator('#rop-btn-move-left');
    assert.equal(await moveLeftBtn.getAttribute('disabled'), null, 'Move left button should be enabled after selection in target');

    // Click move left to return it
    await moveLeftBtn.click();
    const sourceCountReturned = await page.locator('#rop-source-list .rop-item').count();
    assert.equal(sourceCountReturned, target.paragraphs.length, 'All items should be back in source list');

    // Now, move all items from source to target to enable submit
    for (let i = 0; i < target.paragraphs.length; i++) {
      const currentFirstItem = page.locator('#rop-source-list .rop-item').first();
      await currentFirstItem.click();
      await moveRightBtn.click();
    }

    // Verify target count is now correct
    const targetCountFull = await page.locator('#rop-target-list .rop-item').count();
    assert.equal(targetCountFull, target.paragraphs.length, 'All items should be in target list');

    // Submit button should be enabled
    const submitBtn = page.locator('#rop-submit-btn');
    assert.equal(await submitBtn.getAttribute('disabled'), null, 'Submit button should be enabled when source list is empty');

    // Click submit
    await submitBtn.click();

    // Result box should be visible
    const resultBox = page.locator('#rop-result-box');
    await page.waitForFunction(() => {
      const box = document.getElementById('rop-result-box');
      return !!box && getComputedStyle(box).display !== 'none';
    }, { timeout: 5000 });

    const resultBoxText = await resultBox.textContent();
    assert(resultBoxText.includes('Score:'), 'Result box should contain score text');

    // Verify visual connectors were rendered between adjacent boxes
    const connectorCount = await page.locator('#rop-target-list .rop-card-connector').count();
    assert.equal(connectorCount, target.paragraphs.length - 1, 'Correct number of visual connectors should be rendered');
    
    // Check first connector class
    const connectorClasses = await page.locator('#rop-target-list .rop-card-connector').first().getAttribute('class');
    assert(connectorClasses.includes('is-correct') || connectorClasses.includes('is-incorrect'), 'Connectors should have correctness classes');

    // Explanation panel toggle should be visible
    const explanationToggle = page.locator('#rop-explanation-toggle');
    assert.equal(await explanationToggle.isVisible(), true, 'Explanation toggle button should be visible');

    // Click explanation toggle
    await explanationToggle.click();

    // Explanation content should display
    const explanationPanel = page.locator('#rop-explanation-panel');
    await page.waitForFunction(() => {
      const panel = document.getElementById('rop-explanation-panel');
      return !!panel && getComputedStyle(panel).display !== 'none';
    }, { timeout: 5000 });

    const explanationContent = await page.locator('#rop-explanation-content').innerHTML();
    assert(explanationContent.length > 50, 'Explanation panel should show content');

    // Verify cohesion highlight hover interaction
    const firstCohesionLink = page.locator('#rop-explanation-content .cohesion-link').first();
    if (await firstCohesionLink.count() > 0) {
      const dataLinkVal = await firstCohesionLink.getAttribute('data-link');
      
      // Hover over the cohesion link
      await firstCohesionLink.hover();
      await page.waitForTimeout(100);
      
      // Verify all spans with the same data-link are highlighted
      const highlightedCount = await page.evaluate((group) => {
        const matching = document.querySelectorAll(`.cohesion-link[data-link="${group}"]`);
        console.log("Matching cohesion-link count for group:", group, matching.length);
        matching.forEach((el, index) => {
          console.log(`Element ${index} tag: ${el.tagName}, class list: ${Array.from(el.classList).join(' ')}, text: ${el.textContent}`);
        });
        return Array.from(matching).every(el => el.classList.contains('cohesion-link-hovered')) ? matching.length : 0;
      }, dataLinkVal);
      
      assert(highlightedCount > 0, 'Matching cohesion links should have cohesion-link-hovered class');
      
      // Move mouse away (unhover) by hovering over the explanation header
      await page.locator('.rop-explanation-header').hover();
      await page.waitForTimeout(100);
      
      // Verify highlights are removed
      const remainingHighlighted = await page.evaluate((group) => {
        return document.querySelectorAll(`.cohesion-link[data-link="${group}"].cohesion-link-hovered`).length;
      }, dataLinkVal);
      
      assert.equal(remainingHighlighted, 0, 'Hover highlights should be cleared on mouseout');
    }

    // Click retry
    const retryBtn = page.locator('#rop-retry-btn');
    await retryBtn.click();

    // Verify states reset
    const finalState = await page.evaluate(() => {
      const sourceCount = document.querySelectorAll('#rop-source-list .rop-item').length;
      const targetCount = document.querySelectorAll('#rop-target-list .rop-item').length;
      const resultBoxDisplay = getComputedStyle(document.getElementById('rop-result-box')).display;
      const explanationDisplay = getComputedStyle(document.getElementById('rop-explanation-panel')).display;
      return {
        sourceCount,
        targetCount,
        resultBoxVisible: resultBoxDisplay !== 'none',
        explanationVisible: explanationDisplay !== 'none'
      };
    });

    assert.equal(finalState.sourceCount, target.paragraphs.length, 'All items should be back in source list after retry');
    assert.equal(finalState.targetCount, 0, 'Target list should be empty after retry');
    assert.equal(finalState.resultBoxVisible, false, 'Result box should be hidden');
    assert.equal(finalState.explanationVisible, false, 'Explanation should be hidden');

    if (errors.length) {
      throw new Error(errors.join('\n'));
    }

    console.log('ROP browser check passed successfully.');
  } catch (err) {
    try {
      const screenshotPath = path.join(process.cwd(), 'rop_screenshot.png');
      await page.screenshot({ path: screenshotPath, fullPage: true });
      console.log(`Saved failure screenshot to: ${screenshotPath}`);
    } catch (ssErr) {
      console.error('Failed to capture screenshot:', ssErr);
    }
    if (errors.length) {
      console.error('Page/Console Errors during run:\n' + errors.join('\n'));
    }
    throw err;
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
