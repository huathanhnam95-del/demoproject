const fs = require('fs');
const path = require('path');
const http = require('http');
const assert = require('assert');
const { chromium } = require('playwright');

function serveFile(req, res, rootDir) {
  let reqPath = req.url.split('?')[0];
  if (reqPath === '/') reqPath = '/crm-admin.html';
  const filePath = path.join(rootDir, reqPath);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  const ext = path.extname(filePath);
  const map = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json'
  };
  res.writeHead(200, { 'Content-Type': map[ext] || 'text/plain' });
  res.end(fs.readFileSync(filePath));
}

async function runTest() {
  const publicDir = path.join(__dirname, '..', '..', 'public');
  const server = http.createServer((req, res) => serveFile(req, res, publicDir));
  
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}/crm-admin.html`;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      const loading = document.getElementById('crm-loading');
      if (loading) loading.style.display = 'none';
      const studentModal = document.getElementById('crm-student-modal');
      if (studentModal) studentModal.style.display = 'flex';
      const studentInfo = document.getElementById('student-info');
      if (studentInfo) studentInfo.style.display = 'block';
      const composer = document.getElementById('lead-composer');
      if (composer) composer.style.display = 'grid';
      if (window.updateLeadSourceVisibility) window.updateLeadSourceVisibility();
      if (window.updateStudentSourceVisibility) window.updateStudentSourceVisibility();
    });

    const sourceOptions = await page.$$eval('#lead-source option', (options) => options.map((option) => option.value));
    assert.deepStrictEqual(
      sourceOptions,
      ['', 'Facebook - Personal', 'Facebook - Page', 'Zalo - Page', 'Zalo - Personal', 'Tiktok - Personal', 'Agent'],
      'Source options should begin blank and include Zalo - Personal'
    );

    // Check required blank default selection
    const defaultSource = await page.$eval('#lead-source', (el) => el.value);
    assert.strictEqual(defaultSource, '', 'Default source should be blank');
    assert.strictEqual(await page.$eval('#lead-source', (el) => el.required), true, 'Source should be required');

    // Check Source Account dropdown options and blank default
    const ownerOptions = await page.$$eval('#lead-facebook-personal-owner option', (els) => els.map((el) => el.value));
    assert.deepStrictEqual(ownerOptions, ['', 'Nam', 'Thành', 'Quỳnh'], 'Owner options should be blank prompt, Nam, Thành, Quỳnh');
    assert.strictEqual(await page.$eval('#lead-facebook-personal-owner', (el) => el.value), '', 'Source Account should be blank by default');
    assert.strictEqual(await page.$eval('#lead-facebook-personal-owner', (el) => el.required), true, 'Source Account should be required');

    // Check default Social Media Account Link is hidden
    const initialLinkGroupDisplay = await page.$eval('#lead-facebook-profile-url-group', (el) => el.style.display);
    assert.strictEqual(initialLinkGroupDisplay, 'none', 'Social Media Account Link group should be hidden by default');

    // Select source and owner
    await page.selectOption('#lead-source', 'Facebook - Personal');
    await page.selectOption('#lead-facebook-personal-owner', 'Quỳnh');
    assert.strictEqual(await page.$eval('#lead-facebook-personal-owner', (el) => el.value), 'Quỳnh', 'Selected owner should be Quỳnh');

    // Verify Social Media Account Link is visible after choosing Facebook
    const linkGroupDisplayAfterFb = await page.$eval('#lead-facebook-profile-url-group', (el) => el.style.display);
    assert.strictEqual(linkGroupDisplayAfterFb, '', 'Social Media Account Link group must be visible after choosing Facebook - Personal');
    const linkLabel = await page.$eval('label[for="lead-facebook-profile-url"]', (el) => el.textContent.trim());
    assert.strictEqual(linkLabel, 'Social Media Account Link', 'Label must be Social Media Account Link');

    // Type a profile link
    await page.fill('#lead-facebook-profile-url', 'https://facebook.com/tran.khac.huy');
    assert.strictEqual(await page.$eval('#lead-facebook-profile-url', (el) => el.value), 'https://facebook.com/tran.khac.huy');

    // Check salutation radios are present
    await page.check('#lead-salutation-mr');
    const isMrChecked = await page.$eval('#lead-salutation-mr', (el) => el.checked);
    assert.strictEqual(isMrChecked, true, 'Mr radio should be checked when clicked');

    await page.check('#lead-salutation-ms');
    const isMsChecked = await page.$eval('#lead-salutation-ms', (el) => el.checked);
    assert.strictEqual(isMsChecked, true, 'Ms radio should be checked when clicked');

    // Verify Agent selection toggles Agent Source, hides Source Account, and hides/clears Social Media Account Link
    await page.selectOption('#lead-source', 'Agent');
    const ownerGroupDisplayAfterAgent = await page.$eval('#lead-facebook-personal-owner-group', (el) => el.style.display);
    const ownerRequiredAfterAgent = await page.$eval('#lead-facebook-personal-owner', (el) => el.required);
    const agentGroupDisplayAfterAgent = await page.$eval('#lead-agent-source-group', (el) => el.style.display);
    const agentRequiredAfterAgent = await page.$eval('#lead-agent-source', (el) => el.required);
    const linkGroupDisplayAfterAgent = await page.$eval('#lead-facebook-profile-url-group', (el) => el.style.display);
    const linkValueAfterAgent = await page.$eval('#lead-facebook-profile-url', (el) => el.value);

    assert.strictEqual(ownerGroupDisplayAfterAgent, 'none', 'Source Account group must be hidden when source is Agent');
    assert.strictEqual(ownerRequiredAfterAgent, false, 'Source Account must not be required when hidden');
    assert.strictEqual(agentGroupDisplayAfterAgent, '', 'Agent Source group must be visible when source is Agent');
    assert.strictEqual(agentRequiredAfterAgent, true, 'Agent Source must be required when source is Agent');
    assert.strictEqual(linkGroupDisplayAfterAgent, 'none', 'Social Media Account Link group must be hidden when source is Agent');
    assert.strictEqual(linkValueAfterAgent, '', 'Social Media Account Link value must be cleared when switching away from Facebook');

    // Verify Facebook - Page also shows Social Media Account Link
    await page.selectOption('#lead-source', 'Facebook - Page');
    const linkGroupDisplayAfterFbPage = await page.$eval('#lead-facebook-profile-url-group', (el) => el.style.display);
    assert.strictEqual(linkGroupDisplayAfterFbPage, '', 'Social Media Account Link group must be visible when source is Facebook - Page');

    // Verify switching back to non-Agent, non-Facebook restores Source Account and hides Social Media Account Link
    await page.selectOption('#lead-source', 'Zalo - Personal');
    const ownerGroupDisplayAfterZalo = await page.$eval('#lead-facebook-personal-owner-group', (el) => el.style.display);
    const ownerRequiredAfterZalo = await page.$eval('#lead-facebook-personal-owner', (el) => el.required);
    const agentGroupDisplayAfterZalo = await page.$eval('#lead-agent-source-group', (el) => el.style.display);
    const agentRequiredAfterZalo = await page.$eval('#lead-agent-source', (el) => el.required);
    const linkGroupDisplayAfterZalo = await page.$eval('#lead-facebook-profile-url-group', (el) => el.style.display);

    assert.strictEqual(ownerGroupDisplayAfterZalo, '', 'Source Account group must be visible when source is Zalo - Personal');
    assert.strictEqual(ownerRequiredAfterZalo, true, 'Source Account must be required when source is Zalo - Personal');
    assert.strictEqual(agentGroupDisplayAfterZalo, 'none', 'Agent Source group must be hidden when source is Zalo - Personal');
    assert.strictEqual(agentRequiredAfterZalo, false, 'Agent Source must not be required when hidden');
    assert.strictEqual(linkGroupDisplayAfterZalo, 'none', 'Social Media Account Link group must be hidden when source is Zalo - Personal');

    console.log('✓ Lead source, Social Media Account Link, Source Account dropdown, Agent Source toggling, and Mr/Ms salutation browser check PASSED');
  } finally {
    await browser.close();
    server.close();
  }
}

runTest().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
