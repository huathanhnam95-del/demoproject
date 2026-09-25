/* eslint-disable no-console */
const assert = require('assert');
const { chromium } = require('playwright');
const express = require('express');
const path = require('path');

const app = express();
app.use(express.static(path.join(__dirname, '../../public')));

async function dismissBlockingOverlays(page) {
  await page.waitForFunction(() => {
    const preloader = document.getElementById('app-preloader');
    return !preloader || getComputedStyle(preloader).display === 'none' || Boolean(document.getElementById('preloader-dismiss-btn'));
  }, { timeout: 15000 });

  const dismissButton = page.locator('#preloader-dismiss-btn');
  if (await dismissButton.count()) {
    await dismissButton.click({ timeout: 3000 }).catch(() => {});
  }

  const guestButton = page.locator('#guest-mode-btn');
  if (await guestButton.isVisible().catch(() => false)) {
    await guestButton.click();
  }

  await page.waitForFunction(() => {
    const entryModal = document.getElementById('entry-modal');
    return !entryModal || getComputedStyle(entryModal).display === 'none';
  }, { timeout: 15000 });
}

async function main() {
  const server = app.listen(0);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(() => {
    window.localStorage.setItem('userStatus', 'guest');
    window.localStorage.setItem('hasSeenScopeTutorial', 'true');
  });

  const page = await context.newPage();
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html?speakingController=v2&pteShell=legacy`, { waitUntil: 'domcontentloaded' });
    await dismissBlockingOverlays(page);

    const result = await page.evaluate(async () => {
      const panel = document.createElement('section');
      panel.id = 'mode-regression-controller';
      document.body.appendChild(panel);

      const hiddenScope = document.createElement('div');
      hiddenScope.id = 'regression-hidden-scope';
      hiddenScope.style.display = 'none';
      panel.appendChild(hiddenScope);

      const visibleScope = document.createElement('div');
      visibleScope.id = 'regression-visible-scope';
      panel.appendChild(visibleScope);

      const hiddenButton = document.createElement('button');
      hiddenButton.id = 'regression-hidden-button';
      hiddenButton.textContent = 'Hidden action';
      hiddenButton.style.display = 'inline-block';
      panel.appendChild(hiddenButton);

      const visibleButton = document.createElement('button');
      visibleButton.id = 'regression-visible-button';
      visibleButton.textContent = 'Visible action';
      panel.appendChild(visibleButton);

      window.SpeakingPracticeController.register({
        modeId: 'regression-controller',
        testOnly: true,
        enabledScopes: ['pte'],
        panelId: 'mode-regression-controller',
        picker: { getItems: () => [{ id: '1', label: 'Regression question' }], getCurrentId: () => '1' },
        controls: [
          { sourceId: 'regression-hidden-button', slot: 'attempt', level: 'basic', order: 1, visibilityScopeId: 'regression-hidden-scope' },
          { sourceId: 'regression-visible-button', slot: 'attempt', level: 'basic', order: 2, visibilityScopeId: 'regression-visible-scope' }
        ]
      });
      window.SpeakingPracticeController.activate('regression-controller', { scope: 'pte' });

      const hiddenStyle = getComputedStyle(hiddenButton).display;
      const visibleStyle = getComputedStyle(visibleButton).display;

      // A mode can keep a control hidden while its containing step is hidden.
      // Revealing the step must not overwrite that mode-owned display state.
      hiddenButton.style.display = 'none';
      hiddenScope.style.display = 'block';
      await new Promise(resolve => setTimeout(resolve, 0));
      const modeHiddenAfterReveal = getComputedStyle(hiddenButton).display;

      const settingsButton = panel.querySelector('.spc-settings-btn');
      settingsButton?.click();
      const settingsSections = document.querySelectorAll('#spc-settings-sheet-regression-controller .spc-settings-section').length;

      const controllerCss = await fetch('/speaking-practice-controller.css').then(response => response.text());
      const countRule = (rule) => controllerCss.split(rule).length - 1;
      const cssRuleCounts = {
        settingsBody: countRule('.spc-mode-settings-sheet .spc-sheet-body {'),
        settingsSection: countRule('.spc-settings-section {')
      };

      return { hiddenStyle, visibleStyle, modeHiddenAfterReveal, settingsSections, cssRuleCounts };
    });

    assert.strictEqual(result.hiddenStyle, 'none', 'A control scoped to a hidden step must be hidden immediately after adoption');
    assert.notStrictEqual(result.visibleStyle, 'none', 'A control scoped to a visible step must remain visible after adoption');
    assert.strictEqual(result.modeHiddenAfterReveal, 'none', 'Revealing a step must preserve mode-owned hidden state');
    assert.strictEqual(result.settingsSections, 0, 'Settings must not render empty sections');
    assert.strictEqual(result.cssRuleCounts.settingsBody, 1, 'Settings sheet body styles must have one source of truth');
    assert.strictEqual(result.cssRuleCounts.settingsSection, 1, 'Settings section styles must have one source of truth');

    console.log('Practice screen regression browser check passed');
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
