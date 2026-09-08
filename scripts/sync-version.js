/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

function parseArgs(argv = process.argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--timestamp') {
      if (index + 1 >= argv.length || !argv[index + 1]) {
        throw new Error('--timestamp requires an ISO-8601 value.');
      }
      args.timestamp = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function resolveTimestamp(value) {
  if (value == null) {
    return new Date();
  }
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('--timestamp requires a non-empty ISO-8601 value.');
  }
  const normalizedValue = value.trim();
  const match = normalizedValue.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/);
  if (!match) {
    throw new Error(`Invalid --timestamp value: ${value}. Use a full ISO-8601 timestamp with Z or an explicit offset.`);
  }
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, offset] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHour = offset === 'Z' ? 0 : Number(offset.slice(1, 3));
  const offsetMinute = offset === 'Z' ? 0 : Number(offset.slice(4, 6));
  const daysInMonth = month >= 1 && month <= 12
    ? new Date(Date.UTC(year, month, 0)).getUTCDate()
    : 0;
  if (day < 1 || day > daysInMonth || hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59) {
    throw new Error(`Invalid --timestamp value: ${value}`);
  }
  const timestamp = new Date(normalizedValue);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error(`Invalid --timestamp value: ${value}`);
  }
  return timestamp;
}

function syncVersion({ timestamp } = {}) {
  // Read package.json
  const packageJsonPath = path.join(__dirname, '..', 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const version = packageJson.version;

  // Generate version strings. Vietnam is UTC+07:00 year-round; using UTC
  // fields after the fixed offset keeps the token independent of host locale.
  const now = resolveTimestamp(timestamp);
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
  return { version, crmVersion, nextVersion, timestamp: now.toISOString() };
}

if (require.main === module) {
  try {
    syncVersion(parseArgs(process.argv));
  } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  }
}

module.exports = {
  parseArgs,
  resolveTimestamp,
  syncVersion
};
