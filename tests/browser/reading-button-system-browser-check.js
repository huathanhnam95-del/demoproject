/* eslint-disable no-console */
/**
 * Reading button/system contract check.
 *
 * This intentionally starts from the raw index markup in a real Chromium page
 * so structural defects are caught before CSS or mode scripts can mask them.
 * Behavioral checks remain in the mode-specific browser checks.
 */
const assert = require('assert');
const express = require('express');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const INDEX_PATH = path.join(__dirname, '../../public/index.html');
const RFIB_SCRIPT_PATH = path.join(__dirname, '../../public/rfib-mode.js');

const READING_CONTRACTS = {
  rfib: {
    panel: '#mode-rfib',
    required: [
      'rfib-back-btn',
      'rfib-question-select',
      'rfib-next-btn',
      'rfib-full-audio-play',
      'rfib-check-btn',
      'rfib-retry-btn',
      'rfib-next-question-btn',
      'rfib-easy-reading-btn'
    ]
  },
  dd: {
    panel: '#mode-dd',
    required: [
      'dd-v7-prev-btn',
      'dd-v7-question-pill',
      'dd-v7-next-btn',
      'dd-random-toggle-btn',
      'dd-submit-btn',
      'dd-retry-btn',
      'dd-next-question-btn',
      'dd-v7-sheet-close'
    ]
  },
  rmcma: {
    panel: '#mode-rmcma',
    required: [
      'rmcma-v7-prev-btn',
      'rmcma-v7-question-pill',
      'rmcma-v7-next-btn',
      'rmcma-random-toggle-btn',
      'rmcma-submit-btn',
      'rmcma-retry-btn',
      'rmcma-explanation-toggle',
      'rmcma-v7-sheet-close'
    ]
  },
  rmcsa: {
    panel: '#mode-rmcsa',
    required: [
      'rmcsa-v7-prev-btn',
      'rmcsa-v7-question-pill',
      'rmcsa-v7-next-btn',
      'rmcsa-random-toggle-btn',
      'rmcsa-submit-btn',
      'rmcsa-retry-btn',
      'rmcsa-explanation-toggle',
      'rmcsa-v7-sheet-close'
    ]
  },
  rop: {
    panel: '#mode-rop',
    required: [
      'rop-v7-prev-btn',
      'rop-v7-question-pill',
      'rop-v7-next-btn',
      'rop-random-toggle-btn',
      'rop-btn-move-right',
      'rop-btn-move-left',
      'rop-btn-move-up',
      'rop-btn-move-down',
      'rop-submit-btn',
      'rop-retry-btn',
      'rop-explanation-toggle',
      'rop-critique-btn',
      'rop-v7-sheet-close'
    ]
  }
};

const SCREENSHOT_DIR = path.resolve(__dirname, '../../test-results/reading-speaking-rfib-ui');

function screenshotPath(filename) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  return path.join(SCREENSHOT_DIR, filename);
}

async function activateReadingMode(page, mode) {
  await page.evaluate(async (modeId) => {
    await window.switchToMode(modeId);
  }, mode);
  await page.waitForFunction((modeId) => {
    const panel = document.getElementById(`mode-${modeId}`);
    return !!panel && panel.classList.contains('active') && getComputedStyle(panel).display !== 'none';
  }, mode, { timeout: 30000 });
  await page.waitForTimeout(450);
  await dismissReadingTransientUi(page);
}

async function dismissReadingTransientUi(page) {
  for (const selector of ['#vocab-alert-ok', '#vocab-skip-btn', '#vocab-add-close', '#toast-close', '#rop-v7-sheet-close', '.ra-v7-sheet-close']) {
    const visible = await page.evaluate((selector) => {
      const control = document.querySelector(selector);
      if (!control) return false;
      const style = getComputedStyle(control);
      return style.display !== 'none' && style.visibility !== 'hidden';
    }, selector);
    if (visible) await page.evaluate((selector) => document.querySelector(selector)?.click(), selector);
  }
  await page.evaluate(() => {
    document.querySelectorAll('.ra-v7-sheet.is-open').forEach((sheet) => {
      sheet.classList.remove('is-open');
      sheet.setAttribute('aria-hidden', 'true');
    });
    document.querySelectorAll('.ra-v7-backdrop.is-visible').forEach((backdrop) => {
      backdrop.classList.remove('is-visible');
      backdrop.setAttribute('aria-hidden', 'true');
    });
  });
}

