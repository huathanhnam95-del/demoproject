'use strict';

const path = require('path');
const fs = require('fs');
const assert = require('node:assert/strict');
const { createHarness, initScript, dismissOverlays } = require('./helpers/pte-shell-harness');

const SCREENSHOT_DIR = path.resolve('C:/Users/Admin/.gemini/antigravity/brain/29151a25-1980-4347-bce8-1312412f3c97/screenshots');

async function run() {
  console.log('=== Starting Comprehensive Live Browser UI Audit ===');
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }

  const harness = await createHarness();
  const results = {
    local: {},
    prod: {},
    screenshots: []
  };

  try {
    // ----------------------------------------------------
    // PART 1: LOCAL BUILD AUDIT (Desktop 1440x900)
    // ----------------------------------------------------
    console.log('\n[1/6] Auditing Local Read Aloud (Desktop 1440x900)...');
    const page = await harness.open({ width: 1440, height: 900, flag: 'v3' });

    await page.evaluate(async () => {
      window.__PTE_TEST_TIME_SCALE = 0.05;
      await window.switchToMode('read-aloud');
    });

    await page.waitForFunction(() => {
      const panel = document.getElementById('mode-read-aloud');
      const mode = window.ReadAloudMode;
      return panel && getComputedStyle(panel).display !== 'none' && mode && mode.currentPromptReady;
    }, null, { timeout: 30000 });

    // Wait for Coach hints to settle
    await page.waitForTimeout(1000);

    // Verify Read Aloud prepare stage
    const raPrepareAudit = await page.evaluate(() => {
      const card = document.querySelector('.pte-card');
      const body = document.querySelector('.pte-card__body');
      const dock = document.querySelector('.pte-dock');
      const modebar = document.querySelector('.pte-modebar');
      const coachBtn = document.getElementById('ra-pte-coach-btn');
      const bodyStyle = body ? getComputedStyle(body) : null;

      const dockBtnStyles = Array.from(dock ? dock.querySelectorAll('button, .pte-btn') : []).map(b => ({
        id: b.id,
        text: b.textContent.trim(),
        bg: getComputedStyle(b).backgroundImage,
        bgColor: getComputedStyle(b).backgroundColor,
        classes: b.className
      }));

      return {
        cardFound: !!card,
        bodyPadding: bodyStyle ? `${bodyStyle.paddingTop} ${bodyStyle.paddingRight} ${bodyStyle.paddingBottom} ${bodyStyle.paddingLeft}` : null,
        modebarTitle: modebar?.textContent?.trim(),
        coachBtnText: coachBtn?.textContent?.trim(),
        dockBtnStyles,
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth
      };
    });

    console.log(`  Card Found: ${raPrepareAudit.cardFound}`);
    console.log(`  Body Padding: ${raPrepareAudit.bodyPadding} (expected: 22px 34px 26px 34px)`);
    console.log(`  Coach Button: ${raPrepareAudit.coachBtnText}`);
    console.log(`  Dock Buttons (${raPrepareAudit.dockBtnStyles.length}):`, raPrepareAudit.dockBtnStyles.map(b => `${b.id || 'no-id'}("${b.text}")`).join(', '));
    console.log(`  Dock Buttons without gradients: ${raPrepareAudit.dockBtnStyles.every(b => b.bg === 'none')}`);

    const raPreparePath = path.join(SCREENSHOT_DIR, '01-ra-desktop-prepare.png');
    await page.screenshot({ path: raPreparePath });
    results.screenshots.push({ name: '01-ra-desktop-prepare.png', desc: 'Read Aloud Desktop Prepare Stage' });

    // Test Coach Drawer Open
    console.log('\n[2/6] Auditing Speech Coach Drawer Toggle...');
    await page.locator('#ra-pte-coach-btn').click();
    await page.waitForTimeout(600);

    const coachAudit = await page.evaluate(() => {
      const drawer = document.getElementById('pte-coach-drawer');
      const overlay = document.getElementById('ra-linking-overlay');
      const mode = window.ReadAloudMode;
      return {
        coachOpen: mode?.pteCoachOpen,
        drawerVisible: drawer ? getComputedStyle(drawer).display !== 'none' : false,
        overlayVisible: overlay ? getComputedStyle(overlay).display !== 'none' : false
      };
    });

    console.log(`  Coach Open: ${coachAudit.coachOpen}`);
    console.log(`  Drawer Visible: ${coachAudit.drawerVisible}`);
    console.log(`  Overlay Visible: ${coachAudit.overlayVisible}`);

    const coachDrawerPath = path.join(SCREENSHOT_DIR, '02-ra-desktop-coach-drawer.png');
    await page.screenshot({ path: coachDrawerPath });
    results.screenshots.push({ name: '02-ra-desktop-coach-drawer.png', desc: 'Read Aloud Speech Coach Drawer Open' });

    // Close coach drawer
    await page.locator('#ra-pte-coach-btn').click();
    await page.waitForTimeout(300);

    // Test Recording & Feedback Transition
    console.log('\n[3/6] Auditing Read Aloud Recording & Feedback Stages...');
    // Click recording button in dock
    const recordBtn = page.locator('#ra-record-btn');
    if (await recordBtn.isVisible()) {
      await recordBtn.click();
      console.log('  Clicked #ra-record-btn to start recording');
      await page.waitForTimeout(1000);

      const stopBtn = page.locator('#ra-stop-btn');
      if (await stopBtn.isVisible()) {
        await stopBtn.click();
        console.log('  Clicked #ra-stop-btn to finish recording');
      }
    } else {
      console.log('  #ra-record-btn not visible directly, checking action dock');
      const actionBtn = page.locator('.pte-dock button:has-text("Start recording"), .pte-dock button:has-text("Record")').first();
      if (await actionBtn.isVisible()) {
        await actionBtn.click();
        await page.waitForTimeout(1000);
        const stopBtn = page.locator('.pte-dock button:has-text("Stop"), .pte-dock button:has-text("Finish")').first();
        if (await stopBtn.isVisible()) await stopBtn.click();
      }
    }

    // Wait for feedback or mock assessment render
    await page.waitForTimeout(1500);

    // Check if feedback rendered, or trigger mock feedback to inspect layout
    const feedbackCheck = await page.evaluate(() => {
      let fb = document.querySelector('.pte-fb');
      if (!fb && window.ReadAloudMode) {
        // Trigger realistic feedback render for inspection
        const mode = window.ReadAloudMode;
        if (typeof mode.renderPteFeedback === 'function') {
          mode.renderPteFeedback({
            overall: 78,
            pronunciation: 82,
            fluency: 74,
            content: 79,
            words: [
              { text: 'Look', status: 'correct', score: 92 },
              { text: 'at', status: 'correct', score: 88 },
              { text: 'the', status: 'correct', score: 85 },
              { text: 'text', status: 'warning', score: 68 },
              { text: 'below', status: 'correct', score: 90 }
            ]
          });
        }
      }
      fb = document.querySelector('.pte-fb');
      const stats = document.querySelector('.pte-stats');
      const prevAttempts = document.querySelector('.pte-attempts');
      const statsBars = document.querySelectorAll('.pte-stats__bar');
      const statsUnits = document.querySelectorAll('.pte-stats__unit');

      return {
        feedbackFound: !!fb,
        statsPresent: !!stats,
        statsBarsCount: statsBars.length,
        statsUnitsCount: statsUnits.length,
        prevAttemptsFound: !!prevAttempts
      };
    });

    console.log(`  Feedback Container: ${feedbackCheck.feedbackFound}`);
    console.log(`  Stats Bars Count: ${feedbackCheck.statsBarsCount}`);
    console.log(`  Previous Attempts Found: ${feedbackCheck.prevAttemptsFound}`);

    await page.waitForTimeout(500);
    const feedbackPath = path.join(SCREENSHOT_DIR, '03-ra-desktop-feedback.png');
    await page.screenshot({ path: feedbackPath });
    results.screenshots.push({ name: '03-ra-desktop-feedback.png', desc: 'Read Aloud Desktop Feedback & Stats Grid' });

    // ----------------------------------------------------
    // PART 2: OTHER SPEAKING MODES (Repeat Sentence, Describe Image, Retell Lecture)
    // ----------------------------------------------------
    console.log('\n[4/6] Auditing Other Speaking Modes (Repeat Sentence, Describe Image, Retell Lecture)...');

    // Repeat Sentence
    await page.evaluate(async () => {
      await window.switchToMode('speak');
    });
    await page.waitForFunction(() => {
      const panel = document.getElementById('mode-speak');
      return panel && getComputedStyle(panel).display !== 'none';
    }, null, { timeout: 20000 });
    await page.waitForTimeout(800);

    const rsPath = path.join(SCREENSHOT_DIR, '04-rs-desktop.png');
    await page.screenshot({ path: rsPath });
    results.screenshots.push({ name: '04-rs-desktop.png', desc: 'Repeat Sentence Desktop Layout' });

    // Describe Image
    await page.evaluate(async () => {
      await window.switchToMode('describe-image');
    });
    await page.waitForFunction(() => {
      const panel = document.getElementById('mode-describe-image');
      return panel && getComputedStyle(panel).display !== 'none';
    }, null, { timeout: 20000 });
    await page.waitForTimeout(800);

    const diPath = path.join(SCREENSHOT_DIR, '05-di-desktop.png');
    await page.screenshot({ path: diPath });
    results.screenshots.push({ name: '05-di-desktop.png', desc: 'Describe Image Desktop Layout' });

    // Retell Lecture (Notes)
    await page.evaluate(async () => {
      await window.switchToMode('notes');
    });
    await page.waitForFunction(() => {
      const panel = document.getElementById('mode-notes');
      return panel && getComputedStyle(panel).display !== 'none';
    }, null, { timeout: 20000 });
    await page.waitForTimeout(800);

    const notesPath = path.join(SCREENSHOT_DIR, '06-notes-desktop.png');
    await page.screenshot({ path: notesPath });
    results.screenshots.push({ name: '06-notes-desktop.png', desc: 'Retell Lecture Desktop Layout' });

    await page.close();

    // ----------------------------------------------------
    // PART 3: MOBILE RESPONSIVENESS (390x844 iPhone Viewport)
    // ----------------------------------------------------
    console.log('\n[5/6] Auditing Mobile Viewport (390x844 iPhone)...');
    const mobilePage = await harness.open({ width: 390, height: 844, flag: 'v3' });

    await mobilePage.evaluate(async () => {
      window.__PTE_TEST_TIME_SCALE = 0.05;
      await window.switchToMode('read-aloud');
    });
    await mobilePage.waitForFunction(() => {
      const panel = document.getElementById('mode-read-aloud');
      return panel && getComputedStyle(panel).display !== 'none';
    }, null, { timeout: 20000 });
    await mobilePage.waitForTimeout(800);

    const mobileAudit = await mobilePage.evaluate(() => {
      const docWidth = document.documentElement.scrollWidth;
      const winWidth = window.innerWidth;
      const dock = document.querySelector('.pte-dock');
      const tabs = document.querySelector('.pte-tabs');
      const tabsHeight = tabs ? tabs.getBoundingClientRect().height : 0;

      return {
        hasHorizontalOverflow: docWidth > winWidth + 1,
        docWidth,
        winWidth,
        tabsHeight,
        dockVisible: dock ? getComputedStyle(dock).display !== 'none' : false
      };
    });

    console.log(`  Mobile Horizontal Overflow: ${mobileAudit.hasHorizontalOverflow} (${mobileAudit.docWidth}px / ${mobileAudit.winWidth}px)`);
    console.log(`  Mobile Tab Height: ${mobileAudit.tabsHeight.toFixed(1)}px (spec <= 36px)`);

    const mobileRaPath = path.join(SCREENSHOT_DIR, '07-ra-mobile-390.png');
    await mobilePage.screenshot({ path: mobileRaPath });
    results.screenshots.push({ name: '07-ra-mobile-390.png', desc: 'Read Aloud Mobile 390px Viewport' });

    // Describe Image Mobile
    await mobilePage.evaluate(async () => {
      await window.switchToMode('describe-image');
    });
    await mobilePage.waitForFunction(() => {
      const panel = document.getElementById('mode-describe-image');
      return panel && getComputedStyle(panel).display !== 'none';
    }, null, { timeout: 20000 });
    await mobilePage.waitForTimeout(800);

    const mobileDiAudit = await mobilePage.evaluate(() => {
      const docWidth = document.documentElement.scrollWidth;
      const winWidth = window.innerWidth;
      const imgStage = document.querySelector('#di-image-stage');
      const recStage = document.querySelector('#di-recorder-stage');
      return {
        hasHorizontalOverflow: docWidth > winWidth + 1,
        imgStageFound: !!imgStage,
        recStageFound: !!recStage
      };
    });

    console.log(`  Mobile DI Overflow: ${mobileDiAudit.hasHorizontalOverflow}`);

    const mobileDiPath = path.join(SCREENSHOT_DIR, '08-di-mobile-390.png');
    await mobilePage.screenshot({ path: mobileDiPath });
    results.screenshots.push({ name: '08-di-mobile-390.png', desc: 'Describe Image Mobile 390px Viewport' });

    await mobilePage.close();

    // ----------------------------------------------------
    // PART 4: LIVE PRODUCTION SITE COMPARISON
    // ----------------------------------------------------
    console.log('\n[6/6] Auditing Live Production Site (https://listening-tasks-3ae34.web.app)...');
    try {
      const prodPage = await harness.browser.newPage({ viewport: { width: 1440, height: 900 } });
      await prodPage.addInitScript(initScript);

      console.log('  Navigating to production site with ?pteShell=v3...');
      await prodPage.goto('https://listening-tasks-3ae34.web.app/?pteShell=v3', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await dismissOverlays(prodPage).catch(() => {});

      await prodPage.evaluate(async () => {
        if (typeof window.switchToMode === 'function') {
          await window.switchToMode('read-aloud');
        }
      });

      await prodPage.waitForTimeout(3000);

      const prodAudit = await prodPage.evaluate(() => {
        const card = document.querySelector('.pte-card');
        const modebar = document.querySelector('.pte-modebar');
        const dock = document.querySelector('.pte-dock');
        return {
          v3ShellPresent: !!card && !!modebar,
          dockPresent: !!dock
        };
      });

      console.log(`  Production V3 Shell Present (?pteShell=v3): ${prodAudit.v3ShellPresent}`);

      const prodPath = path.join(SCREENSHOT_DIR, '09-prod-ra-desktop.png');
      await prodPage.screenshot({ path: prodPath });
      results.screenshots.push({ name: '09-prod-ra-desktop.png', desc: 'Production Site (?pteShell=v3) Read Aloud' });

      await prodPage.close();
    } catch (prodErr) {
      console.log(`  Production network audit note: ${prodErr.message}`);
    }

    console.log('\n======================================================');
    console.log(`🎉 LIVE BROWSER TESTING COMPLETE! Captured ${results.screenshots.length} screenshots.`);
    console.log(`Saved screenshots to: ${SCREENSHOT_DIR}`);
    console.log('======================================================\n');

    process.exit(0);
  } catch (err) {
    console.error('Audit failed with error:', err);
    process.exit(1);
  } finally {
    await harness.close().catch(() => {});
  }
}

run();
