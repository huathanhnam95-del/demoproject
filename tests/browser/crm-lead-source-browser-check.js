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
      const sourceInput = document.getElementById('lead-source');
      if (sourceInput) {
        sourceInput.value = 'Facebook - Personal';
        sourceInput.dispatchEvent(new Event('change'));
      }
      if (window.updateLeadSourceVisibility) window.updateLeadSourceVisibility();
      if (window.updateStudentSourceVisibility) window.updateStudentSourceVisibility();
    });

    // Check default source selection
    const defaultSource = await page.$eval('#lead-source', (el) => el.value);
    assert.strictEqual(defaultSource, 'Facebook - Personal', 'Default source should be Facebook - Personal');

    // Check Facebook Profile Url field is visible initially
    const isVisibleInitial = await page.$eval('#lead-facebook-profile-url-group', (el) => el.style.display !== 'none' && getComputedStyle(el).display !== 'none');
    assert.strictEqual(isVisibleInitial, true, "Student's FB link field should be visible for Facebook - Personal");

    // Check Personal Owner dropdown field is visible initially for Facebook - Personal
    const isOwnerVisibleInitial = await page.$eval('#lead-facebook-personal-owner-group', (el) => el.style.display !== 'none' && getComputedStyle(el).display !== 'none');
    assert.strictEqual(isOwnerVisibleInitial, true, "FB Personal Account dropdown should be visible for Facebook - Personal");

    const ownerOptions = await page.$$eval('#lead-facebook-personal-owner option', (els) => els.map((el) => el.value));
    assert.deepStrictEqual(ownerOptions, ['Nam', 'Thành', 'Quỳnh'], 'Owner options should be Nam, Thành, Quỳnh');

    // Select Quỳnh
    await page.selectOption('#lead-facebook-personal-owner', 'Quỳnh');

    // Enter a link
    await page.fill('#lead-facebook-profile-url', 'https://facebook.com/teststudent');

    // Check salutation radios are present
    await page.check('#lead-salutation-mr');
    const isMrChecked = await page.$eval('#lead-salutation-mr', (el) => el.checked);
    assert.strictEqual(isMrChecked, true, 'Mr radio should be checked when clicked');

    await page.check('#lead-salutation-ms');
    const isMsChecked = await page.$eval('#lead-salutation-ms', (el) => el.checked);
    assert.strictEqual(isMsChecked, true, 'Ms radio should be checked when clicked');

    // Switch to Agent source
    await page.selectOption('#lead-source', 'Agent');
    const isAgentVisible = await page.$eval('#lead-agent-source-group', (el) => el.style.display !== 'none' && getComputedStyle(el).display !== 'none');
    assert.strictEqual(isAgentVisible, true, 'Agent Source dropdown should be visible when Agent source selected');

    // Switch to Tiktok - Personal
    await page.selectOption('#lead-source', 'Tiktok - Personal');
    const isOwnerVisibleTiktok = await page.$eval('#lead-facebook-personal-owner-group', (el) => el.style.display !== 'none' && getComputedStyle(el).display !== 'none');
    assert.strictEqual(isOwnerVisibleTiktok, true, 'Personal Social Media Account dropdown should be visible when Tiktok - Personal selected');

    // Switch to Zalo - Page
    await page.selectOption('#lead-source', 'Zalo - Page');
    const isVisibleZalo = await page.$eval('#lead-facebook-profile-url-group', (el) => el.style.display === 'none' || getComputedStyle(el).display === 'none');
    assert.strictEqual(isVisibleZalo, true, "Student's FB link field should be hidden for Zalo - Page");

    const isOwnerVisibleZalo = await page.$eval('#lead-facebook-personal-owner-group', (el) => el.style.display === 'none' || getComputedStyle(el).display === 'none');
    assert.strictEqual(isOwnerVisibleZalo, true, "Personal Social Media Account dropdown should be hidden for Zalo - Page");

    const isAgentVisibleZalo = await page.$eval('#lead-agent-source-group', (el) => el.style.display === 'none' || getComputedStyle(el).display === 'none');
    assert.strictEqual(isAgentVisibleZalo, true, "Agent Source dropdown should be hidden for Zalo - Page");

    const zaloClearedValue = await page.$eval('#lead-facebook-profile-url', (el) => el.value);
    assert.strictEqual(zaloClearedValue, '', "Student's FB link input value should be cleared when switching to non-Facebook source");

    // Switch to Facebook - Page
    await page.selectOption('#lead-source', 'Facebook - Page');
    const isVisiblePage = await page.$eval('#lead-facebook-profile-url-group', (el) => el.style.display !== 'none' && getComputedStyle(el).display !== 'none');
    assert.strictEqual(isVisiblePage, true, "Student's FB link field should be visible for Facebook - Page");

    const isOwnerVisiblePage = await page.$eval('#lead-facebook-personal-owner-group', (el) => el.style.display === 'none' || getComputedStyle(el).display === 'none');
    assert.strictEqual(isOwnerVisiblePage, true, "FB Personal Account dropdown should be hidden for Facebook - Page");

    console.log('✓ Lead source, dynamic Student\'s FB link field, FB Personal Account owner, Agent source dropdown, and Mr/Ms salutation browser check PASSED');
  } finally {
    await browser.close();
    server.close();
  }
}

runTest().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
