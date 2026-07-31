/**
 * Speech Coach Feedback UI Bugfixes Browser Check
 * Tests all 5 user points:
 * 1. Accordion down arrows expand reduced words cards without double-toggling
 * 2. Single word titles like "have" display full text without "h.." truncation
 * 3. Successful links section displays expandable cards with reasons for success and coaching tips
 * 4. Clicking ? / ⓘ info icons opens educational Speech Coach info modals
 * 5. Clicking Linking vs Linking + Reduced Words tabs filters sections and updates grid layout
 */
const { chromium } = require('playwright');
const express = require('express');
const path = require('path');

(async () => {
  const app = express();
  app.use(express.static(path.join(__dirname, '../../public')));
  const server = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`Test server running on ${baseUrl}`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  page.on('console', msg => {
    if (msg.type() === 'error') console.log('PAGE ERROR:', msg.text());
  });

  await page.addInitScript(() => {
    sessionStorage.setItem('onboarding_complete', 'true');
    sessionStorage.setItem('user_scope', 'pte');
  });

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);

  // Initialize Read Aloud mode instance
  await page.evaluate(() => {
    if (typeof switchToMode === 'function') switchToMode('read-aloud');
    else if (typeof window.switchToMode === 'function') window.switchToMode('read-aloud');
  });
  await page.waitForTimeout(2000);

  // Trigger renderConnectedSpeechResults with test events
  const testResults = await page.evaluate(async () => {
    const raMode = window.ReadAloudMode || window.currentPracticeModeInstance;
    if (!raMode || typeof raMode.renderConnectedSpeechResults !== 'function') {
      return { error: 'ReadAloudMode instance not found' };
    }

    const mockData = {
      status: 'available',
      summary: { detectedCount: 3, notDetectedCount: 1, uncertainCount: 0 },
      events: [
        {
          phrase: 'and',
          category: 'weak_forms',
          status: 'detected',
          startMs: 1200,
          endMs: 1450,
          feedbackText: 'Good weak form /ən/'
        },
        {
          phrase: 'and',
          category: 'weak_forms',
          status: 'not_detected',
          startMs: 4200,
          endMs: 4550,
          feedbackText: 'Strong form used instead of weak form'
        },
        {
          phrase: 'have',
          category: 'weak_forms',
          status: 'not_detected',
          startMs: 9340,
          endMs: 9600,
          feedbackText: 'Strong pronunciation /hæv/ used'
        },
        {
          phrase: 'Pancreatic cancer',
          category: 'linking',
          status: 'detected',
          startMs: 1420,
          endMs: 1890,
          feedbackText: 'Smooth C-V transition'
        },
        {
          phrase: 'cancer is',
          category: 'consonant_to_vowel',
          status: 'detected',
          startMs: 2280,
          endMs: 2600,
          feedbackText: 'Linked /r/ to /ɪ/'
        },
        {
          phrase: 'about the',
          category: 'linking',
          status: 'not_detected',
          startMs: 16320,
          endMs: 16800,
          feedbackText: 'Unnatural pause of 320ms detected'
        }
      ]
    };

    await raMode.renderConnectedSpeechResults(mockData, {
      transcriptText: 'Pancreatic cancer is tricky to manage because it spreads easily and early, and the tumors have a unique biological makeup.',
      sessionViewMode: 'advanced'
    });

    const checks = {};

    // Check 1: Single word "have" title is not truncated to "h.."
    const haveTitleEl = Array.from(document.querySelectorAll('.sc-word-title')).find(el => el.textContent.trim() === 'have');
    checks.haveTitleExists = !!haveTitleEl;
    checks.haveTitleText = haveTitleEl ? haveTitleEl.textContent.trim() : null;

    // Check 2: Accordion toggle functionality on "and" multiple card
    const toggleBtn = document.querySelector('[data-sc-accordion-toggle="sc-accordion-red-0"]');
    checks.accordionToggleExists = !!toggleBtn;
    if (toggleBtn) {
      toggleBtn.click();
      const contentEl = document.getElementById('sc-accordion-red-0');
      checks.accordionExpandedOnClick = toggleBtn.getAttribute('aria-expanded') === 'true' && contentEl && !contentEl.hidden;
    }

    // Check 3: Successful links expandable cards
    const successCardToggle = document.querySelector('[data-sc-accordion-toggle="sc-success-acc-0"]');
    checks.successCardExists = !!successCardToggle;
    if (successCardToggle) {
      successCardToggle.click();
      const successContent = document.getElementById('sc-success-acc-0');
      checks.successCardExpanded = successCardToggle.getAttribute('aria-expanded') === 'true' && successContent && !successContent.hidden;
      checks.successReasonTextPresent = successContent ? successContent.textContent.includes('Seamless Link') || successContent.textContent.includes('Why you nailed it') : false;
    }

    // Check 4: Info tip ? / ⓘ button click opens modal
    const infoTip = document.querySelector('.sc-info-tip[data-sc-info="reduced"]');
    checks.infoTipExists = !!infoTip;
    if (infoTip) {
      infoTip.click();
      const modal = document.getElementById('sc-info-modal-overlay');
      checks.infoModalOpens = modal && getComputedStyle(modal).display !== 'none';
      checks.infoModalTitle = modal ? modal.querySelector('h3')?.textContent : null;
      // Close modal
      document.getElementById('sc-info-modal-close')?.click();
    }

    // Check 5: Layer tabs filter switching
    const linkingTab = document.getElementById('ra-layer-level1');
    const allTab = document.getElementById('ra-layer-level2');
    checks.linkingTabExists = !!linkingTab;
    checks.allTabExists = !!allTab;

    if (linkingTab) {
      linkingTab.click();
      const leftCol = document.querySelector('#ra-connected-speech-list .sc-grid-left');
      checks.leftColHiddenOnLinkingOnly = leftCol && getComputedStyle(leftCol).display === 'none';

      allTab.click();
      checks.leftColRestoredOnAll = leftCol && getComputedStyle(leftCol).display !== 'none';
    }

    return checks;
  });

  console.log('Test Results:', JSON.stringify(testResults, null, 2));

  await browser.close();
  server.close();

  const failed = Object.entries(testResults).filter(([k, v]) => v === false || v === null);
  if (failed.length === 0 && !testResults.error) {
    console.log('✅ ALL SPEECH COACH FEEDBACK CHECKS PASSED SUCCESSFULLY!');
    process.exit(0);
  } else {
    console.error('❌ SOME CHECKS FAILED:', failed);
    process.exit(1);
  }
})();
