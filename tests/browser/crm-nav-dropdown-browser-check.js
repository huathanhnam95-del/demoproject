/* eslint-disable no-console */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '../..');
const SCREENSHOT_PATH = path.join(ROOT, 'tmp', 'crm-nav-dropdown-browser-check.png');
const html = fs.readFileSync(path.join(ROOT, 'public', 'crm-admin.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'public', 'crm-admin.css'), 'utf8');
const js = fs.readFileSync(path.join(ROOT, 'public', 'crm-admin.js'), 'utf8');

function extractRequired(source, pattern, label) {
  const match = source.match(pattern);
  assert(match, `Could not extract ${label} from the CRM source.`);
  return match[0];
}

(async () => {
  const header = extractRequired(html, /<header class="crm-header">[\s\S]*?<\/header>/, 'header markup');
  const dropdownInitializer = extractRequired(
    js,
    /\(function initNavDropdowns\(\) \{[\s\S]*?\n  \}\)\(\);/,
    'dropdown initializer'
  );

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1919, height: 401 } });

  try {
    await page.setContent(`
      <!doctype html>
      <html>
        <head><style>${css}</style></head>
        <body>
          <div class="crm-admin">
            ${header}
            <main class="crm-content" style="min-height: 300px"></main>
          </div>
          <script>${dropdownInitializer}</script>
        </body>
      </html>
    `, { waitUntil: 'load' });

    const moreButton = page.locator('.crm-nav-more-dropdown > .crm-nav-item');
    await moreButton.click();
    await page.mouse.move(1800, 350);
    await page.waitForTimeout(300);

    const state = await page.evaluate(() => {
      const headerElement = document.querySelector('.crm-header');
      const dropdown = document.querySelector('.crm-nav-more-dropdown');
      const menu = dropdown?.querySelector(':scope > .crm-dropdown-menu');
      const headerRect = headerElement?.getBoundingClientRect();
      const menuRect = menu?.getBoundingClientRect();
      const probeX = (menuRect?.left || 0) + 12;
      const probeY = (menuRect?.top || 0) + 12;
      const hit = document.elementFromPoint(probeX, probeY);

      return {
        isOpen: dropdown?.classList.contains('is-open') || false,
        menuVisibility: menu ? getComputedStyle(menu).visibility : '',
        menuOpacity: menu ? getComputedStyle(menu).opacity : '',
        menuExtendsBelowHeader: Boolean(menuRect && headerRect && menuRect.bottom > headerRect.bottom),
        menuReceivesPointerBelowHeader: Boolean(menu && hit && menu.contains(hit)),
        navOverflowX: getComputedStyle(document.querySelector('.crm-nav')).overflowX,
        navOverflowY: getComputedStyle(document.querySelector('.crm-nav')).overflowY
      };
    });

    assert.strictEqual(state.isOpen, true, 'Clicking More should keep the dropdown open after the pointer moves away.');
    assert.strictEqual(state.menuVisibility, 'visible', 'The More menu should become visible after click.');
    assert.strictEqual(state.menuOpacity, '1', 'The More menu should become opaque after click.');
    assert.strictEqual(state.menuExtendsBelowHeader, true, 'The More menu should extend below the header.');
    assert.strictEqual(
      state.menuReceivesPointerBelowHeader,
      true,
      `The open More menu must be hit-testable below the header (nav overflow: ${state.navOverflowX}/${state.navOverflowY}).`
    );

    fs.mkdirSync(path.dirname(SCREENSHOT_PATH), { recursive: true });
    await page.screenshot({ path: SCREENSHOT_PATH });
    console.log('CRM More dropdown browser check passed.');
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
