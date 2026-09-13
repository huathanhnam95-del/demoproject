/* eslint-disable no-console */
/**
 * Chrome regression checks for the Speaking/Reading UI review repairs.
 *
 * This intentionally tests the reported visual failure modes:
 * - mode-panel containment inside main.container;
 * - first-visible-frame controller readiness across all Speaking modes;
 * - Read Aloud settings computed styles;
 * - shared action-row spacing and mobile overflow.
 */
const assert = require('assert');
const express = require('express');
const fs = require('fs');
const path = require('path');
const { launchPracticeChrome } = require('./helpers/launch-practice-chrome');

const SPEAKING_MODE_IDS = [
  'read-aloud', 'rts', 'asq', 'describe-image', 'notes', 'sgd', 'speak'
];
// Step counts must match each mode's real state machine. Several were wrong
// before: Read Aloud has no separate Read phase (prep starts on load), Describe
// Image and SGD each run three phases, and Retell Lecture never records.
const EXPECTED_STEP_COUNTS = {
  'read-aloud': 3,
  rts: 4,
  asq: 3,
  'describe-image': 3,
  notes: 3,
  sgd: 3,
  speak: 3
};

const app = express();
app.use(express.static(path.join(__dirname, '../../public')));

const screenshotDir = path.resolve(__dirname, '../../test-results/ui-review-2026-08-01');
fs.mkdirSync(screenshotDir, { recursive: true });

function screenshotPath(name) {
  return path.join(screenshotDir, name);
}

async function dismissBlockingOverlays(page) {
  await page.waitForFunction(() => {
    const preloader = document.getElementById('app-preloader');
    if (!preloader) return true;
    const dismiss = document.getElementById('preloader-dismiss-btn');
    return getComputedStyle(preloader).display === 'none' || Boolean(dismiss);
  }, { timeout: 30000 });

  const dismiss = page.locator('#preloader-dismiss-btn');
  if (await dismiss.count()) {
    await dismiss.click({ timeout: 5000 }).catch(() => {});
  }
  const guestMode = page.locator('#guest-mode-btn');
  if (await guestMode.count()) {
    await guestMode.click({ timeout: 5000 }).catch(() => {});
  }
  await page.waitForTimeout(250);
}

async function activateMode(page, modeId) {
  await page.evaluate(async (id) => {
    if (typeof window.switchToMode !== 'function') {
      throw new Error('window.switchToMode is unavailable');
    }
    await window.switchToMode(id);
  }, modeId);

  await page.waitForFunction((id) => {
    const panel = document.getElementById(`mode-${id}`);
    return panel
      && panel.classList.contains('active')
      && getComputedStyle(panel).display !== 'none';
  }, modeId, { timeout: 30000 });
  await page.waitForTimeout(250);
}

async function waitForController(page, modeId) {
  await page.waitForFunction((id) => {
    const panel = document.getElementById(`mode-${id}`);
    return !!panel?.querySelector('.spc-controller');
  }, modeId, { timeout: 30000 });
}

async function closeActiveSheets(page) {
  await page.evaluate(() => {
    document.querySelectorAll('.spc-sheet.is-active .spc-sheet-close').forEach((button) => button.click());
  });
  await page.waitForTimeout(400);
}

const assertionFailures = [];

function assertResult(label, value) {
  if (!value) {
    assertionFailures.push(label);
    console.error(`FAIL: ${label}`);
    return;
  }
  console.log(`PASS: ${label}`);
}

