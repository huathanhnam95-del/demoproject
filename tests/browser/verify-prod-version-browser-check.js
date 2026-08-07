/* eslint-disable no-console */
const { chromium } = require('playwright');
const assert = require('assert');

async function main() {
  console.log('Launching Playwright Chrome browser check against live production...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  const prodUrl = 'https://listening-tasks-3ae34.web.app';

  try {
    // 1. Load Main App Page
    console.log(`Navigating to ${prodUrl}/...`);
    await page.goto(`${prodUrl}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Check version indicator text
    await page.waitForSelector('#version-indicator', { timeout: 10000 });
    const versionText = await page.textContent('#version-indicator');
    console.log(`Live Main Page Version Indicator Text: "${versionText?.trim()}"`);
    assert.strictEqual(versionText?.trim(), 'V1.8.52', 'Main app #version-indicator must match V1.8.52');

    // 2. Load CRM Admin Page
    console.log(`Navigating to ${prodUrl}/crm-admin.html...`);
    await page.goto(`${prodUrl}/crm-admin.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Check asset cache buster on crm-admin.js
    const crmScriptSrc = await page.getAttribute('script[src*="crm-admin.js"]', 'src');
    console.log(`Live CRM Admin Script Src: "${crmScriptSrc}"`);
    assert.ok(crmScriptSrc && crmScriptSrc.includes('v1.8.52'), 'crm-admin.js script src must include v1.8.52 cache-buster');

    console.log('✅ ALL LIVE PRODUCTION VERSION CHECKS PASSED SUCCESSFULLY!');
  } catch (error) {
    console.error('❌ Production Version Verification Failed:', error);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

main();
