const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '../..');
const html = fs.readFileSync(path.join(ROOT, 'public', 'crm-admin.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'public', 'crm-admin.css'), 'utf8');
const js = fs.readFileSync(path.join(ROOT, 'public', 'crm-admin.js'), 'utf8');

function extractRequired(source, pattern, label) {
  const match = source.match(pattern);
  assert(match, 'Could not extract ' + label + ' from CRM source.');
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

  try {
    // 1. Desktop Test (1280px)
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.setContent(`
      <!doctype html>
      <html>
        <head><style>${css}</style></head>
        <body>
          <div class="crm-admin">
            ${header}
            <main class="crm-content" style="min-height: 500px; padding: 24px;">
              <h1>Courses Catalog</h1>
            </main>
          </div>
          <script>${dropdownInitializer}</script>
        </body>
      </html>
    `, { waitUntil: 'load' });

    const desktopStyles = await page.evaluate(() => {
      const nav = document.getElementById('crm-nav');
      const headerEl = document.querySelector('.crm-header');
      const cs = window.getComputedStyle(nav);
      const hcs = window.getComputedStyle(headerEl);
      return {
        overflowX: cs.overflowX,
        overflowY: cs.overflowY,
        headerUserSelect: hcs.userSelect || hcs.webkitUserSelect
      };
    });

    assert.strictEqual(desktopStyles.overflowX, 'visible', 'crm-nav overflowX should be visible on desktop');
    assert.strictEqual(desktopStyles.overflowY, 'visible', 'crm-nav overflowY should be visible on desktop');
    assert.strictEqual(desktopStyles.headerUserSelect, 'none', 'crm-header should have user-select: none');

    const coursesBtn = page.locator('button[data-main="courses"]');
    const cBox = await coursesBtn.boundingBox();
    assert(cBox, 'Courses button should be visible');

    await page.mouse.move(cBox.x + 20, cBox.y + 20);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(cBox.x + 20, cBox.y + 250, { steps: 20 });
    await page.mouse.up({ button: 'middle' });

    await page.mouse.move(cBox.x + 20, cBox.y + 20);
    await page.mouse.wheel(0, 200);
    await page.waitForTimeout(100);

    const itemsCheck = await page.evaluate(() => {
      const nav = document.getElementById('crm-nav');
      const buttons = Array.from(nav.querySelectorAll('.crm-nav-list > li > .crm-nav-item'));
      const headerRect = document.querySelector('.crm-header').getBoundingClientRect();
      return {
        scrollTop: nav.scrollTop,
        allButtonsVisible: buttons.every(b => {
          const r = b.getBoundingClientRect();
          return r.top >= headerRect.top && r.bottom <= headerRect.bottom + 1 && r.height > 0;
        })
      };
    });

    assert.strictEqual(itemsCheck.scrollTop, 0, 'crm-nav scrollTop must remain 0 after dragging/scrolling');
    assert.strictEqual(itemsCheck.allButtonsVisible, true, 'All nav buttons must remain visible within header');

    await coursesBtn.hover();
    await page.waitForTimeout(300);

    const catalogHit = await page.evaluate(() => {
      const btn = document.querySelector('.crm-nav-list .crm-dropdown-menu button[data-sub="courses"]');
      const r = btn.getBoundingClientRect();
      const hitEl = document.elementFromPoint(r.left + 10, r.top + 10);
      return hitEl === btn;
    });
    assert.strictEqual(catalogHit, true, 'Courses & Classes dropdown item must be clickable and hit-testable');

    const moreBtn = page.locator('.crm-nav-more-dropdown > .crm-nav-item');
    await moreBtn.click();
    await page.waitForTimeout(300);

    const voiceCloningHit = await page.evaluate(() => {
      const btn = document.querySelector('.crm-nav-more-dropdown .crm-dropdown-menu button[data-main="voice-cloning"]');
      const r = btn.getBoundingClientRect();
      const hitEl = document.elementFromPoint(r.left + 10, r.top + 10);
      return hitEl === btn;
    });
    assert.strictEqual(voiceCloningHit, true, 'More dropdown item must be clickable and hit-testable');

    await page.close();

    // 2. Mobile Drawer Test (800px)
    const mobilePage = await browser.newPage({ viewport: { width: 800, height: 600 } });
    await mobilePage.setContent(`
      <!doctype html>
      <html>
        <head><style>${css}</style></head>
        <body>
          <div class="crm-admin">
            ${header}
            <main class="crm-content"></main>
          </div>
          <script>${dropdownInitializer}</script>
        </body>
      </html>
    `, { waitUntil: 'load' });

    const mobileStyles = await mobilePage.evaluate(() => {
      const nav = document.getElementById('crm-nav');
      return {
        overflowY: window.getComputedStyle(nav).overflowY,
        position: window.getComputedStyle(nav).position
      };
    });

    assert.strictEqual(mobileStyles.position, 'fixed', 'Mobile nav drawer must have position: fixed');
    assert.strictEqual(mobileStyles.overflowY, 'auto', 'Mobile nav drawer must retain overflow-y: auto');

    await mobilePage.close();
    console.log('CRM header drag & scroll regression test passed successfully.');
  } finally {
    await browser.close();
  }
})().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
