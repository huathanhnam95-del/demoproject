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
        let mockUser = null;
        let authCallback = null;
        export const getAuth = () => ({ 
          get currentUser() { return mockUser; }
        });
        export const connectAuthEmulator = () => {};
        export const onAuthStateChanged = (auth, cb) => { 
          authCallback = cb;
          setTimeout(() => cb(mockUser), 10); 
          return () => {}; 
        };
        export const setPersistence = () => Promise.resolve();
        export const browserLocalPersistence = 'local';
        export const signInWithEmailAndPassword = () => Promise.resolve({ user: {} });
        export const signOut = () => Promise.resolve();
        export const createUserWithEmailAndPassword = () => Promise.resolve({ user: {} });
        export const sendPasswordResetEmail = () => Promise.resolve();
        export const sendEmailVerification = () => Promise.resolve();
        window.__setMockUser = (user) => {
          mockUser = user ? {
            getIdToken: () => Promise.resolve('mock-token-123'),
            getIdTokenResult: () => Promise.resolve({ claims: {} }),
            email: user.email,
            uid: user.uid || 'mock-uid-123',
            metadata: {
              lastSignInTime: new Date().toUTCString(),
              creationTime: new Date().toUTCString()
            }
          } : null;
          if (window.firebase && typeof window.firebase.auth === 'function') {
            try {
              const compatAuth = window.firebase.auth();
              Object.defineProperty(compatAuth, 'currentUser', {
                get: () => mockUser,
                configurable: true
              });
            } catch (e) {
              console.error('Failed to sync mockUser to global firebase:', e);
            }
          }
          if (authCallback) authCallback(mockUser);
        };
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
        export const onSnapshot = (queryRef, onNext) => {
          onNext?.({ empty: true, docs: [] });
          return () => {};
        };
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

  let explainOrderApiFail = false;
  await context.route('**/api/rop/explain-order', async (route) => {
    // Delay slightly to test the spinner
    await new Promise((resolve) => setTimeout(resolve, 2000));
    if (explainOrderApiFail) {
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          message: 'Internal Server Error from Mock API'
        })
      });
    } else {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            critique: 'This is a mock sequence critique.'
          }
        })
      });
    }
  });

  const page = await context.newPage();
  
  await page.addInitScript(() => {
    window.__DISABLE_FIREBASE_EMULATORS__ = true;
    window.sessionStorage.setItem('guestMode', 'true');
    localStorage.setItem('practiceScope', 'pte');
  });

  const errors = [];
  const optionalBackendNoise = /CORS policy|praat-api|Error fetching word data|Failed to fetch/i;
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (msg) => {
    console.log('PAGE LOG:', msg.text());
    if (msg.type() === 'error') {
      const text = msg.text();
      if (!text.includes('Failed to load resource') && !optionalBackendNoise.test(text)) {
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

    const ropLayout = await page.locator('.rop-container').evaluate((element) => ({
      containerWidth: getComputedStyle(element).maxWidth,
      cardBackground: getComputedStyle(element.querySelector('.rop-workspace-card')).backgroundColor,
      cardBorder: getComputedStyle(element.querySelector('.rop-workspace-card')).borderTopWidth
    }));
    assert.equal(ropLayout.containerWidth, '1200px', 'ROP container should retain the shared max width');
    assert.equal(ropLayout.cardBackground, 'rgba(0, 0, 0, 0)', 'ROP workspace cards should remain flat');
    assert.equal(ropLayout.cardBorder, '0px', 'ROP workspace cards should not regain card borders');

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

    // --- PHASE 2: Cohesion Feedback and AI Critique (E2E Test) ---
    console.log('Starting E2E tests for Cohesion Feedback and AI Critique...');

    // 1. Mock Firebase Auth so currentUser returns a mock logged-in user
    console.log('Logging in mock user...');
    await page.evaluate(() => {
      window.__setMockUser({ email: 'admin@test.com' });
    });

    // 2. Navigate to Question #669 (Monarch Butterflies)
    console.log('Navigating to Question #669...');
    await page.click('#rop-v7-question-pill');
    await page.waitForSelector('#rop-v7-sheet', { state: 'visible', timeout: 5000 });
    await page.fill('#rop-v7-jump-search', '669');
    await page.click('#rop-v7-jump-list .ra-v7-list-item');
    
    // Wait for the new question to render (we know it's Monarch Butterflies because it has 4 paragraphs)
    await page.waitForFunction(() => {
      const pill = document.getElementById('rop-v7-question-pill');
      return pill && pill.textContent.includes('669');
    }, { timeout: 10000 });

    const monarchSourceCount = await page.locator('#rop-source-list .rop-item').count();
    assert.equal(monarchSourceCount, 4, 'Expected Monarch Butterflies to have 4 paragraphs');

    // 3. Submit a wrong order (specifically 2, 1, 3, 4)
    console.log('Submitting wrong sequence: 2, 1, 3, 4...');
    // We click and move item with data-original-index="2"
    await page.locator('#rop-source-list .rop-item[data-original-index="2"]').click();
    await moveRightBtn.click();
    // Then 1
    await page.locator('#rop-source-list .rop-item[data-original-index="1"]').click();
    await moveRightBtn.click();
    // Then 3
    await page.locator('#rop-source-list .rop-item[data-original-index="3"]').click();
    await moveRightBtn.click();
    // Then 4
    await page.locator('#rop-source-list .rop-item[data-original-index="4"]').click();
    await moveRightBtn.click();

    // Verify all 4 moved to target list
    const monarchTargetCount = await page.locator('#rop-target-list .rop-item').count();
    assert.equal(monarchTargetCount, 4, 'All items should be in target list');

    // Submit
    const monarchSubmitBtn = page.locator('#rop-submit-btn');
    await monarchSubmitBtn.click();

    // Wait for result box
    await page.waitForFunction(() => {
      const box = document.getElementById('rop-result-box');
      return box && getComputedStyle(box).display !== 'none';
    }, { timeout: 5000 });

    // Verify score is 1/3 (max is 3 transitions)
    const monarchScoreText = await page.locator('#rop-result-box .rop-score-display').textContent();
    assert(monarchScoreText.includes('1 / 3'), `Score should be 1 / 3, got: ${monarchScoreText}`);

    // Verify pairwise cohesion feedback cards are visible (capped at 4, text escaped)
    const cohesionFeedback = page.locator('#rop-cohesion-feedback');
    await page.waitForSelector('#rop-cohesion-feedback', { state: 'visible', timeout: 5000 });

    const feedbackCards = page.locator('#rop-cohesion-feedback .rop-cohesion-card');
    const cardCount = await feedbackCards.count();
    assert.equal(cardCount, 2, `Expected 2 incorrect pair feedback cards, found: ${cardCount}`);

    const card1Text = await feedbackCards.nth(0).textContent();
    const card2Text = await feedbackCards.nth(1).textContent();
    console.log('Cohesion Card 1 Text:', card1Text);
    console.log('Cohesion Card 2 Text:', card2Text);

    assert(card1Text.includes('Paragraph 1 is the starting paragraph.'), 'Card 1 should advise about start paragraph');
    assert(card2Text.includes('Paragraph 1 should be followed by Paragraph 2.'), 'Card 2 should advise about transition 1-2');

    // 4. Test AI sequence critique success path
    console.log('Testing AI critique success path...');
    const critiqueBtn = page.locator('#rop-critique-btn');
    assert.equal(await critiqueBtn.isVisible(), true, 'AI Critique button should be visible');

    // Click critique button
    await critiqueBtn.click();

    // Assert spinner is visible during mock API delay
    const spinner = page.locator('#rop-critique-spinner');
    await page.waitForSelector('#rop-critique-spinner', { state: 'visible', timeout: 1000 });
    console.log('Critique spinner shown during request.');

    // Wait for response to finish and critique content to display
    const critiqueContent = page.locator('#rop-critique-content');
    await page.waitForSelector('#rop-critique-panel', { state: 'visible', timeout: 5000 });

    const critiqueText = await critiqueContent.textContent();
    assert.equal(critiqueText, 'This is a mock sequence critique.', `Unexpected critique text: ${critiqueText}`);
    console.log('AI critique success response rendered correctly.');

    // Spinner should be hidden now
    await page.waitForSelector('#rop-critique-spinner', { state: 'hidden', timeout: 2000 });

    // 5. Test AI sequence critique error path
    console.log('Testing AI critique error path...');
    // Enable API failure mock
    explainOrderApiFail = true;

    // Click critique button again (it should be enabled)
    assert.equal(await critiqueBtn.isEnabled(), true, 'AI Critique button should be enabled');
    await critiqueBtn.click();

    // Assert spinner is visible
    await page.waitForSelector('#rop-critique-spinner', { state: 'visible', timeout: 1000 });

    // Wait for failure response to render the error message
    await page.waitForFunction(() => {
      const content = document.getElementById('rop-critique-content')?.textContent || '';
      return content.includes('Internal Server Error from Mock API');
    }, { timeout: 5000 });

    console.log('AI critique error response handled and displayed correctly.');

    // Spinner should be hidden, critique button re-enabled
    await page.waitForSelector('#rop-critique-spinner', { state: 'hidden', timeout: 2000 });
    assert.equal(await critiqueBtn.isEnabled(), true, 'AI Critique button should be enabled after failure');

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
