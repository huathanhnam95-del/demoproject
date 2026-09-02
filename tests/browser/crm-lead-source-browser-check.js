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

    // Select source and owner
    await page.selectOption('#lead-source', 'Facebook - Personal');
    await page.selectOption('#lead-facebook-personal-owner', 'Quỳnh');
    assert.strictEqual(await page.$eval('#lead-facebook-personal-owner', (el) => el.value), 'Quỳnh', 'Selected owner should be Quỳnh');

    // Check salutation radios are present
    await page.check('#lead-salutation-mr');
    const isMrChecked = await page.$eval('#lead-salutation-mr', (el) => el.checked);
    assert.strictEqual(isMrChecked, true, 'Mr radio should be checked when clicked');

    await page.check('#lead-salutation-ms');
    const isMsChecked = await page.$eval('#lead-salutation-ms', (el) => el.checked);
    assert.strictEqual(isMsChecked, true, 'Ms radio should be checked when clicked');

    console.log('✓ Lead source, Source Account dropdown, and Mr/Ms salutation browser check PASSED');
  } finally {
    await browser.close();
    server.close();
  }
}

runTest().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
