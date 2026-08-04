const fs = require('node:fs');
const path = require('node:path');

function isLocalHostname(hostname) {
  let value = String(hostname || '').trim().toLowerCase();
  if (!value) return false;
  if (value.startsWith('[') && value.endsWith(']')) value = value.slice(1, -1);
  if (value === 'localhost' || value === '127.0.0.1' || value === '::1') return true;
  if (value.endsWith('.local')) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(value)) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(value)) return true;
  return false;
}

function shouldAllowLocalAdminBootstrap(requestOrHostname, env = process.env) {
  const hostname = typeof requestOrHostname === 'string'
    ? requestOrHostname
    : requestOrHostname?.hostname;
  const origin = typeof requestOrHostname === 'object'
    ? String(requestOrHostname?.headers?.origin || '').trim()
    : '';
  const nodeEnv = String(env.NODE_ENV || '').trim().toLowerCase();
  const allowProd = String(env.ALLOW_PROD_FIREBASE || '').trim() === '1';
  const emulatorHost = String(env.FIREBASE_AUTH_EMULATOR_HOST || '').trim();
  const disabled = String(env.DISABLE_LOCAL_ADMIN_AUTO_LOGIN || '').trim() === '1';
  let originAllowed = true;
  if (origin) {
    try {
      originAllowed = isLocalHostname(new URL(origin).hostname);
    } catch (_error) {
      originAllowed = false;
    }
  }

  return !disabled
    && nodeEnv !== 'production'
    && !allowProd
    && Boolean(emulatorHost)
    && originAllowed
    && isLocalHostname(hostname);
}

function normalizeCredentialValue(value) {
  return String(value || '')
    .trim()
    .replace(/^`(.+)`$/, '$1')
    .replace(/^\*\*(.+)\*\*$/, '$1')
    .replace(/^"(.+)"$/, '$1')
    .replace(/^'(.+)'$/, '$1')
    .trim();
}

function readCredentialFileEmail(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return '';
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (_error) {
    return '';
  }

  const line = String(text)
    .split(/\r?\n/g)
    .map((item) => item.trim())
    .find((item) => /^[-*]?\s*(?:email|username)\s*:/i.test(item));
  if (line) {
    return normalizeCredentialValue(line.replace(/^[-*]?\s*(?:email|username)\s*:\s*/i, ''));
  }

  const match = String(text).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? normalizeCredentialValue(match[0]) : '';
}

function resolveLocalAdminEmail({ repoRoot = process.cwd(), env = process.env } = {}) {
  const configured = normalizeCredentialValue(env.EMULATOR_ADMIN_EMAIL || env.ADMIN_EMAIL);
  if (configured) return configured;

  return readCredentialFileEmail(path.join(
    repoRoot,
    '.local',
    'browser-test-credentials.md'
  ));
}

module.exports = {
  isLocalHostname,
  shouldAllowLocalAdminBootstrap,
  resolveLocalAdminEmail,
  readCredentialFileEmail
};
