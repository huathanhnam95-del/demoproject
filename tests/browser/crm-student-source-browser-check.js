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
      if (typeof window.setupStudentModal === 'function') {
        window.setupStudentModal();
      }
    });

    // Verify Acquisition Source choices
    const acquisitionOptions = await page.$$eval('#lead-source option', (els) => els.map((el) => el.value));
    assert.deepStrictEqual(acquisitionOptions, ['', 'Facebook - Personal', 'Facebook - Page', 'Zalo - Page', 'Zalo - Personal', 'Tiktok - Personal', 'Agent'], 'Student acquisition source options mismatch');

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

    // Verify buildPayload and hasAnyInfoField in browser environment
    const clientCheck = await page.evaluate(() => {
      const nameInput = document.getElementById('lead-name');
      if (nameInput) nameInput.value = 'Nguyen Van A';

      // Test dummy time input for computed width
      const testTime = document.createElement('input');
      testTime.type = 'time';
      testTime.className = 'crm-availability-time-input';
      document.body.appendChild(testTime);
      const computedWidth = window.getComputedStyle(testTime).width;
      const computedBoxSizing = window.getComputedStyle(testTime).boxSizing;
      document.body.removeChild(testTime);

      const payload = window.CrmStudents ? window.CrmStudents.buildPayload({
        inputStudentName: document.getElementById('lead-name'),
        inputStudentAcquisitionSource: document.getElementById('lead-source'),
        inputStudentFacebookPersonalOwner: document.getElementById('lead-facebook-personal-owner')
      }) : null;

      const hasInfoOnlyOwner = window.CrmStudents ? window.CrmStudents.hasAnyInfoField({
        facebookPersonalOwner: 'Thành'
      }) : false;

      return {
        computedWidth,
        computedBoxSizing,
        payloadOwner: payload ? payload.facebookPersonalOwner : null,
        hasInfoOnlyOwner
      };
    });

    assert.strictEqual(clientCheck.computedWidth, '128px', 'Time picker input width should be 128px');
    assert.strictEqual(clientCheck.computedBoxSizing, 'border-box', 'Time picker box-sizing should be border-box');
    assert.strictEqual(clientCheck.payloadOwner, 'Thành', 'CrmStudents.buildPayload must extract facebookPersonalOwner');
    assert.strictEqual(clientCheck.hasInfoOnlyOwner, true, 'hasAnyInfoField must recognize facebookPersonalOwner');

    // Verify Agent source selection in student modal
    await page.selectOption('#lead-source', 'Agent');
    const ownerGroupDisplay = await page.$eval('#lead-facebook-personal-owner-group', (el) => el.style.display);
    const ownerRequired = await page.$eval('#lead-facebook-personal-owner', (el) => el.required);
    const agentGroupDisplay = await page.$eval('#lead-agent-source-group', (el) => el.style.display);
    const agentRequired = await page.$eval('#lead-agent-source', (el) => el.required);

    assert.strictEqual(ownerGroupDisplay, 'none', 'Source Account group must be hidden when source is Agent');
    assert.strictEqual(ownerRequired, false, 'Source Account must not be required when hidden');
    assert.strictEqual(agentGroupDisplay, '', 'Agent Source group must be visible when source is Agent');
    assert.strictEqual(agentRequired, true, 'Agent Source must be required when source is Agent');

    // Test student tab switching (confirm student-360 normalizes safely to info, and learning tab works)
    const tabSwitchCheck = await page.evaluate(() => {
      const results = {};
      // Test switching to 'learning'
      if (window.CrmStudentModal && typeof window.CrmStudentModal.switchStudentTab === 'function') {
        window.CrmStudentModal.switchStudentTab('learning');
      } else if (typeof window.switchStudentTab === 'function') {
        window.switchStudentTab('learning');
      }

      const learningPanel = document.getElementById('student-learning');
      const learningBtn = document.querySelector('.crm-sidebar-item[data-tab="learning"]');
      results.learningVisible = learningPanel && learningPanel.style.display === 'block';
      results.learningActive = learningPanel && learningPanel.classList.contains('active');
      results.learningBtnActive = learningBtn && learningBtn.classList.contains('active');

      // Test switching back to 'info'
      if (window.CrmStudentModal && typeof window.CrmStudentModal.switchStudentTab === 'function') {
        window.CrmStudentModal.switchStudentTab('info');
      } else if (typeof window.switchStudentTab === 'function') {
        window.switchStudentTab('info');
      }

      const infoPanel = document.getElementById('student-info');
      const infoBtn = document.querySelector('.crm-sidebar-item[data-tab="info"]');
      results.infoVisible = infoPanel && infoPanel.style.display === 'block';
      results.infoActive = infoPanel && infoPanel.classList.contains('active');
      results.infoBtnActive = infoBtn && infoBtn.classList.contains('active');

      // Verify overview/student-360 tab elements are removed
      results.overviewBtnExists = Boolean(document.querySelector('.crm-sidebar-item[data-tab="overview"]'));
      results.overviewPanelExists = Boolean(document.getElementById('student-overview'));

      return results;
    });

    assert.strictEqual(tabSwitchCheck.learningVisible, true, 'Learning panel must be visible after switchStudentTab("learning")');
    assert.strictEqual(tabSwitchCheck.learningActive, true, 'Learning panel must have active class');
    assert.strictEqual(tabSwitchCheck.learningBtnActive, true, 'Sidebar button for Learning Profile must have active class');
    assert.strictEqual(tabSwitchCheck.infoVisible, true, 'Info panel must be visible after switchStudentTab("info")');
    assert.strictEqual(tabSwitchCheck.infoBtnActive, true, 'Sidebar button for Info must have active class');
    assert.strictEqual(tabSwitchCheck.overviewBtnExists, false, 'Student 360 overview tab button must not exist');
    assert.strictEqual(tabSwitchCheck.overviewPanelExists, false, 'Student 360 overview panel must not exist');

    // Also test interactive user clicks on modal sidebar tabs
    await page.click('.crm-sidebar-item[data-tab="learning"]');
    assert.strictEqual(await page.$eval('#student-learning', (el) => el.style.display), 'block', 'Clicking Learning Profile must show learning panel');
    assert.strictEqual(await page.$eval('.crm-sidebar-item[data-tab="learning"]', (el) => el.classList.contains('active')), true, 'Learning button must be active');

    await page.click('.crm-sidebar-item[data-tab="info"]');
    assert.strictEqual(await page.$eval('#student-info', (el) => el.style.display), 'block', 'Clicking Info must restore info panel');

    console.log('✓ Student acquisition source, Source Account dropdown, Agent Source toggling, student tab switching, and time input CSS check PASSED');
  } finally {
    await browser.close();
    server.close();
  }
}

runTest().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
