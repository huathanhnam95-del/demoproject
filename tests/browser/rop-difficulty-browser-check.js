/* eslint-disable no-console */
const assert = require('assert');
const path = require('path');
const net = require('net');
const { chromium } = require('playwright');

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
        export const getDocs = async (q) => ({ empty: true, docs: [], forEach: () => {} });
        export const onSnapshot = () => () => {};
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
  // Read Excel to build level -> IDs mapping
  const ExcelJS = require('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path.join(__dirname, '../../public/database/ROP/ROP/ROP.xlsx'));
  const sheet = workbook.worksheets[0];
  const levelToIds = { 1: [], 2: [], 3: [] };
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // skip header
    const id = Number(row.getCell(1).value); // ID
    const level = Number(row.getCell(6).value); // LEVEL
    if (id && [1, 2, 3].includes(level)) {
      levelToIds[level].push(id);
    }
  });

  const port = await getFreePort();
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
  
  // Set mocks to bypass onboarding & unlock difficulty filter
  await page.addInitScript(() => {
    window.__DISABLE_FIREBASE_EMULATORS__ = true;
    window.sessionStorage.setItem('guestMode', 'true');
    window.localStorage.setItem('practiceScope', 'pte');
    
    // Set up window.shopModule getter/setter to prevent shop-module.js from overriding the unlock status
    let currentShopModule = {
      isSkillUnlocked: (skill) => {
        return skill === 'difficulty_filter';
      },
      init: () => {},
      refreshUserData: () => Promise.resolve()
    };
    
    Object.defineProperty(window, 'shopModule', {
      get: () => currentShopModule,
      set: (val) => {
        currentShopModule = Object.assign({}, currentShopModule, val, {
          isSkillUnlocked: (skill) => {
            return skill === 'difficulty_filter';
          }
        });
      },
      configurable: true
    });
  });

  const errors = [];
  const isExpectedOptionalError = (text) => {
    return text.includes('praat-api-') ||
      text.includes('WordReferenceService') ||
      text.includes('Access to fetch at') ||
      text.includes('net::ERR_FAILED');
  };
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (msg) => {
    console.log('PAGE LOG:', msg.text());
    if (msg.type() === 'error') {
      const text = msg.text();
      if (!text.includes('Failed to load resource') && !isExpectedOptionalError(text)) {
        errors.push(text);
      }
    }
  });

  try {
    // Navigate to page
    await page.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.switchToMode === 'function', { timeout: 30000 });

    // Navigate to Reading -> ROP Mode
    const readingSkillButton = page.locator('.practice-skill-btn[data-practice-skill="reading"]');
    await readingSkillButton.click();
    await page.waitForFunction(() => {
      const card = document.getElementById('mode-btn-rop');
      return card && getComputedStyle(card).display !== 'none';
    }, { timeout: 10000 });

    const ropCard = page.locator('#mode-btn-rop');
    await ropCard.click();
    
    // Wait for ROP mode container to become active and visible
    await page.waitForFunction(() => {
      const panel = document.getElementById('mode-rop');
      return !!panel && panel.classList.contains('active') && getComputedStyle(panel).display !== 'none';
    }, { timeout: 30000 });

    // Wait for the Excel workbook to be fetched and loaded
    await page.waitForFunction(() => {
      const cards = document.querySelectorAll('#rop-source-list .rop-item');
      return cards.length > 0;
    }, { timeout: 30000 });

    // Verify difficulty container is visible
    const containerSelector = '#difficulty-filter-container-rop';
    await page.waitForSelector(containerSelector, { state: 'visible', timeout: 5000 });
    console.log('Difficulty filter container is visible.');

    // Check default label is 'Recommended'
    const labelSelector = '#difficulty-filter-label-rop';
    const initialLabelText = await page.locator(labelSelector).textContent();
    assert(initialLabelText.includes('Recommended'), `Expected 'Recommended', got '${initialLabelText}'`);

    const filterBtnSelector = '#difficulty-filter-btn-rop';
    const menuSelector = '#difficulty-filter-menu-rop';

    // Loop through levels 1, 2, 3
    const levelsToTest = [1, 2, 3];
    for (const level of levelsToTest) {
      console.log(`Testing Level ${level}...`);

      // Open menu
      await page.click(filterBtnSelector);
      await page.waitForSelector(menuSelector, { state: 'visible', timeout: 5000 });

      // Click the level option
      await page.click(`${menuSelector} .filter-option[data-value="${level}"]`);
      await page.waitForSelector(menuSelector, { state: 'hidden', timeout: 5000 });

      // Verify label text contains correct level name
      const levelNames = { 1: 'Level 1 (Easy)', 2: 'Level 2 (Medium)', 3: 'Level 3 (Hard)' };
      const currentLabel = await page.locator(labelSelector).textContent();
      assert(currentLabel.includes(levelNames[level]), `Expected label to include "${levelNames[level]}", got "${currentLabel}"`);

      // Verify active question pill ID
      const pillText = await page.locator('#rop-v7-question-pill').textContent();
      assert(pillText, 'Question pill should have text');
      const pillMatch = pillText.match(/#(\d+)/);
      assert(pillMatch, `Failed to parse question ID from pill text: "${pillText}"`);
      const pillId = Number(pillMatch[1]);
      assert(levelToIds[level].includes(pillId), `Question ID ${pillId} does not belong to Level ${level}`);
      console.log(`[PASS] Active question #${pillId} is in Level ${level}`);

      // Open jump list
      await page.click('#rop-v7-question-pill');
      const jumpListSelector = '#rop-v7-jump-list';
      await page.waitForSelector(jumpListSelector, { state: 'visible', timeout: 5000 });

      // Retrieve all IDs in the jump list
      const itemTexts = await page.locator(`${jumpListSelector} .ra-v7-list-item .ra-v7-item-id`).allTextContents();
      const count = itemTexts.length;
      assert(count > 0, `Expected jump list items for Level ${level}`);
      for (const itemText of itemTexts) {
        const itemMatch = itemText.match(/#(\d+)/);
        assert(itemMatch, `Failed to parse question ID from jump list item: "${itemText}"`);
        const itemId = Number(itemMatch[1]);
        assert(levelToIds[level].includes(itemId), `Jump list item #${itemId} does not belong to Level ${level}`);
      }
      console.log(`[PASS] All ${count} jump list questions are in Level ${level}`);

      // Close jump list (click close button)
      await page.click('#rop-v7-sheet-close');
      await page.waitForFunction(() => !document.getElementById('rop-v7-sheet').classList.contains('is-open'), { timeout: 5000 });

      // Click "Next" button and verify it stays in same level
      const nextBtn = page.locator('#rop-v7-next-btn');
      const isNextEnabled = await nextBtn.isEnabled();
      if (isNextEnabled) {
        await nextBtn.click();
        
        // Wait for pill to update
        await page.waitForFunction((prevId) => {
          const pill = document.getElementById('rop-v7-question-pill');
          if (!pill) return false;
          const match = pill.textContent.match(/#(\d+)/);
          return match && Number(match[1]) !== prevId;
        }, pillId, { timeout: 5000 });

        const nextPillText = await page.locator('#rop-v7-question-pill').textContent();
        const nextPillMatch = nextPillText.match(/#(\d+)/);
        assert(nextPillMatch, `Failed to parse question ID from next pill text: "${nextPillText}"`);
        const nextPillId = Number(nextPillMatch[1]);
        assert(levelToIds[level].includes(nextPillId), `Next question #${nextPillId} does not belong to Level ${level}`);
        console.log(`[PASS] Next question #${nextPillId} is also in Level ${level}`);
      } else {
        console.log(`[PASS] Next button disabled (only 1 question in this level or reached end)`);
      }
    }

    if (errors.length) {
      throw new Error(errors.join('\n'));
    }

    console.log('ROP difficulty filter browser check passed successfully.');
  } catch (err) {
    try {
      const screenshotPath = path.join(process.cwd(), 'rop_difficulty_screenshot.png');
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
