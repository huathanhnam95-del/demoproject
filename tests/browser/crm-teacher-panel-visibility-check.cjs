const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({channel: 'chrome', headless: true});
  try {
    const page = await browser.newPage();
    const html = fs.readFileSync(path.join(__dirname, '../../public/crm-admin.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<link\b[^>]*>/gi, '');
    await page.route('**/*', route => route.abort());
    await page.setContent(html);
    await page.addStyleTag({content: fs.readFileSync(path.join(__dirname, '../../public/crm-admin.css'), 'utf8')});
    const panels = await page.locator('.crm-panel[data-panel]').evaluateAll(nodes => nodes.map(n => n.dataset.panel));
    for (const active of ['courses/teacher-schedule', 'agents', 'dashboard', 'staff', 'courses/teacher-schedule']) {
      assert.ok(panels.includes(active), `Panel exists: ${active}`);
      await page.locator('.crm-panel[data-panel]').evaluateAll((nodes, active) => {
        for (const node of nodes) node.style.display = node.dataset.panel === active ? 'block' : 'none';
      }, active);
      const visible = await page.locator('.crm-panel[data-panel]').evaluateAll(nodes => nodes.filter(n => getComputedStyle(n).display !== 'none').map(n => n.dataset.panel));
      assert.deepEqual(visible, [active], `Only ${active} should be displayed`);
      if (active === 'courses/teacher-schedule') assert.equal(await page.locator('[data-panel="courses/teacher-schedule"]').evaluate(n => getComputedStyle(n).display), 'flex');
    }
    console.log('PASS: Chrome panel visibility and scheduler flex layout');
  } finally { await browser.close(); }
})().catch(error => {console.error(error); process.exitCode = 1;});