async function main() {
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const browser = await launchPracticeChrome({ headless: true });

  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    await context.addInitScript(() => {
      window.localStorage.setItem('userStatus', 'guest');
      window.localStorage.setItem('hasSeenScopeTutorial', 'true');
      ['speak', 'read-aloud', 'asq', 'rts', 'describe-image', 'notes', 'sgd'].forEach((mode) => {
        window.localStorage.setItem(`${mode}ModeFirstUse`, 'true');
      });

      const trace = [];
      const snapshot = () => {
        document.querySelectorAll('.mode-panel').forEach((panel) => {
          const visible = panel.classList.contains('active')
            && getComputedStyle(panel).display !== 'none';
          const controller = !!panel.querySelector('.spc-controller');
          const last = trace.filter((entry) => entry.panel === panel.id).pop();
          if (!last || last.visible !== visible || last.controller !== controller) {
            trace.push({ panel: panel.id, time: performance.now(), visible, controller });
          }
        });
      };
      new MutationObserver(snapshot).observe(document, {
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'style']
      });
      window.__readAloudUiTrace = () => trace.slice();
      window.__uiTrace = () => trace.slice();
      window.__uiTraceReset = () => trace.splice(0, trace.length);
    });

    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/?speakingController=v2`, {
      waitUntil: 'domcontentloaded'
    });
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => typeof window.switchToMode === 'function', { timeout: 30000 });

    const modeIds = [
      'speak', 'dd', 'rmcma', 'rmcsa', 'rop',
      'describe-image', 'read-aloud', 'asq', 'rts'
    ];
    const containment = [];
    for (const modeId of modeIds) {
      await activateMode(page, modeId);
      containment.push(await page.evaluate((id) => {
        const panel = document.getElementById(`mode-${id}`);
        const main = document.querySelector('main.container');
        return {
          modeId: id,
          panelExists: !!panel,
          insideMain: !!panel?.closest('main.container'),
          mainWidth: main?.getBoundingClientRect().width || 0,
          panelWidth: panel?.getBoundingClientRect().width || 0
        };
      }, modeId));
    }
    containment.forEach((result) => {
      assertResult(`${result.modeId} panel is inside main.container`, result.panelExists && result.insideMain);
    });
    assertResult('No browser page errors during mode containment pass', pageErrors.length === 0);

    const speakingAudit = [];
    for (const modeId of SPEAKING_MODE_IDS) {
      await page.evaluate(() => window.__uiTraceReset?.());
      await activateMode(page, modeId);
      await waitForController(page, modeId);
      const result = await page.evaluate(({ id, expectedStepCount }) => {
        const panel = document.getElementById(`mode-${id}`);
        const visible = (element) => {
          if (!element) return false;
          const style = getComputedStyle(element);
          const box = element.getBoundingClientRect();
          return style.display !== 'none'
            && style.visibility !== 'hidden'
            && Number(style.opacity) !== 0
            && box.width > 0
            && box.height > 0;
        };
        const trace = (window.__uiTrace?.() || []).filter((entry) => entry.panel === `mode-${id}`);
        const controllerButtons = [...(panel?.querySelectorAll('.spc-controller button, .spc-controller select, .spc-controller input') || [])]
          .filter(visible);
        const settingsTrigger = [...(panel?.querySelectorAll('.spc-settings-btn') || [])].find(visible);
        const steps = panel?.querySelector('.spc-steps');
        const stepItems = steps ? [...steps.querySelectorAll('[data-spc-step]')] : [];
        const visibleInfoBoxes = [...(panel?.querySelectorAll('.info-box, .notification-box') || [])]
          .filter(visible)
          .map((element) => element.id || element.className || element.tagName);
        const orphanText = [];
        const walker = panel ? document.createTreeWalker(panel, NodeFilter.SHOW_TEXT) : null;
        let node;
        while (walker && (node = walker.nextNode())) {
          const text = (node.nodeValue || '').replace(/\s+/g, ' ').trim();
          if (!text || !/^(Total (number of questions|images)|Points):/.test(text)) continue;
          if (visible(node.parentElement)) orphanText.push(text);
        }
        const activeSheet = [...document.querySelectorAll('.spc-sheet.is-active')].find(visible);
        const sheetContentControls = activeSheet
          ? [...activeSheet.querySelectorAll('button, select, input')]
            .filter((control) => !control.matches('.spc-sheet-close, .spc-sheet-tab') && visible(control))
          : [];
        const actionRow = panel?.querySelector('.spc-row--actions');
        const readAloudActionHost = panel?.querySelector('#ra-read-aloud-controls');
        const attemptStatus = panel?.querySelector('.spc-slot-media .badge-replay');
        return {
          trace,
          // Notes deliberately keeps a small loading shell visible while its
          // bounded entry loaders race; every other migrated mode remains
          // hidden until its controller is ready.
          visibleBeforeController: id !== 'notes' && trace.some((entry) => entry.visible && !entry.controller),
          notesLoadingShellRendered: id !== 'notes' || !!panel?.querySelector('#notes-entry-status'),
          nonOutfitControllerControls: controllerButtons
            .filter((control) => !String(getComputedStyle(control).fontFamily).toLowerCase().includes('outfit'))
            .map((control) => control.id || control.className || control.tagName),
          shortControllerControls: controllerButtons
            .filter((control) => control.getBoundingClientRect().height < 44)
            .map((control) => ({ id: control.id || control.className, height: Math.round(control.getBoundingClientRect().height) })),
          settingsTriggerRendered: !!settingsTrigger,
          settingsSheetOpen: !!activeSheet,
          settingsContentControlCount: sheetContentControls.length,
          shortSettingsControls: activeSheet
            ? [...activeSheet.querySelectorAll('button, select, input')]
              .filter(visible)
              .filter((control) => control.getBoundingClientRect().height < 44)
              .map((control) => ({ id: control.id || control.className, height: Math.round(control.getBoundingClientRect().height) }))
            : [],
          visibleInfoBoxes,
          orphanText,
          tutorialPillRendered: visible(document.getElementById('mode-tutorial-btn')),
          asqNavigationRendered: id !== 'asq' || (
            visible(panel?.querySelector('.spc-picker-prev')) && visible(panel?.querySelector('.spc-picker-next'))
          ),
          readAloudActionsAdopted: id !== 'read-aloud' || (
            !!readAloudActionHost?.querySelector('#ra-record-btn')
            && !!readAloudActionHost?.querySelector('#ra-stop-btn')
            && !!readAloudActionHost?.querySelector('#ra-check-btn')
          ),
          actionRowGap: actionRow ? parseFloat(getComputedStyle(actionRow).columnGap || '0') : 0,
          attemptStatusStyle: attemptStatus ? {
            borderWidth: getComputedStyle(attemptStatus).borderTopWidth,
            minHeight: parseFloat(getComputedStyle(attemptStatus).minHeight || '0'),
            role: attemptStatus.getAttribute('role')
          } : null,
          stepperRendered: visible(steps),
          stepCount: stepItems.length,
          expectedStepCount
        };
      }, { id: modeId, expectedStepCount: EXPECTED_STEP_COUNTS[modeId] });
      speakingAudit.push({ modeId, ...result });

      if (result.settingsTriggerRendered) {
        await page.locator(`#mode-${modeId} .spc-settings-btn`).click({ timeout: 5000 });
        await page.waitForTimeout(300);
        const settings = await page.evaluate(() => {
          const visible = (element) => {
            if (!element) return false;
            const style = getComputedStyle(element);
            const box = element.getBoundingClientRect();
            return style.display !== 'none'
              && style.visibility !== 'hidden'
              && Number(style.opacity) !== 0
              && box.width > 0
              && box.height > 0;
          };
          const sheet = [...document.querySelectorAll('.spc-sheet.is-active')].find(visible);
          if (!sheet) return { open: false, contentControlCount: 0, shortControls: [] };
          // Segmented filter groups expose their options as role-bearing
          // divs, so counting only native controls would under-report them.
          const controls = [...sheet.querySelectorAll(
            'button, select, input, [role="radio"], [role="checkbox"]'
          )].filter(visible);
          const filterGroups = [...sheet.querySelectorAll(
            '.status-filter-dropdown, .length-filter-dropdown, .difficulty-filter-dropdown'
          )].filter(visible);
          return {
            open: true,
            // G1: filters must render as always-visible segmented pills, not
            // as `▼` dropdown triggers.
            legacyDropdownTriggers: [...sheet.querySelectorAll(
              '.status-filter-btn, .length-filter-btn, .difficulty-filter-btn'
            )].filter(visible).length,
            unlabelledFilterGroups: filterGroups
              .filter((group) => !group.querySelector('.spc-filter-group-label'))
              .map((group) => group.id || group.className),
            contentControlCount: controls.filter((control) => !control.matches('.spc-sheet-close, .spc-sheet-tab')).length,
            shortControls: controls
              .filter((control) => control.getBoundingClientRect().height < 44)
              .map((control) => ({ id: control.id || control.className, height: Math.round(control.getBoundingClientRect().height) }))
          };
        });
        speakingAudit[speakingAudit.length - 1].settings = settings;
        await closeActiveSheets(page);
      }
    }

    speakingAudit.forEach((result) => {
      assertResult(`${result.modeId} never becomes visible before its controller mounts`, !result.visibleBeforeController);
      if (result.modeId === 'notes') {
        assertResult('notes loading shell exposes an explicit status node', result.notesLoadingShellRendered);
      }
      assertResult(`${result.modeId} controller controls use the Outfit stack`, result.nonOutfitControllerControls.length === 0);
      assertResult(`${result.modeId} controller controls meet the 44px touch target`, result.shortControllerControls.length === 0);
      assertResult(`${result.modeId} has the shared visible step indicator`, result.stepperRendered && result.stepCount === result.expectedStepCount);
      assertResult(`${result.modeId} has no visible Speaking info box`, result.visibleInfoBoxes.length === 0);
      assertResult(`${result.modeId} has no visible orphan count or score text`, result.orphanText.length === 0);
      assertResult(`${result.modeId} shows the mode tutorial pill`, result.tutorialPillRendered);
      assertResult(`${result.modeId} keeps the shared action row compact`, result.actionRowGap <= 12);
      assertResult(`${result.modeId} keeps Read Aloud actions in the shared row`, result.readAloudActionsAdopted);
      assertResult(`${result.modeId} keeps ASQ picker arrows`, result.asqNavigationRendered);
      if (result.modeId === 'speak' && result.attemptStatusStyle) {
        assertResult('Speak attempts chip is a non-interactive status pill',
          result.attemptStatusStyle.borderWidth === '0px'
          && result.attemptStatusStyle.minHeight < 44
          && result.attemptStatusStyle.role !== 'button');
      }
      if (result.settingsTriggerRendered) {
        assertResult(`${result.modeId} settings sheet contains real controls`, result.settings?.open && result.settings.contentControlCount > 0);
        assertResult(`${result.modeId} settings controls meet the 44px touch target`, result.settings?.shortControls?.length === 0);
        assertResult(`${result.modeId} settings filters use segmented pills, not dropdown triggers`,
          result.settings?.legacyDropdownTriggers === 0);
        assertResult(`${result.modeId} settings filter groups are labelled`,
          result.settings?.unlabelledFilterGroups?.length === 0);
      }
      console.log(`${result.modeId} first-paint trace:`, JSON.stringify(result.trace));
    });

    await activateMode(page, 'read-aloud');
    await waitForController(page, 'read-aloud');
    await page.evaluate(() => {
      if (typeof window.ReadAloudMode?.openSettings === 'function') {
        window.ReadAloudMode.openSettings();
      } else {
        document.querySelector('#mode-read-aloud .spc-settings-btn')?.click();
      }
    });
    await page.waitForFunction(() => document.getElementById('ra-settings-sheet')?.classList.contains('is-active'), {
      timeout: 15000
    });
    const settingsStyles = await page.evaluate(() => {
      const difficulty = document.getElementById('ra-diff-all');
      const tab = document.querySelector('#ra-settings-sheet .spc-sheet-tab');
      const style = (element) => {
        if (!element) return null;
        const computed = getComputedStyle(element);
        return {
          fontFamily: computed.fontFamily,
          minHeight: computed.minHeight,
          borderRadius: computed.borderRadius,
          borderTopStyle: computed.borderTopStyle,
          borderTopWidth: computed.borderTopWidth,
          appearance: computed.appearance
        };
      };
      return { difficulty: style(difficulty), tab: style(tab) };
    });
    assertResult('Read Aloud difficulty button inherits the application font',
      settingsStyles.difficulty?.fontFamily?.toLowerCase().includes('outfit'));
    assertResult('Read Aloud difficulty button uses the shared control height',
      parseFloat(settingsStyles.difficulty?.minHeight || '0') >= 44);
    assertResult('Read Aloud difficulty button uses a deliberate border',
      settingsStyles.difficulty?.borderTopStyle !== 'outset'
      && settingsStyles.difficulty?.borderTopWidth === '1px');
    assertResult('Read Aloud difficulty button uses the shared radius',
      settingsStyles.difficulty?.borderRadius === '12px');
    assertResult('Read Aloud settings tab uses the shared control height',
      parseFloat(settingsStyles.tab?.minHeight || '0') >= 44);

    const readAloudSheetClose = page.locator('#ra-settings-sheet .spc-sheet-close');
    if (await readAloudSheetClose.count()) {
      await readAloudSheetClose.click({ timeout: 5000 }).catch(() => {});
      await page.waitForFunction(() => !document.getElementById('ra-settings-sheet')?.classList.contains('is-active'), {
        timeout: 10000
      }).catch(() => {});
    }
    await activateMode(page, 'speak');
    await waitForController(page, 'speak');
    const desktopLayout = await page.evaluate(() => {
      const controller = document.querySelector('#mode-speak .spc-controller');
      const row = controller?.querySelector('.spc-row--actions');
      const media = controller?.querySelector('.spc-slot-media');
      const attempt = controller?.querySelector('.spc-slot-attempt');
      const mediaRect = media?.getBoundingClientRect();
      const attemptRect = attempt?.getBoundingClientRect();
      return {
        rowExists: !!row,
        slotGap: mediaRect && attemptRect ? Math.max(0, attemptRect.left - mediaRect.right) : 0,
        controllerWidth: controller?.getBoundingClientRect().width || 0,
        rowWidth: row?.getBoundingClientRect().width || 0
      };
    });
    assertResult('Speaking action row keeps populated slots within a bounded gap', desktopLayout.slotGap <= 320);
    await page.screenshot({ path: screenshotPath('speaking-ui-speak-desktop.png'), fullPage: false });

    await closeActiveSheets(page);
    await page.addStyleTag({
      content: '.spc-sheet:not(.is-active), .spc-sheet-backdrop:not(.is-active) { visibility: hidden !important; }'
    });
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileLayout = await page.evaluate(() => {
      const controller = document.querySelector('#mode-speak .spc-controller');
      const actions = controller?.querySelector('.spc-row--actions');
      return {
        controllerExists: !!controller,
        actionsWidth: actions?.getBoundingClientRect().width || 0,
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        controlHeights: [...(controller?.querySelectorAll('button') || [])]
          .filter((button) => getComputedStyle(button).display !== 'none')
          .map((button) => Math.round(button.getBoundingClientRect().height))
      };
    });
    assertResult('Speaking mobile controller has no horizontal overflow', mobileLayout.documentWidth <= mobileLayout.viewportWidth + 1);
    assertResult('Speaking mobile controls meet the 44px touch target', mobileLayout.controlHeights.every((height) => height >= 44));
    await page.addStyleTag({
      content: '@media (max-width: 640px) { .spc-sheet, .spc-sheet-backdrop { visibility: hidden !important; } }'
    });
    await page.screenshot({ path: screenshotPath('speaking-ui-speak-mobile.png'), fullPage: false });

    await closeActiveSheets(page);
    await page.setViewportSize({ width: 1440, height: 1100 });
    await activateMode(page, 'read-aloud');
    await waitForController(page, 'read-aloud');
    await page.waitForFunction(() => !!document.getElementById('ra-settings-sheet'), { timeout: 15000 });
    await page.locator('#mode-read-aloud .spc-settings-btn').click();
    await page.waitForFunction(() => document.getElementById('ra-settings-sheet')?.classList.contains('is-active'), {
      timeout: 15000
    });
    await page.waitForTimeout(350);
    await page.screenshot({ path: screenshotPath('speaking-ui-read-aloud-settings-desktop.png'), fullPage: false });

    assert.strictEqual(assertionFailures.length, 0, assertionFailures.join('\n'));

    await context.close();
    console.log('Speaking UI review regression check: PASS');
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error('Speaking UI review regression check: FAIL');
  console.error(error.stack || error);
  process.exitCode = 1;
});
