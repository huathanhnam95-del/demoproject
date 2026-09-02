const http = require('http');
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const { chromium } = require('playwright');

const PORT = 8899;
const PUBLIC_DIR = path.join(__dirname, '../../public');

function serveStaticFile(req, res) {
  let filePath = path.join(PUBLIC_DIR, req.url === '/' ? 'crm-admin.html' : req.url.split('?')[0]);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(PUBLIC_DIR, 'crm-admin.html');
  }

  const ext = path.extname(filePath);
  const contentTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg'
  };

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(500);
      res.end('Server Error');
    } else {
      res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'text/plain' });
      res.end(content);
    }
  });
}

async function runTest() {
  const server = http.createServer(serveStaticFile);
  await new Promise((resolve) => server.listen(PORT, resolve));

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(`http://localhost:${PORT}/crm-admin.html`);

    await page.evaluate(() => {
      const loading = document.getElementById('crm-loading');
      if (loading) loading.style.display = 'none';
      const studentModal = document.getElementById('crm-student-modal');
      if (studentModal) studentModal.style.display = 'flex';
      const studentInfo = document.getElementById('student-info');
      if (studentInfo) studentInfo.style.display = 'block';

      if (window.updateStudentSourceVisibility) {
        window.updateStudentSourceVisibility();
      }
    });

    // Verify Acquisition Source choices
    const acquisitionOptions = await page.$$eval('#lead-source option', (els) => els.map((el) => el.value));
    assert.deepStrictEqual(acquisitionOptions, ['', 'Facebook - Personal', 'Facebook - Page', 'Zalo - Page', 'Zalo + Personal', 'Tiktok - Personal', 'Agent'], 'Student acquisition source options mismatch');

    // Source is required and blank by default.
    assert.strictEqual(await page.$eval('#lead-source', (el) => el.value), '', 'Source should be blank by default');
    assert.strictEqual(await page.$eval('#lead-source', (el) => el.required), true, 'Source should be required');
    // Check Source Account dropdown options and blank default
    const ownerOptions = await page.$$eval('#lead-facebook-personal-owner option', (els) => els.map((el) => el.value));
    assert.deepStrictEqual(ownerOptions, ['', 'Nam', 'Thành', 'Quỳnh'], 'Owner options should be blank prompt, Nam, Thành, Quỳnh');
    assert.strictEqual(await page.$eval('#lead-facebook-personal-owner', (el) => el.value), '', 'Source Account should be blank by default');
    assert.strictEqual(await page.$eval('#lead-facebook-personal-owner', (el) => el.required), true, 'Source Account should be required');

    // Select Tiktok - Personal
    await page.selectOption('#lead-source', 'Tiktok - Personal');
    await page.selectOption('#lead-facebook-personal-owner', 'Thành');
    assert.strictEqual(await page.$eval('#lead-facebook-personal-owner', (el) => el.value), 'Thành', 'Selected owner should be Thành');

    console.log('✓ Student acquisition source and Source Account dropdown browser check PASSED');
  } finally {
    await browser.close();
    server.close();
  }
}

runTest().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