async function dismissReadingOverlays(page) {
  await page.waitForFunction(() => {
    const preloader = document.getElementById('app-preloader');
    if (!preloader) return true;
    const dismiss = document.getElementById('preloader-dismiss-btn');
    return getComputedStyle(preloader).display === 'none' || !!dismiss;
  }, { timeout: 15000 });

  const preloaderDismiss = page.locator('#preloader-dismiss-btn');
  if (await preloaderDismiss.isVisible().catch(() => false)) await preloaderDismiss.click();
  await page.waitForFunction(() => {
    const preloader = document.getElementById('app-preloader');
    return !preloader || getComputedStyle(preloader).display === 'none';
  }, { timeout: 15000 });

  const guestButton = page.locator('#guest-mode-btn');
  if (await guestButton.isVisible().catch(() => false)) await guestButton.click();
  await page.waitForFunction(() => {
    const entryModal = document.getElementById('entry-modal');
    const wrapper = document.getElementById('page-layout-wrapper');
    return (!entryModal || getComputedStyle(entryModal).display === 'none')
      && !!wrapper
      && getComputedStyle(wrapper).display !== 'none';
  }, { timeout: 15000 });

  const vocabAlertOk = page.locator('#vocab-alert-ok');
  if (await vocabAlertOk.isVisible().catch(() => false)) await vocabAlertOk.click();
  await dismissReadingTransientUi(page);
}

async function captureReadingScreenshots(browser, server) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  await context.addInitScript(() => {
    window.localStorage.setItem('userStatus', 'guest');
    window.localStorage.setItem('hasSeenScopeTutorial', 'true');
    ['dd', 'rfib', 'rmcma', 'rmcsa', 'rop'].forEach((mode) => {
      window.localStorage.setItem(`${mode}ModeFirstUse`, 'true');
    });
  });
  const page = await context.newPage();

  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.switchToMode === 'function', { timeout: 30000 });
    await dismissReadingOverlays(page);

    await activateReadingMode(page, 'rfib');
    await page.waitForFunction(() => document.querySelectorAll('#mode-rfib .rfib-blank-select').length > 0, { timeout: 30000 }).catch(() => {});
    await page.screenshot({ path: screenshotPath('reading-rfib-default-desktop.png'), fullPage: true });

    await page.evaluate(() => {
      document.querySelectorAll('#mode-rfib .rfib-blank-select').forEach((select) => {
        const option = Array.from(select.options).find((candidate) => !candidate.disabled && candidate.value);
        if (!option) return;
        select.value = option.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
      document.getElementById('rfib-check-btn')?.click();
    });
    await page.waitForTimeout(500);
    await dismissReadingTransientUi(page);
    await page.waitForTimeout(250);
    await page.screenshot({ path: screenshotPath('reading-rfib-submitted-desktop.png'), fullPage: true });

    for (const mode of ['dd', 'rmcma', 'rmcsa', 'rop']) {
      await activateReadingMode(page, mode);
      await page.screenshot({ path: screenshotPath(`reading-${mode}-desktop.png`), fullPage: true });
    }
  } finally {
    await context.close();
  }

  const tablet = await browser.newContext({ viewport: { width: 768, height: 1024 } });
  await tablet.addInitScript(() => {
    window.localStorage.setItem('userStatus', 'guest');
    window.localStorage.setItem('hasSeenScopeTutorial', 'true');
    window.localStorage.setItem('rfibModeFirstUse', 'true');
  });
  const tabletPage = await tablet.newPage();
  try {
    await tabletPage.goto(`http://127.0.0.1:${server.address().port}/index.html`, { waitUntil: 'domcontentloaded' });
    await tabletPage.waitForFunction(() => typeof window.switchToMode === 'function', { timeout: 30000 });
    await dismissReadingOverlays(tabletPage);
    await activateReadingMode(tabletPage, 'rfib');
    await tabletPage.screenshot({ path: screenshotPath('reading-controls-tablet.png'), fullPage: true });
  } finally {
    await tablet.close();
  }

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await mobile.addInitScript(() => {
    window.localStorage.setItem('userStatus', 'guest');
    window.localStorage.setItem('hasSeenScopeTutorial', 'true');
    ['rfib', 'rop'].forEach((mode) => window.localStorage.setItem(`${mode}ModeFirstUse`, 'true'));
  });
  const mobilePage = await mobile.newPage();
  try {
    await mobilePage.goto(`http://127.0.0.1:${server.address().port}/index.html`, { waitUntil: 'domcontentloaded' });
    await mobilePage.waitForFunction(() => typeof window.switchToMode === 'function', { timeout: 30000 });
    await dismissReadingOverlays(mobilePage);
    await activateReadingMode(mobilePage, 'rfib');
    await mobilePage.screenshot({ path: screenshotPath('reading-controls-mobile.png'), fullPage: true });
    await activateReadingMode(mobilePage, 'rop');
    // The ROP route can restore its picker-open state while the mode finishes
    // loading. The functional browser check covers the real close handler; the
    // responsive base-layout artifact should show the controller itself.
    await mobilePage.evaluate(() => {
      document.getElementById('rop-v7-sheet-close')?.click();
      document.getElementById('rop-v7-sheet')?.classList.remove('is-open');
      document.getElementById('rop-v7-backdrop')?.classList.remove('is-visible');
    });
    await mobilePage.screenshot({ path: screenshotPath('reading-rop-mobile.png'), fullPage: true });
  } finally {
    await mobile.close();
  }
}

