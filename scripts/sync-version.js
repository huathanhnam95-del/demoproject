/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

// Read package.json
const packageJsonPath = path.join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const version = packageJson.version;

// Generate version strings
const now = new Date();
const vnTime = new Date(now.getTime() + (7 * 60 * 60 * 1000));
const yyyy = vnTime.getUTCFullYear();
const mm = String(vnTime.getUTCMonth() + 1).padStart(2, '0');
const dd = String(vnTime.getUTCDate()).padStart(2, '0');
const dateString = `${yyyy}${mm}${dd}`;
const crmVersion = `${dateString}-v${version}`;

// Calculate next version
const parts = version.split('.').map(Number);
parts[2] = parts[2] + 1;
const nextVersion = parts.join('.');

console.log(`Syncing version V${version} (CRM Version: ${crmVersion}, Next Version: ${nextVersion})...`);

// 1. Update public/index.html
const indexHtmlPath = path.join(__dirname, '..', 'public', 'index.html');
if (fs.existsSync(indexHtmlPath)) {
  let content = fs.readFileSync(indexHtmlPath, 'utf8');
  let updated = content.replace(
    /(<div id="version-indicator" class="version-indicator">)V\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?(<\/div>)/,
    `$1V${version}$2`
  );
  updated = updated.replace(
    /(<script\s+src="\/read-aloud-mode\.js\?v=)[^"]+("><\/script>)/,
    `$1${version}$2`
  );
  fs.writeFileSync(indexHtmlPath, updated, 'utf8');
  console.log('Updated public/index.html version indicator.');
}

// 2. Update public/crm-admin.html
const crmHtmlPath = path.join(__dirname, '..', 'public', 'crm-admin.html');
if (fs.existsSync(crmHtmlPath)) {
  let content = fs.readFileSync(crmHtmlPath, 'utf8');
  const updated = content.replace(
    /\?v=\d{8}-v\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?/g,
    `?v=${crmVersion}`
  );
  fs.writeFileSync(crmHtmlPath, updated, 'utf8');
  console.log('Updated public/crm-admin.html cache-busting tokens.');
}

// 2b. Update public/crm-entrance-test-result.html
const crmResultHtmlPath = path.join(__dirname, '..', 'public', 'crm-entrance-test-result.html');
if (fs.existsSync(crmResultHtmlPath)) {
  let content = fs.readFileSync(crmResultHtmlPath, 'utf8');
  const updated = content.replace(
    /\?v=\d{8}-v\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?/g,
    `?v=${crmVersion}`
  );
  fs.writeFileSync(crmResultHtmlPath, updated, 'utf8');
  console.log('Updated public/crm-entrance-test-result.html cache-busting tokens.');
}

// 3. Update tests/crm/crm-shell-static.test.js
const testPath = path.join(__dirname, '..', 'tests', 'crm', 'crm-shell-static.test.js');
if (fs.existsSync(testPath)) {
  let content = fs.readFileSync(testPath, 'utf8');
  const updated = content.replace(
    /(const CRM_ADMIN_ASSET_VERSION = ')\d{8}-v\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?(';)/,
    `$1${crmVersion}$2`
  );
  fs.writeFileSync(testPath, updated, 'utf8');
  console.log('Updated tests/crm/crm-shell-static.test.js asset version constant.');
}

// 4. Update GEMINI.md
const geminiPath = path.join(__dirname, '..', 'GEMINI.md');
if (fs.existsSync(geminiPath)) {
  let content = fs.readFileSync(geminiPath, 'utf8');
  let updated = content.replace(
    /(- \*\*Phase\*\*: Release V)\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?/,
    `$1${version}`
  );
  updated = updated.replace(
    /(- \*\*Next Version\*\*: `V)\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?(`)/,
    `$1${nextVersion}$2`
  );
  fs.writeFileSync(geminiPath, updated, 'utf8');
  console.log('Updated GEMINI.md active phase and next version.');
}

console.log('Version synchronization complete.');
