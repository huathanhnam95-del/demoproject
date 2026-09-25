const { chromium } = require('playwright');
const express = require('express');
const path = require('path');

(async () => {
  const app = express();
  app.use(express.static(path.join(__dirname, '../../public')));
  app.use((req, res) => {
    res.sendFile(path.join(__dirname, '../../public/index.html'));
  });

  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const browser = await chromium.launch({ headless: true });

  const modesToTest = [
    { mode: 'read-aloud', url: '/pte-practice/speaking/read-aloud/353' },
    { mode: 'speak', url: '/pte-practice/speaking/speak/1' },
    { mode: 'type', url: '/pte-practice/listening/type/1' },
    { mode: 'asq', url: '/pte-practice/speaking/asq/1' },
    { mode: 'describe-image', url: '/pte-practice/speaking/describe-image/1' },
    { mode: 'notes', url: '/pte-practice/speaking/notes/1' },
    { mode: 'rts', url: '/pte-practice/speaking/rts/1' },
    { mode: 'sgd', url: '/pte-practice/speaking/sgd/1' }
  ];
  const modesWithoutSettings = new Set(['asq', 'rts']);
  const requestedModes = process.env.SETTINGS_MODE_FILTER
    ? new Set(process.env.SETTINGS_MODE_FILTER.split(',').map((mode) => mode.trim()).filter(Boolean))
    : null;
  const casesToRun = requestedModes
    ? modesToTest.filter(({ mode }) => requestedModes.has(mode))
    : modesToTest;

  const results = {};

  try {
    for (const testCase of casesToRun) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await page.addInitScript(() => {
        window.localStorage.setItem('userStatus', 'guest');
        window.localStorage.setItem('hasSeenScopeTutorial', 'true');
        ['asq', 'describe-image', 'notes', 'read-aloud', 'rts', 'sgd', 'speak', 'type'].forEach((mode) => {
          window.localStorage.setItem(`${mode}ModeFirstUse`, 'true');
        });
      });
      await page.goto(`${baseUrl}/index.html?pteShell=legacy`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => typeof window.switchToMode === 'function', { timeout: 30000 });
      const guestButton = page.locator('#guest-mode-btn');
      if (await guestButton.isVisible().catch(() => false)) await guestButton.click();
      await page.waitForTimeout(1000);
      await page.evaluate((m) => window.switchToMode(m), testCase.mode);
      await page.waitForFunction((m) => {
        const panel = document.getElementById(`mode-${m}`);
        return !!panel
          && getComputedStyle(panel).display !== 'none'
          && !!panel.querySelector('.spc-controller')
          && !document.body.classList.contains('loading-active');
      }, testCase.mode, { timeout: 15000 }).catch(() => {});

      // Check controller
      const controllerExists = await page.evaluate((m) => {
        const panel = document.getElementById(`mode-${m}`);
        return !!(panel && panel.querySelector('.spc-controller'));
      }, testCase.mode);

      // Try clicking Settings button
      const clicked = await page.evaluate(({ m }) => {
        const panel = document.getElementById(`mode-${m}`);
        if (!panel) return false;
        const settingsBtn = panel.querySelector('.spc-settings-btn') || Array.from(panel.querySelectorAll('.spc-view-toggle-btn')).find(b => b.textContent.includes('Settings'));
        if (settingsBtn) {
          const beforeFocus = document.activeElement?.className || document.activeElement?.id || document.activeElement?.tagName || '';
          window.__settingsFocusTarget = settingsBtn;
          const sheet = document.getElementById(`spc-settings-sheet-${m}`);
          const hostedNodes = Array.from(sheet?.querySelectorAll('*') || []);
          const anchors = [];
          const walker = document.createTreeWalker(panel, NodeFilter.SHOW_COMMENT);
          while (walker.nextNode()) {
            if (walker.currentNode.nodeValue.startsWith('spc-settings-anchor:')) {
              anchors.push(walker.currentNode);
            }
          }
          const adoptionAnchors = [];
          const adoptionWalker = document.createTreeWalker(panel, NodeFilter.SHOW_COMMENT);
          while (adoptionWalker.nextNode()) {
            if (adoptionWalker.currentNode.nodeValue.startsWith('spc-anchor:')) {
              adoptionAnchors.push(adoptionWalker.currentNode);
            }
          }
          window.__settingsTrackedNodes = anchors.map((anchor) => {
            const key = anchor.nodeValue.slice('spc-settings-anchor:'.length);
            const element = hostedNodes.find((candidate) => (
              candidate.id === key
              || candidate.className === key
              || (typeof candidate.className === 'string' && candidate.className.split(/\s+/).includes(key))
            ));
            const originalAnchor = adoptionAnchors.find((candidate) => candidate.nodeValue === `spc-anchor:${key}`);
            const placementAnchor = originalAnchor || anchor;
            return element ? {
              element,
              parent: placementAnchor.parentNode,
              nextSibling: placementAnchor.nextSibling,
              anchorKey: key,
              nextAnchorKey: anchor.nextSibling?.nodeType === Node.COMMENT_NODE
                && anchor.nextSibling.nodeValue.startsWith('spc-settings-anchor:')
                ? anchor.nextSibling.nodeValue.slice('spc-settings-anchor:'.length)
                : null
            } : null;
          }).filter(Boolean);
          settingsBtn.focus();
          window.__settingsFocusDebug = {
            beforeFocus,
            afterFocus: document.activeElement === settingsBtn,
            activeBeforeClick: document.activeElement?.className || document.activeElement?.id || document.activeElement?.tagName || '',
            targetRendered: settingsBtn.getClientRects().length > 0 && settingsBtn.offsetParent !== null
          };
          settingsBtn.click();
          return true;
        }
        return false;
      }, { m: testCase.mode });

      await page.waitForTimeout(600);

      // Check if settings sheet opened and validate supported sections.
      const openedDetails = await page.evaluate((m) => {
        const isReadAloud = m === 'read-aloud';
        const sheet = document.getElementById(isReadAloud ? 'ra-settings-sheet' : `spc-settings-sheet-${m}`);
        const active = !!sheet && sheet.classList.contains('is-active');
        if (!sheet) {
          return {
            active,
            difficultySection: false,
            filterSection: false,
            historyTab: false,
            tabsWork: false,
            sectionTitles: [],
            settingsSectionsFlat: true,
            sheetRadius: null,
            bodyBackground: null,
            closeButtonHeight: null
          };
        }

        const textOf = (element) => String(element?.textContent || '').toLowerCase();
        const sections = Array.from(sheet.querySelectorAll('.spc-settings-section'));
        const sectionTitles = sections.map((section) => textOf(section.querySelector('.spc-settings-section-title') || section));
        const difficultySection = sectionTitles.some((title) => title.includes('difficulty engine'));
        const filterSection = sectionTitles.some((title) => title.includes('question filters'));
        const historyTab = !!sheet.querySelector('[data-tab="history"]');
        const settingsSectionsFlat = sections.every((section) => {
          const sectionStyle = getComputedStyle(section);
          return sectionStyle.backgroundColor === 'rgba(0, 0, 0, 0)'
            && sectionStyle.boxShadow === 'none'
            && sectionStyle.borderTopWidth === '0px';
        });
        let tabsWork = isReadAloud || !historyTab;
        const targetTab = sheet.querySelector('[data-tab="difficulty-target"]');
        const historyTabButton = sheet.querySelector('[data-tab="history"]');
        const targetPanel = sheet.querySelector('.spc-sheet-tab-panel[data-tab="difficulty-target"]');
        const historyPanel = sheet.querySelector('.spc-sheet-tab-panel[data-tab="history"]');
        if (historyTabButton && historyPanel && targetTab && targetPanel) {
          historyTabButton.click();
          const historyActivated = historyPanel.classList.contains('active') && !targetPanel.classList.contains('active');
          targetTab.click();
          const targetRestored = targetPanel.classList.contains('active') && !historyPanel.classList.contains('active');
          tabsWork = historyActivated && targetRestored;
        }

        const style = getComputedStyle(sheet);
        const closeButton = sheet.querySelector('.spc-sheet-close');
        return {
          active,
          difficultySection,
          filterSection,
          historyTab,
          tabsWork,
          sectionTitles,
          settingsSectionsFlat,
          sheetRadius: style.borderTopLeftRadius,
          bodyBackground: getComputedStyle(sheet.querySelector('.spc-sheet-body') || sheet).backgroundColor,
          closeButtonHeight: closeButton ? getComputedStyle(closeButton).height : null
        };
      }, testCase.mode);

      const sheetOpened = openedDetails.active;
      const focusDebug = await page.evaluate(() => window.__settingsFocusDebug || null);

      // Escape closes the sheet and returns focus to the Settings trigger when
      // the trigger can receive focus. Hidden no-toggle triggers still get
      // close and duplicate-ID coverage.
      await page.keyboard.press('Escape');
      await page.waitForTimeout(100);
      const afterEscape = await page.evaluate((m) => {
        const isReadAloud = m === 'read-aloud';
        const id = isReadAloud ? 'ra-settings-sheet' : `spc-settings-sheet-${m}`;
        const sheet = document.getElementById(id);
        const focusTarget = window.__settingsFocusTarget;
        const targetCanFocus = !!focusTarget
          && !focusTarget.disabled
          && focusTarget.getClientRects().length > 0
          && focusTarget.offsetParent !== null
          && getComputedStyle(focusTarget).display !== 'none'
          && getComputedStyle(focusTarget).visibility !== 'hidden';
          return {
            closed: !sheet || !sheet.classList.contains('is-active'),
            focusRestored: !targetCanFocus || document.activeElement === focusTarget,
            focusTargetDisabled: !!focusTarget?.disabled,
            focusTargetId: focusTarget?.className || '',
            activeElement: document.activeElement?.className || document.activeElement?.id || '',
            duplicateSheetIds: document.querySelectorAll(`#${id}`).length === 1
        };
      }, testCase.mode);

      // Reopen and exercise the explicit close button as well.
      await page.evaluate((m) => {
        const panel = document.getElementById(`mode-${m}`);
        const settingsBtn = panel?.querySelector('.spc-settings-btn') || Array.from(panel?.querySelectorAll('.spc-view-toggle-btn') || []).find(b => b.textContent.includes('Settings'));
        settingsBtn?.focus();
        settingsBtn?.click();
      }, testCase.mode);
      await page.waitForTimeout(150);
      await page.evaluate((m) => {
        const sheet = document.getElementById(m === 'read-aloud' ? 'ra-settings-sheet' : `spc-settings-sheet-${m}`);
        sheet?.querySelector('.spc-sheet-close')?.click();
      }, testCase.mode);
      await page.waitForTimeout(100);

      const afterClose = await page.evaluate((m) => {
        const id = m === 'read-aloud' ? 'ra-settings-sheet' : `spc-settings-sheet-${m}`;
        const sheet = document.getElementById(id);
        return {
          closed: !sheet || !sheet.classList.contains('is-active'),
          duplicateSheetIds: document.querySelectorAll(`#${id}`).length === 1
        };
      }, testCase.mode);

      let restoration = { restoredAfterUnmount: true, remountClean: true };
      if (testCase.mode !== 'read-aloud' && !modesWithoutSettings.has(testCase.mode)) {
        restoration = await page.evaluate(async (m) => {
          const SPC = window.SpeakingPracticeController;
          const tracked = window.__settingsTrackedNodes || [];
          SPC.unmount(m);
          const parentFailures = tracked
            .filter((record) => record.element.parentNode !== record.parent)
            .map((record) => `${record.anchorKey}:expected=${record.parent?.id || record.parent?.className || 'node'}:actual=${record.element.parentNode?.id || record.element.parentNode?.className || 'none'}`);
          const nextSiblingFailures = tracked
            .filter((record) => record.element.parentNode === record.parent && record.element.nextSibling !== record.nextSibling)
            .map((record) => `${record.anchorKey}:expected-next=${record.nextSibling?.id || record.nextSibling?.className || record.nextSibling?.nodeValue || 'null'}:actual-next=${record.element.nextSibling?.id || record.element.nextSibling?.className || record.element.nextSibling?.nodeValue || 'null'}`);
          const remainingAnchors = [];
          const anchorWalker = document.createTreeWalker(document.body, NodeFilter.SHOW_COMMENT);
          while (anchorWalker.nextNode()) {
            if (anchorWalker.currentNode.nodeValue.startsWith('spc-settings-anchor:')) {
              remainingAnchors.push(anchorWalker.currentNode.nodeValue);
            }
          }
          const restorationFailures = parentFailures.concat(nextSiblingFailures, remainingAnchors);
          const restoredAfterUnmount = restorationFailures.length === 0;
          SPC.activate(m, { scope: 'pte' });
          await new Promise((resolve) => setTimeout(resolve, 120));
          const sheetCount = document.querySelectorAll(`#spc-settings-sheet-${m}`).length;
          SPC.unmount(m);
          return {
            restoredAfterUnmount,
            remountClean: sheetCount === 1 && document.querySelectorAll(`#spc-settings-sheet-${m}`).length === 0,
            trackedCount: tracked.length,
            restorationFailures,
            nextSiblingFailures
          };
        }, testCase.mode);
      }

      results[testCase.mode] = {
        controllerExists,
        clicked,
        sheetOpened,
        openedDetails,
        focusDebug,
        afterEscape,
        afterClose,
        restoration
      };
      await page.close();
    }

    console.log('\n=== ALL MODES SETTINGS BUTTON VERIFICATION ===');
    let allPassed = true;
    for (const [mode, res] of Object.entries(results)) {
      const supportedTitles = new Set(['🤖 difficulty engine', '🎯 question filters']);
      const sectionsMatch = mode === 'read-aloud' || res.openedDetails.sectionTitles.every((title) => supportedTitles.has(title));
      const hasSettings = !modesWithoutSettings.has(mode);
      const status = res.controllerExists
        && (hasSettings
          ? (
            res.clicked
            && res.sheetOpened
            && sectionsMatch
            && res.openedDetails.tabsWork
            && (mode === 'read-aloud' || (
              res.openedDetails.sheetRadius === '12px'
              && res.openedDetails.bodyBackground === 'rgb(255, 255, 255)'
              && res.openedDetails.closeButtonHeight === '44px'
              && res.openedDetails.settingsSectionsFlat
            ))
          )
          : (
            !res.clicked
            && !res.sheetOpened
            && res.openedDetails.sheetRadius === null
          ))
        && res.afterEscape.closed
        && res.afterEscape.focusRestored
        && res.afterClose.closed
        && (hasSettings
          ? res.afterEscape.duplicateSheetIds
            && res.afterClose.duplicateSheetIds
            && res.restoration.restoredAfterUnmount
            && res.restoration.remountClean
          : true);
      if (!status) allPassed = false;
      console.log(`${status ? '✅' : '❌'} ${mode}: controller=${res.controllerExists}, clicked=${res.clicked}, sheetOpened=${res.sheetOpened}`);
      if (!status) {
        console.log(JSON.stringify({
          focusDebug: res.focusDebug,
          openedDetails: res.openedDetails,
          afterEscape: res.afterEscape,
          afterClose: res.afterClose,
          restoration: res.restoration
        }, null, 2));
      }
    }

    if (allPassed) {
      console.log('\n🎉 ALL MODES PASSED SUCCESSFULLY!');
    } else {
      console.log('\n⚠️ SOME MODES FAILED!');
      process.exit(1);
    }
  } finally {
    await browser.close();
    server.close();
  }
})();
