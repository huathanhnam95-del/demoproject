const { chromium } = require('playwright');
const express = require('express');
const path = require('path');

const app = express();
app.use(express.static(path.join(__dirname, '../../public')));

async function runTest() {
  const server = app.listen(0, async () => {
    const port = server.address().port;
    console.log(`Test server running on port ${port}`);

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await page.addInitScript(() => {
        window.localStorage.setItem('userStatus', 'guest');
        window.sessionStorage.setItem('hasSeenWelcomeModal', 'true');
        window.sessionStorage.setItem('hasSeenScopeTutorial', 'true');
        window.localStorage.setItem('hasSeenScopeTutorial', 'true');
      });

      await page.goto(`http://localhost:${port}/`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(500);

      await page.evaluate(async () => {
        await window.switchToMode('speak');
      });
      await page.waitForTimeout(500);

      // Verify Repeat Sentence mode is active
      const isSpeakActive = await page.evaluate(() => {
        const panel = document.getElementById('mode-speak');
        return panel && panel.classList.contains('active');
      });
      console.log('Speak mode active:', isSpeakActive);

      // Helper to read step states
      const getStepStates = async () => {
        return await page.evaluate(() => {
          const stepsNav = document.getElementById('spc-steps-speak');
          if (!stepsNav) return null;
          const items = [...stepsNav.querySelectorAll('.spc-step')];
          return {
            currentIndex: stepsNav.dataset.currentIndex,
            items: items.map(item => ({
              step: item.dataset.spcStep,
              state: item.dataset.state,
              text: item.querySelector('.spc-step__label')?.textContent?.trim()
            }))
          };
        });
      };

      // 1. Check initial step state (should be 0 / Listen)
      const initialState = await getStepStates();
      console.log('Initial step state:', JSON.stringify(initialState));

      if (initialState.currentIndex !== '0' || initialState.items[0].state !== 'current' || initialState.items[1].state !== 'upcoming') {
        throw new Error(`Expected initial step index 0, got ${initialState.currentIndex}`);
      }

      // 2. Simulate complete question flow: Record -> Stop -> Check
      console.log('Simulating recording and checking answer...');
      await page.evaluate(() => {
        const recordBtn = document.getElementById('record-btn');
        const checkBtn = document.getElementById('check-btn-speak');
        if (recordBtn) {
          recordBtn.click(); // Start recording
        }
      });
      await page.waitForTimeout(200);

      await page.evaluate(() => {
        const recordBtn = document.getElementById('record-btn');
        if (recordBtn) {
          recordBtn.click(); // Stop recording
        }
      });
      await page.waitForTimeout(200);

      await page.evaluate(() => {
        const checkBtn = document.getElementById('check-btn-speak');
        if (checkBtn) {
          checkBtn.click(); // Check answer -> transitions to Results step
        }
      });
      await page.waitForTimeout(300);

      const resultsState = await getStepStates();
      console.log('State after Check (Results):', JSON.stringify(resultsState));

      if (resultsState.currentIndex !== '2' || resultsState.items[2].state !== 'current') {
        throw new Error(`Expected step index 2 after Check, got ${resultsState.currentIndex}`);
      }

      // 3. Click Next question button
      console.log('Clicking Next question button...');
      await page.evaluate(() => {
        const nextBtn = document.querySelector('.spc-nav__btn--next') || document.getElementById('next-btn-speak');
        if (nextBtn) nextBtn.click();
      });
      await page.waitForTimeout(500);

      const nextQuestionState = await getStepStates();
      console.log('State after Next Question:', JSON.stringify(nextQuestionState));

      if (nextQuestionState.currentIndex !== '0' || nextQuestionState.items[0].state !== 'current' || nextQuestionState.items[1].state !== 'upcoming' || nextQuestionState.items[2].state !== 'upcoming') {
        throw new Error(`TEST FAILED! After Next Question, expected step index 0 (Listen) with upcoming steps, but got index ${nextQuestionState.currentIndex}: ${JSON.stringify(nextQuestionState)}`);
      }

      console.log('✅ TEST PASSED SUCCESSFUL: Next question properly resets Repeat Sentence 3-step indicator back to Step 1 (Listen)!');

    } catch (err) {
      console.error('❌ Test failed with error:', err);
      process.exitCode = 1;
    } finally {
      await browser.close();
      server.close();
    }
  });
}

runTest();