function collectFailures(result) {
  const failures = [];
  result.missing.forEach((id) => failures.push(`missing required control #${id}`));
  result.duplicates.forEach((id) => failures.push(`required control #${id} is not unique`));
  result.nestedButtons.forEach((id) => failures.push(`nested button detected under #${id}`));
  result.missingButtonTypes.forEach((id) => failures.push(`#${id} is missing type="button"`));
  result.ropNextMarkup.forEach((failure) => failures.push(failure));
  result.rfibDeadReference.forEach((failure) => failures.push(failure));
  return failures;
}

async function main() {
  const indexHtml = fs.readFileSync(INDEX_PATH, 'utf8');
  const rfibSource = fs.readFileSync(RFIB_SCRIPT_PATH, 'utf8');
  const app = express();
  app.use(express.static(path.join(__dirname, '../../public')));
  const server = app.listen(0);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });

  try {
    await page.setContent(indexHtml, { waitUntil: 'domcontentloaded' });
    const result = await page.evaluate((contracts) => {
      const missing = [];
      const duplicates = [];
      const nestedButtons = Array.from(document.querySelectorAll('button button'))
        .map((button) => button.id || button.textContent.trim() || '<anonymous>');
      const missingButtonTypes = [];

      Object.values(contracts).forEach((contract) => {
        contract.required.forEach((id) => {
          const nodes = document.querySelectorAll(`#${id}`);
          if (nodes.length === 0) missing.push(id);
          if (nodes.length > 1) duplicates.push(id);
          nodes.forEach((node) => {
            if (node.matches('button') && node.getAttribute('type') !== 'button') {
              missingButtonTypes.push(id);
            }
          });
        });
      });

      const ropNext = document.querySelector('#rop-v7-next-btn');
      const ropRandom = document.querySelector('#rop-random-toggle-btn');
      const ropNextMarkup = [];
      if (!ropNext || !ropRandom) {
        ropNextMarkup.push('ROP picker is missing Next or Random control');
      } else if (ropNext.parentElement !== ropRandom.parentElement) {
        ropNextMarkup.push('ROP Next and Random controls are not siblings');
      }

      return {
        missing,
        duplicates,
        nestedButtons,
        missingButtonTypes,
        ropNextMarkup,
        rfibDeadReference: []
      };
    }, READING_CONTRACTS);

    if (rfibSource.includes('rfib-random-toggle-btn')) {
      result.rfibDeadReference.push('rfib-mode.js still references #rfib-random-toggle-btn');
    }

    const ropNextStart = indexHtml.indexOf('id="rop-v7-next-btn"');
    const ropRandomStart = indexHtml.indexOf('id="rop-random-toggle-btn"');
    if (ropNextStart >= 0 && ropRandomStart > ropNextStart) {
      const rawBetweenControls = indexHtml.slice(ropNextStart, ropRandomStart);
      if (!rawBetweenControls.includes('</button>')) {
        result.ropNextMarkup.push('ROP #rop-v7-next-btn is missing its closing </button> before Random');
      }
    }

    const failures = collectFailures(result);
    console.log(`Reading button contract: ${failures.length === 0 ? 'PASS' : 'FAIL'}`);
    if (failures.length > 0) {
      failures.forEach((failure) => console.error(`  - ${failure}`));
      process.exitCode = 1;
      return;
    }

    console.log(`  ✓ ${Object.values(READING_CONTRACTS).reduce((sum, contract) => sum + contract.required.length, 0)} required controls verified`);
    console.log('  ✓ no nested required buttons');
    console.log('  ✓ ROP navigation controls are siblings');
    console.log('  ✓ RFIB has no dead Random reference');

    const stylePage = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
    await stylePage.route('**/*.js', (route) => route.abort());
    await stylePage.goto(`http://127.0.0.1:${server.address().port}/index.html`, { waitUntil: 'domcontentloaded' });
    const styleResult = await stylePage.evaluate(() => {
      const read = (id) => {
        const element = document.getElementById(id);
        if (!element) return null;
        const style = getComputedStyle(element);
        return {
          backgroundImage: style.backgroundImage,
          backgroundColor: style.backgroundColor,
          borderRadius: style.borderRadius,
          minHeight: Number.parseFloat(style.minHeight) || 0,
          width: style.width,
          height: style.height
        };
      };
      return {
        back: read('rfib-back-btn'),
        next: read('rfib-next-btn'),
        play: read('rfib-full-audio-play'),
        check: read('rfib-check-btn'),
        retry: read('rfib-retry-btn'),
        easyReading: read('rfib-easy-reading-btn'),
        pickerNext: read('dd-v7-next-btn'),
        ropArrow: read('rop-btn-move-right')
      };
    });

    const styleFailures = [];
    const expectedGradient = (style, first, second) => {
      return style && style.backgroundImage.includes(first) && style.backgroundImage.includes(second);
    };
    if (!expectedGradient(styleResult.back, 'rgb(107, 114, 128)', 'rgb(75, 85, 99)')) {
      styleFailures.push('RFIB Back is not using the slate gradient');
    }
    if (!expectedGradient(styleResult.next, 'rgb(139, 92, 246)', 'rgb(124, 58, 237)')) {
      styleFailures.push('RFIB Next is not using the purple gradient');
    }
    if (!expectedGradient(styleResult.play, 'rgb(59, 130, 246)', 'rgb(37, 99, 235)')) {
      styleFailures.push('RFIB Play is not using the blue gradient');
    }
    if (!expectedGradient(styleResult.check, 'rgb(34, 197, 94)', 'rgb(22, 163, 74)')) {
      styleFailures.push('RFIB Check is not using the green gradient');
    }
    if (!expectedGradient(styleResult.retry, 'rgb(245, 158, 11)', 'rgb(217, 119, 6)')) {
      styleFailures.push('RFIB Retry is not using the amber gradient');
    }
    if (!styleResult.easyReading || styleResult.easyReading.borderRadius !== '12px') {
      styleFailures.push('RFIB Easy Reading does not use the shared 12px control radius');
    }
    [styleResult.back, styleResult.next, styleResult.play, styleResult.check, styleResult.retry].forEach((style, index) => {
      if (!style || style.borderRadius !== '12px') {
        styleFailures.push(`RFIB primary control ${index + 1} does not use the shared 12px control radius`);
      }
      if (!style || style.minHeight < 44) {
        styleFailures.push(`RFIB primary control ${index + 1} is below the 44px target height`);
      }
    });
    if (!expectedGradient(styleResult.pickerNext, 'rgb(139, 92, 246)', 'rgb(124, 58, 237)')) {
      styleFailures.push('Reading picker Next is not using the purple semantic treatment');
    }
    if (!styleResult.ropArrow || styleResult.ropArrow.borderRadius !== '12px' || styleResult.ropArrow.width !== '36px' || styleResult.ropArrow.height !== '36px') {
      styleFailures.push('ROP reorder arrows do not use the shared compact control geometry');
    }

    await stylePage.close();
    if (styleFailures.length > 0) {
      console.error(`Reading style contract: FAIL (${styleFailures.length} failures)`);
      styleFailures.forEach((failure) => console.error(`  - ${failure}`));
      process.exitCode = 1;
      return;
    }
    console.log('Reading style contract: PASS');
    await captureReadingScreenshots(browser, server);
    console.log(`Reading screenshot matrix: PASS (${fs.readdirSync(SCREENSHOT_DIR).filter((name) => name.startsWith('reading-')).length} files)`);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
