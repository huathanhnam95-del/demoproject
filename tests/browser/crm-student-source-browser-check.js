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
    const acquisitionOptions = await page.$$eval('#student-acquisition-source option', (els) => els.map((el) => el.value));
    assert.deepStrictEqual(acquisitionOptions, ['Facebook - Personal', 'Facebook - Page', 'Zalo - Page'], 'Student acquisition source options mismatch');

    // Default source is Facebook - Personal
    const isUrlVisiblePersonal = await page.$eval('#student-facebook-profile-url-group', (el) => el.style.display !== 'none' && getComputedStyle(el).display !== 'none');
    assert.strictEqual(isUrlVisiblePersonal, true, "Student's FB link field should be visible for Facebook - Personal");

    const isOwnerVisiblePersonal = await page.$eval('#student-facebook-personal-owner-group', (el) => el.style.display !== 'none' && getComputedStyle(el).display !== 'none');
    assert.strictEqual(isOwnerVisiblePersonal, true, "FB Personal Account dropdown should be visible for Facebook - Personal");

    const ownerOptions = await page.$$eval('#student-facebook-personal-owner option', (els) => els.map((el) => el.value));
    assert.deepStrictEqual(ownerOptions, ['Nam', 'Thành', 'Quỳnh'], 'Owner options should be Nam, Thành, Quỳnh');

    // Select Facebook - Page
    await page.selectOption('#student-acquisition-source', 'Facebook - Page');
    const isUrlVisiblePage = await page.$eval('#student-facebook-profile-url-group', (el) => el.style.display !== 'none' && getComputedStyle(el).display !== 'none');
    assert.strictEqual(isUrlVisiblePage, true, "Student's FB link field should be visible for Facebook - Page");

    const isOwnerVisiblePage = await page.$eval('#student-facebook-personal-owner-group', (el) => el.style.display === 'none' || getComputedStyle(el).display === 'none');
    assert.strictEqual(isOwnerVisiblePage, true, "FB Personal Account dropdown should be hidden for Facebook - Page");

    // Select Zalo - Page
    await page.selectOption('#student-acquisition-source', 'Zalo - Page');
    const isUrlVisibleZalo = await page.$eval('#student-facebook-profile-url-group', (el) => el.style.display === 'none' || getComputedStyle(el).display === 'none');
    assert.strictEqual(isUrlVisibleZalo, true, "Student's FB link field should be hidden for Zalo - Page");

    const isOwnerVisibleZalo = await page.$eval('#student-facebook-personal-owner-group', (el) => el.style.display === 'none' || getComputedStyle(el).display === 'none');
    assert.strictEqual(isOwnerVisibleZalo, true, "FB Personal Account dropdown should be hidden for Zalo - Page");

    console.log('✓ Student Management acquisition source, FB link, and FB Personal Account owner dropdown browser check PASSED');
  } finally {
    await browser.close();
    server.close();
  }
}

runTest().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
